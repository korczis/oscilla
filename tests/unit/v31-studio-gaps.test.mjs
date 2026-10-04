// V3.1 Studio gaps the evidence audit recorded (plan V413, V424, V425, V427, V428):
//   V413  nothing selected → the Inspector shows the transport and document settings, edited
//         through the store (inspector.js studioSettingsView, settingsAction)
//   V424  measurement clips reach the MeasurementEngine (studio/measurement-run.js, the
//         transport's onMeasurement hook): one pass = one measurement of the derived recipe,
//         handed off on the audio clock; a real MeasurementEngine on a synthetic io runs it
//   V425  the saved experiment carries the Studio provenance block (withStudioProvenance) and
//         verifies (validateExperiment, verifyExperimentStudio)
//   V427  renderStudioOffline progress and abort (studio/offline.js) and the workspace's render
//         helpers (renderTaskView, renderFileName)
//   V428  graph search (graph-search.js searchNodes) and its `/` shortcut in the one table
// Spec §78, §105-§110, §145, §250-§251. Real browsers: tests/browser/v31-studio-workflows.cjs.
//   node --test tests/unit/v31-studio-gaps.test.mjs
//
// Tolerances: none; the synthetic system is a pure gain and delay, so the engine's analysis is
// asserted only as COMPLETE (its accuracy is tests/unit/v3-*.test.mjs's subject).

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  TIME_MODE_CHOICES, inspectorView, settingsAction, studioSettingsView,
} from '../../src/js/ui/studio/inspector.js';
import {
  SEARCH_LIMIT, searchAnnouncement, searchNodes,
} from '../../src/js/ui/studio/graph-search.js';
import { STUDIO_SHORTCUTS, resolveStudioKey } from '../../src/js/ui/studio/graph-keys.js';
import {
  IDLE_TASK, renderFileName, renderTaskView, studioExperimentName,
} from '../../src/js/ui/studio/workspace.js';
import {
  HANDOFF_NOW_S, MEASUREMENT_RUN_TEXT, createStudioMeasurementRun,
} from '../../src/js/studio/measurement-run.js';
import * as measurementRun from '../../src/js/studio/measurement-run.js';
import { recipeFromStudio, verifyExperimentStudio, withStudioProvenance } from
  '../../src/js/studio/provenance.js';
import { OFFLINE_TEXT, PROGRESS_STEPS, renderStudioOffline } from '../../src/js/studio/offline.js';
import { EMPTY_SELECTION, createIdGenerator, createStudioStore } from
  '../../src/js/studio/actions.js';
import {
  MEASUREMENT_TEMPLATE_ID, REFERENCE_TEMPLATE_ID, templateModel,
} from '../../src/js/studio/templates/index.js';
import { NODE_REGISTRY } from '../../src/js/studio/registry.js';
import { normalizeStudio, studioHash, TEMPO_RANGE } from '../../src/js/studio/schema.js';
import { timelineEnd } from '../../src/js/studio/timeline.js';
import { createMeasurementEngine, assessMeasurement } from '../../src/js/measurement/engine.js';
import { experimentFromResult } from '../../src/js/ui/measure-experiment.js';
import { experimentToJson } from '../../src/js/experiments/schema.js';
import { validateExperiment } from '../../src/js/experiments/validate.js';
import { configHash } from '../../src/js/experiments/hash.js';
import { KNOWN_ALGORITHM_IDS } from '../../src/js/measurement/algorithms.js';
import { StudioFakeContext, fakeTimers } from './sequencer-fake-audio.mjs';
import { buildLargeStudio } from './fixtures/v31-large-studio.mjs';

const SR = 48000;
const synth = () => templateModel(REFERENCE_TEMPLATE_ID);
const storeOf = (m) => createStudioStore(m, { idGenerator: createIdGenerator(m) });
const flush = () => new Promise((r) => setImmediate(r));

// ---------------------------------------------------------------- V413 transport Inspector

