// What the Výuka page shows for the Learn cards (Czech pass 8, U116; rule project.czech-prose,
// Q104).
//
// The V1 topics stay English as data: tests/freeze/golden-a7b7a23.json pins LEARN_TOPICS (titles,
// bodies, demo labels) and the instrument's topicExample. The page shows the Czech copy of each
// card, keyed by its id: LEARN_CARDS_SHOWN is what the component binds as LEARN_CARDS, and
// topicExampleShown its topicExample (ui/cross-links.js createCrossLinksUi). A copy carries its
// record's id, demo cfg, viz and href (the same objects), so its demo plays the same thing. The
// V3 topics and the concept cards are Czech in data/learn.js itself, since no golden pins them,
// and pass through unchanged. No English is written here: every key is an id, a number or a
// constant imported from its one home.

import { FILTER_PREVIEW_SAMPLE_RATE, PROVISIONAL_SAMPLE_RATE } from '../core/constants.js';
import { GAIN_LABELS } from '../core/config.js';
import { formatFrequency, formatPeriod, formatWavelength, regionFor } from '../core/frequency.js';
import { sig } from '../core/math.js';
import { LEARN_CARDS } from './learn.js';

const kHz = (hz) => `${hz / 1000} kHz`;

/** The Czech title, body and demo label of each V1 topic, keyed by its id. */
export const LEARN_TOPIC_TEXT = Object.freeze({
  frequency: { title: 'Frekvence',
    body: 'Frekvence je počet kmitů za sekundu, měří se v hertzích (Hz). Její zdvojnásobení '
      + 'zvýší výšku tónu o jednu oktávu.',
    demo: 'Poslech 220 → 440 → 880 Hz' },
  period: { title: 'Perioda',
    body: 'Perioda je doba trvání jednoho kmitu: T = 1 / f. Vyšší frekvence mají kratší periody.',
    demo: 'Ukázat 440 Hz (2.27 ms)' },
  wavelength: { title: 'Vlnová délka',
    body: 'Ve vzduchu (≈ 343 m/s) je vlnová délka λ = 343 / f. 100 Hz má vlnovou délku asi '
      + '3.4 m; 10 kHz asi 3.4 cm.',
    demo: 'Zkusit 100 Hz' },
  amplitude: { title: 'Amplituda',
    body: 'Amplituda je velikost kmitání. Zde je to relativní digitální úroveň — ne kalibrovaná '
      + 'hladina akustického tlaku.',
    demo: 'AM: sledujte, jak se úroveň mění' },
  waveform: { title: 'Tvar vlny',
    body: 'Tvar vlny je průběh jednoho kmitu. Sinus je čistý; trojúhelník, pila a obdélník '
      + 'přidávají harmonické a znějí jasněji.',
    demo: 'Pila na 220 Hz' },
  harmonic: { title: 'Harmonické',
    body: 'Harmonické jsou celočíselné násobky základní frekvence (2f, 3f, …). Obdélník '
      + 'a trojúhelník obsahují liché harmonické; pila všechny.',
    demo: 'Obdélník na 220 Hz' },
  nyquist: { title: 'Nyquistův limit',
    body: 'Digitální systém dokáže reprezentovat jen frekvence pod polovinou své vzorkovací '
      + 'frekvence. Nyquistův limit je digitální mez, ne záruka výkonu reproduktoru.',
    demo: 'Obdélník na 5 kHz' },
  samplerate: { title: 'Vzorkovací frekvence',
    body: 'Vzorkovací frekvence udává, kolik hodnot za sekundu zvukový systém vytvoří. Jakmile '
      + 'se zvuk spustí, OSCILLA použije frekvenci, kterou hlásí toto zařízení; do té doby '
      + `displej předběžně předpokládá ${kHz(PROVISIONAL_SAMPLE_RATE)} a označuje ji tak; stránka `
      + `Filtry modeluje svou odezvu při ${kHz(FILTER_PREVIEW_SAMPLE_RATE)} a uvádí to.`,
    demo: 'Otevřít spektrum' },
  aliasing: { title: 'Aliasing',
    body: 'Obsah nad Nyquistovým limitem se překlápí zpět na nesprávné, nižší frekvence. '
      + 'Oscilátory Web Audio jsou pásmově omezené, takže harmonické nad Nyquistovým limitem '
      + 'místo toho vynechávají.',
    demo: 'Pila na 8 kHz: vejde se jen málo harmonických' },
  modulation: { title: 'Modulace',
    body: 'Modulace znamená, že jeden signál mění vlastnost jiného — jeho úroveň (AM) nebo jeho '
      + 'frekvenci (FM, kolísání, siréna).',
    demo: 'Siréna' },
  am: { title: 'AM',
    body: 'Amplitudová modulace mění úroveň. Pomalá AM se slyší jako tremolo; rychlá AM vytváří '
      + 'postranní pásma na f ± fm.',
    demo: 'AM tremolo 5 Hz' },
  fm: { title: 'FM',
    body: 'Frekvenční modulace mění frekvenci. Pomalá FM je vibrato; FM s modulací '
      + 'v akustickém pásmu vytváří mnoho postranních pásem vzdálených od sebe o modulační '
      + 'frekvenci.',
    demo: 'FM s modulací v akustickém pásmu' },
  interference: { title: 'Interference',
    body: 'Když se dvě vlny sečtou, tam, kde jsou ve fázi, se zesilují, a tam, kde jsou '
      + 'v protifázi, se ruší.',
    demo: '440 + 445 Hz' },
  beating: { title: 'Zázněje',
    body: 'Dvě blízké frekvence vytvářejí úroveň, která stoupá a klesá s jejich rozdílem: '
      + '440 Hz a 442 Hz tvoří zázněje přibližně 2 Hz.',
    demo: '440 + 442 Hz' },
  logscale: { title: 'Logaritmické vnímání',
    body: 'Výšku tónu vnímáme zhruba podle poměrů: 100→200 Hz i 1→2 kHz jsou jedna oktáva '
      + 'a znějí jako podobný krok. Proto jsou sweepy a mapy zde logaritmické.',
    demo: 'Logaritmický sweep 20 Hz → 20 kHz' },
  hearing: { title: 'Rozsah lidského sluchu',
    body: 'Nominálně 20 Hz – 20 kHz. Horní mez obvykle klesá s věkem a s vystavením hluku; '
      + 'sluch se mezi jednotlivci značně liší.',
    demo: 'Oktávové kroky 125 Hz – 16 kHz' },
  ultrasound: { title: 'Ultrazvuk',
    body: 'Nominální ultrazvuk začíná přibližně nad 20 kHz. 15.5 kHz je vysokofrekvenční signál, '
      + 'ne ultrazvuk. To, že se >20 kHz vytvoří digitálně, neznamená, že ho reproduktor vyzáří.',
    demo: 'Sweep vysokým pásmem' },
  speakers: { title: 'Omezení reproduktorů',
    body: 'Reproduktory, sluchátka, D/A převodníky a zesilovače mohou velmi nízké a velmi '
      + 'vysoké frekvence utlumit nebo zkreslit. Vnímaná hlasitost není měřítkem akustického '
      + 'výstupu.',
    demo: 'Sub-bas 40 Hz' },
});

