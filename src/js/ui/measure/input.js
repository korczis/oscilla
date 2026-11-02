// MEASURE workspace (src/js/ui/measure.js): the input device list (V322) and the TEST CONTEXT
// transition (ledger W7b, ADR 0052): the one place that enters or leaves the digital loopback
// and clears what was made on the side that is left.

import { MEASUREMENT_STATES as S } from '../../measurement/state-machine.js';
import { hasMicrophoneApi } from '../../audio/microphone.js';
import { initialQualityBar } from '../../measurement/views/quality-bar.js';
import { initialAnnouncements } from '../../measurement/views/announcements.js';
import {
  inputDeviceView, TEST_CONTEXT_INPUT_VALUE,
} from '../../measurement/views/input-devices.js';

/** The input functions over `ctx`; `ops` holds those of the other parts. */
export function createInput(ctx, svc, ops) {
  // ---------------------------------------------------------------- input device (V322)
  function mediaDevices() {
    try {
      const md = typeof navigator !== 'undefined' ? navigator.mediaDevices : null;
      return md && typeof md.enumerateDevices === 'function' ? md : null;
    } catch (e) {
      return null;
    }
  }

  function renderInputs() {
    const cmp = ctx.cmp;
    if (!cmp) return;
    const v = inputDeviceView({ devices: ctx.devices, selectedId: ctx.deviceId,
      selectedLabel: ctx.deviceLabel, enumerated: ctx.devicesEnumerated, loopback: ctx.loopback,
      available: !!mediaDevices() });
    cmp.meas.input = { options: v.options, selected: v.selected, missing: v.missing,
      message: v.message, status: v.status };
  }

  /** List the inputs (after the permission); announce a chosen input that disappeared. */
  async function refreshInputs() {
    const md = mediaDevices();
    if (!md || !ctx.cmp) {
      renderInputs();
      return false;
    }
    let list;
    try {
      list = await md.enumerateDevices();
    } catch (e) {
      renderInputs();
      return false;
    }
    ctx.devices = Array.from(list || [], (d) => ({ kind: d.kind, deviceId: d.deviceId,
      label: d.label }));
    ctx.devicesEnumerated = true;
    const wasMissing = !!ctx.cmp.meas.input.missing;
    renderInputs();
    const m = ctx.cmp.meas.input;
    if (m.missing && !wasMissing) ops.announce({ politeness: 'assertive', text: m.message });
    return true;
  }

  /** The microphone was opened (permission granted): the list can be read now. */
  function inputOpened(device) {
    if (ctx.ioKind !== 'microphone') return;
    if (ctx.deviceId && device && device.label) ctx.deviceLabel = device.label;
    refreshInputs();
  }

  // ---------------------------------------------------------------- TEST CONTEXT (W7b)
  function microphoneAvailable() {
    return hasMicrophoneApi(typeof navigator !== 'undefined' ? navigator : null);
  }

  /** Keep `?measure=loopback` in the address in step with the choice made in the page. */
  function syncContextUrl(on) {
    try {
      const url = new URL(window.location.href);
      if ((url.searchParams.get('measure') === 'loopback') === on) return;
      if (on) url.searchParams.set('measure', 'loopback');
      else url.searchParams.delete('measure');
      window.history.replaceState(window.history.state, '', url.href);
    } catch (e) { /* no window (unit tests), or an address the browser does not rewrite */ }
  }

  /**
   * Something uses the input: a measurement, a setup check that is running, or a reference
   * capture. The one refusal of the Input device choice and of the seam's useLoopback /
   * useMicrophone, so that the seam drives no transition the page refuses.
   */
  function inputInUse(cmp) {
    return !!(cmp.meas.busy || ctx.refCapture || ctx.pending);
  }

  /**
   * Enter or leave TEST CONTEXT, the digital loopback (ledger W7b, ADR 0052): the one
   * transition behind the Input device choice and the seam's useLoopback / useMicrophone. The
   * caller has checked that nothing runs (inputInUse).
   *
   * Nothing made on one side is read as the other side's (review of #167 and of #169; owner
   * decision of 2026-10-11). In both directions the engine and its input are released, so
   * nothing checked or captured before the switch is known after it: the input check (the
   * input facts a level calibration binds to), a captured reference reading, the live RTA, a
   * pending repeat link and the outcome in the assertive live region end; and the result of
   * the side that is left, COMPLETE or INVALID, goes with its evidence, save state and
   * noise-check snapshot (a saved experiment of it stays in Experiments, labelled, and a saved
   * experiment that is shown stays: it is a stored record with its own label). Where a result
   * was produced is recorded when it is shown (ctx.resultTest), not read off its label: an
   * INVALID result has no view that would carry one. A level calibration is kept on either
   * side: one made in the other context reads UNCALIBRATED with the reason (levelApplies) and
   * applies again in its own context once its input is checked there.
   *
   * Returns what was cleared, in words ([] when there was nothing).
   */
  function setTestContext(cmp, on) {
    const m = cmp.meas;
    const cleared = [];
    ops.stopLive();
    if (ctx.result) {
      const tc = ctx.resultTest || !!ctx.result.testContext;
      const noise = ctx.result.noise ? ' and its noise check' : '';
      if (ctx.result.state === S.INVALID) {
        cleared.push(tc ? `the invalid TEST CONTEXT result${noise}`
          : `the invalid result of the previous input${noise}`);
      } else if (m.saved) {
        cleared.push(`${tc ? 'the TEST CONTEXT result' : 'the result of the previous input'} `
          + 'shown (its saved experiment is kept)');
      } else {
        cleared.push(tc ? 'the unsaved TEST CONTEXT result'
          : 'the unsaved result of the previous input');
      }
      ctx.result = null;
      ctx.resultTest = false;
      ctx.evidence = null;
      ctx.save = null;
      if (ctx.shown && ctx.shown.kind === 'result') ctx.shown = null;
      Object.assign(m, { saved: false, savedId: null, savedAnnotation: null, savedName: null });
    }
    if (!on && (ctx.inputNow || ctx.preflight)) cleared.push('the input check');
    // A stored noise-check snapshot (its peak hold spans checks) goes with its result.
    ctx.rta = null;
    // The next Start on this side repeats nothing made on the other (provenance.repeatOf).
    ctx.repeatOf = null;
    m.live.assertive = ''; // the outcome said for the other side's check or measurement
    ops.nameInput(null);
    ctx.preflight = null;
    ctx.noise = null;
    ctx.progress = null;
    ctx.error = null;
    ctx.reference = null; // a captured reference belongs to the input that is gone
    m.levelForm.reading = null;
    ctx.loopback = !!on;
    m.loopback = !!on;
    m.rtaLive.available = !!on || microphoneAvailable();
    if (ctx.me && ctx.me.state === S.READY) ctx.me.reset(); // releases the checked input
    ops.disposeEngine();
    ctx.bar = initialQualityBar();
    ctx.said = initialAnnouncements();
    renderInputs();
    ops.refresh();
    ops.rebuildAll();
    return cleared;
  }

  function selectInput(cmp, raw) {
    const value = typeof raw === 'string' ? raw : '';
    const toTest = value === TEST_CONTEXT_INPUT_VALUE;
    if (toTest ? ctx.loopback : !ctx.loopback && value === (ctx.deviceId || '')) return true;
    if (inputInUse(cmp)) {
      cmp.notify('warning', 'Input not changed', 'A measurement or a reference capture is using '
        + 'the input; stop it before choosing another input.');
      renderInputs(); // the select shows the input still in use
      return false;
    }
    if (toTest) {
      const cleared = setTestContext(cmp, true);
      syncContextUrl(true);
      ops.announce({ politeness: 'polite', text: 'TEST CONTEXT: digital loopback, no microphone '
        + 'and no acoustic path. Results test the software, not a physical setup.'
        + (cleared.length ? ` Cleared: ${cleared.join('; ')}.` : '') });
      // Not only for a screen reader: an unsaved measurement may be what went (as leaving).
      if (cleared.length) {
        cmp.notify('info', 'Entered TEST CONTEXT', 'Cleared, so that nothing from before is '
          + `read as the digital loopback's: ${cleared.join('; ')}.`);
      }
      return true;
    }
    const opt = cmp.meas.input.options.find((o) => o.value === value);
    if (!opt || opt.testContext) {
      renderInputs();
      return false;
    }
    const label = value ? opt.label.replace(/ — not available$/, '') : null;
    if (ctx.loopback) {
      ctx.deviceId = value || null;
      ctx.deviceLabel = label;
      const cleared = setTestContext(cmp, false);
      syncContextUrl(false);
      const what = cleared.length ? ` Cleared: ${cleared.join('; ')}.` : '';
      ops.announce({ politeness: 'polite', text: `Left TEST CONTEXT. Input: ${label
        || 'default input'}.${what} Run the setup check for this input.` });
      if (cleared.length) {
        cmp.notify('info', 'Left TEST CONTEXT', 'Cleared, so that nothing from the digital '
          + `loopback is read as this input's: ${cleared.join('; ')}.`);
      }
      return true;
    }
    ops.stopLive(); // the live RTA listens to the previous input
    if (ctx.me && ctx.me.state === S.READY) ctx.me.reset(); // releases the checked input
    ctx.deviceId = value || null;
    ctx.deviceLabel = label;
    ops.nameInput(null); // a level calibration is checked against the new input first (M3)
    ctx.preflight = null;
    renderInputs();
    ops.refresh();
    ops.announce({ politeness: 'polite', text: `Input: ${value ? ctx.deviceLabel
      : 'default input'}. Run the setup check for this input.` });
    return true;
  }

  return {
    mediaDevices, renderInputs, refreshInputs, inputOpened, microphoneAvailable, syncContextUrl,
    inputInUse, setTestContext, selectInput,
  };
}
