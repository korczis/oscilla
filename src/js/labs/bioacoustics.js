// Bioacoustics controller: hearing-range and call-example bars (charts/bio-chart.js) from the
// cited data, switched by the shell's tabs (shell tab 'bio'), with the disclaimer text taken
// from the data module. Choosing a row calls options.onSelectRange(minHz, maxHz, entry) and
// dispatches a bubbling `osc:range` event { minHz, maxHz, id, label } on the panel, so the
// integration can set the explorer range without coupling to this module.

import { DISCLAIMER, HEARING_RANGES, CALL_EXAMPLES } from '../data/bioacoustics.js';
import { createBioChart, citation, rangeLabel } from '../charts/bio-chart.js';
import { onUi, setText, activeValue } from './dom.js';

/**
 * Fill the keyboard-reachable sources list (<ol id="osc-bio-source-list">) with one item per
 * bar of the dataset: label and range, basis, citation (its DOI/URL as a link).
 */
export function renderSources(list, dataset) {
  if (!list) return;
  const entries = dataset === 'calls' ? CALL_EXAMPLES : HEARING_RANGES;
  list.replaceChildren();
  for (const e of entries) {
    const li = document.createElement('li');
    const head = document.createElement('strong');
    head.textContent = `${e.label}: ${rangeLabel(e)}`;
    li.append(head);
    if (e.basis) li.append(document.createElement('br'), e.basis);
    const src = e.source;
    if (src) {
      li.append(document.createElement('br'));
      const text = citation(src);
      const url = src.doi_or_url || '';
      if (/^https?:\/\//.test(url) && text.endsWith(url)) {
        li.append(text.slice(0, text.length - url.length));
        const a = document.createElement('a');
        a.href = url;
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        a.textContent = url;
        li.append(a);
      } else {
        li.append(text);
      }
    }
    list.append(li);
  }
}

/** mount(rootEl, adapter, { onSelectRange }) → { chart, selected, update, dispose } */
export function mount(rootEl, adapter, options = {}) {
  const host = rootEl.querySelector('#osc-chart-bio');
  const note = rootEl.querySelector('.osc-bio-note');
  const sources = rootEl.querySelector('#osc-bio-source-list');
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
  renderSources(sources, initialTab);
  const off = onUi(rootEl, (d) => {
    if (d.kind === 'tab' && d.key === 'bio') renderSources(sources, d.value);
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
      if (state.dataset) renderSources(sources, state.dataset);
      if (chart && state.dataset) chart.setDataset(state.dataset);
    },
    dispose() {
      off();
      if (chart) chart.dispose();
    },
  };
}
