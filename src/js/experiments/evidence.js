// Evidence on a run (ADR 0044): what produced a stored value, and whether the run can be
// repeated, answered ONLY from the fields the record stores. Pure: plain data in, plain data
// out; no DOM, no clock, no storage.
//
//   defaultEvidenceHz(e) -> 1000 when 1 kHz lies inside the stored grid, else the grid's
//     geometric centre; null without a stored frequency response
//   resultPoint(e, hz) -> { hz, requestedHz, index, value, unit, source, repeats, reliable,
//     text } | null   the stored grid point nearest `hz` of the run's main result
//     (results.transfer, else the aggregate centre), the value exactly as stored (the RAW
//     capture/stimulus ratio; a frequency correction is never stored, only drawn)
//   evidenceLineage(e, { hz, match, name }) -> [{ id, label, text }]
//     ids in order: result, analysis, capture, calibration, run, definition, build, studio.
//     A link is present only when its block is stored (never invented); a field missing
//     inside a present link reads "not recorded". `match` is definition.js storedMatch of the
//     run against this browser's stored definition (or 'unreadable'), `name` its name.
//   reproducibilityChecklist(e, { match, name, sha256Hex }) -> [{ id, label, state, stateText,
//     reason }]   ids: definition, recipe, algorithms, calibration, device, build, hash,
//     raw, environment; state one of EVIDENCE_STATES. A checklist, never a score: no count,
//     no percentage. No item is 'recorded' without the field that records it. An item reads
//     itemText(c): "<stateText> (<reason>)", e.g. RAW_CAPTURE_TEXT.
//   runEvidence(e, opts) -> { hz, point, lineage, checklist }
//   evidenceDifferences(checklists) -> [{ id, label, states }]  items whose state differs
//   evidenceDifferencesText(diffs, labels) -> one line for the compare view
//
// Truth rules: a calibration claim the record's own results contradict (validate.js
// calibrationClaimFindings, ADR 0040 resolution) is presented as "uncalibrated (the stored
// claim is contradicted)", never as applied. The Studio block hashes the whole graph a
// measurement's recipe was derived from, including nodes the measurement did not use (ledger
// D3), so it is never presented as what ran. Raw captures are never stored (ledger P2-3).
// Times: the record's createdAt and measurement.startedAt are wall-clock times; capture
// lengths are frames at the capture sample rate (the audio clock). Each is labelled as such.

import { UNKNOWN_DEVICE } from './schema.js';
import { resultHash, resultHashVersionOf, RESULT_HASH_VERSION } from './hash.js';
import { calibrationClaimFindings } from './validate.js';
import { TRANSFER_RATIO_UNIT } from './csv.js';
import { describeAlgorithm, isKnownAlgorithm } from '../measurement/algorithms.js';

export const EVIDENCE_STATES = Object.freeze(['recorded', 'partial', 'missing']);
export const STATE_TEXT = Object.freeze({ recorded: 'recorded', partial: 'partial',
  missing: 'not recorded' });
export const RAW_CAPTURE_REASON = 'OSCILLA stores the derived result, not the raw capture';
/** How an item reads: its state words, then its reason in brackets. */
export const itemText = (c) => `${c.stateText} (${c.reason})`;
export const RAW_CAPTURE_TEXT = `not retained (${RAW_CAPTURE_REASON})`;
export const CONTRADICTED_TEXT = 'uncalibrated (the stored claim is contradicted)';
const NR = 'not recorded';

const obj = (v) => !!v && typeof v === 'object';
const str = (v) => typeof v === 'string' && v.trim() !== '';
const num = (v) => typeof v === 'number' && Number.isFinite(v);
const short = (h) => (str(h) ? `${h.slice(0, 12)}…` : NR);
const hzText = (f) => (f >= 1000 ? `${+(f / 1000).toPrecision(4)} kHz` : `${+f.toPrecision(4)} Hz`);
const dbText = (v) => `${v < 0 ? '−' : '+'}${Math.abs(v).toFixed(2)} dB`;

