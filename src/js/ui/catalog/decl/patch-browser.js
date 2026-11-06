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
    label: 'Patch library',
    docs: 'Browses the factory and saved patches of every instrument, filtered and searched.',
    state: { none: 'the section lays out the browser and owns no value' },
    links: { openedBy: ['synth.library', 'studio.inspector.presets.library'] },
  }),
  defineComponent({
    id: 'library.search',
    kind: 'param',
    label: 'Search patches',
    docs: 'Narrows the list to the patches whose name holds the text, ignoring case.',
    state: 'library.query',
    in: 'library',
  }),
  defineComponent({
    id: 'library.instrument',
    kind: 'choice',
    label: 'Instrument',
    docs: 'Narrows the list to the patches of one instrument, with the count of each.',
    state: 'library.instrument',
    in: 'library',
  }),
  defineComponent({
    id: 'library.tag',
    kind: 'choice',
    label: 'Tag',
    docs: 'Narrows the list to the patches carrying one tag, with the count of each.',
    state: 'library.tag',
    in: 'library',
  }),
  defineComponent({
    id: 'library.list',
    kind: 'choice',
    label: 'Patches',
    docs: 'Lists the matching patches; the arrows move and Enter loads the active one.',
    state: 'library.active',
    in: 'library',
  }),
  defineComponent({
    id: 'library.detail',
    kind: 'panel',
    label: 'Patch detail',
    docs: 'Describes the active patch and offers the ways it can be loaded.',
    state: { none: 'the box renders the active patch and owns no value' },
    in: 'library',
  }),
  defineComponent({
    id: 'library.name',
    kind: 'readout',
    label: 'Patch name',
    docs: 'Names the active patch at the head of its detail.',
    state: 'library.active',
    in: 'library.detail',
  }),
  defineComponent({
    id: 'library.detail.text',
    kind: 'readout',
    label: 'Patch description',
    docs: 'Describes the active patch, such as the style, tempo and key of a riff.',
    state: { none: 'it shows the text the patch entry carries' },
    in: 'library.detail',
  }),
  defineComponent({
    id: 'library.inUse',
    kind: 'readout',
    label: 'In use in this Studio',
    docs: 'Marks a patch whose nodes this Studio document already holds.',
    state: 'studio.model',
    in: 'library.detail',
  }),
  defineComponent({
    id: 'library.reason',
    kind: 'readout',
    label: 'Why not Apply',
    docs: 'Says why Apply cannot set this patch here and what to do instead.',
    state: { none: 'it explains a refusal and edits nothing' },
    in: 'library.detail',
  }),
  defineComponent({
    id: 'library.listen',
    kind: 'action',
    label: 'Listen, Stop',
    docs: 'Auditions a riff once on its own voice, or stops it; nothing is saved.',
    state: { none: 'an audition plays and is never stored' },
    effect: { command: 'start or stop the riff audition on the AudioEngine' },
    in: 'library.detail',
  }),
  defineComponent({
    id: 'library.load',
    pattern: { template: 'library.{key}', keys: ['apply', 'insert', 'replace'], sites: [SITE] },
    kind: 'action',
    label: 'Apply, Insert, Replace graph',
    docs: 'Loads the active patch onto the nodes it names, as new nodes or as the whole graph.',
    state: 'studio.model',
    in: 'library.detail',
  }),
  defineComponent({
    id: 'library.save',
    kind: 'panel',
    label: 'Save a preset',
    docs: 'Offers a name field and a save button for each source that can capture its state.',
    state: { none: 'the group lays out the save controls only' },
    in: 'library',
  }),
  defineComponent({
    id: 'library.saveName',
    kind: 'param',
    label: 'Preset name',
    docs: 'Names the preset that the next save button press stores in the library.',
    state: 'library.name',
    in: 'library.save',
  }),
  defineComponent({
    id: 'library.capture',
    pattern: { template: 'library.save.{key}', keys: [XY_CATEGORY], sites: [SITE] },
    kind: 'action',
    label: 'Save the XY pad as a preset',
    docs: 'Saves the current state of a capture source as a patch, listed at once.',
    state: { none: 'it writes a stored library record, not a state path' },
    effect: { command: 'save the captured preset as a patch of the library' },
    in: 'library.save',
  }),
  defineComponent({
    id: 'library.status',
    kind: 'readout',
    label: 'Library status',
    docs: 'Announces what the last load, audition or save did, or why it was refused.',
    state: { none: 'it reports the last library action only' },
    in: 'library',
  }),
];
