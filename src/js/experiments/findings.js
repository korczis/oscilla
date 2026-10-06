// Findings (ADR 0046): a user's interpretive statement linked to the evidence it rests on. Pure:
// plain data in, plain data out; no DOM, no clock, no randomness (callers pass `now` and `id`).
//
// Three things are kept apart:
//   - a MEASUREMENT is what was observed or computed (a stored run, immutable, ADR 0040);
//   - an OBSERVATION is what the user recorded (status 'observation': not yet interpreted);
//   - a FINDING is an interpretation linked to evidence (the other statuses).
// A finding is user metadata. It never changes a run, and a run never changes a finding: a cited
// run that is deleted leaves the reference in place, reported by findingIssues as missing.
//
// FINDING (stored, store.js putFinding) =
//   { kind: 'oscilla-finding', schemaVersion: 1, id, statement, status, evidence: [ref],
//     runs: [{ experimentId, resultHash }], notes, createdAt, updatedAt }
//   statement  one line of plain text (markup, control and bidirectional characters refused)
//   status     FINDING_STATUSES, categorical; there is no confidence number. A finding that
//              claims 'supported' or 'contradicted' cites at least one reference.
//   evidence   typed references, each naming runs by experimentId:
//                { kind: 'run', experimentId }
//                { kind: 'compare', a, b }                 two different runs, A first
//                { kind: 'value', experimentId, at: { hz } }   the stored grid point at hz
//                                                            (evidence.js resultPoint, ADR 0044)
//   runs       the identity of every cited run when it was linked: its id and its stored result
//              hash (null for an unstamped record), exactly one entry per cited id. An id alone
//              is not an identity: a different record can later be stored under it, and an
//              export must carry what the evidence was (findingIssues 'different-run').
//   notes      plain text or null (may wrap)
//
//   validateFinding(value) -> { ok, finding, errors }        (never throws; a clean copy)
//   createFinding({ id, now, statement, status, evidence, runs, notes }) -> Finding  (RangeError)
//   updateFinding(finding, patch, { now }) -> Finding         (id and createdAt kept)
//   findingIssues(finding, lookup) -> [{ code, index, experimentId, text }]
//     lookup(experimentId) -> { kind: 'run', name, resultHash, hasResponse, frequencies,
//       readable, reason } | { kind, name } | null   (frequencies: the stored response grid; a
//       value reference must name one of them exactly, else 'not-a-grid-point')
//     A cited run is present only when it is readable and its stored result hash equals the
//     cited one; a hash missing on either side (or not read) is 'unverifiable-identity', never ok.
//   findingsCiting(findings, experimentId) -> [{ finding, how: [text] }]   (backlinks)
//   refText(ref, nameOf) -> text that never claims a cause
//   exportFindings(findings, { now, oscillaVersion }) -> file document; findingsToJson(doc)
//   parseFindingsFile(text, { maxBytes }) -> { ok, findings, errors, newer }   (all or nothing)
//   importPlan(incoming, stored) -> { add: [finding], same: [id], conflicts: [id] }

import {
  HEX64_PATTERN, ID_PATTERN, LIMITS, VERSION_PATTERN, createChecker,
  formatErrors, toIsoTimestamp,
} from './schema.js';

export const FINDING_KIND = 'oscilla-finding';
export const FINDING_SCHEMA_VERSION = 1;
export const FINDINGS_FILE_KIND = 'oscilla-findings';
export const FINDINGS_FILE_SCHEMA_VERSION = 1;
export const FINDINGS_FILE_EXTENSION = '.oscilla-findings.json';
export const FINDING_STATUSES = Object.freeze(['observation', 'hypothesis', 'supported',
  'contradicted', 'inconclusive']);
export const EVIDENCE_REQUIRED_STATUSES = Object.freeze(['supported', 'contradicted']);
export const EVIDENCE_KINDS = Object.freeze(['run', 'compare', 'value']);
export const ISSUE_CODES = Object.freeze(['missing-run', 'wrong-kind', 'unreadable-run',
  'different-run', 'unverifiable-identity', 'no-response', 'unsupported-status',
  'not-a-grid-point']);
