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
//   phone-<tab>-<theme>    390x844 with touch, the tab's content scrolled to the top of the
//            scroller under the sticky chip nav (CONTENT: the first module card on Panel and
//            Engines, the pad on XY): the docked keyboard covers the screen from y=483 down, so
//            the first screen holds only the header and the tab strip. The capture fails closed
//            unless that element is hit-testable above the dock, and on Panel and Engines unless
//            a knob is seen whole and turning it (End or Home) changes the picture.
//     <tab> is panel, engines or xy (the Engines tab on its default engine, ENGINE; the XY tab
//     with no preset, so its pad is shown disabled), <theme> is dark or light.
//   desktop-bay-<theme>    1536x1400, the Panel tab scrolled so the bay's card is at the top of
//   phone-bay-<theme>      the scroller (390x1400 with touch: the bay's own face, V636, shown
//            through its PATCH BAY chip, under the sticky section nav). The six cables span
//            about 706 px from the Keys row to the VCA row, more than the agreed heights leave
//            above the docked keyboard, so the bay is seen whole in these taller views at the
//            agreed widths (W1's module plates in the bay and its taller dock put the VCA row
//            under the dock at 1536x1280); the capture fails closed unless all 12 cable ends are
//            hit-testable (nothing covers them).
// Below xl the bay is a face of its own (V636): the cables are patched on it, through its chip,
// and the tab views come back to the module cards through the PANEL chip.
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
const SIZES = [['desktop', 1536, 1024, 1400], ['phone', 390, 844, 1400]];
const TABS = ['panel', 'engines', 'xy'];
const THEMES = ['dark', 'light'];
/** What a phone tab view scrolls to the top of the scroller: the tab's own content. */
export const CONTENT = { panel: '[data-module]', engines: '[data-module]',
  xy: '[data-osc="synth.xy.pad"]' };
export const VIEWS = [
  ...SIZES.flatMap(([size, width, height]) => TABS.flatMap((tab) => THEMES.map((theme) =>
    ({ id: `${size}-${tab}-${theme}`, width, height, tab, theme, bay: false,
      content: size === 'phone' ? CONTENT[tab] : null,
      knob: size === 'phone' && CONTENT[tab] === '[data-module]' })))),
  ...SIZES.flatMap(([size, width, , bayHeight]) => THEMES.map((theme) =>
    ({ id: `${size}-bay-${theme}`, width, height: bayHeight, tab: 'panel', theme, bay: true,
      content: null, knob: false }))),
];
const LOAD_MS = 15000;

/**
 * One named wait of a view: `run(timeout)` is the Playwright wait (waitForFunction,
 * waitForSelector); `observe`, evaluated in the page when the wait fails, reports what was seen.
 * A failed wait is rethrown as `SYN <view>: <wait> timed out after <N>ms (<observed>)` (or
 * `failed after`, with the cause, when it was not a timeout), so a timeout names the view and
 * the wait instead of Playwright's bare "Timeout 15000ms exceeded".
 */
export async function namedWait(page, view, wait, run, { observe, arg, timeout = LOAD_MS } = {}) {
  try {
    return await run(timeout);
  } catch (e) {
    let seen = 'nothing observed';
    if (observe) {
      try {
        seen = JSON.stringify(await page.evaluate(observe, arg));
      } catch (o) {
        seen = `observation failed: ${String(o && o.message || o).split('\n')[0]}`;
      }
    }
    const timedOut = (e && e.name === 'TimeoutError') || /Timeout \d+ms exceeded/.test(String(e
      && e.message));
    const cause = timedOut ? '' : `: ${String(e && e.message || e).split('\n')[0]}`;
    throw new Error(`SYN ${view}: ${wait} ${timedOut ? 'timed out' : 'failed'} after `
      + `${timeout}ms (${seen})${cause}`);
  }
}

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

/**
 * Patch one end through the jack's keyboard path (focus, Enter). A jack that cannot take focus
 * (inside a face hidden below xl, V636) would let Enter reach <body> and patch nothing, so the
 * capture fails closed here, naming the view and the jack.
 */
