#!/usr/bin/env node
// OSCILLA user journeys (C021, PACK 03 "One Instrument, One Coherent State") on the built
// dist/index.html (file://) in chromium, firefox and webkit. One fresh page per check. Each
// journey drives the controls a user drives (pointer and keyboard on the page; never a lab's
// update function) and judges the state that results where it lives: the AudioEngine voice and
// its nodes, the live filter stage, the output level of the tone on the engine's post-chain
// analyser, the analysis readouts, the sequencer model, the Studio store and runtime, MEASURE,
// and every view that reflects them.
//
//   node tests/browser/journeys.cjs [--dist dist/index.html] [--browsers chromium,firefox,webkit]
//                                   [--only journey-1-start:instrument,...]
//
// Journeys (the owner's brief, items 1-6):
//   journey-1-start:*     set parameters through the UI and start: instrument, sequencer,
//                         Studio, MEASURE
//   journey-2-live:*      change parameters while sounding: frequency, waveform, gain, filter
//                         type/cutoff/Q, Additive, Studio Inspector; envelope, pan, hard limit,
//                         sequencer filter (expected failures, see below)
//   journey-3-views:*     the status bar, the readouts, the Signal Path, the Spectrum and the
//                         controls agree with the engine
//   journey-4-restart:*   ten stop/restart cycles of the instrument, the sequencer and the
//                         Studio with a node census each time (the engine's own counts and an
//                         independent census of every started source of the page's realtime
//                         AudioContext); hand-overs between owners
//   journey-5-persist:*   save, restore and compare through the config link (URL), a custom
//                         preset, the config file, a Studio project in the library, and a saved
//                         experiment
//   journey-6-refusals:*  invalid input and invalid transitions are refused with a message that
//                         names the field or the reason, and the model is left unchanged
//
// Expected failures. A journey that fails today because of a confirmed PACK 03 finding whose fix
// pull request is still open carries `xfail: { finding, issue, pr }`. Its check splits what must
// hold already (a failure there is a FAIL) from the one assertion the finding breaks: only that
// assertion failing is reported as XFAIL. When it passes, the check reports XPASS and fails the
// suite, so the mark is removed in the change that lands the fix (or right after it).
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const suite = require('./lib/suite.cjs');
const { until, bounded } = require('./lib/wait.cjs');
const op = require('./lib/oscilla-page.cjs');
const seam = require('./lib/measure-seam.cjs');

const argv = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};
const ROOT = path.resolve(__dirname, '..', '..');
const DIST = path.resolve(arg('dist', path.join(ROOT, 'dist', 'index.html')));
const RUN = suite.open({ name: 'journeys', browsers: arg('browsers') });
const playwright = RUN.playwright;
const ONLY = arg('only', '') ? new Set(arg('only', '').split(',')) : null;

const STEP_MS = 10000;   // one condition of a journey (a glide is 15-50 ms of audio)
const CHECK_MS = 240000; // one whole journey
const CYCLES = 10;       // stop/restart cycles of journey 4
const SHORT = { duration: 1, repeats: 1, noiseCheckS: 0.5, preRollS: 0.25, postRollS: 0.5,
  gapS: 0.2 };
const RUN_MS = 60000;    // one loopback measurement on a loaded machine

class Defect extends Error {}

// ------------------------------------------------------------------------------ helpers
/** Assert; a failure names what was expected and what was read. */
function must(cond, what, got) {
  if (!cond) throw new Error(`${what}${got === undefined ? '' : ` (read ${
    op.clip(JSON.stringify(got), 400)})`}`);
}
/** The one assertion an expected failure is about. */
function defect(cond, what, got) {
  if (!cond) throw new Defect(`${what}${got === undefined ? '' : ` (read ${
    op.clip(JSON.stringify(got), 400)})`}`);
}
/**
 * Poll the condition an expected failure is about until its deadline: the value when it holds,
 * a Defect naming it (with the last value read) when it does not.
 */
async function defectUntil(read, ok, what, ms = STEP_MS) {
  let last;
  try {
    return await until(async () => { last = await read(); return ok(last) ? last : null; },
      { ms, what });
  } catch (e) {
    throw new Defect(`${String(e.message).split('\n')[0]} (read ${op.clip(JSON.stringify(last),
      400)})`);
  }
}
const near = (x, y, tol) => Number.isFinite(x) && Number.isFinite(y) && Math.abs(x - y) <= tol;
const snap = (page) => page.evaluate(op.snapshot);
/** Poll the snapshot until `pred(s)`; returns it. */
function waitSnap(page, pred, what, ms = STEP_MS) {
  return until(async () => { const s = await snap(page); return pred(s) ? s : null; },
    { ms, what });
}

/**
 * Census of every source node started on the page's realtime AudioContexts (oscillators,
 * buffer and constant sources), whoever started it: the engine, the sequencer, the Studio
 * runtime or a measurement. A source counts from start() until its `ended` event. Installed
 * before the page's scripts run; independent of the engine's own accounting.
 */
const SOURCE_CENSUS = () => {
  const live = new Set();
  let base = new Set();
  let started = 0;
  const P = window.AudioScheduledSourceNode && window.AudioScheduledSourceNode.prototype;
  if (!P || !window.AudioContext) return;
  const start = P.start;
  P.start = function census(...args) {
    if (this.context instanceof window.AudioContext) {
      live.add(this);
      started++;
      this.addEventListener('ended', () => live.delete(this), { once: true });
    }
    return start.apply(this, args);
  };
  // The engine's idle output chain keeps sources of its own running (a constant source):
  // baseline() records what runs at rest, and `live` counts every source beyond it.
  Object.defineProperty(window, '__oscSources', {
    value: () => ({ live: [...live].filter((n) => !base.has(n)).length, started,
      idle: base.size }), configurable: false });
  Object.defineProperty(window, '__oscSourcesBaseline', {
    value: () => { base = new Set(live); return base.size; }, configurable: false });
};

async function open(browser, opts = {}) {
  const r = await op.openApp(browser, { dist: DIST, ...opts, init: SOURCE_CENSUS });
  // the idle output chain is running and nothing else sounds: that is the baseline
  await until(() => r.page.evaluate(() => window.OSCILLA.engine.activeSourceCount === 0
    && !window.OSCILLA.app.playing), { ms: STEP_MS, what: 'the page is at rest after boot' });
  await r.page.evaluate(() => window.__oscSourcesBaseline && window.__oscSourcesBaseline());
  return r;
}

const sources = (page) => page.evaluate(() => (window.__oscSources
  ? window.__oscSources() : { live: -1, started: -1 }));

/** Hold the instrument with the Space key on a non-typing focus (the global hold). */
async function holdSpace(page) {
  await page.evaluate(() => { if (document.activeElement) document.activeElement.blur(); });
  await page.keyboard.down('Space');
  return waitSnap(page, (s) => s.app.playing && !!s.engine.voice,
    'the instrument sounds while Space is held');
}
async function releaseSpace(page) {
  await page.keyboard.up('Space');
}

/** Allow continuous playback through its switch (Device & Limits, Playground). */
async function allowContinuous(page) {
  const on = await page.evaluate(() => window.OSCILLA.app.continuousAllowed);
  if (!on) await page.click('#osc-continuous-toggle');
  await waitSnap(page, (s) => s.app.continuous && s.aria.cont === 'true',
    'continuous playback allowed through its switch');
}

/** Commit a text field the way a user does: replace its text, then Enter. */
async function typeField(page, sel, text) {
  const l = page.locator(sel).first();
  await l.scrollIntoViewIfNeeded();
  await l.fill(text);
  await l.press('Enter');
}

/** Turn a switch to `on` through a click when it is not already there. */
async function setSwitch(page, sel, on) {
  const cur = await page.evaluate((s) => {
    const el = document.querySelector(s);
    const v = el.getAttribute('aria-checked') || el.getAttribute('aria-pressed');
    return v === 'true';
  }, sel);
  if (cur !== on) await page.locator(sel).first().click();
  await until(() => page.evaluate(([s, want]) => {
    const el = document.querySelector(s);
    return (el.getAttribute('aria-checked') || el.getAttribute('aria-pressed')) === String(want);
  }, [sel, on]), { ms: STEP_MS, what: `${sel} switched ${on ? 'on' : 'off'}` });
}