/** A card as the page shows it: its data record with the Czech title, body and demo label. */
function cardShown(card) {
  const text = Object.hasOwn(LEARN_TOPIC_TEXT, card.id) ? LEARN_TOPIC_TEXT[card.id] : null;
  if (!text) return card;
  return Object.freeze({ ...card, title: text.title, body: text.body,
    demo: Object.freeze({ ...card.demo, label: text.demo }) });
}

/** What the Výuka page lists (the component's LEARN_CARDS): the cards in Czech, same ids. */
export const LEARN_CARDS_SHOWN = Object.freeze(LEARN_CARDS.map(cardShown));

const SHOWN_BY_ID = new Map(LEARN_CARDS_SHOWN.map((c) => [c.id, c]));

/** A card's title as the page shows it, by its id. */
export function learnTitleShown(id) {
  const c = SHOWN_BY_ID.get(id);
  return c ? c.title : '';
}

/** core/frequency.js FREQUENCY_REGIONS in Czech, keyed by each region's lower bound. */
export const REGION_NAMES_SHOWN = Object.freeze({
  0: 'POD NOMINÁLNÍM ROZSAHEM SLUCHU',
  20: 'SUB-BAS',
  60: 'BASY',
  250: 'NÍZKÉ STŘEDY',
  500: 'STŘEDY',
  2000: 'VYSOKÉ STŘEDY',
  4000: 'PREZENCE',
  6000: 'BRILANCE',
  12000: 'VELMI VYSOKÉ FREKVENCE',
  16000: 'HORNÍ PÁSMO SLUCHU',
  20000: 'NOMINÁLNÍ ULTRAZVUKOVÉ PÁSMO',
});

