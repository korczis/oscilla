// defineComponent: one declaration per UI component (plan issue G001, ADR 0081 decisions 1-2).
// Pure: it validates the shape of a declaration and freezes it deeply; it holds no value, reads
// no state and registers nothing. The facts that need the rest of the repository (the census of
// hooks, the state table, the link targets, the tests that name a hook, the trace) are judged by
// scripts/ui-catalog/check.mjs.
//
//   defineComponent(decl) -> frozen decl     (throws TypeError 'defineComponent(<id>): ...')
//   declarationProblems(decl) -> [text]      the same checks, as a list (empty when valid)
//     (both take { derived: true } for a node face, which only registry.js builds)
//   hooksOf(decl) -> [hook]                  the concrete data-osc hooks the declaration owns
//
// A declaration: { id, kind, label, docs, state, hooks?, pattern?, param?, effect?, in?,
//   links?: { opens?, openedBy? }, related?, disabled?: { reason } }.
//   id      the data-osc hook it owns; with `pattern`, a catalogue name that is not a hook
//   hooks   more hooks when one component carries several (a slider and its text field)
//   pattern { template: 'studio.tl.{key}', keys: [...], sites: ['src/js/...'] }: a hook built
//           at run time, expanded to one concrete hook per enumerated key; `sites` names the
//           modules that build it
//   param   a section 79 descriptor of studio/nodes/common.js (numberParam, enumParam, ...)
//   state   a canonical state path of sources.js, or { none: '<reason, five words or more>' }
//           on the kinds of STATE_NONE_KINDS
//   effect  { route | dialog | download | command | focus: '<what>' }, required with state none
//           on the kinds of EFFECT_REQUIRED_KINDS

import { validateParamValue } from '../../studio/registry.js';
import { EFFECT_REQUIRED_KINDS, EFFECT_TYPES, KINDS, STATE_NONE_KINDS } from './kinds.js';

const FIELDS = ['id', 'kind', 'label', 'docs', 'state', 'hooks', 'pattern', 'param', 'effect',
  'in', 'links', 'related', 'disabled'];
const HOOK = /^[A-Za-z][\w.-]*$/;
const KEY = /^[\w.-]+$/;
// Every field the common.js helpers give a descriptor; a hand-written object lacks some.
const PARAM_FIELDS = ['key', 'label', 'type', 'default', 'step', 'unit', 'scale', 'options',
  'nullable', 'automatable', 'modulatable', 'softRange'];

const words = (s) => (typeof s === 'string' ? s.trim().split(/\s+/).filter(Boolean).length : 0);
const isList = (v) => Array.isArray(v) && v.every((x) => typeof x === 'string' && x);

/** The concrete hooks of a declaration: its id (unless it is a pattern), hooks, expansions. */
export function hooksOf(decl) {
  const own = decl.pattern ? [] : [decl.id];
  const more = Array.isArray(decl.hooks) ? decl.hooks : [];
  const p = decl.pattern;
  const expanded = p && typeof p.template === 'string' && Array.isArray(p.keys)
    ? p.keys.map((k) => p.template.replace('{key}', k)) : [];
  return [...own, ...more, ...expanded];
}

function patternProblems(p) {
  const out = [];
  if (!p || typeof p !== 'object') return ['pattern must be an object'];
  if (typeof p.template !== 'string' || p.template.split('{key}').length !== 2
    || !HOOK.test(p.template.replace('{key}', 'k'))) {
    out.push('pattern.template must be a hook with exactly one {key}');
  }
  if (!isList(p.keys) || !p.keys.length || !p.keys.every((k) => KEY.test(k))) {
    out.push('pattern.keys must enumerate the keys');
  } else if (new Set(p.keys).size !== p.keys.length) out.push('pattern.keys repeat a key');
  if (!isList(p.sites) || !p.sites.length || !p.sites.every((s) => /^src\/js\/.+\.js$/.test(s))) {
    out.push('pattern.sites must name the src/js modules that build the hook');
  }
  return out;
}

function stateProblems(decl) {
  const { state, kind } = decl;
  if (typeof state === 'string') return state ? [] : ['state must not be empty'];
  if (!state || typeof state !== 'object' || !('none' in state)) {
    return ['state must be a state path or { none: <reason> }'];
  }
  const out = [];
  if (!STATE_NONE_KINDS.includes(kind)) {
    out.push(`state none is not allowed on the ${kind} kind (only ${STATE_NONE_KINDS.join(', ')})`);
  }
  if (words(state.none) < 5) out.push('state none needs a reason of at least five words');
  if (EFFECT_REQUIRED_KINDS.includes(kind) && decl.effect === undefined) {
    out.push(`an ${kind} with state none needs an effect`);
  }
  return out;
}