export const FINDING_LIMITS = Object.freeze({
  statementChars: 1000,
  notesChars: LIMITS.notesChars,
  evidence: 32,
  findings: 2000,
  fileBytes: 8 * 1024 * 1024,
});

/** How each status reads, and what it means (never a cause, never a degree of belief). */
export const STATUS_TEXT = Object.freeze({
  observation: 'Observation', hypothesis: 'Hypothesis', supported: 'Supported',
  contradicted: 'Contradicted', inconclusive: 'Inconclusive',
});
export const STATUS_HINT = Object.freeze({
  observation: 'what you recorded, not yet interpreted',
  hypothesis: 'an interpretation not yet checked against the cited evidence',
  supported: 'you judge the cited evidence to agree with the statement',
  contradicted: 'you judge the cited evidence to disagree with the statement',
  inconclusive: 'the cited evidence does not decide it',
});

const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const MARKUP = /<[A-Za-z!/?]/;
// Characters that hide or reorder text, or are not text at all: directional marks, embeddings,
// overrides and isolates (LRM, RLM, ALM, U+202A-202E, U+2066-2069), C1 controls (U+0080-009F,
// U+0085 included), the line and paragraph separators, the zero-width space, joiners and word
// joiner, the byte order mark, and an unpaired surrogate (malformed UTF-16).
const INVISIBLE = new RegExp('[\\u0080-\\u009F\\u061C\\u200B-\\u200F\\u2028\\u2029'
  + '\\u202A-\\u202E\\u2060-\\u2064\\u2066-\\u2069\\uFEFF]');
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?:^|[^\uD800-\uDBFF])[\uDC00-\uDFFF]/;
const HZ_MAX = LIMITS.frequencyHz[1];
const FINDING_KEYS = ['kind', 'schemaVersion', 'id', 'statement', 'status', 'evidence', 'runs',
  'createdAt', 'updatedAt'];
const shortId = (id) => (id.length > 14 ? `${id.slice(0, 12)}…` : id);
/** "1 kHz", "4.974 kHz", "250 Hz": a frequency as the references read it. */
export const hzText = (f) => (f >= 1000 ? `${+(f / 1000).toPrecision(4)} kHz`
  : `${+f.toPrecision(4)} Hz`);

/** The canonical key of a reference (duplicates are refused). */
export function refKey(ref) {
  if (ref.kind === 'compare') return `compare:${ref.a}|${ref.b}`;
  if (ref.kind === 'value') return `value:${ref.experimentId}@${ref.at.hz}`;
  return `run:${ref.experimentId}`;
}

/** The run ids a reference names, in order. */
export function refRunIds(ref) {
  return ref.kind === 'compare' ? [ref.a, ref.b] : [ref.experimentId];
}

/** Every run id a finding cites, once each, in order of first citation. */
export function citedRunIds(finding) {
  return [...new Set((finding.evidence || []).flatMap(refRunIds))];
}

/** Plain text checks shared by the statement and the notes. */
function plainText(c, v, path, max, { multiline = false, nullable = false } = {}) {
  if (v === null && nullable) return true;
  if (!c.str(v, path, max, { multiline, nullable, min: 1 })) return false;
  if (!v.trim()) return c.add(path, 'must not be empty');
  if (MARKUP.test(v)) {
    return c.add(path, 'looks like HTML markup; a finding is plain text (write "< " with a space '
      + 'for a comparison)');
  }
  if (INVISIBLE.test(v)) {
    return c.add(path, 'contains invisible, bidirectional or line-separator characters');
  }
  if (LONE_SURROGATE.test(v)) return c.add(path, 'contains an unpaired surrogate (malformed text)');
  return true;
}

