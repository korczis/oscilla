// What the Předvolby page shows for the presets (Czech pass 8, U116; rule project.czech-prose,
// Q104).
//
// The built-in presets stay English as data: tests/freeze/golden-a7b7a23.json pins
// BUILTIN_PRESETS, PRESET_CATEGORIES, REFERENCE_NOTES and describeConfig, and the History label,
// the stored presets and the exports never read this file. The page shows a Czech copy of each
// preset, keyed by its id: the name, the description and the parameter line; the copy carries the
// record's id and cfg (the same objects), so loading it applies the same values, and the name the
// user saw is the one the Save dialog suggests. The reference, high-frequency and dual families
// are built from the record's
// structure (its frequency, its two oscillators), never parsed out of the English text. A saved
// preset keeps its own name; its date is shown in cs-CZ and its configuration through
// describeConfigShown. No English is written here: every key is an id or a number.

import {
  OCTAVE_STEP_FREQUENCIES, SAFE_NYQUIST_PERCENT_TEXT, THIRD_OCTAVE_FREQUENCIES, WAVEFORM_NAMES,
} from '../core/constants.js';
import { formatFrequency } from '../core/frequency.js';
import { PATTERN_NAMES } from '../audio/patterns.js';
import { BUILTIN_PRESETS, PRESET_CATEGORIES, RATE_FOR_20K_KHZ } from './presets.js';

/** The category tabs in Czech, keyed by their ids. */
export const PRESET_CATEGORY_NAMES = Object.freeze({
  reference: 'Referenční',
  musical: 'Hudební',
  sweeps: 'Sweepy',
  patterns: 'Vzory',
  high: 'Vysoké frekvence',
  dual: 'Dva oscilátory',
  custom: 'Vlastní',
  history: 'Historie',
});

/** What the page's category tabs bind (the component's PRESET_CATEGORIES): same ids, Czech. */
export const CATEGORIES_SHOWN = Object.freeze(PRESET_CATEGORIES.map((c) =>
  Object.freeze({ ...c, label: PRESET_CATEGORY_NAMES[c.id] ?? c.label })));

/** data/presets.js REFERENCE_NOTES in Czech, keyed by the same frequency. */
export const REFERENCE_NOTES_SHOWN = Object.freeze({
  20: 'Nominální dolní hranice lidského sluchu. Mnoho reproduktorů ji reprodukuje slabě nebo '
    + 'vůbec.',
  40: 'Hluboký sub-bas. Malé reproduktory mohou místo základní frekvence reprodukovat hlavně '
    + 'harmonické zkreslení.',
  60: 'Dolní hranice basového pásma; blízko frekvencí síťového brumu (50/60 Hz).',
  100: 'Nízké basy. Vlnová délka ≈ 3.4 m — srovnatelná s rozměry místnosti.',
  250: 'Hranice mezi basy a nízkými středy.',
  440: 'Komorní a (A4) v běžné ladicí praxi.',
  1000: 'Běžný referenční tón pro zvukové ukázky.',
  2000: 'Vysoké středy; oblast vysoké citlivosti sluchu.',
  4000: 'Oblast prezence; citlivost sluchu bývá nejvyšší přibližně v rozmezí 2–5 kHz.',
  8000: 'Oblast brilance. Jeden kmit trvá 125 µs.',
  10000: 'Vysokofrekvenční signál; vlnová délka ≈ 3.4 cm.',
  12000: 'Velmi vysoká frekvence. Vnímaná hlasitost často klesá s věkem a podle přehrávacího '
    + 'hardwaru.',
  15500: 'Vysokofrekvenční signál — ne ultrazvuk. Reproduktory ho mohou silně utlumit.',
  17000: 'Horní pásmo sluchu. Mnoho dospělých ho vnímá slabě nebo vůbec; digitální signál se '
    + 'vytvoří tak jako tak a výstup reproduktoru není znám.',
  18000: 'Horní pásmo sluchu. Reproduktory telefonů a některé kodeky ho mohou utlumit.',
  20000: 'Nominální horní hranice lidského sluchu. Potřebuje vzorkovací frekvenci přibližně '
    + `${RATE_FOR_20K_KHZ} kHz nebo vyšší, aby 20 kHz zůstalo pod digitálním limitem `
    + `(${SAFE_NYQUIST_PERCENT_TEXT} Nyquistova limitu).`,
});

/** The high-frequency family's descriptions in Czech, keyed by the frequency. */
const HIGH_NOTES_SHOWN = Object.freeze({
  12000: 'Oblast velmi vysokých frekvencí.',
  14000: 'Oblast velmi vysokých frekvencí; vnímaná úroveň zde často klesá.',
  15500: 'Vysokofrekvenční signál — ne ultrazvuk.',
  16000: 'Hranice horního pásma sluchu.',
  17000: 'Horní pásmo sluchu.',
  18000: 'Horní pásmo sluchu; mnoho přehrávacích řetězců ho utlumí.',
  19000: 'Horní pásmo sluchu, blízko nominální hranice 20 kHz.',
  21000: 'Nominální ultrazvuková oblast. Digitální generování neznamená, že ho váš hardware '
    + 'vyzáří.',
  24000: 'Nominální ultrazvuková oblast; potřebuje vzorkovací frekvenci nad ~50.5 kHz.',
});

