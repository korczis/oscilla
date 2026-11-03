// E043: openModal's deferred initial focus never takes focus back from a control the user moved
// to after the dialog opened. Before the fix the timer focused the first control
// unconditionally; on a loaded machine it fired after the keyboard user's move to Delete, so
// Enter pressed Cancel and nothing was deleted (the intermittent findings-delete-focus failure
// of tests/browser/v3-ui.cjs on #273 and #290: rows still 2, focus back on the row's Delete).
import test from 'node:test';
import assert from 'node:assert';

import { openModal } from '../../src/js/ui/dialogs.js';

// A minimal document: elements focus themselves into doc.activeElement; a <dialog>'s
// showModal() focuses its first control, as the browsers do.
function fakeDocument() {
  const doc = { activeElement: null, body: null, nodes: {} };
  const el = (tag, parent = null, attrs = {}) => {
    const e = {
      tagName: tag.toUpperCase(), parent, children: [], attrs: { ...attrs }, ownerDocument: doc,
      setAttribute(k, v) { this.attrs[k] = v; },
      removeAttribute(k) { delete this.attrs[k]; },
      getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; },
      focus() { doc.activeElement = this; },
      closest() { return null; },
      contains(x) {
        for (let n = x; n; n = n.parent) if (n === this) return true;
        return false;
      },
    };
    if (parent) parent.children.push(e);
    return e;
  };
  doc.body = el('body');
  doc.activeElement = doc.body;
  doc.el = el;
  doc.getElementById = (id) => doc.nodes[id] || null;
  return doc;
}

function deleteDialog(doc) {
  const dlg = doc.el('dialog', doc.body);
  dlg.open = false;
  const cancel = doc.el('button', dlg, { 'data-osc': 'fnd.deleteCancel' });
  const confirm = doc.el('button', dlg, { 'data-osc': 'fnd.deleteConfirm' });
  dlg.querySelector = () => cancel;
  dlg.showModal = () => { dlg.open = true; cancel.focus(); };
  dlg.close = () => { dlg.open = false; };
  doc.nodes['osc-dlg-finding-delete'] = dlg;
  const opener = doc.el('button', doc.body, { 'data-osc': 'fnd.delete' });
  return { dlg, cancel, confirm, opener };
}

test('E043: a control focused before the deferred initial focus runs keeps focus', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const doc = fakeDocument();
  const { cancel, confirm, opener } = deleteDialog(doc);
  opener.focus();
  assert.equal(openModal('osc-dlg-finding-delete', doc), true);
  assert.equal(doc.activeElement, cancel, 'showModal focuses the first control');
  // The keyboard user moves to Delete before the opening's timer has fired.
  confirm.focus();
  t.mock.timers.runAll();
  assert.equal(doc.activeElement, confirm,
    'the deferred focus took focus back from Delete (Enter would press Cancel)');
});

test('E043: with focus untouched the deferred initial focus still lands on the first control',
  (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const doc = fakeDocument();
    const { dlg, cancel, opener } = deleteDialog(doc);
    // A dialog whose content renders after it opens: showModal leaves focus where it was.
    dlg.showModal = () => { dlg.open = true; };
    opener.focus();
    openModal('osc-dlg-finding-delete', doc);
    assert.equal(doc.activeElement, opener);
    t.mock.timers.runAll();
    assert.equal(doc.activeElement, cancel);
  });

test('E043: a dialog closed before the deferred focus runs takes no focus', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const doc = fakeDocument();
  const { dlg, opener } = deleteDialog(doc);
  dlg.showModal = () => { dlg.open = true; };
  opener.focus();
  openModal('osc-dlg-finding-delete', doc);
  dlg.close();
  t.mock.timers.runAll();
  assert.equal(doc.activeElement, opener);
});
