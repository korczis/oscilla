// The one key registry of the page (owner, 2026-11-02: "keyboard and shortcuts barely work,
// aren't reused, aren't a component"). Every key and Space has exactly one owner per scope;
// a second owner for the same chord in the same scope throws at bind, so a conflict cannot
// ship. Pure: no DOM, no audio; dispatcher.js is the one listener that asks it.
//
// A chord is a KeyboardEvent.code with its modifiers, in a fixed order:
// 'Space', 'KeyR', 'Shift+KeyR', 'Ctrl+KeyZ', 'Alt+Shift+ArrowLeft' (Ctrl, Meta, Alt, Shift).
// Codes, not characters: the same physical key on every layout, as the QWERTY piano needs.
//
// A scope is { workspace, view?, focus? }:
//   workspace  an app.js workspace id, or '*' for every workspace
//   view       a part of a workspace that owns keys of its own while shown (the Synth's 'xy'
//              tab); the context resolver of the dispatcher says which view is shown
//   focus      'none' (default: nothing that owns keys is focused), 'dialog' (a modal is open),
//              'text' (an input, textarea, select or contenteditable has focus), 'piano'
//              (the on-screen keyboard has focus), or '*' for any of them (a page-wide stop
//              such as Escape, which acts wherever the focus is)
// The most specific matching binding wins: a view over its workspace, a workspace over '*',
// an exact focus over focus '*'. prevent: false runs the binding and leaves the event's default
// action alone (Escape still closes an open dialog).
// Two bindings conflict when chord, workspace, view and focus are all equal.
//
//   const keys = createKeyRegistry();
//   const unbind = keys.bind({ id, keys: ['Space'], scope: { workspace: 'synth', view: 'xy' },
//     run(e), up?(e), when?(), repeat?: false, label, group });
//   keys.declare({ id, keys?: [chord], shown?, scope, label, ... }) -> undeclare
//     a help-only declaration: a key whose listener is still outside this registry (the
//     keyboard's notes, the Sequencer timeline, the step grid, Studio). It is listed by
//     helpRows and never resolved, so it owns no chord and cannot conflict with a binding.
//   keys.resolve(chord, { workspace, view, focus }) -> binding | null
//   keys.list() -> [binding and declaration, in order]   (the shortcuts help reads it: helpRows)
//
// What the help shows of a binding or a declaration (ui/shortcuts.js declares the dialog's):
//   row      the help row's id (data-osc-shortcut), when two declarations share one
//   shown    the keys as the help writes them ('Ctrl/⌘ C, X, V'); else its chords' labels
//   place    where it applies, the words beside the keys
//   shownIn  the workspaces whose help lists it; else its scope's (every one for '*')
//   section  'space' (the Space meaning), 'everywhere' or 'workspace'; else derived: a '*'
//            scope listed in no named workspaces is 'everywhere'
//   chordOf(event) -> chord;  keyLabel(chord) -> 'Shift+R', '[', 'Space', '←'

const MODS = ['Ctrl', 'Meta', 'Alt', 'Shift'];
export const FOCUS = Object.freeze(['none', 'dialog', 'text', 'piano', '*']);

/** The chord of a keyboard event (or of { code, ctrlKey, metaKey, altKey, shiftKey }). */
export function chordOf(e) {
  const on = [e.ctrlKey && 'Ctrl', e.metaKey && 'Meta', e.altKey && 'Alt', e.shiftKey && 'Shift'];
  return [...on.filter(Boolean), codeOf(e)].join('+');
}

/** e.code, or for an event that carries only a key (a synthetic one) the code that key names. */
export function codeOf(e) {
  if (e.code) return e.code;
  const k = e.key || '';
  if (k === ' ' || k === 'Spacebar') return 'Space';
  if (/^[a-z]$/i.test(k)) return `Key${k.toUpperCase()}`;
  if (/^[0-9]$/.test(k)) return `Digit${k}`;
  return k;
}

/** A chord written by hand, checked and put in the canonical modifier order. */
export function normalizeChord(chord) {
  const parts = String(chord).split('+');
  const code = parts.pop();
  if (!code || MODS.includes(code)) throw new TypeError(`keys: "${chord}" names no key`);
  for (const m of parts) {
    if (!MODS.includes(m)) throw new TypeError(`keys: "${chord}": unknown modifier "${m}"`);
  }
  return [...MODS.filter((m) => parts.includes(m)), code].join('+');
}

const NAMES = { Space: 'Space', BracketLeft: '[', BracketRight: ']', ArrowLeft: '←',
  ArrowRight: '→', ArrowUp: '↑', ArrowDown: '↓', Escape: 'Esc', Enter: 'Enter',
  Comma: ',', Period: '.', Slash: '/', Semicolon: ';', Quote: "'", Minus: '-', Equal: '=',
  Backquote: '`', Backslash: '\\', Backspace: 'Backspace', Delete: 'Delete', Tab: 'Tab' };

/** The label of a chord as the shortcuts help shows it: 'Shift+R', '[', 'Space', '←'. */
export function keyLabel(chord) {
  const parts = normalizeChord(chord).split('+');
  const code = parts.pop();
  const name = NAMES[code] || code.replace(/^Key/, '').replace(/^Digit/, '')
    .replace(/^Numpad/, 'Num ');
  return [...parts, name].join('+');
}

