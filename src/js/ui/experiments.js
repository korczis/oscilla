// EXPERIMENTS workspace: the DOM/Alpine adapter over src/js/experiments and the pure views
// experiment-summary.js and compare-view.js (spec §50-§63, §76, §100-§105, §161-§163, §225;
// docs/v3/ui-integration.md). Composed into the ONE OSCILLA component by main.js.
//
// Local-first only (§76): experiments live in IndexedDB through experiments/store.js. Where
// IndexedDB is unavailable (some browsers on file://, private modes) openExperimentStoreOrMemory
// falls back to memory and the workspace says that nothing outlives the page view (§55).
// Delete is the only destructive action and always asks first (§225); an import never
// overwrites a stored experiment with the same ID (§104: never overwrite silently).
// Decoded experiments (typed arrays) stay in the closure; Alpine holds summaries and text.
//
// Export (§88): exportableExperiment() hashes a raw input deviceId that an older record still
// carries (schema.js sanitizeForExport) and re-stamps a version-2 result hash, which covers the
// input; a version-1 hash covers the results only and stays valid. CSV (m4): the transfer CSV
// carries the quality mask as its `reliable` column (when the mask lies on the transfer grid),
// the frequency-corrected magnitude when the experiment's profile is loaded (same id), and the
// phase when the transfer has one. Imports refuse a file larger than the limit before reading
// it (m6).

import { KNOWN_ALGORITHM_IDS } from '../measurement/algorithms.js';
import { openExperimentStoreOrMemory } from '../experiments/store.js';
import { validateExperiment, DEFAULT_MAX_BYTES } from '../experiments/validate.js';
import {
  experimentToJson, formatErrors, newExperimentId, EXPERIMENT_FILE_EXTENSION, LIMITS,
  sanitizeForExport,
} from '../experiments/schema.js';
import { resultHash, withResultHash, resultHashVersionOf } from '../experiments/hash.js';
import {
  csvMeta, transferCsv, aggregateCsv, irCsv, reliableFromQuality,
} from '../experiments/csv.js';
import { applyFrequencyCorrection } from '../calibration/interpolate.js';
import { experimentSummary, experimentListRows } from '../measurement/views/experiment-summary.js';
import { buildCompareView } from '../measurement/views/compare-view.js';
import { buildResponseView } from '../measurement/views/response-chart.js';
import { createResponseChart } from '../charts/measure-charts.js';
import { downloadBlob, readFileText } from './exporters.js';
import { experimentTestContext } from './measure-experiment.js';

export const STORE_FALLBACK_TEXT = 'Experiments are kept in memory for this page view only: this '
  + 'browser does not allow IndexedDB here (for example on file://). Export each experiment as '
  + `${EXPERIMENT_FILE_EXTENSION} to keep it.`;

const plain = (v) => (v == null ? null : JSON.parse(JSON.stringify(v)));

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

/**
 * The experiment as it is exported (§88): no raw deviceId; a version-2 result hash re-stamped
 * when sanitizing changed the input it covers (the record was verified when it was stored).
 */
