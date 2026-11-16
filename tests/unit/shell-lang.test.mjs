// The page says it is Czech, and the English the shell still shows says it is English (plan U106,
// WCAG 3.1.1 and 3.1.2, rule project.czech-prose, Q104; decided by oscilla-c3 under Q090,
// 2026-11-15). <html lang="cs">, and in the shell (the navbar, the sidebar with its
// navigation, the page header with its breadcrumb, and the status bar: c3's point 4) every text
// node, every user-facing attribute and every string literal of a bound one that reads as English
// has an element with lang="en" at or above it. The panels inside <main> stay under the
// czech-prose ratchet (tests/unit/czech-prose*.test.mjs), not under this test.
//
// The kept names (c3's point 2, option a): Studio, Synth and Playground stay as names. They
// carry lang="en" only where they stand alone as a label (the nav item, the page header, the
// breadcrumb); a Czech sentence that declines one ("v Playgroundu", "Otevřít Playground") stays
// Czech text without lang, because a lang span over a Czech-inflected word reads worse than the
// Czech voice does. The registry rows of the kept names carry lang: 'en' and the shell binds it.
//
// The regions are the shell's own: every panel the shell's catalogue declares
// (src/js/ui/catalog/decl/shell.js) whose element lies outside <main> and holds no <main>, plus
// the page's contentinfo landmark (a <footer> outside <main> and sectioning content), which is
// the status bar. Nothing here counts or names them by hand; the sanity check below only asks
// that the derivation still finds a banner, a navigation, the breadcrumb and a contentinfo.
// English is what the czech-prose measures call English (scripts/czech-prose.mjs isEnglishProse,
// scripts/czech-prose-short.mjs isShortEnglish).
//
// Fail-first: OSC_SHELL_LANG_ROOT=<dir> runs the same checks over another tree's src/
// (`git archive <rev> src | tar -x -C <dir>`), so main's lang="en" page can be shown failing.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { isEnglishProse } from '../../scripts/czech-prose.mjs';
import { isShortEnglish } from '../../scripts/czech-prose-short.mjs';
import { lexJs } from '../../scripts/ui-catalog/scan.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const ROOT = process.env.OSC_SHELL_LANG_ROOT ? path.resolve(process.env.OSC_SHELL_LANG_ROOT)
  : REPO;
const HTML = readFileSync(path.join(ROOT, 'src/index.html'), 'utf8');
const load = (rel) => import(pathToFileURL(path.join(ROOT, rel)).href);
const shell = await load('src/js/ui/shell.js');
const decl = (await load('src/js/ui/catalog/decl/shell.js')).default;

/** The names c3 kept (Q090, point 2): labels, never translated, standing alone with lang="en". */
const KEPT_NAMES = ['Playground', 'Studio', 'Synth'];
const isEnglish = (t) => isEnglishProse(t) || isShortEnglish(t);
const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta',
  'source', 'track', 'wbr']);
const SECTIONING = new Set(['article', 'aside', 'main', 'nav', 'section']);
const SHOWN_ATTRS = ['aria-label', 'title', 'placeholder', 'alt'];
const BOUND = /^(?:x-text|x-html|:aria-label|:title|:placeholder|:alt)$/;

const decode = (s) => s.replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&#39;/g, '\'').replace(/&amp;/g, '&');

/**
 * The element tree of an HTML page, attribute values read whole (Alpine expressions hold `>`):
 * { tag, attrs, children, parent, text? }. Comments, <script> and <style> are dropped.
 */
