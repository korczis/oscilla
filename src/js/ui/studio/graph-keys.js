// Studio keyboard shortcuts (spec §64, §125, §185, §224): ONE canonical table shared by the
// editor (resolveStudioKey), the in-app shortcut list and the browser tests. Pure.
//
// Rules (§125): the shortcuts apply only while Studio has focus and no form control is being
// edited (the caller checks that with isEditingTarget); Tab is never taken (§64); browser
// shortcuts are left alone except the editing ones Studio defines (Cmd/Ctrl + C, V, X, D, Z,
// Shift+Z, Y), which apply only inside Studio and only when nothing is being typed.

/** The table: id, the keys as shown, what it does. Order = the order of the in-app list. */
export const STUDIO_SHORTCUTS = Object.freeze([
  { id: 'play-toggle', keys: 'Space', text: 'Play / stop the Studio transport' },
  { id: 'escape', keys: 'Esc', text: 'Cancel a drag or connection, close a picker, else stop' },
  { id: 'delete', keys: 'Delete / Backspace', text: 'Delete the selected nodes or connection' },
  { id: 'copy', keys: 'Ctrl/⌘ C', text: 'Copy the selected nodes' },
  { id: 'cut', keys: 'Ctrl/⌘ X', text: 'Cut the selected nodes' },
  { id: 'paste', keys: 'Ctrl/⌘ V', text: 'Paste (new ids, small offset)' },
  { id: 'duplicate', keys: 'Ctrl/⌘ D', text: 'Duplicate the selected nodes' },
  { id: 'undo', keys: 'Ctrl/⌘ Z', text: 'Undo' },
  { id: 'redo', keys: 'Ctrl/⌘ Shift Z, Ctrl Y', text: 'Redo' },
  { id: 'select-all', keys: 'Ctrl/⌘ A', text: 'Select every node' },
  { id: 'quick-add', keys: 'N', text: 'Add a node (searchable picker)' },
  { id: 'find', keys: '/', text: 'Find a node by name or type and frame it' },
  { id: 'connect', keys: 'C', text: 'Connect the selected node (list of compatible inputs)' },
  { id: 'frame-selection', keys: 'F', text: 'Frame the selection' },
  { id: 'frame-all', keys: 'A', text: 'Frame the whole graph' },
  { id: 'zoom-in', keys: '+', text: 'Zoom in' },
  { id: 'zoom-out', keys: '−', text: 'Zoom out' },
  { id: 'nudge', keys: 'Arrows (Shift: ×4)', text: 'Move the selected nodes by the grid' },
  { id: 'focus-next', keys: 'Tab', text: 'Move focus (never taken by Studio)' },
].map((s) => Object.freeze(s)));

const TYPING_TYPES = new Set(['text', 'search', 'number', 'email', 'url', 'tel', 'password',
  'date', 'time', 'datetime-local', 'month', 'week']);

/** True when keys typed at `el` belong to a form control (§125: Studio does not take them). */
export function isEditingTarget(el) {
  if (!el || typeof el.tagName !== 'string') return false;
  const tag = el.tagName.toLowerCase();
  if (tag === 'textarea' || tag === 'select') return true;
  if (tag === 'input') return TYPING_TYPES.has(String(el.type || 'text').toLowerCase());
  return !!el.isContentEditable;
}

/**
 * The Studio command of a key event { key, code, ctrlKey, metaKey, shiftKey, altKey, repeat }:
 * { id, delta? } or null. Only plain keys and the editing chords above map to commands.
 */
export function resolveStudioKey(e) {
  if (!e || typeof e.key !== 'string') return null;
  const mod = !!(e.ctrlKey || e.metaKey);
  const key = e.key;
  const lower = key.length === 1 ? key.toLowerCase() : key;
  if (key === 'Tab') return null;
  if (mod && !e.altKey) {
    if (lower === 'z') return { id: e.shiftKey ? 'redo' : 'undo' };
    if (lower === 'y' && !e.shiftKey) return { id: 'redo' };
    if (lower === 'c' && !e.shiftKey) return { id: 'copy' };
    if (lower === 'x' && !e.shiftKey) return { id: 'cut' };
    if (lower === 'v' && !e.shiftKey) return { id: 'paste' };
    if (lower === 'd' && !e.shiftKey) return { id: 'duplicate' };
    if (lower === 'a' && !e.shiftKey) return { id: 'select-all' };
    return null;
  }
  if (mod || e.altKey) return null;
  if (key === ' ' || e.code === 'Space') return { id: 'play-toggle' };
  if (key === 'Escape') return { id: 'escape' };
  if (key === 'Delete' || key === 'Backspace') return { id: 'delete' };
  if (key.startsWith('Arrow')) return { id: 'nudge', key, large: !!e.shiftKey };
  // '/' is Shift+7 on several layouts: the character decides, not the Shift state.
  if (key === '/') return { id: 'find' };
  if (e.shiftKey && lower !== '+') return null;
  switch (lower) {
    case 'n': return { id: 'quick-add' };
    case 'c': return { id: 'connect' };
    case 'f': return { id: 'frame-selection' };
    case 'a': return { id: 'frame-all' };
    case '+':
    case '=': return { id: 'zoom-in' };
    case '-':
    case '_': return { id: 'zoom-out' };
    default: return null;
  }
}
