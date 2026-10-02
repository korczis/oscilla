// Device & Limits panel: sample rate, Nyquist and safe maximum from the running AudioContext,
// and the output device only as far as the browser reveals it. Never fabricated: without a
// context the metrics stay "—"; without permitted, non-empty device labels the output reads
// "Default audio output".

import { formatHzGrouped } from './axes.js';
import { setText, onAdapterChange, on } from '../labs/dom.js';

export const SAFE_NYQUIST_FACTOR = 0.95;
export const DEFAULT_OUTPUT_LABEL = 'Default audio output';

/** { sampleRate, nyquist, safeMax } from a sample rate, or nulls. */
export function deviceLimits(sampleRate) {
  if (!(sampleRate > 0)) return { sampleRate: null, nyquist: null, safeMax: null };
  return {
    sampleRate,
    nyquist: sampleRate / 2,
    safeMax: (sampleRate / 2) * SAFE_NYQUIST_FACTOR,
  };
}

/**
 * Output device label from what the browser gives: the AudioContext sinkId (when supported)
 * matched against enumerateDevices() audiooutput entries with non-empty labels.
 * devices: MediaDeviceInfo[]; sinkId: string | object | undefined.
 */
export function outputLabel(devices, sinkId) {
  const outs = (devices || []).filter((d) => d.kind === 'audiooutput' && d.label);
  if (typeof sinkId === 'string' && sinkId) {
    const match = outs.find((d) => d.deviceId === sinkId);
    return match ? match.label : DEFAULT_OUTPUT_LABEL;
  }
  if (sinkId && typeof sinkId === 'object' && sinkId.type === 'none') {
    return 'No output (silent sink)';
  }
  const def = outs.find((d) => d.deviceId === 'default');
  if (def) return def.label.replace(/^Default\s*-\s*/i, '');
  return DEFAULT_OUTPUT_LABEL;
}

/** mount(rootEl, adapter) → { update(state), dispose(), refresh() } */
export function mount(rootEl, adapter) {
  const srEl = rootEl.querySelector('#osc-dev-sr');
  const nyEl = rootEl.querySelector('#osc-dev-nyquist');
  const safeEl = rootEl.querySelector('#osc-dev-safemax');
  const outEl = rootEl.querySelector('#osc-dev-output');
  let disposed = false;
  let seq = 0;

  function currentRate() {
    const sr = adapter.getSampleRate ? adapter.getSampleRate() : null;
    if (sr > 0) return sr;
    const ctx = adapter.getContext ? adapter.getContext() : null;
    return ctx ? ctx.sampleRate : null;
  }

  async function refreshOutput() {
    const my = ++seq;
    const ctx = adapter.getContext ? adapter.getContext() : null;
    const sinkId = ctx && 'sinkId' in ctx ? ctx.sinkId : undefined;
    let devices = [];
    const md = typeof navigator !== 'undefined' ? navigator.mediaDevices : null;
    if (md && typeof md.enumerateDevices === 'function') {
      try {
        devices = await md.enumerateDevices();
      } catch (e) {
        devices = [];
      }
    }
    if (disposed || my !== seq) return;
    setText(outEl, outputLabel(devices, sinkId));
  }

  function refresh() {
    const lim = deviceLimits(currentRate());
    setText(srEl, lim.sampleRate ? formatHzGrouped(lim.sampleRate) : '—');
    setText(nyEl, lim.nyquist ? formatHzGrouped(lim.nyquist) : '—');
    setText(safeEl, lim.safeMax ? formatHzGrouped(lim.safeMax) : '—');
    refreshOutput();
  }

  const md = typeof navigator !== 'undefined' ? navigator.mediaDevices : null;
  const offDevice = md && md.addEventListener ? on(md, 'devicechange', refreshOutput) : () => {};
  let offSink = () => {};
  let sinkCtx = null;
  const watchSink = () => {
    const ctx = adapter.getContext ? adapter.getContext() : null;
    if (ctx === sinkCtx) return;
    offSink();
    sinkCtx = ctx;
    offSink = ctx && 'onsinkchange' in ctx ? on(ctx, 'sinkchange', refreshOutput) : () => {};
  };
  const offAdapter = onAdapterChange(adapter, () => {
    watchSink();
    refresh();
  });
  watchSink();
  refresh();

  return {
    refresh,
    update() {
      watchSink();
      refresh();
    },
    dispose() {
      disposed = true;
      offDevice();
      offSink();
      offAdapter();
    },
  };
}
