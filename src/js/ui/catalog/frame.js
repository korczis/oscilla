// The one frame of every visual component (rule project.visual-components-framed, plan G001).
// A declaration with `visual: true` (define.js) names the element the frame wraps: the element
// whose data-osc is the declaration's id. The frame is driven only by that declaration: it adds
// a full-screen trigger (<id>.fullscreen), and when the declaration lists fullscreenControls, a
// menu (<id>.frame) that lists every option and a row of those controls shown while the
// component is full screen. Nothing here knows a chart, a panel or a page.
//
//   FRAME_SIZES                       the container size classes, by minimum width in CSS px
//   frameSizeOf(width) -> 'phone' | 'small' | 'large'
//   fullscreenModeOf(doc, el) -> 'api' | 'overlay'   overlay where the element cannot go full
//                                     screen (Safari on iPhone has no element fullscreen, or
//                                     an embedding page blocks it)
//   frameSlug(id) -> the id with dots as dashes     the DOM ids of a frame's parts are built
//                                     from it (the trigger: the page prefix, the slug and
//                                     '-fullscreen', as the panels' buttons were named)
//   frameView(decl, { full, mode }) -> { trigger, menu, controls }  what the frame shows (pure)
//   createFrames({ doc, win, catalog, controls, keys, onChange }) -> { scan(root), enter(id),
//     exit(id), state(id), destroy() }   keys: the page's key registry (K153)
//   frameKeyBindings({ open, inside, escape }) -> [binding]   the frame's Escape (see there)
//
// Sizes come from the frame's own box (a ResizeObserver), never from the device: the same
// component is 'phone' in a narrow column of a large monitor. The frame writes
// data-osc-frame="<id>", data-osc-frame-state="inline" | "full" and data-osc-frame-size on the
// element; CSS and tests read those, and no legacy class is added (rule
// project.ui-uses-flowbite-pro): the parts are Flowbite Pro buttons and a Pro dropdown.
//
// Full screen: the Fullscreen API on the element; where it is missing or refused, a fixed
// overlay of the viewport with the safe-area insets (iOS). Escape and Back leave it and focus
// returns to the trigger: in the API the browser's own Back and Escape end it; the overlay pushes
// one history entry with its own state (the same address, never a new hash), which Back pops. A placement: the frame puts its parts into the element's
// [data-osc-frame-slot] (a panel header), else into a bar of its own as the element's first
// child. A re-rendered element loses its parts; scan() puts them back.

export const FRAME_SIZES = Object.freeze({ phone: 0, small: 480, large: 1024 });
export const FRAME_STATE_KEY = 'oscFrame';

/** The size class of a frame `width` CSS px wide. */
export function frameSizeOf(width) {
  const w = Number(width) || 0;
  if (w >= FRAME_SIZES.large) return 'large';
  if (w >= FRAME_SIZES.small) return 'small';
  return 'phone';
}

/** 'api' when `el` can go full screen in `doc`, else 'overlay'. */
export function fullscreenModeOf(doc, el) {
  const req = el && (el.requestFullscreen || el.webkitRequestFullscreen);
  if (!doc || typeof req !== 'function') return 'overlay';
  const enabled = doc.fullscreenEnabled !== undefined ? doc.fullscreenEnabled
    : doc.webkitFullscreenEnabled;
  return enabled === false ? 'overlay' : 'api';
}

/** The slug of a catalogue id in the DOM ids of a frame's parts. */
export function frameSlug(id) {
  return String(id).replace(/[^\w-]+/g, '-');
}

/** What the frame of `decl` shows, `full` or not (pure; the DOM part renders exactly this). */
export function frameView(decl, { full = false, mode = 'api' } = {}) {
  const slug = frameSlug(decl.id);
  const controls = (decl.fullscreenControls || []).map((c) => ({ hook: c.id, kind: c.kind,
    label: c.label, docs: c.docs, id: `osc-${frameSlug(c.id)}` }));
  const what = full ? 'Exit full screen' : 'Full screen';
  return {
    trigger: { hook: `${decl.id}.fullscreen`, id: `osc-${slug}-fullscreen`,
      label: `${what}: ${decl.label}`, title: full ? `${what} (Esc)` : what, pressed: full,
      icon: full ? '#i-close' : '#i-expand', mode },
    menu: controls.length ? { hook: `${decl.id}.frame`, id: `osc-${slug}-frame`,
      list: `osc-${slug}-menu`, label: `${decl.label} options`,
      items: [{ hook: `${decl.id}.fullscreen`, label: what, checked: full }, ...controls] }
      : null,
    controls: full ? controls : [],
  };
}

