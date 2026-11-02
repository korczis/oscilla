// The one frame of every visual component (rule project.visual-components-framed, plan G001).
//
// What it proves:
//   - the declaration schema: defineComponent accepts visual: true with fullscreenControls and
//     refuses visual that is not a boolean, a visual pattern, fullscreenControls without visual,
//     a control that is not a declaration or not of a frame control kind, and a repeated control;
//   - the frame hooks (<id>.fullscreen, <id>.frame, the controls) are covered by the catalogue,
//     owned by the visual declaration, and refused when another declaration claims one;
//   - the runtime part of the catalogue (catalog/visuals.js) holds exactly the visual
//     declarations of the registry;
//   - frameSizeOf (from the frame's own width), fullscreenModeOf (the API, else the overlay that
//     Safari on iPhone gets) and frameView (what the frame shows, inline and full screen);
//   - the visual census of scripts/ui-catalog/check.mjs: the repository holds it, and mutation
//     fixtures are refused: a canvas, an svg role="img" or a chart host outside a visual frame,
//     a chart host in a non-visual container, a frame-built hook with no visual declaration,
//     and src/index.html with the data-osc of a frame removed;
//   - the ad-hoc full-screen controls are gone: no toggleFullscreen, no is-fullscreen class and
//     no full-screen button written in src/index.html.
//   node --test tests/unit/ui-frame.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CATALOG, createCatalog } from '../../src/js/ui/catalog/registry.js';
import { defineComponent, declarationProblems, frameHooksOf, FRAME_CONTROL_KINDS }
  from '../../src/js/ui/catalog/define.js';
import { VISUAL_CATALOG } from '../../src/js/ui/catalog/visuals.js';
import { FRAME_SIZES, frameSizeOf, frameSlug, frameView, fullscreenModeOf }
  from '../../src/js/ui/catalog/frame.js';
import * as sources from '../../src/js/ui/catalog/sources.js';
import { scanSources, stringLiteralsOf } from '../../scripts/ui-catalog/scan.mjs';
import { checkCatalog, FRAME_MODULE, reader, visualSurfaces }
  from '../../scripts/ui-catalog/check.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (rel) => readFileSync(path.join(ROOT, rel), 'utf8');
const NO_NODES = { list: () => [] };

const VIEW = { id: 'fx.view', kind: 'panel', label: 'Fixture view', visual: true,
  docs: 'Draws the fixture signal for the frame tests.',
  state: { none: 'a framed view that owns no value' } };
const CONTROL = { id: 'fx.view.hold', kind: 'switch', label: 'Hold',
  docs: 'Holds the fixture trace while it fills the screen.', state: 'ui.vizPaused' };

// ------------------------------------------------------------------------------ the schema
test('a visual declaration with full-screen controls is defined and frozen', () => {
  const d = defineComponent({ ...VIEW, fullscreenControls: [CONTROL] });
  assert.equal(d.visual, true);
  assert.ok(Object.isFrozen(d.fullscreenControls[0]));
  assert.deepEqual(frameHooksOf(d), ['fx.view.fullscreen', 'fx.view.frame', 'fx.view.hold']);
  assert.deepEqual(frameHooksOf(defineComponent(VIEW)), ['fx.view.fullscreen'],
    'no menu without full-screen controls');
  assert.deepEqual(frameHooksOf({ ...VIEW, visual: false }), []);
  assert.deepEqual([...FRAME_CONTROL_KINDS], ['action', 'switch', 'choice', 'param']);
});

