// MEASURE workspace (src/js/ui/measure.js): saving a result as an experiment (ADR 0040, 0043):
// one save record per result, a lost acknowledgement read back, a stored run changed only by
// annotate; loading a recipe or a definition version into the setup; the unsaved-work
// report (ADR 0045).

import { MEASUREMENT_STATES as S, isActiveState } from '../../measurement/state-machine.js';
import { measurableStimulusRefusal } from '../../measurement/engine.js';
import { newExperimentId, annotateExperiment } from '../../experiments/schema.js';
import { recordFindings } from '../../experiments/validate.js';
import { definitionText } from '../../measurement/views/experiment-summary.js';
import {
  experimentFromResult, experimentTestContext, measuredEvidence,
} from '../measure-experiment.js';
import { randomBytes16, levelId } from './constants.js';

/** The saving functions over `ctx`; `ops` holds those of the other parts. */
export function createSaving(ctx, svc, ops) {
  // ---------------------------------------------------------------- experiment building
  /** The { f1, f2 } a recipe asked for (before the Nyquist clamp), or null. */
  function requestedOf(recipe) {
    const st = recipe && recipe.stimulus;
    return st ? { f1: Number(st.f1), f2: Number(st.f2) } : null;
  }

  /**
   * The evidence of `result` as measured (taken at its start, measuredEvidence); a TEST CONTEXT
   * result shown without a run (test seam) has no start notes and takes the rest from the
   * workspace now.
   */
  function evidenceOf(result) {
    return ctx.evidence && ctx.evidence.result === result ? ctx.evidence
      : { ...measuredEvidence(result, { notes: null }), repeatOf: ctx.repeatOf,
        definition: ctx.runDefinition, requested: requestedOf(ctx.lastRecipe) };
  }

  /** The one save record of `result`: its id and timestamp are chosen once (idempotent). */
  function saveOf(result) {
    if (!ctx.save || ctx.save.result !== result) {
      ctx.save = { result, id: newExperimentId(randomBytes16()), now: Date.now(), stored: false,
        experiment: null };
    }
    return ctx.save;
  }

  function experimentOf(result, cmp) {
    const m = cmp.meas;
    // Calibration, notes, repeat link and definition come from the evidence (ADR 0040).
    const ev = evidenceOf(result);
    const sv = saveOf(result);
    return experimentFromResult(result, {
      now: sv.now, id: sv.id, build: svc.build,
      name: m.name, notes: ev.notes, laterNotes: m.notes, repeatOf: ev.repeatOf,
      requested: ev.requested, definition: ev.definition,
    });
  }

  /** `e` (the record of the current save) is stored: the run is saved, once. */
  function markStored(cmp, e) {
    const sv = ctx.save;
    sv.stored = true;
    sv.experiment = e;
    cmp.meas.saved = true;
    cmp.meas.savedId = sv.id;
    cmp.meas.savedAnnotation = e.annotations && e.annotations.notes || null;
    cmp.meas.savedName = e.name;
    ctx.repeatOf = null;
  }

  /**
   * "Update name and notes" for a stored run: the run is immutable (ADR 0040), so only its name
   * and annotation notes change, through annotate, and only what differs from the stored record
   * is sent (an annotation added in Experiments is never cleared from here). A record deleted
   * since is stored again as it was saved (same id, creation time and repeat link), with the
   * current name and notes. The UI never says "not saved" for a stored run.
   */
  async function updateSaved(cmp, result, { confirmed = false } = {}) {
    const m = cmp.meas;
    const sv = ctx.save;
    const ev = evidenceOf(result);
    const later = typeof m.notes === 'string' ? m.notes.trim() : '';
    const notes = later && later !== (ev.notes || '') ? later : null; // an annotation, or none
    m.saving = true;
    let lostRun = false; // the record was gone and storing it again failed: not stored
    const storeAgain = async (name) => {
      const again = annotateExperiment(sv.experiment, notes === null ? { name }
        : { name, notes });
      try {
        await cmp.experimentsPut(again);
      } catch (err) {
        lostRun = true;
        sv.stored = false;
        cmp.notify('error', 'Experiment not stored', `"${name}" was no longer stored, and storing `
          + `it again failed: ${err.message || String(err)}. The experiment is not stored; `
          + 'save again.');
        return null;
      }
      sv.experiment = again;
      m.savedAnnotation = again.annotations && again.annotations.notes || null;
      m.savedName = again.name;
      cmp.notify('success', 'Experiment saved again', `"${name}" was no longer stored; the `
        + 'same experiment is stored again under its id.');
      return sv.id;
    };
    try {
      const stored = await cmp.experimentsGet(sv.id);
      const name = (typeof m.name === 'string' && m.name.trim()) || (stored || sv.experiment).name;
      if (!stored) return await storeAgain(name);
      const storedNotes = stored.annotations && stored.annotations.notes || null;
      const meta = {};
      if (name !== stored.name) meta.name = name;
      if (notes !== null && notes !== storedNotes) meta.notes = notes;
      // A lost acknowledgement: the write reported an error, yet the run is stored.
      const lost = confirmed ? ' (the write reported an error, but the experiment is stored)' : '';
      if (!Object.keys(meta).length) {
        m.savedAnnotation = storedNotes;
        m.savedName = stored.name;
        if (confirmed) cmp.notify('success', 'Experiment saved', `"${stored.name}"${lost}.`);
        else {
          cmp.notify('info', 'Nothing to update', `"${stored.name}" already has this name and `
            + 'these notes.');
        }
        return sv.id;
      }
      let next;
      try {
        next = await cmp.experimentsAnnotate(sv.id, meta);
      } catch (err) {
        if (err && err.code === 'missing') return await storeAgain(name); // deleted meanwhile
        throw err;
      }
      m.savedAnnotation = next.annotations && next.annotations.notes || null;
      m.savedName = next.name;
      cmp.notify('success', confirmed ? 'Experiment saved' : 'Experiment updated',
        `"${next.name}"${lost}: ${Object.keys(meta).map((k) => (k === 'name' ? 'name'
          : 'annotation notes')).join(' and ')} updated; the measured experiment is stored `
          + 'unchanged.');
      return sv.id;
    } catch (err) {
      cmp.notify('error', 'Experiment name and notes not updated', 'The measured experiment is '
        + `stored (${sv.id}); only the metadata change failed: ${err.message || String(err)}`);
      return sv.id;
    } finally {
      m.saving = false;
      m.saved = !lostRun;
      m.savedId = lostRun ? null : sv.id;
      if (lostRun) { m.savedAnnotation = null; m.savedName = null; }
      ops.refresh();
    }
  }

  return {
    requestedOf, evidenceOf, saveOf, experimentOf, markStored, updateSaved,
  };
}

