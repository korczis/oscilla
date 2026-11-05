#!/usr/bin/env node
// Layout and stop regression gate for dist/index.html (file://).
//
// - No visible panel is squashed (content taller than its box) and no two visible panels
//   overlap, at phone, tablet and desktop widths, in every workspace.
// - The transport controls are really hit by a pointer at their centre (nothing covers them).
// - No page-level horizontal overflow, at every width and in every workspace.
// - Coarse pointer (touch) at 320, 375 and 768 px, every workspace: no horizontal overflow and
//   every visible control is at least 44x44 px (range inputs: 44 px tall). Known offenders are
//   listed in KNOWN_SMALL_TARGETS; an unlisted offender fails, and so does a listed one that is
//   fixed (remove it from the list), so the list can only shrink.
// - The Synth workspace at 390x844 with touch (F013 W1, b0's G2), on its Panel, Engines and XY
//   tabs: every control, knob and jack box at least 44 px, no overflow out of the view or the
//   page, and every visible text of the view at least 12 px as drawn (an SVG text by its screen
//   scale). Small text predating the floor is listed in KNOWN_SMALL_FONTS by where it is drawn,
//   its tag and its size, with how many each tab drew when it was listed; an unlisted one fails,
//   a tab drawing more of a listed one fails, and a tab drawing fewer fails until the count is
//   tightened (an entry at 0 on every tab is removed), so the list and its counts only shrink.
// - Escape and page hide stop a playing sequence (project.audio-engine-discipline v2), checked
//   with deadline polls, not fixed sleeps.
//
//   node tests/browser/layout.cjs [--browsers chromium,firefox,webkit]   (or OSC_BROWSERS=...)

const path = require('node:path');
const { pathToFileURL } = require('node:url');
const suite = require('./lib/suite.cjs');
const { until } = require('./lib/wait.cjs');

