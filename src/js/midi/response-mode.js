// The call-and-response mode on a page: it listens to the player's notes, hears a phrase end and
// plays the answer on the one instrument (plan issue V503; ADR 0058, its V503 note).
//
// The rule is midi/response.js's (pure). This module is its wiring, with every dependency handed
// in so a unit test runs it on a fake clock:
//   - it hears only the player: player(kind, note, velocity, atMs) is fed the play port's notes
//     (and the computer keys'); the answer's own notes never come back in (A1);
//   - it asks whether the phrase ended on the one transport clock's wake-up (audio/clock.js
//     createTransportClock: the same timer every scheduler of the engine wakes from, UI
//     bookkeeping that schedules no sound), only while the mode is on and a phrase is open (A2);
//   - it plays the answer through the note layer's own noteOn / noteOff (notes.js: the owner
//     table, the one instrument of K247, one polyphony pool), each note planned at its context
//     time `at` no more than ANSWER_LOOKAHEAD_S ahead, so a new note of the player cuts it: what
//     is not planned yet is dropped and what sounds is released now (the player always wins, A5);
//   - the answer starts at the phrase's end + PHRASE_GAP_MS mapped to the audio clock
//     (audio/clock.js perfToContextS over one clockOffsetS reading); a start already past
//     begins at now + START_OFFSET_S and the later notes keep their relative onsets (A3).
//
//   createResponseMode(deps) -> { on, setOn(on), player(kind, note, velocity, atMs), tick(),
//     cut(), answering(), planned() }
//   deps: { notes, clock: { wake(key, ms, fn), cancel(key) }, offsetS() (s, or null),
//     ctxNow() (s), perfNow() (ms), safeMax() (Hz), a4() (Hz), polyphony,
//     say(reason) (the answer is refused: once per answer, the rest of it dropped) }

import { START_OFFSET_S } from '../core/constants.js';
import { perfToContextS } from '../audio/clock.js';
import { ANSWER_SOURCE, PHRASE_GAP_MS, answer, createPhrase } from './response.js';

/** How far ahead an answer note is planned on the audio clock (cut by the player within it). */
export const ANSWER_LOOKAHEAD_S = 0.1;
/** How often the mode wakes while a phrase is open or an answer plays (UI bookkeeping). */
export const RESPONSE_TICK_MS = 50;
const WAKE_KEY = 'midi-response';

export function createResponseMode({ notes, clock, offsetS, ctxNow, perfNow, safeMax,
  a4 = () => 440, polyphony = 8, say = () => {} }) {
  const phrase = createPhrase();
  let on = false;
  let queue = []; // { note, velocity, onAt, offAt, started, ended } in context seconds
  const wake = () => clock.wake(WAKE_KEY, RESPONSE_TICK_MS, () => mode.tick());
  const busy = () => queue.some((n) => !n.ended);

  /** The answer to the phrase that just ended, placed on the audio clock. */
  function plan() {
    const endMs = phrase.endsAt();
    const notesOf = phrase.take();
    const offset = offsetS();
    if (endMs === null || offset === null) return;
    const ans = answer(notesOf, { polyphony, maxFrequency: safeMax(), a4: a4() });
    if (!ans.length) return;
    let t0 = perfToContextS(endMs + PHRASE_GAP_MS, offset);
    const earliest = ctxNow() + START_OFFSET_S;
    if (t0 < earliest) t0 = earliest; // late: begin now, keep the relative onsets
    queue = ans.map((n) => ({ note: n.note, velocity: n.velocity, onAt: t0 + n.start / 1000,
      offAt: t0 + (n.start + n.length) / 1000, started: false, ended: false }));
  }

  /** Every on and off of the answer that falls within the lookahead, at its own time. */
  function schedule() {
    const until = ctxNow() + ANSWER_LOOKAHEAD_S;
    for (const n of queue) {
      if (!n.started && n.onAt < until) {
        n.started = true;
        const r = notes.noteOn(n.note, n.velocity, ANSWER_SOURCE, 0, { at: n.onAt });
        if (!r || r.ok === false) {
          // Refused (an owner holds the output, or no instrument can plan it): said once for
          // this answer, and the rest of it is not tried (C3 on V503, (a)).
          n.ended = true; // it never sounded: nothing to release
          say((r && r.reason) || 'refused');
          mode.cut();
          return;
        }
      }
      if (n.started && !n.ended && n.offAt < until) {
        n.ended = true;
        notes.noteOff(n.note, ANSWER_SOURCE, 0, { at: n.offAt });
      }
    }
    if (!busy()) queue = [];
  }

  const mode = {
    get on() { return on; },
    setOn(v) {
      on = !!v;
      if (!on) {
        mode.cut();
        phrase.clear();
        clock.cancel(WAKE_KEY);
      }
      return on;
    },
    /** A note of the player: 'on' (velocity > 0) or 'off', at its event time (ms). */
    player(kind, note, velocity, atMs) {
      if (!on) return false;
      if (kind === 'on') {
        if (busy()) mode.cut(); // the player always wins
        phrase.on(note, velocity, atMs);
      } else {
        phrase.off(note, atMs);
      }
      wake();
      return true;
    },
    tick() {
      if (!on) return;
      if (!queue.length && phrase.ended(perfNow())) plan();
      if (queue.length) schedule();
      if (busy() || phrase.endsAt() !== null || queue.length) wake();
    },
    /** The answer stops: nothing more is planned, what sounds is released now. */
    cut() {
      // A note planned a moment ahead is released at its own start, not before it, so its
      // planned on can never sound after the release and hang.
      const now = ctxNow();
      for (const n of queue) {
        if (n.started && !n.ended) {
          notes.noteOff(n.note, ANSWER_SOURCE, 0, { forced: true, at: Math.max(now, n.onAt) });
        }
      }
      queue = [];
    },
    answering: () => busy(),
    planned: () => queue.map((n) => ({ ...n })),
  };
  return mode;
}
