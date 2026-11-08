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
//   node scripts/visual-synth.mjs [target] --measure-noise <runs> [--view <id>[,<id>...]]
//   node scripts/visual-synth.mjs <seeded build> --record-seed <name> --change <text> [--view ...]
//
// --measure-noise captures every view <runs> times against its accepted reference and records,
// per view, the largest count of each kind (the view's noise, from which its bounds are derived);
// --record-seed records what a seeded build (one deliberate small change, built into a scratch
// dist) moves in each view, the counts tests/unit/visual-synth.test.mjs holds above the bounds.
// Both write only references.json, and only when every capture of the run succeeded.
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
//   desktop-bay-<theme>    1536 wide, the Panel tab scrolled so the bay's card is at the top of
//   phone-bay-<theme>      the scroller (390 wide with touch: the bay's own face, V636, shown
//            through its PATCH BAY chip, 8 px under the sticky section nav). The bay's card (its
//            21 plates and the CABLES list) is taller than the agreed heights leave above the
//            docked keyboard (at 1536x1400 and 390x1400 the dock covered six to eight plates),
//            so the bay is seen whole in a taller view at the agreed width. Its height is derived,
//            not pinned: the view grows until the lowest edge it shows (the bay's card, its
//            plates and every module card whose top is above the dock) sits BAY_MARGIN above the
//            docked keyboard (nextBayHeight), so a longer bay (a seventh cable listed) makes a
//            taller picture and fails the size compare instead of slipping under the dock. The
//            capture fails closed unless the bay's card, every plate of the bay ([data-plate])
//            and every module card shown ([data-module]) sit below the section nav and above
//            the docked keyboard (each bay view prints its height and spare pixels), and unless
//            all 12 cable ends are hit-testable (nothing covers them).
// Below xl the bay is a face of its own (V636): the cables are patched on it, through its chip,
// and the tab views come back to the module cards through the PANEL chip.
// Every capture fails closed unless the Synth reports the view's tab, exactly the cables the
// document held before the patch (the default Synth document's own: K183's Y cable) and the
// six patched, a drawn cable for each cable the document has (counted from the document under
// capture, never a literal), no armed engine and no voice, the view's theme on <html>, and the
// parked pointer lands on nothing interactive.
// target: 'dist' (default) -> dist/index.html; any other path or http(s) URL as is.
// --view limits the run to the named views; with --update-reference it accepts only those views
// and leaves every other reference file untouched, and it is refused when this environment's
// references were accepted with a different Chromium build (re-accept all views then).
// --update-reference writes nothing unless every view it accepts captures cleanly: the pictures
// are staged and moved into place with references.json only after the last one, so a failure at
// view k leaves views 1..k-1 and the manifest as they were. Accepting a view drops its recorded
// noise and seed counts, which were measured against the picture it replaces.
// Fails closed like scripts/visual-studio.mjs: a missing reference for this environment
// (<platform>-<arch>), a page error, a capture problem, a different Chromium build, a view
// without recorded stability runs, or a count over the view's bounds exits 1; a view that fails
// to capture is reported and the run goes on to the next. The font is system-ui, so
// each OS has its own references. References live in tests/visual/synth/ with their browser
// version; re-accept them deliberately with --update-reference and state the reason in the pull
// request (linux-x64 in the Playwright container, as tests/README.md describes for the others).
import { existsSync, mkdirSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync }
  from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const requireHere = createRequire(import.meta.url);

export const REF_DIR = path.join(ROOT, 'tests/visual/synth');
const META_FILE = path.join(REF_DIR, 'references.json');
const ENV = `${process.platform}-${process.arch}`;
/**
 * The gate counts pixels, not a share of the view: 0.5 % of a desktop view (~7,800 px) with
 * pixelmatch at 0.12 and the anti-aliased pixels left out passed a knob pointer 1 px wider,
 * plate screws moved 1 px and the brushed finish removed (review of fd4abde6). A view fails when
 * more pixels than its bounds allow differ at DIFF_THRESHOLD (`px`), or at threshold 0 (`faint`:
 * a broad, faint change such as a finish), anti-aliased pixels counted in both.
 *
 * The bounds are derived per view and environment from that view's own noise: the largest count
 * of each kind over NOISE_RUNS or more repeat captures against the accepted reference, recorded
 * in references.json (environments.<env>.noise.<view>) by --measure-noise. A bound is
 * NOISE_FACTOR times the observed largest count, never below its floor (DIFF_FLOOR_PX,
 * FAINT_FLOOR_PX); a view without recorded runs fails closed. One global faint bound (1000 px,
 * the 338 px one desktop view showed once, with room) let a screw cap 0.5 px narrower through
 * every panel view and failed it only on the desktop bay, by its faint count (review of
 * b1eb3e6d); a small view's noise is a few pixels, so its own bound catches it there too.
 * The faint floor is 1.5 x the largest one-off count seen on a view whose stability runs showed
 * none: linux-x64 phone-bay-light, 0 over 10 and over 20 runs, once 62 px in a gate run (W1b).
 * The seeded mutations (environments.<env>.seeds, --record-seed) are what each bound is checked
 * against: tests/unit/visual-synth.test.mjs holds that every view a seed must fail still
 * exceeds its bound by SEED_MARGIN, so loosening a factor, a floor or a recorded noise fails it.
 */
