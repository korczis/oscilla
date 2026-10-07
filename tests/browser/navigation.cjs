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
//   open-every-workspace  a fresh page at `#m=<id>` opens each of the twelve workspaces; the
//                     Experiments list loads, About sets its title
//   hashchange-mode   a hash set after load moves the workspace AND the V1 mode together
//                     (`m=learn` → Learn, `m=dual` → Synthesis/dual, `m=sweep` → Playground/sweep)
//   precedence        `#m=studio&st=…&sv=…&mr=…` opens STUDIO with the template and view and
//                     still loads the recipe into MEASURE; `#m=learn&mr=…` opens Learn
//   copy-link         Copy config URL keeps `mr` and the Studio keys and names the workspace; the
//                     copied URL reopens the same workspace, template, view and recipe; after a
//                     `m=learn` link and a switch to Playground it writes `m=playground`
//   guard-saved-metadata  after a save, a name typed and not stored, a failed "Update name and
//                     notes" and a rename being typed in Experiments each arm the guard
//   guard-memory-store    with IndexedDB refused, a saved experiment and a saved Studio project
//                     (page memory only) arm the guard and a reload asks
//   refused-link-not-in-history  a refused Studio or recipe link (as a new hash or at load) is
//                     replaced in the address: Back never opens it
//   nav-links         each nav href is `#m=<id>` and opens that workspace on a fresh page; a
//                     modified click is left to the browser
//   anchor            the skip link moves focus to the main region with no history entry and the
//                     address unchanged
//   space-one-meaning  (ledger W5, ADR 0049) Space with nothing focused does what the workspace
//                     in view owns, and nothing else: the instrument's Hold to Play in the six
//                     instrument workspaces, the Studio transport in Studio, nothing at all in
//                     Measure, Experiments, Learn, Presets and About; a focused link in Studio
//                     keeps Space (nothing starts)
//   one-shortcut-dialog  (W5) one dialog lists shortcuts: Help, the overflow menu and Studio's
//                     keyboard button open the same dialog, which names the Space meaning of the
//                     workspace in view and lists that workspace's keys (Studio: its table and
//                     the timeline keys) and the global ones
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
  /** A short TEST CONTEXT measurement in MEASURE, run to its end; resolves to its state. */
  complete: async (page) => {
    await H.navTo(page, 'measure');
    await page.evaluate((values) => {
      const m = window.OSCILLA.measure;
      m.useLoopback({ type: 'biquad', filter: 'lowpass', frequency: 2000, Q: Math.SQRT1_2 });
      m.setValues(values);
    }, SHORT);
    await page.click('#osc-measure-primary'); // Check setup
    await page.waitForFunction(() => ['READY', 'INVALID', 'ERROR']
      .includes(window.OSCILLA.measure.state), null, { timeout: RUN_MS, polling: 50 });
    await page.click('#osc-measure-primary'); // Start measurement
    await page.waitForFunction(() => ['COMPLETE', 'INVALID', 'ERROR', 'ABORTED']
      .includes(window.OSCILLA.measure.state), null, { timeout: RUN_MS, polling: 50 });
    await H.frames(page);
    return page.evaluate(() => window.OSCILLA.measure.state);
  },
  save: async (page) => {
    await page.click('#osc-measure-save');
    await page.waitForFunction(() => window.OSCILLA.app.meas.saved
      && !window.OSCILLA.app.meas.saving, null, { timeout: 10000 });
    await H.frames(page);
  },
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

  def('open-every-workspace', async (ctx) => {
    // A reload or a shared address opens each workspace as a switch would: the heading shown,
    // the title, and what entering it loads (the Experiments list).
    const ids = ['playground', 'measure', 'experiments', 'analyzer', 'filter', 'compare',
      'synthesis', 'sequencer', 'presets', 'learn', 'studio', 'about'];
    const rows = [];
    for (const ws of ids) {
      const page = await H.open(ctx, `${ctx.baseUrl}#m=${ws}`);
      const st = await H.state(page);
      const extra = await H.until(() => page.evaluate(() => ({
        title: document.title, loaded: window.OSCILLA.app.exps.loaded })),
      (x) => ws !== 'experiments' || x.loaded, 5000);
      rows.push({ ws, workspace: st.workspace, dataMode: st.dataMode, ...extra });
      await page.close();
    }
    const bad = rows.filter((r) => r.workspace !== r.ws || r.dataMode !== r.ws
      || (r.ws === 'experiments' && !r.loaded) || (r.ws === 'about' && !/About/.test(r.title)));
    return { ok: bad.length === 0, bad };
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

  def('guard-saved-metadata', async (ctx) => {
    // After a save: a name or notes typed and not stored yet, a failed "Update name and notes",
    // and a rename being typed in Experiments each arm the guard until stored or dropped.
    const page = await H.open(ctx, ctx.baseUrl);
    const runState = await H.complete(page);
    if (runState !== 'COMPLETE') return { ok: false, failed: ['run'], runState };
    await H.save(page);
    const saved = await H.state(page);
    await page.fill('#osc-m-name', 'Navigation gate renamed');
    await H.frames(page);
    const typed = await H.state(page);
    const badge = await page.evaluate(() => {
      const el = document.querySelector('[data-osc="measure.unsaved"]');
      return el.getClientRects().length > 0 ? el.textContent.trim() : null;
    });
    await page.click('#osc-measure-save'); // Update name and notes
    await H.until(() => H.state(page), (s) => !s.armed, 5000);
    const updated = await H.state(page);
    // A failed update: the run stays stored, the edit stays pending.
    await page.evaluate(() => {
      const a = window.OSCILLA.app;
      window.__oscAnnotate = a.experimentsAnnotate;
      a.experimentsAnnotate = () => Promise.reject(new Error('navigation gate: refused'));
    });
    await page.fill('#osc-m-notes', 'notes typed after the save');
    await page.click('#osc-measure-save');
    await page.waitForFunction(() => !window.OSCILLA.app.meas.saving);
    await H.frames(page);
    const failedUpdate = await H.state(page);
    await page.evaluate(() => {
      const a = window.OSCILLA.app;
      a.experimentsAnnotate = window.__oscAnnotate;
      a.meas.notes = '';
      a.alerts = [];
    });
    await H.frames(page);
    const dropped = await H.state(page);
    // A rename being typed in Experiments.
    await H.navTo(page, 'experiments');
    await H.until(() => page.evaluate(() => window.OSCILLA.app.exps.rows.length), (n) => n > 0,
      5000);
    await page.evaluate(() => {
      const a = window.OSCILLA.app;
      a.experimentsAskRename(a.exps.rows[0]);
    });
    await page.fill('#osc-exp-rename-name', 'A name being typed');
    await H.frames(page);
    const renaming = await H.state(page);
    await page.keyboard.press('Escape');
    await H.frames(page);
    const cancelled = await H.state(page);
    await page.close();
    const has = (s, re) => s.lost.some((x) => re.test(x));
    return { ...H.verdict({
      savedClean: !saved.armed && saved.listeners === 0,
      typedArmed: typed.armed && typed.listeners === 1 && has(typed, /^measure: A name or notes/)
        && badge === 'unsaved name or notes',
      updatedClean: !updated.armed && updated.listeners === 0,
      failedStaysArmed: failedUpdate.armed && has(failedUpdate, /^measure: A name or notes/)
        && failedUpdate.alerts.includes('Experiment name and notes not updated'),
      droppedClean: !dropped.armed,
      renameArmed: renaming.armed && has(renaming, /^experiments: A rename being typed$/),
      renameCancelled: !cancelled.armed && cancelled.listeners === 0,
    }), saved: saved.lost, typed: typed.lost, badge, failedUpdate: failedUpdate.lost,
    renaming: renaming.lost, cancelled: cancelled.lost };
  });

  def('guard-memory-store', async (ctx) => {
    // No IndexedDB (blocked site data, some file:// pages): a saved experiment and a saved
    // Studio project live in page memory only, so a reload would lose them.
    const context = await ctx.browser.newContext({ viewport: { width: 1536, height: 1024 },
      reducedMotion: 'reduce' });
    await context.addInitScript(beforeUnloadProbe);
    await context.addInitScript(() => {
      IDBFactory.prototype.open = function refusedOpen() {
        throw new DOMException('The operation is insecure.', 'SecurityError');
      };
    });
    const mctx = { ...ctx, context };
    try {
      const page = await H.open(mctx, ctx.baseUrl);
      const runState = await H.complete(page);
      if (runState !== 'COMPLETE') return { ok: false, failed: ['run'], runState };
      await H.save(page);
      const saved = await H.state(page);
      const persistent = await page.evaluate(() => window.OSCILLA.app.exps.persistent);
      const savedReload = await H.reload(page);
      await H.navTo(page, 'studio');
      await page.evaluate(() => window.OSCILLA.app.studioSave());
      await H.until(() => H.state(page), (s) => s.lost.some((x) => /^studio: /.test(x)));
      const studio = await H.state(page);
      const studioPersistent = await page.evaluate(() => window.OSCILLA.app.studio.persistent);
      return { ...H.verdict({
        memoryFallback: persistent === false && studioPersistent === false,
        experimentHeld: saved.armed && saved.listeners === 1
          && saved.lost.includes('experiments: 1 experiment kept in page memory only'),
        reloadAsks: savedReload.dialog === 'beforeunload' && savedReload.stayed,
        studioHeld: !studio.studioDirty && studio.lost.includes(
          'studio: 1 Studio project or patch kept in page memory only'),
      }), saved: saved.lost, studio: studio.lost, savedReload };
    } finally {
      await Promise.race([context.close().catch(() => {}), sleep(5000)]);
    }
  });

  def('refused-link-not-in-history', async (ctx) => {
    // A refused link changes nothing, and nothing brings it back: not Back, not a reload.
    const bad = Buffer.from(JSON.stringify({ v: 1, f1: -1 })).toString('base64url');
    const page = await H.open(ctx, ctx.baseUrl);
    const out = {};
    for (const [key, hash] of [['studio', 'm=studio&st=no-such-template'], ['recipe',
      `mr=${bad}`]]) {
      await page.evaluate((h) => { window.location.hash = h; }, hash);
      await H.until(() => H.state(page), (s) => s.alerts.some((t) => /not applied/.test(t)));
      const refused = await H.state(page);
      await page.evaluate(() => { window.OSCILLA.app.alerts = []; });
      await H.navTo(page, 'measure');
      const back = await H.traverse(page, 'back');
      out[key] = { refused, back };
      if (back.left) break;
      await H.navTo(page, 'playground');
    }
    await page.close();
    // At load: the refused address is replaced too.
    const p2 = await H.open(ctx, `${ctx.baseUrl}#m=studio&st=no-such-template`);
    const loaded = await H.state(p2);
    await H.navTo(p2, 'measure');
    const loadBack = await H.traverse(p2, 'back');
    await p2.close();
    const clean = (s) => !!s && !s.left && s.workspace === 'playground'
      && !/st=|mr=/.test(s.hash) && H.params(s.hash).m === 'playground';
    return { ...H.verdict({
      studioRefused: !!out.studio && out.studio.refused.workspace === 'playground'
        && clean(out.studio.refused),
      studioNotBack: !!out.studio && clean(out.studio.back),
      recipeNotBack: !!out.recipe && clean(out.recipe.refused) && clean(out.recipe.back),
      loadReplaced: clean(loaded) && clean(loadBack),
    }), out, loaded: loaded.hash, loadBack };
  });

  def('nav-links', async (ctx) => {
    // Each nav item's href is its workspace's address: opened in a new tab it lands there, and
    // a modified click is left to the browser (a new tab), not taken by the in-page router.
    const page = await H.open(ctx, ctx.baseUrl);
    const links = await page.evaluate(() => [...document.querySelectorAll('[data-osc^="nav."]')]
      .filter((a) => a.tagName === 'A').map((a) => ({ id: a.dataset.osc.slice(4),
        href: a.getAttribute('href') })));
    const modified = await page.evaluate(() => {
      const a = document.querySelector('[data-osc="nav.measure"]');
      let prevented = null;
      const last = (e) => { prevented = e.defaultPrevented; e.preventDefault(); };
      window.addEventListener('click', last);
      a.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, metaKey: true,
        ctrlKey: true }));
      window.removeEventListener('click', last);
      return { prevented, workspace: window.OSCILLA.app.workspace };
    });
    await page.close();
    const landed = [];
    for (const l of links) {
      const p = await H.open(ctx, `${ctx.baseUrl}${l.href}`);
      landed.push({ ...l, workspace: (await H.state(p)).workspace });
      await p.close();
    }
    return { ...H.verdict({
      twelve: links.length === 12,
      hrefs: links.every((l) => l.href === `#m=${l.id}`),
      landed: landed.every((l) => l.workspace === l.id),
      modifiedLeftToBrowser: modified.prevented === false && modified.workspace === 'playground',
    }), links: landed.filter((l) => l.workspace !== l.id), modified };
  });

  def('anchor', async (ctx) => {
    // The skip link moves focus without a fragment navigation: no history entry, and the address
    // keeps naming the workspace.
    const page = await H.open(ctx, ctx.baseUrl);
    await H.navTo(page, 'measure');
    const before = await H.state(page);
    await page.focus('.osc-skip');
    await page.keyboard.press('Enter');
    await H.frames(page);
    await sleep(150);
    const after = await H.state(page);
    await page.close();
    return { ...H.verdict({
      addressKept: after.hash === before.hash && after.workspace === 'measure',
      noEntry: after.length === before.length,
      focused: after.focus === 'osc-main',
    }), before: { hash: before.hash, length: before.length },
    after: { hash: after.hash, length: after.length, focus: after.focus } };
  });

  // W5 / ADR 0049: what Space (nothing focused) starts in each workspace.
  const SPACE_EXPECTED = { playground: 'instrument', measure: 'none', experiments: 'none',
    analyzer: 'instrument', filter: 'instrument', compare: 'instrument', synthesis: 'instrument',
    sequencer: 'instrument', presets: 'none', learn: 'none', studio: 'studio', about: 'none' };
  const sounding = (page) => page.evaluate(() => ({ instrument: !!window.OSCILLA.app.playing,
    studio: !!window.OSCILLA.app.studio.playing }));
  const heardOf = (v) => (v.instrument && v.studio ? 'both'
    : v.instrument ? 'instrument' : v.studio ? 'studio' : 'none');
  /** Press Space at `focus` ('body' or a selector) and report what started, then stop it. */
  const pressSpace = async (page, focus) => {
    if (focus === 'body') {
      await page.evaluate(() => {
        const a = document.activeElement;
        if (a && a !== document.body && a.blur) a.blur();
      });
    } else {
      await page.focus(focus);
    }
    await page.keyboard.down(' ');
    const v = await H.until(() => sounding(page), (x) => x.instrument || x.studio, 1200);
    await page.keyboard.up(' ');
    await page.evaluate(() => {
      const a = window.OSCILLA.app;
      a.stopNow();
      if (a.studio.playing) a.studioStop();
    });
    await H.until(() => sounding(page), (x) => !x.instrument && !x.studio, 3000);
    return { heard: heardOf(v), focus: await page.evaluate(() => {
      const a = document.activeElement;
      return a ? (a.dataset.osc || a.id || a.tagName) : null;
    }) };
  };

  def('space-one-meaning', async (ctx) => {
    const page = await H.open(ctx, ctx.baseUrl);
    // Releases are immediate; continuous playback only keeps a slow engine from hitting the
    // hard limit inside the wait.
    await page.evaluate(() => window.OSCILLA.app.setContinuous(true));
    const got = {};
    for (const ws of Object.keys(SPACE_EXPECTED)) {
      await H.navTo(page, ws);
      await sleep(100);
      got[ws] = (await pressSpace(page, 'body')).heard;
    }
    await H.navTo(page, 'studio');
    const onLink = await pressSpace(page, '[data-osc="nav.studio"]');
    await page.evaluate(() => window.OSCILLA.app.setContinuous(false));
    await page.close();
    const wrong = Object.keys(SPACE_EXPECTED).filter((ws) => got[ws] !== SPACE_EXPECTED[ws]);
    return { ...H.verdict({ everyWorkspace: wrong.length === 0,
      focusedLinkKeepsSpace: onLink.heard === 'none' }), wrong, got, onLink };
  });

  def('one-shortcut-dialog', async (ctx) => {
    const page = await H.open(ctx, ctx.baseUrl);
    const lists = await page.evaluate(() => [...document.querySelectorAll('dialog')]
      .filter((d) => d.querySelector('.osc-shortcuts')).map((d) => d.id));
    const read = () => page.evaluate(() => {
      const open = [...document.querySelectorAll('dialog[open]')];
      const d = open[0];
      const text = (sel) => {
        const el = d && d.querySelector(sel);
        return el ? el.textContent.replace(/\s+/g, ' ').trim() : null;
      };
      return { open: open.map((x) => x.id), title: text('[data-osc="help.title"]'),
        space: text('[data-osc="help.space"] dd'),
        rows: d ? [...d.querySelectorAll('[data-osc="help.workspace"] [data-osc-shortcut]')]
          .map((x) => x.dataset.oscShortcut) : [],
        global: d ? d.querySelectorAll('[data-osc="help.global"] [data-osc-shortcut]').length
          : 0,
        timeline: text('[data-osc="help.timeline"]') };
    });
    const openWith = async (sel, menu) => {
      if (menu) await page.click(menu);
      await page.click(sel);
      await H.until(() => page.evaluate(() => !!document.querySelector('dialog[open]')), (v) => v);
      await H.frames(page);
      const r = await read();
      await page.keyboard.press('Escape');
      await H.until(() => page.evaluate(() => !document.querySelector('dialog[open]')), (v) => v);
      return r;
    };
    const play = await openWith('[data-osc="header.help"]');
    await H.navTo(page, 'studio');
    const studio = await openWith('[data-osc="studio.keys"]');
    const studioHelp = await openWith('[data-osc="header.help"]');
    await H.navTo(page, 'measure');
    const measure = await openWith('[data-osc="header.shortcuts"]', '[data-osc="header.overflow"]');
    await page.close();
    const same = [play, studio, studioHelp, measure].every((r) => r.open.length === 1
      && r.open[0] === 'osc-dlg-help' && r.global > 0);
    return { ...H.verdict({
      oneDialog: lists.length === 1 && lists[0] === 'osc-dlg-help',
      sameDialog: same,
      playground: play.title === 'Playground' && /^Hold to play/.test(play.space || '')
        && play.rows.includes('trigger') && !play.rows.includes('quick-add')
        && play.timeline === null,
      studio: studio.title === 'Studio' && studio.space === 'Play / stop the Studio transport'
        && ['quick-add', 'connect', 'find', 'undo'].every((k) => studio.rows.includes(k))
        && !studio.rows.includes('trigger') && /^Space play or stop/.test(studio.timeline || ''),
      studioViaHelp: JSON.stringify(studioHelp) === JSON.stringify(studio),
      measure: measure.title === 'Measure' && /^Nothing/.test(measure.space || '')
        && measure.rows.includes('measure-abort') && !measure.rows.includes('trigger')
        && !measure.rows.includes('quick-add'),
    }), lists, play, studio, measure };
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
