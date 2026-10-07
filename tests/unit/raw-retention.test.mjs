// Raw capture retention (ADR 0049) pinned to the code. The policy: the engine holds a raw
// capture only while its measurement runs; measure() returns it only under keepRaw (no product
// path asks for that), and then only the caller's result holds it; a saved experiment, the
// store and an export hold derived results only; the stored impulse response is derived from
// the capture and carries what the microphone picked up after the sweep passed each frequency;
// and the product says so where the user saves a run, in About and in the README.
//
// Release is proved with WeakRefs to the capture buffers the io handed out and a forced
// garbage collection (node:v8 exposes gc for this process), so "released" means that nothing
// reachable, the engine included, still references the buffer.
//   node --test tests/unit/raw-retention.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import v8 from 'node:v8';
import vm from 'node:vm';
import { assessMeasurement, createMeasurementEngine } from '../../src/js/measurement/engine.js';
import { experimentFromResult } from '../../src/js/ui/measure-experiment.js';
import {
  experimentToJson, sanitizeForExport,
} from '../../src/js/experiments/schema.js';
import { isEncodedArray, encodeArray } from '../../src/js/experiments/encode.js';
import { validateExperiment } from '../../src/js/experiments/validate.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (rel) => readFileSync(path.join(ROOT, rel), 'utf8');

v8.setFlagsFromString('--expose-gc');
const gc = vm.runInNewContext('gc');

const SR = 48000;
const NOW = '2026-10-07T10:00:00.000Z';

function seeded(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296 - 0.5;
  };
}

/** An unrelated sound in the room ("a voice"): two tones, amplitude and phase modulated. */
function voiceAt(i) {
  const t = i / SR;
  return 0.05 * Math.sin(2 * Math.PI * 440 * t) * (0.5 + 0.5 * Math.sin(2 * Math.PI * 3 * t))
    + 0.03 * Math.sin(2 * Math.PI * 1234 * t + 3 * Math.sin(2 * Math.PI * 5 * t));
}

/**
 * engine.js io whose capture is the stimulus at `gain` after the pre-roll, seeded noise and,
 * when `voice` = { from, frames } (capture frames), a voice in that span. It keeps no strong
 * reference to anything it returns: `refs` holds a WeakRef to every capture buffer. Run
 * `failRun` rejects (the device is lost); run `emptyRun` is captured as digital silence.
 */
function syntheticIo({ gain = 0.3, voice = null, onYield = null, failRun = -1,
  emptyRun = -1 } = {}) {
  let t = 1;
  let run = 0;
  const rnd = seeded(11);
  const refs = [];
  const device = { label: null, id: null };
  const constraints = { requested: null, applied: null };
  const io = {
    sampleRate: SR,
    refs,
    now: () => t,
    async preflight() {
      return { audioContext: { available: true, state: 'running' }, sampleRate: SR,
        permission: 'granted', input: { ok: true, device, constraints },
        inputLevel: { peak: 0.0005, rmsDb: -72 }, output: { gain: 0.08, maxGain: 0.25,
          audibleVoices: 0 }, worklet: { supported: true, mode: 'audioworklet' } };
    },
    async captureNoise(seconds) {
      const startedAt = t + 0.1;
      t = startedAt + seconds;
      const samples = new Float32Array(Math.round(seconds * SR));
      for (let i = 0; i < samples.length; i++) samples[i] = 1e-4 * rnd();
      refs.push(new WeakRef(samples));
      return { sampleRate: SR, samples, preRoll: 0, postRoll: 0, startedAt, constraints,
        device };
    },
    async runStimulus(stimulus, { preRollS, postRollS, notBefore, onScheduled }) {
      const index = run++;
      if (index === failRun) throw Object.assign(new Error('device lost'), { code: 'NO_INPUT' });
      const pre = Math.round(preRollS * SR);
      const x = stimulus.samples;
      const frames = pre + x.length + Math.round(postRollS * SR);
      const samples = new Float32Array(frames);
      if (index !== emptyRun) {
        for (let i = 0; i < frames; i++) samples[i] = 1e-4 * rnd();
        for (let i = 0; i < x.length; i++) samples[pre + i] += gain * x[i];
      }
      if (voice) {
        for (let i = voice.from; i < voice.from + voice.frames; i++) samples[i] += voiceAt(i);
      }
      const startedAt = Math.max(t + 0.1, notBefore ?? -Infinity);
      const times = { captureStartAt: startedAt, stimulusStartAt: startedAt + preRollS,
        stimulusEndAt: startedAt + preRollS + x.length / SR,
        captureEndAt: startedAt + frames / SR };
      if (onScheduled) onScheduled(times);
      t = times.captureEndAt;
      refs.push(new WeakRef(samples));
      return { sampleRate: SR, samples, preRoll: preRollS, postRoll: postRollS, startedAt,
        stimulusStartAt: times.stimulusStartAt, constraints, device };
    },
    async yield() { if (onYield) await onYield(); },
    cancel() {},
    dispose() {},
  };
  return io;
}