test('V413 nothing selected: the Inspector shows the transport and document settings (§78)',
  () => {
    const m = synth();
    const v = inspectorView(m, EMPTY_SELECTION);
    assert.equal(v.kind, 'studio');
    const st = v.settings;
    assert.deepEqual(st, studioSettingsView(m));
    assert.equal(st.timeMode, 'seconds');
    assert.equal(st.tempo, 120);
    assert.deepEqual([st.beats, st.unit, st.signatureText], [4, 4, '4/4']);
    assert.deepEqual(st.tempoRange, [...TEMPO_RANGE]);
    assert.deepEqual(st.timeModes.map((c) => c.value), TIME_MODE_CHOICES.map((c) => c.value));
    assert.deepEqual(st.loop, { ...m.timeline.loop });
    assert.equal(st.length, timelineEnd(m));
    assert.equal(st.lengthText, `${timelineEnd(m).toFixed(3)} s`);
    assert.equal(st.notes, m.metadata.notes);
    // An empty timeline says so; musical mode also gives the length in bars at the tempo.
    assert.equal(studioSettingsView(normalizeStudio({})).lengthText, 'Empty timeline');
    const musical = { ...m, transport: { ...m.transport, timeMode: 'musical' } };
    const bars = timelineEnd(m) / (4 * 60 / 120);
    assert.equal(studioSettingsView(musical).lengthText,
      `${timelineEnd(m).toFixed(3)} s · ${Number(bars.toFixed(2))} bars`);
  });

test('V413 settings edits are store actions: tempo, signature, mode, loop, notes; undoable', () => {
  const store = storeOf(synth());
  const before = store.getModel();
  const apply = (key, raw) => {
    const a = settingsAction(store.getModel(), key, raw);
    assert.ok(!a.error, a.error);
    const r = store.dispatch(a);
    assert.ok(r.ok, r.reason);
    return r;
  };
  assert.equal(apply('tempo', ' 96 ').label, 'Change tempo');
  assert.equal(store.getModel().transport.tempo, 96);
  apply('beats', '3');
  apply('unit', '8');
  assert.deepEqual(store.getModel().transport.timeSignature, [3, 8]);
  apply('timeMode', 'musical');
  assert.equal(store.getModel().transport.timeMode, 'musical');
  apply('loopStart', '0.5');
  apply('loopEnd', '1,5');
  apply('loop', true);
  assert.deepEqual(store.getModel().timeline.loop, { enabled: true, start: 0.5, end: 1.5 });
  apply('notes', 'Desk speaker, 1 m');
  assert.equal(store.getModel().metadata.notes, 'Desk speaker, 1 m');
  assert.equal(inspectorView(store.getModel(), EMPTY_SELECTION).settings.signatureText, '3/8');
  // Each edit is one history entry: undo all restores the template by reference.
  while (store.canUndo()) store.undo();
  assert.equal(store.getModel(), before);
  // Refusals carry a sentence and never reach the store.
  const m = store.getModel();
  assert.match(settingsAction(m, 'tempo', '5').error, /^Tempo must be \d+-\d+ BPM\.$/);
  assert.match(settingsAction(m, 'tempo', 'fast').error, /Tempo/);
  assert.match(settingsAction(m, 'beats', '2.5').error, /whole number/);
  assert.match(settingsAction(m, 'beats', '0').error, /whole number/);
  assert.match(settingsAction(m, 'unit', '3').error, /beat unit/);
  assert.match(settingsAction(m, 'loopEnd', String(m.timeline.loop.start)).error,
    /after its start/);
  assert.match(settingsAction(m, 'loopStart', '-1').error, /0 s or later/);
  assert.match(settingsAction(m, 'timeMode', 'frames').error, /time mode/);
  assert.match(settingsAction(m, 'notes', 'x'.repeat(10001)).error, /at most 10000/);
  assert.match(settingsAction(m, 'colour', 'red').error, /Unknown Studio setting/);
  // Settings are execution state where they schedule (tempo) and presentation where not.
  const tempo = storeOf(synth());
  tempo.dispatch(settingsAction(tempo.getModel(), 'tempo', '90'));
  assert.notEqual(studioHash(tempo.getModel()), studioHash(synth()));
  const notes = storeOf(synth());
  notes.dispatch(settingsAction(notes.getModel(), 'notes', 'only words'));
  assert.equal(studioHash(notes.getModel()), studioHash(synth()), 'notes never enter the hash');
});

