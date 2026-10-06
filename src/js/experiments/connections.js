// Connected records (ADR 0048): from any stored record, what it is connected to (upstream: what
// it was made from or rests on) and what depends on it (downstream: what cites it or was made
// from it). Pure: plain data in, plain data out; no DOM, no storage, no clock.
//
// Every connection comes from ONE stored field, and names it. Nothing is inferred from
// similarity, timing or names: two runs with the same recipe, name or time are not connected
// unless one stores the other's id or hash. A reference whose target is not stored here is
// listed as missing, never hidden and never repaired.
//
// A connection is 'present' only when the identity it names verifies: the target is stored
// here, was read (a stored run is validated and its result hash recomputed on every read,
// store.js), and is the record the field names (the same result hash, definition version hash
// or Studio hash). Every other case says which it is:
//   missing       nothing is stored here under the id (deleted, or never stored here)
//   mismatch      something is stored under the id, but not what the field names (another
//                 result hash, a definition without that version hash, a definition where a
//                 run was named)
//   unverifiable  the target is stored and readable, but the field records no identity to
//                 check it against (a repeat names its original by id only; a result hash is
//                 not stamped on one side; a build without a source digest)
//   unreadable    a record is stored under the id, but it cannot be read (it fails
//                 validation, or its result hash does not verify)
//
//   runLinks(experiment) -> { resultHash, repeatOf, duplicateOf, studio }
//     the references a run stores (a decoded experiment or its serialized document); store.js
//     keeps it on each list row (`links`), so a run's dependents are found without reading
//     every record. studio = { hash, measured: { v, hash } | null } | null.
//   connectionsOf(subject, index) -> { kind, id, upstream: [Connection], downstream:
//     [Connection], notes: [{ field, text }], more: { upstream, downstream } }
//     subject  { kind: 'run', record: experiment (read and verified) }
//              | { kind: 'definition', record: definition } | { kind: 'finding', record }
//              | { kind: 'studio', record: { id, name, studioHash, measured } }
//     index    what this browser stores, as the caller read it:
//              { runs: [{ experimentId, name, definition, links, readable, reason,
//                         hasResponse, frequencies }]
//                  links null: not known; readable true (the record was read and verified),
//                  false (it could not be read, `reason` says why), absent (not read);
//                  hasResponse and frequencies (evidence.js storedResponseFrequencies) of a
//                  record that was read,
//                definitions: [definition], unreadableDefinitions: [id],
//                findings: [finding],
//                studio: { projects: [{ id, name, studioHash, measured }], unreadable: [id] }
//                        | null (not read),
//                build: { version, sourceDigest, artifactSha256 } | null (the running build),
//                profile: { id, name } | null (the frequency profile loaded in Measure) }
//     Each list is bounded by CONNECTION_LIMIT; `more` counts what was left out.
//   runTargets(result) -> [experimentId]   the runs a result names, to be read and verified
//   Connection = { direction, relation, label, from: { kind, id }, to: { kind, id, version? },
//     field, fieldOf, state, target, text, href, open }
//     field    the stored field the connection comes from (a path on the record `fieldOf`
//              names: 'this run', 'that run', 'this finding', 'that finding')
//     text     the state in words, starting with STATE_WORDS[state]
//     href     the target's address (core/url-state-records.js, '#m=about', '#m=measure'), or
//              null when nothing can be opened (missing, unreadable); open: { kind: 'studio', id } for a stored Studio
//              project (opened through Studio's own Projects and patches dialog)
//
// Studio (ADR 0038): a run stores the Studio graph it was measured from (`studio.execution`)
// and its hashes, never a project id. A stored project is connected only when the hash
// recomputed over it, by the same functions (studio/schema.js studioHash, experiments/hash.js
// measuredPathHash over studio/provenance.js measuredPath), equals the hash the run stores. The
// caller recomputes it over each project as it loads; this module compares hashes only.

