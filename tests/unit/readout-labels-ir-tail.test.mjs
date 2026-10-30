// T019 (truth-table row MSR-26): the impulse-response "noise tail" is read over the last 10 % of
// the full-overlap lags after the peak, which end about one post-roll after it. A decay still
// running there is counted as noise, so the figure is an upper bound. The view says so: the
// summary reads "tail level ≤ X dB re peak (noise or unfinished decay)" and the note names the
// window (T1 to T2 ms after the peak) and that a longer post-roll reads past the decay.
// Fixture F4 of the P05 audit: a noise-free system whose decay (T60 2 s) outlasts a 0.5 s
// post-roll. At 8 kHz (not the audit's 48 kHz) so the direct convolution stays quick.
import test from 'node:test';
import assert from 'node:assert/strict';
// Namespace imports: on the merge base (no irNoiseFloorWindow, no stimulusFrames) the file
// loads and the wording assertions fail, rather than the import.
import * as STIM from '../../src/js/measurement/stimulus.js';
import * as IRM from '../../src/js/measurement/impulse-response.js';
import { capIrLength } from '../../src/js/measurement/analysis-task.js';
import { buildIrView } from '../../src/js/measurement/views/ir-chart.js';
import { resultsFromMeasurement } from '../../src/js/experiments/schema.js';
import { fixedText, msText } from '../../src/js/measurement/views/common.js';

const { inverseSweep, renderStimulus } = STIM;
const { IR_ALGORITHMS, IR_ALGORITHMS_V1, computeImpulseResponse } = IRM;
const irNoiseFloorWindow = (ir, frames) => IRM.irNoiseFloorWindow(ir, frames);

const SR = 8000;
const PRE_S = 0.25;
const POST_S = 0.5;
const SWEEP = renderStimulus({ kind: 'log-sweep', sampleRate: SR, duration: 1, f1: 20, f2: 3000,
  level: 0.25 });
const X = SWEEP.samples;

/** Capture of x through h: PRE_S of silence, the sweep, POST_S of post-roll; no added noise. */
function captureThrough(h) {
  const pre = Math.round(PRE_S * SR);
  const n = pre + X.length + Math.round(POST_S * SR);
  const acc = new Float64Array(n);
  for (let k = 0; k < h.length; k++) {
    const g = h[k];
    if (!g) continue;
    for (let i = 0; i < X.length && pre + i + k < n; i++) acc[pre + i + k] += g * X[i];
  }
  return { captured: Float32Array.from(acc), lagSamples: pre };
}

// F4: a direct sound plus a decaying diffuse tail, T60 = 2 s, longer than the post-roll.
const F4 = (() => {
  let seed = 11;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 2 ** 32) * 2 - 1;
  const h = new Float64Array(Math.round(2.5 * SR));
  h[0] = 1;
  const decay = Math.log(1000) / 2; // 60 dB in 2 s
  for (let i = 1; i < h.length; i++) h[i] += 0.02 * rnd() * Math.exp(-decay * i / SR);
  return captureThrough(h);
})();
const ARGS = { stimulus: X, captured: F4.captured, sampleRate: SR, f1: 20, f2: 3000,
  lagSamples: F4.lagSamples };
const IR = computeImpulseResponse(ARGS);
const FRAMES = X.length; // the stimulus length, as rendered
// The window as the note prints it: 450.125 ms (the first averaged sample) to 500 ms.
const WINDOW_TEXT = `${msText(450.125, 1000 / SR)} to ${msText(500, 1000 / SR)} after the peak`;

/** 10·log10(mean h² / h_peak²) over [fromS, toS] re the peak, recomputed from the samples. */
function meanPowerDb(ir, [fromS, toS]) {
  const a = ir.peakIndex + Math.round(fromS * SR);
  const b = ir.peakIndex + Math.round(toS * SR);
  let s = 0;
  for (let i = a; i <= b; i++) s += ir.samples[i] * ir.samples[i];
  const p = ir.samples[ir.peakIndex];
  return 10 * Math.log10(s / (b - a + 1) / (p * p));
}

test('T019 F4: the tail level is stated as an upper bound, with the window it was read in', () => {
  assert.equal(IR.noiseFloorMethod, 'full-overlap-tail');
  const v = buildIrView(IR, { scale: 'db', stimulusFrames: FRAMES });
  const level = fixedText(Math.ceil(IR.noiseFloorDb), 0);
  assert.ok(v.summary.includes(`tail level ≤ ${level} dB re peak (noise or unfinished decay), `),
    v.summary);
  assert.doesNotMatch(v.summary, /noise tail −?\d/);
  const note = v.notes.find((n) => n.startsWith('Noise tail estimate: full-overlap-tail'));
  assert.ok(note, v.notes.join(' | '));
  assert.ok(note.includes(WINDOW_TEXT), note);
  assert.match(note, /A decay still running there counts as noise/);
  assert.match(note, /lengthen the post-roll/);
  assert.match(note, /upper bound/);

  assert.equal(STIM.stimulusFrames(SWEEP.spec), X.length, 'the frame count without rendering');
  const w = irNoiseFloorWindow(IR, FRAMES);
  // The full-overlap lags end one post-roll after the peak; the tail is their last 10 %.
  assert.ok(Math.abs(w[1] - POST_S) < 2 / SR, `window end ${w[1]}`);
  assert.ok(Math.abs(w[0] - 0.9 * POST_S) < 2 / SR, `window start ${w[0]}`);
  assert.equal(WINDOW_TEXT, '450.1 ms to 500.0 ms after the peak');
  // The window stated is the one averaged: its mean power is noiseFloorDb.
  assert.ok(Math.abs(meanPowerDb(IR, w) - IR.noiseFloorDb) < 1e-6,
    `${meanPowerDb(IR, w)} vs ${IR.noiseFloorDb}`);
  // The decay is still running there: the level is the decay's, far above any noise (none).
  assert.ok(IR.noiseFloorDb > -70, `${IR.noiseFloorDb}`);
});

