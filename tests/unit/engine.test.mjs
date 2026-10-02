// AudioEngine V2 additions: snapshot() and the extension points (inserts, periodicWave, ADSR
// envelope hook, output stage, dual router), plus the microphone path, and how the extension
// points combine with the index.html@a7b7a23 engine round (recorded automation, restarts,
// waveform dips, continuous top-ups, closed-context rebuild). Runs on the recording mock
// AudioContext of the V1 freeze harness (freeze/extract.cjs makeMockAudio).
//   node --test 'tests/unit/*.test.mjs'

import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

import { AudioEngine } from '../../src/js/audio/audio-engine.js';
import {
  freezeParam, makeAdsrEnvelope, recordEvent, trackParam, v1OpenEnvelope, valueAt,
} from '../../src/js/audio/voice.js';
import { buildPlan } from '../../src/js/audio/patterns.js';
import { defaultInstrumentState } from '../../src/js/core/config.js';
import { MIC_UNAVAILABLE_TEXT } from '../../src/js/audio/microphone.js';
import * as envelopeJs from '../../src/js/audio/envelope.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const FREEZE_DIR = path.resolve(
  process.env.OSCILLA_FREEZE_DIR || path.join(here, '../freeze'));
const hasMock = fs.existsSync(path.join(FREEZE_DIR, 'extract.cjs'));
const skip = hasMock ? false : `mock AudioContext not found in ${FREEZE_DIR}`;
const require = createRequire(import.meta.url);
const { makeMockAudio } = hasMock ? require(path.join(FREEZE_DIR, 'extract.cjs')) : {};

const SR = 48000;
const ENV_S = { safeMax: (SR / 2) * 0.95, continuous: true };

function plan(cfg) {
  const st = defaultInstrumentState();
  const r = buildPlan({ ...st, ...cfg, pp: { ...st.pp, ...(cfg.pp || {}) } }, ENV_S);
  if (!r.ok) throw new Error(r.error);
  return r.plan;
}

const opt = (o = {}) => ({
  mode: 'hold', continuous: true, limitS: 2, durationS: 0.5, attackS: 0.01, releaseS: 0.03, ...o,
});

/** Engine on a fresh mock; timers are recorded and only run through flush(). */
function setup(mockOpts = {}, envExtra = {}) {
  const audio = makeMockAudio(mockOpts);
  const timers = new Map();
  let seq = 0;
  const env = {
    AudioContext: audio.AudioContext,
    setTimeout: (fn, ms) => { timers.set(++seq, { fn, ms }); return seq; },
    clearTimeout: (id) => { timers.delete(id); },
    ...envExtra,
  };
  const eng = new AudioEngine({ env });
  const flush = () => {
    for (const [id, t] of [...timers]) { timers.delete(id); t.fn(); }
  };
  return { eng, env, audio, timers, flush, advance: (t) => eng.ctx.advance(t) };
}

/** A mock stream whose tracks keep their identity (like real MediaStreamTracks). */
function mockStream() {
  const tracks = [{ readyState: 'live', onended: null }];
  for (const t of tracks) t.stop = () => { t.readyState = 'ended'; };
  return { tracks, getTracks: () => tracks };
}

function withMediaStreamSource(audio, impl) {
  audio.AudioContext.prototype.createMediaStreamSource = impl || function () {
    const n = this.createGain();
    n.kind = 'mediaStreamSource';
    return n;
  };
}

/** Mock oscillators that accept a PeriodicWave (type becomes 'custom'). */
function withPeriodicWave(audio) {
  const proto = audio.AudioContext.prototype;
  const create = proto.createOscillator;
  proto.createOscillator = function () {
    const o = create.call(this);
    o.setPeriodicWave = (w) => { o.type = 'custom'; o.wave = w; };
    return o;
  };
}

/** A pass-through insert stage built through track(), recording its calls. */
function fakeInsert(log) {
  return (ctx, track) => {
    const input = track(ctx.createGain());
    const output = track(ctx.createGain());
    input.connect(output);
    log.push('create');
    return {
      input, output,
      update(cfg) { log.push(['update', cfg]); },
      dispose() { log.push('dispose'); input.disconnect(); output.disconnect(); },
    };
  };
}

