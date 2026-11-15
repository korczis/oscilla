// V506: a MIDI controller plays the Synth panel. CC 64 holds released keys until the pedal comes
// up (src/js/midi/notes.js); every other Control Change moves the panel control of its slot
// (src/js/synth/midi-cc.js), along the control's own scale, one undo entry per run of messages,
// and only while the Synth is shown (src/js/midi/ui.js midiControl).
//
//   node --test tests/unit/midi/cc.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';

import { createMidiNotes } from '../../../src/js/midi/notes.js';
import { createMidiUi, CC_STATUS_MS } from '../../../src/js/midi/ui.js';
import { CC_SLOTS, ENGINE_ENV, ccTarget, ccValue, ccEdit }
  from '../../../src/js/synth/midi-cc.js';
import { createGestures } from '../../../src/js/synth/gestures.js';
import { createHistory } from '../../../src/js/studio/history.js';
import { GESTURE_IDLE_MS } from '../../../src/js/ui/synth/feel.js';
import SEMI_MONO from '../../../src/js/synth/panels/semi-mono.js';

/** A note layer whose route is a sink that logs every on and off. */
function routed() {
  const log = [];
  const sink = { noteOn: (n) => { log.push(['on', n]); return { ok: true }; },
    noteOff: (n) => { log.push(['off', n]); return true; },
    allOff: () => { log.push(['all']); return 0; } };
  // The engine is never reached here (every note is routed); handle() needs one to run.
  const engine = { noteOn: () => ({ ok: false }), noteOff: () => false, notesOff: () => 0 };
  const notes = createMidiNotes({ engine, route: () => sink });
  return { notes, log };
}

test('CC 64 holds a released key until the pedal comes up, per input and channel', () => {
  const { notes, log } = routed();
  notes.noteOn(60, 100, 1, 0);
  notes.noteOn(64, 100, 1, 0);
  notes.noteOn(67, 100, 2, 0); // another input: its own pedal
  assert.equal(notes.sustain(true, 1, 0), 0);
  notes.noteOff(60, 1, 0);
  notes.noteOff(64, 1, 0);
  notes.noteOff(67, 2, 0);
  assert.deepEqual(log.filter(([k]) => k === 'off'), [['off', 67]],
    'only the key of the input whose pedal is up was released');
  assert.equal(notes.sustain(false, 1, 0), 2);
  assert.deepEqual(log.filter(([k]) => k === 'off'), [['off', 67], ['off', 60], ['off', 64]]);
  assert.equal(notes.sustain(false, 1, 0), 0, 'a second pedal up releases nothing');
});

test('a key pressed again under the pedal sounds until its own Note Off', () => {
  const { notes, log } = routed();
  notes.sustain(true);
  notes.noteOn(60, 100);
  notes.noteOff(60);
  notes.noteOn(60, 90); // pressed again while the pedal holds it
  const offs = () => log.filter(([k]) => k === 'off').length;
  const before = offs();
  assert.equal(notes.sustain(false), 0, 'the pedal up leaves the held key alone');
  assert.equal(offs(), before);
  notes.noteOff(60);
  assert.equal(offs(), before + 1, 'its own Note Off releases it');
});

test('a forced stop, All Notes Off and silence are never held by the pedal', () => {
  const { notes, log } = routed();
  notes.sustain(true);
  notes.noteOn(60, 100);
  assert.equal(notes.noteOff(60, 0, 0, { forced: true }), true);
  assert.deepEqual(log.slice(-1), [['off', 60]], 'a forced off goes through');
  notes.noteOn(62, 100);
  notes.noteOff(62);
  notes.silence();
  const offs = log.filter(([k]) => k === 'off').length;
  assert.equal(notes.sustain(false), 0, 'silence dropped what the pedal held');
  assert.equal(log.filter(([k]) => k === 'off').length, offs);
  notes.sustain(true);
  notes.noteOn(65, 100);
  notes.noteOff(65);
  notes.handle([0xb0, 123, 0]);
  assert.equal(notes.sustain(false), 0, 'All Notes Off dropped what the pedal held');
});

