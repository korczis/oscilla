// The Studio workspace's runtime and transport part (src/js/ui/studio/workspace/runtime.js,
// §41-§46, §170-§171, §180-§186; K104; C037): the status recompile and its warning line, Allow
// microphone (no API, a refusal, a runtime that cannot apply it, stopped, playing and settled),
// the commit gate, the transport events (state, ended, warning) and the PLAY / STOP / loop /
// return commands, on a fake transport, runtime and component. The DOM it touches (the playhead
// readout, requestAnimationFrame) is stubbed.
//   node --test tests/unit/studio-workspace-runtime.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';

import { createWorkspaceRuntime } from '../../src/js/ui/studio/workspace/runtime.js';
import { MIC_PRIVACY_NOTICE, MIC_UNAVAILABLE_TEXT } from '../../src/js/audio/microphone.js';
import { NODE_REGISTRY } from '../../src/js/studio/registry.js';
import { REFERENCE_TEMPLATE_ID, templateModel } from '../../src/js/studio/templates/index.js';

/** A readout element and requestAnimationFrame that only count. */
function stubDom() {
  const readout = { textContent: '' };
  const frames = [];
  globalThis.document = { querySelector: (sel) => (sel === '[data-osc="studio.time"]'
    ? readout : null) };
  globalThis.requestAnimationFrame = (fn) => { frames.push(fn); return frames.length; };
  return { readout, frames };
}

function harness({ transport = null, runtime = null, navigator = null, cmp = undefined,
  mounted = true } = {}) {
  const dom = stubDom();
  let model = templateModel(REFERENCE_TEMPLATE_ID);
  const renders = { editor: 0, inspector: 0, running: [] };
  const said = [];
  const released = [];
  const dispatched = [];
  const ctx = {
    registry: NODE_REGISTRY,
    handle: { getRevision: () => 1, getModel: () => model,
      dispatch: (a) => { dispatched.push(a); return { ok: true, changed: true, label: 'Loop' }; } },
    runtime, transport, mounted, micBusy: false, micErrors: new Map(), raf: 0,
    status: new Map(), edgeStatus: new Map(),
    editor: { render: () => { renders.editor += 1; },
      setRunning: (on) => renders.running.push(on) },
    inspector: { render: () => { renders.inspector += 1; } },
    compact: { positions: [], transports: [], setPlayhead(p) { this.positions.push(p); },
      setTransport(t) { this.transports.push(t); } },
    cmp: cmp === undefined ? { studio: { warning: '', playing: false, armed: false,
      measureNote: 'old' } } : cmp,
    measureRun: null,
  };
  const engine = { inits: 0, init() { this.inits += 1; }, resume: () => Promise.resolve(),
    _env: { navigator } };
  const svc = { engine, release: (o) => released.push(o) };
  const ops = {
    announce: (text, opts) => said.push({ text, assertive: !!(opts && opts.assertive) }),
    setupAudio() {} };
  const { ops: rops, part } = createWorkspaceRuntime(ctx, svc, ops);
  return { ctx, svc, engine, rops, part, said, released, dispatched, renders, dom,
    setModel: (m) => { model = m; } };
}

/** A transport that records what it was asked. */
function fakeTransport({ start = { ok: true }, position = 1.5 } = {}) {
  return {
    playing: false, armed: false, stops: [], starts: 0, returns: 0, loops: [],
    playhead: () => ({ position }),
    start() { this.starts += 1; if (start.ok) this.playing = true; return start; },
    stop(o) { this.stops.push(o); this.playing = false; return Promise.resolve('stopped'); },
    admit: (next, info) => (info && info.refuse ? { ok: false, reason: 'Running graph refused.' }
      : { ok: true }),
    setLoop(o) { this.loops.push(o); return { ok: true }; },
    returnToStart() { this.returns += 1; },
  };
}

