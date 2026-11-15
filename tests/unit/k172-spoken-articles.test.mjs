// K172: spoken Studio text chooses 'a' or 'an' by how the word is said, not by its first letter
// (milestone M046, criterion engineering-integrity#screen-reader-pass; review of #410, R5).
// One helper, `article` of src/js/studio/a11y.js, decides the article for every node, type and
// option label the Studio speaks or shows; the filter-gain reason of graph-view.js, the
// notes-target reason of clip-targets.js and the type-mismatch refusal of patches.js read
// through it, and no other file under src/js decides an article.
//   node --test tests/unit/k172-spoken-articles.test.mjs
// Fail-first: on the merge base `article` does not exist and the sites test /^[aeiou]/i, so
// "an LFO", "an RTA" and "a Unison" fail.
// Tolerances: none (plain text).

import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import * as a11y from '../../src/js/studio/a11y.js';
import { createIdGenerator, createStudioStore } from '../../src/js/studio/actions.js';
import { CLIP_TARGET_TEXT } from '../../src/js/studio/clip-targets.js';
import { edgeEffectReason } from '../../src/js/ui/studio/graph-view.js';
import PANEL from '../../src/js/synth/panels/semi-mono.js';
import { presetPatch } from '../../src/js/synth/presets.js';
import { panelStore } from './synth-fixture.mjs';

const article = (label, sounds) => a11y.article(label, sounds);

/** [label, article]: each row is what a listener hears. */
const CASES = [
  // the acceptance criterion
  ['LFO', 'an'], ['RTA', 'an'], ['Filter', 'a'], ['Oscillator', 'an'], ['Unison', 'a'],
  // initialisms, by the name of their first letter (F, H, L, M, N, R, S, X and the vowels)
  ['EQ', 'an'], ['FM', 'an'], ['AM', 'an'], ['FFT', 'an'], ['ADSR', 'an'], ['XY pad', 'an'],
  ['HP', 'an'], ['SR', 'an'], ['NaN', 'a'],
  ['VCA', 'a'], ['VCO', 'a'], ['WAV', 'a'], ['PCM', 'a'], ['BPM', 'a'], ['DC', 'a'],
  // initialisms said as a word
  ['MIDI', 'a'], ['LUFS', 'a'],
  // words, by their first sound
  ['one-shot', 'a'], ['One-shot', 'a'], ['once', 'a'], ['unit', 'a'], ['user', 'a'],
  ['Unipolar', 'a'], ['unity', 'a'], ['hour', 'an'], ['honest', 'an'],
  ['All-pass', 'an'], ['Low-pass', 'a'], ['Envelope', 'an'], ['Master Output', 'a'],
  // the first word decides, whatever follows
  ['LFO 1', 'an'], ['Oscillator 2', 'an'], ['(Low-pass)', 'a'], ['±6 dB', 'a'],
  // numbers, by their first digits
  ['8-step', 'an'], ['80', 'an'], ['11', 'an'], ['18', 'an'], ['16-step', 'a'], ['1 kHz', 'a'],
  ['110', 'a'],
  // nothing to say
  ['', 'a'], ['   ', 'a'], [null, 'a'], [undefined, 'a'], ['—', 'a'],
];

test('K172: the article is decided by how the first word is said', () => {
  assert.equal(typeof a11y.article, 'function', 'a11y.js exports article');
  for (const [label, want] of CASES) {
    assert.equal(article(label), want, `${JSON.stringify(label)}`);
  }
});

test('K172: each list of ARTICLE_SOUNDS is load-bearing (mutation)', () => {
  const S = a11y.ARTICLE_SOUNDS;
  assert.ok(S && Object.isFrozen(S), 'ARTICLE_SOUNDS is a frozen table');
  // The vowel-named letters emptied: an initialism falls back to its first letter.
  assert.equal(article('LFO', { ...S, vowelLetterNames: '' }), 'a');
  assert.equal(article('RTA', { ...S, vowelLetterNames: '' }), 'a');
  // The said-as-a-word list emptied: MIDI is spelled out, M-I-D-I.
  assert.equal(article('MIDI', { ...S, saidAsWords: [] }), 'an');
  // The consonant-sound words emptied: a one-shot and a Unison read by their first letter.
  assert.equal(article('one-shot', { ...S, consonantSoundWords: [] }), 'an');
  assert.equal(article('Unison', { ...S, consonantSoundWords: [] }), 'an');
  // The vowel-sound words emptied: an hour loses its silent h.
  assert.equal(article('hour', { ...S, vowelSoundWords: [] }), 'a');
  // The table as shipped puts each back.
  assert.equal(article('LFO'), 'an');
  assert.equal(article('MIDI'), 'a');
  assert.equal(article('one-shot'), 'a');
  assert.equal(article('hour'), 'an');
});

