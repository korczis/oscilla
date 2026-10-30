#!/usr/bin/env node
// The Flowbite Pro shell (issue F002, ADR 0061) on the built dist/index.html in chromium,
// firefox and webkit, from file:// and from a GitHub-Pages-like sub-path
// (http://127.0.0.1:<port>/oscilla/), every check on both.
//
//   node tests/browser/ui-flowbite-pro.cjs [--browsers chromium,firefox,webkit]
//        [--origins file,http] [--only name1,name2] [--json out.json]   (or OSC_BROWSERS=...)
//
// Checks (asserted):
//   deep-links    the deep-link inventory (ROUTES, one row per address OSCILLA has published):
//                 a fresh page opened at each address lands on the workspace and the V1 mode
//                 that ui/navigation.js routeOfHash names (ADR 0045), marks that workspace's
//                 nav item aria-current="page", and keeps what the row names (?mock=1, the
//                 Studio template and view, the recipe, the instrument's own keys, a key no
//                 codec owns). The inventory landed passing on the interface before the shell
//                 changed (F002's first commit) and must pass unchanged after it.
//   default       an address naming nothing opens the Playground
//   shell-desktop at 1536x1024 the Pro navbar and the sidebar column: every workspace is one
//                 press on its own entry (aria-current="page" and bg-gray-100/dark:bg-gray-700
//                 on it), every navbar control is at least 44 x 44 px, nothing scrolls sideways;
//                 the sidebar collapses to icons (64 px, the labels kept as accessible names),
//                 the choice survives a reload, the collapsed sidebar expands over the workspace
//                 under the pointer without moving it, and expands again on its button
//   shell-phone   at 390x844 with touch: the sidebar is a drawer behind the menu button, over
//                 a backdrop; every control of the navbar and the open drawer is at least 44 x
//                 44 px; every workspace is one tap in the open drawer, which closes over it
//                 with focus kept off <body>; Escape and the backdrop close it, focus back on
//                 the menu button; nothing scrolls sideways; the workspace deep links open at
//                 390 px with the drawer closed
//   shell-search  Find a workspace (navbar, and the drawer's on a phone) filters the sidebar
//                 by name or by what a workspace does, says when nothing matches, and Enter
//                 opens the first match
//   shell-a11y    in both themes at 1536 and 390 px: text of the navbar, the sidebar entries
//                 (the active one too), the page header and the search field has a contrast of
//                 at least 4.5:1 against what it sits on; a sidebar entry reached by keyboard
//                 shows a visible focus ring; the theme button switches the two-state theme
//                 (oscilla.v2.theme) and its icon
//   no-console-errors
'use strict';
const { serveDist } = require('./lib/serve.cjs');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const suite = require('./lib/suite.cjs');
const { until, bounded } = require('./lib/wait.cjs');

const argv = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};
const ROOT = path.resolve(__dirname, '..', '..');
const DIST = path.resolve(arg('dist', path.join(ROOT, 'dist', 'index.html')));
const RUN = suite.open({ name: 'ui-flowbite-pro', browsers: arg('browsers'),
  origins: arg('origins'), defaultOrigins: ['file', 'http'] });
const playwright = RUN.playwright;
const BROWSERS = RUN.browsers;
const ORIGINS = RUN.origins;
const ONLY = arg('only', '') ? new Set(arg('only', '').split(',')) : null;
const JSON_OUT = arg('json', '');
const LAUNCH = {
  chromium: { args: ['--autoplay-policy=no-user-gesture-required'] },
  firefox: { firefoxUserPrefs: { 'media.autoplay.default': 0, 'media.autoplay.blocking_policy': 0,
    'media.autoplay.block-webaudio': false } },
  webkit: {},
};
// A check's wall-clock budget; the inventory gets one per row (Firefox loads a page in ~7 s on
// a loaded machine).
const CHECK_MS = 180000;
const ROW_MS = 30000;
const READY_MS = 20000;

// The twelve workspaces, in the navigation's order (src/js/ui/app.js).
const WORKSPACES = ['playground', 'measure', 'experiments', 'analyzer', 'filter', 'compare',
  'synthesis', 'sequencer', 'presets', 'learn', 'studio', 'about'];
// A valid recipe link (url-state-measure.js wire keys): 50 Hz-12 kHz.
const RECIPE = Buffer.from(JSON.stringify({ v: 1, f1: 50, f2: 12000 })).toString('base64url');

