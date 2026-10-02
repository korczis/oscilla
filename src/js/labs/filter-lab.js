// Filter Lab controller: owns the filter configuration and the BiquadFilter stages built from
// it (audio/filters.js createFilterStage), binds the shell's type radios (shell choice
// 'filterType'), enable switch, cutoff/Q/gain fields and sliders, and the response chart
// (charts/filter-chart.js, drag cutoff/Q on the graph).
//
// Engine integration: lab.createInsert is an insert factory `(ctx, track, source) => stage`.
// Every stage it creates follows the lab's configuration; the chart reads the most recent live
// stage's getResponse() (the browser's own getFrequencyResponse). Before the engine has
// inserted a stage, the chart reads an unconnected probe stage on the engine's context, or —
// when no context exists yet — on a 1-frame OfflineAudioContext at the engine's sample rate
// (48 kHz assumed and labelled until the real rate is known). It never plays audio.

import { createFilterStage, normalizeFilter, FILTER_TYPES, usesGain } from '../audio/filters.js';
import { createFilterChart } from '../charts/filter-chart.js';
import {
  formatHz,
  parseFrequency,
  parseNumber,
  logSliderToValue,
  valueToLogSlider,
  clamp,
} from '../charts/axes.js';
import { FILTER_DRAG } from '../charts/drag-math.js';
import { on, onUi, bindSwitch, setSlider, setField, activeValue, onAdapterChange } from './dom.js';

export const FILTER_DEFAULTS = Object.freeze({
  type: 'lowpass',
  frequency: 2500,
  Q: Math.SQRT1_2,
  gain: 0,
  enabled: true,
});
const PREVIEW_RATE = 48000;

/** Q display: 0.707, 1.5, 12. */
export function formatQ(q) {
  if (!Number.isFinite(q)) return '—';
  return q < 1 ? q.toFixed(3) : q < 10 ? q.toFixed(2).replace(/0$/, '') : q.toFixed(1);
}

