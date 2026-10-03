// MEASURE and EXPERIMENTS charts (uPlot), drawn from the pure view models of
// src/js/measurement/views (response-chart, ir-chart, rta-chart, compare-view). They follow the
// conventions of the other uPlot charts here (chartTheme(), uplotAxis(), withAlpha(),
// formatHzTick, formatDbTick, observeSize): nothing is computed or smoothed in this file — a
// series is drawn exactly as its descriptor says (values, role colour, alpha, width, dash), a
// band fills between two descriptor series, markers come from the view's `markers`.
//
// Colour is never the only carrier of meaning (spec §118, §156): unreliable stretches are their
// own dashed, faded series (the view splits them), and unreliable or uncalibrated spans are
// additionally hatched; RTA bars that span too few FFT bins are hatched. Every chart has a text
// summary next to it in the DOM (aria-describedby); the canvas itself is decorative to
// assistive technology.
//
//   createResponseChart(host, { onReadout(lines|null) })  response / overlay / delta views
//   createIrChart(host)                                    IrView (ms re the direct peak)
//   createRtaChart(host, { onReadout(lines|null) })        RtaView (bars over band edges)
//   chart = { setView(view|null), refreshTheme(), relayout(), dispose(), uplot, view,
//             setLive(frame|null), updateView(view), redraw() }
//
// Live RTA (spec §123, docs/v3/ui-integration.md "Live RTA"): setLive(frame) hands the chart
// the live-rta.js frame (its arrays are updated in place on every push); redraw() repaints the
// existing uPlot from it (bars or the FFT trace, peak ticks) without rebuilding anything or
// allocating; updateView(view) swaps the view model (labels, readout text, hatching) and only
// rebuilds when its axes or layout changed. The live axis is fixed (rta-chart.js liveRange).

import uPlot from 'uplot';
import { chartTheme, withAlpha, uplotAxis, canvasFont, observeSize } from './chart-theme.js';
import { formatHzTick, formatDbTick } from './axes.js';
import { MEASUREMENT_ROLES } from '../measurement/views/common.js';

/** The theme colour of a measurement role (an existing token, src/styles/tokens.css). */
export function roleColour(theme, role) {
  const r = MEASUREMENT_ROLES[role];
  return (r && r.token && theme[r.token]) || theme.textMuted;
}

const HATCH_STEP = 6;

function hatch(ctx, x0, y0, w, h, colour, dpr) {
  if (!(w > 0) || !(h > 0)) return;
  ctx.save();
  ctx.beginPath();
  ctx.rect(x0, y0, w, h);
  ctx.clip();
  ctx.strokeStyle = colour;
  ctx.lineWidth = 1 * dpr;
  const step = HATCH_STEP * dpr;
  ctx.beginPath();
  for (let x = x0 - h; x < x0 + w; x += step) {
    ctx.moveTo(x, y0 + h);
    ctx.lineTo(x + h, y0);
  }
  ctx.stroke();
  ctx.restore();
}

function vline(ctx, x, top, height, colour, dash, dpr) {
  ctx.save();
  ctx.strokeStyle = colour;
  ctx.lineWidth = 1 * dpr;
  ctx.setLineDash(dash ? dash.map((d) => d * dpr) : []);
  ctx.beginPath();
  ctx.moveTo(Math.round(x) + 0.5, top);
  ctx.lineTo(Math.round(x) + 0.5, top + height);
  ctx.stroke();
  ctx.restore();
}

function label(ctx, theme, text, x, y, dpr, align = 'left', colour = theme.textMuted) {
  ctx.save();
  ctx.font = canvasFont(theme, theme.fs2xs * dpr);
  ctx.textAlign = align;
  ctx.textBaseline = 'top';
  ctx.fillStyle = colour;
  ctx.fillText(text, x, y);
  ctx.restore();
}