/** "2026-10-02 10:00 UTC (wall clock)" of an ISO timestamp, or "not recorded". */
function wallText(iso) {
  const m = typeof iso === 'string' ? /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/.exec(iso) : null;
  return m ? `${m[1]} ${m[2]} UTC (wall clock)` : NR;
}

/** The run's main result: { source, frequencies, db, repeats, method } or null. */
function responseOf(e) {
  const r = obj(e) && obj(e.results) ? e.results : null;
  if (!r) return null;
  const t = r.transfer;
  const g = r.aggregate;
  if (obj(t) && t.frequencies && t.magnitudeDb && t.frequencies.length) {
    const fromAgg = t.derivedFrom === 'aggregate' && obj(g);
    return { source: fromAgg ? 'aggregate' : 'transfer', frequencies: t.frequencies,
      db: t.magnitudeDb, repeats: fromAgg ? g.runs : 1, method: fromAgg ? g.method : null };
  }
  if (obj(g) && g.frequencies && g.centreDb && g.frequencies.length) {
    return { source: 'aggregate', frequencies: g.frequencies, db: g.centreDb, repeats: g.runs,
      method: g.method };
  }
  return null;
}

/** Index of the grid point nearest `hz` (on a log scale). */
function nearest(f, hz) {
  let best = 0;
  for (let i = 1; i < f.length; i++) {
    if (Math.abs(Math.log(f[i] / hz)) < Math.abs(Math.log(f[best] / hz))) best = i;
  }
  return best;
}

/** See the header. */
export function defaultEvidenceHz(e) {
  const r = responseOf(e);
  if (!r) return null;
  const lo = r.frequencies[0];
  const hi = r.frequencies[r.frequencies.length - 1];
  if (lo <= 1000 && hi >= 1000) return 1000;
  return +Math.sqrt(lo * hi).toPrecision(4);
}

/** See the header. */
export function resultPoint(e, hz) {
  const r = responseOf(e);
  if (!r) return null;
  const want = num(hz) && hz > 0 ? hz : defaultEvidenceHz(e);
  const i = nearest(r.frequencies, want);
  const f = r.frequencies[i];
  const value = r.db[i];
  const mask = obj(e.quality) && obj(e.quality.mask) ? e.quality.mask : null;
  const reliable = mask && mask.reliable && mask.frequencies
    && mask.frequencies.length === r.frequencies.length ? mask.reliable[i] === 1 : null;
  const what = r.source === 'aggregate' ? `the aggregate centre (${r.method || 'centre'} of ${
    r.repeats} repeats)` : 'one repeat';
  const n = r.frequencies.length;
  const outside = want < r.frequencies[0] || want > r.frequencies[n - 1];
  const where = Math.abs(f / want - 1) < 1e-3 ? 'stored grid point' : `the stored grid point `
    + `nearest ${hzText(want)}${outside ? ', which lies outside the stored range' : ''}`;
  const v = num(value) ? `${dbText(value)} re unity digital transfer (capture/stimulus ratio)`
    : 'no finite value stored';
  const rel = reliable === null ? 'no stored quality mask'
    : `${reliable ? 'reliable' : 'unreliable'} (stored quality mask)`;
  const invalid = obj(e.quality) && e.quality.status === 'INVALID'
    ? '; the run is INVALID, not authoritative' : '';
  return {
    hz: f, requestedHz: want, index: i, value: num(value) ? value : null,
    unit: TRANSFER_RATIO_UNIT, source: r.source, repeats: r.repeats, reliable,
    text: `${v} at ${hzText(f)} (${where}), RAW as stored, ${what}; ${rel}${invalid}`,
  };
}

// ---------------------------------------------------------------- lineage

const ROLE_ORDER = ['transfer', 'aggregate', 'quality', 'calibration'];

function algorithmList(a) {
  const keys = Object.keys(a).filter((k) => str(a[k]));
  keys.sort((x, y) => {
    const ix = ROLE_ORDER.indexOf(x);
    const iy = ROLE_ORDER.indexOf(y);
    return (ix < 0 ? 99 : ix) - (iy < 0 ? 99 : iy) || (x < y ? -1 : x > y ? 1 : 0);
  });
  return keys;
}

