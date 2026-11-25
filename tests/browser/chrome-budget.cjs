#!/usr/bin/env node
// suite-pace: shared (DOM geometry of fresh pages; no audio and no timing judged)
// The chrome budget of plan issue U131, PR-0 of docs/reconstruction/09-u131-u135-design.md: how
// much of the screen a place's own content gets. For every workspace of the shell registry
// (src/js/ui/shell.js WORKSPACE_IDS) opened fresh at its deep link (#m=<id>) with the safety
// notice dismissed, at every viewport of lib/chrome-budget.cjs VIEWPORTS (the census's: the
// phones with touch, and isMobile where the engine has it), in every selected engine:
//   desktop  the content share, <main>'s client height that no fixed chrome covers over
//            innerHeight, in the state the place opens in and, where the keys' handle folds
//            (data-osc="keyboard.handle"), in the other state after a real click on it;
//   phone    the visible share of the place's primary surface (PRIMARY below, else the
//            registry's phonePrimaryOf, else <main>) in the state the place opens in.
// Each cell's debt, the px below its budget (lib/chrome-budget.cjs budgetOf), is judged
// against tests/browser/chrome-budget-baseline.json, a debt that only falls (scripts/facts.mjs
// reads every *-baseline.json so): a cell whose debt rises, or a new cell over its budget,
// fails; a fall passes and is printed. --update writes the falls (and drops cells no longer
// measured); a rise is written only with --reason "<why, more than 30 characters>", which
// goes into the baseline's raises ledger (tests/unit/chrome-budget.test.mjs judges its history).
//
// Host: the measure is the geometry of fixed chrome (bar heights, the dock's band), which the
// host's fonts move only where a title or a status line wraps. The baseline is recorded on one
// host (its `host`, darwin) and only that host updates it; it judges its own runs exactly and
// every other host's (the linux CI legs) within its tolerancePx, and the run says which.
//
// A cell is read once its workspace is shown, the fonts are loaded and three reads in a row are
// identical, a condition poll with a named wall-clock deadline (tests/browser/lib/wait.cjs).
//
//   node tests/browser/chrome-budget.cjs [--update [--reason "<why>"]] [--dist dist/index.html]
//        [--baseline <file>] [--json <file>: also write every measured cell there]
//        [--browsers chromium,firefox,webkit]   (or OSC_BROWSERS through the harness)
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const suite = require('./lib/suite.cjs');
const { until, bounded } = require('./lib/wait.cjs');
const op = require('./lib/oscilla-page.cjs');
const cb = require('./lib/chrome-budget.cjs');
const { phonePrimaryOf } = require('../../src/js/ui/shell.js');

const argv = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};
const ROOT = path.resolve(__dirname, '..', '..');
const DIST = path.resolve(arg('dist', path.join(ROOT, 'dist', 'index.html')));
const BASELINE = path.resolve(arg('baseline', path.join(__dirname, 'chrome-budget-baseline.json')));
const UPDATE = argv.includes('--update');
const REASON = arg('reason', '');
const JSON_OUT = arg('json', '');
const RUN = suite.open({ name: 'chrome-budget', browsers: arg('browsers') });
const playwright = RUN.playwright;
const BROWSERS = RUN.browsers;
const WORKSPACES = op.WORKSPACES;
const OPEN_MS = 60000;
const SETTLE_MS = 30000;
const STABLE_READS = 3;
const READ_EVERY_MS = 150;
const CLOSE_MS = 10000;
const NOTE = 'The chrome-budget debt of plan issue U131 (PR-0 of '
  + 'docs/reconstruction/09-u131-u135-design.md), written by node tests/browser/chrome-budget.cjs '
  + '--update and judged by the same suite without it (tests/README.md). debt.<engine>/<viewport>/'
  + '<place>/<keys state> = the px by which the place\'s own content (desktop: <main>\'s '
  + 'uncovered client height; phone: the primary surface\'s visible height) falls short of its '
  + 'budget (lib/chrome-budget.cjs budgetOf) on the first screen; 0 meets it. It only falls: a '
  + 'rise is written only by --update --reason, which appends { from, to, reason } to '
  + 'raises.<cell>.';

