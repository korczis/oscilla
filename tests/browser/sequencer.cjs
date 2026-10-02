#!/usr/bin/env node
// OSCILLA V2 pattern sequencer: browser checks against the real Web Audio implementation.
//
//   NODE_PATH=/Users/korczis/dev/oscilla/tests/node_modules node tests/browser/sequencer.cjs
//   node tests/browser/sequencer.cjs --browser firefox     # chromium | firefox (default: both)
//   (stop and teardown checks poll against a deadline; no fixed sleep precedes an assertion)
//
// The fixture (tests/browser/fixtures/sequencer-fixture.js) is bundled in memory with esbuild
// and injected into a blank page. Checks:
//   (a) the reference sequence rendered with OfflineAudioContext has the expected dominant
//       frequency per segment (Hann-windowed FFT on slices, parabolic peak interpolation);
//   (b) no clicks at block boundaries (one-sample step ratio against the signal's own bound),
//       also for modulated blocks and for stop() mid-ramp with and without cancelAndHoldAtTime;
//   (c) stop mid-play on a realtime AudioContext leaves 0 live sources (OscillatorNode
//       start/stop/ended are wrapped), also after a looped run;
//   (d) restart 20x without growth.
// Exit code 0 only when every check passes in every browser.
'use strict';

const path = require('path');
const esbuild = require('esbuild');
const playwright = require('playwright');

const args = process.argv.slice(2);
const only = args.includes('--browser') ? args[args.indexOf('--browser') + 1] : null;
const ENGINES = only ? [only]
  : (process.env.OSC_BROWSERS ? process.env.OSC_BROWSERS.split(',') : ['chromium', 'firefox']);
const FIXTURE = path.join(__dirname, 'fixtures', 'sequencer-fixture.js');
const SR = 48000;
// The spec's shortest allowed edge ramp (2-5 ms). Bounds use this fixed value, never the
// implementation's own constant, so a broken envelope cannot loosen its own test.
const SPEC_MIN_EDGE_S = 0.002;

// ---------------------------------------------------------------- analysis (node side)

function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k;
        const b = a + len / 2;
        const tr = re[b] * cr - im[b] * ci;
        const ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr;
        im[b] = im[a] - ti;
        re[a] += tr;
        im[a] += ti;
        const nr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = nr;
      }
    }
  }
}

/** Dominant frequency of samples[start, start + n) (n a power of two), Hann window. */
function dominant(samples, start, n, sr) {
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1));
    re[i] = (samples[start + i] || 0) * w;
  }
  fft(re, im);
  let best = 1;
  let bestMag = -1;
  const mag = new Float64Array(n / 2);
  for (let k = 1; k < n / 2; k++) {
    mag[k] = Math.hypot(re[k], im[k]);
    if (mag[k] > bestMag) {
      bestMag = mag[k];
      best = k;
    }
  }
  let delta = 0;
  if (best > 1 && best < n / 2 - 1) {
    const a = Math.log(mag[best - 1] + 1e-20);
    const b = Math.log(mag[best] + 1e-20);
    const c = Math.log(mag[best + 1] + 1e-20);
    delta = (0.5 * (a - c)) / (a - 2 * b + c);
  }
  return { freq: ((best + delta) * sr) / n, bin: sr / n };
}

function peakAbs(samples, from, to) {
  let m = 0;
  for (let i = Math.max(0, from); i < Math.min(samples.length, to); i++)
    m = Math.max(m, Math.abs(samples[i]));
  return m;
}

function maxStep(samples, from, to) {
  let m = 0;
  let at = from;
  for (let i = Math.max(1, from); i < Math.min(samples.length, to); i++) {
    const d = Math.abs(samples[i] - samples[i - 1]);
    if (d > m) {
      m = d;
      at = i;
    }
  }
  return { step: m, at };
}

function freqOfBlockAt(b, t) {
  if (b.kind === 'const') return b.freq;
  if (b.kind === 'ramp') {
    const k = Math.min(1, Math.max(0, (t - b.start) / (b.end - b.start)));
    return b.curve === 'log' ? b.f0 * Math.pow(b.f1 / b.f0, k) : b.f0 + (b.f1 - b.f0) * k;
  }
  if (b.kind === 'steps') return Math.max(...b.steps.map((s) => s.f));
  return null;
}

