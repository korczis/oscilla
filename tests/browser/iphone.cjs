#!/usr/bin/env node
// OSCILLA on a phone (owner, 2026-11-02: "on the iPhone OSCILLA practically does not work;
// verify every route and element, cover it with tests"). Every workspace of the surface census
// (tests/unit/surface-census.json) opens fresh at its deep link on an emulated phone, and the
// instrument's sounding controls are driven by touch.
//
// Phones per engine: webkit is an iPhone 13 and an iPhone SE (Playwright's device profiles:
// WebKit, the engine of every iPhone browser), chromium a Pixel 7, firefox a 390x844 touch
// viewport (Playwright has no mobile emulation for Firefox).
//
// Checks (dist/index.html from file://), per engine and phone:
//   loads-<ws>       the workspace opens at its deep link with no page error
//   no-overflow-<ws> the page does not scroll sideways
//   reach-<ws>       interactive controls that are off the screen's edge (and not inside a
//                    horizontally scrollable ancestor, which a swipe reaches), covered at their
//                    centre by another element once scrolled into view, or smaller than 24 px
//                    (WCAG 2.5.8; a range, checkbox, radio and a link inside running text are
//                    exempt) are counted; the count may not exceed tests/browser/iphone-baseline.json,
//                    a debt that only shrinks (`--record` rewrites it from a passing run)
//   sounds-<what>    after one tap on the page (the gesture unlock), HOLD TO PLAY held, TRIGGER,
//                    the sequencer's play, the Studio's play and a key of the Synth keyboard each
//                    leave the engine running with an active source
//
// Every wait is a condition poll with a named wall-clock deadline (tests/browser/lib/wait.cjs).
//
//   node tests/browser/iphone.cjs [--browsers chromium,firefox,webkit] [--record]

const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const suite = require('./lib/suite.cjs');
const { until, WaitTimeout } = require('./lib/wait.cjs');

const args = process.argv.slice(2);
const arg = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : def;
};
const RECORD = args.includes('--record');
const RUN = suite.open({ name: 'iphone', browsers: arg('browsers') });
const playwright = RUN.playwright;
const BROWSERS = RUN.browsers;
const URL = pathToFileURL(path.resolve(__dirname, '../../dist/index.html')).href;
const BASELINE_FILE = path.resolve(__dirname, 'iphone-baseline.json');
const CENSUS = require('../unit/surface-census.json').surfaces;
const WORKSPACES = CENSUS.filter((s) => s.kind === 'workspace');
const SETTLE_MS = 8000;
const PHONES = {
  webkit: ['iPhone 13', 'iPhone SE'],
  chromium: ['Pixel 7'],
  firefox: [null],
};

function contextOptions(engine, device) {
  if (device) return { ...playwright.devices[device] };
  return { viewport: { width: 390, height: 844 }, hasTouch: true };
}

/** In the page: the reach of every interactive control of the workspace shown (see header). */
function reach() {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const label = (el) => (el.getAttribute('data-osc') || el.id || el.getAttribute('aria-label')
    || (el.textContent || '').trim().slice(0, 32) || el.tagName).replace(/\s+/g, ' ');
  const scrollsSideways = (el) => {
    for (let e = el.parentElement; e && e !== document.body; e = e.parentElement) {
      const ox = getComputedStyle(e).overflowX;
      if ((ox === 'auto' || ox === 'scroll') && e.scrollWidth > e.clientWidth + 1) return true;
    }
    return false;
  };
  const controls = [];
  const sel = 'button, a[href], input:not([type=hidden]), select, textarea, [role=tab], '
    + '[role=button], [role=slider]';
  for (const el of document.querySelectorAll(sel)) {
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none') continue;
    if (!el.offsetParent && cs.position !== 'fixed') continue;
    if (el.closest('dialog:not([open]), [hidden], [aria-hidden="true"]')) continue;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    controls.push({ el, r });
  }
  const out = { mode: document.getElementById('osc-app')?.dataset.mode,
    overflow: document.documentElement.scrollWidth - vw, controls: controls.length,
    offscreen: [], covered: [], tiny: [] };
  for (const { el, r } of controls) {
    if ((r.left < -1 || r.right > vw + 1) && !scrollsSideways(el)) {
      out.offscreen.push(`${label(el)} [${Math.round(r.left)}..${Math.round(r.right)}]`);
    }
    const exempt = ['range', 'checkbox', 'radio'].includes(el.type)
      || (el.tagName === 'A' && el.closest('p, li'));
    if (!exempt && (r.width < 24 || r.height < 24)) {
      out.tiny.push(`${label(el)} ${Math.round(r.width)}x${Math.round(r.height)}`);
    }
  }
  for (const { el } of controls) {
    window.scrollTo(0, 0);
    el.scrollIntoView({ block: 'center', inline: 'nearest' });
    const r = el.getBoundingClientRect();
    const x = r.left + r.width / 2;
    const y = r.top + r.height / 2;
    if (x < 0 || x > vw || y < 0 || y > vh) continue;
    const hit = document.elementFromPoint(x, y);
    if (hit && hit !== el && !el.contains(hit) && !hit.contains(el)) {
      out.covered.push(`${label(el)} under ${label(hit)}`);
    }
  }
  window.scrollTo(0, 0);
  return out;
}

