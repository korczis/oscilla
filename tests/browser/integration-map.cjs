#!/usr/bin/env node
// K075: every row of the integration map (tests/browser/integration-map.json) walked on the
// built dist/index.html, in chromium, firefox and webkit, from file:// and from the Pages
// sub-path (http://127.0.0.1:<port>/oscilla/). A thin driver: the walker is
// tests/browser/lib/link-walk.cjs (walkRow, judgeRow), the one lane A's link-integrity suite
// reads its routes with; the rows are derived from the workspace registry by
// tests/browser/lib/integration-map.mjs (lane A's P07 census is a part of them).
//
//   node tests/browser/integration-map.cjs [--dist dist/index.html]
//        [--browsers chromium,firefox,webkit] [--origins file,http] [--only <row id part>]
//
// Checks (asserted), per row:
//   control      the control is shown, enabled and named, carries data-osc-link naming the
//                row's kind, and is a link, button or menuitem (the row's role) in the
//                accessibility tree (Playwright getByRole);
//   linked       activated by pointer, by keyboard (Enter) and by a synthesized touch tap (from
//                file://; the /oscilla/ leg walks the pointer with history and reload), the
//                target workspace shows the row's target state, each within TARGET_MS
//                (lib/wait.cjs until(), named per row and mode): the template a template row
//                names, the produced key a copy-link row writes; the Studio store shows the
//                source's revision (studio: same) or at most the Synth's voice more (voice);
//                no microphone is asked for and, unless the row plays a demo, no voice sounds;
//                focus lands on the target's heading or in its view;
//   history      Back returns to the source and Forward to the target (rows that open a page);
//   reload       a reload of the target address (for a produced link, the link followed and
//                reloaded) shows the same target state: workspace, address, template, the
//                Studio document's nodes, and no audio or microphone at load. A row listed in
//                the map's reloadDebt is reported KNOWN with its issue; healed, it fails;
//   deferred     a row the map defers (it needs a stored record) is reported KNOWN with the
//                suite that walks it, never skipped silently.
//   no-console-errors
//
// The run goes through lib/suite.cjs (project.suite-harness); waits are condition polls with a
// named wall-clock deadline (project.bounded-test-timing).
'use strict';

const path = require('node:path');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');
const suite = require('./lib/suite.cjs');
const { serveDist } = require('./lib/serve.cjs');
const walk = require('./lib/link-walk.cjs');

const argv = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};
const ROOT = path.resolve(__dirname, '..', '..');
const DIST = path.resolve(arg('dist', path.join(ROOT, 'dist', 'index.html')));
const MAP = JSON.parse(fs.readFileSync(path.join(__dirname, 'integration-map.json'), 'utf8'));
const RUN = suite.open({ name: 'integration-map', browsers: arg('browsers'),
  origins: arg('origins'), defaultOrigins: ['file', 'http'] });
const playwright = RUN.playwright;
const ONLY = arg('only', '');
const ROWS = [...MAP.rows, ...MAP.declared].filter((r) => !ONLY || r.id.includes(ONLY));

// The activation modes per origin: an address behaves per origin (file:// and the sub-path
// differ in history, reload and the base URL), so both walk the pointer activation with Back,
// Forward and the reload; keyboard and touch are the control's own and are walked once, from
// file://, where the leg starts.
const MODES_OF = { file: walk.MODES, http: ['pointer'] };

let failures = 0;
let passes = 0;
function check(leg, name, ok, detail = '') {
  RUN.tally(leg);
  if (ok) passes += 1; else failures += 1;
  console.log(`  ${ok ? 'PASS' : 'FAIL'} [${leg}] ${name}${!ok && detail ? ` — ${detail}` : ''}`);
}

async function runLeg(name, origin) {
  const leg = `${name}/${origin}`;
  const server = origin === 'http' ? await serveDist(DIST, { prefix: 'oscilla-map-' }) : null;
  const base = server ? server.url : pathToFileURL(DIST).href;
  const browser = await playwright[name].launch();
  // hasTouch: the touch tap of each row is a synthesized tap (Playwright tap()).
  const context = await browser.newContext({ viewport: { width: 1536, height: 1024 },
    hasTouch: true });
  const errors = [];
  context.on('page', (p) => {
    p.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
    p.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
  });
  await context.addInitScript(walk.probe);
  console.log(`\n${leg} (${browser.version()}), ${ROWS.length} rows`);
  try {
    for (const row of ROWS) {
      if (row.walk) {
        console.log(`  KNOWN [${leg}] ${row.id}: not walked here (${row.walk.deferred}); `
          + `walked by ${row.walk.covered}`);
        continue;
      }
      let obs;
      try {
        obs = await walk.walkRow(context, base, row, { modes: MODES_OF[origin] });
      } catch (err) {
        check(leg, row.id, false, `walk failed: ${err && err.message}`);
        continue;
      }
      const { failures: bad, known } = walk.judgeRow(row, obs, { reloadDebt: MAP.reloadDebt });
      for (const k of known) console.log(`  KNOWN [${leg}] ${k}`);
      const ms = Object.entries(obs.modes).map(([m, a]) => `${m} ${a.ms ?? '-'} ms`).join(', ');
      check(leg, `${row.id} (${row.kind}; ${ms})`, !bad.length, bad.join(' | '));
    }
    check(leg, 'no console errors', errors.length === 0, errors.slice(0, 5).join(' | '));
  } catch (err) {
    check(leg, 'run completed', false, err && err.stack);
  } finally {
    await browser.close();
    if (server) server.close();
  }
}

(async () => {
  await RUN.ready();
  if (!ROWS.length) {
    console.error(`integration-map: no row matches --only ${ONLY}`);
    process.exit(2);
  }
  for (const b of RUN.browsers) {
    for (const o of RUN.origins) await runLeg(b, o);
  }
  console.log(`\n${failures ? `${failures} FAILURE(S)` : 'ALL PASS'} (${passes} checks passed)`);
  process.exit(failures ? 1 : 0);
})();
