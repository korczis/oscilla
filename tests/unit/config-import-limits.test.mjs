// C017 (finding persist-4): a config import whose values the labs limit says so, by name.
// parseConfigImport accepts any filter Q > 0 and ADSR time >= 0; the labs then clamp them (Q to
// 0.1..30, frequency to 20..min(20000, sampleRate * 0.475), attack to 2 s, decay and release to
// 5 s). The filter's upper bound depends on the running sample rate, so the comparison runs on
// the values the labs hold after the import, not on a parse-time table.
//   node --test tests/unit/config-import-limits.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  IMPORT_LIMIT_FIELDS, importNotice, limitedValues,
} from '../../src/js/ui/config-file.js';

test('limitedValues names each field whose applied value differs from the file', () => {
  const requested = {
    filter: { frequency: 21000, Q: 50, gain: 0 },
    envelope: { a: 10, d: 0.1, s: 0.5, r: 20 },
  };
  const applied = {
    filter: { frequency: 20000, Q: 30, gain: 0, type: 'lowpass' },
    envelope: { a: 2, d: 0.1, s: 0.5, r: 5 },
  };
  assert.deepEqual(limitedValues(requested, applied), [
    { field: 'filter.frequency', label: 'filter frequency', unit: 'Hz', requested: 21000,
      applied: 20000 },
    { field: 'filter.Q', label: 'filter Q', unit: '', requested: 50, applied: 30 },
    { field: 'envelope.a', label: 'envelope attack', unit: 's', requested: 10, applied: 2 },
    { field: 'envelope.r', label: 'envelope release', unit: 's', requested: 20, applied: 5 },
  ]);
});

test('limitedValues ignores absent sections, absent keys and float noise', () => {
  assert.deepEqual(limitedValues({}, { filter: { Q: 30 } }), []);
  assert.deepEqual(limitedValues({ filter: { Q: 50 } }, {}), [],
    'a section the lab did not apply is not reported as limited');
  assert.deepEqual(limitedValues({ filter: { Q: 0.7071067811865476 } },
    { filter: { Q: 0.7071067811865475 } }), []);
  assert.deepEqual(limitedValues({ envelope: { a: 0 } }, { envelope: { a: 0.001 } }).map(
    (l) => l.field), ['envelope.a'], 'a lower bound counts too');
  assert.deepEqual(limitedValues({ phaseStereo: { pan: 3 } }, { phaseStereo: { pan: 1 } })
    .map((l) => l.field), ['phaseStereo.pan']);
});

test('every compared field names a section, a key and a label', () => {
  for (const f of IMPORT_LIMIT_FIELDS) {
    assert.ok(['filter', 'envelope', 'phaseStereo'].includes(f.section), f.section);
    assert.equal(typeof f.key, 'string');
    assert.match(f.label, /\S/);
  }
});

test('importNotice keeps limited values apart from invalid ones', () => {
  assert.deepEqual(importNotice({ invalid: 0, limited: [] }),
    { level: 'success', message: 'All settings were restored.' });
  const limited = limitedValues({ filter: { Q: 50 }, envelope: { a: 10 } },
    { filter: { Q: 30 }, envelope: { a: 2 } });
  const only = importNotice({ invalid: 0, limited });
  assert.equal(only.level, 'warning');
  assert.equal(only.message, '2 value(s) were outside the supported range: '
    + 'filter Q limited to 30 (file: 50); envelope attack limited to 2 s (file: 10 s).');
  assert.doesNotMatch(only.message, /invalid/, 'a limited value was not invalid');
  const both = importNotice({ invalid: 1, limited });
  assert.equal(both.level, 'warning');
  assert.match(both.message, /^1 value\(s\) were invalid and kept at their previous setting\. /);
  assert.match(both.message, /filter Q limited to 30 \(file: 50\)/);
  assert.equal(importNotice({ invalid: 2, limited: [] }).message,
    '2 value(s) were invalid and kept at their previous setting.');
});
