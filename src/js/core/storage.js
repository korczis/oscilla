// Storage that never throws, the custom-preset schema (v1) with its migration path, and the
// session history. Extracted from V1 (index.html@a7b7a23, sections 2, 5 and 8). The component
// methods loadCustomPresets/migratePreset/persistPresets/loadHistory/addHistory became functions
// over an injected store; notifications are returned as data ({ level, title, message }).
//
// Schema: PRESET_SCHEMA_VERSION 1 (presetRecord). V2 migration hook: registerPresetMigration(1,
// upgradeV1toV2) plus migratePreset(p, { targetVersion: 2 }) upgrades a stored v1 cfg step by
// step; with the defaults the behaviour is exactly V1's (v0 upgraded, v1 kept, newer rejected).

import { HISTORY_MAX, PRESET_SCHEMA_VERSION, STORAGE_KEYS, WAVEFORMS } from './constants.js';
import { deepCopy, isNum, pick, round } from './math.js';
import { parseFrequency } from './frequency.js';
import { defaultInstrumentState } from './config.js';

/**
 * Storage that never throws: private mode, disabled cookies and quota errors become no-ops.
 * V1: safeStorage (index.html@a7b7a23). resolve(kind) returns the backing Storage; the default
 * reads window[kind] lazily on every call, so creating an instance never touches storage.
 */
export function safeStorage(kind, resolve) {
  const store = () => {
    try { return resolve ? resolve(kind) : window[kind]; } catch (e) { return null; }
  };
  return {
    get(key) { try { return store()?.getItem(key) ?? null; } catch (e) { return null; } },
    set(key, val) { try { store().setItem(key, val); return true; } catch (e) { return false; } },
    remove(key) { try { store().removeItem(key); return true; } catch (e) { return false; } },
    available() {
      try {
        const s = store();
        s.setItem('__oscilla_probe__', '1');
        s.removeItem('__oscilla_probe__');
        return true;
      } catch (e) { return false; }
    },
  };
}
// V1: localStore, sessionStore (index.html@a7b7a23); lazy, see safeStorage.
export const localStore = safeStorage('localStorage');
export const sessionStore = safeStorage('sessionStorage');

// V1: readJSON (index.html@a7b7a23)
export function readJSON(store, key, fallback) {
  const raw = store.get(key);
  if (raw == null) return fallback;
  try { return JSON.parse(raw); } catch (e) { return fallback; }
}

