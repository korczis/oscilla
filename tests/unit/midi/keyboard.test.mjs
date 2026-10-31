// K026: the computer and on-screen keyboard (src/js/midi/keyboard.js, keyboard-view.js), the
// link key and the shortcuts list. Pure: no DOM, no audio.
//
// - The convention of music software, by physical key (KeyboardEvent.code): A W S E D F T G Y
//   H U J K play C up to the next C (black keys on W E T Y U), O L P ; ' go on to F; Z / X move
//   the octave, C / V the velocity. QWERTZ and AZERTY play from the same places.
// - Space, an unmapped key and any key with Ctrl, Meta or Alt are never the keyboard's.
// - A key releases the note it started, whatever the octave meanwhile; repeats are ignored;
//   a pointer glides; every source lights the keys and releaseAll lets go of everything.
// - The on-screen keys: 2 or 3 octaves that follow the octave, the black keys hit first.
// - kbd=1 arms the view a link opens and leaves the address with the first workspace change;
//   the Keyboard shortcuts dialog lists the keys in the Playground and the Studio only.
//
//   node --test tests/unit/midi/keyboard.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CONTROL_KEYS, DEFAULT_BASE, KEYBOARD_LINK_KEY, KEYBOARD_VIEWS, KEY_LABELS, MAX_BASE, MIN_BASE,
  NOTE_KEYS, codeForNote, createKeyboard, isBlack, noteName, playableEvent, resolveKey,
  visibleRange,
} from '../../../src/js/midi/keyboard.js';
import { keyLayout, noteAt } from '../../../src/js/midi/keyboard-view.js';
import { HASH_DOMAINS, hashForWorkspace } from '../../../src/js/ui/navigation.js';
import { shortcutHelp } from '../../../src/js/ui/shortcuts.js';
import { WORKSPACES } from '../../../src/js/ui/app.js';

test('the home row plays C to the next C, black keys on W E T Y U, then O L P ; \'', () => {
  const row = ['KeyA', 'KeyW', 'KeyS', 'KeyE', 'KeyD', 'KeyF', 'KeyT', 'KeyG', 'KeyY', 'KeyH',
    'KeyU', 'KeyJ', 'KeyK', 'KeyO', 'KeyL', 'KeyP', 'Semicolon', 'Quote'];
  assert.deepEqual(row.map((c) => NOTE_KEYS[c]), row.map((_, i) => i), 'chromatic, one per key');
  assert.deepEqual(Object.keys(NOTE_KEYS), row, 'and nothing else plays');
  const blacks = row.filter((c) => isBlack(DEFAULT_BASE + NOTE_KEYS[c]));
  assert.deepEqual(blacks, ['KeyW', 'KeyE', 'KeyT', 'KeyY', 'KeyU', 'KeyO', 'KeyP']);
  assert.equal(noteName(DEFAULT_BASE + NOTE_KEYS.KeyA), 'C4');
  assert.equal(noteName(DEFAULT_BASE + NOTE_KEYS.KeyK), 'C5', 'K is the next C');
  assert.equal(noteName(DEFAULT_BASE + NOTE_KEYS.KeyH), 'A4');
  assert.deepEqual(CONTROL_KEYS, { KeyZ: 'octave-down', KeyX: 'octave-up',
    KeyC: 'velocity-down', KeyV: 'velocity-up' });
  assert.equal(KEY_LABELS.Semicolon, ';');
  assert.equal(KEY_LABELS.KeyY, 'Y');
});

test('physical keys, not characters: a QWERTZ or AZERTY keyboard plays from the same places',
  () => {
    // On QWERTZ the key printed Z sends code KeyY (and key 'z'): it plays G#, as Y on QWERTY.
    assert.deepEqual(resolveKey('KeyY'), { kind: 'note', offset: 8 });
    assert.ok(playableEvent({ code: 'KeyY', key: 'z' }), 'the printed letter does not matter');
    // On QWERTZ the key printed Y sends KeyZ: the octave down, as Z on QWERTY.
    assert.deepEqual(resolveKey('KeyZ'), { kind: 'control', action: 'octave-down' });
    // AZERTY: the key printed Q sends KeyA: C.
    assert.ok(playableEvent({ code: 'KeyA', key: 'q' }));
  });

test('never Space, never an unmapped key, never with Ctrl, Meta or Alt', () => {
  assert.equal(resolveKey('Space'), null);
  assert.equal(playableEvent({ code: 'Space', key: ' ' }), false);
  assert.equal(playableEvent({ code: 'KeyA', key: ' ' }), false, 'a remapped Space is Space');
  for (const code of ['KeyQ', 'KeyR', 'KeyI', 'KeyB', 'KeyN', 'KeyM', 'Enter', 'Escape',
    'ArrowLeft', 'Digit1', 'Tab']) assert.equal(resolveKey(code), null, code);
  for (const mod of ['ctrlKey', 'metaKey', 'altKey']) {
    assert.equal(playableEvent({ code: 'KeyC', key: 'c', [mod]: true }), false, mod);
  }
  assert.ok(playableEvent({ code: 'KeyA', key: 'A', shiftKey: true }), 'Shift still plays');
});

function rig() {
  const played = [];
  const released = [];
  let changes = 0;
  const kb = createKeyboard({
    play: (note, velocity, source) => { played.push([note, velocity, source]); return { ok: true }; },
    release: (note, source) => released.push([note, source]),
    changed: () => { changes++; },
  });
  return { kb, played, released, changes: () => changes };
}

