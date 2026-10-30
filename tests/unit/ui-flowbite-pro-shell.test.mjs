// Issue F002 (ADR 0061, rule project.ui-uses-flowbite-pro): the Flowbite Pro admin shell
// replaces the legacy header and its tab bar.
//   - the navigation is derived from ONE registry (src/js/ui/shell.js WORKSPACE_REGISTRY): the
//     workspace ids the router reads, the groups, the sidebar's entries, the shortcut dialog's
//     names, and an icon symbol per row in the sprite;
//   - the navbar (role="banner") and the sidebar (aria-label="Sidebar") carry the Pro class
//     sets of their kinds and no legacy class; the hooks the suites address are kept (header.*,
//     nav.<id>, nav-group.<group>, #osc-theme-toggle, #osc-help, #osc-overflow, #osc-export);
//   - the sidebar collapse, the hover expansion, the phone drawer and the theme button are
//     OSCILLA's own Alpine code: no flowbite data-* toggle drives them and no file of the Pro
//     dashboard's sidebar.js is referenced;
//   - the shell's state (sidebar collapsed to icons, groups) persists through injected storage
//     and reads a damaged value as the default; the search finds a workspace by name or by what
//     it does;
//   - the ratchet: shell:navbar and shell:sidebar are migrated, and the legacy header, tab bar
//     and their menus are gone from the record (no osc-header, osc-nav, osc-brand, osc-tabs--
//     underline), so the debt is lower than the record F002 started from.
//   node --test tests/unit/ui-flowbite-pro-shell.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  WORKSPACE_REGISTRY, GROUP_REGISTRY, WORKSPACE_IDS, NAV_GROUPS, NAV_TREE, WORKSPACE_LABELS,
  navTree, navGroupOf, navMatches, navSearch, resolveSidebar, resolveNavGroups, createShell,
  SIDEBAR_KEY, NAV_GROUPS_KEY,
} from '../../src/js/ui/shell.js';
import { WORKSPACES, createOscillaUi } from '../../src/js/ui/app.js';
import { SPACE_OWNER, WORKSPACE_LABELS as SHORTCUT_LABELS } from '../../src/js/ui/shortcuts.js';
import { PRO_STRUCTURE } from '../../scripts/ui-flowbite-pro-measure.mjs';

const html = readFileSync(new URL('../../src/index.html', import.meta.url), 'utf8');
const record = JSON.parse(readFileSync(new URL('./ui-flowbite-pro-baseline.json',
  import.meta.url), 'utf8'));
/** The debt of the record F002 started from (F001's base, measure 4). */
const DEBT_BEFORE_F002 = 3910;

/** The opening tag of the first element matching `re`. */
const tagOf = (re) => {
  const m = html.match(re);
  assert.ok(m, `found ${re}`);
  return m[0];
};
const classesOf = (tag) => new Set((tag.match(/\sclass="([^"]*)"/) || [, ''])[1].split(/\s+/)
  .filter(Boolean));
const navbarTag = tagOf(/<header\b[^>]*role="banner"[^>]*>/);
const sidebarTag = tagOf(/<aside\b[^>]*id="osc-sidebar"[^>]*>/);
const region = (tag, end) => html.slice(html.indexOf(tag), html.indexOf(end, html.indexOf(tag)));
const navbar = region(navbarTag, '</header>');
const sidebar = region(sidebarTag, '</aside>');

