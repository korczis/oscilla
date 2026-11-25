// Declarations: the parameter fields of the generator (src/index.html; the one field template of
// ui/workbench.js ppFields and ppSet). The same select and text field carry pattern.param for the
// parameters of the pattern in sight and sweep.param in sweep mode (a bound data-osc), and the
// sweep direction select carries sweep.param statically (plan issue G001).
// Trace: scripts/ui-catalog/trace/pattern-params.mjs.

import { defineComponent } from '../define.js';

export default [
  defineComponent({
    id: 'pattern.param',
    kind: 'param',
    label: 'Parametr vzoru',
    docs: 'Nastaví jeden parametr zobrazeného vzoru, například začátek, konec nebo rychlost.',
    state: 'instrument.pp',
  }),
  defineComponent({
    id: 'sweep.param',
    kind: 'param',
    label: 'Parametr rozmítání',
    docs: 'Nastaví jedno pole zdroje rozmítání, od začátku a konce po křivku a směr.',
    state: 'instrument.sweep',
    related: ['pattern.param'],
  }),
];
