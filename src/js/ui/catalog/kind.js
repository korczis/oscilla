// defineKind: one declaration per instrument kind (plan issue W001, ADR 0081 decisions 2-3).
// A kind is a name of the one closed list of kinds.js (G001's KINDS); defineKind declares its
// interaction contract: the props its owner passes (section 79 descriptors of
// studio/nodes/common.js), what it reads (io), the events it builds and what each emits, its
// keys, pointer and touch, the state paths it shows, its links, ARIA, minimum target, the
// 390x844 rule, reduced motion, truth rows and the modules that implement it. Pure: it validates
// the shape and freezes it deeply; it holds no value, reads no state and registers nothing.
// The facts that need the rest of the repository (the Studio's action types, the transport's
// commands, the state table, the routes, the truth rows, the shortcuts table, the modules, the
// trace and the digest pin) are judged by scripts/ui-catalog/kinds-check.mjs.
//
//   defineKind(decl) -> frozen decl      (throws TypeError 'defineKind(<kind>): ...')
//   kindProblems(decl) -> [text]         the same checks, as a list (empty when valid)
//   instanceProblems(decl, props) -> [text]   an instance's props against its kind
//   kindShape(decl) -> { props, events, keys }   what the digest pin hashes
//   canonicalJson(value) -> text         sorted keys, no functions (the digest's serialisation)
//   prop.number|integer|enum|bool|list|ref   prop descriptors: section 79 descriptors
//   IO, ARIA_ROLES, TRANSIENT_STATE, OWNER_STATE, MIN_TARGET_PX, STATE_PATH, chordProblems
//
// A declaration: { kind, version, label, docs, props, io, events, keys, pointer, touch, state,
//   links, aria, target, layout, live, reducedMotion?, truth, impl, workspaces, transient,
//   mount, constants? }.
//   events   [{ name, does, emits: [target] | null, keyPath?: [chord] }]; a target is a Studio
//            action type (NODE_PARAM_SET), 'transport.<command>', 'notes.<call>' (the note
//            router of studio/live-notes.js) or 'view' (nothing leaves the view and its owner)
//   keys     [{ chord, event, row }]: a chord is [Mod+][Ctrl+][Alt+][Shift+]<key>, Mod being
//            Ctrl or Cmd; `row` is the id of the Keyboard shortcuts dialog row that lists it
//   pointer, touch  { events: [name], rule: '<sentence>' }
//   target   { min: px } with { exemption: '<five words or more>' } under 44 px
//   layout   { '390x844': '<rule>', '1536x1024'?: '<rule>' }
//   truth    [readout key of docs/v3/readout-truth.yaml] or { none: '<five words or more>' }
//   impl     { modules: ['src/js/ui/kinds/...'], issue?: '<the issue that adds them>' }
//   mount    { extras: [name] }: what the mount returns beyond element, set, setDisabled, destroy
//
// The five rules of W001 that a declaration's shape can hold: (1) no bare letter or digit key;
// (2) a view keeps only TRANSIENT_STATE, the owner passes OWNER_STATE; (4) the mount's base
// returns are fixed. Rules (3) and (5) and the static scan are judged on the modules.

import { boolParam, enumParam, idParam, integerParam, listParam, numberParam }
  from '../../studio/nodes/common.js';
import { validateParamValue } from '../../studio/registry.js';
import { KINDS } from './kinds.js';

const FIELDS = ['kind', 'version', 'label', 'docs', 'props', 'io', 'events', 'keys', 'pointer',
  'touch', 'state', 'links', 'aria', 'target', 'layout', 'live', 'reducedMotion', 'truth', 'impl',
  'workspaces', 'transient', 'mount', 'constants'];
// Every field the common.js helpers give a descriptor; a hand-written object lacks some.
const PARAM_FIELDS = ['key', 'label', 'type', 'default', 'step', 'unit', 'scale', 'options',
  'nullable', 'automatable', 'modulatable', 'softRange'];

/** What a kind may read or be given, a closed list. */
export const IO = Object.freeze([
  'value', // the projection of its state the owner passes (set(value))
  'commit', // the owner's commit(action) -> true | { refused }
  'transport.playhead', // transport.playhead() of studio/transport.js, read in a frame
  'transport.state', // the transport's 'state' events, passed in by the owner
  'frame-loop', // one onFrame subscriber of src/js/charts/frame-loop.js
  'live-region', // the owner's polite live region, for a refusal's sentence
  'key-map', // the target's key map (note number -> name), passed in by the owner
  'note-router', // the owner's live note call (transport.live, studio/live-notes.js)
  'registry', // the node registry's descriptors and port types (studio/registry.js)
  'analyser', // an analyser frame the owner reads from the one AudioEngine
]);

