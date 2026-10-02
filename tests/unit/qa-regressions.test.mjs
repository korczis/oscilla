// V2 final-QA regressions (pure parts and the engine on the recording mock AudioContext):
// dual phase offset (start delay, click-free restart), the engine-owned microphone graph, the
// additive Harmonics table, the signal path's V2 stages, the scope window, the correlation
// states, the mic error texts, the played additive gain and the sequencer status duration.
//   node --test tests/unit/qa-regressions.test.mjs
// The browser half is tests/browser/qa-regressions.cjs.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

import { AudioEngine } from '../../src/js/audio/audio-engine.js';
import { normalizePhaseDeg, phaseStartDelay } from '../../src/js/audio/modulation.js';
import { buildPlan } from '../../src/js/audio/patterns.js';
import { defaultInstrumentState } from '../../src/js/core/config.js';
import { buildPeriodicWave, harmonicSeries, visualCoefficients } from '../../src/js/audio/additive.js';
import { additiveHarmonicTable, harmonicTable } from '../../src/js/visualization/harmonics.js';
import { pathNodesFor } from '../../src/js/visualization/signal-path.js';
import { scopeWindow } from '../../src/js/ui/p5-views.js';
import { createWorkbench } from '../../src/js/ui/workbench.js';
import { correlationDisplay } from '../../src/js/analysis/correlation.js';
import { micUnavailableText, MIC_UNAVAILABLE } from '../../src/js/labs/mic-analyzer.js';
import { gainForPlayedLevel } from '../../src/js/labs/additive.js';
import { referenceSequence, totalDurationMs } from '../../src/js/sequencer/model.js';
import { formatMs } from '../../src/js/core/frequency.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const FREEZE_DIR = path.resolve(process.env.OSCILLA_FREEZE_DIR || path.join(here, '../freeze'));
const hasMock = fs.existsSync(path.join(FREEZE_DIR, 'extract.cjs'));
const skip = hasMock ? false : `mock AudioContext not found in ${FREEZE_DIR}`;
const require = createRequire(import.meta.url);
const { makeMockAudio } = hasMock ? require(path.join(FREEZE_DIR, 'extract.cjs')) : {};

const SR = 48000;

function dualPlan(fa = 440, fb = 440, stereo = true) {
  const st = defaultInstrumentState();
  const r = buildPlan({
    ...st,
    source: 'dual',
    dual: {
      ...st.dual,
      a: { ...st.dual.a, freq: fa, wave: 'sine', detune: 0 },
      b: { ...st.dual.b, freq: fb, wave: 'sine', detune: 0 },
      stereo,
    },
  }, { safeMax: (SR / 2) * 0.95, continuous: true });
  if (!r.ok) throw new Error(r.error);
  return r.plan;
}

const opt = (o = {}) => ({
  mode: 'hold', continuous: true, limitS: 2, durationS: 0.5, attackS: 0.01, releaseS: 0.03, ...o,
});

function setup() {
  const audio = makeMockAudio({});
  const timers = new Map();
  let seq = 0;
  const env = {
    AudioContext: audio.AudioContext,
    setTimeout: (fn, ms) => { timers.set(++seq, { fn, ms }); return seq; },
    clearTimeout: (id) => { timers.delete(id); },
  };
  const eng = new AudioEngine({ env });
  // advance(dt): the mock's advance() takes an absolute time
  return { eng, audio, advance: (dt) => eng.ctx.advance(eng.ctx.currentTime + dt) };
}

// ---------------------------------------------------------------- #5 phase offset

test('phase offset: start delay gives B the phase φ ahead of A, below one period', () => {
  assert.equal(normalizePhaseDeg(-90), 270);
  assert.equal(normalizePhaseDeg(720), 0);
  assert.equal(normalizePhaseDeg('x'), 0);
  assert.equal(phaseStartDelay(440, 0), 0);
  assert.equal(phaseStartDelay(0, 90), 0);
  // sin(2πf(t − d)) = sin(2πft + φ)  ⇔  d = (1 − φ/360) / f
  for (const deg of [45, 90, 180, 270, 359]) {
    const d = phaseStartDelay(100, deg);
    assert.ok(d > 0 && d < 1 / 100, `${deg}°: ${d}`);
    const phaseAtT0 = (-2 * Math.PI * 100 * d) % (2 * Math.PI);
    const want = (deg * Math.PI) / 180 - 2 * Math.PI;
    assert.ok(Math.abs(phaseAtT0 - want) < 1e-9, `${deg}°`);
  }
});