const RECIPE = Object.freeze({
  stimulus: { kind: 'log-sweep', duration: 1, level: 0.25, f1: 20, f2: 20000, fade: 0.01 },
  repeats: 2,
  analysis: { noiseCheckS: 0.5, preRollS: 0.25, postRollS: 0.5, gapS: 0.2 },
});
const recipe = (over = {}) => ({ ...JSON.parse(JSON.stringify(RECIPE)), ...over });

/**
 * Collects garbage after the current job, so WeakRefs made in it can be cleared. Without
 * `refs`: three rounds, for an assertion that buffers are still alive. With `refs`: at least
 * three rounds, then until every ref is cleared or COLLECT_DEADLINE_MS has passed. A fixed
 * number of rounds is not enough for "released": V8's concurrent optimizing compile (OSR of
 * the loop that fills the first capture) can pin that buffer for a few more event-loop turns
 * after the engine has let go of it, and how many depends on the machine's load. A buffer the
 * engine really holds never clears, so the assertion after this still fails on the deadline.
 */
const COLLECT_DEADLINE_MS = 10000;
async function collect(refs = null) {
  const deadline = Date.now() + COLLECT_DEADLINE_MS;
  const pending = () => refs !== null && refs.some((r) => r.deref() !== undefined);
  for (let i = 0; i < 3 || (pending() && Date.now() < deadline); i++) {
    await new Promise((r) => setTimeout(r, i < 3 ? 0 : 25));
    gc();
    await new Promise((r) => setImmediate(r));
  }
}

const alive = (refs) => refs.filter((r) => r.deref() !== undefined).length;

// ------------------------------------------------------------------ in memory, during a run

test('the engine keeps no capture once measure() has resolved (default, no keepRaw)',
  async () => {
    const io = syntheticIo();
    const engine = createMeasurementEngine({ io });
    let result = await engine.measure(recipe());
    assert.equal(result.state, 'COMPLETE');
    assert.equal(io.refs.length, 3, 'the noise check and two runs were captured');
    assert.ok(result.runs.every((r) => r.raw === null));
    assert.equal(result.noise.raw, null);
    await collect(io.refs);
    assert.equal(alive(io.refs), 0, 'every capture buffer was collected while the result and '
      + 'the engine are still reachable');
    assert.ok(result.transfer && engine.state === 'COMPLETE');
    result = null;
  });

test('keepRaw: the captures live exactly as long as the caller keeps the result', async () => {
  const io = syntheticIo();
  const engine = createMeasurementEngine({ io });
  let result = await engine.measure(recipe(), { keepRaw: true });
  assert.equal(result.state, 'COMPLETE');
  await collect();
  assert.equal(alive(io.refs), 3, 'held by the result (noise.raw and runs[i].raw)');
  assert.equal(result.noise.raw, io.refs[0].deref());
  result.runs.forEach((r, i) => assert.equal(r.raw, io.refs[i + 1].deref()));
  result = null;
  await collect(io.refs);
  assert.equal(alive(io.refs), 0, 'nothing in the engine kept them');
  assert.equal(engine.state, 'COMPLETE');
});

