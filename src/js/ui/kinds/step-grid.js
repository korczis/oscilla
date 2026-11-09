// The step-grid kind's view (plan issue W008, ADR 0086; declared in
// src/js/ui/catalog/kinds/step-grid.js): lanes of 44 px steps over one notes clip, or one lane
// of a list parameter, drawn from step-grid-model.js. role=grid; a row per lane with its name
// as the rowheader (above the steps at a phone's eight, beside them at sixteen); a gridcell per
// step named "Kopák, krok 5, zapnuto", aria-selected on the selected range and aria-current=step
// on the playing step; one roving tab stop. The keys are the declaration's (chordOf, the
// model's key map); Space is never taken. A pointer or touch drag along a lane paints in one
// action; a value lane's step takes its value from the vertical position. The focused step's
// detail row holds accent, ratchet, probability and slide as buttons and selects (never a bare
// letter key), and the menu keys move the focus there.
//
// The playing step comes from opts.playStep() (the owner reads transport.playhead() through
// studio/note-player.js notesSteps) through one frame-loop subscriber that writes the DOM only
// when the step index changes. Selection and page belong to the owner (onView, then set); the
// view keeps focus, the drag preview and the open detail row only. No store, no audio, no timer.
//
//   mountStepGrid(host, { label, laneNames, playStep, ...createStepGrid options })
//     -> { element, set(next), setDisabled(reason | null), destroy(), model }

import { onFrame } from '../../charts/frame-loop.js';
import { PAGE_STEPS, cellName, chordOf, createPlayhead, createStepGrid, pageStepsFor }
  from './step-grid-model.js';

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);

// Classes are literal strings (Tailwind's content scan reads them; rule 3 of W001).
// No card of its own: the consumer's panel (the Studio Inspector, a Pro card) frames it, and
// its whole width goes to the steps.
const CARD = 'flex flex-col';
const GRID_NARROW = 'flex flex-col gap-3 touch-pan-y select-none';
const GRID_WIDE = 'flex flex-col gap-2 touch-pan-y select-none';
const GRID_VALUE = 'flex flex-col gap-2 touch-none select-none';
const ROW_NARROW = 'flex flex-col gap-1';
const ROW_WIDE = 'flex items-center gap-2';
const HEAD = 'w-20 shrink-0 truncate text-sm font-medium text-gray-900 dark:text-white';
const HEAD_NARROW = 'truncate text-sm font-medium text-gray-900 dark:text-white';
const STEPS = 'flex';
const CELL = 'relative -ml-px h-11 w-11 shrink-0 border border-solid border-gray-300 first:ml-0 '
  + 'focus:z-10 focus:outline-none focus-visible:ring-4 focus-visible:ring-primary-500 '
  + 'aria-[current=step]:outline aria-[current=step]:outline-2 '
  + 'aria-[current=step]:outline-yellow-400 aria-selected:ring-2 aria-selected:ring-inset '
  + 'aria-selected:ring-primary-300 dark:border-gray-600';
const CELL_ON = 'bg-primary-600 dark:bg-primary-500';
const CELL_ACCENT = 'bg-primary-700';
const CELL_OFF = 'bg-gray-50 dark:bg-gray-700';
const CELL_BEAT = 'bg-gray-100 dark:bg-gray-800';
const OFF_GRID = 'ml-2 rounded bg-yellow-50 px-1.5 py-0.5 text-xs font-medium text-yellow-800';
// The Pro secondary button of the Studio's preset menu (node-preset-menu.js), 44 px tall.
const BUTTON = 'inline-flex h-11 items-center gap-1 rounded-lg border border-solid border-gray-300 '
  + 'bg-white px-3 text-sm font-medium text-gray-900 hover:bg-gray-100 focus:outline-none '
  + 'focus-visible:ring-2 focus-visible:ring-primary-300 disabled:opacity-50 '
  + 'dark:border-gray-600 dark:bg-gray-800 dark:text-white dark:hover:bg-gray-700';
// A 44 px square pager button: the same Pro secondary button, its name in aria-label.
const PAGE_BUTTON = `${BUTTON} w-11 justify-center`;
const SELECT = 'h-11 w-20 rounded-lg border border-solid border-gray-300 bg-gray-50 px-2 text-sm '
  + 'text-gray-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-300 '
  + 'dark:border-gray-600 dark:bg-gray-700 dark:text-white';
const DETAIL = 'mt-2 flex flex-wrap items-center gap-2';
const PAGER = 'mt-2 flex items-center gap-2 whitespace-nowrap text-sm text-gray-700 '
  + 'dark:text-gray-300';
