// Studio timeline semantics (spec §81-§92, §95-§96, §141; plan V416-V418). Pure: plain data in,
// plain data out; no DOM, no Web Audio, no globals, no clock. The canonical timeline lives in the
// StudioModel (schema.js); every change still goes through actions.js — the helpers here compute
// the action an editor dispatches at gesture end (§86: commit at gesture end).
//
// Tracks and clips (§82-§84). Track kinds exist only where semantics differ:
//   event        pattern clips (the sequencer's blocks, played by one voice per contiguous run)
//                and event clips (gate / trigger of the target node)
//   measurement  measurement clips (noise-check, pre-roll, stimulus, capture, tail, analysis)
//   automation   lanes in timeline.automation (one per node parameter), not clips (automation.js)
//   markers      annotations / anchors (§96), never clips and never executed
// A clip `{ id, trackId, kind, start, duration, target, payload, musical? }` plays on its own
// target or, when that is null, on its track's target.
//
// Time (§89-§91). Model times are absolute seconds (`start`, `duration`) and are what plays.
// SECONDS is the default time mode. A clip may be tempo-linked: `musical: { startBeats,
// durationBeats }`; a tempo change rescales its seconds from its beats (actions.js
// TRANSPORT_SET), while absolute clips stay put. Conversion: seconds = beats × 60 / tempo, one
// beat being one tempo beat (the time-signature denominator note); a bar is timeSignature[0]
// beats. A measurement clip is never tempo-linked and is never snapped to a musical grid: musical
// time never enters a measurement experiment (validate.js `musical-measurement`).
//
// Pattern runs. Pattern clips on one track that follow each other without a gap form one run,
// which the compiler plays as one sequencer voice (exactly the V2 sequencer's block chain); a
// gap starts a new run and overlapping clips play as separate voices (the model allows overlap,
// the editor warns about it).
//
//   clipRules(model, clip) -> errors (store and editor)   validateClip(model, clip) -> { ok,
//     errors, warnings }   clipDurationBounds(clip)
//   moveClipResult / resizeClipResult / duplicateClipPlacement / nudgeClipResult -> action data
//   snapTime(t, snap, context)        musical conversion helpers        loop and marker helpers

import { BLOCK_SCHEMA } from '../sequencer/model.js';
import { CONTRACT_LIMITS, TIMING_LIMITS } from '../measurement/engine.js';
import { DURATION_LIMITS } from '../measurement/stimulus.js';
import { MEASUREMENT_TARGETS, clipTarget, clipUse } from './clip-targets.js';
import { NODE_REGISTRY } from './registry.js';
import {
  CLIP_KINDS, EVENT_ACTIONS, MARKER_KINDS, MIN_CLIP_S, TIMELINE_MAX_S,
  TRACK_CLIP_KINDS, TRACK_KINDS,
} from './schema.js';

// ---------------------------------------------------------------- constants

export const DEFAULT_TIME_MODE = 'seconds';
/**
 * Two clip edges closer than this are the same instant (1 µs: below one sample period at the
 * highest accepted rate, 384 kHz = 2.6 µs, and far above float error on 3600 s).
 */
export const CONTIGUITY_TOLERANCE_S = 1e-6;
/** Shortest active loop region (s); validate.js enforces the same bound. */
export const MIN_LOOP_S = MIN_CLIP_S;
/** Event clip actions (schema.js; the store validates them too). */
export { EVENT_ACTIONS };

/** Track types of the timeline view (§82). Only event and measurement are model tracks. */
export const TRACK_TYPES = Object.freeze({
  event: Object.freeze({ label: 'Event', model: 'track', clipKinds: TRACK_CLIP_KINDS.event }),
  measurement: Object.freeze({ label: 'Measurement', model: 'track',
    clipKinds: TRACK_CLIP_KINDS.measurement }),
  automation: Object.freeze({ label: 'Automation', model: 'lane', clipKinds: Object.freeze([]) }),
  markers: Object.freeze({ label: 'Markers', model: 'marker', clipKinds: Object.freeze([]) }),
});

