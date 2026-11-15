// STUDIO workspace (src/js/ui/studio/workspace.js), the one instrument the keys play (plan issue
// K247; ADR 0058, its K247 note; midi/routes.js, whose rows outside the Synth name it).
//
// keysInstrument() gives the Studio document's note target (the Studio sink, studio-sink.js);
// else the Synth panel (synthSink) where the document holds it or may take it by itself
// (synth/insert.js insertDecision: it cuts nothing of the user's); else null, and the keys play
// the engine's own voice (midi/notes.js): a document of the user's that plays no notes is never
// rewired from a key. In the Studio itself, where the document is in sight, a key inserts
// nothing (M086): only its note target plays.

import { insertDecision } from '../../../synth/ui.js';

/** True when the document holds the Synth panel (its Keys module). */
export const holdsPanel = (model) => model.graph.nodes.some((n) => n.metadata
  && n.metadata.panel && n.metadata.panel.module === 'keys');

export function createWorkspaceKeys(ctx) {
  const part = {
    keysInstrument() {
      const doc = this.studioSink();
      if (doc || this.workspace === 'studio') return doc;
      const m = ctx.handle.getModel();
      return holdsPanel(m) || insertDecision(m).auto ? this.synthSink() : null;
    },
  };
  return { ops: {}, part };
}
