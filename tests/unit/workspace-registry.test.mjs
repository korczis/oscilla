// Lane A wave 3: the workspace registry (src/js/ui/shell.js WORKSPACE_REGISTRY) carries the
// page fields agreed with lane D (summary, related, enter, phone, empty), and what the pages
// show of them is derived, never kept by hand a second time:
//
// - related: every id is a registry id, every page has one to three, each address
//   (`#m=<id><hash>`) is one routeOfHash (ui/navigation.js) sends to that id; the panel links
//   (ui/counterparts.js PANEL_LINKS: the counterparts and the Studio template links) are
//   generated from it, each written once in src/index.html with the generated href and text.
// - enter: every key is a control hook of src/index.html with the value it is given, and only
//   Compare declares one (lane A adds no other); applyEnter goes through the control.
// - phone: a primary names an own panel of the workspace; markWorkspacePanels leads with it.
// - empty: every `when` is a predicate an adapter registered (ui/empty-states.js), every action
//   leads to a registry id, and the page holds one empty-state block for it.
// - The page header renders the summary and the Related strip from the registry, its actions
//   slot holds the listening notice's reopen; About's list and the shortcut dialog's names are
//   the registry's.
//   node --test tests/unit/workspace-registry.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  phonePrimaryOf, relatedHref, relatedOf, relatedRef, WORKSPACE_LABELS, WORKSPACE_REGISTRY,
} from '../../src/js/ui/shell.js';
import { routeOfHash } from '../../src/js/ui/navigation.js';
import {
  COUNTERPARTS, PANEL_LINKS, counterpartsOf, livePanelLinks,
} from '../../src/js/ui/counterparts.js';
import {
  STUDIO_TEMPLATE_LINKS, relatedText, studioTemplateHref, studioTemplateText, templateOfRef,
} from '../../src/js/ui/cross-links.js';
import {
  applyEnter, createOscillaUi, markWorkspacePanels, WORKSPACES,
} from '../../src/js/ui/app.js';
import { emptyPredicateHolds, emptyPredicateNames } from '../../src/js/ui/empty-states.js';
import { WORKSPACE_LABELS as SHORTCUT_LABELS } from '../../src/js/ui/shortcuts.js';
// The adapters register their predicates when they load (presets.noCustom).
import '../../src/js/ui/workbench.js';

const ROOT = new URL('../../', import.meta.url);
const HTML = readFileSync(new URL('src/index.html', ROOT), 'utf8')
  .replace(/<!--[\s\S]*?-->/g, '');
const IDS = WORKSPACE_REGISTRY.map((w) => w.id);
// Lane D's pages: summary and related only, until their owner fills the rest.
const LANE_D = ['experiments', 'analyzer', 'compare'];
// The pages whose empty state lane A fills (only where a real empty state exists).
const LANE_A_PAGES = ['filter', 'synthesis', 'sequencer', 'presets', 'learn', 'about'];

/** Every start tag of the markup carrying data-osc="<osc>". */
function tagsOf(osc) {
  return HTML.match(new RegExp(`<[a-z]+\\b[^>]*\\bdata-osc="${osc.replace(/\./g, '\\.')}"`
    + '[^>]*>', 'g')) || [];
}

test('every page has a one-sentence summary and one to three related pages', () => {
  assert.deepEqual(IDS, WORKSPACES, 'the registry is the navigation');
  for (const w of WORKSPACE_REGISTRY) {
    assert.equal(typeof w.summary, 'string', `${w.id}: summary`);
    assert.match(w.summary, /^[A-Z][^]*\.$/, `${w.id}: a sentence`);
    assert.doesNotMatch(w.summary.slice(0, -1), /[.!?]\s/, `${w.id}: one sentence`);
    assert.ok(w.summary.split(/\s+/).length >= 6, `${w.id}: says what it is for`);
    const rel = relatedOf(w.id);
    assert.ok(rel.length >= 1 && rel.length <= 3, `${w.id}: ${rel.length} related`);
  }
});

