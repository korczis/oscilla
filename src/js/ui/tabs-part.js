// The component's roving tabs members outside the shell (ui/app.js), composed into the one
// Alpine component through the workbench (ui/workbench.js). One tabs model: the markup's own
// tablists (Measure, Presets) call rovingKeydown, the shell's tab() binds it, and synthTabBind
// binds it over the Synth's state.
import { rovingKeydown } from './app.js';

export const TABS_PART = {
  rovingKeydown,
  /**
   * Tab `id` of the Synth tab strip (x-bind): tab() of ui/app.js over the Synth's own state,
   * synth.tab, which synthTab selects (synth/ui.js). The selected tab is the one Tab stop;
   * arrows, Home and End go through rovingKeydown, which focuses and clicks the next tab, so a
   * key selects as a click does.
   */
  synthTabBind(id) {
    return {
      ':aria-selected'() { return String(this.synth.tab === id); },
      ':tabindex'() { return this.synth.tab === id ? 0 : -1; },
      '@click'() { this.synthTab(id); },
      '@keydown'(e) { rovingKeydown(e); },
    };
  },
};
