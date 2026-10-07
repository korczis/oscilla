#!/usr/bin/env node
// Browser verification of the DSP modules (Chromium, Firefox and WebKit).
//
//   node tests/browser/dsp.cjs [--browser chromium|firefox|webkit] [--json]
//   OSC_BROWSERS=webkit node tests/browser/dsp.cjs     # the same, from the environment (CI)
//
// Bundles tests/browser/fixtures/dsp-entry.js in memory with esbuild and serves it with
// fixtures/dsp.html through page.route (nothing is written to disk). Resolves esbuild and
// playwright from app/node_modules, or from NODE_PATH
// (e.g. NODE_PATH=/Users/korczis/dev/oscilla/tests/node_modules).
'use strict';

const path = require('path');
const fs = require('fs');
const esbuild = require('esbuild');
const suite = require('./lib/suite.cjs');

const FIX = path.join(__dirname, 'fixtures');
const ORIGIN = 'http://dsp.test';
const args = process.argv.slice(2);
const only = args.includes('--browser') ? args[args.indexOf('--browser') + 1] : null;
const RUN = suite.open({ name: 'dsp', browsers: only === null ? undefined : only });
const playwright = RUN.playwright;

let failures = 0;
const lines = [];
function check(browser, name, ok, detail) {
  RUN.tally(browser);
  const line = `${ok ? 'PASS' : 'FAIL'} [${browser}] ${name}${detail ? ` — ${detail}` : ''}`;
  lines.push(line);
  console.log(line);
  if (!ok) failures++;
}
const f = (x, d = 3) => (x == null ? 'null' : Number(x).toFixed(d));

async function bundle() {
  const out = await esbuild.build({
    entryPoints: [path.join(FIX, 'dsp-entry.js')],
    bundle: true,
    format: 'iife',
    write: false,
    target: 'es2020',
    logLevel: 'silent',
  });
  return out.outputFiles[0].text;
}

