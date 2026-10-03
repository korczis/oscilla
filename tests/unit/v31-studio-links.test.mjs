// V3.1 Studio deep link and browser fullscreen helpers (spec §133-§135, §199-§200; plan V422):
//   - core/url-state-studio.js: the `m=studio&st=…&sv=…` hash codec — round trip, refusal of
//     every malformed / unknown value (whole link, readable sentence), coexistence with the
//     instrument hash (url-state.js) and the MEASURE recipe (`mr`)
//   - ui/studio/workspace.js: studioLinkView (template only while unmodified) and
//     fullscreenSupport (feature detection, with the reason shown when unavailable)
//   node --test tests/unit/v31-studio-links.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  STUDIO_LINK_MAX_CHARS, STUDIO_LINK_SUBVIEWS, decodeStudioLink, encodeStudioLink,
  withoutStudioParams,
} from '../../src/js/core/url-state-studio.js';
import { decodeHash, restoreFromHash } from '../../src/js/core/url-state.js';
import { recipeParamOf, withRecipeParam } from '../../src/js/core/url-state-measure.js';
import { STUDIO_TEMPLATES } from '../../src/js/studio/templates/index.js';
import {
  FULLSCREEN_BLOCKED, FULLSCREEN_UNSUPPORTED, STUDIO_SUBVIEWS, fullscreenElementOf,
  fullscreenSupport, studioLinkView,
} from '../../src/js/ui/studio/workspace.js';

const IDS = STUDIO_TEMPLATES.map((t) => t.id);

test('§199 every shipped template and subview round-trips through the hash', () => {
  assert.deepEqual(STUDIO_LINK_SUBVIEWS, STUDIO_SUBVIEWS);
  for (const templateId of [null, ...IDS]) {
    for (const subview of [null, ...STUDIO_LINK_SUBVIEWS]) {
      const hash = encodeStudioLink({ templateId, subview });
      assert.ok(hash.startsWith('m=studio'), hash);
      assert.ok(hash.length < 64, `short link: ${hash}`);
      assert.deepEqual(decodeStudioLink(`#${hash}`), { ok: true, templateId, subview });
      assert.deepEqual(decodeStudioLink(hash), { ok: true, templateId, subview });
    }
  }
  assert.equal(encodeStudioLink({ templateId: 'filter-automation', subview: 'timeline' }),
    'm=studio&st=filter-automation&sv=timeline');
});

test('§199 a hash without Studio keys is not a Studio link', () => {
  for (const h of ['', '#', '#v=1&m=playground&f=440', '#mr=eyJ2IjoxfQ', '#m=learn',
    'garbage', '#%%%']) {
    assert.equal(decodeStudioLink(h), null, h);
  }
});