/** Shared machinery: build a uPlot from a view, rebuild on setView/theme, size with the host. */
function createViewChart(host, { onReadout = null, draw = null } = {}) {
  let theme = chartTheme();
  let u = null;
  let view = null;
  let live = null; // a live-rta.js frame (drawn by the draw hook; uPlot series stay empty)
  const liveState = { frame: null, showPeaks: false };
  const empty = document.createElement('div');
  empty.className = 'osc-chart-note';
  empty.textContent = 'NOT MEASURED';
  const chip = document.createElement('div');
  chip.className = 'osc-chip-readout osc-chip-readout--stack';
  chip.setAttribute('aria-hidden', 'true');
  chip.hidden = true;

  function seriesOpts(v) {
    const list = [{}];
    if (!v.series.length || live) {
      list.push({ label: 'bars', show: true, stroke: 'transparent', width: 0,
        points: { show: false } });
      return list;
    }
    for (const d of v.series) {
      const colour = withAlpha(roleColour(theme, d.role), d.alpha);
      list.push({
        label: d.label,
        show: d.show !== false,
        stroke: d.width > 0 ? colour : 'transparent',
        width: d.width > 0 ? d.width : 0,
        dash: d.dash ? d.dash.slice() : undefined,
        points: { show: false },
        spanGaps: false,
      });
    }
    return list;
  }

  function bandOpts(v) {
    if (!v.bands || !v.bands.length) return [];
    const idx = (id) => v.series.findIndex((d) => d.id === id) + 1;
    return v.bands.map((b) => ({ series: [idx(b.upper), idx(b.lower)],
      fill: withAlpha(roleColour(theme, b.role), b.alpha) }))
      .filter((b) => b.series[0] > 0 && b.series[1] > 0);
  }

  function data(v) {
    const x = Array.from(v.x);
    if (!v.series.length || live) return [x, x.map(() => null)];
    return [x, ...v.series.map((d) => d.values)];
  }

  function xAxisOpts(v) {
    const ax = v.axes.x;
    if (ax.uplot) {
      return uplotAxis(theme, {
        scale: 'x', size: 22, gap: 3,
        splits: () => ax.ticks,
        values: (self, s) => s.map((t) => {
          const i = ax.ticks.indexOf(t);
          return i >= 0 && ax.tickLabels ? ax.tickLabels[i] : formatHzTick(t);
        }),
      });
    }
    return uplotAxis(theme, {
      scale: 'x', size: 22, gap: 3,
      splits: () => ax.ticks,
      values: (self, s) => s.map((t) => `${Math.round(t * 100) / 100}`),
    });
  }

  function build() {
    if (u) {
      u.destroy();
      u = null;
    }
    theme = chartTheme();
    if (!view) {
      host.replaceChildren(empty);
      return;
    }
    const v = view;
    const w = Math.max(60, host.clientWidth);
    const h = Math.max(60, host.clientHeight);
    const opts = {
      width: w,
      height: h,
      legend: { show: false },
      padding: [10, 10, 0, 0],
      cursor: {
        x: true,
        y: false,
        points: { show: false },
        drag: { x: false, y: false, setScale: false },
      },
      select: { show: false },
      scales: {
        x: v.axes.x.uplot
          ? { time: false, auto: false, distr: 3, log: 10, range: () => v.axes.x.range }
          : { time: false, auto: false, range: () => v.axes.x.range },
        y: { auto: false, range: () => v.axes.y.range },
      },
      axes: [
        xAxisOpts(v),
        uplotAxis(theme, {
          scale: 'y', size: 44, gap: 4,
          splits: () => v.axes.y.ticks,
          // dB axes (response, delta, RTA, IR in dB) as plain dB numbers; the linear IR axis
          // (relative amplitude) as a short decimal.
          // The tick on the bottom edge is left unlabelled: it would collide with the x labels.
          values: (self, s) => s.map((t) => {
            if (t <= v.axes.y.range[0]) return '';
            return /dB/.test(v.axes.y.unit || '') ? formatDbTick(t, 'plain')
              : `${Math.round(t * 1000) / 1000}`;
          }),
        }),
      ],
      series: seriesOpts(v),
      bands: bandOpts(v),
      hooks: {
        draw: [(self) => { if (draw) draw(self, view || v, theme, live ? liveState : null); }],
        setCursor: [(self) => readout(self)],
      },
    };
    host.replaceChildren();
    u = new uPlot(opts, data(v), host);
    host.appendChild(chip);
    chip.hidden = true;
  }

  function readout(self) {
    if (!onReadout || !view) return;
    const idx = self.cursor.idx;
    const left = self.cursor.left;
    if (idx == null || left == null || left < 0) {
      chip.hidden = true;
      onReadout(null);
      return;
    }
    let lines = null;
    if (typeof view.readout === 'function') {
      const r = view.readout(idx);
      lines = r ? r.lines : null;
    } else if (typeof view.readoutAt === 'function') {
      const r = view.readoutAt(self.posToVal(left, 'x'));
      lines = r ? [r.text] : null;
    } else if (view.bars && view.bars.length) {
      const hz = self.posToVal(left, 'x');
      const b = view.bars.find((x) => hz >= x.lo && hz < x.hi);
      if (b) {
        lines = [`Band ${b.label} Hz (${Math.round(b.lo)}–${Math.round(b.hi)} Hz)`, b.text];
        if (b.peakText) lines.push(`PEAK HOLD ${b.peakText}`);
        if (b.underResolved) lines.push('under-resolved (too few FFT bins for the window)');
      }
    }
    if (!lines) {
      chip.hidden = true;
      onReadout(null);
      return;
    }
    chip.textContent = lines.join('\n');
    chip.hidden = false;
    const pad = 8;
    chip.style.top = `${pad}px`;
    const plotLeft = self.bbox.left / (self.pxRatio || 1);
    const plotWidth = self.bbox.width / (self.pxRatio || 1);
    // Keep the chip on the side away from the cursor so it never covers the read point.
    if (left > plotWidth / 2) {
      chip.style.left = `${plotLeft + pad}px`;
      chip.style.right = '';
    } else {
      chip.style.left = '';
      chip.style.right = `${pad}px`;
    }
    onReadout(lines);
  }

  const stop = observeSize(host, () => {
    if (!u || !host.clientWidth || !host.clientHeight) return; // hidden host: keep last size
    u.setSize({ width: Math.max(60, host.clientWidth), height: Math.max(60, host.clientHeight) });
  });

  build();

  // Same axes and layout: the view can be swapped without rebuilding the uPlot.
  const sameRange = (a, b) => a[0] === b[0] && a[1] === b[1];
  function compatible(a, b) {
    return !!a && !!b && a.mode === b.mode && sameRange(a.axes.x.range, b.axes.x.range)
      && sameRange(a.axes.y.range, b.axes.y.range) && (a.bars || []).length === (b.bars || [])
      .length && a.series.length === b.series.length && a.x.length === b.x.length;
  }

  return {
    get uplot() { return u; },
    get view() { return view; },
    setView(next) {
      view = next || null;
      build();
    },
    /**
     * Live frame to draw (null: draw the view's own values) and whether its peaks show; call
     * redraw() or updateView() after.
     */
    setLive(frame, { showPeaks = false } = {}) {
      const was = !!live;
      live = frame || null;
      liveState.frame = live;
      liveState.showPeaks = !!showPeaks;
      if (was !== !!live && view) build();
    },
    /** Swap the view; rebuild only when its axes or layout differ. */
    updateView(next) {
      if (u && compatible(view, next)) {
        view = next;
        u.redraw(false, false);
      } else {
        view = next || null;
        build();
      }
    },
    /** Repaint from the live frame (no rebuild, no allocation). */
    redraw() {
      if (u) u.redraw(false, false);
    },
    refreshTheme() { build(); },
    /** After the host was hidden (display: none), rebuild at its real size. */
    relayout() {
      if (host.clientWidth > 0 && host.clientHeight > 0) build();
    },
    dispose() {
      stop();
      if (u) u.destroy();
      u = null;
      host.replaceChildren();
    },
  };
}

