// Microphone analyzer controller.
//
// The microphone is requested ONLY when the user presses "Use microphone" (getUserMedia with
// echo cancellation, noise suppression and AGC off). On failure the panel says why, as far as
// the browser tells (micUnavailableText: no secure context, no API, permission denied, no
// device). Toggling off, or the track ending (device unplugged, permission revoked), stops every
// track and disconnects the nodes.
//
// Views (shell tab 'mic'): Live Spectrum (mic in green vs generator target in blue, requested
// marker, peak marker), Spectrogram (of the mic), Compare (the same overlay with freeze,
// averaging and peak hold). Readouts: requested frequency; the detected frequency from
// estimateFrequency() (FFT peak with parabolic interpolation, autocorrelation below 1 kHz),
// rounded with displayStepHz() and shown with its ± uncertainty, never finer than the bin
// resolution; the relative (dBFS-like, uncalibrated) level; in Compare, the difference and
// verdict from compareFrequencies(). Nothing here is a calibrated measurement.
//
// Audio nodes: the engine owns them (audio-engine-discipline). adapter.attachMicrophone(stream)
// builds MediaStreamSource → Analyser inside the engine's accounting and returns the analyser;
// detachMicrophone() disconnects it. The graph is never connected to the output, so there is
// no feedback path. Without attachMicrophone the microphone is reported unavailable.

import { createSpectrumChart } from '../charts/spectrum-chart.js';
import { createSpectrogramView } from '../charts/spectrogram-view.js';
import {
  estimateFrequency,
  createPitchDetector,
  displayStepHz,
} from '../analysis/peak-detector.js';
import { compareFrequencies } from '../analysis/compare.js';
import { formatHz, formatHzStep, formatUncertainty } from '../charts/axes.js';
import { onFrame } from '../charts/frame-loop.js';
import { on, onUi, setText, setAttr, activeValue } from './dom.js';

export const MIC_UNAVAILABLE = 'Microphone unavailable here';

/**
 * The unavailable text for a failed start, from what the browser reports: e (the error, if
 * any) and env { secure (window.isSecureContext), hasApi (getUserMedia exists),
 * protocol (location.protocol) }.
 */
export function micUnavailableText(e, env = {}) {
  const name = e && e.name;
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return `${MIC_UNAVAILABLE} (permission denied)`;
  }
  if (name === 'NotFoundError' || name === 'OverconstrainedError') {
    return `${MIC_UNAVAILABLE} (no microphone found)`;
  }
  if (name === 'NotReadableError' || name === 'AbortError') {
    return `${MIC_UNAVAILABLE} (the device is busy or failed)`;
  }
  if (!env.hasApi) {
    if (env.secure === false) {
      return `${MIC_UNAVAILABLE} (needs a secure page, such as HTTPS)`;
    }
    if (env.protocol === 'file:') {
      return `${MIC_UNAVAILABLE} (this browser offers no microphone to local files)`;
    }
    return `${MIC_UNAVAILABLE} (this browser offers no microphone API)`;
  }
  return `${MIC_UNAVAILABLE} (the microphone could not be opened)`;
}
export const MIC_OFF = 'UNAVAILABLE (microphone off)';
export const MIC_NOTE = 'Not a calibrated measurement. Microphone frequency response varies.';
const READOUT_INTERVAL_MS = 100;
const MIC_FFT_SIZE = 8192;

/** Detected-frequency readout text from an estimate (or null) and an optional comparison. */
export function detectedText(est, cmp = null) {
  if (!est) return 'no clear peak (signal too weak or noisy)';
  const step = displayStepHz(est.uncertaintyHz);
  const level = Number.isFinite(est.levelDb)
    ? ` (relative level ${Math.round(est.levelDb)} dB)`
    : '';
  const f = formatHzStep(est.frequencyHz, step);
  let text = `${f} ${formatUncertainty(est.uncertaintyHz)}${level}`;
  if (cmp && cmp.diffHz != null) {
    const d = formatHzStep(cmp.diffHz, step);
    text += ` · Δ ${cmp.diffHz > 0 ? '+' : ''}${d}${cmp.label ? ` (${cmp.label})` : ''}`;
  }
  return text;
}

