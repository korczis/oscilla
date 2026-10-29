// The MIDI part of the one OSCILLA Alpine component (plan issue V501, ADR 0058): the support
// state of src/js/midi/support.js as the status line and the Connect MIDI control of the
// Settings dialog. Composed by main.js; it touches nothing outside the MIDI surface.
//
// The controller and the platform objects stay out of reactive state; the component holds only
// the plain values the markup reads (midiState, midiText, midiCanConnect).

import { createMidiSupport, midiSite } from './support.js';

export function createMidiUi({ win = window } = {}) {
  let support = null;
  return {
    midiState: null,
    midiText: '',
    midiCanConnect: false,

    /** Called once by the component's init: the load-time read, never a request. */
    midiInit() {
      const cmp = this;
      support = createMidiSupport({
        navigator: win.navigator,
        isSecureContext: !!win.isSecureContext,
        site: midiSite(win.location),
        onChange(s) {
          cmp.midiState = s.state;
          cmp.midiText = s.text;
          cmp.midiCanConnect = s.canConnect;
        },
      });
      return support.init();
    },

    /** Connect MIDI (the explicit user action): asks the browser for access. */
    midiConnect() {
      if (support) support.connect();
    },
  };
}
