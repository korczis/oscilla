// Audio test matrix, section 79 of the V1 specification (docs/specs/oscilla-v1-sections-64-95.md;
// plan issue S079): 20 Hz, 40 Hz, 100 Hz, 440 Hz, 1 kHz, 4 kHz, 8 kHz, 15.5 kHz, 18 kHz, 20 kHz
// and a frequency just below Nyquist at 44.1 kHz and at 48 kHz, each checked for validation,
// formatted readout, period, wavelength, nearest note and frequency region, through the helpers
// the page uses (src/js/core) and through the instrument component that calls them.
//
// Expected values are written out by hand from the maths, not read back from the helpers:
// period 1 / f, wavelength 343 m/s / f (SPEED_OF_SOUND), the nearest equal-tempered note at
// A4 = 440 Hz with cents 1200 * log2(f / note), a tie rounding half up (8.575 m reads 8.58 m).
//   node --test tests/unit/audio-test-matrix.test.mjs

import test from 'node:test';
import assert from 'node:assert';

import {
  formatFrequency, formatPeriod, formatWavelength, limitsFor, parseFrequency, regionFor,
} from '../../src/js/core/frequency.js';
import { formatCents, nearestNote } from '../../src/js/core/music.js';
import { setFrequencyOn, defaultInstrumentState } from '../../src/js/core/config.js';
import { representability } from '../../src/js/core/safety.js';
import { createInstrument } from '../../src/js/core/instrument.js';

const RATES = [44100, 48000];

// f, the text a user types, readout, period, wavelength, note, MIDI number, cents, region.
const LISTED = [
  [20, '20', '20 Hz', '50 ms', '17.15 m', 'D#0', 15, 49, 'SUB-BASS'],
  [40, '40 hz', '40 Hz', '25 ms', '8.58 m', 'D#1', 27, 49, 'SUB-BASS'],
  [100, '100', '100 Hz', '10 ms', '3.43 m', 'G2', 43, 35, 'BASS'],
  [440, '440 Hz', '440 Hz', '2.27 ms', '0.78 m', 'A4', 69, 0, 'LOW MIDS'],
  [1000, '1k', '1.00 kHz', '1 ms', '34.3 cm', 'B5', 83, 21, 'MIDRANGE'],
  [4000, '4 kHz', '4.00 kHz', '250 µs', '8.58 cm', 'B7', 107, 21, 'PRESENCE'],
  [8000, '8khz', '8.00 kHz', '125 µs', '4.29 cm', 'B8', 119, 21, 'BRILLIANCE'],
  [15500, '15.5 kHz', '15.50 kHz', '64.5 µs', '2.21 cm', 'B9', 131, -34, 'VERY HIGH FREQUENCY'],
  [18000, '18k', '18.00 kHz', '55.6 µs', '1.91 cm', 'C#10', 133, 25, 'UPPER HEARING RANGE'],
  [20000, '20 kHz', '20.00 kHz', '50 µs', '1.72 cm', 'D#10', 135, 8, 'UPPER HEARING RANGE'],
];

// One hertz below Nyquist at each rate. The readout's 10 Hz resolution shows Nyquist's own
// text; the representability text is what says the request is above the 95 % digital limit.
const NEAR_NYQUIST = [
  [44100, 22049, '22049', '22.05 kHz', '45.4 µs', '1.56 cm', 'F10', 137, -24,
    'NOMINAL ULTRASONIC REGION', 20947.5, '20.95 kHz', '22.05 kHz'],
  [48000, 23999, '23999', '24.00 kHz', '41.7 µs', '1.43 cm', 'F#10', 138, 23,
    'NOMINAL ULTRASONIC REGION', 22800, '22.80 kHz', '24.00 kHz'],
];

function readouts(f, period, wavelength, name, midi, cents, region) {
  assert.strictEqual(formatPeriod(f), period, `period of ${f} Hz`);
  assert.strictEqual(formatWavelength(f), wavelength, `wavelength of ${f} Hz`);
  const n = nearestNote(f, 440);
  assert.deepStrictEqual([n.name, n.midi, n.cents], [name, midi, cents], `note of ${f} Hz`);
  assert.strictEqual(regionFor(f).label, region, `region of ${f} Hz`);
}

