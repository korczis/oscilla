// G002: one units module. src/js/core/frequency.js owns the frequency grammar and the frequency,
// millisecond, seconds and clock texts; every other entry point (charts/axes.js,
// sequencer/model.js, the compact Studio, the Studio timeline view) hands back what it gives.
//
// Two halves: the same input table through every entry point gives the same result, and a
// static scan of src/js (comments removed) finds one body each of formatMs, formatClock and
// formatFrequency (and of parseFrequency), so a second grammar or text cannot return unseen.
// Namespace imports: an entry point that is missing fails its own test, not the file.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import * as units from '../../src/js/core/frequency.js';
import * as axes from '../../src/js/charts/axes.js';
import * as sequencer from '../../src/js/sequencer/model.js';
import * as compact from '../../src/js/ui/studio/compact.js';
import * as timelineView from '../../src/js/ui/studio/timeline-view.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SRC = path.join(ROOT, 'src', 'js');

// ---------------------------------------------------------------- the frequency grammar

const REFUSED = 'Frequency must be a finite number greater than 0 Hz.';

/** The input table of G002 and what every entry point must answer. */
const PARSE_TABLE = [
  ['2,5k', { ok: true, value: 2500 }],
  ['2.5 kHz', { ok: true, value: 2500 }],
  ['2500', { ok: true, value: 2500 }],
  ['0', { ok: false, error: REFUSED }],
  ['-5', { ok: false, error: REFUSED }],
  ['abc', { ok: false, error: '“abc” is not a frequency. Try 440, 440 Hz, 1k or 15.5 kHz.' }],
  ['1e309', { ok: false, error: REFUSED }],
];

const PARSERS = {
  'core/frequency.js parseFrequency': () => units.parseFrequency,
  'charts/axes.js parseFrequency (Filter Lab)': () => axes.parseFrequency,
};

for (const [name, get] of Object.entries(PARSERS)) {
  test(`G002 grammar: ${name} answers the input table`, () => {
    const parse = get();
    assert.equal(typeof parse, 'function', `${name} is exported`);
    for (const [input, want] of PARSE_TABLE) {
      assert.deepEqual(parse(input), want, `${name}(${JSON.stringify(input)})`);
    }
  });
}

test('G002 grammar: one sentence refuses zero, negatives and non-finite values', () => {
  for (const v of [0, -5, NaN, Infinity, -Infinity, '0', '0k', '-5', '-2,5k', '1e309', '0,0']) {
    assert.deepEqual(units.parseFrequency(v), { ok: false, error: REFUSED }, JSON.stringify(v));
  }
});

test('G002 grammar: a comma decimal, a k suffix, a unit and an exponent are accepted', () => {
  const accepted = [
    ['440', 440], ['440 Hz', 440], ['440 hertz', 440], ['1k', 1000], ['1 kHz', 1000],
    ['1 k Hz', 1000], ['2 kilohertz', 2000], ['15.5k', 15500], ['1,5k', 1500],
    ['1,5 kHz', 1500], ['0,5', 0.5], ['.5', 0.5], [',5', 0.5], ['+440', 440], ['1e3', 1000],
    ['2.5E3 Hz', 2500], [440, 440],
  ];
  for (const [input, value] of accepted) {
    assert.deepEqual(units.parseFrequency(input), { ok: true, value }, JSON.stringify(input));
  }
  for (const input of ['1.5.5', '1,5,5', 'A4', '440hzz', 'k', 'hz', '１２', '440 Hz!']) {
    assert.equal(units.parseFrequency(input).ok, false, JSON.stringify(input));
  }
});

// ---------------------------------------------------------------- one text per quantity

/** Every entry point of one quantity must give the same text for the same value. */
function sameText(entries, table) {
  for (const [name, get] of Object.entries(entries)) {
    const fn = get();
    assert.equal(typeof fn, 'function', `${name} is exported`);
    for (const [input, want] of table) {
      assert.equal(fn(input), want, `${name}(${input})`);
    }
  }
}

test('G002 texts: one frequency text for controls and readouts', () => {
  sameText({ 'core formatFrequency': () => units.formatFrequency }, [
    [440, '440 Hz'], [440.5, '440.50 Hz'], [2500, '2.50 kHz'], [15500, '15.50 kHz'],
    [NaN, '—'],
  ]);
});

test('G002 texts: one compact frequency text for charts and the sequencer', () => {
  sameText({
    'core formatFrequencyCompact': () => units.formatFrequencyCompact,
    'charts/axes.js formatHz': () => axes.formatHz,
    'sequencer/model.js formatCompactFrequency': () => sequencer.formatCompactFrequency,
  }, [
    [440, '440 Hz'], [1200, '1.2 kHz'], [2500, '2.5 kHz'], [15500, '15.5 kHz'],
    [17600, '17.6 kHz'], [120000, '120 kHz'], [31, '31 Hz'], [0.125, '0.125 Hz'],
    [NaN, '—'],
  ]);
});

test('G002 texts: one millisecond text', () => {
  sameText({
    'core formatMs': () => units.formatMs,
    'sequencer/model.js formatMs': () => sequencer.formatMs,
  }, [[0, '0 ms'], [5, '5 ms'], [999.4, '999 ms'], [1000, '1 s'], [1500, '1.5 s'],
    [12345, '12.3 s'], [NaN, '—']]);
});