test('one registry: ids, order, groups, labels and the router all come from it', () => {
  assert.deepEqual(WORKSPACE_IDS, WORKSPACE_REGISTRY.map((w) => w.id));
  assert.deepEqual(WORKSPACES, WORKSPACE_IDS, 'app.js WORKSPACES is the registry');
  assert.equal(new Set(WORKSPACE_IDS).size, WORKSPACE_IDS.length, 'ids are unique');
  assert.deepEqual(Object.keys(SPACE_OWNER).sort(), [...WORKSPACE_IDS].sort());
  assert.equal(SHORTCUT_LABELS, WORKSPACE_LABELS, 'the shortcut dialog names are the registry');
  for (const w of WORKSPACE_REGISTRY) {
    assert.equal(WORKSPACE_LABELS[w.id], w.label);
    assert.equal(w.icon, `i-ws-${w.id}`);
    assert.equal(navGroupOf(w.id), w.group || null);
    if (w.group) assert.ok(GROUP_REGISTRY[w.group], `${w.id}: group ${w.group} is registered`);
  }
  assert.deepEqual(NAV_GROUPS, { analyze: ['analyzer', 'filter', 'compare'],
    synthesis: ['synthesis', 'sequencer', 'presets'] });
  // The tree: a group sits where its first workspace is, and holds its workspaces in order.
  assert.deepEqual(NAV_TREE.map((e) => e.id), ['playground', 'measure', 'experiments', 'analyze',
    'synthesis', 'learn', 'studio', 'about']);
  const flat = NAV_TREE.flatMap((e) => (e.kind === 'group' ? e.items : [e])).map((w) => w.id);
  assert.deepEqual(flat, WORKSPACE_IDS);
  // Hackable: one more row is one more entry, in its group, and nothing else changes.
  const more = navTree([...WORKSPACE_REGISTRY.slice(0, 5),
    { id: 'scope', label: 'Scope', group: 'analyze', icon: 'i-ws-scope' },
    ...WORKSPACE_REGISTRY.slice(5)]);
  assert.deepEqual(more.find((e) => e.id === 'analyze').items.map((w) => w.id),
    ['analyzer', 'filter', 'scope', 'compare']);
  assert.equal(more.length, NAV_TREE.length);
});

test('every registry row and group has its icon symbol in the sprite', () => {
  const icons = [...WORKSPACE_REGISTRY.map((w) => w.icon),
    ...Object.values(GROUP_REGISTRY).map((g) => g.icon), 'i-ws-collapse', 'i-ws-expand'];
  for (const id of icons) {
    assert.match(html, new RegExp(
      `<symbol id="${id}" viewBox="0 0 24 24"><!-- @icon:[a-z0-9-]+ --></symbol>`),
      `${id} is a lucide symbol`);
  }
});

test('the sidebar is rendered from the registry, with the hooks the suites address', () => {
  assert.match(sidebar,
    /<ul class="space-y-1" id="osc-nav">\s*<template x-for="entry in navTree" :key="entry\.id">/);
  assert.match(sidebar, /<template x-for="w in entry\.items" :key="w\.id">/);
  // No hand-written list: no static nav.<id> or nav-group.<id> hook anywhere in the page.
  assert.doesNotMatch(html, /\sdata-osc="nav(?:-group)?\.[a-z]+"/);
  assert.match(sidebar, /:data-osc="'nav\.' \+ entry\.id" x-bind="navItem\(entry\.id\)"/);
  assert.match(sidebar, /:data-osc="'nav\.' \+ w\.id" x-bind="navItem\(w\.id, true\)"/);
  assert.match(sidebar, /:data-osc="'nav-group\.' \+ entry\.id"/);
  assert.match(sidebar, /:data-osc-nav-group="entry\.kind === 'group' \? entry\.id : null"/);
  for (const hook of ['header.sidebar', 'header.menu', 'header.brand', 'header.search',
    'header.actions', 'header.theme', 'header.help', 'header.overflow', 'header.export']) {
    assert.match(navbar, new RegExp(`data-osc="${hook.replace('.', '\\.')}"`), hook);
  }
  for (const id of ['osc-theme-toggle', 'osc-help', 'osc-overflow', 'osc-export',
    'osc-overflow-menu', 'osc-export-menu']) {
    assert.match(navbar, new RegExp(`id="${id}"`), id);
  }
  assert.match(sidebar, /data-osc="sidebar\.search"/);
  assert.match(html,
    /data-osc="sidebar\.backdrop"[^>]*:class="\{ hidden: !drawerOpen \}"[^>]*@click="closeDrawer\(true\)"/);
  // The backdrop and the drawer appear in one frame: a class binding, never x-show (which
  // defers a show to a later task, so a first tap on the backdrop missed it).
  assert.doesNotMatch(html, /data-osc="sidebar\.backdrop"[^>]*x-show/);
  assert.match(html, /<h1 [^>]*data-osc="page\.title" x-text="workspaceLabel\(\)">/);
  assert.equal((html.match(/<h1\b/g) || []).length, 1, 'one H1: the page header names it');
});

