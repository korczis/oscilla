// The dock beside the piano in the Synth workspace (plan K066): the DOM/Alpine part of
// src/js/synth/picker.js, composed into the Synth part (synth/ui.js). What the keys play, the
// waveform of an oscillator and the quick presets are views of the ONE Studio store, re-read
// after every change (sync); every choice is one dispatch through the Synth's own path.
//
//   createDock(ctx) -> { state, sync(), methods }
//     ctx: { panel, registry, cmp() -> component | null, model(), present(), played() -> node,
//            ensurePanel(), dispatch(action), say(text, assertive), allOff() }

import { NEW_VOICE, WAVES, instrumentChoices, routeAction, waveAction, waveOf } from './picker.js';
import { roving } from '../ui/keys/roving.js';
import { STRIP_TEXT, stripOf } from './step-strip.js';

/** The picker's item that adds or shows the step-sequencer strip (K221). */
export const STEPS_CHOICE = 'steps';

export function createDock(ctx) {
  const { panel, registry } = ctx;
  const state = () => ({ open: false, choices: [], target: '', osc: 'vco1', wave: '',
    oscs: ['vco1', 'vco2'].map((id) => ({ id, label: panel.module(id).label })), waves: WAVES });

  function sync() {
    const cmp = ctx.cmp();
    if (!cmp) return;
    const d = cmp.synth.dock;
    const m = ctx.model();
    const on = ctx.present() ? ctx.played() : null;
    // K221: the step-sequencer strip is found from here, the default view's picker.
    const strip = ctx.present() ? stripOf(m, panel) : null;
    d.choices = [...instrumentChoices(m, panel, { registry, current: on && on.id }),
      { id: STEPS_CHOICE, name: STRIP_TEXT.title, kind: strip ? 'nad panelem' : 'přidat',
        selected: false, disabled: false, reason: '' }];
    d.target = on ? on.metadata.name : 'nic';
    d.wave = waveOf(m, panel, d.osc);
  }

  const methods = {
    /** The instrument picker: route the keys to a node, or insert a New Synth voice. */
    synthPick(id) {
      this.synth.dock.open = false;
      if (id === STEPS_CHOICE) return this.synthSteps();
      const r = routeAction(ctx.model(), panel, id, { registry });
      if (r.reason) {
        ctx.say(r.reason, true);
        return false;
      }
      ctx.allOff();
      const done = ctx.dispatch(r.action);
      const on = done.ok ? ctx.played() : null;
      // K246: a New Synth voice is an insert: its sentence is the insert alert's.
      if (done.ok && id === NEW_VOICE && r.text && ctx.inserted) ctx.inserted(r);
      else if (done.ok) ctx.say(r.text || (on ? `Klávesy hrají ${on.metadata.name}.`
        : 'Klávesy nehrají nic.'));
      return done.ok;
    },

    /** The waveform group: `wave` on the dock's oscillator, one history entry. */
    synthWave(wave) {
      if (!ctx.ensurePanel()) return false;
      const a = waveAction(ctx.model(), panel, this.synth.dock.osc, wave);
      const done = a ? ctx.dispatch(a) : null;
      if (done && done.ok) sync();
      return !!(done && done.ok);
    },

    /** Open or close the picker; an opened menu takes the focus once it is shown. */
    synthPickToggle() {
      const d = this.synth.dock;
      d.open = !d.open;
      if (!d.open) return;
      const focusFirst = (tries) => {
        const item = document.querySelector('#osc-synth-pick-menu [role="menuitem"]');
        if (item && item.offsetParent !== null) item.focus();
        else if (tries > 0) requestAnimationFrame(() => focusFirst(tries - 1));
      };
      this.$nextTick(() => focusFirst(10));
    },

    synthOsc(id) {
      this.synth.dock.osc = id;
      sync();
    },

    synthSay(text) {
      ctx.say(text, true);
    },

    /** Arrow keys in a menu or a radio group of the dock move (in a group they also choose). */
    /** Roving focus over the picker's menu (Escape closes it) or a radio group (a move
     *  chooses), through the one sanctioned widget key listener (src/js/ui/keys/roving.js). */
    synthDockRoving(el, choose) {
      const items = () => [...el.querySelectorAll('[role="menuitem"],[role="radio"]')]
        .filter((x) => x.getClientRects().length > 0);
      // Not returned: Alpine calls a function an x-init expression yields (it would detach).
      roving(el, {
        orientation: 'both',
        count: () => items().length,
        index: () => items().indexOf(el.ownerDocument.activeElement),
        move(i) {
          const next = items()[i];
          next.focus();
          if (choose) next.click();
        },
        escape: choose ? undefined : () => {
          if (!this.synth.dock.open) return false; // a closed picker leaves Escape to the page
          this.synth.dock.open = false;
          const pick = el.querySelector('[data-osc="synth.pick"]');
          if (pick) pick.focus();
          return true;
        },
      });
    },
  };
  /** An engine chosen on the Engines tab: the tab chooses what the keys play again. */
  function unroute() {
    if (ctx.model().metadata.noteTarget) ctx.dispatch({ type: 'METADATA_SET', noteTarget: null });
  }
  return { state, sync, unroute, methods };
}
