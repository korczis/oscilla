// MIDI clock and transport out on a chosen output, following the transport in view (plan issue
// V510; ADR 0058, its V510 note; docs/midi.md "Clock and transport out"). clock-out.js places the
// messages; this module decides when, from the transport's own anchor, never from its buttons:
// whatever starts or stops the transport (its PLAY, a key's armed run aside, a controller's
// Start), the output follows.
//
//   - anchor() is the playing transport's { origin, tempo, fromStart }: the context time of its
//     position 0, its tempo, and whether the run began at position 0 (the Studio's
//     transport.clockAnchor(), the Sequencer's first pass and its tempo); null while nothing
//     plays. A new origin is a new run: Start (FA) at the origin when the run began at position
//     0, its ticks from the first (a late wake sends the ones it missed at once, so a receiver's
//     song position stays the transport's), else Continue (FB) with the first tick on the beat
//     grid at or after now.
//     A tempo of its own run re-anchors at the next unsent tick (clock-out.js tempo). No anchor:
//     Stop (FC).
//   - It wakes on the engine's one transport clock (audio/clock.js createTransportClock) every
//     CLOCK_OUT_TICK_MS while an output is chosen, and each wake sends the ticks before now +
//     CLOCK_OUT_LOOKAHEAD_S, each stamped with its own time (send(data, timestamp)), so the
//     browser delivers them on time whatever the main thread's lateness.
//   - Choosing no output sends nothing; choosing another output first stops the old one.
//   - A send that throws (the port closed) drops the output and says so once (say).
//
//   - The stamps map context time to performance time through a slewed clock offset
//     (steadyStamp): readings of the offset scatter (a fraction of a millisecond in Chromium and
//     WebKit, several milliseconds in Firefox, whose output timestamp moves in render steps), and
//     that scatter would land on the ticks as jitter. The offset starts at the first reading and
//     moves toward each later one by at most STAMP_SLEW_S, which follows the clocks' real drift
//     (parts per million) and leaves tick-to-tick spacing within STAMP_SLEW_S of exact.
//
//   createClockOutMode({ clock, ctxNow, stamp, anchor, say })
//     -> { setOutput(port | null), output(), tick(), dispose() }
//   steadyStamp(readOffsetS, slewS = STAMP_SLEW_S) -> () => { contextTime, performanceTime } | null

import { createClockOut, tickS } from './clock-out.js';

/** How often the mode wakes while an output is chosen (UI bookkeeping, not the clock's time). */
export const CLOCK_OUT_TICK_MS = 25;
/** How far ahead of now each wake sends the ticks (each stamped with its own time). */
export const CLOCK_OUT_LOOKAHEAD_S = 0.1;
/** Two anchors closer than this are the same run (a re-plan keeps its origin). */
export const ORIGIN_EPS_S = 0.001;

/** How far the held clock offset moves toward one fresh reading, at most (seconds). */
export const STAMP_SLEW_S = 0.00002;

const WAKE_KEY = 'midi-clock-out';

/**
 * A stamp for clock-out.js from readOffsetS() (context seconds minus performance seconds, as
 * audio/clock.js clockOffsetS gives it, or null): the first reading, then moved toward each later
 * reading by at most slewS.
 */
export function steadyStamp(readOffsetS, slewS = STAMP_SLEW_S) {
  let held = null;
  return () => {
    const off = readOffsetS();
    if (!Number.isFinite(off)) return null;
    held = held === null ? off : held + Math.max(-slewS, Math.min(slewS, off - held));
    return { contextTime: 0, performanceTime: -held * 1000 };
  };
}

export function createClockOutMode({ clock, ctxNow, stamp, anchor, say = () => {} }) {
  let port = null;
  let out = null;
  let run = null; // { origin, tempo } of the run being sent
  let woken = false;

  const wake = () => {
    if (!clock || woken) return;
    woken = true;
    clock.wake(WAKE_KEY, CLOCK_OUT_TICK_MS, () => { woken = false; mode.tick(); });
  };
  const cancel = () => {
    if (clock) clock.cancel(WAKE_KEY);
    woken = false;
  };

  const drop = (failed) => {
    port = null;
    out = null;
    run = null;
    cancel();
    if (failed) say('send-failed');
  };

  const open = (p) => createClockOut({
    send: (bytes, at) => {
      try {
        p.send(bytes, at);
      } catch {
        drop(true);
      }
    },
    stamp,
  });

  const mode = {
    setOutput(next) {
      if (next === port) return;
      if (out && out.running()) out.stop();
      cancel();
      run = null;
      port = next || null;
      out = port ? open(port) : null;
      if (out) mode.tick();
    },
    output: () => port,
    tick() {
      if (!out) return;
      const a = anchor();
      const now = ctxNow();
      if (!a || !(a.tempo > 0) || !Number.isFinite(a.origin)) {
        if (out.running()) out.stop();
        run = null;
      } else if (!run || Math.abs(a.origin - run.origin) > ORIGIN_EPS_S) {
        if (a.fromStart) {
          out.start(a.origin, a.tempo);
        } else {
          const dt = tickS(a.tempo);
          const k = Math.max(0, Math.ceil((now - a.origin) / dt - 1e-9));
          out.resume(a.origin + k * dt, a.tempo);
        }
        run = { origin: a.origin, tempo: a.tempo };
      } else if (a.tempo !== run.tempo) {
        out.tempo(now, a.tempo);
        run = { origin: run.origin, tempo: a.tempo };
      }
      if (out && out.running()) out.pass(now + CLOCK_OUT_LOOKAHEAD_S);
      if (out) wake();
    },
    dispose() {
      mode.setOutput(null);
    },
  };
  return mode;
}
