// The XY pad kind (plan W010, mounted first by K097's XY tab): two declared parameters on one
// surface, over charts/drag-math.js (pointer -> fractions) and the parameter value model of
// synth/view/knob.js (unit, bounds, log or linear, the keys), so each axis steps and reads as
// the knob of its parameter does. The surface is role=application inside a role=group with one
// slider per axis (aria-valuetext in its unit). A drag previews live and ends in one commit;
// the gate is open while the pad is touched (pointer, or Enter held on the surface) and closes
// on release, blur, page hide and Escape. A second touch point sets Y only. An integer axis is
// a row of equal cells (the pad's scale steps). A disabled pad keeps its dashed frame and its
// grid at reduced contrast and states its reason above its face (K167, S3). No store, no audio,
// no timer: the consumer's callbacks do the rest.
//
// The view (S3, pure view: what the pad already sends, drawn): above the surface the gate LED
// (ui/synth/led.js ledSvg, lit by the model's gate) and the reason of a disabled pad; on it the
// X cells with their labels (the consumer's, the root cells' lines distinct), the Y ends
// (readout.yEnds), the crosshair on the value's cell and, while touched or keyboard-focused, a
// ring at the touch point with the consumer's two readouts beside it (readout.x of X's value,
// the note; readout.y of Y's, the target's value) and the trail of the last TRAIL_MS of motion
// (at most TRAIL_MAX points, cleared at the release; none under prefers-reduced-motion). The
// drawing is aria-hidden: the sliders' aria-valuetext says the same. It draws on an animation
// frame, from attributes only (no layout read while drawing), and schedules no frame while idle.
//
//   createXyModel({ x, y, value, text, onPreview, onCommit, onGate }) -> model   pure
//     x, y: parameter specs (registry.js shape); value { x, y }; text { x(v), y(v) } optional
//     model.down(id, fx, fy), move(id, fx, fy), up(id), end(reason), key(key, shift, axis?),
//       gate(on), reset() -> handled;  model.value, model.gated, model.fraction()
//     onPreview(value), onCommit(value, reason), onGate(open, value, reason)
//   createTrail({ ms, max }) -> trail   pure: push(x, y, t), points(t) -> [{ x, y, age 0..1 }]
//     (the last `ms` before t, at most `max`), clear(), size
//   cursorPlace(x, y) -> { anchor, dx, dy }   where the readouts sit beside the point (0..1, y up)
//   mountXyPad(host, { label, description, cells, disabled, describedBy, readout,
//     ...model options }) -> view: view.model, view.update(), view.destroy(), view.trail;
//     cells: [{ label, root }] drawn along X; describedBy: ids of the consumer's own lines that
//     also describe the surface (K167: the first action), after the axes' description;
//     readout { x(v), y(v) -> text | null, yEnds: [bottom, top] | () -> [bottom, top] | null }
//     for the drawing (a function's ends are read again on each drawn frame)

import { xyFromPoint } from '../../charts/drag-math.js';
import { knobModel } from '../../synth/view/knob.js';
import { ledBox, ledSvg } from '../synth/led.js';
import { synthTokens } from '../synth/tokens.js';

/** The trail: the last TRAIL_MS of motion, at most TRAIL_MAX points. */
export const TRAIL_MS = 600;
export const TRAIL_MAX = 24;
const REDUCED = '(prefers-reduced-motion: reduce)';

const SURFACE_KEYS = { ArrowLeft: 'x', ArrowRight: 'x', Home: 'x', End: 'x', ArrowUp: 'y',
  ArrowDown: 'y', PageUp: 'y', PageDown: 'y' };
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);

