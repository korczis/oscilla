// EXPERIMENTS workspace: the DOM/Alpine adapter over src/js/experiments and the pure views
// experiment-summary.js and compare-view.js (spec §50-§63, §76, §100-§105, §161-§163, §225;
// docs/v3/ui-integration.md). Composed into the ONE OSCILLA component by main.js.
//
// Local-first only (§76): experiments live in IndexedDB through experiments/store.js. Where
// IndexedDB is unavailable (some browsers on file://, private modes) openExperimentStoreOrMemory
// falls back to memory and the workspace says that nothing outlives the page view (§55).
// Delete is the only destructive action and always asks first (§225); an import never
// overwrites a stored experiment with the same ID (§104: never overwrite silently). A stored
// run is immutable (ADR 0040): rename goes through store.annotate (metadata only), duplicate
// stores schema.js duplicateExperiment (the same run under a new id, provenance.duplicateOf),
// and a refused change ('immutable') is reported with its reason.
// Decoded experiments (typed arrays) stay in the closure; Alpine holds summaries and text.
//
// Export (§88): exportableExperiment() hashes a raw input deviceId that an older record still
// carries (schema.js sanitizeForExport) and re-stamps a version-2 or -3 result hash (in its own
// version), which covers the input; a version-1 hash covers the results only and stays valid.
// CSV (m4): the transfer CSV carries the quality mask as its `reliable` column (when the mask
// lies on the transfer grid), the frequency-corrected magnitude when the experiment's profile is
// loaded (same id), and the phase when the transfer has one. Imports refuse a file larger than
// the limit before reading it (m6).
//
// Compare (V356): the response overlay, A − B and the IR overlay (compare-view.js; only for an
// equivalent set, ms re each direct peak, original scale; no A − B of impulse responses).
// Semantic changes and baseline (ADR 0041): the compare panel lists what changed between the
// runs by domain (execution first, presentation and metadata collapsed). A run is marked as
// the baseline through store.annotate (metadata, at most one); Compare then puts it first (A),
// and one selected run is compared with it. An imported file marked as the baseline keeps the
// mark only when no other run is the baseline.
//
// Definitions (ADR 0043): the Definitions panel lists the authored definitions (store.js
// listDefinitions) with their version count and last run (the newest list row naming the
// definition). "New definition" takes the current MEASURE setup's recipe (definition.js
// setupRecipe) with the declared conditions and acceptance; "Edit" renames (metadata) and
// appends a version only when an execution field changed (reviseDefinition); "Run this
// definition" loads its latest version into MEASURE and starts the measurement, which records
// that version only when it ran exactly its recipe (measure.js). Repeat loads a saved run's own
// definition version (an authored one stays loaded, with its banner in MEASURE; a derived one is
// only its recipe). A run's definition version is shown in its detail and list row under the
// stored definition's name only when that definition has that version with that hash
// (definition.js storedMatch); otherwise the text says it is not stored here, does not match or
// could not be read. A stored definition that cannot be read never fails the list of runs, and
// a stored change is never reported as failed because the list could not be read again after it.
//
// Contradicted calibration claims (ADR 0040, resolution 2026-10-05): earlier versions could
// save a record naming a calibration its results never applied (loaded or created after the
// run). validate.js reports it as a non-fatal finding (calibration-claim-contradicted), so such
// a stored record stays readable and such a file imports, with the reason. The record is never
// rewritten (its hash still verifies); the detail states the contradiction, and the detail,
// CSV, compare and MEASURE inspection present it without the contradicted claim
// (presented()), so it is never shown as dB SPL or compared as calibrated.
//
// Evidence (ADR 0044): the detail carries experiments/evidence.js runEvidence over the STORED
// record (not the presented copy): the lineage of one stored result point (the frequency the
// user enters; 1 kHz or the grid centre by default) and the reproducibility checklist. Compare
// adds one line naming the checklist items whose state differs between the compared runs.
//
// Independence (§227, V353): the store opens lazily, on the first Experiments view or save, and
// reading the IndexedDB factory never throws into the app (pageIndexedDb): a store that cannot
// open falls back to memory and says so, and the Playground, the instrument and Studio never
// wait for it. A failed save (quota, tests/browser/v3-ui.cjs `persistence`) reports the reason
// and keeps the result on screen, to be saved again once space is freed.

