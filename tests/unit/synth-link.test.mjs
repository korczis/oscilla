// K106 (part): the Synth deep link (src/js/core/url-state-synth.js): its own keys yt / yp / yv /
// yc (never `sv`, a Studio key), strict refusals, routing through `m=synth`, the dispatcher's
// domain list, and no clash with any other codec's key.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SYNTH_LINK_KEYS, decodeSynthLink, encodeSynthLink, withoutSynthParams,
} from '../../src/js/core/url-state-synth.js';
import { STUDIO_LINK_KEYS } from '../../src/js/core/url-state-studio.js';
import { RECIPE_HASH_KEY } from '../../src/js/core/url-state-measure.js';
import { RECORD_LINK_KEYS } from '../../src/js/core/url-state-records.js';
import { KEYBOARD_LINK_KEY } from '../../src/js/midi/keyboard.js';
import {
  HASH_DOMAINS, INSTRUMENT_HASH_KEYS, hashAfterRefusal, hashForWorkspace, routeOfHash,
} from '../../src/js/ui/navigation.js';
import PANEL from '../../src/js/synth/panels/semi-mono.js';
import { PRESETS } from '../../src/js/synth/presets.js';

const dec = (h) => decodeSynthLink(h, PANEL, PRESETS);

test('round trip of a preset, values, an amount and a cable', () => {
  const link = { tab: 'panel', preset: 'bass', values: [['lpf.frequency', 300],
    ['vco1.waveform', 'pulse'], ['lpf.lpf-eg2', 1.5]], cables: [['mg.control', 'lpf.frequency']] };
  const hash = encodeSynthLink(link);
  assert.match(hash, /^m=synth&yp=bass&yv=/);
  assert.deepEqual(dec(`#${hash}`), { ok: true, link });
  assert.equal(dec('#m=playground'), null);
});

test('strict: one bad item refuses the whole link with a sentence', () => {
  for (const [h, re] of [['m=synth&yp=nope', /no preset "nope"/], ['m=synth&yt=drums', /no tab/],
    ['m=synth&yv=vco1.width:200', /Pulse width must be between 5 and 95/],
    ['m=synth&yv=vco1.pitch:1', /names no knob/], ['m=synth&yv=xx.y:1', /names no knob/],
    ['m=synth&yc=lpf.audio>mg.control', /not a cable/], ['m=synth&yp=bass&yp=lead', /twice/],
    ['m=synth&yv=lpf.lpf-eg2:9', /between -4 and 4/]]) {
    const r = dec(`#${h}`);
    assert.equal(r.ok, false, h);
    assert.match(r.reason, re, h);
  }
});

test('routing: #m=synth opens Synth; the keys leave with the workspace and after a refusal', () => {
  assert.deepEqual(routeOfHash('#m=synth&yp=bass'), { workspace: 'synth', owner: 'workspace' });
  assert.ok(HASH_DOMAINS.includes('synth'));
  assert.equal(HASH_DOMAINS.at(-1), 'records', 'records stays last');
  assert.equal(new URLSearchParams(hashForWorkspace('m=synth&yp=bass', 'synth')).get('yp'), 'bass');
  assert.equal(new URLSearchParams(hashForWorkspace('m=synth&yp=bass', 'studio')).get('yp'), null);
  const off = hashAfterRefusal('m=synth&yp=nope', { synth: false }, 'synth');
  assert.equal(new URLSearchParams(off).get('yp'), null);
  assert.equal(withoutSynthParams('m=synth&yp=a&yv=b&f=1'), 'm=synth&f=1');
});

test('no key clashes with the Studio, instrument, recipe, record or keyboard keys', () => {
  const others = [...Object.values(STUDIO_LINK_KEYS), ...INSTRUMENT_HASH_KEYS, RECIPE_HASH_KEY,
    ...Object.values(RECORD_LINK_KEYS), KEYBOARD_LINK_KEY, 'm'];
  for (const k of Object.values(SYNTH_LINK_KEYS)) assert.equal(others.includes(k), false, k);
  assert.notEqual(SYNTH_LINK_KEYS.tab, 'sv');
});
