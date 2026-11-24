#!/usr/bin/env node
// suite-pace: shared (DOM geometry of fresh pages; no audio and no timing judged)
// The DOM geometry census (plan issue U128), the oracle of the panel-membership refactor (U129):
// for every workspace of the shell registry (src/js/ui/shell.js WORKSPACE_IDS) opened fresh at
// its deep link (#m=<id>), at every viewport of lib/geometry-census.cjs VIEWPORTS (the phones
// with touch, and isMobile where the engine has it), in every selected engine, the computed
// display and visibility, whether it is rendered (getClientRects().length > 0) and the rect of
// every element carrying data-osc-panel, every <section> whose id ends in a workspace id and
// every in-panel link that navigates (lib/geometry-census.cjs LINK_SELECTOR).
//
// Default: each cell (engine x viewport x workspace) is compared with
// tests/browser/geometry-census-reference.json, and the run fails with one line per element that
// was added, removed, changed its display, visibility or rendering, or moved or resized by more
// than the baseline's tolerancePx. Rects depend on the host's fonts, so the baseline keeps one
// record per host (process.platform): on a host with a record everything is compared; on a host
// without one only the membership is, against another host's record, and the run says so.
// --update rewrites the measured engines and viewports of this host's record and prints what
// changed; a pull request that updates it says why.
// It is a reference, not a ratchet: it is not named *-baseline.json, which scripts/facts.mjs
// reads as a debt that only falls.
//
// Pages run with reduced motion and the light colour scheme; a cell is read when its workspace
// is shown, the fonts are loaded and three reads in a row are identical, a condition poll with
// a named wall-clock deadline (tests/browser/lib/wait.cjs).
//
//   node tests/browser/geometry-census.cjs [--update] [--dist dist/index.html] [--baseline <file>]
//        [--json <file>: also write the measured census, host and engines there]
//        [--browsers chromium,firefox,webkit]   (or OSC_BROWSERS through the harness)
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const suite = require('./lib/suite.cjs');
const { until, bounded } = require('./lib/wait.cjs');
const op = require('./lib/oscilla-page.cjs');
const gc = require('./lib/geometry-census.cjs');

const argv = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};
const ROOT = path.resolve(__dirname, '..', '..');
const DIST = path.resolve(arg('dist', path.join(ROOT, 'dist', 'index.html')));
const BASELINE = path.resolve(arg('baseline',
  path.join(__dirname, 'geometry-census-reference.json')));
const UPDATE = argv.includes('--update');
const JSON_OUT = arg('json', '');
const HOST = process.platform;
const RUN = suite.open({ name: 'geometry-census', browsers: arg('browsers') });
const playwright = RUN.playwright;
const BROWSERS = RUN.browsers;
const WORKSPACES = op.WORKSPACES;
const SETTLE_MS = 30000;
const STABLE_READS = 3;
const READ_EVERY_MS = 150;
const CLOSE_MS = 10000;
const SHOW_MAX = 300;
const COMMENT = [
  'The DOM geometry census of plan issue U128, written by node tests/browser/geometry-census.cjs',
  '--update and judged by the same suite without it (tests/README.md). hosts.<platform>.<engine>.',
  '<viewport>.<workspace>.<element> = "<display> <visibility> <x>,<y>,<w>,<h>" for a rendered',
  'element (its border box in viewport px on a fresh page at #m=<workspace>), "... -" for one',
  'with no client rects. A rect differs when an edge or side moves by more than tolerancePx.',
  'A host without a record is judged on membership only, against another host\'s record.',
];

const contextOptions = (name, vp) => ({
  reducedMotion: 'reduce',
  colorScheme: 'light',
  ...(vp.phone ? { hasTouch: true, ...(name === 'firefox' ? {} : { isMobile: true }) } : {}),
});

/** One cell: a fresh page at the workspace's deep link, read when it is shown and settled. */
async function measureCell(browser, name, vp, ws) {
  const { context, page } = await op.openApp(browser, { dist: DIST, hash: `#m=${ws}`,
    audio: false, viewport: { width: vp.width, height: vp.height },
    contextOptions: contextOptions(name, vp), timeout: SETTLE_MS });
  try {
    let last = null;
    let streak = 0;
    await until(async () => {
      const shown = await page.evaluate((w) => window.OSCILLA.app.workspace === w
        && document.fonts.status === 'loaded', ws);
      if (!shown) { streak = 0; return false; }
      const cell = await page.evaluate(gc.censusInPage,
        { workspaces: WORKSPACES, linkSelector: gc.LINK_SELECTOR });
      const text = JSON.stringify(cell);
      streak = last && text === last.text ? streak + 1 : 1;
      last = { text, cell };
      return streak >= STABLE_READS;
    }, { ms: SETTLE_MS, every: READ_EVERY_MS,
      what: `geometry-census: ${name} ${gc.viewportKey(vp)} #m=${ws} shown with its geometry `
        + `settled (${STABLE_READS} identical reads)` });
    return last.cell;
  } finally {
    await bounded(context.close(), { ms: CLOSE_MS, what: 'closing a census context' })
      .catch(() => {});
  }
}