export function createXyModel({ x, y, value = {}, text = {}, onPreview = () => {},
  onCommit = () => {}, onGate = () => {} }) {
  const axes = { x: knobModel(x), y: knobModel(y) };
  const v = { x: value.x ?? x.default, y: value.y ?? y.default };
  const touch = [];
  let gated = false;
  const copy = () => ({ ...v });
  const spec = { x, y };
  // An integer axis is a row of equal cells (one per value); a number axis is continuous.
  const cells = (axis) => (spec[axis].type === 'integer' ? spec[axis].max - spec[axis].min + 1
    : 0);
  const set = (axis, f) => {
    if (f == null) return;
    const n = cells(axis);
    v[axis] = n ? spec[axis].min + Math.min(n - 1, Math.floor(f * n)) : axes[axis].value(f);
  };
  const frac = (axis) => {
    const n = cells(axis);
    return n ? (v[axis] - spec[axis].min + 0.5) / n : axes[axis].norm(v[axis]);
  };
  const model = {
    get value() { return copy(); },
    get gated() { return gated; },
    /** Whether pointer `id` holds the pad now. */
    holds: (id) => touch.includes(id),
    /** Where the cursor is drawn, 0..1 per axis (an integer axis: its cell's centre). */
    fraction: () => ({ x: frac('x'), y: frac('y') }),
    text: (axis) => (text[axis] || axes[axis].text)(v[axis]),
    down(id, fx, fy) {
      if (touch.includes(id)) return false;
      touch.push(id);
      set('x', touch.length === 1 ? fx : null);
      set('y', fy);
      if (gated) onPreview(copy());
      else model.gate(true);
      return true;
    },
    move(id, fx, fy) {
      const i = touch.indexOf(id);
      if (i < 0) return false;
      set('x', i === 0 ? fx : null);
      set('y', fy);
      onPreview(copy());
      return true;
    },
    up(id) {
      const i = touch.indexOf(id);
      if (i < 0) return false;
      touch.splice(i, 1);
      if (!touch.length) model.end('release');
      return true;
    },
    end(reason) {
      touch.length = 0;
      if (!gated) return false;
      gated = false;
      onGate(false, copy(), reason);
      onCommit(copy(), reason);
      return true;
    },
    gate(on) {
      if (!on) return model.end('release');
      if (gated) return false;
      gated = true;
      onGate(true, copy(), 'touch');
      return true;
    },
    key(key, shift = false, axis = SURFACE_KEYS[key]) {
      const next = axis && axes[axis].key(v[axis], key, shift);
      if (next == null) return false;
      v[axis] = next;
      onPreview(copy());
      return true;
    },
    /** Put the cursor at `value` ({ x?, y? }) without a preview or a commit: what the caller
     *  already sounds (the XY mount puts Y back at its rest on a release, K183). */
    place(value = {}) {
      if (value.x != null) v.x = value.x;
      if (value.y != null) v.y = value.y;
      return true;
    },
    reset() {
      v.x = x.default;
      v.y = y.default;
      onPreview(copy());
      onCommit(copy(), 'reset');
      return true;
    },
  };
  return model;
}

export function createTrail({ ms = TRAIL_MS, max = TRAIL_MAX } = {}) {
  let pts = [];
  return {
    push(x, y, t) {
      const last = pts[pts.length - 1];
      if (last && last.x === x && last.y === y) { last.t = t; return; }
      pts.push({ x, y, t });
      if (pts.length > max) pts = pts.slice(pts.length - max);
    },
    points(t) {
      pts = pts.filter((p) => t - p.t <= ms);
      return pts.map((p) => ({ x: p.x, y: p.y, age: Math.max(0, (t - p.t) / ms) }));
    },
    clear() { pts = []; },
    get size() { return pts.length; },
  };
}

/** The readouts beside the point (x, y 0..1, y up): above it, below near the top edge, anchored
 *  inwards near a side, so they stay on the face; dx, dy in px from the point (the note's line). */
export function cursorPlace(x, y) {
  const anchor = x < 0.2 ? 'start' : x > 0.8 ? 'end' : 'middle';
  return { anchor, dx: anchor === 'start' ? -6 : anchor === 'end' ? 6 : 0,
    dy: y > 0.7 ? 36 : -40 };
}

const SLIDER = 'flex h-11 items-center justify-between gap-2 rounded-lg border border-solid '
  + 'border-gray-300 bg-gray-50 px-3 text-xs text-gray-900 focus:outline-none focus-visible:ring-2 '
  + 'focus-visible:ring-primary-500 dark:border-gray-600 dark:bg-gray-700 dark:text-white';

// The grid on the live pad, and on a disabled one: the same frame and lines at reduced contrast
// on a light face (light theme) or a dark one (dark theme), with the reason on the face.
const GRID = { root: 'stroke-gray-400', cell: 'stroke-gray-700' };
const GRID_OFF = { root: 'stroke-gray-400 dark:stroke-gray-500',
  cell: 'stroke-gray-300 dark:stroke-gray-600' };
