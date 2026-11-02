// The held keys of one monophonic voice (K060, K104): pure, no clock and no audio. The top note
// is the one that sounds: the last pressed, the lowest or the highest held key. Releasing the top
// note while others are held returns to the next one (legato, no new gate).
//
//   createNoteStack() -> { press(note, velocity) -> change, release(note) -> change,
//                          top(priority) -> { note, velocity } | null, clear() -> held count,
//                          size, notes }
//   change = { top: { note, velocity } | null, before: same, retrigger, legato, empty }

export const PRIORITIES = Object.freeze(['last', 'low', 'high']);
/** Held keys kept per voice (more presses than this drop the oldest held key). */
export const MAX_HELD = 32;

export function createNoteStack() {
  let held = []; // press order: { note, velocity }

  function top(priority = 'last') {
    if (!held.length) return null;
    if (priority === 'low') return held.reduce((a, b) => (b.note < a.note ? b : a));
    if (priority === 'high') return held.reduce((a, b) => (b.note > a.note ? b : a));
    return held[held.length - 1];
  }

  const change = (before, priority, pressed) => {
    const t = top(priority);
    const moved = !!t && (!before || before.note !== t.note);
    return { top: t, before, empty: !t, retrigger: moved && (pressed || !before),
      legato: moved && !pressed && !!before };
  };

  return {
    press(note, velocity, priority = 'last') {
      const before = top(priority);
      held = held.filter((h) => h.note !== note);
      held.push({ note, velocity });
      if (held.length > MAX_HELD) held.shift();
      const c = change(before, priority, true);
      // A new press of the sounding key (or one that becomes top) retriggers.
      if (c.top && c.top.note === note) c.retrigger = true;
      return c;
    },
    release(note, priority = 'last') {
      const before = top(priority);
      const had = held.length;
      held = held.filter((h) => h.note !== note);
      if (held.length === had) return { top: before, before, empty: !before, retrigger: false,
        legato: false, unchanged: true };
      return change(before, priority, false);
    },
    top,
    clear() {
      const n = held.length;
      held = [];
      return n;
    },
    get size() { return held.length; },
    get notes() { return held.map((h) => h.note); },
  };
}
