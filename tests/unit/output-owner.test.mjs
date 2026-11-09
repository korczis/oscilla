// C013: the output owner the views follow, and the Spectrum's requested frequency
// (src/js/visualization/output-owner.js). Pure functions; main.js wires them.
// C002 (findings coupling-1, -2, -3): one output owner at a time, decided by one table that the
// engine.play wrapper and the sequencer's claimOutput share (src/js/ui/output-owner.js).
// C024: keyboard and MIDI notes are an output owner (the vizInputs override removed).
//   node --test tests/unit/output-owner.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  OUTPUT_OWNERS, OUTPUT_OWNER_NAMES, assertOutputOwner, outputOwnerOf, requestedFrequencyFor,
} from '../../src/js/visualization/output-owner.js';
import { createOutputOwner, OUTPUT_REFUSAL, OUTPUT_YIELDS } from '../../src/js/ui/output-owner.js';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createWorkbench } from '../../src/js/ui/workbench.js';
import { createScopeView } from '../../src/js/ui/p5-views.js';
import { VisualizationBridge } from '../../src/js/visualization/visualization-bridge.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

test('outputOwnerOf: the instrument first, then the sequencer, then the Studio, else null', () => {
  assert.strictEqual(outputOwnerOf({}), null);
  assert.strictEqual(outputOwnerOf(), null);
  assert.strictEqual(outputOwnerOf({ instrument: true }), 'instrument');
  assert.strictEqual(outputOwnerOf({ sequencer: true }), 'sequencer');
  assert.strictEqual(outputOwnerOf({ studio: true }), 'studio');
  assert.strictEqual(outputOwnerOf({ instrument: true, sequencer: true, studio: true }),
    'instrument');
  assert.strictEqual(outputOwnerOf({ sequencer: true, studio: true }), 'sequencer');
});

test('assertOutputOwner accepts the named owners and null, and refuses anything else', () => {
  for (const o of [...OUTPUT_OWNERS, null]) assert.strictEqual(assertOutputOwner(o), o);
  for (const bad of [undefined, '', 'Studio', 'mic', true, 1, {}]) {
    assert.throws(() => assertOutputOwner(bad), TypeError);
  }
  assert.strictEqual(OUTPUT_OWNER_NAMES.studio, 'Studio');
  assert.strictEqual(OUTPUT_OWNER_NAMES.sequencer, 'sequencer');
});

test('requestedFrequencyFor follows the sequence while only the sequencer plays', () => {
  // instrument at 250 Hz, not played; the sequence's block 0 requests 440 Hz
  assert.strictEqual(requestedFrequencyFor(false, 250, true, 440), 440);
  // a silence or a gap in the sequence hides the marker (and its level chip)
  assert.strictEqual(requestedFrequencyFor(false, 250, true, null), null);
  // the instrument playing keeps its own frequency, even with a sequence running
  assert.strictEqual(requestedFrequencyFor(true, 250, true, 440), 250);
  // nothing plays: the instrument's idle frequency, as before C013
  assert.strictEqual(requestedFrequencyFor(false, 250, false, null), 250);
  assert.strictEqual(requestedFrequencyFor(false, 0, false, null), null);
});

// ---------------------------------------------------------------- C002 (#305)

function setup({ measuring = false, playing = false, studio = false, seq = false } = {}) {
  const log = [];
  const editor = { playing: seq, stop() { log.push('seq.stop'); this.playing = false; } };
  const cmp = {
    playing, seqPlaying: seq, alerts: [], studio,
    measureOwnsOutput: () => measuring,
    notify(kind, title, text) { this.alerts.push({ kind, title, text }); },
    stopNow() { log.push('instrument.stopNow'); },
    studioOwnsOutput() { return this.studio; },
    studioStop() { log.push('studio.stop'); this.studio = false; },
  };
  let changes = 0;
  const owner = createOutputOwner({ app: () => cmp, sequencer: () => editor,
    changed: () => { changes += 1; } });
  return { owner, cmp, editor, log, changes: () => changes };
}

const tick = () => new Promise((r) => queueMicrotask(r));

