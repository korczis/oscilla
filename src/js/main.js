// OSCILLA V2 entry point (bundled to one IIFE by scripts/build.mjs).
//
// Composition (status/extract.txt section 5):
//   engine  = new AudioEngine()                    the V1 engine + V2 extension points
//   bridge  = createVisualizationBridge({ engine })
//   one Alpine component 'oscilla' = instrument (core/instrument.js, V1 logic)
//                                  + shell (ui/app.js: tabs, segments, workspace, theme, menus)
//                                  + workbench (ui/workbench.js: bindings of the V2 markup)
//                                  + TEMPLATE_HELPERS
//   merged with Object.defineProperties(target, Object.getOwnPropertyDescriptors(part)) in that
//   order (never spread: getters must stay live). Name collisions are resolved on purpose:
//   `theme` belongs to the shell; `waveform` is one shared field (the shell's tile choice writes
//   the instrument value); the shell's nav state is `workspace`, while `mode`/`setMode` stay the
//   V1 mode ids (URL `m`, presets). One component (not two) because the tiles, segments and
//   instrument read and write the same fields; a second component would need a sync layer.
//
// Lab controllers (src/js/labs/**, src/js/charts/**) bind their own panels; they get the engine
// through `adapter` below and never see Alpine. Audio objects, labs and p5 hosts stay out of
// reactive state.
//
// engine.play is wrapped once (instance property) so every play — instrument, Learn demo,
// preset — carries the V2 options: ADSR (envelope lab), the filter insert (filter lab; always
// inserted, its own crossfaded bypass handles "disabled"), the additive PeriodicWave and the
// stereo router for dual plans.

import Alpine from 'alpinejs';
import p5 from 'p5';

import { AudioEngine } from './audio/audio-engine.js';
import { makeAdsrEnvelope } from './audio/voice.js';
import { applyAdsr, releaseAt } from './audio/envelope.js';
import { createStereoRouter } from './audio/stereo.js';
import { createFilterStage } from './audio/filters.js';
import { buildPeriodicWave } from './audio/additive.js';
import { encodeWav, parseWav } from './audio/wav.js';
import { buildPlan, planFreqAt, PATTERNS } from './audio/patterns.js';
import { createVisualizationBridge } from './visualization/visualization-bridge.js';
import { startVisualizer, createDefaultViews } from './visualization/p5-host.js';
import { harmonicTable } from './visualization/harmonics.js';
import { createInstrument } from './core/instrument.js';
import { TEMPLATE_HELPERS } from './core/template-helpers.js';
import { APP_VERSION, STORAGE_KEYS } from './core/constants.js';
import { deepCopy } from './core/math.js';
import { localStore, sessionStore } from './core/storage.js';
import {
  formatFrequency, formatPeriod, formatWavelength, frequencyToNormalized,
  normalizedToFrequency, parseFrequency, parseFrequencyList, regionFor,
} from './core/frequency.js';
import { nearestNote, noteToFrequency } from './core/music.js';
import { BUILTIN_PRESETS } from './data/presets.js';
import { LEARN_TOPICS } from './data/learn.js';
import { serializeSequence } from './sequencer/model.js';

import { registerOscillaUi, workspaceTitle } from './ui/app.js';
import { keyGuard, openModal, closeModal, watchDialogs, focusSafely } from './ui/dialogs.js';
import { createWorkbench, v1ModeFor, workspaceForV1Mode } from './ui/workbench.js';
import { createMeasureUi } from './ui/measure.js';
import { createExperimentsUi } from './ui/experiments.js';
import { createStudioUi } from './ui/studio/workspace.js';
import { createScopeView, createHarmonicBarsView } from './ui/p5-views.js';
import { buildConfigExport, parseConfigImport, CONFIG_FILE_VERSION } from './ui/config-file.js';
import { renderPlanToWav, renderSequenceToWav, screenshotCanvases } from './ui/exporters.js';
import { BUILD } from './core/build-info.js';
import { studioTimelineSeam } from './ui/studio/timeline-test-seam.js';

import { mount as mountAnalysis } from './labs/analysis.js';
import { mount as mountFilter } from './labs/filter-lab.js';
import { mount as mountEnvelope } from './labs/envelope.js';
import { mount as mountAdditive } from './labs/additive.js';
import { mount as mountPhase } from './labs/phase-stereo.js';
import { mount as mountBio } from './labs/bioacoustics.js';
import { mount as mountMic } from './labs/mic-analyzer.js';
import { mount as mountSequencer } from './labs/sequencer-panel.js';
import { mount as mountSpectrogram } from './charts/spectrogram-panel.js';
import { mount as mountDevice } from './charts/device-panel.js';
import { setFramesPaused } from './charts/frame-loop.js';
import { createSpectrogramView } from './charts/spectrogram-view.js';

