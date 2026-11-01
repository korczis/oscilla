#!/usr/bin/env node
// OSCILLA navigable-surface census (plan issue U063) on the built dist/index.html in chromium,
// firefox and webkit, from file:// and from the GitHub-Pages-like sub-path
// (http://127.0.0.1:<port>/oscilla/), every check on both. The contract is
// tests/unit/surface-census.json; tests/unit/surface-census.test.mjs derives it from the code.
// This suite holds it to the running page, so a surface built only in src/js is caught too.
//
//   node tests/browser/surface-census.cjs [--dist dist/index.html]
//        [--browsers chromium,firefox,webkit] [--origins file,http] [--json out.json]
//        (or OSC_BROWSERS / OSC_ORIGINS through the harness)
//
// Checks (asserted), per browser and origin:
//   workspaces        the nav items of the page (data-osc="nav.<id>") are the contract's
//                     workspaces, and a fresh page at each workspace's deep link (#m=<id>)
//                     opens that workspace
//   panels            on each of those pages, at 1536x1024, every data-osc-modes element shown
//                     has an id and a contract, and every contracted panel is shown in each
//                     workspace its reachedFrom names; each panel's deep link shows it
//   tabs              every role=tab the visited pages hold is keyed by data-osc and data-value
//                     and is a subview of the contract, and every contracted tab was found
//   view-switches     the regions shown by a view switch (x-show="exps.panel === '<v>'") are the
//                     contract's, both ways
//   dialogs           every <dialog> of the visited pages has an id and a contract, and every
//                     contracted dialog was found
//   studio-subviews   at 375x800 (one subview at a time) activating each Studio subview tab
//                     shows that subview and its region, and each subview's deep link opens it;
//                     the tabs are the contract's Studio subviews, both ways
//   routes            each route kind's deep link (a <placeholder> filled with an id that is not
//                     stored) opens the workspace the router names, and the domain answers with
//                     a notice that is not a refusal ("... link not applied")
//   no-audio          no page constructed an AudioContext and none plays (engine, Studio
//                     transport): opening surfaces starts no sound. The Studio subview tabs are
//                     selected by a dispatched click, an activation without a pointer or key
//                     gesture, because the page creates its context on the first gesture
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
const RUN = suite.open({ name: 'surface-census', browsers: arg('browsers'),
  origins: arg('origins'), defaultOrigins: ['file', 'http'] });
const playwright = RUN.playwright;
const BROWSERS = RUN.browsers;
const ORIGINS = RUN.origins;
const JSON_OUT = arg('json', '');
const CENSUS = JSON.parse(fs.readFileSync(path.join(ROOT, 'tests', 'unit',
  'surface-census.json'), 'utf8'));
const OF = (kind) => CENSUS.surfaces.filter((e) => e.kind === kind);
const VIEW_SWITCHES = ['exps.panel'];
const NOT_STORED = 'u063-not-stored';
const DESKTOP = { width: 1536, height: 1024 };
const PHONE = { width: 375, height: 800 };
const PAGE_MS = 20000;
const SETTLE_MS = 10000;
const CHECK_MS = 180000;

/** Init script: count AudioContext constructions (opening a surface must start no sound). */
function audioProbe() {
  window.__oscU063Audio = 0;
  for (const name of ['AudioContext', 'webkitAudioContext']) {
    const Ctor = window[name];
    if (typeof Ctor !== 'function') continue;
    window[name] = new Proxy(Ctor, {
      construct(target, args, newTarget) {
        window.__oscU063Audio += 1;
        return Reflect.construct(target, args, newTarget);
      },
    });
  }
}

