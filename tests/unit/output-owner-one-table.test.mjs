// C024 (coherent-state one-output-owner): the output-owner table (src/js/ui/output-owner.js)
// refuses every claim while a measurement or a microphone level-reference capture holds the
// output, and the riff audition is refused by the same table and claims under its own name.
// Before this, a reference capture refused the MIDI and keyboard notes (midi/ui.js 'reference')
// but not claimOutput('instrument') nor the audition, whose voices were claimed as 'instrument',
// and Studio PLAY (ui/studio/workspace.js onClaimOutput) checked only the measurement.
//   node --test tests/unit/output-owner-one-table.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as oo from '../../src/js/ui/output-owner.js';
import { AUDITION_OPTIONS } from '../../src/js/studio/riffs/audition.js';
import { registerRiffSource } from '../../src/js/studio/riffs/source.js';
import { catalogEntries } from '../../src/js/studio/patch-catalog.js';
import { measureLifecyclePart } from '../../src/js/ui/measure/session.js';
import { claimStudioOutput } from '../../src/js/ui/studio/workspace.js';

/** A component whose measurement and reference probes the test sets. */
function component({ measuring = false, reference = false, playing = false, seq = false } = {}) {
  const log = [];
  const editor = { playing: seq, stop() { log.push('seq.stop'); this.playing = false; } };
  const cmp = {
    playing, seqPlaying: seq, alerts: [], studio: false,
    measureOwnsOutput: () => measuring,
    measureReferenceOwnsOutput: () => reference,
    notify(kind, title, text) { this.alerts.push({ kind, title, text }); },
    stopNow() { log.push('instrument.stopNow'); },
    studioOwnsOutput() { return this.studio; },
    studioStop() { log.push('studio.stop'); },
  };
  const owner = oo.createOutputOwner({ app: () => cmp, sequencer: () => editor });
  return { owner, cmp, log };
}

test('a microphone level-reference capture refuses claimOutput(instrument), stops nothing', () => {
  const { owner, cmp, log } = component({ reference: true, seq: true });
  const answer = owner.claimOutput('instrument');
  assert.notEqual(answer, true, 'the instrument does not take the output during the capture');
  assert.equal(answer, oo.REFERENCE_REFUSAL);
  assert.deepEqual(log, [], 'a refused claim stops nothing');
  assert.deepEqual(cmp.alerts.map((a) => [a.title, a.text]),
    [['Level reference capture', oo.REFERENCE_REFUSAL]]);
  // the sequencer is refused by the same row
  assert.equal(component({ reference: true }).owner.claimOutput('sequencer'),
    oo.REFERENCE_REFUSAL);
});

test('the refusals are one ordered table: the measurement first, then the reference', () => {
  assert.deepEqual(oo.OUTPUT_REFUSALS.map((r) => [r.owner, r.probe]),
    [['measurement', 'measureOwnsOutput'], ['reference', 'measureReferenceOwnsOutput']]);
  assert.equal(oo.outputRefusalOf(null), null);
  assert.equal(oo.outputRefusalOf({}), null, 'a component without the probes refuses nothing');
  assert.equal(oo.outputRefusalOf(component().cmp), null);
  assert.equal(oo.outputRefusalOf(component({ measuring: true, reference: true }).cmp).text,
    oo.OUTPUT_REFUSAL);
  assert.equal(oo.outputRefusalOf(component({ reference: true }).cmp).owner, 'reference');
});

test('MEASURE reports the reference capture as the owner only for a microphone input', () => {
  const probe = (ctx) => measureLifecyclePart({ me: null, charts: {}, ...ctx }, {}, {})
    .measureReferenceOwnsOutput();
  assert.equal(probe({ refCapture: { io: {} }, ioKind: 'microphone' }), true);
  // the loopback TEST CONTEXT captures the instrument's own output: it must stay playable
  assert.equal(probe({ refCapture: { io: {} }, ioKind: 'loopback' }), false);
  assert.equal(probe({ refCapture: null, ioKind: 'microphone' }), false);
});

