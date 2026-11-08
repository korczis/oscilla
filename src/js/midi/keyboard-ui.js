// The keyboard part of the one OSCILLA Alpine component (plan issue K026; ADR 0058, ADR 0062):
// the computer keyboard and the on-screen keys play the note voices of the AudioEngine through
// the note layer (src/js/midi/notes.js), the same path as a MIDI input. Composed by
// src/js/midi/ui.js, which calls kbdInit() from midiInit().
//
// - Armed per view: the Playground and the Studio each have their own arm switch (kbdArmed),
//   and the link key `kbd` (#m=playground&kbd=1, #m=studio&kbd=1) arms the view it opens.
//   Elsewhere the computer keyboard plays nothing.
// - Armed, the keys of keyboard.js play; Space never (ADR 0050). A key held in a text field, a
//   select or an open dialog is left alone, and so is any key with Ctrl, Meta or Alt.
// - Held notes sound past the safety limit while held and are released on window blur, page
//   hide, Escape and when the view is left (ADR 0062).
// - The keys light up whoever plays them: the computer keyboard, a pointer, a MIDI input.
// - While a note sounds, the analysis views show the live output (vizInputs: playing).
// - The XY pad is one more input of this note layer (K183, kbdPad): its notes are 'kbd-xy', and
//   every forced release of the keys (blur, page hide, Escape, a workspace switch, All Notes
//   Off) closes the pad's gate too and then releases whatever the 'xy' input still holds; a
//   Disarm releases only the keys' own notes (kbdReleaseKeys): the pad is not the keys.
// The controllers stay out of reactive state; the component holds plain values only.
//
// ui-family: keyboard skin dock

import {
  createKeyboard, codeForNote, KEY_LABELS, noteName, playableEvent, visibleRange,
  KEYBOARD_LINK_KEY, KEYBOARD_VIEWS,
} from './keyboard.js';
import { drawKeys, keyColours, keyLayout, noteAt } from './keyboard-view.js';
import { routeOfHash } from '../ui/navigation.js';
import { armedDefaults, keysShown, routeOf } from './routes.js';
import { mountDockYield } from './dock-yield.js';

export const KEYBOARD_REFUSED = Object.freeze({
  measurement: 'Keyboard notes do not play while the measurement owns the output: stop it '
    + '(Esc) first.',
  reference: 'Keyboard notes do not play while the level reference is being captured.',
  studio: 'Keyboard notes do not play while the Studio is playing: stop it first.',
  sequencer: 'Keyboard notes do not play while the sequencer is playing: stop it (Esc) first.',
});

const KEYS_HEIGHT = 132; // CSS px of the on-screen keys

// The docked keys' frame (kbdDockClass), a Pro bottom bar above the status bar.
const KBD_DOCK = 'fixed inset-x-0 bottom-[var(--osc-statusbar-h)] z-30 max-h-[45vh] '
  + 'overflow-y-auto border-t border-solid border-gray-200 bg-white px-4 py-2 shadow '
  + 'dark:border-gray-700 dark:bg-gray-800';

/** The dock's Pro buttons (one class list, bound as kbdBtn, so the markup carries it once): 44 px
 *  on a coarse pointer (V634). */
export const KBD_BTN = [
  'inline-flex h-9 items-center justify-center rounded-lg border border-solid',
  'border-gray-300 bg-white px-3 text-sm font-medium text-gray-900 hover:bg-gray-100',
  'focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-300',
  'aria-pressed:border-primary-600 aria-pressed:bg-primary-600 aria-pressed:text-white',
  'dark:border-gray-600 dark:bg-gray-800 dark:text-white dark:hover:bg-gray-700',
  'dark:aria-pressed:bg-primary-500 [@media(pointer:coarse)]:min-h-11',
  '[@media(pointer:coarse)]:min-w-11',
].join(' ');

/** The narrowest white key a finger plays without its neighbour: the 44 px touch target. */
export const TOUCH_KEY_MIN = 44;

/**
 * How many octaves the on-screen keys show in `width` CSS px (V634). A fine pointer keeps the
 * drawing's own choice, two below 560 px and three above; a coarse one shows as many whole
 * octaves as keep every white key (seven per octave and the top C) at least TOUCH_KEY_MIN wide,
 * one at the least and three at the most, and the Octave buttons move them.
 */
export function keysOctaves(width, { coarse = false } = {}) {
  if (!coarse) return width < 560 ? 2 : 3;
  const whites = Math.floor(Math.max(0, width) / TOUCH_KEY_MIN);
  return Math.max(1, Math.min(3, Math.floor((whites - 1) / 7)));
}

