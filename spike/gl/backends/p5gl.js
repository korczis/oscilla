// Y001 spike (branch spike/gl-views, never merged): p5's WEBGL renderer, used the idiomatic
// p5 way (the shipped p5@1.11.3 block; window.p5 must be loaded before this module). The level
// ring is a p5.Image whose pixels get one colour-mapped column per frame and updatePixels(),
// textured onto one quad with textureWrap(REPEAT) and a u offset by the ring head (p5 then
// re-uploads the whole image as a texture: that is what p5's API gives). The XY trace is
// beginShape()/vertex() x n/endShape() with a 1 px stroke (p5's immediate mode). Each frame
// is p.redraw() on a noLoop() sketch so the bench, not p5, owns the frame loop.

const LUT = new Uint8ClampedArray(256 * 4);
for (let i = 0; i < 256; i++) {
  const v = i / 255;
  const c = (x) => Math.round(255 * Math.min(1, Math.max(0, x)));
  LUT[i * 4] = c(1.6 * v - 0.2);
  LUT[i * 4 + 1] = c(v * v * 1.1);
  LUT[i * 4 + 2] = c(0.35 + 0.6 * v - 0.9 * v * v);
  LUT[i * 4 + 3] = 255;
}

const PIXEL = new Uint8Array(4); // sync(): a 1-pixel readback (the bench's --sync run)

function sketch(host, w, h, draw) {
  return new Promise((resolve, reject) => {
    // eslint-disable-next-line no-new, new-cap
    const inst = new window.p5((p) => {
      p.setup = () => {
        try {
          p.pixelDensity(1);
          p.createCanvas(w, h, p.WEBGL);
          p.noLoop();
          resolve(p);
        } catch (e) {
          reject(e);
        }
      };
      p.draw = () => draw(p);
    }, host);
    void inst;
  });
}

/** Level ring of `cols` x `rows` levels (0..255). push(column) then draw() once per frame. */
export async function createRing(host, cols, rows) {
  let img = null;
  let head = -1;
  const p = await sketch(host, cols, rows, (pp) => {
    if (!img) return;
    pp.background(0);
    pp.noStroke();
    pp.textureMode(pp.NORMAL);
    pp.textureWrap(pp.REPEAT, pp.CLAMP);
    pp.texture(img);
    const u0 = (head + 1) / cols;
    pp.beginShape();
    pp.vertex(-cols / 2, -rows / 2, 0, u0, 0);
    pp.vertex(cols / 2, -rows / 2, 0, u0 + 1, 0);
    pp.vertex(cols / 2, rows / 2, 0, u0 + 1, 1);
    pp.vertex(-cols / 2, rows / 2, 0, u0, 1);
    pp.endShape(pp.CLOSE);
  });
  img = p.createImage(cols, rows);
  img.loadPixels();
  const px = img.pixels;
  for (let i = 3; i < px.length; i += 4) px[i] = 255;
  img.updatePixels();
  return {
    info: { backend: 'p5-webgl', p5: p.VERSION || window.p5.VERSION || null,
      webglVersion: p._renderer && p._renderer.webglVersion,
      isRendererGL: !!(window.p5.RendererGL && p._renderer instanceof window.p5.RendererGL) },
    push(column) {
      head = (head + 1) % cols;
      // Image row 0 is the top: the lowest bin goes to the bottom row.
      for (let r = 0; r < rows; r++) {
        const l = column[r] * 4;
        const o = ((rows - 1 - r) * cols + head) * 4;
        px[o] = LUT[l];
        px[o + 1] = LUT[l + 1];
        px[o + 2] = LUT[l + 2];
      }
      img.updatePixels();
    },
    draw() {
      p.redraw();
    },
    sync() {
      p.drawingContext.readPixels(0, 0, 1, 1, p.drawingContext.RGBA,
        p.drawingContext.UNSIGNED_BYTE, PIXEL);
    },
  };
}

/** XY trace of `n` points; draw(xy) takes interleaved x, y in [-1, 1]. */
export async function createXY(host, n, size) {
  let cur = null;
  const k = (size / 2) * 0.95;
  const p = await sketch(host, size, size, (pp) => {
    if (!cur) return;
    pp.background(5, 5, 13);
    pp.noFill();
    pp.stroke(115, 255, 140);
    pp.strokeWeight(1);
    pp.beginShape();
    for (let i = 0; i < n; i++) pp.vertex(cur[2 * i] * k, -cur[2 * i + 1] * k);
    pp.endShape();
  });
  return {
    info: { backend: 'p5-webgl', p5: p.VERSION || window.p5.VERSION || null,
      webglVersion: p._renderer && p._renderer.webglVersion,
      isRendererGL: !!(window.p5.RendererGL && p._renderer instanceof window.p5.RendererGL) },
    draw(xy) {
      cur = xy;
      p.redraw();
    },
    sync() {
      p.drawingContext.readPixels(0, 0, 1, 1, p.drawingContext.RGBA,
        p.drawingContext.UNSIGNED_BYTE, PIXEL);
    },
  };
}
