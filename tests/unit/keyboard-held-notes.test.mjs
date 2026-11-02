// K026, ADR 0062 (amending ADR 0005, owner decision D3): a note held on the computer keyboard,
// the on-screen keys or a MIDI key is exempt from the configured playback limit while it is
// held, keeps the output ceiling, and is force-released on window blur, page hide and Escape.
// On the page's own modules (AudioEngine, the MIDI component part of src/js/midi/ui.js) with
// the fake audio context of tests/unit/sequencer-fake-audio.mjs: one virtual clock, no real time.
//
// - engine.noteOn(key, { held: true }): no scheduled end, neither limited nor extended (so
//   revokeContinuous leaves it), peak at level / NOTE_POLYPHONY under the master level, freed
//   by noteOff with the node census at zero; a note without `held` keeps HOLD's limit.
// - The component: a MIDI note and a computer-keyboard note sound past the 2 s limit, and blur,
//   visibilitychange to hidden, pagehide and Escape each release every one of them (census 0).
// - The keyboard is armed per view and never takes Space.
//
//   node --test tests/unit/keyboard-held-notes.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';

import { AudioEngine, NOTE_POLYPHONY } from '../../src/js/audio/audio-engine.js';
import { GAIN_FLOOR, MAX_OUTPUT_GAIN } from '../../src/js/core/constants.js';
import { createMidiUi } from '../../src/js/midi/ui.js';
import { createFakeAudioEnv } from './sequencer-fake-audio.mjs';

const LIMIT_S = 2;

function engineRig() {
  const fake = createFakeAudioEnv({ sampleRate: 48000 });
  const engine = new AudioEngine({ env: fake.env });
  return { fake, engine, get ctx() { return fake.ctx; } };
}

// Freed: no engine node or source, no live oscillator counted on the context, no note key.
const census = (r) => ({ nodes: r.engine.activeNodeCount, sources: r.engine.activeSourceCount,
  live: r.ctx.liveSources, voices: r.engine.voices.size, notes: r.engine.notes.size });
const ZERO = { nodes: 0, sources: 0, live: 0, voices: 0, notes: 0 };

const NOTE = { freq: 440, level: 1, wave: 'sine', attackS: 0.01, releaseS: 0.05,
  limitS: LIMIT_S, continuous: false };

test('engine: a held note has no end at the limit, stays under the master level, and frees', () => {
  const r = engineRig();
  const res = r.engine.noteOn('k:0:69', { ...NOTE, held: true });
  assert.equal(res.ok, true);
  assert.equal(res.limited, false, 'a held note is not limited');
  assert.equal(res.end, Infinity, 'and has no scheduled end');
  const osc = r.ctx.oscillators[0];
  assert.equal(osc.stopAt, null, 'its oscillator is not stopped at the limit');
  r.fake.advance(LIMIT_S * 3);
  assert.equal(r.engine.noteCount, 1, 'it sounds past the configured limit while held');
  const env = osc.outputs[0];
  const peak = Math.max(...env.gain.events.map((e) => e.value));
  assert.ok(peak <= 1 / NOTE_POLYPHONY + 1e-12, `peak ${peak} at most level / NOTE_POLYPHONY`);
  assert.ok(r.engine.gainLevel <= MAX_OUTPUT_GAIN, 'the master level keeps the ceiling');
  assert.equal(r.engine.revokeContinuous(), 0, 'not extended: the permission does not own it');
  assert.equal(r.engine.noteCount, 1);
  assert.equal(r.engine.noteOff('k:0:69'), true, 'released by its own Note Off / key up');
  r.fake.advance(1);
  assert.deepEqual(census(r), ZERO, 'nothing left after the release');
});

test('engine: a note that is not held keeps HOLD\'s limit (ADR 0005 unchanged)', () => {
  const r = engineRig();
  const res = r.engine.noteOn('k:0:69', NOTE);
  assert.equal(res.limited, true);
  const env = r.ctx.oscillators[0].outputs[0];
  const last = env.gain.events.at(-1);
  assert.deepEqual([last.ramp, last.value], ['linear', GAIN_FLOOR]);
  assert.ok(Math.abs(last.t - res.start - LIMIT_S) < 1e-9, 'its envelope ends at the limit');
  r.fake.advance(LIMIT_S + 1);
  assert.deepEqual(census(r), ZERO, 'freed at the limit');
});

class Port extends EventTarget {
  constructor(name) {
    super();
    Object.assign(this, { name, state: 'connected', type: 'input' });
  }
  open() { return Promise.resolve(this); }
  send(bytes) {
    const ev = new Event('midimessage');
    ev.data = Uint8Array.from(bytes);
    this.dispatchEvent(ev);
  }
}

class Access extends EventTarget {
  constructor(ports) { super(); this.inputs = new Map(ports.map((p, i) => [`in-${i}`, p])); }
}

const settle = () => new Promise((resolve) => { setImmediate(resolve); });

