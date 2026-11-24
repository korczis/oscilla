// The tablists of src/index.html hold valid ARIA, and the Synth tabs are one roving tablist on
// the shared tabs model (the axe finding of 2026-11-24 on #m=synth: each Synth role=tab sat in an
// <li> under ul[role=tablist], so aria-required-parent x4, aria-required-children x1 and
// listitem x4; every tab was a Tab stop and the arrows did nothing).
//
// - Every role=tab of the page is a child of its role=tablist as the page renders it (an Alpine
//   <template> renders its content in its own place, so it is transparent): axe's
//   aria-required-parent, and the sibling set rovingKeydown (src/js/ui/app.js) walks.
// - The Synth tabs bind the same roving model as tab() of the Analysis tabs, through
//   synthTabBind (src/js/ui/workbench.js) over synth.tab: rovingKeydown on keydown, tabindex 0 on
//   the selected tab and -1 on the rest, a click selecting through synthTab; aria-controls names
//   the Synth tabpanel, which exists and is labelled by the selected tab.
// The keys themselves (arrows with wrap, Home, End, the yt= address and the shown panel) and
// axe on the running page are tests/browser/synth.cjs s-tabs.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseHtml } from './shell-lang.test.mjs';
import { createWorkbench } from '../../src/js/ui/workbench.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const HTML = fs.readFileSync(path.join(ROOT, 'src', 'index.html'), 'utf8');

function* walk(n) {
  yield n;
  for (const c of n.children || []) yield* walk(c);
}
/** The parent an element has once Alpine renders the page: a <template> is not an element. */
const renderedParent = (n) => {
  let p = n.parent;
  while (p && p.tag === 'template') p = p.parent;
  return p;
};
const nameOf = (n) => n.attrs['data-osc'] || n.attrs.id || n.attrs[':id'] || n.tag;

/** Every role=tab whose rendered parent is not a role=tablist, named with that parent. */
export function misplacedTabs(html) {
  const out = [];
  for (const n of walk(parseHtml(html))) {
    if (!n.attrs || n.attrs.role !== 'tab') continue;
    const p = renderedParent(n);
    if (!p || !p.attrs || p.attrs.role !== 'tablist') {
      out.push(`${nameOf(n)} in <${p ? p.tag : '?'}${p && p.attrs && p.attrs.role
        ? ` role=${p.attrs.role}` : ''}>`);
    }
  }
  return out;
}

const synthTabs = (tree) => [...walk(tree)].filter((n) => n.attrs
  && n.attrs['data-osc'] === 'synth.tab');

test('every role=tab of the page is a child of its role=tablist', () => {
  assert.deepEqual(misplacedTabs(HTML), []);
});

test('the measure sees a tab inside a list item and passes one beside its siblings', () => {
  const bad = '<ul role="tablist"><template x-for="t in x"><li><button role="tab" '
    + 'data-osc="x.tab">A</button></li></template></ul>';
  assert.deepEqual(misplacedTabs(bad), ['x.tab in <li>']);
  const good = '<div role="tablist"><template x-for="t in x"><button role="tab" '
    + 'data-osc="x.tab" :class="a => a > 1">A</button></template></div>';
  assert.deepEqual(misplacedTabs(good), []);
});

test('the Synth tabs bind the shared roving model with one Tab stop', () => {
  const tree = parseHtml(HTML);
  const tabs = synthTabs(tree);
  assert.equal(tabs.length, 1, 'one templated Synth tab button (x-for over synth.tabs)');
  const [t] = tabs;
  const list = renderedParent(t);
  assert.equal(list.attrs.role, 'tablist', 'the Synth tab sits directly in the tablist');
  assert.ok(list.attrs['aria-label'], 'the tablist is named');
  assert.equal(t.attrs['x-bind'], 'synthTabBind(t.id)', 'the tab binds the shared tabs model');
  for (const a of ['@keydown', ':tabindex', ':aria-selected', '@click', 'tabindex']) {
    assert.equal(t.attrs[a], undefined, `${a} comes from synthTabBind, not a second binding`);
  }
  const controls = t.attrs['aria-controls'];
  assert.ok(controls, 'each tab names the panel it controls');
  const panels = [...walk(tree)].filter((n) => n.attrs && n.attrs.id === controls);
  assert.equal(panels.length, 1, `one element with id ${controls}`);
  assert.equal(panels[0].attrs.role, 'tabpanel');
  assert.equal(panels[0].attrs['data-osc'], 'synth.panel', 'the Synth panel the tabs switch');
  assert.equal(panels[0].attrs[':aria-labelledby'], '\'osc-synth-tab-\' + synth.tab',
    'the panel is labelled by the selected tab');
});

/** A tablist of fake role=tab buttons as rovingKeydown reads them (ui/app.js). */
function fakeTablist(ids, cmp) {
  const parent = { querySelectorAll: (sel) => {
    assert.equal(sel, ':scope > [role="tab"]', 'rovingKeydown walks the tablist\'s own tabs');
    return items;
  } };
  const items = ids.map((id) => ({ id, parentElement: parent, focused: 0,
    getAttribute: (k) => (k === 'role' ? 'tab' : null),
    focus() { this.focused += 1; cmp.focus = id; },
    click() { bind(id)['@click'].call(cmp); } }));
  const bind = (id) => createWorkbench({}).synthTabBind(id);
  return items;
}

test('synthTabBind is the roving tabs model over synth.tab: one Tab stop, keys select', () => {
  const ids = ['panel', 'engines', 'xy', 'drums'];
  const picked = [];
  const cmp = { synth: { tab: 'panel' }, focus: null,
    synthTab(id) { picked.push(id); this.synth.tab = id; } };
  const wb = createWorkbench({});
  const items = fakeTablist(ids, cmp);
  const on = (id) => wb.synthTabBind(id);
  const stops = () => ids.filter((id) => on(id)[':tabindex'].call(cmp) === 0);
  const selected = () => ids.filter((id) => on(id)[':aria-selected'].call(cmp) === 'true');
  assert.deepEqual(stops(), ['panel']);
  assert.deepEqual(selected(), ['panel']);
  const key = (from, k) => {
    let prevented = false;
    const e = { key: k, currentTarget: items[ids.indexOf(from)],
      preventDefault() { prevented = true; } };
    on(from)['@keydown'].call(cmp, e);
    return prevented;
  };
  assert.ok(key('panel', 'ArrowRight'), 'a handled key is prevented');
  assert.deepEqual([cmp.synth.tab, cmp.focus, stops(), selected()],
    ['engines', 'engines', ['engines'], ['engines']], 'ArrowRight moves and selects');
  key('engines', 'ArrowLeft');
  key('panel', 'ArrowLeft');
  assert.equal(cmp.synth.tab, 'drums', 'ArrowLeft from the first wraps to the last');
  key('drums', 'ArrowRight');
  assert.equal(cmp.synth.tab, 'panel', 'ArrowRight from the last wraps to the first');
  key('panel', 'End');
  assert.equal(cmp.synth.tab, 'drums', 'End selects the last');
  key('drums', 'Home');
  assert.equal(cmp.synth.tab, 'panel', 'Home selects the first');
  assert.equal(key('panel', 'Enter'), false, 'a key the tablist does not own passes through');
  assert.deepEqual(picked, ['engines', 'panel', 'drums', 'panel', 'drums', 'panel'],
    'every move selected through synthTab, one call each');
  on('xy')['@click'].call(cmp);
  assert.deepEqual([cmp.synth.tab, stops()], ['xy', ['xy']], 'a click selects as a key does');
});