import { storedMatch } from './definition.js';
import { findingIssues, refRunIds, exactHzText } from './findings.js';
import { defaultEvidenceHz, storedResponseFrequencies } from './evidence.js';
import { MEASURED_PATH_VERSION } from './hash.js';
import { calibrationClaimFindings } from './validate.js';
import { encodeRecordLink } from '../core/url-state-records.js';

export const CONNECTION_STATES = Object.freeze(['present', 'missing', 'mismatch',
  'unverifiable', 'unreadable']);
export const STATE_WORDS = Object.freeze({ present: 'stored here', missing: 'missing',
  mismatch: 'does not match', unverifiable: 'not verifiable', unreadable: 'unreadable' });
export const SUBJECT_KINDS = Object.freeze(['run', 'definition', 'finding', 'studio']);
/** Most connections listed per direction; the rest are counted in `more`. */
export const CONNECTION_LIMIT = 50;

const obj = (v) => !!v && typeof v === 'object';
const str = (v) => typeof v === 'string' && v !== '';
const short = (id) => (id.length > 14 ? `${id.slice(0, 12)}…` : id);
const NOT_HERE = 'not stored in this browser (deleted, or never stored here)';

/** See the header. */
export function runLinks(e) {
  const p = obj(e) && obj(e.provenance) ? e.provenance : {};
  const s = obj(e) && obj(e.studio) ? e.studio : null;
  const m = s && obj(s.measured) && str(s.measured.hash) ? s.measured : null;
  return {
    resultHash: str(p.resultHash) ? p.resultHash : null,
    repeatOf: str(p.repeatOf) ? p.repeatOf : null,
    duplicateOf: str(p.duplicateOf) ? p.duplicateOf : null,
    studio: s && str(s.studioHash) ? { hash: s.studioHash,
      measured: m ? { v: m.v, hash: m.hash } : null } : null,
  };
}

const link = (kind, id) => `#${encodeRecordLink({ kind, id })}`;
const runName = (row, id) => (row && str(row.name) ? `run "${row.name}"` : `run ${short(id)}`);
const defName = (d, id) => (d && str(d.name) ? `definition "${d.name}"`
  : `definition ${short(id)}`);
const statementOf = (f) => (f.statement.length > 80 ? `${f.statement.slice(0, 79)}…`
  : f.statement);
const said = (state, why) => (why ? `${STATE_WORDS[state]}: ${why}` : STATE_WORDS[state]);

/** The lookups of an index, built once per index object. */
const views = new WeakMap();
function viewOf(index) {
  if (views.has(index)) return views.get(index);
  const runs = Array.isArray(index.runs) ? index.runs.filter(obj) : [];
  const v = {
    runs,
    run: new Map(runs.map((r) => [r.experimentId, r])),
    defs: new Map((index.definitions || []).map((d) => [d.id, d])),
    unreadableDefs: new Set(index.unreadableDefinitions || []),
    findings: Array.isArray(index.findings) ? index.findings : [],
    studio: obj(index.studio) ? index.studio : null,
    build: obj(index.build) ? index.build : null,
    profile: obj(index.profile) ? index.profile : null,
    unknown: runs.filter((r) => !obj(r.links)).length,
  };
  views.set(index, v);
  return v;
}

function connection(direction, relation, label, from, to, field, fieldOf, [state, why], target,
  { href = null, open = null } = {}) {
  return { direction, relation, label, from, to, field, fieldOf, state, target,
    text: said(state, why), href: state === 'missing' || state === 'unreadable' ? null : href,
    open };
}

/**
 * The state of a stored run named by id. `expect`: the result hash the field records for it
 * (null: none recorded; undefined: the field records no identity at all, `byId` says why).
 */
