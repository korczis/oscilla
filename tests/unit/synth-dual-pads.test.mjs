// K220: the two performance pads under the Synth face. Pad L is a second xy-pad module of the
// Synth panel (panels/xy.js XYL_MODULE) whose X and Y are typed CONTROL normals into the LPF and
// HPF cutoffs (panels/semi-mono.js n25, n26; log): a cable into either jack replaces its normal,
// and no NODE_PARAM_SET stands in for them. A touch on pad L reaches its node through
// transport.live and plays no note; its release puts X and Y back at rest. Pad R is the panel's
// XY pad through the XY tab's shared mount. Stop and leaving the workspace release both (the
// shared release paths, xy-wiring.js padReleasePaths). One pad implementation serves both.
// Negative cases: off the Panel tab the card is not drawn; a document without pad L offers to
// add it; a refused arm moves nothing.
// On the merge base there is no second pad: PANEL.module('xyl') and view/pads.js are missing.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import PANEL from '../../src/js/synth/panels/semi-mono.js';
import * as xy from '../../src/js/synth/xy.js';
import { createXyModel } from '../../src/js/ui/kinds/xy-pad.js';
import { jackState, patchCable } from '../../src/js/synth/normals.js';
import { NODE_REGISTRY } from '../../src/js/studio/registry.js';
import { AudioEngine } from '../../src/js/audio/audio-engine.js';
import { createStudioRuntime } from '../../src/js/studio/runtime.js';
import { createStudioTransport } from '../../src/js/studio/transport.js';
import { createIdGenerator, createStudioStore } from '../../src/js/studio/actions.js';
import { templateModel, REFERENCE_TEMPLATE_ID } from '../../src/js/studio/templates/index.js';
import { createFakeAudioEnv } from './sequencer-fake-audio.mjs';

// Namespace imports: on the merge base each test fails on its own.
const pads = await import('../../src/js/synth/view/pads.js').catch(() => ({}));
const wiring = await import('../../src/js/synth/view/xy-wiring.js');

const ROOT = new URL('../../', import.meta.url);
const src = (p) => readFileSync(new URL(p, ROOT), 'utf8');
const last = (p) => (p.events.length ? p.events[p.events.length - 1].value : p.value);

/** The default Synth document: the reference template with the panel as the Synth inserts it. */
function defaultStore() {
  const st = createStudioStore(templateModel(REFERENCE_TEMPLATE_ID),
    { idGenerator: createIdGenerator() });
  const r = st.dispatch(xy.xyInsertAction(st.getModel(), PANEL, { at: { x: 0, y: 600 } }));
  assert.equal(r.ok, true, r.reason);
  return st;
}

function fakeEl() {
  const on = new Map();
  const kids = new Map();
  return {
    innerHTML: '', textContent: '', hidden: false,
    setAttribute() {}, removeAttribute() {}, hasAttribute: () => false,
    addEventListener(t, fn) { if (!on.has(t)) on.set(t, new Set()); on.get(t).add(fn); },
    removeEventListener(t, fn) { if (on.has(t)) on.get(t).delete(fn); },
    querySelector(sel) {
      if (!kids.has(sel)) kids.set(sel, fakeEl());
      return kids.get(sel);
    },
    fire(t, e = {}) { for (const fn of [...(on.get(t) || [])]) fn(e); },
    listeners: () => [...on.values()].reduce((n, s) => n + s.size, 0),
  };
}

/** The Alpine component as the mounts read it: a root for osc:ui and $watch. */
function fakeApp() {
  const root = fakeEl();
  const watches = [];
  return { workspace: 'synth', $root: root, audioState: 'running',
    $watch(key, fn) { watches.push([key, fn]); },
    leave(to) { root.fire('osc:ui', { detail: { kind: 'mode', key: 'mode', value: to } }); } };
}

/** The pad kind without a DOM: the real model; destroy ends a held gate as mountXyPad does. */
const mountPad = (box, opts) => {
  const model = createXyModel(opts);
  return { model, opts, update() {}, destroy() { model.end('hide'); } };
};

/** The default document on the real transport over the fake engine; live calls recorded. */
function rig() {
  const st = defaultStore();
  const fx = createFakeAudioEnv({ sampleRate: 48000 });
  const engine = new AudioEngine({ env: fx.env });
  assert.ok(engine.init(), 'engine.init');
  const runtime = createStudioRuntime({ engine });
  const real = createStudioTransport({ runtime, engine, store: st });
  const calls = [];
  const transport = Object.create(real, { live: { value: (id, ev) => {
    calls.push([id, ev.kind]);
    return real.live(id, ev);
  } } });
  const res = () => PANEL.resolve(st.getModel());
  return { st, fx, runtime, real, transport, calls, app: fakeApp(), res,
    padL: () => res().get('xyl').id, padR: () => res().get('xy').id };
}

