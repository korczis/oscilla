// oscilla-c3's decision (2b), relayed by oscilla-43 on 2026-11-12: the sentence the Synth says
// when it inserts its panel into the Studio document is a dismissible Pro info alert under the
// Synth header, shown once per insert. It stays until closed or until the insert is undone,
// never returns for the same insert (a redo restores the same panel), comes back for a new
// insert, and is said once in the live region. The model is synth/insert-notice.js: only a real
// insert calls inserted() (a redo restores the panel without one), and the inserted panel's Keys
// node id says when the panel is gone. Fails on 74e16d03: no such module, the sentence is only
// the status line's.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createInsertNotice } from '../../src/js/synth/insert-notice.js';
import { SYNTH_TEXT } from '../../src/js/synth/insert.js';
import { createSynthUi } from '../../src/js/synth/ui.js';
import { AudioEngine } from '../../src/js/audio/audio-engine.js';
import { createStudioRuntime } from '../../src/js/studio/runtime.js';
import { createStudioTransport } from '../../src/js/studio/transport.js';
import { createIdGenerator, createStudioStore } from '../../src/js/studio/actions.js';
import { templateModel, REFERENCE_TEMPLATE_ID } from '../../src/js/studio/templates/index.js';
import PANEL from '../../src/js/synth/panels/semi-mono.js';
import { createFakeAudioEnv } from './sequencer-fake-audio.mjs';

function rig() {
  const said = [];
  const n = createInsertNotice({ announce: (text) => said.push(text) });
  return { n, said };
}

test('an insert shows the alert with its sentence and says it once', () => {
  const { n, said } = rig();
  assert.equal(n.view(), null, 'nothing before an insert');
  n.inserted('keys-1', SYNTH_TEXT.inserted);
  assert.deepEqual(n.view(), { text: SYNTH_TEXT.inserted, short: null, more: false });
  assert.deepEqual(said, [SYNTH_TEXT.inserted], 'said once in the live region');
  n.sync('keys-1');
  n.sync('keys-1');
  assert.deepEqual(n.view(), { text: SYNTH_TEXT.inserted, short: null, more: false },
    'it stays while the panel does');
  assert.equal(said.length, 1, 'a re-render says nothing again');
});

test('closed, it stays closed for that insert, a redo included', () => {
  const { n, said } = rig();
  n.inserted('keys-1', SYNTH_TEXT.inserted);
  n.dismiss();
  assert.equal(n.view(), null, 'Close hides it');
  n.sync(null); // undo: the panel is gone
  n.sync('keys-1'); // redo: the same panel back, which is no new insert (no inserted() call)
  assert.equal(n.view(), null, 'never back for the same insert');
  assert.equal(said.length, 1);
});

test('an undo of the insert hides it; a redo of the same insert does not bring it back', () => {
  const { n } = rig();
  n.inserted('keys-1', SYNTH_TEXT.inserted);
  n.sync(null);
  assert.equal(n.view(), null, 'undone: hidden');
  n.sync('keys-1');
  assert.equal(n.view(), null, 'redone: still hidden');
});

test('a new insert shows its own sentence again, even with the same panel ids', () => {
  const { n, said } = rig();
  n.inserted('keys-1', SYNTH_TEXT.inserted);
  n.dismiss();
  n.sync(null);
  const took = SYNTH_TEXT.took('Filtr 1');
  n.inserted('keys-1', took); // the panel's ids are deterministic: a re-insert reuses them
  assert.deepEqual(n.view(), { text: took, short: null, more: false });
  assert.deepEqual(said, [SYNTH_TEXT.inserted, took]);
  n.sync('keys-3'); // another panel replaced it
  assert.equal(n.view(), null, 'shown for its own insert only');
});

test('an insert with no panel id is said but shows no alert', () => {
  const { n, said } = rig();
  n.inserted(null, SYNTH_TEXT.inserted);
  assert.equal(n.view(), null);
  assert.deepEqual(said, [SYNTH_TEXT.inserted]);
});

// ---------------------------------------------------------------- the Synth's own insert

/** The Synth part over a fresh reference document (no panel), its store subscription live. */
function synthOnFresh() {
  const subs = new Set(); // the workspace handle's subscribe(fn), over the store's onChange
  const st = createStudioStore(templateModel(REFERENCE_TEMPLATE_ID),
    { idGenerator: createIdGenerator(), onChange: (e) => subs.forEach((fn) => fn(e)) });
  const handle = Object.create(st, { subscribe: { value: (fn) => {
    subs.add(fn);
    return () => subs.delete(fn);
  } } });
  const focused = [];
  const view = { addEventListener() {}, focus: () => focused.push('synth-view') };
  globalThis.document = {
    querySelector: (q) => (q === '[data-osc="synth-view"]' ? view : null),
    getElementById: (id) => (id === 'osc-view-synth' ? view : null), activeElement: null };
  globalThis.window ??= { addEventListener() {}, location: { href: 'http://x/' } };
  globalThis.requestAnimationFrame = () => 0;
  const fx = createFakeAudioEnv({ sampleRate: 48000 });
  const engine = new AudioEngine({ env: fx.env });
  assert.ok(engine.init(), 'engine.init');
  const transport = createStudioTransport({ runtime: createStudioRuntime({ engine }), engine,
    store: st });
  const said = [];
  const part = createSynthUi({ get: () => ({ handle, transport }),
    announce: (text) => said.push(text) });
  const cmp = Object.assign(part, { workspace: 'synth', ensureAudio() {}, $watch() {},
    $nextTick() {} });
  cmp.synthInit();
  return { cmp, st, said, focused };
}
const settle = () => new Promise((r) => { queueMicrotask(r); });
const keysOf = (st) => PANEL.resolve(st.getModel()).get('keys');

