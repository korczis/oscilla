// The page's own keys, bound through the one registry (K153 PR2). main.js calls
// bindPageKeys once at start; its window keydown and keyup listeners for these keys are gone.
//
//   bindPageKeys({ keys, cmp, stopSequencer }) -> unbind
//     'page.escape'       Escape, every workspace and focus, the default kept (an open dialog
//                         still closes): stop the sequencer, abort a measurement (spec §111,
//                         after the sequencer), and stop the instrument now if it plays
//     'instrument.space'  Space, Hold to Play in the workspaces whose Space owner is the
//                         instrument (ui/shortcuts.js SPACE_OWNER, ADR 0050): held it plays,
//                         released it stops, a programmed pattern triggers once
//     'sequence.space'    Space where the sequence is the place's play target (the Sequencer,
//                         core/play-target.js PLAY_TARGET, U127): play or stop it, as its Play
//                         and Stop do (cmp.sequenceTogglePlay); an auto-repeat starts nothing
//     'keys.dock'         Alt+K, where the docked keyboard yields to a pad that owns the notes
//                         (K171, midi/dock-yield.js): unfold or fold the keys, as its handle does
//     'notes.record'      R, while a Record switch is shown (K223, ui/kinds/record-switch.js: the
//                         Drums tab, a notes clip's step grid in the Studio): it presses it
//   pageKeyContext(cmp) -> { workspace, view }   what the dispatcher scopes keys by; the
//     Synth's view is its tab ('panel', 'engines', 'xy')
//   Escape, Space and R are declared once in ui/shortcuts.js PAGE_KEYS: each binding here
//   spreads its declaration, which is also the row the Keyboard shortcuts dialog lists (D05).
import { PAGE_KEYS, instrumentTakesSpace, sequenceTakesSpace } from '../shortcuts.js';
import { DOCK_KEY } from '../../midi/dock-yield.js';

export const pageKeyContext = (cmp) => ({ workspace: cmp.workspace,
  view: cmp.workspace === 'synth' && cmp.synth ? cmp.synth.tab || null : null });

/** The Record switch on screen (K223), or null. */
const shownRecordSwitch = () => (typeof document === 'undefined' ? null
  : [...document.querySelectorAll('[data-notes-record]')]
    .find((b) => b.getClientRects().length > 0) || null);

export function bindPageKeys({ keys, cmp, stopSequencer, stopAll = null }) {
  const offs = [
    // Escape is the playback bus's stopAll (C050): every owner stops in this one binding.
    keys.bind({ ...PAGE_KEYS.escape,
      run: (e) => {
        if (typeof stopAll === 'function') {
          stopAll('escape');
          return;
        }
        stopSequencer();
        cmp.measureAbort('escape');
        cmp.onKeyDown(e);
      } }),
    keys.bind({ ...PAGE_KEYS.space, when: () => instrumentTakesSpace(cmp.workspace),
      run: (e) => cmp.onKeyDown(e), up: (e) => cmp.onKeyUp(e) }),
    keys.bind({ ...PAGE_KEYS.sequence, when: () => sequenceTakesSpace(cmp.workspace),
      run: () => cmp.sequenceTogglePlay() }),
    keys.bind({ id: 'keys.dock', keys: [DOCK_KEY], scope: { workspace: '*' },
      when: () => !!cmp.kbdDockYields, group: 'Keyboard',
      label: 'Rozložit nebo složit klávesnici tam, kde noty hraje pad (její úchyt)',
      run: () => cmp.kbdDockToggle() }),
    keys.bind({ ...PAGE_KEYS.record, when: () => !!shownRecordSwitch(),
      run: () => shownRecordSwitch().click() }),
  ];
  return () => offs.forEach((off) => off());
}
