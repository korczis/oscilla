// The Synth deep link (plan K106 part): `#m=synth[&yt=<tab>][&ye=<engine>][&yp=<preset>]
// [&yv=<values>][&yc=<cables>]`. Its own keys, so a Synth link never routes to Studio (`sv` is
// a Studio key):
//   yt  the tab ('panel' | 'engines' | 'xy')
//   ye  the engine module the keys play on the Engines tab (panels/engines.js)
//   yp  a preset id (synth/presets.js)
//   yv  values that differ from the preset, 'module.param:value' joined by ','
//   yc  user cables, 'module.port>module.port' joined by ','; a cable whose props differ from
//       the ones the panel gives it carries them after '@' as 'key:value' joined by ';'
//       (depth, polarity, mapping, offset, muted; synth/link.js, review S7)
// Strict, like the Studio and recipe links: one unknown preset, module, parameter, value or jack
// refuses the whole link with a Czech sentence (project.czech-prose; K239 translated them), and
// nothing of it is applied. So does a link whose
// cables cannot all apply (K238/K239): two cables into an input that accepts one connection
// (the registry port is not `multiple`: a filter's audio, the S&H Clock), one cable twice, or a
// cable canConnect refuses (a control into a trigger); before, it decoded as ok and the BATCH
// was refused or the cable dropped in silence.
//
//   decodeSynthLink(hash, panel, presets) -> { ok: true, link } | { ok: false, reason } | null
//   encodeSynthLink(link) -> 'm=synth&...'   withoutSynthParams(hash) -> hash

import { NODE_REGISTRY, validateParamValue } from '../studio/registry.js';
import {
  EDGE_PROPERTY_FIELDS, MOD_MAPPINGS, MOD_POLARITIES, canConnect, validateEdgeProps,
} from '../studio/ports.js';

export const SYNTH_LINK_MODE = 'synth';
export const SYNTH_LINK_KEYS = Object.freeze({ tab: 'yt', engine: 'ye', preset: 'yp',
  values: 'yv', cables: 'yc' });
export const SYNTH_TABS = Object.freeze(['panel', 'engines', 'xy', 'drums']); // drums: K222
const MAX_ITEMS = 128;