test('snapshot() before audio starts is frozen and empty', { skip }, () => {
  const { eng } = setup();
  const s = eng.snapshot();
  assert.ok(Object.isFrozen(s));
  assert.strictEqual(s.hasCtx, false);
  assert.strictEqual(s.voice, false);
  assert.strictEqual(s.analyser, null);
  assert.strictEqual(s.sampleRate, 0);
});

test('snapshot(out) reports the voice and fills the given object', { skip }, () => {
  const { eng, advance } = setup();
  const p = plan({ pattern: 'tone', frequency: 440 });
  eng.play(p, opt());
  advance(0.25);
  const out = {};
  const s = eng.snapshot(out);
  assert.strictEqual(s, out);
  assert.strictEqual(s.hasCtx, true);
  assert.strictEqual(s.sampleRate, SR);
  assert.strictEqual(s.voice, true);
  assert.strictEqual(s.plan, p);
  assert.strictEqual(s.t0, eng.voice.t0);
  assert.strictEqual(s.time, 0.25);
  assert.strictEqual(s.analyser, eng.analyser);
  assert.strictEqual(s.timeData, eng.timeData);
  assert.strictEqual(s.activeNodes, eng.activeNodeCount);
  eng.stopAll();
  assert.strictEqual(eng.snapshot(out).releasing, true);
  advance(1);
  assert.strictEqual(eng.snapshot(out).voice, false);
  assert.strictEqual(out.activeNodes, 0);
});

test('no options and empty options build the same graph and schedule as V1', { skip }, () => {
  const run = (extra) => {
    const { eng, advance } = setup();
    eng.play(plan({ pattern: 'am' }), opt(extra));
    advance(0.2);
    eng.stopAll();
    advance(2);
    return JSON.stringify(eng.ctx.trace());
  };
  const base = run({});
  assert.strictEqual(run({ inserts: [], adsr: null, envelope: v1OpenEnvelope }), base);
});

test('inserts: env -> stages -> rel, tracked, updated live and disposed', { skip }, () => {
  const { eng, advance } = setup();
  const log = [];
  eng.play(plan({ pattern: 'tone', frequency: 1000 }), opt({ inserts: [fakeInsert(log)] }));
  const v = eng.voice;
  const [env, rel] = v.nodes;
  const stage = v.inserts[0];
  assert.strictEqual(v.rel.param, rel.gain);
  assert.deepStrictEqual(env.out, [`node:${stage.input.id}`]);
  assert.ok(stage.output.out.includes(`node:${rel.id}`));
  assert.ok(v.nodes.includes(stage.input) && v.nodes.includes(stage.output));
  assert.strictEqual(eng.updateInserts([{ frequency: 500 }]), true);
  eng.stopAll();
  advance(1);
  assert.deepStrictEqual(log, ['create', ['update', { frequency: 500 }], 'dispose']);
  assert.strictEqual(eng.activeNodeCount, 0);
});

test('periodicWave: carrier only, kept by updateLive (no wave dip), swappable', { skip }, () => {
  const { eng, audio } = setup();
  withPeriodicWave(audio);
  const waveA = { id: 'A' };
  eng.play(plan({ pattern: 'fm', frequency: 1000 }), opt({ periodicWave: waveA }));
  const v = eng.voice;
  assert.strictEqual(v.carrier.wave, waveA);
  assert.strictEqual(v.live.mod.wave, undefined, 'the modulator keeps its sine');
  assert.strictEqual(eng.updateLive(plan({ pattern: 'fm', frequency: 1200 })), 'live');
  assert.strictEqual(eng.updateLive(plan({ pattern: 'fm', frequency: 1200, waveform: 'square' })),
    'live');
  assert.strictEqual(v.dipping, false, 'waveform changes do not switch a PeriodicWave carrier');
  assert.strictEqual(v.carrier.type, 'custom');
  assert.strictEqual(eng.setPeriodicWave({ id: 'B' }), true);
  assert.strictEqual(v.carrier.wave.id, 'B');
});