/** In the page: a point of the viewport where a tap reaches no control (null if none). */
function inertSpot() {
  const live = 'button, a, input, select, textarea, label, summary, canvas, [role], [tabindex], '
    + '[contenteditable], [data-osc], [x-on\\:click], [\\@click]';
  for (let y = 0.2; y < 0.9; y += 0.05) {
    for (let x = 0.1; x < 0.95; x += 0.1) {
      const px = window.innerWidth * x;
      const py = window.innerHeight * y;
      const el = document.elementFromPoint(px, py);
      if (el && !el.closest(live)) return { x: px, y: py };
    }
  }
  return null;
}

/** Poll `measure` until `ok(value)`; the last value read is returned either way. */
async function pollFor(measure, ok, what) {
  let last = null;
  try {
    await until(async () => {
      last = await measure();
      return ok(last);
    }, { ms: SETTLE_MS, what });
    return { ok: true, last };
  } catch (error) {
    if (!(error instanceof WaitTimeout)) throw error;
    return { ok: false, last };
  }
}

const sounding = (page) => page.evaluate(() => {
  const s = window.OSCILLA.engine.snapshot();
  return { running: s.running, sources: s.activeSources, voices: s.audibleVoices };
});
const isSounding = (s) => !!s && s.running && s.sources > 0;

// What each sounding control is, where it lives and how a finger drives it.
const SOUNDS = [
  { id: 'hold-to-play', ws: 'playground', sel: '#osc-hold-play', how: 'hold' },
  { id: 'trigger', ws: 'playground', sel: '#osc-trigger', how: 'tap' },
  { id: 'sequencer-play', ws: 'sequencer', sel: '[data-osc="seq.play"]', how: 'tap' },
  { id: 'studio-play', ws: 'studio', sel: '[data-osc="studio.play"]', how: 'tap' },
  // the keys are drawn on one canvas: a finger holds the low part of a white key near its left
  { id: 'synth-key', ws: 'synth', sel: '[data-osc="keyboard.keys"]', how: 'hold-at',
    at: { x: 0.06, y: 0.85 } },
];

async function openAt(browser, engine, device, hash) {
  const context = await browser.newContext(contextOptions(engine, device));
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message.slice(0, 200)));
  await page.goto(`${URL}${hash}`);
  await page.waitForFunction(() => window.OSCILLA && window.OSCILLA.app, null, { timeout: 15000 });
  return { context, page, errors };
}