test('the riff audition claims the output as audition, not as the instrument', () => {
  assert.equal(oo.playOwnerOf({ ...AUDITION_OPTIONS, riff: 'mirrorball-octaves' }), 'audition');
  assert.equal(oo.playOwnerOf({ mode: 'hold' }), 'instrument');
  assert.equal(oo.playOwnerOf(undefined), 'instrument');
  assert.ok(Object.hasOwn(oo.OUTPUT_YIELDS, AUDITION_OPTIONS.owner),
    'the audition is a row of the owner table');
  const { owner } = component({ seq: true });
  assert.equal(owner.claimOutput('audition'), true);
  assert.throws(() => owner.claimOutput('nobody'), /unknown owner/);
});

test('the audition is refused by the table during a reference capture, before any stop', () => {
  const log = [];
  const engine = { on: () => () => {}, voice: null,
    play: () => { log.push('play'); return { id: 1 }; }, stopAll: () => log.push('stopAll') };
  let reference = true;
  let measuring = false;
  const cmp = { measureOwnsOutput: () => measuring, measureReferenceOwnsOutput: () => reference };
  registerRiffSource({ engine, stopPlayback: () => log.push('stopPlayback'),
    outputRefusalOf: oo.outputRefusalOf }, cmp);
  const entry = catalogEntries({}).find((e) => e.id === 'riff-mirrorball-octaves');
  assert.ok(entry && entry.audition, 'the riff entry carries its audition');
  const busy = entry.audition.ctl.start('mirrorball-octaves');
  assert.equal(busy.ok, false, 'Listen is refused while the reference is captured');
  assert.equal(busy.reason, oo.REFERENCE_REFUSAL);
  assert.deepEqual(log, [], 'nothing stopped, nothing played');
  reference = false;
  measuring = true;
  assert.equal(entry.audition.ctl.start('mirrorball-octaves').reason, oo.OUTPUT_REFUSAL,
    'a measurement refuses it with the table\'s sentence');
  measuring = false;
  assert.equal(entry.audition.ctl.start('mirrorball-octaves').ok, true);
  assert.deepEqual(log, ['stopPlayback', 'play']);
  registerRiffSource(); // leave no source holding this test's engine
});