/**
 * Duration bounds (s) of measurement clips, from the measurement engine's own limits
 * (measurement/engine.js TIMING_LIMITS and CONTRACT_LIMITS; the stimulus bound is the
 * logarithmic sweep's DURATION_LIMITS, since a measurement sweep is logarithmic).
 */
export const MEASUREMENT_CLIP_LIMITS = Object.freeze({
  'noise-check': Object.freeze([TIMING_LIMITS.noiseCheckS[0], CONTRACT_LIMITS.maxNoiseS]),
  'pre-roll': TIMING_LIMITS.preRollS,
  stimulus: Object.freeze([DURATION_LIMITS['log-sweep'][0], CONTRACT_LIMITS.maxSweepS]),
  capture: Object.freeze([DURATION_LIMITS.sine[0], CONTRACT_LIMITS.maxCaptureS]),
  tail: TIMING_LIMITS.postRollS,
  analysis: Object.freeze([MIN_CLIP_S, TIMELINE_MAX_S]),
});

/** Node types a measurement clip action requires as its target (clip-targets.js). */
export { MEASUREMENT_TARGETS };

export const SNAP_MODES = Object.freeze(['off', 'time', 'musical', 'markers']);
/**
 * Default snap: off. gridS is the time grid, beatsPerStep the musical grid (1 = beat, 0.25 =
 * sixteenth in 4/4), thresholdS the marker capture distance (the editor passes
 * thresholdPx / pxPerSecond).
 */
export const DEFAULT_SNAP = Object.freeze({ mode: 'off', gridS: 0.1, beatsPerStep: 1,
  thresholdS: 0.05 });

/** Default labels of the §96 marker kinds. */
export const MARKER_LABELS = Object.freeze({ start: 'Start', sweep: 'Sweep', capture: 'Capture',
  analysis: 'Analysis', end: 'End', custom: 'Marker' });

// ---------------------------------------------------------------- small helpers

const finite = (v) => typeof v === 'number' && Number.isFinite(v);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
/** Round to a nanosecond: removes float residue (0.1 × 3) without moving any sample. */
export const cleanTime = (v) => Math.round(v * 1e9) / 1e9 + 0; // + 0 turns -0 into 0

const diag = (severity, code, message, path = '') => ({ code, severity, message, path });

export function clipEnd(clip) {
  return clip.start + clip.duration;
}

/** 'tempo' for a tempo-linked clip, else 'absolute'. */
export function clipTimeBase(clip) {
  return clip && clip.musical ? 'tempo' : 'absolute';
}

export function findTrack(model, id) {
  return model.timeline.tracks.find((t) => t.id === id) || null;
}

export function findClip(model, id) {
  return model.timeline.clips.find((c) => c.id === id) || null;
}

/** The node id a clip plays on: its own target, else its track's (null when neither). */
export function effectiveTarget(model, clip) {
  if (clip.target !== null && clip.target !== undefined) return clip.target;
  const track = findTrack(model, clip.trackId);
  return track ? track.target : null;
}

/** True when two half-open intervals [a, a+da) and [b, b+db) overlap by more than tolerance. */
export function intervalsOverlap(a0, a1, b0, b1) {
  return a0 < b1 - CONTIGUITY_TOLERANCE_S && b0 < a1 - CONTIGUITY_TOLERANCE_S;
}

/** Clips of the same kind group on `trackId` that overlap [start, end), excluding `exceptId`. */
export function overlappingClips(model, trackId, start, end, exceptId = null, kind = 'pattern') {
  return model.timeline.clips.filter((c) => c.trackId === trackId && c.id !== exceptId
    && c.kind === kind && intervalsOverlap(start, end, c.start, clipEnd(c)));
}

/** Last end of anything executable: clips and automation points (markers annotate only). */
export function timelineEnd(model) {
  let end = 0;
  for (const c of model.timeline.clips) end = Math.max(end, clipEnd(c));
  for (const lane of model.timeline.automation) {
    for (const p of lane.points) end = Math.max(end, p.time);
  }
  return end;
}

/**
 * Pattern runs of a list of pattern clips (one track): sorted by start then id; each clip joins
 * the first open run that ends where it starts (within CONTIGUITY_TOLERANCE_S), else opens a
 * new run. Contiguous chains become one sequencer voice; overlaps become separate voices.
 */
