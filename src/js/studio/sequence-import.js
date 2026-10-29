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
//
// importSequenceDocument(doc, { sampleRate }) is the strict file path of Studio Import (plan
// K004): a V2 sequence file, or an OSCILLA configuration file (ui/config-file.js, version 1)
// whose `sequencer` holds one, already read by validate.js readUntrustedInput. The file must be
// the sequencer's canonical form already: parseSequence is run, and the first field it would
// not reproduce exactly (a clamped, coerced, rounded, defaulted, renumbered or dropped value, a
// missing or unknown field) refuses the file with that field's path, so a file opens as saved
// or not at all. Frequencies are checked at the rate the file was saved at (a configuration
// file's sampleRateRequested), else at the Studio's (`sampleRate`; 44.1 kHz before audio, as the
// sequencer itself reads it). A seed other than DEFAULT_SEED is refused: the app never writes
// one, and the Studio keeps no seed outside its model (tests/unit/v31-studio-sequence-file).

import { ID_PATTERN } from '../experiments/schema.js';
import {
  BLOCK_SCHEMA, DEFAULT_SEED, MAX_BLOCKS, MAX_BLOCK_MS, MIN_BLOCK_MS, PROVISIONAL_SAMPLE_RATE,
  SEQUENCE_VERSION, formatCompactFrequency, isNum, nextBlockId, normalizeModel, paramSchema,
  parseSequence, safeMaximum, serializeSequence,
} from '../sequencer/model.js';
import { createStudioModel } from './schema.js';
import { studioDiagnostic, validateStudioModel } from './validate.js';
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
  const { model: seq, issues: more } = normalizeModel({ version: SEQUENCE_VERSION,
    tempoBpm: model.transport.tempo, loop, waveform: node && node.params.waveform, seed,
    blocks: blocks.slice(0, MAX_BLOCKS) }, { sampleRate });
  return { sequence: serializeSequence(seq), issues: issues.concat(more), trackId: track.id };
}

// ---------------------------------------------------------------- files (plan K004)

/** The kind of an OSCILLA configuration file (ui/config-file.js CONFIG_FILE_KIND). */
export const CONFIG_KIND = 'oscilla-config';
/** The configuration file version Studio Import reads (ui/config-file.js CONFIG_FILE_VERSION). */
export const CONFIG_VERSION = 1;
// Web Audio's sample-rate range; a configuration file's rate outside it is not used.
const MIN_FILE_RATE = 3000;
const MAX_FILE_RATE = 768000;

const isPlain = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

/** True when a parsed document is read as a V2 sequence file or a configuration file. */
export function isSequenceDocument(doc) {
  return isPlain(doc) && (doc.kind === CONFIG_KIND
    || (doc.kind === undefined && Object.hasOwn(doc, 'blocks')));
}

const refuse = (path, message) => ({ ok: false, warnings: [], errors: [{
  ...studioDiagnostic('validate', 'invalid-sequence', `${message}; the file is refused.`, null,
    'error'), path }] });

/** A value as the refusal quotes it. */
function shown(v) {
  if (v === undefined) return 'missing';
  if (Array.isArray(v)) return 'a list';
  if (v && typeof v === 'object') return 'an object';
  if (typeof v === 'string') return `“${v.length > 32 ? `${v.slice(0, 32)}…` : v}”`;
  return String(v);
}

const kHz = (rate) => `${String(Number((rate / 1000).toFixed(3)))} kHz`;

/**
 * The first field of `seq` that its canonical form `canon` (serializeSequence of what
 * parseSequence made of it) does not reproduce: { path, message } or null.
 */