// ------------------------------------------------------------------------------ services
const engine = new AudioEngine();
const bridge = createVisualizationBridge({ engine });
engine.setEnvelope(makeAdsrEnvelope({ applyAdsr, releaseAt }));

const labs = {};
const labErrors = {};
const adapterListeners = new Set();
let app = null;          // the reactive component (set in init)
let host = null;         // the p5 host of the primary analysis panel
let analysisSpg = null;  // spectrogram view in the analysis panel (Spectrogram tab)
let liveRouter = null;   // { router, wrapper } of the sounding dual voice

function notifyAdapter() {
  for (const fn of adapterListeners) {
    try { fn(); } catch (e) { console.error('OSCILLA adapter listener failed:', e); }
  }
}

/** The engine adapter the lab controllers use (labs/index.js documents the interface). */
const adapter = {
  getContext: () => engine.ctx,
  getSampleRate: () => engine.sampleRate,
  getAnalyser: () => engine.analyser,
  getMicAnalyser: () => null,
  requestedFrequency: () => {
    if (!app) return null;
    return app.source === 'dual' ? app.dualFa : app.metricFrequency;
  },
  isPlaying: () => !!(app && (app.playing || app.seqPlaying)),
  getA4: () => (app && app.a4) || 440,
  onChange(fn) {
    adapterListeners.add(fn);
    return () => adapterListeners.delete(fn);
  },
  getDestination: () => engine.master,
  getStereoRouter: () => (liveRouter ? liveRouter.router : null),
  // The mic lab's nodes are built and accounted by the engine (audio-engine-discipline).
  attachMicrophone: (stream, opts) => engine.attachMicrophone(stream, opts),
  detachMicrophone: () => engine.detachMicrophone(),
  ensureContext: () => {
    if (app) app.ensureAudio(); else engine.init();
    return engine.resume().then(() => engine.ctx);
  },
};

// ------------------------------------------------------------------------------ V2 play options
function routerConfigFor(plan) {
  if (plan.stereo) return { mode: 'split', panA: -1, panB: 1, levelA: 1, levelB: 1 };
  const pan = labs.phase ? labs.phase.config.pan : 0;
  return { mode: 'pan', panA: pan, panB: pan, levelA: 1, levelB: 1 };
}

/** Whether a dual plan needs the stereo router (split, or a panned mono mix). */
function needsRouter(plan) {
  return plan.stereo || (labs.phase && Math.abs(labs.phase.config.pan) > 1e-3);
}

function dualRouterFactory(live) {
  return (ctx, track, plan) => {
    let current = plan;
    const router = createStereoRouter(ctx, routerConfigFor(plan), { track });
    const wrapper = {
      inputA: router.inputA,
      inputB: router.inputB,
      output: router.output,
      update(np) { current = np || current; router.update(routerConfigFor(current)); },
      refresh() { router.update(routerConfigFor(current)); },
      dispose() {
        if (liveRouter && liveRouter.router === router) liveRouter = null;
        router.dispose();
      },
    };
    if (live) liveRouter = { router, wrapper };
    return wrapper;
  };
}

/** The V2 options for a plan on `ctx`. live: the realtime engine (labs track its stages). */
function v2PlayOptions(plan, ctx, live) {
  const o = {};
  const env = labs.envelope;
  if (env && env.enabled) o.adsr = env.adsr;
  const filter = labs.filter;
  if (filter) {
    o.inserts = live ? [filter.createInsert]
      : [(c, track) => createFilterStage(c, filter.config, { track })];
  }
  const add = labs.additive;
  if (add && add.enabled && plan.type !== 'dual' && ctx) {
    const wave = live ? add.periodicWave(ctx) : buildPeriodicWave(ctx, add.partials).wave;
    if (wave) o.periodicWave = wave;
  }
  if (plan.type === 'dual' && needsRouter(plan)) o.dualRouter = dualRouterFactory(live);
  if (plan.type === 'dual' && labs.phase) o.dualPhaseDeg = labs.phase.config.phaseDeg;
  return o;
}

/**
 * What the visualization bridge shows of the labs (Harmonics tab, signal path): read on every
 * bridge sync, never per frame. Plain values only.
 */
function labVizInputs(plan) {
  const add = labs.additive;
  const additive = add && add.enabled && plan && plan.type !== 'dual' ? add.coefficients() : null;
  const env = labs.envelope;
  const filter = labs.filter ? labs.filter.config : null;
  const dual = plan && plan.type === 'dual';
  return {
    additive,
    adsr: env && env.enabled ? { ...env.adsr } : null,
    filter: filter && filter.enabled ? { ...filter } : null,
    router: dual && needsRouter(plan) ? routerConfigFor(plan) : null,
    phaseDeg: dual && labs.phase ? labs.phase.config.phaseDeg : 0,
  };
}
bridge.labInputs = labVizInputs;

