// Spectrogram panel controller: mounts a spectrogram view (spectrogram-view.js) into
// #osc-chart-spectrogram on the main output analyser and binds the shell's Freeze switch,
// time-span select and Log/Linear select.

import { createSpectrogramView } from './spectrogram-view.js';
import { bindSwitch, on, onUi } from '../labs/dom.js';

/**
 * mount(rootEl, adapter) → { update(state), dispose(), view }
 * adapter: { getAnalyser() } (see labs/index.js for the full interface)
 */
export function mount(rootEl, adapter) {
  const host = rootEl.querySelector('#osc-chart-spectrogram');
  if (!host) return { update() {}, dispose() {}, view: null };
  const spanSel = rootEl.querySelector('#osc-spg-span-select');
  const scaleSel = rootEl.querySelector('#osc-spg-scale-select');
  const view = createSpectrogramView(host, {
    getAnalyser: () => adapter.getAnalyser(),
    timeSpanS: spanSel ? Number(spanSel.value) || 10 : 10,
    scale: scaleSel && scaleSel.value === 'linear' ? 'linear' : 'log',
  });
  const offs = [];
  const freeze = bindSwitch(rootEl.querySelector('#osc-spg-freeze'), (v) => view.setFreeze(v));
  offs.push(freeze.dispose);
  if (spanSel) offs.push(on(spanSel, 'change', () => view.setTimeSpan(Number(spanSel.value))));
  if (scaleSel) offs.push(on(scaleSel, 'change', () => view.setScale(scaleSel.value)));
  offs.push(onUi(rootEl, (d) => {
    if (d.kind === 'theme') view.refreshTheme();
  }));
  return {
    view,
    update(state = {}) {
      if (state.freeze != null) freeze.set(!!state.freeze, true);
    },
    dispose() {
      offs.forEach((f) => f());
      view.dispose();
    },
  };
}
