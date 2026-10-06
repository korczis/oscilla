#!/usr/bin/env node
// OSCILLA unsaved-work guard and workspace navigation history (ledger W2, W4; ADR 0045) on the
// built dist/index.html in chromium, firefox and webkit, from file:// and from a
// GitHub-Pages-like sub-path (http://127.0.0.1:<port>/oscilla/), every check on both.
//
//   node tests/browser/navigation.cjs [--dist dist/index.html] [--browsers chromium,firefox,webkit]
//        [--origins file,http] [--only name1,name2] [--json out.json]   (or OSC_BROWSERS=...)
//
// Checks (asserted):
//   guard-studio      a clean page registers no beforeunload listener and a reload asks
//                     nothing; unsaved Studio changes register exactly one and a reload asks
//                     (the browser's own beforeunload dialog; dismissed, the page and its work
//                     stay); after Save the listener is gone and a reload asks nothing
//   guard-measure     a completed TEST CONTEXT measurement that is not saved arms the guard and
//                     shows "unsaved result" in the Experiment panel; a reload asks; Save
//                     disarms it and hides the indicator; a level calibration (page memory
//                     only) arms it until it is cleared
//   history           every workspace switch through the nav is one history entry; Back and
//                     Forward move between the workspaces, focus lands on the workspace heading,
//                     no notification is raised, a changed instrument setting and unsaved Studio
//                     changes survive Back / Forward, and the guard asks nothing for them; a
//                     reload reopens the workspace the address names
//   hashchange-mode   a hash set after load moves the workspace AND the V1 mode together
//                     (`m=learn` → Learn, `m=dual` → Synthesis/dual, `m=sweep` → Playground/sweep)
//   precedence        `#m=studio&st=…&sv=…&mr=…` opens STUDIO with the template and view and
//                     still loads the recipe into MEASURE; `#m=learn&mr=…` opens Learn
//   copy-link         Copy config URL keeps `mr` and the Studio keys and names the workspace; the
//                     copied URL reopens the same workspace, template, view and recipe; after a
//                     `m=learn` link and a switch to Playground it writes `m=playground`
//   anchor            the skip link (an in-page anchor) leaves the address naming the workspace
//   no-console-errors
'use strict';
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const playwright = require('playwright');

const argv = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};
const ROOT = path.resolve(__dirname, '..', '..');
const DIST = path.resolve(arg('dist', path.join(ROOT, 'dist', 'index.html')));
const BROWSERS = arg('browsers', process.env.OSC_BROWSERS || 'chromium,firefox,webkit').split(',');
const ORIGINS = arg('origins', 'file,http').split(',');
const ONLY = arg('only', '') ? new Set(arg('only', '').split(',')) : null;
const JSON_OUT = arg('json', '');
const LAUNCH = {
  chromium: { args: ['--autoplay-policy=no-user-gesture-required'] },
  firefox: { firefoxUserPrefs: { 'media.autoplay.default': 0, 'media.autoplay.blocking_policy': 0,
    'media.autoplay.block-webaudio': false } },
  webkit: {},
};
// The MEASURE TEST CONTEXT recipe of tests/browser/v3-ui.cjs: short, deterministic.
const SHORT = { duration: 1, repeats: 1, noiseCheckS: 0.5, preRollS: 0.25, postRollS: 0.5,
  gapS: 0.2 };
const RUN_MS = 45000;
// A valid recipe link (url-state-measure.js wire keys): 50 Hz-12 kHz.
const RECIPE = Buffer.from(JSON.stringify({ v: 1, f1: 50, f2: 12000 })).toString('base64url');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function startServer() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'oscilla-navigation-'));
  fs.mkdirSync(path.join(root, 'oscilla'));
  fs.copyFileSync(DIST, path.join(root, 'oscilla', 'index.html'));
  const port = 9300 + Math.floor(Math.random() * 300);
  const proc = spawn('python3', ['-m', 'http.server', String(port), '--bind', '127.0.0.1',
    '--directory', root], { stdio: 'ignore' });
  return { proc, root, url: `http://127.0.0.1:${port}/oscilla/` };
}

async function waitForServer(url) {
  for (let i = 0; i < 80; i += 1) {
    try { const r = await fetch(url); if (r.ok) return; } catch { /* not yet */ }
    await sleep(100);
  }
  throw new Error(`server did not start: ${url}`);
}

