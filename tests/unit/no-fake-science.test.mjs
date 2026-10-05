// Rule project.no-fake-science v2: the shipped copy makes no medical, therapeutic, wellness,
// cognitive, pseudoscientific, animal-effect, inaudibility, frequency-safety, calibration or
// ultrasound claim the application cannot support.
//
// The scan reads what a user can be shown: src/index.html without its HTML comments, and the
// string literals (not the comments) of every module under src/js/. Each banned phrase is
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

/**
 * The banned claims, by kind, each a phrase that makes the claim (matched case-insensitively).
 * A word that only looks like a claim ("sleep mode", "cognitive load", "harmless default",
 * "pests", "DNA") is not banned on its own; the phrase around it is.
 */
export const BANNED = Object.freeze([
  ['medical', /\b(?:therap(?:y|ies|eutic)|heal(?:s|ing)|medical(?:ly)?)\b/],
  ['medical', /\b(?:cures?|cured)\b(?!\s+times?\b)/],
  ['medical', /\b(?:tinnitus|insomnia|anxiety|depression|migraines?|ADHD)\b/],
  ['medical', /\b(?:reduces?|relieves?|lowers?|eases?|fights?|treats?|melts?) (?:your )?(?:stress|tension|pain|blood pressure)\b/],
  ['medical', /\b(?:pain|stress) relief\b|\bstress-free\b/],
  ['medical', /\b(?:hearing (?:test|screening|check)|audiometr(?:y|ic)|test (?:your )?hearing)\b/],
  ['medical', /\bdiagnos(?:e|es|is|ing) (?:your |a )?(?:hearing|tinnitus|deafness|hearing loss|ears?)\b/],
  ['wellness', /\b(?:relaxation|relaxing|calming|meditation|meditative|mindfulness|wellness|well-?being)\b/],
  ['wellness', /\bhelps? (?:you )?(?:to )?relax\b/],
  ['wellness', /\b(?:improves?|better|deeper|deep|aids?|helps?(?: you)?|promotes?|induces?|for) (?:your )?sleep\b(?!\s+mode)/],
  ['wellness', /\bsleep (?:aid|better|tones?|music|frequenc(?:y|ies)|sounds?|beats?)\b|\bfall asleep\b/],
  ['cognitive', /\b(?:brain ?waves?|entrainment|cognitive (?:benefits?|function|performance|enhancement|boost))\b/],
  ['cognitive', /\b(?:improves?|boosts?|enhances?|increases?|sharpens?) (?:your )?(?:focus|memory|concentration|productivity|mood|creativity|cognition|IQ|brain)\b/],
  ['cognitive', /\bfocus (?:boost|enhancement|frequenc(?:y|ies)|music|beats?)\b/],
  ['pseudoscience', /\b(?:solfeggio|chakras?|auras?|sacred frequenc(?:y|ies)|vibrational (?:healing|medicine)|frequency of (?:love|the universe)|miracle (?:tone|frequency))\b/],
  ['pseudoscience', /\b432 ?Hz (?:is|as) (?:the )?(?:natural|true|correct|cosmic|healing|universal|perfect)\b|\bnatural tuning\b/],
  ['pseudoscience', /\b(?:528 ?Hz (?:repairs?|heals?|love)|DNA (?:repair|healing|activation))\b/],
  ['animal effect', /\b(?:repels?|repellents?|deterrents?|dog whistles?|pest (?:control|repellent|deterrent)|mosquito (?:repellent|ringtone|deterrent|tone))\b/],
  ['animal effect', /\b(?:drives?|scares?|chases?|keeps?) (?:\w+ ){0,2}away\b|\b(?:drives?|scares?) off\b/],
  ['animal effect', /\bonly (?:dogs|cats|bats|animals|mice|rats|insects|pets|teens|teenagers|young people) can hear\b/],
  ['inaudibility', /\b(?:inaudible|silent) to (?:humans|people|you|adults)\b/],
  ['inaudibility', /\b(?:you|humans|people) (?:cannot|can't|can not|won't) hear (?:this|it|that)\b/],
  ['frequency safety', /\b(?:safe (?:frequenc(?:y|ies)|to listen|for (?:your )?(?:ears|hearing))|frequency is (?:safe|harmless))\b/],
  ['frequency safety', /\bharmless (?:to|for) (?:your )?(?:ears|hearing|health|you|humans|pets)\b/],
  ['ultrasound', /\b(?:1\d|[1-9])(?:\.\d+)? ?kHz (?:is |are )?(?:an? )?ultraso(?:und|nic)\b/],
  ['ultrasound', /\b(?:emits?|produces?|plays?|outputs?) (?:real |true )?ultrasound\b/],
  ['ultrasound', /\b(?:real|true|actual|genuine) ultraso(?:und|nic)\b/],
  ['ultrasound', /\bultraso(?:und|nic)(?: output| signal| sound)? from (?:your|a|the) (?:phone|laptop|speakers?|computer|device|headphones)\b/],
  ['calibration', /\b(?:calibrated (?:SPL|sound pressure)|true SPL|accurate SPL|lab(?:oratory)?[- ]grade|professional[- ]grade)\b/],
  ['calibration', /\baccurate to (?:within )?±? ?\d+(?:\.\d+)? ?dB\b/],
  ['calibration', /\bcertified (?:sound level )?(?:meter|instrument|microphone|measurements?|accuracy|readings?)\b/],
  ['calibration', /\b(?:IEC[ -]?6(?:1672|1260)(?:-1)? class|class [12] (?:meter|microphone|instrument))\b/],
]);

