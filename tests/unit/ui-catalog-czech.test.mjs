// Rule project.czech-prose (Q104): the UI catalogue speaks Czech. The command palette (U130),
// the About page and every other surface derived from the catalogue (ADR 0081) show a
// declaration's `label` and `docs` as written, so an English label there is English on a Czech
// page. Every component declared in src/js/ui/catalog/decl/ is judged by the repository's own
// measure (scripts/czech-prose.mjs isEnglishProse, scripts/czech-prose-short.mjs
// isShortEnglish). That measure only knows the UI words of its vocabulary, so it misses labels
// such as 'Timeline' or 'Navbar'. A second check covers them: a label with no Czech letter
// consists only of the technical names the rule lets stand and of the listed Czech words that
// happen to have no diacritic, and neither list may hold a word of the English vocabulary. The
// catalogue also uses the one Czech term per concept that docs/GLOSSARY.md lists ("Czech terms,
// one per concept").
//
// The node faces (studio.node.<type>) are left out: registry.js derives them from the Studio
// node registry's displayName and help, which are not declared in decl/.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { DECLARATIONS } from '../../src/js/ui/catalog/registry.js';
import { ROOT, isEnglishProse } from '../../scripts/czech-prose.mjs';
import { ENGLISH, TERMS, isShortEnglish } from '../../scripts/czech-prose-short.mjs';

const CZECH_LETTER = /[áčďéěíňóřšťúůýž]/i;

/** Technical names that stay as they are inside Czech text (rule project.czech-prose), beyond
 *  the measure's TERMS: the product, its workspaces, the patch bay, the pads and their sides. */
const NAMES = new Set(['oscilla', 'studio', 'synth', 'q', 'bay', 'pad', 'l', 'r', 'tempo']);

/** Czech words of the labels that carry no diacritic, so the letter test cannot see them. */
const CZECH_PLAIN = new Set(`
  akce banka enginy exportovat filtru hledat hodiny hraje kabely knihovna knihovny krok
  mikrofon monitor na nahradit noty odkaz panel parametr patche podrobnosti popis poslech pady
  povolit propojit smazat sonda stav studia synthu transport transportu typ vymazat vzoru zastavit
`.split(/\s+/).filter(Boolean));

const measuresEnglish = (text) => isShortEnglish(text) || isEnglishProse(text);
const wordsOf = (text) => text.toLowerCase().match(/[\p{L}\d&'-]+/gu) || [];

/** Why a catalogue label is not Czech, or null when it is. */
function labelProblem(label) {
  if (measuresEnglish(label)) return 'measures as English (scripts/czech-prose*.mjs)';
  if (CZECH_LETTER.test(label)) return null;
  const unknown = wordsOf(label).filter((w) => !TERMS.has(w) && !NAMES.has(w)
    && !CZECH_PLAIN.has(w));
  return unknown.length ? `has no Czech letter, and ${unknown.join(', ')} is neither a kept `
    + 'technical name nor a listed Czech word' : null;
}

/** Why a catalogue docs sentence is not Czech, or null when it is. */
function docsProblem(docs) {
  if (measuresEnglish(docs)) return 'measures as English (scripts/czech-prose*.mjs)';
  return CZECH_LETTER.test(docs) ? null : 'has no Czech letter';
}

/** The glossary's one term per concept: [{ term, rejected: [word] }]. */
function glossaryTerms(markdown) {
  const at = markdown.indexOf('**Czech terms, one per concept.**');
  if (at < 0) return [];
  const end = markdown.indexOf('\n\n**', at + 1);
  const block = markdown.slice(at, end < 0 ? undefined : end);
  return [...block.matchAll(/\*([^*\n]+)\* \(not ([^)]+)\)/g)].map((m) => ({
    term: m[1].trim(),
    rejected: m[2].split(/,\s*not\s+/).map((w) => w.trim()).filter(Boolean),
  }));
}

/** The rejected variants that `text` uses (whole words, any case). */
function rejectedIn(text, terms) {
  return terms.flatMap(({ rejected }) => rejected).filter((w) => new RegExp(
    `(?<![\\p{L}])${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\p{L}])`, 'iu').test(text));
}

const GLOSSARY = readFileSync(path.join(ROOT, 'docs/GLOSSARY.md'), 'utf8');

test('every catalogue label of decl/ is Czech', () => {
  const bad = DECLARATIONS.map((d) => [d.id, d.label, labelProblem(d.label)])
    .filter(([, , why]) => why).map(([id, label, why]) => `${id} "${label}": ${why}`);
  assert.deepEqual(bad, [], 'write the label in Czech (rule project.czech-prose, Q104)');
});

test('every catalogue docs sentence of decl/ is Czech', () => {
  const bad = DECLARATIONS.map((d) => [d.id, docsProblem(d.docs)]).filter(([, why]) => why)
    .map(([id, why]) => `${id}: ${why}`);
  assert.deepEqual(bad, [], 'write the docs sentence in Czech (rule project.czech-prose, Q104)');
});

test('the catalogue uses the glossary\'s one Czech term for gate, gain and velocity', () => {
  const terms = glossaryTerms(GLOSSARY);
  assert.deepEqual(terms.map((t) => t.term), ['brána', 'zesílení', 'úhoz']);
  assert.deepEqual(terms.map((t) => t.rejected),
    [['Hradlo', 'Gate'], ['Gain'], ['Síla úhozu', 'Velocity']]);
  const bad = DECLARATIONS.flatMap((d) => rejectedIn(`${d.label} ${d.docs}`, terms)
    .map((w) => `${d.id} uses "${w}"`));
  assert.deepEqual(bad, []);
});

test('the kept names and the plain Czech words hold no word of the English vocabulary', () => {
  assert.deepEqual([...NAMES, ...CZECH_PLAIN].filter((w) => ENGLISH.has(w)), []);
});

test('mutation: an English label or docs sentence is refused, a Czech one passes', () => {
  for (const t of ['Studio toolbar', 'Loop', 'Timeline', 'Navbar', 'Return, Play, Stop',
    'Snap', 'Patch library', 'Keyboard handle']) {
    assert.ok(labelProblem(t), `refused: ${t}`);
  }
  for (const t of ['Lišta Studia', 'Smyčka', 'Časová osa', 'Stav MIDI', 'Patch bay', 'Q',
    'Pad L', 'Knihovna patchů', 'Hraje']) {
    assert.equal(labelProblem(t), null, `passes: ${t}`);
  }
  assert.ok(docsProblem('Starts the Studio transport from the toolbar.'));
  assert.ok(docsProblem('Lists stuff here.'));
  assert.equal(docsProblem('Spustí transport Studia z lišty časové osy.'), null);
});

test('mutation: a rejected variant in a catalogue text is named, the chosen term is not', () => {
  const terms = glossaryTerms(GLOSSARY);
  assert.deepEqual(rejectedIn('Hradlo otevře obálku', terms), ['Hradlo']);
  assert.deepEqual(rejectedIn('Nastaví Gain a síla úhozu', terms), ['Gain', 'Síla úhozu']);
  assert.deepEqual(rejectedIn('Otevřená brána, zesílení a úhoz', terms), []);
  assert.deepEqual(rejectedIn('Gates and gained', terms), []);
  assert.deepEqual(glossaryTerms('no list here'), []);
});
