// Semantic run comparison (ADR 0041). Pure: plain data in, plain data out; no DOM, no clock.
//
//   runChanges(a, b, { studioChanges }) -> [Change]   what changed between run a (the
//     reference: the baseline when one is set) and run b. Never modifies either run.
//   Change = { domain, path, kind: 'added'|'removed'|'changed'|'unchanged',
//     class: 'execution'|'presentation'|'metadata', before, after, unit?, label, note? }
//   runFields(list) -> [Field]   the descriptors runChanges and compare.js compareExperiments
//     share: { path, domain, label, get, unit?, severity?, expand? }. `severity` marks the
//     fields of compareExperiments' differences ('warn' decides equivalence, 'info' is shown).
//
// Domains, in display order (DOMAINS): definition (ADR 0043: the authored definition version
// each run was executed from, { id, version, hash }, or { derived: true } for a run with none
// (its definition is its own recipe, which the recipe domain compares); `note` says plainly
// when the same definition was edited between the runs, or that they come from different ones),
// recipe (stimulus and analysis key by key, with Hz and s
// units; repeats; the requested range), algorithms (per role; `note` names a version step of
// one method), calibration (profile id, level calibration identity), conditions (sample rate,
// input device and constraints, output level and master gain, notes recorded at measurement
// time), studio (studio/diff.js studioChanges over the recorded execution states, injected so
// this layer never imports the Studio layer), build (schema and OSCILLA version, commit,
// source digest, artifact SHA-256), result (quality verdict and reasons by code, stored
// response kind, aggregated runs, result algorithms) and metadata (name, annotations).
// Everything else is class 'execution'; only studioChanges reports 'presentation'.
// Identity and time (experimentId, createdAt, startedAt, hashes, lineage) are not compared:
// two runs always differ there. Fixed fields and algorithm roles are listed even when
// unchanged; collections (quality reasons, Studio items) list only what differs. Order is
// deterministic: DOMAINS, then descriptor order, then ids and keys sorted by code unit.
// Values keep full precision (the view formats them); units and labels come from these
// descriptors, the algorithm registry (describeAlgorithm) and the Studio node registry.
// A change says WHAT differs between two records, never why the responses differ.

import { canonicalJson } from './canonical-json.js';
import { describeAlgorithm } from '../measurement/algorithms.js';
import { TIMING_LIMITS } from '../measurement/engine.js';

export const DOMAINS = Object.freeze(['definition', 'recipe', 'algorithms', 'calibration',
  'conditions', 'studio', 'build', 'result', 'metadata']);
export const DOMAIN_LABELS = Object.freeze({ definition: 'Definition', recipe: 'Recipe',
  algorithms: 'Algorithms', calibration: 'Calibration', conditions: 'Input and output conditions',
  studio: 'Studio graph and timeline', build: 'Build provenance', result: 'Result and quality',
  metadata: 'Metadata' });

const same = (x, y) => canonicalJson(x ?? null) === canonicalJson(y ?? null);
const byCode = (x, y) => (x < y ? -1 : x > y ? 1 : 0);
const keysOf = (...objs) => [...new Set(objs.flatMap((o) => (o && typeof o === 'object'
  ? Object.keys(o) : [])))].sort(byCode);
const at = (e, path) => path.split('.').reduce((v, k) => (v == null ? null : v[k] ?? null), e);

/** The level calibration identity compared (the fields configHash covers). */
export function levelIdentity(l) {
  if (!l) return null;
  return { referenceHz: l.referenceHz, referenceDbSpl: l.referenceDbSpl,
    observedDbRelative: l.observedDbRelative, offsetDb: l.offsetDb };
}

const isRepeated = (a) => !!a && Number.isInteger(a.runs) && a.runs >= 2 && !!a.centreDb;

/** The stored response kind of an experiment: { label, runs } or null (no response). */
export function responseKind(e) {
  const r = e && e.results;
  if (!r) return null;
  if (isRepeated(r.aggregate)) {
    return { label: `aggregate (${r.aggregate.method})`, runs: r.aggregate.runs };
  }
  if (r.transfer) return { label: 'single run', runs: null };
  return null;
}

