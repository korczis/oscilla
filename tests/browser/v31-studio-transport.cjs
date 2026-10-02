#!/usr/bin/env node
// OSCILLA V3.1 Studio transport in real browsers (spec §93-§104, §180-§185, §211-§213, §257):
// src/js/studio/transport.js playing the Basic Synth template on the real AudioEngine in
// chromium, firefox and webkit, from file://.
//
//   node tests/browser/v31-studio-transport.cjs [--browsers chromium,firefox,webkit] [--json out]
//
// The fixture (tests/browser/fixtures/v31-studio-transport-entry.js, which reuses the Studio
// audio fixture's instrumentation and output tap) is bundled with esbuild into an IIFE inlined
// into ONE classic <script> of a single HTML file, the constraints of dist/index.html.
//
// Checks per browser (asserted):
//   clips on the audio clock: the Tone clip is audible from baseTime (onset within ONSET_S),
//        the Tone → Sweep boundary dips at baseTime + 1 s (within BOUNDARY_S), the Sweep ends at
//        baseTime + 3 s (within ONSET_S) and the output is silent after it (< −50 dB);
//   pattern-played oscillator: inside the sweep (clip time 1.0 s, 440 Hz) the free-running
//        220 Hz carrier is absent (< −30 dB relative to 440 Hz);
//   cutoff automation changes the spectrum: the 8th harmonic of the 220 Hz Tone, relative to
//        the fundamental, at 0.15 s and 0.85 s equals the browser's own biquad response at the
//        predicted cutoff (500·16^(t/3) automation × 2^sin(πt) LFO) within SPECTRUM_TOL_DB, and
//        rises by more than 6 dB between the two;
//   exclusivity: onClaimOutput fired once per PLAY;
//   STOP: 0 engine nodes/sources, 0 runtime nodes, 0 live sources, 0 live connections; three
//        PLAY → STOP cycles have the same peak counts (no growth);
//   no console error or page error.
// Not part of `npm run test:browser` yet (package.json is out of this change's scope).
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const esbuild = require('esbuild');
const playwright = require('playwright');

const argv = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};
const BROWSERS = arg('browsers', 'chromium,firefox,webkit').split(',');
const JSON_OUT = arg('json', '');
const ENTRY = path.join(__dirname, 'fixtures', 'v31-studio-transport-entry.js');

// Onset / end: 2 ms RMS windows against −40 dB of the Tone's level; the voice edges are 3 ms
// (sequencer EDGE_S) and the graph's route fade-in 20 ms, so the first window above −40 dB lies
// within a few ms of the clip start. 10 ms bounds both plus one window.
const ONSET_S = 0.01;
// The block boundary sits at the envelope floor for one edge (3 ms each side).
const BOUNDARY_S = 0.004;
// The cutoff moves within the 50 ms analysis window (automation ±2.4 %, LFO ≤ ±5 % around
// these phases); 2 dB covers the window average against the instantaneous prediction.
const SPECTRUM_TOL_DB = 2;

const LAUNCH = {
  chromium: { args: ['--autoplay-policy=no-user-gesture-required'] },
  firefox: { firefoxUserPrefs: { 'media.autoplay.default': 0,
    'media.autoplay.block-webaudio': false } },
  webkit: {},
};

const HTML = (js) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>OSCILLA V3.1 Studio transport fixture</title>
</head><body><button id="start" type="button">start</button>
<script>${js.replace(/<\/script/gi, '<\\/script')}</script>
<script>document.getElementById('start').addEventListener('click', () => {
  window.T.started = window.T.start(); });</script>
