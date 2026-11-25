// U129: the shell registry owns which panels a place shows. One registry row per workspace
// (src/js/ui/shell.js WORKSPACE_REGISTRY `panels`, with PANEL_REGISTRY for the elements it
// names) declares the membership, its order and its width bands; ui/app.js markWorkspacePanels
// is the one applier; src/index.html's data-osc-modes is held equal to it here, and its static
// classes are the Playground's, so the page paints the Playground before any script.
//
// - The census of second mechanisms (secondMechanisms below) refuses every other way of
//   deciding membership: a stylesheet rule that hides (display: none or visibility: hidden) a
//   membership element, by default or keyed on the workspace (data-mode, data-osc-modes,
//   .is-focused), or shows one keyed on the workspace with any display but the grid's
//   flattening (contents); a stylesheet list of workspaces (data-osc-modes~=); an Alpine
//   :hidden, x-show or x-if over `workspace` or the V1 `mode` on a membership element, or its
//   :class over them adding a hiding class; a read of data-osc-modes in src/js. Its
//   baseline, tests/unit/panel-membership-baseline.json, only shrinks and is empty: a finding
//   it does not list fails, and an entry no longer found must leave it. State-gated links stay
//   state-gated (`:hidden="workspace !== 'sequencer' && !seqPlaying"` on a link is no
//   membership); the geometry (grid spans, display: contents, order) stays in CSS.
// - The registry against the U128 geometry census: for every engine, viewport and workspace of
//   tests/browser/geometry-census-reference.json, a panel or view is rendered exactly where the
//   registry shows it in that viewport's band, carries display: none exactly where
//   markWorkspacePanels hides it on itself, and otherwise sits in a row the registry hides;
//   the rendered members of each workspace read, below 1536 px, in the registry's order.
//   node --test tests/unit/panel-membership.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  BANDS, collapsedDefaults, GRID_ROWS, HIDE_CLASS, isViewPanel, memberBands, MEMBERSHIP_CLASSES,
  membershipClassesOf, modesOf, PANEL_REGISTRY, panelOf, rowClassesOf, rowShown, WORKSPACE_IDS,
  WORKSPACE_REGISTRY,
} from '../../src/js/ui/shell.js';
import { createOscillaUi, markWorkspacePanels, memberKey } from '../../src/js/ui/app.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (rel) => readFileSync(path.join(ROOT, rel), 'utf8');
const HTML = read('src/index.html');
const BASELINE = JSON.parse(read('tests/unit/panel-membership-baseline.json'));
const REFERENCE = JSON.parse(read('tests/browser/geometry-census-reference.json'));

/** Every file under `dir` (relative to the root) whose name ends in `ext`, sorted. */
function filesOf(dir, ext) {
  const out = [];
  const walk = (rel) => {
    for (const name of readdirSync(path.join(ROOT, rel))) {
      const r = `${rel}/${name}`;
      if (statSync(path.join(ROOT, r)).isDirectory()) walk(r);
      else if (name.endsWith(ext)) out.push(r);
    }
  };
  walk(dir);
  return out.sort();
}

// ------------------------------------------------------------------ the second-mechanism census

/**
 * The subject of a membership element: a grid panel, card, view or grid row of the shell. A
 * bare .osc-panel is one only where the selector keys it on the workspace or on the Measure
 * view's cards: unkeyed, it is a view's own card (the Studio's subviews on a phone).
 */
