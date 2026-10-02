// Visualization modules: the bridge (snapshot-only reads, V2 palette tokens), the p5 host and
// views (smoke-rendered on a stub p5, which catches moved code that lost a binding), and the
// pure data functions for the uPlot charts (spectrum columns, motion trajectory, harmonics axis).
//   node --test 'tests/unit/*.test.mjs'

import test from 'node:test';
import assert from 'node:assert';

import {
  VisualizationBridge, parseCssColor, PALETTE_TOKENS,
} from '../../src/js/visualization/visualization-bridge.js';
import { createP5Host, startVisualizer } from '../../src/js/visualization/p5-host.js';
import {
  aggregateColumns, buildColumnMap, columnFrequencies, columnMapStale, freqToUnit,
  layoutMarkerLabels, octaveCMarkers, regionBands, spectrumAxis, spectrumMarkers, spectrumTicks,
  thirdOctaveBands,
} from '../../src/js/visualization/spectrum-data.js';
import { waveCompact } from '../../src/js/visualization/waveform.js';
import {
  isFastFm, motionAxis, motionWindow, sampleTrajectory,
} from '../../src/js/visualization/motion.js';
import { harmonicAxis, harmonicTable } from '../../src/js/visualization/harmonics.js';
import { createInstrument } from '../../src/js/core/instrument.js';
import { buildPlan, planFreqAt } from '../../src/js/audio/patterns.js';
import { defaultInstrumentState } from '../../src/js/core/config.js';

// ---------------------------------------------------------------- stubs

function stubP5(log) {
  let ms = 0;
  const base = {
    LEFT: 'left', RIGHT: 'right', CENTER: 'center', BASELINE: 'alphabetic', CLOSE: 'close',
    canvas: {},
    color: (...a) => a,
    textWidth: (t) => String(t).length * 6,
    millis: () => (ms += 16),
    frameRate: () => 30,
    bezierPoint: () => 0,
    createCanvas: () => ({ elt: { setAttribute() {}, style: {} } }),
  };
  return new Proxy(base, {
    get(t, k) {
      if (k in t) return t[k];
      return (...args) => { log.push([k, args]); };
    },
  });
}

function stubEnv() {
  const listeners = [];
  return {
    document: {
      hidden: false,
      documentElement: {},
      addEventListener: (type) => listeners.push(type),
      removeEventListener() {},
    },
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
    devicePixelRatio: 2,
    ResizeObserver: class { observe() {} disconnect() {} },
    requestAnimationFrame: () => 1,
    setTimeout: () => 1,
    setInterval: () => 1,
    clearInterval() {},
    listeners,
  };
}

/** An engine stand-in whose snapshot reports a playing voice with a sine in the analyser. */
function fakeEngine(plan, { sampleRate = 48000, f = 440 } = {}) {
  const timeData = new Float32Array(8192);
  const analyser = {
    getFloatTimeDomainData(a) {
      for (let i = 0; i < a.length; i++) a[i] = 0.08 * Math.sin((2 * Math.PI * f * i) / sampleRate);
    },
    getFloatFrequencyData(a) { a.fill(-100); },
  };
  return {
    playing: true,
    snapshot(out = {}) {
      return Object.assign(out, {
        hasCtx: true, state: 'running', time: 1.5, sampleRate, voice: this.playing, voiceId: 1,
        t0: 0.02, plan, kind: plan.kind, playing: this.playing, releasing: false, endTime: Infinity,
        limited: false, analyser, timeData, freqData: new Float32Array(4096), mic: false,
        micAnalyser: null, micFreqData: null, activeNodes: 3, activeSources: 1, voices: 1,
      });
    },
  };
}

function planOf(cfg) {
  const st = defaultInstrumentState();
  const cfgFull = { ...st, ...cfg, pp: { ...st.pp, ...(cfg.pp || {}) } };
  return buildPlan(cfgFull, { safeMax: 22800, continuous: false }).plan;
}

// ---------------------------------------------------------------- bridge

test('bridge.pull reads engine.snapshot only and fills state.live', () => {
  const plan = planOf({ pattern: 'tone', frequency: 440 });
  const bridge = new VisualizationBridge({ engine: fakeEngine(plan), env: stubEnv() });
  bridge.pull();
  const L = bridge.state.live;
  assert.strictEqual(L.voice, true);
  assert.strictEqual(L.analyser, true);
  assert.strictEqual(L.sampleRate, 48000);
  assert.ok(Math.abs(L.elapsed - 1.48) < 1e-12);
  assert.strictEqual(L.inst, 440);
  assert.ok(L.timeData[10] !== 0);
  assert.strictEqual(bridge.outputSpectrum()[0], -100);
  assert.strictEqual(bridge.micSpectrum(), null);
});

