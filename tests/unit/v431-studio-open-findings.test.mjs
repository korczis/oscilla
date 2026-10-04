// V431 review follow-ups #21 and #23-#30 (docs/v31/review-v431.md), the parts a unit test can
// reach; each test fails on the code before its fix. #22 (R1) is in v31-studio-gaps.test.mjs,
// the browser halves of #21, #26 and #27 in tests/browser/v31-studio-graph.cjs
// (phone-port-targets, review-open-ui).
//   node --test tests/unit/v431-studio-open-findings.test.mjs
// New exports are read through module namespaces, so a missing one fails its own test only.
// Tolerances: none (plain data and text), except the zoom floor (exact quotient 24 / 26).

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { createIdGenerator, createStudioStore } from '../../src/js/studio/actions.js';
import * as a11y from '../../src/js/studio/a11y.js';
import { importStudio } from '../../src/js/studio/migrate.js';
import { replaceWithPatch, createPatch } from '../../src/js/studio/patches.js';
import * as schema from '../../src/js/studio/schema.js';
import { projectSignalPath } from '../../src/js/studio/signal-path-projection.js';
import { MEASUREMENT_TEMPLATE_ID, templateModel } from '../../src/js/studio/templates/index.js';
import { validateClip } from '../../src/js/studio/timeline.js';
import * as validate from '../../src/js/studio/validate.js';
import * as geometry from '../../src/js/ui/studio/graph-geometry.js';
import { nodeCard } from '../../src/js/ui/studio/graph-view.js';
import { createStoreHandle } from '../../src/js/ui/studio/workspace.js';

const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');
const storeOf = (m) => createStudioStore(m, { idGenerator: createIdGenerator(m) });
const ok = (r) => {
  assert.ok(r.ok, r.reason);
  return r;
};

// ---------------------------------------------------------------- #21 (U9)

test('#21 U9 a fit on a coarse pointer never zooms below the 24 px port target floor', () => {
  const floor = geometry.COARSE_FIT_MIN_ZOOM;
  assert.equal(floor, 24 / 26, 'the coarse port row (26 units) is 24 px on screen');
  // The Subtractive Synth framed into a 390 px phone canvas: about 0.37 without the floor.
  const bounds = { x: 0, y: 0, w: 920, h: 360 };
  const size = { w: 358, h: 520 };
  assert.ok(geometry.fitView(bounds, size).zoom < 0.4, 'fine pointer: everything framed');
  const v = geometry.fitView(bounds, size, { minZoom: floor });
  assert.equal(v.zoom, floor);
  // Still centred on the bounds.
  assert.equal(v.panX + 460 * floor, size.w / 2);
  assert.equal(v.panY + 180 * floor, size.h / 2);
});

// ---------------------------------------------------------------- #23 (A8)

function lfoInto(props) {
  const store = storeOf(null);
  const add = (nodeType) => ok(store.dispatch({ type: 'NODE_ADD', nodeType,
    position: { x: 0, y: 0 } })).created.nodes[0];
  const osc = add('oscillator');
  const lfo = add('lfo');
  const master = add('master');
  ok(store.dispatch({ type: 'EDGE_ADD', from: { node: osc, port: 'audio' },
    to: { node: master, port: 'audio' } }));
  ok(store.dispatch({ type: 'EDGE_ADD', from: { node: lfo, port: 'control' },
    to: { node: osc, port: 'frequency' }, props: { depth: 100, ...props } }));
  return projectSignalPath(store.getModel()).stages[1];
}

test('#23 A8 the Signal Path reads an edge\'s polarity and mute', () => {
  assert.match(lfoInto({}).sub, / · ±100 Hz$/, 'bipolar: [-100, 100]');
  const uni = lfoInto({ polarity: 'unipolar' });
  assert.match(uni.sub, / · \+100 Hz$/, 'unipolar: [0, 100], not ±100');
  assert.equal(uni.enabled, true);
  assert.match(lfoInto({ polarity: 'unipolar', depth: -50 }).sub, / · −50 Hz$/);
  const muted = lfoInto({ muted: true });
  assert.equal(muted.enabled, false, 'a muted modulation is drawn bypassed');
  assert.match(muted.sub, / · ±100 Hz · muted$/);
});

