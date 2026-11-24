// The session draft (plan U138, journey J9): a reload restores the instrument, the lab settings,
// the Synth patch and the sequence through the codecs that already serialise them; a deep link's
// state wins; nothing plays; the draft is bounded. src/js/core/storage.js keeps it,
// src/js/ui/session-draft.js decides and applies it. The browser half is journeys.cjs
// journey-5-persist:reload-draft and :reload-link-wins.
//   node --test tests/unit/session-draft.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  SESSION_DRAFT_KEY, SESSION_DRAFT_MAX, checkSessionDraft, clearSessionDraft, loadSessionDraft,
  persistSessionDraft, safeStorage,
} from '../../src/js/core/storage.js';
import {
  DRAFT_DOMAINS, PRISTINE_SYNTH, createSessionDraftUi, draftDomains, draftNoticeText, domainText,
  hashCarries, navigationType, planRestore,
} from '../../src/js/ui/session-draft.js';
import { restoreFromHash, serializeHash } from '../../src/js/core/url-state.js';
import { encodeLabParam } from '../../src/js/core/url-state-labs.js';
import { decodeSynthLink, encodeSynthLink } from '../../src/js/core/url-state-synth.js';
import { buildLabSections, parseLabSections } from '../../src/js/ui/config-file.js';
import {
  addBlock, createSequence, parseSequence, serializeSequence, setWaveform,
} from '../../src/js/sequencer/model.js';
import { SYNTH_PANEL } from '../../src/js/synth/ui.js';
import { PRESETS } from '../../src/js/synth/presets.js';

// ------------------------------------------------------------------ fakes
function memoryStore() {
  const m = new Map();
  const backing = {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { m.set(k, String(v)); },
    removeItem: (k) => { m.delete(k); },
  };
  return Object.assign(safeStorage('sessionStorage', () => backing), { map: m });
}

function fakeWin({ type = 'reload', hash = '' } = {}) {
  const listeners = {};
  const target = () => ({
    addEventListener: (t, fn) => { (listeners[t] = listeners[t] || []).push(fn); },
  });
  const doc = { ...target(), hidden: false };
  const win = { ...target(), document: doc, location: { hash },
    performance: { getEntriesByType: (k) => (k === 'navigation' ? [{ type }] : []) },
    timers: [],
    setTimeout(fn) { this.timers.push(fn); return this.timers.length; },
    clearTimeout() {},
    fire: (t) => (listeners[t] || []).forEach((fn) => fn({ type: t })) };
  doc.addEventListener = (t, fn) => { (listeners[t] = listeners[t] || []).push(fn); };
  return win;
}

const DEFAULT_FILTER = { enabled: false, type: 'lowpass', frequency: 1000, Q: 0.707, gain: 0 };

/** A page as the draft sees it: the real instrument state and codecs, a filter lab, the Synth
 *  link, the sequence editor, and a record of every call that could make sound. */
function fakePage() {
  const s = restoreFromHash(null, '').state;
  const sound = [];
  const page = {
    ...s,
    mode: 'playground',
    sampleRate: null,
    continuousAllowed: false,
    playing: false,
    notices: [],
    filter: { ...DEFAULT_FILTER },
    synthLink: null, // the Synth link of the panel; null: no panel
    synth: { presets: PRESETS.map((p) => ({ id: p.id, title: p.title })) },
    serializeHash() { return serializeHash(this, this.mode); },
    notify(level, title, message) { this.notices.push({ level, title, message }); },
    labLinkParam() { return encodeLabParam(buildLabSections({ filter: this.filter })); },
    applyLabSnapshot(sections) {
      const p = parseLabSections(sections);
      if (p.filter) this.filter = { ...p.filter };
      return { applied: p.filter ? ['filter'] : [], issues: 0 };
    },
    synthLinkHash() { return this.synthLink; },
    synthApplyLinkHash(hash, quiet) {
      const r = decodeSynthLink(hash, SYNTH_PANEL, PRESETS);
      if (!r || !r.ok) return false;
      this.synthLink = encodeSynthLink(r.link);
      this.synthQuiet = quiet;
      return true;
    },
    ensureAudio() { sound.push('ensureAudio'); },
    play() { sound.push('play'); },
  };
  const seq = { editor: { model: createSequence({}), changes: [],
    load(json) { this.model = parseSequence(json).model; },
    setWaveform(w) { this.model = setWaveform(this.model, w); },
    onChange(fn) { this.changes.push(fn); } }, render() {} };
  return { page, seq, sound };
}