function checkRef(c, v, path) {
  if (!c.obj(v, path)) return null;
  if (!EVIDENCE_KINDS.includes(v.kind)) {
    c.add(`${path}.kind`, `must be one of ${EVIDENCE_KINDS.join(', ')}`);
    return null;
  }
  const n = c.errors.length;
  const id = (x, p) => c.str(x, p, LIMITS.idChars, { pattern: ID_PATTERN });
  if (v.kind === 'run') {
    if (c.keys(v, path, ['kind', 'experimentId'])) id(v.experimentId, `${path}.experimentId`);
    return c.errors.length > n ? null : { kind: 'run', experimentId: v.experimentId };
  }
  if (v.kind === 'compare') {
    if (c.keys(v, path, ['kind', 'a', 'b']) && id(v.a, `${path}.a`) && id(v.b, `${path}.b`)
      && v.a === v.b) c.add(path, 'a comparison names two different runs');
    return c.errors.length > n ? null : { kind: 'compare', a: v.a, b: v.b };
  }
  if (c.keys(v, path, ['kind', 'experimentId', 'at'])) {
    id(v.experimentId, `${path}.experimentId`);
    if (c.keys(v.at, `${path}.at`, ['hz']) && c.num(v.at.hz, `${path}.at.hz`, 0, HZ_MAX)
      && v.at.hz <= 0) c.add(`${path}.at.hz`, 'must be above 0 Hz');
  }
  return c.errors.length > n ? null : { kind: 'value', experimentId: v.experimentId,
    at: { hz: v.at.hz } };
}

/** Check a finding into `c`; returns its clean copy or null. */
function checkFinding(c, v, path) {
  const n = c.errors.length;
  const p = (k) => (path ? `${path}.${k}` : k);
  if (!c.keys(v, path, FINDING_KEYS, ['notes'])) return null;
  if (v.kind !== FINDING_KIND) c.add(p('kind'), `must be ${FINDING_KIND}`);
  if (c.num(v.schemaVersion, p('schemaVersion'), 1, Number.MAX_SAFE_INTEGER, { integer: true })
    && v.schemaVersion > FINDING_SCHEMA_VERSION) {
    c.add(p('schemaVersion'), `finding schema v${v.schemaVersion} is newer than this OSCILLA `
      + `reads (v${FINDING_SCHEMA_VERSION}); open it in a newer version`, 'newer');
  }
  c.str(v.id, p('id'), LIMITS.idChars, { pattern: ID_PATTERN });
  plainText(c, v.statement, p('statement'), FINDING_LIMITS.statementChars);
  c.oneOf(v.status, p('status'), FINDING_STATUSES);
  if (has(v, 'notes')) {
    plainText(c, v.notes, p('notes'), FINDING_LIMITS.notesChars, { multiline: true,
      nullable: true });
  }
  if (c.iso(v.createdAt, p('createdAt')) && c.iso(v.updatedAt, p('updatedAt'))
    && Date.parse(v.updatedAt) < Date.parse(v.createdAt)) {
    c.add(p('updatedAt'), 'is before createdAt');
  }
  const evidence = [];
  if (!Array.isArray(v.evidence)) c.add(p('evidence'), 'must be an array');
  else if (v.evidence.length > FINDING_LIMITS.evidence) {
    c.add(p('evidence'), `more than ${FINDING_LIMITS.evidence} references`);
  } else {
    const seen = new Set();
    v.evidence.forEach((r, i) => {
      const ref = checkRef(c, r, `${p('evidence')}[${i}]`);
      if (!ref) return;
      const k = refKey(ref);
      if (seen.has(k)) c.add(`${p('evidence')}[${i}]`, 'this reference is already cited');
      seen.add(k);
      evidence.push(ref);
    });
    if (EVIDENCE_REQUIRED_STATUSES.includes(v.status) && !v.evidence.length) {
      c.add(p('evidence'), `a ${v.status} finding must cite at least one reference (a run, a `
        + 'comparison or a value)');
    }
  }
  const runs = [];
  if (!Array.isArray(v.runs)) c.add(p('runs'), 'must be an array');
  else if (v.runs.length > 2 * FINDING_LIMITS.evidence) c.add(p('runs'), 'too many entries');
  else {
    const cited = new Set(evidence.flatMap(refRunIds));
    const seen = new Set();
    v.runs.forEach((r, i) => {
      const rp = `${p('runs')}[${i}]`;
      if (!c.keys(r, rp, ['experimentId', 'resultHash'])) return;
      const okId = c.str(r.experimentId, `${rp}.experimentId`, LIMITS.idChars,
        { pattern: ID_PATTERN });
      c.str(r.resultHash, `${rp}.resultHash`, 64, { pattern: HEX64_PATTERN, nullable: true });
      if (!okId) return;
      if (seen.has(r.experimentId)) c.add(rp, `${r.experimentId} is listed more than once`);
      else if (!cited.has(r.experimentId)) c.add(rp, `${r.experimentId} is not cited`);
      seen.add(r.experimentId);
      runs.push({ experimentId: r.experimentId, resultHash: r.resultHash });
    });
    const absent = [...cited].filter((id) => !seen.has(id));
    if (absent.length) {
      c.add(p('runs'), `the identity of each cited run is required (${absent.slice(0, 4)
        .join(', ')})`);
    }
  }
  if (c.errors.length > n) return null;
  return { kind: FINDING_KIND, schemaVersion: v.schemaVersion, id: v.id, statement: v.statement,
    status: v.status, evidence, runs, notes: has(v, 'notes') ? v.notes : null,
    createdAt: v.createdAt, updatedAt: v.updatedAt };
}

