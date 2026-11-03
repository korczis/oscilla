// #314 review R-3 and R-10 (C018): every path that sets the Phase & Stereo lab (a preset load, a
// History recall, a `lab=` link and a config file all end in labs.phase.update -> setCfg) writes
// the Pan slider (value, its --osc-fill track and aria-valuetext) and the phase-offset field
// back, so the controls never show a stale value and the next slider touch keeps the restored
// pan; and a restored offset comes into the field's 0..359 domain. On the merge base setCfg
// wrote cfg and aria-valuetext only: the slider kept '0' and the field '45' after update().
// The lab is the real src/js/labs/phase-stereo.js mount() over a minimal fake DOM; only the p5
// import (the view, which needs a browser and is not mounted without its chart host) is a stub.
//   node --test tests/unit/phase-stereo-controls.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

register(`data:text/javascript,${encodeURIComponent(
  'export async function resolve(s, c, next) {'
  + ' if (s === "p5") return { url: "data:text/javascript,export default function p5() {}",'
  + ' shortCircuit: true };'
  + ' return next(s, c); }')}`);
const { mount, PHASE_DEFAULTS } = await import('../../src/js/labs/phase-stereo.js');
const { sliderFillPct } = await import('../../src/js/labs/dom.js');

/** An element with the parts the lab and labs/dom.js touch. */
function fakeEl(attrs = {}) {
  const props = new Map();
  const attr = new Map(Object.entries(attrs));
  const listeners = new Map();
  return {
    value: attr.has('value') ? attr.get('value') : '',
    min: attr.get('min'), max: attr.get('max'),
    dataset: {},
    classList: { contains: () => false },
    style: { setProperty: (k, v) => props.set(k, v), getPropertyValue: (k) => props.get(k) ?? '' },
    getAttribute: (k) => (attr.has(k) ? attr.get(k) : null),
    setAttribute: (k, v) => attr.set(k, String(v)),
    addEventListener: (t, fn) => listeners.set(t, [...(listeners.get(t) || []), fn]),
    removeEventListener: (t, fn) => {
      listeners.set(t, (listeners.get(t) || []).filter((f) => f !== fn));
    },
    fire(t) { for (const fn of listeners.get(t) || []) fn({ type: t, target: this }); },
  };
}

function mountLab() {
  const el = {
    '#osc-stereo-fa': fakeEl({ value: '440' }),
    '#osc-stereo-fb': fakeEl({ value: '442' }),
    // As src/index.html: min -1, max 1, value 0, fill 50 %; the offset field holds 45.
    '#osc-stereo-pan': fakeEl({ value: '0', min: '-1', max: '1', 'aria-valuetext': 'Centre' }),
    '[data-osc="phase.offset"]': fakeEl({ value: '45', min: '0', max: '359' }),
  };
  el['#osc-stereo-pan'].style.setProperty('--osc-fill', '50%');
  const root = fakeEl();
  root.querySelector = (sel) => el[sel] || null;
  root.querySelectorAll = () => [];
  const lab = mount(root, {});
  return { lab, pan: el['#osc-stereo-pan'], offset: el['[data-osc="phase.offset"]'] };
}

const priorDocument = globalThis.document;
test.before(() => { globalThis.document = { activeElement: null }; });
test.after(() => {
  if (priorDocument === undefined) delete globalThis.document;
  else globalThis.document = priorDocument;
});

test('a restore through update() writes the Pan slider (value, fill, valuetext) and the '
  + 'phase-offset field (#314 review R-3)', () => {
  const { lab, pan, offset } = mountLab();
  try {
    assert.equal(lab.config.phaseDeg, PHASE_DEFAULTS.phaseDeg);
    lab.update({ phaseDeg: 90, pan: 0.5 });
    assert.equal(lab.config.pan, 0.5);
    assert.equal(lab.config.phaseDeg, 90);
    assert.equal(pan.value, '0.5', 'the slider shows the restored pan');
    assert.equal(pan.style.getPropertyValue('--osc-fill'), '75.00%', 'its track is filled to it');
    assert.equal(pan.style.getPropertyValue('--osc-fill'), sliderFillPct(pan),
      'by the fill helper every lab slider uses');
    assert.equal(pan.getAttribute('aria-valuetext'), '50% right');
    assert.equal(offset.value, '90', 'the offset field shows the restored offset');
    // The next touch of the slider reads the slider: it keeps the restored pan.
    pan.fire('input');
    assert.equal(lab.config.pan, 0.5, 'a slider touch after the restore keeps 0.5');
    lab.update({ pan: -0.25 });
    assert.equal(pan.value, '-0.25');
    assert.equal(pan.style.getPropertyValue('--osc-fill'), '37.50%');
    assert.equal(pan.getAttribute('aria-valuetext'), '25% left');
    lab.update({ pan: 0 });
    assert.equal(pan.getAttribute('aria-valuetext'), 'Centre');
  } finally {
    lab.dispose();
  }
});

test('a restored offset comes into the field\'s 0..359 domain; the field is not overwritten '
  + 'while it is being edited (#314 review R-10)', () => {
  const { lab, offset } = mountLab();
  try {
    lab.update({ phaseDeg: 450 });
    assert.equal(lab.config.phaseDeg, 90, '450 degrees is 90');
    assert.equal(offset.value, '90');
    lab.update({ phaseDeg: -30 });
    assert.equal(lab.config.phaseDeg, 330);
    assert.equal(offset.value, '330');
    // A typed value takes the same path.
    offset.value = '725';
    offset.fire('change');
    assert.equal(lab.config.phaseDeg, 5);
    assert.equal(offset.value, '5');
    // setField leaves a field the user is typing in alone.
    globalThis.document.activeElement = offset;
    offset.value = '1';
    lab.update({ phaseDeg: 120 });
    assert.equal(lab.config.phaseDeg, 120);
    assert.equal(offset.value, '1', 'the focused field is not overwritten');
  } finally {
    globalThis.document.activeElement = null;
    lab.dispose();
  }
});