const basePlay = engine.play.bind(engine);
engine.play = (plan, o = {}) => {
  // Playground and Measure share one output (spec §74): no instrument voice while a measurement
  // owns it. The measurement itself never calls play (capture.js schedules its own source).
  if (app && app.measureOwnsOutput()) {
    app.notify('info', 'Measurement in progress', 'The output belongs to the measurement: stop '
      + 'it (Esc) before playing.');
    return null;
  }
  return basePlay(plan, { ...o, ...v2PlayOptions(plan, engine.ctx, true) });
};

/**
 * Measure (and Studio PLAY) take the output: stop the instrument and the sequencer (their
 * voices fade), and a playing Studio (V3.1; it is not playing while it claims the output).
 */
function stopPlayback(cmp) {
  if (cmp.seqPlaying && labs.sequencer) labs.sequencer.editor.stop();
  if (cmp.playing) cmp.stopNow();
  if (typeof cmp.studioOwnsOutput === 'function' && cmp.studioOwnsOutput()) cmp.studioStop();
}

/** Revert the sounding voice from a PeriodicWave to its oscillator type (additive off). */
function clearPeriodicWave() {
  if (typeof engine.clearPeriodicWave === 'function') engine.clearPeriodicWave(); // click-free dip
}

// ------------------------------------------------------------------------------ exports
function exportConfigDoc(cmp) {
  const instrument = cmp.serializeConfig();
  instrument.dual = deepCopy(cmp.dual);
  instrument.dual.binaural = false;
  if (!instrument.sweep) instrument.sweep = deepCopy(cmp.sweep);
  return buildConfigExport({
    oscillaVersion: BUILD.version, // product version; the schema stays "version": 1
    sampleRate: engine.sampleRate,
    mode: v1ModeFor(cmp.workspace, cmp.source),
    workspace: cmp.workspace,
    instrument,
    envelope: labs.envelope ? { enabled: labs.envelope.enabled, ...labs.envelope.adsr } : null,
    filter: labs.filter ? labs.filter.config : null,
    sequencer: labs.sequencer ? serializeSequence(labs.sequencer.editor.model) : null,
    additive: labs.additive
      ? { enabled: labs.additive.enabled, partials: labs.additive.partials } : null,
    phaseStereo: labs.phase ? labs.phase.config : null,
    now: new Date(),
  });
}

function applyImport(cmp, parsed) {
  let issues = cmp.applyConfig(parsed.instrument, 'import');
  if (parsed.envelope && labs.envelope) {
    labs.envelope.update({ adsr: parsed.envelope.adsr, enabled: parsed.envelope.enabled });
  }
  if (parsed.filter && labs.filter) labs.filter.update(parsed.filter);
  if (parsed.additive && labs.additive) {
    labs.additive.update({ partials: parsed.additive.partials, enabled: parsed.additive.enabled });
  }
  if (parsed.phaseStereo && labs.phase) {
    // A/B frequencies and the route belong to the dual oscillator (dualOsc), already applied.
    const { phaseDeg, pan } = parsed.phaseStereo;
    labs.phase.update({ phaseDeg, pan, freqA: cmp.dual.a.freq, freqB: cmp.dual.b.freq,
      route: cmp.dual.stereo ? 'stereo' : 'mono' });
  }
  if (parsed.sequencer && labs.sequencer) {
    const seqIssues = labs.sequencer.editor.load(parsed.sequencer) || [];
    issues += seqIssues.length;
    labs.sequencer.render();
  }
  cmp.sourceKind = cmp.source === 'single' && cmp.pattern === 'tone' ? 'oscillator' : 'pattern';
  syncLabFlags();
  return issues;
}

async function renderWav(cmp, what) {
  const sampleRate = engine.sampleRate || 48000;
  if (what === 'sequence') {
    if (!labs.sequencer) throw new Error('The sequencer is not available.');
    return renderSequenceToWav(labs.sequencer.editor.model, {
      sampleRate, level: cmp.gainLevel, waveform: cmp.waveform,
    });
  }
  const res = cmp.currentPlan();
  if (!res.ok) throw new Error(res.error);
  const base = {
    mode: 'trigger', continuous: cmp.continuousAllowed, limitS: cmp.safetyLimit,
    durationS: cmp.duration / 1000, attackS: cmp.attack / 1000, releaseS: cmp.release / 1000,
  };
  return renderPlanToWav({
    plan: res.plan,
    gain: cmp.gainLevel,
    sampleRate,
    playOptions: base,
    extraOptions: (ctx) => v2PlayOptions(res.plan, ctx, false),
    decorate: (e) => e.setEnvelope(makeAdsrEnvelope({ applyAdsr, releaseAt })),
  });
}

