// The clip-target policy (R7, docs/v4/completion-ledger.md): which node, or node parameter, a
// timeline clip or automation lane may target, and how the transport plays it there. Pure: plain
// data in, plain data out. It is the ONE answer read by
//   the store         timeline.js clipRules (every action and every import);
//                     validate.js and actions.js for automation lanes
//   the timeline UI   timeline-view.js trackTargetOptions / clipTargetOptions / addClipAction /
//                     compatibleTracks / clipFormOptions, timeline.js clipTrackReason (the
//                     tracks a clip may move or be nudged to), automation-view.js
//                     automatableTargets, automation.js automateParameter and the Inspector's
//                     Automate button
//   the transport     transport.js clipPlayReason, the oscillators it pattern-plays, the
//                     envelopes it gates, and the parameters its lanes own and drive
//   offline render    offline.js planOfflineRender (clips through clipPlayReason, lanes here)
//
//   clipTarget(node, use, registry = NODE_REGISTRY) -> { holds, plays, how, code, reason,
//                                                        errors }
//     node    the model node the clip plays on (its own target, else its track's), or null
//     use     { kind: 'pattern' | 'event' | 'measurement' | 'notes', action? } for a clip (its
//             payload.action; an event clip without one is a gate), or
//             { kind: 'automation', param } for a lane
//     holds   the store keeps it: a model with it validates, a file saved with it loads
//     plays   the transport plays it, as `how`: 'sequence' (compileSequence into the Sequence),
//             'pattern-played' (the Oscillator's pattern bus), 'gate' (the Envelope's gate),
//             'keys-gate' (a Keys node's Gate: the Envelopes its unmuted gate edges reach, K060),
//             'keys-notes' (a notes clip on a Keys node: each note sets its pitch and opens its
//             Gate, K068), 'engine-notes' (a notes clip on the percussion engine: each note a
//             note-on and note-off of its voice pool, K222), 'clock' (one clock tick of Random or
//             the Step Modulator, K023),
//             'measurement' (data for the measurement hook) or 'automation' (the lane drives the
//             parameter's AudioParam)
//     code, reason   null when it plays; otherwise the store's first error (holds false) or the
//             transport's unplayed code and reason (holds true)
//     errors  the store's errors: [{ code, message, path, nodeId? }] (path relative to the clip)
//
// Holding and playing differ on purpose. The store holds what the registry declares (a node
// type's clipKinds; for a notes clip, a type that plays notes, registry.js playsNotes: Keys, the
// XY pad, the voice engines; a parameter's `automatable`) so that a file saved by an earlier
// build keeps loading; the transport plays a subset of it; the UI offers only what plays, and
// reports what is held but not played with this reason where docs/v31/timeline.md "Clip-target
// policy" lists. The subset is the table below: pattern clips play on a Sequence or an
// Oscillator, event clips as gates or triggers on an Envelope, as gates on a Keys node and as
// triggers on Random and the Step Modulator (EVENT_PLAY, K023), measurement clips always
// (as data), notes clips on a Keys node (K068) and on the percussion engine (K222; held on the
// XY pad and the other voice engines, and reported there with the notesUnplayed reason), and a
// lane plays unless its parameter has no
// linear AudioParam that Web Audio uses:
// a Stereo Split pan or level is a pan law over several gains (no single AudioParam), a low-/
// high-pass Q AudioParam is in dB (its lane plays through laneMap since K232), a shelf ignores
// its Q,
// and a filter's gain is ignored by Web Audio for every type but peaking and the shelves.
// tests/unit/v4-clip-target-policy.test.mjs proves the store, the UI and the transport give this
// verdict for every node type, clip kind, action and parameter in the registry.

import { nodeQ, usesGain, usesQ } from '../audio/filters.js';
import { NODE_REGISTRY, playsNotes } from './registry.js';
import { article } from './a11y.js';
import { EVENT_ACTIONS, MEASUREMENT_ACTIONS } from './schema.js';

/** Node types a measurement clip action requires as its target (null: any or none). */
export const MEASUREMENT_TARGETS = Object.freeze({
  'noise-check': Object.freeze(['microphone', 'capture']),
  'pre-roll': null,
  stimulus: Object.freeze(['sweep']),
  capture: Object.freeze(['microphone', 'capture']),
  tail: null,
  analysis: Object.freeze(['transfer-analyzer']),
});

/**
 * Whether a filter type's biquad Q AudioParam is in dB (audio/filters.js nodeQ converts the
 * linear Q for these), so a linear lane or modulation cannot drive it.
 */
export function qIsDecibels(type) {
  return type === 'lowpass' || type === 'highpass';
}

/**
 * How a lane's values reach its AudioParam (K232, review condition 2 of oscilla-c1: declared on
 * the parameter definition, one function for the live transport, the offline render and the
 * policy): (paramDef, node params) -> value map | null. A low- or high-pass Q's lane
 * (`lane: 'db-of-q'`) is in Q and plays on the biquad's dB Q, nodeQ of each value: a step stays
 * a step, an exponential ramp in Q is a linear one in dB (exact), and a linear ramp in Q plays
 * linear in dB between its exact ends (the knob's log scale between them). null: the value as is.
 */
