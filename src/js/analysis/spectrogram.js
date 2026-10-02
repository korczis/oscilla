// Canvas spectrogram: time on x (newest at the right), frequency on y (log or linear, high at
// the top), relative analyser level as colour through a 256-entry LUT.
//
// Scroll strategy: a ring buffer. Each new column is written with putImageData into an
// OffscreenCanvas of the same size at a moving head index, and the visible canvas is composed
// with two drawImage blits (oldest part, then newest part). Per frame that is one 1-pixel-wide
// upload and two GPU copies, independent of history length, with no self-overlapping copy.
// Without OffscreenCanvas the renderer falls back to scrolling the visible canvas into itself
// with drawImage (defined by the canvas spec as copy-then-draw) and writing the new columns at
// the right edge. Both strategies only use the canvas they are given.
//
// Row mapping: each pixel row covers a frequency interval. When the interval holds two or more
// bin centres (high frequencies on a log axis) the row shows their maximum, so a narrow tone is
// never diluted. When it holds fewer (low frequencies, more rows than bins) the row samples the
// spectrum at its centre frequency by linear interpolation of dB between the two nearest bins,
// so the image is smooth instead of blocky and never invents a peak between bins.
//
// Time axis: columns advance with wall time (timeSpanS across the canvas width). When several
// columns are due in one frame (dropped frames) the latest analyser snapshot is repeated:
// sample-and-hold of a real measurement. Freezing or a hidden document pauses the time axis;
// nothing is written for the paused interval. A null spectrum (no analyser yet) or silence
// writes the floor colour — never synthetic data.

export const DEFAULT_SPECTROGRAM_STOPS = Object.freeze([
  { at: 0.0, color: [3, 5, 16] }, // floor: near-black navy
  { at: 0.18, color: [16, 19, 66] }, // navy
  { at: 0.4, color: [92, 29, 140] }, // purple
  { at: 0.6, color: [201, 42, 140] }, // magenta
  { at: 0.8, color: [248, 132, 40] }, // orange
  { at: 0.93, color: [253, 226, 84] }, // yellow
  { at: 1.0, color: [255, 252, 232] }, // near-white
]);

function parseColor(c) {
  if (Array.isArray(c) && c.length >= 3)
    return [c[0], c[1], c[2]].map((v) => Math.max(0, Math.min(255, v)));
  if (typeof c === 'string') {
    const m = /^#?([0-9a-f]{6})$/i.exec(c.trim());
    if (m) {
      const n = parseInt(m[1], 16);
      return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    }
  }
  throw new TypeError(`Unsupported colour stop ${JSON.stringify(c)}`);
}

/**
 * buildColorLut(stops) → Uint8ClampedArray(1024): RGBA for indices 0…255.
 * stops: [{ at: 0…1, color: [r, g, b] | '#rrggbb' }] or [[at, color]]; sorted here, ends extended.
 */
export function buildColorLut(stops = DEFAULT_SPECTROGRAM_STOPS) {
  const list = stops
    .map((s) => (Array.isArray(s) ? { at: s[0], color: s[1] } : s))
    .map((s) => ({ at: Math.max(0, Math.min(1, Number(s.at))), color: parseColor(s.color) }))
    .filter((s) => Number.isFinite(s.at))
    .sort((a, b) => a.at - b.at);
  if (list.length === 0) throw new RangeError('buildColorLut needs at least one stop');
  const lut = new Uint8ClampedArray(256 * 4);
  for (let i = 0; i < 256; i++) {
    const u = i / 255;
    let j = 0;
    while (j < list.length - 1 && list[j + 1].at < u) j++;
    const a = list[j];
    const b = list[Math.min(j + 1, list.length - 1)];
    let k = 0;
    if (u <= a.at) k = 0;
    else if (b.at > a.at) k = Math.min(1, (u - a.at) / (b.at - a.at));
    for (let ch = 0; ch < 3; ch++)
      lut[i * 4 + ch] = Math.round(a.color[ch] + (b.color[ch] - a.color[ch]) * k);
    lut[i * 4 + 3] = 255;
  }
  return lut;
}

/** LUT index of a dB value: 0 at or below minDb (and for −Infinity/NaN), 255 at or above maxDb. */
export function dbToLutIndex(db, minDb, maxDb) {
  if (!(db > minDb)) return 0;
  if (db >= maxDb) return 255;
  return Math.round(((db - minDb) / (maxDb - minDb)) * 255);
}

/** Frequency at a vertical position u (0 = bottom edge, 1 = top edge). */
export function frequencyAtPosition(u, minHz, maxHz, scale = 'log') {
  if (scale === 'linear') return minHz + (maxHz - minHz) * u;
  return minHz * (maxHz / minHz) ** u;
}

/** Vertical position (0 bottom … 1 top) of frequency f; inverse of frequencyAtPosition. */
export function positionAtFrequency(f, minHz, maxHz, scale = 'log') {
  if (scale === 'linear') return (f - minHz) / (maxHz - minHz);
  return Math.log(f / minHz) / Math.log(maxHz / minHz);
}