const MEMBER_SUBJECT = new RegExp([
  String.raw`\.osc-(?:p-[\w-]+|view[\w-]*|top|row3|workspace)(?![\w-])`,
  String.raw`\.osc-m-(?:flow|stimulus|input|quality|result|setup|experiment)(?![\w-])`,
  String.raw`\[data-osc-(?:modes|panel|card|row)\b`,
  String.raw`#osc-(?:panel|view|measure)-[\w-]+`,
  String.raw`\.is-focused(?![\w-])`,
].join('|'));
const BARE_PANEL = /\.osc-panel(?![\w-])/;
const CARD_PARENT = /\.osc-measure\s*>/;
/** A selector keyed on the workspace in view, or on the panel mark. */
const WORKSPACE_KEY = /\[data-mode\b|\[data-osc-modes\s*~=|\.is-focused(?![\w-])/;

/** The rules of a stylesheet, at any @media depth: { selectors, decls, line }. */
export function cssRules(css) {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, ' '));
  const out = [];
  const stack = [];
  let start = 0;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (c === '{') {
      const head = text.slice(start, i).trim();
      stack.push({ head, at: i + 1, line: text.slice(0, start).split('\n').length
        + (text.slice(start, i).match(/^\s*/)[0].split('\n').length - 1) });
      start = i + 1;
    } else if (c === '}') {
      const open = stack.pop();
      if (open && !open.head.startsWith('@')) {
        const decls = {};
        for (const d of text.slice(open.at, i).split(';')) {
          const m = /^\s*([\w-]+)\s*:\s*([\s\S]*?)\s*$/.exec(d);
          if (m) decls[m[1].toLowerCase()] = m[2].replace(/\s*!important$/, '');
        }
        out.push({ selectors: splitTop(open.head, ','), decls, line: open.line });
      }
      start = i + 1;
    } else if (c === ';' && !stack.length) start = i + 1;
  }
  return out;
}

/** `s` split on `sep` outside parentheses and brackets, each part trimmed. */
function splitTop(s, sep) {
  const out = [];
  let depth = 0;
  let from = 0;
  for (let i = 0; i < s.length; i += 1) {
    if ('([' .includes(s[i])) depth += 1;
    else if (')]'.includes(s[i])) depth -= 1;
    else if (s[i] === sep && depth === 0) { out.push(s.slice(from, i).trim()); from = i + 1; }
  }
  out.push(s.slice(from).trim());
  return out.filter(Boolean).map((x) => x.replace(/\s+/g, ' '));
}

/** The last compound of a selector: what the rule styles. */
function subjectOf(selector) {
  let depth = 0;
  let cut = 0;
  for (let i = 0; i < selector.length; i += 1) {
    const c = selector[i];
    if ('(['.includes(c)) depth += 1;
    else if (')]'.includes(c)) depth -= 1;
    else if (depth === 0 && /[\s>+~]/.test(c)) cut = i + 1;
  }
  return selector.slice(cut);
}

