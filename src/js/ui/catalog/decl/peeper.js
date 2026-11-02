// Declarations: the peeper's own controls (ui/peeper/ui.js; the docked section and the page
// header's action in src/index.html). The peeper itself is a visual component, declared in
// decl/visual.js so the one frame wraps it. Every control writes the page-only key ui.peeper
// (open, pinned, tap, window), kept in local storage (oscilla.peeper), never in the hash.
// Trace: scripts/ui-catalog/trace/peeper.mjs.

import { defineComponent } from '../define.js';

export default [
  defineComponent({
    id: 'peeper.toggle',
    kind: 'open',
    label: 'Signal peeper',
    docs: 'Opens or closes the peeper from the page header of every workspace.',
    state: 'ui.peeper',
  }),
  defineComponent({
    id: 'peeper.stub',
    kind: 'readout',
    label: 'STUB SIGNAL',
    docs: 'Says that the peeper draws the stub probe, a test sine, and not the engine signal.',
    state: { none: 'it shows whether the probe is the stub' },
    in: 'peeper',
  }),
  defineComponent({
    id: 'peeper.tap',
    kind: 'choice',
    label: 'Tap point',
    docs: 'Chooses the port, cable or output the peeper watches, from the probe tap points.',
    state: 'ui.peeper',
    in: 'peeper',
  }),
  defineComponent({
    id: 'peeper.window',
    kind: 'readout',
    label: 'Window',
    docs: 'States the time window drawn, in milliseconds and samples at the real rate.',
    state: { none: 'it shows the window the probe reports' },
    in: 'peeper',
  }),
  defineComponent({
    id: 'peeper.pin',
    kind: 'switch',
    label: 'Pin',
    docs: 'Keeps the peeper open on every page while moving between workspaces.',
    state: 'ui.peeper',
    in: 'peeper',
  }),
  defineComponent({
    id: 'peeper.collapse',
    kind: 'switch',
    label: 'Collapse',
    docs: 'Folds the peeper down to its header bar, or unfolds the trace again.',
    state: 'ui.peeper',
    in: 'peeper',
  }),
  defineComponent({
    id: 'peeper.close',
    kind: 'action',
    label: 'Close the peeper',
    docs: 'Closes the peeper and releases its tap, so nothing is read any more.',
    state: 'ui.peeper',
    in: 'peeper',
  }),
  defineComponent({
    id: 'peeper.canvas',
    kind: 'readout',
    label: 'Trace',
    docs: 'Draws the samples of the watched tap point over the chosen window.',
    state: { none: 'it draws the reading of the probe lease' },
    in: 'peeper',
  }),
  defineComponent({
    id: 'peeper.reason',
    kind: 'readout',
    label: 'Why nothing is drawn',
    docs: 'Says why the trace is empty: nothing plays, the page is hidden or over budget.',
    state: { none: 'it shows the reason the probe gives' },
    in: 'peeper',
  }),
];
