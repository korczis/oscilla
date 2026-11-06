// K060: the Keys node, the one note source, on the real AudioEngine, Studio runtime and transport
// over the fake Web Audio of tests/unit/sequencer-fake-audio.mjs (StudioFakeContext, one virtual
// clock). Asserted from the scheduled calls, their times and ramps and the node census:
//   AC1  glide is linear in exact time (owner decision 'Linear glide in exact time',
//        2026-11-03): a legato note with Glide g ramps linearly to the new pitch and arrives at
//        exactly t + g; a glide cut by a third note holds its value computed from the adapter's
//        own record (no cancelAndHoldAtTime, which Firefox lacks), with no jump; a non-legato
//        note and Glide 0 step with setValueAtTime. On e51b169d the glide was setTargetAtTime
//        with a time constant of Glide / 3, which leaves a twentieth of the step at t + g.
//   AC3  the registry declares Key low and Key high with their defaults (Chord waits for K116,
//        which plays it: a declared chord that plays nothing would be an inert control), and the note
//        clamp (0.95 x Nyquist) is stated on the card (summary) and in the runtime debugInfo
//   AC8  a note outside 0-127 is refused with a sentence, never clamped; a note outside the
//        node's key range too; a second note under last-note priority wins, and its release
//        returns to the held note without a new gate
//   AC4  blur, visibilitychange to hidden and Escape, injected as window events into the
//        shipped release paths (src/js/midi/ui.js, src/js/synth/ui.js) with the Synth armed,
//        leave no held note in the router (src/js/studio/live-notes.js) and the Keys gate
//        closed, and the engine and runtime node census is 0 after stop
//
//   node --test tests/unit/synth-keys.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import PANEL from '../../src/js/synth/panels/semi-mono.js';
import { NODE_REGISTRY } from '../../src/js/studio/registry.js';
import { AudioEngine } from '../../src/js/audio/audio-engine.js';
import { createStudioRuntime } from '../../src/js/studio/runtime.js';
import { createStudioTransport } from '../../src/js/studio/transport.js';
import { createMidiUi } from '../../src/js/midi/ui.js';
import { createSynthUi } from '../../src/js/synth/ui.js';
import { createFakeAudioEnv } from './sequencer-fake-audio.mjs';
import { panelStore } from './synth-fixture.mjs';

const SR = 48000; // the fake context's rate; every figure below reads ctx.sampleRate
const CENT = 1 / 1200; // one cent in octaves
const oct = (note) => (note - 69) / 12;

/**
 * The panel on the real transport with the Keys params `params` (set before arming: this store
 * is not wired to the transport's admit gate), armed: { st, fx, engine, runtime, transport,
 * keys, h, param (the Keys pitch offset) }.
 */
function armed(params = {}) {
  const st = panelStore();
  const keys = PANEL.resolve(st.getModel()).get('keys').id;
  for (const [key, value] of Object.entries(params)) {
    const r = st.dispatch({ type: 'NODE_PARAM_SET', nodeId: keys, key, value });
    assert.equal(r.ok, true, `${key}: ${r.reason}`);
  }
  const fx = createFakeAudioEnv({ sampleRate: SR });
  const engine = new AudioEngine({ env: fx.env });
  assert.ok(engine.init(), 'engine.init');
  if (engine.limiterFeed) engine.limiterFeed.infrastructure = true;
  const runtime = createStudioRuntime({ engine });
  const transport = createStudioTransport({ runtime, engine, store: st });
  const r = transport.arm();
  assert.equal(r.ok, true, `arm: ${r.reason}`);
  const h = runtime.nodes.get(keys);
  assert.ok(h && typeof h.play === 'function', 'the Keys handle runs');
  return { st, fx, engine, runtime, transport, keys, h, param: h.outputs.pitch.offset };
}

const on = (rig, note, at, velocity = 100) => rig.transport.live(rig.keys,
  { kind: 'on', note, velocity, at });
const off = (rig, note, at) => rig.transport.live(rig.keys, { kind: 'off', note, at });
const state = (rig) => rig.runtime.debugInfo().notes.find((n) => n.id === rig.keys);

/**
 * The value a FakeParam's schedule gives at t (Web Audio semantics for set and linear events,
 * in time order, insertion order within a time). A setTargetAtTime event is not linear in
 * exact time: it throws, so the assertion names it.
 */
function valueAt(param, t) {
  const evs = param.events.map((e, i) => ({ ...e, i })).sort((a, b) => a.t - b.t || a.i - b.i);
  let prev = { t: 0, value: param.defaultValue };
  for (const e of evs) {
    if (e.ramp === 'target' || e.ramp === 'exponential') {
      throw new Error(`a ${e.ramp} event at ${e.t}: the glide is not linear in exact time`);
    }
    if (e.t <= t) { prev = e; continue; }
    if (e.ramp === 'linear') return prev.value + ((e.value - prev.value) * (t - prev.t))
      / (e.t - prev.t);
    return prev.value;
  }
  return prev.value;
}
const callsFrom = (param, n) => param.calls.slice(n).map((c) => c.map((x) => (typeof x
  === 'number' ? Number(x.toFixed(9)) : x)));
