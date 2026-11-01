// The XY pad kind (plan W010, mounted first by K097's XY tab): two declared parameters on one
// surface, over charts/drag-math.js (pointer -> fractions) and the parameter value model of
// synth/view/knob.js (unit, bounds, log or linear, the keys), so each axis steps and reads as
// the knob of its parameter does. The surface is role=application inside a role=group with one
// slider per axis (aria-valuetext in its unit). A drag previews live and ends in one commit;
// the gate is open while the pad is touched (pointer, or Enter held on the surface) and closes
// on release, blur, page hide and Escape. A second touch point sets Y only. An integer axis is
// a row of equal cells (the pad's scale steps). No store, no audio, no timer: the consumer's
// callbacks do the rest.
//
//   createXyModel({ x, y, value, text, onPreview, onCommit, onGate }) -> model   pure
//     x, y: parameter specs (registry.js shape); value { x, y }; text { x(v), y(v) } optional
//     model.down(id, fx, fy), move(id, fx, fy), up(id), end(reason), key(key, shift, axis?),
//       gate(on), reset() -> handled;  model.value, model.gated, model.fraction()
//     onPreview(value), onCommit(value, reason), onGate(open, value, reason)
//   mountXyPad(host, { label, description, cells, disabled, ...model options }) -> view
//     view.model, view.update(), view.destroy();  cells: [{ label, root }] drawn along X

import { xyFromPoint } from '../../charts/drag-math.js';
import { knobModel } from '../../synth/view/knob.js';

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

const SLIDER = 'flex h-11 items-center justify-between gap-2 rounded-lg border border-solid '
  + 'border-gray-300 bg-gray-50 px-3 text-xs text-gray-900 focus:outline-none focus-visible:ring-2 '
  + 'focus-visible:ring-primary-500 dark:border-gray-600 dark:bg-gray-700 dark:text-white';

let mounted = 0;

export function mountXyPad(host, opts) {
  const { label, description = '', cells = [], disabled = null } = opts;
  const model = createXyModel(opts);
  const uid = `xy-pad-${(mounted += 1)}`;
  const n = Math.max(1, cells.length);
  const lines = cells.map((c, i) => `<line x1="${(100 * i) / n}" x2="${(100 * i) / n}" y1="0" `
    + 'y2="100" vector-effect="non-scaling-stroke" '
    + `class="${c.root ? 'stroke-gray-400' : 'stroke-gray-700'}"/>`).join('');
  const slider = (axis, p) => `<div role="slider" tabindex="0" data-xy-axis="${axis}" `
    + `aria-label="${esc(`${axis.toUpperCase()}: ${p.label}`)}" class="${SLIDER}"><span>`
    + `${esc(p.label)}</span><span class="font-mono" data-xy-text="${axis}"></span></div>`;
  host.innerHTML = `<div role="group" aria-label="${esc(label)}">`
    + `<div role="application" tabindex="0" data-xy-surface="pad" aria-roledescription="XY pad" `
    + `aria-label="${esc(label)}" aria-describedby="${uid}-d${disabled ? ` ${uid}-w` : ''}" `
    + `aria-disabled="${disabled ? 'true' : 'false'}" class="relative h-56 w-full sm:h-72 `
    + 'touch-none select-none overflow-hidden rounded-lg bg-gray-900 focus:outline-none '
    + `focus-visible:ring-4 focus-visible:ring-primary-500 ${disabled ? 'opacity-50' : ''}">`
    + '<svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true" '
    + `class="absolute inset-0 h-full w-full">${lines}<line data-xy-cx="" y1="0" y2="100" `
    + 'vector-effect="non-scaling-stroke" class="stroke-primary-500" stroke-width="2"/>'
    + '<line data-xy-cy="" x1="0" x2="100" vector-effect="non-scaling-stroke" '
    + 'class="stroke-primary-500" stroke-width="2"/></svg></div>'
    + `<ol aria-hidden="true" class="mt-1 flex text-[10px] text-gray-500 dark:text-gray-400">`
    + cells.map((c) => `<li class="flex-1 text-center ${c.root ? 'font-bold' : ''}">`
      + `${n <= 29 || c.root ? esc(c.label) : ''}</li>`).join('')
    + `</ol><p id="${uid}-d" class="sr-only">${esc(description)}</p>`
    + (disabled ? `<p id="${uid}-w" class="mt-2 text-sm text-gray-700 dark:text-gray-300" `
      + `data-xy-why="">${esc(disabled)}</p>` : '')
    + `<div class="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">${slider('x', opts.x)}`
    + `${slider('y', opts.y)}</div></div>`;
  const surface = host.querySelector('[data-xy-surface]');
  const group = host.firstElementChild;

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
  }
  const wrap = (fn) => (...a) => { const r = fn(...a); update(); return r; };
  for (const k of ['down', 'move', 'up', 'end', 'gate', 'key', 'reset']) model[k] = wrap(model[k]);

  const at = (e) => {
    const r = surface.getBoundingClientRect();
    return xyFromPoint(e.clientX, e.clientY, { x: r.left, y: r.top, w: r.width, h: r.height });
  };
  const on = (el, type, fn) => {
    el.addEventListener(type, fn);
    return () => el.removeEventListener(type, fn);
  };
  const hide = () => model.end('hide');
  const offs = [
    on(surface, 'pointerdown', (e) => {
      if (disabled) return;
      e.preventDefault();
      try { surface.setPointerCapture(e.pointerId); } catch (err) { /* not a live pointer */ }
      if (document.activeElement !== surface) surface.focus({ preventScroll: true });
      const p = at(e);
      model.down(e.pointerId, p.x, p.y);
    }),
    on(surface, 'pointermove', (e) => {
      const p = at(e);
      model.move(e.pointerId, p.x, p.y);
    }),
    on(surface, 'pointerup', (e) => model.up(e.pointerId)),
    on(surface, 'pointercancel', () => model.end('cancel')),
    on(surface, 'dblclick', () => { if (!disabled) model.reset(); }),
    on(group, 'keydown', (e) => {
      const axis = e.target.dataset && e.target.dataset.xyAxis;
      if (e.key === 'Escape') { model.end('escape'); return; }
      if (disabled) return;
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
    destroy() {
      model.end('hide');
      for (const off of offs) off();
    },
  };
}
