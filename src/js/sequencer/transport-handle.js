// The Sequencer's transport as MIDI reaches it (V508, V510): what midi/ui.js asks of the
// Sequencer panel, from `labs` (main.js's lab registry, whose `sequencer` exists once the panel
// is mounted). Moved from main.js unchanged in behaviour, with V510's anchor.
//
//   createSequencerTransport(labs) -> {
//     play(), stop(), loop()   the panel's play, stop and loop, as its buttons do; false
//                              while the panel is not mounted
//     playing()                the sequence plays
//     anchor()                 V510: { origin, tempo, fromStart: true } of the playing sequence
//                              (its first pass on the audio clock, its tempo), else null
//   }

export function createSequencerTransport(labs) {
  const editor = () => (labs.sequencer ? labs.sequencer.editor : null);
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
      if (!ed || !ed.playing) return null;
      const { t0 } = ed.loopSchedule();
      return Number.isFinite(t0) && ed.model.tempoBpm > 0
        ? { origin: t0, tempo: ed.model.tempoBpm, fromStart: true } : null;
    },
  };
}