const TEXT = Object.freeze({
  prev: 'Předchozí stránka', next: 'Další stránka', page: (p, n) => `Stránka ${p} z ${n}`,
  accent: 'Přízvuk', slide: 'Slide', ratchet: 'Ratchet', probability: 'Pravděpodobnost',
  offGrid: (n) => `mimo mřížku: ${n}`, detail: (name) => `Zaměřený krok: ${name}`,
});
const PROBABILITIES = [1, 0.75, 0.5, 0.25];

let mounted = 0;

export function mountStepGrid(host, opts) {
  const uid = `step-grid-${(mounted += 1)}`;
  const list = opts.mode === 'param-list';
  let laneNames = opts.laneNames || [];
  let disabled = null;
  let gridHasFocus = false;
  // The owner keeps selection and page (rule 2). Without one, the mount applies them itself,
  // as an owner would, so a standalone grid still pages and selects.
  const owner = { onView: opts.onView || ((v) => {
    if (v.selection || v.page != null) model.set(v);
  }) };
  const live = { el: null };
  // Without a pageSteps of the consumer's, the grid fits its pages to the width it is given
  // (pageStepsFor), measured once it is laid out and again when that width changes.
  const autoFit = opts.pageSteps == null;
  const model = createStepGrid({ ...opts, pageSteps: autoFit ? PAGE_STEPS.panel
    : opts.pageSteps, onView: (v) => owner.onView(v),
    say: (s) => { if (live.el) live.el.textContent = s; } });
  if (opts.selection || opts.page != null) {
    model.set({ selection: opts.selection || [], page: opts.page ?? 0 });
  }
  let cellEls = [];
  const lit = []; // the playing step's cells, one per lane; reused, never reallocated per frame

  host.innerHTML = `<div class="${CARD}" data-step-grid="${list ? 'param-list' : 'notes'}">`
    + `<div role="grid" aria-label="${esc(opts.label || '')}" data-step-grid-surface="" `
    + `class="${list ? GRID_VALUE : GRID_WIDE}"></div>`
    + `<div class="${PAGER}"><button type="button" class="${PAGE_BUTTON}" data-step-page="-1" `
    + `aria-label="${esc(TEXT.prev)}"><span aria-hidden="true">‹</span></button>`
    + '<span data-step-page-label=""></span>'
    + `<button type="button" class="${PAGE_BUTTON}" data-step-page="1" `
    + `aria-label="${esc(TEXT.next)}"><span aria-hidden="true">›</span></button></div>`
    + (list ? '' : `<div class="${DETAIL}" role="group" data-step-detail="" `
      + `aria-labelledby="${uid}-dl"><span id="${uid}-dl" class="sr-only"></span>`
      + `<button type="button" class="${BUTTON}" aria-pressed="false" data-step-menu="accent">`
      + `${esc(TEXT.accent)}</button>`
      + `<button type="button" class="${BUTTON}" aria-pressed="false" data-step-menu="slide">`
      + `${esc(TEXT.slide)}</button>`
      + `<label class="flex items-center gap-1 text-sm">${esc(TEXT.ratchet)} <select `
      + `class="${SELECT}" data-step-menu="ratchet">${[1, 2, 3, 4, 5, 6, 7, 8]
        .map((n) => `<option value="${n}">${n}</option>`).join('')}</select></label>`
      + `<label class="flex items-center gap-1 text-sm">${esc(TEXT.probability)} <select `
      + `class="${SELECT}" data-step-menu="probability">${PROBABILITIES
        .map((p) => `<option value="${p}">${Math.round(p * 100)} %</option>`).join('')}`
      + '</select></label></div>')
    + '<p class="sr-only" aria-live="polite" data-step-live=""></p></div>';
  const element = host.firstElementChild;
  const surface = element.querySelector('[data-step-grid-surface]');
  const pageLabel = element.querySelector('[data-step-page-label]');
  const detail = element.querySelector('[data-step-detail]');
  live.el = element.querySelector('[data-step-live]');

  const nameOf = (lane) => (list ? '' : laneNames[lane] || `${model.state().lanes[lane]}`);
  const valueOf = (st, lane, step) => (list ? st.values[step] : st.cells[lane][step]);
  const isOn = (st, lane, step) => (list ? st.values[step] !== opts.param.min
    : !!st.cells[lane][step]);

  /** The page size the laid-out width holds, or null when it is unknown or unchanged. */
  function fitted() {
    if (!autoFit || !surface.clientWidth) return null;
    const ps = pageStepsFor(surface.clientWidth);
    return ps === model.state().pageSteps ? null : ps;
  }

  function render() {
    // Read before the cells are replaced: their removal may already move the focus away.
    const doc = element.ownerDocument;
    const held = gridHasFocus || (doc && surface.contains(doc.activeElement));
    const ps = fitted();
    const repaged = ps === null ? null : Math.floor(model.focus.step / ps);
    if (ps !== null) model.set({ pageSteps: ps, page: repaged });
    const st = model.state();
    const wide = st.pageSteps >= 16;
    surface.className = list ? GRID_VALUE : wide ? GRID_WIDE : GRID_NARROW;
    const from = st.page * st.pageSteps;
    const to = Math.min(st.steps, from + st.pageSteps);
    const [a, b] = st.selection.length === 2
      ? [Math.min(...st.selection), Math.max(...st.selection)] : [-1, -2];
    cellEls = st.lanes.map(() => []);
    surface.innerHTML = st.lanes.map((_, lane) => {
      const off = list ? 0 : st.offGrid.filter((o) => o.lane === lane).length;
      const head = `<div role="rowheader" class="${wide ? HEAD : HEAD_NARROW}">`
        + `${esc(nameOf(lane))}${off ? `<span class="${OFF_GRID}" data-step-offgrid="${off}">`
          + `${esc(TEXT.offGrid(off))}</span>` : ''}</div>`;
      const cells = [];
      for (let step = from; step < to; step += 1) {
        const v = valueOf(st, lane, step);
        const on = isOn(st, lane, step);
        const tone = !on ? (step % 4 === 0 ? CELL_BEAT : CELL_OFF)
          : !list && v.vel >= 0.8 ? CELL_ACCENT : CELL_ON;
        const focused = st.focus.lane === lane && st.focus.step === step;
        cells.push(`<div role="gridcell" class="${CELL} ${tone}" data-lane="${lane}" `
          + `data-step="${step}" tabindex="${focused ? 0 : -1}" aria-selected="${lane
            === st.focus.lane && step >= a && step <= b}" aria-label="${esc(cellName(nameOf(lane),
            step, list ? v : on && v, list ? 'param-list' : 'notes'))}"></div>`);
      }
      return `<div role="row" class="${wide ? ROW_WIDE : ROW_NARROW}">${head}`
        + `<div class="${STEPS}">${cells.join('')}</div></div>`;
    }).join('');
    surface.querySelectorAll('[role="gridcell"]').forEach((el) => {
      cellEls[Number(el.dataset.lane)][Number(el.dataset.step)] = el;
    });
    pageLabel.textContent = TEXT.page(st.page + 1, st.pages);
    element.querySelector('[data-step-page="-1"]').disabled = !!disabled || st.page === 0;
    element.querySelector('[data-step-page="1"]').disabled = !!disabled
      || st.page >= st.pages - 1;
    surface.setAttribute('aria-disabled', disabled ? 'true' : 'false');
    if (detail) renderDetail(st);
    lit.length = 0; // the cells were replaced: none of them is lit
    playhead.reset();
    if (held) {
      gridHasFocus = true;
      focusCell();
    }
    if (repaged !== null) owner.onView({ page: repaged }); // the owner keeps the page
  }

  function renderDetail(st) {
    const { lane, step } = st.focus;
    const cell = st.cells[lane][step];
    detail.querySelector(`#${uid}-dl`).textContent = TEXT.detail(cellName(nameOf(lane), step,
      cell));
    const set = (sel, fn) => { const el = detail.querySelector(sel); fn(el); };
    set('[data-step-menu="accent"]', (el) => {
      el.disabled = !cell || !!disabled;
      el.setAttribute('aria-pressed', String(!!cell && cell.vel >= 0.8));
    });
    set('[data-step-menu="slide"]', (el) => {
      el.disabled = !cell || !!disabled;
      el.setAttribute('aria-pressed', String(!!cell && !!cell.slide));
    });
    set('[data-step-menu="ratchet"]', (el) => {
      el.disabled = !cell || !!disabled;
      el.value = String(cell && cell.r ? cell.r : 1);
    });
    set('[data-step-menu="probability"]', (el) => {
      el.disabled = !cell || !!disabled;
      el.value = String(cell && cell.p ? cell.p : 1);
    });
  }

  function focusCell() {
    const f = model.focus;
    const el = cellEls[f.lane] && cellEls[f.lane][f.step];
    if (el && el.ownerDocument.activeElement !== el) el.focus();
  }

  // The playing step: one frame-loop subscriber, a DOM write only when the index changes.
  const playhead = createPlayhead((step) => {
    for (const el of lit) el.removeAttribute('aria-current');
    lit.length = 0;
    if (step === null) return;
    for (const row of cellEls) {
      const el = row[step];
      if (el) {
        el.setAttribute('aria-current', 'step');
        lit.push(el);
      }
    }
  });
  const off = [];
  if (autoFit && typeof ResizeObserver === 'function') {
    const ro = new ResizeObserver(() => { if (fitted() !== null) render(); });
    ro.observe(element);
    off.push(() => ro.disconnect());
  }
  if (typeof opts.playStep === 'function') {
    off.push(onFrame(() => playhead.tick(opts.playStep())));
  }

  const cellAt = (e) => {
    const doc = element.ownerDocument;
    const el = doc.elementFromPoint ? doc.elementFromPoint(e.clientX, e.clientY) : e.target;
    const c = el && el.closest ? el.closest('[role="gridcell"]') : null;
    return c && surface.contains(c) ? c : null;
  };
  const fractionIn = (c, e) => {
    const r = c.getBoundingClientRect();
    return r.height > 0 ? 1 - (e.clientY - r.top) / r.height : 0;
  };
  const listen = (el, type, fn) => {
    el.addEventListener(type, fn);
    off.push(() => el.removeEventListener(type, fn));
  };

  listen(surface, 'keydown', (e) => {
    const chord = chordOf(e);
    if (!chord || !model.key(chord)) return;
    e.preventDefault();
    e.stopPropagation(); // a key the grid handled is not also the page's (Studio's Delete)
    if (chord === 'Shift+F10' || chord === 'ContextMenu') {
      const first = detail && detail.querySelector('button:not([disabled]), select');
      if (first) first.focus();
      return;
    }
    render();
    focusCell();
  });
  listen(surface, 'focusin', () => { gridHasFocus = true; });
  listen(surface, 'focusout', (e) => {
    if (!surface.contains(e.relatedTarget)) gridHasFocus = false;
  });
  listen(surface, 'pointerdown', (e) => {
    const c = e.target.closest && e.target.closest('[role="gridcell"]');
    if (!c || disabled || e.button > 0) return;
    const lane = Number(c.dataset.lane);
    const step = Number(c.dataset.step);
    gridHasFocus = true;
    if (list && !e.shiftKey) {
      model.valueAt(lane, step, fractionIn(c, e));
      return;
    }
    model.down(lane, step, { shift: e.shiftKey });
    try {
      surface.setPointerCapture(e.pointerId);
    } catch {
      // A pointer the browser no longer tracks: the drag still follows elementFromPoint.
    }
    c.classList.add('ring-2');
  });
  listen(surface, 'pointermove', (e) => {
    const d = model.drag;
    if (!d) return;
    const c = cellAt(e);
    if (!c || !model.over(Number(c.dataset.lane), Number(c.dataset.step))) return;
    const now = model.drag;
    const [a, b] = [Math.min(now.from, now.to), Math.max(now.from, now.to)];
    (cellEls[now.lane] || []).forEach((el, step) => {
      if (el) el.classList.toggle('ring-2', step >= a && step <= b);
    });
  });
  listen(surface, 'pointerup', () => {
    if (!model.drag) return;
    model.up();
    render();
  });
  listen(surface, 'pointercancel', () => {
    model.cancel();
    render();
  });
  listen(surface, 'contextmenu', (e) => {
    const c = e.target.closest && e.target.closest('[role="gridcell"]');
    if (!c || list) return;
    e.preventDefault();
    const at = { lane: Number(c.dataset.lane), step: Number(c.dataset.step) };
    model.down(at.lane, at.step);
    model.cancel();
    render();
    owner.onView({ menu: at });
    const first = detail.querySelector('button:not([disabled]), select');
    if (first) first.focus();
  });
  listen(element, 'click', (e) => {
    const pager = e.target.closest && e.target.closest('[data-step-page]');
    if (pager) {
      model.key(pager.dataset.stepPage === '1' ? ']' : '[');
      render();
      return;
    }
    const item = e.target.closest && e.target.closest('button[data-step-menu]');
    if (item) {
      model.menu(item.dataset.stepMenu);
      render();
    }
  });
  listen(element, 'change', (e) => {
    const sel = e.target.closest && e.target.closest('select[data-step-menu]');
    if (!sel) return;
    model.menu(sel.dataset.stepMenu, Number(sel.value));
    render();
  });

  render();
  return {
    element,
    model,
    set(next = {}) {
      if (next.onView) owner.onView = next.onView;
      if (next.laneNames) laneNames = [...next.laneNames];
      model.set(next);
      // Never mid-drag: replacing the cells under a held pointer loses the gesture in WebKit;
      // the release renders.
      if (!model.drag) render();
    },
    setDisabled(reason) {
      disabled = reason || null;
      model.set({ disabled: !!disabled });
      render();
    },
    destroy() {
      for (const f of off) f();
      off.length = 0;
      host.innerHTML = '';
    },
  };
}

