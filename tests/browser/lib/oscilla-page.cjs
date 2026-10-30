// Shared page helpers of the journey and control-census suites (C021, PACK 03 "One Instrument,
// One Coherent State"): open dist with a running AudioContext, reach a workspace through the
// navigation, read the state a check judges in one evaluate, read the output level of one
// frequency, and discover every control the page shows.
//
//   const op = require('./lib/oscilla-page.cjs');
//   const { context, page, errors } = await op.openApp(browser, { dist, hash, query });
//   await op.navTo(page, 'filter');
//   const s = await page.evaluate(op.snapshot);
//   const db = await op.steadyDb(page, 1000, { what: 'the held 1 kHz tone' });
//
// Every wait is a condition poll through wait.cjs with a wall-clock deadline that names the
// check (rule project.bounded-test-timing). The output level is read with a Goertzel filter on
// the time-domain block of the engine's post-chain analyser, at the context's own sample rate,
// so neither the analyser's smoothing nor the host's frame rate decides a result.
'use strict';

const { pathToFileURL } = require('node:url');
const { until } = require('./wait.cjs');

const OPEN_MS = 30000;
const NAV_MS = 8000;

/** Launch options per engine: autoplay allowed, a fake microphone where the engine has one. */
const LAUNCH = Object.freeze({
  chromium: { args: ['--autoplay-policy=no-user-gesture-required',
    '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] },
  firefox: { firefoxUserPrefs: { 'media.autoplay.default': 0,
    'media.autoplay.blocking_policy': 0, 'media.navigator.streams.fake': true,
    'media.navigator.permission.disabled': true } },
  webkit: {},
});

/** The workspaces of the shell, in navigation order (ui/app.js MODES). */
const WORKSPACES = Object.freeze(['playground', 'measure', 'experiments', 'analyzer', 'filter',
  'compare', 'synthesis', 'sequencer', 'presets', 'learn', 'studio', 'about']);

/**
 * A fresh context and page on dist, ready, with the safety notice collapsed and a running
 * AudioContext (created by a real pointer gesture). `query` and `hash` are appended to the
 * file URL; `audio: false` leaves the context unstarted.
 */
async function openApp(browser, { dist, query = '', hash = '', audio = true, init = null,
  keepAlerts = false, keepSafety = false,
  viewport = { width: 1536, height: 1024 }, timeout = 10000 } = {}) {
  const context = await browser.newContext({ viewport, acceptDownloads: true });
  for (const fn of [].concat(init || [])) await context.addInitScript(fn);
  const page = await context.newPage();
  page.setDefaultTimeout(timeout);
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('dialog', (d) => { d.dismiss().catch(() => {}); });
  await page.goto(pathToFileURL(dist).href + query + hash, { waitUntil: 'load' });
  await page.waitForSelector('html[data-ready="true"]', { timeout: OPEN_MS });
  await page.evaluate(([keep, safety]) => {
    const a = window.OSCILLA.app;
    if (!safety && !a.safetyCollapsed && typeof a.collapseSafety === 'function') a.collapseSafety();
    if (!keep) a.alerts = [];
  }, [keepAlerts, keepSafety]);
  if (audio) await startAudio(page);
  return { context, page, errors };
}

/** A real pointer gesture on an inert spot, then a running context. */
async function startAudio(page) {
  await page.mouse.click(2, 2);
  await page.evaluate(async () => {
    window.OSCILLA.app.ensureAudio();
    await window.OSCILLA.engine.resume();
  });
  await until(() => page.evaluate(() => window.OSCILLA.engine.state === 'running'),
    { ms: OPEN_MS, what: 'the AudioContext runs after the first gesture' });
}

/** Reach a workspace through the navigation; a grouped one opens its group first. */
async function navTo(page, ws) {
  const item = `[data-osc="nav.${ws}"]`;
  const group = await page.evaluate((s) => {
    const el = document.querySelector(s);
    const g = el && el.closest('[data-osc-nav-group]');
    return g && el.offsetParent === null ? g.dataset.oscNavGroup : null;
  }, item);
  if (group) await page.click(`[data-osc="nav-group.${group}"]`);
  await page.click(item);
  await until(() => page.evaluate((w) => window.OSCILLA.app.workspace === w, ws),
    { ms: NAV_MS, what: `workspace ${ws} shown after its navigation item` });
}

// ------------------------------------------------------------------------------ page side
/**
 * Everything a check may judge, read in one evaluate: the instrument, the sounding voice and
 * its live nodes, the lab stages, the sequencer model, the Studio store, MEASURE, the readouts
 * the user sees, and open dialogs. Plain values only. Runs in the page.
 */
function snapshot() {
  const O = window.OSCILLA;
  const a = O.app;
  const e = O.engine;
  const v = e.voice && !e.voice.ended ? e.voice : null;
  const txt = (s) => {
    const el = document.querySelector(s);
    return el ? el.textContent.replace(/\s+/g, ' ').trim() : null;
  };
  const val = (s) => {
    const el = document.querySelector(s);
    return el ? el.value : null;
  };
  const attr = (s, n) => {
    const el = document.querySelector(s);
    return el ? el.getAttribute(n) : null;
  };
  const shown = (s) => {
    const el = document.querySelector(s);
    return !!(el && el.offsetParent !== null);
  };
  const L = O.labs;
  const ed = L.sequencer && L.sequencer.editor;
  let studio = null;
  try {
    const st = O.studio;
    const m = st.model;
    const tl = m.timeline || {};
    const tracks = tl.tracks || [];
    studio = { tempo: m.transport.tempo, timeMode: m.transport.timeMode,
      sig: m.transport.timeSignature ? [...m.transport.timeSignature] : null,
      loop: !!(tl.loop && tl.loop.enabled), loopStart: tl.loop ? tl.loop.start : null,
      loopEnd: tl.loop ? tl.loop.end : null,
      title: m.metadata ? m.metadata.title : null, notes: m.metadata ? m.metadata.notes : null,
      playing: !!a.studio.playing, subview: a.studio.subview || null,
      nodes: (m.graph.nodes || []).map((n) => ({ id: n.id, type: n.type,
        params: JSON.parse(JSON.stringify(n.params || {})) })),
      edges: (m.graph.edges || []).length, tracks: tracks.length,
      clips: (tl.clips || []).length,
      markers: (tl.markers || []).length, automation: (tl.automation || []).length,
      zoom: m.view && m.view.graph ? m.view.graph.zoom : null,
      pxPerSecond: m.view && m.view.timeline ? m.view.timeline.pxPerSecond : null,
      selection: JSON.parse(JSON.stringify(st.selection || {})), dirty: !!st.dirty,
      counts: typeof st.counts === 'function' ? st.counts() : null };
  } catch (err) { studio = { error: String(err && err.message) }; }
  let measure = null;
  try {
    const m = O.measure;
    measure = { state: m ? m.state : null, view: a.meas ? JSON.parse(JSON.stringify(
      a.meas.view || {})) : null, tab: a.meas ? a.meas.tab : null,
      expert: a.meas ? !!a.meas.expert : null, setupOpen: a.meas ? !!a.meas.setupOpen : null,
      level: a.meas ? a.meas.level : null, name: a.meas ? a.meas.name : null,
      hasResult: !!(a.meas && a.meas.result) };
  } catch (err) { measure = { error: String(err && err.message) }; }
  return {
    workspace: a.workspace,
    app: { source: a.source, sourceKind: a.sourceKind, waveform: a.waveform,
      frequency: a.frequency, gainLevel: a.gainLevel, inputMode: a.inputMode,
      pattern: a.pattern, playing: a.playing, latched: a.latched,
      continuous: a.continuousAllowed, safetyLimit: a.safetyLimit, duration: a.duration,
      attack: a.attack, release: a.release, a4: a.a4, rangeMode: a.rangeMode,
      rangeMin: a.rangeMin, rangeMax: a.rangeMax, theme: a.theme, explore: a.explore,
      tabs: { ...a.tabs }, vizPaused: a.vizPaused, timeWindowMs: a.timeWindowMs,
      specScale: a.specScale, seqPlaying: a.seqPlaying, learnTopic: a.learnTopic,
      presetTab: a.presetTab, sweep: { ...a.sweep }, pp: JSON.parse(JSON.stringify(a.pp || {})),
      dual: JSON.parse(JSON.stringify(a.dual)), menu: a.menu || null,
      alerts: (a.alerts || []).map((x) => `${x.kind || x.level || ''}: ${x.title || ''} ${
        x.message || x.text || ''}`.trim()) },
    engine: { state: e.state, rate: e.sampleRate, gain: e.gainLevel, nodes: e.activeNodeCount,
      sources: e.activeSourceCount, mic: e.micNodeCount,
      voice: v ? { type: v.plan.type, wave: v.carrier ? v.carrier.type : null,
        freq: v.carrier ? v.carrier.frequency.value : null,
        len: Number.isFinite(v.deadline) ? v.deadline - v.t0 : null,
        periodicWave: !!v.periodicWave,
        a: v.live && v.live.A ? { f: v.live.A.osc.frequency.value, g: v.live.A.g.gain.value,
          wave: v.live.A.osc.type } : null,
        b: v.live && v.live.B ? { f: v.live.B.osc.frequency.value, g: v.live.B.g.gain.value,
          wave: v.live.B.osc.type } : null } : null },
    filter: L.filter ? L.filter.config : null,
    envelope: L.envelope ? { on: L.envelope.enabled, ...L.envelope.adsr } : null,
    additive: L.additive ? { on: L.additive.enabled,
      partials: JSON.parse(JSON.stringify(L.additive.partials)) } : null,
    phase: L.phase ? L.phase.config : null,
    seq: ed ? { playing: ed.playing, loop: ed.model.loop, tempo: ed.model.tempoBpm,
      selected: ed.selectedId, ids: ed.model.blocks.map((b) => b.id),
      totalMs: ed.model.blocks.reduce((t, b) => t + b.durationMs, 0),
      blocks: ed.model.blocks.map((b) => ({ id: b.id, type: b.type, ms: b.durationMs,
        beats: b.beats === undefined ? null : b.beats, p: { ...b.params } })) } : null,
    studio,
    measure,
    unsaved: O.unsaved ? O.unsaved.armed : null,
    dialogs: [...document.querySelectorAll('dialog[open]')].map((d) => d.id),
    themeAttr: document.documentElement.dataset.theme || null,
    hash: location.hash,
    text: { freq: txt('#osc-freq-value'), freqAlt: txt('#osc-freq-alt'),
      gain: txt('#osc-gain-value'), sbFreq: txt('[data-osc="status.frequency"]'),
      sbWave: txt('[data-osc="status.waveform"]'), sbGain: txt('[data-osc="status.gain"]'),
      sbState: txt('[data-osc="status.state"]'), sbDuration: txt('[data-osc="status.duration"]'),
      cutoff: val('#osc-filter-cutoff-value'), q: val('#osc-filter-q-value'),
      seqTempo: val('#osc-seq-tempo'), toast: txt('[data-osc="toasts"]') || txt('.osc-toasts'),
      alerts: txt('[role="alert"]') },
    aria: { seqPlay: attr('#osc-seq-play', 'aria-pressed'),
      seqLoop: attr('#osc-seq-record', 'aria-pressed'),
      filterOn: attr('#osc-filter-enable', 'aria-checked'),
      envOn: attr('#osc-env-enable', 'aria-pressed') || attr('#osc-env-enable', 'aria-checked'),
      addOn: attr('#osc-add-enable', 'aria-checked'),
      dualOn: attr('#osc-dual-enable', 'aria-checked'),
      cont: attr('#osc-continuous-toggle', 'aria-checked'),
      spgFreeze: attr('#osc-spg-freeze', 'aria-checked') || attr('#osc-spg-freeze', 'aria-pressed'),
      studioLoop: attr('[data-osc="studio.loop"]', 'aria-pressed'),
      binaural: attr('#osc-dual-binaural', 'aria-checked'),
      hints: shown('[data-osc="hints"]') },
  };
}

/** Level (dBFS) of one frequency on the engine's post-chain analyser. Runs in the page. */
function toneDbInPage(f) {
  const e = window.OSCILLA.engine;
  const an = e.analyser;
  if (!an || !e.ctx) return -240;
  const n = an.fftSize;
  const x = new Float32Array(n);
  an.getFloatTimeDomainData(x);
  const w = (2 * Math.PI * f) / e.ctx.sampleRate;
  let re = 0;
  let im = 0;
  let ws = 0;
  for (let i = 0; i < n; i++) {
    const h = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1));
    ws += h;
    re += x[i] * h * Math.cos(w * i);
    im -= x[i] * h * Math.sin(w * i);
  }
  return 20 * Math.log10((2 * Math.hypot(re, im)) / ws + 1e-12);
}

