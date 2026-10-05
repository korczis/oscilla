// EXPERIMENTS workspace: compact experiment summary and list rows (spec §50-§57, §76,
// §103-§104, §161, §225, §249). Pure.
//
//   experimentSummary(experiment, { name, match }) -> { id, title, compact, lines: [text],
//     quality, repeatOf, definition, provenance: [{ label, text }] }
//     lines are experiments/schema.js summarizeExperiment() (the §161 lines); compact is one
//     line "MacBook speakers — desk · 20 Hz → 20 kHz log sweep, 10 s · 5 runs · USABLE".
//     definition (ADR 0043) is { id, version, hash, derived } of the definition version the run
//     was executed from, or null; its provenance rows say which version, whether it was derived
//     from the run's own recipe (never presented as authored), the declared conditions and
//     whether the stored verdict meets its acceptance criterion. `match` is definition.js
//     storedMatch of the run against this browser's stored definition (or 'unreadable'), and
//     `name` that definition's name (metadata: the run does not carry it); the name is used only
//     for a 'match'.
//   experimentListRows(summaries, { selected = [] }) -> { rows: [Row], canCompare,
//     compareIds, baselineId, empty: text|null }
//   compareSelection(selected, baselineId) -> ids (≤ 4) | null   (ADR 0041) what Compare
//     compares: the baseline first when it is selected, or the baseline and the one selected
//     experiment; null when there is nothing to compare
//     summaries: experiments/store.js list() entries ({ experimentId, name, createdAt,
//     schemaVersion, oscillaVersion, status, sizeBytes }) or full experiments
//     Row = { id, name, createdAt, createdText, status, statusText, glyph, icon, shape,
//       className, sizeText, versionText, selected, baseline, definition: { id, version,
//       derived } | null, actions: [{ id, label, destructive }] }
// Nothing missing is invented (§249): it reads UNKNOWN / NOT ASSESSED.

import {
  summarizeExperiment, describeStimulus, qualityVerdictText,
} from '../../experiments/schema.js';
import { acceptanceOf } from '../../experiments/definition.js';
import { qualityStatusPresentation, UNAVAILABLE } from './common.js';

/** Row actions (§76); delete is the only destructive one and needs a confirmation (§225). */
export const EXPERIMENT_ACTIONS = Object.freeze([
  Object.freeze({ id: 'open', label: 'Open', destructive: false }),
  Object.freeze({ id: 'rename', label: 'Rename', destructive: false }),
  Object.freeze({ id: 'duplicate', label: 'Duplicate', destructive: false }),
  Object.freeze({ id: 'repeat', label: 'Repeat (new experiment)', destructive: false }),
  Object.freeze({ id: 'compare', label: 'Compare', destructive: false }),
  Object.freeze({ id: 'export', label: 'Export .oscilla.json', destructive: false }),
  Object.freeze({ id: 'delete', label: 'Delete…', destructive: true }),
]);

/** "2026-10-02 10:00 UTC" from an ISO timestamp; UNKNOWN otherwise. No clock is read. */
export function timestampText(iso) {
  if (typeof iso !== 'string') return UNAVAILABLE.UNKNOWN;
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/.exec(iso);
  return m ? `${m[1]} ${m[2]} UTC` : UNAVAILABLE.UNKNOWN;
}

/** "12.3 KiB", "1.2 MiB" */
export function sizeText(bytes) {
  if (!(bytes >= 0) || !Number.isFinite(bytes)) return UNAVAILABLE.UNKNOWN;
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / 1024 ** 2).toFixed(1)} MiB`;
}

/** experimentSummary(experiment) → the §161 summary (see the header). */
export function experimentSummary(e, { name = null, match = 'absent' } = {}) {
  const lines = summarizeExperiment(e);
  const status = e.quality && e.quality.status ? e.quality.status : null;
  const q = qualityStatusPresentation(status || 'NOT_ASSESSED');
  const runs = e.measurement && Array.isArray(e.measurement.runs) ? e.measurement.runs.length : 0;
  const stim = e.recipe && e.recipe.stimulus ? describeStimulus(e.recipe.stimulus)
    : UNAVAILABLE.UNKNOWN;
  const title = e.name ? e.name : '(unnamed)';
  const build = e.provenance && e.provenance.build;
  const provenance = [
    { label: 'Experiment ID', text: e.experimentId || UNAVAILABLE.UNKNOWN },
    { label: 'Created', text: timestampText(e.provenance && e.provenance.createdAt) },
    { label: 'Measured', text: timestampText(e.measurement && e.measurement.startedAt) },
    { label: 'Configuration hash', text: shortHash(e.provenance && e.provenance.configHash) },
    { label: 'Result hash', text: resultHashText(e.provenance) },
    { label: 'Quality verdict', text: qualityVerdictText(e) },
    { label: 'Repeat of', text: e.provenance && e.provenance.repeatOf ? e.provenance.repeatOf
      : 'none (original)' },
    ...(e.provenance && e.provenance.duplicateOf ? [{ label: 'Duplicate of',
      text: `${e.provenance.duplicateOf} (the same run, copied)` }] : []),
    { label: 'Build', text: build ? `${build.version || UNAVAILABLE.UNKNOWN} (${build.channel
      || UNAVAILABLE.UNKNOWN}${build.dirty ? ', dirty' : ''}${build.sourceDigest
      ? `, source ${build.sourceDigest.slice(0, 12)}…` : ''})` : UNAVAILABLE.UNKNOWN },
    ...definitionRows(e.definition, status, { name, match }),
    { label: 'Algorithms', text: algorithmsText(e.algorithms) },
    { label: 'Schema', text: `oscilla-experiment v${e.schemaVersion ?? UNAVAILABLE.UNKNOWN}` },
  ];
  return {
    id: e.experimentId || null,
    title,
    compact: `${title} · ${stim} · ${runs} run${runs === 1 ? '' : 's'} · ${q.text}`,
    lines,
    quality: { status: status || 'NOT_ASSESSED', text: q.text, glyph: q.glyph, icon: q.icon,
      shape: q.shape, className: q.className },
    repeatOf: e.provenance ? e.provenance.repeatOf ?? null : null,
    definition: e.definition ? { id: e.definition.id, version: e.definition.version,
      hash: e.definition.hash, derived: e.definition.derived } : null,
    environment: e.environment && e.environment.notes ? e.environment.notes
      : 'No location or distance notes recorded.',
    provenance,
  };
}

function shortHash(h) {
  return typeof h === 'string' && h.length >= 12 ? `${h.slice(0, 12)}…` : UNAVAILABLE.UNKNOWN;
}

/** "3f2a…, v2 (results, quality, calibration, input, output)" (hash.js versions, M11). */
function resultHashText(p) {
  const h = p && p.resultHash;
  if (typeof h !== 'string') return UNAVAILABLE.UNKNOWN;
  const v = p.resultHashVersion === undefined ? 1 : p.resultHashVersion;
  return `${shortHash(h)} v${v} (${v === 1 ? 'results only'
    : `results, quality, calibration, input, output${v >= 3 ? ', runs, build' : ''}${v >= 4
      ? ', recipe, definition' : ''}`})`;
}

const STORED = {
  absent: 'not stored in this browser',
  mismatch: 'does not match the stored definition with this id',
  unreadable: 'its stored definition could not be read',
};

/**
 * The definition a run reference names, in words: the stored name only for a 'match' (see the
 * header); otherwise its id and what is known about it. `short` (list rows) omits the hash.
 */
export function definitionText(d, { name = null, match = 'absent', short = false } = {}) {
  if (!d) return UNAVAILABLE.UNKNOWN;
  if (d.derived) return `derived from a run's own recipe, not authored (${shortHash(d.hash)})`;
  const hash = short ? '' : ` (${shortHash(d.hash)})`;
  if (match === 'match') return `${name ? `"${name}"` : d.id} version ${d.version}${hash}`;
  return `definition ${short ? '' : `${d.id} `}version ${d.version}${hash}, ${
    STORED[match] || STORED.absent}`;
}

