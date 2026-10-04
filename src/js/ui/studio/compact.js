// Compact Studio widget in the Playground (spec §127-§130, §197, §214). Not a shrunken full
// Studio: a summary of the SAME store — transport (play, stop, loop, time), the clips with the
// playhead, and the signal path in an automatic layout (graph-layout.js; the full Studio keeps
// the authored positions). Selecting a node or a clip here selects it in the shared store; a
// clip moves with the arrow keys or a horizontal drag (CLIP_MOVE through timeline.js
// moveClipResult / nudgeClipResult); EXPAND STUDIO opens the full workspace on the identical
// state (§130). It never holds its own copy of the topology (§9, rule
// project.studio-model-is-canonical).
//
//   compactView(model, selection, opts) -> view             pure (unit-tested)
//   mountCompact(host, svc) -> { render(), setTransport(t), setPlayhead(pos), destroy() }
//     svc: { store, registry, announce, play(), stop(), toggleLoop(), expand(nodeId?) }

import { NODE_REGISTRY } from '../../studio/registry.js';
import {
  announceAction, announceSelection, clipLabel, summarizeStudio,
} from '../../studio/a11y.js';
import { moveClipResult, nudgeClipResult } from '../../studio/timeline.js';
import { compactLayout } from './graph-layout.js';
import { cablePath, pastThreshold } from './graph-geometry.js';
import { coarsePointer, h, replaceChildren, s, setAttr, setText } from './graph-dom.js';

/** Short chip label: "Oscillator 1" → "OSCILLATOR 1"; names above 14 characters are cut. */
export function chipLabel(name) {
  const t = String(name || '').toUpperCase();
  return t.length > 14 ? `${t.slice(0, 13)}…` : t;
}

/** "Tone", "Sweep", "Noise check", ... (a11y.js: the selection announcement names it too). */
export { clipLabel };

/** "00:04.210" (minutes, seconds, milliseconds). */
export function compactTime(seconds) {
  const t = Math.max(0, Number.isFinite(seconds) ? seconds : 0);
  const m = Math.floor(t / 60);
  const sec = t - m * 60;
  return `${String(m).padStart(2, '0')}:${sec.toFixed(3).padStart(6, '0')}`;
}

/**
 * The compact view. opts: { registry, minClipPx (24 fine, 44 coarse), basePxPerSecond }.
 * The clip strip's scale is the larger of the base scale and the one that gives the shortest
 * clip `minClipPx`, so every clip stays a usable target; the strip scrolls inside its box.
 */
export function compactView(model, selection, opts = {}) {
  const registry = opts.registry || NODE_REGISTRY;
  const minClipPx = opts.minClipPx || 24;
  const base = opts.basePxPerSecond || 48;
  const sel = selection || {};
  const layout = compactLayout(model, { registry });
  const selNodes = new Set(sel.nodes || []);
  const selClips = new Set(sel.clips || []);
  const byId = new Map(model.graph.nodes.map((n) => [n.id, n]));
  const nodes = layout.nodes.map((p) => {
    const n = byId.get(p.id);
    const def = registry.get(n.type);
    return { id: n.id, col: p.col, row: p.row, label: chipLabel(n.metadata.name),
      name: n.metadata.name, category: def ? def.category.toLowerCase() : 'unknown',
      summary: registry.summarize(n), selected: selNodes.has(n.id) };
  });
  const clips = model.timeline.clips;
  const minDur = clips.length ? Math.min(...clips.map((c) => c.duration)) : 1;
  const pxPerSecond = Math.max(base, minClipPx / Math.max(1e-3, minDur));
  let end = 0;
  for (const c of clips) end = Math.max(end, c.start + c.duration);
  const trackIndex = new Map(model.timeline.tracks.map((t, i) => [t.id, i]));
  const items = clips.map((c) => {
    const n = byId.get(c.target) || byId.get((model.timeline.tracks
      .find((t) => t.id === c.trackId) || {}).target);
    const label = clipLabel(c);
    return { id: c.id, label, kind: c.kind,
      block: c.kind === 'pattern' ? String(c.payload.blockType || '') : '',
      row: trackIndex.has(c.trackId) ? trackIndex.get(c.trackId) : 0,
      left: Math.round(c.start * pxPerSecond), width: Math.max(minClipPx,
        Math.round(c.duration * pxPerSecond)),
      start: c.start, duration: c.duration, selected: selClips.has(c.id),
      aria: `${label} clip, ${c.start} to ${Math.round((c.start + c.duration) * 1000) / 1000} s${
        n ? `, on ${n.metadata.name}` : ''}${selClips.has(c.id) ? ', selected' : ''}` };
  });
  return {
    title: model.metadata.title,
    counts: `${model.graph.nodes.length} nodes · ${model.graph.edges.length} connections · `
      + `${clips.length} clips`,
    path: { columns: layout.columns, rows: layout.rows, nodes, links: layout.links },
    clips: { pxPerSecond, rows: Math.max(1, model.timeline.tracks.length),
      width: Math.max(Math.round(end * pxPerSecond) + minClipPx, 120), items, end },
    loop: model.timeline.loop,
    summary: summarizeStudio(model, { registry }),
  };
}

