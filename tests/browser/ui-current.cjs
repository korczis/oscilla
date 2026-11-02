#!/usr/bin/env node
// The current interface against the audit of 2026-10-28 (intent ui-current, docs/ui-audit.md).
// U005 introduced it; U003, U004, U006, U007 and U008 extend it with their workspaces.
//
// Empty area, as the audit defines it: points on a 24 px grid between the header's bottom edge
// and the status bar's top edge, each probed with elementFromPoint; a point is empty when it hits
// only the page background (html, body), main, the app root or a workspace container (the
// wrappers the focus layouts turn into display: contents, a workspace view). It measures layout,
// not whether the content is useful.
//
// Checks (dist/index.html from file://):
// - 1536x1024: at most EMPTY_LIMIT of the Analyzer and of the Compare workspace is empty
//   (A05, A07: Compare left its lower third empty);
// - 390x844: neither workspace overflows sideways, the page nor a visible panel;
// - both sizes: Analyzer and Compare show the links to their counterparts (ui/counterparts.js):
//   "RTA in Measure" (#m=measure) and "Compare saved experiments" (#m=experiments); the
//   Playground does not show them;
// - 1536x1024: a click on "RTA in Measure" opens MEASURE on its RTA tab, and a click on "Compare
//   saved experiments" opens Experiments.
//
// Every wait is a condition poll with a named wall-clock deadline (tests/browser/lib/wait.cjs);
// the poll ends on the predicate the check judges.
//
//   node tests/browser/ui-current.cjs [--browsers chromium,firefox,webkit]   (or OSC_BROWSERS)

const path = require('node:path');
const { pathToFileURL } = require('node:url');
const suite = require('./lib/suite.cjs');
const { until, WaitTimeout } = require('./lib/wait.cjs');

const args = process.argv.slice(2);
const arg = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : def;
};
const RUN = suite.open({ name: 'ui-current', browsers: arg('browsers') });
const playwright = RUN.playwright;
const BROWSERS = RUN.browsers;
const URL = pathToFileURL(path.resolve(__dirname, '../../dist/index.html')).href;
const DESKTOP = { width: 1536, height: 1024 };
const PHONE = { width: 390, height: 844 };
// The share of a workspace that may be empty at 1536x1024 (acceptance of U005).
const EMPTY_LIMIT = 0.25;
// The workspaces held to the limit; a later issue adds the ones it lays out.
const FILLED_WORKSPACES = ['analyzer', 'compare'];
const COUNTERPART_LINKS = [
  { osc: 'counterpart.measure-rta', href: '#m=measure' },
  { osc: 'counterpart.experiments', href: '#m=experiments' },
];
const COUNTERPART_WORKSPACES = ['analyzer', 'compare'];
const SETTLE_MS = 10000;

/**
 * In the page: the empty share of the workspace in view (see the header) and what the share
 * was measured on. `mode` is the workspace the app root shows.
 */
function emptyArea() {
  const STEP = 24;
  const header = document.querySelector('.osc-header');
  const status = document.querySelector('.osc-statusbar');
  const app = document.getElementById('osc-app');
  const top = header.getBoundingClientRect().bottom;
  const bottom = status.getBoundingClientRect().top;
  const containers = new Set([document.documentElement, document.body, app,
    document.querySelector('.osc-main'),
    ...document.querySelectorAll('.osc-top, .osc-top-left, .osc-top-right, .osc-row1-left, '
      + '.osc-row1-right, .osc-row3, .osc-workspace, .osc-view')]);
  let points = 0;
  let empty = 0;
  for (let y = top + STEP / 2; y < bottom; y += STEP) {
    for (let x = STEP / 2; x < window.innerWidth; x += STEP) {
      points += 1;
      const hit = document.elementFromPoint(x, y);
      if (!hit || containers.has(hit)) empty += 1;
    }
  }
  return { mode: app.dataset.mode, points, empty, share: points ? empty / points : 1 };
}

/** In the page: sideways overflow of the page and of every visible panel of the workspace. */
function sidewaysOverflow() {
  const de = document.documentElement;
  const main = document.querySelector('.osc-main');
  const out = [];
  if (de.scrollWidth > de.clientWidth + 1) out.push(`page ${de.scrollWidth} > ${de.clientWidth}`);
  if (main.scrollWidth > main.clientWidth + 1) {
    out.push(`main ${main.scrollWidth} > ${main.clientWidth}`);
  }
  for (const p of document.querySelectorAll('.osc-panel')) {
    const r = p.getBoundingClientRect();
    if (!r.width || !r.height || getComputedStyle(p).display === 'none') continue;
    if (r.left < -1 || r.right > window.innerWidth + 1) {
      out.push(`${p.id || p.className} spans ${Math.round(r.left)}..${Math.round(r.right)}`);
    }
  }
  return { mode: document.getElementById('osc-app').dataset.mode, out };
}

/** In the page: each counterpart link, whether it is shown and where it points. */
function counterpartLinks(links) {
  return links.map(({ osc }) => {
    const a = document.querySelector(`[data-osc="${osc}"]`);
    if (!a) return { osc, present: false, shown: false, href: null };
    const r = a.getBoundingClientRect();
    const shown = r.width > 0 && r.height > 0 && !a.closest('[hidden]')
      && getComputedStyle(a).visibility !== 'hidden';
    return { osc, present: true, shown, href: a.getAttribute('href'), text: a.textContent.trim() };
  });
}

