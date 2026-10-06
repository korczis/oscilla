// Studio timeline view helpers (spec §81-§96, §129, §141; plan V417, V418). Pure: plain data in,
// plain data out; no DOM, no Web Audio, no clock. The editor (timeline-editor.js) renders what
// these return and dispatches the actions they build; the semantics (validation, snap, gestures,
// loop, markers) stay in src/js/studio/timeline.js and are never re-implemented here.
//
// View state (§89, §253): pixels per second and horizontal scroll are the editor's; model times
// are absolute seconds. Everything here converts between the two or describes model objects in
// words for the screen and for screen readers (§143: names, kinds, times; never coordinates).

import { BLOCK_SCHEMA, BLOCK_TYPES, describeBlock } from '../../sequencer/model.js';
import { clipTarget } from '../../studio/clip-targets.js';
import { NODE_REGISTRY } from '../../studio/registry.js';
import {
  MEASUREMENT_ACTIONS, TIMELINE_MAX_S, TRACK_CLIP_KINDS,
} from '../../studio/schema.js';
import {
  EVENT_ACTIONS, MARKER_LABELS, beatsToSeconds, clipDurationBounds, clipEnd, cleanTime,
  effectiveTarget, findClip, formatMusicalPosition, resolveSnap, secondsPerBar, secondsPerBeat,
  timelineEnd, validateClip,
} from '../../studio/timeline.js';
import { truncatePatternPayload } from '../../studio/timeline-compiler.js';
import { clipPlayReason } from '../../studio/transport.js';

// ---------------------------------------------------------------- constants

/** Timeline zoom (px per second): bounds and the factor of one zoom step. */
export const TIMELINE_ZOOM = Object.freeze({ min: 4, max: 4000, factor: 1.25 });
/** Seconds kept visible after the last executable item (room to place the next clip). */
export const CONTENT_TAIL_S = 2;
/** Minimum distance between two labelled ruler ticks (px). */
export const RULER_LABEL_PX = 64;
/** Candidate ruler steps (s), finest first. */
export const RULER_STEPS_S = Object.freeze([0.001, 0.002, 0.005, 0.01, 0.02, 0.05, 0.1, 0.2,
  0.25, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600]);
/** Default duration (s) of a clip the editor adds, per kind / measurement action. */
export const NEW_CLIP_DURATION_S = Object.freeze({ pattern: 1, event: 0.5, measurement: 0.5 });
/** The editor's initial snap: the 0.1 s time grid (the pure layer's default is off). */
export const EDITOR_DEFAULT_SNAP = Object.freeze({ mode: 'time', gridS: 0.1, beatsPerStep: 1,
  thresholdS: 0.05 });

/**
 * Snap choices of the editor's menu (§92: off, time grid, musical grid, markers). `id` is the
 * value of the <select>; `snap` the setting passed to timeline.js.
 */
export const SNAP_CHOICES = Object.freeze([
  { id: 'off', label: 'Snap off', snap: { mode: 'off' } },
  { id: 'time-0.01', label: 'Grid 10 ms', snap: { mode: 'time', gridS: 0.01 } },
  { id: 'time-0.05', label: 'Grid 50 ms', snap: { mode: 'time', gridS: 0.05 } },
  { id: 'time-0.1', label: 'Grid 0.1 s', snap: { mode: 'time', gridS: 0.1 } },
  { id: 'time-0.25', label: 'Grid 0.25 s', snap: { mode: 'time', gridS: 0.25 } },
  { id: 'time-0.5', label: 'Grid 0.5 s', snap: { mode: 'time', gridS: 0.5 } },
  { id: 'time-1', label: 'Grid 1 s', snap: { mode: 'time', gridS: 1 } },
  { id: 'beat-0.25', label: '1/4 beat', snap: { mode: 'musical', beatsPerStep: 0.25 } },
  { id: 'beat-0.5', label: '1/2 beat', snap: { mode: 'musical', beatsPerStep: 0.5 } },
  { id: 'beat-1', label: 'Beat', snap: { mode: 'musical', beatsPerStep: 1 } },
  { id: 'bar', label: 'Bar', snap: { mode: 'musical', beatsPerStep: 'bar' } },
  { id: 'markers', label: 'Markers', snap: { mode: 'markers' } },
].map((c) => Object.freeze({ ...c, snap: Object.freeze(c.snap) })));

