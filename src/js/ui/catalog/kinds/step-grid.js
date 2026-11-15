// The step-grid kind (plan issues W001 and W008, ADR 0086): lanes of steps over one notes clip.
// The grid is a projection of the clip's notes array: a lane is a note number (its name from the
// target's key map, else the note name), and a step that is on is a note at
// at = i x stepBeats of the clip's grid. Accent is vel >= ACCENT_VEL; ratchet is the note's r,
// probability its p, slide its slide. One gesture builds one CLIP_UPDATE of the notes array;
// a list-parameter lane builds one NODE_PARAM_SET per gesture. There is no steps clip.
// Its view and model are W008's (src/js/ui/kinds/), first mounted by the Studio Inspector's step
// grid of a selected notes clip (W008); K222's Drums view mounts it next.
//
// Version 2 (W008) declares the grid change, NOTES_GRID_SET of ADR 0086 decision 2 (keep, map
// or refuse), which the Studio exports since W008; version 1 (W001) had no grid event.

import { defineKind, prop } from '../kind.js';

/** The velocity at or above which a step is accented (ADR 0086 decision 3). */
const ACCENT_VEL = 0.8;

const NOTE_OR_PARAM = ['CLIP_UPDATE', 'NODE_PARAM_SET'];
const STEP_MENU = ['Shift+F10'];

const key = (chord, event, row) => ({ chord, event, row });

