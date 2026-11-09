#!/usr/bin/env node
// suite-pace: shared (layout at phone sizes; no audio judged)
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
//                    the sequencer's play, the Studio's play, a key of the Synth keyboard and a
//                    key of the Studio's keyboard, unfolded from its handle first (#444), each
//                    leave the engine running with an active source
//   stops-on-hide-<what>  then the page is hidden (visibilitychange, as a phone's lock or app
//                    switch sends it) with a held control's finger still down: within HIDE_MS
//                    the engine is left with no active source and no surface still claims to
//                    play (journey 21; not TRIGGER, whose note ends that soon by itself)
//   denied-mic / denied-midi / denied-storage  with storage, MIDI and the microphone all
//                    refused (journey 22): Use microphone says "permission denied" and shows no
//                    detected frequency, Connect MIDI ends `denied`, Experiments says its
//                    records last for this page view only, and the page raises no error
//   same-hold-touch-keyboard  Hold to Play held by a finger and by Space on the focused control
//                    (journey 24): both sound, both say aria-pressed true with the same
//                    accessible name, and letting go stops within HIDE_MS and says false
//   escape-stops-sequencer  the sequencer started by a tap stops at Escape within HIDE_MS and
//                    its Play control stops saying pressed
//
// Every wait is a condition poll with a named wall-clock deadline (tests/browser/lib/wait.cjs).
//
//   node tests/browser/iphone.cjs [--browsers chromium,firefox,webkit] [--dist <file>] [--record]

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
const DIST = path.resolve(arg('dist', path.resolve(__dirname, '../../dist/index.html')));
const URL = pathToFileURL(DIST).href;
const BASELINE_FILE = path.resolve(__dirname, 'iphone-baseline.json');
const CENSUS = require('../unit/surface-census.json').surfaces;
const WORKSPACES = CENSUS.filter((s) => s.kind === 'workspace');
const SETTLE_MS = 8000;
// a hidden page stops with a fast fade, well inside this; a control that ends on its own (a
// trigger's note, a transport's last step) takes longer, so it cannot pass for a stop
const HIDE_MS = 1500;
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
async function pollFor(measure, ok, what, ms = SETTLE_MS) {
  let last = null;
  try {
    await until(async () => {
      last = await measure();
      return ok(last);
    }, { ms, what });
    return { ok: true, last };
  } catch (error) {
    if (!(error instanceof WaitTimeout)) throw error;
    return { ok: false, last };
  }
}

const sounding = (page) => page.evaluate(() => {
  const s = window.OSCILLA.engine.snapshot();
  const app = window.OSCILLA.app;
  // what the surfaces claim: a transport that says it plays is live whatever the engine holds
  // between two of its notes
  const claims = app ? ['playing', 'seqPlaying', 'studioPlaying', 'latched']
    .filter((k) => !!app[k]) : ['no app'];
  return { running: s.running, sources: s.activeSources, voices: s.audibleVoices, claims };
});
const isSounding = (s) => !!s && s.running && s.sources > 0;

// What each sounding control is, where it lives and how a finger drives it.
const SOUNDS = [
  { id: 'hold-to-play', ws: 'playground', sel: '#osc-hold-play', how: 'hold' },
  // a trigger's note ends inside HIDE_MS by itself, so a hide can prove nothing about it
  { id: 'trigger', ws: 'playground', sel: '#osc-trigger', how: 'tap', endsByItself: true },
  { id: 'sequencer-play', ws: 'sequencer', sel: '[data-osc="seq.play"]', how: 'tap' },
  { id: 'studio-play', ws: 'studio', sel: '[data-osc="studio.play"]', how: 'tap' },
  // the keys are drawn on one canvas: a finger holds the low part of a white key near its left
  { id: 'synth-key', ws: 'synth', sel: '[data-osc="keyboard.keys"]', how: 'hold-at',
    at: { x: 0.06, y: 0.85 } },
  // #444: on a phone the Studio opens armed (Q105) with its keys folded to the dock's handle,
  // so the toolbar stays clear; a tap on the handle unfolds them and a held key sounds
  { id: 'studio-key', ws: 'studio', unfold: '[data-osc="keyboard.handle"]',
    sel: '[data-osc="keyboard.keys"]', how: 'hold-at', at: { x: 0.06, y: 0.85 } },
];

