#!/usr/bin/env node
// OSCILLA V2 pattern sequencer: browser checks against the real Web Audio implementation.
//
//   NODE_PATH=<checkout>/tests/node_modules node tests/browser/sequencer.cjs
//   node tests/browser/sequencer.cjs --browser firefox     # chromium | firefox | webkit (default: all)
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
//   (d) restart 20x without growth: once each restart's earlier passes have delivered `ended`
//       (bounded wait), none of their sources is live and only the current voice remains.
//   (e) the Pattern Sequencer panel of the built page (dist/index.html, file://), driven
//       through its controls: Play from the start, Loop (pointer and keyboard), the Selected
//       block fields (start, end, duration, curve), Move later and Tempo, each judged at the
//       model, at a view (transport aria state, status bar, the block's timeline label) and at
//       what sounds (the engine output while playing, or the sequence WAV of the Export menu).
// Exit code 0 only when every check passes in every browser.
'use strict';

const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const esbuild = require('esbuild');
const suite = require('./lib/suite.cjs');
const { until } = require('./lib/wait.cjs');

const args = process.argv.slice(2);
const only = args.includes('--browser') ? args[args.indexOf('--browser') + 1] : null;
const RUN = suite.open({ name: 'sequencer', browsers: only === null ? undefined : only });
const playwright = RUN.playwright;
const ENGINES = RUN.browsers;
const FIXTURE = path.join(__dirname, 'fixtures', 'sequencer-fixture.js');
// timing-allow: the OfflineAudioContext render rate of the reference renders
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
  RUN.tally(engine);
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

// ---------------------------------------------------------------- (e) the panel in the page
// C020: the Pattern Sequencer panel of the built page (dist/index.html from file://), its
// controls operated through the UI: Play from the start, Loop, the Selected block fields
// (start, end, duration, curve), Move later and Tempo. Each is judged at the model, at a view
// that shows it (the transport's aria state, the status bar, the block's label on the
// timeline) and at what sounds: the engine output while the sequence plays, or the sequence
// WAV that the Export menu renders. Every wait is a condition poll with a named deadline.

const DIST = path.join(__dirname, '..', '..', 'dist', 'index.html');
const PANEL_MS = 15000;

/** In-page: the sequencer as the model, the panel and the engine output show it. */
function panelState() {
  const O = window.OSCILLA;
  const lab = O.labs.sequencer;
  const ed = lab.editor;
  const q = (s) => document.querySelector(s);
  const txt = (s) => (q(s) ? q(s).textContent.replace(/\s+/g, ' ').trim() : null);
  const e = O.engine;
  let peak = 0;
  if (e.analyser) {
    const d = new Float32Array(e.analyser.fftSize);
    e.analyser.getFloatTimeDomainData(d);
    for (let i = 0; i < d.length; i++) peak = Math.max(peak, Math.abs(d[i]));
  }
  const timing = ed.currentPassTiming();
  return {
    playing: ed.playing, appPlaying: O.app.seqPlaying, loop: ed.model.loop,
    tempo: ed.model.tempoBpm, selected: ed.selectedId, now: e.ctx ? e.ctx.currentTime : 0,
    pass: timing, peak,
    blocks: ed.model.blocks.map((b) => {
      const el = q(`#osc-seq-block-${b.id}`);
      const r = el ? el.getBoundingClientRect() : null;
      return { id: b.id, type: b.type, ms: b.durationMs, beats: b.beats, p: { ...b.params },
        label: el ? el.getAttribute('aria-label') : null, x: r ? r.left : null };
    }),
    aria: { play: q('#osc-seq-play').getAttribute('aria-pressed'),
      loop: q('#osc-seq-record').getAttribute('aria-pressed') },
    tempoSelect: q('#osc-seq-tempo').value,
    status: { label: txt('[data-osc="status.label"]'),
      duration: txt('[data-osc="status.duration"]') },
  };
}

/** Channel 0 of a 16-bit PCM WAV as floats, with its rate. */
function wavSamples(buf) {
  let off = 12;
  let fmt = null;
  while (off + 8 <= buf.length) {
    const id = buf.toString('ascii', off, off + 4);
    const size = buf.readUInt32LE(off + 4);
    if (id === 'fmt ') {
      fmt = { channels: buf.readUInt16LE(off + 10), sampleRate: buf.readUInt32LE(off + 12),
        bits: buf.readUInt16LE(off + 22) };
    } else if (id === 'data' && fmt && fmt.bits === 16) {
      const n = Math.floor(size / (2 * fmt.channels));
      const out = new Float32Array(n);
      for (let i = 0; i < n; i++) out[i] = buf.readInt16LE(off + 8 + i * 2 * fmt.channels) / 32768;
      return { samples: out, sampleRate: fmt.sampleRate };
    }
    off += 8 + size + (size % 2);
  }
  return null;
}