/** Centre frequency of pixel row y (row 0 at the top). */
export function rowFrequency(y, rows, minHz, maxHz, scale = 'log') {
  return frequencyAtPosition(1 - (y + 0.5) / rows, minHz, maxHz, scale);
}

/**
 * buildRowMap({ rows, binCount, binHz, minHz, maxHz, scale }) → row map
 * Per row: mode[y] = 1 → max over bins lo[y]…hi[y]; mode[y] = 0 → interpolate between bins
 * lo[y] and lo[y] + 1 with weight frac[y]. maxHz is clamped to the last bin.
 */
export function buildRowMap({ rows, binCount, binHz, minHz, maxHz, scale = 'log' }) {
  if (!(rows > 0) || !(binCount > 1) || !(binHz > 0))
    throw new RangeError('buildRowMap: invalid size');
  const top = Math.min(maxHz, (binCount - 1) * binHz);
  const bottom = Math.max(scale === 'log' ? 1e-3 : 0, Math.min(minHz, top * 0.999));
  const mode = new Uint8Array(rows);
  const lo = new Uint32Array(rows);
  const hi = new Uint32Array(rows);
  const frac = new Float32Array(rows);
  for (let y = 0; y < rows; y++) {
    const fTop = frequencyAtPosition(1 - y / rows, bottom, top, scale);
    const fBottom = frequencyAtPosition(1 - (y + 1) / rows, bottom, top, scale);
    const first = Math.ceil(fBottom / binHz);
    const last = Math.min(binCount - 1, Math.floor(fTop / binHz));
    if (last - first >= 1) {
      mode[y] = 1;
      lo[y] = first;
      hi[y] = last;
    } else {
      const pos = rowFrequency(y, rows, bottom, top, scale) / binHz;
      const b = Math.min(binCount - 2, Math.max(0, Math.floor(pos)));
      mode[y] = 0;
      lo[y] = b;
      hi[y] = b + 1;
      frac[y] = Math.min(1, Math.max(0, pos - b));
    }
  }
  return { rows, binCount, binHz, minHz: bottom, maxHz: top, scale, mode, lo, hi, frac };
}

/** dB value the row map assigns to row y of a spectrum (values below minDb clamp to minDb). */
export function rowValue(spectrum, map, y, minDb) {
  const a0 = map.lo[y];
  if (map.mode[y] === 1) {
    let m = -Infinity;
    for (let k = a0, e = map.hi[y]; k <= e; k++) if (spectrum[k] > m) m = spectrum[k];
    return m > minDb ? m : minDb;
  }
  const a = spectrum[a0] > minDb ? spectrum[a0] : minDb;
  const b = spectrum[a0 + 1] > minDb ? spectrum[a0 + 1] : minDb;
  return a + (b - a) * map.frac[y];
}

/**
 * fillColumn(rgba, spectrum, map, lut, minDb, maxDb): writes one RGBA pixel per row into rgba
 * (Uint8ClampedArray of rows·4, i.e. a 1×rows ImageData). A null spectrum writes the floor.
 */
export function fillColumn(rgba, spectrum, map, lut, minDb, maxDb) {
  const span = maxDb - minDb;
  for (let y = 0; y < map.rows; y++) {
    let idx = 0;
    if (spectrum) {
      const v = rowValue(spectrum, map, y, minDb);
      idx = v >= maxDb ? 255 : v > minDb ? Math.round(((v - minDb) / span) * 255) : 0;
    }
    const o = y * 4;
    const l = idx * 4;
    rgba[o] = lut[l];
    rgba[o + 1] = lut[l + 1];
    rgba[o + 2] = lut[l + 2];
    rgba[o + 3] = 255;
  }
  return rgba;
}

const defaultHidden = () => typeof document !== 'undefined' && document.hidden === true;

/**
 * createSpectrogram(canvas, options) → spectrogram
 *
 * options (all reconfigurable): sampleRate, fftSize (required before the first push),
 *   minHz (20), maxHz (Nyquist), scale ('log' | 'linear'), minDb (−120), maxDb (−20),
 *   timeSpanS (10), stops (DEFAULT_SPECTROGRAM_STOPS), isHidden (() => document.hidden),
 *   strategy ('auto' | 'ring' | 'scroll')
 *
 * spectrogram:
 *   frame(spectrumDb | null, nowMs)  push the snapshot then draw (skipped while frozen/hidden)
 *   push(spectrumDb | null, nowMs)   write the columns that are due; returns the count
 *   draw()                            compose the visible canvas
 *   configure(options)                rebuilds the LUT/row map as needed; axis changes clear
 *   resize()                          re-read canvas.width/height (device pixels) and clear
 *   freeze(on), frozen, clear(), dispose()
 *   rowFrequency(y), yForFrequency(f)  axis helpers for labels and cursor readouts
 *   strategy                          'ring' or 'scroll'
 * The caller owns the animation loop and passes the analyser buffer (e.g. reader.frequency).
 */
