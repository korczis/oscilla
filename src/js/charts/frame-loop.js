// One shared requestAnimationFrame loop for every live renderer. Rendering pauses while the
// page is hidden (audio scheduling never depends on it). A subscriber that throws is removed
// after its error is reported once, so one broken chart cannot stop the others.
//
// Each subscriber is called as fn(nowMs, info). info.resumed is true on the first frame that
// runs after frames were skipped ("Pause animation", a hidden document, or a document that was
// hidden and got no frame at all, as a background tab does), so a renderer with a time axis
// restarts its clock there instead of painting the skipped interval (C014).

const RUNNING = Object.freeze({ resumed: false });
const RESUMED = Object.freeze({ resumed: true });
const subscribers = new Set();
let handle = 0;
let paused = false;
let skipped = false;
let watching = false;

function watchVisibility() {
  if (watching || typeof document === 'undefined' || !document.addEventListener) return;
  watching = true;
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) skipped = true;
  });
}

function tick(now) {
  handle = 0;
  if (paused || (typeof document !== 'undefined' && document.hidden)) {
    skipped = true;
  } else {
    const info = skipped ? RESUMED : RUNNING;
    skipped = false;
    for (const fn of [...subscribers]) {
      try {
        fn(now, info);
      } catch (e) {
        subscribers.delete(fn);
        console.error('OSCILLA renderer stopped:', e);
      }
    }
  }
  if (subscribers.size && !handle) handle = requestAnimationFrame(tick);
}

/** Call fn(nowMs, { resumed }) once per animation frame; returns an unsubscribe function. */
export function onFrame(fn) {
  watchVisibility();
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
  if (paused) skipped = true;
}

/** Number of active subscribers (diagnostics/tests). */
export function frameSubscriberCount() {
  return subscribers.size;
}
