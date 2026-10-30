// Y001 spike (branch spike/gl-views, never merged): raw WebGL backend. webgl2 when the browser
// gives it, else webgl1. The level ring is one single-channel texture (R8 on webgl2, LUMINANCE
// on webgl1) updated one column per frame with texSubImage2D and drawn as one full-canvas
// triangle whose u coordinate is offset by the ring head (REPEAT wrap), coloured in the
// fragment shader. The XY trace is one dynamic vertex buffer updated with bufferSubData and
// drawn as one LINE_STRIP. Nothing is allocated per frame.

const VS1 = 'attribute vec2 p; varying vec2 uv; void main(){ uv = p * 0.5 + 0.5; '
  + 'gl_Position = vec4(p, 0.0, 1.0); }';
const VS2 = '#version 300 es\nin vec2 p; out vec2 uv; void main(){ uv = p * 0.5 + 0.5; '
  + 'gl_Position = vec4(p, 0.0, 1.0); }';
// Colour ramp: dark blue -> purple -> orange -> pale yellow (an approximation, not the theme).
const RAMP = 'vec3 ramp(float v){ return clamp(vec3(1.6*v-0.2, v*v*1.1, 0.35+0.6*v-0.9*v*v), '
  + '0.0, 1.0); }';
const FS1 = `precision mediump float; varying vec2 uv; uniform sampler2D t; uniform float h;
${RAMP} void main(){ float v = texture2D(t, vec2(fract(uv.x + h), uv.y)).r;
gl_FragColor = vec4(ramp(v), 1.0); }`;
const FS2 = `#version 300 es
precision mediump float; in vec2 uv; uniform sampler2D t; uniform float h; out vec4 o;
${RAMP} void main(){ float v = texture(t, vec2(fract(uv.x + h), uv.y)).r; o = vec4(ramp(v), 1.0); }`;
const XY_VS1 = 'attribute vec2 p; void main(){ gl_Position = vec4(p * 0.95, 0.0, 1.0); }';
const XY_VS2 = '#version 300 es\nin vec2 p; void main(){ gl_Position = vec4(p * 0.95, 0.0, 1.0); }';
const XY_FS1 = 'precision mediump float; void main(){ gl_FragColor = vec4(0.45, 1.0, 0.55, 1.0); }';
const XY_FS2 = '#version 300 es\nprecision mediump float; out vec4 o; '
  + 'void main(){ o = vec4(0.45, 1.0, 0.55, 1.0); }';

// sync(): a 1-pixel readback, which waits for the drawing to finish (the bench's --sync run).
const PIXEL = new Uint8Array(4);

function context(canvas) {
  const attrs = { antialias: false, alpha: false, preserveDrawingBuffer: false };
  const gl2 = canvas.getContext('webgl2', attrs);
  if (gl2) return { gl: gl2, version: 2 };
  const gl1 = canvas.getContext('webgl', attrs);
  if (gl1) return { gl: gl1, version: 1 };
  throw new Error('no WebGL context');
}

function program(gl, vs, fs) {
  const sh = (type, src) => {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
    return s;
  };
  const p = gl.createProgram();
  gl.attachShader(p, sh(gl.VERTEX_SHADER, vs));
  gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
  return p;
}

/** Level ring of `cols` x `rows` levels (0..255). push(column) then draw() once per frame. */
export function createRing(canvas, cols, rows) {
  canvas.width = cols;
  canvas.height = rows;
  const { gl, version } = context(canvas);
  const prog = program(gl, version === 2 ? VS2 : VS1, version === 2 ? FS2 : FS1);
  gl.useProgram(prog);
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(prog, 'p');
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  const fmt = version === 2 ? gl.RED : gl.LUMINANCE;
  const internal = version === 2 ? gl.R8 : gl.LUMINANCE;
  gl.texImage2D(gl.TEXTURE_2D, 0, internal, cols, rows, 0, fmt, gl.UNSIGNED_BYTE,
    new Uint8Array(cols * rows));
  const uHead = gl.getUniformLocation(prog, 'h');
  gl.uniform1i(gl.getUniformLocation(prog, 't'), 0);
  gl.viewport(0, 0, cols, rows);
  let head = -1;
  return {
    info: { backend: 'raw-gl', webglVersion: version },
    push(column) {
      head = (head + 1) % cols;
      gl.texSubImage2D(gl.TEXTURE_2D, 0, head, 0, 1, rows, fmt, gl.UNSIGNED_BYTE, column);
    },
    sync() {
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, PIXEL);
    },
    draw() {
      // The newest column sits at the right edge: u = 0 maps to the column after the head.
      gl.uniform1f(uHead, (head + 1) / cols);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    },
  };
}

/** XY trace of `n` points; draw(xy) takes interleaved x, y in [-1, 1]. */
export function createXY(canvas, n, size) {
  canvas.width = size;
  canvas.height = size;
  const { gl, version } = context(canvas);
  const prog = program(gl, version === 2 ? XY_VS2 : XY_VS1, version === 2 ? XY_FS2 : XY_FS1);
  gl.useProgram(prog);
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, n * 2 * 4, gl.DYNAMIC_DRAW);
  const loc = gl.getAttribLocation(prog, 'p');
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  gl.viewport(0, 0, size, size);
  gl.clearColor(0.02, 0.02, 0.05, 1);
  return {
    info: { backend: 'raw-gl', webglVersion: version },
    draw(xy) {
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, xy);
      gl.drawArrays(gl.LINE_STRIP, 0, n);
    },
    sync() {
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, PIXEL);
    },
  };
}
