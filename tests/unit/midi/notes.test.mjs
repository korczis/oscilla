// V502: MIDI notes sound through the AudioEngine (ADR 0058, its V502 note), on the page's own
// modules with the fake audio context of tests/unit/sequencer-fake-audio.mjs (one virtual
// clock for the context and the engine's timers; no real time passes).
//
// - A Note On is a note voice of the one engine: osc -> env -> fade -> cut -> master, at
//   midiToFrequency(note, A4), peaking at velocityLevel(velocity) / NOTE_POLYPHONY (raised to
//   GAIN_FLOOR for velocities 1 to 3).
// - The level cap: at no time do more than NOTE_POLYPHONY notes sound, and their peaks sum to at
//   most one voice; a note and the play() voice never sound together.
// - Click-free: the attack ramps linearly from GAIN_FLOOR, a release holds the output-stage
//   gain at exactly 1 and ramps it linearly to GAIN_FLOOR, nothing hard-switches to 0 or ramps
//   exponentially to 0, and the oscillator stops only after the gain has reached the floor.
// - The 0.95 x Nyquist bound comes from the running context: a note at or above it is refused.
// - Note Off, velocity 0, retrigger, All Sound Off, All Notes Off, omni channels, the safety
//   limit, and every way the notes stop leave zero engine nodes and zero live sources.
// - support.js listens to each connected input and says when one goes away.
// - A note is refused, said once per owner, while a measurement, a level reference capture,
//   the Studio or the sequencer owns the output.
//
//   node --test 'tests/unit/midi/*.test.mjs'
import test from 'node:test';
import assert from 'node:assert/strict';

import { AudioEngine, NOTE_POLYPHONY, ESCAPE_RELEASE_S, FAST_RELEASE_S }
  from '../../../src/js/audio/audio-engine.js';
import { GAIN_FLOOR, SAFE_NYQUIST_FACTOR } from '../../../src/js/core/constants.js';
import { midiToFrequency } from '../../../src/js/core/music.js';
import { createMidiNotes, parseMidiMessage, velocityLevel } from '../../../src/js/midi/notes.js';
import { createMidiSupport } from '../../../src/js/midi/support.js';
import { createFakeAudioEnv } from '../sequencer-fake-audio.mjs';

const SETTINGS = { a4: 440, waveform: 'sine', attackS: 0.01, releaseS: 0.05, limitS: 2,
  continuous: true };

function rig({ sampleRate = 48000, settings = {}, ownedBy = () => null } = {}) {
  const fake = createFakeAudioEnv({ sampleRate });
  const engine = new AudioEngine({ env: fake.env });
  const refusals = [];
  const notes = createMidiNotes({ engine, settings: () => ({ ...SETTINGS, ...settings }),
    ownedBy, refused: (by) => refusals.push(by) });
  return { fake, engine, notes, refusals, get ctx() { return fake.ctx; } };
}

const on = (n, v = 100, ch = 0) => [0x90 | ch, n, v];
const off = (n, ch = 0) => [0x80 | ch, n, 0];

/** The chain of a note's oscillator: [osc, env, fade, cut], each node's first output. */
function chain(osc) {
  const out = [osc];
  for (let n = osc; out.length < 4; n = n.outputs[0]) out.push(n.outputs[0]);
  return out;
}

/** Every note oscillator of the context with its chain and its sounding interval. */
function voices(ctx, engine) {
  return ctx.oscillators.map((osc) => {
    const [, env, fade, cut] = chain(osc);
    return { osc, env, fade, cut, toMaster: cut.outputs[0] === engine.master,
      start: osc.startAt, stop: osc.stopAt === null ? Infinity : osc.stopAt,
      peak: Math.max(...env.gain.events.map((e) => e.value)) };
  });
}

/** The most voices whose [start, stop) intervals overlap, and the largest sum of their peaks. */
function maxOverlap(vs) {
  let most = 0;
  let sum = 0;
  for (const a of vs) {
    const at = vs.filter((b) => b.start <= a.start && a.start < b.stop);
    most = Math.max(most, at.length);
    sum = Math.max(sum, at.reduce((s, b) => s + b.peak, 0));
  }
  return { most, sum };
}

