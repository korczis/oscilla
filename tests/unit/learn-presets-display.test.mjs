// U116 (Czech pass 8, rule project.czech-prose, Q104): the Výuka and Předvolby pages show the
// Learn cards, the live example and the presets in Czech, while the V1 data the freeze golden
// pins (LEARN_TOPICS, BUILTIN_PRESETS, PRESET_CATEGORIES, REFERENCE_NOTES, describeConfig and
// the instrument's topicExample) stays English. Every check below reads the Czech as a positive:
// a negative such as "no 'Load'" passes vacuously on a Czech page.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { isEnglishProse } from '../../scripts/czech-prose.mjs';
import { isShortEnglish } from '../../scripts/czech-prose-short.mjs';
import {
  FILTER_PREVIEW_SAMPLE_RATE, PROVISIONAL_SAMPLE_RATE, SAFE_NYQUIST_PERCENT_TEXT,
  THIRD_OCTAVE_FREQUENCIES,
} from '../../src/js/core/constants.js';
import { GAIN_LABELS } from '../../src/js/core/config.js';
import { LEARN_CARDS, LEARN_TOPICS } from '../../src/js/data/learn.js';
import {
  LEARN_CARDS_SHOWN, LEARN_TOPIC_TEXT, beatTextShown, learnTitleShown, topicExampleShown,
} from '../../src/js/data/learn-display.js';
import {
  BUILTIN_PRESETS, PRESET_CATEGORIES, RATE_FOR_20K_KHZ, REFERENCE_NOTES, describeConfig,
} from '../../src/js/data/presets.js';
import {
  CATEGORIES_SHOWN, REFERENCE_NOTES_SHOWN, describeConfigShown, historyTimeShown, presetShown,
  presetsShown, savedAtShown,
} from '../../src/js/data/presets-display.js';
import { createCrossLinksUi, learnReturnAction } from '../../src/js/ui/cross-links.js';

/** Czech by the repository's own measures, and with a Czech letter when it has a word. */
const CZECH_LETTER = /[áčďéěíňóřšťúůýž]/i;
function assertCzech(text, what) {
  assert.ok(!isEnglishProse(text), `${what} is an English sentence: ${text}`);
  assert.ok(!isShortEnglish(text), `${what} is short English: ${text}`);
}

test('U116: every V1 Learn topic has its Czech title, body and demo label, keyed by its id', () => {
  assert.deepEqual(Object.keys(LEARN_TOPIC_TEXT).sort(), LEARN_TOPICS.filter((t) => !t.demo.href)
    .map((t) => t.id).sort(), 'one Czech entry per V1 topic, no other');
  assert.deepEqual(LEARN_CARDS_SHOWN.map((c) => c.id), LEARN_CARDS.map((c) => c.id),
    'the page lists the same cards in the same order');
  for (const [i, shown] of LEARN_CARDS_SHOWN.entries()) {
    const data = LEARN_CARDS[i];
    for (const text of [shown.title, shown.body, shown.demo?.label ?? shown.link.label]) {
      assertCzech(text, `${shown.id}`);
    }
    assert.match(shown.body, CZECH_LETTER, `${shown.id}: the body is Czech prose`);
    if (data.demo) {
      assert.equal(shown.demo.cfg, data.demo.cfg, `${shown.id}: the demo plays the record's cfg`);
      assert.equal(shown.demo.viz, data.demo.viz);
      assert.equal(shown.demo.href, data.demo.href);
    }
  }
  const byId = Object.fromEntries(LEARN_CARDS_SHOWN.map((c) => [c.id, c]));
  assert.equal(byId.frequency.title, 'Frekvence');
  assert.equal(byId.frequency.demo.label, 'Poslech 220 → 440 → 880 Hz');
  assert.equal(byId.hearing.demo.label, 'Oktávové kroky 125 Hz – 16 kHz');
  assert.equal(byId.speakers.title, 'Omezení reproduktorů');
  // the rates the body states come from their constants
  assert.ok(byId.samplerate.body.includes(
    `předběžně předpokládá ${PROVISIONAL_SAMPLE_RATE / 1000} kHz`));
  assert.ok(byId.samplerate.body.includes(
    `modeluje svou odezvu při ${FILTER_PREVIEW_SAMPLE_RATE / 1000} kHz`));
  assert.equal(byId['signal-path'].link.label, 'Otevřít šablonu First Patch ve Studiu');
  // The frozen data is unchanged: the golden compares it (tests/unit/freeze.test.mjs).
  assert.equal(LEARN_TOPICS.find((t) => t.id === 'frequency').title, 'Frequency');
});

