// Click-free gain ramps for Studio routes (spec §45; ADR 0001 applied to edge gains).
//
//   createRamp(param, initial, now, sampleRate) -> ramp
//     ramp.to(target, at, dur)   linear ramp from the value the param HAS at `at` to `target`
//     ramp.valueAt(t)            the scheduled value at audio time t (from the recorded segment)
//     ramp.target                the value the last ramp ends at
//
// Like the engine's _freeze (voice.js freezeParam, ADR 0001), a new ramp never cancels the
// segment that is sounding: it re-ends the in-progress segment at `at` on its own line (a
// linear ramp to the value it would have there) BEFORE cancelling only the events after it,
// then ramps to the target; with no ramp in progress it only anchors the value at `at`. No
// cancelAndHoldAtTime, one code path in every browser, so a crossfade started in the middle of
// another one continues from the exact current gain. `at` is expected from
// hooks.soon() (a render-quantum boundary ahead of currentTime); a second ramp scheduled at or
// before the start of the previous one is moved one render quantum after it, so an event is
// never replaced at the same time.

export function createRamp(param, initial, now, sampleRate = 48000) {
  const quantum = 128 / sampleRate;
  let seg = { t0: now, v0: initial, t1: now, v1: initial };
  // The intrinsic value as well: a node connected while the graph renders must not pass even
  // one sample at the GainNode default 1 before the event at `now` applies (measured in
  // WebKit: a one-sample doubling when a new route was connected).
  param.value = initial;
  param.setValueAtTime(initial, now);

  const valueAt = (t) => {
    if (t >= seg.t1) return seg.v1;
    if (t <= seg.t0) return seg.v0;
    return seg.v0 + ((seg.v1 - seg.v0) * (t - seg.t0)) / (seg.t1 - seg.t0);
  };

  return {
    valueAt,
    get target() { return seg.v1; },
    to(target, at, dur) {
      const t = at > seg.t0 ? at : seg.t0 + quantum;
      const v = valueAt(t);
      // Insert the hold first, then cancel only what follows it (the old segment's end):
      // never cancelScheduledValues at `t` itself, which Firefox renders with a step.
      if (seg.t0 < t && t < seg.t1) param.linearRampToValueAtTime(v, t);
      else param.setValueAtTime(v, t);
      if (seg.t1 > t) param.cancelScheduledValues(seg.t1);
      const end = t + Math.max(quantum, dur);
      param.linearRampToValueAtTime(target, end);
      seg = { t0: t, v0: v, t1: end, v1: target };
      return end;
    },
  };
}
