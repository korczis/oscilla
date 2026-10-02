// Additive synthesis controller: owns the partials (audio/additive.js), the preset select, the
// enable switch, the selected harmonic's number/gain/phase fields, and the harmonic bars
// (charts/additive-chart.js). The bars are visualCoefficients() of the same table and scale
// that periodicWave(ctx) hands to createPeriodicWave, so what is drawn is what plays.

import {
  harmonicSeries,
  customSeries,
  setHarmonic,
  buildPeriodicWave,
  visualCoefficients,
  gainToDb,
  OFF_DB,
} from '../audio/additive.js';
import { createAdditiveChart } from '../charts/additive-chart.js';
import { parseNumber, clamp } from '../charts/axes.js';
import { on, onUi, bindSwitch, setSlider, setField } from './dom.js';

export const HARMONIC_COUNT = 10;
const PRESET_SHAPES = { sine: 'sine', square: 'square', saw: 'sawtooth', triangle: 'triangle' };
const GAIN_MIN_DB = -60;

/**
 * Default "Custom" table: a steep roll-off, harmonic n at −85·log10(n) dB (≈ 1/n^4.25, the
 * shape of the reference's custom bars), all in phase. Only a starting point: the bars always
 * show the table that plays.
 */
export function defaultCustomPartials(count = HARMONIC_COUNT) {
  const db = [];
  for (let n = 1; n <= count; n++) db.push(-85 * Math.log10(n));
  return customSeries(db);
}

/** Partials for a preset select value ('custom' keeps the current table). */
export function presetPartials(value, current, count = HARMONIC_COUNT) {
  const shape = PRESET_SHAPES[value];
  return shape ? harmonicSeries(shape, count) : current.map((p) => ({ ...p }));
}

function formatGainDb(db) {
  if (!Number.isFinite(db) || db <= OFF_DB) return 'off';
  return `${db.toFixed(1)} dB`;
}

/** mount(rootEl, adapter) → lab (see the return value). */
export function mount(rootEl, adapter) {
  const q = (sel) => rootEl.querySelector(sel);
  const el = {
    preset: q('#osc-add-preset'),
    harmonic: q('#osc-add-harmonic'),
    gainText: q('#osc-add-gain-value'),
    gain: q('#osc-add-gain'),
    phase: q('#osc-add-phase'),
  };
  const listeners = new Set();
  let partials = el.preset && PRESET_SHAPES[el.preset.value]
    ? presetPartials(el.preset.value, [])
    : defaultCustomPartials();
  let selected = 1;
  const host = q('#osc-chart-additive');
  const chart = host
    ? createAdditiveChart(host, {
      count: HARMONIC_COUNT,
      onSelect: (n) => select(n),
      onAdjust: (n, delta) => {
        const cur = gainToDb(partials[n - 1].gain);
        const base = Number.isFinite(cur) ? cur : GAIN_MIN_DB - 1;
        setGain(n, clamp(base + delta, GAIN_MIN_DB - 1, 0));
      },
    })
    : null;

  function scale() {
    return buildPeriodicWave(null, partials).scale;
  }

  function coefficients() {
    const ctx = adapter.getContext && adapter.getContext();
    return visualCoefficients(partials, {
      scale: scale(),
      fundamentalHz: adapter.requestedFrequency ? adapter.requestedFrequency() : null,
      sampleRate: ctx ? ctx.sampleRate : (adapter.getSampleRate && adapter.getSampleRate()),
    });
  }

  function render() {
    const bars = coefficients();
    if (chart) chart.setBars(bars, selected);
    const p = partials[selected - 1];
    setField(el.harmonic, String(selected));
    // The fields edit the table entry (before the peak normalisation the bars include).
    const db = gainToDb(p.gain);
    setField(el.gainText, formatGainDb(db));
    setSlider(el.gain, Number.isFinite(db) ? clamp(db, GAIN_MIN_DB, 0) : GAIN_MIN_DB,
      formatGainDb(db));
    const deg = Math.round(((((p.phase * 180) / Math.PI) % 360) + 360) % 360);
    setField(el.phase, `${deg}°`);
  }

  function changed() {
    render();
    for (const fn of listeners) fn(partials.map((p) => ({ ...p })), enable.value);
  }

  function markCustom() {
    if (el.preset && el.preset.value !== 'custom') el.preset.value = 'custom';
  }

  function select(n) {
    selected = clamp(Math.round(n) || 1, 1, HARMONIC_COUNT);
    render();
  }

  function setGain(n, db) {
    partials = setHarmonic(partials, n, { gainDb: db < GAIN_MIN_DB ? -Infinity : db });
    markCustom();
    changed();
  }

  const enable = bindSwitch(q('#osc-add-enable'), () => changed());
  const offs = [
    enable.dispose,
    on(el.preset, 'change', () => {
      partials = presetPartials(el.preset.value, partials);
      changed();
    }),
    on(el.harmonic, 'change', () => select(Number(el.harmonic.value))),
    on(el.gain, 'input', () => setGain(selected, Number(el.gain.value))),
    on(el.gainText, 'change', () => {
      const v = parseNumber(el.gainText.value);
      if (v != null) setGain(selected, clamp(v, GAIN_MIN_DB - 1, 0));
      else render();
    }),
    on(el.phase, 'change', () => {
      const v = parseNumber(el.phase.value);
      if (v != null) {
        partials = setHarmonic(partials, selected, { phaseDeg: ((v % 360) + 360) % 360 });
        markCustom();
        changed();
      } else render();
    }),
    onUi(rootEl, (d) => {
      if (d.kind === 'theme' && chart) chart.refreshTheme();
    }),
  ];
  rootEl.querySelectorAll('[data-osc="additive.harmonicStep"]').forEach((b) => {
    offs.push(on(b, 'click', () => select(selected + Number(b.dataset.dir || 0))));
  });

  render();

  return {
    chart,
    get partials() {
      return partials.map((p) => ({ ...p }));
    },
    get selected() {
      return selected;
    },
    get enabled() {
      return q('#osc-add-enable') ? enable.value : true;
    },
    /** The bars as drawn: visualCoefficients() of the table that plays. */
    coefficients,
    /**
     * PeriodicWave for ctx (disableNormalization, peak-normalised table), or null when the
     * synthesis is disabled or the table is silent.
     */
    periodicWave(ctx) {
      if (!this.enabled) return null;
      return buildPeriodicWave(ctx, partials).wave;
    },
    select,
    setPartials(next) {
      partials = next.map((p) => ({ ...p }));
      markCustom();
      changed();
    },
    onChange(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    update(state = {}) {
      if (state.partials) this.setPartials(state.partials);
      if (state.enabled != null) enable.set(!!state.enabled, true);
      // The fundamental (and thus which harmonics are below Nyquist) may have changed.
      render();
    },
    dispose() {
      offs.forEach((f) => f());
      if (chart) chart.dispose();
      listeners.clear();
    },
  };
}
