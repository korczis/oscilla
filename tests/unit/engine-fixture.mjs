// A Synth engine adapter on the fake Web Audio context (shared by the engine-* and synth-engines
// unit tests; not a test file itself): the adapter built exactly as the compiler builds it, with
// accounting Sets standing in for the engine's census, and a graph walk over every connection
// (to nodes and to AudioParams) for the no-cycle proof.
import { NODE_ADAPTERS } from '../../src/js/studio/adapters/nodes.js';
import { NODE_REGISTRY } from '../../src/js/studio/registry.js';
import { StudioFakeContext } from './sequencer-fake-audio.mjs';

export function defaults(type) {
  return Object.fromEntries(NODE_REGISTRY.get(type).params.map((p) => [p.key, p.default]));
}

export function engineEnv(type, params = {}, { sampleRate = 48000 } = {}) {
  const ctx = new StudioFakeContext({ sampleRate, holdSupported: true });
  const nodes = new Set();
  const sources = new Set();
  const acct = {
    track: (n) => { nodes.add(n); return n; },
    source: (n) => {
      nodes.add(n);
      sources.add(n);
      n.addEventListener('ended', () => { nodes.delete(n); sources.delete(n); });
      return n;
    },
    untrack: (n) => { nodes.delete(n); sources.delete(n); },
  };
  const hooks = {
    ctx,
    oscillator(type2, f, at) {
      const o = ctx.createOscillator();
      o.type = type2;
      o.frequency.setValueAtTime(f, ctx.currentTime);
      o.start(at);
      return o;
    },
    clampFrequency: (f) => Math.min((ctx.sampleRate / 2) * 0.95, f),
  };
  const p = { ...defaults(type), ...params };
  const h = NODE_ADAPTERS[type].create({ ctx, hooks, acct, at: 0, now: 0, params: p,
    node: { id: 'n1', type, params: p }, def: NODE_REGISTRY.get(type) });
  return { ctx, h, nodes, sources, acct, params: p };
}

/** Every AudioParam of a fake node, mapped to its node. */
function paramOwners(ctx) {
  const owners = new Map();
  for (const n of ctx.created) {
    for (const v of Object.values(n)) {
      if (v && typeof v === 'object' && Array.isArray(v.calls) && Array.isArray(v.events)) {
        owners.set(v, n);
      }
    }
  }
  return owners;
}

/** The connection graph of every node created: node -> [node] (a param edge ends at its owner). */
export function connections(ctx) {
  const owners = paramOwners(ctx);
  return new Map(ctx.created.map((n) => [n, (n.outputs || []).map((d) => owners.get(d) || d)]));
}

/** Whether the connection graph has a cycle (an iterative three-colour DFS). */
export function hasCycle(ctx) {
  const g = connections(ctx);
  const colour = new Map();
  for (const start of g.keys()) {
    if (colour.get(start)) continue;
    const stack = [[start, 0]];
    colour.set(start, 1);
    while (stack.length) {
      const top = stack[stack.length - 1];
      const next = (g.get(top[0]) || [])[top[1]++];
      if (next === undefined) {
        colour.set(top[0], 2);
        stack.pop();
      } else if (colour.get(next) === 1) {
        return true;
      } else if (!colour.get(next)) {
        colour.set(next, 1);
        stack.push([next, 0]);
      }
    }
  }
  return false;
}

/** The events written to a fake param, as [method, ...args]. */
export const calls = (param) => param.calls.map((c) => c[0]);
