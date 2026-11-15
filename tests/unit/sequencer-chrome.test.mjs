// K017 sequencer chrome: note-name entry, the tempo refusal and the loader's tempo report.
// Fails on the merge base: src/js/sequencer/entry.js does not exist there, editor.setTempo
// clamps, and normalizeSequence clamps a tempo of 500 to 300 silently.
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseFrequencyEntry, parseTempoEntry } from '../../src/js/sequencer/entry.js';
import { noteToFrequency, midiToFrequency } from '../../src/js/core/music.js';
import { parseSequence, MIN_TEMPO_BPM, MAX_TEMPO_BPM, DEFAULT_TEMPO_BPM } from '../../src/js/sequencer/model.js';
import { createSequencerEditor } from '../../src/js/sequencer/editor.js';

test('K017: note names and MIDI numbers parse to the frequencies core/music.js gives', () => {
  assert.deepEqual(parseFrequencyEntry('A4'), { ok: true, hz: 440, via: 'note' });
  assert.equal(parseFrequencyEntry(' C#3 ').hz, Math.round(noteToFrequency('C#3') * 1000) / 1000);
  assert.equal(parseFrequencyEntry('Bb2').hz, Math.round(noteToFrequency('Bb2') * 1000) / 1000);
  assert.deepEqual(parseFrequencyEntry('m69'), { ok: true, hz: 440, via: 'midi' });
  assert.equal(parseFrequencyEntry('midi 60').hz, Math.round(midiToFrequency(60) * 1000) / 1000);
  assert.deepEqual(parseFrequencyEntry('440'), { ok: true, hz: 440, via: 'hz' });
  assert.equal(parseFrequencyEntry('1k').hz, 1000);
  assert.equal(parseFrequencyEntry('15.5 kHz').hz, 15500);
});

test('K017: anything else is refused with a readable sentence', () => {
  const r = parseFrequencyEntry('loud');
  assert.equal(r.ok, false);
  assert.match(r.error, /\u201eloud\u201c není nota ani frekvence\. Zkuste A4, C#3, m69, 440 nebo 1k\./);
  assert.equal(parseFrequencyEntry('').ok, false);
  assert.equal(parseFrequencyEntry('H4').ok, false);
  assert.match(parseFrequencyEntry('m128').error, /MIDI nota 128 je mimo rozsah 0 až 127/);
});

test('K017: a BPM outside 20 to 300 is refused, not clamped', () => {
  assert.deepEqual(parseTempoEntry(120), { ok: true, bpm: 120 });
  assert.deepEqual(parseTempoEntry('20'), { ok: true, bpm: 20 });
  assert.deepEqual(parseTempoEntry('300 bpm'), { ok: true, bpm: 300 });
  assert.match(parseTempoEntry(19).error, /Tempo 19 BPM je mimo rozsah 20 až 300 BPM\./);
  assert.match(parseTempoEntry(350).error, /Tempo 350 BPM je mimo rozsah 20 až 300 BPM\./);
  assert.match(parseTempoEntry('fast').error, /\u201efast\u201c není tempo\. Zkuste 120 BPM\./);
  assert.equal(MIN_TEMPO_BPM, 20);
  assert.equal(MAX_TEMPO_BPM, 300);
});

test('K017: the editor keeps its model on a refused tempo and says why', () => {
  const editor = createSequencerEditor();
  const before = editor.model;
  editor.setTempo(350);
  assert.equal(editor.model, before, 'the model is untouched');
  assert.match(editor.error, /mimo rozsah 20 až 300 BPM/);
  editor.setTempo(140);
  assert.equal(editor.model.tempoBpm, 140);
  assert.equal(editor.error, '');
});

test('K017: a loaded tempo outside the bounds keeps the default and is reported, never clamped', () => {
  const { model, issues } = parseSequence(JSON.stringify({ version: 1, tempoBpm: 500, blocks: [] }));
  assert.equal(model.tempoBpm, DEFAULT_TEMPO_BPM, 'not 300');
  assert.ok(issues.some((s) => /Tempo 500 BPM je mimo rozsah 20 až 300 BPM; ponecháno 120\./.test(s)), issues.join(' | '));
  const fine = parseSequence(JSON.stringify({ version: 1, tempoBpm: 97.5, blocks: [] }));
  assert.equal(fine.model.tempoBpm, 97.5, 'a value outside the offered steps is kept as it is');
  assert.ok(!fine.issues.some((s) => /Tempo/.test(s)));
});

// K017 criterion 3 (G1 coherence contract 2.4, persist-5): after a load or an import the tempo
// control shows model.tempoBpm, including a tempo that is not one of its offered steps. A fake
// <select> holds the offered steps; syncTempoSelect is what sequencer-panel.js runs on render.
function fakeSelect(steps) {
  const sel = { options: [], selectedIndex: 0 };
  const option = (value, dynamic) => {
    const o = { value: String(value), textContent: `${value} BPM`, dataset: {} };
    if (dynamic) o.dataset.oscDynamic = '1';
    o.remove = () => { sel.options = sel.options.filter((x) => x !== o); };
    return o;
  };
  sel.options = steps.map((s) => option(s));
  Object.defineProperty(sel, 'value', { get: () => (sel.options[sel.selectedIndex] || {}).value });
  sel.querySelector = (q) => (q === 'option[data-osc-dynamic]'
    ? sel.options.find((o) => o.dataset.oscDynamic) || null : null);
  sel.appendChild = (o) => { sel.options.push(o); return o; };
  const doc = { createElement: () => option('', false) };
  return { sel, doc };
}

test('K017: the tempo control shows a loaded tempo that is not an offered step, and drops it after', async () => {
  const { syncTempoSelect } = await import('../../src/js/sequencer/tempo-select.js');
  const { sel, doc } = fakeSelect([60, 90, 120, 140]);
  sel.selectedIndex = 2;
  syncTempoSelect(sel, 97, doc);
  assert.equal(sel.value, '97', 'the control shows the model tempo 97 BPM');
  assert.equal(sel.options.filter((o) => o.dataset.oscDynamic).length, 1, 'one added option');
  assert.equal(sel.options.at(-1).textContent, '97 BPM');
  syncTempoSelect(sel, 103, doc);
  assert.equal(sel.value, '103', 'a second off-step tempo replaces the first');
  assert.equal(sel.options.length, 5, 'still one added option');
  syncTempoSelect(sel, 90, doc);
  assert.equal(sel.value, '90', 'an offered step is selected again');
  assert.deepEqual(sel.options.map((o) => o.value), ['60', '90', '120', '140'],
    'the added option goes when the model leaves it');
  syncTempoSelect(sel, 90, doc);
  assert.equal(sel.value, '90', 'no change when the control already shows the model');
});
