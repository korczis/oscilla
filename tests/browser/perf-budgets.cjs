#!/usr/bin/env node
// OSCILLA startup budget and large-library budgets (ledger P2 "no startup budget or
// large-library fixture") on the built dist/index.html from file:// in chromium, firefox and
// webkit. Budgets: tests/browser/fixtures/perf-budgets.json (medians, ms, per browser); the
// measurements and the reasons: docs/v4/performance.md.
//
//   node tests/browser/perf-budgets.cjs [--dist dist/index.html] [--browsers chromium,...]
//        [--only name1,name2] [--samples 7] [--library-samples 5] [--cache <dir>]
//        [--measure-only] [--json out.json]      (or OSC_BROWSERS=...)
//
// "Interactive" (the startup metric): the User Timing mark `oscilla:ready` that main.js sets in
// the same statement block as html[data-ready="true"]: Alpine has started, the instrument
// component has initialised, and its first $nextTick has mounted the visualizer, the labs and
// the MEASURE and Experiments charts. Its startTime is milliseconds since navigation start.
//
// Checks (asserted):
//   ready-mark          a fresh page records exactly one `oscilla:ready` mark, at the moment
//                       html[data-ready] turns true (a MutationObserver installed before any
//                       page script reports the attribute after the mark and within
//                       READY_GAP_MS of it); in that observer callback, the same task as the
//                       mark, Hold to Play and the frequency slider are enabled and
//                       hit-testable; once the page has reported ready (a later evaluate) an
//                       input on the slider updates the readout through Alpine
//   startup             median of --samples fresh contexts (empty storage; one warm-up context
//                       first, reported, not counted) of the mark's startTime <= budget
//                       `startup`
//   library-seed        the large library (fixtures/large-library.mjs: 500 experiments, 50
//                       definitions, 20 Studio projects, built by the app's own code) is
//                       written into the IndexedDB stores the app created, and the app's own
//                       store lists 500 experiments, 50 definitions and 20 Studio projects
//   startup-library     median of --samples fresh pages over the seeded database of the mark's
//                       startTime <= budget `startupLibrary` (a large library must not slow
//                       the start)
//   experiments-list    on --library-samples fresh pages: click Experiments in the navigation →
//                       the 500 experiment rows and 50 definition rows are in the DOM (the
//                       first animation-frame callback that finds them; see "Where a click's
//                       time ends"); median <= budget `experimentsList`
//   experiment-detail   on the same pages, click Open on an experiment not read before (a
//                       different one per page) → the detail heading names it (the app's store
//                       reads and re-validates the record, result hash included); median <=
//                       budget `experimentDetail`. Reported beside it, not budgeted: the store's
//                       get() of another unread experiment, and the bare IndexedDB read of a
//                       third (the difference is validation and the result hash)
//   compare             select two experiments of one definition (two different engine
//                       measurements), click Compare selected → the compare panel shows 2
//                       entries and its summary; median <= budget `compare`. Selecting (each
//                       click replaces every row object, so the bindings of all 500 rows are
//                       evaluated again; no row element changes) is reported, not budgeted
//   no-console-errors
//
// Where a click's time ends: in the first requestAnimationFrame callback in which the
// condition holds, which runs before that frame's style, layout and paint. The numbers
// therefore leave out the layout and paint of the frame that shows the result.
//
// --only takes names from the list above; a name that is not a check is refused (exit 2), so
// a misspelt selection cannot pass. --measure-only reports every number and asserts every
// check except the budgets (to measure new budgets; fixtures/perf-sessions.mjs records the
// sessions and derives the budgets). Not in release-gate: docs/v4/performance.md says why.
// The selectors, ids and app state the suite reads are fixtures/perf-dom.json, which
// tests/unit/v4-performance-docs.test.mjs holds against src/.
'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const suite = require('./lib/suite.cjs');
const { until, bounded } = require('./lib/wait.cjs');

