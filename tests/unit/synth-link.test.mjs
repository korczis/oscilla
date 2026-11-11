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
import {
  linkAction, linkOf, linkOmissionText, linkOmissions, linkPlan, skippedText,
} from '../../src/js/synth/link.js';
import { panelStore } from './synth-fixture.mjs';

const dec = (h) => decodeSynthLink(h, PANEL, PRESETS);

test('round trip of a preset, values, an amount and a cable', () => {
  const link = { tab: 'panel', preset: 'bass', values: [['lpf.frequency', 300],
    ['vco1.waveform', 'pulse'], ['lpf.lpf-eg2', 1.5]], cables: [['mg.control', 'lpf.frequency']] };
  const hash = encodeSynthLink(link);
  assert.match(hash, /^m=synth&yp=bass&yv=/);
  assert.deepEqual(dec(`#${hash}`), { ok: true, link: { ...link, engine: null } });
  assert.equal(dec('#m=playground'), null);
});

test('strict: one bad item refuses the whole link with a sentence', () => {
  for (const [h, re] of [['m=synth&yp=nope', /předvolba "nope" neexistuje/],
    ['m=synth&yt=mix', /karta "mix" neexistuje/],
    ['m=synth&yv=vco1.width:200', /Pulse width musí být mezi 5 a 95/],
    ['m=synth&yv=vco1.pitch:1', /není knoflík panelu/], ['m=synth&yv=xx.y:1', /není knoflík/],
    ['m=synth&yc=lpf.audio>mg.control', /není kabel z výstupu do vstupu/],
    ['m=synth&yp=bass&yp=lead', /dvakrát/], ['m=synth&yv=lpf.lpf-eg2:9', /mezi -4 a 4/]]) {
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

// K239 (329.yaml#R10): a link whose cables cannot all apply decoded as ok, and only the BATCH
// applying it was refused ("HPF audio input accepts one connection"), or the cable was dropped;
// and a link made from a patch with Studio edges or normals opened in the Studio left them out
// in silence. Decode now refuses such a link naming the jack, and the copy says what it leaves.
test('K239: a link with two cables into a one-connection input is refused at decode', () => {
  const hpf = dec('#m=synth&yc=vco1.audio>hpf.audio,vco2.audio>hpf.audio');
  assert.equal(hpf.ok, false);
  assert.equal(hpf.reason, 'Odkaz Synthu odmítnut: do vstupu HPF Audio (hpf.audio) vedou 2 '
    + 'kabely, ale přijímá jen jedno spojení.');
  const clock = dec('#m=synth&yc=keys.gate>sh.trigger,keys.gate>sh.trigger');
  assert.match(clock.reason, /kabel keys\.gate → sh\.trigger je v odkazu dvakrát/);
  const two = dec('#m=synth&yc=keys.gate>sh.trigger,keys.gate>mg.reset,keys.gate>sh.trigger');
  assert.match(two.reason, /je v odkazu dvakrát/, 'one cable twice, wherever it repeats');
  const type = dec('#m=synth&yc=mg.control>sh.trigger');
  assert.equal(type.reason, 'Odkaz Synthu odmítnut: kabel mg.control → sh.trigger nelze '
    + 'zapojit: výstup typu CONTROL nelze zapojit do vstupu typu TRIGGER.');
  // a control input sums its cables (multiple): two into the cutoff decode as before
  assert.deepEqual(dec('#m=synth&yc=mg.control>lpf.frequency,eg1.control>lpf.frequency').link
    .cables, [['mg.control', 'lpf.frequency'], ['eg1.control', 'lpf.frequency']]);
});

test('K239: a link of a patch with Studio edges or opened normals says what it leaves out', () => {
  const st = panelStore();
  assert.deepEqual(linkOmissions(st.getModel(), PANEL), { studio: [], open: [] });
  assert.equal(linkOmissionText(linkOmissions(st.getModel(), PANEL)), null, 'nothing to say');
  const lpf = PANEL.resolve(st.getModel()).get('lpf').id;
  assert.equal(st.dispatch({ type: 'EDGE_ADD', from: { node: 'lfo-1', port: 'control' },
    to: { node: lpf, port: 'frequency' }, props: { depth: 1, mapping: 'log' } }).ok, true);
  const n13 = 'semi-mono-1-n13'; // lpf.audio -> vca.audio, the VCA's one normal
  assert.equal(st.dispatch({ type: 'EDGE_REMOVE', edgeIds: [n13] }).ok, true);
  const left = linkOmissions(st.getModel(), PANEL);
  assert.equal(left.studio.length, 1, 'the Studio LFO into the cutoff');
  assert.deepEqual(left.open, ['vca.audio']);
  assert.equal(linkOmissionText(left), 'Odkaz nenese 1 spojení se Studiem ani normál odpojený '
    + 've Studiu (vca.audio); kdo ho otevře, dostane panel bez nich.');
  // and the link itself carries neither: no cable for the Studio edge, the normal as declared
  const link = linkOf(st.getModel(), PANEL, 'init');
  assert.deepEqual(link.cables, []);
});

test('K239: a cable the receiver\'s patch refuses is named when the link applies, never dropped',
  () => {
    // sh.rate while Clock is normalled (n23, Keys Gate into S&H Clock): patchCable refuses it,
    // and linkAction skipped it in silence. linkPlan returns it with its reason.
    const st = panelStore();
    const link = { tab: 'panel', engine: null, preset: null, values: [],
      cables: [['mg.control', 'sh.rate'], ['mg.control', 'lpf.frequency']] };
    const plan = linkPlan(st.getModel(), PANEL, link);
    assert.deepEqual(plan.skipped.map((x) => [x.from, x.to]), [['mg.control', 'sh.rate']]);
    assert.match(plan.skipped[0].reason, /^S&H Rate nemá účinek, dokud je zapojený Clock/);
    assert.equal(skippedText(plan.skipped), 'Odkaz nezapojil 1 kabel: mg.control → sh.rate '
      + `(${plan.skipped[0].reason.replace(/\.$/, '')}).`);
    // the rest of the link applies, and linkAction is the same BATCH
    assert.deepEqual(linkAction(st.getModel(), PANEL, link), plan.action);
    assert.equal(st.dispatch(plan.action).ok, true);
    const cables = linkOf(st.getModel(), PANEL, 'init').cables.map(([a, b]) => `${a}>${b}`);
    assert.deepEqual(cables, ['mg.control>lpf.frequency']);
    // two refused: the count says it in Czech
    const two = linkPlan(panelStore().getModel(), PANEL, { ...link,
      cables: [['mg.control', 'sh.rate'], ['mg.control', 'vca.gain']] });
    assert.match(skippedText(two.skipped), /^Odkaz nezapojil 2 kabely: mg\.control → sh\.rate \(/);
    assert.equal(skippedText([]), null);
  });

test('K243 (R2-T7B-2): the skipped-cable sentence names jacks as the bay does', () => {
  const skipped = [{ from: 'mg.control', to: 'sh.rate', reason: 'S&H Rate nemá účinek.' }];
  const names = { 'mg.control': 'MG Control', 'sh.rate': 'S&H Rate' };
  const text = skippedText(skipped, (id) => names[id] || id);
  assert.equal(text, 'Odkaz nezapojil 1 kabel: MG Control → S&H Rate (S&H Rate nemá účinek).');
  assert.doesNotMatch(text, /mg\.control|sh\.rate/, 'no raw jack id in the sentence');
});