test('bridge without an engine: idle state, no spectra', () => {
  const bridge = new VisualizationBridge({ env: stubEnv() });
  bridge.pull();
  assert.strictEqual(bridge.state.live.hasCtx, false);
  assert.strictEqual(bridge.outputSpectrum(), null);
});

test('palette reads --osc-* tokens; a missing token warns loudly and falls back', (t) => {
  const tokens = {
    '--osc-surface-0': '#020a16', '--osc-border-strong': '#1b2a3b', '--osc-text': '#f3f6f9',
    '--osc-text-muted': '#94a9bd', '--osc-blue-trace': '#12a0f5', '--osc-magenta': '#f04ac4',
    '--osc-orange': 'rgb(252 173 56)', '--osc-red': 'rgb(247, 47, 53)',
  };
  const env = stubEnv();
  env.getComputedStyle = () => ({ getPropertyValue: (n) => tokens[n] || '' });
  const warn = t.mock.method(console, 'warn', () => {});
  const bridge = new VisualizationBridge({ env });
  assert.deepStrictEqual(bridge.readPalette(), []);
  assert.deepStrictEqual(bridge.palette.accent, [18, 160, 245]);
  assert.deepStrictEqual(bridge.palette.warn, [252, 173, 56]);
  assert.strictEqual(warn.mock.callCount(), 0);
  delete tokens['--osc-blue-trace'];
  assert.deepStrictEqual(bridge.readPalette(), ['--osc-blue-trace']);
  assert.deepStrictEqual(bridge.palette.accent, PALETTE_TOKENS.accent[2]);
  assert.strictEqual(warn.mock.callCount(), 1);
  assert.match(warn.mock.calls[0].arguments[0], /--osc-blue-trace/);
});

test('parseCssColor', () => {
  assert.deepStrictEqual(parseCssColor('#fff'), [255, 255, 255]);
  assert.deepStrictEqual(parseCssColor(' #12a0f5 '), [18, 160, 245]);
  assert.deepStrictEqual(parseCssColor('rgb(120 150 180 / 10%)'), [120, 150, 180]);
  assert.deepStrictEqual(parseCssColor('15 118 110'), [15, 118, 110]);
  assert.strictEqual(parseCssColor('blue'), null);
  assert.strictEqual(parseCssColor(''), null);
});

test('bridge.sync builds labels, path nodes and harmonic tables from instrument inputs', () => {
  const bridge = new VisualizationBridge({ env: stubEnv() });
  const app = createInstrument({ engine: null, bridge });
  app.sampleRate = 48000;
  app.setWaveform('square');
  app.setFrequency(5000);
  app.syncViz();
  const s = bridge.state;
  assert.strictEqual(s.labels.freq, '5.00 kHz');
  assert.strictEqual(s.harm.summaryTiny, '2/500 below Nyquist');
  assert.strictEqual(s.pathNodes[0].sub, 'Square · 5.00 kHz');
  assert.strictEqual(app.planFreqs[0], 5000);
});

// ---------------------------------------------------------------- p5 host and views

const fallbackPalette = () => Object.fromEntries(
  Object.entries(PALETTE_TOKENS).map(([k, v]) => [k, v[2]]));

function FakeP5(log) {
  return function P5(sketch) {
    const p = stubP5(log);
    sketch(p);
    p.setup();
    return p;
  };
}