export const DIFF_THRESHOLD = 0.05;
export const NOISE_RUNS = 10;
export const NOISE_FACTOR = 3;
export const DIFF_FLOOR_PX = 24;
export const FAINT_FLOOR_PX = 96;
export const SEED_MARGIN = 1.5;
/**
 * Text every release changes, pinned before each capture: the status bar's version label. Its
 * pixels and its width (one minor's label renders a fraction wider than the last's and moves the
 * tagline and the centred readout after it: 447 of desktop-panel-dark's 488 px) would fail every
 * view at each release. Pinned, the label reads the same in the reference and the capture, and the rest
 * of the status bar is compared as before.
 */
export const PINNED_TEXT = [['[data-osc="status.version"]', 'v0.0.0'],
  // The page header's summary is the shell's copy, judged by the gate's pageHeader region; SYN
  // pins it to the text its references were taken with, so a wording edit (#437's U085) does not
  // fail the 8 desktop views of the Synth panel it sits above.
  ['[data-osc="page.summary"]', 'A semi-modular mono voice on the Studio model with a patch bay '
    + 'and docked keys, and an Engines tab of additive, FM, AM and ring, wavetable, hard-sync and '
    + 'percussion voices.']];

/** Set each pinned element's text in `doc`; the count pinned (runs in the page as well). */
export function pinText(doc, pins) {
  let n = 0;
  for (const [sel, text] of pins) {
    for (const el of doc.querySelectorAll(sel)) {
      el.textContent = text;
      n += 1;
    }
  }
  return n;
}

/** A view's bounds from its recorded noise ({ runs, px, faint }), or null without enough runs. */
export function bounds(noise) {
  if (!noise || !(noise.runs >= NOISE_RUNS)) return null;
  return { px: Math.max(DIFF_FLOOR_PX, Math.ceil(NOISE_FACTOR * noise.px)),
    faint: Math.max(FAINT_FLOOR_PX, Math.ceil(NOISE_FACTOR * noise.faint)) };
}
/** The Engines tab's default engine (ENGINE_IDS[0]); a reorder moves the Engines views. */
export const ENGINE = 'additive';
export const CABLES = [['keys.velocity', 'vco2.tune'], ['vco1.audio', 'ring.modulator'],
  ['vco2.audio', 'mix.in4'], ['ring.audio', 'mix.in3'], ['noise.audio', 'mix.in1'],
  ['mix.audio', 'vca.audio']];
/**
 * [size, width, height]. A bay view opens at the size's height and grows to its derived one
 * (nextBayHeight): with the bay's card scrolled to the top, until the lowest edge it shows sits
 * BAY_MARGIN above the docked keyboard. On the desktop the module grid beside the bay reaches
 * lower than the bay (S&H and OUTPUT end 137 px below the bay's card, W1b), so it sets the height.
 */
const SIZES = [['desktop', 1536, 1024], ['phone', 390, 844]];
/** The space a bay view leaves between the lowest edge it shows and the docked keyboard. */
export const BAY_MARGIN = 8;
/** At most this many resizes before a bay view's height must have settled. */
const BAY_FITS = 6;
/**
 * The next height of a bay view at height `h`, from what it shows there: `bottom`, the lowest
 * edge of the bay's card, its plates and the module cards whose top is above the dock, and
 * `dock`, the docked keyboard's top. The height has settled when it returns `h`.
 */
export function nextBayHeight(h, { bottom, dock }) {
  return h + bottom + BAY_MARGIN - dock;
}
/** The bay's card, scrolled to the top of the scroller in a bay view. */
export const BAY = '[data-osc="synth.bay"]';
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
  ...SIZES.flatMap(([size, width, height]) => THEMES.map((theme) =>
    ({ id: `${size}-bay-${theme}`, width, height, tab: 'panel', theme, bay: true,
      content: null, knob: false }))),
];
const LOAD_MS = 15000;
/** The deadline of one page.evaluate, a keyboard press or a pointer move. */
const STEP_MS = 10000;
/** The deadline of a failed wait's observation (the page may be the thing that stalled). */
const OBSERVE_MS = 2000;

/**
 * `p`, or a TimeoutError once `ms` have passed: page.evaluate, keyboard.press and mouse.move
 * take no deadline of their own, so a stalled page would hang the run without naming the view.
 */
export function deadline(p, ms) {
  let timer;
  const late = new Promise((resolve, reject) => {
    timer = setTimeout(() => reject(Object.assign(new Error(`Timeout ${ms}ms exceeded.`),
      { name: 'TimeoutError' })), ms);
  });
  return Promise.race([p, late]).finally(() => clearTimeout(timer));
}

/**
 * One named wait of a view: `run(timeout)` is the Playwright wait (waitForFunction,
 * waitForSelector); `observe`, evaluated in the page when the wait fails, reports what was seen.
 * A failed wait is rethrown as `SYN <view>: <wait> timed out after <N>ms (<observed>)` (or
 * `failed after`, with the cause, when it was not a timeout), so a timeout names the view and
 * the wait instead of Playwright's bare "Timeout 15000ms exceeded".
 */
