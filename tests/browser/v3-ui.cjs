#!/usr/bin/env node
// OSCILLA V3 UI gate: the MEASURE and EXPERIMENTS workspaces of the built dist/index.html in
// chromium, firefox and webkit, each from file:// AND from a GitHub-Pages-like sub-path
// (http://127.0.0.1:<port>/oscilla/).
//
//   node tests/browser/v3-ui.cjs [--browsers chromium,firefox,webkit] [--origins file,http]
//                                [--only name1,name2] [--json out.json]     (or OSC_BROWSERS=...)
//
// The measurement runs in TEST CONTEXT: capture.js createLoopbackIo replaces the microphone with
// a known synthetic digital system (OSCILLA.measure.useLoopback), so the whole UI path runs on
// real Web Audio without acoustics; the fake microphone of Chromium and Firefox covers the real
// capture path's permission, preflight and cleanup (acoustics are not asserted). Experiments for
// import, compare and the visual reference are built deterministically in Node by
// tests/browser/fixtures/v3-experiments.mjs (the real engine on a synthetic io).
//
// Checks per browser and origin (asserted):
//   nav-order               Measure and Experiments follow Playground; About stays last
//   loopback-workflow       Check setup -> READY -> measure -> COMPLETE through the UI: the
//                           analysis ran in ONE Worker started from a data: URL of the page's
//                           own <script data-analysis> text (ready ... result; no silent inline
//                           fallback), the seven steps, quality bar, quality status with reasons,
//                           response / IR
//                           summaries, TEST CONTEXT banner, one announcement per stage and no
//                           progress chatter, save, repeat (new experiment, repeatOf), 0 engine
//                           and io nodes, sources, captures and ports afterwards
//   abort-stages            abort in PREFLIGHT, NOISE_CHECK, ARMED, MEASURING and ANALYZING via
//                           Escape, STOP, page hide and leaving the workspace: ABORTED, the
//                           stopped announcement, 0 nodes/sources/captures/ports after
//   output-exclusive        the instrument cannot play while a measurement owns the output
//   fake-mic                (chromium, firefox) permission + setup check on the real capture io,
//                           applied constraints read back, every track stopped after reset
//   live-rta                (chromium, firefox) the live RTA of the fake microphone's 1 kHz tone
//                           (amplitude 0.1: Firefox's built-in fake stream; Chromium plays
//                           FAKE_TONE from a WAV via --use-file-for-fake-audio-capture): 1/3
//                           octave and octave bands appear, the 1 kHz band dominates (>= 20 dB)
//                           at 10*log10(0.1^2/2) = -23.01 dB +/- 1 dB (the spectrum.js
//                           mean-square scale), the FFT peak bin sits at 1 kHz; averaging,
//                           peak hold, freeze, the rtaResult snapshot IDs; STOP, Escape,
//                           leaving the tab, leaving the workspace and page hide each stop it
//                           with 0 nodes and tracks; a setup check takes the input from it
//                           (exclusive); no "SPL" without a level calibration.
//                           (webkit: no fake device) the start is refused with the browser's
//                           reason shown, the mode and averaging controls stay disabled, nothing
//                           stays open.
//   calibration             CSV profile import -> Frequency CALIBRATED; level calibration dialog
//                           (advanced manual reading) -> Level CALIBRATED; invalid input refused
//   level-reference         (M3) the dialog captures the reference through the loopback io (a
//                           1 kHz instrument tone), names the scale, stores method 'captured'
//                           with the input; another input voids it (UNCALIBRATED + reason);
//                           Stop aborts a capture cleanly (0 nodes, captures, ports)
//   profile-convention      (M4) a "Gain(dB)" profile asks for the sign convention before it
//                           is loaded; the choice and a one-point preview are shown
//   view-options            (M6, M7) a 2-20 kHz measurement with "0 dB at 1 kHz" selected
//                           completes (no "Measurement failed"), the option is disabled and
//                           reset; the IR Direct span is drawn sample by sample
//   evidence-at-completion  (ADR 0040 resolution) measured with profile A and notes "start":
//                           after COMPLETE, profile B is loaded, a level calibration is created
//                           and the notes are edited; the Experiment panel says the saved record
//                           keeps the calibration it was measured with, and the saved record
//                           names A, has no level calibration (no "SPL"), keeps the start notes
//                           and carries the edited text as annotations.notes only
//   experiments             import of three fixtures, list, open, rename, duplicate, compare
//                           (A, B equivalent: A − B shown; A, C: refused with the reason),
//                           export .oscilla.json (re-validates), CSV, re-import refused (no
//                           overwrite), explicit delete with confirmation, inspection in MEASURE
//   experiments-ir          (V356) compare A, B (equivalent): the IR overlay is drawn (two curves,
//                           -5..200 ms re each direct peak, original scale, no IR A − B) beside
//                           A − B; A, C (not equivalent): refused with the reason, no chart
//   experiments-changes     (ADR 0041) compare A, C: the semantic change list (a real list under
//                           h4/h5/h6 headings) names "Stimulus f1: 20 Hz → 50 Hz" in an open
//                           Recipe group and the name change in a collapsed Metadata group that
//                           Enter on its summary opens; nothing causal is said; C marked as the
//                           baseline (aria-pressed, BASELINE chip) makes one selected run compare
//                           against it (C first); the list fits 390 px; the mark is cleared again
//   calibration-export      (V315) Export CSV and Export JSON of the loaded profile download
//                           deterministic files named after the profile and its id, and both
//                           re-import (same id, name, convention); a correction profile (chosen
//                           in the dialog) re-imports from its CSV without the question
//   input-device            (V322) the input choice is disabled in TEST CONTEXT and starts at the
//                           default; (chromium, firefox on http, fake microphone) the setup check
//                           opens the default (no deviceId), the inputs are listed, a chosen
//                           input reaches getUserMedia as deviceId { exact } and the input
//                           record, a chosen input that disappears stays selected, is marked
//                           "not available", announced (assertive) and refused by the setup
//                           check with the readable reason; back to the default; 0 nodes/tracks
//   recipe-link             (V355) a recipe in the hash (next to an instrument link) fills the
//                           setup and opens MEASURE without starting anything; a bad recipe is
//                           refused whole with the reason; Copy recipe link writes the hash and
//                           the clipboard or the fallback dialog; a new page opened on the link
//                           loads it the same way
//   persistence             (V353) per browser and origin, in a fresh context: which store opens
//                           (IndexedDB or the memory fallback) and whether an experiment survives
//                           a reload (docs/v3/measurement-guide.md records it); with IndexedDB,
//                           a QuotaExceededError on the experiment put fails the save with the
//                           reason, keeps the result (COMPLETE, shown, Save enabled) and a save
//                           after space is freed succeeds; with indexedDB.open throwing, the
//                           Playground plays and stops and MEASURE measures and saves in memory,
//                           with no page error
//   no-spl                  no "SPL" in any rendered text or label of either workspace without a
//                           valid level calibration
//   light-theme             warning chips use --osc-text on --osc-warn-bg (orange is icon only)
//   no-console-errors
'use strict';
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const playwright = require('playwright');

const argv = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};
const DIST = path.resolve(__dirname, '..', '..', 'dist', 'index.html');
const BROWSERS = arg('browsers', process.env.OSC_BROWSERS || 'chromium,firefox,webkit').split(',');
const ORIGINS = arg('origins', 'file,http').split(',');
const ONLY = arg('only', '') ? new Set(arg('only', '').split(',')) : null;
const JSON_OUT = arg('json', '');

// The fake microphone's tone: Firefox's built-in fake stream is a 1 kHz sine of amplitude 0.1
// (measured: peak 0.100, mean square -23.0 dB); Chromium's default fake device only beeps, so it
// plays the same tone from a WAV file (written below, looped by Chromium).
const FAKE_TONE = { hz: 1000, amplitude: 0.1, sampleRate: 48000, seconds: 2 };
// One-third-octave bands 20 Hz-20 kHz the RTA can show at a context rate: base-10 series,
// band x has upper edge 1 kHz * 10^(3(2x+1)/60); rta.js drops bands above 0.95 * Nyquist. 31 at
// 48 kHz, 30 at 44.1 kHz (the CI runners' rate), computed here independently of rta.js.
const thirdBandCount = (sr) => {
  let n = 0;
  for (let x = -17; x <= 13; x++) if (1000 * 10 ** ((3 * (2 * x + 1)) / 60) <= 0.475 * sr) n++;
  return n;
};
function writeToneWav(file, { hz, amplitude, sampleRate, seconds }) {
  const n = sampleRate * seconds; // a whole number of cycles: the loop is seamless
  const b = Buffer.alloc(44 + n * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + n * 2, 4); b.write('WAVE', 8); b.write('fmt ', 12);
  b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(sampleRate, 24); b.writeUInt32LE(sampleRate * 2, 28); b.writeUInt16LE(2, 32);
  b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i += 1) {
    b.writeInt16LE(Math.round(32767 * amplitude * Math.sin((2 * Math.PI * hz * i) / sampleRate)),
      44 + 2 * i);
  }
  fs.writeFileSync(file, b);
}
const TONE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'oscilla-v3ui-tone-'));
const TONE_WAV = path.join(TONE_DIR, 'tone-1k.wav');
writeToneWav(TONE_WAV, FAKE_TONE);
process.on('exit', () => fs.rmSync(TONE_DIR, { recursive: true, force: true }));

const LAUNCH = {
  chromium: { args: ['--autoplay-policy=no-user-gesture-required',
    '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream',
    `--use-file-for-fake-audio-capture=${TONE_WAV}`] },
  firefox: { firefoxUserPrefs: { 'media.autoplay.default': 0, 'media.autoplay.blocking_policy': 0,
    'media.autoplay.block-webaudio': false, 'media.navigator.streams.fake': true,
    'media.navigator.permission.disabled': true } },
  webkit: {},
};
const FAKE_MIC = new Set(['chromium', 'firefox']);
// Short TEST CONTEXT recipe: 1 s sweep, 2 runs, a noise check (all states are visited).
const SHORT = { duration: 1, repeats: 2, noiseCheckS: 0.5, preRollS: 0.25, postRollS: 0.5,
  gapS: 0.2 };
// Realtime runs wait on the audio clock; a stalled CI clock gets generous deadlines.
const RUN_MS = 45000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function startServer() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'oscilla-v3ui-'));
  fs.mkdirSync(path.join(root, 'oscilla'));
  fs.copyFileSync(DIST, path.join(root, 'oscilla', 'index.html'));
  const port = 9300 + Math.floor(Math.random() * 300);
  const proc = spawn('python3', ['-m', 'http.server', String(port), '--bind', '127.0.0.1',
    '--directory', root], { stdio: 'ignore' });
  return { proc, root, url: `http://127.0.0.1:${port}/oscilla/` };
}

async function waitForServer(url) {
  for (let i = 0; i < 80; i += 1) {
    try { const r = await fetch(url); if (r.ok) return; } catch { /* not yet */ }
    await sleep(100);
  }
  throw new Error(`server did not start: ${url}`);
}

