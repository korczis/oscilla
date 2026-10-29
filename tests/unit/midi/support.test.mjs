// V501: the MIDI support state of ADR 0058 (its V500 resolution note), on the page's own
// module src/js/midi/support.js with a stand-in navigator.
//
// - The thirteen states, their order and their exact copy are the table of the ADR, read from
//   the ADR file itself, so a copy that drifts from the decision fails here.
// - Each state is reached by its own cause: the context first (insecure, unsupported), then,
//   once Connect MIDI was chosen, the latest request and the access it gave, and only before
//   the first Connect MIDI the permission query (unknown, needs-permission, allowed, denied).
// - Loading reads isSecureContext, typeof navigator.requestMIDIAccess and one
//   permissions.query({ name: 'midi' }); it never calls requestMIDIAccess. Connect MIDI calls
//   it with { sysex: false }, and a new request replaces the one before it.
//
//   node --test 'tests/unit/midi/*.test.mjs'
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import * as support from '../../../src/js/midi/support.js';

const { MIDI_STATES, MIDI_COPY, midiSite, midiText, createMidiSupport } = support;

const root = new URL('../../../', import.meta.url);
const ADR = readFileSync(new URL(
  '.ai/repo/adrs/0058-midi-is-an-optional-local-input-layer-over-the-audio-engine.md', root),
'utf8');

/** The support-state table of ADR 0058: [{ n, state, copy }] in the ADR's order. */
function adrTable() {
  const rows = [];
  for (const line of ADR.split('\n')) {
    const m = /^\| (\d+) \| `([a-z-]+)` \|[^|]*\| "([^"]*)" \|/.exec(line);
    if (m) rows.push({ n: Number(m[1]), state: m[2], copy: m[3] });
  }
  return rows;
}

// ------------------------------------------------------------------ stand-ins for the platform
class FakeStatus extends EventTarget {
  constructor(state) { super(); this.state = state; }
  change(state) { this.state = state; this.dispatchEvent(new Event('change')); }
}

class FakePort extends EventTarget {
  constructor(id, name, state = 'connected') {
    super();
    Object.assign(this, { id, name, state, type: 'input', manufacturer: 'unit test' });
  }
}

class FakeAccess extends EventTarget {
  constructor(ports) {
    super();
    this.inputs = new Map(ports.map((p) => [p.id, p]));
    this.outputs = new Map();
    this.listening = 0;
  }
  addEventListener(type, fn, o) {
    if (type === 'statechange') this.listening += 1;
    super.addEventListener(type, fn, o);
  }
  removeEventListener(type, fn, o) {
    if (type === 'statechange') this.listening -= 1;
    super.removeEventListener(type, fn, o);
  }
  plug(name) {
    const port = new FakePort(`in-${this.inputs.size + 1}`, name);
    this.inputs.set(port.id, port);
    this.emit(port);
    return port;
  }
  unplug(name) {
    const port = [...this.inputs.values()].find((p) => p.name === name);
    port.state = 'disconnected';
    this.emit(port);
  }
  emit(port) {
    const ev = new Event('statechange');
    ev.port = port;
    this.dispatchEvent(ev);
  }
}

const domError = (name) => Object.assign(new Error(`${name} raised`), { name });

/**
 * A navigator: `api` false leaves requestMIDIAccess out; `query` is a PermissionState, or
 * 'missing' (no permissions.query), 'throws', 'rejects' or 'hangs' (a query that has not
 * answered until the test calls nav.answer(state)). Each request is held until the test
 * settles it.
 */
function fakeNavigator({ api = true, query = 'prompt' } = {}) {
  const nav = { requests: [], queries: [] };
  const status = ['prompt', 'granted', 'denied'].includes(query) ? new FakeStatus(query) : null;
  nav.status = status;
  if (query !== 'missing') {
    nav.permissions = {
      query(descriptor) {
        nav.queries.push(descriptor);
        if (query === 'throws') throw new TypeError('not a valid permission name');
        if (query === 'rejects') return Promise.reject(domError('NotSupportedError'));
        if (query === 'hangs') {
          return new Promise((resolve) => {
            nav.answer = (state) => { nav.status = new FakeStatus(state); resolve(nav.status); };
          });
        }
        return Promise.resolve(status);
      },
    };
  }
  if (api) {
    nav.requestMIDIAccess = function requestMIDIAccess(options) {
      let settle;
      const promise = new Promise((resolve, reject) => { settle = { resolve, reject }; });
      nav.requests.push({ options, ...settle });
      return promise;
    };
  }
  return nav;
}

const flush = () => new Promise((resolve) => { setImmediate(resolve); });

async function loaded(opts = {}, env = {}) {
  const nav = fakeNavigator(opts);
  const seen = [];
  const midi = createMidiSupport({
    navigator: nav,
    isSecureContext: env.secure !== false,
    site: env.site || '127.0.0.1:8080',
    onChange: (s) => seen.push(s),
  });
  await midi.init();
  await flush();
  return { nav, midi, seen };
}

