// Studio timeline details panel (spec §100, §141: "every drag has a semantic input fallback";
// plan V417, V420, V428). One panel below the timeline edits whichever object Enter, a
// double-click or a toolbar button opened: a clip (start, duration, track, target, time base,
// type), an automation point (time, value in the lane's unit, curve), a marker (time, kind,
// label), the loop region, or the forms that add a track or an automation lane. Fields commit on
// `change` through the same actions and helpers as the pointer path; refusals are shown in the
// panel's status line and announced. Escape closes it and returns focus to the object (§142).
//
//   createDetails(api, container) -> { open(kind, id), close({ restore }), isOpen(), refresh() }

import { NODE_REGISTRY } from '../../studio/registry.js';
import { MARKER_KINDS } from '../../studio/schema.js';
import { automateParameter } from '../../studio/automation.js';
import {
  MARKER_LABELS, findClip, loopAroundClips, moveClipResult, normalizeLoopBounds,
  resizeClipResult,
} from '../../studio/timeline.js';
import {
  automatableTargets, curveChoices, laneInfo, parseValueText,
} from './automation-view.js';
import {
  blockTypeOptions, clipText, clipTargetOptions, clipView, compatibleTracks, eventActionOptions,
  measurementActionOptions, parseSecondsText, trackTargetOptions,
} from './timeline-view.js';
import { el, selectBox, spriteIcon } from './timeline-dom.js';

let seq = 0;

