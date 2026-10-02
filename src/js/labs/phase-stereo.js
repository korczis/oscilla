// Phase & Stereo controller: binds the Phase/Lissajous/Stereo tabs (shell tab 'phase'), the
// stereo fields (A/B frequency, pan, Mono/Stereo output = shell choice 'stereoRoute'), the
// p5 phase/Lissajous view and the correlation meter.
//
// Data source, in this order:
//   live  — adapter.getStereoRouter() returns the engine's stereo router (audio/stereo.js) and
//           its L/R analysers carry signal: waves, Lissajous and correlation come from them
//           (correlation.js; labelled "estimated" because two analysers are read one after
//           the other);
//   model — otherwise the analytic A/B of the configured frequencies and phase offset,
//           labelled "model"; the correlation reads "—" (nothing is playing).
// The controller never creates audio nodes; the engine builds the router from lab.config.

import { createPhaseStereoView } from '../charts/phase-view.js';
import {
  modelWaves,
  modelLissajous,
  lissajousCycles,
  risingZeroCrossing,
  commonPeak,
} from '../charts/phase-model.js';
import { createCorrelationMeter } from '../analysis/correlation.js';
import { parseNumber, clamp } from '../charts/axes.js';
import { onFrame } from '../charts/frame-loop.js';
import { on, onUi, setText, setAttr, activeValue } from './dom.js';

export const PHASE_DEFAULTS = Object.freeze({
  freqA: 440,
  freqB: 442,
  phaseDeg: 45,
  pan: 0,
  route: 'mono',
});

/** Correlation display: value → { text, meterPct, valueText }; null → unavailable. */
export function correlationDisplay(value) {
  if (value == null || !Number.isFinite(value)) {
    return { text: '—', meterPct: 0, valueText: 'Unavailable (nothing playing)' };
  }
  const v = clamp(value, -1, 1);
  return {
    text: v.toFixed(2),
    meterPct: ((v + 1) / 2) * 100,
    valueText: `${v.toFixed(2)} (estimated from the L/R analysers)`,
  };
}

/** Stereo router config (audio/stereo.js) for the lab's Mono/Stereo output and pan. */
export function routerConfig(cfg) {
  return cfg.route === 'stereo'
    ? { mode: 'split', panA: -1, panB: 1 }
    : { mode: 'mono', panA: cfg.pan, panB: cfg.pan };
}