test('main.js wires the table: the play guard claims playOwnerOf, the Studio gets refusals', () => {
  const main = readFileSync(new URL('../../src/js/main.js', import.meta.url), 'utf8');
  assert.match(main, /claimOutput\(playOwnerOf\(o\)\) !== true/);
  assert.doesNotMatch(main, /claimOutput\('instrument'\)/);
  assert.match(main, /createStudioUi\(\{[^}]*\boutputRefusalOf\b/);
});

test('Studio PLAY is refused by the same table during a reference capture, before any stop', () => {
  const said = [];
  const stops = [];
  const announce = (text, opts) => said.push([text, !!(opts && opts.assertive)]);
  const svc = { outputRefusalOf: oo.outputRefusalOf, stopPlayback: (c) => stops.push(c) };
  const reference = component({ reference: true }).cmp;
  assert.equal(claimStudioOutput(reference, svc, announce), false,
    'the Studio does not take the output while the reference is captured');
  assert.deepEqual(said, [[oo.REFERENCE_REFUSAL, true]]);
  assert.deepEqual(stops, [], 'a refused PLAY stops nothing');
  said.length = 0;
  assert.equal(claimStudioOutput(component({ measuring: true, reference: true }).cmp, svc,
    announce), false);
  assert.deepEqual(said, [[oo.OUTPUT_REFUSAL, true]], 'the measurement row comes first');
  said.length = 0;
  const free = component().cmp;
  assert.equal(claimStudioOutput(free, svc, announce), true);
  assert.deepEqual(said, []);
  assert.deepEqual(stops, [free], 'a granted PLAY stops every other owner');
  assert.equal(claimStudioOutput(null, svc, announce), true, 'no component, nothing to refuse');
  // the workspace hands this claim to the transport, not a check of its own
  const ws = readFileSync(new URL('../../src/js/ui/studio/workspace.js', import.meta.url),
    'utf8');
  assert.match(ws, /onClaimOutput: \(\) => claimStudioOutput\(ctx\.cmp, svc, announce\)/);
});

// ---------------------------------------------------------------- C036: exactly one table
// The owners, their refusals, their yields, the notes' refusals and sentences and the views'
// names live in OUTPUT_OWNER_TABLE (src/js/ui/output-owner.js); every former table site is gone
// or a projection of it (af critique N1: the test asserts the other tables are gone or derived,
// not only that the new one answers). Fails on the merge base, where five sites declare their
// own lists and the notes refuse a loopback reference capture that the instrument may play
// through.

import { readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as viz from '../../src/js/visualization/output-owner.js';
import { MIDI_REFUSED } from '../../src/js/midi/ui.js';
import { KEYBOARD_REFUSED } from '../../src/js/midi/keyboard-ui.js';
import { SPACE_OWNER } from '../../src/js/ui/shortcuts.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const TABLE_FILE = path.join('src', 'js', 'ui', 'output-owner.js');

test('C036: one table names every owner, in precedence order, with its rule and sentence', () => {
  const t = oo.OUTPUT_OWNER_TABLE;
  assert.ok(Array.isArray(t) && Object.isFrozen(t), 'the table is a frozen list');
  assert.deepEqual(t.map((r) => r.owner), OWNER_IDS);
  for (const r of t) {
    assert.ok(Object.isFrozen(r), `${r.owner}: a frozen row`);
    assert.ok(Array.isArray(r.yields), `${r.owner}: names who yields to it`);
    if (r.refuses === 'all') assert.ok(r.probe && r.title && r.text, `${r.owner}: its notice`);
    if (r.refuses) assert.ok(r.notes && r.notes.midi && r.notes.keyboard, `${r.owner}: notes`);
    for (const y of r.yields) assert.ok(oo.ownerRow(y), `${r.owner} yields a row: ${y}`);
  }
  assert.deepEqual(Object.keys(oo.OWNER), t.map((r) => r.owner));
  for (const [k, v] of Object.entries(oo.OWNER)) assert.equal(k, v);
});

test('C036: the former table sites are projections of the one table', () => {
  const t = oo.OUTPUT_OWNER_TABLE;
  // ui/output-owner.js: the refusals and the yields
  for (const r of oo.OUTPUT_REFUSALS) assert.ok(t.includes(r), `${r.owner} is the table's row`);
  assert.deepEqual(oo.OUTPUT_REFUSALS.map((r) => r.owner), ['measurement', 'reference']);
  assert.equal(oo.OUTPUT_YIELDS.measure, oo.ownerRow('measurement').yields);
  for (const o of ['instrument', 'audition', 'sequencer']) {
    assert.equal(oo.OUTPUT_YIELDS[o], oo.ownerRow(o).yields, `OUTPUT_YIELDS.${o}`);
  }
  // visualization/output-owner.js: the views' owners, names and precedence
  const views = t.filter((r) => r.view);
  assert.deepEqual(viz.OUTPUT_OWNERS, views.map((r) => r.owner));
  assert.deepEqual(viz.OUTPUT_OWNER_NAMES, Object.fromEntries(views.map((r) => [r.owner, r.view])));
  assert.equal(viz.outputOwnerOf({ notes: true, studio: true }), 'studio');
  // midi/ui.js and midi/keyboard-ui.js: the notes' sentences
  const refusing = t.filter((r) => r.notes);
  assert.deepEqual(MIDI_REFUSED, Object.fromEntries(refusing.map((r) => [r.owner, r.notes.midi])));
  assert.deepEqual(KEYBOARD_REFUSED,
    Object.fromEntries(refusing.map((r) => [r.owner, r.notes.keyboard])));
  // ui/shortcuts.js: every Space owner is a row
  for (const [ws, o] of Object.entries(SPACE_OWNER)) {
    assert.ok(o === null || oo.ownerRow(o), `SPACE_OWNER.${ws} = ${o}`);
  }
  // studio/riffs/audition.js: the owner mark is the table's
  assert.equal(AUDITION_OPTIONS.owner, oo.OWNER.audition);
  // core/instrument.js and midi/ui.js read the table instead of a test of their own
  const src = (f) => readFileSync(path.join(ROOT, f), 'utf8');
  const inst = src('src/js/core/instrument.js');
  assert.match(inst, /playOwnerOf\(engine\.voice\.opts\) !== OWNER\.instrument/);
  assert.doesNotMatch(inst, /opts\.owner\b/);
  const midi = src('src/js/midi/ui.js');
  assert.match(midi, /ownedBy: \(\) => notesRefusalOf\(cmp, \{ sequencerPlaying \}\)/);
  assert.doesNotMatch(midi, /levelForm/);
});

/** A component for the notes' refusals: each probe set by the test. */
function probes({ measuring = false, reference = false, studio = false, capturing = false } = {}) {
  return { measureOwnsOutput: () => measuring, measureReferenceOwnsOutput: () => reference,
    studioOwnsOutput: () => studio, meas: { levelForm: { capturing } } };
}

test('C036: the notes follow the same rows: a loopback reference lets them play', () => {
  const seq = { sequencerPlaying: () => true };
  assert.equal(oo.notesRefusalOf(null), null);
  assert.equal(oo.notesRefusalOf(probes()), null);
  // a loopback capture: the form captures, but the reference is the output itself
  assert.equal(oo.notesRefusalOf(probes({ capturing: true })), null);
  assert.equal(oo.notesRefusalOf(probes({ capturing: true, reference: true })), 'reference');
  assert.equal(oo.notesRefusalOf(probes({ measuring: true, reference: true, studio: true }), seq),
    'measurement');
  assert.equal(oo.notesRefusalOf(probes({ studio: true }), seq), 'sequencer',
    'the table order: the sequencer row before the Studio row');
  assert.equal(oo.notesRefusalOf(probes({ studio: true })), 'studio');
  assert.equal(oo.notesRefusalOf(probes(), seq), 'sequencer');
  // and the claim of the instrument is refused by the same reference row
  const { owner } = component({ reference: true });
  assert.equal(owner.claimOutput('instrument'), oo.REFERENCE_REFUSAL);
});

test('C036: the notes yield by the table: an instrument claim, stopPlayback release them', () => {
  const run = (fields, act) => {
    const log = [];
    const editor = { playing: false, stop() {} };
    const cmp = { playing: false, seqPlaying: false, studio: false, notesSounding: false,
      measureOwnsOutput: () => false, notify() {}, stopNow() {}, studioOwnsOutput: () => false,
      studioStop() {}, midiAllOff() { log.push('notes.off'); }, ...fields };
    const owner = oo.createOutputOwner({ app: () => cmp, sequencer: () => editor });
    act(owner, cmp);
    return log;
  };
  assert.deepEqual(run({ notesSounding: true }, (o) => o.claimOutput('instrument')),
    ['notes.off'], 'a lit key: the instrument claim releases the notes (newest wins)');
  assert.deepEqual(run({}, (o) => o.claimOutput('instrument')), [],
    'nothing lit: an instrument restart leaves a routed note alone');
  assert.deepEqual(run({ notesSounding: true }, (o) => o.claimOutput('sequencer')), [],
    'the sequencer re-claims before every loop pass: its start releases the notes (main.js)');
  assert.deepEqual(run({}, (o, c) => o.stopPlayback(c)), ['notes.off'],
    'MEASURE and Studio PLAY release every note, lit or not');
  let busy = null;
  run({ notesSounding: true }, (o, c) => { busy = o.outputBusy(c); });
  assert.equal(busy, true, 'held notes are other audio for the setup check');
});

/** Every .js file under src/js, relative to ROOT. */
function jsFiles(dir = path.join(ROOT, 'src', 'js')) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) out.push(...jsFiles(p));
    else if (name.endsWith('.js')) out.push(path.relative(ROOT, p));
  }
  return out;
}

