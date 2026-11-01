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

// CSS named colours (CSS Color 4) as a quoted value or a paint: 'goldenrod', fill="red".
const NAMED = ['aliceblue', 'antiquewhite', 'aqua', 'aquamarine', 'azure', 'beige', 'bisque',
  'black', 'blanchedalmond', 'blue', 'blueviolet', 'brown', 'burlywood', 'cadetblue',
  'chartreuse', 'chocolate', 'coral', 'cornflowerblue', 'cornsilk', 'crimson', 'cyan',
  'darkblue', 'darkcyan', 'darkgoldenrod', 'darkgray', 'darkgreen', 'darkgrey', 'darkkhaki',
  'darkmagenta', 'darkolivegreen', 'darkorange', 'darkorchid', 'darkred', 'darksalmon',
  'darkseagreen', 'darkslateblue', 'darkslategray', 'darkslategrey', 'darkturquoise',
  'darkviolet', 'deeppink', 'deepskyblue', 'dimgray', 'dimgrey', 'dodgerblue', 'firebrick',
  'floralwhite', 'forestgreen', 'fuchsia', 'gainsboro', 'ghostwhite', 'gold', 'goldenrod',
  'gray', 'green', 'greenyellow', 'grey', 'honeydew', 'hotpink', 'indianred', 'indigo', 'ivory',
  'khaki', 'lavender', 'lavenderblush', 'lawngreen', 'lemonchiffon', 'lightblue', 'lightcoral',
  'lightcyan', 'lightgoldenrodyellow', 'lightgray', 'lightgreen', 'lightgrey', 'lightpink',
  'lightsalmon', 'lightseagreen', 'lightskyblue', 'lightslategray', 'lightslategrey',
  'lightsteelblue', 'lightyellow', 'lime', 'limegreen', 'linen', 'magenta', 'maroon',
  'mediumaquamarine', 'mediumblue', 'mediumorchid', 'mediumpurple', 'mediumseagreen',
  'mediumslateblue', 'mediumspringgreen', 'mediumturquoise', 'mediumvioletred', 'midnightblue',
  'mintcream', 'mistyrose', 'moccasin', 'navajowhite', 'navy', 'oldlace', 'olive', 'olivedrab',
  'orange', 'orangered', 'orchid', 'palegoldenrod', 'palegreen', 'paleturquoise',
  'palevioletred', 'papayawhip', 'peachpuff', 'peru', 'pink', 'plum', 'powderblue', 'purple',
  'rebeccapurple', 'red', 'rosybrown', 'royalblue', 'saddlebrown', 'salmon', 'sandybrown',
  'seagreen', 'seashell', 'sienna', 'silver', 'skyblue', 'slateblue', 'slategray', 'slategrey',
  'snow', 'springgreen', 'steelblue', 'tan', 'teal', 'thistle', 'tomato', 'turquoise', 'violet',
  'wheat', 'white', 'whitesmoke', 'yellow', 'yellowgreen'];
const NAMED_VALUE = new RegExp(`(['"\`]|\b(?:fill|stroke|stop-color)[=:]\s*["']?)(${NAMED
  .join('|')})(['"\`;\s])`, 'i');

test('no named colour as a value or a paint in src/js/synth/view', () => {
  for (const f of files) {
    const text = readFileSync(join(DIR, f), 'utf8').replace(/^\s*\/\/.*$/gm, '')
      .replace(/^\s*\*.*$/gm, '');
    const m = NAMED_VALUE.exec(text);
    assert.equal(m, null, `${f}: named colour ${m && m[2]}`);
  }
  // The probe the review of #329 used: a token fallback of a named colour is caught.
  assert.match("|| 'goldenrod'", NAMED_VALUE);
  assert.match('fill="red"', NAMED_VALUE);
});

test('every token the panel reads is defined by tokens.css', () => {
  for (const name of [...Object.values(PANEL_TOKENS), ...CABLE_TOKENS]) {
    assert.ok(tokensCss.includes(`${name}:`), name);
  }
});
