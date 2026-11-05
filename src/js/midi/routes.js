// What the keys play in each workspace (K178, the owner's question of 2026-11-04: why does the
// keyboard behave differently everywhere): one declared table, read by the note layer's route
// (midi/ui.js) and by the keyboard's arm switch (midi/keyboard-ui.js), so no surface decides on
// its own. A workspace switch changes only the route; octave, velocity and lights stay.
//
//   plays     the component method that gives the workspace's note sink (null: the Playground
//             voice of the AudioEngine plays the note)
//   armed     whether the computer keyboard is armed when the workspace first opens: armed
//             everywhere, so the keys play at once in every workspace as in the Synth (the
//             owner's decision of 2026-11-05 on K178); Arm switches them off and on
//   leave     the sink method run when the workspace is left (the Studio disarms an armed-only
//             run, K176), or null
//   editors   a selector of the workspace's editing surfaces whose letters are shortcuts (the
//             Studio graph's C connect, the timeline's keys): an armed key pressed while the
//             focus is inside one is the editor's, not a note (K178, census
//             studio.connect.cancel.keyboard), or null
//   yieldsTo  the surface that, while it owns the notes there, folds the docked keyboard to
//             its handle at every size (K171): the Synth's XY pad; null where the keys always
//             dock
//
//   routeOf(workspace) -> its row (the Playground's for a workspace not listed)
//   dockState({ route, owner, userExpanded }) -> 'docked' | 'collapsed'
//             the one rule of the dock (K171), applied by midi/dock-yield.js alone
//   keysShown({ workspace, tab }) -> whether the on-screen keys are drawn: not on the tab of
//             the surface the dock yields to (the Synth's XY tab: the pad is the instrument
//             there, the computer keys still play); the keyboard's kbdKeysShown reads it
//   dockRoom({ pad, dockTop, ceil, gap }) -> { fits, by }
//             where the owner's surface goes against the dock: whether it fits whole above
//             the dock's top, and the scroll that puts it there (dock-yield.js reveal)

export const KEY_ROUTES = Object.freeze({
  playground: Object.freeze({ plays: null, armed: true, leave: null, editors: null,
    yieldsTo: null }),
  synth: Object.freeze({ plays: 'synthSink', armed: true, leave: null, editors: null,
    yieldsTo: 'xy-pad' }),
  studio: Object.freeze({ plays: 'studioSink', armed: true, leave: 'leave',
    editors: '[data-osc="studio.graph.viewport"], [data-osc="studio.timeline"]',
    yieldsTo: null }),
});

export const routeOf = (workspace) => KEY_ROUTES[workspace] || KEY_ROUTES.playground;

/** The keyboard's arm state when each listed workspace first opens. */
export const armedDefaults = () => Object.fromEntries(Object.entries(KEY_ROUTES)
  .map(([ws, r]) => [ws, r.armed]));

/**
 * Whether the dock yields: the workspace's route names a surface that yields the dock and that
 * surface owns the notes (owner: the derived note owner, never a flag). At every size: the
 * dock never covers the pad that plays the notes, at 1536 x 1024 as at 390 x 844 (the owner's
 * screenshot of 2026-11-05), so neither the pointer nor the width enters the rule.
 */
export function dockYields({ route, owner } = {}) {
  return !!(route && route.yieldsTo && owner === route.yieldsTo);
}

/**
 * The dock's state, the one rule (K171): folded to its handle where it yields, unless the user
 * expanded it (the caller resets userExpanded when the owner changes); docked otherwise.
 */
export function dockState({ route, owner, userExpanded = false } = {}) {
  return dockYields({ route, owner }) && userExpanded !== true ? 'collapsed' : 'docked';
}

/** The tab each surface a route yields to is drawn on (the Synth's XY pad: its XY tab). */
export const SURFACE_TAB = Object.freeze({ 'xy-pad': 'xy' });

/**
 * Whether the on-screen keys are drawn in a workspace's tab: not on the tab of the surface its
 * route yields the dock to (the owner's OSCILLA-pad audit, S2: on the XY tab the pad is the
 * instrument, so the dock holds no second one; the computer keys still play the notes).
 */
export function keysShown({ workspace, tab } = {}) {
  const route = routeOf(workspace);
  return !(route.yieldsTo && SURFACE_TAB[route.yieldsTo] === tab);
}

/**
 * Where the owner's surface goes against the dock (viewport px, pure): pad { top, bottom } the
 * surface's rect, dockTop the dock's top, ceil the top of the room (the scrolling ancestor's
 * top, 0 for the page), gap the space kept above the dock. fits: the whole surface has room
 * between ceil and the dock's top, so the pad and the keys are both shown; by: the least
 * scroll that puts the surface's bottom above the dock's top (0 when it already is), or, where
 * it does not fit, the scroll that puts its top at ceil. Unknown input: { fits: false, by: 0 }.
 */
export function dockRoom({ pad, dockTop, ceil = 0, gap = 8 } = {}) {
  const n = [pad && pad.top, pad && pad.bottom, dockTop, ceil, gap];
  if (!n.every(Number.isFinite) || pad.bottom < pad.top) return { fits: false, by: 0 };
  const floor = dockTop - gap;
  const fits = pad.bottom - pad.top <= floor - ceil;
  let by = pad.bottom > floor ? pad.bottom - floor : 0;
  if (pad.top - by < ceil) by = pad.top - ceil;
  return { fits, by };
}