/** The gain labels (core/config.js GAIN_LABELS) in Czech: "nízké zesílení". */
export const GAIN_LABELS_SHOWN = Object.freeze({
  [GAIN_LABELS.low]: 'NÍZKÉ',
  [GAIN_LABELS.medium]: 'STŘEDNÍ',
  [GAIN_LABELS.high]: 'VYSOKÉ',
});

/** The region of a frequency as the page shows it. */
export function regionShown(f) {
  const r = regionFor(f);
  return Object.hasOwn(REGION_NAMES_SHOWN, r.min) ? REGION_NAMES_SHOWN[r.min] : r.label;
}

/** "se vejde 1 celočíselný násobek", "se vejdou 3 celočíselné násobky", "se vejde 5 …ých …ů". */
function multiplesShown(n) {
  if (n === 1) return 'se vejde 1 celočíselný násobek';
  if (n >= 2 && n <= 4) return `se vejdou ${n} celočíselné násobky`;
  return `se vejde ${n} celočíselných násobků`;
}

/**
 * The dual oscillator's beat sentence in Czech, built from the same state as the instrument's
 * beatText (T004, claim dual-oscillator-beats: only the mono mix beats in the signal).
 */
export function beatTextShown(s) {
  const d = s.dualDelta;
  if (d < 0.005) return 'Žádný rozdíl: žádné zázněje (součet závisí jen na fázi).';
  const f = sig(d, 3), p = `(jednou za ${formatPeriod(d)})`;
  if (s.dual.binaural) {
    return `Δf ${f} Hz, jeden tón do každého ucha: slyší se, pokud vůbec, jako vjemové `
      + `binaurální zázněje přibližně ${f} Hz ${p}; v samotném signálu zázněje nejsou.`;
  }
  if (s.dual.stereo) {
    return `Δf ${f} Hz, v každém kanálu jeden ustálený tón: v signálu žádné zázněje. Z `
      + `reproduktorů mohou akusticky zaznít zázněje přibližně ${f} Hz ${p}, podle místa `
      + 'poslechu; ve sluchátkách jsou případné zázněje jen vjemové.';
  }
  return `Δf ${f} Hz → amplitudové zázněje přibližně ${f} Hz ${p}.`;
}

/**
 * The live example line of the current lesson in Czech (the component's topicExample), from the
 * same state the instrument's English topicExample reads.
 */
export function topicExampleShown(s) {
  const f = s.metricFrequencyIdle;
  switch (s.learnTopic) {
    case 'frequency': return `Nyní: ${formatFrequency(f)} = ${sig(f, 4)} kmitů za sekundu.`;
    case 'period': return `Nyní: ${formatFrequency(f)} → T = ${formatPeriod(f)}.`;
    case 'wavelength': return `Nyní: ${formatFrequency(f)} → λ ≈ ${formatWavelength(f)}.`;
    case 'amplitude': {
      const label = Object.hasOwn(GAIN_LABELS_SHOWN, s.gainLabel)
        ? GAIN_LABELS_SHOWN[s.gainLabel] : s.gainLabel;
      return `Nyní: logické zesílení ${s.gainLevel.toFixed(3)} (${label}), jen relativní úroveň.`;
    }
    case 'nyquist': case 'samplerate': {
      const rate = `${sig(s.effectiveSampleRate / 1000, 4)} kHz`;
      return `Toto zařízení: ${s.provisional ? `zatím nespuštěno (předpoklad ${rate})` : rate}`
        + ` → Nyquistův limit ${formatFrequency(s.nyquist)}.`;
    }
    case 'harmonic': case 'aliasing': {
      const n = Math.floor(s.nyquist / f);
      return `Nyní: ${formatFrequency(f)} → pod Nyquistův limit ${multiplesShown(n)}.`;
    }
    case 'beating': case 'interference':
      return `Dva oscilátory nyní: ${formatFrequency(s.dualFa)} + ${formatFrequency(s.dualFb)}. `
        + beatTextShown(s);
    case 'logscale': return `${formatFrequency(f)} → o oktávu výš je ${formatFrequency(f * 2)}.`;
    // the region of the Playground frequency, as the instrument's regionLabel
    default: return `Nyní: ${formatFrequency(f)} · ${regionShown(s.frequency).toLowerCase()}.`;
  }
}
