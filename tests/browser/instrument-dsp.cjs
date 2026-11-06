#!/usr/bin/env node
// K060: the Keys node's pitch CV, measured from real renders (Chromium, Firefox and WebKit).
//
//   node tests/browser/instrument-dsp.cjs [--browsers chromium,firefox,webkit] [--json out.json]
//   OSC_BROWSERS=webkit node tests/browser/instrument-dsp.cjs     # the same, from the environment
//
// Bundles tests/browser/fixtures/instrument-dsp-entry.js in memory with esbuild into a blank
// page (nothing is written to disk). The fixture builds Keys -> VCO (sine) -> Master Output
// through the one Studio store, runs the real Studio runtime and adapters on an
// OfflineAudioContext at 44.1 kHz and at 48 kHz, plays notes through studio/live-notes.js and
// measures each frequency from the rising zero crossings of the render (many periods per note).
//
// Checks, per browser and per rate (each rate read back from the rendered buffer):
//   k-track    A2, A4 and A6 (8') each within 1 cent of 440 x 2^((note - 69) / 12) Hz
//   k-a4a5     A4 at 440 Hz and A5 at 880 Hz within 0.1 cent
//   k-clamp    at VCO scale 4' every note 0-127 is measured: each note whose frequency lies
//              below the clamp within 0.1 cent of it (note 0 among them), and note 127 at the
//              clamp, the highest pitch-clip point at or below 0.95 x Nyquist, within 0.1 cent;
//              the runtime debugInfo states the clamp at that rate
//   k-glide    a legato glide of 100 ms from A3 to A4: the Keys CV comes within 1 cent of A4 at
//              100 ms +- one render quantum (128 frames at the rate) and not before, is halfway
//              at 50 ms (linear), and the VCO plays A4 within 1 cent from 100 ms + one quantum.
//              Fails on e51b169d, whose glide was an exponential approach (time constant 33 ms)
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const esbuild = require('esbuild');
const suite = require('./lib/suite.cjs');
const { until, bounded } = require('./lib/wait.cjs');

const argv = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};
const RUN = suite.open({ name: 'instrument-dsp', browsers: arg('browsers') });
const playwright = RUN.playwright;
const JSON_OUT = arg('json', '');
const LOAD_MS = 60000;
const CHECK_MS = 240000; // the 4' sweep renders some 22 s of audio at each rate
const LAUNCH = {
  chromium: { args: ['--autoplay-policy=no-user-gesture-required'] },
  firefox: { firefoxUserPrefs: { 'media.autoplay.default': 0,
    'media.autoplay.block-webaudio': false } },
  webkit: {},
};

const JS = esbuild.buildSync({ entryPoints: [path.join(__dirname, 'fixtures',
  'instrument-dsp-entry.js')], bundle: true, format: 'iife', write: false, target: 'es2020',
logLevel: 'error' }).outputFiles[0].text;
const HTML = '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>OSCILLA '
  + 'instrument DSP fixture</title></head><body><script>'
  + `${JS.replace(/<\/script/gi, '<\\/script')}</script></body></html>`;

let failures = 0;
const report = [];
function check(leg, name, ok, detail) {
  RUN.tally(leg);
  const line = `${ok ? 'PASS' : 'FAIL'} [${leg}] ${name}${detail ? ` — ${detail}` : ''}`;
  report.push({ leg, name, ok, detail });
  console.log(line);
  if (!ok) failures++;
}
const f = (x, d = 3) => (x == null ? 'null' : Number(x).toFixed(d));
const within = (c, tol) => c !== null && Math.abs(c) <= tol;