/** In the page: what it shows of the census's kinds. */
function snapshotInPage(switches) {
  const shown = (el) => el.getClientRects().length > 0;
  const a = window.OSCILLA && window.OSCILLA.app;
  const tabs = [...document.querySelectorAll('[role="tab"]')].map((el) => (
    el.dataset.osc && el.dataset.value ? `${el.dataset.osc}:${el.dataset.value}`
      : `(unkeyed role=tab ${el.id || el.textContent.trim().slice(0, 24)})`));
  const views = [...document.querySelectorAll('[x-show]')].map((el) => {
    const m = el.getAttribute('x-show').match(/^\s*([\w.]+)\s*===\s*'([\w-]+)'\s*$/);
    return m && switches.includes(m[1]) ? `${m[1]}:${m[2]}` : null;
  }).filter(Boolean);
  return {
    workspace: a ? a.workspace : null,
    nav: [...document.querySelectorAll('[data-osc^="nav."]')].map((el) => el.dataset.osc.slice(4)),
    panels: [...document.querySelectorAll('[data-osc-modes]')].filter(shown)
      .map((el) => el.id || `(a data-osc-modes ${el.tagName.toLowerCase()} without id)`),
    tabs,
    views,
    dialogs: [...document.querySelectorAll('dialog')].map((el) => el.id || '(a dialog without id)'),
    audio: window.__oscU063Audio,
    hash: window.location.hash,
    playing: (() => {
      const o = window.OSCILLA || {};
      const e = o.engine && o.engine.snapshot ? o.engine.snapshot() : {};
      const st = o.studio && o.studio.transport;
      return !!(e.playing || e.activeSources || (st && st.playing));
    })(),
    alerts: a ? a.alerts.map((x) => x.title) : [],
  };
}

const minus = (a, b) => [...new Set(a)].filter((x) => !b.includes(x));

// ------------------------------------------------------------------------------ page helpers
async function openPage(ctx, hash, viewport = DESKTOP) {
  const page = await ctx.context.newPage();
  page.setDefaultTimeout(PAGE_MS);
  await page.setViewportSize(viewport);
  page.on('console', (m) => { if (m.type() === 'error') ctx.errors.push(m.text()); });
  page.on('pageerror', (e) => ctx.errors.push(`pageerror: ${e.message}`));
  await page.goto(`${ctx.baseUrl}${hash}`, { waitUntil: 'load', timeout: PAGE_MS });
  await page.waitForSelector('html[data-ready="true"]', { timeout: PAGE_MS });
  ctx.pages.push(page);
  return page;
}

const snapshot = (page) => page.evaluate(snapshotInPage, VIEW_SWITCHES);

/** Poll the page until `pred(snapshot)` holds; the last snapshot either way. */
async function settle(page, pred, what) {
  let last = null;
  try {
    await until(async () => {
      last = await snapshot(page);
      return pred(last);
    }, { ms: SETTLE_MS, what });
    return { ok: true, snap: last };
  } catch (error) {
    return { ok: false, snap: last, error: String(error.message || error).split('\n')[0] };
  }
}

const closeAll = async (ctx) => {
  for (const p of ctx.pages.splice(0)) {
    await bounded(p.close(), { ms: 5000, what: 'closing a census page' }).catch(() => {});
  }
};