const args = process.argv.slice(2);
const arg = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : def;
};
const RUN = suite.open({ name: 'layout', browsers: arg('browsers') });
const playwright = RUN.playwright;
const BROWSERS = RUN.browsers;
// --stress-font <family>: render with a wider font (e.g. Verdana) to reproduce the metrics
// of Linux and Windows system-ui fonts on a macOS machine.
const STRESS_FONT = arg('stress-font', null);
const URL = pathToFileURL(path.resolve(__dirname, '../../dist/index.html')).href;
const LAUNCH = {
  chromium: { args: ['--autoplay-policy=no-user-gesture-required'] },
  firefox: { firefoxUserPrefs: { 'media.autoplay.default': 0, 'media.autoplay.blocking_policy': 0 } },
  webkit: {},
};
const WIDTHS = [[320, 640], [375, 812], [768, 1024], [1024, 768], [1280, 800], [1536, 1024]];
// workspace-subset: the panel workspaces the layout invariants were written for
const WORKSPACES = ['playground', 'sequencer', 'analyzer', 'filter', 'synthesis', 'compare'];
// Full-width views: their content must stay inside the view's box. MEASURE and EXPERIMENTS
// are views that hold their own panels, so the panel checks (squashed, overlapping, covered
// primary/STOP) run for them too.
// STUDIO (V3.1) is a view of panels too: toolbar, node library, graph, Inspector, timeline.
// workspace-subset: the full-width views this check holds to their box
const VIEWS = ['measure', 'experiments', 'studio', 'about'];
// workspace-subset: the views among them that hold panels of their own
const PANEL_VIEWS = new Set(['measure', 'experiments', 'studio']);
const TOUCH_WIDTHS = [[320, 812], [375, 812], [768, 1024]];
const TOUCH_WORKSPACES = [...WORKSPACES, 'learn', 'presets', ...VIEWS];
// Product bugs found when this invariant was added (R007, 2026-10-02), reported, not yet fixed in
// src/: the .osc-toggle--lg switches are 25 px wide, .osc-slider--sm ranges are 5 px tall, and
// the preset category tabs are 33-40 px wide at <= 375 px. Remove an entry once it is fixed.
// Every touch target meets 44 px (the list may only shrink; it is empty since the R007 fixes).
const KNOWN_SMALL_TARGETS = new Set([]);
const TOUCH_MIN = 44;
const SYNTH_PHONE = [390, 844];
const SYNTH_TABS = ['panel', 'engines', 'xy'];
// The Synth's own targets beside the controls measureTouch knows: knobs and the jacks' hit boxes.
const SYNTH_TARGETS = '[data-knob], [data-jack] rect:not([data-focus-ring])';
const FONT_MIN = 12;
// Text below FONT_MIN in the Synth when the floor was added (F013 W1, 2026-11-03), keyed
// '<nearest data-osc> <tag> <px>' with how many each tab drew then (the same in chromium, firefox
// and webkit) and where it is drawn. A tab drawing more fails: a new small text of a listed kind
// is a regression like an unlisted one. A tab drawing fewer fails until its count is lowered to
// what it draws, and an entry at 0 on every tab is removed. The synth-theme layer's label module
// (F013) is to lift them all (the list and its counts may only shrink).
const KNOWN_SMALL_FONTS = new Map([
]);
const SYNTH_LOAD_MS = 15000;
// A tab is rendered on a frame after synthTab(): what only that tab's render draws.
const SYNTH_TAB_DRAWS = { panel: '[data-module="vco1"]', engines: '[data-module="additive"]',
  xy: '[data-osc="synth.xy.pad"]' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/** The first n of a list of failures, saying how many more were cut. */
const firstOf = (bad, n) => `${bad.slice(0, n).join('; ')}`
  + `${bad.length > n ? ` (+${bad.length - n} more)` : ''}`;

/**
 * Judge the small text one Synth tab draws ({ key: count } from measureFonts) against `known`
 * (KNOWN_SMALL_FONTS): `bad` holds an unlisted key or a listed one drawn more often than its
 * count, `fewer` a listed one drawn less often (its count is to be lowered).
 */
function judgeFonts(small, tab, known, min) {
  const bad = [];
  const fewer = [];
  for (const [key, n] of Object.entries(small)) {
    const k = known.get(key);
    if (!k) bad.push(`text ${key} (${n}) < ${min} px`);
    else if (n > k[tab]) bad.push(`text ${key} (${n}, ${k[tab]} known on this tab) < ${min} px`);
  }
  for (const [key, k] of known) {
    const n = small[key] || 0;
    if (n < k[tab]) fewer.push(`${key} ${tab}: ${k[tab]} -> ${n}`);
  }
  return { bad, fewer };
}

function measure() {
  const vis = (el) => {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none';
  };
  const panels = [...document.querySelectorAll('.osc-panel')].filter(vis);
  const squashed = [];
  // Visible clipping: a child box reaching past the panel's inner bottom edge. (scrollHeight
  // would also count the panel's own bottom padding, which font metrics may legitimately eat.)
  for (const p of panels) {
    const r = p.getBoundingClientRect();
    const inner = r.top + p.clientTop + p.clientHeight;
    let deepest = -Infinity;
    for (const c of p.children) {
      if (!vis(c)) continue;
      deepest = Math.max(deepest, c.getBoundingClientRect().bottom);
    }
    if (deepest - inner > 2) {
      squashed.push(`${p.id || p.className}: content ${Math.round(deepest - inner)} px past the panel`);
    }
  }
  const overlaps = [];
  const boxes = panels.map((p) => ({ id: p.id || p.className, r: p.getBoundingClientRect() }));
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i].r;
      const b = boxes[j].r;
      const w = Math.min(a.right, b.right) - Math.max(a.left, b.left);
      const h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
      if (w > 2 && h > 2) overlaps.push(`${boxes[i].id} x ${boxes[j].id}: ${Math.round(w)}x${Math.round(h)}`);
    }
  }
  const covered = [];
  for (const id of ['osc-hold-play', 'osc-trigger', 'osc-gain', 'osc-measure-primary',
    'osc-measure-stop']) {
    const el = document.getElementById(id);
    if (!el || !vis(el)) continue;
    el.scrollIntoView({ block: 'center' });
    const r = el.getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    if (!hit || !(hit === el || el.contains(hit))) {
      covered.push(`${id} -> ${hit ? hit.id || hit.className : 'nothing'}`);
    }
  }
  const overflow = document.documentElement.scrollWidth > document.documentElement.clientWidth + 1
    ? `${document.documentElement.scrollWidth} > ${document.documentElement.clientWidth}` : null;
  return { panels: panels.length, squashed, overlaps, covered, overflow };
}