async function runBrowser(name) {
  const browser = await playwright[name].launch(LAUNCH[name]);
  const leg = `${name} ${browser.version()}`;
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.setContent(HTML);
    await until(() => page.evaluate(() => !!window.K), { ms: LOAD_MS,
      what: 'the instrument DSP fixture loads' });
    const rates = await page.evaluate(() => window.K.RATES);
    const call = (fn, opts, what) => bounded(page.evaluate(([n, o]) => window.K[n](o),
      [fn, opts]), { ms: CHECK_MS, what });
    for (const rate of rates) {
      // k-track: three notes two octaves apart at 8'.
      const tr = await call('track', { notes: [45, 69, 93], sampleRate: rate },
        `k-track renders at ${rate} Hz`);
      const at = `${leg} @ ${tr.sampleRate} Hz`;
      check(at, 'k-track A2, A4, A6 within 1 cent', tr.rows.every((r) => within(r.cents, 1)),
        tr.rows.map((r) => `${r.note}: ${f(r.hz, 4)} Hz (${f(r.cents)} ct, ${r.periods} periods)`)
          .join('; '));
      // k-a4a5: A4 and A5 within 0.1 cent.
      const a = await call('track', { notes: [69, 81], sampleRate: rate, periods: 200 },
        `k-a4a5 renders at ${rate} Hz`);
      check(at, 'k-a4a5 A4 440 Hz and A5 880 Hz within 0.1 cent',
        a.rows.every((r) => within(r.cents, 0.1)) && a.rows[0].expected === 440
          && a.rows[1].expected === 880,
        a.rows.map((r) => `${f(r.hz, 5)} Hz (${f(r.cents, 4)} ct)`).join('; '));
      // k-clamp: every note at 4', note 127 at the clamp.
      const notes = Array.from({ length: 128 }, (_, i) => i);
      const c = await call('track', { notes, scale: '4', sampleRate: rate, periods: 20,
        minS: 0.05 }, `k-clamp renders at ${rate} Hz`);
      const below = c.rows.filter((r) => r.exact < c.clampHz);
      const worst = below.reduce((w, r) => (Math.abs(r.cents ?? 1e9) > Math.abs(w.cents ?? 0)
        ? r : w), below[0]);
      const top = c.rows[127];
      check(at, "k-clamp every note below the clamp exact at 4' (0.1 cent)",
        below.length > 100 && below.every((r) => within(r.cents, 0.1)) && below[0].note === 0,
        `${below.length} notes below the clamp, worst ${worst.note}: ${f(worst.cents, 4)} ct`);
      check(at, "k-clamp note 127 at 4' held at the clamp, at or below 0.95 x Nyquist",
        top.exact > c.clampHz && within(top.cents, 0.1) && c.clampHz <= c.nyquist95
          && c.clampHz > c.nyquist95 * 2 ** (-1 / 200),
        `${f(top.hz, 2)} Hz (${f(top.cents, 4)} ct from the clamp ${f(c.clampHz, 2)} Hz; 0.95 x `
          + `Nyquist ${f(c.nyquist95, 1)} Hz; asked ${f(top.exact, 1)} Hz)`);
      check(at, 'k-clamp no note refused in 0-127', c.refused.length === 0,
        c.refused.slice(0, 2).join(' | '));
      check(at, 'k-clamp the runtime debugInfo states the clamp at this rate',
        typeof c.stated === 'string' && c.stated.includes('0.95 × Nyquist')
          && c.stated.includes(`(${Math.round(c.nyquist95)} Hz here)`), c.stated);
      // k-glide: linear in exact time.
      const g = await call('glide', { sampleRate: rate }, `k-glide renders at ${rate} Hz`);
      check(at, 'k-glide the CV arrives within 1 cent at 100 ms +- one quantum',
        g.arriveLateS !== null && Math.abs(g.arriveLateS) <= g.quantumS
          && within(g.centsAtGlide, 1) && within(g.centsAtGlidePlusQuantum, 1),
        `arrives ${f(g.arriveLateS * 1000, 3)} ms from 100 ms (quantum ${f(g.quantumS * 1000)} `
          + `ms); at 100 ms ${f(g.centsAtGlide, 3)} ct`);
      check(at, 'k-glide linear: halfway at 50 ms', within(g.centsAtHalfFromMidpoint, 1),
        `${f(g.centsAtHalfFromMidpoint, 3)} ct from the midpoint`);
      check(at, 'k-glide the VCO plays A4 within 1 cent after the glide',
        within(g.centsAfter, 1) && within(g.centsBefore, 1),
        `${f(g.hzAfter, 4)} Hz (${f(g.centsAfter, 4)} ct); A3 before ${f(g.centsBefore, 4)} ct`);
    }
    check(leg, 'no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  } finally {
    await browser.close();
  }
}

(async () => {
  await RUN.ready();
  for (const name of RUN.browsers) {
    try {
      await runBrowser(name);
    } catch (e) {
      check(name, 'the suite runs', false, String(e.message || e).split('\n')[0]);
    }
  }
  if (JSON_OUT) fs.writeFileSync(JSON_OUT, JSON.stringify(report, null, 2));
  console.log(failures ? `${failures} FAILED` : 'ALL PASS');
  process.exit(failures ? 1 : 0);
})();