export function createSpectrogram(canvas, options = {}) {
  if (!canvas || typeof canvas.getContext !== 'function')
    throw new TypeError('createSpectrogram needs a canvas');
  const ctx = canvas.getContext('2d', { alpha: false });
  let opts = {
    sampleRate: 0,
    fftSize: 0,
    minHz: 20,
    maxHz: Infinity,
    scale: 'log',
    minDb: -120,
    maxDb: -20,
    timeSpanS: 10,
    stops: DEFAULT_SPECTROGRAM_STOPS,
    isHidden: defaultHidden,
    strategy: 'auto',
  };
  let lut = null;
  let map = null;
  let width = 0;
  let height = 0;
  let ring = null;
  let rctx = null;
  let column = null;
  let head = 0;
  let acc = 0;
  let lastNow = null;
  let frozen = false;
  let dirty = true;
  let strategy = 'scroll';

  function floorFill(target) {
    target.fillStyle = `rgb(${lut[0]},${lut[1]},${lut[2]})`;
    target.fillRect(0, 0, width, height);
  }

  function rebuildMap() {
    map = null;
    if (!(opts.sampleRate > 0) || !(opts.fftSize > 0) || !(height > 0)) return;
    map = buildRowMap({
      rows: height,
      binCount: opts.fftSize / 2,
      binHz: opts.sampleRate / opts.fftSize,
      minHz: opts.minHz,
      maxHz: Math.min(opts.maxHz, opts.sampleRate / 2),
      scale: opts.scale,
    });
  }

  function resize() {
    width = Math.max(1, canvas.width | 0);
    height = Math.max(1, canvas.height | 0);
    const canRing = typeof OffscreenCanvas === 'function' && opts.strategy !== 'scroll';
    strategy = canRing ? 'ring' : 'scroll';
    if (canRing) {
      ring = new OffscreenCanvas(width, height);
      rctx = ring.getContext('2d', { alpha: false });
    } else {
      ring = null;
      rctx = null;
    }
    column = (rctx || ctx).createImageData(1, height);
    rebuildMap();
    clear();
  }

  function clear() {
    head = 0;
    acc = 0;
    lastNow = null;
    if (rctx) floorFill(rctx);
    floorFill(ctx);
    dirty = true;
  }

  function configure(next = {}) {
    const prev = opts;
    opts = { ...opts, ...next };
    if (!lut || next.stops) lut = buildColorLut(opts.stops);
    const axisChanged = ['sampleRate', 'fftSize', 'minHz', 'maxHz', 'scale'].some(
      (k) => prev[k] !== opts[k],
    );
    if (next.strategy && next.strategy !== prev.strategy) {
      resize();
      return;
    }
    if (axisChanged) rebuildMap();
    if (axisChanged || prev.timeSpanS !== opts.timeSpanS || next.stops) clear();
  }

  function writeColumns(spectrum, n) {
    fillColumn(column.data, spectrum, map, lut, opts.minDb, opts.maxDb);
    if (strategy === 'ring') {
      for (let i = 0; i < n; i++) {
        rctx.putImageData(column, head, 0);
        head = (head + 1) % width;
      }
    } else {
      ctx.drawImage(canvas, n, 0, width - n, height, 0, 0, width - n, height);
      for (let i = 0; i < n; i++) ctx.putImageData(column, width - n + i, 0);
    }
    dirty = true;
  }

  function push(spectrum, nowMs) {
    if (frozen || opts.isHidden()) {
      lastNow = null;
      return 0;
    }
    if (!map) return 0;
    if (lastNow == null) {
      lastNow = nowMs;
      acc = 1;
    }
    const perMs = width / (Math.max(0.1, opts.timeSpanS) * 1000);
    acc += Math.max(0, nowMs - lastNow) * perMs;
    lastNow = nowMs;
    let n = Math.floor(acc);
    if (n <= 0) return 0;
    acc -= n;
    if (n > width) n = width;
    writeColumns(spectrum && spectrum.length >= map.binCount ? spectrum : null, n);
    return n;
  }

  function draw() {
    if (!dirty || strategy !== 'ring') {
      dirty = false;
      return;
    }
    const w1 = width - head;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(ring, head, 0, w1, height, 0, 0, w1, height);
    if (head > 0) ctx.drawImage(ring, 0, 0, head, height, w1, 0, head, height);
    dirty = false;
  }

  lut = buildColorLut(opts.stops);
  configure(options);
  resize();

  return {
    get strategy() {
      return strategy;
    },
    get frozen() {
      return frozen;
    },
    get rowMap() {
      return map;
    },
    get lut() {
      return lut;
    },
    get options() {
      return { ...opts };
    },
    frame(spectrum, nowMs) {
      if (push(spectrum, nowMs) > 0) draw();
    },
    push,
    draw,
    configure,
    resize,
    clear,
    freeze(on = true) {
      frozen = !!on;
      lastNow = null;
      return frozen;
    },
    rowFrequency(y) {
      return map ? rowFrequency(y, height, map.minHz, map.maxHz, map.scale) : null;
    },
    yForFrequency(f) {
      if (!map || !(f > 0)) return null;
      return (1 - positionAtFrequency(f, map.minHz, map.maxHz, map.scale)) * height;
    },
    dispose() {
      ring = null;
      rctx = null;
      column = null;
      map = null;
    },
  };
}
