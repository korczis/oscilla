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
// refuses the whole link with a sentence, and nothing of it is applied.
//
//   decodeSynthLink(hash, panel, presets) -> { ok: true, link } | { ok: false, reason } | null
//   encodeSynthLink(link) -> 'm=synth&...'   withoutSynthParams(hash) -> hash

import { NODE_REGISTRY, validateParamValue } from '../studio/registry.js';
import { EDGE_PROPERTY_FIELDS, MOD_MAPPINGS, MOD_POLARITIES, validateEdgeProps }
  from '../studio/ports.js';

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
      return { reason: `"${pair.slice(0, 32)}" is no cable property, or it appears twice.` };
    }
    if (!port || !EDGE_PROPERTY_FIELDS[port.type].includes(m[1])) {
      return { reason: `a ${port ? port.type.toLowerCase() : ''} cable into ${inp.id} has no `
        + `${m[1]}.` };
    }
    const v = m[1] === 'muted' ? { true: true, false: false }[m[2]]
      : ['depth', 'offset'].includes(m[1]) ? Number(m[2]) : m[2];
    const ok = m[1] === 'polarity' ? MOD_POLARITIES.includes(v) : m[1] === 'mapping'
      ? MOD_MAPPINGS.includes(v) : m[1] === 'muted' ? typeof v === 'boolean' : Number.isFinite(v);
    if (!ok) return { reason: `${inp.id} ${m[1]} "${m[2].slice(0, 16)}" is not a valid value.` };
    out[m[1]] = v;
  }
  const pd = port.param ? NODE_REGISTRY.param(node, port.param.key) : null;
  const r = validateEdgeProps(out, port.type, port, pd);
  return r.ok ? { props: out } : { reason: `${inp.id} ${r.errors[0].field} ${r.errors[0].text}.` };
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
  const no = (reason) => ({ ok: false, reason: `Synth link refused: ${reason}` });
  for (const k of Object.values(K)) if (q.getAll(k).length > 1) return no(`${k} appears twice.`);
  const tab = q.get(K.tab) || 'panel';
  if (!SYNTH_TABS.includes(tab)) return no(`there is no tab "${tab.slice(0, 32)}".`);
  const engine = q.get(K.engine);
  if (engine !== null && !(panel.module(engine) && panel.module(engine).tab === 'engines')) {
    return no(`there is no engine "${engine.slice(0, 32)}".`);
  }
  const preset = q.get(K.preset);
  if (preset !== null && !presets.some((p) => p.id === preset)) {
    return no(`there is no preset "${preset.slice(0, 32)}".`);
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
        return no(`${amt.label} must be between ${amt.range[0]} and ${amt.range[1]}.`);
      }
      values.push([`${m[1]}.${m[2]}`, d]);
      continue;
    }
    const p = mod && mod.params.find((x) => x.key === m[2]);
    if (!p || (mod.fixed && m[2] in mod.fixed)) {
      return no(`"${item.slice(0, 48)}" names no knob of the panel.`);
    }
    const v = p.type === 'number' || p.type === 'integer' ? Number(m[3])
      : p.type === 'boolean' ? m[3] === 'true' : m[3];
    const why = validateParamValue(p, v);
    if (why || (p.type === 'boolean' && !['true', 'false'].includes(m[3]))) {
      return no(`${mod.label} ${p.label} ${why || 'must be true or false'}.`);
    }
    values.push([`${m[1]}.${m[2]}`, v]);
  }
  const cables = [];
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
      return no(`"${item.slice(0, 48)}" is not a cable from an output to an input jack.`);
    }
    if (extra === undefined) { cables.push([a, b]); continue; }
    const r = more === undefined && extra ? cablePropsOf(extra, inp, panel)
      : { reason: `"${item.slice(0, 48)}" holds no cable properties after one '@'.` };
    if (r.reason) return no(r.reason);
    cables.push([a, b, r.props]);
  }
  if (values.length + cables.length > MAX_ITEMS) return no(`more than ${MAX_ITEMS} items.`);
  return { ok: true, link: { tab: engine && tab === 'panel' ? 'engines' : tab, engine, preset,
    values, cables } };
}