test('an aborted measurement leaves no capture behind, with or without keepRaw', async () => {
  for (const keepRaw of [false, true]) {
    let engine = null;
    const io = syntheticIo({ onYield: () => { engine.abort('user'); } });
    engine = createMeasurementEngine({ io });
    await assert.rejects(engine.measure(recipe(), { keepRaw }), (e) => e.code === 'ABORTED');
    assert.ok(io.refs.length >= 1, 'the abort landed after a capture');
    await collect(io.refs);
    assert.equal(alive(io.refs), 0, `keepRaw ${keepRaw}: nothing kept a capture`);
  }
});

test('a failed measurement leaves no capture behind, with or without keepRaw', async () => {
  for (const keepRaw of [false, true]) {
    const io = syntheticIo({ failRun: 1 });
    const engine = createMeasurementEngine({ io });
    await assert.rejects(engine.measure(recipe(), { keepRaw }), (e) => e.code === 'NO_INPUT');
    assert.equal(engine.state, 'ERROR');
    assert.equal(io.refs.length, 2, 'the noise check and the first run were captured');
    await collect(io.refs);
    assert.equal(alive(io.refs), 0, `keepRaw ${keepRaw}: nothing kept a capture`);
  }
});

// INVALID is a resolved result, reached two ways: a run check before the analysis (here a run
// captured as digital silence) and the quality assessment after it (here a clipped sweep; the
// product passes the same assessMeasurement). Both must have let go of every capture.
const INVALID_CASES = Object.freeze([
  { name: 'a silent run (run check)', io: { emptyRun: 0 }, engine: {}, captures: 2,
    code: /^(EMPTY|NO_INPUT)$/ },
  { name: 'a clipped sweep (quality assessment)', io: { gain: 5 },
    engine: { assess: assessMeasurement }, captures: 3, code: /CLIP/ },
]);

test('an INVALID measurement leaves no capture behind, with or without keepRaw', async () => {
  for (const c of INVALID_CASES) {
    for (const keepRaw of [false, true]) {
      const what = `${c.name}, keepRaw ${keepRaw}`;
      const io = syntheticIo(c.io);
      const engine = createMeasurementEngine({ io, ...c.engine });
      let result = await engine.measure(recipe(), { keepRaw });
      assert.equal(result.state, 'INVALID', what);
      assert.ok(result.reasons.some((r) => c.code.test(r.code)),
        `${what}: ${JSON.stringify(result.reasons.map((r) => r.code))}`);
      assert.equal(io.refs.length, c.captures, `${what}: captures taken`);
      assert.equal(engine.state, 'INVALID', what);
      // Under keepRaw the caller's result may hold captures (that is what keepRaw means), so
      // "the engine keeps none" is judged once the caller has dropped the result.
      if (keepRaw) result = null;
      await collect(io.refs);
      assert.equal(alive(io.refs), 0, `${what}: nothing in the engine kept a capture`);
      result = null;
    }
  }
});

// ------------------------------------------------------------------ stored and exported

/** Every array in a value with its path: typed arrays and encoded arrays (a file). */
function arrays(v, at = '', out = []) {
  if (ArrayBuffer.isView(v)) { out.push({ path: at, length: v.length, value: v }); return out; }
  if (isEncodedArray(v)) { out.push({ path: at, length: v.length, value: v }); return out; }
  if (!v || typeof v !== 'object') return out;
  for (const [k, x] of Object.entries(v)) arrays(x, at ? `${at}.${k}` : k, out);
  return out;
}

function keysNamed(v, name, at = '', out = []) {
  if (!v || typeof v !== 'object' || ArrayBuffer.isView(v)) return out;
  for (const [k, x] of Object.entries(v)) {
    const p = at ? `${at}.${k}` : k;
    if (k === name) out.push(p);
    keysNamed(x, name, p, out);
  }
  return out;
}