/**
 * Highest frequency the signal can contain in [t0, t1] (modulated blocks: their upper limit).
 * Used for the click bound 2·sin(π·f/sr): the largest one-sample step of a unit sinusoid.
 */
function maxFreqInWindow(tl, t0, t1) {
  let f = 20;
  for (const b of tl.blocks) {
    if (b.end < t0 || b.start > t1) continue;
    if (b.kind === 'ramp') f = Math.max(f, b.f0, b.f1);
    else if (b.kind === 'steps') f = Math.max(f, ...b.steps.map((s) => s.f));
    else if (b.kind === 'const') f = Math.max(f, b.freq);
    else if (b.type === 'siren' || b.type === 'fm' || b.type === 'am') f = Math.max(f, 2000);
  }
  return f;
}

/** Click bound: the steepest a unit sinusoid at fMax can move per sample plus the edge slope. */
function stepBound(fMax, sr, edgeS) {
  return 2 * Math.sin((Math.PI * Math.min(fMax, sr / 2)) / sr) + 1 / (edgeS * sr);
}

// ---------------------------------------------------------------- checks

const results = [];
function check(engine, name, ok, detail) {
  results.push({ engine, name, ok: !!ok, detail });
  const mark = ok ? 'PASS' : 'FAIL';
  console.log(`  ${mark}  ${name}${detail ? ` — ${detail}` : ''}`);
}

function checkDominant(engine, ref) {
  const { samples, timeline } = ref;
  const sr = timeline.sampleRate;
  const f = (s) => Math.round(s * sr);
  const [tone, sweep, silence, pulse, chirp] = timeline.blocks;
  // Tone 440 Hz: one 8192-point slice in the middle (5.9 Hz bins).
  {
    const n = 8192;
    const start = f((tone.start + tone.end) / 2) - n / 2;
    const d = dominant(samples, start, n, sr);
    check(
      engine,
      '(a) tone 440 Hz dominant',
      Math.abs(d.freq - 440) <= d.bin / 2,
      `${d.freq.toFixed(2)} Hz (bin ${d.bin.toFixed(2)} Hz)`,
    );
  }
  // Sweep 440 -> 880 log: four 2048-point slices, each inside [f(start), f(end)] ± one bin.
  {
    const n = 2048;
    const out = [];
    let ok = true;
    for (const k of [0.1, 0.35, 0.6, 0.85]) {
      const s0 = sweep.start + k * (sweep.end - sweep.start) - n / sr / 2;
      const lo = freqOfBlockAt(sweep, s0);
      const hi = freqOfBlockAt(sweep, s0 + n / sr);
      const d = dominant(samples, f(s0), n, sr);
      const pass = d.freq >= lo - d.bin && d.freq <= hi + d.bin;
      ok = ok && pass;
      out.push(`${d.freq.toFixed(0)}∈[${lo.toFixed(0)},${hi.toFixed(0)}]`);
    }
    // And it must rise: log sweep midpoint ~622 Hz.
    const mid = dominant(samples, f((sweep.start + sweep.end) / 2) - 1024, 2048, sr);
    ok = ok && Math.abs(mid.freq - Math.sqrt(440 * 880)) <= 2 * mid.bin;
    check(
      engine,
      '(a) sweep 440→880 Hz log, per slice',
      ok,
      `${out.join(' ')} mid ${mid.freq.toFixed(1)}`,
    );
  }
  // Silence: the floor (-80 dB) only.
  {
    const p = peakAbs(samples, f(silence.start) + 1, f(silence.end) - 1);
    check(engine, '(a) silence at the floor', p <= 2e-4, `peak ${p.toExponential(2)}`);
  }
  // Pulse 1.2 kHz: every pulse dominant at 1.2 kHz; gaps at the floor.
  {
    let ok = true;
    const out = [];
    for (const s of pulse.steps) {
      const n = 4096;
      const st = f((s.start + s.end) / 2) - n / 2;
      const d = dominant(samples, st, n, sr);
      ok = ok && Math.abs(d.freq - 1200) <= d.bin / 2;
      out.push(d.freq.toFixed(1));
    }
    let gapPeak = 0;
    for (let i = 1; i < pulse.steps.length; i++) {
      gapPeak = Math.max(
        gapPeak,
        peakAbs(samples, f(pulse.steps[i - 1].end) + 1, f(pulse.steps[i].start) - 1),
      );
    }
    ok = ok && gapPeak <= 2e-4 && pulse.steps.length === 3;
    check(
      engine,
      '(a) pulse 1.2 kHz (3 pulses, silent gaps)',
      ok,
      `${out.join(', ')} Hz; gap peak ${gapPeak.toExponential(2)}`,
    );
  }
  // Chirp 1 -> 8 kHz exponential: four 1024-point slices.
  {
    const n = 1024;
    const out = [];
    let ok = true;
    for (const k of [0.1, 0.35, 0.6, 0.85]) {
      const s0 = chirp.start + k * (chirp.end - chirp.start) - n / sr / 2;
      const lo = freqOfBlockAt(chirp, s0);
      const hi = freqOfBlockAt(chirp, s0 + n / sr);
      const d = dominant(samples, f(s0), n, sr);
      const pass = d.freq >= lo - d.bin && d.freq <= hi + d.bin;
      ok = ok && pass;
      out.push(`${d.freq.toFixed(0)}∈[${lo.toFixed(0)},${hi.toFixed(0)}]`);
    }
    check(engine, '(a) chirp 1→8 kHz exponential, per slice', ok, out.join(' '));
  }
  // Sequence end: nothing after the last block.
  {
    const end = f(timeline.duration);
    const p = peakAbs(samples, end + 1, samples.length);
    check(engine, '(a) silent after the sequence end', p <= 2e-4, `peak ${p.toExponential(2)}`);
  }
}

