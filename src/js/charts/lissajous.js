// Lissajous figure in p5 (instance mode): x = A(t) (or L), y = B(t) (or R), in a circular
// frame like the reference. Data comes from the phase-stereo controller: the stereo router's
// L/R analyser buffers while stereo plays, otherwise the analytic model of the configured A/B
// (labelled "model" by the view).

/**
 * Draw into rect { x, y, w, h } of p5 instance p.
 * liss: { x: Float32Array, y: Float32Array, start = 0, length, scale } — scale maps the
 * signal peak to the frame radius (1 for the unit-amplitude model; 1 / peak for live data).
 */
export function drawLissajous(p, rect, liss, theme) {
  const cx = rect.x + rect.w / 2;
  const cy = rect.y + rect.h / 2;
  const r = Math.max(4, Math.min(rect.w, rect.h) / 2 - 3);
  p.noFill();
  p.stroke(theme.borderStrong || theme.border);
  p.strokeWeight(1);
  p.circle(cx, cy, r * 2);
  if (!liss || !liss.x || !(liss.length > 1)) return;
  const k = (r - 6) * (liss.scale || 1);
  p.stroke(theme.cyan);
  p.strokeWeight(1.5);
  p.beginShape();
  const end = (liss.start || 0) + liss.length;
  for (let i = liss.start || 0; i < end; i++) {
    // Screen y grows downwards: positive B is drawn up.
    p.vertex(cx + liss.x[i] * k, cy - liss.y[i] * k);
  }
  p.endShape();
}
