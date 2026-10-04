import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { compactMarkup } from '../../scripts/pack-single-file.mjs';
import {
  ICON_SVG, OG_HEIGHT, OG_WIDTH, SITE_URL, palettePng, socialBlock,
} from '../../scripts/social-assets.mjs';

const { PNG } = createRequire(import.meta.url)('pngjs');

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
  // The packer strips the block's indentation like all markup (compactMarkup); the markers stay.
  assert.ok(head.includes(compactMarkup(socialBlock(site('apple-touch-icon.png')))),
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

test('the inline touch icon is an indexed PNG that re-encodes losslessly', () => {
  const touch = site('apple-touch-icon.png');
  assert.equal(touch[25], 3, 'colour type 3 (indexed); run npm run social -- --icon-only');
  assert.ok(touch.length < 4096, `touch icon ${touch.length} B`);
  // A palette image is a fixed point of the encoder: same pixels (bytes may differ only if the
  // platform's zlib deflates differently).
  const again = palettePng(touch);
  assert.equal(again[25], 3);
  assert.deepEqual(PNG.sync.read(again).data, PNG.sync.read(touch).data);
});

test('palettePng is deterministic and lossless up to 256 colours', () => {
  const img = new PNG({ width: 20, height: 3 });
  for (let i = 0; i < 60; i++) img.data.set([i * 4, 255 - i, (i * 7) & 255, 255], i * 4);
  const png = PNG.sync.write(img);
  const a = palettePng(png);
  assert.ok(a.equals(palettePng(png)));
  assert.equal(a[24], 8, '60 colours need 8-bit indices');
  assert.deepEqual(PNG.sync.read(a).data, img.data);
  const two = new PNG({ width: 9, height: 2 });
  for (let i = 0; i < 18; i++) two.data.set(i % 3 ? [2, 11, 21, 255] : [240, 74, 196, 255], i * 4);
  const b = palettePng(PNG.sync.write(two));
  assert.equal(b[24], 1, 'two colours need 1-bit indices');
  assert.deepEqual(PNG.sync.read(b).data, two.data);
  img.data[3] = 128;
  assert.throws(() => palettePng(PNG.sync.write(img)), /opaque/);
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