// ---------------------------------------------------------------- #24 (A9)

test('#24 A9 the store refuses an out-of-range measurement clip with the editor\'s rule', () => {
  const store = storeOf(templateModel(MEASUREMENT_TEMPLATE_ID));
  for (const [clipId, duration] of [['clip-2', 8], ['clip-4', 0.05], ['clip-1', 0.1]]) {
    const before = store.getModel();
    const clip = before.timeline.clips.find((c) => c.id === clipId);
    const editor = validateClip(before, { ...clip, duration });
    assert.equal(editor.ok, false, `${clipId}: the editor refuses ${duration} s`);
    const r = store.dispatch({ type: 'CLIP_RESIZE', clipId, duration });
    assert.equal(r.ok, false, `${clipId}: the store refuses ${duration} s`);
    assert.equal(r.reason, editor.errors[0].message, 'one rule, one sentence');
    assert.equal(store.getModel(), before);
  }
  // A measurement clip on the wrong target is refused by the store as well.
  const before = store.getModel();
  const r = store.dispatch({ type: 'CLIP_UPDATE', clipId: 'clip-3', target: 'mic-1' });
  assert.equal(r.ok, false);
  assert.match(r.reason, /stimulus clip needs a sweep target/);
  assert.equal(store.getModel(), before);
  // The template itself, and in-range edits, still pass.
  ok(store.dispatch({ type: 'CLIP_RESIZE', clipId: 'clip-2', duration: 2 }));
});

