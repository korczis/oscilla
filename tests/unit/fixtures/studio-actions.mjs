// Seeded Studio edit steps for tests/unit/studio-model-invariants.test.mjs (V631, P04 slice A).
//
// nextStep(model, rng, memory) proposes one step against the store's current model: a dispatch
// of one of the store's actions, built valid or deliberately invalid, or an undo, a redo or a
// gesture (begin, a few edits, end or cancel). A step is plain data, so a recorded sequence
// replays without the generator. `intent: 'invalid'` means the action cannot be committed
// whatever else the model holds (a missing port, a stale node, a closed cycle, a second Master
// Output, ...): the store must refuse it. `intent: 'valid'` is only a best effort; the store may
// still refuse it (a valid-looking edge that closes a loop), and the test does not assume
// otherwise.
//
// MAKERS has one entry per action type of actions.js ACTION_TYPES, and the test fails while the
// two differ: a slice that adds an action (V612 insert, V613 fan-out, V614 align and box mute,
// V622, V626, V629) adds its maker here, valid and invalid, in its own pull request.
//
// mutantStore(kind, store) wraps a real store in one of three deliberate defects the invariants
// must catch: 'drop-cascade' (NODE_REMOVE commits without removing the node's edges),
// 'coerce-edge' (a refused EDGE_ADD is retried on another input of the target and reported as
// accepted) and 'repair-cycle' (an EDGE_ADD refused for a cycle removes an edge of the loop and
// connects anyway).

import { NODE_REGISTRY } from '../../../src/js/studio/registry.js';
import { canConnect } from '../../../src/js/studio/ports.js';
import { copySubgraph } from '../../../src/js/studio/actions.js';
import { createPatch } from '../../../src/js/studio/patches.js';
import {
  MARKER_KINDS, MEASUREMENT_ACTIONS, TRACK_CLIP_KINDS, collectIds,
} from '../../../src/js/studio/schema.js';
import { STUDIO_TEMPLATES, templateModel } from '../../../src/js/studio/templates/index.js';

const R = NODE_REGISTRY;
const CYCLE_CODES = new Set(['audio-feedback', 'control-cycle', 'analysis-cycle']);

// ---------------------------------------------------------------- seeded randomness

/** mulberry32: a 32-bit seeded generator, uniform in [0, 1). */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The seed of sequence `i` of a run whose base seed is `base` (distinct, well spread). */
export function sequenceSeed(base, i) {
  return (Math.imul((base >>> 0) ^ 0x5bd1e995, 0x01000193) + Math.imul(i + 1, 0x9e3779b9)) >>> 0;
}

export const hex = (seed) => `0x${(seed >>> 0).toString(16).padStart(8, '0')}`;

export function createRng(seed) {
  const next = mulberry32(seed);
  const rng = {
    next,
    int: (lo, hi) => lo + Math.floor(next() * (hi - lo + 1)),
    pick: (list) => list[Math.floor(next() * list.length)],
    chance: (p) => next() < p,
    /** 1 to `max` distinct items of `list`, in list order. */
    some(list, max = 3) {
      const k = Math.min(list.length, rng.int(1, max));
      const chosen = new Set();
      while (chosen.size < k) chosen.add(rng.int(0, list.length - 1));
      return [...chosen].sort((a, b) => a - b).map((i) => list[i]);
    },
  };
  return rng;
}

// ---------------------------------------------------------------- the starting models

/** null (an empty Studio) or a template id: where a sequence starts. */
export const INITIAL_CHOICES = Object.freeze([null, ...STUDIO_TEMPLATES.map((t) => t.id)]);

export const initialModel = (choice) => (choice == null ? null : templateModel(choice));

// ---------------------------------------------------------------- model lookups

const ids = (list) => list.map((x) => x.id);
const quarter = (rng, lo, hi) => rng.int(lo * 4, hi * 4) / 4;
const position = (rng) => ({ x: rng.int(-40, 120) * 10, y: rng.int(-20, 80) * 10 });
const allPoints = (m) => m.timeline.automation.flatMap((l) => l.points.map((p) => ({ l, p })));

/** An id the model does not hold: one it held earlier when there is one, else a ghost. */
function staleId(model, rng, memory, prefix = 'node') {
  const live = collectIds(model);
  const gone = [...memory.seen].filter((id) => !live.has(id) && id.startsWith(prefix));
  return gone.length ? rng.pick(gone.sort()) : `${prefix}-ghost-${rng.int(1, 99)}`;
}

/** Remember every id the model holds, so a later step can name one that is gone. */
export function remember(memory, model) {
  for (const id of collectIds(model)) memory.seen.add(id);
}

export const createMemory = () => ({ seen: new Set(), patches: 0 });

function inputUsed(model, nodeId, portId) {
  return model.graph.edges.some((e) => e.to.node === nodeId && e.to.port === portId);
}

function outputs(model) {
  return model.graph.nodes.flatMap((n) => R.ports(n.type, 'out').map((p) => ({ n, p })));
}

function inputs(model) {
  return model.graph.nodes.flatMap((n) => R.ports(n.type, 'in').map((p) => ({ n, p })));
}

/** canConnect's verdict on one output and one input (types, roles, self-connection). */
const fits = (a, out, b, inp) => canConnect(out, inp, { sourceNodeId: a.id,
  targetNodeId: b.id }).allowed;

