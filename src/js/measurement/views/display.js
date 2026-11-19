// What the page shows for the Measure workspace's state words (U115 pass 7b, the method of
// calibration/display.js, U114 b).
//
// The live quality bar's items and values (INPUT, NOISE, CLIPPING, SIGNAL, CAPTURE; NOT CHECKED
// YET, IDLE, …), the quality statuses (GOOD, USABLE, POOR, INVALID, NOT ASSESSED), the
// UNAVAILABLE words (UNKNOWN, NOT MEASURED, …) and the result views' badges (NORMALIZED, LIVE,
// PEAK HOLD, …) are the values the view models carry, the views' tests assert and saved
// experiments keep (the quality status). They stay English as data; the page shows each
// through this one map, in Czech. A word is replaced only as a whole, longest phrase first,
// never inside another word (the lesson of C3-590-1), and calibration states then go through
// calibrationShown, so a shown value never keeps an English state word.

import { calibrationShown } from '../../calibration/display.js';
import { LOOPBACK_LABEL } from '../capture.js';

/** Each English state word or phrase the Measure view models carry, with its Czech form. */
export const MEASURE_WORDS = Object.freeze({
  // The live bar's items.
  INPUT: 'VSTUP',
  NOISE: 'ŠUM',
  CLIPPING: 'OŘEZ',
  SIGNAL: 'SIGNÁL',
  CAPTURE: 'ZÁZNAM',
  // Their values.
  'NOT CHECKED YET': 'ZATÍM NEKONTROLOVÁNO',
  'NOT CHECKED': 'NEKONTROLOVÁNO',
  'STIMULUS PLAYING': 'STIMUL HRAJE',
  'PRE-CHECK': 'PŘEDBĚŽNĚ',
  'AT INPUT': 'NA VSTUPU',
  'AT RAIL': 'NA MEZI',
  'LEVEL ONLY': 'JEN ÚROVEŇ',
  IDLE: 'NEČINNÝ',
  CHECKING: 'KONTROLUJE SE',
  MEASURING: 'MĚŘÍ SE',
  ARMED: 'PŘIPRAVENO',
  ANALYZING: 'ANALÝZA',
  COMPLETE: 'HOTOVO',
  STOPPED: 'ZASTAVENO',
  ERROR: 'CHYBA',
  DENIED: 'ODEPŘENO',
  NONE: 'ŽÁDNÝ',
  HIGH: 'VYSOKÝ',
  DETECTED: 'ZJIŠTĚN',
  SILENT: 'TICHO',
  RECEIVED: 'PŘIJATO',
  DEFECT: 'VADA',
  LOST: 'ZTRACEN',
  TIMEOUT: 'VYPRŠEL ČAS',
  ACTIVE: 'AKTIVNÍ',
  WEAK: 'SLABÝ',
  // The quality statuses (quality.js) and the words for data that does not exist (§249).
  GOOD: 'DOBRÁ',
  USABLE: 'POUŽITELNÁ',
  POOR: 'SLABÁ',
  INVALID: 'NEPLATNÁ',
  'NOT ASSESSED': 'NEPOSOUZENO',
  'NOT MEASURED': 'NEZMĚŘENO',
  UNKNOWN: 'NEZNÁMO',
  UNAVAILABLE: 'NEDOSTUPNÉ',
  // TEST CONTEXT: the loopback's label (stored with a result as data) and the context's name.
  [LOOPBACK_LABEL]: 'TESTOVACÍ KONTEXT: digitální smyčka přes syntetický systém (bez mikrofonu, '
    + 'bez akustické cesty)',
  'TEST CONTEXT': 'TESTOVACÍ KONTEXT',
  // The result views' badges and series kinds.
  'NOISE CHECK SNAPSHOT': 'SNÍMEK KONTROLY ŠUMU',
  'NORMALIZATION NOT APPLIED': 'NORMALIZACE NEPOUŽITA',
  'PHASE NOT MEASURED': 'FÁZE NEZMĚŘENA',
  'ORIGINAL SCALE': 'PŮVODNÍ MĚŘÍTKO',
  'PEAK HOLD': 'DRŽENÍ ŠPIČEK',
  NORMALIZED: 'NORMALIZOVÁNO',
  OBSERVED: 'NAMĚŘENO',
  SNAPSHOT: 'SNÍMEK',
  FROZEN: 'ZMRAZENO',
  LIVE: 'ŽIVĚ',
  LINEAR: 'LINEÁRNĚ',
  OCTAVE: 'OKTÁVY',
  PHASE: 'FÁZE',
  WRAPPED: 'ZABALENÁ',
});

const escape = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// Whole words only: not after or before a letter of either alphabet, a digit, '_' or '-', so
// INPUT never matches inside INPUTS, INVALID inside a code like INVALID_CALIBRATION, nor a
// state word inside a Czech one.
const WORD = new RegExp(`(?<![\\wÀ-ž-])(?:${Object.keys(MEASURE_WORDS)
  .sort((a, b) => b.length - a.length).map(escape).join('|')})(?![\\wÀ-ž-])`, 'g');

/**
 * `text` as the page shows it: the calibration states first (calibrationShown keys whole
 * reasons by their exact English text), then every Measure state word left, in Czech. Text
 * with none is returned as it is.
 */
export function measureShown(text) {
  if (typeof text !== 'string' || !text) return text;
  return calibrationShown(text).replace(WORD, (w) => MEASURE_WORDS[w]);
}