// ------------------------------------------------------------------------------ page helpers
const H = {
  state: (page) => page.evaluate(() => window.OSCILLA.measure.state),
  counts: (page) => page.evaluate(() => window.OSCILLA.measure.counts()),
  /** Deadline poll on fn(); resolves to the first value passing test, else the last value. */
  until: async (fn, test, ms = 3000, step = 40) => {
    const t0 = Date.now();
    let v = await fn();
    while (!test(v) && Date.now() - t0 < ms) {
      await sleep(step);
      v = await fn();
    }
    return v;
  },
  zero: (c) => c.engineNodes === 0 && c.ioNodes === 0 && c.ioSources === 0 && c.captures === 0
    && c.ports === 0 && c.tracks === 0,
  waitState: (page, states, ms = RUN_MS) => page.waitForFunction(
    (list) => list.includes(window.OSCILLA.measure.state), states, { timeout: ms, polling: 50 }),
  /** Reach a workspace through the nav; a grouped one (ANALYZE, SYNTHESIS) opens its group. */
  navTo: async (page, ws) => {
    const item = `[data-osc="nav.${ws}"]`;
    const group = await page.evaluate((s) => {
      const el = document.querySelector(s);
      const g = el && el.closest('[data-osc-nav-group]');
      return g && el.offsetParent === null ? g.dataset.oscNavGroup : null;
    }, item);
    if (group) await page.click(`[data-osc="nav-group.${group}"]`);
    await page.click(item);
  },
  workspace: async (page, ws) => {
    await H.navTo(page, ws);
    await page.waitForFunction((w) => document.querySelector('#osc-app').dataset.mode === w, ws);
    await sleep(120);
  },
  clean: (page) => page.evaluate(() => {
    const a = window.OSCILLA.app;
    a.alerts = [];
    if (!a.safetyCollapsed) a.collapseSafety();
  }),
  /** Record every text the two live regions receive (MutationObserver), in order. */
  recordLive: (page) => page.evaluate(() => {
    const log = [];
    window.__oscLive = log;
    for (const sel of ['[data-osc="measure.live"]', '[data-osc="measure.alert"]']) {
      const el = document.querySelector(sel);
      new MutationObserver(() => { if (el.textContent) log.push(el.textContent); })
        .observe(el, { childList: true, characterData: true, subtree: true });
    }
  }),
  live: (page) => page.evaluate(() => (window.__oscLive || []).slice()),
  /**
   * Run ONE measurement through `start` (a click) until it ends: no retry. The digital loopback
   * is deterministic, so a run that is not COMPLETE is a defect and fails the check with its
   * reasons (Firefox once replayed the limiter's look-ahead line at the next onset, which made
   * the run after an abort INVALID: audio-engine.js feedLimiter).
   */
  run: async (page, start) => {
    await start();
    await H.waitState(page, ['COMPLETE', 'INVALID', 'ERROR', 'ABORTED']);
    return page.evaluate(() => {
      const m = window.OSCILLA.measure;
      const res = m.result;
      const out = { state: m.state,
        reasons: res ? (res.reasons || []).filter((x) => x.severity !== 'ok')
          .map((x) => `${x.code}: ${x.text}`).slice(0, 4) : [] };
      if (m.state !== 'COMPLETE') {
        // Frame timing of the capture windows, so a capture defect says where it came from.
        out.integrity = res ? (res.runs || []).map((r) => r.checks && r.checks.integrity) : null;
        out.diag = m.io && m.io.diagnostics ? m.io.diagnostics() : null;
      }
      return out;
    });
  },
  /** Wait for MEASURE's save to finish; on a timeout, say what the page was in. */
  saved: (page) => page.waitForFunction(() => window.OSCILLA.app.meas.saved, null,
    { timeout: 10000 }).then(() => null, () => page.evaluate(() => ({
    saveTimeout: true, state: window.OSCILLA.measure.state, saving: window.OSCILLA.app.meas.saving,
    alerts: (window.OSCILLA.app.alerts || []).map((a) => `${a.title}: ${a.text || ''}`)
      .slice(0, 4) }))),
  /**
   * Named conditions -> { ok, failed: [names] }, so a failing check says WHICH condition failed
   * (the printed JSON is truncated).
   */
  verdict: (conds) => {
    const failed = Object.keys(conds).filter((k) => !conds[k]);
    return { ok: failed.length === 0, failed };
  },
  loopback: (page) => page.evaluate((values) => {
    const m = window.OSCILLA.measure;
    m.useLoopback({ type: 'biquad', filter: 'lowpass', frequency: 2000, Q: Math.SQRT1_2 });
    m.setValues(values);
  }, SHORT),
};

/** In-page: every rendered text node and label of the two workspaces that mentions SPL. */
function splMentions() {
  const out = [];
  for (const id of ['osc-view-measure', 'osc-view-experiments']) {
    const root = document.getElementById(id);
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
    for (let n = walker.currentNode; n; n = walker.nextNode()) {
      if (n.nodeType === 3) {
        if (/SPL/.test(n.textContent)) out.push(n.textContent.trim().slice(0, 120));
      } else {
        for (const a of ['aria-label', 'title', 'placeholder', 'aria-description']) {
          const v = n.getAttribute(a);
          if (v && /SPL/.test(v)) out.push(`${a}: ${v.slice(0, 120)}`);
        }
      }
    }
  }
  return out;
}

