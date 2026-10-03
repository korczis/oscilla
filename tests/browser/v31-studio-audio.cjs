#!/usr/bin/env node
// OSCILLA V3.1 Studio graph compiler and incremental runtime in real browsers (spec §209, §210,
// §213, §45; plan issues V414, V415): src/js/studio/{compiler,runtime}.js on the real
// AudioEngine in chromium, firefox and webkit, from file://.
//
//   node tests/browser/v31-studio-audio.cjs [--browsers chromium,firefox,webkit] [--json out]
//
// The fixture (tests/browser/fixtures/v31-studio-audio-entry.js) is bundled with esbuild into an
// IIFE inlined into ONE classic <script> of a single HTML file, the constraints of
// dist/index.html. window.T runs the routines; this runner asserts.
//
// Checks per browser (asserted):
//   §209 OSC (sawtooth 220 Hz) → GAIN → FILTER (low-pass 1 kHz, Q √½) → MASTER: the 20th
//        harmonic (4.4 kHz) relative to the fundamental equals the browser's own biquad
//        response within FILTER_TOL_DB; after removing the filter (and routing GAIN → MASTER)
//        it equals the sawtooth's own ratio (≈ −26 dB) and rises by > 15 dB; every node of the
//        removed filter is disconnected and untracked; the engine node count returns to
//        "with filter − filter stage − 2 edge gains + 1 edge gain"; after stop 0 nodes.
//   §210 LFO (sine, 1 Hz) → filter cutoff, depth 800 Hz bipolar, on a 1 kHz sine: the output
//        level envelope (20 ms RMS windows) spans the levels predicted by the browser's biquad
//        response at cutoff 200 Hz and 1800 Hz within MOD_TOL_DB; depth 400 Hz → 600/1400 Hz;
//        a muted edge → the level at 1 kHz, steady within 0.5 dB.
//   §213 20 graph edits during playback (node add/remove, reconnect, structural replace, param
//        and edge changes), stop: 0 engine nodes/sources, 0 runtime nodes, 0 live sources and
//        0 live connections (independent instrumentation), and the same peak counts in each of
//        3 cycles (no growth).
//   §45  click ratio (largest one-sample step / largest slope of the playing 110 Hz sine, the
//        engine tests' measure) < CLICK_MAX (median of 3) for reconnect, reconnect through a
//        filter, filter insertion, waveform replacement, mute and stop.
//   no console error or page error.
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
const BROWSERS = arg('browsers', process.env.OSC_BROWSERS || 'chromium,firefox,webkit').split(',');
const JSON_OUT = arg('json', '');
const ENTRY = path.join(__dirname, 'fixtures', 'v31-studio-audio-entry.js');

// Harmonic-ratio tolerance, dB: Goertzel with a Hann window over 0.4 s (88 periods of 220 Hz,
// 1760 of 4.4 kHz) leaks < 0.01 dB from the neighbouring harmonics 220 Hz away; the reference
// is the same browser's getFrequencyResponse() for the same biquad settings. 1 dB leaves room
// for the band-limited sawtooth tables, which differ between engines.
const FILTER_TOL_DB = 1;
// Envelope tolerance, dB: a 20 ms window at 1 Hz LFO sees the cutoff move by ≤ 0.2 % of the
// depth around an extreme (cos ≈ 1 − (2π·0.01)²/2), < 0.05 dB here; the setTargetAtTime glide
// of the base (τ 10-15 ms) is settled 0.1 s after the change. 1 dB covers the windowing of a
// level that changes within the window away from the extremes.
const MOD_TOL_DB = 1;
const CLICK_MAX = 3;

const LAUNCH = {
  chromium: { args: ['--autoplay-policy=no-user-gesture-required'] },
  firefox: { firefoxUserPrefs: { 'media.autoplay.default': 0,
    'media.autoplay.block-webaudio': false } },
  webkit: {},
};

