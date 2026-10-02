// p5 instance-mode host: renders one p5 view into a container. Owns the shared scaffolding of
// V1 createSketch (index.html@a7b7a23, section 9): palette cache, measuring, backing-store
// density, ResizeObserver, tab visibility, reduced motion, frame-rate policy, text metrics and the
// label helpers. Per frame it builds no strings, arrays or closures and never touches the DOM.
//
// Views ({ id, layout?(h), draw(h, st, now) }) come from waveform.js, phase.js, signal-path.js.
// The host context `h` passed to them: { p, W, H, pal, charW, bandMin, bandMax, modelPhase, viz,
// label, tw, fits, pickFit, logX, dashedV }. Spectrum, motion and harmonics are uPlot charts in
// V2 (spectrum-data.js, motion.js, harmonics.js); their p5 drawing is not carried over.
//
//   const host = createP5Host({ P5: p5, container, bridge, view: 'wave' });
//   host.setView('path'); host.resize(); host.destroy();
// view null follows bridge.state.vizMode like V1 (unknown ids draw the waveform).
// The primary host (trackEnvelope, default true) also reports the wave layout for its canvas
// size through bridge.setWaveLayout ('side' | 'compact', V1 index.html@a7b7a23), which the
// caption follows via bridge.onWaveLayout.

import { clamp } from '../core/math.js';
import { frequencyToNormalized } from '../core/frequency.js';
import { createWaveformView, waveCompact } from './waveform.js';
import { createPhaseView } from './phase.js';
import { createSignalPathView } from './signal-path.js';

// V1: SMALL_CANVAS_AREA (index.html@a7b7a23)
export const SMALL_CANVAS_AREA = 420 * 260; // CSS px²: small canvases may use 3× backing pixels

/** The p5 views V2 keeps in p5, keyed by view id ('phase' is an alias of 'interference'). */
export function createDefaultViews() {
  const phase = createPhaseView();
  return { wave: createWaveformView(), path: createSignalPathView(), interference: phase, phase };
}

const defaultEnv = () => (typeof window !== 'undefined' ? window : globalThis);

/**
 * The p5 sketch function for one host. opts: { bridge (viz), views, view, env, trackEnvelope,
 * onResize(resize) }. V1: createSketch (index.html@a7b7a23), scaffolding part.
 */
