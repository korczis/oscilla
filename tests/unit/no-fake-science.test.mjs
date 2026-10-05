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
  ['medical', /\b(?:therap(?:y|ies|eutic)|medical(?:ly)?)\b/],
  ['medical', /\bheal(?:s|ing)?\b(?!\s+times?\b)/],
  ['medical', /\b(?:alzheimer'?s?|dementia|parkinson'?s?|autism|epilepsy)\b/],
  ['medical', /\bcalms? (?:the |your )?(?:nervous system|nerves|mind|brain|body)\b/],
  ['medical', /\b(?:never (?:feel|have|suffer|experience|worry about)|no more) (?:\w+ ){0,2}?(?:anxiety|stress|pain|insomnia|tinnitus|depression|migraines?|sleepless nights)\b/],
  ['medical', /\b(?:cures?|cured)\b(?!\s+times?\b)/],
  ['medical', /\b(?:tinnitus|insomnia|anxiety|depression|migraines?|ADHD)\b/],
  ['medical', /\b(?:reduces?|relieves?|lowers?|eases?|fights?|treats?|melts?) (?:your )?(?:stress|tension|pain|blood pressure)\b/],
  ['medical', /\b(?:pain|stress) relief\b|\bstress-free\b/],
  ['medical', /\b(?:hearing (?:test|screening|check)|audiometr(?:y|ic)|test (?:your )?hearing)\b/],
  ['medical', /\bdiagnos(?:e|es|is|ing) (?:your |a )?(?:hearing|tinnitus|deafness|hearing loss|ears?)\b/],
  ['wellness', /\b(?:relaxation|relaxing|calming|meditation|meditative|mindfulness|wellness|well-?being)\b/],
  ['wellness', /\bhelps? (?:you )?(?:to )?relax\b|\b(?:relax and unwind|unwind and relax)\b/],
  ['wellness', /\bsleep[- ]inducing\b/],
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

const ENTITIES = Object.freeze({
  nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", mdash: '—', ndash: '–',
  hellip: '…', lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', middot: '·', times: '×',
  plusmn: '±', deg: '°', micro: 'µ', thinsp: ' ', ensp: ' ', emsp: ' ', shy: '',
});

/**
 * Text as a reader sees it: HTML entities decoded, every tag a clause boundary (its attribute
 * values kept, since labels and titles are read too), whitespace collapsed, so hand-wrapped
 * lines, &nbsp; and markup cannot split a claim apart.
 */
