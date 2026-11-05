// S3: the XY pad kind's view (src/js/ui/kinds/xy-pad.js). Above the surface the gate LED
// (led.js, lit by the model's gate) and a disabled pad's reason; on the face the Y ends, and
// while touched or keyboard-focused a ring at the touch point with the consumer's readouts
// beside it and the trail of the last TRAIL_MS of motion (at most TRAIL_MAX points), cleared at
// the release and never drawn under prefers-reduced-motion. Drawn on an animation frame; no
// frame is scheduled while idle. The DOM is a small stand-in that reads the kind's own markup.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  TRAIL_MAX, TRAIL_MS, createTrail, cursorPlace, mountXyPad,
} from '../../src/js/ui/kinds/xy-pad.js';

// ---------------------------------------------------------------- the trail, pure

test('the trail keeps the last TRAIL_MS of motion, at most TRAIL_MAX points; clear empties', () => {
  assert.equal(TRAIL_MS, 600);
  const t = createTrail();
  for (let i = 0; i < 3 * TRAIL_MAX; i++) t.push(i / 100, 0.5, i);
  assert.equal(t.size, TRAIL_MAX, 'capped');
  const pts = t.points(3 * TRAIL_MAX - 1);
  assert.equal(pts.length, TRAIL_MAX);
  assert.equal(pts[pts.length - 1].x, (3 * TRAIL_MAX - 1) / 100, 'the newest kept');
  assert.ok(pts.every((p) => p.age >= 0 && p.age <= 1));
  assert.equal(t.points(3 * TRAIL_MAX - 1 + TRAIL_MS + 1).length, 0, 'older than TRAIL_MS: gone');
  t.push(0.1, 0.1, 0);
  t.push(0.1, 0.1, 5);
  assert.equal(t.size, 1, 'a point that did not move is one point');
  t.clear();
  assert.equal(t.size, 0);
  const short = createTrail({ ms: 100, max: 3 });
  for (let i = 0; i < 10; i++) short.push(i, i, i * 10);
  assert.deepEqual(short.points(95).map((p) => p.x), [7, 8, 9]);
});

test('the readouts sit on the face: above the point, below near the top, inwards at a side', () => {
  assert.deepEqual(cursorPlace(0.5, 0.5), { anchor: 'middle', dx: 0, dy: -40 });
  assert.equal(cursorPlace(0.5, 0.9).dy > 0, true, 'near the top: below the ring');
  assert.equal(cursorPlace(0.05, 0.5).anchor, 'start');
  assert.equal(cursorPlace(0.95, 0.5).anchor, 'end');
});

// ---------------------------------------------------------------- a small DOM stand-in

function el(name = '') {
  const on = new Map();
  const attrs = new Map();
  const cls = new Set();
  return {
    name, textContent: '', innerHTML: '', children: [],
    classList: {
      toggle(c, force) { if (force ?? !cls.has(c)) cls.add(c); else cls.delete(c); },
      contains: (c) => cls.has(c),
    },
    setAttribute(k, v) {
      attrs.set(k, String(v));
      if (k === 'class') { cls.clear(); for (const c of String(v).split(/\s+/)) if (c) cls.add(c); }
    },
    getAttribute: (k) => (attrs.has(k) ? attrs.get(k) : null),
    addEventListener(t, fn) { if (!on.has(t)) on.set(t, new Set()); on.get(t).add(fn); },
    removeEventListener(t, fn) { if (on.has(t)) on.get(t).delete(fn); },
    fire(t, e = {}) { for (const fn of [...(on.get(t) || [])]) fn({ target: this, ...e }); },
    listeners: () => [...on.values()].reduce((n, s) => n + s.size, 0),
    contains: () => false,
    focus() { globalThis.document.activeElement = this; },
    matches: () => false,
    setPointerCapture() {},
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 400, height: 200 }),
  };
}

/** A host whose querySelector answers from the markup the kind wrote into it. */
function host() {
  const kids = new Map();
  const h = el('host');
  h.querySelector = (sel) => {
    const m = /^\[([\w-]+)(?:="([^"]*)")?\]$/.exec(sel);
    if (!m || !h.innerHTML.includes(`${m[1]}="${m[2] || ''}`)) return null;
    if (!kids.has(sel)) {
      const k = el(sel);
      if (m[1] === 'data-xy-trail') {
        const g = h.innerHTML.slice(h.innerHTML.indexOf('data-xy-trail'));
        const n = g.slice(0, g.indexOf('</g>')).split('<line').length - 1;
        k.children = Array.from({ length: n }, () => el('segment'));
      }
      kids.set(sel, k);
    }
    return kids.get(sel);
  };
  Object.defineProperty(h, 'firstElementChild', { get: () => h.querySelector('[role="group"]') });
  return h;
}

