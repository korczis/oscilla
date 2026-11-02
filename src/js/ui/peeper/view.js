// The peeper's view: ONE function draws a reading into the canvas. This is the placeholder
// (a plain line of read().frame); b0's W004 scope view replaces it through setPeeperView()
// without touching the shell. The view takes the sample rate only from the reading, never
// assumes one, and draws nothing that is not in the frame: a reading with live: false draws an
// empty plot, and the shell shows its reason instead.
//
//   drawPeeperLine(canvas, reading, { stroke, grid }) -> boolean (true when a frame was drawn)
//   setPeeperView(fn) / peeperView() -> the function the shell calls

export function drawPeeperLine(canvas, reading, { stroke = '#4da3ff', grid = '#52657a' } = {}) {
  const ctx = canvas && canvas.getContext ? canvas.getContext('2d') : null;
  if (!ctx) return false;
  const dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
  const w = Math.max(1, Math.round(canvas.clientWidth * dpr));
  const h = Math.max(1, Math.round(canvas.clientHeight * dpr));
  if (canvas.width !== w) canvas.width = w;
  if (canvas.height !== h) canvas.height = h;
  ctx.clearRect(0, 0, w, h);
  ctx.strokeStyle = grid;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, h / 2);
  ctx.lineTo(w, h / 2);
  ctx.stroke();
  const f = reading && reading.live ? reading.frame : null;
  if (!f || !f.length) return false;
  ctx.strokeStyle = stroke;
  ctx.lineWidth = Math.max(1, dpr * 1.5);
  ctx.beginPath();
  for (let i = 0; i < f.length; i += 1) {
    const x = (i / (f.length - 1 || 1)) * w;
    const y = h / 2 - Math.max(-1, Math.min(1, f[i])) * (h / 2 - 2);
    if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y);
  }
  ctx.stroke();
  return true;
}

let view = drawPeeperLine;

/** Swap the view (W004's scope). */
export function setPeeperView(fn) {
  view = typeof fn === 'function' ? fn : drawPeeperLine;
}

export function peeperView() {
  return view;
}
