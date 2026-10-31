// MEASURE workspace (src/js/ui/measure.js): the run flow: the setup check, a measurement (of the
// setup or of a Studio recipe, V424), the primary and secondary flow actions, setup edits and
// the recipe link (V355). The evidence of a run is taken when it starts (ADR 0040).

import { MEASUREMENT_STATES as S, isActiveState } from '../../measurement/state-machine.js';
import { MEASUREMENT_LEVELS } from '../../measurement/engine.js';
import { isValidLevelCalibration } from '../../calibration/level.js';
import { measuredEvidence } from '../measure-experiment.js';
import {
  encodeRecipeLink, decodeRecipeLink, recipeParamOf, withRecipeParam,
} from '../../core/url-state-measure.js';
import { hashForWorkspace } from '../navigation.js';
import { LIVE_RTA_FIELDS, FIELD_DEFAULTS, recipeValues } from './constants.js';

/** The run functions over `ctx`; `ops` holds those of the other parts. */
export function createRun(ctx, svc, ops) {
  /**
   * Put validated recipe values (decodeRecipeLink) into the setup, as an edit does: refused
   * while a measurement or a reference capture runs, and a READY setup check is reset because
   * the recipe changed. Returns { ok: true } or { ok: false, errors }. Says nothing itself.
   */
  function applyRecipeValues(cmp, values) {
    if (cmp.meas.busy || ctx.refCapture) return { ok: false, errors: ['a measurement is running'] };
    Object.assign(cmp.meas.values, values);
    // meas.saved belongs to the result shown, not to the setup: a stored run stays saved (a
    // second save of it would be refused as immutable and read as "not saved").
    if (ctx.me && ctx.me.state === S.READY) ctx.me.reset(); // the recipe changed
    ops.refresh();
    return { ok: true };
  }

  // ---------------------------------------------------------------- actions
  async function runPreflight(cmp) {
    ops.stopLive(); // exclusive input: the live RTA never runs beside a capture
    const me = ops.ensureEngine();
    if (ctx.me.state !== S.IDLE && !isActiveState(ctx.me.state)) me.reset();
    svc.engine.init();
    ctx.result = null;
    ctx.shown = null;
    cmp.meas.saved = false;
    cmp.meas.savedId = null;
    ops.rebuildAll();
    try {
      ctx.pending = me.preflight(ops.recipeNow(), { calibration: ops.calibrationInput() });
      await ctx.pending;
    } catch (e) {
      if (!(e && e.code === 'ABORTED')) {
        cmp.notify('error', 'Setup check failed', e.message || String(e));
      }
    } finally {
      ctx.pending = null;
      ops.refresh();
    }
  }

  /**
   * True when a level calibration is in use and no input is known: it is checked against the
   * input before it is applied (bound: the same input; unbound: never, C1).
   */
  function levelNeedsInputCheck(cmp) {
    return cmp.meas.cal.useLevel && isValidLevelCalibration(ctx.levelCal) && !ops.inputKnown();
  }

  /** Run one measurement of `given` (Studio, V424) or of the setup fields; resolves the result. */
  async function runMeasure(cmp, given = null, startAt = null) {
    ops.stopLive();
    const me = ops.ensureEngine();
    svc.engine.init();
    svc.stopPlayback(cmp);
    if ([S.COMPLETE, S.INVALID, S.ABORTED].includes(me.state)) me.reset();
    cmp.meas.saved = false;
    cmp.meas.savedId = null;
    ctx.result = null;
    ctx.evidence = null;
    ctx.save = null;
    cmp.meas.savedAnnotation = null;
    cmp.meas.savedName = null;
    if (ctx.shown && ctx.shown.kind === 'result') ctx.shown = null;
    ops.rebuildAll();
    const notesAtStart = cmp.meas.notes; // the conditions as stated when the run starts
    const repeatOfAtStart = ctx.repeatOf;
    const recipe = given || ops.recipeNow();
    ctx.lastRecipe = recipe;
    ctx.runDefinition = !given && ops.setupIsDefinition(recipe) ? ctx.definition : null;
    const definitionAtStart = ctx.runDefinition;
    if (!given && ctx.definition && !ctx.runDefinition) {
      cmp.notify('warning', 'Not run from the definition', 'The setup differs from the loaded '
        + 'definition, so this experiment records the definition derived from its own recipe.');
    }
    let result = null;
    try {
      // A level calibration is checked against the input before it is applied: without a
      // known current input, the setup check opens it first (M3, C1).
      if (levelNeedsInputCheck(cmp) && me.state !== S.READY) {
        ctx.pending = me.preflight(recipe, { calibration: ops.calibrationInput() });
        await ctx.pending;
      }
      ctx.pending = me.measure(recipe, { calibration: ops.calibrationInput(), startAt });
      result = await ctx.pending;
    } catch (e) {
      if (!(e && e.code === 'ABORTED')) {
        cmp.notify('error', 'Measurement failed', e.message || String(e));
      }
    } finally {
      ctx.pending = null;
      ops.refresh();
    }
    // Presenting the result is outside the measurement: a view problem never fails it (M6).
    if (result) {
      ctx.evidence = Object.freeze({ result, ...measuredEvidence(result,
        { notes: notesAtStart }), repeatOf: repeatOfAtStart, definition: definitionAtStart,
        requested: ops.requestedOf(recipe) });
      ops.showResult(result);
      cmp.meas.evidenceRun += 1; // the reactive token of ctx.evidence
      ops.refresh();
    }
    return result;
  }

  return {
    applyRecipeValues, runPreflight, levelNeedsInputCheck, runMeasure,
  };
}