/**
 * The deep-link inventory. search: the query (before the hash); hash: the fragment. workspace
 * and mode: where the address lands. The other fields name what the address must keep.
 */
const ROUTES = [
  { name: 'empty', hash: '', workspace: 'playground', mode: 'playground' },
  ...WORKSPACES.map((ws) => ({ name: `m=${ws}`, hash: `#m=${ws}`, workspace: ws })),
  // The V1 mode ids in `m` (core/constants.js APP_MODES), as V1 links wrote them.
  { name: 'v1 playground', hash: '#v=1&m=playground&f=440', workspace: 'playground',
    mode: 'playground' },
  { name: 'v1 sweep', hash: '#v=1&m=sweep&s=sweep&f=440', workspace: 'playground',
    mode: 'sweep' },
  { name: 'v1 dual', hash: '#v=1&m=dual&s=dual&f=440', workspace: 'synthesis', mode: 'dual' },
  { name: 'v1 presets', hash: '#v=1&m=presets', workspace: 'presets', mode: 'presets' },
  { name: 'v1 learn', hash: '#v=1&m=learn&f=440', workspace: 'learn', mode: 'learn' },
  // ?mock=1 paints the renderer outlines (layout comparison only).
  { name: 'mock', search: '?mock=1', hash: '', workspace: 'playground', mock: true },
  // The Studio links of tests/browser/v31-studio-links.cjs.
  { name: 'studio template and view', hash: '#m=studio&st=filter-automation&sv=timeline',
    workspace: 'studio', template: 'filter-automation', subview: 'timeline' },
  { name: 'studio alone', hash: '#m=studio', workspace: 'studio' },
  // A Studio key without m=studio, and an unknown template, are refused whole: the address
  // drops the Studio keys and names the workspace the user stays in.
  { name: 'studio template without m', hash: '#st=basic-tone', workspace: 'playground',
    keeps: { m: 'playground' }, drops: ['st'] },
  { name: 'studio invalid template', hash: '#m=studio&st=no-such-template',
    workspace: 'playground', keeps: { m: 'playground' }, drops: ['st'] },
  // The MEASURE recipe (mr) and the route precedence of ADR 0045.
  { name: 'recipe', hash: `#mr=${RECIPE}`, workspace: 'measure', keeps: { mr: RECIPE } },
  { name: 'recipe with m', hash: `#m=learn&mr=${RECIPE}`, workspace: 'learn',
    keeps: { mr: RECIPE } },
  { name: 'precedence', hash: `#m=studio&st=basic-tone&sv=timeline&mr=${RECIPE}`,
    workspace: 'studio', template: 'basic-tone', subview: 'timeline', keeps: { mr: RECIPE } },
  // The instrument's direct path: its own keys, no `m`.
  { name: 'instrument direct', hash: '#v=1&f=1234', workspace: 'playground',
    mode: 'playground', frequency: 1234 },
  // A key no codec owns (a later one, such as a keyboard layout) rides along unharmed.
  { name: 'foreign key', hash: '#m=sequencer&kbd=1', workspace: 'sequencer',
    keeps: { kbd: '1' } },
];

