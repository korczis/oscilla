// U127 (C032, docs/reconstruction/07-target-architecture.md §4.3): the ONE per-place
// play-target table. For every place (the keys are exactly ui/app.js WORKSPACES) it names what
// Play acts on there and whether Space does too; everything that used to keep a list of its own
// is a read of it:
//   ui/shortcuts.js SPACE_OWNER     who answers Space with nothing focused (ADR 0050)
//   core/play-hints.js STATUS_PLAY_WORKSPACES   where the status bar's Play is the place's only
//                                   Play at every width (C030)
//   ui/workbench.js statusPlay      what a click on the status bar's Play starts, its name, and
//                                   where it is hidden
//   ui/shortcuts.js shortcutHelp    the Space row of the Keyboard shortcuts dialog
// Pure: no DOM, no audio.
//
// A row is { target, space, ownPlay }:
//   target   what Play acts on: the instrument's tone, the sequence (the Pattern Sequencer),
//            the Studio transport, the Synth (arm, then its keys play), the measurement's
//            primary action, or null where nothing plays (Play is hidden there unless something
//            still sounds, which the bar then stops: U133, Q114)
//   space    Space with nothing focused acts on the target too. Not in the Synth, which plays
//            from its keys (ADR 0050), nor in Měření, whose stimulus starts only from an
//            explicit button (ADR 0050, run integrity)
//   ownPlay  the place lays out a Play of its own (Podržet a hrát and Spustit, the Sequencer's
//            and the Studio's Play, the Synth's Připravit, Měření's primary button); where it does
//            not, the status bar's Play is shown at every width (C030), else on a phone only
import { OWNER } from './output-bus.js';

/** The targets that are not an output owner of core/output-bus.js. */
export const SYNTH_TARGET = 'synth';
export const MEASURE_TARGET = 'measure';

const row = (target, space, ownPlay) => Object.freeze({ target, space, ownPlay });
const NOTHING = row(null, false, false);

/** The one table, by place. */
export const PLAY_TARGET = Object.freeze({
  playground: row(OWNER.instrument, true, true),
  measure: row(MEASURE_TARGET, false, true),
  experiments: NOTHING,
  analyzer: row(OWNER.instrument, true, false),
  filter: row(OWNER.instrument, true, false),
  compare: row(OWNER.instrument, true, false),
  synthesis: row(OWNER.instrument, true, true),
  sequencer: row(OWNER.sequencer, true, true),
  presets: row(OWNER.instrument, true, false),
  learn: NOTHING,
  studio: row(OWNER.studio, true, true),
  synth: row(SYNTH_TARGET, false, true),
  about: NOTHING,
});

/**
 * What the status bar's Play runs for each target (a method of the page component) and its
 * name before anything sounds. The instrument's name follows the continuous permission
 * (ui/workbench.js statusPlayName) and Měření's is its primary action's label.
 */
export const PLAY_ACTIONS = Object.freeze({
  [OWNER.instrument]: Object.freeze({ run: 'statusPlayInstrument', name: 'Přehrát' }),
  [OWNER.sequencer]: Object.freeze({ run: 'sequenceTogglePlay', name: 'Přehrát sekvenci' }),
  [OWNER.studio]: Object.freeze({ run: 'studioTogglePlay', name: 'Přehrát Studio' }),
  [SYNTH_TARGET]: Object.freeze({ run: 'synthArm', name: 'Připravit Synth' }),
  [MEASURE_TARGET]: Object.freeze({ run: 'measureRunPrimary', name: null }),
});

const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

/** The row of `place`; a place not in the table plays nothing. */
export function playTarget(place) {
  return has(PLAY_TARGET, place) ? PLAY_TARGET[place] : NOTHING;
}

/** The places whose row satisfies `pred`, in the table's order. */
export function placesWhere(pred) {
  return Object.freeze(Object.keys(PLAY_TARGET).filter((p) => pred(PLAY_TARGET[p], p)));
}

/** What Space acts on in `place` with nothing focused: a target, or null. */
export function spaceTarget(place) {
  const r = playTarget(place);
  return r.space ? r.target : null;
}

/** Whether the status bar's Play is shown at desktop width in `place` (C030). */
export function statusPlayEveryWidth(place) {
  const r = playTarget(place);
  return !!r.target && !r.ownPlay;
}