test('#24 A9 store and editor give the same clip errors for every clip (one rule table)', () => {
  const m = templateModel(MEASUREMENT_TEMPLATE_ID);
  const doc = schema.copyPlain(m);
  const bad = [
    { duration: 8 }, { duration: 0.02 }, { start: -1 }, { target: 'nope' },
    { payload: { action: 'explode' } }, { musical: { startBeats: 0, durationBeats: 2 } },
  ];
  doc.timeline.clips = bad.map((patch, i) => ({ ...doc.timeline.clips[1], ...patch,
    id: `bad-${i}` }));
  const model = schema.normalizeStudio(doc);
  const store = validate.validateStudioModel(model).errors
    .filter((d) => /^timeline\.clips\[/.test(d.path));
  const editor = model.timeline.clips.flatMap((c, i) => validateClip(model, c).errors
    .map((d) => ({ ...d, path: `timeline.clips[${i}].${d.path}` })));
  const key = (d) => `${d.path} ${d.code} ${d.message}`;
  assert.deepEqual(store.map(key), editor.map(key));
  assert.equal(store.length, bad.length);
});

test('#24 A9 the node-removal cascade and the import front end exist once', () => {
  assert.equal(typeof schema.withoutNodes, 'function');
  assert.equal(typeof validate.readStudioInput, 'function');
  const store = storeOf(templateModel('subtractive-synth'));
  const m = store.getModel();
  ok(store.dispatch({ type: 'NODE_REMOVE', nodeIds: ['filter-1', 'lfo-1'] }));
  assert.deepEqual(store.getModel().graph, schema.withoutNodes(m, ['filter-1', 'lfo-1']).graph);
  assert.deepEqual(store.getModel().timeline, schema.withoutNodes(m, ['filter-1', 'lfo-1'])
    .timeline);
  const patch = createPatch(m, ['osc-1'], { name: 'One' });
  const r = replaceWithPatch(m, patch);
  const emptied = schema.withoutNodes(m, m.graph.nodes.map((n) => n.id));
  assert.deepEqual(r.model.timeline.clips, emptied.timeline.clips);
  assert.deepEqual(r.model.timeline.tracks, emptied.timeline.tracks);
  // No second copy left in the modules that had one.
  assert.doesNotMatch(read('src/js/studio/actions.js'), /gone\.has\(x\.target\)/);
  assert.doesNotMatch(read('src/js/studio/patches.js'), /gone\.has\(x\.target\)/);
  assert.doesNotMatch(read('src/js/studio/migrate.js'), /JSON\.parse\(|scanUntrusted\(/);
  assert.doesNotMatch(read('src/js/studio/validate.js'), /'clip-kind-mismatch'/);
  // The front end answers both pipelines identically (here: before any migration code).
  const deep = { kind: 'oscilla-studio', schemaVersion: 1, metadata: { notes: 'x' } };
  let o = deep.metadata;
  for (let i = 0; i < 20; i++) o = (o.n = {});
  const a = importStudio(deep);
  const b = validate.validateStudioImport(deep);
  assert.equal(a.ok, false);
  assert.deepEqual(a.errors, b.errors);
  assert.match(a.errors[0].message, /nested deeper than 12 levels/);
});

// ---------------------------------------------------------------- #25 (X10)

test('#25 X10 createStoreHandle().replace(partial) gives a schema error or a normalized model',
  () => {
    const h = createStoreHandle(templateModel('basic-tone'));
    assert.throws(() => h.replace({ graph: { nodes: [{ id: 'x' }] } }),
      (e) => e instanceof schema.StudioSchemaError && /initial model is invalid/.test(e.message));
    const m = h.replace({ metadata: { title: 'Partial' } });
    assert.equal(m.metadata.title, 'Partial');
    assert.equal(m.graph.nodes.length, 0);
    const r = ok(h.dispatch({ type: 'NODE_ADD', nodeType: 'oscillator',
      position: { x: 0, y: 0 } }));
    assert.deepEqual(r.created.nodes, ['osc-1'], 'ids seeded from the store\'s model');
    h.replace(templateModel('basic-tone'));
    const id = ok(h.dispatch({ type: 'NODE_ADD', nodeType: 'oscillator',
      position: { x: 0, y: 0 } })).created.nodes[0];
    assert.equal(id, 'osc-2', 'next to the template\'s osc-1');
  });

// ---------------------------------------------------------------- #28 (U12)

test('#28 U12 each Studio subview tab has an id and controls a tabpanel', () => {
  const html = read('src/index.html');
  const tabs = [...html.matchAll(/<button[^>]*data-osc="studio\.subview"[^>]*>/g)].map((t) => t[0]);
  assert.equal(tabs.length, 3);
  for (const tab of tabs) {
    const id = /\sid="([^"]+)"/.exec(tab);
    const controls = /aria-controls="([^"]+)"/.exec(tab)[1];
    assert.ok(id, `${controls}: the tab has an id`);
    const panel = new RegExp(`<section[^>]*id="${controls}"[^>]*>`).exec(html);
    assert.ok(panel, `${controls} exists`);
    assert.match(panel[0], /role="tabpanel"/, `${controls} is a tabpanel`);
  }
  // U11 in the same markup: the toolbar Play keeps one name; only aria-pressed toggles.
  const play = /<button[^>]*data-osc="studio\.play"[^>]*>/.exec(html)[0];
  assert.doesNotMatch(play, /:aria-label=/);
  assert.match(play, /\saria-label="Play the Studio"/);
  assert.match(play, /:aria-pressed=/);
});

// ---------------------------------------------------------------- #29 (U13)

test('#29 U13 a single selected clip is announced with its name and track', () => {
  const m = templateModel('subtractive-synth');
  const clip = m.timeline.clips[1];
  const track = m.timeline.tracks.find((t) => t.id === clip.trackId);
  assert.equal(a11y.announceSelection(m, { clips: [clip.id] }),
    `Sweep clip on ${track.name} selected`);
  assert.equal(a11y.announceSelection(m, { clips: m.timeline.clips.map((c) => c.id) }),
    '2 clips selected');
  assert.equal(typeof a11y.clipLabel, 'function', 'one clip naming (compact.js re-exports it)');
});

// ---------------------------------------------------------------- #30 (U14)

test('#30 U14 a node\'s accessible label carries its connection counts', () => {
  const m = templateModel('subtractive-synth');
  const label = (id) => nodeCard(m, m.graph.nodes.find((n) => n.id === id)).ariaLabel;
  assert.match(label('osc-1'), /, 1 output connection$/, 'a source has no inputs to count');
  assert.match(label('master-1'), /, 1 input connection$/, 'Master Output has no outputs');
  assert.match(label('filter-1'), /, 2 input connections, 2 output connections$/);
});
