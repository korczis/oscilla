#!/usr/bin/env node
// suite-pace: shared (the knob's DOM and its fixture store; no sound, level or timing judged)
// K206: the knob browser contract, linked, real-time and interactive, in chromium, firefox and
// webkit. The fixture page (tests/browser/fixtures/knob-entry.js, bundled in memory with
// esbuild; nothing is written to disk) mounts the shipped Synth panel (src/js/synth/ui.js
// createSynthUi with the face, the skin src/js/synth/view/knob.js and the knob model
// src/js/ui/synth/knob.js) on a fixture Studio store that persists to localStorage, styled by
// the CSS of the built dist/index.html, and is served from an intercepted http origin, so a
// reload is a real one. The knob under test is the LPF Cutoff (lpf.frequency, Hz, log scale).
//
//   node tests/browser/knob.cjs [--browsers chromium,firefox,webkit]   (or OSC_BROWSERS)
//
// After every gesture the check waits (until(), a named deadline) for the model value to change
// and for aria-valuenow, aria-valuetext and the visible value to show it together, as the
// shipped knob model formats it (K206.expect in the fixture). Checks, per browser:
//   k-role     the knob is role=slider in the accessibility tree (getByRole with its name), its
//              aria-valuetext carries the unit (Hz)
//   k-keys     ArrowUp, ArrowRight, ArrowDown, ArrowLeft, PageUp, PageDown, Home and End each
//              change the value (Home the minimum, End the maximum)
//   k-drag     a pointer drag of 40 px upward raises the value, and while the button is still
//              down the knob already shows it (the drag's in-place update); the same drag with
//              Shift held moves it, by at most a fifth of the plain drag's ARIA travel (fine)
//   k-typed    Enter opens the value field; 300 typed and Enter commits 300 Hz
//   k-touch    a touch drag of 40 px upward raises the value (chromium: real touch events
//              through CDP; firefox and webkit, whose Playwright has no touch move: synthesized
//              PointerEvents of pointerType touch carrying the id of the engine's primary pointer)
//   k-linked   a value typed (777 Hz) is in the fixture store; after a reload the page opens the
//              stored model and the knob shows 777 Hz (aria-valuetext, aria-valuenow and the
//              visible value); a fresh context (empty storage) opens at the initial 1.2 kHz
// Not checked here: the modulation dot hidden under prefers-reduced-motion. N006 draws the dot
// and no build has one yet; a check on a page with no dot would pass vacuously, so that clause
// of K206 stays open until N006 lands.
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const esbuild = require('esbuild');
const suite = require('./lib/suite.cjs');
const { until, WaitTimeout } = require('./lib/wait.cjs');

const argv = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};
const RUN = suite.open({ name: 'knob', browsers: arg('browsers') });
const playwright = RUN.playwright;

const CID = 'lpf.frequency';
const ORIGIN = 'http://k206.fixture';
const PAGE_URL = `${ORIGIN}/knob.html`;
const LOAD_MS = 20000; // the fixture page renders the panel on its first frame
const POINTER_MS = 5000; // a real mouse move reaching the page
const SHOW_MS = 5000; // a gesture's value in the model and on the knob together
const DESKTOP = { width: 1536, height: 1024 };
const DRAG_PX = 40;

const DIST = fs.readFileSync(path.resolve(__dirname, '..', '..', 'dist', 'index.html'), 'utf8');
const CSS = (/<style>([\s\S]*?)<\/style>/.exec(DIST) || [])[1];
if (!CSS) throw new Error('knob: dist/index.html has no <style> block; run npm run build');
const JS = esbuild.buildSync({ entryPoints: [path.join(__dirname, 'fixtures', 'knob-entry.js')],
  bundle: true, format: 'iife', write: false, target: 'es2020', logLevel: 'error' })
  .outputFiles[0].text;
const HTML = '<!doctype html><html lang="cs"><head><meta charset="utf-8">'
  + '<meta name="viewport" content="width=device-width, initial-scale=1">'
  + `<title>OSCILLA knob fixture</title><style>${CSS}</style></head>`
  + '<body class="bg-gray-50 dark:bg-gray-900"><main>'
  + '<section data-osc="synth-view" class="px-4 pt-6"><div data-osc="synth.panel"></div></section>'
  + '<p data-k206="live" aria-live="polite" class="sr-only"></p></main><script>'
  + `${JS.replace(/<\/script/gi, '<\\/script')}</script></body></html>`;

const knobSel = `[data-knob="${CID}"]`;
const valueSel = `[data-value="${CID}"]`;

/** What the knob shows now and what the model says it must show. */
const state = (page) => page.evaluate(([k, o, cid]) => {
  const el = document.querySelector(k);
  const out = document.querySelector(o);
  return { expect: window.K206.expect(cid), stored: window.K206.stored(cid),
    now: el ? Number(el.getAttribute('aria-valuenow')) : null,
    text: el ? el.getAttribute('aria-valuetext') : null,
    shown: out ? out.textContent.trim() : null };
}, [knobSel, valueSel, CID]);