function makeToolbar(host, rootEl) {
  // Shell markup wins when present (status/labs.txt request); otherwise build it in the host.
  const existing = ['freeze', 'average', 'peakHold'].map((k) =>
    rootEl.querySelector(`[data-osc="mic.${k}"]`));
  if (existing.every(Boolean)) {
    const bar = existing[0].closest('[role="group"]') || existing[0].parentElement;
    return { bar, buttons: { freeze: existing[0], average: existing[1], peakHold: existing[2] } };
  }
  const bar = document.createElement('div');
  bar.className = 'osc-seg';
  bar.setAttribute('role', 'group');
  bar.setAttribute('aria-label', 'Compare options');
  Object.assign(bar.style, { position: 'absolute', top: '2px', right: '6px', zIndex: '3' });
  const mk = (key, label) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'osc-seg-btn';
    b.setAttribute('role', 'switch');
    b.setAttribute('aria-checked', 'false');
    b.dataset.osc = `mic.${key}`;
    b.textContent = label;
    bar.appendChild(b);
    return b;
  };
  const buttons = { freeze: mk('freeze', 'Freeze'), average: mk('average', 'Average'),
    peakHold: mk('peakHold', 'Peak hold') };
  bar.hidden = true;
  host.appendChild(bar);
  return { bar, buttons };
}

function layer(host) {
  const d = document.createElement('div');
  Object.assign(d.style, { position: 'absolute', inset: '0' });
  host.appendChild(d);
  return d;
}