export function exportableExperiment(e) {
  const { experiment, changed } = sanitizeForExport(e);
  if (!changed) return e;
  const p = experiment.provenance;
  if (p && typeof p.resultHash === 'string' && resultHashVersionOf(experiment) === 2) {
    return withResultHash(experiment, resultHash(experiment, { version: 2 }), 2);
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
export function createExperimentsUi() {
  const ctx = {
    cmp: null,
    store: null,
    opening: null,
    cache: new Map(),   // id → decoded experiment (the ones opened or compared)
    detail: null,       // the experiment shown in the detail panel
    compare: [],        // experiments in the compare view
    charts: { detail: null, overlay: null, delta: null },
  };

  async function store(cmp) {
    if (ctx.store) return ctx.store;
    if (!ctx.opening) {
      ctx.opening = openExperimentStoreOrMemory({
        indexedDB: typeof indexedDB !== 'undefined' ? indexedDB : null,
        storage: typeof navigator !== 'undefined' ? navigator.storage : null,
        knownAlgorithms: KNOWN_ALGORITHM_IDS,
      }).then((r) => {
        ctx.store = r.store;
        cmp.exps.persistent = r.persistent;
        cmp.exps.storeKind = r.store.kind;
        cmp.exps.storeNote = r.persistent ? null : STORE_FALLBACK_TEXT;
        return r.store;
      });
    }
    return ctx.opening;
  }

  async function get(cmp, id) {
    if (ctx.cache.has(id)) return ctx.cache.get(id);
    const s = await store(cmp);
    const e = await s.get(id);
    if (e) ctx.cache.set(id, e);
    return e;
  }

  function setDetail(cmp, e) {
    ctx.detail = e;
    if (!e) {
      cmp.exps.detail = null;
      if (ctx.charts.detail) ctx.charts.detail.setView(null);
      return;
    }
    const s = experimentSummary(e);
    const view = buildResponseView(e, { profile: typeof cmp.measureCurrentProfile === 'function'
      ? cmp.measureCurrentProfile() : null });
    cmp.exps.detail = {
      ...plain(s),
      testContext: isTestContext(e),
      notes: e.environment && e.environment.notes ? e.environment.notes : null,
      response: view ? { summary: view.summary, badges: view.badges.slice(),
        notes: view.notes.slice() } : null,
      hasAggregate: !!(e.results && e.results.aggregate),
      hasTransfer: !!(e.results && e.results.transfer),
      hasIr: !!(e.results && e.results.ir),
    };
    if (ctx.charts.detail) ctx.charts.detail.setView(view);
  }

  function setCompare(cmp, list) {
    ctx.compare = list;
    if (list.length < 2) {
      cmp.exps.compare = null;
      if (ctx.charts.overlay) ctx.charts.overlay.setView(null);
      if (ctx.charts.delta) ctx.charts.delta.setView(null);
      return;
    }
    const v = buildCompareView(list);
    cmp.exps.compare = {
      entries: plain(v.entries),
      common: plain(v.common),
      differences: plain(v.differences),
      compatible: v.compatible,
      warnings: v.warnings.slice(),
      summary: v.summary,
      overlayNotes: v.overlay ? v.overlay.notes.slice() : [],
      overlaySummary: v.overlay ? `Overlay of ${v.entries.length} raw responses (relative `
        + 'magnitudes, unchanged).' : 'No experiment has a frequency response to overlay.',
      delta: v.delta.ok ? { ok: true, label: v.delta.label, summary: v.delta.summary,
        rangeText: v.delta.rangeText } : { ok: false, reason: v.delta.reason },
    };
    if (ctx.charts.overlay) ctx.charts.overlay.setView(v.overlay);
    if (ctx.charts.delta) ctx.charts.delta.setView(v.delta.ok ? v.delta : null);
  }

  return {
    EXPERIMENT_FILE_EXTENSION,
    exps: {
      loaded: false,
      busy: false,
      persistent: true,
      storeKind: null,
      storeNote: null,
      rows: [],
      empty: null,
      selected: [],
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
    },

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
      ctx.cache.set(id, e);
      await this.experimentsRefresh();
      return id;
    },
    async experimentsRefresh() {
      const s = await store(this);
      const list = await s.list();
      const ids = new Set(list.map((x) => x.experimentId));
      this.exps.selected = this.exps.selected.filter((id) => ids.has(id));
      const v = experimentListRows(list, { selected: this.exps.selected });
      this.exps.rows = v.rows.map((r) => ({ ...r, actions: undefined }));
      this.exps.empty = v.empty;
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
    experimentsToggleSelect(id) {
      const sel = new Set(this.exps.selected);
      if (sel.has(id)) sel.delete(id); else sel.add(id);
      this.exps.selected = [...sel];
      this.exps.rows = this.exps.rows.map((r) => ({ ...r, selected: sel.has(r.id) }));
      this.exps.canCompare = sel.size >= 2;
    },
    async experimentsCompare(ids = this.exps.selected) {
      if (ids.length < 2) return null;
      const list = [];
      for (const id of ids.slice(0, 4)) {
        const e = await get(this, id);
        if (e) list.push(e);
      }
      setCompare(this, list);
      this.exps.panel = 'compare';
      this.$nextTick(() => {
        if (ctx.charts.overlay) ctx.charts.overlay.relayout();
        if (ctx.charts.delta) ctx.charts.delta.relayout();
      });
      return this.exps.compare;
    },
    experimentsAskRename(row) {
      this.exps.renameId = row.id;
      this.exps.renameName = row.name === '(unnamed)' ? '' : row.name;
      this.openModal('osc-dlg-exp-rename');
    },
    async experimentsRename() {
      const id = this.exps.renameId;
      const e = await get(this, id);
      if (!e) return false;
      const name = String(this.exps.renameName || '').trim().slice(0, LIMITS.nameChars);
      const next = { ...e, name };
      try {
        await (await store(this)).put(next);
        ctx.cache.set(id, next);
        if (ctx.detail && ctx.detail.experimentId === id) setDetail(this, next);
        this.closeModal('osc-dlg-exp-rename');
        await this.experimentsRefresh();
        return true;
      } catch (err) {
        this.notify('error', 'Rename failed', err.message || String(err));
        return false;
      }
    },
    /** A copy under a new ID (same configuration and results, so the same hashes). */
    async experimentsDuplicate(id) {
      const e = await get(this, id);
      if (!e) return null;
      const copy = {
        ...e,
        experimentId: newExperimentId(randomBytes16()),
        name: `${e.name || '(unnamed)'} (copy)`.slice(0, LIMITS.nameChars),
        provenance: { ...e.provenance, createdAt: new Date().toISOString() },
      };
      try {
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
        await this.experimentsRefresh();
        this.notify('success', 'Experiment deleted', `"${this.exps.deleteName}" was removed from `
          + 'this browser.');
        return true;
      } catch (err) {
        this.notify('error', 'Delete failed', err.message || String(err));
        return false;
      }
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
      const e = await get(this, id);
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
      const e = v.experiment;
      const s = await store(this);
      if (await s.get(e.experimentId)) {
        this.exps.importErrors = [`an experiment with ID ${e.experimentId} is already stored; `
          + 'it was not overwritten'];
        this.notify('warning', 'Experiment not imported', this.exps.importErrors[0]);
        return null;
      }
      this.exps.importErrors = [];
      const id = await this.experimentsPut(e);
      this.notify('success', 'Experiment imported', `"${e.name || '(unnamed)'}"${v.migratedFrom
        ? ` (migrated from schema v${v.migratedFrom})` : ''}.`);
      return id;
    },
    /** REPEAT (§104): load the recipe into MEASURE; the result is saved as a new experiment. */
    async experimentsRepeat(id) {
      const e = await get(this, id);
      if (!e) return false;
      this.measureLoadRecipe(e.recipe, { repeatOf: e.experimentId });
      this.setWorkspace('measure');
      this.notify('info', 'Recipe loaded for a repeat', `"${e.name || '(unnamed)'}": run the `
        + 'measurement; it is saved as a new experiment (repeat of the original).');
      return true;
    },
    /** Inspect an experiment's result in the MEASURE result panel. */
    async experimentsShowInMeasure(id) {
      const e = await get(this, id);
      if (!e) return false;
      this.measureShowExperiment(e);
      this.setWorkspace('measure');
      return true;
    },
    experimentsTestSeam() {
      return {
        store: () => ctx.store,
        get: (id) => ctx.cache.get(id) || null,
        detail: () => ctx.detail,
        compare: () => ctx.compare.slice(),
      };
    },
  };
}