// Freed: no engine node or source, no live oscillator (counted on the context, independently),
// no voice and no note key. The engine frees a released voice by its fallback timer here (the
// fake fires `ended` listeners, not `onended`), up to 0.25 s after the voice's end.
const allGone = (r) => r.engine.activeNodeCount === 0 && r.engine.activeSourceCount === 0
  && r.ctx.liveSources === 0 && r.engine.voices.size === 0 && r.engine.notes.size === 0;

/** No automation that clicks: no set to 0 from nonzero, no exponential ramp to 0. */
function assertClickFree(param, what) {
  let last = param.defaultValue;
  for (const [m, v] of param.calls) {
    if (m === 'setValueAtTime') {
      assert.ok(!(v === 0 && last !== 0), `${what}: no hard switch to 0`);
    }
    if (m === 'exponentialRampToValueAtTime') assert.ok(v > 0, `${what}: no exponential to 0`);
    if (typeof v === 'number') last = v;
  }
}

// ---------------------------------------------------------------------------- the messages
test('MIDI messages: Note On, Note Off, velocity 0, the two controllers, the rest ignored', () => {
  assert.deepEqual(parseMidiMessage(Uint8Array.from([0x93, 60, 100])),
    { kind: 'note-on', channel: 3, note: 60, velocity: 100 });
  assert.deepEqual(parseMidiMessage([0x80, 60, 64]),
    { kind: 'note-off', channel: 0, note: 60, velocity: 64 });
  assert.equal(parseMidiMessage([0x90, 60, 0]).kind, 'note-off', 'velocity 0 is a Note Off');
  assert.deepEqual(parseMidiMessage([0xb1, 120, 0]), { kind: 'all-sound-off', channel: 1 });
  assert.deepEqual(parseMidiMessage([0xb0, 123, 0]), { kind: 'all-notes-off', channel: 0 });
  for (const m of [[0xb0, 64, 127], [0xc0, 5], [60, 100, 0], [0x90, 60], [0x90, 200, 1],
    [0xe0, 0, 64], [], null]) {
    assert.equal(parseMidiMessage(m).kind, 'ignored', JSON.stringify(m));
  }
});

test('the velocity law is amplitude (v / 127)^2, 0 at 0 and 1 at 127', () => {
  assert.equal(velocityLevel(0), 0);
  assert.equal(velocityLevel(127), 1);
  assert.ok(Math.abs(velocityLevel(64) - (64 / 127) ** 2) < 1e-12);
  assert.ok(Math.abs(20 * Math.log10(velocityLevel(32)) - 40 * Math.log10(32 / 127)) < 1e-9);
  assert.equal(velocityLevel(500), 1);
  assert.equal(velocityLevel(-3), 0);
});

// ----------------------------------------------------------------------------- one note
test('a Note On is a note voice of the engine at the note\'s frequency, under the level cap',
  () => {
  const r = rig();
  const e = r.notes.handle(on(69, 127));
  assert.equal(e.kind, 'note-on');
  assert.equal(e.result.ok, true, JSON.stringify(e.result));
  const [v] = voices(r.ctx, r.engine);
  assert.equal(r.ctx.oscillators.length, 1, 'one oscillator, no second graph');
  assert.ok(v.toMaster, 'osc -> env -> fade -> cut -> the engine master');
  assert.equal(v.osc.frequency.events[0].value, 440);
  assert.equal(v.osc.type, 'sine');
  assert.equal(v.peak, 1 / NOTE_POLYPHONY, 'velocity 127 peaks at 1 / NOTE_POLYPHONY');
  assert.equal(r.engine.noteCount, 1);
  assert.equal(r.engine.voice, null, 'a note is never the play() voice');
  assert.equal(r.engine.activeNodeCount, 4);

  const r2 = rig({ settings: { a4: 432, waveform: 'square' } });
  r2.notes.handle(on(60, 64));
  const [w] = voices(r2.ctx, r2.engine);
  assert.ok(Math.abs(w.osc.frequency.events[0].value - midiToFrequency(60, 432)) < 1e-9);
  assert.equal(w.osc.type, 'square', 'the Playground waveform');
  assert.ok(Math.abs(w.peak - velocityLevel(64) / NOTE_POLYPHONY) < 1e-12);
});