export function patternRuns(clips) {
  const sorted = [...clips].sort((a, b) => a.start - b.start || (a.id < b.id ? -1
    : a.id > b.id ? 1 : 0));
  const runs = [];
  for (const c of sorted) {
    const run = runs.find((r) => Math.abs(clipEnd(r[r.length - 1]) - c.start)
      <= CONTIGUITY_TOLERANCE_S);
    if (run) run.push(c);
    else runs.push([c]);
  }
  return runs.sort((a, b) => a[0].start - b[0].start);
}

/** Rows of the timeline view: model tracks, then one automation row per lane. */
export function timelineRows(model, registry = NODE_REGISTRY) {
  const rows = model.timeline.tracks.map((t) => ({
    id: t.id, type: t.kind, name: t.name, target: t.target,
    clipIds: model.timeline.clips.filter((c) => c.trackId === t.id).map((c) => c.id),
  }));
  for (const lane of model.timeline.automation) {
    const node = model.graph.nodes.find((n) => n.id === lane.target.node);
    const p = node ? registry.param(node.type, lane.target.param) : null;
    rows.push({ id: lane.id, type: 'automation',
      name: `${node ? node.metadata.name : lane.target.node} ${p ? p.label : lane.target.param}`,
      target: lane.target.node, param: lane.target.param, laneId: lane.id });
  }
  return rows;
}

// ---------------------------------------------------------------- musical time (§90-§91)

/** Seconds per beat at `tempo` BPM. */
export function secondsPerBeat(tempo) {
  return 60 / tempo;
}

export function beatsToSeconds(beats, tempo) {
  return beats * 60 / tempo;
}

export function secondsToBeats(seconds, tempo) {
  return seconds * tempo / 60;
}

/** Seconds per bar: timeSignature[0] beats. */
export function secondsPerBar(transport) {
  return transport.timeSignature[0] * secondsPerBeat(transport.tempo);
}

/**
 * Musical position of a time: { bar, beat, fraction } with 1-based bar and beat (bar 1 beat 1 is
 * 0 s) and fraction in [0, 1) of the beat. Inverse: fromMusicalPosition.
 */
export function toMusicalPosition(seconds, transport) {
  const perBar = transport.timeSignature[0];
  const total = cleanTime(secondsToBeats(seconds, transport.tempo));
  const whole = Math.floor(total + 1e-9);
  return { bar: Math.floor(whole / perBar) + 1, beat: (whole % perBar) + 1,
    fraction: Math.max(0, cleanTime(total - whole)) };
}

export function fromMusicalPosition({ bar = 1, beat = 1, fraction = 0 }, transport) {
  const beats = (bar - 1) * transport.timeSignature[0] + (beat - 1) + fraction;
  return beatsToSeconds(beats, transport.tempo);
}

/** "3.2.500" (bar.beat.thousandths of a beat). */
export function formatMusicalPosition(seconds, transport) {
  const p = toMusicalPosition(seconds, transport);
  const thousandths = Math.min(999, Math.floor(p.fraction * 1000 + 1e-6));
  return `${p.bar}.${p.beat}.${String(thousandths).padStart(3, '0')}`;
}

/** "1.250 s" (milliseconds resolution, the seconds mode readout). */
export function formatSeconds(seconds) {
  return `${seconds.toFixed(3)} s`;
}

/** The clip linked to the tempo (beats from its seconds); measurement clips are refused. */
export function linkClipToTempo(clip, tempo) {
  if (clip.kind === 'measurement') {
    throw new RangeError('A measurement clip is always placed in seconds.');
  }
  return { ...clip, musical: { startBeats: cleanTime(secondsToBeats(clip.start, tempo)),
    durationBeats: cleanTime(secondsToBeats(clip.duration, tempo)) } };
}

/** The clip in absolute seconds (its current seconds kept). */
export function unlinkClip(clip) {
  if (!clip.musical) return clip;
  const out = { ...clip };
  delete out.musical;
  return out;
}

/**
 * Clips at a new tempo (the TRANSPORT_SET rule, for previews): tempo-linked clips keep their
 * beats and take new seconds; absolute clips are returned unchanged (same reference).
 */