/** The WAI-ARIA roles a kind or one of its parts may take. */
export const ARIA_ROLES = Object.freeze(['button', 'checkbox', 'grid', 'gridcell', 'group',
  'img', 'listbox', 'menu', 'menuitem', 'meter', 'option', 'radio', 'radiogroup', 'region',
  'row', 'rowheader', 'columnheader', 'slider', 'spinbutton', 'status', 'switch', 'tab',
  'tablist', 'toolbar']);

/** Rule 2: the only state a view keeps. */
export const TRANSIENT_STATE = Object.freeze(['focus', 'drag-preview', 'open-entry']);
/** Rule 2: the state the owner passes in, never kept by a view. */
export const OWNER_STATE = Object.freeze(['selection', 'scroll', 'zoom', 'page', 'folding',
  'markers', 'taps', 'holds', 'latches']);
/** Rule 4: what every mount returns, before its documented extras. */
export const MOUNT_BASE = Object.freeze(['element', 'set', 'setDisabled', 'destroy']);

/** The smallest target a kind may draw without an exemption (WCAG 2.5.5). */
export const MIN_TARGET_PX = 44;

/** A state path: dotted segments, the first lower case (studio.clip, studio.param.mixer.gain). */
export const STATE_PATH = /^[a-z][a-z0-9-]*(?:\.[A-Za-z0-9][\w-]*)*$/;
const LINK = /^(?:route:[a-z][a-z0-9-]*|[A-Za-z][\w.-]*)$/;
const NAME = /^[a-z][a-z0-9-]*$/;
const IDENT = /^[A-Za-z_]\w*$/;
const EMIT = /^(?:[A-Z][A-Z0-9_]*|transport\.[A-Za-z]\w*|notes\.[A-Za-z]\w*|view)$/;
const MODULE = /^src\/js\/.+\.js$/;
const ISSUE = /^[A-Z]+\d+$/;

const MODIFIERS = ['Mod', 'Ctrl', 'Alt', 'Shift'];
const NAMED_KEYS = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Enter', 'Delete',
  'Backspace', 'PageUp', 'PageDown', 'Home', 'End', 'Escape', 'Tab', 'ContextMenu', 'Space',
  ...Array.from({ length: 12 }, (_, i) => `F${i + 1}`)];
// Keys no kind binds: Space is the transport's or the instrument's (ADR 0050, shortcuts.js
// SPACE_OWNER), Escape stops everything and Tab moves focus (GLOBAL_SHORTCUTS).
const RESERVED = ['Space', ' ', 'Escape', 'Tab'];

const words = (s) => (typeof s === 'string' ? s.trim().split(/\s+/).filter(Boolean).length : 0);
const isList = (v) => Array.isArray(v) && v.every((x) => typeof x === 'string' && x);
const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

/** The problems of one chord: its grammar, Space and the reserved keys, rule 1. */
export function chordProblems(chord) {
  if (typeof chord !== 'string' || !chord) return ['zkratka musí být neprázdný řetězec'];
  const parts = chord === '+' ? ['+'] : chord.split('+');
  const key = parts.pop() || '+';
  const mods = parts;
  const out = [];
  const order = mods.map((m) => MODIFIERS.indexOf(m));
  if (order.some((i) => i < 0) || order.some((i, k) => k && i <= order[k - 1])) {
    out.push(`zkratka ${chord}: modifikátory jsou ${MODIFIERS.join(', ')}, v tomto pořadí, `
      + 'každý nejvýš jednou');
  }
  if (!NAMED_KEYS.includes(key) && !(key.length === 1 && key !== ' ')) {
    out.push(`zkratka ${chord}: ${JSON.stringify(key)} není název klávesy`);
  }
  if (RESERVED.includes(key)) {
    out.push(`zkratka ${chord}: ${key === ' ' ? 'Space' : key} nesmí být klávesou žádného druhu (${
      key === 'Space' || key === ' ' ? 'Space patří transportu nebo nástroji'
        : 'Escape a Tab jsou globální klávesy'})`);
  }
  if (/^[A-Za-z0-9]$/.test(key) && !mods.some((m) => m !== 'Shift')) {
    out.push(`zkratka ${chord}: samotné písmeno nebo číslice patří zapnuté klávesnici a `
      + 'zkratkám pracovních ploch (pravidlo 1); udělejte z ní viditelné tlačítko nebo položku '
      + 'nabídky');
  }
  if (/^[a-z]$/.test(key)) out.push(`zkratka ${chord}: písmeno se píše velké`);
  return out;
}