/** Globals the kind reads: window, document, matchMedia and a hand-run animation frame. */
function page({ reduce = false } = {}) {
  const frames = [];
  let clock = 0;
  globalThis.window = el('window');
  globalThis.document = Object.assign(el('document'), { activeElement: null, hidden: false });
  globalThis.matchMedia = (q) => ({ matches: reduce && /prefers-reduced-motion: reduce/.test(q) });
  globalThis.requestAnimationFrame = (fn) => { frames.push(fn); return frames.length; };
  globalThis.cancelAnimationFrame = () => {};
  globalThis.performance = { now: () => clock };
  return {
    frames,
    tick(ms = 16) {
      clock += ms;
      const run = frames.splice(0);
      for (const fn of run) fn();
      return run.length;
    },
    get clock() { return clock; },
  };
}

const X = { key: 'x', label: 'Pitch', type: 'integer', min: 0, max: 10, step: 1, default: 5 };
const Y = { key: 'y', label: 'Y: LPF Cutoff', type: 'number', min: 0, max: 1, default: 0.5 };
const NOTES = ['C3', 'D#3', 'F3', 'G3', 'A#3', 'C4', 'D#4', 'F4', 'G4', 'A#4', 'C5'];

function mount(h, extra = {}) {
  return mountXyPad(h, { label: 'XY pad', x: X, y: Y, value: { x: 5, y: 0.5 },
    cells: NOTES.map((n, i) => ({ label: n, root: i % 5 === 0 })),
    text: { x: (i) => `${NOTES[i]}, degree ${(i % 5) + 1}`, y: (v) => `${Math.round(v * 100)} %` },
    readout: { x: (i) => NOTES[i], y: (v) => `LPF Cutoff ${Math.round(2400 * 2 ** (2 * v))} Hz`,
      yEnds: ['2.4 kHz', '9.6 kHz'] },
    ...extra });
}
const ptr = (id, x, y) => ({ pointerId: id, clientX: x, clientY: y, preventDefault() {} });

test('a touch draws the ring at the touch point with the note and the Y value beside it', () => {
  const pg = page();
  const h = host();
  const v = mount(h);
  const surface = h.querySelector('[data-xy-surface]');
  const cursor = h.querySelector('[data-xy-cursor]');
  pg.tick();
  assert.equal(cursor.classList.contains('hidden'), true, 'idle: no cursor');
  assert.equal(pg.frames.length, 0, 'idle: no frame scheduled');
  surface.fire('pointerdown', ptr(1, 148, 76)); // x 0.37, y 0.62 (y up)
  pg.tick();
  assert.equal(cursor.classList.contains('hidden'), false, 'touched: the cursor shows');
  const ring = h.querySelector('[data-xy-ring]');
  assert.equal(ring.getAttribute('cx'), '37.000%');
  assert.equal(ring.getAttribute('cy'), '38.000%');
  assert.equal(v.model.value.x, 4, 'x 0.37 of 11 cells: cell 4');
  assert.equal(h.querySelector('[data-xy-note]').textContent, 'A#3');
  assert.equal(h.querySelector('[data-xy-value]').textContent,
    `LPF Cutoff ${Math.round(2400 * 2 ** (2 * v.model.value.y))} Hz`);
  surface.fire('pointerup', ptr(1, 148, 76));
  pg.tick();
  assert.equal(cursor.classList.contains('hidden'), true, 'released: hidden again');
  v.destroy();
});