/** The MIDI component part on a fake window, one connected input, and a key-event helper. */
async function componentRig() {
  const r = engineRig();
  const on = {};
  const listen = (target) => (type, fn) => { (on[`${target}:${type}`] ||= []).push(fn); };
  const doc = { hidden: false, activeElement: null, addEventListener: listen('doc') };
  const requests = [];
  const win = { navigator: { requestMIDIAccess: () => new Promise((res) => requests.push(res)) },
    isSecureContext: true, location: { protocol: 'file:', host: '' }, document: doc,
    addEventListener: listen('win') };
  const fire = (key, e = {}) => { for (const fn of on[key] || []) fn(e); };
  const key = (type, code, extra = {}) => {
    const e = { type, code, key: code === 'Space' ? ' ' : code.replace(/^Key/, '').toLowerCase(),
      repeat: false, target: null, defaultPrevented: false, stopped: false,
      preventDefault() { this.defaultPrevented = true; },
      stopImmediatePropagation() { this.stopped = true; }, ...extra };
    fire(`win:${type}`, e);
    return e;
  };
  const cmp = Object.assign(createMidiUi({ win, engine: r.engine }), {
    workspace: 'playground', a4: 440, waveform: 'sine', attack: 10, release: 50,
    safetyLimit: LIMIT_S, continuousAllowed: false, notify: () => {},
    measureOwnsOutput: () => false, studioOwnsOutput: () => false,
    meas: { levelForm: { capturing: false } },
  });
  await cmp.midiInit();
  cmp.midiConnect();
  const port = new Port('A');
  requests[0](new Access([port]));
  await settle();
  return { r, cmp, port, fire, key, doc };
}

test('component: a held MIDI note and a held computer key sound past the limit', async () => {
  const { r, cmp, port, key } = await componentRig();
  port.send([0x90, 60, 100]);
  assert.equal(typeof cmp.kbdToggle, 'function', 'the keyboard is part of the component');
  cmp.kbdToggle();
  assert.equal(cmp.kbdArmedHere, true, 'armed in the Playground');
  const down = key('keydown', 'KeyA');
  assert.equal(down.defaultPrevented, true, 'an armed key is the keyboard\'s');
  assert.equal(r.engine.noteCount, 2, 'the MIDI note and the key A both sound');
  r.fake.advance(LIMIT_S * 3);
  assert.equal(r.engine.noteCount, 2, 'both still sound three limits later, held');
  port.send([0x80, 60, 0]);
  key('keyup', 'KeyA');
  r.fake.advance(1);
  assert.deepEqual(census(r), ZERO, 'released, nothing left');
});

test('component: blur, hide, pagehide and Escape force-release every held note', async () => {
  const { r, cmp, port, fire, key, doc } = await componentRig();
  cmp.kbdToggle();
  const releases = {
    blur: () => fire('win:blur'),
    hidden: () => { doc.hidden = true; fire('doc:visibilitychange'); doc.hidden = false; },
    pagehide: () => fire('win:pagehide'),
    escape: () => key('keydown', 'Escape', { key: 'Escape' }),
  };
  for (const [name, release] of Object.entries(releases)) {
    port.send([0x90, 64, 100]);
    key('keydown', 'KeyD');
    key('keydown', 'KeyG');
    r.fake.advance(LIMIT_S + 1);
    assert.equal(r.engine.noteCount, 3, `${name}: three held notes past the limit`);
    release();
    r.fake.advance(1);
    assert.deepEqual(census(r), ZERO, `${name}: every held note released, census 0`);
    assert.equal(cmp.kbdHeld, '', `${name}: nothing lit`);
    key('keyup', 'KeyD');
    key('keyup', 'KeyG');
  }
});

test('component: armed per view, never Space, never while typing', async () => {
  const { r, cmp, key } = await componentRig();
  let e = key('keydown', 'KeyA');
  assert.equal(e.defaultPrevented, false, 'not armed: the key is not taken');
  assert.equal(r.engine.noteCount, 0);
  cmp.kbdToggle();
  e = key('keydown', 'Space');
  assert.equal(e.defaultPrevented, false, 'Space is never the keyboard\'s (ADR 0050)');
  assert.equal(r.engine.noteCount, 0);
  e = key('keydown', 'KeyA', { target: { tagName: 'INPUT', type: 'text' } });
  assert.equal(e.defaultPrevented, false, 'a text field keeps its keys');
  e = key('keydown', 'KeyA', { ctrlKey: true });
  assert.equal(e.defaultPrevented, false, 'Ctrl+A is a shortcut, not a note');
  assert.equal(r.engine.noteCount, 0);
  cmp.workspace = 'studio';
  e = key('keydown', 'KeyA');
  assert.equal(e.defaultPrevented, false, 'armed in the Playground is not armed in the Studio');
  cmp.kbdToggle();
  e = key('keydown', 'KeyA');
  assert.equal(e.stopped, true, 'armed in the Studio: before Studio\'s own A');
  assert.equal(r.engine.noteCount, 1);
  cmp.workspace = 'measure';
  assert.equal(cmp.kbdArmedHere, false, 'Measure has no keyboard');
  e = key('keydown', 'KeyS');
  assert.equal(e.defaultPrevented, false);
  cmp.kbdReleaseAll();
  r.fake.advance(1);
  assert.deepEqual(census(r), ZERO);
});
