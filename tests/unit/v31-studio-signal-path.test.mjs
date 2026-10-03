// V3.1 Studio: the Playground's Signal Path renders from a Studio graph (plan V421, spec §1, §9,
// §127-§128, §164-§165; rule project.studio-model-is-canonical; docs/v31/signal-path.md).
//   - the Playground voice as a StudioModel (studio/playground-voice.js) is a valid, plain-data
//     model whose topology is the voice the engine builds (AM gain stage, modulation edges with
//     the sounding centre, automation lanes for steps and ramps, dual mixer / panners / router)
//   - its Signal Path projection (studio/signal-path-projection.js) draws exactly the stages the
//     pre-V421 derivation drew, over a matrix of sources, patterns, waveforms and lab stages
//     (tests/unit/fixtures/signal-path-oracle.mjs is that derivation, frozen as evidence)
//   - the bridge's pathNodes, which the canvas draws, IS that projection; no second derivation
//     is left in src/
//   - the projection is generic: every template, a noise source and a microphone project
//     without error and follow the same signal path the screen-reader summary reads
//   node --test tests/unit/v31-studio-signal-path.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildPlan } from '../../src/js/audio/patterns.js';
import { defaultInstrumentState } from '../../src/js/core/config.js';
import { formatFrequency, formatMs } from '../../src/js/core/frequency.js';
import { playgroundVoiceModel, PLAYGROUND_VOICE_IDS as ID }
  from '../../src/js/studio/playground-voice.js';
import { projectSignalPath, signalInputs } from '../../src/js/studio/signal-path-projection.js';
import { assertPlainData } from '../../src/js/studio/schema.js';
import { validateStudioModel } from '../../src/js/studio/validate.js';
import { summarizeGraph } from '../../src/js/studio/a11y.js';
import { STUDIO_TEMPLATES, templateModel } from '../../src/js/studio/templates/index.js';
import { createStudioModel } from '../../src/js/studio/schema.js';
import { VisualizationBridge } from '../../src/js/visualization/visualization-bridge.js';
import { legacyPathNodes } from './fixtures/signal-path-oracle.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const ENV = { safeMax: 22800, continuous: true };
const BASE = defaultInstrumentState();

// ---------------------------------------------------------------- configurations

/** A Playground configuration: the instrument state with `over` applied (one level deep). */
function cfg(over = {}) {
  return { ...BASE, ...over, pp: { ...BASE.pp, ...(over.pp || {}) },
    sweep: { ...BASE.sweep, ...(over.sweep || {}) }, dual: { ...BASE.dual, ...(over.dual || {}) } };
}

const SOURCES = [
  ...['tone', 'finite', 'pulse', 'burst', 'sweepUp', 'sweepDown', 'pingpong', 'chirp', 'siren',
    'alternating', 'wobble', 'am', 'fm', 'random', 'octave', 'sequence']
    .map((p) => [`single:${p}`, cfg({ source: 'single', pattern: p })]),
  ['single:am-35.5%', cfg({ source: 'single', pattern: 'am',
    pp: { am: { depth: 35.5, modFreq: 7 } } })],
  ['single:fm-wide', cfg({ source: 'single', pattern: 'fm', frequency: 1500,
    pp: { fm: { modFreq: 40, depthHz: 900 } } })],
  ['single:chirp-linear', cfg({ source: 'single', pattern: 'chirp',
    pp: { chirp: { ramp: 'linear' } } })],
  ['single:sweep-linear', cfg({ source: 'single', pattern: 'sweepUp',
    pp: { sweepUp: { start: 100, end: 8000, durationMs: 2000, curve: 'linear' } } })],
  ['sweep:up-log', cfg({ source: 'sweep' })],
  ['sweep:down-linear', cfg({ source: 'sweep', sweep: { direction: 'down', curve: 'linear' } })],
  ['sweep:pingpong-x3', cfg({ source: 'sweep', sweep: { direction: 'pingpong', durationMs: 1000,
    repeat: 'n', repeatCount: 3 } })],
  ['sweep:continuous', cfg({ source: 'sweep', sweep: { repeat: 'continuous', durationMs: 500 } })],
  ['dual:mono', cfg({ source: 'dual' })],
  ['dual:stereo', cfg({ source: 'dual',
    dual: { stereo: true, b: { ...BASE.dual.b, freq: 454 } } })],
  ['dual:mixed-waves', cfg({ source: 'dual', dual: { a: { ...BASE.dual.a, wave: 'square' },
    b: { ...BASE.dual.b, wave: 'sawtooth', detune: 25 } } })],
];