const finite = (v) => typeof v === 'number' && Number.isFinite(v);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

// ---------------------------------------------------------------- snap choices

/**
 * The timeline.js snap setting of a menu choice at the current transport ('bar' resolves to the
 * time signature's beats per bar). The marker threshold is `thresholdPx` / px per second.
 */
export function snapForChoice(id, { transport, pxPerSecond = 100, thresholdPx = 8 } = {}) {
  const c = SNAP_CHOICES.find((x) => x.id === id) || SNAP_CHOICES[0];
  const s = { ...c.snap };
  if (s.beatsPerStep === 'bar') s.beatsPerStep = transport ? transport.timeSignature[0] : 4;
  return resolveSnap({ ...s, thresholdS: thresholdPx / Math.max(1e-9, pxPerSecond) });
}

/** The menu id of a snap setting (the closest choice; 'off' when nothing matches). */
export function choiceForSnap(snap, transport) {
  const s = resolveSnap(snap);
  if (s.mode === 'markers') return 'markers';
  if (s.mode === 'time') {
    const c = SNAP_CHOICES.find((x) => x.snap.mode === 'time'
      && Math.abs(x.snap.gridS - s.gridS) < 1e-9);
    return c ? c.id : 'time-0.1';
  }
  if (s.mode === 'musical') {
    if (transport && s.beatsPerStep === transport.timeSignature[0]) return 'bar';
    const c = SNAP_CHOICES.find((x) => x.snap.mode === 'musical'
      && x.snap.beatsPerStep === s.beatsPerStep);
    return c ? c.id : 'beat-1';
  }
  return 'off';
}

/**
 * The keyboard step (s) of a snap setting: the time grid, the musical grid at the tempo (a
 * measurement clip keeps the time grid, §90), or gridS when snap is off or markers — the same
 * rule as timeline.js nudgeClipResult. `fine` divides it by ten (Shift).
 */
export function keyboardStepS(snap, transport, { clipKind = null, fine = false } = {}) {
  const s = resolveSnap(snap);
  const step = s.mode === 'musical' && clipKind !== 'measurement' && transport
    ? beatsToSeconds(s.beatsPerStep, transport.tempo) : s.gridS;
  return fine ? step / 10 : step;
}

// ---------------------------------------------------------------- scale and scroll

/** pxPerSecond clamped to TIMELINE_ZOOM. */
export function clampZoom(pxPerSecond) {
  return clamp(finite(pxPerSecond) && pxPerSecond > 0 ? pxPerSecond : 100, TIMELINE_ZOOM.min,
    TIMELINE_ZOOM.max);
}

/**
 * Zoom by `steps` (positive = in) keeping the time under `anchorPx` (px from the left edge of the
 * visible area) where it is. Returns { pxPerSecond, scrollX }.
 */
export function zoomAround({ pxPerSecond, scrollX }, steps, anchorPx = 0) {
  const next = clampZoom(pxPerSecond * Math.pow(TIMELINE_ZOOM.factor, steps));
  const t = (scrollX + anchorPx) / pxPerSecond;
  return { pxPerSecond: next, scrollX: Math.max(0, t * next - anchorPx) };
}

/** The scale that shows [0, spanS] in `widthPx` (Fit). */
export function fitZoom(spanS, widthPx) {
  return clampZoom(Math.max(1, widthPx - 16) / Math.max(0.1, spanS));
}

/** Seconds the content area spans: everything authored, plus room to work. */
export function contentSpanS(model, visibleS = 0) {
  const t = model.timeline;
  let end = timelineEnd(model);
  for (const m of t.markers) end = Math.max(end, m.time);
  end = Math.max(end, t.loop.end);
  return Math.min(TIMELINE_MAX_S, Math.max(end + CONTENT_TAIL_S, visibleS));
}

