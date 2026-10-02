// Studio typed ports and connection rules (spec §31-§36, §143, §191-§192). Pure: plain data in,
// plain data out; no DOM, no Web Audio, no globals.
//
// A port definition is frozen plain data:
//   { id, direction: 'in'|'out', type: AUDIO|CONTROL|TRIGGER|ANALYSIS, role, label,
//     multiple /* inputs: accepts more than one edge */, required /* inputs: warn when open */,
//     liveInput /* outputs: carries a physical input (microphone), never reaches the output */,
//     param /* PARAMETER inputs only: { key, unit, range: [lo, hi], mapping: 'linear'|'log' } */ }
// Port ids are unique per node type and direction; an input and an output may share an id
// (the spec's own example is `osc-1.audio → filter-1.audio`).
//
// Roles are metadata beyond the type (§192), so the type set stays at four:
//   AUDIO     SIGNAL (processing path) | TAP (analysis side-chain input; does not alter the path)
//   CONTROL   SIGNAL (modulator output) | PARAMETER (input bound to one node parameter, §34)
//   TRIGGER   SIGNAL
//   ANALYSIS  REFERENCE (digital stimulus) | OBSERVED (captured signal) | RESULT (analysis output)
// AUDIO→AUDIO accepts SIGNAL and TAP targets alike; ANALYSIS roles must match exactly, so a
// reference can never be wired into an observed input (§191).
//
// INVARIANTS: canConnect() decides from the two port definitions (and node identity in
// `context`) only; graph-level rules (multiplicity, duplicates, cycles) live in validate.js.
// Modulation properties belong to the edge (§35, §104), never to node parameters.

export const PORT_TYPES = Object.freeze({
  AUDIO: 'AUDIO',
  CONTROL: 'CONTROL',
  TRIGGER: 'TRIGGER',
  ANALYSIS: 'ANALYSIS',
});
export const PORT_TYPE_LIST = Object.freeze(Object.values(PORT_TYPES));

export const DIRECTIONS = Object.freeze({ IN: 'in', OUT: 'out' });

export const PORT_ROLES = Object.freeze({
  SIGNAL: 'SIGNAL',
  TAP: 'TAP',
  PARAMETER: 'PARAMETER',
  REFERENCE: 'REFERENCE',
  OBSERVED: 'OBSERVED',
  RESULT: 'RESULT',
});

/** Roles legal for each port type (first entry is the default). */
export const ROLES_BY_TYPE = Object.freeze({
  AUDIO: Object.freeze(['SIGNAL', 'TAP']),
  CONTROL: Object.freeze(['SIGNAL', 'PARAMETER']),
  TRIGGER: Object.freeze(['SIGNAL']),
  ANALYSIS: Object.freeze(['OBSERVED', 'REFERENCE', 'RESULT']),
});

/**
 * Visual semantics per type (§32, §69): distinguishable without colour. `shape` is the port
 * glyph, `cable` the stroke pattern of an edge of that type.
 */
export const PORT_VISUALS = Object.freeze({
  AUDIO: Object.freeze({ shape: 'circle', cable: 'solid', noun: 'audio' }),
  CONTROL: Object.freeze({ shape: 'diamond', cable: 'dashed', noun: 'control' }),
  TRIGGER: Object.freeze({ shape: 'triangle', cable: 'pulse', noun: 'trigger' }),
  ANALYSIS: Object.freeze({ shape: 'square', cable: 'dash-dot', noun: 'analysis' }),
});

const ROLE_NOUNS = Object.freeze({
  REFERENCE: 'reference',
  OBSERVED: 'observed',
  RESULT: 'result',
});

/** Largest |depth| or |offset| of a log-mapped modulation edge, in octaves. */
export const MOD_LOG_MAX_OCTAVES = 10;
export const MOD_POLARITIES = Object.freeze(['bipolar', 'unipolar']);
export const MOD_MAPPINGS = Object.freeze(['linear', 'log']);