/** "tón pevné délky": a pattern's Czech name inside a parameter line. */
const finite = PATTERN_NAMES.finite.toLowerCase();
// A waveform's Czech name; an unknown id is shown as it is, a missing one is the sine (V1).
const wave = (id) => WAVEFORM_NAMES[id || 'sine'] || id;
const steps = (n) => `${n} ${n === 1 ? 'krok' : n >= 2 && n <= 4 ? 'kroky' : 'kroků'}`;
const tones = (n) => `${n} ${n === 1 ? 'tón' : n >= 2 && n <= 4 ? 'tóny' : 'tónů'}`;

/** The hand-written presets in Czech, keyed by their ids: { name, desc, params }. */
export const PRESET_TEXT = Object.freeze({
  // MUSICAL
  'mus-a4': { desc: 'Referenční komorní a v rovnoměrně temperovaném ladění.',
    params: `${wave('sine')} · ${finite} 1.5 s` },
  'mus-c4': { desc: 'Jednočárkované c při A4 = 440 Hz.',
    params: `${wave('triangle')} · ${finite} 1.5 s` },
  'mus-e2': { desc: 'Nejhlubší struna kytary ve standardním ladění.',
    params: `${wave('sawtooth')} · ${finite} 1.5 s` },
  'mus-a2': { desc: 'Dvě oktávy pod A4 (440 / 4).', params: `${wave('sine')} · ${finite} 1.5 s` },
  'mus-triad': { name: 'Rozložený akord A dur',
    desc: 'A4, C♯5, E5, A5 v rovnoměrně temperovaném ladění.',
    params: `${wave('triangle')} · ${tones(4)} × 350 ms` },
  'mus-octaves': { name: 'Oktávový žebřík A1–A7',
    desc: 'Každý krok zdvojnásobí frekvenci: 55 Hz až 3.52 kHz.',
    params: `${wave('sine')} · ${tones(7)} × 400 ms` },
  'mus-semitones': { name: 'Půltónové kroky A4–A5',
    desc: '13 rovnoměrně temperovaných kroků; každý je poměr 2^(1/12).',
    params: `${wave('sine')} · ${tones(13)} × 220 ms` },

  // SWEEPS
  'sw-human': { name: 'Spektrum lidského sluchu',
    desc: 'Nominální rozsah lidského sluchu v logaritmickém sweepu.' },
  'sw-speech': { name: 'Pásmo řeči',
    desc: 'Oblast, která nese většinu energie řeči a vodítek pro srozumitelnost.' },
  'sw-presence': { name: 'Prezence', desc: 'Od vysokých středů do oblasti prezence.' },
  'sw-high': { name: 'Vysoké pásmo', desc: 'Od brilance do horního pásma sluchu.' },
  'sw-upper': { name: 'Horní pásmo',
    desc: `Od 12 kHz po digitální limit tohoto zařízení (${SAFE_NYQUIST_PERCENT_TEXT} `
      + 'Nyquistova limitu).',
    params: '12 kHz → digitální limit · 4 s · log' },
  'sw-sub': { name: 'Sub-bas',
    desc: 'Nejnižší pásmo; sledujte výchylku membrány reproduktoru a začněte s nízkým zesílením.' },
  'sw-bass': { name: 'Basy', desc: 'Basové pásmo většiny hudby.' },

  // PATTERNS
  'pt-short-high': { name: 'Krátký vysoký tón', desc: 'Krátký vysokofrekvenční sinusový tón.',
    params: `15.5 kHz · ${wave('sine').toLowerCase()} · 300 ms` },
  'pt-double': { name: 'Dvojitý pulz', desc: 'Dva krátké vysokofrekvenční pulzy.' },
  'pt-high-sweep': { name: 'Vysoký sweep',
    desc: 'Rychlý logaritmický sweep ve vysokofrekvenční oblasti.' },
  'pt-siren': { name: 'Rychlá siréna', desc: 'Sinusové LFO mezi dvěma vysokými frekvencemi.',
    params: '13 ↔ 17 kHz · LFO 3 Hz' },
  'pt-chirp': { name: 'Chirp', desc: 'Krátký exponenciální přechod frekvence.' },
  'pt-wobble': { name: 'Jemné kolísání',
    desc: 'Pomalá odchylka frekvence kolem vysoké střední frekvence.' },
  'pt-440': { name: 'Referenční tón 440 Hz', desc: 'Sinus A4 pro ladění a porovnávání.',
    params: `440 Hz · ${wave('sine').toLowerCase()} · 1 s` },
  'pt-1k': { name: 'Referenční tón 1 kHz',
    desc: 'Obvyklá referenční frekvence pro ukázky. Úroveň je relativní, ne kalibrovaná.',
    params: `1 kHz · ${wave('sine').toLowerCase()} · 1 s` },
  'pt-20-pulse': { name: 'Pulz 20 Hz',
    desc: 'Velmi nízké pulzy; každý trvá 10 kmitů. Začněte s nízkým zesílením.' },
  'pt-40-sub': { name: 'Sub-bas 40 Hz',
    desc: 'Trvalý sub-basový tón. Malé reproduktory ho mohou reprodukovat špatně.',
    params: `40 Hz · ${wave('sine').toLowerCase()} · 2 s` },
  'pt-octaves': { name: 'Oktávové kroky', desc: '125 Hz až 16 kHz po oktávách.',
    params: `${steps(OCTAVE_STEP_FREQUENCIES.length)} × 400 ms` },
  'pt-third': { name: 'Třetinooktávová ukázka',
    desc: 'Nominální středy třetinooktávových pásem, 20 Hz až 20 kHz; hodnoty nad digitálním '
      + 'limitem se vynechají.',
    params: `až ${steps(THIRD_OCTAVE_FREQUENCIES.length)} × 250 ms` },

  // DUAL OSC: the binaural demo (the beat pairs are built from their oscillators)
  'du-binaural': { name: 'Binaurální ukázka 440 / 446 Hz',
    desc: 'Levé ucho 440 Hz, pravé ucho 446 Hz. Někteří posluchači vnímají binaurální zázněje '
      + '6 Hz. Vyžaduje sluchátka.',
    params: 'L 440 · P 446 · rozdělení do sterea' },
});

