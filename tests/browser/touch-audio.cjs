#!/usr/bin/env node
// suite-pace: shared (that a touch unlocks the context; no level or timing judged)
// A phone sounds (owner report 2026-11-02: "on the phone it makes no sound").
//
// Browsers let a page start audio only inside a user activation, and for a touch the HTML
// standard grants it at the end of the touch (pointerup, touchend, click), not at pointerdown.
// Every other suite launches Chromium with --autoplay-policy=no-user-gesture-required, which
// switches that rule off, so none of them could see a page that resumed its AudioContext only
// on pointerdown. This suite keeps the rule on.
//
// Checks (dist/index.html from file://, a 390x844 touch viewport):
// - tap-unlocks-audio: one tap on the page leaves the engine's AudioContext running;
// - audio-session-playback: where the browser has navigator.audioSession (Safari 17+), the page
//   sets its type to 'playback', so iOS does not mute an instrument at the ringer switch. The
//   API is stood in by an init script here, so every engine judges the page, not the browser.
//
// Every wait is a condition poll with a named wall-clock deadline (tests/browser/lib/wait.cjs).
//
//   node tests/browser/touch-audio.cjs [--browsers chromium,firefox,webkit]   (or OSC_BROWSERS)

const path = require('node:path');
const { pathToFileURL } = require('node:url');
const suite = require('./lib/suite.cjs');
const { until, WaitTimeout } = require('./lib/wait.cjs');

const args = process.argv.slice(2);
const arg = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : def;
};
const RUN = suite.open({ name: 'touch-audio', browsers: arg('browsers') });
const playwright = RUN.playwright;
const BROWSERS = RUN.browsers;
const URL = pathToFileURL(path.resolve(__dirname, '../../dist/index.html')).href;
const PHONE = { width: 390, height: 844 };
const SETTLE_MS = 8000;
// Chromium keeps its user-gesture rule (its default for a page without media engagement);
// the other engines run as they ship.
const LAUNCH = { chromium: { args: ['--autoplay-policy=user-gesture-required'] } };

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

async function runOne(name) {
  const browser = await playwright[name].launch(LAUNCH[name] || {});
  const failures = [];
  let checks = 0;
  const check = (id, ok, detail) => {
    checks += 1;
    RUN.tally(name);
    if (!ok) failures.push(`${id}: ${detail}`);
  };
  try {
    // Firefox has no mobile emulation (Playwright refuses isMobile there): a touch viewport.
    const context = await browser.newContext({ viewport: PHONE, hasTouch: true,
      ...(name === 'firefox' ? {} : { isMobile: true }) });
    // A stand-in for Safari's navigator.audioSession, before any script of the page runs.
    await context.addInitScript(() => {
      if (!('audioSession' in navigator)) {
        Object.defineProperty(navigator, 'audioSession', { value: { type: 'auto' } });
      }
    });
    const page = await context.newPage();
    await page.goto(URL);
    await page.waitForFunction(() => window.OSCILLA && window.OSCILLA.app, null,
      { timeout: 15000 });

    const session = await pollFor(() => page.evaluate(() => navigator.audioSession.type),
      (t) => t === 'playback', 'touch-audio: the page asks for a playback audio session');
    check('audio-session-playback', session.ok, `navigator.audioSession.type is ${session.last}`);

    // One tap on a part of the page that starts nothing: only the unlock acts on it (the page
    // header's workspace name; the Pro shell, F002, replaced .osc-header).
    await page.tap('[data-osc="page.title"]');
    const state = await pollFor(() => page.evaluate(() => {
      const ctx = window.OSCILLA.engine.ctx;
      return ctx ? ctx.state : 'none';
    }), (s) => s === 'running', 'touch-audio: a tap leaves the AudioContext running');
    check('tap-unlocks-audio', state.ok, `the AudioContext is ${state.last} after one tap`);
    await context.close();
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
    failed += failures.length;
    console.log(`${failures.length ? 'FAIL' : 'PASS'} ${b}/touch-audio: `
      + `${checks - failures.length}/${checks} checks (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
    for (const f of failures) console.log(`   x ${f}`);
  }
  process.exit(failed ? 1 : 0);
})();
