#!/usr/bin/env node
// SYN visual reference (F013 W1): the Synth workspace of the built app in Playwright's Chromium,
// with the patch bay holding six cables, one from each source colour (the s-look pairs of
// tests/browser/synth.cjs: keys.velocity -> vco2.tune, vco1.audio -> ring.modulator,
// vco2.audio -> mix.in4, ring.audio -> mix.in3, noise.audio -> mix.in1, mix.audio -> vca.audio),
// patched through the jacks' own keyboard path (focus, Enter). Deterministic: a fresh context
// (no stored theme or patch), reduced motion, no audio (the engine is never armed), a fixed
// viewport, every scroller back at 0, focus and pointer parked, notices cleared last.
//
//   node scripts/visual-synth.mjs [target] [--out <dir>] [--view <id>[,<id>...]]
//   node scripts/visual-synth.mjs [target] --update-reference [--view <id>[,<id>...]]
//
// Views (each compared pixel by pixel with the accepted reference of this environment):
//   desktop-<tab>-<theme>  1536x1024, the first screen of the Synth workspace on the tab
//   phone-<tab>-<theme>    390x844 with touch, the same
//     <tab> is panel, engines or xy (the Engines tab on its default engine, ENGINE; the XY tab
//     with no preset, so its pad is shown disabled), <theme> is dark or light.
//   desktop-bay-<theme>    1536x1280, the Panel tab scrolled so the bay's card is at the top of
//   phone-bay-<theme>      the scroller (390x1400 with touch: under the sticky section nav). The
//            six cables span 706 px from the Keys row to the VCA row, more than the agreed
//            heights leave above the docked keyboard, so the bay is seen whole in these taller
//            views at the agreed widths; the capture fails closed unless all 12 cable ends are
//            hit-testable (nothing covers them).
// Every capture fails closed unless the Synth reports the view's tab, exactly the six cables,
// six drawn cables, no armed engine and no voice, the view's theme on <html>, and the parked
// pointer lands on nothing interactive.
// target: 'dist' (default) -> dist/index.html; any other path or http(s) URL as is.
// --view limits the run to the named views; with --update-reference it accepts only those views
// and leaves every other reference file untouched, and it is refused when this environment's
// references were accepted with a different Chromium build (re-accept all views then).
// Fails closed like scripts/visual-studio.mjs: a missing reference for this environment
// (<platform>-<arch>), a page error, a capture problem, a different Chromium build or more than
// MAX_MISMATCH_PCT differing pixels exits 1. The font is system-ui, so each OS has its own
// references. References live in tests/visual/synth/ with their browser version; re-accept them
// deliberately with --update-reference and state the reason in the pull request (linux-x64 in
// the Playwright container, as tests/README.md describes for the other references).
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const requireHere = createRequire(import.meta.url);

export const REF_DIR = path.join(ROOT, 'tests/visual/synth');
const META_FILE = path.join(REF_DIR, 'references.json');
const ENV = `${process.platform}-${process.arch}`;
export const MAX_MISMATCH_PCT = 0.5;
/** The Engines tab's default engine (ENGINE_IDS[0]); a reorder moves the Engines views. */
export const ENGINE = 'additive';
export const CABLES = [['keys.velocity', 'vco2.tune'], ['vco1.audio', 'ring.modulator'],
  ['vco2.audio', 'mix.in4'], ['ring.audio', 'mix.in3'], ['noise.audio', 'mix.in1'],
  ['mix.audio', 'vca.audio']];
const SIZES = [['desktop', 1536, 1024, 1280], ['phone', 390, 844, 1400]];
const TABS = ['panel', 'engines', 'xy'];
const THEMES = ['dark', 'light'];
export const VIEWS = [
  ...SIZES.flatMap(([size, width, height]) => TABS.flatMap((tab) => THEMES.map((theme) =>
    ({ id: `${size}-${tab}-${theme}`, width, height, tab, theme, bay: false })))),
  ...SIZES.flatMap(([size, width, , bayHeight]) => THEMES.map((theme) =>
    ({ id: `${size}-bay-${theme}`, width, height: bayHeight, tab: 'panel', theme, bay: true }))),
];
const LOAD_MS = 15000;