function navigationState() {
  const a = window.OSCILLA.app;
  const s = window.OSCILLA.studio;
  const q = new URLSearchParams(window.location.hash.replace(/^#/, ''));
  const current = [...document.querySelectorAll('[data-osc^="nav."][aria-current="page"]')]
    .map((el) => el.dataset.osc);
  return { workspace: a.workspace, mode: a.mode,
    dataMode: document.querySelector('#osc-app').dataset.mode,
    current, mock: document.documentElement.classList.contains('osc-mock'),
    template: s.templateId, subview: a.studio.subview, frequency: a.frequency,
    params: Object.fromEntries(q) };
}

/** In-page: the shell's geometry and state (sizes in CSS px). */
function shellGeometry() {
  const q = (sel) => document.querySelector(sel);
  const shown = (el) => !!el && el.getClientRects().length > 0
    && getComputedStyle(el).visibility !== 'hidden';
  const sidebar = q('#osc-sidebar');
  const sb = sidebar.getBoundingClientRect();
  const content = q('#osc-main-content').getBoundingClientRect();
  // Every visible control of the navbar, and of the sidebar when it is shown.
  const scope = [q('[role="banner"]'), ...(shown(sidebar) ? [sidebar] : [])];
  const small = [];
  for (const root of scope) {
    for (const el of root.querySelectorAll('a[href], button, input:not([type=hidden])')) {
      if (!shown(el)) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 44 - 0.5 || r.height < 44 - 0.5) {
        const name = el.dataset.osc || el.id || el.tagName;
        small.push(`${name} ${Math.round(r.width)}x${Math.round(r.height)}`);
      }
    }
  }
  const navShown = [...document.querySelectorAll('[data-osc^="nav."]')].filter(shown)
    .map((el) => el.dataset.osc);
  const names = [...document.querySelectorAll('[data-osc^="nav."]')]
    .map((el) => el.textContent.trim());
  let stored = null;
  try { stored = localStorage.getItem('oscilla.v2.sidebar'); } catch (e) { stored = null; }
  const a = document.activeElement;
  return { sidebar: shown(sidebar), drawer: shown(sidebar)
    && getComputedStyle(sidebar).position === 'fixed', sidebarWidth: Math.round(sb.width),
  contentLeft: content.left, backdrop: shown(q('[data-osc="sidebar.backdrop"]')),
  menuButton: shown(q('[data-osc="header.menu"]')), small, navShown, names, stored,
  overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
  workspace: window.OSCILLA.app.workspace,
  focus: a && a !== document.body ? a.dataset.osc || a.id || a.tagName : 'body',
  focusIn: !a || a === document.body ? 'body' : sidebar.contains(a) ? 'sidebar' : 'page' };
}

/** In-page: workspace `ws` is the one marked current, with the Pro active colour. */
function activeEntry(ws) {
  const el = document.querySelector(`[data-osc="nav.${ws}"]`);
  const current = [...document.querySelectorAll('[data-osc^="nav."][aria-current="page"]')]
    .map((x) => x.dataset.osc);
  const active = el.classList.contains('bg-gray-100') && el.classList.contains('dark:bg-gray-700');
  return { ok: window.OSCILLA.app.workspace === ws && current.length === 1
    && current[0] === `nav.${ws}` && active, workspace: window.OSCILLA.app.workspace, current,
  active };
}

/**
 * In-page: the contrast of the shell's text against what it sits on (WCAG 2 relative
 * luminance), for every visible text of the navbar, the sidebar and the page header.
 */
function shellContrast() {
  const rgb = (c) => {
    const m = c.match(/rgba?\(([^)]+)\)/);
    if (!m) return null;
    const p = m[1].split(/[ ,/]+/).filter(Boolean).map(Number);
    return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
  };
  const lum = ({ r, g, b }) => {
    const f = (v) => {
      const s = v / 255;
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  const over = (top, bottom) => ({ r: top.r * top.a + bottom.r * (1 - top.a),
    g: top.g * top.a + bottom.g * (1 - top.a), b: top.b * top.a + bottom.b * (1 - top.a), a: 1 });
  const background = (el) => {
    const layers = [];
    for (let p = el; p; p = p.parentElement) {
      const c = rgb(getComputedStyle(p).backgroundColor);
      if (c && c.a > 0) layers.push(c);
      if (c && c.a >= 1) break;
    }
    let base = { r: 255, g: 255, b: 255, a: 1 };
    for (const c of layers.reverse()) base = over(c, base);
    return base;
  };
  const roots = ['[role="banner"]', '#osc-sidebar', '[data-osc="page.header"]']
    .map((s) => document.querySelector(s)).filter((r) => r && r.getClientRects().length);
  const low = [];
  let min = 21;
  for (const root of roots) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (!n.textContent.trim()) continue;
      const el = n.parentElement;
      if (!el.getClientRects().length || el.closest('.sr-only, [aria-hidden="true"]')) continue;
      const cs = getComputedStyle(el);
      if (cs.visibility === 'hidden' || parseFloat(cs.opacity) === 0) continue;
      const fg = rgb(cs.color);
      const bg = background(el);
      const L1 = lum(over(fg, bg));
      const L2 = lum(bg);
      const ratio = (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
      min = Math.min(min, ratio);
      const text = n.textContent.trim().slice(0, 20);
      if (ratio < 4.5) low.push(`${el.dataset.osc || el.tagName}:"${text}" ${ratio.toFixed(2)}`);
    }
    // The search field's placeholder is text too.
    for (const input of root.querySelectorAll('input[placeholder]')) {
      if (!input.getClientRects().length) continue;
      const fg = rgb(getComputedStyle(input, '::placeholder').color);
      const bg = background(input);
      if (!fg) continue;
      const L1 = lum(over(fg, bg));
      const L2 = lum(bg);
      const ratio = (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
      min = Math.min(min, ratio);
      if (ratio < 4.5) low.push(`${input.dataset.osc} placeholder ${ratio.toFixed(2)}`);
    }
  }
  return { min: Number(min.toFixed(2)), low: low.slice(0, 8) };
}

// ------------------------------------------------------------------------------ page helpers
const H = {
  verdict: (conds) => {
    const failed = Object.keys(conds).filter((k) => !conds[k]);
    return { ok: failed.length === 0, failed };
  },
  ready: async (page) => {
    await page.waitForSelector('html[data-ready="true"]', { timeout: READY_MS });
    await until(() => page.evaluate(() => !!(window.OSCILLA.app
      && window.OSCILLA.app.studio.ready)), { ms: READY_MS, what: 'the Studio is ready' });
  },
  open: async (ctx, url, context = ctx.context) => {
    const page = await context.newPage();
    page.setDefaultTimeout(15000);
    page.on('console', (m) => { if (m.type() === 'error') ctx.errors.push(m.text()); });
    page.on('pageerror', (e) => ctx.errors.push(`pageerror: ${e.message}`));
    await page.goto(url, { waitUntil: 'load' });
    await H.ready(page);
    return page;
  },
  state: (page) => page.evaluate(navigationState),
};

/** What `row` expects of state `st`: the names of the expectations it misses. */
function missed(row, st) {
  const bad = [];
  if (st.workspace !== row.workspace || st.dataMode !== row.workspace) bad.push('workspace');
  if (row.mode && st.mode !== row.mode) bad.push('mode');
  if (JSON.stringify(st.current) !== JSON.stringify([`nav.${row.workspace}`])) bad.push('current');
  if (!!row.mock !== st.mock) bad.push('mock');
  if (row.template && st.template !== row.template) bad.push('template');
  if (row.subview && st.subview !== row.subview) bad.push('subview');
  if (row.frequency && st.frequency !== row.frequency) bad.push('frequency');
  for (const [k, v] of Object.entries(row.keeps || {})) {
    if (st.params[k] !== v) bad.push(`keeps ${k}`);
  }
  for (const k of row.drops || []) if (k in st.params) bad.push(`drops ${k}`);
  return bad;
}

// ------------------------------------------------------------------------------ checks
function defineChecks() {
  const checks = [];
  const def = (name, fn, ms = CHECK_MS) => checks.push({ name, fn, ms });

  def('deep-links', async (ctx) => {
    const rows = [];
    for (const row of ROUTES) {
      const url = `${ctx.baseUrl}${row.search || ''}${row.hash}`;
      const page = await H.open(ctx, url);
      // The route is applied at load, before data-ready; a refused link has replaced its entry.
      const st = await until(async () => {
        const s = await H.state(page);
        return missed(row, s).length === 0 ? s : null;
      }, { ms: 5000, what: `deep link ${row.name}` }).catch(() => H.state(page));
      rows.push({ name: row.name, bad: missed(row, st), st });
      await page.close();
    }
    const bad = rows.filter((r) => r.bad.length)
      .map((r) => ({ name: r.name, bad: r.bad, workspace: r.st.workspace, mode: r.st.mode,
        current: r.st.current, params: r.st.params }));
    return { ok: bad.length === 0, routes: rows.length, bad: bad.slice(0, 8) };
  }, ROW_MS * ROUTES.length);

  def('default', async (ctx) => {
    const page = await H.open(ctx, ctx.baseUrl);
    const st = await H.state(page);
    await page.close();
    return { ...H.verdict({ playground: st.workspace === 'playground',
      mode: st.mode === 'playground' }), workspace: st.workspace };
  });

  // ---------------------------------------------------------------- the Pro shell (F002)
  def('shell-desktop', async (ctx) => {
    const page = await H.open(ctx, ctx.baseUrl);
    const res = { bad: [] };
    const want = (cond, msg) => { if (!cond) res.bad.push(msg); };
    res.start = await page.evaluate(shellGeometry);
    want(res.start.sidebar && res.start.sidebarWidth === 256 && !res.start.drawer,
      `the sidebar is an open column ${JSON.stringify(res.start)}`);
    want(Math.round(res.start.contentLeft) === 256, `the workspace column starts at 256 px`);
    want(res.start.overflow <= 0, `no sideways scroll (${res.start.overflow} px)`);
    want(res.start.small.length === 0, `navbar targets under 44 px: ${res.start.small}`);
    want(res.start.navShown.length === WORKSPACES.length,
      `every workspace has a visible entry: ${res.start.navShown}`);
    for (const ws of WORKSPACES) {
      await page.click(`[data-osc="nav.${ws}"]`);
      const v = await until(() => page.evaluate(activeEntry, ws).then((x) => (x.ok ? x : null)),
        { ms: 5000, what: `one press opens ${ws}` }).catch(() => page.evaluate(activeEntry, ws));
      want(v.ok, `one press on nav.${ws}: ${JSON.stringify(v)}`);
    }
    await page.click('[data-osc="nav.playground"]');
    // Collapse to icons: 64 px, the workspace column follows, the labels stay accessible names.
    await page.click('[data-osc="header.sidebar"]');
    const icons = await until(() => page.evaluate(shellGeometry)
      .then((g) => (g.sidebarWidth === 64 ? g : null)), { ms: 3000, what: 'collapse to icons' })
      .catch(() => page.evaluate(shellGeometry));
    want(icons.sidebarWidth === 64 && Math.round(icons.contentLeft) === 64,
      `collapsed to icons ${JSON.stringify(icons)}`);
    want(icons.names.length === WORKSPACES.length && icons.names.every(Boolean),
      `entries keep their names: ${icons.names}`);
    want(icons.stored === 'icons', `the choice is stored (${icons.stored})`);
    // Hover: the sidebar expands over the workspace, which does not move.
    await page.mouse.move(30, 400);
    const peek = await until(() => page.evaluate(shellGeometry)
      .then((g) => (g.sidebarWidth === 256 ? g : null)), { ms: 3000, what: 'hover expands' })
      .catch(() => page.evaluate(shellGeometry));
    want(peek.sidebarWidth === 256 && Math.round(peek.contentLeft) === 64,
      `hover expands over the workspace ${JSON.stringify(peek)}`);
    await page.mouse.move(900, 500);
    const back = await until(() => page.evaluate(shellGeometry)
      .then((g) => (g.sidebarWidth === 64 ? g : null)), { ms: 3000, what: 'leave collapses' })
      .catch(() => page.evaluate(shellGeometry));
    want(back.sidebarWidth === 64, `leaving collapses it again (${back.sidebarWidth})`);
    // The choice survives a reload.
    await page.reload({ waitUntil: 'load' });
    await H.ready(page);
    const reloaded = await until(() => page.evaluate(shellGeometry)
      .then((g) => (g.sidebarWidth === 64 ? g : null)), { ms: 5000, what: 'reload keeps icons' })
      .catch(() => page.evaluate(shellGeometry));
    want(reloaded.sidebarWidth === 64, `the reload keeps it collapsed (${reloaded.sidebarWidth})`);
    await page.click('[data-osc="header.sidebar"]');
    const open = await until(() => page.evaluate(shellGeometry)
      .then((g) => (g.sidebarWidth === 256 && g.stored === 'open' ? g : null)),
    { ms: 3000, what: 'expand again' }).catch(() => page.evaluate(shellGeometry));
    want(open.sidebarWidth === 256 && Math.round(open.contentLeft) === 256
      && open.stored === 'open',
      `expanded again ${JSON.stringify(open)}`);
    await page.close();
    return { ok: !res.bad.length, bad: res.bad.slice(0, 8) };
  });

  def('shell-phone', async (ctx) => {
    const phone = await ctx.browser.newContext({ viewport: { width: 390, height: 844 },
      hasTouch: true, reducedMotion: 'reduce' });
    const res = { bad: [] };
    const want = (cond, msg) => { if (!cond) res.bad.push(msg); };
    try {
      const page = await H.open(ctx, ctx.baseUrl, phone);
      const start = await page.evaluate(shellGeometry);
      want(!start.sidebar && start.menuButton,
        `a drawer behind the menu button ${JSON.stringify(start)}`);
      want(start.overflow <= 0, `no sideways scroll (${start.overflow} px)`);
      want(start.small.length === 0, `navbar targets under 44 px: ${start.small}`);
      const openDrawer = async (what) => {
        await page.tap('[data-osc="header.menu"]');
        // Focus moves into the drawer once Alpine has rendered it (its next tick).
        return until(() => page.evaluate(shellGeometry)
          .then((g) => (g.drawer && g.focusIn === 'sidebar' ? g : null)),
        { ms: 5000, what }).catch(() => page.evaluate(shellGeometry));
      };
      const opened = await openDrawer('the drawer opens');
      want(opened.drawer && opened.backdrop,
        `the drawer over a backdrop ${JSON.stringify(opened)}`);
      want(opened.small.length === 0, `drawer targets under 44 px: ${opened.small}`);
      want(opened.navShown.length === WORKSPACES.length, `every workspace in the drawer`);
      want(opened.overflow <= 0, `no sideways scroll with the drawer (${opened.overflow} px)`);
      want(opened.focusIn === 'sidebar', `focus moves into the drawer (${opened.focusIn})`);
      // The drawer holds the keyboard: the workspace column behind the backdrop is inert, so
      // Tab never reaches a control the backdrop covers (WCAG 2.4.11), and a screen reader
      // does not read it.
      const behind = [];
      for (let i = 0; i < WORKSPACES.length + 6; i += 1) {
        await page.keyboard.press('Tab');
        const at = await page.evaluate(() => {
          const a = document.activeElement;
          return a && document.getElementById('osc-main-content').contains(a)
            ? a.dataset.osc || a.id || a.tagName : null;
        });
        if (at) behind.push(at);
      }
      const inert = await page.evaluate(() => document.getElementById('osc-main-content').inert);
      want(inert && !behind.length,
        `the drawer holds the keyboard: inert ${inert}, reached behind it ${behind.slice(0, 4)}`);
      for (const ws of WORKSPACES) {
        const g = await page.evaluate(shellGeometry);
        if (!g.drawer) await openDrawer(`the drawer opens for ${ws}`);
        await page.tap(`[data-osc="nav.${ws}"]`);
        const v = await until(() => page.evaluate(shellGeometry).then((x) => (
          x.workspace === ws && !x.sidebar ? x : null)), { ms: 5000, what: `one tap opens ${ws}` })
          .catch(() => page.evaluate(shellGeometry));
        want(v.workspace === ws && !v.sidebar && v.focusIn !== 'body',
          `one tap on nav.${ws}: ${JSON.stringify({ ws: v.workspace, sidebar: v.sidebar,
            focus: v.focusIn })}`);
      }
      await openDrawer('the drawer opens for Escape');
      await page.keyboard.press('Escape');
      const closedBy = (what) => until(() => page.evaluate(shellGeometry)
        .then((g) => (!g.sidebar ? g : null)), { ms: 3000, what })
        .catch(() => page.evaluate(shellGeometry));
      const esc = await closedBy('Escape closes the drawer');
      want(!esc.sidebar && esc.focus === 'header.menu', `Escape ${JSON.stringify(esc)}`);
      const live = await page.evaluate(() => !document.getElementById('osc-main-content').inert);
      want(live, 'the workspace column is live again once the drawer closes');
      await openDrawer('the drawer opens for the backdrop');
      await page.tap('[data-osc="sidebar.backdrop"]', { position: { x: 370, y: 700 } });
      const out = await closedBy('the backdrop closes the drawer');
      want(!out.sidebar && out.focus === 'header.menu', `backdrop ${JSON.stringify(out)}`);
      await page.close();
      // The deep links at 390 px: the workspace, the drawer closed, nothing sideways.
      for (const row of ROUTES.filter((r) => /^m=|^studio template and view$/.test(r.name))) {
        const p = await H.open(ctx, `${ctx.baseUrl}${row.search || ''}${row.hash}`, phone);
        const st = await until(async () => {
          const x = await H.state(p);
          return missed(row, x).length === 0 ? x : null;
        }, { ms: 5000, what: `390 deep link ${row.name}` }).catch(() => H.state(p));
        const g = await p.evaluate(shellGeometry);
        const m = missed(row, st);
        want(!m.length && !g.sidebar && g.overflow <= 0,
          `390 ${row.name}: ${JSON.stringify({ missed: m, sidebar: g.sidebar,
            overflow: g.overflow })}`);
        await p.close();
      }
    } finally {
      await bounded(phone.close(), { ms: 10000, what: 'closing the phone context' })
        .catch(() => {});
    }
    return { ok: !res.bad.length, bad: res.bad.slice(0, 8) };
  }, ROW_MS * 20);

  def('shell-search', async (ctx) => {
    const res = { bad: [] };
    const want = (cond, msg) => { if (!cond) res.bad.push(msg); };
    const page = await H.open(ctx, ctx.baseUrl);
    const shown = () => page.evaluate(() => [...document.querySelectorAll('[data-osc^="nav."]')]
      .filter((el) => el.getClientRects().length).map((el) => el.dataset.osc));
    await page.fill('[data-osc="header.search"]', 'filt');
    const one = await until(() => shown().then((v) => (v.length === 1 ? v : null)),
      { ms: 3000, what: 'the search filters' }).catch(() => shown());
    want(JSON.stringify(one) === '["nav.filter"]', `"filt" finds Filter Lab: ${one}`);
    await page.fill('[data-osc="header.search"]', 'spectrum');
    const spec = await until(() => shown().then((v) => (v.includes('nav.analyzer') ? v : null)),
      { ms: 3000, what: 'the search reads what a workspace does' }).catch(() => shown());
    want(spec.includes('nav.analyzer'), `"spectrum" finds the Analyzer: ${spec}`);
    await page.fill('[data-osc="header.search"]', 'zzzz');
    const none = await until(() => page.evaluate(() => document
      .querySelector('[data-osc="sidebar.noMatch"]').getClientRects().length > 0),
    { ms: 3000, what: 'no match is said' }).catch(() => false);
    want(none, 'a query that finds nothing says so');
    await page.fill('[data-osc="header.search"]', 'seq');
    await page.press('[data-osc="header.search"]', 'Enter');
    const went = await until(() => H.state(page)
      .then((x) => (x.workspace === 'sequencer' ? x : null)),
      { ms: 5000, what: 'Enter opens the first match' }).catch(() => H.state(page));
    want(went.workspace === 'sequencer', `Enter opens the Sequencer (${went.workspace})`);
    // x-show shows an entry again in a later task, so the whole list is a condition to await.
    const cleared = await until(() => shown()
      .then((v) => (v.length === WORKSPACES.length ? v : null)),
    { ms: 3000, what: 'the list is whole again' }).catch(() => shown());
    want(cleared.length === WORKSPACES.length, `the list is whole again: ${cleared.length}`);
    await page.close();
    // The drawer's own field on a phone.
    const phone = await ctx.browser.newContext({ viewport: { width: 390, height: 844 },
      hasTouch: true, reducedMotion: 'reduce' });
    try {
      const p = await H.open(ctx, ctx.baseUrl, phone);
      await p.tap('[data-osc="header.menu"]');
      await p.waitForSelector('[data-osc="sidebar.search"]', { state: 'visible', timeout: 5000 });
      await p.fill('[data-osc="sidebar.search"]', 'graph');
      await p.press('[data-osc="sidebar.search"]', 'Enter');
      const st = await until(() => H.state(p).then((x) => (x.workspace === 'studio' ? x : null)),
        { ms: 5000, what: 'the drawer search opens Studio' }).catch(() => H.state(p));
      const g = await p.evaluate(shellGeometry);
      want(st.workspace === 'studio' && !g.sidebar,
        `"graph" opens Studio, drawer closed: ${st.workspace} ${g.sidebar}`);
    } finally {
      await bounded(phone.close(), { ms: 10000, what: 'closing the phone context' })
        .catch(() => {});
    }
    return { ok: !res.bad.length, bad: res.bad.slice(0, 8) };
  });

  def('shell-a11y', async (ctx) => {
    const res = { bad: [], min: {} };
    const want = (cond, msg) => { if (!cond) res.bad.push(msg); };
    for (const [w, h] of [[1536, 1024], [390, 844]]) {
      const context = await ctx.browser.newContext({ viewport: { width: w, height: h },
        hasTouch: w < 500, reducedMotion: 'reduce' });
      try {
        const page = await H.open(ctx, ctx.baseUrl, context);
        for (const theme of ['dark', 'light']) {
          const now = await page.evaluate(() => document.documentElement.dataset.theme);
          if (now !== theme) {
            await page.click('[data-osc="header.theme"]');
            const t = await until(() => page.evaluate(() => ({
              theme: document.documentElement.dataset.theme,
              stored: localStorage.getItem('oscilla.v2.theme'),
              icon: [...document.querySelectorAll('[data-osc="header.theme"] svg')]
                .filter((s) => s.getClientRects().length).map((s) => s.querySelector('use')
                  .getAttribute('href')) })).then((x) => (x.theme === theme ? x : null)),
            { ms: 3000, what: `the theme button switches to ${theme}` }).catch(() => null);
            want(t && t.stored === theme && t.icon.length === 1
              && t.icon[0] === (theme === 'dark' ? '#i-sun' : '#i-moon'),
            `${w} theme ${theme}: ${JSON.stringify(t)}`);
          }
          if (w < 500) {
            await page.tap('[data-osc="header.menu"]');
            await until(() => page.evaluate(shellGeometry).then((g) => g.drawer),
              { ms: 5000, what: 'the drawer opens' }).catch(() => {});
          }
          // The theme's colours settle within the deadline (a transition may still run).
          const c = await until(() => page.evaluate(shellContrast)
            .then((x) => (x.low.length === 0 ? x : null)),
          { ms: 3000, what: `${w} ${theme} contrast` }).catch(() => page.evaluate(shellContrast));
          res.min[`${w}/${theme}`] = c.min;
          want(c.low.length === 0, `${w} ${theme} contrast under 4.5: ${JSON.stringify(c.low)}`);
          // Keyboard focus is visible on a sidebar entry.
          await page.focus('[data-osc="nav.playground"]');
          await page.keyboard.press('ArrowDown');
          const ring = await page.evaluate(() => {
            const el = document.activeElement;
            const cs = getComputedStyle(el);
            return { osc: el.dataset.osc, ring: (cs.outlineStyle !== 'none'
              && parseFloat(cs.outlineWidth) >= 1) || /\d+px/.test(cs.boxShadow) };
          });
          want(ring.osc === 'nav.measure' && ring.ring,
            `${w} ${theme} focus ring ${JSON.stringify(ring)}`);
          if (w < 500) {
            await page.keyboard.press('Escape');
            await until(() => page.evaluate(shellGeometry).then((g) => !g.sidebar),
              { ms: 3000, what: 'the drawer closes' }).catch(() => {});
          }
        }
        await page.close();
      } finally {
        await bounded(context.close(), { ms: 10000, what: 'closing a context' }).catch(() => {});
      }
    }
    return { ok: !res.bad.length, min: res.min, bad: res.bad.slice(0, 8) };
  });

  def('no-console-errors', async (ctx) => ({ ok: ctx.errors.length === 0,
    errors: ctx.errors.slice(0, 8) }));

  return checks;
}

async function runOne(browserName, origin, baseUrl) {
  const browser = await playwright[browserName].launch(LAUNCH[browserName]);
  const context = await browser.newContext({ viewport: { width: 1536, height: 1024 },
    reducedMotion: 'reduce' });
  const ctx = { browser, browserName, origin, baseUrl, context, errors: [] };
  const results = {};
  for (const { name, fn, ms } of defineChecks()) {
    if (ONLY && !ONLY.has(name) && name !== 'no-console-errors') continue;
    const t0 = Date.now();
    try {
      const v = await bounded(fn(ctx), { ms, what: `${browserName}/${origin} ${name}` });
      results[name] = { ...v, ms: Date.now() - t0 };
    } catch (e) {
      results[name] = { ok: false, detail: String(e.message || e).split('\n')[0],
        ms: Date.now() - t0 };
    }
    for (const p of context.pages()) {
      await bounded(p.close(), { ms: 3000, what: 'closing a page' }).catch(() => {});
    }
  }
  await bounded(browser.close(), { ms: 10000, what: `closing ${browserName}` }).catch(() => {});
  return results;
}

(async () => {
  await RUN.ready();
  if (!fs.existsSync(DIST)) {
    console.error(`missing ${DIST}: run npm run build`);
    process.exit(2);
  }
  const server = ORIGINS.includes('http')
    ? await serveDist(DIST, { prefix: 'oscilla-ui-flowbite-pro-' }) : null;
  const all = {};
  let failed = 0;
  try {
    for (const b of BROWSERS) {
      for (const o of ORIGINS) {
        const base = o === 'file' ? pathToFileURL(DIST).href : server.url;
        const key = `${b}/${o}`;
        const t0 = Date.now();
        const res = await runOne(b, o, base);
        all[key] = res;
        const names = Object.keys(res);
        RUN.reportLeg({ leg: key, checks: names.length });
        const bad = names.filter((n) => !res[n].ok);
        failed += bad.length;
        console.log(`${bad.length ? 'FAIL' : 'PASS'} ${key}/ui-flowbite-pro: `
          + `${names.length - bad.length}/${names.length} checks `
          + `(${((Date.now() - t0) / 1000).toFixed(1)} s)`);
        for (const n of bad) {
          const why = res[n].failed ? `failed [${res[n].failed.join(', ')}] ` : '';
          console.log(`   x ${n}: ${why}${JSON.stringify(res[n]).slice(0, 900)}`);
        }
      }
    }
  } finally {
    if (server) server.close();
  }
  if (JSON_OUT) fs.writeFileSync(JSON_OUT, `${JSON.stringify(all, null, 2)}\n`);
  process.exit(failed ? 1 : 0);
})();