test('every listed frequency parses, reads out and maps to its period, wavelength, note, region',
  () => {
    for (const [f, typed, readout, period, wavelength, name, midi, cents, region] of LISTED) {
      assert.deepStrictEqual(parseFrequency(typed), { ok: true, value: f }, `parse "${typed}"`);
      assert.strictEqual(formatFrequency(f), readout, `readout of ${f} Hz`);
      readouts(f, period, wavelength, name, midi, cents, region);
    }
  });

test('every listed frequency is accepted unchanged at 44.1 and 48 kHz in HUMAN and ADVANCED', () => {
  for (const sampleRate of RATES) {
    const { nyquist, safeMax } = limitsFor(sampleRate);
    for (const [f, typed] of LISTED) {
      for (const rangeMode of ['human', 'advanced']) {
        const s = { ...defaultInstrumentState(), rangeMode };
        assert.strictEqual(setFrequencyOn(s, typed, {}, { sampleRate }), true);
        assert.strictEqual(s.frequency, f, `${f} Hz at ${sampleRate} in ${rangeMode}`);
        assert.strictEqual(s.freqError, '', `${f} Hz at ${sampleRate} in ${rangeMode}`);
        assert.strictEqual(s.freqText, formatFrequency(f, true));
      }
      assert.strictEqual(representability(f, nyquist, safeMax),
        `Requested ${formatFrequency(f)} is below the digital Nyquist limit `
        + `(${formatFrequency(nyquist)}): digitally representable.`);
    }
  }
});

test('a frequency just below Nyquist is clamped to the 95 % digital limit at 44.1 and 48 kHz',
  () => {
    for (const [sampleRate, f, typed, readout, period, wavelength, name, midi, cents, region,
      limit, limitText, nyquistText] of NEAR_NYQUIST) {
      const { nyquist, safeMax } = limitsFor(sampleRate);
      assert.strictEqual(nyquist, sampleRate / 2);
      assert.strictEqual(safeMax, limit);
      assert.ok(f < nyquist && f > safeMax, `${f} Hz lies between the limit and Nyquist`);
      assert.deepStrictEqual(parseFrequency(typed), { ok: true, value: f });
      assert.strictEqual(formatFrequency(f), readout);
      assert.strictEqual(formatFrequency(nyquist), nyquistText);
      readouts(f, period, wavelength, name, midi, cents, region);

      const s = { ...defaultInstrumentState(), rangeMode: 'advanced' };
      assert.strictEqual(setFrequencyOn(s, typed, {}, { sampleRate }), true);
      assert.strictEqual(s.frequency, limit);
      assert.strictEqual(s.freqError, `Above the ADVANCED range maximum (${limitText}).`);
      assert.strictEqual(representability(f, nyquist, safeMax),
        `Requested ${readout} is above the digital limit (95 % of Nyquist); it is clamped to `
        + `${limitText}.`);
    }
  });

test('the instrument component shows the same readouts for every row of the matrix', () => {
  const rows = [
    ...RATES.flatMap((rate) => LISTED.map((r) => [rate, ...r])),
    ...NEAR_NYQUIST.map(([rate, f, typed, readout, period, wavelength, name, midi, cents, region,
      limit]) => [rate, f, typed, readout, period, wavelength, name, midi, cents, region, limit]),
  ];
  for (const [sampleRate, f, typed, , period, wavelength, name, midi, cents, region, clamped]
    of rows) {
    const app = createInstrument({ engine: null });
    app.sampleRate = sampleRate;
    app.rangeMode = 'advanced';
    app.freqText = typed;
    app.applyFreqText();
    const shown = clamped ?? f;
    const at = `${typed} at ${sampleRate}`;
    assert.strictEqual(app.frequency, shown, at);
    assert.strictEqual(app.freqDisplay, formatFrequency(shown), at);
    if (clamped === undefined) {
      assert.strictEqual(app.freqError, '', at);
      assert.strictEqual(app.periodText, period, at);
      assert.strictEqual(app.wavelengthText, wavelength, at);
      assert.strictEqual(app.note.name, name, at);
      assert.strictEqual(app.note.midi, midi, at);
      assert.strictEqual(app.note.cents, cents, at);
      assert.strictEqual(formatCents(app.note.cents),
        cents === 0 ? '0 cents' : `${cents > 0 ? '+' : '−'}${Math.abs(cents)} cents`, at);
      assert.strictEqual(app.regionLabel, region, at);
    } else {
      assert.notStrictEqual(app.freqError, '', at);
      assert.strictEqual(app.regionLabel, regionFor(clamped).label, at);
    }
  }
});
