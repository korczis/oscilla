// Declarations: the workspace navigation (the sidebar of src/index.html, rendered from the one
// registry of ui/shell.js; ui/app.js navTopLevel). Every entry is built at run time from the
// registry, so both are patterns whose keys are the registry's own ids: a workspace entry
// nav.<workspace> and a group button nav-group.<group> (plan issues G001, F002).
// Trace: scripts/ui-catalog/trace/navigation.mjs.

import { GROUP_REGISTRY, WORKSPACE_IDS } from '../../shell.js';
import { defineComponent } from '../define.js';

export default [
  defineComponent({
    id: 'nav.groups',
    pattern: { template: 'nav-group.{key}', keys: Object.keys(GROUP_REGISTRY),
      sites: ['src/index.html', 'src/js/ui/app.js', 'src/js/ui/shell.js'] },
    kind: 'open',
    label: 'Analýza, Syntéza',
    docs: 'Otevře nabídku pracovních ploch seskupených pod jednou položkou navigace.',
    state: 'ui.navExpanded',
    in: 'sidebar',
  }),
  defineComponent({
    id: 'nav.workspaces',
    pattern: { template: 'nav.{key}', keys: [...WORKSPACE_IDS], sites: ['src/index.html'] },
    kind: 'open',
    label: 'Položka pracovní plochy',
    docs: 'Otevře svou pracovní plochu z postranního panelu, nebo z nabídky na telefonu, která '
      + 'se pak zavře.',
    state: 'ui.workspace',
    effect: { route: 'pracovní plocha dané položky' },
    in: 'sidebar',
  }),
];