/** Free inputs `src` may connect to (the store may still refuse: a loop, a live input). */
function freeTargets(model, src) {
  return inputs(model).filter(({ n, p }) => n.id !== src.n.id && fits(src.n, src.p, n, p)
    && (p.role === 'PARAMETER' || !inputUsed(model, n.id, p.id))
    && !model.graph.edges.some((e) => e.from.node === src.n.id && e.from.port === src.p.id
      && e.to.node === n.id && e.to.port === p.id));
}

/** Nodes reachable from `start` along edges of any type. */
function reach(model, start) {
  const seen = new Set();
  const queue = [start];
  while (queue.length) {
    const id = queue.shift();
    for (const e of model.graph.edges) {
      if (e.from.node === id && !seen.has(e.to.node)) {
        seen.add(e.to.node);
        queue.push(e.to.node);
      }
    }
  }
  return seen;
}

/**
 * An edge Y -> X where X already reaches Y: it closes a loop (an all-AUDIO one is audio
 * feedback, one through a CONTROL or TRIGGER edge a control cycle). X's input is free and of
 * the type of Y's output, so the loop is the only reason to refuse it.
 */
function cycleEdge(model, rng) {
  const candidates = [];
  for (const x of model.graph.nodes) {
    const free = R.ports(x.type, 'in').filter((p) => p.role === 'PARAMETER'
      || !inputUsed(model, x.id, p.id));
    if (!free.length) continue;
    for (const yId of reach(model, x.id)) {
      if (yId === x.id) continue;
      const y = model.graph.nodes.find((n) => n.id === yId);
      for (const out of R.ports(y.type, 'out')) {
        for (const p of free.filter((q) => q.type === out.type)) {
          if (model.graph.edges.some((e) => e.from.node === y.id && e.from.port === out.id
            && e.to.node === x.id && e.to.port === p.id)) continue;
          if (!fits(y, out, x, p)) continue;
          candidates.push({ from: { node: y.id, port: out.id },
            to: { node: x.id, port: p.id } });
        }
      }
    }
  }
  return candidates.length ? rng.pick(candidates) : null;
}

// ---------------------------------------------------------------- values

function validValue(p, rng) {
  switch (p.type) {
    case 'number':
    case 'integer': {
      const mid = p.type === 'integer' ? Math.round((p.min + p.max) / 2)
        : Math.round(((p.min + p.max) / 2) * 1000) / 1000;
      return rng.pick([p.min, p.max, p.default, mid].filter((v) => v != null));
    }
    case 'enum': return rng.pick(p.options)[0];
    case 'boolean': return rng.chance(0.5);
    case 'list': return [p.max, 0, p.min].slice(0, Math.max(p.minLength, 1));
    case 'id': return rng.chance(0.5) ? null : 'ab'.repeat(32);
    default: return p.default;
  }
}

function invalidValue(p) {
  switch (p.type) {
    case 'number':
    case 'integer': return p.max + 1;
    case 'enum': return 'not-an-option';
    case 'boolean': return 'yes';
    case 'list': return 'not-a-list';
    case 'id': return 'not-a-hash';
    default: return {};
  }
}

const settable = (def) => def.params.filter((p) => p.type !== 'list' || p.minLength >= 1);
const automatable = (model) => model.graph.nodes.flatMap((n) => R.get(n.type).params
  .filter((p) => p.automatable).map((p) => ({ n, p })));

// ---------------------------------------------------------------- patches

const TEMPLATE_PATCHES = STUDIO_TEMPLATES.map((t) => {
  const m = templateModel(t.id);
  return createPatch(m, ids(m.graph.nodes), { name: `${t.title} patch` });
});

function somePatch(model, rng, memory) {
  memory.patches += 1;
  if (model.graph.nodes.length && rng.chance(0.6)) {
    try {
      return createPatch(model, ids(rng.some(model.graph.nodes, 3)),
        { name: `Patch ${memory.patches}`, includeAutomation: rng.chance(0.5) });
    } catch {
      // A selection that is not a valid patch on its own: use a template's.
    }
  }
  return rng.pick(TEMPLATE_PATCHES);
}

const BROKEN_PATCHES = [
  { kind: 'oscilla-patch', schemaVersion: 1, name: 'Broken' },
  { kind: 'not-a-patch', schemaVersion: 1, name: 'Wrong kind', graph: { nodes: [], edges: [] } },
  null,
];

// ---------------------------------------------------------------- makers

const valid = (action) => ({ op: 'dispatch', action, intent: 'valid' });
const invalid = (why, action) => ({ op: 'dispatch', action, intent: 'invalid', why });

/**
 * One maker per action type: (model, rng, memory, bad) -> step. `bad` asks for an action the
 * store must refuse; a maker that cannot build the asked kind on this model builds the other.
 */
