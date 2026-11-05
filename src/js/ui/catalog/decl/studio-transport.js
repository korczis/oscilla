// Declarations: the Studio toolbar transport (ui/studio/transport-bar.js), shared by the Studio
// workspace's timeline toolbar. Trace: scripts/ui-catalog/trace/studio-transport.mjs.

import { enumParam, numberParam } from '../../../studio/nodes/common.js';
import { DEFAULT_TRANSPORT, TEMPO_RANGE } from '../../../studio/schema.js';
import { defineComponent } from '../define.js';

const SITE = 'src/js/ui/studio/transport-bar.js';

export default [
  defineComponent({
    id: 'studio.toolbar.transport',
    pattern: { template: 'studio.tl.{key}', keys: ['return', 'play', 'stop'], sites: [SITE] },
    kind: 'transport',
    label: 'Return, Play, Stop',
    docs: 'Starts, stops and rewinds the Studio transport from the timeline toolbar.',
    state: 'studio.transport',
    in: 'studio.tl.transport',
    related: ['studio.compact.play', 'studio.compact.stop'],
  }),
  defineComponent({
    id: 'studio.toolbar.loop',
    pattern: { template: 'studio.tl.{key}', keys: ['loop'], sites: [SITE] },
    kind: 'switch',
    label: 'Loop',
    docs: 'Turns the timeline loop region on or off for the next pass.',
    state: 'studio.model',
    in: 'studio.tl.transport',
    related: ['studio.compact.loop', 'studio.tl.loop-band'],
  }),
  defineComponent({
    id: 'studio.tl.transport',
    kind: 'panel',
    label: 'Studio transport',
    docs: 'Groups the transport keys, the clock, the time mode and the tempo of the Studio.',
    state: { none: 'a group holds its controls and owns no value' },
    in: 'studio.tl.root',
  }),
  defineComponent({
    id: 'studio.tl.time',
    kind: 'readout',
    label: 'Playhead position',
    docs: 'Shows the playhead position in seconds or in bars and beats.',
    state: 'studio.transport',
    in: 'studio.tl.transport',
  }),
  defineComponent({
    id: 'studio.tl.state',
    kind: 'readout',
    label: 'Transport state',
    docs: 'Names what the transport is doing now: stopped, playing or refused.',
    state: 'studio.transport',
    in: 'studio.tl.transport',
  }),
  defineComponent({
    id: 'studio.tl.mode-seconds',
    hooks: ['studio.tl.mode-musical'],
    kind: 'choice',
    label: 'Time mode',
    docs: 'Chooses whether the timeline counts in seconds or in bars and beats.',
    param: enumParam('timeMode', 'Time mode', [['seconds', 'SEC'], ['musical', 'BAR']],
      DEFAULT_TRANSPORT.timeMode),
    state: 'studio.model',
    in: 'studio.tl.transport',
  }),
  defineComponent({
    id: 'studio.tl.tempo',
    kind: 'param',
    label: 'Tempo',
    docs: 'Sets the Studio tempo in beats per minute for musical time.',
    param: numberParam('tempo', 'Tempo', { min: TEMPO_RANGE[0], max: TEMPO_RANGE[1], step: 1,
      unit: 'BPM', default: DEFAULT_TRANSPORT.tempo }),
    state: 'studio.model',
    in: 'studio.tl.transport',
    related: ['studio.inspector.settings'],
  }),
];
