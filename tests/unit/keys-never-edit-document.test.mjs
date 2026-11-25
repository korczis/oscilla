// U140 (journey J1 of 2026-11-24, the interim review of 2026-11-25, problem 1): a key never
// changes the Studio document. Before U140 a computer key outside the Synth and the Studio, on a
// fresh page, inserted the Synth panel into the untouched default document (6 -> 28 nodes), took
// Master Output's input from its Filter 1 and silenced the Studio's Play, while the document
// stayed clean (ui/studio/workspace/keys.js keysInstrument, its insert branch).
//
// The rig is the one component as main.js composes it, on the fake Web Audio of
// sequencer-fake-audio.mjs: the MIDI part (midi/ui.js, its keyboard included), the Synth part
// (synth/ui.js) and the Studio's keys part (workspace/keys.js), over a real Studio store holding
// the reference template a fresh page opens with, its real transport and its dirty tracker.
// What it proves:
//   - in every workspace of the registry (ui/shell.js WORKSPACE_IDS), a computer key (a keydown
//     on the window, the shipped listener) and a MIDI Note On leave the document as it was: the
//     same model object, the same studioHash, no undo entry, clean; where a voice plays, it is
//     the page's own (an engine note), the Studio transport left unarmed; in the Synth, whose
//     panel the document does not hold, the key plays nothing and says that Vložit puts it in;
//   - the explicit insert (the Synth's Vložit, its click handler) changes the document, marks it
//     unsaved and is one undo step back to the same studioHash;
//   - mutation: the harness catches the pre-U140 keysInstrument (the panel inserted by a key),
//     so the first assertion cannot pass vacuously.
//   node --test tests/unit/keys-never-edit-document.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import PANEL from '../../src/js/synth/panels/semi-mono.js';
import { AudioEngine } from '../../src/js/audio/audio-engine.js';
import { createStudioRuntime } from '../../src/js/studio/runtime.js';
import { createStudioTransport } from '../../src/js/studio/transport.js';
import { createIdGenerator, createStudioStore } from '../../src/js/studio/actions.js';
import { studioHash } from '../../src/js/studio/schema.js';
import { createDirtyTracker } from '../../src/js/studio/library.js';
import { REFERENCE_TEMPLATE_ID, templateModel } from '../../src/js/studio/templates/index.js';
import { createMidiUi } from '../../src/js/midi/ui.js';
import { createSynthUi, SYNTH_TEXT, insertDecision } from '../../src/js/synth/ui.js';
import { createWorkspaceKeys, holdsPanel } from '../../src/js/ui/studio/workspace/keys.js';
import { WORKSPACE_IDS } from '../../src/js/ui/shell.js';
import { createFakeAudioEnv } from './sequencer-fake-audio.mjs';

class Port extends EventTarget {
  constructor() { super(); this.name = 'U140 stub'; this.state = 'connected'; this.type = 'input'; }
  send(data) {
    const ev = new Event('midimessage');
    ev.data = Uint8Array.from(data);
    this.dispatchEvent(ev);
  }
}
class Access extends EventTarget {
  constructor(ports) { super(); this.inputs = new Map(ports.map((p, i) => [`in-${i}`, p])); }
}
const settle = () => new Promise((resolve) => { setImmediate(resolve); });

/** The fresh page: the reference template, its transport, the three parts of the component. */
async function freshPage({ keysPart = null } = {}) {
  const listeners = {};
  const listen = (target) => (type, fn) => { (listeners[`${target}:${type}`] ||= []).push(fn); };
  const view = { addEventListener: listen('view') }; // [data-osc="synth-view"]
  const doc = { hidden: false, activeElement: null, addEventListener: listen('doc'),
    querySelector: (q) => (q === '[data-osc="synth-view"]' ? view : null),
    getElementById: () => null };
  const requests = [];
  const win = { navigator: { requestMIDIAccess: () => new Promise((res) => requests.push(res)) },
    isSecureContext: true, location: { protocol: 'file:', host: '', href: 'file:///x' },
    document: doc, addEventListener: listen('win') };
  globalThis.window = win;
  globalThis.document = doc;
  globalThis.requestAnimationFrame = () => 0;
  const fire = (key, e = {}) => { for (const fn of listeners[key] || []) fn(e); };
  const model = templateModel(REFERENCE_TEMPLATE_ID);
  const st = createStudioStore(model, { idGenerator: createIdGenerator(model) });
  const dirty = createDirtyTracker(st.getModel());
  const fx = createFakeAudioEnv({ sampleRate: 48000 });
  const engine = new AudioEngine({ env: fx.env });
  assert.ok(engine.init(), 'engine.init');
  if (engine.limiterFeed) engine.limiterFeed.infrastructure = true;
  const runtime = createStudioRuntime({ engine });
  const transport = createStudioTransport({ runtime, engine, store: st });
  const handle = Object.create(st, { subscribe: { value: () => () => {} } });
  const ctx = { handle };
  const synth = createSynthUi({ get: () => ({ handle, transport, dirty }) });
  const cmp = createMidiUi({ win, engine });
  Object.defineProperties(cmp, Object.getOwnPropertyDescriptors(synth));
  const keys = (keysPart || createWorkspaceKeys)(ctx).part;
  Object.defineProperties(cmp, Object.getOwnPropertyDescriptors(keys));
  const said = [];
  Object.assign(cmp, { workspace: 'playground', a4: 440, waveform: 'sine', attack: 10,
    release: 50, safetyLimit: 2, continuousAllowed: false, ensureAudio() {},
    notify: (level, title, message) => said.push(message),
    measureOwnsOutput: () => false, studioOwnsOutput: () => false,
    meas: { levelForm: { capturing: false } }, $watch() {}, $nextTick() {} });
  cmp.synthInit();
  await cmp.midiInit();
  cmp.midiConnect();
  const port = new Port();
  requests[0](new Access([port]));
  await settle();
  const key = (type, code = 'KeyA') => fire(`win:${type}`, { type, code, key: 'a', repeat: false,
    target: null, ctrlKey: false, metaKey: false, altKey: false,
    preventDefault() {}, stopImmediatePropagation() {} });
  const click = (dataset) => fire('view:click', { target: { closest: () => ({ dataset,
    getAttribute: () => null }) } });
  return { cmp, st, dirty, engine, transport, port, key, click, said };
}