export function parseHtml(html) {
  const rootNode = { tag: '#root', attrs: {}, children: [], parent: null };
  let node = rootNode;
  let i = 0;
  const pushText = (t) => {
    if (t.trim()) node.children.push({ tag: '#text', text: t, parent: node });
  };
  while (i < html.length) {
    const lt = html.indexOf('<', i);
    if (lt < 0) { pushText(html.slice(i)); break; }
    pushText(html.slice(i, lt));
    if (html.startsWith('<!--', lt)) { i = html.indexOf('-->', lt) + 3; continue; }
    if (html[lt + 1] === '!') { i = html.indexOf('>', lt) + 1; continue; }
    const close = html[lt + 1] === '/';
    let j = lt + (close ? 2 : 1);
    const nameM = /^[A-Za-z][\w:-]*/.exec(html.slice(j));
    if (!nameM) { pushText('<'); i = lt + 1; continue; }
    const tag = nameM[0].toLowerCase();
    j += nameM[0].length;
    const attrs = {};
    let selfClosing = false;
    while (j < html.length && html[j] !== '>') {
      if (/\s/.test(html[j])) { j += 1; continue; }
      if (html[j] === '/' && html[j + 1] === '>') { selfClosing = true; j += 1; continue; }
      const a = /^[^\s=>/]+/.exec(html.slice(j));
      if (!a) { j += 1; continue; }
      j += a[0].length;
      let value = '';
      if (html[j] === '=') {
        j += 1;
        const q = html[j];
        if (q === '"' || q === '\'') {
          const end = html.indexOf(q, j + 1);
          value = html.slice(j + 1, end);
          j = end + 1;
        } else {
          const v = /^[^\s>]*/.exec(html.slice(j))[0];
          value = v;
          j += v.length;
        }
      }
      attrs[a[0]] = value;
    }
    i = j + 1;
    if (close) {
      let n = node;
      while (n && n.tag !== tag) n = n.parent;
      if (n && n.parent) node = n.parent;
      continue;
    }
    const el = { tag, attrs, children: [], parent: node };
    node.children.push(el);
    if (tag === 'script' || tag === 'style') {
      const end = html.indexOf(`</${tag}`, i);
      i = html.indexOf('>', end) + 1;
      continue;
    }
    if (!selfClosing && !VOID.has(tag)) node = el;
  }
  return rootNode;
}

function* walk(n) {
  yield n;
  for (const c of n.children || []) yield* walk(c);
}
const ancestors = function* (n) { for (let p = n.parent; p; p = p.parent) yield p; };
const inside = (n, pred) => [...ancestors(n)].some(pred);

/**
 * The language an element's own text and attributes are in: the nearest lang at or above it.
 * The page's own <html lang> does not count as marking English: a page that says it is English
 * marks nothing (main's lang="en" page, which this test fails first).
 */
function langOf(n) {
  for (let p = n.tag === '#text' ? n.parent : n; p; p = p.parent) {
    if (p.attrs && Object.hasOwn(p.attrs, 'lang')) {
      return p.tag === 'html' ? `page:${p.attrs.lang}` : p.attrs.lang;
    }
  }
  return null;
}
const CZECH = /[áčďéěíňóřšťúůýž]/i;

/** The shell's regions (see the header): its declared panels outside <main>, and contentinfo. */
export function shellRegions(tree, panels) {
  const els = [...walk(tree)].filter((n) => n.attrs);
  const holdsMain = (n) => [...walk(n)].some((d) => d.tag === 'main');
  const inMain = (n) => inside(n, (a) => a.tag === 'main');
  const declared = els.filter((n) => panels.includes(n.attrs['data-osc']) && !inMain(n)
    && !holdsMain(n));
  const contentinfo = els.filter((n) => n.tag === 'footer'
    && !inside(n, (a) => SECTIONING.has(a.tag) || a.tag === 'dialog'));
  const all = [...declared, ...contentinfo];
  return all.filter((n) => !all.some((o) => o !== n && inside(n, (a) => a === o)));
}

/**
 * The English a region shows without lang="en", and the Czech it shows in English (under the
 * page's or an element's lang="en"): [{ where, text }].
 */
export function unmarkedEnglish(region) {
  const out = [];
  const where = (n) => {
    const e = n.tag === '#text' ? n.parent : n;
    const hook = [e, ...ancestors(e)].find((a) => a.attrs && (a.attrs['data-osc'] || a.attrs.id));
    return hook ? (hook.attrs['data-osc'] || `#${hook.attrs.id}`) : e.tag;
  };
  for (const n of walk(region)) {
    if (n.tag === '#text') {
      const t = decode(n.text).replace(/\s+/g, ' ').trim();
      if (isEnglish(t) && langOf(n) !== 'en') out.push({ where: where(n), text: t });
      if (CZECH.test(t) && /(^|:)en$/.test(langOf(n) || '')) {
        out.push({ where: `${where(n)} (Czech read as English)`, text: t });
      }
      continue;
    }
    if (!n.attrs || langOf(n) === 'en') continue;
    for (const [name, value] of Object.entries(n.attrs)) {
      if (SHOWN_ATTRS.includes(name)) {
        const t = decode(value);
        if (isEnglish(t)) out.push({ where: `${where(n)} ${name}`, text: t });
      } else if (BOUND.test(name)) {
        for (const s of lexJs(decode(value)).strings) {
          if (isEnglish(s.text)) out.push({ where: `${where(n)} ${name}`, text: s.text });
        }
      }
    }
  }
  return out;
}

const TREE = parseHtml(HTML);
const PANELS = decl.filter((c) => c.kind === 'panel').map((c) => c.id);
const REGIONS = shellRegions(TREE, PANELS);