// A claim is excused only by a negation in its own clause, a few words before it ("not
// ultrasound", "does not mean a speaker emits ultrasound"). Clauses end at sentence
// punctuation, commas, dashes and the conjunctions "and" and "but", so "No account needed and
// it improves sleep" is still a claim.
const NEGATION = /^(?:not|no|never|nor|neither|without|isn't|aren't|doesn't|don't|cannot|can't)$/i;
const CLAUSE_END = /[.!?;:,\n]|\s[—–-]{1,2}\s|—|–|\b(?:and|but)\b/gi;
const NEGATION_WINDOW = 5;

/** Whether the words just before `index` in its clause negate what follows. */
function negated(text, index) {
  const before = text.slice(0, index);
  let start = 0;
  for (const m of before.matchAll(CLAUSE_END)) start = m.index + m[0].length;
  const words = before.slice(start).split(/\s+/).filter(Boolean).slice(-NEGATION_WINDOW);
  return words.some((w) => NEGATION.test(w.replace(/[^\w']/g, '')));
}

/** Banned claims in a text: [{ kind, phrase, sentence }], negated phrases excepted. */
export function bannedClaims(text) {
  const hits = [];
  for (const [kind, re] of BANNED) {
    for (const m of text.matchAll(new RegExp(re.source, 'gi'))) {
      if (negated(text, m.index)) continue;
      const from = Math.max(text.slice(0, m.index).search(/[^.!?\n]*$/), 0);
      hits.push({ kind, phrase: m[0], sentence: text.slice(from, m.index + m[0].length).trim().slice(-120) });
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
  for (const f of jsFiles('src/js')) {
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
    // A negation in an earlier clause, or further back, does not excuse the claim.
    'Without headphones, binaural beats reduce anxiety.',
    'Not just a tone, a healing frequency.',
    'No account needed and it improves sleep.',
    'Never miss a beat — 40 Hz boosts your focus.',
    'Does not need calibration, gives true SPL.',
    // Claims the first list did not reach.
    'This tone reduces stress.', 'A drone that helps you relax.',
    'A tone that drives away rats.', 'Only dogs can hear this.',
    'You cannot hear this frequency.', '432 Hz is the natural tuning.',
    'Lab grade measurements.', 'Accurate to ±1 dB SPL.', 'Real ultrasound output.',
    '25 kHz ultrasound from your phone.',
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
    'This is not a hearing test.', 'OSCILLA does not reduce stress or anxiety.',
  ];
  for (const d of disclaimers) assert.deepEqual(bannedClaims(d), [], `allowed: ${d}`);
  // Words that only look like claims: legitimate copy keeps passing.
  const legitimate = [
    'The display enters sleep mode.', 'Diagnose a dropout in the capture.',
    'A dense layout raises cognitive load.', 'A harmless default of -24 dB.',
    'Certified by nobody: compare with a reference meter.',
    'Mosquito hearing (Johnston organ) reaches into the kilohertz range.',
    'DNA', 'Pests', 'The epoxy cure time is irrelevant here.',
  ];
  for (const l of legitimate) assert.deepEqual(bannedClaims(l), [], `legitimate: ${l}`);
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
  // Every module under src/js/ can put a string on screen (Studio templates and node labels,
  // measurement quality reasons, chart captions), so every one is read.
  const files = new Set(copy.map((c) => c.file));
  for (const f of jsFiles('src/js')) assert.ok(files.has(f), `the scan reads ${f}`);
  const hits = copy.flatMap(({ file, text }) => bannedClaims(text)
    .map((h) => `${file}: ${h.kind} "${h.phrase}" in "${h.sentence}"`));
  assert.deepEqual(hits, [], `banned claims:\n  ${hits.join('\n  ')}`);
});