/** Timeline seconds at content x (px) — clamped to the timeline. */
export function xToTime(x, pxPerSecond) {
  return clamp(x / pxPerSecond, 0, TIMELINE_MAX_S);
}

/** Content x (px) of timeline seconds. */
export function timeToX(t, pxPerSecond) {
  return t * pxPerSecond;
}

/** Visible time range of a scroll area: { from, to } in seconds. */
export function visibleRange(scrollX, widthPx, pxPerSecond) {
  return { from: Math.max(0, scrollX / pxPerSecond), to: (scrollX + widthPx) / pxPerSecond };
}

/**
 * Scroll that keeps a playing playhead in view (§94 follow): null while it is inside
 * [scrollX + margin, scrollX + width − margin], else a scroll putting it a tenth into the view.
 */
export function followScroll(x, scrollX, widthPx, marginPx = 24) {
  if (!(widthPx > 0)) return null;
  if (x >= scrollX + Math.min(marginPx, widthPx / 4)
    && x <= scrollX + widthPx - Math.min(marginPx, widthPx / 4)) return null;
  return Math.max(0, x - widthPx * 0.1);
}

// ---------------------------------------------------------------- time readouts

/** "01:04.210": minutes, seconds and milliseconds (the transport clock, §127). */
export function formatClock(seconds) {
  const s = Math.max(0, finite(seconds) ? seconds : 0);
  const ms = Math.floor(s * 1000 + 1e-6);
  const m = Math.floor(ms / 60000);
  const rest = ms - m * 60000;
  const sec = Math.floor(rest / 1000);
  return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}.`
    + `${String(rest % 1000).padStart(3, '0')}`;
}

/** The transport readout in the model's time mode: clock (seconds) or bar.beat.thousandths. */
export function formatTransportTime(seconds, transport) {
  return transport && transport.timeMode === 'musical'
    ? formatMusicalPosition(Math.max(0, seconds), transport) : formatClock(seconds);
}

/** "1.250 s" for fields and announcements (millisecond resolution). */
export function formatSecondsText(seconds) {
  return `${(finite(seconds) ? seconds : 0).toFixed(3)} s`;
}

/** A time in the model's mode for words: "1.250 s" or "bar 2 beat 1 (1.250 s)". */
export function describeTime(seconds, transport) {
  if (transport && transport.timeMode === 'musical') {
    const [bar, beat] = formatMusicalPosition(seconds, transport).split('.');
    return `bar ${bar} beat ${beat} (${formatSecondsText(seconds)})`;
  }
  return formatSecondsText(seconds);
}

// ---------------------------------------------------------------- ruler (§89-§91)

function secondsLabel(t, step) {
  const digits = step >= 1 ? 0 : step >= 0.1 ? 1 : step >= 0.01 ? 2 : 3;
  if (t >= 60 && step >= 1) {
    const m = Math.floor(t / 60);
    return `${m}:${String(Math.round(t - m * 60)).padStart(2, '0')}`;
  }
  return `${t.toFixed(digits)}s`;
}

/**
 * Ruler ticks for [from, to] (s): [{ t, major, label }]; labelled (major) ticks are at least
 * `minLabelPx` apart, minor ticks subdivide them. Seconds mode: a 1-2-5 step; musical mode
 * (§90): bars, beats and sixteenths at the tempo, labelled "bar" or "bar.beat".
 */
export function rulerTicks({ from, to, pxPerSecond, transport = null, minLabelPx = RULER_LABEL_PX,
  maxTicks = 600 } = {}) {
  if (!(to > from) || !(pxPerSecond > 0)) return [];
  const out = [];
  if (transport && transport.timeMode === 'musical') {
    const beat = secondsPerBeat(transport.tempo);
    const perBar = transport.timeSignature[0];
    const bar = secondsPerBar(transport);
    // Label every beat when beats are wide enough, else every n bars.
    let labelStep;
    let labelBeats;
    if (beat * pxPerSecond >= minLabelPx) {
      labelStep = beat;
      labelBeats = 1;
    } else {
      let bars = 1;
      while (bars * bar * pxPerSecond < minLabelPx && bars < 4096) bars *= 2;
      labelStep = bars * bar;
      labelBeats = bars * perBar;
    }
    const minorStep = labelBeats === 1 ? (beat / 4 * pxPerSecond >= 10 ? beat / 4 : beat)
      : (beat * pxPerSecond >= 8 ? beat : labelStep / 4 * pxPerSecond >= 8 ? labelStep / 4
        : labelStep);
    const k0 = Math.max(0, Math.ceil(from / minorStep - 1e-9));
    for (let k = k0; k * minorStep <= to + 1e-9 && out.length < maxTicks; k++) {
      const t = cleanTime(k * minorStep);
      const beats = Math.round(t / beat * 1e6) / 1e6;
      const major = Math.abs(beats / labelBeats - Math.round(beats / labelBeats)) < 1e-6;
      let label = '';
      if (major) {
        const whole = Math.round(beats);
        const b = Math.floor(whole / perBar) + 1;
        const bt = (whole % perBar) + 1;
        label = labelBeats === 1 && bt !== 1 ? `${b}.${bt}` : String(b);
      }
      out.push({ t, major, label });
    }
    return out;
  }
  const step = RULER_STEPS_S.find((s) => s * pxPerSecond >= minLabelPx)
    || RULER_STEPS_S[RULER_STEPS_S.length - 1];
  const sub = String(step)[0] === '2' ? 4 : 5;
  const minor = step / sub * pxPerSecond >= 6 ? step / sub : step;
  const k0 = Math.max(0, Math.ceil(from / minor - 1e-9));
  for (let k = k0; k * minor <= to + 1e-9 && out.length < maxTicks; k++) {
    const t = cleanTime(k * minor);
    const major = Math.abs(t / step - Math.round(t / step)) < 1e-6;
    out.push({ t, major, label: major ? secondsLabel(t, step) : '' });
  }
  return out;
}

// ---------------------------------------------------------------- descriptions (§143)

function nodeOf(model, id) {
  return id ? model.graph.nodes.find((n) => n.id === id) || null : null;
}

/** Display name of a node id ("—" for none). */
export function nodeName(model, id) {
  const n = nodeOf(model, id);
  return n ? n.metadata.name : (id ? String(id) : '—');
}

const KIND_LABEL = Object.freeze({ pattern: 'Pattern', event: 'Event',
  measurement: 'Measurement' });
const TRACK_LABEL = Object.freeze({ event: 'Event', measurement: 'Measurement' });
const MEASUREMENT_LABEL = Object.freeze({ 'noise-check': 'Noise check', 'pre-roll': 'Pre-roll',
  stimulus: 'Stimulus', capture: 'Capture', tail: 'Tail', analysis: 'Analysis' });

/** { label, detail } of a clip (pattern: the sequencer's own block description). */
export function clipText(clip) {
  if (clip.kind === 'pattern') {
    return describeBlock({ type: clip.payload.blockType, params: clip.payload.params });
  }
  if (clip.kind === 'event') {
    const a = clip.payload.action || 'gate';
    return { label: a === 'trigger' ? 'Trigger' : 'Gate', detail: '' };
  }
  return { label: MEASUREMENT_LABEL[clip.payload.action] || 'Measurement', detail: '' };
}

/** CSS modifier classes of a clip: pattern clips reuse the sequencer's block colours. */
export function clipClass(clip) {
  if (clip.kind === 'pattern') {
    const t = BLOCK_TYPES.includes(clip.payload.blockType) ? clip.payload.blockType : 'silence';
    return `osc-block--${t}`;
  }
  return `osc-stl-clip--${clip.kind}`;
}

/**
 * Everything the editor shows about a clip: text, CSS class, problems (editor validation and
 * what the transport would not play), the screen-reader label. Never coordinates.
 */
export function clipView(model, clip, { selected = false, registry = NODE_REGISTRY } = {}) {
  const { label, detail } = clipText(clip);
  const report = validateClip(model, clip, registry);
  const unplayed = clipPlayReason(model, clip);
  const track = model.timeline.tracks.find((t) => t.id === clip.trackId);
  const problems = [...report.errors, ...report.warnings].map((d) => d.message);
  if (unplayed) problems.push(unplayed);
  const linked = clip.musical ? ', tempo-linked' : '';
  const time = `${describeTime(clip.start, model.transport)} to `
    + `${describeTime(clipEnd(clip), model.transport)}`;
  const aria = `${KIND_LABEL[clip.kind] || 'Clip'} clip ${label}${detail ? ` ${detail}` : ''}`
    + ` on ${track ? track.name : 'no track'}, ${time}${linked}`
    + `${problems.length ? `, ${problems.length} problem${problems.length > 1 ? 's' : ''}` : ''}`
    + `${selected ? ', selected' : ''}`;
  return { id: clip.id, kind: clip.kind, label, detail, cls: clipClass(clip), start: clip.start,
    end: clipEnd(clip), duration: clip.duration, linked: !!clip.musical, problems,
    target: effectiveTarget(model, clip), aria,
    title: `${label}${detail ? ` ${detail}` : ''} · ${formatSecondsText(clip.duration)}`
      + `${problems.length ? ` · ${problems.join(' ')}` : ''}` };
}

/** Track header text: { name, kind, kindLabel, targetName, clipCount, aria }. */
export function trackView(model, track) {
  const count = model.timeline.clips.filter((c) => c.trackId === track.id).length;
  const targetName = track.target ? nodeName(model, track.target) : 'no target';
  return { id: track.id, name: track.name, kind: track.kind,
    kindLabel: TRACK_LABEL[track.kind] || track.kind, targetName, clipCount: count,
    aria: `${track.name}, ${(TRACK_LABEL[track.kind] || track.kind).toLowerCase()} track, `
      + `target ${targetName}, ${count} clip${count === 1 ? '' : 's'}` };
}

/** "Sweep marker at 1.000 s" (a marker's own label when it differs from its kind's). */
export function markerAria(marker, transport) {
  const kind = MARKER_LABELS[marker.kind] || 'Marker';
  const label = marker.label && marker.label !== kind ? ` "${marker.label}"` : '';
  return `${kind} marker${label} at ${describeTime(marker.time, transport)}`;
}

/** Clips in reading order: track order, then start, then id (keyboard and focus order). */
export function clipOrder(model) {
  const idx = new Map(model.timeline.tracks.map((t, i) => [t.id, i]));
  return [...model.timeline.clips].sort((a, b) => (idx.get(a.trackId) ?? 1e9)
    - (idx.get(b.trackId) ?? 1e9) || a.start - b.start || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/**
 * Where focus goes after deleting `ids` (§142): the next remaining clip on the same track, else
 * the previous one there, else the next / previous clip anywhere, else null.
 */
export function focusAfterDelete(model, ids) {
  const gone = new Set(ids);
  const order = clipOrder(model);
  const first = order.findIndex((c) => gone.has(c.id));
  if (first < 0) return null;
  const track = order[first].trackId;
  const rest = order.map((c, i) => ({ c, i })).filter((x) => !gone.has(x.c.id));
  const same = rest.filter((x) => x.c.trackId === track);
  const pick = same.find((x) => x.i > first) || [...same].reverse().find((x) => x.i < first)
    || rest.find((x) => x.i > first) || [...rest].reverse().find((x) => x.i < first);
  return pick ? pick.c.id : null;
}

// ---------------------------------------------------------------- clip creation and split

/** Every clip use of a kind: its actions (a pattern clip has none). */
function usesOf(kind) {
  if (kind === 'event') return EVENT_ACTIONS.map((action) => ({ kind, action }));
  if (kind === 'measurement') return MEASUREMENT_ACTIONS.map((action) => ({ kind, action }));
  return [{ kind }];
}

/**
 * Node ids that can be a track's target: nodes on which the transport plays some clip the track
 * holds (clip-targets.js, R7).
 */
export function trackTargetOptions(model, kind, registry = NODE_REGISTRY) {
  const uses = (TRACK_CLIP_KINDS[kind] || []).flatMap(usesOf);
  return model.graph.nodes.filter((n) => uses.some((u) => clipTarget(n, u, registry).plays))
    .map((n) => ({ id: n.id, name: n.metadata.name }));
}

/**
 * Nodes a clip of `kind` may target (its own target overriding the track's): those on which the
 * transport plays it, for its `action` when given, else for any action of the kind
 * (clip-targets.js, R7).
 */
export function clipTargetOptions(model, kind, registry = NODE_REGISTRY, action = undefined) {
  const uses = action === undefined ? usesOf(kind) : [{ kind, action }];
  return model.graph.nodes.filter((n) => uses.some((u) => clipTarget(n, u, registry).plays))
    .map((n) => ({ id: n.id, name: n.metadata.name }));
}

/** Tracks a clip may move to (§86 vertical: a compatible track). */
export function compatibleTracks(model, clip) {
  return model.timeline.tracks.filter((t) => (TRACK_CLIP_KINDS[t.kind] || []).includes(clip.kind))
    .map((t) => ({ id: t.id, name: t.name }));
}

/**
 * The CLIP_ADD the editor dispatches to add a clip on a track at `time` (§84): a pattern clip
 * (Tone) when the track's target plays patterns or has none, else a gate event when it plays
 * gates, else the reason why nothing would play there; a measurement track gets a pre-roll step
 * (it needs no particular target). The start is clamped so the clip fits the timeline. Returns
 * { action } or { reason }.
 */
export function addClipAction(model, trackId, time, registry = NODE_REGISTRY) {
  const track = model.timeline.tracks.find((t) => t.id === trackId);
  if (!track) return { reason: 'There is no such track.' };
  let kind;
  let payload;
  if (track.kind === 'measurement') {
    kind = 'measurement';
    payload = { action: 'pre-roll' };
  } else {
    // The first of a pattern clip and a gate event that plays on the track's target
    // (clip-targets.js, R7); a track without a target gets a pattern clip.
    const node = nodeOf(model, track.target);
    const pattern = { kind: 'pattern' };
    const gate = { kind: 'event', action: 'gate' };
    const use = !node ? pattern
      : [pattern, gate].find((u) => clipTarget(node, u, registry).plays);
    if (!use) {
      return { reason: `${node.metadata.name} plays no pattern or event clips; choose a `
        + 'Sequence, an Oscillator or an Envelope as the track target.' };
    }
    kind = use.kind;
    payload = kind === 'pattern' ? { blockType: 'tone' } : { action: 'gate' };
  }
  const duration = NEW_CLIP_DURATION_S[kind];
  const start = cleanTime(clamp(finite(time) ? time : 0, 0, TIMELINE_MAX_S - duration));
  return { action: { type: 'CLIP_ADD', trackId, kind, start, duration, payload } };
}

/** The first free start (s) on a track at or after `time` (the end of what covers it). */
export function freeStartOnTrack(model, trackId, time) {
  let t = Math.max(0, time);
  const clips = model.timeline.clips.filter((c) => c.trackId === trackId);
  for (let guard = 0; guard <= clips.length; guard++) {
    const cover = clips.find((c) => c.start <= t + 1e-9 && clipEnd(c) > t + 1e-9);
    if (!cover) break;
    t = clipEnd(cover);
  }
  return cleanTime(t);
}

/**
 * Plan of splitting a clip at `time` (§84: a clip edit): both halves keep the clip's payload; a
 * sweep or chirp is cut where its curve is, so the two halves sound like the whole
 * (timeline-compiler truncatePatternPayload). Returns { ok, reason } or
 * { ok: true, at, left: { start, duration, payload }, right: { start, duration, payload } }.
 */
export function splitClipPlan(model, clipId, time) {
  const clip = findClip(model, clipId);
  if (!clip) return { ok: false, reason: 'There is no such clip.' };
  if (clip.kind === 'measurement') {
    return { ok: false, reason: 'A measurement step is one unit; it cannot be split.' };
  }
  const at = cleanTime(time);
  if (!(at > clip.start + 1e-9 && at < clipEnd(clip) - 1e-9)) {
    return { ok: false, reason: 'Place the playhead inside the clip to split it.' };
  }
  const leftS = cleanTime(at - clip.start);
  const rightS = cleanTime(clipEnd(clip) - at);
  const { min } = clipDurationBounds(clip);
  if (leftS < min - 1e-9 || rightS < min - 1e-9) {
    return { ok: false, reason: `Both parts must last at least ${cleanTime(min)} s.` };
  }
  let left = clip.payload;
  let right = clip.payload;
  if (clip.kind === 'pattern') {
    const cut = truncatePatternPayload(clip.payload, clip.duration, leftS);
    if (cut.params.end !== clip.payload.params.end) {
      left = cut;
      right = { ...clip.payload, params: { ...clip.payload.params, start: cut.params.end } };
    }
  }
  return { ok: true, at, left: { start: clip.start, duration: leftS, payload: left },
    right: { start: at, duration: rightS, payload: right } };
}

/**
 * Apply a split plan through a store: one undo entry ("Split <kind> clip") made of CLIP_RESIZE,
 * DUPLICATE, CLIP_RESIZE and CLIP_UPDATE. Returns { ok, created } or the first refusal (the
 * gesture is then cancelled: the model is exactly as before).
 */
export function applySplit(store, clipId, plan) {
  const clip = findClip(store.getModel(), clipId);
  store.beginGesture(`Split ${clip.kind} clip`);
  const steps = [];
  const run = (action) => {
    const r = store.dispatch(action);
    steps.push(r);
    return r;
  };
  let r = run({ type: 'CLIP_RESIZE', clipId, start: plan.left.start,
    duration: plan.left.duration });
  if (r.ok) {
    r = run({ type: 'DUPLICATE', clipIds: [clipId],
      placements: { [clipId]: { start: plan.right.start } } });
  }
  const copy = r.ok && r.created && r.created.clips ? r.created.clips[0] : null;
  if (r.ok && copy) r = run({ type: 'CLIP_RESIZE', clipId: copy, duration: plan.right.duration });
  if (r.ok && copy && plan.right.payload !== clip.payload) {
    r = run({ type: 'CLIP_UPDATE', clipId: copy, payload: plan.right.payload });
  }
  if (r.ok && plan.left.payload !== clip.payload) {
    r = run({ type: 'CLIP_UPDATE', clipId, payload: plan.left.payload });
  }
  if (!r.ok) {
    store.cancelGesture();
    return { ok: false, reason: r.reason };
  }
  const entry = store.endGesture();
  return { ok: true, created: copy, label: entry ? entry.label : `Split ${clip.kind} clip` };
}

// ---------------------------------------------------------------- editor choices

/** Pattern block types for the clip editor: [{ id, label }]. */
export function blockTypeOptions() {
  return BLOCK_TYPES.map((t) => ({ id: t, label: BLOCK_SCHEMA[t].label }));
}

/** Event clip actions: [{ id, label }]. */
export function eventActionOptions() {
  return EVENT_ACTIONS.map((a) => ({ id: a, label: a === 'trigger' ? 'Trigger' : 'Gate' }));
}

/** Measurement clip actions: [{ id, label }]. */
export function measurementActionOptions() {
  return MEASUREMENT_ACTIONS.map((a) => ({ id: a, label: MEASUREMENT_LABEL[a] }));
}

/** Parse a seconds field ("1.5", "1.5 s", "1500 ms"); null when it is not a time. */
export function parseSecondsText(text) {
  const m = /^\s*([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)\s*(ms|s|sec|seconds?)?\s*$/i
    .exec(String(text ?? ''));
  if (!m) return null;
  const v = Number(m[1]) * (m[2] && m[2].toLowerCase() === 'ms' ? 0.001 : 1);
  return finite(v) ? v : null;
}
