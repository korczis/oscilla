// K097: the XY performance pad. The xy-pad node type (registry, ports, the scale-quantised
// pitch of nodes/instrument.js xyDegree over core/music.js SCALE_MODES), its runtime adapter
// (three ConstantSources, census 0 after stop), its live events (studio/live-notes.js: the gate
// opens on touch and closes on release), the XY pad kind (ui/kinds/xy-pad.js createXyModel: the
// gate closes on release, blur, hide and Escape; a second touch sets Y only; keys), the XY tab
// as a module of the Synth panel, Y into its target through a CONTROL edge, and the XY presets
// as ordinary patches (studio/patches.js, category 'xy' and a scale), each one undoable BATCH.
// A document holding the type is refused by name by a registry without it (rollback).
import test from 'node:test';
import assert from 'node:assert/strict';
import { NOTE_NAMES, SCALE_MODES, scaleNote } from '../../src/js/core/music.js';
import { xyFromPoint } from '../../src/js/charts/drag-math.js';
import {
  NODE_DEFINITIONS, NODE_REGISTRY as R, createNodeRegistry,
} from '../../src/js/studio/registry.js';
import { KEYS_PITCH_RANGE, xyDegree } from '../../src/js/studio/nodes/instrument.js';
import { NODE_ADAPTERS } from '../../src/js/studio/adapters/nodes.js';
import { createLiveNotes, keysGatedEnvelopes, liveModel } from '../../src/js/studio/live-notes.js';
import { importPatch, serializePatch } from '../../src/js/studio/patches.js';
import { importStudio } from '../../src/js/studio/migrate.js';
import { serializeStudio } from '../../src/js/studio/schema.js';
import { createStudioRuntime } from '../../src/js/studio/runtime.js';
import { AudioEngine } from '../../src/js/audio/audio-engine.js';
import PANEL from '../../src/js/synth/panels/semi-mono.js';
import { SOURCE_RANGES } from '../../src/js/synth/panel.js';
import { panelCables } from '../../src/js/synth/normals.js';
import { decodeSynthLink } from '../../src/js/core/url-state-synth.js';
import { PRESETS } from '../../src/js/synth/presets.js';
import {
  XY_CATEGORY, XY_RECIPES, XY_VOICE, xyCablesAction, xyPatchAction, xyPatchOf, xyPatched,
  xyPresetPatch, xyTarget, xyTargetAction, xyTargets,
} from '../../src/js/synth/xy.js';
import { createXyModel } from '../../src/js/ui/kinds/xy-pad.js';
import { createFakeAudioEnv } from './sequencer-fake-audio.mjs';
import { panelStore } from './synth-fixture.mjs';

const PAD = { mode: 'major', key: 'C', octave: 4, span: 1, glide: 0 };

// ---------------------------------------------------------------- the node type

test('the xy-pad type: X, Y and Pitch CONTROL outputs, a Gate TRIGGER, its scale parameters', () => {
  const d = R.get('xy-pad');
  assert.ok(d, 'registered in the one registry');
  assert.deepEqual(d.outputs.map((p) => [p.id, p.type]), [['x', 'CONTROL'], ['y', 'CONTROL'],
    ['pitch', 'CONTROL'], ['gate', 'TRIGGER']]);
  assert.deepEqual(d.inputs, []);
  assert.deepEqual(R.param('xy-pad', 'mode').options.map((o) => o[0]), Object.keys(SCALE_MODES));
  assert.deepEqual(R.param('xy-pad', 'key').options.map((o) => o[0]), NOTE_NAMES);
  assert.equal(d.category, 'MODULATION');
  assert.equal(d.capabilities.notes, true);
  assert.equal(NODE_ADAPTERS['xy-pad'].compiler, d.compiler);
  assert.equal(typeof d.summary(R.defaults('xy-pad')), 'string');
});

