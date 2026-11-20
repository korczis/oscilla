// The export helpers' browser seams (src/js/ui/exporters.js downloadBlob, canvasToBlob,
// screenshotCanvases, renderSequenceToWav, readFileText, FileTooLargeError): a download clicks a
// hidden <a download> on an object URL, removes it and revokes the URL after 30 s (mock timers,
// no wall clock); toBlob's null and throw both reject; a screenshot composites only the visible
// canvases at their offsets and the device pixel ratio (capped at 2), titles it, and refuses when
// nothing is visible; a sequence render needs an OfflineAudioContext and refuses a buffer longer
// than the export limit; a file larger than the import limit is refused before it is read. On
// stubbed document, window, canvas and FileReader objects.
//   node --test tests/unit/exporters-browser-seams.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  EXPORT_MAX_S, FileTooLargeError, canvasToBlob, downloadBlob, readFileText, renderSequenceToWav,
  screenshotCanvases,
} from '../../src/js/ui/exporters.js';
import { fakeOfflineCtor } from './sequencer-fake-audio.mjs';

test('downloadBlob clicks a hidden download link and revokes its URL after 30 s', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const created = [];
  const revoked = [];
  t.mock.method(URL, 'createObjectURL', () => 'blob:oscilla/1');
  t.mock.method(URL, 'revokeObjectURL', (u) => revoked.push(u));
  const appended = [];
  const doc = {
    createElement: (tag) => {
      const a = { tag, style: {}, clicks: 0, removed: false, click() { this.clicks += 1; },
        remove() { this.removed = true; } };
      created.push(a);
      return a;
    },
    body: { appendChild: (n) => appended.push(n) },
  };
  downloadBlob(new Blob(['x']), 'sweep.wav', doc);
  const a = created[0];
  assert.equal(a.tag, 'a');
  assert.equal(a.href, 'blob:oscilla/1');
  assert.equal(a.download, 'sweep.wav');
  assert.equal(a.rel, 'noopener');
  assert.equal(a.style.display, 'none');
  assert.deepEqual(appended, [a]);
  assert.equal(a.clicks, 1);
  assert.equal(a.removed, true);
  t.mock.timers.tick(29999);
  assert.deepEqual(revoked, []);
  t.mock.timers.tick(1);
  assert.deepEqual(revoked, ['blob:oscilla/1']);
});

test('canvasToBlob resolves the blob, rejects a null one and a throwing encoder', async () => {
  const blob = new Blob(['png']);
  const types = [];
  assert.equal(await canvasToBlob({ toBlob: (cb, type) => { types.push(type); cb(blob); } }), blob);
  assert.deepEqual(types, ['image/png']);
  await canvasToBlob({ toBlob: (cb, type) => { types.push(type); cb(blob); } }, 'image/webp');
  assert.equal(types[1], 'image/webp');
  await assert.rejects(canvasToBlob({ toBlob: (cb) => cb(null) }),
    { message: 'The canvas could not be encoded.' });
  await assert.rejects(canvasToBlob({ toBlob: () => { throw new Error('tainted'); } }),
    { message: 'tainted' });
});

/** A canvas as the screenshot reads it: its bitmap size, on-screen box and offsetParent. */
const fakeCanvas = (box, { width = 100, height = 50, offsetParent = {},
  position = 'static' } = {}) => ({
  width, height, offsetParent, position, getBoundingClientRect: () => box,
});

function stubScreen({ dpr = 1 } = {}) {
  const draws = [];
  const texts = [];
  const out = { width: 0, height: 0,
    getContext: () => ({ fillRect() {}, drawImage: (c, x, y, w, h) => {
      if (c.throws) throw new Error('lost');
      draws.push({ c, x, y, w, h });
    }, fillText: (s, x, y) => texts.push({ s, x, y }) }),
    toBlob: (cb) => cb(new Blob(['png'])) };
  globalThis.window = { devicePixelRatio: dpr };
  globalThis.document = { createElement: () => out };
  globalThis.getComputedStyle = (c) => ({ position: c.position });
  return { out, draws, texts };
}