// ------------------------------------------------------------------------------ checks
function defineChecks() {
  const checks = [];
  const def = (name, fn) => checks.push({ name, fn });
  const record = (ctx, snap) => {
    for (const k of ['tabs', 'views', 'dialogs']) ctx.seen[k].push(...snap[k]);
    if (snap.audio) ctx.audio.push(`${snap.hash}: ${snap.audio} AudioContext(s)`);
    if (snap.playing) ctx.audio.push(`${snap.hash}: playing`);
  };

  def('workspaces', async (ctx) => {
    const bad = [];
    let nav = null;
    for (const ws of OF('workspace')) {
      const page = await openPage(ctx, ws.deepLink);
      const want = OF('panel').filter((p) => p.reachedFrom.includes(ws.id)).map((p) => p.id);
      const r = await settle(page, (s) => s.workspace === ws.id
        && want.every((id) => s.panels.includes(id)),
      `${ws.deepLink} opens ${ws.id} with its panels`);
      if (r.snap) {
        record(ctx, r.snap);
        ctx.shown[ws.id] = r.snap.panels;
        nav = nav || r.snap.nav;
      }
      if (!r.ok || !r.snap) bad.push(`${ws.deepLink}: ${r.error || 'no snapshot'}`);
      await closeAll(ctx);
    }
    const contract = OF('workspace').map((w) => w.id);
    const extra = minus(nav || [], contract);
    const missing = minus(contract, nav || []);
    return { ok: bad.length === 0 && nav !== null && !extra.length && !missing.length, bad,
      navNotInContract: extra, contractNotInNav: missing };
  });

  def('panels', async (ctx) => {
    const contract = OF('panel').map((p) => p.id);
    const unknown = minus(Object.values(ctx.shown).flat(), contract);
    const notReached = [];
    for (const p of OF('panel')) {
      for (const ws of p.reachedFrom) {
        if (!(ctx.shown[ws] || []).includes(p.id)) notReached.push(`${p.id} in ${ws}`);
      }
    }
    const linkFails = OF('panel').filter((p) => p.deepLink !== null).filter((p) => {
      const ws = OF('workspace').find((w) => w.deepLink === p.deepLink);
      return !ws || !(ctx.shown[ws.id] || []).includes(p.id);
    }).map((p) => `${p.id} at ${p.deepLink}`);
    return { ok: Object.keys(ctx.shown).length > 0 && !unknown.length && !notReached.length
      && !linkFails.length, shownNotInContract: unknown, contractedNotShown: notReached,
    deepLinkNotShowing: linkFails };
  });

  def('tabs', async (ctx) => {
    const contract = OF('subview').map((s) => s.id)
      .filter((id) => !VIEW_SWITCHES.some((v) => id.startsWith(`${v}:`)));
    const seen = [...new Set(ctx.seen.tabs)];
    return { ok: seen.length > 0 && !minus(seen, contract).length && !minus(contract, seen).length,
      found: seen.length, inPageNotInContract: minus(seen, contract),
      contractedNotFound: minus(contract, seen) };
  });

  def('view-switches', async (ctx) => {
    const contract = OF('subview').map((s) => s.id)
      .filter((id) => VIEW_SWITCHES.some((v) => id.startsWith(`${v}:`)));
    const seen = [...new Set(ctx.seen.views)];
    return { ok: seen.length > 0 && !minus(seen, contract).length && !minus(contract, seen).length,
      inPageNotInContract: minus(seen, contract), contractedNotFound: minus(contract, seen) };
  });

  def('dialogs', async (ctx) => {
    const contract = OF('dialog').map((d) => d.id);
    const seen = [...new Set(ctx.seen.dialogs)];
    return { ok: seen.length > 0 && !minus(seen, contract).length && !minus(contract, seen).length,
      found: seen.length, inPageNotInContract: minus(seen, contract),
      contractedNotFound: minus(contract, seen) };
  });

  def('studio-subviews', async (ctx) => {
    const subs = OF('subview').filter((s) => s.id.startsWith('studio.subview:'));
    const bad = [];
    const page = await openPage(ctx, '#m=studio', PHONE);
    const first = await settle(page, (s) => s.workspace === 'studio', 'Studio opens at #m=studio');
    if (!first.ok) bad.push(first.error);
    const tabs = await page.evaluate(() => [...document.querySelectorAll(
      '[role="tab"][data-osc="studio.subview"]')].map((el) => ({ value: el.dataset.value,
      region: el.getAttribute('aria-controls') })));
    const state = (p, region) => p.evaluate((rid) => ({
      subview: document.querySelector('#osc-view-studio').dataset.subview,
      shown: ['osc-st-graph', 'osc-st-timeline', 'osc-st-inspector']
        .filter((id) => document.getElementById(id).getClientRects().length > 0),
      region: rid,
    }), region);
    // Away from the default first, so each selection is a change the page has to make.
    const order = [...tabs.slice(1), tabs[0]].filter(Boolean);
    for (const t of order) {
      // An activation without a pointer or key gesture (what assistive technology dispatches):
      // the page creates its AudioContext on the first gesture (main.js unlock), and opening a
      // surface must start no audio.
      await page.dispatchEvent(`[role="tab"][data-osc="studio.subview"][data-value="${t.value}"]`,
        'click', {}, { timeout: PAGE_MS });
      try {
        await until(async () => {
          const s = await state(page, t.region);
          return s.subview === t.value && s.shown.length === 1 && s.shown[0] === t.region;
        }, { ms: SETTLE_MS, what: `the ${t.value} tab shows the ${t.value} subview alone` });
      } catch (error) {
        bad.push(`tab ${t.value}: ${String(error.message).split('\n')[0]}`);
      }
    }
    record(ctx, await snapshot(page));
    for (const s of subs) {
      const value = s.id.split(':')[1];
      const region = (tabs.find((t) => t.value === value) || {}).region;
      const p = await openPage(ctx, s.deepLink, PHONE);
      try {
        await until(async () => {
          const st = await state(p, region);
          return st.subview === value && st.shown.length === 1 && st.shown[0] === region;
        }, { ms: SETTLE_MS, what: `${s.deepLink} shows the ${value} subview alone` });
      } catch (error) {
        bad.push(`${s.deepLink}: ${String(error.message).split('\n')[0]}`);
      }
      record(ctx, await snapshot(p));
    }
    await closeAll(ctx);
    const values = tabs.map((t) => t.value);
    const contract = subs.map((s) => s.id.split(':')[1]);
    return { ok: tabs.length > 0 && !bad.length && !minus(values, contract).length
      && !minus(contract, values).length, bad, tabsNotInContract: minus(values, contract),
    contractedNotTabs: minus(contract, values) };
  });

  def('routes', async (ctx) => {
    const { routeOfHash } = await import(pathToFileURL(path.join(ROOT, 'src', 'js', 'ui',
      'navigation.js')).href);
    const bad = [];
    const answered = {};
    for (const r of OF('route')) {
      const link = r.deepLink.replace(/<[^<>]+>/g, NOT_STORED);
      const want = routeOfHash(link);
      if (!want) {
        bad.push(`${r.id}: the router opens nothing for ${link}`);
        continue;
      }
      const page = await openPage(ctx, link);
      const s = await settle(page, (x) => x.workspace === want.workspace && x.alerts.length > 0,
        `${link} opens ${want.workspace} and its domain answers`);
      if (s.snap) record(ctx, s.snap);
      const refused = s.snap ? s.snap.alerts.filter((t) => /link not applied/i.test(t)) : [];
      answered[r.id] = s.snap ? s.snap.alerts : null;
      if (!s.ok) bad.push(`${r.id}: ${s.error}`);
      if (refused.length) bad.push(`${r.id}: refused (${refused.join('; ')})`);
      await closeAll(ctx);
    }
    return { ok: OF('route').length > 0 && !bad.length, bad, answered };
  });

  def('no-audio', async (ctx) => ({ ok: ctx.audio.length === 0, audioContexts: ctx.audio }));

  def('no-console-errors', async (ctx) => ({ ok: ctx.errors.length === 0,
    errors: ctx.errors.slice(0, 8) }));

  return checks;
}

