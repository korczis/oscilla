// U016: "go to start" has one glyph. The Pattern Sequencer's Play from the start
// [data-osc=seq.start] and the Studio's Return to start [data-osc=studio.return] reference the
// same sprite symbol, the one built from lucide's skip-back (a left-pointing glyph), and the
// fast-forward #i-skip the Sequencer drew before is gone from the document.
//   node --test tests/unit/transport-glyphs.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const html = fs.readFileSync(path.join(here, '../../src/index.html'), 'utf8');

/** The href of the first <use> inside the element carrying data-osc="<hook>". */
function useOf(hook) {
  const at = html.indexOf(`data-osc="${hook}"`);
  assert.ok(at >= 0, `an element with data-osc="${hook}"`);
  const close = html.indexOf('</button>', at);
  assert.ok(close > at, `${hook} is a button`);
  const m = /<use href="#([^"]+)"\s*\/>/.exec(html.slice(at, close));
  assert.ok(m, `${hook} draws a sprite symbol`);
  return m[1];
}

test('U016 Play from the start and Return to start draw the same skip-back symbol', () => {
  const start = useOf('seq.start');
  const ret = useOf('studio.return');
  assert.equal(start, ret, `seq.start uses #${start}, studio.return #${ret}`);
  const sym = new RegExp(`<symbol id="${start}"[^>]*>([\\s\\S]*?)</symbol>`).exec(html);
  assert.ok(sym, `the symbol #${start} exists`);
  assert.match(sym[1], /<!-- @icon:skip-back -->/, 'built from lucide skip-back');
});

test('U016 the fast-forward #i-skip has no user and no symbol', () => {
  assert.doesNotMatch(html, /href="#i-skip"/, 'no <use> references i-skip');
  assert.doesNotMatch(html, /<symbol id="i-skip"/, 'no symbol with id i-skip');
});
