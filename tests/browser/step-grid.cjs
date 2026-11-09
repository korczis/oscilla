#!/usr/bin/env node
// W008: the step-grid kind on its first mounted consumer, the Studio Inspector's step grid of a
// selected notes clip, on the built dist/index.html in chromium, firefox and webkit at
// 1536 x 1024 (a mouse) and 390 x 844 (hasTouch). Every check reads the one store or the page's
// own controls; every wait is a condition poll with a named deadline (lib/wait.cjs). No sample
// rate is assumed: the playhead check waits for aria-current to move, whatever the clock's rate.
//
//   node tests/browser/step-grid.cjs [--browsers chromium,firefox,webkit] [--origins file,http]
//        [--only sg-mount,sg-drag]
//
// Checks (each on a fresh notes clip of 4 beats on a Keys node's event track, selected):
//   sg-mount    the Inspector shows the clip as a role=grid of gridcells (a row per lane, the
//               empty clip's one lane C4), each step at least 44 px square, named
//               "C4, krok 1, vypnuto", four steps a page in the 268 px side panel at 1536 px and
//               eight at 390 px, every one inside the Inspector's box (review R2-W8-1), with no
//               horizontal page scroll
//   sg-drag     a drag along the lane (the mouse at 1536 px, touch pointers at 390 px) switches
//               steps 1-4 on in one CLIP_UPDATE: the notes reach the clip's notes array within
//               'step note in model' (2 s), one undo entry, and one undo gives the empty clip
//   sg-keys     arrows and Enter: ArrowRight then Enter puts a note at step 2 (at 0.25 beats),
//               ] keeps the focus on the same column of the next page and [ brings it back
//               (review R2-W8-2), Delete takes it off, each edit one undo entry; Space builds
//               nothing in the grid
//   sg-playhead with a note in the clip, Studio's Play: aria-current=step appears on a step and
//               moves to another within 'step playhead moves' (3 s); Stop clears it
//   no-console-errors
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const suite = require('./lib/suite.cjs');
const { serveDist } = require('./lib/serve.cjs');
const { until, bounded } = require('./lib/wait.cjs');

const argv = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};
const ROOT = path.resolve(__dirname, '..', '..');
const DIST = path.join(ROOT, 'dist', 'index.html');
const RUN = suite.open({ name: 'step-grid', browsers: arg('browsers'), origins: arg('origins'),
  defaultOrigins: ['file'] });
const playwright = RUN.playwright;
const ONLY = arg('only', '') ? new Set(arg('only', '').split(',')) : null;
const LAUNCH = {
  chromium: { args: ['--autoplay-policy=no-user-gesture-required'] },
  firefox: { firefoxUserPrefs: { 'media.autoplay.default': 0, 'media.autoplay.blocking_policy': 0,
    'media.autoplay.block-webaudio': false } },
  webkit: {},
};
const SIZES = [
  { name: 'desktop', viewport: { width: 1536, height: 1024 }, touch: false },
  { name: 'phone', viewport: { width: 390, height: 844 }, touch: true },
];
const LOAD_MS = 60000;
const UI_MS = 8000; // a selection, a store commit and the Inspector's render
const NOTE_MS = 2000; // W008: 'step note in model'
const PLAYHEAD_MS = 3000; // W008: 'step playhead moves'
const CHECK_MS = 120000;
const GRID = '[data-step-grid="notes"] [role="grid"]';
const CELL = `${GRID} [role="gridcell"]`;

// ------------------------------------------------------------------------------ page helpers
async function openStudio(context, base) {
  const page = await context.newPage();
  await page.goto(`${base}#m=studio`);
  await until(() => page.evaluate(() => {
    const a = window.OSCILLA && window.OSCILLA.app;
    const s = window.OSCILLA && window.OSCILLA.studio;
    return !!(a && a.studio && a.studio.ready && s && s.store && a.workspace === 'studio');
  }), { ms: LOAD_MS, what: 'the Studio workspace is ready' });
  await page.evaluate(() => {
    const a = window.OSCILLA.app;
    a.alerts = [];
    if (!a.safetyCollapsed && typeof a.collapseSafety === 'function') a.collapseSafety();
  });
  return page;
}

