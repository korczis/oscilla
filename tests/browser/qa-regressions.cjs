#!/usr/bin/env node
// suite-pace: solo (stereo analysers on the realtime output against the audio clock)
// OSCILLA V2 final-QA regressions on the built dist/index.html (file://), in chromium, firefox
// and webkit. One fresh page per check. The pure halves are tests/unit/qa-regressions.test.mjs.
//
//   node tests/browser/qa-regressions.cjs [--dist dist/index.html]
//                                         [--browsers chromium,firefox,webkit] [--only a,b]
//
// Checks (QA finding in brackets):
//   phase-offset-correlation [5]  A = B = 440 Hz split stereo: the L/R correlation of a tap on
//                                 the engine output follows cos φ at 0/90/180°; the offline
//                                 render agrees and its B start adds no sample step
//   harmonics-additive [6]        the Harmonics tab table is the additive coefficients
//   scope-window-label [7]        100 ms at the running rate is shown and labelled as such
//   status-duration-sequence [8]  the status bar shows the sequence length while it plays
//   seq-status-duration-follows-edits [C004]  and follows the Add menu and the Loop button
//                                 while it plays (dup-stale-6)
//   contrast [9]                  computed contrast of the fixed fills/texts >= 4.5:1, and
//                                 axe-core color-contrast (wcag2a/aa/21aa), in chromium,
//                                 firefox and webkit (E054, Q097 answer 2): axe-core is an exactly
//                                 pinned devDependency read from node_modules; without it the
//                                 check fails, and a 2:1 fixture must be flagged first
//   analysis-header-no-overlap [12]  tabs vs Pause/Time/fullscreen at 1280-1536 px
//   tablet-nav-focus [13]         768-1279 px: the nav scrolls and rings the workspace panels
//   correlation-states [14]       mono "1.00 mono", stereo "… est." (visible), idle "—"
//   no-per-frame-dom-writes [15]  MutationObserver over 2 s while a tone plays
//   mic-through-engine [16]       mic nodes are the engine's (micNodeCount), 0 after stop;
//                                 an accurate message where the browser has no microphone
//   signal-path-stages [17]       filter, ADSR, additive and stereo router in the path, each
//                                 drawn stage projected from the Playground voice's
//                                 StudioModel (filter node, envelope, stereo split; V421)
//   signal-path-open-in-studio [V605]  the Signal Path's Open in Studio (shown on that tab
//                                 only): by pointer on a clean Studio it opens the drawn
//                                 Playground voice as one unsaved document (every drawn node),
//                                 focus on the Studio heading, the Playground and its drawn
//                                 voice unchanged, nothing playing, and Back returns; by
//                                 keyboard with that copy unsaved the guard dialog names it and
//                                 Keep (focused) changes nothing, Replace opens the voice again;
//                                 by touch (a touch context) it opens; a siren is refused with
//                                 its reason in a warning notice, nothing changed; the dialog's
//                                 description includes the list of what would be lost
//   signal-path-open-in-studio-plays [V605]  the opened held tone and AM voice are one gate
//                                 longer than 1 s; Studio Play still sounds (engine analyser
//                                 peak above 0.005) 1 audio second after it starts, Stop leaves
//                                 an engine census of 0; opened while the Playground holds a
//                                 voice, the notice says it keeps sounding until Studio Play,
//                                 which takes the output
//   additive-gain-field [17]      the gain field shows the played (normalised) level; the
//                                 Nyquist hatching follows the fundamental
//   stereo-max-from-rate [17]     #osc-stereo-fa/fb max = floor(safe maximum of the context)
//   bio-sources-keyboard [17]     a keyboard-reachable sources list with the citations
//   safety-notice [V247]          first-run notice; focus dismiss → reopen → dismiss; stored
//   no-inert-controls [E007]      rule project.no-inert-surfaces (c): every data-osc control
//                                 of every workspace, Studio template selection (every node
//                                 and edge, one clip per track, kind and block type or
//                                 action) and library node type has a handler registered for
//                                 it, or is listed in
//                                 tests/unit/no-inert-surfaces-allowance.json; a fixture
//                                 control without one is found. The hook census (G001): every
//                                 data-osc value those states show is declared in the UI
//                                 catalogue (src/js/ui/catalog/registry.js) or listed in the
//                                 undeclared section of tests/unit/ui-catalog-allowance.json;
//                                 an injected fixture hook is flagged
// Exit code 1 when any check fails.
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const suite = require('./lib/suite.cjs');
const shell = require('./lib/shell.cjs');
const { until } = require('./lib/wait.cjs');

const argv = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};
const ROOT = path.resolve(__dirname, '..', '..');
const DIST = path.resolve(arg('dist', path.join(ROOT, 'dist', 'index.html')));
const RUN = suite.open({ name: 'qa-regressions', browsers: arg('browsers') });
const playwright = RUN.playwright;
const BROWSERS = RUN.browsers;
const ONLY = arg('only', '') ? new Set(arg('only', '').split(',')) : null;