const near = (a, b, tol, what) => assert.ok(Math.abs(a - b) <= tol,
  `${what}: ${a} vs ${b} (tolerance ${tol})`);

// ---------------------------------------------------------------- AC1: linear glide

test('AC1: a legato glide is a linear ramp that arrives at the new pitch at exactly t + glide',
  () => {
    const rig = armed({ glide: 0.1 });
    const t0 = rig.fx.ctx.currentTime + 0.05;
    assert.equal(on(rig, 57, t0).ok, true, 'A3 on');
    const n = rig.param.calls.length;
    const t = t0 + 0.5;
    assert.equal(on(rig, 69, t).ok, true, 'A4 on, legato over the held A3');
    assert.deepEqual(callsFrom(rig.param, n), [
      ['cancelScheduledValues', Number(t.toFixed(9))],
      ['setValueAtTime', -1, Number(t.toFixed(9))],
      ['linearRampToValueAtTime', 0, Number((t + 0.1).toFixed(9))],
    ], 'cancel, hold the start, ramp linearly to A4 at t + 0.1 s');
    near(valueAt(rig.param, t + 0.1), oct(69), CENT, 'A4 within one cent at t + glide');
    near(valueAt(rig.param, t + 0.05), (oct(57) + oct(69)) / 2, 1e-9, 'halfway at half the glide');
    near(valueAt(rig.param, t), oct(57), 1e-9, 'A3 until t');
    assert.equal(rig.param.calls.filter((c) => c[0] === 'setTargetAtTime').length, 0,
      'no exponential approach');
    const s = state(rig);
    assert.deepEqual([s.note, s.target, Number(s.arrives.toFixed(9))],
      [69, 0, Number((t + 0.1).toFixed(9))], 'debugInfo: the target and when it arrives');
  });

test('AC1: a glide cut by a third note holds its computed value at the cut, without a jump',
  () => {
    const rig = armed({ glide: 0.2 });
    const t0 = rig.fx.ctx.currentTime + 0.05;
    on(rig, 57, t0);
    on(rig, 81, t0 + 0.5); // A5: a glide of two octaves over 0.2 s
    const cut = t0 + 0.55; // a quarter of the way: one half octave above A3
    const n = rig.param.calls.length;
    on(rig, 69, cut);
    const v = oct(57) + (oct(81) - oct(57)) * 0.25;
    const c = callsFrom(rig.param, n);
    assert.deepEqual(c.map((x) => x[0]), ['cancelScheduledValues', 'linearRampToValueAtTime',
      'setValueAtTime', 'linearRampToValueAtTime'], 'the cut ramp kept to the cut, then a new one');
    near(c[1][1], v, 1e-9, 'the cut ramp ends at its own value at the cut');
    near(c[2][1], v, 1e-9, 'the new ramp starts there');
    near(c[3][2], cut + 0.2, 1e-9, 'and arrives at the cut + the glide');
    near(valueAt(rig.param, cut - 1e-6), v, 1e-4, 'just before the cut');
    near(valueAt(rig.param, cut + 1e-6), v, 1e-4, 'just after the cut: no jump');
    near(valueAt(rig.param, cut + 0.2), oct(69), CENT, 'A4 at the cut + the glide');
  });

test('AC1: glide 0, and a note after every key is up, step with setValueAtTime', () => {
  const rig = armed();
  const t0 = rig.fx.ctx.currentTime + 0.05;
  let n = rig.param.calls.length;
  on(rig, 60, t0);
  on(rig, 64, t0 + 0.1); // legato, but glide 0
  assert.deepEqual(callsFrom(rig.param, n).filter((x) => x[0] !== 'cancelScheduledValues')
    .map((x) => x.slice(0, 2)), [['setValueAtTime', oct(60)], ['setValueAtTime', oct(64)]]
    .map(([m, v]) => [m, Number(v.toFixed(9))]));
  const gl = armed({ glide: 0.5 });
  const t1 = gl.fx.ctx.currentTime + 0.05;
  on(gl, 60, t1);
  off(gl, 60, t1 + 0.1);
  n = gl.param.calls.length;
  on(gl, 72, t1 + 0.2); // Glide 0.5 s, but nothing held: no glide
  assert.deepEqual(callsFrom(gl.param, n).map((x) => x[0]), ['cancelScheduledValues',
    'setValueAtTime'], 'a step at the note, no ramp');
  near(valueAt(gl.param, t1 + 0.2), oct(72), 1e-9, 'C5 at once');
});