const argv = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};
const flag = (name) => argv.includes(`--${name}`);
const ROOT = path.resolve(__dirname, '..', '..');
const DIST = path.resolve(arg('dist', path.join(ROOT, 'dist', 'index.html')));
const RUN = suite.open({ name: 'perf-budgets', browsers: arg('browsers') });
const playwright = RUN.playwright;
const BROWSERS = RUN.browsers;
const ONLY = flag('only') ? new Set(arg('only', '').split(',').map((n) => n.trim())) : null;
const SAMPLES = Number(arg('samples', '7'));
const LIBRARY_SAMPLES = Number(arg('library-samples', '5'));
const CACHE = path.resolve(arg('cache', path.join(os.tmpdir(), 'oscilla-perf-cache')));
const MEASURE_ONLY = flag('measure-only');
const JSON_OUT = arg('json', '');
const BUDGET_FILE = path.join(__dirname, 'fixtures', 'perf-budgets.json');
// Measuring the first budgets needs no budget file; asserting them does.
const BUDGETS = MEASURE_ONLY && !fs.existsSync(BUDGET_FILE) ? { budgets: {} }
  : JSON.parse(fs.readFileSync(BUDGET_FILE, 'utf8'));
const LAUNCH = {
  chromium: { args: ['--autoplay-policy=no-user-gesture-required'] },
  firefox: { firefoxUserPrefs: { 'media.autoplay.default': 0, 'media.autoplay.blocking_policy': 0,
    'media.autoplay.block-webaudio': false } },
  webkit: {},
};
const VIEWPORT = { width: 1536, height: 1024 };
const READY_MARK = 'oscilla:ready';
// Every selector, element id and field of the app's Experiments state the suite reads.
const DOM = require('./fixtures/perf-dom.json');
const sel = (name) => {
  if (!DOM.osc[name]) throw new Error(`perf-dom.json has no selector ${name}`);
  return `[${DOM.attribute}="${DOM.osc[name]}"]`;
};
const DB_NAME = 'oscilla-experiments';
const SEED_CHUNK = 25; // experiments per page.evaluate (about 1 MB of JSON without the IR text)
// Wall-clock deadlines (project.bounded-test-timing). They bound a stalled page; none of them
// is a budget.
const PAGE_MS = 60000;     // a page reaches html[data-ready] (and Studio its store)
const ACTION_MS = 60000;   // one click reaches the state its check reads
const CLOSE_MS = 30000;    // a context or browser closes
const CHECK_MS = 900000;   // one whole check
// The mutation observer is a microtask queued by the attribute write that follows the mark, so
// the gap is the rest of that task. One 60 Hz frame is the allowance for it.
const READY_GAP_MS = 1000 / 60;

// ------------------------------------------------------------------------------ statistics
const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const round = (x) => Math.round(x * 10) / 10;
const stats = (xs) => ({ median: round(median(xs)), min: round(Math.min(...xs)),
  max: round(Math.max(...xs)), samples: xs.map(round) });
/** The verdict of a budgeted series: { ok, budget, median, min, max, samples }. */
function budgeted(key, browserName, xs, extra = {}) {
  const budget = BUDGETS.budgets[key] && BUDGETS.budgets[key][browserName];
  const s = stats(xs);
  const within = typeof budget === 'number' && s.median <= budget;
  return { ok: MEASURE_ONLY || within, budget: budget ?? null, ...s,
    ...(MEASURE_ONLY ? { withinBudget: within } : {}), ...extra };
}

// ------------------------------------------------------------------------------ page side
/**
 * Init script: performance.now() at the moment html[data-ready] turns "true" (a
 * MutationObserver on the document, installed before any page script runs). With `controls`
 * ({ hold, slider }: element ids) the same callback, which is a microtask of the task that
 * set the mark, also records whether those controls are enabled and hit-testable; that reads
 * layout, so only the ready-mark check asks for it.
 */
function readyObserver(controls) {
  window.__oscReadyAt = null;
  window.__oscReadyControls = null;
  const seen = () => document.documentElement
    && document.documentElement.getAttribute('data-ready') === 'true';
  const hit = (el) => {
    if (!el) return false;
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) return false;
    const at = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return !!at && (at === el || el.contains(at));
  };
  const mo = new MutationObserver(() => {
    if (window.__oscReadyAt === null && seen()) {
      window.__oscReadyAt = performance.now();
      mo.disconnect();
      if (controls) {
        const hold = document.getElementById(controls.hold);
        const slider = document.getElementById(controls.slider);
        window.__oscReadyControls = { holdEnabled: !!hold && !hold.disabled, holdHit: hit(hold),
          sliderEnabled: !!slider && !slider.disabled, sliderHit: hit(slider) };
      }
    }
  });
  mo.observe(document, { subtree: true, attributes: true, attributeFilter: ['data-ready'] });
}

