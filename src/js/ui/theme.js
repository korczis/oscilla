// Chart theme bridge: canvas renderers (uPlot, p5, spectrogram) cannot see CSS, so they read
// the design tokens here. Call again after an `osc:ui` event with kind 'theme'.

/** Spectrogram LUT positions (0 = -100 dB floor, 1 = 0 dB), matching tokens.css. */
export const LUT_POSITIONS = [
  0.025, 0.057, 0.12, 0.18, 0.245, 0.31, 0.37, 0.43, 0.5, 0.56, 0.62, 0.69, 0.75, 0.81, 0.87,
  0.94, 0.98, 1,
];

const TOKEN_KEYS = {
  bg: '--osc-bg',
  surface0: '--osc-surface-0',
  surface1: '--osc-surface-1',
  surface2: '--osc-surface-2',
  border: '--osc-border',
  borderSoft: '--osc-border-soft',
  grid: '--osc-grid',
  text: '--osc-text',
  text2: '--osc-text-2',
  textMuted: '--osc-text-muted',
  textDim: '--osc-text-dim',
  blue: '--osc-blue',
  trace: '--osc-blue-trace',
  cyan: '--osc-cyan',
  green: '--osc-green',
  purple: '--osc-purple',
  magenta: '--osc-magenta',
  orange: '--osc-orange',
  red: '--osc-red',
  tooltip: '--osc-surface-tooltip',
  font: '--osc-font',
};

/** Parse '#rrggbb' into [r, g, b]; returns null for anything else. */
export function hexToRgb(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex).trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/**
 * Build a 256-entry Uint8ClampedArray RGBA lookup table from LUT stops
 * ([{ pos, rgb: [r, g, b] }], pos ascending in 0..1). Index 0 = floor, 255 = top.
 */
export function buildLut(stops, size = 256) {
  const out = new Uint8ClampedArray(size * 4);
  for (let i = 0; i < size; i++) {
    const t = i / (size - 1);
    let k = 0;
    while (k < stops.length - 2 && t > stops[k + 1].pos) k++;
    const a = stops[k];
    const b = stops[Math.min(k + 1, stops.length - 1)];
    const span = b.pos - a.pos;
    const f = span > 0 ? Math.min(1, Math.max(0, (t - a.pos) / span)) : 0;
    for (let c = 0; c < 3; c++) out[i * 4 + c] = a.rgb[c] + (b.rgb[c] - a.rgb[c]) * f;
    out[i * 4 + 3] = 255;
  }
  return out;
}

/** Read the current token values from computed style. */
export function readChartTheme(el = document.documentElement) {
  const cs = getComputedStyle(el);
  const theme = {};
  for (const [name, prop] of Object.entries(TOKEN_KEYS)) {
    theme[name] = cs.getPropertyValue(prop).trim();
  }
  theme.lutStops = LUT_POSITIONS.map((pos, i) => ({
    pos,
    rgb: hexToRgb(cs.getPropertyValue(`--osc-lut-${i}`)) || [0, 0, 0],
  }));
  theme.dark = (el.dataset.theme || 'dark') !== 'light';
  return theme;
}