test('C002: a measurement refuses every claim with one notice and stops nothing', () => {
  for (const who of ['instrument', 'sequencer']) {
    const { owner, cmp, log } = setup({ measuring: true, playing: true, seq: true });
    assert.equal(owner.claimOutput(who), OUTPUT_REFUSAL);
    assert.deepEqual(log, [], `${who}: nothing is stopped by a refused claim`);
    assert.deepEqual(cmp.alerts.map((a) => a.title), ['Measurement in progress']);
    assert.equal(cmp.alerts[0].text, OUTPUT_REFUSAL);
  }
});

test('C002: the sequencer takes the output from instrument and Studio at once', async () => {
  const { owner, cmp, log, changes } = setup({ playing: true, studio: true });
  assert.equal(owner.claimOutput('sequencer'), true);
  assert.deepEqual(log, ['instrument.stopNow', 'studio.stop']);
  assert.equal(cmp.seqPlaying, true, 'set in the action, not by the 150 ms poll');
  await tick();
  assert.equal(changes(), 1, 'the adapter listeners hear of it');
});

test('C002: an instrument voice stops a playing sequence from its live state', async () => {
  // seqPlaying (the polled copy) still false: the live editor state decides.
  const { owner, cmp, editor, log } = setup();
  editor.playing = true;
  assert.equal(owner.claimOutput('instrument'), true);
  assert.deepEqual(log, ['seq.stop']);
  assert.equal(editor.playing, false);
  assert.equal(cmp.seqPlaying, false);
});

test('C002: stopPlayback (MEASURE, Studio PLAY) reads the live sequencer, not the copy', () => {
  const { owner, editor, cmp, log } = setup({ playing: true, studio: true });
  editor.playing = true; // started inside the poll window: cmp.seqPlaying still false
  owner.stopPlayback(cmp);
  assert.deepEqual(log, ['seq.stop', 'instrument.stopNow', 'studio.stop']);
  assert.equal(cmp.seqPlaying, false);
  assert.deepEqual(OUTPUT_YIELDS.measure, ['sequencer', 'instrument', 'studio']);
});

test('C002: no component yet grants the claim; an unknown owner is a programming error', () => {
  const owner = createOutputOwner({ app: () => null, sequencer: () => null });
  assert.equal(owner.claimOutput('sequencer'), true);
  assert.equal(owner.sequencerPlaying(), false);
  const { owner: o } = setup();
  assert.throws(() => o.claimOutput('radio'), /unknown owner radio/);
});

test('C002: stopSequence reads the live state; it clears only a set copy', async () => {
  const { owner, cmp, editor, log, changes } = setup();
  assert.equal(owner.stopSequence(cmp), false, 'nothing playing: nothing to stop');
  editor.playing = true;
  assert.equal(owner.stopSequence(cmp), true);
  assert.deepEqual(log, ['seq.stop']);
  await tick();
  assert.equal(changes(), 0, 'the copy was already false');
});

// ---------------------------------------------------------------- C016 (#297)
// MEASURE's setup check reports OTHER_AUDIO for the same owners stopPlayback stops: one table in
// createOutputOwner, so a source one of them knows and the other does not (the sequencer and
// the Studio transport never enter engine.audibleVoiceCount) cannot come back.

test('C016: outputBusy is true exactly while an owner stopPlayback stops sounds', () => {
  for (const [id, state] of [['sequencer', { seq: true }], ['instrument', { playing: true }],
    ['studio', { studio: true }]]) {
    const { owner, cmp, log } = setup(state);
    const idle = setup();
    assert.equal(idle.owner.outputBusy(idle.cmp), false, 'nothing sounding');
    assert.equal(owner.outputBusy(cmp), true, `${id} sounding`);
    assert.deepEqual(log, [], 'outputBusy stops nothing');
    owner.stopPlayback(cmp);
    assert.equal(log.length, 1, `stopPlayback stops ${id} and nothing else: ${log}`);
    if (id !== 'instrument') assert.equal(owner.outputBusy(cmp), false, `${id} stopped`);
  }
});

test('C016: outputBusy reads the sequencer live, not the 150 ms seqPlaying copy', () => {
  const { owner, cmp, editor } = setup();
  editor.playing = true; // editor.play() has just scheduled; the poll has not run yet
  cmp.seqPlaying = false;
  assert.equal(owner.outputBusy(cmp), true);
  editor.playing = false;
  cmp.seqPlaying = true; // a stale copy of a stopped sequence
  assert.equal(owner.outputBusy(cmp), false);
  // No sequencer editor and no Studio: nothing to be busy.
  const bare = createOutputOwner({ app: () => ({}), sequencer: () => null });
  assert.equal(bare.outputBusy({}), false);
});