const ADDITIVE = [{ n: 1, gain: 0.8 }, { n: 2, gain: 0 }, { n: 3, gain: 0.2 }];
const ONE_PARTIAL = [{ n: 1, gain: 1 }, { n: 2, gain: 0 }];
const NO_LAB = { additive: null, adsr: null, filter: null, router: null, phaseDeg: 0 };
const filterOf = (type, frequency = 1200, Q = 0.707) => ({ type, frequency, Q, gain: 0,
  enabled: true });

/** Lab inputs as main.js labVizInputs builds them for `plan` (router only for a dual plan). */
const LABS = [
  ['no labs object (V1)', () => null],
  ['labs, all off', () => NO_LAB],
  ['additive', () => ({ ...NO_LAB, additive: ADDITIVE })],
  ['additive, one partial', () => ({ ...NO_LAB, additive: ONE_PARTIAL })],
  ['adsr', () => ({ ...NO_LAB, adsr: { a: 0.01, d: 0.2, s: 0.6, r: 0.4 } })],
  ['adsr, long', () => ({ ...NO_LAB, adsr: { a: 1.25, d: 2, s: 0.05, r: 3.5 } })],
  ...['lowpass', 'highpass', 'bandpass', 'notch', 'peaking']
    .map((t) => [`filter ${t}`, () => ({ ...NO_LAB, filter: filterOf(t, 3300, 12) })]),
  ['additive + adsr + filter', () => ({ ...NO_LAB, additive: ADDITIVE,
    adsr: { a: 0.02, d: 0.1, s: 0.5, r: 0.3 }, filter: filterOf('lowpass') })],
  ['router split + phase', (plan) => ({ ...NO_LAB,
    router: plan && plan.type === 'dual'
      ? { mode: 'split', panA: -1, panB: 1, levelA: 1, levelB: 1 } : null, phaseDeg: 90 })],
  ['router pan', (plan) => ({ ...NO_LAB,
    router: plan && plan.type === 'dual'
      ? { mode: 'pan', panA: -0.35, panB: -0.35, levelA: 1, levelB: 1 } : null,
    filter: filterOf('highpass', 200) })],
  ['phase only', () => ({ ...NO_LAB, phaseDeg: 270 })],
];

const WAVES = ['sine', 'square', 'sawtooth', 'triangle'];

/** Bridge inputs of a configuration: the plan and the values the old derivation read as labels. */
function inputsOf(c, { waveform = c.waveform, attack = c.attack, release = c.release,
  gain = c.gainLevel } = {}) {
  const r = buildPlan({ ...c, waveform }, ENV);
  return { plan: r.ok ? r.plan : null, waveform, frequency: c.frequency, gain,
    attackMs: attack, releaseMs: release };
}

const stLabels = (i) => ({ waveform: i.waveform, labels: { freq: formatFrequency(i.frequency),
  attack: formatMs(i.attackMs), release: formatMs(i.releaseMs), gain: i.gain.toFixed(3) } });

function project(i, lab) {
  const voice = playgroundVoiceModel({ ...i, lab });
  return { voice, ...projectSignalPath(voice.model, { annotations: voice.annotations }) };
}

// ---------------------------------------------------------------- parity with the old stages