export function clipsAtTempo(clips, tempo) {
  return clips.map((c) => (c.musical ? { ...c, start: beatsToSeconds(c.musical.startBeats, tempo),
    duration: beatsToSeconds(c.musical.durationBeats, tempo) } : c));
}

// ---------------------------------------------------------------- clip validation (§87)

/**
 * Duration bounds of a clip (s): { min, max }. All clips: MIN_CLIP_S and the timeline end;
 * pattern clips: the sequencer block type's duration bounds; measurement clips: the
 * measurement engine's limits for the action.
 */
export function clipDurationBounds(clip) {
  let min = MIN_CLIP_S;
  let max = TIMELINE_MAX_S - (finite(clip.start) ? clip.start : 0);
  if (clip.kind === 'pattern') {
    const s = BLOCK_SCHEMA[clip.payload && clip.payload.blockType];
    if (s) {
      min = Math.max(min, s.durationMs.min / 1000);
      max = Math.min(max, s.durationMs.max / 1000);
    }
  } else if (clip.kind === 'measurement') {
    const lim = MEASUREMENT_CLIP_LIMITS[clip.payload && clip.payload.action];
    if (lim) {
      min = Math.max(min, lim[0]);
      max = Math.min(max, lim[1]);
    }
  }
  return { min, max };
}

/**
 * The clip rule table (§87), ONE implementation for the store (validate.js validateStudioModel:
 * every action and every import) and the editor (validateClip): track and clip kind, start,
 * duration (MIN_CLIP_S and the timeline end, then clipDurationBounds: the pattern block's or the
 * measurement engine's limits), target, event and measurement actions, a measurement clip's
 * target type, a logarithmic stimulus sweep, and no musical time on a measurement clip. Returns
 * error diagnostics with paths relative to the clip. opts: { registry, trackById, nodeById }.
 */
export function clipRules(model, clip, { registry = NODE_REGISTRY, trackById = null,
  nodeById = null } = {}) {
  const errors = [];
  const err = (code, message, path, extra) => errors.push({ ...diag('error', code, message,
    path), ...extra });
  const track = trackById ? trackById.get(clip.trackId) : findTrack(model, clip.trackId);
  if (!track) err('missing-track', 'The clip is on a track that does not exist.', 'trackId');
  if (!CLIP_KINDS.includes(clip.kind)) {
    err('invalid-clip', `Clip kind must be one of ${CLIP_KINDS.join(', ')}.`, 'kind');
    return errors;
  }
  const allowed = track && TRACK_CLIP_KINDS[track.kind];
  if (allowed && !allowed.includes(clip.kind)) {
    err('clip-kind-mismatch', `A ${clip.kind} clip cannot go on a ${track.kind} track.`, 'kind');
  }
  const okStart = finite(clip.start) && clip.start >= 0 && clip.start <= TIMELINE_MAX_S;
  if (!okStart) {
    err('invalid-time', `Clip start must be between 0 and ${TIMELINE_MAX_S} s.`, 'start');
  }
  const { min, max } = clipDurationBounds(clip);
  if (!finite(clip.duration) || clip.duration < MIN_CLIP_S) {
    err('invalid-time', `Clip duration must be at least ${MIN_CLIP_S} s.`, 'duration');
  } else if (okStart && clip.start + clip.duration > TIMELINE_MAX_S) {
    err('invalid-time', `A clip must end by ${TIMELINE_MAX_S} s.`, 'duration');
  } else if (clip.duration < min - CONTIGUITY_TOLERANCE_S) {
    err('duration-bounds', `This clip must last at least ${min} s.`, 'duration');
  } else if (clip.duration > max + CONTIGUITY_TOLERANCE_S) {
    err('duration-bounds', `This clip may last at most ${cleanTime(max)} s.`, 'duration');
  }
  if (clip.musical && clip.kind === 'measurement') {
    err('musical-measurement', 'A measurement clip is always placed in seconds; musical time '
      + 'never enters a measurement experiment.', 'musical');
  }
  const targetId = clip.target ?? (track ? track.target : null);
  const node = targetId == null ? null
    : (nodeById ? nodeById.get(targetId) : model.graph.nodes.find((n) => n.id === targetId));
  if (targetId != null && !node) {
    err('missing-node', 'The clip targets a node that does not exist.', 'target');
  }
  // Target and action: the one clip-target policy (clip-targets.js, R7).
  for (const e of clipTarget(node || null, clipUse(clip), registry).errors) {
    err(e.code, e.message, e.path, e.nodeId ? { nodeId: e.nodeId } : undefined);
  }
  return errors;
}

