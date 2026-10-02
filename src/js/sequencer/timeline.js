// OSCILLA V2 pattern sequencer: pure layout maths for the timeline UI.
//
// No DOM: the visual shell owns markup and passes measured sizes in. Everything here is a
// pure function of the model, the measured width and the audio clock.

import { isNum, clamp, describeBlock, blockStartTimes, totalDuration } from './model.js';

/** Candidate tick spacings in seconds. */
export const TICK_STEPS_S = [0.01, 0.02, 0.05, 0.1, 0.2, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60];

/**
 * Suggested accent token per block type (names from the V2 token set, --osc-<accent>), sampled
 * from the reference where shown: Tone green, Sweep purple, Silence neutral surface, Pulse
 * orange, Chirp magenta (the reference's lighter violet). The visual shell decides the final
 * mapping.
 */
export const BLOCK_ACCENTS = {
  tone: 'green',
  silence: 'neutral',
  sweep: 'purple',
  pulse: 'orange',
  chirp: 'magenta',
  burst: 'red',
  siren: 'cyan',
  am: 'blue',
  fm: 'purple',
  random: 'cyan',
};

/**
 * Seconds <-> pixels scale.
 * opts: { durationS, widthPx, originPx = 0, minSpanS = 1, headroomRatio = 0 }
 * The visible span is max(minSpanS, durationS * (1 + headroomRatio)). The reference shows a
 * 2.25 s sequence on a ~4 s axis: { minSpanS: 4 } reproduces it.
 */
export function createTimeScale(opts = {}) {
  const durationS = isNum(opts.durationS) && opts.durationS > 0 ? opts.durationS : 0;
  const widthPx = isNum(opts.widthPx) && opts.widthPx > 0 ? opts.widthPx : 1;
  const originPx = isNum(opts.originPx) ? opts.originPx : 0;
  const minSpanS = isNum(opts.minSpanS) && opts.minSpanS > 0 ? opts.minSpanS : 1;
  const headroom = isNum(opts.headroomRatio) && opts.headroomRatio > 0 ? opts.headroomRatio : 0;
  const spanS = Math.max(minSpanS, durationS * (1 + headroom));
  const pxPerSecond = widthPx / spanS;
  return {
    spanS,
    widthPx,
    originPx,
    pxPerSecond,
    secToPx: (t) => originPx + t * pxPerSecond,
    pxToSec: (x) => (x - originPx) / pxPerSecond,
  };
}

/** Smallest tick step whose spacing is at least minTickPx (default 48 px). */
export function chooseTickStep(scale, minTickPx = 48) {
  for (const s of TICK_STEPS_S) if (s * scale.pxPerSecond >= minTickPx) return s;
  return TICK_STEPS_S[TICK_STEPS_S.length - 1];
}

/** Tick label as in the reference: 0.0s, 0.5s, 1.0s (two decimals below 0.1 s steps). */
export function formatTick(t, stepS) {
  const digits = stepS < 0.1 ? 2 : 1;
  return `${t.toFixed(digits)}s`;
}

/**
 * Ticks across the visible span: [{ t, x, label }]. stepS defaults to chooseTickStep(scale).
 * Tick times are computed as i * step (no accumulated floating-point drift).
 */
export function generateTicks(scale, stepS, minTickPx = 48) {
  const step = isNum(stepS) && stepS > 0 ? stepS : chooseTickStep(scale, minTickPx);
  const n = Math.floor(scale.spanS / step + 1e-9);
  const out = [];
  for (let i = 0; i <= n; i++) {
    const t = Math.round(i * step * 1e6) / 1e6;
    out.push({ t, x: scale.secToPx(t), label: formatTick(t, step) });
  }
  return out;
}

/**
 * Block rectangles: [{ id, index, type, label, detail, accent, startS, endS, x, y, w, h }].
 * opts: { y = 0, height = 40, gapPx = 2, minWidthPx = 4 }. The gap is taken from the right
 * edge of each block so x stays exactly on the block start.
 */
export function layoutBlocks(model, scale, opts = {}) {
  const y = isNum(opts.y) ? opts.y : 0;
  const h = isNum(opts.height) ? opts.height : 40;
  const gap = isNum(opts.gapPx) ? Math.max(0, opts.gapPx) : 2;
  const minW = isNum(opts.minWidthPx) ? opts.minWidthPx : 4;
  const starts = blockStartTimes(model);
  return model.blocks.map((b, index) => {
    const startS = starts[index];
    const endS = startS + b.durationMs / 1000;
    const x = scale.secToPx(startS);
    const full = scale.secToPx(endS) - x;
    const { label, detail } = describeBlock(b);
    return {
      id: b.id,
      index,
      type: b.type,
      label,
      detail,
      accent: BLOCK_ACCENTS[b.type] || 'neutral',
      startS,
      endS,
      x,
      y,
      w: Math.max(minW, full - gap),
      h,
    };
  });
}

/**
 * Playhead from the audio clock.
 * opts: { ctxTime, t0, durationS, loop = false, scale }
 * Returns { t, x, visible }: t in seconds into the sequence (null when not visible).
 * Before t0 the head waits at 0; after the end it disappears unless loop wraps it.
 */
export function playheadPosition(opts) {
  const { ctxTime, t0, durationS, scale } = opts || {};
  if (!isNum(ctxTime) || !isNum(t0) || !(durationS > 0) || !scale)
    return { t: null, x: null, visible: false };
  let t = Math.max(0, ctxTime - t0);
  if (t > durationS) {
    if (!opts.loop) return { t: null, x: null, visible: false };
    t %= durationS;
  }
  return { t, x: scale.secToPx(t), visible: true };
}

/** Index of the block rect containing (x, y), or -1. y is ignored when omitted. */
export function hitTestBlock(rects, x, y) {
  for (const r of rects) {
    const inX = x >= r.x && x < r.x + r.w;
    const inY = !isNum(y) || (y >= r.y && y < r.y + r.h);
    if (inX && inY) return r.index;
  }
  return -1;
}

/**
 * Insertion index for a drag at x: 0..rects.length. A pointer left of a block's midpoint
 * inserts before it.
 */
export function dropIndexAt(rects, x) {
  for (let i = 0; i < rects.length; i++) {
    if (x < rects[i].x + rects[i].w / 2) return i;
  }
  return rects.length;
}

/**
 * Convert an insertion index into the `to` argument of moveBlock(model, from, to).
 * Returns -1 when the drop would not change the order.
 */
export function reorderTarget(fromIndex, insertIndex, count) {
  if (!(fromIndex >= 0) || !(insertIndex >= 0)) return -1;
  const ins = isNum(count) ? clamp(insertIndex, 0, count) : insertIndex;
  const to = ins > fromIndex ? ins - 1 : ins;
  return to === fromIndex ? -1 : to;
}

/** x of the insertion marker for an insertion index (between blocks). */
export function insertionMarkerX(rects, insertIndex, scale) {
  if (!rects.length) return scale ? scale.secToPx(0) : 0;
  if (insertIndex <= 0) return rects[0].x;
  if (insertIndex >= rects.length) {
    const last = rects[rects.length - 1];
    return scale ? scale.secToPx(last.endS) : last.x + last.w;
  }
  return rects[insertIndex].x;
}

/** Convenience: scale for a model. */
export function scaleForModel(model, widthPx, opts = {}) {
  return createTimeScale({ ...opts, durationS: totalDuration(model), widthPx });
}
