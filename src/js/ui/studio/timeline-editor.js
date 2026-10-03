// OSCILLA Studio timeline editor (spec §81-§104, §125, §136-§141, §180-§185; plan V417, V418,
// V420, V428, V429). A thin DOM adapter over the pure Studio layer: tracks and their clips as
// DOM blocks on a time grid (seconds or bars and beats), automation lanes, the loop region,
// markers and a playhead that follows the transport.
//
//   mountStudioTimeline(host, ctx) -> { element, destroy(), refresh(), setSnap(id), zoom(steps),
//                                       debug() }
//   ctx = { store, transport, runtime, announce, getSelection, setSelection,
//           subscribe?, sampleRate?, transportBar?, transportKeys? }
// transportKeys: false keeps the strip's time mode and tempo but not its keys and clock (the
// STUDIO workspace header already has them).
//
// Rules this file keeps:
//   - The StudioModel is the only state (rule studio-model-is-canonical): every change is a
//     store.dispatch built by src/js/studio/timeline.js / automation.js helpers; the editor holds
//     only view state (scale, scroll, snap choice, the open details panel, a drag preview).
//   - Commit at gesture end (§86): a drag moves DOM only; one action is dispatched on release,
//     Escape / pointercancel / window blur cancel it (§185, §246-§247).
//   - Audio timing is the transport's (§94, §181): the playhead is read from
//     transport.playhead() on the shared frame loop and only written as a transform; no audio is
//     scheduled from requestAnimationFrame. Edits during playback reach the transport's edit path
//     with transport.sync() (§182-§183).
//   - Every drag has a keyboard and a form path (§141); announcements are semantic (§144).

import { onFrame } from '../../charts/frame-loop.js';
import { announceAction, announceRedo, announceUndo } from '../../studio/a11y.js';
import {
  addMarkerAction, adjacentMarker, duplicateClipPlacement, findClip, loopEdgeResult,
  moveClipResult, moveMarkerAction, nudgeClipResult, resizeClipResult, snapTime, sortedMarkers,
} from '../../studio/timeline.js';
import { createLaneEditor } from './automation-editor.js';
import { LANE_HEIGHT_PX, pointEdit } from './automation-view.js';
import { createDetails } from './timeline-details.js';
import { el, pathIcon, setAttr, spriteIcon, coarsePointer } from './timeline-dom.js';
import {
  EDITOR_DEFAULT_SNAP, SNAP_CHOICES, addClipAction, applySplit, choiceForSnap, clampZoom,
  clipOrder, clipView, contentSpanS, describeTime, fitZoom, focusAfterDelete, followScroll,
  freeStartOnTrack, keyboardStepS, markerAria, rulerTicks, snapForChoice, splitClipPlan,
  trackView, visibleRange, xToTime, zoomAround,
} from './timeline-view.js';
import { mountTransportBar } from './transport-bar.js';
import { createTransportCommands } from './transport-commands.js';
import { KEY_HELP, keyCommand } from './transport-view.js';

/** Row geometry shared with the CSS (studio-timeline.css). */
export const TRACK_ROW_PX = 44;
export { LANE_HEIGHT_PX };
const VIEW_COMMIT_MS = 300;
let mounts = 0;

const EMPTY = Object.freeze({ nodes: [], edges: [], clips: [], points: [], markers: [] });