async function runBrowser(name, type, js) {
  const launchOpts = {
    chromium: { args: ['--autoplay-policy=no-user-gesture-required'] },
    firefox: {
      firefoxUserPrefs: { 'media.autoplay.default': 0, 'media.autoplay.block-webaudio': false },
    },
    webkit: {}, // Playwright's WebKit starts an AudioContext without a gesture
  }[name];
  const browser = await type.launch(launchOpts);
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  await page.route(`${ORIGIN}/**`, (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith('dsp-bundle.js')) {
      return route.fulfill({ status: 200, contentType: 'text/javascript', body: js });
    }
    return route.fulfill({
      status: 200,
      contentType: 'text/html',
      body: fs.readFileSync(path.join(FIX, 'dsp.html')),
    });
  });
  await page.goto(`${ORIGIN}/dsp.html`);
  await page.waitForFunction(() => window.DSP_READY === true, null,
    { timeout: 30000 });
  const call = (fn) => page.evaluate((n) => window.DSP_TESTS[n](), fn);
  const B = `${name} ${browser.version()}`;

  // 1. 1 kHz tone through the analyser + peak detector
  const live = await call('liveTonePeak');
  if (live.skipped) {
    check(B, 'live 1 kHz analyser peak', false, `skipped: ${live.skipped}`);
  } else {
    const ok = live.peak && Math.abs(live.peak.frequencyHz - 1000) <= live.binHz / 2;
    check(
      B,
      'live 1 kHz analyser peak within ±binHz/2',
      ok,
      `${f(live.peak && live.peak.frequencyHz)} Hz, binHz ${f(live.binHz)}, ` +
        `level ${f(live.peak && live.peak.levelDbfs, 2)} dBFS (gain 0.25 → −12.04)`,
    );
    check(
      B,
      'live peak level = sine amplitude in dBFS (±0.5 dB)',
      live.peak && Math.abs(live.peak.levelDbfs + 12.04) < 0.5,
    );
  }
  const off = await call('offlineTonePeak');
  if (off.skipped) {
    RUN.skip(B, 'offline-analyser-variant', off.skipped);
  } else {
    check(
      B,
      'offline (suspend) 1 kHz analyser peak within ±binHz/2',
      off.peak && Math.abs(off.peak.frequencyHz - 1000) <= off.binHz / 2,
      `${f(off.peak && off.peak.frequencyHz)} Hz`,
    );
  }

  // 2. Filter response
  const fr = await call('filterResponse');
  check(
    B,
    'lowpass Q=0.7071 getResponse −3 dB at cutoff (±0.05)',
    Math.abs(fr.lpAtCutoffDb + 3.0103) < 0.05,
    `${f(fr.lpAtCutoffDb)} dB, phase ${f(fr.lpPhaseAtCutoffDeg, 1)}°`,
  );
  check(
    B,
    'lowpass passband/stopband',
    Math.abs(fr.lpAt100Db) < 0.1 && fr.lpAt10kDb < -35,
    `100 Hz ${f(fr.lpAt100Db)} dB, 10 kHz ${f(fr.lpAt10kDb, 1)} dB`,
  );
  check(
    B,
    'response follows update() immediately',
    Math.abs(fr.lpAfterUpdateDb + 3.0103) < 0.05,
    `${f(fr.lpAfterUpdateDb)} dB at new cutoff`,
  );
  check(
    B,
    'highpass −3 dB at cutoff',
    Math.abs(fr.hpAtCutoffDb + 3.0103) < 0.05 && fr.hpAt100Db < -35,
    `${f(fr.hpAtCutoffDb)} dB`,
  );
  check(B, 'peaking +6 dB at centre', Math.abs(fr.peakingDb - 6) < 0.05, `${f(fr.peakingDb)} dB`);
  check(
    B,
    'measured tone attenuation at cutoff matches (±0.1 dB)',
    Math.abs(fr.measuredDb + 3.0103) < 0.1,
    `${f(fr.measuredDb)} dB`,
  );
  check(
    B,
    'filter stage reports every node to track()',
    fr.trackedNodes === 8,
    `${fr.trackedNodes} nodes`,
  );

  // 3. WAV round trip
  const wav = await call('wavRoundTrip');
  check(
    B,
    'rendered 440 Hz tone peak',
    wav.rendered && Math.abs(wav.rendered.frequencyHz - 440) <= wav.binHz / 2,
    `${f(wav.rendered && wav.rendered.frequencyHz)} Hz, render peak ${f(wav.stats.peak)}`,
  );
  for (const bd of ['b16', 'b32']) {
    const r = wav[bd];
    check(
      B,
      `WAV ${bd.slice(1)}-bit decodes (2 ch, 48 kHz, 48000 frames) with 440 Hz peak`,
      r.channels === 2 &&
        r.sampleRate === 48000 &&
        r.length === 48000 &&
        r.peak &&
        Math.abs(r.peak.frequencyHz - 440) <= wav.binHz / 2,
      `${f(r.peak && r.peak.frequencyHz)} Hz, ${r.bytes} bytes, ` +
        `max |diff| ${r.maxAbsDiff.toExponential(2)}`,
    );
  }
  check(
    B,
    'WAV sample fidelity (16-bit ≤ 1 LSB, float exact)',
    wav.b16.maxAbsDiff <= 1.5 / 32767 && wav.b32.maxAbsDiff === 0,
  );

  // 4. PeriodicWave square approximation
  const sq = await call('periodicWaveSquare');
  // a null level means no bin above the detector's −120 dB absolute floor: absent
  const rel = (n) => (sq.levels[n - 1] == null ? -Infinity : sq.levels[n - 1] - sq.levels[0]);
  check(
    B,
    'PeriodicWave square: harmonics at 1, 3, 5 × f0',
    [1, 3, 5].every((n) => Math.abs(sq.freqs[n - 1] - n * sq.f0) < 1),
    sq.freqs.map((x) => f(x, 1)).join(', '),
  );
  check(
    B,
    'PeriodicWave square: 1/n ratios (±0.3 dB)',
    Math.abs(rel(3) - 20 * Math.log10(1 / 3)) < 0.3 &&
      Math.abs(rel(5) - 20 * Math.log10(1 / 5)) < 0.3,
    `H3 ${f(rel(3), 2)} dB (−9.54), H5 ${f(rel(5), 2)} dB (−13.98)`,
  );
  check(
    B,
    'PeriodicWave square: even harmonics absent (< −60 dB)',
    rel(2) < -60 && rel(4) < -60,
    `H2 ${f(rel(2), 1)}, H4 ${f(rel(4), 1)}`,
  );
  check(
    B,
    'disableNormalization + own peak scaling: rendered peak = computed peak (±2 %)',
    Math.abs(sq.renderedPeak - sq.expectedPeak) < 0.02,
    `rendered ${f(sq.renderedPeak, 4)}, computed ${f(sq.expectedPeak, 4)}`,
  );

  // 5. Release without click
  const rc = await call('releaseClicks');
  for (const c of rc.cases) {
    const phase = c.tReq < 0.06 ? 'mid-attack' : c.tReq < 0.2 ? 'mid-decay' : 'sustain';
    const label = `release ${phase} @${f(c.tRel, 4)}s ${c.mode}`;
    const clickFree = c.maxStep <= 1.5 * c.maxExpectedStep + 1e-4;
    const detail =
      `max step ${c.maxStep.toExponential(2)} ` +
      `vs curve slope ${c.maxExpectedStep.toExponential(2)}`;
    if (c.mode.startsWith('naive')) {
      check(B, `${label}: control shows a click`, c.maxStep > 0.05, detail);
    } else {
      check(
        B,
        `${label}: no click, rendered = valueAtTime model, silent before t0 and after`,
        clickFree && c.modelError < 1e-3 && c.tail < 2e-4 && c.valueBeforeT0 < 2e-4,
        `${detail}, model error ${c.modelError.toExponential(2)}, ` +
          `value at release ${f(c.valueAtRelease, 4)}`,
      );
    }
  }
  lines.push(
    `INFO [${B}] cancelAndHoldAtTime: ${rc.hasNative}; ` +
      `OfflineAudioContext.suspend: ${rc.hasSuspend}`,
  );
  console.log(lines.at(-1));

  // 6. Stereo routing + correlation
  const s = await call('stereoRouting');
  check(B, 'stereo split in phase → correlation 1', s.split > 0.999, f(s.split, 4));
  check(B, 'stereo B inverted → correlation −1', s.inverted < -0.999, f(s.inverted, 4));
  check(B, 'stereo unrelated frequencies → ≈0', Math.abs(s.unrelated) < 0.05, f(s.unrelated, 4));
  check(B, 'mono sum → correlation 1', s.mono > 0.999, f(s.mono, 4));
  check(
    B,
    'split levels L = R, pan −1 silences R',
    Math.abs(s.splitLeftRms - s.splitRightRms) < 1e-3 && s.hardLeftRightRms < 1e-4,
    `L ${f(s.splitLeftRms, 4)} R ${f(s.splitRightRms, 4)}, ` +
      `hard-left R ${s.hardLeftRightRms.toExponential(1)}; corr ${s.hardLeft}`,
  );

  // 7. Builders
  const b = await call('buildersSmoke');
  check(
    B,
    'noise source RMS ≈ 0.2 and silent after stop',
    Math.abs(b.noiseRms - 0.2) < 0.02 && b.afterStopPeak < 1e-3,
    `rms ${f(b.noiseRms, 4)}, after stop ${b.afterStopPeak.toExponential(1)}`,
  );
  check(
    B,
    'track/source hooks called',
    b.counts.track >= 3 && b.counts.source >= 2,
    JSON.stringify(b.counts),
  );

  // 8. Spectrogram
  const sg = await call('spectrogramSmoke');
  const same = (a, c) => a.slice(0, 3).every((v, i) => Math.abs(v - c[i]) <= 1);
  check(
    B,
    'spectrogram ring buffer; tone row bright, other rows floor colour',
    sg.strategy === 'ring' &&
      sg.toneRgb[0] > 200 &&
      same(sg.farRgb, sg.floor) &&
      same(sg.oldRgb, sg.floor),
    `strategy ${sg.strategy}, tone ${sg.toneRgb}, far ${sg.farRgb}, floor ${sg.floor}`,
  );

  check(B, 'no page errors', errors.length === 0, errors.join(' | '));
  await browser.close();
}

(async () => {
  await RUN.ready();
  const js = await bundle();
  // The harness has refused an unknown or empty selection (exit 2) and fails a browser that
  // runs 0 checks: a browser this suite cannot launch must not pass as "0 checks, ALL PASS".
  const targets = RUN.browsers.map((n) => [n, playwright[n]]);
  for (const [name, type] of targets) {
    try {
      await runBrowser(name, type, js);
    } catch (e) {
      check(name, 'browser run', false, e.stack || e.message);
    }
  }
  console.log(
    `\n${failures === 0 ? 'ALL PASS' : `${failures} FAILURE(S)`} ` +
      `(${lines.filter((l) => l.startsWith('PASS')).length} checks passed)`,
  );
  process.exit(failures ? 1 : 0);
})();
