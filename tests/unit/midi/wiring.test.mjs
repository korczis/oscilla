// V501: how the MIDI support state is wired into the page and the gate (ADR 0058, V500 note).
//
// - The page offers one "Connect MIDI" control (pointer and keyboard: a button) and one status
//   line that states the support state; nothing in src/js but src/js/midi/support.js calls
//   requestMIDIAccess, and it calls it once, with { sysex: false }, inside connect().
// - main.js composes the MIDI part and starts it with the component.
// - tests/browser/midi.cjs runs in the release gate (test:browser) through the harness, its seam
//   is tests/browser/lib/midi-stub.cjs (which names itself), and every page member the module
//   reads on a MIDIAccess or a MIDIPort is one the stub declares and the browser suite compares
//   with the real interface.
// - docs/midi.md carries the copy of every state as the ADR states it.
//
//   node --test 'tests/unit/midi/*.test.mjs'
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';

const root = new URL('../../../', import.meta.url);
const read = (p) => readFileSync(new URL(p, root), 'utf8');
const has = (p) => existsSync(new URL(p, root));
const require = createRequire(import.meta.url);
const ADR = read('.ai/repo/adrs/0058-midi-is-an-optional-local-input-layer-over-the-audio-engine.md');

function jsFiles(dir) {
  const out = [];
  for (const e of readdirSync(new URL(dir, root), { withFileTypes: true })) {
    const p = `${dir}/${e.name}`;
    if (e.isDirectory()) out.push(...jsFiles(p));
    else if (e.name.endsWith('.js')) out.push(p);
  }
  return out;
}

/** Code without comments (line and block), so a mention in prose is not a call. */
const code = (text) => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');

test('the shell offers Connect MIDI and a status line for the support state', () => {
  const html = read('src/index.html');
  const button = /<button\b[^>]*data-osc="midi\.connect"[^>]*>([\s\S]*?)<\/button>/.exec(html);
  assert.ok(button, 'a button data-osc="midi.connect"');
  assert.match(button[0], /type="button"/);
  assert.match(button[0], /@click="midiConnect\(\)"/);
  assert.match(button[0], /x-show="midiCanConnect"/, 'not offered in rows 1 and 2');
  assert.doesNotMatch(button[0], /\bdisabled\b/, 'offered or not, never disabled');
  assert.equal(button[1].replace(/<[^>]*>/g, '').trim(), 'Connect MIDI');
  const status = /<p\b[^>]*data-osc="midi\.status"[^>]*>/.exec(html);
  assert.ok(status, 'a status line data-osc="midi.status"');
  assert.match(status[0], /role="status"/);
  assert.match(status[0], /x-text="midiText"/);
  assert.match(status[0], /:data-midi-state="midiState"/);
});

test('only src/js/midi/support.js requests MIDI access, once, with { sysex: false }', () => {
  const callers = jsFiles('src/js').filter((f) => /requestMIDIAccess\s*\(/.test(code(read(f))));
  assert.deepEqual(callers, ['src/js/midi/support.js']);
  const src = code(read('src/js/midi/support.js'));
  const calls = [...src.matchAll(/requestMIDIAccess\s*\(([^)]*)\)/g)];
  assert.equal(calls.length, 1, 'one call site');
  assert.match(calls[0][1], /^\s*\{\s*sysex\s*:\s*false\s*\}\s*$/);
  const connect = src.indexOf('connect()');
  assert.ok(connect >= 0 && calls[0].index > connect, 'the call is in connect()');
  assert.doesNotMatch(src, /\bsysex\s*:\s*true/);
  for (const f of jsFiles('src/js/midi')) {
    assert.doesNotMatch(code(read(f)), /\bfetch\s*\(|XMLHttpRequest|WebSocket|localStorage/,
      `${f}: no network call and no persisted device name in the MIDI path`);
  }
});

test('main.js composes the MIDI part and starts it with the component', () => {
  const main = code(read('src/js/main.js'));
  assert.match(main, /import \{ createMidiUi \} from '\.\/midi\/ui\.js';/);
  assert.match(main, /const midi = createMidiUi\(/);
  assert.match(main, /compose\([^)]*\bmidi\b[^)]*\)/);
  assert.match(main, /this\.midiInit\(\);/);
});

test('tests/browser/midi.cjs runs in the release gate', () => {
  const pkg = JSON.parse(read('package.json'));
  assert.ok(has('tests/browser/midi.cjs'));
  assert.match(pkg.scripts['test:browser'], /node tests\/browser\/midi\.cjs/);
  assert.match(pkg.scripts['test:release'], /npm run test:browser/);
  assert.equal(pkg.scripts['test:midi'], 'node tests/browser/midi.cjs');
});

test('the seam is tests/browser/lib/midi-stub.cjs, it names itself and the reads it covers',
  () => {
    const stub = require('../../browser/lib/midi-stub.cjs');
    assert.equal(stub.STUB_NAME, 'TEST STUB · MIDI input');
    assert.equal(stub.STUB_MANUFACTURER, 'OSCILLA test');
    assert.equal(typeof stub.install, 'function');
    assert.equal(typeof stub.spy, 'function');
    assert.match(String(stub.install), /Navigator\.prototype/, 'it stubs the platform method');
    const src = code(read('src/js/midi/support.js'));
    const reads = (re) => [...new Set([...src.matchAll(re)].map((m) => m[1]))].sort();
    for (const m of reads(/\baccess\.(\w+)/g)) {
      assert.ok(stub.PAGE_READS.access.includes(m), `access.${m} is compared by the suite`);
    }
    for (const m of reads(/\bport\.(\w+)/g)) {
      assert.ok(stub.PAGE_READS.port.includes(m), `port.${m} is compared by the suite`);
    }
    for (const m of reads(/\binputs\.(\w+)/g)) {
      assert.ok(stub.PAGE_READS.inputs.includes(m), `inputs.${m} is compared by the suite`);
    }
  });

test('docs/midi.md states every state with the copy of ADR 0058', () => {
  const doc = read('docs/midi.md');
  let rows = 0;
  for (const line of ADR.split('\n')) {
    const m = /^\| (\d+) \| `([a-z-]+)` \|[^|]*\| "([^"]*)" \|/.exec(line);
    if (!m) continue;
    rows += 1;
    assert.ok(doc.includes(`\`${m[2]}\``), `docs/midi.md names ${m[2]}`);
    assert.ok(doc.includes(m[3]), `docs/midi.md carries the copy of ${m[2]}`);
  }
  assert.equal(rows, 13);
  assert.match(doc, /tests\/browser\/midi\.cjs/);
  assert.doesNotMatch(doc, /\b(?:Chrome|Safari)\b/, 'names gate builds, not shipped browsers');
});