test('velocities 1 to 3 sound at the engine\'s gain floor, from 4 the law holds exactly', () => {
  for (let vel = 1; vel <= 8; vel += 1) {
    const r = rig();
    r.notes.handle(on(60, vel));
    const [v] = voices(r.ctx, r.engine);
    const law = velocityLevel(vel) / NOTE_POLYPHONY;
    if (vel <= 3) {
      assert.ok(law < GAIN_FLOOR, `velocity ${vel}: the law is under the floor`);
      assert.equal(v.peak, GAIN_FLOOR, `velocity ${vel} peaks at GAIN_FLOOR (-80 dB)`);
    } else {
      assert.ok(Math.abs(v.peak - law) < 1e-15, `velocity ${vel} follows (v / 127)^2 / 8`);
    }
  }
});

test('the attack and the release are click-free, and the stop comes after the floor', () => {
  const r = rig();
  r.notes.handle(on(60));
  const [v] = voices(r.ctx, r.engine);
  const ev = v.env.gain.events;
  assert.deepEqual(ev.slice(0, 3).map((x) => [x.ramp, x.value]),
    [['set', GAIN_FLOOR], ['set', GAIN_FLOOR], ['linear', v.peak]]);
  assert.equal(ev[1].t, v.start, 'the attack starts from the floor at the oscillator start');
  assert.ok(Math.abs(ev[2].t - v.start - SETTINGS.attackS) < 1e-9);
  r.fake.advance(0.2);
  r.notes.handle(off(60));
  const fade = v.fade.gain.events;
  assert.equal(fade.length, 2, 'the release is the output-stage fade, nothing else');
  assert.deepEqual([fade[0].ramp, fade[0].value], ['set', 1], 'held at exactly 1');
  assert.deepEqual([fade[1].ramp, fade[1].value], ['linear', GAIN_FLOOR]);
  assert.ok(Math.abs(fade[1].t - fade[0].t - SETTINGS.releaseS) < 1e-9, 'with the release time');
  assert.ok(v.osc.stopAt >= fade[1].t, 'the oscillator stops after the floor');
  assert.equal(v.env.gain.events.length, ev.length, 'the sounding envelope is not edited');
  for (const p of [v.env.gain, v.fade.gain, v.cut.gain]) assertClickFree(p, 'note gain');
  r.fake.advance(1);
  assert.ok(allGone(r), 'zero nodes and sources after the release');
});

// ----------------------------------------------------------------------------- polyphony
test('polyphony is bounded: past NOTE_POLYPHONY the oldest fades first, the sum stays one voice',
  () => {
    const r = rig();
    for (let i = 0; i < NOTE_POLYPHONY; i++) r.notes.handle(on(60 + i, 127));
    assert.equal(r.engine.noteCount, NOTE_POLYPHONY);
    const e = r.notes.handle(on(80, 127));
    assert.equal(e.result.ok, true);
    assert.equal(e.result.stolen, 1, 'one note made room');
    for (let i = 0; i < 6; i++) r.notes.handle(on(90 + i, 127));
    const vs = voices(r.ctx, r.engine);
    const { most, sum } = maxOverlap(vs);
    assert.ok(most <= NOTE_POLYPHONY, `at most ${NOTE_POLYPHONY} sound at once (${most})`);
    assert.ok(sum <= 1 + 1e-12, `their peaks sum to at most one voice (${sum})`);
    const first = vs[0];
    assert.ok(first.stop <= vs[NOTE_POLYPHONY].start + 1e-12,
      'the stolen note has stopped when the new one starts');
    assert.ok(Math.abs(first.fade.gain.events[1].t - first.fade.gain.events[0].t
      - FAST_RELEASE_S) < 1e-9, 'it faded within FAST_RELEASE_S');
    r.fake.advance(0.1);
    assert.ok(r.engine.noteCount <= NOTE_POLYPHONY);
    r.notes.handle([0xb0, 120, 0]);
    r.fake.advance(1);
    assert.ok(allGone(r), 'All Sound Off frees everything');
  });