function paramProblems(p, where) {
  if (!isObj(p) || !Object.isFrozen(p) || PARAM_FIELDS.some((f) => !(f in p))) {
    return [`${where} musí být deskriptor vytvořený pomocí prop.* (studio/nodes/common.js)`];
  }
  const why = validateParamValue(p, p.default);
  return why ? [`${where}: výchozí hodnota ${JSON.stringify(p.default)} ${why}`] : [];
}

function eventsProblems(decl) {
  const out = [];
  if (!Array.isArray(decl.events) || !decl.events.length) {
    return ['events musí vyjmenovat události'];
  }
  const names = new Set();
  for (const e of decl.events) {
    const n = isObj(e) && typeof e.name === 'string' ? e.name : '?';
    if (!isObj(e) || !NAME.test(n)) { out.push('událost potřebuje název'); continue; }
    if (names.has(n)) out.push(`událost ${n} je deklarována dvakrát`);
    names.add(n);
    for (const k of Object.keys(e)) {
      if (!['name', 'does', 'emits', 'keyPath'].includes(k)) {
        out.push(`událost ${n}: neznámé pole ${k}`);
      }
    }
    if (words(e.does) < 5) out.push(`událost ${n}: does potřebuje větu o nejméně pěti slovech`);
    if (e.emits !== null && (!isList(e.emits) || !e.emits.length
      || e.emits.some((t) => !EMIT.test(t)))) {
      out.push(`událost ${n}: emits je null, nebo seznam typů akcí, transport.<command>, `
        + 'notes.<call> či view');
    }
    if (e.keyPath !== undefined && (!isList(e.keyPath) || !e.keyPath.length)) {
      out.push(`událost ${n}: keyPath vyjmenovává zkratky, které k ní vedou`);
    }
  }
  return out;
}

function keysProblems(decl) {
  const out = [];
  if (!Array.isArray(decl.keys)) return ['keys musí být seznam { chord, event, row }'];
  const events = new Set((decl.events || []).map((e) => e && e.name));
  const seen = new Set();
  for (const k of decl.keys) {
    if (!isObj(k) || Object.keys(k).sort().join() !== 'chord,event,row') {
      out.push('klávesa je přesně { chord, event, row }');
      continue;
    }
    out.push(...chordProblems(k.chord));
    if (seen.has(k.chord)) out.push(`zkratka ${k.chord} je použita dvakrát`);
    seen.add(k.chord);
    if (!events.has(k.event)) out.push(`zkratka ${k.chord}: událost ${k.event} není deklarována`);
    if (!NAME.test(k.row)) out.push(`zkratka ${k.chord}: row musí být id řádku tabulky zkratek`);
  }
  return out;
}

/** Every pointer and touch event is reached by a key: bound directly, or through its keyPath. */
function reachProblems(decl) {
  const out = [];
  const chords = new Set((Array.isArray(decl.keys) ? decl.keys : []).map((k) => k && k.chord));
  const bound = new Set((Array.isArray(decl.keys) ? decl.keys : []).map((k) => k && k.event));
  const byName = new Map((Array.isArray(decl.events) ? decl.events : [])
    .filter(isObj).map((e) => [e.name, e]));
  for (const input of ['pointer', 'touch']) {
    const v = decl[input];
    if (!isObj(v) || !isList(v.events) || words(v.rule) < 5
      || Object.keys(v).sort().join() !== 'events,rule') {
      out.push(`${input} musí být { events: [name], rule: <věta o pěti a více slovech> }`);
      continue;
    }
    for (const n of v.events) {
      const e = byName.get(n);
      if (!e) { out.push(`${input}: událost ${n} není deklarována`); continue; }
      const path = Array.isArray(e.keyPath) ? e.keyPath : [];
      const missing = path.filter((c) => !chords.has(c));
      if (missing.length) {
        out.push(`událost ${n}: keyPath ${missing.join(', ')} není klávesou druhu`);
      }
      if (!bound.has(n) && !path.length) {
        out.push(`${input}: událost ${n} nemá klávesu; navažte ji nebo jí dejte keyPath`);
      }
    }
  }
  for (const e of byName.values()) {
    if (Array.isArray(e.keyPath) && bound.has(e.name)) {
      out.push(`událost ${e.name}: navázaná událost nepotřebuje keyPath`);
    }
  }
  return out;
}