/**
 * The frame's Escape for the page's one key registry (K153). The scope is exact: focus 'none'
 * (nothing that owns keys is focused) and focus 'text' for a field inside the full-screen frame,
 * each with when(), so an exact focus beats a page-wide Escape bound with focus '*' (K153's
 * page.escape) while a frame menu is open or a frame is full screen, and steps aside otherwise.
 * Never in a modal dialog (focus 'dialog'). open(): a menu is open or a frame is full screen;
 * inside(): focus is inside the full-screen frame; escape(): close the menu, else leave.
 */
export function frameKeyBindings({ open, inside, escape }) {
  const common = { keys: ['Escape'], label: 'Close the frame menu, or leave full screen',
    group: 'View', run: () => escape() };
  return [
    { ...common, id: 'frame.escape', scope: { workspace: '*', focus: 'none' }, when: open },
    { ...common, id: 'frame.escape.text', scope: { workspace: '*', focus: 'text' },
      when: () => open() && inside() },
  ];
}

// Flowbite Pro classes (the icon button of the admin navbar, the dropdown of section 4).
const BTN = 'inline-flex items-center justify-center w-8 h-8 text-gray-500 rounded-lg '
  + 'hover:bg-gray-100 hover:text-gray-900 focus:outline-none focus:ring-2 focus:ring-primary-500 '
  + 'dark:text-gray-400 dark:hover:bg-gray-700 dark:hover:text-white '
  + '[@media(pointer:coarse)]:w-11 [@media(pointer:coarse)]:h-11';
const CTRL = 'inline-flex items-center px-3 text-sm font-medium text-gray-900 bg-white border '
  + 'border-gray-200 rounded-lg min-h-8 hover:bg-gray-100 focus:outline-none focus:ring-2 '
  + 'focus:ring-primary-500 dark:bg-gray-800 dark:text-white dark:border-gray-600 '
  + 'dark:hover:bg-gray-700 [@media(pointer:coarse)]:min-h-11';
const MENU = 'absolute right-0 z-50 w-56 mt-1 text-base list-none bg-white divide-y '
  + 'divide-gray-100 rounded-lg shadow-lg top-full dark:bg-gray-700 dark:divide-gray-600';
const ITEM = 'flex items-center w-full px-4 py-2 text-sm text-left text-gray-700 min-h-9 '
  + 'hover:bg-gray-100 focus:outline-none focus:bg-gray-100 dark:text-gray-200 '
  + 'dark:hover:bg-gray-600 dark:focus:bg-gray-600 [@media(pointer:coarse)]:min-h-11';
const BAR = 'flex items-center justify-end flex-none gap-1';
const ROW = 'flex flex-wrap items-center gap-2 py-2';
// Full screen: the element fills the viewport above everything, inside the safe area.
const FULL = ['fixed', 'inset-0', 'z-[80]', 'overflow-auto', 'bg-gray-50', 'dark:bg-gray-900',
  'pt-[max(1rem,env(safe-area-inset-top))]', 'pr-[max(1rem,env(safe-area-inset-right))]',
  'pb-[max(1rem,env(safe-area-inset-bottom))]', 'pl-[max(1rem,env(safe-area-inset-left))]'];
const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * The frames of a page. `catalog` is the UI catalogue (its visuals()); `controls` maps a
 * full-screen control id to { run(), pressed?() }; `onChange(id, state)` runs after each change
 * of state (the composition root relayouts the charts there).
 */
