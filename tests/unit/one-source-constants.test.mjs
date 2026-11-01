// One source for the safety and rate constants, and copy derived from them.
//
// The 0.95 × Nyquist limit of rule project.audio-engine-discipline is SAFE_NYQUIST_FACTOR in
// src/js/core/constants.js. A second literal 0.95 drifts from it silently, and so does user copy
// that types "95 %" or "0.95 ×" next to the constant it describes. The same holds for the
// provisional sample rate, the render quantum, the gain floor, the start offset, cents per
// octave and the transfer validity criterion: each has one home module and is imported from it.
//
// The scan reads the code of every module under src/js/ with comments and string literals
// blanked (for numeric literals and declarations) and the string literals alone (for copy).
// The runtime checks pin the derived copy byte for byte to the text it replaced, so the golden
// vectors and the visual references do not move.
//   node --test tests/unit/one-source-constants.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (rel) => readFileSync(path.join(ROOT, rel), 'utf8');

function jsFiles(rel) {
  return readdirSync(path.join(ROOT, rel), { withFileTypes: true }).flatMap((d) => {
    const p = `${rel}/${d.name}`;
    if (d.isDirectory()) return jsFiles(p);
    return p.endsWith('.js') ? [p] : [];
  });
}

// Characters after which a `/` starts a regular expression literal rather than a division.
const REGEX_PREFIX = /[(,=:[!&|?{};+\-*%<>~^]$|^$|\b(?:return|typeof|case|in|of|delete|void)$/;

/**
 * Split a JavaScript source into `code` (comments, strings and regular expressions replaced by
 * spaces, line breaks kept so line numbers hold) and `strings` (each literal's text; a template
 * literal's `${…}` reads as one space, and 'a' + 'b' is one string as the reader sees it).
 */
export function splitSource(src) {
  let code = '';
  const strings = [];
  let i = 0;
  let lastEnd = -1;
  const nested = [];
  const blank = (s) => s.replace(/[^\n]/g, ' ');
  while (i < src.length) {
    const c = src[i];
    if (c === '/' && src[i + 1] === '/') {
      const end = src.indexOf('\n', i);
      const j = end < 0 ? src.length : end;
      code += blank(src.slice(i, j));
      i = j;
      continue;
    }
    if (c === '/' && src[i + 1] === '*') {
      const end = src.indexOf('*/', i + 2);
      const j = end < 0 ? src.length : end + 2;
      code += blank(src.slice(i, j));
      i = j;
      continue;
    }
    if (c === '/' && REGEX_PREFIX.test(code.trimEnd())) {
      let j = i + 1;
      let inClass = false;
      while (j < src.length && src[j] !== '\n') {
        if (src[j] === '\\') { j += 2; continue; }
        if (src[j] === '[') inClass = true;
        else if (src[j] === ']') inClass = false;
        else if (src[j] === '/' && !inClass) break;
        j += 1;
      }
      j += 1;
      while (j < src.length && /[a-z]/i.test(src[j])) j += 1;
      code += blank(src.slice(i, j));
      i = j;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') {
      let j = i + 1;
      let s = '';
      while (j < src.length && src[j] !== c) {
        if (src[j] === '\\') { s += src[j + 1]; j += 2; continue; }
        if (c === '`' && src[j] === '$' && src[j + 1] === '{') {
          let depth = 1;
          const from = j + 2;
          j = from;
          while (j < src.length && depth > 0) {
            if (src[j] === '{') depth += 1;
            else if (src[j] === '}') depth -= 1;
            j += 1;
          }
          // An interpolation's own literals are copy too: `${x ? ` (lowered to …)` : ''}`.
          nested.push(...splitSource(src.slice(from, j - 1)).strings);
          s += ' ';
          continue;
        }
        if (c !== '`' && src[j] === '\n') break;
        s += src[j];
        j += 1;
      }
      if (strings.length && /^\s*\+\s*$/.test(src.slice(lastEnd, i))) strings[strings.length - 1] += s;
      else strings.push(s);
      code += blank(src.slice(i, j + 1));
      i = j + 1;
      lastEnd = i;
      continue;
    }
    code += c;
    i += 1;
  }
  return { code, strings: [...strings, ...nested] };
}

const MODULES = jsFiles('src/js').map((file) => ({ file, ...splitSource(read(file)) }));

function codeHits(re, { except = [] } = {}) {
  const hits = [];
  for (const { file, code } of MODULES) {
    code.split('\n').forEach((line, n) => {
      if (!re.test(line)) return;
      if (except.some((e) => e.file === file && e.line.test(line))) return;
      hits.push(`${file}:${n + 1}: ${line.trim()}`);
    });
  }
  return hits;
}

test('the scanner blanks comments, strings and regular expressions and keeps the code', () => {
  const src = [
    "const a = 0.95; // 0.95 in a comment",
    "/* 0.95 */ const b = '0.95 ×' + 'x';",
    'const c = `limit ${Math.round(f * 100)} %`;',
    'const d = /0\\.95/g.test(s) ? 1 / 2 : 0;',
    "const e = `a${ok ? ` (lowered to ${f})` : ''}`;",
  ].join('\n');
  const { code, strings } = splitSource(src);
  const lines = code.split('\n');
  assert.equal(lines.length, 5);
  assert.match(lines[0], /const a = 0\.95;\s*$/);
  assert.doesNotMatch(lines[1], /0\.95/);
  assert.doesNotMatch(lines[3], /0\\?\.95/);
  assert.match(lines[3], /1 \/ 2/);
  assert.deepEqual(strings, ['0.95 ×x', 'limit   %', 'a ', ' (lowered to  )', '']);
});

// ------------------------------------------------------------------ the Nyquist factor

/**
 * Literal 0.95 that is not the Nyquist factor, each with the reason it stays:
 *   spectrum.js     Welch segment overlap bound (a fraction of a segment, not of Nyquist)
 *   measure-charts  a stroke colour's alpha
 *   rta.js          NYQUIST_FRACTION, the band-selection edge of the versioned RTA method
 *                   (oscilla.rta.v1/v2, docs/v3/algorithms.md): an analysis parameter of a
 *                   stored result, equal in value to the generation limit but not bound to it,
 *                   so a change of the generation limit can never alter band selection of an
 *                   existing method without a new algorithm id.
 *   drive.js        DRIVE_CLIP, the Drive stage's output bound: an amplitude (the clip curve
 *                   holds the output at 0.95 of full scale), not a fraction of Nyquist (K012).
 */
const NOT_THE_NYQUIST_FACTOR = [
  { file: 'src/js/measurement/spectrum.js', line: /overlap\s*<=\s*0\.95/ },
  { file: 'src/js/charts/measure-charts.js', line: /withAlpha\(\w+, 0\.95\)/ },
  { file: 'src/js/measurement/rta.js', line: /^export const NYQUIST_FRACTION = 0\.95;$/ },
  { file: 'src/js/audio/drive.js', line: /^export const DRIVE_CLIP = 0\.95;$/ },
];

test('0.95 × Nyquist is SAFE_NYQUIST_FACTOR of core/constants.js, never a literal elsewhere', () => {
  const hits = codeHits(/(?<![\w.])0?\.95(?![\d])/, { except: [
    { file: 'src/js/core/constants.js', line: /^export const SAFE_NYQUIST_FACTOR = 0\.95;/ },
    ...NOT_THE_NYQUIST_FACTOR,
  ] });
  assert.deepEqual(hits, [], 'import SAFE_NYQUIST_FACTOR instead of typing 0.95');
});

test('the deliberate exceptions still exist (a stale exception hides nothing)', () => {
  for (const e of NOT_THE_NYQUIST_FACTOR) {
    const m = MODULES.find((x) => x.file === e.file);
    assert.ok(m && m.code.split('\n').some((l) => e.line.test(l.trim())), `${e.file} ${e.line}`);
  }
});

// ------------------------------------------------------------------ named constants

/** Each constant and the one module that declares it; every other module imports it. */
const HOMES = Object.freeze({
  SAFE_NYQUIST_FACTOR: 'src/js/core/constants.js',
  SAFE_NYQUIST_FRACTION: null, // the measurement name: a re-export of SAFE_NYQUIST_FACTOR
  PROVISIONAL_SAMPLE_RATE: 'src/js/core/constants.js',
  FILTER_PREVIEW_SAMPLE_RATE: 'src/js/core/constants.js',
  GAIN_FLOOR: 'src/js/core/constants.js',
  START_OFFSET_S: 'src/js/core/constants.js',
  RENDER_QUANTUM: 'src/js/core/constants.js',
  QUANTUM: null,
  PREVIEW_RATE: null,
  CENTS_PER_OCTAVE: 'src/js/core/music.js',
  VALID_MIN_SNR_DB: 'src/js/measurement/transfer.js',
  VALIDITY_SMOOTHING_FRACTION: 'src/js/measurement/transfer.js',
});

test('each named constant is declared once, in its home module', () => {
  const hits = [];
  for (const [name, home] of Object.entries(HOMES)) {
    const re = new RegExp(`\\b(?:const|let|var)\\s+${name}\\s*=`);
    for (const { file, code } of MODULES) {
      if (file === home) continue;
      code.split('\n').forEach((line, n) => {
        if (re.test(line)) hits.push(`${file}:${n + 1}: ${line.trim()}`);
      });
    }
    const m = home && MODULES.find((x) => x.file === home);
    if (m && !new RegExp(`export const ${name}\\s*=`).test(m.code)) hits.push(`${home}: no ${name}`);
  }
  assert.deepEqual(hits, [], 'import the constant from its home module');
});

test('the render quantum is RENDER_QUANTUM, never a literal 128 per sample rate', () => {
  const hits = codeHits(/(?<![\w.])128\s*\/\s*[\w(]|[/*]\s*128(?![\w.])/);
  assert.deepEqual(hits, [], 'use RENDER_QUANTUM / sampleRate');
});

test('quality.js binds its reliable-mask criterion to transfer.js validity, not a copy', async () => {
  const q = MODULES.find((x) => x.file === 'src/js/measurement/quality.js').code;
  assert.match(q, /reliableMinSnrDb:\s*VALID_MIN_SNR_DB\b/);
  assert.match(q, /reliablePoolingFraction:\s*VALIDITY_SMOOTHING_FRACTION\b/);
  const { QUALITY_THRESHOLDS } = await import('../../src/js/measurement/quality.js');
  const transfer = await import('../../src/js/measurement/transfer.js');
  assert.equal(QUALITY_THRESHOLDS.reliableMinSnrDb, transfer.VALID_MIN_SNR_DB);
  assert.equal(QUALITY_THRESHOLDS.reliablePoolingFraction, transfer.VALIDITY_SMOOTHING_FRACTION);
});

// ------------------------------------------------------------------ copy

/** Copy that restated a constant by hand; each is now built from the constant. */
const TYPED_COPY = [
  [/\b95 %/, 'SAFE_NYQUIST_FACTOR as a percentage'],
  [/\b0\.95 [×x] /, 'SAFE_NYQUIST_FACTOR as a factor'],
  [/\b42\.1 kHz/, 'the sample rate 20 kHz needs under SAFE_NYQUIST_FACTOR'],
  [/model @ \d/, 'the Filter Lab preview rate'],
  [/captured (?:once|twice|three times|\d+ times)/, 'the characterize recipe repeats'],
  [/^\d+ steps × |up to \d+ steps/, 'the length of the preset frequency list'],
];

test('no string literal types a constant the code holds', () => {
  const hits = [];
  for (const { file, strings } of MODULES) {
    for (const s of strings) {
      for (const [re, what] of TYPED_COPY) if (re.test(s)) hits.push(`${file}: ${what}: ${s.slice(0, 90)}`);
    }
  }
  assert.deepEqual(hits, [], 'build the text from the constant');
});

test('the derived copy is byte-identical to the text it replaced', async () => {
  const constants = await import('../../src/js/core/constants.js');
  assert.equal(constants.SAFE_NYQUIST_FACTOR, 0.95);
  assert.equal(constants.PROVISIONAL_SAMPLE_RATE, 44100);

  const { DIGITAL_LIMIT_LABEL } = await import('../../src/js/visualization/spectrum-data.js');
  assert.equal(DIGITAL_LIMIT_LABEL, 'digital limit 95 %');

  const safety = await import('../../src/js/core/safety.js');
  const preset = { cfg: { source: 'single', pattern: 'tone', waveform: 'sine', frequency: 20000 } };
  assert.equal(safety.presetDisabledReason(preset, 19000, true),
    "Needs 20.00 kHz; this device's digital limit (95 % of Nyquist) is 19.00 kHz"
    + ' (provisional until audio starts).');
  assert.equal(safety.representability(21500, 22050, 20947.5),
    'Requested 21.50 kHz is above the digital limit (95 % of Nyquist); it is clamped to 20.95 kHz.');

  const { BUILTIN_PRESETS } = await import('../../src/js/data/presets.js');
  const byId = Object.fromEntries(BUILTIN_PRESETS.map((p) => [p.id, p]));
  assert.equal(byId['pt-octaves'].params, '8 steps × 400 ms');
  assert.equal(byId['pt-third'].params, 'up to 31 steps × 250 ms');
  assert.equal(byId['sw-upper'].desc,
    'From 12 kHz to the digital limit of this device (95 % of Nyquist).');
  const ref20k = BUILTIN_PRESETS.find((p) => p.cat === 'reference' && /Needs a sample rate/.test(p.desc));
  assert.ok(ref20k, 'the 20 kHz reference preset');
  assert.match(ref20k.desc, /Needs a sample rate of about 42\.1 kHz or more, so that 20 kHz stays below the digital limit \(95 % of Nyquist\)\.$/);

  const { NODE_REGISTRY } = await import('../../src/js/studio/registry.js');
  const texts = NODE_REGISTRY.list().map((d) => (d.help && d.help.constraints) || '')
    .filter((t) => /Nyquist/.test(t));
  assert.ok(texts.includes('Q is linear for every type and ignored by the shelves; gain applies '
    + 'to peaking and the shelves only. Cutoff is limited to 0.95 × the digital Nyquist limit.'),
  texts.join(' | '));
  assert.ok(texts.includes('A modulation path may not lead back to its own source. Rate is '
    + 'limited to 0.95 × the digital Nyquist limit of the running audio context.'),
  texts.join(' | '));
  assert.ok(texts.includes('Frequencies are limited to 0.95 × the digital Nyquist limit of the '
    + 'running audio context.'), texts.join(' | '));

  const flow = await import('../../src/js/measurement/views/measure-flow.js');
  assert.equal(flow.CHARACTERIZE_PLAYBACK_CHAIN.description,
    'Measures the observed playback/capture chain response: a noise-floor check, '
    + 'then a logarithmic sweep played and captured three times and averaged. The result '
    + 'includes the output processing, speaker, room, microphone position, microphone, ADC and '
    + 'browser input processing; it is not the response of the speaker alone.');
  const f2 = flow.expertFields({ sampleRate: 48000 }).groups.flatMap((g) => g.fields)
    .find((f) => f.id === 'f2');
  assert.equal(f2.help, 'Limited to 0.95 × Nyquist of the device rate.');
});

test('the Filter Lab labels the rate it models, and Learn says which display assumes what', async () => {
  const constants = await import('../../src/js/core/constants.js');
  const filterLab = read('src/js/labs/filter-lab.js');
  assert.match(filterLab, /FILTER_PREVIEW_SAMPLE_RATE/);
  assert.equal(constants.FILTER_PREVIEW_SAMPLE_RATE, 48000);
  const { LEARN_TOPICS } = await import('../../src/js/data/learn.js');
  const body = LEARN_TOPICS.find((t) => t.id === 'samplerate').body;
  assert.match(body, /until then the display assumes 44\.1 kHz provisionally and marks it as such/);
  assert.match(body, /the Filter Lab models its response at 48 kHz and labels it/);
});
