// What the page shows for a calibration state (U114 b, oscilla-c3 under Q090, 2026-11-15).
//
// The calibration states stay English as data: 'UNCALIBRATED' and 'CALIBRATED' are the values
// level.js returns, the views put in their badges, saved experiments keep as reasons and the
// exports write, and the honesty tests (ADR 0017) and stored records rely on them. What the user
// sees goes through this one map: the badges and indicators, the reason sentence and the
// preset's title, in Czech. project.no-fake-science v3 lists these display forms beside the data
// values, and tests/unit/calibration-display.test.mjs refuses a shown badge that is bare English.

import {
  BINDING_WORDS, LEVEL_FROM_MICROPHONE, LEVEL_FROM_TEST_CONTEXT, LEVEL_NOT_VALID_TEXT,
  LEVEL_OFFSET_APPLIED_TEXT, LEVEL_PENDING_INDICATOR, LEVEL_PENDING_TEXT, NOT_REPORTED_TEXT,
  OTHER_DEVICE_TEXT, TAKEN_WITH, UNBOUND_REASON,
} from './level.js';
import { FREQUENCY_BADGES } from '../measurement/views/common.js';
import { CHARACTERIZE_PLAYBACK_CHAIN } from '../measurement/views/measure-flow.js';

/** Whole shown values, keyed by their exact data text. */
export const CALIBRATION_PHRASES = Object.freeze({
  [CHARACTERIZE_PLAYBACK_CHAIN.label]: 'PROMĚŘIT ŘETĚZEC PŘEHRÁVÁNÍ',
  [LEVEL_PENDING_INDICATOR]: 'ČEKÁ NA KONTROLU VSTUPU',
  [FREQUENCY_BADGES.NONE]: 'žádný (NEKALIBROVÁNO)',
  [FREQUENCY_BADGES.CALIBRATED]: 'KALIBROVÁNO (frekvence)',
  [FREQUENCY_BADGES.UNCALIBRATED]: 'NEKALIBROVÁNO (frekvence)',
  [LEVEL_OFFSET_APPLIED_TEXT]: 'KALIBROVÁNO (použit referenční posun)',
  [LEVEL_NOT_VALID_TEXT]: 'NEKALIBROVÁNO (kalibrace pro tento vstup neplatí)',
});

/** The state words inside a longer shown value ("CALIBRATED jen 1 kHz–8 kHz"). */
export const CALIBRATION_WORDS = Object.freeze({
  UNCALIBRATED: 'NEKALIBROVÁNO',
  CALIBRATED: 'KALIBROVÁNO',
});

/** The reason sentences with fixed text (level.js), keyed by the one copy of each. */
export const CALIBRATION_REASONS = Object.freeze({
  [LEVEL_FROM_TEST_CONTEXT]:
    'NEKALIBROVÁNO: kalibrace úrovně vznikla v TESTOVACÍM KONTEXTU (digitální smyčka, bez '
    + 'mikrofonu), takže pro mikrofonní vstup neplatí. Zůstává uložena pro TESTOVACÍ KONTEXT; '
    + 'pro tento vstup kalibrujte znovu.',
  [LEVEL_FROM_MICROPHONE]:
    'NEKALIBROVÁNO: kalibrace úrovně byla pořízena s mikrofonním vstupem, takže v TESTOVACÍM '
    + 'KONTEXTU (digitální smyčka, bez mikrofonu) neplatí. Zůstává uložena a platí znovu, '
    + 'jakmile se ten vstup po opuštění TESTOVACÍHO KONTEXTU zkontroluje.',
  [UNBOUND_REASON]:
    'NEKALIBROVÁNO: kalibrace úrovně není vázána na vstup (byla uložena bez vstupu, se kterým '
    + 'vznikla), takže nelze doložit, že platí pro tento. Pro tento vstup kalibrujte znovu.',
  [LEVEL_PENDING_TEXT]:
    'ČEKÁ NA KONTROLU VSTUPU: kalibrace úrovně se použije až poté, co kontrola nastavení nebo '
    + 'měření potvrdí vstup, se kterým byla pořízena; do té doby jsou úrovně relativní '
    + '(obdoba dBFS).',
});