async function openAt(browser, engine, device, hash, init = null) {
  const context = await browser.newContext(contextOptions(engine, device));
  if (init) await context.addInitScript(init);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message.slice(0, 200)));
  await page.goto(`${URL}${hash}`);
  await page.waitForFunction(() => window.OSCILLA && window.OSCILLA.app, null, { timeout: 15000 });
  return { context, page, errors };
}

/**
 * In-page, before any script (journey 22): a phone that grants nothing. Reading localStorage,
 * sessionStorage or indexedDB throws a SecurityError, and the MIDI and microphone requests are
 * refused with NotAllowedError, as a private tab or a denied prompt does.
 */
function denyCapabilities() {
  const refused = (name) => () => Promise.reject(new DOMException(`${name} in the phone check`,
    name));
  for (const key of ['localStorage', 'sessionStorage', 'indexedDB']) {
    try {
      Object.defineProperty(window, key, { configurable: true,
        get() { throw new DOMException(`${key} is denied`, 'SecurityError'); } });
    } catch { /* a browser that will not redefine it keeps its own */ }
  }
  navigator.requestMIDIAccess = refused('NotAllowedError');
  if (navigator.mediaDevices) navigator.mediaDevices.getUserMedia = refused('NotAllowedError');
  else {
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true,
      value: { getUserMedia: refused('NotAllowedError') } });
  }
}

/** Journey 22: each denied capability says so where it is offered, and nothing invents data. */
async function deniedJourney(browser, engine, device, phone, check) {
  // the microphone: the readout states the denial, never a detected frequency
  {
    const { context, page, errors } = await openAt(browser, engine, device, '#m=analyzer',
      denyCapabilities);
    try {
      const spot = await page.evaluate(inertSpot);
      if (spot) await page.touchscreen.tap(spot.x, spot.y);
      const toggle = page.locator('#osc-mic-toggle').locator('visible=true').first();
      let mic = { ok: false, last: 'no visible Use microphone' };
      if (await toggle.count()) {
        await toggle.scrollIntoViewIfNeeded({ timeout: 5000 });
        await toggle.tap({ timeout: 5000 });
        mic = await pollFor(() => page.evaluate(() => ({
          text: document.getElementById('osc-mic-detected').textContent.trim(),
          pressed: document.getElementById('osc-mic-toggle').getAttribute('aria-pressed'),
        })), (v) => /permission denied/.test(v.text), `iphone: the denied microphone says so`);
      }
      check(`denied-mic@${phone}`, mic.ok && mic.last.pressed === 'false'
        && !/\d\s*Hz/.test(mic.last.text) && errors.length === 0,
        `${JSON.stringify(mic.last)} ${errors.join(' | ')}`);
      // MIDI: Connect MIDI, the explicit action, ends denied and raises no error
      // on a phone Settings sits in the status bar's Actions menu: open it the way a finger does
      const settings = page.locator('[data-osc="action.settings"]').locator('visible=true');
      if (!(await settings.count())) {
        await page.locator('[data-osc="status.actionsMenu"]').locator('visible=true').first()
          .tap({ timeout: 5000 });
      }
      await settings.first().tap({ timeout: 5000 });
      const connect = page.locator('[data-osc="midi.connect"]').locator('visible=true').first();
      let midi = { ok: false, last: 'no visible Connect MIDI' };
      if (await connect.count()) {
        await connect.scrollIntoViewIfNeeded({ timeout: 5000 });
        await connect.tap({ timeout: 5000 });
        midi = await pollFor(() => page.evaluate(() => {
          const el = document.querySelector('[data-osc="midi.status"]');
          return { state: el.dataset.midiState || null, text: el.textContent.trim() };
        }), (v) => v.state === 'denied', 'iphone: the denied MIDI request says so');
      }
      check(`denied-midi@${phone}`, midi.ok && errors.length === 0,
        `${JSON.stringify(midi.last)} ${errors.join(' | ')}`);
    } catch (error) {
      check(`denied-midi@${phone}`, false, `the journey stopped: ${error.message.split('\n')[0]}`);
    } finally {
      await context.close();
    }
  }
  // storage: Experiments says its records last for this page view only, and nothing throws
  {
    const { context, page, errors } = await openAt(browser, engine, device, '#m=experiments',
      denyCapabilities);
    try {
      const note = await pollFor(() => page.evaluate(() => {
        const el = document.querySelector('.osc-x-store');
        return el ? { shown: el.offsetParent !== null, text: el.textContent.trim() } : null;
      }), (v) => !!v && v.shown && /in memory for this page view only/.test(v.text),
      'iphone: Experiments says its records last for this page view');
      check(`denied-storage@${phone}`, note.ok && errors.length === 0,
        `${JSON.stringify(note.last)} ${errors.join(' | ')}`);
    } finally {
      await context.close();
    }
  }
}

