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
//   Subtractive Synth renders (non-silent) and lists its pattern clips on the Oscillator as
//     limitations; Measurement Sweep is refused (live Microphone) with that limitation.
//   no console error or page error.
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const esbuild = require('esbuild');
const playwright = require('playwright');

const argv = process.argv.slice(2);
const i = argv.indexOf('--browsers');
const BROWSERS = (i >= 0 && argv[i + 1] ? argv[i + 1] : 'chromium,firefox,webkit').split(',');
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
      t.firstSample >= Math.floor(t.startTime * 48000), `${t.firstSample} / ${t.startTime}`);
    check(name, 'the end is faded out', t.tailMax < 1e-3, String(t.tailMax));

    const s = await page.evaluate(() => window.T.render('sweep-sequence', { probe: 'gap' }));
    check(name, 'Sweep Sequence: the silence clip is > 40 dB below the sweep',
      s.ok && s.rmsSweep > 1e-3 && 20 * Math.log10(s.rmsGap / s.rmsSweep) < -40,
      JSON.stringify({ sweep: s.rmsSweep, gap: s.rmsGap }));

    const syn = await page.evaluate(() => window.T.render('subtractive-synth'));
    check(name, 'Subtractive Synth renders with its limitations listed',
      syn.ok && syn.stats.peak > 1e-3 && syn.limitations.length === 2,
      JSON.stringify({ peak: syn.stats && syn.stats.peak, limitations: syn.limitations }));

    const m = await page.evaluate(() => window.T.render('measurement-sweep'));
    check(name, 'Measurement Sweep refused: live Microphone',
      m.ok === false && /Microphone 1 is a live input/.test(m.limitations[0]),
      JSON.stringify(m.limitations));
    check(name, 'no console errors', errors.length === 0, errors.join(' | '));
  } catch (err) {
    check(name, 'run completed', false, err && err.stack);
  } finally {
    await browser.close();
  }
}

(async () => {
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