// ---------------------------------------------------------------- V428 graph search

test('V428 searchNodes: name, type, alias and category; best match first, AND terms (§251)',
  () => {
    const m = synth();
    const ids = (q) => searchNodes(m, q).items.map((i) => i.id);
    assert.deepEqual(ids(''), m.graph.nodes.map((n) => n.id), 'empty: every node, model order');
    assert.equal(ids('filter')[0], 'filter-1');
    assert.equal(ids('FILTER 1')[0], 'filter-1');
    assert.deepEqual(ids('lfo'), ['lfo-1']);
    const alias = NODE_REGISTRY.get('filter').aliases[0];
    assert.ok(ids(alias).includes('filter-1'), `alias ${alias}`);
    assert.ok(ids('modulation').includes('lfo-1'), 'category');
    assert.ok(ids('osc').includes('osc-1'), 'type id');
    assert.deepEqual(ids('master output'), ['master-1'], 'every term must match');
    assert.deepEqual(ids('zzz'), []);
    const hit = searchNodes(m, 'filter').items[0];
    assert.deepEqual(Object.keys(hit), ['id', 'name', 'type', 'typeLabel', 'categoryLabel',
      'text', 'rank']);
    assert.equal(hit.text, 'Filter 1 · Filter');
    // A renamed node is found by its new name first, accents folded.
    const store = storeOf(m);
    store.dispatch({ type: 'NODE_RENAME', nodeId: 'osc-1', name: 'Ébène lead' });
    const r = searchNodes(store.getModel(), 'ebe');
    assert.equal(r.items[0].id, 'osc-1');
    assert.equal(r.items[0].rank, 1, 'name prefix');
    assert.equal(searchNodes(store.getModel(), 'lead').items[0].rank, 2, 'a word of the name');
    assert.equal(searchAnnouncement(searchNodes(m, 'zzz')), 'No node matches “zzz”.');
    assert.equal(searchAnnouncement(searchNodes(m, 'lfo')), '1 node matches.');
    assert.equal(searchAnnouncement(searchNodes(normalizeStudio({}), '')), 'The graph is empty.');
  });

test('V428 a 100-node graph lists at most SEARCH_LIMIT results and counts the rest (§250)',
  () => {
    const store = storeOf(normalizeStudio({}));
    buildLargeStudio(store);
    const r = searchNodes(store.getModel(), '');
    assert.equal(r.total, 100);
    assert.equal(r.items.length, SEARCH_LIMIT);
    assert.match(searchAnnouncement(r), /^100 nodes match, the first 50 listed\.$/);
    const f = searchNodes(store.getModel(), 'filter 12');
    assert.equal(f.items[0].id, 'filter-12');
  });

test('V428 `/` opens Find in the one shortcut table, on any layout (§224)', () => {
  assert.deepEqual(resolveStudioKey({ key: '/' }), { id: 'find' });
  assert.deepEqual(resolveStudioKey({ key: '/', shiftKey: true }), { id: 'find' },
    'Shift+7 types / on German and Czech layouts');
  assert.equal(resolveStudioKey({ key: '/', ctrlKey: true }), null, 'browser chords untouched');
  const row = STUDIO_SHORTCUTS.find((s) => s.id === 'find');
  assert.deepEqual({ ...row }, { id: 'find', keys: '/',
    text: 'Find a node by name or type and frame it' });
  assert.equal(new Set(STUDIO_SHORTCUTS.map((s) => s.id)).size, STUDIO_SHORTCUTS.length);
});

