// Spectrogram view: mounts analysis/spectrogram.js createSpectrogram() into a chart host with an
// overlay canvas for the axes (log or linear frequency on y, elapsed time on x). The colour LUT
// comes from the design tokens (theme.js lutStops). Data: an AnalyserNode reader; without an
// analyser nothing is drawn (the canvas stays at the floor colour) — no noise is ever invented.
// Feed: 'analyser' (default; getFloatFrequencyData with the node's smoothing) or 'unsmoothed'
// (from readTime, analysis/spectrogram.js createSpectrogramFeed), which sits beside it until a
// UI choice between them exists (K015). Hover: a cursor line and the readout of the newest
// column at that row (bin, frequency, dB relative), drawn on the axes canvas; the level is never
// calibrated here, so it is always RELATIVE_UNIT. The axes canvas is sized in layout() only:
// the frame and pointer paths redraw it from the cached size and never touch the DOM.

import { createSpectrogram, createSpectrogramFeed } from '../analysis/spectrogram.js';
import { createAnalyserReader } from '../analysis/analyser.js';
import {
  frequencyTicks,
  formatHzTick,
  formatSecondsTick,
  timeTickStep,
  axisFraction,
} from './axes.js';
import { chartTheme, canvasFont, fitCanvas, observeSize, pixelRatio } from './chart-theme.js';
import { onFrame } from './frame-loop.js';
import { formatDb, formatFrequencyWithResolution } from '../measurement/format.js';

const DEFAULTS = {
  minHz: 20,
  maxHz: 20000,
  scale: 'log',
  minDb: -100,
  maxDb: 0,
  timeSpanS: 10,
  gutter: { left: 40, right: 3, top: 5, bottom: 28 }, // reference: labels 16 px under the plot
  timeLabelGap: 10,
  tickFont: 10.5,
  autoFrame: true,
  feed: 'analyser',
};

/**
 * readoutLines(readout) → [frequency line, level line] for a renderer.readout() result: the
 * bin read, its centre frequency at bin resolution and "newest column", then its dB relative
 * (formatDb); without data, the row's frequency and "No analyser data".
 */
export function readoutLines(r) {
  if (r.bin == null || r.db == null) {
    return [`${formatFrequencyWithResolution(r.rowHz, r.binHz)} (row)`, 'No analyser data'];
  }
  const f = formatFrequencyWithResolution(r.frequencyHz, r.binHz);
  return [`${f} \u00b7 bin ${r.bin} \u00b7 newest column`, formatDb(r.db)];
}

/** theme.lutStops [{ pos, rgb }] → createSpectrogram stops [{ at, color }]. */
export function lutStopsFromTheme(theme) {
  return (theme.lutStops || []).map((s) => ({ at: s.pos, color: s.rgb }));
}

/**
 * createSpectrogramView(host, { getAnalyser, … DEFAULTS }) → view
 *   view.setFreeze(on), setTimeSpan(s), setScale('log'|'linear'), setMaxHz(hz), frame(now),
 *   refreshTheme(), spectrogram (the renderer), plotRect, dispose()
 */