// ---------------------------------------------------------------- port definitions

/**
 * A frozen port definition with defaults filled in. Throws TypeError on an impossible
 * definition (registry authoring error, never user input).
 */
export function definePort({
  id, direction, type, role, label, multiple = false, required = false, liveInput = false,
  param = null,
}) {
  if (typeof id !== 'string' || !/^[A-Za-z][A-Za-z0-9_]{0,31}$/.test(id)) {
    throw new TypeError(`definePort: invalid port id ${String(id)}`);
  }
  if (direction !== 'in' && direction !== 'out') {
    throw new TypeError(`definePort: ${id} has no direction`);
  }
  if (!PORT_TYPE_LIST.includes(type)) throw new TypeError(`definePort: ${id} has no type`);
  const r = role || (direction === 'in' && type === 'CONTROL' ? 'PARAMETER'
    : ROLES_BY_TYPE[type][0]);
  if (!ROLES_BY_TYPE[type].includes(r)) {
    throw new TypeError(`definePort: role ${r} is not legal for ${type} (${id})`);
  }
  if ((r === 'PARAMETER') !== !!param) {
    throw new TypeError(`definePort: ${id} — PARAMETER ports and only they carry param`);
  }
  return Object.freeze({
    id,
    direction,
    type,
    role: r,
    label: label || id,
    multiple: direction === 'in' ? !!multiple : true,
    required: direction === 'in' ? !!required : false,
    liveInput: direction === 'out' ? !!liveInput : false,
    param: param ? Object.freeze({ ...param, range: Object.freeze([...param.range]) }) : null,
  });
}

/**
 * The CONTROL input generated for a modulatable parameter (§34). Several modulators may target
 * one parameter; their contributions add (each with its own edge depth).
 */
export function parameterPort(paramDef) {
  return definePort({
    id: paramDef.key,
    direction: 'in',
    type: 'CONTROL',
    role: 'PARAMETER',
    label: paramDef.label,
    multiple: true,
    param: {
      key: paramDef.key,
      unit: paramDef.unit || '',
      range: [paramDef.min, paramDef.max],
      mapping: paramDef.scale === 'log' ? 'log' : 'linear',
    },
  });
}

// ---------------------------------------------------------------- accessible text

/** "Audio output", "Cutoff control input", "Reference analysis input" (§32, §143). */
export function describePort(port) {
  if (!port) return 'Unknown port';
  const dir = port.direction === 'in' ? 'input' : 'output';
  if (port.role === 'PARAMETER') return `${cap(port.label)} control input`;
  const noun = PORT_VISUALS[port.type] ? PORT_VISUALS[port.type].noun : 'unknown';
  const role = ROLE_NOUNS[port.role];
  if (role) return `${cap(role)} analysis ${dir}`;
  if (port.role === 'TAP') return 'Audio analysis tap input';
  const named = port.label && port.label.toLowerCase() !== noun ? `${cap(port.label)} ` : '';
  return named ? `${named}${noun} ${dir}` : `${cap(noun)} ${dir}`;
}

/**
 * Screen-reader label for a port (§143): "Audio output port, connected to Filter 1",
 * "Filter 1 cutoff control input, available", "Filter 1 Q control input, available". After a
 * node name the description's first word is lower-cased only when it is an ordinary word: a
 * display name written in capitals ("Q", "LFO", "RTA") keeps its case. `connections` are
 * display names of the nodes at the other end.
 */
export function portAccessibleLabel(port, { nodeName = '', connections = [] } = {}) {
  const base = describePort(port);
  const subject = nodeName ? `${nodeName} ${lower(base)}` : `${base} port`;
  if (!connections.length) return `${subject}, available`;
  return `${subject}, connected to ${connections.join(', ')}`;
}

// ---------------------------------------------------------------- compatibility