// ---------------------------------------------------------------- the panel declaration

test('pad L is a second xy-pad module whose X and Y are typed log normals into LPF and HPF '
  + 'Cutoff', () => {
  const l = PANEL.module('xyl');
  assert.ok(l, 'the panel declares pad L (K220)');
  assert.equal(l.node, 'xy-pad', 'the same node type as pad R: one pad implementation');
  assert.equal(PANEL.module('xy').node, 'xy-pad');
  const rows = PANEL.normals.filter((n) => n.from.startsWith('xyl.'))
    .map((n) => [n.from, n.to, n.props.mapping]);
  // Y into LPF Peak since K232 (HPF Cutoff before it).
  assert.deepEqual(rows, [['xyl.x', 'lpf.frequency', 'log'], ['xyl.y', 'lpf.Q', 'log']]);
  const out = NODE_REGISTRY.get('xy-pad').outputs;
  for (const port of ['x', 'y']) {
    assert.equal(out.find((o) => o.id === port).type, 'CONTROL', `pad L ${port} is CONTROL`);
  }
  const m = defaultStore().getModel();
  const id = PANEL.resolve(m).get('xyl').id;
  const edges = m.graph.edges.filter((e) => e.from.node === id)
    .map((e) => [e.from.port, e.props.mapping, e.props.polarity]);
  assert.deepEqual(edges, [['x', 'log', 'unipolar'], ['y', 'log', 'unipolar']],
    'the default document holds both normals as model edges');
  assert.deepEqual(pads.padTargets(m, PANEL), { x: ['lpf.frequency'], y: ['lpf.Q'] });
  assert.equal(jackState(m, PANEL, 'lpf.Q'), 'normalled');
});

test('a cable into LPF Peak replaces pad L\'s Y normal, as any cable does', () => {
  const st = defaultStore();
  const r = patchCable(st.getModel(), PANEL, 'eg1.control', 'lpf.Q');
  assert.ok(r.action, r.reason);
  assert.equal(st.dispatch(r.action).ok, true);
  const m = st.getModel();
  assert.equal(jackState(m, PANEL, 'lpf.Q'), 'patched');
  assert.deepEqual(pads.padTargets(m, PANEL), { x: ['lpf.frequency'], y: [] },
    'pad L\'s Y drives nothing once a cable replaced its normal');
  // The action is a BATCH of graph edits: no NODE_PARAM_SET stands in for a normal.
  assert.ok(!JSON.stringify(r.action).includes('NODE_PARAM_SET'));
});

// ---------------------------------------------------------------- pad L's touch

test('a touch on pad L moves its X and Y through transport.live, plays no note, and its '
  + 'release puts both back at rest', () => {
  const r = rig();
  const m = pads.mountPadL(fakeEl(), { store: r.st, transport: r.transport, panel: PANEL,
    app: r.app, mountPad });
  assert.equal(m.view.model.down(1, 0.3, 0.7), true);
  assert.equal(r.real.playing, true, 'the first touch armed the transport');
  assert.deepEqual(r.calls, [[r.padL(), 'on']], 'one live event, on pad L\'s own node');
  const h = r.runtime.nodes.get(r.padL());
  assert.ok(Math.abs(last(h.outputs.x.offset) - 0.3) < 1e-9, 'X at the touch');
  assert.ok(Math.abs(last(h.outputs.y.offset) - 0.7) < 1e-9, 'Y at the touch');
  // Pad L plays no note: its Pitch and Gate feed nothing, and no Keys node heard the touch.
  assert.deepEqual(r.st.getModel().graph.edges.filter((e) => e.from.node === r.padL()
    && ['pitch', 'gate'].includes(e.from.port)), [], 'no Pitch or Gate edge from pad L');
  assert.ok(!r.calls.some(([id]) => id === r.res().get('keys').id), 'the keys hear nothing');
  m.view.model.move(1, 0.6, 0.2);
  assert.deepEqual(r.calls.at(-1), [r.padL(), 'move']);
  assert.ok(Math.abs(last(h.outputs.x.offset) - 0.6) < 1e-9);
  m.view.model.up(1);
  assert.deepEqual(r.calls.at(-1), [r.padL(), 'off']);
  assert.equal(last(h.outputs.x.offset), 0, 'X back at rest');
  assert.equal(last(h.outputs.y.offset), 0, 'Y back at rest');
  assert.deepEqual(m.view.model.value, { x: 0, y: 0 }, 'the cursor shows the rest');
  // The normals' edges are live: the touch reaches the LPF and the HPF through them.
  const doc = r.st.getModel();
  for (const e of doc.graph.edges.filter((x) => x.from.node === r.padL())) {
    assert.equal(r.runtime.edges.get(e.id).status, 'active', `${e.from.port} edge active`);
  }
  m.destroy();
  r.real.stop({ fast: true });
});