export const MAKERS = Object.freeze({
  NODE_ADD(m, rng, mem, bad) {
    const hasMaster = m.graph.nodes.some((n) => n.type === 'master');
    if (bad || (hasMaster && rng.chance(0.1))) {
      if (hasMaster && rng.chance(0.5)) {
        return invalid('second-master', { type: 'NODE_ADD', nodeType: 'master',
          position: position(rng) });
      }
      const def = rng.pick(R.list());
      const p = settable(def)[0];
      return rng.pick([
        () => invalid('unknown-node-type', { type: 'NODE_ADD', nodeType: 'theremin' }),
        () => invalid('bad-position', { type: 'NODE_ADD', nodeType: def.type,
          position: { x: 2e6, y: 0 } }),
        () => (p ? invalid('bad-param', { type: 'NODE_ADD', nodeType: def.type,
          params: { [p.key]: invalidValue(p) } })
          : invalid('bad-name', { type: 'NODE_ADD', nodeType: def.type, name: ' ' })),
      ])();
    }
    const types = R.list().filter((d) => !(hasMaster && d.type === 'master'));
    const def = rng.pick(types);
    const action = { type: 'NODE_ADD', nodeType: def.type, position: position(rng) };
    const p = settable(def);
    if (p.length && rng.chance(0.4)) {
      const q = rng.pick(p);
      action.params = { [q.key]: validValue(q, rng) };
    }
    if (rng.chance(0.2)) action.name = `Box ${rng.int(1, 9)}`;
    return valid(action);
  },

  NODE_REMOVE(m, rng, mem, bad) {
    if (bad || !m.graph.nodes.length) {
      return rng.chance(0.8)
        ? invalid('stale-node', { type: 'NODE_REMOVE', nodeId: staleId(m, rng, mem) })
        : invalid('empty', { type: 'NODE_REMOVE', nodeIds: [] });
    }
    return rng.chance(0.7)
      ? valid({ type: 'NODE_REMOVE', nodeId: rng.pick(m.graph.nodes).id })
      : valid({ type: 'NODE_REMOVE', nodeIds: ids(rng.some(m.graph.nodes, 2)) });
  },

  NODE_MOVE(m, rng, mem, bad) {
    if (bad || !m.graph.nodes.length) {
      return !m.graph.nodes.length || rng.chance(0.5)
        ? invalid('stale-node', { type: 'NODE_MOVE', nodeId: staleId(m, rng, mem),
          position: position(rng) })
        : invalid('bad-position', { type: 'NODE_MOVE', nodeId: rng.pick(m.graph.nodes).id,
          position: { x: 0, y: -3e6 } });
    }
    return rng.chance(0.7)
      ? valid({ type: 'NODE_MOVE', nodeId: rng.pick(m.graph.nodes).id, position: position(rng) })
      : valid({ type: 'NODE_MOVE', nodeIds: ids(rng.some(m.graph.nodes, 3)),
        delta: { x: rng.int(-5, 5) * 10, y: rng.int(-5, 5) * 10 } });
  },

  NODE_PARAM_SET(m, rng, mem, bad) {
    const withParams = m.graph.nodes.filter((n) => settable(R.get(n.type)).length);
    if (bad || !withParams.length) {
      if (!withParams.length || rng.chance(0.3)) {
        return invalid('stale-node', { type: 'NODE_PARAM_SET', nodeId: staleId(m, rng, mem),
          key: 'level', value: 0.5 });
      }
      const n = rng.pick(withParams);
      const p = rng.pick(settable(R.get(n.type)));
      return rng.chance(0.5)
        ? invalid('bad-param', { type: 'NODE_PARAM_SET', nodeId: n.id, key: p.key,
          value: invalidValue(p) })
        : invalid('unknown-param', { type: 'NODE_PARAM_SET', nodeId: n.id, key: 'warp',
          value: 1 });
    }
    const n = rng.pick(withParams);
    const p = rng.pick(settable(R.get(n.type)));
    return valid({ type: 'NODE_PARAM_SET', nodeId: n.id, key: p.key, value: validValue(p, rng) });
  },

  NODE_RENAME(m, rng, mem, bad) {
    if (bad || !m.graph.nodes.length) {
      return !m.graph.nodes.length || rng.chance(0.4)
        ? invalid('stale-node', { type: 'NODE_RENAME', nodeId: staleId(m, rng, mem),
          name: 'Ghost' })
        : invalid('bad-name', { type: 'NODE_RENAME', nodeId: rng.pick(m.graph.nodes).id,
          name: rng.pick(['', '   ', 'x'.repeat(65), 'tab\there']) });
    }
    return valid({ type: 'NODE_RENAME', nodeId: rng.pick(m.graph.nodes).id,
      name: rng.pick(['Main', 'Bass', 'Lead', `Box ${rng.int(1, 9)}`]) });
  },

  EDGE_ADD(m, rng, mem, bad) {
    const outs = outputs(m);
    if (bad || !outs.length) {
      const kinds = ['missing-port', 'stale-node', 'wrong-type', 'self', 'input-as-source'];
      const cycle = rng.chance(0.5) && badEdge('cycle', m, rng, mem, outs);
      if (cycle) return cycle;
      for (let tries = 0; tries < 6; tries++) {
        const step = badEdge(rng.pick(kinds), m, rng, mem, outs);
        if (step) return step;
      }
      return badEdge('stale-node', m, rng, mem, outs);
    }
    const shuffled = rng.some(outs, outs.length);
    for (const src of shuffled) {
      const targets = freeTargets(m, src);
      if (!targets.length) continue;
      const t = rng.pick(targets);
      const action = { type: 'EDGE_ADD', from: { node: src.n.id, port: src.p.id },
        to: { node: t.n.id, port: t.p.id } };
      if (rng.chance(0.2)) action.props = { muted: rng.chance(0.5) };
      return valid(action);
    }
    return badEdge('missing-port', m, rng, mem, outs);
  },

  EDGE_REMOVE(m, rng, mem, bad) {
    if (bad || !m.graph.edges.length) {
      return invalid('stale-edge', { type: 'EDGE_REMOVE', edgeId: staleId(m, rng, mem, 'edge') });
    }
    return rng.chance(0.7)
      ? valid({ type: 'EDGE_REMOVE', edgeId: rng.pick(m.graph.edges).id })
      : valid({ type: 'EDGE_REMOVE', edgeIds: ids(rng.some(m.graph.edges, 2)) });
  },

  EDGE_UPDATE(m, rng, mem, bad) {
    if (bad || !m.graph.edges.length) {
      return !m.graph.edges.length || rng.chance(0.4)
        ? invalid('stale-edge', { type: 'EDGE_UPDATE', edgeId: staleId(m, rng, mem, 'edge'),
          props: { muted: true } })
        : invalid('bad-props', { type: 'EDGE_UPDATE', edgeId: rng.pick(m.graph.edges).id,
          props: rng.pick([{ muted: 'yes' }, { warp: 3 }]) });
    }
    return valid({ type: 'EDGE_UPDATE', edgeId: rng.pick(m.graph.edges).id,
      props: { muted: rng.chance(0.5) } });
  },

  TRACK_ADD(m, rng, mem, bad) {
    if (bad) {
      return rng.chance(0.5)
        ? invalid('unknown-kind', { type: 'TRACK_ADD', kind: 'video' })
        : invalid('stale-node', { type: 'TRACK_ADD', kind: 'event',
          target: staleId(m, rng, mem) });
    }
    const kind = rng.pick(['event', 'event', 'measurement']);
    const fits = m.graph.nodes.filter((n) => R.get(n.type).clipKinds
      .some((k) => TRACK_CLIP_KINDS[kind].includes(k)));
    const action = { type: 'TRACK_ADD', kind };
    if (fits.length && rng.chance(0.5)) action.target = rng.pick(fits).id;
    if (rng.chance(0.3)) action.name = `Lane ${rng.int(1, 9)}`;
    return valid(action);
  },

  TRACK_REMOVE(m, rng, mem, bad) {
    if (bad || !m.timeline.tracks.length) {
      return invalid('stale-track', { type: 'TRACK_REMOVE',
        trackId: staleId(m, rng, mem, 'track') });
    }
    return valid({ type: 'TRACK_REMOVE', trackId: rng.pick(m.timeline.tracks).id });
  },

  CLIP_ADD(m, rng, mem, bad) {
    const tracks = m.timeline.tracks;
    if (bad || !tracks.length) {
      if (!tracks.length || rng.chance(0.3)) {
        return invalid('stale-track', { type: 'CLIP_ADD', trackId: staleId(m, rng, mem, 'track'),
          start: 0, duration: 1 });
      }
      const t = rng.pick(tracks);
      return rng.pick([
        () => invalid('bad-time', { type: 'CLIP_ADD', trackId: t.id, start: -1, duration: 1 }),
        () => invalid('bad-time', { type: 'CLIP_ADD', trackId: t.id, start: 0, duration: 0 }),
        () => invalid('unknown-kind', { type: 'CLIP_ADD', trackId: t.id, kind: 'video',
          start: 0, duration: 1 }),
        () => invalid('stale-node', { type: 'CLIP_ADD', trackId: t.id, start: 0, duration: 1,
          target: staleId(m, rng, mem) }),
      ])();
    }
    const t = rng.pick(tracks);
    const kind = rng.pick(TRACK_CLIP_KINDS[t.kind]);
    const action = { type: 'CLIP_ADD', trackId: t.id, kind, start: quarter(rng, 0, 12),
      duration: quarter(rng, 0.25, 3) };
    if (kind === 'measurement') {
      action.payload = { action: rng.pick(['pre-roll', 'tail', ...MEASUREMENT_ACTIONS]) };
    } else if (rng.chance(0.4)) {
      action.timeBase = 'tempo';
    }
    if (kind === 'event' && rng.chance(0.5)) {
      action.payload = { action: rng.pick(['gate', 'trigger']) };
    }
    const fits = m.graph.nodes.filter((n) => R.get(n.type).clipKinds.includes(kind));
    if (fits.length && rng.chance(0.4)) action.target = rng.pick(fits).id;
    return valid(action);
  },

  CLIP_REMOVE(m, rng, mem, bad) {
    if (bad || !m.timeline.clips.length) {
      return invalid('stale-clip', { type: 'CLIP_REMOVE', clipId: staleId(m, rng, mem, 'clip') });
    }
    return valid({ type: 'CLIP_REMOVE', clipId: rng.pick(m.timeline.clips).id });
  },

  CLIP_MOVE(m, rng, mem, bad) {
    const clips = m.timeline.clips;
    if (bad || !clips.length) {
      if (!clips.length || rng.chance(0.3)) {
        return invalid('stale-clip', { type: 'CLIP_MOVE', clipId: staleId(m, rng, mem, 'clip'),
          start: 1 });
      }
      const c = rng.pick(clips);
      return rng.chance(0.5)
        ? invalid('bad-time', { type: 'CLIP_MOVE', clipId: c.id, start: -0.5 })
        : invalid('stale-track', { type: 'CLIP_MOVE', clipId: c.id,
          trackId: staleId(m, rng, mem, 'track') });
    }
    const c = rng.pick(clips);
    const action = { type: 'CLIP_MOVE', clipId: c.id, start: quarter(rng, 0, 12) };
    const kind = m.timeline.tracks.find((t) => t.id === c.trackId).kind;
    const same = m.timeline.tracks.filter((t) => t.kind === kind);
    if (rng.chance(0.3)) action.trackId = rng.pick(same).id;
    return valid(action);
  },

  CLIP_RESIZE(m, rng, mem, bad) {
    const clips = m.timeline.clips;
    if (bad || !clips.length) {
      return !clips.length || rng.chance(0.4)
        ? invalid('stale-clip', { type: 'CLIP_RESIZE', clipId: staleId(m, rng, mem, 'clip'),
          duration: 1 })
        : invalid('bad-time', { type: 'CLIP_RESIZE', clipId: rng.pick(clips).id, duration: 0 });
    }
    const action = { type: 'CLIP_RESIZE', clipId: rng.pick(clips).id,
      duration: quarter(rng, 0.25, 4) };
    if (rng.chance(0.3)) action.start = quarter(rng, 0, 8);
    return valid(action);
  },

  CLIP_UPDATE(m, rng, mem, bad) {
    const clips = m.timeline.clips;
    if (bad || !clips.length) {
      return !clips.length || rng.chance(0.5)
        ? invalid('stale-clip', { type: 'CLIP_UPDATE', clipId: staleId(m, rng, mem, 'clip'),
          target: null })
        : invalid('stale-node', { type: 'CLIP_UPDATE', clipId: rng.pick(clips).id,
          target: staleId(m, rng, mem) });
    }
    const c = rng.pick(clips);
    const fits = m.graph.nodes.filter((n) => R.get(n.type).clipKinds.includes(c.kind));
    if (fits.length && rng.chance(0.5)) {
      return valid({ type: 'CLIP_UPDATE', clipId: c.id, target: rng.pick([null, ...ids(fits)]) });
    }
    const payload = c.kind === 'measurement' ? { action: rng.pick(MEASUREMENT_ACTIONS) }
      : c.kind === 'event' ? { action: rng.pick(['gate', 'trigger']) }
        : { blockType: 'tone', params: { freq: rng.pick([220, 440, 880]) } };
    return valid({ type: 'CLIP_UPDATE', clipId: c.id, payload });
  },

  CLIP_SET_TIME_BASE(m, rng, mem, bad) {
    const clips = m.timeline.clips;
    if (bad || !clips.length) {
      return !clips.length || rng.chance(0.4)
        ? invalid('stale-clip', { type: 'CLIP_SET_TIME_BASE',
          clipId: staleId(m, rng, mem, 'clip'), timeBase: 'tempo' })
        : invalid('unknown-time-base', { type: 'CLIP_SET_TIME_BASE',
          clipId: rng.pick(clips).id, timeBase: 'bars' });
    }
    return valid({ type: 'CLIP_SET_TIME_BASE', clipId: rng.pick(clips).id,
      timeBase: rng.pick(['tempo', 'absolute']) });
  },

  AUTOMATION_POINT_ADD(m, rng, mem, bad) {
    const targets = automatable(m);
    if (bad || !targets.length) {
      const fixed = m.graph.nodes.flatMap((n) => R.get(n.type).params
        .filter((p) => !p.automatable).map((p) => ({ n, p })));
      if (fixed.length && rng.chance(0.4)) {
        const { n, p } = rng.pick(fixed);
        return invalid('not-automatable', { type: 'AUTOMATION_POINT_ADD',
          target: { node: n.id, param: p.key }, time: 0, value: 0 });
      }
      if (targets.length && rng.chance(0.5)) {
        const { n, p } = rng.pick(targets);
        return invalid('bad-param', { type: 'AUTOMATION_POINT_ADD',
          target: { node: n.id, param: p.key }, time: 1, value: invalidValue(p) });
      }
      return invalid('stale-node', { type: 'AUTOMATION_POINT_ADD',
        target: { node: staleId(m, rng, mem), param: 'frequency' }, time: 0, value: 1 });
    }
    const { n, p } = rng.pick(targets);
    return valid({ type: 'AUTOMATION_POINT_ADD', target: { node: n.id, param: p.key },
      time: quarter(rng, 0, 8), value: validValue(p, rng),
      curve: rng.pick(p.min > 0 ? ['linear', 'step', 'exponential'] : ['linear', 'step']) });
  },

  AUTOMATION_POINT_MOVE(m, rng, mem, bad) {
    const pts = allPoints(m);
    if (bad || !pts.length) {
      return invalid('stale-point', { type: 'AUTOMATION_POINT_MOVE',
        laneId: pts.length ? rng.pick(pts).l.id : staleId(m, rng, mem, 'lane'),
        pointId: staleId(m, rng, mem, 'pt'), time: 1 });
    }
    const { l, p } = rng.pick(pts);
    const action = { type: 'AUTOMATION_POINT_MOVE', laneId: l.id, pointId: p.id,
      time: quarter(rng, 0, 8) };
    if (rng.chance(0.3)) action.curve = rng.pick(['linear', 'step']);
    return valid(action);
  },

  AUTOMATION_POINT_REMOVE(m, rng, mem, bad) {
    const pts = allPoints(m);
    if (bad || !pts.length) {
      return invalid('stale-point', { type: 'AUTOMATION_POINT_REMOVE',
        laneId: staleId(m, rng, mem, 'lane'), pointId: staleId(m, rng, mem, 'pt') });
    }
    const { l, p } = rng.pick(pts);
    return valid({ type: 'AUTOMATION_POINT_REMOVE', laneId: l.id, pointId: p.id });
  },

  MARKER_ADD(m, rng, mem, bad) {
    if (bad) {
      return rng.chance(0.5)
        ? invalid('unknown-kind', { type: 'MARKER_ADD', time: 1, kind: 'bogus' })
        : invalid('bad-time', { type: 'MARKER_ADD', time: -2, kind: 'custom' });
    }
    return valid({ type: 'MARKER_ADD', time: quarter(rng, 0, 12), kind: rng.pick(MARKER_KINDS),
      label: rng.pick(['', 'Drop', 'Verse']) });
  },

  MARKER_REMOVE(m, rng, mem, bad) {
    if (bad || !m.timeline.markers.length) {
      return invalid('stale-marker', { type: 'MARKER_REMOVE',
        markerId: staleId(m, rng, mem, 'marker') });
    }
    return valid({ type: 'MARKER_REMOVE', markerId: rng.pick(m.timeline.markers).id });
  },

  MARKER_MOVE(m, rng, mem, bad) {
    const markers = m.timeline.markers;
    if (bad || !markers.length) {
      return !markers.length || rng.chance(0.5)
        ? invalid('stale-marker', { type: 'MARKER_MOVE',
          markerId: staleId(m, rng, mem, 'marker'), time: 1 })
        : invalid('unknown-kind', { type: 'MARKER_MOVE', markerId: rng.pick(markers).id,
          kind: 'bogus' });
    }
    return valid({ type: 'MARKER_MOVE', markerId: rng.pick(markers).id,
      time: quarter(rng, 0, 12), label: rng.pick([undefined, 'Moved']) });
  },

  LOOP_SET(m, rng, mem, bad) {
    if (bad) {
      return invalid('bad-loop', rng.chance(0.5)
        ? { type: 'LOOP_SET', start: 4, end: 2 } : { type: 'LOOP_SET', enabled: 'on' });
    }
    const start = quarter(rng, 0, 6);
    return valid({ type: 'LOOP_SET', enabled: rng.chance(0.5), start,
      end: start + quarter(rng, 0.25, 4) });
  },

  TRANSPORT_SET(m, rng, mem, bad) {
    if (bad) {
      return invalid('bad-transport', rng.pick([
        { type: 'TRANSPORT_SET', tempo: 0 },
        { type: 'TRANSPORT_SET', timeSignature: [4] },
        { type: 'TRANSPORT_SET', timeSignature: [4, 3] },
        { type: 'TRANSPORT_SET', timeMode: 'bars' },
      ]));
    }
    const action = { type: 'TRANSPORT_SET' };
    if (rng.chance(0.6)) action.tempo = rng.pick([60, 90, 100, 120, 135, 150]);
    if (rng.chance(0.3)) action.timeSignature = rng.pick([[4, 4], [3, 4], [6, 8], [7, 8]]);
    if (rng.chance(0.3)) action.timeMode = rng.pick(['seconds', 'musical']);
    return valid(action);
  },

  METADATA_SET(m, rng, mem, bad) {
    if (bad) {
      return invalid('bad-title', rng.chance(0.5)
        ? { type: 'METADATA_SET', title: 'x'.repeat(201) }
        : { type: 'METADATA_SET', notes: 'n'.repeat(10001) });
    }
    return valid({ type: 'METADATA_SET', title: rng.pick(['Session', 'Sketch', 'Test bench']),
      notes: rng.pick([undefined, 'notes', '']) });
  },

  // K061 (#329): several model edits as one history entry; a nested batch or an empty one is
  // refused, and so is a view change inside it.
  BATCH(m, rng, mem, bad) {
    if (bad) {
      return rng.pick([
        () => invalid('empty-batch', { type: 'BATCH', steps: [] }),
        () => invalid('nested-batch', { type: 'BATCH', steps: [{ type: 'BATCH', steps: [] }] }),
        () => invalid('view-in-batch', { type: 'BATCH', steps: [{ type: 'VIEW_SET' }] }),
      ])();
    }
    return valid({ type: 'BATCH', label: 'Batch', steps: [
      { type: 'METADATA_SET', title: rng.pick(['Session', 'Sketch', 'Test bench']) },
      { type: 'NODE_ADD', nodeType: rng.pick(R.list().filter((d) => d.type !== 'master')).type,
        position: position(rng) },
    ] });
  },

  PASTE(m, rng, mem, bad) {
    if (bad || !m.graph.nodes.length) {
      return invalid('bad-clipboard', { type: 'PASTE', clipboard: rng.pick([
        { kind: 'text', nodes: [], edges: [] },
        { kind: 'oscilla-studio-clipboard', v: 1, nodes: [], edges: [] },
        null,
      ]) });
    }
    const action = { type: 'PASTE', clipboard: copySubgraph(m, ids(rng.some(m.graph.nodes, 3))) };
    if (rng.chance(0.3)) action.offset = { x: rng.int(-4, 4) * 10, y: rng.int(-4, 4) * 10 };
    return valid(action);
  },

  DUPLICATE(m, rng, mem, bad) {
    const { nodes } = m.graph;
    const { clips } = m.timeline;
    if (bad || (!nodes.length && !clips.length)) {
      return rng.chance(0.5) ? invalid('empty', { type: 'DUPLICATE', nodeIds: [], clipIds: [] })
        : invalid('stale-node', { type: 'DUPLICATE', nodeIds: [staleId(m, rng, mem)] });
    }
    const action = { type: 'DUPLICATE' };
    if (nodes.length && (!clips.length || rng.chance(0.6))) {
      action.nodeIds = ids(rng.some(nodes, 2));
    }
    if (clips.length && (!action.nodeIds || rng.chance(0.4))) {
      action.clipIds = ids(rng.some(clips, 2));
    }
    return valid(action);
  },

  PATCH_INSERT(m, rng, mem, bad) {
    if (bad) {
      return invalid('bad-patch', { type: 'PATCH_INSERT', patch: rng.pick(BROKEN_PATCHES) });
    }
    const action = { type: 'PATCH_INSERT', patch: somePatch(m, rng, mem) };
    if (rng.chance(0.5)) action.at = position(rng);
    return valid(action);
  },

  PATCH_REPLACE(m, rng, mem, bad) {
    if (bad || rng.chance(0.3)) {
      return invalid('bad-patch', { type: 'PATCH_REPLACE', patch: rng.pick(BROKEN_PATCHES) });
    }
    return valid({ type: 'PATCH_REPLACE', patch: somePatch(m, rng, mem) });
  },

  SELECTION_CHANGE(m, rng, mem, bad) {
    // A selection is never refused: names that do not exist are pruned (actions.js).
    const t = m.timeline;
    const pick = (list) => (list.length && rng.chance(0.6) ? ids(rng.some(list, 2)) : []);
    const selection = { nodes: pick(m.graph.nodes), edges: pick(m.graph.edges),
      clips: pick(t.clips), points: allPoints(m).length && rng.chance(0.3)
        ? [rng.pick(allPoints(m)).p.id] : [], markers: pick(t.markers) };
    if (bad) {
      selection.nodes = [...selection.nodes, staleId(m, rng, mem)];
      selection.edges = [...selection.edges, staleId(m, rng, mem, 'edge')];
      return { op: 'dispatch', action: { type: 'SELECTION_CHANGE', selection }, intent: 'valid',
        why: 'pruned' };
    }
    return valid({ type: 'SELECTION_CHANGE', selection });
  },

  VIEW_SET(m, rng, mem, bad) {
    if (bad) {
      return invalid('bad-view', rng.pick([
        { type: 'VIEW_SET', view: { graph: { zoom: 0 } } },
        { type: 'VIEW_SET', view: { timeline: { pxPerSecond: 1e7 } } },
        { type: 'VIEW_SET', view: { graph: { panX: 2e9 } } },
      ]));
    }
    return valid({ type: 'VIEW_SET', view: rng.chance(0.5)
      ? { graph: { panX: rng.int(-50, 50) * 10, zoom: rng.pick([0.5, 1, 1.5, 2]) } }
      : { timeline: { pxPerSecond: rng.pick([40, 80, 160]), scrollX: rng.int(0, 20) * 10 } } });
  },
});