/** Peak and dominant frequency of the post-chain analyser. Runs in the page. */
function outputInPage() {
  const e = window.OSCILLA.engine;
  const an = e.analyser;
  if (!an || !e.ctx) return { peak: 0, hz: 0 };
  const t = new Float32Array(an.fftSize);
  an.getFloatTimeDomainData(t);
  let peak = 0;
  for (let i = 0; i < t.length; i++) peak = Math.max(peak, Math.abs(t[i]));
  const f = new Float32Array(an.frequencyBinCount);
  an.getFloatFrequencyData(f);
  let k = 1;
  for (let i = 2; i < f.length; i++) if (f[i] > f[k]) k = i;
  return { peak, hz: (k * e.ctx.sampleRate) / an.fftSize, binHz: e.ctx.sampleRate / an.fftSize };
}

/** The first `n` characters of a message (report text, never audio frames). */
function clip(text, n) {
  const t = String(text);
  return t.length > n ? t.slice(0, n) : t;
}

function toneDb(page, hz) { return page.evaluate(toneDbInPage, hz); }
function output(page) { return page.evaluate(outputInPage); }

/**
 * Poll the level at `hz` until two readings in a row agree within 0.3 dB (and, with
 * `audible`, the tone is above -100 dBFS); returns that level. Bounded by `ms`.
 */
