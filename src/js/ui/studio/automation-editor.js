// Studio automation lanes in the timeline editor (spec §97-§102, §141; plan V420). One row per
// lane: the curve drawn in the parameter's own scale (§101), its points as focusable handles.
// Points are added by double-click / double-tap on the lane, by "Add point at playhead" and by
// the Automate form; moved by drag (committed at gesture end, §86) or by the keyboard; edited
// numerically in the details panel; deleted with Delete. Every change is a store action, so it
// is undoable and reaches a playing transport through its edit path (§182-§183).
//
//   createLaneEditor(api) -> { head(lane), row(lane), pointerDown(e), dblClick(e), key(cmd, el) }
// `api` is the timeline editor's internal interface (timeline-editor.js).

import { automationScale, nudgePointAction } from '../../studio/automation.js';
import { snapTime } from '../../studio/timeline.js';
import {
  LANE_HEIGHT_PX, addPointAction, fineNudge, laneAria, laneInfo, lanePath, pointAria,
  pointEdit, pointNeighbour, valueToY, yToValue,
} from './automation-view.js';
import { xToTime } from './timeline-view.js';
import { el, pathIcon, spriteIcon, svgEl } from './timeline-dom.js';

export function createLaneEditor(api) {
  const infoOf = (model, lane) => laneInfo(model, lane, { sampleRate: api.sampleRate() });

  function head(lane) {
    const model = api.model();
    const info = infoOf(model, lane);
    const name = info ? info.name : `${lane.target.node} ${lane.target.param}`;
    const add = el('button', { type: 'button', class: 'osc-icon-btn osc-icon-btn--sm osc-stl-hbtn',
      'data-key': `lane-add:${lane.id}`, 'aria-label': `Add a ${name} point at the playhead`,
      title: 'Add point at playhead',
      on: { click: () => addAt(lane.id, api.playheadPosition()) } }, [spriteIcon('i-plus')]);
    const remove = el('button', { type: 'button',
      class: 'osc-icon-btn osc-icon-btn--sm osc-stl-hbtn', 'data-key': `lane-del:${lane.id}`,
      'aria-label': `Remove the ${name} automation lane`, title: 'Remove lane',
      on: { click: () => removeLane(lane.id) } }, [spriteIcon('i-trash')]);
    return el('div', { class: 'osc-stl-hrow osc-stl-hrow--lane', 'data-row': lane.id }, [
      el('div', { class: 'osc-stl-hmain' }, [
        el('span', { class: 'osc-stl-hkind', 'aria-hidden': 'true' }, [pathIcon('lane')]),
        el('span', { class: 'osc-stl-hname', title: name }, [name]),
      ]),
      el('div', { class: 'osc-stl-hsub' }, [
        el('span', { class: 'osc-stl-chip' }, [info ? info.scaleLabel : '—']),
        el('span', { class: 'osc-stl-hrange osc-tabular', title: 'Lane range' },
          [info ? `${info.bottom} – ${info.top}` : '']),
      ]),
      el('div', { class: 'osc-stl-hacts' }, [add, remove]),
    ]);
  }

  function row(lane) {
    const model = api.model();
    const info = infoOf(model, lane);
    const pps = api.pps();
    const width = api.contentWidth();
    const r = el('div', { class: 'osc-stl-row osc-stl-row--lane', 'data-lane-id': lane.id,
      role: 'group', 'aria-label': info ? laneAria(info, lane) : 'Automation lane' });
    if (!info) return r;
    const svg = svgEl('svg', { class: 'osc-stl-lane-svg', width, height: LANE_HEIGHT_PX,
      'aria-hidden': 'true', focusable: 'false' });
    for (const tk of info.scale.ticks()) {
      const y = valueToY(tk.value, info.scale);
      if (y <= 0.5 || y >= LANE_HEIGHT_PX - 0.5) continue;
      svg.append(svgEl('line', { class: 'osc-stl-lane-grid', x1: 0, x2: width, y1: y, y2: y }));
    }
    const path = svgEl('path', { class: 'osc-stl-lane-curve', d: lanePath(lane.points,
      info.scale, { pxPerSecond: pps, to: width / pps }) });
    svg.append(path);
    r.append(svg);
    const sel = api.selection();
    lane.points.forEach((p, i) => {
      const selected = sel.points.includes(p.id);
      r.append(el('div', { class: 'osc-stl-pt', role: 'button', tabindex: '0',
        'data-key': `pt:${lane.id}:${p.id}`, 'data-lane': lane.id, 'data-point': p.id,
        'data-curve': i === 0 ? 'start' : p.curve, 'data-selected': selected ? 'true' : 'false',
        'aria-label': pointAria(info, p, i, lane.points.length, model.transport, { selected }),
        title: `${api.formatTime(p.time)} · ${info.scale.format(p.value)}`,
        style: `left:${(p.time * pps).toFixed(2)}px;top:${valueToY(p.value, info.scale)}px` }));
    });
    return r;
  }

  // ------------------------------------------------------------ actions

  function addAt(laneId, time, value = null) {
    const model = api.model();
    const res = addPointAction(model, laneId, time, { value, sampleRate: api.sampleRate() });
    if (!res.ok) {
      api.say(`Not done: ${res.reason}`);
      return null;
    }
    const r = api.commit(res.action);
    if (r.ok && r.created && r.created.points) {
      const id = r.created.points[0];
      api.select({ points: [id] });
      api.focusKey(`pt:${laneId}:${id}`);
    }
    return r;
  }

  function removeLane(laneId) {
    const lane = api.model().timeline.automation.find((l) => l.id === laneId);
    if (!lane) return;
    const info = infoOf(api.model(), lane);
    const r = api.commitMany(`Remove ${info ? info.name : 'automation'} lane`,
      lane.points.map((p) => ({ type: 'AUTOMATION_POINT_REMOVE', laneId, pointId: p.id })));
    if (r.ok) api.say(`Removed the ${info ? info.name : 'automation'} lane`);
  }

  function removePoint(laneId, pointId) {
    const lane = api.model().timeline.automation.find((l) => l.id === laneId);
    if (!lane) return;
    const next = pointNeighbour(lane, pointId);
    const r = api.commit({ type: 'AUTOMATION_POINT_REMOVE', laneId, pointId });
    if (r.ok) {
      const still = api.model().timeline.automation.find((l) => l.id === laneId);
      api.focusKey(still && next ? `pt:${laneId}:${next}` : `lane-add:${laneId}`);
    }
  }

  /** Keyboard commands on a focused point (transport-view.js keyCommand). */
  function key(cmd, node) {
    const laneId = node.dataset.lane;
    const pointId = node.dataset.point;
    const model = api.model();
    const sampleRate = api.sampleRate();
    if (cmd.cmd === 'delete') {
      removePoint(laneId, pointId);
      return true;
    }
    if (cmd.cmd === 'edit') {
      api.openDetails('point', `${laneId}:${pointId}`);
      return true;
    }
    if (cmd.cmd === 'nudge-time' || cmd.cmd === 'nudge-value') {
      const d = cmd.cmd === 'nudge-time' ? { dTime: cmd.dir } : { dValue: cmd.dir };
      const res = cmd.fine ? fineNudge(model, laneId, pointId, { ...d, sampleRate })
        : nudgePointAction(model, laneId, pointId, { ...d, large: !!cmd.large, sampleRate });
      if (!res.ok) {
        api.say(`Not done: ${res.reason}`);
        return true;
      }
      if (!res.action) return true;
      const r = api.commit(res.action, { quiet: true });
      if (r.ok) {
        const lane = api.model().timeline.automation.find((l) => l.id === laneId);
        const p = lane && lane.points.find((x) => x.id === pointId);
        const info = lane ? infoOf(api.model(), lane) : null;
        if (p && info) api.say(`${info.name} point at ${api.formatTime(p.time)}, `
          + `${info.scale.format(p.value)}`);
        api.focusKey(`pt:${laneId}:${pointId}`);
      }
      return true;
    }
    return false;
  }

  // ------------------------------------------------------------ pointer

  /** Double-click / double-tap on a lane: a point at that time and value (§100). */
  function dblClick(e) {
    const r = e.target.closest('.osc-stl-row--lane');
    if (!r || e.target.closest('.osc-stl-pt')) return false;
    const lane = api.model().timeline.automation.find((l) => l.id === r.dataset.laneId);
    const info = lane ? infoOf(api.model(), lane) : null;
    if (!info) return false;
    const box = r.getBoundingClientRect();
    const x = e.clientX - api.contentLeft();
    const t = snapTime(xToTime(x, api.pps()), api.snap(), { transport: api.model().transport });
    addAt(lane.id, t, yToValue(e.clientY - box.top, info.scale));
    return true;
  }

  /** Point drag: time and value previewed in the DOM, one AUTOMATION_POINT_MOVE at the end. */
  function pointerDown(e) {
    const node = e.target.closest('.osc-stl-pt');
    if (!node || e.button !== 0) return false;
    const laneId = node.dataset.lane;
    const pointId = node.dataset.point;
    const model = api.model();
    const lane = model.timeline.automation.find((l) => l.id === laneId);
    const info = lane ? infoOf(model, lane) : null;
    if (!info) return false;
    const rowEl = node.parentElement;
    const path = rowEl.querySelector('.osc-stl-lane-curve');
    const box = rowEl.getBoundingClientRect();
    const start = { x: e.clientX, y: e.clientY };
    const selected = api.selection().points.includes(pointId);
    let last = null;
    api.select({ points: [pointId] }, { quiet: selected });
    node.focus({ preventScroll: true });
    const pps = api.pps();
    api.beginGesture(e, node, {
      label: 'Move automation point',
      move(ev) {
        if (Math.abs(ev.clientX - start.x) < 3 && Math.abs(ev.clientY - start.y) < 3 && !last) {
          return;
        }
        const t = snapTime(xToTime(ev.clientX - api.contentLeft(), pps), api.snap(),
          { transport: model.transport });
        const v = yToValue(ev.clientY - box.top, info.scale);
        const res = pointEdit(model, laneId, pointId, { time: t, value: v },
          { sampleRate: api.sampleRate() });
        if (!res.ok) {
          node.dataset.invalid = 'true';
          api.chip(ev.clientX - api.contentLeft(), rowEl.offsetTop, res.reason, true);
          return;
        }
        delete node.dataset.invalid;
        const a = res.action || { time: undefined, value: undefined };
        const pts = lane.points.map((p) => (p.id === pointId ? { ...p,
          time: a.time ?? p.time, value: a.value ?? p.value } : p))
          .sort((x, y) => x.time - y.time);
        const moved = pts.find((p) => p.id === pointId);
        node.style.left = `${(moved.time * pps).toFixed(2)}px`;
        node.style.top = `${valueToY(moved.value, info.scale)}px`;
        path.setAttribute('d', lanePath(pts, info.scale, { pxPerSecond: pps,
          to: api.contentWidth() / pps }));
        api.chip(moved.time * pps, rowEl.offsetTop, `${api.formatTime(moved.time)} · `
          + `${info.scale.format(moved.value)}`);
        last = res;
      },
      commit() {
        if (last && last.ok && last.action) {
          api.commit(last.action, { focus: `pt:${laneId}:${pointId}` });
        } else {
          api.render(true);
        }
      },
      cancel() {
        api.render(true);
      },
    });
    return true;
  }

  return { head, row, pointerDown, dblClick, key, addAt, removePoint };
}

/** The lane scale (exported for the details editor). */
export function laneScaleOf(model, lane, sampleRate) {
  const info = laneInfo(model, lane, { sampleRate });
  return info ? info.scale : automationScale({ min: 0, max: 1 }, { sampleRate });
}