/** Startup facts of a ready page. */
function startupFacts(markName) {
  const marks = performance.getEntriesByName(markName, 'mark');
  const nav = performance.getEntriesByType('navigation')[0] || null;
  return {
    marks: marks.length,
    mark: marks.length ? marks[0].startTime : null,
    observed: window.__oscReadyAt,
    controlsAtMark: window.__oscReadyControls,
    dcl: nav ? nav.domContentLoadedEventEnd : null,
    load: nav ? nav.loadEventEnd : null,
  };
}

/**
 * Does the Playground answer now that the page has reported ready (a later task than the
 * mark)? Enabled, hit-testable controls; a slider input reaches the readout through Alpine.
 */
function playgroundAnswers(ids) {
  const hit = (el) => {
    if (!el) return false;
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) return false;
    const at = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return !!at && (at === el || el.contains(at));
  };
  const hold = document.getElementById(ids.holdPlay);
  const slider = document.getElementById(ids.freqSlider);
  const out = document.getElementById(ids.freqValue);
  const before = out ? out.textContent : null;
  if (slider) {
    slider.value = Number(slider.value) > 500 ? '300' : '700';
    slider.dispatchEvent(new Event('input', { bubbles: true }));
  }
  return new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => {
      resolve({ holdEnabled: !!hold && !hold.disabled, holdHit: hit(hold),
        sliderEnabled: !!slider && !slider.disabled, sliderHit: hit(slider),
        readoutBefore: before, readoutAfter: out ? out.textContent : null,
        changed: !!out && out.textContent !== before });
    }));
  });
}

/**
 * Click `selector` and resolve with the ms until the first animation frame in which `cond`
 * (the source of a function body over `arg`) holds; { ms: null, error } after `timeoutMs` of
 * the page's own clock.
 */
