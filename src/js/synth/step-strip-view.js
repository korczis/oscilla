// The Synth's step-sequencer strip in the page (plan K221): the strip above the face is the
// Studio Inspector's clip-steps mount (ui/studio/inspector-steps.js mountClipSteps) of the one
// step-grid kind (W008) over the strip's notes clip (step-strip.js), shown only while that clip
// exists, so nothing empty or inert sits above the face. Composed by synth/ui.js.
//
//   createStripView(ctx) -> { sync(), add() -> boolean }
//     ctx: { cmp() -> component | null, panel, model(), present(), handle(), transport(),
//            ensurePanel(), dispatch(action), say(text, assertive) }
//     sync()  mount, update or remove the strip after a model or transport change
//     add()   the picker's "Krokový sekvencer": one BATCH adds the strip, or it is shown

import { STRIP_TEXT, stripCreateAction, stripOf } from './step-strip.js';
import { clipStepsView, mountClipSteps } from '../ui/studio/inspector-steps.js';

export function createStripView(ctx) {
  const { panel } = ctx;
  let mount = null;

  function sync() {
    const cmp = ctx.cmp();
    if (!cmp) return;
    const host = document.getElementById('osc-synth-steps-grid');
    const s = ctx.present() ? stripOf(ctx.model(), panel) : null;
    cmp.synth.strip = !!s;
    if (!s || !host) {
      if (mount) mount.destroy();
      mount = null;
      return;
    }
    // The strip's clip targets the panel's Keys, which plays notes: its playing step is read
    // from the transport's playhead whenever the timeline plays (inspector-steps.js playingStep).
    const view = clipStepsView(ctx.model(), s.clip, true);
    if (mount) mount.update(view);
    else {
      mount = mountClipSteps(host, { store: ctx.handle(),
        playhead: () => { const tt = ctx.transport(); return tt ? tt.playhead() : null; } }, view);
    }
  }

  function show() {
    queueMicrotask(() => {
      sync();
      const el = document.querySelector('[data-osc="synth.steps"]');
      if (el) el.scrollIntoView({ block: 'nearest' });
      const cell = el && el.querySelector('[role="gridcell"][tabindex="0"]');
      if (cell) cell.focus({ preventScroll: true });
    });
  }

  function add() {
    if (!ctx.ensurePanel()) return false;
    if (stripOf(ctx.model(), panel)) {
      ctx.say(STRIP_TEXT.exists);
      show();
      return true;
    }
    const r = stripCreateAction(ctx.model(), panel);
    if (r.reason) {
      ctx.say(r.reason, true);
      return false;
    }
    const done = ctx.dispatch(r.action);
    if (done.ok) {
      ctx.say(STRIP_TEXT.created);
      show();
    }
    return done.ok;
  }

  return { sync, add };
}