/** The control's accessible name and pressed state, as a screen reader reads them. */
const announced = (page, sel) => page.evaluate((q) => {
  const el = document.querySelector(q);
  if (!el) return null;
  const by = el.getAttribute('aria-labelledby');
  const name = (el.getAttribute('aria-label')
    || (by ? by.split(/\s+/).map((id) => document.getElementById(id)?.textContent || '').join(' ')
      : el.textContent) || '').replace(/\s+/g, ' ').trim();
  return { name, pressed: el.getAttribute('aria-pressed') };
}, sel);

/**
 * Journey 24: a finger, a keyboard and a screen reader reach the same action and the same safe
 * stop. Hold to Play held by touch and by Space on the focused control both sound and both say
 * pressed; letting go stops within HIDE_MS and says not pressed. The sequencer started by a tap
 * stops at Escape, and its Play control stops saying pressed.
 */
async function sameActionJourney(browser, engine, device, phone, check) {
  const { context, page, errors } = await openAt(browser, engine, device, '#m=playground');
  try {
    const spot = await page.evaluate(inertSpot);
    if (spot) await page.touchscreen.tap(spot.x, spot.y);
    const hold = page.locator('#osc-hold-play').locator('visible=true').first();
    await hold.scrollIntoViewIfNeeded({ timeout: 5000 });
    const box = await hold.boundingBox();
    const idle = (v) => !!v && v.sources === 0 && v.claims.length === 0;
    const ways = {
      touch: {
        press: async () => {
          await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
          await page.mouse.down();
        },
        lift: () => page.mouse.up(),
      },
      keyboard: {
        press: async () => {
          await hold.focus();
          await page.keyboard.down('Space');
        },
        lift: () => page.keyboard.up('Space'),
      },
    };
    const seen = {};
    for (const [way, w] of Object.entries(ways)) {
      await w.press();
      const on = await pollFor(() => sounding(page), isSounding, `iphone: hold by ${way} sounds`);
      const said = await announced(page, '#osc-hold-play');
      await w.lift();
      const off = await pollFor(() => sounding(page), idle, `iphone: hold by ${way} stops`,
        HIDE_MS);
      const after = await announced(page, '#osc-hold-play');
      seen[way] = { sounds: on.ok, pressed: said && said.pressed, stops: off.ok,
        released: after && after.pressed, name: said && said.name };
    }
    const same = JSON.stringify(seen.touch) === JSON.stringify(seen.keyboard);
    check(`same-hold-touch-keyboard@${phone}`, same && seen.touch.sounds && seen.touch.stops
      && seen.touch.pressed === 'true' && seen.touch.released === 'false'
      && seen.touch.name.length > 0 && errors.length === 0,
    `${JSON.stringify(seen)} ${errors.join(' | ')}`);
  } catch (error) {
    check(`same-hold-touch-keyboard@${phone}`, false,
      `the journey stopped: ${error.message.split('\n')[0]}`);
  } finally {
    await context.close();
  }
  const seq = await openAt(browser, engine, device, '#m=sequencer');
  try {
    const spot = await seq.page.evaluate(inertSpot);
    if (spot) await seq.page.touchscreen.tap(spot.x, spot.y);
    const play = seq.page.locator('[data-osc="seq.play"]').locator('visible=true').first();
    await play.scrollIntoViewIfNeeded({ timeout: 5000 });
    await play.tap({ timeout: 5000 });
    const on = await pollFor(() => sounding(seq.page), isSounding, 'iphone: the sequencer plays');
    const playing = await announced(seq.page, '[data-osc="seq.play"]');
    await seq.page.keyboard.press('Escape');
    const off = await pollFor(() => sounding(seq.page),
      (v) => !!v && v.sources === 0 && v.claims.length === 0, 'iphone: Escape stops it', HIDE_MS);
    const stopped = await announced(seq.page, '[data-osc="seq.play"]');
    check(`escape-stops-sequencer@${phone}`, on.ok && off.ok && playing.pressed === 'true'
      && stopped.pressed === 'false' && seq.errors.length === 0,
    `${JSON.stringify({ on: on.last, off: off.last, playing, stopped })} ${seq.errors.join(' | ')}`);
  } catch (error) {
    check(`escape-stops-sequencer@${phone}`, false,
      `the journey stopped: ${error.message.split('\n')[0]}`);
  } finally {
    await seq.context.close();
  }
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
        // a folded dock is unfolded by its handle first, as a finger would (#444)
        if (s.unfold) {
          const handle = page.locator(s.unfold).locator('visible=true').first();
          if (await handle.count()) {
            await handle.tap({ timeout: 5000 });
            await pollFor(() => page.evaluate((sel) => document.querySelector(sel)
              ?.getAttribute('aria-expanded'), s.unfold), (x) => x === 'true',
            `iphone: ${s.id} the dock unfolds`);
          }
        }
        // the first match a finger can see: a hidden copy of the control is no control
        const target = page.locator(s.sel).locator('visible=true').first();
        let result = { ok: false, last: 'no visible control' };
        let lift = null; // a held control's finger stays down until the page has been hidden
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
              lift = () => target.dispatchEvent('pointerup', { ...at, buttons: 0 });
            } else {
              // a trusted press: the control takes pointer capture, which a synthetic pointer
              // loses at once (lostpointercapture ends the hold by itself)
              const box = await target.boundingBox();
              await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
              await page.mouse.down();
              result = await pollFor(() => sounding(page), isSounding, `iphone: ${s.id} sounds`);
              lift = () => page.mouse.up();
            }
          }
        } catch (error) {
          result = { ok: false, last: `the control did not take the gesture: ${error.message.split('\n')[0]}` };
        }
        // the handle's light shows the held note (#444): a played key answers on the strip too
        if (s.unfold && result.ok) {
          const lit = await pollFor(() => page.evaluate(() => document.querySelector(
            '[data-osc="keyboard.handle.held"]')?.getAttribute('data-held')), (x) => x === 'true',
          `iphone: ${s.id} the handle's light shows the held key`);
          if (!lit.ok) result = { ok: false, last: `sounding, but the handle's light is ${lit.last}` };
        }
        check(`sounds-${s.id}@${phone}`, result.ok, JSON.stringify(result.last));
        // Journey 21 (One Living System, G): a page the phone hides (lock, switch app) stops
        // everything it plays, with the finger still on a held control: no live source is left
        // and no surface still claims to play.
        if (result.ok && !s.endsByItself) {
          await page.evaluate(() => {
            Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
            Object.defineProperty(document, 'visibilityState', { configurable: true,
              get: () => 'hidden' });
            document.dispatchEvent(new Event('visibilitychange'));
          });
          const silent = await pollFor(() => sounding(page),
            (v) => !!v && v.sources === 0 && v.claims.length === 0,
            `iphone: ${s.id} silent once the page is hidden`, HIDE_MS);
          check(`stops-on-hide-${s.id}@${phone}`, silent.ok, JSON.stringify(silent.last));
        }
        if (lift) await lift().catch(() => {});
        await context.close();
      }
      await deniedJourney(browser, engine, device, phone, check);
      await sameActionJourney(browser, engine, device, phone, check);
    }
  } finally {
    await browser.close();
  }
  return { checks, failures };
}

