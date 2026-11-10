// K235 (review C1-K232-1 of oscilla-c1): a log cable into a low- or high-pass Q is held at or
// below the top of the Q knob's soft range (30, nodes/processing.js; compiler.js computeBases,
// K232), and the Studio says so (project.no-silent-feedback): one runtime `q-limited`
// diagnostic per held cable, in Czech and in Q terms, its entity the cable, with its stored and
// played depth in octaves of Q; the Inspector shows it beside the cable as it shows a
// `frequency-limited` one. A cable with its whole room says nothing, and the frequency-limited
// diagnostics are unchanged (their own tests, readout-in-effect-studio-limits.test.mjs).
// On the merge base a held Q cable is held silently: no diagnostic names it.
//   node --test tests/unit/k235-q-ceiling-diagnostic.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';

import * as actions from '../../src/js/studio/actions.js';
import * as schema from '../../src/js/studio/schema.js';
import { AudioEngine } from '../../src/js/audio/audio-engine.js';
import * as runtimeMod from '../../src/js/studio/runtime.js';
import * as inspector from '../../src/js/ui/studio/inspector.js';
import { createFakeAudioEnv } from './sequencer-fake-audio.mjs';

const CODE = 'q-limited';
const CEILING = 30; // nodes/processing.js: the Q knob's soft-range top
const near = (a, b, what) => assert.ok(Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(b)),
  `${what}: ${a} vs ${b}`);

/** An XY pad's Y (unipolar CONTROL) cabled log into a filter's Q, running on the fake engine. */
function rig({ type = 'lowpass', slope = '12', Q = 20, depth = 2, mapping = 'log' } = {}) {
  const empty = schema.normalizeStudio({ kind: schema.STUDIO_KIND, schemaVersion: 1,
    graph: { nodes: [], edges: [] } });
  const store = actions.createStudioStore(empty,
    { idGenerator: actions.createIdGenerator(empty) });
  const add = (nodeType) => store.dispatch({ type: 'NODE_ADD', nodeType,
    position: { x: 0, y: 0 } }).created.nodes[0];
  const pad = add('xy-pad');
  const f = add('filter');
  for (const [key, value] of Object.entries({ type, slope, Q })) {
    assert.equal(store.dispatch({ type: 'NODE_PARAM_SET', nodeId: f, key, value }).ok, true, key);
  }
  const r = store.dispatch({ type: 'EDGE_ADD', from: { node: pad, port: 'y' },
    to: { node: f, port: 'Q' }, props: { depth, mapping, polarity: 'unipolar' } });
  assert.equal(r.ok, true, r.reason);
  const fx = createFakeAudioEnv({ sampleRate: 48000 });
  const engine = new AudioEngine({ env: fx.env });
  assert.ok(engine.init());
  const runtime = runtimeMod.createStudioRuntime({ engine });
  const applied = runtime.apply(store.getModel(), { revision: store.getRevision() });
  assert.equal(applied.ok, true, applied.reason);
  const started = runtime.start();
  assert.equal(started.ok, true);
  fx.advance(0.2);
  const truth = () => ({ verdict: runtimeMod.studioDivergence({ model: store.getModel(),
    revision: store.getRevision() }, runtime), runtime: runtime.debugInfo(), transport: null });
  const diags = () => runtime.debugInfo().diagnostics;
  return { store, runtime, pad, f, edge: r.created.edges[0], started, truth, diags,
    held: () => diags().filter((d) => d.code === CODE) };
}

test('a log cable whose full excursion passes Q 30 gives one q-limited diagnostic on the cable, '
  + 'in Czech, with its stored and played depth in octaves of Q', () => {
  for (const [type, slope] of [['lowpass', '12'], ['lowpass', '24'], ['highpass', '12']]) {
    const s = rig({ type, slope, Q: 20, depth: 2 });
    const held = s.held();
    assert.equal(held.length, 1, `${type} ${slope}: ${s.diags().map((d) => d.code).join()}`);
    const [d] = held;
    assert.deepEqual(d.entity && [d.entity.kind, d.entity.id], ['edge', s.edge]);
    assert.equal(d.owner, 'runtime');
    assert.equal(d.severity, 'warning');
    const played = Math.log2(CEILING / 20);
    assert.equal(d.details.stored, 2);
    near(d.details.played, played, `${type} ${slope}: the played depth`);
    near(d.details.scale, played / 2, `${type} ${slope}: the factor`);
    assert.deepEqual([d.details.node, d.details.param, d.details.unit, d.details.mapping,
      d.details.ceiling], [s.f, 'Q', 'octaves', 'log', CEILING]);
    // Named in Czech and in Q terms: the cable, the target, the ceiling and both depths.
    assert.equal(d.message, 'Kabel XY Pad 1 Y → Filter 1 Q je omezen: Q nepřekročí 30 (horní '
      + 'mez knoflíku); hraje 29 % své hloubky (0,585 z 2 oktáv Q).');
    // It is also among what start returned (as the frequency-limited ones are).
    assert.ok((s.started.warnings || []).some((w) => w.code === CODE), 'start returns it');
    // The frequency-limited diagnostics stay about frequencies: none names this cable.
    assert.equal(s.diags().filter((x) => x.code === 'frequency-limited').length, 0);
  }
});

