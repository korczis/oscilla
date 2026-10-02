// Native <dialog> modals and the Space/typing guard the instrument needs (status/extract.txt
// section 5). Dialogs carry data-oscilla-modal; while one is open it also carries
// aria-modal="true", so keyGuard() sees it. No Flowbite: showModal() gives the focus trap,
// Escape and the inert background natively.

/** V1 isTypingTarget (index.html@36f4b47): true when the focused element owns Space itself. */
export function isTypingTarget(el) {
  if (!el || el === el.ownerDocument?.body) return false;
  if (el.isContentEditable) return true;
  const tag = el.tagName;
  if (['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON', 'A', 'SUMMARY'].includes(tag)) return true;
  const role = el.getAttribute && el.getAttribute('role');
  return ['slider', 'tab', 'radio', 'button', 'switch', 'checkbox', 'menuitem', 'listbox',
    'option'].includes(role);
}

/** keyGuard(e) for createInstrument: Space belongs to a focused control or an open modal. */
export function keyGuard(e, doc = document) {
  const t = e && e.target && typeof e.target.tagName === 'string' ? e.target : doc.activeElement;
  return isTypingTarget(t) || isTypingTarget(doc.activeElement)
    || !!doc.querySelector('[data-oscilla-modal][aria-modal="true"]');
}

/** V1 modal ids -> dialog element ids. */
export const MODAL_IDS = Object.freeze({
  saveModal: 'osc-dlg-save',
  headphonesModal: 'osc-dlg-headphones',
  copyModal: 'osc-dlg-copy',
  help: 'osc-dlg-help',
  settings: 'osc-dlg-settings',
});

function dialogFor(id, doc) {
  return doc.getElementById(MODAL_IDS[id] || id);
}

const returnFocus = new WeakMap();

/** True when el can take focus visibly (connected, rendered, not inside a closed menu). */
export function isFocusable(el) {
  if (!el || !el.isConnected || typeof el.focus !== 'function') return false;
  if (el.closest('[hidden], dialog:not([open])')) return false;
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0;
}

/** Focus el, or the fallback (#osc-main) when el cannot take focus; never leaves <body>. */
export function focusSafely(el, doc = document) {
  const target = isFocusable(el) ? el : doc.getElementById('osc-main');
  if (target) target.focus({ preventScroll: !isFocusable(el) });
}

/** The element focus should return to: a menu item's menu button, else the element itself. */
function returnTarget(active, doc) {
  if (!active || active === doc.body) return null;
  const menu = active.closest('[role="menu"]');
  if (menu && menu.id) return doc.querySelector(`[aria-controls="${menu.id}"]`) || active;
  return active;
}

/** Open a dialog modally; returns false when it does not exist. */
export function openModal(id, doc = document) {
  const dlg = dialogFor(id, doc);
  if (!dlg) return false;
  dlg.setAttribute('aria-modal', 'true');
  if (!dlg.open) returnFocus.set(dlg, returnTarget(doc.activeElement, doc));
  if (!dlg.open) {
    if (typeof dlg.showModal === 'function') {
      try { dlg.showModal(); } catch (e) { dlg.setAttribute('open', ''); }
    } else dlg.setAttribute('open', '');
  }
  const focus = dlg.querySelector('[autofocus], input, select, textarea, button');
  if (focus) setTimeout(() => focus.focus(), 0);
  return true;
}

/** Close a dialog (no-op when closed). */
export function closeModal(id, doc = document) {
  const dlg = dialogFor(id, doc);
  if (!dlg) return false;
  dlg.removeAttribute('aria-modal');
  if (dlg.open && typeof dlg.close === 'function') dlg.close();
  else dlg.removeAttribute('open');
  return true;
}

/** Keep aria-modal in step when a dialog closes by Escape or form method=dialog. */
export function watchDialogs(root = document) {
  root.querySelectorAll('dialog[data-oscilla-modal]').forEach((dlg) => {
    dlg.addEventListener('close', () => {
      dlg.removeAttribute('aria-modal');
      // Focus goes back where it came from (a menu item -> its menu button); never to <body>.
      const back = returnFocus.get(dlg);
      returnFocus.delete(dlg);
      setTimeout(() => {
        const a = document.activeElement;
        if (!a || a === document.body || !isFocusable(a)) focusSafely(back);
      }, 0);
    });
    // Click on the backdrop (outside the dialog box) closes it.
    dlg.addEventListener('click', (e) => {
      if (e.target !== dlg) return;
      const r = dlg.getBoundingClientRect();
      const inside = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top
        && e.clientY <= r.bottom;
      if (!inside) dlg.close();
    });
  });
}
