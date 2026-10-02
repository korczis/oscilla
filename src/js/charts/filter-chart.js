// Filter magnitude response (uPlot): log frequency, dB. The curve is whatever the caller's
// getResponse() returns — in OSCILLA, createFilterStage().getResponse(), i.e. the browser's own
// BiquadFilterNode.getFrequencyResponse(); nothing is computed or smoothed here.
// The cutoff handle is a circle on the curve. Drag it (or anywhere on the plot): x sets the
// cutoff, vertical movement sets Q (up = higher); the wheel also changes Q. The shell's cutoff
// and Q fields/sliders are the keyboard alternative.

import uPlot from 'uplot';
import { logFrequencies } from '../audio/filters.js';
import { logTicks, formatHzTick, formatDbTick, linearTicks, clamp } from './axes.js';
import { cutoffFromX, qFromDrag, qFromWheel, FILTER_DRAG } from './drag-math.js';
import { chartTheme, withAlpha, uplotAxis, canvasFont, observeSize } from './chart-theme.js';

const DEFAULTS = {
  minHz: 20,
  maxHz: 20000,
  minDb: -30,
  maxDb: 17,
  dbTicks: [12, 0, -12, -24],
  points: 256,
  handleRadius: 5,
};

/**
 * createFilterChart(host, { getResponse(freqHz, out) → { magDb, enabled }, onChange(patch),
 *                           getNote() → string | null (small label, e.g. an assumed rate) })
 *   chart.update(config)  config: { type, frequency, Q, gain, enabled } → re-reads the response
 *   chart.getData() → { x: number[], y: number[] } raw response in dB (tests)
 *   chart.dispose()
 * onChange receives { frequency } and/or { Q } while dragging or wheeling.
 */
