// V3.1 Studio documentation stays true to the code (spec §221-§224; plan V432, V431):
//   - docs/v31/user-guide.md: the workflows of §223, the shortcut table equal to the ONE table in
//     code (graph-keys.js STUDIO_SHORTCUTS, which the in-app list renders) and the timeline keys
//     equal to timeline's KEY_HELP, and the Space table equal to shortcuts.js (ADR 0050)
//   - docs/v31/performance.md: the budget table equal to the budgets the tests enforce
//   - README.md's Studio section links the user guide and no longer lists search as missing
//   node --test tests/unit/v31-studio-docs.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { STUDIO_SHORTCUTS } from '../../src/js/ui/studio/graph-keys.js';
import { KEY_HELP } from '../../src/js/ui/studio/transport-view.js';
import { WORKSPACES } from '../../src/js/ui/app.js';
import { SPACE_MEANING, WORKSPACE_LABELS, spaceOwner } from '../../src/js/ui/shortcuts.js';
import { BROWSER_BUDGETS, PERF_BUDGETS } from './fixtures/v31-large-studio.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (rel) => readFileSync(path.join(ROOT, rel), 'utf8');

/** The lines between <!-- name:begin --> and <!-- name:end --> (trimmed, non-empty). */
function region(text, name) {
  const m = text.match(new RegExp(`<!-- ${name}:begin -->\\n([\\s\\S]*?)\\n<!-- ${name}:end -->`));
  assert.ok(m, `region ${name}`);
  return m[1].split('\n').map((l) => l.trim()).filter(Boolean);
}

test('§224 the user guide shortcut table is the one table in code, in its order', () => {
  const rows = region(read('docs/v31/user-guide.md'), 'shortcuts');
  assert.deepEqual(rows.slice(0, 2), ['| Keys | Action |', '| --- | --- |']);
  assert.deepEqual(rows.slice(2), STUDIO_SHORTCUTS.map((s) => `| ${s.keys} | ${s.text} |`));
});

test('§224 the user guide quotes the timeline keys the timeline shows', () => {
  assert.deepEqual(region(read('docs/v31/user-guide.md'), 'timeline-keys'), [KEY_HELP]);
});

test('W5 the user guide states what Space does in every workspace, as the code does', () => {
  const rows = region(read('docs/v31/user-guide.md'), 'space');
  assert.deepEqual(rows.slice(0, 2), ['| Workspaces | Space |', '| --- | --- |']);
  const groups = new Map();
  for (const ws of WORKSPACES) {
    const owner = spaceOwner(ws) || 'none';
    if (!groups.has(owner)) groups.set(owner, []);
    groups.get(owner).push(WORKSPACE_LABELS[ws]);
  }
  assert.deepEqual(rows.slice(2), [...groups].map(([owner, names]) =>
    `| ${names.join(', ')} | ${SPACE_MEANING[owner].text} |`));
});

test('§223 the user guide covers the workflows: create, connect, sequence, automate, patches, '
  + 'measurement template, render, find, transport settings', () => {
  const headings = read('docs/v31/user-guide.md').split('\n').filter((l) => l.startsWith('## '))
    .map((l) => l.slice(3));
  for (const h of ['Open Studio and start from a template', 'Create a node', 'Connect nodes',
    'Edit parameters', 'Find a node', 'Transport and document settings',
    'Sequence on the timeline', 'Automate a parameter', 'Save, export and patches',
    'Render WAV', 'Measure with the Measurement Sweep template', 'Keyboard shortcuts']) {
    assert.ok(headings.includes(h), `section "${h}"`);
  }
});

test('§145 the performance doc states the budgets the tests enforce', () => {
  const rows = region(read('docs/v31/performance.md'), 'budgets').slice(2);
  const expected = [
    ...Object.entries(PERF_BUDGETS).map(([k, v]) => `| ${k} | ${v.toFixed(1)} |`),
    ...Object.entries(BROWSER_BUDGETS).map(([k, v]) => `| browser ${k} | ${v.toFixed(1)} |`),
  ];
  assert.deepEqual(rows, expected);
});

test('§221 README links the Studio user guide and the performance notes', () => {
  const readme = read('README.md');
  const start = readme.indexOf('## The V3.1 Studio');
  const studio = readme.slice(start, readme.indexOf('\n## ', start + 5));
  assert.ok(studio.includes('(docs/v31/user-guide.md)'), 'user guide link');
  assert.ok(studio.includes('(docs/v31/performance.md)'), 'performance link');
  assert.ok(!/minimap and search/.test(studio), 'search is built (V428)');
});