test('a key plays at the octave and velocity, repeats are ignored, keyup releases its note',
  () => {
    const { kb, played, released } = rig();
    kb.keyDown('KeyA');
    kb.keyDown('KeyA', true);
    kb.keyDown('KeyA');
    assert.deepEqual(played, [[60, 100, 'keys']], 'one note per press');
    kb.keyDown('KeyX');
    assert.equal(kb.base, 72, 'X: an octave up');
    kb.keyUp('KeyA');
    assert.deepEqual(released, [[60, 'keys']], 'the note the key started, not the new octave\'s');
    kb.keyDown('KeyV');
    kb.keyDown('KeyV', true);
    assert.equal(kb.velocity, 120, 'V: velocity + 20; a repeat does nothing');
    kb.keyDown('KeyV');
    assert.equal(kb.velocity, 127, 'capped at 127');
    for (let i = 0; i < 9; i++) kb.keyDown('KeyC');
    assert.equal(kb.velocity, 1, 'C: down to 1, never 0');
    kb.keyDown('KeyS');
    assert.deepEqual(played.at(-1), [74, 1, 'keys'], 'D5 at the new octave and velocity');
    for (let i = 0; i < 20; i++) kb.keyDown('KeyZ');
    assert.equal(kb.base, MIN_BASE, 'Z stops at C0');
    for (let i = 0; i < 20; i++) kb.keyDown('KeyX');
    assert.equal(kb.base, MAX_BASE, 'X stops at C8');
    assert.equal(kb.octave, 8, 'C8');
  });

test('every source lights the keys; a refused note stays dark; releaseAll lets go of all', () => {
  const { kb, released } = rig();
  kb.keyDown('KeyA');
  kb.pointerTo(1, 64);
  kb.light(67, 'midi', true);
  kb.light(60, 'midi', true);
  assert.deepEqual(kb.held, [{ note: 60, sources: ['keys', 'midi'] },
    { note: 64, sources: ['pointer'] }, { note: 67, sources: ['midi'] }]);
  kb.pointerTo(1, 65);
  assert.deepEqual(released, [[64, 'pointer']], 'a drag glides: the old key is released');
  assert.ok(kb.isLit(65) && !kb.isLit(64));
  assert.equal(kb.releaseAll(), 2, 'one key and one pointer held');
  assert.deepEqual(kb.held, [{ note: 60, sources: ['midi'] }, { note: 67, sources: ['midi'] }],
    'MIDI notes stay lit: the MIDI layer unlights them');
  kb.clear('midi');
  assert.equal(kb.sounding, false);
  const refused = createKeyboard({ play: () => ({ ok: false, reason: 'studio' }) });
  refused.keyDown('KeyA');
  assert.equal(refused.sounding, false, 'a refused note is not lit');
  assert.equal(refused.keyUp('KeyA'), false);
});

test('the on-screen keys: 2 or 3 octaves that follow the octave, black keys hit first', () => {
  assert.deepEqual(visibleRange(60, 3), { first: 48, last: 84 });
  assert.deepEqual(visibleRange(60, 2), { first: 60, last: 84 });
  assert.deepEqual(visibleRange(12, 3), { first: 0, last: 36 });
  assert.deepEqual(visibleRange(108, 3), { first: 91, last: 127 }, 'never past 127');
  const layout = keyLayout(48, 84, 660, 132);
  assert.equal(layout.filter((k) => !k.black).length, 22, '3 octaves and the top C: 22 white');
  assert.equal(layout.filter((k) => k.black).length, 15);
  const c4 = layout.find((k) => k.note === 60);
  const cs4 = layout.find((k) => k.note === 61);
  assert.equal(noteAt(layout, c4.x + 2, 120), 60, 'the bottom of a white key');
  assert.equal(noteAt(layout, cs4.x + cs4.w / 2, 10), 61, 'a black key over the white keys');
  assert.equal(noteAt(layout, c4.x + 2, 10), 60, 'the white key beside the black one');
  assert.equal(noteAt(layout, 700, 10), null, 'outside the keys');
  assert.equal(codeForNote(60, 60), 'KeyA');
  assert.equal(codeForNote(61, 60), 'KeyW');
  assert.equal(codeForNote(59, 60), null);
});

test('the link key arms the view a link opens and leaves with the first workspace change', () => {
  assert.equal(KEYBOARD_LINK_KEY, 'kbd');
  assert.deepEqual([...KEYBOARD_VIEWS], ['playground', 'studio']);
  assert.ok(HASH_DOMAINS.includes('keyboard'), 'one dispatcher reads it (ADR 0045)');
  assert.equal(new URLSearchParams(hashForWorkspace('m=playground&kbd=1', 'playground'))
    .get('kbd'), '1', 'kept while the workspace stays');
  assert.equal(new URLSearchParams(hashForWorkspace('m=playground&kbd=1', 'measure'))
    .get('kbd'), null, 'gone with the change');
  assert.equal(new URLSearchParams(hashForWorkspace('m=studio&kbd=1', 'playground'))
    .get('kbd'), null);
});

test('the shortcuts dialog lists the keyboard in the Playground and the Studio only', () => {
  for (const ws of WORKSPACES) {
    const ids = shortcutHelp(ws).rows.map((r) => r.id).filter((id) => id.startsWith('keyboard-'));
    const want = KEYBOARD_VIEWS.includes(ws)
      ? ['keyboard-notes', 'keyboard-octave', 'keyboard-velocity'] : [];
    assert.deepEqual(ids, want, ws);
  }
  const notes = shortcutHelp('playground').rows.find((r) => r.id === 'keyboard-notes');
  assert.match(notes.keys, /^A W S E D F T G Y H U J K/);
  assert.doesNotMatch(notes.keys, /Space/);
});