function definitionRows(d, status, m) {
  if (!d) return [];
  return [{ label: 'Definition', text: definitionText(d, m) },
    { label: 'Declared conditions', text: d.execution.conditions.notes || 'none declared' },
    { label: 'Acceptance', text: acceptanceOf(d.execution, status).text }];
}

function algorithmsText(a) {
  if (!a || typeof a !== 'object') return UNAVAILABLE.UNKNOWN;
  const keys = Object.keys(a).filter((k) => a[k]).sort();
  return keys.length ? keys.map((k) => `${k}: ${a[k]}`).join(', ') : UNAVAILABLE.UNKNOWN;
}

function rowSource(x) {
  if (x && x.kind === 'oscilla-experiment') {
    return { experimentId: x.experimentId, name: x.name,
      createdAt: x.provenance ? x.provenance.createdAt : null, schemaVersion: x.schemaVersion,
      oscillaVersion: x.oscillaVersion, status: x.quality ? x.quality.status : null,
      sizeBytes: null, baseline: !!(x.annotations && x.annotations.baseline),
      definition: x.definition || null };
  }
  return x || {};
}

/** experimentListRows(summaries, { selected }) → list view model (see the header). */
export function experimentListRows(summaries, { selected = [] } = {}) {
  const sel = new Set(selected);
  const rows = (Array.isArray(summaries) ? summaries : []).map(rowSource).map((s) => {
    const q = qualityStatusPresentation(s.status || 'NOT_ASSESSED');
    return {
      id: s.experimentId,
      name: s.name ? s.name : '(unnamed)',
      createdAt: s.createdAt || null,
      createdText: timestampText(s.createdAt),
      status: s.status || 'NOT_ASSESSED',
      statusText: q.text,
      glyph: q.glyph,
      icon: q.icon,
      shape: q.shape,
      className: q.className,
      sizeText: s.sizeBytes == null ? UNAVAILABLE.UNKNOWN : sizeText(s.sizeBytes),
      versionText: `OSCILLA ${s.oscillaVersion || UNAVAILABLE.UNKNOWN}, schema v${
        s.schemaVersion ?? UNAVAILABLE.UNKNOWN}`,
      selected: sel.has(s.experimentId),
      baseline: !!s.baseline,
      definition: s.definition ? { id: s.definition.id, version: s.definition.version,
        derived: s.definition.derived } : null,
      actions: EXPERIMENT_ACTIONS.map((a) => ({ ...a })),
    };
  });
  const compareIds = rows.filter((r) => r.selected).map((r) => r.id);
  const base = rows.find((r) => r.baseline);
  const baselineId = base ? base.id : null;
  return {
    rows,
    canCompare: !!compareSelection(compareIds, baselineId),
    compareIds,
    baselineId,
    empty: rows.length ? null : 'No saved experiments in this browser. Measure and save one, '
      + 'or import an .oscilla.json file.',
  };
}

/** What Compare compares (ADR 0041; see the header). */
export function compareSelection(selected, baselineId = null) {
  const ids = [...new Set(selected)];
  if (baselineId && ids.includes(baselineId)) {
    ids.splice(ids.indexOf(baselineId), 1);
    ids.unshift(baselineId);
  } else if (baselineId && ids.length === 1) ids.unshift(baselineId);
  return ids.length >= 2 ? ids.slice(0, 4) : null;
}