function flagsText(applied) {
  const names = { echoCancellation: 'echo cancellation', noiseSuppression: 'noise suppression',
    autoGainControl: 'auto gain control' };
  if (!obj(applied)) return null;
  const known = Object.keys(names).filter((k) => typeof applied[k] === 'boolean');
  if (!known.length) return null;
  return Object.keys(names).map((k) => `${names[k]} ${typeof applied[k] === 'boolean'
    ? (applied[k] ? 'on' : 'off') : NR}`).join(', ');
}

function testContextOf(e) {
  const runs = obj(e.measurement) && Array.isArray(e.measurement.runs) ? e.measurement.runs : [];
  const r = runs.find((x) => obj(x) && obj(x.testContext));
  return r ? r.testContext.label || 'TEST CONTEXT' : null;
}

function captureText(e) {
  const d = obj(e.input) && obj(e.input.device) ? e.input.device : {};
  const tc = testContextOf(e);
  const device = str(d.label) ? `input "${d.label}"${str(d.id) ? ' (device id recorded, hashed)'
    : ''}` : tc ? `${tc}; input device not exposed (no physical input)`
    : `input device not exposed by the browser${str(d.id) ? ' (a hashed device id is recorded)'
      : ''}`;
  const sr = obj(e.measurement) && num(e.measurement.sampleRate)
    ? `${hzText(e.measurement.sampleRate)} sample rate` : `sample rate ${NR}`;
  const k = obj(e.input) && obj(e.input.constraints) ? e.input.constraints.applied : null;
  const flags = flagsText(k);
  const gain = obj(e.output) && num(e.output.masterGain) ? `; master output gain ${
    +e.output.masterGain.toPrecision(3)} (included in every magnitude)` : '';
  return `${device}; ${sr}; ${flags || `processing flags ${NR}`}${gain}`;
}

function bindingText(b) {
  if (!obj(b)) return 'not bound to an input (it applies to every input)';
  const parts = [str(b.deviceId) ? 'device (hashed)' : null,
    num(b.sampleRate) ? hzText(b.sampleRate) : null].filter(Boolean);
  return `bound to its input${parts.length ? ` (${parts.join(', ')})` : ''}`;
}

function calibrationText(e, findings) {
  if (findings.length) {
    return `${CONTRADICTED_TEXT}: ${findings.map((f) => f.path).join(', ')} names a `
      + 'calibration the record\'s own results say was not applied';
  }
  const c = e.calibration;
  const f = obj(c.frequency) ? c.frequency : null;
  const l = obj(c.level) ? c.level : null;
  if (!f && !l) return 'uncalibrated: no frequency profile and no level calibration applied';
  const parts = [];
  if (f) {
    const alg = obj(e.algorithms) && str(e.algorithms.calibration) ? `, applied by ${
      e.algorithms.calibration}` : '';
    parts.push(`frequency profile "${f.name || NR}" (id ${short(f.id)})${alg}; the record keeps `
      + 'its identity, not its points, and the stored magnitude stays RAW');
  } else parts.push('no frequency profile');
  if (l) {
    const off = num(l.offsetDb) ? `offset ${dbText(l.offsetDb)}` : `offset ${NR}`;
    const ref = num(l.referenceHz) ? `, reference at ${hzText(l.referenceHz)}` : '';
    const method = str(l.method) ? `, method ${l.method}` : '';
    parts.push(`level calibration ${off}${ref}${method}, ${bindingText(l.input)}; it applies to `
      + 'levels, not to this ratio');
  } else parts.push('no level calibration');
  return parts.join('; ');
}

