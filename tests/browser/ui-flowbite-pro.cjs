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
