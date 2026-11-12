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
//   createInsertNotice({ announce }) -> { inserted(key, text), dismiss(), sync(key), view() }
//     inserted: an insert of the panel whose Keys node is `key` (null: said, no alert)
//     sync: the Keys node id the document holds now (null when the panel is gone)
//     view() -> { text } | null, what the alert shows

export function createInsertNotice({ announce = () => {} } = {}) {
  let shown = null; // { key, text }
  return {
    inserted(key, text) {
      announce(text);
      shown = key ? { key, text } : null;
    },
    dismiss() { shown = null; },
    sync(key) { // only ever hides: a panel coming back (a redo) is not an insert
      if (shown && shown.key !== key) shown = null;
    },
    view: () => (shown ? { text: shown.text } : null),
  };
}