async function connected(names, opts) {
  const ctx = await loaded(opts);
  ctx.midi.connect();
  const access = new FakeAccess(names.map((n, i) => new FakePort(`in-${i + 1}`, n)));
  ctx.nav.requests.at(-1).resolve(access);
  await flush();
  return { ...ctx, access };
}

// ------------------------------------------------------------------------------- the table
test('the thirteen states and their exact copy are the table of ADR 0058', () => {
  const rows = adrTable();
  assert.equal(rows.length, 13, 'the ADR table is read');
  assert.deepEqual(rows.map((r) => r.n), Array.from({ length: 13 }, (_, i) => i + 1));
  assert.deepEqual([...MIDI_STATES], rows.map((r) => r.state), 'same states, same order');
  for (const r of rows) assert.equal(MIDI_COPY[r.state], r.copy, `copy of ${r.state}`);
  assert.ok(Object.isFrozen(MIDI_COPY) && Object.isFrozen(MIDI_STATES));
});

test('the copy fills {site}, {names}, {name} and {error}, and names no browser', () => {
  const site = 'korczis.github.io';
  assert.equal(midiText('connected', { site, names: ['Keys', ''] }),
    'MIDI is on: Keys, unnamed input.');
  assert.equal(midiText('disconnected', { site, name: '' }),
    'MIDI input disconnected: unnamed input. No MIDI input is connected.');
  assert.equal(midiText('failed', { site, error: 'NotSupportedError' }),
    'MIDI could not start on this computer (the browser reported NotSupportedError).');
  assert.equal(midiText('denied', { site }), 'MIDI access is not allowed for korczis.github.io. '
    + 'Allow MIDI in the browser\'s site settings, then choose Connect MIDI again.');
  for (const state of MIDI_STATES) {
    const t = midiText(state, { site, names: ['K'], name: 'K', error: 'E' });
    assert.doesNotMatch(t, /[{}]/, `${state}: every placeholder is filled`);
    assert.doesNotMatch(t, /Chrome|Chromium|Firefox|Safari|WebKit/, `${state} names no browser`);
  }
  assert.throws(() => midiText('bogus', {}), /unknown MIDI state/);
});

test('a value is inserted verbatim and never read as a placeholder or a $ pattern', () => {
  // String.prototype.replace with a string expands $& / $' / $` / $$ in the replacement, and a
  // chain of replaces searches each inserted value for the placeholders that follow.
  assert.equal(midiText('connected', { names: ['Pads $& X'] }), 'MIDI is on: Pads $& X.');
  assert.equal(midiText('connected', { names: ['{error}'] }), 'MIDI is on: {error}.');
  assert.equal(midiText('connected', { names: ['{name}', "$' $` $$"] }),
    "MIDI is on: {name}, $' $` $$.");
  assert.equal(midiText('disconnected', { name: '{error} $&' }),
    'MIDI input disconnected: {error} $&. No MIDI input is connected.');
  assert.equal(midiText('failed', { error: '$&{site}' }),
    'MIDI could not start on this computer (the browser reported $&{site}).');
  assert.equal(midiText('denied', { site: '{names}$&' }), 'MIDI access is not allowed for '
    + '{names}$&. Allow MIDI in the browser\'s site settings, then choose Connect MIDI again.');
});

test('{site} is location.host over http(s) and "this page" on file://', () => {
  assert.equal(midiSite({ protocol: 'https:', host: 'korczis.github.io' }), 'korczis.github.io');
  assert.equal(midiSite({ protocol: 'http:', host: '127.0.0.1:5173' }), '127.0.0.1:5173');
  assert.equal(midiSite({ protocol: 'file:', host: '' }), 'this page');
});

// ---------------------------------------------------------------------------------- at load
test('row 1 insecure comes first: no query, no request, Connect MIDI not offered', async () => {
  for (const api of [true, false]) {
    const nav = fakeNavigator({ api });
    const midi = createMidiSupport({ navigator: nav, isSecureContext: false, site: 'x' });
    await midi.init();
    assert.equal(midi.snapshot().state, 'insecure');
    assert.equal(midi.snapshot().canConnect, false);
    assert.equal(midi.connect(), false, 'Connect MIDI is refused');
    assert.equal(nav.queries.length + nav.requests.length, 0);
  }
});

