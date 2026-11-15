// MIDI transport: a controller's Start, Continue and Stop, its DAW buttons and its clock (plan
// issue V508; ADR 0058, its V508 note; docs/midi.md "Transport and clock").
//
// What drives what:
//   MIDI realtime Start (FA), Continue (FB), Stop (FC), from any input (the BeatStep Pro's play
//     port sends them with its own transport), and the DAW-control port's Mackie Control buttons
//     (a Note On with velocity > 0: Play 94, Stop 93, Rewind 91, Cycle 86; the published
//     protocol's note numbers, which the KeyLab mkII's DAW port sends in its default DAW map),
//     act on the transport of the workspace in view: the Sequencer's own in the Sequencer, the
//     Studio's everywhere else (the one instrument's timeline, K247).
//   MIDI clock (F8, 24 per quarter note) is measured: clockBpm reads the tempo of the last beat
//     of ticks, null until a whole beat arrived or after a gap longer than CLOCK_GAP_MS. OSCILLA
//     shows it and never follows it by itself (the transport keeps its own tempo).
//   Record 95, Fast forward 92 and every other button act on nothing (the monitor shows them).
//
//   transportAction(m, role)  -> 'start' | 'continue' | 'stop' | 'rewind' | 'loop' | null
//   transportTarget(workspace) -> 'sequencer' | 'studio'
//   createClockMeter()         -> { tick(ms), bpm(ms), reset() }

/** The Mackie Control note numbers OSCILLA acts on (the DAW port's buttons). */
export const MCU_BUTTONS = Object.freeze({ 94: 'start', 93: 'stop', 91: 'rewind', 86: 'loop' });

const REALTIME = Object.freeze({ start: 'start', continue: 'continue', stop: 'stop' });

/** The transport action of decoded message `m` (message.js) from a port of `role`, or null. */
export function transportAction(m, role) {
  if (!m) return null;
  if (REALTIME[m.kind]) return REALTIME[m.kind];
  if (role === 'daw' && m.kind === 'note-on' && m.velocity > 0) return MCU_BUTTONS[m.note] || null;
  return null;
}

/** Whose transport a MIDI transport message drives in `workspace`. */
export function transportTarget(workspace) {
  return workspace === 'sequencer' ? 'sequencer' : 'studio';
}

/** Ticks per quarter note of MIDI clock (MIDI 1.0). */
export const CLOCK_PPQ = 24;
/** A pause between ticks longer than this ends the measurement (the clock stopped). */
export const CLOCK_GAP_MS = 500;

/** The tempo of a MIDI clock: tick(ms) per F8 (a monotonic time), bpm(ms) its reading. */
export function createClockMeter() {
  let times = [];
  return {
    tick(ms) {
      if (times.length && ms - times[times.length - 1] > CLOCK_GAP_MS) times = [];
      times.push(ms);
      if (times.length > CLOCK_PPQ + 1) times.shift();
    },
    /** BPM over the last whole beat, rounded to 0.1, or null (no beat yet, or a gap since). */
    bpm(ms) {
      if (times.length < CLOCK_PPQ + 1) return null;
      if (Number.isFinite(ms) && ms - times[times.length - 1] > CLOCK_GAP_MS) return null;
      const beat = times[times.length - 1] - times[0];
      return beat > 0 ? Math.round(600000 / beat) / 10 : null;
    },
    reset() { times = []; },
  };
}
