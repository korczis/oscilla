// Studio Inspector (spec §73, §78-§80, §102-§104, §140-§141, §170-§176). The contextual editor of
// the primary selection, generated from the registry's parameter schemas (key, label, type,
// range, step, unit, scale, options, automatable, modulatable). Every edit is a store action
// (NODE_PARAM_SET, NODE_RENAME, NODE_MOVE, EDGE_UPDATE, CLIP_MOVE, CLIP_RESIZE,
// AUTOMATION_POINT_ADD, METADATA_SET): model → runtime → every projection (§80); nothing here
// touches an AudioParam. A slider drag is one history entry (store gesture, §50).
//
//   inspectorView(model, selection, opts) -> view           pure (unit-tested)
//     kind 'studio' (nothing selected) | 'node' | 'multi' | 'edge' | 'clip' | 'point'
//   formatParamValue(p, v), parseParamInput(p, text), sliderRange(p), valueToSlider(p, v),
//   sliderToValue(p, pos)                                   pure helpers of the fields
//   mountInspector(host, svc) -> { render(), destroy() }    DOM (graph-dom.js, no innerHTML)
//     svc: { store, registry, announce(text, { assertive }), status() -> Map, warnings() -> Map,
//            onConnect(nodeId), onSavePatch(nodeIds), onDelete(), onDuplicate(), focusGraph() }

import { NODE_REGISTRY, validateParamValue } from '../../studio/registry.js';
import { PORT_VISUALS } from '../../studio/ports.js';
import { describeEdge, summarizeGraph, announceAction } from '../../studio/a11y.js';
import { formatFrequency, parseFrequency } from '../../core/frequency.js';
import { sig } from '../../core/math.js';
import { CATEGORY_LABELS, STATUS_LABELS, nodeConnections } from './graph-view.js';
import { h, replaceChildren, setAttr, setText } from './graph-dom.js';
import { sliderFill } from '../app.js';

export const SLIDER_STEPS = 1000;

const finite = (v) => typeof v === 'number' && Number.isFinite(v);

/** The display text of a parameter value with its unit ("2.40 kHz", "0.707", "Low-pass"). */
export function formatParamValue(p, v) {
  switch (p.type) {
    case 'boolean': return v ? 'On' : 'Off';
    case 'enum': {
      const o = (p.options || []).find((x) => x[0] === v);
      return o ? o[1] : String(v);
    }
    case 'list': return Array.isArray(v) ? v.map((x) => sig(x, 4)).join(', ') : '';
    case 'id': return v === null || v === undefined ? 'None' : `${String(v).slice(0, 12)}…`;
    default:
      if (!finite(v)) return '—';
      if (p.unit === 'Hz') return formatFrequency(v);
      return p.unit ? `${sig(v, 4)} ${p.unit}` : sig(v, 4);
  }
}

/**
 * Parse what was typed into a parameter field. Frequencies accept "2400", "2.4k", "2.4 kHz";
 * other numbers may carry their unit ("120 ms" is not converted: the unit must match). Returns
 * { ok: true, value } or { ok: false, error } with the registry's own range text.
 */
export function parseParamInput(p, text) {
  const raw = String(text ?? '').trim();
  const fail = (why) => ({ ok: false, error: `${p.label} ${why}.` });
  let value;
  if (p.type === 'number' || p.type === 'integer') {
    if (p.unit === 'Hz') {
      const r = parseFrequency(raw);
      if (!r.ok) return { ok: false, error: r.error };
      value = r.value;
    } else {
      const unit = p.unit ? p.unit.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') : null;
      const stripped = unit ? raw.replace(new RegExp(`\\s*${unit}$`, 'i'), '') : raw;
      if (!/^[+-]?(\d+(\.\d*)?|\.\d+)(e[+-]?\d+)?$/i.test(stripped.replace(',', '.'))) {
        return fail('must be a number');
      }
      value = Number(stripped.replace(',', '.'));
    }
  } else if (p.type === 'list') {
    const parts = raw.split(/[,;\s]+/).filter(Boolean);
    value = parts.map((x) => Number(x.replace(',', '.')));
    if (value.some((x) => !finite(x))) return fail('must be numbers separated by commas');
  } else {
    return fail('cannot be typed');
  }
  const why = validateParamValue(p, value);
  return why ? fail(why) : { ok: true, value };
}

/** The slider's range: the parameter's soft (display) range, else its full range. */
export function sliderRange(p) {
  const lo = p.softRange ? p.softRange[0] : p.min;
  const hi = p.softRange ? p.softRange[1] : p.max;
  return { lo, hi, log: p.scale === 'log' && lo > 0 };
}

/** Slider position 0..SLIDER_STEPS of a value (clamped to the slider range). */
export function valueToSlider(p, v) {
  const { lo, hi, log } = sliderRange(p);
  if (!finite(v) || !(hi > lo)) return 0;
  const x = Math.min(hi, Math.max(lo, v));
  const t = log ? Math.log(x / lo) / Math.log(hi / lo) : (x - lo) / (hi - lo);
  return Math.round(t * SLIDER_STEPS);
}

