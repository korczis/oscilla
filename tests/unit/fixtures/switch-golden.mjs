// The switch skin's golden (not a test file itself): every drawing and layout the core switch
// (src/js/ui/synth/switch.js) and the knob skin's switch and knob (knob.js controlSvg) make of
// one enum or boolean, over its values, zooms, states and dial options, and the panel's choice
// (synth/view/knob.js choiceLayout, choiceSvg, selectorSvg), as one SHA-256. The fixture
// (switch-golden.json) holds it for every enum and boolean of NODE_REGISTRY.list() as recorded
// at f523746a, before an option could carry a short legend, with each descriptor's options, so
// a later domain edit does not move the golden: ui-synth-switch-short.test.mjs redraws each
// recorded descriptor and holds the hash.
//
//   goldenOf(param) -> sha256 hex     registryParams() -> [{ node, param }]

import { createHash } from 'node:crypto';
import { switchLayout, switchStyle, switchSvg } from '../../../src/js/ui/synth/switch.js';
import { controlSvg } from '../../../src/js/ui/synth/knob.js';
import { choiceLayout, choiceSvg, selectorSvg } from '../../../src/js/synth/view/knob.js';
import { PANEL_TOKENS } from '../../../src/js/synth/view/tokens.js';
import { NODE_REGISTRY } from '../../../src/js/studio/registry.js';
// The core's token set as it was at f523746a: D-PAL's roles (the cap material, its ink, the LED)
// change the drawing on purpose (ui-synth-tokens.test.mjs), and a set without them draws as
// before, byte for byte, which this golden holds (it is the Synth panel's case until dev-53 maps
// the roles).
import { PRE_DPAL_TOKENS as TOKENS } from '../ui-synth-fixture.mjs';

const ZOOMS = [0.15, 0.25, 0.5, 1, 2, 3];
const STATES = (values) => [{ hover: true }, { focus: true }, { dragging: true },
  { disabled: true }, { focus: { option: values[0] }, hover: { option: values.at(-1) } }];
// The panel's set as it was at f523746a, before dev-53 mapped D-PAL (the cap material, its ink,
// the LED and the plate's own material): this golden holds the short legends' byte identity, and
// D-PAL's change of the drawing is ui-synth-tokens.test.mjs's.
const DPAL_PANEL = ['knobCap', 'knobCapHi', 'capInk', 'led'];
const PANEL = Object.fromEntries(Object.entries({ ...PANEL_TOKENS, plateHi: '--osc-surface-3',
  plateLo: '--osc-surface-1' }).filter(([k]) => !DPAL_PANEL.includes(k))
  .map(([k, n]) => [k, `var(${n})`]));
/** A layout without the accessible name an option carries since the short legend (`name`), so
 *  the golden of f523746a, which had none, compares. */
const layoutText = (L) => JSON.stringify(L, (k, v) => (k === 'name' ? undefined : v));

/** Every enum and boolean of the registry, with its node type. */
export function registryParams() {
  const out = [];
  for (const def of NODE_REGISTRY.list()) {
    for (const p of def.params) {
      if (p.type === 'enum' || p.type === 'boolean') out.push({ node: def.type, param: p });
    }
  }
  return out;
}

/** Everything the switch and knob skins and the panel's choice draw of `param`, hashed. */
export function goldenOf(param) {
  const h = createHash('sha256');
  const add = (s) => h.update(`${s}\n`);
  const values = param.type === 'boolean' ? [false, true] : param.options.map((o) => o[0]);
  const style = switchStyle(param);
  const dialOpts = style === 'rotary' || style === 'window'
    ? [{}, { numbers: true }, { numbers: false }, { numberLegends: true }, { knob: 32 },
      { knob: 32, numberLegends: true }]
    : [{}];
  for (const zoom of ZOOMS) {
    for (const o of dialOpts) {
      add(layoutText(switchLayout(param, { zoom, ...o })));
      // Every value at every zoom; every state at the default value (each state's markup is
      // the value's drawing and that state's parts, so one value shows them).
      for (const value of values) add(switchSvg({ value, param, tokens: TOKENS, zoom, ...o }));
      for (const state of STATES(values)) {
        add(switchSvg({ value: param.default, param, tokens: TOKENS, zoom, state, ...o }));
      }
      add(switchSvg({ value: param.default, param, tokens: TOKENS, zoom, legends: false, ...o }));
    }
    if (style === 'toggle') {
      add(layoutText(switchLayout(param, { zoom, led: true })));
      add(switchSvg({ value: values[1], param, tokens: TOKENS, zoom,
        led: { source: 'golden', lit: true } }));
    }
  }
  for (const value of values) {
    add(controlSvg({ kind: 'knob', value, param, tokens: TOKENS }));
    if (values.length <= 4) add(controlSvg({ kind: 'switch', value, param, tokens: TOKENS }));
    if (param.type === 'enum') add(choiceSvg({ value, param, tokens: PANEL }));
    add(selectorSvg({ value, param, tokens: PANEL }));
  }
  if (param.type === 'enum') add(layoutText(choiceLayout(param)));
  return h.digest('hex');
}
