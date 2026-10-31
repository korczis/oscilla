// K059 (wording): the Synth's shipped copy names no product, brand or model and makes no
// "analog", "vintage", "warm" or "fat" claim (project.no-fake-science; design §10); the honest
// limits are said where the controls are: a set pulse width, a filter peak that does not
// self-oscillate, a sample-and-hold of a seeded source.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('../../', import.meta.url).pathname;
const walk = (dir) => readdirSync(join(ROOT, dir)).flatMap((f) => {
  const p = join(dir, f);
  return statSync(join(ROOT, p)).isDirectory() ? walk(p) : [p];
});
const html = readFileSync(join(ROOT, 'src/index.html'), 'utf8');
const synthMarkup = html.slice(html.indexOf('id="osc-view-synth"'),
  html.indexOf('<!-- ================= STUDIO (V3.1)'));
const learn = readFileSync(join(ROOT, 'src/js/data/learn.js'), 'utf8');
const learnSynth = learn.slice(learn.indexOf("id: 'semi-modular-voice'"));
const SOURCES = [...walk('src/js/synth'), 'src/js/studio/nodes/instrument.js',
  'src/js/studio/adapters/instrument.js', 'src/js/studio/live-notes.js']
  .map((p) => [p, readFileSync(join(ROOT, p), 'utf8')]);

const BANNED = /\b(ms-?20|korg|arturia|moog|roland|kaoss\w*|ableton|elektron|dx-?7|tb-?303|tr-?808|minimoog|prophet|behringer)\b/i;
const CLAIMS = /\b(analogue?|vintage|warm|fat|classic circuit)\b/i;

test('no product name and no analog / vintage / warm / fat claim in Synth copy', () => {
  assert.ok(learnSynth.length > 100, 'the Learn topic exists');
  for (const [p, text] of [...SOURCES, ['src/index.html#synth', synthMarkup],
    ['src/js/data/learn.js#semi-modular-voice', learnSynth.slice(0, 4000)]]) {
    assert.doesNotMatch(text, BANNED, p);
    assert.doesNotMatch(text, CLAIMS, p);
  }
});

test('the honest limits are stated with the controls they limit', () => {
  const all = SOURCES.map(([, t]) => t).join('\n');
  assert.match(all, /Pulse width is set, not modulated/);
  assert.match(all, /does not self-oscillate/);
  assert.match(all, /samples no input/);
  assert.match(all, /0\.95|SAFE_NYQUIST_FACTOR/);
  assert.match(synthMarkup, /Semi-modular mono voice/);
});