test('every related id is a registry id, and its address routes to it', () => {
  for (const w of WORKSPACE_REGISTRY) {
    const refs = new Set();
    for (const r of relatedOf(w.id)) {
      assert.deepEqual(Object.keys(r).filter((k) => !['id', 'why', 'hash'].includes(k)), [],
        `${w.id} -> ${r.id}: only id, why and hash`);
      assert.ok(IDS.includes(r.id), `${w.id}: related ${r.id} is no registry id`);
      assert.notEqual(r.id, w.id, `${w.id} relates to itself`);
      assert.ok(typeof r.why === 'string' && r.why.length >= 8 && r.why.length <= 80,
        `${w.id} -> ${r.id}: a short reason`);
      if (r.hash !== undefined) assert.match(r.hash, /^&[a-z]+=[\w-]+$/, `${w.id}: hash`);
      const route = routeOfHash(relatedHref(r));
      assert.ok(route && route.workspace === r.id && !route.badRoute,
        `${w.id}: ${relatedHref(r)} routes to ${route && route.workspace}, not ${r.id}`);
      assert.ok(!refs.has(relatedRef(r)), `${w.id}: ${relatedRef(r)} twice`);
      refs.add(relatedRef(r));
      assert.ok(relatedText(r).length > 0);
    }
  }
});

test('the panel links are generated from related, each written once with that href and text',
  () => {
    assert.deepEqual(livePanelLinks().map((l) => l.osc), PANEL_LINKS.map((l) => l.osc),
      'a panel link whose workspace does not relate to its target (fix the registry or drop it)');
    for (const l of PANEL_LINKS) {
      const tags = tagsOf(l.osc);
      assert.equal(tags.length, 1, `${l.osc} is written once (${tags.length})`);
      assert.ok(tags[0].startsWith('<a '), `${l.osc} is a link`);
      const href = `#m=${l.to}`.replace(/&/g, '&amp;');
      assert.ok(tags[0].includes(`href="${href}"`), `${l.osc}: href ${href}`);
      const at = HTML.indexOf(tags[0]) + tags[0].length;
      const text = HTML.slice(at, HTML.indexOf('</a>', at)).trim();
      const tpl = templateOfRef(l.to);
      const want = l.text || (tpl ? studioTemplateText({ title: STUDIO_TEMPLATE_LINKS
        .find((s) => s.osc === l.osc).title }) : `Open the ${WORKSPACE_LABELS[l.to]}`);
      assert.equal(text, want, `${l.osc}: its text`);
    }
    // The tables the panels and the suites read are the generated ones.
    assert.deepEqual(COUNTERPARTS.slice(1), counterpartsOf());
    assert.equal(COUNTERPARTS[0].id, 'measure-rta', 'the one hand-kept row (a MEASURE tab)');
    for (const s of STUDIO_TEMPLATE_LINKS) {
      assert.ok(relatedOf(s.from).some((r) => relatedHref(r) === studioTemplateHref(s.template)),
        `${s.osc}: ${s.from} relates to the template`);
    }
  });

test('mutation: a panel link loses its target when the registry stops relating to it', () => {
  const links = [...PANEL_LINKS, { osc: 'learn.toSynth', from: ['learn'], to: 'studio' },
    { osc: 'about.toSynth', from: ['about'], to: 'synth' }];
  const live = livePanelLinks(links).map((l) => l.osc);
  assert.ok(!live.includes('learn.toSynth') && !live.includes('about.toSynth'), live.join());
  const synth = counterpartsOf(livePanelLinks(PANEL_LINKS.filter((l) => l.osc !== 'seq.toSynth')))
    .find((c) => c.id === 'synth');
  assert.deepEqual([...synth.from], ['filter', 'synthesis', 'presets']);
});

test('every enter key is a real control hook with that value; only Compare declares one', () => {
  const entering = WORKSPACE_REGISTRY.filter((w) => w.enter);
  assert.deepEqual(entering.map((w) => w.id), ['compare']);
  for (const w of entering) {
    for (const [osc, value] of Object.entries(w.enter)) {
      const tags = tagsOf(osc);
      assert.ok(tags.length > 0, `${w.id}: enter ${osc} is no data-osc of src/index.html`);
      const choice = tags.some((t) => t.includes(`data-value="${value}"`));
      const field = tags.some((t) => /^<(select|input|textarea)\b/.test(t));
      assert.ok(choice || field, `${w.id}: no ${osc} control takes "${value}"`);
    }
  }
  assert.deepEqual(entering[0].enter, { 'mic.tab': 'compare' });
});