function runText(e) {
  const m = obj(e.measurement) ? e.measurement : {};
  const runs = Array.isArray(m.runs) ? m.runs.filter(obj) : [];
  const asked = obj(e.recipe) && Number.isInteger(e.recipe.repeats) ? e.recipe.repeats : null;
  let reps = `${runs.length}${asked !== null ? ` of ${asked}` : ''} repeat${
    (asked ?? runs.length) === 1 ? '' : 's'} recorded`;
  if (runs.length) {
    const first = runs[0].id || NR;
    const last = runs[runs.length - 1].id || NR;
    const secs = runs.map((r) => (num(r.frames) && num(r.sampleRate) && r.sampleRate > 0
      ? r.frames / r.sampleRate : null));
    const same = secs.every((s) => s !== null && Math.abs(s - secs[0]) < 1e-9);
    reps += ` (${runs.length > 1 ? `${first} … ${last}` : first}${same ? `; each ${+secs[0]
      .toPrecision(4)} s of capture on the audio clock` : ''})`;
  }
  const p = obj(e.provenance) ? e.provenance : {};
  const parts = [e.experimentId || `id ${NR}`, reps, `created ${wallText(p.createdAt)}`,
    `measurement started ${wallText(m.startedAt)}`,
    str(p.repeatOf) ? `a repeat of ${p.repeatOf}` : 'original (not a repeat)'];
  if (str(p.duplicateOf)) parts.push(`a duplicate of ${p.duplicateOf} (the same run, copied)`);
  return parts.join('; ');
}

const STORED = {
  match: 'stored in this browser with the same hash',
  absent: 'not stored in this browser',
  mismatch: 'does not match the stored definition with this id',
  unreadable: 'its stored definition could not be read',
};

function definitionText(d, { match = 'absent', name = null } = {}) {
  if (d.derived) return `derived from the run's own recipe, not authored (hash ${short(d.hash)})`;
  const who = match === 'match' && str(name) ? `"${name}" ` : '';
  return `authored definition ${who}${d.id || NR} version ${d.version ?? NR} (hash ${
    short(d.hash)}), ${STORED[match] || STORED.absent}`;
}

function buildText(b) {
  return [`OSCILLA ${str(b.version) ? b.version : `version ${NR}`}${str(b.channel)
    ? ` (${b.channel}${b.dirty ? ', uncommitted changes' : ''})` : ''}`,
  `source digest ${short(b.sourceDigest)}`, `artifact SHA-256 ${short(b.artifactSha256)}`,
  `commit ${str(b.commit) ? b.commit.slice(0, 7) : NR}`].join('; ');
}

function studioText(s) {
  const x = obj(s.execution) ? s.execution : {};
  const n = Array.isArray(x.nodes) ? x.nodes.length : null;
  const k = Array.isArray(x.edges) ? x.edges.length : null;
  return `the Studio graph the recipe was derived from: studioHash ${short(s.studioHash)}; ${
    n ?? NR} nodes, ${k ?? NR} edges. The hash covers the whole graph, including nodes the `
    + 'measurement did not use; it does not show which of them sounded';
}

/** See the header. */
export function evidenceLineage(e, { hz = null, match = 'absent', name = null } = {}) {
  if (!obj(e)) return [];
  const out = [];
  const add = (id, label, text) => out.push({ id, label, text });
  const point = resultPoint(e, hz);
  if (point) add('result', 'Result', point.text);
  const a = obj(e.algorithms) ? algorithmList(e.algorithms) : [];
  if (a.length) {
    add('analysis', 'Analysis', a.map((k) => {
      const d = describeAlgorithm(e.algorithms[k]);
      return `${e.algorithms[k]} (${k}${d ? `, version ${d.version}` : ''})`;
    }).join(', '));
  }
  if (obj(e.input) || (obj(e.measurement) && 'sampleRate' in e.measurement)) {
    add('capture', 'Capture', captureText(e));
  }
  if (obj(e.calibration)) {
    add('calibration', 'Calibration as applied', calibrationText(e, calibrationClaimFindings(e)));
  }
  add('run', 'Run', runText(e));
  if (obj(e.definition)) add('definition', 'Definition', definitionText(e.definition,
    { match, name }));
  if (obj(e.provenance) && obj(e.provenance.build)) add('build', 'Build',
    buildText(e.provenance.build));
  if (obj(e.studio)) add('studio', 'Studio', studioText(e.studio));
  return out;
}

// ---------------------------------------------------------------- checklist

const LABELS = Object.freeze({
  definition: 'Definition authored and stored',
  recipe: 'Recipe recorded',
  algorithms: 'Algorithm versions recorded',
  calibration: 'Calibration identity recorded',
  device: 'Input device identity recorded',
  build: 'Build identity recorded',
  hash: 'Result hash verified',
  raw: 'Raw capture retained',
  environment: 'Environment notes recorded',
});