/**
 * Editor-level validation of one clip in `model` (it may be a proposed clip not yet in the
 * model): the errors are clipRules, exactly what the store refuses; warnings do not block
 * (overlap plays as a second voice; a stimulus shorter than its sweep makes the measurement
 * refuse to start).
 */
export function validateClip(model, clip, registry = NODE_REGISTRY) {
  const errors = clipRules(model, clip, { registry });
  const warnings = [];
  const track = findTrack(model, clip.trackId);
  const targetId = track ? effectiveTarget(model, clip) : clip.target;
  const node = targetId ? model.graph.nodes.find((n) => n.id === targetId) : null;
  if (clip.kind === 'measurement' && node && node.type === 'sweep'
    && clip.payload && clip.payload.action === 'stimulus' && finite(clip.duration)
    && clip.duration + CONTIGUITY_TOLERANCE_S < node.params.duration) {
    warnings.push(diag('warning', 'stimulus-truncated', `The clip is shorter than the `
      + `${node.params.duration} s sweep; the measurement plays the whole sweep, so it will `
      + 'refuse to start until they match.', 'duration'));
  }
  if (clip.kind === 'pattern' && track && finite(clip.start) && finite(clip.duration)) {
    const others = overlappingClips(model, track.id, clip.start, clipEnd(clip), clip.id);
    if (others.length) {
      warnings.push(diag('warning', 'clip-overlap', `The clip overlaps ${others.length} other `
        + 'pattern clip(s) on this track; they play as separate voices.', 'start'));
    }
  }
  return { ok: errors.length === 0, errors, warnings };
}

// ---------------------------------------------------------------- snap (§92)

/** Merge a partial snap setting with the defaults. */
export function resolveSnap(snap) {
  const s = { ...DEFAULT_SNAP, ...(snap || {}) };
  if (!SNAP_MODES.includes(s.mode)) s.mode = 'off';
  return s;
}

/** Nearest multiple of `step` (s), cleaned to a nanosecond. */
export function snapToGrid(t, step) {
  if (!(step > 0)) return t;
  return cleanTime(Math.round(t / step) * step);
}

/**
 * Snap a time (s). context: { transport, markers, loop, clipKind }.
 *   off      unchanged
 *   time     nearest multiple of gridS
 *   musical  nearest multiple of beatsPerStep beats at the transport tempo; a measurement clip
 *            falls back to the time grid (musical time never enters a measurement)
 *   markers  nearest marker or loop bound within thresholdS, else unchanged
 * The result is never negative.
 */
export function snapTime(t, snap, context = {}) {
  const s = resolveSnap(snap);
  if (!finite(t)) return t;
  let out = t;
  if (s.mode === 'time' || (s.mode === 'musical' && context.clipKind === 'measurement')) {
    out = snapToGrid(t, s.gridS);
  } else if (s.mode === 'musical') {
    const tr = context.transport;
    out = tr ? snapToGrid(t, beatsToSeconds(s.beatsPerStep, tr.tempo)) : t;
  } else if (s.mode === 'markers') {
    const anchors = snapAnchors(context);
    let best = null;
    for (const a of anchors) {
      const d = Math.abs(a - t);
      if (d <= s.thresholdS && (best === null || d < Math.abs(best - t))) best = a;
    }
    out = best === null ? t : best;
  }
  return Math.max(0, out);
}

function snapAnchors(context) {
  const anchors = (context.markers || []).map((m) => m.time);
  if (context.loop && context.loop.enabled) anchors.push(context.loop.start, context.loop.end);
  return anchors;
}