test('§199 a malformed or unknown link is refused whole, with a sentence', () => {
  const cases = [
    ['#m=studio&st=nope', /unknown Studio template "nope" \(shipped: basic-tone/],
    ['#m=studio&st=', /template id is empty/],
    ['#m=studio&st=Basic%20Tone', /"Basic Tone" is not a template id/],
    [`#m=studio&st=${'a'.repeat(STUDIO_LINK_MAX_CHARS + 1)}`, /is not a template id/],
    ['#m=studio&st=<script>', /is not a template id/],
    ['#m=studio&sv=mixer', /unknown Studio view "mixer" \(graph, timeline, inspector\)/],
    ['#m=studio&sv=', /unknown Studio view ""/],
    ['#st=basic-tone', /needs m=studio/],
    ['#m=playground&sv=graph', /needs m=studio/],
    ['#m=studio&st=basic-tone&st=stereo-beat', /"st" appears more than once/],
    ['#m=studio&m=studio', /"m" appears more than once/],
  ];
  for (const [h, re] of cases) {
    const r = decodeStudioLink(h);
    assert.equal(r.ok, false, h);
    assert.ok(r.errors.some((e) => re.test(e)), `${h}: ${r.errors.join(' | ')}`);
    assert.ok(!('templateId' in r), 'nothing partly applied');
  }
  // A good template with a bad view is still refused whole.
  const r = decodeStudioLink('#m=studio&st=basic-tone&sv=mixer');
  assert.equal(r.ok, false);
  assert.equal(r.errors.length, 1);
  // A long hostile value is quoted shortened, never echoed whole.
  const long = decodeStudioLink(`#m=studio&sv=${'x'.repeat(500)}`);
  assert.ok(long.errors[0].length < 120, long.errors[0]);
});

test('§199 the template list a link may open can be narrowed', () => {
  assert.equal(decodeStudioLink('#m=studio&st=basic-tone', { templateIds: ['stereo-beat'] }).ok,
    false);
  assert.equal(decodeStudioLink('#m=studio&st=stereo-beat', { templateIds: ['stereo-beat'] }).ok,
    true);
});

test('§199 the Studio keys coexist with the instrument hash and the MEASURE recipe', () => {
  const hash = 'v=1&m=studio&s=single&p=tone&w=sine&f=523&g=0.2&mr=eyJ2IjoxfQ'
    + '&st=basic-tone&sv=inspector';
  assert.deepEqual(decodeStudioLink(hash), { ok: true, templateId: 'basic-tone',
    subview: 'inspector' });
  // The instrument restores its configuration and ignores `m=studio` (not a V1 mode).
  const d = decodeHash(hash);
  assert.equal(d.cfg.frequency, 523);
  assert.equal(restoreFromHash(null, hash, { sampleRate: 48000 }).mode, null);
  // A pure Studio link carries no instrument configuration.
  assert.equal(decodeHash('m=studio&st=basic-tone'), null);
  assert.equal(recipeParamOf(hash), 'eyJ2IjoxfQ');
  // A recipe link drops the Studio keys and keeps the rest.
  const recipe = withRecipeParam(withoutStudioParams(hash), 'eyJ2IjoyfQ');
  assert.equal(decodeStudioLink(recipe), null);
  assert.equal(recipeParamOf(recipe), 'eyJ2IjoyfQ');
  assert.equal(decodeHash(recipe).cfg.frequency, 523);
  // A V1 mode in `m` is not a Studio key and survives.
  assert.equal(withoutStudioParams('v=1&m=learn&f=440'), 'v=1&m=learn&f=440');
});

test('§200 Copy link carries the template only while the document is that template unmodified',
  () => {
    const t = STUDIO_TEMPLATES.find((x) => x.id === 'filter-automation');
    const same = studioLinkView({ templateId: t.id, templateUnmodified: true,
      subview: 'timeline', title: t.title });
    assert.equal(same.hash, 'm=studio&st=filter-automation&sv=timeline');
    assert.equal(same.templateId, t.id);
    assert.match(same.note, new RegExp(`template ${t.title} in the Timeline view`));
    const edited = studioLinkView({ templateId: t.id, templateUnmodified: false,
      subview: 'inspector', title: 'My synth' });
    assert.equal(edited.hash, 'm=studio&sv=inspector');
    assert.equal(edited.templateId, null);
    assert.match(edited.note,
      /Studio workspace in the Inspector view only: “My synth” is not an unmodified template/);
    assert.match(edited.note, /export a project file/);
    const project = studioLinkView({ templateId: null, subview: 'bogus' });
    assert.equal(project.hash, 'm=studio&sv=graph');
    // Every link the view writes decodes back to what it says.
    for (const v of [same, edited, project]) {
      const r = decodeStudioLink(v.hash);
      assert.equal(r.ok, true);
      assert.equal(r.templateId, v.templateId);
      assert.equal(r.subview, v.subview);
    }
  });

test('§134 fullscreen is feature-detected, with the reason when it is not offered', () => {
  const el = { requestFullscreen() {} };
  assert.deepEqual(fullscreenSupport({ fullscreenEnabled: true }, el),
    { available: true, reason: '' });
  // WebKit-prefixed (older Safari, iPad).
  assert.deepEqual(fullscreenSupport({ webkitFullscreenEnabled: true },
    { webkitRequestFullscreen() {} }), { available: true, reason: '' });
  // iPhone Safari: no element fullscreen at all.
  assert.deepEqual(fullscreenSupport({}, {}), { available: false,
    reason: FULLSCREEN_UNSUPPORTED });
  assert.deepEqual(fullscreenSupport({ fullscreenEnabled: true }, null), { available: false,
    reason: FULLSCREEN_UNSUPPORTED });
  // An iframe without allow="fullscreen", or a policy.
  assert.deepEqual(fullscreenSupport({ fullscreenEnabled: false }, el), { available: false,
    reason: FULLSCREEN_BLOCKED });
  assert.match(FULLSCREEN_UNSUPPORTED, /Studio already fills the window/);
  const view = {};
  assert.equal(fullscreenElementOf({ fullscreenElement: view }), view);
  assert.equal(fullscreenElementOf({ webkitFullscreenElement: view }), view);
  assert.equal(fullscreenElementOf({}), null);
});
