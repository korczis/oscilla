'use strict';
// Open a workspace through the navigation, as a user does (#278 shows each lab panel in its own
// workspace only, not on the lighter Playground). The way there is the Pro sidebar's one,
// `shell.cjs` `navTo` (issue F002: the phone drawer, then a collapsed group, then the entry).
// Waits on the app's mode with a named deadline (project.bounded-test-timing).
const { until } = require('./wait.cjs');
const { navTo } = require('./shell.cjs');

async function openWorkspace(page, ws, label = 'browser') {
  await navTo(page, ws);
  await until(() => page.evaluate((w) => document.querySelector('#osc-app').dataset.mode === w, ws),
    { ms: 5000, what: `${label}: the ${ws} workspace opens from the navigation` });
}

module.exports = { openWorkspace };
