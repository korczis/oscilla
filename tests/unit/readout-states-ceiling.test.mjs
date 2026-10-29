// T001 (truth-table row GEN-01, ADR 0002): the output says when the safety ceiling acts. The
// engine taps the signal before its WaveShaper ceiling; ceilingState() judges a window of it;
// the visualization bridge reports a change of that state to the UI, never per frame.
//   node --test tests/unit/readout-states-ceiling.test.mjs
// The browser half (the audit probe's path through Filter Lab, in Chromium, Firefox and WebKit
// at 1536x1024 and 390x844) is check 'output-ceiling-indicator' of tests/browser/app.cjs.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

import {
  CEILING_TOLERANCE_ABS, ceilingState, ceilingTapSize,
} from '../../src/js/audio/output-ceiling.js';
import { MAX_OUTPUT_GAIN, DEFAULT_GAIN } from '../../src/js/core/constants.js';
import { VisualizationBridge } from '../../src/js/visualization/visualization-bridge.js';
import { createWorkbench } from '../../src/js/ui/workbench.js';
import { AudioEngine } from '../../src/js/audio/audio-engine.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const FREEZE_DIR = path.resolve(process.env.OSCILLA_FREEZE_DIR || path.join(here, '../freeze'));
const hasMock = fs.existsSync(path.join(FREEZE_DIR, 'extract.cjs'));
const { makeMockAudio } = hasMock
  ? createRequire(import.meta.url)(path.join(FREEZE_DIR, 'extract.cjs')) : {};

const CAP = MAX_OUTPUT_GAIN;
const SR = 48000; // the rate of the synthetic buffers below, set here
const N = 8192;
const dbfs = (db) => 10 ** (db / 20);

/** A Float32Array of one waveform at `amp`, `hz` at SR (what the tap would hold). */
function wave(kind, amp, hz, n = N) {
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const ph = (hz * i) / SR;
    const frac = ph - Math.floor(ph);
    let v;
    if (kind === 'sine') v = Math.sin(2 * Math.PI * ph);
    else if (kind === 'square') v = frac < 0.5 ? 1 : -1;
    else v = 2 * frac - 1; // sawtooth
    out[i] = amp * v;
  }
  return out;
}

test('T001: the tolerance is 2^-20 and the tap covers the 100 ms label period at any rate', () => {
  assert.equal(CEILING_TOLERANCE_ABS, 2 ** -20);
  for (const sr of [22050, 44100, 48000, 96000, 192000]) {
    const n = ceilingTapSize(sr);
    assert.ok(n >= 32 && n <= 32768 && (n & (n - 1)) === 0, `power of two at ${sr} Hz`);
    assert.ok(n / sr >= 0.1, `${n} frames cover 100 ms at ${sr} Hz`);
  }
});

test('T001: the default gain is not acting; the audit boost (+24 dB) is, with its fraction', () => {
  const quiet = ceilingState({ pre: wave('sine', DEFAULT_GAIN, 1000), cap: CAP });
  assert.equal(quiet.acting, false);
  assert.equal(quiet.over, 0);
  assert.equal(quiet.fraction, 0);
  assert.ok(Math.abs(quiet.peak - DEFAULT_GAIN) < 1e-3, `peak ${quiet.peak}`);

  const amp = DEFAULT_GAIN * dbfs(24); // 1.27: 0.08 boosted by a +24 dB peaking filter
  assert.ok(Math.abs(amp - 1.27) < 0.005);
  const loud = ceilingState({ pre: wave('sine', amp, 1000), cap: CAP });
  assert.equal(loud.acting, true);
  assert.ok(Math.abs(loud.peak - amp) < 1e-3, `peak before the ceiling ${loud.peak}`);
  // A sine of amplitude A spends 1 - (2/pi) asin(cap / A) of its time beyond the cap.
  const expected = 1 - (2 / Math.PI) * Math.asin(CAP / amp);
  assert.ok(Math.abs(loud.fraction - expected) < 0.01,
    `fraction ${loud.fraction.toFixed(4)} vs ${expected.toFixed(4)}`);
  assert.equal(loud.total, N);
  assert.equal(loud.over, Math.round(loud.fraction * N));
});

