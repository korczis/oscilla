// Export helpers: file download, canvas screenshot (PNG via toBlob, no html2canvas) and WAV
// rendering of the current configuration.
//
// WAV of the current tone/pattern: the real plan (patterns.js buildPlan) is played by a second
// AudioEngine instance running on an OfflineAudioContext created by audio/offline-renderer.js
// render(), with the same play options as live playback (ADSR, filter insert, PeriodicWave,
// stereo router), so the file is what the instrument plays — limiter and trim included. The
// engine's own analyser chain ends in the offline destination. Open patterns render as a
// TRIGGER (trigger duration, capped by the hard safety limit unless continuous playback is
// allowed); finite patterns render their programmed length.
// WAV of the sequence: sequencer/compiler.js renderSequenceOffline at the same level.

import { AudioEngine } from '../audio/audio-engine.js';
import { render, bufferStats } from '../audio/offline-renderer.js';
import { encodeWav } from '../audio/wav.js';
import { renderSequenceOffline } from '../sequencer/compiler.js';
import { START_OFFSET_S } from '../core/constants.js';

export const EXPORT_MAX_S = 60;
const TAIL_S = 0.15;

/** Trigger a browser download of a Blob. Works from file:// (object URL + <a download>). */
export function downloadBlob(blob, fileName, doc = document) {
  const url = URL.createObjectURL(blob);
  const a = doc.createElement('a');
  a.href = url;
  a.download = fileName;
  a.rel = 'noopener';
  a.style.display = 'none';
  doc.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

/** canvas.toBlob as a promise. */
export function canvasToBlob(canvas, type = 'image/png') {
  return new Promise((resolve, reject) => {
    try {
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('The canvas could not be encoded.'))),
        type);
    } catch (e) {
      reject(e);
    }
  });
}

function visibleCanvases(root) {
  return [...root.querySelectorAll('canvas')].filter((c) => {
    if (!c.width || !c.height) return false;
    const r = c.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return false;
    return c.offsetParent !== null || getComputedStyle(c).position === 'fixed';
  });
}

/**
 * Composite every visible canvas inside `root` (at their on-screen positions, at the device
 * pixel ratio) onto one canvas over `background`, then PNG-encode it. Returns
 * { blob, width, height, count }; throws when nothing is drawn there.
 */
export async function screenshotCanvases(root, { background = '#020a16', title = '' } = {}) {
  const list = visibleCanvases(root);
  if (!list.length) throw new Error('No chart is visible to capture.');
  const box = root.getBoundingClientRect();
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const out = document.createElement('canvas');
  out.width = Math.max(1, Math.round(box.width * dpr));
  out.height = Math.max(1, Math.round(box.height * dpr));
  const g = out.getContext('2d');
  g.fillStyle = background;
  g.fillRect(0, 0, out.width, out.height);
  for (const c of list) {
    const r = c.getBoundingClientRect();
    try {
      g.drawImage(c, (r.left - box.left) * dpr, (r.top - box.top) * dpr, r.width * dpr,
        r.height * dpr);
    } catch (e) { /* a tainted or lost canvas is skipped */ }
  }
  if (title) {
    g.fillStyle = 'rgba(255,255,255,0.7)';
    g.font = `${Math.round(11 * dpr)}px system-ui, sans-serif`;
    g.fillText(title, 8 * dpr, out.height - 8 * dpr);
  }
  const blob = await canvasToBlob(out);
  return { blob, width: out.width, height: out.height, count: list.length };
}

/**
 * The render length (s) of a plan played as TRIGGER with these options, or an error message.
 * o: the engine play options ({ mode, continuous, limitS, durationS, releaseS, adsr }).
 */
export function renderLengthFor(plan, o) {
  if (!plan) return { error: 'Nothing to render.' };
  let len;
  if (plan.kind === 'finite' && Number.isFinite(plan.dur)) {
    len = plan.dur;
    // a limitable finite tone longer than the hard limit plays only limitS (the engine caps it)
    if (plan.limitable && !o.continuous && o.limitS > 0 && len > o.limitS) len = o.limitS;
  } else {
    // open patterns and kind 'continuous' (dur Infinity): an open-length render
    len = o.durationS;
    if (!o.continuous && !(len <= o.limitS)) len = o.limitS;
  }
  if (!(len > 0)) return { error: 'The pattern has no finite length to render.' };
  const total = START_OFFSET_S + len + TAIL_S;
  if (total > EXPORT_MAX_S) {
    return { error: `The pattern lasts ${len.toFixed(1)} s; exports are limited to ${EXPORT_MAX_S} s.` };
  }
  return { seconds: total };
}

/**
 * Render a plan through an AudioEngine on an OfflineAudioContext.
 * opts: { plan, playOptions (engine.play options: durationS, limitS, continuous, …), gain,
 *         sampleRate, channels = 2, OfflineAudioContext?, extraOptions?(ctx) -> V2 hooks built
 *         on the offline ctx (ADSR, inserts, periodicWave, dualRouter), decorate?(engine, ctx) }
 * Returns { buffer, wav: ArrayBuffer, stats, seconds }.
 */
export async function renderPlanToWav(opts) {
  const { plan, gain, sampleRate } = opts;
  const o = { ...opts.playOptions, mode: 'trigger' };
  const len = renderLengthFor(plan, o);
  if (len.error) throw new Error(len.error);
  let offlineEngine = null;
  const buffer = await render((ctx) => {
    const env = {
      AudioContext: function OfflineAsRealtime() { return ctx; },
      setTimeout: () => 0,
      clearTimeout: () => {},
      navigator: typeof navigator !== 'undefined' ? navigator : undefined,
    };
    offlineEngine = new AudioEngine({ env });
    if (!offlineEngine.init()) throw new Error(offlineEngine.lastError?.message || 'Render failed.');
    offlineEngine.master.gain.value = gain;
    if (opts.decorate) opts.decorate(offlineEngine, ctx);
    const extra = opts.extraOptions ? opts.extraOptions(ctx) : {};
    const info = offlineEngine.play(plan, { ...o, ...extra, mode: 'trigger' });
    if (!info) throw new Error(offlineEngine.lastError?.message || 'The pattern could not be rendered.');
  }, {
    duration: len.seconds,
    sampleRate,
    channels: opts.channels || 2,
    OfflineAudioContext: opts.OfflineAudioContext,
    maxDuration: EXPORT_MAX_S,
  });
  const wav = encodeWav(buffer, { bitDepth: 16 });
  return { buffer, wav, stats: bufferStats(buffer), seconds: len.seconds };
}

/** Render a sequencer model at `level` (the master gain) → { buffer, wav, stats }. */
export async function renderSequenceToWav(model, { sampleRate, level, waveform, OfflineCtor }) {
  const Ctor = OfflineCtor || window.OfflineAudioContext || window.webkitOfflineAudioContext;
  if (!Ctor) throw new Error('OfflineAudioContext is not available in this browser.');
  const { buffer } = await renderSequenceOffline(model, Ctor, {
    sampleRate, numberOfChannels: 2, tailS: TAIL_S, level, waveform,
  });
  if (buffer.duration > EXPORT_MAX_S + 1) {
    throw new Error(`The sequence lasts ${buffer.duration.toFixed(1)} s; exports are limited to `
      + `${EXPORT_MAX_S} s.`);
  }
  return { buffer, wav: encodeWav(buffer, { bitDepth: 16 }), stats: bufferStats(buffer) };
}

/** Read a File/Blob as text (FileReader; works from file://). */
export function readFileText(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error || new Error('The file could not be read.'));
    r.readAsText(file);
  });
}
