// The computer and on-screen keyboard (plan issue K026; ADR 0058, ADR 0062). Pure: no DOM, no
// audio. It decides which note a key or a pointer plays, keeps the octave and the velocity, and
// knows which notes each source holds, so the on-screen keys light up whoever pressed them.
//
// The layout is the convention of music software, by physical key (KeyboardEvent.code), so a
// QWERTZ or AZERTY keyboard plays from the same places (on QWERTZ the key labelled Z is KeyY):
//
//      W E   T Y U   O P          black keys   C#  D#   F#  G#  A#   C#  D#
//     A S D F G H J K L ; '      white keys   C  D  E  F  G  A  B  C  D  E  F
//
//   Z / X   one octave down / up        C / V   velocity down / up (by VELOCITY_STEP)
//
// Space is never a keyboard key: it stays the workspace's play key (ADR 0050). A note sounds
// while its key is held, past the safety limit (ADR 0062), until the key goes up or a forced
// release (blur, hide, Escape) lets go of every note.

/** Physical key -> semitones above the octave's C (the A key). */
export const NOTE_KEYS = Object.freeze({
  KeyA: 0, KeyW: 1, KeyS: 2, KeyE: 3, KeyD: 4, KeyF: 5, KeyT: 6, KeyG: 7, KeyY: 8, KeyH: 9,
  KeyU: 10, KeyJ: 11, KeyK: 12, KeyO: 13, KeyL: 14, KeyP: 15, Semicolon: 16, Quote: 17,
});

/** Physical key -> a control of the keyboard. */
export const CONTROL_KEYS = Object.freeze({
  KeyZ: 'octave-down', KeyX: 'octave-up', KeyC: 'velocity-down', KeyV: 'velocity-up',
});

/** The QWERTY label of each key, shown on the on-screen keys when the layout is not known. */
export const KEY_LABELS = Object.freeze(Object.fromEntries(
  [...Object.keys(NOTE_KEYS), ...Object.keys(CONTROL_KEYS)].map((code) => [code,
    code.startsWith('Key') ? code.slice(3) : { Semicolon: ';', Quote: '\'' }[code]]),
));

/** The views the keyboard is armed in, each with its own switch. */
export const KEYBOARD_VIEWS = Object.freeze(['playground', 'studio']);
/** The link key that arms (1) or disarms (0) the keyboard of the view a link opens. */
export const KEYBOARD_LINK_KEY = 'kbd';

export const DEFAULT_BASE = 60;      // the A key plays C4 (MIDI 60)
export const MIN_BASE = 12;          // C0
export const MAX_BASE = 108;         // C8; the keys above it reach MIDI 125 at most
export const DEFAULT_VELOCITY = 100;
export const VELOCITY_STEP = 20;
export const MIN_VELOCITY = 1;
export const MAX_VELOCITY = 127;

const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

/** MIDI note -> its name in scientific pitch notation (60 -> 'C4'). */
export function noteName(note) {
  const n = Math.round(note);
  return `${NAMES[((n % 12) + 12) % 12]}${Math.floor(n / 12) - 1}`;
}

/** True for a black key (C#, D#, F#, G#, A#). */
export function isBlack(note) {
  return [1, 3, 6, 8, 10].includes(((Math.round(note) % 12) + 12) % 12);
}

/**
 * What a physical key does: { kind: 'note', offset } | { kind: 'control', action } | null.
 * Space and every unmapped key are null.
 */
export function resolveKey(code) {
  if (Object.prototype.hasOwnProperty.call(NOTE_KEYS, code)) {
    return { kind: 'note', offset: NOTE_KEYS[code] };
  }
  if (Object.prototype.hasOwnProperty.call(CONTROL_KEYS, code)) {
    return { kind: 'control', action: CONTROL_KEYS[code] };
  }
  return null;
}

/** A key event the keyboard may take: no Ctrl, Meta or Alt (those are shortcuts), never Space. */
export function playableEvent(e) {
  if (!e || e.ctrlKey || e.metaKey || e.altKey) return false;
  if (e.code === 'Space' || e.key === ' ') return false;
  return resolveKey(e.code) !== null;
}

const clampInt = (v, lo, hi) => Math.min(hi, Math.max(lo, Math.round(v)));

/**
 * The notes the on-screen keyboard shows: { first, last } (MIDI notes, both C), `octaves`
 * octaves (2 or 3) around `base`, the octave of the A key; with 3, one octave below it.
 */
export function visibleRange(base, octaves = 3) {
  const n = octaves >= 3 ? 3 : 2;
  const first = clampInt(base - (n === 3 ? 12 : 0), 0, 127 - 12 * n);
  return { first, last: first + 12 * n };
}

/** The physical key that plays `note` at `base`, or null (the lowest code for a note). */
export function codeForNote(note, base) {
  for (const [code, off] of Object.entries(NOTE_KEYS)) if (base + off === note) return code;
  return null;
}

