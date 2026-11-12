// The Synth's insert notice (K246, decided by oscilla-c3 under Q090): the sentence the Synth
// says when it inserts its panel into the user's Studio document (insert.js SYNTH_TEXT: the
// panel inserted, the Master Output input it took, how to undo it) is a dismissible Pro info
// alert under the Synth header, not a toast that vanishes (a rerouted master would go unseen)
// and not the status line every later message overwrites. Shown once per insert: only a real
// insert calls inserted() (ui.js ensurePanel, the dock's New Synth voice); an undo removes the
// panel (sync sees its Keys node gone) and hides it; a redo restores the panel without an
// insert, so a closed or undone alert never returns for that insert; a new insert, which reuses
// the panel's deterministic ids, shows its own. Said once in the live region as it appears; the
// alert itself has no live role.
//
//   createInsertNotice({ announce }) -> { inserted(key, said), dismiss(), sync(key), view(),
//     into(state), more(), after(fn) }
//     inserted: an insert of the panel whose Keys node is `key` (null: said, no alert)
//     sync: the Keys node id the document holds now (null when the panel is gone)
//     view() -> { text, short, more } | null, what the alert shows; the same object until it
//     changes (short: the phone's line { lead, source, tail }, U108; more: its Více open)

import { ROOM_EVENT } from '../midi/routes.js';

export function createInsertNotice({ announce = () => {} } = {}) {
  let shown = null; // { key, text }
  // One view object per shown alert (C3-539-3): refresh() runs on every store change, a knob
  // drag included, and a fresh object each time re-ran the alert's Alpine bindings per event.
  let view = null;
  let target = null; // the state into() last wrote, and the view it wrote there
  let written;
  let waiting = []; // U108: notices that wait for the alert on a phone (the link's toast)
  const show = (s) => {
    shown = s;
    view = s ? { text: s.text, short: s.short, more: s.more } : null;
    if (!s && waiting.length) {
      const run = waiting;
      waiting = [];
      run.forEach((fn) => fn());
      // A notice that shows now moves the page header: once it is drawn, the dock decides its
      // room again (U100's rule, which reads the header where the notice put it).
      if (typeof requestAnimationFrame === 'function') {
        requestAnimationFrame(() => requestAnimationFrame(() => window
          .dispatchEvent(new Event(ROOM_EVENT))));
      }
    }
  };
  const wide = () => typeof matchMedia === 'function' && matchMedia('(min-width: 768px)').matches;
  return {
    inserted(key, said) {
      const { text, short = null } = typeof said === 'string' ? { text: said } : said;
      announce(text);
      show(key ? { key, text, short, more: false } : null);
    },
    /** U108 (oscilla-c3): below md one transient notice at a time; `fn` (another notice) runs
     *  now, or once this alert closes or its insert is undone: queued, never dropped. */
    after(fn) { if (shown && !wide()) waiting.push(fn); else fn(); },
    /** U108: the phone's Více / Méně, the full sentence shown under the short line. */
    more() { if (shown) show({ ...shown, more: !shown.more }); },
    dismiss() { show(null); },
    sync(key) { // only ever hides: a panel coming back (a redo) is not an insert
      if (shown && shown.key !== key) show(null);
    },
    view: () => view,
    /** Write the view into `state.notice` only when it changed (C3-539-3). It remembers what it
     *  wrote and where: an Alpine component is a proxy, so reading `state.notice` back never
     *  equals the raw view (oscilla-c3's note on decd6909). */
    into(state) {
      if (!state || (state === target && written === view)) return;
      target = state;
      written = view;
      state.notice = view;
    },
  };
}
