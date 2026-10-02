// Chart styling from the design tokens (via src/js/ui/theme.js) plus the few extra tokens the
// renderers need. Canvas drawing cannot see CSS, so every colour is read here; call
// chartTheme() again after an `osc:ui` theme event.

import { readChartTheme } from '../ui/theme.js';

const EXTRA_TOKENS = {
  borderStrong: '--osc-border-strong',
  surface3: '--osc-surface-3',
  surface4: '--osc-surface-4',
  blueDeep: '--osc-blue-deep',
  green2: '--osc-green-2',
  rangeHuman: '--osc-range-human',
  rangeDog: '--osc-range-dog',
  rangeCat: '--osc-range-cat',
  rangeBat: '--osc-range-bat',
  rangeElephant: '--osc-range-elephant',
  fsXs: '--osc-fs-xs',
  fs2xs: '--osc-fs-2xs',
};

/** readChartTheme() plus EXTRA_TOKENS; px sizes parsed to numbers (fsXs, fs2xs). */
export function chartTheme(el = document.documentElement) {
  const theme = readChartTheme(el);
  const cs = getComputedStyle(el);
  for (const [k, prop] of Object.entries(EXTRA_TOKENS)) theme[k] = cs.getPropertyValue(prop).trim();
  theme.fsXs = parseFloat(theme.fsXs) || 10.5;
  theme.fs2xs = parseFloat(theme.fs2xs) || 10;
  theme.font = theme.font || 'system-ui, sans-serif';
  return theme;
}

/** '#rrggbb' + alpha → 'rgba(r, g, b, a)'; other formats are returned unchanged. */
export function withAlpha(color, alpha) {
  const m = /^#([0-9a-f]{6})$/i.exec(String(color).trim());
  if (!m) return color;
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

/** CSS font shorthand for canvas text. */
export function canvasFont(theme, sizePx, weight = 400) {
  return `${weight} ${sizePx}px ${theme.font}`;
}

/** uPlot axis object styled like the reference (dim labels, faint grid, no tick marks). */
export function uplotAxis(theme, overrides = {}) {
  return {
    stroke: theme.textMuted,
    font: canvasFont(theme, theme.fsXs),
    labelFont: canvasFont(theme, 9),
    grid: { show: true, stroke: theme.grid, width: 1 },
    ticks: { show: false },
    border: { show: false },
    gap: 4,
    space: 10,
    // Keep every split we generate (uPlot's default log-axis filter hides 2× and 5× labels).
    filter: (u, splits) => splits,
    ...overrides,
  };
}

/** Device pixel ratio, clamped (very high ratios cost fill rate for no visible gain). */
export function pixelRatio() {
  return Math.min(2, Math.max(1, (typeof window !== 'undefined' && window.devicePixelRatio) || 1));
}

/**
 * Size a canvas to its CSS box × pixelRatio and return { w, h, dpr } (CSS px). The 2D context
 * is reset to CSS-pixel units.
 */
export function fitCanvas(canvas, cssW, cssH) {
  const dpr = pixelRatio();
  const w = Math.max(1, Math.round(cssW));
  const h = Math.max(1, Math.round(cssH));
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
  }
  canvas.style.width = `${w}px`;
  canvas.style.height = `${h}px`;
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { w, h, dpr };
}

/** Observe a host's size; returns a disconnect function. Falls back to window resize. */
export function observeSize(el, cb) {
  if (typeof ResizeObserver === 'function') {
    let last = '';
    const ro = new ResizeObserver(() => {
      const key = `${el.clientWidth}x${el.clientHeight}`;
      if (key === last) return;
      last = key;
      cb(el.clientWidth, el.clientHeight);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }
  const on = () => cb(el.clientWidth, el.clientHeight);
  window.addEventListener('resize', on);
  return () => window.removeEventListener('resize', on);
}