function runState(row, expect, byId = null) {
  if (!row) return ['missing', NOT_HERE];
  if (row.readable === false) {
    return ['unreadable', `a record is stored under this id, but it cannot be read${
      str(row.reason) ? ` (${row.reason})` : ''}`];
  }
  if (row.readable !== true || !obj(row.links)) {
    return ['unverifiable', 'its stored record was not read, so its identity is not checked'];
  }
  if (expect === undefined) return ['unverifiable', byId];
  const theirs = row.links.resultHash;
  if (!expect || !theirs) {
    return ['unverifiable', !theirs ? 'the stored run has no result hash (it was not stamped), '
      + 'so its identity cannot be checked' : 'no result hash is recorded for it, so its '
      + 'identity cannot be checked'];
  }
  if (expect !== theirs) {
    return ['mismatch', 'a different record is stored under this id (its result hash differs '
      + 'from the one recorded)'];
  }
  return ['present', 'with the result hash recorded, recomputed when it was read'];
}

// ---------------------------------------------------------------- run

function definitionUp(e, v, me) {
  const d = e.definition;
  if (!obj(d)) return { note: { field: 'definition', text: 'This run names no definition.' } };
  if (d.derived) {
    return { note: { field: 'definition.derived', text: 'Its definition is derived from its own '
      + 'recipe, not authored: it references no stored definition.' } };
  }
  const stored = v.defs.get(d.id) || null;
  const match = !stored && v.unreadableDefs.has(d.id) ? 'unreadable' : storedMatch(d, stored);
  const target = `${defName(match === 'match' ? stored : null, d.id)} version ${d.version}`;
  const args = ['upstream', 'definition', 'Executed from', me,
    { kind: 'definition', id: d.id, version: d.version },
    'definition (id, version and hash)', 'this run'];
  const href = link('definition', d.id);
  if (match === 'match') {
    return { c: connection(...args, ['present', 'that version is stored with the same hash'],
      target, { href }) };
  }
  if (match === 'mismatch') {
    return { c: connection(...args, ['mismatch', `the definition stored under this id ${
      stored.name ? `("${stored.name}") ` : ''}has no version ${d.version} with this hash`],
    target, { href }) };
  }
  if (match === 'unreadable') {
    return { c: connection(...args, ['unreadable', 'a definition is stored under this id, but it '
      + 'cannot be read'], target) };
  }
  return { c: connection(...args, ['missing', NOT_HERE], target) };
}

function runUp(kind, e, v, me) {
  const l = runLinks(e);
  const id = kind === 'repeat-of' ? l.repeatOf : l.duplicateOf;
  if (!id) return null;
  const row = v.run.get(id) || null;
  const label = kind === 'repeat-of' ? 'A repeat of' : 'A duplicate of';
  const field = kind === 'repeat-of' ? 'provenance.repeatOf' : 'provenance.duplicateOf';
  // A repeat is a new measurement: it names the run it repeats by id only. A duplicate is the
  // same run copied, so it keeps the original's result hash.
  const state = kind === 'repeat-of' ? runState(row, undefined, 'a repeat names the run it '
    + 'repeats by id only; it does not record that run\'s result hash') : runState(row,
    l.resultHash);
  return connection('upstream', kind, label, me, { kind: 'run', id }, field, 'this run', state,
    runName(row, id), { href: link('run', id) });
}

