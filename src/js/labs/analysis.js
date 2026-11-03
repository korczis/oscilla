// Primary analysis panel: the live spectrum (charts/spectrum-chart.js) in #osc-chart-spectrum on
// the main output analyser, with the requested-frequency marker, the Log/Linear segmented
// control (shell choice 'specScale') and the Max frequency select. The waveform view above it
// belongs to the visualization module, not to this controller.

import { createSpectrumChart } from '../charts/spectrum-chart.js';
import { formatHz } from '../charts/axes.js';
import { activeValue, on, onUi, onAdapterChange, setText } from './dom.js';

/** Max-frequency select value → Hz ('nyquist' → sampleRate / 2, else the number). */
export function maxFrequencyFor(value, sampleRate) {
  if (value === 'nyquist') return sampleRate > 0 ? sampleRate / 2 : null;
  const v = Number(value);
  if (!(v > 0)) return null;
  return sampleRate > 0 ? Math.min(v, sampleRate / 2) : v;
}

/** The Nyquist option's text: its value once a rate is known, pending before audio. */
export function nyquistOptionLabel(sampleRate) {
  return sampleRate > 0 ? `Max: Nyquist (${formatHz(sampleRate / 2, 4)})`
    : 'Max: Nyquist (pending audio)';
}

/**
 * mount(rootEl, adapter, opts) → { update(state), dispose(), chart }
 * opts.createChart replaces createSpectrumChart (the unit tests inject a chart double).
 */
export function mount(rootEl, adapter, opts = {}) {
  const host = rootEl.querySelector('#osc-chart-spectrum');
  if (!host) return { update() {}, dispose() {}, chart: null };
  const maxSel = rootEl.querySelector('#osc-spec-max');
  const nyquistOpt = maxSel && maxSel.querySelector('option[value="nyquist"]');
  const rate = () => (adapter.getSampleRate && adapter.getSampleRate()) || null;
  const chart = (opts.createChart || createSpectrumChart)(host, {
    mode: 'single',
    scale: activeValue(rootEl, '[data-osc="analysis.freqScale"]') === 'linear' ? 'linear' : 'log',
    maxHz: maxFrequencyFor(maxSel ? maxSel.value : 20000, rate()) || 20000,
    getAnalyser: () => adapter.getAnalyser(),
    getRequested: () => adapter.requestedFrequency(),
    getA4: () => (adapter.getA4 ? adapter.getA4() : 440),
  });
  let lastRate = rate();
  setText(nyquistOpt, nyquistOptionLabel(lastRate));
  const applyMax = () => {
    const hz = maxFrequencyFor(maxSel ? maxSel.value : 20000, rate());
    if (hz) chart.setMaxHz(hz);
  };
  // T006: a Max chosen before audio (Nyquist) is re-resolved when the engine's rate becomes
  // known or changes; the adapter notifies on every cmp.sampleRate change (main.js).
  const followRate = () => {
    const r = rate();
    if (r === lastRate) return;
    lastRate = r;
    setText(nyquistOpt, nyquistOptionLabel(r));
    applyMax();
  };
  const offs = [
    on(maxSel, 'change', applyMax),
    onAdapterChange(adapter, followRate),
    onUi(rootEl, (d) => {
      if (d.kind === 'choice' && d.key === 'specScale') chart.setScale(d.value);
      else if (d.kind === 'theme') chart.refreshTheme();
    }),
  ];
  return {
    chart,
    update(state = {}) {
      if (state.scale) chart.setScale(state.scale);
      followRate();
    },
    dispose() {
      offs.forEach((f) => f());
      chart.dispose();
    },
  };
}