/** Grid line times in [from, to] for the active snap mode (empty for off and markers). */
export function snapGridLines(from, to, snap, transport, maxLines = 2000) {
  const s = resolveSnap(snap);
  let step = 0;
  if (s.mode === 'time') step = s.gridS;
  else if (s.mode === 'musical' && transport) {
    step = beatsToSeconds(s.beatsPerStep, transport.tempo);
  }
  if (!(step > 0) || !(to >= from)) return [];
  const out = [];
  for (let k = Math.ceil(from / step - 1e-9); k * step <= to + 1e-9 && out.length < maxLines;
    k++) out.push(cleanTime(k * step));
  return out;
}

/** Snap the edge (start or end) of a moving clip that lands closer to an anchor (§86). */
function snapClipStart(start, duration, snap, context) {
  const s = resolveSnap(snap);
  if (s.mode === 'off') return start;
  const a = snapTime(start, s, context);
  if (s.mode !== 'markers') return a;
  const b = snapTime(start + duration, s, context) - duration;
  const da = Math.abs(a - start);
  const db = Math.abs(b - start);
  if (a === start && b === start) return start;
  if (a === start) return Math.max(0, b);
  if (b === start) return a;
  return da <= db ? a : Math.max(0, b);
}

// ---------------------------------------------------------------- clip gestures (§86-§88, §141)

function snapContext(model, clip) {
  return { transport: model.transport, markers: model.timeline.markers, loop: model.timeline.loop,
    clipKind: clip.kind };
}

function canHostClip(model, track, clip, registry) {
  if (!track) return 'There is no such track.';
  if (!TRACK_CLIP_KINDS[track.kind].includes(clip.kind)) {
    return `A ${clip.kind} clip cannot go on a ${track.kind} track.`;
  }
  if (clip.target === null && track.target) {
    const node = model.graph.nodes.find((n) => n.id === track.target);
    const v = node ? clipTarget(node, clipUse(clip), registry) : null;
    const no = v && v.errors.find((e) => e.code === 'invalid-clip-target');
    if (no) return no.message;
  }
  return null;
}

/**
 * Result of dragging a clip (§86): horizontal = time, vertical = a compatible track, snapped.
 * opts: { start | deltaS, trackId?, snap? }. Returns { ok, start, trackId, action, warnings,
 * reason? }; `action` is the CLIP_MOVE to dispatch at gesture end (null when nothing changes).
 */
export function moveClipResult(model, clipId, opts = {}, registry = NODE_REGISTRY) {
  const clip = findClip(model, clipId);
  if (!clip) return { ok: false, reason: `There is no clip "${String(clipId)}".`, action: null };
  const trackId = opts.trackId ?? clip.trackId;
  const track = findTrack(model, trackId);
  const why = canHostClip(model, track, clip, registry);
  if (why) return { ok: false, reason: why, action: null, start: clip.start, trackId };
  let start = finite(opts.start) ? opts.start
    : clip.start + (finite(opts.deltaS) ? opts.deltaS : 0);
  start = snapClipStart(start, clip.duration, opts.snap, snapContext(model, clip));
  start = cleanTime(clamp(start, 0, TIMELINE_MAX_S - clip.duration));
  const proposed = { ...clip, start, trackId };
  const report = validateClip(model, proposed, registry);
  if (!report.ok) {
    return { ok: false, reason: report.errors[0].message, action: null, start, trackId,
      warnings: report.warnings };
  }
  const changed = start !== clip.start || trackId !== clip.trackId;
  return { ok: true, start, trackId, warnings: report.warnings,
    action: changed ? { type: 'CLIP_MOVE', clipId, start, trackId } : null };
}

/**
 * Result of dragging a clip edge (§87). opts: { edge: 'start'|'end', time, snap? }. The moving
 * edge is snapped, then clamped so the duration stays inside clipDurationBounds (clamped: true
 * and `reason` say so). The opposite edge never moves. Returns { ok, start, duration, clamped,
 * action, warnings, reason? } with a CLIP_RESIZE action.
 */