const HZ = { f: 'Hz', f1: 'Hz', f2: 'Hz', sampleRate: 'Hz', duration: 's', fade: 's' };
/** Expand an object field key by key: [key, label, unit] (sorted keys). */
const keyed = (name, unit) => (x, y) => keysOf(x, y).map((k) => [k, `${name} ${k}`, unit(k)]);

const FIXED = [
  // [path, domain, label, unit, severity, get, expand] in compareExperiments' order
  ['definition', 'definition', 'Definition version', null, null, (e) => {
    const d = e.definition;
    return !d ? null : d.derived ? { derived: true } : { id: d.id, version: d.version,
      hash: d.hash };
  }],
  ['calibration.frequency', 'calibration', 'Frequency calibration profile', null, 'warn',
    (e) => at(e, 'calibration.frequency.id')],
  ['calibration.level', 'calibration', 'Level calibration', null, 'warn',
    (e) => levelIdentity(at(e, 'calibration.level'))],
  ['measurement.sampleRate', 'conditions', 'Sample rate', 'Hz', 'warn'],
  ['recipe.stimulus', 'recipe', 'Stimulus', null, 'warn', null,
    keyed('Stimulus', (k) => HZ[k])],
  ['recipe.analysis', 'recipe', 'Analysis settings', null, 'warn', null,
    keyed('Analysis', (k) => (TIMING_LIMITS[k] ? 's' : null))],
  ['recipe.repeats', 'recipe', 'Repeats', 'runs', 'info'],
  ['output.level', 'conditions', 'Output level (digital peak)', null, 'info'],
  ['output.masterGain', 'conditions', 'Master output gain', 'linear gain', 'warn'],
  ['schemaVersion', 'build', 'Schema version', null, 'info'],
  ['oscillaVersion', 'build', 'OSCILLA version', null, 'info'],
  ['oscillaCommit', 'build', 'OSCILLA commit', null, 'info'],
  ['input.device.label', 'conditions', 'Input device', null, 'info'],
  ['recipe.requested', 'recipe', 'Requested', null, null, null, keyed('Requested', () => 'Hz')],
  ['input.constraints.requested', 'conditions', 'Requested input constraints'],
  ['input.constraints.applied', 'conditions', 'Applied input constraints'],
  ['environment.notes', 'conditions', 'Notes recorded at measurement time'],
  ['provenance.build.sourceDigest', 'build', 'Source digest'],
  ['provenance.build.artifactSha256', 'build', 'Artifact SHA-256'],
  ['quality.status', 'result', 'Quality verdict'],
  ['name', 'metadata', 'Name'],
  ['annotations.notes', 'metadata', 'Notes'],
  ['annotations.baseline', 'metadata', 'Baseline'],
];

/** The field descriptors of a set of experiments (see the header). */
export function runFields(list) {
  const f = (path, domain, label, unit, severity, get, expand) => ({ path, domain, label,
    get: get || ((e) => at(e, path)), ...(unit ? { unit } : {}),
    ...(severity ? { severity } : {}), ...(expand ? { expand } : {}) });
  const out = FIXED.map((x) => f(...x));
  const roles = keysOf(...list.map((e) => e.algorithms));
  for (const role of roles) {
    out.push(f(`algorithms.${role}`, 'algorithms', `Algorithm (${role})`, null, 'warn',
      (e) => (e.algorithms || {})[role] ?? null));
  }
  for (const kind of ['transfer', 'ir', 'rta', 'aggregate']) {
    const get = (e) => at(e, `results.${kind}.algorithm`);
    if (list.some((e) => get(e) !== null)) {
      out.push(f(`results.${kind}.algorithm`, 'result', `Result algorithm (${kind})`, null,
        'warn', get));
    }
  }
  const kinds = list.map(responseKind);
  if (kinds.some((k) => k !== null)) {
    out.push(f('results.response', 'result', 'Stored response', null, 'warn',
      (e) => { const k = responseKind(e); return k ? k.label : null; }));
    if (kinds.some((k) => k && k.runs !== null)) {
      out.push(f('results.aggregate.runs', 'result', 'Aggregated runs', 'runs', 'info',
        (e) => { const k = responseKind(e); return k ? k.runs : null; }));
    }
  }
  return out;
}