test('T019: the stated bound is rounded up, never below the level read', () => {
  // Rounded to the nearest dB, −66.5 would read "≤ −67", 0.5 dB below the measured level.
  for (const [db, text] of [[-66.5, '−66'], [-66.4, '−66'], [-66.6, '−66'], [-66, '−66'],
    [-0.3, '0']]) {
    const v = buildIrView({ ...IR, noiseFloorDb: db }, { stimulusFrames: FRAMES });
    assert.ok(v.summary.includes(`tail level ≤ ${text} dB re peak `), `${db}: ${v.summary}`);
  }
});

test('T019: without the stimulus length the window is described, not invented', () => {
  const v = buildIrView(IR, {});
  assert.match(v.summary, /tail level ≤ -?−?\d+ dB re peak \(noise or unfinished decay\)/);
  const note = v.notes.find((n) => n.startsWith('Noise tail estimate: full-overlap-tail'));
  assert.match(note, /last 10 % of the lags at which the whole stimulus lies inside the capture/);
  assert.doesNotMatch(note, /\d ms to /);
  assert.match(note, /lengthen the post-roll/);
  // A frame count that does not fit the IR gives no window either.
  assert.equal(irNoiseFloorWindow(IR, IR.samples.length + 10), null);
  assert.equal(irNoiseFloorWindow(IR, 0), null);
  assert.doesNotMatch(buildIrView(IR, { stimulusFrames: 3.5 }).notes.join(' '), /\d ms to /);
});

test('T019: a capped IR states the window of the full IR it was read on', () => {
  const capped = capIrLength(IR, 4096);
  assert.ok(capped.truncation);
  assert.deepEqual(irNoiseFloorWindow(capped, FRAMES), irNoiseFloorWindow(IR, FRAMES));
  const note = buildIrView(capped, { stimulusFrames: FRAMES }).notes
    .find((n) => n.startsWith('Noise tail estimate'));
  assert.ok(note.includes(WINDOW_TEXT), note);
});

test('T019 negative: a null floor still reads "not available", with no bound and no window',
  () => {
    const short = Float32Array.from(F4.captured.subarray(0, F4.lagSamples + X.length + 8));
    const none = computeImpulseResponse({ ...ARGS, captured: short });
    assert.equal(none.noiseFloorDb, null);
    assert.equal(none.noiseFloorMethod, 'none');
    assert.equal(irNoiseFloorWindow(none, FRAMES), null);
    const v = buildIrView(none, { scale: 'db', stimulusFrames: FRAMES });
    assert.match(v.summary, /noise tail not available, /);
    assert.ok(v.notes.includes('Noise tail: not available.'));
    assert.doesNotMatch(v.summary + v.notes.join(' '), /≤|upper bound|ms to /);
  });

test('T019 negative: the farina-inverse method label is unchanged', () => {
  const ir = computeImpulseResponse({ ...ARGS, method: 'farina-inverse',
    inverse: inverseSweep(SWEEP.spec) });
  const v = buildIrView(ir, { stimulusFrames: FRAMES });
  assert.ok(v.notes.includes(`Method: farina-inverse (${IR_ALGORITHMS['farina-inverse']}).`),
    v.notes.join(' | '));
  assert.ok(v.notes.includes(`Method: spectral (${IR_ALGORITHMS.spectral}).`) === false);
  assert.ok(buildIrView(IR, {}).notes.includes(`Method: spectral (${IR_ALGORITHMS.spectral}).`));
});

test('T019 negative: stored IR results are unchanged (no new field, same floor)', () => {
  assert.deepEqual(Object.keys(IR).sort(), ['algorithm', 'captureOffsetS', 'fftSize', 'method',
    'noiseFloorDb', 'noiseFloorMethod', 'peakIndex', 'peakTimeS', 'sampleRate', 'samples',
    'window'].sort());
  const stored = resultsFromMeasurement({ ir: { ...IR, run: 0 } }).ir;
  assert.deepEqual(Object.keys(stored).sort(), Object.keys(IR).sort());
  assert.equal(stored.noiseFloorDb, IR.noiseFloorDb);
  // v1 keeps its own floor and its old wording (no method, no bound, no window).
  const v1 = computeImpulseResponse({ ...ARGS, algorithm: IR_ALGORITHMS_V1.spectral });
  assert.ok(!('noiseFloorMethod' in v1));
  assert.equal(irNoiseFloorWindow(v1, FRAMES), null);
  const v = buildIrView(v1, { stimulusFrames: FRAMES });
  assert.ok(v.summary.includes(`noise tail ${fixedText(v1.noiseFloorDb, 0)} dB re peak, `),
    v.summary);
  assert.doesNotMatch(v.summary, /≤/);
});
