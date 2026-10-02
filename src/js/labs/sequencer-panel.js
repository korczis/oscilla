// Pattern sequencer panel: renders the block timeline, the time ruler and the playhead into the
// shell (#osc-seq-timeline, #osc-seq-ruler) from sequencer/timeline.js layout maths, drives a
// sequencer/editor.js controller, and builds the selected block's editor fields from
// BLOCK_SCHEMA (Sweep: Start, End, Duration, Curve; every other type its own schema fields).
//
// Interaction: click selects; drag reorders (insertion marker); the focused timeline takes the
// editor's keyboard model (arrows select, Alt+arrows move, Delete removes, Ctrl/Cmd+D
// duplicates, Escape cancels a drag); the move/delete buttons and the "Add block" menu edit;
// play/stop/loop and "play from the start" use the adapter's context and destination. The
// audio clock (ctx.currentTime) drives the playhead; no timer ever times audio.

import { createSequencerEditor } from '../sequencer/editor.js';
import { BLOCK_SCHEMA, totalDuration } from '../sequencer/model.js';
import {
  createTimeScale,
  generateTicks,
  layoutBlocks,
  playheadPosition,
  dropIndexAt,
  insertionMarkerX,
} from '../sequencer/timeline.js';
import { onFrame } from '../charts/frame-loop.js';
import { observeSize } from '../charts/chart-theme.js';
import { on, setText, setAttr } from './dom.js';

export const TIMELINE_OPTIONS = Object.freeze({ minSpanS: 3.75, headroomRatio: 0.1, blockY: 5,
  blockH: 40, gapPx: 4 });
const DRAG_THRESHOLD_PX = 4;

/** Ids kept from the shell markup for the Sweep fields (status/visual-idmap.tsv). */
const FIELD_IDS = {
  start: 'osc-seq-start-hz',
  end: 'osc-seq-end-hz',
  durationMs: 'osc-seq-duration',
  curve: 'osc-seq-curve',
};

/**
 * Editor field descriptors for a block type, in display order: frequency/Hz parameters,
 * Duration, other numeric parameters, then choices (Sweep → Start, End, Duration, Curve).
 */
export function fieldsForType(type) {
  const s = BLOCK_SCHEMA[type];
  if (!s) return [];
  const dur = { key: 'durationMs', label: 'Duration', kind: 'ms', unit: 'ms',
    min: s.durationMs.min, max: s.durationMs.max, default: s.durationMs.default };
  const p = s.params;
  const rank = (d) => (d.kind === 'freq' || d.kind === 'hz' ? 0 : d.kind === 'enum' ? 3 : 2);
  return [...p.filter((d) => rank(d) === 0), dur, ...p.filter((d) => rank(d) === 2),
    ...p.filter((d) => rank(d) === 3)];
}

function fieldId(key) {
  return FIELD_IDS[key] || `osc-seq-f-${key}`;
}

function buildField(d, value, safeMax) {
  const wrap = document.createElement('div');
  wrap.className = `osc-seq-field osc-seq-p-${d.key}`;
  const label = document.createElement('label');
  label.className = 'osc-label';
  label.htmlFor = fieldId(d.key);
  label.textContent = d.label;
  wrap.appendChild(label);
  if (d.kind === 'enum') {
    const box = document.createElement('div');
    box.className = 'osc-select';
    const sel = document.createElement('select');
    sel.id = fieldId(d.key);
    sel.dataset.osc = 'seq.field';
    sel.dataset.field = d.key;
    for (const [v, text] of d.options) {
      const opt = document.createElement('option');
      opt.value = v;
      opt.textContent = text;
      sel.appendChild(opt);
    }
    sel.value = value;
    box.appendChild(sel);
    wrap.appendChild(box);
    return wrap;
  }
  const box = document.createElement('div');
  box.className = 'osc-unit';
  if (d.unit) box.dataset.unit = d.unit;
  const input = document.createElement('input');
  input.className = 'osc-number';
  input.type = 'number';
  input.id = fieldId(d.key);
  input.dataset.osc = 'seq.field';
  input.dataset.field = d.key;
  input.inputMode = d.kind === 'int' || d.kind === 'ms' ? 'numeric' : 'decimal';
  const min = d.kind === 'freq' ? 20 : d.min;
  const max = d.kind === 'freq' ? Math.floor(safeMax) : d.max;
  if (min != null) input.min = String(min);
  if (max != null) input.max = String(max);
  input.step = d.kind === 'hz' ? 'any' : '1';
  input.value = String(value);
  box.appendChild(input);
  if (d.unit) {
    const suffix = document.createElement('span');
    suffix.className = 'osc-unit-suffix';
    suffix.setAttribute('aria-hidden', 'true');
    suffix.textContent = d.unit;
    box.appendChild(suffix);
  }
  wrap.appendChild(box);
  return wrap;
}