export function normalize(text) {
  const decode = (t) => t
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&([a-z]+);/gi, (m, n) => (n.toLowerCase() in ENTITIES ? ENTITIES[n.toLowerCase()] : ' '));
  const tags = text.replace(/<\/?[a-z][^<>]*>/gi, (tag) => {
    const attrs = [...tag.matchAll(/=\s*(["'])([\s\S]*?)\1/g)].map(([, , v]) => v);
    return attrs.length ? ` ; ${attrs.join(' ; ')} ; ` : ' ; ';
  });
  return decode(tags).replace(/[\s ]+/g, ' ').trim();
}

// A claim is excused only by a negation that governs it:
// 1. a negation word among the five words before it, in its own clause. Clauses end at
//    sentence punctuation, commas, dashes, parentheses, tags and the conjunctions "and",
//    "but" and "or", so "No account needed and it improves sleep" is still a claim; an "or"
//    right before the phrase continues a negated clause ("does not reduce stress or
//    anxiety"), unless a pronoun starts a new one ("No ads or it heals tinnitus");
// 2. a negation that opens a list of claim nouns ending in a head noun: "no medical,
//    therapeutic or wellness claims", "No healing, therapy or sleep claim is made". A comma
//    that does not continue such a list ("Without headphones, binaural beats reduce
//    anxiety") does not carry the negation;
// 3. a negation right after it in its clause: "Brain waves are not affected" (but not "are
//    not just", "not only");
// 4. the same phrase negated elsewhere in its sentence: "Hearing test tone (not a hearing
//    test)".
const NEGATION = /^(?:not|no|never|nor|neither|without|isn't|aren't|doesn't|don't|cannot|can't)$/i;
const HARD_END = /[.!?;:()]|\s[—–-]{1,2}\s|—|–/g;
const SOFT_END = /,|\b(?:and|but|or)\b/gi;
const NEGATION_WINDOW = 5;
const PRONOUN = /^(?:it|this|that|they|we|you|he|she|which|who|these|those)$/i;
const LIST_HEADS = /\b(?:claims?|benefits?|effects?|purposes?|uses?|devices?|advice|treatments?|outcomes?|results?)\b/i;
const AFTER_NEGATION = /^\s*(?:is|are|was|were|does|do|did|will|can|has|have)\s+(?:not|never)\b(?!\s+(?:just|only|merely|simply))/i;

const hasNegation = (s) => s.split(/\s+/).some((w) => NEGATION.test(w.replace(/[^\w']/g, '')));
const lastEnd = (s, re) => {
  let end = 0;
  for (const m of s.matchAll(new RegExp(re.source, 'gi'))) end = m.index + m[0].length;
  return end;
};

/** Whether the phrase at text[index, index + length) is negated (rules 1-3 above). */
function negated(text, index, length) {
  const before = text.slice(0, index);
  const hard = lastEnd(before, HARD_END);
  const clauseStart = Math.max(hard, lastEnd(before, SOFT_END));
  const words = before.slice(clauseStart).split(/\s+/).filter(Boolean).slice(-NEGATION_WINDOW);
  if (words.some((w) => NEGATION.test(w.replace(/[^\w']/g, '')))) return true;
  // Rule 1b: "not X or Y": an "or" directly before the phrase (at most one word between, not
  // a pronoun that starts a new clause) continues the negated clause before it.
  const orAt = before.slice(clauseStart - 4 < hard ? hard : clauseStart - 4, clauseStart);
  if (/\b(?:or|nor)$/i.test(orAt) && words.length <= 1 && !words.some((w) => PRONOUN.test(w))) {
    const prev = before.slice(hard, clauseStart - orAt.match(/(?:or|nor)$/i)[0].length);
    if (negated(prev + ' x', prev.length + 1, 1)) return true;
  }
  // Rule 2: the span between hard boundaries is a negated list of claim nouns.
  const after = text.slice(index + length);
  const nextHard = after.search(new RegExp(HARD_END.source));
  const span = text.slice(hard, index + length + (nextHard < 0 ? after.length : nextHard));
  const items = span.split(new RegExp(SOFT_END.source, 'gi'));
  const commas = (span.match(/,/g) || []).length;
  const joiner = /\b(?:and|or)\b/i.test(span.slice(span.lastIndexOf(',') + 1));
  if (commas >= 1 && joiner && LIST_HEADS.test(items[items.length - 1])
    && hasNegation(text.slice(hard, index).split(',')[0])
    && items.slice(1).every((it) => it.trim().split(/\s+/).length <= 5)) return true;
  // Rule 3: the clause goes on to negate it.
  const clauseAfter = after.slice(0, Math.max(0, after.search(/[.!?;:,()]|$/)));
  return AFTER_NEGATION.test(clauseAfter);
}

/** Banned claims in a text: [{ kind, phrase, sentence }], negated phrases excepted. */
export function bannedClaims(raw) {
  const text = normalize(raw);
  const sentenceOf = (i) => {
    const from = Math.max(text.slice(0, i).search(/[^.!?]*$/), 0);
    const to = text.slice(i).search(/[.!?]/);
    return [from, to < 0 ? text.length : i + to];
  };
  const hits = [];
  for (const [kind, re] of BANNED) {
    const ms = [...text.matchAll(new RegExp(re.source, 'gi'))];
    const neg = ms.map((m) => negated(text, m.index, m[0].length));
    ms.forEach((m, k) => {
      if (neg[k]) return;
      // Rule 4: the same phrase is negated elsewhere in the sentence.
      const [from, to] = sentenceOf(m.index);
      const same = ms.some((o, j) => j !== k && neg[j] && o.index >= from && o.index < to
        && o[0].toLowerCase() === m[0].toLowerCase());
      if (same) return;
      hits.push({ kind, phrase: m[0], sentence: text.slice(from, m.index + m[0].length).slice(-120) });
    });
  }
  return hits;
}

/** The string literals of a JavaScript source, comments excluded. */
export function stringLiterals(src) {
  const out = [];
  let i = 0;
  let lastEnd = -1;
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
      if (c === '`') {
        s = s.replace(/\$\{\s*(['"])([^'"]*)\1\s*\}/g, '$2').replace(/\$\{[^}]*\}/g, ' ');
      }
      // 'a' + 'b' is one string as the reader sees it.
      if (out.length && /^\s*\+\s*$/.test(src.slice(lastEnd, i))) out[out.length - 1] += s;
      else out.push(s);
      i = j + 1;
      lastEnd = i;
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
    copy.push({ file: f, text: stringLiterals(read(f)).join(' ; ') });
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

test('normalisation: entities, tags and hand-wrapped lines do not hide a claim', () => {
  const claims = [
    'Improves your\n            sleep', 'Improves&nbsp;sleep', 'Fall&nbsp;asleep fast',
    '<p>Improves your\n            sleep tonight.</p>', 'Deep\n  sleep tones',
    'Improves&#160;sleep', 'Improves&#xA0;sleep',
  ];
  for (const c of claims) assert.ok(bannedClaims(c).length > 0, `caught: ${JSON.stringify(c)}`);
  assert.equal(normalize('a&nbsp;b &amp; c&mdash;d &#8212; e'), 'a b & c—d — e');
  assert.equal(normalize('<li>No account</li><li>Healing tones</li>').includes('No account Healing'),
    false, 'a tag is a clause boundary');
  assert.ok(normalize('<button aria-label="Deep sleep tones">x</button>').includes('Deep sleep tones'),
    'attribute text is kept');
  assert.ok(bannedClaims('<li>No account</li><li>Healing tones</li>').length > 0,
    'a negation does not cross a tag');
  // JavaScript: concatenated literals are read as one string.
  const lit = stringLiterals("const a = 'Improves ' + 'sleep';").join(' ; ');
  assert.ok(bannedClaims(lit).length > 0, `caught: ${lit}`);
  const tpl = stringLiterals("const b = `Improves ${'sleep'}`;").join(' ; ');
  assert.ok(bannedClaims(tpl).length > 0, `caught: ${tpl}`);
  assert.ok(bannedClaims(stringLiterals("const d = 'heal' + 's tinnitus';").join(' ; ')).length > 0);
});

test('clause boundaries: or and parentheses; bare heal; more claims', () => {
  const claims = [
    'No ads or it heals tinnitus.', 'No ads (it heals tinnitus).', '(Not a gimmick) heals tinnitus.',
    'This tone will heal you.', 'It can heal your ears.',
    'Calms the nervous system.', 'Never feel anxiety again.', 'Sleep-inducing tones.',
    'Relax and unwind.', "Gamma 40 Hz for Alzheimer's.", 'No more insomnia.',
    // A negation does not carry across a comma into a clause that is not a list item.
    'Without headphones, binaural beats reduce anxiety.',
    'No ads, no tracking and it heals tinnitus.',
    'Brain waves are not just synced, they are entrained.',
  ];
  for (const c of claims) assert.ok(bannedClaims(c).length > 0, `caught: ${c}`);
  for (const l of ['Good for your health.', 'The healthy range.', 'Health and safety notes.']) {
    assert.deepEqual(bannedClaims(l), [], `legitimate: ${l}`);
  }
});

test('a negation carries across a list, and a disclaimer naming the claim passes', () => {
  const disclaimers = [
    'OSCILLA makes no medical, therapeutic or wellness claims.',
    'No healing, therapy or sleep claim is made.',
    'Not&nbsp;a hearing test', 'Hearing test tone (not a hearing test)',
    'Brain waves are not affected.', 'Not a hearing test, not therapy, not a sleep aid.',
    'This is not meant to treat stress or pain.',
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
  // Every module under src/js/ can put a string on screen (Studio templates and node labels,
  // measurement quality reasons, chart captions), so every one is read.
  const files = new Set(copy.map((c) => c.file));
  for (const f of jsFiles('src/js')) assert.ok(files.has(f), `the scan reads ${f}`);
  const hits = copy.flatMap(({ file, text }) => bannedClaims(text)
    .map((h) => `${file}: ${h.kind} "${h.phrase}" in "${h.sentence}"`));
  assert.deepEqual(hits, [], `banned claims:\n  ${hits.join('\n  ')}`);
});
