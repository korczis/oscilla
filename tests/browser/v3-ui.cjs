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
//                           seven steps, quality bar, quality status with reasons, response / IR
//                           summaries, TEST CONTEXT banner, one announcement per stage and no
//                           progress chatter, save, repeat (new experiment, repeatOf), 0 engine
//                           and io nodes, sources, captures and ports afterwards
//   abort-stages            abort in PREFLIGHT, NOISE_CHECK, ARMED, MEASURING and ANALYZING via
//                           Escape, STOP, page hide and leaving the workspace: ABORTED, the
//                           stopped announcement, 0 nodes/sources/captures/ports after
//   output-exclusive        the instrument cannot play while a measurement owns the output
//   fake-mic                (chromium, firefox) permission + setup check on the real capture io,
//                           applied constraints read back, every track stopped after reset
//   calibration             CSV profile import -> Frequency CALIBRATED; level calibration dialog
//                           (explicit values) -> Level CALIBRATED; invalid input refused
//   experiments             import of three fixtures, list, open, rename, duplicate, compare
//                           (A, B equivalent: A − B shown; A, C: refused with the reason),
//                           export .oscilla.json (re-validates), CSV, re-import refused (no
//                           overwrite), explicit delete with confirmation, inspection in MEASURE
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

const LAUNCH = {
  chromium: { args: ['--autoplay-policy=no-user-gesture-required',
    '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] },
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
  workspace: async (page, ws) => {
    await page.click(`[data-osc="nav.${ws}"]`);
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
   * Run a measurement through `start` (a click) until it ends; a run rejected for a CAPTURE
   * DEFECT of the realtime platform (Firefox's headless loopback occasionally delivers a
   * discontinuity) is repeated up to twice and reported, never hidden: the UI path is what this
   * suite asserts, the capture checks are asserted by v3-measure.cjs.
   */
  run: async (page, start) => {
    const defects = [];
    for (let i = 0; i < 3; i++) {
      await start();
      await H.waitState(page, ['COMPLETE', 'INVALID', 'ERROR', 'ABORTED']);
      const r = await page.evaluate(() => {
        const res = window.OSCILLA.measure.result;
        return { state: window.OSCILLA.measure.state,
          codes: res ? (res.reasons || []).map((x) => x.code) : [] };
      });
      const capture = r.codes.length && r.codes.every((c) => ['DISCONTINUITY', 'FRAMES_MISSING',
        'DROPOUT'].includes(c));
      if (r.state !== 'INVALID' || !capture) return { state: r.state, defects };
      defects.push(r.codes.join(','));
    }
    return { state: 'INVALID', defects };
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
    const items = await page.evaluate(() => [...document.querySelectorAll('#osc-nav > li > a')]
      .map((a) => a.dataset.osc));
    const ok = items[0] === 'nav.playground' && items[1] === 'nav.measure'
      && items[2] === 'nav.experiments' && items.at(-1) === 'nav.about';
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
    // Start measurement (a retry, if any, uses the same primary action "Measure again" ->
    // setup check -> start, so it goes through the UI too).
    res.run1 = await H.run(page, async () => {
      if (await H.state(page) === 'INVALID') {
        await page.click('#osc-measure-primary');
        await H.waitState(page, ['READY', 'INVALID', 'ERROR'], 15000);
      }
      await page.click('#osc-measure-primary');
    });
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
    await page.waitForFunction(() => window.OSCILLA.app.meas.saved, null, { timeout: 10000 });
    const firstId = await page.evaluate(() => window.OSCILLA.app.meas.savedId);
    res.run2 = await H.run(page, async () => {
      if (await H.state(page) === 'COMPLETE') await page.click('[data-osc="measure.repeat"]');
      else await page.evaluate(() => { window.OSCILLA.app.measureRepeat(); });
    });
    await page.click('#osc-measure-save');
    await page.waitForFunction(() => window.OSCILLA.app.meas.saved, null, { timeout: 10000 });
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
    const ok = res.banner && res.afterPreflight.state === 'READY'
      && res.afterPreflight.primary === 'Start measurement'
      && d.state === 'COMPLETE' && d.history.includes('ANALYZING') && d.history.includes('ARMED')
      && d.bar.length === 5 && d.bar.includes('CAPTURE COMPLETE') && d.bar.includes('INPUT OK')
      && /^(GOOD|USABLE)$/.test(d.quality) && d.reasons > 0
      && /^Frequency response \(/.test(d.response) && /TEST CONTEXT/.test(d.shown)
      && d.primary === 'Save experiment' && d.chart
      && /^Impulse response: direct peak/.test(res.ir.text) && res.ir.chart
      && res.ir.tabs === 'true' && res.rtaTab === 'osc-m-tab-rta'
      && announced.every((t) => res.live.filter((x) => x === t).length === 1)
      && !res.live.some((t) => /%/.test(t))
      && H.zero(res.counts) && H.zero(res.counts2)
      && res.repeat.newId && res.repeat.repeatOf && res.repeat.testContext;
    return { ok, ...res };
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
      // A run that ends INVALID before reaching the stage (a real capture defect, e.g. Firefox's
      // realtime loopback occasionally delivers a DISCONTINUITY under load) is retried, and the
      // retry is reported; reaching the stage and aborting there is what is asserted.
      const missed = [];
      for (let attempt = 0; attempt < 3; attempt++) {
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
          missed.push({ end, reasons: await page.evaluate(() => {
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
          stopped: live.includes('Measurement stopped'), retries: missed });
        await page.evaluate(() => {
          const e = window.OSCILLA.measure.engine;
          if (e && ['ABORTED', 'COMPLETE', 'INVALID', 'ERROR'].includes(e.state)) e.reset();
        });
        break;
      }
      if (missed.length === 3) out.push({ stage, via, hit: false, end: 'never reached', missed });
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
    const ok = res.bad === false && res.good === true && /CALIBRATED/.test(res.freq)
      && !/UNCALIBRATED/.test(res.freq) && /gate-mic/.test(res.name) && !!res.refused
      && /CALIBRATED/.test(res.level) && !/UNCALIBRATED/.test(res.level) && res.dialogClosed
      && /UNCALIBRATED/.test(res.after);
    return { ok, ...res };
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
    await sleep(150);
    res.rows = await page.evaluate(() => window.OSCILLA.app.exps.rows.length - 0);
    // Open A, then compare A + B (equivalent) and A + C (not equivalent).
    await page.evaluate(() => window.OSCILLA.app.experimentsOpen('fixture-a'));
    await sleep(150);
    res.detail = await page.evaluate(() => ({
      compact: document.querySelector('[data-osc="exp.compact"]').textContent,
      chart: !!document.querySelector('#osc-exp-chart-detail .uplot'),
      testContext: window.OSCILLA.app.exps.detail.testContext,
    }));
    const compare = (ids) => page.evaluate(async (list) => {
      const v = await window.OSCILLA.app.experimentsCompare(list);
      await new Promise((r) => setTimeout(r, 100));
      return { compatible: v.compatible, delta: v.delta.ok, reason: v.delta.reason || null,
        text: document.querySelector('[data-osc="exp.delta"]').textContent,
        overlay: !!document.querySelector('#osc-exp-chart-overlay .uplot') };
    }, ids);
    res.ab = await compare(['fixture-a', 'fixture-b']);
    res.ac = await compare(['fixture-a', 'fixture-c']);
    // Rename (dialog), duplicate, export (download re-validates), CSV.
    await page.evaluate(() => window.OSCILLA.app.experimentsOpen('fixture-b'));
    await page.click('[data-osc="exp.rename"]');
    await page.fill('#osc-exp-rename-name', 'TEST CONTEXT · renamed B');
    await page.click('[data-osc="exp.renameSave"]');
    await sleep(150);
    res.renamed = await page.evaluate(() => window.OSCILLA.app.exps.rows
      .some((r) => r.name === 'TEST CONTEXT · renamed B'));
    res.dup = await page.evaluate(() => window.OSCILLA.app.experimentsDuplicate('fixture-b'));
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
    await sleep(200);
    res.inspect = await page.evaluate(() => ({
      mode: document.querySelector('#osc-app').dataset.mode,
      shown: document.querySelector('[data-osc="measure.shown"]').textContent,
      banner: document.querySelector('[data-osc="measure.testContext"]').offsetParent !== null,
    }));
    await H.workspace(page, 'experiments');
    // Explicit delete: the dialog asks first; Cancel keeps it, Delete removes it.
    await page.evaluate((id) => window.OSCILLA.app.experimentsOpen(id), res.dup);
    await page.click('[data-osc="exp.delete"]');
    await page.click('[data-osc="exp.deleteCancel"]');
    const kept = await page.evaluate((id) => window.OSCILLA.app.exps.rows.some((r) => r.id === id),
      res.dup);
    await page.click('[data-osc="exp.delete"]');
    await page.click('[data-osc="exp.deleteConfirm"]');
    await sleep(200);
    res.deleted = kept && await page.evaluate((id) => !window.OSCILLA.app.exps.rows
      .some((r) => r.id === id), res.dup);
    await page.evaluate(() => { window.OSCILLA.app.alerts = []; });
    void context;
    const ok = (res.store.kind === 'indexeddb' || (res.store.kind === 'memory'
      && /memory for this page view/.test(res.store.note) && res.store.shown))
      && res.importa === 'fixture-a' && res.importb === 'fixture-b' && res.importc === 'fixture-c'
      && res.again === null && res.rows === before + 3
      && /TEST CONTEXT · synthetic A/.test(res.detail.compact) && res.detail.chart
      && res.detail.testContext
      && res.ab.compatible && res.ab.delta && /^A − B over/.test(res.ab.text) && res.ab.overlay
      && !res.ac.compatible && !res.ac.delta && /not shown/.test(res.ac.text)
      && res.renamed && typeof res.dup === 'string'
      && /\.oscilla\.json$/.test(res.exportName) && res.exportValid
      && /\.csv$/.test(res.csv.name) && /^# OSCILLA/.test(res.csv.head) && !res.csv.spl
      && res.csv.unit && res.inspect.mode === 'measure'
      && /Saved experiment/.test(res.inspect.shown)
      && res.inspect.banner && res.deleted;
    return { ok, ...res };
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
async function runOne(browserName, origin, baseUrl, fixtures) {
  const browser = await playwright[browserName].launch(LAUNCH[browserName]);
  const context = await browser.newContext({ viewport: { width: 1536, height: 1024 },
    acceptDownloads: true });
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
        fn({ page, context, errors, browserName, origin }),
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
        for (const n of bad) console.log(`   x ${n}: ${JSON.stringify(res[n]).slice(0, 900)}`);
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
