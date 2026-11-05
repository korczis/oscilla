// Reaching a workspace through the Flowbite Pro shell's sidebar (issue F002), shared by the
// browser suites so each one presses what a user presses and none keeps its own copy of the
// way there.
//
//   const shell = require('./lib/shell.cjs');
//   await shell.navTo(page, 'analyzer');   // opens the phone drawer and the group when needed
//
// On a desktop the sidebar is a column and its groups start expanded, so the item is pressed
// directly. On a phone or tablet the sidebar is a drawer: the menu button opens it first. A
// group the user collapsed is expanded through its own button. Every wait is a condition with a
// wall-clock deadline (rule project.bounded-test-timing).
'use strict';

const { until } = require('./wait.cjs');

const DRAWER_MS = 5000;

/** In-page: what stands between the user and nav item `sel`. */
function obstacle(sel) {
  const shown = (el) => !!el && el.getClientRects().length > 0
    && getComputedStyle(el).visibility !== 'hidden';
  const el = document.querySelector(sel);
  if (!el) return 'missing';
  if (shown(el)) return null;
  const sidebar = document.getElementById('osc-sidebar');
  if (!shown(sidebar)) return 'drawer';
  const g = el.closest('[data-osc-nav-group]');
  return g ? `group:${g.dataset.oscNavGroup}` : 'hidden';
}

/** Press the sidebar entry of workspace `ws` as a user would reach it. */
async function navTo(page, ws) {
  const item = `[data-osc="nav.${ws}"]`;
  let why = await page.evaluate(obstacle, item);
  if (why === 'drawer') {
    await page.click('[data-osc="header.menu"]');
    const after = await until(() => page.evaluate(obstacle, item)
      .then((w) => (w === 'drawer' ? null : w || 'reachable')),
    { ms: DRAWER_MS, what: `the drawer opens on nav.${ws}` });
    why = after === 'reachable' ? null : after;
  }
  if (why && why.startsWith('group:')) {
    await page.click(`[data-osc="nav-group.${why.slice(6)}"]`);
  }
  await page.click(item);
}

module.exports = { navTo, obstacle };