/** The value of a slider position, rounded to the parameter's step (4 significant digits). */
export function sliderToValue(p, pos) {
  const { lo, hi, log } = sliderRange(p);
  const t = Math.min(1, Math.max(0, pos / SLIDER_STEPS));
  let v = log ? lo * (hi / lo) ** t : lo + (hi - lo) * t;
  if (p.type === 'integer') v = Math.round(v);
  else if (p.step) v = Math.round(v / p.step) * p.step;
  v = Number(v.toPrecision(4));
  return Math.min(p.max, Math.max(p.min, v)) + 0;
}

function nodeOf(model, id) {
  return model.graph.nodes.find((n) => n.id === id) || null;
}

function fieldOf(model, node, p, registry) {
  const value = node.params[p.key];
  const lane = model.timeline.automation.find((l) => l.target.node === node.id
    && l.target.param === p.key);
  const mods = model.graph.edges.filter((e) => e.to.node === node.id && e.to.port === p.key)
    .map((e) => describeEdge(model, e.id, { registry }));
  const control = p.type === 'enum' ? 'select' : p.type === 'boolean' ? 'toggle'
    : p.type === 'id' ? 'readonly' : p.type === 'list' ? 'list' : 'number';
  return {
    key: p.key,
    label: p.label,
    type: p.type,
    control,
    value,
    text: formatParamValue(p, value),
    input: p.type === 'list' ? (value || []).join(', ')
      : finite(value) ? String(Number(value.toPrecision(6))) : '',
    unit: p.unit || '',
    min: p.min,
    max: p.max,
    slider: control === 'number' ? valueToSlider(p, value) : null,
    options: (p.options || []).map(([v, l]) => ({ value: v, label: l })),
    automatable: !!p.automatable,
    modulatable: !!p.modulatable,
    automated: !!lane,
    laneId: lane ? lane.id : null,
    modulatedBy: mods,
    param: p,
  };
}

/**
 * The Inspector view of the selection (§78): the primary node (the last selected), a
 * connection, a clip or automation point, several nodes, or the Studio itself.
 * opts: { registry, status: Map id -> { status, reason }, warnings: Map id -> [text] }.
 */
export function inspectorView(model, selection, opts = {}) {
  const registry = opts.registry || NODE_REGISTRY;
  const sel = selection || {};
  const nodes = (sel.nodes || []).filter((id) => nodeOf(model, id));
  const edges = sel.edges || [];
  const clips = sel.clips || [];
  if (nodes.length > 1) {
    return { kind: 'multi', key: `multi:${nodes.join(',')}`, ids: nodes,
      count: nodes.length, names: nodes.map((id) => nodeOf(model, id).metadata.name),
      title: `${nodes.length} nodes` };
  }
  if (nodes.length === 1) {
    const node = nodeOf(model, nodes[0]);
    const def = registry.get(node.type);
    const st = opts.status && opts.status.get(node.id);
    const warn = (opts.warnings && opts.warnings.get(node.id)) || [];
    const fields = def ? def.params.map((p) => fieldOf(model, node, p, registry)) : [];
    return {
      kind: 'node',
      key: `node:${node.id}:${fields.map((f) => f.key).join(',')}`,
      id: node.id,
      title: node.metadata.name,
      name: node.metadata.name,
      typeLabel: def ? def.displayName : node.type,
      categoryLabel: def ? CATEGORY_LABELS[def.category] : 'Unknown',
      help: def ? def.help : null,
      status: st ? st.status : null,
      statusLabel: st ? STATUS_LABELS[st.status] || null : null,
      reason: st && st.reason ? st.reason : null,
      warnings: warn,
      position: { x: node.position.x, y: node.position.y },
      fields,
      connections: nodeConnections(model, node.id, registry),
      hasOutputs: !!(def && def.outputs.length),
    };
  }
  if (edges.length) {
    const e = model.graph.edges.find((x) => x.id === edges[edges.length - 1]);
    if (e) {
      const a = nodeOf(model, e.from.node);
      const b = nodeOf(model, e.to.node);
      const src = registry.port(a.type, e.from.port, 'out');
      const tgt = registry.port(b.type, e.to.port, 'in');
      const control = src.type === 'CONTROL';
      const unit = tgt.param ? (e.props.mapping === 'log' ? 'octaves' : tgt.param.unit) : '';
      return {
        kind: 'edge',
        key: `edge:${e.id}:${control ? 'c' : 'a'}`,
        id: e.id,
        title: 'Connection',
        text: describeEdge(model, e.id, { registry }),
        fromNode: a.id,
        toNode: b.id,
        fromText: `${a.metadata.name} / ${src.label}`,
        toText: `${b.metadata.name} / ${tgt.label}`,
        signalType: src.type,
        signalNoun: PORT_VISUALS[src.type].noun,
        cable: PORT_VISUALS[src.type].cable,
        role: tgt.role,
        muted: !!e.props.muted,
        control,
        props: { ...e.props },
        unit,
        logAllowed: !!(tgt.param && tgt.param.mapping === 'log'),
        linearDepth: (() => {
          const pd = tgt.param ? registry.param(b.type, tgt.param.key) : null;
          return pd && finite(pd.modDepth) ? pd.modDepth : 1;
        })(),
      };
    }
  }
  if (clips.length) {
    const c = model.timeline.clips.find((x) => x.id === clips[clips.length - 1]);
    if (c) {
      const track = model.timeline.tracks.find((t) => t.id === c.trackId);
      const target = nodeOf(model, c.target || (track && track.target));
      return {
        kind: 'clip',
        key: `clip:${c.id}`,
        id: c.id,
        title: `${c.kind[0].toUpperCase()}${c.kind.slice(1)} clip`,
        clipKind: c.kind,
        start: c.start,
        duration: c.duration,
        trackId: c.trackId,
        tracks: model.timeline.tracks.map((t) => ({ id: t.id, name: t.name, kind: t.kind })),
        targetName: target ? target.metadata.name : 'No target',
        detail: c.kind === 'pattern' ? c.payload.blockType : c.kind === 'measurement'
          ? c.payload.action : (c.payload && c.payload.action) || 'gate',
      };
    }
  }
  if ((sel.points || []).length) {
    const pid = sel.points[sel.points.length - 1];
    for (const lane of model.timeline.automation) {
      const pt = lane.points.find((x) => x.id === pid);
      if (!pt) continue;
      const node = nodeOf(model, lane.target.node);
      const p = node ? registry.param(node.type, lane.target.param) : null;
      return {
        kind: 'point',
        key: `point:${pt.id}`,
        id: pt.id,
        laneId: lane.id,
        title: 'Automation point',
        laneText: `${node ? node.metadata.name : lane.target.node} ${p ? p.label : ''}`.trim(),
        time: pt.time,
        valueText: p ? formatParamValue(p, pt.value) : String(pt.value),
        curve: pt.curve,
      };
    }
  }
  return {
    kind: 'studio',
    key: 'studio',
    title: model.metadata.title,
    summary: summarizeGraph(model, { registry }),
    counts: { nodes: model.graph.nodes.length, edges: model.graph.edges.length,
      clips: model.timeline.clips.length, lanes: model.timeline.automation.length },
  };
}

