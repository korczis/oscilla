import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { test } from 'node:test';
import {
  ICON_SVG, OG_HEIGHT, OG_WIDTH, SITE_URL, socialBlock,
} from '../../scripts/social-assets.mjs';

const dist = readFileSync(new URL('../../dist/index.html', import.meta.url), 'utf8');
const head = dist.slice(0, dist.indexOf('</head>'));
const site = (f) => readFileSync(new URL(`../../site/${f}`, import.meta.url));
const meta = (attr, key) => {
  const all = [...head.matchAll(new RegExp(`<meta ${attr}="${key}" content="([^"]*)">`, 'g'))];
  return all.map((m) => m[1]);
};
const pngSize = (buf) => {
  assert.equal(buf.subarray(1, 4).toString('ascii'), 'PNG');
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
};

test('dist head carries the generated social block for the committed touch icon', () => {
  assert.ok(head.includes(socialBlock(site('apple-touch-icon.png'))),
    'run npm run social, then npm run build');
});

test('favicon is the inline wave mark; the touch icon is an inline 180 px PNG', () => {
  assert.ok(head.includes(`<link rel="icon" type="image/svg+xml" href="data:image/svg+xml,${
    encodeURIComponent(ICON_SVG)}">`));
  assert.match(head, /<link rel="apple-touch-icon" sizes="180x180" href="data:image\/png;base64,/);
  assert.deepEqual(pngSize(site('apple-touch-icon.png')), { width: 180, height: 180 });
  const themes = head.match(/<meta name="theme-color" content="#[0-9a-f]{6}" media=/g) || [];
  assert.equal(themes.length, 2);
});

test('Open Graph and social card tags are complete, single and absolute', () => {
  const one = (attr, key) => {
    const v = meta(attr, key);
    assert.equal(v.length, 1, `${key} appears once`);
    return v[0];
  };
  for (const k of ['og:type', 'og:site_name', 'og:title', 'og:description', 'og:locale',
    'og:image:type', 'og:image:alt']) assert.ok(one('property', k), k);
  assert.equal(one('property', 'og:url'), SITE_URL);
  assert.equal(one('property', 'og:image'), `${SITE_URL}og-image.png`);
  assert.equal(one('property', 'og:image:width'), String(OG_WIDTH));
  assert.equal(one('property', 'og:image:height'), String(OG_HEIGHT));
  assert.equal(one('name', 'twitter:card'), 'summary_large_image');
  assert.equal(one('name', 'twitter:title'), one('property', 'og:title'));
  assert.equal(one('name', 'twitter:description'), one('property', 'og:description'));
  assert.equal(one('name', 'twitter:image'), one('property', 'og:image'));
  assert.equal(one('name', 'twitter:image:alt'), one('property', 'og:image:alt'));
  assert.doesNotMatch(one('property', 'og:description'),
    /\b(heal|therap|sleep|focus|cure|calibrated)/i);
});

test('the preview image is a 1200 x 630 PNG under 1 MB; dist/ stays a single file', () => {
  const og = site('og-image.png');
  assert.deepEqual(pngSize(og), { width: OG_WIDTH, height: OG_HEIGHT });
  assert.ok(og.length < 1024 * 1024);
  const files = readdirSync(new URL('../../dist/', import.meta.url))
    .filter((f) => f !== '.nojekyll');
  assert.deepEqual(files, ['index.html']);
});
