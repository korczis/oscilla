// Known MIDI devices (plan issue V507) and rule project.midi-profiles-derived.
//
// What it proves:
//   - project.midi-profiles-derived: the committed profile names its writer and, per device, its
//     source files with a sha256; only the allowed keys appear in it and no forbidden field; the
//     script's derivation of a synthetic fixture drops its key, updater and image fields; no
//     tracked file has a maker template, firmware or editor-layout extension; .local/ is
//     ignored; `derive-devices.mjs --check` exits 0 (no install: says so; install: compares);
//   - the lenient reader takes the maker's JSON dialect (trailing commas, leading zeros, tabs);
//   - recognise() names device and port role from the owner's port names, an unknown name plays;
//   - controlOf() names Encoder 1 (CC 74), Fader 9 (CC 85), Pad 1 (note 36, channel 10) of a
//     KeyLab mkII, and nothing for a note on channel 1;
//   - decodeMidi() (message.js, the one decoder, notes.js parses through it) and describeMidi()
//     read every MIDI 1.0 kind and refuse a short or malformed message; the monitor keeps MONITOR_ROWS rows,
//     newest first, and publishes at most once per MONITOR_FLUSH_MS, the last one never lost;
//   - midi/ui.js: a known device's DAW port sounds no note, its play port and an unknown input
//     do, every message reaches the monitor, the CC status line names the control.
//   node --test tests/unit/midi/devices.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { deriveDevice, parseLenient, consensus, roleOf as paramRole, channelOf }
  from '../../../scripts/midi/derive-devices.mjs';
import { recognise, recogniserOf, controlOf, controlLabel, DEVICES }
  from '../../../src/js/midi/devices.js';
import { decodeMidi, describeMidi, createMidiMonitor, MONITOR_ROWS, MONITOR_FLUSH_MS }
  from '../../../src/js/midi/monitor.js';
import { createMidiUi, inputRow } from '../../../src/js/midi/ui.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const read = (rel) => readFileSync(path.join(ROOT, rel), 'utf8');
const RULE = 'project.midi-profiles-derived';

const DEVICE_KEYS = ['id', 'name', 'names', 'identity', 'memories', 'controls', 'source'];
const CONTROL_KEYS = ['id', 'kind', 'bank', 'message', 'channel', 'number'];
const FORBIDDEN = /productKey|firmwareUpdater|imagePath|templateExtension|\.png|\.ui"|productCode/;

test(`${RULE}: the committed profile names its writer, its sources and only derived facts`, () => {
  const text = read('src/data/midi-devices.json');
  assert.doesNotMatch(text, FORBIDDEN, `${RULE}: a forbidden field reached the profile`);
  const data = JSON.parse(text);
  assert.equal(data.derivedBy, 'scripts/midi/derive-devices.mjs');
  assert.ok(data.devices.length > 0);
  for (const d of data.devices) {
    assert.deepEqual(Object.keys(d).sort(), [...DEVICE_KEYS].sort(), `${RULE}: ${d.id} keys`);
    assert.match(d.source.descriptionSha256, /^[0-9a-f]{64}$/, `${d.id} description sha256`);
    assert.match(d.source.templateSha256, /^[0-9a-f]{64}$/, `${d.id} template sha256`);
    assert.match(d.source.description, /^Resources\/[^/]+\.json$/);
    for (const c of d.controls) {
      assert.deepEqual(Object.keys(c).sort(), [...CONTROL_KEYS].sort(), `${d.id}.${c.id}`);
      assert.ok(Number.isInteger(c.number) && c.number >= 0 && c.number <= 127);
    }
  }
});

