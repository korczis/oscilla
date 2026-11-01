// A control does what its name says (H004; links probe B6, B7, B8, B13 and B14 of the G1
// inventory):
//   - B6  the logo opens the Playground, and its description says so
//   - B7  the skip link names the workspace shown and targets the main region that holds it
//   - B8  the header "?" is named for the dialog it opens (the keyboard shortcuts)
//   - B13 the Export menu holds no Import item; the import stays in More, once
//   - B14 no element without an interactive role, a tabindex and a keyboard handler carries a
//         click handler
// The browser proof (the workspace, focus target or dialog each control reaches) is the
// `control-names` and `experiment-row-keyboard` checks of tests/browser/navigation.cjs.
//   node --test tests/unit/control-names.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import * as app from '../../src/js/ui/app.js';
import { MODAL_IDS } from '../../src/js/ui/dialogs.js';
import { WORKSPACE_LABELS } from '../../src/js/ui/shortcuts.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (rel) => readFileSync(path.join(ROOT, rel), 'utf8');
const HTML = read('src/index.html');

/** Every start tag of `html`, quote-aware (an attribute value may hold `>`). */
function startTags(html) {
  const re = /<([a-zA-Z][\w-]*)((?:\s+[^\s=>/]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?)*)\s*\/?>/g;
  const tags = [];
  let m;
  while ((m = re.exec(html))) {
    const attrs = {};
    const are = /([^\s=>/]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
    let a;
    while ((a = are.exec(m[2]))) attrs[a[1]] = a[2] ?? a[3] ?? a[4] ?? '';
    tags.push({ tag: m[1].toLowerCase(), attrs, index: m.index, end: m.index + m[0].length,
      line: html.slice(0, m.index).split('\n').length });
  }
  return tags;
}
const TAGS = startTags(HTML);
const textOf = (s) => s.replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').replace(/\s+/g, ' ')
  .trim();
/** The text content of the element whose start tag is `t` (no element of the same name nested). */
const contentOf = (t) => textOf(HTML.slice(t.end, HTML.indexOf(`</${t.tag}>`, t.end)));
const byAttr = (name, value) => TAGS.filter((t) => t.attrs[name] === value);
const one = (name, value) => {
  const found = byAttr(name, value);
  assert.equal(found.length, 1, `exactly one element with ${name}="${value}"`);
  return found[0];
};

test('B8: the header help control is named for the dialog it opens', () => {
  const btn = one('data-osc', 'header.help');
  const m = /^openDialog\('([^']+)'\)$/.exec(btn.attrs['@click'] || '');
  assert.ok(m, 'the header "?" opens a dialog');
  const dialog = one('id', MODAL_IDS[m[1]] || m[1]);
  assert.equal(dialog.tag, 'dialog');
  const title = contentOf(one('id', dialog.attrs['aria-labelledby']));
  assert.equal(title, 'Keyboard shortcuts');
  assert.equal(btn.attrs['aria-label'], title, 'its accessible name is the dialog title');
  assert.ok(!('title' in btn.attrs) || btn.attrs.title === title, 'no other name on hover');
});