// ---------------------------------------------------------------- DOM

/** Mount the Inspector into `host`. */
export function mountInspector(host, svc) {
  const registry = svc.registry || NODE_REGISTRY;
  let current = null; // the rendered view key
  let refs = new Map(); // field key -> { input, slider, readout, error, field }
  let gestureOpen = false;

  const dispatch = (action) => {
    const r = svc.store.dispatch(action);
    const text = announceAction(r);
    if (text) svc.announce(text, { assertive: !r.ok });
    return r;
  };

  function endSliderGesture() {
    if (!gestureOpen) return;
    gestureOpen = false;
    const r = svc.store.endGesture();
    if (r && r.label) svc.announce(`${r.label.replace(/^Change /, 'Changed ')}`);
  }

  function showError(ref, text) {
    if (!ref || !ref.error) return;
    setText(ref.error, text || '');
    ref.error.hidden = !text;
    if (ref.input) setAttr(ref.input, 'aria-invalid', text ? 'true' : null);
  }

  // ---------------------------------------------------------------- field builders
  function numberField(view, f) {
    const id = `osc-si-${view.id}-${f.key}`;
    const input = h('input', { class: 'osc-number osc-si-input osc-num', id, type: 'text',
      inputmode: 'decimal', autocomplete: 'off', spellcheck: 'false', 'data-key': f.key,
      'data-osc': 'studio.inspector.param', value: f.input,
      'aria-describedby': `${id}-err` });
    const slider = h('input', { class: 'osc-slider osc-si-slider', type: 'range',
      min: 0, max: SLIDER_STEPS, step: 1, value: f.slider, 'data-key': f.key,
      'aria-label': `${f.label} slider`, 'aria-valuetext': f.text });
    slider.style.setProperty('--osc-fill', sliderFill(slider));
    const readout = h('span', { class: 'osc-si-readout osc-num', text: f.text });
    const error = h('p', { class: 'osc-si-error', id: `${id}-err`, hidden: true });
    const ref = { input, slider, readout, error, field: f };
    input.addEventListener('change', () => {
      const r = parseParamInput(f.param, input.value);
      if (!r.ok) {
        showError(ref, r.error);
        svc.announce(r.error, { assertive: true });
        return;
      }
      const res = dispatch({ type: 'NODE_PARAM_SET', nodeId: view.id, key: f.key,
        value: r.value });
      showError(ref, res.ok ? '' : res.reason);
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        input.value = ref.field.input;
        showError(ref, '');
      }
    });
    slider.addEventListener('input', () => {
      if (!gestureOpen) {
        svc.store.beginGesture();
        gestureOpen = true;
      }
      const value = sliderToValue(f.param, Number(slider.value));
      const res = svc.store.dispatch({ type: 'NODE_PARAM_SET', nodeId: view.id, key: f.key,
        value });
      if (!res.ok) showError(ref, res.reason);
    });
    slider.addEventListener('change', endSliderGesture);
    slider.addEventListener('pointerup', endSliderGesture);
    slider.addEventListener('blur', endSliderGesture);
    refs.set(f.key, ref);
    return h('div', { class: 'osc-si-field', 'data-field': f.key }, [
      h('div', { class: 'osc-si-row' }, [
        h('label', { class: 'osc-label osc-si-label', for: id, text: f.label }),
        readout,
      ]),
      h('div', { class: 'osc-si-row osc-si-row--edit' }, [input,
        f.unit ? h('span', { class: 'osc-si-unit', text: f.unit }) : null]),
      slider,
      error,
      fieldNotes(view, f),
    ]);
  }

  function fieldNotes(view, f) {
    const notes = [];
    if (f.modulatedBy.length) {
      notes.push(h('p', { class: 'osc-si-note', text: `Modulated: ${f.modulatedBy.join('; ')}` }));
    }
    if (f.automatable) {
      notes.push(h('button', { type: 'button', class: 'osc-btn osc-btn-secondary osc-si-auto',
        'data-osc': 'studio.inspector.automate', 'data-key': f.key,
        'aria-pressed': f.automated ? 'true' : 'false',
        text: f.automated ? 'Automated · show lane' : 'Automate',
        onClick: () => automate(view, ref(f.key)) }));
    }
    return notes.length ? h('div', { class: 'osc-si-notes' }, notes) : null;
  }

  const ref = (key) => refs.get(key);

  function automate(view, r) {
    const f = r ? r.field : null;
    if (!f) return;
    const model = svc.store.getModel();
    const lane = model.timeline.automation.find((l) => l.target.node === view.id
      && l.target.param === f.key);
    if (lane) {
      svc.store.dispatch({ type: 'SELECTION_CHANGE', selection: { nodes: [view.id],
        points: lane.points.map((p) => p.id) } });
      svc.announce(`${view.name} ${f.label} automation lane shown`);
      return;
    }
    dispatch({ type: 'AUTOMATION_POINT_ADD', target: { node: view.id, param: f.key }, time: 0,
      value: f.value, curve: 'linear' });
  }

  function selectField(view, f) {
    const id = `osc-si-${view.id}-${f.key}`;
    const sel = h('select', { id, 'data-key': f.key, 'data-osc': 'studio.inspector.param' },
      f.options.map((o) => h('option', { value: o.value, text: o.label })));
    sel.value = f.value;
    sel.addEventListener('change', () => {
      dispatch({ type: 'NODE_PARAM_SET', nodeId: view.id, key: f.key, value: sel.value });
    });
    refs.set(f.key, { input: sel, field: f });
    return h('div', { class: 'osc-si-field', 'data-field': f.key }, [
      h('label', { class: 'osc-label osc-si-label', for: id, text: f.label }),
      h('div', { class: 'osc-select' }, [sel]),
    ]);
  }

  function toggleField(view, f) {
    const btn = h('button', { type: 'button', class: 'osc-toggle osc-si-toggle', role: 'switch',
      'aria-checked': f.value ? 'true' : 'false', 'data-key': f.key,
      'data-osc': 'studio.inspector.param' }, [
      h('span', { class: 'osc-toggle-track', 'aria-hidden': 'true' }),
      h('span', { class: 'osc-toggle-label', text: f.label }),
    ]);
    btn.addEventListener('click', () => {
      dispatch({ type: 'NODE_PARAM_SET', nodeId: view.id, key: f.key,
        value: btn.getAttribute('aria-checked') !== 'true' });
    });
    refs.set(f.key, { input: btn, field: f, toggle: true });
    return h('div', { class: 'osc-si-field', 'data-field': f.key }, [btn]);
  }

  function listField(view, f) {
    const id = `osc-si-${view.id}-${f.key}`;
    const input = h('input', { class: 'osc-number osc-si-input osc-num', id, type: 'text',
      autocomplete: 'off', 'data-key': f.key, 'data-osc': 'studio.inspector.param',
      value: f.input, 'aria-describedby': `${id}-err` });
    const error = h('p', { class: 'osc-si-error', id: `${id}-err`, hidden: true });
    const r = { input, error, field: f };
    input.addEventListener('change', () => {
      const p = parseParamInput(f.param, input.value);
      if (!p.ok) {
        showError(r, p.error);
        svc.announce(p.error, { assertive: true });
        return;
      }
      const res = dispatch({ type: 'NODE_PARAM_SET', nodeId: view.id, key: f.key,
        value: p.value });
      showError(r, res.ok ? '' : res.reason);
    });
    refs.set(f.key, r);
    return h('div', { class: 'osc-si-field', 'data-field': f.key }, [
      h('label', { class: 'osc-label osc-si-label', for: id, text: f.label }), input, error]);
  }

  function readonlyField(f) {
    refs.set(f.key, { field: f, readout: h('span', { class: 'osc-num', text: f.text }) });
    return h('div', { class: 'osc-si-field osc-si-row' }, [
      h('span', { class: 'osc-label osc-si-label', text: f.label }), refs.get(f.key).readout]);
  }

  function textInput(id, label, value, onChange, dataOsc) {
    const input = h('input', { class: 'osc-number osc-si-input', id, type: 'text',
      autocomplete: 'off', spellcheck: 'false', value, 'data-osc': dataOsc,
      'data-key': dataOsc });
    input.addEventListener('change', () => onChange(input.value, input));
    refs.set(dataOsc, { input, field: { input: value } });
    return h('div', { class: 'osc-si-field' }, [
      h('label', { class: 'osc-label osc-si-label', for: id, text: label }), input]);
  }

  function numberInput(id, label, value, unit, onChange, dataOsc) {
    const input = h('input', { class: 'osc-number osc-si-input osc-num', id, type: 'text',
      inputmode: 'decimal', autocomplete: 'off', value: String(value), 'data-osc': dataOsc,
      'data-key': dataOsc });
    input.addEventListener('change', () => {
      const v = Number(String(input.value).trim().replace(',', '.'));
      if (!finite(v)) {
        svc.announce(`${label} must be a number.`, { assertive: true });
        input.value = String(refs.get(dataOsc).field.input);
        return;
      }
      onChange(v, input);
    });
    refs.set(dataOsc, { input, field: { input: String(value) } });
    return h('div', { class: 'osc-si-field osc-si-field--half' }, [
      h('label', { class: 'osc-label osc-si-label', for: id, text: label }),
      h('div', { class: 'osc-si-row osc-si-row--edit' }, [input,
        unit ? h('span', { class: 'osc-si-unit', text: unit }) : null]),
    ]);
  }

  function actionButton(text, dataOsc, onClick, cls = 'osc-btn-secondary') {
    return h('button', { type: 'button', class: `osc-btn ${cls}`, 'data-osc': dataOsc, text,
      onClick });
  }

  // ---------------------------------------------------------------- views
  function header(title, sub) {
    return h('div', { class: 'osc-si-head' }, [
      h('h4', { class: 'osc-si-title', 'data-osc': 'studio.inspector.title', text: title }),
      sub ? h('p', { class: 'osc-si-sub', text: sub }) : null,
    ]);
  }

  function buildNode(view) {
    const parts = [header(view.name, `${view.typeLabel} · ${view.categoryLabel}`)];
    if (view.statusLabel || view.reason || view.warnings.length) {
      parts.push(h('p', { class: `osc-si-status${view.status === 'degraded' ? ' is-error' : ''}`,
        role: 'note', 'data-osc': 'studio.inspector.status',
        text: [view.statusLabel, view.reason, ...view.warnings.filter((w) => w !== view.reason)]
          .filter(Boolean).join(' · ') }));
    }
    parts.push(textInput(`osc-si-${view.id}-name`, 'Name', view.name, (v, input) => {
      const r = dispatch({ type: 'NODE_RENAME', nodeId: view.id, name: v });
      if (!r.ok) input.value = view.name;
    }, 'studio.inspector.name'));
    for (const f of view.fields) {
      if (f.control === 'number') parts.push(numberField(view, f));
      else if (f.control === 'select') parts.push(selectField(view, f));
      else if (f.control === 'toggle') parts.push(toggleField(view, f));
      else if (f.control === 'list') parts.push(listField(view, f));
      else parts.push(readonlyField(f));
    }
    parts.push(h('div', { class: 'osc-si-pos' }, [
      numberInput(`osc-si-${view.id}-x`, 'Position X', view.position.x, '', (v) => {
        const m = svc.store.getModel().graph.nodes.find((n) => n.id === view.id);
        if (m) dispatch({ type: 'NODE_MOVE', nodeId: view.id, position: { x: v, y: m.position.y } });
      }, 'studio.inspector.x'),
      numberInput(`osc-si-${view.id}-y`, 'Position Y', view.position.y, '', (v) => {
        const m = svc.store.getModel().graph.nodes.find((n) => n.id === view.id);
        if (m) dispatch({ type: 'NODE_MOVE', nodeId: view.id, position: { x: m.position.x, y: v } });
      }, 'studio.inspector.y'),
    ]));
    const conns = h('ul', { class: 'osc-si-conns', 'aria-label': 'Connections',
      'data-osc': 'studio.inspector.connections' }, view.connections.map((c) => h('li', {}, [
      h('button', { type: 'button', class: 'osc-si-link', 'data-edge': c.edgeId, text: c.text,
        onClick: () => svc.store.dispatch({ type: 'SELECTION_CHANGE',
          selection: { edges: [c.edgeId] } }) }),
    ])));
    parts.push(h('div', { class: 'osc-si-section' }, [
      h('h5', { class: 'osc-si-h5', text: `Connections (${view.connections.length})` }),
      view.connections.length ? conns : h('p', { class: 'osc-si-note', text: 'None yet.' }),
    ]));
    parts.push(h('div', { class: 'osc-si-actions' }, [
      view.hasOutputs ? actionButton('Connect…', 'studio.inspector.connect',
        () => svc.onConnect(view.id)) : null,
      actionButton('Duplicate', 'studio.inspector.duplicate', () => svc.onDuplicate()),
      actionButton('Save as patch…', 'studio.inspector.savePatch',
        () => svc.onSavePatch([view.id])),
      actionButton('Delete', 'studio.inspector.delete', () => svc.onDelete(),
        'osc-btn-secondary osc-si-danger'),
    ]));
    if (view.help) {
      parts.push(h('details', { class: 'osc-si-help' }, [
        h('summary', { text: `About ${view.typeLabel}` }),
        h('p', { text: view.help.what }),
        h('p', { text: `Inputs: ${view.help.inputs}` }),
        h('p', { text: `Outputs: ${view.help.outputs}` }),
        h('p', { text: view.help.constraints }),
      ]));
    }
    return parts;
  }

  function buildEdge(view) {
    const parts = [header('Connection', `${view.signalNoun[0].toUpperCase()}${
      view.signalNoun.slice(1)} · ${view.cable}`)];
    parts.push(h('dl', { class: 'osc-si-dl', 'data-osc': 'studio.inspector.edge' }, [
      h('div', {}, [h('dt', { text: 'From' }), h('dd', { text: view.fromText })]),
      h('div', {}, [h('dt', { text: 'To' }), h('dd', { text: view.toText })]),
      h('div', {}, [h('dt', { text: 'Signal' }), h('dd', { text: `${view.signalType}${
        view.role && view.role !== 'SIGNAL' ? ` · ${view.role}` : ''}` })]),
    ]));
    const mute = h('button', { type: 'button', class: 'osc-toggle osc-si-toggle', role: 'switch',
      'aria-checked': view.muted ? 'true' : 'false', 'data-osc': 'studio.inspector.mute',
      'data-key': 'muted' }, [h('span', { class: 'osc-toggle-track', 'aria-hidden': 'true' }),
      h('span', { class: 'osc-toggle-label', text: 'Muted' })]);
    mute.addEventListener('click', () => dispatch({ type: 'EDGE_UPDATE', edgeId: view.id,
      props: { muted: mute.getAttribute('aria-checked') !== 'true' } }));
    refs.set('muted', { input: mute, toggle: true, field: { value: view.muted } });
    parts.push(h('div', { class: 'osc-si-field' }, [mute]));
    if (view.control) {
      const unit = view.unit;
      parts.push(h('div', { class: 'osc-si-pos' }, [
        numberInput(`osc-si-${view.id}-depth`, 'Depth', view.props.depth, unit,
          (v) => dispatch({ type: 'EDGE_UPDATE', edgeId: view.id, props: { depth: v } }),
          'studio.inspector.depth'),
        numberInput(`osc-si-${view.id}-offset`, 'Offset', view.props.offset, unit,
          (v) => dispatch({ type: 'EDGE_UPDATE', edgeId: view.id, props: { offset: v } }),
          'studio.inspector.offset'),
      ]));
      const polarity = h('select', { id: `osc-si-${view.id}-pol`,
        'data-osc': 'studio.inspector.polarity', 'data-key': 'studio.inspector.polarity' }, [
        h('option', { value: 'bipolar', text: 'Bipolar (±depth)' }),
        h('option', { value: 'unipolar', text: 'Unipolar (0…depth)' })]);
      polarity.value = view.props.polarity;
      polarity.addEventListener('change', () => dispatch({ type: 'EDGE_UPDATE', edgeId: view.id,
        props: { polarity: polarity.value } }));
      refs.set('studio.inspector.polarity', { input: polarity, field: { value: view.props.polarity } });
      const mapping = h('select', { id: `osc-si-${view.id}-map`,
        'data-osc': 'studio.inspector.mapping', 'data-key': 'studio.inspector.mapping' }, [
        h('option', { value: 'linear', text: `Linear (${view.props.mapping === 'log' ? 'unit'
          : view.unit || 'unit'})` }),
        view.logAllowed ? h('option', { value: 'log', text: 'Logarithmic (octaves)' }) : null]);
      mapping.value = view.props.mapping;
      mapping.addEventListener('change', () => {
        // Depth units differ between the mappings: start the new one at its default depth.
        dispatch({ type: 'EDGE_UPDATE', edgeId: view.id, props: { mapping: mapping.value,
          depth: mapping.value === 'log' ? 1 : view.linearDepth, offset: 0 } });
      });
      refs.set('studio.inspector.mapping', { input: mapping, field: { value: view.props.mapping } });
      parts.push(h('div', { class: 'osc-si-field' }, [
        h('label', { class: 'osc-label osc-si-label', for: `osc-si-${view.id}-pol`,
          text: 'Polarity' }), h('div', { class: 'osc-select' }, [polarity])]));
      parts.push(h('div', { class: 'osc-si-field' }, [
        h('label', { class: 'osc-label osc-si-label', for: `osc-si-${view.id}-map`,
          text: 'Mapping' }), h('div', { class: 'osc-select' }, [mapping])]));
      parts.push(h('p', { class: 'osc-si-note', text: 'Modulation adds to the parameter’s '
        + 'automated or set value; depth belongs to this connection.' }));
    }
    parts.push(h('div', { class: 'osc-si-actions' }, [
      actionButton('Select source', 'studio.inspector.selectFrom', () => svc.store.dispatch({
        type: 'SELECTION_CHANGE', selection: { nodes: [view.fromNode] } })),
      actionButton('Select target', 'studio.inspector.selectTo', () => svc.store.dispatch({
        type: 'SELECTION_CHANGE', selection: { nodes: [view.toNode] } })),
      actionButton('Delete connection', 'studio.inspector.deleteEdge', () => svc.onDelete(),
        'osc-btn-secondary osc-si-danger'),
    ]));
    return parts;
  }

  function buildClip(view) {
    const parts = [header(view.title, `${view.detail} · ${view.targetName}`)];
    parts.push(h('div', { class: 'osc-si-pos' }, [
      numberInput(`osc-si-${view.id}-start`, 'Start', view.start, 's',
        (v) => dispatch({ type: 'CLIP_MOVE', clipId: view.id, start: v }), 'studio.inspector.start'),
      numberInput(`osc-si-${view.id}-dur`, 'Duration', view.duration, 's',
        (v) => dispatch({ type: 'CLIP_RESIZE', clipId: view.id, duration: v }),
        'studio.inspector.duration'),
    ]));
    const track = h('select', { id: `osc-si-${view.id}-track`, 'data-osc': 'studio.inspector.track',
      'data-key': 'studio.inspector.track' },
    view.tracks.map((t) => h('option', { value: t.id, text: `${t.name} (${t.kind})` })));
    track.value = view.trackId;
    track.addEventListener('change', () => dispatch({ type: 'CLIP_MOVE', clipId: view.id,
      trackId: track.value }));
    refs.set('studio.inspector.track', { input: track, field: { value: view.trackId } });
    parts.push(h('div', { class: 'osc-si-field' }, [
      h('label', { class: 'osc-label osc-si-label', for: `osc-si-${view.id}-track`,
        text: 'Track' }), h('div', { class: 'osc-select' }, [track])]));
    return parts;
  }

  function buildPoint(view) {
    return [header(view.title, view.laneText), h('dl', { class: 'osc-si-dl' }, [
      h('div', {}, [h('dt', { text: 'Time' }), h('dd', { class: 'osc-num',
        text: `${sig(view.time, 4)} s` })]),
      h('div', {}, [h('dt', { text: 'Value' }), h('dd', { class: 'osc-num',
        text: view.valueText })]),
      h('div', {}, [h('dt', { text: 'Curve' }), h('dd', { text: view.curve })]),
    ]), h('p', { class: 'osc-si-note', text: 'Edit the point on its lane in the timeline.' })];
  }

  function buildMulti(view) {
    return [header(view.title, view.names.slice(0, 6).join(', ')
      + (view.names.length > 6 ? ` and ${view.names.length - 6} more` : '')),
    h('div', { class: 'osc-si-actions' }, [
      actionButton('Duplicate', 'studio.inspector.duplicate', () => svc.onDuplicate()),
      actionButton('Save as patch…', 'studio.inspector.savePatch',
        () => svc.onSavePatch(view.ids)),
      actionButton('Delete', 'studio.inspector.delete', () => svc.onDelete(),
        'osc-btn-secondary osc-si-danger'),
    ])];
  }

  function buildStudio(view) {
    return [header('Studio', `${view.counts.nodes} nodes · ${view.counts.edges} connections · `
      + `${view.counts.clips} clips · ${view.counts.lanes} automation lanes`),
    textInput('osc-si-studio-title', 'Title', view.title, (v, input) => {
      const r = dispatch({ type: 'METADATA_SET', title: v.trim() || view.title });
      if (!r.ok) input.value = view.title;
    }, 'studio.inspector.studioTitle'),
    h('p', { class: 'osc-si-summary', 'data-osc': 'studio.inspector.summary',
      text: view.summary }),
    h('p', { class: 'osc-si-note', text: 'Select a node or a connection to edit it. Press N '
      + 'to add a node, C to connect the selected node.' })];
  }

  // ---------------------------------------------------------------- render
  function update(view) {
    const active = document.activeElement;
    if (view.kind === 'node') {
      for (const f of view.fields) {
        const r = refs.get(f.key);
        if (!r) continue;
        r.field = f;
        if (r.readout) setText(r.readout, f.text);
        if (r.toggle) setAttr(r.input, 'aria-checked', f.value ? 'true' : 'false');
        else if (r.input && r.input !== active) {
          if (r.input.tagName === 'SELECT') r.input.value = f.value;
          else r.input.value = f.input;
        }
        if (r.slider && r.slider !== active) {
          r.slider.value = String(f.slider);
          r.slider.style.setProperty('--osc-fill', sliderFill(r.slider));
        }
        if (r.slider) setAttr(r.slider, 'aria-valuetext', f.text);
      }
      const name = refs.get('studio.inspector.name');
      if (name && name.input !== active) name.input.value = view.name;
      const head = host.querySelector('[data-osc="studio.inspector.title"]');
      if (head) setText(head, view.name);
      for (const [k, v] of [['studio.inspector.x', view.position.x],
        ['studio.inspector.y', view.position.y]]) {
        const r = refs.get(k);
        if (r && r.input !== active) r.input.value = String(v);
        if (r) r.field.input = String(v);
      }
      return true;
    }
    if (view.kind === 'edge') {
      const m = refs.get('muted');
      if (m) setAttr(m.input, 'aria-checked', view.muted ? 'true' : 'false');
      for (const [k, v] of [['studio.inspector.depth', view.props.depth],
        ['studio.inspector.offset', view.props.offset]]) {
        const r = refs.get(k);
        if (r && r.input !== active) r.input.value = String(v);
        if (r) r.field.input = String(v);
      }
      const pol = refs.get('studio.inspector.polarity');
      if (pol && pol.input !== active) pol.input.value = view.props.polarity;
      const map = refs.get('studio.inspector.mapping');
      if (map && map.input !== active) map.input.value = view.props.mapping;
      return true;
    }
    if (view.kind === 'clip') {
      for (const [k, v] of [['studio.inspector.start', view.start],
        ['studio.inspector.duration', view.duration]]) {
        const r = refs.get(k);
        if (r && r.input !== active) r.input.value = String(v);
        if (r) r.field.input = String(v);
      }
      const t = refs.get('studio.inspector.track');
      if (t && t.input !== active) t.input.value = view.trackId;
      return true;
    }
    return false;
  }

  function render() {
    const model = svc.store.getModel();
    const view = inspectorView(model, svc.store.getSelection(), { registry,
      status: svc.status ? svc.status() : null, warnings: svc.warnings ? svc.warnings() : null });
    // Same target and same fields: update values in place (the focused field keeps focus and
    // what is being typed); the summary and status lines are rebuilt below.
    const sameTarget = current === view.key && view.kind !== 'studio' && view.kind !== 'multi'
      && view.kind !== 'point';
    if (sameTarget && update(view)) {
      const status = host.querySelector('[data-osc="studio.inspector.status"]');
      if (view.kind === 'node' && status) {
        setText(status, [view.statusLabel, view.reason, ...view.warnings.filter((w) =>
          w !== view.reason)].filter(Boolean).join(' · '));
      }
      if (view.kind === 'node') {
        const list = host.querySelector('[data-osc="studio.inspector.connections"]');
        if (list && list.children.length !== view.connections.length) {
          current = null;
          return render();
        }
      }
      return;
    }
    if (current === view.key && view.kind === 'studio') {
      const sum = host.querySelector('[data-osc="studio.inspector.summary"]');
      if (sum) setText(sum, view.summary);
      const t = refs.get('studio.inspector.studioTitle');
      if (t && t.input !== document.activeElement) t.input.value = view.title;
      const sub = host.querySelector('.osc-si-sub');
      if (sub) setText(sub, `${view.counts.nodes} nodes · ${view.counts.edges} connections · `
        + `${view.counts.clips} clips · ${view.counts.lanes} automation lanes`);
      return;
    }
    endSliderGesture();
    const focusedKey = host.contains(document.activeElement)
      ? document.activeElement.getAttribute('data-key') : null;
    refs = new Map();
    current = view.key;
    const builders = { node: buildNode, edge: buildEdge, clip: buildClip, point: buildPoint,
      multi: buildMulti, studio: buildStudio };
    replaceChildren(host, h('div', { class: `osc-si osc-si--${view.kind}`,
      'data-kind': view.kind }, builders[view.kind](view)));
    if (focusedKey) {
      const el = host.querySelector(`[data-key="${CSS.escape(focusedKey)}"]`);
      if (el) el.focus();
    }
  }

  return {
    render,
    /** Focus the first editable field (Enter on a node, §142). */
    focusFirst() {
      const el = host.querySelector('input, select, button');
      if (el) el.focus();
      return !!el;
    },
    destroy() {
      endSliderGesture();
      replaceChildren(host, []);
    },
  };
}