/** The live filter stage's response (dB) at `hz`: what the chart draws. */
const responseDb = (page, hz) => page.evaluate((f) => {
  const st = window.OSCILLA.labs.filter.stage;
  const r = st.getResponse(new Float32Array([f]));
  return r.magDb[0];
}, hz);

/** Run one loopback measurement through MEASURE's primary button; returns the end state. */
async function measureLoopback(page) {
  await op.navTo(page, 'measure');
  await seam.loopback(page, { values: SHORT });
  await page.click('#osc-measure-primary'); // Check setup
  const ready = await until(() => page.evaluate(() => {
    const st = window.OSCILLA.measure.state;
    return ['READY', 'INVALID', 'ERROR'].includes(st) ? st : null;
  }), { ms: RUN_MS, what: 'the setup check of the loopback ends' });
  if (ready !== 'READY') return ready;
  await page.click('#osc-measure-primary'); // Start measurement
  const end = await until(() => page.evaluate(() => {
    const st = window.OSCILLA.measure.state;
    return ['COMPLETE', 'INVALID', 'ERROR', 'ABORTED'].includes(st) ? st : null;
  }), { ms: RUN_MS, what: 'the loopback measurement ends' });
  return end;
}

/** Start a 3 s loopback run and return once it owns the output (MEASURING). */
async function startRun(page) {
  await seam.loopback(page, { values: { ...SHORT, duration: 3 } });
  await page.click('#osc-measure-primary'); // Check setup
  await until(() => page.evaluate(() => window.OSCILLA.measure.state === 'READY'),
    { ms: RUN_MS, what: 'the setup check is READY' });
  await page.click('#osc-measure-primary'); // Start measurement
  await until(() => page.evaluate(() => window.OSCILLA.measure.state === 'MEASURING'),
    { ms: RUN_MS, what: 'the run owns the output' });
}

