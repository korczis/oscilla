import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { test } from 'node:test';
import {
  compactMarkup, inlineIcon, isKeptComment, KEPT_COMMENTS, LUCIDE_PAINT, pack, sha256,
} from '../../scripts/pack-single-file.mjs';

const read = (rel) => readFileSync(new URL(`../../${rel}`, import.meta.url), 'utf8');

const template = '<!doctype html>\n<html><head><!-- @inline-css --></head>'
  + '<body><i><!-- @icon:x --></i><!-- @inline-js --></body></html>\n';
const icon = (name) => `<svg data-icon="${name}"></svg>`;

test('inlines css, vendors in order, then the app, as classic scripts', () => {
  const html = pack({
    template, css: 'b{c:d}', js: 'app()', icon,
    vendors: [{ id: 'v1@1', code: 'one()' }, { id: 'v2@2', code: 'two()' }],
  });
  assert.match(html, /<style>b\{c:d\}<\/style>/);
  assert.match(html, /<i><svg data-icon="x"><\/svg><\/i>/);
  const order = [...html.matchAll(/<script([^>]*)>/g)].map((m) => m[1]);
  assert.deepEqual(order, [
    ` data-vendor="v1@1" data-sha256="${sha256('one()')}"`,
    ` data-vendor="v2@2" data-sha256="${sha256('two()')}"`,
    ' data-app',
  ]);
  assert.doesNotMatch(html, /type="module"/);
});

test('replacement patterns in code are kept literally', () => {
  const js = 'a.replace(/x/g,"$&$1$\'$`")';
  assert.ok(pack({ template, css: '', js, icon }).includes(js));
});

test('</script inside code is escaped, "<!--" is refused', () => {
  const html = pack({ template, css: '', js: 's="</script>"', icon });
  assert.ok(html.includes('s="<\\/script>"'));
  assert.throws(() => pack({ template, css: '', js: 's="<!--"', icon }), /<!--/);
  assert.throws(() => pack({ template, css: 'a{}</style>', js: '', icon }), /<\/style/);
});

test('markers must appear exactly once', () => {
  const noCss = '<!doctype html><!-- @inline-js -->';
  assert.throws(() => pack({ template: noCss, css: '', js: '', icon }), /inline-css/);
  const twice = template.replace('<!-- @inline-js -->', '<!-- @inline-js --><!-- @inline-js -->');
  assert.throws(() => pack({ template: twice, css: '', js: '', icon }), /2 times/);
});

test('notice goes right after the doctype and may not break the comment', () => {
  const html = pack({ template, css: '', js: '', icon, notice: 'MIT -- text' });
  assert.ok(html.startsWith('<!doctype html>\n<!--\nMIT -- text\n-->\n<html>'));
  assert.throws(() => pack({ template, css: '', js: '', icon, notice: 'a --> b' }), /comment/);
});

test('output is deterministic', () => {
  const vendors = [{ id: 'v@1', code: 'v()' }];
  const o = { template, css: 'x{}', js: 'y()', icon, vendors, notice: 'n' };
  assert.equal(pack(o), pack(o));
});

test('real lucide icon is inlined as decorative SVG without the licence comment', () => {
  const svg = inlineIcon('audio-waveform');
  assert.match(svg, /^<svg aria-hidden="true" focusable="false" /);
  assert.doesNotMatch(svg, /<!--|\n/);
});

test('an icon nested in a 24 x 24 symbol drops width/height; its paint lives in CSS', () => {
  const full = inlineIcon('search');
  const nested = inlineIcon('search', { nested: true });
  const root = '<svg aria-hidden="true" focusable="false" class="lucide"';
  assert.ok(full.startsWith(`${root} width="24" height="24" viewBox="0 0 24 24"><path `));
  assert.ok(nested.startsWith(`${root} viewBox="0 0 24 24"><path `));
  for (const svg of [full, nested]) {
    assert.doesNotMatch(svg, /xmlns|fill=|stroke=|stroke-width|stroke-linecap|stroke-linejoin/);
  }
  const t = '<!doctype html>\n<svg><symbol id="a" viewBox="0 0 24 24"><!-- @icon:x --></symbol>'
    + '<symbol id="b" viewBox="0 0 24 18"><!-- @icon:x --></symbol></svg>'
    + '<!-- @inline-css --><!-- @inline-js -->';
  const seen = [];
  const icon = (name, o = {}) => {
    seen.push(!!o.nested);
    return '';
  };
  pack({ template: t, css: '', js: '', icon });
  assert.deepEqual(seen, [true, false], 'only the icon filling a 24 x 24 symbol is nested');
});