// ---------------------------------------------------------------- AC3: declared, stated

test('AC3: Keys declares Key low and Key high with their defaults; the clamp is stated',
  () => {
    const def = NODE_REGISTRY.get('keys');
    const p = (k) => def.params.find((x) => x.key === k);
    assert.deepEqual([p('keyLow').default, p('keyLow').min, p('keyLow').max], [0, 0, 127]);
    assert.deepEqual([p('keyHigh').default, p('keyHigh').min, p('keyHigh').max], [127, 0, 127]);
    assert.equal(p('chord'), undefined, 'no Chord until K116 plays it (project.no-inert-surfaces)');
    const defaults = Object.fromEntries(def.params.map((x) => [x.key, x.default]));
    assert.match(def.summary(defaults), /clamp 0\.95 × Nyquist/, 'the card states the clamp');
    assert.match(def.help.constraints, /clamped at 0\.95 × Nyquist/, 'and the help');
    const rig = armed();
    const s = state(rig);
    assert.equal(s.clampHz, (0.95 * rig.fx.ctx.sampleRate) / 2, 'at the running context rate');
    assert.match(s.clamp, /clamped at 0\.95 × Nyquist \(22800 Hz here\)/, 'debugInfo states it');
  });

// ---------------------------------------------------------------- AC8: negative cases

test('AC8: a note outside 0-127 is refused with a sentence and nothing is scheduled', () => {
  const rig = armed();
  const t0 = rig.fx.ctx.currentTime + 0.05;
  const n = rig.param.calls.length;
  for (const note of [128, -1, 60.5, 300]) {
    const r = on(rig, note, t0);
    assert.equal(r.ok, false, `note ${note}`);
    assert.equal(r.code, 'note-range');
    assert.equal(r.reason, `Note ${note} is outside the note range 0 to 127; it is not played.`);
  }
  assert.equal(off(rig, 200, t0).code, 'note-range', 'a note-off outside the range too');
  assert.equal(rig.param.calls.length, n, 'no pitch scheduled: not clamped to 127 or 0');
  assert.deepEqual(rig.transport.heldNotes(), []);
  assert.equal(state(rig).gate, false, 'no gate opened');
  assert.equal(on(rig, 127, t0).ok, true, 'note 127 plays');
  assert.equal(on(rig, 0, t0 + 0.1).ok, true, 'note 0 plays');
});

test('AC8: a note outside the node\'s key range is refused with the range in the sentence', () => {
  const rig = armed({ keyLow: 48, keyHigh: 72 });
  const t0 = rig.fx.ctx.currentTime + 0.05;
  const r = on(rig, 40, t0);
  assert.deepEqual([r.ok, r.code, r.reason], [false, 'key-range',
    "Note 40 is outside this Keys node's key range 48 to 72; it is not played."]);
  assert.equal(on(rig, 48, t0).ok, true, 'the range is inclusive');
  assert.deepEqual(rig.transport.heldNotes(), [48]);
});

test('AC8: under last-note priority a second note wins and its release returns to the held one',
  () => {
    const rig = armed();
    const t0 = rig.fx.ctx.currentTime + 0.05;
    on(rig, 60, t0);
    const opened = state(rig).gateAt;
    assert.equal(state(rig).gate, true, 'the first note opens the gate');
    const r = on(rig, 64, t0 + 0.1);
    assert.deepEqual([r.ok, r.top, r.retrigger], [true, 64, true], 'the second note wins');
    near(valueAt(rig.param, t0 + 0.1), oct(64), 1e-9, 'E4 sounds');
    const retrig = state(rig).gateAt;
    assert.ok(retrig > opened, 'a new top note retriggers');
    const back = off(rig, 64, t0 + 0.2);
    assert.deepEqual([back.top, back.retrigger, back.held], [60, false, 1], 'back to C4');
    near(valueAt(rig.param, t0 + 0.2), oct(60), 1e-9, 'the held C4 sounds again');
    assert.deepEqual([state(rig).gate, state(rig).gateAt], [true, retrig],
      'without a new gate (legato return)');
    off(rig, 60, t0 + 0.3);
    assert.deepEqual([state(rig).gate, rig.transport.heldNotes()], [false, []],
      'the last key closes the gate');
  });

test('the node census is 0 after the armed run stops', async () => {
  const rig = armed();
  on(rig, 60, rig.fx.ctx.currentTime + 0.05);
  assert.ok(rig.engine.activeNodeCount > 0, 'the armed voice runs');
  const p = rig.transport.disarm();
  rig.fx.advance(1);
  await p;
  assert.equal(rig.engine.activeNodeCount, 0, 'engine nodes');
  assert.equal(rig.engine.activeSourceCount, 0, 'engine sources');
  assert.equal(rig.runtime.debugInfo().runtimeNodeCount, 0, 'runtime nodes');
});

