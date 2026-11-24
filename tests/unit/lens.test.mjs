// Sonda, the observed lens (src/js/ui/lens.js): what the sheet names and which views it offers,
// decided from the one sounding owner (core/output-bus.js soundingOwner, C069). It offers only
// views that read the output analyser, names its subject in Czech, says "Nic nehraje" and draws
// no trace while nothing sounds, marks a requested frequency only where requestedFrequencyFor
// knows one (the instrument, the sequencer), and its Escape outranks the page's stop while open.
//   node --test tests/unit/lens.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  LENS_CAPTION, LENS_COMPUTED_NOTE, LENS_IDLE, LENS_SUBJECT_LABELS, LENS_VIEWS, LENS_VIEW_LABELS,
  bindLensKeys, createLensPart, lensMarkerShown, lensSubject, lensViewFor, lensViews, reparentView,
} from '../../src/js/ui/lens.js';
import { OUTPUT_OWNER_TABLE, OWNER } from '../../src/js/core/output-bus.js';
import { WORKSPACE_LABELS } from '../../src/js/ui/shell.js';
import { createKeyRegistry } from '../../src/js/ui/keys/registry.js';
import { bindPageKeys } from '../../src/js/ui/keys/clients.js';

const COMPUTED = ['harmonics', 'signalPath', 'filter', 'phase'];

test('idle: "Nic nehraje", no view offered, no marker', () => {
  for (const owner of [null, undefined, '']) {
    const s = lensSubject({ owner });
    assert.deepEqual({ ...s }, { id: null, label: LENS_IDLE, text: LENS_IDLE, idle: true });
    const v = lensViews(s);
    assert.deepEqual([...v.views], [], 'no trace is claimed of silence');
    assert.equal(v.marker, false);
    assert.equal(v.computedNote, null);
  }
  assert.equal(LENS_IDLE, 'Nic nehraje');
  assert.deepEqual([...lensViews().views], [], 'no subject is idle');
});

test('every owner that can sound is named in Czech, the workspace ones by the registry', () => {
  const sounding = OUTPUT_OWNER_TABLE.map((r) => r.owner).filter((o) => o !== OWNER.reference);
  for (const owner of sounding) {
    const s = lensSubject({ owner });
    assert.equal(s.idle, false, owner);
    assert.ok(LENS_SUBJECT_LABELS[owner], `${owner} has a label`);
    assert.notEqual(s.label, 'Neurčený zdroj', owner);
  }
  assert.equal(lensSubject({ owner: OWNER.measurement }).label, WORKSPACE_LABELS.measure);
  assert.equal(lensSubject({ owner: OWNER.sequencer }).label, WORKSPACE_LABELS.sequencer);
  assert.equal(lensSubject({ owner: OWNER.studio }).label, WORKSPACE_LABELS.studio);
  assert.equal(lensSubject({ owner: OWNER.instrument }).label, 'Generátor');
  assert.equal(lensSubject({ owner: 'something-new' }).label, 'Neurčený zdroj');
});

test('an armed Synth run (the Studio transport) is named Synth; a PLAYed Studio run Studio', () => {
  const synth = lensSubject({ owner: OWNER.studio, synthArmed: true });
  assert.equal(synth.id, 'synth');
  assert.equal(synth.label, WORKSPACE_LABELS.synth);
  assert.equal(synth.label, 'Synth');
  assert.equal(synth.text, 'Zní: Synth');
  assert.equal(lensSubject({ owner: OWNER.studio, synthArmed: false }).label, 'Studio');
  assert.equal(lensSubject({ owner: OWNER.instrument, synthArmed: true }).label, 'Generátor',
    'the Synth flag names only the Studio transport');
});

test('only observed views, for every subject; computed ones never offered', () => {
  assert.deepEqual([...LENS_VIEWS], ['waveform', 'spectrum', 'spectrogram']);
  for (const id of Object.keys(LENS_SUBJECT_LABELS)) {
    const s = id === 'synth' ? lensSubject({ owner: OWNER.studio, synthArmed: true })
      : lensSubject({ owner: id });
    const v = lensViews(s);
    assert.deepEqual([...v.views], [...LENS_VIEWS], id);
    for (const c of COMPUTED) assert.ok(!v.views.includes(c), `${id} offers no ${c}`);
  }
  for (const view of LENS_VIEWS) assert.match(LENS_VIEW_LABELS[view], /^[A-ZŘŠČ]/);
  assert.match(LENS_CAPTION, /Pozorovaný digitální výstup po omezovači/);
  assert.match(LENS_CAPTION, /relativní dBFS/);
});