function clickUntil({ selector, cond, arg, timeoutMs }) {
  const test = new Function('arg', cond); // eslint-disable-line no-new-func
  const el = document.querySelector(selector);
  if (!el) return Promise.resolve({ ms: null, error: `no ${selector}` });
  const t0 = performance.now();
  el.click();
  return new Promise((resolve) => {
    const tick = () => {
      let ok = false;
      try { ok = !!test(arg); } catch (e) { ok = false; }
      const now = performance.now();
      if (ok) resolve({ ms: now - t0 });
      else if (now - t0 > timeoutMs) resolve({ ms: null, error: `timeout ${timeoutMs} ms` });
      else requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

/**
 * Two reads of stored experiments nothing has read on this page: the app store's get() of
 * `viaStore` (IndexedDB read, validation, result hash) and the bare IndexedDB read of `raw`.
 */
async function readTimes({ db: name, viaStore, raw }) {
  const t0 = performance.now();
  const e = await window.OSCILLA.experiments.store().get(viaStore);
  const storeMs = performance.now() - t0;
  const rawRead = await new Promise((resolve, reject) => {
    const req = indexedDB.open(name);
    req.onerror = () => reject(new Error(`open: ${req.error && req.error.message}`));
    req.onsuccess = () => {
      const db = req.result;
      const t1 = performance.now();
      const get = db.transaction(['experiments'], 'readonly').objectStore('experiments').get(raw);
      get.onerror = () => {
        db.close();
        reject(new Error(`get: ${get.error && get.error.message}`));
      };
      get.onsuccess = () => {
        const ms = performance.now() - t1;
        const doc = get.result;
        db.close();
        resolve({ ms, id: doc ? doc.experimentId : null });
      };
    };
  });
  return { storeMs, storeId: e ? e.experimentId : null, rawMs: rawRead.ms, rawId: rawRead.id };
}

/** Write one chunk of the library into the app's database (the stores it created). */
function seedChunk({ db: name, experiments, definitions, studio }) {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(name);
    req.onerror = () => reject(new Error(`open: ${req.error && req.error.message}`));
    req.onsuccess = () => {
      const db = req.result;
      const want = ['experiments', 'summaries', 'definitions', 'studio', 'studioSummaries'];
      const missing = want.filter((s) => !db.objectStoreNames.contains(s));
      if (missing.length) {
        db.close();
        reject(new Error(`the app's database lacks ${missing.join(', ')} (version ${db.version})`));
        return;
      }
      const tx = db.transaction(want, 'readwrite');
      for (const x of experiments) {
        const { doc, summary } = JSON.parse(x.json);
        if (x.ir !== null) doc.results.ir.samples.data = window.__oscIrs[x.ir];
        tx.objectStore('experiments').put(doc);
        tx.objectStore('summaries').put(summary);
      }
      for (const d of definitions) tx.objectStore('definitions').put(d);
      for (const s of studio) {
        tx.objectStore('studio').put(s.value);
        tx.objectStore('studioSummaries').put(s.summary);
      }
      tx.oncomplete = () => { db.close(); resolve(experiments.length); };
      const refuse = (how) => () => {
        db.close();
        reject(new Error(`${how}: ${tx.error && tx.error.message}`));
      };
      tx.onerror = refuse('write');
      tx.onabort = refuse('abort');
    };
  });
}

// ------------------------------------------------------------------------------ node side
async function readyPage(context, url, errors, { studio = true } = {}) {
  const page = await context.newPage();
  page.setDefaultTimeout(PAGE_MS);
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  await page.goto(url, { waitUntil: 'load', timeout: PAGE_MS });
  await page.waitForSelector('html[data-ready="true"]', { timeout: PAGE_MS });
  if (studio) {
    await page.waitForFunction(() => !!(window.OSCILLA.app && window.OSCILLA.app.studio.ready),
      null, { timeout: PAGE_MS });
  }
  return page;
}

/** Close without letting a hung close hold the suite; a failed close fails no check. */
const closeQuietly = (target, what) => bounded(target.close(), { ms: CLOSE_MS, what })
  .catch((e) => console.log(`  (${what}: ${String(e.message || e).split('\n')[0]})`));

// Two animation frames: the page has painted what the last step changed, so the next click is
// timed from an idle page. A frame boundary, not a duration.
const settle = (page) => page.evaluate(() => new Promise((r) => {
  requestAnimationFrame(() => requestAnimationFrame(() => r()));
}));

async function freshStartup(browser, url, errors) {
  const context = await browser.newContext({ viewport: VIEWPORT, reducedMotion: 'reduce' });
  await context.addInitScript(readyObserver);
  try {
    const page = await readyPage(context, url, errors, { studio: false });
    return await page.evaluate(startupFacts, READY_MARK);
  } finally {
    await closeQuietly(context, 'closing a startup context');
  }
}

let libraryPromise = null;
/** The library, built once per process (and cached on disk by its input digest). */
function library() {
  if (!libraryPromise) {
    libraryPromise = import(pathToFileURL(path.join(__dirname, 'fixtures', 'large-library.mjs'))
      .href).then((m) => m.buildLargeLibrary({ cacheDir: CACHE, log: (s) => console.log(s) }));
  }
  return libraryPromise;
}

function defineChecks() {
  const checks = [];
  const def = (name, fn) => checks.push({ name, fn });

  def('ready-mark', async (ctx) => {
    const context = await ctx.browser.newContext({ viewport: VIEWPORT, reducedMotion: 'reduce' });
    await context.addInitScript(readyObserver,
      { hold: DOM.ids.holdPlay, slider: DOM.ids.freqSlider });
    try {
      const page = await readyPage(context, ctx.url, ctx.errors, { studio: false });
      const f = await page.evaluate(startupFacts, READY_MARK);
      const answers = await page.evaluate(playgroundAnswers, DOM.ids);
      const gap = f.mark !== null && f.observed !== null ? f.observed - f.mark : null;
      const at = f.controlsAtMark;
      return { ok: f.marks === 1 && gap !== null && gap >= 0 && gap <= READY_GAP_MS
        && !!at && at.holdEnabled && at.holdHit && at.sliderEnabled && at.sliderHit
        && answers.holdEnabled && answers.holdHit && answers.sliderEnabled && answers.sliderHit
        && answers.changed, facts: { ...f, gap }, answers };
    } finally {
      await closeQuietly(context, 'closing the ready-mark context');
    }
  });

  def('startup', async (ctx) => {
    const warm = await freshStartup(ctx.browser, ctx.url, ctx.errors);
    const facts = [];
    for (let i = 0; i < SAMPLES; i++) {
      facts.push(await freshStartup(ctx.browser, ctx.url, ctx.errors));
    }
    if (facts.some((f) => f.mark === null)) {
      return { ok: false, detail: `no ${READY_MARK} mark`, facts };
    }
    return budgeted('startup', ctx.browserName, facts.map((f) => f.mark), {
      warmUp: warm.mark === null ? null : round(warm.mark),
      dclMedian: round(median(facts.map((f) => f.dcl))),
      loadMedian: round(median(facts.map((f) => f.load))) });
  });

  def('library-seed', async (ctx) => {
    const lib = await library();
    ctx.library = lib;
    const t0 = Date.now();
    const page = await readyPage(ctx.libContext, ctx.url, ctx.errors);
    await page.evaluate((irs) => { window.__oscIrs = irs; }, lib.irs);
    await page.evaluate(seedChunk, { db: DB_NAME, experiments: [],
      definitions: lib.definitions, studio: lib.studio });
    for (let i = 0; i < lib.experiments.length; i += SEED_CHUNK) {
      await page.evaluate(seedChunk, { db: DB_NAME, definitions: [], studio: [],
        experiments: lib.experiments.slice(i, i + SEED_CHUNK)
          .map((x) => ({ json: x.json, ir: x.ir })) });
    }
    await page.evaluate(() => { delete window.__oscIrs; });
    const seedMs = Date.now() - t0;
    await page.close();
    // What the app's own store reads back (a fresh page, the store the Experiments workspace
    // and Studio open).
    const check = await readyPage(ctx.libContext, ctx.url, ctx.errors);
    await check.evaluate(() => { window.OSCILLA.app.setWorkspace('experiments'); });
    await until(() => check.evaluate(() => window.OSCILLA.app.exps.loaded === true),
      { ms: ACTION_MS, what: 'library-seed: the Experiments workspace has read its list' });
    const counts = await check.evaluate(async () => {
      const a = window.OSCILLA.app;
      const s = window.OSCILLA.experiments.store();
      const defs = await s.listDefinitions();
      return { kind: s.kind, experiments: (await s.list()).length,
        definitions: defs.definitions.length, unreadable: defs.unreadable.length,
        studio: (await s.listStudio({ kind: 'oscilla-studio' })).length,
        rows: a.exps.rows.length, defRows: a.exps.defs.length };
    });
    await check.close();
    const c = lib.counts;
    return { ok: counts.kind === 'indexeddb' && counts.experiments === c.experiments
      && counts.definitions === c.definitions && counts.unreadable === 0
      && counts.studio === c.studio && counts.rows === c.experiments
      && counts.defRows === c.definitions,
    counts, seedMs, sizes: lib.sizes };
  });

  def('startup-library', async (ctx) => {
    if (!ctx.library) return { ok: false, detail: 'library-seed did not run' };
    const facts = [];
    for (let i = 0; i < SAMPLES; i++) {
      const page = await readyPage(ctx.libContext, ctx.url, ctx.errors, { studio: false });
      facts.push(await page.evaluate(startupFacts, READY_MARK));
      await page.close();
    }
    if (facts.some((f) => f.mark === null)) {
      return { ok: false, detail: `no ${READY_MARK} mark`, facts };
    }
    return budgeted('startupLibrary', ctx.browserName, facts.map((f) => f.mark));
  });

  // experiments-list, experiment-detail and compare share their pages: one sample of each per
  // page, each experiment read for the first time on that page.
  const librarySamples = async (ctx) => {
    if (ctx.librarySamples) return ctx.librarySamples;
    if (!ctx.library) throw new Error('library-seed did not run');
    const lib = ctx.library;
    const out = { list: [], detail: [], compare: [], select: [], reads: [] };
    const taken = new Set([...lib.compare, lib.baselineId]);
    const unread = lib.experiments.map((x) => x.id).filter((id) => !taken.has(id));
    // Spread over the library (different recipes, so different record sizes).
    const pick = (offset) => unread.filter((id, i) => i % 97 === offset).slice(0, 5);
    const detailIds = pick(11);
    const storeIds = pick(29);
    const rawIds = pick(53);
    for (let i = 0; i < LIBRARY_SAMPLES; i++) {
      const page = await readyPage(ctx.libContext, ctx.url, ctx.errors);
      await settle(page);
      out.list.push(await page.evaluate(clickUntil, { selector: sel('navExperiments'),
        timeoutMs: ACTION_MS, arg: { n: lib.counts.experiments, defs: lib.counts.definitions,
          row: sel('expRow'), defRow: sel('defRow') },
        cond: 'return document.querySelectorAll(arg.row).length === arg.n'
          + ' && document.querySelectorAll(arg.defRow).length === arg.defs;' }));
      await settle(page);
      const id = detailIds[i % detailIds.length];
      const { name, sizeBytes } = lib.experiments.find((x) => x.id === id);
      const detail = await page.evaluate(clickUntil, {
        selector: `${sel('expRow')}[data-id="${id}"] ${sel('expOpen')}`,
        timeoutMs: ACTION_MS, arg: { id, name, title: DOM.ids.detailTitle },
        cond: 'const d = window.OSCILLA.app.exps.detail;'
          + ' const h = document.getElementById(arg.title);'
          + ' return !!d && d.id === arg.id && !!h && h.textContent === arg.name;' });
      out.detail.push({ ...detail, sizeBytes });
      await settle(page);
      for (const cid of lib.compare) {
        out.select.push(await page.evaluate(clickUntil, {
          selector: `${sel('expRow')}[data-id="${cid}"] ${sel('expSelect')}`,
          timeoutMs: ACTION_MS, arg: cid,
          cond: 'return window.OSCILLA.app.exps.selected.includes(arg);' }));
      }
      await settle(page);
      out.compare.push(await page.evaluate(clickUntil, { selector: sel('expCompare'),
        timeoutMs: ACTION_MS,
        arg: { panel: DOM.ids.comparePanel, summary: sel('compareSummary') },
        cond: 'const c = window.OSCILLA.app.exps.compare;'
          + ' const p = document.getElementById(arg.panel);'
          + ' const s = document.querySelector(arg.summary);'
          + ' return !!c && c.entries.length === 2 && !!p && p.offsetParent !== null'
          + ' && !!s && s.textContent.trim().length > 0;' }));
      await settle(page);
      const viaStore = storeIds[i % storeIds.length];
      const raw = rawIds[i % rawIds.length];
      const read = await page.evaluate(readTimes, { db: DB_NAME, viaStore, raw });
      out.reads.push({ ...read, ok: read.storeId === viaStore && read.rawId === raw,
        storeBytes: lib.experiments.find((x) => x.id === viaStore).sizeBytes,
        rawBytes: lib.experiments.find((x) => x.id === raw).sizeBytes });
      await page.close();
    }
    ctx.librarySamples = out;
    return out;
  };
  const series = (key, budgetKey) => async (ctx) => {
    const s = await librarySamples(ctx);
    const bad = s[key].filter((x) => x.ms === null);
    if (bad.length) return { ok: false, detail: bad.map((x) => x.error).join('; ') };
    let extra = {};
    if (key === 'compare') {
      const unselected = s.select.filter((x) => x.ms === null);
      if (unselected.length) {
        return { ok: false, detail: `select: ${unselected.map((x) => x.error).join('; ')}` };
      }
      extra = { select: stats(s.select.map((x) => x.ms)) };
    }
    if (key === 'detail') {
      if (s.reads.some((x) => !x.ok)) {
        return { ok: false, detail: 'a stored experiment was not read back', reads: s.reads };
      }
      extra = { recordBytes: s.detail.map((x) => x.sizeBytes),
        storeGet: stats(s.reads.map((x) => x.storeMs)),
        storeGetBytes: s.reads.map((x) => x.storeBytes),
        rawGet: stats(s.reads.map((x) => x.rawMs)),
        rawGetBytes: s.reads.map((x) => x.rawBytes) };
    }
    return budgeted(budgetKey, ctx.browserName, s[key].map((x) => x.ms), extra);
  };
  def('experiments-list', series('list', 'experimentsList'));
  def('experiment-detail', series('detail', 'experimentDetail'));
  def('compare', series('compare', 'compare'));

  def('no-console-errors', async (ctx) => ({ ok: ctx.errors.length === 0,
    errors: ctx.errors.slice(0, 8) }));
  return checks;
}

async function runOne(browserName, url) {
  const leg = `${browserName}/file`;
  const browser = await playwright[browserName].launch(LAUNCH[browserName]);
  const libContext = await browser.newContext({ viewport: VIEWPORT, reducedMotion: 'reduce' });
  await libContext.addInitScript(readyObserver);
  const ctx = { browser, browserName, url, libContext, errors: [], library: null };
  const results = {};
  for (const { name, fn } of defineChecks()) {
    if (ONLY && !ONLY.has(name) && name !== 'no-console-errors') continue;
    const t0 = Date.now();
    RUN.tally(leg);
    try {
      const v = await bounded(fn(ctx), { ms: CHECK_MS, what: `${leg} ${name}` });
      results[name] = { ...v, ms: Date.now() - t0 };
    } catch (e) {
      results[name] = { ok: false, detail: String(e.message || e).split('\n')[0],
        ms: Date.now() - t0 };
    }
    const r = results[name];
    const summary = r.median !== undefined ? ` median ${r.median} ms (budget ${r.budget}; `
      + `min ${r.min}, max ${r.max})` : '';
    console.log(`  ${r.ok ? 'ok' : 'x '} ${leg} ${name}${summary} [${(r.ms / 1000)
      .toFixed(1)} s]`);
  }
  await closeQuietly(libContext, `closing the ${browserName} library context`);
  await closeQuietly(browser, `closing ${browserName}`);
  return results;
}

(async () => {
  // Before the load gate and any browser: a selection that names no check proves nothing.
  if (ONLY) {
    const known = defineChecks().map((c) => c.name);
    const unknown = [...ONLY].filter((n) => !known.includes(n));
    if (unknown.length || !ONLY.size) {
      console.error(`[perf-budgets] --only: ${unknown.length
        ? `unknown check(s): ${unknown.map((n) => JSON.stringify(n)).join(', ')}`
        : 'no check named'}; expected ${known.join(', ')}`);
      process.exit(2);
    }
  }
  await RUN.ready();
  if (!fs.existsSync(DIST)) {
    console.error(`missing ${DIST}: run npm run build`);
    process.exit(2);
  }
  const url = pathToFileURL(DIST).href;
  const pw = JSON.parse(fs.readFileSync(path.join(ROOT, 'node_modules', 'playwright',
    'package.json'), 'utf8'));
  const all = { machine: { platform: process.platform, arch: process.arch, cpus: os.cpus().length,
    cpu: os.cpus()[0] && os.cpus()[0].model, loadavgStart: os.loadavg().map(round),
    node: process.version, playwright: pw.version },
  samples: SAMPLES, librarySamples: LIBRARY_SAMPLES, measureOnly: MEASURE_ONLY, legs: {},
  results: {} };
  let failed = 0;
  for (const b of BROWSERS) {
    const t0 = Date.now();
    // The harness gates the start only; the load each leg ran under is part of what it measured.
    const loadStart = round(os.loadavg()[0]);
    const res = await runOne(b, url);
    all.results[b] = res;
    all.legs[b] = { loadStart, loadEnd: round(os.loadavg()[0]), seconds: round((Date.now() - t0)
      / 1000) };
    const names = Object.keys(res);
    const bad = names.filter((n) => !res[n].ok);
    failed += bad.length;
    console.log(`${bad.length ? 'FAIL' : 'PASS'} ${b}/file/perf-budgets: ${names.length
      - bad.length}/${names.length} checks (${all.legs[b].seconds} s, 1-minute load ${
      all.legs[b].loadStart} -> ${all.legs[b].loadEnd})`);
    for (const n of bad) console.log(`   x ${n}: ${JSON.stringify(res[n]).slice(0, 900)}`);
  }
  all.machine.loadavgEnd = os.loadavg().map(round);
  if (JSON_OUT) fs.writeFileSync(JSON_OUT, `${JSON.stringify(all, null, 2)}\n`);
  process.exit(failed ? 1 : 0);
})();