test('C016: outputBusy and stopPlayback name the same owners (OUTPUT_YIELDS.measure)', () => {
  assert.deepEqual([...OUTPUT_YIELDS.measure].sort(), ['instrument', 'sequencer', 'studio']);
  const all = setup({ playing: true, studio: true, seq: true });
  assert.equal(all.owner.outputBusy(all.cmp), true);
  all.owner.stopPlayback(all.cmp);
  assert.deepEqual(all.log.sort(), ['instrument.stopNow', 'seq.stop', 'studio.stop']);
});

// ---------------------------------------------------------------- C024 (review F5 'D4', F7)
// Keyboard and MIDI notes are an output owner: held notes alone make outputOwnerOf name them,
// the scope's description, the drawing and the status bar name the same owner, and the
// keyboard no longer overrides the instrument's vizInputs (the override outputOwner did not
// know). Fails on the merge base, where notes reach the scope only through that override.

test('C024: held notes alone own the output, after the instrument, sequencer and Studio', () => {
  assert.ok(OUTPUT_OWNERS.includes('notes'));
  assert.strictEqual(assertOutputOwner('notes'), 'notes');
  assert.strictEqual(typeof OUTPUT_OWNER_NAMES.notes, 'string');
  assert.ok(OUTPUT_OWNER_NAMES.notes.length > 0);
  assert.strictEqual(outputOwnerOf({ notes: true }), 'notes');
  // Notes are refused while the sequencer or the Studio owns the output (midi/ui.js ownedBy),
  // and an instrument voice and a note never sound together (ADR 0002): they overlap only in
  // a fade, where the newer owner is already the one named.
  assert.strictEqual(outputOwnerOf({ instrument: true, notes: true }), 'instrument');
  assert.strictEqual(outputOwnerOf({ sequencer: true, notes: true }), 'sequencer');
  assert.strictEqual(outputOwnerOf({ studio: true, notes: true }), 'studio');
  assert.strictEqual(outputOwnerOf({ notes: false }), null);
});

function notesCmp(fields) {
  const wb = createWorkbench({ engine: { analyser: { fftSize: 8192 } } });
  const cmp = {};
  Object.defineProperties(cmp, Object.getOwnPropertyDescriptors(wb));
  Object.assign(cmp, {
    tabs: { analysis: 'waveform' }, timeWindowMs: 5, source: 'single', metricFrequency: 250,
    effectiveSampleRate: 48000, waveform: 'sine', playing: false, seqPlaying: false,
    studio: { playing: false }, studioOwnsOutput() { return this.studio.playing; },
    status: 'READY', kbdSounding: false, kbdHeld: '',
  }, fields);
  return cmp;
}

test('C024: the description and the status bar name the notes while only notes sound', () => {
  const held = notesCmp({ kbdSounding: true, kbdHeld: 'C4, E4, G4' });
  const name = OUTPUT_OWNER_NAMES.notes;
  assert.strictEqual(held.outputOwner, 'notes');
  assert.ok(held.analysisCanvasLabel.includes(`(${name})`), held.analysisCanvasLabel);
  assert.doesNotMatch(held.analysisCanvasLabel, /not playing/);
  assert.match(held.analysisCanvasLabel, /relative to full scale/);
  assert.strictEqual(held.statusLabel, 'PLAYING');
  assert.strictEqual(held.anySounding, true, 'the status dot shows the notes sounding');
  assert.strictEqual(held.statusPatternText.toLowerCase(), name.toLowerCase(),
    'the status bar names the owner the description names');
  assert.strictEqual(held.statusFreqText, 'C4, E4, G4', 'the status bar shows the held notes');
  // The status Play button is the instrument's and the sequencer's (ADR 0050): not the notes'.
  assert.strictEqual(held.isSounding, false);

  const released = notesCmp({ kbdSounding: false, source: 'sweep', sweep: { curve: 'log' } });
  assert.strictEqual(released.outputOwner, null);
  assert.match(released.analysisCanvasLabel, /not playing/);
  assert.strictEqual(released.statusLabel, 'READY');
  assert.notStrictEqual(released.statusPatternText.toLowerCase(), name.toLowerCase());

  const both = notesCmp({ kbdSounding: true, playing: true });
  assert.strictEqual(both.outputOwner, 'instrument');
});