/** EDGE_ADD actions the store must refuse, by kind; null when the model cannot host it. */
function badEdge(kind, m, rng, mem, outs) {
  const ins = inputs(m);
  if (kind === 'missing-port' && outs.length) {
    const src = rng.pick(outs);
    const tgt = rng.pick(m.graph.nodes);
    return invalid('missing-port', rng.chance(0.5)
      ? { type: 'EDGE_ADD', from: { node: src.n.id, port: src.p.id },
        to: { node: tgt.id, port: 'nope' } }
      : { type: 'EDGE_ADD', from: { node: src.n.id, port: 'nope' },
        to: { node: tgt.id, port: 'audio' } });
  }
  if (kind === 'wrong-type' && outs.length) {
    const pairs = [];
    for (const src of outs) {
      for (const t of ins) {
        if (t.n.id !== src.n.id && t.p.type !== src.p.type) pairs.push([src, t]);
      }
    }
    if (!pairs.length) return null;
    const [src, t] = rng.pick(pairs);
    return invalid('wrong-type', { type: 'EDGE_ADD', from: { node: src.n.id, port: src.p.id },
      to: { node: t.n.id, port: t.p.id } });
  }
  if (kind === 'cycle') {
    const edge = cycleEdge(m, rng);
    return edge ? invalid('cycle', { type: 'EDGE_ADD', ...edge }) : null;
  }
  if (kind === 'self') {
    const both = m.graph.nodes.filter((n) => R.ports(n.type, 'out').some((p) => p.type === 'AUDIO')
      && R.ports(n.type, 'in').some((p) => p.type === 'AUDIO'));
    if (!both.length) return null;
    const n = rng.pick(both);
    return invalid('self', { type: 'EDGE_ADD',
      from: { node: n.id, port: R.ports(n.type, 'out').find((p) => p.type === 'AUDIO').id },
      to: { node: n.id, port: R.ports(n.type, 'in').find((p) => p.type === 'AUDIO').id } });
  }
  // An input whose id is not also an output of its node (Calibration has both "observed").
  const onlyIn = ins.filter(({ n, p }) => !R.port(n.type, p.id, 'out'));
  if (kind === 'input-as-source' && onlyIn.length && outs.length) {
    const a = rng.pick(onlyIn);
    const b = rng.pick(ins);
    return invalid('input-as-source', { type: 'EDGE_ADD', from: { node: a.n.id, port: a.p.id },
      to: { node: b.n.id, port: b.p.id } });
  }
  if (kind === 'stale-node') {
    const live = m.graph.nodes.length ? rng.pick(m.graph.nodes) : null;
    return invalid('stale-node', live && rng.chance(0.5)
      ? { type: 'EDGE_ADD', from: { node: staleId(m, rng, mem), port: 'audio' },
        to: { node: live.id, port: 'audio' } }
      : { type: 'EDGE_ADD', from: { node: live ? live.id : 'osc-1', port: 'audio' },
        to: { node: staleId(m, rng, mem), port: 'audio' } });
  }
  return null;
}