test('p5 host renders every view (wide and compact, idle and playing) without errors', () => {
  const cases = [
    ['wave', { pattern: 'am' }], ['wave', { pattern: 'fm', frequency: 1000 }],
    ['wave', { pattern: 'siren' }], ['wave', { pattern: 'tone', frequency: 15500 }],
    ['path', { pattern: 'tone' }], ['path', { pattern: 'fm' }], ['path', { source: 'dual' }],
    ['interference', { source: 'dual' }], ['phase', { source: 'dual' }],
  ];
  for (const size of [[640, 300], [260, 120], [900, 160]]) {
    for (const [view, cfg] of cases) {
      for (const playing of [false, true]) {
        const log = [];
        const plan = planOf(cfg);
        const engine = fakeEngine(plan, { f: plan.freqs[0] });
        engine.playing = playing;
        const env = stubEnv();
        const bridge = new VisualizationBridge({ engine, env });
        bridge.palette = fallbackPalette();
        const app = createInstrument({ engine: null, bridge });
        app.sampleRate = 48000;
        if (cfg.source === 'dual') app.setMode('dual');
        if (cfg.pattern) app.setPattern(cfg.pattern);
        if (cfg.frequency) app.setFrequency(cfg.frequency);
        app.playing = playing;
        app.syncViz();
        const container = { getBoundingClientRect: () => ({ width: size[0], height: size[1] }) };
        const host = createP5Host({ P5: FakeP5(log), container, bridge, view, env });
        for (let i = 0; i < 3; i++) host.p5.draw();
        const drawn = log.filter(([k]) => k === 'text' || k === 'vertex' || k === 'rect').length;
        assert.ok(drawn > 5, `${view} ${JSON.stringify(cfg)} ${size} playing=${playing}: ${drawn}`);
        host.destroy();
        assert.strictEqual(bridge.p5, null);
      }
    }
  }
});

test('p5 host follows bridge.state.vizMode when no view is fixed', () => {
  const log = [];
  const bridge = new VisualizationBridge({ env: stubEnv() });
  bridge.palette = fallbackPalette();
  const app = createInstrument({ engine: null, bridge });
  app.syncViz();
  const container = { getBoundingClientRect: () => ({ width: 640, height: 300 }) };
  const host = createP5Host({ P5: FakeP5(log), container, bridge, env: stubEnv() });
  bridge.state.vizMode = 'path';
  host.p5.draw();
  assert.ok(log.some(([k, a]) => k === 'text' && a[0] === 'OSCILLATOR'));
  host.setView('wave');
  assert.strictEqual(host.view, 'wave');
});

test('pause toggle stops the loop (redraw on change) and reports it (V1 a7b7a23)', () => {
  const log = [];
  const bridge = new VisualizationBridge({ env: stubEnv() });
  bridge.palette = fallbackPalette();
  const app = createInstrument({ engine: null, bridge });
  const container = { getBoundingClientRect: () => ({ width: 640, height: 300 }) };
  const host = createP5Host({ P5: FakeP5(log), container, bridge, env: stubEnv() });
  app.syncViz();
  assert.strictEqual(bridge.looping, true);
  assert.strictEqual(bridge.sketchState, 'running');
  app.vizPaused = true;
  app.syncViz();
  assert.strictEqual(bridge.state.paused, true);
  assert.strictEqual(bridge.looping, false);
  assert.strictEqual(bridge.sketchState, 'paused (animation toggle: redraw on change)');
  assert.ok(log.some(([k]) => k === 'noLoop'));
  app.vizPaused = false;
  app.syncViz();
  assert.strictEqual(bridge.looping, true);
  host.destroy();
});

test('wave layout: the primary host reports side/compact; the caption follows it', () => {
  assert.strictEqual(waveCompact(300, 200), false);
  assert.strictEqual(waveCompact(299, 400), true);
  assert.strictEqual(waveCompact(640, 199), true);
  const bridge = new VisualizationBridge({ env: stubEnv() });
  bridge.palette = fallbackPalette();
  const app = createInstrument({ engine: null, bridge });
  const seen = [];
  bridge.onWaveLayout = (l) => { seen.push(l); app.waveLayout = l; };
  let size = [260, 120];
  const container = { getBoundingClientRect: () => ({ width: size[0], height: size[1] }) };
  const host = createP5Host({ P5: FakeP5([]), container, bridge, env: stubEnv() });
  assert.strictEqual(bridge.waveLayout, 'compact');
  assert.match(app.vizCaption, /Bottom: signal readout\.$/);
  size = [640, 300];
  host.resize();
  assert.strictEqual(app.waveLayout, 'side');
  assert.strictEqual(app.vizCaption,
    'Left: slowed visual model — visual representation, not real-time physical scale. '
    + 'Right: analyser output.');
  host.resize(); // same size: no new notification
  const second = createP5Host({
    P5: FakeP5([]), container: { getBoundingClientRect: () => ({ width: 100, height: 60 }) },
    bridge, env: stubEnv(), trackEnvelope: false,
  });
  assert.deepStrictEqual(seen, ['compact', 'side'], 'a secondary host does not report');
  second.destroy();
  host.destroy();
});

