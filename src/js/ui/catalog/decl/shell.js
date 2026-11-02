// Declarations: the Flowbite Pro admin shell (ui/shell.js, issue F002) and the page header
// derived from its WORKSPACE_REGISTRY (issue U006): the navbar, the sidebar with its search and
// phone drawer, the content area, the breadcrumb, the Related strip and the page's empty state.
// The workspace entries of the sidebar are built from the registry at run time, so they are one
// pattern whose keys are the registry's ids (plan issue G001).
// Trace: scripts/ui-catalog/trace/shell.mjs.

import { WORKSPACE_IDS } from '../../shell.js';
import { defineComponent } from '../define.js';

const panel = (id, label, docs, extra = {}) => defineComponent({ id, kind: 'panel', label, docs,
  state: { none: 'a region of the shell that holds other components' }, ...extra });
const readout = (id, label, docs, extra = {}) => defineComponent({ id, kind: 'readout', label,
  docs, state: { none: 'it shows text derived from the workspace registry' }, ...extra });

export default [
  panel('header', 'Navbar', 'The fixed top bar of the shell with the brand, search and actions.'),
  defineComponent({
    id: 'header.sidebar',
    kind: 'switch',
    label: 'Collapse sidebar',
    docs: 'Collapses the desktop sidebar to its icons, or expands it back to full labels.',
    state: 'ui.sidebarCollapsed',
    in: 'header',
  }),
  defineComponent({
    id: 'header.menu',
    kind: 'open',
    label: 'Open navigation',
    docs: 'Opens the phone navigation drawer that holds every workspace of the registry.',
    state: 'ui.drawerOpen',
    in: 'header',
  }),
  defineComponent({
    id: 'header.brand',
    kind: 'open',
    label: 'OSCILLA',
    docs: 'Returns to the Playground, the first workspace of the registry.',
    state: 'ui.workspace',
    effect: { route: 'playground' },
    in: 'header',
  }),
  defineComponent({
    id: 'header.search',
    kind: 'param',
    label: 'Find a workspace',
    docs: 'Filters the workspaces of the navbar search by their names and words.',
    state: 'ui.navQuery',
    in: 'header',
  }),
  panel('header.actions', 'Navbar actions', 'Holds the theme, help, overflow and settings buttons '
    + 'at the right of the navbar.', { in: 'header' }),
  panel('shell', 'Shell', 'The admin layout that places the sidebar beside the content area.'),
  panel('sidebar', 'Sidebar', 'Lists every workspace of the registry, grouped, with its icon.',
    { in: 'shell' }),
  defineComponent({
    id: 'sidebar.search',
    kind: 'param',
    label: 'Find a workspace (drawer)',
    docs: 'Filters the sidebar entries while the phone drawer is open.',
    state: 'ui.navQuery',
    in: 'sidebar',
  }),
  readout('sidebar.noMatch', 'No workspace matches', 'Says that the search matched no workspace '
    + 'of the registry.', { in: 'sidebar' }),
  defineComponent({
    id: 'sidebar.backdrop',
    kind: 'action',
    label: 'Close navigation',
    docs: 'Closes the phone drawer when the page behind it is tapped.',
    state: { none: 'a tap target that only closes the drawer' },
    effect: { command: 'close the phone navigation drawer' },
  }),
  defineComponent({
    id: 'nav.workspaces',
    pattern: { template: 'nav.{key}', keys: [...WORKSPACE_IDS], sites: ['src/index.html'] },
    kind: 'open',
    label: 'Workspace entries',
    docs: 'Opens one workspace; the sidebar builds one entry per row of the registry.',
    state: 'ui.workspace',
    in: 'sidebar',
  }),
  panel('shell.content', 'Content area', 'Scrolls the page header and the workspace views beside '
    + 'the sidebar.', { in: 'shell' }),
  panel('page.header', 'Page header', 'Shows the breadcrumb, summary, related pages and actions '
    + 'of the open workspace.', { in: 'shell.content' }),
  defineComponent({
    id: 'page.home',
    kind: 'open',
    label: 'Breadcrumb home',
    docs: 'Goes back to the Playground from the breadcrumb of the page header.',
    state: 'ui.workspace',
    effect: { route: 'playground' },
    in: 'page.header',
  }),
  readout('page.title', 'Workspace name', 'Names the open workspace in the breadcrumb.',
    { in: 'page.header' }),
  readout('page.summary', 'Workspace summary', 'Says in one sentence what the open workspace is '
    + 'for.', { in: 'page.header' }),
  panel('page.related', 'Related pages', 'Lists at most three workspaces the open one leads on '
    + 'to, each with a reason.', { in: 'page.header' }),
  defineComponent({
    id: 'page.relatedLink',
    kind: 'open',
    label: 'Related page',
    docs: 'Opens a related workspace from the strip of the page header.',
    state: 'ui.workspace',
    effect: { route: 'the related workspace of the registry row' },
    in: 'page.related',
  }),
  defineComponent({
    id: 'page.relatedMenu',
    kind: 'open',
    label: 'Related',
    docs: 'Opens the menu of related workspaces that replaces the strip on a phone.',
    state: { none: 'the menu is open only while it has focus' },
    effect: { dialog: 'the related pages menu' },
    in: 'page.header',
  }),
  defineComponent({
    id: 'page.relatedItem',
    kind: 'open',
    label: 'Related page (menu)',
    docs: 'Opens a related workspace from the phone menu of the page header.',
    state: 'ui.workspace',
    effect: { route: 'the related workspace of the registry row' },
    in: 'page.header',
  }),
  panel('page.actions', 'Page actions', 'Holds the actions the page header offers on every '
    + 'workspace.', { in: 'page.header' }),
  panel('page.empty', 'Empty state', 'Tells a workspace with nothing to show yet what to do '
    + 'first.', { in: 'shell.content' }),
  defineComponent({
    id: 'page.emptyAction',
    kind: 'open',
    label: 'Empty state action',
    docs: 'Opens the workspace the empty state suggests as the first step.',
    state: 'ui.workspace',
    effect: { route: 'the action target of the registry row' },
    in: 'page.empty',
  }),
];