/** Every boundary (block starts/ends and step edges) within ±10 ms stays under the bound. */
function checkClicks(engine, label, rendered) {
  const { samples, timeline } = rendered;
  const sr = timeline.sampleRate;
  const times = new Set();
  for (const b of timeline.blocks) {
    times.add(b.start);
    times.add(b.end);
    for (const w of b.windows) {
      times.add(w.start);
      times.add(w.end);
    }
  }
  let worst = { ratio: 0, t: 0, step: 0, bound: 0 };
  const hardClick = 1; // a full-scale jump, for scale
  for (const t of times) {
    const t0 = t - 0.01;
    const t1 = t + 0.01;
    const fMax = maxFreqInWindow(timeline, t0, t1);
    const bound = stepBound(fMax, sr, SPEC_MIN_EDGE_S);
    const { step } = maxStep(samples, Math.round(t0 * sr), Math.round(t1 * sr));
    const ratio = step / bound;
    if (ratio > worst.ratio) worst = { ratio, t, step, bound };
  }
  // At every block boundary the envelope is at its floor: the samples right at the boundary
  // (±1 frame) are within one edge-ramp step of zero, whatever the frequency.
  let worstAtBoundary = 0;
  for (const b of timeline.blocks) {
    for (const t of [b.start, b.end]) {
      const fr = Math.round(t * sr);
      worstAtBoundary = Math.max(worstAtBoundary, peakAbs(samples, fr - 1, fr + 2));
    }
  }
  const floorLimit = 2 / (SPEC_MIN_EDGE_S * sr) + 2e-4;
  check(
    engine,
    `(b) envelope at the floor on every block boundary: ${label}`,
    worstAtBoundary <= floorLimit,
    `max |x| within ±1 frame ${worstAtBoundary.toExponential(2)} (limit ${floorLimit.toFixed(4)})`,
  );
  check(
    engine,
    `(b) no clicks at ${times.size} boundaries: ${label}`,
    worst.ratio <= 1,
    `worst step/bound ${worst.ratio.toFixed(3)} at ${worst.t.toFixed(4)} s ` +
      `(step ${worst.step.toFixed(4)}, bound ${worst.bound.toFixed(4)}, hard click ${hardClick})`,
  );
}