test('U116: the live example line is Czech for every lesson, built from the same state', () => {
  const s = { metricFrequencyIdle: 440, frequency: 440, nyquist: 24000, gainLevel: 0.081,
    gainLabel: GAIN_LABELS.low, provisional: true, effectiveSampleRate: 48000, dualFa: 440,
    dualFb: 442, dualDelta: 2, dual: { binaural: false, stereo: false } };
  const at = (learnTopic, over = {}) => topicExampleShown({ ...s, ...over, learnTopic });
  assert.equal(at('frequency'), 'Nyní: 440 Hz = 440 kmitů za sekundu.');
  assert.equal(at('period'), 'Nyní: 440 Hz → T = 2.27 ms.');
  assert.equal(at('wavelength'), 'Nyní: 440 Hz → λ ≈ 0.78 m.');
  assert.equal(at('amplitude'), 'Nyní: logické zesílení 0.081 (NÍZKÉ), jen relativní úroveň.');
  assert.equal(at('amplitude', { gainLabel: GAIN_LABELS.high }),
    'Nyní: logické zesílení 0.081 (VYSOKÉ), jen relativní úroveň.');
  assert.equal(at('nyquist'),
    'Toto zařízení: zatím nespuštěno (předpoklad 48 kHz) → Nyquistův limit 24.00 kHz.');
  assert.equal(at('samplerate', { provisional: false }),
    'Toto zařízení: 48 kHz → Nyquistův limit 24.00 kHz.');
  assert.equal(at('harmonic'),
    'Nyní: 440 Hz → pod Nyquistův limit se vejde 54 celočíselných násobků.');
  assert.equal(at('aliasing', { metricFrequencyIdle: 8000 }),
    'Nyní: 8.00 kHz → pod Nyquistův limit se vejdou 3 celočíselné násobky.');
  assert.equal(at('aliasing', { metricFrequencyIdle: 15000 }),
    'Nyní: 15.00 kHz → pod Nyquistův limit se vejde 1 celočíselný násobek.');
  assert.equal(at('beating'), 'Dva oscilátory nyní: 440 Hz + 442 Hz. Δf 2 Hz → amplitudové '
    + 'zázněje přibližně 2 Hz (jednou za 500 ms).');
  assert.equal(at('logscale'), '440 Hz → o oktávu výš je 880 Hz.');
  // the region is the Playground frequency's, as the instrument's regionLabel
  assert.equal(at('waveform', { metricFrequencyIdle: 100 }), 'Nyní: 100 Hz · nízké středy.');
  for (const t of LEARN_CARDS) assertCzech(at(t.id), `topicExample ${t.id}`);
});

test('U116: the beat sentence says what the signal does on each route (T004), in Czech', () => {
  const s = (d, route = {}) => beatTextShown({ dualDelta: d, dual: { binaural: false,
    stereo: false, ...route } });
  assert.equal(s(0), 'Žádný rozdíl: žádné zázněje (součet závisí jen na fázi).');
  assert.equal(s(6, { binaural: true, stereo: true }), 'Δf 6 Hz, jeden tón do každého ucha: '
    + 'slyší se, pokud vůbec, jako vjemové binaurální zázněje přibližně 6 Hz (jednou za 167 ms); '
    + 'v samotném signálu zázněje nejsou.');
  assert.equal(s(6, { stereo: true }), 'Δf 6 Hz, v každém kanálu jeden ustálený tón: v signálu '
    + 'žádné zázněje. Z reproduktorů mohou akusticky zaznít zázněje přibližně 6 Hz (jednou za '
    + '167 ms), podle místa poslechu; ve sluchátkách jsou případné zázněje jen vjemové.');
  assert.equal(s(2), 'Δf 2 Hz → amplitudové zázněje přibližně 2 Hz (jednou za 500 ms).');
});

test('U116: the composed component shows the Czech cards and example over the instrument', () => {
  const part = createCrossLinksUi();
  assert.equal(part.LEARN_CARDS, LEARN_CARDS_SHOWN);
  // main.js composes the cross-links part after the instrument, so its getter is the one bound.
  const main = readFileSync(new URL('../../src/js/main.js', import.meta.url), 'utf8');
  const call = main.slice(main.indexOf('const cmp = compose('));
  assert.ok(call.indexOf('instrument,') < call.indexOf('createCrossLinksUi()'),
    'main.js composes createCrossLinksUi after the instrument');
  const cmp = Object.defineProperties({ metricFrequencyIdle: 440, learnTopic: 'frequency' },
    Object.getOwnPropertyDescriptors(part));
  assert.equal(cmp.topicExample, 'Nyní: 440 Hz = 440 kmitů za sekundu.');
  // The way back to a lesson names it as the page does, from the data record or the shown card.
  const harmonic = LEARN_TOPICS.find((t) => t.id === 'harmonic');
  assert.equal(learnReturnAction(harmonic).text, 'Zpět na lekci: Harmonické');
  assert.equal(learnReturnAction(LEARN_CARDS_SHOWN.find((t) => t.id === 'harmonic')).text,
    'Zpět na lekci: Harmonické');
  assert.equal(learnTitleShown('signal-path'), 'Signálová cesta');
});