/** mount(rootEl, adapter) → lab (see the return value). */
export function mount(rootEl, adapter) {
  const q = (sel) => rootEl.querySelector(sel);
  const toggle = q('#osc-mic-toggle');
  const host = q('#osc-chart-mic');
  const reqEl = q('#osc-mic-requested');
  const detEl = q('#osc-mic-detected');
  setText(q('.osc-mic-note'), MIC_NOTE);
  let tab = activeValue(rootEl, '[data-osc="mic.tab"]') || 'live';
  let stream = null;
  let attached = null;
  let starting = false;
  let error = '';
  let lastReadout = -Infinity;
  let pitch = null;
  let estimate = null;
  let comparison = null;
  const opts = { freeze: false, average: false, peakHold: false };

  const micAnalyser = () => (stream ? attached : null);
  const spectrumLayer = host ? layer(host) : null;
  const spgLayer = host ? layer(host) : null;
  if (spgLayer) spgLayer.hidden = true;
  const chart = spectrumLayer
    ? createSpectrumChart(spectrumLayer, {
      mode: 'dual',
      minDb: -80,
      legend: true,
      yLabel: null,
      // Reference geometry (mic panel): plot 15 px below the host top, 40 px from its left.
      yAxisSize: 40,
      xAxisSize: 32,
      xAxisGap: 14,
      padding: [15, 15, 0, 0],
      micOffText: 'Microphone off',
      getMicAnalyser: micAnalyser,
      getAnalyser: () => adapter.getAnalyser(),
      getRequested: () => adapter.requestedFrequency(),
    })
    : null;
  let spg = null;
  const toolbar = host ? makeToolbar(host, rootEl) : null;

  function applyView() {
    if (!host) return;
    const isSpg = tab === 'spectrogram';
    spectrumLayer.hidden = isSpg;
    spgLayer.hidden = !isSpg;
    if (isSpg && !spg) {
      spg = createSpectrogramView(spgLayer, {
        getAnalyser: micAnalyser,
        gutter: { left: 34, right: 6, top: 6, bottom: 17 },
        timeLabelGap: 5,
        tickFont: 9.5,
      });
    }
    if (spg) spg.setFreeze(!isSpg); // pause the hidden spectrogram
    toolbar.bar.hidden = tab !== 'compare';
    const compare = tab === 'compare';
    chart.setFreeze(compare && opts.freeze);
    chart.setAveraging(compare && opts.average ? 1 : 0);
    chart.setPeakHold(compare && opts.peakHold);
  }

  function setButton(on) {
    if (!toggle) return;
    setAttr(toggle, 'aria-pressed', on ? 'true' : 'false');
    setText(toggle, on ? 'Stop microphone' : 'Use microphone');
  }

  function releaseNodes() {
    if (attached && adapter.detachMicrophone) {
      try {
        adapter.detachMicrophone();
      } catch (e) {
        /* engine reports its own errors */
      }
    }
    attached = null;
  }

  function stop() {
    if (stream) {
      for (const t of stream.getTracks()) {
        t.onended = null;
        t.stop();
      }
    }
    stream = null;
    releaseNodes();
    estimate = null;
    comparison = null;
    pitch = null;
    if (chart) chart.setPeak(null);
    setButton(false);
    renderReadout(true);
  }

  async function start() {
    if (starting || stream) return;
    starting = true;
    // Pending: aria-disabled, never disabled, so a keyboard user keeps focus on the button.
    setAttr(toggle, 'aria-disabled', 'true');
    error = '';
    const md = typeof navigator !== 'undefined' ? navigator.mediaDevices : null;
    const env = {
      hasApi: !!(md && typeof md.getUserMedia === 'function'),
      secure: typeof window !== 'undefined' && 'isSecureContext' in window
        ? window.isSecureContext : undefined,
      protocol: typeof location !== 'undefined' ? location.protocol : '',
    };
    try {
      if (!env.hasApi) throw new Error('getUserMedia unavailable');
      if (!adapter.attachMicrophone) throw new Error('no engine microphone support');
      let ctx = adapter.getContext ? adapter.getContext() : null;
      if (!ctx && adapter.ensureContext) ctx = await adapter.ensureContext();
      if (!ctx) throw new Error('no AudioContext');
      const s = await md.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      });
      stream = s;
      for (const t of s.getAudioTracks()) t.onended = () => stop();
      // The engine builds and accounts the nodes (MediaStreamSource → Analyser, no output).
      attached = adapter.attachMicrophone(s, {
        fftSize: MIC_FFT_SIZE, smoothingTimeConstant: 0.5,
      }) || null;
      if (!attached) throw new Error('the engine could not attach the microphone');
      if (ctx.state === 'suspended' && typeof ctx.resume === 'function') {
        ctx.resume().catch(() => {});
      }
      setButton(true);
    } catch (e) {
      if (stream) stop();
      error = micUnavailableText(e, env);
      setButton(false);
    } finally {
      starting = false;
      setAttr(toggle, 'aria-disabled', 'false');
      renderReadout(true);
    }
  }

  function renderReadout(force = false) {
    const req = adapter.requestedFrequency ? adapter.requestedFrequency() : null;
    setText(reqEl, req > 0 ? formatHz(req) : '—');
    if (!stream) {
      setText(detEl, error || MIC_OFF);
      return;
    }
    if (!force && !estimate && !comparison) {
      setText(detEl, detectedText(null));
      return;
    }
    setText(detEl, detectedText(estimate, tab === 'compare' ? comparison : null));
  }

  function measure(now) {
    const an = micAnalyser();
    const reader = chart ? chart.readers.mic : null;
    if (!an || !reader) {
      estimate = null;
      return;
    }
    // The chart may be hidden (Spectrogram tab) and then does not read; the reader dedups
    // reads with the same timestamp, so this costs nothing when the chart already read.
    reader.readFrequency(now);
    const sr = an.context.sampleRate;
    if (!pitch || pitch.sampleRate !== sr) {
      pitch = { sampleRate: sr, detector: createPitchDetector({ sampleRate: sr }) };
    }
    const time = reader.readTime(now);
    const maxHz = Math.min(20000, (sr / 2) * 0.95);
    estimate = estimateFrequency({
      spectrumDb: reader.frequency,
      timeData: time,
      sampleRate: sr,
      fftSize: an.fftSize,
      pitchDetector: time.length >= pitch.detector.windowSize + pitch.detector.maxLag + 1
        ? pitch.detector
        : null,
      minHz: 20,
      maxHz,
    });
    const req = adapter.requestedFrequency ? adapter.requestedFrequency() : null;
    comparison = compareFrequencies({ requestedHz: req, observed: estimate, sampleRate: sr });
    if (chart) chart.setPeak(estimate ? { hz: estimate.frequencyHz, db: estimate.levelDb } : null);
  }

  const stopFrames = onFrame((now) => {
    if (now - lastReadout < READOUT_INTERVAL_MS) return;
    lastReadout = now;
    if (stream && !(tab === 'compare' && opts.freeze)) measure(now);
    renderReadout();
  });

  const offs = [
    stopFrames,
    on(toggle, 'click', () => (stream ? stop() : start())),
    onUi(rootEl, (d) => {
      if (d.kind === 'tab' && d.key === 'mic') {
        tab = d.value;
        applyView();
        renderReadout(true);
      } else if (d.kind === 'theme') {
        if (chart) chart.refreshTheme();
        if (spg) spg.refreshTheme();
      }
    }),
  ];
  if (toolbar) {
    for (const [key, b] of Object.entries(toolbar.buttons)) {
      offs.push(on(b, 'click', () => {
        opts[key] = !opts[key];
        setAttr(b, 'aria-checked', opts[key] ? 'true' : 'false');
        b.classList.toggle('is-active', opts[key]);
        applyView();
      }));
    }
  }
  applyView();
  setButton(false);
  renderReadout(true);

  return {
    chart,
    get active() {
      return !!stream;
    },
    get error() {
      return error;
    },
    get estimate() {
      return estimate ? { ...estimate } : null;
    },
    get comparison() {
      return comparison ? { ...comparison } : null;
    },
    get stream() {
      return stream;
    },
    get analyser() {
      return micAnalyser();
    },
    start,
    stop,
    update(state = {}) {
      if (state.compare) Object.assign(opts, state.compare);
      applyView();
      renderReadout(true);
    },
    dispose() {
      offs.forEach((f) => f());
      stop();
      if (chart) chart.dispose();
      if (spg) spg.dispose();
    },
  };
}