async function runOne(browserName, origin, baseUrl) {
  const browser = await playwright[browserName].launch();
  const context = await browser.newContext({ viewport: DESKTOP, reducedMotion: 'reduce' });
  await context.addInitScript(audioProbe);
  const ctx = { browserName, origin, baseUrl, context, errors: [], pages: [], shown: {},
    seen: { tabs: [], views: [], dialogs: [] }, audio: [] };
  const results = {};
  for (const { name, fn } of defineChecks()) {
    const t0 = Date.now();
    try {
      const v = await bounded(fn(ctx), { ms: CHECK_MS, what: `surface-census ${name}` });
      results[name] = { ...v, ms: Date.now() - t0 };
    } catch (e) {
      results[name] = { ok: false, detail: String(e.message || e).split('\n')[0],
        ms: Date.now() - t0 };
    }
    RUN.tally(`${browserName}/${origin}`);
    await closeAll(ctx);
  }
  await bounded(browser.close(), { ms: 10000, what: 'closing the census browser' })
    .catch(() => {});
  return results;
}

(async () => {
  await RUN.ready();
  if (!fs.existsSync(DIST)) {
    console.error(`missing ${DIST}: run npm run build`);
    process.exit(2);
  }
  const server = ORIGINS.includes('http')
    ? await serveDist(DIST, { prefix: 'oscilla-surface-census-' }) : null;
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
        const bad = names.filter((n) => !res[n].ok);
        failed += bad.length;
        console.log(`${bad.length ? 'FAIL' : 'PASS'} ${key}/surface-census: `
          + `${names.length - bad.length}/${names.length} checks `
          + `(${((Date.now() - t0) / 1000).toFixed(1)} s)`);
        for (const n of bad) console.log(`   x ${n}: ${JSON.stringify(res[n]).slice(0, 1200)}`);
      }
    }
  } finally {
    if (server) server.close();
  }
  if (JSON_OUT) fs.writeFileSync(JSON_OUT, `${JSON.stringify(all, null, 2)}\n`);
  process.exit(failed ? 1 : 0);
})();