export async function namedWait(page, view, wait, run,
  { observe, arg, timeout = LOAD_MS, observeTimeout = OBSERVE_MS } = {}) {
  try {
    return await run(timeout);
  } catch (e) {
    let seen = 'nothing observed';
    if (observe) {
      try {
        seen = JSON.stringify(await deadline(page.evaluate(observe, arg), observeTimeout));
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

/**
 * One page step of a view (a page.evaluate, a key, a pointer move, a resize) under a named
 * deadline: `act()` starts it, and a step that has not settled by then fails as a named wait.
 */
export function step(page, view, name, act, { timeout = STEP_MS } = {}) {
  return namedWait(page, view, name, (t) => deadline(act(), t), { timeout });
}

const VALUE_OPTIONS = ['--out', '--view', '--measure-noise', '--record-seed', '--change'];

export function parseArgs(argv) {
  const option = (name) => {
    const i = argv.indexOf(name);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const positional = argv.filter((a, i) => !a.startsWith('--')
    && !VALUE_OPTIONS.includes(argv[i - 1]));
  const only = option('--view') ? option('--view').split(',').filter(Boolean) : null;
  const update = argv.includes('--update-reference');
  const measuring = argv.includes('--measure-noise');
  const noise = measuring ? Number(option('--measure-noise')) : 0;
  const seed = option('--record-seed') || null;
  const change = option('--change') || null;
  const refused = [];
  if ([update, measuring, argv.includes('--record-seed')].filter(Boolean).length > 1) {
    refused.push('--update-reference, --measure-noise and --record-seed are one mode each');
  }
  if (measuring && !(Number.isInteger(noise) && noise >= 1)) {
    refused.push(`--measure-noise takes a number of runs (1 or more), not ${
      option('--measure-noise')}`);
  }
  if (argv.includes('--record-seed') && !(seed && /^[a-z0-9][a-z0-9-]*$/.test(seed) && change)) {
    refused.push('--record-seed takes a name (a-z, 0-9, -) and --change <what the seed changed>');
  }
  return {
    target: positional[0] || 'dist',
    out: path.resolve(option('--out') || path.join(ROOT, 'tests/visual/out-synth')),
    update,
    noise,
    seed: seed && change ? { name: seed, change } : null,
    refused,
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

/** Two animation frames of the page, under a deadline that names the view. */
const twoFrames = () => new Promise((r) => {
  requestAnimationFrame(() => requestAnimationFrame(r));
});
const frames = (page, view) => step(page, view, 'two animation frames',
  () => page.evaluate(twoFrames));

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
  const focused = await step(page, view, `read the focus after ${id}`,
    () => page.evaluate(() => document.activeElement
      && document.activeElement.getAttribute('data-jack')));
  if (focused !== id) {
    throw new Error(`SYN ${view}: jack ${id} did not take focus (focus on `
      + `${focused || 'no jack'}): its face is hidden`);
  }
  await step(page, view, `press Enter on jack ${id}`, () => page.keyboard.press('Enter'));
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
  await step(page, view, `press Enter on the ${f} face chip`, () => page.keyboard.press('Enter'));
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

/**
 * Scroll .osc-main so the first element `sel` names in the Synth view (a tab's first module card,
 * the XY pad, the bay's card) sits at its top. The sticky chip nav sticks inside the
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

/**
 * The bay redrawn for the view: theme on <html>, the free ring's stroke = --osc-text-dim, the
 * tab, and a drawn cable for each cable the document now has, once it has the `cables` the
 * capture expects (its own and the six patched). One check for the wait and its observation:
 * whether it holds, or, with `observe`, what was seen. Runs in the page.
 */
export function redrawState(v) {
  const doc = document.documentElement;
  const dim = getComputedStyle(doc).getPropertyValue('--osc-text-dim').trim();
  const ring = document.querySelector(`[data-jack="${v.free}"] [data-ring]`);
  const state = { theme: doc.dataset.theme, want: v.theme,
    ring: ring ? ring.getAttribute('stroke') : null, dim,
    tab: window.OSCILLA.app.synthDebug().tab, wantTab: v.tab,
    cables: window.OSCILLA.app.synthDebug().cables.length, wantCables: v.cables,
    drawn: document.querySelectorAll('[data-osc="synth.bay.svg"] [data-cable]').length };
  const ok = state.theme === v.theme && state.ring === dim && state.tab === v.tab
    && state.cables === v.cables && state.drawn === state.cables;
  return v.observe ? state : ok;
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

/**
 * What a bay view shows, for its height (nextBayHeight): the lowest bottom edge of the bay's
 * card, its plates and every module card drawn with its top above the docked keyboard, and the
 * dock's top.
 */
function bayExtent() {
  const dock = document.getElementById('osc-keyboard').getBoundingClientRect();
  const dockTop = dock.height ? dock.top : window.innerHeight;
  const card = document.querySelector('[data-osc="synth.bay"]');
  const shown = [card, ...(card ? card.querySelectorAll('[data-plate]') : []),
    ...document.querySelectorAll('#osc-view-synth [data-module]')].filter(Boolean)
    .map((el) => el.getBoundingClientRect()).filter((r) => r.width && r.height && r.top < dockTop);
  return { bottom: Math.ceil(Math.max(0, ...shown.map((r) => r.bottom))),
    dock: Math.round(dockTop) };
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
  // The bay is seen whole: its card and every plate in it below the section nav (when shown)
  // and above the docked keyboard, so no plate is left out of every view; so is every module
  // card the view shows (its top above the dock: on the desktop the grid beside the bay, whose
  // S&H card held its SMOOTH switch under the dock at 1536x2100, review of b1eb3e6d).
  let plates = [];
  let fit = null;
  if (bay) {
    const card = document.querySelector('[data-osc="synth.bay"]');
    const nav = document.querySelector('#osc-view-synth nav[aria-label^="Synth "]');
    const navBottom = nav && getComputedStyle(nav).display !== 'none'
      ? nav.getBoundingClientRect().bottom : 0;
    const dock = document.getElementById('osc-keyboard').getBoundingClientRect();
    const dockTop = dock.height ? dock.top : window.innerHeight;
    const out = (el, name) => {
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) return `${name} (not drawn)`;
      if (r.top < navBottom - 1 || r.bottom > dockTop) {
        return `${name} (${Math.round(r.top)}-${Math.round(r.bottom)}, nav ${Math.round(navBottom)}`
          + `, dock ${Math.round(dockTop)})`;
      }
      return null;
    };
    const all = card ? [...card.querySelectorAll('[data-plate]')] : [];
    // The module cards shown: drawn (a hidden face draws none), their top above the dock.
    const modules = [...document.querySelectorAll('#osc-view-synth [data-module]')]
      .filter((m) => !card || !(m.contains(card) || card.contains(m))).filter((m) => {
        const r = m.getBoundingClientRect();
        return r.width && r.height && r.top < dockTop;
      });
    const c = card && card.getBoundingClientRect();
    if (c) {
      const low = Math.max(c.bottom, ...modules.map((m) => m.getBoundingClientRect().bottom));
      fit = { top: Math.round(c.top), bottom: Math.round(c.bottom), low: Math.round(low),
        modules: modules.length, dock: Math.round(dockTop) };
    }
    plates = !card ? ['the bay card (not drawn)'] : !all.length ? ['no [data-plate] in the bay']
      : [out(card, 'the bay card'), ...all.map((p) => out(p, p.getAttribute('data-plate'))),
        ...modules.map((m) => out(m, `module card ${m.getAttribute('data-module')}`))]
        .filter(Boolean);
  }
  const under = document.elementFromPoint(park[0], park[1]);
  const interactive = under && under.closest('a[href], button, input, select, textarea, '
    + '[tabindex], [role=button], [role=slider], [data-knob], [data-jack]');
  return { tab: d.tab, engine: d.engine, armed: d.armed, voices: d.voices,
    cables: d.cables.map((c) => `${c.from} -> ${c.to}`).sort(),
    drawn: document.querySelectorAll('[data-osc="synth.bay.svg"] [data-cable]').length,
    theme: document.documentElement.dataset.theme, hidden, unseen, plates, fit,
    parked: interactive ? (interactive.getAttribute('data-osc') || interactive.tagName) : null,
    alerts: app.alerts.length };
}

async function capture(browser, view, out, target) {
  const page = await browser.newPage({ viewport: { width: view.width, height: view.height },
    deviceScaleFactor: 1, reducedMotion: 'reduce', hasTouch: view.width < 600 });
  try {
    return await captureOn(page, view, out, target);
  } finally {
    await deadline(page.close(), STEP_MS).catch(() => {});
  }
}

async function captureOn(page, view, out, target) {
  const id = view.id;
  const errors = [];
  const problems = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  // Every page.evaluate of the capture runs as a named step with a deadline.
  const ev = (name, fn, arg) => step(page, id, name, () => page.evaluate(fn, arg));
  // The bare URL: the #m=synth link raises a notice that dismisses itself on a timer.
  await namedWait(page, id, `load ${target}`,
    (timeout) => page.goto(targetUrl(target), { timeout }));
  const wait = (name, fn, arg, observe) => namedWait(page, id, name,
    (timeout) => page.waitForFunction(fn, arg, { timeout }), { observe, arg });
  await namedWait(page, id, 'app ready (html[data-ready="true"])',
    (timeout) => page.waitForSelector('html[data-ready="true"]', { timeout }),
    { observe: () => ({ ready: document.documentElement.dataset.ready || null,
      app: Boolean(window.OSCILLA && window.OSCILLA.app) }) });
  await ev('collapse the safety panel and open the Synth', () => {
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
  const faced = !(await ev('read whether the bay face is shown', faceShown, 'bay'));
  if (faced) await showFace(page, id, 'bay');
  // The cables the document has before the patch (K183's default Y cable): expected beside it.
  const own = await ev('read the cables the document already has',
    () => window.OSCILLA.app.synthDebug().cables.map((c) => `${c.from} -> ${c.to}`));
  const want = [...own, ...CABLES.map(([a, b]) => `${a} -> ${b}`)].sort();
  for (const [a, b] of CABLES) {
    await tapJack(page, id, `${a}:out`);
    await tapJack(page, id, `${b}:in`);
  }
  if (faced && !view.bay) await showFace(page, id, 'panel');
  await ev(`show the ${view.tab} tab`, (t) => window.OSCILLA.app.synthTab(t), view.tab);
  await frames(page, id);
  await frames(page, id);
  await ev(`switch to the ${view.theme} theme`, (t) => {
    if (window.OSCILLA.app.theme !== t) window.OSCILLA.app.toggleTheme();
  }, view.theme);
  // The bay is redrawn from the theme's tokens: a free jack's ring (its data-ring hook, the
  // stroke the 3:1 check reads) is --osc-text-dim; the tab is rendered on a frame. Wait for both,
  // and for every cable the document has to be drawn.
  const redraw = { theme: view.theme, tab: view.tab, free: FREE_JACK, cables: want.length };
  const redrawn = () => namedWait(page, id,
    `theme redraw (free ring = --osc-text-dim, tab, ${want.length} cables drawn)`,
    (timeout) => page.waitForFunction(redrawState, redraw, { timeout }),
    { observe: redrawState, arg: { ...redraw, observe: true } });
  await redrawn();
  await frames(page, id);
  const place = async () => {
    await ev('reset every scroller', resetScroll);
    if (view.bay) await ev('scroll the bay card to the top', scrollToTop, BAY);
    else if (view.content) await ev(`scroll ${view.content} to the top`, scrollToTop, view.content);
  };
  await place();
  // A bay view grows to its derived height (nextBayHeight): resized, placed again and measured
  // until what it shows ends BAY_MARGIN above the dock.
  let height = view.height;
  if (view.bay) {
    const tried = [height];
    for (let i = 0; ; i += 1) {
      const next = nextBayHeight(height, await ev('measure what the bay view shows', bayExtent));
      if (next === height) break;
      if (i >= BAY_FITS) {
        problems.push(`the bay view's height did not settle: ${tried.join(' -> ')} -> ${next}`);
        break;
      }
      height = next;
      tried.push(height);
      await step(page, id, `resize the bay view to ${view.width}x${height}`,
        () => page.setViewportSize({ width: view.width, height }));
      await frames(page, id);
      await place();
      await frames(page, id);
    }
    await redrawn();
  }
  // A theme switch starts colour transitions (the header's icon buttons); reduced motion does
  // not stop a CSS transition, so wait until none runs (1 in 2 light captures differed by 27 px).
  await wait('no CSS transition running', settled, null, runningTransitions);
  await step(page, id, 'park the pointer', () => page.mouse.move(0, height - 1));
  await ev('clear the notices', () => { window.OSCILLA.app.alerts = []; });
  // pinText runs in the page as its own source, so the page and the unit test share one body.
  const pinned = await ev('pin the release text', new Function('pins',
    `return (${pinText.toString()})(document, pins);`), PINNED_TEXT);
  if (pinned !== PINNED_TEXT.length) {
    throw new Error(`${id}: ${pinned} of ${PINNED_TEXT.length} release texts pinned`);
  }
  await frames(page, id);
  const s = await ev('inspect the view', inspect, { pairs: CABLES, bay: view.bay,
    park: [0, height - 1], content: view.content });
  if (s.tab !== view.tab) problems.push(`the Synth shows the ${s.tab} tab, not ${view.tab}`);
  if (s.engine !== ENGINE) problems.push(`the Engines tab's engine is ${s.engine}, not ${ENGINE}`);
  if (JSON.stringify(s.cables) !== JSON.stringify(want)) {
    problems.push(`the patch holds ${s.cables.length} cables (${s.cables.join(', ')}), not the `
      + `${want.length} expected (${want.join(', ')})`);
  }
  if (s.drawn !== s.cables.length) {
    problems.push(`${s.drawn} cables drawn in the bay for the document's ${s.cables.length}`);
  }
  if (s.armed || s.voices) {
    problems.push(`the engine is armed (${s.armed}) or sounds (${s.voices})`);
  }
  if (s.theme !== view.theme) problems.push(`the page is in the ${s.theme} theme`);
  if (s.hidden.length) problems.push(`cable ends not visible: ${s.hidden.join(', ')}`);
  if (s.plates.length) problems.push(`bay plates not seen whole above the docked keyboard: `
    + s.plates.join(', '));
  if (s.unseen) problems.push(`the view's content ${view.content} ${s.unseen}`);
  if (s.parked) problems.push(`the parked pointer hovers ${s.parked}`);
  if (s.alerts) problems.push(`${s.alerts} notice(s) on screen`);
  const file = path.join(out, `current-${id}.png`);
  const shot = await namedWait(page, id, 'screenshot',
    (timeout) => page.screenshot({ path: file, timeout }));
  // A phone view must move when a knob does: turn the first knob seen whole and capture again.
  let probe = null;
  if (view.knob) {
    const knobs = await ev('find the knobs seen whole', knobsSeen);
    if (!knobs.length) problems.push('no knob is seen whole above the docked keyboard');
    else {
      const scrollTop = () => document.querySelector('.osc-main').scrollTop;
      const scrolled = await ev('read the scroll position', scrollTop);
      const turn = await ev(`turn ${knobs[0]}`, turnKnob, knobs[0]);
      await frames(page, id);
      turn.after = await ev(`read ${knobs[0]} after the turn`, (cid) => {
        const k = document.querySelector(`#osc-view-synth [data-knob="${cid}"]`);
        return k && k.getAttribute('aria-valuenow');
      }, knobs[0]);
      await wait(`no CSS transition running after turning ${knobs[0]}`, settled, null,
        runningTransitions);
      const again = await ev(`read the scroll position after turning ${knobs[0]}`, scrollTop);
      const r = diffPx(shot, await namedWait(page, id, `screenshot after turning ${knobs[0]}`,
        (timeout) => page.screenshot({ timeout })));
      probe = { knob: knobs[0], seen: knobs.length, ...turn, px: r.n };
      if (turn.before === turn.after) {
        problems.push(`turning ${knobs[0]} (${turn.key}) kept its value`);
      }
      if (again !== scrolled) problems.push(`turning ${knobs[0]} scrolled the view`);
      if (!(r.n > 0)) problems.push(`turning ${knobs[0]} changed no pixel of the view`);
    }
  }
  return { file, errors, problems, probe, fit: s.fit, height };
}

/**
 * The pixels two equal-sized PNG buffers differ by, counted as the gate counts them: `n` at
 * DIFF_THRESHOLD and `faint` at threshold 0, both with the anti-aliased pixels (a 1 px move of
 * an edge is mostly anti-aliased pixels). The diff image, when asked for, is the faint one.
 */
export function diffPx(a, b, diffFile) {
  const { PNG } = requireHere('pngjs');
  const pixelmatchMod = requireHere('pixelmatch');
  const pixelmatch = pixelmatchMod.default || pixelmatchMod;
  const x = PNG.sync.read(a);
  const y = PNG.sync.read(b);
  if (x.width !== y.width || x.height !== y.height) {
    return { n: null, faint: null, note: `size ${x.width}x${x.height} vs ${y.width}x${y.height}` };
  }
  const n = pixelmatch(x.data, y.data, null, x.width, x.height,
    { threshold: DIFF_THRESHOLD, includeAA: true });
  const diff = new PNG({ width: x.width, height: x.height });
  const faint = pixelmatch(x.data, y.data, diff.data, x.width, x.height,
    { threshold: 0, includeAA: true });
  if (diffFile) writeFileSync(diffFile, PNG.sync.write(diff));
  return { n, faint };
}

/**
 * Why a compare fails the gate (null when it passes): a size change, a view without bounds (no
 * recorded stability runs), or a count over one of the view's bounds (`b`, from bounds()).
 */
export function judge({ n, faint, note }, b) {
  if (n === null || faint === null) return `the size differs (${note})`;
  if (!b) {
    return `no bounds: fewer than ${NOISE_RUNS} stability runs recorded for this view `
      + `(node scripts/visual-synth.mjs --measure-noise ${NOISE_RUNS})`;
  }
  const why = [];
  if (n > b.px) why.push(`${n} px differ (limit ${b.px} at threshold ${DIFF_THRESHOLD})`);
  if (faint > b.faint) why.push(`${faint} px differ faintly (limit ${b.faint} at threshold 0)`);
  return why.length ? why.join(', ') : null;
}

function compare(currentFile, referenceFile, diffFile) {
  return diffPx(readFileSync(currentFile), readFileSync(referenceFile), diffFile);
}

export const META_NOTE = 'Accepted SYN references per environment, written only by '
  + 'node scripts/visual-synth.mjs --update-reference; per view, the noise its bounds are derived '
  + 'from (--measure-noise) and the seeded mutations they are held against (--record-seed).';

const readMeta = (file) => (existsSync(file) ? JSON.parse(readFileSync(file, 'utf8'))
  : { schema: 1, environments: {} });
const firstLine = (e) => String(e && e.message || e).split('\n')[0];
/** An object keyed by view id, in the order of VIEWS. */
const byView = (o) => Object.fromEntries(VIEWS.filter((v) => o[v.id]).map((v) => [v.id, o[v.id]]));
/** `o` without the keys of `ids`. */
const without = (o, ids) => Object.fromEntries(Object.entries(o || {})
  .filter(([k]) => !ids.includes(k)));

/**
 * Write every [file, data] as one step: each to a sibling .tmp first and, once all are written,
 * each moved into place (references.json last), so a failure leaves the old files as they were.
 */
function writeAll(entries) {
  const staged = [];
  try {
    for (const [file, data] of entries) {
      mkdirSync(path.dirname(file), { recursive: true });
      writeFileSync(`${file}.tmp`, data);
      staged.push(file);
    }
  } catch (e) {
    for (const f of staged) rmSync(`${f}.tmp`, { force: true });
    throw e;
  }
  for (const f of staged) renameSync(`${f}.tmp`, f);
}

const row = (view, r, b, verdict) => `  ${view.id.padEnd(21)} ${r.n === null ? r.note
  : `${String(r.n).padStart(6)} px${String(r.faint).padStart(8)} faint`}  ${verdict}`
  + `${b ? `  (limits ${b.px} / ${b.faint})` : ''}`;

/**
 * Run the views once (the gate, --update-reference, --record-seed) or `opts.noise` times
 * (--measure-noise) through `captureView(view)` -> { file, errors, problems, probe, fit, height }
 * and judge, accept or record them against `refDir` and `metaFile`. The gate goes on past a view
 * that fails to capture; the three modes that write stop at the first failure and write nothing.
 * Returns { ok, failures, lines }.
 */
export async function runViews(opts, { captureView, version, env = ENV, refDir = REF_DIR,
  metaFile = META_FILE }) {
  const meta = readMeta(metaFile);
  const prior = meta.environments[env];
  const mode = opts.update ? 'accept' : opts.noise ? 'noise' : opts.seed ? 'seed' : 'gate';
  const doing = { gate: '', accept: ' accepting', noise: ` measuring noise over ${opts.noise} runs`,
    seed: ` recording seed ${opts.seed && opts.seed.name}` }[mode];
  const failures = [];
  const lines = [`SYN visual reference ${env} chromium ${version}${doing}`
    + `${opts.only ? ` (views ${opts.views.map((v) => v.id).join(', ')})` : ''}`];
  if (mode === 'accept' && opts.only && prior && prior.browser !== version) {
    throw new Error(`${env} references were accepted with chromium ${prior.browser}, this run is `
      + `${version}: accepting only some views would mix builds; re-accept all views`);
  }
  if ((mode === 'noise' || mode === 'seed') && !(prior && prior.browser === version)) {
    throw new Error(prior ? `${env} references were accepted with chromium ${prior.browser}, `
      + `this run is ${version}: re-accept them before measuring against them`
      : `no accepted references for ${env}: accept them before measuring against them`);
  }
  const refOf = (v) => path.join(refDir, `${env}-${v.id}.png`);
  const noiseOf = (v) => bounds(prior && prior.noise && prior.noise[v.id]);
  const staged = [];
  const counts = {};
  const runs = mode === 'noise' ? opts.noise : 1;
  for (let run = 1; run <= runs; run += 1) {
    for (const view of opts.views) {
      // A view that throws (a wait that timed out) fails that view; the gate goes on, so one
      // broken view does not hide the state of the others. Accepting or recording stops.
      let shot;
      try {
        shot = await captureView(view);
      } catch (e) {
        const why = `${view.id}: capture failed: ${firstLine(e)}`;
        if (mode !== 'gate') {
          throw new Error(`${why}${runs > 1 ? ` (run ${run})` : ''}; nothing `
            + `${mode === 'accept' ? 'accepted' : 'recorded'}`);
        }
        failures.push(why);
        lines.push(`  ${view.id.padEnd(21)} capture failed`);
        continue;
      }
      const { file, errors, problems, probe, fit } = shot;
      const height = shot.height || view.height;
      if (run === 1 && probe) {
        lines.push(`  ${view.id.padEnd(21)} knob ${probe.knob} ${probe.before} -> ${probe.after} `
          + `moves ${probe.px} px (${probe.seen} knobs seen)`);
      }
      if (run === 1 && fit) {
        lines.push(`  ${view.id.padEnd(21)} ${view.width}x${height}: bay card ${fit.top}-`
          + `${fit.bottom}, lowest edge ${fit.low} (${fit.modules} module cards), dock at `
          + `${fit.dock} (${fit.dock - fit.low} px spare)`);
      }
      const trouble = [...errors.map((e) => `page error ${e}`), ...problems];
      if (mode !== 'gate' && trouble.length) {
        throw new Error(`refusing to ${mode === 'accept' ? 'accept' : 'record'} ${view.id}`
          + `${runs > 1 ? ` (run ${run})` : ''}: ${trouble.join('; ')}; nothing `
          + `${mode === 'accept' ? 'accepted' : 'recorded'}`);
      }
      if (mode === 'accept') {
        staged.push({ view, file, height });
        lines.push(`  ${view.id}: staged ${view.width}x${height}`);
        continue;
      }
      for (const t of trouble) failures.push(`${view.id}: ${t}`);
      const ref = refOf(view);
      if (!prior || !existsSync(ref)) {
        failures.push(`${view.id}: no accepted reference for ${env} (record one deliberately with `
          + '--update-reference)');
        continue;
      }
      if (prior.browser !== version) {
        failures.push(`${view.id}: reference accepted with chromium ${prior.browser}, this run `
          + `is ${version}; re-accept with --update-reference`);
      }
      const r = compare(file, ref, mode === 'gate' ? path.join(opts.out, `diff-${view.id}.png`)
        : null);
      if (mode === 'noise') {
        if (r.n === null) {
          throw new Error(`${view.id} (run ${run}): the size differs (${r.note}); `
            + 'nothing recorded');
        }
        const c = counts[view.id] || { runs: 0, px: 0, faint: 0 };
        counts[view.id] = { runs: c.runs + 1, px: Math.max(c.px, r.n),
          faint: Math.max(c.faint, r.faint) };
        continue;
      }
      const b = noiseOf(view);
      const bad = judge(r, b);
      if (mode === 'seed') {
        counts[view.id] = r.n === null ? { size: r.note } : { px: r.n, faint: r.faint };
        lines.push(row(view, r, b, bad ? 'fails' : 'passes'));
        continue;
      }
      if (bad) failures.push(`${view.id}: ${bad}`);
      lines.push(row(view, r, b, bad ? 'FAIL' : 'ok'));
    }
  }
  const ids = opts.views.map((v) => v.id);
  const entry = (e) => ({ ...meta, schema: 1, note: META_NOTE,
    environments: Object.fromEntries(Object.entries({ ...meta.environments, [env]: e }).sort()) });
  const json = (m) => `${JSON.stringify(m, null, 2)}\n`;
  if (mode === 'accept') {
    // A partial acceptance (--view) keeps the views accepted before; the list follows VIEWS. The
    // noise and seed counts of an accepted view were measured against the picture it replaces.
    const same = prior && prior.browser === version;
    const had = new Map(opts.only && prior ? (prior.views || []).map((v) => [v.split(' ')[0], v])
      : []);
    const views = VIEWS.map((v) => {
      const st = staged.find((x) => x.view.id === v.id);
      return st ? `${v.id} ${v.width}x${st.height}` : had.get(v.id);
    }).filter(Boolean);
    const seeds = same ? Object.fromEntries(Object.entries(prior.seeds || {})
      .map(([k, sd]) => [k, { ...sd, views: without(sd.views, ids) }])) : {};
    writeAll([...staged.map(({ view, file }) => [refOf(view), readFileSync(file)]),
      [metaFile, json(entry({ browser: version, engine: ENGINE,
        cables: CABLES.map(([a, b]) => `${a} -> ${b}`), views,
        noise: same ? without(prior.noise, ids) : {}, seeds }))]]);
    for (const { view } of staged) {
      lines.push(`  ${view.id}: accepted -> ${path.relative(ROOT, refOf(view))}`);
    }
  } else if (mode === 'noise') {
    for (const view of opts.views) {
      const c = counts[view.id];
      const b = bounds(c);
      lines.push(`  ${view.id.padEnd(21)} at most ${String(c.px).padStart(4)} px`
        + `${String(c.faint).padStart(6)} faint over ${c.runs} runs  (limits ${b ? `${b.px} / `
        + `${b.faint}` : `none below ${NOISE_RUNS} runs`})`);
    }
    writeAll([[metaFile, json(entry({ ...prior, noise: byView({ ...prior.noise, ...counts }) }))]]);
  } else if (mode === 'seed') {
    const { name, change } = opts.seed;
    const was = (prior.seeds || {})[name];
    const seeds = { ...prior.seeds, [name]: { change,
      views: byView({ ...(was && was.change === change ? was.views : {}), ...counts }) } };
    writeAll([[metaFile, json(entry({ ...prior, seeds }))]]);
  }
  const what = { gate: `PASS SYN visual reference (${opts.views.length} views)`,
    accept: `PASS SYN visual reference: accepted ${staged.length} views`,
    noise: `PASS SYN visual reference: noise recorded for ${ids.length} views over ${runs} runs`,
    seed: `PASS SYN visual reference: seed ${opts.seed && opts.seed.name} recorded for `
      + `${ids.length} views` }[mode];
  lines.push(failures.length ? `FAIL SYN visual reference: ${failures.length} problem(s); `
    + `artifacts in ${opts.out}` : what);
  for (const f of failures) lines.push(`   x ${f}`);
  return { ok: failures.length === 0, failures, lines };
}

async function main(argv) {
  const opts = parseArgs(argv);
  if (opts.unknown.length || (opts.only && !opts.views.length)) {
    throw new Error(`unknown view(s) ${opts.unknown.join(', ') || '(none given)'}; views: `
      + VIEWS.map((v) => v.id).join(', '));
  }
  if (opts.refused.length) throw new Error(opts.refused.join('; '));
  const { chromium } = requireHere('playwright');
  mkdirSync(opts.out, { recursive: true });
  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const version = browser.version();
  let result;
  try {
    result = await runViews(opts, { version,
      captureView: (view) => capture(browser, view, opts.out, opts.target) });
  } finally {
    await browser.close();
  }
  writeFileSync(path.join(opts.out, 'result.json'), `${JSON.stringify({ env: ENV, version,
    failures: result.failures }, null, 2)}\n`);
  console.log(result.lines.join('\n'));
  return result.ok;
}

const isMain = Boolean(process.argv[1]) && existsSync(process.argv[1])
  && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
if (isMain) {
  main(process.argv.slice(2)).then((ok) => process.exit(ok ? 0 : 1)).catch((e) => {
    console.error(`FAIL SYN visual reference: ${e.message || e}`);
    process.exit(1);
  });
}