/** Validate untrusted finding data: { ok, finding, errors }. Never throws. */
export function validateFinding(value) {
  const c = createChecker(50);
  const finding = checkFinding(c, value, '');
  return c.errors.length ? { ok: false, finding: null, errors: c.errors }
    : { ok: true, finding, errors: [] };
}

const valid = (v) => {
  const r = validateFinding(v);
  if (!r.ok) throw new RangeError(`Invalid finding: ${formatErrors(r.errors.slice(0, 4))}`);
  return r.finding;
};
const trimmed = (s) => (typeof s === 'string' ? s.trim() : s);
const noteOf = (s) => (typeof s === 'string' ? s.trim() || null : s ?? null);

/** A new finding; throws RangeError with the reasons. */
export function createFinding({ id, now, statement, status = 'observation', evidence = [],
  runs = [], notes = null } = {}) {
  const at = toIsoTimestamp(now);
  return valid({ kind: FINDING_KIND, schemaVersion: FINDING_SCHEMA_VERSION, id,
    statement: trimmed(statement), status, evidence, runs, notes: noteOf(notes),
    createdAt: at, updatedAt: at });
}

/** The finding with `patch` applied (statement, status, evidence, runs, notes) at `now`. */
export function updateFinding(finding, patch = {}, { now } = {}) {
  for (const k of Object.keys(patch)) {
    if (!['statement', 'status', 'evidence', 'runs', 'notes'].includes(k)) {
      throw new RangeError(`Invalid finding: ${k} cannot be changed`);
    }
  }
  const next = { ...finding, ...patch, updatedAt: toIsoTimestamp(now) };
  if (has(patch, 'statement')) next.statement = trimmed(patch.statement);
  if (has(patch, 'notes')) next.notes = noteOf(patch.notes);
  return valid(next);
}

// ---------------------------------------------------------------- integrity

/**
 * What is wrong with a finding's references in this browser: [{ code, index, experimentId,
 * text }], in reference order, then the status issue. Nothing is repaired or removed: a reference
 * to a deleted run stays and reads missing.
 */