test('negative: a refused arm moves nothing on pad L and says why', () => {
  const r = rig();
  const said = [];
  const why = 'Výstup patří měření.';
  const host = fakeEl();
  const m = pads.mountPadL(host, { store: r.st, transport: r.transport, panel: PANEL,
    app: r.app, mountPad, arm: () => ({ ok: false, reason: why }),
    say: (t, a) => said.push([t, a]) });
  m.view.model.down(1, 0.5, 0.5);
  assert.equal(m.view.model.gated, false, 'the refused touch holds no gate');
  assert.deepEqual(r.calls, [], 'no live event');
  assert.deepEqual(said, [[why, true]]);
  assert.equal(host.querySelector('[data-pad-line]').textContent, why);
  m.destroy();
});

// ---------------------------------------------------------------- the release paths

test('Stop and leaving the workspace release pad L and pad R alike', () => {
  for (const [what, end] of [['stop', (r) => r.real.stop({ fast: true })],
    ['leave', (r) => r.app.leave('studio')]]) {
    const r = rig();
    const l = pads.mountPadL(fakeEl(), { store: r.st, transport: r.transport, panel: PANEL,
      app: r.app, mountPad });
    const p = wiring.mountSynthXy(fakeEl(), { store: r.st, transport: r.transport, panel: PANEL,
      app: r.app, mountPad, claim: false });
    l.view.model.down(1, 0.4, 0.6);
    p.view.model.down(2, 0.5, 0.5);
    assert.ok(l.view.model.gated && p.view.model.gated, `${what}: both pads touched`);
    end(r);
    assert.equal(l.view.model.gated, false, `${what}: pad L released`);
    assert.equal(p.view.model.gated, false, `${what}: pad R released`);
    const h = r.runtime.nodes.get(r.padL());
    if (h) assert.equal(last(h.outputs.y.offset), 0, `${what}: pad L's Y at rest`);
    l.destroy();
    p.destroy();
    if (what === 'leave') r.real.stop({ fast: true });
  }
});

test('destroy removes every listener pad L added; a second destroy changes nothing', () => {
  const r = rig();
  const before = r.app.$root.listeners();
  const m = pads.mountPadL(fakeEl(), { store: r.st, transport: r.transport, panel: PANEL,
    app: r.app, mountPad });
  assert.equal(r.app.$root.listeners(), before + 1, 'the leave listener');
  m.destroy();
  m.destroy();
  assert.equal(r.app.$root.listeners(), before);
});

// ---------------------------------------------------------------- the card