const strip = (h) => String(h || '').replace(/^#/, '');
const fmt = (v) => (typeof v === 'number' ? String(Number(v.toPrecision(6))) : String(v));
const CABLE_PROPS = Object.freeze(['depth', 'polarity', 'mapping', 'offset', 'muted']);
const cableItem = ([a, b, props]) => `${a}>${b}${props && Object.keys(props).length
  ? `@${Object.entries(props).map(([k, v]) => `${k}:${fmt(v)}`).join(';')}` : ''}`;

/** A cable's '@' props for input jack `inp` of the panel: { props } | { reason }. */
function cablePropsOf(text, inp, panel) {
  const node = panel.module(inp.module).node;
  const port = NODE_REGISTRY.port(node, inp.port, 'in');
  const out = {};
  for (const pair of text.split(';')) {
    const m = /^([a-z]+):(.+)$/.exec(pair);
    if (!m || !CABLE_PROPS.includes(m[1]) || m[1] in out) {
      return { reason: `"${pair.slice(0, 32)}" není vlastnost kabelu, nebo je uvedena dvakrát.` };
    }
    if (!port || !EDGE_PROPERTY_FIELDS[port.type].includes(m[1])) {
      return { reason: `kabel typu ${port ? port.type : '?'} do ${inp.id} nemá ${m[1]}.` };
    }
    const v = m[1] === 'muted' ? { true: true, false: false }[m[2]]
      : ['depth', 'offset'].includes(m[1]) ? Number(m[2]) : m[2];
    const ok = m[1] === 'polarity' ? MOD_POLARITIES.includes(v) : m[1] === 'mapping'
      ? MOD_MAPPINGS.includes(v) : m[1] === 'muted' ? typeof v === 'boolean' : Number.isFinite(v);
    if (!ok) return { reason: `${inp.id} ${m[1]} "${m[2].slice(0, 16)}" není platná hodnota.` };
    out[m[1]] = v;
  }
  const pd = port.param ? NODE_REGISTRY.param(node, port.param.key) : null;
  const r = validateEdgeProps(out, port.type, port, pd);
  return r.ok ? { props: out }
    : { reason: `${inp.id} ${r.errors[0].field} má hodnotu mimo povolený rozsah.` };
}

/** Why `v` is no value of panel parameter `p`, in Czech (validateParamValue decides). */
function paramWhy(p, v) {
  if (p.type === 'number' || p.type === 'integer') {
    if (typeof v !== 'number' || !Number.isFinite(v)) return 'musí být číslo';
    if (p.type === 'integer' && !Number.isInteger(v)) return 'musí být celé číslo';
    return `musí být mezi ${p.min} a ${p.max}`;
  }
  if (Array.isArray(p.options)) {
    return `musí být jedna z možností: ${p.options.map((o) => o[0]).join(', ')}`;
  }
  if (p.type === 'boolean') return 'musí být true nebo false';
  return 'má neplatnou hodnotu';
}

/** canConnect's refusal of a link cable, in Czech by its code. */
function connectWhy(code, src, port) {
  if (code === 'type-mismatch') {
    return `výstup typu ${src.type} nelze zapojit do vstupu typu ${port.type}`;
  }
  if (code === 'role-mismatch') return 'role výstupu a vstupu se neshodují';
  if (code === 'self-connection') return 'modul nelze propojit sám se sebou';
  return 'tyto konektory nelze propojit';
}

export function encodeSynthLink({ tab = 'panel', engine = null, preset = null, values = [],
  cables = [] } = {}) {
  const q = new URLSearchParams();
  q.set('m', SYNTH_LINK_MODE);
  if (tab && tab !== 'panel') q.set(SYNTH_LINK_KEYS.tab, tab);
  if (engine && tab === 'engines') q.set(SYNTH_LINK_KEYS.engine, engine);
  if (preset) q.set(SYNTH_LINK_KEYS.preset, preset);
  if (values.length) {
    q.set(SYNTH_LINK_KEYS.values, values.map(([k, v]) => `${k}:${fmt(v)}`).join(','));
  }
  if (cables.length) q.set(SYNTH_LINK_KEYS.cables, cables.map(cableItem).join(','));
  return q.toString();
}

export function withoutSynthParams(hash) {
  const q = new URLSearchParams(strip(hash));
  for (const k of Object.values(SYNTH_LINK_KEYS)) q.delete(k);
  return q.toString();
}

/** null when the hash has no Synth key; else the checked link or the refusal. */
export function decodeSynthLink(hash, panel, presets) {
  let q;
  try { q = new URLSearchParams(strip(hash)); } catch (e) { return null; }
  const K = SYNTH_LINK_KEYS;
  if (!Object.values(K).some((k) => q.has(k)) && !q.getAll('m').includes(SYNTH_LINK_MODE)) {
    return null;
  }
  const no = (reason) => ({ ok: false, reason: `Odkaz Synthu odmítnut: ${reason}` });
  for (const k of Object.values(K)) {
    if (q.getAll(k).length > 1) return no(`${k} je v odkazu dvakrát.`);
  }
  const tab = q.get(K.tab) || 'panel';
  if (!SYNTH_TABS.includes(tab)) return no(`karta "${tab.slice(0, 32)}" neexistuje.`);
  const engine = q.get(K.engine);
  if (engine !== null && !(panel.module(engine) && panel.module(engine).tab === 'engines')) {
    return no(`engine "${engine.slice(0, 32)}" na panelu není.`);
  }
  const preset = q.get(K.preset);
  if (preset !== null && !presets.some((p) => p.id === preset)) {
    return no(`předvolba "${preset.slice(0, 32)}" neexistuje.`);
  }
  const values = [];
  const rawValues = q.get(K.values);
  for (const item of rawValues ? rawValues.split(',') : []) {
    const m = /^([a-z][a-z0-9-]*)\.([A-Za-z][A-Za-z0-9_-]*):(.+)$/.exec(item);
    const mod = m && panel.module(m[1]);
    const amt = mod && panel.amounts.find((a) => a.module === m[1] && a.key === m[2]);
    if (amt) {
      const d = Number(m[3]);
      if (!Number.isFinite(d) || d < amt.range[0] || d > amt.range[1]) {
        return no(`${amt.label} musí být mezi ${amt.range[0]} a ${amt.range[1]}.`);
      }
      values.push([`${m[1]}.${m[2]}`, d]);
      continue;
    }
    const p = mod && mod.params.find((x) => x.key === m[2]);
    if (!p || (mod.fixed && m[2] in mod.fixed)) {
      return no(`"${item.slice(0, 48)}" není knoflík panelu.`);
    }
    const v = p.type === 'number' || p.type === 'integer' ? Number(m[3])
      : p.type === 'boolean' ? m[3] === 'true' : m[3];
    const why = validateParamValue(p, v);
    if (why || (p.type === 'boolean' && !['true', 'false'].includes(m[3]))) {
      return no(`${mod.label} ${p.label} ${why ? paramWhy(p, v) : 'musí být true nebo false'}.`);
    }
    values.push([`${m[1]}.${m[2]}`, v]);
  }
  const cables = [];
  const into = new Map(); // input jack id -> cables into it so far
  const rawCables = q.get(K.cables);
  for (const item of rawCables ? rawCables.split(',') : []) {
    const [ends, extra, more] = item.split('@');
    const [a, b] = ends.split('>');
    // A port id may name an input and an output of one module (a filter's or a gain's
    // 'audio'), so each end is looked up by its id AND its direction.
    const jack = (id, direction) => id && panel.jacksOf(id.split('.')[0])
      .find((j) => j.id === id && j.direction === direction);
    const out = jack(a, 'out');
    const inp = jack(b, 'in');
    if (!out || !inp) {
      return no(`"${item.slice(0, 48)}" není kabel z výstupu do vstupu.`);
    }
    if (cables.some(([x, y]) => x === a && y === b)) {
      return no(`kabel ${a} → ${b} je v odkazu dvakrát.`);
    }
    const port = NODE_REGISTRY.port(panel.module(inp.module).node, inp.port, 'in');
    const src = NODE_REGISTRY.port(panel.module(out.module).node, out.port, 'out');
    const v = canConnect(src, port);
    if (!v.allowed) {
      return no(`kabel ${a} → ${b} nelze zapojit: ${connectWhy(v.code, src, port)}.`);
    }
    into.set(b, (into.get(b) || 0) + 1);
    if (port && !port.multiple && into.get(b) > 1) {
      return no(`do vstupu ${panel.module(inp.module).label} ${port.label} (${b}) vedou `
        + `${into.get(b)} kabely, ale přijímá jen jedno spojení.`);
    }
    if (extra === undefined) { cables.push([a, b]); continue; }
    const r = more === undefined && extra ? cablePropsOf(extra, inp, panel)
      : { reason: `"${item.slice(0, 48)}" nemá po jednom '@' vlastnosti kabelu.` };
    if (r.reason) return no(r.reason);
    cables.push([a, b, r.props]);
  }
  if (values.length + cables.length > MAX_ITEMS) return no(`víc než ${MAX_ITEMS} položek.`);
  return { ok: true, link: { tab: engine && tab === 'panel' ? 'engines' : tab, engine, preset,
    values, cables } };
}
