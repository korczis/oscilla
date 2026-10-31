#!/usr/bin/env node
// OSCILLA V2 pattern sequencer: browser checks against the real Web Audio implementation.
//
//   NODE_PATH=<checkout>/tests/node_modules node tests/browser/sequencer.cjs
//   node tests/browser/sequencer.cjs --browser firefox     # chromium | firefox | webkit (default: all)
//   node tests/browser/sequencer.cjs --dist <path/to/index.html>   # the app of check (e)
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
//       (bounded wait), none of their sources is live and only the current voice remains;
//   (e) the Sequencer panel of dist/index.html (file://), driven by pointer and keyboard: Tempo
//       (BPM), Loop, the timeline selection, the Sweep's Start, End, Duration and Curve fields,
//       Move later and earlier, Add block (pointer and keyboard) and Delete, Play from the start,
//       Stop and Play, each judged in the editor model and in the rendered timeline or the
//       transport's state, and the transport also by the engine's output level;
//   (f) seq-filter-reaches-sequence (C003), in the built dist/index.html (file://, 1536x1024):
//       a looping 4 kHz Tone block, played with #osc-seq-play, drops by more than 20 dB once
//       the Filter Lab's switch turns on a 200 Hz low-pass set through #osc-filter-cutoff-value;
//       a cutoff edit during playback applies to the next reading; the engine counts the
//       sequencer's nodes while it sounds and holds 0 after Stop and after Escape; the exported
//       WAV of the sequence (OfflineAudioContext) is attenuated by more than 20 dB as well.
//   seq-add-menu-pointer (C005, finding control-census-6): in the built app (dist/index.html
//       from file://), at 1536x1024, 1920x1080 and 1280x800 and with the safety notice shown
//       and dismissed, the point under the centre of every Add block menu item is that item and
//       a real mouse click there adds a block of that type (the upward grid menu was clipped
//       by the scrolling .osc-main, so Tone and Silence could not be clicked).
// Exit code 0 only when every check passes in every browser.
'use strict';

const path = require('path');
const { pathToFileURL } = require('url');
const esbuild = require('esbuild');
const suite = require('./lib/suite.cjs');
const { until, WaitTimeout } = require('./lib/wait.cjs');

const args = process.argv.slice(2);
const only = args.includes('--browser') ? args[args.indexOf('--browser') + 1] : null;
const RUN = suite.open({ name: 'sequencer', browsers: only === null ? undefined : only });
const playwright = RUN.playwright;
const ENGINES = RUN.browsers;
const FIXTURE = path.join(__dirname, 'fixtures', 'sequencer-fixture.js');
const DIST = path.resolve(args.includes('--dist') ? args[args.indexOf('--dist') + 1]
  : path.join(__dirname, '..', '..', 'dist', 'index.html'));
// The visual reference size and two common desktop sizes (C005).
const ADD_MENU_VIEWPORTS = [[1536, 1024], [1920, 1080], [1280, 800]];
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

// ---------------------------------------------------------------- (e) the panel in dist

/** The sequencer panel's state: the editor model, the rendered timeline, the transport. */
function panelState() {
  const O = window.OSCILLA;
  const ed = O.labs.sequencer.editor;
  const q = (s) => document.querySelector(s);
  const e = O.engine;
  let peak = 0;
  if (e.analyser) {
    const d = new Float32Array(e.analyser.fftSize);
    e.analyser.getFloatTimeDomainData(d);
    for (let i = 0; i < d.length; i++) peak = Math.max(peak, Math.abs(d[i]));
  }
  const st = ed.stats();
  return { playing: ed.playing, loop: ed.model.loop, tempo: ed.model.tempoBpm, error: ed.error,
    selected: ed.selectedId, ids: ed.model.blocks.map((b) => b.id),
    blocks: ed.model.blocks.map((b) => ({ id: b.id, type: b.type, ms: b.durationMs,
      p: { ...b.params } })),
    dom: [...document.querySelectorAll('#osc-seq-timeline [data-block-id]')].map((b) => ({
      id: b.dataset.blockId, label: b.getAttribute('aria-label'),
      selected: b.getAttribute('aria-selected') })),
    playAria: q('#osc-seq-play').getAttribute('aria-pressed'),
    loopAria: q('#osc-seq-record').getAttribute('aria-pressed'),
    tempoValue: q('#osc-seq-tempo').value,
    appPlaying: O.app.seqPlaying, sources: st.activeSourceCount, peak };
}