test('a base at or above the ceiling leaves the cable no room, and it says that', () => {
  const s = rig({ Q: 50, depth: 2 });
  const held = s.held();
  assert.equal(held.length, 1);
  assert.equal(held[0].details.played, 0);
  assert.equal(held[0].details.scale, 0);
  assert.equal(held[0].message, 'Kabel XY Pad 1 Y → Filter 1 Q nemá místo: Q nepřekročí 30 '
    + '(horní mez knoflíku) a Filter 1 Q už je 50.');
});

test('a cable with its whole room, a band-pass Q and a linear Q cable say nothing', () => {
  assert.deepEqual(rig({ Q: 1, depth: 2 }).held(), [], 'Q 1 x 2^2 = 4 is under 30');
  assert.deepEqual(rig({ Q: 7.5, depth: 2 }).held(), [], 'Q 7.5 x 2^2 = 30 is the ceiling itself');
  assert.deepEqual(rig({ type: 'bandpass', mapping: 'linear', Q: 20, depth: 0.5 }).held(), [],
    'a band-pass Q is linear, with no ceiling of its own');
});

test('the Inspector names it beside the held cable, with its code', () => {
  const s = rig({ Q: 20, depth: 2 });
  const [d] = s.held();
  const ev = inspector.inspectorView(s.store.getModel(), { edges: [s.edge] }, { truth: s.truth() });
  assert.ok(ev.statusText.includes(`${d.message} (${CODE})`), ev.statusText);
  const free = rig({ Q: 1, depth: 2 });
  const fv = inspector.inspectorView(free.store.getModel(), { edges: [free.edge] },
    { truth: free.truth() });
  assert.ok(!fv.statusText.includes(CODE), fv.statusText);
});

// The Runtime section's summary counts every limit diagnostic in effect, whatever its kind
// (runtime debugInfo().limits, runtime-trace.js limitDiagnostics): a revision whose Q cable or
// fit cable is held does not "play as edited" (project.no-fake-science). On the merge base it
// counted `frequency-limited` alone.
test('the Runtime summary counts a held Q cable: not "plays as edited"', () => {
  const s = rig({ Q: 20, depth: 2 });
  const rv = inspector.runtimeView(s.store.getModel(), s.truth());
  assert.equal(rv.state, 'in-sync');
  assert.ok(!rv.text.includes('plays as edited'), rv.text);
  assert.equal(rv.text, `Revize ${rv.applied.revision} hraje s omezením: Studio drží 1 `
    + 'hodnotu na horní mezi knoflíku nebo pod ní; viz diagnostiky níže.');
  const free = rig({ Q: 1, depth: 2 });
  const fv = inspector.runtimeView(free.store.getModel(), free.truth());
  assert.equal(fv.text, `Revision ${fv.applied.revision} plays as edited.`);
});

test('the Runtime summary counts a fit cable held by its range (performance-limited)', () => {
  const empty = schema.normalizeStudio({ kind: schema.STUDIO_KIND, schemaVersion: 1,
    graph: { nodes: [], edges: [] } });
  const store = actions.createStudioStore(empty,
    { idGenerator: actions.createIdGenerator(empty) });
  const add = (nodeType) => store.dispatch({ type: 'NODE_ADD', nodeType,
    position: { x: 0, y: 0 } }).created.nodes[0];
  const pad = add('xy-pad');
  const g = add('gain');
  // Gain at the top of 0..2: the pad's Y has no room upward, so it is fit to nothing.
  assert.equal(store.dispatch({ type: 'NODE_PARAM_SET', nodeId: g, key: 'gain', value: 2 }).ok,
    true);
  const r = store.dispatch({ type: 'EDGE_ADD', from: { node: pad, port: 'y' },
    to: { node: g, port: 'gain' }, props: { depth: 1, mapping: 'linear', polarity: 'unipolar' } });
  assert.equal(r.ok, true, r.reason);
  const fx = createFakeAudioEnv({ sampleRate: 48000 });
  const engine = new AudioEngine({ env: fx.env });
  assert.ok(engine.init());
  const runtime = runtimeMod.createStudioRuntime({ engine });
  assert.equal(runtime.apply(store.getModel(), { revision: store.getRevision() }).ok, true);
  assert.equal(runtime.start().ok, true);
  fx.advance(0.2);
  const dbg = runtime.debugInfo();
  const perf = dbg.diagnostics.filter((d) => d.code === 'performance-limited');
  assert.equal(perf.length, 1, dbg.diagnostics.map((d) => d.code).join());
  assert.ok(dbg.limits.includes(perf[0]), 'debugInfo().limits holds it');
  const rv = inspector.runtimeView(store.getModel(), { verdict: runtimeMod.studioDivergence({
    model: store.getModel(), revision: store.getRevision() }, runtime), runtime: dbg,
  transport: null });
  assert.equal(rv.text, `Revize ${rv.applied.revision} hraje s omezením: Studio drží 1 `
    + 'hodnotu v rozsahu svého parametru; viz diagnostiky níže.');
});