function item(id, state, reason, stateText = STATE_TEXT[state]) {
  return { id, label: LABELS[id], state, stateText, reason };
}

function definitionItem(d, match, name) {
  if (!obj(d)) return item('definition', 'missing', 'the record names no definition');
  if (d.derived) {
    return item('definition', 'partial', 'derived from the run\'s own recipe: no authored '
      + 'definition says what was meant to be measured');
  }
  if (match === 'match') {
    return item('definition', 'recorded', `authored definition ${str(name) ? `"${name}" ` : ''}`
      + `version ${d.version}, stored in this browser with the same hash`);
  }
  return item('definition', 'partial', `authored version ${d.version}: the run carries version ${
    d.version}'s execution, but the definition ${STORED[match] || STORED.absent}`);
}

function recipeItem(r) {
  if (!obj(r) || !obj(r.stimulus)) return item('recipe', 'missing', 'no recipe is stored');
  if (r.stimulus.kind !== 'log-sweep') {
    return item('recipe', 'partial', `recorded, but this build's measurement engine runs only log `
      + `sweeps (stimulus kind ${r.stimulus.kind})`);
  }
  return item('recipe', 'recorded', 'stimulus, repeats and analysis timing as played are stored');
}

function algorithmsItem(a) {
  const keys = obj(a) ? algorithmList(a) : [];
  if (!keys.length) return item('algorithms', 'missing', 'no analysis algorithm id is stored');
  const unknown = keys.filter((k) => !isKnownAlgorithm(a[k])).map((k) => a[k]);
  if (unknown.length) {
    return item('algorithms', 'partial', `${unknown.join(', ')} ${unknown.length === 1 ? 'is'
      : 'are'} not implemented by this build`);
  }
  if (!str(a.transfer)) {
    return item('algorithms', 'partial', 'the transfer algorithm that made the response is not '
      + 'recorded');
  }
  return item('algorithms', 'recorded', `${keys.length} versioned ids, each implemented by this `
    + 'build');
}

function calibrationItem(e) {
  if (!obj(e.calibration)) return item('calibration', 'missing', 'no calibration block is stored');
  const findings = calibrationClaimFindings(e);
  if (findings.length) {
    return item('calibration', 'partial', `${CONTRADICTED_TEXT}: the record's own results `
      + `contradict ${findings.map((f) => f.path).join(', ')}`);
  }
  const f = e.calibration.frequency;
  const l = e.calibration.level;
  if (!obj(f) && !obj(l)) {
    return item('calibration', 'recorded', 'uncalibrated, stated: no frequency profile and no '
      + 'level calibration applied');
  }
  if (obj(f) && !str(f.id)) {
    return item('calibration', 'partial', 'a frequency profile is named without its id');
  }
  if (obj(l) && !obj(l.input)) {
    return item('calibration', 'partial', 'the level calibration is not bound to an input (it '
      + 'applies to every input)');
  }
  return item('calibration', 'recorded', [obj(f) ? `frequency profile id ${short(f.id)}` : null,
    obj(l) ? 'level calibration with its offset and input binding' : null].filter(Boolean)
    .join('; '));
}

function deviceItem(e) {
  const d = obj(e.input) && obj(e.input.device) ? e.input.device : {};
  const k = obj(e.input) && obj(e.input.constraints) ? e.input.constraints.applied : null;
  const flags = flagsText(k);
  const tc = testContextOf(e);
  if (!str(d.label) && !str(d.id)) {
    return item('device', 'missing', tc ? `${tc}: no physical input device`
      : `${UNKNOWN_DEVICE.replace(/^Unknown \/ /, 'the ')}`);
  }
  if (!str(d.label)) {
    return item('device', 'partial', 'the browser did not expose a label; a hashed device id is '
      + 'recorded');
  }
  if (!flags) {
    return item('device', 'partial', `"${d.label}" is recorded; processing flags not recorded`);
  }
  return item('device', 'recorded', `"${d.label}" with its processing flags${str(d.id)
    ? ' and a hashed device id' : ''}`);
}

