// The page frame's shared parts (owner order 2026-11-17, "každá stránka zarovnaná jinak"):
// the page header's breadcrumb comes from the registry and never repeats a name, and a
// workspace brought into view keeps the same top gap under the header as one that needed no
// scroll: the frame's scroll-pt equals its pt (F002 shell:main, tests/unit/pro-page-frame).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  GROUP_REGISTRY, groupCrumbOf, mainFrameOf, navGroupOf, ownsViewOf, WORKSPACE_IDS,
  WORKSPACE_LABELS,
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

test('a workspace scrolled into view keeps the frame\'s top padding as its gap', () => {
  // F002 shell:main (Q110): <main> has no padding of its own; it carries the Pro page frame
  // (shell.js mainFrameOf) for a workspace whose panels stand in its grid, and a workspace with
  // a view of its own carries the frame on that view. One scroll-pt per workspace, never two.
  const tag = read('src/index.html').match(/<main\b[^>]*\bid="osc-main"[^>]*>/)[0];
  assert.match(tag, /:class="\[mainFrame\(\),/, '<main> binds its frame from shell.js');
  assert.ok(!/(?<![:\w-])class="[^"]*scroll-pt-/.test(tag),
    'no static scroll-pt competes with the bound one');
  const panels = WORKSPACE_IDS.filter((id) => !ownsViewOf(id));
  const views = WORKSPACE_IDS.filter(ownsViewOf);
  assert.ok(panels.length > 0 && views.length > 0, 'the registry has both kinds');
  // 1. A panel workspace: the frame's scroll-pt equals its pt, so scrollIntoView keeps the gap.
  for (const id of panels) {
    const frame = mainFrameOf(id).split(/\s+/);
    const pt = frame.filter((c) => /^pt-/.test(c));
    const spt = frame.filter((c) => /^scroll-pt-/.test(c));
    assert.equal(pt.length, 1, `${id}: <main>'s frame has one pt (${frame})`);
    assert.deepEqual(spt, [`scroll-${pt[0]}`], `${id}: scroll-pt equals pt (${frame})`);
  }
  // 2. A view workspace: <main> has no padding and no scroll-pt; the view's own top padding
  //    keeps the gap. The only other scroll-pt <main> binds is the Synth's below.
  for (const id of views) {
    assert.equal(mainFrameOf(id), '', `${id}: <main> carries no frame, so no scroll-pt`);
  }
  const bound = [...tag.matchAll(/scroll-pt-\S*?(?=['\s])/g)].map((m) => m[0]);
  assert.deepEqual(bound, ['scroll-pt-[var(--osc-synth-nav-h,0px)]'],
    '<main> binds no scroll-pt of its own but the Synth\'s');
  // 3. The Synth keeps its bound value: the height of its sticky section nav (synth/nav-room.js).
  assert.ok(tag.includes(
    "workspace === 'synth' && '!block !pt-0 scroll-pt-[var(--osc-synth-nav-h,0px)]'"),
  'the Synth binds scroll-pt to its nav height');
});