test('x maps to the scale degrees of each mode exactly, in equal cells, the top key closing', () => {
  for (const [mode, steps] of Object.entries(SCALE_MODES)) {
    for (const span of [1, 2, 3]) {
      for (const key of ['C', 'F#', 'A']) {
        const p = { ...PAD, mode, key, span, octave: 3 };
        const n = span * steps.length + 1;
        assert.equal(xyDegree(0.5, p).steps, n);
        const root = 12 * 4 + NOTE_NAMES.indexOf(key);
        for (let i = 0; i < n; i++) {
          const want = root + 12 * Math.floor(i / steps.length) + steps[i % steps.length];
          for (const x of [i / n + 1e-9, (i + 0.5) / n, (i + 1) / n - 1e-9]) {
            const d = xyDegree(x, p);
            assert.equal(d.index, i, `${mode} ${key} span ${span} x ${x}`);
            assert.equal(d.note, want, `${mode} ${key} step ${i}`);
            assert.equal(d.degree, (i % steps.length) + 1);
            assert.equal(d.pitch, (want - 69) / 12, '1.00 oct per octave from A4');
          }
        }
        assert.equal(xyDegree(0, p).note, root, 'x 0: the key');
        assert.equal(xyDegree(1, p).note, root + 12 * span, 'x 1: the key at the top');
      }
    }
  }
  assert.equal(xyDegree(-3, PAD).index, 0, 'clamped below');
  assert.equal(xyDegree(7, PAD).index, 7, 'clamped above');
  assert.equal(xyDegree(0.5, { ...PAD, mode: 'minor-pentatonic', key: 'A' }).name, 'E5');
  assert.deepEqual(scaleNote(9, { mode: 'dorian', key: 'D', octave: 3 }),
    { note: 50 + 12 + 3, degree: 3, up: 1 });
  const top = xyDegree(1, { ...PAD, octave: 5, span: 4, key: 'B' });
  assert.ok(top.pitch <= KEYS_PITCH_RANGE[1], 'the widest span stays inside the pitch range');
});

// ---------------------------------------------------------------- the adapter

function setup(sampleRate) {
  const fx = createFakeAudioEnv({ sampleRate });
  const engine = new AudioEngine({ env: fx.env });
  assert.ok(engine.init(), 'engine.init');
  if (engine.limiterFeed) engine.limiterFeed.infrastructure = true;
  return { ...fx, engine, runtime: createStudioRuntime({ engine }) };
}
const last = (p) => p.events[p.events.length - 1];

for (const sr of [44100, 48000]) {
  test(`the adapter at ${sr} Hz: X, Y glide, the pitch steps; the census is 0 after stop`,
    async () => {
      const st = panelStore();
      const m = st.getModel();
      const pad = PANEL.resolve(m).get('xy');
      assert.equal(st.dispatch(xyCablesAction(m, PANEL, [...XY_VOICE,
        ['xy.y', 'lpf.frequency']]).action).ok, true);
      const s = setup(sr);
      assert.equal(s.runtime.apply(liveModel(st.getModel())).ok, true);
      assert.equal(s.runtime.start().ok, true);
      const h = s.runtime.nodes.get(pad.id);
      assert.equal(h.status, 'ready');
      assert.deepEqual(h.outputRange, { x: SOURCE_RANGES['xy-pad'].x.range,
        y: SOURCE_RANGES['xy-pad'].y.range, pitch: SOURCE_RANGES['xy-pad'].pitch.range },
      'the panel sizes cables from the ranges the adapter declares');
      const r = h.move(1, 0.5, 0.25);
      assert.equal(r.note, xyDegree(0.5, pad.params).note);
      assert.equal(last(h.outputs.pitch.offset).value, r.pitch);
      assert.equal(last(h.outputs.pitch.offset).ramp, 'set', 'no glide by default');
      assert.deepEqual([last(h.outputs.x.offset).ramp, last(h.outputs.y.offset).value],
        ['target', 0.25], 'X and Y glide: no step, no click');
      h.update({ glide: 0.3 }, null, {});
      h.move(1.1, 0.9, 0.3, { legato: true });
      assert.equal(last(h.outputs.pitch.offset).ramp, 'target', 'legato steps glide');
      assert.ok(Math.abs(last(h.outputs.pitch.offset).tau - 0.1) < 1e-12, 'Glide / 3');
      s.advance(0.2);
      const done = s.runtime.stop();
      s.advance(0.3);
      assert.deepEqual(await done, { nodes: 0, sources: 0, engineNodes: 0, engineSources: 0 });
    });
}

