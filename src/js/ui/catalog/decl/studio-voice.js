// Declarations: the Signal Path's Open in Studio (src/index.html) and the guard dialog it shows
// over unsaved Studio work (ui/studio/workspace/voice.js), plan issues G001 and V605.
// Trace: scripts/ui-catalog/trace/studio-voice.mjs.

import { defineComponent } from '../define.js';

export default [
  defineComponent({
    id: 'analysis.openInStudio',
    kind: 'action',
    label: 'Otevřít ve Studiu',
    docs: 'Otevře nakreslený hlas Playgroundu jako jeden neuložený dokument Studia, bez zvuku.',
    state: 'studio.model',
    effect: { route: '#m=studio' },
    links: { opens: ['studio.voice.replace'] },
  }),
  defineComponent({
    id: 'studio.voice.lost',
    kind: 'readout',
    label: 'Co se ztratí',
    docs: 'Vypíše neuloženou práci ve Studiu, kterou by otevření hlasu nahradilo.',
    state: { none: 'seznam se odvozuje z otevřeného dokumentu Studia' },
  }),
  defineComponent({
    id: 'studio.voice.replace',
    kind: 'action',
    label: 'Nahradit',
    docs: 'Nahradí neuložený dokument Studia hlasem Playgroundu.',
    state: 'studio.model',
    in: 'studio.voice.lost',
    links: { openedBy: ['analysis.openInStudio'] },
  }),
  defineComponent({
    id: 'studio.voice.keep',
    kind: 'action',
    label: 'Ponechat práci ve Studiu',
    docs: 'Zavře dialog a ponechá dokument Studia, jak je.',
    state: { none: 'ponechání otevřeného dokumentu nic nemění' },
    effect: { focus: 'tlačítko Otevřít ve Studiu' },
  }),
];
