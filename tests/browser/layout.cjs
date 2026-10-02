#!/usr/bin/env node
// Layout and stop regression gate for dist/index.html (file://).
//
// - No visible panel is squashed (content taller than its box) and no two visible panels
//   overlap, at phone, tablet and desktop widths, in every workspace.
// - The transport controls are really hit by a pointer at their centre (nothing covers them).
// - Escape and page hide stop a playing sequence (project.audio-engine-discipline v2).
//
//   node tests/browser/layout.cjs [--browsers chromium,firefox,webkit]

const path = require('node:path');
const { pathToFileURL } = require('node:url');
const playwright = require('playwright');

const args = process.argv.slice(2);
const arg = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : def;
};
const BROWSERS = arg('browsers', 'chromium,firefox,webkit').split(',');
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
  return { panels: panels.length, squashed, overlaps, covered };
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

    // Escape and page hide stop a playing sequence.
    const page = await browser.newPage({ viewport: { width: 1536, height: 1024 } });
    await page.goto(URL);
    await page.waitForFunction(() => window.OSCILLA && window.OSCILLA.labs && window.OSCILLA.labs.sequencer,
      null, { timeout: 15000 });
    for (const how of ['escape', 'hide']) {
      checks++;
      await page.mouse.click(5, 5); // a user gesture so the context may start
      const started = await page.evaluate(async () => {
        const ed = window.OSCILLA.labs.sequencer.editor;
        await ed.play();
        await new Promise((r) => setTimeout(r, 300));
        return !!window.OSCILLA.app.seqPlaying;
      });
      if (!started) {
        failures.push(`sequence did not start before ${how}`);
        continue;
      }
      if (how === 'escape') await page.keyboard.press('Escape');
      else {
        await page.evaluate(() => {
          Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
          document.dispatchEvent(new Event('visibilitychange'));
        });
      }
      await page.waitForTimeout(250);
      const still = await page.evaluate(() => !!window.OSCILLA.app.seqPlaying);
      if (still) failures.push(`${how} did not stop the sequencer`);
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