test('a repeated Note On for a sounding key fades the old one under the new; omni channels', () => {
  const r = rig();
  r.notes.handle(on(60));
  r.fake.advance(0.1);
  r.notes.handle(on(60));
  const [a, b] = voices(r.ctx, r.engine);
  assert.equal(a.fade.gain.events.length, 2, 'the old one fades');
  assert.ok(a.stop < Infinity && b.stop === Infinity);
  r.notes.handle(on(60, 100, 5));
  assert.equal(r.ctx.oscillators.length, 3, 'channel 6 is its own key (omni)');
  r.notes.handle(off(60));
  assert.equal(voices(r.ctx, r.engine)[2].fade.gain.events.length, 0, 'channel 6 still holds');
  r.notes.handle(off(61));
  r.notes.handle(off(60, 9));
  assert.equal(voices(r.ctx, r.engine)[2].fade.gain.events.length, 0,
    'a Note Off for a key that is not sounding changes nothing');
  r.notes.handle([0x95, 60, 0]);
  r.fake.advance(1);
  assert.ok(allGone(r), 'velocity 0 released the last one');
});

test('All Notes Off releases with the release time, All Sound Off within ESCAPE_RELEASE_S', () => {
  const r = rig({ settings: { releaseS: 0.4 } });
  r.notes.handle(on(60));
  r.notes.handle(on(64));
  r.fake.advance(0.05);
  r.notes.handle([0xb0, 123, 0]);
  for (const v of voices(r.ctx, r.engine)) {
    const [h, ramp] = v.fade.gain.events;
    assert.ok(Math.abs(ramp.t - h.t - 0.4) < 1e-9, 'All Notes Off: the note\'s own release');
  }
  r.notes.handle(on(67));
  r.fake.advance(0.05);
  r.notes.handle([0xb0, 120, 0]);
  const v = voices(r.ctx, r.engine)[2];
  const [h, ramp] = v.fade.gain.events;
  assert.ok(Math.abs(ramp.t - h.t - ESCAPE_RELEASE_S) < 1e-9, 'All Sound Off: the fast fade');
  r.fake.advance(1);
  assert.ok(allGone(r));
});

// ------------------------------------------------------------------------------- Nyquist
test('the 0.95 x Nyquist bound comes from the running context: a note above it is refused', () => {
  const r = rig({ sampleRate: 16000 });
  const safe = 16000 / 2 * SAFE_NYQUIST_FACTOR;
  assert.ok(midiToFrequency(118) < safe && midiToFrequency(119) >= safe);
  assert.equal(r.notes.handle(on(118)).result.ok, true);
  const refused = r.notes.handle(on(119)).result;
  assert.deepEqual(refused, { ok: false, reason: 'frequency' });
  assert.equal(r.ctx.oscillators.length, 1, 'nothing is scheduled at or above the bound');
  for (const o of r.ctx.oscillators) {
    for (const ev of o.frequency.events) assert.ok(ev.value < safe);
  }
  const hi = rig({ sampleRate: 44100 });
  assert.equal(hi.notes.handle(on(127)).result.ok, true, 'note 127 plays at 44.1 kHz');
  assert.equal(hi.engine.lastError, null);
});

// ---------------------------------------------------------------------------- safety limit
test('without the continuous permission a held note ends at the safety limit, as HOLD does', () => {
  const r = rig({ settings: { continuous: false, limitS: 2 } });
  const e = r.notes.handle(on(60));
  assert.equal(e.result.limited, true);
  const [v] = voices(r.ctx, r.engine);
  const last = v.env.gain.events.at(-1);
  assert.deepEqual([last.ramp, last.value], ['linear', GAIN_FLOOR]);
  assert.ok(Math.abs(last.t - v.start - 2) < 1e-9, 'the envelope ends at the limit');
  assert.ok(v.stop > last.t && v.stop - last.t < 0.02);
  r.fake.advance(3);
  assert.ok(allGone(r), 'freed at the limit with the key still down');

  const c = rig({ settings: { continuous: true } });
  c.notes.handle(on(60));
  assert.equal(voices(c.ctx, c.engine)[0].stop, Infinity, 'open with the permission');
  c.fake.advance(3);
  assert.equal(c.engine.revokeContinuous(), 1, 'withdrawing the permission releases it');
  c.fake.advance(1);
  assert.ok(allGone(c));
});