(async () => {
  await RUN.ready();
  const file = fs.existsSync(BASELINE_FILE) ? JSON.parse(fs.readFileSync(BASELINE_FILE, 'utf8'))
    : {};
  const baseline = file.debt || {};
  // Why a debt is open, per `<engine/phone/workspace>.<kind>`: the issue that removes it. --record
  // keeps every reason whose debt is still there and drops one whose count reached 0.
  const reasons = file.reasons || {};
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
    const kept = Object.fromEntries(Object.entries(reasons).filter(([k]) => {
      const [key, kind] = [k.slice(0, k.lastIndexOf('.')), k.slice(k.lastIndexOf('.') + 1)];
      return sorted[key] && sorted[key][kind] > 0;
    }).sort(([a], [b]) => a.localeCompare(b)));
    fs.writeFileSync(BASELINE_FILE, `${JSON.stringify({
      note: 'Reach debt of tests/browser/iphone.cjs per engine/phone/workspace: off-edge, covered and '
        + 'tiny controls. It only shrinks: a lower count is written with --record, a higher one fails.',
      debt: sorted,
      reasons: kept,
    }, null, 2)}\n`);
    console.log(`recorded ${Object.keys(recorded).length} entries in ${path.relative(process.cwd(), BASELINE_FILE)}`);
  }
  process.exit(failed ? 1 : 0);
})();
