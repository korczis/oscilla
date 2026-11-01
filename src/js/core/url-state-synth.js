// The Synth deep link (plan K106 part): `#m=synth[&yt=<tab>][&ye=<engine>][&yp=<preset>]
// [&yv=<values>][&yc=<cables>]`. Its own keys, so a Synth link never routes to Studio (`sv` is
// a Studio key):
//   yt  the tab ('panel' | 'engines' | 'xy')
//   ye  the engine module the keys play on the Engines tab (panels/engines.js)
//   yp  a preset id (synth/presets.js)
//   yv  values that differ from the preset, 'module.param:value' joined by ','
//   yc  user cables, 'module.port>module.port' joined by ','
// Strict, like the Studio and recipe links: one unknown preset, module, parameter, value or jack
// refuses the whole link with a sentence, and nothing of it is applied.
//
//   decodeSynthLink(hash, panel, presets) -> { ok: true, link } | { ok: false, reason } | null
//   encodeSynthLink(link) -> 'm=synth&...'   withoutSynthParams(hash) -> hash

import { validateParamValue } from '../studio/registry.js';

export const SYNTH_LINK_MODE = 'synth';
export const SYNTH_LINK_KEYS = Object.freeze({ tab: 'yt', engine: 'ye', preset: 'yp',
  values: 'yv', cables: 'yc' });
export const SYNTH_TABS = Object.freeze(['panel', 'engines', 'xy']);
const MAX_ITEMS = 128;

const strip = (h) => String(h || '').replace(/^#/, '');
const fmt = (v) => (typeof v === 'number' ? String(Number(v.toPrecision(6))) : String(v));

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
  if (cables.length) q.set(SYNTH_LINK_KEYS.cables, cables.map(([a, b]) => `${a}>${b}`).join(','));
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
    const [a, b] = item.split('>');
    // A port id may name an input and an output of one module (a filter's or a gain's
    // 'audio'), so each end is looked up by its id AND its direction.
    const jack = (id, direction) => id && panel.jacksOf(id.split('.')[0])
      .find((j) => j.id === id && j.direction === direction);
    const out = jack(a, 'out');
    const inp = jack(b, 'in');
    if (!out || !inp) {
      return no(`"${item.slice(0, 48)}" is not a cable from an output to an input jack.`);
    }
    cables.push([a, b]);
  }
  if (values.length + cables.length > MAX_ITEMS) return no(`more than ${MAX_ITEMS} items.`);
  return { ok: true, link: { tab: engine && tab === 'panel' ? 'engines' : tab, engine, preset,
    values, cables } };
}