// ---------------------------------------------------------------------- the one output
test('a note and the play() voice never sound together, and every stop frees the notes', () => {
  const r = rig();
  const plan = { type: 'const', kind: 'open', freq: 220, wave: 'sine', label: 'x' };
  r.engine.play(plan, { mode: 'hold', continuous: true, limitS: 2, attackS: 0.01,
    releaseS: 0.03 });
  r.fake.advance(0.1);
  const mono = r.ctx.oscillators[0];
  r.notes.handle(on(60));
  const note = r.ctx.oscillators[1];
  assert.ok(mono.stopAt !== null && note.startAt >= mono.stopAt - 1e-12,
    'the note starts once the play() voice has faded');
  r.fake.advance(0.1);
  r.engine.play(plan, { mode: 'hold', continuous: true, limitS: 2, attackS: 0.01,
    releaseS: 0.03 });
  const again = r.ctx.oscillators[2];
  const faded = chain(note)[2].gain.events.at(-1);
  assert.deepEqual([faded.ramp, faded.value], ['linear', GAIN_FLOOR]);
  assert.ok(again.startAt >= faded.t - 1e-12, 'play() fades the notes out first (ADR 0002)');
  r.engine.stopAll();
  r.fake.advance(1);
  assert.ok(allGone(r), 'play() replacing them and stop free everything');

  r.notes.handle(on(60));
  r.notes.handle(on(62));
  r.engine.stopAll();
  r.fake.advance(1);
  assert.ok(allGone(r), 'Escape (stopAll) frees the notes');
  r.notes.handle(on(60));
  assert.equal(r.notes.silence(), 1);
  r.fake.advance(1);
  assert.ok(allGone(r), 'silence() frees the notes');
});

test('while a measurement or the Studio owns the output a note is refused, said once', () => {
  let owner = 'measurement';
  const r = rig({ ownedBy: () => owner });
  assert.deepEqual(r.notes.handle(on(60)).result, { ok: false, reason: 'measurement' });
  r.notes.handle(on(62));
  assert.deepEqual(r.refusals, ['measurement'], 'one notice for the run of refused notes');
  owner = 'studio';
  r.notes.handle(on(64));
  assert.deepEqual(r.refusals, ['measurement', 'studio']);
  assert.equal(r.engine.ctx, null, 'no audio was even started');
  owner = null;
  assert.equal(r.notes.handle(on(60)).result.ok, true);
  owner = 'measurement';
  r.notes.handle(on(62));
  assert.deepEqual(r.refusals, ['measurement', 'studio', 'measurement']);
});

// ------------------------------------------------------------------- support.js -> notes
class Port extends EventTarget {
  constructor(name) {
    super();
    Object.assign(this, { name, state: 'connected', type: 'input', opened: 0, listeners: 0 });
  }
  addEventListener(t, fn) {
    if (t === 'midimessage') this.listeners += 1;
    super.addEventListener(t, fn);
  }
  removeEventListener(t, fn) {
    if (t === 'midimessage') this.listeners -= 1;
    super.removeEventListener(t, fn);
  }
  open() { this.opened += 1; return Promise.resolve(this); }
  send(bytes) {
    const ev = new Event('midimessage');
    ev.data = Uint8Array.from(bytes);
    this.dispatchEvent(ev);
  }
}

class Access extends EventTarget {
  constructor(ports) { super(); this.inputs = new Map(ports.map((p, i) => [`in-${i}`, p])); }
  emit(port) {
    const ev = new Event('statechange');
    ev.port = port;
    this.dispatchEvent(ev);
  }
}

function supportRig() {
  const requests = [];
  const nav = { requestMIDIAccess: () => new Promise((resolve) => requests.push(resolve)) };
  const got = [];
  let silences = 0;
  const s = createMidiSupport({ navigator: nav, isSecureContext: true,
    onMessage: (data, port) => got.push([port.name, [...data]]),
    onSilence: () => { silences++; } });
  return { s, requests, got, silences: () => silences };
}
const settle = () => new Promise((resolve) => { setImmediate(resolve); });

