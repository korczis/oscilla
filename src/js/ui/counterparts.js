// Counterpart links (U005, docs/ui-audit.md A05 and A07; A1 connect, page audit 2026-11-02): a
// workspace names the workspace that does the same job in depth. The microphone analyzer's live
// spectrum leads to the RTA of MEASURE; Compare, which compares the generator with the
// microphone, leads to Experiments, where two saved experiments are compared. Filter Lab,
// Synthesis, the Sequencer and Presets lead to the Synth, whose voice has the filters, the
// envelopes, the keys and the patches those pages work on one at a time.
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

export const COUNTERPARTS = Object.freeze([
  Object.freeze({
    id: 'measure-rta',
    workspace: 'measure',
    measureTab: 'rta',
    label: 'RTA in Measure',
    from: Object.freeze(['analyzer', 'compare']),
    osc: null,
  }),
  Object.freeze({
    id: 'experiments',
    workspace: 'experiments',
    measureTab: null,
    label: 'Compare saved experiments',
    from: Object.freeze(['analyzer', 'compare']),
    osc: null,
  }),
  Object.freeze({
    id: 'synth',
    workspace: 'synth',
    measureTab: null,
    label: 'Open the Synth',
    from: Object.freeze(['filter', 'synthesis', 'sequencer', 'presets']),
    osc: Object.freeze({
      filter: 'filter.toSynth',
      synthesis: 'dual.toSynth',
      sequencer: 'seq.toSynth',
      presets: 'presets.toSynth',
    }),
  }),
]);

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