/** The action types the generator builds (the test holds this equal to ACTION_TYPES). */
export const GENERATED_TYPES = Object.freeze(Object.keys(MAKERS));

// Weights: graph building is drawn more often so sequences reach connected graphs.
const WEIGHTS = Object.freeze({ NODE_ADD: 5, EDGE_ADD: 6, NODE_REMOVE: 2, PATCH_REPLACE: 0.5,
  TRACK_ADD: 2, CLIP_ADD: 3, AUTOMATION_POINT_ADD: 2 });
const TABLE = GENERATED_TYPES.flatMap((t) => Array(Math.round((WEIGHTS[t] || 1) * 2)).fill(t));

/** A gesture: begin, 2-4 edits of one kind, then end (one history entry) or cancel. */
function gestureStep(m, rng, mem) {
  const kind = rng.pick(['NODE_MOVE', 'NODE_PARAM_SET']);
  const actions = [];
  const scratch = createRng(rng.int(0, 0x7fffffff));
  for (let i = rng.int(2, 4); i > 0; i--) actions.push(MAKERS[kind](m, scratch, mem, false));
  return { op: 'gesture', label: rng.chance(0.5) ? `Drag ${kind}` : null, steps: actions,
    end: rng.chance(0.3) ? 'cancel' : 'end' };
}

