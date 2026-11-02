// Trace of the Flowbite Pro shell and the page header (plan issue G001, ADR 0081 decision 4):
// for each declaration of src/js/ui/catalog/decl/shell.js, the module that carries its hook, the
// plan issues, intent criteria and decisions it serves, and the tests that name its hooks
// (NAMED, not VERIFIED). The docs-only part: it lives outside src/, so the app never imports or
// bundles it.

const entry = (e) => ({ plan: ['G001', 'F002'], intents: ['component-system#contract-and-registry'],
  adrs: ['adr-0081', 'adr-0061'], source: 'src/index.html',
  tests: ['tests/unit/ui-catalog.test.mjs'], ...e });
const page = (e = {}) => entry({ plan: ['G001', 'U006'], ...e });

export default {
  header: entry(),
  'header.sidebar': entry(),
  'header.menu': entry({ tests: ['tests/unit/ui-catalog.test.mjs',
    'tests/unit/ui-flowbite-pro-shell.test.mjs', 'tests/browser/ui-flowbite-pro.cjs'] }),
  'header.brand': entry(),
  'header.search': entry({ tests: ['tests/unit/ui-catalog.test.mjs',
    'tests/unit/ui-flowbite-pro-shell.test.mjs'] }),
  'header.actions': entry(),
  shell: entry(),
  sidebar: entry(),
  'sidebar.search': entry(),
  'sidebar.noMatch': entry(),
  'sidebar.backdrop': entry({ tests: ['tests/unit/ui-catalog.test.mjs', 'tests/browser/app.cjs'] }),
  'nav.workspaces': entry({ tests: ['tests/unit/ui-catalog.test.mjs', 'tests/unit/v3-ui.test.mjs'] }),
  'shell.content': entry(),
  'page.header': page(),
  'page.home': page(),
  'page.title': page(),
  'page.summary': page(),
  'page.related': page(),
  'page.relatedLink': page(),
  'page.relatedMenu': page(),
  'page.relatedItem': page(),
  'page.actions': page(),
  'page.empty': page(),
  'page.emptyAction': page(),
};