test('row 2 unsupported: a secure context without the method, whatever else exists', async () => {
  const { nav, midi } = await loaded({ api: false });
  assert.equal(midi.snapshot().state, 'unsupported');
  assert.equal(midi.snapshot().text, MIDI_COPY.unsupported);
  assert.equal(midi.snapshot().canConnect, false);
  assert.equal(midi.connect(), false);
  assert.equal(nav.queries.length, 0, 'the query is not needed once the API is missing');
  // Firefox on file:// exposes the MIDIAccess interface without the method: still unsupported.
  const firefoxFile = fakeNavigator({ api: false });
  firefoxFile.MIDIAccess = function MIDIAccess() {};
  const m2 = createMidiSupport({ navigator: firefoxFile, isSecureContext: true, site: 'x' });
  await m2.init();
  assert.equal(m2.snapshot().state, 'unsupported');
});

test('loading queries the permission once and never requests access', async () => {
  for (const [query, state] of [['prompt', 'needs-permission'], ['granted', 'allowed'],
    ['denied', 'denied'], ['missing', 'unknown'], ['throws', 'unknown'], ['rejects', 'unknown']]) {
    const { nav, midi } = await loaded({ query });
    assert.equal(midi.snapshot().state, state, `query ${query}`);
    assert.equal(midi.snapshot().text, midiText(state, { site: '127.0.0.1:8080' }));
    assert.equal(midi.snapshot().canConnect, true, `Connect MIDI is offered (${query})`);
    assert.equal(nav.requests.length, 0, `no request at load (${query})`);
    assert.deepEqual(nav.queries, query === 'missing' ? [] : [{ name: 'midi' }]);
  }
});

test('a permission query that does not answer in time reads unknown and offers Connect MIDI',
  async () => {
    assert.ok(Number.isFinite(support.MIDI_QUERY_TIMEOUT_MS)
      && support.MIDI_QUERY_TIMEOUT_MS > 0 && support.MIDI_QUERY_TIMEOUT_MS <= 5000,
    'the load-time query is bounded by a short named deadline');
    const nav = fakeNavigator({ query: 'hangs' });
    const midi = createMidiSupport({ navigator: nav, isSecureContext: true, site: 'x',
      queryTimeoutMs: 20 });
    const t0 = Date.now();
    await midi.init(); // must settle although the query never does
    assert.ok(Date.now() - t0 < 2000, 'init returns at the deadline');
    assert.equal(midi.snapshot().state, 'unknown');
    assert.equal(midi.snapshot().text, midiText('unknown', { site: 'x' }));
    assert.equal(midi.snapshot().canConnect, true, 'Connect MIDI is offered');
    assert.equal(nav.requests.length, 0, 'still no request');
    // A late answer still chooses the state before Connect MIDI, and its status is kept.
    nav.answer('granted');
    await flush();
    assert.equal(midi.snapshot().state, 'allowed');
    nav.status.change('denied');
    assert.equal(midi.snapshot().state, 'denied', 'the late status is listened to');
  });

test('a late query answer after Connect MIDI does not choose the state, but is kept',
  async () => {
    const nav = fakeNavigator({ query: 'hangs' });
    const midi = createMidiSupport({ navigator: nav, isSecureContext: true, site: 'x',
      queryTimeoutMs: 20 });
    await midi.init();
    midi.connect();
    nav.requests[0].resolve(new FakeAccess([new FakePort('a', 'Keys')]));
    await flush();
    nav.answer('granted');
    await flush();
    assert.equal(midi.snapshot().state, 'connected');
    nav.status.change('prompt');
    assert.equal(midi.snapshot().state, 'revoked', 'the kept late status detects a withdrawal');
  });

test('before any Connect MIDI the kept PermissionStatus chooses the state', async () => {
  const { nav, midi, seen } = await loaded({ query: 'prompt' });
  nav.status.change('granted');
  assert.equal(midi.snapshot().state, 'allowed', 'a grant at load does not connect by itself');
  nav.status.change('denied');
  assert.equal(midi.snapshot().state, 'denied');
  nav.status.change('prompt');
  assert.equal(midi.snapshot().state, 'needs-permission');
  assert.deepEqual(seen.map((s) => s.state),
    ['needs-permission', 'allowed', 'denied', 'needs-permission'], 'each change is announced');
  assert.equal(nav.requests.length, 0);
});

// ----------------------------------------------------------------------- after Connect MIDI
test('Connect MIDI requests access once, with { sysex: false }, and states pending', async () => {
  const { nav, midi } = await loaded();
  assert.equal(midi.connect(), true);
  assert.equal(nav.requests.length, 1);
  assert.deepEqual(nav.requests[0].options, { sysex: false });
  assert.equal(midi.snapshot().state, 'pending');
  assert.equal(midi.snapshot().text, MIDI_COPY.pending);
  nav.status.change('granted');
  assert.equal(midi.snapshot().state, 'pending', 'the query no longer chooses the state');
});

