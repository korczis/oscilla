// T036 (304 R1, project.no-fake-science): the guided MEASURE header's Frequency indicator
// (data-osc measure.freqIndicator, src/index.html) states what the frequency profile covers of
// the measurement and never reads CALIBRATED for a profile that covers none of it. It follows
// the charts' rule (calibration/interpolate.js correctionCurve, no extrapolation; T017): against
// the completed result's grid, else against the requested sweep span f1-f2. Asserted on the pure
// frequencyIndicator (measurement/views/calibration-indicator.js) and on the real session getter
// (ui/measure/session.js measureDerivedPart) the header binds.
//   node --test tests/unit/measure-freq-indicator-coverage.test.mjs
// Fails on 81faf07a: measureFreqIndicator returns CALIBRATED whenever a profile is selected and
// in use, with no coverage check, and the module does not exist.

import test from 'node:test';
import assert from 'node:assert/strict';

import { createFrequencyProfile } from '../../src/js/calibration/profile.js';
import { applyFrequencyCorrection } from '../../src/js/calibration/interpolate.js';
import { MEASUREMENT_STATES as S } from '../../src/js/measurement/state-machine.js';
import { frequencyIndicator } from '../../src/js/measurement/views/calibration-indicator.js';
import { measureDerivedPart } from '../../src/js/ui/measure/session.js';

/** A 319-point log grid 100 Hz-10 kHz, the shape transfer.js hands the charts. */
const GRID = Float64Array.from({ length: 319 }, (_, i) => 100 * 100 ** (i / 318));
const P = (name, points) => createFrequencyProfile({ name, points });
const HIGH = P('Covers 12-16 kHz only', [[12000, 1], [16000, 2]]);
const ULTRA = P('Covers 30-40 kHz only', [[30000, 1], [40000, 2]]);
const ONE_POINT = P('One point at 1.5 kHz', [[1500, 3]]);
const PARTLY = P('Covers 1-16 kHz', [[1000, 0], [4000, 1], [16000, 2]]);
const WIDE = P('Covers 20 Hz-20 kHz', [[20, 0], [1000, 0.5], [20000, 1]]);

const NOT_CALIBRATED = (r, label) => {
  assert.equal(r.on, false, label);
  assert.match(r.text, /^UNCALIBRATED/, `${label}: ${r.text}`);
};

test('T036 a profile covering none of the measured grid reads UNCALIBRATED, as the charts do',
  () => {
    for (const p of [HIGH, ULTRA, ONE_POINT]) {
      // the charts' own coverage of this grid: nothing corrected
      const c = applyFrequencyCorrection(new Float64Array(GRID.length), GRID, p);
      assert.equal(c.covered.reduce((a, b) => a + b, 0), 0, p.name);
      const r = frequencyIndicator({ profile: p, inUse: true, frequencies: GRID });
      assert.equal(r.state, 'none', p.name);
      NOT_CALIBRATED(r, p.name);
      assert.equal(r.text, 'UNCALIBRATED (mimo pásmo)');
      assert.match(r.title, new RegExp(`„${p.name}“`));
      assert.match(r.title, /změřeno 100 Hz–10 kHz, korigováno 0 z 319 bodů\.$/);
    }
  });

test('T036 a partly covering profile names exactly the covered stretch; a full one is on', () => {
  const part = frequencyIndicator({ profile: PARTLY, inUse: true, frequencies: GRID });
  const c = applyFrequencyCorrection(new Float64Array(GRID.length), GRID, PARTLY);
  const count = c.covered.reduce((a, b) => a + b, 0);
  assert.ok(count > 0 && count < GRID.length);
  assert.deepEqual([part.state, part.on, part.text], ['partial', false,
    'CALIBRATED jen 1 kHz–10 kHz']);
  assert.match(part.title, new RegExp(`korigováno ${count} z 319 bodů`));
  const full = frequencyIndicator({ profile: WIDE, inUse: true, frequencies: GRID });
  assert.deepEqual([full.state, full.on, full.text], ['full', true, 'CALIBRATED 100 Hz–10 kHz']);
});

test('T036 before a result the requested span decides; a stretch of no width corrects nothing',
  () => {
    const at = (profile, span) => frequencyIndicator({ profile, inUse: true, span });
    NOT_CALIBRATED(at(ULTRA, [20, 20000]), 'ultra');
    NOT_CALIBRATED(at(ONE_POINT, [20, 20000]), 'one point');
    NOT_CALIBRATED(at(HIGH, [100, 10000]), 'high above the span');
    assert.equal(at(HIGH, [20, 20000]).text, 'CALIBRATED jen 12 kHz–16 kHz');
    assert.equal(at(WIDE, [20, 20000]).text, 'CALIBRATED 20 Hz–20 kHz');
    assert.equal(at(WIDE, [20, 20000]).on, true);
    // nothing known to compare with: never CALIBRATED
    const unknown = frequencyIndicator({ profile: WIDE, inUse: true, span: [NaN, 1] });
    assert.deepEqual([unknown.state, unknown.text, unknown.on], ['unknown', 'UNKNOWN', false]);
  });

test('T036 no profile, or one switched off, reads UNCALIBRATED', () => {
  for (const r of [frequencyIndicator({ profile: null, inUse: true, span: [20, 20000] }),
    frequencyIndicator({ profile: WIDE, inUse: false, span: [20, 20000] })]) {
    assert.deepEqual([r.state, r.text, r.on], ['off', 'UNCALIBRATED', false]);
  }
});

/** The session's derived getters on a component `meas`, as Alpine binds them. */
function header(ctx, meas) {
  const part = measureDerivedPart(ctx, {}, {});
  return Object.defineProperties({ meas }, Object.getOwnPropertyDescriptors(part));
}
const metaOf = (p) => ({ name: p.name, id: p.id, points: p.points.length });

test('T036 the MEASURE header getter: a completed result the profile does not cover reads '
  + 'UNCALIBRATED', () => {
  const ctx = { profile: HIGH, result: { state: S.COMPLETE, transfer: { frequencies: GRID } } };
  const cmp = header(ctx, { state: S.COMPLETE, evidenceRun: 1,
    cal: { useFrequency: true, profile: metaOf(HIGH) }, values: { f1: 100, f2: 10000 } });
  assert.equal(cmp.measureFreqIndicator, 'UNCALIBRATED (mimo pásmo)');
  assert.equal(cmp.measureFreqCoverage.on, false);
  // the same profile over a result it covers in part, and the setup before any result
  ctx.profile = PARTLY;
  cmp.meas.cal.profile = metaOf(PARTLY);
  assert.equal(cmp.measureFreqIndicator, 'CALIBRATED jen 1 kHz–10 kHz');
  ctx.result = null;
  cmp.meas.state = S.IDLE;
  ctx.profile = HIGH;
  cmp.meas.cal.profile = metaOf(HIGH);
  assert.match(cmp.measureFreqIndicator, /^UNCALIBRATED/, 'HIGH above the requested 100 Hz-10 kHz');
  cmp.meas.values = { f1: 20, f2: 20000 };
  assert.equal(cmp.measureFreqIndicator, 'CALIBRATED jen 12 kHz–16 kHz');
  cmp.meas.cal.useFrequency = false;
  assert.equal(cmp.measureFreqIndicator, 'UNCALIBRATED');
});