test('§164 the projection draws the stages the pre-V421 derivation drew (matrix)', (t) => {
  let cases = 0;
  const titles = new Set();
  for (const [name, c] of SOURCES) {
    for (const [labName, labOf] of LABS) {
      for (const waveform of WAVES) {
        for (const extra of [{}, { attack: 1500, release: 2, gain: 0.25 }]) {
          const i = inputsOf(c, { waveform, ...extra });
          const lab = labOf(i.plan);
          const want = legacyPathNodes(i.plan, stLabels(i), lab);
          const got = project(i, lab).stages;
          assert.deepStrictEqual(got, want, `${name} / ${labName} / ${waveform} ${
            JSON.stringify(extra)}`);
          for (const s of got) titles.add(s.title);
          cases++;
        }
      }
    }
  }
  assert.ok(cases >= 3000, `${cases} cases`);
  t.diagnostic(`${cases} configurations, ${titles.size} distinct stage titles`);
  // Every stage the Playground Signal Path has ever drawn appears in the matrix.
  for (const t of ['OSCILLATOR', 'ADDITIVE OSC', 'OSC A + OSC B', 'MODULATION', 'FREQUENCY STEPS',
    'FREQUENCY RAMP', 'LFO → FREQUENCY', 'LFO → GAIN (AM)', 'MODULATOR → FREQ',
    'STEREO PANNERS', 'MIX (MONO)', 'STEREO ROUTER', 'ENVELOPE', 'ADSR ENVELOPE', 'FILTER',
    'MASTER GAIN', 'LIMITER', 'ANALYSER', 'DEVICE OUTPUT']) {
    assert.ok(titles.has(t), `stage ${t}`);
  }
});

test('§164 an invalid configuration (no plan) still projects the fixed-frequency voice', () => {
  const c = cfg({ source: 'single', pattern: 'sequence', pp: { sequence: { text: '440, 8x0' } } });
  const i = inputsOf(c);
  assert.equal(i.plan, null);
  for (const [, labOf] of LABS) {
    const lab = labOf(null);
    assert.deepStrictEqual(project(i, lab).stages, legacyPathNodes(null, stLabels(i), lab));
  }
});

test('the one wording change: an Envelope Lab ADSR at full sustain reads as attack/release', () => {
  // At sustain 1 the decay segment goes from 1 to 1 and changes nothing; the projection reads the
  // envelope from its parameters and shows what acts. The stage, its title and its place stay.
  const i = inputsOf(cfg());
  const lab = { ...NO_LAB, adsr: { a: 0.01, d: 0.25, s: 1, r: 0.3 } };
  const got = project(i, lab).stages;
  const want = legacyPathNodes(i.plan, stLabels(i), lab);
  assert.deepStrictEqual(got.map((s) => s.title), want.map((s) => s.title));
  assert.equal(want[2].sub, 'A 10 ms · D 250 ms · S 1 · R 300 ms');
  assert.equal(got[2].sub, 'A 10 ms · R 300 ms');
});

// ---------------------------------------------------------------- the derived model

const representative = () => [
  ['tone', cfg(), null],
  ['siren', cfg({ pattern: 'siren' }), NO_LAB],
  ['wobble', cfg({ pattern: 'wobble' }), NO_LAB],
  ['am', cfg({ pattern: 'am' }), NO_LAB],
  ['fm', cfg({ pattern: 'fm' }), NO_LAB],
  ['sequence', cfg({ pattern: 'sequence' }), NO_LAB],
  ['pingpong', cfg({ pattern: 'pingpong' }), NO_LAB],
  ['sweep', cfg({ source: 'sweep' }), NO_LAB],
  ['all labs', cfg(), { ...NO_LAB, additive: ADDITIVE, adsr: { a: 0.01, d: 0.1, s: 0.6, r: 0.3 },
    filter: filterOf('bandpass', 2000, 4) }],
  ['dual mono', cfg({ source: 'dual' }), NO_LAB],
  ['dual stereo (V1 panners)', cfg({ source: 'dual', dual: { stereo: true } }), null],
  ['dual router', cfg({ source: 'dual', dual: { stereo: true } }), { ...NO_LAB,
    router: { mode: 'split', panA: -1, panB: 1, levelA: 1, levelB: 1 }, phaseDeg: 45 }],
];