test('octave-C label placement: right of the line, left at the plot edge, no overlap', () => {
  const xOf = (f) => f / 10;
  const widthOf = (label) => label.length * 6;
  const out = layoutMarkerLabels(
    [{ label: 'C1', f: 100 }, { label: 'C2', f: 150 }, { label: 'C9', f: 2000 },
      { label: 'C10', f: 3150 }], xOf, widthOf, 320);
  assert.deepStrictEqual(out.map((m) => [m.label, m.lx, m.show]),
    [['C1', 12, true], ['C2', 17, false], ['C9', 202, true], ['C10', 295, true]]);
});

test('startVisualizer records why p5 could not start (V1 sketchState texts)', () => {
  const bridge = new VisualizationBridge({ env: stubEnv() });
  assert.strictEqual(startVisualizer(bridge, {}, { env: {} }), false);
  assert.strictEqual(bridge.sketchState, 'unavailable (p5.js not loaded)');
  const Boom = function Boom() { throw new Error('no canvas'); };
  assert.strictEqual(startVisualizer(bridge, {}, { P5: Boom, env: stubEnv() }), false);
  assert.strictEqual(bridge.sketchState, 'failed: no canvas');
});

// ---------------------------------------------------------------- uPlot data

test('spectrum columns keep a pure tone on its marker column', () => {
  const st = { spectrumScale: 'log', rangeMin: 20, nyquist: 22050, live: { sampleRate: 48000 } };
  const axis = spectrumAxis(st);
  assert.deepStrictEqual(axis, { log: true, fmin: 20, fmax: 24000 });
  const bins = 4096;
  const map = buildColumnMap(bins, 600, axis);
  assert.strictEqual(columnMapStale(map, bins, 600, axis), false);
  assert.strictEqual(columnMapStale(map, bins, 601, axis), true);
  const data = new Float32Array(bins).fill(-Infinity);
  const k = Math.round(1000 / (24000 / bins));
  data[k] = -12;
  const out = aggregateColumns(data, map);
  const col = out.indexOf(-12);
  assert.strictEqual(col, Math.floor(freqToUnit(1000, axis) * 600));
  assert.strictEqual(out[0], -140, '-Infinity becomes the floor');
  const xs = columnFrequencies(map);
  assert.ok(xs[col] > 990 && xs[col] < 1010, `column centre ${xs[col]}`);
  assert.ok(regionBands(axis).length > 5);
  assert.ok(thirdOctaveBands(axis).every((b) => b.f1 > b.f0));
  assert.deepStrictEqual(octaveCMarkers(440, axis).map((m) => m.label)[0], 'C1');
  assert.deepStrictEqual(spectrumTicks(axis)[0], { f: 20, label: '20' });
  const idle = { live: { voice: false, refFreq: 440 }, source: 'single', dual: {} };
  assert.deepStrictEqual(spectrumMarkers(idle, axis),
    { requested: 440, requestedB: null, nyquist: 24000, digitalLimit: 22800 });
});

test('motion trajectory samples planFreqAt with gaps', () => {
  const plan = planOf({ pattern: 'pulse', frequency: 1000 });
  const w = motionWindow(plan, 0);
  assert.deepStrictEqual(w, { finite: true, span: plan.dur, tStart: 0 });
  const tr = sampleTrajectory(plan, w.tStart, w.span, 100);
  assert.strictEqual(tr.f.length, 101);
  for (let i = 0; i < tr.f.length; i++) {
    const want = planFreqAt(plan, tr.t[i]);
    assert.ok(want == null ? Number.isNaN(tr.f[i]) : tr.f[i] === want);
  }
  const played = sampleTrajectory(plan, 0, w.span, 100, 0.2);
  assert.ok(Number.isNaN(played.f[100]));
  const fm = planOf({ pattern: 'fm', frequency: 1000, pp: { fm: { modFreq: 200, depthHz: 400 } } });
  assert.deepStrictEqual(motionAxis(fm, 24000), { lo: 400, hi: 2100 });
  assert.strictEqual(isFastFm(fm, 6, 600), true);
  assert.deepStrictEqual(motionWindow(fm, 10), { finite: false, span: 6, tStart: 4 });
});

test('harmonic axis', () => {
  const h = harmonicTable('square', 440, 24000);
  const ax = harmonicAxis(h, harmonicTable('sine', 0, 24000));
  assert.strictEqual(ax.fmin, 220);
  assert.ok(ax.fmax >= 24000 * 1.6);
  assert.strictEqual(harmonicAxis(harmonicTable('sine', 0, 24000)), null);
});