test('the schema refuses each malformed frame declaration, naming the id', () => {
  const refused = (decl, needle) => {
    const p = declarationProblems(decl).join('\n');
    assert.match(p, needle, JSON.stringify(decl));
    assert.throws(() => defineComponent(decl), (e) => e instanceof TypeError
      && e.message.startsWith(`defineComponent(${decl.id})`));
  };
  refused({ ...VIEW, visual: 'yes' }, /visual must be true or false/);
  refused({ ...VIEW, fullscreenControls: [CONTROL], visual: undefined },
    /fullscreenControls need visual: true/);
  refused({ ...VIEW, fullscreenControls: 'hold' }, /must be a list of declarations/);
  refused({ ...VIEW, fullscreenControls: [null] }, /fullscreenControls\[0\]: must be a declaration/);
  refused({ ...VIEW, fullscreenControls: [{ ...CONTROL, kind: 'panel',
    state: { none: 'a control that owns no value at all' } }] },
  /not a frame control kind/);
  refused({ ...VIEW, fullscreenControls: [{ ...CONTROL, docs: 'Hold' }] },
    /fullscreenControls\[0\]: docs/);
  refused({ ...VIEW, fullscreenControls: [CONTROL, CONTROL] }, /repeats the control/);
  refused({ ...VIEW, fullscreenControls: [{ ...CONTROL, visual: true }] },
    /neither visual, a pattern nor holds controls/);
  refused({ ...VIEW, fullscreenControls: [{ ...CONTROL, in: 'other' }] }, /in must be fx\.view/);
  refused({ ...VIEW, id: 'fx.rows', pattern: { template: 'fx.row.{key}', keys: ['a'],
    sites: ['src/js/fx.js'] } }, /never a pattern/);
  refused({ ...VIEW, fullscreenControls: [{ ...CONTROL, id: 'fx.view.fullscreen' }] },
    /a hook is listed twice/);
});

test('the catalogue covers the frame hooks, owned by the visual, and refuses a second owner', () => {
  assert.ok(!createCatalog([VIEW], NO_NODES).covers('fx.view.frame'));
  const cat = createCatalog([{ ...VIEW, fullscreenControls: [CONTROL] }], NO_NODES);
  for (const h of ['fx.view', 'fx.view.fullscreen', 'fx.view.frame', 'fx.view.hold']) {
    assert.ok(cat.covers(h), h);
  }
  assert.deepEqual(cat.visuals().map((d) => d.id), ['fx.view']);
  assert.throws(() => createCatalog([VIEW, { ...CONTROL, id: 'fx.view.fullscreen' }], NO_NODES),
    /declared twice|duplicate/);
  // The repository: the absorbed full-screen hooks are the frames' own.
  for (const h of ['analysis.fullscreen', 'spectrogram.fullscreen', 'envelope.fullscreen',
    'filter.lab.fullscreen', 'peeper.fullscreen', 'peeper.frame', 'peeper.fsWindow',
    'analysis.frame', 'analysis.fsPause']) {
    assert.ok(CATALOG.covers(h), h);
  }
  assert.equal(CATALOG.get('filter.fullscreen').kind, 'open',
    'Filter Lab\'s expand button is a route, not a full screen');
});

