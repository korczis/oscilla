// The clip-target policy (R7, docs/v4/completion-ledger.md): which node, or node parameter, a
// timeline clip or automation lane may target, and how the transport plays it there. Pure: plain
// data in, plain data out. It is the ONE answer read by
//   the store         timeline.js clipRules (every action and every import) and canHostClip;
//                     validate.js and actions.js for automation lanes
//   the timeline UI   timeline-view.js trackTargetOptions / clipTargetOptions / addClipAction,
//                     automation-view.js automatableTargets, automation.js automateParameter and
//                     the Inspector's Automate button
//   the transport     transport.js clipPlayReason, the oscillators it pattern-plays, the
//                     envelopes it gates, and the parameters its lanes own and drive
//
//   clipTarget(node, use, registry = NODE_REGISTRY) -> { holds, plays, how, code, reason,
//                                                        errors }
//     node    the model node the clip plays on (its own target, else its track's), or null
//     use     { kind: 'pattern' | 'event' | 'measurement', action? } for a clip (its
//             payload.action; an event clip without one is a gate), or
//             { kind: 'automation', param } for a lane
//     holds   the store keeps it: a model with it validates, a file saved with it loads
//     plays   the transport plays it, as `how`: 'sequence' (compileSequence into the Sequence),
//             'pattern-played' (the Oscillator's pattern bus), 'gate' (the Envelope's gate),
//             'measurement' (data for the measurement hook) or 'automation' (the lane drives
//             the parameter's AudioParam)
//     code, reason   null when it plays; otherwise the store's first error (holds false) or the
//             transport's unplayed code and reason (holds true)
//     errors  the store's errors: [{ code, message, path, nodeId? }] (path relative to the clip)
//
// Holding and playing differ on purpose. The store holds what the registry declares (a node
// type's clipKinds, a parameter's `automatable`) so that a file saved by an earlier build keeps
// loading; the transport plays a subset of it; the UI offers only what plays, and shows what is
// held but not played with this reason. The subset is the table below: pattern clips play on a
// Sequence or an Oscillator, event clips only as gates on an Envelope, measurement clips always
// (as data), and a lane plays unless no single AudioParam carries its parameter.
// tests/unit/v4-clip-target-policy.test.mjs proves the store, the UI and the transport give this
// verdict for every node type, clip kind, action and parameter in the registry.

import { NODE_REGISTRY } from './registry.js';
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

/** How a pattern clip plays, by target node type (absent: it does not play). */
const PATTERN_PLAY = Object.freeze({ sequence: 'sequence', oscillator: 'pattern-played' });

/** Reasons the transport gives for what it does not play. */
export const CLIP_TARGET_TEXT = Object.freeze({
  noTarget: 'The clip has no target node.',
  patternTarget: (name) => `Pattern clips play on a Sequence or an Oscillator; this clip on `
    + `${name} is not played.`,
  eventTarget: (name) => `Only gate events on an Envelope are played; this clip on ${name} is `
    + 'not.',
  filterQ: 'Low-/high-pass Q is a dB AudioParam in Web Audio; a linear Q modulation would be '
    + 'mis-scaled, so it is not applied.',
  stereoSplit: (name, label) => `${name} ${label} sets a pan law over several gains; no single `
    + 'AudioParam carries it, so a lane cannot drive it.',
});

/**
 * Parameters a lane may hold but cannot play: (node, paramDef) -> reason | null. The adapters
 * (adapters/nodes.js modTarget) refuse the same parameters; the R7 test proves they agree.
 */
const LANE_LIMITS = Object.freeze({
  filter: (node, p) => (p.key === 'Q' && qIsDecibels(node.params.type)
    ? CLIP_TARGET_TEXT.filterQ : null),
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
  if (def && !def.clipKinds.includes(kind)) {
    errors.push(err('invalid-clip-target', `${name} cannot play ${kind} clips.`, 'target',
      { nodeId: node.id }));
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
    const gate = node.type === 'envelope' && action === 'gate';
    return verdict(errors, gate, 'gate', 'event-target', CLIP_TARGET_TEXT.eventTarget(name));
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