test('the navbar and the sidebar carry the Pro class sets of their kinds, no legacy class', () => {
  const navClasses = classesOf(navbarTag);
  const sideClasses = classesOf(sidebarTag);
  assert.ok(PRO_STRUCTURE.navbar.some((set) => set.every((c) => navClasses.has(c))),
    `navbar: ${[...navClasses]}`);
  assert.ok(PRO_STRUCTURE.sidebar.some((set) => set.every((c) => sideClasses.has(c))),
    `sidebar: ${[...sideClasses]}`);
  for (const [name, part] of [['navbar', navbar], ['sidebar', sidebar]]) {
    const classes = [...part.matchAll(/\sclass="([^"]*)"/g)].flatMap((m) => m[1].split(/\s+/));
    // The logo keeps its own class (the domain mark, rule project.visual-identity-lock v2).
    assert.deepEqual(classes.filter((c) => /^osc-/.test(c) && c !== 'osc-logo'), [],
      `${name}: no legacy class`);
    assert.ok(!classes.includes('is-active'), `${name}: no legacy state class`);
  }
});

test('the sidebar, the drawer and the theme are OSCILLA\'s own Alpine code', () => {
  for (const part of [navbar, sidebar]) {
    assert.doesNotMatch(part,
      /data-(?:drawer|collapse|dropdown|tooltip|tabs)-(?:toggle|target|show|hide)/,
      'no flowbite data-* toggle: Alpine owns the state');
  }
  assert.match(sidebarTag, /x-bind="sidebar\(\)"/);
  assert.match(navbar, /@click="toggleSidebar\(\)"/);
  assert.match(navbar, /@click="toggleDrawer\(\)"/);
  assert.match(navbar, /@click="toggleTheme\(\)"/);
  const src = readFileSync(new URL('../../src/js/ui/shell.js', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /\bfrom\s+['"][^'"]*(?:sidebar|flowbite-admin)|require\([^)]*sidebar/,
    'the Pro dashboard\'s sidebar.js stays out');
});

test('the shell state persists through storage and reads a damaged value as the default', () => {
  assert.equal(resolveSidebar('icons'), 'icons');
  for (const v of [null, '', 'open', 'ICONS', '{}']) assert.equal(resolveSidebar(v), 'open');
  assert.deepEqual(resolveNavGroups(null), { analyze: true, synthesis: true });
  assert.deepEqual(resolveNavGroups('not json'), { analyze: true, synthesis: true });
  assert.deepEqual(resolveNavGroups('{"analyze":false}'), { analyze: false, synthesis: true });
  assert.deepEqual(resolveNavGroups('[false]'), { analyze: true, synthesis: true });

  const store = new Map([[SIDEBAR_KEY, 'icons']]);
  const shell = createShell({ get: (k) => store.get(k) ?? null, set: (k, v) => store.set(k, v) });
  Object.assign(shell, { emitted: [], emit(...a) { this.emitted.push(a); } });
  assert.equal(shell.sidebarCollapsed, true, 'the stored choice is read');
  assert.equal(shell.sidebarIcons, true);
  shell.sidebarPeekOn();
  assert.equal(shell.sidebarIcons, false, 'a peek shows the labels');
  shell.toggleSidebar();
  assert.equal(store.get(SIDEBAR_KEY), 'open');
  assert.deepEqual(shell.emitted, [['collapse', 'sidebar', false]]);
  shell.toggleSidebar();
  assert.equal(store.get(SIDEBAR_KEY), 'icons');
  shell.toggleNavGroup('analyze');
  assert.deepEqual(JSON.parse(store.get(NAV_GROUPS_KEY)), { analyze: false, synthesis: true });
  assert.equal(shell.navGroupShown('analyze'), false);
  shell.navQuery = 'filter';
  assert.equal(shell.navGroupShown('analyze'), true, 'a search shows a collapsed group');
  // Storage that throws (private mode) is a convenience lost, never an error.
  const broken = createShell({ get: () => null, set: () => { throw new Error('quota'); } });
  assert.equal(broken.sidebarCollapsed, false);
});

test('the workspace list is a navigation landmark and the open drawer holds the keyboard', () => {
  // The legacy tab bar was <nav aria-label="Workspace">; the Pro sidebar is an <aside>
  // (complementary), so the list inside it is the navigation landmark a screen reader jumps to.
  assert.match(sidebar, /<nav aria-label="Workspaces">\s*<ul class="space-y-1" id="osc-nav">/);
  assert.match(html, /id="osc-main-content"\s+data-osc="shell\.content" x-bind="shellContent\(\)"/);
  // While the phone drawer is open, the workspace column behind its backdrop is inert.
  const shell = createShell({ get: () => null, set: () => {} });
  const content = shell.shellContent();
  assert.equal(typeof content[':inert'], 'function', 'the workspace column binds inert');
  shell.drawerOpen = true;
  assert.equal(content[':inert'].call(shell), true);
  shell.drawerOpen = false;
  assert.equal(content[':inert'].call(shell), false);
});

test('the search finds a workspace by name, group or what it does', () => {
  assert.deepEqual(navSearch(''), WORKSPACE_IDS, 'an empty query shows everything');
  assert.deepEqual(navSearch('filt'), ['filter']);
  assert.deepEqual(navSearch('  FILTER lab '), ['filter']);
  assert.ok(navSearch('spectrum').includes('analyzer'));
  assert.deepEqual(navSearch('analyze'), NAV_GROUPS.analyze, 'a group name finds its workspaces');
  assert.ok(navSearch('graph').includes('studio'));
  assert.deepEqual(navSearch('zzzz'), []);
  assert.equal(navMatches('nope', 'x'), false, 'an unknown id matches nothing');
});

test('the ratchet: the navbar and the sidebar are migrated and the legacy header is gone', () => {
  assert.ok(record.surfaces.migrated.includes('shell:navbar'));
  assert.ok(record.surfaces.migrated.includes('shell:sidebar'));
  assert.ok(!record.surfaces.pending.includes('shell:navbar'));
  assert.ok(!record.surfaces.pending.includes('shell:sidebar'));
  for (const gone of ['osc-header', 'osc-header-actions', 'osc-header-export', 'osc-header-icon',
    'osc-header-theme', 'osc-nav', 'osc-nav-group', 'osc-nav-item', 'osc-nav-menu', 'osc-brand',
    'osc-brand-name', 'osc-tabs--underline']) {
    assert.equal(record.classes[gone], undefined, `${gone} has left the record`);
  }
  assert.ok(record.debt < DEBT_BEFORE_F002, `debt ${record.debt} < ${DEBT_BEFORE_F002}`);
});

// ---- review #330 (verdict bfbad77b): the findings F1-F4 and F6, each failing before its fix.

test('#330 F1: the fine-step row wraps rather than leaving the Source panel beside the sidebar',
  () => {
    const row = tagOf(
      /<div class="osc-fine\b[^"]*" role="group" aria-label="Fine frequency steps">/);
    const classes = classesOf(row);
    assert.ok(classes.has('flex-wrap'), 'the row wraps when its six buttons do not fit');
    // From lg up, beside the sidebar: one row while the row is at least 20rem wide, and three
    // buttons a row below that (the clamp switches the basis; flex-grow fills each row).
    const basis = [...classes].filter((c) => c.startsWith('lg:*:basis-'));
    assert.deepEqual(basis, ['lg:*:basis-[clamp(0px,calc((20rem-100%)*999),calc(33.333%-4px))]'],
      `the buttons' basis at lg: ${basis}`);
    const dist = readFileSync(new URL('../../dist/index.html', import.meta.url), 'utf8');
    const rule = new RegExp(String.raw`\.lg\\:\\\*\\:basis-\\\[clamp[^{]*\{`
      + String.raw`flex-basis:clamp\(0px,calc\(\(20rem - 100%\) ?\* ?999\),`
      + String.raw`calc\(33\.333% - 4px\)\)`);
    assert.match(dist, rule, 'the build compiles it');
  });

test('#330 F2: the brand gives way to the navbar controls and drops the wordmark below 375 px',
  () => {
    const brandTag = tagOf(/<a [^>]*data-osc="header\.brand"[^>]*>/);
    const brand = classesOf(brandTag);
    // Below lg the brand shrinks and cuts its own content rather than drawing over a control;
    // from lg up it keeps its size (the search field takes the room).
    for (const c of ['min-w-0', 'overflow-hidden', 'lg:flex-none']) {
      assert.ok(brand.has(c), `the brand link carries ${c}`);
    }
    assert.ok(!brand.has('flex-none'), 'the brand link may shrink below lg');
    const inner = region(brandTag, '</a>');
    assert.ok(classesOf(tagOf(/<svg class="osc-logo[^"]*"[^>]*>/)).has('flex-none'),
      'the mark never shrinks');
    const word = inner.match(/<span class="([^"]*)">\s*<span [^>]*>OSCILLA<\/span>/);
    assert.ok(word, 'the wordmark span');
    const wc = new Set(word[1].split(/\s+/));
    assert.ok(wc.has('max-[374.98px]:hidden'), `the wordmark hides below 375 px: ${word[1]}`);
    assert.deepEqual([...wc].filter((c) => /^max-\[/.test(c)), ['max-[374.98px]:hidden'],
      'one collision width');
  });

test('#330 F4: a drawer entry hands focus to the workspace heading within the press\'s task',
  async () => {
    // A minimal page: the About view, shown, labelled by its heading.
    const focused = [];
    const heading = { id: 'osc-about-title', attrs: {},
      hasAttribute(k) { return k in this.attrs; },
      setAttribute(k, v) { this.attrs[k] = v; },
      focus() { focused.push(this.id); active = this; } };
    let active = null;
    const view = { dataset: { oscModes: 'about' }, classList: { contains: (c) => c === 'osc-view' },
      getClientRects: () => [{}], getAttribute: (k) => (k === 'aria-labelledby'
        ? 'osc-about-title' : null), querySelector: () => null, matches: () => false };
    const root = { querySelectorAll: () => [view],
      querySelector: (s) => (s === '#osc-about-title' ? heading : null) };
    const saved = globalThis.document;
    globalThis.document = { querySelector: () => null, get activeElement() { return active; } };
    try {
      const ui = createOscillaUi({ storedAnalysisTab: null });
      const timers = [];
      Object.assign(ui, { $root: root, emit() {}, $nextTick: (fn) => { timers.push(fn); } });
      ui.setWorkspace('about', { focusHeading: true });
      for (let i = 0; i < 4; i += 1) await null; // the task's microtasks; no timer has run
      assert.deepEqual(focused, ['osc-about-title'],
        'focus is on the heading before any timer (Alpine\'s $nextTick) runs');
      assert.equal(heading.attrs.tabindex, '-1', 'focusable by script only');
      // A press on the desktop sidebar keeps focus on the entry: no heading focus at all.
      focused.length = 0;
      ui.setWorkspace('about');
      for (let i = 0; i < 4; i += 1) await null;
      for (const fn of timers.splice(0)) {
        try { fn(); } catch (e) { /* focusWorkspace needs a real page; not judged here */ }
      }
      assert.deepEqual(focused, [], 'no heading focus without focusHeading');
    } finally {
      globalThis.document = saved;
    }
  });

test('#330 F6: the sidebar and the workspace list are two distinct landmarks by name', () => {
  const aside = tagOf(/<aside\b[^>]*id="osc-sidebar"[^>]*>/);
  const asideName = aside.match(/aria-label="([^"]*)"/)[1];
  const navName = sidebar
    .match(/<nav aria-label="([^"]*)">\s*<ul class="space-y-1" id="osc-nav">/)[1];
  assert.equal(asideName, 'Sidebar');
  assert.equal(navName, 'Workspaces');
  const norm = (s) => s.toLowerCase().replace(/s$/, '');
  assert.notEqual(norm(asideName), norm(navName), 'not the same name but for a plural s');
});