test('support.js listens to every connected input and says when one goes away', async () => {
  const a = new Port('A');
  const b = new Port('B');
  const access = new Access([a, b]);
  const r = supportRig();
  r.s.connect();
  r.requests[0](access);
  await settle();
  assert.equal(r.s.snapshot().state, 'connected');
  assert.deepEqual([a.listeners, b.listeners], [1, 1]);
  assert.deepEqual([a.opened, b.opened], [1, 1], 'each listened port is opened');
  a.send([0x90, 60, 100]);
  b.send([0x80, 62, 0]);
  assert.deepEqual(r.got, [['A', [0x90, 60, 100]], ['B', [0x80, 62, 0]]]);
  a.state = 'disconnected';
  access.emit(a);
  assert.equal(a.listeners, 0, 'a lost input is no longer listened to');
  assert.equal(r.silences(), 1, 'and the notes are told');
  a.send([0x90, 61, 100]);
  assert.equal(r.got.length, 2);
  access.emit(b); // a statechange that loses nothing
  assert.equal(r.silences(), 1);
  assert.equal(b.listeners, 1, 'listened to once, however many statechanges');
  r.s.connect(); // Connect MIDI again: the old access is dropped
  assert.equal(b.listeners, 0);
  assert.equal(r.silences(), 2);
  r.requests[1](new Access([]));
  await settle();
  assert.equal(r.s.snapshot().state, 'no-devices');
  assert.equal(r.silences(), 2, 'nothing was listened to, nothing to stop');
});

test('a withdrawn permission stops listening and stops the notes', async () => {
  class Status extends EventTarget {
    constructor() { super(); this.state = 'granted'; }
  }
  const status = new Status();
  const port = new Port('A');
  const requests = [];
  let silences = 0;
  const nav = { requestMIDIAccess: () => new Promise((resolve) => requests.push(resolve)),
    permissions: { query: () => Promise.resolve(status) } };
  const s = createMidiSupport({ navigator: nav, isSecureContext: true,
    onSilence: () => { silences++; } });
  await s.init();
  s.connect();
  requests[0](new Access([port]));
  await settle();
  assert.equal(port.listeners, 1);
  status.state = 'prompt';
  status.dispatchEvent(new Event('change'));
  assert.equal(s.snapshot().state, 'revoked');
  assert.equal(port.listeners, 0);
  assert.equal(silences, 1);
});

test('the note layer end to end: support.js messages into engine voices, lost input frees them',
  async () => {
    const r = rig();
    const port = new Port('A');
    const access = new Access([port]);
    const requests = [];
    const nav = { requestMIDIAccess: () => new Promise((resolve) => requests.push(resolve)) };
    const s = createMidiSupport({ navigator: nav, isSecureContext: true,
      onMessage: (data) => r.notes.handle(data, 1), onSilence: () => r.notes.silence() });
    s.connect();
    requests[0](access);
    await settle();
    port.send([0x90, 60, 100]);
    port.send([0x90, 64, 100]);
    assert.equal(r.engine.noteCount, 2);
    port.state = 'disconnected';
    access.emit(port);
    r.fake.advance(1);
    assert.ok(allGone(r), 'unplugging with keys down leaves nothing sounding');
  });

