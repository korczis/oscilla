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
// The controllers stay out of reactive state; the component holds plain values only.

import {
  createKeyboard, codeForNote, KEY_LABELS, noteName, playableEvent, visibleRange,
  KEYBOARD_LINK_KEY, KEYBOARD_VIEWS,
} from './keyboard.js';
import { drawKeys, keyColours, keyLayout, noteAt } from './keyboard-view.js';
import { routeOfHash } from '../ui/navigation.js';

export const KEYBOARD_REFUSED = Object.freeze({
  measurement: 'Keyboard notes do not play while the measurement owns the output: stop it '
    + '(Esc) first.',
  reference: 'Keyboard notes do not play while the level reference is being captured.',
  studio: 'Keyboard notes do not play while the Studio is playing: stop it first.',
  sequencer: 'Keyboard notes do not play while the sequencer is playing: stop it (Esc) first.',
});

const KEYS_HEIGHT = 132; // CSS px of the on-screen keys

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
  const kbdRelease = () => (kb ? kb.releaseAll() : 0);

  return {
    kbdArmed: { playground: false, studio: false },
    kbdBase: 60,
    kbdVelocity: 100,
    kbdHeld: '',
    kbdSounding: false,
    kbdRange: '',

    /** The view the keyboard belongs to now ('playground' | 'studio'), else null. */
    get kbdView() {
      return KEYBOARD_VIEWS.includes(this.workspace) ? this.workspace : null;
    },
    get kbdArmedHere() {
      const v = this.kbdView;
      return !!v && !!this.kbdArmed[v];
    },
    /** What the readout says: armed or not, the keys' range, the velocity. */
    get kbdReadout() {
      const range = this.kbdRange;
      const where = this.kbdView === 'studio' ? 'Studio' : 'Playground';
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
        release: (note, source) => notes.noteOff(note, `kbd-${source}`),
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
          cmp.kbdArmed[v] = q.get(KEYBOARD_LINK_KEY) !== '0';
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
        const mount = () => { view = mountKeys(win, doc, kb) || view; };
        if (typeof cmp.$nextTick === 'function') cmp.$nextTick(mount); else mount();
      }
    },

    /** Arm or disarm the computer keyboard in the view in sight. */
    kbdToggle() {
      const v = this.kbdView;
      if (!v) return;
      this.kbdArmed[v] = !this.kbdArmed[v];
      if (!this.kbdArmed[v]) kbdRelease();
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

    /** Let go of every note the keyboard plays; returns how many keys or pointers held one. */
    kbdReleaseAll() {
      return kbdRelease();
    },
  };
}

/**
 * The on-screen keys: the canvas under data-osc="keyboard.keys", sized to its box, drawn
 * when what is held or the octave changes, and played by pointers (one note per pointer, a
 * drag glides from key to key). Returns { draw, resize } or null without a canvas.
 */
function mountKeys(win, doc, kb) {
  const canvas = doc.querySelector('[data-osc="keyboard.keys"]');
  if (!canvas || typeof canvas.getContext !== 'function') return null;
  const box = canvas.parentElement;
  // The keyboard's place in the grid of the main area and the canvas size are set here until
  // the keyboard moves into its Pro card (plan F001 to F003, ADR 0061): it follows every panel
  // of the Playground, full width, at every width.
  if (box && box.style) {
    box.style.order = '14';
    box.style.gridColumn = '1 / -1';
  }
  const ctx = canvas.getContext('2d');
  let width = 0;
  let layout = [];
  let range = visibleRange(kb.base, 3);
  const labels = {};
  const label = (note) => {
    const code = codeForNote(note, kb.base);
    return code ? (labels[code] || KEY_LABELS[code]) : null;
  };
  const view = {
    draw() {
      if (!ctx || !width) return;
      const octaves = width < 560 ? 2 : 3;
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
    new win.ResizeObserver(() => view.resize()).observe(canvas);
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