/** A runtime with Microphone handles that settle on a later 'handle' event. */
function fakeRuntime(mics, { setOptions = { ok: true } } = {}) {
  const listeners = new Set();
  return {
    state: 'running', options: {},
    nodes: new Map(mics.map((m) => [m.id, { type: 'microphone', ...m }])),
    setOptions(o) { this.options = { ...this.options, ...o }; return setOptions; },
    on(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    emit(type) { for (const fn of [...listeners]) fn(type); },
    listeners,
  };
}

const okNavigator = (fail = null) => ({ mediaDevices: { getUserMedia: () => (fail
  ? Promise.reject(fail) : Promise.resolve({ getTracks: () => [{ stop() {} }] })) } });

test('recompile sets the node, edge and warning state; a compile failure shows, then clears',
  () => {
    const h = harness();
    h.rops.recompile(h.ctx.handle.getModel());
    assert.ok(h.ctx.status instanceof Map && h.ctx.status.has('osc-1'));
    assert.ok(h.ctx.edgeStatus instanceof Map && h.ctx.edgeStatus.has('edge-1'));
    assert.ok(Array.isArray(h.ctx.warnings) || h.ctx.warnings instanceof Map);
    assert.equal(h.ctx.cmp.studio.warning, '');

    // The compile failure the line showed is cleared once the status compiles again ...
    h.ctx.compileWarning = 'The Studio could not be compiled: boom';
    h.ctx.cmp.studio.warning = 'The Studio could not be compiled: boom';
    h.rops.recompile(h.ctx.handle.getModel());
    assert.equal(h.ctx.cmp.studio.warning, '');
    assert.equal(h.ctx.compileWarning, '');
    // ... but a line that says something else by then is kept.
    h.ctx.compileWarning = 'The Studio could not be compiled: boom';
    h.ctx.cmp.studio.warning = 'Node degraded.';
    h.rops.recompile(h.ctx.handle.getModel());
    assert.equal(h.ctx.cmp.studio.warning, 'Node degraded.');
    // Without a component only the status is kept.
    const bare = harness({ cmp: null });
    bare.rops.recompile(bare.ctx.handle.getModel());
    assert.ok(bare.ctx.status.has('osc-1'));
  });

test('refreshStatus re-renders the editor and the Inspector only while mounted', () => {
  const h = harness();
  h.rops.refreshStatus();
  assert.deepEqual([h.renders.editor, h.renders.inspector], [1, 1]);
  h.ctx.mounted = false;
  h.rops.refreshStatus();
  assert.deepEqual([h.renders.editor, h.renders.inspector], [1, 1]);
});

test('Allow microphone without the API keeps the input off and names the node', async () => {
  const h = harness({ runtime: fakeRuntime([]), mounted: false, navigator: {} });
  assert.equal(await h.rops.allowMicrophone('mic-1'), false);
  assert.equal(h.ctx.micErrors.get('mic-1'), MIC_UNAVAILABLE_TEXT);
  assert.equal(h.ctx.micBusy, false);
  assert.deepEqual(h.said, []);
});

test('Allow microphone: a denied permission is the node\'s error; one request at a time',
  async () => {
    const denied = Object.assign(new Error('no'), { name: 'NotAllowedError' });
    const h = harness({ runtime: fakeRuntime([]), mounted: false, navigator: okNavigator(denied) });
    h.ctx.micBusy = true;
    assert.equal(await h.rops.allowMicrophone('mic-1'), false);
    assert.equal(h.ctx.micErrors.size, 0, 'a busy request asks nothing');
    h.ctx.micBusy = false;
    assert.equal(await h.rops.allowMicrophone('mic-1'), false);
    assert.match(h.ctx.micErrors.get('mic-1'), /permission was denied/);
    assert.equal(h.said[0].text, 'Asking the browser for microphone permission.');
  });

test('Allow microphone with no Studio audio, or a runtime that refuses the option', async () => {
  const none = harness({ navigator: okNavigator() });
  assert.equal(await none.rops.allowMicrophone('m'), false);
  assert.equal(none.ctx.micErrors.get('m'), 'The Studio audio is not available here.');

  const rt = fakeRuntime([], { setOptions: { ok: false, errors: [{ message: 'no inputs' }] } });
  const bad = harness({ runtime: rt, mounted: false, navigator: okNavigator() });
  assert.equal(await bad.rops.allowMicrophone('m'), false);
  assert.equal(bad.ctx.micErrors.get('m'),
    'The microphone was allowed, but the Studio could not apply it: no inputs');
});

test('Allow microphone while stopped opens the input at PLAY and clears old errors', async () => {
  const rt = fakeRuntime([]);
  rt.state = 'stopped';
  const h = harness({ runtime: rt, navigator: okNavigator() });
  h.ctx.micErrors.set('old', 'stale');
  assert.equal(await h.rops.allowMicrophone(), true);
  assert.equal(rt.options.inputPermission, true);
  assert.equal(h.ctx.micErrors.size, 0);
  assert.equal(h.said.at(-1).text, 'Microphone allowed. The Microphone node opens the input when '
    + `the Studio plays. ${MIC_PRIVACY_NOTICE}`);
});

test('Allow microphone while playing waits for the pending input, then says what opened',
  async () => {
    const rt = fakeRuntime([{ id: 'mic-1', status: 'pending' }, { id: 'mic-2', status: 'ready' }]);
    const h = harness({ runtime: rt, mounted: false, navigator: okNavigator() });
    const p = h.rops.allowMicrophone('mic-1');
    // The wait listens to the runtime; the input fails to open, then the handle event settles it.
    await new Promise((r) => setImmediate(r));
    assert.equal(rt.listeners.size, 1);
    rt.nodes.get('mic-1').status = 'failed';
    rt.nodes.get('mic-1').reason = 'Device busy.';
    rt.emit('handle');
    assert.equal(await p, false);
    assert.equal(rt.listeners.size, 0, 'the settle unsubscribes');
    assert.equal(h.ctx.micErrors.get('mic-1'), 'Device busy.');
    assert.equal(h.ctx.micErrors.has('mic-2'), false);

    const ok = fakeRuntime([{ id: 'mic-1', status: 'ready' }]);
    const h2 = harness({ runtime: ok, mounted: false, navigator: okNavigator() });
    assert.equal(await h2.rops.allowMicrophone('mic-1'), true);
    assert.match(h2.said.at(-1).text,
      /^Microphone open: the Microphone node analyses the input now/);
  });

test('the commit gate passes the transport\'s verdict and shows a refusal', () => {
  const none = harness();
  assert.equal(none.rops.admitEdit({}, {}), null);
  const h = harness({ transport: fakeTransport() });
  assert.deepEqual(h.rops.admitEdit({}, {}), { ok: true });
  assert.deepEqual(h.said, []);
  assert.deepEqual(h.rops.admitEdit({}, { refuse: true }),
    { ok: false, reason: 'Running graph refused.' });
  assert.deepEqual(h.said, [{ text: 'Running graph refused.', assertive: true }]);
  assert.equal(h.ctx.cmp.studio.warning, 'Running graph refused.');
});

test('a playing state starts the playhead loop; a stop paints it, releases the output once', () => {
  const t = fakeTransport({ position: 1.5 });
  const h = harness({ transport: t });
  t.playing = true;
  h.rops.onTransport('state', { reason: 'play' });
  assert.equal(h.ctx.cmp.studio.playing, true);
  assert.equal(h.ctx.cmp.studio.armed, false);
  assert.deepEqual(h.renders.running, [true]);
  assert.deepEqual(h.ctx.compact.transports, [{ playing: true }]);
  assert.equal(h.dom.frames.length, 1);
  assert.equal(h.renders.inspector, 1);
  // The frame paints the readout and asks for the next one while playing.
  h.dom.frames[0]();
  assert.equal(h.dom.readout.textContent, '00:01.500');
  assert.deepEqual(h.ctx.compact.positions, [1.5]);
  assert.equal(h.dom.frames.length, 2);

  t.playing = false;
  h.rops.onTransport('ended', { reason: 'end' });
  assert.equal(h.ctx.cmp.studio.playing, false);
  assert.deepEqual(h.released, ['studio']);
  assert.equal(h.said.at(-1).text, 'Studio playback ended');
  assert.equal(h.dom.frames.length, 2, 'no frame is asked once stopped');
});

test('an armed run is not "playing" for the timeline; a warning shows its message', async () => {
  const t = fakeTransport();
  const h = harness({ transport: t });
  t.playing = true;
  t.armed = true;
  h.rops.onTransport('state', {});
  assert.equal(h.ctx.cmp.studio.playing, false);
  assert.equal(h.ctx.cmp.studio.armed, true);
  assert.deepEqual(h.ctx.compact.transports, [{ playing: false }]);

  const before = h.renders.inspector;
  h.rops.onTransport('warning', { message: 'Node degraded.' });
  assert.equal(h.ctx.cmp.studio.warning, 'Node degraded.');
  await Promise.resolve();
  assert.equal(h.renders.inspector, before + 1, 'the Inspector renders after the dispatch');
  h.rops.onTransport('warning', null);
  assert.equal(h.ctx.cmp.studio.warning, '');
  // Without a component nothing is touched.
  const bare = harness({ transport: t, cmp: null });
  bare.rops.onTransport('state', {});
  assert.deepEqual(bare.released, []);
});

test('studioPlay: refused under a measurement, a failed start says why, a start announces', () => {
  const t = fakeTransport();
  const h = harness({ transport: t });
  const busy = { ...h.part, studio: { measureNote: 'x' }, measureOwnsOutput: () => true };
  assert.equal(busy.studioPlay(), false);
  assert.match(h.said.at(-1).text, /^Studio did not start: the measurement owns the output/);
  assert.equal(t.starts, 0);

  const failing = harness({
    transport: fakeTransport({ start: { ok: false, reason: 'No nodes.' } }) });
  const c2 = { ...failing.part, studio: { measureNote: 'x' }, measureOwnsOutput: () => false };
  assert.equal(c2.studioPlay(), false);
  assert.deepEqual(failing.said.at(-1), { text: 'Studio did not start: No nodes.',
    assertive: true });
  assert.equal(c2.studio.measureNote, '');
  assert.equal(failing.engine.inits, 1, 'audio is ensured in the gesture');

  let reset = 0;
  h.ctx.measureRun = { busy: false, reset: () => { reset += 1; } };
  const c3 = { ...h.part, studio: { measureNote: 'x' } };
  assert.equal(c3.studioPlay(), true);
  assert.equal(reset, 1);
  assert.equal(h.said.at(-1).text, 'Studio playing');
  assert.equal(h.part.studioOwnsOutput(), true);

  const off = harness();
  assert.equal({ ...off.part, studio: {} }.studioPlay(), false, 'no transport, no PLAY');
  assert.equal(off.part.studioOwnsOutput(), false);
});

test('studioStop aborts a running measurement, keeps armed only when asked, and says so',
  async () => {
    const t = fakeTransport();
    const h = harness({ transport: t });
    const aborts = [];
    h.ctx.measureRun = { view: { state: 'running' } };
    const c = { ...h.part, measureAbort: (w) => aborts.push(w) };
    assert.equal(await c.studioStop({ keepArmed: true }), 'stopped');
    assert.deepEqual(aborts, ['user']);
    assert.deepEqual(t.stops, [{ fast: false, keepArmed: true }]);
    assert.equal(h.said.at(-1).text, 'Studio stopped');
    t.armed = true;
    c.studioStop({ keepArmed: 'yes', fast: 1 });
    assert.deepEqual(t.stops.at(-1), { fast: false, keepArmed: false }, 'only true counts');
    assert.equal(h.said.at(-1).text, 'Studio zastaveno, klávesy dál hrají (zapnuté).');
    assert.equal(await harness().rops.stopStudio(), null);
  });

test('studioTogglePlay stops a playing timeline (keeping armed) and plays otherwise', () => {
  const t = fakeTransport();
  const h = harness({ transport: t });
  const c = { ...h.part, studio: { measureNote: '' } };
  c.studioTogglePlay();
  assert.equal(t.starts, 1);
  c.studioTogglePlay();
  assert.deepEqual(t.stops, [{ fast: false, keepArmed: true }]);
  t.playing = true;
  t.armed = true;
  c.studioTogglePlay();
  assert.equal(t.starts, 2, 'an armed-only run is not a playing timeline');
});

test('loop and return: through the transport, or the store when there is none', () => {
  const t = fakeTransport();
  const h = harness({ transport: t });
  const loopOn = h.ctx.handle.getModel().timeline.loop.enabled;
  h.part.studioToggleLoop();
  assert.deepEqual(t.loops, [{ enabled: !loopOn }]);
  assert.equal(h.said.at(-1).text, `Loop ${loopOn ? 'off' : 'on'}`);
  h.part.studioReturn();
  assert.equal(t.returns, 1);
  assert.equal(h.said.at(-1).text, 'Returned to start');
  assert.equal(h.dom.readout.textContent, '00:01.500');

  const s = harness();
  s.part.studioToggleLoop();
  assert.deepEqual(s.dispatched, [{ type: 'LOOP_SET', enabled: !loopOn }]);
  s.ctx.handle.dispatch = () => ({ ok: false, reason: 'Locked.' });
  s.part.studioToggleLoop();
  assert.equal(s.said.at(-1).assertive, true);
});

test('studioClockAnchor is the transport\'s anchor, else null', () => {
  const t = fakeTransport();
  t.clockAnchor = () => ({ origin: 2, tempo: 120, fromStart: 0 });
  assert.deepEqual(harness({ transport: t }).part.studioClockAnchor(),
    { origin: 2, tempo: 120, fromStart: 0 });
  assert.equal(harness({ transport: fakeTransport() }).part.studioClockAnchor(), null);
  assert.equal(harness().part.studioClockAnchor(), null);
});