/**
 * Whether the keys are touched rather than pointed at, and whether they carry the computer
 * keys' letters: a letter names a key nobody can press where no fine pointer, and so most
 * likely no hardware keyboard, is attached (a phone), so there the keys show only their notes.
 */
export function keysInput(win) {
  const mq = (q) => Boolean(win && typeof win.matchMedia === 'function'
    && win.matchMedia(q).matches);
  const coarse = mq('(pointer: coarse)');
  return { coarse, lettered: !coarse || mq('(any-pointer: fine)') };
}

/** True when `el` takes typed keys itself: a text field, a select, an editable element. */
export function takesText(el) {
  if (!el || !el.tagName) return false;
  if (el.isContentEditable) return true;
  const tag = el.tagName;
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (tag === 'INPUT') {
    const type = String(el.type || 'text').toLowerCase();
    return !['button', 'checkbox', 'radio', 'range', 'reset', 'submit', 'color', 'file',
      'image'].includes(type);
  }
  const role = el.getAttribute && el.getAttribute('role');
  return ['textbox', 'combobox', 'searchbox', 'listbox', 'spinbutton'].includes(role);
}

/**
 * `win`: the window. kbdInit({ notesFor }) takes `notesFor(refused)`, which returns a note
 * layer (createMidiNotes) whose refusals are said with the keyboard's sentences.
 */
