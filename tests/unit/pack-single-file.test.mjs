import assert from 'node:assert/strict';
import { test } from 'node:test';
import { inlineIcon, pack, sha256 } from '../../scripts/pack-single-file.mjs';

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
