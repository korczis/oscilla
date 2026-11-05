// C030: a visible Play on every workspace that should sound, on desktop as on the phone.
//
// Before C030 Analyzer, Filter Lab, Compare and Presets had no Play at 1536x1024: Source &
// Pattern (Hold to Play, Trigger) lists only playground sequencer synthesis in data-osc-modes,
// the desktop focus layouts hide every panel a workspace does not list, and the status-bar Play
// was display: none above 767 px. Presets also said "Press TRIGGER" with no Trigger on screen.
// After: from 768 px every workspace whose Space owner is not null shows exactly one Play
// control (shortcuts.js playControl): the status-bar Play only where Source & Pattern is
// hidden (Presets at every width, Analyzer, Filter Lab and Compare from Tailwind's xl, the
// width of the desktop focus layouts), and every prompt names the control on screen at that
// width. No new player: the status-bar Play is the instrument's existing statusPlay.
// Below 768 px the status-bar Play is the phone's compact transport in every workspace
// (responsive.css, before C030), so there the claim is that the named control is shown.
//
//   node --test tests/unit/workspace-play-visible.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

import * as shortcuts from '../../src/js/ui/shortcuts.js';
import { createInstrument } from '../../src/js/core/instrument.js';
import { createWorkbench } from '../../src/js/ui/workbench.js';
import { createScopeView } from '../../src/js/ui/p5-views.js';
import { VisualizationBridge } from '../../src/js/visualization/visualization-bridge.js';
import { createP5Host } from '../../src/js/visualization/p5-host.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const require = createRequire(import.meta.url);
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const HTML = read('src/index.html');
const DIST = read('dist/index.html');
const INTEGRATION_CSS = read('src/styles/integration.css');
const RESPONSIVE_CSS = read('src/styles/responsive.css');
const INSTRUMENT_CSS = read('src/styles/instrument.css');
const { SPACE_OWNER } = shortcuts;
const SOUNDING = Object.keys(SPACE_OWNER).filter((ws) => SPACE_OWNER[ws] !== null);
const INSTRUMENT_WS = SOUNDING.filter((ws) => SPACE_OWNER[ws] === 'instrument');
const PANELLESS = () => shortcuts.PANELLESS_WORKSPACES || ['learn', 'presets', 'about'];

/** The opening tag of the element carrying `attr` (an attribute=value text), or ''. */
function openTag(attr) {
  const at = HTML.indexOf(attr);
  if (at < 0) return '';
  return HTML.slice(HTML.lastIndexOf('<', at), HTML.indexOf('>', at) + 1);
}

/** The text of the element whose opening tag carries `attr`, up to its closing `</tag>`. */
function elementText(attr, tag) {
  const start = HTML.lastIndexOf('<', HTML.indexOf(attr));
  return HTML.slice(start, HTML.indexOf(`</${tag}>`, start));
}

const SOURCE_TAG = openTag('id="osc-panel-source"');
const sourceModes = () => (SOURCE_TAG.match(/data-osc-modes="([^"]*)"/) || [, ''])[1]
  .split(/\s+/).filter(Boolean);
const PLAY_TAG = openTag('id="osc-sb-play"');
const pxOf = (query) => Number((String(query).match(/min-width:\s*(\d+)px/) || [])[1]);

/** The query of the @media block of `css` that contains `needle`, and where it is. */
function mediaBlockWith(css, needle) {
  const at = css.indexOf(needle);
  const open = css.lastIndexOf('@media', at);
  return { query: css.slice(open, css.indexOf('{', open)), at };
}

/** The data-mode values of the focus-layout rule that hides the panels a workspace omits. */
const FOCUS_MODES = [...INTEGRATION_CSS.matchAll(
  /\.osc-app\[data-mode="(\w+)"\] \.osc-panel:not\(\[data-osc-modes~="\1"\]\)/g)].map((m) => m[1]);
