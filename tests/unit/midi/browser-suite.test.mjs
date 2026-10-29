// V501: the judgements of tests/browser/midi.cjs and the seam's own conditions, without a
// browser (review of #249).
//
// - A Chromium request still `pending` at its deadline is a recorded outcome off darwin (the
//   CI runners, never measured) and a failure on darwin, the record.
// - midi-measured-no-prompt can fail: where the API exists the query must read `prompt`.
// - RECORD lines name the http origin as the Pages-like sub-path on 127.0.0.1, never as the
//   Pages origin.
// - Every midi-measured-* / midi-seam-* check first asserts its own group in the page.
// - The stub says when a request's settlement has reached the page, so "an older request
//   that resolves later is ignored" is judged after a condition poll, not on the next read.
//
//   node --test 'tests/unit/midi/*.test.mjs'
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const root = new URL('../../../', import.meta.url);
const read = (p) => readFileSync(new URL(p, root), 'utf8');
const suite = require('../../browser/midi.cjs');
const stub = require('../../browser/lib/midi-stub.cjs');

test('loaded as a module, midi.cjs opens no run and exports its judgements', () => {
  for (const fn of ['judgeSettled', 'judgeNoPrompt', 'originLabel']) {
    assert.equal(typeof suite[fn], 'function', fn);
  }
});

test('a request still pending at its deadline is recorded off darwin, a failure on darwin',
  () => {
    const { judgeSettled } = suite;
    const pendingAtDeadline = { state: 'pending', text: '…', timedOut: 'no answer in 30000 ms' };
    assert.deepEqual(judgeSettled(pendingAtDeadline, ['no-devices'], { pendingRecorded: true }),
      { ok: true, pending: true }, 'off darwin: a recorded outcome');
    assert.deepEqual(judgeSettled(pendingAtDeadline, ['no-devices'], { pendingRecorded: false }),
      { ok: false, pending: false }, 'on darwin: the record says no-devices');
    assert.deepEqual(judgeSettled(pendingAtDeadline, ['no-devices']),
      { ok: false, pending: false }, 'strict by default');
    assert.deepEqual(judgeSettled({ state: 'no-devices' }, ['no-devices', 'failed'],
      { pendingRecorded: true }), { ok: true, pending: false });
    assert.deepEqual(judgeSettled({ state: 'denied', timedOut: 'x' }, ['no-devices'],
      { pendingRecorded: true }), { ok: false, pending: false }, 'any other state fails');
  });

test('the declared revoke skip says what the code does with a pending request', () => {
  const readme = read('tests/README.md');
  const row = readme.split('\n').find((l) => l.startsWith('| `midi:midi-measured-revoke` |'));
  assert.ok(row, 'midi:midi-measured-revoke is declared');
  assert.match(row, /still `pending` at/, 'a request pending at its deadline is named');
  assert.match(row, /RECORD/, 'and that it is recorded');
  assert.doesNotMatch(row, /does not resolve/, 'not the wording the code never implemented');
});

test('midi-measured-no-prompt can fail where the API exists and is not run where it is absent',
  () => {
    const { judgeNoPrompt } = suite;
    assert.equal(judgeNoPrompt({ api: 'undefined', query: 'rejects TypeError' },
      { query: 'rejects TypeError' }), null);
    assert.equal(judgeNoPrompt({ api: 'function', query: 'prompt' }, { query: 'prompt' }).ok,
      true);
    assert.equal(judgeNoPrompt({ api: 'function', query: 'granted' }, { query: 'granted' }).ok,
      false, 'a load that changed the permission fails');
    assert.equal(judgeNoPrompt({ api: 'function', query: 'prompt' }, { query: 'denied' }).ok,
      false);
  });

