// The synth-theme layer's plate, type, jack and readout window (src/js/ui/synth/, plan F013 W1;
// project.visual-identity-lock v4): every paint is the caller's token, never a literal; the
// intensities are classes; decoration takes no pointer and is hidden from assistive technology;
// text never drops below 12 px; a readout says it is computed and refuses anything else.
//
//   node --test tests/unit/ui-synth-layer.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';

const plate = await import('../../src/js/ui/synth/plate.js').catch(() => ({}));
const label = await import('../../src/js/ui/synth/label.js').catch(() => ({}));
const jack = await import('../../src/js/ui/synth/jack.js').catch(() => ({}));
const display = await import('../../src/js/ui/synth/display.js').catch(() => ({}));
const cable = await import('../../src/js/ui/synth/cable.js').catch(() => ({}));

const T = { plateHi: '#t1', plateLo: '#t2', edge: '#t3', cap: '#t4', capHi: '#t5', dim: '#t6',
  track: '#t7', focus: '#t8', jack: '#t9', label: '#ta', jackRing: '#tb', normal: '#tc',
  refuse: '#td', text: '#te', cables: ['#c1', '#c2', '#c3', '#c4', '#c5', '#c6'] };
const paints = (svg) => [...svg.matchAll(/(?:fill|stroke|stop-color)="([^"]+)"/g)]
  .map((m) => m[1]);
const tokenOrStructural = (p) => /^#t[0-9a-e]$|^#c\d$|^none$|^currentColor$|^url\(#/.test(p);

test('a plate: token gradient, brushed finish at hw-texture, two screws, no pointer', () => {
  const svg = plate.plateSvg({ id: 'lpf', tokens: T });
  assert.match(svg, /data-plate="lpf"/);
  assert.match(svg, /<stop offset="0" stop-color="#t1"\/><stop offset="1" stop-color="#t2"\/>/);
  assert.match(svg, /class="opacity-hw-texture" data-finish="brushed"/);
  assert.equal((svg.match(/data-screw="(left|right)"/g) || []).length, 2);
  assert.equal((svg.match(/<svg /g) || []).length, (svg.match(/aria-hidden="true"/g) || []).length);
  assert.equal((svg.match(/<svg /g) || []).length,
    (svg.match(/class="pointer-events-none /g) || []).length, 'no part takes the pointer');
  assert.deepEqual(paints(svg).filter((p) => !tokenOrStructural(p)), [], 'tokens only');
  assert.doesNotMatch(svg, /opacity="|-opacity=/, 'no literal intensity');
});

test('the plate type never drops below 12 px', () => {
  for (const [name, cls] of Object.entries(label)) {
    assert.match(cls, /\btext-xs\b/, `${name} is 12 px`);
    assert.doesNotMatch(cls, /text-\[(?:\d|1[01])px\]|text-2xs/, `${name} has no smaller step`);
  }
});

test('a jack: typed ring, inner glyph, hidden 44 px hit square, focus ring; a nut below', () => {
  const g = jack.jackSvg({ key: 'vco1.audio:out', x: 30, y: 40, shape: 'diamond', label: 'VCO 1 '
    + 'Audio <out>', ring: '#tb', inner: '#t9', text: 'Audio ▸', textSize: 12, tokens: T });
  assert.match(g, new RegExp('^<g role="button" tabindex="0" data-jack="vco1.audio:out" '
    + 'aria-label="VCO 1 Audio &lt;out&gt;"'));
  assert.match(g, new RegExp('<rect data-hit="" x="8" y="18" width="44" height="44"[^>]*'
    + 'visibility="hidden" pointer-events="all"'));
  assert.match(g, /<rect data-focus-ring=""/);
  assert.equal((g.match(/data-ring=""/g) || []).length, 1);
  assert.match(g, /<path d="M 30 27 L 43 40 L 30 53 L 17 40 Z" data-ring=""/, 'the typed shape');
  assert.deepEqual(paints(g).filter((p) => !tokenOrStructural(p)), []);
  const nut = jack.nutSvg({ x: 30, y: 40, tokens: T });
  assert.match(nut, /^<path data-nut="" d="M [^"]+ Z" fill="#t5" stroke="#t7"/);
  assert.equal(nut.match(/L /g).length, 5, 'a hexagon');
  const lt = jack.layerTokens(T);
  assert.equal(lt.jack.refuse, '#td');
  assert.deepEqual(lt.cable.palette, T.cables);
  const cord = jack.patchCord({ id: 'c1', from: { x: 0, y: 0 }, to: { x: 100, y: 0 },
    type: 'CONTROL', colour: '#c1', tokens: lt });
  assert.match(cord.cable, /data-sheen="" class="opacity-hw-sheen"/);
  assert.equal((cord.plugs.match(/data-plug=""/g) || []).length, 2);
  // JC-3: each plug's boot leaves the way its cord does, as cableSvg({ plugs: true }) draws it.
  const ends = cable.cableSvg({ id: 'c1', from: { x: 0, y: 0 }, to: { x: 100, y: 0 },
    type: 'CONTROL', colour: '#c1', tokens: lt, plugs: true });
  assert.equal(cord.plugs, ends.slice(ends.indexOf('<g data-plug=""'), -'</g>'.length),
    'the bay\'s plugs are the cord\'s own, turned along it');
});

test('a readout window says it is computed and refuses anything else', () => {
  const html = display.displayHtml({ id: 'vco1', text: 'f = 261.6 Hz <A>' });
  assert.match(html, /data-display="vco1"/);
  assert.match(html, /Computed from the settings/);
  assert.match(html, /f = 261\.6 Hz &lt;A&gt;/);
  assert.throws(() => display.displayHtml({ id: 'x', text: '1', source: 'measured' }),
    /computed values only/);
});