// ---------------------------------------------------------------- live events

function fakeRun(model) {
  const log = [];
  const handles = new Map();
  for (const n of model.graph.nodes) {
    if (n.type === 'xy-pad') {
      handles.set(n.id, { move: (t, x, y, o) => {
        log.push(['move', t, x, y, o.legato]);
        return { ...xyDegree(x, n.params), x, y };
      } });
    } else if (n.type === 'envelope') {
      handles.set(n.id, { gate: (t) => log.push(['gate', n.id, t]),
        release: (t) => log.push(['release', n.id, t]) });
    }
  }
  return { live: createLiveNotes({ getModel: () => model, handleOf: (id) => handles.get(id) }),
    log };
}

test('the gate opens at a touch, moves are legato, release closes it; all-off releases', () => {
  const st = panelStore();
  st.dispatch(xyCablesAction(st.getModel(), PANEL, XY_VOICE).action);
  const m = st.getModel();
  const pad = PANEL.resolve(m).get('xy').id;
  const { live, log } = fakeRun(m);
  const egs = keysGatedEnvelopes(m);
  assert.equal(egs.size, 2, 'the pad-gated envelopes are closed at arm, as the keys ones');
  assert.equal(live.event(pad, { kind: 'move', x: 0.1, y: 0.2, at: 1 }).held, 0,
    'a cursor move with no touch opens no gate');
  const on = live.event(pad, { kind: 'on', x: 0.5, y: 0.5, at: 2 });
  assert.equal(on.held, 1);
  live.event(pad, { kind: 'move', x: 0.9, y: 0.5, at: 3 });
  assert.equal(log.filter((x) => x[0] === 'gate').length, 2, 'one gate per envelope');
  assert.deepEqual(log.filter((x) => x[0] === 'move').map((x) => x[4]), [false, false, true]);
  assert.deepEqual(live.held(), [xyDegree(0.9, m.graph.nodes.find((n) => n.id === pad).params)
    .note]);
  live.event(pad, { kind: 'off', at: 4 });
  assert.equal(log.filter((x) => x[0] === 'release' && x[2] === 4).length, 2);
  assert.deepEqual(live.held(), []);
  live.event(pad, { kind: 'on', x: 0.5, y: 0.5, at: 5 });
  assert.equal(live.allOff(6), 1);
  assert.equal(log.filter((x) => x[0] === 'release' && x[2] === 6).length, 2);
  assert.equal(live.event(pad, { kind: 'off', at: 7 }).released, 0, 'nothing held twice');
  assert.ok(liveModel(m).graph.nodes.some((n) => n.id === pad), 'the armed model plays it');
});

// ---------------------------------------------------------------- the kind

const X = { key: 'x', label: 'Pitch', type: 'integer', min: 0, max: 7, step: 1, default: 3 };
const Y = { key: 'y', label: 'Y', type: 'number', min: 0, max: 1, default: 0.5 };

function kind() {
  const log = [];
  const model = createXyModel({ x: X, y: Y,
    onPreview: (v) => log.push(['preview', v.x, v.y]),
    onCommit: (v, why) => log.push(['commit', v.x, v.y, why]),
    onGate: (open, v, why) => log.push(['gate', open, why]) });
  return { model, log, gates: () => log.filter((x) => x[0] === 'gate').map((x) => x.slice(1)) };
}

