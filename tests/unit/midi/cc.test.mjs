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
import { CC_SLOTS, ENGINE_ENV, ccTarget, ccValue, midiCc }
  from '../../../src/js/synth/midi-cc.js';
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

/** A fake panel: nodes with params, a store that counts gestures, setControl that records. */
function panelRig() {
  const params = { lpf: { frequency: 1200, Q: 1 }, eg2: { attack: 0.005 } };
  const gestures = [];
  const store = { beginGesture: (label) => gestures.push(['begin', label]),
    endGesture: () => gestures.push(['end']) };
  const set = [];
  const controlOf = (cid) => {
    const [mid, key] = cid.split('.');
    const c = SEMI_MONO.faceOf(mid).find((x) => x.key === key);
    return c ? { mid, key, c, node: params[mid] ? { id: mid, params: params[mid] } : null } : null;
  };
  const setControl = (cid, v) => {
    const [mid, key] = cid.split('.');
    params[mid][key] = v;
    set.push([cid, v]);
    return { ok: true };
  };
  const deps = { faceOf: SEMI_MONO.faceOf, played: () => 'keys', controlOf, setControl,
    handle: () => store };
  return { params, gestures, set, deps, store };
}

test('midiCc moves the slot\'s control, one undo entry per run of messages on it', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const r = panelRig();
  const a = midiCc(74, 0, r.deps);
  assert.equal(a.cid, 'lpf.frequency');
  assert.equal(r.params.lpf.frequency, 10);
  assert.match(a.text, /^CC 74 → LPF Cutoff: /);
  midiCc(74, 64, r.deps);
  midiCc(74, 127, r.deps);
  assert.equal(r.params.lpf.frequency, 20000);
  assert.deepEqual(r.gestures, [['begin', 'Změnit LPF Cutoff (MIDI CC 74)']],
    'one gesture is open for the run');
  midiCc(71, 127, r.deps); // another control closes the run
  assert.deepEqual(r.gestures.map(([k]) => k), ['begin', 'end', 'begin']);
  t.mock.timers.tick(GESTURE_IDLE_MS);
  assert.deepEqual(r.gestures.map(([k]) => k), ['begin', 'end', 'begin', 'end'],
    'the run closes GESTURE_IDLE_MS after its last message');
  assert.equal(midiCc(3, 10, r.deps), null, 'an unassigned controller changes nothing');
  assert.equal(midiCc(80, 10, r.deps), null, 'a module missing from the document: nothing');
  assert.equal(r.gestures.length, 4);
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