async function openPage(browser, viewport) {
  const page = await browser.newPage({ viewport });
  await page.goto(URL);
  await page.waitForFunction(() => window.OSCILLA && window.OSCILLA.app, null, { timeout: 15000 });
  return page;
}

async function setWorkspace(page, ws) {
  await page.evaluate((w) => window.OSCILLA.app.setWorkspace(w), ws);
  await until(() => page.evaluate((w) => document.getElementById('osc-app').dataset.mode === w,
    ws), { ms: SETTLE_MS, what: `ui-current: workspace ${ws} shown` });
}

/** Poll `measure` until `ok(value)`; the last value read is returned either way. */
async function pollFor(measure, ok, what) {
  let last = null;
  try {
    await until(async () => {
      last = await measure();
      return ok(last);
    }, { ms: SETTLE_MS, what });
    return { ok: true, last };
  } catch (error) {
    if (!(error instanceof WaitTimeout)) throw error;
    return { ok: false, last, error: error.message };
  }
}

async function runOne(name) {
  const browser = await playwright[name].launch();
  const failures = [];
  let checks = 0;
  const check = (id, ok, detail) => {
    checks += 1;
    RUN.tally(name);
    if (!ok) failures.push(`${id}: ${detail}`);
  };
  try {
    // ---- 1536x1024: the workspaces fill the viewport and show their counterparts ----
    const page = await openPage(browser, DESKTOP);
    for (const ws of FILLED_WORKSPACES) {
      await setWorkspace(page, ws);
      const r = await pollFor(() => page.evaluate(emptyArea),
        (m) => m.mode === ws && m.share <= EMPTY_LIMIT, `ui-current: ${ws} empty share`);
      const m = r.last || {};
      check(`empty-area-${ws}`, r.ok, `${(100 * (m.share ?? 1)).toFixed(1)} % of ${ws} is empty `
        + `(${m.empty}/${m.points} points), above ${100 * EMPTY_LIMIT} %`);
      console.log(`  ${name} ${ws} 1536x1024: ${(100 * (m.share ?? 1)).toFixed(1)} % empty`);
    }
    for (const ws of [...COUNTERPART_WORKSPACES, 'playground']) {
      await setWorkspace(page, ws);
      const want = COUNTERPART_WORKSPACES.includes(ws);
      const r = await pollFor(() => page.evaluate(counterpartLinks, COUNTERPART_LINKS),
        (links) => links.every((l) => l.present && l.shown === want
          && l.href === COUNTERPART_LINKS.find((c) => c.osc === l.osc).href),
        `ui-current: counterpart links ${want ? 'shown' : 'hidden'} in ${ws}`);
      check(`counterparts-${ws}-desktop`, r.ok, JSON.stringify(r.last));
    }

    // A plain click on "RTA in Measure" opens MEASURE on its RTA tab.
    await setWorkspace(page, 'analyzer');
    await page.click('[data-osc="counterpart.measure-rta"]');
    const rta = await pollFor(() => page.evaluate(() => ({
      workspace: window.OSCILLA.app.workspace, tab: window.OSCILLA.app.meas.tab,
      address: window.location.hash,
    })), (s) => s.workspace === 'measure' && s.tab === 'rta',
    'ui-current: RTA in Measure opens the RTA tab');
    check('counterpart-opens-measure-rta', rta.ok, JSON.stringify(rta.last));

    // A plain click on "Compare saved experiments" opens Experiments.
    await setWorkspace(page, 'compare');
    await page.click('[data-osc="counterpart.experiments"]');
    const exp = await pollFor(() => page.evaluate(() => window.OSCILLA.app.workspace),
      (w) => w === 'experiments', 'ui-current: Compare saved experiments opens Experiments');
    check('counterpart-opens-experiments', exp.ok, `workspace ${exp.last}`);
    await page.close();

    // ---- 390x844: nothing overflows sideways; the counterparts are shown ----
    const phone = await openPage(browser, PHONE);
    for (const ws of FILLED_WORKSPACES) {
      await setWorkspace(phone, ws);
      const r = await pollFor(() => phone.evaluate(sidewaysOverflow),
        (m) => m.mode === ws && m.out.length === 0, `ui-current: ${ws} at 390 px within the width`);
      check(`no-sideways-overflow-${ws}`, r.ok, (r.last && r.last.out || []).join('; '));
      if (COUNTERPART_WORKSPACES.includes(ws)) {
        const l = await pollFor(() => phone.evaluate(counterpartLinks, COUNTERPART_LINKS),
          (links) => links.every((x) => x.present && x.shown),
          `ui-current: counterpart links shown in ${ws} at 390 px`);
        check(`counterparts-${ws}-phone`, l.ok, JSON.stringify(l.last));
      }
    }
    await phone.close();
  } finally {
    await browser.close();
  }
  return { checks, failures };
}

(async () => {
  await RUN.ready();
  let failed = 0;
  for (const b of BROWSERS) {
    const t0 = Date.now();
    const { checks, failures } = await runOne(b);
    failed += failures.length;
    console.log(`${failures.length ? 'FAIL' : 'PASS'} ${b}/ui-current: `
      + `${checks - failures.length}/${checks} checks (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
    for (const f of failures) console.log(`   x ${f}`);
  }
  process.exit(failed ? 1 : 0);
})();