/** A Keys node, an event track on it and a selected notes clip of 4 beats with `notes`. */
async function freshClip(page, notes = []) {
  const id = await page.evaluate((ns) => {
    const st = window.OSCILLA.studio.store;
    if (window.OSCILLA.studio.transport.playing) window.OSCILLA.app.studioStop();
    const keys = st.dispatch({ type: 'NODE_ADD', nodeType: 'keys', position: { x: 40, y: 40 } })
      .created.nodes[0];
    const track = st.dispatch({ type: 'TRACK_ADD', kind: 'event', target: keys })
      .created.tracks[0];
    const clip = st.dispatch({ type: 'CLIP_ADD', trackId: track, kind: 'notes', startBeats: 0,
      durationBeats: 4, payload: { notes: ns } }).created.clips[0];
    st.dispatch({ type: 'SELECTION_CHANGE', selection: { clips: [clip] } });
    return clip;
  }, notes);
  // At a phone's width the Inspector is a subview: open its tab as the owner would.
  const tab = page.locator('[data-osc="studio.subview"][data-value="inspector"]');
  if (await tab.isVisible()) await tab.click();
  // Shown and fitted: a row holds the steps its laid-out width fits (8 from 345 px, else 4),
  // so no later re-fit replaces the cells under a check.
  await until(() => page.evaluate((sel) => {
    const g = document.querySelector(sel);
    if (!g || !g.getClientRects().length) return false;
    const row = g.querySelectorAll('[role="row"]:first-child [role="gridcell"]').length;
    return row === (g.clientWidth >= 345 ? 8 : 4);
  }, GRID), { ms: UI_MS, what: 'the Inspector shows the notes clip as a fitted step grid' });
  return id;
}
const notesOf = (page, id) => page.evaluate((cid) => window.OSCILLA.studio.model.timeline.clips
  .find((c) => c.id === cid).payload.notes.map((n) => [n.at, n.note]), id);
const undoDepth = (page) => page.evaluate(() => window.OSCILLA.studio.store.debugInfo()
  .undoDepth);

/** Below the fold at a phone's width: the grid scrolled into view, as the owner scrolls to it. */
const scrollToGrid = (page) => page.evaluate((sel) => {
  document.querySelector(sel).scrollIntoView({ block: 'center' });
}, GRID);

/** Drag from step `a` to step `b` of the first lane: mouse, or touch pointers on a phone. */
async function drag(page, a, b, touch) {
  await scrollToGrid(page);
  const boxes = await page.evaluate(({ sel, a: x, b: y }) => [x, y].map((s) => {
    const r = document.querySelector(`${sel}[data-lane="0"][data-step="${s}"]`)
      .getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }), { sel: CELL, a, b });
  if (!touch) {
    await page.mouse.move(boxes[0].x, boxes[0].y);
    await page.mouse.down();
    await page.mouse.move(boxes[1].x, boxes[1].y, { steps: 6 });
    await page.mouse.up();
    return;
  }
  // Playwright drives no held touch drag in every engine: the pointer events a finger sends.
  await page.evaluate(({ from, to }) => {
    const fire = (type, p, target) => target.dispatchEvent(new PointerEvent(type, {
      bubbles: true, cancelable: true, composed: true, pointerId: 7, pointerType: 'touch',
      isPrimary: true, clientX: p.x, clientY: p.y, button: 0, buttons: type === 'pointerup' ? 0
        : 1 }));
    const first = document.elementFromPoint(from.x, from.y);
    fire('pointerdown', from, first);
    for (let i = 1; i <= 6; i += 1) {
      const p = { x: from.x + ((to.x - from.x) * i) / 6, y: from.y + ((to.y - from.y) * i) / 6 };
      fire('pointermove', p, document.elementFromPoint(p.x, p.y) || first);
    }
    fire('pointerup', to, document.elementFromPoint(to.x, to.y) || first);
  }, { from: boxes[0], to: boxes[1] });
}