function studioUp(e, v, me, notes) {
  const s = runLinks(e).studio;
  if (!s) return [];
  if (!v.studio) {
    notes.push({ field: 'studio.studioHash', text: 'The Studio projects stored here could not be '
      + 'read, so none was compared with the graph this run records.' });
    return [];
  }
  const projects = Array.isArray(v.studio.projects) ? v.studio.projects.filter(obj) : [];
  const unreadable = Array.isArray(v.studio.unreadable) ? v.studio.unreadable.length : 0;
  if (unreadable) {
    notes.push({ field: 'studio.studioHash', text: `${unreadable} stored Studio project${
      unreadable === 1 ? '' : 's'} could not be read and ${unreadable === 1 ? 'was' : 'were'} not `
      + 'compared.' });
  }
  const out = [];
  const pName = (p) => `Studio project "${p.name || p.id}"`;
  const at = (p) => ({ href: '#m=studio', open: { kind: 'studio', id: p.id } });
  const whole = projects.filter((p) => p.studioHash === s.hash);
  for (const p of whole) {
    out.push(connection('upstream', 'studio-graph', 'Measured from the graph of', me,
      { kind: 'studio', id: p.id }, 'studio.studioHash', 'this run', ['present', 'its saved '
        + 'graph, recomputed as it loads, has the hash this run stores'], pName(p), at(p)));
  }
  const m = s.measured;
  if (m && m.v !== MEASURED_PATH_VERSION) {
    notes.push({ field: 'studio.measured', text: `The measured path is recorded in version ${
      m.v}; this build computes version ${MEASURED_PATH_VERSION}, so no project is compared by `
      + 'it.' });
  } else if (m) {
    for (const p of projects) {
      if (whole.includes(p) || !obj(p.measured) || p.measured.hash !== m.hash) continue;
      out.push(connection('upstream', 'studio-path', 'Measured path held by', me,
        { kind: 'studio', id: p.id }, 'studio.measured.hash', 'this run', ['present', 'its saved '
          + 'graph holds the measured path with the hash this run stores; other parts of its '
          + 'graph differ from the graph recorded'], pName(p), at(p)));
    }
  }
  if (!out.length) {
    out.push(connection('upstream', 'studio-graph', 'Measured from the graph of', me,
      { kind: 'studio', id: null }, m ? 'studio.studioHash and studio.measured.hash'
        : 'studio.studioHash', 'this run', ['missing', 'no Studio project stored here has this '
        + `graph${m ? ' or its measured path' : ''} now (the run stores the graph itself, not a `
        + 'project)'], 'a Studio project'));
  }
  return out;
}

function profileUp(e, v, me) {
  const f = obj(e.calibration) && obj(e.calibration.frequency) ? e.calibration.frequency : null;
  if (!f || !str(f.id)) return null;
  const contradicted = calibrationClaimFindings(e).some((x) => x.path
    .startsWith('calibration.frequency'));
  const also = contradicted ? '; the record\'s own results contradict this claim, so it is '
    + 'presented as uncalibrated' : '';
  const args = ['upstream', 'profile', 'Frequency profile named', me,
    { kind: 'profile', id: f.id }, 'calibration.frequency.id', 'this run'];
  const target = `frequency profile "${f.name || short(f.id)}"`;
  // A profile id is the SHA-256 of its points (calibration/profile.js): equal ids are equal
  // profiles.
  if (v.profile && v.profile.id === f.id) {
    return connection(...args, ['present', `loaded in Measure with this id (the hash of its `
      + `points) for this page view; a profile is kept only while it is loaded${also}`], target,
    { href: '#m=measure' });
  }
  return connection(...args, ['missing', `not loaded here: OSCILLA keeps a frequency profile `
    + `only while it is loaded in Measure; load its file to check it${also}`], target);
}

function buildUp(e, v, me, notes) {
  const b = obj(e.provenance) && obj(e.provenance.build) ? e.provenance.build : null;
  if (!b || !str(b.version)) {
    notes.push({ field: 'provenance.build', text: 'No build is recorded.' });
    return null;
  }
  const cur = v.build;
  if (!cur) return null;
  const args = ['upstream', 'build', 'Made by', me, { kind: 'build', id: b.version },
    'provenance.build', 'this run'];
  const target = `OSCILLA ${b.version}`;
  const about = { href: '#m=about' };
  if (b.version !== cur.version) {
    return connection(...args, ['missing', `this page runs OSCILLA ${cur.version}; a build is `
      + 'not a stored record'], target);
  }
  if (!str(b.sourceDigest) || !str(cur.sourceDigest)) {
    return connection(...args, ['unverifiable', 'the same version number, but a source digest '
      + 'is not recorded on both sides, so it cannot be shown to be the build running this page'],
    target, about);
  }
  if (b.sourceDigest !== cur.sourceDigest) {
    return connection(...args, ['mismatch', 'the same version number with another source '
      + 'digest: a different build'], target, about);
  }
  if (str(b.artifactSha256) && str(cur.artifactSha256) && b.artifactSha256 !== cur.artifactSha256) {
    return connection(...args, ['mismatch', 'the same source with another artifact SHA-256: a '
      + 'different file'], target, about);
  }
  return connection(...args, ['present', 'the build running this page (the same version and '
    + 'source digest)'], target, about);
}

