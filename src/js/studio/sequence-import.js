// V2 sequence files in the Studio timeline (spec §85; plan V416). Pure: plain data in, plain
// data out; no DOM, no Web Audio, no clock. docs/v31/sequencer-migration.md is the concept map.
//
// importSequence(v2) turns a V2 sequence (sequencer/model.js serializeSequence shape, object or
// JSON text, parsed with the sequencer's own never-throwing parseSequence) into a playable
// Studio model:
//   Sequence node (waveform) → Master Output, one event track targeting it, one pattern clip per
//   block laid end to end from 0 s, transport tempo = tempoBpm, loop region [0, total] enabled
//   when the sequence loops.
// Block → clip: payload { blockType: type, params }; start = cumulative duration (computed from
// the cumulative milliseconds, one division, so float residue stays below a nanosecond);
// duration = durationMs / 1000; a tempo-locked block (beats !== null) becomes a tempo-linked
// clip with musical { startBeats, durationBeats: beats }. Clip ids are `clip-<blockId>` so the
// export recovers the block ids. The model-level random seed (used only to seed blocks added
// later in the V2 editor, never for playback) is returned in `extras.seed`.
//
// exportSequence(model, { trackId, seed }) is the inverse for one event track: pattern clips
// sorted by start, gaps (and a late first clip) become silence blocks, the loop flag is set when
// the active loop region spans exactly the exported sequence. Overlapping clips cannot be a V2
// chain; they are skipped and reported. import → export reproduces serializeSequence(v2) exactly
// (tests/unit/v31-studio-timeline.test.mjs).

import { ID_PATTERN } from '../experiments/schema.js';
import {
  DEFAULT_SEED, MAX_BLOCKS, MAX_BLOCK_MS, MIN_BLOCK_MS, nextBlockId, normalizeModel, parseSequence,
  serializeSequence,
} from '../sequencer/model.js';
import { createStudioModel } from './schema.js';
import { validateStudioModel } from './validate.js';
import { CONTIGUITY_TOLERANCE_S, clipEnd } from './timeline.js';

export const IMPORT_IDS = Object.freeze({ node: 'seq-1', master: 'master-1', edge: 'edge-1',
  track: 'track-1' });
const CLIP_PREFIX = 'clip-';

/** Clip id of a block (`clip-<blockId>`), or a positional one when that is not a valid id. */
export function clipIdForBlock(blockId, index) {
  const id = `${CLIP_PREFIX}${blockId}`;
  return ID_PATTERN.test(id) ? id : `${CLIP_PREFIX}b${index + 1}`;
}

/**
 * Clips (and loop / tempo / waveform) of a V2 sequence, positioned from `startAt` seconds on
 * `trackId`, playing on the track target (target null).
 *   sequenceToTimeline(input, { trackId, startAt = 0, sampleRate })
 * -> { clips, loop, tempo, waveform, seed, issues, sequence }
 */
export function sequenceToTimeline(input, { trackId = IMPORT_IDS.track, startAt = 0,
  sampleRate } = {}) {
  const { model: seq, issues } = parseSequence(input, { sampleRate });
  const clips = [];
  let cumMs = 0;
  seq.blocks.forEach((b, i) => {
    const start = startAt + cumMs / 1000;
    cumMs += b.durationMs;
    const clip = {
      id: clipIdForBlock(b.id, i),
      trackId,
      kind: 'pattern',
      start,
      duration: b.durationMs / 1000,
      target: null,
      payload: { blockType: b.type, params: { ...b.params } },
    };
    if (b.beats !== null) {
      clip.musical = { startBeats: start * seq.tempoBpm / 60, durationBeats: b.beats };
    }
    clips.push(clip);
  });
  const total = cumMs / 1000;
  return {
    clips,
    loop: { enabled: seq.loop && total > 0, start: startAt, end: total > 0 ? startAt + total
      : startAt + 4 },
    tempo: seq.tempoBpm,
    waveform: seq.waveform,
    seed: seq.seed,
    issues,
    sequence: seq,
  };
}

/**
 * A Studio model that plays a V2 sequence. Never throws.
 *   importSequence(input, { sampleRate, title }) -> { ok, model, issues, extras: { seed },
 *     ids: { node, master, track, clips }, errors? }
 */