test('the http origin is recorded as the Pages-like sub-path on 127.0.0.1, not Pages', () => {
  const label = suite.originLabel('http', 'http://127.0.0.1:5173/oscilla/');
  assert.match(label, /^http:\/\/127\.0\.0\.1:5173\/oscilla\/ /);
  assert.match(label, /Pages-like sub-path served locally on 127\.0\.0\.1/);
  assert.match(label, /not the Pages origin https:\/\/korczis\.github\.io/);
  assert.match(suite.originLabel('file', 'file:///x/dist/index.html'), /^file:\/\//);
  assert.match(read('docs/midi.md'), /not the Pages origin `https:\/\/korczis\.github\.io`/);
});

test('every midi-measured-* and midi-seam-* check first asserts its own group', () => {
  const src = read('tests/browser/midi.cjs');
  const blocks = src.split(/(?=const id = 'midi-)/).slice(1);
  assert.ok(blocks.length >= 9, `the checks are read (${blocks.length})`);
  for (const block of blocks) {
    const id = /^const id = '([\w-]+)'/.exec(block)[1];
    const group = id.startsWith('midi-seam-') ? 'seam' : 'measured';
    const first = /\bcheck\(\s*leg,\s*id\b/.exec(block);
    const asserted = new RegExp(String.raw`assertGroup\(\s*leg,\s*id,\s*page,\s*'${group}'\)`
      + String.raw`|inGroup\(\s*\w+,\s*'${group}'\)|p\.marker === '(?:spy|stub)'`).exec(block);
    assert.ok(asserted, `${id} asserts the ${group} group`);
    // The group is asserted before the first check, or is what that first check judges.
    const firstEnd = first ? block.indexOf(';', first.index) : -1;
    assert.ok(!first || asserted.index < firstEnd,
      `${id}: the group comes before its first check`);
  }
});

// The stub in a realm of its own, with the page globals it needs.
function stubRealm() {
  class Navigator {}
  const ctx = vm.createContext({ EventTarget, Event, DOMException, performance, Navigator,
    window: {} });
  vm.runInContext(`(${stub.install})({})`, ctx);
  return { seam: ctx.window.__oscMidiSeam, nav: new Navigator() };
}
const tick = () => new Promise((resolve) => { setImmediate(resolve); });

test('the stub says when a settlement has reached the page, after the page\'s reactions',
  async () => {
    const { seam, nav } = stubRealm();
    const order = [];
    const older = nav.requestMIDIAccess({ sysex: false });
    older.then((access) => order.push(['page', access.inputs.size]));
    const newer = nav.requestMIDIAccess({ sysex: false });
    newer.then(() => {}, (e) => order.push(['page rejected', e.name]));
    assert.equal(seam.delivered(0), false);
    seam.reject(1, 'NotAllowedError');
    seam.resolve(0, [stub.STUB_NAME]);
    assert.equal(seam.delivered(0), false, 'not yet: the reactions are still queued');
    await tick();
    assert.equal(seam.delivered(0), true);
    assert.equal(seam.delivered(1), true);
    assert.deepEqual(order, [['page rejected', 'NotAllowedError'], ['page', 1]]);
    assert.equal(seam.listening(0), 0, 'nothing listens to the access');
    assert.equal(seam.listening(1), 0, 'a rejected request has no access');
    assert.throws(() => seam.delivered(5), /no request 5/);
  });

test('the stub counts the statechange listeners on a request\'s access', async () => {
  const { seam, nav } = stubRealm();
  const p = nav.requestMIDIAccess({ sysex: false });
  seam.resolve(0, []);
  const access = await p;
  const fn = () => {};
  access.addEventListener('statechange', fn);
  assert.equal(seam.listening(0), 1);
  access.removeEventListener('statechange', fn);
  assert.equal(seam.listening(0), 0);
});

test('the "older request resolving later" read waits on the stub\'s condition, bounded', () => {
  const src = read('tests/browser/midi.cjs');
  const at = src.indexOf('an older request that resolves later is ignored');
  assert.ok(at > 0);
  const before = src.slice(src.lastIndexOf("seam(page, 'resolve', i,", at), at);
  assert.match(before, /await until\(\(\) => seam\(page, 'delivered', i\),\s*\{ ms: STEP_MS,/,
    'polled with until() against STEP_MS');
  assert.match(before, /seam\(page, 'listening', i\)/, 'and nothing listens to its access');
});
