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
//                           (advanced manual reading): refused with the reason while no input is
//                           known (ledger C1), stored after the setup check bound to that input
//                           -> Level CALIBRATED, void for another input; invalid input refused
//   level-wrong-input       (review F1 of #139) a calibration bound to "Mic A" while the run
//                           captures from another input (the loopback): the engine does not
//                           apply it; the result, quality reason and record say uncalibrated
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
//                           and carries the edited text as annotations.notes only; the stored
//                           noise-check RTA keeps the run's calibration (relative, no "SPL")
//   resave-after-link       a saved COMPLETE result stays saved when a recipe link is applied
//                           (the button reads "Update name and notes"); pressed with an edited
//                           name and notes it updates the stored run's metadata through annotate
//                           (same id, no second record, never "Experiment not saved")
//   notes-after-save        notes typed after the Save are announced as NOT stored yet; "Update
//                           name and notes" stores them as annotations.notes and the status then
//                           says so; an annotation added in Experiments survives a later update
//                           from MEASURE with no notes, which reports "Nothing to update"
//   older-claim             (ADR 0040 resolution) a file as an earlier version saved it, naming a
//                           level calibration made after the uncalibrated run: it imports with
//                           a warning naming the field and the reason, the stored record reads
//                           back unchanged, the detail states that its calibration claim is
//                           contradicted and presents it as uncalibrated: no "SPL" anywhere
//   unmeasurable-stimulus   (ledger D4) a white-noise record imports with a warning naming the
//                           stimulus, is stored as imported, its detail states that this version
//                           cannot measure it, and Repeat refuses it: nothing is loaded
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
//   definitions             (ADR 0043) a definition created from the Measure setup through its
//                           dialog (name, declared conditions, minimum verdict) is listed under a
//                           real heading with its version count; "Run this definition" twice:
//                           both saved runs reference version 1 (same id and hash); Edit (the
//                           conditions) creates version 2, a third run references it and the
//                           list and detail show it; compare run 1 (baseline) with run 3 names
//                           the version change of the same definition in an open Definition
//                           group, run 1 with run 2 lists none; a setup changed after loading
//                           the definition is flagged and its run records a derived definition;
//                           keyboard (Enter opens the dialog, Escape closes it); the panel and
//                           the dialog fit 390 px
//   evidence                (ADR 0044) fixture A's detail has an Evidence section under real
//                           headings (h4, two h5): an ordered lineage (result at 1 kHz, analysis,
//                           capture, calibration, run with wall-clock and audio-clock labels,
//                           derived definition, build) and a checklist list of nine items whose
//                           states and words are right (raw capture "not retained (...)", hash
//                           "verified"), each with an icon beside its words and no score; the
//                           frequency field is labelled and keyboard-reachable (typed 5000 +
//                           Enter traces the point at 5 kHz; 0 is refused: the field shows 5000
//                           again, never left marked invalid, a status region says the lineage
//                           still shows 5000 Hz, and a valid entry clears it); it fits 390 px;
//                           light theme; the
//                           contradicted older record reads "uncalibrated (the stored claim is
//                           contradicted)", no "SPL"; Compare A with it names the differing item
//   findings                (ADR 0046) "Record a finding about this run" on A's detail (focus +
//                           Enter) opens the finding dialog with A cited; while a statement is
//                           typed the unsaved-work guard reports "A finding being written"; a
//                           comparison of A with B is linked (with its "not why" hint), the
//                           status (five categorical values) is set to supported and saved: the
//                           Findings panel (h3) lists it as a real list item (h4 statement,
//                           status in words, its references in a list), both runs' details list
//                           it under "Findings that cite this run", the export carries A's
//                           result hash; deleting B warns "1 finding cites this run", and the
//                           comparison then reads "missing: run ... is not stored here" while the
//                           finding keeps its status; no causal wording; 390 px; light theme
//   findings-integrity      (review 1 of #149, items 1-2) a cited run deleted and replaced by a
//                           different record without a result hash reads "cannot be verified"
//                           (state broken, no Open, the supported status flagged); a cited run
//                           corrupted in IndexedDB reads "stored here but cannot be read" in a
//                           fresh page (state broken, no Open)
//   findings-draft          (review 1 of #149, item 5) a typed draft survives Escape and a
//                           backdrop click: the guard still reports it, the panel offers to
//                           continue it, and only Discard drops it
//   findings-delete-focus   (review 1 of #149, item 12) a finding deleted with the keyboard moves
//                           focus to the next finding's Edit, or to "New finding" when none is
//                           left; the status reads "Your judgement: …"
//   findings-two-tabs       (review 2 of #149, item 1) a second tab replaces a cited run with a
//                           different stamped record; after an unrelated save here, and after a
//                           list refresh, the citing reference reads broken ("different record"),
//                           with no Open
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
    // Ledger C1: before any input is known a typed reading cannot be bound, so it is refused
    // with the reason (it was stored unbound and applied to whatever input came next).
    await page.evaluate(() => window.OSCILLA.measure.setInputNow(null));
    const noteText = () => page.evaluate(() => {
      const el = document.querySelector('[data-osc="levelCal.manualNote"]');
      return el ? el.textContent.trim() : '';
    });
    res.noInputNote = await noteText();
    await page.fill('#osc-lc-obs', '-32.5');
    await page.click('[data-osc="levelCal.save"]');
    res.unbound = await page.evaluate(() => ({ error: window.OSCILLA.app.meas.levelForm.error,
      stored: !!window.OSCILLA.measure.levelCalibration,
      open: document.getElementById('osc-dlg-level-cal').open }));
    res.unboundLevel = await page.textContent('[data-osc="measure.levelIndicator"]');
    // The setup check through the UI (TEST CONTEXT loopback) makes the input known.
    await page.evaluate(() => {
      const a = window.OSCILLA.app;
      a.measureCloseLevelCalibration();
      a.measureClearLevelCalibration(); // whatever an earlier build stored above
    });
    await H.loopback(page);
    await page.click('#osc-measure-primary'); // Check setup
    await H.waitState(page, ['READY', 'INVALID', 'ERROR'], 15000);
    res.checked = await page.evaluate(() => window.OSCILLA.measure.state);
    await page.click('[data-osc="measure.levelCal"]');
    res.boundNote = await noteText();
    await page.fill('#osc-lc-obs', '');
    await page.click('[data-osc="levelCal.save"]');
    res.refused = await page.evaluate(() => window.OSCILLA.app.meas.levelForm.error);
    await page.fill('#osc-lc-obs', '-32.5');
    await page.fill('#osc-lc-cond', 'gate: synthetic values');
    await page.click('[data-osc="levelCal.save"]');
    await sleep(100);
    res.level = await page.textContent('[data-osc="measure.levelIndicator"]');
    res.state = await page.textContent('[data-osc="measure.levelState"]');
    res.bound = await page.evaluate(() => {
      const c = window.OSCILLA.measure.levelCalibration;
      return !!c && !!c.input && c.input.sampleRate > 0;
    });
    res.dialogClosed = await page.evaluate(() => !document.getElementById('osc-dlg-level-cal')
      .open);
    // Another microphone is checked: the calibration no longer applies, with the reason.
    await page.evaluate(() => window.OSCILLA.measure.setInputNow({
      device: { label: 'other', id: 'other-device' },
      constraints: { applied: { echoCancellation: false, noiseSuppression: false,
        autoGainControl: false, channelCount: 1 } }, sampleRate: 22050 }));
    res.voided = await page.textContent('[data-osc="measure.levelIndicator"]');
    // Review F3 of #139: no input known (another input chosen, the default changed): pending.
    await page.evaluate(() => window.OSCILLA.measure.setInputNow(null));
    // Alpine renders on a later frame: wait (bounded) for the state asserted, never a sleep.
    await page.waitForFunction(() => {
      const el = document.querySelector('[data-osc="measure.levelVoid"]');
      return /PENDING INPUT CHECK/.test(document.querySelector(
        '[data-osc="measure.levelIndicator"]').textContent) && el && el.offsetParent !== null;
    }, null, { timeout: 3000, polling: 50 }).catch(() => {});
    res.pending = await page.textContent('[data-osc="measure.levelIndicator"]');
    res.pendingText = await page.evaluate(() => {
      const el = document.querySelector('[data-osc="measure.levelVoid"]');
      return el && el.offsetParent !== null ? el.textContent.trim() : '';
    });
    // Back to the uncalibrated, idle state for the checks that follow.
    await page.evaluate(() => {
      const a = window.OSCILLA.app;
      a.measureClearLevelCalibration();
      a.measureClearCalibration();
      a.alerts = [];
    });
    await H.loopback(page);
    res.after = await page.textContent('[data-osc="measure.levelIndicator"]');
    await page.evaluate(() => window.OSCILLA.app.measureSetLevelManual(false));
    const calibrated = (t) => /CALIBRATED/.test(t) && !/UNCALIBRATED/.test(t);
    return { ...res, ...H.verdict({
      profile: res.bad === false && res.good === true && calibrated(res.freq)
        && /gate-mic/.test(res.name),
      needsCapture: /Capture the reference first/.test(res.needsCapture),
      scale: /mean-square scale/.test(res.scale),
      unboundRefused: /^Run the setup check first/.test(res.noInputNote)
        && /^Run the setup check first: a level calibration is valid only for the input/
          .test(res.unbound.error) && !res.unbound.stored && res.unbound.open
        && /UNCALIBRATED/.test(res.unboundLevel),
      checked: res.checked === 'READY' && /bound to the input checked last/.test(res.boundNote),
      invalidRefused: !!res.refused,
      boundCalibrated: calibrated(res.level) && res.bound && res.dialogClosed
        && /entered by hand, bound to the input checked when it was stored/.test(res.state),
      otherInputVoids: /UNCALIBRATED/.test(res.voided),
      pendingCheck: /PENDING INPUT CHECK/.test(res.pending)
        && /^Pending input check:/.test(res.pendingText),
      cleared: /UNCALIBRATED/.test(res.after),
    }) };
  });

  def('level-wrong-input', async ({ page }) => {
    // Review F1 of #139: the workspace believes the input is "Mic A" (its check is stale), the
    // measurement opens another input (here the TEST CONTEXT loopback). The engine compares the
    // calibration's binding with the input it captured from and does not apply it.
    await H.workspace(page, 'measure');
    await H.loopback(page);
    const res = {};
    res.stored = await page.evaluate(() => {
      const a = window.OSCILLA.app;
      window.OSCILLA.measure.setInputNow({ device: { label: 'Mic A', id: 'mic-a' },
        constraints: { applied: { echoCancellation: false, noiseSuppression: false,
          autoGainControl: false, channelCount: 1 } }, sampleRate: 48000 });
      a.measureSetLevelManual(true);
      Object.assign(a.meas.levelForm, { referenceHz: '1000', referenceDb: '94',
        observedDb: '-32.5', conditions: 'gate: bound to Mic A' });
      return a.measureSaveLevelCalibration();
    });
    res.before = await page.textContent('[data-osc="measure.levelIndicator"]');
    res.run = await H.run(page, () => page.evaluate(() => {
      window.OSCILLA.app.measureStart();
    }));
    res.result = await page.evaluate(() => {
      const r = window.OSCILLA.measure.result;
      const lv = r && r.calibrated ? r.calibrated.level : null;
      const q = r && r.quality ? r.quality.reasons.find((x) => x.code === 'LEVEL_CALIBRATION')
        : null;
      const e = window.OSCILLA.measure.experimentFromResult();
      return { applied: !!(lv && lv.calibration), unit: lv && lv.unit, voided: lv && lv.voided,
        quality: q && q.text, recorded: !!(e && e.calibration.level),
        levelCalibrated: r && r.quality ? r.quality.metrics.levelCalibrated : null };
    });
    res.after = await page.textContent('[data-osc="measure.levelIndicator"]');
    res.spl = await page.evaluate(splMentions);
    await page.evaluate(() => {
      const a = window.OSCILLA.app;
      a.measureClearLevelCalibration();
      a.measureSetLevelManual(false);
      a.alerts = [];
    });
    await H.loopback(page);
    const r = res.result;
    return { ...res, ...H.verdict({
      stored: res.stored === true && /CALIBRATED/.test(res.before)
        && !/UNCALIBRATED/.test(res.before),
      complete: res.run.state === 'COMPLETE',
      notApplied: !r.applied && r.unit === 'dB relative (dBFS-like)'
        && /a different input device/.test(r.voided || ''),
      qualitySays: /^level calibration not applied/.test(r.quality || '')
        && r.levelCalibrated === false,
      recordUncalibrated: r.recorded === false,
      indicatorFollows: /UNCALIBRATED/.test(res.after),
      noSpl: res.spl.length === 0,
    }) };
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
    // The stored noise-check snapshot keeps the calibration its run applied (none).
    res.rtaY = await page.evaluate(() => {
      const r = window.OSCILLA.app.meas.rta;
      return r ? `${r.yLabel} ${r.badges.join(' ')}` : null;
    });
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
      rtaAsMeasured: !!res.rtaY && !/SPL/.test(res.rtaY),
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

  def('resave-after-link', async ({ page }) => {
    await H.workspace(page, 'measure');
    await H.loopback(page);
    await page.fill('#osc-m-name', 'Gate resave');
    await page.fill('#osc-m-notes', '');
    await page.click('#osc-measure-primary'); // Check setup
    await H.waitState(page, ['READY', 'INVALID', 'ERROR'], 15000);
    const res = {};
    res.run = await H.run(page, () => page.click('#osc-measure-primary'));
    if (res.run.state !== 'COMPLETE') return { ok: false, failed: ['run'], ...res };
    await page.click('#osc-measure-save');
    res.save = await H.saved(page);
    if (res.save) return { ok: false, failed: ['save'], ...res };
    res.id = await page.evaluate(() => window.OSCILLA.app.meas.savedId);
    // A recipe link applied while the saved result is shown.
    res.applied = await page.evaluate(() => {
      const a = window.OSCILLA.app;
      a.alerts = [];
      return a.measureApplyRecipeHash(new URL(a.measureRecipeUrl()).hash,
        { origin: 'hashchange' });
    });
    await sleep(100);
    res.afterLink = await page.evaluate(() => ({ saved: window.OSCILLA.app.meas.saved,
      label: document.querySelector('#osc-measure-save').textContent.trim() }));
    // Save once more (as a programmatic caller can) after a metadata edit.
    await page.fill('#osc-m-name', 'Gate resave renamed');
    await page.fill('#osc-m-notes', 'typed after the save');
    res.again = await page.evaluate(() => window.OSCILLA.app.measureSave());
    res.alerts = await page.evaluate(() => window.OSCILLA.app.alerts.map((a) => a.title));
    res.stored = await page.evaluate(async (id) => {
      const s = window.OSCILLA.experiments.store();
      const e = await s.get(id);
      const list = await s.list();
      return { name: e.name, notes: e.annotations ? e.annotations.notes : null,
        records: list.filter((x) => /^Gate resave/.test(x.name)).length };
    }, res.id);
    await page.evaluate(() => {
      const a = window.OSCILLA.app;
      a.meas.name = '';
      a.meas.notes = '';
      a.alerts = [];
    });
    return { ...res, ...H.verdict({
      applied: res.applied === true,
      staysSaved: res.afterLink.saved === true
        && res.afterLink.label === 'Update name and notes',
      sameRun: res.again === res.id,
      neverNotSaved: !res.alerts.some((t) => /not saved/.test(t))
        && res.alerts.includes('Experiment updated'),
      annotated: res.stored.name === 'Gate resave renamed'
        && res.stored.notes === 'typed after the save',
      oneRecord: res.stored.records === 1,
    }) };
  });

  def('notes-after-save', async ({ page }) => {
    await H.workspace(page, 'measure');
    await H.loopback(page);
    await page.fill('#osc-m-name', 'Gate notes after save');
    await page.fill('#osc-m-notes', 'at start');
    await page.click('#osc-measure-primary'); // Check setup
    await H.waitState(page, ['READY', 'INVALID', 'ERROR'], 15000);
    const res = {};
    res.run = await H.run(page, () => page.click('#osc-measure-primary'));
    if (res.run.state !== 'COMPLETE') return { ok: false, failed: ['run'], ...res };
    await page.click('#osc-measure-save');
    res.save = await H.saved(page);
    if (res.save) return { ok: false, failed: ['save'], ...res };
    res.id = await page.evaluate(() => window.OSCILLA.app.meas.savedId);
    const status = () => page.evaluate(() => {
      const el = document.querySelector('[data-osc="measure.evidenceNotes"]');
      return el && el.offsetParent !== null ? el.textContent.trim() : '';
    });
    const stored = () => page.evaluate(async (id) => {
      const e = await window.OSCILLA.experiments.store().get(id);
      return { env: e.environment.notes, ann: e.annotations ? e.annotations.notes : null };
    }, res.id);
    await page.fill('#osc-m-notes', 'typed after the save');
    await sleep(150);
    res.pending = await status();
    res.button = await page.evaluate(() => {
      const b = document.querySelector('#osc-measure-save');
      return { label: b.textContent.trim(), disabled: b.disabled };
    });
    res.before = await stored();
    if (res.button.disabled) {
      return { ok: false, failed: ['button', ...(/not stored yet/.test(res.pending) ? []
        : ['notYet'])], ...res };
    }
    await page.evaluate(() => { window.OSCILLA.app.alerts = []; });
    await page.click('#osc-measure-save');
    await sleep(300);
    res.after = await stored();
    res.stated = await status();
    res.alerts1 = await page.evaluate(() => window.OSCILLA.app.alerts.map((a) => a.title));
    // An annotation written in Experiments is never cleared by an update without notes.
    await page.evaluate((id) => window.OSCILLA.app.experimentsAnnotate(id,
      { notes: 'from Experiments' }), res.id);
    await page.fill('#osc-m-notes', '');
    await page.evaluate(() => { window.OSCILLA.app.alerts = []; });
    await page.click('#osc-measure-save');
    await sleep(300);
    res.kept = await stored();
    res.alerts2 = await page.evaluate(() => window.OSCILLA.app.alerts.map((a) => a.title));
    await page.evaluate(() => {
      const a = window.OSCILLA.app;
      a.meas.name = '';
      a.meas.notes = '';
      a.alerts = [];
    });
    return { ...res, ...H.verdict({
      notYet: /^These notes are not stored yet: "Update name and notes" saves them/
        .test(res.pending) && !/are saved as an annotation/.test(res.pending),
      button: res.button.label === 'Update name and notes' && res.button.disabled === false,
      notStoredBefore: res.before.ann === null,
      stored: res.after.ann === 'typed after the save'
        && /^at start\b/.test(res.after.env || ''),
      statedStored: /are stored as its annotation/.test(res.stated),
      updated: res.alerts1.includes('Experiment updated'),
      kept: res.kept.ann === 'from Experiments' && res.alerts2.includes('Nothing to update')
        && !res.alerts2.some((t) => /not saved/.test(t)),
    }) };
  });

  def('older-claim', async ({ page }) => {
    await H.workspace(page, 'experiments');
    await page.evaluate(() => { window.OSCILLA.app.alerts = []; });
    const res = {};
    res.id = await page.evaluate((json) => window.OSCILLA.app.experimentsImportText(json),
      fixtures.older.json);
    res.alert = await page.evaluate(() => (window.OSCILLA.app.alerts || [])
      .map((a) => ({ title: a.title, text: a.message || '' })).at(-1) || null);
    if (!res.id) return { ok: false, failed: ['imported'], ...res };
    res.stored = await page.evaluate(async (id) => {
      const e = await window.OSCILLA.experiments.store().get(id);
      return e ? { level: !!e.calibration.level, hash: e.provenance.resultHash } : null;
    }, res.id);
    await page.evaluate((id) => window.OSCILLA.app.experimentsOpen(id), res.id);
    await sleep(200);
    res.statement = await page.evaluate(() => {
      const el = document.querySelector('[data-osc="exp.calibrationClaim"]');
      return el && el.offsetParent !== null ? el.textContent.trim() : '';
    });
    res.spl = await page.evaluate(splMentions);
    res.lines = await page.evaluate(() => window.OSCILLA.app.exps.detail.lines.join(' | '));
    await page.evaluate(() => { window.OSCILLA.app.alerts = []; });
    return { ...res, ...H.verdict({
      imported: !!res.alert && res.alert.title === 'Experiment imported with a warning'
        && /calibration\.level: calibration claim contradicted/.test(res.alert.text)
        && /levelCalibrated false/.test(res.alert.text),
      storedUnchanged: !!res.stored && res.stored.level
        && res.stored.hash === fixtures.older.experiment.provenance.resultHash,
      stated: /^This record names a calibration its own results say was not applied/
        .test(res.statement) && /not trustworthy/.test(res.statement),
      uncalibrated: /level UNCALIBRATED/.test(res.lines),
      noSpl: res.spl.length === 0,
    }) };
  });

  def('unmeasurable-stimulus', async ({ page }) => {
    // Ledger D4: the engine measures log sweeps only. A white-noise record (a file from
    // elsewhere) imports with a finding, its detail says so, and Repeat refuses it instead of
    // running a log sweep while recording repeatOf.
    await H.workspace(page, 'measure');
    const values = await page.evaluate(() => JSON.stringify(window.OSCILLA.app.meas.values));
    await H.workspace(page, 'experiments');
    await page.evaluate(() => { window.OSCILLA.app.alerts = []; });
    const res = {};
    const lastAlert = () => page.evaluate(() => (window.OSCILLA.app.alerts || [])
      .map((a) => ({ title: a.title, text: a.message || '' })).at(-1) || null);
    res.id = await page.evaluate((json) => window.OSCILLA.app.experimentsImportText(json),
      fixtures.white.json);
    res.imported = await lastAlert();
    if (!res.id) return { ok: false, failed: ['imported'], ...res };
    await page.evaluate((id) => window.OSCILLA.app.experimentsOpen(id), res.id);
    await page.waitForFunction(() => {
      const el = document.querySelector('[data-osc="exp.stimulusFinding"]');
      return el && el.offsetParent !== null;
    }, null, { timeout: 5000 }).catch(() => {});
    res.statement = await page.evaluate(() => {
      const el = document.querySelector('[data-osc="exp.stimulusFinding"]');
      return el && el.offsetParent !== null ? el.textContent.trim() : '';
    });
    await page.click('[data-osc="exp.repeat"]', { timeout: 5000 })
      .catch(() => page.evaluate((id) => window.OSCILLA.app.experimentsRepeat(id), res.id));
    await sleep(150);
    res.repeat = await lastAlert();
    res.workspace = await page.evaluate(() => window.OSCILLA.app.workspace);
    res.valuesKept = await page.evaluate((v) => JSON.stringify(window.OSCILLA.app.meas.values)
      === v, values);
    res.stored = await page.evaluate(async (id) => {
      const e = await window.OSCILLA.experiments.store().get(id);
      return e ? { kind: e.recipe.stimulus.kind, hash: e.provenance.resultHash } : null;
    }, res.id);
    // Leave the store as the checks that follow expect it (the explicit, confirmed delete).
    res.deleted = await page.evaluate(async (id) => {
      const a = window.OSCILLA.app;
      a.exps.deleteId = id;
      a.exps.deleteName = 'white-noise record';
      const ok = await a.experimentsDelete();
      a.alerts = [];
      return ok;
    }, res.id);
    return { ...res, ...H.verdict({
      imported: !!res.imported && res.imported.title === 'Experiment imported with a warning'
        && /white noise stimulus, which this version of OSCILLA cannot measure/
          .test(res.imported.text) && !/names a calibration/.test(res.imported.text),
      storedAsImported: !!res.stored && res.stored.kind === 'white'
        && res.stored.hash === fixtures.white.experiment.provenance.resultHash,
      stated: /^recipe\.stimulus\.kind: this run used a white noise stimulus/.test(res.statement)
        && /Repeat is refused/.test(res.statement),
      repeatRefused: !!res.repeat && res.repeat.title === 'Repeat refused'
        && /This run used a white noise stimulus/.test(res.repeat.text),
      nothingLoaded: res.workspace === 'experiments' && res.valuesKept,
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
    // Poll for everything the verdict asserts (the panel shown too), not only the list.
    res.ac = await H.until(read, (d) => d.pair && d.groups.length >= 2 && d.shown, 5000);
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

  def('definitions', async ({ page }) => {
    await H.workspace(page, 'measure');
    await H.loopback(page);
    await H.workspace(page, 'experiments');
    const res = {};
    const app = (fn, arg) => page.evaluate(fn, arg);
    const defs = () => app(() => window.OSCILLA.app.exps.defs.map((d) => ({ ...d })));
    const before = (await defs()).length;
    // Create through the dialog: the recipe is the Measure setup's.
    await page.click('[data-osc="def.new"]');
    await page.fill('#osc-def-name', 'Loopback definition');
    await page.fill('#osc-def-conditions', 'Digital loopback, no room');
    await page.selectOption('#osc-def-min', 'USABLE');
    await page.click('[data-osc="def.save"]');
    res.created = await H.until(defs, (d) => d.length === before + 1, 5000);
    const def = res.created.find((d) => d.name === 'Loopback definition') || {};
    const row = `[data-osc="def.row"][data-id="${def.id}"]`;
    res.listed = await app((sel) => {
      const li = document.querySelector(sel);
      return li ? { heading: li.querySelector('h4') && li.querySelector('h4').textContent,
        list: li.parentElement.getAttribute('role'), meta: li.querySelector('.osc-x-meta')
          .textContent } : null;
    }, row);
    // Run it: loads the latest version into MEASURE and starts; then save.
    const runDef = async () => {
      await app(() => {
        const m = window.OSCILLA.measure;
        if (m.engine && ['COMPLETE', 'INVALID', 'ABORTED'].includes(m.state)) m.engine.reset();
      });
      await H.workspace(page, 'experiments');
      const r = await H.run(page, () => page.click(`${row} [data-osc="def.run"]`));
      if (r.state !== 'COMPLETE') return { r };
      await page.click('#osc-measure-save');
      const saved = await H.saved(page);
      return saved || app(() => window.OSCILLA.app.meas.savedId);
    };
    const ref = (id) => app(async (x) => {
      const e = await window.OSCILLA.experiments.store().get(x);
      const d = e.definition;
      return { id: d.id, version: d.version, hash: d.hash, derived: d.derived,
        conditions: d.execution.conditions.notes };
    }, id);
    res.run1 = await runDef();
    res.run2 = await runDef();
    if (typeof res.run1 !== 'string' || typeof res.run2 !== 'string') {
      return { ok: false, failed: ['runs'], ...res };
    }
    res.ref1 = await ref(res.run1);
    res.ref2 = await ref(res.run2);
    // Edit (keyboard: Enter on the row's Edit button opens the dialog): a new version.
    await H.workspace(page, 'experiments');
    await page.focus(`${row} [data-osc="def.edit"]`);
    await page.keyboard.press('Enter');
    res.dialog = await H.until(() => app(() => document.getElementById('osc-dlg-def').open),
      Boolean, 3000);
    await page.fill('#osc-def-conditions', 'Digital loopback, no room, second session');
    await page.click('[data-osc="def.save"]');
    res.edited = await H.until(defs, (d) => d.some((x) => x.id === def.id && x.versions === 2),
      5000);
    res.run3 = await runDef();
    if (typeof res.run3 !== 'string') return { ok: false, failed: ['run3'], ...res };
    res.ref3 = await ref(res.run3);
    await H.workspace(page, 'experiments');
    res.meta = await app((sel) => document.querySelector(`${sel} .osc-x-meta`).textContent, row);
    res.rowText = await app((id) => {
      const r = document.querySelector(`[data-osc="exp.row"][data-id="${id}"] .osc-x-meta`);
      return r ? r.textContent : null;
    }, res.run3);
    await app((id) => window.OSCILLA.app.experimentsOpen(id), res.run3);
    res.detail = await H.until(() => app(() => [...document.querySelectorAll(
      '.osc-x-prov .osc-metric')].map((m) => `${m.querySelector('dt').textContent}: ${
      m.querySelector('dd').textContent}`).filter((t) => /^(Definition|Acceptance|Declared)/
      .test(t))), (x) => x.length === 3, 3000);
    // Compare: run 1 as the baseline against run 3 (another version), then run 1 with run 2.
    const changes = () => app(() => [...document.querySelectorAll(
      '[data-osc="exp.changes"] details')].map((d) => ({ label: d.querySelector('h6')
      .textContent, open: d.open, items: [...d.querySelectorAll('li')].map((li) =>
      li.textContent) })));
    await app((id) => window.OSCILLA.app.experimentsSetBaseline(id, true), res.run1);
    await app((id) => window.OSCILLA.app.experimentsCompare([id]), res.run3);
    res.cmp13 = await H.until(changes, (g) => g.some((x) => x.label === 'Definition'), 5000);
    res.heading = await app(() => document.querySelector('[data-osc="exp.changes"] h5')
      .textContent);
    await app((id) => window.OSCILLA.app.experimentsSetBaseline(id, false), res.run1);
    await app((ids) => window.OSCILLA.app.experimentsCompare(ids), [res.run1, res.run2]);
    res.cmp12 = await H.until(changes, (g) => !g.some((x) => x.label === 'Definition'), 3000);
    // Truth: a setup changed after the definition was loaded is not recorded as from it.
    await app((id) => window.OSCILLA.app.experimentsRepeat(id), res.run3);
    await app(() => window.OSCILLA.app.measureSetValue('duration', 1.5, 'number'));
    res.differs = await H.until(() => app(() => {
      const el = document.querySelector('[data-osc="measure.definitionDiffers"]');
      return !!el && el.offsetParent !== null;
    }), Boolean, 2000);
    await app(() => {
      const m = window.OSCILLA.measure;
      if (m.engine && ['COMPLETE', 'INVALID', 'ABORTED'].includes(m.state)) m.engine.reset();
    });
    const r4 = await H.run(page, () => app(() => { window.OSCILLA.app.measureStart(); }));
    if (r4.state === 'COMPLETE') {
      await page.click('#osc-measure-save');
      res.save4 = await H.saved(page);
      res.ref4 = await ref(await app(() => window.OSCILLA.app.meas.savedId));
    }
    await app(() => {
      const a = window.OSCILLA.app;
      a.measureClearDefinition();
      window.OSCILLA.measure.setValues({ duration: 1 });
    });
    // 390 px: the panel and the dialog fit.
    await page.setViewportSize({ width: 390, height: 844 });
    await H.workspace(page, 'experiments');
    res.narrow = await H.until(() => app(() => {
      const sec = document.querySelector('[data-osc="exp.defs"]');
      const r = sec.getBoundingClientRect();
      const btns = [...sec.querySelectorAll('[data-osc="def.row"] button')]
        .map((b) => b.getBoundingClientRect());
      return { fits: sec.scrollWidth <= sec.clientWidth + 1 && r.right <= window.innerWidth + 1
        && document.documentElement.scrollWidth <= window.innerWidth + 1,
      buttons: btns.length > 0 && btns.every((b) => b.width > 0 && b.right <= window.innerWidth
        + 1) };
    }), (x) => x.fits && x.buttons, 2000);
    await page.click(`${row} [data-osc="def.edit"]`);
    res.narrowDialog = await H.until(() => app(() => {
      const d = document.getElementById('osc-dlg-def');
      const r = d.getBoundingClientRect();
      return d.open && r.left >= 0 && r.right <= window.innerWidth + 1
        && d.scrollWidth <= d.clientWidth + 1;
    }), Boolean, 2000);
    await page.keyboard.press('Escape');
    res.closed = await H.until(() => app(() => !document.getElementById('osc-dlg-def').open),
      Boolean, 2000);
    await page.setViewportSize({ width: 1536, height: 1024 });
    await app(() => { window.OSCILLA.app.alerts = []; window.OSCILLA.app.exps.selected = []; });
    const g13 = (res.cmp13 || []).find((x) => x.label === 'Definition') || { items: [] };
    return { ...res, ...H.verdict({
      created: !!def.id && /^1 version · latest v1 /.test(def.meta)
        && /not run yet/.test(def.meta),
      listed: !!res.listed && res.listed.heading === 'Loopback definition'
        && res.listed.list === 'list',
      sameVersion: res.ref1.id === def.id && res.ref1.version === 1 && !res.ref1.derived
        && res.ref2.id === def.id && res.ref2.hash === res.ref1.hash && res.ref2.version === 1
        && res.ref1.conditions === 'Digital loopback, no room',
      dialogKeyboard: res.dialog === true,
      newVersion: res.ref3.id === def.id && res.ref3.version === 2
        && res.ref3.hash !== res.ref1.hash,
      listShows: /^2 versions · latest v2 /.test(res.meta) && /last run .* \(v2\)$/.test(res.meta)
        && / · "Loopback definition" version 2$/.test(res.rowText),
      detailShows: res.detail.includes(`Definition: "Loopback definition" version 2 (${
        res.ref3.hash.slice(0, 12)}…)`) && res.detail.some((t) => /^Acceptance: verdict USABLE or /
        .test(t) && / better required: (met|NOT met) \(/.test(t)),
      compareSaysVersion: g13.open && g13.items.some((t) => t === 'Definition version: version 1 '
        + `(${res.ref1.hash.slice(0, 12)}…) → version 2 (${res.ref3.hash.slice(0, 12)}…) (version `
        + '1 → 2 of the same definition: its execution fields were edited between the runs)')
        && res.heading === 'Changed between runs A (baseline) and B',
      sameVersionNoChange: !res.cmp12.some((x) => x.label === 'Definition'),
      truth: res.differs === true && !!res.ref4 && res.ref4.derived === true
        && res.ref4.id !== def.id,
      narrow: res.narrow.fits && res.narrow.buttons && res.narrowDialog === true,
      closed: res.closed === true,
    }) };
  });

  def('evidence', async ({ page }) => {
    await H.workspace(page, 'experiments');
    for (const [k, id] of [['a', 'fixture-a'], ['older', 'fixture-older']]) {
      const stored = await page.evaluate(async (x) => !!(await window.OSCILLA.experiments.store()
        .get(x)), id);
      if (!stored) {
        await page.evaluate((t) => window.OSCILLA.app.experimentsImportText(t), fixtures[k].json);
      }
    }
    const read = () => page.evaluate(() => {
      const sec = document.querySelector('[data-osc="exp.evidence"]');
      if (!sec) return { missing: true };
      const r = sec.getBoundingClientRect();
      const lin = sec.querySelector('[data-osc="exp.lineage"]');
      const chk = sec.querySelector('[data-osc="exp.checklist"]');
      const li = (el) => [...el.querySelectorAll('li')].map((x) => ({ id: x.dataset.id,
        state: x.dataset.state || null, text: x.textContent.replace(/\s+/g, ' ').trim(),
        icon: !!x.querySelector('svg[aria-hidden="true"] use') }));
      return {
        shown: sec.offsetParent !== null,
        h4: [...sec.querySelectorAll('h4')].map((h) => h.textContent.trim()),
        h5: [...sec.querySelectorAll('h5')].map((h) => h.textContent.trim()),
        ol: lin.tagName, ul: chk.tagName, role: chk.getAttribute('role'),
        lineage: li(lin), checklist: li(chk), text: sec.textContent,
        hz: document.getElementById('osc-x-ev-hz').value,
        label: !!document.querySelector('label[for="osc-x-ev-hz"]'),
        fits: sec.scrollWidth <= sec.clientWidth + 1 && r.right <= window.innerWidth + 1
          && document.documentElement.scrollWidth <= window.innerWidth + 1,
      };
    });
    const res = {};
    await page.evaluate(() => window.OSCILLA.app.experimentsOpen('fixture-a'));
    res.a = await H.until(read, (d) => d.shown && d.checklist && d.checklist.length === 9
      && d.lineage.length > 0 && d.lineage[d.lineage.length - 1].id === 'build', 5000);
    if (res.a.missing) return { ok: false, failed: ['section'], ...res };
    // Keyboard: the frequency field takes focus; a typed value + Enter traces the stored point
    // nearest it.
    await page.focus('#osc-x-ev-hz');
    res.focused = await page.evaluate(() => document.activeElement
      && document.activeElement.id === 'osc-x-ev-hz' && document.activeElement.tabIndex >= 0);
    await page.fill('#osc-x-ev-hz', '5000');
    await page.keyboard.press('Enter');
    await page.keyboard.press('Tab');
    res.at5k = await H.until(read, (d) => d.lineage && /nearest 5 kHz\)/.test(d.lineage[0].text),
      3000);
    // An entry that is not a frequency above 0 Hz is refused: the field shows the kept value
    // again, the status region says why, and the field is marked invalid.
    await page.fill('#osc-x-ev-hz', '0');
    await page.keyboard.press('Enter');
    await page.keyboard.press('Tab');
    res.refused = await H.until(() => page.evaluate(() => {
      const f = document.getElementById('osc-x-ev-hz');
      const m = document.querySelector('[data-osc="exp.evidenceHzError"]');
      return { value: f.value, invalid: f.getAttribute('aria-invalid'),
        describedBy: f.getAttribute('aria-describedby'), role: m.getAttribute('role'),
        id: m.id, text: m.textContent.trim(), shown: m.getBoundingClientRect().height > 2 };
    }), (r) => r.text.length > 0 && r.value === '5000', 3000);
    // A valid entry clears the refusal; another run shows its own frequency in the field.
    await page.fill('#osc-x-ev-hz', '4000');
    await page.keyboard.press('Enter');
    await page.keyboard.press('Tab');
    res.cleared = await H.until(() => page.evaluate(() => ({
      invalid: document.getElementById('osc-x-ev-hz').getAttribute('aria-invalid'),
      text: document.querySelector('[data-osc="exp.evidenceHzError"]').textContent.trim() })),
    (r) => r.text === '', 3000);
    // 390 px wide, light theme: the section fits and its state words stay readable text.
    await page.setViewportSize({ width: 390, height: 844 });
    res.narrow = await H.until(read, (d) => d.fits, 2000);
    await page.evaluate(() => window.OSCILLA.app.toggleTheme());
    res.light = await page.evaluate(() => {
      const span = document.querySelector('[data-osc="exp.checklist"] li span');
      const root = getComputedStyle(document.documentElement);
      return { theme: document.documentElement.dataset.theme, color: getComputedStyle(span).color,
        text2: root.getPropertyValue('--osc-text-2').trim() };
    });
    await page.evaluate(() => window.OSCILLA.app.toggleTheme());
    await page.setViewportSize({ width: 1536, height: 1024 });
    // The contradicted older record.
    await page.evaluate(() => window.OSCILLA.app.experimentsOpen('fixture-older'));
    res.older = await H.until(read, (d) => d.shown && d.lineage && d.lineage.some((l) => l.id
      === 'calibration' && /contradicted/.test(l.text)), 5000);
    res.spl = await page.evaluate(splMentions);
    // Compare: one line naming the checklist items whose state differs.
    await page.evaluate(() => window.OSCILLA.app.experimentsCompare(['fixture-a',
      'fixture-older']));
    res.diff = await H.until(() => page.evaluate(() => {
      const el = document.querySelector('[data-osc="exp.evidenceDiff"]');
      return el && el.offsetParent !== null ? el.textContent.trim() : '';
    }), (t) => t.length > 0, 5000);
    await page.evaluate(() => {
      window.OSCILLA.app.exps.panel = 'detail';
      window.OSCILLA.app.alerts = [];
    });
    const hex = (c) => { const m = String(c).match(/\d+/g) || []; return `#${m.slice(0, 3)
      .map((v) => Number(v).toString(16).padStart(2, '0')).join('')}`; };
    const st = (d, id) => (d.checklist || []).find((c) => c.id === id) || {};
    const ln = (d, id) => (d.lineage || []).find((c) => c.id === id) || { text: '' };
    const out = { ...res };
    for (const k of ['a', 'older', 'at5k', 'narrow']) if (out[k]) out[k] = { ...out[k], text: '' };
    return { ...out, ...H.verdict({
      section: res.a.shown && res.a.h4.join() === 'Evidence'
        && res.a.h5.join('|') === 'What produced this value?|Can I repeat this?',
      lists: res.a.ol === 'OL' && res.a.ul === 'UL' && res.a.role === 'list',
      lineage: res.a.lineage.map((l) => l.id).join() === 'result,analysis,capture,stimulus,'
        + 'calibration,run,definition,build' && /dB re unity digital transfer/.test(ln(res.a, 'result').text)
        && /at 1\.001 kHz/.test(ln(res.a, 'result').text)
        && /\(wall clock\)/.test(ln(res.a, 'run').text)
        && /audio clock/.test(ln(res.a, 'run').text)
        && /^Definition: derived from the run's own recipe/.test(ln(res.a, 'definition').text),
      states: st(res.a, 'definition').state === 'partial' && st(res.a, 'recipe').state
        === 'recorded' && st(res.a, 'calibration').state === 'recorded'
        && st(res.a, 'device').state === 'missing' && st(res.a, 'hash').state === 'recorded'
        && st(res.a, 'raw').state === 'missing' && st(res.a, 'environment').state === 'recorded',
      words: /: verified \(recomputed/.test(st(res.a, 'hash').text)
        && st(res.a, 'raw').text === 'Raw capture retained: not retained (OSCILLA stores the '
          + 'derived result, not the raw capture)'
        && res.a.checklist.every((c) => c.icon) && !/%|\bscore:/i.test(res.a.text),
      label: res.a.label && res.a.hz === '1000',
      refused: res.refused.value === '5000' && res.refused.invalid !== 'true'
        && res.refused.describedBy === res.refused.id && res.refused.role === 'status'
        && res.refused.shown && res.refused.text === 'Enter a frequency above 0 Hz; the lineage '
          + 'still shows 5000 Hz.' && res.cleared.invalid !== 'true' && res.cleared.text === '',
      keyboard: res.focused === true && /at 4\.974 kHz \(the stored grid point nearest 5 kHz\)/
        .test(res.at5k.lineage[0].text),
      narrow: res.narrow.fits,
      light: res.light.theme === 'light' && hex(res.light.color) === res.light.text2.toLowerCase(),
      contradicted: /^Calibration as applied: uncalibrated \(the stored claim is contradicted\)/
        .test(ln(res.older, 'calibration').text) && st(res.older, 'calibration').state
        === 'partial',
      noSpl: res.spl.length === 0,
      compare: res.diff === 'Checklist differences (states only): Calibration identity recorded '
        + '(A recorded, B partial). No difference in the recorded build, definition, calibration '
        + 'or input device.',
    }) };
  });

  def('findings', async ({ page }) => {
    await H.workspace(page, 'experiments');
    for (const k of ['a', 'b']) {
      const stored = await page.evaluate(async (x) => !!(await window.OSCILLA.experiments.store()
        .get(x)), `fixture-${k}`);
      if (!stored) {
        await page.evaluate((t) => window.OSCILLA.app.experimentsImportText(t), fixtures[k].json);
      }
    }
    const res = {};
    const panel = () => page.evaluate(() => {
      const sec = document.querySelector('[data-osc="fnd.panel"]');
      if (!sec) return { missing: true };
      const r = sec.getBoundingClientRect();
      const rows = [...sec.querySelectorAll('[data-osc="fnd.row"]')].map((li) => ({
        tag: li.tagName, h4: (li.querySelector('h4') || {}).textContent || null,
        status: (li.querySelector('[data-osc="fnd.status"]') || {}).textContent || null,
        evidence: [...li.querySelectorAll('[data-osc="fnd.ref"]')].map((x) => ({
          state: x.dataset.state, text: x.textContent.replace(/\s+/g, ' ').trim(),
          inList: x.parentElement.tagName === 'UL' })) }));
      return { shown: sec.offsetParent !== null, h3: (sec.querySelector('h3') || {}).textContent,
        rows, text: sec.textContent.replace(/\s+/g, ' '),
        fits: sec.scrollWidth <= sec.clientWidth + 1 && r.right <= window.innerWidth + 1
          && document.documentElement.scrollWidth <= window.innerWidth + 1 };
    });
    const backlinks = () => page.evaluate(() => {
      const sec = document.querySelector('[data-osc="exp.findings"]');
      if (!sec) return { missing: true };
      return { shown: sec.offsetParent !== null, h4: (sec.querySelector('h4') || {}).textContent,
        items: [...sec.querySelectorAll('li')].map((li) => li.textContent.replace(/\s+/g, ' ')
          .trim()) };
    });
    const dialogOpen = () => page.evaluate(() => {
      const d = document.getElementById('osc-dlg-finding');
      return !!d && d.open;
    });
    // 1. From a run's detail: "Record a finding about this run" (keyboard: focus + Enter).
    await page.evaluate(() => window.OSCILLA.app.experimentsOpen('fixture-a'));
    const button = await H.until(() => page.evaluate(() => {
      const b = document.querySelector('[data-osc="exp.findingNew"]');
      return !!b && b.offsetParent !== null;
    }), Boolean, 5000);
    if (!button) {
      return { ok: false, failed: ['record-from-run'], detail: 'no "Record a finding" button' };
    }
    await page.focus('[data-osc="exp.findingNew"]');
    await page.keyboard.press('Enter');
    res.opened = await H.until(dialogOpen, Boolean, 3000);
    res.prefilled = await page.evaluate(() => [...document.querySelectorAll(
      '#osc-dlg-finding [data-osc="fnd.formRef"]')].map((li) => li.textContent
      .replace(/\s+/g, ' ').trim()));
    await page.fill('#osc-fnd-statement', 'A falls above 6 kHz; B is 0.9 dB quieter.');
    res.guard = await page.evaluate(() => window.OSCILLA.unsaved.whatWouldBeLost()
      .filter((x) => x.domain === 'findings').map((x) => x.label));
    // 2. Link a comparison.
    await page.selectOption('#osc-fnd-cmp-a', 'fixture-a');
    await page.selectOption('#osc-fnd-cmp-b', 'fixture-b');
    await page.click('[data-osc="fnd.addCompare"]');
    res.linked = await H.until(() => page.evaluate(() => ({
      refs: [...document.querySelectorAll('#osc-dlg-finding [data-osc="fnd.formRef"]')]
        .map((li) => li.textContent.replace(/\s+/g, ' ').trim()),
      // offsetParent is null inside a top-layer dialog: visibility is a rendered box.
      hint: ((el) => !!el && el.getClientRects().length > 0)(document.querySelector(
        '[data-osc="fnd.compareHint"]')) })), (x) => x.refs.length === 2 && x.hint, 3000);
    // 3. A categorical status; supported needs evidence (it has two references now).
    res.statuses = await page.evaluate(() => [...document.querySelectorAll(
      '#osc-fnd-status option')].map((o) => o.value));
    await page.selectOption('#osc-fnd-status', 'supported');
    await page.click('[data-osc="fnd.save"]');
    res.closed = await H.until(dialogOpen, (o) => o === false, 5000);
    res.guardAfter = await page.evaluate(() => window.OSCILLA.unsaved.whatWouldBeLost()
      .filter((x) => x.domain === 'findings').length);
    res.saved = await H.until(panel, (p) => p.rows && p.rows.length === 1
      && p.rows[0].evidence.length === 2, 5000);
    // 4. Backlinks on both runs' details.
    res.backA = await H.until(backlinks, (b) => b.items && b.items.length === 1, 5000);
    await page.evaluate(() => window.OSCILLA.app.experimentsOpen('fixture-b'));
    res.backB = await H.until(backlinks, (b) => b.items && b.items.length === 1
      && /comparison/.test(b.items[0]), 5000);
    res.exported = await page.evaluate(() => window.OSCILLA.app.findingsExport());
    res.hashA = fixtures.a.experiment.provenance.resultHash;
    // 5. Delete the cited run B: the dialog says that a finding cites it; the reference then
    // reads missing, and the finding keeps its status.
    await page.click('[data-osc="exp.delete"]');
    res.warning = await H.until(() => page.evaluate(() => {
      const el = document.querySelector('[data-osc="exp.deleteCiting"]');
      return el && el.offsetParent !== null ? el.textContent.replace(/\s+/g, ' ').trim() : '';
    }), (t) => t.length > 0, 3000);
    await page.click('[data-osc="exp.deleteConfirm"]');
    res.afterDelete = await H.until(panel, (p) => p.rows && p.rows[0]
      && p.rows[0].evidence.some((e) => e.state === 'missing'), 5000);
    // 6. 390 px and the light theme.
    await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate(() => document.querySelector('[data-osc="fnd.panel"]').scrollIntoView());
    res.narrow = await H.until(panel, (p) => p.fits, 2000);
    await page.evaluate(() => window.OSCILLA.app.toggleTheme());
    res.light = await page.evaluate(() => ({
      theme: document.documentElement.dataset.theme,
      color: getComputedStyle(document.querySelector('[data-osc="fnd.row"] h4')).color,
      text: getComputedStyle(document.documentElement).getPropertyValue('--osc-text').trim() }));
    await page.evaluate(() => window.OSCILLA.app.toggleTheme());
    await page.setViewportSize({ width: 1536, height: 1024 });
    // Leave the store as later checks expect it: no finding, B stored again.
    await page.evaluate(async (t) => {
      const app = window.OSCILLA.app;
      for (const r of app.fnd.rows.slice()) await app.findingsDeleteNow(r.id);
      await app.experimentsImportText(t);
      app.alerts = [];
    }, fixtures.b.json);
    const hex = (c) => { const m = String(c).match(/\d+/g) || []; return `#${m.slice(0, 3)
      .map((v) => Number(v).toString(16).padStart(2, '0')).join('')}`; };
    const row = (res.saved.rows || [])[0] || { evidence: [] };
    const after = (res.afterDelete.rows || [])[0] || { evidence: [] };
    const out = { ...res, exported: res.exported ? res.exported.length : null };
    for (const k of ['saved', 'afterDelete', 'narrow']) if (out[k]) out[k] = { ...out[k], text: '' };
    return { ...out, ...H.verdict({
      'record-from-run': res.opened === true && res.prefilled.length === 1
        && /^Run "TEST CONTEXT · synthetic A/.test(res.prefilled[0]),
      guard: res.guard.join() === 'A finding being written' && res.guardAfter === 0,
      'link-compare': res.linked.refs.length === 2 && /^Comparison of ".*" with ".*" \(what changed between the runs, not why\)/
        .test(res.linked.refs[1]) && res.linked.hint,
      categorical: res.statuses.join() === 'observation,hypothesis,supported,contradicted,'
        + 'inconclusive',
      supported: res.closed === false && row.status === 'Supported' && row.tag === 'LI'
        && row.h4 === 'A falls above 6 kHz; B is 0.9 dB quieter.'
        && row.evidence.every((e) => e.state === 'ok' && e.inList),
      panel: res.saved.shown && res.saved.h3 === 'Findings',
      backlinks: res.backA.shown && res.backA.h4 === 'Findings that cite this run'
        && /A falls above 6 kHz/.test(res.backA.items[0]) && /Supported/.test(res.backA.items[0])
        && /comparison/.test(res.backB.items[0]),
      export: typeof res.exported === 'string' && res.exported.includes(res.hashA)
        && res.exported.includes('"kind": "oscilla-findings"'),
      'delete-warning': /^1 finding cites this run/.test(res.warning),
      missing: after.status === 'Supported' && after.evidence.length === 2
        && after.evidence[0].state === 'ok' && after.evidence[1].state === 'missing'
        && /missing: run .* is not stored here/.test(after.evidence[1].text),
      notCausal: !/\bcaused\b|because|due to/i.test(res.saved.text || ''),
      narrow: res.narrow.fits,
      light: res.light.theme === 'light' && hex(res.light.color) === res.light.text.toLowerCase(),
    }) };
  });

  // Connected records (ADR 0048): a record link through the hash dispatcher, both directions,
  // keyboard and Back / Forward, focus, and the identity states: a different record stored
  // under a cited id reads "does not match", a stored record that fails to verify reads
  // "unreadable", never as fine.
  def('connections', async ({ page }) => {
    await H.workspace(page, 'experiments');
    for (const k of ['a', 'b']) {
      const stored = await page.evaluate(async (x) => !!(await window.OSCILLA.experiments.store()
        .get(x).catch(() => null)), `fixture-${k}`);
      if (!stored) {
        await page.evaluate((t) => window.OSCILLA.app.experimentsImportText(t), fixtures[k].json);
      }
    }
    const res = {};
    const ids = await page.evaluate(async () => {
      const app = window.OSCILLA.app;
      const dup = await app.experimentsDuplicate('fixture-a');
      await app.findingsAskRun('fixture-a');
      app.fnd.form.statement = 'Connections: A falls above 6 kHz.';
      const f = await app.findingsSave();
      app.alerts = [];
      return { dup, finding: f ? f.id : null };
    });
    const items = (sel) => page.evaluate((q) => {
      const sec = document.querySelector(q);
      if (!sec) return { missing: true };
      const lists = [...sec.querySelectorAll('.osc-x-cn-list')];
      const li = (ul) => (ul ? [...ul.querySelectorAll('li.osc-x-cn-item')].map((x) => ({
        state: x.dataset.state, relation: x.dataset.relation,
        href: (x.querySelector('a') || { getAttribute: () => null }).getAttribute('href'),
        text: x.textContent.replace(/\s+/g, ' ').trim() })) : []);
      const st = sec.querySelector('[role="status"]');
      const r = sec.getBoundingClientRect();
      return { shown: sec.getClientRects().length > 0, h4: (sec.querySelector('h4') || {})
        .textContent || null, status: st ? st.textContent.trim() : '', up: li(lists[0]),
      down: li(lists[1]), fits: r.right <= window.innerWidth + 1
          && document.documentElement.scrollWidth <= window.innerWidth + 1 };
    }, sel);
    const RUN = '[data-osc="exp.connections"]';
    const state = () => page.evaluate(() => ({ id: window.OSCILLA.app.exps.detail
      ? window.OSCILLA.app.exps.detail.id : null, hash: location.hash,
    focus: document.activeElement ? document.activeElement.id : null }));
    // 1. A record link (typed into the address): the run opens, focus on its heading.
    await page.evaluate(() => { location.hash = '#m=experiments&run=fixture-a'; });
    res.linked = await H.until(state, (x) => x.id === 'fixture-a'
      && x.focus === 'osc-x-detail-title', 5000);
    res.a = await H.until(() => items(RUN), (x) => x.shown && x.down && x.down.length === 2
      && !x.status, 10000);
    // 2. Keyboard: Enter on "Duplicated as" follows the link to the duplicate.
    await page.focus(`${RUN} li[data-relation="duplicated-as"] a`);
    await page.keyboard.press('Enter');
    res.toDup = await H.until(state, (x) => x.id === ids.dup && x.focus === 'osc-x-detail-title'
      && x.hash.includes(`run=${ids.dup}`), 5000);
    res.dup = await H.until(() => items(RUN), (x) => x.up && x.up.some((c) => c.relation
      === 'duplicate-of') && !x.status, 10000);
    // 3. Back returns to the run the link was followed from; Forward to the duplicate.
    await page.goBack();
    res.back = await H.until(state, (x) => x.id === 'fixture-a'
      && x.hash.includes('run=fixture-a'), 5000);
    await page.goForward();
    res.forward = await H.until(state, (x) => x.id === ids.dup, 5000);
    await page.goBack();
    await H.until(state, (x) => x.id === 'fixture-a', 5000);
    // 4. "Cited by": the finding's connected records open, focus on its statement.
    await H.until(() => items(RUN), (x) => x.down && x.down.length === 2 && !x.status, 10000);
    await page.click(`${RUN} li[data-relation="cited-by"] a`);
    const FND = `[data-osc="fnd.row"][data-id="${ids.finding}"] [data-osc="fnd.connections"]`;
    res.finding = await H.until(() => items(FND), (x) => x.shown && x.up.length === 1
      && !x.status, 10000);
    res.findingFocus = await H.until(() => page.evaluate((id) => {
      const el = document.activeElement;
      return !!el && el.tagName === 'H4' && !!el.closest(`[data-id="${id}"]`);
    }, ids.finding), Boolean, 3000);
    // 5. A different record stored under the cited id: never shown as fine.
    await page.evaluate(async (t) => {
      const app = window.OSCILLA.app;
      app.exps.deleteId = 'fixture-a';
      await app.experimentsDelete();
      const d = JSON.parse(t);
      d.experimentId = 'fixture-a';
      d.name = 'IMPOSTOR under fixture-a';
      await app.experimentsImportText(JSON.stringify(d));
      app.alerts = [];
    }, fixtures.c.json);
    res.impostorFinding = await H.until(() => items(FND), (x) => x.up && x.up[0]
      && x.up[0].state === 'mismatch', 10000);
    await page.evaluate((id) => { location.hash = `#m=experiments&run=${id}`; }, ids.dup);
    res.impostorDup = await H.until(() => items(RUN), (x) => x.up && x.up.some((c) => c.relation
      === 'duplicate-of' && c.state === 'mismatch'), 10000);
    // 6. The stored record altered under its hash (IndexedDB only): unreadable after a reload.
    res.storeKind = await page.evaluate(() => window.OSCILLA.app.exps.storeKind);
    if (res.storeKind === 'indexeddb') {
      await page.evaluate(async () => {
        const db = await new Promise((ok) => { const r = indexedDB.open('oscilla-experiments');
          r.onsuccess = () => ok(r.result); });
        const doc = await new Promise((ok) => { const q = db.transaction('experiments')
          .objectStore('experiments').get('fixture-a'); q.onsuccess = () => ok(q.result); });
        const t = JSON.stringify(doc).replace(/"resultHash":"[0-9a-f]{64}"/,
          `"resultHash":"${'e'.repeat(64)}"`);
        await new Promise((ok) => { const tx = db.transaction('experiments', 'readwrite');
          tx.objectStore('experiments').put(JSON.parse(t)); tx.oncomplete = ok; });
        db.close();
      });
      await page.evaluate((id) => { location.hash = `#m=experiments&finding=${id}`; },
        ids.finding);
      await page.reload();
      await page.waitForFunction(() => window.OSCILLA && window.OSCILLA.app
        && window.OSCILLA.app.fnd.loaded, null, { timeout: 30000 }).catch(() => {});
      res.corrupt = await H.until(() => items(FND), (x) => x.up && x.up[0]
        && x.up[0].state === 'unreadable', 10000);
    }
    // 7. 390 px.
    await page.evaluate((id) => { location.hash = `#m=experiments&run=${id}`; }, ids.dup);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate(() => document.querySelector('[data-osc="exp.connections"]')
      .scrollIntoView());
    res.narrow = await H.until(() => items(RUN), (x) => x.fits && x.up.length > 0, 3000);
    await page.setViewportSize({ width: 1536, height: 1024 });
    // Leave the store as later checks expect it: a and b, no finding, no duplicate.
    await page.evaluate(async ({ a, dup }) => {
      const app = window.OSCILLA.app;
      const s = await window.OSCILLA.experiments.store();
      for (const r of app.fnd.rows.slice()) await app.findingsDeleteNow(r.id);
      await s.delete('fixture-a');
      await s.delete(dup);
      await app.experimentsImportText(a);
      location.hash = '#m=experiments';
      app.alerts = [];
    }, { a: fixtures.a.json, dup: ids.dup });
    const by = (list, rel) => (list || []).filter((c) => c.relation === rel);
    const a = res.a.down || [];
    const cite = by(a, 'cited-by')[0] || {};
    const dupOf = by(res.dup.up, 'duplicate-of')[0] || {};
    const build = by(res.a.up, 'build')[0] || {};
    return { ...res, ...H.verdict({
      'link-opens': res.linked.id === 'fixture-a' && res.linked.focus === 'osc-x-detail-title'
        && res.a.shown && res.a.h4 === 'Connected records',
      downstream: cite.state === 'present' && cite.href === `#m=experiments&finding=${ids.finding}`
        && /Cited by finding "Connections: A falls above 6 kHz\."/.test(cite.text)
        && /Field: evidence\[0\] \(identity: runs\[0\]\.resultHash\), on that finding\./
          .test(cite.text)
        && by(a, 'duplicated-as').length === 1 && by(a, 'duplicated-as')[0].state === 'present',
      upstream: dupOf.state === 'present' && dupOf.href === '#m=experiments&run=fixture-a'
        && /Field: provenance\.duplicateOf, on this run\./.test(dupOf.text)
        && build.state === 'missing' && /this page runs OSCILLA/.test(build.text),
      keyboard: res.toDup.id === ids.dup && res.toDup.focus === 'osc-x-detail-title',
      history: res.back.id === 'fixture-a' && res.forward.id === ids.dup,
      finding: res.finding.up[0] && res.finding.up[0].state === 'present'
        && /^Cites run "TEST CONTEXT · synthetic A/.test(res.finding.up[0].text)
        && res.findingFocus === true,
      impostor: /^Cites run "IMPOSTOR under fixture-a" — does not match: .*a different record/
        .test((res.impostorFinding.up || [{}])[0].text || '')
        && by(res.impostorDup.up, 'duplicate-of')[0].state === 'mismatch',
      corrupt: res.storeKind !== 'indexeddb' || (res.corrupt.up && res.corrupt.up[0].state
        === 'unreadable' && /— unreadable: run .* is stored here but cannot be read/
        .test(res.corrupt.up[0].text)),
      narrow: res.narrow.fits === true,
    }) };
  });

  // Review 1 of #149, items 1 and 2: a cited run replaced by a record without a result hash, or
  // stored but unreadable, is never shown as present (no "ok", no Open).
  def('findings-integrity', async ({ page, context }) => {
    await H.workspace(page, 'experiments');
    const as = (k, id, { unstamped = false, name = null } = {}) => {
      const j = JSON.parse(fixtures[k].json);
      j.experimentId = id;
      if (name) j.name = name;
      if (unstamped) {
        delete j.provenance.resultHash;
        delete j.provenance.resultHashVersion;
      }
      return JSON.stringify(j);
    };
    const res = {};
    res.setup = await page.evaluate(async ([x, y]) => {
      const a = window.OSCILLA.app;
      await a.experimentsImportText(x);
      await a.experimentsImportText(y);
      const out = [];
      for (const [id, st] of [['fixture-imp', 'cites the replaced run'],
        ['fixture-bad', 'cites the unreadable run']]) {
        await a.findingsAskRun(id);
        a.fnd.form.statement = st;
        a.fnd.form.status = 'supported';
        out.push(!!(await a.findingsSave()));
      }
      return out;
    }, [as('b', 'fixture-imp'), as('a', 'fixture-bad')]);
    const rowIn = (p, statement) => p.evaluate((st) => {
      const li = [...document.querySelectorAll('[data-osc="fnd.row"]')]
        .find((x) => x.querySelector('h4').textContent === st);
      if (!li) return { missing: true };
      return { refs: [...li.querySelectorAll('[data-osc="fnd.ref"]')].map((x) => ({
        state: x.dataset.state, text: x.textContent.replace(/\s+/g, ' ').trim(),
        open: !!x.querySelector('[data-osc="fnd.openRef"]') })),
        issue: ((li.querySelector('[data-osc="fnd.statusIssue"]') || {}).textContent || '') };
    }, statement);
    res.before = await rowIn(page, 'cites the replaced run');
    // 1. Delete the cited run and store a different record without a result hash under its id.
    await page.evaluate(async (t) => {
      const a = window.OSCILLA.app;
      a.experimentsAskDelete({ id: 'fixture-imp', name: 'imp' });
      await a.experimentsDelete();
      await a.experimentsImportText(t);
      a.alerts = [];
    }, as('c', 'fixture-imp', { unstamped: true, name: 'TEST CONTEXT · a different record' }));
    res.replaced = await H.until(() => rowIn(page, 'cites the replaced run'),
      (r) => r.refs && r.refs[0] && r.refs[0].state !== 'ok', 5000);
    // 2. Corrupt the other cited run in IndexedDB and read it in a fresh page (nothing cached).
    res.kind = await page.evaluate(() => window.OSCILLA.experiments.store().kind);
    if (res.kind === 'indexeddb') {
      res.corrupted = await page.evaluate(() => new Promise((resolve) => {
        const r = indexedDB.open('oscilla-experiments');
        r.onsuccess = () => {
          const db = r.result;
          const tx = db.transaction('experiments', 'readwrite');
          const os = tx.objectStore('experiments');
          const q = os.get('fixture-bad');
          q.onsuccess = () => {
            const doc = q.result;
            doc.provenance.resultHash = 'e'.repeat(64);
            os.put(doc);
          };
          tx.oncomplete = () => { db.close(); resolve(true); };
          tx.onerror = () => resolve(false);
        };
        r.onerror = () => resolve(false);
      }));
      const page2 = await context.newPage();
      try {
        await page2.goto(page.url(), { waitUntil: 'load' });
        await page2.waitForSelector('html[data-ready="true"]', { timeout: 15000 });
        await page2.evaluate(() => window.OSCILLA.app.setWorkspace('experiments'));
        res.unreadable = await H.until(() => rowIn(page2, 'cites the unreadable run'),
          (r) => r.refs && r.refs[0] && r.refs[0].state !== 'ok', 8000);
      } finally {
        await page2.close();
      }
    } else res.unreadable = { skipped: `store ${res.kind}` };
    await page.evaluate(async () => {
      const a = window.OSCILLA.app;
      for (const r of a.fnd.rows.slice()) await a.findingsDeleteNow(r.id);
      for (const id of ['fixture-imp', 'fixture-bad']) {
        a.exps.deleteId = id;
        await a.experimentsDelete();
      }
      a.alerts = [];
    });
    const r0 = (x) => (x && x.refs && x.refs[0]) || {};
    return { ...res, ...H.verdict({
      setup: res.setup.join() === 'true,true' && r0(res.before).state === 'ok',
      'unverifiable-not-ok': r0(res.replaced).state === 'broken' && !r0(res.replaced).open
        && /cannot be verified: the record stored under this id has no result hash/
          .test(r0(res.replaced).text) && /none of the evidence it cites/.test(res.replaced.issue),
      'unreadable-not-ok': res.kind !== 'indexeddb' || (r0(res.unreadable).state === 'broken'
        && !r0(res.unreadable).open && /is stored here but cannot be read/
          .test(r0(res.unreadable).text)),
    }) };
  });

  // Connected records across two tabs (review 2 of #149): the run open in this tab is replaced
  // in another tab by a different record under its id. The connections of the open run and of
  // the finding citing it are read from the store, never from this tab's decoded copy, so they
  // say "does not match", not "stored here". IndexedDB only (two tabs share no page memory).
  def('connections-two-tabs', async ({ page, context }) => {
    await H.workspace(page, 'experiments');
    const res = {};
    res.kind = await page.evaluate(() => window.OSCILLA.app.exps.storeKind);
    if (res.kind !== 'indexeddb') return { ok: true, skipped: `store ${res.kind}` };
    res.setup = await page.evaluate(async (t) => {
      const app = window.OSCILLA.app;
      const s = await window.OSCILLA.experiments.store();
      if (!(await s.get('fixture-b').catch(() => null))) await app.experimentsImportText(t);
      await app.findingsAskRun('fixture-b');
      app.fnd.form.statement = 'Two tabs: B is quieter.';
      const f = await app.findingsSave();
      await app.experimentsOpen('fixture-b');
      app.alerts = [];
      return f ? f.id : null;
    }, fixtures.b.json);
    const RUN = '[data-osc="exp.connections"] li.osc-x-cn-item';
    const cited = () => page.evaluate((q) => [...document.querySelectorAll(q)]
      .filter((x) => x.dataset.relation === 'cited-by').map((x) => ({ state: x.dataset.state,
        text: x.textContent.replace(/\s+/g, ' ').trim() })), RUN);
    res.before = await H.until(cited, (l) => l.length === 1 && l[0].state === 'present', 10000);
    // The finding's connections, listed now: B "stored here", its link verified with B's hash.
    await page.evaluate((id) => window.OSCILLA.app.connectionsToggle('finding', id, true),
      res.setup);
    const CITES = `[data-osc="fnd.row"][data-id="${res.setup}"] [data-osc="fnd.connections"] `
      + 'li[data-relation="cites"]';
    res.listed = await H.until(() => page.evaluate((q) => {
      const li = document.querySelector(q);
      return li ? li.dataset.state : null;
    }, CITES), (x) => x === 'present', 10000);
    const page2 = await context.newPage();
    try {
      await page2.goto(page.url(), { waitUntil: 'load' });
      await page2.waitForSelector('html[data-ready="true"]', { timeout: 15000 });
      res.tab2 = await page2.evaluate(async (t) => {
        const app = window.OSCILLA.app;
        app.setWorkspace('experiments');
        await app.experimentsRefresh();
        app.exps.deleteId = 'fixture-b';
        await app.experimentsDelete();
        const d = JSON.parse(t);
        d.experimentId = 'fixture-b';
        d.name = 'IMPOSTOR under fixture-b';
        return app.experimentsImportText(JSON.stringify(d));
      }, fixtures.c.json);
    } finally {
      await page2.close();
    }
    // This tab, no reload, the list not read again: following the link reads B first and
    // refuses, since a different record is stored under its id now.
    await page.evaluate(() => { window.OSCILLA.app.alerts = []; });
    await page.click(`${CITES} a`);
    res.refused = await H.until(() => page.evaluate(() => ({
      alerts: window.OSCILLA.app.alerts.map((x) => `${x.title}: ${x.message || x.text || ''}`),
      hash: location.hash })), (x) => x.alerts.some((t) => /changed since this list was read/
      .test(t)), 8000);
    // Back to Experiments (Measure and back), which reads the connections again.
    await page.evaluate(() => window.OSCILLA.app.setWorkspace('measure'));
    await page.evaluate(() => window.OSCILLA.app.setWorkspace('experiments'));
    res.after = await H.until(cited, (l) => l.length === 1 && l[0].state !== 'present', 10000);
    res.finding = await page.evaluate((id) => window.OSCILLA.app.connectionsOfFinding(id)
      .then((v) => v.upstream.map((c) => c.state)), res.setup);
    await page.evaluate(async (t) => {
      const app = window.OSCILLA.app;
      for (const r of app.fnd.rows.slice()) await app.findingsDeleteNow(r.id);
      app.exps.deleteId = 'fixture-b';
      await app.experimentsDelete();
      await app.experimentsImportText(t);
      app.alerts = [];
    }, fixtures.b.json);
    return { ...res, ...H.verdict({
      before: res.before[0] && res.before[0].state === 'present',
      replaced: res.tab2 === 'fixture-b' && res.listed === 'present',
      'open-refused': res.refused.alerts.some((t) => /Run not opened: .*changed since this list was read: a different record is stored under its id now/.test(t)),
      'not-present': res.after[0] && res.after[0].state === 'mismatch'
        && /does not match: .*different record/.test(res.after[0].text),
      finding: res.finding.join() === 'mismatch',
    }) };
  });

  // Review 1 of #149, item 5: Escape and a backdrop click keep a typed draft; the guard keeps
  // reporting it; only Discard drops it.
  def('findings-draft', async ({ page }) => {
    await H.workspace(page, 'experiments');
    const stored = await page.evaluate(async () => !!(await window.OSCILLA.experiments.store()
      .get('fixture-a')));
    if (!stored) {
      await page.evaluate((t) => window.OSCILLA.app.experimentsImportText(t), fixtures.a.json);
    }
    await page.evaluate(() => window.OSCILLA.app.experimentsOpen('fixture-a'));
    await H.until(() => page.evaluate(() => {
      const b = document.querySelector('[data-osc="exp.findingNew"]');
      return !!b && b.offsetParent !== null;
    }), Boolean, 5000);
    const open = () => page.evaluate(() => document.getElementById('osc-dlg-finding').open);
    const state = () => page.evaluate(() => {
      const note = document.querySelector('[data-osc="fnd.draftNote"]');
      return { open: document.getElementById('osc-dlg-finding').open,
        lost: window.OSCILLA.unsaved.whatWouldBeLost().filter((x) => x.domain === 'findings')
          .map((x) => x.label),
        note: !!note && note.getClientRects().length > 0,
        value: document.getElementById('osc-fnd-statement').value };
    });
    const res = {};
    await page.click('[data-osc="exp.findingNew"]');
    await H.until(open, Boolean, 3000);
    await page.fill('#osc-fnd-statement', 'a long careful draft');
    await page.keyboard.press('Escape');
    res.escape = await H.until(state, (x) => !x.open && x.note, 3000);
    const cont = await page.$('[data-osc="fnd.draftContinue"]');
    if (cont) await cont.click();
    res.continued = await H.until(state, (x) => x.open && !x.note, 3000);
    await page.mouse.click(3, 3); // the backdrop
    res.backdrop = await H.until(state, (x) => !x.open && x.note, 3000);
    if (cont) await page.click('[data-osc="fnd.draftContinue"]');
    await H.until(open, Boolean, 3000);
    const discard = await page.$('[data-osc="fnd.discard"]');
    if (discard) await discard.click();
    res.discarded = await H.until(state, (x) => !x.open && !x.lost.length, 3000);
    await page.evaluate(() => {
      window.OSCILLA.app.closeModal('osc-dlg-finding');
      window.OSCILLA.app.alerts = [];
    });
    const kept = (x) => !x.open && x.lost.join() === 'A finding being written' && x.note;
    return { ...res, ...H.verdict({
      escape: kept(res.escape),
      continue: res.continued.open && res.continued.value === 'a long careful draft',
      backdrop: kept(res.backdrop),
      discard: !res.discarded.open && !res.discarded.lost.length && !res.discarded.note,
    }) };
  });

  // Review 1 of #149, item 12: after a finding is deleted with the keyboard, focus moves to the
  // next finding (its Edit) or, with none left, to "New finding"; never to the page start.
  def('findings-delete-focus', async ({ page }) => {
    await H.workspace(page, 'experiments');
    const stored = await page.evaluate(async () => !!(await window.OSCILLA.experiments.store()
      .get('fixture-a')));
    if (!stored) {
      await page.evaluate((t) => window.OSCILLA.app.experimentsImportText(t), fixtures.a.json);
    }
    await page.evaluate(async () => {
      const a = window.OSCILLA.app;
      for (const st of ['first finding', 'second finding']) {
        await a.findingsAskRun('fixture-a');
        a.fnd.form.statement = st;
        await a.findingsSave();
      }
    });
    const res = {};
    res.rows = await H.until(() => page.evaluate(() => document.querySelectorAll(
      '[data-osc="fnd.row"]').length), (n) => n === 2, 5000);
    res.judgement = await page.evaluate(() => document.querySelector('[data-osc="fnd.row"]')
      .textContent.replace(/\s+/g, ' ').includes('Your judgement: Observation'));
    const del = async () => {
      await page.focus('[data-osc="fnd.row"] [data-osc="fnd.delete"]');
      await page.keyboard.press('Enter');
      await H.until(() => page.evaluate(() => document.getElementById('osc-dlg-finding-delete')
        .open), Boolean, 3000);
      await page.focus('[data-osc="fnd.deleteConfirm"]');
      await page.keyboard.press('Enter');
    };
    const focus = () => page.evaluate(() => {
      const e = document.activeElement;
      const row = e && e.closest('[data-osc="fnd.row"]');
      return { osc: e && e.dataset ? e.dataset.osc || e.id || e.tagName : null,
        row: row ? row.querySelector('h4').textContent : null,
        rows: document.querySelectorAll('[data-osc="fnd.row"]').length };
    });
    res.deleted = await page.evaluate(() => document.querySelector('[data-osc="fnd.row"] h4')
      .textContent);
    await del();
    res.afterFirst = await H.until(focus, (f) => f.rows === 1 && f.osc === 'fnd.edit', 3000);
    await del();
    res.afterLast = await H.until(focus, (f) => f.rows === 0 && f.osc === 'fnd.new', 3000);
    await page.evaluate(() => { window.OSCILLA.app.alerts = []; });
    return { ...res, ...H.verdict({
      setup: res.rows === 2,
      judgement: res.judgement === true,
      next: res.afterFirst.osc === 'fnd.edit' && !!res.afterFirst.row
        && res.afterFirst.row !== res.deleted,
      none: res.afterLast.osc === 'fnd.new',
    }) };
  });

  // Review 2 of #149, item 1: a second tab replaces a cited run with a different stamped
  // record; in this tab an unrelated finding is saved (a findings refresh without a list
  // refresh). The citing finding must read broken, with no Open, then and after a list refresh.
  def('findings-two-tabs', async ({ page, context }) => {
    await H.workspace(page, 'experiments');
    const as = (k, id, name = null) => {
      const j = JSON.parse(fixtures[k].json);
      j.experimentId = id;
      if (name) j.name = name;
      return JSON.stringify(j);
    };
    const res = {};
    res.setup = await page.evaluate(async ([t, u]) => {
      const a = window.OSCILLA.app;
      await a.experimentsImportText(t);
      await a.experimentsImportText(u);
      await a.findingsAskRun('fixture-tab');
      a.fnd.form.statement = 'cites the run another tab replaces';
      a.fnd.form.status = 'supported';
      return !!(await a.findingsSave());
    }, [as('b', 'fixture-tab'), as('a', 'fixture-tab-u')]);
    const row = (p) => p.evaluate(() => {
      const li = [...document.querySelectorAll('[data-osc="fnd.row"]')]
        .find((x) => x.querySelector('h4').textContent === 'cites the run another tab replaces');
      const r = li && li.querySelector('[data-osc="fnd.ref"]');
      return r ? { state: r.dataset.state, open: !!r.querySelector('[data-osc="fnd.openRef"]'),
        text: r.textContent.replace(/\s+/g, ' ').trim() } : { missing: true };
    });
    res.before = await row(page);
    const page2 = await context.newPage();
    try {
      await page2.goto(page.url(), { waitUntil: 'load' });
      await page2.waitForSelector('html[data-ready="true"]', { timeout: 15000 });
      await page2.evaluate(() => window.OSCILLA.app.setWorkspace('experiments'));
      await page2.waitForFunction(() => window.OSCILLA.app.exps.loaded, null, { timeout: 15000 });
      res.tab2 = await page2.evaluate(async (t) => {
        const a = window.OSCILLA.app;
        a.exps.deleteId = 'fixture-tab';
        const deleted = await a.experimentsDelete();
        const imported = await a.experimentsImportText(t);
        return { deleted, imported };
      }, as('c', 'fixture-tab', 'TEST CONTEXT · the record another tab stored'));
    } finally {
      await page2.close();
    }
    // This tab: an unrelated finding is saved, then the list is refreshed.
    await page.evaluate(async () => {
      const a = window.OSCILLA.app;
      await a.findingsAskRun('fixture-tab-u');
      a.fnd.form.statement = 'an unrelated finding';
      await a.findingsSave();
    });
    res.afterSave = await H.until(() => row(page), (r) => r.state !== 'ok', 4000);
    await page.evaluate(() => window.OSCILLA.app.experimentsRefresh());
    res.afterRefresh = await H.until(() => row(page), (r) => r.state !== 'ok', 4000);
    await page.evaluate(async () => {
      const a = window.OSCILLA.app;
      for (const r of a.fnd.rows.slice()) await a.findingsDeleteNow(r.id);
      for (const id of ['fixture-tab', 'fixture-tab-u']) {
        a.exps.deleteId = id;
        await a.experimentsDelete();
      }
      a.alerts = [];
    });
    const broken = (r) => r.state === 'broken' && !r.open
      && /different record is stored under this id/.test(r.text);
    return { ...res, ...H.verdict({
      setup: res.setup === true && res.before.state === 'ok',
      'tab2-replaced': !!res.tab2 && res.tab2.deleted === true && !!res.tab2.imported,
      'broken-after-save': broken(res.afterSave),
      'broken-after-refresh': broken(res.afterRefresh),
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