test('the :where(.lucide) rule restates LUCIDE_PAINT first in the author styles', () => {
  const base = read('src/styles/base.css');
  const m = /:where\(\.lucide\)\s*\{([^}]*)\}/.exec(base);
  assert.ok(m, 'src/styles/base.css has the :where(.lucide) rule');
  const decls = Object.fromEntries(m[1].split(';').map((d) => d.trim()).filter(Boolean)
    .map((d) => d.split(/\s*:\s*/)));
  assert.deepEqual(decls, LUCIDE_PAINT);
  // Nothing imported before base.css may style an SVG, or the rule would not be first.
  const main = read('src/styles/main.css');
  const before = main.slice(0, main.indexOf('@import "./base.css"'));
  assert.deepEqual([...before.matchAll(/@import "([^"]+)"/g)].map((i) => i[1]),
    ['uplot/dist/uPlot.min.css', './tokens.css']);
  const uplot = read('node_modules/uplot/dist/uPlot.min.css');
  for (const css of [uplot, read('src/styles/tokens.css'), base.slice(0, m.index)]) {
    const code = css.replace(/\/\*[\s\S]*?\*\//g, '');
    assert.doesNotMatch(code, /(^|[;{\s])(fill|stroke[\w-]*)\s*:|\bsvg\b|\.lucide\b/);
  }
});

test('comment allow-list: markers, generated regions and licences stay; notes go', () => {
  const kept = [
    '<!-- @inline-css -->', '<!-- @inline-js -->', '<!-- @build-info -->', '<!-- @icon:info -->',
    '<!-- social:begin (generated by npm run social) -->', '<!-- social:end -->',
    '<!-- @license lucide-static v1.49.0 - ISC -->', '<!--! keep me -->',
    '<!-- SPDX-License-Identifier: MIT -->', '<!-- Copyright (c) 2026 Someone -->',
  ];
  const dropped = [
    '<!-- ================= Header ================= -->',
    '<!-- ---------- Stimulus ---------- -->',
    '<!-- Icon sprite: hand-drawn 24x24 strokes, currentColor. -->',
    '<!-- MEASURE: absolute level calibration (spec §23)\n     two lines -->', '<!-- @icon -->',
    '<!-- social:begin\n -->',
  ];
  assert.ok(KEPT_COMMENTS.length >= 3);
  for (const c of kept) assert.ok(isKeptComment(c), c);
  for (const c of dropped) assert.ok(!isKeptComment(c), c);
  assert.equal(compactMarkup('<p>a<!-- note -->b</p><!-- social:end -->'),
    '<p>ab</p><!-- social:end -->');
  // Every comment of the real template is either a kept marker or a developer note.
  const template = read('src/index.html');
  const left = [...compactMarkup(template).matchAll(/<!--[\s\S]*?-->/g)].map((c) => c[0]);
  assert.ok(left.length > 0 && left.every(isKeptComment));
  assert.ok(left.includes('<!-- @inline-css -->') && left.includes('<!-- social:end -->'));
});

test('indentation goes; textarea, pre, script, style and attribute values are verbatim', () => {
  const src = [
    '<div>',
    '    <span>a</span>   ',
    '\t\t<span>b</span>',
    '',
    '    <!-- note -->',
    '    <button type="button"',
    '        class="x\n        y" title="t  \n    u">  go  </button>',
    '    <textarea>',
    '   keep\n      this</textarea>',
    '    <pre class="p">  one\n    two</pre>',
    '    <script>if (a) {\n      b();\n    }</script>',
    '    <style>\n  a { b: c }\n</style>',
    '    <p>x\u00a0\n    \u00a0y</p>',
    '</div>',
  ].join('\n');
  assert.equal(compactMarkup(src), [
    '<div>',
    '<span>a</span>',
    '<span>b</span>',
    '<button type="button"',
    'class="x\n        y" title="t  \n    u">  go  </button>',
    '<textarea>',
    '   keep\n      this</textarea>',
    '<pre class="p">  one\n    two</pre>',
    '<script>if (a) {\n      b();\n    }</script>',
    '<style>\n  a { b: c }\n</style>',
    '<p>x\u00a0\n\u00a0y</p>',
    '</div>',
  ].join('\n'));
  assert.equal(compactMarkup('<p>a <b>b</b> c</p>'), '<p>a <b>b</b> c</p>', 'inline spaces stay');
});

test('no white-space: pre* rule styles static markup (the indentation rule relies on it)', () => {
  const template = read('src/index.html');
  const dir = new URL('../../src/styles/', import.meta.url);
  for (const f of readdirSync(dir).filter((n) => n.endsWith('.css'))) {
    const css = readFileSync(new URL(f, dir), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    const rules = /([^{}]+)\{[^}]*white-space:\s*(pre|pre-wrap|pre-line|break-spaces)\b/g;
    for (const m of css.matchAll(rules)) {
      for (const cls of m[1].match(/\.[\w-]+/g) || []) {
        assert.ok(!template.includes(cls.slice(1)),
          `${f}: ${cls} sets white-space: ${m[2]} and appears in src/index.html`);
      }
      assert.match(m[1], /\./, `${f}: a white-space: ${m[2]} rule without a class: ${m[1].trim()}`);
    }
  }
});