/** The next step against `model`: about 1 in 4 dispatches is built invalid. */
export function nextStep(model, rng, memory) {
  const r = rng.next();
  if (r < 0.07) return { op: 'undo' };
  if (r < 0.10) return { op: 'redo' };
  if (r < 0.13) return gestureStep(model, rng, memory);
  if (r < 0.15) {
    return invalid('no-type', rng.pick([{ type: 'NODE_EXPLODE' }, { nodeType: 'gain' },
      { type: 42 }, null, 'NODE_ADD']));
  }
  const type = rng.pick(TABLE);
  return MAKERS[type](model, rng, memory, rng.chance(0.25));
}

// ---------------------------------------------------------------- mutant stores

/** The store's interface, with `dispatch` and `getModel` replaceable (the mutants below). */
function wrap(store, { dispatch = store.dispatch, getModel = store.getModel } = {}) {
  return Object.freeze({ ...store, dispatch, getModel,
    getState: () => ({ model: getModel(), selection: store.getSelection(),
      revision: store.getRevision() }) });
}

function pathEdges(model, fromId, toId) {
  // Breadth-first over every edge: the edges of one path fromId -> toId, or [].
  const prev = new Map([[fromId, null]]);
  const queue = [fromId];
  while (queue.length) {
    const id = queue.shift();
    if (id === toId) break;
    for (const e of model.graph.edges) {
      if (e.from.node === id && !prev.has(e.to.node)) {
        prev.set(e.to.node, e);
        queue.push(e.to.node);
      }
    }
  }
  const path = [];
  for (let e = prev.get(toId); e; e = prev.get(e.from.node)) path.unshift(e);
  return path;
}