test('clearPeriodicWave: back to plan.wave through the click-free dip', { skip }, () => {
  const { eng, audio, advance, flush } = setup();
  withPeriodicWave(audio);
  const tri = plan({ pattern: 'tone', frequency: 440, waveform: 'triangle' });
  eng.play(tri, opt({ periodicWave: {} }));
  const v = eng.voice;
  advance(0.1);
  assert.strictEqual(eng.clearPeriodicWave(), true);
  assert.strictEqual(v.periodicWave, null);
  assert.strictEqual(v.dipping, true);
  assert.strictEqual(v.carrier.type, 'custom', 'switched only after the dip');
  const rel = v.rel.ev.map((e) => [e.kind, e.value]);
  assert.deepStrictEqual(rel.slice(-1), [['linearRampToValueAtTime', 1e-4]]);
  advance(0.2);
  flush();
  assert.strictEqual(v.carrier.type, 'triangle');
  assert.strictEqual(v.dipping, false);
  assert.deepStrictEqual(v.rel.ev.slice(-1).map((e) => [e.kind, e.value]),
    [['linearRampToValueAtTime', 1]]);
  assert.strictEqual(eng.clearPeriodicWave(), false, 'nothing left to clear');
});

test('envelope hook: gets the logged param, len and adsr; release uses adsr.r', { skip }, () => {
  const { eng } = setup();
  const calls = [];
  const envelope = (eg, t0, len, a, r, adsr) => {
    calls.push({ t0, len, a, r, adsr });
    eg.setValueAtTime(1e-4, t0);
    eg.linearRampToValueAtTime(1, t0 + a);
    return Infinity;
  };
  const adsr = { a: 0.05, d: 0.1, s: 0.5, r: 0.4 };
  eng.play(plan({ pattern: 'tone' }), opt({ adsr, envelope }));
  assert.deepStrictEqual(calls, [{ t0: 0.02, len: Infinity, a: 0.05, r: 0.4, adsr }]);
  assert.strictEqual(eng.voice.release, 0.4);
  assert.ok(eng.voice.env.ev.some((e) => e.kind === 'linearRampToValueAtTime' && e.value === 1));
});

test('makeAdsrEnvelope + envelope.js: ADSR on the tracked param, frozen on release', { skip }, () => {
  const { eng, advance } = setup({ cancelAndHold: false });
  eng.setEnvelope(makeAdsrEnvelope(envelopeJs));
  const adsr = { a: 0.1, d: 0.2, s: 0.5, r: 0.3 };
  eng.play(plan({ pattern: 'tone' }), opt({ adsr }));
  const v = eng.voice;
  const kinds = v.env.ev.map((e) => e.kind);
  assert.ok(kinds.includes('linearRampToValueAtTime'), 'attack');
  assert.ok(kinds.includes('exponentialRampToValueAtTime'), 'decay');
  const times = v.env.ev.map((e) => e.time);
  assert.deepStrictEqual(times, [...times].sort((x, y) => x - y), 'recorded in time order');
  advance(0.07); // inside the attack: t0 0.02 … 0.12
  const g = v.nodes[0].gain.events;
  eng.release();
  // released SCHEDULE_LEAD_S ahead, on a render-quantum boundary: ceil((0.07 + 0.02) / q) · q
  const q = 128 / SR;
  const t = Math.ceil(0.09 / q) * q;
  const held = g.find((e) => e[0] === 'linear' && Math.abs(e[2] - t) < 1e-9);
  assert.ok(held, 'the in-progress attack is re-ended at the release time on its own curve');
  const expected = 1e-4 + (1 - 1e-4) * ((t - 0.02) / 0.1);
  assert.ok(Math.abs(held[1] - expected) < 1e-6, `held ${held} expected ${expected}`);
  assert.ok(g.some((e) => e[0] === 'cancel' && Math.abs(e[2] - 0.12) < 1e-9),
    'later events cancelled');
  advance(1);
  assert.strictEqual(eng.activeNodeCount, 0);
  eng.setEnvelope(null);
  eng.play(plan({ pattern: 'tone' }), opt({ mode: 'trigger', continuous: false, durationS: 1 }));
  const t0 = eng.voice.t0;
  assert.strictEqual(eng.voice.endTime, t0 + 1 + 0.01, 'V1 envelope restored');
  assert.strictEqual(eng.voice.deadline, t0 + 1, 'a finite open envelope sets the deadline');
  assert.deepStrictEqual(eng.voice.env.ev.slice(-2).map((e) => e.kind),
    ['setValueAtTime', 'exponentialRampToValueAtTime']);
});

