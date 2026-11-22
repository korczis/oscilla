// The page frame's shared parts (owner order 2026-11-17, "každá stránka zarovnaná jinak"):
// the page header's breadcrumb comes from the registry and never repeats a name, and a
// workspace brought into view keeps the same top gap under the header as one that needed no
// scroll: the frame's scroll-pt equals its pt (F002 shell:main, tests/unit/pro-page-frame).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  FRAME_SCROLL_PT, GROUP_REGISTRY, groupCrumbOf, mainFrameOf, navGroupOf, ownsViewOf,
  WORKSPACE_IDS, WORKSPACE_LABELS,
} from '../../src/js/ui/shell.js';
import { PRO } from '../../src/js/ui/pro-classes.js';

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
  // F002 shell:main (Q110): <main> has no padding of its own; the frame's top padding is
  // PRO.page's pt, carried by <main> for a workspace whose panels stand in its grid and by the
  // view for a workspace with a view of its own. A card scrolled into view (scrollIntoView:
  // Show in Measure, a Related link) lands at <main>'s scroll padding, so that padding equals
  // the frame's pt in every workspace, a view's too; the Synth keeps its nav height. One
  // scroll-pt per workspace, never two.
  const tag = read('src/index.html').match(/<main\b[^>]*\bid="osc-main"[^>]*>/)[0];
  assert.match(tag, /:class="\[mainFrame\(\),/, '<main> binds its frame from shell.js');
  assert.ok(!/(?<![:\w-])class="[^"]*scroll-pt-/.test(tag),
    'no static scroll-pt competes with the bound one');
  const pt = PRO.page.split(/\s+/).find((c) => /^pt-/.test(c));
  // Below md the frame's top is PRO.pageView's max-md:!pt-N, and the scroll padding follows it.
  const phone = PRO.pageView.split(/\s+/).find((c) => /^max-md:!pt-/.test(c)).replace('!', '');
  assert.equal(FRAME_SCROLL_PT, `scroll-${pt} ${phone.replace('pt-', 'scroll-pt-')}`,
    'the scroll padding is the frame\'s pt, on a phone too');
  const panels = WORKSPACE_IDS.filter((id) => !ownsViewOf(id));
  const views = WORKSPACE_IDS.filter((id) => ownsViewOf(id) && id !== 'synth');
  assert.ok(panels.length > 0 && views.length > 0, 'the registry has both kinds');
  const scrollPts = (id) => mainFrameOf(id).split(/\s+/).filter((c) => /^scroll-pt-/.test(c));
  // 1. A panel workspace: <main>'s frame has a scroll-pt equal to its pt.
  for (const id of panels) {
    const frame = mainFrameOf(id).split(/\s+/);
    const own = frame.filter((c) => /^pt-/.test(c));
    assert.equal(own.length, 1, `${id}: <main>'s frame has one pt (${frame})`);
    assert.deepEqual(scrollPts(id), [`scroll-${own[0]}`], `${id}: scroll-pt equals pt`);
  }
  // 2. A view workspace: <main> carries no frame, and its scroll-pt equals the view's own pt
  //    (PRO.page's), so a card inside the view scrolled to the top keeps the same gap.
  for (const id of views) {
    assert.ok(!mainFrameOf(id).split(/\s+/).some((c) => /^p[xytb]?-/.test(c)),
      `${id}: <main> carries no padding`);
    assert.deepEqual(scrollPts(id), [`scroll-${pt}`], `${id}: scroll-pt equals the view's pt`);
  }
  // 3. The Synth keeps its bound value, the height of its sticky section nav
  //    (synth/nav-room.js), and <main>'s frame adds none beside it.
  assert.deepEqual(scrollPts('synth'), [], 'the Synth\'s frame adds no scroll-pt');
  const bound = [...tag.matchAll(/scroll-pt-\S*?(?=['\s])/g)].map((m) => m[0]);
  assert.deepEqual(bound, ['scroll-pt-[var(--osc-synth-nav-h,0px)]'],
    '<main> binds no scroll-pt of its own but the Synth\'s');
  assert.ok(tag.includes(
    "workspace === 'synth' && '!block !pt-0 scroll-pt-[var(--osc-synth-nav-h,0px)]'"),
  'the Synth binds scroll-pt to its nav height');
});
