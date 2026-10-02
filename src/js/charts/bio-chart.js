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
const RANGE_W = 66;

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

  function track() {
    const x = NAME_W + RANGE_W;
    return { x, w: Math.max(20, size.w - x - 4) };
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
      ctx.font = canvasFont(theme, 9.5);
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
    // Axis labels (decades); a label that would collide with the previous one is skipped,
    // the last one is right-aligned to the edge.
    ctx.font = canvasFont(theme, 8.5);
    ctx.fillStyle = theme.text2;
    ctx.textAlign = 'left';
    const ay = size.h - AXIS_H / 2;
    const ticks = [[10, '10 Hz'], [100, '100 Hz'], [1000, '1 kHz'], [10000, '10 kHz'],
      [100000, '100 kHz']];
    let lastRight = -Infinity;
    ticks.forEach(([f, label], i) => {
      const g = Math.log(f / BIO_AXIS.min) / Math.log(BIO_AXIS.max / BIO_AXIS.min);
      const w = ctx.measureText(label).width;
      let x = t.x + g * t.w - w / 2;
      if (i === ticks.length - 1) x = Math.min(x, size.w - w - 1);
      if (x < lastRight + 3) return;
      ctx.fillText(label, x, ay);
      lastRight = x + w;
    });
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