test('recorded automation: out-of-order events are inserted sorted; freeze holds the value', () => {
  const calls = [];
  const param = {};
  for (const k of ['setValueAtTime', 'linearRampToValueAtTime', 'exponentialRampToValueAtTime',
    'cancelScheduledValues']) param[k] = (v, t) => calls.push([k, v, t]);
  const pt = trackParam(param, 1);
  recordEvent(pt, 'setValueAtTime', 1e-4, 0.5);
  recordEvent(pt, 'linearRampToValueAtTime', 1, 1.5);
  recordEvent(pt, 'setValueAtTime', 1e-4, 0); // envelope.js pins the floor at time 0
  assert.deepStrictEqual(pt.ev.map((e) => e.time), [0, 0.5, 1.5]);
  assert.strictEqual(valueAt(pt, -1), 1, 'initial before the first event');
  assert.ok(Math.abs(valueAt(pt, 1) - (1e-4 + (1 - 1e-4) * 0.5)) < 1e-12);
  const v = freezeParam(pt, 1);
  assert.ok(Math.abs(v - 0.50005) < 1e-9);
  assert.deepStrictEqual(calls.slice(-2), [['linearRampToValueAtTime', v, 1],
    ['cancelScheduledValues', 1.5, undefined]]);
  assert.deepStrictEqual(pt.ev.map((e) => [e.kind, e.time]),
    [['setValueAtTime', 0], ['setValueAtTime', 0.5], ['linearRampToValueAtTime', 1]]);
});

test('ADSR with a finite length releases inside the length (safety limit)', { skip }, () => {
  const { eng } = setup();
  eng.setEnvelope(makeAdsrEnvelope(envelopeJs));
  const info = eng.play(plan({ pattern: 'tone' }), opt({
    continuous: false, limitS: 0.5, adsr: { a: 0.05, d: 0.05, s: 0.7, r: 2 },
  }));
  assert.strictEqual(info.limited, true);
  assert.ok(Math.abs(info.end - (0.02 + 0.5 + 0.01)) < 1e-9, `end ${info.end}`);
});

test('output hook sits between the rel gain and the master', { skip }, () => {
  const { eng, advance } = setup();
  const log = [];
  eng.play(plan({ pattern: 'tone' }), opt({ output: fakeInsert(log) }));
  const v = eng.voice;
  const rel = v.nodes[1];
  const stage = v.inserts[0];
  assert.strictEqual(v.rel.param, rel.gain);
  assert.deepStrictEqual(rel.out, [`node:${stage.input.id}`]);
  assert.ok(stage.output.out.includes(`node:${eng.master.id}`));
  eng.stopAll();
  advance(1);
  assert.ok(log.includes('dispose'));
  assert.strictEqual(eng.activeNodeCount, 0);
});

test('dualRouter replaces the panners, follows updateLive; stereo glides', { skip }, () => {
  const { eng, advance } = setup({ stereoPanner: false });
  const updates = [];
  const router = (ctx, track, p) => {
    const inputA = track(ctx.createGain());
    const inputB = track(ctx.createGain());
    const output = track(ctx.createGain());
    inputA.connect(output);
    inputB.connect(output);
    const update = (np) => updates.push(np.stereo);
    return { inputA, inputB, output, update, dispose() {}, plan: p };
  };
  const p = plan({ source: 'dual' });
  eng.play(p, opt({ dualRouter: router }));
  const v = eng.voice;
  assert.strictEqual(v.live.A.panner, null);
  assert.ok(!eng.ctx._nodes.some((n) => n.kind === 'panner'));
  assert.ok(v.live.A.g.out.includes(`node:${v.live.router.inputA.id}`));
  assert.ok(v.live.router.output.out.includes(`node:${v.nodes[0].id}`));
  const stereo = plan({ source: 'dual', dual: {
    a: { freq: 440, wave: 'sine', gain: 100, detune: 0 },
    b: { freq: 446, wave: 'sine', gain: 100, detune: 0 }, levelA: 80, levelB: 80, stereo: true,
  } });
  // Without StereoPanner V1 restarts on a stereo change; the router re-routes it live.
  assert.strictEqual(eng.updateLive(stereo), 'live');
  assert.strictEqual(eng.voice, v);
  assert.deepStrictEqual(updates, [true]);
  eng.stopAll();
  advance(1);
  assert.strictEqual(eng.activeNodeCount, 0);
});

