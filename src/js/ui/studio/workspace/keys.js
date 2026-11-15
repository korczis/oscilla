// STUDIO workspace (src/js/ui/studio/workspace.js), the one instrument the keys play (plan issue
// K247; ADR 0058, its K247 note; midi/routes.js, whose rows outside the Synth name it).
//
// keysInstrument() gives the Studio document's note target (the Studio sink, studio-sink.js);
// else the Synth panel (synthSink) where the document holds it or may take it by itself
// (synth/insert.js insertDecision: it cuts nothing of the user's, or the document is the
// untouched reference template); else null, and the keys play the engine's own voice
// (midi/notes.js): a document of the user's whose own chain feeds Master Output is never rewired
// from a key. In the Studio itself, where the document is in sight, a key inserts nothing (M086).
//
// An insert a key makes outside the Synth and the Studio is said where it happens (review
// C3-553-1, decided by oscilla-43 under Q090 on the owner's words, 2026-11-15): K246's whole
// sentence (what went in, whose Master Output input it took, that Zpět removes it) as a warning
// notice in that workspace, once per insert, with its own Zpět, which undoes the insert there
// while it is still the last change of the document (alertUndo).
//
//   keysInstrument() -> sink | null        alertUndo(id) -> true when the insert was undone

import { insertDecision } from '../../../synth/ui.js';

/** True when the document holds the Synth panel (its Keys module). */
export const holdsPanel = (model) => model.graph.nodes.some((n) => n.metadata
  && n.metadata.panel && n.metadata.panel.module === 'keys');

/** The notice's title, and what Zpět says when the insert is no longer the last change. */
export const KEYS_INSERT_TEXT = Object.freeze({
  title: 'Klávesy vložily panel Synthu do dokumentu Studia.',
  later: 'Vložení panelu už není poslední změnou dokumentu: vraťte ho ve Studiu (Zpět).',
  // C3-553-2: after Zpět the next note inserts the panel again; the way out is named.
  undone: 'Vložení je vrácené. Klávesy panel vloží znovu při další notě; vypnete je tlačítkem '
    + 'Odpojit klávesy.',
});

export function createWorkspaceKeys(ctx) {
  const undos = new Map(); // a notice's id -> the undo entry label of the insert it reports
  const part = {
    keysInstrument() {
      const doc = this.studioSink();
      if (doc || this.workspace === 'studio') return doc;
      const m = ctx.handle.getModel();
      if (holdsPanel(m)) return this.synthSink();
      if (!insertDecision(m).auto) return null;
      // The panel goes in with this note: said here, once (C3-553-1).
      const synth = this.synthSink();
      const cmp = this;
      return { ...synth, noteOn(note, velocity) {
        const r = synth.noteOn(note, velocity);
        if (holdsPanel(ctx.handle.getModel())) cmp.keysInserted();
        return r;
      } };
    },

    /** Say the insert the keys just made, with its own Zpět (K246's sentence). */
    keysInserted() {
      const text = this.synth && this.synth.notice && this.synth.notice.text;
      if (!text || typeof this.notify !== 'function') return;
      this.notify('warning', KEYS_INSERT_TEXT.title, text);
      const a = this.alerts && this.alerts[this.alerts.length - 1];
      if (!a || a.message !== text) return;
      undos.set(a.id, ctx.handle.undoLabel());
      this.alerts = this.alerts.map((x) => (x.id === a.id ? { ...x, undo: true } : x));
    },

    /** A notice's Zpět: the insert it reports is undone, while it is the last change. */
    alertUndo(id) {
      const label = undos.get(id);
      undos.delete(id);
      this.dismissAlert(id);
      if (!label) return false;
      if (ctx.handle.undoLabel() !== label) {
        this.notify('info', KEYS_INSERT_TEXT.title, KEYS_INSERT_TEXT.later);
        return false;
      }
      this.studioUndo();
      this.notify('info', KEYS_INSERT_TEXT.title, KEYS_INSERT_TEXT.undone);
      return true;
    },
  };
  return { ops: {}, part };
}