test('§10 the Playground voice is a valid, plain-data StudioModel', () => {
  for (const [name, c, lab] of representative()) {
    const { voice, stages, sources } = project(inputsOf(c), lab);
    assertPlainData(voice.model);
    assertPlainData(voice.annotations);
    assert.equal(voice.model.kind, 'oscilla-studio');
    const v = validateStudioModel(voice.model);
    assert.deepEqual(v.errors.map((e) => `${e.code} ${e.path}`), [], name);
    assert.equal(v.ok, true, name);
    // Every stage names the model records it was projected from.
    assert.equal(sources.length, stages.length, name);
    const ids = new Set(voice.model.graph.nodes.map((n) => n.id));
    for (const [k, src] of sources.entries()) {
      for (const id of src.nodes) assert.ok(ids.has(id), `${name}: stage ${k} node ${id}`);
      if (src.lane) {
        assert.ok(voice.model.timeline.automation.some((l) => l.id === src.lane), name);
      }
      if (src.edge) assert.ok(voice.model.graph.edges.some((e) => e.id === src.edge), name);
      assert.ok(src.nodes.length || stages[k].enabled === false,
        `${name}: stage ${k} has a source`);
    }
  }
});

test('the Playground voice graph is the voice the engine builds', () => {
  const nodeOf = (m, id) => m.graph.nodes.find((n) => n.id === id);
  const edgeTo = (m, id, port) => m.graph.edges.find((e) => e.to.node === id && e.to.port === port);
  const chainOf = (m) => {
    const inc = signalInputs(m);
    const out = [];
    for (let id = ID.master; inc.get(id); id = inc.get(id)[0].from) {
      out.unshift(inc.get(id)[0].from);
    }
    return out.map((id) => nodeOf(m, id).type);
  };

  // siren: LFO into the oscillator frequency; base + offset is the sounding centre.
  let i = inputsOf(cfg({ pattern: 'siren' }));
  let m = playgroundVoiceModel({ ...i, lab: null }).model;
  let e = edgeTo(m, ID.osc, 'frequency');
  assert.equal(e.from.node, ID.lfo);
  assert.equal(nodeOf(m, ID.osc).params.frequency + e.props.offset, i.plan.center);
  assert.equal(e.props.depth, i.plan.depth);
  assert.equal(nodeOf(m, ID.lfo).params.rate, i.plan.rate);
  assert.deepEqual(chainOf(m), ['oscillator', 'envelope']);

  // am: buildAm's amGain (1 − depth/2) between oscillator and envelope, LFO into its gain.
  i = inputsOf(cfg({ pattern: 'am' }));
  m = playgroundVoiceModel({ ...i, lab: null }).model;
  assert.deepEqual(chainOf(m), ['oscillator', 'gain', 'envelope']);
  assert.equal(nodeOf(m, ID.am).params.gain, 1 - i.plan.depth / 2);
  e = edgeTo(m, ID.am, 'gain');
  assert.equal(e.from.node, ID.lfo);
  assert.equal(e.props.depth, i.plan.depth / 2);

  // steps: one step point per scheduled tone; ramps: exponential points on a log sweep.
  i = inputsOf(cfg({ pattern: 'sequence' }));
  m = playgroundVoiceModel({ ...i, lab: null }).model;
  const lane = m.timeline.automation[0];
  assert.deepEqual(lane.target, { node: ID.osc, param: 'frequency' });
  assert.equal(lane.points.length, i.plan.steps.length);
  assert.deepEqual(lane.points.map((p) => [p.time, p.value, p.curve]),
    i.plan.steps.map((s) => [s.t, s.f, 'step']));
  i = inputsOf(cfg({ source: 'sweep' }));
  m = playgroundVoiceModel({ ...i, lab: null }).model;
  const seg = i.plan.segments[0];
  assert.deepEqual(m.timeline.automation[0].points.slice(0, 2).map((p) => [p.time, p.value,
    p.curve]), [[seg.t, seg.f0, 'step'], [seg.t + seg.dur, seg.f1, 'exponential']]);

  // dual: mono mixer, V1 stereo panners at −1 / +1, the V2 router as a Stereo Split.
  i = inputsOf(cfg({ source: 'dual' }));
  m = playgroundVoiceModel({ ...i, lab: null }).model;
  assert.deepEqual(chainOf(m), ['oscillator', 'mixer', 'envelope']);
  assert.equal(nodeOf(m, ID.osc).params.level, 0.5 * i.plan.a.gain * i.plan.levelA);
  i = inputsOf(cfg({ source: 'dual', dual: { stereo: true } }));
  m = playgroundVoiceModel({ ...i, lab: null }).model;
  assert.deepEqual([nodeOf(m, ID.panA).params.pan, nodeOf(m, ID.panB).params.pan], [-1, 1]);
  m = playgroundVoiceModel({ ...i, lab: { ...NO_LAB,
    router: { mode: 'split', panA: -1, panB: 1, levelA: 1, levelB: 1 } } }).model;
  assert.deepEqual(chainOf(m), ['oscillator', 'stereo-split', 'envelope']);
  assert.equal(nodeOf(m, ID.router).params.mode, 'split');

  // labs: Envelope Lab ADSR, Filter Lab after the envelope (audio-engine.js inserts).
  i = inputsOf(cfg());
  m = playgroundVoiceModel({ ...i, lab: { ...NO_LAB, adsr: { a: 0.02, d: 0.1, s: 0.5, r: 0.4 },
    filter: filterOf('notch', 3000, 2) } }).model;
  assert.deepEqual(chainOf(m), ['oscillator', 'envelope', 'filter']);
  assert.deepEqual(nodeOf(m, ID.envelope).params,
    { attack: 0.02, decay: 0.1, sustain: 0.5, release: 0.4 });
  assert.equal(nodeOf(m, ID.master).params.level, i.gain);
});