function change(domain, path, label, before, after, unit, cls) {
  const b = before ?? null;
  const a = after ?? null;
  const kind = same(b, a) ? 'unchanged' : b === null ? 'added' : a === null ? 'removed'
    : 'changed';
  return { domain, path, kind, class: cls || (domain === 'metadata' ? 'metadata' : 'execution'),
    before: b, after: a, ...(unit ? { unit } : {}), label };
}

/** "version 3 → 4 of oscilla.confidence" / "another ir method" (describeAlgorithm). */
function algorithmNote(x, y) {
  const p = describeAlgorithm(x);
  const q = describeAlgorithm(y);
  if (!p || !q || x === y) return null;
  const stem = (id) => id.replace(/\.v[0-9]+$/, '');
  if (stem(x) === stem(y)) return `version ${p.version} → ${q.version} of ${stem(x)}`;
  return p.family === q.family ? `another ${p.family} method` : null;
}

/** What a definition change means (ADR 0043), in words; null when nothing changed. */
function definitionNote(x, y) {
  if (!x || !y || same(x, y)) return null;
  if (x.id !== y.id) {
    return x.derived || y.derived ? 'not run from the same definition' : 'another definition';
  }
  return `version ${x.version} → ${y.version} of the same definition: its execution fields `
    + 'were edited between the runs';
}

/** Quality reasons keyed by code (a repeated code gets '#<position>'). */
function reasonsByCode(e) {
  const m = new Map();
  for (const r of (e && e.quality && Array.isArray(e.quality.reasons) ? e.quality.reasons : [])) {
    m.set(m.has(r.code) ? `${r.code}#${m.size + 1}` : r.code, r);
  }
  return m;
}

/** What changed between run a (reference) and run b (see the header). */
export function runChanges(a, b, { studioChanges = null } = {}) {
  const out = [];
  for (const d of runFields([a, b])) {
    const x = d.get(a);
    const y = d.get(b);
    if (d.expand) {
      for (const [k, label, unit] of d.expand(x, y)) {
        out.push(change(d.domain, `${d.path}.${k}`, label, x && x[k], y && y[k], unit));
      }
    } else {
      const c = change(d.domain, d.path, d.label, x, y, d.unit);
      const note = d.domain === 'algorithms' ? algorithmNote(x, y)
        : d.domain === 'definition' ? definitionNote(x, y) : null;
      out.push(note ? { ...c, note } : c);
    }
  }
  const ra = reasonsByCode(a);
  const rb = reasonsByCode(b);
  for (const k of keysOf(Object.fromEntries(ra), Object.fromEntries(rb))) {
    const p = ra.get(k);
    const q = rb.get(k);
    const v = (r) => (r ? { severity: r.severity ?? null, value: r.value ?? null } : null);
    const c = change('result', `quality.reasons.${k}`, `Quality reason ${k}`, v(p), v(q),
      (q || p).unit);
    if (c.kind !== 'unchanged') out.push(c);
  }
  const sa = a.studio || null;
  const sb = b.studio || null;
  if (sa && sb && sa.studioHash !== sb.studioHash && studioChanges) {
    out.push(...studioChanges(sa.execution, sb.execution));
  } else if (sa || sb) {
    out.push(change('studio', 'studio', 'Studio execution state (studioHash)',
      sa && sa.studioHash, sb && sb.studioHash));
  }
  const rank = (c) => DOMAINS.indexOf(c.domain);
  return out.map((c, i) => [c, i]).sort((p, q) => rank(p[0]) - rank(q[0]) || p[1] - q[1])
    .map(([c]) => c);
}