export function createSketch(container, opts) {
  const viz = opts.bridge;
  const views = opts.views;
  const window = opts.env || defaultEnv();
  const document = window.document;
  const trackEnvelope = opts.trackEnvelope !== false;
  const cleanups = [];
  const sketch = (p) => {
    let W = 10;
    let H = 10;
    let mW = 10;
    let mH = 10;
    let density = 1;
    let pal = null;
    let paletteSeen = -1;
    let modelPhase = 0;
    let lastMs = 0;
    let fpsSmoothed = 0;
  // monospace advance per text size (index = px size), measured when the geometry changes
  const charW = new Float64Array(16);
  let geoW = -1;
  let geoH = -1;
  // per-column min/max of the analyser trace (resized with the canvas)
  let bandMin = new Float32Array(1);
  let bandMax = new Float32Array(1);
    const h = {
      p, W, H, pal, charW, bandMin, bandMax, modelPhase, viz,
      label, tw, fits, pickFit, logX, dashedV,
    };

    // V1: createSketch: measure (index.html@a7b7a23)
  const C = (rgb, a = 255) => p.color(rgb[0], rgb[1], rgb[2], a);
  const ensurePalette = () => {
    if (paletteSeen === viz.paletteVersion) return;
    const q = viz.palette;
    pal = {
      bg: C(q.bg), grid: C(q.grid), gridSoft: C(q.grid, 120), fg: C(q.fg), muted: C(q.muted),
      accent: C(q.accent), accentSoft: C(q.accent, 70), accentFaint: C(q.accent, 28),
      accent2: C(q.accent2), accent2Soft: C(q.accent2, 70), warn: C(q.warn), danger: C(q.danger),
      band: C(q.fg, 10), bandAlt: C(q.fg, 20), dim: C(q.muted, 110), thirdBand: C(q.accent2, 16),
    };
    paletteSeen = viz.paletteVersion;
  };

  function measure() {
    const r = container.getBoundingClientRect();
    mW = Math.max(40, Math.floor(r.width));
    mH = Math.max(40, Math.floor(r.height));
  }


    /** Backing-store density: up to 3× on small canvases, 2× otherwise. */
    function densityFor(w, h) {
      const dpr = window.devicePixelRatio || 1;
      return Math.min(dpr, w * h <= SMALL_CANVAS_AREA ? 3 : 2);
    }

    /** Re-measure when devicePixelRatio changes (zoom, moving to another display). */
    function watchDensity() {
      if (typeof window.matchMedia !== 'function') return;
      try {
        const mq = window.matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`);
        const onChange = () => {
          if (mq.removeEventListener) mq.removeEventListener('change', onChange);
          else if (mq.removeListener) mq.removeListener(onChange);
          resize();
          watchDensity();
        };
        if (mq.addEventListener) mq.addEventListener('change', onChange);
        else if (mq.addListener) mq.addListener(onChange);
      } catch (e) { /* resolution media queries unsupported */ }
    }

    // V1: createSketch: viz.resize (index.html@a7b7a23); the wave layout follows the canvas size
    function resize() {
      measure();
      const d = densityFor(mW, mH);
      const densityChanged = d !== density;
      if (densityChanged) { density = d; p.pixelDensity(d); }
      if (mW !== W || mH !== H) {
        W = mW;
        H = mH;
        p.resizeCanvas(W, H); // redraws once even while the loop is stopped
        if (trackEnvelope) viz.setWaveLayout(waveCompact(W, H) ? 'compact' : 'side');
      } else if (densityChanged) viz.requestRedraw();
    }

    p.setup = () => {
      viz.attachP5(p);
      measure();
      W = mW;
      H = mH;
      density = densityFor(W, H);
      p.pixelDensity(density);
      const c = p.createCanvas(W, H);
      // The container carries role="img" and a reactive aria-label; the canvas itself is
      // decorative, so the draw loop never has to label it.
      c.elt.setAttribute('aria-hidden', 'true');
      c.elt.style.display = 'block';
      p.textFont('monospace'); // p5 quotes the name, so a CSS font stack would be invalid
      p.frameRate(30);
      if (trackEnvelope) viz.setWaveLayout(waveCompact(W, H) ? 'compact' : 'side');
      viz.resize = resize; // V1 compatibility: the most recent host (inventory K8)
      if (opts.onResize) opts.onResize(resize);
      if (typeof window.ResizeObserver === 'function') {
        const ro = new window.ResizeObserver(() => resize());
        ro.observe(container);
        cleanups.push(() => ro.disconnect());
      } else {
        window.addEventListener('resize', resize, { passive: true });
        cleanups.push(() => window.removeEventListener('resize', resize));
      }
      watchDensity();
      const onVisibility = () => {
        viz.hidden = document.hidden;
        viz.updateLoop();
      };
      document.addEventListener('visibilitychange', onVisibility);
      cleanups.push(() => document.removeEventListener('visibilitychange', onVisibility));
      try {
        const rm = window.matchMedia('(prefers-reduced-motion: reduce)');
        const onMotion = () => { viz.state.reducedMotion = rm.matches; viz.updateLoop(); };
        if (rm.addEventListener) rm.addEventListener('change', onMotion); else if (rm.addListener) rm.addListener(onMotion);
      } catch (e) { /* matchMedia unavailable */ }
      viz.hidden = document.hidden;
      viz.looping = true;
      viz.updateLoop();
    };

    p.draw = () => {
      ensurePalette();
      viz.pull();
      const st = viz.state;
      const now = p.millis();
      const dt = Math.min(0.1, (now - lastMs) / 1000);
      lastMs = now;
      fpsSmoothed = fpsSmoothed * 0.9 + p.frameRate() * 0.1;
      viz.fps = fpsSmoothed;
      p.frameRate(st.playing ? 60 : 30);
      if (!st.reducedMotion) modelPhase += dt * 0.5;
      ensureGeometry();
      if (trackEnvelope) updateEnvelope(st);
      p.background(pal.bg);
      const id = sketch.view || st.vizMode;
      const view = views[id] || (sketch.view ? null : views.wave);
      if (!view) return;
      h.W = W; h.H = H; h.pal = pal; h.modelPhase = modelPhase;
      h.bandMin = bandMin; h.bandMax = bandMax;
      view.draw(h, st, now);
    };

    // ---------------------------------------------------------------- shared helpers
    /** Text metrics and the size-dependent layouts; runs only when the canvas size changes. */
    function ensureGeometry() {
      if (geoW === W && geoH === H) return;
      geoW = W;
      geoH = H;
      for (let s = 6; s < charW.length; s++) { p.textSize(s); charW[s] = p.textWidth('0'); }
      const cols = Math.max(1, Math.floor(W));
      if (bandMin.length < cols) { bandMin = new Float32Array(cols); bandMax = new Float32Array(cols); }
      h.W = W; h.H = H; h.bandMin = bandMin; h.bandMax = bandMax;
      for (const v of new Set(Object.values(views))) if (v.layout) v.layout(h);
    }
    // V1: createSketch: tw, fits, pickFit, updateEnvelope, label, logX, dashedV
    //   (index.html@a7b7a23)
  /** Width of a string in the monospace canvas font (arithmetic only — no measuring per frame). */
  function tw(txt, size) { return txt.length * charW[size]; }
  function fits(txt, size, w) { return txt.length * charW[size] <= w; }
  /** The first (longest) variant that fits, or '' when none does. */
  function pickFit(list, size, w) {
    for (let i = 0; i < list.length; i++) if (fits(list[i], size, w)) return list[i];
    return '';
  }

  function updateEnvelope(st) {
    let level = 0;
    const d = st.live.timeData;
    if (d) {
      // every sample: a decimated read aliases with tones whose period divides the stride
      let peak = 0;
      for (let i = 0; i < d.length; i++) { const a = Math.abs(d[i]); if (a > peak) peak = a; }
      level = clamp(peak / Math.max(st.gain, 1e-4), 0, 1.2);
    }
    viz.envLevel = level;
    viz.envHistory[viz.envIndex] = level;
    viz.envIndex = (viz.envIndex + 1) % viz.envHistory.length;
  }

  function label(txt, x, y, col, size = 10, align = p.LEFT) {
    p.noStroke();
    p.fill(col || pal.muted);
    p.textSize(size);
    p.textAlign(align, p.BASELINE);
    p.text(txt, x, y);
  }

  function logX(f, fmin, fmax, x0, x1) {
    return x0 + frequencyToNormalized(f, fmin, fmax) * (x1 - x0);
  }

  function dashedV(x, y0, y1, col) {
    p.stroke(col);
    p.strokeWeight(1);
    for (let y = y0; y < y1; y += 6) p.line(x, y, x, Math.min(y + 3, y1));
  }
  };
  sketch.view = opts.view || null;
  sketch.cleanup = () => { for (const fn of cleanups.splice(0)) fn(); };
  return sketch;
}

/**
 * Create a p5 instance rendering `view` (or following bridge.state.vizMode when view is null)
 * into container. P5: the p5 constructor (import p5 from 'p5'; default env.p5).
 * Returns { p5, view, setView(id), resize(), destroy() }; throws when p5 cannot start.
 */
export function createP5Host(opts = {}) {
  const { P5, container, bridge, views, view = null, env, trackEnvelope } = opts;
  const e = env || defaultEnv();
  const Ctor = P5 || e.p5;
  if (typeof Ctor !== 'function') throw new Error('p5.js is not available');
  let resizeFn = () => {};
  const sketch = createSketch(container, {
    bridge, views: views || createDefaultViews(), view, env: e, trackEnvelope,
    onResize: (fn) => { resizeFn = fn; },
  });
  const instance = new Ctor(sketch, container);
  return {
    p5: instance,
    get view() { return sketch.view; },
    setView(id) { sketch.view = id || null; bridge.requestRedraw(); },
    resize() { resizeFn(); },
    destroy() {
      sketch.cleanup();
      bridge.detachP5(instance);
      if (typeof instance.remove === 'function') instance.remove();
    },
  };
}

/**
 * V1 startVisualizer (index.html@a7b7a23): start one host, record a failure in
 * bridge.sketchState and return the host, or false.
 */
export function startVisualizer(bridge, container, opts = {}) {
  const e = opts.env || defaultEnv();
  const Ctor = opts.P5 || e.p5;
  if (typeof Ctor !== 'function') {
    bridge.sketchState = 'unavailable (p5.js not loaded)';
    return false;
  }
  try {
    return createP5Host({ ...opts, P5: Ctor, container, bridge });
  } catch (err) {
    bridge.sketchState = `failed: ${err && err.message}`;
    return false;
  }
}