test('values beyond a Studio range stay as they sound; such a model is reported invalid', () => {
  const i = inputsOf(cfg({ pattern: 'fm', pp: { fm: { modFreq: 1000, depthHz: 100 } } }));
  const { voice, stages } = project(i, NO_LAB);
  assert.equal(stages[1].sub, '1000 Hz · ±100 Hz');
  const v = validateStudioModel(voice.model);
  assert.equal(v.ok, false);
  assert.deepEqual(v.errors.map((e) => [e.code, e.nodeId]), [['invalid-param', ID.lfo]]);
});

// ---------------------------------------------------------------- the canvas draws the projection

function bridgeInputs(c, over = {}) {
  const r = buildPlan(c, ENV);
  return {
    vizMode: 'path', frequency: c.frequency, waveform: c.waveform, gain: c.gainLevel,
    rangeMin: 20, rangeMax: 20000, nyquist: 24000, safeMax: 22800, provisional: false,
    spectrumScale: 'log', overlays: { regions: false, notes: false, thirds: false }, a4: 440,
    source: c.source, playing: false, status: 'READY', dual: c.dual, dualFa: 440, dualFb: 442,
    noteText: 'A4', attack: c.attack, release: c.release, plan: r.ok ? r.plan : null,
    usesGlobal: true, micActive: false, paused: false, ...over,
  };
}

test('§164 the bridge state the canvas draws is the projection of the Playground voice', () => {
  const bridge = new VisualizationBridge({ env: { requestAnimationFrame: () => 0 } });
  const labs = { ...NO_LAB, adsr: { a: 0.01, d: 0.1, s: 0.6, r: 0.3 },
    filter: filterOf('lowpass') };
  bridge.labInputs = () => labs;
  for (const [name, c] of [['tone', cfg()], ['fm', cfg({ pattern: 'fm' })],
    ['dual', cfg({ source: 'dual' })]]) {
    for (const micActive of [false, true]) {
      bridge.sync(bridgeInputs(c, { micActive }));
      const s = bridge.state;
      assert.equal(s.signalPath.model.kind, 'oscilla-studio', name);
      const again = projectSignalPath(s.signalPath.model,
        { annotations: s.signalPath.annotations });
      assert.deepStrictEqual(s.pathNodes, again.stages, name);
      assert.deepStrictEqual(s.signalPath.sources, again.sources, name);
      assert.ok(s.pathNodes.some((n) => n.title === 'FILTER'), name);
    }
  }
  // The microphone is analysis only: it never joins the voice's signal path.
  bridge.sync(bridgeInputs(cfg(), { micActive: false }));
  const off = bridge.state.pathNodes;
  bridge.sync(bridgeInputs(cfg(), { micActive: true }));
  assert.deepStrictEqual(bridge.state.pathNodes, off);
});

