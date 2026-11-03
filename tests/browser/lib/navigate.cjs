'use strict';
// Open a workspace through the navigation, as a user does: the item, or first its group (#278
// shows each lab panel in its own workspace only, not on the lighter Playground). Waits on the
// app's mode with a named deadline (project.bounded-test-timing).
const { until } = require('./wait.cjs');

async function openWorkspace(page, ws, label = 'browser') {
  const item = `[data-osc="nav.${ws}"]`;
  if (!(await page.isVisible(item))) {
    const group = await page.evaluate((s) => {
      const e = document.querySelector(s);
      const g = e && e.closest('[data-osc-nav-group]');
      return g ? g.dataset.oscNavGroup : null;
    }, item);
    if (group) await page.click(`[data-osc="nav-group.${group}"]`);
  }
  await page.click(item);
  await until(() => page.evaluate((w) => document.querySelector('#osc-app').dataset.mode === w, ws),
    { ms: 5000, what: `${label}: the ${ws} workspace opens from the navigation` });
}

module.exports = { openWorkspace };