test('the card: on the Panel tab only, pad L beside pad R from lg, the scale picker beside R',
  () => {
    const st = defaultStore();
    let tab = 'panel';
    const nodes = () => PANEL.resolve(st.getModel());
    const card = pads.createPads({ panel: PANEL, get: () => ({ handle: st }), host: fakeEl,
      nodes, dispatch: (a) => st.dispatch(a), say() {}, jackName: String, tab: () => tab,
      cmp: () => null, arm: () => true });
    const html = card.html();
    assert.match(html, /data-osc="synth\.pads"/);
    assert.match(html, /grid-cols-1 [^"]*lg:grid-cols-2/, 'stacked, side by side from lg');
    assert.ok(html.indexOf('data-osc="synth.pads.l"') < html.indexOf('data-osc="synth.pads.r"'),
      'pad L first');
    assert.match(html, /data-osc="synth\.pads\.r\.scale"/);
    assert.match(html, /data-pad-param="key"[^]*<option value="C" selected>/);
    assert.match(html, /data-pad-param="mode"[^]*<option value="minor-pentatonic" selected>/);
    assert.equal((html.match(/data-pad-body=""/g) || []).length, 2);
    assert.doesNotMatch(html, / style=/, 'Flowbite Pro utilities, no inline style');
    tab = 'xy';
    assert.equal(card.html(), '', 'off the Panel tab the card is not drawn');
  });

test('negative: a document without pad L offers to add it, pad R still plays', () => {
  const st = defaultStore();
  const id = PANEL.resolve(st.getModel()).get('xyl').id;
  assert.equal(st.dispatch({ type: 'NODE_REMOVE', nodeId: id }).ok, true);
  const card = pads.createPads({ panel: PANEL, get: () => ({ handle: st }), host: fakeEl,
    nodes: () => PANEL.resolve(st.getModel()), dispatch: (a) => st.dispatch(a), say() {},
    jackName: String, tab: () => 'panel', cmp: () => null, arm: () => true });
  const html = card.html();
  assert.match(html, /data-restore-module="xyl"/);
  assert.match(html, /Tento dokument Studia nemá PAD L\./);
  assert.equal((html.match(/data-pad-body=""/g) || []).length, 1, 'pad R\'s body only');
  assert.deepEqual(pads.padTargets(st.getModel(), PANEL), { x: [], y: [] });
});

test('one pad implementation: pads.js mounts the kind and the XY tab\'s shared mount', () => {
  const s = src('src/js/synth/view/pads.js');
  assert.match(s, /mountSynthXy\(/, 'pad R is the shared mount');
  assert.match(s, /mountPadL\(/, 'pad L is the shared mount\'s pad L');
  assert.doesNotMatch(s, /mountXyPad|createXyModel|<svg|pointerdown|\.live\(/,
    'the card mounts no pad of its own and plays nothing');
  const w = src('src/js/synth/view/xy-wiring.js');
  const padL = w.slice(w.indexOf('export function mountPadL('));
  assert.match(padL, /mountPad = mountXyPad/, 'pad L is the one pad kind');
  assert.match(padL, /padReleasePaths\(/, 'pad L releases through the shared paths');
  const ui = src('src/js/synth/ui.js');
  assert.match(ui, /createPads\(/);
  assert.match(ui, /\$\{pads\.html\(\)\}/, 'the card is drawn under the plates');
});

test('every hook of the pads is in their markup (the catalogue\'s synth.pads family)', () => {
  const st = defaultStore();
  const card = pads.createPads({ panel: PANEL, get: () => ({ handle: st }), host: fakeEl,
    nodes: () => PANEL.resolve(st.getModel()), dispatch: (a) => st.dispatch(a), say() {},
    jackName: String, tab: () => 'panel', cmp: () => null, arm: () => true });
  const html = card.html();
  for (const id of ['synth.pads', 'synth.pads.l', 'synth.pads.r', 'synth.pads.r.scale']) {
    assert.ok(html.includes(`data-osc="${id}"`), id);
  }
  const host = fakeEl();
  const m = pads.mountPadL(host, { store: st, transport: null, panel: PANEL, mountPad });
  assert.ok(host.innerHTML.includes('data-osc="synth.pads.l.pad"'), 'synth.pads.l.pad');
  assert.ok(host.innerHTML.includes(pads.PADS_TEXT.axes('lpf.frequency', 'lpf.Q')),
    'the line says what each axis drives');
  m.destroy();
});

test('review C1-K220-1: a document without pad L (one made before K220) is not told a module '
  + 'was removed, and is offered PAD L', async () => {
  const { brokenByRemoval } = await import('../../src/js/synth/normals.js');
  const { platesShown } = await import('../../src/js/synth/view/face.js');
  const st = defaultStore();
  const id = PANEL.resolve(st.getModel()).get('xyl').id;
  // oscilla-c1's probe: the panel minus the xyl node and its edges, as a pre-K220 document.
  assert.equal(st.dispatch({ type: 'NODE_REMOVE', nodeId: id }).ok, true);
  const m = st.getModel();
  assert.equal(m.graph.edges.some((e) => e.from.node === id || e.to.node === id), false);
  assert.equal(PANEL.module('xyl').optional, true);
  assert.deepEqual(brokenByRemoval(m, PANEL).filter((r) => r.module === 'xyl'), [],
    'no "PAD L removed in the Studio" row');
  const shown = platesShown({ panel: PANEL, tab: 'panel', resolved: PANEL.resolve(m), model: m });
  assert.ok(shown.some((x) => x.id === 'xyl'), 'its own plate on the Panel tab, not a removed one');
  assert.equal(shown.filter((x) => x.id === 'xyl').length, 1);
  // Both cutoffs keep their MG and EG 2 normals (n19-n22): neither reads as open.
  assert.equal(jackState(m, PANEL, 'hpf.frequency'), 'normalled');
  assert.equal(jackState(m, PANEL, 'lpf.frequency'), 'normalled');
  const { plateHtml } = await import('../../src/js/synth/view/face.js');
  const plate = plateHtml({ panel: PANEL, module: PANEL.module('xyl'), node: null, model: m,
    tokens: new Proxy({}, { get: () => 'currentColor' }), collapsed: false });
  assert.doesNotMatch(plate, /removed|odstraněn/i, 'the plate says no removal');
  assert.match(plate, /Tento dokument Studia nemá PAD L\./);
  assert.match(plate, /data-restore-module="xyl"/);
  // A module that is not optional still reads as removed (the rule is pad L's alone).
  const st2 = defaultStore();
  const eg2 = PANEL.resolve(st2.getModel()).get('eg2').id;
  assert.equal(st2.dispatch({ type: 'NODE_REMOVE', nodeId: eg2 }).ok, true);
  assert.deepEqual(brokenByRemoval(st2.getModel(), PANEL).map((r) => r.module), ['eg2']);
});
