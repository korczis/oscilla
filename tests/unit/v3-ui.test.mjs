// V3 UI integration (MEASURE, EXPERIMENTS): navigation contract, the static markup rules the
// workspaces must keep, and the pure experiment builder the MEASURE workspace saves with.
// The browser behaviour is gated by tests/browser/v3-ui.cjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { WORKSPACES } from '../../src/js/ui/app.js';
import {
  experimentFromResult, experimentTestContext, DEFAULT_EXPERIMENT_NAME,
} from '../../src/js/ui/measure-experiment.js';
import { createMeasurementEngine, assessMeasurement } from '../../src/js/measurement/engine.js';
import { KNOWN_ALGORITHM_IDS } from '../../src/js/measurement/algorithms.js';
import { validateExperiment } from '../../src/js/experiments/validate.js';
import { experimentToJson, formatErrors } from '../../src/js/experiments/schema.js';
import { mulberry32 } from '../../src/js/audio/noise.js';

const html = readFileSync(new URL('../../src/index.html', import.meta.url), 'utf8');
const between = (from, to) => html.slice(html.indexOf(from), html.indexOf(to, html.indexOf(from)));
const measureView = between('id="osc-view-measure"', 'id="osc-view-experiments"');
const experimentsView = between('id="osc-view-experiments"', 'id="osc-view-learn"');

test('Measure and Experiments follow Playground; About stays last', () => {
  assert.deepEqual(WORKSPACES.slice(0, 3), ['playground', 'measure', 'experiments']);
  assert.equal(WORKSPACES.at(-1), 'about');
  const nav = between('id="osc-nav"', '</nav>');
  const items = [...nav.matchAll(/data-osc="(nav\.[a-z]+)"/g)].map((m) => m[1]);
  assert.deepEqual(items.slice(0, 3), ['nav.playground', 'nav.measure', 'nav.experiments']);
  assert.equal(items.at(-1), 'nav.about');
});

