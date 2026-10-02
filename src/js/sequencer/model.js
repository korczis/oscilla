// OSCILLA V2 pattern sequencer: the serialisable sequence model.
//
// A sequence is an ordered list of blocks; each block is one V1-style pattern segment with a
// duration. The model is plain JSON (no runtime nodes), every operation is pure and returns a
// new model, and every value is validated and clamped (NaN-safe) on the way in.
//
// Model shape (version 1):
//   { version, tempoBpm, loop, waveform, seed,
//     blocks: [{ id, type, durationMs, beats, params }] }
//
// Durations: `durationMs` is always the authoritative, effective duration. A block may also be
// tempo-locked: when `beats` is a positive number, normalisation derives
// durationMs = beats * 60000 / tempoBpm (clamped to the type's bounds, after which `beats` is
// re-derived so the two never disagree). `beats: null` means the block is in milliseconds and
// is unaffected by tempo. setTempo() therefore rescales only tempo-locked blocks.
//
// Frequencies are clamped to [SEQ_MIN_FREQUENCY, 0.95 * sampleRate / 2]. The sample rate comes
// from the caller (the running AudioContext); before a context exists the V1 provisional rate
// (44.1 kHz, the conservative common rate) is used, never 48 kHz. The compiler clamps again
// against the real context rate, so a model edited on a 96 kHz device still plays safely on a
// 44.1 kHz one.

// ============================================================ constants

export const SEQUENCE_VERSION = 1;
export const SAFE_NYQUIST_FACTOR = 0.95; // from V1 SAFE_NYQUIST_FACTOR (index.html@95dfa81:984)
// from V1 PROVISIONAL_SAMPLE_RATE (index.html@95dfa81:985)
export const PROVISIONAL_SAMPLE_RATE = 44100;
export const SEQ_MIN_FREQUENCY = 20; // Hz; V1's absolute floor is 1 Hz, the sequencer uses 20
export const MAX_BLOCKS = 64;
export const MIN_BLOCK_MS = 10;
export const MAX_BLOCK_MS = 30000; // V1 MAX_PROGRAMMED_S (index.html@95dfa81:990) * 1000
export const MIN_TEMPO_BPM = 20;
export const MAX_TEMPO_BPM = 300;
export const DEFAULT_TEMPO_BPM = 120;
// V1 DEFAULT_PATTERN_PARAMS.random.seed (index.html@95dfa81:1155)
export const DEFAULT_SEED = 20261001;
// from V1 WAVEFORMS (index.html@95dfa81:1006)
export const WAVEFORMS = ['sine', 'triangle', 'sawtooth', 'square'];

export const BLOCK_TYPES = [
  'tone',
  'silence',
  'sweep',
  'pulse',
  'chirp',
  'burst',
  'siren',
  'am',
  'fm',
  'random',
];

// ============================================================ helpers

// from V1 clamp (index.html@95dfa81:1172)
export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
// from V1 isNum (index.html@95dfa81:1173)
export const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

// from V1 toNumber (index.html@95dfa81:1177)
/** Coerce to a finite number inside [lo, hi]; anything else becomes the fallback. */
export function toNumber(v, fallback, lo = -Infinity, hi = Infinity) {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
  return isNum(n) ? clamp(n, lo, hi) : fallback;
}
// from V1 toInt (index.html@95dfa81:1181)
export function toInt(v, fallback, lo, hi) {
  return Math.round(toNumber(v, fallback, lo, hi));
}
// from V1 pick (index.html@95dfa81:1184)
export function pick(v, allowed, fallback) {
  return allowed.includes(v) ? v : fallback;
}
// from V1 round (index.html@95dfa81:1187)
export function round(v, digits) {
  const m = 10 ** digits;
  return Math.round((v + Number.EPSILON) * m) / m;
}
// from V1 sig (index.html@95dfa81:1192)
/** Significant-digit formatting without trailing zeros: 2.2727 -> "2.27", 50.0 -> "50". */
export function sig(v, digits = 3) {
  return String(Number(v.toPrecision(digits)));
}

