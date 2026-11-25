// Declarations: the Studio toolbar transport (ui/studio/transport-bar.js), shared by the Studio
// workspace's timeline toolbar. Trace: scripts/ui-catalog/trace/studio-transport.mjs.

import { enumParam, numberParam } from '../../../studio/nodes/common.js';
import { DEFAULT_TRANSPORT, TEMPO_RANGE } from '../../../studio/schema.js';
import { defineComponent } from '../define.js';

const SITE = 'src/js/ui/studio/transport-bar.js';

export default [
  defineComponent({
    id: 'studio.bar',
    kind: 'panel',
    label: 'Lišta Studia',
    docs: 'Lišta Studia s přehráváním, soubory a přepínačem pohledů; ukotvená klávesnice ji nikdy '
      + 'nezakryje (#444).',
    state: { none: 'nese ovládání Studia; žádnou hodnotu nevlastní' },
  }),
  defineComponent({
    id: 'studio.armed',
    kind: 'readout',
    label: 'Klávesy zapnuté',
    docs: 'Ukazuje, že klávesy hrají běžící graf, i když časová osa stojí; Stop po Play je '
      + 'nechá zapnuté (K104).',
    state: 'studio.transport',
    in: 'studio.bar',
    related: ['synth.arm'],
  }),
  defineComponent({
    id: 'studio.toolbar.transport',
    pattern: { template: 'studio.tl.{key}', keys: ['return', 'play', 'stop'], sites: [SITE] },
    kind: 'transport',
    label: 'Na začátek, Přehrát, Zastavit',
    docs: 'Spustí, zastaví a vrátí na začátek transport Studia z lišty časové osy.',
    state: 'studio.transport',
    in: 'studio.tl.transport',
    related: ['studio.compact.play', 'studio.compact.stop'],
  }),
  defineComponent({
    id: 'studio.toolbar.loop',
    pattern: { template: 'studio.tl.{key}', keys: ['loop'], sites: [SITE] },
    kind: 'switch',
    label: 'Smyčka',
    docs: 'Zapne nebo vypne oblast smyčky časové osy pro další průchod.',
    state: 'studio.model',
    in: 'studio.tl.transport',
    related: ['studio.compact.loop', 'studio.tl.loop-band'],
  }),
  defineComponent({
    id: 'studio.tl.tap',
    kind: 'action',
    label: 'Tempo ťuknutím',
    docs: 'Nastaví tempo ze čtyř ťuknutí: jejich průměrný interval, jedna úprava tempa za sérii '
      + '(K068).',
    state: 'studio.transport',
    in: 'studio.tl.transport',
  }),
  defineComponent({
    id: 'studio.tl.transport',
    kind: 'panel',
    label: 'Transport Studia',
    docs: 'Seskupí tlačítka transportu, čas, režim času a tempo Studia.',
    state: { none: 'skupina drží svá ovládání a žádnou hodnotu nevlastní' },
    in: 'studio.tl.root',
  }),
  defineComponent({
    id: 'studio.tl.time',
    kind: 'readout',
    label: 'Pozice přehrávací hlavy',
    docs: 'Ukazuje pozici přehrávací hlavy v sekundách, nebo v taktech a dobách.',
    state: 'studio.transport',
    in: 'studio.tl.transport',
  }),
  defineComponent({
    id: 'studio.tl.state',
    kind: 'readout',
    label: 'Stav transportu',
    docs: 'Říká, co transport právě dělá: stojí, hraje, nebo byl odmítnut.',
    state: 'studio.transport',
    in: 'studio.tl.transport',
  }),
  defineComponent({
    id: 'studio.tl.mode-seconds',
    hooks: ['studio.tl.mode-musical'],
    kind: 'choice',
    label: 'Režim času',
    docs: 'Volí, zda časová osa počítá v sekundách, nebo v taktech a dobách.',
    param: enumParam('timeMode', 'Režim času', [['seconds', 'SEC'], ['musical', 'BAR']],
      DEFAULT_TRANSPORT.timeMode),
    state: 'studio.model',
    in: 'studio.tl.transport',
  }),
  defineComponent({
    id: 'studio.tl.tempo',
    kind: 'param',
    label: 'Tempo',
    docs: 'Nastaví tempo Studia v dobách za minutu pro hudební čas.',
    param: numberParam('tempo', 'Tempo', { min: TEMPO_RANGE[0], max: TEMPO_RANGE[1], step: 1,
      unit: 'BPM', default: DEFAULT_TRANSPORT.tempo }),
    state: 'studio.model',
    in: 'studio.tl.transport',
    related: ['studio.inspector.settings'],
  }),
];