/** mount(rootEl, adapter) → lab { editor, render(), update(state), dispose() } */
export function mount(rootEl, adapter) {
  const q = (sel) => rootEl.querySelector(sel);
  const timeline = q('#osc-seq-timeline');
  const ruler = q('#osc-seq-ruler');
  const fieldsEl = q('[data-osc="seq.editor.fields"]');
  const titleEl = q('#osc-seq-editor-title');
  const iconEl = q('[data-osc="seq.editor.icon"]');
  const playBtn = q('#osc-seq-play');
  const loopBtn = q('#osc-seq-record');
  const tempoSel = q('#osc-seq-tempo');
  const msgEl = q('[data-osc="seq.message"]'); // optional (requested markup), role=status
  const getCtx = () => (adapter.getContext ? adapter.getContext() : null);
  const editor = createSequencerEditor({
    sampleRate: adapter.getSampleRate ? adapter.getSampleRate() || undefined : undefined,
    engine: {
      getContext: getCtx,
      getDestination: () => {
        const d = adapter.getDestination ? adapter.getDestination() : null;
        const ctx = getCtx();
        return d || (ctx ? ctx.destination : null);
      },
      resume: () => {
        const ctx = getCtx();
        if (ctx && ctx.state === 'suspended') return ctx.resume();
        return null;
      },
    },
  });

  const blockEls = new Map();
  const marker = document.createElement('div');
  Object.assign(marker.style, { position: 'absolute', top: '2px', bottom: '2px', width: '2px',
    background: 'var(--osc-blue)', pointerEvents: 'none' });
  marker.hidden = true;
  marker.setAttribute('aria-hidden', 'true');
  const playhead = document.createElement('div');
  Object.assign(playhead.style, { position: 'absolute', left: '0', top: '0', bottom: '0',
    width: '2px',
    background: 'var(--osc-text)', pointerEvents: 'none', zIndex: '2' });
  playhead.hidden = true;
  playhead.setAttribute('aria-hidden', 'true');
  if (timeline) {
    timeline.append(marker, playhead);
    // The blocks are absolutely positioned, so the lane needs an explicit height. The shell's
    // `.osc-seq-timeline { height: 50px }` rule does not match the element (its class is
    // .osc-timeline); until the integrator fixes the selector, keep a minimum here.
    const need = TIMELINE_OPTIONS.blockY * 2 + TIMELINE_OPTIONS.blockH;
    if (timeline.clientHeight < need) timeline.style.minHeight = `${need}px`;
  }

  let scale = null;
  let rects = [];
  let fieldsFor = '';
  let rulerKey = '';
  let drag = null;

  function safeMax() {
    return editor.sampleRate() * 0.475;
  }

  function renderBlocks() {
    if (!timeline) return;
    const w = timeline.clientWidth || 400;
    scale = createTimeScale({ durationS: totalDuration(editor.model), widthPx: w,
      minSpanS: TIMELINE_OPTIONS.minSpanS, headroomRatio: TIMELINE_OPTIONS.headroomRatio });
    rects = layoutBlocks(editor.model, scale, { y: TIMELINE_OPTIONS.blockY,
      height: TIMELINE_OPTIONS.blockH, gapPx: TIMELINE_OPTIONS.gapPx });
    const seen = new Set();
    let prev = null;
    for (const r of rects) {
      seen.add(r.id);
      let b = blockEls.get(r.id);
      if (!b) {
        b = document.createElement('div');
        b.setAttribute('role', 'option');
        b.id = `osc-seq-block-${r.id}`;
        b.dataset.blockId = r.id;
        b.style.position = 'absolute';
        b.style.cursor = 'grab';
        b.style.touchAction = 'none';
        const name = document.createElement('span');
        name.className = 'osc-block-name';
        const detail = document.createElement('span');
        detail.className = 'osc-block-detail';
        b.append(name, detail);
        timeline.insertBefore(b, marker);
        blockEls.set(r.id, b);
      }
      const cls = `osc-block osc-block--${r.type}`;
      if (b.className !== cls) b.className = cls;
      b.style.left = `${Math.round(r.x)}px`;
      b.style.top = `${r.y}px`;
      b.style.width = `${Math.max(4, Math.round(r.w))}px`;
      setText(b.children[0], r.label);
      setText(b.children[1], r.detail);
      setAttr(b, 'aria-selected', r.id === editor.selectedId ? 'true' : 'false');
      setAttr(b, 'aria-label', `${r.label} ${r.detail}, ${(r.endS - r.startS).toFixed(2)} s`);
      // Keep DOM (reading) order = sequence order.
      const want = prev ? prev.nextSibling : timeline.firstChild;
      if (b !== want) timeline.insertBefore(b, want);
      prev = b;
    }
    for (const [id, b] of blockEls) {
      if (!seen.has(id)) {
        b.remove();
        blockEls.delete(id);
      }
    }
    if (editor.selectedId) {
      setAttr(timeline, 'aria-activedescendant', `osc-seq-block-${editor.selectedId}`);
    }
    else timeline.removeAttribute('aria-activedescendant');
  }

  function renderRuler() {
    if (!ruler || !scale || !timeline) return;
    const offset = timeline.getBoundingClientRect().left - ruler.getBoundingClientRect().left;
    // The last tick sits on the right edge, where its label cannot be shown whole.
    const ticks = generateTicks(scale).filter((t) => t.t < scale.spanS - 1e-9);
    const key = `${offset}:${ticks.map((t) => `${t.label}@${t.x}`).join(',')}`;
    if (key === rulerKey) return;
    rulerKey = key;
    ruler.textContent = '';
    ticks.forEach((t, i) => {
      const s = document.createElement('span');
      s.className = 'osc-num';
      s.textContent = t.label;
      Object.assign(s.style, {
        position: 'absolute',
        top: '2px',
        left: `${Math.round(offset + t.x)}px`,
        transform: i === 0 ? 'none' : 'translateX(-50%)',
        fontSize: 'var(--osc-fs-xs)',
        color: 'var(--osc-text-muted)',
        whiteSpace: 'nowrap',
      });
      ruler.appendChild(s);
    });
  }

  function renderEditor() {
    const block = editor.selectedBlock;
    const buttons = ['#osc-seq-move-earlier', '#osc-seq-move-later', '#osc-seq-delete'];
    buttons.forEach((sel) => {
      const b = q(sel);
      if (b) b.disabled = !block;
    });
    if (!block) {
      setText(titleEl, 'No block selected');
      if (fieldsEl && fieldsFor !== '') {
        fieldsEl.textContent = '';
        fieldsFor = '';
      }
      return;
    }
    const s = BLOCK_SCHEMA[block.type];
    setText(titleEl, s ? s.label : block.type);
    // The sprite only has a sweep glyph: show it for Sweep/Chirp, hide it otherwise.
    const glyph = block.type === 'sweep' || block.type === 'chirp';
    if (iconEl) iconEl.style.visibility = glyph ? '' : 'hidden';
    const key = `${block.id}:${block.type}`;
    const values = { ...block.params, durationMs: block.durationMs };
    if (fieldsEl && fieldsFor !== key) {
      fieldsEl.textContent = '';
      for (const d of fieldsForType(block.type)) {
        fieldsEl.appendChild(buildField(d, values[d.key], safeMax()));
      }
      fieldsFor = key;
    } else if (fieldsEl) {
      fieldsEl.querySelectorAll('[data-osc="seq.field"]').forEach((input) => {
        if (document.activeElement === input) return;
        const v = String(values[input.dataset.field]);
        if (input.value !== v) input.value = v;
      });
    }
  }

  function renderTransport() {
    setAttr(playBtn, 'aria-pressed', editor.playing ? 'true' : 'false');
    setAttr(loopBtn, 'aria-pressed', editor.model.loop ? 'true' : 'false');
    if (playBtn) setAttr(playBtn, 'title', editor.error || 'Play sequence');
    setText(msgEl, editor.error || (editor.warnings || []).join(' '));
  }

  function render() {
    renderBlocks();
    renderRuler();
    renderEditor();
    renderTransport();
  }

  // ---------------------------------------------------------------- pointer: select + drag
  function localX(e) {
    return e.clientX - timeline.getBoundingClientRect().left;
  }

  function onPointerDown(e) {
    const b = e.target.closest('[data-block-id]');
    if (!b || e.button > 0) return;
    const index = rects.findIndex((r) => r.id === b.dataset.blockId);
    if (index < 0) return;
    editor.selectBlock(b.dataset.blockId);
    drag = { id: e.pointerId, index, x0: e.clientX, active: false };
    try {
      timeline.setPointerCapture(e.pointerId);
    } catch (err) {
      /* optional */
    }
    timeline.focus({ preventScroll: true });
    render();
  }

  function onPointerMove(e) {
    if (!drag || e.pointerId !== drag.id) return;
    if (!drag.active && Math.abs(e.clientX - drag.x0) >= DRAG_THRESHOLD_PX) {
      drag.active = true;
      editor.dragStart(drag.index);
    }
    if (!drag.active) return;
    const ins = dropIndexAt(rects, localX(e));
    editor.dragOver(ins);
    marker.hidden = false;
    marker.style.left = `${Math.round(insertionMarkerX(rects, ins, scale) - 1)}px`;
  }

  function onPointerUp(e) {
    if (!drag || e.pointerId !== drag.id) return;
    if (drag.active) editor.drop(dropIndexAt(rects, localX(e)));
    drag = null;
    marker.hidden = true;
    render();
  }

  function onPointerCancel() {
    if (drag && drag.active) editor.dragEnd();
    drag = null;
    marker.hidden = true;
  }

  // ---------------------------------------------------------------- fields
  function onFieldChange(e) {
    const t = e.target;
    if (!t.matches || !t.matches('[data-osc="seq.field"]')) return;
    const key = t.dataset.field;
    const v = t.tagName === 'SELECT' ? t.value : Number(t.value);
    if (t.tagName !== 'SELECT' && !Number.isFinite(v)) {
      render();
      return;
    }
    editor.updateParam(key, v);
    render();
  }

  const offs = [
    on(timeline, 'pointerdown', onPointerDown),
    on(timeline, 'pointermove', onPointerMove),
    on(timeline, 'pointerup', onPointerUp),
    on(timeline, 'pointercancel', onPointerCancel),
    on(timeline, 'keydown', (e) => {
      if (editor.onKeydown(e)) {
        if (e.key === 'Escape') marker.hidden = true;
        render();
      }
    }),
    on(fieldsEl, 'change', onFieldChange),
    on(playBtn, 'click', () => {
      editor.play();
      render();
    }),
    on(q('#osc-seq-start'), 'click', () => {
      editor.play();
      render();
    }),
    on(q('#osc-seq-stop'), 'click', () => {
      editor.stop();
      render();
    }),
    on(loopBtn, 'click', () => {
      editor.setLoop(!editor.model.loop);
      render();
    }),
    on(tempoSel, 'change', () => {
      editor.setTempo(Number(tempoSel.value));
      render();
    }),
    on(q('#osc-seq-move-earlier'), 'click', () => {
      editor.moveSelected(-1);
      render();
    }),
    on(q('#osc-seq-move-later'), 'click', () => {
      editor.moveSelected(1);
      render();
    }),
    on(q('#osc-seq-delete'), 'click', () => {
      editor.deleteSelected();
      render();
    }),
  ];
  rootEl.querySelectorAll('[data-osc="seq.addType"]').forEach((b) => {
    offs.push(on(b, 'click', () => {
      editor.addBlock(b.dataset.value);
      render();
    }));
  });
  if (tempoSel) editor.setTempo(Number(tempoSel.value) || editor.model.tempoBpm);
  // Start with the first Sweep selected, as in the reference (its editor is the shell default).
  const firstSweep = editor.model.blocks.find((b) => b.type === 'sweep');
  if (firstSweep) editor.selectBlock(firstSweep.id);

  let wasPlaying = false;
  offs.push(onFrame(() => {
    const ctx = getCtx();
    const timing = editor.playing ? editor.currentPassTiming() : null;
    const ph = timing && ctx && scale
      ? playheadPosition({ ctxTime: ctx.currentTime, t0: timing.t0, durationS: timing.duration,
        loop: editor.model.loop, scale })
      : { visible: false };
    playhead.hidden = !ph.visible;
    if (ph.visible) playhead.style.transform = `translateX(${Math.round(ph.x)}px)`;
    if (editor.playing !== wasPlaying) {
      wasPlaying = editor.playing;
      renderTransport();
    }
  }));
  offs.push(observeSize(timeline || rootEl, () => {
    rulerKey = '';
    render();
  }));
  render();

  return {
    editor,
    render,
    get rects() {
      return rects.map((r) => ({ ...r }));
    },
    update(state = {}) {
      if (state.sequence) editor.load(state.sequence);
      if (state.tempoBpm) editor.setTempo(state.tempoBpm);
      render();
    },
    dispose() {
      offs.forEach((f) => f());
      editor.dispose();
      for (const b of blockEls.values()) b.remove();
      blockEls.clear();
      marker.remove();
      playhead.remove();
    },
  };
}
