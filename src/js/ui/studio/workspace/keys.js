// STUDIO workspace (src/js/ui/studio/workspace.js), the one instrument the keys play (plan issue
// K247; ADR 0058, its K247 note; midi/routes.js, whose rows outside the Synth name it).
//
// keysInstrument() gives the Studio document's note target (the Studio sink, studio-sink.js);
// else the Synth panel (synthSink) where the document already holds it; else null, and the keys
// play the engine's own voice, the page's voice (midi/notes.js). In the Studio itself, where the
// document is in sight, a key inserts nothing (M086).
//
// A key never changes the Studio document (U140, journey J1 of 2026-11-24). From K247 (review
// C3-553-1) to U140 a key outside the Synth and the Studio inserted the Synth panel into the
// untouched default document, took Master Output's input from the document's own chain and
// silenced the Studio's Play, while the Studio stayed clean. Playing is not editing: the panel
// goes into the document only from an explicit action (the Synth's Vložit, synth/ui.js
// ensurePanel explicit), which marks the document unsaved and is one Zpět.
//
//   keysInstrument() -> sink | null        keysPanelMissing() -> no note target and no panel

/** True when the document holds the Synth panel (its Keys module). */
export const holdsPanel = (model) => model.graph.nodes.some((n) => n.metadata
  && n.metadata.panel && n.metadata.panel.module === 'keys');

export function createWorkspaceKeys(ctx) {
  const part = {
    keysInstrument() {
      const doc = this.studioSink();
      if (doc || this.workspace === 'studio') return doc;
      return holdsPanel(ctx.handle.getModel()) ? this.synthSink() : null;
    },

    /**
     * True when the keys have no instrument of the document to play (no Studio note target, no
     * panel in the document): an answer of call and response then has nothing to plan on (V503).
     */
    keysPanelMissing() {
      return !this.studioSink() && !holdsPanel(ctx.handle.getModel());
    },
  };
  return { ops: {}, part };
}