// ---------------------------------------------------------------- V424 / V425 measurement

/** A synthetic io (engine.js io contract): a pure gain and delay, a simulated audio clock. */
function syntheticIo({ gain = 0.5, delay = 48 } = {}) {
  let t = 1;
  const tc = { kind: 'synthetic', label: 'TEST CONTEXT: synthetic digital system (unit test)' };
  const device = { label: null, id: null };
  const constraints = { requested: null, applied: null };
  return {
    sampleRate: SR,
    now: () => t,
    async preflight() {
      return { audioContext: { available: true, state: 'running' }, sampleRate: SR,
        permission: 'not-required', input: { ok: true, device, constraints },
        inputLevel: { peak: 0.0005, rmsDb: -72 }, output: { gain: 0.08, maxGain: 0.25,
          audibleVoices: 0 }, worklet: { supported: true, mode: 'audioworklet' },
        testContext: tc };
    },
    async captureNoise(seconds, { notBefore } = {}) {
      const startedAt = Math.max(t + 0.1, notBefore ?? -Infinity);
      t = startedAt + seconds;
      const n = Math.round(seconds * SR);
      const samples = new Float32Array(n);
      for (let i = 0; i < n; i++) samples[i] = 1e-4 * Math.sin(i * 0.37);
      return { sampleRate: SR, samples, preRoll: 0, postRoll: 0, startedAt, constraints, device,
        testContext: tc };
    },
    async runStimulus(stimulus, { preRollS, postRollS, notBefore, onScheduled }) {
      const pre = Math.round(preRollS * SR);
      const x = stimulus.samples;
      const frames = pre + x.length + Math.round(postRollS * SR);
      const samples = new Float32Array(frames);
      for (let i = 0; i < frames; i++) samples[i] = 1e-4 * Math.sin(i * 0.37);
      for (let i = 0; i + delay < x.length + Math.round(postRollS * SR) && i < x.length; i++) {
        samples[pre + i + delay] += gain * x[i];
      }
      const startedAt = Math.max(t + 0.1, notBefore ?? -Infinity);
      const times = { captureStartAt: startedAt, stimulusStartAt: startedAt + preRollS,
        stimulusEndAt: startedAt + preRollS + x.length / SR,
        captureEndAt: startedAt + frames / SR };
      if (onScheduled) onScheduled(times);
      t = times.captureEndAt;
      return { sampleRate: SR, samples, preRoll: preRollS, postRoll: postRollS, startedAt,
        stimulusStartAt: times.stimulusStartAt, constraints, device, testContext: tc };
    },
    cancel() {},
    dispose() {},
  };
}

/** A short Measurement Sweep (1 s sweep, short phases) through the store. */
function shortMeasurementModel() {
  const store = storeOf(templateModel(MEASUREMENT_TEMPLATE_ID));
  const ok = (a) => assert.ok(store.dispatch(a).ok, JSON.stringify(a));
  ok({ type: 'NODE_PARAM_SET', nodeId: 'sweep-1', key: 'duration', value: 1 });
  ok({ type: 'CLIP_RESIZE', clipId: 'clip-1', duration: 0.25 });
  ok({ type: 'CLIP_RESIZE', clipId: 'clip-3', duration: 1 });
  return store.getModel();
}

/** The transport's measurement events of one pass, as transport.js measurementData emits them. */
const scheduleEvent = (model, clipId, startTime, pass = 0) => {
  const c = model.timeline.clips.find((x) => x.id === clipId);
  return { type: 'schedule', key: `${clipId}:${pass}`, clipId, action: c.payload.action,
    target: c.target, trackId: c.trackId, pass, position: c.start, startTime,
    endTime: startTime + c.duration, duration: c.duration, truncated: false };
};

