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

const round6 = (v) => Math.round(v * 1e6) / 1e6;

/** Equal-tempered frequency of MIDI note `midi` (A4 = 69 = 440 Hz), to 1 mHz. */
export function noteFreq(midi) {
  return Math.round(440 * 2 ** ((midi - 69) / 12) * 1000) / 1000;
}

/**
 * A line of notes as clips, `step` seconds per grid step from 0: each entry is a MIDI note, a
 * [midi, steps] pair (held for that many steps) or null (a rest of one step). Each note is a
 * pattern Tone clip on `trackId` (ids `<prefix>-n<k>`); with `gate` = { trackId, share } it
 * also starts a gate event clip on that track, `share` (0..1) of the note long (ids
 * `<prefix>-g<k>`).
 */
export function noteClips(prefix, trackId, notes, step, gate = null) {
  const out = [];
  let at = 0;
  let k = 0;
  for (const entry of notes) {
    const [midi, steps] = Array.isArray(entry) ? entry : [entry, 1];
    if (midi !== null) {
      k += 1;
      const start = round6(at * step);
      const length = round6(steps * step);
      out.push(clip(`${prefix}-n${k}`, trackId, 'pattern', start, length,
        { blockType: 'tone', params: { freq: noteFreq(midi) } }));
      if (gate) {
        out.push(clip(`${prefix}-g${k}`, gate.trackId, 'event', start,
          round6(length * gate.share), { action: 'gate' }));
      }
    }
    at += steps;
  }
  return out;
}