/**
 * The keyboard of one page. `play(note, velocity, source)` starts a note and returns whether
 * it sounds ({ ok }); `release(note, source)` lets it go; `changed()` is told after every
 * change of what is held or of the octave and velocity (the view redraws, the readout updates).
 *
 * Sources: 'keys' (the computer keyboard), 'pointer' (the on-screen keys), 'midi' (a MIDI
 * input, lit by the MIDI layer through light()). The keyboard plays 'keys' and 'pointer'
 * itself; light() only shows what another layer plays.
 */
export function createKeyboard({ play = () => ({ ok: true }), release = () => {},
  changed = () => {} } = {}) {
  let base = DEFAULT_BASE;
  let velocity = DEFAULT_VELOCITY;
  const keys = new Map();      // physical key held -> the note it started (octave may move)
  const pointers = new Map();  // pointer id -> the note it holds
  const lit = new Map();       // note -> Set of sources holding it

  function light(note, source, on) {
    const set = lit.get(note) || new Set();
    if (on) set.add(source); else set.delete(source);
    if (set.size) lit.set(note, set); else lit.delete(note);
  }

  function start(note, source) {
    if (!(note >= 0 && note <= 127)) return false;
    const r = play(note, velocity, source) || {};
    if (r.ok) light(note, source, true);
    return !!r.ok;
  }

  function stop(note, source) {
    if (lit.has(note) && lit.get(note).has(source)) release(note, source);
    light(note, source, false);
  }

  const api = {
    get base() { return base; },
    get octave() { return Math.floor(base / 12) - 1; },
    get velocity() { return velocity; },

    /** Notes lit now, ascending: [{ note, sources: [...] }]. */
    get held() {
      return [...lit.keys()].sort((a, b) => a - b)
        .map((note) => ({ note, sources: [...lit.get(note)].sort() }));
    },
    isLit(note) { return lit.has(note); },
    get sounding() { return lit.size > 0; },

    /** A keydown of physical key `code`; repeats are ignored. Returns what it did, or null. */
    keyDown(code, repeat = false) {
      const r = resolveKey(code);
      if (!r) return null;
      if (r.kind === 'control') {
        if (!repeat) api.control(r.action);
        return r;
      }
      if (repeat || keys.has(code)) return r;
      const note = base + r.offset;
      if (start(note, 'keys')) keys.set(code, note);
      changed();
      return r;
    },

    /** A keyup of physical key `code`: the note it started is released. */
    keyUp(code) {
      if (!keys.has(code)) return false;
      const note = keys.get(code);
      keys.delete(code);
      if (![...keys.values()].includes(note)) stop(note, 'keys');
      changed();
      return true;
    },

    /** Octave and velocity: 'octave-down' | 'octave-up' | 'velocity-down' | 'velocity-up'. */
    control(action) {
      if (action === 'octave-down') base = clampInt(base - 12, MIN_BASE, MAX_BASE);
      else if (action === 'octave-up') base = clampInt(base + 12, MIN_BASE, MAX_BASE);
      else if (action === 'velocity-down') {
        velocity = clampInt(velocity - VELOCITY_STEP, MIN_VELOCITY, MAX_VELOCITY);
      } else if (action === 'velocity-up') {
        velocity = clampInt(velocity + VELOCITY_STEP, MIN_VELOCITY, MAX_VELOCITY);
      } else return false;
      changed();
      return true;
    },

    /** A pointer on the on-screen key `note` (null: off the keys). Moving glides. */
    pointerTo(id, note) {
      const was = pointers.has(id) ? pointers.get(id) : null;
      if (was === note) return;
      if (was !== null) {
        pointers.delete(id);
        if (![...pointers.values()].includes(was)) stop(was, 'pointer');
      }
      if (note !== null && note !== undefined) {
        if ([...pointers.values()].includes(note) || start(note, 'pointer')) pointers.set(id, note);
      }
      changed();
    },

    /** The pointer is up, cancelled or lost. */
    pointerUp(id) { api.pointerTo(id, null); },

    /** Show a note another layer plays (MIDI): lit while `on`. */
    light(note, source, on) {
      light(note, source, on);
      changed();
    },

    /** Unlight every note of `source` (all sources when omitted) without releasing it. */
    clear(source) {
      for (const note of [...lit.keys()]) {
        if (source === undefined) lit.delete(note); else light(note, source, false);
      }
      if (source === undefined || source === 'keys') keys.clear();
      if (source === undefined || source === 'pointer') pointers.clear();
      changed();
    },

    /**
     * Let go of every note this keyboard plays (blur, hide, Escape, the view left): each is
     * released, and nothing stays lit. Returns how many were held.
     */
    releaseAll() {
      const n = keys.size + pointers.size;
      for (const note of new Set([...keys.values(), ...pointers.values()])) {
        if (lit.has(note) && lit.get(note).has('keys')) release(note, 'keys');
        if (lit.has(note) && lit.get(note).has('pointer')) release(note, 'pointer');
      }
      keys.clear();
      pointers.clear();
      for (const note of [...lit.keys()]) {
        light(note, 'keys', false);
        light(note, 'pointer', false);
      }
      changed();
      return n;
    },
  };
  return api;
}
