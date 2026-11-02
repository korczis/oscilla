// B2 slice 1 (intent ui-current, criterion phone-whole): the Synth patch bay on a phone.
//
// - Every text of the bay SVG is at least 12 px (the SVG draws 1:1, so a user unit is a CSS
//   pixel), and a jack's label fits its 52 px pitch: at most LABEL_MAX characters with an
//   output's " ▸", the jack's accessible name keeping the whole label.
// - Below xl the view shows one face at a time, the module cards or the bay, switched by a
//   Panel and a Patch bay chip that say which is pressed; a module chip brings the cards back.
//
//   node --test tests/unit/synth-bay-phone.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import PANEL from '../../src/js/synth/panels/semi-mono.js';
import * as bay from '../../src/js/synth/view/bay.js';
import { panelTokens } from '../../src/js/synth/view/tokens.js';

const faces = await import('../../src/js/synth/view/faces.js').catch(() => ({}));
const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');

function svgAt(width) {
  const layout = bay.bayLayout(PANEL, width);
  return { layout, svg: bay.baySvg({ panel: PANEL, layout, tokens: panelTokens(null) }) };
}

test('every text of the bay is 12 px or more', () => {
  assert.ok(bay.BAY_TEXT >= 12, 'BAY_TEXT');
  for (const width of [358, 376]) {
    const sizes = [...svgAt(width).svg.matchAll(/font-size="(\d+(?:\.\d+)?)"/g)]
      .map((m) => +m[1]);
    assert.ok(sizes.length > 0, 'the bay has text');
    assert.deepEqual(sizes.filter((s) => s < 12), [], `at ${width} px`);
  }
});

test('a jack label fits its pitch and its accessible name keeps the whole label', () => {
  assert.equal(typeof bay.shortLabel, 'function');
  assert.equal(bay.shortLabel('Cutoff'), 'Cutoff');
  assert.equal(bay.shortLabel('Resonance').length, bay.LABEL_MAX);
  assert.match(bay.shortLabel('Resonance'), /…$/);
  assert.equal(bay.shortLabel('Velocity', 'out').length, bay.LABEL_MAX);
  assert.match(bay.shortLabel('Velocity', 'out'), /… ▸$/);
  assert.equal(bay.shortLabel('Gate', 'out'), 'Gate ▸');
  const { svg } = svgAt(358);
  const jackText = /<text [^>]*text-anchor="middle"[^>]*>([^<]*)<\/text>/g;
  const labels = [...svg.matchAll(jackText)]
    .map((m) => m[1].replace(/&[a-z]+;/g, '_'));
  assert.ok(labels.length > 10, 'jack labels drawn');
  assert.deepEqual(labels.filter((l) => l.length > bay.LABEL_MAX), []);
  for (const m of PANEL.modules) {
    for (const j of PANEL.jacksOf(m.id)) {
      const key = j.key.replace(/[.]/g, '\\.');
      const g = svg.match(new RegExp(`data-jack="${key}" aria-label="([^"]*)"`));
      assert.ok(g && g[1].includes(j.label.replace(/&/g, '&amp;')), `${j.key} names ${j.label}`);
    }
  }
});

test('below xl the Synth shows the cards or the bay, switched by two pressed chips', () => {
  assert.equal(typeof faces.faceChips, 'function');
  for (const f of ['panel', 'bay']) {
    const chips = faces.faceChips(f);
    assert.match(chips, new RegExp(`data-face="${f}" aria-pressed="true"`));
    const other = f === 'bay' ? 'panel' : 'bay';
    assert.match(chips, new RegExp(`data-face="${other}" aria-pressed="false"`));
  }
  assert.match(faces.faceChips('bay'), /data-face="panel"[^>]*class="[^"]*xl:hidden/);
  assert.equal(faces.faceClass('bay', 'bay'), '');
  assert.equal(faces.faceClass('panel', 'bay'), 'max-xl:hidden');
  const ui = read('src/js/synth/ui.js');
  assert.match(ui, /data-face-of="panel" class="\$\{faceClass\(face, 'panel'\)\}"/);
  assert.match(ui, /\$\{faceClass\(face, 'bay'\)\}" data-face-of="bay"/);
  assert.match(ui, /if \(face !== 'panel'\) showFace\('panel'\);\s*gotoSection\(d\.goto\)/);
  assert.doesNotMatch(ui, /data-goto="bay"/, 'Patch bay is a face, not a scroll target only');
});
