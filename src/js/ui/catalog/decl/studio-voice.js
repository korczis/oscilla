// Declarations: the Signal Path's Open in Studio (src/index.html) and the guard dialog it shows
// over unsaved Studio work (ui/studio/workspace/voice.js), plan issues G001 and V605.
// Trace: scripts/ui-catalog/trace/studio-voice.mjs.

import { defineComponent } from '../define.js';

export default [
  defineComponent({
    id: 'analysis.openInStudio',
    kind: 'action',
    label: 'Open in Studio',
    docs: 'Opens the drawn Playground voice as one unsaved Studio document, without sound.',
    state: 'studio.model',
    effect: { route: '#m=studio' },
    links: { opens: ['studio.voice.replace'] },
  }),
  defineComponent({
    id: 'studio.voice.lost',
    kind: 'readout',
    label: 'This would be lost',
    docs: 'Lists the unsaved Studio work that opening the voice would replace.',
    state: { none: 'the list is derived from the open Studio document' },
  }),
  defineComponent({
    id: 'studio.voice.replace',
    kind: 'action',
    label: 'Replace it',
    docs: 'Replaces the unsaved Studio document with the Playground voice.',
    state: 'studio.model',
    in: 'studio.voice.lost',
    links: { openedBy: ['analysis.openInStudio'] },
  }),
  defineComponent({
    id: 'studio.voice.keep',
    kind: 'action',
    label: 'Keep it',
    docs: 'Closes the dialog and keeps the Studio document as it is.',
    state: { none: 'keeping the open document changes nothing' },
    effect: { focus: 'the Open in Studio button' },
  }),
];
