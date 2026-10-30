// The Synth panel declaration (plan K061, K062; design §1-§4): ONE data source for the modules,
// their faces (knobs, switches, jacks), the normalling and the amount knobs. Pure: no DOM, no
// Web Audio. Every control and jack is generated from the registry's defineNode descriptors;
// a panel may only fix, relabel, narrow (a range or the options) or set initial values, each
// validated against the registry, so adding a module is one declaration entry.
//
//   definePanel(decl, registry?) -> panel   frozen; throws TypeError on an authoring error
//   panel.faceOf(moduleId)  -> [control]    control = { key, kind: 'knob' | 'switch' |
//                                           'toggle' | 'list' | 'amount', label, param, ... }
//   panel.fixedOf(moduleId) -> [{ key, label, value }]   locked badges
//   panel.jacksOf(moduleId) -> [jack]       jack = { id: 'module.port', key: 'module.port:in'
//                                           (unique: a port id may name an input and an output),
//                                           module, port, direction,
//                                           type, label, normals: [normal id] }
//   panel.resolve(model)    -> Map<module id, node | null>
//   panel.instantiate(model, { at }) -> BATCH action   one history entry, deterministic ids
//   panel.tabs -> [{ id, title, description }]   the workspace tabs a panel's modules sit on
//   panel.modulesOf(tab) -> [module]              (module.tab, default the first tab)
//
// A module's node is found by metadata.panel { id: panel.instance, module } (schema.js
// isPanelRef); a node type the Studio may hold once (Master Output) is that one node.

import { NODE_REGISTRY, validateParamValue } from '../studio/registry.js';
import { canConnect, validateEdgeProps } from '../studio/ports.js';

const fail = (panel, text) => {
  throw new TypeError(`definePanel ${panel}: ${text}`);
};
export const jackId = (module, port) => `${module}.${port}`;
export const splitJack = (id) => {
  const i = String(id).indexOf('.');
  return { module: id.slice(0, i), port: id.slice(i + 1) };
};
const KIND = { number: 'knob', integer: 'knob', enum: 'switch', boolean: 'toggle', list: 'list' };

/** The registry parameter narrowed by the panel (label, range, options), validated. */
function narrow(pid, mod, p) {
  const label = (mod.labels || {})[p.key] || p.label;
  const out = { ...p, label };
  const r = (mod.ranges || {})[p.key];
  if (r) {
    if (!(r[0] >= p.min && r[1] <= p.max && r[0] < r[1])) fail(pid, `${mod.id}.${p.key} range`);
    out.min = r[0];
    out.max = r[1];
    if (out.softRange) out.softRange = null;
  }
  const o = (mod.options || {})[p.key];
  if (o) {
    if (!o.every((v) => p.options.some((x) => x[0] === v))) fail(pid, `${mod.id}.${p.key} options`);
    out.options = p.options.filter((x) => o.includes(x[0]));
  }
  return Object.freeze(out);
}