test('the kind: a touch opens the gate, a drag previews, the release commits once', () => {
  const { model, log, gates } = kind();
  model.down(1, 0.3, 0.8);
  assert.deepEqual(model.value, { x: 2, y: 0.8 }, 'an integer axis: equal cells');
  model.move(1, 0.99, 0.1);
  model.move(1, 0.5, 0.4);
  assert.equal(log.filter((x) => x[0] === 'commit').length, 0, 'no commit during the drag');
  model.up(1);
  assert.deepEqual(gates(), [[true, 'touch'], [false, 'release']]);
  assert.deepEqual(log.filter((x) => x[0] === 'commit'), [['commit', 4, 0.4, 'release']]);
  assert.deepEqual(model.fraction(), { x: 4.5 / 8, y: 0.4 }, 'the cursor at the cell centre');
  assert.deepEqual(xyFromPoint(150, 20, { x: 100, y: 0, w: 200, h: 100 }), { x: 0.25, y: 0.8 });
  assert.deepEqual(xyFromPoint(-5, 500, { x: 0, y: 0, w: 10, h: 10 }), { x: 0, y: 0 });
});

for (const reason of ['blur', 'hide', 'escape']) {
  test(`the kind: ${reason} releases a held touch, once`, () => {
    const { model, gates } = kind();
    model.down(1, 0.5, 0.5);
    model.down(2, 0.1, 0.9);
    assert.equal(model.end(reason), true);
    assert.equal(model.gated, false);
    assert.equal(model.end(reason), false, 'nothing to release twice');
    model.up(1);
    assert.deepEqual(gates(), [[true, 'touch'], [false, reason]]);
  });
}

test('the kind: a second touch sets Y only; the gate stays open until the last lifts', () => {
  const { model, gates } = kind();
  model.down(1, 0.1, 0.1);
  model.down(2, 0.9, 0.7);
  assert.deepEqual(model.value, { x: 0, y: 0.7 });
  model.move(2, 0.9, 0.2);
  assert.deepEqual(model.value, { x: 0, y: 0.2 });
  model.up(1);
  assert.equal(model.gated, true);
  model.up(2);
  assert.deepEqual(gates(), [[true, 'touch'], [false, 'release']]);
});

test('the kind: keys move the cursor (arrows, Shift fine, PageUp/PageDown, Home/End), Enter '
  + 'gates, a reset returns to the defaults', () => {
  const { model, gates } = kind();
  model.key('ArrowRight');
  model.key('ArrowUp');
  assert.deepEqual(model.value, { x: 4, y: 0.51 });
  model.key('ArrowUp', true);
  assert.equal(model.value.y, 0.511, 'Shift: a tenth of a step');
  model.key('PageDown');
  assert.equal(Math.round(model.value.y * 1000), 411);
  model.key('End');
  model.key('ArrowLeft');
  assert.equal(model.value.x, 6);
  model.key('Home');
  assert.equal(model.value.x, 0);
  assert.equal(model.key('ArrowDown', false, 'x'), true, 'a slider steps its own axis');
  assert.equal(model.value.x, 0, 'clamped at the low end');
  assert.equal(model.key('q'), false);
  model.gate(true);
  model.gate(true);
  model.gate(false);
  assert.deepEqual(gates(), [[true, 'touch'], [false, 'release']]);
  model.reset();
  assert.deepEqual(model.value, { x: 3, y: 0.5 });
});

// ---------------------------------------------------------------- the XY tab on the panel