// The derived arrays a run stores: the response (transfer, its quality mask, the aggregate of
// repeats) and the impulse response. Nothing else may be a sample array.
const DERIVED = /^(results\.(transfer|aggregate|runTransfers\.\d+\.transfer)\.[A-Za-z]+|results\.ir\.samples|quality\.mask\.[A-Za-z]+)$/;

test('a saved experiment and its export carry derived arrays only, even after keepRaw',
  async () => {
    const io = syntheticIo();
    const engine = createMeasurementEngine({ io });
    const result = await engine.measure(recipe(), { keepRaw: true });
    const captures = io.refs.map((r) => r.deref());
    assert.equal(captures.filter(Boolean).length, 3);
    const e = experimentFromResult(result, { now: NOW, id: 'raw-retention' });
    const exported = JSON.parse(experimentToJson(sanitizeForExport(e).experiment));
    for (const [what, value] of [['record', e], ['export', exported]]) {
      assert.deepEqual(keysNamed(value, 'raw'), [], `${what}: no raw field`);
      const found = arrays(value);
      assert.ok(found.some((a) => a.path === 'results.ir.samples'), `${what}: the IR is stored`);
      for (const a of found) {
        assert.match(a.path, DERIVED, `${what}: ${a.path} is not a derived result`);
        assert.ok(!captures.includes(a.value), `${what}: ${a.path} is a capture buffer`);
      }
      // The only array as long as a capture is the impulse response (derived, see below).
      const captureLong = found.filter((a) => a.length >= captures[1].length * 0.9);
      assert.deepEqual(captureLong.map((a) => a.path), ['results.ir.samples'], what);
    }
  });

test('the store refuses a record that carries raw samples (validation rejects the field)',
  async () => {
    const io = syntheticIo();
    const result = await createMeasurementEngine({ io }).measure(recipe(), { keepRaw: true });
    const e = experimentFromResult(result, { now: NOW, id: 'raw-retention-import' });
    const json = JSON.parse(experimentToJson(e));
    assert.equal(validateExperiment(json).ok, true, 'the record as saved is valid');
    const raw = encodeArray(result.runs[0].raw);
    const inRun = structuredClone(json);
    inRun.measurement.runs[0].raw = raw;
    const inResults = structuredClone(json);
    inResults.results.raw = raw;
    for (const [where, doc] of [['measurement.runs[0]', inRun], ['results', inResults]]) {
      const v = validateExperiment(doc);
      assert.equal(v.ok, false, `${where}.raw is refused`);
      assert.ok(v.errors.some((x) => /raw/.test(x.path)), JSON.stringify(v.errors));
    }
  });

// ------------------------------------------------------------------ what the stored IR carries

function correlation(a, b) {
  let ab = 0;
  let aa = 0;
  let bb = 0;
  for (let i = 0; i < a.length; i++) { ab += a[i] * b[i]; aa += a[i] * a[i]; bb += b[i] * b[i]; }
  return ab / Math.sqrt(aa * bb);
}

/** Capture minus the system part, as rebuilt from the STORED IR and the stimulus, on `span`. */
async function voiceFromStoredIr(span) {
  const gain = 0.3;
  const io = syntheticIo({ gain, voice: span });
  const engine = createMeasurementEngine({ io });
  const rec = recipe({ repeats: 1 });
  const result = await engine.measure(rec, { keepRaw: true });
  assert.equal(result.state, 'COMPLETE');
  const e = experimentFromResult(result, { now: NOW, id: 'raw-retention-ir' });
  const stored = validateExperiment(JSON.parse(experimentToJson(e)));
  assert.equal(stored.ok, true);
  const ir = stored.experiment.results.ir;
  const { renderStimulus } = await import('../../src/js/measurement/stimulus.js');
  const x = renderStimulus({ ...rec.stimulus, sampleRate: SR }).samples;
  const pre = Math.round(rec.analysis.preRollS * SR);
  const start = Math.round(ir.captureOffsetS * SR);
  const h = ir.samples;
  const got = [];
  const want = [];
  // Every 4th sample of the span is enough for a correlation and keeps the test fast.
  for (let n = span.from; n < span.from + span.frames; n += 4) {
    let y = 0;
    const kLo = Math.max(0, n - start - x.length + 1);
    const kHi = Math.min(h.length - 1, n - start);
    for (let k = kLo; k <= kHi; k++) y += h[k] * x[n - start - k];
    const sys = n - pre >= 0 && n - pre < x.length ? gain * x[n - pre] : 0;
    got.push(y - sys);
    want.push(voiceAt(n));
  }
  return correlation(got, want);
}