export function createFrames({ doc = document, win = window, catalog, controls = {}, keys = null,
  onChange = () => {} } = {}) {
  const visuals = catalog.visuals();
  const byId = new Map(visuals.map((d) => [d.id, d]));
  const frames = new Map(); // id -> { decl, el, state, mode, ro, parts }
  const selector = visuals.map((d) => `[data-osc="${d.id}"]`).join(',');
  let historyArmed = null; // the id whose history entry is on the stack

  const icon = (href) => {
    const svg = doc.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('class', 'w-5 h-5');
    svg.setAttribute('aria-hidden', 'true');
    const use = doc.createElementNS(SVG_NS, 'use');
    use.setAttribute('href', href);
    svg.appendChild(use);
    return svg;
  };
  const button = (cls, attrs) => {
    const b = doc.createElement('button');
    b.type = 'button';
    b.className = cls;
    for (const [k, v] of Object.entries(attrs)) b.setAttribute(k, v);
    return b;
  };

  function render(f) {
    const view = frameView(f.decl, { full: f.state === 'full', mode: f.mode });
    const p = f.parts;
    const t = view.trigger;
    p.trigger.setAttribute('aria-label', t.label);
    p.trigger.setAttribute('title', t.title);
    p.trigger.setAttribute('aria-pressed', String(t.pressed));
    p.trigger.replaceChildren(icon(t.icon));
    if (p.menuItems) {
      p.menuItems.get(`${f.decl.id}.fullscreen`).textContent = view.menu.items[0].label;
      p.menuItems.get(`${f.decl.id}.fullscreen`).setAttribute('aria-checked',
        String(view.menu.items[0].checked));
      for (const c of f.decl.fullscreenControls || []) {
        const h = controls[c.id];
        const item = p.menuItems.get(c.id);
        const btn = p.row.querySelector(`[data-osc="${c.id}"]`);
        const pressed = h && typeof h.pressed === 'function' ? String(!!h.pressed()) : null;
        for (const node of [item, btn]) {
          if (!node) continue;
          if (pressed !== null) node.setAttribute(node === item ? 'aria-checked' : 'aria-pressed',
            pressed);
          if (!h) node.setAttribute('aria-disabled', 'true');
        }
      }
    }
    if (p.row) p.row.hidden = view.controls.length === 0;
  }

  function closeMenu(f, focus) {
    if (!f.parts.menu || f.parts.menu.hidden) return;
    f.parts.menu.hidden = true;
    f.parts.menuButton.setAttribute('aria-expanded', 'false');
    if (focus) f.parts.menuButton.focus();
  }

  function runControl(f, id) {
    const h = controls[id];
    if (h && typeof h.run === 'function') h.run();
    render(f);
  }

  function build(f) {
    const { decl, el } = f;
    const view = frameView(decl, { mode: f.mode });
    const bar = doc.createElement('div');
    bar.className = 'relative ' + BAR;
    bar.setAttribute('data-osc-frame-bar', decl.id);
    bar.setAttribute('role', 'group');
    bar.setAttribute('aria-label', `${decl.label} frame`);
    const trigger = button(BTN, { id: view.trigger.id, 'data-osc': view.trigger.hook,
      'aria-pressed': 'false' });
    trigger.addEventListener('click', () => (f.state === 'full' ? exit(decl.id) : enter(decl.id)));
    bar.appendChild(trigger);
    const parts = { bar, trigger, menu: null, menuButton: null, menuItems: null, row: null };
    if (view.menu) {
      const menuButton = button(BTN, { id: view.menu.id, 'data-osc': view.menu.hook,
        'aria-haspopup': 'menu', 'aria-expanded': 'false', 'aria-controls': view.menu.list,
        'aria-label': view.menu.label, title: view.menu.label });
      menuButton.appendChild(icon('#i-more'));
      const menu = doc.createElement('div');
      menu.id = view.menu.list;
      menu.className = MENU;
      menu.setAttribute('role', 'menu');
      menu.setAttribute('aria-labelledby', view.menu.id);
      menu.hidden = true;
      const items = new Map();
      for (const it of view.menu.items) {
        const isFull = it.hook === `${decl.id}.fullscreen`;
        const item = button(ITEM, { role: isFull ? 'menuitemcheckbox' : 'menuitem',
          'data-osc-frame-item': it.hook, title: it.docs || it.label });
        item.textContent = it.label;
        item.addEventListener('click', () => {
          closeMenu(f, false);
          if (isFull) {
            if (f.state === 'full') exit(decl.id); else enter(decl.id);
          } else runControl(f, it.hook);
        });
        items.set(it.hook, item);
        menu.appendChild(item);
      }
      menuButton.addEventListener('click', () => {
        const open = menu.hidden;
        menu.hidden = !open;
        menuButton.setAttribute('aria-expanded', String(open));
        if (open) {
          const first = menu.querySelector('[role^="menuitem"]');
          if (first) first.focus();
        }
      });
      bar.appendChild(menuButton);
      bar.appendChild(menu);
      parts.menu = menu;
      parts.menuButton = menuButton;
      parts.menuItems = items;
      const row = doc.createElement('div');
      row.className = ROW;
      row.setAttribute('data-osc-frame-controls', decl.id);
      row.setAttribute('role', 'group');
      row.setAttribute('aria-label', `${decl.label}: full-screen controls`);
      row.hidden = true;
      for (const c of view.menu.items.slice(1)) {
        const b = button(CTRL, { id: c.id, 'data-osc': c.hook, title: c.docs });
        b.textContent = c.label;
        b.addEventListener('click', () => runControl(f, c.hook));
        row.appendChild(b);
      }
      parts.row = row;
    }
    f.parts = parts;
    place(f);
    render(f);
  }

  /** Put the parts into the slot, else a bar of their own as the first child. */
  function place(f) {
    const { el, parts } = f;
    const slot = [...el.querySelectorAll('[data-osc-frame-slot]')]
      .find((s) => s.closest('[data-osc-frame]') === el);
    if (slot) {
      parts.bar.classList.remove('w-full');
      slot.appendChild(parts.bar);
    } else {
      parts.bar.classList.add('w-full');
      el.insertBefore(parts.bar, el.firstChild);
    }
    if (parts.row) parts.bar.after(parts.row);
  }

  function setState(f, state) {
    f.state = state;
    f.el.setAttribute('data-osc-frame-state', state);
    const full = state === 'full';
    for (const c of FULL) f.el.classList.toggle(c, full);
    doc.documentElement.classList.toggle('overflow-hidden', [...frames.values()]
      .some((x) => x.state === 'full'));
    render(f);
    onChange(f.decl.id, state);
  }

  function armHistory(id) {
    try {
      win.history.pushState({ ...(win.history.state || {}), [FRAME_STATE_KEY]: id }, '',
        win.location.href);
      historyArmed = id;
    } catch (e) {
      historyArmed = null;
    }
  }

  function enter(id) {
    const f = frames.get(id);
    if (!f || f.state === 'full') return false;
    for (const other of frames.values()) if (other.state === 'full') exit(other.decl.id);
    f.mode = fullscreenModeOf(doc, f.el);
    setState(f, 'full');
    const overlay = () => {
      f.mode = 'overlay';
      if (f.state === 'full' && historyArmed !== id) armHistory(id);
      render(f);
    };
    if (f.mode === 'api') {
      const req = f.el.requestFullscreen || f.el.webkitRequestFullscreen;
      try {
        const p = req.call(f.el);
        if (p && typeof p.catch === 'function') p.catch(overlay);
      } catch (e) {
        overlay();
      }
    } else overlay();
    return true;
  }

  function exit(id, { fromHistory = false } = {}) {
    const f = frames.get(id);
    if (!f || f.state !== 'full') return false;
    const fsEl = doc.fullscreenElement || doc.webkitFullscreenElement;
    if (fsEl === f.el) {
      const x = doc.exitFullscreen || doc.webkitExitFullscreen;
      try {
        const p = x.call(doc);
        if (p && typeof p.catch === 'function') p.catch(() => {});
      } catch (e) { /* leaving anyway */ }
    }
    setState(f, 'inline');
    if (historyArmed === id) {
      historyArmed = null;
      if (!fromHistory && win.history.state && win.history.state[FRAME_STATE_KEY] === id) {
        win.history.back();
      }
    }
    if (f.parts && f.parts.trigger && f.parts.trigger.isConnected) f.parts.trigger.focus();
    return true;
  }

  function mount(el) {
    const id = el.getAttribute('data-osc');
    const decl = byId.get(id);
    if (!decl) return;
    let f = frames.get(id);
    if (f && f.el !== el) {
      if (f.ro) f.ro.disconnect();
      f = null;
    }
    if (!f) {
      f = { decl, el, state: 'inline', mode: fullscreenModeOf(doc, el), ro: null, parts: null };
      frames.set(id, f);
      el.setAttribute('data-osc-frame', id);
      el.setAttribute('data-osc-frame-state', 'inline');
      const size = () => el.setAttribute('data-osc-frame-size',
        frameSizeOf(el.getBoundingClientRect().width));
      size();
      if (typeof win.ResizeObserver === 'function') {
        f.ro = new win.ResizeObserver(size);
        f.ro.observe(el);
      }
    }
    if (!f.parts || !el.contains(f.parts.bar)) build(f);
  }

  /** Mount every visual element under `root` that has no frame yet (or lost its parts). */
  function scan(root = doc) {
    if (!selector) return;
    const els = [...(root.matches && root.matches(selector) ? [root] : []),
      ...root.querySelectorAll(selector)];
    for (const el of els) mount(el);
  }

  const fullFrame = () => [...frames.values()].find((x) => x.state === 'full') || null;
  const openMenu = () => [...frames.values()].find((x) => x.parts && x.parts.menu
    && !x.parts.menu.hidden) || null;
  // Escape through the page's one key registry (K153, src/js/ui/keys): frameKeyBindings.
  const unbind = [];
  if (keys && typeof keys.bind === 'function') {
    const bindings = frameKeyBindings({
      open: () => !!(openMenu() || fullFrame()),
      inside: () => {
        const f = fullFrame();
        return !!(f && doc.activeElement && f.el.contains(doc.activeElement));
      },
      escape: () => {
        const m = openMenu();
        if (m) { closeMenu(m, true); return; }
        const f = fullFrame();
        if (f) exit(f.decl.id);
      },
    });
    for (const b of bindings) unbind.push(keys.bind(b));
  }
  const onFsChange = () => {
    const fsEl = doc.fullscreenElement || doc.webkitFullscreenElement;
    for (const f of frames.values()) {
      if (f.state === 'full' && f.mode === 'api' && fsEl !== f.el) exit(f.decl.id);
    }
  };
  const onPop = () => {
    const want = win.history.state && win.history.state[FRAME_STATE_KEY];
    for (const f of frames.values()) {
      if (f.state === 'full' && want !== f.decl.id) exit(f.decl.id, { fromHistory: true });
    }
  };
  const onDocClick = (e) => {
    for (const f of frames.values()) {
      if (f.parts && f.parts.menu && !f.parts.menu.hidden && !f.parts.bar.contains(e.target)) {
        closeMenu(f, false);
      }
    }
  };
  doc.addEventListener('fullscreenchange', onFsChange);
  doc.addEventListener('webkitfullscreenchange', onFsChange);
  doc.addEventListener('click', onDocClick, true);
  win.addEventListener('popstate', onPop);
  let mo = null;
  let pending = 0;
  if (typeof win.MutationObserver === 'function' && doc.body) {
    mo = new win.MutationObserver(() => {
      if (pending) return;
      pending = win.requestAnimationFrame(() => { pending = 0; scan(doc); });
    });
    mo.observe(doc.body, { childList: true, subtree: true });
  }

  return {
    scan,
    enter,
    exit,
    state: (id) => (frames.has(id) ? frames.get(id).state : null),
    mode: (id) => (frames.has(id) ? frames.get(id).mode : null),
    ids: () => [...frames.keys()],
    /** Leave full screen wherever it is (a route change). */
    exitAll() {
      for (const f of frames.values()) if (f.state === 'full') exit(f.decl.id);
    },
    destroy() {
      for (const u of unbind) u();
      doc.removeEventListener('fullscreenchange', onFsChange);
      doc.removeEventListener('webkitfullscreenchange', onFsChange);
      doc.removeEventListener('click', onDocClick, true);
      win.removeEventListener('popstate', onPop);
      if (mo) mo.disconnect();
      for (const f of frames.values()) if (f.ro) f.ro.disconnect();
      frames.clear();
    },
  };
}
