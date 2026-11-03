// F013 W1: the SYN visual reference (scripts/visual-synth.mjs, tests/visual/synth/) is the one
// the plan agreed, held without a browser: the Synth workspace's Panel, Engines and XY tabs at
// desktop 1536x1024 and phone 390x844, in the dark and the light theme, a patch bay of six cables
// (one from each source colour, the s-look pairs of tests/browser/synth.cjs) seen whole, a 0.5 %
// pixel tolerance, references per environment written only by the script, and the harness wired
// into `npm run test:visual` and the CI visual job like scripts/visual-studio.mjs. The Synth
// layout check (b0's G2: 44 px targets, a 12 px font floor, no overflow at the phone size) lives
// in tests/browser/layout.cjs and is held here by its declarations.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SCRIPT = path.join(ROOT, 'scripts/visual-synth.mjs');
const REF_DIR = path.join(ROOT, 'tests/visual/synth');
const read = (rel) => readFileSync(path.join(ROOT, rel), 'utf8');

const load = async () => {
  assert.ok(existsSync(SCRIPT), 'scripts/visual-synth.mjs exists');
  return import('../../scripts/visual-synth.mjs');
};

test('the tolerance is 0.5 % of pixels, as in the other visual references', async () => {
  const m = await load();
  assert.equal(m.MAX_MISMATCH_PCT, 0.5);
});

test('the views are desktop and phone x Panel, Engines, XY x dark, light, plus the whole bay',
  async () => {
    const { VIEWS } = await load();
    const tabViews = VIEWS.filter((v) => !v.bay);
    const want = [];
    for (const [size, width, height] of [['desktop', 1536, 1024], ['phone', 390, 844]]) {
      for (const tab of ['panel', 'engines', 'xy']) {
        for (const theme of ['dark', 'light']) {
          want.push({ id: `${size}-${tab}-${theme}`, width, height, tab, theme });
        }
      }
    }
    assert.deepEqual(tabViews.map(({ id, width, height, tab, theme }) =>
      ({ id, width, height, tab, theme })), want);
    // The six cables span more than one viewport at the agreed heights (706 px from the Keys row
    // to the VCA row, under a docked keyboard), so the bay is seen whole in its own views at the
    // agreed widths, one per size and theme, each failing closed unless all 12 ends are visible.
    const bay = VIEWS.filter((v) => v.bay);
    assert.deepEqual(bay.map((v) => `${v.id} ${v.width} ${v.tab} ${v.theme}`), [
      'desktop-bay-dark 1536 panel dark', 'desktop-bay-light 1536 panel light',
      'phone-bay-dark 390 panel dark', 'phone-bay-light 390 panel light']);
    for (const v of bay) assert.ok(v.height > (v.width < 600 ? 844 : 1024), `${v.id} is taller`);
    assert.equal(new Set(VIEWS.map((v) => v.id)).size, VIEWS.length, 'view ids are unique');
  });

test('the bay holds the six s-look cables, one from each source colour', async () => {
  const { CABLES } = await load();
  assert.deepEqual(CABLES, [['keys.velocity', 'vco2.tune'], ['vco1.audio', 'ring.modulator'],
    ['vco2.audio', 'mix.in4'], ['ring.audio', 'mix.in3'], ['noise.audio', 'mix.in1'],
    ['mix.audio', 'vca.audio']]);
  const sLook = read('tests/browser/synth.cjs');
  for (const [a, b] of CABLES) {
    assert.ok(sLook.includes(`['${a}', '${b}']`), `s-look patches ${a} -> ${b} too`);
  }
});

test('an unknown view is refused before a browser starts', async () => {
  await load();
  const r = spawnSync(process.execPath, [SCRIPT, 'dist', '--view', 'nope'], { encoding: 'utf8',
    timeout: 20000 });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /unknown view\(s\) nope; views: desktop-panel-dark,/);
});

test('every accepted environment lists every view, and every listed reference exists', async () => {
  const { VIEWS, ENGINE, CABLES } = await load();
  const meta = JSON.parse(readFileSync(path.join(REF_DIR, 'references.json'), 'utf8'));
  assert.equal(meta.schema, 1);
  assert.match(meta.note, /written only by node scripts\/visual-synth\.mjs --update-reference/);
  assert.ok(meta.environments['darwin-arm64'], 'darwin-arm64 is accepted');
  for (const [env, e] of Object.entries(meta.environments)) {
    assert.match(e.browser, /^\d+\.\d+\.\d+\.\d+$/, `${env} records its Chromium build`);
    assert.equal(e.engine, ENGINE, `${env} records the Engines tab's engine`);
    assert.deepEqual(e.cables, CABLES.map(([a, b]) => `${a} -> ${b}`));
    assert.deepEqual(e.views, VIEWS.map((v) => `${v.id} ${v.width}x${v.height}`));
    for (const v of VIEWS) {
      assert.ok(existsSync(path.join(REF_DIR, `${env}-${v.id}.png`)), `${env}-${v.id}.png`);
    }
  }
});

test('npm run test:visual runs the harness and CI uploads its output on failure', () => {
  const pkg = JSON.parse(read('package.json'));
  assert.match(pkg.scripts['test:visual'], /&& node scripts\/visual-synth\.mjs dist$/);
  const ci = read('.github/workflows/ci.yml');
  const job = ci.slice(ci.indexOf('\n  visual:'), ci.indexOf('\n  knowledge:'));
  assert.match(job, /run: npm run test:visual/);
  assert.match(job, /tests\/visual\/out-synth\//);
  assert.match(read('.gitignore'), /tests\/visual\/out\*\//);
});

test('the layout check judges the Synth workspace at the phone size', () => {
  const src = read('tests/browser/layout.cjs');
  assert.match(src, /const SYNTH_PHONE = \[390, 844\];/);
  assert.match(src, /const SYNTH_TABS = \['panel', 'engines', 'xy'\];/);
  assert.match(src, /const FONT_MIN = 12;/);
  assert.match(src, /function measureFonts\(/);
  assert.match(src, /measureTouch, \[TOUCH_MIN, SYNTH_TARGETS\]/);
  assert.match(src, /measureView, 'synth'/);
  assert.match(src, /const KNOWN_SMALL_FONTS = new Map\(/);
});
