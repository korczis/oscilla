// C018 (finding persist-3): a custom preset, a History entry and the config link restore the
// lab settings they claim. On the merge base each stored only url-state.js serializeConfig (the
// V1 instrument), so the Filter, Envelope (ADSR), Additive and Phase & Stereo state was lost on
// all three while the link toast said "The link restores these settings". The V1 cfg, hash and
// preset schema stay as they are (ADR 0014, ADR 0045); the labs travel in an optional `labs`
// sibling and a `lab=` link key, validated by the config file's parseLabSections and applied
// through the one path the config import uses (ui/lab-state.js applyLabSections).
//   node --test tests/unit/lab-state-round-trip.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';
import { createInstrument } from '../../src/js/core/instrument.js';
import * as storage from '../../src/js/core/storage.js';
import { STORAGE_KEYS } from '../../src/js/core/constants.js';
import { serializeHash } from '../../src/js/core/url-state.js';
import { defaultInstrumentState, defaultEditorFields } from '../../src/js/core/config.js';
import {
  applyLabRecord, applyLabSections, labSectionsText, snapshotLabs,
} from '../../src/js/ui/lab-state.js';
import {
  buildConfigExport, parseConfigImport, parseLabSections,
} from '../../src/js/ui/config-file.js';
import {
  LAB_HASH_KEY, decodeLabParam, encodeLabParam, withoutLabParam,
} from '../../src/js/core/url-state-labs.js';
import {
  HASH_DOMAINS, configLinkHash, hashAfterRefusal, hashForWorkspace,
} from '../../src/js/ui/navigation.js';

/** Labs with the public shape main.js mounts (config / adsr / enabled getters, update()). */
function fakeLabs() {
  const st = {
    filter: { enabled: false, type: 'lowpass', frequency: 2500, Q: 0.7071, gain: 0 },
    env: { enabled: false, adsr: { a: 0.01, d: 0.1, s: 0.7, r: 0.3 } },
    add: { enabled: false, partials: [{ n: 1, gain: 1, phase: 0 }, { n: 2, gain: 0.5, phase: 0 }] },
    phase: { freqA: 440, freqB: 442, phaseDeg: 0, pan: 0, route: 'mono' },
  };
  return {
    st,
    filter: { get config() { return { ...st.filter }; },
      update(s) { Object.assign(st.filter, s); } },
    envelope: { get enabled() { return st.env.enabled; }, get adsr() { return { ...st.env.adsr }; },
      update(s) {
        if (s.adsr) Object.assign(st.env.adsr, s.adsr);
        if (s.enabled != null) st.env.enabled = !!s.enabled;
      } },
    additive: { get enabled() { return st.add.enabled; },
      get partials() { return st.add.partials.map((p) => ({ ...p })); },
      update(s) {
        if (s.partials) st.add.partials = s.partials.map((p) => ({ ...p }));
        if (s.enabled != null) st.add.enabled = !!s.enabled;
      } },
    phase: { get config() { return { ...st.phase }; },
      update(s) { Object.assign(st.phase, s); } },
  };
}

function memoryStore() {
  const m = new Map();
  return { get: (k) => (m.has(k) ? m.get(k) : null),
    set: (k, v) => { m.set(k, String(v)); return true; },
    remove: (k) => { m.delete(k); return true; }, available: () => true };
}

/**
 * The V1 instrument with the V2 lab members as ui/workbench.js composes them over main.js's
 * services (labSnapshot = snapshotLabs, applyLabSnapshot = applyLabRecord): the hooks the
 * instrument calls are the ones under test, the labs are fakes.
 */
function instrumentWithLabs(labs, stores) {
  const inst = createInstrument({ engine: null, localStore: stores.local,
    sessionStore: stores.session, timers: { setTimeout: () => 0, clearTimeout() {},
      setInterval: () => 0, clearInterval() {} } });
  const cmp = {};
  Object.defineProperties(cmp, Object.getOwnPropertyDescriptors(inst));
  Object.defineProperties(cmp, Object.getOwnPropertyDescriptors({
    labSnapshot() { return snapshotLabs(labs); },
    applyLabSnapshot(record) { return applyLabRecord(labs, record, this.dual); },
    labsRestoredNote(applied) { return `${labSectionsText(applied)} settings restored too.`; },
    labsSavedNote() { return 'It holds the lab settings.'; },
  }));
  cmp.openModal = () => {};
  cmp.closeModal = () => {};
  return cmp;
}

const SAVED = { filter: { enabled: true, frequency: 300, Q: 4 },
  env: { enabled: true, a: 0.5 }, additive: true, pan: 0.5 };
