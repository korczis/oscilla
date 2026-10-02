// URL state: the instrument configuration <-> `#v=1&…` hash codec and the validated restore.
// Extracted from V1 (index.html@a7b7a23, section 8: serializeConfig, serializeHash,
// restoreFromHash). Format unchanged: v=1, short keys m s p w f g d a r rm, and `x` = base64url
// JSON of the extras (pp, sweep, dual with binaural forced false, custom range, a4).
// Never carried: the continuous-playback permission and the binaural confirmation. A link never
// raises the gain above DEFAULT_GAIN.

import { APP_MODES, DEFAULT_GAIN } from './constants.js';
import { base64UrlDecode, base64UrlEncode, deepCopy, isNum } from './math.js';
import { limitsFor } from './frequency.js';
import {
  applyConfigTo, defaultEditorFields, defaultInstrumentState, pickInstrumentState,
} from './config.js';
import { presetMaxFrequency } from '../data/presets.js';

export { base64UrlDecode, base64UrlEncode };

/** The reproducible configuration of a state. V1: oscillaApp.serializeConfig (this -> s) */
export function serializeConfig(s) {
  const cfg = {
    v: 1, source: s.source, pattern: s.pattern, waveform: s.waveform, frequency: s.frequency,
    duration: s.duration, attack: s.attack, release: s.release, gain: s.gainLevel, a4: s.a4,
    range: { mode: s.rangeMode, min: s.customMin, max: s.customMax },
  };
  if (s.source === 'single' && s.pp[s.pattern]) cfg.pp = { [s.pattern]: deepCopy(s.pp[s.pattern]) };
  if (s.source === 'sweep') cfg.sweep = deepCopy(s.sweep);
  if (s.source === 'dual') cfg.dual = deepCopy(s.dual);
  return cfg;
}

/** The hash (without '#') of a state and V1 mode id. V1: oscillaApp.serializeHash */
export function serializeHash(s, mode) {
  const c = serializeConfig(s);
  const q = new URLSearchParams();
  q.set('v', '1');
  q.set('m', mode);
  q.set('s', c.source);
  q.set('p', c.pattern);
  q.set('w', c.waveform);
  q.set('f', String(c.frequency));
  q.set('g', String(c.gain));
  q.set('d', String(c.duration));
  q.set('a', String(c.attack));
  q.set('r', String(c.release));
  q.set('rm', c.range.mode);
  const extra = {};
  if (c.pp) extra.pp = c.pp;
  if (c.sweep) extra.sweep = c.sweep;
  if (c.dual) extra.dual = { ...c.dual, binaural: false }; // headphone confirmation is never carried
  if (c.range.mode === 'custom') extra.range = c.range;
  if (c.a4 !== 440) extra.a4 = c.a4;
  if (Object.keys(extra).length) q.set('x', base64UrlEncode(JSON.stringify(extra)));
  return q.toString();
}

/**
 * Decode a hash (with or without '#') into { cfg, gainCapped, mode }; null when it carries no
 * configuration (no v and no f). Throws on a malformed `x` payload, like V1.
 * V1: oscillaApp.restoreFromHash, decoding part (index.html@a7b7a23)
 */
export function decodeHash(hash) {
  const h = String(hash || '').replace(/^#/, '');
  if (!h) return null;
  const q = new URLSearchParams(h);
  if (!q.has('v') && !q.has('f')) return null;
  const cfg = {};
  if (q.has('s')) cfg.source = q.get('s');
  if (q.has('p')) cfg.pattern = q.get('p');
  if (q.has('w')) cfg.waveform = q.get('w');
  for (const [k, key] of [['f', 'frequency'], ['g', 'gain'], ['d', 'duration'], ['a', 'attack'], ['r', 'release']]) {
    if (q.has(k)) cfg[key] = Number(q.get(k));
  }
  if (q.has('rm')) cfg.range = { mode: q.get('rm') };
  if (q.has('x')) {
    const extra = JSON.parse(base64UrlDecode(q.get('x')));
    if (!extra || typeof extra !== 'object' || Array.isArray(extra)) throw new Error('bad extra');
    Object.assign(cfg, extra);
    if (extra.range && q.has('rm')) cfg.range = { ...extra.range, mode: q.get('rm') };
  }
  // A link never raises the receiver's output level above the conservative default.
  let gainCapped = false;
  if (isNum(cfg.gain) && cfg.gain > DEFAULT_GAIN) { cfg.gain = DEFAULT_GAIN; gainCapped = true; }
  return { cfg, gainCapped, mode: q.get('m') };
}

/**
 * Restore a hash onto state s in place. env: { sampleRate, continuousAllowed }.
 * Returns { handled, issues, notices, pendingHashConfig, mode }:
 *   handled            false when the hash carries no configuration (nothing happened)
 *   pendingHashConfig  cfg to re-apply once the real sample rate is known (values above the
 *                      provisional safe maximum), else null
 *   mode               the V1 mode id from `m` when valid, else null
 * V1: oscillaApp.restoreFromHash (index.html@a7b7a23)
 */
export function restoreFromHashOn(s, hash, env = {}) {
  const notices = [];
  const notify = (level, title, message) => notices.push({ level, title, message });
  const out = { handled: false, issues: 0, notices, pendingHashConfig: null, mode: null };
  const h = String(hash || '').replace(/^#/, '');
  if (!h) return out;
  try {
    const decoded = decodeHash(h);
    if (!decoded) return out;
    out.handled = true;
    const { cfg, gainCapped } = decoded;
    const { provisional, safeMax } = limitsFor(env.sampleRate);
    const issues = applyConfigTo(s, cfg, 'hash', env, notices).issues;
    out.issues = issues;
    if (gainCapped) notify('info', 'Gain kept at the default', 'The link asked for a higher gain; raise it yourself if you want it louder.');
    // Values above the provisional safe maximum are re-applied once the real rate is known.
    if (provisional && presetMaxFrequency(cfg) > safeMax) out.pendingHashConfig = cfg;
    const m = decoded.mode;
    if (APP_MODES.some((x) => x.id === m)) out.mode = m;
    if (issues) notify('warning', 'Link partly restored', `${issues} value(s) in the link were invalid and replaced by defaults.`);
    else notify('info', 'Configuration restored from link', 'Nothing plays until you press HOLD TO PLAY or TRIGGER.');
  } catch (e) {
    out.handled = true;
    notify('warning', 'Link could not be read', 'The configuration in this link is malformed; defaults are used.');
  }
  return out;
}

/**
 * Pure restore: { state, handled, issues, notices, pendingHashConfig, mode } for a state-like
 * input (defaults when omitted); the input is not modified.
 */
export function restoreFromHash(state, hash, env = {}) {
  const s = pickInstrumentState(state || { ...defaultInstrumentState(), ...defaultEditorFields() });
  const r = restoreFromHashOn(s, hash, env);
  return { state: s, ...r };
}
