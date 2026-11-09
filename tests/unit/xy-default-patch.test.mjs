// K183 (option B): the XY pad sounds on first touch in the default Synth document. The pad is
// one more note input of K178's one Keys source, so the default document needs no Pitch or Gate
// cable: the keyboard's normals stay intact and a computer key and a pad touch both sound. Y is
// an ordinary, typed model cable xy.y -> lpf.frequency that the Synth's insertion adds
// (synth/xy.js xyInsertAction, the insert path of synth/ui.js ensurePanel and the picker's New
// Synth voice), visible in the panel's cable list and removable; as a performance output it
// adds to LPF Cutoff's EG 2 and MG normals rather than replacing them (synth/normals.js), and
// removing it leaves the pad playing pitch only.
//
// The reviewer's conditions on that design (K183, af 2026-11-05): the Y cable is drawn and named
// as summing in the bay (jackState 'summing': the normal's inner glyph, the cable's colour on the
// ring, "normalled, plus XY PAD Y" in the jack's name, "přičítá se k normálům" in the cable list), Y is 0 until the first
// touch, the sum stays within LPF Cutoff's declared range (compiler.js computeBases holds the
// upward excursion of every log edge at min(max, 0.95 x Nyquist); Y is unipolar with offset 0,
// so it adds nothing downward), and n21 and n22 stay active edges of the running plan beside it.
//
//   node --test tests/unit/xy-default-patch.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import PANEL from '../../src/js/synth/panels/semi-mono.js';
import * as xy from '../../src/js/synth/xy.js';
import {
  jackState, panelCables, panelEdges, patchCable, unpatch,
} from '../../src/js/synth/normals.js';
import { NODE_REGISTRY } from '../../src/js/studio/registry.js';
import { canConnect, validateEdgeProps } from '../../src/js/studio/ports.js';
import { createIdGenerator, createStudioStore } from '../../src/js/studio/actions.js';
import { templateModel, REFERENCE_TEMPLATE_ID } from '../../src/js/studio/templates/index.js';
import { KEY_ROUTES } from '../../src/js/midi/routes.js';
import { createMidiNotes } from '../../src/js/midi/notes.js';
import { createSynthNotes } from '../../src/js/synth/notes-sink.js';
import { SYNTH_TEXT } from '../../src/js/synth/insert.js';
import { AudioEngine } from '../../src/js/audio/audio-engine.js';
import { createStudioRuntime } from '../../src/js/studio/runtime.js';
import { createStudioTransport } from '../../src/js/studio/transport.js';
import { computeBases } from '../../src/js/studio/compiler.js';
import { liveModel } from '../../src/js/studio/live-notes.js';
import { CENTS_PER_OCTAVE } from '../../src/js/core/music.js';
import * as bay from '../../src/js/synth/view/bay.js';
import { CABLE_TOKENS, PANEL_TOKENS } from '../../src/js/synth/view/tokens.js';
import { setAmount, STATE_TEXT } from '../../src/js/synth/normals.js';
import { createFakeAudioEnv } from './sequencer-fake-audio.mjs';

const ROOT = new URL('../../', import.meta.url).pathname;
const KEYS_NORMALS = ['n1', 'n2', 'n3', 'n4']; // Keys pitch into both VCOs, gate into both EGs
const LPF_NORMALS = ['n21', 'n22']; // MG and EG 2 into LPF Cutoff

/** The default Synth document: the reference template with the panel the Synth inserts. */
function insertedStore() {
  const st = createStudioStore(templateModel(REFERENCE_TEMPLATE_ID),
    { idGenerator: createIdGenerator() });
  assert.equal(typeof xy.xyInsertAction, 'function', 'synth/xy.js exports xyInsertAction');
  const a = xy.xyInsertAction(st.getModel(), PANEL, { at: { x: 0, y: 600 } });
  assert.equal(a.type, 'BATCH', 'one BATCH: one undo entry');
  const r = st.dispatch(a);
  assert.equal(r.ok, true, r.reason);
  return st;
}
/**
 * The default document with Y cabled into LPF Cutoff, as K183's insertion made it and as the XY
 * lead preset or a user still makes it: since K220 the insertion cables nothing (the filter
 * axis moved to pad L), so the tests of a Y cable's behaviour patch it here.
 */
function cabledStore() {
  const st = insertedStore();
  const a = xy.xyTargetAction(st.getModel(), PANEL, 'lpf.frequency');
  assert.ok(a.action, a.reason);
  assert.equal(st.dispatch(a.action).ok, true);
  return st;
}
const ids = (model) => {
  const res = PANEL.resolve(model);
  return (mid) => res.get(mid).id;
};
const live = (model, list) => {
  const { normals } = panelEdges(model, PANEL);
  return list.filter((n) => normals.has(n));
};

test('K220: the default Synth document cables nothing from pad R; pad L\'s X and Y are the '
  + 'typed normals into LPF and HPF Cutoff', () => {
  // The coordinator oscilla-43's decision of 2026-11-09: the filter axis moved to pad L, and
  // pad R's Y sets the velocity of the notes it plays (K183 cabled xy.y into LPF Cutoff here).
  const st = insertedStore();
  const m = st.getModel();
  const id = ids(m);
  assert.equal(m.graph.edges.filter((e) => e.from.node === id('xy')).length, 0,
    'no cable leaves pad R');
  assert.deepEqual(panelCables(m, PANEL), [], 'the insertion adds no cable');
  assert.equal(xy.xyTarget(m, PANEL), null);
  // Pad L: two normals, each a typed CONTROL edge the registry allows, log and unipolar.
  const padL = m.graph.edges.filter((e) => e.from.node === id('xyl'));
  assert.deepEqual(padL.map((e) => [e.from.port, e.to.node, e.to.port]).sort(),
    [['x', id('lpf'), 'frequency'], ['y', id('hpf'), 'frequency']]);
  for (const e of padL) {
    const out = NODE_REGISTRY.port('xy-pad', e.from.port, 'out');
    const inp = NODE_REGISTRY.port('filter', 'frequency', 'in');
    const v = canConnect(out, inp, { sourceNodeId: e.from.node, targetNodeId: e.to.node });
    assert.equal(v.allowed, true, v.reason);
    assert.equal(v.signalType, 'CONTROL');
    assert.deepEqual([e.props.mapping, e.props.polarity], ['log', 'unipolar']);
  }
  // The keyboard's normals are intact and LPF Cutoff keeps its MG and EG 2 normals beside pad L.
  assert.equal(xy.xyPatched(m, PANEL), false);
  assert.deepEqual(live(m, KEYS_NORMALS), KEYS_NORMALS);
  assert.deepEqual(live(m, LPF_NORMALS), LPF_NORMALS);
  assert.equal(jackState(m, PANEL, 'lpf.frequency'), 'normalled');
});