export function laneMap(def, params) {
  return def && def.lane === 'db-of-q' && params && qIsDecibels(params.type)
    ? (v) => nodeQ(params.type, v) : null;
}

/**
 * Whether Web Audio uses a biquad's gain AudioParam for a filter type (only the peaking and
 * shelving types do), so that driving it changes the sound: audio/filters.js usesGain, the one
 * statement of it.
 */
export const gainIsUsed = usesGain;

/**
 * Whether Web Audio uses a biquad's Q AudioParam for a filter type (the shelves ignore it):
 * audio/filters.js usesQ.
 */
export const qIsUsed = usesQ;

/**
 * How a notes clip plays, by target node type (absent: held, not played). On the percussion
 * engine (K222, ADR 0086 decisions 5 and 6) a drum lane is a note number of its key map: each
 * note is a note-on and a note-off on its voice pool, as the keys play it ('engine-notes').
 */
const NOTES_PLAY = Object.freeze({ keys: 'keys-notes', 'perc-voice': 'engine-notes' });

/** How a pattern clip plays, by target node type (absent: it does not play). */
const PATTERN_PLAY = Object.freeze({ sequence: 'sequence', oscillator: 'pattern-played' });
/**
 * How an event clip plays, by target node type and action (absent: it does not play). On an
 * Envelope a gate holds it open for the clip and a trigger (one pulse at the clip start, K023)
 * runs its attack and decay once, then releases; on a Keys node a gate opens its Gate (K060);
 * on Random and the Step Modulator a trigger is one clock tick, as a trigger edge gives.
 */
const EVENT_PLAY = Object.freeze({
  envelope: Object.freeze({ gate: 'gate', trigger: 'gate' }),
  keys: Object.freeze({ gate: 'keys-gate' }), // the Keys Gate (K060)
  random: Object.freeze({ trigger: 'clock' }),
  'step-modulator': Object.freeze({ trigger: 'clock' }),
  'step-voltage-sequencer': Object.freeze({ trigger: 'clock' }), // K226
});

/** Reasons the transport gives for what it does not play. */
export const CLIP_TARGET_TEXT = Object.freeze({
  noTarget: 'The clip has no target node.',
  patternTarget: (name) => `Pattern clips play on a Sequence or an Oscillator; this clip on `
    + `${name} is not played.`,
  eventTarget: (name) => 'Událostní klip hraje jako hradlo nebo spouštěč na obálce (Envelope), '
    + 'jako hradlo na uzlu Keys a jako spouštěč na Random nebo Step Modulator; tento klip na '
    + `${name} nehraje.`,
  notesTarget: (type) => 'A notes clip needs a target that plays notes (Keys, the XY pad or a '
    + `voice engine); ${article(type)} ${type} node does not play notes.`,
  notesUnplayed: (name) => `Notové klipy hrají na uzlu Keys a na perkusním enginu; tento klip na `
    + `${name} zůstává, ale `
    + 'nehraje se.',
  filterQ: 'Q dolní a horní propusti je ve Web Audio v dB: lineární kabel by měl špatné '
    + 'měřítko, a proto se nepoužije; kabel v log mapování (oktávy Q) a automatizace ano.',
  filterQUnused: 'Web Audio ignores Q for the low-shelf and high-shelf types; a Q lane or '
    + 'modulation on this type would change nothing, so it is not applied.',
  filterGain: 'Web Audio uses the gain of a filter only for the peaking and shelving types; a '
    + 'gain lane or modulation on this type would change nothing, so it is not applied.',
  lfoMorph: 'Prolínání tvaru platí jen pro tvar Prolínání; na jiném tvaru LFO by dráha ani '
    + 'modulace nic nezměnila, a proto se nepoužije.',
  stereoSplit: (name, label) => `${name} ${label} sets a pan law over several gains; no single `
    + 'AudioParam carries it, so a lane cannot drive it.',
});

/**
 * Parameters a lane may hold but cannot play: (node, paramDef) -> reason | null. The adapters
 * (adapters/processing.js modTarget) refuse the same parameters; the R7 test proves they agree.
 */
const LANE_LIMITS = Object.freeze({
  filter: (node, p) => {
    if (p.key === 'Q' && qIsDecibels(node.params.type) && !laneMap(p, node.params)) {
      return CLIP_TARGET_TEXT.filterQ;
    }
    if (p.key === 'Q' && !qIsUsed(node.params.type)) return CLIP_TARGET_TEXT.filterQUnused;
    if (p.key === 'gain' && !gainIsUsed(node.params.type)) return CLIP_TARGET_TEXT.filterGain;
    return null;
  },
  lfo: (node, p) => (p.key === 'morph' && node.params.shape !== 'morph'
    ? CLIP_TARGET_TEXT.lfoMorph : null), // K229: the morph acts on the morph shape only
  'stereo-split': (node, p) => CLIP_TARGET_TEXT.stereoSplit(node.metadata.name, p.label),
});