// ------------------------------------------------------------------------------ checks
function defineChecks() {
  const checks = [];
  const def = (name, fn) => checks.push({ name, fn });

  def('sg-mount', async ({ page, size }) => {
    await freshClip(page);
    if (size.touch) await scrollToGrid(page);
    const info = await page.evaluate((sel) => {
      const g = document.querySelector(sel);
      const cells = [...g.querySelectorAll('[role="gridcell"]')];
      const rects = cells.map((c) => c.getBoundingClientRect());
      // Review R2-W8-1: every step inside the Inspector's clipping box, none cut off.
      const clip = g.closest('[data-osc="studio.inspector"]').getBoundingClientRect();
      const cut = rects.filter((r) => r.left < clip.left - 0.5 || r.right > clip.right + 0.5)
        .length;
      return { rows: g.querySelectorAll('[role="row"]').length,
        head: g.querySelector('[role="rowheader"]').textContent.trim(), cells: cells.length,
        small: rects.filter((r) => r.width < 43.5 || r.height < 43.5).length,
        name: cells[0].getAttribute('aria-label'),
        scroll: document.scrollingElement.scrollWidth - window.innerWidth, cut };
    }, GRID);
    // Four steps a page in the 268 px side panel at 1536 px, eight at a phone's full width.
    const want = size.touch ? 8 : 4;
    return { ok: info.rows === 1 && info.head === 'C4' && info.cells === want && info.cut === 0
      && info.small === 0
      && info.name === 'C4, krok 1, vypnuto' && info.scroll <= 0, ...info };
  });

  def('sg-drag', async ({ page, size }) => {
    const id = await freshClip(page);
    const depth = await undoDepth(page);
    await drag(page, 0, 3, size.touch);
    let seen = null;
    const notes = await until(async () => {
      seen = await notesOf(page, id);
      return seen.length === 4 ? seen : null;
    }, { ms: NOTE_MS, what: 'step note in model' }).catch((e) => {
      throw new Error(`${e.message}; the clip holds ${JSON.stringify(seen)}`);
    });
    const one = (await undoDepth(page)) === depth + 1;
    await page.evaluate(() => window.OSCILLA.studio.store.undo());
    const undone = await until(async () => ((await notesOf(page, id)).length === 0 ? true
      : null), { ms: UI_MS, what: 'sg-drag: one undo gives the empty clip' });
    return { ok: JSON.stringify(notes) === JSON.stringify([[0, 60], [0.25, 60], [0.5, 60],
      [0.75, 60]]) && one && undone, notes, one };
  });

  def('sg-keys', async ({ page }) => {
    const id = await freshClip(page);
    await page.locator(`${CELL}[data-lane="0"][data-step="0"]`).focus();
    const depth = await undoDepth(page);
    await page.keyboard.press('Space');
    const spaceNotes = await notesOf(page, id);
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('Enter');
    const on = await until(async () => {
      const n = await notesOf(page, id);
      return n.length === 1 ? n : null;
    }, { ms: NOTE_MS, what: 'step note in model' });
    const focused = await page.evaluate(() => document.activeElement
      && document.activeElement.getAttribute('aria-label'));
    // Review R2-W8-2: ] moves the page and keeps the focus on the same column there.
    await page.keyboard.press(']');
    const paged = await until(() => page.evaluate(() => {
      const a = document.activeElement;
      return a && a.getAttribute('role') === 'gridcell' ? Number(a.dataset.step) : null;
    }), { ms: UI_MS, what: 'sg-keys: ] keeps the focus on a step of the next page' });
    await page.keyboard.press('[');
    await until(() => page.evaluate(() => {
      const a = document.activeElement;
      return a && a.getAttribute('aria-label') === 'C4, krok 2, zapnuto';
    }), { ms: UI_MS, what: 'sg-keys: [ brings the focus back to step 2' });
    await page.keyboard.press('Delete');
    const off = await until(async () => ((await notesOf(page, id)).length === 0 ? true : null),
      { ms: NOTE_MS, what: 'sg-keys: Delete takes the step off' });
    const steps = (await undoDepth(page)) - depth;
    if (await page.evaluate(() => window.OSCILLA.studio.transport.playing)) {
      await page.evaluate(() => window.OSCILLA.app.studioStop());
    }
    return { ok: spaceNotes.length === 0 && JSON.stringify(on) === '[[0.25,60]]'
      && focused === 'C4, krok 2, zapnuto' && paged > 1 && off && steps === 2, on, focused,
    paged, steps };
  });

  def('sg-playhead', async ({ page }) => {
    await freshClip(page, [{ at: 0, note: 60, len: 0.25, vel: 0.7 }]);
    await page.evaluate(() => window.OSCILLA.app.studioPlay());
    const current = () => page.evaluate((sel) => {
      const c = document.querySelector(`${sel}[aria-current="step"]`);
      return c ? Number(c.dataset.step) : null;
    }, CELL);
    const first = await until(async () => {
      const s = await current();
      return s === null ? null : { s };
    }, { ms: PLAYHEAD_MS, what: 'step playhead moves' });
    const moved = await until(async () => {
      const s = await current();
      return s !== null && s !== first.s ? { s } : null;
    }, { ms: PLAYHEAD_MS, what: 'step playhead moves' });
    await page.evaluate(() => window.OSCILLA.app.studioStop());
    const cleared = await until(async () => ((await current()) === null ? true : null),
      { ms: UI_MS, what: 'sg-playhead: Stop clears the playing step' });
    return { ok: !!(first && moved && cleared), first: first.s, moved: moved.s };
  });

  def('no-console-errors', async ({ errors }) => ({ ok: errors.length === 0,
    errors: errors.slice(0, 4) }));
  return checks;
}