function checkStopRender(engine, label, r) {
  const { samples, timeline } = r;
  const sr = timeline.sampleRate;
  const stopAt = r.stopAt;
  const fMax = maxFreqInWindow(timeline, stopAt - 0.01, stopAt + 0.03);
  const bound = stepBound(fMax, sr, SPEC_MIN_EDGE_S);
  const from = Math.round((stopAt - 0.01) * sr);
  const to = Math.round((stopAt + r.stopRampS + 0.01) * sr);
  const { step, at } = maxStep(samples, from, to);
  const tail = peakAbs(samples, Math.round((stopAt + r.stopRampS + 0.001) * sr), samples.length);
  const ok = step <= bound && tail <= 2e-4 && r.voiceEnded && r.nodes === 0;
  const mode = r.midRender ? 'mid-render (suspend)' : 'pre-scheduled';
  check(
    engine,
    `(b) stop() at ${stopAt.toFixed(4)} s, envelope ${r.envAtStop.toFixed(3)}: ${label}, ${mode}`,
    ok,
    `max step ${step.toFixed(4)} at ${(at / sr).toFixed(4)} s (bound ${bound.toFixed(4)}), ` +
      `after fade ${tail.toExponential(2)}, ended ${r.voiceEnded}, nodes ${r.nodes}`,
  );
}

function checkRealtimeCapture(engine, label, cap) {
  const sr = cap.sampleRate;
  const bound = stepBound(200, sr, SPEC_MIN_EDGE_S);
  const worst = Math.max(...cap.runs.map((r) => r.maxStep));
  const midRamp = cap.runs.filter((r) => r.envAtStop > 0.01 && r.envAtStop < 0.99).length;
  const frames = Math.min(...cap.runs.map((r) => r.frames));
  // Torn down within 100 ms of audio time after stop() (observed by a deadline poll; the voice's
  // own fade and source stops are scheduled well inside that).
  const endedAfter = cap.runs.map((r) => r.endedAfter);
  const ok = worst <= bound && frames > 0.1 * sr
    && cap.runs.every((r) => r.ended && r.nodes === 0 && r.endedAfter !== null && r.endedAfter <= 0.1);
  check(
    engine,
    `(b) realtime stop x${cap.runs.length} (dense 200 Hz pulses, captured): ${label}`,
    ok,
    `worst step ${worst.toFixed(4)} (bound ${bound.toFixed(4)}), ` +
      `${midRamp} stops landed mid-ramp, ` +
      `gaps ${cap.runs.map((r) => r.gaps).join('/')}, min frames ${frames}, ended after `
      + `${endedAfter.map((v) => (v === null ? 'never' : `${(v * 1000).toFixed(0)} ms`)).join('/')}`,
  );
}

// ---------------------------------------------------------------- run