</body></html>`;

let failures = 0;
let passes = 0;
const report = { meta: { date: new Date().toISOString(), node: process.version }, runs: {} };
function check(key, name, ok, detail = '') {
  if (ok) passes += 1; else failures += 1;
  console.log(`  ${ok ? 'PASS' : 'FAIL'} [${key}] ${name}${detail ? ` — ${detail}` : ''}`);
  return ok;
}
const f = (x, d = 3) => (x == null || Number.isNaN(x) ? 'null' : Number(x).toFixed(d));
const zero = (c) => c.engineNodes === 0 && c.engineSources === 0 && c.runtimeNodes === 0
  && c.liveSources === 0 && c.connections === 0;

async function runOne(browserName, url) {
  const key = browserName;
  const rec = (report.runs[key] = {});
  const browser = await playwright[browserName].launch(LAUNCH[browserName]);
  rec.version = browser.version();
  const context = await browser.newContext();
  const page = await context.newPage();
  page.setDefaultTimeout(120000);
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
  console.log(`\n${key} (${rec.version})`);
  try {
    await page.goto(url, { waitUntil: 'load' });
    await page.click('#start'); // a user gesture for the autoplay policy (WebKit)
    rec.start = await page.evaluate(() => window.T.started);
    check(key, 'AudioContext running', rec.start.state === 'running', JSON.stringify(rec.start));

    const s = (rec.basicSynth = await page.evaluate(() => window.T.basicSynth()));
    check(key, 'the Tone clip sounds from baseTime', s.onset !== null
      && s.onset >= -0.002 && s.onset < ONSET_S, `onset ${f(s.onset, 4)} s after baseTime`);
    check(key, 'the Tone → Sweep boundary is at baseTime + 1 s',
      Math.abs(s.dip - 1) < BOUNDARY_S, `dip at ${f(s.dip, 4)} s (${f(s.dipDb, 1)} dB)`);
    check(key, 'the Sweep clip ends at baseTime + 3 s', s.end !== null
      && Math.abs(s.end - 3) < ONSET_S, `end ${f(s.end, 4)} s`);
    check(key, 'silent after the timeline (< −50 dB)', s.tailDb < -50, `${f(s.tailDb, 1)} dB`);
    check(key, 'pattern-played oscillator: no free-running 220 Hz carrier inside the sweep',
      20 * Math.log10(s.sweepAt.f220 / s.sweepAt.f440) < -30,
      `220 Hz ${f(20 * Math.log10(s.sweepAt.f220 / s.sweepAt.f440), 1)} dB re 440 Hz`);
    const sp = s.spectrum;
    check(key, 'cutoff automation: 8th harmonic at 0.15 s = biquad response at the cutoff',
      Math.abs(sp.early - sp.expectedEarly) < SPECTRUM_TOL_DB,
      `${f(sp.early, 2)} dB, expected ${f(sp.expectedEarly, 2)} dB`);
    check(key, 'cutoff automation: 8th harmonic at 0.85 s = biquad response at the cutoff',
      Math.abs(sp.late - sp.expectedLate) < SPECTRUM_TOL_DB,
      `${f(sp.late, 2)} dB, expected ${f(sp.expectedLate, 2)} dB`);
    check(key, 'cutoff automation changes the spectrum over time (> 6 dB)',
      sp.late - sp.early > 6, `${f(sp.late - sp.early, 2)} dB`);
    check(key, 'exclusivity hook fired once per PLAY', s.claims === 1 + s.cycles.length,
      `${s.claims}`);
    check(key, 'nothing unplayed', s.debug.length === 0, JSON.stringify(s.debug));
    check(key, 'STOP: 0 nodes, sources, connections', zero(s.stopped),
      JSON.stringify(s.stopped));
    s.cycles.forEach((c, i) => {
      check(key, `cycle ${i + 1}: 0 nodes, sources, connections after STOP`, zero(c.after),
        JSON.stringify(c.after));
    });
    const peaks = s.cycles.map((c) => [c.peak.engineNodes, c.peak.engineSources]);
    check(key, 'no growth over PLAY → STOP cycles (same peak counts)',
      peaks.every((p) => p[0] === peaks[0][0] && p[1] === peaks[0][1]), JSON.stringify(peaks));
    check(key, 'no console errors', errors.length === 0, errors.join(' | '));
  } catch (err) {
    check(key, 'run completed', false, err && err.stack);
  } finally {
    rec.errors = errors;
    await browser.close();
  }
}

(async () => {
  const r = await esbuild.build({ entryPoints: [ENTRY], bundle: true, format: 'iife',
    write: false, target: 'es2020', logLevel: 'silent' });
  const html = HTML(r.outputFiles[0].text);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oscilla-v31-transport-'));
  const file = path.join(dir, 'index.html');
  fs.writeFileSync(file, html);
  console.log(`fixture: ${pathToFileURL(file).href} (${(html.length / 1024).toFixed(1)} kB)`);
  try {
    for (const b of BROWSERS) await runOne(b, pathToFileURL(file).href);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  if (JSON_OUT) fs.writeFileSync(JSON_OUT, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`\n${failures ? `${failures} FAILURE(S)` : 'ALL PASS'} (${passes} checks passed)`);
  process.exit(failures ? 1 : 0);
})();