// from V1 mulberry32 (index.html@95dfa81:1240)
/** Deterministic PRNG so a random block's preview equals what plays and what is exported. */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// from V1 frequencyToNormalized (index.html@95dfa81:1366)
export function frequencyToNormalized(freq, min, max) {
  if (!(freq > 0 && min > 0 && max > min)) return 0;
  return clamp(Math.log(freq / min) / Math.log(max / min), 0, 1);
}
// from V1 normalizedToFrequency (index.html@95dfa81:1370), floor changed to SEQ_MIN_FREQUENCY
export function normalizedToFrequency(value, min, max) {
  if (!(min > 0 && max > min) || !isNum(value)) return min > 0 ? min : SEQ_MIN_FREQUENCY;
  return min * Math.pow(max / min, clamp(value, 0, 1));
}

/** The running context's safe maximum: 0.95 x Nyquist. Invalid rates fall back to 44.1 kHz. */
export function safeMaximum(sampleRate) {
  const sr = isNum(sampleRate) && sampleRate > 0 ? sampleRate : PROVISIONAL_SAMPLE_RATE;
  return (sr / 2) * SAFE_NYQUIST_FACTOR;
}

/** Compact frequency label as in the reference timeline: 440 Hz, 1.2 kHz, 15.5 kHz. */
export function formatCompactFrequency(f) {
  if (!isNum(f)) return '—';
  return f >= 1000 ? `${sig(f / 1000, 3)} kHz` : `${sig(f, 3)} Hz`;
}

/** Frequency range label: "440 → 880 Hz", "1 → 8 kHz", "440 Hz → 8 kHz". */
export function formatFrequencyRange(a, b, sep = ' → ') {
  if (!isNum(a) || !isNum(b)) return '—';
  if (a >= 1000 && b >= 1000) return `${sig(a / 1000, 3)}${sep}${sig(b / 1000, 3)} kHz`;
  if (a < 1000 && b < 1000) return `${sig(a, 3)}${sep}${sig(b, 3)} Hz`;
  return `${formatCompactFrequency(a)}${sep}${formatCompactFrequency(b)}`;
}

// from V1 formatMs (index.html@95dfa81:1437)
export function formatMs(ms) {
  if (!isNum(ms)) return '—';
  return ms >= 1000 ? `${sig(ms / 1000, 3)} s` : `${sig(ms, 3)} ms`;
}

const deepCopy = (o) => JSON.parse(JSON.stringify(o)); // from V1 deepCopy (index.html@95dfa81:1174)

// ============================================================ block schema

// Parameter descriptors: kind 'freq' clamps to [SEQ_MIN_FREQUENCY, safeMax]; 'ms', 'hz', 'int'
// and 'percent' clamp to [min, max]; 'enum' picks from options. Bounds and semantics follow the
// V1 PATTERNS table (index.html@95dfa81:1080) for the pattern each block type reuses.
const F = (key, label, def) => ({ key, label, kind: 'freq', unit: 'Hz', default: def });
const MS = (key, label, min, max, def) => ({
  key,
  label,
  kind: 'ms',
  unit: 'ms',
  min,
  max,
  default: def,
});
const HZ = (key, label, min, max, def) => ({
  key,
  label,
  kind: 'hz',
  unit: 'Hz',
  min,
  max,
  default: def,
});
const INT = (key, label, min, max, def, unit = '') => ({
  key,
  label,
  kind: 'int',
  unit,
  min,
  max,
  default: def,
});
const SEL = (key, label, options, def) => ({ key, label, kind: 'enum', options, default: def });

const CURVES = [
  ['log', 'Logarithmic'],
  ['linear', 'Linear'],
];

/**
 * Per-type schema. `pattern` names the V1 pattern whose maths the block reuses.
 * durationMs: { min, max, default }.
 */