function harness({ model = shortMeasurementModel(), clock = 10, run = null } = {}) {
  const timers = fakeTimers();
  const log = [];
  const views = [];
  const h = {
    model,
    timers,
    log,
    views,
    clock,
    runner: null,
  };
  h.runner = createStudioMeasurementRun({
    getModel: () => h.model,
    sampleRate: () => SR,
    now: () => h.clock,
    timers,
    stopStudio: async () => { log.push('stop'); },
    run: run || (async (recipe, m) => {
      log.push(['run', recipe, m]);
      return { ok: true, state: 'COMPLETE', experimentId: 'e-1', name: 'Measurement Sweep' };
    }),
    onChange: (v) => views.push(v.state),
  });
  return h;
}

test('V424 the first measurement clip of a pass hands the derived recipe to the engine',
  async () => {
  const h = harness();
  const expected = recipeFromStudio(h.model, { sampleRate: SR });
  assert.ok(expected.ok);
  h.runner.hook(scheduleEvent(h.model, 'clip-1', h.clock + 0.02));
  assert.equal(h.runner.view.state, 'pending');
  assert.ok(0.02 <= HANDOFF_NOW_S, 'due within the hand-off window: a microtask, no timer');
  assert.equal(h.timers.size, 0);
  // The rest of the pass joins the same measurement; nothing is measured twice.
  h.runner.hook(scheduleEvent(h.model, 'clip-2', h.clock + 0.27));
  h.runner.hook(scheduleEvent(h.model, 'clip-6', h.clock + 0.27));
  await flush();
  await flush();
  assert.deepEqual(h.log.map((x) => (Array.isArray(x) ? x[0] : x)), ['stop', 'run'],
    'the Studio releases its output first');
  assert.deepEqual(h.log[1][1], expected.recipe, 'recipe derived from the topology (§110)');
  assert.equal(h.log[1][2], h.model, 'the model that ran (provenance)');
  assert.deepEqual(h.views, ['pending', 'running', 'done']);
  assert.equal(h.runner.view.text, MEASUREMENT_RUN_TEXT.saved('Measurement Sweep'));
  assert.equal(h.runner.view.experimentId, 'e-1');
  // The hand-off's own STOP is ignored; a later pass of the same PLAY does not measure again
  // while the run is in progress, and a new PLAY (after STOP) may.
  h.runner.hook({ type: 'stop', at: h.clock });
  assert.equal(h.runner.view.state, 'done');
  assert.ok(h.runner.reset());
  h.runner.hook(scheduleEvent(h.model, 'clip-1', h.clock));
  await flush();
  await flush();
  assert.equal(h.log.filter((x) => Array.isArray(x)).length, 2);
});

test('V424 a later clip is handed off on the audio clock; STOP or cancel before disarms it',
  async () => {
    const h = harness();
    h.runner.hook(scheduleEvent(h.model, 'clip-1', h.clock + 0.75));
    assert.equal(h.runner.view.state, 'pending');
    assert.equal(h.timers.size, 1, 'a bookkeeping timer HANDOFF_LEAD_S before the clip start');
    h.timers.runUntil(Math.round((0.75 - measurementRun.HANDOFF_LEAD_S) * 1000) - 1);
    assert.equal(h.log.length, 0, 'not before the hand-off lead');
    h.timers.runUntil(Math.round((0.75 - measurementRun.HANDOFF_LEAD_S) * 1000));
    await flush();
    await flush();
    assert.deepEqual(h.log.map((x) => (Array.isArray(x) ? x[0] : x)), ['stop', 'run']);

    const s = harness();
    s.runner.hook(scheduleEvent(s.model, 'clip-1', s.clock + 2));
    s.runner.hook({ type: 'stop', at: s.clock });
    assert.equal(s.runner.view.state, 'idle');
    assert.equal(s.timers.size, 0);
    s.timers.runUntil(5000);
    await flush();
    assert.deepEqual(s.log, [], 'STOP before the first clip: nothing measured');

    const c = harness();
    c.runner.hook(scheduleEvent(c.model, 'clip-1', c.clock + 2));
    c.runner.hook({ type: 'cancel', key: 'clip-1:0', clipId: 'clip-1' });
    assert.equal(c.runner.view.state, 'idle', 'the only clip of the pass removed');
    assert.equal(c.runner.abort(), false, 'nothing pending any more');
    const u = harness();
    u.runner.hook(scheduleEvent(u.model, 'clip-1', u.clock + 2));
    assert.equal(u.runner.abort('user'), true);
    assert.equal(u.runner.view.text, MEASUREMENT_RUN_TEXT.aborted);
  });