export function importSequence(input, { sampleRate, title = 'Imported sequence' } = {}) {
  const t = sequenceToTimeline(input, { sampleRate });
  const model = createStudioModel({
    graph: {
      nodes: [
        { id: IMPORT_IDS.node, type: 'sequence', position: { x: 40, y: 120 },
          params: { waveform: t.waveform }, metadata: { name: 'Sequence 1' } },
        { id: IMPORT_IDS.master, type: 'master', position: { x: 360, y: 120 },
          metadata: { name: 'Master Output 1' } },
      ],
      edges: [{ id: IMPORT_IDS.edge, from: { node: IMPORT_IDS.node, port: 'audio' },
        to: { node: IMPORT_IDS.master, port: 'audio' } }],
    },
    timeline: {
      tracks: [{ id: IMPORT_IDS.track, kind: 'event', name: 'Sequence',
        target: IMPORT_IDS.node }],
      clips: t.clips,
      automation: [],
      markers: [],
      loop: t.loop,
    },
    transport: { timeMode: 'seconds', tempo: t.tempo, timeSignature: [4, 4] },
    metadata: { title, notes: '' },
  });
  const report = validateStudioModel(model);
  const result = { ok: report.ok, model, issues: t.issues, extras: { seed: t.seed },
    ids: { node: IMPORT_IDS.node, master: IMPORT_IDS.master, track: IMPORT_IDS.track,
      clips: t.clips.map((c) => c.id) } };
  if (!report.ok) result.errors = report.errors;
  return result;
}

function blockIdFromClip(clipId) {
  return clipId.startsWith(CLIP_PREFIX) ? clipId.slice(CLIP_PREFIX.length) : null;
}

/** Silence blocks covering `ms` (each MIN_BLOCK_MS-MAX_BLOCK_MS); a remainder < 10 ms is lost. */
function silenceBlocks(ms) {
  const out = [];
  let rest = Math.round(ms * 1000) / 1000;
  while (rest >= MIN_BLOCK_MS) {
    const d = Math.min(MAX_BLOCK_MS, rest);
    out.push(d);
    rest = Math.round((rest - d) * 1000) / 1000;
  }
  return { blocks: out, lostMs: rest };
}

/**
 * The V2 sequence of one event track (serializeSequence shape).
 *   exportSequence(model, { trackId, seed = DEFAULT_SEED, sampleRate })
 * -> { sequence, issues }. trackId defaults to the first event track with pattern clips.
 */
export function exportSequence(model, { trackId, seed = DEFAULT_SEED, sampleRate } = {}) {
  const issues = [];
  const tl = model.timeline;
  const track = trackId ? tl.tracks.find((x) => x.id === trackId)
    : tl.tracks.find((x) => x.kind === 'event' && tl.clips.some((c) => c.trackId === x.id
      && c.kind === 'pattern'));
  if (!track) {
    return { sequence: serializeSequence(normalizeModel({ seed }).model),
      issues: ['There is no event track with pattern clips.'] };
  }
  const clips = tl.clips.filter((c) => c.trackId === track.id && c.kind === 'pattern')
    .sort((a, b) => a.start - b.start || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const blocks = [];
  const usedIds = new Set();
  let cursor = 0;
  let firstStart = null;
  for (const c of clips) {
    if (c.start < cursor - CONTIGUITY_TOLERANCE_S) {
      issues.push(`Clip ${c.id} overlaps the previous clip and is not exported.`);
      continue;
    }
    const gapMs = (c.start - cursor) * 1000;
    if (gapMs > CONTIGUITY_TOLERANCE_S * 1000) {
      const s = silenceBlocks(gapMs);
      for (const d of s.blocks) blocks.push({ id: null, type: 'silence', durationMs: d,
        beats: null, params: {} });
      if (s.lostMs > 0) issues.push(`A ${s.lostMs} ms gap before clip ${c.id} is shorter than `
        + `${MIN_BLOCK_MS} ms and is closed.`);
    }
    if (firstStart === null) firstStart = c.start;
    let id = blockIdFromClip(c.id);
    if (!id || usedIds.has(id)) id = null;
    if (id) usedIds.add(id);
    blocks.push({ id, type: c.payload.blockType,
      durationMs: Math.round(c.duration * 1e6) / 1e3,
      beats: c.musical ? c.musical.durationBeats : null, params: { ...c.payload.params } });
    cursor = clipEnd(c);
  }
  if (blocks.length > MAX_BLOCKS) {
    issues.push(`Only the first ${MAX_BLOCKS} blocks fit a V2 sequence.`);
  }
  for (const b of blocks) {
    if (!b.id) {
      b.id = nextBlockId(blocks.filter((x) => x.id));
    }
  }
  const node = model.graph.nodes.find((n) => n.id === track.target);
  const loop = tl.loop.enabled && Math.abs(tl.loop.start) <= CONTIGUITY_TOLERANCE_S
    && Math.abs(tl.loop.end - cursor) <= CONTIGUITY_TOLERANCE_S;
  if (tl.loop.enabled && !loop) {
    issues.push('The loop region is not the whole sequence; the V2 sequence does not loop.');
  }
  const { model: seq, issues: more } = normalizeModel({ version: 1,
    tempoBpm: model.transport.tempo, loop, waveform: node && node.params.waveform, seed,
    blocks: blocks.slice(0, MAX_BLOCKS) }, { sampleRate });
  return { sequence: serializeSequence(seq), issues: issues.concat(more) };
}