// ------------------------------------------------------------------------------ checks
function defineChecks(fixtures) {
  const checks = [];
  const def = (name, fn) => checks.push({ name, fn });

  def('nav-order', async ({ page }) => {
    // §73 + §198 (V371): the top level is these eight entries; ANALYZE and SYNTHESIS group the
    // V2 workspaces.
    const items = await page.evaluate(() => [...document.querySelectorAll('#osc-nav > li')]
      .map((li) => li.querySelector(':scope > a, :scope > button').dataset.osc));
    const ok = JSON.stringify(items) === JSON.stringify(['nav.playground', 'nav.measure',
      'nav.experiments', 'nav-group.analyze', 'nav-group.synthesis', 'nav.learn', 'nav.studio',
      'nav.about']);
    await H.workspace(page, 'measure');
    const view = await page.evaluate(() => {
      const r = document.getElementById('osc-view-measure').getBoundingClientRect();
      return { shown: r.width > 0 && r.height > 0,
        current: document.querySelector('[aria-current="page"]').dataset.osc,
        panels: [...document.querySelectorAll('#osc-view-measure .osc-panel')]
          .filter((p) => p.getBoundingClientRect().height > 0).length };
    });
    return { ok: ok && view.shown && view.current === 'nav.measure' && view.panels === 7,
      items, view };
  });

  def('loopback-workflow', async ({ page }) => {
    await H.workspace(page, 'measure');
    await H.loopback(page);
    await H.recordLive(page);
    const res = {};
    res.banner = await page.waitForSelector('[data-osc="measure.testContext"]',
      { state: 'visible', timeout: 3000 }).then(() => true, () => false);
    await page.click('#osc-measure-primary'); // Check setup
    await H.waitState(page, ['READY', 'INVALID', 'ERROR'], 15000);
    res.afterPreflight = await page.evaluate(() => ({
      state: window.OSCILLA.measure.state,
      primary: document.querySelector('#osc-measure-primary').textContent.trim(),
      steps: [...document.querySelectorAll('[data-osc="measure.step"]')].map((li) => li.className
        .replace('osc-m-step ', '')),
      input: document.querySelector('[data-osc="measure.bar"]').textContent.replace(/\s+/g, ' '),
    }));
    const workers0 = await page.evaluate(() => window.__oscWorkers.length);
    res.run1 = await H.run(page, () => page.click('#osc-measure-primary')); // Start measurement
    if (res.run1.state !== 'COMPLETE') return { ok: false, failed: ['run1'], ...res };
    res.workers = await page.evaluate((n) => window.__oscWorkers.slice(n), workers0);
    await sleep(200);
    res.done = await page.evaluate(() => {
      const q = (s) => document.querySelector(s);
      const text = (s) => (q(s) ? q(s).textContent.replace(/\s+/g, ' ').trim() : null);
      return {
        state: window.OSCILLA.measure.state,
        history: window.OSCILLA.measure.history,
        bar: [...document.querySelectorAll('[data-osc="measure.bar"] .osc-q-text')]
          .map((e) => e.textContent),
        quality: text('[data-osc="measure.quality"]'),
        reasons: document.querySelectorAll('.osc-m-reasons li').length,
        response: text('[data-osc="measure.responseSummary"]'),
        shown: text('[data-osc="measure.shown"]'),
        primary: text('#osc-measure-primary'),
        chart: !!q('#osc-measure-chart-response .uplot'),
      };
    });
    await page.click('[data-osc="measure.tab"][data-value="ir"]');
    await sleep(150);
    res.ir = await page.evaluate(() => ({
      text: document.querySelector('[data-osc="measure.irSummary"]').textContent,
      chart: !!document.querySelector('#osc-measure-chart-ir .uplot'),
      tabs: document.querySelector('#osc-m-tab-ir').getAttribute('aria-selected'),
    }));
    // The stored noise-check band levels are a SNAPSHOT, never badged LIVE; their under-
    // resolved low bands are flagged (hatched).
    res.rtaStored = await page.evaluate(() => {
      const r = window.OSCILLA.app.meas.rta;
      return r ? { badges: r.badges, live: r.live, notes: r.notes.join(' ') } : null;
    });
    // Keyboard: arrows move along the result tabs (role=tab roving).
    await page.focus('#osc-m-tab-ir');
    await page.keyboard.press('ArrowRight');
    res.rtaTab = await page.evaluate(() => document.activeElement.id);
    await page.click('[data-osc="measure.tab"][data-value="response"]');
    res.live = await H.until(() => H.live(page), (l) => l.includes('Measurement complete'), 1500);
    res.counts = await H.until(() => H.counts(page), H.zero, 3000);
    // Save, then REPEAT: a new experiment that records what it repeats.
    await page.fill('#osc-m-name', 'Gate loopback');
    await page.click('#osc-measure-save');
    res.save1 = await H.saved(page);
    if (res.save1) return { ok: false, failed: ['save1'], ...res };
    const firstId = await page.evaluate(() => window.OSCILLA.app.meas.savedId);
    res.run2 = await H.run(page, () => page.click('[data-osc="measure.repeat"]'));
    if (res.run2.state !== 'COMPLETE') return { ok: false, failed: ['run2'], ...res };
    await page.click('#osc-measure-save');
    res.save2 = await H.saved(page);
    if (res.save2) return { ok: false, failed: ['save2'], ...res };
    res.repeat = await page.evaluate(async (first) => {
      const a = window.OSCILLA.app;
      const id = a.meas.savedId;
      const e = await window.OSCILLA.experiments.store().get(id);
      const list = await window.OSCILLA.experiments.store().list();
      return { newId: id !== first, repeatOf: e.provenance.repeatOf === first,
        testContext: !!e.measurement.runs[0].testContext, count: list.length };
    }, firstId);
    res.counts2 = await H.until(() => H.counts(page), H.zero, 3000);
    const d = res.done;
    const announced = ['Setup check complete: ready', 'Measurement started',
      'Noise-floor check complete', 'Sweep running', 'Measurement complete'];
    const v = H.verdict({
      banner: res.banner,
      preflightReady: res.afterPreflight.state === 'READY'
        && res.afterPreflight.primary === 'Start measurement',
      run1: res.run1.state === 'COMPLETE',
      analysisWorker: res.workers.length === 1 && res.workers[0].sameText
        && res.workers[0].kinds[0] === 'ready' && res.workers[0].kinds.at(-1) === 'result',
      history: d.state === 'COMPLETE' && d.history.includes('ANALYZING')
        && d.history.includes('ARMED'),
      bar: d.bar.length === 5 && d.bar.includes('CAPTURE COMPLETE') && d.bar.includes('INPUT OK'),
      quality: /^(GOOD|USABLE)$/.test(d.quality) && d.reasons > 0,
      response: /^Frequency response \(/.test(d.response) && /TEST CONTEXT/.test(d.shown)
        && d.primary === 'Save experiment' && d.chart,
      ir: /^Impulse response: direct peak/.test(res.ir.text) && res.ir.chart
        && res.ir.tabs === 'true' && res.rtaTab === 'osc-m-tab-rta',
      rtaStored: !!res.rtaStored && res.rtaStored.badges.includes('NOISE CHECK SNAPSHOT')
        && !res.rtaStored.badges.includes('LIVE') && res.rtaStored.live === false
        && /fewer than 6 FFT bins/.test(res.rtaStored.notes), // rta.v2: Hann limit (V382)
      announcements: announced.every((t) => res.live.filter((x) => x === t).length === 1)
        && !res.live.some((t) => /%/.test(t)),
      zero: H.zero(res.counts) && H.zero(res.counts2),
      repeat: res.repeat.newId && res.repeat.repeatOf && res.repeat.testContext,
    });
    return { ...v, ...res };
  });

  def('abort-stages', async ({ page }) => {
    await H.workspace(page, 'measure');
    await H.loopback(page);
    const how = {
      escape: () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })),
      stop: () => document.getElementById('osc-measure-stop').click(),
      hide: () => window.dispatchEvent(new Event('pagehide')),
      workspace: () => window.OSCILLA.app.setWorkspace('experiments'),
    };
    const cases = [['PREFLIGHT', 'stop'], ['NOISE_CHECK', 'escape'], ['ARMED', 'stop'],
      ['MEASURING', 'escape'], ['MEASURING', 'hide'], ['ANALYZING', 'escape'],
      ['MEASURING', 'workspace']];
    const out = [];
    const terminal = ['IDLE', 'COMPLETE', 'INVALID', 'ABORTED', 'ERROR'];
    for (const [stage, via] of cases) {
      // One attempt per case, no retry: a run that ends before reaching the stage is a failure
      // and is reported with its reasons.
      await H.workspace(page, 'measure');
      await H.recordLive(page);
      const hook = page.evaluate(([st, fnText]) => window.OSCILLA.measure.onceInState(st,
        // eslint-disable-next-line no-new-func
        new Function(`(${fnText})()`)), [stage, how[via].toString()]);
      // One measure() call (it runs its own setup check), started as the Start button does.
      await page.evaluate(() => { window.OSCILLA.app.measureStart(); });
      const ended = H.waitState(page, terminal).then(() => null, () => null);
      const hit = await Promise.race([hook, ended.then(() => sleep(50)).then(() => null)]);
      await page.evaluate(() => window.OSCILLA.measure.clearStateHook());
      const end = await H.until(() => H.state(page), (st) => terminal.includes(st), 3000);
      const counts = await H.until(() => H.counts(page), H.zero, 3000);
      if (!hit && end !== 'ABORTED') {
        out.push({ stage, via, hit: false, end, reasons: await page.evaluate(() => {
          const r = window.OSCILLA.measure.result;
          return r ? (r.reasons || []).map((x) => `${x.code}: ${x.text}`).slice(0, 3) : null;
        }) });
        await page.evaluate(() => window.OSCILLA.measure.engine.reset());
        continue;
      }
      // Announcements reach the live region on the next task (it is cleared first).
      const live = await H.until(() => H.live(page), (l) => l.includes('Measurement stopped'),
        1500);
      out.push({ stage, via, hit: hit && hit.ran, end, zero: H.zero(counts), counts,
        stopped: live.includes('Measurement stopped') });
      await page.evaluate(() => {
        const e = window.OSCILLA.measure.engine;
        if (e && ['ABORTED', 'COMPLETE', 'INVALID', 'ERROR'].includes(e.state)) e.reset();
      });
    }
    const ok = out.every((r) => r.hit === true && r.end === 'ABORTED' && r.zero && r.stopped);
    return { ok, cases: out };
  });

  def('output-exclusive', async ({ page }) => {
    await H.workspace(page, 'measure');
    await H.loopback(page);
    await page.evaluate(() => window.OSCILLA.measure.setValues({ repeats: 1, duration: 2 }));
    await page.click('#osc-measure-primary');
    await H.waitState(page, ['READY', 'INVALID'], 15000);
    const hook = page.evaluate(() => window.OSCILLA.measure.onceInState('MEASURING', () => {
      window.__oscPlayed = window.OSCILLA.app.play('trigger');
      window.__oscVoices = window.OSCILLA.engine.audibleVoiceCount;
    }));
    await page.click('#osc-measure-primary');
    await hook;
    const res = await page.evaluate(() => ({ played: window.__oscPlayed,
      voices: window.__oscVoices, owns: window.OSCILLA.app.measureOwnsOutput() }));
    await page.keyboard.press('Escape');
    await H.waitState(page, ['ABORTED', 'COMPLETE', 'INVALID'], 5000);
    const counts = await H.until(() => H.counts(page), H.zero, 3000);
    await page.evaluate(() => window.OSCILLA.measure.engine.reset());
    return { ok: res.played === false && res.voices === 0 && H.zero(counts), ...res, counts };
  });

  def('fake-mic', async ({ page, browserName, origin }) => {
    if (!FAKE_MIC.has(browserName) || origin !== 'http') return { ok: true, skipped: true };
    await H.workspace(page, 'measure');
    await page.evaluate(() => window.OSCILLA.measure.useMicrophone());
    await page.click('#osc-measure-primary');
    await H.waitState(page, ['READY', 'INVALID', 'ERROR'], 15000);
    const res = await page.evaluate(() => {
      const io = window.OSCILLA.measure.io;
      return { state: window.OSCILLA.measure.state, kind: window.OSCILLA.measure.ioKind,
        tracks: io.openTrackCount,
        rows: [...document.querySelectorAll('[data-osc="measure.inputFacts"] .osc-metric')]
          .map((m) => m.textContent.replace(/\s+/g, ' ').trim()) };
    });
    await page.evaluate(() => window.OSCILLA.measure.engine.reset());
    const counts = await H.until(() => H.counts(page), H.zero, 3000);
    await page.evaluate(() => window.OSCILLA.measure.useLoopback());
    const ok = res.state === 'READY' && res.kind === 'microphone' && res.tracks >= 1
      && res.rows.some((r) => /^Sample rate\s*\d+ Hz$/.test(r)) && H.zero(counts);
    return { ok, ...res, counts };
  });

  def('live-rta', async ({ page, browserName }) => {
    await H.workspace(page, 'measure');
    await page.evaluate(() => window.OSCILLA.measure.useMicrophone());
    await page.click('[data-osc="measure.tab"][data-value="rta"]');
    const res = {};
    const ui = () => page.evaluate(() => {
      const a = window.OSCILLA.app;
      const q = (s) => document.querySelector(s);
      const err = q('[data-osc="measure.rtaError"]');
      return {
        running: a.meas.rtaLive.running, starting: a.meas.rtaLive.starting,
        button: q('[data-osc="measure.rtaLive"]').textContent.trim(),
        modesDisabled: [...document.querySelectorAll('[data-osc="measure.rtaMode"]')]
          .every((b) => b.disabled),
        averagingDisabled: [...document.querySelectorAll('[data-osc="measure.rtaAveraging"]')]
          .every((b) => b.disabled),
        error: err && err.offsetParent !== null ? err.textContent.trim() : null,
        summary: q('[data-osc="measure.rtaSummary"]').textContent,
        source: q('[data-osc="measure.rtaSource"]').textContent,
        chip: q('[data-osc="measure.rtaModeChip"]').textContent,
        chart: !!q('#osc-measure-chart-rta .uplot'),
      };
    });
    const counts = () => H.until(() => H.counts(page), (c) => H.zero(c) && !c.liveTap
      && c.liveLoop === 0, 3000);
    const idle = (c) => H.zero(c) && !c.liveTap && c.liveLoop === 0;
    res.before = await ui();
    if (!FAKE_MIC.has(browserName)) {
      // No fake device (WebKit): the start is refused with the browser's reason, nothing stays.
      await page.click('[data-osc="measure.rtaLive"]');
      res.refused = await H.until(ui, (u) => !u.starting && (u.error || u.running), 8000);
      res.counts = await counts();
      await page.evaluate(() => window.OSCILLA.measure.useLoopback());
      const v = H.verdict({
        disabledBefore: res.before.modesDisabled && res.before.averagingDisabled
          && res.before.button === 'Start live RTA',
        refused: !res.refused.running && !!res.refused.error && res.refused.modesDisabled
          && res.refused.averagingDisabled && res.refused.button === 'Start live RTA',
        zero: idle(res.counts),
      });
      return { ...v, ...res };
    }
    const live = () => page.evaluate(() => window.OSCILLA.measure.liveRta());
    /** Live frames of `mode` once `n` more frames were analysed (the average has settled). */
    const settled = async (mode, n = 40) => {
      const f0 = await H.until(live, (l) => l && l.mode === mode, 5000);
      const start = f0 ? f0.frames : 0;
      return H.until(live, (l) => l && l.mode === mode && l.frames >= start + n, 8000);
    };
    const bandCheck = (l) => {
      if (!l || !l.bands) return { ok: false };
      const i = l.bands.indexOf(FAKE_TONE.hz);
      const expect = 10 * Math.log10((FAKE_TONE.amplitude ** 2) / 2);
      const others = l.values.filter((v, j) => j !== i && v !== null);
      const next = others.length ? Math.max(...others) : -Infinity;
      return { ok: i >= 0 && Math.abs(l.values[i] - expect) <= 1 && l.values[i] - next >= 20,
        level: l.values[i], expect, margin: l.values[i] - next, bands: l.bands.length };
    };
    await page.click('[data-osc="measure.rtaLive"]');
    const third = await settled('third');
    res.third = bandCheck(third);
    res.thirdUnder = third ? third.underResolved.filter(Boolean).length : null;
    res.sampleRate = await page.evaluate(() => window.OSCILLA.engine.ctx.sampleRate);
    res.thirdBands = thirdBandCount(res.sampleRate);
    res.thirdUi = await H.until(ui, (u) => /highest band 1 kHz/.test(u.summary), 3000);
    res.snapshot = await page.evaluate(() => window.OSCILLA.measure.liveRtaSnapshot());
    res.spl = await page.evaluate(splMentions);
    // Octave bands.
    await page.click('[data-osc="measure.rtaMode"][data-value="octave"]');
    res.octave = bandCheck(await settled('octave'));
    // FFT: the strongest bin sits at the tone; a tone's peak bin reads 1.76-3.2 dB below its
    // band level (Hann main lobe, mean-square bins).
    await page.click('[data-osc="measure.rtaMode"][data-value="fft"]');
    const fft = await settled('fft');
    if (fft) {
      let best = 0;
      for (let k = 1; k < fft.values.length; k += 1) {
        if (fft.values[k] !== null && fft.values[k] > fft.values[best]) best = k;
      }
      const binHz = fft.sampleRate / fft.fftSize;
      res.fft = { hz: fft.frequencies[best], level: fft.values[best], binHz,
        ok: Math.abs(fft.frequencies[best] - FAKE_TONE.hz) <= binHz
          && fft.values[best] <= -23.01 - 1.76 + 1 && fft.values[best] >= -23.01 - 3.2 - 1 };
    }
    res.fftUi = await H.until(ui, (u) => /^RTA, FFT/.test(u.summary), 3000);
    await page.click('[data-osc="measure.rtaMode"][data-value="third"]');
    await settled('third', 10);
    // Expert fields (no recipe path) drive the live RTA: FFT size and window.
    await page.evaluate(() => {
      const a = window.OSCILLA.app;
      a.measureSetExpert(true);
      a.meas.setupOpen = true;
    });
    await page.selectOption('[data-osc="measure.choice"][data-field="fftSize"]', '16384');
    await page.selectOption('[data-osc="measure.choice"][data-field="window"]',
      'blackman-harris');
    const ex = await H.until(live, (l) => l && l.fftSize === 16384
      && l.window === 'blackman-harris' && l.frames > 30, 8000);
    res.expert = ex ? { ...bandCheck(ex), fftSize: ex.fftSize, analyser: ex.analyserFftSize,
      window: ex.window, under: ex.underResolved.filter(Boolean).length } : null;
    res.expertSnapshot = await page.evaluate(() => window.OSCILLA.measure.liveRtaSnapshot());
    await page.selectOption('[data-osc="measure.choice"][data-field="fftSize"]', '8192');
    await page.selectOption('[data-osc="measure.choice"][data-field="window"]', 'hann');
    await page.evaluate(() => {
      const a = window.OSCILLA.app;
      a.measureSetExpert(false);
      a.meas.setupOpen = false;
    });
    await settled('third', 10);
    // Averaging: each choice reaches the analysis and its label.
    res.averaging = {};
    for (const a of ['slow', 'instant', 'fast']) {
      await page.click(`[data-osc="measure.rtaAveraging"][data-value="${a}"]`);
      const l = await H.until(live, (x) => x && x.averaging === a && x.frames > 5, 4000);
      const u = await H.until(ui, (x) => new RegExp(a.toUpperCase()).test(x.summary), 3000);
      res.averaging[a] = !!l && l.averaging === a && new RegExp(a.toUpperCase()).test(u.summary);
    }
    // Peak hold: every held peak is at or above its band's level.
    await page.click('[data-osc="measure.rtaPeak"]');
    const pk = await settled('third', 10);
    res.peaks = !!pk && pk.values.every((v, i) => v === null || pk.peaks[i] >= v - 1e-9)
      && await page.getAttribute('[data-osc="measure.rtaPeak"]', 'aria-checked') === 'true';
    await page.click('[data-osc="measure.rtaPeak"]');
    // Freeze: no frame is analysed while frozen; the summary says so.
    await page.click('[data-osc="measure.rtaFreeze"]');
    const fz0 = await live();
    await sleep(400);
    const fz1 = await live();
    res.freeze = { frozen: fz1.frozen, held: fz0.frames === fz1.frames
      && JSON.stringify(fz0.values) === JSON.stringify(fz1.values),
    ui: (await H.until(ui, (u) => /frozen\.$/.test(u.summary), 3000)).summary };
    await page.click('[data-osc="measure.rtaFreeze"]');
    const fz2 = await H.until(live, (l) => l && l.frames > fz1.frames + 5, 3000);
    res.unfreeze = !!fz2 && !fz2.frozen;
    // Every way out stops it and releases the tracks and nodes.
    res.during = await H.counts(page);
    res.stops = {};
    const how = {
      button: () => page.click('[data-osc="measure.rtaLive"]'),
      escape: () => page.keyboard.press('Escape'),
      tab: () => page.click('[data-osc="measure.tab"][data-value="response"]'),
      workspace: () => H.workspace(page, 'experiments'),
      pagehide: () => page.evaluate(() => window.dispatchEvent(new Event('pagehide'))),
    };
    for (const [k, fn] of Object.entries(how)) {
      await H.workspace(page, 'measure');
      await page.click('[data-osc="measure.tab"][data-value="rta"]');
      if ((await ui()).running) await page.click('[data-osc="measure.rtaLive"]'); // stop first
      await counts();
      await page.click('[data-osc="measure.rtaLive"]');
      const on = await H.until(live, (l) => l && l.frames > 3, 8000);
      await fn();
      const c = await counts();
      const u = await ui();
      res.stops[k] = { on: !!on, zero: idle(c), running: u.running, counts: c };
    }
    // Exclusive: a setup check takes the input from the live RTA (one input, one owner).
    await H.workspace(page, 'measure');
    await page.click('[data-osc="measure.tab"][data-value="rta"]');
    await page.click('[data-osc="measure.rtaLive"]');
    await H.until(live, (l) => l && l.frames > 3, 8000);
    await page.click('#osc-measure-primary');
    await H.waitState(page, ['READY', 'INVALID', 'ERROR'], 15000);
    res.exclusive = await page.evaluate(() => ({ state: window.OSCILLA.measure.state,
      live: !!window.OSCILLA.measure.liveRta(), tap: window.OSCILLA.measure.counts().liveTap }));
    // ... and starting the live RTA from READY releases the checked setup first.
    await page.click('[data-osc="measure.rtaLive"]');
    await H.until(live, (l) => l && l.frames > 3, 8000);
    res.fromReady = await page.evaluate(() => ({ state: window.OSCILLA.measure.state,
      live: !!window.OSCILLA.measure.liveRta() }));
    await page.click('[data-osc="measure.rtaLive"]');
    res.after = await counts();
    await page.evaluate(() => window.OSCILLA.measure.useLoopback());
    const s = res.stops;
    const v = H.verdict({
      disabledBefore: res.before.modesDisabled && res.before.averagingDisabled
        && res.before.button === 'Start live RTA',
      third: res.third.ok && res.third.bands === res.thirdBands,
      thirdUi: res.thirdUi.summary.startsWith(`RTA, 1/3 OCTAVE, ${res.thirdBands} bands, FAST`)
        && /^LIVE · microphone input/.test(res.thirdUi.source)
        && /dB relative \(dBFS-like\)/.test(res.thirdUi.source) && res.thirdUi.chart
        && res.thirdUi.chip === '1/3 OCTAVE' && !res.thirdUi.modesDisabled,
      underResolved: res.thirdUnder > 0,
      snapshot: !!res.snapshot && res.snapshot.algorithm === 'oscilla.rta.v2'
        && res.snapshot.windowAlgorithm === 'oscilla.window.hann.v1'
        && res.snapshot.resolution === 'third' && res.snapshot.fftSize === 8192
        && res.snapshot.levelsDb.length === res.thirdBands,
      noSpl: res.spl.length === 0,
      octave: res.octave.ok,
      expert: !!res.expert && res.expert.ok && res.expert.analyser === 16384
        && res.expert.under < res.thirdUnder && !!res.expertSnapshot
        && res.expertSnapshot.fftSize === 16384
        && res.expertSnapshot.windowAlgorithm === 'oscilla.window.blackman-harris.v1',
      fft: !!res.fft && res.fft.ok && /^RTA, FFT/.test(res.fftUi.summary),
      averaging: Object.values(res.averaging).every(Boolean),
      peaks: res.peaks,
      freeze: res.freeze.frozen && res.freeze.held && /frozen\.$/.test(res.freeze.ui)
        && res.unfreeze,
      during: res.during.liveTap && res.during.tracks >= 1 && res.during.liveLoop === 1,
      stops: Object.values(s).every((x) => x.on && x.zero && !x.running),
      exclusive: res.exclusive.state === 'READY' && !res.exclusive.live && !res.exclusive.tap,
      fromReady: res.fromReady.state === 'IDLE' && res.fromReady.live,
      after: idle(res.after),
    });
    return { ...v, ...res };
  });

  def('calibration', async ({ page }) => {
    await H.workspace(page, 'measure');
    const res = {};
    res.bad = await page.evaluate(() => window.OSCILLA.app.measureImportCalibrationText('a,b\n',
      'broken.csv'));
    res.good = await page.evaluate(() => window.OSCILLA.app.measureImportCalibrationText(
      'Hz,dB\n20,0.5\n1000,0\n15000,-1.5\n', 'gate-mic.csv'));
    res.freq = await page.textContent('[data-osc="measure.freqIndicator"]');
    res.name = await page.textContent('[data-osc="measure.calName"]');
    await page.click('[data-osc="measure.levelCal"]');
    // Without a captured reference nothing is stored.
    await page.click('[data-osc="levelCal.save"]');
    res.needsCapture = await page.evaluate(() => window.OSCILLA.app.meas.levelForm.error);
    res.scale = await page.textContent('[data-osc="levelCal.scale"]');
    await page.click('[data-osc="levelCal.manual"]'); // advanced: the reading typed by hand
    await page.fill('#osc-lc-obs', '');
    await page.click('[data-osc="levelCal.save"]');
    res.refused = await page.evaluate(() => window.OSCILLA.app.meas.levelForm.error);
    await page.fill('#osc-lc-obs', '-32.5');
    await page.fill('#osc-lc-cond', 'gate: synthetic values');
    await page.click('[data-osc="levelCal.save"]');
    await sleep(100);
    res.level = await page.textContent('[data-osc="measure.levelIndicator"]');
    res.dialogClosed = await page.evaluate(() => !document.getElementById('osc-dlg-level-cal')
      .open);
    // Back to the uncalibrated state for the checks that follow.
    await page.evaluate(() => {
      const a = window.OSCILLA.app;
      a.measureClearLevelCalibration();
      a.measureClearCalibration();
      a.alerts = [];
    });
    res.after = await page.textContent('[data-osc="measure.levelIndicator"]');
    await page.evaluate(() => window.OSCILLA.app.measureSetLevelManual(false));
    const ok = res.bad === false && res.good === true && /CALIBRATED/.test(res.freq)
      && !/UNCALIBRATED/.test(res.freq) && /gate-mic/.test(res.name) && !!res.refused
      && /Capture the reference first/.test(res.needsCapture)
      && /mean-square scale/.test(res.scale)
      && /CALIBRATED/.test(res.level) && !/UNCALIBRATED/.test(res.level) && res.dialogClosed
      && /UNCALIBRATED/.test(res.after);
    return { ok, ...res };
  });

  def('level-reference', async ({ page }) => {
    await H.workspace(page, 'measure');
    await H.loopback(page);
    // The loopback io captures the instrument output: a 1 kHz sine is the reference tone.
    await page.evaluate(() => {
      const a = window.OSCILLA.app;
      a.setWaveform('sine');
      a.setFrequency(1000);
      a.safetyLimit = 10;
    });
    await page.click('[data-osc="measure.levelCal"]');
    await page.evaluate(() => window.OSCILLA.app.play('hold'));
    await sleep(300);
    const captured = await page.evaluate(() => window.OSCILLA.app.measureCaptureLevelReference());
    await page.evaluate(() => { window.OSCILLA.app.stopNow(); });
    const res = { captured };
    res.reading = await page.textContent('[data-osc="levelCal.reading"]');
    res.form = await page.evaluate(() => ({ ...window.OSCILLA.app.meas.levelForm,
      reading: window.OSCILLA.app.meas.levelForm.reading }));
    await page.fill('#osc-lc-cond', 'gate: loopback reference');
    await page.click('[data-osc="levelCal.save"]');
    res.cal = await page.evaluate(() => {
      const c = window.OSCILLA.measure.levelCalibration;
      return c ? { method: c.method, scale: c.scale, schemaVersion: c.schemaVersion,
        input: c.input, observed: c.observedDbRelative, conditions: c.conditions } : null;
    });
    res.dialogClosed = await page.evaluate(() => !document.getElementById('osc-dlg-level-cal')
      .open);
    res.indicator = await page.textContent('[data-osc="measure.levelIndicator"]');
    // Another input (a different sample rate and device): the calibration does not apply.
    await page.evaluate(() => window.OSCILLA.measure.setInputNow({
      device: { label: 'other', id: 'other-device' },
      constraints: { applied: { echoCancellation: false, noiseSuppression: false,
        autoGainControl: false, channelCount: 1 } }, sampleRate: 22050 }));
    res.voided = await page.textContent('[data-osc="measure.levelIndicator"]');
    res.voidText = await page.textContent('[data-osc="measure.levelVoid"]');
    // Stop: a capture aborted half-way stores nothing and leaves no node, capture or port.
    await page.click('[data-osc="measure.levelCal"]');
    const pending = page.evaluate(() => window.OSCILLA.app.measureCaptureLevelReference());
    await page.waitForFunction(() => window.OSCILLA.measure.referenceCapturing, null,
      { timeout: 5000 });
    await sleep(400);
    await page.click('[data-osc="levelCal.stop"]');
    res.stopped = await pending;
    res.stopError = await page.evaluate(() => window.OSCILLA.app.meas.levelForm.error);
    res.counts = await H.until(() => H.counts(page), H.zero, 3000);
    await page.evaluate(() => {
      const a = window.OSCILLA.app;
      a.measureCloseLevelCalibration();
      a.measureClearLevelCalibration();
      a.safetyLimit = 2;
      a.setFrequency(440);
      a.alerts = [];
    });
    const obs = res.cal ? res.cal.observed : NaN;
    // master gain 0.08 → about −25 dB on the band scale (a few dB for the limiter chain)
    return { ...res, ...H.verdict({
      captured: captured === true,
      readingText: /^Reading −\d+\.\d\d dB relative, 1000 Hz one-third-octave band/.test(
        res.reading),
      method: !!res.cal && res.cal.method === 'captured' && res.cal.scale === 'band-mean-square'
        && res.cal.schemaVersion === 2,
      bound: !!res.cal && !!res.cal.input && res.cal.input.sampleRate > 0,
      testContextNamed: !!res.cal && /TEST CONTEXT/.test(res.cal.conditions || ''),
      plausible: obs > -40 && obs < -15,
      dialogClosed: res.dialogClosed,
      calibrated: /CALIBRATED/.test(res.indicator) && !/UNCALIBRATED/.test(res.indicator),
      voided: /UNCALIBRATED/.test(res.voided),
      reason: /taken with a different input device.*sample rate/.test(res.voidText || ''),
      stopped: res.stopped === false && /stopped/.test(res.stopError),
      clean: H.zero(res.counts),
    }) };
  });

  def('profile-convention', async ({ page }) => {
    await H.workspace(page, 'measure');
    const res = {};
    res.ret = await page.evaluate(() => window.OSCILLA.app.measureImportCalibrationText(
      'Freq(Hz)\tGain(dB)\n20\t4\n1000\t0\n10000\t2\n', 'eq-file.txt'));
    res.open = await page.evaluate(() => document.getElementById('osc-dlg-cal-convention').open);
    res.loadedBefore = await page.evaluate(() => !!window.OSCILLA.app.meas.cal.profile);
    res.basis = await page.textContent('[data-osc="calConv.basis"]');
    res.loadDisabled = await page.isDisabled('[data-osc="calConv.load"]');
    await page.check('[data-osc="calConv.choice"][value="correction"]');
    await page.click('[data-osc="calConv.load"]');
    await page.waitForFunction(() => !document.getElementById('osc-dlg-cal-convention').open,
      null, { timeout: 5000 });
    res.profile = await page.evaluate(() => window.OSCILLA.app.meas.cal.profile);
    res.text = await page.textContent('[data-osc="measure.calConvention"]');
    await page.evaluate(() => { window.OSCILLA.app.measureClearCalibration();
      window.OSCILLA.app.alerts = []; });
    return { ...res, ...H.verdict({
      asked: res.ret === 'needs-choice' && res.open && !res.loadedBefore,
      basis: /"Gain\(dB\)" does not say/.test(res.basis),
      disabledUntilChosen: res.loadDisabled === true,
      loaded: !!res.profile && res.profile.convention === 'correction',
      shown: /correction to add/.test(res.text) && /becomes \+4\.00 dB/.test(res.text),
    }) };
  });

  def('view-options', async ({ page }) => {
    await H.workspace(page, 'measure');
    await H.loopback(page);
    await page.evaluate(() => {
      window.OSCILLA.measure.setValues({ repeats: 1, f1: 2000 });
      window.OSCILLA.app.measureSetView('normalization', '1k');
    });
    const run = await H.run(page, () => page.evaluate(() => {
      window.OSCILLA.app.measureStart();
    }));
    const res = await page.evaluate(() => {
      const a = window.OSCILLA.app;
      return {
        alerts: (a.alerts || []).map((x) => x.title),
        normalization: a.meas.view.normalization,
        avail: a.meas.normAvail['1k'],
        disabled: document.querySelector('#osc-m-normalization option[value="1k"]').disabled,
        refused: a.measureSetView('normalization', '1k'),
        summary: a.meas.response && a.meas.response.summary,
      };
    });
    await page.evaluate(() => window.OSCILLA.app.measureSetView('irSpan', 'direct'));
    res.ir = await page.evaluate(() => {
      const v = window.OSCILLA.measure.irView;
      return v ? { factor: v.decimation.factor, points: v.x.length,
        inSpan: Array.from(v.x).filter((t) => t >= -2 && t <= 20).length,
        sampleRate: window.OSCILLA.engine.ctx.sampleRate } : null;
    });
    await page.evaluate(() => {
      const a = window.OSCILLA.app;
      a.measureSetView('irSpan', 'early');
      window.OSCILLA.measure.setValues({ f1: 20 });
      a.alerts = [];
    });
    return { run, ...res, ...H.verdict({
      complete: run.state === 'COMPLETE',
      noFailure: !res.alerts.includes('Measurement failed'),
      reset: res.normalization === 'none',
      disabled: res.disabled === true && res.avail.ok === false && /outside/.test(res.avail.reason),
      refused: res.refused === false,
      response: /^Frequency response/.test(res.summary || ''),
      // Undecimated: every sample of the 22 ms span (1056 at 48 kHz, 970 at 44.1 kHz).
      irDirect: !!res.ir && res.ir.factor === 1
        && res.ir.inSpan >= Math.floor(0.022 * res.ir.sampleRate) - 1,
    }) };
  });

  def('evidence-at-completion', async ({ page }) => {
    await H.workspace(page, 'measure');
    await H.loopback(page);
    const res = {};
    res.importA = await page.evaluate(() => window.OSCILLA.app.measureImportCalibrationText(
      'Hz,dB\n20,0.5\n1000,0\n15000,-1.5\n', 'mic-a.csv'));
    res.profileA = await page.evaluate(() => window.OSCILLA.app.meas.cal.profile.id);
    await page.fill('#osc-m-name', 'Gate evidence');
    await page.fill('#osc-m-notes', 'start notes');
    await page.click('#osc-measure-primary'); // Check setup
    await H.waitState(page, ['READY', 'INVALID', 'ERROR'], 15000);
    res.run = await H.run(page, () => page.click('#osc-measure-primary')); // Start measurement
    if (res.run.state !== 'COMPLETE') return { ok: false, failed: ['run'], ...res };
    const evidence = () => page.evaluate(() => {
      const el = document.querySelector('[data-osc="measure.evidenceNotes"]');
      return el && el.offsetParent !== null ? el.textContent.trim() : '';
    });
    res.before = await evidence();
    // After COMPLETE: another profile, a level calibration made now, notes edited.
    res.importB = await page.evaluate(() => window.OSCILLA.app.measureImportCalibrationText(
      'Hz,dB\n20,-3\n1000,2\n15000,4\n', 'mic-b.csv'));
    await page.click('[data-osc="measure.levelCal"]');
    await page.click('[data-osc="levelCal.manual"]');
    await page.fill('#osc-lc-obs', '-32.5');
    await page.fill('#osc-lc-cond', 'gate: created after the measurement');
    await page.click('[data-osc="levelCal.save"]');
    await page.fill('#osc-m-notes', 'edited after');
    await sleep(100);
    res.level = await page.textContent('[data-osc="measure.levelIndicator"]');
    res.after = await evidence();
    await page.click('#osc-measure-save');
    res.save = await H.saved(page);
    if (res.save) return { ok: false, failed: ['save'], ...res };
    res.record = await page.evaluate(async () => {
      const id = window.OSCILLA.app.meas.savedId;
      const e = await window.OSCILLA.experiments.store().get(id);
      return { frequency: e.calibration.frequency, level: e.calibration.level,
        notes: e.environment.notes, annotations: e.annotations || null,
        levelCalibrated: e.quality.metrics.levelCalibrated,
        corrected: e.algorithms.calibration || null };
    });
    await page.evaluate(() => {
      const a = window.OSCILLA.app;
      a.measureClearLevelCalibration();
      a.measureClearCalibration();
      a.measureSetLevelManual(false);
      a.meas.notes = '';
      a.meas.name = '';
      a.alerts = [];
    });
    const r = res.record;
    return { ...res, ...H.verdict({
      imported: res.importA === true && res.importB === true,
      calibratedNow: /CALIBRATED/.test(res.level) && !/UNCALIBRATED/.test(res.level),
      quietBefore: res.before === '',
      stated: res.after.startsWith('Calibration changed after this measurement; the saved '
        + 'record keeps the calibration it was measured with (frequency profile "mic-a", levels '
        + 'relative).') && /Notes edited after this measurement started are saved as an /
        .test(res.after) && !/SPL/.test(res.after),
      namesA: !!r.frequency && r.frequency.id === res.profileA && r.frequency.name === 'mic-a'
        && !!r.corrected,
      noLevel: r.level === null && r.levelCalibrated === false,
      startNotes: /^start notes\b/.test(r.notes || '') && !/edited/.test(r.notes || ''),
      annotation: !!r.annotations && r.annotations.notes === 'edited after',
    }) };
  });

  def('experiments', async ({ page, context }) => {
    await H.workspace(page, 'experiments');
    const res = {};
    res.store = await page.evaluate(() => ({ kind: window.OSCILLA.app.exps.storeKind,
      note: window.OSCILLA.app.exps.storeNote,
      shown: !!document.querySelector('.osc-x-store') && document.querySelector('.osc-x-store')
        .offsetParent !== null }));
    const before = await page.evaluate(() => window.OSCILLA.app.exps.rows.length);
    for (const k of ['a', 'b', 'c']) {
      res[`import${k}`] = await page.evaluate((t) => window.OSCILLA.app.experimentsImportText(t),
        fixtures[k].json);
    }
    res.again = await page.evaluate((t) => window.OSCILLA.app.experimentsImportText(t),
      fixtures.a.json);
    // Every step below waits for the state it asserts (bounded), never a fixed sleep: the store
    // is asynchronous IndexedDB, and Alpine renders on a later microtask/frame. waitMs records
    // how long each took (the fixed 150-200 ms sleeps these replace were not always enough).
    res.waitMs = {};
    const timed = async (k, p) => {
      const t0 = Date.now();
      const v = await p;
      res.waitMs[k] = Date.now() - t0;
      return v;
    };
    res.rows = await page.evaluate(() => window.OSCILLA.app.exps.rows.length - 0);
    // Open A, then compare A + B (equivalent) and A + C (not equivalent).
    await page.evaluate(() => window.OSCILLA.app.experimentsOpen('fixture-a'));
    res.detail = await timed('detail', H.until(() => page.evaluate(() => ({
      compact: document.querySelector('[data-osc="exp.compact"]').textContent,
      chart: !!document.querySelector('#osc-exp-chart-detail .uplot'),
      testContext: window.OSCILLA.app.exps.detail.testContext,
    })), (d) => /synthetic A/.test(d.compact) && d.chart, 5000));
    const compare = async (ids) => {
      const v = await page.evaluate(async (list) => {
        const c = await window.OSCILLA.app.experimentsCompare(list);
        return { compatible: c.compatible, delta: c.delta.ok, reason: c.delta.reason || null };
      }, ids);
      // The rendered delta text follows the view model (Alpine): wait until it says this pair.
      const dom = await timed(`compare-${ids.join('-')}`, H.until(() => page.evaluate(() => ({
        text: document.querySelector('[data-osc="exp.delta"]').textContent,
        overlay: !!document.querySelector('#osc-exp-chart-overlay .uplot') })),
      (d) => d.overlay && (v.delta ? /^A − B over/.test(d.text) : /not shown/.test(d.text)),
      5000));
      return { ...v, ...dom };
    };
    res.ab = await compare(['fixture-a', 'fixture-b']);
    res.ac = await compare(['fixture-a', 'fixture-c']);
    // Rename (dialog), duplicate, export (download re-validates), CSV.
    await page.evaluate(() => window.OSCILLA.app.experimentsOpen('fixture-b'));
    await page.click('[data-osc="exp.rename"]');
    await page.fill('#osc-exp-rename-name', 'TEST CONTEXT · renamed B');
    await page.click('[data-osc="exp.renameSave"]');
    res.renamed = await timed('renamed', H.until(() => page.evaluate(() => window.OSCILLA.app
      .exps.rows.some((r) => r.name === 'TEST CONTEXT · renamed B')), Boolean, 5000));
    res.dup = await page.evaluate(() => window.OSCILLA.app.experimentsDuplicate('fixture-b'));
    // ADR 0040: rename is metadata only (hashes kept), the duplicate is the same run
    // (duplicateOf, same hashes), and a put that changes a completed run is refused.
    res.immutable = await page.evaluate(async ({ dupId, before }) => {
      const app = window.OSCILLA.app;
      const s = app.experimentsTestSeam().store();
      const b = await s.get('fixture-b');
      const d = await s.get(dupId);
      // A changed fact that no hash covers (the notes recorded at measurement time) is refused
      // as immutable; an edited verdict without a matching hash already fails validation.
      let refused = null;
      try {
        await s.put({ ...b, environment: { notes: 'rewritten afterwards' } });
      } catch (err) { refused = err.code; }
      let forged = null;
      try {
        await s.put({ ...b, quality: { ...b.quality, status: 'GOOD' } });
      } catch (err) { forged = err.code; }
      let renamedByPut = null;
      try {
        await s.put({ ...b, name: 'renamed by put' });
      } catch (err) { renamedByPut = err.code; }
      return { name: b.name, hashKept: b.provenance.resultHash === before,
        runIds: b.measurement.runs.map((r) => r.id).join(','),
        dupOf: d.provenance.duplicateOf, dupHash: d.provenance.resultHash === before,
        dupCreated: d.provenance.createdAt === b.provenance.createdAt, refused, forged,
        renamedByPut, stillGood: (await s.get('fixture-b')).quality.status === b.quality.status
          && (await s.get('fixture-b')).environment.notes === b.environment.notes };
    }, { dupId: res.dup, before: fixtures.b.experiment.provenance.resultHash });
    const [dl] = await Promise.all([page.waitForEvent('download'),
      page.click('[data-osc="exp.export"]')]);
    const file = await dl.path();
    const text = fs.readFileSync(file, 'utf8');
    res.exportName = dl.suggestedFilename();
    res.exportValid = await page.evaluate(async (t) => {
      const parsed = JSON.parse(t);
      return parsed.kind === 'oscilla-experiment' && parsed.experimentId === 'fixture-b';
    }, text);
    const [csv] = await Promise.all([page.waitForEvent('download'),
      page.click('[data-osc="exp.csvTransfer"]')]);
    const csvText = fs.readFileSync(await csv.path(), 'utf8');
    res.csv = { name: csv.suggestedFilename(), head: csvText.split('\n')[0],
      spl: /SPL/.test(csvText), unit: /magnitude_db_relative/.test(csvText) };
    // Show in MEASURE (inspection), then back.
    await page.click('[data-osc="exp.inspect"]');
    res.inspect = await timed('inspect', H.until(() => page.evaluate(() => ({
      mode: document.querySelector('#osc-app').dataset.mode,
      shown: document.querySelector('[data-osc="measure.shown"]').textContent,
      banner: document.querySelector('[data-osc="measure.testContext"]').offsetParent !== null,
    })), (x) => x.mode === 'measure' && /Saved experiment/.test(x.shown) && x.banner, 5000));
    await H.workspace(page, 'experiments');
    // Explicit delete: the dialog asks first; Cancel keeps it, Delete removes it.
    await page.evaluate((id) => window.OSCILLA.app.experimentsOpen(id), res.dup);
    await page.click('[data-osc="exp.delete"]');
    await page.click('[data-osc="exp.deleteCancel"]');
    const kept = await page.evaluate((id) => window.OSCILLA.app.exps.rows.some((r) => r.id === id),
      res.dup);
    await page.click('[data-osc="exp.delete"]');
    await page.click('[data-osc="exp.deleteConfirm"]');
    res.deleted = kept && await timed('deleted', H.until(() => page.evaluate((id) => !window
      .OSCILLA.app.exps.rows.some((r) => r.id === id), res.dup), Boolean, 5000));
    await page.evaluate(() => { window.OSCILLA.app.alerts = []; });
    void context;
    res.before = before;
    const v = H.verdict({
      store: res.store.kind === 'indexeddb' || (res.store.kind === 'memory'
        && /memory for this page view/.test(res.store.note) && res.store.shown),
      imports: res.importa === 'fixture-a' && res.importb === 'fixture-b'
        && res.importc === 'fixture-c',
      again: res.again === null,
      rows: res.rows === before + 3,
      detail: /TEST CONTEXT · synthetic A/.test(res.detail.compact) && res.detail.chart
        && res.detail.testContext,
      ab: res.ab.compatible && res.ab.delta && /^A − B over/.test(res.ab.text) && res.ab.overlay,
      ac: !res.ac.compatible && !res.ac.delta && /not shown/.test(res.ac.text),
      renamed: res.renamed,
      dup: typeof res.dup === 'string',
      immutable: res.immutable.name === 'TEST CONTEXT · renamed B' && res.immutable.hashKept
        && res.immutable.runIds === 'run-1,run-2,run-3' && res.immutable.dupOf === 'fixture-b'
        && res.immutable.dupHash && res.immutable.dupCreated
        && res.immutable.refused === 'immutable' && res.immutable.forged === 'invalid'
        && res.immutable.renamedByPut === 'immutable'
        && res.immutable.stillGood,
      export: /\.oscilla\.json$/.test(res.exportName) && res.exportValid,
      csv: /\.csv$/.test(res.csv.name) && /^# OSCILLA/.test(res.csv.head) && !res.csv.spl
        && res.csv.unit,
      inspect: res.inspect.mode === 'measure' && /Saved experiment/.test(res.inspect.shown)
        && res.inspect.banner,
      deleted: res.deleted,
    });
    return { ...v, ...res };
  });

  def('experiments-ir', async ({ page }) => {
    await H.workspace(page, 'experiments');
    for (const k of ['a', 'b', 'c']) {
      await page.evaluate((t) => window.OSCILLA.app.experimentsImportText(t), fixtures[k].json);
    }
    const compare = (ids) => page.evaluate(async (list) => {
      const c = await window.OSCILLA.app.experimentsCompare(list);
      return { ok: c.ir.ok, reason: c.ir.reason || null, labels: c.ir.labels || null };
    }, ids);
    const dom = (want) => H.until(() => page.evaluate(() => {
      const host = document.querySelector('#osc-exp-chart-ir');
      const v = window.OSCILLA.experiments.irView;
      return { text: document.querySelector('[data-osc="exp.ir"]').textContent,
        axis: document.querySelector('[data-osc="exp.irAxis"]').textContent,
        shown: host.offsetParent !== null, chart: !!host.querySelector('.uplot'),
        series: v ? v.series.length : 0, x: v ? [v.axes.x.range[0], v.axes.x.range[1]] : null,
        delta: document.querySelector('[data-osc="exp.delta"]').textContent };
    }), want, 5000);
    const res = {};
    res.ab = { ...(await compare(['fixture-a', 'fixture-b'])),
      ...(await dom((d) => /^Impulse responses A, B overlaid/.test(d.text) && d.chart
        && d.shown && d.series === 2)) };
    res.ac = { ...(await compare(['fixture-a', 'fixture-c'])),
      ...(await dom((d) => /^IR overlay not shown/.test(d.text) && !d.shown)) };
    await page.evaluate(() => { window.OSCILLA.app.alerts = []; });
    return { ...res, ...H.verdict({
      abOverlay: res.ab.ok && res.ab.shown && res.ab.chart && res.ab.series === 2
        && res.ab.x[0] === -5 && res.ab.x[1] === 200,
      abLabels: /time re each direct peak/.test(res.ab.axis) && /original scale/.test(res.ab.text),
      abNoIrDelta: /not defined for impulse responses/.test(res.ab.text),
      abDeltaStill: /^A − B over/.test(res.ab.delta),
      acRefused: !res.ac.ok && !res.ac.shown && res.ac.series === 0
        && /not shown for non-equivalent experiments/.test(res.ac.text),
    }) };
  });

  def('experiments-changes', async ({ page }) => {
    await H.workspace(page, 'experiments');
    for (const k of ['a', 'b', 'c']) {
      await page.evaluate((t) => window.OSCILLA.app.experimentsImportText(t), fixtures[k].json);
    }
    const read = () => page.evaluate(() => {
      const sec = document.querySelector('[data-osc="exp.changes"]');
      if (!sec) return { missing: true };
      const pair = sec.querySelector('[data-osc="exp.changePair"]');
      const groups = [...sec.querySelectorAll('details')];
      const r = sec.getBoundingClientRect();
      return {
        shown: sec.offsetParent !== null,
        h4: sec.querySelectorAll('h4').length, h5: [...sec.querySelectorAll('h5')]
          .map((h) => h.textContent), h6: sec.querySelectorAll('h6').length,
        lists: [...sec.querySelectorAll('ul')].every((u) => u.getAttribute('role') === 'list'),
        groups: groups.map((d) => ({ label: d.querySelector('h6').textContent, open: d.open,
          items: [...d.querySelectorAll('li')].map((li) => li.textContent) })),
        text: sec.textContent, pair: !!pair,
        fits: sec.scrollWidth <= sec.clientWidth + 1 && r.right <= window.innerWidth + 1,
        first: (window.OSCILLA.app.exps.compare && window.OSCILLA.app.exps.compare.entries[0]
          || {}).id || null,
      };
    });
    const res = {};
    await page.evaluate(() => window.OSCILLA.app.experimentsCompare(['fixture-a', 'fixture-c']));
    res.ac = await H.until(read, (d) => d.pair && d.groups.length >= 2, 5000);
    // Keyboard: Enter on the collapsed group's summary opens it.
    res.meta = res.ac.groups ? res.ac.groups.findIndex((g) => g.label === 'Metadata') : -1;
    if (res.meta >= 0) {
      await page.evaluate((i) => document.querySelectorAll('[data-osc="exp.changes"] details')[i]
        .querySelector('summary').focus(), res.meta);
      await page.keyboard.press('Enter');
      res.opened = await H.until(() => page.evaluate((i) => document.querySelectorAll(
        '[data-osc="exp.changes"] details')[i].open, res.meta), Boolean, 2000);
    }
    // Baseline: mark C through the detail panel's button, then compare one selected run.
    await page.evaluate(() => window.OSCILLA.app.experimentsOpen('fixture-c'));
    await H.until(() => page.evaluate(() => !!window.OSCILLA.app.exps.detail
      && window.OSCILLA.app.exps.detail.id === 'fixture-c'), Boolean, 5000);
    await page.click('[data-osc="exp.baseline"]');
    res.marked = await H.until(() => page.evaluate(() => ({
      id: window.OSCILLA.app.exps.baselineId,
      pressed: document.querySelector('[data-osc="exp.baseline"]').getAttribute('aria-pressed'),
      chip: [...document.querySelectorAll('[data-osc="exp.row"]')].filter((r) => [...r
        .querySelectorAll('.osc-m-chip')].some((c) => c.offsetParent !== null
        && c.textContent.trim() === 'BASELINE')).map((r) => r.dataset.id) })),
    (m) => m.id === 'fixture-c' && m.pressed === 'true' && m.chip.length === 1, 5000);
    res.canCompare = await page.evaluate(() => {
      const app = window.OSCILLA.app;
      app.exps.selected = [];
      app.exps.rows = app.exps.rows.map((r) => ({ ...r, selected: false }));
      app.experimentsToggleSelect('fixture-a');
      return app.exps.canCompare;
    });
    await page.click('[data-osc="exp.compare"]');
    res.base = await H.until(read, (d) => d.first === 'fixture-c'
      && d.h5.some((h) => /\(baseline\)/.test(h)), 5000);
    // 390 px wide.
    await page.setViewportSize({ width: 390, height: 844 });
    res.narrow = await H.until(read, (d) => d.fits, 2000);
    await page.setViewportSize({ width: 1536, height: 1024 });
    // Clear the mark so later checks see no baseline.
    await page.evaluate(() => window.OSCILLA.app.experimentsSetBaseline('fixture-c', false));
    res.cleared = await H.until(() => page.evaluate(() => window.OSCILLA.app.exps.baselineId),
      (x) => x === null, 5000);
    await page.evaluate(() => {
      window.OSCILLA.app.exps.selected = [];
      window.OSCILLA.app.alerts = [];
    });
    const g = (d, label) => (d.groups || []).find((x) => x.label === label) || { items: [] };
    return { ...res, ...H.verdict({
      section: !res.ac.missing && res.ac.shown,
      headings: res.ac.h4 === 1 && res.ac.h5[0] === 'Changed between runs A and B'
        && res.ac.h6 >= 2 && res.ac.lists,
      recipe: g(res.ac, 'Recipe').open && g(res.ac, 'Recipe').items
        .includes('Stimulus f1: 20 Hz → 50 Hz'),
      executionFirst: !!res.ac.groups && res.ac.groups[0].open
        && res.ac.groups.findIndex((x) => !x.open) > 0,
      metadataCollapsed: !g(res.ac, 'Metadata').open
        && g(res.ac, 'Metadata').items.some((t) => /^Name: /.test(t)),
      keyboard: res.opened === true,
      notCausal: !/\bcaused\b|because|due to/i.test(res.ac.text.replace(
        'it does not show what caused', '')),
      baseline: res.marked.id === 'fixture-c' && res.marked.pressed === 'true'
        && res.marked.chip.join() === 'fixture-c',
      againstBaseline: res.canCompare === true && res.base.first === 'fixture-c'
        && res.base.h5[0] === 'Changed between runs A (baseline) and B',
      narrow: res.narrow.fits,
      cleared: res.cleared === null,
    }) };
  });

  def('calibration-export', async ({ page }) => {
    await H.workspace(page, 'measure');
    const res = {};
    const download = async (sel) => {
      const [dl] = await Promise.all([page.waitForEvent('download'), page.click(sel)]);
      return { name: dl.suggestedFilename(), text: fs.readFileSync(await dl.path(), 'utf8') };
    };
    res.loaded = await page.evaluate(() => window.OSCILLA.app.measureImportCalibrationText(
      'Hz,dB\n20,0.5\n1000,0\n15000,-1.5\n', 'export-mic.csv'));
    res.id = await page.evaluate(() => window.OSCILLA.app.meas.cal.profile.id);
    res.buttons = await H.until(() => page.evaluate(() => ['calExportCsv', 'calExportJson']
      .every((k) => document.querySelector(`[data-osc="measure.${k}"]`).offsetParent !== null)),
    Boolean, 2000);
    const csv = await download('[data-osc="measure.calExportCsv"]');
    const csv2 = await download('[data-osc="measure.calExportCsv"]');
    const json = await download('[data-osc="measure.calExportJson"]');
    res.csvName = csv.name;
    res.jsonName = json.name;
    res.sameBytes = csv.text === csv2.text && csv.name === csv2.name;
    // Both files import back through the same UI path: the same profile id and convention.
    res.back = {};
    for (const [k, f] of [['csv', csv], ['json', json]]) {
      res.back[k] = await page.evaluate(([text, name]) => {
        const a = window.OSCILLA.app;
        a.measureClearCalibration();
        const r = a.measureImportCalibrationText(text, name);
        return { r, id: a.meas.cal.profile && a.meas.cal.profile.id,
          name: a.meas.cal.profile && a.meas.cal.profile.name,
          convention: a.meas.cal.profile && a.meas.cal.profile.convention };
      }, [f.text, f.name]);
    }
    // A correction profile (the sign chosen in the dialog) re-imports without the question.
    res.correction = await page.evaluate(async () => {
      const a = window.OSCILLA.app;
      a.measureClearCalibration();
      const first = a.measureImportCalibrationText('Hz,Gain(dB)\n20,3\n1000,0\n', 'eq.csv');
      const loaded = a.measureConfirmCalibrationConvention('correction');
      const id = a.meas.cal.profile.id;
      const text = a.measureExportCalibration('csv');
      a.measureClearCalibration();
      const again = a.measureImportCalibrationText(text, 'eq-copy.csv');
      return { first, loaded, again, same: a.meas.cal.profile && a.meas.cal.profile.id === id,
        convention: a.meas.cal.profile && a.meas.cal.profile.convention,
        dialog: document.getElementById('osc-dlg-cal-convention').open };
    });
    await page.evaluate(() => {
      const a = window.OSCILLA.app;
      a.measureClearCalibration();
      a.alerts = [];
    });
    res.hidden = await H.until(() => page.evaluate(() => document.querySelector(
      '[data-osc="measure.calExportCsv"]').offsetParent === null), Boolean, 2000);
    return { ...res, ...H.verdict({
      loaded: res.loaded === true && /^[0-9a-f]{64}$/.test(res.id) && res.buttons,
      names: res.csvName === `export-mic-${res.id.slice(0, 8)}.calibration.csv`
        && res.jsonName === `export-mic-${res.id.slice(0, 8)}.calibration.json`,
      deterministic: res.sameBytes,
      csv: /^# OSCILLA frequency calibration profile/.test(csv.text)
        && csv.text.includes(`# id: ${res.id}`) && /^frequency_hz,deviation_db$/m.test(csv.text),
      json: JSON.parse(json.text).id === res.id && JSON.parse(json.text).format
        === 'oscilla.calibration',
      roundTrip: ['csv', 'json'].every((k) => res.back[k].r === true && res.back[k].id === res.id
        && res.back[k].name === 'export-mic' && res.back[k].convention === 'deviation'),
      correction: res.correction.first === 'needs-choice' && res.correction.loaded === true
        && res.correction.again === true && res.correction.same
        && res.correction.convention === 'correction' && !res.correction.dialog,
      hiddenWithoutProfile: res.hidden,
    }) };
  });

  def('input-device', async ({ page, browserName, origin }) => {
    await H.workspace(page, 'measure');
    const view = () => page.evaluate(() => {
      const a = window.OSCILLA.app;
      const el = document.getElementById('osc-m-input-device');
      return { ...JSON.parse(JSON.stringify(a.meas.input)), value: el.value,
        disabled: el.disabled, deviceId: window.OSCILLA.measure.deviceId,
        msg: document.querySelector('[data-osc="measure.inputMissing"]').offsetParent !== null };
    });
    // TEST CONTEXT: no input device; the choice is disabled.
    await page.evaluate(() => window.OSCILLA.measure.useLoopback());
    const loop = await view();
    await page.evaluate(() => window.OSCILLA.measure.useMicrophone());
    const before = await view();
    const base = { loopDisabled: loop.disabled && /TEST CONTEXT/.test(loop.status),
      defaultFirst: before.options[0].value === '' && before.value === '' && !before.disabled
        // Listed only after a check opened the microphone (earlier checks may have done so).
        && /Run the setup check to list the inputs|listed by the browser|lists no input/
          .test(before.status) };
    if (!FAKE_MIC.has(browserName) || origin !== 'http') {
      await page.evaluate(() => window.OSCILLA.measure.useLoopback());
      return { skipped: 'no fake microphone', loop, before, ...H.verdict(base) };
    }
    // Record every getUserMedia constraint; let the test hide an input from the list and make
    // it unopenable (an unplugged device), as the browser would.
    await page.evaluate(() => {
      const md = navigator.mediaDevices;
      const gum = md.getUserMedia.bind(md);
      const list = md.enumerateDevices.bind(md);
      window.__oscDev = { calls: [], hide: null, gone: null };
      md.getUserMedia = async (c) => {
        window.__oscDev.calls.push(JSON.parse(JSON.stringify(c)));
        const ex = c && c.audio && c.audio.deviceId && c.audio.deviceId.exact;
        if (ex && ex === window.__oscDev.gone) {
          throw Object.assign(new Error('Constraints could not be satisfied.'),
            { name: 'OverconstrainedError' });
        }
        return gum(c);
      };
      md.enumerateDevices = async () => (await list())
        .filter((d) => d.deviceId !== window.__oscDev.hide);
    });
    await H.recordLive(page);
    const calls = () => page.evaluate(() => window.__oscDev.calls.map((c) => (c.audio
      && c.audio.deviceId ? c.audio.deviceId.exact || null : null)));
    const check = async () => {
      await page.click('#osc-measure-primary');
      return H.waitState(page, ['READY', 'IDLE', 'ERROR', 'INVALID'], 15000)
        .then(() => page.evaluate(() => window.OSCILLA.measure.state));
    };
    const res = { loop, before };
    res.firstState = await check();
    res.listed = await H.until(view, (v) => v.options.length >= 2, 3000);
    const chosen = res.listed.options.find((o) => o.value !== '');
    if (chosen) {
      await page.selectOption('#osc-m-input-device', chosen.value);
      res.afterSelect = await view();
      res.secondState = await check();
      res.inputNow = await page.evaluate(() => {
        const n = window.OSCILLA.measure.inputNow;
        return n && n.constraints && n.constraints.requested
          ? n.constraints.requested.deviceId : null;
      });
      res.ioDeviceId = await page.evaluate(() => window.OSCILLA.measure.ioDeviceId);
      // The chosen input disappears: it stays selected, marked, announced; a check refuses it.
      await page.evaluate((id) => {
        window.__oscDev.hide = id;
        window.__oscDev.gone = id;
        window.OSCILLA.measure.engine.reset();
        navigator.mediaDevices.dispatchEvent(new Event('devicechange'));
      }, chosen.value);
      res.gone = await H.until(view, (v) => v.missing && v.msg, 3000);
      res.goneState = await check();
      res.blockers = await page.evaluate(() => {
        const m = window.OSCILLA.app.meas;
        return [...(m.flow.blockers || []).map((b) => b.text || String(b)),
          m.error ? m.error.message : '',
          ...[...document.querySelectorAll('[data-osc="measure.step"]')].map((s) => s.textContent)]
          .join(' ');
      });
      // Back to the default input: no deviceId again.
      await page.selectOption('#osc-m-input-device', '');
      res.defaultState = await check();
      res.calls = await calls();
      res.liveLog = await H.live(page);
    }
    await page.evaluate(() => {
      window.__oscDev.hide = null;
      window.__oscDev.gone = null;
      if (window.OSCILLA.measure.engine) window.OSCILLA.measure.engine.reset();
    });
    res.counts = await H.until(() => H.counts(page), H.zero, 3000);
    await page.evaluate(() => {
      window.OSCILLA.measure.useLoopback();
      window.OSCILLA.app.alerts = [];
    });
    const c = res.calls || [];
    return { ...res, chosen, ...H.verdict({
      ...base,
      firstDefault: res.firstState === 'READY' && c[0] === null,
      listed: !!chosen && !/Run the setup check/.test(res.listed.status),
      selected: !!chosen && res.afterSelect.value === chosen.value
        && res.afterSelect.deviceId === chosen.value,
      exact: res.secondState === 'READY' && c.includes(chosen && chosen.value)
        && !!res.inputNow && res.inputNow.exact === chosen.value
        && res.ioDeviceId === chosen.value,
      goneShown: !!res.gone && res.gone.missing && res.gone.msg && res.gone.value === chosen.value
        && /no longer available/.test(res.gone.message)
        && /not available$/.test(res.gone.options.at(-1).label),
      goneAnnounced: (res.liveLog || []).some((t) => /no longer available/.test(t)),
      goneRefused: res.goneState !== 'READY'
        && /selected input device is not available/.test(res.blockers || ''),
      backToDefault: res.defaultState === 'READY' && c.at(-1) === null,
      zero: H.zero(res.counts),
    }) };
  });

  def('recipe-link', async ({ page, context, baseUrl }) => {
    await H.workspace(page, 'measure');
    const res = {};
    const RECIPE = { f1: 50, f2: 12000, duration: 3, level: 'medium', repeats: 2,
      aggregation: 'median', noiseCheckS: 1, phase: true };
    res.param = await page.evaluate((v) => {
      const a = window.OSCILLA.app;
      window.OSCILLA.measure.setValues(v);
      return a.measureRecipeParam();
    }, RECIPE);
    const values = () => page.evaluate(() => {
      const v = window.OSCILLA.app.meas.values;
      return { f1: v.f1, f2: v.f2, duration: v.duration, level: v.level, repeats: v.repeats,
        aggregation: v.aggregation, noiseCheckS: v.noiseCheckS, phase: v.phase };
    });
    const same = (v) => Object.keys(RECIPE).every((k) => v[k] === RECIPE[k]);
    // A link opened in this page (hashchange): from Playground, with an instrument state too.
    await page.evaluate(() => window.OSCILLA.measure.setValues({ f1: 20, f2: 20000, duration: 10,
      level: 'low', repeats: 3, aggregation: 'mean', noiseCheckS: 5, phase: false }));
    await H.workspace(page, 'playground');
    await page.evaluate((p) => { window.location.hash = `v=1&f=440&mr=${p}`; }, res.param);
    res.applied = await H.until(async () => ({ v: await values(), ws: await page.evaluate(() =>
      document.querySelector('#osc-app').dataset.mode), freq: await page.evaluate(() =>
      window.OSCILLA.app.frequency) }), (x) => same(x.v) && x.ws === 'measure', 3000);
    await sleep(400);
    res.idle = await page.evaluate(() => ({ state: window.OSCILLA.measure.state,
      counts: window.OSCILLA.measure.counts(),
      alerts: window.OSCILLA.app.alerts.map((a) => a.title) }));
    // A bad link is refused whole: the setup stays as it was and says why.
    const bad = Buffer.from(JSON.stringify({ v: 1, f1: -1, d: 2 })).toString('base64url');
    await page.evaluate((p) => { window.location.hash = `mr=${p}`; }, bad);
    res.refused = await H.until(() => page.evaluate(() => ({
      errors: window.OSCILLA.app.meas.recipeLinkErrors.slice(),
      shown: document.querySelector('[data-osc="measure.recipeLinkErrors"]').offsetParent !== null,
      alerts: window.OSCILLA.app.alerts.map((a) => a.title) })),
    (x) => x.errors.length > 0 && x.shown, 3000);
    res.unchanged = same(await values());
    // Copy: the address bar gets the recipe; the clipboard or the fallback dialog has the URL.
    await page.evaluate(() => { window.OSCILLA.app.alerts = []; });
    await page.click('[data-osc="measure.recipeLink"]');
    res.copy = await H.until(() => page.evaluate(() => ({
      hash: window.location.hash,
      dialog: document.getElementById('osc-dlg-recipe-link').open,
      url: window.OSCILLA.app.meas.recipeLink,
      field: document.querySelector('[data-osc="measure.recipeLinkUrl"]').value,
      alerts: window.OSCILLA.app.alerts.map((a) => a.title) })),
    (x) => x.dialog || x.alerts.includes('Recipe link copied'), 3000);
    if (res.copy.dialog) await page.click('[data-osc="measure.recipeLinkDone"]');
    // A link opened in a new page (load): MEASURE opens with the recipe and nothing runs.
    const p2 = await context.newPage();
    const errors2 = [];
    p2.on('pageerror', (e) => errors2.push(e.message));
    await p2.goto(`${baseUrl.split('#')[0]}#mr=${res.param}`, { waitUntil: 'load' });
    await p2.waitForSelector('html[data-ready="true"]', { timeout: 15000 });
    await sleep(300);
    res.load = await p2.evaluate(() => {
      const v = window.OSCILLA.app.meas.values;
      return { ws: document.querySelector('#osc-app').dataset.mode,
        v: { f1: v.f1, f2: v.f2, duration: v.duration, level: v.level, repeats: v.repeats,
          aggregation: v.aggregation, noiseCheckS: v.noiseCheckS, phase: v.phase },
        state: window.OSCILLA.measure.state, counts: window.OSCILLA.measure.counts(),
        stimulus: document.querySelector('[data-osc="measure.stimulusText"]').textContent };
    });
    res.loadErrors = errors2;
    await p2.close();
    // Leave the page as the other checks expect it.
    await page.evaluate(() => {
      window.history.replaceState(null, '', window.location.href.split('#')[0]);
      window.OSCILLA.app.measureApplyRecipeHash('');
      window.OSCILLA.measure.setValues({ f1: 20, f2: 20000, duration: 10, level: 'low',
        repeats: 3, aggregation: 'mean', noiseCheckS: 5, phase: false });
      window.OSCILLA.app.meas.recipeLinkErrors = [];
      window.OSCILLA.app.alerts = [];
    });
    return { ...res, ...H.verdict({
      param: /^[A-Za-z0-9_-]+$/.test(res.param) && res.param.length < 300,
      applied: same(res.applied.v) && res.applied.ws === 'measure',
      coexists: res.applied.freq === 440,
      neverStarts: res.idle.state === 'IDLE' && H.zero(res.idle.counts)
        && res.idle.alerts.includes('Measurement recipe loaded from the link'),
      refused: res.refused.errors.some((t) => /Start frequency/.test(t)) && res.refused.shown
        && res.refused.alerts.includes('Recipe link not applied') && res.unchanged,
      copied: res.copy.hash.includes(`mr=${res.param}`) && res.copy.url.includes(`mr=${res.param}`)
        && (res.copy.dialog ? res.copy.field === res.copy.url : true),
      load: res.load.ws === 'measure' && same(res.load.v) && res.load.state === 'IDLE'
        && H.zero(res.load.counts) && /50 Hz/.test(res.load.stimulus)
        && res.loadErrors.length === 0,
    }) };
  });

  def('persistence', async ({ browser, browserName, origin, baseUrl }) => {
    // Per-browser behaviour of the experiment store on this origin, recorded in
    // docs/v3/measurement-guide.md: a fresh context (no data), an import, a reload.
    const res = { browser: browserName, origin };
    const ctx2 = await browser.newContext({ viewport: { width: 1536, height: 1024 } });
    const p = await ctx2.newPage();
    const errs = [];
    p.on('pageerror', (e) => errs.push(e.message));
    p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
    const open = async () => {
      await p.waitForSelector('html[data-ready="true"]', { timeout: 15000 });
      await p.mouse.click(5, 300);
      await H.clean(p);
      await H.workspace(p, 'experiments');
      return H.until(() => p.evaluate(() => ({ loaded: window.OSCILLA.app.exps.loaded,
        kind: window.OSCILLA.app.exps.storeKind, note: window.OSCILLA.app.exps.storeNote,
        ids: window.OSCILLA.app.exps.rows.map((r) => r.id) })), (x) => x.loaded, 5000);
    };
    await p.goto(baseUrl, { waitUntil: 'load' });
    res.first = await open();
    res.imported = await p.evaluate((t) => window.OSCILLA.app.experimentsImportText(t),
      fixtures.a.json);
    // A rename (store.annotate, ADR 0040) survives the reload with the run's hash unchanged.
    await p.evaluate(() => {
      const app = window.OSCILLA.app;
      app.exps.renameId = 'fixture-a';
      app.exps.renameName = 'TEST CONTEXT · A kept across reload';
      return app.experimentsRename();
    });
    await p.reload({ waitUntil: 'load' });
    res.reloaded = await open();
    res.persists = res.reloaded.ids.includes('fixture-a');
    res.renamedKept = res.persists && await p.evaluate(async (h) => {
      const e = await window.OSCILLA.app.experimentsOpen('fixture-a');
      return !!e && e.name === 'TEST CONTEXT · A kept across reload'
        && e.provenance.resultHash === h;
    }, fixtures.a.experiment.provenance.resultHash);
    // Quota exceeded on the real store path: the IndexedDB put of the experiment record throws
    // QuotaExceededError (as the browser does when the origin is full). The save reports it,
    // the result stays on screen, and a save after space is freed succeeds.
    if (res.reloaded.kind === 'indexeddb') {
      await H.workspace(p, 'measure');
      await H.loopback(p);
      res.run = await H.run(p, () => p.evaluate(() => { window.OSCILLA.app.measureStart(); }));
      await p.evaluate(() => {
        const orig = IDBObjectStore.prototype.put;
        window.__oscQuota = { orig, hits: 0 };
        IDBObjectStore.prototype.put = function quotaPut(...args) {
          if (this.name === 'experiments') {
            window.__oscQuota.hits += 1;
            throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
          }
          return orig.apply(this, args);
        };
        window.OSCILLA.app.alerts = [];
      });
      await p.click('[data-osc="measure.save"]');
      res.quota = await H.until(() => p.evaluate(() => {
        const a = window.OSCILLA.app;
        return { saving: a.meas.saving, saved: a.meas.saved, hits: window.__oscQuota.hits,
          alerts: a.alerts.map((x) => `${x.title}: ${x.text || x.message || ''}`),
          state: window.OSCILLA.measure.state, shown: a.meas.shownKind,
          saveEnabled: !document.querySelector('[data-osc="measure.save"]').disabled };
      }), (x) => !x.saving && x.alerts.length > 0, 5000);
      await p.evaluate(() => {
        IDBObjectStore.prototype.put = window.__oscQuota.orig;
        window.OSCILLA.app.alerts = [];
      });
      await p.click('[data-osc="measure.save"]');
      res.afterFree = await H.saved(p) || { saved: true };
    }
    res.errors = errs.slice(0, 5);
    await ctx2.close();

    // The experiment database cannot open at all (indexedDB.open throws, as on file:// or in
    // private modes of some browsers): the Playground plays and stops, MEASURE measures and
    // saves in memory and says so, and nothing throws into the page.
    const ctx3 = await browser.newContext({ viewport: { width: 1536, height: 1024 } });
    await ctx3.addInitScript(() => {
      IDBFactory.prototype.open = function refusedOpen() {
        throw new DOMException('The operation is insecure.', 'SecurityError');
      };
    });
    const q = await ctx3.newPage();
    const errs3 = [];
    q.on('pageerror', (e) => errs3.push(e.message));
    q.on('console', (m) => { if (m.type() === 'error') errs3.push(m.text()); });
    await q.goto(baseUrl, { waitUntil: 'load' });
    await q.waitForSelector('html[data-ready="true"]', { timeout: 15000 });
    await q.mouse.click(5, 300);
    await H.clean(q);
    await q.evaluate(() => window.OSCILLA.app.trigger());
    res.playground = await H.until(() => q.evaluate(() => ({
      nodes: window.OSCILLA.engine.activeNodeCount, status: window.OSCILLA.app.status })),
    (x) => x.nodes > 0, 3000);
    await q.evaluate(() => window.OSCILLA.app.stop());
    res.playgroundStopped = await H.until(() => q.evaluate(() => window.OSCILLA.engine
      .activeNodeCount), (n) => n === 0, 3000);
    await H.workspace(q, 'measure');
    await H.loopback(q);
    res.noStoreRun = await H.run(q, () => q.evaluate(() => {
      window.OSCILLA.measure.setValues({ repeats: 1 });
      window.OSCILLA.app.measureStart();
    }));
    await q.click('[data-osc="measure.save"]');
    res.noStoreSaved = await H.saved(q);
    res.noStore = await q.evaluate(() => ({ kind: window.OSCILLA.app.exps.storeKind,
      persistent: window.OSCILLA.app.exps.persistent, note: window.OSCILLA.app.exps.storeNote,
      error: window.OSCILLA.app.exps.storeError, saved: window.OSCILLA.app.meas.saved }));
    await H.workspace(q, 'experiments');
    res.noStoreRows = await q.evaluate(() => window.OSCILLA.app.exps.rows.length);
    res.noStoreErrors = errs3.slice(0, 5);
    await ctx3.close();

    const quotaOk = !res.quota || (res.quota.hits >= 1 && !res.quota.saved
      && res.quota.alerts.some((t) => /^Experiment not saved: .*browser storage is full/.test(t))
      && res.quota.state === 'COMPLETE' && res.quota.shown === 'result' && res.quota.saveEnabled
      && res.afterFree.saved === true);
    return { ...res, ...H.verdict({
      firstOpen: res.first.loaded && ['indexeddb', 'memory'].includes(res.first.kind),
      imported: res.imported === 'fixture-a',
      // IndexedDB keeps the experiment across a reload; the memory fallback says it does not.
      reload: res.reloaded.kind === 'indexeddb' ? res.persists && res.renamedKept
        : !res.persists && /memory for this page view/.test(res.reloaded.note || ''),
      quota: quotaOk && (res.reloaded.kind !== 'indexeddb' || !!res.quota),
      quotaRun: !res.run || res.run.state === 'COMPLETE',
      cleanPage: res.errors.length === 0,
      playground: res.playground.nodes > 0 && res.playgroundStopped === 0,
      measureWithoutStore: res.noStoreRun.state === 'COMPLETE' && res.noStoreSaved === null
        && res.noStore.saved && res.noStore.kind === 'memory' && res.noStore.persistent === false
        && /memory for this page view/.test(res.noStore.note || '') && res.noStoreRows === 1,
      noStoreClean: res.noStoreErrors.length === 0,
    }) };
  });

  def('no-spl', async ({ page }) => {
    const res = {};
    for (const ws of ['measure', 'experiments']) {
      await H.workspace(page, ws);
      for (const tab of ws === 'measure' ? ['response', 'ir', 'rta'] : [null]) {
        if (tab) await page.click(`[data-osc="measure.tab"][data-value="${tab}"]`);
        await page.evaluate(() => window.OSCILLA.app.measureSetExpert(true));
        res[`${ws}${tab ? `-${tab}` : ''}`] = await page.evaluate(splMentions);
      }
    }
    await page.evaluate(() => window.OSCILLA.app.measureSetExpert(false));
    await page.click('[data-osc="measure.tab"][data-value="response"]').catch(() => {});
    return { ok: Object.values(res).every((l) => !l.length), res };
  });

  def('light-theme', async ({ page }) => {
    await H.workspace(page, 'measure');
    await page.evaluate(() => window.OSCILLA.app.toggleTheme());
    await sleep(150);
    const res = await page.evaluate(() => {
      const el = document.createElement('span');
      el.className = 'osc-q osc-q--warn';
      el.textContent = 'probe';
      document.querySelector('[data-osc="measure.bar"]').appendChild(el);
      const cs = getComputedStyle(el);
      const root = getComputedStyle(document.documentElement);
      const out = { color: cs.color, bg: cs.backgroundColor,
        text: root.getPropertyValue('--osc-text').trim(),
        theme: document.documentElement.dataset.theme };
      el.remove();
      return out;
    });
    await page.evaluate(() => window.OSCILLA.app.toggleTheme());
    const hex = (c) => { const m = c.match(/\d+/g).map(Number); return `#${m.slice(0, 3)
      .map((v) => v.toString(16).padStart(2, '0')).join('')}`; };
    return { ok: res.theme === 'light' && hex(res.color) === res.text.toLowerCase(), ...res };
  });

  def('no-console-errors', async ({ errors }) => ({ ok: errors.length === 0,
    errors: errors.slice(0, 8) }));
  return checks;
}