const labView = (labs) => ({
  filter: { enabled: labs.st.filter.enabled, frequency: labs.st.filter.frequency,
    Q: labs.st.filter.Q },
  env: { enabled: labs.st.env.enabled, a: labs.st.env.adsr.a },
  additive: labs.st.add.enabled, pan: labs.st.phase.pan,
});
function setSaved(labs) {
  labs.filter.update({ enabled: true, frequency: 300, Q: 4 });
  labs.envelope.update({ enabled: true, adsr: { a: 0.5, d: 0.1, s: 0.5, r: 0.3 } });
  labs.additive.update({ enabled: true });
  labs.phase.update({ pan: 0.5 });
}
function setOther(labs) {
  labs.filter.update({ enabled: false, frequency: 5000, Q: 0.707 });
  labs.envelope.update({ enabled: false, adsr: { a: 0.01 } });
  labs.additive.update({ enabled: false });
  labs.phase.update({ pan: 0 });
}

test('a custom preset saved with the labs restores them after they were changed, '
  + 'also after a reload from storage', () => {
  const stores = { local: memoryStore(), session: memoryStore() };
  const labs = fakeLabs();
  const app = instrumentWithLabs(labs, stores);
  setSaved(labs);
  app.saveName = 'lab state';
  app.savePreset();
  assert.ok(app.customPresets[0].labs, 'the preset record carries the labs sibling');
  assert.deepEqual(Object.keys(app.customPresets[0].cfg).sort(),
    Object.keys(app.serializeConfig()).sort(), 'cfg is the V1 serializeConfig, unchanged');
  assert.equal(app.customPresets[0].version, 1, 'preset schema v1');
  // A reload: the presets come back through migratePreset.
  const reloaded = instrumentWithLabs(labs, stores);
  reloaded.customPresets = reloaded.loadCustomPresets();
  setOther(labs);
  assert.notDeepEqual(labView(labs), SAVED);
  const view = reloaded.presetsFor('custom')[0];
  reloaded.loadPreset(view);
  assert.deepEqual(labView(labs), SAVED, 'the preset restores Filter, Envelope, Additive, pan');
  const toast = reloaded.alerts.at(-1);
  assert.equal(toast.level, 'success');
  assert.match(toast.message, /Filter, Envelope, Additive and Phase & Stereo settings restored/);
});

test('a History entry snapshots the labs at play time and the recall restores them', () => {
  const stores = { local: memoryStore(), session: memoryStore() };
  const labs = fakeLabs();
  const app = instrumentWithLabs(labs, stores);
  setSaved(labs);
  app.addHistory({ type: 'single', wave: 'sine', kind: 'finite', dur: 0.5, freqs: [440],
    label: '440 Hz sine' });
  setOther(labs);
  const stored = JSON.parse(stores.session.get(STORAGE_KEYS.history));
  assert.ok(stored[0].labs, 'the stored entry carries the labs');
  const again = instrumentWithLabs(labs, stores);
  again.history = again.loadHistory();
  again.recallHistory(again.history[0]);
  assert.deepEqual(labView(labs), SAVED);
  assert.match(again.alerts.at(-1).message, /Filter, Envelope, Additive and Phase & Stereo/);
});

test('two plays of the same instrument with different labs are two History entries', () => {
  const plan = { type: 'single', wave: 'sine', kind: 'finite', dur: 0.5, freqs: [440], label: 'x' };
  const cfg = { v: 1, frequency: 440 };
  const a = storage.historyEntry(plan, { source: 'single', pattern: 'tone' }, cfg,
    { filter: { enabled: true } });
  const b = storage.historyEntry(plan, { source: 'single', pattern: 'tone' }, cfg,
    { filter: { enabled: false } });
  assert.equal(storage.pushHistory([a], b).length, 2);
  const c = storage.historyEntry(plan, { source: 'single', pattern: 'tone' }, cfg);
  assert.equal(storage.pushHistory([c], { ...c }).length, 1, 'V1: a repeat replaces');
});

test('a v1 record without labs loads as on the merge base: no labs key, labs untouched', () => {
  const v1 = { version: 1, id: 'k', name: 'Kept', created: 1,
    cfg: { source: 'single', pattern: 'tone', frequency: 880, waveform: 'sine' } };
  const rec = storage.migratePreset(v1);
  assert.equal('labs' in rec, false);
  assert.equal('labs' in storage.presetRecord({ id: 'a', name: 'a', created: 1 }, v1.cfg), false);
  assert.equal('labs' in storage.presetRecord({ id: 'a', name: 'a', created: 1 }, v1.cfg, null),
    false);
  assert.equal('labs' in storage.historyEntry({ type: 'single', wave: 'sine', kind: 'finite',
    dur: 1, freqs: [1], label: 'l' }, { source: 'single', pattern: 'tone' }, {}), false);
  const stores = { local: memoryStore(), session: memoryStore() };
  const labs = fakeLabs();
  setSaved(labs);
  const app = instrumentWithLabs(labs, stores);
  app.applyPreset({ ...rec, cfg: rec.cfg });
  assert.deepEqual(labView(labs), SAVED, 'a record without labs leaves the labs as they are');
  assert.equal(app.alerts.at(-1).message, 'Press and hold HOLD TO PLAY.', 'V1 message');
  // And the V1 instrument alone (no labs layer) stores no labs.
  const plain = createInstrument({ engine: null, localStore: memoryStore(),
    sessionStore: memoryStore(), timers: { setTimeout: () => 0, clearTimeout() {} } });
  plain.closeModal = () => {};
  plain.saveName = 'plain';
  plain.savePreset();
  assert.equal('labs' in plain.customPresets[0], false);
  assert.equal(plain.alerts.at(-1).message, '“plain” is in Presets → Custom.');
});

