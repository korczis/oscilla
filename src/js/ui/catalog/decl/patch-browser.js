// Declarations: the one patch library (ui/patch-browser.js, plan K102), mounted in the Studio's
// Projects and patches dialog and opened from the Synth and the Inspector. Its filters, active
// patch and typed name are the library keys of sources.js; Apply, Insert and Replace graph are
// one dispatch each; the per-patch actions and the save buttons of the capture sources (the XY
// pad's, K097) are built at run time and declared as patterns (plan issue G001).
// Trace: scripts/ui-catalog/trace/patch-browser.mjs.

import { XY_CATEGORY } from '../../../synth/xy.js';
import { defineComponent } from '../define.js';

const SITE = 'src/js/ui/patch-browser.js';

export default [
  defineComponent({
    id: 'library',
    kind: 'panel',
    label: 'Knihovna patchů',
    docs: 'Prochází tovární a uložené patche všech nástrojů, s filtry a hledáním.',
    state: { none: 'sekce rozvrhuje prohlížeč a žádnou hodnotu nevlastní' },
    links: { openedBy: ['synth.library', 'studio.inspector.presets.library'] },
  }),
  defineComponent({
    id: 'library.search',
    kind: 'param',
    label: 'Hledat patche',
    docs: 'Zúží seznam na patche, jejichž název obsahuje text, bez ohledu na velikost písmen.',
    state: 'library.query',
    in: 'library',
  }),
  defineComponent({
    id: 'library.instrument',
    kind: 'choice',
    label: 'Nástroj',
    docs: 'Zúží seznam na patche jednoho nástroje, u každého s jejich počtem.',
    state: 'library.instrument',
    in: 'library',
  }),
  defineComponent({
    id: 'library.tag',
    kind: 'choice',
    label: 'Štítek',
    docs: 'Zúží seznam na patche s jedním štítkem, u každého s jejich počtem.',
    state: 'library.tag',
    in: 'library',
  }),
  defineComponent({
    id: 'library.list',
    kind: 'choice',
    label: 'Patche',
    docs: 'Vypíše odpovídající patche; šipky posouvají výběr a Enter načte aktivní patch.',
    state: 'library.active',
    in: 'library',
  }),
  defineComponent({
    id: 'library.detail',
    kind: 'panel',
    label: 'Podrobnosti patche',
    docs: 'Popíše aktivní patch a nabídne způsoby, jak ho načíst.',
    state: { none: 'rámeček vykresluje aktivní patch a hodnotu nevlastní' },
    in: 'library',
  }),
  defineComponent({
    id: 'library.name',
    kind: 'readout',
    label: 'Název patche',
    docs: 'Jmenuje aktivní patch v čele jeho podrobností.',
    state: 'library.active',
    in: 'library.detail',
  }),
  defineComponent({
    id: 'library.detail.text',
    kind: 'readout',
    label: 'Popis patche',
    docs: 'Popíše aktivní patch, například styl, tempo a tóninu riffu.',
    state: { none: 'ukazuje text, který nese položka patche' },
    in: 'library.detail',
  }),
  defineComponent({
    id: 'library.inUse',
    kind: 'readout',
    label: 'Použito v tomto Studiu',
    docs: 'Označí patch, jehož uzly tento dokument Studia už obsahuje.',
    state: 'studio.model',
    in: 'library.detail',
  }),
  defineComponent({
    id: 'library.reason',
    kind: 'readout',
    label: 'Proč nejde Použít',
    docs: 'Říká, proč Použít nemůže tento patch tady nastavit a co udělat místo toho.',
    state: { none: 'vysvětluje odmítnutí a nic neupravuje' },
    in: 'library.detail',
  }),
  defineComponent({
    id: 'library.listen',
    kind: 'action',
    label: 'Poslech, Zastavit',
    docs: 'Jednou přehraje riff na jeho vlastním hlasu, nebo ho zastaví; nic se neuloží.',
    state: { none: 'poslech zní a nikdy se neukládá' },
    effect: { command: 'spustit nebo zastavit poslech riffu na AudioEngine' },
    in: 'library.detail',
  }),
  defineComponent({
    id: 'library.load',
    pattern: { template: 'library.{key}', keys: ['apply', 'insert', 'replace'], sites: [SITE] },
    kind: 'action',
    label: 'Použít, Vložit, Nahradit graf',
    docs: 'Načte aktivní patch do uzlů, které jmenuje, jako nové uzly, nebo jako celý graf.',
    state: 'studio.model',
    in: 'library.detail',
  }),
  defineComponent({
    id: 'library.save',
    kind: 'panel',
    label: 'Uložit předvolbu',
    docs: 'Nabídne pole názvu a tlačítko uložení každému zdroji, který umí zachytit svůj stav.',
    state: { none: 'skupina rozvrhuje jen ovládání uložení' },
    in: 'library',
  }),
  defineComponent({
    id: 'library.saveName',
    kind: 'param',
    label: 'Název předvolby',
    docs: 'Pojmenuje předvolbu, kterou příští stisk tlačítka uložení uloží do knihovny.',
    state: 'library.name',
    in: 'library.save',
  }),
  defineComponent({
    id: 'library.capture',
    pattern: { template: 'library.save.{key}', keys: [XY_CATEGORY], sites: [SITE] },
    kind: 'action',
    label: 'Uložit XY pad jako předvolbu',
    docs: 'Uloží současný stav zachytávaného zdroje jako patch, který se hned objeví v seznamu.',
    state: { none: 'zapisuje uložený záznam knihovny, ne cestu stavu' },
    effect: { command: 'uložit zachycenou předvolbu jako patch knihovny' },
    in: 'library.save',
  }),
  defineComponent({
    id: 'library.status',
    kind: 'readout',
    label: 'Stav knihovny',
    docs: 'Ohlásí, co udělalo poslední načtení, poslech nebo uložení, nebo proč bylo odmítnuto.',
    state: { none: 'hlásí jen poslední akci knihovny' },
    in: 'library',
  }),
];