/** How finding `f` cites run `id`: [{ index, words }]. */
function citations(f, id) {
  const out = [];
  f.evidence.forEach((ref, index) => {
    if (ref.kind === 'run' && ref.experimentId === id) out.push({ index, words: 'this run' });
    else if (ref.kind === 'value' && ref.experimentId === id) {
      out.push({ index, words: `its value at ${exactHzText(ref.at.hz)}` });
    } else if (ref.kind === 'compare' && (ref.a === id || ref.b === id)) {
      out.push({ index, words: `a comparison with ${short(ref.a === id ? ref.b : ref.a)}` });
    }
  });
  return out;
}

/** The state of a run whose record names the subject: it must be readable itself. */
function referrerState(row, then) {
  if (row.readable === false) {
    return ['unreadable', `it cannot be read${str(row.reason) ? ` (${row.reason})` : ''}`];
  }
  if (row.readable !== true) {
    return ['unverifiable', 'its stored record was not read, so it is not checked'];
  }
  return then();
}

function runDown(e, v, me) {
  const id = e.experimentId;
  const mine = runLinks(e).resultHash;
  const out = [];
  const lookup = issueLookup(v, e);
  for (const f of v.findings) {
    const how = citations(f, id);
    if (!how.length) continue;
    const j = f.runs.findIndex((r) => r.experimentId === id);
    const issues = findingIssues(f, lookup);
    const words = `it cites ${how.map((x) => x.words).join('; ')}`;
    // The worst state among its references to this run (one connection per finding).
    const states = how.map((x) => citedState(issues, x.index, id, `${words}, with this run's `
      + 'result hash'));
    const rank = ['unreadable', 'mismatch', 'unverifiable', 'missing', 'present'];
    const [state, why] = states.sort((a, b) => rank.indexOf(a[0]) - rank.indexOf(b[0]))[0];
    out.push(connection('downstream', 'cited-by', 'Cited by', me, { kind: 'finding', id: f.id },
      `${how.map((x) => `evidence[${x.index}]`).join(', ')} (identity: runs[${j}].resultHash)`,
      'that finding', [state, state === 'present' ? why : `${words}; ${why}`],
      `finding "${statementOf(f)}"`, { href: link('finding', f.id) }));
  }
  for (const row of v.runs) {
    if (!obj(row.links) || row.experimentId === id) continue;
    const args = (relation, label, field) => ['downstream', relation, label, me,
      { kind: 'run', id: row.experimentId }, field, 'that run'];
    const href = link('run', row.experimentId);
    if (row.links.repeatOf === id) {
      out.push(connection(...args('repeated-by', 'Repeated by', 'provenance.repeatOf'),
        referrerState(row, () => ['unverifiable', 'a new measurement that names this run\'s id '
          + 'as the one it repeats; a repeat does not record the result hash of that run']),
        runName(row, row.experimentId), { href }));
    }
    if (row.links.duplicateOf === id) {
      const theirs = row.links.resultHash;
      out.push(connection(...args('duplicated-as', 'Duplicated as', 'provenance.duplicateOf'),
        referrerState(row, () => (!mine || !theirs ? ['unverifiable', 'a copy that names this '
          + 'run\'s id, but a result hash is missing on one side'] : theirs !== mine
          ? ['mismatch', 'it names this run\'s id as its original, but its result hash differs']
          : ['present', 'a copy of this run under a new id, with the same result hash'])),
        runName(row, row.experimentId), { href }));
    }
  }
  return out;
}

