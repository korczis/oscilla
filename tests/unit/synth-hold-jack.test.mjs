// JC-10 (the Synth look audit): a patch re-draws the bay and changes what is above and below it,
// so the view jumped (the patched jack 96 px down on a phone). holdJack (src/js/synth/hold.js)
// keeps the jack where it was on the screen: it measures the jack before the change and, once
// the page has laid out, scrolls the scroller by the distance the jack moved.
//
//   node --test tests/unit/synth-hold-jack.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';

const mod = await import('../../src/js/synth/hold.js').catch(() => ({}));
// Only the scroller scrolls; the host is laid out in it.
globalThis.getComputedStyle = (el) => ({ overflowY: el.scrollTop !== undefined ? 'auto'
  : 'visible' });

/** A host whose jack sits at `y` (as the page lays it out), in a scroller. */
function page(y) {
  const scroller = { scrollTop: 400 };
  const state = { y };
  const jack = { getBoundingClientRect: () => ({ top: state.y - (scroller.scrollTop - 400) }) };
  // The host sits in the scroller: getComputedStyle (stubbed below) says it scrolls.
  scroller.nodeType = 1;
  scroller.style = {};
  const host = { nodeType: 1, parentElement: scroller, style: {},
    querySelector: (q) => (q === '[data-jack="vco1.pitch:in"]' ? jack : null) };
  return { host, scroller, state };
}

test('the jack is held where it was across a change that moves it', () => {
  assert.equal(typeof mod.holdJack, 'function');
  const { host, scroller, state } = page(400);
  const frames = [];
  const out = mod.holdJack(host, 'vco1.pitch:in', () => { state.y = 496; return 'done'; },
    { frame: (f) => frames.push(f) });
  assert.equal(out, 'done', 'what the change returns');
  assert.equal(scroller.scrollTop, 400, 'nothing moves before the page has laid out');
  frames.forEach((f) => f());
  assert.equal(scroller.scrollTop, 496, 'scrolled by the 96 px the jack moved');
  assert.equal(host.querySelector('[data-jack="vco1.pitch:in"]').getBoundingClientRect().top, 400);
});

test('a jack that did not move, or is gone, scrolls nothing', () => {
  const still = page(400);
  const frames = [];
  mod.holdJack(still.host, 'vco1.pitch:in', () => {}, { frame: (f) => frames.push(f) });
  frames.forEach((f) => f());
  assert.equal(still.scroller.scrollTop, 400);
  const gone = page(400);
  let ran = false;
  mod.holdJack(gone.host, 'nope:in', () => { ran = true; }, { frame: () => assert.fail() });
  assert.equal(ran, true, 'the change still runs');
  assert.equal(gone.scroller.scrollTop, 400);
});
