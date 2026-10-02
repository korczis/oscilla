// Helpers that V1 templates called as script globals (inventory K1 / risk 1): formatFrequency,
// formatPeriod, formatWavelength, formatCents and sig, plus the related formatters. Inside an
// ES-module bundle they are out of Alpine's expression scope, so main.js must expose them, e.g.
//
//   for (const [name, fn] of Object.entries(TEMPLATE_HELPERS)) Alpine.magic(name, () => fn);
//     // template: $formatFrequency(frequency)
//   or Object.assign(component, TEMPLATE_HELPERS) / a `fmt` field
//     // template: formatFrequency(frequency) / fmt.formatFrequency(frequency)
//
// Every template expression of the V2 markup that uses one of these must be checked in the
// browser: a missing helper renders empty text and throws only at runtime.

import { clamp, round, sig } from './math.js';
import {
  formatFrequency, formatFrequencyShort, formatMs, formatPeriod, formatWavelength, regionFor,
} from './frequency.js';
import { formatCents, nearestNote } from './music.js';
import { gainLevelDb } from './config.js';

export const TEMPLATE_HELPERS = Object.freeze({
  formatFrequency,
  formatFrequencyShort,
  formatPeriod,
  formatWavelength,
  formatMs,
  formatCents,
  sig,
  round,
  clamp,
  regionFor,
  nearestNote,
  gainLevelDb,
});

/** Names V1 templates used directly (index.html@a7b7a23 markup); all are in TEMPLATE_HELPERS. */
export const V1_TEMPLATE_GLOBALS = Object.freeze([
  'formatFrequency', 'formatPeriod', 'formatWavelength', 'formatCents', 'sig',
]);