test('the Synth inserts the panel through xyInsertAction, on every insert path', () => {
  const code = (p) => readFileSync(`${ROOT}${p}`, 'utf8').replace(/^\s*\/\/.*$/gm, '');
  // The one insert path (insert.js insertAction, review S5); ensurePanel and New Synth voice go
  // through it, and none instantiates the panel bare.
  assert.match(code('src/js/synth/insert.js'), /xyInsertAction\(/, 'insert.js inserts the panel');
  for (const p of ['src/js/synth/ui.js', 'src/js/synth/picker.js']) {
    assert.match(code(p), /\binsertAction\(/, `${p} inserts through insert.js`);
  }
  for (const p of ['src/js/synth/insert.js', 'src/js/synth/ui.js', 'src/js/synth/picker.js']) {
    assert.doesNotMatch(code(p), /panel\.instantiate\(/, `${p}: no bare instantiate`);
  }
  // K220: the insertion adds no cable at all, over an empty document or a reused panel.
  const st = cabledStore();
  const again = xy.xyInsertAction(st.getModel(), PANEL);
  assert.ok(!again.steps.some((s) => s.type === 'EDGE_ADD' && s.from
    && s.from.node === ids(st.getModel())('xy')), 'no pad R cable is added');
});

test('the pad\'s notes reach the voice through the one Keys source, last-note priority; a '
  + 'computer key sounds beside it', () => {
  assert.equal(KEY_ROUTES.synth.plays, 'synthSink', 'the Synth\'s keys play the Synth sink');
  const st = cabledStore();
  const fx = createFakeAudioEnv({ sampleRate: 48000 });
  const engine = new AudioEngine({ env: fx.env });
  assert.ok(engine.init());
  const t = createStudioTransport({ runtime: createStudioRuntime({ engine }), engine, store: st });
  const nodes = () => PANEL.resolve(st.getModel());
  const said = [];
  const sink = createSynthNotes({ get: () => ({ transport: t, handle: st }), transport: () => t,
    ensurePanel: () => true, cmp: () => null, say: (x) => said.push(x),
    played: () => nodes().get('keys'), playedModule: () => 'keys', present: () => true, nodes,
    panel: PANEL, ENGINE_IDS: [], syncArmed: () => {} });
  const notes = createMidiNotes({ engine: null, route: () => sink });
  const key = notes.noteOn(60, 100, 'kbd-key'); // the computer key arms the Synth
  assert.equal(key.ok, true, 'a computer key sounds: its normals are intact');
  assert.equal(said.at(-1), SYNTH_TEXT.plays(PANEL.title),
    'the status says what the keys and the pad play, named from the routed node (S6)');
  const pad = notes.noteOn(63, 100, 'kbd-xy'); // the pad's touch
  assert.equal(pad.ok, true);
  assert.equal(pad.top, 63, 'last-note priority: the pad\'s note sounds');
  const moved = notes.legato(63, 67, 'kbd-xy'); // into another cell
  assert.equal(moved.top, 67);
  assert.equal(moved.retrigger, false, 'a legato: no new gate');
  assert.deepEqual([...t.heldNotes()].sort(), [60, 67]);
  notes.noteOff(67, 'kbd-xy');
  assert.deepEqual(t.heldNotes(), [60], 'the key\'s note returns');
  notes.noteOn(65, 100, 'kbd-xy');
  assert.equal(notes.releaseInput('xy'), 1, 'the xy input releases on its own (held-notes)');
  assert.deepEqual(t.heldNotes(), [60], 'the keys\' own note stays');
  notes.noteOff(60, 'kbd-key');
  assert.deepEqual(t.heldNotes(), []);
  t.stop({ fast: true });
  fx.advance(1);
});

test('removing the Y cable leaves the pad playing pitch only; the normals are as they were', () => {
  const st = cabledStore();
  const m = st.getModel();
  const cable = panelCables(m, PANEL).find((c) => c.from === 'xy.y');
  const r = unpatch(m, PANEL, cable.id);
  assert.ok(r.action, r.reason);
  assert.equal(st.dispatch(r.action).ok, true);
  const after = st.getModel();
  assert.equal(xy.xyTarget(after, PANEL), null, 'Y drives nothing');
  assert.equal(after.graph.edges.filter((e) => e.from.node === ids(after)('xy')).length, 0);
  assert.deepEqual(live(after, [...KEYS_NORMALS, ...LPF_NORMALS]),
    [...KEYS_NORMALS, ...LPF_NORMALS], 'the keys and the filter keep every normal');
  st.undo();
  assert.equal(xy.xyTarget(st.getModel(), PANEL), 'lpf.frequency', 'Undo gives it back');
});

test('a performance cable adds; any other cable still replaces the normals, and removing it '
  + 'restores them beside the Y cable', () => {
  const st = cabledStore();
  // Y into HPF Cutoff: its MG and EG 2 normals stay.
  const y = patchCable(st.getModel(), PANEL, 'xy.y', 'hpf.frequency');
  assert.ok(y.action, y.reason);
  assert.ok(!y.action.steps.some((s) => s.type === 'EDGE_REMOVE'), 'Y breaks no normal');
  assert.equal(st.dispatch(y.action).ok, true);
  assert.deepEqual(live(st.getModel(), ['n19', 'n20']), ['n19', 'n20']);
  // MG into LPF Cutoff (the jacks of a normal): a cable that replaces n21 and n22.
  const mg = patchCable(st.getModel(), PANEL, 'mg.control', 'lpf.frequency');
  assert.deepEqual(mg.action.steps[0].type, 'EDGE_REMOVE');
  assert.equal(st.dispatch(mg.action).ok, true);
  assert.deepEqual(live(st.getModel(), LPF_NORMALS), []);
  assert.equal(jackState(st.getModel(), PANEL, 'lpf.frequency'), 'patched');
  const id = panelCables(st.getModel(), PANEL).find((c) => c.from === 'mg.control').id;
  assert.equal(st.dispatch(unpatch(st.getModel(), PANEL, id).action).ok, true);
  assert.deepEqual(live(st.getModel(), LPF_NORMALS), LPF_NORMALS,
    'removing the last replacing cable restores the normals, the Y cable staying');
  assert.equal(xy.xyTarget(st.getModel(), PANEL) !== null, true);
  // The pad's Pitch is no performance output: a cable from it replaces the Keys normal.
  const pitch = patchCable(st.getModel(), PANEL, 'xy.pitch', 'vco1.pitch');
  assert.equal(pitch.action.steps[0].type, 'EDGE_REMOVE');
  assert.deepEqual(PANEL.module('xy').adds, ['x', 'y']);
});

/** The default document running on the fake engine at `sampleRate`: { st, rt, fx }. */
function runningDefault(sampleRate, edit = null, make = cabledStore) {
  const st = make();
  if (edit) edit(st);
  const fx = createFakeAudioEnv({ sampleRate });
  const engine = new AudioEngine({ env: fx.env });
  assert.ok(engine.init());
  const rt = createStudioRuntime({ engine });
  const r = rt.apply(liveModel(st.getModel()), { revision: 1 });
  assert.equal(r.ok, true, r.reason);
  assert.equal(rt.start().ok, true);
  return { st, rt, fx };
}

test('the bay draws and names the Y cable as summing into LPF Cutoff', () => {
  const m = cabledStore().getModel();
  // Each role as its token's name, so the roles can be told apart (no page to resolve them).
  const tokens = { ...Object.fromEntries(Object.entries(PANEL_TOKENS)
    .map(([k, name]) => [k, `var(${name})`])), cables: CABLE_TOKENS.map((n) => `var(${n})`) };
  const layout = bay.bayLayout(PANEL, 376);
  const states = new Map(PANEL.modules.flatMap((mod) => PANEL.jacksOf(mod.id))
    .filter((j) => j.direction === 'in').map((j) => [j.key, jackState(m, PANEL, j.id)]));
  assert.equal(states.get('lpf.frequency:in'), 'summing');
  assert.equal(states.get('hpf.frequency:in'), 'normalled', 'a jack no cable feeds');
  const cables = panelCables(m, PANEL).map((c) => ({ ...c, type: 'CONTROL' }));
  const svg = bay.baySvg({ panel: PANEL, layout, cables, states, tokens });
  const jack = (key) => svg.match(new RegExp(`<g role="button"[^>]*data-jack="${key}"[^>]*>`
    + '.*?</g>'))[0];
  const ring = (g) => g.match(/data-ring="" fill="[^"]+" stroke="([^"]+)"/)[1];
  const inner = (g) => g.match(/data-ring="[^>]*\/>[^>]*fill="([^"]+)"/)[1];
  const order = PANEL.modules.map((x) => x.id);
  const colour = tokens.cables[order.indexOf('xy') % tokens.cables.length];
  const sum = jack('lpf.frequency:in');
  const plain = jack('hpf.frequency:in');
  assert.match(sum, /aria-label="LPF Cutoff input, control, normalled, plus XY PAD Y"/,
    'the jack names its normals and the cable that adds to them');
  assert.equal(STATE_TEXT.summing, 'normalled, plus a performance cable');
  assert.equal(inner(sum), tokens.normal, 'the normals still sound: the normal\'s inner glyph');
  assert.equal(ring(sum), colour, 'the cable joins it: the ring takes the cable\'s colour');
  assert.equal(ring(plain), tokens.jackRing);
  assert.notEqual(ring(sum), ring(plain), 'summing is drawn apart from a plain normal');
  assert.doesNotMatch(sum, /stroke-dasharray/, 'not the dashed warning of open or mixed');
  assert.match(svg, new RegExp(`data-cable="${cables[0].id}"`), 'the cable itself is drawn');
  // A replacing cable is drawn as patched, not summing: the inner glyph takes its colour.
  const st = cabledStore();
  const mg = patchCable(st.getModel(), PANEL, 'mg.control', 'lpf.frequency');
  assert.equal(st.dispatch(mg.action).ok, true);
  assert.equal(jackState(st.getModel(), PANEL, 'lpf.frequency'), 'patched');
  // The CABLES list's rows: N5 and F2 below render them.
});

test('Y is 0 until the first touch: the pad\'s Y output rests at 0 in the running document',
  () => {
    const { st, rt } = runningDefault(48000);
    const h = rt.nodes.get(ids(st.getModel())('xy'));
    assert.ok(h && h.outputs && h.outputs.y, 'the pad\'s handle has its Y output');
    const ev = h.outputs.y.offset.events;
    assert.ok(ev.length > 0, 'its offset is set');
    assert.deepEqual([...new Set(ev.map((e) => e.value))], [0], 'every value before a touch: 0');
    h.move(0.01, 0.5, 1);
    assert.equal(h.outputs.y.offset.events.at(-1).value, 1, 'a touch at the top: Y 1');
    rt.stop?.();
  });

test('the sum stays within LPF Cutoff\'s declared range: normals at their amounts, pad L at 1',
  () => {
  const p = NODE_REGISTRY.param('filter', 'frequency');
  const lpfAt = (st) => ids(st.getModel())('lpf');
  // The default amounts, and the worst case: Cutoff at its top, both amounts at their top.
  const worst = (st) => {
    const m = st.getModel();
    const knob = PANEL.resolve(m).get('lpf');
    assert.equal(st.dispatch({ type: 'NODE_PARAM_SET', nodeId: knob.id,
      params: { frequency: p.max } }).ok, true);
    for (const id of ['lpf-mg', 'lpf-eg2']) {
      const a = PANEL.amounts.find((x) => x.id === id);
      assert.equal(st.dispatch(setAmount(st.getModel(), PANEL, a, a.range[1])).ok, true);
    }
  };
  for (const sampleRate of [44100, 48000]) {
    for (const edit of [null, worst]) {
      // K220: the default document, where pad L's X (n25) sweeps LPF Cutoff beside n21 and n22.
      const { st, rt } = runningDefault(sampleRate, edit, insertedStore);
      const id = lpfAt(st);
      const plan = rt.plan;
      const incoming = plan.edgeOrder.map((e) => plan.edges.get(e))
        .filter((e) => e.to.node === id && e.kind === 'control')
        .map((edge) => ({ edge, handle: rt.edges.get(edge.id) }));
      assert.equal(incoming.length, 3, 'n21, n22 and pad L\'s X normal n25');
      const safeMaximum = 0.95 * (sampleRate / 2);
      const cb = computeBases(plan.nodes.get(id), incoming, { safeMaximum });
      // The played cutoff: base Hz x 2^(cents / 1200), every edge's source at the extreme that
      // moves it farthest (Y at 1 is its top: unipolar 0..1).
      const extreme = (pick) => incoming.reduce((c, { edge, handle }) => {
        const g = cb.gains.get(edge.id);
        const [lo, hi] = handle.range;
        return c + pick(g * lo, g * hi);
      }, cb.base.frequency.cents);
      const top = cb.base.frequency.value * 2 ** (extreme(Math.max) / CENTS_PER_OCTAVE);
      const cap = Math.min(p.max, safeMaximum);
      assert.equal(cb.caps.frequency.value, cap);
      assert.ok(top <= cap * (1 + 1e-9), `${sampleRate} Hz ${edit ? 'worst' : 'default'}: `
        + `${top} Hz <= ${cap} Hz`);
      assert.ok(top <= p.max, 'inside the parameter\'s declared maximum');
      // Pad L adds nothing downward (unipolar, offset 0): the lowest cutoff is the normals' own.
      const y = incoming.find(({ edge }) => edge.from.node === ids(st.getModel())('xyl'));
      assert.deepEqual([y.edge.props.polarity, y.edge.props.offset], ['unipolar', 0]);
      assert.equal(Math.min(0, cb.gains.get(y.edge.id) * y.handle.range[0]), 0);
      if (!edit) {
        const low = cb.base.frequency.value * 2 ** (extreme(Math.min) / CENTS_PER_OCTAVE);
        assert.ok(low >= p.min, `the default lowest cutoff ${low} Hz >= ${p.min} Hz`);
        assert.equal(cb.limited.size, 0, 'at the default amounts nothing needs scaling');
      } else {
        assert.ok(cb.limited.has(y.edge.id), 'in the worst case the Y excursion is scaled');
      }
    }
  }
});

test('n21 and n22 stay active edges of the running plan with the Y cable in place', () => {
  const { st, rt } = runningDefault(48000);
  const m = st.getModel();
  const want = LPF_NORMALS.map((n) => `${PANEL.instance}-${n}`);
  const y = m.graph.edges.find((e) => e.from.node === ids(m)('xy'));
  for (const eid of [...want, y.id]) {
    const pe = rt.plan.edges.get(eid);
    assert.ok(pe, `${eid} is compiled`);
    assert.equal(pe.status, 'active', `${eid} is an active plan edge`);
    assert.equal(pe.to.node, ids(m)('lpf'));
    assert.equal(pe.to.port, 'frequency');
    assert.equal(rt.edges.get(eid).status, 'active', `${eid} is routed in the runtime`);
  }
  assert.deepEqual(live(m, LPF_NORMALS), LPF_NORMALS, 'and they are the panel\'s normals');
});

test('Y never takes any target past its declared range: Hz targets capped, linear ones fitted',
  () => {
    // Every target Y may drive (xyTargets), its base at the bottom, the middle and the top of
    // its range: what Y adds at its top (unipolar 0..1) stays inside the range the base and the
    // other cables leave; a frequency stays at or below min(max, 0.95 x Nyquist) (review F7).
    const sampleRate = 48000;
    const safeMaximum = 0.95 * (sampleRate / 2);
    let fitted = 0;
    let checked = 0;
    for (const t of xy.xyTargets(PANEL)) {
      // A target the panel refuses Y (S&H Rate while its Clock is normalled) has no cable.
      if (!xy.xyTargetAction(cabledStore().getModel(), PANEL, t.id).action) continue;
      checked += 1;
      const [mid, port] = t.id.split('.');
      const def = NODE_REGISTRY.param(PANEL.module(mid).node, port);
      for (const at of [def.min, (def.min + def.max) / 2, def.max]) {
        const { st, rt } = runningDefault(sampleRate, (s) => {
          const a = xy.xyTargetAction(s.getModel(), PANEL, t.id);
          assert.ok(a.action, a.reason);
          if (a.action.steps.length) assert.equal(s.dispatch(a.action).ok, true, t.id);
          const node = PANEL.resolve(s.getModel()).get(mid);
          assert.equal(s.dispatch({ type: 'NODE_PARAM_SET', nodeId: node.id,
            params: { [port]: at } }).ok, true, `${t.id} = ${at}`);
        });
        const m = st.getModel();
        const id = ids(m)(mid);
        const plan = rt.plan;
        const incoming = plan.edgeOrder.map((e) => plan.edges.get(e))
          .filter((e) => e.to.node === id && e.kind === 'control' && e.to.port === port)
          .map((edge) => ({ edge, handle: rt.edges.get(edge.id) }));
        const y = incoming.find(({ edge }) => edge.from.node === ids(m)('xy'));
        assert.ok(y && y.handle.status === 'active', `${t.id}: the Y cable is routed`);
        const cb = computeBases(plan.nodes.get(id), incoming, { safeMaximum });
        const b = cb.base[port];
        const ext = (list, pick) => list.reduce((s, { edge, handle }) => {
          const g = cb.gains.get(edge.id) || 0;
          return s + pick(g * handle.range[0], g * handle.range[1]);
        }, 0);
        const others = incoming.filter((x) => x !== y);
        const at1 = `${t.id} at ${at}`;
        if (def.unit === 'Hz') {
          const top = b.value * 2 ** ((b.cents + ext(incoming, Math.max)) / CENTS_PER_OCTAVE);
          assert.ok(top <= Math.min(def.max, safeMaximum) * (1 + 1e-9), `${at1}: ${top} Hz`);
          continue;
        }
        assert.equal(y.handle.fit, true, `${t.id}: Y is a performance output (its cable fits)`);
        const rest = b.value + ext(others, Math.max);
        const yUp = ext([y], Math.max);
        assert.ok(yUp >= 0 && yUp <= Math.max(0, def.max - rest) + 1e-9,
          `${at1}: Y adds ${yUp}, the range leaves ${def.max - rest}`);
        assert.ok(b.value + ext(incoming, Math.max) <= Math.max(def.max, rest) + 1e-9, at1);
        assert.ok(ext([y], Math.min) >= 0, `${at1}: Y adds nothing downward`);
        if (cb.limited.has(y.edge.id)) fitted += 1;
      }
    }
    assert.ok(checked >= 10, `every target Y may take is checked (${checked})`);
    assert.ok(fitted > 0, 'some base leaves Y less than its depth: the fit is exercised');
  });

test('a legato opens no new gate: the Keys envelopes are gated once for the held note', async () => {
  // Observed on the envelopes, not on the returned retrigger flag (review F8): the pad's move
  // into another scale cell glides the Keys pitch and leaves EG 1 and EG 2 where they are.
  const { createLiveNotes } = await import('../../src/js/studio/live-notes.js');
  const m = cabledStore().getModel();
  const id = ids(m);
  const calls = [];
  const keys = { play: (at, note, v, o) => calls.push(['play', note, !!(o && o.legato)]),
    priority: () => 'last' };
  const env = (name) => ({ gate: () => calls.push(['gate', name]),
    release: () => calls.push(['release', name]) });
  const handles = new Map([[id('keys'), keys], [id('eg1'), env('eg1')], [id('eg2'), env('eg2')]]);
  const ln = createLiveNotes({ getModel: () => m, handleOf: (n) => handles.get(n) || null });
  ln.event(id('keys'), { kind: 'on', note: 60, velocity: 100, at: 0 });
  const gates = () => calls.filter((c) => c[0] === 'gate').length;
  assert.equal(gates(), 2, 'the first note gates EG 1 and EG 2 once');
  const r = ln.event(id('keys'), { kind: 'legato', from: 60, note: 64, velocity: 100, at: 0.1 });
  assert.equal(r.top, 64);
  assert.equal(gates(), 2, 'the legato opened no gate');
  assert.deepEqual(calls.at(-1), ['play', 64, true], 'it moved the pitch as a legato');
  assert.equal(calls.filter((c) => c[0] === 'release').length, 0, 'and released nothing');
  ln.event(id('keys'), { kind: 'off', note: 64, at: 0.2 });
  assert.equal(calls.filter((c) => c[0] === 'release').length, 2, 'the lift releases both');
});

test('Y is 0 until the first touch: an armed Synth hears no X or Y from the mount or an arrow',
  async () => {
    // Review F1: the keys arm the Synth first (the transport plays), then the XY tab mounts and
    // nobody touches the pad; an arrow on the focused pad without a gate moves only the cursor.
    const { mountSynthXy } = await import('../../src/js/synth/view/xy-wiring.js');
    const { createXyModel } = await import('../../src/js/ui/kinds/xy-pad.js');
    const st = cabledStore();
    const fx = createFakeAudioEnv({ sampleRate: 48000 });
    const engine = new AudioEngine({ env: fx.env });
    assert.ok(engine.init());
    const runtime = createStudioRuntime({ engine });
    const real = createStudioTransport({ runtime, engine, store: st });
    const evs = [];
    const transport = Object.create(real, { live: { value: (nid, ev) => {
      evs.push([nid, { ...ev }]);
      return real.live(nid, ev);
    } } });
    const nodes = () => PANEL.resolve(st.getModel());
    const sink = createSynthNotes({ get: () => ({ transport, handle: st }),
      transport: () => transport, ensurePanel: () => true, cmp: () => null, say: () => {},
      played: () => nodes().get('keys'), playedModule: () => 'keys', present: () => true, nodes,
      panel: PANEL, ENGINE_IDS: [], syncArmed: () => {} });
    const layer = createMidiNotes({ engine: null, route: () => sink });
    assert.equal(layer.noteOn(60, 100, 'kbd-key').ok, true, 'a computer key arms the Synth');
    layer.noteOff(60, 'kbd-key');
    assert.equal(real.playing, true);
    const fake = () => {
      const kids = new Map();
      return { setAttribute() {}, hasAttribute: () => false, removeAttribute() {},
        innerHTML: '', textContent: '', hidden: false, value: '', selectedOptions: [{ text: '' }],
        addEventListener() {}, removeEventListener() {},
        querySelector(sel) {
          if (!kids.has(sel)) kids.set(sel, fake());
          return kids.get(sel);
        } };
    };
    const mountPad = (box, opts) => {
      const model = createXyModel(opts);
      return { model, update() {}, destroy() { model.end('hide'); } };
    };
    const padId = nodes().get('xy').id;
    const padEvs = () => evs.filter(([nid]) => nid === padId).map(([, e]) => e);
    const mount = mountSynthXy(fake(), { store: st, transport, panel: PANEL, app: null,
      notes: { noteOn: (...a) => layer.noteOn(...a), noteOff: (...a) => layer.noteOff(...a),
        legato: (...a) => layer.legato(...a), velocity: () => 100, off() {} },
      arm: () => true, mountPad });
    const yOf = () => runtime.nodes.get(padId).outputs.y.offset.events.map((e) => e.value);
    assert.deepEqual(padEvs(), [], 'the mount sends the pad\'s node nothing');
    assert.ok(yOf().length > 0, 'the running pad node\'s Y is set');
    assert.deepEqual([...new Set(yOf())], [0], 'Y rests at 0');
    mount.view.model.key('ArrowUp');
    assert.deepEqual(padEvs(), [], 'an arrow without a gate moves only the cursor');
    assert.deepEqual([...new Set(yOf())], [0], 'Y still at 0');
    mount.view.model.gate(true); // Enter held, or a touch: the gate opens
    assert.equal(padEvs()[0].kind, 'on', 'the first touch is the first event the node hears');
    mount.view.model.key('ArrowUp');
    assert.equal(padEvs().at(-1).kind, 'move', 'with the gate open an arrow moves the node');
    mount.view.model.end('release');
    mount.destroy();
    real.stop({ fast: true });
    fx.advance(1);
  });

// ---------------------------------------------------------------- review of a31ad98c (N1-N6)

/** The armed default document, the pad mounted on the real kind model (no DOM): its readout,
 *  the runtime's pad handle and the transport's live calls. */
async function padRig(edit = null) {
  const { mountSynthXy } = await import('../../src/js/synth/view/xy-wiring.js');
  const { createXyModel } = await import('../../src/js/ui/kinds/xy-pad.js');
  const st = cabledStore();
  if (edit) edit(st);
  const fx = createFakeAudioEnv({ sampleRate: 48000 });
  const engine = new AudioEngine({ env: fx.env });
  assert.ok(engine.init());
  const runtime = createStudioRuntime({ engine });
  const transport = createStudioTransport({ runtime, engine, store: st });
  const nodes = () => PANEL.resolve(st.getModel());
  const sink = createSynthNotes({ get: () => ({ transport, handle: st }), transport: () => transport,
    ensurePanel: () => true, cmp: () => null, say: () => {}, played: () => nodes().get('keys'),
    playedModule: () => 'keys', present: () => true, nodes, panel: PANEL, ENGINE_IDS: [],
    syncArmed: () => {} });
  const layer = createMidiNotes({ engine: null, route: () => sink });
  assert.equal(layer.noteOn(60, 100, 'kbd-key').ok, true, 'a computer key arms the Synth');
  layer.noteOff(60, 'kbd-key');
  const kids = new Map();
  const fake = () => ({ setAttribute() {}, hasAttribute: () => false, removeAttribute() {},
    innerHTML: '', textContent: '', hidden: false, value: '', selectedOptions: [{ text: '' }],
    addEventListener() {}, removeEventListener() {},
    querySelector(sel) {
      if (!kids.has(sel)) kids.set(sel, fake());
      return kids.get(sel);
    } });
  const host = fake();
  const mount = mountSynthXy(host, { store: st, transport, panel: PANEL, app: null,
    notes: { noteOn: (...a) => layer.noteOn(...a), noteOff: (...a) => layer.noteOff(...a),
      legato: (...a) => layer.legato(...a), velocity: () => 100, off() {} },
    arm: () => true, mountPad: (box, opts) => {
      const model = createXyModel(opts);
      return { model, update() {}, destroy() { model.end('hide'); } };
    } });
  const padId = nodes().get('xy').id;
  return { st, fx, runtime, transport, mount, layer, model: mount.view.model,
    readout: () => host.querySelector('[data-osc="synth.xy.readout"]').textContent,
    y: () => runtime.nodes.get(padId).outputs.y.offset.events.at(-1).value,
    done() {
      mount.destroy();
      transport.stop({ fast: true });
      fx.advance(1);
    } };
}

test('N2: every release puts Y back at rest: the node, the cursor and the readout say 0',
  async () => {
    for (const how of ['lift', 'forced']) {
      const r = await padRig();
      r.model.gate(true); // a touch (Enter held) at the cursor
      for (let i = 0; i < 90; i += 1) r.model.key('ArrowUp'); // Y to 0.9 while it sounds
      assert.ok(Math.abs(r.y() - 0.9) < 1e-9, `${how}: Y plays 0.9 while touched`);
      // The target's value follows its name (S3, xyYReading): `lpf.frequency 7.21 kHz`.
      assert.match(r.readout(), /Y 90 % → lpf\.frequency [^·]+ · gate open/);
      if (how === 'lift') r.model.end('release');
      else r.mount.release('owner'); // a forced release (the audio owner moved away)
      assert.equal(r.y(), 0, `${how}: the node's Y is back at its rest`);
      assert.equal(r.model.value.y, 0, `${how}: the cursor is drawn at Y 0`);
      assert.match(r.readout(), /Y 0 % → lpf\.frequency/, `${how}: the readout says what sounds`);
      assert.doesNotMatch(r.readout(), /gate open/);
      // A computer key after it: nothing of the touch stays on the filter.
      r.layer.noteOn(60, 100, 'kbd-key');
      assert.equal(r.y(), 0, `${how}: the key plays with Y at rest`);
      r.layer.noteOff(60, 'kbd-key');
      // An arrow without a touch moves the cursor only, and the readout says so.
      r.model.key('ArrowUp');
      assert.equal(r.y(), 0);
      assert.match(r.readout(), /Y 0 % → lpf\.frequency [^·]+ · další dotek začne z Y 1 %/);
      r.done();
    }
  });

test('N1: a performance cable into an Oscillator\'s detune keeps the Nyquist headroom',
  async () => {
    // xy.y into the reference template's oscillator's detune, depth 1200 cents (linear), the
    // oscillator at 20 kHz with a detune of 100: the fit to detune's range (+-1200) must not
    // replace the headroom k that 0.95 x Nyquist leaves (V272 A7).
    for (const sampleRate of [44100, 48000]) {
      const st = cabledStore();
      const m0 = st.getModel();
      const osc = m0.graph.nodes.find((n) => n.type === 'oscillator');
      assert.ok(osc, 'the reference template has an oscillator');
      assert.equal(st.dispatch({ type: 'NODE_PARAM_SET', nodeId: osc.id,
        params: { frequency: 20000, detune: 100 } }).ok, true);
      for (const [id, fit] of [['y-detune', true], ['mg-detune', false]]) {
        const from = fit ? { node: ids(m0)('xy'), port: 'y' } : { node: ids(m0)('eg2'),
          port: 'control' };
        assert.equal(st.dispatch({ type: 'EDGE_ADD', id, from, to: { node: osc.id,
          port: 'detune' }, props: { muted: false, depth: 1200, polarity: 'unipolar',
          mapping: 'linear', offset: 0 } }).ok, true);
        const fx = createFakeAudioEnv({ sampleRate });
        const engine = new AudioEngine({ env: fx.env });
        assert.ok(engine.init());
        const rt = createStudioRuntime({ engine });
        assert.equal(rt.apply(st.getModel(), { revision: 1 }).ok, true);
        assert.equal(rt.start().ok, true);
        assert.equal(rt.edges.get(id).fit, fit);
        const plan = rt.plan;
        const inc = plan.edgeOrder.map((e) => plan.edges.get(e))
          .filter((e) => e.to.node === osc.id && e.kind === 'control')
          .map((edge) => ({ edge, handle: rt.edges.get(edge.id) }));
        const cap = 0.95 * (sampleRate / 2);
        const cb = computeBases(plan.nodes.get(osc.id), inc, { safeMaximum: cap });
        const cents = inc.filter(({ edge }) => edge.to.port === 'detune')
          .reduce((s, { edge, handle }) => s + Math.max(0, (cb.gains.get(edge.id) || 0)
            * handle.range[1]), cb.base.detune.value);
        const top = cb.base.frequency.value * 2 ** (cents / 1200);
        assert.ok(top <= cap * (1 + 1e-9), `${sampleRate}: ${id} tops out at ${top} Hz <= ${cap}`);
        const a = 1200; // unipolar 0..1 onto [0, 1200 cents]
        assert.ok(Math.abs(cb.scaled.get(id) - cb.gains.get(id) / a) < 1e-9,
          `${sampleRate}: ${id}'s scaled entry is the factor its gain plays`);
        assert.ok(cb.scaled.get(id) < 0.2, `${sampleRate}: the headroom, not detune's range`);
        assert.equal(st.dispatch({ type: 'EDGE_REMOVE', edgeIds: [id] }).ok, true);
        rt.stop?.();
      }
    }
  });

test('N3: a bipolar or offset performance cable stays inside its target, above and below',
  async () => {
    const { fitFactor } = await import('../../src/js/studio/performance-fit.js');
    // Y (0..1) bipolar at depth 0.8 into a [0, 1] level at 0.5: a = 1.6, its constant -0.8.
    const lin = [{ c: -0.8, up: 1.6, down: 0, fit: true }];
    const base = 0.5 - 0.8;
    const { k, shift } = fitFactor(lin, base, { min: 0, max: 1 });
    const lo = base + shift + k * 0;
    const hi = base + shift + k * 1.6;
    assert.ok(lo >= -1e-12 && hi <= 1 + 1e-12, `the sweep ${lo}..${hi} stays inside 0..1`);
    assert.ok(Math.abs(k - 0.625) < 1e-12, 'the most of its depth that fits both ends');
    // A negative offset alone is held at the bottom too.
    const off = fitFactor([{ c: -0.6, up: 1, down: 0, fit: true }], 0.3 - 0.6, { min: 0, max: 1 });
    assert.ok(0.3 - 0.6 * off.k >= -1e-12, 'the lowest point stays at or above the minimum');
    assert.ok(Math.abs(off.shift - (off.k - 1) * -0.6) < 1e-12, 'its constant scaled with it');
    // Through the runtime: Y bipolar 0.8 into MIXER Level 1 at 0.5.
    const st = cabledStore();
    const a = xy.xyTargetAction(st.getModel(), PANEL, 'mix.level1');
    assert.equal(st.dispatch(a.action).ok, true);
    const m = st.getModel();
    const e = m.graph.edges.find((x) => x.from.node === ids(m)('xy') && x.from.port === 'y');
    assert.equal(st.dispatch({ type: 'EDGE_UPDATE', edgeId: e.id, props: { polarity: 'bipolar',
      depth: 0.8 } }).ok, true);
    assert.equal(st.dispatch({ type: 'NODE_PARAM_SET', nodeId: ids(m)('mix'),
      params: { level1: 0.5 } }).ok, true);
    const fx = createFakeAudioEnv({ sampleRate: 48000 });
    const engine = new AudioEngine({ env: fx.env });
    assert.ok(engine.init());
    const rt = createStudioRuntime({ engine });
    assert.equal(rt.apply(liveModel(st.getModel()), { revision: 1 }).ok, true);
    assert.equal(rt.start().ok, true);
    const plan = rt.plan;
    const mixId = ids(m)('mix');
    const inc = plan.edgeOrder.map((x) => plan.edges.get(x))
      .filter((x) => x.to.node === mixId && x.kind === 'control' && x.to.port === 'level1')
      .map((edge) => ({ edge, handle: rt.edges.get(edge.id) }));
    const cb = computeBases(plan.nodes.get(mixId), inc, { safeMaximum: 22800 });
    const g = cb.gains.get(e.id);
    const [l, h] = rt.edges.get(e.id).range;
    const ends = [cb.base.level1.value + g * l, cb.base.level1.value + g * h];
    assert.ok(Math.min(...ends) >= -1e-9 && Math.max(...ends) <= 1 + 1e-9,
      `MIXER Level 1 sweeps ${ends.join('..')} inside 0..1`);
    assert.ok(cb.limited.has(e.id) && cb.fitted.get(e.id).factor < 1, 'and says it is held');
  });

test('N4: Y with no room says so: the readout, xyRoom and a performance-limited diagnostic',
  async () => {
    const toVca = (st) => {
      assert.equal(st.dispatch(xy.xyTargetAction(st.getModel(), PANEL, 'vca.gain').action).ok,
        true);
      assert.equal(st.dispatch({ type: 'NODE_PARAM_SET', nodeId: ids(st.getModel())('vca'),
        params: { gain: 1 } }).ok, true); // base 1 + EG 2's depth 1: the top of 0..2
    };
    const r = await padRig(toVca);
    const room = xy.xyRoom(r.st.getModel(), PANEL);
    assert.equal(room.factor, 0);
    assert.match(room.text, /^Y nemá místo: VCA Initial gain a ostatní kabely do něj už/);
    assert.match(r.readout(), /Y nemá místo/, 'the pad\'s readout says it');
    const diag = r.runtime.debugInfo().diagnostics.filter((d) => d.code === 'performance-limited');
    assert.equal(diag.length, 1, 'one diagnostic, on the Y cable');
    assert.match(diag[0].message, /Y → .* nemá místo/);
    r.done();
    // Room for half: base 0.5 leaves 0.5 of Y's depth 1.
    const half = await padRig((st) => {
      toVca(st);
      assert.equal(st.dispatch({ type: 'NODE_PARAM_SET', nodeId: ids(st.getModel())('vca'),
        params: { gain: 0.5 } }).ok, true);
    });
    assert.match(half.readout(), /Y hraje 50 % své hloubky/);
    half.done();
    // The default document: LPF Cutoff (a frequency, capped at Nyquist) has its depth.
    assert.equal(xy.xyRoom(cabledStore().getModel(), PANEL), null);
  });

test('N4: a non-performance cable is never fitted, and the pad\'s Pitch is no performance '
  + 'output', () => {
    // Fitting is for the pad's X and Y only (review mutants M24, M25): MG into MIXER Level 1 at
    // its top keeps its depth (its excess is reported, §242), the pad's Pitch is not fitted.
    const st = cabledStore();
    const m = st.getModel();
    const mg = patchCable(m, PANEL, 'mg.control', 'mix.level1');
    assert.equal(st.dispatch(mg.action).ok, true);
    const p = patchCable(st.getModel(), PANEL, 'xy.pitch', 'vco1.tune');
    assert.ok(p.action, p.reason);
    assert.equal(st.dispatch(p.action).ok, true);
    assert.equal(st.dispatch({ type: 'NODE_PARAM_SET', nodeId: ids(m)('mix'),
      params: { level1: 1 } }).ok, true);
    const fx = createFakeAudioEnv({ sampleRate: 48000 });
    const engine = new AudioEngine({ env: fx.env });
    assert.ok(engine.init());
    const rt = createStudioRuntime({ engine });
    assert.equal(rt.apply(liveModel(st.getModel()), { revision: 1 }).ok, true);
    assert.equal(rt.start().ok, true);
    const into = (node, port) => [...rt.edges.values()].filter((h) => h.toNode === node
      && h.toPort === port);
    const mgEdge = into(ids(m)('mix'), 'level1')[0];
    assert.equal(mgEdge.fit, false, 'an MG cable is no performance cable');
    const pitch = into(ids(m)('vco1'), 'tune').find((h) => h.fromNode === ids(m)('xy'));
    assert.equal(pitch.fit, false, 'the pad\'s Pitch is not fitted');
    const plan = rt.plan;
    const inc = plan.edgeOrder.map((x) => plan.edges.get(x))
      .filter((x) => x.to.node === ids(m)('mix') && x.to.port === 'level1')
      .map((edge) => ({ edge, handle: rt.edges.get(edge.id) }));
    const cb = computeBases(plan.nodes.get(ids(m)('mix')), inc, { safeMaximum: 22800 });
    assert.equal(cb.limited.has(mgEdge.id), false, 'MG keeps its depth');
    assert.deepEqual(cb.exceeds, ['level1'], 'its excess is reported, never hidden');
  });

test('N5 and F2: the bay names every summing cable; only a summing cable says it adds', () => {
  const st = cabledStore();
  assert.equal(st.dispatch(patchCable(st.getModel(), PANEL, 'xy.x', 'lpf.frequency').action)
    .ok, true);
  assert.equal(st.dispatch(patchCable(st.getModel(), PANEL, 'mg.control', 'vco2.tune').action)
    .ok, true);
  const m = st.getModel();
  const tokens = { ...Object.fromEntries(Object.entries(PANEL_TOKENS)
    .map(([k, name]) => [k, `var(${name})`])), cables: CABLE_TOKENS.map((n) => `var(${n})`) };
  const states = new Map(PANEL.modules.flatMap((mod) => PANEL.jacksOf(mod.id))
    .filter((j) => j.direction === 'in').map((j) => [j.key, jackState(m, PANEL, j.id)]));
  const cables = panelCables(m, PANEL).map((c) => ({ ...c, type: 'CONTROL' }));
  const svg = bay.baySvg({ panel: PANEL, layout: bay.bayLayout(PANEL, 376), cables, states,
    tokens });
  assert.match(svg, /aria-label="LPF Cutoff input, control, normalled, plus XY PAD X and Y"/);
  // The CABLES list as synth/ui.js renders it (bay.js cableListHtml: one cableItem per cable).
  const jackName = (j) => j;
  const rows = cables.map((c) => bay.cableItem(c, states.get(`${c.to}:in`),
    { jackName, item: 'i', btn: 'b' }));
  const adds = rows.filter((r) => r.includes(', přičítá se k normálům'));
  assert.equal(rows.length, 3);
  assert.equal(adds.length, 2, 'the two pad cables into LPF Cutoff say they add');
  assert.ok(adds.every((r) => /^<li class="i"><span>xy\.[xy] → lpf\.frequency, přičítá/.test(r)));
  assert.match(rows.find((r) => r.includes('mg.control')), /<span>mg\.control → vco2\.tune<\/span>/,
    'a plain cable says nothing more');
  assert.equal(bay.cableListHtml({ cables, states, gone: [], mixed: [], open: [], jackName,
    mixedText: '', item: 'i', btn: 'b' }), rows.join(''), 'the list renders each row so');
  const ui = readFileSync(`${ROOT}src/js/synth/ui.js`, 'utf8');
  assert.match(ui, /cableListHtml\(\{ cables, states,/, 'synth/ui.js renders that list');
});

test('N6: the pad\'s Glide says why it is idle while its Pitch feeds no cable; no preset sets it',
  async () => {
    const { controlReason, xyGlideIdle } = await import('../../src/js/synth/view/face.js');
    const st = cabledStore();
    const mod = { ...PANEL.module('xy'), def: NODE_REGISTRY.get('xy-pad') };
    const glide = { kind: 'knob', key: 'glide' };
    const node = () => PANEL.resolve(st.getModel()).get('xy');
    const idle = controlReason(mod, node(), glide, st.getModel(), PANEL);
    assert.equal(idle, xyGlideIdle(PANEL.module('keys').label));
    // NF2 (review of #428): the module is named as the panel labels it, never a literal.
    assert.equal(PANEL.module('keys').label, 'KEYBOARD');
    assert.match(idle, /podle Glide modulu KEYBOARD/);
    const renamed = { ...PANEL, module: (id) => (id === 'keys' ? { ...PANEL.module(id),
      label: 'KEYS 2' } : PANEL.module(id)) };
    assert.match(controlReason(mod, node(), glide, st.getModel(), renamed),
      /podle Glide modulu KEYS 2/, 'a panel that labels its keyboard otherwise is named so');
    assert.equal(st.dispatch(patchCable(st.getModel(), PANEL, 'xy.pitch', 'vco1.pitch').action)
      .ok, true);
    assert.equal(controlReason(mod, node(), glide, st.getModel(), PANEL), null,
      'with its Pitch cabled the pad\'s Glide glides that cable');
    assert.ok(xy.XY_RECIPES.every((r) => !r.values.some(([k]) => k === 'xy.glide')),
      'no built-in preset sets the idle Glide');
    // A document carrying a pad Glide (saved before) still loads and keeps it.
    const s2 = cabledStore();
    assert.equal(s2.dispatch({ type: 'NODE_PARAM_SET', nodeId: PANEL.resolve(s2.getModel())
      .get('xy').id, params: { glide: 0.05 } }).ok, true);
  });

// ---------------------------------------------------------------- review of #428 (98's P3s)

/** The default document with Y cabled into the reference oscillator's Detune (depth cents),
 *  the oscillator at `hz`, running at `sampleRate`: its runtime's diagnostics. */
function detuneRig({ hz, detune = 0, depth = 1200, sampleRate = 48000 }) {
  const st = cabledStore();
  const m0 = st.getModel();
  const osc = m0.graph.nodes.find((n) => n.type === 'oscillator');
  assert.equal(st.dispatch({ type: 'NODE_PARAM_SET', nodeId: osc.id,
    params: { frequency: hz, detune } }).ok, true);
  assert.equal(st.dispatch({ type: 'EDGE_ADD', id: 'y-detune', from: { node: ids(m0)('xy'),
    port: 'y' }, to: { node: osc.id, port: 'detune' }, props: { muted: false, depth,
    polarity: 'unipolar', mapping: 'linear', offset: 0 } }).ok, true);
  const fx = createFakeAudioEnv({ sampleRate });
  const engine = new AudioEngine({ env: fx.env });
  assert.ok(engine.init());
  const rt = createStudioRuntime({ engine });
  assert.equal(rt.apply(st.getModel(), { revision: 1 }).ok, true);
  assert.equal(rt.start().ok, true);
  const perf = rt.debugInfo().diagnostics.filter((d) => d.code === 'performance-limited');
  return { rt, perf };
}

test('NF1: a Y cable held by the Nyquist headroom is not blamed on its range', () => {
  // Oscillator at 20 kHz, detune 0, Y -> Detune 1200 cents: the range (+-1200) has room for
  // the whole depth; what holds Y is 0.95 x Nyquist, which the oscillator's frequency leaves.
  const { perf } = detuneRig({ hz: 20000 });
  assert.equal(perf.length, 1, perf.map((d) => d.message).join(' | '));
  const [d] = perf;
  assert.ok(d.details.factor > 0 && d.details.factor < 1, `${d.details.factor}`);
  assert.equal(d.details.by, 'nyquist', 'the factor that won is the Nyquist headroom');
  assert.doesNotMatch(d.message, /z rozsahu/, d.message);
  assert.match(d.message, /0\.95 × Nyquist/, d.message);
  // The same cable with room in Nyquist but not in its range (detune 600, depth 1200 at 440 Hz):
  // the range wins, and the message says so.
  const r = detuneRig({ hz: 440, detune: 600 });
  assert.equal(r.perf.length, 1);
  assert.equal(r.perf[0].details.by, 'range');
  assert.match(r.perf[0].message, /nechávají jen tolik z rozsahu \(-1200 až 1200\)/);
});

test('NF3: every pad output summing into a control target rests at 0 on lift; Pitch does not',
  async () => {
    // Ruling by af on the plan: X and Y sum into their targets (the pad's `fits`) and rest at 0
    // on every release unless a Hold keeps them (none yet, Q099); X as pitch ends with its note.
    for (const how of ['lift', 'forced']) {
      const r = await padRig((st) => {
        const a = patchCable(st.getModel(), PANEL, 'xy.x', 'lpf.frequency');
        assert.equal(st.dispatch(a.action).ok, true, 'X cabled into LPF Cutoff');
      });
      const padId = PANEL.resolve(r.st.getModel()).get('xy').id;
      const out = (port) => r.runtime.nodes.get(padId).outputs[port].offset.events.at(-1).value;
      r.model.key('End'); // the last cell: x = (steps - 0.5) / steps, 0.955 for 11 steps
      r.model.gate(true);
      assert.ok(out('x') > 0.95, `${how}: X plays ${out('x')} while touched`);
      const pitch = out('pitch');
      if (how === 'lift') r.model.end('release');
      else r.mount.release('owner');
      assert.equal(out('x'), 0, `${how}: X's cable into LPF Cutoff reads 0 after the release`);
      assert.equal(out('y'), 0, `${how}: and Y's`);
      assert.equal(out('pitch'), pitch, `${how}: the Pitch output keeps its note`);
      r.done();
    }
  });

// NF5 (review of #428): the cases the reviewer's surviving mutants (probe428b/mut-r3.sh) named.

test('NF5: after a lift the readout says what sounds, no stale next touch from the old Y',
  async () => {
    const r = await padRig();
    for (let i = 0; i < 90; i += 1) r.model.key('ArrowUp');
    r.model.gate(true);
    assert.match(r.readout(), /Y 90 % → lpf\.frequency [^·]+ · gate open/);
    r.model.end('release');
    assert.match(r.readout(), / Y 0 % → lpf\.frequency/);
    assert.doesNotMatch(r.readout(), /další dotek začne z Y/,
      'Y was put back at rest: the next touch starts from 0, and the readout does not say 90 %');
    assert.equal(r.model.value.y, 0);
    r.done();
  });

test('NF5: a router all-off while the pad is touched rests its outputs too', async () => {
  const r = await padRig();
  const padId = PANEL.resolve(r.st.getModel()).get('xy').id;
  const out = (port) => r.runtime.nodes.get(padId).outputs[port].offset.events.at(-1).value;
  for (let i = 0; i < 90; i += 1) r.model.key('ArrowUp');
  r.model.gate(true);
  assert.ok(Math.abs(out('y') - 0.9) < 1e-9);
  r.transport.live(padId, { kind: 'all-off' }); // the router's forced release (live-notes.js)
  assert.equal(out('y'), 0, 'an all-off rests Y as an off does');
  r.done();
});

test('NF5: a cable with its whole room makes no performance-limited diagnostic', () => {
  // Y -> Detune 600 cents at 440 Hz: inside the range (+-1200) and far from Nyquist: factor 1.
  const { rt, perf } = detuneRig({ hz: 440, detune: 0, depth: 600 });
  assert.deepEqual(perf.map((d) => d.message), [], 'nothing is said of a cable at full depth');
  assert.equal(rt.debugInfo().limitedEdges.includes('y-detune'), false);
});

/** The default document with X and Y both cabled into MIXER level 1 (0.7, depth 0.25 each). */
function levelRig(edit = null) {
  const st = cabledStore();
  assert.equal(st.dispatch(xy.xyTargetAction(st.getModel(), PANEL, 'mix.level1').action).ok,
    true);
  assert.equal(st.dispatch(patchCable(st.getModel(), PANEL, 'xy.x', 'mix.level1').action).ok,
    true);
  if (edit) edit(st);
  const fx = createFakeAudioEnv({ sampleRate: 48000 });
  const engine = new AudioEngine({ env: fx.env });
  assert.ok(engine.init());
  const rt = createStudioRuntime({ engine });
  assert.equal(rt.apply(st.getModel(), { revision: 1 }).ok, true);
  assert.equal(rt.start().ok, true);
  const m = st.getModel();
  const res = PANEL.resolve(m);
  const yEdge = m.graph.edges.find((e) => e.from.node === res.get('xy').id && e.from.port === 'y');
  return { st, rt, m, res, yEdge };
}

test('NF5: xyRoom counts the X cables into the same target as the compiler does', () => {
  const { rt, m, yEdge } = levelRig();
  const room = xy.xyRoom(m, PANEL);
  const perf = rt.debugInfo().diagnostics.filter((d) => d.code === 'performance-limited');
  const fitted = perf.find((d) => d.details.edge === yEdge.id);
  assert.ok(fitted, 'the compiler holds Y below its depth');
  // 0.7 + 0.25 (X) + 0.25 (Y) in 0..1: both performance cables share the 0.3 left, 0.6 each.
  assert.ok(Math.abs(fitted.details.factor - 0.6) < 1e-9, `${fitted.details.factor}`);
  assert.ok(Math.abs(room.factor - fitted.details.factor) < 1e-9,
    `the readout's factor ${room.factor} is the compiler's ${fitted.details.factor}`);
});

test('NF5: a fitted cable whose downward sweep the fit holds in range is not an exceeds',
  () => {
    // Y at depth -0.8 into MIXER level 1 at 0.5, X off it: Y would sweep it down to -0.3; the
    // fit scales that sweep to stay at or above 0, so level1 does not exceed its range.
    const { rt, res, yEdge } = levelRig((st) => {
      const m = st.getModel();
      const r2 = PANEL.resolve(m);
      const x = m.graph.edges.find((e) => e.from.node === r2.get('xy').id && e.from.port === 'x');
      const y = m.graph.edges.find((e) => e.from.node === r2.get('xy').id && e.from.port === 'y');
      assert.equal(st.dispatch({ type: 'EDGE_REMOVE', edgeId: x.id }).ok, true);
      const up = st.dispatch({ type: 'EDGE_UPDATE', edgeId: y.id, props: { depth: -0.8 } });
      assert.equal(up.ok, true, up.reason);
      assert.equal(st.dispatch({ type: 'NODE_PARAM_SET', nodeId: r2.get('mix').id,
        params: { level1: 0.5 } }).ok, true);
    });
    const exceeds = rt.debugInfo().exceeds.filter((e) => e.node === res.get('mix').id);
    assert.deepEqual(exceeds, [], 'the fitted downward sweep stays inside 0..1');
    const fitted = rt.debugInfo().diagnostics.find((d) => d.code === 'performance-limited'
      && d.details.edge === yEdge.id);
    assert.ok(fitted && Math.abs(fitted.details.factor - 0.625) < 1e-9,
      'the fit is what holds it: 0.5 of the 0.8 the cable asks downward');
  });

test('NF6: Y\'s room is read once per document, not on every move, and again on a change',
  async () => {
    // xyRoom reads each linear cable's source range (panel.sourceRange): counted on a panel
    // that delegates to the real one, with Y into MIXER level 1 (a linear, fitted target).
    let reads = 0;
    const counted = Object.create(PANEL, { sourceRange: { value: (j) => {
      reads += 1;
      return PANEL.sourceRange(j);
    } } });
    const { mountSynthXy } = await import('../../src/js/synth/view/xy-wiring.js');
    const { createXyModel } = await import('../../src/js/ui/kinds/xy-pad.js');
    const st = cabledStore();
    assert.equal(st.dispatch(xy.xyTargetAction(st.getModel(), PANEL, 'mix.level1').action).ok,
      true);
    const kids = new Map();
    const fake = () => ({ setAttribute() {}, hasAttribute: () => false, removeAttribute() {},
      innerHTML: '', textContent: '', hidden: false, value: '', selectedOptions: [{ text: '' }],
      addEventListener() {}, removeEventListener() {},
      querySelector(sel) { if (!kids.has(sel)) kids.set(sel, fake()); return kids.get(sel); } });
    const host = fake();
    const m = mountSynthXy(host, { store: st, panel: counted, app: null, arm: () => true,
      mountPad: (box, opts) => { const model = createXyModel(opts);
        return { model, update() {}, destroy() { model.end('hide'); } }; } });
    const readout = () => host.querySelector('[data-osc="synth.xy.readout"]').textContent;
    const first = reads;
    assert.ok(first > 0, 'the first show read the room');
    for (let i = 0; i < 20; i += 1) m.view.model.key(i % 2 ? 'ArrowLeft' : 'ArrowRight');
    assert.equal(reads, first, '20 cursor moves read nothing again');
    assert.doesNotMatch(readout(), /své hloubky/, 'level 1 at 0.7 leaves Y its whole depth');
    const mix = PANEL.resolve(st.getModel()).get('mix').id;
    assert.equal(st.dispatch({ type: 'NODE_PARAM_SET', nodeId: mix, params: { level1: 0.9 } })
      .ok, true);
    m.view.model.key('ArrowRight');
    assert.ok(reads > first, 'a change to the document reads the room again');
    assert.match(readout(), /Y hraje 40 % své hloubky/, 'and the readout says the new room');
    const after = reads;
    m.view.model.key('ArrowLeft');
    assert.equal(reads, after, 'once per document');
    m.destroy();
  });

test('R-K: a pad cable\'s constant never lifts an Oscillator past 0.95 x Nyquist', () => {
  // Review of PR 428, R-K: the fit scaled a cable's constant part (bipolar, or an offset) by
  // the range factor after the frequency's headroom was spent on its sweep, so a bipolar Y into
  // the Detune of an Oscillator at 20 kHz with a static detune played above 0.95 x Nyquist
  // (detune 800, depth 1200: 28.7 kHz at 48 kHz). What plays, read off the fake engine: the
  // frequency x 2^((the detune's base + Y's gain) / 1200) at Y's top and bottom.
  const last = (prm) => (prm.events.length ? prm.events.at(-1).value : prm.value);
  for (const sampleRate of [44100, 48000]) {
    for (const [detune, depth, polarity, offset] of [[800, 1200, 'bipolar', 0],
      [600, 1200, 'bipolar', 0], [900, 600, 'bipolar', 0], [0, 1200, 'unipolar', 600],
      [500, 1200, 'unipolar', 400]]) {
      const st = cabledStore();
      const m0 = st.getModel();
      const osc = m0.graph.nodes.find((n) => n.type === 'oscillator');
      assert.equal(st.dispatch({ type: 'NODE_PARAM_SET', nodeId: osc.id,
        params: { frequency: 20000, detune } }).ok, true);
      assert.equal(st.dispatch({ type: 'EDGE_ADD', id: 'y-detune', from: { node: ids(m0)('xy'),
        port: 'y' }, to: { node: osc.id, port: 'detune' }, props: { muted: false, depth,
        polarity, mapping: 'linear', offset } }).ok, true);
      const fx = createFakeAudioEnv({ sampleRate });
      const engine = new AudioEngine({ env: fx.env });
      assert.ok(engine.init());
      const rt = createStudioRuntime({ engine });
      assert.equal(rt.apply(st.getModel(), { revision: 1 }).ok, true);
      assert.equal(rt.start().ok, true);
      const h = rt.nodes.get(osc.id);
      const f = last(h.modTarget('frequency', 'linear').param);
      const d = last(h.modTarget('detune', 'linear').param);
      const g = last(rt.edges.get('y-detune').gain.gain);
      const top = Math.max(f * 2 ** (d / 1200), f * 2 ** ((d + g) / 1200));
      const cap = 0.95 * (sampleRate / 2);
      const what = `${sampleRate} Hz, detune ${detune}, ${polarity} ${depth} offset ${offset}`;
      assert.ok(top <= cap * (1 + 1e-9), `${what}: plays up to ${top.toFixed(0)} Hz, `
        + `over ${cap} Hz`);
    }
  }
});

test('RK-2: the Nyquist guard leaves a bipolar cable the static its range fit found', () => {
  // Review of the keys+pad train, RK-2: 06140d80's guard held the fitted static at the pre-fit
  // static clipped at 0, which for a bipolar cable is static - depth, so every raise the range
  // fit made was cut to 0 at any frequency: an A4 at +1100 cents with Y bipolar 1200 into its
  // Detune played 440..494 Hz (0..200 cents) where the fit had found 784..880 Hz (1000..1200).
  // The ceiling is the Nyquist room left above the static after the cables' final sweep. Each
  // row: what plays at Y's bottom and top in cents of detune (the base, the base plus Y's gain),
  // the reviewer's measured values; the last row sits at the cap and keeps the bound.
  const last = (prm) => (prm.events.length ? prm.events.at(-1).value : prm.value);
  const rows = [
    [48000, 440, 1100, 1200, 1000, 1200], // 784..880 Hz
    [48000, 10000, 1100, 1200, 1000, 1200], // 17.8..20.0 kHz
    [48000, 10000, 800, 1200, 400, 1200], // 12.6..20.0 kHz
    [44100, 10000, 900, 600, 600, 1200], // 14.1..20.0 kHz
    [48000, 20000, 1100, 1200, null, null], // at the cap: the room's top, 200 cents of sweep
  ];
  for (const [sampleRate, frequency, detune, depth, lo, hi] of rows) {
    const st = cabledStore();
    const m0 = st.getModel();
    const osc = m0.graph.nodes.find((n) => n.type === 'oscillator');
    assert.equal(st.dispatch({ type: 'NODE_PARAM_SET', nodeId: osc.id,
      params: { frequency, detune } }).ok, true);
    assert.equal(st.dispatch({ type: 'EDGE_ADD', id: 'y-detune', from: { node: ids(m0)('xy'),
      port: 'y' }, to: { node: osc.id, port: 'detune' }, props: { muted: false, depth,
      polarity: 'bipolar', mapping: 'linear', offset: 0 } }).ok, true);
    const fx = createFakeAudioEnv({ sampleRate });
    const engine = new AudioEngine({ env: fx.env });
    assert.ok(engine.init());
    const rt = createStudioRuntime({ engine });
    assert.equal(rt.apply(st.getModel(), { revision: 1 }).ok, true);
    assert.equal(rt.start().ok, true);
    const h = rt.nodes.get(osc.id);
    const f = last(h.modTarget('frequency', 'linear').param);
    const d = last(h.modTarget('detune', 'linear').param);
    const g = last(rt.edges.get('y-detune').gain.gain);
    const cap = 0.95 * (sampleRate / 2);
    const what = `${sampleRate} Hz, ${frequency} Hz, detune ${detune}, bipolar ${depth}`;
    const room = 1200 * Math.log2(cap / frequency);
    const [wantLo, wantHi] = lo === null ? [room - 200, room] : [lo, hi];
    assert.ok(Math.abs(d - wantLo) < 0.05 && Math.abs(d + g - wantHi) < 0.05,
      `${what}: plays ${d.toFixed(1)}..${(d + g).toFixed(1)} cents, not `
      + `${wantLo.toFixed(1)}..${wantHi.toFixed(1)}`);
    const top = f * 2 ** ((d + Math.max(0, g)) / 1200);
    assert.ok(top <= cap * (1 + 1e-9), `${what}: plays up to ${top.toFixed(0)} Hz, over ${cap}`);
  }
});