const SCREENSHOT_PANEL = {
  filter: 'osc-panel-filter', compare: 'osc-panel-mic', sequencer: 'osc-panel-analysis',
};

function screenshot(cmp) {
  const fs = document.querySelector('.osc-panel.is-fullscreen, .osc-panel:fullscreen');
  const id = SCREENSHOT_PANEL[cmp.workspace] || 'osc-panel-analysis';
  const root = fs || document.getElementById(id);
  const bg = getComputedStyle(document.documentElement).getPropertyValue('--osc-surface-1').trim();
  return screenshotCanvases(root, {
    background: bg || '#06111d',
    title: `OSCILLA v${BUILD.version} · ${cmp.statusFreqText} · ${cmp.statusWaveText}`,
  });
}

function applyVizPause(paused) {
  setFramesPaused(paused); // every chart, panel and lab renderer on the shared frame loop
  const chart = labs.analysis && labs.analysis.chart;
  if (chart && typeof chart.setFreeze === 'function') chart.setFreeze(!!paused);
  if (analysisSpg && typeof analysisSpg.setFreeze === 'function') analysisSpg.setFreeze(!!paused);
}

// ------------------------------------------------------------------------------ analysis tabs
function setAnalysisTab(tab) {
  if (host) {
    host.setView(tab === 'harmonics' ? 'harmonicBars' : tab === 'signalPath' ? 'path' : 'scope');
  }
  const spgHost = document.getElementById('osc-chart-analysis-spg');
  if (tab === 'spectrogram' && spgHost && !analysisSpg) {
    try {
      analysisSpg = createSpectrogramView(spgHost, { getAnalyser: () => engine.analyser });
      if (app && app.vizPaused) analysisSpg.setFreeze(true);
    } catch (e) {
      console.error('OSCILLA analysis spectrogram failed:', e);
    }
  } else if (tab !== 'spectrogram' && analysisSpg) {
    analysisSpg.dispose();
    analysisSpg = null;
    if (spgHost) spgHost.replaceChildren();
  }
  requestAnimationFrame(() => { if (host) host.resize(); });
  repairCharts();
}

// ------------------------------------------------------------------------------ labs
/**
 * Workaround (reported to the charts owner): a uPlot chart resized while its host is hidden
 * (display: none -> 0 px, clamped to 40 px) keeps negative axis sizes and draws no axes after
 * the host is shown again. After layout changes that show panels (workspace, fullscreen),
 * rebuild the visible uPlot charts through their public refreshTheme().
 */
function repairCharts() {
  requestAnimationFrame(() => {
    if (app && app.workspace === 'measure') app.measureRelayout();
    if (app && app.workspace === 'experiments') app.experimentsRelayout();
    for (const lab of [labs.analysis, labs.mic, labs.filter]) {
      const chart = lab && lab.chart;
      const u = chart && chart.uplot;
      if (!u || typeof chart.refreshTheme !== 'function') continue;
      const root = u.root && u.root.parentElement;
      if (root && root.clientWidth > 0 && root.clientHeight > 0) chart.refreshTheme();
    }
  });
}

/** A lab that shapes the voice changed: refresh the bridge (signal path, harmonics) and labels. */
function vizLabsChanged() {
  if (!app) return;
  app.labRev += 1;
  app.syncViz();
}

function syncLabFlags() {
  if (!app) return;
  app.labFlags.additive = !!(labs.additive && labs.additive.enabled);
  app.labFlags.envelope = !!(labs.envelope && labs.envelope.enabled);
  app.labFlags.filter = !!(labs.filter && labs.filter.config.enabled);
}

function onBioRange(minHz, maxHz, entry) {
  if (!app) return;
  const lo = Math.max(1, minHz);
  const hi = Math.min(app.safeMax, maxHz);
  if (!(hi >= lo * 2)) {
    app.notify('info', `${entry.label}: range not applied`, 'The range is narrower than one '
      + 'octave or above the digital limit.');
    return;
  }
  app.rangeMode = 'custom';
  app.setCustomBound('max', String(hi));
  app.setCustomBound('min', String(lo));
  app.notify('info', `Explorer range: ${entry.label}`, `${formatFrequency(app.customMin)} – `
    + `${formatFrequency(app.customMax)} (approximate; ranges vary by source and individual).`);
}

