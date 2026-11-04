// What the keys play in each workspace (K178, the owner's question of 2026-11-04: why does the
// keyboard behave differently everywhere): one declared table, read by the note layer's route
// (midi/ui.js) and by the keyboard's arm switch (midi/keyboard-ui.js), so no surface decides on
// its own. A workspace switch changes only the route; octave, velocity and lights stay.
//
//   plays     the component method that gives the workspace's note sink (null: the Playground
//             voice of the AudioEngine plays the note)
//   armed     whether the computer keyboard is armed when the workspace first opens
//   leave     the sink method run when the workspace is left (the Studio disarms an armed-only
//             run, K176), or null
//   yieldsTo  a surface that owns the notes there and collapses the dock (K171, 26's rule:
//             null until its row lands)
//
//   routeOf(workspace) -> its row (the Playground's for a workspace not listed)

export const KEY_ROUTES = Object.freeze({
  playground: Object.freeze({ plays: null, armed: false, leave: null, yieldsTo: null }),
  synth: Object.freeze({ plays: 'synthSink', armed: true, leave: null, yieldsTo: null }),
  studio: Object.freeze({ plays: 'studioSink', armed: false, leave: 'leave', yieldsTo: null }),
});

export const routeOf = (workspace) => KEY_ROUTES[workspace] || KEY_ROUTES.playground;

/** The keyboard's arm state when each listed workspace first opens. */
export const armedDefaults = () => Object.fromEntries(Object.entries(KEY_ROUTES)
  .map(([ws, r]) => [ws, r.armed]));