function paramProblems(param) {
  if (!param || typeof param !== 'object' || !Object.isFrozen(param)
    || PARAM_FIELDS.some((f) => !(f in param))) {
    return ['param must be a descriptor built by studio/nodes/common.js'];
  }
  const why = validateParamValue(param, param.default);
  return why ? [`param default ${JSON.stringify(param.default)} ${why}`] : [];
}

/** Every problem of a declaration's shape; empty when it is valid. */
export function declarationProblems(decl, { derived = false } = {}) {
  if (!decl || typeof decl !== 'object') return ['a declaration must be an object'];
  const out = [];
  for (const k of Object.keys(decl)) if (!FIELDS.includes(k)) out.push(`unknown field ${k}`);
  if (typeof decl.id !== 'string' || !HOOK.test(decl.id)) out.push('id must be a hook name');
  if (!KINDS.includes(decl.kind)) out.push(`unknown kind ${JSON.stringify(decl.kind)}`);
  else if (decl.kind === 'node-face' && !derived) {
    out.push('a node face is derived from the node registry, never declared');
  }
  if (typeof decl.label !== 'string' || !decl.label.trim()) out.push('label must not be empty');
  if (words(decl.docs) < 5) out.push('docs needs a sentence of at least five words');
  else if (typeof decl.label === 'string'
    && decl.docs.trim().toLowerCase() === decl.label.trim().toLowerCase()) {
    out.push('docs must not repeat the label');
  }
  if (decl.hooks !== undefined && (!isList(decl.hooks) || !decl.hooks.every((h) => HOOK.test(h)))) {
    out.push('hooks must be a list of hook names');
  }
  if (decl.pattern !== undefined) out.push(...patternProblems(decl.pattern));
  const all = hooksOf(decl);
  if (new Set(all).size !== all.length) out.push('a hook is listed twice');
  out.push(...stateProblems(decl));
  if (decl.effect !== undefined) {
    const keys = decl.effect && typeof decl.effect === 'object' ? Object.keys(decl.effect) : [];
    if (keys.length !== 1 || !EFFECT_TYPES.includes(keys[0])
      || typeof decl.effect[keys[0]] !== 'string' || !decl.effect[keys[0]].trim()) {
      out.push(`effect must be one of { ${EFFECT_TYPES.join(' | ')}: <what> }`);
    }
  }
  if (decl.param !== undefined) out.push(...paramProblems(decl.param));
  if (decl.in !== undefined && typeof decl.in !== 'string') out.push('in must be an id');
  if (decl.links !== undefined) {
    const l = decl.links;
    if (!l || typeof l !== 'object' || Object.keys(l).some((k) => !['opens', 'openedBy']
      .includes(k)) || Object.values(l).some((v) => !isList(v))) {
      out.push('links must be { opens: [ids], openedBy: [ids] }');
    }
  }
  if (decl.related !== undefined && !isList(decl.related)) out.push('related must list ids');
  if (decl.disabled !== undefined && (!decl.disabled || words(decl.disabled.reason) < 3
    || Object.keys(decl.disabled).length !== 1)) {
    out.push('disabled must be { reason: <sentence> }');
  }
  return out;
}

function deepFreeze(v) {
  if (v && typeof v === 'object' && !Object.isFrozen(v)) {
    for (const x of Object.values(v)) deepFreeze(x);
    Object.freeze(v);
  }
  return v;
}

/** Validate and freeze one declaration (a copy; the descriptor of `param` is kept as is). */
export function defineComponent(decl, opts = {}) {
  const problems = declarationProblems(decl, opts);
  if (problems.length) {
    const id = decl && typeof decl.id === 'string' ? decl.id : '?';
    throw new TypeError(`defineComponent(${id}): ${problems.join('; ')}`);
  }
  // Every field but the descriptor is plain JSON; the descriptor is already frozen.
  const copy = JSON.parse(JSON.stringify({ ...decl, param: undefined }));
  if (decl.param) copy.param = decl.param;
  return deepFreeze(copy);
}
