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
// ring, "normalled, plus XY PAD Y" in the jack's name, "adds to the normals" in the cable list), Y is 0 until the first
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
function defaultStore() {
  const st = createStudioStore(templateModel(REFERENCE_TEMPLATE_ID),
    { idGenerator: createIdGenerator() });
  assert.equal(typeof xy.xyInsertAction, 'function', 'synth/xy.js exports xyInsertAction');
  const a = xy.xyInsertAction(st.getModel(), PANEL, { at: { x: 0, y: 600 } });
  assert.equal(a.type, 'BATCH', 'one BATCH: one undo entry');
  const r = st.dispatch(a);
  assert.equal(r.ok, true, r.reason);
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

test('the default Synth document holds the Y route as a typed model cable xy.y -> LPF Cutoff',
  () => {
    const st = defaultStore();
    const m = st.getModel();
    const id = ids(m);
    const edges = m.graph.edges.filter((e) => e.from.node === id('xy'));
    assert.equal(edges.length, 1, 'one cable leaves the pad');
    const [e] = edges;
    assert.deepEqual([e.from.port, e.to.node, e.to.port], ['y', id('lpf'), 'frequency']);
    // project.typed-ports: the registry's own ports allow it, and its props validate.
    const out = NODE_REGISTRY.port('xy-pad', 'y', 'out');
    const inp = NODE_REGISTRY.port('filter', 'frequency', 'in');
    const v = canConnect(out, inp, { sourceNodeId: e.from.node, targetNodeId: e.to.node });
    assert.equal(v.allowed, true, v.reason);
    assert.equal(v.signalType, 'CONTROL');
    const checked = validateEdgeProps(e.props, v.signalType, inp,
      NODE_REGISTRY.param('filter', 'frequency'));
    assert.equal(checked.ok, true, JSON.stringify(checked.errors));
    // A cable, not a normal: listed in the panel's cables (drawn, removable, linked).
    assert.deepEqual(panelCables(m, PANEL).map((c) => [c.from, c.to]),
      [['xy.y', xy.XY_DEFAULT_Y]]);
    assert.equal(xy.xyTarget(m, PANEL), 'lpf.frequency');
    assert.equal(xy.XY_DEFAULT_Y, 'lpf.frequency');
    // No Pitch or Gate cable is needed: the keyboard's normals stay intact.
    assert.equal(xy.xyPatched(m, PANEL), false);
    assert.deepEqual(live(m, KEYS_NORMALS), KEYS_NORMALS);
    // A performance output adds: LPF Cutoff keeps its MG and EG 2 normals (and amount knobs).
    assert.deepEqual(live(m, LPF_NORMALS), LPF_NORMALS);
    assert.equal(jackState(m, PANEL, 'lpf.frequency'), 'summing',
      'the jack sums: its normals sound and the Y cable adds to them');
  });

test('the Synth inserts the panel through xyInsertAction, on every insert path', () => {
  const code = (p) => readFileSync(`${ROOT}${p}`, 'utf8').replace(/^\s*\/\/.*$/gm, '');
  for (const p of ['src/js/synth/ui.js', 'src/js/synth/picker.js']) {
    assert.match(code(p), /xyInsertAction\(/, `${p} inserts with the Y cable`);
    assert.doesNotMatch(code(p), /panel\.instantiate\(/, `${p}: no bare instantiate`);
  }
  // The pad already there (a reused panel): its cables are the user's, none is added.
  const st = defaultStore();
  assert.equal(st.dispatch(xy.xyTargetAction(st.getModel(), PANEL, null).action).ok, true);
  const again = xy.xyInsertAction(st.getModel(), PANEL);
  assert.ok(!again.steps.some((s) => s.type === 'EDGE_ADD' && s.from
    && s.from.node === ids(st.getModel())('xy')), 'no Y cable re-added over the user\'s choice');
});

test('the pad\'s notes reach the voice through the one Keys source, last-note priority; a '
  + 'computer key sounds beside it', () => {
  assert.equal(KEY_ROUTES.synth.plays, 'synthSink', 'the Synth\'s keys play the Synth sink');
  const st = defaultStore();
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
  assert.equal(said.at(-1), SYNTH_TEXT.plays(`the ${PANEL.title}`),
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
  const st = defaultStore();
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
  const st = defaultStore();
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
function runningDefault(sampleRate, edit = null) {
  const st = defaultStore();
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
  const m = defaultStore().getModel();
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
  const st = defaultStore();
  const mg = patchCable(st.getModel(), PANEL, 'mg.control', 'lpf.frequency');
  assert.equal(st.dispatch(mg.action).ok, true);
  assert.equal(jackState(st.getModel(), PANEL, 'lpf.frequency'), 'patched');
  const ui = readFileSync(`${ROOT}src/js/synth/ui.js`, 'utf8');
  assert.match(ui, /=== 'summing' \? ', adds to the normals'/, 'the cable list says it adds');
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

test('the sum stays within LPF Cutoff\'s declared range: normals at their amounts, Y at 1', () => {
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
      const { st, rt } = runningDefault(sampleRate, edit);
      const id = lpfAt(st);
      const plan = rt.plan;
      const incoming = plan.edgeOrder.map((e) => plan.edges.get(e))
        .filter((e) => e.to.node === id && e.kind === 'control')
        .map((edge) => ({ edge, handle: rt.edges.get(edge.id) }));
      assert.equal(incoming.length, 3, 'n21, n22 and the Y cable');
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
      // Y adds nothing downward (unipolar, offset 0): the lowest cutoff is the normals' own.
      const y = incoming.find(({ edge }) => edge.from.node === ids(st.getModel())('xy'));
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
      if (!xy.xyTargetAction(defaultStore().getModel(), PANEL, t.id).action) continue;
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
  const m = defaultStore().getModel();
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
    const st = defaultStore();
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