test('microphone: analyser only, not to the destination; stop ends tracks', { skip }, async () => {
  const stream = mockStream();
  const getUserMedia = async (c) => { navigator.asked = c; return stream; };
  const navigator = { mediaDevices: { getUserMedia } };
  const { eng, audio } = setup({}, { navigator });
  withMediaStreamSource(audio);
  const events = [];
  eng.on((type, d) => events.push([type, d]));
  assert.strictEqual(await eng.startMic(), true);
  assert.deepStrictEqual(navigator.asked.audio,
    { echoCancellation: false, noiseSuppression: false, autoGainControl: false });
  const s = eng.snapshot();
  assert.strictEqual(s.mic, true);
  assert.strictEqual(s.micAnalyser.fftSize, 8192);
  const src = eng.ctx._nodes.find((n) => n.kind === 'mediaStreamSource');
  assert.deepStrictEqual(src.out, [`node:${s.micAnalyser.id}`]);
  assert.deepStrictEqual(s.micAnalyser.out, []);
  eng.stopMic();
  assert.deepStrictEqual(stream.tracks.map((t) => [t.readyState, t.onended]), [['ended', null]]);
  assert.strictEqual(eng.snapshot().mic, false);
  assert.deepStrictEqual(events.filter((e) => e[0] === 'mic'),
    [['mic', { active: false, reason: 'user' }]]);
});

test('microphone: a track that ends by itself stops the mic and emits mic/ended', { skip },
  async () => {
    const stream = mockStream();
    const navigator = { mediaDevices: { getUserMedia: async () => stream } };
    const { eng, audio } = setup({}, { navigator });
    withMediaStreamSource(audio);
    const events = [];
    eng.on((type, d) => events.push([type, d]));
    await eng.startMic();
    stream.tracks[0].onended();
    assert.strictEqual(eng.mic, null);
    assert.deepStrictEqual(events.filter((e) => e[0] === 'mic'),
      [['mic', { active: false, reason: 'ended' }]]);
  });

test('microphone: a graph failure after permission stops every track and rethrows', { skip },
  async () => {
    const stream = mockStream();
    const navigator = { mediaDevices: { getUserMedia: async () => stream } };
    const { eng, audio } = setup({}, { navigator });
    withMediaStreamSource(audio, () => { throw new Error('test failure'); });
    await assert.rejects(() => eng.startMic(), { message: 'test failure' });
    assert.strictEqual(eng.mic, null);
    assert.deepStrictEqual(stream.tracks.map((t) => t.readyState), ['ended']);
  });

test('closed context: discarded (voices, mic) and rebuilt by the next play', { skip }, async () => {
  const stream = mockStream();
  const navigator = { mediaDevices: { getUserMedia: async () => stream } };
  const { eng, audio, advance } = setup({}, { navigator });
  withMediaStreamSource(audio);
  const events = [];
  eng.on((type, d) => events.push([type, d && d.reason ? d.reason : d]));
  await eng.startMic();
  eng.play(plan({ pattern: 'tone' }), opt());
  advance(0.1);
  const old = eng.ctx;
  old.externalState('closed');
  assert.strictEqual(eng.ctx, null);
  assert.strictEqual(eng.voices.size, 0);
  assert.strictEqual(eng.activeNodeCount, 0);
  assert.strictEqual(eng.mic, null);
  assert.deepStrictEqual(events.slice(-4).map((e) => e[0]), ['context', 'ended', 'mic', 'context']);
  assert.deepStrictEqual(events.find((e) => e[0] === 'mic'), ['mic', 'closed']);
  assert.ok(eng.play(plan({ pattern: 'tone' }), opt()));
  assert.notStrictEqual(eng.ctx, old);
  assert.strictEqual(audio.contexts.length, 2);
});

