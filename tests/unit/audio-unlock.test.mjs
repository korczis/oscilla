// A phone sounds (owner report 2026-11-02): the unlock contract of ui/audio-unlock.js, the
// unit-gate half of tests/browser/touch-audio.cjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { armAudioUnlock, UNLOCK_EVENTS } from '../../src/js/ui/audio-unlock.js';

function stubWindow() {
  const listened = [];
  return { listened, addEventListener: (type, fn, opts) => listened.push({ type, fn, opts }) };
}

test('the unlock listens at both ends of a touch and at a mouse or key, never at a bare click',
  () => {
  const win = stubWindow();
  const unlock = () => {};
  const armed = armAudioUnlock({ win, nav: {}, unlock });
  const types = win.listened.map((l) => l.type);
  assert.deepEqual([...types].sort(), ['keydown', 'pointerdown', 'pointerup', 'touchend']);
  assert.ok(win.listened.every((l) => l.fn === unlock && l.opts && l.opts.capture === true),
    'every listener is the unlock, in the capture phase');
  assert.ok(!types.includes('click'),
    'a bare click (assistive technology) is no gesture and must create no AudioContext');
  assert.deepEqual([...armed.events].sort(), [...UNLOCK_EVENTS].sort());
});

test('iOS is asked for a playback session where the API exists, and nothing breaks without it',
  () => {
  const nav = { audioSession: { type: 'auto' } };
  assert.equal(armAudioUnlock({ win: stubWindow(), nav, unlock() {} }).session, 'playback');
  assert.equal(nav.audioSession.type, 'playback');

  assert.equal(armAudioUnlock({ win: stubWindow(), nav: {}, unlock() {} }).session, null,
    'no audioSession API: nothing to set');

  const refusing = { audioSession: {} };
  Object.defineProperty(refusing.audioSession, 'type', {
    get: () => 'ambient',
    set: () => { throw new Error('NotSupportedError'); },
  });
  const r = armAudioUnlock({ win: stubWindow(), nav: refusing, unlock() {} });
  assert.equal(r.session, null, 'a refused type keeps the default and does not throw');
});

test('main.js arms the unlock through the module, not a hand-written listener list', () => {
  const main = readFileSync(new URL('../../src/js/main.js', import.meta.url), 'utf8');
  assert.match(main, /armAudioUnlock\(\{ win: window, nav: navigator,/);
  assert.doesNotMatch(main, /addEventListener\('pointerdown', unlock/);
});