async function runEngine(engine, bundle) {
  console.log(`\n${engine}`);
  const launch = {
    chromium: { args: ['--autoplay-policy=no-user-gesture-required'] },
    firefox: {
      firefoxUserPrefs: { 'media.autoplay.default': 0, 'media.autoplay.block-webaudio': false },
    },
  }[engine];
  const browser = await playwright[engine].launch(launch);
  const errors = [];
  try {
    const page = await browser.newPage();
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text());
    });
    // Served from http://localhost (a secure context, needed for AudioWorklet) by page.route:
    // nothing listens on the port, the page is fulfilled from memory.
    const html =
      '<!doctype html><meta charset="utf-8"><title>sequencer fixture</title>' +
      `<script>${bundle.replace(/<\/script/gi, '<\\/script')}</script>`;
    await page.route('http://localhost/**', (route) =>
      route.fulfill({ status: 200, contentType: 'text/html', body: html }),
    );
    await page.goto('http://localhost/sequencer-fixture.html');
    await page.waitForFunction(() => window.seqFixtureReady === true);
    const native = await page.evaluate(() => window.seqFixture.hasCancelAndHold());
    console.log(`  (cancelAndHoldAtTime native: ${native})`);

    // (a) + (b) offline renders.
    for (const sr of [SR, 44100]) {
      const ref = await page.evaluate((r) => window.seqFixture.renderReference(r), sr);
      if (sr === SR) checkDominant(engine, ref);
      checkClicks(engine, `reference sequence @ ${sr} Hz`, ref);
    }
    const mod = await page.evaluate((r) => window.seqFixture.renderModulated(r), SR);
    checkClicks(engine, 'reference + siren/AM/FM/random/burst', mod);

    // (b) stop mid-ramp: mid tone, mid attack edge of the sweep, mid sweep, mid pulse edge,
    // mid AM block; native hold and forced fallback (Firefox has no cancelAndHoldAtTime).
    const stops = [0.25, 0.5 + 0.0015, 0.8123, 1.25 + 0.001, 2.25 + 0.3 + 0.1234];
    for (const forceFallback of native ? [false, true] : [false]) {
      for (const at of stops) {
        const r = await page.evaluate(
          ([s, a, ff]) => window.seqFixture.renderStopped(s, a, { forceFallback: ff }),
          [SR, at, forceFallback],
        );
        checkStopRender(
          engine,
          r.usedFallback ? 'computed hold (fallback)' : 'cancelAndHoldAtTime',
          r,
        );
      }
    }

    // (c) + (d) realtime.
    const setup = await page.evaluate(() => window.seqFixture.realtimeSetup());
    check(
      engine,
      'realtime AudioContext running',
      setup && setup.state === 'running',
      JSON.stringify(setup),
    );
    const mid = await page.evaluate(() => window.seqFixture.stopMidPlay(900));
    check(
      engine,
      '(c) sources live while playing',
      mid.during.live >= 1 && mid.during.ctxAdvanced > 0.5,
      `live ${mid.during.live}, started ${mid.during.started}, ` +
        `clock +${mid.during.ctxAdvanced.toFixed(2)} s`,
    );
    check(
      engine,
      '(c) stop mid-play leaves 0 live sources',
      mid.after.live === 0 &&
        mid.after.started === mid.after.ended &&
        mid.after.stats.voices === 0 &&
        mid.after.stats.activeNodeCount === 0 &&
        !mid.after.playing,
      `started ${mid.after.started}, ended ${mid.after.ended}, live ${mid.after.live}, ` +
        `voice nodes ${mid.after.stats.activeNodeCount}, torn down in ${mid.after.waitedMs} ms`,
    );
    const loop = await page.evaluate(() => window.seqFixture.loopThenStop(1300));
    check(
      engine,
      '(c) looped playback then stop leaves 0 live sources',
      loop.during.started >= 8 &&
        loop.during.playing &&
        loop.after.live === 0 &&
        loop.after.started === loop.after.ended &&
        loop.after.stats.voices === 0,
      `passes started ${loop.during.started} sources, live after ${loop.after.live}`,
    );
    for (const forceFallback of native ? [false, true] : [false]) {
      const cap = await page.evaluate(
        (ff) => window.seqFixture.realtimeStopCapture(10, { forceFallback: ff }),
        forceFallback,
      );
      checkRealtimeCapture(
        engine,
        forceFallback || !native ? 'computed hold (fallback)' : 'cancelAndHoldAtTime',
        cap,
      );
    }
    const many = await page.evaluate(() => window.seqFixture.restartMany(20, 60));
    const perPass = 4; // carrier + siren LFO + AM LFO + FM modulator (random/burst have none)
    const maxLive = Math.max(...many.perRestart.map((p) => p.live));
    const maxVoices = Math.max(...many.perRestart.map((p) => p.voices));
    const lastLive = many.perRestart.slice(-5).map((p) => p.live);
    check(
      engine,
      '(d) restart 20x without growth',
      maxVoices <= 2 &&
        maxLive <= 2 * perPass &&
        many.after.live === 0 &&
        many.after.started === many.after.ended &&
        many.after.stats.voices === 0 &&
        many.after.started === 20 * perPass,
      `max voices ${maxVoices}, max live ${maxLive}, last live ${lastLive.join('/')}, ` +
        `started ${many.after.started}, ended ${many.after.ended}`,
    );
    const final = await page.evaluate(() => window.seqFixture.realtimeTeardown());
    check(engine, 'no live sources after teardown', final.live === 0, JSON.stringify(final));
    check(engine, 'no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  } finally {
    await browser.close();
  }
}

(async () => {
  const built = await esbuild.build({
    entryPoints: [FIXTURE],
    bundle: true,
    format: 'iife',
    write: false,
    platform: 'browser',
    target: ['es2020'],
    logLevel: 'silent',
  });
  const bundle = built.outputFiles[0].text;
  for (const engine of ENGINES) {
    try {
      await runEngine(engine, bundle);
    } catch (e) {
      check(engine, 'run', false, String(e && e.stack ? e.stack : e));
    }
  }
  const failed = results.filter((r) => !r.ok);
  console.log(
    `\n${results.length - failed.length}/${results.length} checks passed` +
      ` (${ENGINES.join(', ')})`,
  );
  process.exit(failed.length ? 1 : 0);
})();