export function createKeyboardUi({ win = window } = {}) {
  let kb = null;
  let notes = null;
  let view = null; // { canvas, layout, octaves, draw() }
  let dock = null; // the dock's yield to the note owner (K171, midi/dock-yield.js)
  const pads = new Set(); // the XY pads' gate releases (kbdPad, K183)
  // Two releases (K183 review F4): the keys' own notes (the computer keys' and the on-screen
  // keys', inputs 'keys' and 'pointer') for a Disarm and the dock's fold, which never cut the
  // XY pad's note; and the panic (blur, page hide, Escape, a workspace switch, All Notes Off),
  // which also closes every pad's gate and releases what the xy input still holds.
  const kbdReleaseKeys = () => (kb ? kb.releaseAll() : 0);
  const kbdRelease = () => {
    let n = kbdReleaseKeys();
    for (const release of [...pads]) n += release('keys') || 0;
    return n + (notes ? notes.releaseInput('xy', 'all-off') : 0);
  };

  return {
    kbdArmed: armedDefaults(), // per workspace, from the one route table (midi/routes.js)
    kbdBase: 60,
    kbdVelocity: 100,
    kbdHeld: '',
    kbdSounding: false,
    kbdRange: '',
    // V635: on a phone the Synth's dock shows its keys and the Octave buttons; the instrument
    // row, Arm and Velocity unfold from its More button, so the dock never buries the panel.
    kbdMore: false,
    kbdBtn: KBD_BTN,
    // The note owner and the user's expansion as the dock last applied them (midi/dock-yield.js
    // sets both on a state change): what kbdKeysShown reads through routes.js keysShown.
    kbdNoteOwner: null,
    kbdDockExpanded: false,

    /** The view the keyboard belongs to now ('playground' | 'studio'), else null. */
    get kbdView() {
      return KEYBOARD_VIEWS.includes(this.workspace) ? this.workspace : null;
    },
    /** The keys dock over the page's bottom edge, the same component in the Synth and the
     *  Studio (the owner's report of 2026-11-03); the Playground keeps them under its panels. */
    get kbdDocked() {
      return this.kbdView === 'synth' || this.kbdView === 'studio';
    },
    /** The docked keys' classes: over the page's bottom edge, beside the sidebar from lg up (it
     *  sits above them, z-40, and would take their clicks), as the workspace column is. */
    get kbdDockClass() {
      if (!this.kbdDocked) return '';
      return `${KBD_DOCK} ${this.sidebarCollapsed ? 'lg:left-16' : 'lg:left-64'}`;
    },
    /** The on-screen keys show wherever the dock is docked (routes.js keysShown, the dock's one
     *  rule, K171): folded where a pad owns the notes, they go with it; in the Studio only
     *  while armed, so the disarmed dock is one row and the graph keeps the height. */
    get kbdKeysShown() {
      return keysShown({ route: routeOf(this.kbdView), owner: this.kbdNoteOwner,
        userExpanded: this.kbdDockExpanded }) && (this.kbdView !== 'studio' || this.kbdArmedHere);
    },
    get kbdArmedHere() {
      const v = this.kbdView;
      return !!v && !!this.kbdArmed[v];
    },
    /** What the readout says: armed or not, the keys' range, the velocity. */
    get kbdReadout() {
      const range = this.kbdRange;
      const where = { studio: 'Studio', synth: 'Synth' }[this.kbdView] || 'Playground';
      return this.kbdArmedHere
        ? `Armed in the ${where}: keys A to ' play ${range}. Velocity ${this.kbdVelocity}. `
          + 'Z / X octave, C / V velocity; Esc releases every note.'
        : `Not armed in the ${where}: arm the keys to play ${range} from the computer keyboard. `
          + `Velocity ${this.kbdVelocity}.`;
    },
    /** The on-screen keys, for assistive technology (the canvas is an image of them). */
    get kbdLabel() {
      return `On-screen keyboard; holding: ${this.kbdHeld || 'nothing'}.`;
    },

    /** Called once by midiInit: the controller, the listeners, the link key, the views. */
    kbdInit({ notesFor }) {
      const cmp = this;
      notes = notesFor((by) => {
        if (typeof cmp.notify === 'function') cmp.notify('info', 'Keyboard', KEYBOARD_REFUSED[by]);
      });
      kb = createKeyboard({
        play: (note, velocity, source) => {
          if (typeof cmp.ensureAudio === 'function') cmp.ensureAudio();
          return notes.noteOn(note, velocity, `kbd-${source}`);
        },
        release: (note, source, opt) => notes.noteOff(note, `kbd-${source}`, 0, opt),
        changed: () => sync(),
      });
      const sync = () => {
        cmp.kbdBase = kb.base;
        cmp.kbdVelocity = kb.velocity;
        const lo = noteName(kb.base);
        const hi = noteName(kb.base + 17);
        cmp.kbdRange = `${lo} to ${hi}`;
        cmp.kbdHeld = kb.held.map((h) => `${noteName(h.note)}${h.sources.includes('midi')
          && h.sources.length === 1 ? ' (MIDI)' : ''}`).join(', ');
        cmp.kbdSounding = kb.sounding;
        if (view) view.draw();
      };
      sync();

      const doc = win.document;
      const modalOpen = () => !!(doc && doc.querySelector
        && doc.querySelector('dialog[open], [data-oscilla-modal][aria-modal="true"]'));
      // Capture, so an armed key is the keyboard's before Studio's own letters (A, C, F, T).
      win.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') { kbdRelease(); return; }
        if (!cmp.kbdArmedHere || !playableEvent(e)) return;
        if (takesText(e.target) || takesText(doc && doc.activeElement) || modalOpen()) return;
        // An editor that owns its letters keeps them while it has the focus (KEY_ROUTES).
        const { editors } = routeOf(cmp.workspace);
        if (editors && e.target && e.target.closest && e.target.closest(editors)) return;
        e.preventDefault();
        e.stopImmediatePropagation();
        kb.keyDown(e.code, e.repeat);
      }, { capture: true });
      win.addEventListener('keyup', (e) => {
        if (kb.keyUp(e.code)) {
          e.preventDefault();
          e.stopImmediatePropagation();
        }
      }, { capture: true });
      // The forced releases of ADR 0062: a key whose keyup may never come.
      win.addEventListener('blur', kbdRelease);
      win.addEventListener('pagehide', kbdRelease);
      if (doc && typeof doc.addEventListener === 'function') {
        doc.addEventListener('visibilitychange', () => { if (doc.hidden) kbdRelease(); });
      }
      if (typeof cmp.$watch === 'function') {
        cmp.$watch('workspace', () => { kbdRelease(); if (view) view.resize(); });
      }

      // The link key: `kbd=1` arms the view the link opens, `kbd=0` disarms it.
      if (typeof cmp.navRegister === 'function') {
        cmp.navRegister('keyboard', (hash) => {
          const q = new URLSearchParams(String(hash || '').replace(/^#/, ''));
          if (!q.has(KEYBOARD_LINK_KEY)) return null;
          const r = routeOfHash(hash);
          const v = r ? r.workspace : 'playground';
          if (!KEYBOARD_VIEWS.includes(v)) return null;
          const armed = q.get(KEYBOARD_LINK_KEY) !== '0';
          cmp.kbdArmed[v] = armed;
          // The domain answers, as every link does (surface-census routes).
          if (typeof cmp.notify === 'function') {
            const where = v === 'studio' ? 'Studio' : 'Playground';
            cmp.notify('info', `Keyboard ${armed ? 'armed' : 'disarmed'} from the link`, armed
              ? `The computer keys play the ${where}. Nothing plays until you press a key.`
              : `The computer keys no longer play the ${where}.`);
          }
          return true;
        });
      }

      // A sounding note is live output: the analysis views show it as they show a played tone.
      const vizInputs = cmp.vizInputs;
      if (typeof vizInputs === 'function') {
        cmp.vizInputs = function vizInputsWithNotes(res) {
          const u = vizInputs.call(this, res);
          if (this.kbdSounding && u) u.playing = true;
          return u;
        };
      }

      if (doc && typeof doc.querySelector === 'function') {
        const mount = () => {
          view = mountKeys(win, doc, kb) || view;
          dock = dock || mountDockYield({ win, doc, cmp, buttonClass: KBD_BTN,
            dock: doc.querySelector('[data-osc="keyboard"]'), band: trackDockHeight(win, doc),
            release: kbdReleaseKeys });
        };
        if (typeof cmp.$nextTick === 'function') cmp.$nextTick(mount); else mount();
      }
    },

    /**
     * The XY pad as one more input of the keys (K183): -> { noteOn(note, velocity, source),
     * noteOff(note, source), legato(from, to, source), velocity(), off() } on this note layer,
     * or null before kbdInit. `release(reason)` closes the pad's gate; the keys' forced
     * releases call it until off().
     */
    kbdPad(release) {
      if (!notes || typeof release !== 'function') return null;
      const cmp = this;
      pads.add(release);
      return {
        noteOn(note, velocity, source) {
          if (typeof cmp.ensureAudio === 'function') cmp.ensureAudio();
          return notes.noteOn(note, velocity, source);
        },
        noteOff: (note, source) => notes.noteOff(note, source),
        legato: (from, to, source) => notes.legato(from, to, source),
        velocity: () => (kb ? kb.velocity : 100),
        off: () => { pads.delete(release); },
      };
    },

    /** Arm or disarm the computer keyboard in the view in sight. */
    kbdToggle() {
      const v = this.kbdView;
      if (!v) return;
      this.kbdArmed[v] = !this.kbdArmed[v];
      if (!this.kbdArmed[v]) kbdReleaseKeys(); // the keys' notes, never a pad's
    },

    /** An on-screen control: 'octave-down' | 'octave-up' | 'velocity-down' | 'velocity-up'. */
    kbdControl(action) {
      return kb ? kb.control(action) : false;
    },

    /** A MIDI note lit or unlit on the keys (src/js/midi/ui.js). */
    kbdLight(note, on) {
      if (kb) kb.light(note, 'midi', on);
    },

    /** Every MIDI note unlit (All Notes Off, a lost input, a forced stop). */
    kbdUnlightMidi() {
      if (kb) kb.clear('midi');
    },

    /** The dock's handle (K171): unfold or fold the keys where a pad owns the notes. */
    kbdDockToggle() {
      return dock ? dock.toggle() : false;
    },
    get kbdDockYields() {
      return !!dock && dock.yields;
    },

    /** Let go of the keys' own notes (Disarm, the dock's fold), never an XY pad's; returns how
     *  many keys or pointers held one. */
    kbdReleaseKeys() {
      return kbdReleaseKeys();
    },
    /** The panic: every note the keyboard plays, the XY pads' with them; returns the count. */
    kbdReleaseAll() {
      return kbdRelease();
    },
  };
}

