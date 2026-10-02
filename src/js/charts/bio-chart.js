// Bioacoustics range bars (Canvas 2D) on a logarithmic 10 Hz … 100 kHz axis, from the cited
// data in src/js/data/bioacoustics.js. Labels show the sourced values ("31 Hz – 17.6 kHz"); the
// tooltip shows the full label, basis and citation. Clicking a row (or Enter on the focused
// host after choosing a row with the arrow keys) calls onSelectRange(minHz, maxHz, entry).

import { HEARING_RANGES, CALL_EXAMPLES, rangeToLogFraction } from '../data/bioacoustics.js';
import { formatHz } from './axes.js';
import { chartTheme, canvasFont, fitCanvas, observeSize } from './chart-theme.js';
import { roundRect } from './envelope-graph.js';

export const BIO_AXIS = Object.freeze({ min: 10, max: 100000 });
const ROW_H = 21;
const AXIS_H = 16;
const NAME_W = 50;
const RANGE_W = 60; // minimum range-label column; widened to the dataset's longest label
const RANGE_FONT = 9.5;
// Room right of the 100 kHz end of the track for half of its label, so every decade label
// (10 Hz … 100 kHz) is shown centred on its position.
const TRACK_RIGHT = 17;
const AXIS_LABELS = [
  [[10, '10 Hz'], [100, '100 Hz'], [1000, '1 kHz'], [10000, '10 kHz'], [100000, '100 kHz']],
  [[10, '10 Hz'], [100, '100'], [1000, '1k'], [10000, '10k'], [100000, '100k']],
];

const SHORT_CALL_NAMES = {
  bigBrownBatFm1: 'Bat FM1',
  bigBrownBatFm2: 'Bat FM2',
  africanElephantRumble: 'Elephant',
  spinnerSpottedDolphinWhistle: 'Dolphin W',
  dolphinClick: 'Dolphin C',
};

