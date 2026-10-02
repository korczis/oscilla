// V2 p5 views for the primary analysis panel, hosted by visualization/p5-host.js next to the
// V1 views (wave, path, phase):
//   scope      the real output analyser trace over the selected time window (5–100 ms), with a
//              rising-zero-crossing trigger, ms ticks and a min/max band when the cycles are
//              denser than the pixels; idle: the configured waveform computed analytically over
//              the same window, drawn dim and labelled "not playing".
//   harmonics  the theoretical partials of the built-in oscillator (bridge.state.harm, from
//              visualization/harmonics.js harmonicTable) as bars on a log-frequency axis,
//              with the Nyquist line; partials above Nyquist are outlined only.
// Views follow the host contract { id, layout?(h), draw(h, st, now) }; per frame they build no
// arrays or closures and never touch the DOM.

import { clamp, sig } from '../core/math.js';
import { formatFrequency } from '../core/frequency.js';
import { waveSample } from '../visualization/waveform.js';
import {
  HARMONIC_DB_GRID, harmonicAxis, harmonicBarFraction,
} from '../visualization/harmonics.js';

const GUTTER = { l: 30, r: 6, t: 16, b: 15 };

function msLabel(ms) {
  return ms >= 10 ? `${Math.round(ms)} ms` : `${sig(ms, 2)} ms`;
}

/** Tick step (ms) giving about 5–8 ticks across `windowMs`. */
export function scopeTickStep(windowMs) {
  const steps = [0.5, 1, 2, 5, 10, 20, 25, 50];
  for (const s of steps) if (windowMs / s <= 8) return s;
  return 100;
}

/**
 * createScopeView({ getWindowMs }) -> view. getWindowMs() returns the selected window in ms.
 */
export function createScopeView({ getWindowMs }) {
  return {
    id: 'scope',
    draw(h, st) {
      const { p, W, H, pal, label, bandMin, bandMax } = h;
      const L = st.live;
      const x0 = GUTTER.l;
      const x1 = W - GUTTER.r;
      const y0 = GUTTER.t;
      const y1 = H - GUTTER.b;
      const ymid = (y0 + y1) / 2;
      const hh = Math.max(1, (y1 - y0) / 2 - 2);
      const cols = Math.max(1, Math.min(bandMin.length, Math.floor(x1 - x0)));
      const windowMs = clamp(Number(getWindowMs()) || 5, 0.5, 200);

      // grid: ms ticks, 0 / ±1 lines
      p.stroke(pal.gridSoft);
      p.strokeWeight(1);
      const step = scopeTickStep(windowMs);
      for (let t = 0; t <= windowMs + 1e-9; t += step) {
        const x = x0 + (t / windowMs) * (x1 - x0);
        p.line(x, y0, x, y1);
        const last = t > windowMs - step / 2;
        label(t === 0 ? '0' : msLabel(t), last ? x1 : x, H - 3, pal.muted, 9,
          t === 0 ? p.LEFT : last ? p.RIGHT : p.CENTER);
      }
      p.line(x0, ymid, x1, ymid);
      p.line(x0, ymid - hh, x1, ymid - hh);
      p.line(x0, ymid + hh, x1, ymid + hh);
      label('+1', x0 - 4, ymid - hh + 3, pal.muted, 9, p.RIGHT);
      label('0', x0 - 4, ymid + 3, pal.muted, 9, p.RIGHT);
      label('-1', x0 - 4, ymid + hh + 3, pal.muted, 9, p.RIGHT);

      const d = L.timeData;
      const sr = L.sampleRate;
      const live = !!(d && st.playing && sr > 0);
      const g = Math.max(st.gain, 1e-4);
      if (live) {
        const win = Math.max(8, Math.min(d.length >> 1, Math.round((windowMs / 1000) * sr)));
        let start = 0;
        const searchEnd = d.length - win;
        for (let i = 1; i < searchEnd; i++) { if (d[i - 1] < 0 && d[i] >= 0) { start = i; break; } }
        const spc = win / cols;
        // Fewer than 4 samples per cycle: a polyline through the samples would show a false
        // beat (V1 rule): draw the min/max band, widened by 1 ms so its edges do not ripple.
        const f = Number.isFinite(L.inst) && L.inst > 0 ? L.inst : L.refFreq;
        const sparse = f > 0 && sr / f < 4;
        if (spc <= 1.5 && !sparse) {
          p.noFill();
          p.stroke(pal.accent);
          p.strokeWeight(1.6);
          p.beginShape();
          for (let i = 0; i < win; i++) {
            p.vertex(x0 + (i / (win - 1)) * (x1 - x0), ymid - clamp(d[start + i] / g, -1.15, 1.15) * hh);
          }
          p.endShape();
        } else {
          const pad = sparse ? Math.ceil(sr * 0.001) : 0;
          for (let c = 0; c < cols; c++) {
            const a0 = Math.max(0, start + Math.floor(c * spc) - pad);
            const a1 = Math.min(d.length, start + Math.max(Math.floor((c + 1) * spc),
              Math.floor(c * spc) + 1) + pad);
            let lo = Infinity;
            let hi = -Infinity;
            for (let i = a0; i < a1; i++) {
              const v = d[i];
              if (v < lo) lo = v;
              if (v > hi) hi = v;
            }
            if (lo > hi) { lo = 0; hi = 0; }
            bandMin[c] = ymid - clamp(lo / g, -1.15, 1.15) * hh;
            bandMax[c] = ymid - clamp(hi / g, -1.15, 1.15) * hh;
          }
          drawBand(p, pal, x0, cols, bandMin, bandMax, pal.accent, pal.accentSoft);
        }
        const room = x1 - x0 - 4;
        const head = `output analyser · ${msLabel(windowMs)} window`;
        label(h.pickFit([
          `${head} · relative to set gain${sparse ? ' · < 4 samples per cycle: min/max band' : ''}`,
          `${head}${sparse ? ' · min/max band' : ''}`, head, 'output analyser'], 9, room),
        x0 + 2, 11, pal.muted, 9);
        return;
      }

      // Idle: the configured waveform, computed (not measured), dim.
      let f = L.refFreq;
      if (!(f > 0)) f = st.frequency;
      const plan = st.plan;
      const shape = plan && plan.type === 'dual' ? plan.a.wave : st.waveform;
      const cyclesPerCol = (f * windowMs / 1000) / cols;
      if (cyclesPerCol < 0.25) {
        p.noFill();
        p.stroke(pal.dim);
        p.strokeWeight(1.4);
        p.beginShape();
        const n = Math.min(cols * 2, 1200);
        for (let i = 0; i <= n; i++) {
          const t = (i / n) * (windowMs / 1000);
          p.vertex(x0 + (i / n) * (x1 - x0), ymid - waveSample(shape, f * t) * hh);
        }
        p.endShape();
      } else {
        for (let c = 0; c < cols; c++) {
          bandMin[c] = ymid + hh;
          bandMax[c] = ymid - hh;
        }
        drawBand(p, pal, x0, cols, bandMin, bandMax, pal.dim, pal.accentFaint);
      }
      const state = L.hasCtx ? 'not playing' : 'audio not started';
      const what = `computed ${formatFrequency(f)} ${shape}`;
      label(h.pickFit([
        `${state} · ${what} over ${msLabel(windowMs)} · press Hold to Play for the live trace`,
        `${state} · ${what} over ${msLabel(windowMs)}`, `${state} · ${what}`, state],
      9, x1 - x0 - 4), x0 + 2, 11, pal.muted, 9);
    },
  };
}