test('rejections: SecurityError blocked, NotAllowedError denied, any other name failed',
  async () => {
    for (const [name, state] of [['SecurityError', 'blocked'], ['NotAllowedError', 'denied'],
      ['NotSupportedError', 'failed'], ['AbortError', 'failed'], ['', 'failed']]) {
      const { nav, midi } = await loaded({ query: 'prompt' });
      midi.connect();
      nav.requests[0].reject(domError(name));
      await flush();
      assert.equal(midi.snapshot().state, state, name);
      if (state === 'failed') {
        assert.equal(midi.snapshot().text, midiText('failed', { error: name || 'Error' }));
      } else {
        assert.equal(midi.snapshot().text, midiText(state, { site: '127.0.0.1:8080' }));
      }
      assert.equal(nav.status.state, 'prompt', 'denied comes from the request, not the query');
    }
  });

test('a request that throws synchronously is a rejection with its name', async () => {
  const nav = fakeNavigator();
  nav.requestMIDIAccess = () => { throw domError('SecurityError'); };
  const midi = createMidiSupport({ navigator: nav, isSecureContext: true, site: 'x' });
  await midi.init();
  midi.connect();
  await flush();
  assert.equal(midi.snapshot().state, 'blocked');
});

test('no-devices, then connected with the names; disconnected names the last port', async () => {
  const { access, midi } = await connected([]);
  assert.equal(midi.snapshot().state, 'no-devices');
  assert.equal(midi.snapshot().text, MIDI_COPY['no-devices']);
  assert.deepEqual(midi.snapshot().inputs, []);
  access.plug('Keys');
  assert.equal(midi.snapshot().state, 'connected');
  access.plug('');
  assert.equal(midi.snapshot().text, 'MIDI is on: Keys, unnamed input.');
  assert.deepEqual(midi.snapshot().inputs, ['Keys', 'unnamed input']);
  access.unplug('Keys');
  assert.equal(midi.snapshot().state, 'connected', 'one of two left: still connected');
  assert.equal(midi.snapshot().text, 'MIDI is on: unnamed input.');
  access.unplug('');
  assert.equal(midi.snapshot().state, 'disconnected');
  assert.equal(midi.snapshot().text,
    'MIDI input disconnected: unnamed input. No MIDI input is connected.');
  access.plug('Pads');
  assert.equal(midi.snapshot().state, 'connected');
  assert.equal(midi.snapshot().text, 'MIDI is on: Pads.');
});

test('inputs present but not connected when access resolves read as no-devices', async () => {
  const ctx = await loaded();
  ctx.midi.connect();
  ctx.nav.requests[0].resolve(new FakeAccess([new FakePort('a', 'Gone', 'disconnected')]));
  await flush();
  assert.equal(ctx.midi.snapshot().state, 'no-devices');
});

test('a withdrawn permission after access is revoked: listening stops, access dropped',
  async () => {
    const { nav, access, midi } = await connected(['Keys'], { query: 'granted' });
    assert.equal(midi.snapshot().state, 'connected');
    assert.equal(access.listening, 1);
    nav.status.change('granted');
    assert.equal(midi.snapshot().state, 'connected', 'granted again is no withdrawal');
    nav.status.change('prompt');
    assert.equal(midi.snapshot().state, 'revoked');
    assert.equal(midi.snapshot().text, midiText('revoked', { site: '127.0.0.1:8080' }));
    assert.equal(access.listening, 0, 'the statechange listener is removed');
    access.plug('Pads');
    assert.equal(midi.snapshot().state, 'revoked', 'the dropped access changes nothing');
    midi.connect();
    assert.equal(midi.snapshot().state, 'pending', 'Connect MIDI asks again');
    nav.requests.at(-1).reject(domError('NotAllowedError'));
    await flush();
    assert.equal(midi.snapshot().state, 'denied');
  });

test('without a kept PermissionStatus a revocation is not detected', async () => {
  const { midi } = await connected(['Keys'], { query: 'missing' });
  assert.equal(midi.snapshot().state, 'connected');
});

test('the latest request wins: an earlier one that settles later is ignored', async () => {
  const { nav, midi } = await loaded();
  midi.connect();
  midi.connect();
  assert.equal(nav.requests.length, 2);
  nav.requests[1].reject(domError('NotAllowedError'));
  await flush();
  const stale = new FakeAccess([new FakePort('a', 'Keys')]);
  nav.requests[0].resolve(stale);
  await flush();
  assert.equal(midi.snapshot().state, 'denied');
  assert.equal(stale.listening, 0, 'nothing listens to a stale access');
});

test('a new request drops the access of the previous one', async () => {
  const { nav, access, midi } = await connected(['Keys']);
  midi.connect();
  assert.equal(access.listening, 0);
  assert.equal(midi.snapshot().state, 'pending');
  access.unplug('Keys');
  assert.equal(midi.snapshot().state, 'pending');
  nav.requests.at(-1).resolve(new FakeAccess([]));
  await flush();
  assert.equal(midi.snapshot().state, 'no-devices', 'the new access starts its own history');
});
