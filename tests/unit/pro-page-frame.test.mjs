// The one Pro page frame (issue F002 shell:main, owner decision Q110 of 2026-11-17): every
// workspace stands in one Flowbite Pro page container (PRO.page, the PRO_STRUCTURE.page of
// scripts/ui-flowbite-pro-measure.mjs), so every page's content starts at the same inset under
// the shared page header; <main> has no padding of its own; no view keeps a frame of its own
// in a legacy stylesheet; the visible page title is the page header's alone. The workspaces
// are the registry's (src/js/ui/shell.js WORKSPACE_REGISTRY), never a list typed here.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { mainFrameOf, ownsViewOf, WORKSPACE_IDS } from '../../src/js/ui/shell.js';
import { PRO } from '../../src/js/ui/pro-classes.js';
import {
  boundProClasses, openingTags, PRO_STRUCTURE,
} from '../../scripts/ui-flowbite-pro-measure.mjs';

const ROOT = new URL('../..', import.meta.url).pathname;
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const HTML = read('src/index.html');
const FRAME = PRO.page.split(/\s+/);
const classesOf = (tag) => new Set(((tag.match(/\sclass="([^"]*)"/) || [])[1] || '')
  .split(/\s+/).filter(Boolean));

/** id -> the opening tag of <section id="osc-view-<id>">, for every view of the markup. */
const VIEWS = new Map([...HTML.matchAll(/<section\b[^>]*\bid="osc-view-([\w-]+)"[^>]*>/g)]
  .map((m) => [m[1], m[0]]));
/** A view's attributes, as the Pro measure reads them. */
const attrsOf = (tag) => openingTags(tag)[0].attrs;
/** A view's frame classes: what it binds through PRO, as the Pro measure resolves it. */
const frameOf = (tag) => new Set(boundProClasses(attrsOf(tag)));
const MAIN = HTML.match(/<main\b[^>]*\bid="osc-main"[^>]*>/)[0];

/** The rules of every stylesheet under src/styles, comments removed: [{ file, sel, body }]. */
const RULES = readdirSync(join(ROOT, 'src/styles')).filter((f) => f.endsWith('.css'))
  .flatMap((file) => [...read(`src/styles/${file}`).replace(/\/\*[\s\S]*?\*\//g, '')
    .matchAll(/([^{}@;]+)\{([^{}]*)\}/g)]
    .map((m) => ({ file, sel: m[1].trim(), body: m[2] })));
// What frames a box: its padding, margin, border, background and, for a view, its least height.
const FRAME_PROPS = 'padding|padding-[a-z]+|margin|margin-[a-z]+|border|border-[a-z-]+'
  + '|background|background-color';
const MAIN_FRAME = new RegExp(`(^|;)\\s*(${FRAME_PROPS})\\s*:`);
const VIEW_FRAME = new RegExp(`(^|;)\\s*(${FRAME_PROPS}|min-height)\\s*:`);

test('PRO.page is the Pro page structure the ratchet judges a page by', () => {
  assert.ok(PRO_STRUCTURE.page.some((set) => set.length === FRAME.length
    && set.every((c) => FRAME.includes(c))), `PRO.page "${PRO.page}"`);
});

test('every workspace of the registry stands in the one Pro page frame', () => {
  for (const id of WORKSPACE_IDS) {
    if (ownsViewOf(id)) {
      const tag = VIEWS.get(id);
      assert.ok(tag, `${id} is a view in the registry, so src/index.html has #osc-view-${id}`);
      const cls = frameOf(tag);
      for (const c of FRAME) assert.ok(cls.has(c), `#osc-view-${id} binds ${c} (PRO.page)`);
      for (const c of FRAME) {
        assert.ok(!mainFrameOf(id).split(/\s+/).includes(c),
          `${id}: <main> adds no second frame (${c}) around its view`);
      }
    } else {
      assert.ok(!VIEWS.has(id), `${id} has a view in the markup: mark it view: true`);
      const frame = mainFrameOf(id).split(/\s+/);
      for (const c of PRO.pageView.split(/\s+/)) {
        assert.ok(frame.includes(c), `${id}: <main> carries ${c} (PRO.pageView)`);
      }
    }
  }
});

test('the frame has one source: every view binds a PRO token, none repeats its classes', () => {
  // The review of 2c0fcf43 (P1 DRY): the frame's classes are written once, in
  // src/js/ui/pro-classes.js; a view binds PRO.pageView (the Synth PRO.page: its bottom keeps
  // the docked keys' band) unconditionally on its root, where the Pro measure reads it.
  assert.ok(PRO.pageView.startsWith(`${PRO.page} pb-6`), 'PRO.pageView is PRO.page with pb-6');
  for (const [id, tag] of VIEWS) {
    const attrs = attrsOf(tag);
    const own = classesOf(tag);
    for (const c of [...FRAME, 'pb-6']) {
      assert.ok(!own.has(c), `#osc-view-${id} repeats the frame class ${c} literally`);
    }
    const via = /PRO\.(pageView|pageEditor|pageDocked|page)\b/.exec(attrs[':class'] || '');
    assert.ok(via, `#osc-view-${id} binds a PRO page token`);
    assert.deepEqual(boundProClasses(attrs), PRO[via[1]].split(/\s+/),
      `#osc-view-${id} binds PRO.${via[1]} unconditionally (the measure resolves it)`);
  }
  const literal = /\bpx-4 pt-6\b/;
  for (const m of HTML.matchAll(/<section\b[^>]*\bid="osc-view-[\w-]+"[^>]*>/g)) {
    assert.doesNotMatch(m[0], literal, 'no view writes the frame literally');
  }
});

test('a phone variant of the frame is the desktop frame plus max-md: overrides only', () => {
  // The Studio (PRO.pageEditor) and the Synth (PRO.pageDocked) keep the one frame from md up;
  // below it the docked keys and 44 px controls take a tighter inset (#601's phone legs).
  for (const [key, base] of [['pageView', `${PRO.page} pb-6`], ['pageEditor', PRO.pageView],
    ['pageDocked', PRO.page]]) {
    const cls = PRO[key].split(/\s+/);
    for (const c of base.split(/\s+/)) assert.ok(cls.includes(c), `PRO.${key} keeps ${c}`);
    for (const c of cls.filter((x) => !base.split(/\s+/).includes(x))) {
      assert.match(c, /^max-md:!p[xt]-\d+$/, `PRO.${key}: ${c} is a phone inset override`);
    }
  }
});

test('the registry\'s view flag and the markup\'s views agree, both ways', () => {
  // `view: true` is typed in the registry; the views are sections of src/index.html. Neither
  // may drift from the other: every flagged id has its section, every section is flagged.
  const flagged = WORKSPACE_IDS.filter(ownsViewOf).sort();
  const sections = [...VIEWS.keys()].sort();
  assert.ok(sections.length > 0, 'the reader finds the views of the markup');
  assert.deepEqual(flagged, sections,
    `view: true in the registry (${flagged}) = the #osc-view-<id> sections (${sections})`);
  for (const id of sections) assert.ok(WORKSPACE_IDS.includes(id), `${id} is a workspace`);
});

test('<main> binds the frame and has no padding of its own', () => {
  assert.match(MAIN, /:class="\[mainFrame\(\),/, '<main> binds shell.js mainFrame()');
  for (const c of classesOf(MAIN)) {
    assert.doesNotMatch(c, /^!?(max-|min-|sm:|md:|lg:|xl:|2xl:)*p[xytrbl]?-/, `<main> ${c}`);
  }
  // A card scrolled into view keeps the frame's top gap: scroll padding = the frame's pt
  // (tests/unit/page-frame.test.mjs holds it per workspace).
  const frame = mainFrameOf(WORKSPACE_IDS.find((id) => !ownsViewOf(id))).split(/\s+/);
  const pt = frame.find((c) => /^pt-/.test(c));
  assert.ok(frame.includes(`scroll-${pt}`), `<main>'s frame pairs ${pt} with scroll-${pt}`);
});

test('no legacy stylesheet keeps a frame of its own for <main> or a view', () => {
  // A rule whose subject is <main> (.osc-main) or a view (.osc-view, .osc-view--<id>, with
  // attribute conditions); the Studio's browser fullscreen is its own window, not the page.
  const subject = (re) => (r) => r.sel.split(',').map((x) => x.trim())
    .some((x) => re.test(x) && !/:fullscreen/.test(x));
  const ofMain = subject(/\.osc-main(\[[^\]]*\])*$/);
  const ofView = subject(/\.osc-view(--[\w-]+)?(\[[^\]]*\])*$/);
  let seen = 0;
  for (const r of RULES) {
    if (ofMain(r)) {
      seen += 1;
      const own = r.body.match(MAIN_FRAME);
      assert.ok(!own, `${r.file}: ${r.sel} sets ${own && own[2]} on <main>`);
    }
    if (ofView(r)) {
      const own = r.body.match(VIEW_FRAME);
      assert.ok(!own, `${r.file}: ${r.sel} frames a view itself (${own && own[2]})`);
    }
  }
  assert.ok(seen > 0, 'the reader finds the rules of <main>');
});

test('the measure view, shown on the Playground too, drops its frame there', () => {
  // Its :hidden lets it show on another workspace; there it stands in <main>'s frame.
  const tag = VIEWS.get('measure');
  assert.match(tag, /:hidden="workspace !== 'measure' && workspace !== 'playground'"/);
  assert.match(tag, /:class="\[PRO\.pageView, workspace !== 'measure' && '!p-0'\]"/);
  for (const [id, t] of VIEWS) {
    if (id === 'measure') continue;
    const hidden = (t.match(/:hidden="([^"]*)"/) || [])[1] || '';
    assert.match(hidden, new RegExp(`^(workspace|mode) !== '${id}'$`),
      `#osc-view-${id} shows on its own workspace only`);
  }
});

test('the visible page title is the page header\'s alone', () => {
  assert.doesNotMatch(HTML, /PRO\.pageTitle/, 'no page heading class in the content');
  assert.ok(!('pageTitle' in PRO), 'PRO has no page heading class');
  const main = HTML.slice(HTML.indexOf(MAIN), HTML.indexOf('</main>'));
  assert.doesNotMatch(main, /aria-label="(Breadcrumb|Drobečková navigace)"/,
    'no breadcrumb of a page\'s own in <main>');
  for (const [id, tag] of VIEWS) {
    const label = (tag.match(/aria-labelledby="([^"]+)"/) || [])[1];
    assert.ok(label, `#osc-view-${id} is labelled by its heading`);
    const h = HTML.match(new RegExp(`<h[1-6]\\b[^>]*\\bid="${label}"[^>]*>`))[0];
    // About's hero names the brand ("O aplikaci" unseen before OSCILLA), not the page.
    if (id === 'about') continue;
    assert.match(h, /class="(osc-)?sr-only"/, `#${label} heads #osc-view-${id} unseen`);
  }
  // The Synth's tab, once an in-view "Synth / <tab>", is the page header's last crumb.
  const header = HTML.slice(HTML.indexOf('data-osc="page.header"'),
    HTML.indexOf('data-osc="page.summary"'));
  assert.match(header,
    /aria-current="page" x-show="workspaceTabLabel\(\)"[\s\S]*?x-text="workspaceTabLabel\(\)"/);
  assert.match(read('src/js/ui/app.js'), /workspaceTabLabel\(\) \{[\s\S]*?synth\.tabs\.find/);
});
