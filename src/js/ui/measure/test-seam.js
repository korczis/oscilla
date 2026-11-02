// MEASURE workspace (src/js/ui/measure.js): the test seam window.OSCILLA.measure (ADR 0052). Its
// key list is pinned by tests/browser/app.cjs `seam-surface-pinned`.

import { MEASUREMENT_STATES as S, isActiveState } from '../../measurement/state-machine.js';
import {
  encodeRecipeLink, decodeRecipeLink, recipeLinkFields,
} from '../../core/url-state-measure.js';
import { FIELD_DEFAULTS, RECIPE_FIELD_IDS, recipeValues } from './constants.js';


export function measureTestSeamPart(ctx, svc, ops) {
  return {
    // ------------------------------------------------------------------ test seam
    // window.OSCILLA.measure (ADR 0052). Every member is one of three kinds: it OBSERVES (the
    // getters, counts(), liveRta()); it DRIVES an action a user already has, through the user's
    // validation (useLoopback and useMicrophone = the TEST CONTEXT choice of the Input device
    // list, setValues = a recipe link); or it INJECTS, and then only as TEST CONTEXT:
    // setInputNow only while the page is in loopback, showResult only a result that carries a
    // testContext. What they inject stays in TEST CONTEXT: an input named there is not a
    // checked input on the microphone, and a level calibration made there does not apply
    // outside it (inputKnown, levelApplies; ledger W7f). The key list is pinned by
    // tests/browser/app.cjs `seam-surface-pinned`.
    measureTestSeam() {
      const self = this;
      const newEngine = () => {
        ops.stopLive();
        ops.disposeEngine();
        ops.renderInputs();
        ops.refresh();
      };
      return {
        get state() { return ctx.me ? ctx.me.state : S.IDLE; },
        get engine() { return ctx.me; },
        get io() { return ctx.io; },
        get ioKind() { return ctx.ioKind; },
        get result() { return ctx.result; },
        get history() { return ctx.me ? ctx.me.history.map((h) => h.to) : []; },
        /**
         * Drive: enter TEST CONTEXT, as the Input device choice does (setTestContext); `system`
         * replaces the synthetic system. Already in it: a new engine, nothing else changes.
         */
        useLoopback(system = null) {
          if (ops.inputInUse(self) || (ctx.me && isActiveState(ctx.me.state))) return false;
          if (system) ctx.loopbackSystem = system;
          if (!ctx.loopback) ops.setTestContext(self, true);
          else newEngine();
          return true;
        },
        /** Drive: leave TEST CONTEXT, as choosing an input does: what was made in it is cleared. */
        useMicrophone() {
          if (ops.inputInUse(self) || (ctx.me && isActiveState(ctx.me.state))) return false;
          if (ctx.loopback) ops.setTestContext(self, false);
          else newEngine();
          return true;
        },
        /**
         * Test hook: run `fn` once, synchronously, when the engine enters `state` (abort at an
         * exact stage without timing races). Returns a promise of { state, ran }.
         */
        onceInState(state, fn) {
          return new Promise((resolve) => {
            ctx.onStateHook = (to) => {
              if (to !== state) return;
              ctx.onStateHook = null;
              // After the engine's own transition has finished (no re-entrant abort).
              queueMicrotask(() => {
                let ran = true;
                try { fn(); } catch (err) { ran = String(err && err.message); }
                resolve({ state: to, ran, now: ctx.me ? ctx.me.state : null });
              });
            };
          });
        },
        clearStateHook() { ctx.onStateHook = null; },
        get live() { return { ...self.meas.live }; },
        /**
         * Drive: set recipe values (field id → value) as a recipe link does. The whole call is
         * refused with { ok: false, errors } for a key that is not a recipe field, a value
         * outside its field's range, or while a measurement runs; otherwise it returns true, and
         * a READY setup check is reset as by any edit. No toast, and no link state changes.
         */
        setValues(values) {
          const given = values && typeof values === 'object' ? Object.keys(values) : null;
          const unknown = given ? given.filter((k) => !RECIPE_FIELD_IDS.includes(k)) : [];
          if (!given || unknown.length) {
            return { ok: false, errors: given ? unknown.map((k) => `unknown recipe field `
              + `"${String(k).slice(0, 20)}"`) : ['the values must be an object'] };
          }
          // A toggle takes true or false only: the link encoding would coerce anything else,
          // as the page's own switch does, and a caller's mistake would pass as a value (W7h).
          const fields = recipeLinkFields();
          const notBoolean = given.filter((k) => fields[k] && fields[k].kind === 'toggle'
            && typeof values[k] !== 'boolean');
          if (notBoolean.length) {
            return { ok: false, errors: notBoolean.map((k) => `${fields[k].label}: must be true `
              + 'or false') };
          }
          const r = decodeRecipeLink(encodeRecipeLink(recipeValues({ ...self.meas.values,
            ...values })), { defaults: recipeValues(FIELD_DEFAULTS) });
          if (!r.ok) return { ok: false, errors: r.errors };
          const applied = ops.applyRecipeValues(self, r.values);
          return applied.ok ? true : applied;
        },
        counts() {
          const io = ctx.io;
          return {
            engineNodes: svc.engine.activeNodeCount,
            ioNodes: io ? io.activeNodeCount : 0,
            ioSources: io ? io.activeSourceCount : 0,
            captures: io ? io.activeCaptureCount : 0,
            ports: io ? io.openPortCount : 0,
            tracks: io ? io.openTrackCount : 0,
            liveTap: io ? io.liveTapOpen : false,
            liveLoop: ctx.live && ctx.live.off ? 1 : 0,
          };
        },
        /** The live RTA's current frame as plain data (null when it is not running). */
        liveRta() {
          const L = ctx.live;
          if (!L) return null;
          const f = L.rta.frame;
          const fin = (v) => (Number.isFinite(v) ? v : null);
          return { mode: f.mode, averaging: L.rta.averaging, frozen: L.rta.frozen,
            frames: f.frames, sampleRate: L.rta.sampleRate, fftSize: L.rta.fftSize,
            window: L.rta.window, analyserFftSize: L.tap.analyser.fftSize,
            calibrated: { ...f.calibrated }, kind: L.kind,
            bands: f.bands ? f.bands.map((b) => b.nominal) : null,
            frequencies: f.frequencies ? Array.from(f.frequencies) : null,
            values: Array.from(f.values, fin), peaks: Array.from(f.peaks, fin),
            underResolved: f.underResolved ? f.underResolved.slice() : null };
        },
        /** rta.js rtaResult of the live bands (what an explicit snapshot would store). */
        liveRtaSnapshot() {
          const r = ctx.live ? ctx.live.rta.snapshot() : null;
          return r ? { ...r, levelsDb: Array.from(r.levelsDb) } : null;
        },
        experimentFromResult: () => (ctx.result ? ops.experimentOf(ctx.result, self) : null),
        get levelCalibration() { return ctx.levelCal; },
        /** The input checked in the context the page is in (null: none is known). */
        get inputNow() { return ops.inputKnown(); },
        get reference() { return ctx.reference; },
        get referenceCapturing() { return !!ctx.refCapture; },
        /**
         * Test hook (TEST CONTEXT only): the current input, as a preflight would report it.
         * Refused (false) unless the page is in TEST CONTEXT loopback: a level calibration binds
         * to this input, and outside TEST CONTEXT only a real setup check may name one. The
         * input it names is a TEST CONTEXT input and is not known once the page leaves it.
         */
        setInputNow(input) {
          if (!ctx.loopback) return false;
          ops.nameInput(input, true);
          ops.refresh();
          return true;
        },
        /**
         * Test hook: show a TEST CONTEXT engine-like result; a result without testContext is
         * refused (false), never shown as a measurement.
         */
        showResult(result) {
          if (!result || !result.testContext) return false;
          ops.showResult(result);
          ops.refresh();
          return true;
        },
        get responseView() { return ctx.charts.response ? ctx.charts.response.view : null; },
        /** The chosen input (raw id, page only) and the one the current io was opened with. */
        get deviceId() { return ctx.deviceId; },
        get ioDeviceId() { return ctx.ioDeviceId; },
        refreshInputs: () => ops.refreshInputs(),
        get irView() { return ctx.charts.ir ? ctx.charts.ir.view : null; },
      };
    },
  };
}
