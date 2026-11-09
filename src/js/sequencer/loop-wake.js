// The sequencer loop's wake-up (C055): when the editor's engine adapter hands it the engine's one
// transport clock (audio/clock.js transportClockOf), the loop wakes from the same timer as the
// Studio transport; without one (a test, an editor with no engine) it arms its own timer. The
// wake-up is bookkeeping: the loop places every pass on ctx.currentTime (ADR 0001).
//
//   createLoopWake({ clock, timers }) -> { arm(ms, fn), clear(), armed }

export function createLoopWake({ clock = null, timers = null } = {}) {
  const key = Object.freeze({ scheduler: 'sequencer-loop' });
  let id = null; // the clock's key or the timer id while armed
  const wake = {
    /** Whether the loop can wake at all (a clock or timers). */
    get able() { return !!(clock || timers); },
    get armed() { return id !== null; },
    arm(ms, fn) {
      wake.clear();
      const run = () => {
        id = null;
        fn();
      };
      if (clock) clock.wake((id = key), ms, run);
      else if (timers) id = timers.setTimeout(run, ms);
    },
    clear() {
      if (id !== null) {
        if (clock) clock.cancel(id);
        else if (timers) timers.clearTimeout(id);
      }
      id = null;
    },
  };
  return wake;
}