test('V424 a topology that cannot be measured is refused with its reason, nothing runs',
  async () => {
    const h = harness({ model: templateModel('basic-tone') });
    h.runner.hook({ type: 'schedule', key: 'x:0', clipId: 'x', pass: 0, startTime: 10 });
    await flush();
    assert.equal(h.runner.view.state, 'failed');
    assert.equal(h.runner.view.text, MEASUREMENT_RUN_TEXT.refused('The Studio has no Transfer '
      + 'Analyzer.'));
    assert.deepEqual(h.log, []);
    const a = harness({ run: async () => ({ ok: false, state: 'ABORTED' }) });
    a.runner.hook(scheduleEvent(a.model, 'clip-1', a.clock));
    await flush();
    await flush();
    assert.equal(a.runner.view.text, MEASUREMENT_RUN_TEXT.aborted);
    const f = harness({ run: async () => ({ ok: false, state: 'INVALID', reason: 'Clipped.' }) });
    f.runner.hook(scheduleEvent(f.model, 'clip-1', f.clock));
    await flush();
    await flush();
    assert.equal(f.runner.view.text, MEASUREMENT_RUN_TEXT.failed('Clipped.'));
  });

test('V424/V425 the MeasurementEngine runs the clip pass; the experiment carries the Studio',
  async () => {
    const model = shortMeasurementModel();
    let saved = null;
    let engineHistory = null;
    const run = async (recipe, m) => {
      // What measure.js measureRunRecipe does: the engine's measure() of THIS recipe, then
      // experimentFromResult, decorated by the workspace (name + withStudioProvenance).
      const engine = createMeasurementEngine({ io: syntheticIo(), assess: assessMeasurement,
        clock: { wall: () => Date.parse('2026-10-03T08:00:00.000Z'), mono: () => 0 } });
      const result = await engine.measure(JSON.parse(JSON.stringify(recipe)));
      engineHistory = engine.history.map((x) => x.to);
      if (result.state !== 'COMPLETE') return { ok: false, state: result.state };
      const e = experimentFromResult(result, { now: '2026-10-03T08:00:00.000Z',
        id: 'studio-e-1', build: { version: '9.8.7', commit: null } });
      saved = withStudioProvenance({ ...e, name: studioExperimentName(e, m) }, m);
      return { ok: true, state: result.state, experimentId: saved.id, name: saved.name };
    };
    const h = harness({ model, run });
    h.runner.hook(scheduleEvent(model, 'clip-1', h.clock));
    for (let i = 0; i < 20 && h.runner.view.state !== 'done'; i++) await flush();
    assert.equal(h.runner.view.state, 'done', h.runner.view.text);
    // The engine's own state machine ran the phases the clips describe (§108).
    assert.deepEqual(engineHistory, ['PREFLIGHT', 'NOISE_CHECK', 'READY', 'ARMED', 'MEASURING',
      'ANALYZING', 'COMPLETE']);
    // §109-§110: the recipe is the derived one, the Studio block is beside it and verifies.
    const derived = recipeFromStudio(model, { sampleRate: SR }).recipe;
    assert.deepEqual(saved.recipe.stimulus, derived.stimulus);
    assert.deepEqual(saved.recipe.analysis, derived.analysis);
    assert.equal(saved.name, 'Measurement Sweep (Studio)');
    assert.equal(saved.studio.studioHash, studioHash(model));
    const { studio, ...plain } = saved;
    assert.ok(studio);
    assert.equal(configHash(saved), configHash(plain), 'Studio never enters configHash');
    const v = validateExperiment(experimentToJson(saved), { knownAlgorithms: KNOWN_ALGORITHM_IDS });
    assert.ok(v.ok, JSON.stringify(v.errors));
    const check = verifyExperimentStudio(v.experiment);
    assert.ok(check.ok, check.errors.join());
  });

