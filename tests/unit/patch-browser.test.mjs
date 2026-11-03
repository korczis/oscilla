// K102: ONE tagged library of factory and saved patches for every instrument (the Synth panel,
// the engines, the percussion kit, node presets, the synthesis templates, a registered source
// such as the XY pad's, the person's saves). Every factory patch validates, the instrument and
// tag filters are exact, Apply, Insert and Replace graph are one history entry each, an inserted
// patch that plays notes is what the keys then play, and a patch for an instrument the model
// lacks says so.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  GRAPH, browseView, captureSources, catalogEntries, entryAction, registerPatchSource,
} from '../../src/js/studio/patch-catalog.js';
import { createPatch, importPatch } from '../../src/js/studio/patches.js';
import { nodePresetPatch } from '../../src/js/studio/node-presets.js';
import { createIdGenerator, createStudioStore } from '../../src/js/studio/actions.js';
import { createStudioModel } from '../../src/js/studio/schema.js';
import { templateModel, REFERENCE_TEMPLATE_ID } from '../../src/js/studio/templates/index.js';
import PANEL from '../../src/js/synth/panels/semi-mono.js';
import { panelStore } from './synth-fixture.mjs';
import { registerSynthSources } from '../../src/js/synth/library.js';
import { XY_CATEGORY, XY_RECIPES, xyPatchOf } from '../../src/js/synth/xy.js';

const store = (m) => createStudioStore(m, { idGenerator: createIdGenerator() });

test('every factory patch validates, and every instrument kind is in the one catalog', () => {
  const all = catalogEntries();
  assert.ok(all.length >= 30);
  for (const e of all) {
    const r = importPatch(e.patch);
    assert.equal(r.ok, true, `${e.id}: ${r.ok || r.errors[0].message}`);
    assert.equal(e.source, 'factory');
    assert.ok(e.modes.length >= 1, e.id);
    assert.doesNotMatch(e.name, /moog|korg|roland|yamaha|oberheim|vintage|analog/i, e.id);
  }
  const instruments = new Set(all.map((e) => e.instrument));
  for (const id of [PANEL.id, 'fm-voice', 'perc-voice', 'vco', 'filter', GRAPH]) {
    assert.ok(instruments.has(id), id);
  }
  const tags = new Set(all.flatMap((e) => e.tags));
  for (const t of ['panel', 'engine', 'kit', 'node', 'template', 'preset']) assert.ok(tags.has(t), t);
  assert.equal(new Set(all.map((e) => e.id)).size, all.length, 'ids are unique');
});

test('filters by instrument and by tag are exact, and the counts are the lists\' lengths', () => {
  const st = panelStore();
  const all = catalogEntries();
  const v = browseView(all, st.getModel());
  assert.equal(v.items.length, all.length);
  for (const i of v.instruments) {
    const items = browseView(all, st.getModel(), { instrument: i.id }).items;
    assert.equal(items.length, i.count, i.id);
    assert.ok(items.every((x) => x.instrument === i.id), i.id);
  }
  for (const t of v.tags) {
    const items = browseView(all, st.getModel(), { tag: t.id }).items;
    assert.equal(items.length, t.count, t.id);
    assert.ok(items.every((x) => x.tags.includes(t.id)), t.id);
  }
  const both = browseView(all, st.getModel(), { instrument: 'fm-voice', tag: 'engine' }).items;
  assert.deepEqual(both.map((x) => x.name), ['FM bell', 'FM keys']);
  assert.deepEqual(browseView(all, st.getModel(), { query: 'BELL' }).items.map((x) => x.name)
    .sort(), ['FM bell', 'Ring bell']);
  assert.equal(browseView(all, st.getModel(), { instrument: 'nope' }).items.length, 0);
});

