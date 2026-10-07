#!/usr/bin/env node
// OSCILLA V3.1 Studio transport in real browsers (spec §93-§104, §180-§185, §211-§213, §257):
// src/js/studio/transport.js playing the Basic Synth template on the real AudioEngine in
// chromium, firefox and webkit, from file://.
//
//   node tests/browser/v31-studio-transport.cjs [--browsers chromium,firefox,webkit] [--json out]
//                                               [--stall-ms <ms>]
//
// --stall-ms (diagnostic, never in the gate) stalls the main thread for <ms> right after
// runtime.start() inside PLAY, which re-anchors the PLAY on demand (≈ 45 ms and more on a fresh
// context at 48 kHz); every check below must still hold.
//
// The fixture (tests/browser/fixtures/v31-studio-transport-entry.js, which reuses the Studio
// audio fixture's instrumentation and output tap) is bundled with esbuild into an IIFE inlined
// into ONE classic <script> of a single HTML file, the constraints of dist/index.html.
//
// Checks per browser (asserted):
//   clips on the audio clock, measured on the Studio's output at engine.master (before the
//        engine's limiter): no clip skipped as late (the first window of a PLAY on a fresh
//        context, timeline-compiler.js); nothing before the graph starts; between a re-anchored
//        graph start and baseTime nothing above the free-running carrier's floor (an
//        unclaimed carrier would sound there); the Tone's onset in the window the start ramps
//        predict (fixture predictedOnset); the Tone → Sweep boundary dips at
//        baseTime + 1 s (within BOUNDARY_S); the Sweep ends at baseTime + 3 s (within END_S);
//   the engine's limiter: what reaches the destination is the same boundary and end, delayed
//        by LIMITER_LOOKAHEAD_S; it is silent after the timeline (< −50 dB);
//   pattern-played oscillator: inside the sweep (clip time 1.0 s, 440 Hz) the free-running
//        220 Hz carrier is absent (< −30 dB relative to 440 Hz);
//   cutoff automation changes the spectrum: the 8th harmonic of the 220 Hz Tone, relative to
//        the fundamental, at 0.15 s and 0.85 s equals the browser's own biquad response at the
//        predicted cutoff (500·16^(t/3) automation × 2^sin(π(t + lead)) LFO, lead = 0 unless
//        re-anchored) within SPECTRUM_TOL_DB, and rises by more than 6 dB between the two (less
//        the LFO's share, 0 when lead = 0);
//   exclusivity: onClaimOutput fired once per PLAY;
//   STOP: 0 engine nodes/sources, 0 runtime nodes, 0 live sources, 0 live connections; three
//        PLAY → STOP cycles have the same peak counts (no growth);
//   no console error or page error.
// Runs in `npm run test:studio` (release-gate and the CI studio job).
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const esbuild = require('esbuild');
const suite = require('./lib/suite.cjs');

const argv = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};
const RUN = suite.open({ name: 'v31-studio-transport', browsers: arg('browsers') });
const playwright = RUN.playwright;
const BROWSERS = RUN.browsers;
const JSON_OUT = arg('json', '');
const STALL_MS = Number(arg('stall-ms', '0'));
const ENTRY = path.join(__dirname, 'fixtures', 'v31-studio-transport-entry.js');