test('V431 R1 the measurement starts on the clip\'s audio-clock time, not when a timer fires',
  async () => {
    // The hand-off passes the clip's startTime (startAt) and comes HANDOFF_LEAD_S before it.
    let opts = null;
    const h = harness({ run: async (recipe, m, o) => {
      opts = o;
      return { ok: true, state: 'COMPLETE', experimentId: 'e-1', name: 'Measurement Sweep' };
    } });
    h.runner.hook(scheduleEvent(h.model, 'clip-1', h.clock + 2));
    h.timers.runUntil(Math.round((2 - measurementRun.HANDOFF_LEAD_S) * 1000));
    await flush();
    await flush();
    assert.deepEqual(opts, { startAt: h.clock + 2 }, 'the clip\'s audio-clock start is passed');
    // The engine schedules its first capture there: the noise check, or the first run.
    const firstCapture = async (noiseCheckS) => {
      const recipe = JSON.parse(JSON.stringify(recipeFromStudio(h.model, { sampleRate: SR })
        .recipe));
      recipe.analysis.noiseCheckS = noiseCheckS;
      const io = syntheticIo();
      const starts = [];
      for (const k of ['captureNoise', 'runStimulus']) {
        const fn = io[k];
        io[k] = async (...a) => {
          const cap = await fn(...a);
          starts.push(cap.startedAt);
          return cap;
        };
      }
      const engine = createMeasurementEngine({ io, assess: assessMeasurement,
        clock: { wall: () => 0, mono: () => 0 } });
      const r = await engine.measure(recipe, { startAt: 50 });
      return { state: r.state, starts };
    };
    for (const noise of [0.25, 0]) {
      const { state, starts } = await firstCapture(noise);
      assert.equal(state, 'COMPLETE');
      assert.equal(starts[0], 50, `first capture at the anchor (noise check ${noise} s)`);
    }
  });

test('V425 the experiment name: the typed MEASURE name, else the Studio title', () => {
  const m = templateModel(MEASUREMENT_TEMPLATE_ID);
  assert.equal(studioExperimentName({ name: 'Desk speaker' }, m), 'Desk speaker');
  assert.equal(studioExperimentName({ name: 'TEST CONTEXT · digital loopback' }, m),
    'Measurement Sweep (Studio)');
  assert.equal(studioExperimentName({ name: 'Playback / capture chain' }, m),
    'Measurement Sweep (Studio)');
});

// ---------------------------------------------------------------- V427 render WAV

/** A fake OfflineAudioContext; `gate` holds startRendering until released (abort tests). */
function fakeOffline({ made, suspend = true, gate = null }) {
  return class extends StudioFakeContext {
    constructor({ numberOfChannels, length, sampleRate }) {
      super({ sampleRate, state: 'suspended' });
      this.numberOfChannels = numberOfChannels;
      this.length = length;
      this.suspends = [];
      if (!suspend) this.suspend = undefined;
      made.push(this);
    }

    suspend(t) {
      if (this.suspends.some((s) => s.t === t)) throw new Error('duplicate suspend time');
      return new Promise((resolve) => this.suspends.push({ t, resolve }));
    }

    async startRendering() {
      if (gate) await gate;
      for (const s of [...this.suspends].sort((a, b) => a.t - b.t)) {
        s.resolve();
        await flush();
      }
      return this.createBuffer(this.numberOfChannels, this.length, this.sampleRate);
    }
  };
}

