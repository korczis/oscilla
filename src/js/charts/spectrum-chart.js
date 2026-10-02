// Live FFT spectrum (uPlot) from AnalyserNode readers (src/js/analysis/analyser.js).
//
// Single mode: one "Spectrum" trace with the purple-to-orange gradient fill, a dashed
// requested-frequency marker and a readout chip ("15.5 kHz / -20 dB": the analyser level at
// the marker). Dual mode (microphone): "Microphone (live)" in green against "Generator
// (target)" in blue, an optional dashed peak-hold trace, a peak marker with its chip, and the
// requested marker. Levels are relative analyser levels (dBFS-like), never SPL.
//
// One point per plot pixel column (spectrum-data.js); buffers are allocated per configuration
// and reused every frame; drawing runs on the shared rAF loop (frame-loop.js).

import uPlot from 'uplot';
import { createAnalyserReader } from '../analysis/analyser.js';
import {
  axisValue,
  frequencyTicks,
  formatHzTick,
  formatHz,
  formatDbTick,
  linearTicks,
} from './axes.js';
import { buildPixelMap, sampleSpectrum, levelNear } from './spectrum-data.js';
import { chartTheme, withAlpha, uplotAxis, canvasFont, observeSize } from './chart-theme.js';
import { onFrame } from './frame-loop.js';
import { octaveCMarkers, layoutMarkerLabels } from '../visualization/spectrum-data.js';

export const SPECTRUM_Y_LABEL = 'RELATIVE LEVEL (dBFS-like, uncalibrated)';

const DEFAULTS = {
  mode: 'single', // 'single' | 'dual'
  minHz: 20,
  maxHz: 20000,
  scale: 'log',
  minDb: -100,
  maxDb: 0,
  dbStep: 20,
  yLabel: SPECTRUM_Y_LABEL,
  // Geometry measured on the reference (analysis panel): plot inset 16 px from the host top,
  // 43 px from its left, 8 px from its right; frequency labels 20 px under the plot.
  xAxisSize: 31,
  xAxisGap: 13,
  yAxisSize: 43,
  yAxisGap: 10,
  padding: [16, 8, 0, 0],
  legend: false, // draw an in-chart legend (dual mode, reference mic panel)
  octaveMarkers: true, // single mode: C1…C10 ticks + labels along the plot floor (getA4())
  getA4: null, // () => A4 tuning in Hz (default 440)
  autoFrame: true, // subscribe to the shared rAF loop
};

/** Set `hidden` only when it changes (assigning it always writes the attribute). */
export function setHidden(el, hidden) {
  if (el && el.hidden !== hidden) el.hidden = hidden;
}

function makeChip(host, extraClass = '') {
  const el = document.createElement('div');
  el.className = `osc-chip-readout ${extraClass}`.trim();
  el.style.whiteSpace = 'nowrap';
  el.hidden = true;
  host.appendChild(el);
  return el;
}

/** Reader cache: one analyser reader per AnalyserNode, recreated when the node changes. */
function readerSlot() {
  let node = null;
  let reader = null;
  let cfgKey = '';
  return {
    get(an) {
      if (an !== node) {
        node = an || null;
        reader = node ? createAnalyserReader(node) : null;
        cfgKey = '';
      }
      return reader;
    },
    /** Apply reader options only when they change (configure() clears peak buffers). */
    configure(cfg) {
      const key = JSON.stringify(cfg);
      if (reader && key !== cfgKey) {
        reader.configure(cfg);
        cfgKey = key;
      }
    },
    get reader() {
      return reader;
    },
  };
}

/**
 * createSpectrumChart(host, options) → chart
 *   options: DEFAULTS above plus getAnalyser() (single) / getMicAnalyser() + getAnalyser()
 *            (dual), getRequested() → Hz | null
 *   chart.setScale('log'|'linear'), setMaxHz(hz), setRequested(hz), setPeak({ hz, db } | null),
 *        setFreeze(on), setAveraging(seconds), setPeakHold(on), frame(nowMs), resize(),
 *        refreshTheme(), getData() → { x, series: [...] } (copies), readers, uplot, dispose()
 */