test('phase offset: dual B starts later by the delay; no option keeps the V1 schedule',
  { skip }, () => {
    const { eng, advance } = setup();
    eng.play(dualPlan(440, 440), opt());
    let v = eng.voice;
    assert.equal(v.live.B.osc.startAt, v.live.A.osc.startAt);
    eng.stopAll();
    advance(1);
    eng.play(dualPlan(440, 440), opt({ dualPhaseDeg: 90 }));
    v = eng.voice;
    const delay = v.live.B.osc.startAt - v.live.A.osc.startAt;
    assert.ok(Math.abs(delay - 0.75 / 440) < 1e-12, String(delay));
    assert.equal(v.phaseDeg, 90);
    eng.stopAll();
    advance(1);
    assert.equal(eng.activeNodeCount, 0);
    assert.equal(eng.activeSourceCount, 0);
  });

test('phase offset: setDualPhase restarts a sounding dual voice with a fast release',
  { skip }, () => {
    const { eng, advance } = setup();
    eng.play(dualPlan(440, 440), opt({ dualPhaseDeg: 0 }));
    advance(0.2);
    const v1 = eng.voice;
    assert.equal(eng.setDualPhase(0), 'same');
    assert.equal(eng.setDualPhase(360), 'same');
    assert.equal(eng.setDualPhase(180), 'restarted');
    const v2 = eng.voice;
    assert.notEqual(v2, v1);
    assert.equal(v1.releasing, true, 'old voice fades out (FAST_RELEASE_S), no hard cut');
    assert.equal(v2.opts.dualPhaseDeg, 180);
    assert.ok(v2.t0 >= v1.endTime - 0.011, 'new voice starts after the old one has faded');
    eng.stopAll();
    advance(1);
    assert.equal(eng.activeNodeCount, 0);
    // A non-dual voice is left alone.
    const st = defaultInstrumentState();
    const tone = buildPlan(st, { safeMax: (SR / 2) * 0.95, continuous: true }).plan;
    eng.play(tone, opt());
    assert.equal(eng.setDualPhase(90), false);
    eng.stopAll();
    advance(1);
    assert.equal(eng.activeNodeCount, 0);
  });

// ---------------------------------------------------------------- #16 engine microphone

test('attachMicrophone: engine-built, accounted MediaStreamSource → Analyser, no output',
  { skip }, () => {
    const { eng, audio } = setup();
    audio.AudioContext.prototype.createMediaStreamSource = function createMSS() {
      const n = this.createGain();
      n.kind = 'mediaStreamSource';
      return n;
    };
    const tracks = [{ readyState: 'live', onended: null }];
    tracks[0].stop = () => { tracks[0].readyState = 'ended'; };
    const stream = { getTracks: () => tracks };
    const an = eng.attachMicrophone(stream, { fftSize: 4096, smoothingTimeConstant: 0.5 });
    assert.ok(an);
    assert.equal(an.fftSize, 4096);
    assert.equal(an.smoothingTimeConstant, 0.5);
    assert.equal(eng.micNodeCount, 2);
    assert.equal(eng.activeNodeCount, 0, 'voice accounting is separate');
    const src = eng.ctx._nodes.find((n) => n.kind === 'mediaStreamSource');
    assert.deepEqual(src.out, [`node:${an.id}`]);
    assert.deepEqual(an.out, [], 'never connected to the destination');
    assert.equal(eng.detachMicrophone(), true);
    assert.equal(eng.micNodeCount, 0);
    assert.equal(tracks[0].readyState, 'ended');
    assert.equal(eng.detachMicrophone(), false);
  });

