// Compact Studio timeline (spec §127, §129; plan V430): a read-only miniature of the SAME
// StudioModel for the cockpit widget — tracks with their clips, automation lanes as thin curves,
// markers, the loop region and the playhead. It is a projection, never an authored copy (§128):
// it draws whatever model it is given and keeps nothing but a render cache per host.
//
//   renderCompactTimeline(host, model, playhead) -> { setPlayhead(p), destroy() }
// `playhead` is seconds or transport.playhead() ({ position }). Calling it again with the same
// model (same timeline, transport and nodes objects) only moves the playhead, so the widget may
// call it every frame; positions are percentages, so it needs no measuring.

import { automationScale, laneParamDef } from '../../studio/automation.js';
import { NODE_REGISTRY } from '../../studio/registry.js';
import { clipEnd, sortedMarkers, timelineEnd } from '../../studio/timeline.js';
import { lanePath } from './automation-view.js';
import { clipClass, clipText, formatClock, formatSecondsText } from './timeline-view.js';
import { el, svgEl } from './timeline-dom.js';

const cache = new WeakMap();
const LANE_VIEW_H = 100;
const LANE_VIEW_W = 1000;

const positionOf = (p) => {
  const v = p && typeof p === 'object' ? p.position : p;
  return typeof v === 'number' && Number.isFinite(v) ? Math.max(0, v) : 0;
};

/** The span (s) the miniature shows: everything executable, the loop and markers; at least 1 s. */
export function compactSpan(model) {
  let end = Math.max(1, timelineEnd(model), model.timeline.loop.enabled
    ? model.timeline.loop.end : 0);
  for (const m of model.timeline.markers) end = Math.max(end, m.time);
  return end;
}

/** One-sentence summary of the timeline (the miniature's accessible name, §249 style). */
export function compactSummary(model, position = 0) {
  const t = model.timeline;
  const n = t.clips.length;
  const parts = [`${n} clip${n === 1 ? '' : 's'} on ${t.tracks.length} track`
    + `${t.tracks.length === 1 ? '' : 's'}`];
  if (t.automation.length) {
    parts.push(`${t.automation.length} automation lane${t.automation.length === 1 ? '' : 's'}`);
  }
  const nm = t.markers.length;
  if (nm) parts.push(`${nm} marker${nm === 1 ? '' : 's'}`);
  if (t.loop.enabled) {
    parts.push(`loop ${formatSecondsText(t.loop.start)} to ${formatSecondsText(t.loop.end)}`);
  }
  return `Timeline: ${parts.join(', ')}; length ${formatSecondsText(timelineEnd(model))}, `
    + `playhead ${formatSecondsText(position)}`;
}

const pct = (v, span) => `${Math.max(0, Math.min(100, (v / span) * 100)).toFixed(3)}%`;

function build(host, model, position) {
  const span = compactSpan(model);
  const root = el('div', { class: 'osc-stc', role: 'img', 'data-osc': 'studio.compact-timeline',
    'aria-label': compactSummary(model, position) });
  const t = model.timeline;
  if (t.loop.enabled) {
    root.append(el('div', { class: 'osc-stc-loop', style: `left:${pct(t.loop.start, span)};`
      + `width:${pct(t.loop.end - t.loop.start, span)}` }));
  }
  for (const track of t.tracks) {
    const row = el('div', { class: 'osc-stc-row', title: track.name });
    for (const c of t.clips) {
      if (c.trackId !== track.id) continue;
      const tx = clipText(c);
      row.append(el('div', { class: `osc-stc-clip osc-block ${clipClass(c)}`,
        'data-kind': c.kind, title: `${tx.label} ${formatSecondsText(c.start)}–`
          + `${formatSecondsText(clipEnd(c))}`,
        style: `left:${pct(c.start, span)};width:${pct(c.duration, span)}` }));
    }
    root.append(row);
  }
  for (const lane of t.automation) {
    const def = laneParamDef(model, lane, NODE_REGISTRY);
    if (!def || !lane.points.length) continue;
    const scale = automationScale(def);
    const svg = svgEl('svg', { class: 'osc-stc-lane', viewBox: `0 0 ${LANE_VIEW_W} `
      + `${LANE_VIEW_H}`, preserveAspectRatio: 'none', 'aria-hidden': 'true' });
    svg.append(svgEl('path', { d: lanePath(lane.points, scale, { pxPerSecond: LANE_VIEW_W / span,
      height: LANE_VIEW_H, to: span, samplePx: 8 }), 'vector-effect': 'non-scaling-stroke' }));
    root.append(svg);
  }
  for (const m of sortedMarkers(model)) {
    root.append(el('span', { class: 'osc-stc-marker', 'data-kind': m.kind,
      style: `left:${pct(m.time, span)}`, title: m.label || m.kind }));
  }
  const head = el('div', { class: 'osc-stc-playhead', 'data-osc': 'studio.compact-playhead' });
  root.append(head);
  const time = el('span', { class: 'osc-stc-time osc-tabular', 'aria-hidden': 'true' });
  root.append(time);
  host.replaceChildren(root);
  return { root, head, time, span, timeline: model.timeline, transport: model.transport,
    nodes: model.graph.nodes, model, lastPos: null };
}

export function renderCompactTimeline(host, model, playhead) {
  const position = positionOf(playhead);
  let c = cache.get(host);
  if (!c || !host.contains(c.root) || c.timeline !== model.timeline
    || c.transport !== model.transport || c.nodes !== model.graph.nodes) {
    c = build(host, model, position);
    cache.set(host, c);
  }
  const setPlayhead = (p) => {
    const pos = positionOf(p);
    if (pos === c.lastPos) return;
    c.lastPos = pos;
    c.head.style.left = pct(pos, c.span);
    c.time.textContent = formatClock(pos);
  };
  setPlayhead(position);
  return {
    element: c.root,
    setPlayhead,
    /** Accessible name refreshed on demand (not per frame). */
    describe: () => c.root.setAttribute('aria-label', compactSummary(c.model, c.lastPos || 0)),
    destroy() {
      cache.delete(host);
      c.root.remove();
    },
  };
}