/** The selected block's glyph (sprite #i-block-<type>) in the sequencer editor header. */
function syncSequencerIcon(root) {
  const title = root.querySelector('#osc-seq-editor-title');
  const icon = root.querySelector('[data-osc="seq.editor.icon"]');
  const use = icon && icon.querySelector('use');
  if (!title || !use) return;
  const sync = () => {
    const block = labs.sequencer.editor.selectedBlock;
    if (!block) return;
    const href = `#i-block-${block.type}`;
    if (use.getAttribute('href') !== href) use.setAttribute('href', href);
    if (icon.dataset.type !== block.type) icon.dataset.type = block.type;
    if (icon.style.visibility) icon.style.visibility = '';
  };
  const mo = new MutationObserver(sync);
  mo.observe(title, { childList: true, characterData: true, subtree: true });
  mo.observe(icon, { attributes: true, attributeFilter: ['style'] });
  sync();
}

function mountLabs(root) {
  const list = [
    ['analysis', mountAnalysis], ['spectrogram', mountSpectrogram], ['device', mountDevice],
    ['mic', mountMic], ['filter', mountFilter], ['envelope', mountEnvelope],
    ['additive', mountAdditive], ['phase', mountPhase],
    ['bio', mountBio, { onSelectRange: onBioRange }], ['sequencer', mountSequencer],
  ];
  for (const [name, mount, opts] of list) {
    try {
      labs[name] = mount(root, adapter, opts || {});
    } catch (e) {
      labErrors[name] = String(e && e.message);
      console.error(`OSCILLA: the ${name} panel could not start:`, e);
    }
  }
  if (labs.additive) {
    labs.additive.onChange(() => {
      syncLabFlags();
      vizLabsChanged(); // Harmonics tab and signal path show the additive table
      if (!engine.voice || engine.voice.ended) return;
      if (labs.additive.enabled) {
        const wave = labs.additive.periodicWave(engine.ctx);
        if (wave) engine.setPeriodicWave(wave);
      } else clearPeriodicWave();
    });
  }
  const labChanged = () => { syncLabFlags(); vizLabsChanged(); };
  if (labs.envelope) labs.envelope.onChange(labChanged);
  if (labs.filter) labs.filter.onChange(labChanged);
  if (labs.phase) {
    let lastPhaseDeg = labs.phase.config.phaseDeg;
    labs.phase.onChange((cfg) => {
      if (!app) return;
      if (Math.abs(app.dual.a.freq - cfg.freqA) > 1e-6) app.setDualFreq('a', String(cfg.freqA));
      if (Math.abs(app.dual.b.freq - cfg.freqB) > 1e-6) app.setDualFreq('b', String(cfg.freqB));
      const stereo = cfg.route === 'stereo';
      if (app.dual.stereo !== stereo) app.setStereo(stereo);
      if (liveRouter) liveRouter.wrapper.refresh();
      if (cfg.phaseDeg !== lastPhaseDeg) {
        // B's phase offset is a start time: a sounding dual voice restarts click-free with it.
        lastPhaseDeg = cfg.phaseDeg;
        engine.setDualPhase(cfg.phaseDeg);
        vizLabsChanged();
      }
    });
  }
  if (labs.sequencer) syncSequencerIcon(root);
  if (labs.sequencer) {
    // UI bookkeeping only (the sequencer schedules on the audio clock itself).
    setInterval(() => {
      const on = !!labs.sequencer.editor.playing;
      if (app && app.seqPlaying !== on) {
        app.seqPlaying = on;
        notifyAdapter();
      }
    }, 150);
  }
  syncLabFlags();
}

// ------------------------------------------------------------------------------ component
function compose(...parts) {
  const target = {};
  for (const part of parts) {
    Object.defineProperties(target, Object.getOwnPropertyDescriptors(part));
  }
  return target;
}