test('V427 render progress: suspend points on whole render quanta, monotonic, then encode',
  async () => {
    const made = [];
    const seen = [];
    const r = await renderStudioOffline(templateModel('basic-tone'), { duration: 1,
      sampleRate: SR, wav: true, OfflineAudioContext: fakeOffline({ made }),
      onProgress: (p) => seen.push(p) });
    assert.ok(r.ok, JSON.stringify(r.errors));
    const ctx = made[0];
    assert.equal(ctx.suspends.length, PROGRESS_STEPS - 1);
    for (const s of ctx.suspends) {
      const frames = s.t * SR;
      assert.ok(Math.abs(frames / 128 - Math.round(frames / 128)) < 1e-6, `quantum ${s.t}`);
      assert.ok(s.t > 0 && s.t < 1);
    }
    const render = seen.filter((p) => p.stage === 'render').map((p) => p.fraction);
    assert.equal(render[0], 0);
    assert.equal(render.at(-1), 1);
    assert.equal(render.length, PROGRESS_STEPS + 1);
    for (let i = 1; i < render.length; i++) assert.ok(render[i] > render[i - 1]);
    assert.deepEqual(seen.at(-1), { stage: 'encode', fraction: 1 });
    assert.ok(r.wav instanceof ArrayBuffer);
    // Without OfflineAudioContext.suspend (Firefox): start and end only.
    const plain = [];
    const p2 = await renderStudioOffline(templateModel('basic-tone'), { duration: 1,
      sampleRate: SR, OfflineAudioContext: fakeOffline({ made: [], suspend: false }),
      onProgress: (p) => plain.push(p.fraction) });
    assert.ok(p2.ok);
    assert.deepEqual(plain, [0, 1]);
  });

test('V427 abort: the call resolves at once, nothing is returned, the context is dropped',
  async () => {
    const before = new AbortController();
    before.abort();
    const made = [];
    const r0 = await renderStudioOffline(templateModel('basic-tone'), { duration: 1,
      sampleRate: SR, signal: before.signal, OfflineAudioContext: fakeOffline({ made }) });
    assert.deepEqual([r0.ok, r0.aborted, r0.errors], [false, true, [OFFLINE_TEXT.aborted]]);
    assert.equal(made.length, 0, 'aborted before: no context is made');

    let release;
    const gate = new Promise((res) => { release = res; });
    const ac = new AbortController();
    const fractions = [];
    const pending = renderStudioOffline(templateModel('basic-tone'), { duration: 1,
      sampleRate: SR, wav: true, signal: ac.signal, onProgress: (p) => fractions.push(p),
      OfflineAudioContext: fakeOffline({ made, gate }) });
    await flush();
    ac.abort();
    const r = await pending;
    assert.equal(r.ok, false);
    assert.equal(r.aborted, true);
    assert.equal(r.buffer, undefined);
    assert.equal(r.wav, undefined);
    release();
    await flush();
    await flush();
    assert.deepEqual(fractions, [{ stage: 'render', fraction: 0 }],
      'no progress is reported after the abort');
    // A refused plan (live Microphone) is refused before any context exists.
    const refused = await renderStudioOffline(templateModel(MEASUREMENT_TEMPLATE_ID), {
      OfflineAudioContext: fakeOffline({ made }) });
    assert.equal(refused.ok, false);
    assert.equal(refused.aborted, undefined);
    assert.ok(refused.limitations.some((t) => /live input/.test(t)));
  });

test('V427 the workspace render helpers: task view and file name', () => {
  assert.deepEqual(renderTaskView({ stage: 'render', fraction: 0.456 }), { active: true,
    kind: 'render', label: 'Rendering WAV', pct: 46, text: '46 %', abortable: true });
  assert.deepEqual(renderTaskView({ stage: 'encode', fraction: 1 }).label, 'Encoding WAV');
  assert.equal(renderTaskView({ stage: 'render', fraction: 7 }).pct, 100);
  assert.equal(renderTaskView(null).pct, 0);
  assert.equal(IDLE_TASK.active, false);
  assert.equal(renderFileName(templateModel(REFERENCE_TEMPLATE_ID)), 'subtractive-synth.wav');
});