export function createSpectrumChart(host, options = {}) {
  const o = { ...DEFAULTS, ...options };
  const dual = o.mode === 'dual';
  const slots = { main: readerSlot(), mic: readerSlot() };
  let theme = chartTheme();
  let u = null;
  let count = 0;
  let xs = null;
  let ys = []; // single: [main]; dual: [mic, target, micPeak]
  let maps = { main: null, mic: null };
  let requested = null;
  let peak = null;
  let frozen = false;
  let averagingS = 0;
  let peakHold = false;
  let gradientKey = '';
  let fillGrad = null;
  let strokeGrad = null;
  let lastShow = '';
  let lastFrame = 0;
  const markerChip = makeChip(host);
  const hoverChip = makeChip(host);
  const note = document.createElement('div');
  note.className = 'osc-chart-note';
  note.hidden = true;
  host.appendChild(note);

  const plotLeft = () => (u ? parseFloat(u.over.style.left) || 0 : 0);
  const plotTop = () => (u ? parseFloat(u.over.style.top) || 0 : 0);

  function gradients(ctx, bbox) {
    const key = `${bbox.top}:${bbox.height}:${theme.purple}:${theme.orange}`;
    if (key !== gradientKey) {
      const y0 = bbox.top + bbox.height;
      const y1 = bbox.top;
      fillGrad = ctx.createLinearGradient(0, y0, 0, y1);
      fillGrad.addColorStop(0, withAlpha(theme.purple, 0.55));
      fillGrad.addColorStop(0.18, withAlpha(theme.purple, 0.5));
      fillGrad.addColorStop(0.45, withAlpha(theme.magenta, 0.6));
      fillGrad.addColorStop(0.75, withAlpha(theme.orange, 0.75));
      fillGrad.addColorStop(1, withAlpha(theme.orange, 0.9));
      strokeGrad = ctx.createLinearGradient(0, y0, 0, y1);
      strokeGrad.addColorStop(0, theme.magenta);
      strokeGrad.addColorStop(0.35, theme.orange);
      strokeGrad.addColorStop(1, '#fff2a8');
      gradientKey = key;
    }
    return { fillGrad, strokeGrad };
  }

  function xTicks() {
    return frequencyTicks(o.scale === 'log' ? o.minHz : 0, o.maxHz, o.scale);
  }

  function dbTicks() {
    return linearTicks(o.minDb, o.maxDb, { step: o.dbStep });
  }

  function drawOverlay(self) {
    const ctx = self.ctx;
    const { left, top, width, height } = self.bbox;
    const dpr = self.pxRatio || 1;
    ctx.save();
    // Requested-frequency marker: dashed vertical line.
    let markerX = null;
    if (requested > 0 && requested >= xMin() && requested <= o.maxHz) {
      markerX = self.valToPos(requested, 'x', true);
      ctx.strokeStyle = withAlpha(theme.text, 0.9) || theme.text;
      ctx.lineWidth = 1.25 * dpr;
      ctx.setLineDash([3 * dpr, 3 * dpr]);
      ctx.beginPath();
      ctx.moveTo(Math.round(markerX) + 0.5, top);
      ctx.lineTo(Math.round(markerX) + 0.5, top + height);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    // Peak marker (dual mode): dot on the detected peak.
    if (peak && peak.hz >= xMin() && peak.hz <= o.maxHz && Number.isFinite(peak.db)) {
      const px = self.valToPos(peak.hz, 'x', true);
      const py = self.valToPos(Math.max(o.minDb, Math.min(o.maxDb, peak.db)), 'y', true);
      ctx.fillStyle = theme.trace;
      ctx.strokeStyle = theme.text;
      ctx.lineWidth = 1.5 * dpr;
      ctx.beginPath();
      ctx.arc(px, py, 3.5 * dpr, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
    // Octave-C markers (single mode): short ticks on the plot floor, labels laid out by
    // layoutMarkerLabels so they never overlap (a label that would is hidden).
    if (!dual && o.octaveMarkers) drawOctaveMarkers(self, ctx, dpr, markerX);
    // Level-scale caption (no calibrated unit is implied).
    if (o.yLabel) {
      ctx.font = canvasFont(theme, 8.5 * dpr);
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.fillStyle = theme.textDim;
      ctx.fillText(o.yLabel, left + 6 * dpr, top + 4 * dpr);
    }
    // In-chart legend (mic reference).
    if (o.legend && dual) {
      ctx.font = canvasFont(theme, theme.fs2xs * dpr);
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      const items = [
        [theme.green, 'Microphone (live)'],
        [theme.trace, 'Generator (target)'],
      ];
      let x = left + width * 0.22;
      const y = top + 9 * dpr;
      for (const [c, label] of items) {
        ctx.fillStyle = c;
        ctx.beginPath();
        ctx.arc(x, y, 3.5 * dpr, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = theme.textMuted;
        ctx.fillText(label, x + 8 * dpr, y);
        x += ctx.measureText(label).width + 28 * dpr;
      }
    }
    ctx.restore();
    placeMarkerChip(markerX != null ? markerX / dpr : null);
  }

  function xMin() {
    return o.scale === 'log' ? o.minHz : 0;
  }

  function drawOctaveMarkers(self, ctx, dpr, requestedX) {
    const { left, top, width, height } = self.bbox;
    const a4 = (o.getA4 && Number(o.getA4())) || 440;
    const markers = octaveCMarkers(a4, { fmin: Math.max(xMin(), 1), fmax: o.maxHz });
    if (!markers.length) return;
    ctx.font = canvasFont(theme, 8 * dpr);
    const placed = layoutMarkerLabels(markers, (f) => self.valToPos(f, 'x', true),
      (label) => ctx.measureText(label).width, left + width);
    const floor = top + height;
    ctx.strokeStyle = withAlpha(theme.textMuted, 0.5);
    ctx.lineWidth = dpr;
    ctx.fillStyle = theme.textDim;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'bottom';
    for (const m of placed) {
      const x = Math.round(m.x) + 0.5;
      ctx.beginPath();
      ctx.moveTo(x, floor - 4 * dpr);
      ctx.lineTo(x, floor);
      ctx.stroke();
      // A label never covers the requested-frequency marker line either.
      const w = ctx.measureText(m.label).width;
      const onMarker = requestedX != null && requestedX >= m.lx - 3 * dpr
        && requestedX <= m.lx + w + 3 * dpr;
      if (m.show && !onMarker) ctx.fillText(m.label, m.lx, floor - 3 * dpr);
    }
  }

  function chipLevelText(db) {
    if (db == null || !Number.isFinite(db)) return '— dB';
    if (db < o.minDb) return `< ${o.minDb} dB`;
    return `${Math.round(db)} dB`;
  }

  function placeMarkerChip(markerXCss) {
    let x = null;
    let text = null;
    if (dual) {
      if (peak && peak.hz >= xMin() && peak.hz <= o.maxHz) {
        x = u.valToPos(peak.hz, 'x');
        text = [formatHz(peak.hz), chipLevelText(peak.db)];
      }
    } else if (markerXCss != null) {
      const r = slots.main.reader;
      const db = r && r.hasData ? levelNear(r.frequency, requested, r.binHz) : null;
      x = markerXCss;
      text = [formatHz(requested), chipLevelText(db)];
    }
    if (x == null) {
      setHidden(markerChip, true);
      return;
    }
    const content = `${text[0]}\n${text[1]}`;
    if (markerChip.dataset.text !== content) {
      markerChip.textContent = '';
      markerChip.append(text[0], document.createElement('br'), text[1]);
      markerChip.dataset.text = content;
    }
    setHidden(markerChip, false);
    const w = markerChip.offsetWidth || 60;
    const left = plotLeft() + x;
    const hostW = host.clientWidth;
    const pos = left - w - 6 >= 0 ? left - w - 6 : Math.min(hostW - w - 2, left + 6);
    markerChip.style.left = `${Math.round(pos)}px`;
    markerChip.style.top = `${Math.round(plotTop() + 10)}px`;
  }

  function onCursor(self) {
    const idx = self.cursor.idx;
    if (idx == null || self.cursor.left < 0) {
      setHidden(hoverChip, true);
      return;
    }
    const f = xs[idx];
    const parts = [formatHz(f)];
    if (dual) {
      if (self.series[1].show) parts.push(`mic ${chipLevelText(ys[0][idx])}`);
      if (self.series[2].show) parts.push(`gen ${chipLevelText(ys[1][idx])}`);
    } else if (self.series[1].show) parts.push(chipLevelText(ys[0][idx]));
    const hoverText = parts.join(' · ');
    if (hoverChip.textContent !== hoverText) hoverChip.textContent = hoverText;
    setHidden(hoverChip, false);
    const w = hoverChip.offsetWidth || 80;
    const left = plotLeft() + self.cursor.left;
    const pos = left + 8 + w <= host.clientWidth ? left + 8 : left - w - 8;
    hoverChip.style.left = `${Math.round(pos)}px`;
    const plotH = self.bbox.height / (self.pxRatio || 1);
    hoverChip.style.top = `${Math.round(plotTop() + plotH - 26)}px`;
  }

  function seriesOpts() {
    if (!dual) {
      return [
        {},
        {
          label: 'Spectrum',
          width: 1,
          points: { show: false },
          stroke: (self) => gradients(self.ctx, self.bbox).strokeGrad,
          fill: (self) => gradients(self.ctx, self.bbox).fillGrad,
          fillTo: () => o.minDb, // fill down to the axis floor (uPlot's default is 0)
        },
      ];
    }
    return [
      {},
      {
        label: 'Microphone (live)',
        width: 1.25,
        points: { show: false },
        stroke: theme.green,
        fill: withAlpha(theme.green, 0.12),
        fillTo: () => o.minDb,
      },
      {
        label: 'Generator (target)',
        width: 1.25,
        points: { show: false },
        stroke: theme.trace,
        fill: withAlpha(theme.trace, 0.12),
        fillTo: () => o.minDb,
      },
      {
        label: 'Microphone peak hold',
        width: 1,
        dash: [3, 3],
        points: { show: false },
        stroke: withAlpha(theme.green, 0.8),
        show: false,
      },
    ];
  }

  function build() {
    if (u) {
      u.destroy();
      u = null;
    }
    theme = chartTheme();
    gradientKey = '';
    const w = Math.max(40, host.clientWidth);
    const h = Math.max(40, host.clientHeight);
    count = Math.max(2, Math.round(w - o.yAxisSize - o.padding[1]));
    allocate();
    const yAxis = uplotAxis(theme, {
      scale: 'y',
      size: o.yAxisSize,
      gap: o.yAxisGap,
      splits: () => dbTicks(),
      values: (self, splits) => splits.map((v) => formatDbTick(v, o.dbFormat || 'top')),
    });
    const opts = {
      width: w,
      height: h,
      legend: { show: false },
      padding: o.padding,
      cursor: {
        x: true,
        y: false,
        points: { show: false },
        drag: { x: false, y: false, setScale: false },
      },
      select: { show: false },
      scales: {
        x: {
          time: false,
          auto: false,
          distr: o.scale === 'log' ? 3 : 1,
          log: 10,
          range: () => [xMin(), o.maxHz],
        },
        y: { auto: false, range: () => [o.minDb, o.maxDb] },
      },
      axes: [
        uplotAxis(theme, {
          scale: 'x',
          size: o.xAxisSize,
          gap: o.xAxisGap,
          splits: () => xTicks(),
          values: (self, splits) => splits.map(formatHzTick),
        }),
        yAxis,
      ],
      series: seriesOpts(),
      hooks: { draw: [drawOverlay], setCursor: [onCursor] },
    };
    u = new uPlot(opts, [xs, ...ys], host);
    // Insert the chips above the uPlot root (built after them).
    host.appendChild(markerChip);
    host.appendChild(hoverChip);
    host.appendChild(note);
    lastShow = '';
    rebuildMapsForPlot();
  }

  function allocate() {
    xs = new Float64Array(count);
    for (let i = 0; i < count; i++) xs[i] = axisValue((i + 0.5) / count, xMin(), o.maxHz, o.scale);
    const n = dual ? 3 : 1;
    ys = [];
    for (let i = 0; i < n; i++) ys.push(new Float64Array(count).fill(o.minDb));
    maps = { main: null, mic: null };
  }

  /** After uPlot measured its plot box: one point per plot CSS pixel. */
  function rebuildMapsForPlot() {
    const plotW = Math.round(u.bbox.width / (u.pxRatio || 1));
    if (plotW > 1 && plotW !== count) {
      count = plotW;
      allocate();
      u.setData([xs, ...ys], false);
      u.redraw(true, false);
    }
  }

  function mapFor(key, reader) {
    const m = maps[key];
    if (m && m.binCount === reader.binCount && m.binHz === reader.binHz && m.count === count) {
      return m;
    }
    maps[key] = buildPixelMap({
      binCount: reader.binCount,
      binHz: reader.binHz,
      minHz: xMin(),
      maxHz: o.maxHz,
      scale: o.scale,
      count,
    });
    return maps[key];
  }

  function setShow(flags) {
    const key = flags.join('');
    if (key === lastShow || !u) return;
    lastShow = key;
    flags.forEach((on, i) => {
      if (u.series[i + 1].show !== on) u.setSeries(i + 1, { show: on });
    });
  }

  function readInto(key, an, out, nowMs) {
    const slot = slots[key];
    const r = slot.get(an);
    if (!r) return null;
    const own = key === (dual ? 'mic' : 'main');
    slot.configure(own ? { averagingS, peakHold } : { averagingS: 0, peakHold: false });
    if (frozen) r.freeze(true);
    else if (r.frozen) r.freeze(false);
    r.readFrequency(nowMs);
    sampleSpectrum(r.frequency, mapFor(key, r), out, o.minDb);
    return r;
  }

  /** The "no data" note: hidden for null, else shown with text. Writes only on change. */
  function setNote(text) {
    setHidden(note, text == null);
    if (text != null && note.textContent !== text) note.textContent = text;
  }

  function frame(nowMs = performance.now()) {
    if (!u) return;
    if (host.offsetParent === null) return; // hidden panel or tab: nothing to draw
    lastFrame = nowMs;
    if (o.getRequested) requested = o.getRequested();
    if (!dual) {
      const r = readInto('main', o.getAnalyser && o.getAnalyser(), ys[0], nowMs);
      setShow([!!r]);
      setNote(r ? null : 'Audio not started');
    } else {
      const rm = readInto('mic', o.getMicAnalyser && o.getMicAnalyser(), ys[0], nowMs);
      const rt = readInto('main', o.getAnalyser && o.getAnalyser(), ys[1], nowMs);
      if (rm && peakHold) sampleSpectrum(rm.peak, mapFor('mic', rm), ys[2], o.minDb);
      setShow([!!rm, !!rt, !!rm && peakHold]);
      setNote(rm ? null : o.micOffText || 'Microphone off');
    }
    u.setData([xs, ...ys], false);
    u.redraw(true, false); // setData(…, false) alone does not repaint
  }

  const stopFrames = o.autoFrame ? onFrame(frame) : () => {};
  const stopObserve = observeSize(host, () => {
    // A hidden host measures 0 × 0; resizing then loses the axes until the next rebuild.
    if (!u || !host.clientWidth || !host.clientHeight) return;
    u.setSize({ width: Math.max(40, host.clientWidth), height: Math.max(40, host.clientHeight) });
    rebuildMapsForPlot();
  });

  build();

  return {
    get uplot() {
      return u;
    },
    get readers() {
      return { main: slots.main.reader, mic: slots.mic.reader };
    },
    get options() {
      return { ...o, requested, frozen, averagingS, peakHold };
    },
    get lastFrame() {
      return lastFrame;
    },
    setScale(scale) {
      if (scale !== 'log' && scale !== 'linear') return;
      if (scale === o.scale) return;
      o.scale = scale;
      build();
    },
    setMaxHz(hz) {
      if (!(hz > xMin()) || hz === o.maxHz) return;
      o.maxHz = hz;
      build();
    },
    setRequested(hz) {
      requested = hz > 0 ? hz : null;
    },
    setPeak(p) {
      peak = p && p.hz > 0 ? { hz: p.hz, db: p.db } : null;
    },
    setFreeze(on) {
      frozen = !!on;
    },
    setAveraging(seconds) {
      averagingS = Math.max(0, Number(seconds) || 0);
    },
    setPeakHold(on) {
      peakHold = !!on;
      const r = slots[dual ? 'mic' : 'main'].reader;
      if (r && !peakHold) r.resetPeak();
    },
    frame,
    resize() {
      if (!u || !host.clientWidth || !host.clientHeight) return;
      u.setSize({ width: host.clientWidth, height: host.clientHeight });
      rebuildMapsForPlot();
    },
    refreshTheme() {
      build();
    },
    /** Copies of the plotted data: { x, series: [Float64Array…] } (tests, export). */
    getData() {
      return { x: Array.from(xs), series: ys.map((y) => Array.from(y)) };
    },
    dispose() {
      stopFrames();
      stopObserve();
      if (u) u.destroy();
      u = null;
      markerChip.remove();
      hoverChip.remove();
      note.remove();
    },
  };
}