export function createDetails(api, container) {
  const uid = `osc-stl-d${++seq}`;
  let current = null; // { kind, id, returnKey, sync(model) }

  const say = (t) => api.say(t);
  const status = el('p', { class: 'osc-stl-dstatus', role: 'status', 'data-osc':
    'studio.tl.details-status' });
  const setStatus = (text, bad = false) => {
    status.textContent = text || '';
    if (bad) status.dataset.bad = 'true';
    else delete status.dataset.bad;
  };

  /** A labelled field: { row, input }. */
  function field(key, label, input) {
    const id = `${uid}-${key}`;
    const control = input.tagName === 'DIV' ? input.querySelector('select') : input;
    control.id = id;
    control.dataset.field = key;
    return el('div', { class: 'osc-stl-field' }, [
      el('label', { class: 'osc-label', for: id }, [label]), input]);
  }
  const numberInput = (attrs = {}) => el('input', { class: 'osc-number osc-stl-input',
    type: 'text', inputmode: 'decimal', autocomplete: 'off', spellcheck: 'false', ...attrs });
  const textInput = (attrs = {}) => el('input', { class: 'osc-number osc-stl-input',
    type: 'text', autocomplete: 'off', spellcheck: 'false', ...attrs });
  const button = (key, label, onClick, icon = null, extra = {}) => el('button', { type: 'button',
    class: 'osc-btn osc-btn-secondary osc-stl-dbtn', 'data-osc': `studio.tl.d-${key}`,
    on: { click: onClick }, ...extra }, icon ? [icon, label] : [label]);
  const setIfIdle = (input, value) => {
    if (document.activeElement !== input) input.value = value;
  };

  function frame(title, fields, actions) {
    container.replaceChildren(
      el('div', { class: 'osc-stl-dhead' }, [
        el('h3', { class: 'osc-panel-title osc-stl-dtitle', id: `${uid}-title` }, [title]),
        el('span', { class: 'osc-spacer' }),
        el('button', { type: 'button', class: 'osc-icon-btn osc-icon-btn--sm',
          'aria-label': 'Close details', title: 'Close (Esc)', 'data-osc': 'studio.tl.d-close',
          on: { click: () => close({ restore: true }) } }, [spriteIcon('i-close')]),
      ]),
      el('div', { class: 'osc-stl-dfields' }, fields),
      actions && actions.length ? el('div', { class: 'osc-stl-dacts' }, actions) : null,
      status,
    );
    container.setAttribute('aria-labelledby', `${uid}-title`);
    container.hidden = false;
    setStatus('');
  }

  /** Commit an action from a field; the status line carries the refusal (§87 reasons). */
  function commitFrom(res, input) {
    if (!res.ok) {
      setStatus(res.reason, true);
      say(`Not done: ${res.reason}`);
      if (current) current.sync(api.model(), true);
      return null;
    }
    if (!res.action) {
      if (current) current.sync(api.model(), true);
      return null;
    }
    const r = api.commit(res.action);
    if (!r.ok) setStatus(r.reason, true);
    else setStatus(res.reason || '', !!res.reason);
    if (current) current.sync(api.model(), true);
    if (input) input.focus();
    return r;
  }

  // ------------------------------------------------------------ clip (§141)

  function clipForm(clipId) {
    const model = api.model();
    const clip = findClip(model, clipId);
    if (!clip) return false;
    const start = numberInput({ 'aria-describedby': `${uid}-unit-s` });
    const duration = numberInput();
    const track = selectBox(compatibleTracks(model, clip).map((t) => ({ id: t.id,
      label: t.name })), clip.trackId);
    const targets = [{ id: '', label: 'Track target' },
      ...clipTargetOptions(model, clip.kind).map((n) => ({ id: n.id, label: n.name }))];
    const target = selectBox(targets, clip.target || '');
    const timeBase = selectBox([{ id: 'absolute', label: 'Seconds (absolute)' },
      { id: 'tempo', label: 'Tempo-linked' }], clip.musical ? 'tempo' : 'absolute');
    if (clip.kind === 'measurement') timeBase.querySelector('select').disabled = true;
    const typeOpts = clip.kind === 'pattern' ? blockTypeOptions()
      : clip.kind === 'event' ? eventActionOptions() : measurementActionOptions();
    const type = selectBox(typeOpts, clip.kind === 'pattern' ? clip.payload.blockType
      : (clip.payload.action || 'gate'));

    start.addEventListener('change', () => {
      const v = parseSecondsText(start.value);
      if (v === null) return commitFrom({ ok: false, reason: 'Enter a time in seconds.' });
      return commitFrom(moveClipResult(api.model(), clipId, { start: v,
        snap: { mode: 'off' } }), start);
    });
    duration.addEventListener('change', () => {
      const v = parseSecondsText(duration.value);
      const c = findClip(api.model(), clipId);
      if (v === null || !c) {
        return commitFrom({ ok: false, reason: 'Enter a duration in seconds.' });
      }
      return commitFrom(resizeClipResult(api.model(), clipId, { edge: 'end', time: c.start + v,
        snap: { mode: 'off' } }), duration);
    });
    track.querySelector('select').addEventListener('change', (e) => commitFrom(
      moveClipResult(api.model(), clipId, { trackId: e.target.value, snap: { mode: 'off' } }),
      e.target));
    target.querySelector('select').addEventListener('change', (e) => commitFrom({ ok: true,
      action: { type: 'CLIP_UPDATE', clipId, target: e.target.value || null } }, e.target));
    timeBase.querySelector('select').addEventListener('change', (e) => commitFrom({ ok: true,
      action: { type: 'CLIP_SET_TIME_BASE', clipId, timeBase: e.target.value } }, e.target));
    type.querySelector('select').addEventListener('change', (e) => {
      const c = findClip(api.model(), clipId);
      const payload = c.kind === 'pattern' ? { blockType: e.target.value }
        : { ...c.payload, action: e.target.value };
      commitFrom({ ok: true, action: { type: 'CLIP_UPDATE', clipId, payload } }, e.target);
    });

    const title = () => {
      const c = findClip(api.model(), clipId);
      const t = c ? clipText(c) : { label: 'Clip', detail: '' };
      return `Clip · ${t.label}${t.detail ? ` ${t.detail}` : ''}`;
    };
    frame(title(), [
      field('start', 'Start (s)', start),
      field('duration', 'Duration (s)', duration),
      field('track', 'Track', track),
      field('target', 'Target', target),
      field('timebase', 'Time base', timeBase),
      field('type', clip.kind === 'pattern' ? 'Block' : 'Action', type),
      el('span', { class: 'osc-sr-only', id: `${uid}-unit-s` }, ['seconds']),
    ], [
      button('duplicate', 'Duplicate', () => api.clipCommand('duplicate', clipId)),
      button('split', 'Split at playhead', () => api.clipCommand('split', clipId)),
      button('delete', 'Delete', () => api.clipCommand('delete', clipId), spriteIcon('i-trash')),
    ]);
    current = { kind: 'clip', id: clipId, returnKey: `clip:${clipId}`,
      sync(m, keepStatus = false) {
        const c = findClip(m, clipId);
        if (!c) return false;
        setIfIdle(start, c.start.toFixed(3));
        setIfIdle(duration, c.duration.toFixed(3));
        track.querySelector('select').value = c.trackId;
        target.querySelector('select').value = c.target || '';
        timeBase.querySelector('select').value = c.musical ? 'tempo' : 'absolute';
        type.querySelector('select').value = c.kind === 'pattern' ? c.payload.blockType
          : (c.payload.action || 'gate');
        container.querySelector(`#${uid}-title`).textContent = title();
        if (!keepStatus) {
          const v = clipView(m, c);
          setStatus(v.problems.join(' '), v.problems.length > 0);
        }
        return true;
      } };
    current.sync(model);
    return true;
  }

  // ------------------------------------------------------------ automation point (§100)

  function pointForm(ref) {
    const [laneId, pointId] = ref.split(':');
    const model = api.model();
    const lane = model.timeline.automation.find((l) => l.id === laneId);
    const info = lane ? laneInfo(model, lane, { sampleRate: api.sampleRate() }) : null;
    if (!info || !lane.points.some((p) => p.id === pointId)) return false;
    const time = numberInput();
    const value = textInput({ 'aria-describedby': `${uid}-vhint` });
    const curve = selectBox(curveChoices(info.def), 'linear');
    const commitPoint = (patch, input) => commitFrom(api.pointEdit(laneId, pointId, patch), input);
    time.addEventListener('change', () => {
      const v = parseSecondsText(time.value);
      if (v === null) return commitFrom({ ok: false, reason: 'Enter a time in seconds.' });
      return commitPoint({ time: v }, time);
    });
    value.addEventListener('change', () => {
      const v = parseValueText(value.value, info.scale);
      if (v === null) {
        return commitFrom({ ok: false, reason: `Enter a value such as ${info.scale.format(
          info.scale.fromNormalized(0.5))}.` });
      }
      return commitPoint({ value: v }, value);
    });
    curve.querySelector('select').addEventListener('change',
      (e) => commitPoint({ curve: e.target.value }, e.target));
    frame(`Point · ${info.name}`, [
      field('time', 'Time (s)', time),
      field('value', `Value (${info.scale.kind === 'db' ? 'dB' : info.scale.unit || 'value'})`,
        value),
      field('curve', 'Curve into this point', curve),
      el('span', { class: 'osc-sr-only', id: `${uid}-vhint` }, [`Range ${info.bottom} to `
        + `${info.top}`]),
    ], [
      button('delete', 'Delete point', () => api.pointCommand('delete', laneId, pointId),
        spriteIcon('i-trash')),
    ]);
    current = { kind: 'point', id: ref, returnKey: `pt:${laneId}:${pointId}`,
      sync(m) {
        const l = m.timeline.automation.find((x) => x.id === laneId);
        const i = l ? l.points.findIndex((p) => p.id === pointId) : -1;
        if (i < 0) return false;
        const p = l.points[i];
        setIfIdle(time, p.time.toFixed(3));
        setIfIdle(value, info.scale.format(p.value));
        const sel = curve.querySelector('select');
        sel.value = p.curve;
        sel.disabled = i === 0;
        sel.title = i === 0 ? 'The first point starts the lane; its curve has no effect.' : '';
        return true;
      } };
    current.sync(model);
    return true;
  }

  // ------------------------------------------------------------ marker (§96)

  function markerForm(markerId) {
    const model = api.model();
    if (!model.timeline.markers.some((m) => m.id === markerId)) return false;
    const time = numberInput();
    const kind = selectBox(MARKER_KINDS.map((k) => ({ id: k, label: MARKER_LABELS[k] })),
      'custom');
    const label = textInput({ maxlength: '64' });
    time.addEventListener('change', () => {
      const v = parseSecondsText(time.value);
      if (v === null || v < 0) {
        return commitFrom({ ok: false, reason: 'Enter a time of 0 s or later.' });
      }
      return commitFrom({ ok: true, action: { type: 'MARKER_MOVE', markerId, time: v } }, time);
    });
    kind.querySelector('select').addEventListener('change', (e) => commitFrom({ ok: true,
      action: { type: 'MARKER_MOVE', markerId, kind: e.target.value } }, e.target));
    label.addEventListener('change', () => commitFrom({ ok: true,
      action: { type: 'MARKER_MOVE', markerId, label: label.value.trim() } }, label));
    frame('Marker', [
      field('time', 'Time (s)', time), field('kind', 'Kind', kind),
      field('label', 'Label', label),
    ], [
      button('delete', 'Delete marker', () => api.markerCommand('delete', markerId),
        spriteIcon('i-trash')),
    ]);
    current = { kind: 'marker', id: markerId, returnKey: `marker:${markerId}`,
      sync(m) {
        const mk = m.timeline.markers.find((x) => x.id === markerId);
        if (!mk) return false;
        setIfIdle(time, mk.time.toFixed(3));
        kind.querySelector('select').value = mk.kind;
        setIfIdle(label, mk.label);
        return true;
      } };
    current.sync(model);
    return true;
  }

  // ------------------------------------------------------------ loop region (§95)

  function loopForm() {
    const enabled = selectBox([{ id: 'on', label: 'On' }, { id: 'off', label: 'Off' }], 'off');
    const start = numberInput();
    const end = numberInput();
    const setLoop = (patch, input) => {
      const r = api.setLoop(patch);
      if (r && !r.ok) setStatus(r.reason, true);
      else setStatus('');
      if (current) current.sync(api.model());
      if (input) input.focus();
    };
    enabled.querySelector('select').addEventListener('change',
      (e) => setLoop({ enabled: e.target.value === 'on' }, e.target));
    const bounds = () => {
      const a = parseSecondsText(start.value);
      const b = parseSecondsText(end.value);
      if (a === null || b === null) {
        setStatus('Enter the loop start and end in seconds.', true);
        return null;
      }
      return normalizeLoopBounds(a, b);
    };
    start.addEventListener('change', () => {
      const b = bounds();
      if (b) setLoop(b, start);
    });
    end.addEventListener('change', () => {
      const b = bounds();
      if (b) setLoop(b, end);
    });
    frame('Loop region', [
      field('enabled', 'Loop', enabled), field('start', 'Start (s)', start),
      field('end', 'End (s)', end),
    ], [
      button('loop-fit', 'Fit selected clips', () => {
        const fit = loopAroundClips(api.model(), api.selection().clips);
        if (!fit) {
          setStatus('Select one or more clips first.', true);
          return;
        }
        setLoop({ ...fit, enabled: true });
      }),
    ]);
    current = { kind: 'loop', id: 'loop', returnKey: 'loop:start',
      sync(m) {
        const l = m.timeline.loop;
        enabled.querySelector('select').value = l.enabled ? 'on' : 'off';
        setIfIdle(start, l.start.toFixed(3));
        setIfIdle(end, l.end.toFixed(3));
        return true;
      } };
    current.sync(api.model());
    return true;
  }

  // ------------------------------------------------------------ add a track

  function trackForm() {
    const model = api.model();
    const kind = selectBox([{ id: 'event', label: 'Event (patterns, gates)' },
      { id: 'measurement', label: 'Measurement' }], 'event');
    const target = selectBox([], '');
    const name = textInput({ maxlength: '64', placeholder: `Track ${model.timeline.tracks.length
      + 1}` });
    const fill = () => {
      const k = kind.querySelector('select').value;
      const sel = target.querySelector('select');
      sel.replaceChildren(...[{ id: '', label: 'No target' },
        ...trackTargetOptions(api.model(), k, NODE_REGISTRY)]
        .map((o) => el('option', { value: o.id, text: o.label || o.name })));
    };
    kind.querySelector('select').addEventListener('change', fill);
    fill();
    const add = () => {
      const action = { type: 'TRACK_ADD', kind: kind.querySelector('select').value,
        target: target.querySelector('select').value || null };
      if (name.value.trim()) action.name = name.value.trim();
      const r = api.commit(action);
      if (r.ok) {
        close({ restore: false });
        const id = r.created && r.created.tracks ? r.created.tracks[0] : null;
        if (id) api.focusKey(`track-add:${id}`);
      } else setStatus(r.reason, true);
    };
    frame('Add track', [
      field('kind', 'Kind', kind), field('target', 'Target', target),
      field('name', 'Name', name),
    ], [button('add', 'Add track', add, spriteIcon('i-plus'), { class:
      'osc-btn osc-btn-primary osc-stl-dbtn' })]);
    current = { kind: 'track', id: 'new', returnKey: 'tool:track', sync: () => true };
    return true;
  }

  // ------------------------------------------------------------ automate (§102)

  function automateForm() {
    const targets = automatableTargets(api.model());
    if (!targets.length) {
      say('No node in this Studio has a parameter that can be automated.');
      return false;
    }
    const node = selectBox(targets.map((t) => ({ id: t.id, label: t.name })), targets[0].id);
    const param = selectBox([], '');
    const fill = () => {
      const t = automatableTargets(api.model()).find((x) => x.id
        === node.querySelector('select').value);
      param.querySelector('select').replaceChildren(...(t ? t.params : []).map((p) => el('option',
        { value: p.key, text: `${p.label}${p.laned ? ' (has a lane)' : ''}` })));
    };
    node.querySelector('select').addEventListener('change', fill);
    fill();
    const go = () => {
      const nodeId = node.querySelector('select').value;
      const key = param.querySelector('select').value;
      const res = automateParameter(api.model(), nodeId, key, api.playheadPosition());
      if (res.reason) {
        setStatus(res.reason, true);
        return;
      }
      if (res.reveal) {
        close({ restore: false });
        api.revealLane(res.reveal);
        return;
      }
      const r = api.commit(res.action);
      if (!r.ok) {
        setStatus(r.reason, true);
        return;
      }
      close({ restore: false });
      const lane = api.model().timeline.automation.find((l) => l.target.node === nodeId
        && l.target.param === key);
      if (lane) api.revealLane(lane.id);
    };
    frame('Automate a parameter', [
      field('node', 'Node', node), field('param', 'Parameter', param),
    ], [button('automate', 'Show lane', go, null, { class:
      'osc-btn osc-btn-primary osc-stl-dbtn' })]);
    current = { kind: 'automate', id: 'new', returnKey: 'tool:automate', sync: () => true };
    return true;
  }

  // ------------------------------------------------------------ public

  const FORMS = { clip: clipForm, point: pointForm, marker: markerForm, loop: loopForm,
    track: trackForm, automate: automateForm };

  function open(kind, id) {
    const make = FORMS[kind];
    if (!make || !make(id)) return false;
    container.dataset.kind = kind;
    const first = container.querySelector('input, select');
    if (first) first.focus();
    return true;
  }

  function close({ restore = true } = {}) {
    if (!current) return false;
    const key = current.returnKey;
    current = null;
    container.hidden = true;
    container.replaceChildren();
    delete container.dataset.kind;
    if (restore) api.focusKey(key);
    return true;
  }

  /** After a model change: refresh the fields, or close when the object is gone. */
  function refresh() {
    if (!current) return;
    if (!current.sync(api.model(), true)) close({ restore: false });
  }

  return { open, close, refresh, isOpen: () => !!current, current: () => current };
}
