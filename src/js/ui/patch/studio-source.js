// The patch bay's source over Studio nodes (B2): every node of a StudioModel, or the ones named,
// as a group of jacks from its registry ports, and every document edge between them as a cable.
// Read-only over the model: a cable drawn here IS a Studio edge (rule
// project.studio-model-is-canonical), and the bay draws nothing the model does not hold.
//
//   studioSource(model, { registry, nodes }) -> { groups, nameOf }   (ui/patch/patch-bay.js)
//   studioCables(model, source) -> [{ id, from, to, fromModule, type }]  edges inside the source
//   studioStates(model, source) -> Map<jack key, 'patched' | 'free'>
import { NODE_REGISTRY } from '../../studio/registry.js';

const nameOfNode = (registry, n) => (n.metadata && n.metadata.name)
  || (registry.has(n.type) ? registry.get(n.type).displayName : n.type);

export function studioSource(model, { registry = NODE_REGISTRY, nodes = null } = {}) {
  const pick = nodes ? new Set(nodes) : null;
  const list = model.graph.nodes.filter((n) => (!pick || pick.has(n.id))
    && registry.has(n.type));
  const jack = (n, p, direction) => ({ id: `${n.id}.${p.id}`, key: `${n.id}.${p.id}:${direction}`,
    module: n.id, port: p.id, direction, type: p.type, label: p.label || p.id });
  const groups = list.map((n) => ({ id: n.id, label: nameOfNode(registry, n).toUpperCase(),
    jacks: [...registry.ports(n.type, 'in').map((p) => jack(n, p, 'in')),
      ...registry.ports(n.type, 'out').map((p) => jack(n, p, 'out'))] }));
  const names = new Map(list.map((n) => [n.id, nameOfNode(registry, n)]));
  return { groups, nameOf: (id) => names.get(id) || id };
}

export function studioCables(model, source) {
  const keys = new Set(source.groups.flatMap((g) => g.jacks.map((j) => j.key)));
  const typeOf = new Map(source.groups.flatMap((g) => g.jacks.map((j) => [j.key, j.type])));
  return model.graph.edges.map((e) => ({ id: e.id, from: `${e.from.node}.${e.from.port}`,
    to: `${e.to.node}.${e.to.port}`, fromModule: e.from.node,
    type: typeOf.get(`${e.from.node}.${e.from.port}:out`) }))
    .filter((c) => keys.has(`${c.from}:out`) && keys.has(`${c.to}:in`));
}

export function studioStates(model, source) {
  const states = new Map(source.groups.flatMap((g) => g.jacks.map((j) => [j.key, 'free'])));
  for (const c of studioCables(model, source)) {
    states.set(`${c.from}:out`, 'patched');
    states.set(`${c.to}:in`, 'patched');
  }
  return states;
}