// ------------------------------------------------------------------------------ journeys
function defineChecks() {
  const checks = [];
  const def = (name, fn, extra = {}) => checks.push({ name, fn, ...extra });

  // ============================================================== 1. set, then start
  def('journey-1-start:instrument', async ({ page }) => {
    // waveform, frequency, gain, filter type/cutoff/Q, envelope, all through their controls
    await page.click('#osc-wave-sine');
    for (let i = 0; i < 2; i++) await page.click('#osc-step-st-up'); // 440 -> 493.9 Hz
    await page.click('#osc-step-oct-up');                            // -> 987.8 Hz
    await page.focus('#osc-gain');
    for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowLeft');
    await setSwitch(page, '#osc-filter-enable', true);
    await page.click('#osc-ftype-lowpass');
    await typeField(page, '#osc-filter-cutoff-value', '500');
    await typeField(page, '#osc-filter-q-value', '0.8');
    await setSwitch(page, '#osc-env-enable', true);
    await typeField(page, '#osc-env-sustain-value', '0.8');
    await allowContinuous(page);
    const set = await snap(page);
    const hz = set.app.frequency;
    must(near(hz, 440 * 2 * 2 ** (2 / 12), 0.5), 'two semitones and an octave up from 440 Hz', hz);
    must(set.filter.enabled && set.filter.type === 'lowpass' && near(set.filter.frequency, 500, 1)
      && near(set.filter.Q, 0.8, 0.01), 'the filter lab holds the typed settings', set.filter);
    must(set.envelope.on && near(set.envelope.s, 0.8, 1e-6), 'the envelope holds sustain 0.8',
      set.envelope);
    await holdSpace(page);
    const s = await waitSnap(page, (x) => x.engine.voice && x.engine.voice.wave === 'sine'
      && near(x.engine.voice.freq, hz, 0.5), 'the sounding carrier is the set waveform and '
      + 'frequency');
    must(near(s.engine.gain, s.app.gainLevel, 1e-6) && s.app.gainLevel < 0.08,
      'the engine output gain is the lowered gain setting', { engine: s.engine.gain,
        app: s.app.gainLevel });
    must(s.engine.nodes > 0, 'the voice is counted by the engine', s.engine.nodes);
    // the filter the output passes through is the one the chart draws
    const atten = await responseDb(page, hz);
    const on = await op.steadyDb(page, hz, { what: 'journey-1: the filtered tone' });
    await setSwitch(page, '#osc-filter-enable', false);
    const off = await op.steadyDb(page, hz, { what: 'journey-1: the unfiltered tone' });
    must(atten < -6 && near(on - off, atten, 2.5), 'the output attenuation equals the drawn '
      + 'response at the tone', { atten, on, off });
    // the analysis sees the set frequency
    const out = await until(async () => { const o = await op.output(page);
      return near(o.hz, hz, o.binHz * 1.5) ? o : null; },
    { ms: STEP_MS, what: 'journey-1: the analyser peak is the set frequency' });
    await releaseSpace(page);
    return { hz, atten: +atten.toFixed(1), delta: +(on - off).toFixed(1),
      peakHz: +out.hz.toFixed(1) };
  });

  def('journey-1-start:sequencer', async ({ page }) => {
    await op.navTo(page, 'sequencer');
    await page.click('#osc-seq-record'); // Loop
    await page.selectOption('#osc-seq-tempo', '90');
    const set = await waitSnap(page, (s) => s.seq.loop && s.seq.tempo === 90
      && s.aria.seqLoop === 'true', 'loop and 90 BPM reach the sequence model');
    await page.click('#osc-seq-play');
    const s = await waitSnap(page, (x) => x.seq.playing && x.app.seqPlaying
      && x.aria.seqPlay === 'true', 'the sequencer plays and every view says so');
    const o = await until(async () => { const v = await op.output(page);
      return v.peak > 0.001 ? v : null; }, { ms: STEP_MS, what: 'the sequence is audible' });
    const live = await sources(page);
    must(live.live > 0, 'the sequence has sources on the realtime context', live);
    await page.click('#osc-seq-stop');
    return { loop: set.seq.loop, tempo: set.seq.tempo, peak: +o.peak.toFixed(4),
      playing: s.seq.playing };
  });

  def('journey-1-start:sequencer-tempo', async ({ page }) => {
    await op.navTo(page, 'sequencer');
    const before = await snap(page);
    await page.selectOption('#osc-seq-tempo', '60');
    const s = await waitSnap(page, (x) => x.seq.tempo === 60, 'Tempo 60 reaches the model');
    defect(s.seq.totalMs !== before.seq.totalMs, 'half the tempo changes the sequence timing',
      { before: before.seq.totalMs, after: s.seq.totalMs });
    return { totalMs: s.seq.totalMs };
  }, { xfail: { finding: 'control-census-1', issue: 'K001-K003', pr: 266 } });

  def('journey-1-start:studio', async ({ page }) => {
    await op.navTo(page, 'studio');
    const before = await snap(page);
    must(before.studio && before.studio.nodes.length > 0, 'the Studio holds a document',
      before.studio);
    await page.click('[data-osc="studio.play"]');
    const s = await waitSnap(page, (x) => x.studio.playing && x.studio.counts
      && x.studio.counts.runtimeNodes > 0 && x.studio.counts.runtimeState !== 'idle',
    'the Studio runtime plays its compiled graph');
    const o = await until(async () => { const v = await op.output(page);
      return v.peak > 0.001 ? v : null; }, { ms: STEP_MS, what: 'the Studio is audible' });
    await page.click('[data-osc="studio.stop"]');
    const st = await waitSnap(page, (x) => !x.studio.playing && x.studio.counts.runtimeNodes === 0,
      'STOP releases every runtime node');
    return { runtimeNodes: s.studio.counts.runtimeNodes, peak: +o.peak.toFixed(4),
      after: st.studio.counts };
  });

  def('journey-1-start:measure', async ({ page }) => {
    const end = await measureLoopback(page);
    const r = await page.evaluate(() => {
      const m = window.OSCILLA.measure;
      const res = m.result;
      return { state: m.state, counts: m.counts(), quality: res && res.quality
        ? res.quality.grade || res.quality.level || null : null,
      points: res && res.transfer && res.transfer.freqs ? res.transfer.freqs.length : null,
      chart: !!document.querySelector('#osc-measure-chart-response .uplot, [data-osc="measure.chart"]') };
    });
    must(end === 'COMPLETE', 'the loopback run completes', r);
    return r;
  }, { timeout: CHECK_MS });

  // ============================================================== 2. change while active
  def('journey-2-live:instrument', async ({ page }) => {
    await page.click('#osc-wave-sine');
    await allowContinuous(page);
    await holdSpace(page);
    const b = await snap(page);
    await page.click('#osc-step-oct-up');
    let s = await waitSnap(page, (x) => x.engine.voice && near(x.engine.voice.freq,
      b.app.frequency * 2, 1), 'octave up reaches the sounding carrier');
    must(s.text.freq !== b.text.freq && s.text.sbFreq !== b.text.sbFreq,
      'the frequency readout and the status bar follow', s.text);
    await page.click('#osc-wave-square');
    s = await waitSnap(page, (x) => x.engine.voice && x.engine.voice.wave === 'square'
      && /squ/i.test(x.text.sbWave || ''), 'Square reaches the carrier and the status bar');
    await page.focus('#osc-gain');
    for (let i = 0; i < 4; i++) await page.keyboard.press('ArrowLeft');
    s = await waitSnap(page, (x) => x.app.gainLevel < b.app.gainLevel
      && near(x.engine.gain, x.app.gainLevel, 1e-6) && x.text.gain !== b.text.gain,
    'the gain slider reaches the engine and its readout');
    must(s.app.playing, 'the note still sounds after the three changes', s.app);
    await releaseSpace(page);
    return { freq: s.engine.voice.freq, wave: s.engine.voice.wave, gain: s.engine.gain };
  });

  def('journey-2-live:filter', async ({ page }) => {
    await page.click('#osc-wave-sine');
    for (let i = 0; i < 2; i++) await page.click('#osc-step-st-up');
    await page.click('#osc-step-oct-up');
    await setSwitch(page, '#osc-filter-enable', true);
    await page.click('#osc-ftype-lowpass');
    await typeField(page, '#osc-filter-cutoff-value', '20000');
    await allowContinuous(page);
    const { app: { frequency: hz } } = await holdSpace(page);
    const open = await op.steadyDb(page, hz, { what: 'journey-2: the open low-pass' });
    const steps = [];
    // cutoff typed while sounding
    await typeField(page, '#osc-filter-cutoff-value', '200');
    let r = await responseDb(page, hz);
    let db = await op.steadyDb(page, hz, { what: 'journey-2: cutoff 200 Hz' });
    must(r < -12 && near(db - open, r, 2.5), 'cutoff 200 Hz attenuates the tone as drawn',
      { r, db, open });
    steps.push({ cutoff: 200, r: +r.toFixed(1), d: +(db - open).toFixed(1) });
    // Q by keyboard on its slider
    const q0 = (await snap(page)).filter.Q;
    await page.focus('#osc-filter-q');
    for (let i = 0; i < 2; i++) await page.keyboard.press('PageUp');
    const q = await waitSnap(page, (x) => x.filter.Q > q0 * 1.2, 'the Q slider raises Q');
    r = await responseDb(page, hz);
    db = await op.steadyDb(page, hz, { what: 'journey-2: Q raised' });
    must(near(db - open, r, 2.5), 'the raised Q is the drawn response', { r, db, Q: q.filter.Q });
    // type high-pass by pointer: the tone passes again
    await page.click('#osc-ftype-highpass');
    r = await responseDb(page, hz);
    db = await op.steadyDb(page, hz, { what: 'journey-2: high-pass 200 Hz' });
    must(r > -3 && near(db - open, r, 2.5), 'high-pass below the tone lets it through', { r, db });
    steps.push({ type: 'highpass', r: +r.toFixed(1), d: +(db - open).toFixed(1) });
    const s = await snap(page);
    must(s.text.cutoff && /200/.test(s.text.cutoff) && s.aria.filterOn === 'true',
      'the lab fields show what filters the output', s.text);
    await releaseSpace(page);
    return { hz, steps };
  });

  def('journey-2-live:additive', async ({ page }) => {
    await allowContinuous(page);
    await holdSpace(page);
    await setSwitch(page, '#osc-add-enable', true);
    const s = await waitSnap(page, (x) => x.additive.on && x.engine.voice
      && x.engine.voice.periodicWave, 'Additive on reaches the sounding carrier');
    await page.selectOption('#osc-add-preset', 'square');
    await waitSnap(page, (x) => x.engine.voice && x.engine.voice.periodicWave
      && JSON.stringify(x.additive.partials) !== JSON.stringify(s.additive.partials),
    'a harmonic preset replaces the partials while the note sounds');
    await setSwitch(page, '#osc-add-enable', false);
    await waitSnap(page, (x) => !x.additive.on && x.engine.voice && !x.engine.voice.periodicWave,
      'Additive off returns the carrier to its waveform');
    await releaseSpace(page);
    return { ok: true };
  });

  def('journey-2-live:envelope-held', async ({ page }) => {
    await page.click('#osc-wave-sine');
    for (let i = 0; i < 2; i++) await page.click('#osc-step-st-up');
    await page.click('#osc-step-oct-up');
    await setSwitch(page, '#osc-env-enable', true);
    await typeField(page, '#osc-env-sustain-value', '0.6');
    await allowContinuous(page);
    const { app: { frequency: hz } } = await holdSpace(page);
    const before = await op.steadyDb(page, hz, { what: 'journey-2: sustain 0.6' });
    await typeField(page, '#osc-env-sustain-value', '0.1');
    await waitSnap(page, (x) => near(x.envelope.s, 0.1, 1e-6), 'sustain 0.1 reaches the lab');
    const after = await op.steadyDb(page, hz, { what: 'journey-2: sustain 0.1', ms: 4000 });
    await releaseSpace(page);
    // 20 log10(0.1 / 0.6) = -15.6 dB
    defect(before - after > 12, 'a held note follows the sustain level', { before, after });
    return { before, after };
  }, { xfail: { finding: 'control-census-3', issue: 'C008', pr: 310 } });

  def('journey-2-live:pan-dual', async ({ page }) => {
    await op.navTo(page, 'synthesis');
    await setSwitch(page, '#osc-dual-enable', true);
    await page.click('#osc-dual-mono');
    await op.navTo(page, 'playground');
    await allowContinuous(page);
    await holdSpace(page);
    // the live stereo router of the sounding voice (what the output passes through)
    const tap = () => page.evaluate(() => {
      const r = window.OSCILLA.adapter.getStereoRouter();
      return { router: !!r, panA: r && r.config ? r.config.panA : null,
        voice: !!window.OSCILLA.engine.voice };
    });
    await op.navTo(page, 'compare');
    await page.click('#osc-ptab-stereo');
    const pan = page.locator('#osc-stereo-pan');
    await pan.focus();
    await page.keyboard.press('End');
    const s = await waitSnap(page, (x) => x.phase.pan > 0.5, 'the pan slider reaches the lab');
    try {
      const t = await defectUntil(tap, (v) => v.router && v.panA === 1,
        'the sounding dual voice, started centred, is panned right by the slider');
      return { pan: s.phase.pan, ...t };
    } finally { await releaseSpace(page); }
  }, { xfail: { finding: 'engine-sync-4', issue: 'C010', pr: 293 } });

  def('journey-2-live:hard-limit', async ({ page }) => {
    // continuous off: Hold plays up to the hard limit; lowering the limit while it sounds
    const sel = await page.$$eval('#osc-safety-limit option', (o) => o.map((x) => x.value));
    await holdSpace(page);
    const b = await snap(page);
    await page.selectOption('#osc-safety-limit', sel[0]);
    const s = await waitSnap(page, (x) => String(x.app.safetyLimit) === sel[0],
      'the lower hard limit reaches the instrument');
    const lim = Number(sel[0]);
    must(b.engine.voice && b.engine.voice.len > lim, 'the held note was planned past the lower '
      + 'limit', b.engine.voice);
    try {
      // the sounding note is cut to the limit: its deadline moves in, or it has ended well
      // before the deadline it had (a note that ends at its old deadline was not cut)
      const old = await page.evaluate(() => ({ t0: window.OSCILLA.engine.voice.t0,
        deadline: window.OSCILLA.engine.voice.deadline }));
      const v = await defectUntil(() => page.evaluate(() => {
        const e = window.OSCILLA.engine;
        const vv = e.voice;
        return { len: vv && !vv.ended ? vv.deadline - vv.t0 : null, sounding: !!(vv && !vv.ended),
          now: e.ctx.currentTime, nodes: e.activeNodeCount };
      }), (x) => (x.sounding ? x.len <= lim + 0.05 : x.nodes === 0 && x.now < old.deadline - 0.2),
      `the sounding note ends at the lowered ${lim} s limit`);
      return { limit: lim, before: b.engine.voice.len, now: v };
    } finally { await releaseSpace(page); }
  }, { xfail: { finding: 'dead-controls-4', issue: 'C011', pr: 303 } });

  def('journey-2-live:sequencer-filter', async ({ page }) => {
    await op.navTo(page, 'playground');
    await setSwitch(page, '#osc-filter-enable', true);
    await page.click('#osc-ftype-lowpass');
    await typeField(page, '#osc-filter-cutoff-value', '20000');
    await page.click('#osc-seq-record'); // loop, so the first block returns
    await page.click('#osc-seq-play');
    await waitSnap(page, (x) => x.seq.playing, 'the sequencer plays');
    // the first block is a 440 Hz tone: its level with the filter open, then at 150 Hz
    const lvl = async (what) => {
      let best = -240;
      await until(async () => { best = Math.max(best, await op.toneDb(page, 440));
        return best > -60; }, { ms: STEP_MS, what });
      return best;
    };
    const open = await lvl('journey-2: the 440 Hz block with the filter open');
    await typeField(page, '#osc-filter-cutoff-value', '150');
    let low = -240;
    const t0 = Date.now();
    // the loop passes the 440 Hz block once per 2.25 s: watch two passes for its level
    await until(async () => { low = Math.max(low, await op.toneDb(page, 440));
      return Date.now() - t0 > 5000; }, { ms: STEP_MS, what: 'two passes of the loop heard' });
    await page.click('#osc-seq-stop');
    defect(open - low > 15, 'the enabled low-pass at 150 Hz attenuates the sequencer',
      { open, low });
    return { open, low };
  }, { xfail: { finding: 'control-census-2', issue: 'C003', pr: 295 } });

  def('journey-2-live:studio-param', async ({ page }) => {
    await op.navTo(page, 'studio');
    await page.click('[data-osc="studio.loop"]'); // keep playing past the timeline's end
    await page.click('[data-osc="studio.play"]');
    await waitSnap(page, (x) => x.studio.playing && x.studio.counts.runtimeNodes > 0,
      'the Studio plays');
    const osc = await page.evaluate(() => window.OSCILLA.studio.model.graph.nodes
      .find((n) => n.type === 'oscillator'));
    must(osc, 'the document has an oscillator node');
    await page.locator(`[data-osc="studio.graph.node"][data-node-id="${osc.id}"]`).click();
    const field = `#osc-si-${osc.id}-frequency`;
    await page.locator(field).waitFor({ state: 'visible', timeout: STEP_MS });
    await typeField(page, field, '330');
    const s = await waitSnap(page, (x) => {
      const n = x.studio.nodes.find((m) => m.id === osc.id);
      return n && n.params.frequency === 330 && x.studio.playing;
    }, 'the Inspector frequency reaches the Studio model while it plays');
    await page.click('[data-osc="studio.stop"]');
    return { node: osc.id, counts: s.studio.counts };
  });

  // ============================================================== 3. synchronized views
  def('journey-3-views:instrument', async ({ page }) => {
    await page.click('#osc-wave-triangle');
    await page.click('#osc-step-oct-up');
    await setSwitch(page, '#osc-filter-enable', true);
    await setSwitch(page, '#osc-env-enable', true);
    await allowContinuous(page);
    const s = await holdSpace(page);
    const views = await until(() => page.evaluate(() => {
      const st = window.OSCILLA.viz.state;
      return { path: st.pathNodes.map((n) => n.title), requested: st.labels.requested,
        realFreq: st.labels.realFreq, playing: st.playing };
    }).then((v) => (v.path.includes('FILTER') && v.path.includes('ADSR ENVELOPE')
      && /880/.test(v.requested) ? v : null)),
    { ms: STEP_MS, what: 'journey-3: Signal Path and requested marker follow the instrument' });
    must(/880/.test(s.text.sbFreq || '') && /tri/i.test(s.text.sbWave || ''),
      'the status bar shows frequency and waveform', s.text);
    must(/play|sound|hold/i.test(s.text.sbState || ''), 'the status bar says it plays', s.text);
    const out = await until(async () => { const o = await op.output(page);
      return near(o.hz, 880, o.binHz * 1.5) ? o : null; },
    { ms: STEP_MS, what: 'journey-3: the Spectrum peak is the frequency the readouts show' });
    await releaseSpace(page);
    const idle = await waitSnap(page, (x) => !x.app.playing && x.engine.nodes === 0,
      'after the hold the engine counts no node');
    must(!/play/i.test(idle.text.sbState || '') || /stop|ready|idle/i.test(idle.text.sbState),
      'the status bar returns from playing', idle.text);
    return { path: views.path, requested: views.requested, peakHz: +out.hz.toFixed(1),
      status: s.text.sbState };
  });

  def('journey-3-views:sequencer-owner', async ({ page }) => {
    await op.navTo(page, 'sequencer');
    await page.click('#osc-seq-record');
    await page.click('#osc-seq-play');
    await waitSnap(page, (x) => x.seq.playing, 'the sequencer plays');
    try {
      return await defectUntil(() => page.evaluate(() => ({
        playing: window.OSCILLA.viz.state.playing,
        label: window.OSCILLA.viz.state.labels.requested,
        plan: window.OSCILLA.viz.state.plan ? window.OSCILLA.viz.state.plan.type : null })),
      (v) => v.playing === true, 'the scope and Spectrum report the sequencer as what sounds');
    } finally { await page.click('#osc-seq-stop'); }
  }, { xfail: { finding: 'vis-divergence-1', issue: 'C013', pr: 298 } });

  def('journey-3-views:studio-master', async ({ page }) => {
    await op.navTo(page, 'studio');
    const m = await page.evaluate(() => window.OSCILLA.studio.model.graph.nodes
      .find((n) => n.type === 'master'));
    must(m, 'the document has a Master Output node');
    await page.click('[data-osc="studio.loop"]');
    await page.click('[data-osc="studio.play"]');
    await waitSnap(page, (x) => x.studio.playing, 'the Studio plays');
    await page.locator(`[data-osc="studio.graph.node"][data-node-id="${m.id}"]`).click();
    await typeField(page, `#osc-si-${m.id}-level`, '0.03');
    await waitSnap(page, (x) => near(x.engine.gain, 0.03, 1e-4),
      'the Master Output level reaches the engine output');
    try {
      return await defectUntil(() => page.evaluate(() => ({
        engine: window.OSCILLA.engine.gainLevel, shown: window.OSCILLA.app.gainLevel })),
      (v) => near(v.engine, v.shown, 1e-6), 'the Playground gain shows the level the Studio '
        + 'plays at');
    } finally { await page.click('[data-osc="studio.stop"]'); }
  }, { xfail: { finding: 'dup-stale-4', issue: 'C012', pr: 290 } });

  // ============================================================== 4. stop and restart
  def('journey-4-restart:instrument', async ({ page }) => {
    await page.click('#osc-wave-sine');
    await allowContinuous(page);
    const census = [];
    for (let i = 0; i < CYCLES; i++) {
      await holdSpace(page);
      await until(async () => (await op.output(page)).peak > 0.001,
        { ms: STEP_MS, what: `journey-4: instrument cycle ${i + 1} is audible` });
      await releaseSpace(page);
      const c = await until(async () => {
        const x = await page.evaluate(() => ({ nodes: window.OSCILLA.engine.activeNodeCount,
          sources: window.OSCILLA.engine.activeSourceCount, playing: window.OSCILLA.app.playing }));
        const l = await sources(page);
        return !x.playing && x.nodes === 0 && x.sources === 0 && l.live === 0 ? { ...x, ...l }
          : null;
      }, { ms: STEP_MS, what: `journey-4: instrument cycle ${i + 1} leaves no node` });
      census.push(c.started);
    }
    return { cycles: CYCLES, started: census[census.length - 1] };
  }, { timeout: CHECK_MS });

  def('journey-4-restart:sequencer', async ({ page }) => {
    await op.navTo(page, 'sequencer');
    let started = 0;
    for (let i = 0; i < CYCLES; i++) {
      await page.click('#osc-seq-play');
      await waitSnap(page, (x) => x.seq.playing && x.aria.seqPlay === 'true',
        `journey-4: sequencer cycle ${i + 1} plays`);
      await until(async () => (await sources(page)).live > 0,
        { ms: STEP_MS, what: `journey-4: sequencer cycle ${i + 1} has live sources` });
      await page.click('#osc-seq-stop');
      const c = await until(async () => {
        const s = await snap(page);
        const l = await sources(page);
        return !s.seq.playing && !s.app.seqPlaying && s.aria.seqPlay === 'false' && l.live === 0
          ? l : null;
      }, { ms: STEP_MS, what: `journey-4: sequencer cycle ${i + 1} stops every source` });
      started = c.started;
    }
    return { cycles: CYCLES, started };
  }, { timeout: CHECK_MS });

  def('journey-4-restart:studio', async ({ page }) => {
    await op.navTo(page, 'studio');
    for (let i = 0; i < CYCLES; i++) {
      await page.click('[data-osc="studio.play"]');
      await waitSnap(page, (x) => x.studio.playing && x.studio.counts.runtimeNodes > 0,
        `journey-4: Studio cycle ${i + 1} plays`);
      await page.click('[data-osc="studio.stop"]');
      await until(async () => {
        const s = await snap(page);
        const l = await sources(page);
        const c = s.studio.counts;
        return !s.studio.playing && c.runtimeNodes === 0 && c.runtimeSources === 0
          && c.engineNodes === 0 && l.live === 0;
      }, { ms: STEP_MS, what: `journey-4: Studio cycle ${i + 1} releases every node` });
    }
    return { cycles: CYCLES };
  }, { timeout: CHECK_MS });

  def('journey-4-restart:handover', async ({ page }) => {
    // the Studio claims the output from a held instrument
    await allowContinuous(page);
    await holdSpace(page);
    await op.navTo(page, 'studio');
    await page.click('[data-osc="studio.play"]');
    let s = await waitSnap(page, (x) => x.studio.playing && !x.app.playing,
      'Studio PLAY takes the output from the instrument');
    await releaseSpace(page);
    await page.click('[data-osc="studio.stop"]');
    // Escape stops the sequencer
    await op.navTo(page, 'sequencer');
    await page.click('#osc-seq-play');
    await waitSnap(page, (x) => x.seq.playing, 'the sequencer plays');
    await page.keyboard.press('Escape');
    s = await waitSnap(page, (x) => !x.seq.playing && !x.app.seqPlaying, 'Escape stops it');
    // MEASURE claims the output from a held instrument
    await op.navTo(page, 'playground');
    await holdSpace(page);
    await op.navTo(page, 'measure');
    await seam.loopback(page, { values: SHORT });
    await page.click('#osc-measure-primary'); // Check setup
    await until(() => page.evaluate(() => window.OSCILLA.measure.state === 'READY'),
      { ms: RUN_MS, what: 'the setup check is READY' });
    await page.click('#osc-measure-primary'); // Start measurement
    s = await waitSnap(page, (x) => !x.app.playing && x.measure.state === 'MEASURING',
      'a measurement takes the output from the instrument');
    await releaseSpace(page);
    await page.keyboard.press('Escape');
    await until(() => page.evaluate(() => ['ABORTED', 'IDLE', 'READY', 'COMPLETE', 'INVALID']
      .includes(window.OSCILLA.measure.state)), { ms: STEP_MS, what: 'Escape ends the run' });
    const c = await until(async () => {
      const l = await sources(page);
      const n = await page.evaluate(() => window.OSCILLA.engine.activeNodeCount);
      return l.live === 0 && n === 0 ? { ...l, nodes: n } : null;
    }, { ms: STEP_MS, what: 'journey-4: every hand-over leaves no source' });
    return { measure: s.measure.state, census: c };
  }, { timeout: CHECK_MS });

  def('journey-4-restart:one-owner', async ({ page }) => {
    await allowContinuous(page);
    await holdSpace(page);
    await page.click('#osc-seq-play');
    await waitSnap(page, (x) => x.seq.playing, 'the sequencer plays');
    try {
      return await defectUntil(async () => { const x = await snap(page);
        return { instrument: x.app.playing, voice: !!x.engine.voice, sequencer: x.seq.playing };
      }, (v) => v.sequencer && !v.instrument && !v.voice,
      'one output owner: sequencer Play stops the held instrument');
    } finally {
      await releaseSpace(page);
      await page.click('#osc-seq-stop');
    }
  }, { xfail: { finding: 'coupling-1', issue: 'C002', pr: 305 } });

  // ============================================================== 5. save, restore, compare
  const INSTRUMENT_FIELDS = ['source', 'sourceKind', 'waveform', 'frequency', 'gainLevel'];
  const same = (a, b, keys) => keys.filter((k) => JSON.stringify(a[k]) !== JSON.stringify(b[k]));
  /** Set an instrument and lab state through the controls. */
  async function shape(page) {
    await page.click('#osc-wave-sawtooth');
    await page.click('#osc-step-oct-up');
    await page.click('#osc-step-st-up');
    await page.focus('#osc-gain');
    for (let i = 0; i < 2; i++) await page.keyboard.press('ArrowLeft');
    await setSwitch(page, '#osc-filter-enable', true);
    await page.click('#osc-ftype-highpass');
    await typeField(page, '#osc-filter-cutoff-value', '300');
    await setSwitch(page, '#osc-env-enable', true);
    await typeField(page, '#osc-env-sustain-value', '0.4');
    return snap(page);
  }

  def('journey-5-persist:url', async ({ browser, page }) => {
    const a = await shape(page);
    await page.click('#osc-act-url');
    const url = await until(() => page.evaluate(() => window.OSCILLA.app.copyUrl || null),
      { ms: STEP_MS, what: 'the config link is made' });
    const hash = url.slice(url.indexOf('#'));
    const b = await open(browser, { hash });
    try {
      const s = await waitSnap(b.page, (x) => same(a.app, x.app, INSTRUMENT_FIELDS).length === 0,
        'the link restores the instrument');
      must(!s.app.playing, 'the link starts nothing', s.app);
      return { hash: hash.slice(0, 120) };
    } finally { await b.context.close(); }
  });

  def('journey-5-persist:url-labs', async ({ browser, page }) => {
    const a = await shape(page);
    await page.click('#osc-act-url');
    const url = await until(() => page.evaluate(() => window.OSCILLA.app.copyUrl || null),
      { ms: STEP_MS, what: 'the config link is made' });
    const b = await open(browser, { hash: url.slice(url.indexOf('#')) });
    try {
      const s = await waitSnap(b.page, (x) => same(a.app, x.app, INSTRUMENT_FIELDS).length === 0,
        'the link restores the instrument');
      defect(s.filter.enabled === a.filter.enabled && s.filter.type === a.filter.type
        && near(s.filter.frequency, a.filter.frequency, 1) && near(s.envelope.s, a.envelope.s,
        1e-6), 'the link restores the lab settings it says it restores',
      { saved: { filter: a.filter, env: a.envelope }, restored: { filter: s.filter,
        env: s.envelope } });
      return { ok: true };
    } finally { await b.context.close(); }
  }, { xfail: { finding: 'persist-3', issue: 'C018', pr: 314 } });

  def('journey-5-persist:preset', async ({ page, context }) => {
    const a = await shape(page);
    await op.navTo(page, 'presets');
    await page.click('[data-osc="presets.save"]');
    await page.locator('#osc-save-name').waitFor({ state: 'visible', timeout: STEP_MS });
    await page.fill('#osc-save-name', 'Journey five');
    await page.click('[data-osc="save.confirm"]');
    await until(() => page.evaluate(() => (window.OSCILLA.app.customPresets || [])
      .some((p) => p.name === 'Journey five')), { ms: STEP_MS, what: 'the preset is saved' });
    // a new page of the same browser profile (localStorage), back to the defaults
    const p2 = await context.newPage();
    p2.on('dialog', (d) => d.dismiss().catch(() => {}));
    await p2.goto(page.url().split('#')[0], { waitUntil: 'load' });
    await p2.waitForSelector('html[data-ready="true"]', { timeout: op.OPEN_MS });
    await p2.evaluate(() => { const x = window.OSCILLA.app;
      if (!x.safetyCollapsed) x.collapseSafety(); });
    const d = await snap(p2);
    must(same(a.app, d.app, INSTRUMENT_FIELDS).length > 0, 'the fresh page starts elsewhere');
    await op.navTo(p2, 'presets');
    await p2.click('#osc-ptab-cat-custom');
    await p2.locator('[data-osc="presets.load"][aria-label="Load preset Journey five"]').click();
    const s = await waitSnap(p2, (x) => same(a.app, x.app, INSTRUMENT_FIELDS).length === 0,
      'the custom preset restores the instrument');
    return { restored: INSTRUMENT_FIELDS.map((k) => s.app[k]) };
  });

  def('journey-5-persist:config-file', async ({ browser, page }) => {
    const a = await shape(page);
    await op.navTo(page, 'sequencer');
    await page.click('#osc-seq-record');
    await page.selectOption('#osc-seq-tempo', '140');
    const a2 = await waitSnap(page, (x) => x.seq.loop && x.seq.tempo === 140,
      'loop and tempo reach the sequence');
    await page.click('#osc-export');
    const [dl] = await Promise.all([page.waitForEvent('download', { timeout: STEP_MS }),
      page.click('[data-osc="export.config"]')]);
    const file = path.join(os.tmpdir(), `osc-journey-${process.pid}-${Date.now()}.json`);
    await dl.saveAs(file);
    try {
      const b = await open(browser);
      try {
        await b.page.setInputFiles('#osc-import-file', file);
        const s = await waitSnap(b.page, (x) => same(a.app, x.app, INSTRUMENT_FIELDS).length === 0
          && x.seq.tempo === 140, 'the config file restores the instrument and the sequence');
        const diff = [];
        if (!(s.filter.enabled && s.filter.type === 'highpass'
          && near(s.filter.frequency, 300, 1))) diff.push({ filter: s.filter });
        if (!(s.envelope.on && near(s.envelope.s, 0.4, 1e-6))) diff.push({ env: s.envelope });
        if (s.seq.loop !== a2.seq.loop || JSON.stringify(s.seq.ids) !== JSON.stringify(a2.seq.ids)
          || s.seq.totalMs !== a2.seq.totalMs) diff.push({ seq: s.seq.ids });
        must(diff.length === 0, 'the config file restores filter, envelope and sequence', diff);
        return { fields: INSTRUMENT_FIELDS.length + 3 };
      } finally { await b.context.close(); }
    } finally { fs.rmSync(file, { force: true }); }
  });

  def('journey-5-persist:studio-patch', async ({ page, context }) => {
    await op.navTo(page, 'studio');
    const osc = await page.evaluate(() => window.OSCILLA.studio.model.graph.nodes
      .find((n) => n.type === 'oscillator'));
    await page.locator(`[data-osc="studio.graph.node"][data-node-id="${osc.id}"]`).click();
    await typeField(page, `#osc-si-${osc.id}-frequency`, '345');
    await waitSnap(page, (x) => x.studio.nodes.find((n) => n.id === osc.id).params.frequency === 345,
      'the Inspector edit reaches the model');
    await page.click('[data-osc="studio.save"]');
    await until(() => page.evaluate(() => !!window.OSCILLA.studio.projectId
      && !window.OSCILLA.studio.dirty), { ms: STEP_MS, what: 'the project is saved' });
    const saved = await page.evaluate(() => JSON.stringify(window.OSCILLA.studio.model.graph));
    const p2 = await context.newPage();
    p2.on('dialog', (d) => d.dismiss().catch(() => {}));
    await p2.goto(page.url().split('#')[0], { waitUntil: 'load' });
    await p2.waitForSelector('html[data-ready="true"]', { timeout: op.OPEN_MS });
    await op.navTo(p2, 'studio');
    await p2.click('[data-osc="studio.open"]');
    const item = p2.locator('[data-osc="studio.saved.open"]').first();
    await item.waitFor({ state: 'visible', timeout: STEP_MS });
    await item.click();
    const got = await until(() => p2.evaluate(() => {
      const n = window.OSCILLA.studio.model.graph.nodes.find((x) => x.type === 'oscillator');
      return n && n.params.frequency === 345 ? JSON.stringify(window.OSCILLA.studio.model.graph)
        : null;
    }), { ms: STEP_MS, what: 'the library reopens the saved project' });
    must(got === saved, 'the reopened graph is the saved graph');
    return { node: osc.id };
  });

  def('journey-5-persist:experiment', async ({ page, context }) => {
    const end = await measureLoopback(page);
    must(end === 'COMPLETE', 'the loopback run completes', end);
    await typeField(page, '#osc-m-name', 'Journey five run');
    await page.click('#osc-measure-save');
    await until(() => page.evaluate(() => window.OSCILLA.app.meas.saved),
      { ms: STEP_MS, what: 'MEASURE saves the run' });
    const p2 = await context.newPage();
    p2.on('dialog', (d) => d.dismiss().catch(() => {}));
    await p2.goto(page.url().split('#')[0], { waitUntil: 'load' });
    await p2.waitForSelector('html[data-ready="true"]', { timeout: op.OPEN_MS });
    await op.navTo(p2, 'experiments');
    const open2 = p2.locator('[data-osc="exp.open"]').first();
    await open2.waitFor({ state: 'visible', timeout: STEP_MS });
    const names = await p2.$$eval('[data-osc="exp.open"]', (b) => b.map((x) =>
      x.getAttribute('aria-label')));
    must(names.some((n) => /Journey five run/.test(n || '')), 'the saved run is listed', names);
    await p2.locator('[data-osc="exp.open"][aria-label="Open Journey five run"]').click();
    const d = await until(() => p2.evaluate(() => {
      const x = window.OSCILLA.app.exps && window.OSCILLA.app.exps.detail;
      return x && x.title === 'Journey five run' ? { title: x.title } : null;
    }), { ms: STEP_MS, what: 'the stored experiment opens with its name' });
    return d;
  }, { timeout: CHECK_MS });

  // ============================================================== 6. honest refusals
  def('journey-6-refusals:pattern-field', async ({ page }) => {
    await page.click('#osc-source-pattern');
    const id = await until(() => page.evaluate(() => {
      const el = document.querySelector('[data-osc="pattern.param"][data-key="frequency"]');
      return el ? el.id : null;
    }), { ms: STEP_MS, what: 'the pattern frequency field is shown' });
    const b = await snap(page);
    await typeField(page, `#${id}`, 'loud');
    const msg = await until(() => page.evaluate((i) => {
      const f = document.getElementById(i).closest('.osc-pp-field');
      const e = f && f.querySelector('.osc-pp-error');
      return e && e.offsetParent !== null && e.textContent.trim() ? e.textContent.trim() : null;
    }, id), { ms: STEP_MS, what: 'the field shows why it refused the text' });
    const s = await snap(page);
    must(s.app.frequency === b.app.frequency, 'the refused text leaves the frequency', s.app);
    return { message: msg };
  });

  def('journey-6-refusals:custom-range', async ({ page }) => {
    await page.click('#osc-overflow');
    await page.click('[data-osc="header.settings"]');
    await page.selectOption('#osc-set-range', 'custom');
    const b = await snap(page);
    await typeField(page, '#osc-set-min', '5000');
    await typeField(page, '#osc-set-max', '100');
    const s = await snap(page);
    const msg = await page.evaluate(() => {
      const d = document.querySelector('#osc-dlg-settings');
      return [...d.querySelectorAll('[role="alert"], .osc-field-error, .osc-pp-error')]
        .filter((e) => e.offsetParent !== null).map((e) => e.textContent.trim()).join(' | ');
    });
    must(s.app.rangeMin < s.app.rangeMax, 'the range stays ordered', s.app);
    must(msg.length > 0 || (s.app.rangeMin === b.app.rangeMin || s.app.rangeMax === b.app.rangeMax),
      'an inverted bound is refused or explained', { msg, b: [b.app.rangeMin, b.app.rangeMax],
        s: [s.app.rangeMin, s.app.rangeMax] });
    return { msg, min: s.app.rangeMin, max: s.app.rangeMax };
  });

  def('journey-6-refusals:space-in-measure', async ({ page }) => {
    // In MEASURE, Space starts no sound (shortcuts.js SPACE_MEANING.none): the run keeps the
    // output, no instrument voice starts, and the shortcut list says so.
    await op.navTo(page, 'measure');
    await startRun(page);
    await page.evaluate(() => { if (document.activeElement) document.activeElement.blur(); });
    await page.keyboard.down('Space');
    await page.keyboard.up('Space');
    const s = await snap(page);
    must(!s.app.playing && !s.engine.voice, 'Space starts no instrument voice during the run',
      { app: s.app.playing, voice: s.engine.voice });
    must(['MEASURING', 'ANALYZING', 'COMPLETE'].includes(s.measure.state),
      'the run keeps going', s.measure.state);
    await page.keyboard.press('Escape');
    return { state: s.measure.state };
  }, { timeout: CHECK_MS });

  def('journey-6-refusals:leave-measure', async ({ page }) => {
    // Leaving MEASURE during a run stops it, says so, and keeps nothing: the run never
    // continues unseen behind another workspace.
    await op.navTo(page, 'measure');
    await startRun(page);
    await op.navTo(page, 'playground');
    // the announcement and the Measure step both say it (the step stays, the live region is
    // a transient announcement)
    const r = await until(() => page.evaluate(() => {
      const m = window.OSCILLA.measure;
      const step = document.querySelector('[data-osc="measure.step"][data-step="measure"] '
        + '.osc-m-step-detail');
      return m.state === 'ABORTED' && step && /Stopped; nothing was kept/.test(step.textContent)
        ? { state: m.state, step: step.textContent.trim(), result: !!m.result } : null;
    }), { ms: STEP_MS, what: 'leaving MEASURE ends the run and its step says nothing was kept' });
    must(!r.result, 'nothing of the stopped run is kept as a result', r);
    const c = await until(async () => { const l = await sources(page);
      const n = await page.evaluate(() => window.OSCILLA.measure.counts());
      return l.live === 0 && n.ioSources === 0 && n.captures === 0 ? { ...l, ...n } : null; },
    { ms: STEP_MS, what: 'the stopped run leaves no source or capture' });
    return { step: r.step, census: c };
  }, { timeout: CHECK_MS });

  def('journey-6-refusals:seq-during-measure', async ({ page }) => {
    await op.navTo(page, 'measure');
    await startRun(page);
    const r = await page.evaluate(() => {
      document.querySelector('#osc-seq-play').click();
      const ed = window.OSCILLA.labs.sequencer.editor;
      const playing = ed.playing;
      if (playing) ed.stop();
      return { playing };
    });
    await page.keyboard.press('Escape');
    defect(!r.playing, 'sequencer Play is refused while a measurement owns the output', r);
    return r;
  }, { xfail: { finding: 'coupling-1', issue: 'C002', pr: 305 }, timeout: CHECK_MS });

  def('journey-6-refusals:studio-link', async ({ browser }) => {
    const b = await open(browser, { hash: '#m=studio&st=no-such-template', keepAlerts: true });
    try {
      const s = await waitSnap(b.page, (x) => x.app.alerts.some((m) => /Studio link not applied/
        .test(m) && /no-such-template/.test(m)),
      'the unknown template in the link is refused with a reason that names it');
      must(!s.studio.playing, 'the refused link starts nothing', s.studio);
      return { alerts: s.app.alerts, toast: s.text.toast };
    } finally { await b.context.close(); }
  }, { own: true });

  def('journey-6-refusals:measure-field', async ({ page }) => {
    // A start frequency of -1 Hz: the setup check refuses the sweep and the Stimulus step says
    // why (the validator's reason), not just that it failed.
    await op.navTo(page, 'measure');
    await seam.loopback(page);
    await page.locator('#osc-mf-f1').waitFor({ state: 'visible', timeout: STEP_MS });
    await typeField(page, '#osc-mf-f1', '-1');
    await page.click('#osc-measure-primary'); // Check setup
    const r = await until(() => page.evaluate(() => {
      const m = window.OSCILLA.measure;
      if (!['INVALID', 'READY', 'ERROR'].includes(m.state)) return null;
      const step = document.querySelector('[data-osc="measure.step"][data-step="stimulus"]');
      const d = step && step.querySelector('.osc-m-step-detail');
      return { state: m.state, step: step ? step.className : null,
        reason: d && d.offsetParent !== null ? d.textContent.trim() : null,
        primary: document.querySelector('#osc-measure-primary').textContent.trim() };
    }), { ms: RUN_MS, what: 'the setup check judges a -1 Hz start frequency' });
    must(r.state === 'INVALID' && /is-blocked/.test(r.step), 'the sweep is refused and its step '
      + 'is blocked', r);
    must(/f1 must be ≥ 1 Hz/.test(r.reason || ''), 'the Stimulus step names the start frequency '
      + 'and its bound', r);
    return r;
  }, { timeout: CHECK_MS });

  def('journey-6-refusals:lab-fields', async ({ page }) => {
    // A lab field answers a committed edit with the value that applies: a value past the
    // limit reads as the limit, text that does not parse gives way to the value in use; the
    // model, the slider and the field agree.
    await op.navTo(page, 'synthesis');
    await setSwitch(page, '#osc-env-enable', true);
    const env = () => page.evaluate(() => ({ a: window.OSCILLA.labs.envelope.adsr.a,
      field: document.querySelector('#osc-env-attack-value').value,
      slider: document.querySelector('#osc-env-attack').getAttribute('aria-valuetext') }));
    await typeField(page, '#osc-env-attack-value', '5000');
    const lim = await until(async () => { const v = await env();
      return v.a === 2 && v.field === v.slider ? v : null; },
    { ms: STEP_MS, what: 'Attack 5000 ms reads as its 2 s limit in the field and the slider' });
    await typeField(page, '#osc-env-attack-value', 'abc');
    const kept = await until(async () => { const v = await env();
      return v.a === 2 && v.field === v.slider ? v : null; },
    { ms: STEP_MS, what: 'Attack "abc" gives way to the value in use' });
    await op.navTo(page, 'filter');
    await setSwitch(page, '#osc-filter-enable', true);
    const flt = () => page.evaluate(() => ({ f: window.OSCILLA.labs.filter.config.frequency,
      field: document.querySelector('#osc-filter-cutoff-value').value,
      slider: document.querySelector('#osc-filter-cutoff').getAttribute('aria-valuetext') }));
    await typeField(page, '#osc-filter-cutoff-value', '50000');
    const cut = await until(async () => { const v = await flt();
      return v.f < 50000 && v.field === v.slider ? v : null; },
    { ms: STEP_MS, what: 'cutoff 50 kHz reads as the limit that applies' });
    return { attack: lim, kept, cutoff: cut };
  });

  def('journey-6-refusals:import-limited', async ({ browser, page }) => {
    // A config file with filter Q 50: the lab limits Q to its maximum, and the notice says so
    // instead of "All settings were restored."
    await page.click('#osc-export');
    const [dl] = await Promise.all([page.waitForEvent('download', { timeout: STEP_MS }),
      page.click('[data-osc="export.config"]')]);
    const file = path.join(os.tmpdir(), `osc-journey-q-${process.pid}-${Date.now()}.json`);
    await dl.saveAs(file);
    try {
      const cfg = JSON.parse(fs.readFileSync(file, 'utf8'));
      cfg.filter = { ...cfg.filter, enabled: true, Q: 50 };
      fs.writeFileSync(file, JSON.stringify(cfg));
      const b = await open(browser);
      try {
        await b.page.setInputFiles('#osc-import-file', file);
        const s = await waitSnap(b.page, (x) => x.filter.enabled && x.app.alerts.length > 0,
          'the import is applied and reported');
        must(s.filter.Q <= 30 && near(Number(s.text.q), s.filter.Q, 0.05),
          'Q is limited to the lab maximum and its field shows the applied value',
          { Q: s.filter.Q, field: s.text.q });
        defect(!s.app.alerts.some((m) => /All settings were restored/.test(m))
          && s.app.alerts.some((m) => /Q/.test(m) && /50/.test(m)),
        'the notice names the limited Q and its value in the file', s.app.alerts);
        return { Q: s.filter.Q, alerts: s.app.alerts };
      } finally { await b.context.close(); }
    } finally { fs.rmSync(file, { force: true }); }
  }, { xfail: { finding: 'persist-4', issue: 'C017', pr: 312 } });

  def('journey-6-refusals:additive-dual', async ({ page }) => {
    // Additive switched on while a dual voice sounds: it applies to neither oscillator (A only
    // was the defect), and the dual voice's two oscillators keep their waveforms.
    await allowContinuous(page);
    await op.navTo(page, 'synthesis');
    await setSwitch(page, '#osc-dual-enable', true);
    await holdSpace(page);
    try {
      await waitSnap(page, (x) => x.engine.voice && x.engine.voice.a && x.engine.voice.b,
        'the dual voice sounds with its A and B oscillators');
      await setSwitch(page, '#osc-add-enable', true);
      await waitSnap(page, (x) => x.additive.on, 'Additive on reaches its lab');
      return await defectUntil(async () => { const x = await snap(page);
        return { carrierWave: x.engine.voice ? x.engine.voice.periodicWave : null,
          a: x.engine.voice && x.engine.voice.a, b: x.engine.voice && x.engine.voice.b }; },
      (v) => v.carrierWave === false && v.a && v.b && v.a.wave !== 'custom',
      'Additive does not reach oscillator A of a dual voice alone');
    } finally { await releaseSpace(page); }
  }, { xfail: { finding: 'engine-sync-6', issue: 'C007', pr: 296 } });

  def('journey-6-refusals:pan-stereo', async ({ page }) => {
    // Pan has no effect in Stereo output (A left, B right): the slider is disabled there and
    // says why, instead of moving a value nothing reads.
    await op.navTo(page, 'synthesis');
    await setSwitch(page, '#osc-dual-enable', true);
    await page.click('#osc-dual-stereo');
    await op.navTo(page, 'compare');
    await page.click('#osc-ptab-stereo');
    const s = await waitSnap(page, (x) => x.phase.route === 'stereo' && x.app.dual.stereo,
      'Stereo output reaches the Phase & Stereo lab');
    const v = await page.evaluate(() => {
      const p = document.querySelector('#osc-stereo-pan');
      const why = (p.getAttribute('aria-describedby') || '').split(/\s+/).filter(Boolean)
        .map((i) => document.getElementById(i)).filter((e) => e && e.offsetParent !== null)
        .map((e) => e.textContent.trim()).join(' ');
      return { disabled: p.disabled || p.getAttribute('aria-disabled') === 'true', why };
    });
    defect(v.disabled && /stereo/i.test(v.why), 'the pan slider is disabled in Stereo output '
      + 'with a visible reason', v);
    return { route: s.phase.route, ...v };
  }, { xfail: { finding: 'dead-controls-2', issue: 'C010', pr: 293 } });

  return checks;
}

