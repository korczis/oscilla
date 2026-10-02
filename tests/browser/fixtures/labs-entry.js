// Labs fixture: the shell (Alpine + ui/app.js) plus every lab controller, driven by a FAKE
// engine adapter: a real AudioContext with an oscillator → gain → master → analyser chain.
// Bundled in memory by tests/browser/labs.cjs (esbuild, IIFE) into the shell's index.html.
// window.__LABS_CONFIG__: { frequency, gain, fftSize, stereo, warmupMs, referenceState }.

import Alpine from 'alpinejs';
import { registerOscillaUi } from '../../../src/js/ui/app.js';
import { mountLabs } from '../../../src/js/labs/index.js';
import { createStereoRouter } from '../../../src/js/audio/stereo.js';
import { buildPeriodicWave, harmonicSeries } from '../../../src/js/audio/additive.js';
import { HEARING_RANGES } from '../../../src/js/data/bioacoustics.js';
import { buildColorLut } from '../../../src/js/analysis/spectrogram.js';
import { lutStopsFromTheme } from '../../../src/js/charts/spectrogram-view.js';
import { chartTheme } from '../../../src/js/charts/chart-theme.js';
import { buildMicrophoneGraph, closeMicrophone } from '../../../src/js/audio/microphone.js';

const cfg = { frequency: 1000, gain: 0.5, fftSize: 8192, stereo: false, warmupMs: 0,
  ...(window.__LABS_CONFIG__ || {}) };

// ---- live source accounting (OscillatorNode start/stop/ended), for the sequencer check ----
const sources = { started: 0, ended: 0, live: new Set() };
const origStart = OscillatorNode.prototype.start;
OscillatorNode.prototype.start = function start(...args) {
  sources.started++;
  sources.live.add(this);
  this.addEventListener('ended', () => {
    sources.ended++;
    sources.live.delete(this);
  }, { once: true });
  return origStart.apply(this, args);
};

function createFakeAdapter() {
  const ctx = new AudioContext();
  const master = ctx.createGain();
  const analyser = ctx.createAnalyser();
  analyser.fftSize = cfg.fftSize;
  analyser.smoothingTimeConstant = 0.8;
  const out = ctx.createGain();
  out.gain.value = 0; // headless: nothing to hear; the analyser is still pulled
  master.connect(analyser);
  analyser.connect(out);
  out.connect(ctx.destination);

  const osc = ctx.createOscillator();
  osc.frequency.value = cfg.frequency;
  const level = ctx.createGain();
  level.gain.value = cfg.gain;
  osc.connect(level);
  level.connect(master);
  origStart.call(osc); // not counted: the fixture tone is not a sequencer source

  let router = null;
  if (cfg.stereo) {
    router = createStereoRouter(ctx, { mode: 'split' });
    const a = ctx.createOscillator();
    const b = ctx.createOscillator();
    a.frequency.value = 440;
    b.frequency.value = 440;
    const ga = ctx.createGain();
    const gb = ctx.createGain();
    ga.gain.value = 0.5;
    gb.gain.value = 0.5;
    a.connect(ga);
    b.connect(gb);
    ga.connect(router.inputA);
    gb.connect(router.inputB);
    const silent = ctx.createGain();
    silent.gain.value = 0;
    router.output.connect(silent);
    silent.connect(ctx.destination);
    origStart.call(a);
    origStart.call(b, ctx.currentTime + 0.25 / 440); // B lags A by a quarter period
  }

  const listeners = new Set();
  let requested = cfg.frequency;
  // The mic lab needs an engine-owned microphone graph (attachMicrophone); the fake engine
  // builds it with the same builder the real engine uses.
  let mic = null;
  return {
    ctx,
    osc,
    level,
    adapter: {
      getContext: () => ctx,
      getSampleRate: () => ctx.sampleRate,
      getAnalyser: () => analyser,
      getMicAnalyser: () => null,
      requestedFrequency: () => requested,
      isPlaying: () => true,
      getDestination: () => master,
      getStereoRouter: () => router,
      attachMicrophone(stream, opts) {
        if (mic) closeMicrophone(mic);
        mic = buildMicrophoneGraph(ctx, stream, opts);
        return mic.analyser;
      },
      detachMicrophone() {
        if (mic) closeMicrophone(mic);
        mic = null;
      },
      onChange(cb) {
        listeners.add(cb);
        return () => listeners.delete(cb);
      },
    },
    setFrequency(f) {
      requested = f;
      osc.frequency.setValueAtTime(f, ctx.currentTime);
      for (const cb of listeners) cb();
    },
  };
}

registerOscillaUi(Alpine);
Alpine.start();

const fake = createFakeAdapter();
const root = document.getElementById('osc-app');
const labs = mountLabs(root, fake.adapter, {
  onSelectRange: (min, max, entry) => {
    window.__lastRange = { min, max, id: entry.id };
  },
});

// The reference screenshot shows the Filter, Envelope and Additive labs switched on; the shell
// markup defaults them to off. The visual build reproduces the reference state.
if (cfg.referenceState) {
  labs.filter.update({ enabled: true });
  labs.envelope.update({ enabled: true });
  labs.additive.update({ enabled: true });
}

window.__labs = {
  labs,
  ctx: fake.ctx,
  adapter: fake.adapter,
  setFrequency: fake.setFrequency,
  sources,
  modules: { buildPeriodicWave, harmonicSeries, HEARING_RANGES },
  floorColour() {
    const lut = buildColorLut(lutStopsFromTheme(chartTheme()));
    return [lut[0], lut[1], lut[2]];
  },
};

// visual-compare.mjs screenshots 400 ms after `__oscReady || Alpine`: both are published only
// after the warm-up, so the live charts have real history when the screenshot is taken.
setTimeout(() => {
  window.Alpine = Alpine;
  window.__oscReady = true;
}, cfg.warmupMs);