const TYPE_REASONS = Object.freeze({
  AUDIO: {
    CONTROL: 'Audio output cannot connect to a control input. Modulate parameters from an LFO, '
      + 'Envelope, Random or Step Modulator.',
    TRIGGER: 'Audio output cannot connect to a trigger input.',
    ANALYSIS: 'Audio output cannot connect to an analysis input. Route it through a Capture '
      + 'node first.',
  },
  CONTROL: {
    AUDIO: 'Control output cannot connect to an audio input. Connect it to a parameter '
      + '(diamond) input.',
    TRIGGER: 'Control output cannot connect to a trigger input.',
    ANALYSIS: 'Control output cannot connect to an analysis input.',
  },
  TRIGGER: {
    AUDIO: 'Trigger output cannot connect to an audio input.',
    CONTROL: 'Trigger output cannot connect to a control input. Use it to gate an Envelope or '
      + 'clock a modulator.',
    ANALYSIS: 'Trigger output cannot connect to an analysis input.',
  },
  ANALYSIS: {
    AUDIO: 'Analysis output cannot connect to an audio input: analysis data is not a sound '
      + 'signal.',
    CONTROL: 'Analysis output cannot connect to a control input.',
    TRIGGER: 'Analysis output cannot connect to a trigger input.',
  },
});

/** The reason text for every (source type, target type) pair; null where allowed. */
export function typeCompatibility(sourceType, targetType) {
  if (sourceType === targetType) return null;
  const row = TYPE_REASONS[sourceType];
  return (row && row[targetType]) || 'Unknown port type.';
}

function roleReason(src, tgt) {
  if (src.role === 'REFERENCE' && tgt.role === 'OBSERVED') {
    return 'A reference signal cannot connect to an observed input. The Transfer Analyzer takes '
      + 'the digital stimulus on REFERENCE and the capture on OBSERVED.';
  }
  if (src.role === 'OBSERVED' && tgt.role === 'REFERENCE') {
    return 'An observed capture cannot connect to a reference input. The reference must be the '
      + 'digital stimulus itself.';
  }
  return `A ${ROLE_NOUNS[src.role] || 'analysis'} output cannot connect to a `
    + `${ROLE_NOUNS[tgt.role] || 'analysis'} input.`;
}

/**
 * canConnect(sourcePortDef, targetPortDef, { sourceNodeId, targetNodeId }) ->
 *   { allowed: true, code: null, reason: null, signalType }
 *   | { allowed: false, code, reason }
 * codes: unknown-port, wrong-direction, self-connection, type-mismatch, role-mismatch.
 */
export function canConnect(source, target, context = {}) {
  const no = (code, reason) => ({ allowed: false, code, reason });
  if (!source || !target) return no('unknown-port', 'Unknown port.');
  if (source.direction !== 'out') {
    return no('wrong-direction', `${describePort(source)} is an input; a connection starts at `
      + 'an output.');
  }
  if (target.direction !== 'in') {
    return no('wrong-direction', `${describePort(target)} is an output; a connection ends at `
      + 'an input.');
  }
  if (context.sourceNodeId != null && context.sourceNodeId === context.targetNodeId) {
    return no('self-connection', 'A node cannot connect to itself.');
  }
  const typeReason = typeCompatibility(source.type, target.type);
  if (typeReason) return no('type-mismatch', typeReason);
  if (source.type === 'ANALYSIS' && source.role !== target.role) {
    return no('role-mismatch', roleReason(source, target));
  }
  return { allowed: true, code: null, reason: null, signalType: source.type };
}

// ---------------------------------------------------------------- edge properties

/** Edge property fields per signal type (§35-§36). Every edge can be muted. */
export const EDGE_PROPERTY_FIELDS = Object.freeze({
  AUDIO: Object.freeze(['muted']),
  CONTROL: Object.freeze(['muted', 'depth', 'polarity', 'mapping', 'offset']),
  TRIGGER: Object.freeze(['muted']),
  ANALYSIS: Object.freeze(['muted']),
});

function span(param) {
  return param ? param.range[1] - param.range[0] : 0;
}

