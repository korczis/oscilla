// Counterpart links (U005, docs/ui-audit.md A05 and A07; A1 connect, page audit 2026-11-02): a
// workspace names the workspace that does the same job in depth. The microphone analyzer's live
// spectrum leads to the RTA of MEASURE; Compare, which compares the generator with the
// microphone, leads to Experiments, where two saved experiments are compared. Filter Lab,
// Synthesis, the Sequencer and Presets lead to the Synth, whose voice has the filters, the
// envelopes, the keys and the patches those pages work on one at a time.
//
// One source (lane A wave 3): where such a link leads, and which workspaces show it, is the
// registry's `related` (ui/shell.js WORKSPACE_REGISTRY); PANEL_LINKS below says only where in
// a panel a related entry is also written as a link (its data-osc hook, kept stable for the
// tests and the G001 census) and, where the panel says it otherwise, the link text. COUNTERPARTS
// (and, in ui/cross-links.js, STUDIO_TEMPLATE_LINKS) are generated from the two: a panel link
// whose workspace no longer relates to its target is dropped, and the unit tests require every
// hook to match one written in src/index.html with the generated href and text.
//
// Kept by hand: the RTA counterpart. It opens MEASURE on its RTA result tab, which no route
// selects (routeOfHash has no MEASURE tab key), so a `related` hash cannot express it; it stays
// a row of its own, and Analyzer and Compare also relate to Measure plainly.
// Not a counterpart either: the Sequencer's "Open this pattern in Studio" (seq.toStudio)
// converts the pattern into a Studio document on click, an action rather than an address.
//
// A counterpart is { id, workspace, measureTab, label, from, osc }: the workspace it opens, the
// MEASURE result tab it selects (null for none), the link text, the workspaces that show the
// link, and where the link is written. `osc` is null for the microphone analyzer's line (one
// link, data-osc="counterpart.<id>", in the panel every `from` workspace shows), or maps each
// `from` workspace to the data-osc of the link in that workspace's own panel, named as its
// Studio link is (`filter.toStudio`, `filter.toSynth`). The link's href is the workspace's
// address (`#m=<workspace>`), so a modified click or "open in new tab" opens the workspace as
// any nav item does; a plain click goes through the component (app.js counterpartLink), which
// also selects the tab and moves focus to the workspace heading. The link names the workspace,
// never "this filter" or "this sound": the labs run the V1 engine and the Synth is the Studio
// document, so nothing suggests shared state (project.studio-model-is-canonical).

import { relatedOf, relatedRef, WORKSPACE_LABELS } from './shell.js';

/**
 * Where a related entry is also a link inside a panel: { osc, from, to, text? }. osc: the
 * link's data-osc ("counterpart.<to>" for the microphone analyzer's line, written once in the
 * panel every `from` workspace shows); from: the workspaces showing it; to: the related entry
 * it carries (relatedRef: `<id><hash>`); text: the link text where it is not the default
 * ("Open the <label>" for a workspace, "Open <template> in Studio" for a Studio template,
 * ui/cross-links.js).
 */
export const PANEL_LINKS = Object.freeze([
  { osc: 'counterpart.experiments', from: ['analyzer', 'compare'], to: 'experiments',
    text: 'Compare saved experiments' },
  { osc: 'filter.toSynth', from: ['filter'], to: 'synth' },
  { osc: 'dual.toSynth', from: ['synthesis'], to: 'synth' },
  { osc: 'seq.toSynth', from: ['sequencer'], to: 'synth' },
  { osc: 'presets.toSynth', from: ['presets'], to: 'synth' },
  { osc: 'filter.toStudio', from: ['filter'], to: 'studio&st=filter-automation' },
  { osc: 'envelope.toStudio', from: ['synthesis'], to: 'studio&st=subtractive-synth' },
  { osc: 'dual.toStudio', from: ['synthesis'], to: 'studio&st=stereo-beat' },
  { osc: 'seq.toStudioTemplate', from: ['sequencer'], to: 'studio&st=sweep-sequence' },
  { osc: 'measure.toStudio', from: ['measure'], to: 'studio&st=measurement-sweep' },
].map((l) => Object.freeze({ ...l, from: Object.freeze([...l.from]) })));

/** The panel links whose every workspace relates to their target in the registry. */
export function livePanelLinks(links = PANEL_LINKS) {
  return links.filter((l) => l.from.length
    && l.from.every((ws) => relatedOf(ws).some((r) => relatedRef(r) === l.to)));
}

/** The counterpart that only a MEASURE tab expresses (above): kept by hand. */
const MEASURE_RTA = Object.freeze({
  id: 'measure-rta',
  workspace: 'measure',
  measureTab: 'rta',
  label: 'RTA in Measure',
  from: Object.freeze(['analyzer', 'compare']),
  osc: null,
});

/**
 * The counterparts generated from the registry: one per workspace a panel link leads to
 * (a Studio template is the Studio template table's, ui/cross-links.js), in PANEL_LINKS order.
 */
export function counterpartsOf(links = livePanelLinks()) {
  const out = [];
  for (const l of links.filter((x) => !x.to.includes('&'))) {
    const line = l.osc === `counterpart.${l.to}`;
    let c = out.find((x) => x.id === l.to);
    if (!c) {
      c = { id: l.to, workspace: l.to, measureTab: null,
        label: l.text || `Open the ${WORKSPACE_LABELS[l.to]}`, from: [], osc: line ? null : {} };
      out.push(c);
    }
    for (const ws of l.from) {
      if (!c.from.includes(ws)) c.from.push(ws);
      if (c.osc) c.osc[ws] = l.osc;
    }
  }
  return out.map((c) => Object.freeze({ ...c, from: Object.freeze(c.from),
    osc: c.osc && Object.freeze(c.osc) }));
}

export const COUNTERPARTS = Object.freeze([MEASURE_RTA, ...counterpartsOf()]);

/** The counterpart with this id, or null. */
export function counterpartOf(id) {
  return COUNTERPARTS.find((c) => c.id === id) || null;
}

/** The address a counterpart link carries: its workspace's (`#m=measure`). */
export function counterpartHref(id) {
  const c = counterpartOf(id);
  return c ? `#m=${c.workspace}` : null;
}

/** The data-osc of the counterpart's link in this workspace, or null where it shows none. */
export function counterpartOsc(id, workspace) {
  const c = counterpartOf(id);
  if (!c || !c.from.includes(workspace)) return null;
  return c.osc ? c.osc[workspace] : `counterpart.${c.id}`;
}

/** True when the workspace shows the microphone analyzer's counterpart line. */
export function showsCounterparts(workspace) {
  return COUNTERPARTS.some((c) => !c.osc && c.from.includes(workspace));
}
