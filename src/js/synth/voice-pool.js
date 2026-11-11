// The voice allocator of the Synth engines. Q021, the owner's answer of 2026-11-03 as recorded
// on its evidence: "Up to 8 voices, 1/8 gain": an engine node holds up to 8 voices at 1/8 gain
// each, as V502's note voices do, and the semi-modular panel stays monophonic (K180; the gain is
// studio/adapters/voices.js's VOICE_LEVEL_SCALE). Pure bookkeeping: it decides which slot a note plays in and which voice it
// steals; the Web Audio lifecycle of a voice is studio/adapters/voices.js.
//
//   createVoicePool({ max = MAX_VOICES }) -> pool
//     pool.on(note, t)  -> { slot, steal: slot | null, retrigger: bool }
//                          the same note held again retriggers its own slot; a free slot is
//                          taken; when all `max` are in use the released voice that released
//                          first is stolen, else the oldest held one (first and oldest: in
//                          the order they reached the pool, never by time; E071)
//     pool.off(note, t) -> slot | null      the slot now releasing (its end is set by end())
//     pool.end(slot, t) -> void             the slot's release ends at t (free after it)
//     pool.free(slot)   -> void             the slot is disposed: empty
//     pool.allOff(t)    -> [slot]           every held slot, now releasing
//     pool.active(t)    -> number           slots sounding at t (held, or releasing before end)
//     pool.heldSlot(note) -> slot | null    the slot holding `note` (not released), if any
//     pool.slots()      -> [{ slot, note, on, released, end }]
// Every loop runs over the `max` slots once: no loop depends on a side effect to terminate
// (the lesson of #261's R-2).

export const MAX_VOICES = 8;

export function createVoicePool({ max = MAX_VOICES } = {}) {
  const n = Math.max(1, Math.min(64, Math.floor(max)));
  const slots = Array.from({ length: n }, (_, i) => ({ slot: i, note: null, on: -Infinity,
    released: null, end: -Infinity }));
  const sounding = (s, t) => s.note !== null && (s.released === null || s.end > t);
  // E071: age is the order notes arrived and were released in, kept beside the slots (slots()
  // is unchanged), never their times: the engine's schedule time can tie across a burst and
  // step back (WebKit: 4-6 ties in 8 notes, one step 17 ms back), and a slot index is no age
  // either (a released voice keeps the lowest slot until its release ends).
  let clock = 0;
  const onAt = new Array(n).fill(0);
  const offAt = new Array(n).fill(0);

  function on(note, t) {
    const same = slots.find((s) => s.note === note && s.released === null);
    if (same) {
      same.on = t;
      onAt[same.slot] = ++clock;
      return { slot: same.slot, steal: null, retrigger: true };
    }
    let pick = slots.find((s) => !sounding(s, t));
    let steal = null;
    if (!pick) {
      let released = null;
      let oldest = null;
      for (const s of slots) {
        if (s.released !== null && (!released || offAt[s.slot] < offAt[released.slot])) {
          released = s;
        }
        if (!oldest || onAt[s.slot] < onAt[oldest.slot]) oldest = s;
      }
      pick = released || oldest;
      steal = pick.slot;
    }
    Object.assign(pick, { note, on: t, released: null, end: Infinity });
    onAt[pick.slot] = ++clock;
    return { slot: pick.slot, steal, retrigger: false };
  }

  function off(note, t) {
    const s = slots.find((x) => x.note === note && x.released === null);
    if (!s) return null;
    s.released = t;
    offAt[s.slot] = ++clock;
    return s.slot;
  }

  return {
    max: n,
    on,
    off,
    end(slot, t) { slots[slot].end = t; },
    free(slot) { Object.assign(slots[slot], { note: null, released: null, end: -Infinity }); },
    allOff(t) {
      const out = [];
      for (const s of slots) {
        if (s.note !== null && s.released === null) {
          s.released = t;
          offAt[s.slot] = ++clock;
          out.push(s.slot);
        }
      }
      return out;
    },
    active: (t) => slots.filter((s) => sounding(s, t)).length,
    heldSlot(note) {
      const s = slots.find((x) => x.note === note && x.released === null);
      return s ? s.slot : null;
    },
    held: () => slots.filter((s) => s.note !== null && s.released === null).map((s) => s.note),
    slots: () => slots.map((s) => ({ ...s })),
  };
}