async function measureEngine(name) {
  const browser = await playwright[name].launch(op.LAUNCH[name] || {});
  const census = {};
  try {
    for (const vp of gc.VIEWPORTS) {
      const key = gc.viewportKey(vp);
      census[key] = {};
      for (const ws of WORKSPACES) census[key][ws] = await measureCell(browser, name, vp, ws);
    }
  } finally {
    await bounded(browser.close(), { ms: CLOSE_MS, what: `closing ${name}` }).catch(() => {});
  }
  return census;
}

const readBaseline = () => (fs.existsSync(BASELINE)
  ? JSON.parse(fs.readFileSync(BASELINE, 'utf8')) : { hosts: {} });

function printDiff(lines) {
  for (const line of lines.slice(0, SHOW_MAX)) console.log(`   x ${line}`);
  if (lines.length > SHOW_MAX) console.log(`   ... ${lines.length - SHOW_MAX} more`);
}

(async () => {
  await RUN.ready();
  const baseline = readBaseline();
  const current = {};
  let failed = 0;
  for (const name of BROWSERS) {
    const t0 = Date.now();
    current[name] = await measureEngine(name);
    const secs = ((Date.now() - t0) / 1000).toFixed(1);
    const c = gc.counts({ [name]: current[name] })[name];
    const empty = [];
    for (const [vp, spaces] of Object.entries(current[name])) {
      for (const [ws, cell] of Object.entries(spaces)) {
        if (!Object.keys(cell).length) {
          empty.push(`${name}/${vp}/${ws}: the census found no element`);
        }
      }
    }
    const sizes = `${c.cells} cells, ${c.elements} elements (${c.rendered} rendered), ${secs} s`;
    if (UPDATE) {
      RUN.reportLeg({ leg: name, checks: c.cells });
      console.log(`${empty.length ? 'FAIL' : 'MEASURED'} ${name}/geometry-census: ${sizes}`);
      printDiff(empty);
      failed += empty.length;
      continue;
    }
    const verdict = gc.judge(baseline, { [name]: current[name] }, HOST);
    const bad = new Set(verdict.diffs.map((d) => d.path.split('/').slice(0, 3).join('/')));
    for (const e of empty) bad.add(e.split(':')[0]);
    for (const vp of Object.keys(current[name])) {
      for (const ws of Object.keys(current[name][vp])) RUN.tally(name);
    }
    const lines = [...empty, ...gc.formatDiff(verdict.diffs, verdict)];
    failed += lines.length;
    const how = verdict.rects
      ? `membership and rects against the ${verdict.against} record, `
        + `tolerance ${verdict.tolerancePx} px`
      : `membership only against the ${verdict.against || '(none)'} record: no ${HOST} record, `
        + 'rects not compared';
    console.log(`${lines.length ? 'FAIL' : 'PASS'} ${name}/geometry-census: `
      + `${c.cells - bad.size}/${c.cells} cells match (${how}); ${sizes}`);
    printDiff(lines);
  }
  if (JSON_OUT) {
    const out = { host: HOST, census: current };
    fs.writeFileSync(path.resolve(JSON_OUT), `${JSON.stringify(out, null, 2)}\n`);
  }
  if (UPDATE && !failed) {
    const { next, diffs } = gc.update(baseline, current, HOST,
      { tolerancePx: baseline.tolerancePx ?? gc.TOLERANCE_PX, comment: COMMENT });
    fs.writeFileSync(BASELINE, `${JSON.stringify(next, null, 2)}\n`);
    console.log(`UPDATED ${path.relative(ROOT, BASELINE)} (${HOST}): ${diffs.length} change(s)`);
    printDiff(gc.formatDiff(diffs, { tolerancePx: next.tolerancePx }));
  }
  if (failed && !UPDATE) {
    console.log('A difference is a change of what a workspace shows. If it is intended, run '
      + '`node tests/browser/geometry-census.cjs --update` on each host and say why in the PR.');
  }
  process.exit(failed ? 1 : 0);
})().catch((error) => {
  console.error(`FAIL geometry-census: ${error && error.stack ? error.stack : error}`);
  process.exit(1);
});
