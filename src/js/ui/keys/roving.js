// Roving focus inside one widget (WAI-ARIA menu, listbox, radiogroup): the one sanctioned key
// listener a widget may hold, because the dispatcher (dispatcher.js) passes arrows, Home, End,
// Enter and Escape through to a focused menu item, option or radio on purpose: the widget owns
// them. Widgets call roving() instead of their own addEventListener('keydown').
//
//   const detach = roving(container, {
//     count() -> n, index() -> i (-1: none), move(i),   // the widget applies the move: focus an
//                                                       // item, or set aria-activedescendant
//     orientation: 'vertical' | 'horizontal' | 'both',  // which arrows step (default vertical)
//     wrap: true,                                       // past the end goes round (false: clamp)
//     activate?(i), escape?(e, el),                     // Enter (and Space with spaceActivates);
//                                                       // escape owns the key (prevents and
//                                                       // stops it) only when it returns true
//     spaceActivates: false });
//
// A text input may be an item (a combobox into its list): while one has focus, only ArrowUp,
// ArrowDown and Escape are roving's; Home, End, Space, Enter and letters stay the input's.
// Home and End go to the first and last item. A handled key is prevented and stops
// propagation: the page dispatcher listens on window, so the Escape that closes a menu never
// also reaches the page's Escape (stop). Keys it does not handle bubble untouched.
const STEPS = {
  vertical: { ArrowDown: 1, ArrowUp: -1 },
  horizontal: { ArrowRight: 1, ArrowLeft: -1 },
  both: { ArrowDown: 1, ArrowUp: -1, ArrowRight: 1, ArrowLeft: -1 },
};

/** The index a key moves to from i among n items, or null when the key does not move. */
export function rovingNext(key, i, n, { orientation = 'vertical', wrap = true } = {}) {
  if (!n) return null;
  if (key === 'Home') return 0;
  if (key === 'End') return n - 1;
  const step = (STEPS[orientation] || STEPS.vertical)[key];
  if (!step) return null;
  const from = i < 0 ? (step > 0 ? -1 : n) : i;
  const to = from + step;
  return wrap ? ((to % n) + n) % n : Math.max(0, Math.min(n - 1, to));
}

/** A focused text field (input of a text type, textarea, contenteditable): the input's keys. */
function isText(el) {
  if (!el || !el.tagName) return false;
  if (el.isContentEditable || el.tagName === 'TEXTAREA') return true;
  if (el.tagName !== 'INPUT') return false;
  const type = (el.getAttribute && el.getAttribute('type')) || 'text';
  return ['text', 'search', 'email', 'url', 'tel', 'password', 'number'].includes(type);
}

export function roving(container, opts) {
  const { count, index, move, activate, escape, orientation = 'vertical', wrap = true,
    spaceActivates = false } = opts;
  const onKey = (e) => {
    if (e.isComposing || e.altKey || e.ctrlKey || e.metaKey) return;
    const own = () => { e.preventDefault(); e.stopPropagation(); };
    if (e.key === 'Escape' && escape) {
      if (escape(e, container) === true) own();
      return;
    }
    if (isText(e.target) && e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    if (activate && (e.key === 'Enter' || (spaceActivates && e.key === ' '))) {
      const i = index();
      if (i >= 0) {
        own();
        activate(i);
      }
      return;
    }
    const next = rovingNext(e.key, index(), count(), { orientation, wrap });
    if (next === null) return;
    own();
    move(next);
  };
  container.addEventListener('keydown', onKey);
  return () => container.removeEventListener('keydown', onKey);
}