// The owner ids, written out here (the scan must also run where the table is missing) and
// checked against the table by the first C036 case.
const OWNER_IDS = ['measurement', 'reference', 'instrument', 'audition', 'sequencer', 'studio',
  'notes'];
const IDS = OWNER_IDS.join('|');
const SENTENCES = (oo.OUTPUT_OWNER_TABLE || []).flatMap((r) => [r.text,
  r.notes && r.notes.midi, r.notes && r.notes.keyboard]).filter(Boolean);

/**
 * What in `text` (a source file, its string concatenations joined) is a second owner table:
 * a literal list of owner ids, an owner-keyed map of owner ids, a SOURCES or a SPACE_OWNER of
 * literals, an ownedBy that returns a literal owner, a literal owner mark or test on a voice's
 * options, or a copy of a table sentence. Returns the names of the kinds found.
 */
function secondTables(text) {
  const s = text.replace(/'\s*\+\s*'/g, '');
  const found = [];
  // one entry of an owner-keyed map of owner ids: `instrument: Object.freeze(['sequencer'`
  const keyed = `(${IDS}|measure)\\s*:\\s*(Object\\.freeze\\()?\\[\\s*'(${IDS})'`;
  const kinds = {
    'owner list': new RegExp(`\\[\\s*'(${IDS})'\\s*,\\s*'(${IDS})'`),
    'owner-keyed map': new RegExp(`\\b${keyed}[^\\]]*\\]\\)?\\s*,\\s*${keyed}`),
    'owner names': new RegExp(`\\b(${IDS})\\s*:\\s*'(${IDS}|Studio)'\\s*,\\s*(${IDS})\\s*:`),
    'a second SOURCES': /\bSOURCES\s*=\s*\{/,
    'a SPACE_OWNER of literals':
      new RegExp(`SPACE_OWNER\\s*=\\s*Object\\.freeze\\(\\{[^}]*'(${IDS})'`),
    'an ownedBy of literals': new RegExp(`ownedBy\\s*[:=(][^;]{0,600}?return\\s+'(${IDS})'`),
    'an owner mark': /owner\s*(===|:)\s*'audition'/,
  };
  for (const [kind, re] of Object.entries(kinds)) if (re.test(s)) found.push(kind);
  if (SENTENCES.some((t) => s.includes(t.slice(0, 48)))) found.push('a copied refusal sentence');
  return found;
}

test('C036 N1: no owner table or refusal list outside src/js/ui/output-owner.js', () => {
  const hits = jsFiles().filter((f) => f !== TABLE_FILE)
    .map((f) => [f, secondTables(readFileSync(path.join(ROOT, f), 'utf8'))])
    .filter(([, kinds]) => kinds.length);
  assert.deepEqual(hits, []);
});

test('C036 N1 mutation: each kind of re-added local table is found', () => {
  const cases = {
    'owner list': "export const OUTPUT_OWNERS = Object.freeze(['instrument', 'sequencer']);",
    'owner-keyed map': "const Y = { instrument: Object.freeze(['sequencer']),\n"
      + "  sequencer: Object.freeze(['instrument']) };",
    'owner names': "const N = { instrument: 'instrument', sequencer: 'sequencer' };",
    'a second SOURCES': 'const SOURCES = { sequencer: {} };',
    'a SPACE_OWNER of literals': "export const SPACE_OWNER = Object.freeze({ a: 'instrument' });",
    'an ownedBy of literals': "ownedBy: () => { if (x) return 'measurement'; return null; },",
    'an owner mark': "const AUDITION = { owner: 'audition' };",
    'a copied refusal sentence': "const T = 'MIDI noty nehrají, dokud hraje sekvencer: '\n"
      + "  + 'nejdřív ho zastavte (Esc).';",
  };
  for (const [kind, src] of Object.entries(cases)) {
    assert.deepEqual(secondTables(src), [kind], kind);
  }
  // what the derived sites now say passes
  assert.deepEqual(secondTables("export const SPACE_OWNER = Object.freeze({ a: OWNER.instrument });"
    + "\nownedBy: () => notesRefusalOf(cmp, { sequencerPlaying }),"
    + "\nconst A = { owner: OWNER.audition };"), []);
  // the table's own file is the one place these are written
  assert.ok(secondTables(readFileSync(path.join(ROOT, TABLE_FILE), 'utf8')).length > 0);
});
