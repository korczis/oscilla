// U099 (Q104, rule project.czech-prose): the Synth bay's last English, its CABLES heading and
// each cable row with its Remove button (src/js/synth/view/bay.js cableItem), is Czech, and
// neither synth/ui.js nor view/bay.js shows any text either Czech-prose measure counts (the
// sentences of scripts/czech-prose.mjs and the short English of scripts/czech-prose-short.mjs).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { cableItem } from '../../src/js/synth/view/bay.js';
import { moduleProse } from '../../scripts/czech-prose.mjs';
import { moduleShort } from '../../scripts/czech-prose-short.mjs';

const read = (f) => readFileSync(new URL(`../../${f}`, import.meta.url), 'utf8');

test('a cable row of the bay is Czech: its text, its button and the button\'s name', () => {
  const html = cableItem({ id: 'e-1', from: 'mg.control', to: 'lpf.frequency' }, 'patched',
    { jackName: (j) => ({ 'mg.control': 'MG výstup', 'lpf.frequency': 'LPF cutoff' })[j],
      item: 'row', btn: 'btn' });
  assert.match(html, />Odpojit<\/button>/);
  assert.match(html, /aria-label="Odpojit kabel MG výstup → LPF cutoff"/);
  assert.doesNotMatch(html, /Remove/);
});

test('the bay heading is KABELY, and the Synth bay files show no English either measure sees',
  () => {
    const ui = read('src/js/synth/ui.js');
    assert.match(ui, /id="synth-cables-title">KABELY<\/h4>/);
    for (const f of ['src/js/synth/ui.js', 'src/js/synth/view/bay.js']) {
      assert.deepEqual(moduleShort(read(f)), [], `${f}: short English`);
      assert.deepEqual(moduleProse(read(f)), [], `${f}: English sentences`);
    }
  });