function build(fn) {
  const store = createStudioStore(null, { idGenerator: createIdGenerator(null) });
  const ok = (r) => {
    assert.ok(r.ok, r.reason || JSON.stringify(r.errors));
    return r;
  };
  const add = (nodeType, params) => {
    const id = ok(store.dispatch({ type: 'NODE_ADD', nodeType, position: { x: 0, y: 0 } }))
      .created.nodes[0];
    for (const [key, value] of Object.entries(params || {})) {
      ok(store.dispatch({ type: 'NODE_PARAM_SET', nodeId: id, key, value }));
    }
    return id;
  };
  const connect = (a, ap, b, bp) => ok(store.dispatch({ type: 'EDGE_ADD',
    from: { node: a, port: ap }, to: { node: b, port: bp } })).created.edges[0];
  const ids = fn({ add, connect });
  return { model: store.getModel(), ids };
}

test('K172: the filter-gain reason of the graph view says "an All-pass" and "a Low-pass"', () => {
  for (const [type, want] of [['allpass', 'an All-pass filter'], ['lowpass', 'a Low-pass filter'],
    ['highpass', 'a High-pass filter'], ['notch', 'a Notch filter']]) {
    const { model, ids } = build(({ add, connect }) => {
      const f = add('filter', { type });
      const lfo = add('lfo');
      return { g: connect(lfo, 'control', f, 'gain') };
    });
    const e = model.graph.edges.find((x) => x.id === ids.g);
    assert.equal(edgeEffectReason(model, e),
      `Filter gain applies to peaking and the shelves only; ${want} ignores it.`, type);
  }
});

test('K172: the notes-target reason says "an LFO node" and "a Filter node"', () => {
  for (const [name, want] of [['LFO', 'an LFO node'], ['Oscillator', 'an Oscillator node'],
    ['Filter', 'a Filter node'], ['Envelope', 'an Envelope node'], ['RTA', 'an RTA node'],
    ['Unison', 'a Unison node']]) {
    assert.match(CLIP_TARGET_TEXT.notesTarget(name),
      new RegExp(`; ${want} does not play notes\\.$`), name);
  }
});

test('K172: the patch type-mismatch refusal says "is an LFO" and "sets an LFO"', () => {
  const st = panelStore();
  const m = st.getModel();
  const patch = JSON.parse(JSON.stringify(presetPatch(PANEL, 'bass')));
  const lfo = PANEL.resolve(m).get('mg');
  const lpf = PANEL.resolve(m).get('lpf');
  assert.equal(lfo.type, 'lfo');
  const a = st.dispatch({ type: 'PATCH_REPLACE', patch, onto: { lpf: lfo.id } });
  assert.equal(a.ok, false);
  assert.equal(a.reason, `${lfo.metadata.name} is an LFO; the patch sets a Filter.`);
  const b = st.dispatch({ type: 'PATCH_REPLACE', patch, onto: { mg: lpf.id } });
  assert.equal(b.ok, false);
  assert.equal(b.reason, `${lpf.metadata.name} is a Filter; the patch sets an LFO.`);
});

/** Every .js file under dir, recursively. */
function jsFiles(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...jsFiles(p));
    else if (name.endsWith('.js')) out.push(p);
  }
  return out;
}

test('K172: one helper; no other file under src/js decides an article', () => {
  const root = fileURLToPath(new URL('../../src/js/', import.meta.url));
  const home = join(root, 'studio', 'a11y.js');
  const offenders = [];
  for (const file of jsFiles(root)) {
    if (file === home) continue;
    const text = readFileSync(file, 'utf8');
    if (/\?\s*'an'\s*:\s*'a'|\?\s*'a'\s*:\s*'an'|\[aeiou\]\/i?\.test/i.test(text)) {
      offenders.push(file.slice(root.length));
    }
  }
  assert.deepEqual(offenders, [], 'files that pick an article by their own rule');
});