test('the stored IR carries sound picked up after the sweep, not before it (ADR 0049)',
  async () => {
    // Capture frames: pre-roll 0.25 s (12 000), sweep 1 s (48 000), post-roll 0.5 s (24 000).
    const after = await voiceFromStoredIr({ from: 12000 + 48000 + 2400, frames: 12000 });
    assert.ok(after > 0.99, `a voice in the post-roll is rebuilt from the stored IR (r ${after})`);
    const before = await voiceFromStoredIr({ from: 0, frames: 9600 });
    assert.ok(Math.abs(before) < 0.1, `a voice before the sweep is not in it (r ${before})`);
  });

// ------------------------------------------------------------------ where the product says it

test('the product states the policy where a run is saved, in About and in the README', () => {
  const html = read('src/index.html');
  const hint = html.match(/data-osc="measure\.retention"[^>]*>([\s\S]*?)<\/p>/);
  assert.ok(hint, 'the MEASURE Experiment panel carries the retention hint');
  const text = hint[1].replace(/\s+/g, ' ');
  assert.match(text, /discarded/);
  assert.match(text, /never stored or exported/);
  assert.match(text, /impulse response/);
  const about = html.match(/data-osc="about\.privacy"[\s\S]*?<\/li>/);
  assert.ok(about, 'About states it');
  assert.match(about[0].replace(/\s+/g, ' '), /recording is discarded/);
  const readme = read('README.md');
  const privacy = readme.slice(readme.indexOf('## Privacy'), readme.indexOf('## Licences'));
  assert.match(privacy, /0049-raw-capture-retention\.md/);
  assert.match(privacy.replace(/\s+/g, ' '), /impulse response/);
});

// The engine's captures are not the only raw PCM of MEASURE: the level-calibration reference
// capture (ui/measure.js captureReference, REFERENCE_CAPTURE_S through io.captureNoise) and the
// setup check's level window (capture.js PREFLIGHT_LEVEL_S) record through the same io, outside
// the engine. Both are locals reduced to a level reading; the policy has to name them.
test('the policy names every raw capture of MEASURE, the reference capture included', () => {
  const flat = (t) => t.replace(/\s+/g, ' ');
  const readme = read('README.md');
  const privacy = flat(readme.slice(readme.indexOf('## Privacy'), readme.indexOf('## Licences')));
  assert.match(privacy, new RegExp('opens only for the setup check, a measurement, '
    + 'a level-calibration reference capture or the live RTA'));
  assert.match(privacy, /reference capture[^.]*keeps? only[^.]*level reading/);
  const adr = flat(read('.ai/repo/adrs/0049-raw-capture-retention.md'));
  assert.match(adr, /reference capture/, 'ADR 0049 names the reference capture');
  assert.match(adr, /0\.3 s level window/, 'ADR 0049 names the setup check level window');
  const html = read('src/index.html');
  const hint = html.match(/data-osc="levelCal\.retention"[^>]*>([\s\S]*?)<\/p>/);
  assert.ok(hint, 'the level calibration dialog says what happens to the reference capture');
  assert.match(flat(hint[1]), /discarded/);
  assert.match(flat(hint[1]), /only the level reading/);
  // The code the sentence describes: the capture is a local of captureReference.
  const ui = read('src/js/ui/measure.js');
  assert.match(ui, /const cap = await io\.captureNoise\(REFERENCE_CAPTURE_S, \{\}\);/);
  assert.doesNotMatch(ui, /ctx\.reference = \{[^}]*\bcap\b[,\s}]/,
    'ctx.reference keeps the reading and the input facts, not the capture');
});