const agrees = (s) => s.now === s.expect.now && s.text === s.expect.text
  && s.shown === s.expect.shown;

/** Wait until the value moved off `before` (or equals `want`) and the knob shows it. */
async function shows(page, what, { before, want } = {}) {
  let last = null;
  try {
    await until(async () => {
      last = await state(page);
      const moved = want !== undefined ? Math.abs(last.expect.value - want) < 1e-9
        : last.expect.value !== before;
      return moved && agrees(last);
    }, { ms: SHOW_MS, what: `knob: ${what}` });
    return { ok: true, s: last };
  } catch (error) {
    if (!(error instanceof WaitTimeout)) throw error;
    return { ok: false, s: last };
  }
}

const describe = (s) => (s ? `model ${s.expect.value} (want ${s.expect.now} "${s.expect.text}" `
  + `"${s.expect.shown}"), knob ${s.now} "${s.text}" "${s.shown}"` : 'no state read');

async function openPage(context) {
  const page = await context.newPage();
  await page.goto(PAGE_URL);
  await page.waitForFunction((k) => window.K206 && document.querySelector(k), knobSel,
    { timeout: LOAD_MS });
  const knob = page.locator(knobSel);
  await knob.scrollIntoViewIfNeeded();
  return { page, knob };
}

async function centre(knob) {
  const b = await knob.boundingBox();
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
}

/** A touch drag of `dy` px from the knob's centre. */
async function touchDrag(name, page, knob, dy) {
  const c = await centre(knob);
  if (name === 'chromium') {
    const cdp = await page.context().newCDPSession(page);
    const at = (y) => [{ x: c.x, y, id: 7 }];
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: at(c.y) });
    for (let i = 1; i <= 4; i += 1) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove',
        touchPoints: at(c.y + (dy * i) / 4) });
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await cdp.detach();
    return;
  }
  // The primary pointer's id as this engine numbers it (firefox 0, webkit 1), read from a real
  // pointermove: a capture is legal only for a pointer the browser knows.
  await page.evaluate(() => {
    window.K206.pointerId = null;
    addEventListener('pointermove', (e) => { window.K206.pointerId = e.pointerId; },
      { once: true, capture: true });
  });
  await page.mouse.move(c.x + 1, c.y + 1);
  await until(() => page.evaluate(() => window.K206.pointerId !== null),
    { ms: POINTER_MS, what: 'knob: a real pointermove names the primary pointer' });
  await knob.evaluate((el, { x, y, d }) => {
    const id = window.K206.pointerId;
    const ev = (type, cy, buttons) => new PointerEvent(type, { bubbles: true, cancelable: true,
      composed: true, pointerId: id, pointerType: 'touch', isPrimary: true, clientX: x,
      clientY: cy, buttons, button: 0, pressure: buttons ? 0.5 : 0 });
    el.dispatchEvent(ev('pointerdown', y, 1));
    for (let i = 1; i <= 4; i += 1) el.dispatchEvent(ev('pointermove', y + (d * i) / 4, 1));
    el.dispatchEvent(ev('pointerup', y + d, 0));
  }, { x: c.x, y: c.y, d: dy });
}