test(`${RULE}: deriving a fixture keeps facts and drops key, updater and image fields`, () => {
  const description = parseLenient(`{
    "name": "Fixture Keys", "manufacturerId": "00206B", "familyId": "0200",
    "imagePath": "Fixture.png", "templateExtension": ".fixture", "memories_name": ["User 1",],
    "alternatives": [{ "altName": "Fixture Keys 61", "familyMemberId": "0564",
      "firmwareUpdater": { "extraParameters": { "productKey": [1, 2, 3] } } }],
    "controls": [
      { "id": "encoder1", "items": [{ "id": 1, "name": "Bank1: Encoder 1", "type": "knob" },
        { "id": 129, "name": "Bank2: Encoder 1", "type": "knob" }] },
      { "id": "pad1", "items": [{ "id": 112, "name": "Pad 1", "type": "pad" }] },
      { "id": "bank", "displayed_on_test_only": 1, "items": [{ "id": 33, "type": "x" }] },
    ],
  }`);
  const template = parseLenient(`{ "device": "Fixture Keys",
    "1_1": 1, "1_2": 65, "1_3": 074, "129_1": 1, "129_2": 3, "129_3": 35,
    "112_1": 11, "112_2": 9, "112_3": 36, "33_1": 1, "33_3": 5, }`);
  const p = deriveDevice(description, template);
  assert.doesNotMatch(JSON.stringify(p), FORBIDDEN);
  assert.deepEqual(p.identity, { manufacturer: [0, 0x20, 0x6b], family: [2, 0],
    members: [[5, 0x64]] });
  assert.deepEqual(p.names, ['Fixture Keys', 'Fixture Keys 61']);
  assert.equal(p.memories, 1, 'a memory count, never the names');
  assert.deepEqual(p.controls, [
    { id: 'encoder1', kind: 'knob', bank: 1, message: 'cc', channel: 'user', number: 74 },
    { id: 'encoder1', kind: 'knob', bank: 2, message: 'cc', channel: 4, number: 35 },
    { id: 'pad1', kind: 'pad', bank: 1, message: 'note', channel: 10, number: 36 },
  ]);
  assert.equal(channelOf(66), 'part1');
  assert.equal(channelOf(99), null);
});

test(`${RULE}: no maker file is tracked and the full decode stays in the ignored .local/`, () => {
  const files = spawnSync('git', ['ls-files'], { cwd: ROOT, encoding: 'utf8' }).stdout
    .split('\n');
  const maker = /\.(led|mbf|kle|kle3|kl3|mnl2|mnl3|mcl3|ks2fw|kspf|spu|mff|keylabmkII|keylab\w*|beatstep\w*|minilab\w*|keystep\w*|microLab|sparkLE|spark|factory|player|laboratory)$|(^|\/)(Reference_ParamNames|plugin\.prefmidi)\.xml$/i;
  const hits = files.filter((f) => maker.test(f));
  assert.deepEqual(hits, [], `${RULE}: maker files are tracked`);
  const ignored = spawnSync('git', ['check-ignore', '-q', '.local/midi/x.json'], { cwd: ROOT });
  assert.equal(ignored.status, 0, `${RULE}: .local/ is not ignored`);
});

test(`${RULE}: derive-devices.mjs --check passes (compares where installed, says so where not)`,
  () => {
    const r = spawnSync(process.execPath, ['scripts/midi/derive-devices.mjs', '--check'],
      { cwd: ROOT, encoding: 'utf8' });
    assert.equal(r.status, 0, `${RULE}: ${r.stdout}${r.stderr}`);
    const bad = spawnSync(process.execPath, ['scripts/midi/derive-devices.mjs', '--nope'],
      { cwd: ROOT, encoding: 'utf8' });
    assert.equal(bad.status, 2);
  });

test('the plug-in consensus counts a plug-in once per role and names the runner-up', () => {
  const rows = [
    { plugin: 'A', cc: 74, display: 'Cutoff' }, { plugin: 'A', cc: 74, display: 'VCF Cutoff' },
    { plugin: 'B', cc: 74, display: 'Filter Freq' }, { plugin: 'C', cc: 74, display: 'Macro 1' },
  ];
  assert.deepEqual(consensus(rows), [{ cc: 74, plugins: 3, role: 'cutoff', agree: 2,
    next: 'macro (1)' }]);
  assert.equal(paramRole('LPF Peak'), 'resonance');
  assert.equal(paramRole('EG2 Release Time'), 'release');
});

test('recognise: the owner\'s port names, and an unknown name plays', () => {
  const cases = [
    ['KeyLab mkII 61 MIDI', 'keylab-mkii', 'KeyLab mkII 61', 'play'],
    ['KeyLab mkII 61 DAW', 'keylab-mkii', 'KeyLab mkII 61', 'daw'],
    ['Arturia BeatStep Pro Arturia BeatStepPro', 'beatsteppro', 'BeatStepPro', 'play'],
    ['Arturia BeatStep Pro BeatStepProInEditor', 'beatsteppro', 'BeatStepPro', 'editor'],
    ['Arturia BeatStep', 'beatstep', 'BeatStep', 'play'],
  ];
  for (const [name, id, member, role] of cases) {
    const w = recognise(name);
    assert.equal(w.device && w.device.id, id, name);
    assert.equal(w.member, member, name);
    assert.equal(w.role, role, name);
  }
  for (const name of ['TEST STUB · MIDI input', 'Generic DAW Controller', '', null]) {
    assert.deepEqual(recognise(name), { device: null, member: null, role: 'play' });
  }
  const own = recogniserOf({ devices: [{ id: 'x', name: 'X1', names: ['X1'], controls: [] }] });
  assert.equal(own('My X1 DAW').role, 'daw');
});