function firstDifference(seq, canon, rate) {
  const keys = (o, c, path, where, what) => {
    for (const k of Object.keys(c)) {
      if (!Object.hasOwn(o, k)) return { path: `${path}${k}`, message: `${where}: ${k} is missing` };
    }
    for (const k of Object.keys(o)) {
      if (!Object.hasOwn(c, k)) {
        return { path: `${path}${k}`, message: `${where}: ${k} is not ${what}` };
      }
    }
    return null;
  };
  const value = (path, where, key, a, b) => (Object.is(a, b) || (a === 0 && b === 0) ? null
    : { path, message: `${where}: ${key} is ${shown(a)} in the file but would open as `
      + `${shown(b)}` });
  const top = keys(seq, canon, '', 'The sequence', 'a V2 sequence field');
  if (top) return top;
  for (const k of Object.keys(canon)) {
    if (k === 'blocks') continue;
    const d = value(k, 'The sequence', k, seq[k], canon[k]);
    if (d) return d;
  }
  const ids = new Map();
  for (let i = 0; i < canon.blocks.length; i += 1) {
    const raw = seq.blocks[i];
    const c = canon.blocks[i];
    const path = `blocks[${i}]`;
    const where = `Block ${i + 1}`;
    if (!isPlain(raw)) return { path, message: `${where} is not an object` };
    if (!Object.hasOwn(BLOCK_SCHEMA, raw.type)) {
      return Object.hasOwn(raw, 'type') ? { path: `${path}.type`,
        message: `${where}: ${shown(raw.type)} is not a V2 block type` }
        : { path: `${path}.type`, message: `${where}: type is missing` };
    }
    const own = keys(raw, c, `${path}.`, where, 'a V2 block field');
    if (own) return own;
    if (typeof raw.id === 'string' && ids.has(raw.id)) {
      return { path: `${path}.id`, message: `${where}: id ${shown(raw.id)} is already used by `
        + `block ${ids.get(raw.id) + 1}` };
    }
    if (typeof raw.id === 'string') ids.set(raw.id, i);
    for (const k of ['id', 'type', 'durationMs', 'beats']) {
      const d = value(`${path}.${k}`, where, k, raw[k], c[k]);
      if (d) return d;
    }
    if (!isPlain(raw.params)) {
      return { path: `${path}.params`, message: `${where}: params is ${shown(raw.params)}, not `
        + 'an object' };
    }
    const p = keys(raw.params, c.params, `${path}.params.`, where,
      `a parameter of a ${c.type} block`);
    if (p) return { ...p, message: p.message.replace(`${where}: `, `${where}: params.`) };
    for (const k of Object.keys(c.params)) {
      const a = raw.params[k];
      const b = c.params[k];
      const desc = paramSchema(c.type, k);
      if (desc && desc.kind === 'freq' && isNum(a) && a > b && b === Math.round(
        safeMaximum(rate) * 1000) / 1000) {
        return { path: `${path}.params.${k}`, message: `${where}: ${k} `
          + `${formatCompactFrequency(a)} is above the ${formatCompactFrequency(b)} limit at `
          + `${kHz(rate)}` };
      }
      const d = value(`${path}.params.${k}`, where, `params.${k}`, a, b);
      if (d) return d;
    }
  }
  return null;
}

/** The rate a file's frequencies are read at: the file's own, else the Studio's, else 44.1 kHz. */
function fileRate(doc, config, sampleRate) {
  const saved = config ? doc.sampleRateRequested : null;
  if (isNum(saved) && saved >= MIN_FILE_RATE && saved <= MAX_FILE_RATE) return saved;
  return isNum(sampleRate) && sampleRate > 0 ? sampleRate : PROVISIONAL_SAMPLE_RATE;
}

/**
 * Open a V2 sequence file or a configuration file's sequence as a Studio model. Never throws.
 *   importSequenceDocument(doc, { sampleRate }) -> { ok: true, model, source:
 *     'sequence' | 'config', sampleRate, warnings: [] } | { ok: false, warnings: [], errors }
 */
export function importSequenceDocument(doc, { sampleRate } = {}) {
  const config = isPlain(doc) && doc.kind === CONFIG_KIND;
  if (config && doc.version !== CONFIG_VERSION) {
    return refuse('version', `Configuration file version ${shown(doc.version).slice(0, 34)} is `
      + `not ${CONFIG_VERSION}`);
  }
  const seq = config ? doc.sequencer : doc;
  const at = (key) => (config ? `sequencer.${key}` : key);
  if (!isPlain(seq)) {
    return refuse(config ? 'sequencer' : '', config
      ? 'This configuration file holds no Sequencer sequence to open in Studio'
      : 'The file does not contain a sequence object');
  }
  if (seq.version !== SEQUENCE_VERSION) {
    return refuse(at('version'), seq.version === undefined
      ? `The sequence names no version (${SEQUENCE_VERSION} expected)`
      : `Sequence version ${shown(seq.version).slice(0, 34)} is not ${SEQUENCE_VERSION}`);
  }
  if (!Array.isArray(seq.blocks)) return refuse(at('blocks'), 'The sequence blocks are not a list');
  if (!seq.blocks.length) {
    return refuse(at('blocks'), 'The sequence has no blocks, so there is nothing to open');
  }
  if (seq.blocks.length > MAX_BLOCKS) {
    return refuse(at('blocks'), `The sequence has ${seq.blocks.length} blocks; a V2 sequence `
      + `holds at most ${MAX_BLOCKS}`);
  }
  const rate = fileRate(doc, config, sampleRate);
  const { model: parsed, issues } = parseSequence(seq, { sampleRate: rate });
  const diff = firstDifference(seq, serializeSequence(parsed), rate);
  if (diff) return refuse(at(diff.path), diff.message);
  // Every repair changes a value, so none is left here; this only guards that invariant.
  if (issues.length) return refuse(at('blocks'), `The sequencer reports: ${issues[0]}`);
  if (parsed.seed !== DEFAULT_SEED) {
    return refuse(at('seed'), `The sequence seed is ${parsed.seed}; Studio opens only the V2 `
      + `default seed ${DEFAULT_SEED} (it seeds blocks added in the V2 editor, is never heard, `
      + 'and Studio keeps no seed)');
  }
  const imp = importSequence(seq, { sampleRate: rate, title: config ? 'Configuration sequence'
    : 'Imported sequence' });
  if (!imp.ok) return { ok: false, warnings: [], errors: imp.errors };
  return { ok: true, model: imp.model, source: config ? 'config' : 'sequence', sampleRate: rate,
    warnings: [] };
}
