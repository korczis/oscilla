// V509: a known controller's map (src/js/midi/device-map.js), laid out from its derived profile.
//
// What it proves:
//   - every control of every bundled profile is in the map of its bank exactly once, in the
//     profile's own groups, and no control is in the map that the profile lacks;
//   - what a control does comes from the decoder and the module that acts (notes.js
//     parseMidiMessage, synth/midi-cc.js ccControl): a pad plays notes, CC 64 holds them, CC 74
//     names the Synth control of its slot, an unassigned CC acts on nothing; a different control
//     name from ccControl changes the map's name with it (one source, never typed in the map);
//   - litKey finds the control that sent a decoded message, bank 1 first.
//   node --test tests/unit/midi/device-map.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';
import { actsOf, controlKey, deviceMap, litKey } from '../../../src/js/midi/device-map.js';
import { DEVICES, kindLabel } from '../../../src/js/midi/devices.js';
import { decodeMidi } from '../../../src/js/midi/message.js';
import { ccControl } from '../../../src/js/synth/midi-cc.js';
import SEMI_MONO from '../../../src/js/synth/panels/semi-mono.js';

const keylab = DEVICES.devices.find((d) => d.id === 'keylab-mkii');

// The Synth panel's controls as the panel hands them to ccEdit: every face control is in the
// document (a fresh panel), so a slot names its knob.
const panelDeps = (label = (c) => c.label) => ({
  faceOf: SEMI_MONO.faceOf, played: () => 'keys',
  controlOf: (cid) => {
    const [mid, key] = cid.split('.');
    const c = SEMI_MONO.faceOf(mid).find((x) => x.key === key);
    return c ? { mid, node: { id: mid }, c: { ...c, label: label(c) } } : null;
  },
});

test('every control of every profile is in its bank\'s map once, in the profile\'s groups', () => {
  for (const device of DEVICES.devices) {
    const seen = new Map();
    const map = deviceMap(device);
    for (const bank of map.banks) {
      for (const g of deviceMap(device, { bank }).groups) {
        assert.equal(g.label, kindLabel(g.kind), `${device.id}: ${g.kind}`);
        for (const c of g.controls) {
          assert.equal(c.kind, g.kind);
          assert.equal(seen.has(c.key), false, `${device.id}: ${c.key} once`);
          seen.set(c.key, c);
        }
      }
    }
    const keys = new Set((device.controls || []).map(controlKey));
    assert.deepEqual([...seen.keys()].sort(), [...keys].sort(), `${device.id}: the profile's own`);
  }
});

test('a bank the device lacks shows its first bank', () => {
  const map = deviceMap(keylab, { bank: 99 });
  assert.deepEqual(map.banks, [1, 2, 3]);
  assert.equal(map.bank, 1);
});

test('what a control does is the decoder\'s and the acting module\'s, never the map\'s', () => {
  const acts = actsOf({ ccControl: (cc) => ccControl(cc, panelDeps()) });
  const find = (bank, id) => deviceMap(keylab, { bank, acts }).groups
    .flatMap((g) => g.controls).find((c) => c.id === id);
  assert.equal(find(1, 'pad1').does.kind, 'notes');
  assert.equal(find(1, 'encoder1').number, 74);
  assert.deepEqual(find(1, 'encoder1').does, { kind: 'synth', text: 'v Synthu: LPF Cutoff' });
  const name = ccControl(74, panelDeps()).name;
  assert.equal(find(1, 'encoder1').does.text, `v Synthu: ${name}`, 'ccControl\'s own name');
  assert.equal(find(2, 'encoder1').number, 35);
  assert.deepEqual(find(2, 'encoder1').does, { kind: 'none', text: 'nic neovládá' },
    'CC 35 is in no slot');
  // The same profile, its CC 74 control renamed by the panel: the map's name follows.
  const renamed = actsOf({ ccControl: (cc) => ccControl(cc, panelDeps((c) => `${c.label}*`)) });
  const enc = deviceMap(keylab, { acts: renamed }).groups.flatMap((g) => g.controls)
    .find((c) => c.id === 'encoder1');
  assert.equal(enc.does.text, 'v Synthu: LPF Cutoff*');
});

test('a control\'s event is decoded as the page decodes it: sustain, panic, notes', () => {
  const acts = actsOf({ ccControl: () => null });
  assert.equal(acts({ message: 'cc', number: 64 }).kind, 'sustain');
  assert.equal(acts({ message: 'cc-switch', number: 123 }).kind, 'panic');
  assert.equal(acts({ message: 'cc', number: 120 }).kind, 'panic');
  assert.equal(acts({ message: 'note', number: 36 }).kind, 'notes');
  assert.equal(acts({ message: 'cc', number: 74 }).kind, 'none', 'no panel: nothing');
  assert.equal(acts({ message: 'sysex', number: 0 }).kind, 'none');
});