/**
 * Init script: count the beforeunload listeners the page holds on window (the guard must hold
 * none while nothing would be lost), and the onbeforeunload property.
 */
function beforeUnloadProbe() {
  const add = EventTarget.prototype.addEventListener;
  const remove = EventTarget.prototype.removeEventListener;
  const live = new Set();
  window.__oscBeforeUnload = () => live.size + (typeof window.onbeforeunload === 'function'
    ? 1 : 0);
  EventTarget.prototype.addEventListener = function addProbe(type, fn, opts) {
    if (this === window && type === 'beforeunload') live.add(fn);
    return add.call(this, type, fn, opts);
  };
  EventTarget.prototype.removeEventListener = function removeProbe(type, fn, opts) {
    if (this === window && type === 'beforeunload') live.delete(fn);
    return remove.call(this, type, fn, opts);
  };
}

// ------------------------------------------------------------------------------ page helpers
const H = {
  verdict: (conds) => {
    const failed = Object.keys(conds).filter((k) => !conds[k]);
    return { ok: failed.length === 0, failed };
  },
  until: async (fn, test, ms = 3000, step = 40) => {
    const t0 = Date.now();
    let v = await fn();
    while (!test(v) && Date.now() - t0 < ms) {
      await sleep(step);
      v = await fn();
    }
    return v;
  },
  frames: (page, n = 2) => page.evaluate((k) => new Promise((r) => {
    let i = 0;
    const f = () => (++i >= k ? r() : requestAnimationFrame(f));
    requestAnimationFrame(f);
  }), n),
  ready: async (page) => {
    await page.waitForSelector('html[data-ready="true"]', { timeout: 15000 });
    await H.until(() => page.evaluate(() => !!(window.OSCILLA.app
      && window.OSCILLA.app.studio.ready)), (v) => v);
    await H.frames(page);
  },
  /** A fresh page (a real load) at `url`, ready, with a user gesture (sticky activation). */
  open: async (ctx, url) => {
    const page = await ctx.context.newPage();
    page.setDefaultTimeout(15000);
    page.on('console', (m) => { if (m.type() === 'error') ctx.errors.push(m.text()); });
    page.on('pageerror', (e) => ctx.errors.push(`pageerror: ${e.message}`));
    await page.goto(url, { waitUntil: 'load' });
    await H.ready(page);
    // A user gesture on the status line (no control): browsers ask beforeunload questions only
    // on a page the user has interacted with.
    await page.mouse.click(3, 1000);
    await page.evaluate(() => {
      const a = window.OSCILLA.app;
      a.alerts = [];
      if (!a.safetyCollapsed) a.collapseSafety();
    });
    return page;
  },
  state: (page) => page.evaluate(() => {
    const a = window.OSCILLA.app;
    const el = document.activeElement;
    return { workspace: a.workspace, mode: a.mode, dataMode: document.querySelector('#osc-app')
      .dataset.mode, hash: window.location.hash, length: window.history.length,
    focus: el ? (el.id || el.dataset.osc || el.tagName) : null,
    focusHeading: !!el && /^H[1-3]$/.test(el.tagName), alerts: a.alerts.map((x) => x.title),
    listeners: window.__oscBeforeUnload(), armed: !!(window.OSCILLA.unsaved
      && window.OSCILLA.unsaved.armed), lost: window.OSCILLA.unsaved
      ? window.OSCILLA.unsaved.whatWouldBeLost().map((x) => `${x.domain}: ${x.label}`) : [],
    frequency: a.frequency, studioDirty: window.OSCILLA.studio.dirty };
  }),
  /**
   * Reload and report whether the browser asked (a beforeunload dialog, dismissed: the page
   * and its work must stay) or reloaded.
   */
  reload: async (page) => {
    let dialog = null;
    const onDialog = (d) => {
      dialog = d.type();
      d.dismiss().catch(() => {});
    };
    page.on('dialog', onDialog);
    await page.evaluate(() => { window.__oscSamePage = true; });
    await page.reload({ waitUntil: 'load', timeout: 3000 }).catch(() => {});
    page.off('dialog', onDialog);
    await sleep(150);
    const stayed = await page.evaluate(() => window.__oscSamePage === true).catch(() => false);
    if (!stayed) await H.ready(page);
    return { dialog, stayed };
  },
  /** Reach a workspace through the nav; a grouped one (ANALYZE, SYNTHESIS) opens its group. */
  navTo: async (page, ws) => {
    const item = `[data-osc="nav.${ws}"]`;
    const group = await page.evaluate((s) => {
      const el = document.querySelector(s);
      const g = el && el.closest('[data-osc-nav-group]');
      return g && el.offsetParent === null ? g.dataset.oscNavGroup : null;
    }, item);
    if (group) await page.click(`[data-osc="nav-group.${group}"]`);
    await page.click(item);
    await page.waitForFunction((w) => window.OSCILLA.app.workspace === w, ws);
    await H.frames(page);
  },
  /** Back / Forward (same document), the dialogs met on the way, then the state. */
  traverse: async (page, dir) => {
    const dialogs = [];
    const onDialog = (d) => { dialogs.push(d.type()); d.dismiss().catch(() => {}); };
    page.on('dialog', onDialog);
    const before = await page.evaluate(() => window.location.href);
    try {
      await page.evaluate((d) => (d === 'back' ? window.history.back()
        : window.history.forward()), dir);
      await H.until(() => page.evaluate(() => window.location.href), (h) => h !== before);
      await H.frames(page, 4);
      await sleep(100);
      return { ...(await H.state(page)), dialogs };
    } catch (e) {
      // Back left the application (no history entry of its own): say where it went.
      return { left: true, url: page.url(), dialogs };
    } finally {
      page.off('dialog', onDialog);
    }
  },
  dirtyStudio: (page) => page.evaluate(() => {
    const s = window.OSCILLA.studio;
    const n = s.model.graph.nodes[0];
    s.store.dispatch({ type: 'NODE_MOVE', nodeId: n.id,
      position: { x: n.position.x + 48, y: n.position.y } });
  }),
  shown: (page, sel) => page.evaluate((s) => {
    const el = document.querySelector(s);
    return !!el && el.getClientRects().length > 0;
  }, sel),
  params: (hash) => Object.fromEntries(new URLSearchParams(String(hash).replace(/^#/, ''))),
};

// ------------------------------------------------------------------------------ checks
function defineChecks() {
  const checks = [];
  const def = (name, fn) => checks.push({ name, fn });

  def('guard-studio', async (ctx) => {
    const page = await H.open(ctx, ctx.baseUrl);
    const clean = await H.state(page);
    const cleanReload = await H.reload(page);
    await page.mouse.click(3, 1000);
    await H.navTo(page, 'studio');
    await H.dirtyStudio(page);
    await H.frames(page);
    const dirty = await H.state(page);
    const indicator = await H.shown(page, '[data-osc="studio.dirty"]');
    const dirtyReload = await H.reload(page);
    const after = await H.state(page);
    await page.evaluate(() => window.OSCILLA.app.studioSave());
    await H.until(() => H.state(page), (s) => !s.studioDirty);
    await H.frames(page);
    const saved = await H.state(page);
    const savedReload = await H.reload(page);
    await page.close();
    return { ...H.verdict({
      cleanNoListener: clean.listeners === 0 && !clean.armed && clean.lost.length === 0,
      cleanReloads: cleanReload.dialog === null && !cleanReload.stayed,
      dirtyArmed: dirty.studioDirty && dirty.listeners === 1 && dirty.armed
        && dirty.lost.length === 1 && /^studio: Unsaved changes to /.test(dirty.lost[0])
        && indicator,
      dirtyAsks: dirtyReload.dialog === 'beforeunload' && dirtyReload.stayed && after.studioDirty
        && after.workspace === 'studio',
      savedDisarmed: !saved.studioDirty && saved.listeners === 0 && !saved.armed,
      savedReloads: savedReload.dialog === null && !savedReload.stayed,
    }), clean, cleanReload, dirty, dirtyReload, saved, savedReload };
  });

  def('guard-measure', async (ctx) => {
    const page = await H.open(ctx, ctx.baseUrl);
    await H.navTo(page, 'measure');
    await page.evaluate((values) => {
      const m = window.OSCILLA.measure;
      m.useLoopback({ type: 'biquad', filter: 'lowpass', frequency: 2000, Q: Math.SQRT1_2 });
      m.setValues(values);
    }, SHORT);
    const idle = await H.state(page);
    const idleIndicator = await H.shown(page, '[data-osc="measure.unsaved"]');
    await page.click('#osc-measure-primary'); // Check setup
    await page.waitForFunction(() => ['READY', 'INVALID', 'ERROR']
      .includes(window.OSCILLA.measure.state), null, { timeout: RUN_MS, polling: 50 });
    await page.click('#osc-measure-primary'); // Start measurement
    await page.waitForFunction(() => ['COMPLETE', 'INVALID', 'ERROR', 'ABORTED']
      .includes(window.OSCILLA.measure.state), null, { timeout: RUN_MS, polling: 50 });
    await H.frames(page);
    const done = await H.state(page);
    const runState = await page.evaluate(() => window.OSCILLA.measure.state);
    if (runState !== 'COMPLETE') {
      await page.close();
      return { ok: false, failed: ['run'], runState };
    }
    const indicator = await H.shown(page, '[data-osc="measure.unsaved"]');
    const hint = await page.evaluate(() => document.querySelector('[data-osc="measure.savedText"]')
      .textContent);
    const unsavedReload = await H.reload(page);
    if (!unsavedReload.stayed) {
      await page.close();
      return { ok: false, failed: ['completeArmed', 'unsavedAsks'], done, indicator, hint,
        unsavedReload };
    }
    await page.click('#osc-measure-save');
    await page.waitForFunction(() => window.OSCILLA.app.meas.saved, null, { timeout: 10000 });
    await H.frames(page);
    const saved = await H.state(page);
    const savedIndicator = await H.shown(page, '[data-osc="measure.unsaved"]');
    // A level calibration lives in page memory only: it counts until it is cleared.
    const calibrated = await page.evaluate(() => {
      const a = window.OSCILLA.app;
      Object.assign(a.meas.levelForm, { manual: true, referenceHz: '1000', referenceDb: '94',
        observedDb: '-20', conditions: 'navigation gate' });
      return a.measureSaveLevelCalibration();
    });
    await H.frames(page);
    const withCal = await H.state(page);
    await page.evaluate(() => window.OSCILLA.app.measureClearLevelCalibration());
    await H.frames(page);
    const cleared = await H.state(page);
    await page.close();
    return { ...H.verdict({
      idleClean: idle.listeners === 0 && !idle.armed && !idleIndicator,
      completeArmed: done.listeners === 1 && done.armed && done.lost.length === 1
        && /^measure: A completed measurement that is not saved$/.test(done.lost[0]),
      indicator: indicator && /Not saved yet/.test(hint),
      unsavedAsks: unsavedReload.dialog === 'beforeunload' && unsavedReload.stayed,
      savedDisarmed: saved.listeners === 0 && !saved.armed && !savedIndicator,
      calibrationArmed: calibrated === true && withCal.listeners === 1
        && withCal.lost.some((x) => /^measure: The level calibration/.test(x)),
      clearedDisarmed: cleared.listeners === 0 && !cleared.armed,
    }), idle, done, hint, unsavedReload, saved, withCal: withCal.lost, cleared: cleared.lost };
  });

  def('history', async (ctx) => {
    const page = await H.open(ctx, `${ctx.baseUrl}#v=1&f=440`);
    const start = await H.state(page);
    // A setting changed after the link: Back / Forward must not put the link's value back.
    await page.evaluate(() => window.OSCILLA.app.setFrequency(880));
    for (const ws of ['measure', 'analyzer', 'studio']) await H.navTo(page, ws);
    const switched = await H.state(page);
    await H.dirtyStudio(page);
    await page.evaluate(() => { window.OSCILLA.app.alerts = []; });
    const b1 = await H.traverse(page, 'back');
    if (b1.left) {
      // (the page is closed with the context's others: closing it here can stall)
      return { ok: false, failed: ['entries', 'back'], switched, b1 };
    }
    const b2 = await H.traverse(page, 'back');
    const b3 = await H.traverse(page, 'back');
    const f1 = await H.traverse(page, 'forward');
    const f2 = await H.traverse(page, 'forward');
    const f3 = await H.traverse(page, 'forward');
    // A reload reopens the workspace the address names (the Studio changes are saved first so
    // the reload does not ask).
    await page.evaluate(() => window.OSCILLA.app.studioSave());
    await H.until(() => H.state(page), (s) => !s.studioDirty);
    await H.traverse(page, 'back');
    const reload = await H.reload(page);
    const reloaded = await H.state(page);
    await page.close();
    const noAlert = (s) => s.alerts.length === 0;
    const at = (s, ws) => s.workspace === ws && s.dataMode === ws;
    return { ...H.verdict({
      entries: switched.length === start.length + 3 && at(switched, 'studio')
        && H.params(switched.hash).m === 'studio',
      back: at(b1, 'analyzer') && at(b2, 'measure') && at(b3, 'playground')
        && H.params(b1.hash).m === 'analyzer' && H.params(b2.hash).m === 'measure',
      forward: at(f1, 'measure') && at(f2, 'analyzer') && at(f3, 'studio'),
      lengthKept: [b1, b2, b3, f1, f2, f3].every((s) => s.length === switched.length),
      focusHeading: b1.focusHeading && b2.focus === 'osc-measure-title' && b3.focusHeading
        && f3.focus === 'osc-studio-title',
      quiet: [b1, b2, b3, f1, f2, f3].every(noAlert),
      stateKept: [b1, b2, b3, f1, f2, f3].every((s) => s.frequency === 880) && f3.studioDirty,
      guardSilent: [b1, b2, b3, f1, f2, f3].every((s) => s.dialogs.length === 0),
      reloadRestores: !reload.stayed && reload.dialog === null && at(reloaded, 'analyzer'),
    }), start: { hash: start.hash, length: start.length }, switched, b1, b2, b3, f1, f2, f3,
    reloaded };
  });

  def('hashchange-mode', async (ctx) => {
    const page = await H.open(ctx, ctx.baseUrl);
    const set = async (hash, ws) => {
      await page.evaluate((h) => { window.location.hash = h; }, hash);
      return H.until(() => H.state(page), (s) => s.workspace === ws, 2000);
    };
    const learn = await set('v=1&m=learn&f=440', 'learn');
    const learnShown = await H.shown(page, '#osc-view-learn');
    const navCurrent = await page.evaluate(() => document.querySelector('[data-osc="nav.learn"]')
      .getAttribute('aria-current'));
    const dual = await set('v=1&m=dual&s=dual&f=440', 'synthesis');
    const sweep = await set('v=1&m=sweep&s=sweep&f=440', 'playground');
    const learnHidden = !(await H.shown(page, '#osc-view-learn'));
    await page.close();
    return { ...H.verdict({
      learn: learn.workspace === 'learn' && learn.mode === 'learn' && learnShown
        && navCurrent === 'page',
      dual: dual.workspace === 'synthesis' && dual.mode === 'dual',
      sweep: sweep.workspace === 'playground' && sweep.mode === 'sweep' && learnHidden,
    }), learn, dual, sweep };
  });

  def('precedence', async (ctx) => {
    const both = await H.open(ctx,
      `${ctx.baseUrl}#m=studio&st=basic-tone&sv=timeline&mr=${RECIPE}`);
    const s1 = await H.state(both);
    const r1 = await both.evaluate(() => ({ f1: window.OSCILLA.app.meas.values.f1,
      template: window.OSCILLA.studio.templateId, subview: window.OSCILLA.app.studio.subview }));
    await both.close();
    const learn = await H.open(ctx, `${ctx.baseUrl}#m=learn&mr=${RECIPE}`);
    const s2 = await H.state(learn);
    const r2 = await learn.evaluate(() => window.OSCILLA.app.meas.values.f1);
    await learn.close();
    return { ...H.verdict({
      studioWins: s1.workspace === 'studio' && r1.template === 'basic-tone'
        && r1.subview === 'timeline',
      recipeStillLoaded: r1.f1 === 50 && r2 === 50,
      mWinsOverRecipe: s2.workspace === 'learn' && s2.mode === 'learn',
    }), s1, r1, s2, r2 };
  });

  def('copy-link', async (ctx) => {
    const page = await H.open(ctx,
      `${ctx.baseUrl}#m=studio&st=basic-tone&sv=timeline&mr=${RECIPE}`);
    const copy = async () => {
      await page.evaluate(() => window.OSCILLA.app.copyConfigUrl());
      await H.frames(page);
      const url = await page.evaluate(() => window.location.href);
      await page.evaluate(() => {
        for (const d of document.querySelectorAll('dialog[open]')) d.close();
        window.OSCILLA.app.alerts = [];
      });
      return url;
    };
    const url = await copy();
    const p = H.params(new URL(url).hash);
    await page.close();
    const again = await H.open(ctx, url);
    const reopened = await H.state(again);
    const r = await again.evaluate(() => ({ f1: window.OSCILLA.app.meas.values.f1,
      template: window.OSCILLA.studio.templateId, subview: window.OSCILLA.app.studio.subview }));
    await again.close();
    // After a `m=learn` link, a switch to Playground: the copied link names the Playground.
    const p2 = await H.open(ctx, ctx.baseUrl);
    await p2.evaluate(() => { window.location.hash = 'v=1&m=learn&f=440'; });
    await H.until(() => H.state(p2), (s) => s.workspace === 'learn');
    await H.navTo(p2, 'playground');
    await p2.evaluate(() => window.OSCILLA.app.copyConfigUrl());
    await H.frames(p2);
    const pg = await H.state(p2);
    await p2.close();
    return { ...H.verdict({
      keepsRecipe: p.mr === RECIPE,
      keepsStudio: p.m === 'studio' && p.st === 'basic-tone' && p.sv === 'timeline',
      instrument: p.v === '1' && !!p.f,
      roundTrip: reopened.workspace === 'studio' && r.template === 'basic-tone'
        && r.subview === 'timeline' && r.f1 === 50,
      namesWorkspace: H.params(pg.hash).m === 'playground' && pg.workspace === 'playground'
        && pg.mode === 'playground',
    }), url, reopened, r, playground: pg.hash };
  });

  def('anchor', async (ctx) => {
    const page = await H.open(ctx, ctx.baseUrl);
    await H.navTo(page, 'measure');
    const before = await H.state(page);
    await page.focus('.osc-skip');
    await page.keyboard.press('Enter');
    const after = await H.until(() => H.state(page), (s) => s.hash === before.hash, 2000);
    await page.close();
    return { ...H.verdict({
      addressKept: H.params(after.hash).m === 'measure' && after.workspace === 'measure',
    }), before: before.hash, after: after.hash };
  });

  def('no-console-errors', async (ctx) => ({ ok: ctx.errors.length === 0,
    errors: ctx.errors.slice(0, 8) }));

  return checks;
}

async function runOne(browserName, origin, baseUrl) {
  const browser = await playwright[browserName].launch(LAUNCH[browserName]);
  const context = await browser.newContext({ viewport: { width: 1536, height: 1024 },
    reducedMotion: 'reduce' });
  await context.addInitScript(beforeUnloadProbe);
  const ctx = { browser, browserName, origin, baseUrl, context, errors: [] };
  const results = {};
  for (const { name, fn } of defineChecks()) {
    if (ONLY && !ONLY.has(name) && name !== 'no-console-errors') continue;
    const t0 = Date.now();
    try {
      const v = await Promise.race([
        fn(ctx),
        sleep(120000).then(() => ({ ok: false, detail: 'timeout 120 s' })),
      ]);
      results[name] = { ...v, ms: Date.now() - t0 };
    } catch (e) {
      results[name] = { ok: false, detail: String(e.message || e).split('\n')[0],
        ms: Date.now() - t0 };
    }
    for (const p of context.pages()) {
      await Promise.race([p.close().catch(() => {}), sleep(3000)]);
    }
  }
  await Promise.race([browser.close().catch(() => {}), sleep(10000)]);
  return results;
}

(async () => {
  if (!fs.existsSync(DIST)) {
    console.error(`missing ${DIST}: run npm run build`);
    process.exit(2);
  }
  const server = ORIGINS.includes('http') ? startServer() : null;
  if (server) await waitForServer(server.url);
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
        console.log(`${bad.length ? 'FAIL' : 'PASS'} ${key}/navigation: ${names.length - bad.length}/`
          + `${names.length} checks (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
        for (const n of bad) {
          const why = res[n].failed ? `failed [${res[n].failed.join(', ')}] ` : '';
          console.log(`   x ${n}: ${why}${JSON.stringify(res[n]).slice(0, 900)}`);
        }
      }
    }
  } finally {
    if (server) {
      server.proc.kill();
      fs.rmSync(server.root, { recursive: true, force: true });
    }
  }
  if (JSON_OUT) fs.writeFileSync(JSON_OUT, `${JSON.stringify(all, null, 2)}\n`);
  process.exit(failed ? 1 : 0);
})();