test('G002 texts: one seconds text', () => {
  sameText({
    'core formatSeconds': () => units.formatSeconds,
    'ui/studio/timeline-view.js formatSecondsText': () => timelineView.formatSecondsText,
  }, [[1.25, '1.250 s'], [0, '0.000 s'], [NaN, '0.000 s']]);
});

test('G002 texts: one clock, which floors (never shows a time not yet reached)', () => {
  sameText({
    'core formatClock': () => units.formatClock,
    'ui/studio/timeline-view.js formatClock': () => timelineView.formatClock,
    'ui/studio/compact.js compactTime': () => compact.compactTime,
  }, [
    [0, '00:00.000'], [4.21, '00:04.210'], [1.0006, '00:01.000'], [59.9996, '00:59.999'],
    [65.0005, '01:05.000'], [65.5, '01:05.500'], [-1, '00:00.000'], [NaN, '00:00.000'],
  ]);
});

// ---------------------------------------------------------------- one body each (static scan)

function sourceFiles(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...sourceFiles(p));
    else if (e.name.endsWith('.js')) out.push(p);
  }
  return out.sort();
}

// A '/' after one of these (or at the start) opens a regular expression literal, not a division.
const BEFORE_REGEX = new Set(['', '(', ',', '=', ':', '[', '!', '&', '|', '?', '{', '}', ';',
  '+', '-', '*', '%', '<', '>', '~', '^']);

/** The end (index after the closing '/') of the regular expression literal opening at i. */
function regexEnd(text, i) {
  let inClass = false;
  for (let j = i + 1; j < text.length; j++) {
    const c = text[j];
    if (c === '\\') j += 1;
    else if (c === '\n') return j;
    else if (c === '[') inClass = true;
    else if (c === ']') inClass = false;
    else if (c === '/' && !inClass) return j + 1;
  }
  return text.length;
}

/** The last character of `out` that is not whitespace ('' when there is none). */
function lastCode(out) {
  let j = out.length - 1;
  while (j >= 0 && /\s/.test(out[j])) j -= 1;
  return j < 0 ? '' : out[j];
}

/** Source text with block and line comments removed (strings, templates and regexes kept). */
function stripComments(text) {
  let out = '';
  let i = 0;
  let quote = null;
  while (i < text.length) {
    const c = text[i];
    const n = text[i + 1];
    if (quote) {
      out += c;
      if (c === '\\') { out += n || ''; i += 2; continue; }
      if (c === quote) quote = null;
      i += 1;
      continue;
    }
    if (c === '/' && n !== '*' && n !== '/' && BEFORE_REGEX.has(lastCode(out))) {
      const end = regexEnd(text, i);
      out += text.slice(i, end);
      i = end;
      continue;
    }
    if (c === '/' && n === '*') {
      const end = text.indexOf('*/', i + 2);
      i = end < 0 ? text.length : end + 2;
      continue;
    }
    if (c === '/' && n === '/') {
      const end = text.indexOf('\n', i);
      i = end < 0 ? text.length : end;
      continue;
    }
    if (c === '\'' || c === '"' || c === '`') quote = c;
    out += c;
    i += 1;
  }
  return out;
}

/** Where `name` gets a body: a function declaration, a function-valued binding or a method. */
function definitions(name) {
  const decl = new RegExp(`\\bfunction\\s*\\*?\\s*${name}\\s*\\(`);
  const bound = new RegExp(`\\b(?:const|let|var)\\s+${name}\\s*=\\s*(?:async\\s*)?`
    + '(?:function\\b|\\([^)]*\\)\\s*=>|[\\w$]+\\s*=>)');
  const method = new RegExp(`^\\s*${name}\\s*\\([^)]*\\)\\s*\\{`);
  const found = [];
  for (const file of sourceFiles(SRC)) {
    const lines = stripComments(fs.readFileSync(file, 'utf8')).split('\n');
    lines.forEach((line, i) => {
      if (decl.test(line) || bound.test(line) || method.test(line)) {
        found.push(`${path.relative(ROOT, file)}:${i + 1}`);
      }
    });
  }
  return found;
}

test('G002 scan: the comment stripper keeps code and strings', () => {
  const src = 'const a = \'http://x\'; // note\n/* function formatMs() {} */\nfunction b() {}';
  assert.equal(stripComments(src), 'const a = \'http://x\'; \n\nfunction b() {}');
});

for (const name of ['formatMs', 'formatClock', 'formatFrequency', 'parseFrequency']) {
  test(`G002 scan: ${name} has one body in src/js, in core/frequency.js`, () => {
    assert.deepEqual(definitions(name).map((at) => at.replace(/:\d+$/, '')),
      ['src/js/core/frequency.js'], `bodies of ${name}`);
  });
}

test('G002 scan: the former formatters are aliases, not second bodies', () => {
  for (const name of ['compactTime', 'formatCompactFrequency', 'formatSecondsText']) {
    assert.deepEqual(definitions(name), [], `bodies of ${name}`);
  }
  const axesSrc = stripComments(fs.readFileSync(path.join(SRC, 'charts', 'axes.js'), 'utf8'));
  assert.doesNotMatch(axesSrc, /\bfunction\s+formatHz\s*\(/, 'charts/axes.js formatHz body');
});