/** Boot one page on `win` and `store`: the part composed onto the fake page. */
function boot({ win, store, page, seq }) {
  const part = createSessionDraftUi({ sequencer: () => seq, store, win });
  Object.defineProperties(page, Object.getOwnPropertyDescriptors(part));
  page.draft = { ...part.draft };
  const restored = page.draftBoot();
  return { restored };
}

/** The J9 edit: a saw at 220 Hz, the filter at 400 Hz, a Synth preset, one more block. */
function edit({ page, seq }) {
  page.waveform = 'sawtooth';
  page.frequency = 220;
  page.filter = { ...page.filter, enabled: true, frequency: 400 };
  page.synthLink = encodeSynthLink({ preset: 'bass' });
  seq.editor.model = addBlock(seq.editor.model, 'tone');
}

/** Edit and save one page, then reload: a second page on the same tab's store. */
function editThenReload({ type = 'reload', hash = '', reloadHash = hash } = {}) {
  const store = memoryStore();
  const a = fakePage();
  boot({ win: fakeWin({ type: 'navigate', hash }), store, ...a });
  edit(a);
  a.page.draftSave();
  const b = fakePage();
  const r = boot({ win: fakeWin({ type, hash: reloadHash }), store, ...b });
  return { store, a, b, ...r };
}

// ------------------------------------------------------------------ storage
test('the draft round-trips through sessionStorage and is checked on the way in', () => {
  const store = memoryStore();
  const domains = { instrument: 'v=1&f=220', labs: 'abc', sequence: { blocks: [] } };
  const r = persistSessionDraft(store, { at: 5, hash: '#m=filter', domains });
  assert.deepEqual(r.kept.sort(), Object.keys(domains).sort());
  assert.deepEqual(loadSessionDraft(store), { v: 1, at: 5, hash: '#m=filter', domains });
  store.set(SESSION_DRAFT_KEY, '{not json');
  assert.equal(loadSessionDraft(store), null, 'unreadable JSON is no draft');
  assert.equal(checkSessionDraft({ v: 2, at: 1, hash: '', domains: {} }), null, 'newer version');
  assert.deepEqual(checkSessionDraft({ v: 1, at: 1, hash: '', domains: { instrument: 3,
    playing: true, measure: { state: 'MEASURING' }, sequence: [1] } }).domains, {},
  'only the four domains in their codec shapes are read; playing and a measurement never');
  assert.ok(clearSessionDraft(store));
  assert.equal(store.get(SESSION_DRAFT_KEY), null);
});

test('size bound: the largest domain is dropped until the draft fits; none left, no draft', () => {
  const store = memoryStore();
  const big = { blocks: [{ text: 'x'.repeat(SESSION_DRAFT_MAX) }] };
  const r = persistSessionDraft(store, { at: 1, hash: '', domains: { instrument: 'v=1', sequence:
    big } });
  assert.deepEqual(r.dropped, ['sequence']);
  assert.deepEqual(r.kept, ['instrument']);
  assert.ok(store.get(SESSION_DRAFT_KEY).length <= SESSION_DRAFT_MAX);
  const all = persistSessionDraft(store, { at: 1, hash: '#'.repeat(SESSION_DRAFT_MAX),
    domains: { instrument: 'v=1' } });
  assert.deepEqual(all.kept, []);
  assert.equal(store.get(SESSION_DRAFT_KEY), null, 'a draft that cannot fit removes the old one');
});

// ------------------------------------------------------------------ decisions
test('navigationType reads Navigation Timing, then the legacy field, else navigate', () => {
  assert.equal(navigationType(fakeWin({ type: 'reload' })), 'reload');
  assert.equal(navigationType({ performance: { getEntriesByType: () => [],
    navigation: { type: 2 } } }), 'back_forward');
  assert.equal(navigationType({}), 'navigate');
});