test('applyEnter goes through the control: a click, or the field\'s own events', () => {
  const log = [];
  const el = (tag, attrs, value) => ({ tagName: tag, dataset: { value: attrs['data-value'] },
    value, getAttribute: (k) => attrs[k] ?? null, click() { log.push(`click ${attrs.id}`); },
    dispatchEvent(e) { log.push(`${e.type} ${attrs.id}=${this.value}`); return true; } });
  const live = el('BUTTON', { id: 'live', 'data-value': 'live', 'aria-selected': 'true' });
  const cmp = el('BUTTON', { id: 'compare', 'data-value': 'compare', 'aria-selected': 'false' });
  const sel = el('SELECT', { id: 'tempo' }, '120');
  const root = { querySelectorAll: (s) => ({ '[data-osc="mic.tab"]': [live, cmp],
    '[data-osc="seq.tempo"]': [sel] }[s] || []) };
  assert.deepEqual(applyEnter(root, { 'mic.tab': 'compare', 'seq.tempo': '90', 'no.such': 'x' }),
    ['mic.tab', 'seq.tempo']);
  assert.deepEqual(log, ['click compare', 'input tempo=90', 'change tempo=90']);
  log.length = 0;
  cmp.getAttribute = (k) => (k === 'aria-selected' ? 'true' : null);
  applyEnter(root, { 'mic.tab': 'compare', 'seq.tempo': '90' });
  assert.deepEqual(log, [], 'a control already at the value is left alone');
});

test('setWorkspace applies enter when the workspace is entered, not when it is shown again',
  () => {
    const ui = createOscillaUi({ storedAnalysisTab: null });
    const entered = [];
    const ticks = [];
    Object.assign(ui, { $root: { querySelectorAll: () => [] }, emit() {},
      $nextTick: (fn) => { ticks.push(fn); }, focusWorkspace() {},
      enterWorkspace: (m) => { entered.push(m); return []; } });
    ui.setWorkspace('compare');
    ui.setWorkspace('compare');
    ui.setWorkspace('filter');
    for (const fn of ticks.splice(0)) fn();
    assert.deepEqual(entered, ['compare', 'filter']);
  });

test('phone.primary names an own panel, and the mark leads with it on a phone', () => {
  for (const w of WORKSPACE_REGISTRY.filter((x) => x.phone)) {
    const p = phonePrimaryOf(w.id);
    const tag = HTML.match(new RegExp(`<section\\b[^>]*data-osc-panel="${p}"[^>]*>`));
    assert.ok(tag && new RegExp(`data-osc-modes="[^"]*\\b${w.id}\\b`).test(tag[0]),
      `${w.id}: phone.primary ${p} is no panel of the workspace`);
  }
  const fake = (panel, modes) => {
    const set = new Set(['osc-panel']);
    return { dataset: { oscModes: modes, oscPanel: panel }, has: (c) => set.has(c),
      classList: { contains: (c) => set.has(c),
        toggle: (c, on) => { if (on) set.add(c); else set.delete(c); } } };
  };
  const env = fake('envelope', 'synthesis');
  const dual = fake('dual', 'synthesis');
  markWorkspacePanels([env, dual], 'synthesis', 'dual');
  assert.deepEqual([env, dual].map((p) => p.has('max-md:order-first')), [false, true]);
  markWorkspacePanels([env, dual], 'filter', 'dual');
  assert.deepEqual([env, dual].map((p) => p.has('max-md:order-first')), [false, false]);
});

test('every empty.when is a registered predicate, on a lane A page, with one block', () => {
  const empties = WORKSPACE_REGISTRY.filter((w) => w.empty);
  assert.ok(empties.length >= 1, 'Presets declares its empty state');
  for (const w of empties) {
    assert.ok(LANE_A_PAGES.includes(w.id) && !LANE_D.includes(w.id), `${w.id}: not lane A's`);
    assert.ok(emptyPredicateNames().includes(w.empty.when),
      `${w.id}: ${w.empty.when} is not registered (${emptyPredicateNames().join(', ')})`);
    assert.ok(w.empty.title && w.empty.body, `${w.id}: title and body`);
    assert.ok(IDS.includes(w.empty.action.to) && w.empty.action.label, `${w.id}: action`);
    const blocks = HTML.match(new RegExp(`<div data-osc="page\\.empty" data-workspace="${w.id}"`
      + '[^>]*>', 'g')) || [];
    assert.equal(blocks.length, 1, `${w.id}: one empty-state block`);
    assert.match(blocks[0], new RegExp(`:hidden="!emptyShown\\('${w.id}'\\)"`));
    assert.match(blocks[0], /\shidden\s/, 'hidden until the component decides');
  }
  for (const id of LANE_D) {
    const w = WORKSPACE_REGISTRY.find((x) => x.id === id);
    assert.deepEqual(Object.keys(w).filter((k) => ['enter', 'phone', 'empty'].includes(k)
      && !(id === 'compare' && k === 'enter')), [], `${id}: lane D fills the rest`);
  }
});