/** mount(rootEl, adapter) → lab (see the return value below). */
export function mount(rootEl, adapter) {
  const q = (sel) => rootEl.querySelector(sel);
  const host = q('#osc-chart-filter');
  const el = {
    cutoffText: q('#osc-filter-cutoff-value'),
    cutoff: q('#osc-filter-cutoff'),
    qText: q('#osc-filter-q-value'),
    q: q('#osc-filter-q'),
    gainGroup: q('[data-osc="filter.gainGroup"]'),
    gain: q('#osc-filter-gain'),
  };
  const listeners = new Set();
  const stages = new Set();
  let preview = null; // { ctx, stage, offline }
  let lastLive = null;

  const domType = activeValue(rootEl, '[data-osc="filter.type"]');
  let config = {
    ...FILTER_DEFAULTS,
    type: FILTER_TYPES.includes(domType) ? domType : FILTER_DEFAULTS.type,
  };

  function sampleRate() {
    const ctx = adapter.getContext && adapter.getContext();
    return (ctx && ctx.sampleRate) || (adapter.getSampleRate && adapter.getSampleRate())
      || PREVIEW_RATE;
  }

  function ensurePreview() {
    const ctx = adapter.getContext && adapter.getContext();
    if (ctx) {
      if (!preview || preview.ctx !== ctx) {
        if (preview) preview.stage.dispose();
        preview = { ctx, stage: createFilterStage(ctx, config), offline: false };
      }
      return preview.stage;
    }
    if (!preview && typeof OfflineAudioContext === 'function') {
      const known = adapter.getSampleRate && adapter.getSampleRate();
      const off = new OfflineAudioContext(1, 1, known || PREVIEW_RATE);
      preview = { ctx: off, stage: createFilterStage(off, config), offline: true, assumed: !known };
    }
    return preview ? preview.stage : null;
  }

  function responseStage() {
    for (const s of stages) lastLive = s;
    return lastLive && stages.has(lastLive) ? lastLive : ensurePreview();
  }

  const chart = host
    ? createFilterChart(host, {
      getResponse: (freqs, out) => {
        const s = responseStage();
        if (!s) {
          out.magDb.fill(NaN);
          return { magDb: out.magDb, enabled: config.enabled };
        }
        return s.getResponse(freqs, out);
      },
      onChange: (patch) => set(patch),
      getNote: () => (preview && preview.assumed && !stages.size ? 'model @ 48 kHz' : null),
    })
    : null;

  function syncInputs() {
    setField(el.cutoffText, formatHz(config.frequency));
    setSlider(el.cutoff, valueToLogSlider(config.frequency, FILTER_DRAG.minHz, FILTER_DRAG.maxHz),
      formatHz(config.frequency));
    setField(el.qText, formatQ(config.Q));
    setSlider(el.q, valueToLogSlider(config.Q, FILTER_DRAG.qMin, FILTER_DRAG.qMax),
      formatQ(config.Q));
    if (el.gainGroup) el.gainGroup.hidden = !usesGain(config.type);
    setSlider(el.gain, config.gain, `${config.gain.toFixed(1)} dB`);
  }

  function set(patch) {
    const next = normalizeFilter({ ...config, ...patch }, sampleRate());
    next.Q = clamp(next.Q, FILTER_DRAG.qMin, FILTER_DRAG.qMax);
    next.frequency = clamp(next.frequency, FILTER_DRAG.minHz, Math.min(FILTER_DRAG.maxHz,
      sampleRate() * 0.475));
    config = next;
    for (const s of stages) s.update(config);
    if (preview) preview.stage.update(config);
    syncInputs();
    if (chart) chart.update(config);
    for (const fn of listeners) fn({ ...config });
    return { ...config };
  }

  const enable = bindSwitch(q('#osc-filter-enable'), (v) => set({ enabled: v }));
  config.enabled = q('#osc-filter-enable') ? enable.value : true;

  const offs = [
    enable.dispose,
    on(el.cutoffText, 'change', () => {
      const f = parseFrequency(el.cutoffText.value);
      if (f > 0) set({ frequency: f });
      else setField(el.cutoffText, formatHz(config.frequency));
    }),
    on(el.cutoff, 'input', () => set({
      frequency: logSliderToValue(Number(el.cutoff.value), FILTER_DRAG.minHz, FILTER_DRAG.maxHz),
    })),
    on(el.qText, 'change', () => {
      const v = parseNumber(el.qText.value);
      if (v > 0) set({ Q: v });
      else setField(el.qText, formatQ(config.Q));
    }),
    on(el.q, 'input', () => set({
      Q: logSliderToValue(Number(el.q.value), FILTER_DRAG.qMin, FILTER_DRAG.qMax),
    })),
    on(el.gain, 'input', () => set({ gain: Number(el.gain.value) })),
    onUi(rootEl, (d) => {
      if (d.kind === 'choice' && d.key === 'filterType' && FILTER_TYPES.includes(d.value)) {
        set({ type: d.value });
      } else if (d.kind === 'theme' && chart) chart.refreshTheme();
    }),
    onAdapterChange(adapter, () => {
      // A context appeared or changed: move the probe onto it so the response uses its rate.
      if (preview && preview.offline && adapter.getContext && adapter.getContext()) {
        preview.stage.dispose();
        preview = null;
      }
      set({});
    }),
  ];

  set({});

  return {
    chart,
    get config() {
      return { ...config };
    },
    /** True while the chart reads the 48 kHz offline probe (no engine context yet). */
    get previewOnly() {
      return !!(preview && preview.offline && !stages.size);
    },
    /** Insert factory for the engine: (ctx, track, source) => stage. */
    createInsert: (ctx, track) => {
      const stage = createFilterStage(ctx, config, { track: track || ((n) => n) });
      const dispose = stage.dispose;
      stage.dispose = () => {
        stages.delete(stage);
        dispose();
        if (chart) chart.update(config);
      };
      stages.add(stage);
      lastLive = stage;
      if (chart) chart.update(config);
      return stage;
    },
    /** The stage whose response the chart shows (live insert, or the probe). */
    get stage() {
      return responseStage();
    },
    set,
    onChange(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    update(state = {}) {
      const patch = {};
      for (const k of ['type', 'frequency', 'Q', 'gain', 'enabled']) {
        if (state[k] != null) patch[k] = state[k];
      }
      if (state.enabled != null) enable.set(!!state.enabled, true);
      if (state.type && state.type !== config.type) {
        // The radios are Alpine state: click the radio so the shell and this lab stay in step.
        const radio = rootEl.querySelector(`[data-osc="filter.type"][data-value="${state.type}"]`);
        if (radio) radio.click();
      }
      set(patch);
    },
    dispose() {
      offs.forEach((f) => f());
      if (chart) chart.dispose();
      if (preview) preview.stage.dispose();
      preview = null;
      listeners.clear();
    },
  };
}