/** Markers of a response view: requested and calibrated ranges, hatched unreliable spans. */
function drawResponseMarkers(self, v, theme) {
  const m = v.markers;
  if (!m) return;
  const ctx = self.ctx;
  const dpr = self.pxRatio || 1;
  const { left, top, width, height } = self.bbox;
  const [x0, x1] = v.axes.x.range;
  const clampX = (hz) => self.valToPos(Math.max(x0, Math.min(x1, hz)), 'x', true);
  ctx.save();
  for (const r of m.unreliableRanges || []) {
    const a = clampX(r[0]);
    const b = clampX(r[1]);
    hatch(ctx, a, top, b - a, height, withAlpha(roleColour(theme, 'neutral'), 0.16), dpr);
  }
  if (m.calibratedRange) {
    const [lo, hi] = m.calibratedRange.range;
    const a = clampX(lo);
    const b = clampX(hi);
    const c = withAlpha(roleColour(theme, 'calibrated'), 0.8);
    // Uncalibrated (outside the profile): hatched in the calibrated role, faint.
    if (a > left + 1) hatch(ctx, left, top, a - left, height, withAlpha(c, 0.18), dpr);
    if (b < left + width - 1) hatch(ctx, b, top, left + width - b, height, withAlpha(c, 0.18), dpr);
    vline(ctx, a, top, height, c, m.calibratedRange.dash || [3, 3], dpr);
    vline(ctx, b, top, height, c, m.calibratedRange.dash || [3, 3], dpr);
    label(ctx, theme, 'CALIBRATED', a + 4 * dpr, top + height - 14 * dpr, dpr, 'left', c);
  }
  if (m.requestedRange) {
    const [lo, hi] = m.requestedRange.range;
    const c = withAlpha(roleColour(theme, 'requested'), 0.8);
    if (lo >= x0 && lo <= x1) vline(ctx, clampX(lo), top, height, c, [3, 3], dpr);
    if (hi >= x0 && hi <= x1) vline(ctx, clampX(hi), top, height, c, [3, 3], dpr);
  }
  ctx.restore();
}