function buildItem(b) {
  if (!obj(b) || !str(b.version)) {
    return item('build', 'missing', 'the build that made the record is not recorded');
  }
  const ids = [str(b.sourceDigest) ? 'source digest' : null,
    str(b.artifactSha256) ? 'artifact SHA-256' : null, str(b.commit) ? 'commit' : null]
    .filter(Boolean);
  if (!ids.length) {
    return item('build', 'partial', `version ${b.version} only; no source digest, artifact `
      + 'SHA-256 or commit');
  }
  if (b.dirty) {
    return item('build', 'partial', `version ${b.version} with uncommitted changes: the source is `
      + 'not reproducible from the commit');
  }
  return item('build', 'recorded', `version ${b.version} with ${ids.join(', ')}`);
}

function hashItem(e, sha256Hex) {
  const p = obj(e.provenance) ? e.provenance : {};
  if (!str(p.resultHash)) return item('hash', 'missing', 'no result hash is stored');
  const version = resultHashVersionOf(e);
  let actual = null;
  try {
    actual = resultHash(e, sha256Hex ? { version, sha256Hex } : { version });
  } catch (err) {
    actual = null;
  }
  if (actual !== p.resultHash) {
    return item('hash', 'missing', 'a result hash is stored, but recomputing it over the record '
      + 'gives another value', 'does not verify');
  }
  if (version < RESULT_HASH_VERSION) {
    const covers = { 1: 'covers the results only', 2: 'leaves out the repeats, build, recipe and '
      + 'definition', 3: 'leaves out the recipe and definition' }[version];
    return item('hash', 'partial', `recomputed and equal; version ${version} ${covers}`,
      'verified, partial');
  }
  return item('hash', 'recorded', `recomputed over the stored record and equal (version ${
    version}, recipe and definition included)`, 'verified');
}

function environmentItem(e) {
  const n = obj(e.environment) ? e.environment.notes : null;
  if (!str(n)) {
    return item('environment', 'missing', 'no location or set-up notes were recorded at '
      + 'measurement time');
  }
  const t = n.replace(/\s+/g, ' ').trim();
  return item('environment', 'recorded', `"${t.length > 80 ? `${t.slice(0, 79)}…` : t}"`);
}

/** See the header. */
export function reproducibilityChecklist(e, { match = 'absent', name = null, sha256Hex = null }
  = {}) {
  const x = obj(e) ? e : {};
  return [
    definitionItem(x.definition, match, name),
    recipeItem(x.recipe),
    algorithmsItem(x.algorithms),
    calibrationItem(x),
    deviceItem(x),
    buildItem(obj(x.provenance) ? x.provenance.build : null),
    hashItem(x, sha256Hex),
    item('raw', 'missing', RAW_CAPTURE_REASON, 'not retained'),
    environmentItem(x),
  ];
}

/** See the header. */
export function runEvidence(e, opts = {}) {
  const hz = num(opts.hz) && opts.hz > 0 ? opts.hz : defaultEvidenceHz(e);
  return { hz, point: resultPoint(e, hz), lineage: evidenceLineage(e, { ...opts, hz }),
    checklist: reproducibilityChecklist(e, opts) };
}

/** See the header. */
export function evidenceDifferences(checklists) {
  const lists = Array.isArray(checklists) ? checklists.filter(Array.isArray) : [];
  if (lists.length < 2) return [];
  return lists[0].map((c) => ({ id: c.id, label: c.label,
    states: lists.map((l) => (l.find((x) => x.id === c.id) || {}).state || 'missing') }))
    .filter((d) => d.states.some((s) => s !== d.states[0]));
}

/** See the header. */
export function evidenceDifferencesText(diffs, labels = []) {
  if (!diffs.length) {
    return 'Evidence differences: none (every checklist item has the same state in each run).';
  }
  return `Evidence differences: ${diffs.map((d) => `${d.label} (${d.states.map((s, i) => `${
    labels[i] || String.fromCharCode(65 + i)} ${STATE_TEXT[s]}`).join(', ')})`).join('; ')}.`;
}