test('controlOf names the KeyLab mkII\'s factory controls, bank 1 first', () => {
  const k = DEVICES.devices.find((d) => d.id === 'keylab-mkii');
  const at = (bytes) => controlOf(k, decodeMidi(bytes));
  assert.equal(at([0xb0, 74, 1]).label, 'Enkodér 1');
  assert.equal(at([0xb0, 85, 1]).label, 'Fader 9');
  assert.equal(at([0xb0, 64, 127]).label, 'Sustain pedál');
  assert.equal(at([0xb0, 1, 3]).label, 'Modulační kolečko');
  assert.equal(at([0x99, 36, 90]).label, 'Pad 1');
  assert.equal(at([0x89, 51, 0]).label, 'Pad 16');
  assert.equal(at([0x90, 36, 90]), null, 'a pad note on channel 1 is a key, not a pad');
  assert.equal(at([0xb0, 35, 1]).label, 'Enkodér 1 (banka 2)');
  assert.equal(at([0xe0, 0, 64]), null);
  assert.equal(controlOf(null, decodeMidi([0xb0, 74, 1])), null);
  assert.equal(controlLabel({ id: 'aux2', kind: 'control_pedal', bank: 1 }), 'Pedál Aux 2');
  assert.equal(controlLabel({ id: 'play', kind: 'transport_button', bank: 1 }), 'Přehrát');
});

test('decodeMidi and describeMidi read every MIDI 1.0 message kind', () => {
  const lines = [
    [[0x90, 60, 100], 'Nota C4 (60) stisk 100 · kanál 1'],
    [[0x90, 60, 0], 'Nota C4 (60) uvolnění · kanál 1'],
    [[0x81, 61, 40], 'Nota C#4 (61) uvolnění · kanál 2'],
    [[0xa9, 36, 80], 'Tlak na notě C2: 80 · kanál 10'],
    [[0xb0, 74, 64], 'CC 74 = 64 · kanál 1'],
    [[0xc3, 4], 'Program 5 · kanál 4'],
    [[0xd0, 99], 'Tlak kanálu: 99 · kanál 1'],
    [[0xe0, 0, 0x40], 'Ohyb výšky 0 · kanál 1'],
    [[0xe0, 0x7f, 0x7f], 'Ohyb výšky +8191 · kanál 1'],
    [[0xe0, 0, 0], 'Ohyb výšky -8192 · kanál 1'],
    [[0xf8], 'Takt hodin (24 na čtvrťovou notu)'], [[0xfa], 'Spuštění'], [[0xfb], 'Pokračovat'],
    [[0xfc], 'Zastavení'], [[0xf2, 4, 1], 'Pozice v písni: 132 šestnáctin'],
    [[0xf0, 0x7f, 0x7f, 6, 2, 0xf7], 'SysEx 6 B: F0 7F 7F 06 02 F7'],
    [[0x12], 'Neznámá zpráva 12'],
  ];
  for (const [bytes, text] of lines) assert.equal(describeMidi(decodeMidi(bytes)), text);
  // The one decoder (message.js) refuses a message short of its data bytes or with a bad one.
  for (const bytes of [[0x90, 60], [0xb0, 74, 128], [0xc0], [0x90, 0x80, 1], [], null]) {
    assert.equal(decodeMidi(bytes).kind, 'unknown', JSON.stringify(bytes));
  }
  assert.equal(describeMidi(decodeMidi([0xb0, 74, 9]), { label: 'Enkodér 1' }),
    'Enkodér 1 · CC 74 = 9 · kanál 1');
});