export function measureUnsavedPart(ctx, svc, ops) {
  return {
    /** A completed measurement whose result is not saved (the "unsaved result" indicator). */
    get measureUnsaved() {
      return this.meas.state === S.COMPLETE && !this.meas.saved;
    },
    /**
     * What a reload or a closed tab would lose here (ui/unsaved.js): the completed result that
     * is not saved, and a level calibration, which lives in page memory only (a frequency
     * profile is not listed: its file can be imported again).
     */
    /**
     * A saved run whose name or notes typed since are not stored yet ("Update name and notes"
     * not pressed, or it failed): what updateSaved would send differs from the stored record.
     */
    get measureMetadataPending() {
      const m = this.meas;
      const name = typeof m.name === 'string' ? m.name.trim() : '';
      const later = typeof m.notes === 'string' ? m.notes.trim() : '';
      if (!m.saved || !ctx.save || !ctx.save.stored) return false;
      if (name && name !== (m.savedName || '')) return true;
      const started = ops.evidenceOf(ctx.save.result).notes || '';
      const notes = later && later !== started ? later : null;
      return notes !== null && notes !== (m.savedAnnotation || null);
    },
    measureWhatWouldBeLost() {
      const lost = [];
      if (this.measureUnsaved) {
        lost.push({ domain: 'measure', label: 'A completed measurement that is not saved' });
      }
      if (this.measureMetadataPending) {
        lost.push({ domain: 'measure', label: 'A name or notes not stored yet (Update name and '
          + 'notes)' });
      }
      if (this.meas.cal.level) {
        lost.push({ domain: 'measure', label: 'The level calibration (kept in page memory only)' });
      }
      return lost;
    },
    /** Why "Save experiment" is disabled, or '' when it is enabled. */
    get measureSaveReason() {
      if (this.meas.saving) return 'Saving…';
      if (this.meas.saved) {
        return 'This measurement is saved; Update name and notes stores a new name or notes as '
          + 'metadata (the experiment is unchanged).';
      }
      if (this.meas.state !== S.COMPLETE) return 'Available once a measurement is COMPLETE.';
      return '';
    },
  };
}