function sentence(v, n) { return words(v) >= n; }

/** Every problem of a kind declaration's shape; empty when it is valid. */
export function kindProblems(decl) {
  if (!isObj(decl)) return ['deklarace druhu musí být objekt'];
  const out = [];
  for (const k of Object.keys(decl)) if (!FIELDS.includes(k)) out.push(`neznámé pole ${k}`);
  if (!KINDS.includes(decl.kind)) out.push(`neznámý druh ${JSON.stringify(decl.kind)} (kinds.js)`);
  else if (decl.kind === 'node-face') out.push('tvář uzlu se odvozuje, nikdy není deklarací druhu');
  if (!Number.isInteger(decl.version) || decl.version < 1) out.push('version musí být 1 nebo víc');
  if (typeof decl.label !== 'string' || !decl.label.trim()) out.push('label nesmí být prázdný');
  if (!sentence(decl.docs, 5)) out.push('docs potřebuje větu o nejméně pěti slovech');

  if (!Array.isArray(decl.props)) out.push('props musí být seznam deskriptorů vlastností');
  else {
    const keys = new Set();
    for (const p of decl.props) {
      const key = isObj(p) ? p.key : '?';
      out.push(...paramProblems(p, `vlastnost ${key}`));
      if (keys.has(key)) out.push(`vlastnost ${key} je deklarována dvakrát`);
      keys.add(key);
    }
  }
  if (!isList(decl.io) || !decl.io.length) out.push('io musí vyjmenovat, co druh čte');
  else {
    for (const v of decl.io) {
      if (!IO.includes(v)) out.push(`io ${v} není jedním z ${IO.join(', ')}`);
    }
    if (new Set(decl.io).size !== decl.io.length) out.push('io uvádí položku dvakrát');
  }
  out.push(...eventsProblems(decl), ...keysProblems(decl), ...reachProblems(decl));

  if (!isList(decl.state) || !decl.state.length) {
    out.push('state musí vyjmenovat své stavové cesty');
  } else {
    for (const s of decl.state) {
      if (!STATE_PATH.test(s)) out.push(`stav ${s} je mimo gramatiku stavových cest`);
    }
  }
  const l = decl.links;
  if (!isObj(l) || Object.keys(l).sort().join() !== 'openedBy,opens'
    || !Array.isArray(l.opens) || !Array.isArray(l.openedBy)) {
    out.push('links musí být { opens: [link], openedBy: [link] }');
  } else {
    for (const t of [...l.opens, ...l.openedBy]) {
      if (typeof t !== 'string' || !LINK.test(t)) {
        out.push(`odkaz ${t} není route:<workspace> ani id katalogu`);
      }
    }
  }
  const a = decl.aria;
  if (!isObj(a) || !ARIA_ROLES.includes(a.role)) {
    out.push(`aria.role musí být jedna z rolí ${ARIA_ROLES.join(', ')}`);
  } else {
    if (!sentence(a.name, 5)) out.push('aria.name říká, jak se skládá přístupný název');
    for (const [part, role] of Object.entries(isObj(a.parts) ? a.parts : {})) {
      if (!ARIA_ROLES.includes(role)) {
        out.push(`aria.parts.${part}: ${role} není povolená role`);
      }
    }
  }
  const t = decl.target;
  if (!isObj(t) || typeof t.min !== 'number' || !(t.min > 0)) out.push('target.min musí být v px');
  else if (t.min < MIN_TARGET_PX && !sentence(t.exemption, 5)) {
    out.push(`target.min ${t.min} je pod ${MIN_TARGET_PX} px bez výjimky o nejméně pěti `
      + 'slovech');
  }
  if (!isObj(decl.layout) || !sentence(decl.layout['390x844'], 3)
    || Object.keys(decl.layout).some((k) => !['390x844', '1536x1024'].includes(k))) {
    out.push('layout musí uvést pravidlo pro 390x844');
  }
  if (typeof decl.live !== 'boolean') out.push('live musí být true nebo false');
  if (decl.live && !sentence(decl.reducedMotion, 5)) {
    out.push('živý druh uvádí pravidlo pro omezený pohyb (pět a více slov)');
  }
  const tr = decl.truth;
  if (!(isList(tr) && tr.length) && !(isObj(tr) && Object.keys(tr).join() === 'none'
    && sentence(tr.none, 5))) {
    out.push('truth musí vyjmenovat řádky readout-truth, nebo být { none: <důvod o pěti a více '
      + 'slovech> }');
  }
  const impl = decl.impl;
  if (!isObj(impl) || !isList(impl.modules) || !impl.modules.length
    || impl.modules.some((m) => !MODULE.test(m))
    || (impl.issue !== undefined && !ISSUE.test(impl.issue))) {
    out.push('impl musí být { modules: [src/js/...js], issue?: <id úkolu plánu> }');
  }
  if (!isList(decl.workspaces) || !decl.workspaces.length) {
    out.push('workspaces musí jmenovat, kde je druh připojen');
  }
  if (!isList(decl.transient) || decl.transient.some((s) => !TRANSIENT_STATE.includes(s))) {
    const kept = isList(decl.transient)
      ? decl.transient.filter((s) => !TRANSIENT_STATE.includes(s)) : [];
    out.push(`transient je to, co si pohled drží, jen ${TRANSIENT_STATE.join(', ')} (pravidlo 2)${
      kept.length ? `; ${kept.join(', ')} předává vlastník` : ''}`);
  }
  const m = decl.mount;
  if (!isObj(m) || !Array.isArray(m.extras) || m.extras.some((x) => !IDENT.test(x)
    || MOUNT_BASE.includes(x)) || Object.keys(m).join() !== 'extras') {
    out.push(`mount musí být { extras: [name] } nad rámec ${MOUNT_BASE.join(', ')} (pravidlo 4)`);
  }
  if (decl.constants !== undefined && (!isObj(decl.constants)
    || Object.values(decl.constants).some((v) => typeof v !== 'number' || !Number.isFinite(v)))) {
    out.push('constants musí přiřazovat názvům konečná čísla');
  }
  return out;
}