export function definePanel(decl, registry = NODE_REGISTRY) {
  const pid = decl.id;
  if (!/^[a-z][a-z0-9-]{0,39}$/.test(pid || '')) fail(pid, 'invalid id');
  const instance = decl.instance || `${pid}-1`;
  const tabs = Object.freeze((decl.tabs || [{ id: 'panel', title: decl.title,
    description: decl.description || '' }]).map((t) => Object.freeze({ ...t })));
  const modules = decl.modules.map((m0) => {
    const m = { ...m0, tab: m0.tab || tabs[0].id };
    if (!tabs.some((t) => t.id === m.tab)) fail(pid, `module ${m.id} names unknown tab ${m.tab}`);
    const def = registry.get(m.node);
    if (!def) fail(pid, `module ${m.id} names unknown node type ${m.node}`);
    if (!/^[a-z][a-z0-9-]{0,31}$/.test(m.id)) fail(pid, `module id ${m.id}`);
    for (const group of ['fixed', 'init', 'labels', 'ranges', 'options']) {
      for (const k of Object.keys(m[group] || {})) {
        if (!def.params.some((p) => p.key === k)) fail(pid, `${m.id}.${group}.${k} is no param`);
      }
    }
    const params = def.params.map((p) => narrow(pid, m, p));
    const values = { ...(m.init || {}), ...(m.fixed || {}) };
    for (const [k, v] of Object.entries(values)) {
      const why = validateParamValue(params.find((p) => p.key === k), v);
      if (why) fail(pid, `${m.id}.${k} ${why}`);
    }
    const hide = new Set((m.jacks && m.jacks.hide) || []);
    const jacks = [...def.inputs, ...def.outputs].filter((p) => !hide.has(p.id)).map((p) => ({
      id: jackId(m.id, p.id), key: `${jackId(m.id, p.id)}:${p.direction}`, module: m.id,
      port: p.id, direction: p.direction, type: p.type,
      label: p.label, param: p.param ? p.param.key : null }));
    return Object.freeze({ ...m, def, params, values, jacks });
  });
  const byId = new Map(modules.map((m) => [m.id, m]));
  if (byId.size !== modules.length) fail(pid, 'duplicate module id');
  const portOf = (jack, direction) => {
    const { module, port } = splitJack(jack);
    const m = byId.get(module);
    const p = m && registry.port(m.node, port, direction);
    if (!p) fail(pid, `no ${direction === 'out' ? 'output' : 'input'} jack ${jack}`);
    return { m, p };
  };
  const normals = decl.normals.map(([id, from, to, props = {}]) => {
    const a = portOf(from, 'out');
    const b = portOf(to, 'in');
    const v = canConnect(a.p, b.p, { sourceNodeId: from, targetNodeId: to });
    if (!v.allowed) fail(pid, `normal ${id}: ${v.reason}`);
    const pd = b.p.param ? registry.param(b.m.node, b.p.param.key) : null;
    const checked = validateEdgeProps(props, v.signalType, b.p, pd);
    if (!checked.ok) fail(pid, `normal ${id} props ${checked.errors[0].text}`);
    return Object.freeze({ id, edgeId: `${instance}-${id}`, from, to, props: checked.props,
      type: v.signalType });
  });
  const amounts = (decl.amounts || []).map((a, i) => {
    portOf(a.source, 'out');
    for (const t of a.to) portOf(t, 'in');
    return Object.freeze({ ...a, key: a.id || `amount${i + 1}` });
  });
  const jacksOf = (mid) => (byId.get(mid) || { jacks: [] }).jacks.map((j) => ({ ...j,
    normals: normals.filter((n) => n.to === j.id || (j.direction === 'out' && n.from === j.id))
      .map((n) => n.id) }));

  const panel = {
    id: pid, instance, version: decl.version || 1, title: decl.title,
    description: decl.description || '', modules, normals, amounts, layout: decl.layout || {},
    tabs,
    modulesOf: (tab) => modules.filter((m) => m.tab === tab),
    module: (mid) => byId.get(mid) || null,
    fixedOf: (mid) => {
      const m = byId.get(mid);
      return Object.entries(m.fixed || {}).map(([key, value]) => ({ key, value,
        label: m.params.find((p) => p.key === key).label }));
    },
    faceOf(mid) {
      const m = byId.get(mid);
      if (!m) return [];
      const params = m.params.filter((p) => !(p.key in (m.fixed || {})))
        .map((p) => ({ key: p.key, kind: KIND[p.type], label: p.label, param: p,
          initial: p.key in m.values ? m.values[p.key] : p.default }));
      const amts = amounts.filter((a) => a.module === mid).map((a) => ({ key: a.key,
        kind: 'amount', label: a.label, amount: a,
        param: Object.freeze({ key: a.key, label: a.label, type: 'number', min: a.range[0],
          max: a.range[1], step: 0.01, unit: a.unit || 'oct', scale: 'linear',
          default: 0 }) }));
      return [...params, ...amts];
    },
    jacksOf,
    resolve(model) {
      const out = new Map();
      for (const m of modules) {
        const tagged = model.graph.nodes.find((n) => n.metadata && n.metadata.panel
          && n.metadata.panel.id === instance && n.metadata.panel.module === m.id);
        const single = m.def.maxInstances === 1
          ? model.graph.nodes.find((n) => n.type === m.node) : null;
        out.set(m.id, tagged || single || null);
      }
      return out;
    },
    nodeIdOf: (mid) => `${instance}-${mid}`,
    instantiate(model, { at = { x: 0, y: 0 } } = {}) {
      const steps = [];
      const ids = new Map();
      const rows = (panel.layout.desktop || [modules.map((m) => m.id)]);
      const pos = (mid) => {
        const r = rows.findIndex((row) => row.includes(mid));
        const c = r >= 0 ? rows[r].indexOf(mid) : 0;
        return { x: at.x + c * 220, y: at.y + Math.max(0, r) * 200 };
      };
      for (const m of modules) {
        const single = m.def.maxInstances === 1
          ? model.graph.nodes.find((n) => n.type === m.node) : null;
        if (single) { ids.set(m.id, single.id); continue; }
        ids.set(m.id, panel.nodeIdOf(m.id));
        steps.push({ type: 'NODE_ADD', id: panel.nodeIdOf(m.id), nodeType: m.node,
          position: pos(m.id), params: { ...m.values }, name: m.label.slice(0, 64),
          panel: { id: instance, module: m.id } });
      }
      // A one-per-Studio node the panel reuses (Master Output): a single-input jack of it that
      // something else feeds is re-patched to the panel, in the same history entry.
      for (const n of normals) {
        const b = splitJack(n.to);
        const node = model.graph.nodes.find((x) => x.id === ids.get(b.module));
        const port = registry.port(byId.get(b.module).node, b.port, 'in');
        if (!node || port.multiple) continue;
        const taken = model.graph.edges.filter((e) => e.to.node === node.id && e.to.port === b.port)
          .map((e) => e.id);
        if (taken.length) steps.push({ type: 'EDGE_REMOVE', edgeIds: taken });
      }
      for (const n of normals) {
        const a = splitJack(n.from);
        const b = splitJack(n.to);
        steps.push({ type: 'EDGE_ADD', id: n.edgeId, from: { node: ids.get(a.module),
          port: a.port }, to: { node: ids.get(b.module), port: b.port }, props: n.props });
      }
      return { type: 'BATCH', label: `Insert ${panel.title}`, steps };
    },
  };
  return Object.freeze(panel);
}