export function createResponseChart(host, { onReadout = null } = {}) {
  return createViewChart(host, { onReadout, draw: drawResponseMarkers });
}

/** Window region of an IR view (view only; the IR is kept whole). */
function drawIrMarkers(self, v, theme) {
  const w = v.windowRegion;
  const ctx = self.ctx;
  const dpr = self.pxRatio || 1;
  const { top, height } = self.bbox;
  const [x0, x1] = v.axes.x.range;
  const pos = (ms) => self.valToPos(Math.max(x0, Math.min(x1, ms)), 'x', true);
  // 0 ms: the direct peak.
  if (0 >= x0 && 0 <= x1) {
    vline(ctx, pos(0), top, height, withAlpha(theme.textMuted, 0.5), [2, 3], dpr);
  }
  if (!w) return;
  const a = pos(w.fromMs);
  const b = pos(w.toMs);
  const c = roleColour(theme, w.role || 'neutral');
  ctx.save();
  ctx.fillStyle = withAlpha(c, 0.08);
  ctx.fillRect(a, top, b - a, height);
  ctx.restore();
  vline(ctx, a, top, height, withAlpha(c, 0.8), w.dash || [3, 3], dpr);
  vline(ctx, b, top, height, withAlpha(c, 0.8), w.dash || [3, 3], dpr);
  label(ctx, theme, 'WINDOW', a + 4 * dpr, top + 4 * dpr, dpr, 'left', c);
}

export function createIrChart(host) {
  return createViewChart(host, { draw: drawIrMarkers });
}

/**
 * The live FFT trace: one vertex per pixel column (the column's strongest bin), so a dense
 * spectrum costs one path of plot-width points; −Infinity (zero power) breaks the line.
 */
// mask / want (optional): only bins with mask[i] === want are drawn; the others leave a gap.
function liveTrace(self, ctx, freqs, values, x0, x1, yPos, mask = null, want = 1) {
  let col = -1;
  let best = -Infinity;
  let bestX = 0;
  let pen = false;
  ctx.beginPath();
  const flush = () => {
    if (best === -Infinity) {
      pen = false;
      return;
    }
    const y = yPos(best);
    if (pen) ctx.lineTo(bestX, y);
    else ctx.moveTo(bestX, y);
    pen = true;
  };
  for (let i = 0; i < freqs.length; i++) {
    const f = freqs[i];
    if (f < x0 || f > x1) continue;
    const x = self.valToPos(f, 'x', true);
    const c = Math.round(x);
    if (c !== col) {
      if (col >= 0) flush();
      col = c;
      best = -Infinity;
      bestX = x;
    }
    if ((!mask || mask[i] === want) && values[i] > best) best = values[i];
  }
  if (col >= 0) flush();
  ctx.stroke();
}