// ---------------------------------------------------------------- DOM

export function mountCompact(host, svc) {
  const registry = svc.registry || NODE_REGISTRY;
  const store = svc.store;
  const playBtn = h('button', { type: 'button', class: 'osc-icon-btn osc-sc-play',
    'data-osc': 'studio.compact.play', 'aria-label': 'Play the Studio', 'aria-pressed': 'false',
    onClick: () => (playBtn.getAttribute('aria-pressed') === 'true' ? svc.stop() : svc.play()) },
  [s('svg', { 'aria-hidden': 'true' }, [s('use', { href: '#i-play' })])]);
  const stopBtn = h('button', { type: 'button', class: 'osc-icon-btn osc-sc-stop',
    'data-osc': 'studio.compact.stop', 'aria-label': 'Stop the Studio',
    onClick: () => svc.stop() }, [s('svg', { 'aria-hidden': 'true' }, [s('use', { href: '#i-stop' })])]);
  const loopBtn = h('button', { type: 'button', class: 'osc-btn osc-btn-secondary osc-sc-loop',
    'data-osc': 'studio.compact.loop', 'aria-pressed': 'false', text: 'Loop',
    onClick: () => svc.toggleLoop() });
  const time = h('span', { class: 'osc-sc-time osc-num', 'data-osc': 'studio.compact.time',
    text: compactTime(0) });
  const title = h('span', { class: 'osc-sc-doc', 'data-osc': 'studio.compact.title' });
  const expand = h('button', { type: 'button', class: 'osc-btn osc-btn-primary osc-sc-expand',
    'data-osc': 'studio.compact.expand', text: 'Expand Studio', onClick: () => svc.expand() });
  const links = s('svg', { class: 'osc-sc-links', 'aria-hidden': 'true' });
  const pathGrid = h('div', { class: 'osc-sc-grid', role: 'group',
    'aria-label': 'Studio signal path', 'data-osc': 'studio.compact.path' });
  const path = h('div', { class: 'osc-sc-path' }, [links, pathGrid]);
  const strip = h('div', { class: 'osc-sc-strip', role: 'group', 'aria-label': 'Studio clips',
    'data-osc': 'studio.compact.clips' });
  const playhead = h('div', { class: 'osc-sc-playhead', 'aria-hidden': 'true', hidden: true });
  const lane = h('div', { class: 'osc-sc-lane' }, [strip, playhead]);
  const clipsBox = h('div', { class: 'osc-sc-clips' }, [lane]);
  const summary = h('p', { class: 'osc-sr-only', 'data-osc': 'studio.compact.summary' });
  const counts = h('span', { class: 'osc-sc-counts osc-num', 'data-osc': 'studio.compact.counts' });
  replaceChildren(host, [
    h('div', { class: 'osc-panel-header osc-sc-head' }, [
      h('h3', { class: 'osc-panel-title', id: 'osc-sc-title', text: 'Studio' }),
      title,
      h('div', { class: 'osc-sc-transport', role: 'group', 'aria-label': 'Studio transport' },
        [playBtn, stopBtn, loopBtn, time]),
      h('span', { class: 'osc-spacer' }),
      counts,
      expand,
    ]),
    h('div', { class: 'osc-sc-body' }, [path, clipsBox]),
    summary,
  ]);
  host.setAttribute('aria-labelledby', 'osc-sc-title');

  let view = null;
  let pxPerSecond = 48;
  let drag = null;

  function drawLinks() {
    if (!view) return;
    const chips = new Map([...pathGrid.children].map((c) => [c.dataset.nodeId, c]));
    const w = pathGrid.scrollWidth;
    const hh = pathGrid.scrollHeight;
    links.setAttribute('width', String(w));
    links.setAttribute('height', String(hh));
    links.setAttribute('viewBox', `0 0 ${w} ${hh}`);
    replaceChildren(links, view.path.links.map((l) => {
      const a = chips.get(l.from);
      const b = chips.get(l.to);
      if (!a || !b) return null;
      const sx = a.offsetLeft + a.offsetWidth;
      const sy = a.offsetTop + a.offsetHeight / 2;
      const tx = b.offsetLeft;
      const ty = b.offsetTop + b.offsetHeight / 2;
      return s('path', { class: `osc-sc-link is-${l.type.toLowerCase()}${l.muted ? ' is-muted' : ''}`,
        d: cablePath(sx, sy, tx, ty) });
    }));
  }

  function selectNode(id) {
    store.dispatch({ type: 'SELECTION_CHANGE', selection: { nodes: [id] } });
    svc.announce(announceSelection(store.getModel(), store.getSelection()));
  }

  function moveClip(id, result) {
    if (!result.ok) {
      svc.announce(result.reason, { assertive: true });
      return;
    }
    if (!result.action) return;
    const r = store.dispatch(result.action);
    svc.announce(announceAction(r), { assertive: !r.ok });
  }

  function clipKey(e, id) {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    moveClip(id, nudgeClipResult(store.getModel(), id,
      { direction: e.key === 'ArrowLeft' ? -1 : 1 }, registry));
    requestAnimationFrame(() => {
      const el = strip.querySelector(`[data-clip-id="${CSS.escape(id)}"]`);
      if (el) el.focus();
    });
  }

  function clipDown(e, id, el) {
    if (e.button !== 0) return;
    drag = { id, el, pid: e.pointerId, x0: e.clientX, moved: false,
      left: el.offsetLeft };
    try { el.setPointerCapture(e.pointerId); } catch (err) { /* not capturable */ }
  }
  function clipMove(e) {
    if (!drag || e.pointerId !== drag.pid) return;
    const dx = e.clientX - drag.x0;
    if (!drag.moved && !pastThreshold(dx, 0)) return;
    drag.moved = true;
    drag.el.style.transform = `translateX(${Math.max(-drag.left, dx)}px)`;
  }
  function clipUp(e, commit) {
    if (!drag || (e && e.pointerId !== drag.pid)) return;
    const d = drag;
    drag = null;
    d.el.style.transform = '';
    if (!d.moved) {
      if (commit) {
        store.dispatch({ type: 'SELECTION_CHANGE', selection: { clips: [d.id] } });
        svc.announce(announceSelection(store.getModel(), store.getSelection()));
      }
      return;
    }
    d.el.dataset.dragged = '1';
    if (commit && e) {
      moveClip(d.id, moveClipResult(store.getModel(), d.id,
        { deltaS: (e.clientX - d.x0) / pxPerSecond }, registry));
    }
  }

  function render() {
    const model = store.getModel();
    view = compactView(model, store.getSelection(), { registry,
      minClipPx: coarsePointer() ? 44 : 24 });
    pxPerSecond = view.clips.pxPerSecond;
    setText(title, view.title);
    setText(counts, view.counts);
    setText(summary, view.summary);
    pathGrid.style.gridTemplateColumns = `repeat(${Math.max(1, view.path.columns)}, max-content)`;
    // The chips are rebuilt: a focused chip keeps focus on its rebuilt twin (V431 U5).
    const had = document.activeElement;
    const keepNode = had && pathGrid.contains(had) ? had.dataset.nodeId : null;
    const keepClip = had && strip.contains(had) ? had.dataset.clipId : null;
    replaceChildren(pathGrid, view.path.nodes.map((n) => h('button', { type: 'button',
      class: `osc-sc-node osc-sc-node--${n.category}`, 'data-node-id': n.id,
      'data-osc': 'studio.compact.node', 'aria-pressed': n.selected ? 'true' : 'false',
      'aria-label': `${n.name}, ${n.summary}`, title: `${n.name} · ${n.summary}`,
      style: `grid-column: ${n.col + 1}; grid-row: ${n.row + 1}`, text: n.label,
      onClick: () => selectNode(n.id),
      onDblclick: () => svc.expand(n.id) })));
    if (!view.path.nodes.length) {
      replaceChildren(pathGrid, h('p', { class: 'osc-sc-empty', text: 'Empty graph.' }));
    }
    lane.style.width = `${view.clips.width}px`;
    lane.style.setProperty('--osc-sc-rows', String(view.clips.rows));
    replaceChildren(strip, view.clips.items.map((c) => {
      const el = h('button', { type: 'button', class: `osc-sc-clip osc-sc-clip--${c.kind}${
        c.block ? ` osc-block--${c.block}` : ''}`, 'data-clip-id': c.id,
      'data-osc': 'studio.compact.clip', 'aria-pressed': c.selected ? 'true' : 'false',
      'aria-label': c.aria, title: c.aria,
      style: `left: ${c.left}px; width: ${c.width}px; --osc-sc-row: ${c.row}`, text: c.label });
      el.addEventListener('pointerdown', (e) => clipDown(e, c.id, el));
      el.addEventListener('click', (e) => {
        if (el.dataset.dragged) {
          delete el.dataset.dragged;
          return;
        }
        if (e.detail === 0) {
          store.dispatch({ type: 'SELECTION_CHANGE', selection: { clips: [c.id] } });
          svc.announce(announceSelection(store.getModel(), store.getSelection()));
        }
      });
      el.addEventListener('keydown', (e) => clipKey(e, c.id));
      return el;
    }));
    if (!view.clips.items.length) {
      replaceChildren(strip, h('p', { class: 'osc-sc-empty', text: 'No clips.' }));
    }
    const twin = keepNode ? pathGrid.querySelector(`[data-node-id="${CSS.escape(keepNode)}"]`)
      : keepClip ? strip.querySelector(`[data-clip-id="${CSS.escape(keepClip)}"]`) : null;
    if (twin) twin.focus({ preventScroll: true });
    setAttr(loopBtn, 'aria-pressed', model.timeline.loop.enabled ? 'true' : 'false');
    requestAnimationFrame(drawLinks);
  }

  const onMove = (e) => clipMove(e);
  const onUp = (e) => clipUp(e, true);
  const onCancel = (e) => clipUp(e, false);
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
  window.addEventListener('pointercancel', onCancel);
  const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(() => drawLinks()) : null;
  if (ro) ro.observe(pathGrid);

  render();
  return {
    render,
    setTransport({ playing, timeText }) {
      setAttr(playBtn, 'aria-pressed', playing ? 'true' : 'false'); // the name stays (U11)
      const use = playBtn.querySelector('use');
      if (use) use.setAttribute('href', playing ? '#i-pause' : '#i-play');
      host.classList.toggle('is-playing', !!playing);
      if (timeText != null) setText(time, timeText);
    },
    setPlayhead(position) {
      playhead.style.transform = `translateX(${Math.round(position * pxPerSecond)}px)`;
      playhead.hidden = !(position > 0);
      setText(time, compactTime(position));
    },
    destroy() {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
      if (ro) ro.disconnect();
      replaceChildren(host, []);
    },
  };
}