/**
 * Default properties of a new edge. A modulation edge gets the target parameter's `modDepth`
 * hint (registry), else a tenth of its range, bipolar, linear mapping (depth in the
 * parameter's unit, as the engine's LFO depth gain in Hz), offset 0.
 */
export function defaultEdgeProps(signalType, targetPort, paramDef = null) {
  if (signalType !== 'CONTROL') return { muted: false };
  const p = targetPort && targetPort.param;
  const hint = paramDef && Number.isFinite(paramDef.modDepth) ? paramDef.modDepth : null;
  const depth = hint ?? (p ? Number((span(p) / 10).toPrecision(3)) : 1);
  return { muted: false, depth, polarity: 'bipolar', mapping: 'linear', offset: 0 };
}

/**
 * Validate edge properties against the signal type and target port.
 * -> { ok, props (complete, defaults filled), errors: [{ field, text }] }
 * Linear mapping: depth and offset in the parameter's unit, |value| <= its range span.
 * Log mapping (only for logarithmic parameters such as frequency): octaves, |value| <= 10.
 */
export function validateEdgeProps(props, signalType, targetPort, paramDef = null) {
  const errors = [];
  const fields = EDGE_PROPERTY_FIELDS[signalType];
  if (!fields) return { ok: false, props: null, errors: [{ field: '', text: 'unknown type' }] };
  if (props != null && (typeof props !== 'object' || Array.isArray(props))) {
    return { ok: false, props: null, errors: [{ field: '', text: 'must be an object' }] };
  }
  const given = props || {};
  for (const k of Object.keys(given)) {
    if (!fields.includes(k)) {
      errors.push({ field: k, text: signalType === 'CONTROL' ? 'unknown edge property'
        : `${PORT_VISUALS[signalType].noun} connections have no ${k}` });
    }
  }
  const out = { ...defaultEdgeProps(signalType, targetPort, paramDef) };
  for (const k of fields) if (given[k] !== undefined) out[k] = given[k];
  if (typeof out.muted !== 'boolean') {
    errors.push({ field: 'muted', text: 'must be true or false' });
  }
  if (signalType === 'CONTROL') {
    const p = targetPort && targetPort.param;
    if (!MOD_POLARITIES.includes(out.polarity)) {
      errors.push({ field: 'polarity', text: `must be one of ${MOD_POLARITIES.join(', ')}` });
    }
    if (!MOD_MAPPINGS.includes(out.mapping)) {
      errors.push({ field: 'mapping', text: `must be one of ${MOD_MAPPINGS.join(', ')}` });
    } else if (out.mapping === 'log' && (!p || p.mapping !== 'log')) {
      errors.push({ field: 'mapping', text: 'log mapping needs a logarithmic parameter '
        + '(such as a frequency)' });
    }
    const limit = out.mapping === 'log' ? MOD_LOG_MAX_OCTAVES : span(p) || 1;
    const unit = out.mapping === 'log' ? 'octaves' : (p && p.unit) || '';
    for (const k of ['depth', 'offset']) {
      const v = out[k];
      if (typeof v !== 'number' || !Number.isFinite(v)) {
        errors.push({ field: k, text: 'must be a finite number' });
      } else if (Math.abs(v) > limit) {
        errors.push({ field: k, text: `must be within ±${limit}${unit ? ` ${unit}` : ''}` });
      }
    }
  }
  return { ok: errors.length === 0, props: errors.length ? null : out, errors };
}

function cap(s) {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}

/**
 * Lower-case the first letter of a sentence-initial word, unless that word is an acronym or a
 * symbol written in capitals (a single capital letter, or an upper-case letter after the first):
 * "Cutoff control input" -> "cutoff control input", "Q control input" stays.
 */
function lower(s) {
  if (!s) return s;
  const word = s.split(/\s/, 1)[0];
  const keep = /[A-Z]/.test(word.slice(1)) || /^[A-Z]$/.test(word);
  return keep ? s : s[0].toLowerCase() + s.slice(1);
}