test('hashCarries names the domains a link holds; never the sequence', () => {
  assert.deepEqual([...hashCarries('#m=playground&v=1&f=440')], ['instrument']);
  assert.deepEqual([...hashCarries('#m=filter&lab=e30')], ['labs']);
  assert.deepEqual([...hashCarries('#m=synth&yp=bass')], ['synth']);
  assert.deepEqual([...hashCarries('#m=synth')], [], 'the route alone carries no patch');
  assert.deepEqual([...hashCarries('#m=sequencer')], []);
});

test('planRestore: reload restores what differs; a link opened fresh restores nothing', () => {
  const draft = { hash: '#m=filter', domains: { instrument: 'v=1&f=220', labs: 'L1',
    sequence: { blocks: [1], waveform: 'sine' } } };
  const current = { instrument: 'v=1&f=440', labs: 'L1', synth: null,
    sequence: { blocks: [1], waveform: 'sawtooth' } };
  assert.deepEqual(planRestore({ draft, navType: 'reload', hash: '#m=filter', current }),
    ['instrument'], 'equal labs, and a sequence that differs only by waveform, are not restored');
  assert.deepEqual(planRestore({ draft, navType: 'back_forward', hash: '', current }),
    ['instrument']);
  for (const navType of ['navigate', 'prerender', undefined]) {
    assert.deepEqual(planRestore({ draft, navType, hash: '', current }), [], String(navType));
  }
  assert.deepEqual(planRestore({ draft: null, navType: 'reload', hash: '', current }), []);
});

test('mutation: a deep link wins over the draft unless the draft was saved under it', () => {
  const draft = { hash: '#m=playground', domains: { instrument: 'v=1&f=220', labs: 'L2' } };
  const current = { instrument: 'v=1&f=880', labs: 'L1' };
  const link = '#m=playground&v=1&f=880';
  assert.deepEqual(planRestore({ draft, navType: 'reload', hash: link, current }), ['labs'],
    'the address carries the instrument: its link wins, the labs come from the draft');
  // the same draft saved under that address is the later edit of it: it wins
  assert.deepEqual(planRestore({ draft: { ...draft, hash: link }, navType: 'reload', hash: link,
    current }), ['instrument', 'labs']);
});

test('draftDomains keeps only what differs from what the page opened with', () => {
  const base = { instrument: 'a', labs: 'b', synth: null, sequence: { blocks: [] } };
  assert.deepEqual(draftDomains(base, base), {});
  assert.deepEqual(Object.keys(draftDomains({ ...base, synth: 'm=synth&yp=bass' }, base)),
    ['synth']);
});

test('the notice names each restored part in Czech', () => {
  const text = draftNoticeText([
    domainText('instrument', 'v=1&w=sawtooth&f=220'),
    domainText('labs', 'x', { labs: ['filter'] }),
    domainText('synth', encodeSynthLink({ preset: 'bass' }), { presets: PRESETS }),
    domainText('sequence', { blocks: [1, 2, 3, 4, 5, 6] }),
  ]);
  assert.equal(text, 'Po opětovném načtení stránky je zpět vaše rozpracovaná práce: nástroj '
    + '(Pila, 220 Hz), laboratoře (filtr), Synth (předvolba Bas) a sekvence (6 bloků). Nic '
    + 'nehraje, dokud sami nezačnete hrát.');
  assert.equal(domainText('sequence', { blocks: [1] }), 'sekvence (1 blok)');
});

// ------------------------------------------------------------------ the part, per domain
test('a reload restores the instrument, the labs, the Synth patch and the sequence', () => {
  const { a, b, restored, store } = editThenReload();
  assert.deepEqual(restored, DRAFT_DOMAINS, 'every domain restored');
  assert.equal(b.page.waveform, 'sawtooth');
  assert.equal(b.page.frequency, 220);
  assert.deepEqual(b.page.filter, a.page.filter, 'the lab settings through lab=');
  assert.equal(b.page.synthLink, encodeSynthLink({ preset: 'bass' }), 'the Synth link');
  assert.equal(b.page.synthQuiet, true, 'the Synth says nothing of a link: the notice does');
  assert.deepEqual(b.seq.editor.model.blocks.map((x) => x.id),
    a.seq.editor.model.blocks.map((x) => x.id), 'the sequence through the config section');
  assert.equal(b.seq.editor.model.waveform, 'sawtooth', 'the sequence follows the instrument');
  assert.ok(b.page.draft.shown);
  assert.match(b.page.draft.text, /nástroj \(Pila, 220 Hz\).*filtr.*Synth \(předvolba Bas\).*sekvence/);
  const kept = JSON.parse(store.get(SESSION_DRAFT_KEY));
  assert.deepEqual(Object.keys(kept.domains).sort(), [...DRAFT_DOMAINS].sort());
});