test('the page bundles exactly the visual declarations of the registry', () => {
  const ids = (list) => list.map((d) => d.id).sort();
  assert.deepEqual(ids(VISUAL_CATALOG.visuals()), ids(CATALOG.visuals()));
  for (const d of VISUAL_CATALOG.visuals()) {
    assert.equal(d.visual, true, d.id);
    assert.equal(CATALOG.get(d.id), d, `${d.id}: the same frozen declaration`);
  }
  // Every chart host family and drawing surface named by the owner's order has a frame.
  for (const id of ['analysis', 'spectrogram', 'mic', 'measure.resultView', 'seq.panel',
    'filter.lab', 'envelope', 'additive', 'phase', 'bio', 'exp.detailView', 'exp.compareView',
    'keyboard', 'studio.compact', 'synth.bay', 'peeper']) {
    assert.ok(ids(VISUAL_CATALOG.visuals()).includes(id), id);
  }
  // main.js mounts the frames from this catalogue, never from a list of its own.
  const main = read('src/js/main.js');
  assert.match(main, /createFrames\(\{\s*catalog: VISUAL_CATALOG/);
});

// ------------------------------------------------------------------------------ the frame
test('the size class comes from the frame width, never the device', () => {
  assert.equal(frameSizeOf(0), 'phone');
  assert.equal(frameSizeOf(FRAME_SIZES.small - 1), 'phone');
  assert.equal(frameSizeOf(FRAME_SIZES.small), 'small');
  assert.equal(frameSizeOf(FRAME_SIZES.large - 1), 'small');
  assert.equal(frameSizeOf(FRAME_SIZES.large), 'large');
  assert.equal(frameSizeOf(3840), 'large');
  const src = read('src/js/ui/catalog/frame.js');
  assert.doesNotMatch(src, /navigator\.(userAgent|platform|maxTouchPoints)|innerWidth|screen\.width/,
    'no device sniffing');
});

test('full screen uses the API where the element has it, else the overlay (iOS)', () => {
  const el = { requestFullscreen() {} };
  assert.equal(fullscreenModeOf({ fullscreenEnabled: true }, el), 'api');
  assert.equal(fullscreenModeOf({ webkitFullscreenEnabled: true }, { webkitRequestFullscreen() {} }),
    'api');
  assert.equal(fullscreenModeOf({}, {}), 'overlay', 'Safari on iPhone: no element fullscreen');
  assert.equal(fullscreenModeOf({ fullscreenEnabled: false }, el), 'overlay', 'blocked');
  assert.equal(fullscreenModeOf(null, el), 'overlay');
});

test('the frame shows its trigger, and its menu and controls only when declared', () => {
  const plain = frameView(defineComponent(VIEW));
  assert.equal(plain.trigger.hook, 'fx.view.fullscreen');
  assert.equal(plain.trigger.id, 'osc-fx-view-fullscreen');
  assert.equal(plain.trigger.label, 'Full screen: Fixture view');
  assert.equal(plain.menu, null);
  const d = defineComponent({ ...VIEW, fullscreenControls: [CONTROL] });
  const inline = frameView(d);
  assert.deepEqual(inline.menu.items.map((i) => i.hook), ['fx.view.fullscreen', 'fx.view.hold']);
  assert.equal(inline.menu.id, 'osc-fx-view-frame');
  assert.deepEqual(inline.controls, [], 'the controls row shows only in full screen');
  const full = frameView(d, { full: true, mode: 'overlay' });
  assert.equal(full.trigger.label, 'Exit full screen: Fixture view');
  assert.equal(full.trigger.pressed, true);
  assert.equal(full.trigger.mode, 'overlay');
  assert.deepEqual(full.controls.map((c) => c.hook), ['fx.view.hold']);
  assert.equal(full.menu.items[0].checked, true);
  // The DOM ids the tests named before the frame stay: #osc-analysis-fullscreen.
  assert.equal(frameView(CATALOG.get('analysis')).trigger.id, 'osc-analysis-fullscreen');
  assert.equal(frameSlug('filter.lab'), 'filter-lab');
});

test('the frame parts are Flowbite Pro classes with 44 px coarse targets and no osc-* class', () => {
  const src = read('src/js/ui/catalog/frame.js');
  const literals = stringLiteralsOf(src).join(' ');
  const classes = [...src.matchAll(/^const (BTN|CTRL|MENU|ITEM|BAR|ROW) = ([^;]+);/gm)]
    .map((m) => stringLiteralsOf(m[2]).join(''));
  assert.equal(classes.length, 6);
  for (const c of classes) assert.doesNotMatch(c, /(^|\s)osc-/, 'no osc-* class token');
  assert.match(literals, /\[@media\(pointer:coarse\)\]:w-11/);
  assert.match(literals, /\[@media\(pointer:coarse\)\]:h-11/);
  assert.match(literals, /env\(safe-area-inset-top\)/, 'the overlay keeps the safe area');
});

// ------------------------------------------------------------------------------ the census
const FX_TEST = 'tests/unit/fx.test.mjs';
const realRead = reader(ROOT);
function world(html, decls = [VIEW], js = {}) {
  const traces = {};
  for (const d of decls) {
    traces[d.id] = { source: 'src/fx.html', plan: ['G001'],
      intents: ['component-system#contract-and-registry'], adrs: ['adr-0081'], tests: [FX_TEST] };
  }
  const files = { 'src/fx.html': html, [FX_TEST]: `q('${decls.map((d) => d.id).join("'); q('")}');` };
  return checkCatalog({
    catalog: createCatalog(decls, NO_NODES),
    census: scanSources({ html: { 'src/fx.html': html }, js }),
    allowance: { undeclared: [] }, history: [], sources, traces,
    testCorpus: { runs: () => true,
      strings: (f) => (f in files ? stringLiteralsOf(files[f]) : null) },
    read: (rel) => (rel in files ? files[rel] : realRead(rel)),
    markup: { 'src/fx.html': html },
  });
}
const visualRefusals = (problems) => problems.filter((p) => /outside any visual frame/
  .test(p.message));

test('the census holds when every surface sits in a visual frame', () => {
  const html = '<section data-osc="fx.view"><div class="osc-chart-host"></div>'
    + '<canvas></canvas><svg role="img"></svg></section>';
  assert.deepEqual(world(html), []);
  const s = visualSurfaces(html);
  assert.equal(s.length, 3);
  assert.deepEqual(s[0].frame, ['fx.view']);
});

test('mutation: a canvas outside any frame is refused, with its line', () => {
  const html = '<section data-osc="fx.view"></section>\n<canvas></canvas>';
  const hits = visualRefusals(world(html));
  assert.equal(hits.length, 1);
  assert.equal(hits[0].id, 'src/fx.html:2');
  assert.match(hits[0].message, /<canvas> drawing surface/);
});

test('mutation: an svg role="img" and a data-osc-chart host outside a frame are refused', () => {
  const html = '<section data-osc="fx.view"></section><svg role="img"></svg>'
    + '<div data-osc-chart="x"></div><svg aria-hidden="true"><use href="#i"/></svg>';
  const hits = visualRefusals(world(html));
  assert.deepEqual(hits.map((h) => /svg/.test(h.message) ? 'svg' : 'host'), ['svg', 'host'],
    'an icon svg is not a drawing surface');
});

test('mutation: a chart host inside a container that is not declared visual is refused', () => {
  const plain = { ...VIEW, visual: false, id: 'fx.plain', docs: 'Holds the fixture chart host '
    + 'without a frame.' };
  const html = '<section data-osc="fx.view"></section>'
    + '<section data-osc="fx.plain"><div class="x osc-chart-host"></div></section>';
  const hits = visualRefusals(world(html, [VIEW, plain]));
  assert.equal(hits.length, 1);
  assert.match(hits[0].message, /chart host outside any visual frame/);
});

test('mutation: a frame-built hook with no visual declaration is an uncovered site', () => {
  const plain = { ...VIEW, visual: false };
  const js = { [FRAME_MODULE]: "b.setAttribute('data-osc', view.trigger.hook);" };
  const html = '<section data-osc="fx.view"></section>';
  assert.ok(world(html, [plain], js).some((p) => p.id.startsWith(`${FRAME_MODULE}:`)),
    'refused without a visual declaration');
  assert.ok(!world(html, [VIEW], js).some((p) => p.id.startsWith(`${FRAME_MODULE}:`)),
    'owned by the visual declarations');
});

test('mutation: the repository page with a frame hook removed is refused', () => {
  const page = read('src/index.html');
  assert.deepEqual(visualSurfaces(page).filter((s) => !s.frame.some((h) => {
    const d = CATALOG.get(h);
    return d && d.visual;
  })), [], 'every surface of src/index.html is framed');
  const cut = page.replace(' data-osc="spectrogram"', '');
  assert.notEqual(cut, page);
  const loose = visualSurfaces(cut).filter((s) => !s.frame.some((h) => {
    const d = CATALOG.get(h);
    return d && d.visual;
  }));
  assert.equal(loose.length, 1, 'the spectrogram host is then outside any frame');
});

// ------------------------------------------------------------------------------ absorbed
test('no view keeps a full-screen control of its own', () => {
  const page = read('src/index.html');
  const wb = read('src/js/ui/workbench.js');
  assert.doesNotMatch(wb, /toggleFullscreen\s*\(/);
  assert.doesNotMatch(page, /toggleFullscreen\(/);
  assert.doesNotMatch(page, /is-fullscreen|osc-analysis-fs|osc-spg-fs/);
  for (const id of ['osc-analysis-fullscreen', 'osc-spg-fullscreen', 'osc-env-fullscreen']) {
    assert.ok(!page.includes(`id="${id}"`), `${id} is the frame's, not the markup's`);
  }
  for (const css of ['src/styles/charts.css', 'src/styles/integration.css']) {
    assert.doesNotMatch(read(css), /is-fullscreen|\.osc-panel:fullscreen/, css);
  }
  // Each absorbed panel has the frame's slot where its button was.
  for (const id of ['analysis', 'spectrogram', 'envelope']) {
    const at = page.indexOf(`data-osc="${id}"`);
    assert.ok(at > 0, id);
    assert.ok(page.indexOf('data-osc-frame-slot', at) > at, `${id} has a frame slot`);
  }
});