/** The Czech text of a reference, high-frequency or beat-pair preset, from its structure. */
function familyText(p) {
  const f = p.cfg && p.cfg.frequency;
  if (p.cat === 'reference') {
    return { desc: REFERENCE_NOTES_SHOWN[f] || 'Referenční tón.',
      params: `${wave('sine')} · ${finite} 1 s` };
  }
  if (p.cat === 'high' && Object.hasOwn(HIGH_NOTES_SHOWN, f)) {
    return { desc: HIGH_NOTES_SHOWN[f], params: `${wave('sine')} · ${finite} 600 ms` };
  }
  const d = p.cat === 'dual' && p.cfg.dual && !p.cfg.dual.binaural
    ? p.cfg.dual.b.freq - p.cfg.dual.a.freq : null;
  if (d !== null) {
    return { desc: `Monofonní směs; amplitudové zázněje přibližně ${d} Hz (rozdílová frekvence).`,
      params: `Δf ${d} Hz · monofonní směs` };
  }
  return null;
}

/** A built-in preset as the page shows it: its record with the Czech name, desc and params. */
export function presetShown(p) {
  const text = (Object.hasOwn(PRESET_TEXT, p.id) && PRESET_TEXT[p.id]) || familyText(p);
  if (!text) return p;
  return { ...p, name: text.name ?? p.name, desc: text.desc ?? p.desc,
    params: text.params ?? p.params };
}

/** One-line description of a configuration in Czech (data/presets.js describeConfig). */
export function describeConfigShown(cfg) {
  if (!cfg) return '';
  if (cfg.source === 'dual' && cfg.dual) {
    const [a, b] = [cfg.dual.a.freq, cfg.dual.b.freq].map((f) => formatFrequency(f));
    return `Dva oscilátory ${a} + ${b}`;
  }
  if (cfg.source === 'sweep' && cfg.sweep) {
    return `Sweep ${formatFrequency(cfg.sweep.start)} → ${formatFrequency(cfg.sweep.end)}`;
  }
  const name = (Object.hasOwn(PATTERN_NAMES, cfg.pattern) && PATTERN_NAMES[cfg.pattern]) || 'Tón';
  return `${name} · ${formatFrequency(cfg.frequency)} · ${wave(cfg.waveform).toLowerCase()}`;
}

/** When a preset was saved, as the Custom row says it (cs-CZ date and time). */
export function savedAtShown(created) {
  return `Uloženo ${new Date(created).toLocaleString('cs-CZ')}`;
}

/** A History entry's time (cs-CZ). */
export function historyTimeShown(ts) {
  return new Date(ts).toLocaleTimeString('cs-CZ');
}

/**
 * What the page lists for a category (the component's presetsFor, V1 oscillaApp.presetsFor):
 * the saved presets as rows that keep their own name, or the built-ins of the category, in
 * Czech. A row carries its record's id, cfg and labs, so loading it applies the same values.
 */
export function presetsShown(cat, customPresets) {
  if (cat === 'custom') {
    return customPresets.map((p) => ({ id: p.id, cat: 'custom', name: p.name, custom: true,
      desc: savedAtShown(p.created), params: describeConfigShown(p.cfg),
      cfg: p.cfg, ...(p.labs ? { labs: p.labs } : {}) }));
  }
  return BUILTIN_PRESETS.filter((p) => p.cat === cat).map(presetShown);
}