/** Dominant frequency around t seconds of a render: a ~40 ms slice, at the render's rate. */
function freqAt(wav, t) {
  const n = 2 ** Math.floor(Math.log2(wav.sampleRate * 0.04));
  return dominant(wav.samples, Math.round(t * wav.sampleRate) - n / 2, n, wav.sampleRate).freq;
}

async function panelChecks(engine, browser) {
  const context = await browser.newContext({ viewport: { width: 1536, height: 1024 },
    acceptDownloads: true });
  const page = await context.newPage();
  page.setDefaultTimeout(PANEL_MS);
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  const state = () => page.evaluate(panelState);
  const poll = (pred, what) => {
    let last = null;
    return until(async () => {
      last = await state();
      return pred(last) ? last : null;
    }, { ms: PANEL_MS, what: `sequencer panel: ${what}` }).catch((e) => ({ timeout: String(
      e.message).split('\n')[0], last }));
  };
  const exportWav = async () => {
    await page.click('#osc-export');
    const [dl] = await Promise.all([page.waitForEvent('download', { timeout: PANEL_MS }),
      page.click('[data-osc="export.seqWav"]')]);
    return wavSamples(fs.readFileSync(await dl.path()));
  };
  const near = (x, y, tol) => typeof x === 'number' && Math.abs(x - y) <= tol;
  try {
    await page.goto(pathToFileURL(DIST).href, { waitUntil: 'load', timeout: 60000 });
    await page.waitForSelector('html[data-ready="true"]', { timeout: 60000 });
    await page.mouse.click(5, 5); // the first gesture lets the AudioContext start
    await page.evaluate(() => {
      const a = window.OSCILLA.app;
      a.ensureAudio();
      if (!a.safetyCollapsed && a.collapseSafety) a.collapseSafety();
      a.alerts = [];
    });
    await until(() => page.evaluate(() => window.OSCILLA.engine.state === 'running'),
      { ms: 60000, what: 'sequencer panel: the AudioContext runs after the first gesture' });
    const nav = await page.evaluate(() => {
      const el = document.querySelector('[data-osc="nav.sequencer"]');
      const g = el && el.closest('[data-osc-nav-group]');
      return g && el.offsetParent === null ? g.dataset.oscNavGroup : null;
    });
    if (nav) await page.click(`[data-osc="nav-group.${nav}"]`);
    await page.click('[data-osc="nav.sequencer"]');
    await until(() => page.evaluate(() => window.OSCILLA.app.workspace === 'sequencer'),
      { ms: PANEL_MS, what: 'sequencer panel: the Sequencer workspace is shown' });
    const reference = await page.evaluate(() => JSON.parse(JSON.stringify(
      window.OSCILLA.labs.sequencer.editor.model)));
    const total = (s) => s.blocks.reduce((t, b) => t + b.ms, 0) / 1000;

    // Play from the start: the sequence sounds and the transport and status bar say so.
    await page.click('#osc-seq-start');
    let s = await poll((x) => x.playing && x.appPlaying && x.peak > 0.005, 'playing from Start');
    check(engine, '(e) Play from the start (#osc-seq-start) plays: model, transport, output',
      !s.timeout && s.aria.play === 'true' && s.status.label === 'PLAYING',
      JSON.stringify(s.timeout ? s : { peak: s.peak, aria: s.aria, status: s.status }));
    await page.click('#osc-seq-stop');
    await poll((x) => !x.playing, 'stopped');

    // Loop on: the sequence plays past the end of its first pass, and says it loops; Loop off
    // by keyboard: it ends after the pass that sounds.
    await page.click('#osc-seq-record');
    s = await poll((x) => x.loop && x.aria.loop === 'true', 'Loop pressed');
    check(engine, '(e) Loop (#osc-seq-record) by pointer sets the model and its pressed state',
      !s.timeout, JSON.stringify(s.timeout ? s : { loop: s.loop, aria: s.aria.loop }));
    await page.click('#osc-seq-start');
    const first = await poll((x) => x.playing && x.pass, 'the first looped pass');
    // A second pass has started on the audio clock and sounds. (The status bar's "(loop)" is
    // not judged here: it follows the model only on some engines, plan issue C004.)
    const looped = first.timeout ? first : await poll((x) => x.playing && x.pass
      && x.pass.t0 >= first.pass.t0 + total(x) - 0.01 && x.now > x.pass.t0 + 0.05
      && x.peak > 0.005, 'a second pass sounds');
    check(engine, '(e) a looped sequence starts a second pass and sounds past the first',
      !looped.timeout, JSON.stringify(looped.timeout ? looped : { peak: looped.peak,
        second: +(looped.pass.t0 - first.pass.t0).toFixed(3) }));
    await page.focus('#osc-seq-record');
    await page.keyboard.press('Enter');
    s = await poll((x) => !x.loop && x.aria.loop === 'false' && !x.playing && !x.appPlaying,
      'the sequence ends after Loop off');
    check(engine, '(e) Loop off by keyboard: the playing sequence ends after its pass',
      !s.timeout, JSON.stringify(s.timeout ? s : { loop: s.loop, playing: s.playing }));

    // The Selected block fields, on the first Sweep (selected at start): each edit reaches the
    // model, the block's label on the timeline and the rendered WAV.
    await page.click('#osc-seq-block-b2');
    const fields = [
      ['#osc-seq-start-hz', 'start', '500', 500, async () => {
        await page.fill('#osc-seq-start-hz', '500'); await page.press('#osc-seq-start-hz', 'Tab'); }],
      ['#osc-seq-end-hz', 'end', '1000', 1000, async () => {
        await page.focus('#osc-seq-end-hz'); await page.keyboard.press('ControlOrMeta+a');
        await page.keyboard.type('1000'); await page.keyboard.press('Tab'); }],
      ['#osc-seq-duration', 'durationMs', '750', 750, async () => {
        await page.fill('#osc-seq-duration', '750'); await page.press('#osc-seq-duration', 'Tab'); }],
      ['#osc-seq-curve', 'curve', 'linear', 'linear', () => page.selectOption('#osc-seq-curve', 'linear')],
    ];
    for (const [sel, key, , want, act] of fields) {
      const before = (await state()).blocks.find((b) => b.id === 'b2').label;
      await act();
      s = await poll((x) => {
        const b = x.blocks.find((y) => y.id === 'b2');
        const v = key === 'durationMs' ? b.ms : b.p[key];
        return v === want && (key === 'curve' || b.label !== before);
      }, `${sel} reaches block b2`);
      check(engine, `(e) ${sel} reaches the block and its timeline label`, !s.timeout,
        JSON.stringify(s.timeout ? s : s.blocks.find((b) => b.id === 'b2')));
    }
    let wav = await exportWav();
    s = await state();
    const b2At = s.blocks[0].ms / 1000; // b1 (tone, 500 ms) then b2
    const sweepAt = (u) => freqAt(wav, b2At + 0.03 + u * (0.75 - 0.06));
    const f0 = sweepAt(0);
    const fMid = freqAt(wav, b2At + 0.375);
    const f1 = sweepAt(1);
    // A linear 500 -> 1000 Hz sweep is at 750 Hz half way (a log one would be at 707 Hz).
    // The render is the sequence plus its release tail, which no edit changes.
    const tail = (w, x) => w.samples.length / w.sampleRate - total(x);
    check(engine, '(e) the WAV renders the edited block: 500 -> 1000 Hz, linear, 750 ms',
      wav && tail(wav, s) >= 0 && tail(wav, s) < 0.25
        && near(f0, 500 + 500 * (0.03 / 0.75), 25) && near(fMid, 750, 20)
        && near(f1, 1000 - 500 * (0.03 / 0.75), 25),
      `length ${(wav.samples.length / wav.sampleRate).toFixed(3)} s (model ${total(s)} s), `
        + `${f0.toFixed(0)} / ${fMid.toFixed(0)} / ${f1.toFixed(0)} Hz`);

    // Move later: the Tone b1, selected on the timeline, moves after b2; the timeline and the
    // render follow.
    await page.click('#osc-seq-block-b1');
    await page.click('#osc-seq-move-later');
    s = await poll((x) => x.blocks[0].id === 'b2' && x.blocks[1].id === 'b1'
      && x.blocks[1].x > x.blocks[0].x, 'b1 moved after b2');
    wav = s.timeout ? null : await exportWav();
    const toneF = wav ? freqAt(wav, 0.75 + 0.25) : null;
    const leadF = wav ? freqAt(wav, 0.03) : null;
    check(engine, '(e) Move later (#osc-seq-move-later): model order, timeline, the WAV',
      !s.timeout && near(toneF, 440, 15) && near(leadF, 500 + 500 * (0.03 / 0.75), 25),
      JSON.stringify(s.timeout ? s : { order: s.blocks.map((b) => b.id), toneF, leadF }));

    // Tempo: a tempo-locked sequence (the config import's path) follows the BPM chosen.
    const version = reference.version;
    await page.evaluate((v) => window.OSCILLA.labs.sequencer.update({ sequence: { version: v,
      tempoBpm: 120, loop: false, waveform: 'sine', blocks: [
        { id: 't1', type: 'tone', beats: 2, durationMs: 1000, params: { freq: 440 } },
        { id: 't2', type: 'tone', beats: 1, durationMs: 500, params: { freq: 880 } }] } }),
    version);
    await page.selectOption('#osc-seq-tempo', '120');
    const at120 = await exportWav();
    await page.selectOption('#osc-seq-tempo', '60');
    s = await poll((x) => x.tempo === 60 && x.blocks[0].ms === 2000 && x.blocks[1].ms === 1000
      && /2\.00 s/.test(x.blocks[0].label || ''), 'Tempo 60 rescales the tempo-locked blocks');
    wav = s.timeout ? null : await exportWav();
    // 120 -> 60 BPM doubles the 1.5 s of tempo-locked blocks: the render is 1.5 s longer.
    const longer = wav ? (wav.samples.length - at120.samples.length) / wav.sampleRate : null;
    check(engine, '(e) Tempo (#osc-seq-tempo) 60 BPM: model, timeline label, the render',
      !s.timeout && s.tempoSelect === '60' && near(longer, 1.5, 0.02)
        && near(freqAt(wav, 2.5), 880, 20) && near(freqAt(at120, 1.25), 880, 20),
      JSON.stringify(s.timeout ? s : { tempo: s.tempo, ms: s.blocks.map((b) => b.ms),
        longer }));
    await page.selectOption('#osc-seq-tempo', '120');
    await page.evaluate((m) => window.OSCILLA.labs.sequencer.update({ sequence: m }), reference);
    check(engine, '(e) no page errors in the sequencer panel', errors.length === 0,
      errors.slice(0, 3).join(' | '));
  } finally {
    await context.close();
  }
}