export const BLOCK_SCHEMA = {
  tone: {
    label: 'Tone',
    pattern: 'finite',
    durationMs: { min: MIN_BLOCK_MS, max: MAX_BLOCK_MS, default: 500 },
    params: [F('freq', 'Frequency', 440)],
  },
  silence: {
    label: 'Silence',
    pattern: null,
    durationMs: { min: MIN_BLOCK_MS, max: MAX_BLOCK_MS, default: 250 },
    params: [],
  },
  sweep: {
    label: 'Sweep',
    pattern: 'sweepUp',
    durationMs: { min: 20, max: MAX_BLOCK_MS, default: 500 },
    params: [F('start', 'Start', 440), F('end', 'End', 880), SEL('curve', 'Curve', CURVES, 'log')],
  },
  pulse: {
    label: 'Pulse',
    pattern: 'pulse',
    durationMs: { min: MIN_BLOCK_MS, max: MAX_BLOCK_MS, default: 500 },
    params: [
      F('freq', 'Frequency', 1200),
      MS('pulseMs', 'Pulse', 5, 5000, 100),
      MS('pauseMs', 'Pause', 0, 5000, 100),
    ],
  },
  chirp: {
    label: 'Chirp',
    pattern: 'chirp',
    durationMs: { min: MIN_BLOCK_MS, max: 5000, default: 500 },
    params: [
      F('start', 'Start', 1000),
      F('end', 'End', 8000),
      SEL(
        'ramp',
        'Ramp',
        [
          ['exponential', 'Exponential'],
          ['linear', 'Linear'],
        ],
        'exponential',
      ),
    ],
  },
  burst: {
    label: 'Burst',
    pattern: 'burst',
    durationMs: { min: MIN_BLOCK_MS, max: MAX_BLOCK_MS, default: 1000 },
    params: [
      F('freq', 'Frequency', 1000),
      MS('burstMs', 'Burst', 5, 2000, 30),
      MS('intervalMs', 'Interval (onset to onset)', 10, 10000, 200),
    ],
  },
  siren: {
    label: 'Siren',
    pattern: 'siren',
    durationMs: { min: MIN_BLOCK_MS, max: MAX_BLOCK_MS, default: 1000 },
    params: [
      F('min', 'Minimum', 600),
      F('max', 'Maximum', 1200),
      HZ('rate', 'LFO rate', 0.05, 20, 2),
      SEL(
        'shape',
        'Shape',
        [
          ['sine', 'Sine'],
          ['triangle', 'Triangle'],
        ],
        'sine',
      ),
    ],
  },
  am: {
    label: 'AM',
    pattern: 'am',
    durationMs: { min: MIN_BLOCK_MS, max: MAX_BLOCK_MS, default: 1000 },
    params: [
      F('freq', 'Carrier', 440),
      HZ('modFreq', 'Modulation', 0.1, 500, 8),
      INT('depth', 'Depth', 0, 100, 80, '%'),
    ],
  },
  fm: {
    label: 'FM',
    pattern: 'fm',
    durationMs: { min: MIN_BLOCK_MS, max: MAX_BLOCK_MS, default: 1000 },
    params: [
      F('freq', 'Carrier', 440),
      HZ('modFreq', 'Modulation', 0.1, 2000, 5),
      HZ('depthHz', 'Depth (± Hz)', 0, 10000, 60),
    ],
  },
  random: {
    label: 'Random',
    pattern: 'random',
    durationMs: { min: MIN_BLOCK_MS, max: MAX_BLOCK_MS, default: 1000 },
    params: [
      F('min', 'Minimum', 200),
      F('max', 'Maximum', 4000),
      MS('toneMs', 'Tone', 10, 5000, 100),
      MS('gapMs', 'Gap', 0, 5000, 25),
      INT('seed', 'Seed', 0, 2 ** 31 - 1, DEFAULT_SEED),
    ],
  },
};

/** Default parameter object for a block type (fresh copy). */
export function defaultParams(type) {
  const s = BLOCK_SCHEMA[type];
  if (!s) return {};
  const out = {};
  for (const p of s.params) out[p.key] = p.default;
  return out;
}

/** Parameter descriptor lookup: paramSchema('sweep', 'curve') -> { kind: 'enum', ... }. */
export function paramSchema(type, key) {
  const s = BLOCK_SCHEMA[type];
  return s ? s.params.find((p) => p.key === key) || null : null;
}

// ============================================================ validation

function clampParam(desc, raw, safeMax, issues, where) {
  const fallback = desc.default;
  switch (desc.kind) {
    case 'freq': {
      const n = toNumber(raw, NaN);
      if (!isNum(n)) {
        if (raw !== undefined) issues.push(`${where}: ${desc.label} is not a number; reset.`);
        return Math.min(fallback, safeMax);
      }
      const v = clamp(n, SEQ_MIN_FREQUENCY, safeMax);
      if (v !== n) issues.push(`${where}: ${desc.label} limited to ${formatCompactFrequency(v)}.`);
      return round(v, 3);
    }
    case 'enum': {
      const allowed = desc.options.map((o) => o[0]);
      if (raw !== undefined && !allowed.includes(raw))
        issues.push(`${where}: ${desc.label} reset.`);
      return pick(raw, allowed, fallback);
    }
    case 'int': {
      const n = toNumber(raw, NaN);
      if (!isNum(n)) {
        if (raw !== undefined) issues.push(`${where}: ${desc.label} is not a number; reset.`);
        return fallback;
      }
      const v = toInt(n, fallback, desc.min, desc.max);
      if (v !== n) issues.push(`${where}: ${desc.label} limited to ${v}.`);
      return v;
    }
    default: {
      // ms, hz
      const n = toNumber(raw, NaN);
      if (!isNum(n)) {
        if (raw !== undefined) issues.push(`${where}: ${desc.label} is not a number; reset.`);
        return fallback;
      }
      const v = clamp(n, desc.min, desc.max);
      if (v !== n) issues.push(`${where}: ${desc.label} limited to ${sig(v, 4)} ${desc.unit}.`);
      return v;
    }
  }
}

