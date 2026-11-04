// K172: spoken and shown Studio text picks 'a' or 'an' by how the word is said, not by its first
// letter. One helper (src/js/core/article.js indefiniteArticle / withArticle, re-exported by
// src/js/studio/a11y.js) decides it for every word OSCILLA interpolates after an article; this
// file fails on the merge base, where the helper does not exist and the Studio says "a LFO",
// "a RTA", "A event clip", "A analysis clip" and "a fm block". The guard at the end fails on
// any module in src/js that decides the article itself.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import * as core from '../../src/js/core/article.js';
import { indefiniteArticle, withArticle } from '../../src/js/studio/a11y.js';
import { assertRenderableFrequency } from '../../src/js/audio/offline-renderer.js';
import { CLIP_MIN_RUN } from '../../src/js/measurement/capture-checks.js';
import { CLIP_TARGET_TEXT, clipTarget } from '../../src/js/studio/clip-targets.js';
import { canConnect, definePort } from '../../src/js/studio/ports.js';
import { NODE_REGISTRY } from '../../src/js/studio/registry.js';
import { importSequenceDocument } from '../../src/js/studio/sequence-import.js';
import { clipTrackReason } from '../../src/js/studio/timeline.js';
import { addBlock, createSequence, serializeSequence } from '../../src/js/sequencer/model.js';
import { MAX_VOICES } from '../../src/js/synth/voice-pool.js';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));

test('K172 initialisms follow their first letter name; MIDI is said as a word', () => {
  for (const [word, want] of [
    ['LFO', 'an LFO'], ['RTA', 'an RTA'], ['FM engine', 'an FM engine'],
    ['AM/ring engine', 'an AM/ring engine'], ['XY Pad', 'an XY Pad'], ['MIDI', 'a MIDI'],
    ['HP', 'an HP'], ['SPL meter', 'an SPL meter'], ['NR', 'an NR'], ['X', 'an X'],
    ['VCO', 'a VCO'], ['DC offset', 'a DC offset'], ['FFT', 'an FFT'], ['IR', 'an IR'],
    ['UI', 'a UI'], ['ADSR', 'an ADSR'], ['CV', 'a CV'], ['EQ', 'an EQ'], ['B', 'a B'],
    ['WAV export', 'a WAV export'], ['OSCILLA patch', 'an OSCILLA patch'],
  ]) assert.equal(withArticle(word), want, word);
});

test('K172 ordinary words take the article of their spoken start', () => {
  for (const [word, want] of [
    ['Filter', 'a Filter'], ['Oscillator', 'an Oscillator'], ['Unison', 'a Unison'],
    ['Envelope', 'an Envelope'], ['All-pass', 'an All-pass'], ['Low-pass', 'a Low-pass'],
    ['Mixer', 'a Mixer'], ['Microphone', 'a Microphone'], ['Noise', 'a Noise'],
    ['Ring', 'a Ring'], ['Sequence', 'a Sequence'], ['event', 'an event'],
    ['measurement', 'a measurement'], ['Additive engine', 'an Additive engine'],
    ['Umbrella', 'an Umbrella'], ['upper', 'an upper'], ['user', 'a user'],
    ['utility', 'a utility'], ['European', 'a European'], ['one-shot', 'a one-shot'],
    ['onset', 'an onset'], ['hour', 'an hour'], ['Harmonic', 'a Harmonic'],
    ['Oscillator 1 frequency', 'an Oscillator 1 frequency'], ['LFO 1 rate', 'an LFO 1 rate'],
  ]) assert.equal(withArticle(word), want, word);
});

test('K172 capital starts a sentence; indefiniteArticle returns the article alone', () => {
  assert.equal(withArticle('event', { capital: true }), 'An event');
  assert.equal(withArticle('pattern', { capital: true }), 'A pattern');
  assert.equal(indefiniteArticle('LFO'), 'an');
  assert.equal(indefiniteArticle('Unison'), 'a');
  assert.equal(indefiniteArticle(''), 'a');
});

test('K172 every node display name in the registry gets the spoken article', () => {
  const AN = new Set(['Additive engine', 'AM/ring engine', 'Envelope', 'FM engine', 'LFO',
    'Oscillator', 'RTA', 'XY Pad']);
  const defs = NODE_REGISTRY.list();
  assert.ok(defs.length > 20);
  for (const { displayName: name } of defs) {
    assert.equal(indefiniteArticle(name), AN.has(name) ? 'an' : 'a', name);
  }
});

test('K172 the Studio says "an LFO node" and "an RTA node", not "a LFO"', () => {
  assert.match(CLIP_TARGET_TEXT.notesTarget('LFO'), /; an LFO node does not play notes\.$/);
  assert.match(CLIP_TARGET_TEXT.notesTarget('RTA'), /; an RTA node does not play notes\.$/);
  assert.match(CLIP_TARGET_TEXT.notesTarget('Filter'), /; a Filter node does not play notes\.$/);
  assert.match(CLIP_TARGET_TEXT.notesTarget('Oscillator'), /; an Oscillator node /);
});