/** The data-mode values whose every panel responsive.css hides below 1280 px. */
const PANELLESS_MODES = [...RESPONSIVE_CSS.matchAll(
  /\.osc-app\[data-mode="(\w+)"\] \.osc-panel[,\s{]/g)].map((m) => m[1]);

/** The width classes: the phone (< md), the two-column tablet (md..xl), the focus layout. */
const WIDTHS = Object.freeze([
  { name: 'phone', px: 390, wide: false },
  { name: 'tablet', px: 1024, wide: false },
  { name: 'desktop', px: 1536, wide: true },
]);
const TW_SCREENS = require('tailwindcss/resolveConfig')(require(path.join(ROOT,
  'tailwind.config.cjs'))).theme.screens;

/** The instrument and workbench composed as main.js composes them (descriptors, in order). */
function component(workspace, { wide = true, hash = '' } = {}) {
  const target = {};
  const parts = [
    createInstrument({ engine: null, location: { hash, href: '', search: '' },
      timers: { setTimeout: () => 0, clearTimeout() {}, setInterval: () => 0,
        clearInterval() {} } }),
    createWorkbench({ labSnapshot: () => null, applyLabSnapshot: () => null,
      labsMounted: () => true, sequencerPlaying: () => false, stopPlayback() {} }),
  ];
  for (const part of parts) {
    Object.defineProperties(target, Object.getOwnPropertyDescriptors(part));
  }
  target.sampleRate = 48000;
  target.workspace = workspace;
  target.wideLayout = wide;
  return target;
}

/** The status-bar Play's class list in `ws`: statusPlayClass, or the head's statusPlayShown. */
function statusClass(ws, wide) {
  const app = component(ws, { wide });
  if ('statusPlayClass' in app) return app.statusPlayClass;
  const m = PLAY_TAG.match(/:class="statusPlayShown && '([^']*)'"/);
  return m && app.statusPlayShown ? m[1] : '';
}

/** True when the class list `cls` shows the status-bar Play at `px` (Tailwind prefixes). */
function utilityShows(cls, px) {
  return String(cls).split(/\s+/).some((c) => {
    const m = c.match(/^(?:(\w+):)?!inline-flex$/);
    if (!m) return false;
    return !m[1] || px >= parseInt(TW_SCREENS[m[1]], 10);
  });
}

/**
 * The Play controls `ws` shows at `w`, from the stylesheets' rules (each checked against the
 * CSS below): 'source' (Hold to Play and Trigger), 'status', 'studio'.
 */
function shownAt(ws, w) {
  const shown = [];
  if (SPACE_OWNER[ws] === 'instrument' && !PANELLESS().includes(ws)) {
    // The focus layout (from xl) hides the panels a focus workspace does not list; below it
    // every panel of a workspace with panels is shown (responsive.css).
    const hidden = w.wide && FOCUS_MODES.includes(ws) && !sourceModes().includes(ws);
    if (!hidden) shown.push('source');
  }
  if (w.px < parseInt(TW_SCREENS.md, 10) || utilityShows(statusClass(ws, w.wide), w.px)) {
    shown.push('status');
  }
  if (SPACE_OWNER[ws] === 'studio') shown.push('studio');
  return shown;
}

/** playControl at a width (the head's took no width). */
const kindAt = (ws, wide) => shortcuts.playControl(ws, wide);

test('the source panel lists exactly SOURCE_PANEL_WORKSPACES and holds Hold and Trigger', () => {
  assert.deepEqual([...sourceModes()].sort(), [...(shortcuts.SOURCE_PANEL_WORKSPACES || [])]
    .sort(), 'shortcuts.js SOURCE_PANEL_WORKSPACES is the data-osc-modes of Source & Pattern');
  const panel = elementText('id="osc-panel-source"', 'section');
  assert.match(panel, /data-osc="source\.hold"/);
  assert.match(panel, /data-osc="source\.trigger"/);
});

test('the breakpoint is one: focus layout, FOCUS_LAYOUT_QUERY and Tailwind xl agree', () => {
  const focus = mediaBlockWith(INTEGRATION_CSS,
    '.osc-app[data-mode="analyzer"] .osc-panel:not([data-osc-modes~="analyzer"])');
  assert.ok(focus.at > 0, 'integration.css hides the panels a focus workspace does not list');
  const px = pxOf(focus.query);
  assert.ok(px > 0, `the focus layout is a min-width block (${focus.query})`);
  assert.equal(pxOf(shortcuts.FOCUS_LAYOUT_QUERY), px, 'shortcuts.js FOCUS_LAYOUT_QUERY');
  assert.equal(parseInt(TW_SCREENS.xl, 10), px, 'Tailwind xl, the prefix of the status Play');
  assert.match(RESPONSIVE_CSS, new RegExp(`@media \\(max-width: ${px - 1}\\.98px\\)`),
    'responsive.css shows every panel below the same width');
  assert.deepEqual([...new Set(PANELLESS_MODES)].sort(), [...PANELLESS()].sort(),
    'responsive.css hides every panel there');
  assert.ok(INSTRUMENT_CSS.includes('.osc-app:is([data-mode="learn"], [data-mode="presets"], '
    + '[data-mode="about"]) :is(.osc-top,'), 'instrument.css hides the same panels from 1280 px');
});

test('from 768 px each sounding workspace shows exactly one Play, per width class', () => {
  assert.equal(typeof shortcuts.playControl, 'function', 'shortcuts.js exports playControl');
  // The base rule hides the status-bar Play; only an !important utility shows it from 768 px,
  // the phone's compact transport (responsive.css) below it.
  assert.match(INSTRUMENT_CSS, /\.osc-sb-play \{\n {2}display: none;/);
  const phoneBlock = mediaBlockWith(RESPONSIVE_CSS, '.osc-sb-play {\n    display: inline-flex;');
  assert.ok(phoneBlock.at > 0 && /max-width: 767\.98px/.test(phoneBlock.query),
    'below 768 px responsive.css shows the status-bar Play');
  assert.equal(parseInt(TW_SCREENS.md, 10), 768, 'Tailwind md is the phone limit');
  const wrong = [];
  for (const w of WIDTHS) {
    for (const ws of SOUNDING) {
      const shown = shownAt(ws, w);
      const kind = kindAt(ws, w.wide);
      if (!shown.includes(kind)) wrong.push(`${w.name} ${ws}: ${kind} not shown (${shown})`);
      if (w.name !== 'phone' && shown.length !== 1) {
        wrong.push(`${w.name} ${ws}: ${shown.length} Plays (${shown.join(', ')})`);
      }
    }
    for (const ws of Object.keys(SPACE_OWNER).filter((x) => SPACE_OWNER[x] === null)) {
      if (w.name !== 'phone' && shownAt(ws, w).length) wrong.push(`${w.name} ${ws}: a Play`);
    }
  }
  assert.deepEqual(wrong, [], 'exactly one Play from 768 px; the named one at every width');
  assert.match(PLAY_TAG, /@click="statusPlay\(\)"/, 'it plays through the existing statusPlay');
  assert.match(elementText('data-osc-modes="studio"', 'section'), /data-osc="studio\.play"/);
});

test('dist compiles the utilities that show the status-bar Play', () => {
  assert.match(PLAY_TAG, /:class="statusPlayClass"/, 'the status-bar Play binds statusPlayClass');
  // assert.ok, not match: a failed match would print the whole 3 MB page.
  assert.ok(/\.\\!inline-flex\{display:inline-flex!important\}/.test(DIST),
    'dist/index.html defines the utility that shows the status-bar Play in Presets');
  assert.ok(new RegExp(`@media\\s?\\(min-width:\\s?${parseInt(TW_SCREENS.xl, 10)}px\\)\\{`
    + '[^@]*\\.xl\\\\:\\\\!inline-flex\\{display:inline-flex!important\\}').test(DIST),
  'dist/index.html defines xl:!inline-flex inside the xl media query');
});

/** The value of `prop` in the first rule for `selector` of `css` (after `from`), or ''. */
function declOf(css, selector, prop, from = 0) {
  const at = css.indexOf(`${selector} {`, from);
  if (at < 0) return '';
  const body = css.slice(css.indexOf('{', at) + 1, css.indexOf('}', at));
  return ((body.match(new RegExp(`(?:^|[;\\s])${prop}:\\s*([^;]+);`)) || [])[1] || '').trim();
}

/** The tracks of a grid-template-columns value, split at top-level spaces. */
function tracks(value) {
  const out = [];
  let depth = 0;
  let cur = '';
  for (const ch of value) {
    if (ch === '(') depth += 1;
    if (ch === ')') depth -= 1;
    if (ch === ' ' && depth === 0) { if (cur) out.push(cur); cur = ''; } else cur += ch;
  }
  if (cur) out.push(cur);
  return out;
}

// Review of C030: from 1280 to 1358 px the status-bar Play was auto-placed into the flexible
// spacer track and the state (grid-column 3 / 5) painted over it. The Play now has its own
// auto track (md:col-start-3 on the element) that no other item of the status bar spans.
test('the status-bar Play has a grid track of its own from 768 px', () => {
  const cls = (PLAY_TAG.match(/\sclass="([^"]*)"/) || [, ''])[1].split(/\s+/);
  assert.ok(cls.includes('md:col-start-3') && cls.includes('md:row-start-1'), PLAY_TAG);
  const tablet = RESPONSIVE_CSS.indexOf('.osc-statusbar {');
  assert.match(mediaBlockWith(RESPONSIVE_CSS, '.osc-statusbar {').query, /max-width: 1279/);
  const layouts = [
    { name: 'desktop', css: INSTRUMENT_CSS, from: 0 },
    { name: 'tablet', css: RESPONSIVE_CSS, from: tablet },
  ];
  for (const { name, css, from } of layouts) {
    const cols = tracks(declOf(css, '.osc-statusbar', 'grid-template-columns', from));
    assert.equal(cols[2], 'auto', `${name}: track 3 is auto (${cols.join(' ')})`);
    const start = (sel) => parseInt(declOf(css, sel, 'grid-column', from)
      || declOf(INSTRUMENT_CSS, sel, 'grid-column'), 10);
    const spans = (sel) => {
      const v = declOf(css, sel, 'grid-column', from) || declOf(INSTRUMENT_CSS, sel, 'grid-column');
      const [a, b] = v.split('/').map((x) => parseInt(x, 10));
      return Number.isFinite(b) ? a <= 3 && b > 3 : a === 3;
    };
    for (const sel of ['.osc-sb-brand', '.osc-sb-state', '.osc-sb-actions-wrap']) {
      assert.ok(Number.isFinite(start(sel)), `${name}: ${sel} is placed`);
      assert.equal(spans(sel), false, `${name}: ${sel} does not take the Play's track`);
    }
    assert.equal(start('.osc-sb-actions-wrap'), cols.length, `${name}: actions in the last track`);
  }
  for (const u of ['col-start-3', 'row-start-1']) {
    assert.ok(new RegExp(`@media\\s?\\(min-width:\\s?${parseInt(TW_SCREENS.md, 10)}px\\)\\{`
      + `[^@]*\\.md\\\\:${u}\\{`).test(DIST), `dist defines md:${u} inside the md media query`);
  }
});

// Review of C030: the prompts call the status-bar Play "Play in the status bar"; its idle
// accessible name starts with that name ("Play continuously", "Play once"), never "Trigger".
test('the prompts call the status-bar Play by its accessible name', () => {
  assert.equal(shortcuts.playControlName('status'),
    `${shortcuts.STATUS_PLAY_NAME} in the status bar`);
  const dynamic = (PLAY_TAG.match(/:aria-label="([^"]*)"/) || [, ''])[1];
  const names = [...dynamic.matchAll(/'([^']*)'/g)].map((m) => m[1]);
  const idle = names.filter((n) => n !== 'Stop playback');
  assert.ok(names.includes('Stop playback') && idle.length === 2, dynamic);
  for (const n of idle) {
    assert.ok(n.startsWith(`${shortcuts.STATUS_PLAY_NAME} `), `idle name "${n}"`);
  }
  assert.match(PLAY_TAG, new RegExp(`\\saria-label="${shortcuts.STATUS_PLAY_NAME}"`));
  assert.equal(named(`Press ${shortcuts.playControlName('status')} (or Space)`), 'status');
});

test('the status-bar Play is shown where Source & Pattern is hidden, not beside it', () => {
  const at = (ws, px) => utilityShows(statusClass(ws, px >= 1280), px);
  for (const ws of ['analyzer', 'filter', 'compare']) {
    assert.equal(at(ws, 1024), false, `${ws} at 1024 px: Source & Pattern is its Play`);
    assert.equal(at(ws, 1280), true, `${ws} at 1280 px`);
    assert.equal(at(ws, 1536), true, `${ws} at 1536 px`);
  }
  assert.equal(at('presets', 800), true, 'presets at 800 px');
  assert.equal(at('presets', 1536), true, 'presets at 1536 px');
  for (const ws of ['playground', 'sequencer', 'synthesis', 'studio', 'learn']) {
    assert.equal(at(ws, 1536), false, ws);
  }
});

/** The control a prompt names, by the words it uses. */
const named = (text) => (/Play in the status bar/i.test(text) ? 'status'
  : /TRIGGER|HOLD TO PLAY/i.test(text) ? 'source' : null);

test('the preset notice names the Play control the workspace shows at that width', () => {
  const wrong = [];
  for (const w of WIDTHS) {
    for (const ws of INSTRUMENT_WS) {
      for (const programmed of [false, true]) {
        const app = component(ws, { wide: w.wide });
        const cfg = programmed
          ? { source: 'single', pattern: 'pulse', waveform: 'sine', frequency: 440 }
          : { source: 'single', pattern: 'tone', waveform: 'sine', frequency: 440 };
        app.applyPreset({ id: `t-${ws}`, name: 'T', cfg });
        const notice = app.alerts.find((a) => /^Loaded/.test(a.title));
        const says = notice ? named(notice.message) : null;
        if (!shownAt(ws, w).includes(says)) {
          wrong.push(`${w.name} ${ws} ${programmed ? 'programmed' : 'tone'}: ${
            notice && notice.message}`);
        }
        // Where no Hold to Play is shown, the notice says Space plays it too (Hold to Play).
        if (says === 'status' && !/Space/.test(notice.message)) wrong.push(`${ws}: no Space`);
      }
    }
  }
  assert.deepEqual(wrong, []);
});

test('the Learn demo notice names the Play of the workspace it opens', () => {
  // runLearnDemo opens the Playground or Synthesis after the notice: Hold to Play and Trigger.
  for (const ws of ['playground', 'synthesis']) {
    assert.equal(shortcuts.playControl(ws), 'source', ws);
  }
  const app = component('learn');
  app.runDemo({ demo: { label: 'D', cfg: { source: 'single', pattern: 'tone',
    waveform: 'sine', frequency: 440 } } });
  const notice = app.alerts.find((a) => /^Demo ready/.test(a.title));
  assert.ok(notice, 'the demo notice is raised');
  assert.equal(named(notice.message), 'source', notice.message);
  assert.equal(named(app.playPrompt('hear it', 'presets')), 'status');
});

test('the suspended, link and analyser prompts name a Play on screen at that width', () => {
  const wrong = [];
  const check = (where, ws, w, text) => {
    const says = named(text);
    if (says && !shownAt(ws, w).includes(says)) wrong.push(`${where} ${w.name} ${ws}: ${text}`);
  };
  for (const w of WIDTHS) {
    for (const ws of INSTRUMENT_WS) {
      const app = component(ws, { wide: w.wide });
      check('suspended', ws, w, typeof app.suspendedPrompt === 'function'
        ? app.suspendedPrompt() : 'Press HOLD TO PLAY again.');
      // A link with instrument keys opens `ws`: its restore notice names the Play there.
      const link = component('playground', { wide: w.wide, hash: `#f=440&m=${ws}` });
      link.restoreFromHash();
      const restored = link.alerts.find((a) => a.title === 'Configuration restored from link');
      if (!restored) wrong.push(`link ${ws}: no restore notice`);
      else check('link', ws, w, restored.message);
      // The analysis panel's idle label (its aria-label) names the Play the trace starts with.
      if (PANELLESS().includes(ws)) continue;
      app.tabs = { ...(app.tabs || {}), analysis: 'scope' };
      check('analyser label', ws, w, app.analysisCanvasLabel);
    }
  }
  assert.deepEqual(wrong, []);
  // The link notice keeps V1's words where V1's controls are shown (freeze.test.mjs).
  const v1 = component('playground', { hash: '#f=440' });
  v1.restoreFromHash();
  assert.equal(v1.alerts.find((a) => /restored/.test(a.title)).message,
    'Nothing plays until you press HOLD TO PLAY or TRIGGER.');
});

/** A p5 stand-in for the scope (as tests/unit/scope-follows-owner): the labels it draws. */
function scopeLabels(playControl) {
  const drawn = [];
  const ctx = { font: '', fillStyle: '', textAlign: '', textBaseline: '', save() {}, restore() {},
    fillText: (t) => { drawn.push(String(t)); }, measureText: () => ({ width: 1 }) };
  const base = { LEFT: 'left', RIGHT: 'right', CENTER: 'center', CLOSE: 'close',
    drawingContext: ctx, color: () => ({ setAlpha() {}, toString: () => 'rgb(0,0,0)' }) };
  const p = new Proxy(base, { get: (t, k) => (k in t ? t[k] : () => {}) });
  const W = 1200;
  createScopeView({ getWindowMs: () => 5 }).draw({ p, W, H: 200, pal: { gridSoft: 'g', muted: 'm',
    accent: 'a', dim: 'd', accentFaint: 'f', accentSoft: 's' },
    bandMin: new Float32Array(W), bandMax: new Float32Array(W) }, {
    live: { timeData: null, sampleRate: 48000, inst: NaN, refFreq: 250, hasCtx: true },
    playing: false, outputOwner: null, gain: 0.08, frequency: 250, waveform: 'sine', plan: null,
    playControl });
  return drawn;
}

/** The labels the V1 wave view draws while idle with `playControl` in the bridge state. */
function waveLabels(playControl) {
  const log = [];
  const env = { document: { hidden: false, documentElement: {}, addEventListener() {},
    removeEventListener() {} }, devicePixelRatio: 1, requestAnimationFrame: () => 1,
  matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
  ResizeObserver: class { observe() {} disconnect() {} }, setTimeout: () => 1,
  setInterval: () => 1, clearInterval() {} };
  const engine = { snapshot: (o = {}) => Object.assign(o, { hasCtx: true, state: 'running',
    time: 0, sampleRate: 48000, voice: false, analyser: null, timeData: null, mic: false }) };
  const bridge = new VisualizationBridge({ engine, env });
  bridge.palette = new Proxy({}, { get: () => [0, 0, 0] });
  const app = createInstrument({ engine: null, bridge });
  app.sampleRate = 48000;
  app.syncViz();
  if (typeof bridge.setPlayControl === 'function') bridge.setPlayControl(playControl);
  function P5(sketch) {
    const p = new Proxy({ LEFT: 'left', RIGHT: 'right', CENTER: 'center', CLOSE: 'close',
      BASELINE: 'alphabetic', canvas: {}, color: (...a) => a, frameRate: () => 30,
      textWidth: (t) => String(t).length * 6, millis: () => 0, bezierPoint: () => 0,
      createCanvas: () => ({ elt: { setAttribute() {}, style: {} } }) }, {
      get: (t, k) => (k in t ? t[k] : (...a) => { if (k === 'text') log.push(String(a[0])); }),
    });
    sketch(p);
    p.setup();
    return p;
  }
  const container = { getBoundingClientRect: () => ({ width: 900, height: 300 }) };
  const host = createP5Host({ P5, container, bridge, view: 'wave', env });
  host.p5.draw();
  host.destroy();
  return log;
}

test('the analysis idle notes name the Play on screen, or none', () => {
  const press = (labels) => labels.filter((t) => /press /i.test(t));
  for (const kind of ['source', 'status', null]) {
    for (const [view, said] of [['scope', press(scopeLabels(kind))],
      ['wave', press(waveLabels(kind))]]) {
      if (kind) {
        assert.ok(said.length && said.every((t) => named(t) === kind),
          `${view} with ${kind}: ${JSON.stringify(said)}`);
      } else {
        assert.deepEqual(said, [], `${view} names no Play where none is shown`);
      }
    }
  }
  assert.ok(!/press HOLD TO PLAY/.test(read('src/js/visualization/spectrum-data.js')),
    'no unused idle note names Hold to Play');
});
