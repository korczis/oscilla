// Y001 spike (branch spike/gl-views, never merged): Canvas 2D backend. The level ring is an
// offscreen 2D canvas the size of the ring; each frame one colour-mapped 1 x rows ImageData
// column is put at the head and the visible canvas draws the ring in two drawImage pieces
// (oldest part left, newest part right). The XY trace is one path of n points, one stroke().
// Nothing is allocated per frame by this module (the browser may allocate internally).

const LUT = new Uint8ClampedArray(256 * 4);
for (let i = 0; i < 256; i++) {
  const v = i / 255;
  const c = (x) => Math.round(255 * Math.min(1, Math.max(0, x)));
  LUT[i * 4] = c(1.6 * v - 0.2);
  LUT[i * 4 + 1] = c(v * v * 1.1);
  LUT[i * 4 + 2] = c(0.35 + 0.6 * v - 0.9 * v * v);
  LUT[i * 4 + 3] = 255;
}

/** Level ring of `cols` x `rows` levels (0..255). push(column) then draw() once per frame. */
export function createRing(canvas, cols, rows) {
  canvas.width = cols;
  canvas.height = rows;
  const ctx = canvas.getContext('2d', { alpha: false });
  const ring = document.createElement('canvas');
  ring.width = cols;
  ring.height = rows;
  const rctx = ring.getContext('2d', { alpha: false });
  const col = rctx.createImageData(1, rows);
  const px = col.data;
  let head = -1;
  return {
    info: { backend: 'canvas2d' },
    push(column) {
      head = (head + 1) % cols;
      // Row 0 of the texture is the lowest bin; canvas row 0 is the top.
      for (let r = 0; r < rows; r++) {
        const l = column[r] * 4;
        const o = (rows - 1 - r) * 4;
        px[o] = LUT[l];
        px[o + 1] = LUT[l + 1];
        px[o + 2] = LUT[l + 2];
        px[o + 3] = 255;
      }
      rctx.putImageData(col, head, 0);
    },
    draw() {
      const older = cols - head - 1; // columns after the head: the oldest, drawn left
      if (older > 0) ctx.drawImage(ring, head + 1, 0, older, rows, 0, 0, older, rows);
      ctx.drawImage(ring, 0, 0, head + 1, rows, older, 0, head + 1, rows);
    },
    // sync(): a 1-pixel readback, which waits for rasterisation (allocates one ImageData).
    sync() {
      ctx.getImageData(0, 0, 1, 1);
    },
  };
}

/** XY trace of `n` points; draw(xy) takes interleaved x, y in [-1, 1]. */
export function createXY(canvas, n, size) {
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d', { alpha: false });
  const half = size / 2;
  const k = half * 0.95;
  return {
    info: { backend: 'canvas2d' },
    draw(xy) {
      ctx.fillStyle = '#05050d';
      ctx.fillRect(0, 0, size, size);
      ctx.strokeStyle = '#73ff8c';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(half + xy[0] * k, half - xy[1] * k);
      for (let i = 1; i < n; i++) ctx.lineTo(half + xy[2 * i] * k, half - xy[2 * i + 1] * k);
      ctx.stroke();
    },
    sync() {
      ctx.getImageData(0, 0, 1, 1);
    },
  };
}
