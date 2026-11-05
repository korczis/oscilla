// Trace of the Flowbite Pro admin shell (plan issue G001, ADR 0081 decision 4): for each
// declaration of src/js/ui/catalog/decl/shell.js, the module that carries its hook, the plan
// issues, intent criteria and decisions it serves, and the tests that name its hooks (NAMED, not
// VERIFIED). The navbar and the sidebar are F002's, the page header U006's. The docs-only part:
// it lives outside src/, so the app never imports or bundles it.

const entry = (e) => ({ plan: ['G001', 'F002'],
  intents: ['component-system#contract-and-registry'], adrs: ['adr-0081', 'adr-0061'],
  source: 'src/index.html', ...e });
const page = (e) => entry({ plan: ['G001', 'F002', 'U006'], ...e });
const CATALOG = 'tests/unit/ui-catalog.test.mjs';
const SHELL = 'tests/unit/ui-flowbite-pro-shell.test.mjs';
const PRO = 'tests/browser/ui-flowbite-pro.cjs';

export default {
  header: entry({ tests: [CATALOG, 'tests/browser/ui-current.cjs'] }),
  'header.sidebar': entry({ tests: [CATALOG, SHELL, PRO] }),
  'header.menu': entry({ tests: [CATALOG, SHELL, PRO, 'tests/browser/app.cjs'] }),
  'header.brand': entry({ tests: [CATALOG, SHELL, PRO, 'tests/unit/control-names.test.mjs',
    'tests/browser/navigation.cjs', 'tests/browser/cross-links.cjs'] }),
  'header.search': entry({ tests: [CATALOG, SHELL, PRO] }),
  'header.actions': entry({ tests: [CATALOG, SHELL, PRO, 'tests/browser/app.cjs'] }),
  shell: entry({ tests: [CATALOG] }),
  sidebar: entry({ tests: [CATALOG, PRO] }),
  'sidebar.search': entry({ tests: [CATALOG, PRO, 'tests/browser/app.cjs'] }),
  'sidebar.noMatch': entry({ tests: [CATALOG, PRO] }),
  'sidebar.backdrop': entry({ tests: [CATALOG, PRO, 'tests/browser/app.cjs',
    'tests/browser/control-census.cjs'] }),
  'shell.content': entry({ tests: [CATALOG] }),
  'page.header': page({ tests: [CATALOG, PRO] }),
  'page.home': page({ tests: [CATALOG, 'tests/browser/ui-current.cjs'] }),
  'page.title': page({ tests: [CATALOG, 'tests/browser/touch-audio.cjs'] }),
  'page.summary': page({ tests: [CATALOG] }),
  'page.related': page({ tests: [CATALOG] }),
  'page.relatedLink': page({ tests: [CATALOG, 'tests/unit/integration-map.test.mjs',
    'tests/browser/link-integrity.cjs', 'tests/browser/ui-current.cjs'] }),
  'page.relatedMenu': page({ tests: [CATALOG, 'tests/browser/app.cjs'] }),
  'page.relatedItem': page({ tests: [CATALOG, 'tests/browser/app.cjs',
    'tests/browser/ui-current.cjs'] }),
  'page.actions': page({ tests: [CATALOG] }),
  'page.empty': page({ tests: [CATALOG, 'tests/browser/ui-current.cjs'] }),
  'page.emptyAction': page({ tests: [CATALOG, 'tests/browser/app.cjs',
    'tests/browser/ui-current.cjs'] }),
};
