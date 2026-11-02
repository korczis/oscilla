// A node's parameters as the registry defines them, and the one mapping between the Filter
// Lab's configuration and a Studio filter node (plan U006, P08 of the owner's pack). Pure: plain
// data in, plain data out; no DOM, no Web Audio, no store.
//
//   nodeParamsOf(model, nodeId, registry) -> { type, params } | null
//     params: every parameter the registry defines for the node's type, the node's own value
//     where it has one and the registry's default where it has not (registry.js projectParams);
//     null when the model has no node `nodeId`. A type the registry does not know keeps the
//     node's own params as they are.
//   filterNodeParams(lab) -> filter node params    the Filter Lab's configuration as a node
//                                                  (playground-voice.js builds its Filter so)
//   labFilterOf(params) -> { type, frequency, Q, gain }   a filter node's params as the lab's
//
// The two sides name their fields alike (labs/filter-lab.js FILTER_DEFAULTS, the 'filter'
// definition of nodes/processing.js): type, frequency (the cutoff, Hz), Q and gain (dB). The
// lab's enable switch is the lab's own; a node's `enabled` is a bypass in the graph, so a node
// built from the lab is enabled and the lab never takes a node's bypass.

import { NODE_REGISTRY, projectParams } from './registry.js';

export const FILTER_NODE_TYPE = 'filter';
/** The fields the Filter Lab and a filter node share, in the lab's order. */
export const FILTER_LAB_FIELDS = Object.freeze(['type', 'frequency', 'Q', 'gain']);

const finite = (v, fallback) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);

/** The node `nodeId` of `model` as { type, params } with the registry's defaults filled in. */
export function nodeParamsOf(model, nodeId, registry = NODE_REGISTRY) {
  const nodes = model && model.graph && Array.isArray(model.graph.nodes) ? model.graph.nodes : [];
  const node = nodes.find((n) => n && n.id === nodeId);
  if (!node) return null;
  const def = registry && typeof registry.get === 'function' ? registry.get(node.type) : null;
  const params = def ? projectParams(def, node.params) : { ...(node.params || {}) };
  return { type: node.type, params };
}

/** The Filter Lab's configuration ({ type, frequency, Q, gain }) as a filter node's params. */
export function filterNodeParams(lab) {
  return { type: lab.type, frequency: lab.frequency, Q: lab.Q, gain: finite(lab.gain, 0),
    enabled: true };
}

/** A filter node's params as the Filter Lab's configuration (the shared fields only). */
export function labFilterOf(params) {
  const out = {};
  for (const k of FILTER_LAB_FIELDS) out[k] = params[k];
  return out;
}