function integrationInit() {
  app = this;
  const root = this.$root;
  const cmp = this;

  // V1 init order (status/extract.txt section 5)
  cmp.debug = new URLSearchParams(window.location.search).get('debug') === '1';
  cmp.storage.local = localStore.available();
  cmp.storage.session = sessionStore.available();
  try {
    bridge.state.reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch (e) { /* matchMedia unavailable */ }
  if (!cmp.storage.local) {
    cmp.notify('warning', 'Storage unavailable', 'Custom presets cannot be saved in this browser '
      + 'mode; they last only for this page view.');
  }
  cmp.customPresets = cmp.loadCustomPresets();
  cmp.history = cmp.loadHistory();
  cmp.safetyCollapsed = sessionStore.get(STORAGE_KEYS.safetySeen) === '1';
  const hadMode = /(^|[#&])m=/.test(window.location.hash);
  cmp.restoreFromHash();
  if (hadMode) cmp.workspace = workspaceForV1Mode(cmp.mode);
  if (cmp.source !== 'single' || cmp.pattern !== 'tone') cmp.sourceKind = 'pattern';
  engine.on((type, d) => {
    cmp.onEngine(type, d);
    notifyAdapter();
  });
  if (!engine.isSupported()) {
    cmp.status = 'ERROR';
    cmp.notify('error', 'Web Audio unavailable', 'This browser does not provide the Web Audio '
      + 'API, so OSCILLA cannot generate sound here.');
  }

  // first gesture creates/resumes the context inside the gesture
  const unlock = () => { if (engine.isSupported()) cmp.ensureAudio(); };
  window.addEventListener('pointerdown', unlock, { capture: true });
  window.addEventListener('keydown', unlock, { capture: true });
  const stopSequencer = () => {
    if (cmp.seqPlaying && labs.sequencer) labs.sequencer.editor.stop();
  };
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      stopSequencer();
      cmp.measureAbort('escape'); // spec §111: Escape aborts a measurement (after the sequencer)
    }
    cmp.onKeyDown(e);
  });
  window.addEventListener('keyup', (e) => cmp.onKeyUp(e));
  window.addEventListener('blur', () => cmp.releaseHold());
  window.addEventListener('hashchange', () => cmp.restoreFromHash());
  const hide = () => {
    cmp.releaseHold();
    stopSequencer();
    cmp.measureAbort('pagehide'); // spec §169 (the capture io also aborts on its own)
    if (!cmp.latched) return;
    cmp.stop();
  };
  document.addEventListener('visibilitychange', () => { if (document.hidden) hide(); });
  window.addEventListener('pagehide', hide);
  document.addEventListener('fullscreenchange', () => {
    requestAnimationFrame(() => { if (host) host.resize(); });
    repairCharts();
  });

  // live state -> plan, readouts, bridge and live audio (unthrottled, K2)
  Alpine.effect(() => cmp.syncViz());
  // Calm announcements (V1 a7b7a23): only PLAYING, SUSPENDED, STOPPED and ERROR, kept until the
  // next one; RELEASING/READY and readout changes are not announced.
  Alpine.effect(() => {
    const st = cmp.seqPlaying && !cmp.playing ? 'PLAYING' : cmp.status;
    if (st === 'SUSPENDED') cmp.announceText = 'Playback SUSPENDED: tap or press a key to start audio';
    else if (['PLAYING', 'STOPPED', 'ERROR'].includes(st)) cmp.announceText = `Playback ${st}`;
  });
  Alpine.effect(() => { cmp.mode = v1ModeFor(cmp.workspace, cmp.source); });
  Alpine.effect(() => { cmp.inputMode = cmp.noteMode ? 'note' : 'frequency'; });
  Alpine.effect(() => { cmp.dualRoute = cmp.dual.stereo ? 'stereo' : 'mono'; });
  Alpine.effect(() => {
    if (cmp.source === 'sweep' || (cmp.source === 'single' && cmp.pattern !== 'tone')) {
      cmp.sourceKind = 'pattern';
    }
  });
  Alpine.effect(() => {
    // touch what the labs read through the adapter
    void cmp.metricFrequency; void cmp.playing; void cmp.sampleRate; void cmp.dualFa;
    notifyAdapter();
  });
  cmp.$watch('gainLevel', (g) => engine.setMasterGain(g));
  cmp.$watch('theme', () => {
    bridge.readPalette();
    requestAnimationFrame(() => {
      cmp.measureRefreshCharts();
      cmp.experimentsRefreshCharts();
    });
  });
  cmp.$watch('tabs.analysis', (tab) => setAnalysisTab(tab));
  cmp.$watch('workspace', (ws) => {
    // A measurement does not keep running unseen: leaving MEASURE stops it.
    if (ws !== 'measure') cmp.measureAbort('workspace');
    if (ws === 'experiments' && !cmp.exps.loaded) {
      cmp.experimentsRefresh().catch((err) => cmp.notify('error', 'Experiments unavailable',
        err.message || String(err)));
    }
    repairCharts();
  });
  const baseTitle = document.title;
  cmp.$watch('workspace', (ws) => { document.title = workspaceTitle(ws, baseTitle); });
  // R3: Pause animation. The p5 views pause through bridge.state.paused (syncViz); the uPlot
  // spectrum and the analysis-tab spectrogram hold their last real frame through their public
  // setFreeze(); setFramesPaused() stops every other renderer on the shared frame loop.
  cmp.$watch('vizPaused', (paused) => applyVizPause(paused));

  root.addEventListener('osc:ui', (e) => {
    const { kind, key, value } = e.detail || {};
    if (kind === 'choice' && key === 'sourceKind') cmp.onSourceKind(value);
    else if (kind === 'choice' && key === 'inputMode') cmp.noteMode = value === 'note';
    else if (kind === 'choice' && key === 'dualRoute') cmp.onDualRoute(value);
    else if (kind === 'choice' && key === 'waveform') cmp.setWaveform(value);
    else if (kind === 'theme') bridge.readPalette();
  });

  watchDialogs(document);
  keepFocusInView(document.getElementById('osc-main'));
  bridge.readPalette();
  // V1 initVisualizer: the primary host reports the wave layout (V2's primary view is the scope,
  // which labels itself in the canvas; the layout is still forwarded for the V1 views).
  bridge.onWaveLayout = (l) => { cmp.waveLayout = l; };

  cmp.$nextTick(() => {
    const el = document.getElementById('osc-chart-waveform');
    const views = {
      ...createDefaultViews(),
      scope: createScopeView({ getWindowMs: () => cmp.timeWindowMs }),
      harmonicBars: createHarmonicBarsView(),
    };
    host = el ? startVisualizer(bridge, el, { P5: p5, views, view: 'scope' }) : false;
    if (!host) {
      cmp.vizFailed = true;
      cmp.notify('warning', 'Visualization unavailable', 'The waveform display could not start; '
        + 'audio still works.');
      host = null;
    }
    mountLabs(root);
    cmp.measureMountCharts(root);
    cmp.experimentsMountCharts(root);
    if (labs.phase) {
      // dual oscillator -> Phase & Stereo panel (A/B and the route are the dual's)
      Alpine.effect(() => {
        const freqA = cmp.dual.a.freq;
        const freqB = cmp.dual.b.freq;
        const route = cmp.dual.stereo ? 'stereo' : 'mono';
        cmp.stereoRoute = route;
        labs.phase.update({ freqA, freqB, route });
      });
    }
    if (labs.sequencer) {
      Alpine.effect(() => {
        const w = cmp.waveform;
        try { labs.sequencer.editor.setWaveform(w); } catch (e) { /* unknown waveform */ }
      });
    }
    setAnalysisTab(cmp.tabs.analysis);
    if (cmp.debug) setInterval(() => cmp.refreshDebug(), 250);
    cmp.initialized = true;
    document.documentElement.dataset.ready = 'true';
  });
}