/**
 * The band the docked keyboard covers at the bottom of the viewport (the dock and the status
 * bar under it) as --osc-dock-h on the root, 0px unless the dock is fixed over the page (the
 * Synth dock): the Synth view reserves it below its content and the page keeps it as scroll
 * padding, so no control and no focused element ends under the dock (WCAG 2.4.11). Returns
 * the measurement, which the dock's yield runs again before it scrolls (K171).
 */
function trackDockHeight(win, doc) {
  const dock = doc.querySelector('[data-osc="keyboard"]');
  const root = doc.documentElement;
  if (!dock || !root || typeof win.ResizeObserver !== 'function') return () => {};
  const set = () => {
    const fixed = win.getComputedStyle(dock).position === 'fixed';
    const top = dock.getBoundingClientRect().top;
    const h = fixed && top > 0 ? Math.ceil(win.innerHeight - top) : 0;
    root.style.setProperty('--osc-dock-h', `${h}px`);
  };
  new win.ResizeObserver(set).observe(dock);
  if (typeof win.MutationObserver === 'function') {
    new win.MutationObserver(set).observe(dock, { attributes: true, attributeFilter: ['class'] });
  }
  set();
  return set;
}

/**
 * The on-screen keys: the canvas under data-osc="keyboard.keys", sized to its box, drawn
 * when what is held or the octave changes, and played by pointers (one note per pointer, a
 * drag glides from key to key). Returns { draw, resize } or null without a canvas.
 */