test('the monitor keeps the newest rows and publishes at most once per flush interval', () => {
  const published = [];
  const timers = [];
  const m = createMidiMonitor({ publish: (r) => published.push(r),
    setTimer: (fn, ms) => { timers.push({ fn, ms }); return timers.length; },
    clearTimer: () => {} });
  m.add({ text: 'a' });
  assert.equal(published.length, 1, 'the first message is shown at once');
  for (let i = 0; i < 30; i += 1) m.add({ text: `x${i}` });
  assert.equal(published.length, 1, 'a burst waits for the flush');
  assert.equal(timers.length, 1, 'one timer for the whole burst');
  assert.ok(timers[0].ms > 0 && timers[0].ms <= MONITOR_FLUSH_MS);
  timers[0].fn();
  const last = published.at(-1);
  assert.equal(last.length, MONITOR_ROWS);
  assert.equal(last[0].text, 'x29', 'newest first, the last message not lost');
  assert.equal(last[0].n, 31);
  m.clear();
  assert.deepEqual(published.at(-1), []);
  assert.deepEqual(m.rows(), []);
});

/** midi/ui.js with a stub navigator: the access, its inputs and their messages. */
function rig() {
  const ports = new Map();
  const port = (name) => {
    const listeners = new Set();
    const p = { name, state: 'connected', type: 'input', open: () => Promise.resolve(),
      addEventListener: (t, fn) => { if (t === 'midimessage') listeners.add(fn); },
      removeEventListener: (t, fn) => listeners.delete(fn),
      send: (bytes) => { for (const fn of listeners) fn({ data: Uint8Array.from(bytes) }); } };
    ports.set(name, p);
    return p;
  };
  ['KeyLab mkII 61 MIDI', 'KeyLab mkII 61 DAW', 'Somebody Else'].forEach(port);
  const access = { inputs: { forEach: (fn) => ports.forEach((p) => fn(p)) },
    addEventListener: () => {}, removeEventListener: () => {} };
  const notes = [];
  const engine = { noteOn: (o) => { notes.push(o); return { ok: true, id: notes.length }; },
    noteOff: () => true, notesOff: () => 0 };
  const win = { navigator: { requestMIDIAccess: () => Promise.resolve(access),
    permissions: { query: () => Promise.resolve({ state: 'granted', addEventListener() {} }) } },
  isSecureContext: true, location: { protocol: 'https:', host: 'x' }, addEventListener() {} };
  const ui = createMidiUi({ win, engine });
  Object.assign(ui, { a4: 440, waveform: 'sine', attack: 5, release: 50, safetyLimit: 2,
    continuousAllowed: false, workspace: 'playground', notify() {} });
  return { ui, ports, notes };
}

test('midi/ui.js: a DAW port sounds no note, every message reaches the monitor', async () => {
  const { ui, ports, notes } = rig();
  await ui.midiInit();
  ui.midiConnect();
  await new Promise((r) => setImmediate(r));
  assert.equal(ui.midiState, 'connected');
  assert.deepEqual(ui.midiInputs.map((d) => [d.device, d.role]),
    [['KeyLab mkII', 'play'], ['KeyLab mkII', 'daw'], ['', 'play']]);
  ports.get('KeyLab mkII 61 DAW').send([0x90, 94, 127]); // a Play button, not a note
  assert.equal(notes.length, 0, 'the DAW port sounded a note');
  ports.get('KeyLab mkII 61 MIDI').send([0x90, 60, 100]);
  ports.get('Somebody Else').send([0x90, 62, 100]);
  assert.equal(notes.length, 2, 'the play port and the unknown input sound');
  ui.midiLogClear();
  ports.get('KeyLab mkII 61 MIDI').send([0xb0, 74, 64]);
  assert.equal(ui.midiLog[0].text, 'Enkodér 1 · CC 74 = 64 · kanál 1');
  assert.equal(ui.midiLog[0].input, 'KeyLab mkII 61');
  assert.equal(inputRow('KeyLab mkII 61 DAW').roleText, 'ovládání DAW');
});

test('midi/ui.js: the Synth\'s CC status line names the physical control', () => {
  const { ui } = rig();
  ui.workspace = 'synth';
  ui.synth = { status: '' };
  ui.synthCc = () => ({ cid: 'lpf.frequency', text: 'CC 74 → LPF Cutoff: 1.2 kHz' });
  ui.midiControl({ controller: 74, value: 64 }, { label: 'Enkodér 1' });
  assert.equal(ui.synth.status, 'Enkodér 1 · CC 74 → LPF Cutoff: 1.2 kHz');
});