/**
 * Firefox and WebKit do not scroll a keyboard-focused control that is already partly inside
 * the #osc-main scroller, so its edge (the status bar below it) can cut the control (WCAG
 * 2.4.11). After the browser's own focus scroll, nudge #osc-main until it is fully visible.
 */
function keepFocusInView(main) {
  if (!main) return;
  document.addEventListener('focusin', (e) => {
    const el = e.target;
    if (!(el instanceof Element) || el === main || !main.contains(el)) return;
    requestAnimationFrame(() => {
      let keyboard = true;
      try { keyboard = el.matches(':focus-visible'); } catch (err) { /* no :focus-visible */ }
      if (document.activeElement !== el || !keyboard) return;
      const r = el.getBoundingClientRect();
      if (!r.height) return;
      const top = main.getBoundingClientRect().top + main.clientTop + 4;
      const bottom = top + main.clientHeight - 8;
      if (r.top < top) main.scrollTop -= top - r.top;
      else if (r.bottom > bottom) main.scrollTop += Math.min(r.bottom - bottom, r.top - top);
    });
  });
}

/**
 * The info/success auto-dismiss timer (core notify) removes a notification through
 * dismissAlert(). When that notification holds focus, hand focus to its neighbour's Dismiss
 * button, else #osc-main, as dismissAlertFocus does for a pressed Dismiss: never <body>.
 */
function focusSafeDismiss(coreDismiss) {
  return function dismissAlert(id) {
    const i = this.alerts.findIndex((a) => a.id === id);
    const toasts = [...document.querySelectorAll('[data-osc="alerts"] .osc-toast')];
    const item = i >= 0 ? toasts[i] : null;
    const hadFocus = !!item && item.contains(document.activeElement);
    const next = hadFocus ? toasts[i + 1] || toasts[i - 1] || null : null;
    coreDismiss.call(this, id);
    if (!hadFocus) return;
    this.$nextTick(() => focusSafely(next && next.isConnected ? next.querySelector('button')
      : null));
  };
}