test('the XY tab: the pad is a module of the Synth panel, unpatched until the voice is', () => {
  assert.ok(PANEL.tabs.some((t) => t.id === 'xy' && t.label === 'XY'));
  assert.deepEqual(PANEL.modulesOf('xy').map((m) => [m.id, m.node]), [['xy', 'xy-pad']]);
  assert.ok(!PANEL.normals.some((n) => n.from.startsWith('xy.')), 'no normals: cables only');
  const st = panelStore();
  const m = st.getModel();
  assert.ok(PANEL.resolve(m).get('xy'), 'inserted with the panel');
  assert.equal(xyPatched(m, PANEL), false);
  const r = st.dispatch(xyCablesAction(m, PANEL, XY_VOICE).action);
  assert.equal(r.ok, true);
  assert.equal(xyPatched(st.getModel(), PANEL), true);
  const props = st.getModel().graph.edges.find((e) => e.to.node === PANEL.resolve(m)
    .get('vco1').id && e.to.port === 'pitch').props;
  assert.deepEqual([props.depth, props.polarity, props.mapping], [6, 'bipolar', 'linear'],
    'the pad pitch tracks 1.00 oct per octave, as the keyboard normal it replaces');
  assert.ok(!st.getModel().graph.edges.some((e) => e.id === `${PANEL.instance}-n1`),
    'the cable broke the keyboard pitch normal');
  st.undo();
  assert.equal(serializeStudio(st.getModel()), serializeStudio(m), 'one undo restores it all');
  const link = decodeSynthLink('#m=synth&yt=xy&yc=xy.pitch>vco1.pitch', PANEL, PRESETS);
  assert.equal(link.ok, true, link.reason);
  assert.equal(link.link.tab, 'xy');
});

test('Y maps onto the target range through its CONTROL edge; moving Y is one BATCH', () => {
  const st = panelStore();
  const m0 = st.getModel();
  const targets = xyTargets(PANEL).map((t) => t.id);
  assert.ok(targets.includes('lpf.frequency') && targets.includes('hpf.frequency'));
  assert.ok(!targets.some((t) => /\.(pitch|fm)$/.test(t)), 'no pitch input is a timbre target');
  assert.equal(st.dispatch(xyTargetAction(m0, PANEL, 'lpf.frequency').action).ok, true);
  const m1 = st.getModel();
  assert.equal(xyTarget(m1, PANEL), 'lpf.frequency');
  const e = m1.graph.edges.find((x) => x.from.node === PANEL.resolve(m1).get('xy').id
    && x.from.port === 'y');
  assert.deepEqual([e.props.polarity, e.props.mapping], ['unipolar', 'log']);
  // The compiler's edge law (compiler.js computeBases): range [lo, hi] onto [0, depth] octaves.
  const [lo, hi] = SOURCE_RANGES['xy-pad'].y.range;
  const oct = (y) => ((e.props.depth - 0) / (hi - lo)) * (y - lo) + e.props.offset;
  assert.deepEqual([oct(0), oct(1)], [0, e.props.depth], 'Y 0 is the knob, Y 1 depth octaves up');
  assert.ok(e.props.depth > 0);
  const r = st.dispatch(xyTargetAction(m1, PANEL, 'hpf.frequency').action);
  assert.equal(r.ok, true);
  const m2 = st.getModel();
  assert.equal(xyTarget(m2, PANEL), 'hpf.frequency');
  assert.ok(m2.graph.edges.some((x) => x.id === `${PANEL.instance}-n22`),
    'the low-pass normal the old cable broke is back');
  st.undo();
  assert.equal(serializeStudio(st.getModel()), serializeStudio(m1), 'one entry');
  assert.equal(xyTargetAction(m1, PANEL, 'lpf.frequency').action.steps.length, 0, 'same jack');
});

// ---------------------------------------------------------------- presets are patches