// V1: newPresetId, presetRecord (index.html@a7b7a23)
/** A fresh id for a custom preset. */
export function newPresetId() {
  return `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

/**
 * The stored shape of a custom preset (schema PRESET_SCHEMA_VERSION). Every descriptive field is
 * derived from cfg, the reproducible configuration, so saving and migrating produce the same record.
 */
export function presetRecord(meta, cfg) {
  const source = cfg.source || 'single';
  const range = cfg.range && typeof cfg.range === 'object' ? cfg.range : { mode: 'human' };
  return {
    version: PRESET_SCHEMA_VERSION, id: meta.id, name: meta.name, created: meta.created,
    mode: source, pattern: cfg.pattern || 'tone', waveform: cfg.waveform || 'sine',
    frequency: cfg.frequency, gain: cfg.gain, duration: cfg.duration,
    envelope: { attack: cfg.attack, release: cfg.release },
    range: deepCopy(range),
    params: source === 'sweep' ? deepCopy(cfg.sweep || {}) : deepCopy((cfg.pp && cfg.pp[cfg.pattern]) || {}),
    dual: source === 'dual' ? deepCopy(cfg.dual || null) : null,
    cfg,
  };
}

/** fromVersion -> upgrade(cfg, storedPreset) returning the cfg of fromVersion + 1. */
export const PRESET_MIGRATIONS = {};

/** Register the cfg upgrade from schema `fromVersion` to `fromVersion + 1` (V2 hook). */
export function registerPresetMigration(fromVersion, upgrade) {
  if (!Number.isInteger(fromVersion) || fromVersion < 1 || typeof upgrade !== 'function') {
    throw new TypeError('registerPresetMigration(fromVersion >= 1, upgrade function)');
  }
  PRESET_MIGRATIONS[fromVersion] = upgrade;
}

/**
 * Validate and upgrade one stored preset; null when it is invalid or from a newer schema.
 * V1: oscillaApp.migratePreset (index.html@a7b7a23), plus the version-by-version hook.
 * opts: { targetVersion = PRESET_SCHEMA_VERSION, migrations = PRESET_MIGRATIONS }
 */
export function migratePreset(p, opts = {}) {
  const targetVersion = opts.targetVersion || PRESET_SCHEMA_VERSION;
  const migrations = opts.migrations || PRESET_MIGRATIONS;
  if (!p || typeof p !== 'object') return null;
  const version = isNum(p.version) ? p.version : 0;
  if (version > targetVersion) return null;
  const name = typeof p.name === 'string' ? p.name.trim().slice(0, 60) : '';
  if (!name) return null;
  let cfg = p.cfg;
  if (version === 0) {
    // Pre-versioned shape: { name, frequency, waveform } — upgrade to schema 1.
    const f = parseFrequency(p.frequency);
    if (!f.ok) return null;
    const d = defaultInstrumentState();
    cfg = {
      source: 'single', pattern: 'tone', frequency: f.value, waveform: pick(p.waveform, WAVEFORMS, 'sine'),
      duration: d.duration, attack: d.attack, release: d.release, gain: d.gainLevel, range: { mode: d.rangeMode },
    };
  }
  if (!cfg || typeof cfg !== 'object') return null;
  // V2 hook: schema 1 -> 2 -> … (no steps with the default targetVersion 1).
  for (let v = Math.max(1, version); v < targetVersion; v++) {
    if (typeof migrations[v] !== 'function') return null;
    cfg = migrations[v](cfg, p);
    if (!cfg || typeof cfg !== 'object') return null;
  }
  const record = presetRecord({
    id: typeof p.id === 'string' ? p.id : newPresetId(),
    name, created: isNum(p.created) ? p.created : Date.now(),
  }, cfg);
  if (targetVersion !== PRESET_SCHEMA_VERSION) record.version = targetVersion;
  return record;
}

/**
 * Read the custom presets: { presets, notices }.
 * V1: oscillaApp.loadCustomPresets (index.html@a7b7a23)
 */
export function loadCustomPresets(store = localStore, opts = {}) {
  const notices = [];
  const notify = (level, title, message) => notices.push({ level, title, message });
  const raw = readJSON(store, STORAGE_KEYS.presets, null);
  if (raw == null) return { presets: [], notices };
  const list = Array.isArray(raw) ? raw : raw && Array.isArray(raw.presets) ? raw.presets : null;
  if (!list) {
    notify('warning', 'Saved presets unreadable', 'The stored preset data is malformed and was ignored.');
    return { presets: [], notices };
  }
  const out = [];
  let bad = 0;
  for (const item of list) {
    const p = migratePreset(item, opts);
    if (p) out.push(p); else bad++;
  }
  if (bad) notify('warning', 'Some presets ignored', `${bad} saved preset(s) were invalid or from a newer version.`);
  return { presets: out, notices };
}

/** Write the custom presets: { ok, notices }. V1: oscillaApp.persistPresets */
export function persistPresets(store, presets) {
  const notices = [];
  const ok = store.set(STORAGE_KEYS.presets, JSON.stringify({ version: PRESET_SCHEMA_VERSION, presets }));
  if (!ok) {
    notices.push({ level: 'error', title: 'Could not save presets',
      message: 'localStorage is unavailable or full; presets last only for this page view.' });
  }
  return { ok, notices };
}

/** The session history, validated. V1: oscillaApp.loadHistory (index.html@a7b7a23) */
export function loadHistory(store = sessionStore) {
  const raw = readJSON(store, STORAGE_KEYS.history, []);
  if (!Array.isArray(raw)) return [];
  return raw.filter((h) => h && isNum(h.ts) && h.cfg && typeof h.cfg === 'object' && Array.isArray(h.freqs)).slice(0, HISTORY_MAX);
}

/**
 * One history entry for a played plan. state: { source, pattern }; cfg: serializeConfig(state).
 * V1: oscillaApp.addHistory (index.html@a7b7a23), entry part
 */
export function historyEntry(plan, state, cfg) {
  return {
    ts: Date.now(), mode: state.source, freqs: plan.freqs.map((f) => round(f, 2)),
    waveform: plan.type === 'dual' ? `${plan.a.wave} / ${plan.b.wave}` : plan.wave,
    pattern: state.source === 'single' ? state.pattern : state.source,
    duration: plan.kind === 'finite' ? round(plan.dur, 3) : null,
    label: plan.label, cfg,
  };
}

/**
 * The history with entry added: a repeat of the newest entry (same label and cfg) replaces it,
 * the list is capped at HISTORY_MAX. V1: oscillaApp.addHistory (index.html@a7b7a23), list part
 */
export function pushHistory(history, entry) {
  const prev = history[0];
  const same = prev && prev.label === entry.label && JSON.stringify(prev.cfg) === JSON.stringify(entry.cfg);
  return same ? [entry, ...history.slice(1)] : [entry, ...history].slice(0, HISTORY_MAX);
}

