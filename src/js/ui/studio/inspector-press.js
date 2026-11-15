// The Studio Inspector's press guard (T7, K226 review R2-T5-7), split from inspector.js (its
// source-size cap; no behaviour change). A rebuild replaces the shown controls: one between a
// pointer's down and its up would drop the press's click (a Krok press lost to an edit arriving
// mid-press). While a pointer is down in the Inspector a rebuild waits; it runs in the task after
// the up, past the click. In-place updates still run. A press whose up never comes ends at the
// window's blur (a hidden tab's too), a context menu or a lost capture, or after 1 s with no
// move, so a slider or step drag keeps its control (C1-INSP-1). No page-hide listener: C050 keeps
// those on the playback bus.
//
//   pressGuard(host, flush) -> { holds(), destroy() }
//     holds() -> true while a press is held, and then the rebuild is owed: flush() runs it after
//     the press ends; destroy() removes every listener

export const PRESS_IDLE_MS = 1000;

export function pressGuard(host, flush) {
  let pressed = false;
  let deferred = false;
  let cap = null;
  const onUp = () => {
    clearTimeout(cap);
    if (!pressed) return;
    pressed = false;
    if (deferred) {
      deferred = false;
      setTimeout(flush, 0);
    }
  };
  const arm = () => {
    clearTimeout(cap);
    cap = setTimeout(onUp, PRESS_IDLE_MS);
  };
  const onDown = () => {
    pressed = true;
    arm();
  };
  const onMove = () => { if (pressed) arm(); };
  const UPS = ['pointerup', 'pointercancel', 'contextmenu'];
  const win = typeof window !== 'undefined' ? window : null;
  const own = typeof host.addEventListener === 'function';
  if (own) {
    host.addEventListener('pointerdown', onDown);
    host.addEventListener('lostpointercapture', onUp);
  }
  if (win) {
    for (const t of UPS) win.addEventListener(t, onUp, true);
    win.addEventListener('blur', onUp); // the window's own (an element's blur never bubbles)
    win.addEventListener('pointermove', onMove, true);
  }
  return {
    holds() {
      if (pressed) deferred = true;
      return pressed;
    },
    destroy() {
      clearTimeout(cap);
      if (own) {
        host.removeEventListener('pointerdown', onDown);
        host.removeEventListener('lostpointercapture', onUp);
      }
      if (win) {
        for (const t of UPS) win.removeEventListener(t, onUp, true);
        win.removeEventListener('blur', onUp);
        win.removeEventListener('pointermove', onMove, true);
      }
    },
  };
}
