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
//   keepsRoom what the docked keys may not take from the workspace (#444, after Q105 armed the
//             Studio; U100 the Synth; keptBy: a selector of the surface that keeps the keys
//             docked whatever the room, the Synth's Panel tab whose keys are its instrument;
//             Studio): { toolbar, editorMin, stackedBelow }, the selector of the workspace's toolbar, which
//             the keys never cover, and the height its editor keeps below that toolbar where
//             the editor fills the viewport (a desktop grid; a stacked phone page scrolls, so
//             there only the toolbar is kept; stackedBelow is that width). Where the docked keys would take it, the dock
//             starts folded to its handle: the computer keys stay armed and play (Q105 is
//             about the keys being armed, not about the on-screen keys showing). null: no rule
//
//   routeOf(workspace) -> its row (the Playground's for a workspace not listed)
//   dockState({ route, owner, userExpanded, room }) -> 'docked' | 'collapsed'
//             the one rule of the dock (K171), applied by midi/dock-yield.js alone
//   roomFolds({ route, room }) -> whether the docked keys would take the room keepsRoom keeps
//             (room: the measured viewport, see roomFolds)
//   keysShown({ route, owner, userExpanded }) -> whether the on-screen keys are drawn: wherever
//             the dock is docked (dockState, the same rule), so folded they go with the dock and
//             unfolded they show and play; the keyboard's kbdKeysShown reads it (the computer
//             keys play in either state)
//   dockRoom({ pad, dockTop, ceil, gap }) -> { by }
//             where the owner's surface goes against the dock: the scroll that puts it whole
//             above the dock's top, or its top at the top of the room (dock-yield.js reveal)

/** The height the Studio's editor keeps below its toolbar on a desktop grid (keepsRoom). */
export const STUDIO_EDITOR_MIN_PX = 360;
/** The height the Synth keeps below the page header (keepsRoom, U100): its sticky section chips
 *  (60 px) and three 44 px rows of its tab's content. */
export const SYNTH_CONTENT_MIN_PX = 60 + 3 * 44;
/** U101: below this window height on a fine pointer the Synth's kept Panel folds its keys too
 *  (keepsRoom.keptFineBelow; on a desktop the computer keys play the notes). */
export const SYNTH_KEPT_FINE_BELOW_PX = 760;

export const KEY_ROUTES = Object.freeze({
  playground: Object.freeze({ plays: null, armed: true, leave: null, editors: null,
    yieldsTo: null }),
  synth: Object.freeze({ plays: 'synthSink', armed: true, leave: null, editors: null,
    yieldsTo: 'xy-pad',
    // U100: on a short phone the docked keys (256 px) took the whole main area (235 px at
    // 320 x 568). The Synth keeps, below the page header, its sticky section chips (60 px) and
    // three 44 px rows of its tab; never stacked (it scrolls, but its content must show). A tab
    // whose keys are its instrument declares keepsDock (panels/semi-mono.js: the Panel tab) and
    // the tab panel then carries data-keeps-dock: there the keys stay docked (keptBy).
    // U101 (oscilla-43's decision of 2026-11-10): on a fine pointer in a window shorter than
    // keptFineBelow the kept Panel folds them to the one-row handle, because on a desktop the
    // computer keys play the notes; phones and coarse pointers keep U100 as it is.
    keepsRoom: Object.freeze({ toolbar: '[data-osc="page.header"]',
      editorMin: SYNTH_CONTENT_MIN_PX, stackedBelow: 0,
      keptBy: '[data-osc="synth.panel"][data-keeps-dock]',
      keptFineBelow: SYNTH_KEPT_FINE_BELOW_PX }) }),
  studio: Object.freeze({ plays: 'studioSink', armed: true, leave: 'leave',
    editors: '[data-osc="studio.graph.viewport"], [data-osc="studio.timeline"]',
    yieldsTo: null,
    // The Studio's toolbar and its editor: the graph's header and two rows of node cards over
    // the timeline's 34 % row (the Studio grid of studio.css), (45 + 2 x 96) / 0.66 = 359 -> 360.
    // Below 768 px wide the Studio is one stacked page that scrolls (studio.css, the < 768
    // block), so there only the toolbar is kept.
    keepsRoom: Object.freeze({ toolbar: '[data-osc="studio.bar"]', editorMin: STUDIO_EDITOR_MIN_PX,
      stackedBelow: 768 }) }),
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
export function dockState({ route, owner, userExpanded = false, room = null } = {}) {
  const folds = dockYields({ route, owner }) || roomFolds({ route, room });
  return folds && userExpanded !== true ? 'collapsed' : 'docked';
}

/** The event a surface sends when what keeps the dock may have changed (a Synth tab, U100). */
export const ROOM_EVENT = 'osc:room';

/**
 * Whether the docked keys would take the room the route keeps (keepsRoom), pure. room, as
 * dock-yield.js measures it: { viewH } the viewport's height, { band } the height the keys
 * take docked (the dock and the status bar under it, as --osc-dock-h measures it while docked),
 * { toolbarBottom } the bottom of the toolbar keepsRoom names, { stacked } whether the
 * workspace is a stacked page that scrolls (a phone) rather than a grid that fills the
 * viewport, { kept } whether the surface shown keeps the keys docked (keepsRoom.keptBy),
 * { fine } whether the primary pointer is fine (a desktop's mouse or trackpad). The keys fold
 * where their top would sit above the toolbar's bottom plus, on a grid, the editor's minimum. A
 * kept surface keeps them docked, except on a fine pointer in a viewport shorter than
 * keepsRoom.keptFineBelow (U101), where it folds them whatever the room. Unknown or incomplete
 * input never folds.
 */
export function roomFolds({ route, room } = {}) {
  const keep = route && route.keepsRoom;
  if (!keep || !room) return false;
  const { viewH, band, toolbarBottom, stacked, kept } = room;
  if (kept === true) { // the surface shown keeps the keys docked (keptBy, U100) ...
    // ... unless a fine pointer plays the computer keys in a short window (U101)
    return Number.isFinite(keep.keptFineBelow) && room.fine === true && Number.isFinite(viewH)
      && viewH < keep.keptFineBelow;
  }
  if (![viewH, band, toolbarBottom].every(Number.isFinite) || band <= 0) return false;
  const need = toolbarBottom + (stacked ? 0 : keep.editorMin);
  return viewH - band < need;
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
