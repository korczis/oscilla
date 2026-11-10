// The Clock node's ticks on the timeline (K023). Pure: plain data in, plain data out; the timeline
// compiler calls it once per pass (timeline-compiler.js compilePass) and the transport fans each
// tick out along the Clock's TRIGGER edges (transport.js fanOut), live and offline alike.
//
// A Clock ticks every T = divisionSeconds(division, transport.tempo) seconds of timeline
// position, on the grid m x T from position 0, so a loop pass replays the ticks of its range and
// a tempo change moves every later tick (the edit re-plans them). Each tick holds a gate for
// CLOCK_GATE_FRACTION of T, cut at the pass end.

import { divisionSeconds } from './nodes/common.js';
import { CLOCK_GATE_FRACTION } from './nodes/modulation.js';
import { NODE_REGISTRY } from './registry.js';

const finite = (v) => typeof v === 'number' && Number.isFinite(v);

/**
 * The ticks of every Clock node inside one pass: info { posStart, posEnd } (timeline positions),
 * toAudio(position) -> its audio time in this pass.
 *   -> [{ key, type: 'clock', clipId: null, target, pass, position, startTime, endTime,
 *         duration, division, period, truncated: false, order }]
 */
export function clockTicks(model, info, toAudio, { pass = 0, generation = 0, tolerance = 1e-6,
  registry = NODE_REGISTRY } = {}) {
  const out = [];
  const tempo = model.transport && finite(model.transport.tempo) ? model.transport.tempo : 120;
  model.graph.nodes.forEach((node, order) => {
    if (node.type !== 'clock' || !registry.get(node.type)) return;
    const period = divisionSeconds(node.params.division, tempo);
    if (!(period > 0)) return;
    for (let m = Math.max(0, Math.ceil((info.posStart - tolerance) / period));
      m * period < info.posEnd - tolerance; m++) {
      const position = m * period;
      const startTime = toAudio(position);
      const endTime = toAudio(Math.min(position + period * CLOCK_GATE_FRACTION, info.posEnd));
      out.push({ key: `${node.id}~${m}#${generation}.${pass}`, type: 'clock', clipId: null,
        target: node.id, pass, position, startTime, endTime, duration: endTime - startTime,
        division: node.params.division, period, truncated: false,
        order: model.timeline.clips.length + order });
    }
  });
  return out;
}

/**
 * K241: a document with a Clock and no loop of the user's plays until STOP and its Clock keeps
 * ticking; a document without a Clock still ends where its content ends. Before, the run ended
 * at timelineEnd (0 with no clips): the Clock's ticks stopped there and the run ended by itself.
 * The run plays its content as before, then repeats the empty bar after it: [E, E + bar), bar
 * being one 4/4 bar at the tempo and E the first bar line at or after both the content's end and
 * startPosition. No clip starts in that bar, so repeating it is exactly an open timeline: only
 * the Clocks tick there, and every Clock division (1/1 ... 1/32, TEMPO_DIVISIONS) divides a bar,
 * so the ticks keep the grid m x T from position 0 across passes. Marked freeRun, so a reader can
 * tell it from a loop the user set. createAnchor calls this for every anchor (the first PLAY and
 * every re-anchor after an edit), so a clip added during the run moves E and the run keeps going.
 * Null when the document has no Clock. Only the live transport free-runs (createAnchor's
 * freeRun option): an offline render ends with its content. The playhead counts up through the
 * repeated bar (timeline-compiler.js positionAt), so the display keeps going and an edit
 * re-anchors from the same position (C1-K241-1).
 */
export function freeRunLoop(model, startPosition, end, tolerance = 1e-6) {
  const tempo = model.transport && finite(model.transport.tempo) && model.transport.tempo > 0
    ? model.transport.tempo : 120;
  const clocked = model.graph.nodes.some((n) => n.type === 'clock'
    && divisionSeconds(n.params.division, tempo) > 0);
  if (!clocked) return null;
  const bar = 240 / tempo;
  const e = Math.max(0, Math.ceil((Math.max(end, startPosition) - tolerance) / bar)) * bar;
  return { start: e, end: e + bar, freeRun: true };
}

const nodeOf = (model, id) => model.graph.nodes.find((n) => n.id === id) || null;

/** Whether `port` of node `id` is a TRIGGER output (by the registry; 'trigger' when unknown). */
function isTriggerOut(model, id, port, registry) {
  const n = nodeOf(model, id);
  const def = n ? registry.get(n.type) : null;
  if (!def) return port === 'trigger';
  return def.outputs.some((p) => p.id === port && p.type === 'TRIGGER');
}

/** Node types whose own TRIGGER outputs relay the steps their clock input takes (K023, K226). */
const RELAY_TYPES = new Set(['step-modulator', 'step-voltage-sequencer']);

/**
 * The TRIGGER edges leaving `id` (a pattern clip's target, a Clock or a trigger event clip's
 * target drives them), and those of every relaying node their clock input reaches (a Step
 * Modulator's Trigger, K023; a step-voltage sequencer's Gate and step triggers, K226):
 * [[edgeId, toNode, toPort, muted]]. An edit keeps a scheduled item only while these are
 * unchanged (timeline-compiler.js sameItem).
 */
export function triggerEdges(model, id, seen = new Set(), registry = NODE_REGISTRY) {
  if (seen.has(id)) return [];
  seen.add(id);
  const own = model.graph.edges.filter((e) => e.from.node === id
    && isTriggerOut(model, id, e.from.port, registry));
  const out = own.map((e) => [e.id, e.to.node, e.to.port, !!(e.props && e.props.muted)]);
  for (const e of own) {
    const n = nodeOf(model, e.to.node);
    if (n && RELAY_TYPES.has(n.type) && e.to.port === 'clock' && !(e.props && e.props.muted)) {
      out.push(...triggerEdges(model, n.id, seen, registry));
    }
  }
  return out;
}

/** Whether an item drives its target's TRIGGER edges: a pattern, a Clock tick, a trigger. */
export const firesTriggers = (it) => it.type === 'pattern' || it.type === 'clock'
  || (it.type === 'event' && it.action === 'trigger');

/** Whether a sounding Clock tick keeps its gate in `next`: same Clock, division and tempo. */
export function clockTickHolds(it, next) {
  const n = nodeOf(next, it.target);
  return !!n && n.type === 'clock' && n.params.division === it.division
    && divisionSeconds(n.params.division, next.transport.tempo) === it.period;
}