test('restart (live pattern change) goes through the instance play with the voice options',
  { skip }, () => {
    const { eng, advance } = setup();
    const base = eng.play.bind(eng);
    const seen = [];
    const log = [];
    eng.play = (p, o) => {
      seen.push([p.type, o.until, o.limited]);
      return base(p, { ...o, inserts: [fakeInsert(log)] });
    };
    eng.play(plan({ pattern: 'tone' }), opt({ continuous: false, limitS: 2 }));
    const deadline = eng.voice.deadline;
    advance(0.5);
    assert.strictEqual(eng.updateLive(plan({ pattern: 'am' })), 'restarted');
    assert.deepStrictEqual(seen, [['const', undefined, undefined], ['am', deadline, true]]);
    assert.strictEqual(eng.voice.plan.type, 'am');
    assert.strictEqual(eng.voice.deadline, deadline, 'the new voice keeps the old deadline');
    assert.strictEqual(eng.voice.inserts.length, 1, 'the V2 options are re-applied');
    eng.stopAll();
    advance(3);
    assert.deepStrictEqual(log, ['create', 'create', 'dispose', 'dispose']);
    assert.strictEqual(eng.activeNodeCount, 0);
  });

test('continuous sweep: top-ups use the voice step envelope (options.stepEnvelope)', { skip },
  () => {
    const { eng, advance, flush } = setup();
    const steps = [];
    const stepEnvelope = (eg, t, dur, a, r, adsr) => {
      steps.push(t);
      eg.setValueAtTime(1e-4, t);
      eg.linearRampToValueAtTime(1, t + Math.min(a, dur / 2));
      eg.exponentialRampToValueAtTime(1e-4, t + dur);
      assert.strictEqual(adsr, null);
    };
    const p = buildPlan({
      ...defaultInstrumentState(), source: 'sweep',
      sweep: {
        start: 200, end: 2000, durationMs: 500, curve: 'log', direction: 'up', repeat: 'continuous',
      },
    }, ENV_S).plan;
    assert.strictEqual(p.kind, 'continuous');
    eng.play(p, opt({ mode: 'trigger', stepEnvelope }));
    const v = eng.voice;
    const first = steps.length;
    assert.ok(first > 15 && first < 22, `${first} cycles scheduled ≈ 10 s ahead`);
    advance(5);
    flush();
    assert.ok(steps.length > first, 'topped up');
    assert.ok(Math.max(...steps) > 14, 'horizon moved ≈ 10 s past the clock');
    assert.strictEqual(v.extended, true);
    assert.strictEqual(eng.revokeContinuous(), 1);
    advance(6);
    assert.strictEqual(eng.activeNodeCount, 0);
  });

test('microphone unavailable (no getUserMedia): V1 error text', { skip }, async () => {
  const { eng } = setup({}, { navigator: {} });
  await assert.rejects(() => eng.startMic(), { message: MIC_UNAVAILABLE_TEXT });
});

test('isSupported follows the injected environment', () => {
  assert.strictEqual(AudioEngine.isSupported({}), false);
  assert.strictEqual(AudioEngine.isSupported({ webkitAudioContext: function W() {} }), true);
  assert.strictEqual(new AudioEngine({ env: {} }).isSupported(), false);
});

test('audibleVoiceCount: silent released voices waiting for onended are not counted', { skip },
  () => {
    const { eng, advance } = setup();
    let t = 0;
    // the mock fires onended at the last scheduled stop: a late one keeps faded voices in
    // `voices` (as a browser does until the render thread reports the end)
    const linger = () => {
      for (const v of eng.voices) {
        if (v !== eng.voice) v.sources.forEach((src) => src.stops.push(1e9));
      }
    };
    for (let i = 0; i < 6; i++) {
      eng.play(plan({ pattern: 'tone', frequency: 440 + i }), opt({ releaseS: 0.03 }));
      linger();
      t += 0.05;
      advance(t);
    }
    advance(t + 0.05);
    assert.ok(eng.voices.size > 2, `${eng.voices.size} voices held`);
    assert.strictEqual(eng.audibleVoiceCount, 1);
    const s = eng.snapshot();
    assert.strictEqual(s.voices, eng.voices.size);
    assert.strictEqual(s.audibleVoices, 1);
    eng.stopAll();
    advance(t + 1);
    assert.strictEqual(eng.audibleVoiceCount, 0);
  });