test('B13: the Export menu holds no Import item; More holds the one import', () => {
  const menuItems = (menuId) => {
    const menu = one('id', menuId);
    const close = HTML.indexOf('</div>', menu.end);
    return TAGS.filter((t) => t.index > menu.end && t.index < close && t.attrs.role
      && t.attrs.role.startsWith('menuitem'));
  };
  const exportItems = menuItems('osc-export-menu');
  assert.ok(exportItems.length > 0, 'the Export menu is found');
  for (const t of exportItems) {
    assert.ok(!/import/i.test(contentOf(t)), `Export menu item "${contentOf(t)}" imports`);
    assert.ok(!/import/i.test(t.attrs['@click'] || ''), `${t.attrs['data-osc']} imports`);
    assert.match(contentOf(t), /^(Export|Copy) /, 'every Export item exports or copies');
  }
  const imports = TAGS.filter((t) => /importConfigClick\(/.test(t.attrs['@click'] || ''));
  assert.deepEqual(imports.map((t) => t.attrs['data-osc']), ['config.import'],
    'one config import control, in More');
  const overflow = one('id', 'osc-overflow-menu');
  assert.ok(imports[0].index > overflow.end && imports[0].index < HTML.indexOf('</div>',
    overflow.end), 'the import sits in More');
});

const NATIVE = new Set(['a', 'button', 'input', 'select', 'textarea', 'summary', 'option',
  'label']);
const INTERACTIVE_ROLES = new Set(['button', 'link', 'menuitem', 'menuitemcheckbox',
  'menuitemradio', 'tab', 'radio', 'checkbox', 'switch', 'option', 'slider']);
const handler = (attrs, event) => Object.keys(attrs).filter((k) => k === `@${event}`
  || k.startsWith(`@${event}.`) || k === `x-on:${event}` || k.startsWith(`x-on:${event}.`));

test('B14: no element without an interactive role and tabindex carries a click handler', () => {
  const clickable = TAGS.filter((t) => handler(t.attrs, 'click').length);
  assert.ok(clickable.length > 50, 'the click handlers of index.html are read');
  const bad = clickable.filter((t) => !NATIVE.has(t.tag)).filter((t) => {
    const role = t.attrs.role || '';
    const focusable = 'tabindex' in t.attrs || ':tabindex' in t.attrs;
    const keys = handler(t.attrs, 'keydown');
    const enter = keys.some((k) => /\.enter\b/.test(k)) || keys.some((k) => !k.includes('.'));
    return !INTERACTIVE_ROLES.has(role) || !focusable || !enter;
  }).map((t) => `${t.line}: <${t.tag} class="${t.attrs.class || ''}">`);
  assert.deepEqual(bad, []);
});

test('B14: a saved experiment\'s row body opens it by Enter and Space', () => {
  const row = TAGS.find((t) => t.attrs.class === 'osc-x-main' && t.attrs['@click']);
  assert.ok(row, 'the clickable row body');
  assert.equal(row.attrs.role, 'button');
  assert.equal(row.attrs.tabindex, '0');
  for (const k of ['@keydown.enter.prevent', '@keydown.space.prevent']) {
    assert.equal(row.attrs[k], row.attrs['@click'], `${k} does what the click does`);
  }
});

test('B7: the skip link targets the main region and names the workspace shown', () => {
  assert.equal(typeof app.skipLinkLabel, 'function', 'app.js exports skipLinkLabel');
  const skip = TAGS.find((t) => t.attrs.class === 'osc-skip');
  assert.ok(skip && skip.tag === 'a', 'the skip link');
  assert.ok(TAGS.findIndex((t) => t === skip) < TAGS.findIndex((t) => t.attrs['data-osc']),
    'it comes before every other control');
  const target = one('id', skip.attrs.href.replace(/^#/, ''));
  assert.equal(target.tag, 'main', 'it targets the main region');
  assert.equal(contentOf(skip), app.skipLinkLabel('playground'), 'the first paint is right');
  const labels = app.WORKSPACES.map((ws) => app.skipLinkLabel(ws));
  app.WORKSPACES.forEach((ws, i) => {
    assert.ok(labels[i].endsWith(WORKSPACE_LABELS[ws]), `${ws}: "${labels[i]}"`);
    assert.ok(!/instrument/i.test(labels[i]), `${ws}: "${labels[i]}" names the instrument`);
  });
  assert.equal(new Set(labels).size, labels.length, 'each workspace has its own label');
});

test('B7: the label follows the workspace (syncSkipLink, watched by the shell)', () => {
  assert.equal(typeof app.syncSkipLink, 'function', 'app.js exports syncSkipLink');
  const el = { textContent: '' };
  const main = { id: 'osc-main' };
  const doc = { querySelector: (s) => ({ main, 'a[href="#osc-main"]': el })[s] || null };
  app.syncSkipLink(doc, 'measure');
  assert.equal(el.textContent, app.skipLinkLabel('measure'));
  app.syncSkipLink(doc, 'studio');
  assert.equal(el.textContent, app.skipLinkLabel('studio'));
  assert.doesNotThrow(() => app.syncSkipLink({ querySelector: () => null }, 'about'));
  const src = read('src/js/ui/app.js');
  assert.match(src, /\$watch\('workspace',[^\n]*syncSkipLink\(document, /,
    'init() re-labels the skip link on every workspace change');
});

test('B6: the logo opens the Playground, and says so', () => {
  const brand = TAGS.find((t) => t.attrs.class === 'osc-brand');
  assert.ok(brand && brand.tag === 'a', 'the logo is a link');
  assert.equal(brand.attrs.href, '#m=playground', 'its address is the Playground');
  const name = textOf(brand.attrs['aria-label']);
  assert.ok(contentOf(brand).split(' ').every((w) => name.includes(w)),
    `"${name}" keeps the visible text "${contentOf(brand)}" (WCAG 2.5.3)`);
  // The name is the brand (a title surface of tests/unit/positioning-consistency.test.mjs); the
  // description, shown on hover, says where the link goes.
  assert.equal(name, 'OSCILLA · Interactive Sound & Frequency Lab');
  assert.equal(brand.attrs.title, 'Open the Playground', 'the description says where it goes');
  assert.equal(brand.attrs['x-bind'], 'homeLink()');
  const ui = app.createOscillaUi({ storedAnalysisTab: null });
  const calls = [];
  const self = { setWorkspace: (m, opts) => calls.push([m, opts]) };
  const click = ui.homeLink()['@click'];
  let prevented = 0;
  click.call(self, { button: 0, preventDefault: () => { prevented += 1; } });
  // A link, not a nav item: focus moves to the Playground heading (U010, cross-links.cjs).
  assert.deepEqual(calls, [['playground', { focusHeading: true }]]);
  assert.equal(prevented, 1, 'a plain click goes through the router');
  click.call(self, { button: 0, metaKey: true, preventDefault: () => { prevented += 1; } });
  assert.equal(calls.length, 1, 'a modified click is left to the browser');
});
