#!/usr/bin/env node
// OSCILLA V2 final-QA regressions on the built dist/index.html (file://), in chromium, firefox
// and webkit. One fresh page per check. The pure halves are tests/unit/qa-regressions.test.mjs.
//
//   node tests/browser/qa-regressions.cjs [--dist dist/index.html]
//                                         [--browsers chromium,firefox,webkit] [--only a,b]
//
// Checks (QA finding in brackets):
//   phase-offset-correlation [5]  A = B = 440 Hz split stereo: the L/R correlation of a tap on
//                                 the engine output follows cos φ at 0/90/180°; the offline
//                                 render agrees and its B start adds no sample step
//   harmonics-additive [6]        the Harmonics tab table is the additive coefficients
//   scope-window-label [7]        100 ms at the running rate is shown and labelled as such
//   status-duration-sequence [8]  the status bar shows the sequence length while it plays
//   contrast [9]                  computed contrast of the fixed fills/texts >= 4.5:1, and
//                                 axe-core color-contrast (wcag2a/aa/21aa) when installed
//   analysis-header-no-overlap [12]  tabs vs Pause/Time/fullscreen at 1280-1536 px
//   tablet-nav-focus [13]         768-1279 px: the nav scrolls and rings the workspace panels
//   correlation-states [14]       mono "1.00 mono", stereo "… est." (visible), idle "—"
//   no-per-frame-dom-writes [15]  MutationObserver over 2 s while a tone plays
//   mic-through-engine [16]       mic nodes are the engine's (micNodeCount), 0 after stop;
//                                 an accurate message where the browser has no microphone
//   signal-path-stages [17]       filter, ADSR, additive and stereo router in the path
//   additive-gain-field [17]      the gain field shows the played (normalised) level; the
//                                 Nyquist hatching follows the fundamental
//   stereo-max-from-rate [17]     #osc-stereo-fa/fb max = floor(safe maximum of the context)
//   bio-sources-keyboard [17]     a keyboard-reachable sources list with the citations
//   safety-notice [V247]          first-run notice; focus dismiss → reopen → dismiss; stored
// Exit code 1 when any check fails.
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const playwright = require('playwright');

const argv = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};
const ROOT = path.resolve(__dirname, '..', '..');
const DIST = path.resolve(arg('dist', path.join(ROOT, 'dist', 'index.html')));
const BROWSERS = arg('browsers', process.env.OSC_BROWSERS || 'chromium,firefox,webkit').split(',');
const ONLY = arg('only', '') ? new Set(arg('only', '').split(',')) : null;