test('each XY preset is an ordinary patch: category xy, its scale, the panel and its cables', () => {
  for (const recipe of XY_RECIPES) {
    const st = panelStore();
    const m0 = st.getModel();
    const patch = xyPresetPatch(m0, PANEL, recipe);
    assert.equal(patch.kind, 'oscilla-patch');
    assert.equal(patch.category, XY_CATEGORY);
    assert.deepEqual(patch.scale, recipe.scale);
    const again = importPatch(JSON.parse(serializePatch(patch)));
    assert.equal(again.ok, true, again.errors && again.errors[0].message);
    assert.deepEqual([again.patch.category, again.patch.scale], [XY_CATEGORY, recipe.scale],
      'the fields survive the library round trip');
    assert.deepEqual(serializeStudio(st.getModel()), serializeStudio(m0), 'making it edits nothing');
    const a = xyPatchAction(m0, PANEL, patch);
    assert.equal(a.action.type, 'BATCH');
    assert.equal(st.dispatch(a.action).ok, true, recipe.id);
    const m1 = st.getModel();
    const pad = PANEL.resolve(m1).get('xy');
    assert.deepEqual([pad.params.mode, pad.params.key], [recipe.scale.mode, recipe.scale.key]);
    for (const [k, v] of recipe.values) assert.equal(pad.params[k.split('.')[1]], v, k);
    assert.equal(xyTarget(m1, PANEL), recipe.y);
    assert.equal(xyPatched(m1, PANEL), true);
    const cables = panelCables(m1, PANEL).map((c) => `${c.from}>${c.to}`);
    for (const [f, t] of XY_VOICE) assert.ok(cables.includes(`${f}>${t}`), `${f}>${t}`);
    st.undo();
    assert.equal(serializeStudio(st.getModel()), serializeStudio(m0), `${recipe.id}: one undo`);
  }
  assert.ok(XY_RECIPES.every((r) => !/korg|kaoss|roland|ableton/i.test(r.name)), 'generic names');
});

test('a saved XY patch loads back to the same panel state; one without a pad is refused', () => {
  const st = panelStore();
  st.dispatch(xyPatchAction(st.getModel(), PANEL, xyPresetPatch(st.getModel(), PANEL,
    XY_RECIPES[1])).action);
  const saved = st.getModel();
  const patch = xyPatchOf(saved, PANEL, { name: 'Mine' });
  const other = panelStore();
  assert.equal(other.dispatch(xyPatchAction(other.getModel(), PANEL, patch).action).ok, true);
  const res = PANEL.resolve(other.getModel());
  for (const [mid, n] of PANEL.resolve(saved)) {
    if (n) assert.deepEqual(res.get(mid).params, n.params, mid);
  }
  assert.deepEqual(panelCables(other.getModel(), PANEL).map((c) => [c.from, c.to]).sort(),
    panelCables(saved, PANEL).map((c) => [c.from, c.to]).sort());
  const bare = { ...patch, graph: { ...patch.graph,
    nodes: patch.graph.nodes.filter((n) => n.type !== 'xy-pad') } };
  assert.match(xyPatchAction(saved, PANEL, bare).reason, /holds no XY pad/);
});

test('a patch envelope with a bad category or scale is refused with its sentence', () => {
  const st = panelStore();
  const patch = xyPresetPatch(st.getModel(), PANEL, XY_RECIPES[0]);
  for (const [bad, path] of [[{ category: 'XY!' }, 'category'],
    [{ scale: { mode: 'gypsy', key: 'C' } }, 'scale.mode'],
    [{ scale: { mode: 'major', key: 'H' } }, 'scale.key'],
    [{ scale: { mode: 'major', key: 'C', extra: 1 } }, 'scale.extra']]) {
    const r = importPatch({ ...patch, ...bad });
    assert.equal(r.ok, false, JSON.stringify(bad));
    assert.equal(r.errors[0].path, path);
  }
});

// ---------------------------------------------------------------- rollback

test('a document with an xy-pad is refused by name by a registry without the type', () => {
  const st = panelStore();
  const doc = JSON.parse(serializeStudio(st.getModel()));
  const without = createNodeRegistry(NODE_DEFINITIONS.filter((d) => d.type !== 'xy-pad'));
  const r = importStudio(doc, { registry: without });
  assert.equal(r.ok, false, 'never dropped silently');
  assert.ok(r.errors.some((e) => /xy-pad/.test(e.message)), r.errors.map((e) => e.message)
    .join(' | '));
  assert.equal(importStudio(doc).ok, true);
});