function mountKeys(win, doc, kb) {
  const canvas = doc.querySelector('[data-osc="keyboard.keys"]');
  if (!canvas || typeof canvas.getContext !== 'function') return null;
  canvas.dataset.uiFamily = 'keyboard'; // the keys the model holds, drawn by its canvas skin
  const box = canvas.parentElement;
  // The keyboard's place in the grid of the main area and the canvas size are set here until
  // the keyboard moves into its Pro card (plan F001 to F003, ADR 0061): it follows every panel
  // of the Playground, full width, at every width. The grid item is the keyboard group, not
  // the canvas's parent: since the keys show only while armed in the Studio, the canvas sits
  // in its own x-show wrapper, and placing that wrapper left the group first in the grid.
  const item = (canvas.closest && canvas.closest('[data-osc="keyboard"]')) || box;
  if (item && item.style) {
    item.style.order = '14';
    item.style.gridColumn = '1 / -1';
  }
  const ctx = canvas.getContext('2d');
  let width = 0;
  let layout = [];
  let range = visibleRange(kb.base, 3);
  const labels = {};
  const label = (note) => {
    if (!keysInput(win).lettered) return null;
    const code = codeForNote(note, kb.base);
    return code ? (labels[code] || KEY_LABELS[code]) : null;
  };
  const view = {
    draw() {
      if (!ctx || !width) return;
      const octaves = keysOctaves(width, keysInput(win));
      range = visibleRange(kb.base, octaves);
      const lit = (note) => (kb.isLit(note)
        ? kb.held.find((h) => h.note === note).sources : null);
      layout = drawKeys(ctx, { first: range.first, last: range.last, width, height: KEYS_HEIGHT,
        lit, label, colours: keyColours(canvas) });
    },
    resize() {
      const w = Math.floor(canvas.clientWidth || (box && box.clientWidth) || 0);
      if (!w) return;
      const dpr = Math.max(1, Math.min(3, win.devicePixelRatio || 1));
      width = w;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(KEYS_HEIGHT * dpr);
      canvas.style.height = `${KEYS_HEIGHT}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      view.draw();
    },
  };
  canvas.style.width = '100%';
  canvas.style.display = 'block';
  canvas.style.touchAction = 'none';
  if (typeof win.ResizeObserver === 'function') {
    // resize() sets the canvas's own height, which the observer reports again: the resize runs
    // in the next frame and only when the observed width differs from the width last drawn, so
    // the observer never loops ("ResizeObserver loop completed", WebKit).
    let frame = 0;
    const raf = typeof win.requestAnimationFrame === 'function'
      ? (fn) => win.requestAnimationFrame(fn) : (fn) => win.setTimeout(fn, 16);
    new win.ResizeObserver((entries) => {
      const seen = entries.length ? Math.floor(entries[entries.length - 1].contentRect.width) : 0;
      if (!seen || seen === width || frame) return;
      frame = raf(() => {
        frame = 0;
        view.resize();
      });
    }).observe(canvas);
  }
  // The layout the browser knows names the keys as printed (Z on QWERTZ is KeyY): best effort.
  const kbd = win.navigator && win.navigator.keyboard;
  if (kbd && typeof kbd.getLayoutMap === 'function') {
    kbd.getLayoutMap().then((map) => {
      for (const code of Object.keys(KEY_LABELS)) {
        const k = map.get(code);
        if (k) labels[code] = k.toUpperCase();
      }
      view.draw();
    }).catch(() => {});
  }
  // Theme changes repaint the keys with the new custom properties.
  if (typeof win.MutationObserver === 'function') {
    new win.MutationObserver(() => view.draw()).observe(doc.documentElement,
      { attributes: true, attributeFilter: ['data-theme', 'class'] });
  }

  const noteOf = (e) => {
    const r = canvas.getBoundingClientRect();
    return noteAt(layout.length ? layout : keyLayout(range.first, range.last, width, KEYS_HEIGHT),
      e.clientX - r.left, e.clientY - r.top);
  };
  canvas.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.preventDefault();
    if (typeof canvas.setPointerCapture === 'function') {
      try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* not capturable */ }
    }
    kb.pointerTo(e.pointerId, noteOf(e));
  });
  canvas.addEventListener('pointermove', (e) => {
    if (e.buttons === 0 && e.pointerType === 'mouse') return;
    kb.pointerTo(e.pointerId, noteOf(e));
  });
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) {
    canvas.addEventListener(type, (e) => kb.pointerUp(e.pointerId));
  }
  view.resize();
  return view;
}