test('handle(): CC 64 is the pedal, another CC comes back as a control-change event', () => {
  const { notes, log } = routed();
  notes.handle([0x90, 60, 100], 7);
  notes.handle([0xb0, 64, 127], 7);
  notes.handle([0x80, 60, 0], 7);
  assert.deepEqual(log.filter(([k]) => k === 'off'), []);
  const up = notes.handle([0xb0, 64, 0], 7);
  assert.equal(up.released, 1);
  assert.deepEqual(log.slice(-1), [['off', 60]]);
  assert.deepEqual(notes.handle([0xb3, 74, 5], 7),
    { kind: 'control-change', channel: 3, controller: 74, value: 5 });
});

test('every slot names a knob or an amount on the Synth panel\'s face', () => {
  for (const [cc, cid] of Object.entries(CC_SLOTS)) {
    const [mid, key] = cid.split('.');
    const c = SEMI_MONO.faceOf(mid).find((x) => x.key === key);
    assert.ok(c, `CC ${cc} -> ${cid} is on the face`);
    assert.ok(c.kind === 'knob' || c.kind === 'amount', `CC ${cc} -> ${cid} is ${c.kind}`);
  }
  // The KeyLab mkII family's factory layout: encoders, filter-envelope and second-envelope
  // faders, volume (docs/MIDI.md).
  assert.equal(CC_SLOTS[74], 'lpf.frequency');
  assert.equal(CC_SLOTS[71], 'lpf.Q');
  assert.deepEqual([73, 75, 79, 72].map((n) => CC_SLOTS[n]),
    ['eg2.attack', 'eg2.decay', 'eg2.sustain', 'eg2.release']);
  assert.deepEqual([80, 81, 82, 83].map((n) => CC_SLOTS[n]),
    ['eg1.attack', 'eg1.decay', 'eg1.sustain', 'eg1.release']);
  assert.equal(CC_SLOTS[64], undefined, 'the pedal is the note layer\'s, not a knob');
});

test('the filter-envelope faders play the chosen engine\'s own envelope on the Engines tab', () => {
  const faceOf = SEMI_MONO.faceOf;
  for (const engine of ['additive', 'fm', 'am', 'wavetable', 'sync']) {
    for (const [cc, key] of Object.entries(ENGINE_ENV)) {
      assert.equal(ccTarget(Number(cc), engine, faceOf), `${engine}.${key}`, `${engine} CC ${cc}`);
    }
  }
  assert.equal(ccTarget(73, 'keys', faceOf), 'eg2.attack');
  assert.equal(ccTarget(74, 'fm', faceOf), 'lpf.frequency', 'a slot without an engine twin');
  assert.equal(ccTarget(3, 'keys', faceOf), null, 'an unassigned controller');
});

test('a CC value is a position along the control: a log cutoff in equal ratios', () => {
  const p = SEMI_MONO.faceOf('lpf').find((c) => c.key === 'frequency').param;
  assert.equal(ccValue(0, p), 10);
  assert.equal(ccValue(127, p), 20000);
  const mid = ccValue(63.5, p);
  assert.ok(Math.abs(mid - Math.sqrt(10 * 20000)) < 1e-6, `mid ${mid}`);
  const s = SEMI_MONO.faceOf('eg2').find((c) => c.key === 'sustain').param;
  assert.equal(ccValue(127, s), 1);
  assert.equal(ccValue(200, s), 1, 'held to the range');
});

/**
 * A panel on a real history (studio/history.js): its store nests gestures and commits the
 * outermost, undo closes every gesture first, as studio/actions.js does; setControl records one
 * entry per edit (absorbed while a gesture is open). createGestures drives it.
 */