test('T001: sine, square and sawtooth at 100 % gain with no insert are not acting', () => {
  // The pre-ceiling peaks measured at 100 % gain (P05 audit): sine -12.04, square -12.45,
  // sawtooth -12.70 dBFS, all at or below the cap.
  const cases = [['sine', CAP, 1000], ['square', dbfs(-12.45), 1000],
    ['sawtooth', dbfs(-12.70), 1000], ['square', CAP, 440]];
  for (const [kind, amp, hz] of cases) {
    const s = ceilingState({ pre: wave(kind, amp, hz), cap: CAP });
    assert.equal(s.acting, false, `${kind} at ${amp}`);
    assert.ok(s.peak <= CAP + CEILING_TOLERANCE_ABS, `${kind} peak ${s.peak}`);
  }
});

test('T001: float rounding at the cap is tolerated; a sample beyond the tolerance is not', () => {
  const flat = (v) => Float32Array.from({ length: 256 }, (_, i) => (i % 2 ? v : -v));
  assert.equal(ceilingState({ pre: flat(CAP + 2 ** -22), cap: CAP }).acting, false,
    'a few ulps above the cap is rounding, and the ceiling passes it');
  assert.equal(ceilingState({ pre: flat(CAP + 2 ** -18), cap: CAP }).acting, true,
    '4x the tolerance above the cap is flattened, and reported');
  // A 20 Hz sine at the cap, with the rounding of the gain chain: many neighbouring samples sit
  // within 1e-4 of its peak, which a near-the-peak heuristic would read as a flat top.
  const slow = wave('sine', CAP * (1 + 2 ** -23), 20);
  const s = ceilingState({ pre: slow, cap: CAP });
  const near = slow.filter((x) => Math.abs(x) >= s.peak - 1e-4).length;
  assert.ok(near > 10, `${near} samples within 1e-4 of the peak`);
  assert.equal(s.acting, false, 'a slow sine at the cap is not clipped');
});

test('T001: no signal, silence and an unusable cap report nothing; out is reused', () => {
  assert.deepEqual(ceilingState({ pre: null, cap: CAP }),
    { acting: false, peak: 0, over: 0, total: 0, fraction: 0 });
  assert.equal(ceilingState({ pre: new Float32Array(512), cap: CAP }).acting, false);
  assert.equal(ceilingState({ pre: wave('sine', 1, 1000), cap: NaN }).acting, false);
  const out = {};
  assert.equal(ceilingState({ pre: wave('sine', 1, 1000), cap: CAP }, out), out);
  assert.equal(out.acting, true);
});

/** A stand-in engine whose pre-ceiling tap holds `buf.data` (snapshot() is all the bridge reads). */
function fakeEngine(buf, running = { on: true }) {
  const tap = { fftSize: N, getFloatTimeDomainData: (d) => d.set(buf.data) };
  const data = new Float32Array(N);
  return {
    snapshot(o = {}) {
      return Object.assign(o, { hasCtx: true, running: running.on, sampleRate: SR, voice: true,
        t0: 0, time: 0, plan: null, analyser: null, timeData: null, preCeiling: tap,
        preCeilingData: data, ceilingCap: CAP });
    },
  };
}

test('T001: the bridge reports a change of the ceiling state once, not per frame', () => {
  const buf = { data: wave('sine', DEFAULT_GAIN, 1000) };
  const running = { on: true };
  const bridge = new VisualizationBridge({ engine: fakeEngine(buf, running), env: {} });
  const seen = [];
  bridge.onCeiling = (acting) => seen.push(acting);
  bridge.pull();
  assert.deepEqual(seen, [], 'not acting at the default gain: nothing to report');
  assert.equal(bridge.state.live.ceiling, false);
  buf.data = wave('sine', DEFAULT_GAIN * dbfs(24), 1000);
  bridge.pull();
  bridge.pull();
  bridge.pull();
  assert.deepEqual(seen, [true], 'reported once while it stays acting');
  assert.equal(bridge.state.live.ceiling, true);
  assert.ok(bridge.ceiling.fraction > 0.5);
  running.on = false; // a suspended context: the tap holds stale samples
  bridge.pull();
  assert.deepEqual(seen, [true, false]);
  running.on = true;
  buf.data = wave('sine', DEFAULT_GAIN, 1000);
  bridge.pull();
  assert.deepEqual(seen, [true, false], 'the boost removed: still not acting');
  const idle = new VisualizationBridge({ env: {} });
  idle.pull();
  assert.equal(idle.state.live.ceiling, false, 'no engine: nothing');
});