export function measureExperimentPart(ctx, svc, ops) {
  return {
    // ------------------------------------------------------------------ experiment actions
    async measureSave({ decorate = null } = {}) {
      const result = ctx.result;
      if (!result || result.state !== S.COMPLETE || this.meas.saving) return null;
      // A stored run is never put again: a later name or notes edit is metadata (annotate).
      if (ctx.save && ctx.save.result === result && ctx.save.stored) {
        return ops.updateSaved(this, result);
      }
      this.meas.saving = true;
      // A retry writes the same facts: the Studio decoration of the first attempt is kept.
      const sv0 = ops.saveOf(result);
      if (decorate) sv0.decorate = decorate;
      const dec = sv0.decorate || null;
      let e = null;
      try {
        const base = ops.experimentOf(result, this);
        e = dec ? dec(base) : base;
        // A new measurement never stores a finding: a calibration claim its results contradict,
        // or a stimulus this build cannot measure (ledger D4).
        const claim = recordFindings(e);
        if (claim.length) throw new Error(claim.map((f) => `${f.path}: ${f.text}`).join('; '));
        const id = await this.experimentsPut(e);
        ops.markStored(this, e);
        ops.refresh();
        const d = ops.evidenceOf(result).definition;
        const from = !d ? '' : e.definition.hash === d.hash ? `from definition ${definitionText(d,
          d)}, ` : 'NOT from the loaded definition (the recipe that ran differs), ';
        this.notify('success', 'Experiment saved', `"${e.name}" (${from}${this.exps.persistent
          ? 'stored in this browser' : 'kept in memory for this page view only: export it to keep '
          + 'it'}).`);
        return id;
      } catch (err) {
        // The write may have been stored with its acknowledgement lost: read it back.
        const sv = ctx.save && ctx.save.result === result ? ctx.save : null;
        let there = null;
        let unread = false;
        try {
          there = sv && e ? await this.experimentsGet(sv.id) : null;
        } catch (e2) {
          unread = true;
        }
        // The stored record is this run only when its result hash is the one written.
        const same = !!there && !!e && !!there.provenance && there.provenance.resultHash
          === e.provenance.resultHash;
        if (same) {
          ops.markStored(this, there);
          this.meas.saving = false;
          return await ops.updateSaved(this, result, { confirmed: true });
        }
        if (there) {
          ctx.save = null; // a retry stores this run under a new id, with the same decoration
          ops.saveOf(result).decorate = sv.decorate || null;
          this.notify('error', 'Experiment not saved', `A different record is stored under this `
            + `id (${sv.id}); this experiment was not saved. Save again to store it under a `
            + 'new id.');
          return null;
        }
        if (unread) {
          this.notify('error', 'Experiment not confirmed', `${err.message || String(err)}. The `
            + 'store could not be read back to see whether the experiment was stored; save again '
            + '(a retry never stores a second copy).');
        } else this.notify('error', 'Experiment not saved', err.message || String(err));
        return null;
      } finally {
        this.meas.saving = false;
      }
    },
    /** Show a saved experiment's result in the result panel (inspection, §75). */
    measureShowExperiment(e, title) {
      ctx.shown = { kind: 'experiment', src: e, title: title || `Saved experiment "${e.name
        || '(unnamed)'}"`, testContext: experimentTestContext(e) };
      ops.resetInvalidViewOptions(e);
      ops.rebuildAll();
    },
    /** The current setup's recipe (measure-flow.js recipeFromFields). */
    measureSetupRecipe() {
      return ops.recipeNow();
    },
    /**
     * Load a definition version (its run reference, definition.js definitionRef or an
     * experiment's `definition`) into the setup. An authored one stays loaded (the panel shows
     * it; `name` and `match` say how it relates to the stored definition, and a 'match' names
     * the run); a derived one is a saved run's recipe as played and only fills the setup.
     */
    measureLoadDefinition(ref, { name = null, match = 'absent', repeatOf = null } = {}) {
      if (!this.measureLoadRecipe(ref.execution.recipe, { repeatOf })) return false;
      if (ref.derived) {
        this.measureClearDefinition();
        return true;
      }
      ctx.definition = { ...ref, name, match };
      if (name && match === 'match') this.meas.name = name;
      this.meas.definition = { text: definitionText(ref, { name, match }),
        conditions: ref.execution.conditions.notes, differs: false };
      ops.refresh();
      return true;
    },
    /**
     * Why this build cannot run `recipe` (ledger D4: a stimulus kind the engine does not
     * measure), in words for the user, or null. The setup has fields for a log sweep only, so
     * loading any other recipe would silently run a log sweep in its place.
     */
    measureRecipeRefusal(recipe, { whose = 'This recipe' } = {}) {
      const kind = recipe && recipe.stimulus ? recipe.stimulus.kind : undefined;
      const why = measurableStimulusRefusal(kind);
      return why ? `${whose} uses ${why}.` : null;
    },
    /** Stop using the loaded definition (the next run derives its own). */
    measureClearDefinition() {
      ctx.definition = null;
      this.meas.definition = null;
    },
    /**
     * Load a recipe (an experiment's) into the setup; the next save is a NEW experiment. Refused
     * (false, nothing changed) for a recipe this build cannot run (measureRecipeRefusal).
     */
    measureLoadRecipe(recipe, { repeatOf = null } = {}) {
      if (this.measureRecipeRefusal(recipe)) return false;
      const st = recipe.stimulus || {};
      const a = recipe.analysis || {};
      const v = this.meas.values;
      for (const [k, val] of Object.entries({ f1: st.f1, f2: st.f2, duration: st.duration,
        level: levelId(st.level) || st.level, repeats: recipe.repeats,
        aggregation: a.aggregation, noiseCheckS: a.noiseCheckS, preRollS: a.preRollS,
        postRollS: a.postRollS, gapS: a.gapS, phase: a.phase })) {
        if (val !== undefined && val !== null) v[k] = val;
      }
      ctx.repeatOf = repeatOf;
      // The next measurement resets meas.saved; the stored run shown now stays saved.
      if (ctx.me && !isActiveState(ctx.me.state)) ctx.me.reset();
      ops.refresh();
      return true;
    },
  };
}