import { KNOWN_ALGORITHM_IDS } from '../measurement/algorithms.js';
import { openExperimentStoreOrMemory } from '../experiments/store.js';
import {
  validateExperiment, DEFAULT_MAX_BYTES, calibrationClaimFindings, withoutContradictedCalibration,
} from '../experiments/validate.js';
import {
  experimentToJson, formatErrors, newExperimentId, EXPERIMENT_FILE_EXTENSION,
  sanitizeForExport, duplicateExperiment, annotateExperiment, isBaseline, describeStimulus,
} from '../experiments/schema.js';
import { resultHash, withResultHash, resultHashVersionOf } from '../experiments/hash.js';
import {
  csvMeta, transferCsv, aggregateCsv, irCsv, reliableFromQuality,
} from '../experiments/csv.js';
import { applyFrequencyCorrection } from '../calibration/interpolate.js';
import {
  experimentSummary, experimentListRows, compareSelection,
} from '../measurement/views/experiment-summary.js';
import { buildCompareView } from '../measurement/views/compare-view.js';
import { buildResponseView } from '../measurement/views/response-chart.js';
import { createResponseChart, createIrChart } from '../charts/measure-charts.js';
import { downloadBlob, readFileText } from './exporters.js';
import { experimentTestContext } from './measure-experiment.js';
import {
  ACCEPTANCE_LEVELS, buildExecution, createDefinition, definitionRef, latestVersion,
  renameDefinition, reviseDefinition, setupRecipe, storedMatch,
} from '../experiments/definition.js';
import { timestampText, definitionText } from '../measurement/views/experiment-summary.js';
import {
  runEvidence, evidenceLineage, resultPoint, reproducibilityChecklist, evidenceDifferences,
  evidenceDifferencesText, identityDifferences,
} from '../experiments/evidence.js';

export const STORE_FALLBACK_TEXT = 'Experiments are kept in memory for this page view only: this '
  + 'browser does not allow IndexedDB here (for example on file://). Export each experiment as '
  + `${EXPERIMENT_FILE_EXTENSION} to keep it.`;

const plain = (v) => (v == null ? null : JSON.parse(JSON.stringify(v)));

/**
 * The page's IndexedDB factory, or null where reading it throws (a SecurityError in some
 * browsers on file:// and in private modes): the store then falls back to memory (§227), and
 * nothing outside the Experiments/Measure save path ever touches the store.
 */
export function pageIndexedDb(scope = globalThis) {
  try {
    const idb = scope.indexedDB;
    return idb && typeof idb.open === 'function' ? idb : null;
  } catch (e) {
    return null;
  }
}

function pageStorageManager(scope = globalThis) {
  try {
    return scope.navigator ? scope.navigator.storage || null : null;
  } catch (e) {
    return null;
  }
}

/** "20 Hz → 20 kHz log sweep, 10 s · 3 runs" of a recipe (or a setup recipe). */
function describeRecipe(r) {
  if (!r) return '';
  try {
    const x = setupRecipe(r);
    return `${describeStimulus(x.stimulus)} · ${x.repeats} run${x.repeats === 1 ? '' : 's'}`;
  } catch (e) {
    return e.message;
  }
}

function randomBytes16() {
  const b = new Uint8Array(16);
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    crypto.getRandomValues(b);
  } else for (let i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256);
  return b;
}

/** A file-name stem from an experiment name: letters, digits and dashes. */
export function fileStem(name, fallback = 'experiment') {
  const s = String(name || '').normalize('NFKD').replace(/[^\w\s-]+/g, '').trim()
    .replace(/[\s_]+/g, '-').replace(/-+/g, '-').slice(0, 60).toLowerCase();
  return s || fallback;
}

const isTestContext = (e) => !!experimentTestContext(e);

/** The statement shown for a record whose calibration claim its own results contradict. */
export const CALIBRATION_CLAIM_TEXT = 'This record names a calibration its own results say was '
  + 'not applied (earlier versions of OSCILLA could save it after a calibration changed). Its '
  + 'calibrated values are not trustworthy: it is shown and compared as uncalibrated.';

/** The experiment as the workspace presents it: without a contradicted calibration claim. */
export function presented(e) {
  return e ? withoutContradictedCalibration(e) : e;
}

/**
 * The experiment as it is exported (§88): no raw deviceId; a result hash of version 2 or 3
 * re-stamped in its version when sanitizing changed the input it covers (the record was
 * verified when it was stored).
 */