const specificity = (s) => (s.view ? 4 : s.workspace === '*' ? 0 : 2) + (s.focus === '*' ? 0 : 1);
const same = (a, b) => a.workspace === b.workspace && (a.view || null) === (b.view || null)
  && a.focus === b.focus;

function checkBinding(b, { help = false } = {}) {
  if (!b || typeof b.id !== 'string' || !b.id) throw new TypeError('keys: a binding needs an id');
  const chords = Array.isArray(b.keys) && b.keys.length;
  if (!chords && !(help && typeof b.shown === 'string' && b.shown)) {
    throw new TypeError(`keys: ${b.id} has no keys`);
  }
  if (!help && typeof b.run !== 'function') throw new TypeError(`keys: ${b.id} has no run()`);
  const s = b.scope || {};
  if (typeof s.workspace !== 'string' || !s.workspace) {
    throw new TypeError(`keys: ${b.id} needs scope.workspace (an id or '*')`);
  }
  const focus = s.focus || 'none';
  if (!FOCUS.includes(focus)) throw new TypeError(`keys: ${b.id}: unknown focus "${focus}"`);
  if (typeof b.label !== 'string' || !b.label) {
    throw new TypeError(`keys: ${b.id} needs a label (the shortcuts help shows it)`);
  }
  return Object.freeze({ ...b, keys: Object.freeze(chords ? b.keys.map(normalizeChord) : []),
    scope: Object.freeze({ workspace: s.workspace, view: s.view || null, focus }),
    repeat: !!b.repeat, prevent: b.prevent !== false, group: b.group || 'General',
    shownIn: Array.isArray(b.shownIn) ? Object.freeze([...b.shownIn]) : null, help });
}

export function createKeyRegistry() {
  const byChord = new Map(); // chord -> [binding]
  const ids = new Map();
  const unique = (id) => {
    if (ids.has(id)) throw new Error(`keys: the id "${id}" is already bound`);
  };

  function bind(input) {
    const b = checkBinding(input);
    unique(b.id);
    for (const chord of b.keys) {
      const other = (byChord.get(chord) || []).find((x) => same(x.scope, b.scope));
      if (other) {
        const s = b.scope;
        throw new Error(`keys: ${keyLabel(chord)} in ${s.workspace}${s.view ? `/${s.view}` : ''}`
          + ` (focus ${s.focus}) is owned by "${other.id}"; "${b.id}" cannot take it`);
      }
    }
    for (const chord of b.keys) byChord.set(chord, [...(byChord.get(chord) || []), b]);
    ids.set(b.id, b);
    return () => {
      ids.delete(b.id);
      for (const chord of b.keys) {
        const rest = (byChord.get(chord) || []).filter((x) => x !== b);
        if (rest.length) byChord.set(chord, rest); else byChord.delete(chord);
      }
    };
  }

  /** A help-only declaration (no run, never resolved): the help lists it as it lists a binding. */
  function declare(input) {
    const b = checkBinding(input, { help: true });
    unique(b.id);
    ids.set(b.id, b);
    return () => { if (ids.get(b.id) === b) ids.delete(b.id); };
  }

  /** The owner of chord in this context: the most specific match whose when() holds. */
  function resolve(chord, { workspace, view = null, focus = 'none' } = {}) {
    let best = null;
    for (const b of byChord.get(chord) || []) {
      const s = b.scope;
      if (s.focus !== focus && s.focus !== '*') continue;
      if (s.workspace !== '*' && s.workspace !== workspace) continue;
      if (s.view && s.view !== view) continue;
      if (typeof b.when === 'function' && !b.when()) continue;
      if (!best || specificity(s) > specificity(best.scope)) best = b;
    }
    return best;
  }

  return Object.freeze({ bind, declare, resolve, list: () => [...ids.values()],
    get size() { return ids.size; } });
}

/** True when the help of `workspace` lists `b`: its shownIn, else its scope's workspace. */
export function listedIn(b, workspace) {
  if (b.shownIn) return b.shownIn.includes(workspace);
  return b.scope.workspace === '*' || b.scope.workspace === workspace;
}

/**
 * The shortcuts help rows, grouped and ordered as bound or declared:
 * { group, rows: [{ id, keys, shown, label, where, place, section }] }. `keys` are the chords'
 * labels, `shown` what the help writes for them, `where` the scope's name and `place` the
 * declared words beside the keys (or null). With `workspace`, only what its help lists.
 */
export function helpRows(registry, workspaceLabel = (w) => w, { workspace = null } = {}) {
  const groups = new Map();
  for (const b of registry.list()) {
    if (workspace !== null && !listedIn(b, workspace)) continue;
    const s = b.scope;
    const where = s.workspace === '*' ? 'Everywhere'
      : `${workspaceLabel(s.workspace)}${s.view ? ` (${s.view})` : ''}`;
    const keys = b.keys.map(keyLabel);
    const section = b.section
      || (s.workspace === '*' && !b.shownIn ? 'everywhere' : 'workspace');
    if (!groups.has(b.group)) groups.set(b.group, []);
    groups.get(b.group).push({ id: b.row || b.id, keys, shown: b.shown || keys.join(' / '),
      label: b.label, where, place: b.place || null, section });
  }
  return [...groups].map(([group, rows]) => ({ group, rows }));
}