test('litKey names the control that sent a message, bank 1 first', () => {
  assert.equal(litKey(keylab, decodeMidi([0xb0, 74, 64])), 'encoder1@1');
  // Pad 1 sends note 36 on channel 10 in the factory setup: on channel 10 it is the pad, on
  // channel 1 the same note is a key of the keybed, no control of the profile.
  const pad = keylab.controls.find((c) => c.id === 'pad1' && c.bank === 1);
  assert.deepEqual([pad.message, pad.channel, pad.number], ['note', 10, 36]);
  assert.equal(litKey(keylab, decodeMidi([0x90 | 9, 36, 100])), 'pad1@1');
  assert.equal(litKey(keylab, decodeMidi([0x90, 36, 100])), null, 'a key, not the pad');
  assert.equal(litKey(keylab, decodeMidi([0xb0, 3, 1])), null, 'CC 3: no control sends it');
  assert.equal(litKey(null, decodeMidi([0xb0, 74, 1])), null);
});

test('the MIDI section\'s maps: the panel names a CC from its declaration, per device and bank', async () => {
  const { PANEL_ACTS, createDeviceMaps } = await import('../../../src/js/midi/device-map-ui.js');
  assert.deepEqual(PANEL_ACTS({ message: 'cc', number: 74 }),
    { kind: 'synth', text: `v Synthu: ${ccControl(74, panelDeps()).name}` });
  const maps = createDeviceMaps({ devices: DEVICES.devices });
  const one = maps.map('keylab-mkii');
  assert.equal(one.bank, 1);
  assert.equal(maps.map('keylab-mkii'), one, 'cached per device and bank');
  const two = maps.map('keylab-mkii', 2);
  assert.equal(two.bank, 2);
  assert.notEqual(two, one);
  assert.deepEqual(maps.map('no-such-device').groups, []);
  assert.equal(maps.litKey(keylab, decodeMidi([0xb0, 74, 1])), 'encoder1@1');
  assert.equal(maps.litKey(null, decodeMidi([0xb0, 74, 1])), null);
});

test('midi/ui.js lights the latest message\'s control: event 1 at once, the last of a burst, none for a key', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  const { createMidiUi } = await import('../../../src/js/midi/ui.js');
  const { MONITOR_FLUSH_MS } = await import('../../../src/js/midi/monitor.js');
  const ls = new Set();
  const port = { name: 'KeyLab mkII 61 MIDI', state: 'connected', type: 'input',
    open: () => Promise.resolve(),
    addEventListener: (k, fn) => { if (k === 'midimessage') ls.add(fn); },
    removeEventListener: (k, fn) => ls.delete(fn),
    send: (b) => { for (const fn of ls) fn({ data: Uint8Array.from(b), timeStamp: Date.now() }); } };
  const access = { inputs: { forEach: (fn) => fn(port) }, addEventListener() {},
    removeEventListener() {} };
  const win = { navigator: { requestMIDIAccess: () => Promise.resolve(access),
    permissions: { query: () => Promise.resolve({ state: 'granted', addEventListener() {} }) } },
  isSecureContext: true, location: { protocol: 'https:', host: 'x' }, addEventListener() {} };
  const engine = { noteOn: () => ({ ok: true }), noteOff: () => true, notesOff: () => 0 };
  const ui = createMidiUi({ win, engine, now: () => Date.now() });
  Object.assign(ui, { workspace: 'measure', notify() {}, a4: 440, waveform: 'sine', attack: 10,
    release: 30, safetyLimit: 2, continuousAllowed: false });
  await ui.midiInit();
  ui.midiConnect();
  await t.mock.timers.runAll();
  await new Promise((r) => setImmediate(r));
  port.send([0xb0, 74, 10]); // event 1: shown at once (the monitor's leading edge)
  assert.equal(ui.midiLit, 'encoder1@1');
  t.mock.timers.tick(MONITOR_FLUSH_MS);
  // A burst 1 ms apart over three controls: the last one is lit after the redraw.
  const fader1 = keylab.controls.find((c) => c.id === 'fader1' && c.bank === 1);
  const enc2 = keylab.controls.find((c) => c.id === 'encoder2' && c.bank === 1);
  port.send([0xb0, 74, 20]);
  t.mock.timers.tick(1);
  port.send([0xb0, enc2.number, 30]);
  t.mock.timers.tick(1);
  port.send([0xb0, fader1.number, 40]);
  t.mock.timers.tick(MONITOR_FLUSH_MS);
  assert.equal(ui.midiLit, 'fader1@1', 'the last of the burst');
  port.send([0x90, 60, 100]); // a key of the keybed: no control of the profile
  t.mock.timers.tick(MONITOR_FLUSH_MS);
  assert.equal(ui.midiLit, null, 'a key lights nothing and clears the last control');
});