/** level.js BINDING_WORDS in Czech, keyed by the same binding keys (BINDING_KEYS). */
export const BINDING_WORDS_SHOWN = Object.freeze({
  deviceId: 'vstupní zařízení',
  sampleRate: 'vzorkovací frekvence',
  echoCancellation: 'potlačení ozvěny',
  noiseSuppression: 'potlačení šumu',
  autoGainControl: 'automatické řízení zisku',
  channelCount: 'počet kanálů',
});
const ENGLISH_VALUE = Object.freeze({ on: 'zapnuto', off: 'vypnuto', [NOT_REPORTED_TEXT]: 'neuvedeno' });

/** One binding value as shown (level.js bindingValueText in Czech). */
function valueShown(field, v) {
  if (v === null || v === undefined) return 'neuvedeno';
  if (field === 'sampleRate') return `${v} Hz`;
  if (typeof v === 'boolean') return v ? 'zapnuto' : 'vypnuto';
  return String(v);
}

/** One { field, was, now } difference of levelCalibrationApplies, in Czech. */
function differenceShown({ field, was, now, shownText }) {
  if (shownText) return shownText;
  if (field === 'deviceId') return 'jiné vstupní zařízení';
  const word = BINDING_WORDS_SHOWN[field] ?? String(field);
  return `${word} při kalibraci ${valueShown(field, was)}, nyní ${valueShown(field, now)}`;
}

/** The reason built from its differences: the structure, never the English string. */
export function differencesReasonShown(differences) {
  return `NEKALIBROVÁNO: vstup se od kalibrace úrovně liší (${differences.map(differenceShown)
    .join('; ')}). Pro tento vstup kalibrujte znovu.`;
}

const escape = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const DIFFERENCES = new RegExp(`^${escape(TAKEN_WITH[0])}(.+)${escape(TAKEN_WITH[1])}$`);
const DIFFERENCE = /^(.+) at calibration, (.+) now$/;

/** A stored reason with no differences beside it, read back from level.js's English words. */
function storedDifference(text) {
  if (text === OTHER_DEVICE_TEXT) return { field: 'deviceId' };
  const m = DIFFERENCE.exec(text);
  if (!m) return null;
  const field = Object.keys(BINDING_WORDS).find((k) => m[1].startsWith(`${BINDING_WORDS[k]} `));
  if (!field) return null;
  const back = (v) => (Object.hasOwn(ENGLISH_VALUE, v) ? ENGLISH_VALUE[v] : v);
  return { shown: `${BINDING_WORDS_SHOWN[field]} při kalibraci `
    + `${back(m[1].slice(BINDING_WORDS[field].length + 1))}, nyní ${back(m[2])}` };
}

function storedReasonShown(text) {
  const m = DIFFERENCES.exec(text);
  if (!m) return null;
  const parts = m[1].split('; ').map(storedDifference);
  if (parts.some((p) => p === null)) return null;
  return differencesReasonShown(parts.map((p) => (p.shown ? { shownText: p.shown } : p)));
}

// One alternation, longest phrase first and not inside a word, so 'CALIBRATED (frequency)'
// never matches inside 'UNCALIBRATED (frequency)' (C3-590-1: "UNKALIBROVÁNO" reads as calibrated).
const PHRASE = new RegExp(`(?<![A-Za-z])(?:${Object.keys(CALIBRATION_PHRASES)
  .sort((a, b) => b.length - a.length).map(escape).join('|')})`, 'g');
const WORD = new RegExp(`\\b(${Object.keys(CALIBRATION_WORDS).join('|')})\\b`, 'g');

/**
 * `text` as the page shows it: a known reason or whole value in its Czech form, else every
 * calibration state word in it replaced, so the state is never dropped or softened: an
 * unknown reason starting "UNCALIBRATED:" still reads "NEKALIBROVÁNO: …". `differences`
 * (levelCalibrationApplies) builds the "taken with" reason from its structure; only a stored
 * reason without them is read back from its text. Text with none is returned as it is.
 */
export function calibrationShown(text, differences = null) {
  if (typeof text !== 'string' || !text) return text;
  if (Object.hasOwn(CALIBRATION_REASONS, text)) return CALIBRATION_REASONS[text];
  if (Object.hasOwn(CALIBRATION_PHRASES, text)) return CALIBRATION_PHRASES[text];
  if (Array.isArray(differences) && differences.length && DIFFERENCES.test(text)) {
    return differencesReasonShown(differences);
  }
  const stored = storedReasonShown(text);
  if (stored) return stored;
  return text.replace(PHRASE, (p) => CALIBRATION_PHRASES[p])
    .replace(WORD, (w) => CALIBRATION_WORDS[w]);
}
