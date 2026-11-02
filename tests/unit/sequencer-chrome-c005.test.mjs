// C005 (findings control-census-4 and control-census-6): the sequencer's chrome says what it does.
//
// (a) The Loop toggle is drawn as a loop. The element sequencer-panel.js binds as loopBtn draws
//     the #s-loop sprite symbol (the glyph Studio's loop toggle uses), carries title="Loop", and
//     is not the red Record dot (#i-record, class osc-transport-btn--record): it only switches
//     model.loop, and nothing records.
// (b) The Add block grid menu opens downward. An upward .osc-menu--grid (bottom: calc(100% + 6px))
//     put its top row (Tone, Silence) above the top edge of the scrolling .osc-main, which clipped
//     it, so a pointer could not reach those items. The browser half is the
//     `seq-add-menu-pointer` check of tests/browser/sequencer.cjs (a click on every item's centre
//     adds that block at 1536x1024, 1920x1080 and 1280x800).
//
//   node --test tests/unit/sequencer-chrome-c005.test.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (rel) => readFileSync(path.join(ROOT, rel), 'utf8');
const stripCssComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');

/** The id sequencer-panel.js binds as loopBtn. */
function loopButtonId() {
  const panel = read('src/js/labs/sequencer-panel.js');
  const m = panel.match(/const\s+loopBtn\s*=\s*q\(\s*'#([\w-]+)'\s*\)/);
  assert.ok(m, 'sequencer-panel.js binds loopBtn with q(\'#<id>\')');
  return m[1];
}

/** The whole <button ...>...</button> element with the given id in an HTML text. */
function buttonById(html, id) {
  const open = new RegExp(`<button\\b[^>]*\\bid="${id}"[^>]*>`);
  const m = open.exec(html);
  assert.ok(m, `a <button id="${id}"> exists`);
  const end = html.indexOf('</button>', m.index);
  assert.ok(end > m.index, `<button id="${id}"> is closed`);
  return { tag: m[0], element: html.slice(m.index, end) };
}

// dist/index.html carries the markup packed; npm run build:check holds it to this source.
test('C005 (a) the loopBtn element draws a loop, titled Loop, not Record', () => {
  const html = read('src/index.html');
  const id = loopButtonId();
  const { tag, element } = buttonById(html, id);
  const uses = [...element.matchAll(/<use\b[^>]*\bhref="#([\w-]+)"/g)].map((u) => u[1]);
  assert.deepEqual(uses, ['s-loop'], `#${id} draws #s-loop (it draws ${JSON.stringify(uses)})`);
  assert.match(tag, /\btitle="Loop"/, `#${id} carries title="Loop"`);
  assert.match(tag, /\baria-label="Loop sequence"/, `#${id} keeps its accessible name`);
  assert.doesNotMatch(tag, /osc-transport-btn--record/, `#${id} is not styled as Record`);
  assert.match(html, /<symbol\b[^>]*\bid="s-loop"/, 'the #s-loop sprite symbol exists');
});

test('C005 (a) the red Record styling of the transport is gone', () => {
  const css = stripCssComments(read('src/styles/components.css'));
  assert.doesNotMatch(css, /\.osc-transport-btn--record\b/,
    'components.css has no .osc-transport-btn--record rule');
  assert.doesNotMatch(read('src/index.html'), /osc-transport-btn--record/,
    'src/index.html uses no osc-transport-btn--record class');
});

test('C005 (b) the Add block grid menu opens downward, not over the scroller\'s top edge', () => {
  const css = stripCssComments(read('src/styles/instrument.css'));
  const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .filter((r) => r[1].split(',').some((s) => /\.osc-menu--grid\b/.test(s)));
  assert.ok(rules.length > 0, 'instrument.css styles .osc-menu--grid');
  for (const [, selector, body] of rules) {
    assert.doesNotMatch(body, /(^|;|\s)bottom\s*:/,
      `${selector.trim()} declares no bottom: (an upward menu is clipped by .osc-main)`);
    assert.doesNotMatch(body, /(^|;|\s)top\s*:\s*auto\b/,
      `${selector.trim()} does not reset top: (it opens below the button, as .osc-menu--right)`);
  }
  const html = read('src/index.html');
  assert.match(html, /class="osc-menu osc-menu--right osc-menu--grid" id="osc-seq-add-menu"/,
    'the Add block menu is a right-anchored grid menu, placed below its button');
});
