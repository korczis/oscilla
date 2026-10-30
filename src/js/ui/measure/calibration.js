// MEASURE workspace (src/js/ui/measure.js): calibration: the level reference capture through the
// measurement io (M3), the level calibration dialog, and the frequency profile import with its
// sign convention (M4) and export (V315).

import { MEASUREMENT_STATES as S, isActiveState } from '../../measurement/state-machine.js';
import { UNAVAILABLE } from '../../measurement/views/common.js';
import { parseCalibrationText, MAX_IMPORT_BYTES } from '../../calibration/parse.js';
import { coverage as profileCoverage } from '../../calibration/interpolate.js';
import { PROFILE_CONVENTIONS } from '../../calibration/profile.js';
import {
  createLevelCalibration, LEVEL_LIMITS, inputBinding, isBoundLevelCalibration, UNBOUND_TEXT,
} from '../../calibration/level.js';
import { measureReferenceLevel, REFERENCE_CAPTURE_S } from '../../calibration/reference.js';
import { formatHz } from '../../charts/axes.js';
import { readFileText, downloadBlob } from '../exporters.js';
import { exportProfileFile } from '../../calibration/export.js';
import { LEVEL_NEEDS_INPUT, calText } from './constants.js';

/** The calibration functions over `ctx`; `ops` holds those of the other parts. */
export function createCalibration(ctx, svc, ops) {
  // ---------------------------------------------------------------- level reference capture
  function referenceSummary(r, referenceHz) {
    const db = (v) => `${v < 0 ? '−' : ''}${Math.abs(v).toFixed(2)} dB`;
    return {
      ok: r.ok,
      referenceHz,
      observedDb: r.ok ? r.observedDbRelative : null,
      text: r.ok ? `Reading ${db(r.observedDbRelative)} relative, ${r.band.nominal} Hz `
        + `one-third-octave band (${(100 * r.bandFraction).toFixed(0)} % of the captured power, `
        + `${r.durationS.toFixed(1)} s at ${r.sampleRate} Hz)` : null,
      errors: r.errors.slice(),
      warnings: r.warnings.slice(),
    };
  }

  async function captureReference(cmp) {
    const f = cmp.meas.levelForm;
    if (ctx.refCapture) return false;
    if (ctx.me && isActiveState(ctx.me.state) && ctx.me.state !== S.READY) {
      f.error = 'A measurement is running; stop it before capturing the reference.';
      return false;
    }
    const referenceHz = Number(f.referenceHz);
    if (!(referenceHz >= LEVEL_LIMITS.minReferenceHz && referenceHz <= LEVEL_LIMITS.maxReferenceHz)) {
      f.error = `The reference frequency must be ${LEVEL_LIMITS.minReferenceHz}–`
        + `${LEVEL_LIMITS.maxReferenceHz} Hz.`;
      return false;
    }
    ops.stopLive(); // the live RTA shares the capture io and its input
    ops.ensureEngine();
    if (ctx.me.state === S.READY) ctx.me.reset(); // the reference capture owns the input now
    svc.engine.init();
    // A microphone reference must not hear the instrument; the loopback TEST CONTEXT captures
    // the instrument's own output, which is its only possible reference.
    if (ctx.ioKind !== 'loopback') svc.stopPlayback(cmp);
    const io = ctx.io;
    ctx.refCapture = { io };
    ctx.reference = null;
    f.capturing = true;
    f.error = '';
    f.reading = null;
    try {
      const cap = await io.captureNoise(REFERENCE_CAPTURE_S, {});
      const r = measureReferenceLevel(cap, { referenceHz });
      ctx.reference = { reading: r, referenceHz,
        input: { device: cap.device || null, constraints: cap.constraints || null,
          sampleRate: cap.sampleRate }, testContext: cap.testContext || null };
      ops.nameInput(ctx.reference.input, !!ctx.reference.testContext);
      ops.inputOpened(cap.device || null);
      f.reading = referenceSummary(r, referenceHz);
      if (!r.ok) f.error = r.errors.join(' ');
      return r.ok;
    } catch (e) {
      const aborted = e && (e.code === 'ABORTED' || e.name === 'AbortError');
      f.error = aborted ? 'Reference capture stopped; nothing was stored.'
        : `Reference capture failed: ${e && e.message ? e.message : String(e)}`;
      return false;
    } finally {
      try { io.cancel('reference-done'); } catch (err) { /* already released */ }
      ctx.refCapture = null;
      f.capturing = false;
      ops.refresh();
    }
  }

  function abortReference() {
    if (!ctx.refCapture) return false;
    try { ctx.refCapture.io.cancel('user'); } catch (e) { /* released */ }
    return true;
  }

  // ---------------------------------------------------------------- frequency profile import
  function loadProfile(cmp, r) {
    ctx.profile = r.profile;
    ctx.pendingImport = null;
    cmp.meas.calImport = null;
    const cov = profileCoverage(r.profile);
    cmp.meas.cal.errors = [];
    cmp.meas.cal.warnings = r.warnings.slice(0, 5).map((x) => (x.line ? `line ${x.line}: `
      : '') + x.text);
    cmp.meas.cal.profile = { name: r.profile.name, id: r.profile.id, points:
      r.profile.points.length, coverageText: cov ? `${formatHz(cov[0])}–${formatHz(cov[1])}`
        : UNAVAILABLE.UNKNOWN, convention: r.profile.convention,
      conventionText: PROFILE_CONVENTIONS[r.profile.convention].label,
      conventionBasis: r.convention ? r.convention.text : null,
      preview: r.preview ? r.preview.text : null };
    cmp.meas.cal.useFrequency = true;
    if (ctx.me && ctx.me.state === S.READY) ctx.me.reset();
    ops.refresh();
    ops.rebuildAll();
    cmp.notify('success', 'Frequency profile loaded', `"${r.profile.name}", `
      + `${r.profile.points.length} points; applied only inside ${cmp.meas.cal.profile
        .coverageText} (no extrapolation). Sign: ${cmp.meas.cal.profile.conventionText}. `
      + `${r.preview ? r.preview.text : ''}`);
    return true;
  }

  return {
    referenceSummary, captureReference, abortReference, loadProfile,
  };
}

