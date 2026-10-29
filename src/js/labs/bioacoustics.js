// Bioacoustics controller: hearing-range and call-example bars (charts/bio-chart.js) from the
// cited data, switched by the shell's tabs (shell tab 'bio'), with the disclaimer text taken
// from the data module. Choosing a row calls options.onSelectRange(minHz, maxHz, entry) and
// dispatches a bubbling `osc:range` event { minHz, maxHz, id, label } on the panel, so the
// integration can set the explorer range without coupling to this module.

import { DISCLAIMER, HEARING_RANGES, CALL_EXAMPLES } from '../data/bioacoustics.js';
import { createBioChart, citation, rangeLabel } from '../charts/bio-chart.js';
import { onUi, setText, activeValue } from './dom.js';

/** What a new-tab link says to everyone, screen readers included (the About links' wording). */
export const NEW_TAB_HINT = '(opens in a new tab)';

/**
 * The readable text of a citation link (UX link audit B10): the resolver and the identifier
 * instead of the raw URL, "PDF" when the link is a file, and the new-tab hint. The URL itself
 * stays the href (and the title, for a pointer).
 *   https://doi.org/10.1121/1.1596173      -> "DOI 10.1121/1.1596173 (opens in a new tab)"
 *   https://pubmed.ncbi.nlm.nih.gov/17203911/ -> "PubMed 17203911 (opens in a new tab)"
 */
export function sourceLinkText(url) {
  let u;
  try {
    u = new URL(url);
  } catch (e) {
    return `${url} ${NEW_TAB_HINT}`;
  }
  const host = u.hostname.replace(/^www\./, '');
  const path = decodeURIComponent(u.pathname).replace(/^\/+|\/+$/g, '');
  const last = path.split('/').pop();
  let name;
  if (host === 'doi.org') name = `DOI ${path}`;
  else if (host === 'pubmed.ncbi.nlm.nih.gov') name = `PubMed ${last}`;
  else if (host === 'researchgate.net' && /^publication\//.test(path)) name = `ResearchGate ${last}`;
  else name = host;
  const pdf = /\.pdf$/i.test(path) ? ', PDF' : '';
  return `${name}${pdf} ${NEW_TAB_HINT}`;
}

/**
 * Fill the keyboard-reachable sources list (<ol id="osc-bio-source-list">) with one item per
 * bar of the dataset: label and range, basis, citation (its DOI/URL as a link that names the
 * resolver and the identifier and says it opens a new tab: sourceLinkText).
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
        a.title = url;
        a.textContent = sourceLinkText(url);
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