function panelRig() {
  const params = { lpf: { frequency: 1200, Q: 1 }, eg2: { attack: 0.005 } };
  const history = createHistory({ limit: 50 });
  let model = { params: JSON.parse(JSON.stringify(params)) };
  const store = {
    beginGesture: (label) => history.beginGesture(label, model),
    endGesture: () => history.endGesture(model),
    gestureId: () => history.gestureId(),
    undo: () => {
      while (history.inGesture()) history.endGesture(model);
      const e = history.undo();
      if (e) model = e.before;
      return e;
    },
  };
  const controlOf = (cid) => {
    const [mid, key] = cid.split('.');
    const c = SEMI_MONO.faceOf(mid).find((x) => x.key === key);
    return c ? { mid, key, c, node: params[mid] ? { id: mid, params: params[mid] } : null } : null;
  };
  const setControl = (cid, v) => {
    const [mid, key] = cid.split('.');
    const before = model;
    model = { params: { ...model.params, [mid]: { ...model.params[mid], [key]: v } } };
    params[mid][key] = v;
    history.record({ label: `set ${cid}`, before, after: model });
    return { ok: true };
  };
  const g = createGestures({ controlOf, valueOf: (x) => params[x.mid][x.key], setControl,
    handle: () => store, say: () => {}, label: (x) => `wheel ${x.mid}` });
  const knobEvent = (cid) => ({ target: { closest: (sel) => (sel === '[data-knob]'
    ? { dataset: { knob: cid } } : null) }, clientX: 0, clientY: 0, shiftKey: false });
  return { params, history, store, g, controlOf, setControl, knobEvent,
    labels: () => history.depth().undo, model: () => model };
}

test('ccEdit computes the slot\'s edit and applies nothing', () => {
  const r = panelRig();
  const deps = { faceOf: SEMI_MONO.faceOf, played: () => 'keys', controlOf: r.controlOf };
  const e = ccEdit(74, 0, deps);
  assert.deepEqual({ cid: e.cid, value: e.value, label: e.label }, { cid: 'lpf.frequency',
    value: 10, label: 'Změnit LPF Cutoff (MIDI CC 74)' });
  assert.match(e.text, /^CC 74 → LPF Cutoff: /);
  assert.equal(r.params.lpf.frequency, 1200, 'nothing applied');
  assert.equal(ccEdit(3, 10, deps), null, 'an unassigned controller');
  assert.equal(ccEdit(80, 10, deps), null, 'a module missing from the document');
});

test('gestures.cc moves the slot\'s control, one undo entry per run of messages on it',
  async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const r = panelRig();
    const cc = (n, v) => r.g.cc(n, v, SEMI_MONO.faceOf, () => 'keys');
    assert.match(cc(74, 0).text, /^CC 74 → LPF Cutoff: /);
    cc(74, 64);
    cc(74, 127);
    assert.equal(r.params.lpf.frequency, 20000);
    assert.equal(r.labels(), 0, 'the run is still one open gesture');
    cc(71, 127); // another control closes the run
    assert.equal(r.labels(), 1);
    t.mock.timers.tick(GESTURE_IDLE_MS);
    assert.equal(r.labels(), 2, 'the run closes GESTURE_IDLE_MS after its last message');
    assert.equal(r.history.undoLabel(), 'Změnit LPF Peak (MIDI CC 71)');
    assert.equal(cc(3, 10), null, 'an unassigned controller changes nothing');
    assert.equal(r.labels(), 2);
  });

test('C3-548-1: a CC burst never folds the next mouse edit into its undo entry', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const r = panelRig();
  r.g.cc(74, 30, SEMI_MONO.faceOf, () => 'keys');
  // 100 ms later a drag on another control: press closes the burst, the drag is its own entry
  t.mock.timers.tick(100);
  const knob = r.g.press('lpf.Q', r.controlOf('lpf.Q'), r.knobEvent('lpf.Q'));
  assert.equal(knob.cid, 'lpf.Q');
  r.store.beginGesture('drag lpf.Q');
  r.setControl('lpf.Q', 5);
  r.store.endGesture();
  assert.equal(r.labels(), 2, 'the CC run and the drag are two undo entries');
  assert.equal(r.history.undoLabel(), 'drag lpf.Q');
  r.store.undo();
  assert.equal(r.model().params.lpf.Q, 1, 'one undo takes back the drag only');
  assert.notEqual(r.model().params.lpf.frequency, 1200, 'the CC edit stays');
});

test('C3-548-1: an undo inside a CC burst leaves a later drag to its own gesture', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const r = panelRig();
  r.g.cc(74, 30, SEMI_MONO.faceOf, () => 'keys');
  r.store.undo(); // closes the burst's gesture and takes the CC edit back
  r.store.beginGesture('drag lpf.Q'); // a drag begun within GESTURE_IDLE_MS
  r.setControl('lpf.Q', 5);
  t.mock.timers.tick(GESTURE_IDLE_MS); // the burst's timer fires mid-drag
  assert.equal(r.history.inGesture(), true, 'the timer did not end the drag');
  r.setControl('lpf.Q', 6);
  r.store.endGesture();
  assert.equal(r.history.undoLabel(), 'drag lpf.Q', 'the drag is its own entry');
  assert.equal(r.model().params.lpf.frequency, 1200);
});