/** The phone's primary surface where the registry names none: the Synth's view and the
 *  Studio's graph (U131 acceptance: the instrument and the editor, not the page around them). */
const PRIMARY = Object.freeze({
  synth: '[data-osc="synth-view"]',
  studio: '[data-osc="studio.graph.viewport"]',
});
const primaryOf = (ws) => PRIMARY[ws]
  || (phonePrimaryOf(ws) ? `[data-osc-panel="${phonePrimaryOf(ws)}"]` : 'main');

const contextOptions = (name, vp) => ({
  reducedMotion: 'reduce',
  colorScheme: 'light',
  ...(vp.phone ? { hasTouch: true, ...(name === 'firefox' ? {} : { isMobile: true }) } : {}),
});

/** Read until shown, settled and (with `want`) in that keys state; returns the last read. */
async function settle(page, ws, selector, what, want = null) {
  let last = null;
  let streak = 0;
  await until(async () => {
    const shown = await page.evaluate((w) => window.OSCILLA.app.workspace === w
      && document.fonts.status === 'loaded', ws);
    if (!shown) { streak = 0; return false; }
    const read = await page.evaluate(cb.visibleInPage, { selector });
    if (want && read.state !== want) { streak = 0; return false; }
    const text = JSON.stringify(read);
    streak = last && text === last.text ? streak + 1 : 1;
    last = { text, read };
    return streak >= STABLE_READS;
  }, { ms: SETTLE_MS, every: READ_EVERY_MS,
    what: `${what} shown with its geometry settled (${STABLE_READS} identical reads)` });
  return last.read;
}

/** The cells of one place at one viewport: its opening state and, on a desktop where the
 *  handle folds, the other state after a click on the handle. */
async function measurePlace(browser, name, vp, ws) {
  const { context, page } = await op.openApp(browser, { dist: DIST, hash: `#m=${ws}`,
    audio: false, viewport: { width: vp.width, height: vp.height },
    contextOptions: contextOptions(name, vp), timeout: OPEN_MS });
  const selector = vp.phone ? primaryOf(ws) : 'main';
  const where = `chrome-budget: ${name} ${cb.viewportKey(vp)} #m=${ws}`;
  try {
    const reads = [await settle(page, ws, selector, where)];
    if (!vp.phone && reads[0].foldable) {
      const want = reads[0].state === 'open' ? 'collapsed' : 'open';
      await page.locator('[data-osc="keyboard.handle"]').click();
      reads.push(await settle(page, ws, selector, `${where} with the keys ${want}`, want));
    }
    return reads;
  } finally {
    await bounded(context.close(), { ms: CLOSE_MS, what: 'closing a chrome-budget context' })
      .catch(() => {});
  }
}

/** Every cell of one engine: { key: { ...read, pct, measure, debt } }. */
async function measureEngine(name) {
  const browser = await playwright[name].launch(op.LAUNCH[name] || {});
  const cells = {};
  try {
    for (const vp of cb.VIEWPORTS) {
      for (const ws of WORKSPACES) {
        for (const read of await measurePlace(browser, name, vp, ws)) {
          const budget = cb.budgetOf(vp, read.state);
          if (!budget) continue;
          const key = cb.cellKey(name, vp, ws, read.state);
          if (key in cells) throw new Error(`chrome-budget: ${key} measured twice`);
          cells[key] = { ...read, ...budget, debt: cb.debtOf(budget, read) };
          RUN.tally(name);
        }
      }
    }
  } finally {
    await bounded(browser.close(), { ms: CLOSE_MS, what: `closing ${name}` }).catch(() => {});
  }
  return cells;
}