export function parseArgs(argv) {
  const option = (name) => {
    const i = argv.indexOf(name);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const positional = argv.filter((a, i) => !a.startsWith('--') && argv[i - 1] !== '--out'
    && argv[i - 1] !== '--view');
  const only = option('--view') ? option('--view').split(',').filter(Boolean) : null;
  return {
    target: positional[0] || 'dist',
    out: path.resolve(option('--out') || path.join(ROOT, 'tests/visual/out-synth')),
    update: argv.includes('--update-reference'),
    only,
    unknown: (only || []).filter((id) => !VIEWS.some((v) => v.id === id)),
    views: only ? VIEWS.filter((v) => only.includes(v.id)) : VIEWS,
  };
}

function targetUrl(t) {
  if (/^https?:\/\//.test(t)) return t;
  const file = t === 'dist' ? path.join(ROOT, 'dist/index.html') : path.resolve(t);
  return pathToFileURL(file).href;
}

const frames = (page) => page.evaluate(() => new Promise((r) => {
  requestAnimationFrame(() => requestAnimationFrame(r));
}));

async function tapJack(page, id) {
  await page.locator(`[data-jack="${id}"]`).focus();
  await page.keyboard.press('Enter');
}

/** Every scroller back at 0 (the jack taps leave .osc-main scrolled to the focused jack). */
function resetScroll() {
  if (document.activeElement) document.activeElement.blur();
  for (const el of [document.scrollingElement, ...document.querySelectorAll('*')]) {
    if (el && el.scrollTop) el.scrollTop = 0;
    if (el && el.scrollLeft) el.scrollLeft = 0;
  }
}

/** Scroll .osc-main so the bay's card sits at its top, under the sticky section nav if shown. */
function scrollBayToTop() {
  const main = document.querySelector('.osc-main');
  const bay = document.querySelector('[data-osc="synth.bay"]');
  const nav = document.querySelector('nav[aria-label="Synth sections"]');
  const navH = nav && getComputedStyle(nav).display !== 'none' ? nav.offsetHeight : 0;
  main.scrollTop = Math.round(main.scrollTop + bay.getBoundingClientRect().top
    - main.getBoundingClientRect().top - navH);
}

/** What the capture must hold before its picture is worth comparing. */
function inspect({ pairs, bay, park }) {
  const app = window.OSCILLA.app;
  const d = app.synthDebug();
  const ends = pairs.flatMap(([a, b]) => [`${a}:out`, `${b}:in`]);
  const hidden = bay ? ends.filter((id) => {
    const j = document.querySelector(`[data-jack="${id}"]`);
    if (!j) return true;
    const r = j.getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return !(hit && j.contains(hit));
  }) : [];
  const under = document.elementFromPoint(park[0], park[1]);
  const interactive = under && under.closest('a[href], button, input, select, textarea, '
    + '[tabindex], [role=button], [role=slider], [data-knob], [data-jack]');
  return { tab: d.tab, engine: d.engine, armed: d.armed, voices: d.voices,
    cables: d.cables.map((c) => `${c.from} -> ${c.to}`).sort(),
    drawn: document.querySelectorAll('[data-osc="synth.bay.svg"] [data-cable]').length,
    theme: document.documentElement.dataset.theme, hidden,
    parked: interactive ? (interactive.getAttribute('data-osc') || interactive.tagName) : null,
    alerts: app.alerts.length };
}

async function capture(browser, view, out, target) {
  const page = await browser.newPage({ viewport: { width: view.width, height: view.height },
    deviceScaleFactor: 1, reducedMotion: 'reduce', hasTouch: view.width < 600 });
  const errors = [];
  const problems = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  // The bare URL: the #m=synth link raises a notice that dismisses itself on a timer.
  await page.goto(targetUrl(target));
  await page.waitForSelector('html[data-ready="true"]', { timeout: LOAD_MS });
  await page.evaluate(() => {
    const a = window.OSCILLA.app;
    if (!a.safetyCollapsed) a.collapseSafety();
    a.alerts = [];
    a.setWorkspace('synth');
  });
  await page.waitForFunction(() => window.OSCILLA.app.synthDebug().present
    && !document.getElementById('osc-view-synth').hidden
    && document.querySelector('[data-osc="synth.bay.svg"]'), null, { timeout: LOAD_MS });
  for (const [a, b] of CABLES) {
    await tapJack(page, `${a}:out`);
    await tapJack(page, `${b}:in`);
  }
  await page.evaluate((t) => window.OSCILLA.app.synthTab(t), view.tab);
  await frames(page);
  await frames(page);
  await page.evaluate((t) => {
    if (window.OSCILLA.app.theme !== t) window.OSCILLA.app.toggleTheme();
  }, view.theme);
  // The bay is redrawn from the theme's tokens: a free jack's ring is --osc-text-dim; the tab
  // is rendered on a frame. Wait for both, and for the six cables to be drawn.
  await page.waitForFunction((v) => {
    const doc = document.documentElement;
    const dim = getComputedStyle(doc).getPropertyValue('--osc-text-dim').trim();
    const ring = document.querySelector('[data-jack="mg.rate:in"] > :nth-child(3)');
    return doc.dataset.theme === v.theme && ring && ring.getAttribute('stroke') === dim
      && window.OSCILLA.app.synthDebug().tab === v.tab
      && document.querySelectorAll('[data-osc="synth.bay.svg"] [data-cable]').length === 6;
  }, { theme: view.theme, tab: view.tab }, { timeout: LOAD_MS });
  await frames(page);
  await page.evaluate(resetScroll);
  if (view.bay) await page.evaluate(scrollBayToTop);
  // A theme switch starts colour transitions (the header's icon buttons); reduced motion does
  // not stop a CSS transition, so wait until none runs (1 in 2 light captures differed by 27 px).
  await page.waitForFunction(() => document.getAnimations()
    .every((a) => !(a instanceof CSSTransition) || a.playState !== 'running'), null,
  { timeout: LOAD_MS });
  await page.mouse.move(0, view.height - 1);
  await page.evaluate(() => { window.OSCILLA.app.alerts = []; });
  await frames(page);
  const s = await page.evaluate(inspect, { pairs: CABLES, bay: view.bay,
    park: [0, view.height - 1] });
  const want = CABLES.map(([a, b]) => `${a} -> ${b}`).sort();
  if (s.tab !== view.tab) problems.push(`the Synth shows the ${s.tab} tab, not ${view.tab}`);
  if (s.engine !== ENGINE) problems.push(`the Engines tab's engine is ${s.engine}, not ${ENGINE}`);
  if (JSON.stringify(s.cables) !== JSON.stringify(want)) {
    problems.push(`the patch holds ${s.cables.length} cables (${s.cables.join(', ')}), not the six`);
  }
  if (s.drawn !== 6) problems.push(`${s.drawn} cables drawn in the bay, not 6`);
  if (s.armed || s.voices) problems.push(`the engine is armed (${s.armed}) or sounds (${s.voices})`);
  if (s.theme !== view.theme) problems.push(`the page is in the ${s.theme} theme`);
  if (s.hidden.length) problems.push(`cable ends not visible: ${s.hidden.join(', ')}`);
  if (s.parked) problems.push(`the parked pointer hovers ${s.parked}`);
  if (s.alerts) problems.push(`${s.alerts} notice(s) on screen`);
  const file = path.join(out, `current-${view.id}.png`);
  await page.screenshot({ path: file });
  await page.close();
  return { file, errors, problems };
}

function compare(currentFile, referenceFile, diffFile) {
  const { PNG } = requireHere('pngjs');
  const pixelmatchMod = requireHere('pixelmatch');
  const pixelmatch = pixelmatchMod.default || pixelmatchMod;
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

async function main(argv) {
  const opts = parseArgs(argv);
  if (opts.unknown.length || (opts.only && !opts.views.length)) {
    throw new Error(`unknown view(s) ${opts.unknown.join(', ') || '(none given)'}; views: `
      + VIEWS.map((v) => v.id).join(', '));
  }
  const { chromium } = requireHere('playwright');
  mkdirSync(opts.out, { recursive: true });
  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const version = browser.version();
  const meta = existsSync(META_FILE) ? JSON.parse(readFileSync(META_FILE, 'utf8'))
    : { schema: 1, environments: {} };
  const failures = [];
  const lines = [`SYN visual reference ${ENV} chromium ${version}`
    + `${opts.only ? ` (views ${opts.views.map((v) => v.id).join(', ')})` : ''}`];
  const prior = meta.environments[ENV];
  if (opts.update && opts.only && prior && prior.browser !== version) {
    await browser.close();
    throw new Error(`${ENV} references were accepted with chromium ${prior.browser}, this run is `
      + `${version}: accepting only some views would mix builds; re-accept all views`);
  }
  try {
    for (const view of opts.views) {
      const { file, errors, problems } = await capture(browser, view, opts.out, opts.target);
      for (const e of errors) failures.push(`${view.id}: page error ${e}`);
      for (const e of problems) failures.push(`${view.id}: ${e}`);
      const ref = path.join(REF_DIR, `${ENV}-${view.id}.png`);
      if (opts.update) {
        if (errors.length) throw new Error(`page errors, refusing to accept: ${errors.join('; ')}`);
        if (problems.length) throw new Error(`refusing to accept ${view.id}: ${problems.join('; ')}`);
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
      const r = compare(file, ref, path.join(opts.out, `diff-${view.id}.png`));
      const bad = r.pct > MAX_MISMATCH_PCT;
      if (bad) failures.push(`${view.id}: ${r.pct} % of pixels differ (limit ${MAX_MISMATCH_PCT} %)`
        + `${r.note ? `, ${r.note}` : ''}`);
      lines.push(`  ${view.id.padEnd(21)} ${String(r.pct).padStart(7)} % differ  `
        + `${bad ? 'FAIL' : 'ok'}`);
    }
  } finally {
    await browser.close();
  }
  if (opts.update) {
    meta.schema = 1;
    meta.note = 'Accepted SYN references per environment, written only by '
      + 'node scripts/visual-synth.mjs --update-reference.';
    // A partial acceptance (--view) keeps the views accepted before; the list follows VIEWS.
    const had = new Set(opts.only && prior ? (prior.views || []).map((v) => v.split(' ')[0]) : []);
    const views = VIEWS.filter((v) => had.has(v.id) || opts.views.includes(v))
      .map((v) => `${v.id} ${v.width}x${v.height}`);
    meta.environments = { ...meta.environments, [ENV]: { browser: version, engine: ENGINE,
      cables: CABLES.map(([a, b]) => `${a} -> ${b}`), views } };
    meta.environments = Object.fromEntries(Object.entries(meta.environments).sort());
    writeFileSync(META_FILE, `${JSON.stringify(meta, null, 2)}\n`);
  }
  writeFileSync(path.join(opts.out, 'result.json'), `${JSON.stringify({ env: ENV, version,
    failures }, null, 2)}\n`);
  lines.push(failures.length ? `FAIL SYN visual reference: ${failures.length} problem(s); `
    + `artifacts in ${opts.out}` : `PASS SYN visual reference (${opts.views.length} views)`);
  for (const f of failures) lines.push(`   x ${f}`);
  console.log(lines.join('\n'));
  return failures.length === 0;
}

const isMain = Boolean(process.argv[1]) && existsSync(process.argv[1])
  && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
if (isMain) {
  main(process.argv.slice(2)).then((ok) => process.exit(ok ? 0 : 1)).catch((e) => {
    console.error(`FAIL SYN visual reference: ${e.message || e}`);
    process.exit(1);
  });
}