test('Apply, Insert and Replace graph are one history entry each', () => {
  const all = catalogEntries();
  const byId = (id) => all.find((e) => e.id === id);
  for (const [id, mode] of [['synth-bass', 'apply'], ['synth-fm-bell', 'apply'],
    ['synth-fm-bell', 'insert'], ['node-filter-dark', 'insert'],
    ['template-subtractive-synth', 'insert'], ['template-subtractive-synth', 'replace']]) {
    const st = panelStore();
    const before = st.getModel();
    const depth = st.debugInfo().undoDepth;
    const r = entryAction(before, byId(id), mode);
    assert.ok(r.action, `${id} ${mode}: ${r.reason}`);
    const done = st.dispatch(r.action);
    assert.equal(done.ok, true, `${id} ${mode}: ${done.reason}`);
    assert.equal(st.debugInfo().undoDepth, depth + 1, `${id} ${mode}`);
    if (mode === 'apply') {
      const ends = (mm) => mm.graph.edges.map((x) => `${x.id}:${x.from.node}.${x.from.port}>`
        + `${x.to.node}.${x.to.port}`);
      assert.deepEqual(ends(st.getModel()), ends(before), `${id}: every edge kept`);
      assert.equal(st.getModel().graph.nodes.length, before.graph.nodes.length);
    }
    assert.ok(browseView(all, st.getModel()).items.find((x) => x.id === id).inUse,
      `${id} ${mode}: listed as in use`);
    st.undo();
    assert.equal(st.getModel(), before, `${id} ${mode}: undo restores the model`);
  }
});

test('an inserted patch that plays notes is what the keys then play, in the same entry', () => {
  const st = panelStore();
  const e = catalogEntries().find((x) => x.id === 'synth-fm-keys');
  const done = st.dispatch(entryAction(st.getModel(), e, 'insert').action);
  assert.equal(done.ok, true, done.reason);
  const added = done.created.nodes[0];
  const node = st.getModel().graph.nodes.find((n) => n.id === added);
  assert.equal(node.type, 'fm-voice');
  assert.equal(node.metadata.name, 'FM keys');
  assert.equal(st.getModel().metadata.noteTarget, added);
  st.undo();
  assert.equal(st.getModel().metadata.noteTarget, undefined);
});

test('negative: a patch for an instrument the model lacks says so; Insert still adds it', () => {
  const all = catalogEntries();
  const empty = createStudioModel({});
  const ref = templateModel(REFERENCE_TEMPLATE_ID);
  const panel = all.find((e) => e.id === 'synth-bass');
  const v = browseView(all, ref).items.find((x) => x.id === panel.id);
  assert.equal(v.applicable, false);
  assert.match(v.reason, /no Synth panel/);
  assert.match(entryAction(ref, panel, 'apply').reason, /no Synth panel/);
  const fm = all.find((e) => e.id === 'synth-fm-bell');
  assert.match(entryAction(empty, fm, 'apply').reason, /has no FM engine: Insert adds one/);
  const st = store(empty);
  assert.equal(st.dispatch(entryAction(empty, fm, 'insert').action).ok, true);
  assert.equal(entryAction(empty, panel, 'insert').reason, 'Bass cannot be loaded that way.');
  // Several of the type and nothing selected: choose one; selected: it applies to that one.
  const p = panelStore().getModel();
  const dark = all.find((e) => e.id === 'node-filter-dark');
  assert.match(entryAction(p, dark, 'apply').reason, /several Filter nodes: select/);
  const lpf = PANEL.resolve(p).get('lpf').id;
  assert.deepEqual(entryAction(p, dark, 'apply', { target: lpf }).action.onto, { n: lpf });
});

