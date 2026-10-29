#!/usr/bin/env node
// OSCILLA V3.1 Studio offline rendering in real browsers (spec §105, §256; plan issue V427):
// src/js/studio/offline.js renders shipped templates through the Studio runtime on an
// OfflineAudioContext (audio/offline-renderer.js), in chromium, firefox and webkit, from file://.
//
//   node tests/browser/v31-studio-offline.cjs [--browsers chromium,firefox,webkit]
//
// Checks per browser (asserted):
//   Basic Tone, 1 s at 48 kHz, WAV: 48000 frames, 2 channels; the 440 Hz component equals the
//     Master Output level (DEFAULT_GAIN 0.08) × oscillator level 1 within TONE_TOL; no clipping;
//     silence before the runtime's click-free start time; the end fades to < 1e-3.
//   Sweep Sequence: the silence clip (2.0-2.5 s) is > 40 dB below the sweep (pattern clips
//     render through the Sequence node and the existing sequencer).
//   Subtractive Synth renders what the live transport plays, with no limitation: the Tone clip
//     (220 Hz dominant, a non-harmonic 311 Hz probe < −30 dB) then the Sweep (311 Hz dominant
//     at 1.5 s, 440 Hz at 2.0 s, the free-running 220 Hz carrier < −30 dB: pattern-played);
//     Measurement Sweep is refused (live Microphone) with that limitation.
//   K010-K013 voice nodes, each graph rendered at the renderer's own rate (no rate assumed):
//     a 440 Hz LFO on a 1 kHz carrier (log, ±0.1 octave) puts sidebands at fc ± 440 Hz above
//     −40 dB re the carrier and > 20 dB over a 1220 Hz non-sideband probe; Drive at 100 % on a
//     full-scale sawtooth behind a Master Output at its highest level (MAX_OUTPUT_GAIN, the
//     live engine's ceiling) peaks at or below that ceiling with no clipped sample; a Macro at
//     1 opens a 300 Hz low-pass so that the 2.2 kHz harmonic is > 10 dB above the Macro at 0;
//     the filter stage's response probe gives a low-shelf's gain within 0.5 dB (below the
//     corner, and 0 dB above it) and an all-pass flat within 0.1 dB from 20 Hz to 20 kHz.
//   no console error or page error.
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const esbuild = require('esbuild');
const suite = require('./lib/suite.cjs');

const argv = process.argv.slice(2);
const i = argv.indexOf('--browsers');
const RUN = suite.open({ name: 'v31-studio-offline',
  browsers: i >= 0 && argv[i + 1] ? argv[i + 1] : undefined });
const playwright = RUN.playwright;
const BROWSERS = RUN.browsers;
const ENTRY = path.join(__dirname, 'fixtures', 'v31-studio-offline-entry.js');
// Goertzel with a Hann window over 0.6 s (264 periods of 440 Hz) reads a steady sine's amplitude
// to < 0.01 %; 1 % covers the engines' oscillator wavetables.
const TONE_TOL = 0.01;
const MASTER = 0.08;

const HTML = (js) => `<!doctype html><html lang="en"><head><meta charset="utf-8">
<title>OSCILLA V3.1 Studio offline fixture</title></head><body>
<script>${js.replace(/<\/script/gi, '<\\/script')}</script></body></html>`;

let failures = 0;
let passes = 0;
function check(key, name, ok, detail = '') {
  RUN.tally(key);
  if (ok) passes += 1; else failures += 1;
  console.log(`  ${ok ? 'PASS' : 'FAIL'} [${key}] ${name}${detail ? ` — ${detail}` : ''}`);
}