export function exportableExperiment(e) {
  const { experiment, changed } = sanitizeForExport(e);
  if (!changed) return e;
  const p = experiment.provenance;
  const version = resultHashVersionOf(experiment);
  if (p && typeof p.resultHash === 'string' && version >= 2) {
    return withResultHash(experiment, resultHash(experiment, { version }), version);
  }
  return experiment;
}

/**
 * transferCsv options of an experiment (m4): the quality mask as `reliable`, and the corrected
 * magnitude when `profile` is the experiment's frequency profile (same id).
 */
export function transferCsvOptions(e, profile = null) {
  const t = e.results && e.results.transfer;
  const opts = {};
  const reliable = reliableFromQuality(e.quality, t);
  if (reliable) opts.reliable = reliable;
  const ref = e.calibration && e.calibration.frequency;
  if (t && ref && profile && profile.id === ref.id) {
    opts.correctedDb = applyFrequencyCorrection(t.magnitudeDb, t.frequencies, profile)
      .correctedDb;
  }
  return opts;
}
/**
 * Definitions panel rows (ADR 0043): name, version count, latest version and the last run
 * (summaries newest first, as store.js list() returns them).
 */
export function definitionRows(defs, summaries = []) {
  return defs.map((d) => {
    const last = latestVersion(d);
    const run = summaries.find((s) => s.definition && storedMatch(s.definition, d) === 'match');
    const n = d.versions.length;
    return { id: d.id, name: d.name || '(unnamed)', versions: n,
      meta: `${n} version${n === 1 ? '' : 's'} · latest v${last.version} (${last.hash
        .slice(0, 12)}…) · ${run ? `last run ${timestampText(run.createdAt)} (v${
        run.definition.version})` : 'not run yet'}` };
  });
}

/** Experiments kept decoded beyond the ones shown in detail and compare. */
export const CACHE_RECENT = 4;

/**
 * Put `id → e` in `cache` as the most recent entry and evict the least recently used ones
 * beyond `keep`, never an id in `pinned` (the experiments on screen). A decoded experiment
 * holds its raw captures (about 2 MB for a 10 s sweep) off the JS heap and the store already
 * has every record, so caching all of them would pin each saved run for the page's lifetime.
 */
export function rememberBounded(cache, id, e, pinned = [], keep = CACHE_RECENT) {
  cache.delete(id);
  cache.set(id, e);
  const held = new Set(pinned);
  let spare = [...cache.keys()].filter((k) => !held.has(k)).length - keep;
  for (const k of [...cache.keys()]) {
    if (spare <= 0) break;
    if (k !== id && !held.has(k)) { cache.delete(k); spare -= 1; }
  }
  return cache;
}