test('presets.noCustom holds only on the Custom tab with no saved preset', () => {
  assert.equal(emptyPredicateHolds('presets.noCustom',
    { presetTab: 'custom', customPresets: [] }), true);
  assert.equal(emptyPredicateHolds('presets.noCustom',
    { presetTab: 'custom', customPresets: [{ id: 'a' }] }), false);
  assert.equal(emptyPredicateHolds('presets.noCustom',
    { presetTab: 'reference', customPresets: [] }), false);
  assert.equal(emptyPredicateHolds('no.suchPredicate', {}), false);
  const ui = createOscillaUi({ storedAnalysisTab: null });
  Object.assign(ui, { workspace: 'presets', presetTab: 'custom', customPresets: [] });
  assert.equal(ui.emptyShown('presets'), true);
  ui.workspace = 'learn';
  assert.equal(ui.emptyShown('presets'), false, 'only on its page');
});

test('the page header renders the registry: summary, Related strip and menu, actions', () => {
  const header = HTML.slice(HTML.indexOf('<div data-osc="page.header"'),
    HTML.indexOf('<main'));
  assert.match(header, /data-osc="page\.summary" x-text="workspaceSummary\(\)"/);
  assert.match(header,
    /<nav data-osc="page\.related"[^>]*>[\s\S]*?<template x-for="r in workspaceRelated\(\)"/);
  assert.match(header, /data-osc="page\.relatedLink"[^>]*x-bind="relatedLink\(r\)"/);
  const menu = /<button\b[^>]*data-osc="page\.relatedMenu"[^>]*>/.exec(header);
  assert.ok(menu && /\bh-11\b/.test(menu[0]), 'the phone Related menu is a 44 px target');
  assert.match(header, new RegExp('role="menuitem"[^>]*data-osc="page\\.relatedItem"[^>]*'
    + 'x-bind="relatedLink\\(r\\)"[^>]*class="[^"]*\\bmin-h-11\\b'));
  assert.match(header, /data-osc="page\.actions"[\s\S]*id="osc-safety-reopen-phone"/);
  assert.equal((HTML.match(/<h1\b/g) || []).length, 1, 'the page keeps its one h1');
  const ui = createOscillaUi({ storedAnalysisTab: null });
  ui.workspace = 'filter';
  assert.equal(ui.workspaceSummary(), WORKSPACE_REGISTRY.find((w) => w.id === 'filter').summary);
  assert.deepEqual(ui.workspaceRelated().map((r) => r.href),
    ['#m=synth', '#m=studio&st=filter-automation', '#m=analyzer']);
  assert.deepEqual(ui.workspaceRelated().map((r) => r.text),
    ['Synth', 'Filter Automation in Studio', 'Analyzer']);
});

test('About\'s list and the shortcut dialog\'s names are the registry, not a copy', () => {
  const ui = createOscillaUi({ storedAnalysisTab: null });
  assert.equal(ui.aboutWorkspaces(), WORKSPACE_REGISTRY);
  assert.equal(SHORTCUT_LABELS, WORKSPACE_LABELS);
  const list = HTML.slice(HTML.indexOf('data-osc="about.workspaces"'));
  const ul = list.slice(0, list.indexOf('</ul>'));
  assert.match(ul, /<template x-for="w in aboutWorkspaces\(\)" :key="w\.id">/);
  assert.equal((ul.match(/<li\b/g) || []).length, 1, 'one templated entry, no static one');
  for (const w of WORKSPACE_REGISTRY) {
    assert.ok(!ul.includes(`>${w.label}<`), `About writes ${w.label} by hand`);
  }
});