test('the workspaces are full-width views keyed on `workspace`, with their own panels', () => {
  assert.match(measureView, /:hidden="workspace !== 'measure'"/);
  assert.match(experimentsView, /:hidden="workspace !== 'experiments'"/);
  assert.equal((measureView.match(/<section class="osc-panel /g) || []).length, 7);
  assert.equal((experimentsView.match(/<section class="osc-panel /g) || []).length, 3);
  for (const id of ['osc-measure-primary', 'osc-measure-stop', 'osc-measure-save']) {
    assert.match(measureView, new RegExp(`id="${id}"`));
  }
  // Two live regions (polite stage messages, assertive failures) and chart summaries.
  assert.match(measureView, /role="status" aria-live="polite"/);
  assert.match(measureView, /aria-live="assertive"/);
  for (const c of ['response', 'ir', 'rta']) {
    assert.match(measureView, new RegExp(`aria-describedby="osc-m-sum-${c}"`));
  }
});

test('no static text of the workspaces says SPL (only a valid level calibration may)', () => {
  // Text between tags, outside attribute expressions: the markup itself never claims SPL; the
  // level dialog names the reference as dB re 20 µPa.
  const text = (s) => s.replace(/<[^>]*>/g, ' ');
  assert.doesNotMatch(text(measureView), /SPL/);
  assert.doesNotMatch(text(experimentsView), /SPL/);
  const dialog = between('id="osc-dlg-level-cal"', '</dialog>');
  assert.doesNotMatch(text(dialog), /SPL/);
  assert.match(text(dialog), /dB re 20 µPa/);
});

// ---------------------------------------------------------------- experimentFromResult

const SR = 8000;
function io() {
  let t = 1;
  let run = 0;
  const tc = { kind: 'digital-loopback', label: 'TEST CONTEXT: unit loopback' };
  const noise = (seed, n) => {
    const r = mulberry32(seed);
    return Float32Array.from({ length: n }, () => (r() - 0.5) * 2e-3);
  };
  return {
    sampleRate: SR,
    now: () => t,
    async preflight() {
      return { audioContext: { available: true, state: 'running' }, sampleRate: SR,
        permission: 'not-required', input: { ok: true, device: { label: null, id: null },
          constraints: { requested: null, applied: null } }, inputLevel: null,
        output: { gain: 0.08, maxGain: 0.25, audibleVoices: 0 },
        worklet: { supported: true, mode: 'audioworklet' }, testContext: tc };
    },
    async captureNoise(seconds) {
      const startedAt = t + 0.01;
      t = startedAt + seconds;
      return { sampleRate: SR, samples: noise(5, Math.round(seconds * SR)), startedAt,
        preRoll: 0, postRoll: 0, constraints: { requested: null, applied: null },
        device: { label: null, id: null }, testContext: tc };
    },
    async runStimulus(stimulus, { preRollS, postRollS, notBefore }) {
      const pre = Math.round(preRollS * SR);
      const x = stimulus.samples;
      const samples = noise(10 + run, pre + x.length + Math.round(postRollS * SR));
      for (let i = 0; i < x.length; i++) samples[pre + i] += 0.5 * x[i];
      run += 1;
      const startedAt = Math.max(t + 0.01, notBefore ?? -Infinity);
      t = startedAt + samples.length / SR;
      return { sampleRate: SR, samples, startedAt, stimulusStartAt: startedAt + preRollS,
        preRoll: preRollS, postRoll: postRollS, constraints: { requested: null, applied: null },
        device: { label: null, id: null }, testContext: tc };
    },
    cancel() {},
    dispose() {},
  };
}

const RESULT = await createMeasurementEngine({ io: io(), assess: assessMeasurement,
  clock: { wall: () => 0, mono: () => 0 } }).measure({
  stimulus: { kind: 'log-sweep', duration: 1, level: 'low', f1: 50, f2: 3000 },
  repeats: 2, analysis: { noiseCheckS: 0.5, preRollS: 0.25, postRollS: 0.5, gapS: 0 },
});

test('a saved measurement validates, keeps the G20 aggregate and says TEST CONTEXT', () => {
  assert.equal(RESULT.state, 'COMPLETE', JSON.stringify(RESULT.reasons));
  const e = experimentFromResult(RESULT, { now: '2026-10-02T10:00:00.000Z', id: 'unit-1',
    build: { version: '9.9.9-test', channel: 'test' }, repeatOf: 'unit-0' });
  const v = validateExperiment(experimentToJson(e), { knownAlgorithms: KNOWN_ALGORITHM_IDS });
  assert.ok(v.ok, v.ok ? '' : formatErrors(v.errors));
  assert.equal(e.name, 'TEST CONTEXT · digital loopback');
  assert.match(e.environment.notes, /^TEST CONTEXT: unit loopback\.$/);
  assert.ok(e.measurement.runs.every((r) => r.testContext.kind === 'digital-loopback'));
  assert.equal(experimentTestContext(e), 'TEST CONTEXT: unit loopback');
  assert.equal(e.provenance.repeatOf, 'unit-0');
  assert.match(e.provenance.configHash, /^[0-9a-f]{64}$/);
  assert.match(e.provenance.resultHash, /^[0-9a-f]{64}$/);
  assert.equal(e.results.aggregate.runs, 2);
  assert.equal(e.results.transfer.derivedFrom, 'aggregate');
  assert.equal(e.algorithms.aggregate, 'oscilla.aggregate.v1');
  assert.equal(e.algorithms.quality, RESULT.quality.algorithm);
  assert.equal(e.calibration.frequency, null);
  assert.equal(e.calibration.level, null, 'no level calibration is invented');
});

test('a microphone measurement keeps the user name and notes and no test marker', () => {
  const r = { ...RESULT, testContext: null };
  const e = experimentFromResult(r, { now: 0, id: 'unit-2', name: '  Desk  ', notes: '1 m' });
  assert.equal(e.name, 'Desk');
  assert.equal(e.environment.notes, '1 m');
  assert.equal(experimentTestContext(e), null);
  assert.equal(experimentFromResult(r, { now: 0, id: 'unit-3' }).name, DEFAULT_EXPERIMENT_NAME);
  assert.ok(e.measurement.runs.every((x) => !('testContext' in x)));
});