test('no second derivation: src/ derives the Signal Path only through the projection', () => {
  const files = [];
  const walk = (dir) => {
    for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, f.name);
      if (f.isDirectory()) walk(p);
      else if (/\.(js|html)$/.test(f.name)) files.push(p);
    }
  };
  walk(path.join(ROOT, 'src'));
  for (const f of files) {
    assert.ok(!fs.readFileSync(f, 'utf8').includes('pathNodesFor'),
      `${path.relative(ROOT, f)} still names pathNodesFor`);
  }
  const view = fs.readFileSync(path.join(ROOT, 'src/js/visualization/signal-path.js'), 'utf8');
  assert.deepEqual(view.match(/^import .*$/gm), null, 'the canvas view imports nothing');
  const bridge = fs.readFileSync(path.join(ROOT, 'src/js/visualization/visualization-bridge.js'),
    'utf8');
  assert.match(bridge, /from '\.\.\/studio\/signal-path-projection\.js'/);
  assert.match(bridge, /from '\.\.\/studio\/playground-voice\.js'/);
  assert.deepEqual(bridge.match(/\.pathNodes = .*/g), ['.pathNodes = path.stages;']);
});

// ---------------------------------------------------------------- generic Studio graphs

test('every template projects; its stages follow the signal path the summary reads', () => {
  for (const t of STUDIO_TEMPLATES) {
    const model = templateModel(t.id);
    const { stages, sources } = projectSignalPath(model);
    assert.ok(stages.length >= 4, t.id);
    assert.deepEqual(stages.slice(-4).map((s) => s.title),
      ['MASTER GAIN', 'LIMITER', 'ANALYSER', 'DEVICE OUTPUT'], t.id);
    // The stages follow the first signal path of the §249 summary, in order.
    const said = summarizeGraph(model).match(/Signal paths?: ([^;.]*)/)[1].split(' to ')
      .slice(0, -1);
    const names = new Map(model.graph.nodes.map((n) => [n.id, n.metadata.name]));
    const drawn = [...new Set(sources.slice(0, -4).flatMap((x) => x.nodes))]
      .map((id) => names.get(id)).filter((n) => said.includes(n));
    assert.deepEqual(drawn, said, t.id);
  }
});

test('a noise source and a microphone project without a Playground voice', () => {
  const noise = createStudioModel({ graph: {
    nodes: [{ id: 'noise-1', type: 'noise', params: { color: 'pink', level: 0.5 } },
      { id: 'env-1', type: 'envelope', params: { attack: 0.02, decay: 0.1, sustain: 0.7,
        release: 0.2 } },
      { id: 'master-1', type: 'master', params: { level: 0.1 } }],
    edges: [{ id: 'edge-1', from: { node: 'noise-1', port: 'audio' },
      to: { node: 'env-1', port: 'audio' } },
    { id: 'edge-2', from: { node: 'env-1', port: 'audio' },
      to: { node: 'master-1', port: 'audio' } }] } });
  const n = projectSignalPath(noise).stages;
  assert.equal(n[1].sub, 'none');
  assert.deepEqual(n.map((s) => s.title), ['NOISE 1', 'MODULATION', 'ENVELOPE 1',
    'MASTER GAIN', 'LIMITER', 'ANALYSER', 'DEVICE OUTPUT']);
  assert.equal(n[0].sub, 'Pink · 50 %');
  assert.equal(n[2].sub, 'A 20 ms · D 100 ms · S 0.7 · R 200 ms');
  assert.equal(n[3].sub, 'logical 0.100');
  // The microphone can never reach Master Output (validate.js live-input-to-output): only its
  // tap exists, so the path has no source and the canvas shows the output chain alone.
  const mic = createStudioModel({ graph: {
    nodes: [{ id: 'mic-1', type: 'microphone' }, { id: 'spectrum-1', type: 'spectrum' },
      { id: 'master-1', type: 'master' }],
    edges: [{ id: 'edge-1', from: { node: 'mic-1', port: 'audio' },
      to: { node: 'spectrum-1', port: 'audio' } }] } });
  assert.equal(validateStudioModel(mic).ok, true);
  assert.deepEqual(projectSignalPath(mic).stages.map((s) => s.title),
    ['MASTER GAIN', 'LIMITER', 'ANALYSER', 'DEVICE OUTPUT']);
  // No Master Output: nothing to draw.
  assert.deepEqual(projectSignalPath(createStudioModel({})), { stages: [], sources: [] });
});