const LAUNCH = {
  chromium: { args: ['--autoplay-policy=no-user-gesture-required',
    '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] },
  firefox: { firefoxUserPrefs: { 'media.autoplay.default': 0, 'media.autoplay.blocking_policy': 0,
    'media.navigator.streams.fake': true, 'media.navigator.permission.disabled': true } },
  webkit: {},
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const WORKSPACES = ['playground', 'analyzer', 'sequencer', 'filter', 'synthesis', 'compare',
  'presets', 'learn'];

let axeSource = null;
try {
  axeSource = fs.readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');
} catch (e) { /* optional: npm i --no-save axe-core */ }

// ------------------------------------------------------------------------------ page helpers
async function open(browser, { width = 1536, height = 1024 } = {}) {
  const context = await browser.newContext({ viewport: { width, height }, acceptDownloads: true });
  const page = await context.newPage();
  page.setDefaultTimeout(10000);
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  await page.goto(pathToFileURL(DIST).href, { waitUntil: 'load' });
  await page.waitForSelector('html[data-ready="true"]', { timeout: 15000 });
  return { context, page, errors };
}

/** Start audio inside a gesture and wait for a running context. */
async function startAudio(page) {
  await page.mouse.click(2, 2);
  await page.evaluate(async () => {
    window.OSCILLA.app.ensureAudio();
    await window.OSCILLA.engine.resume();
  });
  await page.waitForFunction(() => window.OSCILLA.engine.state === 'running', null,
    { timeout: 8000 });
}

/** Set up a dual voice (A, B, stereo) and the phase offset, latch it, wait for it to sound. */
async function playDual(page, { fa = 440, fb = 440, stereo = true, phaseDeg = 0 } = {}) {
  await page.evaluate(async ({ fa, fb, stereo }) => {
    const a = window.OSCILLA.app;
    a.setContinuous(true);
    a.source = 'dual';
    a.setDualFreq('a', String(fa));
    a.setDualFreq('b', String(fb));
    a.setStereo(stereo);
  }, { fa, fb, stereo });
  await sleep(60); // Alpine effects carry A/B and the route to the Phase & Stereo panel
  await page.evaluate(async (deg) => {
    const O = window.OSCILLA;
    O.labs.phase.set({ phaseDeg: deg });
    if (!O.app.playing) O.app.toggleLatch();
  }, phaseDeg);
  await sleep(450);
}

/** Pearson L/R correlation and RMS of a 2-channel tap on the engine's output analyser. */
function tapCorrelation(page) {
  return page.evaluate(async () => {
    const e = window.OSCILLA.engine;
    const ctx = e.ctx;
    // Test probe only (not app code): a splitter and two analysers on the output.
    const sp = ctx.createChannelSplitter(2);
    const L = ctx.createAnalyser();
    const R = ctx.createAnalyser();
    L.fftSize = 8192;
    R.fftSize = 8192;
    e.analyser.connect(sp);
    sp.connect(L, 0);
    sp.connect(R, 1);
    const l = new Float32Array(8192);
    const r = new Float32Array(8192);
    const wait = (ms) => new Promise((res) => setTimeout(res, ms));
    const rmsOf = (a) => Math.sqrt(a.reduce((q, v) => q + v * v, 0) / a.length);
    // Deadline-based: on a slow runner the first voice after the context starts can take a
    // while to reach the output. Poll until both channels carry signal, then let the 8192-
    // sample window fill with steady signal (about 170 ms at 48 kHz) before measuring.
    const deadline = performance.now() + 3000;
    for (;;) {
      await wait(100);
      L.getFloatTimeDomainData(l);
      R.getFloatTimeDomainData(r);
      if ((rmsOf(l) > 0.005 && rmsOf(r) > 0.005) || performance.now() > deadline) break;
    }
    await wait(250);
    L.getFloatTimeDomainData(l);
    R.getFloatTimeDomainData(r);
    e.analyser.disconnect(sp);
    sp.disconnect();
    let ml = 0;
    let mr = 0;
    for (let i = 0; i < l.length; i++) { ml += l[i]; mr += r[i]; }
    ml /= l.length;
    mr /= l.length;
    let sl = 0;
    let sr = 0;
    let slr = 0;
    for (let i = 0; i < l.length; i++) {
      const x = l[i] - ml;
      const y = r[i] - mr;
      sl += x * x;
      sr += y * y;
      slr += x * y;
    }
    return { corr: sl > 0 && sr > 0 ? slr / Math.sqrt(sl * sr) : null,
      rms: Math.sqrt(sl / l.length) };
  });
}

async function stopAll(page) {
  await page.evaluate(() => {
    const O = window.OSCILLA;
    O.app.stopNow();
    if (O.labs.sequencer && O.labs.sequencer.editor.playing) O.labs.sequencer.editor.stop();
  });
  for (let i = 0; i < 40; i++) {
    if (await page.evaluate(() => window.OSCILLA.engine.activeNodeCount) === 0) return 0;
    await sleep(50);
  }
  return page.evaluate(() => window.OSCILLA.engine.activeNodeCount);
}

function contrastOf(page, selector, pseudoBg) {
  return page.evaluate(({ selector, pseudoBg }) => {
    const el = document.querySelector(selector);
    if (!el) return null;
    const rgb = (s) => {
      const m = /rgba?\(([^)]+)\)/.exec(s);
      if (!m) return null;
      const p = m[1].split(/[\s,/]+/).filter(Boolean).map(Number);
      return { c: p.slice(0, 3), a: p.length > 3 ? p[3] : 1 };
    };
    const lum = ([r, g, b]) => {
      const f = (v) => { const x = v / 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; };
      return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
    };
    // background: the nearest ancestor with an opaque background colour
    let bg = null;
    for (let n = pseudoBg ? document.querySelector(pseudoBg) : el; n; n = n.parentElement) {
      const c = rgb(getComputedStyle(n).backgroundColor);
      if (c && c.a > 0.99) { bg = c.c; break; }
    }
    const cs = getComputedStyle(el);
    const fg = rgb(cs.color);
    const op = Number(cs.opacity);
    let col = fg.c;
    if (op < 1 && bg) col = col.map((v, i) => v * op + bg[i] * (1 - op));
    const a = lum(col);
    const b = lum(bg || [0, 0, 0]);
    return Math.round(((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)) * 100) / 100;
  }, { selector, pseudoBg });
}

// ------------------------------------------------------------------------------ checks
function defineChecks() {
  const checks = [];
  const def = (name, fn, opts = {}) => checks.push({ name, fn, ...opts });

  def('phase-offset-correlation', async ({ browser }) => {
    const { page, context, errors } = await open(browser);
    await startAudio(page);
    const rows = [];
    let voiceIds = [];
    for (const deg of [0, 90, 180]) {
      await playDual(page, { fa: 440, fb: 440, stereo: true, phaseDeg: deg });
      const t = await tapCorrelation(page);
      const info = await page.evaluate(() => ({ id: window.OSCILLA.engine.voice.id,
        phase: window.OSCILLA.engine.voice.phaseDeg,
        ui: `${document.querySelector('#osc-corr-value').textContent} ${
          document.querySelector('#osc-corr-basis').textContent}` }));
      voiceIds.push(info.id);
      rows.push({ deg, corr: t.corr, want: Math.cos((deg * Math.PI) / 180), rms: t.rms,
        phase: info.phase, ui: info.ui });
    }
    const live = rows.every((r) => r.corr != null && Math.abs(r.corr - r.want) < 0.05
      && r.phase === r.deg && r.rms > 0.005);
    const restarted = new Set(voiceIds).size === voiceIds.length; // a change restarts B's start
    const nodesAfter = await stopAll(page);
    // Offline render (Export audio): L/R correlation and the largest one-sample step. B starts
    // late by 7.5 ms at 100 Hz / 90°, inside the 10 ms attack: a start at a non-zero value would
    // step by up to the envelope level; a click-free start stays within the sine slope bound.
    await page.evaluate(() => {
      const a = window.OSCILLA.app;
      a.setStereo(true);
      a.setDualFreq('a', '100');
      a.setDualFreq('b', '100');
    });
    await sleep(60);
    const off = await page.evaluate(async () => {
      const O = window.OSCILLA;
      O.labs.phase.set({ phaseDeg: 90 });
      const r = await O.app.exportAudio('pattern');
      if (!r) return null;
      const l = r.buffer.getChannelData(0);
      const rr = r.buffer.getChannelData(1);
      const sr = r.buffer.sampleRate;
      let peak = 0;
      let step = 0;
      for (let i = 0; i < l.length; i++) {
        peak = Math.max(peak, Math.abs(l[i]), Math.abs(rr[i]));
        if (i) step = Math.max(step, Math.abs(l[i] - l[i - 1]), Math.abs(rr[i] - rr[i - 1]));
      }
      // correlation over the steady middle half
      const a0 = Math.floor(l.length / 4);
      const a1 = Math.floor((3 * l.length) / 4);
      let sl = 0;
      let s2 = 0;
      let slr = 0;
      for (let i = a0; i < a1; i++) { sl += l[i] * l[i]; s2 += rr[i] * rr[i]; slr += l[i] * rr[i]; }
      return { corr: slr / Math.sqrt(sl * s2), peak, step,
        bound: (2 * Math.PI * 100 / sr) * peak, seconds: r.buffer.duration };
    });
    const offlineOk = !!off && Math.abs(off.corr) < 0.05 && off.step <= off.bound * 1.5;
    await context.close();
    return { ok: live && restarted && nodesAfter === 0 && offlineOk && errors.length === 0,
      rows, restarted, nodesAfter, offline: off, errors: errors.slice(0, 3) };
  });

  def('correlation-states', async ({ browser }) => {
    const { page, context } = await open(browser);
    const read = () => page.evaluate(() => {
      const v = document.querySelector('#osc-corr-value');
      const b = document.querySelector('#osc-corr-basis');
      const m = document.querySelector('#osc-corr-meter');
      return { text: v.textContent, basis: b.textContent, basisVisible: b.offsetWidth > 0,
        title: v.title, valuetext: m.getAttribute('aria-valuetext'),
        state: window.OSCILLA.labs.phase.correlationState };
    });
    await sleep(150);
    const idle = await read();
    await startAudio(page);
    await playDual(page, { fa: 440, fb: 442, stereo: false, phaseDeg: 0 });
    const mono = await read();
    await stopAll(page);
    await playDual(page, { fa: 440, fb: 442, stereo: true, phaseDeg: 0 });
    await sleep(400);
    const stereo = await read();
    await stopAll(page);
    await context.close();
    const ok = idle.text === '—' && /nothing playing/.test(idle.valuetext)
      && mono.state === 'mono' && mono.text === '1.00' && mono.basis === 'mono'
      && mono.basisVisible && !/nothing playing/.test(mono.valuetext)
      && stereo.state === 'live' && stereo.basis === 'est.' && stereo.basisVisible
      && /^-?\d\.\d\d$/.test(stereo.text);
    return { ok, idle, mono, stereo };
  });

  def('harmonics-additive', async ({ browser }) => {
    const { page, context } = await open(browser);
    await page.click('#osc-atab-harmonics');
    const before = await page.evaluate(() => window.OSCILLA.viz.state.harm.source || 'oscillator');
    const r = await page.evaluate(async () => {
      const O = window.OSCILLA;
      O.app.setFrequency(1000);
      O.labs.additive.update({ enabled: true });
      await new Promise((res) => setTimeout(res, 50));
      const h = O.viz.state.harm;
      const bars = O.labs.additive.coefficients().filter((b) => b.gain > 0);
      const maxDiff = Math.max(...h.list.map((x) => {
        const b = bars.find((y) => y.n === x.n);
        return b ? Math.abs(b.gainDb - x.db) : Infinity;
      }));
      return { source: h.source, n: h.list.length, bars: bars.length, maxDiff,
        label: document.querySelector('#osc-chart-waveform').getAttribute('aria-label') };
    });
    const off = await page.evaluate(async () => {
      window.OSCILLA.labs.additive.update({ enabled: false });
      await new Promise((res) => setTimeout(res, 50));
      return window.OSCILLA.viz.state.harm.source || 'oscillator';
    });
    await context.close();
    const ok = before === 'oscillator' && r.source === 'additive' && r.n === r.bars
      && r.maxDiff < 1e-9 && /Additive synthesis spectrum/.test(r.label) && off === 'oscillator';
    return { ok, before, ...r, off };
  });

  def('scope-window-label', async ({ browser }) => {
    const { page, context } = await open(browser);
    await startAudio(page);
    const r = await page.evaluate(async () => {
      const a = window.OSCILLA.app;
      a.setContinuous(true);
      a.setFrequency(440);
      a.timeWindowMs = 100;
      a.toggleLatch();
      await new Promise((res) => setTimeout(res, 300));
      const sr = window.OSCILLA.engine.sampleRate;
      const label = document.querySelector('#osc-chart-waveform').getAttribute('aria-label');
      return { sr, label, shown: a.scopeShownMs,
        buffer: window.OSCILLA.engine.analyser.fftSize };
    });
    await stopAll(page);
    await context.close();
    // the analyser buffer (8192) holds 100 ms up to ~80 kHz; above that the label says so
    const fits = r.sr * 0.1 + Math.ceil(r.sr / 440) + 1 <= r.buffer;
    const ok = fits
      ? Math.abs(r.shown - 100) < 1e-9 && /over a 100 ms window/.test(r.label)
      : r.shown < 100 && /buffer limit/.test(r.label);
    return { ok, ...r, fits };
  });

  def('status-duration-sequence', async ({ browser }) => {
    const { page, context } = await open(browser);
    await startAudio(page);
    const r = await page.evaluate(async () => {
      const O = window.OSCILLA;
      const ed = O.labs.sequencer.editor;
      const idle = O.app.statusDurationText;
      ed.play();
      await new Promise((res) => setTimeout(res, 400));
      const ms = ed.model.blocks.reduce((t, b) => t + b.durationMs, 0);
      const out = { idle, playing: O.app.seqPlaying, text: O.app.statusDurationText, ms,
        loop: ed.model.loop,
        dom: [...document.querySelectorAll('.osc-statusbar *')].map((e) => e.textContent)
          .some((t) => t.trim() === O.app.statusDurationText) };
      ed.stop();
      return out;
    });
    await stopAll(page);
    await context.close();
    const secs = (r.ms / 1000).toFixed(2).replace(/\.?0+$/, '');
    const ok = r.playing && r.text !== r.idle && r.text.includes(secs) && r.dom
      && (!r.loop || /loop/.test(r.text));
    return { ok, ...r, expectSeconds: secs };
  });

  def('no-per-frame-dom-writes', async ({ browser }) => {
    const { page, context } = await open(browser);
    await startAudio(page);
    await page.evaluate(() => {
      const a = window.OSCILLA.app;
      a.setContinuous(true);
      a.setFrequency(1000);
      a.toggleLatch();
    });
    await sleep(800);
    const r = await page.evaluate(() => new Promise((resolve) => {
      const counts = {};
      let total = 0;
      const mo = new MutationObserver((recs) => {
        for (const rec of recs) {
          let el = rec.target.nodeType === 1 ? rec.target : rec.target.parentElement;
          let p = el;
          while (p && !p.id) p = p.parentElement;
          const key = `${p ? p.id : '?'}>${el.tagName.toLowerCase()}.${
            String(el.getAttribute('class') || '').split(' ')[0]} ${rec.type}${
            rec.attributeName ? `:${rec.attributeName}` : ''}`;
          counts[key] = (counts[key] || 0) + 1;
          total++;
        }
      });
      mo.observe(document.documentElement, { subtree: true, attributes: true, childList: true,
        characterData: true });
      setTimeout(() => {
        mo.disconnect();
        resolve({ total, counts, playing: window.OSCILLA.app.playing });
      }, 2000);
    }));
    await stopAll(page);
    await context.close();
    const watched = Object.entries(r.counts).filter(([k]) =>
      /^(osc-chart-spectrum|osc-chart-mic|osc-seq-timeline)>/.test(k) && /hidden|childList/.test(k))
      .reduce((s, [, n]) => s + n, 0);
    // A steady tone: nothing changes, so (almost) nothing is written. The spectrum chip may
    // update its level text when it really changes; that is bounded well below the frame rate.
    const ok = r.playing && watched <= 4 && r.total <= 40;
    return { ok, total: r.total, watched, top: Object.entries(r.counts)
      .sort((a, b) => b[1] - a[1]).slice(0, 6) };
  });

  def('mic-through-engine', async ({ browser, browserName }) => {
    const { page, context } = await open(browser, { width: 1536, height: 1024 });
    await startAudio(page);
    await page.evaluate(() => window.OSCILLA.app.setWorkspace('analyzer'));
    await page.click('#osc-mic-toggle');
    let st = null;
    for (let i = 0; i < 60; i++) {
      st = await page.evaluate(() => {
        const O = window.OSCILLA;
        const m = O.labs.mic;
        return { active: m.active, error: m.error, micNodes: O.engine.micNodeCount,
          same: !!m.analyser && O.engine.micAttachment && m.analyser
            === O.engine.micAttachment.analyser,
          text: document.querySelector('#osc-mic-detected').textContent };
      });
      if (st.active || st.error) break;
      await sleep(100);
    }
    let after = null;
    if (st.active) {
      await page.click('#osc-mic-toggle');
      await sleep(100);
      after = await page.evaluate(() => ({ active: window.OSCILLA.labs.mic.active,
        micNodes: window.OSCILLA.engine.micNodeCount,
        voiceNodes: window.OSCILLA.engine.activeNodeCount }));
    }
    await context.close();
    if (st.active) {
      const ok = st.micNodes === 2 && st.same && after && !after.active && after.micNodes === 0
        && after.voiceNodes === 0;
      return { ok, st, after };
    }
    // No microphone in this browser (WebKit has no fake device): the message must be accurate.
    const ok = browserName === 'webkit' && /^Microphone unavailable here \(/.test(st.error)
      && !/file:\/\/ or permission/.test(st.error) && st.micNodes === 0;
    return { ok, st };
  });

  def('signal-path-stages', async ({ browser }) => {
    const { page, context } = await open(browser);
    const r = await page.evaluate(async () => {
      const O = window.OSCILLA;
      const wait = () => new Promise((res) => setTimeout(res, 40));
      const titles = () => O.viz.state.pathNodes.map((n) => n.title);
      const base = titles();
      O.labs.filter.update({ enabled: true });
      O.labs.envelope.update({ enabled: true });
      await wait();
      const fe = titles();
      O.labs.additive.update({ enabled: true });
      await wait();
      const add = titles();
      O.labs.additive.update({ enabled: false });
      O.labs.filter.update({ enabled: false });
      O.labs.envelope.update({ enabled: false });
      O.app.source = 'dual';
      O.app.setStereo(true);
      await wait();
      const dual = titles();
      return { base, fe, add, dual };
    });
    await context.close();
    const ok = !r.base.includes('FILTER') && r.fe.includes('FILTER')
      && r.fe.includes('ADSR ENVELOPE') && r.add[0] === 'ADDITIVE OSC'
      && r.dual.includes('STEREO ROUTER');
    return { ok, ...r };
  });

  def('additive-gain-field', async ({ browser }) => {
    const { page, context } = await open(browser);
    // Before any context the Nyquist frequency is unknown: nothing may be hatched yet.
    const pre = await page.evaluate(async () => {
      const O = window.OSCILLA;
      O.app.setFrequency(5000);
      await new Promise((res) => setTimeout(res, 40));
      return O.labs.additive.chart.getBars().filter((b) => b.audible === false).length;
    });
    await startAudio(page); // the context's sample rate arrives: the hatching must follow
    const r = await page.evaluate(async () => {
      const O = window.OSCILLA;
      const lab = O.labs.additive;
      const wait = () => new Promise((res) => setTimeout(res, 40));
      const ctxRedraw = lab.chart.getBars().filter((b) => b.audible === false).length;
      lab.update({ enabled: true });
      lab.setPartials(lab.partials); // custom table
      lab.select(3);
      const field = () => document.querySelector('#osc-add-gain-value').value;
      const bar = () => lab.coefficients()[2].gainDb;
      const f0 = field();
      const b0 = bar();
      // type a played level: the bar must come out at that level
      const input = document.querySelector('#osc-add-gain-value');
      input.value = '-20';
      input.dispatchEvent(new Event('change'));
      await wait();
      const f1 = field();
      const b1 = bar();
      // Nyquist hatching follows the fundamental (no lab event involved)
      O.app.setFrequency(200);
      await wait();
      const a0 = lab.chart.getBars().filter((b) => b.audible === false).length;
      O.app.setFrequency(5000);
      await wait();
      const a1 = lab.chart.getBars().filter((b) => b.audible === false).length;
      return { f0, b0, f1, b1, a0, a1, sr: O.engine.sampleRate || 48000, ctxRedraw };
    });
    await context.close();
    const num = (s) => parseFloat(String(s));
    const nyqN = Math.floor((r.sr / 2) / 5000); // highest audible harmonic at 5 kHz
    const ok = Math.abs(num(r.f0) - r.b0) < 0.06 && Math.abs(r.b1 - -20) < 0.2
      && Math.abs(num(r.f1) - r.b1) < 0.06 && r.a0 === 0 && r.a1 === 10 - nyqN
      && pre === 0 && r.ctxRedraw === 10 - nyqN;
    return { ok, pre, ...r, expectInaudible: 10 - nyqN };
  });

  def('stereo-max-from-rate', async ({ browser }) => {
    const { page, context } = await open(browser);
    await startAudio(page);
    const r = await page.evaluate(() => ({
      sr: window.OSCILLA.engine.sampleRate,
      fa: document.querySelector('#osc-stereo-fa').max,
      fb: document.querySelector('#osc-stereo-fb').max,
    }));
    await context.close();
    const want = String(Math.floor((r.sr / 2) * 0.95));
    return { ok: r.fa === want && r.fb === want, ...r, want };
  });

  def('bio-sources-keyboard', async ({ browser }) => {
    const { page, context } = await open(browser);
    await page.evaluate(() => window.OSCILLA.app.setWorkspace('compare'));
    await sleep(150);
    await page.focus('.osc-bio-sources-toggle');
    await page.keyboard.press('Enter');
    await sleep(80);
    const r = await page.evaluate(() => {
      const d = document.querySelector('#osc-bio-sources');
      const items = [...document.querySelectorAll('#osc-bio-source-list li')];
      const list = document.querySelector('#osc-bio-source-list');
      const box = list.getBoundingClientRect();
      return { open: d.open, n: items.length, first: items[0] && items[0].textContent,
        links: list.querySelectorAll('a[href^="http"]').length,
        visible: box.width > 100 && box.height > 20,
        focused: document.activeElement === document.querySelector('.osc-bio-sources-toggle') };
    });
    await page.click('#osc-btab-calls');
    await sleep(80);
    const calls = await page.evaluate(() => [...document.querySelectorAll(
      '#osc-bio-source-list li')].map((li) => li.textContent.slice(0, 40)));
    await context.close();
    const ok = r.open && r.focused && r.visible && r.n >= 5 && /Human: 31 Hz – 17\.6 kHz/.test(r.first)
      && /Heffner/.test(r.first) && r.links >= 1 && calls.length >= 3
      && !calls[0].startsWith('Human');
    return { ok, ...r, calls: calls.slice(0, 2) };
  });

  def('analysis-header-no-overlap', async ({ browser }) => {
    const rows = [];
    let bad = 0;
    for (const w of [1280, 1366, 1440, 1535, 1536]) {
      const { page, context } = await open(browser, { width: w, height: 1000 });
      for (const ws of ['playground', 'analyzer', 'synthesis']) {
        await page.evaluate((m) => window.OSCILLA.app.setWorkspace(m), ws);
        await sleep(120);
        const r = await page.evaluate(() => {
          const tl = document.querySelector('#osc-analysis-tabs').getBoundingClientRect();
          const tabs = [...document.querySelectorAll('#osc-analysis-tabs .osc-tab')]
            .map((t) => t.getBoundingClientRect());
          const tools = ['#osc-viz-pause', '.osc-time-select', '#osc-analysis-fullscreen']
            .map((s) => document.querySelector(s).getBoundingClientRect());
          const hit = (a, b) => a.left < b.right - 0.5 && b.left < a.right - 0.5
            && a.top < b.bottom - 0.5 && b.top < a.bottom - 0.5;
          let n = 0;
          for (const t of tabs) {
            const vis = { left: Math.max(t.left, tl.left), right: Math.min(t.right, tl.right),
              top: t.top, bottom: t.bottom };
            for (const o of tools) if (hit(vis, o)) n++;
          }
          // every tab is fully visible (no scroll needed) at desktop widths
          const clipped = tabs.filter((t) => t.right > tl.right + 0.5).length;
          return { n, clipped };
        });
        if (r.n || r.clipped) bad++;
        rows.push(`${w}/${ws}: overlap ${r.n} clipped ${r.clipped}`);
      }
      await context.close();
    }
    return { ok: bad === 0, rows };
  });

  def('tablet-nav-focus', async ({ browser }) => {
    const { page, context } = await open(browser, { width: 1024, height: 800 });
    const out = {};
    for (const [ws, panel] of [['filter', '#osc-panel-filter'], ['sequencer',
      '#osc-panel-sequencer'], ['analyzer', '#osc-panel-mic']]) {
      await page.click(`[data-osc="nav.${ws}"]`);
      await sleep(700); // smooth scroll
      out[ws] = await page.evaluate((sel) => {
        const p = document.querySelector(sel);
        const main = document.querySelector('.osc-main').getBoundingClientRect();
        const r = p.getBoundingClientRect();
        const cs = getComputedStyle(p);
        return { focused: p.classList.contains('is-focused'), top: Math.round(r.top - main.top),
          ring: cs.boxShadow !== 'none' && cs.boxShadow.includes('0px 0px 0px 1px'),
          current: document.querySelector('[aria-current="page"]').dataset.osc };
      }, panel);
    }
    await page.click('[data-osc="nav.playground"]');
    await sleep(700);
    const back = await page.evaluate(() => ({
      scrollTop: document.querySelector('.osc-main').scrollTop,
      focused: document.querySelectorAll('.osc-panel.is-focused').length }));
    await context.close();
    const ok = Object.entries(out).every(([ws, r]) => r.focused && r.ring && r.top >= 0
      && r.top <= 24 && r.current === `nav.${ws}`) && back.scrollTop === 0 && back.focused === 0;
    return { ok, out, back };
  });

  def('safety-notice', async ({ browser }) => {
    // V247: first-run notice, dismiss → reopen → dismiss focus handoff, stored collapsed state.
    const { page, context } = await open(browser);
    const state = () => page.evaluate(() => {
      const n = document.querySelector('#osc-safety');
      const r = n.getBoundingClientRect();
      const a = document.activeElement;
      return { shown: getComputedStyle(n).display !== 'none', h: Math.round(r.height),
        active: a === document.body ? 'BODY' : a.dataset.osc || a.id,
        stored: sessionStorage.getItem('oscilla.safetyNoticeCollapsed'),
        text: n.textContent.replace(/\s+/g, ' ').trim() };
    });
    const first = await state();
    await page.focus('[data-osc="safety.dismiss"]');
    await page.keyboard.press('Enter');
    await sleep(120);
    const dismissed = await state();
    await page.keyboard.press('Enter'); // focus is on the reopen control
    await sleep(120);
    const reopened = await state();
    await page.keyboard.press('Enter'); // focus is on dismiss again
    await sleep(120);
    await page.reload({ waitUntil: 'load' });
    await page.waitForSelector('html[data-ready="true"]');
    await sleep(150);
    const reloaded = await state();
    await context.close();
    // phone: short, HOLD stays in the first viewport, focus never drops to <body>
    const ph = await open(browser, { width: 375, height: 667 });
    const phone = await ph.page.evaluate(() => {
      const n = document.querySelector('#osc-safety').getBoundingClientRect();
      const hold = document.querySelector('#osc-hold-play').getBoundingClientRect();
      const main = document.querySelector('.osc-main').getBoundingClientRect();
      return { h: Math.round(n.height), holdBottom: Math.round(hold.bottom),
        mainBottom: Math.round(main.bottom) };
    });
    await ph.page.focus('[data-osc="safety.dismiss"]');
    await ph.page.keyboard.press('Enter');
    await sleep(120);
    phone.active = await ph.page.evaluate(() => (document.activeElement === document.body
      ? 'BODY' : document.activeElement.dataset.osc || document.activeElement.id));
    await ph.context.close();
    const ok = first.shown && /harmful at excessive output levels/.test(first.text)
      && /does not guarantee that your hardware reproduces/.test(first.text) && first.h <= 50
      && !dismissed.shown && dismissed.active === 'safety.reopen' && dismissed.stored === '1'
      && reopened.shown && reopened.active === 'safety.dismiss'
      && !reloaded.shown && reloaded.stored === '1'
      && phone.h <= 44 && phone.holdBottom <= phone.mainBottom && phone.active !== 'BODY';
    return { ok, first: { ...first, text: first.text.slice(0, 60) }, dismissed, reopened,
      reloaded: { shown: reloaded.shown, stored: reloaded.stored }, phone };
  });

  def('contrast', async ({ browser }) => {
    const res = {};
    const add = (k, v) => { res[k] = v; };
    for (const theme of ['dark', 'light']) {
      const { page, context } = await open(browser);
      await page.evaluate((t) => { if (window.OSCILLA.app.theme !== t) window.OSCILLA.app.toggleTheme(); }, theme);
      await sleep(600); // colour transitions settle
      add(`${theme} export`, await contrastOf(page, '#osc-export > span'));
      add(`${theme} oscillator segment`, await contrastOf(page, '#osc-source-osc'));
      add(`${theme} log segment`, await contrastOf(page, '#osc-spec-log'));
      add(`${theme} hold`, await contrastOf(page, 'span[x-text="holdLabel"]'));
      add(`${theme} mic toggle`, await contrastOf(page, '#osc-mic-toggle'));
      add(`${theme} chirp detail`, await contrastOf(page, '.osc-block--chirp .osc-block-detail'));
      add(`${theme} bio sources`, await contrastOf(page, '.osc-bio-sources-toggle'));
      add(`${theme} safety notice`, await contrastOf(page, '.osc-safety-text'));
      add(`${theme} safety reopen`, await contrastOf(page, '[data-osc="safety.reopen"]'));
      add(`${theme} correlation value`, await contrastOf(page, '#osc-corr-value'));
      await page.evaluate(() => window.OSCILLA.app.setWorkspace('learn'));
      await sleep(150);
      add(`${theme} learn example`, await contrastOf(page, '.is-current .osc-learn-example'));
      add(`${theme} learn demo`, await contrastOf(page, '.is-current [data-osc="learn.demo"]'));
      await context.close();
    }
    const low = Object.entries(res).filter(([, v]) => v == null || v < 4.5);
    // axe-core, when installed (npm i --no-save axe-core): color-contrast across workspaces.
    let axe = 'skipped (axe-core not installed)';
    const axeBad = [];
    if (axeSource) {
      let runs = 0;
      for (const theme of ['dark', 'light']) {
        for (const w of [375, 768, 1280, 1536]) {
          const { page, context } = await open(browser, { width: w, height: 1024 });
          await page.evaluate((t) => { if (window.OSCILLA.app.theme !== t) window.OSCILLA.app.toggleTheme(); }, theme);
          await page.addScriptTag({ content: axeSource });
          for (const ws of WORKSPACES) {
            await page.evaluate((m) => window.OSCILLA.app.setWorkspace(m), ws);
            await sleep(200);
            const v = await page.evaluate(async () => {
              const r = await window.axe.run(document, { runOnly: ['wcag2a', 'wcag2aa', 'wcag21aa'] });
              const cc = r.violations.find((x) => x.id === 'color-contrast');
              return cc ? cc.nodes.map((n) => `${n.target.join(' ')} ${
                n.any[0] && n.any[0].data ? n.any[0].data.contrastRatio : ''}`) : [];
            });
            runs++;
            if (v.length) axeBad.push(`${theme}/${w}/${ws}: ${v.slice(0, 3).join(' | ')}`);
          }
          await context.close();
        }
      }
      axe = `${runs} runs, ${axeBad.length} with color-contrast`;
    }
    return { ok: low.length === 0 && axeBad.length === 0, res, low, axe, axeBad: axeBad.slice(0, 5) };
  }, { browsers: ['chromium'] });

  return checks;
}

// ------------------------------------------------------------------------------ runner
(async () => {
  if (!fs.existsSync(DIST)) {
    console.error(`missing ${DIST}: run npm run build`);
    process.exit(2);
  }
  let failed = 0;
  for (const name of BROWSERS) {
    const browser = await playwright[name].launch(LAUNCH[name]);
    const t0 = Date.now();
    let n = 0;
    const bad = [];
    for (const c of defineChecks()) {
      if (ONLY && !ONLY.has(c.name)) continue;
      if (c.browsers && !c.browsers.includes(name)) continue;
      n++;
      let r;
      try {
        r = await Promise.race([c.fn({ browser, browserName: name }),
          sleep(240000).then(() => ({ ok: false, detail: 'timeout 240 s' }))]);
      } catch (e) {
        r = { ok: false, detail: String(e.message || e).split('\n')[0] };
      }
      const line = JSON.stringify(r);
      console.log(`  ${r.ok ? 'PASS' : 'FAIL'}  ${name} ${c.name}  ${line.slice(0, 700)}`);
      if (!r.ok) bad.push(c.name);
    }
    await browser.close();
    failed += bad.length;
    console.log(`${bad.length ? 'FAIL' : 'PASS'} ${name}: ${n - bad.length}/${n} checks `
      + `(${((Date.now() - t0) / 1000).toFixed(1)} s)`);
  }
  process.exit(failed ? 1 : 0);
})();