const HTML = (js) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>OSCILLA V3.1 Studio audio fixture</title>
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
const f = (x, d = 2) => (x == null || Number.isNaN(x) ? 'null' : Number(x).toFixed(d));
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

    // §209
    const g = (rec.audioGraph = await page.evaluate(() => window.T.audioGraph()));
    check(key, '§209 tap recorded both windows completely', g.complete);
    check(key, '§209 filtered harmonic ratio = browser biquad response',
      Math.abs((g.withFilterDb - g.withoutFilterDb) - g.expectedFilterDb) < FILTER_TOL_DB,
      `with ${f(g.withFilterDb)} dB, without ${f(g.withoutFilterDb)} dB, filter change `
      + `${f(g.withFilterDb - g.withoutFilterDb)} dB, expected ${f(g.expectedFilterDb)} dB`);
    check(key, '§209 removing the filter changes the output (> 15 dB at 4.4 kHz)',
      g.withoutFilterDb - g.withFilterDb > 15, `${f(g.withoutFilterDb - g.withFilterDb)} dB`);
    check(key, '§209 unfiltered sawtooth ratio ≈ 1/20 (−26 dB)',
      Math.abs(g.withoutFilterDb + 26.02) < FILTER_TOL_DB, `${f(g.withoutFilterDb)} dB`);
    check(key, '§209 patch ops: node-remove, edge-add, 2 × edge-remove',
      JSON.stringify(g.ops.map((o) => o.op)) === JSON.stringify(['node-remove', 'edge-add',
        'edge-remove', 'edge-remove']), JSON.stringify(g.ops));
    check(key, '§209 removed filter nodes released (disconnected, untracked)',
      g.filterNodeCount === 8 && g.filterNodesConnected === 0 && g.filterNodesTracked === 0,
      JSON.stringify({ n: g.filterNodeCount, connected: g.filterNodesConnected,
        tracked: g.filterNodesTracked }));
    const expectNodes = g.counts.withFilter.engineNodes - g.filterNodeCount - 2 + 1;
    check(key, '§209 node count returns (− filter stage − 2 routes + 1 route)',
      g.counts.afterRemove.engineNodes === expectNodes
      && g.counts.afterRemove.runtimeNodes === expectNodes,
      `${g.counts.withFilter.engineNodes} → ${g.counts.afterRemove.engineNodes} (expected `
      + `${expectNodes})`);
    check(key, '§209 stop: 0 nodes, sources, connections', zero(g.counts.stopped),
      JSON.stringify(g.counts.stopped));

    // §210
    const m = (rec.modulation = await page.evaluate(() => window.T.modulation()));
    const near = (a, b, tol) => Math.abs(a - b) < tol;
    check(key, '§210 depth 800 Hz: level envelope spans |H| at 200 Hz and 1800 Hz',
      near(m.deep.max, m.expected.deep.max, MOD_TOL_DB)
      && near(m.deep.min, m.expected.deep.min, MOD_TOL_DB),
      `max ${f(m.deep.max)} / ${f(m.expected.deep.max)} dB, min ${f(m.deep.min)} / `
      + `${f(m.expected.deep.min)} dB`);
    check(key, '§210 depth 400 Hz: envelope spans |H| at 600 Hz and 1400 Hz',
      near(m.shallow.max, m.expected.shallow.max, MOD_TOL_DB)
      && near(m.shallow.min, m.expected.shallow.min, MOD_TOL_DB),
      `max ${f(m.shallow.max)} / ${f(m.expected.shallow.max)} dB, min ${f(m.shallow.min)} / `
      + `${f(m.expected.shallow.min)} dB`);
    check(key, '§210 muted edge: steady level at the base cutoff',
      m.muted.max - m.muted.min < 0.5 && near(m.muted.max, m.expected.muted, MOD_TOL_DB),
      `${f(m.muted.min)}..${f(m.muted.max)} dB, expected ${f(m.expected.muted)} dB`);
    check(key, '§210 edge changes are edge-props patches',
      m.ops.every((o) => o.length === 1 && o[0].op === 'edge-props'), JSON.stringify(m.ops));
    check(key, '§210 stop: 0 nodes, sources, connections', zero(m.stopped),
      JSON.stringify(m.stopped));

    // §213
    const l = (rec.leak = await page.evaluate(() => window.T.leak(3)));
    check(key, '§213 20 edits applied during playback in each cycle',
      l.applied.every((n) => n === 20), JSON.stringify(l.applied));
    l.cycles.forEach((c, i) => {
      check(key, `§213 cycle ${i + 1}: 0 engine/runtime nodes, 0 live sources, 0 connections`,
        zero(c.after), JSON.stringify(c.after));
    });
    const peaks = l.cycles.map((c) => [c.peak.engineNodes, c.peak.engineSources]);
    check(key, '§213 no growth over repeated cycles (same peak counts)',
      peaks.every((p) => p[0] === peaks[0][0] && p[1] === peaks[0][1]), JSON.stringify(peaks));

    // §45 clicks
    const k = (rec.clicks = await page.evaluate(() => window.T.clicks()));
    for (const name of ['reconnect', 'reconnectThroughFilter', 'insertFilter',
      'waveformReplace', 'mute', 'stop']) {
      const r = k[name];
      check(key, `§45 click ratio < ${CLICK_MAX} (median of 3): ${name}`,
        r.n > 5000 && r.ratio < CLICK_MAX, JSON.stringify(r));
    }
    check(key, 'clicks: 0 nodes, sources, connections afterwards', zero(k.final),
      JSON.stringify(k.final));

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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oscilla-v31-studio-'));
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