test('a screenshot composites the visible canvases at their offsets and the pixel ratio',
  async () => {
    const s = stubScreen({ dpr: 3 }); // capped at 2
    const shown = fakeCanvas({ left: 30, top: 20, width: 100, height: 50 });
    const fixed = fakeCanvas({ left: 10, top: 10, width: 20, height: 20 },
      { offsetParent: null, position: 'fixed' });
    const hiddenParent = fakeCanvas({ left: 0, top: 0, width: 20, height: 20 },
      { offsetParent: null });
    const empty = fakeCanvas({ left: 0, top: 0, width: 20, height: 20 }, { width: 0 });
    const tiny = fakeCanvas({ left: 0, top: 0, width: 1, height: 20 });
    const lost = Object.assign(fakeCanvas({ left: 0, top: 0, width: 20, height: 20 }),
      { throws: true });
    const root = { getBoundingClientRect: () => ({ left: 10, top: 10, width: 200, height: 100 }),
      querySelectorAll: (sel) => (sel === 'canvas'
        ? [shown, fixed, hiddenParent, empty, tiny, lost] : []) };
    const r = await screenshotCanvases(root, { title: 'OSCILLA' });
    assert.equal(r.count, 3, 'shown, fixed and the lost one are visible; the rest are not');
    assert.equal(r.width, 400);
    assert.equal(r.height, 200);
    assert.ok(r.blob instanceof Blob);
    assert.deepEqual(s.draws.map((d) => [d.c, d.x, d.y, d.w, d.h]),
      [[shown, 40, 20, 200, 100], [fixed, 0, 0, 40, 40]], 'the lost canvas is skipped');
    assert.equal(s.texts.length, 1);
    assert.deepEqual(s.texts[0], { s: 'OSCILLA', x: 16, y: 200 - 16 });

    stubScreen();
    const plain = await screenshotCanvases(root);
    assert.equal(plain.width, 200);
  });

test('a screenshot with nothing visible is refused', async () => {
  stubScreen();
  const root = { getBoundingClientRect: () => ({ left: 0, top: 0, width: 10, height: 10 }),
    querySelectorAll: () => [fakeCanvas({ left: 0, top: 0, width: 0, height: 0 })] };
  await assert.rejects(screenshotCanvases(root), { message: 'No chart is visible to capture.' });
});

test('a sequence render needs an OfflineAudioContext and keeps to the export limit', async () => {
  globalThis.window = {};
  await assert.rejects(renderSequenceToWav({}, { sampleRate: 48000, level: 0.5 }),
    { message: 'OfflineAudioContext is not available in this browser.' });
  const tone = { tempoBpm: 120, loop: false, waveform: 'sine',
    blocks: [{ id: 't1', type: 'tone', durationMs: 500, params: { freq: 1000 } }] };
  const made = [];
  const r = await renderSequenceToWav(tone, { sampleRate: 48000, level: 0.5,
    OfflineCtor: fakeOfflineCtor(made) });
  assert.equal(made.length, 1);
  assert.ok(made[0].length >= 0.5 * 48000, 'the sequence and its tail');
  assert.equal(made[0].numberOfChannels, 2);
  assert.ok(r.wav instanceof ArrayBuffer);
  assert.equal(r.stats.clippedSamples, 0);
  // A buffer longer than the export limit (plus its one-second grace) is refused.
  const Long = class extends fakeOfflineCtor([]) {
    startRendering() {
      return Promise.resolve(this.createBuffer(1, (EXPORT_MAX_S + 1.5) * 100, 100));
    }
  };
  await assert.rejects(renderSequenceToWav(tone, { sampleRate: 48000, level: 0.5,
    OfflineCtor: Long }), { message: `The sequence lasts ${(EXPORT_MAX_S + 1.5).toFixed(1)} s; `
    + `exports are limited to ${EXPORT_MAX_S} s.` });
  const Edge = class extends fakeOfflineCtor([]) {
    startRendering() {
      return Promise.resolve(this.createBuffer(1, (EXPORT_MAX_S + 1) * 100, 100));
    }
  };
  await renderSequenceToWav(tone, { sampleRate: 48000, level: 0.5, OfflineCtor: Edge });
});

test('a file over the import limit is refused before it is read, with its sizes', async () => {
  let read = 0;
  globalThis.FileReader = class {
    readAsText(file) {
      read += 1;
      queueMicrotask(() => {
        if (file.fail) { this.error = new Error('IO'); this.onerror(); } else {
          this.result = file.text;
          this.onload();
        }
      });
    }
  };
  const big = { size: 3 * 2 ** 20 };
  const e = await readFileText(big, { maxBytes: 2 ** 20, what: 'The record' }).catch((x) => x);
  assert.ok(e instanceof FileTooLargeError);
  assert.ok(e instanceof RangeError);
  assert.equal(e.name, 'FileTooLargeError');
  assert.equal(e.size, 3 * 2 ** 20);
  assert.equal(e.maxBytes, 2 ** 20);
  assert.equal(e.message, 'The record is 3.0 MiB, larger than the 1.0 MiB import limit; it was '
    + 'not read.');
  assert.equal(read, 0, 'never read');
  assert.match(new FileTooLargeError(2048, 1024).message,
    /^The file is 0\.00 MiB, larger than the /);

  assert.equal(await readFileText({ size: 4, text: 'abcd' }, { maxBytes: 4 }), 'abcd');
  await assert.rejects(readFileText({ size: 1, fail: true }), { message: 'IO' });
  assert.equal(read, 2);
});

test('the export limit is a minute', () => {
  assert.equal(EXPORT_MAX_S, 60);
});