test('the Synth\'s insert shows its sentence in the alert, said once, not on the status line',
  async () => {
    const { cmp, st, said, focused } = synthOnFresh();
    assert.equal(keysOf(st), null, 'a fresh document has no panel');
    assert.equal(cmp.synthPreset('init'), true, 'a preset inserts the panel first');
    const text = cmp.synth.notice && cmp.synth.notice.text;
    assert.ok(text && text.startsWith(SYNTH_TEXT.inserted.slice(0, 20)), `the alert: ${text}`);
    assert.equal(said.filter((t) => t === text).length, 1, 'said once in the live region');
    assert.notEqual(cmp.synth.status, text, 'the status line does not repeat it');
    await settle();
    assert.equal(cmp.synth.notice.text, text, 'a refresh keeps it');
    cmp.synthNoticeClose();
    assert.equal(cmp.synth.notice, null, 'Close hides it');
    assert.deepEqual(focused, ['synth-view'], 'focus goes to the Synth view, not <body>');
    st.undo();
    await settle();
    st.redo();
    await settle();
    assert.equal(cmp.synth.notice, null, 'a redo of the closed insert does not bring it back');
  });

test('an undo of the Synth\'s insert hides the alert; a fresh insert shows it again',
  async () => {
    const { cmp, st, said } = synthOnFresh();
    cmp.synthPreset('init');
    const first = keysOf(st).id;
    st.undo();
    await settle();
    assert.equal(keysOf(st), null, 'the insert is undone');
    assert.equal(cmp.synth.notice, null, 'its alert goes with it');
    assert.equal(cmp.synthPreset('init'), true, 'inserted again');
    assert.equal(keysOf(st).id, first, 'the panel\'s ids are deterministic: the same ids');
    assert.ok(cmp.synth.notice, 'the new insert shows its alert');
    assert.equal(said.filter((t) => t === cmp.synth.notice.text).length, 2,
      'each insert said once');
  });

// C3-539-3: refresh() runs on every store change; the alert's view keeps its identity while it
// does not change, so a knob drag does not re-run the alert's bindings once per event.
test('the view keeps its identity across syncs that change nothing, and changes when it should',
  () => {
    const n = createInsertNotice();
    n.inserted('keys-1', 'Vloženo.');
    const v = n.view();
    for (let i = 0; i < 5; i += 1) n.sync('keys-1');
    assert.equal(n.view(), v, 'the same object while nothing changed');
    const st = { notice: null };
    n.into(st);
    assert.equal(st.notice, v);
    const before = st;
    n.into(st);
    assert.equal(st.notice, before.notice, 'into() does not reassign an unchanged view');
    n.sync(null);
    assert.equal(n.view(), null, 'the panel gone hides it');
    n.into(st);
    assert.equal(st.notice, null);
  });

test('C3-539-3 drag-rate probe: 20 parameter edits leave the Synth\'s alert object untouched',
  async () => {
    const { cmp, st } = synthOnFresh();
    assert.equal(cmp.synthPreset('init'), true, 'a preset inserts the panel');
    await settle();
    const first = cmp.synth.notice;
    assert.ok(first && first.text, 'the alert is shown');
    const node = st.getModel().graph.nodes.find((x) => x.params
      && Object.values(x.params).some((v) => typeof v === 'number'));
    const key = Object.keys(node.params).find((k) => typeof node.params[k] === 'number');
    let writes = 0;
    let held = cmp.synth.notice;
    Object.defineProperty(cmp.synth, 'notice', { configurable: true, enumerable: true,
      get: () => held, set: (v) => { writes += 1; held = v; } });
    for (let i = 0; i < 20; i += 1) {
      st.dispatch({ type: 'NODE_PARAM_SET', nodeId: node.id, key,
        value: node.params[key] + (i % 2 ? 0.001 : -0.001) });
      await settle();
    }
    assert.equal(cmp.synth.notice, first, 'the same alert object after 20 edits');
    assert.equal(writes, 0, `no reassignment during the drag (got ${writes})`);
  });

// U108 (oscilla-c3 under Q090, oscilla-0b's wording): the phone's short line is built from the
// same names as the sentence; the source is a nominative in parentheses, dropped when there was
// none; Více toggles the whole sentence and leaves one view object per state.
test('U108: the short line keeps the facts from the same names, and Více toggles the sentence',
  () => {
    const took = SYNTH_TEXT.short('Filter 1');
    assert.deepEqual(took, { lead: 'Panel vložen do Studia, převzal vstup Master Output',
      source: 'Filter 1', tail: '. Zpět ho odebere.' });
    assert.equal(SYNTH_TEXT.short('').source, '', 'no previous source: no parentheses');
    const n = createInsertNotice();
    n.inserted('keys-1', { text: SYNTH_TEXT.took('Filter 1'), short: took });
    const v = n.view();
    assert.equal(v.more, false);
    assert.equal(v.short, took);
    n.sync('keys-1');
    assert.equal(n.view(), v, 'a sync that changes nothing keeps the object');
    n.more();
    assert.equal(n.view().more, true, 'Více opens the sentence');
    assert.notEqual(n.view(), v, 'a new state is a new object');
    n.more();
    assert.equal(n.view().more, false, 'Méně closes it');
    n.dismiss();
    n.more();
    assert.equal(n.view(), null, 'Více does nothing once closed');
  });