export function measureCalibrationPart(ctx, svc, ops) {
  return {
    // ------------------------------------------------------------------ calibration
    measureImportCalibrationClick() {
      const input = document.getElementById('osc-measure-cal-file');
      if (input) { input.value = ''; input.click(); }
    },
    async measureImportCalibrationFile(e) {
      const file = e && e.target && e.target.files && e.target.files[0];
      if (!file) return false;
      try {
        // m6: the size is checked before the file is read (1 MiB calibration limit).
        const text = await readFileText(file, { maxBytes: MAX_IMPORT_BYTES,
          what: `"${file.name}"` });
        return this.measureImportCalibrationText(text, file.name);
      } catch (err) {
        this.meas.cal.errors = [err.message || String(err)];
        this.notify('error', 'Calibration not imported', err.message || String(err));
        return false;
      }
    },
    /**
     * Parse a CSV/TXT or JSON frequency profile (calibration/parse.js); never extrapolated.
     * Returns true (loaded), false (rejected) or 'needs-choice' when the file does not state
     * its sign convention: the convention dialog then asks for it (M4). opts.convention is an
     * explicit choice ('deviation' | 'correction').
     */
    measureImportCalibrationText(text, fileName = 'profile', { convention } = {}) {
      const name = String(fileName).replace(/\.[^.]+$/, '');
      const r = parseCalibrationText(text, { name, importedAt: new Date().toISOString(),
        convention });
      if (!r.ok) {
        this.meas.cal.errors = r.errors.slice(0, 5).map((x) => (x.line ? `line ${x.line}: `
          : '') + x.text);
        this.notify('error', 'Calibration not imported', this.meas.cal.errors.join(' '));
        return false;
      }
      if (r.needsConvention) {
        ctx.pendingImport = { text, fileName };
        this.meas.calImport = { name, basis: r.convention.text, choice: null,
          options: Object.values(PROFILE_CONVENTIONS).map((c) => ({ id: c.id, label: c.label,
            preview: r.previews[c.id] ? r.previews[c.id].text : null })) };
        this.openModal('osc-dlg-cal-convention');
        return 'needs-choice';
      }
      return ops.loadProfile(this, r);
    },
    /** The explicit sign convention of the pending import (M4); loads the profile. */
    measureConfirmCalibrationConvention(choice = this.meas.calImport && this.meas.calImport.choice) {
      const p = ctx.pendingImport;
      if (!p || !Object.hasOwn(PROFILE_CONVENTIONS, choice)) return false;
      const ok = this.measureImportCalibrationText(p.text, p.fileName, { convention: choice });
      if (ok === true) this.closeModal('osc-dlg-cal-convention');
      return ok === true;
    },
    measureCancelCalibrationImport() {
      ctx.pendingImport = null;
      this.meas.calImport = null;
      this.closeModal('osc-dlg-cal-convention');
    },
    /** Export the loaded frequency profile as 'csv' or 'json' (V315); returns the text. */
    measureExportCalibration(format) {
      if (!ctx.profile) return null;
      try {
        const f = exportProfileFile(ctx.profile, format);
        downloadBlob(new Blob([f.text], { type: f.type }), f.fileName);
        this.notify('success', 'Frequency profile exported', `${f.fileName}: ${ctx.profile.points
          .length} points, sign convention ${ctx.profile.convention}; it imports back unchanged.`);
        return f.text;
      } catch (err) {
        this.notify('error', 'Profile not exported', err.message || String(err));
        return null;
      }
    },
    measureClearCalibration() {
      ctx.profile = null;
      this.meas.cal.profile = null;
      if (ctx.me && ctx.me.state === S.READY) ctx.me.reset();
      ops.refresh();
      ops.rebuildAll();
    },
    measureToggleCalibration(key) {
      this.meas.cal[key] = !this.meas.cal[key];
      if (ctx.me && ctx.me.state === S.READY) ctx.me.reset();
      ops.refresh();
      ops.rebuildAll();
    },
    measureOpenLevelCalibration() {
      this.meas.levelForm.error = '';
      this.openModal('osc-dlg-level-cal');
    },
    /** Capture the reference reading through the measurement input (M3). */
    async measureCaptureLevelReference() {
      return ops.captureReference(this);
    },
    /** Stop a running reference capture (nothing is stored). */
    measureAbortLevelReference() {
      return ops.abortReference();
    },
    measureCloseLevelCalibration() {
      ops.abortReference();
      this.closeModal('osc-dlg-level-cal');
    },
    measureSetLevelManual(on) {
      this.meas.levelForm.manual = !!on;
      this.meas.levelForm.error = '';
    },
    /**
     * Absolute level calibration (§23): an explicit external reference; no default exists. The
     * reading is the captured one (method 'captured', bound to the capture's input) unless the
     * advanced manual entry is on (method 'manual', bound to the input checked last); both are on
     * LEVEL_SCALE. A calibration is never stored without the input it belongs to (ledger C1):
     * a reading typed before any input is known is refused with the reason.
     */
    measureSaveLevelCalibration() {
      const f = this.meas.levelForm;
      try {
        const referenceHz = Number(f.referenceHz);
        let observed;
        let input;
        let method;
        let conditions = f.conditions;
        if (f.manual) {
          if (!inputBinding(ops.inputKnown())) throw new Error(LEVEL_NEEDS_INPUT);
          observed = Number(f.observedDb === '' ? NaN : f.observedDb);
          input = ops.inputKnown();
          method = 'manual';
        } else {
          const ref = ctx.reference;
          if (!ref || !ref.reading.ok) {
            throw new Error('Capture the reference first (or enter the reading by hand under '
              + 'Advanced).');
          }
          if (ref.referenceHz !== referenceHz) {
            throw new Error(`The reference was captured at ${ref.referenceHz} Hz; capture it `
              + `again at ${referenceHz} Hz.`);
          }
          if (!inputBinding(ref.input)) {
            throw new Error('The capture did not report its input, so the reading could not be '
              + 'bound to it. Run the setup check, then capture the reference again.');
          }
          observed = ref.reading.observedDbRelative;
          input = ref.input;
          method = 'captured';
        }
        const label = ops.levelLabelNow(f.manual);
        if (label) {
          // The label is stored in front of the conditions as typed, never in place of a part
          // of them: text that does not fit beside it is refused with the limit that applies.
          const typed = typeof conditions === 'string' ? conditions.trim() : '';
          const room = ops.conditionsRoom(label);
          if (typed.length > room) {
            throw new Error(`Conditions can be at most ${room} characters in TEST CONTEXT (the `
              + `TEST CONTEXT label is stored with them); ${typed.length} were entered.`);
          }
          conditions = typed ? `${label} ${typed}` : label;
        }
        const cal = createLevelCalibration({
          referenceHz,
          referenceDbSpl: Number(f.referenceDb),
          observedDbRelative: observed,
          conditions,
          createdAt: new Date().toISOString(),
          method,
          input,
        });
        ctx.levelCal = cal;
        ctx.levelCalTest = !!label;
        this.meas.cal.level = { referenceHz: cal.referenceHz, referenceDb: cal.referenceDbSpl,
          observedDb: cal.observedDbRelative, offsetDb: cal.offsetDb, conditions: cal.conditions,
          method: cal.method, bound: isBoundLevelCalibration(cal),
          deviceKnown: !!(cal.input && cal.input.deviceId), testContext: !!label };
        this.meas.cal.useLevel = true;
        f.error = '';
        this.closeModal('osc-dlg-level-cal');
        if (ctx.me && ctx.me.state === S.READY) ctx.me.reset();
        ops.refresh();
        ops.rebuildAll();
        return true;
      } catch (err) {
        f.error = err.message || String(err);
        return false;
      }
    },
    measureClearLevelCalibration() {
      ops.clearLevelCalibration(this.meas);
      ops.refresh();
      ops.rebuildAll();
    },
    get measureFreqCalText() { return calText({ profile: this.meas.cal.profile }); },
    /**
     * How many characters the conditions field takes: the limit of a level calibration, less
     * the TEST CONTEXT label that is stored in front of them there (W7c).
     */
    get measureLevelConditionsMax() {
      // Read first, so the binding follows them (ctx is not reactive).
      const deps = [this.meas.levelForm.manual, this.meas.loopback, this.meas.levelForm.reading];
      return ops.conditionsRoom(ops.levelLabelNow(deps[0]));
    },
    /** Why a hand-typed reading cannot be stored now (no input known yet), or ''. */
    get measureLevelManualNote() {
      // meas.inputRows makes this getter follow the setup check (refresh()).
      return this.meas.levelForm.manual && this.meas.inputRows && !inputBinding(ops.inputKnown())
        ? LEVEL_NEEDS_INPUT : '';
    },
    /** The stored level calibration in words: how it was obtained and what it is bound to. */
    get measureLevelStateText() {
      const l = this.meas.cal.level;
      if (!l) return 'none: levels are relative (dBFS-like)';
      // Review F5 of #139: without a device id the binding is the rate and processing flags only.
      const far = l.deviceKnown ? '' : ' as far as the browser reports it (no device id: sample '
        + 'rate and processing only)';
      const how = l.method === 'captured'
        ? `captured, bound to the input it was captured with${far}`
        : `entered by hand, ${l.bound ? `bound to the input checked when it was stored${far}`
          : UNBOUND_TEXT}`;
      return `${l.testContext ? 'TEST CONTEXT ' : ''}reference reading stored (${how}; offset ${l.offsetDb >= 0 ? '+' : '−'}${
        Math.abs(l.offsetDb).toFixed(1)} dB at ${l.referenceHz} Hz)`;
    },
  };
}

export function measureProfilePart(ctx, svc, ops) {
  return {
    /** The loaded FrequencyProfile (closure object, not reactive) for experiment views. */
    measureCurrentProfile() { return ctx.profile; },
    /** The id of the frequency profile a measurement started now applies, or null. */
    measureAppliedProfileId() {
      return this.meas.cal.useFrequency && ctx.profile ? ctx.profile.id || null : null;
    },
  };
}