export function mountStudioTimeline(host, ctx) {
  if (!host || !ctx || !ctx.store || !ctx.transport) {
    throw new TypeError('mountStudioTimeline: a host element and { store, transport } are '
      + 'required');
  }
  const { store, transport } = ctx;
  const uid = `osc-stl-${++mounts}`;
  const commands = createTransportCommands({ store, transport, announce: (t) => say(t) });

  // ------------------------------------------------------------ view state (never the model)
  const v0 = store.getModel().view.timeline;
  const view = { pps: clampZoom(v0.pxPerSecond), scrollX: Math.max(0, v0.scrollX) };
  let snapId = choiceForSnap(EDITOR_DEFAULT_SNAP, store.getModel().transport);
  let gesture = null;
  let dirty = false;
  let destroyed = false;
  let pendingFocus = null;
  let viewTimer = null;
  let rulerQueued = 0;
  let last = { timeline: null, transport: null, nodes: null, selection: null };
  let lastPlayheadX = -1;
  let previewPlayhead = null;
  const timers = [];

  // ------------------------------------------------------------ announcements
  const live = el('p', { class: 'osc-sr-only', role: 'status', 'aria-live': 'polite',
    'aria-atomic': 'true', 'data-osc': 'studio.tl.live' });
  function say(text) {
    if (!text) return;
    if (typeof ctx.announce === 'function') {
      ctx.announce(text);
      return;
    }
    live.textContent = '';
    timers.push(setTimeout(() => { live.textContent = text; }, 30));
  }

  // ------------------------------------------------------------ selection
  const selection = () => {
    const s = typeof ctx.getSelection === 'function' ? ctx.getSelection() : store.getSelection();
    return s || EMPTY;
  };
  function select(sel) {
    const full = { ...EMPTY, ...sel };
    if (typeof ctx.setSelection === 'function') ctx.setSelection(full);
    else store.dispatch({ type: 'SELECTION_CHANGE', selection: full });
    paintSelection();
  }

  // ------------------------------------------------------------ DOM skeleton
  const toolbar = el('div', { class: 'osc-stl-toolbar' });
  const corner = el('div', { class: 'osc-stl-corner' }, [
    el('span', { class: 'osc-label' }, ['Tracks'])]);
  const heads = el('div', { class: 'osc-stl-heads' });
  const ticksEl = el('div', { class: 'osc-stl-ticks', 'aria-hidden': 'true' });
  const loopBand = el('div', { class: 'osc-stl-loop', 'data-osc': 'studio.tl.loop-band',
    'aria-hidden': 'true' });
  const loopStart = el('div', { class: 'osc-stl-loop-h', role: 'slider', tabindex: '0',
    'data-key': 'loop:start', 'data-edge': 'start', 'aria-label': 'Loop start',
    'aria-valuemin': '0', 'data-osc': 'studio.tl.loop-start' });
  const loopEnd = el('div', { class: 'osc-stl-loop-h', role: 'slider', tabindex: '0',
    'data-key': 'loop:end', 'data-edge': 'end', 'aria-label': 'Loop end', 'aria-valuemin': '0',
    'data-osc': 'studio.tl.loop-end' });
  const markersEl = el('div', { class: 'osc-stl-markers' });
  const ruler = el('div', { class: 'osc-stl-ruler', role: 'group', 'data-osc': 'studio.tl.ruler',
    'aria-label': 'Time ruler: click to move the playhead; loop region and markers' },
  [ticksEl, loopBand, loopStart, loopEnd, markersEl]);
  const rows = el('div', { class: 'osc-stl-rows' });
  const shade = el('div', { class: 'osc-stl-shade', 'aria-hidden': 'true' });
  const mlines = el('div', { class: 'osc-stl-mlines', 'aria-hidden': 'true' });
  const playheadEl = el('div', { class: 'osc-stl-playhead', 'data-osc': 'studio.tl.playhead',
    'aria-hidden': 'true' });
  const chipEl = el('div', { class: 'osc-stl-dragchip osc-tabular', hidden: true,
    'aria-hidden': 'true' });
  const content = el('div', { class: 'osc-stl-content' },
    [ruler, shade, mlines, rows, playheadEl, chipEl]);
  const scroller = el('div', { class: 'osc-stl-scroll', 'data-osc': 'studio.tl.scroll' },
    [content]);
  const frame = el('div', { class: 'osc-stl-frame' }, [
    el('div', { class: 'osc-stl-headcol' }, [corner, heads]), scroller]);
  const detailsEl = el('div', { class: 'osc-stl-details', role: 'group', hidden: true,
    'data-osc': 'studio.tl.details' });
  const help = el('p', { class: 'osc-stl-help', id: `${uid}-help` }, [KEY_HELP]);
  const root = el('section', { class: 'osc-stl', role: 'region', 'aria-label': 'Studio timeline',
    'aria-describedby': `${uid}-help`, 'data-osc': 'studio.tl.root' },
  [toolbar, frame, detailsEl, help, live]);

  // ------------------------------------------------------------ toolbar
  const bar = ctx.transportBar === false ? null
    : mountTransportBar(toolbar, ctx, { commands, keys: ctx.transportKeys !== false });
  const snapSel = el('select', { 'aria-label': 'Snap', 'data-osc': 'studio.tl.snap', on: {
    change: (e) => setSnap(e.target.value) } }, SNAP_CHOICES.map((c) => el('option',
    { value: c.id, text: c.label })));
  snapSel.value = snapId;
  const toolBtn = (key, label, icon, onClick, text = null) => el('button', { type: 'button',
    class: text ? 'osc-btn osc-btn-secondary osc-stl-tool' : 'osc-icon-btn osc-stl-tool',
    'data-key': `tool:${key}`, 'data-osc': `studio.tl.${key}`, 'aria-label': label,
    title: label, on: { click: onClick } }, text ? [icon, el('span', {}, [text])] : [icon]);
  const loopFitBtn = toolBtn('loop-edit', 'Loop region settings', pathIcon('loop'),
    () => details.open('loop', 'loop'), 'Loop');
  toolbar.append(el('div', { class: 'osc-stl-tools', role: 'group',
    'aria-label': 'Timeline tools' }, [
    el('div', { class: 'osc-select osc-stl-snap' }, [snapSel]),
    el('div', { class: 'osc-stl-zoom', role: 'group', 'aria-label': 'Zoom' }, [
      toolBtn('zoom-out', 'Zoom out', pathIcon('zoomOut'), () => zoom(-1)),
      toolBtn('zoom-in', 'Zoom in', pathIcon('zoomIn'), () => zoom(1)),
      toolBtn('zoom-fit', 'Fit the timeline', pathIcon('fit'), () => fit()),
    ]),
    toolBtn('track', 'Add a track', spriteIcon('i-plus'), () => details.open('track', 'new'),
      'Track'),
    toolBtn('marker', 'Add a marker at the playhead', pathIcon('marker'), () => addMarker(),
      'Marker'),
    toolBtn('automate', 'Automate a parameter', pathIcon('lane'),
      () => details.open('automate', 'new'), 'Automate'),
    loopFitBtn,
  ]));
  host.append(root);

  // ------------------------------------------------------------ geometry helpers
  const model = () => store.getModel();
  const pps = () => view.pps;
  const contentLeft = () => content.getBoundingClientRect().left;
  const contentWidth = () => Math.round(content.offsetWidth || 0);
  const snap = () => snapForChoice(snapId, { transport: model().transport,
    pxPerSecond: view.pps });
  const sampleRate = () => {
    if (typeof ctx.sampleRate === 'function') return ctx.sampleRate();
    if (typeof ctx.sampleRate === 'number') return ctx.sampleRate;
    return undefined;
  };
  const formatTime = (t) => describeTime(t, model().transport);
  const playheadPosition = () => commands.position();

  function chip(x, y, text, bad = false) {
    chipEl.hidden = false;
    chipEl.textContent = text;
    chipEl.style.transform = `translate(${Math.max(0, x).toFixed(1)}px, ${Math.max(0, y)}px)`;
    if (bad) chipEl.dataset.bad = 'true';
    else delete chipEl.dataset.bad;
  }
  const hideChip = () => { chipEl.hidden = true; };

  /** Focus the element with data-key now, or after the next render when it does not exist. */
  function focusKey(key) {
    if (!key) return;
    const n = root.querySelector(`[data-key="${CSS.escape(key)}"]`);
    if (n) n.focus({ preventScroll: false });
    else pendingFocus = key;
  }

  // ------------------------------------------------------------ commits

  /** Dispatch one action; sync a playing transport (§182); announce; re-render. */
  function commit(action, { focus = null, quiet = false, text = null } = {}) {
    const r = store.dispatch(action);
    if (r.ok && r.changed && transport.playing) transport.sync();
    if (!quiet || !r.ok) say(text && r.ok ? text(r) : announceAction(r));
    if (focus) pendingFocus = focus;
    render(true);
    return r;
  }

  /** Several actions as one undo entry; cancelled entirely on the first refusal. */
  function commitMany(label, actions) {
    if (!actions.length) return { ok: true };
    store.beginGesture(label);
    for (const a of actions) {
      const r = store.dispatch(a);
      if (!r.ok) {
        store.cancelGesture();
        say(announceAction(r));
        render(true);
        return r;
      }
    }
    store.endGesture();
    if (transport.playing) transport.sync();
    render(true);
    return { ok: true };
  }

  function undoRedo(redo) {
    const r = redo ? store.redo() : store.undo();
    if (r.ok && transport.playing) transport.sync();
    say(redo ? announceRedo(r) : announceUndo(r));
    render(true);
  }

  // ------------------------------------------------------------ gestures (§86, §246-§247)

  function beginGesture(e, node, h) {
    if (gesture) gesture.finish(false);
    try { node.setPointerCapture(e.pointerId); } catch (err) { /* not capturable */ }
    const g = { id: e.pointerId, node, h, done: false };
    const onMove = (ev) => { if (ev.pointerId === g.id) h.move(ev); };
    const onUp = (ev) => { if (ev.pointerId === g.id) finish(true); };
    const onCancel = (ev) => { if (ev.pointerId === g.id) finish(false); };
    const onBlur = () => finish(false);
    function finish(ok) {
      if (g.done) return;
      g.done = true;
      node.removeEventListener('pointermove', onMove);
      node.removeEventListener('pointerup', onUp);
      node.removeEventListener('pointercancel', onCancel);
      node.removeEventListener('lostpointercapture', onCancel);
      window.removeEventListener('blur', onBlur);
      try { node.releasePointerCapture(g.id); } catch (err) { /* released */ }
      gesture = null;
      hideChip();
      delete node.dataset.dragging;
      if (ok) h.commit();
      else {
        h.cancel();
        if (g.moved) say(`${h.label || 'Drag'} cancelled`);
      }
      if (dirty) render(true);
    }
    g.finish = finish;
    node.addEventListener('pointermove', onMove);
    node.addEventListener('pointerup', onUp);
    node.addEventListener('pointercancel', onCancel);
    node.addEventListener('lostpointercapture', onCancel);
    window.addEventListener('blur', onBlur);
    gesture = g;
    return g;
  }

  // ------------------------------------------------------------ lanes and details
  const api = {
    model, sampleRate, pps, contentWidth, contentLeft, selection, select, say, commit,
    commitMany, focusKey, formatTime, snap, chip, playheadPosition,
    render: (force) => render(force),
    beginGesture: (e, node, h) => {
      const g = beginGesture(e, node, { ...h, move: (ev) => { g.moved = true; h.move(ev); } });
      return g;
    },
    openDetails: (kind, id) => details.open(kind, id),
    pointEdit: (laneId, pointId, patch) => pointEdit(model(), laneId, pointId, patch,
      { sampleRate: sampleRate() }),
    clipCommand: (cmd, clipId) => clipCommandRun(cmd, clipId),
    pointCommand: (cmd, laneId, pointId) => {
      details.close({ restore: false });
      lanes.removePoint(laneId, pointId);
    },
    markerCommand: (cmd, markerId) => removeMarker(markerId),
    setLoop: (patch) => {
      const r = commands.setLoop(patch);
      render(true);
      return r;
    },
    revealLane: (laneId) => {
      render(true);
      const head = heads.querySelector(`[data-row="${CSS.escape(laneId)}"]`);
      if (head) head.scrollIntoView({ block: 'nearest' });
      focusKey(`lane-add:${laneId}`);
    },
  };
  const lanes = createLaneEditor(api);
  const details = createDetails(api, detailsEl);

  // ------------------------------------------------------------ rendering

  function rulerRender() {
    rulerQueued = 0;
    const m = model();
    const w = scroller.clientWidth || 600;
    const { from, to } = visibleRange(scroller.scrollLeft, w, view.pps);
    const span = to - from;
    const ticks = rulerTicks({ from: Math.max(0, from - span), to: to + span,
      pxPerSecond: view.pps, transport: m.transport });
    const frag = document.createDocumentFragment();
    for (const t of ticks) {
      frag.append(el('span', { class: `osc-stl-tick${t.major ? ' is-major' : ''}`,
        style: `left:${(t.t * view.pps).toFixed(2)}px` }, t.major ? [el('span',
        { class: 'osc-stl-ticklabel osc-tabular' }, [t.label])] : []));
    }
    ticksEl.replaceChildren(frag);
  }
  const queueRuler = () => {
    if (!rulerQueued) rulerQueued = requestAnimationFrame(rulerRender);
  };

  function trackHead(m, t) {
    const v = trackView(m, t);
    return el('div', { class: 'osc-stl-hrow osc-stl-hrow--track', 'data-row': t.id,
      'data-kind': t.kind }, [
      el('div', { class: 'osc-stl-hmain' }, [
        el('span', { class: 'osc-stl-hkind', 'aria-hidden': 'true' }, [pathIcon('track')]),
        el('span', { class: 'osc-stl-hname', title: v.name }, [v.name]),
      ]),
      el('div', { class: 'osc-stl-hsub' }, [
        el('span', { class: 'osc-stl-chip' }, [v.kindLabel.toUpperCase()]),
        el('span', { class: 'osc-stl-htarget', title: `Target: ${v.targetName}` },
          [v.targetName]),
      ]),
      el('div', { class: 'osc-stl-hacts' }, [
        el('button', { type: 'button', class: 'osc-icon-btn osc-icon-btn--sm osc-stl-hbtn',
          'data-key': `track-add:${t.id}`, 'data-osc': 'studio.tl.add-clip',
          'aria-label': `Add a clip to ${v.name} at the playhead`, title: 'Add clip at playhead',
          on: { click: () => addClipOnTrack(t.id, null) } }, [spriteIcon('i-plus')]),
        el('button', { type: 'button', class: 'osc-icon-btn osc-icon-btn--sm osc-stl-hbtn',
          'data-key': `track-del:${t.id}`, 'aria-label': `Delete track ${v.name} and its clips`,
          title: 'Delete track', on: { click: () => removeTrack(t.id) } },
        [spriteIcon('i-trash')]),
      ]),
    ]);
  }

  function clipEl(m, clip, sel) {
    const selected = sel.clips.includes(clip.id);
    const v = clipView(m, clip, { selected });
    const node = el('div', { class: `osc-stl-clip osc-block ${v.cls}`, role: 'button',
      tabindex: '0', 'data-key': `clip:${clip.id}`, 'data-clip': clip.id,
      'data-kind': clip.kind, 'data-selected': selected ? 'true' : 'false',
      'data-problem': v.problems.length ? 'true' : null, 'aria-label': v.aria, title: v.title,
      style: `left:${(clip.start * view.pps).toFixed(2)}px;width:${Math.max(6,
        clip.duration * view.pps - 1).toFixed(2)}px` }, [
      el('span', { class: 'osc-block-name' }, [
        v.problems.length ? el('span', { class: 'osc-stl-flag', 'aria-hidden': 'true' }, ['!'])
          : null,
        v.linked ? el('span', { class: 'osc-stl-linked', 'aria-hidden': 'true',
          title: 'Tempo-linked' }, ['♩']) : null,
        v.label]),
      v.detail ? el('span', { class: 'osc-block-detail' }, [v.detail]) : null,
      el('span', { class: 'osc-stl-clip-h', 'data-edge': 'start', 'aria-hidden': 'true' }),
      el('span', { class: 'osc-stl-clip-h', 'data-edge': 'end', 'aria-hidden': 'true' }),
    ]);
    return node;
  }

  function render(force = false) {
    if (destroyed) return;
    if (gesture && !force) {
      dirty = true;
      return;
    }
    if (gesture) gesture.finish(false);
    dirty = false;
    const m = model();
    const sel = selection();
    last = { timeline: m.timeline, transport: m.transport, nodes: m.graph.nodes,
      selection: sel };
    const active = document.activeElement;
    const activeKey = active && root.contains(active) && active.dataset
      ? active.dataset.key || null : null;
    const w = scroller.clientWidth || 600;
    const span = contentSpanS(m, w / view.pps);
    content.style.width = `${Math.max(w, Math.ceil(span * view.pps))}px`;
    root.dataset.timeMode = m.transport.timeMode;

    // Rows: tracks, then lanes (timeline.js timelineRows order).
    const headFrag = document.createDocumentFragment();
    const rowFrag = document.createDocumentFragment();
    for (const t of m.timeline.tracks) {
      headFrag.append(trackHead(m, t));
      const v = trackView(m, t);
      const row = el('div', { class: 'osc-stl-row osc-stl-row--track', 'data-track': t.id,
        role: 'group', 'aria-label': v.aria });
      for (const c of clipOrder(m)) if (c.trackId === t.id) row.append(clipEl(m, c, sel));
      rowFrag.append(row);
    }
    for (const lane of m.timeline.automation) {
      headFrag.append(lanes.head(lane));
      rowFrag.append(lanes.row(lane));
    }
    if (!m.timeline.tracks.length && !m.timeline.automation.length) {
      headFrag.append(el('div', { class: 'osc-stl-hrow osc-stl-hrow--empty' }, [
        el('span', { class: 'osc-muted' }, ['No tracks'])]));
      rowFrag.append(el('div', { class: 'osc-stl-row osc-stl-row--empty' }, [
        el('span', { class: 'osc-muted' }, ['Add a track to place clips, or automate a '
          + 'parameter.'])]));
    }
    heads.replaceChildren(headFrag);
    rows.replaceChildren(rowFrag);

    // Loop region (§95).
    const loop = m.timeline.loop;
    const lx = loop.start * view.pps;
    const lw = Math.max(2, (loop.end - loop.start) * view.pps);
    loopBand.style.left = `${lx}px`;
    loopBand.style.width = `${lw}px`;
    shade.style.left = `${lx}px`;
    shade.style.width = `${lw}px`;
    root.dataset.loop = loop.enabled ? 'on' : 'off';
    for (const [h, edge] of [[loopStart, 'start'], [loopEnd, 'end']]) {
      h.style.left = `${loop[edge] * view.pps}px`;
      setAttr(h, 'aria-valuenow', loop[edge].toFixed(3));
      setAttr(h, 'aria-valuemax', '3600');
      setAttr(h, 'aria-valuetext', `${describeTime(loop[edge], m.transport)}, loop `
        + `${loop.enabled ? 'on' : 'off'}`);
    }

    // Markers (§96): annotations on the ruler, lines through the rows.
    const mk = document.createDocumentFragment();
    const ml = document.createDocumentFragment();
    for (const marker of sortedMarkers(m)) {
      const selected = sel.markers.includes(marker.id);
      const x = (marker.time * view.pps).toFixed(2);
      mk.append(el('div', { class: 'osc-stl-marker', role: 'button', tabindex: '0',
        'data-key': `marker:${marker.id}`, 'data-marker': marker.id, 'data-kind': marker.kind,
        'data-selected': selected ? 'true' : 'false',
        'aria-label': `${markerAria(marker, m.transport)}${selected ? ', selected' : ''}`,
        title: markerAria(marker, m.transport), style: `left:${x}px` }, [
        el('span', { class: 'osc-stl-marker-label' }, [marker.label || marker.kind])]));
      ml.append(el('span', { class: 'osc-stl-mline', 'data-kind': marker.kind,
        style: `left:${x}px` }));
    }
    markersEl.replaceChildren(mk);
    mlines.replaceChildren(ml);

    if (scroller.scrollLeft !== view.scrollX) scroller.scrollLeft = view.scrollX;
    rulerRender();
    lastPlayheadX = -1;
    drawPlayhead();
    if (bar) bar.update();
    loopFitBtn.setAttribute('aria-pressed', loop.enabled ? 'true' : 'false');
    details.refresh();
    const fromPending = !!pendingFocus;
    const key = pendingFocus || activeKey;
    pendingFocus = null;
    if (key) {
      const n = root.querySelector(`[data-key="${CSS.escape(key)}"]`);
      if (n && document.activeElement !== n) n.focus({ preventScroll: !fromPending });
    }
  }

  /** Selection only: data-selected and labels, no rebuild (keeps a gesture's element alive). */
  function paintSelection() {
    const m = model();
    const sel = selection();
    last.selection = sel;
    for (const n of rows.querySelectorAll('.osc-stl-clip')) {
      const c = findClip(m, n.dataset.clip);
      if (!c) continue;
      const on = sel.clips.includes(c.id);
      setAttr(n, 'data-selected', on ? 'true' : 'false');
      setAttr(n, 'aria-label', clipView(m, c, { selected: on }).aria);
    }
    for (const n of rows.querySelectorAll('.osc-stl-pt')) {
      const on = sel.points.includes(n.dataset.point);
      setAttr(n, 'data-selected', on ? 'true' : 'false');
      const lbl = n.getAttribute('aria-label').replace(/, selected$/, '');
      setAttr(n, 'aria-label', on ? `${lbl}, selected` : lbl);
    }
    for (const n of markersEl.querySelectorAll('.osc-stl-marker')) {
      const on = sel.markers.includes(n.dataset.marker);
      setAttr(n, 'data-selected', on ? 'true' : 'false');
      const lbl = n.getAttribute('aria-label').replace(/, selected$/, '');
      setAttr(n, 'aria-label', on ? `${lbl}, selected` : lbl);
    }
  }

  function drawPlayhead() {
    const pos = previewPlayhead !== null ? previewPlayhead : playheadPosition();
    const x = Math.round(pos * view.pps * 10) / 10;
    if (x === lastPlayheadX) return x;
    lastPlayheadX = x;
    playheadEl.style.transform = `translateX(${x}px)`;
    return x;
  }

  /** The external-change check: model parts or selection replaced since the last paint. */
  function checkStore() {
    const m = model();
    if (m.timeline !== last.timeline || m.transport !== last.transport
      || m.graph.nodes !== last.nodes) {
      render();
    } else if (selection() !== last.selection && !gesture) {
      paintSelection();
    }
  }

  // ------------------------------------------------------------ frame (playhead, §94)
  const offFrame = onFrame((now) => {
    if (destroyed) return;
    checkStore();
    const x = drawPlayhead();
    if (transport.playing && !gesture && previewPlayhead === null) {
      const s = followScroll(x, scroller.scrollLeft, scroller.clientWidth);
      if (s !== null) scroller.scrollLeft = s;
    }
    if (bar) bar.tick(now);
  });
  const offSubscribe = typeof ctx.subscribe === 'function' ? ctx.subscribe(() => checkStore())
    : null;
  const offTransport = transport.on((type) => {
    if (type === 'state' || type === 'ended') {
      lastPlayheadX = -1;
      drawPlayhead();
    }
  });

  // ------------------------------------------------------------ view: scroll and zoom (§89)
  function commitView() {
    clearTimeout(viewTimer);
    viewTimer = setTimeout(() => {
      viewTimer = null;
      if (destroyed) return;
      const cur = model().view.timeline;
      if (cur.pxPerSecond === view.pps && cur.scrollX === view.scrollX) return;
      store.dispatch({ type: 'VIEW_SET', view: { timeline: { pxPerSecond: view.pps,
        scrollX: view.scrollX } } });
    }, VIEW_COMMIT_MS);
  }
  scroller.addEventListener('scroll', () => {
    view.scrollX = scroller.scrollLeft;
    queueRuler();
    commitView();
  }, { passive: true });

  function zoom(steps, anchorPx = null) {
    const w = scroller.clientWidth || 600;
    const px = playheadPosition() * view.pps - scroller.scrollLeft;
    const a = anchorPx !== null ? anchorPx : (px >= 0 && px <= w ? px : w / 2);
    const next = zoomAround({ pxPerSecond: view.pps, scrollX: scroller.scrollLeft }, steps, a);
    if (next.pxPerSecond === view.pps) return;
    view.pps = next.pxPerSecond;
    view.scrollX = next.scrollX;
    render(true);
    scroller.scrollLeft = view.scrollX;
    commitView();
  }

  function fit() {
    const m = model();
    const w = scroller.clientWidth || 600;
    view.pps = fitZoom(contentSpanS(m, 0), w);
    view.scrollX = 0;
    render(true);
    commitView();
    say(`Zoom: the whole timeline is shown`);
  }

  scroller.addEventListener('wheel', (e) => {
    if (!(e.ctrlKey || e.metaKey)) return;
    e.preventDefault();
    const anchor = e.clientX - scroller.getBoundingClientRect().left;
    zoom(e.deltaY < 0 ? 1 : -1, anchor);
  }, { passive: false });

  function setSnap(id) {
    if (!SNAP_CHOICES.some((c) => c.id === id)) return;
    snapId = id;
    snapSel.value = id;
  }

  // ------------------------------------------------------------ clip commands

  function addClipOnTrack(trackId, time) {
    const m = model();
    const t = time === null ? freeStartOnTrack(m, trackId, playheadPosition()) : time;
    const res = addClipAction(m, trackId, t);
    if (res.reason) {
      say(`Not done: ${res.reason}`);
      return;
    }
    const r = commit(res.action);
    if (r.ok && r.created && r.created.clips) {
      const id = r.created.clips[0];
      select({ clips: [id] });
      focusKey(`clip:${id}`);
    }
  }

  function removeTrack(trackId) {
    const r = commit({ type: 'TRACK_REMOVE', trackId });
    if (r.ok) {
      const t = model().timeline.tracks[0];
      focusKey(t ? `track-add:${t.id}` : 'tool:track');
    }
  }

  function clipMovedText(id) {
    return () => {
      const m = model();
      const c = findClip(m, id);
      if (!c) return '';
      const track = m.timeline.tracks.find((t) => t.id === c.trackId);
      return `Moved ${c.kind} clip to ${describeTime(c.start, m.transport)}`
        + `${track ? ` on ${track.name}` : ''}`;
    };
  }

  function clipCommandRun(cmd, clipId) {
    const m = model();
    const clip = findClip(m, clipId);
    if (!clip) return;
    if (cmd === 'delete') {
      const sel = selection().clips;
      const ids = sel.includes(clipId) && sel.length > 1 ? sel : [clipId];
      const next = focusAfterDelete(m, ids);
      details.close({ restore: false });
      const r = ids.length === 1 ? commit({ type: 'CLIP_REMOVE', clipId })
        : commitMany(`Delete ${ids.length} clips`, ids.map((id) => ({ type: 'CLIP_REMOVE',
          clipId: id })));
      if (r.ok && ids.length > 1) say(`Deleted ${ids.length} clips`);
      if (r.ok) {
        focusKey(next ? `clip:${next}` : `track-add:${clip.trackId}`);
        if (next) select({ clips: [next] });
      }
      return;
    }
    if (cmd === 'duplicate') {
      const res = duplicateClipPlacement(m, clipId);
      if (!res.ok) {
        say(`Not done: ${res.reason}`);
        return;
      }
      const r = commit(res.action);
      if (r.ok && r.created && r.created.clips) {
        focusKey(`clip:${r.created.clips[0]}`);
        if (details.isOpen()) details.open('clip', r.created.clips[0]);
      }
      return;
    }
    if (cmd === 'split') {
      const plan = splitClipPlan(m, clipId, playheadPosition());
      if (!plan.ok) {
        say(`Not done: ${plan.reason}`);
        return;
      }
      const r = applySplit(store, clipId, plan);
      if (r.ok && transport.playing) transport.sync();
      say(r.ok ? `Split ${clip.kind} clip at ${describeTime(plan.at, m.transport)}`
        : `Not done: ${r.reason}`);
      render(true);
      if (r.ok) focusKey(`clip:${r.created || clipId}`);
    }
  }

  function removeMarker(markerId) {
    details.close({ restore: false });
    const list = sortedMarkers(model());
    const i = list.findIndex((x) => x.id === markerId);
    const next = list[i + 1] || list[i - 1] || null;
    const r = commit({ type: 'MARKER_REMOVE', markerId });
    if (r.ok) focusKey(next ? `marker:${next.id}` : 'tool:marker');
  }

  function addMarker() {
    const a = addMarkerAction(model(), 'custom', playheadPosition(), snap());
    const r = commit(a);
    if (r.ok && r.created && r.created.markers) focusKey(`marker:${r.created.markers[0]}`);
  }

  // ------------------------------------------------------------ keyboard (§125, §141)

  function kindOf(t) {
    if (!t || !t.closest) return 'other';
    if (t.matches('input, select, textarea, [contenteditable="true"]')) return 'field';
    const k = t.dataset ? t.dataset.key || '' : '';
    if (k.startsWith('clip:')) return 'clip';
    if (k.startsWith('pt:')) return 'point';
    if (k.startsWith('marker:')) return 'marker';
    if (k.startsWith('loop:')) return 'loop';
    if (t.matches('button, a[href], summary')) return 'control';
    return 'other';
  }

  function escape() {
    if (gesture) {
      gesture.finish(false);
      return true;
    }
    if (details.isOpen()) {
      details.close({ restore: true });
      return true;
    }
    commands.escape({});
    return false;
  }

  function onKeyDown(e) {
    const kind = kindOf(e.target);
    const c = keyCommand(e, kind);
    if (!c) {
      // A native control keeps Space / Enter, but the Playground must not hear them (§185).
      if (kind === 'control' && (e.key === ' ' || e.key === 'Enter')) e.stopPropagation();
      return;
    }
    if (c.cmd === 'escape') {
      if (escape()) {
        e.preventDefault();
        e.stopPropagation();
      }
      return;
    }
    const node = e.target;
    let handled = true;
    const m = model();
    switch (c.cmd) {
      case 'play-stop': if (!e.repeat) commands.playStop(); break;
      case 'return': commands.returnToStart(); break;
      case 'undo': undoRedo(false); break;
      case 'redo': undoRedo(true); break;
      case 'loop-toggle': commands.toggleLoop(); render(true); break;
      case 'add-marker': addMarker(); break;
      case 'marker-prev':
      case 'marker-next': {
        const mk = adjacentMarker(m, playheadPosition(), c.cmd === 'marker-next' ? 1 : -1);
        if (mk) commands.locate(mk.time);
        else say('No marker in that direction');
        break;
      }
      default:
        handled = targetCommand(c, kind, node, m);
    }
    if (handled) {
      e.preventDefault();
      e.stopPropagation();
    }
  }

  function targetCommand(c, kind, node, m) {
    if (kind === 'point') return lanes.key(c, node);
    if (kind === 'clip') {
      const id = node.dataset.clip;
      const clip = findClip(m, id);
      if (!clip) return false;
      if (c.cmd === 'edit') return details.open('clip', id) || true;
      if (c.cmd === 'delete' || c.cmd === 'duplicate' || c.cmd === 'split') {
        clipCommandRun(c.cmd, id);
        return true;
      }
      let res;
      if (c.cmd === 'nudge-time') {
        res = c.fine ? moveClipResult(m, id, { start: clip.start + c.dir * keyboardStepS(snap(),
          m.transport, { clipKind: clip.kind, fine: true }), snap: { mode: 'off' } })
          : nudgeClipResult(m, id, { direction: c.dir, snap: snap() });
      } else if (c.cmd === 'nudge-row') {
        res = nudgeClipResult(m, id, { direction: 0, trackDelta: -c.dir, snap: snap() });
        if (res.ok && !res.action) res = { ok: false, reason: 'There is no compatible track '
          + `${c.dir > 0 ? 'above' : 'below'}.` };
      } else return false;
      if (!res.ok) say(`Not done: ${res.reason}`);
      else if (res.action) commit(res.action, { focus: `clip:${id}`, text: clipMovedText(id) });
      return true;
    }
    if (kind === 'marker') {
      const id = node.dataset.marker;
      const mk = m.timeline.markers.find((x) => x.id === id);
      if (!mk) return false;
      if (c.cmd === 'edit') return details.open('marker', id) || true;
      if (c.cmd === 'delete') {
        removeMarker(id);
        return true;
      }
      if (c.cmd === 'nudge-time') {
        const step = keyboardStepS(snap(), m.transport, { fine: c.fine });
        const a = moveMarkerAction(m, id, Math.max(0, mk.time + c.dir * step), { mode: 'off' });
        if (a) commit(a, { focus: `marker:${id}`, text: () => `Moved marker to `
          + `${describeTime(a.time, m.transport)}` });
        return true;
      }
      return false;
    }
    if (kind === 'loop') {
      const edge = node.dataset.edge;
      if (c.cmd === 'edit') return details.open('loop', 'loop') || true;
      if (c.cmd === 'nudge-time') {
        const step = keyboardStepS(snap(), m.transport, { fine: c.fine });
        const res = loopEdgeResult(m, edge, m.timeline.loop[edge] + c.dir * step,
          { mode: 'off' });
        if (res.action) {
          commands.setLoop({ start: res.loop.start, end: res.loop.end });
          pendingFocus = `loop:${edge}`;
          render(true);
        }
        return true;
      }
      return false;
    }
    return false;
  }

  // ------------------------------------------------------------ pointer (§86-§87, §95-§96)

  function trackGeometry() {
    const base = rows.getBoundingClientRect().top;
    return [...rows.querySelectorAll('.osc-stl-row--track')].map((r) => {
      const b = r.getBoundingClientRect();
      return { trackId: r.dataset.track, top: b.top - base, height: b.height };
    });
  }

  function clipPointerDown(e, node) {
    const id = node.dataset.clip;
    const sel = selection();
    const selected = sel.clips.includes(id);
    if (e.shiftKey || e.metaKey || e.ctrlKey) {
      const clips = selected ? sel.clips.filter((x) => x !== id) : [...sel.clips, id];
      select({ clips });
      node.focus({ preventScroll: true });
      e.preventDefault();
      return;
    }
    if (!selected) select({ clips: [id] });
    node.focus({ preventScroll: true });
    // Touch: the first tap selects; only a selected clip drags (the lane keeps scrolling).
    if (e.pointerType === 'touch' && !selected) return;
    e.preventDefault();
    const m = model();
    const clip = findClip(m, id);
    if (!clip) return;
    const handle = e.target.closest('.osc-stl-clip-h');
    const edge = handle ? handle.dataset.edge : null;
    const geo = trackGeometry();
    const origin = geo.find((g) => g.trackId === clip.trackId) || { top: 0, height: TRACK_ROW_PX };
    const rowsTop = () => rows.getBoundingClientRect().top;
    const start = { x: e.clientX, y: e.clientY };
    let res = null;
    let moved = false;
    const p = view.pps;
    beginGesture(e, node, {
      label: edge ? 'Resize' : 'Move',
      move(ev) {
        const dx = ev.clientX - start.x;
        const dy = ev.clientY - start.y;
        if (!moved && Math.abs(dx) < 3 && Math.abs(dy) < 3) return;
        moved = true;
        gesture.moved = true;
        node.dataset.dragging = 'true';
        if (edge) {
          res = resizeClipResult(m, id, { edge, time: xToTime(ev.clientX - contentLeft(), p),
            snap: snap() });
          const s = res.start ?? clip.start;
          const d = res.duration ?? clip.duration;
          node.style.left = `${(s * p).toFixed(2)}px`;
          node.style.width = `${Math.max(6, d * p - 1).toFixed(2)}px`;
          node.dataset.invalid = res.ok ? 'false' : 'true';
          chip((edge === 'end' ? s + d : s) * p, origin.top + ruler.offsetHeight,
            res.ok ? `${d.toFixed(3)} s${res.clamped ? ` · ${res.reason}` : ''}` : res.reason,
            !res.ok || res.clamped);
          return;
        }
        const y = ev.clientY - rowsTop();
        const over = geo.find((g) => y >= g.top && y < g.top + g.height);
        res = moveClipResult(m, id, { deltaS: dx / p, trackId: over ? over.trackId
          : clip.trackId, snap: snap() });
        const s = res.ok ? res.start : clip.start + dx / p;
        const row = geo.find((g) => g.trackId === (res.ok ? res.trackId
          : (over ? over.trackId : clip.trackId))) || origin;
        node.style.transform = `translate(${((s - clip.start) * p).toFixed(2)}px, `
          + `${(row.top - origin.top).toFixed(1)}px)`;
        node.dataset.invalid = res.ok ? 'false' : 'true';
        chip(s * p, row.top + ruler.offsetHeight, res.ok ? describeTime(s, m.transport)
          : res.reason, !res.ok);
      },
      commit() {
        if (!moved) return;
        if (res && res.ok && res.action) {
          commit(res.action, { focus: `clip:${id}`, text: edge ? null : clipMovedText(id) });
        } else {
          if (res && !res.ok) say(`Not done: ${res.reason}`);
          render(true);
        }
      },
      cancel() { render(true); },
    });
  }

  function markerPointerDown(e, node) {
    const id = node.dataset.marker;
    select({ markers: [id] });
    node.focus({ preventScroll: true });
    e.preventDefault();
    const m = model();
    const mk = m.timeline.markers.find((x) => x.id === id);
    const line = mlines.querySelector(`[style*="left:${(mk.time * view.pps).toFixed(2)}px"]`);
    let action = null;
    const start = e.clientX;
    beginGesture(e, node, {
      label: 'Marker move',
      move(ev) {
        if (Math.abs(ev.clientX - start) < 3 && !action) return;
        gesture.moved = true;
        const t = xToTime(ev.clientX - contentLeft(), view.pps);
        action = moveMarkerAction(m, id, t, snap());
        const at = action ? action.time : mk.time;
        node.style.left = `${at * view.pps}px`;
        if (line) line.style.left = `${at * view.pps}px`;
        chip(at * view.pps, 0, describeTime(at, m.transport));
      },
      commit() {
        if (action) commit(action, { focus: `marker:${id}` });
      },
      cancel() { render(true); },
    });
  }

  function loopPointerDown(e, node) {
    const edge = node === loopBand ? 'move' : node.dataset.edge;
    if (edge !== 'move') node.focus({ preventScroll: true });
    e.preventDefault();
    const m = model();
    const cur = m.timeline.loop;
    const start = e.clientX;
    let res = null;
    beginGesture(e, node, {
      label: 'Loop change',
      move(ev) {
        if (Math.abs(ev.clientX - start) < 3 && !res) return;
        gesture.moved = true;
        const t = edge === 'move' ? cur.start + (ev.clientX - start) / view.pps
          : xToTime(ev.clientX - contentLeft(), view.pps);
        res = loopEdgeResult(m, edge, t, snap());
        const lx = res.loop.start * view.pps;
        const lw = (res.loop.end - res.loop.start) * view.pps;
        for (const n of [loopBand, shade]) {
          n.style.left = `${lx}px`;
          n.style.width = `${lw}px`;
        }
        loopStart.style.left = `${lx}px`;
        loopEnd.style.left = `${lx + lw}px`;
        chip(lx, 0, `${res.loop.start.toFixed(3)} – ${res.loop.end.toFixed(3)} s`);
      },
      commit() {
        if (res && res.action) {
          commands.setLoop({ start: res.loop.start, end: res.loop.end });
          if (edge !== 'move') pendingFocus = `loop:${edge}`;
        }
        render(true);
      },
      cancel() { render(true); },
    });
  }

  /** Ruler: press and drag previews the playhead; release locates the transport there. */
  function rulerPointerDown(e) {
    e.preventDefault();
    const m = model();
    const at = (ev) => {
      const t = xToTime(ev.clientX - contentLeft(), view.pps);
      return snapTime(t, snap(), { transport: m.transport, markers: m.timeline.markers,
        loop: m.timeline.loop });
    };
    previewPlayhead = at(e);
    drawPlayhead();
    beginGesture(e, ruler, {
      label: 'Locate',
      move(ev) {
        previewPlayhead = at(ev);
        drawPlayhead();
        chip(previewPlayhead * view.pps, 0, describeTime(previewPlayhead, m.transport));
      },
      commit() {
        const t = previewPlayhead;
        previewPlayhead = null;
        if (t !== null) commands.locate(t);
        lastPlayheadX = -1;
        drawPlayhead();
      },
      cancel() {
        previewPlayhead = null;
        lastPlayheadX = -1;
        drawPlayhead();
      },
    });
  }

  root.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || destroyed) return;
    checkStore();
    const t = e.target;
    const clip = t.closest('.osc-stl-clip');
    if (clip) return clipPointerDown(e, clip);
    if (t.closest('.osc-stl-pt')) {
      if (lanes.pointerDown(e)) e.preventDefault();
      return undefined;
    }
    const marker = t.closest('.osc-stl-marker');
    if (marker) return markerPointerDown(e, marker);
    if (t === loopStart || t === loopEnd || t === loopBand) return loopPointerDown(e, t);
    if (t.closest('.osc-stl-ruler')) return rulerPointerDown(e);
    if (t.closest('.osc-stl-row') && !t.closest('button')) {
      const s = selection();
      if (s.clips.length || s.points.length || s.markers.length) select({});
    }
    return undefined;
  });

  root.addEventListener('dblclick', (e) => {
    const t = e.target;
    const clip = t.closest('.osc-stl-clip');
    if (clip) {
      details.open('clip', clip.dataset.clip);
      return;
    }
    const pt = t.closest('.osc-stl-pt');
    if (pt) {
      details.open('point', `${pt.dataset.lane}:${pt.dataset.point}`);
      return;
    }
    const marker = t.closest('.osc-stl-marker');
    if (marker) {
      details.open('marker', marker.dataset.marker);
      return;
    }
    if (t.closest('.osc-stl-row--lane')) {
      lanes.dblClick(e);
      return;
    }
    const row = t.closest('.osc-stl-row--track');
    if (row) {
      const m = model();
      const time = xToTime(e.clientX - contentLeft(), view.pps);
      addClipOnTrack(row.dataset.track, snapTime(time, snap(), { transport: m.transport,
        markers: m.timeline.markers, loop: m.timeline.loop }));
    }
  });

  root.addEventListener('keydown', onKeyDown);
  root.addEventListener('focusin', (e) => {
    checkStore();
    // Selection follows keyboard focus on timeline objects (shared selection, §118).
    const n = e.target;
    if (gesture || !n.dataset) return;
    const sel = selection();
    if (n.dataset.clip && !sel.clips.includes(n.dataset.clip)) select({ clips: [n.dataset.clip] });
    else if (n.dataset.point && !sel.points.includes(n.dataset.point)) {
      select({ points: [n.dataset.point] });
    } else if (n.dataset.marker && !sel.markers.includes(n.dataset.marker)) {
      select({ markers: [n.dataset.marker] });
    }
  });

  const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(() => {
    if (!gesture) queueRuler();
  }) : null;
  if (ro) ro.observe(scroller);

  root.dataset.pointer = coarsePointer() ? 'coarse' : 'fine';
  render(true);

  return {
    element: root,
    refresh: () => render(true),
    setSnap,
    zoom,
    commands,
    debug: () => ({ pxPerSecond: view.pps, scrollX: scroller.scrollLeft, snap: snapId,
      details: details.isOpen() ? details.current().kind : null, gesture: !!gesture,
      playheadX: lastPlayheadX }),
    destroy() {
      if (destroyed) return;
      if (gesture) gesture.finish(false);
      destroyed = true;
      offFrame();
      offTransport();
      if (offSubscribe) offSubscribe();
      if (ro) ro.disconnect();
      if (rulerQueued) cancelAnimationFrame(rulerQueued);
      clearTimeout(viewTimer);
      for (const id of timers) clearTimeout(id);
      if (bar) bar.destroy();
      root.remove();
    },
  };
}