async function tapJack(page, view, id) {
  await namedWait(page, view, `focus jack ${id}`,
    (timeout) => page.locator(`[data-jack="${id}"]`).focus({ timeout }),
    { arg: id, observe: (j) => document.querySelectorAll(`[data-jack="${j}"]`).length
      + ' element(s)' });
  const focused = await page.evaluate(() => document.activeElement
    && document.activeElement.getAttribute('data-jack'));
  if (focused !== id) {
    throw new Error(`SYN ${view}: jack ${id} did not take focus (focus on `
      + `${focused || 'no jack'}): its face is hidden`);
  }
  await page.keyboard.press('Enter');
}

/** Whether a face of the Synth view (V636: 'panel' or 'bay') is shown. */
function faceShown(f) {
  const el = document.querySelector(`#osc-view-synth [data-face-of="${f}"]`);
  return Boolean(el) && getComputedStyle(el).display !== 'none';
}

/**
 * Below xl the Synth view shows the module cards or the patch bay, one at a time (V636): show
 * face `f` through its own chip in the sticky chip bar (focus, Enter), as a person would.
 */
async function showFace(page, view, f) {
  await namedWait(page, view, `focus the ${f} face chip`,
    (timeout) => page.locator(`#osc-view-synth nav [data-face="${f}"]`).focus({ timeout }),
    { arg: f, observe: () => [...document.querySelectorAll('#osc-view-synth nav [data-face]')]
      .map((b) => b.dataset.face) });
  await page.keyboard.press('Enter');
  await namedWait(page, view, `${f} face shown (V636 chip)`,
    (timeout) => page.waitForFunction(faceShown, f, { timeout }), { arg: f,
      observe: () => ['panel', 'bay'].map((x) => {
        const el = document.querySelector(`#osc-view-synth [data-face-of="${x}"]`);
        return `${x}: ${el ? getComputedStyle(el).display : 'absent'}`;
      }) });
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

/**
 * Scroll .osc-main, as scrollBayToTop does, so the first element `sel` names in the Synth view
 * (a tab's first module card, the XY pad) sits at its top. The sticky chip nav sticks inside the
 * scroller's padding, so the element is then brought to 8 px below the nav's stuck bottom edge,
 * where a section chip places its module (gotoSection in src/js/synth/ui.js).
 */
function scrollToTop(sel) {
  const main = document.querySelector('.osc-main');
  const target = document.querySelector(`#osc-view-synth ${sel}`);
  const nav = document.querySelector('#osc-view-synth nav[aria-label^="Synth "]');
  const shown = nav && getComputedStyle(nav).display !== 'none';
  if (!main || !target) return;
  main.scrollTop = Math.round(main.scrollTop + target.getBoundingClientRect().top
    - main.getBoundingClientRect().top - (shown ? nav.offsetHeight : 0));
  if (shown) {
    main.scrollTop = Math.round(main.scrollTop + target.getBoundingClientRect().top
      - nav.getBoundingClientRect().bottom - 8);
  }
}

// Each function below runs in the page through page.evaluate, so it holds what it needs: the
// docked keyboard (#osc-keyboard) begins at its top, or at the viewport's bottom when hidden.

/** The knobs of the Synth view seen whole: above the dock, enabled, hit at their centre. */
function knobsSeen() {
  const dock = document.getElementById('osc-keyboard').getBoundingClientRect();
  const bottom = dock.height ? dock.top : window.innerHeight;
  return [...document.querySelectorAll('#osc-view-synth [data-knob]')].filter((k) => {
    const r = k.getBoundingClientRect();
    if (!r.width || !r.height || r.top < 0 || r.bottom > bottom) return false;
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return Boolean(hit && k.contains(hit)) && k.getAttribute('aria-disabled') !== 'true';
  }).map((k) => k.dataset.knob);
}

/**
 * Turn the knob `cid` to an end of its range through its own key path (End, or Home when it is
 * already at the top), then blur it; returns its value before and the key pressed.
 */
function turnKnob(cid) {
  const k = document.querySelector(`#osc-view-synth [data-knob="${cid}"]`);
  const before = k.getAttribute('aria-valuenow');
  const key = Number(before) >= Number(k.getAttribute('aria-valuemax')) ? 'Home' : 'End';
  k.focus({ preventScroll: true });
  k.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
  if (document.activeElement) document.activeElement.blur();
  return { key, before };
}

/** The free jack whose ring the theme redraw is read on: no cable of CABLES patches it. */
export const FREE_JACK = 'mg.rate:in';

/** The bay redrawn for the view: theme on <html>, the free ring's stroke, the tab, 6 cables. */
function redrawState({ theme, tab, free }) {
  const doc = document.documentElement;
  const dim = getComputedStyle(doc).getPropertyValue('--osc-text-dim').trim();
  const ring = document.querySelector(`[data-jack="${free}"] [data-ring]`);
  return { theme: doc.dataset.theme, want: theme, ring: ring ? ring.getAttribute('stroke') : null,
    dim, tab: window.OSCILLA.app.synthDebug().tab, wantTab: tab,
    drawn: document.querySelectorAll('[data-osc="synth.bay.svg"] [data-cable]').length };
}

function redrawn(v) {
  const { free } = v;
  const doc = document.documentElement;
  const dim = getComputedStyle(doc).getPropertyValue('--osc-text-dim').trim();
  const ring = document.querySelector(`[data-jack="${free}"] [data-ring]`);
  return doc.dataset.theme === v.theme && ring && ring.getAttribute('stroke') === dim
    && window.OSCILLA.app.synthDebug().tab === v.tab
    && document.querySelectorAll('[data-osc="synth.bay.svg"] [data-cable]').length === 6;
}

function settled() {
  return document.getAnimations()
    .every((a) => !(a instanceof CSSTransition) || a.playState !== 'running');
}

/** The CSS transitions still running: their element and property, at most eight. */
function runningTransitions() {
  const run = document.getAnimations().filter((a) => a instanceof CSSTransition
    && a.playState === 'running');
  const where = (el) => (el ? `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ''}`
    + `${el.getAttribute && el.getAttribute('data-osc') ? `[${el.getAttribute('data-osc')}]` : ''}`
    + `${el.getAttribute && el.getAttribute('class') ? `.${String(el.getAttribute('class'))
      .trim().split(/\s+/).slice(0, 3).join('.')}` : ''}` : '?');
  return { running: run.length, first: run.slice(0, 8).map((a) => `${where(a.effect
    && a.effect.target)} ${a.transitionProperty} ${a.effect && a.effect.getTiming().duration}ms`
    + ` ${a.effect && a.effect.getTiming().iterations}x`) };
}

/** What the capture must hold before its picture is worth comparing. */
function inspect({ pairs, bay, park, content }) {
  const app = window.OSCILLA.app;
  const d = app.synthDebug();
  // The element the view scrolled to must be seen: below the chip nav, its top edge above the
  // docked keyboard, and hit at a point just inside that edge (nothing covers it).
  let unseen = null;
  if (content) {
    const el = document.querySelector(`#osc-view-synth ${content}`);
    const nav = document.querySelector('#osc-view-synth nav[aria-label^="Synth "]');
    const navBottom = nav && getComputedStyle(nav).display !== 'none'
      ? nav.getBoundingClientRect().bottom : 0;
    const dock = document.getElementById('osc-keyboard').getBoundingClientRect();
    const dockTop = dock.height ? dock.top : window.innerHeight;
    const r = el && el.getBoundingClientRect();
    const hit = r && document.elementFromPoint(r.left + r.width / 2,
      r.top + Math.min(12, r.height / 2));
    if (!el) unseen = 'is not drawn';
    else if (r.top < navBottom - 1) unseen = `is under the chip nav (top ${Math.round(r.top)})`;
    else if (r.top + 24 > dockTop) {
      unseen = `is under the docked keyboard (top ${Math.round(r.top)}, `
        + `dock ${Math.round(dockTop)})`;
    } else if (!(hit && el.contains(hit))) unseen = 'is covered at its top edge';
  }
  const ends = pairs.flatMap(([a, b]) => [`${a}:out`, `${b}:in`]);
  const hidden = bay ? ends.map((id) => {
    const j = document.querySelector(`[data-jack="${id}"]`);
    if (!j) return `${id} (not drawn)`;
    const r = j.getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    if (hit && j.contains(hit)) return null;
    const by = hit && (hit.closest('[data-osc]') || hit);
    return `${id} (under ${by ? `${by.tagName.toLowerCase()}${by.id ? `#${by.id}` : ''}`
      + `${by.getAttribute('data-osc') ? `[${by.getAttribute('data-osc')}]` : ''}` : 'nothing'})`;
  }).filter(Boolean) : [];
  const under = document.elementFromPoint(park[0], park[1]);
  const interactive = under && under.closest('a[href], button, input, select, textarea, '
    + '[tabindex], [role=button], [role=slider], [data-knob], [data-jack]');
  return { tab: d.tab, engine: d.engine, armed: d.armed, voices: d.voices,
    cables: d.cables.map((c) => `${c.from} -> ${c.to}`).sort(),
    drawn: document.querySelectorAll('[data-osc="synth.bay.svg"] [data-cable]').length,
    theme: document.documentElement.dataset.theme, hidden, unseen,
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
  await namedWait(page, view.id, `load ${target}`,
    (timeout) => page.goto(targetUrl(target), { timeout }));
  const wait = (name, fn, arg, observe) => namedWait(page, view.id, name,
    (timeout) => page.waitForFunction(fn, arg, { timeout }), { observe, arg });
  await namedWait(page, view.id, 'app ready (html[data-ready="true"])',
    (timeout) => page.waitForSelector('html[data-ready="true"]', { timeout }),
    { observe: () => ({ ready: document.documentElement.dataset.ready || null,
      app: Boolean(window.OSCILLA && window.OSCILLA.app) }) });
  await page.evaluate(() => {
    const a = window.OSCILLA.app;
    if (!a.safetyCollapsed) a.collapseSafety();
    a.alerts = [];
    a.setWorkspace('synth');
  });
  await wait('Synth workspace shown with its bay', () => window.OSCILLA.app.synthDebug().present
    && !document.getElementById('osc-view-synth').hidden
    && document.querySelector('[data-osc="synth.bay.svg"]'), null, () => {
    const v = document.getElementById('osc-view-synth');
    return { present: window.OSCILLA.app.synthDebug().present, hidden: v ? v.hidden : 'no view',
      bay: Boolean(document.querySelector('[data-osc="synth.bay.svg"]')) };
  });
  // Below xl the bay is a face of its own (V636): patch on it, then come back to the module
  // cards unless the view is the bay's.
  const faced = !(await page.evaluate(faceShown, 'bay'));
  if (faced) await showFace(page, view.id, 'bay');
  for (const [a, b] of CABLES) {
    await tapJack(page, view.id, `${a}:out`);
    await tapJack(page, view.id, `${b}:in`);
  }
  if (faced && !view.bay) await showFace(page, view.id, 'panel');
  await page.evaluate((t) => window.OSCILLA.app.synthTab(t), view.tab);
  await frames(page);
  await frames(page);
  await page.evaluate((t) => {
    if (window.OSCILLA.app.theme !== t) window.OSCILLA.app.toggleTheme();
  }, view.theme);
  // The bay is redrawn from the theme's tokens: a free jack's ring (its data-ring hook, the
  // stroke the 3:1 check reads) is --osc-text-dim; the tab is rendered on a frame. Wait for both,
  // and for the six cables to be drawn.
  await wait('theme redraw (free ring = --osc-text-dim, tab, 6 cables drawn)', redrawn,
    { theme: view.theme, tab: view.tab, free: FREE_JACK }, redrawState);
  await frames(page);
  await page.evaluate(resetScroll);
  if (view.bay) await page.evaluate(scrollBayToTop);
  else if (view.content) await page.evaluate(scrollToTop, view.content);
  // A theme switch starts colour transitions (the header's icon buttons); reduced motion does
  // not stop a CSS transition, so wait until none runs (1 in 2 light captures differed by 27 px).
  await wait('no CSS transition running', settled, null, runningTransitions);
  await page.mouse.move(0, view.height - 1);
  await page.evaluate(() => { window.OSCILLA.app.alerts = []; });
  await frames(page);
  const s = await page.evaluate(inspect, { pairs: CABLES, bay: view.bay,
    park: [0, view.height - 1], content: view.content });
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
  if (s.unseen) problems.push(`the view's content ${view.content} ${s.unseen}`);
  if (s.parked) problems.push(`the parked pointer hovers ${s.parked}`);
  if (s.alerts) problems.push(`${s.alerts} notice(s) on screen`);
  const file = path.join(out, `current-${view.id}.png`);
  const shot = await page.screenshot({ path: file });
  // A phone view must move when a knob does: turn the first knob seen whole and capture again.
  let probe = null;
  if (view.knob) {
    const knobs = await page.evaluate(knobsSeen);
    if (!knobs.length) problems.push('no knob is seen whole above the docked keyboard');
    else {
      const scrolled = await page.evaluate(() => document.querySelector('.osc-main').scrollTop);
      const turn = await page.evaluate(turnKnob, knobs[0]);
      await frames(page);
      turn.after = await page.evaluate((cid) => {
        const k = document.querySelector(`#osc-view-synth [data-knob="${cid}"]`);
        return k && k.getAttribute('aria-valuenow');
      }, knobs[0]);
      await wait(`no CSS transition running after turning ${knobs[0]}`, settled, null,
        runningTransitions);
      const again = await page.evaluate(() => document.querySelector('.osc-main').scrollTop);
      const r = diffPct(shot, await page.screenshot());
      probe = { knob: knobs[0], seen: knobs.length, ...turn, pct: r.pct };
      if (turn.before === turn.after) {
        problems.push(`turning ${knobs[0]} (${turn.key}) kept its value`);
      }
      if (again !== scrolled) problems.push(`turning ${knobs[0]} scrolled the view`);
      if (!(r.n > 0)) problems.push(`turning ${knobs[0]} changed no pixel of the view`);
    }
  }
  await page.close();
  return { file, errors, problems, probe };
}

/** The pixels two equal-sized PNG buffers differ by, with the compare settings of the gate. */
function diffPct(a, b, diffFile) {
  const { PNG } = requireHere('pngjs');
  const pixelmatchMod = requireHere('pixelmatch');
  const pixelmatch = pixelmatchMod.default || pixelmatchMod;
  const x = PNG.sync.read(a);
  const y = PNG.sync.read(b);
  if (x.width !== y.width || x.height !== y.height) {
    return { n: null, pct: 100, note: `size ${x.width}x${x.height} vs ${y.width}x${y.height}` };
  }
  const diff = new PNG({ width: x.width, height: x.height });
  const n = pixelmatch(x.data, y.data, diff.data, x.width, x.height,
    { threshold: 0.12, includeAA: false });
  if (diffFile) writeFileSync(diffFile, PNG.sync.write(diff));
  return { n, pct: +(100 * n / (x.width * x.height)).toFixed(3) };
}

function compare(currentFile, referenceFile, diffFile) {
  return diffPct(readFileSync(currentFile), readFileSync(referenceFile), diffFile);
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
      const { file, errors, problems, probe } = await capture(browser, view, opts.out,
        opts.target);
      for (const e of errors) failures.push(`${view.id}: page error ${e}`);
      for (const e of problems) failures.push(`${view.id}: ${e}`);
      if (probe) {
        lines.push(`  ${view.id.padEnd(21)} knob ${probe.knob} ${probe.before} -> ${probe.after} `
          + `moves ${probe.pct} % (${probe.seen} knobs seen)`);
      }
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