const readBaseline = () => (fs.existsSync(BASELINE)
  ? JSON.parse(fs.readFileSync(BASELINE, 'utf8')) : { note: NOTE, debt: {}, raises: {} });

const share = (c) => `${((100 * c.px) / c.innerHeight).toFixed(1)} % (${c.px}/${c.innerHeight} px`
  + ` of ${c.target}), budget ${c.pct} %`;
const print = (lines) => { for (const line of lines) console.log(`   ${line}`); };

(async () => {
  await RUN.ready();
  const baseline = readBaseline();
  const all = {};
  let failures = 0;
  for (const name of BROWSERS) {
    const t0 = Date.now();
    const cells = await measureEngine(name);
    Object.assign(all, cells);
    const secs = ((Date.now() - t0) / 1000).toFixed(1);
    const debts = Object.fromEntries(Object.entries(cells).map(([k, c]) => [k, c.debt]));
    const verdict = cb.judge(baseline, debts, { host: process.platform });
    const over = Object.entries(cells).filter(([, c]) => c.debt > 0);
    const bad = cb.failed(verdict) && !UPDATE;
    if (bad) failures += 1;
    console.log(`${bad ? 'FAIL' : 'PASS'} ${name}/chrome-budget: ${Object.keys(cells).length} `
      + `cells, ${over.length} over budget (${over.reduce((n, [, c]) => n + c.debt, 0)} px), `
      + `${verdict.rises.length} rise(s), ${verdict.news.length} new over budget, `
      + `${verdict.falls.length} fall(s) against the ${verdict.against || '(empty)'} record`
      + `${verdict.tolerancePx ? `, ${verdict.tolerancePx} px tolerance on ${verdict.host}` : ''}`
      + `; ${secs} s`);
    print(cb.formatCells(verdict.rises, 'ROSE').map((l) => `x ${l}`));
    print(cb.formatCells(verdict.news, 'NEW over budget').map((l) => `x ${l}`));
    print(cb.formatCells(verdict.falls, 'fell').map((l) => `- ${l}`));
    print(cb.formatCells(verdict.gone, 'no longer measured').map((l) => `- ${l}`));
    print(cb.formatCells(verdict.moved, 'opens in the other keys state on this host')
      .map((l) => `~ ${l}`));
    print(over.map(([k, c]) => `  ${k}: ${share(c)}, ${c.debt} px over`));
  }
  if (JSON_OUT) {
    fs.writeFileSync(path.resolve(JSON_OUT), `${JSON.stringify({ host: process.platform,
      cells: all }, null, 2)}\n`);
  }
  if (UPDATE) {
    const debts = Object.fromEntries(Object.entries(all).map(([k, c]) => [k, c.debt]));
    const { next, refused, raised, verdict } = cb.update(baseline, debts,
      { reason: REASON, note: NOTE, host: process.platform });
    fs.writeFileSync(BASELINE, `${JSON.stringify(next, null, 2)}\n`);
    console.log(`UPDATED ${path.relative(ROOT, BASELINE)}: ${verdict.falls.length} fall(s), `
      + `${verdict.gone.length} removed, ${verdict.added.length} added at 0, ${raised.length} `
      + `raised with the reason given`);
    if (refused.length) {
      failures += 1;
      console.log(`FAIL chrome-budget --update: ${refused.length} rise(s) not written; `
        + `a rise needs --reason "<why, more than ${cb.REASON_MIN} characters>":`);
      print(cb.formatCells(refused, 'rose').map((l) => `x ${l}`));
    }
  } else if (failures) {
    console.log('A rise is chrome taken from a place\'s content. Remove it, or, if it is '
      + 'intended, run `node tests/browser/chrome-budget.cjs --update --reason "<why>"` and say '
      + 'why in the PR.');
  }
  process.exit(failures ? 1 : 0);
})().catch((error) => {
  console.error(`FAIL chrome-budget: ${error && error.stack ? error.stack : error}`);
  process.exit(1);
});