test('nothing sounds: no play, no audio, and a playing page saves no playing state', () => {
  const store = memoryStore();
  const a = fakePage();
  boot({ win: fakeWin({ type: 'navigate' }), store, ...a });
  edit(a);
  a.page.playing = true;
  a.page.meas = { state: 'MEASURING' };
  a.page.draftSave();
  const raw = store.get(SESSION_DRAFT_KEY);
  assert.doesNotMatch(raw, /playing|MEASURING|meas/, 'neither playing nor a measurement is kept');
  const b = fakePage();
  boot({ win: fakeWin({ type: 'reload' }), store, ...b });
  assert.equal(b.page.playing, false);
  assert.deepEqual(b.sound, [], 'the restore never starts audio or playback');
  assert.deepEqual(a.sound, []);
});

test('a page opened fresh (a deep link) ignores the draft and forgets it', () => {
  const { b, restored, store } = editThenReload({ type: 'navigate', reloadHash:
    '#m=playground&v=1&w=square&f=1000' });
  assert.deepEqual(restored, []);
  assert.equal(b.page.draft.shown, false);
  assert.equal(store.get(SESSION_DRAFT_KEY), null, 'the old draft is gone');
});

test('a reload whose address carries other instrument state keeps the address', () => {
  const store = memoryStore();
  const a = fakePage();
  boot({ win: fakeWin({ type: 'navigate', hash: '#m=filter' }), store, ...a });
  edit(a);
  a.page.draftSave();
  const b = fakePage();
  b.page.frequency = 1000; // what navStart applied from the address
  const r = boot({ win: fakeWin({ type: 'reload', hash: '#m=playground&v=1&f=1000' }), store,
    ...b });
  assert.ok(!r.restored.includes('instrument'));
  assert.equal(b.page.frequency, 1000);
  assert.ok(r.restored.includes('labs'), 'the domains the address does not carry come back');
});

test('an untouched page keeps no draft; an untouched Synth panel is no patch', () => {
  const store = memoryStore();
  const a = fakePage();
  boot({ win: fakeWin({ type: 'navigate' }), store, ...a });
  a.page.synthLink = PRISTINE_SYNTH;
  assert.deepEqual(a.page.draftSave().kept, []);
  assert.equal(store.get(SESSION_DRAFT_KEY), null);
});

test('Začít znovu puts the restored domains back and clears the draft for good', () => {
  const { b, store } = editThenReload();
  b.page.draftReset();
  assert.equal(b.page.waveform, 'sine');
  assert.equal(b.page.frequency, fakePage().page.frequency);
  assert.deepEqual(b.page.filter, DEFAULT_FILTER);
  assert.equal(b.page.synthLink, PRISTINE_SYNTH);
  assert.equal(b.seq.editor.model.blocks.length, createSequence({}).blocks.length);
  assert.equal(b.page.draft.shown, false);
  assert.equal(store.get(SESSION_DRAFT_KEY), null);
  // the reset click's debounced save finds nothing to keep
  assert.deepEqual(b.page.draftSave().kept, []);
  assert.equal(store.get(SESSION_DRAFT_KEY), null);
});

test('edits are saved debounced and at once on pagehide', () => {
  const store = memoryStore();
  const a = fakePage();
  const win = fakeWin({ type: 'navigate' });
  boot({ win, store, ...a });
  edit(a);
  win.fire('input');
  assert.equal(store.get(SESSION_DRAFT_KEY), null, 'not before the quiet time');
  win.timers.at(-1)();
  assert.ok(store.get(SESSION_DRAFT_KEY), 'the debounced save writes it');
  a.page.frequency = 330;
  win.fire('pagehide');
  assert.match(JSON.parse(store.get(SESSION_DRAFT_KEY)).domains.instrument, /f=330/);
  assert.ok(a.seq.editor.changes.length, 'a sequence edit schedules a save too');
});