function drawBand(p, pal, x0, cols, bandMin, bandMax, stroke, fill) {
  p.fill(fill);
  p.stroke(stroke);
  p.strokeWeight(1);
  p.beginShape();
  for (let c = 0; c < cols; c++) p.vertex(x0 + c + 0.5, bandMax[c]);
  for (let c = cols - 1; c >= 0; c--) p.vertex(x0 + c + 0.5, bandMin[c]);
  p.endShape(p.CLOSE);
}

/** createHarmonicBarsView() -> view drawing bridge.state.harm (and harmB for dual). */
export function createHarmonicBarsView() {
  return {
    id: 'harmonicBars',
    draw(h, st) {
      const { p, W, H, pal, label, logX, dashedV } = h;
      const hm = st.harm;
      const hb = st.source === 'dual' ? st.harmB : null;
      const x0 = 34;
      const x1 = W - 10;
      const y0 = 22;
      const y1 = H - 18;
      label('THEORETICAL OSCILLATOR SPECTRUM (computed from the waveform, not measured)',
        x0, 13, pal.fg, 10);
      p.stroke(pal.gridSoft);
      p.strokeWeight(1);
      for (const db of HARMONIC_DB_GRID) {
        const y = y1 - harmonicBarFraction(db) * (y1 - y0);
        p.line(x0, y, x1, y);
        label(`${db}`, x0 - 4, y + 3, pal.muted, 9, p.RIGHT);
      }
      const axis = harmonicAxis(hm, hb);
      if (!axis) {
        label('UNAVAILABLE', x0 + 4, (y0 + y1) / 2, pal.muted, 10);
        return;
      }
      const ny = st.nyquist;
      if (ny > axis.fmin && ny < axis.fmax) {
        const nx = logX(ny, axis.fmin, axis.fmax, x0, x1);
        dashedV(nx, y0, y1, pal.warn);
        label(`Nyquist ${formatFrequency(ny)}${st.provisional ? ' (provisional)' : ''}`,
          Math.min(nx - 4, x1 - 4), y0 + 9, pal.warn, 9, p.RIGHT);
      }
      drawSet(hm, pal.accent, -2);
      if (hb && hb.list.length) drawSet(hb, pal.accent2, 2);
      label(hm.summary, x0, H - 4, pal.muted, 9);

      function drawSet(table, col, dx) {
        for (let i = 0; i < table.list.length; i++) {
          const it = table.list[i];
          const x = logX(it.f, axis.fmin, axis.fmax, x0, x1) + dx;
          const frac = clamp(harmonicBarFraction(it.db), 0, 1);
          const top = y1 - frac * (y1 - y0);
          if (it.below) { p.noStroke(); p.fill(col); } else { p.noFill(); p.stroke(col); }
          p.rect(x - 2, top, 4, Math.max(1, y1 - top));
        }
      }
    },
  };
}
