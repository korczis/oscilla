// Primary analysis panel: the live spectrum (charts/spectrum-chart.js) in #osc-chart-spectrum on
// the main output analyser, with the requested-frequency marker, the Log/Linear segmented
// control (shell choice 'specScale') and the Max frequency select. The waveform view above it
// belongs to the visualization module, not to this controller.

import { createSpectrumChart } from '../charts/spectrum-chart.js';
import { activeValue, on, onUi } from './dom.js';

/** Max-frequency select value → Hz ('nyquist' → sampleRate / 2, else the number). */
export function maxFrequencyFor(value, sampleRate) {
  if (value === 'nyquist') return sampleRate > 0 ? sampleRate / 2 : null;
  const v = Number(value);
  if (!(v > 0)) return null;
  return sampleRate > 0 ? Math.min(v, sampleRate / 2) : v;
}

/** mount(rootEl, adapter) → { update(state), dispose(), chart } */
export function mount(rootEl, adapter) {
  const host = rootEl.querySelector('#osc-chart-spectrum');
  if (!host) return { update() {}, dispose() {}, chart: null };
  const maxSel = rootEl.querySelector('#osc-spec-max');
  const rate = () => (adapter.getSampleRate && adapter.getSampleRate()) || null;
  const chart = createSpectrumChart(host, {
    mode: 'single',
    scale: activeValue(rootEl, '[data-osc="analysis.freqScale"]') === 'linear' ? 'linear' : 'log',
    maxHz: maxFrequencyFor(maxSel ? maxSel.value : 20000, rate()) || 20000,
    getAnalyser: () => adapter.getAnalyser(),
    getRequested: () => adapter.requestedFrequency(),
  });
  let lastRate = rate();
  const applyMax = () => {
    const hz = maxFrequencyFor(maxSel ? maxSel.value : 20000, rate());
    if (hz) chart.setMaxHz(hz);
  };
  const offs = [
    on(maxSel, 'change', applyMax),
    onUi(rootEl, (d) => {
      if (d.kind === 'choice' && d.key === 'specScale') chart.setScale(d.value);
      else if (d.kind === 'theme') chart.refreshTheme();
    }),
  ];
  return {
    chart,
    update(state = {}) {
      if (state.scale) chart.setScale(state.scale);
      const r = rate();
      if (r !== lastRate) {
        lastRate = r;
        applyMax();
      }
    },
    dispose() {
      offs.forEach((f) => f());
      chart.dispose();
    },
  };
}