export function createExperimentsUi() {
  const ctx = {
    cmp: null,
    store: null,
    opening: null,
    cache: new Map(),   // id → decoded experiment: detail, compare and the last few opened
    detail: null,       // the experiment shown in the detail panel
    defs: new Map(),    // stored definition id → definition (names are metadata; runs lack them)
    unreadable: new Set(), // ids of stored definitions that could not be read
    compare: [],        // experiments in the compare view
    charts: { detail: null, overlay: null, delta: null, ir: null },
  };

  async function store(cmp) {
    if (ctx.store) return ctx.store;
    if (!ctx.opening) {
      ctx.opening = openExperimentStoreOrMemory({
        indexedDB: pageIndexedDb(),
        storage: pageStorageManager(),
        knownAlgorithms: KNOWN_ALGORITHM_IDS,
      }).then((r) => {
        ctx.store = r.store;
        cmp.exps.persistent = r.persistent;
        cmp.exps.storeKind = r.store.kind;
        cmp.exps.storeNote = r.persistent ? null : STORE_FALLBACK_TEXT;
        cmp.exps.storeError = r.error ? r.error.message : null;
        return r.store;
      });
    }
    return ctx.opening;
  }

  /** { name, match } of a run reference against the stored definitions (storedMatch). */
  function matchOf(ref) {
    const d = ctx.defs.get(ref.id) || null;
    const match = !ref.derived && !d && ctx.unreadable.has(ref.id) ? 'unreadable'
      : storedMatch(ref, d);
    return { match, name: match === 'match' || match === 'mismatch' ? d.name || null : null };
  }

  /**
   * After a stored change: read the list again; a failure there is reported as what it is and
   * never as a failure of the change (it is stored).
   */
  async function refreshAfter(cmp) {
    try {
      await cmp.experimentsRefresh();
      return true;
    } catch (err) {
      cmp.notify('warning', 'List not refreshed', 'The change is stored, but the list could not '
        + `be read again: ${err.message || String(err)}`);
      return false;
    }
  }

  function remember(id, e) {
    rememberBounded(ctx.cache, id, e, [ctx.detail, ...ctx.compare].filter(Boolean)
      .map((x) => x.experimentId));
  }

  async function get(cmp, id) {
    if (ctx.cache.has(id)) {
      const hit = ctx.cache.get(id);
      remember(id, hit);
      return hit;
    }
    const s = await store(cmp);
    const e = await s.get(id);
    if (e) remember(id, e);
    return e;
  }

  function setDetail(cmp, e) {
    ctx.detail = e;
    if (!e) {
      cmp.exps.detail = null;
      if (ctx.charts.detail) ctx.charts.detail.setView(null);
      return;
    }
    const findings = calibrationClaimFindings(e);
    const shown = withoutContradictedCalibration(e, findings);
    const m = e.definition ? matchOf(e.definition) : {};
    const s = experimentSummary(shown, m);
    // The same run shown again (a rename, the baseline mark) keeps the frequency entered.
    const was = cmp.exps.detail && cmp.exps.detail.id === e.experimentId
      && cmp.exps.detail.evidence ? cmp.exps.detail.evidence.hz : null;
    const view = buildResponseView(shown, { profile: typeof cmp.measureCurrentProfile
      === 'function' ? cmp.measureCurrentProfile() : null });
    cmp.exps.detail = {
      ...plain(s),
      calibrationClaim: findings.length ? { text: CALIBRATION_CLAIM_TEXT,
        findings: findings.map((f) => `${f.path}: ${f.text}`) } : null,
      testContext: isTestContext(e),
      baseline: isBaseline(e),
      notes: e.environment && e.environment.notes ? e.environment.notes : null,
      response: view ? { summary: view.summary, badges: view.badges.slice(),
        notes: view.notes.slice() } : null,
      hasAggregate: !!(e.results && e.results.aggregate),
      hasTransfer: !!(e.results && e.results.transfer),
      hasIr: !!(e.results && e.results.ir),
      // Over the stored record, never the presented copy (ADR 0044).
      evidence: { ...plain(runEvidence(e, { ...m, hz: was })), hzError: null },
    };
    if (ctx.charts.detail) ctx.charts.detail.setView(view);
  }

  function setCompare(cmp, list) {
    ctx.compare = list;
    if (list.length < 2) {
      cmp.exps.compare = null;
      if (ctx.charts.overlay) ctx.charts.overlay.setView(null);
      if (ctx.charts.delta) ctx.charts.delta.setView(null);
      if (ctx.charts.ir) ctx.charts.ir.setView(null);
      return;
    }
    const v = buildCompareView(list.map(presented),
      { definitions: (id) => ctx.defs.get(id) || null });
    const checklists = list.map((e) => reproducibilityChecklist(e, e.definition
      ? matchOf(e.definition) : {}));
    const contradicted = list.filter((e) => calibrationClaimFindings(e).length)
      .map((e) => `"${e.name || '(unnamed)'}" names a calibration its own results say was not `
        + 'applied: it is compared as uncalibrated.');
    cmp.exps.compare = {
      entries: plain(v.entries),
      common: plain(v.common),
      differences: plain(v.differences),
      compatible: v.compatible,
      warnings: [...contradicted, ...v.warnings],
      summary: v.summary,
      semantic: plain(v.semantic),
      evidenceDiff: evidenceDifferencesText(evidenceDifferences(checklists),
        v.entries.map((x) => x.label), identityDifferences(list)),
      overlayNotes: v.overlay ? v.overlay.notes.slice() : [],
      overlaySummary: v.overlay ? `Overlay of ${v.entries.length} raw responses (relative `
        + 'magnitudes, unchanged).' : 'No experiment has a frequency response to overlay.',
      delta: v.delta.ok ? { ok: true, label: v.delta.label, summary: v.delta.summary,
        rangeText: v.delta.rangeText } : { ok: false, reason: v.delta.reason },
      ir: v.irOverlay.ok ? { ok: true, summary: v.irOverlay.summary,
        notes: v.irOverlay.notes.slice(), labels: v.irOverlay.labels.slice(),
        yLabel: v.irOverlay.view.axes.y.label, irDelta: v.irDelta.reason }
        : { ok: false, reason: v.irOverlay.reason, irDelta: v.irDelta.reason },
    };
    if (ctx.charts.overlay) ctx.charts.overlay.setView(v.overlay);
    if (ctx.charts.delta) ctx.charts.delta.setView(v.delta.ok ? v.delta : null);
    if (ctx.charts.ir) ctx.charts.ir.setView(v.irOverlay.ok ? v.irOverlay.view : null);
  }

  return {
    EXPERIMENT_FILE_EXTENSION,
    exps: {
      loaded: false,
      busy: false,
      persistent: true,
      storeKind: null,
      storeNote: null,
      storeError: null,
      rows: [],
      empty: null,
      selected: [],
      baselineId: null,
      canCompare: false,
      detail: null,
      compare: null,
      panel: 'detail',      // 'detail' | 'compare'
      renameName: '',
      renameId: null,
      deleteId: null,
      deleteName: '',
      importErrors: [],
      readout: null,
      defs: [],
      defsNote: null,
      defForm: { mode: 'new', id: null, name: '', notes: '', conditions: '', minimumQuality: '',
        useSetup: false, recipeText: '', setupText: '', error: '' },
    },
    ACCEPTANCE_LEVELS,

    experimentsInit() {
      ctx.cmp = this;
    },
    experimentsMountCharts(root) {
      const host = (id) => root.querySelector(`#${id}`);
      try {
        ctx.charts.detail = createResponseChart(host('osc-exp-chart-detail'),
          { onReadout: (l) => { this.exps.readout = l ? { key: 'detail', lines: l } : null; } });
        ctx.charts.overlay = createResponseChart(host('osc-exp-chart-overlay'));
        ctx.charts.delta = createResponseChart(host('osc-exp-chart-delta'),
          { onReadout: (l) => { this.exps.readout = l ? { key: 'delta', lines: l } : null; } });
        ctx.charts.ir = createIrChart(host('osc-exp-chart-ir'));
      } catch (e) {
        console.error('OSCILLA experiment charts failed:', e);
      }
    },
    experimentsRefreshCharts() {
      for (const c of Object.values(ctx.charts)) if (c) c.refreshTheme();
    },
    experimentsRelayout() {
      for (const c of Object.values(ctx.charts)) if (c) c.relayout();
    },

    /** Store a validated experiment (store.put validates again); returns its id. */
    async experimentsPut(e) {
      const s = await store(this);
      const id = await s.put(e);
      remember(id, e);
      await refreshAfter(this);
      return id;
    },
    async experimentsRefresh() {
      const s = await store(this);
      const list = await s.list();
      const ids = new Set(list.map((x) => x.experimentId));
      this.exps.selected = this.exps.selected.filter((id) => ids.has(id));
      const v = experimentListRows(list, { selected: this.exps.selected });
      // The definitions are read apart: one that cannot be read never fails the runs' list.
      try {
        const { definitions, unreadable } = await s.listDefinitions();
        ctx.defs = new Map(definitions.map((d) => [d.id, d]));
        ctx.unreadable = new Set(unreadable.map((u) => u.id));
        const n = unreadable.length;
        this.exps.defsNote = n ? `${n} stored definition${n === 1 ? '' : 's'} could not be read `
          + `and ${n === 1 ? 'is' : 'are'} not listed (${unreadable.map((u) => u.id || 'no id')
            .slice(0, 3).join(', ')}).` : null;
        this.exps.defs = definitionRows(definitions, list);
      } catch (err) {
        this.exps.defsNote = `The definitions could not be read: ${err.message || String(err)}`;
      }
      this.exps.rows = v.rows.map((r) => ({ ...r, actions: undefined,
        defText: r.definition && !r.definition.derived ? ` · ${definitionText(r.definition,
          { ...matchOf(r.definition), short: true })}` : '' }));
      this.exps.empty = v.empty;
      this.exps.baselineId = v.baselineId;
      this.exps.canCompare = v.canCompare;
      this.exps.loaded = true;
      return list;
    },
    async experimentsOpen(id) {
      const e = await get(this, id);
      if (!e) {
        this.notify('error', 'Experiment not found', id);
        return null;
      }
      setDetail(this, e);
      this.exps.panel = 'detail';
      this.$nextTick(() => { if (ctx.charts.detail) ctx.charts.detail.relayout(); });
      return e;
    },
    /**
     * The evidence lineage at another frequency (Hz) of the open run. An entry that is not a
     * frequency above 0 Hz is refused with a message (hzError) and the last point kept; returns
     * the point, or null when refused (the field then shows the kept frequency again).
     */
    experimentsEvidenceAt(value) {
      const ev = this.exps.detail && this.exps.detail.evidence;
      const e = ctx.detail;
      if (!e || !ev) return null;
      const hz = typeof value === 'string' && value.trim() === '' ? NaN : Number(value);
      if (!Number.isFinite(hz) || hz <= 0) {
        this.exps.detail.evidence = { ...ev, hzError: 'Enter a frequency above 0 Hz; the value '
          + `shown is still at ${ev.hz} Hz.` };
        return null;
      }
      const m = e.definition ? matchOf(e.definition) : {};
      const point = resultPoint(e, hz);
      this.exps.detail.evidence = { ...ev, hz, hzError: null, point: plain(point),
        lineage: plain(evidenceLineage(e, { ...m, hz })) };
      return point;
    },
    experimentsToggleSelect(id) {
      const sel = new Set(this.exps.selected);
      if (sel.has(id)) sel.delete(id); else sel.add(id);
      this.exps.selected = [...sel];
      this.exps.rows = this.exps.rows.map((r) => ({ ...r, selected: sel.has(r.id) }));
      this.exps.canCompare = !!compareSelection([...sel], this.exps.baselineId);
    },
    /** Compare (ADR 0041): the baseline first, or the baseline and one selected run. */
    async experimentsCompare(ids = this.exps.selected) {
      const order = compareSelection(ids, this.exps.baselineId);
      if (!order) return null;
      const list = [];
      for (const id of order) {
        const e = await get(this, id);
        if (e) list.push(e);
      }
      setCompare(this, list);
      this.exps.panel = 'compare';
      this.$nextTick(() => {
        if (ctx.charts.overlay) ctx.charts.overlay.relayout();
        if (ctx.charts.delta) ctx.charts.delta.relayout();
        if (ctx.charts.ir) ctx.charts.ir.relayout();
      });
      return this.exps.compare;
    },
    experimentsAskRename(row) {
      this.exps.renameId = row.id;
      this.exps.renameName = row.name === '(unnamed)' ? '' : row.name;
      this.openModal('osc-dlg-exp-rename');
    },
    /** Rename: metadata only (store.annotate); the run itself is never rewritten. */
    async experimentsRename() {
      const id = this.exps.renameId;
      try {
        const next = await (await store(this)).annotate(id,
          { name: String(this.exps.renameName || '') });
        remember(id, next);
        if (ctx.detail && ctx.detail.experimentId === id) setDetail(this, next);
        this.closeModal('osc-dlg-exp-rename');
      } catch (err) {
        this.notify('error', 'Rename failed', err.message || String(err));
        return false;
      }
      await refreshAfter(this);
      return true;
    },
    /** The stored experiment `id`, or null when it is not stored (MEASURE's update). */
    async experimentsGet(id) {
      return (await get(this, id)) || null;
    },
    /** Metadata of a stored run ({ name, notes }) through store.annotate; the run is kept. */
    async experimentsAnnotate(id, meta) {
      const next = await (await store(this)).annotate(id, meta);
      remember(id, next);
      if (ctx.detail && ctx.detail.experimentId === id) setDetail(this, next);
      await refreshAfter(this); // the annotate is committed whatever the list does
      return next;
    },
    /** Mark (or clear) the baseline: metadata only (store.annotate), at most one (ADR 0041). */
    async experimentsSetBaseline(id, on = true) {
      try {
        const next = await (await store(this)).annotate(id, { baseline: !!on });
        // Another run lost its mark in the same write: read it again when it is next shown.
        for (const [k, x] of ctx.cache) if (k !== id && isBaseline(x)) ctx.cache.delete(k);
        remember(id, next);
        if (ctx.detail && ctx.detail.experimentId === id) setDetail(this, next);
      } catch (err) {
        this.notify('error', 'Baseline not changed', err.message || String(err));
        return false;
      }
      await refreshAfter(this);
      return true;
    },
    /** The same run under a new ID (same facts and hashes, provenance.duplicateOf). */
    async experimentsDuplicate(id) {
      const e = await get(this, id);
      if (!e) return null;
      try {
        const copy = duplicateExperiment(e, { id: newExperimentId(randomBytes16()) });
        const nid = await this.experimentsPut(copy);
        this.notify('success', 'Experiment duplicated', `"${copy.name}"`);
        return nid;
      } catch (err) {
        this.notify('error', 'Duplicate failed', err.message || String(err));
        return null;
      }
    },
    experimentsAskDelete(row) {
      this.exps.deleteId = row.id;
      this.exps.deleteName = row.name;
      this.openModal('osc-dlg-exp-delete');
    },
    /** Explicit, confirmed delete (§225). */
    async experimentsDelete() {
      const id = this.exps.deleteId;
      if (!id) return false;
      try {
        await (await store(this)).delete(id);
        ctx.cache.delete(id);
        if (ctx.detail && ctx.detail.experimentId === id) setDetail(this, null);
        if (ctx.compare.some((e) => e.experimentId === id)) setCompare(this, []);
        this.exps.deleteId = null;
        this.closeModal('osc-dlg-exp-delete');
      } catch (err) {
        this.notify('error', 'Delete failed', err.message || String(err));
        return false;
      }
      this.notify('success', 'Experiment deleted', `"${this.exps.deleteName}" was removed from `
        + 'this browser.');
      await refreshAfter(this);
      return true;
    },
    async experimentsExport(id) {
      const e = await get(this, id);
      if (!e) return null;
      const text = experimentToJson(exportableExperiment(e), 2);
      downloadBlob(new Blob([`${text}\n`], { type: 'application/json' }),
        `${fileStem(e.name)}${EXPERIMENT_FILE_EXTENSION}`);
      return text;
    },
    /** CSV of the raw result (§163, §223): transfer, aggregate or IR, with metadata lines. */
    async experimentsExportCsv(id, what) {
      const e = presented(await get(this, id));
      if (!e || !e.results) return null;
      const meta = csvMeta(e);
      let text = null;
      try {
        if (what === 'transfer' && e.results.transfer) {
          const profile = typeof this.measureCurrentProfile === 'function'
            ? this.measureCurrentProfile() : null;
          text = transferCsv(e.results.transfer, meta, transferCsvOptions(e, profile));
        }
        else if (what === 'aggregate' && e.results.aggregate) {
          text = aggregateCsv(e.results.aggregate, meta);
        } else if (what === 'ir' && e.results.ir) text = irCsv(e.results.ir, meta);
      } catch (err) {
        this.notify('error', 'CSV export failed', err.message || String(err));
        return null;
      }
      if (!text) return null;
      downloadBlob(new Blob([text], { type: 'text/csv' }), `${fileStem(e.name)}-${what}.csv`);
      return text;
    },
    experimentsImportClick() {
      const input = document.getElementById('osc-exp-import-file');
      if (input) { input.value = ''; input.click(); }
    },
    async experimentsImportFile(ev) {
      const file = ev && ev.target && ev.target.files && ev.target.files[0];
      if (!file) return null;
      try {
        return await this.experimentsImportText(await readFileText(file,
          { maxBytes: DEFAULT_MAX_BYTES, what: `"${file.name}"` }));
      } catch (err) {
        this.notify('error', 'Import failed', err.message || String(err));
        return null;
      }
    },
    /** Validate untrusted JSON (validate.js: limits, migration, hashes); never overwrites. */
    async experimentsImportText(text) {
      const v = validateExperiment(text, { knownAlgorithms: KNOWN_ALGORITHM_IDS });
      if (!v.ok) {
        this.exps.importErrors = v.errors.slice(0, 5).map((x) => `${x.path || 'file'}: ${x.text}`);
        this.notify('error', 'Experiment not imported', formatErrors(v.errors.slice(0, 3)));
        return null;
      }
      const claim = v.findings && v.findings.length ? ` ${CALIBRATION_CLAIM_TEXT} (${v.findings
        .map((f) => `${f.path}: ${f.text}`).join('; ')})` : '';
      let e = v.experiment;
      const s = await store(this);
      let kept = '';
      if (isBaseline(e) && (await s.list()).some((x) => x.baseline)) {
        e = annotateExperiment(e, { baseline: false });
        kept = ' It was marked as the baseline; the current baseline is kept.';
      }
      if (await s.get(e.experimentId)) {
        this.exps.importErrors = [`an experiment with ID ${e.experimentId} is already stored; `
          + 'it was not overwritten'];
        this.notify('warning', 'Experiment not imported', this.exps.importErrors[0]);
        return null;
      }
      this.exps.importErrors = [];
      const id = await this.experimentsPut(e);
      this.notify(claim ? 'warning' : 'success', claim ? 'Experiment imported with a warning'
        : 'Experiment imported', `"${e.name || '(unnamed)'}"${v.migratedFrom
        ? ` (migrated from schema v${v.migratedFrom})` : ''}.${kept}${claim}`);
      return id;
    },
    /**
     * REPEAT (§104): load the run's definition version (ADR 0043) into MEASURE: an authored one
     * stays loaded (MEASURE shows it), a derived one is only the recipe the run played. The new
     * run is saved as a new experiment (repeat of the original); its save says whether it was
     * run from the definition.
     */
    async experimentsRepeat(id) {
      const e = await get(this, id);
      if (!e) return false;
      const m = matchOf(e.definition);
      this.measureLoadDefinition(e.definition, { repeatOf: e.experimentId, ...m });
      this.setWorkspace('measure');
      this.notify('info', e.definition.derived ? 'Recipe loaded for a repeat'
        : 'Definition loaded for a repeat', `"${e.name || '(unnamed)'}": run the measurement; it `
        + 'is saved as a new experiment (a repeat of the original).');
      return true;
    },
    /** The definition dialog: new from the MEASURE setup, or edit `id`. */
    async experimentsDefAsk(id = null) {
      const f = this.exps.defForm;
      const d = id ? await (await store(this)).getDefinition(id) : null;
      const x = d ? latestVersion(d).execution : null;
      Object.assign(f, { mode: d ? 'edit' : 'new', id, name: d ? d.name : '',
        notes: d && d.notes ? d.notes : '', conditions: x && x.conditions.notes || '',
        minimumQuality: x && x.acceptance.minimumQuality || '', useSetup: false, error: '',
        recipeText: describeRecipe(x ? x.recipe : null), setupText: describeRecipe(
          this.measureSetupRecipe()) });
      this.openModal('osc-dlg-def');
    },
    /**
     * Create, or edit: the name and notes change in place (metadata); a changed execution field
     * appends a version. Returns the stored definition, or null (the reason is in the dialog).
     */
    async experimentsDefSave() {
      const f = this.exps.defForm;
      let def;
      try {
        const s = await store(this);
        const now = Date.now();
        const old = f.mode === 'edit' ? await s.getDefinition(f.id) : null;
        const recipe = old && !f.useSetup ? latestVersion(old).execution.recipe
          : setupRecipe(this.measureSetupRecipe());
        const execution = buildExecution({ recipe, conditions: f.conditions,
          minimumQuality: f.minimumQuality || null });
        let changed = true;
        if (old) ({ definition: def, changed } = reviseDefinition(old, execution, { now }));
        else {
          def = createDefinition({ id: newExperimentId(randomBytes16()), now, execution });
        }
        def = await s.putDefinition(renameDefinition(def, { name: f.name, notes: f.notes }));
        this.closeModal('osc-dlg-def');
        const v = latestVersion(def).version;
        this.notify('success', old ? 'Definition saved' : 'Definition created', `"${def.name
          || '(unnamed)'}": ${!old ? 'version 1' : changed ? `version ${v} created (an execution `
          + 'field changed)' : `no execution field changed, still version ${v}`}.`);
      } catch (err) {
        f.error = err.message || String(err);
        return null;
      }
      await refreshAfter(this);
      return def;
    },
    /** Load the latest version of definition `id` into MEASURE and start the measurement. */
    async experimentsDefRun(id) {
      const d = await (await store(this)).getDefinition(id);
      if (!d) return false;
      if (this.measureOwnsOutput()) {
        this.notify('warning', 'Definition not run', 'A measurement is in progress.');
        return false;
      }
      this.measureLoadDefinition(definitionRef(d), { name: d.name || null, match: 'match' });
      this.setWorkspace('measure');
      await this.measureStart();
      return true;
    },
    /** Inspect an experiment's result in the MEASURE result panel. */
    async experimentsShowInMeasure(id) {
      const e = await get(this, id);
      if (!e) return false;
      this.measureShowExperiment(presented(e));
      this.setWorkspace('measure');
      return true;
    },
    experimentsTestSeam() {
      return {
        store: () => ctx.store,
        get: (id) => ctx.cache.get(id) || null,
        detail: () => ctx.detail,
        compare: () => ctx.compare.slice(),
        get irView() { return ctx.charts.ir ? ctx.charts.ir.view : null; },
      };
    },
  };
}
