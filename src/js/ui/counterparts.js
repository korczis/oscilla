// Counterpart links (U005, docs/ui-audit.md A05 and A07): the V2 analysis workspaces show live,
// uncalibrated views, and each names the workspace that does the same with a calibrated
// measurement or with saved records. The microphone analyzer's live spectrum leads to the RTA
// of MEASURE; Compare, which compares the generator with the microphone, leads to Experiments,
// where two saved experiments are compared.
//
// A counterpart is { id, workspace, measureTab, label, from }: the workspace it opens, the
// MEASURE result tab it selects (null for none), the link text, and the workspaces that show
// the link. The link's href is the workspace's address (`#m=<workspace>`), so a modified click
// or "open in new tab" opens the workspace as any nav item does; a plain click goes through
// the component (app.js counterpartLink), which also selects the tab.

export const COUNTERPARTS = Object.freeze([
  Object.freeze({
    id: 'measure-rta',
    workspace: 'measure',
    measureTab: 'rta',
    label: 'RTA in Measure',
    from: Object.freeze(['analyzer', 'compare']),
  }),
  Object.freeze({
    id: 'experiments',
    workspace: 'experiments',
    measureTab: null,
    label: 'Compare saved experiments',
    from: Object.freeze(['analyzer', 'compare']),
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

/** True when the workspace shows at least one counterpart link. */
export function showsCounterparts(workspace) {
  return COUNTERPARTS.some((c) => c.from.includes(workspace));
}