/** Row label: "Bat (big brown bat)" → "Bat"; call examples use a short name. */
export function shortName(entry) {
  if (SHORT_CALL_NAMES[entry.id]) return SHORT_CALL_NAMES[entry.id];
  return String(entry.label).split(/ \(|,/)[0];
}

/** "31 Hz – 17.6 kHz" from the entry's own sourced values. */
export function rangeLabel(entry) {
  return `${formatHz(entry.minHz)} – ${formatHz(entry.maxHz)}`;
}

function citation(src) {
  if (!src) return '';
  const year = src.year ? ` (${src.year})` : '';
  return `${src.authors}${year}. ${src.title}. ${src.venue}. ${src.doi_or_url}`;
}

function colourFor(entry, theme) {
  const id = entry.id;
  if (id === 'human') return theme.rangeHuman;
  if (id === 'dog') return theme.rangeDog;
  if (id === 'cat') return theme.rangeCat;
  if (id.startsWith('bat') || id.startsWith('bigBrownBat')) return theme.rangeBat;
  if (id.startsWith('elephant') || id.startsWith('africanElephant')) return theme.rangeElephant;
  if (id === 'mouse') return theme.cyan;
  return theme.blue;
}

/**
 * createBioChart(host, { dataset: 'ranges' | 'calls', onSelectRange(min, max, entry) })
 *   chart.setDataset(name), getRows() → [{ id, label, minHz, maxHz, start, end }] (tests),
 *   refreshTheme(), dispose()
 */
export function createBioChart(host, options = {}) {
  const canvas = document.createElement('canvas');
  canvas.setAttribute('aria-hidden', 'true');
  host.appendChild(canvas);
  if (!host.hasAttribute('tabindex')) host.tabIndex = 0;
  const tip = document.createElement('div');
  tip.className = 'osc-chip-readout';
  tip.hidden = true;
  Object.assign(tip.style, {
    maxWidth: '280px',
    whiteSpace: 'normal',
    textAlign: 'left',
    zIndex: '90',
  });
  document.body.appendChild(tip);
  let theme = chartTheme();
  let dataset = options.dataset === 'calls' ? 'calls' : 'ranges';
  let size = { w: 0, h: 0 };
  let hover = -1;
  let active = -1;
  let rows = [];

  function entries() {
    return dataset === 'calls' ? CALL_EXAMPLES : HEARING_RANGES;
  }

  // The track starts after the widest range label of the dataset (sourced strings such as
  // "850 Hz – 120 kHz" are longer than a fixed column), so text never runs under a bar.
  let rangeW = RANGE_W;

  function measureRanges(ctx) {
    ctx.font = canvasFont(theme, RANGE_FONT);
    rangeW = RANGE_W;
    for (const e of entries()) rangeW = Math.max(rangeW, ctx.measureText(rangeLabel(e)).width + 6);
  }

  function track() {
    const x = NAME_W + Math.ceil(rangeW);
    return { x, w: Math.max(20, size.w - x - TRACK_RIGHT) };
  }

  function layoutRows() {
    const visible = Math.max(1, Math.floor((size.h - AXIS_H) / ROW_H));
    const t = track();
    rows = entries()
      .slice(0, visible)
      .map((e, i) => {
        const g = rangeToLogFraction(e.minHz, e.maxHz, BIO_AXIS.min, BIO_AXIS.max);
        return {
          entry: e,
          y: i * ROW_H,
          start: g ? t.x + g.start * t.w : null,
          end: g ? t.x + g.end * t.w : null,
        };
      });
  }

  function draw() {
    size = fitCanvas(canvas, host.clientWidth, host.clientHeight);
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, size.w, size.h);
    measureRanges(ctx);
    layoutRows();
    const t = track();
    ctx.textBaseline = 'middle';
    rows.forEach((r, i) => {
      const cy = r.y + ROW_H / 2;
      if (i === active || i === hover) {
        ctx.fillStyle = theme.surface2;
        ctx.fillRect(0, r.y + 1, size.w, ROW_H - 2);
      }
      ctx.textAlign = 'left';
      ctx.font = canvasFont(theme, 10, 500);
      ctx.fillStyle = theme.text;
      ctx.fillText(shortName(r.entry), 2, cy);
      ctx.font = canvasFont(theme, RANGE_FONT);
      ctx.fillStyle = theme.textMuted;
      ctx.fillText(rangeLabel(r.entry), NAME_W, cy);
      if (r.start == null) {
        ctx.fillStyle = theme.textDim;
        ctx.fillText('UNAVAILABLE', t.x, cy);
        return;
      }
      ctx.fillStyle = colourFor(r.entry, theme);
      roundRect(ctx, r.start, cy - 5.5, Math.max(2, r.end - r.start), 11, 2);
      ctx.fill();
    });
    // Axis labels (decades), centred on their positions. When the full set ("10 Hz" …
    // "100 kHz") would collide at this width, the compact set ("10 Hz", "100", "1k" … "100k")
    // is used; a label that still collides is skipped, the last one is kept inside the edge.
    ctx.font = canvasFont(theme, 8.5);
    ctx.fillStyle = theme.text2;
    ctx.textAlign = 'left';
    const ay = size.h - AXIS_H / 2;
    const placed = AXIS_LABELS.map((set) => placeLabels(ctx, set, t)).find((p) => p.fits)
      || placeLabels(ctx, AXIS_LABELS[AXIS_LABELS.length - 1], t);
    for (const l of placed.labels) if (l.show) ctx.fillText(l.text, l.x, ay);
  }

  function placeLabels(ctx, set, t) {
    let lastRight = -Infinity;
    let fits = true;
    const labels = set.map(([f, text], i) => {
      const g = Math.log(f / BIO_AXIS.min) / Math.log(BIO_AXIS.max / BIO_AXIS.min);
      const w = ctx.measureText(text).width;
      let x = t.x + g * t.w - w / 2;
      if (i === set.length - 1) x = Math.min(x, size.w - w - 1);
      const show = x >= lastRight + 3;
      if (show) lastRight = x + w;
      else fits = false;
      return { text, x, show };
    });
    return { labels, fits };
  }

  function rowAt(y) {
    const i = Math.floor(y / ROW_H);
    return i >= 0 && i < rows.length ? i : -1;
  }

  function showTip(i, anchorY) {
    if (i < 0) {
      tip.hidden = true;
      return;
    }
    const e = rows[i].entry;
    tip.textContent = '';
    const head = document.createElement('strong');
    head.textContent = `${e.label}: ${rangeLabel(e)}`;
    const basis = document.createElement('div');
    basis.textContent = e.basis || '';
    const src = document.createElement('div');
    src.textContent = citation(e.source);
    tip.append(head, basis, src);
    tip.hidden = false;
    const r = host.getBoundingClientRect();
    const w = tip.offsetWidth;
    const left = Math.max(4, Math.min(window.innerWidth - w - 4, r.right - w));
    const top = r.top + window.scrollY + anchorY - tip.offsetHeight - 6;
    tip.style.left = `${Math.round(left + window.scrollX)}px`;
    tip.style.top = `${Math.round(Math.max(window.scrollY + 4, top))}px`;
  }

  function select(i) {
    if (i < 0 || !options.onSelectRange) return;
    const e = rows[i].entry;
    options.onSelectRange(e.minHz, e.maxHz, e);
  }

  function describeActive() {
    const i = active;
    const base = dataset === 'calls' ? 'Call examples' : 'Approximate hearing ranges by species';
    if (i < 0) {
      host.setAttribute('aria-label', `${base}. Use the arrow keys to choose a row.`);
      return;
    }
    const e = rows[i].entry;
    host.setAttribute('aria-label',
      `${base}. ${e.label}: ${rangeLabel(e)}. ${e.basis || ''}. Enter sets the explorer range.`);
  }

  canvas.addEventListener('pointermove', (e) => {
    const r = canvas.getBoundingClientRect();
    const y = e.clientY - r.top;
    const i = rowAt(y);
    if (i !== hover) {
      hover = i;
      draw();
    }
    canvas.style.cursor = i >= 0 && options.onSelectRange ? 'pointer' : '';
    showTip(i, i >= 0 ? rows[i].y : 0);
  });
  canvas.addEventListener('pointerleave', () => {
    hover = -1;
    tip.hidden = true;
    draw();
  });
  canvas.addEventListener('click', (e) => {
    const r = canvas.getBoundingClientRect();
    select(rowAt(e.clientY - r.top));
  });
  host.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      const d = e.key === 'ArrowDown' ? 1 : -1;
      active = active < 0 ? 0 : Math.max(0, Math.min(rows.length - 1, active + d));
      draw();
      describeActive();
      showTip(active, rows[active].y);
      e.preventDefault();
    } else if ((e.key === 'Enter' || e.key === ' ') && active >= 0) {
      select(active);
      e.preventDefault();
    } else if (e.key === 'Escape') {
      tip.hidden = true;
    }
  });
  host.addEventListener('blur', () => {
    tip.hidden = true;
  });

  const stopObserve = observeSize(host, draw);
  draw();
  describeActive();

  return {
    setDataset(name) {
      dataset = name === 'calls' ? 'calls' : 'ranges';
      active = -1;
      hover = -1;
      tip.hidden = true;
      draw();
      describeActive();
    },
    get dataset() {
      return dataset;
    },
    getRows() {
      return rows.map((r) => ({
        id: r.entry.id,
        label: shortName(r.entry),
        range: rangeLabel(r.entry),
        minHz: r.entry.minHz,
        maxHz: r.entry.maxHz,
        start: r.start,
        end: r.end,
      }));
    },
    refreshTheme() {
      theme = chartTheme();
      draw();
    },
    dispose() {
      stopObserve();
      canvas.remove();
      tip.remove();
    },
  };
}