async function panelChecks(engine, browser) {
  const page = await browser.newPage({ viewport: { width: 1536, height: 1024 } });
  page.setDefaultTimeout(8000);
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(pathToFileURL(DIST).href);
  await page.waitForSelector('html[data-ready="true"]', { timeout: 30000 });
  const item = '[data-osc="nav.sequencer"]';
  if (await page.evaluate((s) => document.querySelector(s).offsetParent === null, item)) {
    const group = await page.evaluate((s) => document.querySelector(s)
      .closest('[data-osc-nav-group]').dataset.oscNavGroup, item);
    await page.click(`[data-osc="nav-group.${group}"]`);
  }
  await page.click(item);
  const P = () => page.evaluate(panelState);
  const block = (s, id) => s.blocks.find((b) => b.id === id);
  const dom = (s, id) => s.dom.find((b) => b.id === id) || { label: '' };
  const sameOrder = (s) => s.dom.map((b) => b.id).join() === s.ids.join();
  /** One check: poll the panel until test holds (a named wall-clock deadline), then record. */
  const step = async (label, test, ms = 8000) => {
    let last;
    try {
      await until(async () => {
        last = await P();
        return test(last);
      }, { ms, what: `sequencer panel: ${label}` });
      check(engine, `(e) panel: ${label}`, true, '');
    } catch (err) {
      check(engine, `(e) panel: ${label}`, false,
        `${err.message}; last ${JSON.stringify(last).slice(0, 600)}`);
    }
    return last;
  };
  const s0 = await step('the reference sequence is shown', (s) => s.ids.length === 5
    && sameOrder(s) && s.tempo === 120 && !s.playing);
  // BPM: the tempo select sets the model's tempo (blocks timed in milliseconds keep their
  // length: PACK 03 control-census-1 is a separate finding)
  await page.selectOption('#osc-seq-tempo', '90');
  await step('Tempo 90 BPM reaches the model', (s) => s.tempo === 90 && s.tempoValue === '90'
    && !s.error);
  await page.selectOption('#osc-seq-tempo', '120');
  await step('Tempo 120 BPM again', (s) => s.tempo === 120 && s.tempoValue === '120');
  // Loop: pointer, then keyboard
  await page.click('#osc-seq-record');
  await step('Loop on by pointer', (s) => s.loop === !s0.loop && s.loopAria === String(s.loop));
  await page.focus('#osc-seq-record');
  await page.keyboard.press('Enter');
  await step('Loop off by keyboard', (s) => s.loop === s0.loop && s.loopAria === String(s.loop));
  // selection on the timeline: a block by pointer, then the arrow keys
  await page.click('#osc-seq-block-b2');
  await step('block b2 selected by pointer', (s) => s.selected === 'b2'
    && dom(s, 'b2').selected === 'true');
  await page.focus('#osc-seq-timeline');
  await page.keyboard.press('ArrowRight');
  await step('the timeline ArrowRight selects b3', (s) => s.selected === 'b3'
    && dom(s, 'b3').selected === 'true');
  await page.keyboard.press('ArrowLeft');
  await step('the timeline ArrowLeft selects b2', (s) => s.selected === 'b2');
  // the selected Sweep's fields reach the model and the block's label and width
  await page.fill('#osc-seq-start-hz', '500');
  await page.press('#osc-seq-start-hz', 'Enter');
  await page.fill('#osc-seq-end-hz', '1000');
  await page.press('#osc-seq-end-hz', 'Enter');
  await step('Start 500 Hz, End 1000 Hz', (s) => block(s, 'b2').p.start === 500
    && block(s, 'b2').p.end === 1000 && /500/.test(dom(s, 'b2').label)
    && /1(000| k)/.test(dom(s, 'b2').label));
  await page.fill('#osc-seq-duration', '750');
  await page.press('#osc-seq-duration', 'Enter');
  await step('Duration 750 ms', (s) => block(s, 'b2').ms === 750
    && /0\.75 s/.test(dom(s, 'b2').label));
  await page.selectOption('#osc-seq-curve', 'linear');
  await step('Curve linear', (s) => block(s, 'b2').p.curve === 'linear');
  // reorder
  await page.click('#osc-seq-move-later');
  await step('Move later', (s) => s.ids.indexOf('b2') === 2 && sameOrder(s));
  await page.click('#osc-seq-move-earlier');
  await step('Move earlier', (s) => s.ids.indexOf('b2') === 1 && sameOrder(s));
  // add by pointer (a Sweep) and by keyboard (the menu's first item), then delete both
  await page.click('#osc-seq-add');
  await page.click('[data-osc="seq.addType"][data-value="sweep"]');
  const added = await step('Add block Sweep by pointer', (s) => s.ids.length === 6
    && block(s, s.selected) && block(s, s.selected).type === 'sweep' && sameOrder(s));
  await page.focus('#osc-seq-add');
  await page.keyboard.press('Enter');
  await until(() => page.evaluate(() => document.activeElement
    && document.activeElement.getAttribute('role') === 'menuitem'),
  { ms: 5000, what: 'sequencer panel: the Add block menu takes the focus' });
  await page.keyboard.press('Enter');
  await step('Add block by keyboard', (s) => s.ids.length === 7 && block(s, s.selected)
    && block(s, s.selected).type === 'tone' && sameOrder(s));
  await page.click('#osc-seq-delete');
  await page.click(`#osc-seq-block-${added.selected}`);
  await page.click('#osc-seq-delete');
  await step('Delete both added blocks', (s) => s.ids.join() === 'b1,b2,b3,b4,b5' && sameOrder(s));
  // transport: start, stop, play; the sound and the status follow
  await page.click('#osc-seq-start');
  await step('Play from the start sounds', (s) => s.playing && s.appPlaying
    && s.playAria === 'true' && s.peak > 0.005);
  await page.click('#osc-seq-stop');
  await step('Stop leaves no source', (s) => !s.playing && s.sources === 0
    && s.playAria === 'false');
  await page.click('#osc-seq-play');
  await step('Play sounds', (s) => s.playing && s.peak > 0.005);
  await page.click('#osc-seq-stop');
  await step('Stop again leaves no source', (s) => !s.playing && s.sources === 0);
  check(engine, '(e) panel: no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  await page.close();
}

// ---------------------------------------------------------------- (f) the app (C003)

const dB = (x) => 20 * Math.log10(Math.max(x, 1e-12));
const FILTER_DROP_DB = 20; // the acceptance bound: the 200 Hz low-pass takes > 20 dB off 4 kHz

/**
 * Poll `read` until `judge` holds, against a named wall-clock deadline (lib/wait.cjs). Returns
 * { ok, value }: the last reading either way, so a failed check reports what it measured.
 */
async function settle(read, judge, ms, what) {
  let value;
  try {
    await until(async () => {
      value = await read();
      return judge(value);
    }, { ms, what });
    return { ok: true, value };
  } catch (e) {
    if (e instanceof WaitTimeout) return { ok: false, value };
    throw e;
  }
}

async function runApp(engine, browser) {
  const C = 'seq-filter-reaches-sequence';
  const context = await browser.newContext({ viewport: { width: 1536, height: 1024 } });
  const errors = [];
  try {
    await context.addInitScript(() => {
      try {
        sessionStorage.setItem('oscilla.safetyNoticeCollapsed', '1');
      } catch (e) {
        /* storage blocked: the notice stays, the controls are still reachable */
      }
    });
    const page = await context.newPage();
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto(pathToFileURL(DIST).href);
    await until(() => page.evaluate(() => document.documentElement.dataset.ready === 'true'),
      { ms: 30000, what: `${C}: the app is ready` });
    // The finding's sequence: one looping 4 kHz sine Tone block.
    await page.evaluate(() => {
      const seq = window.OSCILLA.labs.sequencer;
      seq.editor.load({ tempoBpm: 120, loop: true, waveform: 'sine',
        blocks: [{ id: 't1', type: 'tone', durationMs: 1000, params: { freq: 4000 } }] });
      seq.render();
      window.__c003Rms = () => {
        const an = window.OSCILLA.engine.analyser;
        if (!an) return 0;
        const d = new Float32Array(an.fftSize);
        an.getFloatTimeDomainData(d);
        let s = 0;
        for (let i = 0; i < d.length; i++) s += d[i] * d[i];
        return Math.sqrt(s / d.length);
      };
    });
    const state = () => page.evaluate(() => {
      const o = window.OSCILLA;
      return { rms: window.__c003Rms(), playing: o.labs.sequencer.editor.playing,
        nodes: o.engine.activeNodeCount, sources: o.engine.activeSourceCount,
        filter: o.labs.filter.config };
    });
    const filterOn = () => page.$eval('#osc-filter-enable',
      (el) => el.getAttribute('aria-checked') === 'true');
    const setFilter = async (on) => {
      if ((await filterOn()) !== on) await page.click('#osc-filter-enable');
      return settle(state, (s) => s.filter.enabled === on, 3000, `${C}: Filter switch ${on}`);
    };
    const setCutoff = async (hz) => {
      await page.fill('#osc-filter-cutoff-value', String(hz));
      await page.press('#osc-filter-cutoff-value', 'Enter');
      return settle(state, (s) => Math.abs(s.filter.frequency - hz) < 0.5, 3000,
        `${C}: the cutoff field sets ${hz} Hz`);
    };

    await page.click('#osc-ftype-lowpass');
    await setFilter(false);
    const cut = await setCutoff(200);
    check(engine, `${C}: low-pass at 200 Hz set through #osc-filter-cutoff-value`,
      cut.ok && cut.value.filter.type === 'lowpass', JSON.stringify(cut.value.filter));

    // Filter off: the reference level of the sounding sequence.
    // The reading is taken once two successive analyser windows agree within 0.5 dB, so the
    // reference is the steady tone and not a window that still holds the start.
    await page.click('#osc-seq-play');
    let prev = 0;
    const off = await settle(state, (s) => {
      const steady = s.playing && s.rms > 0.005 && Math.abs(dB(s.rms) - dB(prev)) < 0.5;
      prev = s.rms;
      return steady;
    }, 6000, `${C}: the sequence sounds steadily after Play`);
    check(engine, `${C}: the sequence sounds and the engine counts it`,
      off.ok && off.value.nodes > 0 && off.value.sources > 0,
      `rms ${off.value && off.value.rms.toExponential(2)}, engine nodes `
        + `${off.value && off.value.nodes}, sources ${off.value && off.value.sources}`);
    const ref = off.value ? off.value.rms : 0;

    // Filter on while it plays: more than 20 dB down.
    await setFilter(true);
    const on = await settle(state, (s) => dB(s.rms) < dB(ref) - FILTER_DROP_DB, 4000,
      `${C}: the 200 Hz low-pass attenuates the sequence`);
    check(engine, `${C}: Filter on attenuates the looping 4 kHz sequence by > ${FILTER_DROP_DB} dB`,
      on.ok && on.value.playing,
      `${(dB(on.value.rms) - dB(ref)).toFixed(1)} dB (off ${dB(ref).toFixed(1)} dBFS, `
        + `on ${dB(on.value.rms).toFixed(1)} dBFS)`);

    // A cutoff edit during playback reaches the sounding stage, both ways.
    await setCutoff(12000);
    const open = await settle(state, (s) => dB(s.rms) > dB(ref) - 3, 4000,
      `${C}: a 12 kHz cutoff lets the 4 kHz sequence through`);
    await setCutoff(200);
    const shut = await settle(state, (s) => dB(s.rms) < dB(ref) - FILTER_DROP_DB, 4000,
      `${C}: back to 200 Hz attenuates again`);
    check(engine, `${C}: cutoff edits during playback apply to the next reading`,
      open.ok && shut.ok && shut.value.playing,
      `12 kHz ${(dB(open.value.rms) - dB(ref)).toFixed(1)} dB, `
        + `200 Hz ${(dB(shut.value.rms) - dB(ref)).toFixed(1)} dB`);

    // Stop: the census returns to zero.
    await page.click('#osc-seq-stop');
    const stopped = await settle(state, (s) => !s.playing && s.nodes === 0 && s.sources === 0,
      4000, `${C}: engine census 0 after Stop`);
    check(engine, `${C}: engine node count 0 after Stop`, stopped.ok,
      `playing ${stopped.value.playing}, nodes ${stopped.value.nodes}, `
        + `sources ${stopped.value.sources}`);

    // Escape: the same, from the app's key handler (it stops once seqPlaying is mirrored).
    await page.click('#osc-seq-play');
    const again = await settle(() => page.evaluate(() => ({
      seq: window.OSCILLA.app.seqPlaying, nodes: window.OSCILLA.engine.activeNodeCount })),
    (s) => s.seq && s.nodes > 0, 4000, `${C}: the sequence plays again`);
    await page.keyboard.press('Escape');
    const escaped = await settle(state, (s) => !s.playing && s.nodes === 0 && s.sources === 0,
      4000, `${C}: engine census 0 after Escape`);
    check(engine, `${C}: engine node count 0 after Escape`, again.ok && escaped.ok,
      `played ${again.ok}, playing ${escaped.value.playing}, nodes ${escaped.value.nodes}, `
        + `sources ${escaped.value.sources}`);

    // The exported WAV of the sequence goes through the same Filter stage (offline).
    const wavRms = async (enabled) => {
      await setFilter(enabled);
      return page.evaluate(async () => {
        const r = await window.OSCILLA.app.exportAudio('sequence');
        if (!r) return null;
        const d = r.buffer.getChannelData(0);
        const from = Math.floor(d.length * 0.25);
        const to = Math.floor(d.length * 0.75);
        let s = 0;
        for (let i = from; i < to; i++) s += d[i] * d[i];
        return Math.sqrt(s / (to - from));
      });
    };
    const wavOff = await wavRms(false);
    const wavOn = await wavRms(true);
    check(engine, `${C}: the exported WAV is attenuated by > ${FILTER_DROP_DB} dB as well`,
      wavOff > 0.005 && wavOn !== null && dB(wavOn) < dB(wavOff) - FILTER_DROP_DB,
      `off ${wavOff === null ? 'failed' : dB(wavOff).toFixed(1)} dBFS, `
        + `on ${wavOn === null ? 'failed' : dB(wavOn).toFixed(1)} dBFS`);
    check(engine, `${C}: no page errors`, errors.length === 0, errors.slice(0, 3).join(' | '));
  } finally {
    await context.close();
  }
}

// ---------------------------------------------------------------- Add block menu (C005)

/** Open the Add block menu, hit-test one item's centre and click it with the mouse. */
async function clickAddItem(page, type) {
  const item = `[data-osc="seq.addType"][data-value="${type}"]`;
  await page.click('#osc-seq-add');
  await until(() => page.evaluate((s) => {
    const e = document.querySelector(s);
    return !!e && e.offsetParent !== null && e.getBoundingClientRect().height > 0;
  }, item), { ms: 5000, what: `seq-add-menu-pointer: the ${type} item is shown` });
  const at = await page.evaluate((s) => {
    const e = document.querySelector(s);
    const b = e.getBoundingClientRect();
    const x = b.x + b.width / 2;
    const y = b.y + b.height / 2;
    const hit = document.elementFromPoint(x, y);
    const ed = window.OSCILLA.labs.sequencer.editor;
    const name = (h) => `${h.tagName.toLowerCase()}${h.id ? `#${h.id}` : ''}.${h.className}`;
    const under = hit === e ? 'the item' : hit ? name(hit) : 'nothing';
    return { x, y, under, n: ed.model.blocks.length };
  }, item);
  await page.mouse.click(at.x, at.y);
  const read = () => page.evaluate(() => {
    const ed = window.OSCILLA.labs.sequencer.editor;
    const b = ed.model.blocks.find((x) => x.id === ed.selectedId);
    const menu = document.querySelector('#osc-seq-add-menu');
    return { n: ed.model.blocks.length, type: b ? b.type : null, open: !menu.hidden };
  });
  let after = await read();
  if (at.under === 'the item') {
    after = await until(async () => {
      const r = await read();
      return r.n === at.n + 1 && !r.open ? r : null;
    }, { ms: 5000, what: `seq-add-menu-pointer: a click on ${type} adds a block` })
      .catch(() => read());
  }
  // A click that missed the item leaves the menu open (or opens nothing); close it either way.
  if (after.open) await page.keyboard.press('Escape');
  return {
    under: at.under,
    added: at.under === 'the item' && after.n === at.n + 1 && after.type === type,
    y: Math.round(at.y),
  };
}

async function checkAddMenuPointer(engine, browser) {
  for (const [width, height] of ADD_MENU_VIEWPORTS) {
    const context = await browser.newContext({ viewport: { width, height } });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    try {
      await page.goto(`${pathToFileURL(DIST).href}#m=sequencer`, { waitUntil: 'load' });
      await page.waitForSelector('html[data-ready="true"]', { timeout: 30000 });
      await until(() => page.evaluate(() => {
        const app = document.querySelector('#osc-app');
        return !!(app && app.dataset.mode === 'sequencer' && window.OSCILLA
          && window.OSCILLA.labs && window.OSCILLA.labs.sequencer);
      }), { ms: 10000, what: 'seq-add-menu-pointer: the Sequencer workspace is shown' });
      const types = await page.evaluate(() => [...document
        .querySelectorAll('[data-osc="seq.addType"]')].map((b) => b.dataset.value));
      const missed = [];
      // The safety notice is shown on a first run; every item is tried with it shown.
      const miss = (type, r, notice) =>
        `${type} (notice ${notice}; under the pointer: ${r.under}, y ${r.y})`;
      for (const type of types) {
        const r = await clickAddItem(page, type);
        if (!r.added) missed.push(miss(type, r, 'shown'));
      }
      // Dismissed, the header moves up; the first row (Tone, Silence) is tried again.
      const dismiss = await page.$('#osc-safety-dismiss');
      if (dismiss && (await dismiss.isVisible())) {
        await dismiss.click();
        for (const type of types.slice(0, 2)) {
          const r = await clickAddItem(page, type);
          if (!r.added) missed.push(miss(type, r, 'dismissed'));
        }
      }
      check(
        engine,
        `seq-add-menu-pointer ${width}x${height}: a mouse click on every Add block item adds it`,
        types.length === 10 && missed.length === 0 && errors.length === 0,
        missed.length || errors.length
          ? [...missed, ...errors.slice(0, 2).map((e) => `page error: ${e}`)].join('; ')
          : `${types.join(', ')} each added by a pointer click`,
      );
    } finally {
      await context.close();
    }
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
    await page.close();

    // (f) C003 in the built app.
    try {
      await runApp(engine, browser);
    } catch (e) {
      check(engine, 'seq-filter-reaches-sequence: run', false, String(e && e.stack ? e.stack : e));
    }
    await checkAddMenuPointer(engine, browser);
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