function drawLiveFft(self, v, theme, ls) {
  const live = ls.frame;
  const ctx = self.ctx;
  const dpr = self.pxRatio || 1;
  const [x0, x1] = v.axes.x.range;
  const [y0, y1] = v.axes.y.range;
  const yPos = (db) => self.valToPos(Math.max(y0, Math.min(y1, db)), 'y', true);
  // V383: the 'calibrated' colour only where the profile corrected the bin (frame.covered); the
  // rest of the trace is observed, as the band modes draw it.
  const mask = live.calibrated && live.calibrated.frequency && live.covered ? live.covered : null;
  const passes = mask ? [[1, 'calibrated'], [0, 'observed']] : [[1, 'observed']];
  ctx.save();
  ctx.lineWidth = 1 * dpr;
  for (const [want, role] of passes) {
    const c = roleColour(theme, role);
    ctx.setLineDash([]);
    ctx.strokeStyle = withAlpha(c, 0.95);
    liveTrace(self, ctx, live.frequencies, live.values, x0, x1, yPos, mask, want);
    if (ls.showPeaks) {
      ctx.strokeStyle = withAlpha(c, 0.6);
      ctx.setLineDash([3 * dpr, 3 * dpr]);
      liveTrace(self, ctx, live.frequencies, live.peaks, x0, x1, yPos, mask, want);
    }
  }
  ctx.restore();
}

/** RTA bars: band power from lo to hi edge; hatched when under-resolved; peak-hold ticks. */
function drawRtaBars(self, v, theme, ls = null) {
  const live = ls ? ls.frame : null;
  if (live && live.mode === 'fft') {
    drawLiveFft(self, v, theme, ls);
    return;
  }
  if (!v.bars || !v.bars.length) return;
  const useLive = !!live && live.values && live.values.length === v.bars.length;
  const ctx = self.ctx;
  const dpr = self.pxRatio || 1;
  const { top, height } = self.bbox;
  const yBottom = top + height;
  const [y0, y1] = v.axes.y.range;
  const yPos = (db) => self.valToPos(Math.max(y0, Math.min(y1, db)), 'y', true);
  ctx.save();
  for (const b of v.bars) {
    const a = self.valToPos(b.lo, 'x', true);
    const z = self.valToPos(b.hi, 'x', true);
    const gap = Math.min(1.5 * dpr, (z - a) * 0.15);
    const x = a + gap;
    const w = Math.max(1, z - a - 2 * gap);
    const role = b.covered ? 'calibrated' : 'observed';
    const c = roleColour(theme, role);
    const value = useLive ? (live.values[b.index] > -Infinity ? live.values[b.index] : null)
      : b.value;
    if (value !== null) {
      const y = yPos(value);
      ctx.fillStyle = withAlpha(c, 0.42);
      ctx.fillRect(x, y, w, yBottom - y);
      ctx.strokeStyle = withAlpha(c, 0.9);
      ctx.lineWidth = 1 * dpr;
      ctx.beginPath();
      ctx.moveTo(x, y + 0.5);
      ctx.lineTo(x + w, y + 0.5);
      ctx.stroke();
      if (b.underResolved) hatch(ctx, x, y, w, yBottom - y, withAlpha(theme.text, 0.35), dpr);
    }
  }
  const peakList = useLive ? (ls.showPeaks ? v.bars : []) : v.peaks || [];
  for (const p of peakList) {
    const pv = useLive ? live.peaks[p.index] : p.value;
    if (!(pv > -Infinity)) continue;
    const a = self.valToPos(p.lo, 'x', true);
    const z = self.valToPos(p.hi, 'x', true);
    const y = yPos(pv);
    const role = useLive ? (p.covered ? 'calibrated' : 'observed') : p.role;
    ctx.strokeStyle = withAlpha(roleColour(theme, role), 0.9);
    ctx.lineWidth = 1.25 * dpr;
    ctx.setLineDash((p.dash || [3, 3]).map((d) => d * dpr));
    ctx.beginPath();
    ctx.moveTo(a + 1, Math.round(y) + 0.5);
    ctx.lineTo(z - 1, Math.round(y) + 0.5);
    ctx.stroke();
  }
  ctx.restore();
}

export function createRtaChart(host, { onReadout = null } = {}) {
  return createViewChart(host, { onReadout, draw: drawRtaBars });
}