async function steadyDb(page, hz, { ms = 8000, audible = true, what = 'a steady level' } = {}) {
  let prev = null;
  let db = null;
  await until(async () => {
    db = await toneDb(page, hz);
    const ok = prev !== null && Math.abs(db - prev) < 0.3 && (!audible || db > -100);
    prev = db;
    return ok;
  }, { ms, what: `${what} at ${hz} Hz`, every: 150 });
  return db;
}

// ------------------------------------------------------------------------------ discovery
/**
 * Every control the page holds: form fields, buttons, links and elements with an interactive
 * role or a tab stop, with a key for reporting. `visibleOnly` limits it to what is laid out.
 * Runs in the page.
 */
function discoverInPage(visibleOnly) {
  const SEL = 'input, select, textarea, button, a[href], [role="button"], [role="tab"], '
    + '[role="radio"], [role="switch"], [role="slider"], [role="option"], [role="menuitem"], '
    + '[role="menuitemcheckbox"], [role="menuitemradio"], [role="listbox"], [role="checkbox"], '
    + '[role="spinbutton"], [role="combobox"], [role="treeitem"], [role="gridcell"], '
    + '[tabindex]:not([tabindex="-1"])';
  const out = [];
  for (const el of document.querySelectorAll(SEL)) {
    if (el.closest('template')) continue;
    if (el.type === 'hidden') continue;
    const vis = el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';
    if (visibleOnly && !vis) continue;
    const osc = el.getAttribute('data-osc');
    const dv = el.getAttribute('data-value');
    let key;
    if (el.id) key = `#${el.id}`;
    else if (osc) key = `[data-osc="${osc}"]${dv !== null ? `[data-value="${dv}"]` : ''}`;
    else if (el.getAttribute('aria-label')) {
      key = `${el.tagName.toLowerCase()}[aria-label="${el.getAttribute('aria-label')}"]`;
    } else {
      key = `${el.tagName.toLowerCase()}:${(el.textContent || '').replace(/\s+/g, ' ')
        .trim().slice(0, 40)}`;
    }
    out.push({ key, visible: vis, index: out.length });
    el.dataset.oscCensusIndex = String(out.length - 1);
  }
  return out;
}

/** For each discovered element index, the first selector of `selectors` it matches, or null. */
function matchInPage(selectors) {
  const res = {};
  for (const el of document.querySelectorAll('[data-osc-census-index]')) {
    let hit = null;
    for (let i = 0; i < selectors.length && hit === null; i++) {
      try { if (el.matches(selectors[i])) hit = i; } catch (e) { /* reported by the caller */ }
    }
    res[el.dataset.oscCensusIndex] = hit;
  }
  return res;
}

module.exports = { LAUNCH, WORKSPACES, OPEN_MS, openApp, startAudio, navTo, snapshot,
  toneDbInPage, outputInPage, clip, toneDb, output, steadyDb, discoverInPage, matchInPage, until };