test('the computed note is the instrument\'s alone, and says the views are computed', () => {
  assert.equal(lensViews(lensSubject({ owner: OWNER.instrument })).computedNote,
    LENS_COMPUTED_NOTE);
  assert.match(LENS_COMPUTED_NOTE, /počítají z nastavení generátoru/);
  for (const owner of [OWNER.sequencer, OWNER.studio, OWNER.notes, OWNER.measurement]) {
    assert.equal(lensViews(lensSubject({ owner })).computedNote, null, owner);
  }
});

test('the requested-frequency marker: the instrument and the sequencer only', () => {
  const marked = (owner, synthArmed) => lensViews(lensSubject({ owner, synthArmed })).marker;
  assert.equal(marked(OWNER.instrument), true);
  assert.equal(marked(OWNER.sequencer), true);
  for (const owner of [OWNER.studio, OWNER.notes, OWNER.measurement, OWNER.audition]) {
    assert.equal(marked(owner), false, owner);
    assert.equal(lensMarkerShown(owner), false, owner);
  }
  assert.equal(marked(OWNER.studio, true), false, 'never invented for the Synth');
  assert.equal(lensMarkerShown(OWNER.instrument), true);
  assert.equal(lensMarkerShown(OWNER.sequencer), true);
  assert.equal(lensMarkerShown(null), false);
});

test('lensViewFor: the panel tab when observed, else the Spectrum', () => {
  for (const v of LENS_VIEWS) assert.equal(lensViewFor(v), v);
  for (const c of [...COMPUTED, undefined, null]) assert.equal(lensViewFor(c), 'spectrum');
});

/** A minimal document: elements by id with parentNode/childNodes, comments, focus. */
function fakeDoc() {
  const byId = new Map();
  const node = (id) => {
    const el = { id, nodeType: 1, parentNode: null, childNodes: [], focused: 0,
      focus() { el.focused += 1; },
      appendChild(c) { detach(c); c.parentNode = el; el.childNodes.push(c); return c; },
      insertBefore(c, ref) {
        detach(c);
        c.parentNode = el;
        el.childNodes.splice(el.childNodes.indexOf(ref), 0, c);
        return c;
      },
      replaceChild(c, old) {
        detach(c);
        const i = el.childNodes.indexOf(old);
        el.childNodes[i] = c;
        c.parentNode = el;
        old.parentNode = null;
        return old;
      } };
    if (id) byId.set(id, el);
    return el;
  };
  const detach = (c) => {
    if (!c.parentNode) return;
    const kids = c.parentNode.childNodes;
    kids.splice(kids.indexOf(c), 1);
    c.parentNode = null;
  };
  const doc = { getElementById: (id) => byId.get(id) || null,
    querySelector: (sel) => (sel === '#osc-panel-analysis [role="tabpanel"]'
      && view.parentNode === panel ? view : null),
    createComment: (data) => ({ nodeType: 8, data, parentNode: null }), node };
  const panel = node('osc-panel-analysis');
  const view = panel.appendChild(node(null));
  const slot = node('osc-lens-slot');
  return { doc, panel, view, slot, toggle: node('osc-lens-toggle'), close: node('osc-lens-close') };
}

test('reparentView moves the one view into the slot and back to its place', () => {
  const { doc, panel, view, slot } = fakeDoc();
  const before = panel.appendChild(doc.node('before'));
  panel.childNodes.unshift(panel.childNodes.pop()); // [before, view]
  assert.equal(reparentView(doc, false), false, 'not in the slot: nothing to return');
  assert.equal(reparentView(doc, true), true);
  assert.equal(view.parentNode, slot);
  assert.equal(panel.childNodes[1].nodeType, 8, 'a comment holds its place');
  assert.equal(reparentView(doc, true), false, 'already there');
  assert.equal(reparentView(doc, false), true);
  assert.equal(view.parentNode, panel);
  assert.deepEqual(panel.childNodes, [before, view], 'home again, the comment gone');
  assert.equal(slot.childNodes.length, 0);
  assert.equal(reparentView({ getElementById: () => null }, true), false, 'no slot, no move');
  assert.equal(reparentView({ getElementById: () => slot, querySelector: () => null }, true),
    false, 'no view, no move');
});

/** The part composed onto a component double, with a fake document and $nextTick. */
function component(over = {}) {
  const f = fakeDoc();
  globalThis.document = f.doc;
  const relayouts = [];
  const part = createLensPart({ relayout: () => relayouts.push(1) });
  const cmp = {};
  Object.defineProperties(cmp, Object.getOwnPropertyDescriptors(part));
  Object.assign(cmp, { tabs: { analysis: 'harmonics' }, playback: null, synth: { armed: false },
    tabsSet: [], setTab(g, v) { this.tabsSet.push([g, v]); this.tabs[g] = v; },
    $nextTick(fn) { fn(); }, ...over });
  return { cmp, relayouts, ...f };
}

