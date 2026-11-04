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
//   yieldsTo  the surface that, while it owns the notes there, folds the docked keyboard to
//             its handle on a phone (K171): the Synth's XY pad; null where the keys always dock
//
//   routeOf(workspace) -> its row (the Playground's for a workspace not listed)
//   dockState({ route, owner, coarse, width, userExpanded }) -> 'docked' | 'collapsed'
//             the one rule of the dock (K171), applied by midi/dock-yield.js alone

export const KEY_ROUTES = Object.freeze({
  playground: Object.freeze({ plays: null, armed: true, leave: null, yieldsTo: null }),
  synth: Object.freeze({ plays: 'synthSink', armed: true, leave: null, yieldsTo: 'xy-pad' }),
  studio: Object.freeze({ plays: 'studioSink', armed: true, leave: 'leave', yieldsTo: null }),
});

export const routeOf = (workspace) => KEY_ROUTES[workspace] || KEY_ROUTES.playground;

/** The keyboard's arm state when each listed workspace first opens. */
export const armedDefaults = () => Object.fromEntries(Object.entries(KEY_ROUTES)
  .map(([ws, r]) => [ws, r.armed]));

/** Below this width (CSS px) a coarse pointer is a phone: the dock may yield there. */
export const DOCK_YIELD_BELOW = 768;

/**
 * Whether the dock yields: the workspace's route names a surface that yields the dock, that
 * surface owns the notes (owner: the derived note owner, never a flag), and the pointer is
 * coarse on a viewport narrower than DOCK_YIELD_BELOW.
 */
export function dockYields({ route, owner, coarse, width }) {
  return !!(route && route.yieldsTo && owner === route.yieldsTo && coarse === true
    && Number.isFinite(width) && width < DOCK_YIELD_BELOW);
}

/**
 * The dock's state, the one rule (K171): folded to its handle where it yields, unless the user
 * expanded it (the caller resets userExpanded when the owner changes); docked otherwise.
 */
export function dockState({ route, owner, coarse, width, userExpanded = false }) {
  return dockYields({ route, owner, coarse, width }) && !userExpanded ? 'collapsed' : 'docked';
}
