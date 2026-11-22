// V635 (intent ui-current, criterion phone-whole): the Synth workspace on a phone.
//
// - No text class of the Synth's markup sets a size under 12 px below the xl breakpoint: a
//   size under 12 px is written only as `xl:text-[Npx]` beside a phone size of at least
//   text-xs, so a phone reads 12 px and the desktop keeps its measured size.
// - The dock never buries the panel on a phone: in the Synth its instrument row, Arm and
//   Velocity fold behind the Vše toggle below sm (keys and Octave stay), the keyboard component
//   starts folded, and the Synth view's bottom padding reads the dock's published height
//   (--osc-dock-h, one writer) instead of a fixed 20 rem.
//
//   node --test tests/unit/synth-phone.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createKeyboardUi } from '../../src/js/midi/keyboard-ui.js';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

function files(dir) {
  return readdirSync(join(ROOT, dir)).flatMap((f) => {
    const p = join(dir, f);
    return statSync(join(ROOT, p)).isDirectory() ? files(p) : (p.endsWith('.js') ? [p] : []);
  });
}

test('no Synth text is under 12 px below the xl breakpoint', () => {
  const offenders = [];
  for (const p of [...files('src/js/synth'), 'src/js/ui/kinds/xy-pad.js']) {
    for (const m of read(p).matchAll(/(\S*)text-\[(\d+(?:\.\d+)?)px\]/g)) {
      if (Number(m[2]) < 12 && m[1] !== 'xl:') offenders.push(`${p}: ${m[0]}`);
    }
  }
  assert.deepEqual(offenders, []);
});

test('the dock folds on a phone in the Synth and the keys and Octave stay', () => {
  const html = read('src/index.html');
  // Velocity folds wherever the keys dock (Synth and Studio, M086); Arm only in the Synth,
  // whose keys start armed (the Studio's start disarmed, so its Arm stays).
  const folds = { 'keyboard.arm': "kbdView === 'synth' && !kbdMore && 'max-sm:hidden'",
    'keyboard.velocity-down': "kbdDocked && !kbdMore && 'max-sm:hidden'",
    'keyboard.velocity-up': "kbdDocked && !kbdMore && 'max-sm:hidden'" };
  for (const [id, fold] of Object.entries(folds)) {
    const tag = html.match(new RegExp(`<button[^>]*data-osc="${id.replace('.', '\\.')}"[^>]*>`, 's'));
    assert.ok(tag && tag[0].includes(fold), `${id} folds on a phone where it should`);
  }
  for (const id of ['keyboard.octave-down', 'keyboard.octave-up']) {
    const tag = html.match(new RegExp(`<button[^>]*data-osc="${id.replace('.', '\\.')}"[^>]*>`, 's'));
    assert.ok(tag && !tag[0].includes('max-sm:hidden'), `${id} stays on a phone`);
  }
  const dock = html.match(/<div[^>]*data-osc="synth\.dock"[^>]*>/s);
  assert.ok(dock && dock[0].includes("!kbdMore && 'max-sm:hidden'"), 'the instrument row folds');
  const more = html.match(/<button[^>]*data-osc="keyboard\.more"[^>]*>/s);
  assert.ok(more, 'a More button unfolds them');
  assert.match(more[0], /aria-controls="osc-synth-dock"/);
  assert.match(more[0], /:aria-expanded="String\(kbdMore\)"/);
  assert.match(more[0], /sm:hidden/);
});

test('the Synth\'s content ends above the dock, as K247 ends every docked workspace (U121)',
  () => {
  const html = read('src/index.html');
  const view = html.match(/<section[^>]*id="osc-view-synth"[^>]*>/s);
  assert.ok(view, 'the Synth view');
  // U121 (oscilla-d9's Q090 settlement): <main> ends at the dock's top on the Synth too, so the
  // view no longer pads its bottom by the dock's band and the scroller keeps no dock padding.
  assert.doesNotMatch(view[0], /--osc-dock-h/, 'the view reserves no band of its own');
  assert.doesNotMatch(view[0], /\bpb-80\b/);
  const main = html.match(/<main [^>]*id="osc-main"[^>]*>/s);
  assert.ok(main, '#osc-main');
  assert.match(main[0],
    /kbdDocked && workspace !== 'studio' && '!mb-\[max\(0px,calc\(var\(--osc-dock-h,0px\)/,
    'K247\'s margin binds the Synth (only the Studio keeps its own band)');
  assert.doesNotMatch(main[0], /workspace !== 'synth'/);
  assert.match(main[0], /workspace === 'synth' && '[^']*!scroll-pb-0/,
    'the Synth\'s scroller keeps no scroll padding for a dock it no longer runs under');
  // One dock height, one writer (26's trackDockHeight, the synth train).
  const kui = read('src/js/midi/keyboard-ui.js');
  assert.match(kui, /setProperty\('--osc-dock-h'/);
  assert.doesNotMatch(kui, /--osc-kbd-h/, 'no second dock-height writer');
});

test('the keyboard component starts folded', () => {
  assert.equal(typeof createKeyboardUi, 'function');
  const part = createKeyboardUi({ win: {} });
  assert.equal(part.kbdMore, false);
});
