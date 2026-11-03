// The ONE document key listener (registry.js). It works out the focus context once, asks the
// registry for the owner of the chord and runs it; what nothing owns passes through untouched.
//
// Passes through, never handled here:
//   - IME composition (e.isComposing, key 'Process'): the text belongs to the input method;
//   - a focused text field (input, textarea, select, contenteditable), unless a binding is
//     scoped to focus 'text';
//   - Space, Enter, arrows, Home, End and PageUp/PageDown on a focused native control or ARIA
//     widget (button, link, slider, tab, radio, switch, checkbox, menu item, listbox, option):
//     the control owns them (dialogs.js isTypingTarget, the rule keyGuard kept);
//   - any chord no binding owns, browser and OS shortcuts included.
// Held keys: a binding runs once per press; auto-repeat (e.repeat) is swallowed unless the
// binding asks for repeat; its up() runs on the key's keyup, and on window blur or when the
// page is hidden for every key still held, so a hold never sticks.
//
//   const keys = createKeyDispatcher({ registry, context: () => ({ workspace, view }) });
//   keys.attach(document, window) -> detach (keydown/keyup on the window);   keys.keydown(e) / keys.keyup(e) (tests)
//   keys.focusOf(el, doc) -> 'none' | 'dialog' | 'text' | 'piano' | 'control'

import { chordOf, codeOf } from './registry.js';

const CONTROL_KEYS = new Set(['Space', 'Enter', 'NumpadEnter', 'ArrowLeft', 'ArrowRight',
  'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown']);
const CONTROL_TAGS = new Set(['BUTTON', 'A', 'SUMMARY']);
const CONTROL_ROLES = new Set(['slider', 'tab', 'radio', 'button', 'switch', 'checkbox',
  'menuitem', 'menuitemradio', 'menuitemcheckbox', 'listbox', 'option', 'spinbutton', 'grid',
  'tree', 'treeitem']);

/** The focus context of the focused element (doc: its document, for an open modal). */
export function focusOf(el, doc = el && el.ownerDocument) {
  if (doc && doc.querySelector && doc.querySelector('[data-oscilla-modal][aria-modal="true"], '
    + 'dialog[open][aria-modal="true"]')) return 'dialog';
  if (!el || (doc && el === doc.body)) return 'none';
  if (el.closest && el.closest('[data-keys-focus="piano"]')) return 'piano';
  const tag = el.tagName;
  if (el.isContentEditable || tag === 'TEXTAREA' || tag === 'SELECT') return 'text';
  if (tag === 'INPUT') {
    const type = (el.getAttribute && el.getAttribute('type')) || 'text';
    return ['button', 'checkbox', 'radio', 'range', 'submit', 'reset', 'color', 'file']
      .includes(type) ? 'control' : 'text';
  }
  const role = el.getAttribute && el.getAttribute('role');
  if (CONTROL_TAGS.has(tag) || CONTROL_ROLES.has(role)) return 'control';
  return 'none';
}

export function createKeyDispatcher({ registry, context = () => ({}), doc = null } = {}) {
  const held = new Map(); // code -> binding that ran on its keydown

  function scopeOf(e) {
    const d = doc || (e.target && e.target.ownerDocument) || null;
    const el = (d && d.activeElement) || e.target || null;
    const focus = focusOf(el, d);
    return { ...context(), focus };
  }

  function keydown(e) {
    if (e.isComposing || e.key === 'Process' || e.keyCode === 229) return false;
    if (held.has(codeOf(e))) {
      const b = held.get(codeOf(e));
      if (b.prevent) e.preventDefault();
      if (!e.repeat || b.repeat) b.run(e);
      return true;
    }
    const ctx = scopeOf(e);
    if (ctx.focus === 'control' && CONTROL_KEYS.has(codeOf(e))) return false;
    const focus = ctx.focus === 'control' ? 'none' : ctx.focus;
    const b = registry.resolve(chordOf(e), { ...ctx, focus });
    if (!b) return false;
    if (b.prevent) e.preventDefault();
    held.set(codeOf(e), b);
    b.run(e);
    return true;
  }

  function keyup(e) {
    const b = held.get(codeOf(e));
    if (!b) return false;
    held.delete(codeOf(e));
    if (typeof b.up === 'function') b.up(e);
    return true;
  }

  /** Release every held key (blur, hidden page): each up() runs once. */
  function releaseAll(reason = 'blur') {
    const all = [...held];
    held.clear();
    for (const [code, b] of all) if (typeof b.up === 'function') b.up({ code, reason });
  }

  function attach(d = document, win = window) {
    const down = (e) => keydown(e);
    const up = (e) => keyup(e);
    const blur = () => releaseAll('blur');
    const vis = () => { if (d.hidden) releaseAll('hidden'); };
    win.addEventListener('keydown', down); // the window: what bubbles from the document, and
    win.addEventListener('keyup', up); //     an event dispatched on the window itself
    win.addEventListener('blur', blur);
    d.addEventListener('visibilitychange', vis);
    return () => {
      win.removeEventListener('keydown', down);
      win.removeEventListener('keyup', up);
      win.removeEventListener('blur', blur);
      d.removeEventListener('visibilitychange', vis);
      releaseAll('detach');
    };
  }

  return Object.freeze({ keydown, keyup, releaseAll, attach, focusOf,
    get held() { return [...held.keys()]; } });
}
