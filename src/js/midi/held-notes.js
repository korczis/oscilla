// The held notes of the keys (plan issue K178, "one keyboard"): which key holds which note, at
// what velocity, from which input, and on which sink it started. Pure: no DOM, no audio, no
// timers. A note is always released on the sink that took it, whatever routes a later note
// (K175, K176): a key's note-off, its re-press, the bound and every forced release (blur, hide,
// Escape, a workspace switch, a disarm, an unplugged input, All Notes Off) go to the sink
// recorded at its hold.
//
//   createHeldNotes({ perInput, onError }) -> {
//     hold(key, { sink, note, velocity, input })   record a held key; a re-press of a held key
//                                                  first releases it on its old sink
//     releaseKey(key, reason = 'note-off')         -> sink | null: removes the key and returns
//                                                  the sink its note started on (the caller
//                                                  sends the note-off; nothing is called here)
//     held()                                       -> [{ key, note, velocity, input, sink }]
//                                                  a copy, in the order the keys were held
//     sinkOf(key)                                  -> sink | null
//     legato(oldKey, newKey, { note, velocity })   -> sink | null: moves a held key's note to
//                                                  newKey on the same sink and input without a
//                                                  release (a slide: the caller sends the
//                                                  sink's legato, or a note-off and a note-on);
//                                                  null and nothing changed when oldKey is not
//                                                  held. A newKey already held elsewhere is
//                                                  first released on its own sink ('re-press')
//     releaseAll(reason, { sink, input } = {})     -> count: releases every matching key
//                                                  through its sink and removes it (sink: the
//                                                  same object or noteOff; input: 'midi', ...)
//     on(fn)                                       -> off: fn({ type: 'hold' | 'release', key,
//                                                  reason }) after each change (a legato emits
//                                                  release oldKey then hold newKey, reason
//                                                  'legato')
//   }
//
// key: `${source}:${channel}:${note}` (midi/notes.js keyOf). A sink is any object with a
// noteOff(note, info) function, the note-off every sink of midi/notes.js already has (the
// Synth panel's synthSink, the Studio sink, the Playground voice); info is { key, reason,
// velocity, input }. This module never looks further into a sink.
//
// Bound: at most `perInput` (128, one per MIDI note) keys per input, so never more than
// 128 x inputs keys; a hold beyond it first releases that input's oldest key ('bound').
// Every entry is removed before its sink is called or a listener told, so a sink or listener
// that throws leaves no entry behind: a sink's error is thrown once every other release ran,
// a listener's goes to onError (by default thrown on its own, in a microtask) and never
// stops a release.

export const HELD_PER_INPUT = 128;

/** The reasons a key is released, by the caller (releaseKey, releaseAll) or here. */
export const RELEASE_REASONS = Object.freeze(['note-off', 're-press', 'legato', 'bound', 'blur',
  'hide', 'escape', 'switch', 'disarm', 'unplug', 'all-off', 'silence']);

/**
 * Whether two sinks are the same player. A sink is its note-off: route() may hand out a fresh
 * object for the same player (synth/ui.js synthSink), so the object or its noteOff matches.
 */
export function sameSink(a, b) {
  return a === b || (!!a && !!b && a.noteOff === b.noteOff);
}

// A listener's error is reported apart from the release it interrupted, later.
const reportLater = (e) => { queueMicrotask(() => { throw e; }); };

export function createHeldNotes({ perInput = HELD_PER_INPUT, onError = reportLater } = {}) {
  if (!(Number.isInteger(perInput) && perInput > 0)) {
    throw new TypeError(`createHeldNotes: perInput musí být kladné celé číslo, ne ${perInput}`);
  }
  const entries = new Map(); // key -> { key, note, velocity, input, sink }, in hold order
  const listeners = new Set();

  // Runs every step, then throws the first error any of them threw.
  function settle(steps) {
    let failure = null;
    for (const step of steps) {
      try { step(); } catch (e) { if (!failure) failure = e; }
    }
    if (failure) throw failure;
  }
  // A listener that throws never stops a release: its error goes to onError.
  const emit = (type, key, reason) => () => {
    for (const fn of [...listeners]) {
      try { fn({ type, key, reason }); } catch (e) { onError(e); }
    }
  };
  // The steps that release one removed entry: its sink's note-off, then the event.
  const releaseSteps = (e, reason) => [
    () => e.sink.noteOff(e.note, { key: e.key, reason, velocity: e.velocity, input: e.input }),
    emit('release', e.key, reason),
  ];
  const copy = (e) => ({ key: e.key, note: e.note, velocity: e.velocity, input: e.input,
    sink: e.sink });

  function hold(key, { sink, note, velocity = 0, input } = {}) {
    if (typeof key !== 'string' || !key) throw new TypeError('hold: key musí být řetězec');
    if (!sink || typeof sink.noteOff !== 'function') {
      throw new TypeError(`hold: sink pro ${key} nemá noteOff(note, info)`);
    }
    const entry = { key, note, velocity, input: input === undefined ? key.split(':')[0] : input,
      sink };
    const steps = [];
    const prev = entries.get(key);
    if (prev) {
      entries.delete(key);
      steps.push(...releaseSteps(prev, 're-press'));
    }
    const same = [...entries.values()].filter((e) => e.input === entry.input);
    for (const old of same.slice(0, Math.max(0, same.length - perInput + 1))) {
      entries.delete(old.key);
      steps.push(...releaseSteps(old, 'bound'));
    }
    entries.set(key, entry);
    steps.push(emit('hold', key, 'hold'));
    settle(steps);
  }

  function releaseKey(key, reason = 'note-off') {
    const e = entries.get(key);
    if (!e) return null;
    entries.delete(key);
    emit('release', key, reason)();
    return e.sink;
  }

  function legato(oldKey, newKey, { note, velocity } = {}) {
    if (typeof newKey !== 'string' || !newKey) {
      throw new TypeError('legato: newKey musí být řetězec');
    }
    const from = entries.get(oldKey);
    if (!from) return null;
    if (oldKey === newKey) return from.sink;
    const steps = [];
    entries.delete(oldKey);
    const taken = entries.get(newKey);
    if (taken) {
      entries.delete(newKey);
      steps.push(...releaseSteps(taken, 're-press'));
    }
    entries.set(newKey, { key: newKey, note, velocity: velocity === undefined ? from.velocity
      : velocity, input: from.input, sink: from.sink });
    steps.push(emit('release', oldKey, 'legato'), emit('hold', newKey, 'legato'));
    settle(steps);
    return from.sink;
  }

  function releaseAll(reason, { sink, input } = {}) {
    if (typeof reason !== 'string' || !reason) {
      throw new TypeError('releaseAll: chybí důvod (reason)');
    }
    const gone = [...entries.values()].filter((e) => (sink === undefined
      || sameSink(e.sink, sink)) && (input === undefined || e.input === input));
    for (const e of gone) entries.delete(e.key);
    settle(gone.flatMap((e) => releaseSteps(e, reason)));
    return gone.length;
  }

  return {
    hold,
    releaseKey,
    legato,
    releaseAll,
    held: () => [...entries.values()].map(copy),
    sinkOf: (key) => (entries.has(key) ? entries.get(key).sink : null),
    get size() { return entries.size; },
    on(fn) {
      if (typeof fn !== 'function') throw new TypeError('on: je třeba předat funkci');
      listeners.add(fn);
      return () => { listeners.delete(fn); };
    },
  };
}
