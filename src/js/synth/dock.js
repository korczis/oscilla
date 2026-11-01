// The dock beside the piano in the Synth workspace (plan K066): the DOM/Alpine part of
// src/js/synth/picker.js, composed into the Synth part (synth/ui.js). What the keys play, the
// waveform of an oscillator and the quick presets are views of the ONE Studio store, re-read
// after every change (sync); every choice is one dispatch through the Synth's own path.
//
//   createDock(ctx) -> { state, sync(), methods }
//     ctx: { panel, registry, cmp() -> component | null, model(), present(), played() -> node,
//            ensurePanel(), dispatch(action), say(text, assertive), allOff() }

import { WAVES, instrumentChoices, routeAction, waveAction, waveOf } from './picker.js';

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
    d.choices = instrumentChoices(m, panel, { registry, current: on && on.id });
    d.target = on ? on.metadata.name : 'nothing';
    d.wave = waveOf(m, panel, d.osc);
  }

  const methods = {
    /** The instrument picker: route the keys to a node, or insert a New Synth voice. */
    synthPick(id) {
      this.synth.dock.open = false;
      const r = routeAction(ctx.model(), panel, id, { registry });
      if (r.reason) {
        ctx.say(r.reason, true);
        return false;
      }
      ctx.allOff();
      const done = ctx.dispatch(r.action);
      const on = done.ok ? ctx.played() : null;
      if (done.ok) ctx.say(`The keys play ${on ? on.metadata.name : 'nothing'}.`);
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

    synthOsc(id) {
      this.synth.dock.osc = id;
      sync();
    },

    synthSay(text) {
      ctx.say(text, true);
    },

    /** Arrow keys in a menu or a radio group of the dock move (in a group they also choose). */
    synthDockKey(e, choose) {
      const items = [...e.currentTarget.querySelectorAll('[role="menuitem"],[role="radio"]')];
      const step = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 }[e.key];
      if (!step || !items.length) return;
      e.preventDefault();
      const i = items.indexOf(document.activeElement);
      const next = items[(i + step + items.length) % items.length];
      next.focus();
      if (choose) next.click();
    },
  };
  /** An engine chosen on the Engines tab: the tab chooses what the keys play again. */
  function unroute() {
    if (ctx.model().metadata.noteTarget) ctx.dispatch({ type: 'METADATA_SET', noteTarget: null });
  }
  return { state, sync, unroute, methods };
}
