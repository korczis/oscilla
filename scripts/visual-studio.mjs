#!/usr/bin/env node
// STUDIO visual reference (spec §203-§205): the Studio of the built app in Playwright's Chromium,
// from the shipped Subtractive Synth template (the §204/§257 fixture: Oscillator, Envelope,
// Filter, LFO, Spectrum, Master, five connections, two clips, a cutoff automation lane) with the
// Filter selected so the Inspector is open. Deterministic: reduced motion, no audio, a fixed
// viewport, focus and pointer parked, the graph framed by its own Frame All.
//
//   node scripts/visual-studio.mjs [target] [--out <dir>] [--view <id>[,<id>...]]
//   node scripts/visual-studio.mjs [target] --update-reference [--view <id>[,<id>...]]
//
// Views (each compared pixel by pixel with the accepted reference of this environment):
//   desktop  1536x1024, the workspace from the toolbar down to the graph row (the toolbar, node
//            library, graph and Inspector)
//   desktop-timeline  1536x1024, the whole workspace from the toolbar down to the timeline row
//            (§204 Full Studio reference: node library, graph, Inspector and the timeline with
//            the two clips and the cutoff automation lane; playhead at 0, nothing playing). The
//            capture fails closed unless both clips and the automation curve are rendered.
//   compact  1536x1024, the compact Studio panel of the Playground
//   phone    390x844, the GRAPH subview
//   phone-timeline  390x844, the TIMELINE subview (tracks, clips, the cutoff automation lane;
//            playhead at 0, nothing playing)
// target: 'dist' (default) -> dist/index.html; any other path or http(s) URL as is.
// --view limits the run to the named views; with --update-reference it accepts only those views
// and leaves every other reference file untouched, and it is refused when this environment's
// references were accepted with a different Chromium build (re-accept all views then).
// Fails closed like scripts/visual-measure.mjs: a missing reference for this environment
// (<platform>-<arch>), a page error, a different Chromium build or more than MAX_MISMATCH_PCT
// differing pixels exits 1. References live in tests/visual/studio/ with their browser version;
// re-accept them deliberately with --update-reference (CI: linux-x64 in the Playwright
// container, as tests/README.md describes for the other references).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const requireHere = createRequire(import.meta.url);
const { chromium } = requireHere('playwright');
const { PNG } = requireHere('pngjs');
const pixelmatchMod = requireHere('pixelmatch');
const pixelmatch = pixelmatchMod.default || pixelmatchMod;

const REF_DIR = path.join(ROOT, 'tests/visual/studio');
const META_FILE = path.join(REF_DIR, 'references.json');
const ENV = `${process.platform}-${process.arch}`;
const MAX_MISMATCH_PCT = 0.5;
const TEMPLATE = 'subtractive-synth';
const VIEWS = [
  { id: 'desktop', width: 1536, height: 1024 },
  { id: 'desktop-timeline', width: 1536, height: 1024 },
  { id: 'compact', width: 1536, height: 1024 },
  { id: 'phone', width: 390, height: 844 },
  { id: 'phone-timeline', width: 390, height: 844 },
];

const args = process.argv.slice(2);
const option = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const positional = args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--out'
  && args[i - 1] !== '--view');
const TARGET = positional[0] || 'dist';
const OUT = path.resolve(option('--out') || path.join(ROOT, 'tests/visual/out-studio'));
const UPDATE = args.includes('--update-reference');
const ONLY = option('--view') ? option('--view').split(',').filter(Boolean) : null;
const unknownViews = (ONLY || []).filter((id) => !VIEWS.some((v) => v.id === id));
const RUN_VIEWS = ONLY ? VIEWS.filter((v) => ONLY.includes(v.id)) : VIEWS;