export function createFilterChart(host, options = {}) {
  const o = { ...DEFAULTS, ...options };
  const freqs = logFrequencies(o.points, o.minHz, o.maxHz);
  const xs = Float64Array.from(freqs);
  const plotted = new Float64Array(o.points);
  const out = { magDb: new Float32Array(o.points), phaseDeg: new Float32Array(o.points) };
  const one = new Float32Array(1);
  const oneOut = { magDb: new Float32Array(1), phaseDeg: new Float32Array(1) };
  let config = null;
  let enabled = true;
  let handleDb = null;
  let theme = chartTheme();
  let u = null;
  let drag = null;

  function readResponse() {
    if (!config || !o.getResponse) return;
    const res = o.getResponse(freqs, out);
    enabled = res.enabled !== false;
    const floor = o.minDb - 6;
    for (let i = 0; i < o.points; i++) {
      const v = res.magDb[i];
      plotted[i] = Number.isFinite(v) ? Math.max(floor, Math.min(o.maxDb + 6, v)) : floor;
    }
    one[0] = clamp(config.frequency, o.minHz, o.maxHz);
    const h = o.getResponse(one, oneOut);
    handleDb = Number.isFinite(h.magDb[0]) ? h.magDb[0] : null;
  }

  function drawHandle(self) {
    if (!config) return;
    const ctx = self.ctx;
    const dpr = self.pxRatio || 1;
    const f = clamp(config.frequency, o.minHz, o.maxHz);
    const db = clamp(handleDb == null ? o.minDb : handleDb, o.minDb, o.maxDb);
    const x = self.valToPos(f, 'x', true);
    const y = self.valToPos(db, 'y', true);
    ctx.save();
    ctx.lineWidth = 1.5 * dpr;
    ctx.strokeStyle = curveColour();
    ctx.fillStyle = theme.surface1;
    ctx.beginPath();
    ctx.arc(x, y, o.handleRadius * dpr, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    const note = !enabled ? 'BYPASSED' : o.getNote ? o.getNote() : null;
    if (note) {
      ctx.font = canvasFont(theme, theme.fs2xs * dpr);
      ctx.fillStyle = theme.textMuted;
      ctx.textAlign = 'right';
      ctx.textBaseline = 'top';
      ctx.fillText(note, self.bbox.left + self.bbox.width - 4 * dpr, self.bbox.top + 4 * dpr);
    }
    ctx.restore();
  }

  // Bypassed: the same response (what enabling would apply) in the trace colour at reduced
  // opacity, labelled BYPASSED; never a different curve.
  function curveColour() {
    return enabled ? theme.trace : withAlpha(theme.trace, 0.45);
  }

  function build() {
    if (u) u.destroy();
    theme = chartTheme();
    const w = Math.max(60, host.clientWidth);
    const h = Math.max(40, host.clientHeight);
    let fill = null;
    const opts = {
      width: w,
      height: h,
      legend: { show: false },
      padding: [8, 7, 0, 0], // reference geometry: plot 8 px below the host top
      cursor: { show: false, drag: { x: false, y: false, setScale: false } },
      select: { show: false },
      scales: {
        x: { time: false, auto: false, distr: 3, log: 10, range: () => [o.minHz, o.maxHz] },
        y: { auto: false, range: () => [o.minDb, o.maxDb] },
      },
      axes: [
        uplotAxis(theme, {
          scale: 'x',
          size: 12,
          gap: 1,
          font: canvasFont(theme, 9),
          splits: () => logTicks(o.minHz, o.maxHz),
          values: (self, s) => s.map(formatHzTick),
        }),
        uplotAxis(theme, {
          scale: 'y',
          size: 38,
          font: canvasFont(theme, 9.5),
          splits: () => o.dbTicks || linearTicks(o.minDb, o.maxDb, { step: 12 }),
          values: (self, s) => s.map((v) => formatDbTick(v, 'all')),
        }),
      ],
      series: [
        {},
        {
          label: 'Response',
          width: 2,
          points: { show: false },
          stroke: () => curveColour(),
          fillTo: () => o.minDb,
          fill: (self) => {
            const { top, height } = self.bbox;
            if (!fill || fill.key !== `${top}:${height}:${enabled}`) {
              const g = self.ctx.createLinearGradient(0, top, 0, top + height);
              g.addColorStop(0, withAlpha(theme.trace, enabled ? 0.34 : 0.12));
              g.addColorStop(1, withAlpha(theme.trace, enabled ? 0.04 : 0.01));
              fill = { key: `${top}:${height}:${enabled}`, g };
            }
            return fill.g;
          },
        },
      ],
      hooks: { draw: [drawHandle] },
    };
    u = new uPlot(opts, [xs, plotted], host);
    bindPointer();
  }

  function plotX(e) {
    const r = u.over.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top, w: r.width };
  }

  function emit(patch) {
    if (o.onChange) o.onChange(patch);
  }

  function bindPointer() {
    const over = u.over;
    over.style.cursor = 'ew-resize';
    over.style.touchAction = 'none';
    over.addEventListener('pointerdown', (e) => {
      if (!config || e.button > 0) return;
      const p = plotX(e);
      drag = { id: e.pointerId, y0: p.y, q0: config.Q };
      try {
        over.setPointerCapture(e.pointerId);
      } catch (err) {
        /* capture is optional */
      }
      emit({ frequency: cutoffFromX(p.x, p.w, o.minHz, o.maxHz) });
      e.preventDefault();
    });
    over.addEventListener('pointermove', (e) => {
      if (!drag || e.pointerId !== drag.id) return;
      const p = plotX(e);
      emit({
        frequency: cutoffFromX(p.x, p.w, o.minHz, o.maxHz),
        Q: qFromDrag(drag.q0, p.y - drag.y0),
      });
    });
    const end = (e) => {
      if (drag && e.pointerId === drag.id) drag = null;
    };
    over.addEventListener('pointerup', end);
    over.addEventListener('pointercancel', end);
    over.addEventListener(
      'wheel',
      (e) => {
        if (!config) return;
        e.preventDefault();
        emit({ Q: qFromWheel(config.Q, e.deltaY) });
      },
      { passive: false },
    );
  }

  const stopObserve = observeSize(host, () => {
    if (!u || !host.clientWidth || !host.clientHeight) return; // hidden host: keep last size
    u.setSize({ width: Math.max(60, host.clientWidth), height: Math.max(40, host.clientHeight) });
  });

  build();

  return {
    get uplot() {
      return u;
    },
    get limits() {
      return { ...FILTER_DRAG, minHz: o.minHz, maxHz: o.maxHz };
    },
    update(next) {
      config = { ...next };
      readResponse();
      u.setData([xs, plotted], false);
      u.redraw(true, false);
    },
    refreshTheme() {
      build();
      if (config) u.setData([xs, plotted], false);
      u.redraw(true, false);
    },
    getData() {
      return { x: Array.from(freqs), y: Array.from(out.magDb), handleDb };
    },
    dispose() {
      stopObserve();
      if (u) u.destroy();
      u = null;
    },
  };
}