function unknownRunsNote(v, notes, what) {
  if (!v.unknown) return;
  notes.push({ field: what, text: `${v.unknown} stored run${v.unknown === 1 ? '' : 's'} could `
    + `not be read; ${v.unknown === 1 ? 'it was' : 'they were'} not checked.` });
}

// ---------------------------------------------------------------- the other subjects

/** findingIssues code -> connection state (see the header). */
const ISSUE_STATE = Object.freeze({ 'missing-run': 'missing', 'unreadable-run': 'unreadable',
  'unverifiable-identity': 'unverifiable', 'different-run': 'mismatch', 'wrong-kind': 'mismatch',
  'no-response': 'mismatch', 'not-a-grid-point': 'mismatch' });

/** The findingIssues lookup over the index (and the subject run, read and verified). */
function issueLookup(v, self = null) {
  return (id) => {
    if (self && id === self.experimentId) {
      return { kind: 'run', name: self.name || null, readable: true,
        resultHash: runLinks(self).resultHash, hasResponse: defaultEvidenceHz(self) !== null,
        frequencies: storedResponseFrequencies(self) };
    }
    const row = v.run.get(id);
    if (!row) return v.defs.has(id) ? { kind: 'definition', name: v.defs.get(id).name } : null;
    const read = row.readable === true;
    return { kind: 'run', name: row.name || null,
      readable: row.readable === false ? false : read ? true : undefined, reason: row.reason,
      // A row that was not read has no verified hash: "its stored result hash has not been read".
      resultHash: read && obj(row.links) ? row.links.resultHash : undefined,
      hasResponse: read ? row.hasResponse : undefined,
      frequencies: read ? row.frequencies : undefined };
  };
}

/** The state of finding `f`'s reference `index` to run `id`, by findingIssues. */
function citedState(issues, index, id, okWords) {
  const x = issues.find((i) => i.index === index && i.experimentId === id);
  if (!x) return ['present', okWords];
  return [ISSUE_STATE[x.code] || 'mismatch', x.text.replace(/^missing: /, '')];
}

function findingUp(f, v, me) {
  const out = [];
  const issues = findingIssues(f, issueLookup(v));
  const j = (id) => f.runs.findIndex((r) => r.experimentId === id);
  f.evidence.forEach((ref, i) => {
    refRunIds(ref).forEach((id, k) => {
      const key = ref.kind === 'compare' ? (k === 0 ? 'a' : 'b') : 'experimentId';
      const label = ref.kind === 'value' ? `Cites the value at ${exactHzText(ref.at.hz)} of`
        : ref.kind === 'compare' ? `Cites a comparison (${k === 0 ? 'A' : 'B'}) with` : 'Cites';
      const row = v.run.get(id) || null;
      const isDef = !row && v.defs.has(id);
      const state = citedState(issues, i, id, ref.kind === 'value' ? 'with the cited result hash, '
        + 'at a frequency the run stores' : 'with the cited result hash, recomputed when it was '
        + 'read');
      out.push(connection('upstream', 'cites', label, me, { kind: 'run', id },
        `evidence[${i}].${key} (identity: runs[${j(id)}].resultHash)`, 'this finding', state,
        isDef ? defName(v.defs.get(id), id) : runName(row, id),
        { href: isDef ? link('definition', id) : link('run', id) }));
    });
  });
  return out;
}

