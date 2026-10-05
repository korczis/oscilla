// Rule project.no-fake-science v2: the shipped copy makes no medical, therapeutic, wellness,
// cognitive, pseudoscientific, animal-effect, inaudibility, frequency-safety, calibration or
// ultrasound claim the application cannot support.
//
// The scan reads what a user can be shown: src/index.html without its HTML comments, and the
// string literals (not the comments) of src/js/ui/** and src/js/data/**. Each banned phrase is
// a claim by construction; a sentence that negates it ("not ultrasound", "no therapeutic
// effect") is a disclaimer and passes. Levels labelled dB SPL are the claim
// spl-only-with-level-calibration (ADR 0017), proven by its own tests on the rendered app,
// because whether a level calibration applies is runtime state no text scan can see.
//   node --test tests/unit/no-fake-science.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (rel) => readFileSync(path.join(ROOT, rel), 'utf8');

/** The banned claims, by kind. Each pattern is matched case-insensitively. */
export const BANNED = Object.freeze([
  ['medical', /\b(?:therap(?:y|ies|eutic)|heal(?:s|ing)?|cur(?:e|es|ed)|medical(?:ly)?)\b/],
  ['medical', /\b(?:tinnitus|insomnia|anxiety|depression|migraines?|ADHD)\b/],
  ['medical', /\b(?:pain|stress) relief\b/],
  ['medical', /\b(?:hearing (?:test|screening)|audiometr(?:y|ic)|diagnos(?:e|es|is))\b/],
  ['wellness', /\b(?:sleep|relaxation|relaxing|meditation|meditative|mindfulness|wellness|well-?being|calming)\b/],
  ['cognitive', /\b(?:cognitive|brain ?waves?|entrainment)\b/],
  ['cognitive', /\b(?:improves?|boosts?|enhances?|increases?|sharpens?) (?:your )?(?:focus|memory|concentration|productivity|mood|creativity)\b/],
  ['cognitive', /\bfocus (?:boost|enhancement|frequenc(?:y|ies)|music|beats?)\b/],
  ['pseudoscience', /\b(?:solfeggio|chakras?|miracle|DNA|auras?|sacred frequenc(?:y|ies)|vibrational (?:healing|medicine)|frequency of (?:love|the universe))\b/],
  ['animal effect', /\b(?:repels?|repellents?|deterrents?|dog whistles?|mosquito(?:es)?|pests?)\b/],
  ['inaudibility', /\b(?:inaudible|silent) to (?:humans|people|you|adults)\b/],
  ['frequency safety', /\b(?:safe (?:frequenc(?:y|ies)|to listen|for (?:your )?(?:ears|hearing))|harmless)\b/],
  ['ultrasound', /\b(?:1\d|[1-9])(?:\.\d+)? ?kHz (?:is |are )?(?:an? )?ultraso(?:und|nic)\b/],
  ['ultrasound', /\b(?:emits?|produces?|plays?|outputs?) (?:real |true )?ultrasound\b/],
  ['calibration', /\b(?:calibrated (?:SPL|sound pressure)|true SPL|accurate SPL|certified|lab(?:oratory)?-grade|IEC[ -]?6(?:1672|1260)(?:-1)? class|class [12] (?:meter|microphone|instrument))\b/],
]);

const NEGATION = /\b(?:not|no|never|nor|neither|without|isn't|aren't|doesn't|don't|cannot)\b/i;

/** Banned claims in a text: [{ kind, phrase, sentence }], negated sentences excepted. */
export function bannedClaims(text) {
  const hits = [];
  for (const [kind, re] of BANNED) {
    const g = new RegExp(re.source, 'gi');
    for (const m of text.matchAll(g)) {
      const before = text.slice(0, m.index);
      const start = Math.max(before.search(/[^.!?;:\n]*$/), 0);
      const sentence = text.slice(start, m.index);
      if (NEGATION.test(sentence)) continue;
      hits.push({ kind, phrase: m[0], sentence: (sentence + m[0]).trim().slice(-120) });
    }
  }
  return hits;
}