/**
 * A real store with one deliberate defect (the mutations V631 must catch):
 *   'drop-cascade': NODE_REMOVE commits, but the model it reports keeps the removed node's
 *                   edges (a dangling edge);
 *   'coerce-edge':  a refused EDGE_ADD is retried on the target's other inputs and the first
 *                   that commits is reported as the action's result (silent coercion);
 *   'repair-cycle': an EDGE_ADD refused for a cycle removes the first edge of the loop and
 *                   connects anyway, as one undo entry (silent feedback repair).
 */
export function mutantStore(kind, store) {
  if (kind === 'drop-cascade') {
    let shadow = null;
    return wrap(store, {
      dispatch(action) {
        const before = store.getModel();
        const r = store.dispatch(action);
        if (r.ok && r.changed && action && action.type === 'NODE_REMOVE') {
          const next = store.getModel();
          shadow = { base: next, model: Object.freeze({ ...next,
            graph: Object.freeze({ ...next.graph, edges: before.graph.edges }) }) };
        }
        return r;
      },
      getModel() {
        const m = store.getModel();
        return shadow && shadow.base === m ? shadow.model : m;
      },
    });
  }
  if (kind === 'coerce-edge') {
    return wrap(store, {
      dispatch(action) {
        const r = store.dispatch(action);
        if (r.ok || !action || action.type !== 'EDGE_ADD' || !action.to) return r;
        const node = store.getModel().graph.nodes.find((n) => n.id === action.to.node);
        if (!node) return r;
        for (const p of R.ports(node.type, 'in')) {
          if (p.id === action.to.port) continue;
          const again = store.dispatch({ ...action, to: { node: node.id, port: p.id } });
          if (again.ok) return again;
        }
        return r;
      },
    });
  }
  if (kind === 'repair-cycle') {
    return wrap(store, {
      dispatch(action) {
        const r = store.dispatch(action);
        if (r.ok || !action || action.type !== 'EDGE_ADD'
          || !(r.diagnostics || []).some((d) => CYCLE_CODES.has(d.code))) return r;
        const loop = pathEdges(store.getModel(), action.to.node, action.from.node);
        if (!loop.length) return r;
        store.beginGesture('Connect');
        store.dispatch({ type: 'EDGE_REMOVE', edgeId: loop[0].id });
        const again = store.dispatch(action);
        if (!again.ok) {
          store.cancelGesture();
          return r;
        }
        store.endGesture();
        return again;
      },
    });
  }
  throw new RangeError(`Unknown mutant "${kind}".`);
}

export const MUTANTS = Object.freeze(['drop-cascade', 'coerce-edge', 'repair-cycle']);
