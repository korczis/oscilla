// project.visual-identity-lock v3 (the instrument-panel carve-out): the Synth's panel, knob,
// jack and cable drawings take every colour from an OSCILLA token read at run time
// (src/js/synth/view/tokens.js); no hex, rgb(a), hsl(a) or named colour literal, and no url()
// but an in-SVG fragment reference (a gradient), so no bitmap, texture or remote image.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { PANEL_TOKENS, CABLE_TOKENS } from '../../src/js/synth/view/tokens.js';

const DIR = new URL('../../src/js/synth/view/', import.meta.url).pathname;
const files = readdirSync(DIR).filter((f) => f.endsWith('.js'));
const tokensCss = readFileSync(new URL('../../src/styles/tokens.css', import.meta.url), 'utf8');

test('no colour literal and no url() but #fragment in src/js/synth/view', () => {
  assert.ok(files.length >= 4, files.join());
  for (const f of files) {
    const text = readFileSync(join(DIR, f), 'utf8').replace(/^\s*\/\/.*$/gm, '');
    assert.doesNotMatch(text, /#[0-9a-f]{3,8}\b(?![-\w])/i, `${f}: hex colour`);
    assert.doesNotMatch(text, /\b(rgba?|hsla?|hwb|lab|lch|oklch|color)\(/i, `${f}: colour function`);
    assert.doesNotMatch(text, /url\((?!#)/i, `${f}: url() other than a fragment`);
    assert.doesNotMatch(text, /\b(fill|stroke|stop-color)="(?!\$\{|none|url\(#|currentColor)/,
      `${f}: a literal paint`);
  }
});

test('every token the panel reads is defined by tokens.css', () => {
  for (const name of [...Object.values(PANEL_TOKENS), ...CABLE_TOKENS]) {
    assert.ok(tokensCss.includes(`${name}:`), name);
  }
});