export default defineKind({
  kind: 'step-grid',
  version: 2,
  label: 'Kroková mřížka',
  docs: 'Upravuje klip not jako řady kroků: řada je číslo noty a zapnutý krok je nota na '
    + 'at = i × stepBeats; řada seznamového parametru upravuje jeden seznamový parametr uzlu.',
  props: [
    prop.enum('mode', 'Řady', [['notes', 'Řady klipu not'],
      ['param-list', 'Řada seznamového parametru']], 'notes'),
    prop.ref('clipId', 'Klip not'),
    prop.ref('nodeId', 'Uzel seznamového parametru'),
    prop.ref('paramKey', 'Seznamový parametr'),
    prop.list('lanes', 'Čísla not řad', { min: 0, max: 127, minLength: 1, maxLength: 16,
      default: [60] }),
    prop.integer('steps', 'Kroky', { min: 1, max: 64, default: 16 }),
    prop.number('stepBeats', 'Doby na krok', { min: 0.015625, max: 4, unit: 'dob',
      default: 0.25 }),
    prop.integer('page', 'Stránka', { min: 0, max: 63, default: 0 }),
    prop.list('selection', 'Vybrané kroky', { min: 0, max: 63, minLength: 0, maxLength: 2,
      default: [] }),
    prop.bool('disabled', 'Vypnuto', false),
  ],
  io: ['value', 'commit', 'transport.playhead', 'frame-loop', 'live-region', 'key-map'],
  events: [
    { name: 'move', emits: ['view'],
      does: 'Posune zaměřený krok po jeho řadě nebo na další řadu.' },
    { name: 'select', emits: ['view'],
      does: 'Rozšíří rozsah vybraných kroků; výběr drží vlastník.' },
    { name: 'toggle', emits: NOTE_OR_PARAM,
      does: 'Zapne nebo vypne zaměřený krok či každý vybraný krok jednou akcí.' },
    { name: 'paint', emits: NOTE_OR_PARAM, keyPath: ['Shift+ArrowRight', 'Enter'],
      does: 'Nastaví každý krok, přes který tah po řadě přejde, na nový stav prvního z nich.' },
    { name: 'value', emits: NOTE_OR_PARAM, keyPath: ['PageUp', 'PageDown'],
      does: 'Svislým tahem mění hodnotu kroku: sílu úhozu nebo hodnotu seznamového parametru.' },
    { name: 'transpose', emits: NOTE_OR_PARAM,
      does: 'Posune krok o půltón, se Shiftem o oktávu; řadu hodnot o její krok.' },
    { name: 'copy', emits: ['view'],
      does: 'Zkopíruje vybrané kroky do schránky pohledu, aniž by cokoli upravil.' },
    { name: 'cut', emits: NOTE_OR_PARAM,
      does: 'Zkopíruje vybrané kroky a jednou akcí je vypne.' },
    { name: 'paste', emits: NOTE_OR_PARAM,
      does: 'Vloží od zaměřeného kroku, oříznuto na konci řady, takže její délka zůstane.' },
    { name: 'clear', emits: NOTE_OR_PARAM,
      does: 'Vypne vybrané kroky; na prázdném kroku nevytvoří žádnou akci.' },
    { name: 'page', emits: ['view'],
      does: 'Ukáže předchozí nebo další stránku kroků; stránku drží vlastník.' },
    { name: 'menu', emits: ['view'],
      does: 'Otevře nabídku zaměřeného kroku: přízvuk, ratchet, pravděpodobnost a slide.' },
    { name: 'accent', emits: ['CLIP_UPDATE'], keyPath: STEP_MENU,
      does: `Přízvuk kroku zapíše jeho sílu úhozu na ${ACCENT_VEL} či výš, nebo pod ni.` },
    { name: 'ratchet', emits: ['CLIP_UPDATE'], keyPath: STEP_MENU,
      does: 'Nastaví ratchet noty r, jeden až osm stejných nástupů v její délce.' },
    { name: 'probability', emits: ['CLIP_UPDATE'], keyPath: STEP_MENU,
      does: 'Nastaví pravděpodobnost noty p, větší než nula a nejvýš jedna.' },
    { name: 'slide', emits: ['CLIP_UPDATE'], keyPath: STEP_MENU,
      does: 'Zapne nebo vypne slide noty, klouzání z předchozí noty.' },
    { name: 'grid', emits: ['NOTES_GRID_SET'], keyPath: STEP_MENU,
      does: 'Změní mřížku klipu (doby na krok, swing, seed) jednou akcí v režimu keep, map '
        + 'nebo refuse; noty se samy nikdy nepřesunou.' },
  ],
  keys: [
    key('ArrowLeft', 'move', 'step-grid-move'), key('ArrowRight', 'move', 'step-grid-move'),
    key('ArrowUp', 'move', 'step-grid-move'), key('ArrowDown', 'move', 'step-grid-move'),
    key('Shift+ArrowLeft', 'select', 'step-grid-select'),
    key('Shift+ArrowRight', 'select', 'step-grid-select'),
    key('Shift+ArrowUp', 'select', 'step-grid-select'),
    key('Shift+ArrowDown', 'select', 'step-grid-select'),
    key('Enter', 'toggle', 'step-grid-toggle'),
    key('Mod+C', 'copy', 'step-grid-clipboard'), key('Mod+X', 'cut', 'step-grid-clipboard'),
    key('Mod+V', 'paste', 'step-grid-clipboard'),
    key('Delete', 'clear', 'step-grid-clear'),
    key('PageUp', 'transpose', 'step-grid-transpose'),
    key('PageDown', 'transpose', 'step-grid-transpose'),
    key('Shift+PageUp', 'transpose', 'step-grid-transpose'),
    key('Shift+PageDown', 'transpose', 'step-grid-transpose'),
    key('[', 'page', 'step-grid-page'), key(']', 'page', 'step-grid-page'),
    key('Shift+F10', 'menu', 'step-grid-menu'), key('ContextMenu', 'menu', 'step-grid-menu'),
  ],
  pointer: {
    events: ['toggle', 'select', 'paint', 'value', 'menu', 'accent', 'ratchet', 'probability',
      'slide', 'grid'],
    rule: 'Klepnutí přepne krok, Shift s klepnutím rozšíří výběr, tah po řadě maluje, svislý '
      + 'tah na řadě hodnot ji nastaví a klepnutí pravým tlačítkem otevře nabídku.',
  },
  touch: {
    events: ['toggle', 'paint', 'value', 'menu', 'accent', 'ratchet', 'probability', 'slide',
      'grid'],
    rule: 'Ťuknutí přepne krok, vodorovný tah po řadě maluje, svislý tah na řadě hodnot ji '
      + 'nastaví a dlouhé podržení otevře nabídku kroku.',
  },
  state: ['studio.clip', 'notes'],
  links: { opens: ['route:studio'], openedBy: ['route:studio', 'route:synth'] },
  aria: {
    role: 'grid',
    parts: { lane: 'row', laneName: 'rowheader', step: 'gridcell' },
    name: 'Každá buňka gridcell nese název své řady, číslo kroku a stav, například '
      + '\'Kopák, krok 5, zapnuto\' nebo \'Krok 5, 0,50, zapnuto\'; aria-selected značí výběr '
      + 'a aria-current=step hraný krok.',
  },
  target: { min: 44 },
  layout: {
    '390x844': 'Osm kroků po 44 px na stránku, listuje se klávesami [ a ] nebo tlačítky '
      + 'stránek; název řady stojí nad ní, protože vedle osmi kroků se sloupec názvů nevejde.',
    '1536x1024': 'Šestnáct kroků na stránku, názvy řad vedle nich.',
  },
  live: true,
  reducedMotion: 'Při omezeném pohybu mění hraný krok jen obrys aria-current: žádný přechod, '
    + 'stopa ani pulz.',
  truth: { none: 'kreslí noty modelu a krok transportu, nikdy naměřenou hodnotu' },
  impl: { modules: ['src/js/ui/kinds/step-grid.js', 'src/js/ui/kinds/step-grid-model.js'],
    issue: 'W008' },
  // Mounted in the Studio Inspector (W008) and the Synth's Drums tab (K222).
  workspaces: ['studio', 'synth'],
  transient: ['focus', 'drag-preview', 'open-entry'],
  mount: { extras: [] },
  constants: { accentVel: ACCENT_VEL },
});