const docOf = (rig) => ({ model: rig.st.getModel(), hash: studioHash(rig.st.getModel()),
  nodes: rig.st.getModel().graph.nodes.length, undo: rig.st.undoLabel(),
  dirty: rig.dirty.isDirty(rig.st.getModel()) });

test('U140: a key and a MIDI note in every workspace leave the Studio document as it was',
  async () => {
    const rig = await freshPage();
    const before = docOf(rig);
    assert.equal(holdsPanel(before.model), false, 'the fresh document holds no Synth panel');
    assert.equal(insertDecision(before.model).auto, true,
      'and the panel could go in by itself: the case a key used to take');
    const sounded = [];
    for (const ws of WORKSPACE_IDS) {
      rig.cmp.workspace = ws;
      rig.said.length = 0;
      if (rig.cmp.synth) rig.cmp.synth.status = '';
      const armed = rig.cmp.kbdArmedHere;
      rig.key('keydown');
      const voices = rig.engine.activeNodeCount;
      const held = rig.cmp.kbdHeld;
      rig.key('keyup');
      rig.port.send([0x90, 62, 100]);
      rig.port.send([0x80, 62, 0]);
      const after = docOf(rig);
      assert.equal(after.model, before.model, `${ws}: the same document object`);
      assert.equal(after.hash, before.hash, `${ws}: the same studioHash`);
      assert.equal(after.undo, before.undo, `${ws}: no undo entry`);
      assert.equal(after.dirty, false, `${ws}: clean`);
      assert.equal(rig.transport.armed, false, `${ws}: the Studio transport stays unarmed`);
      if (ws === 'synth') {
        assert.equal(held, '', 'synth: no panel in the document, no note held');
        assert.equal(rig.cmp.synth.status, SYNTH_TEXT.notInserted,
          'synth: the key says that Vložit puts the panel in');
      } else if (armed) {
        assert.equal(held, 'C4', `${ws}: the key is held`);
        assert.ok(voices > 0, `${ws}: it sounds on the page's own voice (an engine note)`);
        sounded.push(ws);
      }
    }
    assert.ok(sounded.includes('playground'), `the Generátor's key sounds (${sounded})`);
  });

test('U140: the explicit Vložit inserts the panel, marks the document unsaved, one undo step',
  async () => {
    const rig = await freshPage();
    const before = docOf(rig);
    rig.cmp.workspace = 'synth';
    rig.click({ insertPanel: '' });
    const after = docOf(rig);
    assert.equal(holdsPanel(after.model), true, 'the panel is in the document');
    assert.notEqual(after.hash, before.hash, 'the document changed');
    assert.ok(after.nodes > before.nodes, 'its nodes added');
    assert.equal(after.dirty, true, 'an explicit insert is the user\'s edit: unsaved');
    assert.ok(rig.st.undo().ok, 'Zpět');
    const back = docOf(rig);
    assert.equal(back.hash, before.hash, 'one undo step gives the document back');
    assert.equal(back.nodes, before.nodes);
    assert.equal(back.dirty, false);
    // With the panel in the document, a key plays it and still changes nothing.
    assert.ok(rig.st.redo().ok);
    const inserted = docOf(rig);
    rig.cmp.workspace = 'playground';
    rig.key('keydown');
    assert.equal(rig.transport.armed, true, 'the panel the document holds plays');
    rig.key('keyup');
    assert.equal(docOf(rig).hash, inserted.hash, 'and the key changed nothing');
  });

test('U140 mutation: the harness catches a key that inserts the panel (the pre-U140 branch)',
  async () => {
    // The K247 branch U140 removed: no note target and no panel, but the panel may go in by
    // itself, so the key's note inserts it through the Synth's sink.
    const legacy = (ctx) => {
      const { part } = createWorkspaceKeys(ctx);
      return { part: { ...part, keysInstrument() {
        const doc = this.studioSink();
        if (doc || this.workspace === 'studio') return doc;
        const m = ctx.handle.getModel();
        if (holdsPanel(m)) return this.synthSink();
        if (!insertDecision(m).auto) return null;
        const synth = this.synthSink();
        const cmp = this;
        return { ...synth, noteOn(note, velocity, o) {
          const st = ctx.handle;
          if (!holdsPanel(st.getModel())) cmp.synthArm();
          return synth.noteOn(note, velocity, o);
        } };
      } } };
    };
    const rig = await freshPage({ keysPart: legacy });
    const before = docOf(rig);
    rig.cmp.workspace = 'playground';
    rig.key('keydown');
    rig.key('keyup');
    const after = docOf(rig);
    assert.notEqual(after.hash, before.hash, 'the legacy key rewrote the document');
    assert.equal(holdsPanel(after.model), true);
    assert.ok(after.nodes > before.nodes, `${before.nodes} -> ${after.nodes} nodes`);
  });