// ---------------------------------------------------------------- run

async function runEngine(engine, bundle) {
  console.log(`\n${engine}`);
  const launch = {
    chromium: { args: ['--autoplay-policy=no-user-gesture-required'] },
    firefox: {
      firefoxUserPrefs: { 'media.autoplay.default': 0, 'media.autoplay.block-webaudio': false },
    },
    webkit: {},
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
    await page.waitForFunction(() => window.seqFixtureReady === true, null,
      { timeout: 30000 });
    const native = await page.evaluate(() => window.seqFixture.hasCancelAndHold());
    console.log(`  (cancelAndHoldAtTime native: ${native})`);

    // (a) + (b) offline renders.
    // timing-allow: the second OfflineAudioContext render rate, on purpose not the first
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
    // Growth is judged per restart once the earlier passes' `ended` events have arrived (the
    // fixture waits up to 1 s for them): no source of an earlier pass is still live and the
    // editor holds exactly the current voice. Counting before that delivery measured event
    // latency under load, not growth. A source that is never stopped stays foreign.
    const many = await page.evaluate(() => window.seqFixture.restartMany(20, 60));
    const perPass = 4; // carrier + siren LFO + AM LFO + FM modulator (random/burst have none)
    const pr = many.perRestart;
    const maxOf = (k) => Math.max(...pr.map((p) => p[k]));
    const grown = pr.findIndex((p) => p.foreign !== 0 || p.voices !== 1 || p.live > perPass);
    check(
      engine,
      '(d) restart 20x without growth',
      grown === -1 &&
        pr.every((p) => p.started === perPass) &&
        many.after.live === 0 &&
        many.after.started === many.after.ended &&
        many.after.stats.voices === 0 &&
        many.after.started === 20 * perPass,
      (grown === -1 ? 'settled: ' : `restart ${grown + 1} grew: ${JSON.stringify(pr[grown])}; `) +
        `max foreign ${maxOf('foreign')}, max voices ${maxOf('voices')}, ` +
        `max live ${maxOf('live')} (unsettled: voices ${maxOf('rawVoices')}, ` +
        `live ${maxOf('rawLive')}), slowest settle ${maxOf('settledMs')} ms, ` +
        `started ${many.after.started}, ended ${many.after.ended}, live after ${many.after.live} ` +
        `(${many.after.waitedMs} ms)`,
    );
    const final = await page.evaluate(() => window.seqFixture.realtimeTeardown());
    check(engine, 'no live sources after teardown', final.live === 0, JSON.stringify(final));
    check(engine, 'no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
    await panelChecks(engine, browser);
  } finally {
    await browser.close();
  }
}

(async () => {
  await RUN.ready();
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
