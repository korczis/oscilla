// Plain-data builders for Studio template documents (spec §195-§196). Pure; every function
// returns a new plain object in the StudioModel schema-1 shape (schema.js), nothing else.

/** A graph node. `name` is optional: without it normalizeStudio names it "<Type> <n>". */
export function node(id, type, x, y, params = {}, name = null) {
  const n = { id, type, position: { x, y }, params };
  if (name) n.metadata = { name };
  return n;
}

/** A graph edge from `from.fromPort` to `to.toPort`, with optional routing properties. */
export function edge(id, from, fromPort, to, toPort, props = null) {
  const e = { id, from: { node: from, port: fromPort }, to: { node: to, port: toPort } };
  if (props) e.props = props;
  return e;
}

/** A timeline track. */
export function track(id, kind, name, target = null) {
  return { id, kind, name, target };
}

/** A clip; `payload` is { blockType, params } (pattern) or { action } (event, measurement). */
export function clip(id, trackId, kind, start, duration, payload, target = null) {
  return { id, trackId, kind, start, duration, target, payload };
}

/** An automation lane on node.param with points [[id, time, value, curve], ...]. */
export function lane(id, nodeId, param, points) {
  return { id, target: { node: nodeId, param },
    points: points.map(([pid, time, value, curve]) => ({ id: pid, time, value, curve })) };
}

/** A timeline marker. */
export function marker(id, time, kind, label) {
  return { id, time, kind, label };
}

/** A schema-1 Studio document from its parts (missing parts take the schema defaults). */
export function studioDoc({ title, notes = '', nodes, edges = [], tracks = [], clips = [],
  automation = [], markers = [], loop = null }) {
  const timeline = { tracks, clips, automation, markers };
  if (loop) timeline.loop = loop;
  return { kind: 'oscilla-studio', schemaVersion: 1, graph: { nodes, edges }, timeline,
    transport: { timeMode: 'seconds', tempo: 120, timeSignature: [4, 4] },
    metadata: { title, notes } };
}