test('K172 a clip on the wrong track: "An event clip cannot go on a measurement track."', () => {
  assert.equal(clipTrackReason({}, { kind: 'measurement' }, { kind: 'event' }),
    'An event clip cannot go on a measurement track.');
  assert.equal(clipTrackReason({}, { kind: 'event' }, { kind: 'measurement' }),
    'A measurement clip cannot go on an event track.');
});

test('K172 numbers, lowercase initialisms, "&" and "un-" take the spoken article', () => {
  assert.equal(core.withArticle, withArticle, 'a11y.js re-exports the one helper');
  for (const [word, want] of [
    ['8-bit', 'an 8-bit'], ['11 Hz', 'an 11 Hz'], ['18 ms', 'an 18 ms'], ['8', 'an 8'],
    ['80 ms window', 'an 80 ms window'], ['8192-point', 'an 8192-point'],
    ['11025 Hz', 'an 11025 Hz'], ['18000', 'an 18000'], ['88200 Hz', 'an 88200 Hz'],
    ['8th', 'an 8th'], ['48000 Hz', 'a 48000 Hz'], ['44100 Hz', 'a 44100 Hz'],
    ['16384-point', 'a 16384-point'], ['110', 'a 110'], ['1100', 'a 1100'],
    ['180000', 'a 180000'], ['3-sample', 'a 3-sample'], ['0.5', 'a 0.5'], ['17th', 'a 17th'],
    ['1,100', 'a 1,100'], ['3D view', 'a 3D view'],
    ['S&H', 'an S&H'], ['R&D', 'an R&D'], ['MP3', 'an MP3'], ['fm', 'an fm'], ['am', 'an am'],
    ['rms', 'an rms'], ['nth', 'an nth'], ['dc', 'a dc'], ['bpm', 'a bpm'], ['lfo', 'an lfo'],
    ['rta', 'an rta'], ['ui', 'a ui'], ['hz', 'a hz'], ['rhythm', 'a rhythm'],
    ['uninstalled', 'an uninstalled'], ['unimportant', 'an unimportant'], ['unit', 'a unit'],
    ['union', 'a union'], ['unique', 'a unique'], ['universal', 'a universal'],
    ['"sweep"', 'a "sweep"'], ['"input"', 'an "input"'], ['(optional)', 'an (optional)'],
    ['oscilla.analysis-task', 'an oscilla.analysis-task'],
  ]) assert.equal(withArticle(word), want, word);
});

test('K172 "An analysis clip needs a transfer-analyzer target."', () => {
  const mic = { id: 'm1', type: 'microphone', params: {}, metadata: { name: 'Mic 1' } };
  assert.equal(clipTarget(mic, { kind: 'measurement', action: 'analysis' }).reason,
    'An analysis clip needs a transfer-analyzer target.');
  const sweep = { id: 's1', type: 'sweep', params: {}, metadata: { name: 'Sweep 1' } };
  assert.equal(clipTarget(sweep, { kind: 'measurement', action: 'capture' }).reason,
    'A capture clip needs a microphone or capture target.');
});

test('K172 a sequence file names "an am block" and "an fm block"', () => {
  const ref = serializeSequence(addBlock(addBlock(createSequence({}), 'am'), 'fm'));
  const extra = (i) => ({ ...ref, blocks: ref.blocks.map((b, k) => (k === i
    ? { ...b, params: { ...b.params, gain: 1 } } : b)) });
  assert.deepEqual(ref.blocks.map((b) => b.type), ['am', 'fm']);
  assert.match(importSequenceDocument(extra(0)).errors[0].message,
    /^Block 1: params\.gain is not a parameter of an am block/);
  assert.match(importSequenceDocument(extra(1)).errors[0].message,
    /^Block 2: params\.gain is not a parameter of an fm block/);
});

test('K172 other refusals: "an observed input", "an 8000 Hz render"', () => {
  const result = definePort({ id: 'r', direction: 'out', type: 'ANALYSIS', role: 'RESULT' });
  const observed = definePort({ id: 'o', direction: 'in', type: 'ANALYSIS', role: 'OBSERVED' });
  assert.equal(canConnect(result, observed).reason,
    'A result output cannot connect to an observed input.');
  assert.throws(() => assertRenderableFrequency(5000, 8000), /for an 8000 Hz render$/);
  assert.throws(() => assertRenderableFrequency(30000, 48000), /for a 48000 Hz render$/);
});

// ---------------------------------------------------------------- the guard

/**
 * The only hard-coded articles before an interpolation in src/js, by file and the exact text of
 * the line. `article` entries put 'a'/'an' before a fixed constant and prove the article fits
 * the constant's current value; `label` entries are a letter that is not an article (channel
 * "A", the "A" of ADSR, the SVG arc command "A").
 */