/**
 * Cross-parameter constraints that keep the instantaneous frequency inside
 * [SEQ_MIN_FREQUENCY, safeMax]. FM depth uses V1 wobble's two-sided bound
 * (index.html@95dfa81:1982) rather than V1 fm's upper-only bound, so the carrier never swings
 * below 20 Hz or through 0 Hz.
 */
function applyConstraints(type, p, safeMax, issues, where) {
  if (type === 'fm') {
    const maxDepth = Math.max(0, Math.min(p.freq - SEQ_MIN_FREQUENCY, safeMax - p.freq));
    if (p.depthHz > maxDepth) {
      issues.push(
        `${where}: depth limited to ±${sig(maxDepth, 3)} Hz ` +
          'to stay inside 20 Hz … safe maximum.',
      );
      p.depthHz = round(maxDepth, 3);
    }
  }
  if (type === 'burst' && p.intervalMs < p.burstMs) {
    // V1 burst: interval = max(burst, interval) (index.html@95dfa81:1901)
    p.intervalMs = p.burstMs;
  }
  return p;
}

function msPerBeat(tempoBpm) {
  return 60000 / tempoBpm;
}

/**
 * Validate one block. Returns { block, issues }. Unknown types become 'tone'.
 * opts: { sampleRate, tempoBpm, index }
 */
export function normalizeBlock(raw, opts = {}) {
  const issues = [];
  const r = raw && typeof raw === 'object' ? raw : {};
  const where = `Block ${(opts.index ?? 0) + 1}`;
  let type = r.type;
  if (!BLOCK_SCHEMA[type]) {
    issues.push(`${where}: unknown type “${String(type)}”; using Tone.`);
    type = 'tone';
  }
  const schema = BLOCK_SCHEMA[type];
  const safeMax = safeMaximum(opts.sampleRate);
  const tempo = toNumber(opts.tempoBpm, DEFAULT_TEMPO_BPM, MIN_TEMPO_BPM, MAX_TEMPO_BPM);
  const rawParams = r.params && typeof r.params === 'object' ? r.params : {};
  let params = {};
  for (const desc of schema.params) {
    params[desc.key] = clampParam(desc, rawParams[desc.key], safeMax, issues, where);
  }
  params = applyConstraints(type, params, safeMax, issues, where);

  const { min, max } = schema.durationMs;
  let beats = toNumber(r.beats, null);
  if (beats !== null && !(beats > 0)) beats = null;
  let durationMs;
  if (beats !== null) {
    const want = beats * msPerBeat(tempo);
    durationMs = clamp(want, min, max);
    if (durationMs !== want) {
      issues.push(`${where}: duration limited to ${formatMs(durationMs)}.`);
      beats = durationMs / msPerBeat(tempo);
    }
  } else {
    const n = toNumber(r.durationMs, NaN);
    if (!isNum(n)) {
      if (r.durationMs !== undefined) issues.push(`${where}: duration is not a number; reset.`);
      durationMs = schema.durationMs.default;
    } else {
      durationMs = clamp(n, min, max);
      if (durationMs !== n) issues.push(`${where}: duration limited to ${formatMs(durationMs)}.`);
    }
  }
  const id = typeof r.id === 'string' && r.id.trim() !== '' ? r.id : null;
  return {
    block: {
      id,
      type,
      durationMs: round(durationMs, 3),
      beats: beats === null ? null : round(beats, 6),
      params,
    },
    issues,
  };
}

function idNumber(id) {
  const m = /^b(\d+)$/.exec(id || '');
  return m ? Number(m[1]) : 0;
}