export function resizeClipResult(model, clipId, opts = {}, registry = NODE_REGISTRY) {
  const clip = findClip(model, clipId);
  if (!clip) return { ok: false, reason: `There is no clip "${String(clipId)}".`, action: null };
  if (!finite(opts.time)) return { ok: false, reason: 'A resize needs a time.', action: null };
  const ctx = snapContext(model, clip);
  const edge = opts.edge === 'start' ? 'start' : 'end';
  const end = clipEnd(clip);
  let start = clip.start;
  let duration = clip.duration;
  let clamped = false;
  if (edge === 'end') {
    const { min, max } = clipDurationBounds(clip);
    const want = snapTime(opts.time, opts.snap, ctx) - clip.start;
    duration = clamp(want, min, max);
    clamped = Math.abs(duration - want) > CONTIGUITY_TOLERANCE_S;
  } else {
    const { min, max } = clipDurationBounds({ ...clip, start: 0 });
    const want = snapTime(opts.time, opts.snap, ctx);
    start = clamp(want, Math.max(0, end - max), end - min);
    clamped = Math.abs(start - want) > CONTIGUITY_TOLERANCE_S;
    duration = end - start;
  }
  start = cleanTime(start);
  duration = cleanTime(duration);
  const bounds = clipDurationBounds({ ...clip, start });
  const reason = clamped
    ? `Duration limited to ${cleanTime(bounds.min)}-${cleanTime(bounds.max)} s.` : undefined;
  const report = validateClip(model, { ...clip, start, duration }, registry);
  if (!report.ok) {
    return { ok: false, reason: report.errors[0].message, action: null, start, duration, clamped,
      warnings: report.warnings };
  }
  const changed = start !== clip.start || duration !== clip.duration;
  return { ok: true, start, duration, clamped, reason, warnings: report.warnings,
    action: changed ? { type: 'CLIP_RESIZE', clipId, start, duration } : null };
}

/**
 * Where a duplicate (§88, Cmd/Ctrl+D) goes: right after the clip on the same track; a pattern
 * clip skips forward past pattern clips that would overlap it. Returns { ok, start, trackId,
 * action } with a DUPLICATE action carrying the placement (new id, same payload).
 */
export function duplicateClipPlacement(model, clipId) {
  const clip = findClip(model, clipId);
  if (!clip) return { ok: false, reason: `There is no clip "${String(clipId)}".`, action: null };
  let start = clipEnd(clip);
  if (clip.kind === 'pattern') {
    for (let guard = 0; guard < model.timeline.clips.length + 1; guard++) {
      const block = overlappingClips(model, clip.trackId, start, start + clip.duration, null);
      if (!block.length) break;
      start = Math.max(...block.map(clipEnd));
    }
  }
  start = cleanTime(start);
  if (start + clip.duration > TIMELINE_MAX_S) {
    return { ok: false, reason: `There is no room before ${TIMELINE_MAX_S} s.`, action: null };
  }
  return { ok: true, start, trackId: clip.trackId, action: { type: 'DUPLICATE',
    clipIds: [clipId], placements: { [clipId]: { start, trackId: clip.trackId } } } };
}

/**
 * Keyboard alternative to dragging (§141): move by one snap step (time grid, musical grid, or
 * gridS when snap is off or markers), direction -1 / +1; `trackDelta` moves to the previous /
 * next compatible track.
 */
export function nudgeClipResult(model, clipId, { direction = 1, trackDelta = 0, snap } = {},
  registry = NODE_REGISTRY) {
  const clip = findClip(model, clipId);
  if (!clip) return { ok: false, reason: `There is no clip "${String(clipId)}".`, action: null };
  const s = resolveSnap(snap);
  const step = s.mode === 'musical' && clip.kind !== 'measurement'
    ? beatsToSeconds(s.beatsPerStep, model.transport.tempo) : s.gridS;
  let trackId = clip.trackId;
  if (trackDelta) {
    const tracks = model.timeline.tracks;
    let i = tracks.findIndex((t) => t.id === clip.trackId);
    for (i += Math.sign(trackDelta); i >= 0 && i < tracks.length; i += Math.sign(trackDelta)) {
      if (!canHostClip(model, tracks[i], clip, registry)) {
        trackId = tracks[i].id;
        break;
      }
    }
  }
  const start = direction ? snapToGrid(clip.start + Math.sign(direction) * step, step)
    : clip.start;
  return moveClipResult(model, clipId, { start, trackId, snap: { mode: 'off' } }, registry);
}

