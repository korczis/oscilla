// Declarations: the Filter Lab parameters (the panel in src/index.html, its controller
// labs/filter-lab.js). The descriptors carry the lab's own ranges: cutoff and Q as the lab
// clamps them (charts/drag-math.js FILTER_DRAG), gain as audio/filters.js normalizeFilter
// clamps it, with the slider's ±24 dB as the display range. Defaults: labs/lab-defaults.js.
// Trace: scripts/ui-catalog/trace/filter-lab.mjs.

import { FILTER_TYPES } from '../../../audio/filters.js';
import { FILTER_DRAG } from '../../../charts/drag-math.js';
import { FILTER_DEFAULTS } from '../../../labs/lab-defaults.js';
import { boolParam, enumParam, frequencyParam, numberParam } from '../../../studio/nodes/common.js';
import { FILTER_TYPE_LABELS } from '../../../studio/nodes/processing.js';
import { defineComponent } from '../define.js';

export default [
  defineComponent({
    id: 'filter.enable',
    kind: 'switch',
    label: 'Filtr zapnutý',
    docs: 'Vloží bikvadratický filtr stránky Filtry do hlasu nástroje, nebo ho vyjme.',
    param: boolParam('enabled', 'Zapnuto', FILTER_DEFAULTS.enabled),
    state: 'lab.filter.enabled',
  }),
  defineComponent({
    id: 'filter.type',
    kind: 'choice',
    label: 'Typ filtru',
    docs: 'Volí odezvu filtru: dolní propust, horní propust, pásmová propust, pásmová zádrž, '
      + 'nebo špičkový.',
    param: enumParam('type', 'Typ', FILTER_TYPES.map((t) => [t, FILTER_TYPE_LABELS[t]]),
      FILTER_DEFAULTS.type),
    state: 'lab.filter.type',
    related: ['studio.node.filter'],
  }),
  defineComponent({
    id: 'filter.cutoff',
    hooks: ['filter.cutoffValue'],
    kind: 'param',
    label: 'Mezní kmitočet',
    docs: 'Nastaví mezní nebo střední kmitočet filtru na logaritmickém posuvníku.',
    param: frequencyParam('frequency', 'Mezní kmitočet', FILTER_DEFAULTS.frequency,
      { min: FILTER_DRAG.minHz, max: FILTER_DRAG.maxHz }),
    state: 'lab.filter.frequency',
  }),
  defineComponent({
    id: 'filter.q',
    hooks: ['filter.qValue'],
    kind: 'param',
    label: 'Q',
    docs: 'Nastaví rezonanci filtru: vyšší Q dává užší špičku.',
    param: numberParam('Q', 'Q', { min: FILTER_DRAG.qMin, max: FILTER_DRAG.qMax, scale: 'log',
      default: FILTER_DEFAULTS.Q }),
    state: 'lab.filter.Q',
  }),
  defineComponent({
    id: 'filter.gain',
    hooks: ['filter.gainGroup'],
    kind: 'param',
    label: 'Zesílení',
    docs: 'Nastaví zdůraznění nebo potlačení v decibelech; jen u špičkového typu.',
    param: numberParam('gain', 'Zesílení', { min: -40, max: 40, step: 0.5, unit: 'dB',
      default: FILTER_DEFAULTS.gain, softRange: [-24, 24] }),
    state: 'lab.filter.gain',
  }),
  defineComponent({
    id: 'filter.fullscreen',
    kind: 'fullscreen',
    label: 'Otevřít stránku Filtry',
    docs: 'Přepíná mezi stránkou Filtry a Playgroundem.',
    state: 'ui.workspace',
  }),
];