/** Next free id: 'b' + (largest numeric suffix + 1). Pure: derived from the blocks only. */
export function nextBlockId(blocks) {
  let n = 0;
  for (const b of blocks) n = Math.max(n, idNumber(b.id));
  return `b${n + 1}`;
}

/**
 * Validate a whole model (also used to import JSON). Returns { model, issues }.
 * opts: { sampleRate }
 */
export function normalizeModel(raw, opts = {}) {
  const issues = [];
  const r = raw && typeof raw === 'object' ? raw : {};
  if (raw !== undefined && (raw === null || typeof raw !== 'object'))
    issues.push('Sequence is not an object; using defaults.');
  if (r.version !== undefined && r.version !== SEQUENCE_VERSION) {
    issues.push(
      `Sequence version ${String(r.version)} is not ${SEQUENCE_VERSION}; read best-effort.`,
    );
  }
  const tempoBpm = round(toNumber(r.tempoBpm, DEFAULT_TEMPO_BPM, MIN_TEMPO_BPM, MAX_TEMPO_BPM), 3);
  const list = Array.isArray(r.blocks) ? r.blocks : [];
  if (r.blocks !== undefined && !Array.isArray(r.blocks))
    issues.push('Blocks are not a list; ignored.');
  if (list.length > MAX_BLOCKS) issues.push(`Only the first ${MAX_BLOCKS} blocks are kept.`);
  const blocks = [];
  const seen = new Set();
  list.slice(0, MAX_BLOCKS).forEach((b, index) => {
    const res = normalizeBlock(b, { sampleRate: opts.sampleRate, tempoBpm, index });
    issues.push(...res.issues);
    blocks.push(res.block);
  });
  // Ids: keep valid unique ones, then assign fresh ids to missing or duplicate ones.
  for (const b of blocks) {
    if (b.id && !seen.has(b.id)) seen.add(b.id);
    else b.id = null;
  }
  for (const b of blocks) {
    if (!b.id) {
      b.id = nextBlockId(blocks.filter((x) => x.id));
      seen.add(b.id);
    }
  }
  const model = {
    version: SEQUENCE_VERSION,
    tempoBpm,
    loop: r.loop === true,
    waveform: pick(r.waveform, WAVEFORMS, 'sine'),
    seed: toInt(r.seed, DEFAULT_SEED, 0, 2 ** 31 - 1),
    blocks,
  };
  return { model, issues };
}

/** A fresh, empty model (or one built from options). */
export function createSequence(init = {}, opts = {}) {
  return normalizeModel({ version: SEQUENCE_VERSION, ...init }, opts).model;
}

/**
 * The reference sequence shown in the V2 design: Tone 440 Hz 500 ms, Sweep 440 → 880 Hz log
 * 500 ms, Silence 250 ms, Pulse 1.2 kHz 500 ms, Chirp 1 → 8 kHz 500 ms, at 120 BPM.
 */
export function referenceSequence(opts = {}) {
  return createSequence(
    {
      tempoBpm: 120,
      blocks: [
        { id: 'b1', type: 'tone', durationMs: 500, params: { freq: 440 } },
        {
          id: 'b2',
          type: 'sweep',
          durationMs: 500,
          params: { start: 440, end: 880, curve: 'log' },
        },
        { id: 'b3', type: 'silence', durationMs: 250, params: {} },
        {
          id: 'b4',
          type: 'pulse',
          durationMs: 500,
          params: { freq: 1200, pulseMs: 100, pauseMs: 100 },
        },
        {
          id: 'b5',
          type: 'chirp',
          durationMs: 500,
          params: { start: 1000, end: 8000, ramp: 'exponential' },
        },
      ],
    },
    opts,
  );
}

// ============================================================ derived values

/** Total duration in milliseconds. */
export function totalDurationMs(model) {
  let t = 0;
  for (const b of model.blocks) t += b.durationMs;
  return t;
}

/** Total duration in seconds. */
export function totalDuration(model) {
  return totalDurationMs(model) / 1000;
}

/** Start time of every block in seconds (same order as model.blocks). */
export function blockStartTimes(model) {
  const out = [];
  let t = 0;
  for (const b of model.blocks) {
    out.push(t / 1000);
    t += b.durationMs;
  }
  return out;
}

export function indexOfBlock(model, id) {
  return model.blocks.findIndex((b) => b.id === id);
}

export function getBlock(model, id) {
  return model.blocks.find((b) => b.id === id) || null;
}