export function measureFlowPart(ctx, svc, ops) {
  return {
    // ------------------------------------------------------------------ flow actions
    async measureRunPrimary() {
      const a = this.meas.flow.primaryAction;
      if (!a || !a.enabled) return;
      // The Playground shows this flow as its measurement row (P002, Q004 option A), but the
      // measurement runs in MEASURE: the action opens it first, in the same gesture, so the
      // quality reasons, the result and Stop are in view (and leaving MEASURE aborts, main.js).
      if (this.workspace !== 'measure') this.setWorkspace('measure');
      switch (a.id) {
        case 'preflight': await ops.runPreflight(this); break;
        case 'measure': await ops.runMeasure(this); break;
        case 'stop': this.measureAbort('user'); break;
        case 'save': await this.measureSave(); break;
        case 'repeat': await this.measureRepeat(); break;
        case 'acknowledge':
          if (ctx.me) ctx.me.reset();
          ctx.error = null;
          ops.refresh();
          break;
        default: break;
      }
    },
    async measureRunSecondary(id) {
      if (id === 'stop') this.measureAbort('user');
      else if (id === 'repeat') {
        // Repeat is a measurement too: pressed on the Playground's measurement row (a COMPLETE
        // result outlives leaving MEASURE) it opens MEASURE first, as the primary action does.
        if (this.workspace !== 'measure') this.setWorkspace('measure');
        await this.measureRepeat();
      } else if (id === 'expert') this.measureSetExpert(!this.meas.expert);
    },
    measureStop() {
      this.measureAbort('user');
    },
    /**
     * Studio hook (V3.1 plan V424, docs/v31/timeline.md "Measurement clips"): run `recipe` (a
     * Studio topology's, studio/provenance.js recipeFromStudio) through THIS workspace's
     * MeasurementEngine (the same io, calibration, state machine, abort paths and output
     * exclusivity as MEASURE) and save it as measureSave does, with `decorate` (the Studio
     * provenance block) applied to the experiment, its first capture not before `startAt` (the
     * clip's audio-clock time). Resolves { ok, state, experimentId, name, experiment, reason };
     * never rejects.
     */
    async measureRunRecipe(recipe, { decorate = null, startAt = null } = {}) {
      if (this.measureOwnsOutput() || ctx.pending) {
        return { ok: false, state: ctx.me ? ctx.me.state : S.IDLE,
          reason: 'A measurement is already in progress.' };
      }
      let result = null;
      try {
        result = await ops.runMeasure(this, recipe, startAt);
      } catch (e) {
        return { ok: false, state: ctx.me ? ctx.me.state : S.IDLE, reason: e.message || String(e) };
      }
      const state = result ? result.state : (ctx.me ? ctx.me.state : S.IDLE);
      if (!result || state !== S.COMPLETE) {
        const why = result && Array.isArray(result.reasons) ? result.reasons
          .filter((x) => x.severity !== 'ok').map((x) => x.text).slice(0, 2).join(' ') : '';
        return { ok: false, state, reason: why || (ctx.error ? ctx.error.message : state) };
      }
      let saved = null;
      const id = await this.measureSave({ decorate: (e) => {
        saved = decorate ? decorate(e) : e;
        return saved;
      } });
      return id ? { ok: true, state, experimentId: id, name: saved.name, experiment: saved }
        : { ok: false, state, reason: 'The experiment was not saved.' };
    },
    async measureStart() {
      await ops.runMeasure(this);
    },
    async measureCheck() {
      await ops.runPreflight(this);
    },
    /** REPEAT (§104): the same recipe again; the saved result is a NEW experiment. */
    async measureRepeat() {
      if (this.meas.savedId) ctx.repeatOf = this.meas.savedId;
      await ops.runMeasure(this);
    },
    measureSetExpert(on) {
      this.meas.expert = !!on;
      if (!this.meas.expert && this.meas.view.quantity !== 'magnitude') {
        this.meas.view.quantity = 'magnitude';
        ops.safely('frequency response', ops.rebuildResponse);
      }
      ops.refresh();
    },
    measureSetValue(id, raw, kind) {
      if (Object.hasOwn(LIVE_RTA_FIELDS, id)) {
        this.measureSetView(LIVE_RTA_FIELDS[id], id === 'fftSize' ? Number(raw) : raw);
        return;
      }
      let v = raw;
      if (kind === 'number') {
        v = Number(raw);
        if (!Number.isFinite(v)) return;
      } else if (kind === 'toggle') v = !!raw;
      this.meas.values[id] = v;
      // A changed recipe invalidates a READY preflight (the engine compares the recipe).
      if (ctx.me && ctx.me.state === S.READY) ctx.me.reset();
      ops.refresh();
    },
    measureSetLevel(id) {
      if (!Object.hasOwn(MEASUREMENT_LEVELS, id)) return;
      this.measureSetValue('level', id, 'choice');
    },
    measureLevelKeydown(e) { this.rovingKeydown(e); },
    /** Choose the measurement input ('' = the default input), V322. */
    measureSelectInput(id) {
      return ops.selectInput(this, id);
    },
    /** Re-read the input list (after the permission was granted). */
    async measureRefreshInputs() {
      return ops.refreshInputs();
    },
  };
}

