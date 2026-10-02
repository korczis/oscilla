import { test } from 'node:test';
import assert from 'node:assert/strict';
import { referenceSequence, createSequence, moveBlock } from '../../src/js/sequencer/model.js';
import {
  createTimeScale,
  chooseTickStep,
  generateTicks,
  formatTick,
  layoutBlocks,
  playheadPosition,
  hitTestBlock,
  dropIndexAt,
  reorderTarget,
  insertionMarkerX,
  scaleForModel,
  BLOCK_ACCENTS,
} from '../../src/js/sequencer/timeline.js';

const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps, `${a} != ${b}`);

test('time scale: span, px per second and inverse mapping', () => {
  const s = createTimeScale({ durationS: 2.25, widthPx: 520, originPx: 10, minSpanS: 4 });
  assert.equal(s.spanS, 4);
  assert.equal(s.pxPerSecond, 130);
  assert.equal(s.secToPx(0), 10);
  assert.equal(s.secToPx(1), 140);
  near(s.pxToSec(s.secToPx(1.234)), 1.234);
  const grow = createTimeScale({ durationS: 10, widthPx: 500, headroomRatio: 0.2 });
  assert.equal(grow.spanS, 12);
  const bad = createTimeScale({ durationS: NaN, widthPx: -5 });
  assert.equal(bad.spanS, 1);
  assert.ok(Number.isFinite(bad.pxPerSecond) && bad.pxPerSecond > 0);
});

test('ticks: reference-like 0.5 s spacing with 0.0s labels', () => {
  const s = createTimeScale({ durationS: 2.25, widthPx: 520, minSpanS: 4 });
  assert.equal(chooseTickStep(s), 0.5);
  const ticks = generateTicks(s);
  assert.deepEqual(
    ticks.map((t) => t.label),
    ['0.0s', '0.5s', '1.0s', '1.5s', '2.0s', '2.5s', '3.0s', '3.5s', '4.0s'],
  );
  assert.equal(ticks[3].x, 195);
  const fine = generateTicks(createTimeScale({ durationS: 0.2, widthPx: 1000, minSpanS: 0.2 }));
  assert.equal(fine[1].label, '0.01s');
  const coarse = createTimeScale({ durationS: 600, widthPx: 300 });
  assert.equal(chooseTickStep(coarse), 60);
  assert.equal(formatTick(0.25, 0.05), '0.25s');
  const exact = generateTicks(createTimeScale({ durationS: 1, widthPx: 1000 }), 0.1);
  assert.equal(exact.length, 11, 'no floating-point drop of the last tick');
  assert.equal(exact[3].t, 0.3);
});

test('block rects: positions, widths with gap, labels and accents', () => {
  const m = referenceSequence();
  const s = createTimeScale({ durationS: 2.25, widthPx: 520, minSpanS: 4 });
  const rects = layoutBlocks(m, s, { y: 4, height: 44, gapPx: 4 });
  assert.deepEqual(
    rects.map((r) => r.x),
    [0, 65, 130, 162.5, 227.5],
  );
  assert.deepEqual(
    rects.map((r) => r.w),
    [61, 61, 28.5, 61, 61],
  );
  assert.deepEqual(
    rects.map((r) => r.label),
    ['Tone', 'Sweep', 'Silence', 'Pulse', 'Chirp'],
  );
  assert.equal(rects[1].detail, '440 → 880 Hz');
  assert.equal(rects[0].accent, 'green');
  assert.equal(rects[2].accent, 'neutral');
  assert.equal(rects[3].accent, 'orange');
  assert.equal(rects[4].y, 4);
  assert.equal(rects[4].h, 44);
  assert.equal(rects[4].endS, 2.25);
  const tiny = layoutBlocks(createSequence({ blocks: [{ type: 'tone', durationMs: 10 }] }), s, {
    gapPx: 2,
    minWidthPx: 6,
  });
  assert.equal(tiny[0].w, 6);
  for (const k of Object.keys(BLOCK_ACCENTS)) assert.equal(typeof BLOCK_ACCENTS[k], 'string');
});

test('playhead follows the audio clock', () => {
  const s = createTimeScale({ durationS: 2.25, widthPx: 520, minSpanS: 4 });
  const p = (ctxTime, loop = false) =>
    playheadPosition({ ctxTime, t0: 10, durationS: 2.25, loop, scale: s });
  assert.deepEqual(p(9), { t: 0, x: 0, visible: true });
  assert.deepEqual(p(11), { t: 1, x: 130, visible: true });
  assert.equal(p(12.25).visible, true);
  assert.equal(p(12.3).visible, false);
  near(p(12.75, true).t, 0.5);
  assert.equal(playheadPosition({ ctxTime: 1, t0: null, durationS: 1, scale: s }).visible, false);
  assert.equal(playheadPosition(null).visible, false);
});

test('hit testing and drag-reorder index computation', () => {
  const m = referenceSequence();
  const s = createTimeScale({ durationS: 2.25, widthPx: 520, minSpanS: 4 });
  const rects = layoutBlocks(m, s, { y: 0, height: 40, gapPx: 4 });
  assert.equal(hitTestBlock(rects, 10, 10), 0);
  assert.equal(hitTestBlock(rects, 63, 10), -1, 'in the gap');
  assert.equal(hitTestBlock(rects, 140, 10), 2);
  assert.equal(hitTestBlock(rects, 140, 50), -1, 'below the row');
  assert.equal(hitTestBlock(rects, 140), 2, 'y optional');
  assert.equal(hitTestBlock(rects, 400, 10), -1);
  assert.equal(dropIndexAt(rects, 5), 0);
  assert.equal(dropIndexAt(rects, 40), 1);
  assert.equal(dropIndexAt(rects, 170), 3);
  assert.equal(dropIndexAt(rects, 999), 5);
  // Drag block 0 to the end: insertion 5 -> moveBlock(0, 4).
  assert.equal(reorderTarget(0, 5, 5), 4);
  assert.equal(reorderTarget(4, 0, 5), 0);
  assert.equal(reorderTarget(2, 2, 5), -1, 'dropping on itself');
  assert.equal(reorderTarget(2, 3, 5), -1, 'dropping right after itself');
  assert.equal(reorderTarget(2, 4, 5), 3);
  assert.equal(reorderTarget(-1, 2, 5), -1);
  const moved = moveBlock(m, 0, reorderTarget(0, dropIndexAt(rects, 999), 5));
  assert.deepEqual(
    moved.blocks.map((b) => b.type),
    ['sweep', 'silence', 'pulse', 'chirp', 'tone'],
  );
  assert.equal(insertionMarkerX(rects, 0, s), 0);
  assert.equal(insertionMarkerX(rects, 2, s), 130);
  assert.equal(insertionMarkerX(rects, 5, s), 292.5);
  assert.equal(insertionMarkerX([], 0, s), 0);
});

test('scaleForModel uses the model duration', () => {
  const s = scaleForModel(referenceSequence(), 450, { minSpanS: 1 });
  assert.equal(s.spanS, 2.25);
  assert.equal(s.pxPerSecond, 200);
});