/** Labels as in the reference timeline: { label: 'Sweep', detail: '440 → 880 Hz' }. */
export function describeBlock(block) {
  const s = BLOCK_SCHEMA[block.type];
  const p = block.params || {};
  const label = s ? s.label : String(block.type);
  let detail = '';
  switch (block.type) {
    case 'tone':
    case 'pulse':
    case 'burst':
      detail = formatCompactFrequency(p.freq);
      break;
    case 'sweep':
    case 'chirp':
      detail = formatFrequencyRange(p.start, p.end);
      break;
    case 'siren':
    case 'random':
      detail = formatFrequencyRange(p.min, p.max, '–');
      break;
    case 'am':
      detail = `${formatCompactFrequency(p.freq)} · ${sig(p.modFreq, 3)} Hz`;
      break;
    case 'fm':
      detail = `${formatCompactFrequency(p.freq)} ± ${sig(p.depthHz, 3)}`;
      break;
    default:
      detail = '';
  }
  return { label, detail };
}

// ============================================================ operations (pure)

function withBlocks(model, blocks) {
  return { ...model, blocks };
}

function seedFor(model, id) {
  // Deterministic per-block seed derived from the model seed and the block id.
  return Math.floor(mulberry32((model.seed ^ (idNumber(id) * 0x9e3779b1)) >>> 0)() * (2 ** 31 - 1));
}

/**
 * Add a block. opts: { index (insert position, default end), params, durationMs, beats,
 * sampleRate }. Returns the same model when it is full or the type is unknown.
 */
export function addBlock(model, type, opts = {}) {
  if (!BLOCK_SCHEMA[type] || model.blocks.length >= MAX_BLOCKS) return model;
  const id = nextBlockId(model.blocks);
  const params = { ...defaultParams(type), ...(opts.params || {}) };
  if (type === 'random' && !(opts.params && opts.params.seed !== undefined))
    params.seed = seedFor(model, id);
  const { block } = normalizeBlock(
    {
      id,
      type,
      params,
      durationMs: opts.durationMs ?? BLOCK_SCHEMA[type].durationMs.default,
      beats: opts.beats ?? null,
    },
    { sampleRate: opts.sampleRate, tempoBpm: model.tempoBpm, index: model.blocks.length },
  );
  const index = toInt(opts.index, model.blocks.length, 0, model.blocks.length);
  const blocks = model.blocks.slice();
  blocks.splice(index, 0, block);
  return withBlocks(model, blocks);
}

export function deleteBlock(model, id) {
  const i = indexOfBlock(model, id);
  if (i < 0) return model;
  return withBlocks(
    model,
    model.blocks.filter((b) => b.id !== id),
  );
}

/** Insert a copy right after the original, with a fresh id. */
export function duplicateBlock(model, id) {
  const i = indexOfBlock(model, id);
  if (i < 0 || model.blocks.length >= MAX_BLOCKS) return model;
  const copy = { ...deepCopy(model.blocks[i]), id: nextBlockId(model.blocks) };
  const blocks = model.blocks.slice();
  blocks.splice(i + 1, 0, copy);
  return withBlocks(model, blocks);
}

/** Move the block at `from` so that it ends up at index `to`. Out-of-range indices are clamped. */
export function moveBlock(model, from, to) {
  const n = model.blocks.length;
  const f = toInt(from, -1, -1, n - 1);
  if (f < 0 || n < 2) return model;
  const t = toInt(to, f, 0, n - 1);
  if (t === f) return model;
  const blocks = model.blocks.slice();
  const [b] = blocks.splice(f, 1);
  blocks.splice(t, 0, b);
  return withBlocks(model, blocks);
}

export function moveEarlier(model, id) {
  const i = indexOfBlock(model, id);
  return i > 0 ? moveBlock(model, i, i - 1) : model;
}

export function moveLater(model, id) {
  const i = indexOfBlock(model, id);
  return i >= 0 && i < model.blocks.length - 1 ? moveBlock(model, i, i + 1) : model;
}

/**
 * Update a block. patch: { type?, durationMs?, beats?, params?: {...} }. Changing the type
 * resets the params to the new type's defaults (keeping the duration). Setting durationMs
 * without beats unlocks the block from the tempo; setting beats locks it.
 * opts: { sampleRate }. Returns { model, issues } via updateBlockWithIssues; updateBlock returns
 * only the model.
 */