test('the part: open moves the view in, focuses Close; close puts it back, focuses the toggle',
  () => {
    const { cmp, relayouts, view, slot, panel, toggle, close } = component();
    assert.equal(cmp.lensOpen, false);
    assert.equal(cmp.lensSubject.label, LENS_IDLE);
    assert.equal(cmp.lensViews.views.length, 0);
    cmp.lensClose(); // closed: nothing
    assert.equal(relayouts.length, 0);
    cmp.lensToggle();
    assert.equal(cmp.lensOpen, true);
    assert.deepEqual(cmp.tabsSet, [['analysis', 'spectrum']], 'a computed tab is left');
    assert.equal(view.parentNode, slot);
    assert.equal(close.focused, 1, 'focus moves into the sheet');
    cmp.lensShow(); // open: nothing
    assert.equal(relayouts.length, 1);
    cmp.lensSelect('spectrogram');
    cmp.lensSelect('harmonics'); // not offered: ignored
    assert.equal(cmp.tabs.analysis, 'spectrogram');
    assert.equal(cmp.lensView, 'spectrogram');
    cmp.lensFollowTab('waveform'); // observed: stays open
    assert.equal(cmp.lensOpen, true);
    cmp.lensToggle();
    assert.equal(cmp.lensOpen, false);
    assert.equal(view.parentNode, panel);
    assert.equal(toggle.focused, 1, 'focus returns to the Sonda button');
    assert.equal(relayouts.length, 2);
  });

test('the part names the sounding owner; the panel taking a computed tab closes the sheet', () => {
  const { cmp, toggle } = component({ tabs: { analysis: 'waveform' },
    playback: { owner: 'studio', since: 1 }, synth: { armed: true } });
  assert.equal(cmp.lensSubject.label, 'Synth');
  assert.equal(cmp.lensViews.marker, false);
  cmp.lensShow();
  assert.deepEqual(cmp.tabsSet, [], 'an observed tab is kept');
  cmp.lensFollowTab('signalPath');
  assert.equal(cmp.lensOpen, false);
  assert.equal(toggle.focused, 0, 'the panel keeps the focus it was given');
  const m = component({ measureOwnsOutput: () => true, synth: null });
  assert.equal(m.cmp.lensSubject.label, WORKSPACE_LABELS.measure, 'a measurement first (C069)');
});

test('Escape: the sheet\'s binding outranks the page stop while open, and only then', () => {
  const keys = createKeyRegistry();
  const stops = [];
  const closes = [];
  const cmp = { lensOpen: false, lensClose: () => { closes.push(1); cmp.lensOpen = false; },
    lensEscape(e) { return createLensPart().lensEscape.call(this, e); } };
  bindPageKeys({ keys, cmp, stopSequencer() {}, stopAll: (why) => stops.push(why) });
  const off = bindLensKeys({ keys, cmp });
  const press = (focus) => {
    const b = keys.resolve('Escape', { workspace: 'synth', focus });
    b.run({ key: 'Escape', code: 'Escape' });
    return b.id;
  };
  assert.equal(press('none'), 'page.escape', 'closed: the page Escape keeps its meaning');
  cmp.lensOpen = true;
  for (const focus of ['none', 'text', 'piano']) {
    cmp.lensOpen = true;
    assert.equal(press(focus), `lens.escape.${focus}`, focus);
  }
  assert.equal(closes.length, 3);
  assert.deepEqual(stops, ['escape'], 'the open sheet\'s Escape never stopped the sound');
  cmp.lensOpen = true;
  assert.equal(press('dialog'), 'page.escape', 'a modal dialog keeps its Escape');
  off();
  cmp.lensOpen = true;
  assert.equal(keys.resolve('Escape', { workspace: 'studio', focus: 'none' }).id, 'page.escape');
});

test('lensEscape: consumed like menuEscape while open (closed, refocused), passed while closed',
  () => {
    const { cmp, toggle } = component({ tabs: { analysis: 'spectrum' } });
    const ev = () => ({ key: 'Escape', prevented: 0, stopped: 0,
      preventDefault() { this.prevented += 1; }, stopPropagation() { this.stopped += 1; } });
    const closed = ev();
    assert.equal(cmp.lensEscape(closed), false, 'closed: the key passes');
    assert.deepEqual([closed.prevented, closed.stopped], [0, 0]);
    cmp.lensShow();
    assert.equal(cmp.lensEscape({ key: 'Enter' }), false, 'another key passes');
    assert.equal(cmp.lensOpen, true);
    const open = ev();
    assert.equal(cmp.lensEscape(open), true, 'open: consumed');
    assert.deepEqual([open.prevented, open.stopped], [1, 1]);
    assert.equal(cmp.lensOpen, false);
    assert.equal(toggle.focused, 1, 'focus back on the Sonda button');
    assert.equal(cmp.lensEscape(null), false);
  });