// The page's global [aria-disabled="true"] fade (integration.css) would wash the reason out: the
// reduced contrast is the frame's and the grid's colours instead, the face stays legible.
const SURFACE_OFF = '!cursor-not-allowed !opacity-100 border-2 border-dashed border-gray-400 '
  + 'bg-gray-100 dark:border-gray-500 dark:bg-gray-800';
// A disabled pad's reason, above the surface: the docked keyboard covers the bottom of the view,
// never what sits above the pad (S3).
const WHY = 'mb-2 rounded-lg border border-solid border-gray-300 bg-white px-3 py-2 text-center '
  + 'text-sm font-medium text-gray-900 shadow-sm dark:border-gray-600 dark:bg-gray-700 '
  + 'dark:text-white';
// The drawing on the face (always on the dark pad face, in both themes).
const LABEL = 'stroke-gray-900 font-semibold';
const TRAIL_LINE = 'stroke-primary-300';
// The trail fades by age in four steps of Tailwind's opacity scale (no literal opacity).
const FADE = ['opacity-100', 'opacity-75', 'opacity-50', 'opacity-25'];
const Y_END = 'pointer-events-none absolute left-2 font-mono text-xs text-gray-300';

// The pad's height follows the room that is really there (K171, the OSCILLA-pad audit S2): at
// most the dynamic viewport less the app chrome above the pad (--osc-chrome-h) and the band the
// docked keyboard covers (--osc-dock-h), both measured by midi/dock-yield.js, and a gap; 14rem
// on a phone and 18rem from sm up where the room allows, never less than 6rem, so the whole pad
// fits above the dock at 1536 x 1024, 1280 x 720, 390 x 844 and 375 x 667, folded and unfolded
// with its keys (at 375 x 667 the unfolded keys leave about 7.5rem). Each class is one string,
// as the build's class scan reads it.
const ROOM = 'h-56 min-h-24 sm:h-72 '
  + 'max-h-[calc(100dvh_-_var(--osc-chrome-h,0px)_-_var(--osc-dock-h,0px)_-_0.5rem)]';

let mounted = 0;

const pct = (f) => `${(100 * f).toFixed(3)}%`;

