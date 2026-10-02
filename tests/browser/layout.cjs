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
// - Escape and page hide stop a playing sequence (project.audio-engine-discipline v2), checked
//   with deadline polls, not fixed sleeps.
//
//   node tests/browser/layout.cjs [--browsers chromium,firefox,webkit]   (or OSC_BROWSERS=...)

const path = require('node:path');
const { pathToFileURL } = require('node:url');
const playwright = require('playwright');

const args = process.argv.slice(2);
const arg = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : def;
};
const BROWSERS = arg('browsers', process.env.OSC_BROWSERS || 'chromium,firefox,webkit').split(',');
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
const WORKSPACES = ['playground', 'sequencer', 'analyzer', 'filter', 'synthesis', 'compare'];
// Full-width views (no .osc-panel): their content must stay inside the view's box.
const VIEWS = ['about'];
const TOUCH_WIDTHS = [[320, 812], [375, 812], [768, 1024]];
const TOUCH_WORKSPACES = [...WORKSPACES, 'learn', 'presets', ...VIEWS];
// Product bugs found when this invariant was added (R007, 2026-10-02), reported, not yet fixed in
// src/: the .osc-toggle--lg switches are 25 px wide, .osc-slider--sm ranges are 5 px tall, and
// the preset category tabs are 33-40 px wide at <= 375 px. Remove an entry once it is fixed.
// Every touch target meets 44 px (the list may only shrink; it is empty since the R007 fixes).
const KNOWN_SMALL_TARGETS = new Set([]);
const TOUCH_MIN = 44;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
  for (const id of ['osc-hold-play', 'osc-trigger', 'osc-gain']) {
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
function measureTouch(min) {
  const sel = 'button, a[href], select, textarea, input:not([type=hidden]):not([type=file]), '
    + '[role=tab], [role=radio], [role=switch], [role=menuitem], [role=checkbox]';
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
      const key = el.id || el.dataset.osc || el.className.toString().split(' ')[0]
        || (anchor ? `${anchor.id}>${el.tagName}` : el.tagName);
      small.push({ id: key, w: Math.round(b.width), h: Math.round(b.height) });
    }
  }
  const de = document.documentElement;
  return { coarse: matchMedia('(pointer: coarse)').matches, tested, small,
    overflow: de.scrollWidth > de.clientWidth + 1 ? `${de.scrollWidth} > ${de.clientWidth}` : null };
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
        if (bad.length) failures.push(`${w}x${h} ${ws}: ${bad.slice(0, 6).join('; ')}`);
      }
      for (const ws of VIEWS) {
        await setWorkspace(page, ws);
        const bad = await page.evaluate(measureView, ws);
        checks++;
        if (bad.length) failures.push(`${w}x${h} ${ws}: ${bad.slice(0, 6).join('; ')}`);
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
        if (bad.length) failures.push(`touch ${w}x${h} ${ws}: ${bad.slice(0, 6).join('; ')}`);
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
      await page.waitForTimeout(150); // let it really play for a moment before stopping it
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
  let failed = 0;
  for (const b of BROWSERS) {
    const t0 = Date.now();
    const { checks, failures } = await runOne(b);
    failed += failures.length;
    console.log(`${failures.length ? 'FAIL' : 'PASS'} ${b}/layout: ${checks - failures.length}/${checks} `
      + `checks (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
    for (const f of failures) console.log(`   x ${f}`);
  }
  process.exit(failed ? 1 : 0);
})();