function targetUrl(t) {
  if (/^https?:\/\//.test(t)) return t;
  const file = t === 'dist' ? path.join(ROOT, 'dist/index.html') : path.resolve(t);
  return pathToFileURL(file).href;
}

const frames = (page) => page.evaluate(() => new Promise((r) => {
  requestAnimationFrame(() => requestAnimationFrame(r));
}));

async function capture(browser, view) {
  const page = await browser.newPage({ viewport: { width: view.width, height: view.height },
    deviceScaleFactor: 1, reducedMotion: 'reduce' });
  const errors = [];
  const problems = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(targetUrl(TARGET));
  await page.waitForSelector('html[data-ready="true"]', { timeout: 15000 });
  await page.evaluate((tid) => {
    const a = window.OSCILLA.app;
    if (!a.safetyCollapsed) a.collapseSafety();
    a.alerts = [];
    a.setWorkspace('studio');
    a.studioLoadTemplate(tid);
  }, TEMPLATE);
  await frames(page);
  await page.evaluate(() => {
    const s = window.OSCILLA.studio;
    s.editor.onShow();
    s.editor.frameAll();
    s.store.dispatch({ type: 'SELECTION_CHANGE', selection: { nodes: ['filter-1'] } });
  });
  await frames(page);
  if (view.id === 'phone-timeline') {
    await page.evaluate(() => window.OSCILLA.app.studioSetSubview('timeline'));
    await frames(page);
    await frames(page);
  }
  if (view.id === 'compact') {
    await page.evaluate(() => window.OSCILLA.app.setWorkspace('playground'));
    await frames(page);
    await page.evaluate(() => {
      document.querySelector('[data-osc="studio.compact"]').scrollIntoView({ block: 'end' });
    });
  }
  await page.evaluate(() => {
    if (document.activeElement) document.activeElement.blur();
  });
  await page.mouse.move(0, view.height - 1);
  await frames(page);
  const file = path.join(OUT, `current-${view.id}.png`);
  if (view.id === 'desktop') {
    const clip = await page.evaluate(() => {
      const top = document.querySelector('.osc-st-bar').getBoundingClientRect();
      const graph = document.querySelector('.osc-st-graph').getBoundingClientRect();
      return { x: 0, y: Math.floor(top.top), width: innerWidth,
        height: Math.ceil(graph.bottom - top.top) };
    });
    await page.screenshot({ path: file, clip });
  } else if (view.id === 'desktop-timeline') {
    const shot = await page.evaluate(() => {
      const top = document.querySelector('.osc-st-bar').getBoundingClientRect();
      const tl = document.querySelector('.osc-st-timeline').getBoundingClientRect();
      const insp = document.querySelector('.osc-st-inspector').getBoundingClientRect();
      const inView = (el) => {
        const b = el.getBoundingClientRect();
        return b.width > 0 && b.height > 0 && b.top >= 0 && b.bottom <= innerHeight
          && b.left >= 0 && b.right <= innerWidth;
      };
      const host = document.querySelector('[data-osc="studio.timeline"]');
      const curve = host.querySelector('.osc-stl-lane-curve');
      const bottom = Math.max(tl.bottom, insp.bottom);
      return { clip: { x: 0, y: Math.floor(top.top), width: innerWidth,
        height: Math.ceil(Math.min(bottom, innerHeight) - top.top) },
      clips: [...host.querySelectorAll('.osc-stl-clip')].filter(inView).length,
      lane: !!curve && inView(curve) && (curve.getAttribute('d') || '').length > 0,
      fits: bottom <= innerHeight,
      playing: !!window.OSCILLA.studio.counts().playing };
    });
    if (shot.clips < 2 || !shot.lane || !shot.fits || shot.playing) {
      problems.push(`timeline not fully rendered: ${shot.clips} clips in view, automation curve `
        + `${shot.lane}, fits ${shot.fits}, playing ${shot.playing}`);
    }
    await page.screenshot({ path: file, clip: shot.clip });
  } else if (view.id === 'compact') {
    await page.locator('[data-osc="studio.compact"]').screenshot({ path: file });
  } else {
    await page.screenshot({ path: file });
  }
  await page.close();
  return { file, errors, problems };
}

function compare(currentFile, referenceFile, diffFile) {
  const a = PNG.sync.read(readFileSync(currentFile));
  const b = PNG.sync.read(readFileSync(referenceFile));
  if (a.width !== b.width || a.height !== b.height) {
    return { pct: 100, note: `size ${a.width}x${a.height} vs ${b.width}x${b.height}` };
  }
  const diff = new PNG({ width: a.width, height: a.height });
  const n = pixelmatch(a.data, b.data, diff.data, a.width, a.height,
    { threshold: 0.12, includeAA: false });
  writeFileSync(diffFile, PNG.sync.write(diff));
  return { pct: +(100 * n / (a.width * a.height)).toFixed(3) };
}

async function main() {
  if (unknownViews.length || (ONLY && !RUN_VIEWS.length)) {
    throw new Error(`unknown view(s) ${unknownViews.join(', ') || '(none given)'}; views: `
      + VIEWS.map((v) => v.id).join(', '));
  }
  mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const version = browser.version();
  const meta = existsSync(META_FILE) ? JSON.parse(readFileSync(META_FILE, 'utf8'))
    : { schema: 1, environments: {} };
  const failures = [];
  const lines = [`STUDIO visual reference ${ENV} chromium ${version}`
    + `${ONLY ? ` (views ${RUN_VIEWS.map((v) => v.id).join(', ')})` : ''}`];
  const prior = meta.environments[ENV];
  if (UPDATE && ONLY && prior && prior.browser !== version) {
    await browser.close();
    throw new Error(`${ENV} references were accepted with chromium ${prior.browser}, this run is `
      + `${version}: accepting only some views would mix builds; re-accept all views`);
  }
  try {
    for (const view of RUN_VIEWS) {
      const { file, errors, problems } = await capture(browser, view);
      for (const e of errors) failures.push(`${view.id}: page error ${e}`);
      for (const e of problems) failures.push(`${view.id}: ${e}`);
      const ref = path.join(REF_DIR, `${ENV}-${view.id}.png`);
      if (UPDATE) {
        if (errors.length) throw new Error(`page errors, refusing to accept: ${errors.join('; ')}`);
        if (problems.length) throw new Error(`refusing to accept: ${problems.join('; ')}`);
        mkdirSync(REF_DIR, { recursive: true });
        writeFileSync(ref, readFileSync(file));
        lines.push(`  ${view.id}: accepted -> ${path.relative(ROOT, ref)}`);
        continue;
      }
      const accepted = meta.environments[ENV];
      if (!accepted || !existsSync(ref)) {
        failures.push(`${view.id}: no accepted reference for ${ENV} (record one deliberately with `
          + '--update-reference)');
        continue;
      }
      if (accepted.browser !== version) {
        failures.push(`${view.id}: reference accepted with chromium ${accepted.browser}, this run `
          + `is ${version}; re-accept with --update-reference`);
      }
      const r = compare(file, ref, path.join(OUT, `diff-${view.id}.png`));
      const bad = r.pct > MAX_MISMATCH_PCT;
      if (bad) failures.push(`${view.id}: ${r.pct} % of pixels differ (limit ${MAX_MISMATCH_PCT} %)`
        + `${r.note ? `, ${r.note}` : ''}`);
      lines.push(`  ${view.id.padEnd(8)} ${String(r.pct).padStart(7)} % differ  `
        + `${bad ? 'FAIL' : 'ok'}`);
    }
  } finally {
    await browser.close();
  }
  if (UPDATE) {
    meta.schema = 1;
    meta.note = 'Accepted STUDIO references per environment, written only by '
      + 'node scripts/visual-studio.mjs --update-reference.';
    // A partial acceptance (--view) keeps the views accepted before; the list follows VIEWS.
    const had = new Set(ONLY && prior ? (prior.views || []).map((v) => v.split(' ')[0]) : []);
    const views = VIEWS.filter((v) => had.has(v.id) || RUN_VIEWS.includes(v))
      .map((v) => `${v.id} ${v.width}x${v.height}`);
    meta.environments = { ...meta.environments, [ENV]: { browser: version, template: TEMPLATE,
      views } };
    meta.environments = Object.fromEntries(Object.entries(meta.environments).sort());
    writeFileSync(META_FILE, `${JSON.stringify(meta, null, 2)}\n`);
  }
  writeFileSync(path.join(OUT, 'result.json'), `${JSON.stringify({ env: ENV, version, failures },
    null, 2)}\n`);
  lines.push(failures.length ? `FAIL STUDIO visual reference: ${failures.length} problem(s); `
    + `artifacts in ${OUT}` : `PASS STUDIO visual reference (${RUN_VIEWS.length} views)`);
  for (const f of failures) lines.push(`   x ${f}`);
  console.log(lines.join('\n'));
  return failures.length === 0;
}

main().then((ok) => process.exit(ok ? 0 : 1)).catch((e) => {
  console.error(`FAIL STUDIO visual reference: ${e.message || e}`);
  process.exit(1);
});