// ------------------------------------------------------------------------------ runner
/**
 * Init script: record every Worker the page constructs (the analysis Worker, analysis-runner.js)
 * in window.__oscWorkers: whether its data: URL holds exactly the text of the page's own
 * <script data-analysis> (the one copy of the analysis), and the kinds of message it posted.
 */
function workerProbe() {
  const Native = window.Worker;
  const log = [];
  window.__oscWorkers = log;
  if (typeof Native !== 'function') return;
  const prefix = 'data:text/javascript;charset=utf-8,';
  window.Worker = class extends Native {
    constructor(url, opts) {
      super(url, opts);
      const u = String(url);
      const el = document.querySelector('script[data-analysis]');
      const rec = { dataUrl: u.startsWith(prefix), kinds: [],
        sameText: !!el && u.startsWith(prefix) && decodeURIComponent(u.slice(prefix.length))
          === el.text };
      log.push(rec);
      this.addEventListener('message', (e) => rec.kinds.push(e.data && e.data.kind));
    }
  };
}

async function runOne(browserName, origin, baseUrl, fixtures) {
  const browser = await playwright[browserName].launch(LAUNCH[browserName]);
  const context = await browser.newContext({ viewport: { width: 1536, height: 1024 },
    acceptDownloads: true });
  await context.addInitScript(workerProbe);
  const page = await context.newPage();
  page.setDefaultTimeout(10000);
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  const results = {};
  await page.goto(baseUrl, { waitUntil: 'load' });
  await page.waitForSelector('html[data-ready="true"]', { timeout: 15000 });
  await page.mouse.click(5, 300); // a user gesture so the audio context may start
  await H.clean(page);
  for (const { name, fn } of defineChecks(fixtures)) {
    if (ONLY && !ONLY.has(name) && name !== 'no-console-errors') continue;
    const t0 = Date.now();
    try {
      const v = await Promise.race([
        fn({ page, context, errors, browserName, origin, browser, baseUrl }),
        sleep(150000).then(() => ({ ok: false, detail: 'timeout 150 s' })),
      ]);
      results[name] = { ...v, ms: Date.now() - t0 };
    } catch (e) {
      results[name] = { ok: false, detail: String(e.message || e).split('\n')[0],
        ms: Date.now() - t0 };
    }
    try {
      await page.evaluate(() => {
        const m = window.OSCILLA.measure;
        if (m.engine && !['IDLE', 'COMPLETE', 'INVALID', 'ABORTED', 'ERROR'].includes(m.state)) {
          window.OSCILLA.app.measureAbort('test');
        }
        window.OSCILLA.app.alerts = [];
      });
    } catch { /* page gone */ }
  }
  await browser.close();
  return results;
}