test('moving draws a fading trail, capped; the release clears it; then no frame runs', () => {
  const pg = page();
  const h = host();
  const v = mount(h);
  const surface = h.querySelector('[data-xy-surface]');
  const segs = h.querySelector('[data-xy-trail]').children;
  assert.equal(segs.length, TRAIL_MAX - 1, 'one segment between each two kept points');
  surface.fire('pointerdown', ptr(1, 10, 100));
  for (let i = 1; i <= 3 * TRAIL_MAX; i++) {
    surface.fire('pointermove', ptr(1, 10 + i * 4, 100 - i));
    pg.tick(25);
  }
  assert.equal(v.trail.size, TRAIL_MAX, 'capped at TRAIL_MAX points');
  const drawn = () => segs.filter((s) => !s.classList.contains('hidden'));
  assert.equal(drawn().length, TRAIL_MAX - 1, 'every kept segment drawn');
  assert.ok(drawn().some((s) => s.classList.contains('opacity-25'))
    && drawn().some((s) => s.classList.contains('opacity-100')), 'the oldest faintest');
  // Held still: the trail fades out and the frames stop.
  for (let i = 0; i < 60 && pg.frames.length; i++) pg.tick(50);
  assert.equal(pg.frames.length, 0, 'faded: no frame scheduled while held still');
  assert.equal(drawn().length, 0);
  surface.fire('pointermove', ptr(1, 200, 50));
  surface.fire('pointermove', ptr(1, 220, 40));
  pg.tick();
  assert.ok(drawn().length >= 1);
  surface.fire('pointerup', ptr(1, 220, 40));
  assert.equal(v.trail.size, 0, 'the release clears the trail');
  pg.tick();
  assert.equal(drawn().length, 0, 'and nothing of it is drawn');
  assert.equal(pg.tick(), 0, 'idle after the release: no frame');
  v.destroy();
});

test('prefers-reduced-motion: no trail, the last point only', () => {
  const pg = page({ reduce: true });
  const h = host();
  const v = mount(h);
  const surface = h.querySelector('[data-xy-surface]');
  const segs = h.querySelector('[data-xy-trail]').children;
  surface.fire('pointerdown', ptr(1, 10, 100));
  for (let i = 1; i < 20; i++) { surface.fire('pointermove', ptr(1, 10 + i * 9, 100)); pg.tick(); }
  assert.equal(v.trail.size, 0, 'no trail kept');
  assert.equal(segs.filter((s) => !s.classList.contains('hidden')).length, 0);
  assert.equal(h.querySelector('[data-xy-ring]').getAttribute('cx'), '45.250%', 'the last point');
  assert.equal(pg.tick(), 0, 'no frame while held still');
  surface.fire('pointerup', ptr(1, 0, 0));
  v.destroy();
});

test('the gate LED is lit while the gate is open; the reason sits above the surface', () => {
  page();
  const h = host();
  const v = mount(h);
  const gate = h.querySelector('[data-xy-gate]');
  assert.equal(gate.getAttribute('data-gate'), 'false');
  assert.match(gate.innerHTML, /data-led="" data-source="xy.gate" data-lit="false"/);
  v.model.down(1, 0.5, 0.5);
  assert.equal(gate.getAttribute('data-gate'), 'true');
  assert.match(gate.innerHTML, /data-lit="true"/);
  v.model.up(1);
  assert.match(gate.innerHTML, /data-lit="false"/);
  const html = h.innerHTML;
  assert.ok(html.indexOf('data-xy-gate') < html.indexOf('data-xy-surface'), 'the LED above');
  assert.match(html, /data-xy-yend="top"[^>]*>9\.6 kHz</, 'Y at the top end');
  assert.match(html, /data-xy-yend="bottom"[^>]*>2\.4 kHz</, 'Y at the bottom end');
  assert.ok(NOTES.every((n) => html.includes(`>${n}</li>`)), 'each cell labelled by its note');
  v.destroy();
  const off = host();
  const d = mount(off, { disabled: 'The pad is not patched into the voice.' });
  const shown = off.innerHTML;
  assert.ok(shown.indexOf('data-xy-why') < shown.indexOf('data-xy-surface'),
    'a disabled pad says why above its surface');
  assert.equal(off.querySelector('[data-xy-view]'), null, 'and draws no cursor');
  assert.doesNotMatch(shown, /data-xy-yend/);
  d.destroy();
});

test('the view is aria-hidden; the sliders carry the values', () => {
  page();
  const h = host();
  const v = mount(h);
  for (const part of ['data-xy-view', 'data-xy-yend="top"', 'data-xy-gate']) {
    const at = h.innerHTML.indexOf(part);
    assert.ok(at >= 0, `${part} is drawn`);
    const tag = h.innerHTML.slice(h.innerHTML.lastIndexOf('<', at), h.innerHTML.indexOf('>', at));
    const wrap = h.innerHTML.slice(h.innerHTML.lastIndexOf('<div', at), at);
    assert.ok(/aria-hidden="true"/.test(tag) || /aria-hidden="true"/.test(wrap), part);
  }
  v.model.key('ArrowRight');
  assert.equal(h.querySelector('[data-xy-axis="x"]').getAttribute('aria-valuetext'),
    'D#4, degree 2');
  v.destroy();
});
