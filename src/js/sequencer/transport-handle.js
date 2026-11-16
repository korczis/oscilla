// The Sequencer's transport as MIDI reaches it (V508, V510): what midi/ui.js asks of the
// Sequencer panel, from `labs` (main.js's lab registry, whose `sequencer` exists once the panel
// is mounted). Moved from main.js unchanged in behaviour, with V510's anchor.
//
//   createSequencerTransport(labs) -> {
//     play(), stop(), loop()   the panel's play, stop and loop, as its buttons do; false
//                              while the panel is not mounted
//     playing()                the sequence plays
//     anchor()                 V510: the playing sequence's MIDI clock grid, else null:
//                              { run, origin, tempo, tick0, fromStart: true } (midi/
//                              clock-out-mode.js). `run` is the first pass's start; the grid is
//                              the run's current tempo segment: a tempo edit takes effect at the
//                              next pass (the editor compiles each pass with the model of its
//                              start), so the segment starts at that pass, with `tick0` the song
//                              tick it begins on.
//   }

import { tickS } from '../midi/clock-out.js';

export function createSequencerTransport(labs) {
  const editor = () => (labs.sequencer ? labs.sequencer.editor : null);
  let seg = null; // { run, origin, tempo, tick0 } of the segment the playing pass is in
  const passTempo = new Map(); // a pass's start -> the tempo it was compiled with
  return {
    play() {
      if (!editor()) return false;
      editor().play();
      labs.sequencer.render();
      return true;
    },
    stop() {
      if (!editor()) return false;
      editor().stop();
      return true;
    },
    loop() {
      const ed = editor();
      if (!ed) return false;
      ed.setLoop(!ed.model.loop);
      labs.sequencer.render();
      return true;
    },
    playing: () => !!(editor() && editor().playing),
    anchor() {
      const ed = editor();
      if (!ed || !ed.playing) {
        seg = null;
        passTempo.clear();
        return null;
      }
      const run = ed.loopSchedule().t0;
      const pass = ed.currentPassTiming();
      if (!Number.isFinite(run) || !pass) return null;
      if (!passTempo.has(pass.t0)) {
        // A pass first seen while an edit waits for the next one plays the tempo it began with.
        const st = ed.currentPassState();
        passTempo.set(pass.t0, st && !st.current && seg ? seg.tempo : ed.model.tempoBpm);
        for (const t of passTempo.keys()) if (t < pass.t0) passTempo.delete(t);
      }
      const tempo = passTempo.get(pass.t0);
      if (!(tempo > 0)) return null;
      if (!seg || seg.run !== run) seg = { run, origin: run, tempo, tick0: 0 };
      else if (tempo !== seg.tempo) {
        seg = { run, origin: pass.t0, tempo,
          tick0: seg.tick0 + Math.round((pass.t0 - seg.origin) / tickS(seg.tempo)) };
      }
      return { ...seg, fromStart: true };
    },
  };
}