async function runOne(engine, baseline, recorded) {
  const browser = await playwright[engine].launch();
  const failures = [];
  let checks = 0;
  const check = (id, ok, detail) => {
    checks += 1;
    RUN.tally(engine);
    if (!ok) failures.push(`${id}: ${detail}`);
  };
  try {
    for (const device of PHONES[engine]) {
      const phone = device || '390x844';
      for (const ws of WORKSPACES) {
        const { context, page, errors } = await openAt(browser, engine, device, ws.deepLink);
        const shown = await pollFor(() => page.evaluate(() =>
          document.getElementById('osc-app')?.dataset.mode), (m) => m === ws.id,
        `iphone: ${ws.id} shown on ${phone}`);
        check(`loads-${ws.id}@${phone}`, shown.ok && errors.length === 0,
          `mode ${shown.last}; ${errors.join(' | ')}`);
        const r = await page.evaluate(reach);
        check(`no-overflow-${ws.id}@${phone}`, r.overflow <= 1, `scrolls sideways by ${r.overflow} px`);
        const key = `${engine}/${phone}/${ws.id}`;
        const debt = { offscreen: r.offscreen.length, covered: r.covered.length, tiny: r.tiny.length };
        recorded[key] = debt;
        const allowed = baseline[key] || { offscreen: 0, covered: 0, tiny: 0 };
        const over = Object.keys(debt).filter((k) => debt[k] > allowed[k]);
        check(`reach-${ws.id}@${phone}`, over.length === 0,
          `${over.map((k) => `${k} ${debt[k]} > ${allowed[k]}: ${r[k].slice(0, 4).join('; ')}`).join(' | ')}`);
        await context.close();
      }
      for (const s of SOUNDS) {
        const { context, page } = await openAt(browser, engine, device, `#m=${s.ws}`);
        await pollFor(() => page.evaluate(() => document.getElementById('osc-app')?.dataset.mode),
          (m) => m === s.ws, `iphone: ${s.ws} shown for ${s.id}`);
        // the first gesture unlocks audio: a real tap, on a spot that starts nothing
        const spot = await page.evaluate(inertSpot);
        if (spot) await page.touchscreen.tap(spot.x, spot.y);
        // the first match a finger can see: a hidden copy of the control is no control
        const target = page.locator(s.sel).locator('visible=true').first();
        let result = { ok: false, last: 'no visible control' };
        try {
          if (await target.count()) {
            await target.scrollIntoViewIfNeeded({ timeout: 5000 });
            if (s.how === 'tap') {
              await target.tap({ timeout: 5000 });
              result = await pollFor(() => sounding(page), isSounding, `iphone: ${s.id} sounds`);
            } else if (s.how === 'hold-at') {
              const box = await target.boundingBox();
              const at = { clientX: box.x + box.width * s.at.x, clientY: box.y + box.height * s.at.y,
                pointerType: 'touch', isPrimary: true, pointerId: 1, buttons: 1 };
              await target.dispatchEvent('pointerdown', at);
              result = await pollFor(() => sounding(page), isSounding, `iphone: ${s.id} sounds`);
              await target.dispatchEvent('pointerup', { ...at, buttons: 0 });
            } else {
              await target.dispatchEvent('pointerdown', { pointerType: 'touch', isPrimary: true });
              result = await pollFor(() => sounding(page), isSounding, `iphone: ${s.id} sounds`);
              await target.dispatchEvent('pointerup', { pointerType: 'touch', isPrimary: true });
            }
          }
        } catch (error) {
          result = { ok: false, last: `the control did not take the gesture: ${error.message.split('\n')[0]}` };
        }
        check(`sounds-${s.id}@${phone}`, result.ok, JSON.stringify(result.last));
        await context.close();
      }
    }
  } finally {
    await browser.close();
  }
  return { checks, failures };
}

(async () => {
  await RUN.ready();
  const baseline = fs.existsSync(BASELINE_FILE) ? JSON.parse(fs.readFileSync(BASELINE_FILE, 'utf8')).debt : {};
  const recorded = {};
  let failed = 0;
  for (const b of BROWSERS) {
    const t0 = Date.now();
    const { checks, failures } = await runOne(b, baseline, recorded);
    failed += failures.length;
    console.log(`${failures.length ? 'FAIL' : 'PASS'} ${b}/iphone: `
      + `${checks - failures.length}/${checks} checks (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
    for (const f of failures) console.log(`   x ${f}`);
  }
  if (RECORD) {
    const merged = { ...baseline, ...recorded };
    const sorted = Object.fromEntries(Object.keys(merged).sort().map((k) => [k, merged[k]]));
    fs.writeFileSync(BASELINE_FILE, `${JSON.stringify({
      note: 'Reach debt of tests/browser/iphone.cjs per engine/phone/workspace: off-edge, covered and '
        + 'tiny controls. It only shrinks: a lower count is written with --record, a higher one fails.',
      debt: sorted,
    }, null, 2)}\n`);
    console.log(`recorded ${Object.keys(recorded).length} entries in ${path.relative(process.cwd(), BASELINE_FILE)}`);
  }
  process.exit(failed ? 1 : 0);
})();