const ALLOWED = [
  { file: 'src/js/studio/nodes/engines.js', text: 'a ${MAX_VOICES + 1}th note',
    article: () => indefiniteArticle(`${MAX_VOICES + 1}th`) === 'a' },
  { file: 'src/js/measurement/analysis-task.js', text: 'not an ${ANALYSIS_TASK} v',
    article: () => indefiniteArticle('oscilla.analysis-task') === 'an' },
  { file: 'src/js/measurement/quality.js', text: 'without a ${CLIP_MIN_RUN}-sample',
    article: () => indefiniteArticle(`${CLIP_MIN_RUN}-sample`) === 'a' },
  { file: 'src/js/measurement/views/quality-bar.js', text: 'without a ${CLIP_MIN_RUN}-sample',
    article: () => indefiniteArticle(`${CLIP_MIN_RUN}-sample`) === 'a' },
  { file: 'src/js/visualization/visualization-bridge.js', text: '`A ${formatFrequency(plan.a.',
    label: 'channel A' },
  { file: 'src/js/visualization/visualization-bridge.js', text: '`A ${formatFrequency(s.dual.fa)}',
    label: 'channel A' },
  { file: 'src/js/core/instrument.js', text: '`A ${formatFrequency(this.dualFa)}',
    label: 'channel A' },
  { file: 'src/js/studio/signal-path-projection.js', text: '`A ${secs(p.attack)} · R',
    label: 'ADSR attack' },
  { file: 'src/js/studio/signal-path-projection.js', text: '`A ${secs(p.attack)} · D',
    label: 'ADSR attack' },
  { file: 'src/js/studio/nodes/modulation.js', text: '`A ${secs(p.attack)}`',
    label: 'ADSR attack' },
  { file: 'src/js/ui/synth/knob.js', text: 'A ${r} ${r} 0', label: 'SVG arc command' },
  { file: 'src/js/synth/view/knob.js', text: 'A ${r} ${r} 0', label: 'SVG arc command' },
];

/** The ways a module decides the article itself. */
const DECISIONS = [
  ['an a/an ternary', /['"`]an ?['"`]\s*:\s*['"`]a ?['"`]|['"`]a ?['"`]\s*:\s*['"`]an ?['"`]/i],
  ['a first-vowel test', /\^\[(?:aeiou|AEIOU|aeiouAEIOU|AEIOUaeiou)\]/],
  ['an article before an interpolation', /(?:^|[^\w$.'"])(?:a|an|A|An) \$\{/],
  ['an article concatenated before a value', /['"`](?:a|an|A|An) ['"`]\s*\+/],
];

function sourceFiles() {
  const files = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (p.endsWith('.js')) files.push(p);
    }
  };
  walk(join(ROOT, 'src/js'));
  return files;
}

/** Every line of `text` that decides an article, as "file:line: kind: text". */
function articleDecisions(file, text) {
  const out = [];
  text.split('\n').forEach((line, i) => {
    for (const [kind, re] of DECISIONS) {
      if (!re.test(line)) continue;
      if (ALLOWED.some((a) => a.file === file && line.includes(a.text))) continue;
      out.push(`${file}:${i + 1}: ${kind}: ${line.trim()}`);
    }
  });
  return out;
}

test('K172 the guard catches every way a module could pick the article itself', () => {
  const f = 'src/js/x.js';
  for (const line of [
    "const a = /^[AEIOU]/.test(type) ? 'an' : 'a';",
    'const a = /^[aeiou]/i.test(word);',
    "return word + (vowel ? 'an ' : 'a ');",
    "errors.push(err('measurement-target', `A ${action} clip needs a ${need.join(' or ')} `",
    '      `a parameter of a ${c.type} block`);',
    '`${name} is not an ${side.label}.`',
    "msg = 'a ' + kind;",
  ]) assert.equal(articleDecisions(f, line).length > 0, true, line);
  for (const line of [
    '`${withArticle(action, { capital: true })} clip`',
    "'A notes clip needs a target that plays notes'",
    '`data ${x}`', '`Gamma ${x}`', '`${a} ${b}`',
  ]) assert.deepEqual(articleDecisions(f, line), [], line);
});

test('K172 no module in src/js picks the article itself; the allowlist is exact', () => {
  const own = join(ROOT, 'src/js/core/article.js');
  const offenders = [];
  const used = new Set();
  for (const p of sourceFiles()) {
    if (p === own) continue;
    const file = relative(ROOT, p);
    const text = readFileSync(p, 'utf8');
    offenders.push(...articleDecisions(file, text));
    for (const a of ALLOWED) if (a.file === file && text.includes(a.text)) used.add(a);
  }
  assert.deepEqual(offenders, []);
  assert.deepEqual(ALLOWED.filter((a) => !used.has(a)).map((a) => `${a.file}: ${a.text}`), [],
    'every allowlist entry still names a line');
  for (const a of ALLOWED.filter((x) => x.article)) {
    assert.equal(a.article(), true, `${a.file}: ${a.text} fits its constant`);
  }
  assert.match(readFileSync(own, 'utf8'), /export function indefiniteArticle\(/);
});