// Timing semantics (§212, docs/v31/timeline.md "Clip start"): a clip starts at the frame where
// its voice envelope leaves GAIN_FLOOR — baseTime + position, as the V2 sequencer's block start
// is the voice's t0. The detector (fixture: 2 ms RMS windows, −40 dB of the Tone's level) sees
// that frame through what follows the voice, so each expectation is derived, not widened:
//   onset     PLAY from a stopped runtime starts the whole graph at baseTime: four 0 → 1 route
//             ramps (STUDIO_XFADE_S), the ADSR attack and the voice edge (EDGE_S) multiply, so
//             the level rises like t^6 and first exceeds −40 dB 6 ms after baseTime at 48 kHz
//             (the fixture computes the window from those constants: predicted.onset). Measured:
//             6.0 ms (2 ms windows), first sample above −40 dB 6.5 ms, first non-zero sample
//             2.75 ms, in all three browsers. Allowed: one detector window around the prediction
//             (a 2 ms window holds under half a period of the 220 Hz sawtooth).
//   boundary  the Tone's release edge and the Sweep's attack edge meet at the floor on the
//             boundary frame (EDGE_S each side), so the quietest window starts there: in 2 ms
//             windows within BOUNDARY_S (the two windows either side of the frame are equally
//             quiet in theory), in 0.5 ms windows on a grid from baseTime exactly the window
//             [1.0000, 1.0005) (the low-pass delays the minimum by its group delay, well under
//             half a window). A voice one render quantum late (2.67 ms) misses it by 5 windows.
//   end       the last window above −40 dB ends with the Sweep's release edge, on the clip end
//             frame: 3.0000 s in 2 ms and in 0.5 ms windows.
// All five values were measured identically in chromium, firefox and webkit.
// A re-anchored PLAY (docs/v31/timeline.md: the clock reached baseTime before the first window,
// a main thread or a fresh context slower than the scheduling lead; seen on CI and in a loaded
// linux container) starts the graph at the old baseTime and the clips at the new one: the
// fixture measures "before" from that graph start, bounds what sounds between the two at the
// carrier floor, and predicts the onset with the graph's ramps and envelope `lead` seconds in.
// Without the re-anchor the graph start is baseTime and the checks are the plain ones.
// The engine's limiter (DynamicsCompressorNode) delays the destination by its look-ahead: 6 ms in
// Blink, Gecko and WebKit (measured 288 frames at 48 kHz in each), which is why the analyser tap
// read the onset at 14 ms and the boundary at 1.006 s. Firefox's limiter also lags the first
// few ms after silence (analyser onset 16 ms), so the onset is asserted on the Studio side only.
const ONSET_WINDOWS = 1;
const BOUNDARY_S = 0.004;
const END_S = 0.004;
const LIMITER_LOOKAHEAD_S = 0.006;
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
  RUN.tally(key);
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

    const s = (rec.basicSynth = await page.evaluate((stallMs) => window.T.basicSynth({ stallMs }),
      STALL_MS));
    const st = s.studio;
    const p = s.predicted;
    check(key, 'no clip skipped as late (PLAY on a fresh context)', s.skippedLate === 0,
      `${s.skippedLate}`);
    const re = s.reanchor;
    const startedAt = re ? `graph started ${f((s.b - s.graphStart) * 1000, 2)} ms before `
      + `baseTime (re-anchored from ${f(re.from, 5)} s to ${f(re.to, 5)} s at ${f(re.at, 5)} s)`
      : 'graph started at baseTime';
    if (re) console.log(`  INFO [${key}] PLAY re-anchored: ${startedAt}`);
    check(key, 'nothing sounds before the graph starts (< −100 dB)', st.beforeDb < -100,
      `${f(st.beforeDb, 1)} dB; ${startedAt}`);
    check(key, 'between the graph start and baseTime only the carrier floor sounds '
      + `(< ${f(s.floorBoundDb, 0)} dB)`, st.floorDb === null || st.floorDb < s.floorBoundDb,
      st.floorDb === null ? startedAt : `${f(st.floorDb, 1)} dB; ${startedAt}`);
    check(key, 'the Tone clip sounds from baseTime (onset where the start ramps put it)',
      st.onset !== null && p.onset !== null
      && Math.abs(st.onset - p.onset) <= ONSET_WINDOWS * s.detectStepS + 1e-9,
      `onset ${f(st.onset, 4)} s after baseTime, predicted ${f(p.onset, 4)} s (${p.ramps} route `
      + `ramps × ADSR attack × voice edge, ${f(p.lead * 1000, 2)} ms into the graph)`);
    check(key, 'the Tone → Sweep boundary is at baseTime + 1 s',
      Math.abs(st.dip - 1) < BOUNDARY_S, `dip at ${f(st.dip, 4)} s (${f(st.dipDb, 1)} dB)`);
    check(key, 'the boundary frame is the quietest 0.5 ms window (exact to the window)',
      Math.abs(st.fineDip - 1) < s.fineStepS / 2,
      `quietest window starts at ${f(st.fineDip, 5)} s`);
    check(key, 'the Sweep clip ends at baseTime + 3 s', st.end !== null
      && Math.abs(st.end - 3) < END_S, `end ${f(st.end, 4)} s`);
    check(key, 'the Sweep release ends on the clip end frame (exact to the 0.5 ms window)',
      st.fineEnd !== null && Math.abs(st.fineEnd - 3) < s.fineStepS / 2,
      `last window above −40 dB ends at ${f(st.fineEnd, 5)} s`);
    const o = s.out;
    // Compared on the fine grid: a 2 ms detection window is 88.2 frames at 44.1 kHz, and a gap
    // straddling two windows can put the minimum one window late; 6 ms is 264.6 frames there,
    // so the fine (0.5 ms) positions agree within one fine step.
    check(key, 'limiter look-ahead: the destination has the same boundary, 6 ms later',
      Math.abs(o.fineDip - st.fineDip - LIMITER_LOOKAHEAD_S) <= s.fineStepS + 1e-9,
      `fine dip at ${f(o.fineDip, 5)} s vs ${f(st.fineDip, 5)} s pre-limiter `
        + `(${f(o.dipDb, 1)} dB), onset ${f(o.onset, 4)} s`);
    check(key, 'limiter look-ahead: the destination has the same end, 6 ms later',
      o.fineEnd !== null && st.fineEnd !== null
        && Math.abs(o.fineEnd - st.fineEnd - LIMITER_LOOKAHEAD_S) <= s.fineStepS + 1e-9,
      `fine end ${f(o.fineEnd, 5)} s vs ${f(st.fineEnd, 5)} s pre-limiter`);
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
      sp.late - sp.early - sp.lfoShare > 6, `${f(sp.late - sp.early - sp.lfoShare, 2)} dB`
        + (sp.lfoShare ? ` from the automation (measured ${f(sp.late - sp.early, 2)} dB, the `
        + `LFO's share ${f(sp.lfoShare, 2)} dB after the re-anchor)` : ''));
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
    // A starved PLAY with an LFO on the oscillator's level (review D1 of #140): the LFO's edge
    // must not sound the carrier before the claim. The stall re-anchors in chromium and webkit;
    // Firefox's clock stands still within the task, so there is no gap to measure there.
    const lv = (rec.starvedLevelLfo = await page.evaluate(() => window.T.starvedLevelLfo(
      { stallMs: 100 })));
    const lvAt = lv.reanchor ? `re-anchored from ${f(lv.reanchor.from, 5)} s to `
      + `${f(lv.reanchor.to, 5)} s` : 'not re-anchored';
    check(key, 'LFO on the level, starved PLAY: nothing before the graph starts (< −100 dB)',
      lv.beforeDb < -100, `${f(lv.beforeDb, 1)} dB; ${lvAt}`);
    if (lv.reanchor) {
      check(key, 'LFO on the level, starved PLAY: only the carrier floor before baseTime '
        + `(< ${f(lv.floorBoundDb, 0)} dB)`, lv.floorDb !== null && lv.floorDb < lv.floorBoundDb,
      `${f(lv.floorDb, 1)} dB; ${lvAt}`);
    } else {
      console.log(`  INFO [${key}] LFO on the level, starved PLAY: ${lvAt} (no gap to measure)`);
    }
    check(key, 'LFO on the level, starved PLAY: 0 nodes, sources, connections after STOP',
      zero(lv.stopped), JSON.stringify(lv.stopped));
    check(key, 'no console errors', errors.length === 0, errors.join(' | '));
  } catch (err) {
    check(key, 'run completed', false, err && err.stack);
  } finally {
    rec.errors = errors;
    await browser.close();
  }
}

(async () => {
  await RUN.ready();
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
