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
//   pageKeyContext(cmp) -> { workspace, view }   what the dispatcher scopes keys by; the
//     Synth's view is its tab ('panel', 'engines', 'xy')
import { instrumentTakesSpace } from '../shortcuts.js';

export const pageKeyContext = (cmp) => ({ workspace: cmp.workspace,
  view: cmp.workspace === 'synth' && cmp.synth ? cmp.synth.tab || null : null });

export function bindPageKeys({ keys, cmp, stopSequencer }) {
  const offs = [
    keys.bind({ id: 'page.escape', keys: ['Escape'], scope: { workspace: '*', focus: '*' },
      prevent: false, label: 'Stop: the instrument, a sequence, a measurement', group: 'Page',
      run: (e) => {
        stopSequencer();
        cmp.measureAbort('escape');
        cmp.onKeyDown(e);
      } }),
    keys.bind({ id: 'instrument.space', keys: ['Space'], scope: { workspace: '*' },
      when: () => instrumentTakesSpace(cmp.workspace), group: 'Instrument',
      label: 'Hold to Play (a programmed pattern triggers once)',
      run: (e) => cmp.onKeyDown(e), up: (e) => cmp.onKeyUp(e) }),
  ];
  return () => offs.forEach((off) => off());
}