// ------------------------------------------------------------------- ui.js, the component
test('the component part: Playground settings per note, a refusal said, every stop path',
  async () => {
  const { createMidiUi, MIDI_REFUSED } = await import('../../../src/js/midi/ui.js');
  const r = rig();
  const port = new Port('A');
  const access = new Access([port]);
  const requests = [];
  const on2 = {};
  const listen = (target) => (type, fn) => { (on2[`${target}:${type}`] ||= []).push(fn); };
  const doc = { hidden: false, addEventListener: listen('doc') };
  const win = { navigator: { requestMIDIAccess: () => new Promise((res) => requests.push(res)) },
    isSecureContext: true, location: { protocol: 'file:', host: '' }, document: doc,
    addEventListener: listen('win') };
  const fire = (key, e = {}) => { for (const fn of on2[key] || []) fn(e); };
  const notices = [];
  let measuring = false;
  let sequencing = false;
  let studio = false;
  const cmp = Object.assign(createMidiUi({ win, engine: r.engine,
    sequencerPlaying: () => sequencing }), {
    a4: 440, waveform: 'triangle', attack: 20, release: 120, safetyLimit: 2,
    continuousAllowed: false, notify: (...a) => notices.push(a),
    measureOwnsOutput: () => measuring, studioOwnsOutput: () => studio,
    meas: { levelForm: { capturing: false } },
  });
  await cmp.midiInit();
  cmp.midiConnect();
  requests[0](access);
  await settle();
  assert.equal(cmp.midiState, 'connected');
  port.send([0x90, 69, 127]);
  const [v] = voices(r.ctx, r.engine);
  assert.equal(v.osc.type, 'triangle', 'the Playground waveform');
  assert.ok(Math.abs(v.env.gain.events[2].t - v.start - 0.02) < 1e-9, 'attack from ms');
  assert.ok(v.stop < Infinity, 'the safety limit applies without the continuous permission');
  r.fake.advance(0.1);
  const held = (fn) => {
    port.send([0x90, 60, 100]);
    assert.ok(r.engine.noteCount >= 1);
    fn();
    r.fake.advance(1);
    assert.ok(allGone(r));
  };
  held(() => { doc.hidden = true; fire('doc:visibilitychange'); doc.hidden = false; });
  held(() => fire('win:pagehide'));
  held(() => fire('win:keydown', { key: 'Escape' }));
  held(() => assert.equal(cmp.midiAllOff(), 1, 'stopPlayback (main.js) silences MIDI'));
  measuring = true;
  port.send([0x90, 60, 100]);
  port.send([0x90, 62, 100]);
  assert.equal(r.engine.noteCount, 0);
  assert.deepEqual(notices, [['info', 'MIDI', MIDI_REFUSED.measurement]], 'said once');

  // Each other owner of the output refuses notes too, each said once (review of #261).
  measuring = false;
  const refusedBy = (set, unset, by) => {
    notices.length = 0;
    set();
    port.send([0x90, 60, 100]);
    port.send([0x90, 62, 100]);
    assert.equal(r.engine.noteCount, 0, `no note while ${by} owns the output`);
    assert.deepEqual(notices, [['info', 'MIDI', MIDI_REFUSED[by]]], `${by}: said once`);
    unset();
  };
  refusedBy(() => { cmp.meas.levelForm.capturing = true; },
    () => { cmp.meas.levelForm.capturing = false; }, 'reference');
  refusedBy(() => { studio = true; }, () => { studio = false; }, 'studio');
  refusedBy(() => { sequencing = true; }, () => { sequencing = false; }, 'sequencer');
  notices.length = 0;
  port.send([0x90, 60, 100]);
  assert.equal(r.engine.noteCount, 1, 'with nobody owning the output a note sounds again');
  assert.deepEqual(notices, []);
  cmp.midiAllOff();
  r.fake.advance(1);
  assert.ok(allGone(r));
});

const AUDIO_API = new RegExp([
  'AudioContext', 'AudioParam',
  String.raw`\.create(?:Oscillator|Gain|\w*Source|\w*Filter|WaveShaper|DynamicsCompressor|`
    + String.raw`\w*Panner|Analyser|PeriodicWave|Channel\w+|Convolver|Delay)\(`,
  String.raw`\.(?:setValueAtTime|linearRampToValueAtTime|exponentialRampToValueAtTime|`
    + String.raw`setTargetAtTime)\(`,
].join('|'));

test('src/js/midi builds no audio node and no context: the AudioEngine is the only renderer',
  async () => {
    const { readFileSync, readdirSync } = await import('node:fs');
    const dir = new URL('../../../src/js/midi/', import.meta.url);
    for (const f of readdirSync(dir).filter((n) => n.endsWith('.js'))) {
      const src = readFileSync(new URL(f, dir), 'utf8').split('\n')
        .filter((l) => !/^\s*(?:\/\/|\/\*|\*)/.test(l)).join('\n');
      assert.doesNotMatch(src, AUDIO_API, `${f}: no Web Audio node, context or automation`);
    }
  });