function createOscillaComponent(ui) {
  const instrument = createInstrument({
    engine, bridge, keyGuard: (e) => keyGuard(e), openModal: (id) => openModal(id),
    closeModal: (id) => closeModal(id),
  });
  const shellInit = ui.init;
  const workbench = createWorkbench({
    engine, bridge, labs, exportConfigDoc, applyImport, renderWav, screenshot,
    relayout: () => { if (host) host.resize(); repairCharts(); },
  });
  const measure = createMeasureUi({
    engine, build: BUILD, stopPlayback,
    loopback: new URLSearchParams(window.location.search).get('measure') === 'loopback',
  });
  const experiments = createExperimentsUi();
  const studio = createStudioUi({ engine, stopPlayback });
  const cmp = compose(instrument, ui, workbench, measure, experiments, studio, provenancePart(),
    TEMPLATE_HELPERS);
  cmp.dismissAlert = focusSafeDismiss(cmp.dismissAlert);
  const baseRefreshDebug = cmp.refreshDebug;
  Object.defineProperty(cmp, 'refreshDebug', {
    value() {
      baseRefreshDebug.call(this);
      this.debugInfo = { ...provenanceDebug(), ...this.debugInfo, ...runtimeDebug() };
    },
    enumerable: true,
    configurable: true,
    writable: true,
  });
  Object.defineProperty(cmp, 'init', {
    value() {
      shellInit.call(this);
      this.measureInit();
      this.experimentsInit();
      this.studioInit(); // before integrationInit: Studio's key listener runs first (§125)
      integrationInit.call(this);
    },
    enumerable: true,
    configurable: true,
    writable: true,
  });
  return cmp;
}

// ------------------------------------------------------------------------------ provenance
// BUILD (core/build-info.js) is the runtime projection of package.json "version" and of the
// build/deploy metadata region. The About dialog, the status bar and ?debug=1 read it here.
function provenancePart() {
  return {
    BUILD,
    get buildCommitText() { return BUILD.shortCommit || 'source build'; },
    get buildDigestText() { return BUILD.sourceDigest || 'unknown (unbundled build)'; },
  };
}

function provenanceDebug() {
  return {
    version: BUILD.version,
    channel: BUILD.channel,
    commit: BUILD.commit || 'none (source build)',
    'source date': BUILD.sourceDate || '— (source build)',
    'source digest': BUILD.sourceDigest || '—',
    'artifact sha256': BUILD.artifactSha256 || '— (unstamped)',
    'build metadata': `${BUILD.origin}${BUILD.consistent ? '' : ' (region != compiled defines)'}`
      + `${BUILD.regionError ? ` (${BUILD.regionError})` : ''}`,
    'config schema': CONFIG_FILE_VERSION,
  };
}

function runtimeDebug() {
  const mic = labs.mic;
  let micState = 'unavailable';
  if (mic) micState = mic.active ? 'live' : (mic.error ? `off (${mic.error})` : 'off');
  const err = engine.lastError;
  return {
    'audible voices': engine.audibleVoiceCount,
    'active voices': engine.voices ? engine.voices.size : '—',
    microphone: micState,
    'last error': err ? `${err.message}${err.context ? ` [${err.context}]` : ''}` : '—',
  };
}

// ------------------------------------------------------------------------------ errors
function reportError(message, context) {
  engine.lastError = { message, context };
  if (app) app.notify('error', 'Unexpected error', message);
}
window.addEventListener('error', (e) => {
  if (!e || !e.message) return; // resource errors carry no message
  reportError(String(e.message), 'window');
});
window.addEventListener('unhandledrejection', (e) => {
  const r = e && e.reason;
  reportError(String((r && r.message) || r || 'Unhandled promise rejection'), 'promise');
});

// ------------------------------------------------------------------------------ test seam
window.OSCILLA = {
  engine,
  viz: bridge,
  adapter,
  labs,
  labErrors,
  get app() { return app; },
  get host() { return host; },
  get measure() { return app ? app.measureTestSeam() : null; },
  get experiments() { return app ? app.experimentsTestSeam() : null; },
  get studio() { return app ? app.studioTestSeam() : null; },
  studioTimeline: studioTimelineSeam(engine),
  buildPlan,
  planFreqAt,
  parseFrequency,
  parseFrequencyList,
  formatFrequency,
  formatPeriod,
  formatWavelength,
  frequencyToNormalized,
  normalizedToFrequency,
  nearestNote,
  noteToFrequency,
  regionFor,
  harmonicTable,
  BUILTIN_PRESETS,
  LEARN_TOPICS,
  PATTERNS,
  parseWav,
  encodeWav,
  buildConfigExport,
  parseConfigImport,
};
// Read-only provenance: version === BUILD.version (package.json), build is the frozen record.
// APP_VERSION is the frozen legacy V1 stamp, deliberately not called a "version" here.
Object.defineProperties(window.OSCILLA, {
  version: { value: BUILD.version, enumerable: true, writable: false, configurable: false },
  build: { value: BUILD, enumerable: true, writable: false, configurable: false },
  legacyV1Stamp: { value: APP_VERSION, enumerable: true, writable: false, configurable: false },
});

// ------------------------------------------------------------------------------ start
registerOscillaUi(Alpine, { compose: createOscillaComponent });
for (const [name, fn] of Object.entries(TEMPLATE_HELPERS)) Alpine.magic(name, () => fn);
window.Alpine = Alpine;
Alpine.start();