// ---------------------------------------------------------------- AC4: blur, hide, Escape

class Port extends EventTarget {
  constructor() {
    super();
    Object.assign(this, { name: 'A', state: 'connected', type: 'input' });
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

/**
 * The one component as main.js composes it: the MIDI part (src/js/midi/ui.js, its keyboard
 * included) and the Synth part (src/js/synth/ui.js) on one fake window, workspace synth, a
 * connected MIDI input. `fire(key)` dispatches a window or document event to every listener.
 */
async function pageRig() {
  const listeners = {};
  const listen = (target) => (type, fn) => { (listeners[`${target}:${type}`] ||= []).push(fn); };
  const doc = { hidden: false, activeElement: null, addEventListener: listen('doc'),
    querySelector: () => null, getElementById: () => null };
  const requests = [];
  const win = { navigator: { requestMIDIAccess: () => new Promise((res) => requests.push(res)) },
    isSecureContext: true, location: { protocol: 'file:', host: '', href: 'file:///x' },
    document: doc, addEventListener: listen('win') };
  globalThis.window = win; // the Synth part listens on the page's window
  globalThis.document = doc;
  globalThis.requestAnimationFrame = () => 0;
  const fire = (key, e = {}) => { for (const fn of listeners[key] || []) fn(e); };
  const st = panelStore();
  const fx = createFakeAudioEnv({ sampleRate: SR });
  const engine = new AudioEngine({ env: fx.env });
  assert.ok(engine.init(), 'engine.init');
  if (engine.limiterFeed) engine.limiterFeed.infrastructure = true;
  const runtime = createStudioRuntime({ engine });
  const transport = createStudioTransport({ runtime, engine, store: st });
  const handle = Object.create(st, { subscribe: { value: () => () => {} } });
  const synth = createSynthUi({ get: () => ({ handle, transport }) });
  const cmp = createMidiUi({ win, engine });
  Object.defineProperties(cmp, Object.getOwnPropertyDescriptors(synth));
  Object.assign(cmp, { workspace: 'synth', a4: 440, waveform: 'sine', attack: 10,
    release: 50, safetyLimit: 2, continuousAllowed: false, notify: () => {}, ensureAudio() {},
    measureOwnsOutput: () => false, studioOwnsOutput: () => false,
    meas: { levelForm: { capturing: false } }, $watch() {}, $nextTick() {} });
  cmp.synthInit();
  await cmp.midiInit();
  cmp.midiConnect();
  const port = new Port();
  requests[0](new Access([port]));
  await settle();
  const keys = PANEL.resolve(st.getModel()).get('keys').id;
  return { cmp, port, fire, doc, fx, engine, runtime, transport, keys };
}

test('AC4: blur, hide and Escape release every held note through the shipped release paths',
  async () => {
    const rig = await pageRig();
    const releases = {
      blur: () => rig.fire('win:blur'),
      hidden: () => {
        rig.doc.hidden = true;
        rig.fire('doc:visibilitychange');
        rig.doc.hidden = false;
      },
      escape: () => rig.fire('win:keydown', { key: 'Escape', code: 'Escape', target: null,
        preventDefault() {}, stopImmediatePropagation() {} }),
    };
    for (const [name, release] of Object.entries(releases)) {
      rig.port.send([0x90, 60, 100]); // MIDI Note On: the Synth sink arms and plays Keys
      rig.port.send([0x90, 64, 90]);
      assert.equal(rig.transport.armed, true, `${name}: the Synth is armed`);
      assert.deepEqual(rig.transport.heldNotes(), [60, 64], `${name}: two keys held`);
      const s = rig.runtime.debugInfo().notes.find((n) => n.id === rig.keys);
      assert.deepEqual([s.note, s.gate], [64, true], `${name}: E4 sounds, the gate open`);
      release();
      assert.deepEqual(rig.transport.heldNotes(), [], `${name}: no held note in live-notes.js`);
      const after = rig.runtime.debugInfo().notes.find((n) => n.id === rig.keys);
      assert.equal(after ? after.gate : false, false, `${name}: the Keys gate closed`);
      const p = rig.cmp.synthDisarm();
      rig.fx.advance(1);
      await p;
      assert.equal(rig.transport.playing, false, `${name}: stopped`);
      assert.equal(rig.engine.activeNodeCount, 0, `${name}: engine node census 0 after stop`);
      assert.equal(rig.runtime.debugInfo().runtimeNodeCount, 0, `${name}: runtime census 0`);
      rig.port.send([0x80, 60, 0]); // the late Note Offs change nothing
      rig.port.send([0x80, 64, 0]);
    }
  });