test('stored lab sections are validated on the config file path; a malformed one is refused, '
  + 'named, and the rest applied', () => {
  const labs = fakeLabs();
  const r = applyLabRecord(labs, { filter: { type: 'nope', frequency: 300, Q: 4 },
    envelope: { adsr: { enabled: true, a: 0.5, d: 0.1, s: 0.5, r: 0.3 } } }, null);
  assert.deepEqual(r.applied, ['envelope']);
  assert.equal(r.issues, 1);
  assert.match(r.warnings[0], /^filter ignored/);
  assert.equal(labs.st.filter.type, 'lowpass', 'the refused filter is not touched');
  // The file's sections and a snapshot's are the same shape, read by the same parser.
  setSaved(labs);
  const snap = snapshotLabs(labs);
  const doc = buildConfigExport({ instrument: { source: 'single', pattern: 'tone' },
    envelope: { enabled: true, ...labs.envelope.adsr }, filter: labs.filter.config,
    additive: { enabled: true, partials: labs.additive.partials }, phaseStereo: snap.phaseStereo });
  const fromFile = parseConfigImport(doc);
  const fromSnap = parseLabSections(snap);
  for (const k of ['envelope', 'filter', 'additive', 'phaseStereo']) {
    assert.deepEqual(fromSnap[k], fromFile[k], k);
  }
  assert.deepEqual(applyLabSections(fakeLabs(), fromSnap, { a: { freq: 300 }, b: { freq: 303 },
    stereo: true }), ['envelope', 'filter', 'additive', 'phaseStereo']);
  assert.equal(snapshotLabs({}), null, 'no lab mounted: nothing to keep');
});

test('the config link carries `lab=` beside the V1 keys; it opens and is refused by name', () => {
  const labs = fakeLabs();
  setSaved(labs);
  const lab = encodeLabParam(snapshotLabs(labs));
  const instrument = serializeHash({ ...defaultInstrumentState(), ...defaultEditorFields() },
    'playground');
  const out = configLinkHash(`#v=1&f=440&${LAB_HASH_KEY}=stale&mr=R`, instrument, 'playground',
    lab);
  const q = new URLSearchParams(out);
  assert.equal(q.getAll(LAB_HASH_KEY).length, 1, 'the stale lab key is replaced, not doubled');
  assert.equal(q.get('mr'), 'R');
  assert.equal(new URLSearchParams(withoutLabParam(out)).toString(),
    new URLSearchParams(configLinkHash('#mr=R', instrument, 'playground')).toString(),
    'the V1 instrument keys are exactly serializeHash');
  const d = decodeLabParam(`#${out}`);
  assert.equal(d.ok, true);
  const fresh = fakeLabs();
  const r = applyLabRecord(fresh, d.sections, null);
  assert.equal(r.issues, 0);
  assert.deepEqual(labView(fresh), SAVED, 'the link restores the labs on a fresh page');
  assert.equal(decodeLabParam('#v=1&f=440'), null, 'no key: not this domain');
  assert.equal(decodeLabParam('#lab=%%%').ok, false);
  assert.equal(decodeLabParam(`#lab=${Buffer.from('[1]').toString('base64url')}`).ok, false);
  assert.equal(decodeLabParam('#lab=a&lab=b').ok, false);
  // A refused lab value leaves the address (Back / reload never bring it back); others stay.
  const after = new URLSearchParams(hashAfterRefusal('lab=bad&v=1&f=440', { labs: false },
    'playground'));
  assert.equal(after.get(LAB_HASH_KEY), null);
  assert.equal(after.get('f'), '440');
  assert.equal(new URLSearchParams(hashForWorkspace(out, 'measure')).get(LAB_HASH_KEY), lab,
    'a workspace switch keeps it, like the instrument keys');
  assert.ok(HASH_DOMAINS.indexOf('labs') === HASH_DOMAINS.indexOf('instrument') + 1,
    'the labs domain is dispatched right after the instrument');
  assert.ok(out.length < 1500, `a compact link (${out.length} characters)`);
});