test('C3-548-4: a CC run interrupted by an undo goes on as one entry, not one per message',
  async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const r = panelRig();
    const cc = (v) => r.g.cc(74, v, SEMI_MONO.faceOf, () => 'keys');
    for (let v = 10; v < 15; v += 1) cc(v);
    r.store.undo(); // the run's gesture is closed and its edit taken back
    const before = r.labels();
    for (let v = 20; v < 28; v += 1) { cc(v); t.mock.timers.tick(50); }
    t.mock.timers.tick(GESTURE_IDLE_MS);
    assert.equal(r.labels(), before + 1, 'the rest of the run is one undo entry');
    assert.equal(r.history.undoLabel(), 'Změnit LPF Cutoff (MIDI CC 74)');
  });

test('C3-548-1: a wheel burst and a CC on another control are two entries', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const r = panelRig();
  const el = { dataset: { knob: 'lpf.Q' }, getAttribute: () => null };
  const wheel = { target: { closest: (sel) => (sel === '[data-knob]' ? el : null) },
    deltaY: -120, deltaMode: 0, deltaX: 0, preventDefault() {}, ctrlKey: false,
    metaKey: false, shiftKey: false };
  r.g.wheel(wheel);
  r.g.cc(74, 30, SEMI_MONO.faceOf, () => 'keys');
  t.mock.timers.tick(GESTURE_IDLE_MS);
  assert.equal(r.labels(), 2);
});

test('midiControl: only the shown Synth reads a CC; its status line is rate-limited', () => {
  const part = createMidiUi({ win: { navigator: {}, addEventListener() {} } });
  const calls = [];
  const cmp = { workspace: 'playground', synth: { status: '' },
    synthCc: (cc, v) => { calls.push([cc, v]); return { cid: `c${cc}`, text: `t${cc}=${v}` }; } };
  const e = (controller, value) => ({ kind: 'control-change', channel: 0, controller, value });
  assert.equal(part.midiControl.call(cmp, e(74, 1)), null);
  assert.deepEqual(calls, [], 'outside the Synth no knob moves');
  cmp.workspace = 'synth';
  part.midiControl.call(cmp, e(74, 1));
  assert.equal(cmp.synth.status, 't74=1');
  part.midiControl.call(cmp, e(74, 2));
  assert.equal(cmp.synth.status, 't74=1', `the same control again within ${CC_STATUS_MS} ms`);
  part.midiControl.call(cmp, e(71, 3));
  assert.equal(cmp.synth.status, 't71=3', 'another control is said at once');
  assert.equal(calls.length, 3);
});

test('C3-548-2: the last value of a run reaches the status line', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  const part = createMidiUi({ win: { navigator: {}, addEventListener() {} } });
  const cmp = { workspace: 'synth', synth: { status: '' },
    synthCc: (cc, v) => ({ cid: `c${cc}`, text: `t${cc}=${v}` }) };
  const e = (value) => ({ kind: 'control-change', channel: 0, controller: 71, value });
  for (let v = 98; v <= 127; v += 1) { part.midiControl.call(cmp, e(v)); t.mock.timers.tick(20); }
  assert.notEqual(cmp.synth.status, 't71=127', 'held back within the interval');
  t.mock.timers.tick(CC_STATUS_MS);
  assert.equal(cmp.synth.status, 't71=127', 'then the run\'s last value is written');
});

test('C3-548-3: silence forgets every pedal, so a lost input holds no later Note Off', () => {
  const { notes, log } = routed();
  notes.handle([0xb0, 64, 127], 1); // the pedal down, then its input is unplugged
  notes.silence();
  log.length = 0;
  notes.handle([0x90, 60, 100], 1);
  notes.handle([0x80, 60, 0], 1);
  assert.deepEqual(log, [['on', 60], ['off', 60]], 'the Note Off is not held by a stale pedal');
});