test('U116: the preset categories, names, descriptions and parameters are Czech, same ids', () => {
  assert.deepEqual(CATEGORIES_SHOWN.map((c) => c.id), PRESET_CATEGORIES.map((c) => c.id));
  assert.deepEqual(CATEGORIES_SHOWN.map((c) => c.label), ['Referenční', 'Hudební', 'Sweepy',
    'Vzory', 'Vysoké frekvence', 'Dva oscilátory', 'Vlastní', 'Historie']);
  assert.equal(PRESET_CATEGORIES[0].label, 'Reference', 'the frozen data is unchanged');
  for (const p of BUILTIN_PRESETS) {
    const shown = presetShown(p);
    assert.equal(shown.id, p.id);
    assert.equal(shown.cfg, p.cfg, `${p.id}: loading the shown row applies the record's cfg`);
    assert.notEqual(shown.desc, p.desc, `${p.id}: the description is translated`);
    assert.match(shown.desc, CZECH_LETTER, `${p.id}: the description is Czech prose`);
    for (const text of [shown.name, shown.desc, shown.params]) assertCzech(text, p.id);
  }
  assert.deepEqual(Object.keys(REFERENCE_NOTES_SHOWN), Object.keys(REFERENCE_NOTES),
    'one Czech note per reference frequency');
  const byId = Object.fromEntries(BUILTIN_PRESETS.map((p) => [p.id, presetShown(p)]));
  assert.equal(byId['ref-440'].desc, 'Komorní a (A4) v běžné ladicí praxi.');
  assert.equal(byId['ref-440'].params, 'Sinus · tón pevné délky 1 s');
  // the numbers the notes state come from their constants
  assert.ok(byId['ref-20000'].desc.includes(`přibližně ${RATE_FOR_20K_KHZ} kHz nebo vyšší`));
  assert.ok(byId['ref-20000'].desc.includes(`(${SAFE_NYQUIST_PERCENT_TEXT} Nyquistova limitu)`));
  assert.equal(byId['mus-triad'].name, 'Rozložený akord A dur');
  assert.equal(byId['pt-third'].params, `až ${THIRD_OCTAVE_FREQUENCIES.length} kroků × 250 ms`);
  assert.equal(byId['pt-octaves'].params, '8 kroků × 400 ms');
  // a beat pair is built from its two oscillators
  assert.equal(byId['du-440-442'].desc,
    'Monofonní směs; amplitudové zázněje přibližně 2 Hz (rozdílová frekvence).');
  assert.equal(byId['du-1000-1002'].params, 'Δf 2 Hz · monofonní směs');
  assert.equal(byId['hf-24000'].desc,
    'Nominální ultrazvuková oblast; potřebuje vzorkovací frekvenci nad ~50.5 kHz.');
});

test('U116: a saved preset keeps its name, shows a cs-CZ date and a Czech description', () => {
  const cfg = { source: 'single', pattern: 'tone', frequency: 440, waveform: 'sine' };
  const labs = { filter: { on: true } };
  const created = Date.UTC(2026, 10, 17, 22, 17, 46);
  const [row] = presetsShown('custom', [{ id: 'p1', name: 'Audit preset', created, cfg, labs }]);
  assert.equal(row.name, 'Audit preset', 'the user\'s own name');
  assert.equal(row.cfg, cfg);
  assert.equal(row.labs, labs);
  assert.equal(row.custom, true);
  assert.equal(row.desc, `Uloženo ${new Date(created).toLocaleString('cs-CZ')}`);
  assert.match(row.desc, /^Uloženo \d{1,2}\. \d{1,2}\. 2026 \d{1,2}:\d{2}:\d{2}$/);
  assert.equal(row.params, 'Spojitý tón · 440 Hz · sinus');
  assert.equal(describeConfig(cfg), 'Continuous tone · 440 Hz · sine', 'the frozen V1 line');
  const dual = { source: 'dual', dual: { a: { freq: 440 }, b: { freq: 442 } } };
  assert.equal(describeConfigShown(dual), 'Dva oscilátory 440 Hz + 442 Hz');
  assert.equal(describeConfigShown({ source: 'sweep', sweep: { start: 20, end: 20000 } }),
    'Sweep 20 Hz → 20.00 kHz');
  assert.equal(describeConfigShown({ source: 'single', pattern: 'finite', frequency: 1000,
    waveform: 'square' }), 'Tón pevné délky · 1.00 kHz · obdélník');
  assert.match(historyTimeShown(created), /^\d{1,2}:\d{2}:\d{2}$/, 'a 24-hour cs-CZ time');
  assert.equal(historyTimeShown(created), new Date(created).toLocaleTimeString('cs-CZ'));
  assert.deepEqual(presetsShown('reference', []).map((p) => p.id),
    BUILTIN_PRESETS.filter((p) => p.cat === 'reference').map((p) => p.id));
});
