// A lab field shows the value that applies once an edit is committed (C021, PACK 03 journey 6:
// invalid or out-of-range input is answered honestly). The labs write their fields through
// labs/dom.js setField, which leaves alone a field the user is editing. It took "editing" to
// mean "focused", and a field still has the focus when Enter commits it: the Envelope's Attack
// read "5000" while 2 s played and "abc" while the previous value stayed, the Filter Lab's
// cutoff a typed value above its limit. Editing now runs from the first keystroke ('input') to
// the commit ('change'), both heard in the capture phase.
//   node --test tests/unit/labs-field-commit.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';

/** A document that dispatches capture listeners, and an input element on it. */
function fakeDom() {
  const listeners = { input: [], change: [] };
  const doc = {
    activeElement: null,
    addEventListener(type, fn, capture) {
      if (capture && listeners[type]) listeners[type].push(fn);
    },
  };
  const el = { value: '', ownChange: [] };
  const fire = (type) => {
    for (const fn of listeners[type]) fn({ target: el });
    if (type === 'change') for (const fn of el.ownChange) fn();
  };
  return { doc, el, fire };
}

const dom = fakeDom();
globalThis.document = dom.doc;
const { setField } = await import(`../../src/js/labs/dom.js?commit=${Date.now()}`);

test('a field the user is typing in is left alone', () => {
  const { el, fire, doc } = dom;
  el.value = '';
  doc.activeElement = el;
  el.value = '50';
  fire('input');
  setField(el, '2 s');
  assert.equal(el.value, '50', 'a sync while typing keeps the typed text');
});

test('a committed edit is written back as the value that applies, focus or not', () => {
  const { el, fire, doc } = dom;
  doc.activeElement = el;
  el.value = '5000';
  fire('input');
  // the lab's own change handler: parse, limit, write the field
  el.ownChange = [() => setField(el, '2 s')];
  fire('change');
  assert.equal(el.value, '2 s', 'the limited value replaces the typed one');
  el.value = 'abc';
  fire('input');
  el.ownChange = [() => setField(el, '2 s')];
  fire('change');
  assert.equal(el.value, '2 s', 'text that does not parse gives way to the value in use');
});

test('a field nobody edits follows the lab', () => {
  const { el, doc } = dom;
  doc.activeElement = null;
  setField(el, '10 ms');
  assert.equal(el.value, '10 ms');
});