test('T001: the UI shows the state while sounding; the gain readout is labelled a setpoint', () => {
  const cmp = createWorkbench({});
  const o = Object.create(null);
  Object.defineProperties(o, Object.getOwnPropertyDescriptors(cmp));
  Object.assign(o, { gainLevel: DEFAULT_GAIN, playing: false, seqPlaying: false });
  assert.equal(o.outputAtCeiling, false);
  assert.equal(o.ceilingActing, false, 'idle shows nothing');
  o.outputAtCeiling = true;
  assert.equal(o.ceilingActing, false, 'idle shows nothing, whatever the tap read last');
  o.playing = true;
  assert.equal(o.ceilingActing, true);
  assert.equal(o.ceilingText, 'OUTPUT AT CEILING (clipped)');
  assert.match(o.gainTitle, /setpoint/);
  assert.match(o.gainTitle, /-21\.9 dB/);
  assert.match(o.gainTitle, /before the filter, envelope, limiter and the -12\.0 dBFS output ceiling/);
  assert.match(o.gainTitle, /relative, not SPL/);
  assert.doesNotMatch(o.gainTitle, /dB SPL/);
  assert.match(o.gainTitle, /OUTPUT AT CEILING \(clipped\)/, 'the title says so while acting');
  o.outputAtCeiling = false;
  assert.doesNotMatch(o.gainTitle, /clipped/);
  assert.equal(o.gainDbText, '-21.9 dB', 'the readout value itself is unchanged');
});

test('T001: the engine taps trim before the ceiling, read-only and only when asked',
  { skip: hasMock ? false : `mock AudioContext not found in ${FREEZE_DIR}` }, () => {
    const plain = new AudioEngine({ env: { AudioContext: makeMockAudio().AudioContext } });
    assert.equal(plain.init(), true);
    assert.equal(plain.snapshot().preCeiling, null, 'the V1 output chain is unchanged by default');

    const eng = new AudioEngine({ env: { AudioContext: makeMockAudio().AudioContext } });
    eng.enableCeilingTap(); // before the context exists: built with it
    assert.equal(eng.init(), true);
    const s = eng.snapshot();
    assert.ok(s.preCeiling, 'snapshot exposes the tap');
    assert.equal(s.ceilingCap, MAX_OUTPUT_GAIN);
    assert.equal(s.preCeilingData.length, s.preCeiling.fftSize);
    assert.ok(s.preCeiling.fftSize / eng.ctx.sampleRate >= 0.1);
    assert.ok(eng.trim.out.includes(`node:${s.preCeiling.id}`), 'fed from trim');
    assert.ok(eng.trim.out.includes(`node:${eng.ceiling.id}`), 'trim still feeds the ceiling');
    assert.deepEqual(s.preCeiling.out, [], 'nothing is connected from the tap');
    assert.equal(eng.activeNodeCount, 0, 'outside the voice accounting');

    const late = new AudioEngine({ env: { AudioContext: makeMockAudio().AudioContext } });
    late.init();
    late.enableCeilingTap(); // on a running context: added once
    late.enableCeilingTap();
    const taps = late.ctx._nodes.filter((n) => n.kind === 'analyser');
    assert.equal(taps.length, 2, 'the output analyser and one tap');
    late.ctx.externalState('closed'); // rebuilt context keeps it
    assert.equal(late.snapshot().preCeiling, null);
    late.init();
    assert.ok(late.snapshot().preCeiling, 'a rebuilt context gets the tap again');
  });
