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
//   createInsertNotice({ announce }) -> { inserted(key, text), dismiss(), sync(key), view(),
//     into(state) }
//     inserted: an insert of the panel whose Keys node is `key` (null: said, no alert)
//     sync: the Keys node id the document holds now (null when the panel is gone)
//     view() -> { text } | null, what the alert shows; the same object until it changes

export function createInsertNotice({ announce = () => {} } = {}) {
  let shown = null; // { key, text }
  // One view object per shown alert (C3-539-3): refresh() runs on every store change, a knob
  // drag included, and a fresh object each time re-ran the alert's Alpine bindings per event.
  let view = null;
  let target = null; // the state into() last wrote, and the view it wrote there
  let written;
  const show = (s) => { shown = s; view = s ? { text: s.text } : null; };
  return {
    inserted(key, text) {
      announce(text);
      show(key ? { key, text } : null);
    },
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