const verdict = (errors, plays, how, code, reason) => ({
  holds: errors.length === 0,
  plays,
  how: plays ? how : null,
  code: plays ? null : code,
  reason: plays ? null : reason,
  errors,
});
const err = (code, message, path, extra) => ({ code, message, path, ...extra });

/** The one clip-target policy (see the header). */
export function clipTarget(node, use, registry = NODE_REGISTRY) {
  const kind = use && use.kind;
  if (kind === 'automation') return laneTarget(node, use.param, registry);
  const def = node ? registry.get(node.type) : null;
  const name = node ? node.metadata.name : '';
  const errors = [];
  const refused = def && (kind === 'notes' ? !playsNotes(node.type, registry)
    : !def.clipKinds.includes(kind));
  if (refused) {
    errors.push(err('invalid-clip-target', kind === 'notes'
      ? CLIP_TARGET_TEXT.notesTarget(def.displayName) : `${name} cannot play ${kind} clips.`,
    'target', { nodeId: node.id }));
  }
  if (kind === 'event') {
    const action = use.action === undefined ? 'gate' : use.action;
    if (!EVENT_ACTIONS.includes(action)) {
      errors.push(err('invalid-clip', `An event clip action must be one of `
        + `${EVENT_ACTIONS.join(', ')}.`, 'payload.action'));
    }
    const held = errors.length === 0;
    if (!held) return verdict(errors, false, null, errors[0].code, errors[0].message);
    if (!node) return verdict(errors, false, null, 'no-target', CLIP_TARGET_TEXT.noTarget);
    const how = EVENT_PLAY[node.type] ? EVENT_PLAY[node.type][action] || null : null;
    return verdict(errors, !!how, how, 'event-target', CLIP_TARGET_TEXT.eventTarget(name));
  }
  if (kind === 'measurement') {
    const action = use.action;
    const need = MEASUREMENT_TARGETS[action];
    if (!MEASUREMENT_ACTIONS.includes(action)) {
      errors.push(err('invalid-clip', `A measurement clip action must be one of `
        + `${MEASUREMENT_ACTIONS.join(', ')}.`, 'payload.action'));
    } else if (need && (!node || !need.includes(node.type))) {
      errors.push(err('measurement-target', `A ${action} clip needs a ${need.join(' or ')} `
        + 'target.', 'target'));
    } else if (action === 'stimulus' && node.params.curve !== 'log') {
      errors.push(err('measurement-target', 'A measurement stimulus sweep must be logarithmic.',
        'target'));
    }
    const first = errors[0];
    return verdict(errors, !first, 'measurement', first && first.code, first && first.message);
  }
  if (errors.length) return verdict(errors, false, null, errors[0].code, errors[0].message);
  if (kind === 'notes') {
    if (!node) return verdict(errors, false, null, 'no-target', CLIP_TARGET_TEXT.noTarget);
    const how = NOTES_PLAY[node.type] || null;
    return verdict(errors, !!how, how, 'notes-unplayed', CLIP_TARGET_TEXT.notesUnplayed(name));
  }
  if (kind !== 'pattern') return verdict(errors, false, null, null, null);
  if (!node) return verdict(errors, false, null, 'no-target', CLIP_TARGET_TEXT.noTarget);
  const how = PATTERN_PLAY[node.type] || null;
  return verdict(errors, !!how, how, 'pattern-target', CLIP_TARGET_TEXT.patternTarget(name));
}

function laneTarget(node, key, registry) {
  const def = node ? registry.get(node.type) : null;
  const p = def ? def.params.find((x) => x.key === key) || null : null;
  const errors = [];
  if (!node) {
    errors.push(err('missing-node', 'An automation lane targets a node that does not exist.',
      'target.node'));
  } else if (def && (!p || !p.automatable)) {
    errors.push(err('not-automatable', `${node.metadata.name} ${p ? p.label : key} cannot be `
      + 'automated.', 'target.param', { nodeId: node.id }));
  }
  if (errors.length || !p) {
    const first = errors[0];
    return verdict(errors, false, null, first ? first.code : 'no-parameter',
      first ? first.message : `${node.metadata.name} has no ${key} parameter to automate.`);
  }
  const limit = LANE_LIMITS[node.type];
  const reason = limit ? limit(node, p) : null;
  return verdict(errors, !reason, 'automation', 'no-parameter', reason);
}

/** The verdict for a model clip: its effective target node resolved by the caller. */
export function clipUse(clip) {
  return clip.kind === 'pattern' ? { kind: 'pattern' }
    : { kind: clip.kind, action: clip.payload ? clip.payload.action : undefined };
}

/**
 * Node ids a trigger event clip targets (its own target, else its track's): the compiler plans
 * them `clocked`, so a clip clocks a Random or Step Modulator that no edge does (K023).
 */
export function triggerClipTargets(model) {
  const tl = model.timeline || {};
  const trackTarget = new Map((tl.tracks || []).map((t) => [t.id, t.target]));
  const out = new Set();
  for (const c of tl.clips || []) {
    if (c.kind !== 'event' || !c.payload || c.payload.action !== 'trigger') continue;
    const id = c.target !== null && c.target !== undefined ? c.target : trackTarget.get(c.trackId);
    if (id) out.add(id);
  }
  return out;
}