/** Coarse pointer: page overflow and every visible control's box against the 44 px minimum. */
function measureTouch(opts) {
  // opts: the minimum, or [minimum, a selector of further targets] (the Synth's knobs and jacks).
  const [min, extra] = Array.isArray(opts) ? opts : [opts, ''];
  const sel = 'button, a[href], select, textarea, input:not([type=hidden]):not([type=file]), '
    + `[role=tab], [role=radio], [role=switch], [role=menuitem], [role=checkbox]${extra
      ? `, ${extra}` : ''}`;
  const small = [];
  let tested = 0;
  for (const el of document.querySelectorAll(sel)) {
    const b = el.getBoundingClientRect();
    if (!b.width || !b.height || getComputedStyle(el).visibility === 'hidden') continue;
    // the skip link shows only on focus; the stepper keys are pointer helpers of a focusable,
    // full-size number input
    if (el.closest('[hidden], dialog:not([open]), .osc-sr-only, .osc-skip, .osc-stepper-keys')) {
      continue;
    }
    tested++;
    const range = el.type === 'range';
    // A control may keep a small visual box and extend its hit area (padding, a ::before on its
    // wrapper). What a finger hits is what counts: probe the corners of a 44 px square centred
    // on the control; they must land on the control, inside it, or on its own label/switch.
    const hitsTarget = () => {
      el.scrollIntoView({ block: 'center', inline: 'nearest' });
      const r = el.getBoundingClientRect();
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      const h = min / 2 - 1;
      const pts = range ? [[cx, cy - h], [cx, cy + h]]
        : [[cx - h, cy - h], [cx + h, cy - h], [cx - h, cy + h], [cx + h, cy + h]];
      return pts.every(([x, y]) => {
        const hit = document.elementFromPoint(x, y);
        if (!hit) return false;
        if (hit === el || el.contains(hit)) return true;
        const wrap = hit.closest('label, .osc-toggle');
        return !!(wrap && wrap.contains(el));
      });
    };
    if ((b.height < min - 0.5 || (!range && b.width < min - 0.5)) && !hitsTarget()) {
      // Anonymous elements are keyed by their nearest identified ancestor, so the known list
      // stays precise (e.g. "osc-bio-sources>A" rather than every link on the page).
      const anchor = el.parentElement && el.parentElement.closest('[id]');
      const jack = el.closest('[data-jack]');
      const key = el.id || el.dataset.osc || el.dataset.knob || (jack && jack.dataset.jack)
        || (typeof el.className === 'string' ? el.className : '').split(' ')[0]
        || (anchor ? `${anchor.id}>${el.tagName}` : el.tagName);
      small.push({ id: key, w: Math.round(b.width), h: Math.round(b.height) });
    }
  }
  const de = document.documentElement;
  return { coarse: matchMedia('(pointer: coarse)').matches, tested, small,
    overflow: de.scrollWidth > de.clientWidth + 1 ? `${de.scrollWidth} > ${de.clientWidth}` : null };
}