/** The opening tags of `html` with their line. */
function openingTags(html) {
  const text = html.replace(/<!--[\s\S]*?-->/g, (c) => c.replace(/[^\n]/g, ' '));
  return [...text.matchAll(/<([a-z][\w-]*)\b(?:[^>"']|"[^"]*"|'[^']*')*>/gi)]
    .map((m) => ({ tag: m[0], line: text.slice(0, m.index).split('\n').length }));
}

const attr = (tag, name) => {
  const m = new RegExp(`\\s${name.replace(/[:.]/g, '\\$&')}="([^"]*)"`).exec(tag);
  return m ? m[1] : null;
};
const MEMBER_TAG = new RegExp(String.raw`\sdata-osc-(?:modes|panel|card|row)="`
  + String.raw`|\sclass="[^"]*\bosc-(?:top|row3|workspace|view)\b`);
const OVER_WORKSPACE = /\b(?:workspace|mode)\b/;
const HIDING_CLASS = /'[^']*\b(?:hidden|invisible|sr-only)\b[^']*'/;

/**
 * Every second mechanism of membership in the given sources: { css: { file: text }, html:
 * { file: text }, js: { file: text } } -> ['<file>:<line> <kind>: <what>'].
 */
export function secondMechanisms({ css = {}, html = {}, js = {} }) {
  const found = [];
  for (const [file, text] of Object.entries(css)) {
    for (const r of cssRules(text)) {
      const hides = r.decls.display === 'none' || r.decls.visibility === 'hidden';
      for (const s of r.selectors) {
        if (/data-osc-modes\s*~=/.test(s)) {
          found.push(`${file}:${r.line} a stylesheet workspace list: ${s}`);
          continue;
        }
        const keyed = WORKSPACE_KEY.test(s);
        const subject = subjectOf(s);
        if (!MEMBER_SUBJECT.test(subject)
          && !(BARE_PANEL.test(subject) && (keyed || CARD_PARENT.test(s)))) continue;
        if (hides) {
          found.push(`${file}:${r.line} ${keyed ? 'a workspace-keyed hide' : 'a default hide'}`
            + ` of a membership element: ${s}`);
        } else if (keyed && r.decls.display !== undefined && r.decls.display !== 'contents') {
          found.push(`${file}:${r.line} a workspace-keyed show of a membership element `
            + `(display: ${r.decls.display}): ${s}`);
        }
      }
    }
  }
  for (const [file, text] of Object.entries(html)) {
    for (const { tag, line } of openingTags(text)) {
      if (!MEMBER_TAG.test(tag)) continue;
      for (const name of [':hidden', 'x-bind:hidden', 'x-show', 'x-if']) {
        const v = attr(tag, name);
        if (v !== null && OVER_WORKSPACE.test(v)) {
          found.push(`${file}:${line} a ${name} binding on a membership element: ${v}`);
        }
      }
      for (const name of [':class', 'x-bind:class']) {
        const v = attr(tag, name);
        if (v !== null && OVER_WORKSPACE.test(v) && HIDING_CLASS.test(v)) {
          found.push(`${file}:${line} a ${name} hide on a membership element: ${v}`);
        }
      }
    }
  }
  for (const [file, text] of Object.entries(js)) {
    text.split('\n').forEach((l, i) => {
      if (/\boscModes\b|getAttribute\(\s*['"]data-osc-modes['"]|data-osc-modes\s*~=/.test(l)) {
        found.push(`${file}:${i + 1} a read of data-osc-modes in code: ${l.trim()}`);
      }
    });
  }
  return found;
}

/** The tree's sources the census reads. */
function treeSources() {
  const of = (files) => Object.fromEntries(files.map((f) => [f, read(f)]));
  return { css: of(filesOf('src/styles', '.css')), html: { 'src/index.html': HTML },
    js: of(filesOf('src/js', '.js')) };
}

/** A finding without its line: the baseline keys survive an edit above the finding. */
const unlined = (f) => f.replace(/^([^:]+):\d+ /, '$1 ');

test('U129: no second mechanism decides membership; the baseline only shrinks, and is empty',
  () => {
    const found = secondMechanisms(treeSources()).map(unlined);
    const listed = BASELINE.mechanisms;
    assert.ok(Array.isArray(listed), 'the baseline lists mechanisms');
    assert.deepEqual(found.filter((f) => !listed.includes(f)), [],
      'a new membership mechanism: declare it in the registry row (src/js/ui/shell.js)');
    assert.deepEqual(listed.filter((f) => !found.includes(f)), [],
      'gone: remove it from tests/unit/panel-membership-baseline.json');
    assert.deepEqual(listed, [], 'U129 left no second mechanism, and none comes back');
  });

test('mutation U129: each kind of second mechanism is found, and geometry is not', () => {
  const css = (text) => secondMechanisms({ css: { 'x.css': text } }).map(unlined);
  // the hard-coded workspace list of integration.css before U129
  assert.deepEqual(css('@media (min-width: 1536px) {\n  .osc-app[data-mode="filter"] '
    + '.osc-panel:not([data-osc-modes~="filter"]) { display: none; }\n}'),
  ['x.css a stylesheet workspace list: .osc-app[data-mode="filter"] '
    + '.osc-panel:not([data-osc-modes~="filter"])']);
  // the .is-focused rule of responsive.css, the rows of a view, a default hide, a keyed show
  assert.equal(css('.osc-app:not([data-mode="playground"]) .osc-panel[data-osc-modes]'
    + ':not(.is-focused) { display: none; }').length, 1);
  assert.match(css('.osc-app:is([data-mode="learn"], [data-mode="about"]) :is(.osc-top,\n'
    + '  .osc-row3) { display: none; }')[0], /a workspace-keyed hide/);
  assert.match(css('.osc-workspace { display: none; }')[0], /a default hide/);
  assert.match(css('.osc-app[data-mode="synthesis"] .osc-workspace { display: grid; }')[0],
    /a workspace-keyed show .*display: grid/);
  assert.match(css('.osc-app[data-mode="playground"] .osc-measure > .osc-panel:not(.osc-m-flow) '
    + '{ display: none; }')[0], /a workspace-keyed hide/);
  assert.match(css('#osc-view-learn { visibility: hidden; }')[0], /a default hide/);
  // geometry and in-panel state stay in CSS
  assert.deepEqual(css('.osc-app[data-mode="sequencer"] :is(.osc-top, .osc-row3) '
    + '{ display: contents; }\n.osc-app[data-mode="analyzer"] .osc-p-mic { grid-column: 8 / '
    + 'span 5; }\n.osc-app[data-mode="playground"] .osc-m-step:not([data-shown]) { display: '
    + 'none; }\n#osc-panel-source summary { display: none; }\n.osc-panel-header { display: '
    + 'none; }\n.osc-panel.is-focused { border-color: red; }\n@media (max-width: 767.98px) {\n'
    + '  .osc-studio > .osc-panel:not(.osc-st-bar) { display: none; }\n}'), []);
  const html = (text) => secondMechanisms({ html: { 'x.html': text } }).map(unlined);
  assert.equal(html('<section id="osc-view-learn" data-osc="learn-view" data-osc-modes="learn" '
    + 'hidden :hidden="mode !== \'learn\'">').length, 1, 'the V1 mode gating of Learn');
  assert.equal(html('<div class="osc-top" :class="workspace === \'synth\' && \'hidden\'">')
    .length, 1, 'the Synth\'s row hide');
  assert.equal(html('<section class="osc-panel" data-osc-panel="dual" '
    + 'x-show="workspace === \'synthesis\'">').length, 1);
  assert.deepEqual(html('<a href="#m=studio" data-osc="envelope.scope" hidden '
    + ':hidden="workspace !== \'sequencer\' && !seqPlaying">'
    + '<section class="osc-view" data-osc-modes="measure playground" '
    + ':class="[PRO.pageView, workspace !== \'measure\' && \'!p-0\']">'), [],
  'a state-gated link and a geometry class are no membership');
  assert.equal(secondMechanisms({ js: { 'x.js': 'const on = p.dataset.oscModes.split(/\\s+/);' } })
    .length, 1, 'a read of data-osc-modes in code');
});

test('mutation U129: the census finds every mechanism the stylesheets and markup had', () => {
  // The seven mechanisms of docs/reconstruction/01 section 1 (the keys dock's route rule,
  // midi/routes.js, is out of scope), as the tree had them before U129: one excerpt of each.
  const before = secondMechanisms({
    css: {
      'responsive.css': '@media (max-width: 1535.98px) {\n  .osc-app:not([data-mode="playground"]) '
        + '.osc-panel[data-osc-modes]:not(.is-focused) {\n    display: none;\n  }\n}',
      'integration.css': '@media (min-width: 1536px) {\n  .osc-app[data-mode="compare"] '
        + '.osc-panel:not([data-osc-modes~="compare"]) {\n    display: none;\n  }\n}',
      'instrument.css': '@media (min-width: 1536px) {\n  .osc-app[data-mode="playground"] '
        + ':is(.osc-p-spectrogram,\n    .osc-row3 > .osc-panel:not(.osc-p-sequencer, '
        + '.osc-p-studio)) {\n    display: none;\n  }\n}',
      'studio.css': '.osc-app[data-mode="studio"] :is(.osc-top, .osc-row3, .osc-workspace) {\n'
        + '  display: none;\n}',
    },
    html: { 'index.html': '<section class="osc-view" id="osc-view-measure" data-osc="measure-view"'
      + ' data-osc-modes="measure" hidden\n  :hidden="workspace !== \'measure\' && workspace !== '
      + '\'playground\'">\n<div class="osc-row3" :class="workspace === \'synth\' && \'hidden\'">' },
  });
  assert.equal(before.length, 6, before.join('\n'));
});

// ------------------------------------------------------------------------- the one declaration

/** The membership elements of the markup: { key, tag, line, at, end } (end: its closing tag). */
function memberElements() {
  const out = [];
  const OPEN = /<(section|div)\b[^>]*\bdata-osc-(?:modes|card|row)="[^"]*"[^>]*>/g;
  for (const m of HTML.matchAll(OPEN)) {
    const tag = m[0];
    const row = attr(tag, 'data-osc-row');
    const osc = attr(tag, 'data-osc');
    const key = row ? null : attr(tag, 'data-osc-panel') || attr(tag, 'data-osc-card')
      || (osc && /-view$/.test(osc) ? osc : '');
    const re = new RegExp(`<${m[1]}\\b[^>]*>|</${m[1]}\\s*>`, 'g');
    re.lastIndex = m.index;
    let depth = 0;
    let end = HTML.length;
    for (let t = re.exec(HTML); t; t = re.exec(HTML)) {
      depth += t[0][1] === '/' ? -1 : 1;
      if (depth === 0) { end = t.index; break; }
    }
    out.push({ key, row, tag, at: m.index, end,
      line: HTML.slice(0, m.index).split('\n').length });
  }
  return out;
}
const ELEMENTS = memberElements();

/** The data hooks of an opening tag that ui/app.js memberKey reads, as a dataset. */
const hooksOf = (tag) => ({ oscPanel: attr(tag, 'data-osc-panel') || undefined,
  oscCard: attr(tag, 'data-osc-card') || undefined, osc: attr(tag, 'data-osc') || undefined });

test('U129: every registry entry names a row of PANEL_REGISTRY, in bands, once per workspace',
  () => {
    for (const w of WORKSPACE_REGISTRY) {
      assert.ok(w.panels.length > 0, `${w.id} shows nothing`);
      const ids = w.panels.map((e) => e.id);
      assert.equal(new Set(ids).size, ids.length, `${w.id} lists a panel twice`);
      for (const e of w.panels) {
        assert.ok(panelOf(e.id), `${w.id}: ${e.id} is no row of PANEL_REGISTRY`);
        assert.ok(e.bands.length > 0 && e.bands.every((b) => BANDS.includes(b)),
          `${w.id}: ${e.id} bands ${e.bands}`);
      }
    }
    for (const p of PANEL_REGISTRY) {
      assert.ok(WORKSPACE_IDS.includes(p.home), `${p.id}: home ${p.home}`);
      assert.ok(memberBands(p.home, p.id).length > 0, `${p.id}: its home does not show it`);
      assert.ok(!(p.row && p.view), `${p.id}: a grid panel or a card, not both`);
      if (p.row) assert.ok(GRID_ROWS.includes(p.row), `${p.id}: row ${p.row}`);
      if (p.view) assert.ok(isViewPanel(p.view), `${p.id}: view ${p.view}`);
    }
  });

test('U129: data-osc-modes is the registry\'s membership, element by element, both ways', () => {
  const marked = ELEMENTS.filter((e) => e.key !== null);
  for (const e of marked) {
    assert.ok(panelOf(e.key), `src/index.html:${e.line}: ${e.key || '(no key)'} is not in `
      + 'PANEL_REGISTRY');
    const card = attr(e.tag, 'data-osc-card') !== null;
    const modes = attr(e.tag, 'data-osc-modes');
    if (card) {
      assert.equal(modes, null, `${e.key}: a card's membership is the registry's alone`);
      continue;
    }
    assert.equal(modes, modesOf(e.key).join(' '), `src/index.html:${e.line}: ${e.key}`);
  }
  for (const p of PANEL_REGISTRY) {
    const els = marked.filter((e) => e.key === p.id);
    assert.equal(els.length, 1, `${p.id}: ${els.length} elements in src/index.html`);
    if (p.view) {
      const view = marked.find((e) => e.key === p.view);
      assert.ok(view.at < els[0].at && els[0].end < view.end, `${p.id} stands in ${p.view}`);
    }
    if (p.row) {
      const row = ELEMENTS.find((e) => e.row === p.row);
      assert.ok(row && row.at < els[0].at && els[0].end < row.end,
        `${p.id} stands in the ${p.row} row (data-osc-row)`);
    }
  }
  assert.deepEqual(ELEMENTS.filter((e) => e.row).map((e) => e.row), [...GRID_ROWS]);
  // The registry key the applier reads is the one the markup gives (ui/app.js memberKey).
  for (const e of marked) {
    const dataset = hooksOf(e.tag);
    assert.equal(memberKey({ dataset }), e.key);
  }
});

test('mutation U129: a data-osc-modes that drifts from the registry is named', () => {
  const tag = ELEMENTS.find((e) => e.key === 'spectrogram').tag;
  assert.match(tag, /data-osc-modes="analyzer playground"/);
  assert.notEqual('analyzer', modesOf('spectrogram').join(' '),
    'the pre-U129 attribute (Analyzer alone) is not the registry\'s');
  const rows = WORKSPACE_REGISTRY.map((w) => w.id);
  assert.ok(rows.includes('playground') && memberBands('playground', 'spectrogram')
    .includes('tablet'), 'the Playground shows the spectrogram from 768 to 1535 px');
});

test('U129: the markup carries the Playground\'s membership before any script', () => {
  for (const e of ELEMENTS) {
    const classes = (attr(e.tag, 'class') || '').split(/\s+/)
      .filter((c) => MEMBERSHIP_CLASSES.includes(c));
    if (e.row) {
      assert.deepEqual(classes, rowClassesOf('playground', e.row), `the ${e.row} row`);
    } else if (isViewPanel(e.key)) {
      assert.deepEqual(classes, [], `${e.key}: a view hides by its hidden attribute`);
      assert.equal(/\shidden(?=[\s>])/.test(e.tag), !memberBands('playground', e.key).length,
        `${e.key}: hidden unless the Playground shows it`);
    } else {
      assert.deepEqual(classes, membershipClassesOf('playground', e.key), e.key);
    }
  }
});

test('U129: markWorkspacePanels applies each workspace\'s classes and takes them off again', () => {
  const fake = (e) => {
    const set = new Set((attr(e.tag, 'class') || '').split(/\s+/).filter(Boolean));
    return { key: e.key, row: e.row, hidden: /\shidden(?=[\s>])/.test(e.tag), set,
      dataset: { oscRow: e.row || undefined, ...hooksOf(e.tag) },
      classList: { contains: (c) => set.has(c), toggle: (c, on) => {
        if (on) set.add(c); else set.delete(c); return on; } } };
  };
  const els = ELEMENTS.map(fake);
  for (const ws of [...WORKSPACE_IDS, 'playground']) {
    markWorkspacePanels(els, ws);
    for (const el of els) {
      const got = [...el.set].filter((c) => MEMBERSHIP_CLASSES.includes(c)).sort();
      if (el.row) assert.deepEqual(got, rowClassesOf(ws, el.row).sort(), `${ws}: ${el.row}`);
      else if (isViewPanel(el.key)) {
        assert.deepEqual(got, [], `${ws}: ${el.key}`);
        assert.equal(el.hidden, !memberBands(ws, el.key).length, `${ws}: ${el.key} hidden`);
      } else assert.deepEqual(got, membershipClassesOf(ws, el.key).sort(), `${ws}: ${el.key}`);
      const focused = el.set.has('is-focused');
      assert.equal(focused, ws !== 'playground' && !!el.dataset.oscPanel
        && memberBands(ws, el.key).length > 0, `${ws}: ${el.key} ring`);
    }
  }
  // back on the Playground the elements carry exactly the markup's classes again
  for (const [i, e] of ELEMENTS.entries()) {
    const want = (attr(e.tag, 'class') || '').split(/\s+/).filter(Boolean).sort();
    assert.deepEqual([...els[i].set].sort(), want, e.key || e.row);
  }
});

test('U129: the hide classes are Tailwind\'s screens, and the Playground composes by width', () => {
  assert.deepEqual(HIDE_CLASS, { all: '!hidden', phone: 'max-md:!hidden',
    tablet: 'md:max-2xl:!hidden', wide: '2xl:!hidden' });
  const dist = read('dist/index.html');
  for (const [sel, media] of [[String.raw`.\!hidden{display:none!important}`, null],
    [String.raw`.max-md\:\!hidden{display:none!important}`, 'not all and (min-width:768px)'],
    [String.raw`.md\:max-2xl\:\!hidden{display:none!important}`, 'not all and (min-width:1536px)'],
    [String.raw`.\32xl\:\!hidden{display:none!important}`, '(min-width:1536px)']]) {
    const at = dist.indexOf(sel);
    assert.ok(at > 0, `dist defines ${sel}`);
    const block = dist.slice(dist.lastIndexOf('@media', at), at);
    if (media) {
      assert.ok(block.replace(/^@media ?/, '').startsWith(`${media}{`),
        `${sel} stands in @media ${media}: ${block.slice(0, 60)}`);
    }
  }
  const wide = (id) => memberBands('playground', id).includes('wide');
  const phone = (id) => memberBands('playground', id).includes('phone');
  assert.deepEqual(['spectrogram', 'filter', 'envelope', 'additive', 'phase', 'bio', 'dual']
    .filter(wide), [], 'from 1536 px the lab panels are their workspaces\'');
  assert.deepEqual(PANEL_REGISTRY.filter((p) => p.row && p.id !== 'dual')
    .filter((p) => !memberBands('playground', p.id).includes('tablet')).map((p) => p.id), [],
  '768-1535 px shows every grid panel but the workspace-only dual oscillator');
  assert.deepEqual(PANEL_REGISTRY.filter((p) => phone(p.id)).map((p) => p.id),
    ['source', 'analysis', 'measure-view', 'measure-flow', 'studio']);
  assert.ok(!rowShown('playground', 'solo') && rowShown('synthesis', 'solo'));
});

test('U129: the default fold state of the folding panels is the registry\'s', () => {
  const ui = createOscillaUi({ storedAnalysisTab: null });
  assert.deepEqual(ui.collapsed, collapsedDefaults());
  assert.deepEqual(Object.keys(collapsedDefaults()).sort(), ['bio', 'device', 'phase']);
  for (const id of Object.keys(collapsedDefaults())) {
    assert.match(HTML, new RegExp(`x-bind="collapseButton\\('${id}'\\)"`), id);
  }
});

// ------------------------------------------------------------ the registry against the census

/** The band a census viewport falls in (Tailwind's md and 2xl, as BANDS cut them). */
const bandOf = (vp) => {
  const w = Number(vp.split('x')[0]);
  return w >= 1536 ? 'wide' : w >= 768 ? 'tablet' : 'phone';
};
/** A census element key's registry key: panel:<id>, or section:#osc-view-<ws> -> <ws>-view. */
const censusKey = (k) => (k.startsWith('panel:') ? k.slice(6)
  : k.startsWith('section:#osc-view-') ? `${k.slice('section:#osc-view-'.length)}-view` : null);

test('U129: the registry is the U128 census\'s membership, cell by cell, in every engine', () => {
  const hosts = Object.entries(REFERENCE.hosts);
  assert.ok(hosts.length > 0, 'the census has a host record');
  let judged = 0;
  for (const [host, engines] of hosts) {
    for (const [engine, viewports] of Object.entries(engines)) {
      for (const [vp, cells] of Object.entries(viewports)) {
        const band = bandOf(vp);
        for (const [ws, cell] of Object.entries(cells)) {
          for (const [k, entry] of Object.entries(cell)) {
            const id = censusKey(k);
            if (!id || !panelOf(id)) continue;
            const [display, , rect] = entry.split(' ');
            const where = `${host}/${engine}/${vp}/${ws}/${k}`;
            const shown = memberBands(ws, id).includes(band);
            assert.equal(rect !== '-', shown, `${where}: rendered ${rect !== '-'}`);
            const own = isViewPanel(id) ? !memberBands(ws, id).length
              : membershipClassesOf(ws, id).some((c) => c === HIDE_CLASS.all
                || c === HIDE_CLASS[band]);
            assert.equal(display === 'none', own, `${where}: ${display}, hidden on itself ${own}`);
            if (!shown && !own) {
              assert.ok(!rowShown(ws, panelOf(id).row), `${where}: its row hides it`);
            }
            judged += 1;
          }
        }
      }
    }
  }
  assert.ok(judged >= 3 * 6 * 13 * 20, `${judged} entries judged`);
});

test('U129: below 1536 px a workspace\'s rendered panels read in its registry order', () => {
  const cells = REFERENCE.hosts.darwin.chromium;
  for (const vp of ['768x1024', '390x844']) {
    for (const w of WORKSPACE_REGISTRY) {
      const read = Object.entries(cells[vp][w.id])
        .filter(([k, v]) => censusKey(k) && !v.endsWith(' -'))
        .map(([k, v]) => ({ id: censusKey(k), xy: v.split(' ')[2].split(',').map(Number) }))
        .sort((a, b) => a.xy[1] - b.xy[1] || a.xy[0] - b.xy[0]).map((e) => e.id);
      const band = bandOf(vp);
      const listed = w.panels.filter((e) => e.bands.includes(band))
        .map((e) => panelOf(e.id).view || e.id);
      assert.deepEqual(read, listed, `${vp} ${w.id}`);
    }
  }
});