// ------------------------------------------------------------------------------ runner
async function runCheck(browser, c) {
  const ctx = c.own ? null : await open(browser);
  const args = { browser, page: ctx && ctx.page, context: ctx && ctx.context };
  try {
    const detail = await bounded(c.fn(args), { ms: c.timeout || CHECK_MS / 2,
      what: `journey ${c.name}` });
    if (ctx && ctx.errors.length) {
      return { status: 'FAIL', detail: `page errors: ${ctx.errors.slice(0, 3).join(' | ')}` };
    }
    return { status: c.xfail ? 'XPASS' : 'PASS', detail };
  } catch (e) {
    const msg = op.clip(String(e && e.message ? e.message : e).split('\n')[0], 500);
    if (c.xfail && e instanceof Defect) return { status: 'XFAIL', detail: msg };
    return { status: 'FAIL', detail: msg };
  } finally {
    if (ctx) await ctx.context.close().catch(() => {});
  }
}

(async () => {
  await RUN.ready();
  if (!fs.existsSync(DIST)) {
    console.error(`missing ${DIST}: run npm run build`);
    process.exit(2);
  }
  const all = defineChecks();
  const names = new Set();
  for (const c of all) {
    if (names.has(c.name)) throw new Error(`duplicate journey ${c.name}`);
    names.add(c.name);
  }
  if (ONLY) {
    const unknown = [...ONLY].filter((n) => !names.has(n));
    if (unknown.length) {
      console.error(`unknown journey(s): ${unknown.join(', ')}`);
      process.exit(2);
    }
  }
  let failed = 0;
  for (const name of RUN.browsers) {
    const browser = await playwright[name].launch(op.LAUNCH[name]);
    const t0 = Date.now();
    let n = 0;
    const tally = { PASS: 0, FAIL: 0, XFAIL: 0, XPASS: 0 };
    try {
      for (const c of all) {
        if (ONLY && !ONLY.has(c.name)) continue;
        n++;
        const r = await runCheck(browser, c);
        tally[r.status]++;
        const mark = c.xfail ? ` [expected failure: ${c.xfail.finding}, ${c.xfail.issue}, `
          + `fix PR #${c.xfail.pr}]` : '';
        const note = r.status === 'XPASS' ? ' — the defect no longer reproduces: remove the '
          + 'expected-failure mark' : '';
        console.log(`  ${r.status.padEnd(5)}  ${name} ${c.name}${mark}${note}  ${
          op.clip(JSON.stringify(r.detail), 600)}`);
      }
    } finally {
      await browser.close();
    }
    RUN.reportLeg({ leg: name, checks: n });
    const bad = tally.FAIL + tally.XPASS;
    failed += bad;
    console.log(`${bad ? 'FAIL' : 'PASS'} ${name}: ${tally.PASS} pass, ${tally.XFAIL} expected `
      + `failure(s), ${tally.FAIL} fail, ${tally.XPASS} unexpected pass `
      + `(${((Date.now() - t0) / 1000).toFixed(1)} s)`);
  }
  console.log(failed ? `${failed} FAILED` : 'ALL PASS');
  process.exit(failed ? 1 : 0);
})();
