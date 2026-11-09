// Waveform view (p5): the slowed visual model of the requested signal, the envelope strip, the
// real analyser trace (zero-cross trigger, min/max band when the cycles are too dense) and the
// real-signal readout. Extracted from V1 createSketch layoutWave/drawWave and waveSample
// (index.html@a7b7a23, section 9); bodies unchanged. The view reads only the bridge state and
// the host context (see p5-host.js); V2 extends it later (time window, ADSR/modulation reaction).

import { clamp, isNum } from '../core/math.js';
import { frequencyToNormalized } from '../core/frequency.js';
import { planFreqAt } from '../audio/patterns.js';

// V1: wave captions and notes (index.html@a7b7a23)
export const WAVE_TITLE = 'SLOWED VISUAL MODEL';
export const WAVE_DISCLAIMER = 'Visual representation — not real-time physical scale.';
export const WAVE_DISCLAIMER_A = 'Visual representation —';
export const WAVE_DISCLAIMER_B = 'not real-time physical scale.';
// Longest first; the sketch draws the first variant that fits the space it has.
export const DENSE_NOTES = ['cycles too dense to draw — band shows the min/max envelope', 'cycles too dense: min/max band', 'min/max band'];
export const CAPTIONS_AM = ['AM: level follows the modulator', 'AM: level', 'AM'];
export const CAPTIONS_FM = ['FM: cycle spacing follows the modulator', 'FM: spacing follows the modulator', 'FM: spacing', 'FM'];
export const CAPTIONS_LFO = ['LFO: cycle spacing glides with the LFO', 'LFO: frequency glides with the LFO', 'LFO: glide', 'LFO'];
export const DENSE_CYCLES = 60; // more cycles than this in the analyser window cannot be drawn as a line

// V1: waveSample (index.html@a7b7a23)
export function waveSample(shape, phase) {
  const p = phase - Math.floor(phase);
  switch (shape) {
    case 'square': return p < 0.5 ? 1 : -1;
    case 'sawtooth': return p < 0.5 ? 2 * p : 2 * p - 2;
    case 'triangle': return p < 0.25 ? 4 * p : p < 0.75 ? 2 - 4 * p : 4 * p - 4;
    default: return Math.sin(2 * Math.PI * p);
  }
}

/** The wave view's compact layout (one-line labels, readout row) below 300 × 200 CSS px. */
export function waveCompact(w, h) {
  // V1: waveCompact (index.html@a7b7a23)
  return w < 300 || h < 200;
}

/**
 * createWaveformView() -> { id: 'wave', layout(h), draw(h, st) } for createP5Host.
 * h: host context { p, W, H, pal, label, tw, fits, pickFit, viz, modelPhase, bandMin, bandMax }.
 */