export function findingIssues(finding, lookup) {
  const out = [];
  const hashOf = new Map((finding.runs || []).map((r) => [r.experimentId, r.resultHash]));
  const broken = new Set();
  (finding.evidence || []).forEach((ref, index) => {
    for (const id of refRunIds(ref)) {
      const got = lookup(id);
      const name = got && got.name ? `"${got.name}"` : shortId(id);
      const issue = (code, text) => {
        out.push({ code, index, experimentId: id, text });
        broken.add(index);
      };
      const cited = hashOf.get(id) || null;
      if (!got) issue('missing-run', `missing: run ${shortId(id)} is not stored here (deleted, or `
        + 'never stored in this browser)');
      else if (got.kind !== 'run') {
        issue('wrong-kind', `${shortId(id)} names a ${got.kind}, not a run`);
      } else if (got.readable === false) {
        issue('unreadable-run', `run ${name} is stored here but cannot be read${got.reason
          ? ` (${got.reason})` : ''}; it cannot be checked`);
      } else if (!cited) {
        issue('unverifiable-identity', `run ${name}: its identity cannot be verified: it was cited `
          + 'without a result hash');
      } else if (typeof got.resultHash !== 'string' || !got.resultHash) {
        issue('unverifiable-identity', `run ${name}: its identity cannot be verified: ${
          got.resultHash === null ? 'the record stored under this id has no result hash'
            : 'its stored result hash has not been read'}`);
      } else if (got.resultHash !== cited) {
        issue('different-run', `run ${name}: a different record is stored under this id (its `
          + 'result hash differs from the one cited)');
      } else if (ref.kind === 'value' && got.hasResponse === false) {
        issue('no-response', `run ${name} stores no frequency response to take a value from`);
      } else if (ref.kind === 'value' && Array.isArray(got.frequencies)
        && !got.frequencies.includes(ref.at.hz)) {
        issue('not-a-grid-point', `${exactHzText(ref.at.hz)} is not a frequency the run stores `
          + `(run ${name}): the value is not a stored point`);
      }
    }
  });
  const n = (finding.evidence || []).length;
  if (EVIDENCE_REQUIRED_STATUSES.includes(finding.status) && n && broken.size === n) {
    out.push({ code: 'unsupported-status', index: null, experimentId: null,
      text: `The status is ${finding.status}, but none of the evidence it cites can be checked `
        + 'here.' });
  }
  return out;
}

/**
 * A frequency with enough digits that distinct stored grid points never read the same: the
 * shortest decimal that is the same single-precision value for a single-precision frequency,
 * else every digit of the number.
 */
export function exactHzText(hz) {
  if (Math.fround(hz) === hz) {
    for (let p = 1; p <= 9; p++) {
      const t = Number(hz.toPrecision(p));
      if (Math.fround(t) === hz) return `${t} Hz`;
    }
  }
  return `${hz} Hz`;
}

/**
 * How a reference reads: what it names, and for a comparison that it says what, not why. A value
 * reference says "(a stored grid point)" only when the caller checked it (`storedPoint: true`).
 */
export function refText(ref, nameOf = () => null, { storedPoint = false } = {}) {
  const nm = (id) => {
    const n = nameOf(id);
    return n ? `"${n}"` : shortId(id);
  };
  if (ref.kind === 'compare') {
    return `Comparison of ${nm(ref.a)} with ${nm(ref.b)} (what changed between the runs, not why)`;
  }
  if (ref.kind === 'value') {
    return `Value of ${nm(ref.experimentId)} at ${exactHzText(ref.at.hz)}${storedPoint
      ? ' (a stored grid point)' : ''}`;
  }
  return `Run ${nm(ref.experimentId)}`;
}

/** Does `finding` cite run `id`? */
export const findingCites = (finding, id) => citedRunIds(finding).includes(id);

/** Backlinks: each finding citing run `id`, with how it cites it. */
export function findingsCiting(findings, id) {
  const out = [];
  for (const finding of findings) {
    const how = [];
    for (const ref of finding.evidence) {
      if (ref.kind === 'run' && ref.experimentId === id) how.push('this run');
      else if (ref.kind === 'value' && ref.experimentId === id) {
        how.push(`its value at ${exactHzText(ref.at.hz)}`);
      } else if (ref.kind === 'compare' && (ref.a === id || ref.b === id)) {
        how.push(`a comparison with ${ref.a === id ? ref.b : ref.a}`);
      }
    }
    if (how.length) out.push({ finding, how });
  }
  return out;
}

