// Declarations: the command palette (src/index.html holds its empty dialog; ui/palette.js
// builds it and holds its part, createPalettePart): the dialog, its search field and its list
// of results (plan issue U130).
// Trace: scripts/ui-catalog/trace/palette.mjs.

import { defineComponent } from '../define.js';

export default [
  defineComponent({
    id: 'palette',
    kind: 'panel',
    label: 'Paleta příkazů',
    docs: 'Jedno hledání přes místa, akce, šablony, předvolby, riffy, záznamy, výuku '
      + 'i ovládací prvky.',
    state: { none: 'dialog skládá hledání a výsledky a sám žádnou hodnotu nevlastní' },
  }),
  defineComponent({
    id: 'palette.input',
    kind: 'param',
    label: 'Hledat v celé aplikaci',
    docs: 'Text hledání; šipky, Home a End vybírají výsledek, Enter ho otevře a Esc paletu '
      + 'zavře.',
    state: 'ui.paletteQuery',
    in: 'palette',
  }),
  defineComponent({
    id: 'palette.list',
    kind: 'choice',
    label: 'Výsledky',
    docs: 'Nalezené položky; klepnutí nebo Enter otevře položku u jejího vlastníka.',
    state: 'ui.paletteActive',
    in: 'palette',
  }),
];