/** The problems of an instance's props against its kind (unknown keys, values out of range). */
export function instanceProblems(decl, props) {
  if (!isObj(props)) return ['props musí být objekt'];
  const byKey = new Map(decl.props.map((p) => [p.key, p]));
  const out = [];
  for (const [k, v] of Object.entries(props)) {
    const p = byKey.get(k);
    if (!p) { out.push(`vlastnost ${k} není vlastností druhu ${decl.kind}`); continue; }
    const why = validateParamValue(p, v);
    if (why) out.push(`vlastnost ${k}: ${JSON.stringify(v)} ${why}`);
  }
  return out;
}

/** The serialisation the digest hashes: sorted keys, no functions, RegExp and +-Infinity named. */
export function canonicalJson(value) {
  const walk = (v) => {
    if (typeof v === 'function' || v === undefined) return undefined;
    if (v instanceof RegExp) return `/${v.source}/${v.flags}`;
    if (typeof v === 'number' && !Number.isFinite(v)) return String(v);
    if (Array.isArray(v)) return v.map((x) => (walk(x) === undefined ? null : walk(x)));
    if (v && typeof v === 'object') {
      const out = {};
      for (const k of Object.keys(v).sort()) {
        const w = walk(v[k]);
        if (w !== undefined) out[k] = w;
      }
      return out;
    }
    return v;
  };
  return JSON.stringify(walk(value));
}

/** The shape the digest pins: its props, events and keys. */
export const kindShape = (decl) => ({ props: decl.props, events: decl.events, keys: decl.keys });

function deepFreeze(v) {
  if (v && typeof v === 'object' && !Object.isFrozen(v) && !(v instanceof RegExp)) {
    for (const x of Object.values(v)) deepFreeze(x);
    Object.freeze(v);
  }
  return v;
}

/** Validate and freeze one kind declaration (the prop descriptors are already frozen). */
export function defineKind(decl) {
  const problems = kindProblems(decl);
  if (problems.length) {
    const k = decl && typeof decl.kind === 'string' ? decl.kind : '?';
    throw new TypeError(`defineKind(${k}): ${problems.join('; ')}`);
  }
  return deepFreeze({ ...decl, props: Object.freeze([...decl.props]) });
}

/** A reference to a model entity by id (a clip, a node, a parameter key), or null. */
const REF = /^[A-Za-z][\w.-]*$/;

/** Prop descriptors: the section 79 descriptors of studio/nodes/common.js, one per helper. */
export const prop = Object.freeze({
  number: numberParam,
  integer: integerParam,
  enum: enumParam,
  bool: boolParam,
  list: listParam,
  ref: (key, label, opts = {}) => idParam(key, label, { pattern: REF, ...opts }),
});