export function updateBlockWithIssues(model, id, patch = {}, opts = {}) {
  const i = indexOfBlock(model, id);
  if (i < 0 || !patch || typeof patch !== 'object') return { model, issues: [] };
  const cur = model.blocks[i];
  const typeChanged =
    patch.type !== undefined && patch.type !== cur.type && BLOCK_SCHEMA[patch.type];
  const type = typeChanged ? patch.type : cur.type;
  let params = typeChanged ? defaultParams(type) : { ...cur.params };
  if (patch.params && typeof patch.params === 'object') params = { ...params, ...patch.params };
  if (typeChanged && type === 'random' && !(patch.params && patch.params.seed !== undefined)) {
    params.seed = seedFor(model, id);
  }
  let beats = cur.beats;
  let durationMs = cur.durationMs;
  if (patch.beats !== undefined) beats = patch.beats;
  if (patch.durationMs !== undefined) {
    durationMs = patch.durationMs;
    if (patch.beats === undefined) beats = null;
  }
  const { block, issues } = normalizeBlock(
    { id, type, durationMs, beats, params },
    { sampleRate: opts.sampleRate, tempoBpm: model.tempoBpm, index: i },
  );
  const blocks = model.blocks.slice();
  blocks[i] = block;
  return { model: withBlocks(model, blocks), issues };
}

export function updateBlock(model, id, patch, opts) {
  return updateBlockWithIssues(model, id, patch, opts).model;
}

/** Switch a block between milliseconds and tempo-locked beats, keeping its current length. */
export function setDurationUnit(model, id, unit) {
  const b = getBlock(model, id);
  if (!b) return model;
  if (unit === 'beats') {
    return updateBlock(model, id, { beats: b.durationMs / msPerBeat(model.tempoBpm) });
  }
  return updateBlock(model, id, { durationMs: b.durationMs });
}

/** Change the tempo; tempo-locked blocks are rescaled, millisecond blocks are untouched. */
export function setTempo(model, bpm) {
  const tempoBpm = round(toNumber(bpm, model.tempoBpm, MIN_TEMPO_BPM, MAX_TEMPO_BPM), 3);
  if (tempoBpm === model.tempoBpm) return model;
  const blocks = model.blocks.map((b) => {
    if (b.beats === null) return b;
    const { min, max } = BLOCK_SCHEMA[b.type].durationMs;
    const durationMs = clamp(b.beats * msPerBeat(tempoBpm), min, max);
    return {
      ...b,
      durationMs: round(durationMs, 3),
      beats: round(durationMs / msPerBeat(tempoBpm), 6),
    };
  });
  return { ...model, tempoBpm, blocks };
}

export function setLoop(model, loop) {
  return model.loop === !!loop ? model : { ...model, loop: !!loop };
}

export function setWaveform(model, waveform) {
  const w = pick(waveform, WAVEFORMS, model.waveform);
  return w === model.waveform ? model : { ...model, waveform: w };
}

/** Selection is UI state, not model state: returns `id` when it exists in the model, else null. */
export function selectBlock(model, id) {
  return id != null && indexOfBlock(model, id) >= 0 ? id : null;
}

/** The id to select after deleting `id`: the next block, else the previous one, else null. */
export function neighbourAfterDelete(model, id) {
  const i = indexOfBlock(model, id);
  if (i < 0) return null;
  const next = model.blocks[i + 1] || model.blocks[i - 1];
  return next ? next.id : null;
}

// ============================================================ serialisation

/** Plain JSON copy for the config export (`sequencer` key) and URL state. */
export function serializeSequence(model) {
  return deepCopy({
    version: SEQUENCE_VERSION,
    tempoBpm: model.tempoBpm,
    loop: !!model.loop,
    waveform: model.waveform,
    seed: model.seed,
    blocks: model.blocks.map((b) => ({
      id: b.id,
      type: b.type,
      durationMs: b.durationMs,
      beats: b.beats,
      params: b.params,
    })),
  });
}

/** Parse imported JSON (object or string). Returns { model, issues }; never throws. */
export function parseSequence(input, opts = {}) {
  let raw = input;
  if (typeof input === 'string') {
    try {
      raw = JSON.parse(input);
    } catch (e) {
      return { model: createSequence({}, opts), issues: ['Sequence JSON could not be parsed.'] };
    }
  }
  return normalizeModel(raw, opts);
}