// ---------------------------------------------------------------- loop region (§95)

/**
 * Loop bounds from two times: ordered, clamped to [0, TIMELINE_MAX_S] and at least MIN_LOOP_S
 * long (the end moves; at the timeline end the start moves).
 */
export function normalizeLoopBounds(a, b) {
  let start = clamp(Math.min(a, b), 0, TIMELINE_MAX_S);
  let end = clamp(Math.max(a, b), 0, TIMELINE_MAX_S);
  if (end - start < MIN_LOOP_S) {
    end = start + MIN_LOOP_S;
    if (end > TIMELINE_MAX_S) {
      end = TIMELINE_MAX_S;
      start = end - MIN_LOOP_S;
    }
  }
  return { start: cleanTime(start), end: cleanTime(end) };
}

/**
 * Result of dragging a loop bound (edge 'start' | 'end') or the whole region ('move', time =
 * new start). Snapped; the other bound stays unless they would cross. Returns { loop, action }.
 */
export function loopEdgeResult(model, edge, time, snap) {
  const cur = model.timeline.loop;
  const t = snapTime(time, snap, { transport: model.transport, markers: model.timeline.markers });
  let bounds;
  if (edge === 'move') {
    const len = cur.end - cur.start;
    const start = clamp(t, 0, TIMELINE_MAX_S - len);
    bounds = { start: cleanTime(start), end: cleanTime(start + len) };
  } else if (edge === 'start') {
    bounds = normalizeLoopBounds(Math.min(t, cur.end - MIN_LOOP_S), cur.end);
  } else {
    bounds = normalizeLoopBounds(cur.start, Math.max(t, cur.start + MIN_LOOP_S));
  }
  const loop = { enabled: cur.enabled, ...bounds };
  const changed = loop.start !== cur.start || loop.end !== cur.end;
  return { loop, action: changed ? { type: 'LOOP_SET', start: loop.start, end: loop.end } : null };
}

/** Loop bounds that cover a set of clips (e.g. the selection). Null for no clips. */
export function loopAroundClips(model, clipIds) {
  const clips = model.timeline.clips.filter((c) => clipIds.includes(c.id));
  if (!clips.length) return null;
  return normalizeLoopBounds(Math.min(...clips.map((c) => c.start)),
    Math.max(...clips.map(clipEnd)));
}

// ---------------------------------------------------------------- markers (§96)

/** Markers sorted by time (then id). */
export function sortedMarkers(model) {
  return [...model.timeline.markers].sort((a, b) => a.time - b.time
    || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/** The next (direction +1) or previous (-1) marker strictly after / before t, or null. */
export function adjacentMarker(model, t, direction = 1) {
  const list = sortedMarkers(model);
  if (direction >= 0) return list.find((m) => m.time > t + CONTIGUITY_TOLERANCE_S) || null;
  for (let i = list.length - 1; i >= 0; i--) {
    if (list[i].time < t - CONTIGUITY_TOLERANCE_S) return list[i];
  }
  return null;
}

/** MARKER_ADD action for a marker kind at a (snapped) time, with the kind's default label. */
export function addMarkerAction(model, kind, time, snap) {
  if (!MARKER_KINDS.includes(kind)) return null;
  const t = clamp(snapTime(time, snap, { transport: model.transport }), 0, TIMELINE_MAX_S);
  return { type: 'MARKER_ADD', kind, time: cleanTime(t), label: MARKER_LABELS[kind] };
}

/** MARKER_MOVE action for a marker drag (snapped to the grid, never to markers). */
export function moveMarkerAction(model, markerId, time, snap) {
  const m = model.timeline.markers.find((x) => x.id === markerId);
  if (!m) return null;
  const s = resolveSnap(snap);
  const t = clamp(s.mode === 'markers' ? time : snapTime(time, s, { transport: model.transport }),
    0, TIMELINE_MAX_S);
  return cleanTime(t) === m.time ? null : { type: 'MARKER_MOVE', markerId, time: cleanTime(t) };
}

/** Model track kinds (re-exported for editors). */
export { TRACK_KINDS };