async function runOne(name, url) {
  const browser = await playwright[name].launch();
  const page = await (await browser.newContext()).newPage();
  page.setDefaultTimeout(120000);
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
  console.log(`\n${name} (${browser.version()})`);
  try {
    await page.goto(url, { waitUntil: 'load' });
    const t = await page.evaluate(() => window.T.render('basic-tone', { duration: 1,
      sampleRate: 48000, channels: 2, wav: true, probe: 'tone' }));
    check(name, 'Basic Tone renders 48000 frames, 2 channels, WAV',
      t.ok && t.length === 48000 && t.channels === 2 && t.wavBytes > 48000 * 2 * 2,
      JSON.stringify({ length: t.length, channels: t.channels, wav: t.wavBytes }));
    check(name, 'Basic Tone 440 Hz amplitude = Master level × oscillator level',
      Math.abs(t.a440 - MASTER) / MASTER < TONE_TOL, `${t.a440} vs ${MASTER}`);
    check(name, 'no clipping', t.stats.clippedSamples === 0 && t.stats.peak <= MASTER * 1.01,
      JSON.stringify(t.stats));
    check(name, 'silent until the click-free start time',
      // timing-allow: the offline render rate requested above (sampleRate: 48000)
      t.firstSample >= Math.floor(t.startTime * 48000), `${t.firstSample} / ${t.startTime}`);
    check(name, 'the end is faded out', t.tailMax < 1e-3, String(t.tailMax));

    const s = await page.evaluate(() => window.T.render('sweep-sequence', { probe: 'gap' }));
    check(name, 'Sweep Sequence: the silence clip is > 40 dB below the sweep',
      s.ok && s.rmsSweep > 1e-3 && 20 * Math.log10(s.rmsGap / s.rmsSweep) < -40,
      JSON.stringify({ sweep: s.rmsSweep, gap: s.rmsGap }));

    const syn = await page.evaluate(() => window.T.render('subtractive-synth',
      { probe: 'synth' }));
    check(name, 'Subtractive Synth renders with no limitations',
      syn.ok && syn.stats.peak > 1e-3 && syn.limitations.length === 0,
      JSON.stringify({ peak: syn.stats && syn.stats.peak, limitations: syn.limitations }));
    const y = syn.synth || {};
    const rel = (a, ref) => 20 * Math.log10(Math.max(1e-12, a) / Math.max(1e-12, ref));
    check(name, 'Subtractive Synth: the Tone clip (220 Hz) sounds from the start',
      y.tone220 > 1e-3 && rel(y.tone311, y.tone220) < -30,
      `220 Hz ${y.tone220}, 311 Hz ${rel(y.tone311, y.tone220).toFixed(1)} dB re 220 Hz`);
    check(name, 'Subtractive Synth: then the Sweep (311 Hz at 1.5 s, 440 Hz at 2.0 s)',
      rel(y.s15f220, y.s15f311) < -20 && rel(y.s20f220, y.s20f440) < -30,
      `1.5 s: 220 Hz ${rel(y.s15f220, y.s15f311).toFixed(1)} dB re 311 Hz; 2.0 s: 220 Hz `
        + `${rel(y.s20f220, y.s20f440).toFixed(1)} dB re 440 Hz (no free-running carrier)`);

    const m = await page.evaluate(() => window.T.render('measurement-sweep'));
    check(name, 'Measurement Sweep refused: live Microphone',
      m.ok === false && /Microphone 1 is a live input/.test(m.limitations[0]),
      JSON.stringify(m.limitations));

    const fm = await page.evaluate(() => window.T.voice('fm'));
    const re = (x, ref) => 20 * Math.log10(Math.max(1e-12, x) / Math.max(1e-12, ref));
    const fa = fm.amp || {};
    check(name, 'K010 a 440 Hz LFO puts sidebands at fc ± 440 Hz (log FM, ±0.1 octave)',
      fm.ok && re(fa[560], fa[1000]) > -40 && re(fa[1440], fa[1000]) > -40
        && re(fa[1440], fa[1220]) > 20 && re(fa[560], fa[1220]) > 20,
      `${fm.sampleRate} Hz: 560 ${re(fa[560], fa[1000]).toFixed(1)} dB, 1440 `
        + `${re(fa[1440], fa[1000]).toFixed(1)} dB re carrier; 1220 `
        + `${re(fa[1220], fa[1000]).toFixed(1)} dB`);
    const dr = await page.evaluate(() => window.T.voice('drive'));
    check(name, 'K012 Drive at 100 % behind Master at the ceiling level peaks below the ceiling',
      dr.ok && dr.stats.peak <= dr.ceiling && dr.stats.peak > dr.ceiling * 0.5
        && dr.stats.clippedSamples === 0, `${JSON.stringify(dr.stats)}, ceiling ${dr.ceiling}`);
    const m0 = await page.evaluate(() => window.T.voice('macro', { value: 0 }));
    const m1 = await page.evaluate(() => window.T.voice('macro', { value: 1 }));
    check(name, 'K013 a Macro at 1 opens the cutoff: 2.2 kHz > 10 dB over the Macro at 0',
      m0.ok && m1.ok && re(m1.amp[2200], m0.amp[2200]) > 10,
      `${re(m1.amp[2200], m0.amp[2200]).toFixed(1)} dB`);
    const shelf = await page.evaluate(() => window.T.response({ type: 'lowshelf',
      frequency: 500, gain: 6 }, [30, 15000]));
    check(name, 'K011 low-shelf +6 dB: 6 dB below the corner, 0 dB above it (±0.5 dB)',
      Math.abs(shelf[0] - 6) <= 0.5 && Math.abs(shelf[1]) <= 0.5, JSON.stringify(shelf));
    const ap = await page.evaluate(() => window.T.response({ type: 'allpass', frequency: 1000,
      Q: 1 }, [20, 63, 200, 632, 1000, 2000, 6325, 20000]));
    check(name, 'K011 all-pass magnitude is flat within 0.1 dB, 20 Hz to 20 kHz',
      ap.every((x) => Math.abs(x) <= 0.1), JSON.stringify(ap));
    check(name, 'no console errors', errors.length === 0, errors.join(' | '));
  } catch (err) {
    check(name, 'run completed', false, err && err.stack);
  } finally {
    await browser.close();
  }
}

(async () => {
  await RUN.ready();
  const r = await esbuild.build({ entryPoints: [ENTRY], bundle: true, format: 'iife',
    write: false, target: 'es2020', logLevel: 'silent' });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oscilla-v31-offline-'));
  const file = path.join(dir, 'index.html');
  fs.writeFileSync(file, HTML(r.outputFiles[0].text));
  try {
    for (const b of BROWSERS) await runOne(b, pathToFileURL(file).href);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  console.log(`\n${failures ? `${failures} FAILURE(S)` : 'ALL PASS'} (${passes} checks passed)`);
  process.exit(failures ? 1 : 0);
})();
