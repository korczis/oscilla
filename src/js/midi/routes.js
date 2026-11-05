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
//   keysShown({ route, owner, userExpanded }) -> whether the on-screen keys are drawn: wherever
//             the dock is docked (dockState, the same rule), so folded they go with the dock and
//             unfolded they show and play; the keyboard's kbdKeysShown reads it (the computer
//             keys play in either state)
//   dockRoom({ pad, dockTop, ceil, gap }) -> { by }
//             where the owner's surface goes against the dock: the scroll that puts it whole
//             above the dock's top, or its top at the top of the room (dock-yield.js reveal)

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

/**
 * Whether the on-screen keys are drawn: wherever the dock is docked, never by a second rule
 * (review of #425: a tab rule hid the keys where the keys owned the notes, an inert dock on a
 * phone). Folded where a pad owns the notes, they go with the dock; unfolded by the user, or
 * where no surface owns the notes (the XY tab without its pad), they show and play.
 */
export function keysShown({ route, owner, userExpanded = false } = {}) {
  return dockState({ route, owner, userExpanded }) === 'docked';
}

/**
 * Where the owner's surface goes against the dock (viewport px, pure): pad { top, bottom } the
 * surface's rect, dockTop the dock's top, ceil the top of the room (the scrolling ancestor's
 * top, 0 for the page), gap the space kept above the dock. by: the least scroll that puts the
 * surface's bottom above the dock's top (0 when it already is), or, where the whole surface has
 * no room between ceil and the dock's top, the scroll that puts its top at ceil. Unknown
 * input: { by: 0 }.
 */
export function dockRoom({ pad, dockTop, ceil = 0, gap = 8 } = {}) {
  const n = [pad && pad.top, pad && pad.bottom, dockTop, ceil, gap];
  if (!n.every(Number.isFinite) || pad.bottom < pad.top) return { by: 0 };
  const floor = dockTop - gap;
  let by = pad.bottom > floor ? pad.bottom - floor : 0;
  if (pad.top - by < ceil) by = pad.top - ceil;
  return { by };
}