test('the saved patches and a registered source (the XY pad hook) join the same library', () => {
  const st = panelStore();
  const m = st.getModel();
  const res = PANEL.resolve(m);
  const user = [
    { id: 'patch-a', patch: createPatch(m, [res.get('lpf').id], { name: 'My filter' }) },
    { id: 'patch-b', patch: createPatch(m, [res.get('vco1').id, res.get('mix').id],
      { name: 'My pair' }) }];
  registerPatchSource({ id: 'pad-demo', label: 'Demo pad', entries: () => [{ id: 'demo-glass',
    name: 'Glass scale', instrument: 'pad-demo', instrumentLabel: 'Demo pad', modes: ['insert'],
    patch: nodePresetPatch('vco', { id: 'g', name: 'Glass scale', values: { waveform: 'sine' } }),
  }] });
  const all = catalogEntries({ user });
  const saved = browseView(all, m, { tag: 'saved' }).items;
  assert.deepEqual(saved.map((x) => [x.name, x.source, x.modes.join()]),
    [['My filter', 'user', 'apply,insert'], ['My pair', 'user', 'insert,replace']]);
  const xy = browseView(all, m, { instrument: 'pad-demo' }).items;
  assert.deepEqual(xy.map((x) => [x.name, x.tags.join()]), [['Glass scale', 'pad-demo']]);
  assert.equal(st.dispatch(entryAction(m, xy[0], 'insert').action).ok, true);
  assert.throws(() => registerPatchSource({ id: 'Bad Id', entries: () => [] }), TypeError);
});

test('the XY pad\'s presets (K097) are a category of the same library: listed, applied, saved',
  () => {
    registerSynthSources();
    const st = panelStore();
    const m = st.getModel();
    const pad = PANEL.resolve(m).get('xy');
    assert.ok(pad, 'the panel holds the XY pad');
    // The built-ins, made on this document's own panel, under instrument and tag 'xy'.
    const all = catalogEntries({ model: m });
    const xy = browseView(all, m, { tag: XY_CATEGORY }).items;
    assert.deepEqual(xy.map((x) => x.name), XY_RECIPES.map((r) => r.name.split(':')[0]));
    assert.ok(xy.every((x) => x.instrument === XY_CATEGORY && x.applicable), 'all apply here');
    for (const x of xy) assert.equal(importPatch(x.patch).ok, true, x.id);
    // Apply is one entry and sets the recipe's scale on the pad.
    const depth = st.debugInfo().undoDepth;
    const done = st.dispatch(entryAction(m, xy[1], 'apply').action);
    assert.equal(done.ok, true, done.reason);
    assert.equal(st.debugInfo().undoDepth, depth + 1);
    const p = PANEL.resolve(st.getModel()).get('xy').params;
    assert.deepEqual([p.mode, p.key], [XY_RECIPES[1].scale.mode, XY_RECIPES[1].scale.key]);
    // A saved XY preset (xyPatchOf) is listed under 'xy' and saved, and loads the same way.
    const mine = xyPatchOf(st.getModel(), PANEL, { name: 'My dorian pad' });
    const user = [{ id: 'patch-my-dorian-pad', patch: mine }];
    st.undo();
    const listed = browseView(catalogEntries({ user, model: st.getModel() }), st.getModel(),
      { tag: 'saved' }).items.find((x) => x.name === 'My dorian pad');
    assert.equal(listed.instrument, XY_CATEGORY);
    assert.ok(listed.tags.includes(XY_CATEGORY));
    assert.equal(st.dispatch(entryAction(st.getModel(), listed, 'apply').action).ok, true);
    assert.equal(PANEL.resolve(st.getModel()).get('xy').params.mode, XY_RECIPES[1].scale.mode);
    // Capture: the source turns the document's pad into a patch to save, named as asked.
    const cap = captureSources(st.getModel()).find((c) => c.id === XY_CATEGORY);
    assert.equal(cap.label, 'XY pad');
    const saved = cap.capture('Night drive');
    assert.equal(saved.category, XY_CATEGORY);
    assert.equal(saved.name, 'Night drive');
    assert.equal(importPatch(saved).ok, true);
    // Without the panel the built-ins are not offered (nothing to make them on).
    const bare = templateModel(REFERENCE_TEMPLATE_ID);
    assert.equal(catalogEntries({ model: bare }).filter((x) => x.instrument === XY_CATEGORY)
      .length, 0);
  });
