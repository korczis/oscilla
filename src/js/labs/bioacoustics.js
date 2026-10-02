// Bioacoustics controller: hearing-range and call-example bars (charts/bio-chart.js) from the
// cited data, switched by the shell's tabs (shell tab 'bio'), with the disclaimer text taken
// from the data module. Choosing a row calls options.onSelectRange(minHz, maxHz, entry) and
// dispatches a bubbling `osc:range` event { minHz, maxHz, id, label } on the panel, so the
// integration can set the explorer range without coupling to this module.

import { DISCLAIMER } from '../data/bioacoustics.js';
import { createBioChart } from '../charts/bio-chart.js';
import { onUi, setText, activeValue } from './dom.js';

/** mount(rootEl, adapter, { onSelectRange }) → { chart, selected, update, dispose } */
export function mount(rootEl, adapter, options = {}) {
  const host = rootEl.querySelector('#osc-chart-bio');
  const note = rootEl.querySelector('.osc-bio-note');
  setText(note, DISCLAIMER);
  let selected = null;
  const initialTab = activeValue(rootEl, '[data-osc="bio.tab"]') === 'calls' ? 'calls' : 'ranges';
  const chart = host
    ? createBioChart(host, {
      dataset: initialTab,
      onSelectRange: (minHz, maxHz, entry) => {
        selected = { minHz, maxHz, id: entry.id, label: entry.label };
        if (options.onSelectRange) options.onSelectRange(minHz, maxHz, entry);
        const detail = { ...selected };
        host.dispatchEvent(new CustomEvent('osc:range', { bubbles: true, detail }));
      },
    })
    : null;
  const off = onUi(rootEl, (d) => {
    if (!chart) return;
    if (d.kind === 'tab' && d.key === 'bio') chart.setDataset(d.value);
    else if (d.kind === 'theme') chart.refreshTheme();
  });
  return {
    chart,
    get selected() {
      return selected ? { ...selected } : null;
    },
    update(state = {}) {
      if (chart && state.dataset) chart.setDataset(state.dataset);
    },
    dispose() {
      off();
      if (chart) chart.dispose();
    },
  };
}