export function createSpectrogramView(host, options = {}) {
  const o = { ...DEFAULTS, ...options, gutter: { ...DEFAULTS.gutter, ...(options.gutter || {}) } };
  const axes = document.createElement('canvas');
  const plot = document.createElement('canvas');
  axes.setAttribute('aria-hidden', 'true');
  plot.setAttribute('aria-hidden', 'true');
  Object.assign(axes.style, { position: 'absolute', left: '0', top: '0' });
  Object.assign(plot.style, { position: 'absolute' });
  host.appendChild(plot);
  host.appendChild(axes);
  let theme = chartTheme();
  let spg = null;
  let node = null;
  let reader = null;
  let feed = null;
  let cursorY = null; // CSS px from the plot top while the pointer is over the plot
  let frozen = false;
  let rect = { x: 0, y: 0, w: 1, h: 1 };
  let box = { w: 1, h: 1, dpr: 1 }; // the axes canvas size (CSS px), set by layout() only
  let sampleRate = 0;

  function effectiveMaxHz() {
    return sampleRate > 0 ? Math.min(o.maxHz, sampleRate / 2) : o.maxHz;
  }

  function effectiveMinHz() {
    return o.scale === 'log' ? o.minHz : 0;
  }

  function layout() {
    const w = host.clientWidth;
    const h = host.clientHeight;
    const g = o.gutter;
    rect = {
      x: g.left,
      y: g.top,
      w: Math.max(1, w - g.left - g.right),
      h: Math.max(1, h - g.top - g.bottom),
    };
    const dpr = pixelRatio();
    plot.style.left = `${rect.x}px`;
    plot.style.top = `${rect.y}px`;
    plot.style.width = `${rect.w}px`;
    plot.style.height = `${rect.h}px`;
    plot.width = Math.round(rect.w * dpr);
    plot.height = Math.round(rect.h * dpr);
    if (spg) spg.resize();
    box = fitCanvas(axes, w, h);
    drawAxes();
  }

  function drawAxes() {
    const { w, h, dpr } = box;
    const ctx = axes.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.font = canvasFont(theme, o.tickFont);
    ctx.fillStyle = theme.textMuted;
    ctx.strokeStyle = theme.textDim;
    ctx.lineWidth = 1;
    // y: frequency ticks.
    const fMin = effectiveMinHz();
    const fMax = effectiveMaxHz();
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    const tickMin = Math.max(fMin, o.scale === 'log' ? o.minHz : 0);
    for (const f of frequencyTicks(tickMin, fMax, o.scale)) {
      const u = o.scale === 'log' ? axisFraction(f, fMin, fMax, 'log') : f / fMax;
      if (u < -1e-6 || u > 1 + 1e-6) continue;
      const y = Math.round(rect.y + (1 - u) * rect.h) + 0.5;
      ctx.beginPath();
      ctx.moveTo(rect.x - 4, y);
      ctx.lineTo(rect.x - 1, y);
      ctx.stroke();
      ctx.fillText(formatHzTick(f), rect.x - 7, Math.min(h - o.gutter.bottom, Math.max(6, y)));
    }
    // x: elapsed time across the window, newest column at the right edge.
    const step = timeTickStep(o.timeSpanS);
    ctx.textBaseline = 'top';
    const n = Math.round(o.timeSpanS / step);
    for (let i = 0; i <= n; i++) {
      const t = i * step;
      const x = Math.round(rect.x + (t / o.timeSpanS) * rect.w) + 0.5;
      ctx.beginPath();
      ctx.moveTo(x, rect.y + rect.h + 1);
      ctx.lineTo(x, rect.y + rect.h + 4);
      ctx.stroke();
      ctx.textAlign = i === 0 ? 'left' : i === n ? 'right' : 'center';
      ctx.fillText(formatSecondsTick(t), i === 0 ? x - 1 : x, rect.y + rect.h + o.timeLabelGap);
    }
    drawReadout(ctx);
  }

  function cursorRow() {
    return Math.floor((cursorY * plot.height) / rect.h);
  }

  function drawReadout(ctx) {
    const r = cursorY == null || !spg ? null : spg.readout(cursorRow());
    if (!r) return;
    const y = Math.round(rect.y + cursorY) + 0.5;
    ctx.save();
    ctx.strokeStyle = theme.text;
    ctx.globalAlpha = 0.7;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(rect.x, y);
    ctx.lineTo(rect.x + rect.w, y);
    ctx.stroke();
    ctx.restore();
    const lines = readoutLines(r);
    const lh = o.tickFont + 4;
    const tw = Math.max(...lines.map((l) => ctx.measureText(l).width)) + 8;
    const bh = lines.length * lh + 2;
    const bx = Math.max(rect.x, rect.x + rect.w - tw - 2);
    const by = cursorY > bh + 2 ? y - bh - 2 : y + 2;
    ctx.save();
    ctx.fillStyle = theme.surface3 || theme.bg || '#000';
    ctx.globalAlpha = 0.85;
    ctx.fillRect(bx, by, tw, bh);
    ctx.restore();
    ctx.fillStyle = theme.text;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    lines.forEach((l, i) => ctx.fillText(l, bx + 4, by + 2 + i * lh));
  }

  function onPointer(e) {
    const b = host.getBoundingClientRect();
    const py = e.clientY - b.top - rect.y;
    const px = e.clientX - b.left - rect.x;
    const inside = e.type !== 'pointerleave' && px >= 0 && px < rect.w && py >= 0 && py < rect.h;
    const next = inside ? py : null;
    if (next === cursorY) return;
    cursorY = next;
    drawAxes();
  }

  function ensureRenderer(an) {
    if (an === node && spg) return;
    node = an || null;
    reader = node ? createAnalyserReader(node) : null;
    feed = reader ? createSpectrogramFeed(reader, { mode: o.feed }) : null;
    sampleRate = node ? node.context.sampleRate : 0;
    const cfg = {
      sampleRate: sampleRate || 0,
      fftSize: node ? node.fftSize : 0,
      minHz: effectiveMinHz() || 0,
      maxHz: effectiveMaxHz(),
      scale: o.scale,
      minDb: o.minDb,
      maxDb: o.maxDb,
      timeSpanS: o.timeSpanS,
      stops: lutStopsFromTheme(theme),
      // A hidden page OR a hidden panel/tab pauses the time axis without backfilling it.
      isHidden: () => document.hidden || host.offsetParent === null,
    };
    if (!spg) spg = createSpectrogram(plot, cfg);
    else spg.configure(cfg);
    spg.freeze(frozen);
    drawAxes();
  }

  function frame(nowMs = performance.now()) {
    const an = o.getAnalyser ? o.getAnalyser() : null;
    ensureRenderer(an);
    if (reader && host.offsetParent !== null) {
      if (reader.fftSize !== node.fftSize) {
        reader.sync();
        spg.configure({ fftSize: node.fftSize });
      }
      // Frozen: push writes nothing, so the unsmoothed feed skips its JS FFT; the analyser feed
      // keeps reading (native, cheap) so the node's smoothing is current after an unfreeze.
      const skip = frozen && feed.mode === 'unsmoothed';
      if (spg.push(skip ? null : feed.read(nowMs), nowMs) > 0) {
        spg.draw();
        if (cursorY != null) drawAxes();
      }
    }
  }

  function reconfigure(patch) {
    Object.assign(o, patch);
    if (spg) {
      spg.configure({
        minHz: effectiveMinHz() || 0,
        maxHz: effectiveMaxHz(),
        scale: o.scale,
        timeSpanS: o.timeSpanS,
      });
    }
    drawAxes();
  }

  const stopFrames = o.autoFrame ? onFrame(frame) : () => {};
  const stopObserve = observeSize(host, layout);
  host.addEventListener('pointermove', onPointer);
  host.addEventListener('pointerleave', onPointer);
  layout();
  ensureRenderer(o.getAnalyser ? o.getAnalyser() : null);

  return {
    get spectrogram() {
      return spg;
    },
    get plotRect() {
      return { ...rect };
    },
    get plotCanvas() {
      return plot;
    },
    get options() {
      return { ...o, frozen, maxHzEffective: effectiveMaxHz() };
    },
    /** Readout under the hover cursor (renderer.readout), or null without a cursor. */
    get readout() {
      return cursorY == null || !spg ? null : spg.readout(cursorRow());
    },
    frame,
    setFreeze(on) {
      frozen = !!on;
      if (spg) spg.freeze(frozen);
    },
    setTimeSpan(s) {
      if (s > 0) reconfigure({ timeSpanS: s });
    },
    setScale(scale) {
      if (scale === 'log' || scale === 'linear') reconfigure({ scale });
    },
    setMaxHz(hz) {
      if (hz > 0) reconfigure({ maxHz: hz });
    },
    /** Pixel row (CSS px from the plot top) of a frequency, or null. */
    yForFrequency(f) {
      if (!spg) return null;
      const y = spg.yForFrequency(f);
      return y == null ? null : y / pixelRatio();
    },
    refreshTheme() {
      const before = JSON.stringify(lutStopsFromTheme(theme));
      theme = chartTheme();
      const stops = lutStopsFromTheme(theme);
      // A new LUT clears the history (spectrogram.js): only reconfigure when it really changed.
      if (spg && JSON.stringify(stops) !== before) spg.configure({ stops });
      drawAxes();
    },
    dispose() {
      stopFrames();
      stopObserve();
      host.removeEventListener('pointermove', onPointer);
      host.removeEventListener('pointerleave', onPointer);
      if (spg) spg.dispose();
      spg = null;
      plot.remove();
      axes.remove();
    },
  };
}
