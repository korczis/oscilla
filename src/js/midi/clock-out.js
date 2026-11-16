// MIDI clock and transport out: a chosen output follows OSCILLA's transport (plan issue V510; ADR
// 0058, its V510 note; docs/midi.md "Clock and transport out").
//
// Only MIDI realtime messages are sent, so the plain `midi` permission covers them (support.js
// asks for { sysex: false }): Start (FA), Continue (FB), Stop (FC) and Timing Clock (F8), 24 per
// quarter note (transport.js CLOCK_PPQ, the one constant). MMC is SysEx and is not sent here
// (V511).
//
// The ticks are placed on the audio clock, not on timers: tick k of a run that starts at context
// time startS at `bpm` falls at startS + k * 60 / (bpm * CLOCK_PPQ). Each scheduling pass (the
// caller's lookahead, as the Sequencer's and the Studio's transports run theirs) sends every tick
// before the lookahead's end that was not sent yet, each stamped with the performance.now() time its context
// time maps to (Web MIDI send(data, timestamp) takes a DOMHighResTimeStamp), so the browser
// delivers them at their time whatever the main thread's lateness. A tempo change re-anchors the
// run at the next unsent tick, so no tick is sent twice and none is skipped.
//
//   ticksIn(from, to, run)       -> [{ k, at }]   the ticks of `run` ({ startS, bpm, k0, k0At })
//                                   in context seconds [from, to)
//   toPerf(ctxS, stamp)          -> the performance.now() ms of context time ctxS, from a
//                                   { contextTime, performanceTime } reading (getOutputTimestamp)
//   createClockOut({ send, stamp })
//       start(atS, bpm)          FA at atS, then ticks from atS (song tick 0)
//       resume(atS, bpm, k = 0)  FB at atS, then ticks from atS, the first being song tick k
//       locate(k, atS)           Song Position Pointer (F2) for song tick k, a multiple of 6
//                                (the pointer counts sixteenths), at atS (undefined: now); only
//                                while stopped. It clamps at 16383 sixteenths (about 34 min at
//                                120 BPM): a song position past that is not expressible
//       tempo(atS, bpm)          the ticks before atS at the old tempo, then the new one
//                                   from the first unsent tick
//       pass(to)                 sends every unsent tick before context time `to` (the
//                                   lookahead's end); returns how many
//       stop()                   FC at the first unsent tick's time, after every tick already
//                                queued (the browser delivers by stamp, so a Stop sent "now"
//                                would arrive before them); returns that time, or false
//       running()                true between start/resume and stop

import { CLOCK_PPQ } from './transport.js';

export const START = 0xfa;
export const CONTINUE = 0xfb;
export const STOP = 0xfc;
export const TICK = 0xf8;
export const SONG_POSITION = 0xf2;
/** MIDI clocks per Song Position Pointer step (a sixteenth note). */
export const SPP_TICKS = 6;
/** The largest Song Position Pointer (14 bits). */
export const SPP_MAX = 0x3fff;

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

/** Seconds between two ticks at `bpm`. */
export const tickS = (bpm) => 60 / (bpm * CLOCK_PPQ);

/**
 * The ticks of a run in context seconds [from, to): a run is { bpm, k0, k0At }, tick k0 at k0At
 * and every later tick one tickS(bpm) after the one before it.
 */
export function ticksIn(from, to, { bpm, k0 = 0, k0At }) {
  if (!isNum(from) || !isNum(to) || !(to > from) || !(bpm > 0) || !isNum(k0At)) return [];
  const dt = tickS(bpm);
  const first = Math.max(k0, k0 + Math.ceil((from - k0At) / dt - 1e-9));
  const out = [];
  for (let k = first; ; k += 1) {
    const at = k0At + (k - k0) * dt;
    if (at >= to - 1e-12) break;
    if (at >= from - 1e-12) out.push({ k, at });
  }
  return out;
}

/** The performance.now() ms of context time `ctxS`, from one output timestamp reading. */
export function toPerf(ctxS, stamp) {
  if (!stamp || !isNum(stamp.contextTime) || !isNum(stamp.performanceTime)) return undefined;
  return stamp.performanceTime + (ctxS - stamp.contextTime) * 1000;
}

/**
 * A clock out on one output. send(bytes, perfMs) is the output's send (perfMs undefined: now);
 * stamp() is the context's getOutputTimestamp() reading at the time of the call.
 */
export function createClockOut({ send, stamp }) {
  let run = null; // { bpm, k0, k0At, next }: `next` the first tick not yet sent
  const at = (ctxS) => toPerf(ctxS, stamp());
  const begin = (status, atS, bpm, k0 = 0) => {
    if (!(bpm > 0) || !isNum(atS) || !(Number.isInteger(k0) && k0 >= 0)) return false;
    send([status], at(atS));
    run = { bpm, k0, k0At: atS, next: k0 };
    return true;
  };
  return {
    start: (atS, bpm) => begin(START, atS, bpm),
    resume: (atS, bpm, k = 0) => begin(CONTINUE, atS, bpm, k),
    locate(k, atS) {
      if (run || !Number.isInteger(k) || k < 0 || k % SPP_TICKS) return false;
      const p = Math.min(SPP_MAX, k / SPP_TICKS);
      send([SONG_POSITION, p & 0x7f, (p >> 7) & 0x7f], isNum(atS) ? at(atS) : undefined);
      return true;
    },

    tempo(atS, bpm) {
      if (!run || !(bpm > 0) || !isNum(atS)) return false;
      // The ticks before atS keep the old tempo (sent now, at their own times, when the change
      // lies ahead); the new tempo counts on from the first unsent tick, which keeps its place.
      this.pass(atS);
      const first = run.k0At + (run.next - run.k0) * tickS(run.bpm);
      run = { bpm, k0: run.next, k0At: first, next: run.next };
      return true;
    },
    pass(to) {
      if (!run) return 0;
      // From the first unsent tick, not from the pass's own start: a late pass sends the ticks
      // it missed (stamped in the past, so the browser sends them at once) rather than skipping
      // them, since a receiver counts ticks to keep its song position.
      const from = run.k0At + (run.next - run.k0) * tickS(run.bpm);
      const ticks = ticksIn(from, to, run);
      for (const t of ticks) send([TICK], at(t.at));
      if (ticks.length) run.next = ticks[ticks.length - 1].k + 1;
      return ticks.length;
    },
    stop() {
      if (!run) return false;
      const endAt = run.k0At + (run.next - run.k0) * tickS(run.bpm);
      run = null;
      send([STOP], at(endAt));
      return endAt;
    },
    running: () => run !== null,
  };
}
