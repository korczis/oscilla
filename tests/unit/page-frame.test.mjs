// The page frame's shared parts (owner order 2026-11-17, "každá stránka zarovnaná jinak"):
// the page header's breadcrumb comes from the registry and never repeats a name, and a
// workspace brought into view keeps the same top gap under the header as one that needed no
// scroll. The one Pro page frame for every workspace is the rest of F002 (shell:main).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  GROUP_REGISTRY, groupCrumbOf, navGroupOf, WORKSPACE_IDS, WORKSPACE_LABELS,
} from '../../src/js/ui/shell.js';

const ROOT = new URL('../..', import.meta.url).pathname;
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

test('the breadcrumb never repeats a name: a group crumb only where it adds one', () => {
  for (const id of WORKSPACE_IDS) {
    const g = navGroupOf(id);
    const crumb = groupCrumbOf(id);
    if (!g) {
      assert.equal(crumb, '', `${id} is top level`);
    } else if (GROUP_REGISTRY[g].label === WORKSPACE_LABELS[id]) {
      assert.equal(crumb, '', `${id} repeats its group's name, so no group crumb`);
    } else {
      assert.equal(crumb, GROUP_REGISTRY[g].label, `${id} sits in ${g}`);
    }
    assert.notEqual(crumb, WORKSPACE_LABELS[id]);
  }
  assert.equal(groupCrumbOf('synthesis'), '', 'Syntéza > Syntéza is gone');
  assert.equal(groupCrumbOf('presets'), GROUP_REGISTRY.synthesis.label);
});

test('the page header binds the registry\'s group crumb, not a label of its own', () => {
  const html = read('src/index.html');
  const header = html.slice(html.indexOf('data-osc="page.header"'), html.indexOf('</nav>',
    html.indexOf('data-osc="page.header"')));
  assert.match(header, /x-show="workspaceGroupLabel\(\)"/);
  assert.match(header, /x-text="workspaceGroupLabel\(\)"/);
  assert.match(read('src/js/ui/app.js'), /workspaceGroupLabel\(\) \{\s*return groupCrumbOf\(/);
});

test('a workspace scrolled into view keeps the scroller\'s top padding as its gap', () => {
  const css = read('src/styles/instrument.css').replace(/\/\*[\s\S]*?\*\//g, '');
  const main = css.match(/(^|\n)\.osc-main \{([^}]*)\}/);
  assert.ok(main, '.osc-main has its rule');
  const top = main[2].match(/padding:\s*(\S+)/)[1];
  const tag = read('src/index.html').match(/<main\b[^>]*\bid="osc-main"[^>]*>/)[0];
  // One scroll-pt per workspace, never two competing classes: the Synth keeps its own (the
  // height of its sticky nav), every other workspace takes main's padding-top.
  assert.ok(tag.includes(`workspace !== 'synth' && 'scroll-pt-[${top}]'`),
    `<main> binds scroll-pt-[${top}], its own padding-top, outside the Synth`);
  assert.ok(!/(?<![:\w-])class="[^"]*scroll-pt-/.test(tag),
    'no static scroll-pt competes with the bound one');
});