// ---------------------------------------------------------------- #6 harmonics from additive

test('additiveHarmonicTable: the played PeriodicWave coefficients, Nyquist split', () => {
  const partials = harmonicSeries('square', 10);
  const { scale } = buildPeriodicWave(null, partials);
  const bars = visualCoefficients(partials, { scale, fundamentalHz: 5000, sampleRate: SR });
  const t = additiveHarmonicTable(bars, 5000, SR / 2);
  assert.equal(t.source, 'additive');
  assert.match(t.title, /ADDITIVE/);
  assert.deepEqual(t.list.map((x) => x.n), [1, 3, 5, 7, 9]);
  for (const x of t.list) {
    const b = bars[x.n - 1];
    assert.ok(Math.abs(x.db - b.gainDb) < 1e-9);
    assert.equal(x.below, x.n * 5000 < SR / 2);
  }
  assert.equal(t.below, 1 + 1); // 5 and 15 kHz below 24 kHz
  assert.equal(t.total, 5);
  // differs from the built-in square table, which has no normalisation and 500 partials
  assert.notEqual(harmonicTable('square', 5000, SR / 2).total, t.total);
  const silent = additiveHarmonicTable(bars.map((b) => ({ ...b, gain: 0 })), 5000, SR / 2);
  assert.equal(silent.list.length, 0);
});

// ---------------------------------------------------------------- #17 signal path stages

test('signal path: additive, ADSR, filter and stereo router appear; V1 list without labs', () => {
  const st = { waveform: 'sine', labels: { freq: '440 Hz', attack: '10 ms', release: '30 ms',
    gain: '0.080' } };
  const v1 = pathNodesFor(null, st);
  assert.deepEqual(pathNodesFor(null, st, null), v1);
  assert.equal(v1.length, 7);
  const lab = {
    additive: [{ n: 1, gain: 0.8 }, { n: 2, gain: 0 }, { n: 3, gain: 0.2 }],
    adsr: { a: 0.01, d: 0.2, s: 0.6, r: 0.4 },
    filter: { type: 'lowpass', frequency: 1200, Q: 0.707, enabled: true },
    router: null,
    phaseDeg: 0,
  };
  const n = pathNodesFor(null, st, lab);
  assert.deepEqual(n.map((x) => x.title), ['ADDITIVE OSC', 'MODULATION', 'ADSR ENVELOPE',
    'FILTER', 'MASTER GAIN', 'LIMITER', 'ANALYSER', 'DEVICE OUTPUT']);
  assert.match(n[0].sub, /2 partials/);
  assert.match(n[3].sub, /low-pass · 1\.20 kHz · Q 0\.707/);
  const d = pathNodesFor(dualPlan(440, 442), st, { additive: null, adsr: null, filter: null,
    router: { mode: 'split', panA: -1, panB: 1 }, phaseDeg: 90 });
  assert.equal(d[1].title, 'STEREO ROUTER');
  assert.match(d[0].sub, /B \+90°/);
});

// ---------------------------------------------------------------- #7 scope window

test('scope window: 100 ms at 48 kHz shows 100 ms (was 85 ms); 96 kHz is labelled limited', () => {
  const w48 = scopeWindow({ requestedMs: 100, bufferLength: 8192, sampleRate: 48000, freqHz: 440 });
  assert.equal(w48.samples, 4800);
  assert.equal(w48.ms, 100);
  assert.equal(w48.limited, false);
  const w96 = scopeWindow({ requestedMs: 100, bufferLength: 8192, sampleRate: 96000, freqHz: 440 });
  assert.equal(w96.limited, true);
  assert.ok(w96.ms < 100 && w96.ms > 80, String(w96.ms));
  assert.equal(w96.samples + Math.ceil(96000 / 440) + 1, 8192);
  // the trigger room is capped at half the buffer (very low tones)
  const low = scopeWindow({ requestedMs: 100, bufferLength: 8192, sampleRate: 48000, freqHz: 1 });
  assert.equal(low.samples, 4096);
  assert.equal(low.limited, true);
  const idle = scopeWindow({ requestedMs: 20, bufferLength: 0, sampleRate: 0, freqHz: 440 });
  assert.equal(idle.ms, 20);
});

