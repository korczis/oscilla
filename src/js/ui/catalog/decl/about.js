// Declarations: the lists of the About workspace (src/index.html; the workspace list renders the
// registry of ui/shell.js through ui/app.js aboutWorkspaces, the roadmap is ui/about.js). The
// workspace items and their links are built at run time from the registry, so they are patterns
// whose keys are its ids; About's own item links nowhere. The roadmap is one readout whose phase
// lists and items are its `hooks` (plan issues G001, U002, U006).
// Trace: scripts/ui-catalog/trace/about.mjs.

import { WORKSPACE_IDS } from '../../shell.js';
import { defineComponent } from '../define.js';

export default [
  defineComponent({
    id: 'about.workspaces',
    kind: 'readout',
    label: 'Pracovní plochy',
    docs: 'Vypíše všechny pracovní plochy navigace v jejich pořadí a k čemu slouží.',
    state: { none: 'seznam vykresluje řádky rejstříku pracovních ploch' },
  }),
  defineComponent({
    id: 'about.workspace',
    pattern: { template: 'about.workspace.{key}', keys: [...WORKSPACE_IDS],
      sites: ['src/index.html'] },
    kind: 'readout',
    label: 'Položka pracovní plochy v seznamu',
    docs: 'Jmenuje jednu pracovní plochu seznamu a jednou větou řekne, k čemu slouží.',
    state: { none: 'položka je pevný text z rejstříku' },
    in: 'about.workspaces',
  }),
  defineComponent({
    id: 'about.open',
    pattern: { template: 'about.open.{key}', keys: WORKSPACE_IDS.filter((id) => id !== 'about'),
      sites: ['src/index.html'] },
    kind: 'open',
    label: 'Odkaz na pracovní plochu',
    docs: 'Otevře pracovní plochu, kterou jmenuje položka seznamu O aplikaci.',
    state: 'ui.workspace',
    effect: { route: 'pracovní plocha položky' },
    in: 'about.workspaces',
  }),
  defineComponent({
    id: 'about.next',
    hooks: ['about.next.now', 'about.next.next', 'about.next.later', 'about.next.milestone'],
    kind: 'readout',
    label: 'Co přijde dál',
    docs: 'Počítá hotové a požadované úkoly každého otevřeného milníku plánu.',
    state: { none: 'plán je datový soubor přibalený k sestavení' },
  }),
  defineComponent({
    id: 'about.next.later-toggle',
    kind: 'switch',
    label: 'Ukázat pozdější milníky',
    docs: 'Rozbalí milníky, které čekají na práci nad nimi, nebo je zase sbalí za jejich počet.',
    state: 'ui.aboutLaterOpen',
    in: 'about.next',
  }),
];