/** Every visible text of the Synth view below `min` px as drawn, grouped by where it is drawn. */
function measureFonts(min) {
  const view = document.getElementById('osc-view-synth');
  const small = {};
  let tested = 0;
  for (const el of view.querySelectorAll('*')) {
    if (![...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) continue;
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    if (r.width <= 1 || r.height <= 1 || cs.visibility === 'hidden' || cs.display === 'none'
      || el.closest('[hidden], .sr-only, .osc-sr-only')) continue;
    tested++;
    let px = parseFloat(cs.fontSize);
    if (el instanceof SVGElement && el.getScreenCTM()) {
      const m = el.getScreenCTM();
      px *= Math.hypot(m.a, m.b);
    }
    if (px >= min - 0.01) continue;
    const at = el.closest('[data-osc]');
    const key = `${at ? at.dataset.osc : 'synth'} ${el.tagName.toLowerCase()} `
      + `${Math.round(px * 2) / 2}px`;
    small[key] = (small[key] || 0) + 1;
  }
  return { tested, small };
}

/** Poll fn in the page until it returns the wanted value or ms expire; returns the last value. */
async function pollPage(page, fn, want, ms) {
  const t0 = Date.now();
  let v = await page.evaluate(fn);
  while (v !== want && Date.now() - t0 < ms) {
    await sleep(25);
    v = await page.evaluate(fn);
  }
  return { v, ms: Date.now() - t0 };
}

function measureView(ws) {
  const view = document.getElementById(`osc-view-${ws}`);
  const r = view.getBoundingClientRect();
  const bad = [];
  if (!(r.width > 0 && r.height > 0)) return ['view not visible'];
  if (document.documentElement.scrollWidth > document.documentElement.clientWidth + 1) {
    bad.push('page scrolls horizontally');
  }
  const inner = { left: r.left + view.clientLeft, right: r.left + view.clientLeft + view.clientWidth,
    bottom: r.top + view.clientTop + view.clientHeight };
  for (const c of view.children) {
    const b = c.getBoundingClientRect();
    if (!b.width || !b.height) continue;
    if (b.left < inner.left - 1 || b.right > inner.right + 1) bad.push(`${c.className} leaves the view sideways`);
    if (b.bottom - inner.bottom > 2) bad.push(`${c.className} ${Math.round(b.bottom - inner.bottom)} px past the view`);
  }
  return bad;
}

async function setWorkspace(page, ws) {
  await page.evaluate((w) => window.OSCILLA.app.setWorkspace(w), ws);
  // timing-allow: app.setWorkspace exposes no layout-settled signal; geometry is read 150 ms on
  await page.waitForTimeout(150);
}

async function runOne(name) {
  const browser = await playwright[name].launch(LAUNCH[name]);
  const failures = [];
  let checks = 0;
  try {
    for (const [w, h] of WIDTHS) {
      const page = await browser.newPage({ viewport: { width: w, height: h } });
      await page.goto(URL);
      await page.waitForFunction(() => window.OSCILLA && window.OSCILLA.app, null, { timeout: 15000 });
      if (STRESS_FONT) {
        await page.addStyleTag({ content: `*{font-family:${JSON.stringify(STRESS_FONT)} !important}` });
      }
      for (const ws of WORKSPACES) {
        await setWorkspace(page, ws);
        const m = await page.evaluate(measure);
        checks++;
        const bad = [...m.squashed.map((s) => `squashed ${s}`), ...m.overlaps.map((s) => `overlap ${s}`),
          ...m.covered.map((s) => `covered ${s}`)];
        if (m.overflow) bad.push(`horizontal overflow ${m.overflow}`);
        if (!m.panels) bad.push('no visible panel');
        if (bad.length) failures.push(`${w}x${h} ${ws}: ${firstOf(bad, 6)}`);
      }
      for (const ws of VIEWS) {
        await setWorkspace(page, ws);
        const bad = await page.evaluate(measureView, ws);
        if (PANEL_VIEWS.has(ws)) {
          const m = await page.evaluate(measure);
          bad.push(...m.squashed.map((x) => `squashed ${x}`),
            ...m.overlaps.map((x) => `overlap ${x}`), ...m.covered.map((x) => `covered ${x}`));
          if (!m.panels) bad.push('no visible panel');
        }
        checks++;
        if (bad.length) failures.push(`${w}x${h} ${ws}: ${firstOf(bad, 6)}`);
      }
      await page.close();
    }

    // Coarse pointer (touch emulation; pointer: coarse matches in all three engines).
    const seenSmall = new Set();
    for (const [w, h] of TOUCH_WIDTHS) {
      const ctx = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: true });
      const page = await ctx.newPage();
      await page.goto(URL);
      await page.waitForFunction(() => window.OSCILLA && window.OSCILLA.app, null, { timeout: 15000 });
      for (const ws of TOUCH_WORKSPACES) {
        await setWorkspace(page, ws);
        const m = await page.evaluate(measureTouch, TOUCH_MIN);
        checks++;
        const bad = [];
        if (!m.coarse) bad.push('pointer: coarse not emulated');
        if (m.tested < 5) bad.push(`only ${m.tested} controls visible`);
        if (m.overflow) bad.push(`horizontal overflow ${m.overflow}`);
        for (const t of m.small) {
          seenSmall.add(t.id);
          if (!KNOWN_SMALL_TARGETS.has(t.id)) bad.push(`target ${t.id} ${t.w}x${t.h} < ${TOUCH_MIN} px`);
        }
        if (bad.length) failures.push(`touch ${w}x${h} ${ws}: ${firstOf(bad, 6)}`);
      }
      await ctx.close();
    }
    checks++;
    const fixed = [...KNOWN_SMALL_TARGETS].filter((id) => !seenSmall.has(id));
    if (fixed.length) {
      failures.push(`KNOWN_SMALL_TARGETS no longer small (fixed? remove them): ${fixed.join(', ')}`);
    }
    if (seenSmall.size) {
      console.log(`  known small touch targets (${name}): ${[...seenSmall].filter((id) =>
        KNOWN_SMALL_TARGETS.has(id)).join(', ')}`);
    }

    // The Synth at the phone size with touch (F013 W1, G2): targets, overflow and the font floor,
    // on each tab.
    const fewerFonts = [];
    {
      const [w, h] = SYNTH_PHONE;
      const ctx = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: true });
      const page = await ctx.newPage();
      await page.goto(URL);
      await page.waitForFunction(() => window.OSCILLA && window.OSCILLA.app, null, { timeout: 15000 });
      await page.evaluate(() => window.OSCILLA.app.setWorkspace('synth'));
      await until(() => page.evaluate(() => window.OSCILLA.app.synthDebug().present
        && !document.getElementById('osc-view-synth').hidden
        && !!document.querySelector('[data-osc="synth.bay.svg"]')),
      { ms: SYNTH_LOAD_MS, what: 'the Synth view is shown and its bay drawn' });
      for (const tab of SYNTH_TABS) {
        await page.evaluate((t) => window.OSCILLA.app.synthTab(t), tab);
        await until(() => page.evaluate(([t, draws]) => {
          const shown = (sel) => [...document.querySelectorAll(`#osc-view-synth ${sel}`)]
            .some((el) => el.getBoundingClientRect().height > 0);
          return window.OSCILLA.app.synthDebug().tab === t
            && Object.entries(draws).every(([id, sel]) => shown(sel) === (id === t))
            && !!document.querySelector('[data-osc="synth.bay.svg"]');
        }, [tab, SYNTH_TAB_DRAWS]), { ms: SYNTH_LOAD_MS, what: `the Synth draws its ${tab} tab` });
        checks++;
        const bad = [];
        const t = await page.evaluate(measureTouch, [TOUCH_MIN, SYNTH_TARGETS]);
        if (!t.coarse) bad.push('pointer: coarse not emulated');
        if (t.tested < 5) bad.push(`only ${t.tested} controls visible`);
        if (t.overflow) bad.push(`horizontal overflow ${t.overflow}`);
        for (const s of t.small) bad.push(`target ${s.id} ${s.w}x${s.h} < ${TOUCH_MIN} px`);
        bad.push(...await page.evaluate(measureView, 'synth'));
        const f = await page.evaluate(measureFonts, FONT_MIN);
        if (f.tested < 20) bad.push(`only ${f.tested} texts visible`);
        const judged = judgeFonts(f.small, tab, KNOWN_SMALL_FONTS, FONT_MIN);
        bad.push(...judged.bad);
        fewerFonts.push(...judged.fewer);
        if (bad.length) failures.push(`synth ${w}x${h} ${tab}: ${firstOf(bad, 8)}`);
      }
      await ctx.close();
    }
    checks++;
    if (fewerFonts.length) {
      failures.push('KNOWN_SMALL_FONTS fell (fixed? lower these counts, remove an entry at 0 on '
        + `every tab): ${fewerFonts.join(', ')}`);
    }

    // Escape and page hide stop a playing sequence: deadline polls (start within 2 s, stop
    // within 250 ms), never a fixed sleep followed by an assertion.
    const page = await browser.newPage({ viewport: { width: 1536, height: 1024 } });
    await page.goto(URL);
    await page.waitForFunction(() => window.OSCILLA && window.OSCILLA.labs && window.OSCILLA.labs.sequencer,
      null, { timeout: 15000 });
    const seqPlaying = () => !!window.OSCILLA.app.seqPlaying;
    for (const how of ['escape', 'hide']) {
      checks++;
      await page.mouse.click(5, 5); // a user gesture so the context may start
      await page.evaluate(() => window.OSCILLA.labs.sequencer.editor.play());
      const started = await pollPage(page, seqPlaying, true, 2000);
      if (!started.v) {
        failures.push(`sequence did not start within 2 s before ${how}`);
        continue;
      }
      // timing-allow: a deliberate 150 ms of playback before the stop under test
      await page.waitForTimeout(150);
      if (how === 'escape') await page.keyboard.press('Escape');
      else {
        await page.evaluate(() => {
          Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
          document.dispatchEvent(new Event('visibilitychange'));
        });
      }
      const stopped = await pollPage(page, seqPlaying, false, 250);
      if (stopped.v) failures.push(`${how} did not stop the sequencer within 250 ms`);
      if (how === 'hide') {
        await page.evaluate(() => { delete document.hidden; });
      }
    }
    await page.close();
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
    RUN.reportLeg({ leg: b, checks });
    failed += failures.length;
    console.log(`${failures.length ? 'FAIL' : 'PASS'} ${b}/layout: ${checks - failures.length}/${checks} `
      + `checks (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
    for (const f of failures) console.log(`   x ${f}`);
  }
  process.exit(failed ? 1 : 0);
})();