test('C024: the bridge takes the notes owner and the scope draws and names it', () => {
  const env = {
    document: { hidden: false, documentElement: {}, addEventListener() {},
      removeEventListener() {} },
    requestAnimationFrame: () => 1, setTimeout: () => 1, setInterval: () => 1,
    clearInterval() {},
  };
  const bridge = new VisualizationBridge({ env });
  bridge.attachP5({ canvas: {}, loop() {}, noLoop() {}, redraw() {} });
  bridge.state.reducedMotion = true;
  bridge.setOutputOwner('notes');
  assert.strictEqual(bridge.state.outputOwner, 'notes');
  assert.strictEqual(bridge.looping, true, 'held notes keep the scope updating');

  const drawn = [];
  const ctx = {
    font: '', fillStyle: '', textAlign: '', textBaseline: '', save() {}, restore() {},
    fillText: (t) => { drawn.push(String(t)); },
    measureText: (t) => ({ width: String(t).length * 5 }),
  };
  const base = {
    LEFT: 'left', RIGHT: 'right', CENTER: 'center', CLOSE: 'close', drawingContext: ctx,
    color: () => ({ setAlpha() {}, toString: () => 'rgb(0,0,0)' }), vertex() {},
  };
  const p = new Proxy(base, { get: (t, k) => (k in t ? t[k] : () => {}) });
  const d = new Float32Array(8192);
  for (let i = 0; i < d.length; i++) d[i] = 0.5 * Math.sin((2 * Math.PI * 440 * i) / 48000);
  // The keyboard's override no longer marks the instrument playing: the owner alone draws.
  const st = { live: { timeData: d, sampleRate: 48000, inst: NaN, refFreq: 250, hasCtx: true },
    playing: false, outputOwner: 'notes', gain: 0.08, frequency: 250, waveform: 'sine',
    plan: null };
  createScopeView({ getWindowMs: () => 5 }).draw({ p, W: 600, H: 200, pal: { gridSoft: 'g',
    muted: 'm', accent: 'a', dim: 'd', accentFaint: 'f', accentSoft: 's' },
  bandMin: new Float32Array(600), bandMax: new Float32Array(600) }, st);
  const label = drawn.find((t) => t.startsWith('output analyser'));
  assert.ok(label, JSON.stringify(drawn));
  assert.ok(label.includes(`· ${OUTPUT_OWNER_NAMES.notes}`), label);
  assert.match(label, /relative to full scale/);
});

/** Every .js file under src/js. */
function jsFiles(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) out.push(...jsFiles(p));
    else if (name.endsWith('.js')) out.push(p);
  }
  return out;
}

/** The files (relative to ROOT) that assign a `vizInputs` member, outside instrument.js. */
function vizInputsOverrides(files, read = (f) => readFileSync(f, 'utf8')) {
  const assign = /\.vizInputs\s*=(?!=)|\[\s*['"]vizInputs['"]\s*\]\s*=(?!=)/;
  return files.filter((f) => !f.endsWith(path.join('src', 'js', 'core', 'instrument.js'))
    && assign.test(read(f))).map((f) => path.relative(ROOT, f));
}

test('C024: no file reassigns cmp.vizInputs outside src/js/core/instrument.js', () => {
  assert.deepStrictEqual(vizInputsOverrides(jsFiles(path.join(ROOT, 'src', 'js'))), []);
});

test('C024 mutation: the scan finds a restored override and passes a comparison', () => {
  const kb = path.join(ROOT, 'src', 'js', 'midi', 'keyboard-ui.js');
  const restored = 'const v = cmp.vizInputs;\ncmp.vizInputs = function vizInputsWithNotes(r) {};';
  assert.deepStrictEqual(vizInputsOverrides([kb], () => restored),
    [path.join('src', 'js', 'midi', 'keyboard-ui.js')]);
  assert.deepStrictEqual(vizInputsOverrides([kb], () => "cmp['vizInputs'] = f;"),
    [path.join('src', 'js', 'midi', 'keyboard-ui.js')]);
  assert.deepStrictEqual(vizInputsOverrides([kb], () => 'if (cmp.vizInputs === f) {}'), []);
  const inst = path.join(ROOT, 'src', 'js', 'core', 'instrument.js');
  assert.deepStrictEqual(vizInputsOverrides([inst], () => restored), []);
});