// ------------------------------------------------------------------------------ runner
async function runLeg(browserName, base, size) {
  const browser = await playwright[browserName].launch(LAUNCH[browserName]);
  const results = {};
  try {
    const context = await browser.newContext({ viewport: size.viewport, hasTouch: size.touch });
    const errors = [];
    context.on('page', (pg) => {
      pg.on('pageerror', (e) => errors.push(String(e)));
      pg.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    });
    const page = await openStudio(context, base);
    for (const { name, fn } of defineChecks()) {
      if (ONLY && !ONLY.has(name)) continue;
      const t0 = Date.now();
      try {
        const v = await bounded(fn({ page, context, base, browserName, errors, size }),
          { ms: CHECK_MS, what: `${name} finishes` });
        results[name] = { ...v, ms: Date.now() - t0 };
      } catch (e) {
        results[name] = { ok: false, detail: String(e.message || e).split('\n')[0],
          ms: Date.now() - t0 };
      }
    }
    await context.close().catch(() => {});
  } finally {
    await browser.close();
  }
  return results;
}

(async () => {
  const known = defineChecks().map((c) => c.name);
  const unknown = ONLY ? [...ONLY].filter((n) => !known.includes(n)) : [];
  if (unknown.length) {
    console.error(`unknown --only check(s) ${unknown.join(', ')}; known: ${known.join(', ')}`);
    process.exit(2);
  }
  await RUN.ready();
  if (!fs.existsSync(DIST)) {
    console.error(`missing ${DIST}: run npm run build`);
    process.exit(2);
  }
  const server = RUN.origins.includes('http')
    ? await serveDist(DIST, { prefix: 'oscilla-step-grid-' }) : null;
  let failed = 0;
  try {
    for (const b of RUN.browsers) {
      for (const o of RUN.origins) {
        const base = o === 'file' ? pathToFileURL(DIST).href : server.url;
        for (const size of SIZES) {
          const key = `${b}/${o}/${size.name}`;
          const t0 = Date.now();
          const res = await runLeg(b, base, size);
          const names = Object.keys(res);
          RUN.reportLeg({ leg: key, checks: names.length });
          const bad = names.filter((n) => !res[n].ok);
          failed += bad.length;
          console.log(`${bad.length ? 'FAIL' : 'PASS'} ${key}/step-grid: ${names.length
            - bad.length}/${names.length} checks (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
          for (const n of names) {
            const line = JSON.stringify(res[n]).slice(0, 600);
            console.log(`   ${res[n].ok ? 'ok' : 'x '} ${n}: ${line}`);
          }
        }
      }
    }
  } finally {
    if (server) server.close();
  }
  process.exit(failed ? 1 : 0);
})();