const LAUNCH = {
  chromium: { args: ['--autoplay-policy=no-user-gesture-required',
    '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] },
  firefox: { firefoxUserPrefs: { 'media.autoplay.default': 0, 'media.autoplay.blocking_policy': 0,
    'media.navigator.streams.fake': true, 'media.navigator.permission.disabled': true } },
  webkit: {},
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const INERT_ALLOWANCE = JSON.parse(fs.readFileSync(path.join(ROOT, 'tests', 'unit',
  'no-inert-surfaces-allowance.json'), 'utf8'));
const CATALOG_ALLOWANCE = JSON.parse(fs.readFileSync(path.join(ROOT, 'tests', 'unit',
  'ui-catalog-allowance.json'), 'utf8'));
const WORKSPACES = ['playground', 'analyzer', 'sequencer', 'filter', 'synthesis', 'compare',
  'presets', 'learn'];

// E054 (Q097 answer 2): axe-core is a devDependency pinned exactly in package.json, installed by
// npm ci and read here from node_modules, never from a CDN. Missing, the contrast check fails.
let axeSource = null;
let axeMissing = null;
try {
  axeSource = fs.readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');
} catch (e) {
  axeMissing = `axe-core is not installed (${e.code || e.message}): run npm ci`;
}
/**
 * Known color-contrast violations, each with the plan issue that fixes it (E054). A violation not
 * listed fails the check; a listed one that no longer occurs in an engine fails it too, so the
 * entry is dropped in the change that fixes it. `where` is theme/width/workspace, `target` a
 * fragment of axe's selector for the node.
 */
// U103 fixed the one entry this list started with (the Learn tool links at 3.99:1 in the dark
// theme, PRO.link's primary-500): an entry is added only with the plan issue that fixes it.
const AXE_KNOWN = Object.freeze([]);
/** A 2:1 text contrast (#aaa on #fff is 2.32:1) that axe's color-contrast must flag. */
const AXE_FIXTURE = '<!doctype html><html lang="en"><head><title>axe fixture</title></head>'
  + '<body style="background:#fff"><p style="color:#aaa;font-size:14px">Low contrast</p>'
  + '</body></html>';

// ------------------------------------------------------------------------------ page helpers
/** Reach a workspace through the sidebar (lib/shell.cjs: the drawer and a group as needed). */
const navTo = (page, ws) => shell.navTo(page, ws);

async function open(browser, { width = 1536, height = 1024 } = {}) {
  const context = await browser.newContext({ viewport: { width, height }, acceptDownloads: true });
  const page = await context.newPage();
  page.setDefaultTimeout(10000);
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  await page.goto(pathToFileURL(DIST).href, { waitUntil: 'load' });
  await page.waitForSelector('html[data-ready="true"]', { timeout: 15000 });
  return { context, page, errors };
}

/**
 * Wait, frame by frame, until the smooth scroll of .osc-main has reached its target and stopped:
 * the panel `sel` within 0..24 px of the top of .osc-main (null: scrollTop 0), with scrollTop
 * unchanged over 3 consecutive animation frames. Bounded at 3 s; resolves { ms, settled }.
 * Firefox's smooth scroll from 466 px to 0 takes 670-850 ms (scrollend at 770-950 ms) with or
 * without the V3 workspaces, so a fixed 700 ms wait sometimes read the last pixel (1).
 */
function scrollSettled(page, sel) {
  return page.evaluate((s) => new Promise((resolve) => {
    const main = document.querySelector('.osc-main');
    const p = s ? document.querySelector(s) : null;
    const t0 = performance.now();
    let last = null;
    let still = 0;
    const atTarget = () => {
      if (!p) return main.scrollTop === 0;
      const top = p.getBoundingClientRect().top - main.getBoundingClientRect().top;
      return top >= 0 && top <= 24;
    };
    const frame = () => {
      const y = main.scrollTop;
      still = y === last ? still + 1 : 0;
      last = y;
      const ms = Math.round(performance.now() - t0);
      if (atTarget() && still >= 3) resolve({ ms, settled: true });
      else if (ms > 3000) resolve({ ms, settled: false });
      else requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }), sel);
}

/** Start audio inside a gesture and wait for a running context. */
async function startAudio(page) {
  await page.mouse.click(2, 2);
  await page.evaluate(async () => {
    window.OSCILLA.app.ensureAudio();
    await window.OSCILLA.engine.resume();
  });
  await page.waitForFunction(() => window.OSCILLA.engine.state === 'running', null,
    { timeout: 8000 });
}

/**
 * Set up a dual voice (A, B, stereo) and the phase offset, latch it, and wait until the voice
 * that sounds is the one asked for: not `prevId`, not releasing, with B's offset at `phaseDeg`.
 * Resolves that voice's id. A phase change on a sounding voice restarts it (a FAST_RELEASE_S
 * fade, then a new voice), so this is the restarted voice in place, not yet a steady output;
 * tapCorrelation waits for that.
 */
async function playDual(page, { fa = 440, fb = 440, stereo = true, phaseDeg = 0,
  prevId = null } = {}) {
  await page.evaluate(async ({ fa, fb, stereo }) => {
    const a = window.OSCILLA.app;
    a.setContinuous(true);
    a.source = 'dual';
    a.setDualFreq('a', String(fa));
    a.setDualFreq('b', String(fb));
    a.setStereo(stereo);
  }, { fa, fb, stereo });
  // Alpine effects carry A/B and the route to the Phase & Stereo panel; a phase change made
  // before they have would push the panel's old A/B back onto the dual oscillator.
  const route = stereo ? 'stereo' : 'mono';
  await until(() => page.evaluate(({ fa, fb, route }) => {
    const c = window.OSCILLA.labs.phase.config;
    return Math.abs(c.freqA - fa) < 1e-6 && Math.abs(c.freqB - fb) < 1e-6 && c.route === route;
  }, { fa, fb, route }), { ms: 5000,
    what: `playDual: the Phase & Stereo panel carries A ${fa} Hz, B ${fb} Hz, ${route}` });
  await page.evaluate(async (deg) => {
    const O = window.OSCILLA;
    O.labs.phase.set({ phaseDeg: deg });
    if (!O.app.playing) O.app.toggleLatch();
  }, phaseDeg);
  return until(() => page.evaluate(({ deg, prevId }) => {
    const v = window.OSCILLA.engine.voice;
    return v && !v.ended && !v.releasing && v.id !== prevId && v.phaseDeg === deg ? v.id : null;
  }, { deg: phaseDeg, prevId }), { ms: 8000,
    what: `playDual: a dual voice other than ${prevId} sounds with B at ${phaseDeg}°` });
}

// A channel carries signal above this RMS (the 440 Hz dual voice reads about 0.02 per side).
const TAP_SIGNAL_RMS = 0.005;

/**
 * Pearson L/R correlation and RMS of a 2-channel tap on the engine's output analyser, read once
 * the output is the steady sound of the restarted voice: voice `voiceId` or a later one (ids
 * only grow), not releasing, with B at `deg`. A read counts only when the tap's whole window
 * (fftSize frames at the context's rate) lies after that voice's B start and attack (B starts
 * at most one period of B after t0; the predecessor has faded out by t0) and both channels
 * carry signal; it is steady when it agrees within `tol` with the read of the previous,
 * non-overlapping window of the same voice. Polled through until() against a named wall-clock
 * deadline (project.bounded-test-timing). A fixed sleep here let a starved WebKit runner read a
 * window that straddled the restart: CI run 41120930982 read 0.17 at 180° while the UI read
 * -0.94. On a timeout it resolves { corr: null, stalled, last } so the row shows why.
 */
async function tapCorrelation(page, { voiceId, deg, tol, what }) {
  await page.evaluate(() => {
    const e = window.OSCILLA.engine;
    const ctx = e.ctx;
    // Test probe only (not app code): a splitter and two analysers on the output.
    const sp = ctx.createChannelSplitter(2);
    const L = ctx.createAnalyser();
    const R = ctx.createAnalyser();
    L.fftSize = 8192;
    R.fftSize = 8192;
    e.analyser.connect(sp);
    sp.connect(L, 0);
    sp.connect(R, 1);
    window.__qaTap = { sp, L, R, l: new Float32Array(8192), r: new Float32Array(8192) };
  });
  let prev = null;
  let last = null;
  try {
    return await until(async () => {
      const r = await page.evaluate(({ minId, deg }) => {
        const e = window.OSCILLA.engine;
        const { L, R, l, r: rr } = window.__qaTap;
        const v = e.voice;
        const t = e.ctx.currentTime;
        const windowS = L.fftSize / e.ctx.sampleRate;
        const bSettled = v && v.plan && v.plan.b
          ? v.t0 + 1 / Number(v.plan.b.freq) + v.attack : Infinity;
        const placed = !!v && v.id >= minId && v.phaseDeg === deg && !v.ended && !v.releasing
          && t - windowS >= bSettled;
        L.getFloatTimeDomainData(l);
        R.getFloatTimeDomainData(rr);
        let ml = 0;
        let mr = 0;
        for (let i = 0; i < l.length; i++) { ml += l[i]; mr += rr[i]; }
        ml /= l.length;
        mr /= l.length;
        let sl = 0;
        let sr = 0;
        let slr = 0;
        for (let i = 0; i < l.length; i++) {
          const x = l[i] - ml;
          const y = rr[i] - mr;
          sl += x * x;
          sr += y * y;
          slr += x * y;
        }
        return { t, windowS, placed, id: v ? v.id : null,
          corr: sl > 0 && sr > 0 ? slr / Math.sqrt(sl * sr) : null,
          rms: Math.sqrt(sl / l.length), rmsR: Math.sqrt(sr / l.length) };
      }, { minId: voiceId, deg });
      last = r;
      const usable = r.placed && r.corr != null && r.rms > TAP_SIGNAL_RMS
        && r.rmsR > TAP_SIGNAL_RMS;
      if (!usable || (prev && prev.id !== r.id)) prev = null; // another voice: start over
      if (!usable) return null;
      if (prev && r.t - prev.t < r.windowS) return null; // overlaps the previous window
      const before = prev;
      prev = r;
      return before && Math.abs(r.corr - before.corr) < tol
        ? { corr: r.corr, rms: r.rms, prevCorr: before.corr, id: r.id } : null;
    }, { ms: 10000, what });
  } catch (e) {
    if (e.name !== 'WaitTimeout') throw e;
    return { corr: null, rms: 0, stalled: e.message.split('\n')[0], last };
  } finally {
    await page.evaluate(() => {
      const tap = window.__qaTap;
      delete window.__qaTap;
      if (!tap) return;
      window.OSCILLA.engine.analyser.disconnect(tap.sp);
      tap.sp.disconnect();
    });
  }
}

async function stopAll(page) {
  await page.evaluate(() => {
    const O = window.OSCILLA;
    O.app.stopNow();
    if (O.labs.sequencer && O.labs.sequencer.editor.playing) O.labs.sequencer.editor.stop();
  });
  for (let i = 0; i < 40; i++) {
    if (await page.evaluate(() => window.OSCILLA.engine.activeNodeCount) === 0) return 0;
    await sleep(50);
  }
  return page.evaluate(() => window.OSCILLA.engine.activeNodeCount);
}

function contrastOf(page, selector, pseudoBg) {
  return page.evaluate(({ selector, pseudoBg }) => {
    const el = document.querySelector(selector);
    if (!el) return null;
    const rgb = (s) => {
      const m = /rgba?\(([^)]+)\)/.exec(s);
      if (!m) return null;
      const p = m[1].split(/[\s,/]+/).filter(Boolean).map(Number);
      return { c: p.slice(0, 3), a: p.length > 3 ? p[3] : 1 };
    };
    const lum = ([r, g, b]) => {
      const f = (v) => { const x = v / 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; };
      return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
    };
    // background: the nearest ancestor with an opaque background colour
    let bg = null;
    for (let n = pseudoBg ? document.querySelector(pseudoBg) : el; n; n = n.parentElement) {
      const c = rgb(getComputedStyle(n).backgroundColor);
      if (c && c.a > 0.99) { bg = c.c; break; }
    }
    const cs = getComputedStyle(el);
    const fg = rgb(cs.color);
    const op = Number(cs.opacity);
    let col = fg.c;
    if (op < 1 && bg) col = col.map((v, i) => v * op + bg[i] * (1 - op));
    const a = lum(col);
    const b = lum(bg || [0, 0, 0]);
    return Math.round(((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)) * 100) / 100;
  }, { selector, pseudoBg });
}

// ------------------------------------------------------------------------------ inert controls
// Rule project.no-inert-surfaces, check (c): a data-osc control in the running page has a
// handler registered for it. Installed before any script of the page runs, the registry
// records every addEventListener and removeEventListener per target, so Alpine's bindings and
// the imperative ones of src/js are seen alike.
function listenerRegistry() {
  const reg = new WeakMap();
  const add = EventTarget.prototype.addEventListener;
  const remove = EventTarget.prototype.removeEventListener;
  const capture = (opts) => (typeof opts === 'boolean' ? opts : !!(opts && opts.capture));
  const key = (type, opts) => `${type}|${capture(opts)}`;
  EventTarget.prototype.addEventListener = function addEventListener(type, fn, opts) {
    if (fn) {
      let byKey = reg.get(this);
      if (!byKey) { byKey = new Map(); reg.set(this, byKey); }
      if (!byKey.has(key(type, opts))) byKey.set(key(type, opts), new Set());
      byKey.get(key(type, opts)).add(fn);
    }
    return add.call(this, type, fn, opts);
  };
  EventTarget.prototype.removeEventListener = function removeEventListener(type, fn, opts) {
    const byKey = reg.get(this);
    if (byKey && byKey.has(key(type, opts))) byKey.get(key(type, opts)).delete(fn);
    return remove.call(this, type, fn, opts);
  };
  window.__oscListened = (target) => {
    const byKey = reg.get(target);
    return !!byKey && [...byKey.values()].some((fns) => fns.size > 0);
  };
}

/**
 * In the page: every data-osc control with no handler registered for it, as
 * [{ osc, tag }]. A control is a button, a non-hidden input, a select, a textarea, a summary,
 * a link or an element with an interactive role; a read-only field is an output, not a
 * control. It has a handler when a listener of any type is registered on it, an on* handler
 * property is set, or the browser gives it an effect of its own: a link's navigation, a
 * summary's toggle, a submit button of a dialog form or of a form with a submit listener.
 */
function unhandledControls() {
  const ROLES = new RegExp(`^(?:${['button', 'switch', 'checkbox', 'radio', 'tab', 'menuitem',
    'menuitemcheckbox', 'menuitemradio', 'option', 'slider', 'spinbutton', 'combobox', 'link',
    'treeitem'].join('|')})$`);
  const ON = ['onclick', 'oninput', 'onchange', 'onkeydown', 'onkeyup', 'onpointerdown',
    'onmousedown', 'onsubmit', 'onfocus', 'ontoggle'];
  const control = (el) => {
    if (el.tagName === 'INPUT' && el.type === 'hidden') return false;
    if ((el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') && el.readOnly) return false;
    return /^(?:BUTTON|INPUT|SELECT|TEXTAREA|SUMMARY)$/.test(el.tagName)
      || (el.tagName === 'A' && el.hasAttribute('href'))
      || ROLES.test(el.getAttribute('role') || '');
  };
  const native = (el) => (el.tagName === 'A' && !!el.getAttribute('href'))
    || (el.tagName === 'SUMMARY' && !!el.closest('details'))
    || (!!el.form && el.type === 'submit'
      && (el.form.method === 'dialog' || window.__oscListened(el.form)));
  const out = [];
  for (const el of document.querySelectorAll('[data-osc]')) {
    if (!control(el)) continue;
    const property = ON.some((p) => typeof el[p] === 'function');
    if (window.__oscListened(el) || property || native(el)) continue;
    out.push({ osc: el.dataset.osc, tag: el.tagName.toLowerCase() });
  }
  return out;
}

/**
 * In the page: every distinct data-osc value of the document, once the main region shows at
 * least one rendered data-osc element (the workspace's controls are built); null before.
 */
function pageHooks() {
  const main = document.querySelector('#osc-main');
  const shown = !!main && [...main.querySelectorAll('[data-osc]')]
    .some((el) => el.getClientRects().length > 0);
  return shown ? [...new Set([...document.querySelectorAll('[data-osc]')]
    .map((el) => el.getAttribute('data-osc')))] : null;
}

const INERT_INIT = `(${listenerRegistry})();\nwindow.__oscUnhandled = ${unhandledControls};\n`
  + `window.__oscHooks = ${pageHooks};\n`;

/** The hooks the page shows now, read once its main region has built its controls. */
const censusHooks = (page, where) => until(() => page.evaluate(() => window.__oscHooks()),
  { ms: 5000, what: `no-inert-controls: hook census collected (${where})` });

/**
 * The page in the states that build its controls: every workspace of the navigation, every
 * Studio template with each of its nodes, edges and clips selected (the Inspector is built in
 * src/js for the selection), and one node of each type the Studio library offers. Returns
 * the unhandled controls of all of them (data-osc → the first state that showed it) and how
 * much was visited.
 */
async function walkControls(page) {
  const found = new Map();
  const hooks = new Map(); // data-osc value -> the first state that showed it
  const take = (list, where) => {
    for (const { osc, tag } of list) if (!found.has(osc)) found.set(osc, `${where} <${tag}>`);
  };
  const census = (list, where) => {
    for (const osc of list || []) if (!hooks.has(osc)) hooks.set(osc, where);
  };
  take(await page.evaluate(() => window.__oscUnhandled()), 'load');
  census(await censusHooks(page, 'load'), 'load');
  const workspaces = await page.evaluate(() => [...new Set([...document.querySelectorAll(
    '[data-osc^="nav."]')].map((el) => el.dataset.osc.slice(4)))]);
  for (const ws of workspaces) {
    await page.evaluate((w) => window.OSCILLA.app.setWorkspace(w), ws);
    await until(() => page.evaluate((w) => document.querySelector('#osc-app').dataset.mode === w,
      ws), { ms: 10000, what: `no-inert-controls: workspace ${ws} is shown` });
    take(await page.evaluate(() => window.__oscUnhandled()), ws);
    census(await censusHooks(page, ws), ws);
  }
  const templates = await page.evaluate(() => window.OSCILLA.app.studio.templates.map((t) => t.id));
  const selections = [];
  for (const id of templates) {
    await page.evaluate((t) => {
      for (const d of document.querySelectorAll('dialog[open]')) d.close();
      window.OSCILLA.app.studioLoadTemplate(t);
    }, id);
    await until(() => page.evaluate((t) => window.OSCILLA.studio.templateId === t
      && window.OSCILLA.studio.model.graph.nodes.length > 0, id),
    { ms: 10000, what: `no-inert-controls: Studio template ${id} is open` });
    // The Inspector renders on the dispatch, so each selection is scanned where it is made.
    const r = await page.evaluate(() => {
      const s = window.OSCILLA.studio;
      const m = s.model;
      // One clip per track, kind and block type or action: clips that differ only in their
      // times and values show the same Inspector controls (the demo song has 744 of them).
      const variant = (c) => `${c.trackId}|${c.kind}|${(c.payload && (c.payload.blockType
        || c.payload.action)) || ''}`;
      const clips = [...new Map(m.timeline.clips.map((c) => [variant(c), c])).values()];
      const sels = [...m.graph.nodes.map((n) => ({ nodes: [n.id] })),
        ...m.graph.edges.map((e) => ({ edges: [e.id] })),
        ...clips.map((c) => ({ clips: [c.id] }))];
      const out = [];
      for (const sel of sels) {
        s.store.dispatch({ type: 'SELECTION_CHANGE', selection: sel });
        out.push({ where: JSON.stringify(sel), list: window.__oscUnhandled(),
          hooks: window.__oscHooks() });
      }
      return { n: sels.length, out };
    });
    selections.push(`${id}:${r.n}`);
    for (const { where, list, hooks: shown } of r.out) {
      take(list, `${id} ${where}`);
      census(shown, `${id} ${where}`);
    }
  }
  const added = await page.evaluate(() => {
    const s = window.OSCILLA.studio;
    const types = [...new Set([...document.querySelectorAll('[data-osc="studio.library.item"]')]
      .map((b) => b.dataset.type))];
    const out = [];
    for (const nodeType of types) {
      s.store.dispatch({ type: 'NODE_ADD', nodeType, position: { x: 80, y: 80 } });
      const node = s.model.graph.nodes.at(-1);
      s.store.dispatch({ type: 'SELECTION_CHANGE', selection: { nodes: [node.id] } });
      out.push({ where: `added ${nodeType}`, list: window.__oscUnhandled(),
        hooks: window.__oscHooks() });
    }
    return { types, out };
  });
  for (const { where, list, hooks: shown } of added.out) {
    take(list, where);
    census(shown, where);
  }
  return { found, hooks, workspaces, templates: selections, types: added.types };
}

/** The found controls against the allowance: unexpected ones, and allowed ones not found. */
function judgeInert(found, allowed) {
  return { unexpected: [...found.keys()].filter((osc) => !(osc in allowed)).sort(),
    stale: Object.keys(allowed).filter((osc) => !found.has(osc)).sort() };
}

// ------------------------------------------------------------------------------ checks
function defineChecks() {
  const checks = [];
  const def = (name, fn, opts = {}) => checks.push({ name, fn, ...opts });

  def('phase-offset-correlation', async ({ browser }) => {
    const { page, context, errors } = await open(browser);
    await startAudio(page);
    // A start can only land on a sample frame: at 440 Hz one frame is 2*pi*440/sr rad of phase
    // (3.3 degrees at 48 kHz, a correlation shift of ~0.057). Allow 1.5 frames of that, at
    // least 0.05, so a correct offset is never failed by the sample grid.
    const sr = await page.evaluate(() => window.OSCILLA.engine.ctx.sampleRate);
    const tol = Math.max(0.05, 1.5 * Math.sin((2 * Math.PI * 440) / sr));
    const rows = [];
    const voiceIds = [];
    let prevId = null;
    for (const deg of [0, 90, 180]) {
      // The phase change restarts the voice: wait for the new one, then for a steady tap on it.
      prevId = await playDual(page, { fa: 440, fb: 440, stereo: true, phaseDeg: deg, prevId });
      const t = await tapCorrelation(page, { voiceId: prevId, deg, tol,
        what: `phase-offset-correlation: a steady L/R tap on the restarted voice at ${deg}°` });
      const info = await page.evaluate(() => ({ id: window.OSCILLA.engine.voice.id,
        phase: window.OSCILLA.engine.voice.phaseDeg,
        ui: `${document.querySelector('#osc-corr-value').textContent} ${
          document.querySelector('#osc-corr-basis').textContent}` }));
      voiceIds.push(info.id);
      rows.push({ deg, corr: t.corr, want: Math.cos((deg * Math.PI) / 180), rms: t.rms,
        phase: info.phase, ui: info.ui, ...(t.stalled ? { stalled: t.stalled, last: t.last }
          : {}) });
    }
    const live = rows.every((r) => r.corr != null && Math.abs(r.corr - r.want) < tol
      && r.phase === r.deg && r.rms > TAP_SIGNAL_RMS);
    const restarted = new Set(voiceIds).size === voiceIds.length; // a change restarts B's start
    const nodesAfter = await stopAll(page);
    // Offline render (Export audio): L/R correlation and the largest one-sample step. B starts
    // late by 7.5 ms at 100 Hz / 90°, inside the 10 ms attack: a start at a non-zero value would
    // step by up to the envelope level; a click-free start stays within the sine slope bound.
    await page.evaluate(() => {
      const a = window.OSCILLA.app;
      a.setStereo(true);
      a.setDualFreq('a', '100');
      a.setDualFreq('b', '100');
    });
    await sleep(60);
    const off = await page.evaluate(async () => {
      const O = window.OSCILLA;
      O.labs.phase.set({ phaseDeg: 90 });
      const r = await O.app.exportAudio('pattern');
      if (!r) return null;
      const l = r.buffer.getChannelData(0);
      const rr = r.buffer.getChannelData(1);
      const sr = r.buffer.sampleRate;
      let peak = 0;
      let step = 0;
      for (let i = 0; i < l.length; i++) {
        peak = Math.max(peak, Math.abs(l[i]), Math.abs(rr[i]));
        if (i) step = Math.max(step, Math.abs(l[i] - l[i - 1]), Math.abs(rr[i] - rr[i - 1]));
      }
      // correlation over the steady middle half
      const a0 = Math.floor(l.length / 4);
      const a1 = Math.floor((3 * l.length) / 4);
      let sl = 0;
      let s2 = 0;
      let slr = 0;
      for (let i = a0; i < a1; i++) { sl += l[i] * l[i]; s2 += rr[i] * rr[i]; slr += l[i] * rr[i]; }
      return { corr: slr / Math.sqrt(sl * s2), peak, step,
        bound: (2 * Math.PI * 100 / sr) * peak, seconds: r.buffer.duration };
    });
    const offlineOk = !!off && Math.abs(off.corr) < 0.05 && off.step <= off.bound * 1.5;
    await context.close();
    return { ok: live && restarted && nodesAfter === 0 && offlineOk && errors.length === 0,
      rows, restarted, nodesAfter, offline: off, errors: errors.slice(0, 3) };
  });

  def('correlation-states', async ({ browser }) => {
    const { page, context } = await open(browser);
    // Phase & Stereo is read in Compare: from 1280 px the Playground leaves the panel to its
    // workspaces (P002, Q004 option A), and the basis label is judged as shown.
    await page.evaluate(() => window.OSCILLA.app.setWorkspace('compare'));
    await page.waitForFunction(() => document.querySelector('#osc-app').dataset.mode === 'compare',
      null, { timeout: 8000 });
    const read = () => page.evaluate(() => {
      const v = document.querySelector('#osc-corr-value');
      const b = document.querySelector('#osc-corr-basis');
      const m = document.querySelector('#osc-corr-meter');
      return { text: v.textContent, basis: b.textContent, basisVisible: b.offsetWidth > 0,
        title: v.title, valuetext: m.getAttribute('aria-valuetext'),
        state: window.OSCILLA.labs.phase.correlationState };
    });
    await sleep(150);
    const idle = await read();
    await startAudio(page);
    // The readout follows the output on its frame loop: poll for the read each assertion judges.
    // On a timeout the last read stands, so the assertion below fails with it.
    const readWhen = async (want, what) => {
      let last = null;
      try {
        return await until(async () => {
          last = await read();
          return want(last) ? last : null;
        }, { ms: 5000, what: `correlation-states: ${what}` });
      } catch (e) {
        if (e.name !== 'WaitTimeout') throw e;
        return { ...last, stalled: e.message.split('\n')[0] };
      }
    };
    await playDual(page, { fa: 440, fb: 442, stereo: false, phaseDeg: 0 });
    const mono = await readWhen((r) => r.state === 'mono' && r.text === '1.00'
      && r.basis === 'mono' && r.basisVisible && !/nothing playing/.test(r.valuetext),
    'the readout says 1.00 mono for the mono dual voice');
    await stopAll(page);
    await playDual(page, { fa: 440, fb: 442, stereo: true, phaseDeg: 0 });
    const stereo = await readWhen((r) => r.state === 'live' && r.basis === 'est.'
      && r.basisVisible && /^-?\d\.\d\d$/.test(r.text),
    'the readout estimates the split stereo dual voice');
    await stopAll(page);
    await context.close();
    const ok = idle.text === '—' && /nothing playing/.test(idle.valuetext)
      && mono.state === 'mono' && mono.text === '1.00' && mono.basis === 'mono'
      && mono.basisVisible && !/nothing playing/.test(mono.valuetext)
      && stereo.state === 'live' && stereo.basis === 'est.' && stereo.basisVisible
      && /^-?\d\.\d\d$/.test(stereo.text);
    return { ok, idle, mono, stereo };
  });

  def('harmonics-additive', async ({ browser }) => {
    const { page, context } = await open(browser);
    await page.click('#osc-atab-harmonics');
    const before = await page.evaluate(() => window.OSCILLA.viz.state.harm.source || 'oscillator');
    const r = await page.evaluate(async () => {
      const O = window.OSCILLA;
      O.app.setFrequency(1000);
      O.labs.additive.update({ enabled: true });
      await new Promise((res) => setTimeout(res, 50));
      const h = O.viz.state.harm;
      const bars = O.labs.additive.coefficients().filter((b) => b.gain > 0);
      const maxDiff = Math.max(...h.list.map((x) => {
        const b = bars.find((y) => y.n === x.n);
        return b ? Math.abs(b.gainDb - x.db) : Infinity;
      }));
      return { source: h.source, n: h.list.length, bars: bars.length, maxDiff,
        label: document.querySelector('#osc-chart-waveform').getAttribute('aria-label') };
    });
    const off = await page.evaluate(async () => {
      window.OSCILLA.labs.additive.update({ enabled: false });
      await new Promise((res) => setTimeout(res, 50));
      return window.OSCILLA.viz.state.harm.source || 'oscillator';
    });
    await context.close();
    const ok = before === 'oscillator' && r.source === 'additive' && r.n === r.bars
      && r.maxDiff < 1e-9 && /Additive synthesis spectrum/.test(r.label) && off === 'oscillator';
    return { ok, before, ...r, off };
  });

  def('scope-window-label', async ({ browser }) => {
    const { page, context } = await open(browser);
    await startAudio(page);
    const r = await page.evaluate(async () => {
      const a = window.OSCILLA.app;
      a.setContinuous(true);
      a.setFrequency(440);
      a.timeWindowMs = 100;
      a.toggleLatch();
      await new Promise((res) => setTimeout(res, 300));
      const sr = window.OSCILLA.engine.sampleRate;
      const label = document.querySelector('#osc-chart-waveform').getAttribute('aria-label');
      return { sr, label, shown: a.scopeShownMs,
        buffer: window.OSCILLA.engine.analyser.fftSize };
    });
    await stopAll(page);
    await context.close();
    // the analyser buffer (8192) holds 100 ms up to ~80 kHz; above that the label says so
    const fits = r.sr * 0.1 + Math.ceil(r.sr / 440) + 1 <= r.buffer;
    const ok = fits
      ? Math.abs(r.shown - 100) < 1e-9 && /over a 100 ms window/.test(r.label)
      : r.shown < 100 && /buffer limit/.test(r.label);
    return { ok, ...r, fits };
  });

  def('status-duration-sequence', async ({ browser }) => {
    const { page, context } = await open(browser);
    await startAudio(page);
    const r = await page.evaluate(async () => {
      const O = window.OSCILLA;
      const ed = O.labs.sequencer.editor;
      const idle = O.app.statusDurationText;
      ed.play();
      await new Promise((res) => setTimeout(res, 400));
      const ms = ed.model.blocks.reduce((t, b) => t + b.durationMs, 0);
      const out = { idle, playing: O.app.seqPlaying, text: O.app.statusDurationText, ms,
        loop: ed.model.loop,
        dom: [...document.querySelectorAll('.osc-statusbar *')].map((e) => e.textContent)
          .some((t) => t.trim() === O.app.statusDurationText) };
      ed.stop();
      return out;
    });
    await stopAll(page);
    await context.close();
    const secs = (r.ms / 1000).toFixed(2).replace(/\.?0+$/, '');
    const ok = r.playing && r.text !== r.idle && r.text.includes(secs) && r.dom
      && (!r.loop || /loop/.test(r.text));
    return { ok, ...r, expectSeconds: secs };
  });

  // C004 (finding dup-stale-6): the readout follows the sequence while it plays. Edits through
  // the Add menu and the Loop button change editor.model, which is not reactive; the drawn
  // Duration must equal what the getter computes from the model now, with "(loop)" only while
  // the model loops, and not the length it had when playback started.
  def('seq-status-duration-follows-edits', async ({ browser }) => {
    const { page, context, errors } = await open(browser);
    const what = (s) => `seq-status-duration-follows-edits: ${s}`;
    const read = () => page.evaluate(() => {
      const O = window.OSCILLA;
      const m = O.labs.sequencer.editor.model;
      return { dom: document.querySelector('[data-osc="status.duration"]').textContent.trim(),
        fresh: O.app.statusDurationText, loop: m.loop, blocks: m.blocks.length,
        playing: O.app.seqPlaying && !O.app.playing };
    });
    const follows = (want) => until(async () => {
      const s = await read();
      return s.playing && s.dom === s.fresh && want(s) ? s : null;
    }, { ms: 4000, what: what('the drawn duration follows the model while it plays') });
    try {
      await startAudio(page);
      await navTo(page, 'sequencer');
      await until(() => page.evaluate(() => document.querySelector('#osc-app').dataset.mode
        === 'sequencer'), { ms: 8000, what: what('the Sequencer workspace opens') });
      await page.evaluate(() => window.OSCILLA.app.collapseSafety()); // it covers the menu
      if (!(await read()).loop) await page.click('#osc-seq-record');
      await page.click('#osc-seq-play');
      const s0 = await follows((s) => s.loop && /\(loop\)/.test(s.dom));
      await page.click('#osc-seq-add');
      // By keyboard: at 1536 x 1024 the menu opens upwards and its first row lies under the
      // sticky header, which takes a pointer click there (a layout defect outside C004).
      await page.focus('[data-osc="seq.addType"][data-value="tone"]');
      await page.keyboard.press('Enter');
      const s1 = await follows((s) => s.blocks === s0.blocks + 1 && s.dom !== s0.dom);
      await page.click('#osc-seq-record'); // Loop off: the current pass still plays
      const s2 = await follows((s) => !s.loop && !/loop/.test(s.dom));
      await stopAll(page);
      return { ok: !errors.length, s0, s1, s2, errors: errors.slice(0, 3) };
    } catch (e) {
      const last = await read().catch(() => null);
      return { ok: false, detail: String(e.message || e).split('\n')[0], last };
    } finally {
      await stopAll(page).catch(() => {});
      await context.close();
    }
  });

  def('no-per-frame-dom-writes', async ({ browser }) => {
    const { page, context } = await open(browser);
    await startAudio(page);
    await page.evaluate(() => {
      const a = window.OSCILLA.app;
      a.setContinuous(true);
      a.setFrequency(1000);
      a.toggleLatch();
    });
    await sleep(800);
    const r = await page.evaluate(() => new Promise((resolve) => {
      const counts = {};
      let total = 0;
      const mo = new MutationObserver((recs) => {
        for (const rec of recs) {
          let el = rec.target.nodeType === 1 ? rec.target : rec.target.parentElement;
          let p = el;
          while (p && !p.id) p = p.parentElement;
          const key = `${p ? p.id : '?'}>${el.tagName.toLowerCase()}.${
            String(el.getAttribute('class') || '').split(' ')[0]} ${rec.type}${
            rec.attributeName ? `:${rec.attributeName}` : ''}`;
          counts[key] = (counts[key] || 0) + 1;
          total++;
        }
      });
      mo.observe(document.documentElement, { subtree: true, attributes: true, childList: true,
        characterData: true });
      setTimeout(() => {
        mo.disconnect();
        resolve({ total, counts, playing: window.OSCILLA.app.playing });
      }, 2000);
    }));
    await stopAll(page);
    await context.close();
    const watched = Object.entries(r.counts).filter(([k]) =>
      /^(osc-chart-spectrum|osc-chart-mic|osc-seq-timeline)>/.test(k) && /hidden|childList/.test(k))
      .reduce((s, [, n]) => s + n, 0);
    // A steady tone: nothing changes, so (almost) nothing is written. The spectrum chip may
    // update its level text when it really changes; that is bounded well below the frame rate.
    const ok = r.playing && watched <= 4 && r.total <= 40;
    return { ok, total: r.total, watched, top: Object.entries(r.counts)
      .sort((a, b) => b[1] - a[1]).slice(0, 6) };
  });

  def('mic-through-engine', async ({ browser, browserName }) => {
    const { page, context } = await open(browser, { width: 1536, height: 1024 });
    await startAudio(page);
    await page.evaluate(() => window.OSCILLA.app.setWorkspace('analyzer'));
    await page.click('#osc-mic-toggle');
    let st = null;
    for (let i = 0; i < 60; i++) {
      st = await page.evaluate(() => {
        const O = window.OSCILLA;
        const m = O.labs.mic;
        return { active: m.active, error: m.error, micNodes: O.engine.micNodeCount,
          same: !!m.analyser && O.engine.micAttachment && m.analyser
            === O.engine.micAttachment.analyser,
          text: document.querySelector('#osc-mic-detected').textContent };
      });
      if (st.active || st.error) break;
      await sleep(100);
    }
    let after = null;
    if (st.active) {
      await page.click('#osc-mic-toggle');
      await sleep(100);
      after = await page.evaluate(() => ({ active: window.OSCILLA.labs.mic.active,
        micNodes: window.OSCILLA.engine.micNodeCount,
        voiceNodes: window.OSCILLA.engine.activeNodeCount }));
    }
    await context.close();
    if (st.active) {
      const ok = st.micNodes === 2 && st.same && after && !after.active && after.micNodes === 0
        && after.voiceNodes === 0;
      return { ok, st, after };
    }
    // No microphone in this browser (WebKit has no fake device): the message must be accurate.
    const ok = browserName === 'webkit' && /^Microphone unavailable here \(/.test(st.error)
      && !/file:\/\/ or permission/.test(st.error) && st.micNodes === 0;
    return { ok, st };
  });

  def('signal-path-stages', async ({ browser }) => {
    const { page, context } = await open(browser);
    const r = await page.evaluate(async () => {
      const O = window.OSCILLA;
      const wait = () => new Promise((res) => setTimeout(res, 40));
      const titles = () => O.viz.state.pathNodes.map((n) => n.title);
      // V421: every drawn stage is projected from the Playground voice's StudioModel; `typed`
      // pairs each stage title with the types of the model nodes it came from.
      const typed = () => {
        const sp = O.viz.state.signalPath;
        const types = new Map(sp.model.graph.nodes.map((n) => [n.id, n.type]));
        return { kind: sp.model.kind, same: sp.sources.length === O.viz.state.pathNodes.length,
          stages: O.viz.state.pathNodes.map((n, i) => `${n.title}:${
            sp.sources[i].nodes.map((id) => types.get(id)).join('+')}`) };
      };
      const base = titles();
      O.labs.filter.update({ enabled: true });
      O.labs.envelope.update({ enabled: true });
      await wait();
      const fe = titles();
      const feModel = typed();
      O.labs.additive.update({ enabled: true });
      await wait();
      const add = titles();
      O.labs.additive.update({ enabled: false });
      O.labs.filter.update({ enabled: false });
      O.labs.envelope.update({ enabled: false });
      O.app.source = 'dual';
      O.app.setStereo(true);
      await wait();
      const dual = titles();
      const dualModel = typed();
      return { base, fe, add, dual, feModel, dualModel };
    });
    await context.close();
    const has = (m, s) => m.kind === 'oscilla-studio' && m.same && m.stages.includes(s);
    const ok = !r.base.includes('FILTER') && r.fe.includes('FILTER')
      && r.fe.includes('ADSR ENVELOPE') && r.add[0] === 'ADDITIVE OSC'
      && r.dual.includes('STEREO ROUTER')
      && has(r.feModel, 'FILTER:filter') && has(r.feModel, 'ADSR ENVELOPE:envelope')
      && has(r.feModel, 'MASTER GAIN:master')
      && has(r.dualModel, 'OSC A + OSC B:oscillator+oscillator')
      && has(r.dualModel, 'STEREO ROUTER:stereo-split');
    return { ok, ...r };
  });

  def('signal-path-open-in-studio', async ({ browser, browserName }) => {
    const BTN = '[data-osc="analysis.openInStudio"]';
    const read = (page) => page.evaluate(() => {
      const O = window.OSCILLA;
      const a = O.app;
      const st = O.studio;
      const el = document.querySelector('[data-osc="analysis.openInStudio"]');
      const drawn = O.viz.state.signalPath.model.graph.nodes.map((n) => n.id);
      const c = st.counts();
      const dlg = document.getElementById('studio-voice-guard');
      return { ws: a.workspace, shown: !!el && el.getClientRects().length > 0,
        title: st.model.metadata.title, dirty: st.dirty,
        nodes: st.model.graph.nodes.map((n) => n.id), drawn,
        drawnKey: JSON.stringify(O.viz.state.signalPath.model),
        playground: JSON.stringify([a.source, a.pattern, a.frequency, a.waveform, a.gainLevel]),
        focus: document.activeElement ? document.activeElement.id
          || document.activeElement.dataset.osc || document.activeElement.tagName : '',
        silent: !c.playing && !a.playing && c.engineSources === 0 && c.runtimeNodes === 0,
        dialog: dlg ? { open: dlg.open, lost: [...dlg.querySelectorAll('li')]
          .map((li) => li.textContent), describedBy: (dlg.getAttribute('aria-describedby') || '')
          .split(/\s+/).map((id) => { const n = document.getElementById(id);
            return n ? n.dataset.osc || n.tagName : null; }) } : null,
        alerts: a.alerts.map((x) => `${x.level}: ${x.title}: ${x.message}`),
        notices: [...document.querySelectorAll('[data-osc="alert"]')]
          .filter((n) => n.getClientRects().length).map((n) => `${n.getAttribute('role')}: ${
            n.textContent.replace(/\s+/g, ' ').trim()}`) };
    });
    const showTab = async (page) => {
      await page.click('#osc-atab-signalpath');
      await until(() => read(page).then((v) => v.shown), { ms: 5000,
        what: 'open-in-studio: the button shows on the Signal Path tab' });
    };
    const inStudio = (page, what) => until(async () => {
      const v = await read(page);
      return v.ws === 'studio' && v.focus === 'osc-studio-title' ? v : null;
    }, { ms: 5000, what });
    const res = {};
    // Pointer, on a clean Studio.
    const { page, context } = await open(browser);
    const first = await read(page);
    await showTab(page);
    await page.click('[data-osc="analysis.openInStudio"]'); // by pointer
    const opened = await inStudio(page, 'open-in-studio: the pointer opens Studio');
    await page.click('[data-osc="studio.back"]');
    const back = await until(() => read(page).then((v) => (v.ws === 'playground' ? v : null)),
      { ms: 5000, what: 'open-in-studio: Back returns to the Playground' });
    res.pointer = { tabHidden: !first.shown, studioWasClean: !first.dirty,
      title: opened.title, dirty: opened.dirty, silent: opened.silent,
      allDrawn: opened.drawn.every((id) => opened.nodes.includes(id)),
      playgroundKept: opened.playground === first.playground
        && opened.drawnKey === first.drawnKey, back: back.ws };
    // Keyboard, with the opened copy still unsaved: the guard asks.
    await page.focus(BTN);
    await page.keyboard.press('Enter');
    const asked = await until(() => read(page).then((v) => (v.dialog && v.dialog.open
      && v.focus === 'studio.voice.keep' ? v : null)), { ms: 5000,
      what: 'open-in-studio: the guard dialog asks, Keep focused' });
    await page.keyboard.press('Enter'); // Keep
    const kept = await until(() => read(page).then((v) => (!v.dialog.open ? v : null)),
      { ms: 5000, what: 'open-in-studio: Keep closes the dialog' });
    await page.focus(BTN);
    await page.keyboard.press('Enter');
    await until(() => read(page).then((v) => v.dialog.open), { ms: 5000,
      what: 'open-in-studio: the guard asks again' });
    await page.focus('[data-osc="studio.voice.replace"]');
    await page.keyboard.press('Enter');
    const replaced = await inStudio(page, 'open-in-studio: Replace opens the voice');
    res.keyboard = { lost: asked.dialog.lost, describedBy: asked.dialog.describedBy,
      keptWs: kept.ws, keptDirty: kept.dirty,
      replacedDirty: replaced.dirty, title: replaced.title };
    // A configuration the Studio cannot sound the same: refused, shown and announced.
    await page.click('[data-osc="studio.back"]');
    await until(() => read(page).then((v) => v.ws === 'playground'), { ms: 5000,
      what: 'open-in-studio: back in the Playground' });
    await page.evaluate(() => { window.OSCILLA.app.pattern = 'siren'; });
    await page.click(BTN);
    const refused = await until(() => read(page).then((v) => (v.notices.some((n) =>
      /^alert: Voice not opened in Studio/.test(n)) ? v : null)), { ms: 5000,
    what: 'open-in-studio: the siren is refused with a notice' });
    res.refused = { ws: refused.ws, dialog: refused.dialog.open,
      notice: refused.notices.find((n) => /Voice not opened/.test(n)) };
    await context.close();
    // Touch.
    const touch = await browser.newContext({ viewport: { width: 390, height: 844 },
      hasTouch: true, isMobile: browserName !== 'firefox' });
    const tp = await touch.newPage();
    tp.setDefaultTimeout(10000);
    await tp.goto(pathToFileURL(DIST).href, { waitUntil: 'load' });
    await tp.waitForSelector('html[data-ready="true"]', { timeout: 15000 });
    await tp.tap('#osc-atab-signalpath');
    await until(() => read(tp).then((v) => v.shown), { ms: 5000,
      what: 'open-in-studio: the button shows on a phone' });
    await tp.tap('[data-osc="analysis.openInStudio"]'); // by touch
    const tapped = await inStudio(tp, 'open-in-studio: a tap opens Studio');
    res.touch = { title: tapped.title, dirty: tapped.dirty, silent: tapped.silent };
    await touch.close();
    const p = res.pointer;
    const k = res.keyboard;
    const ok = p.tabHidden && p.studioWasClean && p.title === 'Playground voice' && p.dirty
      && p.silent && p.allDrawn && p.playgroundKept && p.back === 'playground'
      && JSON.stringify(k.lost) === '["Unsaved changes to Playground voice"]'
      && JSON.stringify(k.describedBy) === '["P","studio.voice.lost"]'
      && k.keptWs === 'playground' && k.keptDirty && k.replacedDirty
      && k.title === 'Playground voice'
      && res.refused.ws === 'playground' && !res.refused.dialog
      && /would not sound the same\. Nothing was changed\./.test(res.refused.notice || '')
      && res.touch.title === 'Playground voice' && res.touch.dirty;
    return { ok, ...res };
  });

  def('signal-path-open-in-studio-plays', async ({ browser }) => {
    // V605 review F1 and F4: the opened copy of a held voice plays in the Studio for the
    // Playground's safety limit (one gate, limit minus the release), not a 0 s timeline that
    // Studio Play ends at once; Stop silences it to an engine census of 0. Opening while the
    // Playground holds a voice says that voice keeps sounding until Studio Play takes the output.
    const sound = (page) => page.evaluate(() => {
      const O = window.OSCILLA;
      const e = O.engine;
      let pk = 0;
      if (e.analyser) {
        const d = new Float32Array(e.analyser.fftSize);
        e.analyser.getFloatTimeDomainData(d);
        for (let i = 0; i < d.length; i += 1) pk = Math.max(pk, Math.abs(d[i]));
      }
      const c = O.studio.counts();
      return { peak: pk, now: e.ctx ? e.ctx.currentTime : null, ws: O.app.workspace,
        playing: !!O.app.playing, studioPlaying: !!c.playing, nodes: e.activeNodeCount,
        engineNodes: c.engineNodes, engineSources: c.engineSources,
        runtimeNodes: c.runtimeNodes, clips: O.studio.model.timeline.clips
          .map((x) => [x.start, x.duration]),
        notice: O.app.alerts.filter((a) => a.title === 'Playground voice opened in Studio')
          .map((a) => a.message).join(' | ') };
    });
    const quiet = (v) => v.nodes === 0 && !v.playing && !v.studioPlaying && v.engineNodes === 0
      && v.engineSources === 0 && v.runtimeNodes === 0;
    const FLOOR = 0.005; // the analyser's peak: -46 dBFS, far below the voices played here
    const HELD_S = 1; // audio seconds after Studio Play at which the voice still sounds
    const res = {};
    for (const [leg, set] of [['tone', null], ['am', { pattern: 'am' }]]) {
      const { page, context } = await open(browser);
      if (set) await page.evaluate((x) => Object.assign(window.OSCILLA.app, x), set);
      await page.click('#osc-atab-signalpath');
      await page.click('[data-osc="analysis.openInStudio"]');
      const opened = await until(() => sound(page).then((v) => (v.ws === 'studio' ? v : null)),
        { ms: 5000, what: `open-in-studio-plays ${leg}: the voice opens in Studio` });
      await page.click('[data-osc="studio.play"]');
      const t0 = await until(() => sound(page).then((v) => (v.studioPlaying ? v.now : null)),
        { ms: 5000, what: `open-in-studio-plays ${leg}: Studio Play starts` });
      const on = await until(() => sound(page).then((v) => (v.now - t0 >= HELD_S
        && v.studioPlaying && v.runtimeNodes > 0 && v.peak > FLOOR ? v : null)),
      { ms: 8000, what: `open-in-studio-plays ${leg}: still sounding ${HELD_S} s after Play` })
        .catch(() => sound(page).then((v) => ({ ...v, timedOut: true })));
      await page.click('[data-osc="studio.stop"]');
      const off = await until(() => sound(page).then((v) => (quiet(v) ? v : null)),
        { ms: 5000, what: `open-in-studio-plays ${leg}: Stop leaves an engine census of 0` })
        .catch(() => sound(page).then((v) => ({ ...v, timedOut: true })));
      res[leg] = { clips: opened.clips, heldS: on.now - t0, peak: on.peak,
        studioPlaying: on.studioPlaying, timedOut: !!on.timedOut, off: quiet(off),
        census: [off.nodes, off.engineNodes, off.engineSources, off.runtimeNodes] };
      await context.close();
    }
    // F4: the Playground holds a voice while it is opened.
    {
      const { page, context } = await open(browser);
      await page.click('#osc-atab-signalpath');
      await page.evaluate(() => window.OSCILLA.app.play('hold'));
      await until(() => sound(page).then((v) => v.playing && v.peak > FLOOR), { ms: 5000,
        what: 'open-in-studio-plays: the Playground holds a voice' });
      await page.click('[data-osc="analysis.openInStudio"]');
      const said = await until(() => sound(page).then((v) => (v.ws === 'studio' && v.notice
        ? v : null)), { ms: 5000, what: 'open-in-studio-plays: the opened notice shows' });
      await page.click('[data-osc="studio.play"]');
      const taken = await until(() => sound(page).then((v) => (v.studioPlaying && !v.playing
        ? v : null)), { ms: 5000, what: 'open-in-studio-plays: Studio Play takes the output' })
        .catch(() => sound(page));
      await page.click('[data-osc="studio.stop"]');
      const off = await until(() => sound(page).then((v) => (quiet(v) ? v : null)),
        { ms: 5000, what: 'open-in-studio-plays: Stop after the takeover leaves 0' })
        .catch(() => sound(page));
      res.held = { playingAtOpen: said.playing, notice: said.notice,
        taken: taken.studioPlaying && !taken.playing, off: quiet(off) };
      await context.close();
    }
    const ok = ['tone', 'am'].every((leg) => {
      const r = res[leg];
      return r.clips.length === 1 && r.clips[0][0] === 0 && r.clips[0][1] > HELD_S
        && !r.timedOut && r.heldS >= HELD_S && r.studioPlaying && r.peak > FLOOR && r.off;
    }) && res.held.playingAtOpen
      && /keeps sounding until you press Play here/.test(res.held.notice)
      && !/Nothing plays/.test(res.held.notice) && res.held.taken && res.held.off;
    return { ok, ...res };
  });

  def('additive-gain-field', async ({ browser }) => {
    const { page, context } = await open(browser);
    // Before any context the Nyquist frequency is unknown: nothing may be hatched yet.
    const pre = await page.evaluate(async () => {
      const O = window.OSCILLA;
      O.app.setFrequency(5000);
      await new Promise((res) => setTimeout(res, 40));
      return O.labs.additive.chart.getBars().filter((b) => b.audible === false).length;
    });
    await startAudio(page); // the context's sample rate arrives: the hatching must follow
    const r = await page.evaluate(async () => {
      const O = window.OSCILLA;
      const lab = O.labs.additive;
      const wait = () => new Promise((res) => setTimeout(res, 40));
      const ctxRedraw = lab.chart.getBars().filter((b) => b.audible === false).length;
      lab.update({ enabled: true });
      lab.setPartials(lab.partials); // custom table
      lab.select(3);
      const field = () => document.querySelector('#osc-add-gain-value').value;
      const bar = () => lab.coefficients()[2].gainDb;
      const f0 = field();
      const b0 = bar();
      // type a played level: the bar must come out at that level
      const input = document.querySelector('#osc-add-gain-value');
      input.value = '-20';
      input.dispatchEvent(new Event('change'));
      await wait();
      const f1 = field();
      const b1 = bar();
      // Nyquist hatching follows the fundamental (no lab event involved)
      O.app.setFrequency(200);
      await wait();
      const a0 = lab.chart.getBars().filter((b) => b.audible === false).length;
      O.app.setFrequency(5000);
      await wait();
      const a1 = lab.chart.getBars().filter((b) => b.audible === false).length;
      return { f0, b0, f1, b1, a0, a1, sr: O.engine.sampleRate || 48000, ctxRedraw };
    });
    await context.close();
    const num = (s) => parseFloat(String(s));
    const nyqN = Math.floor((r.sr / 2) / 5000); // highest audible harmonic at 5 kHz
    const ok = Math.abs(num(r.f0) - r.b0) < 0.06 && Math.abs(r.b1 - -20) < 0.2
      && Math.abs(num(r.f1) - r.b1) < 0.06 && r.a0 === 0 && r.a1 === 10 - nyqN
      && pre === 0 && r.ctxRedraw === 10 - nyqN;
    return { ok, pre, ...r, expectInaudible: 10 - nyqN };
  });

  def('stereo-max-from-rate', async ({ browser }) => {
    const { page, context } = await open(browser);
    await startAudio(page);
    const r = await page.evaluate(() => ({
      sr: window.OSCILLA.engine.sampleRate,
      fa: document.querySelector('#osc-stereo-fa').max,
      fb: document.querySelector('#osc-stereo-fb').max,
    }));
    await context.close();
    const want = String(Math.floor((r.sr / 2) * 0.95));
    return { ok: r.fa === want && r.fb === want, ...r, want };
  });

  def('bio-sources-keyboard', async ({ browser }) => {
    const { page, context } = await open(browser);
    await page.evaluate(() => window.OSCILLA.app.setWorkspace('compare'));
    await sleep(150);
    await page.focus('.osc-bio-sources-toggle');
    await page.keyboard.press('Enter');
    await sleep(80);
    const r = await page.evaluate(() => {
      const d = document.querySelector('#osc-bio-sources');
      const items = [...document.querySelectorAll('#osc-bio-source-list li')];
      const list = document.querySelector('#osc-bio-source-list');
      const box = list.getBoundingClientRect();
      return { open: d.open, n: items.length, first: items[0] && items[0].textContent,
        links: list.querySelectorAll('a[href^="http"]').length,
        visible: box.width > 100 && box.height > 20,
        focused: document.activeElement === document.querySelector('.osc-bio-sources-toggle') };
    });
    await page.click('#osc-btab-calls');
    await sleep(80);
    const calls = await page.evaluate(() => [...document.querySelectorAll(
      '#osc-bio-source-list li')].map((li) => li.textContent.slice(0, 40)));
    await context.close();
    const ok = r.open && r.focused && r.visible && r.n >= 5 && /Human: 31 Hz – 17\.6 kHz/.test(r.first)
      && /Heffner/.test(r.first) && r.links >= 1 && calls.length >= 3
      && !calls[0].startsWith('Human');
    return { ok, ...r, calls: calls.slice(0, 2) };
  });

  def('analysis-header-no-overlap', async ({ browser }) => {
    const rows = [];
    let bad = 0;
    for (const w of [1280, 1366, 1440, 1535, 1536]) {
      const { page, context } = await open(browser, { width: w, height: 1000 });
      for (const ws of ['playground', 'analyzer', 'synthesis']) {
        await page.evaluate((m) => window.OSCILLA.app.setWorkspace(m), ws);
        await sleep(120);
        const r = await page.evaluate(() => {
          const tl = document.querySelector('#osc-analysis-tabs').getBoundingClientRect();
          const tabs = [...document.querySelectorAll('#osc-analysis-tabs .osc-tab')]
            .map((t) => t.getBoundingClientRect());
          const tools = ['#osc-viz-pause', '.osc-time-select', '#osc-analysis-fullscreen']
            .map((s) => document.querySelector(s).getBoundingClientRect());
          const hit = (a, b) => a.left < b.right - 0.5 && b.left < a.right - 0.5
            && a.top < b.bottom - 0.5 && b.top < a.bottom - 0.5;
          let n = 0;
          for (const t of tabs) {
            const vis = { left: Math.max(t.left, tl.left), right: Math.min(t.right, tl.right),
              top: t.top, bottom: t.bottom };
            for (const o of tools) if (hit(vis, o)) n++;
          }
          // every tab is fully visible (no scroll needed) at desktop widths
          const clipped = tabs.filter((t) => t.right > tl.right + 0.5).length;
          return { n, clipped };
        });
        if (r.n || r.clipped) bad++;
        rows.push(`${w}/${ws}: overlap ${r.n} clipped ${r.clipped}`);
      }
      await context.close();
    }
    return { ok: bad === 0, rows };
  });

  def('tablet-nav-focus', async ({ browser }) => {
    const { page, context } = await open(browser, { width: 1024, height: 800 });
    const out = {};
    const settle = {};
    for (const [ws, panel] of [['filter', '#osc-panel-filter'], ['sequencer',
      '#osc-panel-sequencer'], ['analyzer', '#osc-panel-mic']]) {
      await navTo(page, ws);
      settle[ws] = await scrollSettled(page, panel);
      out[ws] = await page.evaluate((sel) => {
        const p = document.querySelector(sel);
        const main = document.querySelector('.osc-main').getBoundingClientRect();
        const r = p.getBoundingClientRect();
        const cs = getComputedStyle(p);
        return { focused: p.classList.contains('is-focused'), top: Math.round(r.top - main.top),
          ring: cs.boxShadow !== 'none' && cs.boxShadow.includes('0px 0px 0px 1px'),
          current: document.querySelector('[aria-current="page"]').dataset.osc };
      }, panel);
    }
    await page.click('[data-osc="nav.playground"]');
    settle.playground = await scrollSettled(page, null);
    const back = await page.evaluate(() => ({
      scrollTop: document.querySelector('.osc-main').scrollTop,
      focused: document.querySelectorAll('.osc-panel.is-focused').length }));
    await context.close();
    const ok = Object.entries(out).every(([ws, r]) => r.focused && r.ring && r.top >= 0
      && r.top <= 24 && r.current === `nav.${ws}`) && back.scrollTop === 0 && back.focused === 0;
    return { ok, out, back, settle };
  });

  def('safety-notice', async ({ browser }) => {
    // V247: first-run notice, dismiss → reopen → dismiss focus handoff, stored collapsed state.
    const { page, context } = await open(browser);
    const state = () => page.evaluate(() => {
      const n = document.querySelector('#osc-safety');
      const r = n.getBoundingClientRect();
      const a = document.activeElement;
      return { shown: getComputedStyle(n).display !== 'none', h: Math.round(r.height),
        active: a === document.body ? 'BODY' : a.dataset.osc || a.id,
        stored: sessionStorage.getItem('oscilla.safetyNoticeCollapsed'),
        text: n.textContent.replace(/\s+/g, ' ').trim() };
    });
    // Each step waits (bounded) for the focus handoff instead of a fixed sleep: on a loaded
    // WebKit runner the handoff landed after 120 ms and the check read <body>.
    const settle = async (want) => {
      let v = await state();
      for (let i = 0; i < 40 && !want(v); i++) { await sleep(50); v = await state(); }
      return v;
    };
    const first = await state();
    await page.focus('[data-osc="safety.dismiss"]');
    await page.keyboard.press('Enter');
    const dismissed = await settle((v) => !v.shown && v.active === 'safety.reopen');
    await page.keyboard.press('Enter'); // focus is on the reopen control
    const reopened = await settle((v) => v.shown && v.active === 'safety.dismiss');
    await page.keyboard.press('Enter'); // focus is on dismiss again
    await settle((v) => !v.shown);
    await page.reload({ waitUntil: 'load' });
    await page.waitForSelector('html[data-ready="true"]', { timeout: 10000 });
    await sleep(150);
    const reloaded = await state();
    await context.close();
    // phone: short, HOLD stays in the first viewport, focus never drops to <body>
    const ph = await open(browser, { width: 375, height: 667 });
    const phone = await ph.page.evaluate(() => {
      const n = document.querySelector('#osc-safety').getBoundingClientRect();
      const hold = document.querySelector('#osc-hold-play').getBoundingClientRect();
      const main = document.querySelector('.osc-main').getBoundingClientRect();
      return { h: Math.round(n.height), holdBottom: Math.round(hold.bottom),
        mainBottom: Math.round(main.bottom) };
    });
    await ph.page.focus('[data-osc="safety.dismiss"]');
    await ph.page.keyboard.press('Enter');
    await sleep(120);
    phone.active = await ph.page.evaluate(() => (document.activeElement === document.body
      ? 'BODY' : document.activeElement.dataset.osc || document.activeElement.id));
    await ph.context.close();
    const ok = first.shown && /harmful at excessive output levels/.test(first.text)
      && /does not guarantee that your hardware reproduces/.test(first.text) && first.h <= 50
      && !dismissed.shown && dismissed.active === 'safety.reopen' && dismissed.stored === '1'
      && reopened.shown && reopened.active === 'safety.dismiss'
      && !reloaded.shown && reloaded.stored === '1'
      && phone.h <= 44 && phone.holdBottom <= phone.mainBottom && phone.active !== 'BODY';
    return { ok, first: { ...first, text: first.text.slice(0, 60) }, dismissed, reopened,
      reloaded: { shown: reloaded.shown, stored: reloaded.stored }, phone };
  });

  def('no-inert-controls', async ({ browser }) => {
    // project.no-inert-surfaces (c): every data-osc control the page builds has a handler, or
    // is listed with its reason in the allowance; a fixture control without one is found.
    const context = await browser.newContext({ viewport: { width: 1536, height: 1024 } });
    const page = await context.newPage();
    page.setDefaultTimeout(10000);
    await page.addInitScript(INERT_INIT);
    await page.goto(pathToFileURL(DIST).href, { waitUntil: 'load' });
    await page.waitForSelector('html[data-ready="true"]', { timeout: 15000 });
    const walk = await walkControls(page);
    const allowed = INERT_ALLOWANCE['inert-control'] || {};
    const { unexpected, stale } = judgeInert(walk.found, allowed);
    // The mutation: a control with no handler is found and judged; one with a handler is not.
    const fixture = await page.evaluate(() => {
      const inert = document.createElement('button');
      inert.dataset.osc = 'fixture.inert';
      const handled = document.createElement('button');
      handled.dataset.osc = 'fixture.handled';
      handled.addEventListener('click', () => {});
      document.body.append(inert, handled);
      const list = window.__oscUnhandled().map((c) => c.osc);
      inert.remove();
      handled.remove();
      return list.filter((osc) => osc.startsWith('fixture.'));
    });
    const withFixture = new Map([...walk.found, ...fixture.map((osc) => [osc, 'fixture'])]);
    const judged = judgeInert(withFixture, allowed).unexpected;
    // The hook census (G001): every value shown is declared or allowed; the catalogue is the
    // ESM registry of src/js, the same modules the build bundles.
    const { CATALOG } = await import(pathToFileURL(path.join(ROOT, 'src', 'js', 'ui', 'catalog',
      'registry.js')).href);
    const { unknownHooks } = await import(pathToFileURL(path.join(ROOT, 'scripts', 'ui-catalog',
      'check.mjs')).href);
    const undeclared = unknownHooks([...walk.hooks.keys()], CATALOG, CATALOG_ALLOWANCE);
    // The mutation: a hook only the running page shows is flagged.
    const injected = await page.evaluate(() => {
      const el = document.createElement('span');
      el.setAttribute('data-osc', 'qa.fixture.undeclared');
      document.querySelector('#osc-main').append(el);
      const shown = window.__oscHooks();
      el.remove();
      return shown;
    });
    const flagged = unknownHooks([...walk.hooks.keys(), ...(injected || [])], CATALOG,
      CATALOG_ALLOWANCE);
    await context.close();
    const ok = unexpected.length === 0 && stale.length === 0
      && JSON.stringify(fixture) === '["fixture.inert"]'
      && JSON.stringify(judged) === '["fixture.inert"]'
      && walk.workspaces.includes('studio') && walk.templates.length > 0 && walk.types.length > 0
      && undeclared.length === 0 && walk.hooks.size > 0
      && JSON.stringify(flagged) === '["qa.fixture.undeclared"]';
    return { ok, unexpected: unexpected.map((osc) => `${osc} @${walk.found.get(osc)}`), stale,
      undeclared: undeclared.map((osc) => `${osc} @${walk.hooks.get(osc)}`),
      hooks: walk.hooks.size, flagged,
      allowed: Object.keys(allowed).length, fixture, judged, workspaces: walk.workspaces.length,
      templates: walk.templates, types: walk.types.length };
  });

  def('contrast', async ({ browser, browserName }) => {
    const res = {};
    const add = (k, v) => { res[k] = v; };
    for (const theme of ['dark', 'light']) {
      const { page, context } = await open(browser);
      await page.evaluate((t) => { if (window.OSCILLA.app.theme !== t) window.OSCILLA.app.toggleTheme(); }, theme);
      await sleep(600); // colour transitions settle
      add(`${theme} export`, await contrastOf(page, '#osc-export > span'));
      add(`${theme} oscillator segment`, await contrastOf(page, '#osc-source-osc'));
      add(`${theme} log segment`, await contrastOf(page, '#osc-spec-log'));
      add(`${theme} hold`, await contrastOf(page, 'span[x-text="holdLabel"]'));
      add(`${theme} mic toggle`, await contrastOf(page, '#osc-mic-toggle'));
      add(`${theme} chirp detail`, await contrastOf(page, '.osc-block--chirp .osc-block-detail'));
      add(`${theme} bio sources`, await contrastOf(page, '.osc-bio-sources-toggle'));
      add(`${theme} safety notice`, await contrastOf(page, '.osc-safety-text'));
      add(`${theme} safety reopen`, await contrastOf(page, '[data-osc="safety.reopen"]'));
      add(`${theme} correlation value`, await contrastOf(page, '#osc-corr-value'));
      await page.evaluate(() => window.OSCILLA.app.setWorkspace('learn'));
      await sleep(150);
      add(`${theme} learn example`, await contrastOf(page, '#osc-view-learn [aria-current="true"] [data-learn-example]'));
      add(`${theme} learn demo`, await contrastOf(page, '#osc-view-learn [aria-current="true"] [data-osc="learn.demo"]'));
      await context.close();
    }
    const low = Object.entries(res).filter(([, v]) => v == null || v < 4.5);
    // axe-core color-contrast across workspaces (E054): it runs in every engine, and it proves
    // first that it flags a 2:1 fixture, so a pass that checks nothing cannot pass.
    let axe = axeMissing;
    const axeBad = [];
    let fixtureFlagged = false;
    const seenKnown = new Set();
    if (axeSource) {
      const fx = await browser.newContext();
      const fp = await fx.newPage();
      await fp.setContent(AXE_FIXTURE);
      await fp.addScriptTag({ content: axeSource });
      fixtureFlagged = await fp.evaluate(async () => {
        const r = await window.axe.run(document, { runOnly: ['wcag2aa'] });
        return r.violations.some((x) => x.id === 'color-contrast');
      });
      await fx.close();
      let runs = 0;
      for (const theme of ['dark', 'light']) {
        for (const w of [375, 768, 1280, 1536]) {
          const { page, context } = await open(browser, { width: w, height: 1024 });
          await page.evaluate((t) => { if (window.OSCILLA.app.theme !== t) window.OSCILLA.app.toggleTheme(); }, theme);
          await page.addScriptTag({ content: axeSource });
          for (const ws of WORKSPACES) {
            await page.evaluate((m) => window.OSCILLA.app.setWorkspace(m), ws);
            await sleep(200);
            const v = await page.evaluate(async () => {
              const r = await window.axe.run(document, { runOnly: ['wcag2a', 'wcag2aa', 'wcag21aa'] });
              const cc = r.violations.find((x) => x.id === 'color-contrast');
              return cc ? cc.nodes.map((n) => `${n.target.join(' ')} ${
                n.any[0] && n.any[0].data ? n.any[0].data.contrastRatio : ''}`) : [];
            });
            runs++;
            const where = `${theme}/${w}/${ws}`;
            for (const node of v) {
              const k = AXE_KNOWN.find((x) => x.where === where && node.includes(x.target));
              if (k) seenKnown.add(k);
              else axeBad.push(`${where}: ${node}`);
            }
          }
          await context.close();
        }
      }
      axe = `${runs} runs, ${axeBad.length} unlisted color-contrast node(s), `
        + `${seenKnown.size}/${AXE_KNOWN.length} known; the 2:1 fixture `
        + `${fixtureFlagged ? 'flagged' : 'NOT flagged'}`;
    }
    // A known violation that no longer occurs is fixed: drop its AXE_KNOWN entry with the fix.
    const goneKnown = axeSource ? AXE_KNOWN.filter((k) => !seenKnown.has(k))
      .map((k) => `${k.where} ${k.target} (${k.issue}) no longer occurs: drop it from AXE_KNOWN`)
      : [];
    return { ok: !!axeSource && fixtureFlagged && low.length === 0 && axeBad.length === 0
      && goneKnown.length === 0, browserName, axe, axeBad: axeBad.slice(0, 5), goneKnown, low,
    res };
  });

  return checks;
}

// ------------------------------------------------------------------------------ runner
(async () => {
  await RUN.ready();
  if (!fs.existsSync(DIST)) {
    console.error(`missing ${DIST}: run npm run build`);
    process.exit(2);
  }
  let failed = 0;
  for (const name of BROWSERS) {
    const browser = await playwright[name].launch(LAUNCH[name]);
    const t0 = Date.now();
    let n = 0;
    const bad = [];
    for (const c of defineChecks()) {
      if (ONLY && !ONLY.has(c.name)) continue;
      // Every check runs in every engine (E054 removed the last engine-only check, contrast);
      // a check restricted again needs its skip back here and declared in tests/README.md.
      n++;
      let r;
      try {
        r = await Promise.race([c.fn({ browser, browserName: name }),
          sleep(240000).then(() => ({ ok: false, detail: 'timeout 240 s' }))]);
      } catch (e) {
        r = { ok: false, detail: String(e.message || e).split('\n')[0] };
      }
      const line = JSON.stringify(r);
      console.log(`  ${r.ok ? 'PASS' : 'FAIL'}  ${name} ${c.name}  ${line.slice(0, 700)}`);
      if (!r.ok) bad.push(c.name);
    }
    await browser.close();
    RUN.reportLeg({ leg: name, checks: n });
    failed += bad.length;
    console.log(`${bad.length ? 'FAIL' : 'PASS'} ${name}: ${n - bad.length}/${n} checks `
      + `(${((Date.now() - t0) / 1000).toFixed(1)} s)`);
  }
  process.exit(failed ? 1 : 0);
})();