export function measureRecipeLinkPart(ctx, svc, ops) {
  return {
    // ------------------------------------------------------------------ recipe link (V355)
    /** The setup's recipe as the `mr` hash value (a recipe only: never results). */
    measureRecipeParam() {
      return encodeRecipeLink(recipeValues(this.meas.values));
    },
    /** This page's URL with the recipe in its hash (other hash parameters kept). */
    measureRecipeUrl() {
      const loc = typeof window !== 'undefined' ? window.location : null;
      if (!loc) return null;
      // A recipe link opens MEASURE (m=measure): the Studio deep-link keys (V422) are not
      // carried along.
      return `${loc.href.split('#')[0]}#${hashForWorkspace(withRecipeParam(loc.hash,
        this.measureRecipeParam()), 'measure')}`;
    },
    /** Put the recipe link in the address bar and on the clipboard (dialog when unavailable). */
    async measureCopyRecipeLink() {
      const url = this.measureRecipeUrl();
      if (!url) return null;
      ctx.lastRecipeParam = this.measureRecipeParam(); // our own link is not one to apply
      try {
        window.history.replaceState(window.history.state, '', url);
      } catch (e) { /* file:// in some */ }
      this.meas.recipeLink = url;
      let copied = false;
      try {
        if (navigator.clipboard && window.isSecureContext !== false) {
          await navigator.clipboard.writeText(url);
          copied = true;
        }
      } catch (e) {
        copied = false;
      }
      if (copied) {
        this.notify('success', 'Recipe link copied', 'The link loads this measurement recipe '
          + '(sweep, level, runs, timing); it carries no result, calibration or input device and '
          + 'never starts a measurement.');
      } else this.openModal('osc-dlg-recipe-link');
      return url;
    },
    /**
     * Apply a recipe link from a location hash (V355): validated like every import, refused
     * whole when invalid, never starts anything. Returns true (applied), false (refused) or
     * null (no recipe in the hash, or the one already applied). The workspace is the hash
     * dispatcher's choice (ui/navigation.js): `mr` alone opens MEASURE, an `m` key wins.
     */
    measureApplyRecipeHash(hash) {
      const param = recipeParamOf(hash);
      if (param === null) {
        ctx.lastRecipeParam = null;
        return null;
      }
      if (param === ctx.lastRecipeParam) return null;
      ctx.lastRecipeParam = param;
      const r = decodeRecipeLink(param, { defaults: recipeValues(FIELD_DEFAULTS) });
      if (!r.ok) {
        this.meas.recipeLinkErrors = r.errors.slice(0, 5);
        this.notify('warning', 'Recipe link not applied', `${r.errors.slice(0, 3).join('; ')}. `
          + 'The measurement setup is unchanged.');
        return false;
      }
      // Refused while a measurement runs; otherwise applied as an edit (a READY check resets).
      const applied = ops.applyRecipeValues(this, r.values);
      if (!applied.ok) {
        this.meas.recipeLinkErrors = applied.errors;
        this.notify('warning', 'Recipe link not applied', 'A measurement is running; stop it and '
          + 'open the link again.');
        ctx.lastRecipeParam = null;
        return false;
      }
      this.meas.recipeLinkErrors = [];
      ctx.repeatOf = null;
      this.notify('info', 'Measurement recipe loaded from the link', `${this.meas.stimulusText}, `
        + `${this.meas.values.repeats} run(s). Nothing runs until you press Check setup or Start `
        + 'measurement.');
      return true;
    },
  };
}