test('the page is lang="cs"', () => {
  const html = [...walk(TREE)].find((n) => n.tag === 'html');
  assert.ok(html, 'the page has an <html> element');
  assert.equal(html.attrs.lang, 'cs', 'WCAG 3.1.1: the page names its language, Czech');
});

test('the shell\'s regions are derived from its own declaration and landmarks', () => {
  const has = (pred) => REGIONS.some((r) => [...walk(r)].some(pred));
  assert.ok(has((n) => n.attrs && (n.attrs.role === 'banner' || n.tag === 'header')),
    'a banner (the navbar)');
  assert.ok(has((n) => n.attrs && n.attrs.id === 'osc-nav'), 'the sidebar navigation');
  assert.ok(has((n) => n.attrs && n.attrs['data-osc'] === 'page.title'), 'the breadcrumb');
  assert.ok(REGIONS.some((r) => r.tag === 'footer'), 'a contentinfo (the status bar)');
  assert.ok(!REGIONS.some((r) => [...walk(r)].some((n) => n.tag === 'main')),
    'no region holds the workspace');
});

test('every English text of the shell carries lang="en"', () => {
  const found = REGIONS.flatMap(unmarkedEnglish);
  assert.deepEqual(found.map((f) => `${f.where}: "${f.text}"`), [],
    'English in the shell without a lang="en" ancestor (translate it, or mark it lang="en")');
});

test('the workspace labels are Czech, and the kept names say they are English', () => {
  const rows = [...shell.WORKSPACE_REGISTRY, ...Object.values(shell.GROUP_REGISTRY)];
  for (const w of rows) {
    if (isEnglish(w.label)) assert.equal(w.lang, 'en', `"${w.label}" reads as English`);
    if (w.lang === 'en') assert.ok(KEPT_NAMES.includes(w.label), `"${w.label}" is no kept name`);
  }
  for (const name of KEPT_NAMES) {
    const w = shell.WORKSPACE_REGISTRY.find((r) => r.label === name);
    assert.ok(w, `${name} is a workspace`);
    assert.equal(w.lang, 'en', `${name} stands alone as an English name (c3, Q090 point 2)`);
  }
  for (const g of Object.values(shell.GROUP_REGISTRY)) {
    assert.ok(!KEPT_NAMES.includes(g.label), `group "${g.label}" is Czech`);
  }
});

test('where a label stands alone in the shell, its lang is bound from the registry', () => {
  const shellEls = REGIONS.flatMap((r) => [...walk(r)]).filter((n) => n.attrs);
  // The nav items (the entry link and the grouped one): each binds the row's lang.
  const NAV = /^'nav\.' \+ (\w+)\.id$/;
  const navLinks = shellEls.filter((n) => NAV.test(n.attrs[':data-osc'] || ''));
  assert.ok(navLinks.length >= 2, 'the sidebar renders its items from the registry');
  for (const a of navLinks) {
    const v = NAV.exec(a.attrs[':data-osc'])[1];
    assert.equal(a.attrs[':lang'], `${v}.lang`, `nav item ${v} binds its row's lang`);
  }
  // The page header's title and the Related links name a workspace alone.
  const title = shellEls.find((n) => n.attrs['data-osc'] === 'page.title');
  assert.ok(title && title.attrs[':lang'], 'the page title binds the workspace\'s lang');
  const related = shellEls.filter((n) => n.attrs['x-text'] === 'r.text');
  assert.ok(related.length >= 1, 'the Related strip renders its links');
  for (const r of related) assert.equal(r.attrs[':lang'], 'r.lang', 'a Related link binds lang');
});

test('mutation: the test finds unmarked English and passes marked English and Czech', () => {
  const run = (html) => {
    const t = parseHtml(html);
    return shellRegions(t, ['header']).flatMap(unmarkedEnglish).map((f) => f.text);
  };
  assert.deepEqual(run('<header data-osc="header"><button aria-label="More actions">x</button>'
    + '<span>Find a workspace</span></header>'), ['More actions', 'Find a workspace']);
  assert.deepEqual(run('<header data-osc="header"><a lang="en" title="Open the Playground">'
    + 'Interactive Sound &amp; Frequency Lab</a><span>Najít pracovní plochu</span></header>'), []);
  assert.deepEqual(run('<header data-osc="header"><p x-text="a ? \'Close the menu\' : '
    + '\'Zavřít\'"></p></header>'), ['Close the menu']);
  assert.deepEqual(run('<main><header data-osc="header"><span>Find a workspace</span></header>'
    + '</main>'), [], 'a panel inside <main> is no shell region');
  assert.deepEqual(run('<div><footer><span>Copy config URL</span></footer></div>'),
    ['Copy config URL'], 'the contentinfo footer is a region');
});