export function mountXyPad(host, opts) {
  const { label, description = '', cells = [], disabled = null, describedBy = [],
    readout = {} } = opts;
  const model = createXyModel(opts);
  const uid = `xy-pad-${(mounted += 1)}`;
  const n = Math.max(1, cells.length);
  const lines = cells.map((c, i) => `<line x1="${(100 * i) / n}" x2="${(100 * i) / n}" y1="0" `
    + `y2="100" vector-effect="non-scaling-stroke" stroke-width="${c.root ? 2 : 1}" `
    + `class="${(disabled ? GRID_OFF : GRID)[c.root ? 'root' : 'cell']}"/>`).join('');
  const cursor = disabled ? 'stroke-gray-400 dark:stroke-gray-500' : 'stroke-primary-500';
  const slider = (axis, p) => `<div role="slider" tabindex="0" data-xy-axis="${axis}" `
    + `aria-label="${esc(`${axis.toUpperCase()}: ${p.label}`)}" class="${SLIDER}"><span>`
    + `${esc(p.label)}</span><span class="font-mono" data-xy-text="${axis}"></span></div>`;
  const endsOf = () => (typeof readout.yEnds === 'function' ? readout.yEnds() : readout.yEnds);
  const ends = !disabled && readout.yEnds ? endsOf() : null;
  const led = ledBox({ at: { x: 0, y: 0 } });
  const cellsOn = opts.x.type === 'integer' && cells.length;
  host.innerHTML = `<div role="group" aria-label="${esc(label)}">`
    // Above the surface: the gate LED, and why a disabled pad plays nothing (S3).
    + '<div class="mb-2 flex items-center gap-2 text-xs font-medium text-gray-700 '
    + 'dark:text-gray-300" aria-hidden="true"><svg data-xy-gate="" class="h-5 w-5" viewBox="'
    + `${led.x} ${led.y} ${led.width} ${led.height}"></svg><span>Gate</span></div>`
    + (disabled ? `<p id="${uid}-w" data-xy-why="" aria-hidden="true" class="${WHY}">`
      + `${esc(disabled)}</p>` : '')
    + `<div role="application" tabindex="0" data-xy-surface="pad" aria-roledescription="XY pad" `
    + `aria-label="${esc(label)}" aria-describedby="${esc([`${uid}-d`, ...(disabled
      ? [`${uid}-w`] : []), ...describedBy].join(' '))}" `
    + `aria-disabled="${disabled ? 'true' : 'false'}" class="relative ${ROOM} w-full `
    + 'touch-none select-none overflow-hidden rounded-lg focus:outline-none '
    + `focus-visible:ring-4 focus-visible:ring-primary-500 ${disabled ? SURFACE_OFF
      : 'bg-gray-900'}">`
    + '<svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true" '
    + `class="absolute inset-0 h-full w-full">${cellsOn ? `<rect data-xy-cell="" y="0" `
      + `height="100" width="${100 / n}" class="hidden fill-primary-500 stroke-none `
      + 'opacity-25"/>' : ''}`
    + `${lines}<line data-xy-cx="" y1="0" y2="100" `
    + `vector-effect="non-scaling-stroke" class="${cursor}" stroke-width="2"/>`
    + '<line data-xy-cy="" x1="0" x2="100" vector-effect="non-scaling-stroke" '
    + `class="${cursor}" stroke-width="2"/></svg>`
    + (ends ? `<span data-xy-yend="top" aria-hidden="true" class="${Y_END} top-1">`
      + `${esc(ends[1])}</span><span data-xy-yend="bottom" aria-hidden="true" `
      + `class="${Y_END} bottom-1">${esc(ends[0])}</span>` : '')
    // The touch point, its readouts and the trail: pixel-true over the face (percentages).
    + (disabled ? '' : '<svg data-xy-view="" aria-hidden="true" class="pointer-events-none '
      + 'absolute inset-0 h-full w-full overflow-visible"><g data-xy-trail="">'
      + Array.from({ length: TRAIL_MAX - 1 }, () => `<line class="hidden ${TRAIL_LINE}" `
        + 'stroke-width="3" stroke-linecap="round"/>').join('')
      + '</g><g data-xy-cursor="" class="hidden"><circle data-xy-ring="" r="18" '
      + 'class="fill-none stroke-white" stroke-width="2"/><circle data-xy-dot="" r="3" '
      + 'class="fill-primary-300 stroke-none"/>'
      + `<text data-xy-note="" class="${LABEL} fill-white text-sm" stroke-width="3" `
      + 'paint-order="stroke"></text>'
      + `<text data-xy-value="" class="${LABEL} fill-gray-100 text-xs" stroke-width="3" `
      + 'paint-order="stroke"></text></g></svg>')
    + '</div>'
    + `<ol aria-hidden="true" class="mt-1 flex text-xs xl:text-[10px] text-gray-500 dark:text-gray-400">`
    + cells.map((c) => `<li class="flex-1 text-center ${c.root ? 'font-bold' : ''}">`
      + `${n <= 29 || c.root ? esc(c.label) : ''}</li>`).join('')
    + `</ol><p id="${uid}-d" class="sr-only">${esc(description)}</p>`
    + `<div class="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">${slider('x', opts.x)}`
    + `${slider('y', opts.y)}</div></div>`;
  const surface = host.querySelector('[data-xy-surface]');
  const group = host.firstElementChild;
  const q = (sel) => host.querySelector(sel);
  const gateEl = q('[data-xy-gate]');
  const view = q('[data-xy-view]');
  const ring = view && [q('[data-xy-ring]'), q('[data-xy-dot]')];
  const [note, value] = view ? [q('[data-xy-note]'), q('[data-xy-value]')] : [];
  const cursorG = view && q('[data-xy-cursor]');
  const endEls = ends ? [q('[data-xy-yend="bottom"]'), q('[data-xy-yend="top"]')] : [];
  const segs = view ? [...q('[data-xy-trail]').children] : [];
  const cellEl = q('[data-xy-cell]');
  const trail = createTrail();
  const mq = typeof matchMedia === 'function' ? matchMedia(REDUCED) : null;
  const reduced = () => !!(mq && mq.matches);
  const raf = typeof requestAnimationFrame === 'function' ? requestAnimationFrame
    : (fn) => setTimeout(fn, 16);
  const caf = typeof cancelAnimationFrame === 'function' ? cancelAnimationFrame : clearTimeout;
  let frame = 0;
  let lit = null; // the gate the LED shows
  let raw = null; // the touch point (0..1, y up) while a pointer holds the pad
  let primary = null; // the pointer whose moves set X
  let focused = false; // keyboard focus on the surface
  let pressing = false; // a pointer is focusing the surface: that focus is not the keyboard's

  /** The point drawn: the touch point under a pointer, else the value (its cell's centre). */
  const point = () => raw || model.fraction();
  const shown = () => !disabled && (model.gated || focused);

  function draw() {
    frame = 0;
    if (!view) return;
    const on = shown();
    if (endEls.length && typeof readout.yEnds === 'function') {
      endsOf().forEach((t, i) => { endEls[i].textContent = t; });
    }
    cursorG.classList.toggle('hidden', !on);
    if (cellEl) cellEl.classList.toggle('hidden', !on);
    if (on) {
      const p = point();
      const v = model.value;
      for (const c of ring) {
        c.setAttribute('cx', pct(p.x));
        c.setAttribute('cy', pct(1 - p.y));
      }
      const place = cursorPlace(p.x, p.y);
      const y2 = readout.y ? readout.y(v.y) : null;
      [[note, readout.x ? readout.x(v.x) : model.text('x'), 0], [value, y2, 16]]
        .forEach(([el, text, dy]) => {
          el.textContent = text || '';
          el.setAttribute('x', pct(p.x));
          el.setAttribute('y', pct(1 - p.y));
          el.setAttribute('dx', String(place.dx));
          el.setAttribute('dy', String(place.dy + dy));
          el.setAttribute('text-anchor', place.anchor);
        });
      if (cellEl) cellEl.setAttribute('x', String((100 * (v.x - opts.x.min)) / n));
    }
    // The trail: segments between the kept points, the oldest faintest; none when reduced.
    const pts = on && model.gated && !reduced() ? trail.points(nowMs()) : [];
    segs.forEach((seg, i) => {
      const a = pts[i];
      const b = pts[i + 1];
      if (!a || !b) { seg.setAttribute('class', `hidden ${TRAIL_LINE}`); return; }
      seg.setAttribute('x1', pct(a.x));
      seg.setAttribute('y1', pct(1 - a.y));
      seg.setAttribute('x2', pct(b.x));
      seg.setAttribute('y2', pct(1 - b.y));
      seg.setAttribute('class', `${TRAIL_LINE} ${FADE[Math.min(3, Math.floor(a.age * 4))]}`);
    });
    if (pts.length > 1) schedule(); // still fading: one more frame; idle schedules none
  }
  const nowMs = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
  function schedule() {
    if (!frame) frame = raf(draw);
  }

  function update() {
    const f = model.fraction();
    const set = (sel, a, b, val) => {
      const el = host.querySelector(sel);
      el.setAttribute(a, val);
      el.setAttribute(b, val);
    };
    set('[data-xy-cx]', 'x1', 'x2', (100 * f.x).toFixed(2));
    set('[data-xy-cy]', 'y1', 'y2', (100 * (1 - f.y)).toFixed(2));
    for (const axis of ['x', 'y']) {
      const el = host.querySelector(`[data-xy-axis="${axis}"]`);
      const p = opts[axis];
      const vals = { 'aria-valuemin': p.min, 'aria-valuemax': p.max,
        'aria-valuenow': model.value[axis], 'aria-valuetext': model.text(axis) };
      for (const [k, val] of Object.entries(vals)) el.setAttribute(k, String(val));
      host.querySelector(`[data-xy-text="${axis}"]`).textContent = model.text(axis);
    }
    surface.setAttribute('aria-pressed', String(model.gated));
    if (lit !== model.gated) { // the gate LED: redrawn only when the gate changes
      lit = model.gated;
      gateEl.setAttribute('data-gate', String(lit));
      gateEl.innerHTML = ledSvg({ at: { x: 0, y: 0 }, lit, source: 'xy.gate',
        tokens: synthTokens(gateEl) });
    }
    if (!model.gated) {
      raw = null;
      primary = null;
      trail.clear();
    } else if (!reduced()) {
      const p = point();
      trail.push(p.x, p.y, nowMs());
    }
    schedule();
  }
  const wrap = (fn) => (...a) => { const r = fn(...a); update(); return r; };
  for (const k of ['down', 'move', 'up', 'end', 'gate', 'key', 'reset', 'place']) {
    model[k] = wrap(model[k]);
  }
  // A key moves the value, not a finger: the point is the value's again.
  const keyed = model.key;
  model.key = (...a) => { raw = null; return keyed(...a); };

  const at = (e) => {
    const r = surface.getBoundingClientRect();
    return xyFromPoint(e.clientX, e.clientY, { x: r.left, y: r.top, w: r.width, h: r.height });
  };
  /** The touch point of pointer e: X from the pointer that sets X, Y from any. */
  const touchAt = (e, p) => {
    if (primary === null) primary = e.pointerId; // the first, or the one left holding: X
    raw = e.pointerId === primary ? { x: p.x, y: p.y } : { x: (raw || model.fraction()).x,
      y: p.y };
  };
  const on = (el, type, fn) => {
    el.addEventListener(type, fn);
    return () => el.removeEventListener(type, fn);
  };
  const hide = () => model.end('hide');
  const focusVisible = () => {
    try { return surface.matches(':focus-visible'); } catch (err) { return false; }
  };
  const offs = [
    on(surface, 'pointerdown', (e) => {
      if (disabled) return;
      e.preventDefault();
      try { surface.setPointerCapture(e.pointerId); } catch (err) { /* not a live pointer */ }
      pressing = true;
      if (document.activeElement !== surface) surface.focus({ preventScroll: true });
      pressing = false;
      const p = at(e);
      const was = raw;
      touchAt(e, p);
      if (!model.down(e.pointerId, p.x, p.y)) raw = was;
    }),
    on(surface, 'pointermove', (e) => {
      if (!model.gated) return; // a hovering mouse moves nothing
      const p = at(e);
      const was = raw;
      const prim = primary;
      touchAt(e, p);
      if (!model.move(e.pointerId, p.x, p.y)) {
        raw = was;
        primary = prim;
      }
    }),
    on(surface, 'pointerup', (e) => {
      if (e.pointerId === primary) primary = null;
      model.up(e.pointerId);
    }),
    on(surface, 'pointercancel', () => model.end('cancel')),
    // A capture lost while its pointer still holds the pad (the element re-rendered, another
    // capture, the browser's own gesture) is a cancel; after a pointerup it changes nothing.
    on(surface, 'lostpointercapture', (e) => {
      if (model.holds(e.pointerId)) model.end('cancel');
    }),
    on(surface, 'dblclick', () => { if (!disabled) model.reset(); }),
    on(surface, 'focus', () => { focused = !pressing && focusVisible(); schedule(); }),
    on(surface, 'blur', () => { focused = false; schedule(); }),
    on(group, 'keydown', (e) => {
      const axis = e.target.dataset && e.target.dataset.xyAxis;
      if (e.key === 'Escape') { model.end('escape'); return; }
      if (disabled) return;
      if (e.target === surface) focused = true; // a key on the surface: keyboard focus
      if (e.target === surface && e.key === 'Enter') {
        e.preventDefault();
        if (!e.repeat) model.gate(true);
      } else if ((axis || e.target === surface) && model.key(e.key, e.shiftKey, axis
        || SURFACE_KEYS[e.key])) {
        e.preventDefault();
        e.stopPropagation();
      }
    }),
    on(group, 'keyup', (e) => {
      if (e.key === 'Enter' && e.target === surface) model.gate(false);
    }),
    on(group, 'focusout', (e) => { if (!group.contains(e.relatedTarget)) model.end('blur'); }),
    on(window, 'blur', () => model.end('blur')),
    on(window, 'pagehide', hide),
    on(document, 'visibilitychange', () => { if (document.hidden) hide(); }),
  ];
  update();
  return {
    model,
    update,
    trail,
    destroy() {
      model.end('hide');
      if (frame) caf(frame);
      frame = 0;
      for (const off of offs) off();
    },
  };
}