async function runOne(name) {
  const browser = await playwright[name].launch();
  const failures = [];
  let checks = 0;
  const check = (id, ok, detail) => {
    checks += 1;
    RUN.tally(name);
    if (!ok) failures.push(`${id}: ${detail}`);
  };
  const route = (context) => context.route(`${ORIGIN}/**`, (r) => r.fulfill({ status: 200,
    contentType: 'text/html; charset=utf-8', body: HTML }));
  try {
    // ----------------------------------------------------------- desktop: role, keys, drag
    const context = await browser.newContext({ viewport: DESKTOP });
    await route(context);
    const { page, knob } = await openPage(context);
    const first = await state(page);
    check('k-linked', first.expect.value === first.expect.initial && agrees(first),
      `a fresh store opens at the initial value: ${describe(first)}`);

    // The accessibility tree's own reading of the knob (Playwright's ARIA snapshot), and the
    // one slider of that name is this knob.
    const snap = await knob.ariaSnapshot();
    const label = (/^- slider "([^"]+)"/.exec(snap) || [])[1] || '';
    const slider = page.getByRole('slider', { name: label, exact: true });
    const role = /Cutoff/.test(label) && await slider.count() === 1
      && await slider.evaluate((el, k) => el.matches(k), knobSel);
    check('k-role', role && /Hz$/.test(first.text || ''),
      `the ARIA snapshot ${JSON.stringify(snap)} is a slider named for Cutoff and the one of its `
      + `name (${role}); aria-valuetext "${first.text}" ends in its unit, Hz`);

    await knob.focus();
    for (const key of ['ArrowUp', 'ArrowRight', 'ArrowDown', 'ArrowLeft', 'PageUp', 'PageDown',
      'Home', 'End']) {
      const before = (await state(page)).expect.value;
      await page.keyboard.press(key);
      const r = await shows(page, `${key} changes the value and the knob shows it`, { before });
      let ok = r.ok;
      if (ok && key === 'Home') ok = r.s.expect.now === 0;
      if (ok && key === 'End') ok = r.s.expect.now === 1000;
      check('k-keys', ok, `${key} from ${before}: ${describe(r.s)}`);
    }

    // A drag from a value mid-range, so both drags have room to rise.
    await knob.focus();
    await page.keyboard.press('Home');
    await shows(page, 'Home before the drag', { want: 10 });
    for (let i = 0; i < 3; i += 1) await page.keyboard.press('PageUp');
    const mid = await shows(page, 'three PageUp before the drag', { before: 10 });
    const c = await centre(knob);
    const drag = async (fine) => {
      const before = await state(page);
      await page.mouse.move(c.x, c.y);
      if (fine) await page.keyboard.down('Shift');
      await page.mouse.down();
      await page.mouse.move(c.x, c.y - DRAG_PX, { steps: 4 });
      // Real time: while the button is still down the knob already shows the model's value.
      const during = await shows(page, `during a ${fine ? 'Shift ' : ''}drag the knob shows the `
        + 'value', { before: before.expect.value });
      await page.mouse.up();
      if (fine) await page.keyboard.up('Shift');
      const r = await shows(page, `a ${fine ? 'Shift ' : ''}drag up changes the value`,
        { want: during.s ? during.s.expect.value : NaN });
      return { r, during, travel: r.s ? r.s.now - before.now : 0 };
    };
    const plain = await drag(false);
    check('k-drag', mid.ok && plain.during.ok && plain.r.ok && plain.travel > 0,
      `a drag of ${DRAG_PX} px up: travel ${plain.travel} positions, during `
      + `${describe(plain.during.s)}, after ${describe(plain.r.s)}`);
    const fine = await drag(true);
    check('k-drag', fine.during.ok && fine.r.ok && fine.travel > 0
      && fine.travel * 5 <= plain.travel,
      `a Shift drag of ${DRAG_PX} px up: travel ${fine.travel} positions (plain `
      + `${plain.travel}), ${describe(fine.r.s)}`);

    // Typed commit: Enter opens the field, a value and Enter commit it.
    const typed = async (text, want) => {
      await knob.focus();
      await page.keyboard.press('Enter');
      const field = page.locator(`[data-osc="synth.panel"] input[type="text"]`);
      await field.waitFor({ state: 'visible', timeout: SHOW_MS });
      await field.fill(text);
      await field.press('Enter');
      return shows(page, `${text} typed and committed`, { want });
    };
    const t300 = await typed('300', 300);
    check('k-typed', t300.ok && t300.s.text === '300 Hz' && t300.s.shown === '300 Hz',
      `300 typed: ${describe(t300.s)}`);

    // Linked: the typed value is in the store, and a reload shows it from the store.
    const t777 = await typed('777', 777);
    check('k-linked', t777.ok && t777.s.stored === 777,
      `777 typed is in the fixture store (stored ${t777.s && t777.s.stored}): ${describe(t777.s)}`);
    await page.reload();
    await page.waitForFunction((k) => window.K206 && document.querySelector(k), knobSel,
      { timeout: LOAD_MS });
    const back = await shows(page, 'the reloaded page shows the stored value', { want: 777 });
    const restored = await page.evaluate(() => window.K206.restored);
    check('k-linked', back.ok && restored && back.s.text === '777 Hz'
      && back.s.shown === '777 Hz', `after reload (restored ${restored}): ${describe(back.s)}`);
    await context.close();

    // ----------------------------------------------------------- touch
    const touch = await browser.newContext({ viewport: { width: 390, height: 844 },
      hasTouch: true, ...(name === 'firefox' ? {} : { isMobile: true }) });
    await route(touch);
    const tp = await openPage(touch);
    const tBefore = await state(tp.page);
    await touchDrag(name, tp.page, tp.knob, -DRAG_PX);
    const tr = await shows(tp.page, 'a touch drag up changes the value',
      { before: tBefore.expect.value });
    check('k-touch', tr.ok && tr.s.expect.value > tBefore.expect.value,
      `a touch drag of ${DRAG_PX} px up from ${tBefore.expect.value}: ${describe(tr.s)}`);
    await touch.close();
  } finally {
    await browser.close();
  }
  return { checks, failures };
}

(async () => {
  await RUN.ready();
  let failed = 0;
  for (const b of RUN.browsers) {
    const t0 = Date.now();
    const { checks, failures } = await runOne(b);
    failed += failures.length;
    const s = ((Date.now() - t0) / 1000).toFixed(1);
    console.log(`${failures.length ? 'FAIL' : 'PASS'} ${b}/knob: `
      + `${checks - failures.length}/${checks} checks (${s} s)`);
    for (const f of failures) console.log(`   x ${f}`);
  }
  process.exit(failed ? 1 : 0);
})();