function definitionDown(d, v, me) {
  const out = [];
  for (const row of v.runs) {
    const r = row.definition;
    if (!obj(r) || r.derived || r.id !== d.id) continue;
    const state = referrerState(row, () => (storedMatch(r, d) === 'match'
      ? ['present', `it ran version ${r.version}, with the hash this definition stores`]
      : ['mismatch', `it names version ${r.version} of this id with a hash this definition does `
        + 'not store']));
    out.push(connection('downstream', 'executed', 'Executed by', me,
      { kind: 'run', id: row.experimentId }, 'definition (id, version and hash)', 'that run',
      state, runName(row, row.experimentId), { href: link('run', row.experimentId) }));
  }
  return out;
}

function studioDown(p, v, me) {
  const out = [];
  for (const row of v.runs) {
    const s = obj(row.links) ? row.links.studio : null;
    if (!s) continue;
    const args = (relation, label, field) => ['downstream', relation, label, me,
      { kind: 'run', id: row.experimentId }, field, 'that run'];
    const href = link('run', row.experimentId);
    if (s.hash === p.studioHash) {
      out.push(connection(...args('measured-graph', 'Measured from this graph by',
        'studio.studioHash'), referrerState(row, () => ['present', 'it stores the hash of this '
        + 'project\'s saved graph, recomputed as it loads']), runName(row, row.experimentId),
      { href }));
    } else if (obj(s.measured) && obj(p.measured) && s.measured.v === p.measured.v
      && s.measured.hash === p.measured.hash) {
      out.push(connection(...args('measured-path', 'Measured path held here, by',
        'studio.measured.hash'), referrerState(row, () => ['present', 'it stores the hash of a '
        + 'measured path this project holds; other parts of the graph it recorded differ']),
      runName(row, row.experimentId), { href }));
    }
  }
  return out;
}

// ---------------------------------------------------------------- entry

function bounded(list) {
  return { list: list.slice(0, CONNECTION_LIMIT), more: Math.max(0, list.length
    - CONNECTION_LIMIT) };
}

/** See the header. */
export function connectionsOf(subject, index = {}) {
  if (!obj(subject) || !SUBJECT_KINDS.includes(subject.kind) || !obj(subject.record)) {
    throw new TypeError('connectionsOf: a subject { kind, record } is required');
  }
  const v = viewOf(index);
  const r = subject.record;
  const notes = [];
  let up = [];
  let down = [];
  let id;
  if (subject.kind === 'run') {
    id = r.experimentId;
    const me = { kind: 'run', id };
    const def = definitionUp(r, v, me);
    if (def.note) notes.push(def.note);
    up = [def.c, runUp('repeat-of', r, v, me), runUp('duplicate-of', r, v, me),
      ...studioUp(r, v, me, notes), profileUp(r, v, me), buildUp(r, v, me, notes)]
      .filter(Boolean);
    down = runDown(r, v, me);
    unknownRunsNote(v, notes, 'provenance.repeatOf, provenance.duplicateOf');
  } else if (subject.kind === 'definition') {
    id = r.id;
    notes.push({ field: null, text: 'A definition stores no reference to another record.' });
    down = definitionDown(r, v, { kind: 'definition', id });
  } else if (subject.kind === 'finding') {
    id = r.id;
    up = findingUp(r, v, { kind: 'finding', id });
    notes.push({ field: null, text: 'No record stores a reference to a finding.' });
  } else {
    id = r.id;
    notes.push({ field: null, text: 'A Studio project stores no reference to another record.' });
    down = studioDown(r, v, { kind: 'studio', id });
    unknownRunsNote(v, notes, 'studio.studioHash');
  }
  const u = bounded(up);
  const d = bounded(down);
  return { kind: subject.kind, id, upstream: u.list, downstream: d.list, notes,
    more: { upstream: u.more, downstream: d.more } };
}

/** The ids of the stored runs a result names (to read and verify before it is shown). */
export function runTargets(result) {
  return [...new Set([...result.upstream, ...result.downstream]
    .filter((c) => c.to.kind === 'run' && c.state !== 'missing').map((c) => c.to.id))];
}