(async () => {
  if (!fs.existsSync(DIST)) {
    console.error(`missing ${DIST}: run npm run build`);
    process.exit(2);
  }
  const { buildFixtures } = await import(pathToFileURL(path.join(__dirname, 'fixtures',
    'v3-experiments.mjs')).href);
  const fixtures = await buildFixtures();
  const server = ORIGINS.includes('http') ? startServer() : null;
  if (server) await waitForServer(server.url);
  const all = {};
  let failed = 0;
  try {
    for (const b of BROWSERS) {
      for (const o of ORIGINS) {
        const base = o === 'file' ? pathToFileURL(DIST).href : server.url;
        const key = `${b}/${o}`;
        const t0 = Date.now();
        const res = await runOne(b, o, base, fixtures);
        all[key] = res;
        const names = Object.keys(res);
        const bad = names.filter((n) => !res[n].ok);
        failed += bad.length;
        console.log(`${bad.length ? 'FAIL' : 'PASS'} ${key}/v3-ui: ${names.length - bad.length}/`
          + `${names.length} checks (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
        for (const n of bad) {
          const why = res[n].failed ? `failed [${res[n].failed.join(', ')}] ` : '';
          console.log(`   x ${n}: ${why}${JSON.stringify(res[n]).slice(0, 900)}`);
        }
      }
    }
  } finally {
    if (server) {
      server.proc.kill();
      fs.rmSync(server.root, { recursive: true, force: true });
    }
  }
  if (JSON_OUT) fs.writeFileSync(JSON_OUT, `${JSON.stringify(all, null, 2)}\n`);
  process.exit(failed ? 1 : 0);
})();