/** The string literals of a JavaScript source, comments excluded. */
export function stringLiterals(src) {
  const out = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === '/' && src[i + 1] === '/') { i = src.indexOf('\n', i); if (i < 0) break; continue; }
    if (c === '/' && src[i + 1] === '*') { i = src.indexOf('*/', i + 2); if (i < 0) break; i += 2; continue; }
    if (c === "'" || c === '"' || c === '`') {
      let j = i + 1;
      let s = '';
      while (j < src.length && src[j] !== c) {
        if (src[j] === '\\') { s += src[j + 1]; j += 2; continue; }
        if (c !== '`' && src[j] === '\n') break;
        s += src[j];
        j += 1;
      }
      out.push(s);
      i = j + 1;
      continue;
    }
    i += 1;
  }
  return out;
}

function jsFiles(rel) {
  return readdirSync(path.join(ROOT, rel), { withFileTypes: true }).flatMap((d) => {
    const p = `${rel}/${d.name}`;
    if (d.isDirectory()) return jsFiles(p);
    return p.endsWith('.js') ? [p] : [];
  });
}

/** What a user can be shown: [{ file, text }]. */
export function shippedCopy() {
  const html = read('src/index.html').replace(/<!--[\s\S]*?-->/g, ' ');
  const copy = [{ file: 'src/index.html', text: html }];
  for (const f of [...jsFiles('src/js/ui'), ...jsFiles('src/js/data')]) {
    copy.push({ file: f, text: stringLiterals(read(f)).join('\n') });
  }
  return copy;
}

test('the matcher catches each kind of claim and lets a disclaimer through', () => {
  const claims = [
    'This tone has a therapeutic effect.', 'Healing frequencies for the soul.',
    'Relieves tinnitus in minutes.', 'Use it as a hearing test.', 'Deep sleep tones.',
    'Binaural beats for relaxation.', 'Boosts your focus while you work.', 'Brainwave sync.',
    'The 528 Hz Solfeggio scale.', 'A mosquito repellent tone.', 'Inaudible to humans.',
    'A safe frequency for your ears.', '15.5 kHz is ultrasound.', 'Your speaker emits ultrasound.',
    'Calibrated SPL readings.', 'A certified meter.',
  ];
  for (const c of claims) assert.ok(bannedClaims(c).length > 0, `caught: ${c}`);
  const disclaimers = [
    'High-frequency signal, not ultrasound.', 'Level is relative, not calibrated.',
    'Some listeners perceive a 6 Hz binaural beat. Headphones required.',
    'No therapy, sleep or focus benefit is claimed.', 'Keyboard focus moves to the next node.',
    'Relative (dBFS); dB SPL only with a level calibration in MEASURE.',
    '60 dB SPL audibility limits, behavioural audiogram.', 'LSU Veterinary Medicine',
    'Behavioral Neuroscience 97(2):310-318', 'Generating >20 kHz digitally does not mean a '
      + 'speaker emits ultrasound.', 'Start at a low level: OSCILLA caps the logical gain.',
  ];
  for (const d of disclaimers) assert.deepEqual(bannedClaims(d), [], `allowed: ${d}`);
});

test('the string scanner reads literals and skips comments', () => {
  const src = "// therapy in a comment\nconst a = 'one \\'two\\''; /* healing */ const b = `x\ny`;\n"
    + "const u = 'https://example.org/a'; const c = \"d\";";
  assert.deepEqual(stringLiterals(src), ["one 'two'", 'x\ny', 'https://example.org/a', 'd']);
});

test('the shipped copy makes none of the banned claims', () => {
  const copy = shippedCopy();
  assert.ok(copy.length > 10, 'the UI and data modules were read');
  assert.ok(copy.some((c) => c.file === 'src/js/data/presets.js' && /not ultrasound/.test(c.text)),
    'the scan sees preset copy');
  const hits = copy.flatMap(({ file, text }) => bannedClaims(text)
    .map((h) => `${file}: ${h.kind} "${h.phrase}" in "${h.sentence}"`));
  assert.deepEqual(hits, [], `banned claims:\n  ${hits.join('\n  ')}`);
});
