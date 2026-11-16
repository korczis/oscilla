// MIDI clock and transport out on a chosen output, following the transport in view (plan issue
// V510; ADR 0058, its V510 note; docs/midi.md "Clock and transport out"). clock-out.js places the
// messages; this module decides when, from the transport's own grid, never from its buttons:
// whatever starts, moves or stops the transport, the output follows.
//
//   - anchor() is the playing transport's grid, or null while nothing plays:
//       { run, origin, tempo, tick0 = 0, fromStart }
//     song tick tick0 + k (24 per quarter note) falls at origin + k * 60 / (tempo * 24); `run`
//     names the run (a new one on every start or locate), `fromStart` that it began at song
//     position 0. The Studio's grid is the whole run at the document's tempo (a tempo change
//     moves every later tick, transport.clockAnchor()); the Sequencer's is the run's current
//     tempo segment (sequencer/transport-handle.js).
//   - Entering a run: Start (FA) at its origin, its ticks from the first, when it began at 0 at
//     most CATCHUP_S ago (a wake that came late sends that many missed ticks at once, so the
//     receiver's count stays the transport's). Otherwise the output joins it: Song Position
//     Pointer (F2) for the first sixteenth on the grid at or after now, then Continue (FB) there
//     and the ticks from it. A new run while one is sent stops the old one first (FC).
//   - In wire order, not only send order: the browser delivers by stamp, and the ticks already
//     queued reach up to the lookahead past now. So Stop is stamped at the first unsent tick's
//     time (after them all), Song Position Pointer with it, and the new run starts no earlier:
//     Start only when its origin is not before that time, else the join's first sixteenth at or
//     after it (review C3-572 P2).
//   - The grid moving within a run (a tempo change) relocates the output to the new grid: FC,
//     SPP, FB at its first sixteenth after now, so the receiver's beats stay on the transport's
//     (re-anchoring the count instead would leave them off the grid for the rest of the run). The
//     Sequencer's change comes at a pass boundary, which the lookahead has already sent ticks
//     past, so it relocates too.
//   - No anchor: Stop (FC), once.
//   - It wakes on the engine's one transport clock every CLOCK_OUT_TICK_MS while a run is sent
//     and every CLOCK_OUT_IDLE_MS while an output waits for one; each wake sends the ticks before
//     now + CLOCK_OUT_LOOKAHEAD_S, each stamped with its own time (send(data, timestamp)), so
//     the main thread's lateness moves no tick.
//   - Choosing no output sends nothing; choosing another output first stops the old one. A send
//     that throws (the port closed) ends every send to that port and says so once.
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

import { createClockOut, tickS, SPP_TICKS } from './clock-out.js';

/** How often the mode wakes while a run is sent (UI bookkeeping, not the clock's time). */
export const CLOCK_OUT_TICK_MS = 25;
/** How often it wakes while an output is chosen and nothing plays. */
export const CLOCK_OUT_IDLE_MS = 100;
/** How far ahead of now each wake sends the ticks (each stamped with its own time). */
export const CLOCK_OUT_LOOKAHEAD_S = 0.1;
/** How long after a run's start from 0 the output still starts it (Start and the missed ticks). */
export const CATCHUP_S = CLOCK_OUT_IDLE_MS / 1000 + CLOCK_OUT_LOOKAHEAD_S + 0.05;
/** Two origins closer than this are the same run (a re-plan keeps its origin). */
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

const valid = (a) => !!a && a.tempo > 0 && Number.isFinite(a.origin)
  && Number.isInteger(a.tick0 ?? 0) && (a.tick0 ?? 0) >= 0;
/** Where grid `a` places song tick `s`. */
const gridAt = (a, s) => a.origin + (s - (a.tick0 || 0)) * tickS(a.tempo);
const sameRun = (a, b) => (a.run !== undefined && b.run !== undefined ? a.run === b.run
  : Math.abs(a.origin - b.origin) <= ORIGIN_EPS_S);
const sameGrid = (a, b) => a.tempo === b.tempo && (a.tick0 || 0) === (b.tick0 || 0)
  && Math.abs(a.origin - b.origin) <= ORIGIN_EPS_S;

export function createClockOutMode({ clock, ctxNow, stamp, anchor, say = () => {} }) {
  let port = null;
  let out = null;
  let run = null; // the anchor of the run being sent
  let woken = false;

  const wake = (ms) => {
    if (!clock || woken) return;
    woken = true;
    clock.wake(WAKE_KEY, ms, () => { woken = false; mode.tick(); });
  };
  const cancel = () => {
    if (clock) clock.cancel(WAKE_KEY);
    woken = false;
  };

  const drop = () => {
    port = null;
    out = null;
    run = null;
    cancel();
    say('send-failed');
  };

  const open = (p) => {
    let dead = false;
    return createClockOut({
      send: (bytes, at) => {
        if (dead) return;
        try {
          p.send(bytes, at);
        } catch {
          dead = true;
          if (port === p) drop();
        }
      },
      stamp,
    });
  };

  // Enter run `a` at `now`, no earlier than `after` (the Stop of the run before it, stamped
  // after its queued ticks): Start from its origin when it began at 0 just now, else join it at
  // the first sixteenth on its grid at or after both.
  const enter = (a, now, after = -Infinity) => {
    const t0 = a.tick0 || 0;
    if (a.fromStart && t0 === 0 && now - a.origin <= CATCHUP_S && a.origin >= after) {
      out.start(a.origin, a.tempo);
    } else {
      const from = Math.max(now, after);
      const k = Math.max(0, Math.ceil((from - a.origin) / tickS(a.tempo) - 1e-9));
      const s = Math.ceil((t0 + k) / SPP_TICKS) * SPP_TICKS;
      out.locate(s, Number.isFinite(after) ? after : undefined);
      if (out) out.resume(gridAt(a, s), a.tempo, s);
    }
    run = { ...a };
  };
  const end = () => (out && out.running() ? out.stop() : -Infinity);

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
      if (!valid(a)) {
        if (out.running()) out.stop();
        run = null;
      } else if (!run || !sameRun(a, run)) {
        const after = end();
        if (out) enter(a, now, after);
      } else if (!sameGrid(a, run)) {
        const after = end();
        if (out) enter({ ...a, fromStart: false }, now, after);
      }
      if (out && out.running()) out.pass(now + CLOCK_OUT_LOOKAHEAD_S);
      if (out) wake(out.running() ? CLOCK_OUT_TICK_MS : CLOCK_OUT_IDLE_MS);
    },
    dispose() {
      mode.setOutput(null);
    },
  };
  return mode;
}
