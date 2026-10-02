// Phase view (p5): two-oscillator interference — A, B and A+B lanes, the beat envelope and
// slowed carriers with a capped animation rate. Extracted from V1 createSketch legendItem/
// drawInterference (index.html@a7b7a23, section 9); bodies unchanged. V2 extends it with the
// A/B phase offset and adds a Lissajous view next to it.

export const INTERFERENCE_SLOWED = 'carriers slowed — visual representation';

/**
 * createPhaseView() -> { id: 'interference', draw(h, st, now) } for createP5Host.
 * h: host context { p, W, H, pal, label, tw, fits }.
 */
export function createPhaseView() {
  let p; let W; let H; let pal; let label; let tw; let fits;
  const bind = (h) => ({ p, W, H, pal, label, tw, fits } = h);

  // interference lane geometry
  const laneY = new Float64Array(3);
  const laneH = new Float64Array(3);

  // V1: legendItem, drawInterference (index.html@a7b7a23)
  function legendItem(txt, x, y, col, size) {
    label(txt, x, y, col, size);
    return x + tw(txt, size) + 10;
  }
  function drawInterference(st, now) {
    const d = st.dual;
    const lb = st.labels;
    const delta = Math.abs(d.fa - d.fb);
    const compact = H < 160;
    const narrow = W < 520;
    const x0 = 12;
    const x1 = W - 12;
    const top = compact ? 26 : narrow ? 44 : 34;
    const bottom = H - (compact ? 12 : 16);
    const avail = bottom - top;
    // A and B lanes are thin; the sum lane gets most of the height.
    laneY[0] = top + avail * 0.11;
    laneY[1] = top + avail * 0.33;
    laneY[2] = top + avail * 0.72;
    laneH[0] = avail * 0.09;
    laneH[1] = avail * 0.09;
    laneH[2] = avail * 0.26;
    label(lb.beat, x0, compact ? 10 : 13, pal.fg, compact ? 8 : narrow ? 9 : 10);
    // legend instead of per-lane titles, so labels never overlap the traces
    const ly0 = compact ? 20 : 26;
    const ls = compact ? 8 : 9;
    let lx = legendItem(lb.legendA, x0, ly0, pal.accent, ls);
    lx = legendItem(lb.legendB, lx, ly0, pal.accent2, ls);
    lx = legendItem('A+B', lx, ly0, pal.fg, ls);
    lx = legendItem('envelope', lx, ly0, pal.warn, ls);
    if (compact) {
      // no row of its own: shares the legend row when there is room (the caption says it too)
      if (fits(INTERFERENCE_SLOWED, 8, x1 - lx)) label(INTERFERENCE_SLOWED, x1, ly0, pal.muted, 8, p.RIGHT);
    } else if (narrow) label(INTERFERENCE_SLOWED, x0, 37, pal.muted, 8);
    else label(INTERFERENCE_SLOWED, x1, 26, pal.muted, 9, p.RIGHT);
    // Visual model: two beats across the width, carriers ~10 cycles per beat.
    const beatsShown = 2;
    const k = 10 * beatsShown;
    const kb = d.fb >= d.fa ? k + beatsShown : k - beatsShown;
    const capped = Math.min(delta, 12);
    const offset = st.reducedMotion ? 0 : ((now / 1000) * capped) / beatsShown;
    const amax = Math.max(d.la + d.lb, 1e-3);
    const n = Math.min(600, Math.floor(x1 - x0));
    for (let li = 0; li < 3; li++) {
      const ly = laneY[li];
      const hh = laneH[li];
      p.stroke(pal.gridSoft);
      p.strokeWeight(1);
      p.line(x0, ly, x1, ly);
      p.noFill();
      p.stroke(li === 0 ? pal.accent : li === 1 ? pal.accent2 : pal.fg);
      p.strokeWeight(li === 2 ? 1.5 : 1.25);
      p.beginShape();
      for (let i = 0; i <= n; i++) {
        const x = i / n + offset;
        const a = d.la * Math.sin(2 * Math.PI * k * x);
        const b = d.lb * Math.sin(2 * Math.PI * (delta > 0.005 ? kb : k) * x);
        const y = li === 0 ? a / Math.max(d.la, 1e-3) : li === 1 ? b / Math.max(d.lb, 1e-3) : (a + b) / amax;
        p.vertex(x0 + (i / n) * (x1 - x0), ly - y * hh);
      }
      p.endShape();
      if (li === 2 && delta > 0.005) {
        p.stroke(pal.warn);
        p.strokeWeight(1.5);
        for (let sgn = 1; sgn >= -1; sgn -= 2) {
          p.beginShape();
          for (let i = 0; i <= n; i += 2) {
            const x = i / n + offset;
            const env = Math.sqrt(d.la * d.la + d.lb * d.lb + 2 * d.la * d.lb * Math.cos(2 * Math.PI * (kb - k) * x)) / amax;
            p.vertex(x0 + (i / n) * (x1 - x0), ly - sgn * env * hh);
          }
          p.endShape();
        }
      }
    }
    const ns = compact ? 8 : 9;
    label(fits(lb.interNote, ns, x1 - x0) ? lb.interNote : lb.interNoteNarrow, x0, H - (compact ? 3 : 4), pal.muted, ns);
  }

  return {
    id: 'interference',
    draw(h, st, now) { bind(h); drawInterference(st, now); },
  };
}
