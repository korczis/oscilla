// One shared requestAnimationFrame loop for every live renderer. Rendering pauses while the
// page is hidden (audio scheduling never depends on it). A subscriber that throws is removed
// after its error is reported once, so one broken chart cannot stop the others.

const subscribers = new Set();
let handle = 0;
let paused = false;

function tick(now) {
  handle = 0;
  if (!paused && !(typeof document !== 'undefined' && document.hidden)) {
    for (const fn of [...subscribers]) {
      try {
        fn(now);
      } catch (e) {
        subscribers.delete(fn);
        console.error('OSCILLA renderer stopped:', e);
      }
    }
  }
  if (subscribers.size && !handle) handle = requestAnimationFrame(tick);
}

/** Call fn(nowMs) once per animation frame; returns an unsubscribe function. */
export function onFrame(fn) {
  subscribers.add(fn);
  if (!handle && typeof requestAnimationFrame === 'function') handle = requestAnimationFrame(tick);
  return () => {
    subscribers.delete(fn);
    if (!subscribers.size && handle) {
      cancelAnimationFrame(handle);
      handle = 0;
    }
  };
}

/** "Pause animation": while paused, no renderer draws (the last frame stays on screen). */
export function setFramesPaused(on) {
  paused = !!on;
}

/** Number of active subscribers (diagnostics/tests). */
export function frameSubscriberCount() {
  return subscribers.size;
}
