// Declarations: the Studio Inspector's fields and buttons built by its helpers
// (ui/studio/inspector.js).
// Only the hooks built at run time are declared here, as patterns whose keys are the values
// the callers pass (plan issue G001). Trace: scripts/ui-catalog/trace/studio-inspector.mjs.

import { defineComponent } from '../define.js';

export default [
  defineComponent({
    id: 'studio.inspector.fields',
    pattern: { template: 'studio.inspector.{key}',
      keys: ['name', 'studioTitle', 'x', 'y', 'depth', 'offset', 'start', 'duration'],
      sites: ['src/js/ui/studio/inspector.js'] },
    kind: 'param',
    label: 'Name, Title, Position, Depth, Offset, Start, Duration',
    docs: 'Edits a property of the selected node, connection or clip, or the document title.',
    state: 'studio.model',
  }),
  defineComponent({
    id: 'studio.inspector.settings',
    pattern: { template: 'studio.inspector.{key}',
      keys: ['timeMode', 'tempo', 'beats', 'unit', 'loopStart', 'loopEnd'],
      sites: ['src/js/ui/studio/inspector.js'] },
    kind: 'param',
    label: 'Time, Tempo, Beats per bar, Beat unit, Loop start, Loop end',
    docs: 'Edits the transport and loop settings of the Studio document in the Inspector.',
    state: 'studio.model',
    related: ['studio.tl.tempo', 'studio.tl.mode-seconds'],
  }),
  defineComponent({
    id: 'studio.inspector.edits',
    pattern: { template: 'studio.inspector.{key}', keys: ['duplicate', 'delete', 'deleteEdge'],
      sites: ['src/js/ui/studio/inspector.js'] },
    kind: 'action',
    label: 'Duplicate, Delete, Delete connection',
    docs: 'Duplicates or deletes the selected node, clip or connection.',
    state: 'studio.model',
  }),
  defineComponent({
    id: 'studio.inspector.select',
    pattern: { template: 'studio.inspector.{key}', keys: ['selectFrom', 'selectTo'],
      sites: ['src/js/ui/studio/inspector.js'] },
    kind: 'action',
    label: 'Select source, Select target',
    docs: 'Moves the selection to either end of the selected connection.',
    state: 'studio.selection',
  }),
  defineComponent({
    id: 'studio.inspector.dialogs',
    pattern: { template: 'studio.inspector.{key}', keys: ['connect', 'savePatch'],
      sites: ['src/js/ui/studio/inspector.js'] },
    kind: 'open',
    label: 'Connect, Save as patch',
    docs: 'Opens the connection picker or the save-patch dialog for the selection.',
    state: { none: 'the dialog commits its own change when confirmed' },
    effect: { dialog: 'the connection picker or the save-patch dialog' },
  }),
  defineComponent({
    id: 'studio.inspector.permission',
    pattern: { template: 'studio.inspector.{key}', keys: ['allowMic'],
      sites: ['src/js/ui/studio/inspector.js'] },
    kind: 'action',
    label: 'Allow microphone',
    docs: 'Asks the browser for microphone permission for a Microphone node.',
    state: { none: 'the permission belongs to the browser, not to OSCILLA' },
    effect: { command: 'request microphone permission from the browser' },
  }),
];