// ---------------------------------------------------------------- export / import

/** The export document of `findings` (each with the identity of the runs it cites). */
export function exportFindings(findings, { now, oscillaVersion = null } = {}) {
  return { kind: FINDINGS_FILE_KIND, schemaVersion: FINDINGS_FILE_SCHEMA_VERSION,
    exportedAt: toIsoTimestamp(now), oscillaVersion,
    findings: findings.map((f) => valid(f)) };
}

export const findingsToJson = (doc) => JSON.stringify(doc, null, 2);

/**
 * Parse and validate a findings file, all or nothing: { ok, findings, errors, newer }. A file
 * from a newer schema is refused with that reason (newer: true), never read in part.
 */
export function parseFindingsFile(text, { maxBytes = FINDING_LIMITS.fileBytes } = {}) {
  const fail = (errors, newer = false) => ({ ok: false, findings: [], errors, newer });
  if (typeof text !== 'string') return fail([{ path: 'file', text: 'is not text' }]);
  if (text.length > maxBytes) {
    return fail([{ path: 'file', text: `is larger than ${maxBytes} bytes` }]);
  }
  let doc;
  try {
    doc = JSON.parse(text);
  } catch (err) {
    return fail([{ path: 'file', text: `is not valid JSON (${err.message})` }]);
  }
  const c = createChecker(50);
  if (!c.keys(doc, '', ['kind', 'schemaVersion', 'exportedAt', 'oscillaVersion', 'findings'])) {
    return fail(c.errors);
  }
  if (doc.kind !== FINDINGS_FILE_KIND) {
    return fail([{ path: 'kind', text: `must be ${FINDINGS_FILE_KIND}` }]);
  }
  if (!c.num(doc.schemaVersion, 'schemaVersion', 1, Number.MAX_SAFE_INTEGER, { integer: true })) {
    return fail(c.errors);
  }
  if (doc.schemaVersion > FINDINGS_FILE_SCHEMA_VERSION) {
    return fail([{ path: 'schemaVersion', text: `this findings file is schema v${
      doc.schemaVersion}, newer than this OSCILLA reads (v${FINDINGS_FILE_SCHEMA_VERSION}); `
      + 'nothing was imported', code: 'newer' }], true);
  }
  c.iso(doc.exportedAt, 'exportedAt');
  c.str(doc.oscillaVersion, 'oscillaVersion', 64, { pattern: VERSION_PATTERN, nullable: true });
  const findings = [];
  if (!Array.isArray(doc.findings)) c.add('findings', 'must be an array');
  else if (doc.findings.length > FINDING_LIMITS.findings) {
    c.add('findings', `more than ${FINDING_LIMITS.findings} findings`);
  } else {
    const ids = new Set();
    doc.findings.forEach((f, i) => {
      const x = checkFinding(c, f, `findings[${i}]`);
      if (!x) return;
      if (ids.has(x.id)) c.add(`findings[${i}].id`, `${x.id} appears more than once`);
      ids.add(x.id);
      findings.push(x);
    });
  }
  if (c.errors.length) return fail(c.errors, c.errors.some((e) => e.code === 'newer'));
  return { ok: true, findings, errors: [], newer: false };
}

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** What an import would do over the stored findings: add, skip identical, refuse different. */
export function importPlan(incoming, stored) {
  const byId = new Map(stored.map((f) => [f.id, f]));
  const plan = { add: [], same: [], conflicts: [] };
  for (const f of incoming) {
    const old = byId.get(f.id);
    if (!old) plan.add.push(f);
    else if (same(old, f)) plan.same.push(f.id);
    else plan.conflicts.push(f.id);
  }
  return plan;
}