// ---------------------------------------------------------------- #14 correlation states

test('correlation display: idle, mono, silent and a visible estimate', () => {
  const idle = correlationDisplay(null, 'idle');
  assert.equal(idle.text, '—');
  assert.match(idle.valueText, /nothing playing/);
  const mono = correlationDisplay(null, 'mono');
  assert.equal(mono.text, '1.00');
  assert.equal(mono.basis, 'mono');
  assert.match(mono.valueText, /not measured/);
  const silent = correlationDisplay(null, 'silent');
  assert.equal(silent.text, '—');
  assert.doesNotMatch(silent.valueText, /nothing playing/);
  const live = correlationDisplay(-0.5, 'live');
  assert.equal(live.text, '-0.50');
  assert.equal(live.basis, 'est.');
  assert.equal(live.meterPct, 25);
  assert.equal(correlationDisplay(0.25).basis, 'est.'); // default state from a value
});

// ---------------------------------------------------------------- #17 mic texts

test('mic unavailable text says why (no more "file:// or permission" for every case)', () => {
  const t = (e, env) => micUnavailableText(e, env);
  assert.match(t({ name: 'NotAllowedError' }, { hasApi: true }), /permission denied/);
  assert.match(t({ name: 'NotFoundError' }, { hasApi: true }), /no microphone found/);
  assert.match(t(new Error('x'), { hasApi: false, secure: false, protocol: 'http:' }),
    /secure page/);
  assert.match(t(new Error('x'), { hasApi: false, secure: true, protocol: 'file:' }),
    /local files/);
  assert.match(t(new Error('x'), { hasApi: false, secure: true, protocol: 'https:' }),
    /no microphone API/);
  for (const s of [t(null, { hasApi: true }), t({ name: 'NotAllowedError' }, {})]) {
    assert.ok(s.startsWith(MIC_UNAVAILABLE));
    assert.doesNotMatch(s, /file:\/\/ or permission/);
  }
});

// ---------------------------------------------------------------- #17 additive gain field

test('additive gain: the solved table gain plays at the requested level', () => {
  const partials = harmonicSeries('sawtooth', 10);
  const played = (ps, n) => ps[n - 1].gain * buildPeriodicWave(null, ps).scale;
  for (const db of [-6, -12, -30]) {
    const target = 10 ** (db / 20);
    const { gain } = gainForPlayedLevel(partials, 3, target);
    const next = partials.map((p) => (p.n === 3 ? { ...p, gain } : p));
    const got = 20 * Math.log10(played(next, 3));
    assert.ok(Math.abs(got - db) < 0.15, `${db} dB → ${got.toFixed(3)} dB`);
  }
  // a lone partial always plays at full scale: its gain is kept
  const sine = harmonicSeries('sine', 10);
  assert.equal(gainForPlayedLevel(sine, 1, 0.1).gain, 1);
  // off
  assert.equal(gainForPlayedLevel(partials, 2, 0).gain, 0);
  // out of reach: capped at table gain 1
  assert.equal(gainForPlayedLevel(partials, 5, 1).gain, 1);
});

// ---------------------------------------------------------------- #8 status duration

test('status bar duration while the sequencer plays is the sequence length', () => {
  const model = referenceSequence();
  const wb = createWorkbench({ labs: { sequencer: { editor: { model } } } });
  const cmp = {};
  Object.defineProperties(cmp, Object.getOwnPropertyDescriptors(wb));
  Object.assign(cmp, { seqPlaying: true, playing: false, planSummary: { kind: 'open' },
    continuousAllowed: false, safetyLimit: 2, source: 'single', pattern: 'tone' });
  const ms = totalDurationMs(model);
  assert.ok(ms > 2000);
  const want = model.loop ? `${formatMs(ms)} (loop)` : formatMs(ms);
  assert.equal(cmp.statusDurationText, want);
  cmp.seqPlaying = false;
  assert.equal(cmp.statusDurationText, '≤ 2 s');
});