export function createWaveformView() {
  let p; let W; let H; let pal; let label; let tw; let fits; let pickFit;
  let viz; let modelPhase; let bandMin; let bandMax;
  const bind = (h) => (
    { p, W, H, pal, label, tw, fits, pickFit, viz, modelPhase, bandMin, bandMax } = h);

  // wave layout, rebuilt by layoutWave() only when the canvas size changes
  const WV = {
    compact: false, ts: 10, t1: 16, discLines: 1, discSize: 9, discY: 29,
    mx0: 12, mx1: 100, my0: 40, my1: 100, ey0: 0, ey1: 0, envLabel: '', envX: 12, envLabelY: 0,
    rx0: 0, rx1: 0, ry0: 0, ry1: 0, rTitle: '', rTitleDense: '', rTitleSize: 10, rTitleY: 16,
    denseNote: '', denseY: 0, infoTitle: '', infoTitleSize: 10, infoTitleY: 0, infoRows: 1,
    infoSize: 9, infoY0: 0, infoStep: 12, infoValX: 0,
  };

  // V1: layoutWave (index.html@a7b7a23)
  /** Two layouts: 'side' (model left, analyser and real-signal block right) when the canvas
   *  is at least 300 × 200 px, else 'compact' (side-by-side columns, one-line labels, readout
   *  row at the bottom). Every box is laid out bottom-up from H, so none can invert. */
  function layoutWave() {
    const compact = waveCompact(W, H);
    WV.compact = compact;
    if (compact) {
      const ts = H >= 130 ? 9 : 8;
      const split = Math.round(W * (W >= 600 ? 0.6 : 0.55));
      WV.ts = ts;
      WV.t1 = ts + 2;
      WV.mx0 = 8;
      WV.mx1 = split - 6;
      WV.rx0 = split + 6;
      WV.rx1 = W - 8;
      WV.discSize = 8;
      WV.discLines = fits(WAVE_DISCLAIMER, 8, W - 16) ? 1 : 2;
      WV.discY = WV.t1 + 10;
      const top = WV.t1 + 10 * WV.discLines + 4;
      const bottom = H - 15;
      WV.ey1 = bottom;
      WV.ey0 = bottom - (H >= 150 ? 10 : 6);
      WV.envLabel = fits('ENVELOPE', 8, (WV.mx1 - WV.mx0) * 0.3) ? 'ENVELOPE' : 'ENV';
      WV.envX = WV.mx0 + tw(WV.envLabel, 8) + 4;
      WV.envLabelY = bottom;
      WV.my0 = top + 2;
      WV.my1 = WV.ey0 - 4;
      WV.ry0 = top + 2;
      WV.ry1 = Math.max(WV.ry0 + 8, bottom);
      const rw = WV.rx1 - WV.rx0;
      WV.rTitleSize = ts;
      WV.rTitleY = WV.t1;
      WV.rTitle = fits('ANALYSER OUTPUT', ts, rw) ? 'ANALYSER OUTPUT' : 'ANALYSER';
      WV.rTitleDense = 'ANALYSER';
      // compact: the density note shares the analyser title row
      WV.denseNote = pickFit(DENSE_NOTES, 8, rw - tw(WV.rTitleDense, ts) - 6);
      WV.denseY = WV.t1;
      WV.infoTitle = 'REAL SIGNAL';
      WV.infoTitleSize = 8;
      WV.infoTitleY = H - 4;
      WV.infoRows = 1;
      WV.infoSize = 8;
      WV.infoY0 = H - 4;
      WV.infoStep = 0;
      WV.infoValX = 8 + tw('REAL SIGNAL ', 8);
      return;
    }
    WV.ts = 10;
    WV.t1 = 16;
    WV.mx0 = 12;
    WV.mx1 = W * 0.62;
    WV.rx0 = W * 0.66;
    WV.rx1 = W - 12;
    const oneLine = 12 + tw(WAVE_DISCLAIMER, 9) <= WV.rx0 - 8;
    WV.discLines = oneLine ? 1 : 2;
    WV.discSize = oneLine ? 9 : 8;
    WV.discY = oneLine ? 29 : 28;
    WV.ey1 = H - 6;
    WV.ey0 = WV.ey1 - 16;
    WV.envLabel = 'ENVELOPE (relative level)';
    WV.envX = WV.mx0;
    WV.envLabelY = WV.ey0 - 3;
    WV.my0 = oneLine ? 40 : 46;
    WV.my1 = H - 34;
    const rw = WV.rx1 - WV.rx0;
    WV.rTitleSize = 10;
    WV.rTitleY = 16;
    WV.rTitle = fits('ANALYSER OUTPUT', 10, rw) ? 'ANALYSER OUTPUT' : 'ANALYSER';
    WV.rTitleDense = WV.rTitle;
    // real-signal block, bottom-up: rows, title, density note, then the analyser box
    const wideRows = H >= 280 && fits('frequency  15.50 kHz (start)', 10, rw);
    WV.infoRows = wideRows ? 3 : 2;
    WV.infoSize = wideRows ? 10 : fits('15.50 kHz · T 64.5 µs', 9, rw) ? 9 : 8;
    WV.infoStep = WV.infoSize + 4;
    WV.infoY0 = H - 8 - (WV.infoRows - 1) * WV.infoStep;
    WV.infoTitleSize = wideRows ? 10 : 9;
    WV.infoTitleY = WV.infoY0 - WV.infoStep - 2;
    WV.infoTitle = fits('REAL SIGNAL INFORMATION', WV.infoTitleSize, rw) ? 'REAL SIGNAL INFORMATION' : 'REAL SIGNAL';
    WV.denseNote = pickFit(DENSE_NOTES, 8, rw);
    WV.denseY = WV.infoTitleY - 14;
    WV.ry0 = 28;
    WV.ry1 = Math.max(WV.ry0 + 8, WV.denseY - 10);
    WV.infoValX = WV.rx0;
  }

  // V1: drawWave (index.html@a7b7a23)
  function drawWave(st) {
    const L = st.live;
    const lb = st.labels;
    const compact = WV.compact;
    const mx0 = WV.mx0;
    const mx1 = WV.mx1;
    const plan = L.plan;
    const am = plan && plan.type === 'am' ? plan.depth : 0;
    const fm = plan && plan.type === 'fm' ? Math.min(6, plan.depth / Math.max(1, plan.modFreq)) : 0;
    const lfo = plan && plan.type === 'lfo';
    const roomy = !compact && mx1 - mx0 >= 380;
    // on a narrow side layout the modulation caption gets its own row under the disclaimer
    const capRow = !compact && !roomy && (am || fm || lfo);
    const my0 = WV.my0 + (capRow ? 10 : 0);
    const my1 = WV.my1;
    let f = L.voice ? L.inst : planFreqAt(plan, modelPhase);
    if (!isNum(f)) f = L.refFreq;
    const shape = plan && plan.type === 'dual' ? plan.a.wave : st.waveform;
    // slowed model: visible cycles grow with log frequency
    const cycles = 1.5 + 12.5 * frequencyToNormalized(clamp(f, 20, 20000), 20, 20000);
    const amp = st.playing ? Math.max(0.12, Math.min(1, viz.envLevel)) : 0.55;
    const midY = (my0 + my1) / 2;
    const halfH = Math.max(1, (my1 - my0) / 2 - 2);
    p.stroke(pal.gridSoft);
    p.strokeWeight(1);
    p.line(mx0, midY, mx1, midY);
    label(WAVE_TITLE, mx0, WV.t1, pal.fg, WV.ts);
    if (WV.discLines === 1) {
      label(WAVE_DISCLAIMER, mx0, WV.discY, pal.muted, WV.discSize);
    } else {
      label(WAVE_DISCLAIMER_A, mx0, WV.discY, pal.muted, WV.discSize);
      label(WAVE_DISCLAIMER_B, mx0, WV.discY + 10, pal.muted, WV.discSize);
    }
    p.noFill();
    p.stroke(st.playing ? pal.accent : pal.dim);
    p.strokeWeight(2);
    p.beginShape();
    const n = Math.max(1, Math.min(480, Math.floor(mx1 - mx0)));
    for (let i = 0; i <= n; i++) {
      const x = i / n;
      let ph = x * cycles - modelPhase * 2;
      if (fm) ph += (fm / (2 * Math.PI)) * Math.sin(2 * Math.PI * (x * 2 - modelPhase * 0.5));
      let y = waveSample(shape, ph);
      if (am) y *= 1 - am / 2 + (am / 2) * Math.sin(2 * Math.PI * (x * 2 - modelPhase * 0.5));
      p.vertex(mx0 + x * (mx1 - mx0), midY - y * halfH * amp);
    }
    p.endShape();
    if (am || fm || lfo) {
      const caps = am ? CAPTIONS_AM : fm ? CAPTIONS_FM : CAPTIONS_LFO;
      if (compact) {
        // inline after the title, in whatever room the left column has
        const cx = mx0 + tw(WAVE_TITLE, WV.ts) + 6;
        const cap = pickFit(caps, 8, mx1 - cx);
        if (cap) label(cap, cx, WV.t1, pal.accent2, 8);
      } else if (capRow) {
        const cap = pickFit(caps, 8, mx1 - mx0);
        if (cap) label(cap, mx0, my0 - 4, pal.accent2, 8);
      } else {
        const cap = pickFit(caps, 9, mx1 - mx0 - tw(WAVE_TITLE, 10) - 12);
        if (cap) label(cap, mx1, 16, pal.accent2, 9, p.RIGHT);
      }
    }

    // envelope strip (relative level history)
    const ey0 = WV.ey0;
    const ey1 = WV.ey1;
    label(WV.envLabel, mx0, WV.envLabelY, pal.muted, 8);
    p.noStroke();
    p.fill(pal.accentSoft);
    const len = viz.envHistory.length;
    const ex0 = WV.envX;
    const bw = (mx1 - ex0) / len;
    for (let i = 0; i < len; i++) {
      const v = viz.envHistory[(viz.envIndex + i) % len];
      if (v > 0.002) p.rect(ex0 + i * bw, ey1 - Math.min(1, v) * (ey1 - ey0), Math.max(1, bw), Math.min(1, v) * (ey1 - ey0));
    }

    // real analyser trace + real signal info
    const rx0 = WV.rx0;
    const rx1 = WV.rx1;
    const ry0 = WV.ry0;
    const ry1 = WV.ry1;
    p.noFill();
    p.stroke(pal.grid);
    p.strokeWeight(1);
    p.rect(rx0, ry0, rx1 - rx0, ry1 - ry0);
    const d = L.timeData;
    let dense = false;
    if (d && st.playing && L.sampleRate > 0) {
      const win = Math.min(1024, d.length >> 1);
      let start = 0;
      for (let i = 1; i < d.length - win; i++) { if (d[i - 1] < 0 && d[i] >= 0) { start = i; break; } }
      const g = Math.max(st.gain, 1e-4);
      const ymid = (ry0 + ry1) / 2;
      const hh = Math.max(1, (ry1 - ry0) / 2 - 3);
      const cols = Math.max(1, Math.min(bandMin.length, Math.floor(rx1 - rx0)));
      const spc = win / cols; // samples per pixel column
      // fewer than two columns per cycle, or more cycles than a line can show: draw the band
      dense = f > L.sampleRate / (2 * Math.max(1, spc)) || f * (win / L.sampleRate) > DENSE_CYCLES;
      if (!dense) {
        // resolvable: every sample of the window (a decimated polyline would alias)
        p.stroke(pal.accent);
        p.strokeWeight(1.25);
        p.beginShape();
        for (let i = 0; i < win; i++) p.vertex(rx0 + (i / win) * (rx1 - rx0), ymid - clamp(d[start + i] / g, -1.1, 1.1) * hh);
        p.endShape();
      }
      // too dense: the sample min/max around each pixel column as a filled band instead of a
      // false slow wave. The window is widened to ~2 ms so the band's edges do not ripple with
      // the beat between the tone and the sample grid (15.5 kHz at 48 kHz beats at 500 Hz).
      const pad = Math.ceil(L.sampleRate * 0.001);
      for (let c = 0; dense && c < cols; c++) {
        const a0 = Math.max(0, start + Math.floor(c * spc) - pad);
        const a1 = Math.min(d.length, start + Math.max(Math.floor((c + 1) * spc), Math.floor(c * spc) + 1) + pad);
        let lo = Infinity;
        let hi = -Infinity;
        for (let i = a0; i < a1; i++) {
          const v = d[i];
          if (v < lo) lo = v;
          if (v > hi) hi = v;
        }
        if (lo > hi) { lo = 0; hi = 0; }
        bandMin[c] = ymid - clamp(lo / g, -1.1, 1.1) * hh;
        bandMax[c] = ymid - clamp(hi / g, -1.1, 1.1) * hh;
      }
      if (dense) {
        p.fill(pal.accentSoft);
        p.stroke(pal.accent);
        p.strokeWeight(1);
        p.beginShape();
        for (let c = 0; c < cols; c++) p.vertex(rx0 + c + 0.5, bandMax[c]);
        for (let c = cols - 1; c >= 0; c--) p.vertex(rx0 + c + 0.5, bandMin[c]);
        p.endShape(p.CLOSE);
      }
    } else {
      label(L.hasCtx ? 'press HOLD TO PLAY' : 'starts with audio', rx0 + 6, (ry0 + ry1) / 2 + 3, pal.muted, compact ? 8 : 9);
    }
    const rw = rx1 - rx0;
    if (compact && dense && WV.denseNote) {
      label(WV.rTitleDense, rx0, WV.rTitleY, pal.fg, WV.rTitleSize);
      label(WV.denseNote, rx1, WV.denseY, pal.warn, 8, p.RIGHT);
    } else {
      label(WV.rTitle, rx0, WV.rTitleY, pal.fg, WV.rTitleSize);
      if (d && st.playing && tw(WV.rTitle, WV.rTitleSize) + tw(lb.winMs, 9) + 8 <= rw) label(lb.winMs, rx1, WV.rTitleY, pal.muted, 9, p.RIGHT);
      if (!compact && dense && WV.denseNote) label(WV.denseNote, rx0, WV.denseY, pal.warn, 8);
    }
    label(WV.infoTitle, compact ? 8 : rx0, WV.infoTitleY, pal.fg, WV.infoTitleSize);
    if (compact) {
      const room = W - 8 - WV.infoValX;
      label(fits(lb.realCompact, 8, room) ? lb.realCompact : lb.realShort1, WV.infoValX, WV.infoY0, pal.muted, 8);
    } else if (WV.infoRows === 3) {
      label(lb.realWide1, rx0, WV.infoY0, pal.muted, WV.infoSize);
      label(lb.realWide2, rx0, WV.infoY0 + WV.infoStep, pal.muted, WV.infoSize);
      label(lb.realWide3, rx0, WV.infoY0 + 2 * WV.infoStep, pal.muted, WV.infoSize);
    } else {
      label(lb.realShort1, rx0, WV.infoY0, pal.muted, WV.infoSize);
      label(lb.realShort2, rx0, WV.infoY0 + WV.infoStep, pal.muted, WV.infoSize);
    }
  }

  return {
    id: 'wave',
    layout(h) { bind(h); layoutWave(); },
    draw(h, st) { bind(h); drawWave(st); },
  };
}