/** mount(rootEl, adapter) → lab (see the return value). */
export function mount(rootEl, adapter) {
  const q = (sel) => rootEl.querySelector(sel);
  const el = {
    fa: q('#osc-stereo-fa'),
    fb: q('#osc-stereo-fb'),
    pan: q('#osc-stereo-pan'),
    offset: q('[data-osc="phase.offset"]'), // optional (requested markup), degrees
    value: q('#osc-corr-value'),
    meter: q('#osc-corr-meter'),
  };
  const listeners = new Set();
  const cfg = {
    ...PHASE_DEFAULTS,
    freqA: parseNumber(el.fa && el.fa.value) || PHASE_DEFAULTS.freqA,
    freqB: parseNumber(el.fb && el.fb.value) || PHASE_DEFAULTS.freqB,
    pan: el.pan ? Number(el.pan.value) || 0 : 0,
    route: activeValue(rootEl, '[data-osc="stereo.route"]') || PHASE_DEFAULTS.route,
  };
  const offset0 = el.offset ? parseNumber(el.offset.value) : null;
  if (offset0 != null) cfg.phaseDeg = offset0;
  let tab = activeValue(rootEl, '[data-osc="phase.tab"]') || 'phase';
  const meter = createCorrelationMeter({ timeConstantS: 0.3 });
  const t0 = performance.now();
  const model = { waves: { a: null, b: null }, liss: { x: null, y: null } };
  let lastCorr = undefined;
  let source = 'model';

  function showCorrelation(value) {
    if (value === lastCorr) return;
    lastCorr = value;
    const d = correlationDisplay(value);
    setText(el.value, d.text);
    setAttr(el.value, 'title', value == null ? 'Unavailable' : 'Estimated');
    if (el.meter) {
      el.meter.style.setProperty('--osc-meter-value', `${d.meterPct.toFixed(1)}%`);
      setAttr(el.meter, 'aria-valuenow', value == null ? 0 : value.toFixed(2));
      setAttr(el.meter, 'aria-valuetext', d.valueText);
    }
  }

  function liveData(now) {
    const router = adapter.getStereoRouter ? adapter.getStereoRouter() : null;
    if (!router || typeof router.readTimeDomain !== 'function') return null;
    const { left, right } = router.readTimeDomain();
    const corr = meter.update(left, right, now);
    if (!corr) return null; // silence: fall back to the model, correlation unavailable
    const sr = (router.analyserL && router.analyserL.context.sampleRate) || 48000;
    const peak = commonPeak(left, right) || 1;
    const want = Math.max(16, Math.round((2 * sr) / Math.max(1, cfg.freqA)));
    const start = risingZeroCrossing(left, Math.max(1, left.length - want));
    const length = Math.min(want, left.length - start);
    return {
      label: 'live L/R · correlation estimated',
      corr: corr.value,
      waves: { a: left, b: right, start, length, scale: 1 / peak },
      liss: { x: left, y: right, start: 0, length: left.length, scale: 1 / peak },
    };
  }

  function getData() {
    const now = performance.now();
    const live = liveData(now);
    if (live) {
      source = 'live';
      showCorrelation(Math.round(live.corr * 100) / 100);
      return live;
    }
    source = 'model';
    showCorrelation(null);
    const elapsedS = (now - t0) / 1000;
    const w = modelWaves({ fA: cfg.freqA, fB: cfg.freqB, phaseDeg: cfg.phaseDeg, elapsedS,
      points: 240, cycles: 2 }, model.waves);
    const l = modelLissajous({ fA: cfg.freqA, fB: cfg.freqB, phaseDeg: cfg.phaseDeg, elapsedS,
      points: 480, cycles: lissajousCycles(cfg.freqA, cfg.freqB) }, model.liss);
    model.waves = w;
    model.liss = l;
    return {
      label: 'model',
      waves: { a: w.a, b: w.b, start: 0, length: w.a.length, scale: 1 },
      liss: { x: l.x, y: l.y, start: 0, length: l.x.length, scale: 1 },
    };
  }

  // Data (and the correlation readout) update every frame even while the Stereo tab hides the
  // view; subscribed before the view so the view draws this frame's data.
  let current = null;
  const stopFrames = onFrame(() => {
    current = getData();
  });
  const host = q('#osc-chart-phase');
  const view = host
    ? createPhaseStereoView(host, {
      getData: () => current || getData(),
      getMode: () => (tab === 'lissajous' ? 'lissajous' : 'phase'),
    })
    : null;

  function emit() {
    for (const fn of listeners) fn({ ...cfg });
  }

  function setCfg(patch) {
    Object.assign(cfg, patch);
    cfg.freqA = clamp(cfg.freqA, 1, 100000);
    cfg.freqB = clamp(cfg.freqB, 1, 100000);
    cfg.pan = clamp(cfg.pan, -1, 1);
    if (el.pan) {
      setAttr(el.pan, 'aria-valuetext', cfg.pan === 0 ? 'Centre'
        : `${Math.round(Math.abs(cfg.pan) * 100)}% ${cfg.pan < 0 ? 'left' : 'right'}`);
    }
    emit();
  }

  const offs = [
    stopFrames,
    on(el.fa, 'change', () => {
      const v = parseNumber(el.fa.value);
      if (v > 0) setCfg({ freqA: v });
    }),
    on(el.fb, 'change', () => {
      const v = parseNumber(el.fb.value);
      if (v > 0) setCfg({ freqB: v });
    }),
    on(el.pan, 'input', () => setCfg({ pan: Number(el.pan.value) })),
    on(el.offset, 'change', () => {
      const v = parseNumber(el.offset.value);
      if (v != null) setCfg({ phaseDeg: ((v % 360) + 360) % 360 });
    }),
    onUi(rootEl, (d) => {
      if (d.kind === 'tab' && d.key === 'phase') tab = d.value;
      else if (d.kind === 'choice' && d.key === 'stereoRoute') setCfg({ route: d.value });
      else if (d.kind === 'theme' && view) view.refreshTheme();
    }),
  ];
  showCorrelation(null);

  return {
    view,
    get config() {
      return { ...cfg };
    },
    get routerConfig() {
      return routerConfig(cfg);
    },
    get source() {
      return source;
    },
    get tab() {
      return tab;
    },
    set: setCfg,
    onChange(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    update(state = {}) {
      const patch = {};
      for (const k of ['freqA', 'freqB', 'phaseDeg', 'pan', 'route']) {
        if (state[k] != null) patch[k] = state[k];
      }
      if (Object.keys(patch).length) setCfg(patch);
    },
    dispose() {
      offs.forEach((f) => f());
      if (view) view.dispose();
      listeners.clear();
    },
  };
}
