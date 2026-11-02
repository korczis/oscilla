// The control-drive ratchet (C020, PACK 03 finding control-census-5): every control of
// src/index.html is operated by some browser suite, or is recorded debt that only shrinks.
//
// A control is a start tag of src/index.html (comments removed) that is an input, select,
// button or textarea, or carries an interactive role (slider, switch, listbox, tab, radio,
// checkbox, spinbutton) or tabindex="0". Its key is `#<id>` when it has a static id, else
// its static data-osc value (one key for every element that shares it), else each value of a
// bound data-osc that chooses between two string literals (`:data-osc="c ? 'a' : 'b'"`, one
// field template that renders two controls, keyed `a` and `b`); a control with none of these
// has no key and is not judged. A control is DRIVEN when a file under tests/browser
// (fixtures and node_modules apart) performs an action (click, fill, selectOption, press,
// check, tap, dispatchEvent, focus, hover, setInputFiles, dragTo, type, keyboard., mouse.,
// a value assignment or a synthetic input/pointer/keyboard event) on the line that names the
// key or on the line before or after it. A comment line names nothing. This is the cover()
// logic of the PACK 03 census, so its numbers are the finding's.
//
// tests/unit/control-drive-baseline.json lists the keys no browser suite drives. The tree
// must hold exactly that list (a new undriven control, or a suite that stops driving one,
// fails; so does an entry that is driven now or gone), and the list only shrinks: no key is
// listed that an earlier commit of the file had removed or never had. The controls the owner
// named in PACK 03 (filters, envelope, sequencer with Tempo and Loop, additive, dual, phase
// and stereo, source, device, settings, analysis) may never be listed.
//
// What it does not decide: that the action asserts the control's effect (the suites do,
// and the reviewer reads them), a selector built at run time, or a control Alpine creates
// with a bound id only.
//   node --test tests/unit/control-drive-baseline.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const BASELINE_REL = 'tests/unit/control-drive-baseline.json';
const NAME = 'control-drive ratchet';

/** The 90 controls PACK 03 names (finding control-census-5); none may be undriven. */
export const OWNER_NAMED = Object.freeze({
  filter: ['#osc-filter-enable', '#osc-ftype-lowpass', '#osc-ftype-highpass',
    '#osc-ftype-bandpass', '#osc-ftype-notch', '#osc-ftype-peaking', '#osc-filter-cutoff-value',
    '#osc-filter-cutoff', '#osc-filter-q-value', '#osc-filter-q', '#osc-filter-gain'],
  envelope: ['#osc-env-enable', '#osc-env-attack-value', '#osc-env-attack',
    '#osc-env-decay-value', '#osc-env-decay', '#osc-env-sustain-value', '#osc-env-sustain',
    '#osc-env-release-value', '#osc-env-release'],
  sequencer: ['#osc-seq-play', '#osc-seq-stop', '#osc-seq-record', '#osc-seq-tempo',
    '#osc-seq-start', '#osc-seq-timeline', '#osc-seq-add', 'seq.addType',
    '#osc-seq-move-earlier', '#osc-seq-move-later', '#osc-seq-delete', '#osc-seq-start-hz',
    '#osc-seq-end-hz', '#osc-seq-duration', '#osc-seq-curve'],
  additive: ['#osc-add-preset', '#osc-add-enable', '#osc-add-harmonic', '#osc-add-gain-value',
    '#osc-add-gain', '#osc-add-phase'],
  dual: ['#osc-dual-enable', '#osc-dual-a-freq', '#osc-dual-a-range', '#osc-dual-a-wave',
    '#osc-dual-a-gain', '#osc-dual-a-detune', '#osc-dual-b-freq', '#osc-dual-b-range',
    '#osc-dual-b-wave', '#osc-dual-b-gain', '#osc-dual-b-detune', '#osc-dual-level-a',
    '#osc-dual-level-b', '#osc-dual-mono', '#osc-dual-stereo'],
  phase: ['#osc-phase-offset', '#osc-stereo-fa', '#osc-stereo-fb', '#osc-stereo-pan',
    '#osc-stereo-mono', '#osc-stereo-split'],
  source: ['#osc-wave-square', '#osc-wave-triangle', '#osc-wave-sawtooth', '#osc-freq-slider',
    '#osc-step-oct-down', '#osc-step-st-down', '#osc-step-10-up', '#osc-mode-note', '#osc-gain',
    '#osc-pattern-select', 'pattern.param', 'sweep.param', '#sw-direction'],
  device: ['#osc-safety-limit', '#osc-continuous-toggle'],
  settings: ['#osc-set-range', '#osc-set-min', '#osc-set-max', '#osc-set-a4',
    '#osc-set-duration', '#osc-set-attack', '#osc-set-release'],
  analysis: ['#osc-time-window', '#osc-spec-max', '#osc-spg-span-select',
    '#osc-spg-scale-select', 'mic.average', 'mic.peakHold'],
});

// ------------------------------------------------------------------------------ the scan
const CONTROL = new RegExp('<(input|select|button|textarea)\\b[^>]*>'
  + '|<[a-z][a-z0-9-]*\\b(?=[^>]*\\s(?:role="(?:slider|switch|listbox|tab|radio|checkbox|'
  + 'spinbutton)"|tabindex="0"))[^>]*>', 'g');
const DRIVE = new RegExp('\\.(click|fill|selectOption|press|check|uncheck|tap|dispatchEvent|'
  + 'focus|hover|setInputFiles|dragTo|type)\\(|keyboard\\.|mouse\\.|\\.value\\s*=[^=]'
  + '|new (Input|Mouse|Pointer|Keyboard)Event');

/** Every keyed control of an HTML text: [{ key, line }], one entry per key, in order. */
export function controlsOf(html) {
  const text = html.replace(/<!--[\s\S]*?-->/g, (c) => c.replace(/[^\n]/g, ' '));
  const out = new Map();
  for (const m of text.matchAll(CONTROL)) {
    const tag = m[0];
    const id = /\sid="([^"]+)"/.exec(tag);
    const osc = /\sdata-osc="([^"]+)"/.exec(tag);
    const bound = /\s:data-osc="\s*[\w.]+\s*\?\s*'([^']+)'\s*:\s*'([^']+)'\s*"/.exec(tag);
    const keys = id ? [`#${id[1]}`] : osc ? [osc[1]] : bound ? [bound[1], bound[2]] : [];
    for (const key of keys) {
      if (!out.has(key)) out.set(key, { key, line: text.slice(0, m.index).split('\n').length });
    }
  }
  return [...out.values()];
}

/** The spellings by which a test line names a key (the census's cover()). */
function namesOf(key) {
  if (key.startsWith('#')) {
    const raw = key.slice(1);
    return [`#${raw}`, `'${raw}'`, `"${raw}"`, `\`${raw}\``];
  }
  return [`"${key}"`, `'${key}'`, `=${key}]`, `\\"${key}\\"`];
}

const isComment = (line) => /^\s*(\/\/|\/\*|\*)/.test(line);

/** The test files that drive `key`: files is [{ f, lines }]. */
export function drivenBy(files, key) {
  const names = namesOf(key);
  const hit = [];
  for (const { f, lines } of files) {
    const code = lines.map((l) => (isComment(l) ? '' : l));
    const drives = code.some((l, i) => names.some((n) => l.includes(n))
      && DRIVE.test([code[i - 1] || '', l, code[i + 1] || ''].join('\n')));
    if (drives) hit.push(f);
  }
  return hit;
}

/** The keys of `html` that no file of `files` drives, sorted. */
export function undrivenOf(html, files) {
  return controlsOf(html).map((c) => c.key).filter((k) => !drivenBy(files, k).length).sort();
}

/** The tree against the baseline: unlisted (undriven, not listed), stale (listed, not undriven). */
export function compare(undriven, listed) {
  const now = new Set(undriven);
  const rec = new Set(listed);
  return { unlisted: undriven.filter((k) => !rec.has(k)),
    stale: listed.filter((k) => !now.has(k)) };
}

/** Keys of `listed` absent from an earlier version of the baseline: [[key, sha]]. */
export function grown(listed, history) {
  const out = [];
  for (const { sha, undriven } of history) {
    const then = new Set(undriven);
    for (const k of listed) if (!then.has(k)) out.push([k, sha]);
  }
  return out;
}

function walk(dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name !== 'node_modules' && e.name !== 'fixtures') walk(p, out);
    } else if (/\.(cjs|mjs|js)$/.test(e.name)) out.push(p);
  }
  return out;
}

function browserFiles() {
  return walk(path.join(ROOT, 'tests', 'browser')).map((p) => ({
    f: path.relative(ROOT, p).split(path.sep).join('/'),
    lines: readFileSync(p, 'utf8').split('\n') }));
}

const HTML = readFileSync(path.join(ROOT, 'src', 'index.html'), 'utf8');
const readBaseline = () => JSON.parse(readFileSync(path.join(ROOT, BASELINE_REL), 'utf8'));

// ------------------------------------------------------------------------------ the tree
test('every control the owner named in PACK 03 is driven by a browser suite', () => {
  const files = browserFiles();
  const keys = new Set(controlsOf(HTML).map((c) => c.key));
  const all = Object.values(OWNER_NAMED).flat();
  assert.equal(all.length, 90, 'the owner-named list holds the 90 controls of the finding');
  assert.deepEqual(all.filter((k) => !keys.has(k)), [],
    `${NAME}: an owner-named control is no longer a control of src/index.html`);
  const undriven = Object.entries(OWNER_NAMED).flatMap(([area, ks]) => ks
    .filter((k) => !drivenBy(files, k).length).map((k) => `${area} ${k}`));
  assert.deepEqual(undriven, [], `${NAME}: ${undriven.length} owner-named control(s) are `
    + `driven by no tests/browser file:\n  ${undriven.join('\n  ')}`);
  const listed = new Set(readBaseline().undriven);
  assert.deepEqual(all.filter((k) => listed.has(k)), [],
    `${NAME}: an owner-named control may not be recorded as debt in ${BASELINE_REL}`);
});

test('the tree holds exactly the undriven controls the baseline lists', () => {
  const b = readBaseline();
  assert.ok(typeof b.note === 'string' && Array.isArray(b.undriven), `${BASELINE_REL} shape`);
  assert.deepEqual(b.undriven, [...new Set(b.undriven)].sort(), 'sorted, each key once');
  const { unlisted, stale } = compare(undrivenOf(HTML, browserFiles()), b.undriven);
  assert.deepEqual(unlisted, [], `${NAME}: control(s) no tests/browser file drives; drive `
    + 'each in the suite that owns its behaviour (never list a new one):\n  '
    + unlisted.join('\n  '));
  assert.deepEqual(stale, [], `${NAME}: listed but driven now or gone; remove from `
    + `${BASELINE_REL}:\n  ${stale.join('\n  ')}`);
});

/** The baseline of every commit that changed it, newest first; null without history. */
function baselineHistory() {
  const git = (...args) => spawnSync('git', args, { cwd: ROOT, encoding: 'utf8' });
  if (git('rev-parse', '--verify', '-q', 'HEAD').status !== 0) return null;
  const log = git('log', '--format=%H', '--', BASELINE_REL);
  if (log.status !== 0) return null;
  return log.stdout.split('\n').filter(Boolean).map((sha) => ({ sha: sha.slice(0, 12),
    undriven: JSON.parse(git('show', `${sha}:${BASELINE_REL}`).stdout).undriven }));
}

test('the baseline only shrinks: no key is listed that an earlier commit did not list', (t) => {
  const history = baselineHistory();
  if (!history || !history.length) {
    if (history && process.env.GITHUB_ACTIONS === 'true') {
      assert.fail(`no commit holds ${BASELINE_REL}: the CI unit job checks out with `
        + 'fetch-depth: 0');
    }
    t.skip('no git history of the baseline here');
    return;
  }
  const raised = grown(readBaseline().undriven, history);
  assert.deepEqual(raised, [], `${NAME}: the baseline grew; it may only shrink:\n  `
    + raised.map(([k, sha]) => `${k}, not listed at ${sha}`).join('\n  '));
});

// ------------------------------------------------------------------------------ mutations
const fixture = (src) => (Array.isArray(src) ? src : src.split('\n'));
const HTML_FIX = [
  '<button type="button" id="a-btn">A</button>',
  '<input id="b-range" type="range">',
  '<div role="slider" tabindex="0" data-osc="c.knob"></div>',
  '<!-- <button id="in-comment">x</button> -->',
  '<input :id="paramId(d)" data-osc="d.param">',
  '<span id="not-a-control">text</span>',
  '<button type="button">no key</button>',
  '<select :id="fid(d)" :data-osc="isSweep ? \'e.sweep\' : \'e.pattern\'"></select>',
  '<input :data-osc="kindOf(d)">',
].join('\n');

test('mutation: the scan keys controls by id, else data-osc, and skips comments', () => {
  assert.deepEqual(controlsOf(HTML_FIX).map((c) => c.key),
    ['#a-btn', '#b-range', 'c.knob', 'd.param', 'e.sweep', 'e.pattern'],
    'a bound data-osc of two literals keys both; any other bound expression keys nothing');
});

test('mutation: an action on the naming line or the next one drives; a name alone does not', () => {
  const files = [{ f: 'tests/browser/x.cjs', lines: fixture([
    "await page.click('#a-btn');",
    "const box = await page.locator('#b-range').boundingBox();",
    'await page.mouse.click(box.x, box.y);',
    '',
    "const v = await page.evaluate(() => document.querySelector('[data-osc=\"c.knob\"]').value);",
    '',
    '',
    "await page.fill('[data-osc=\"d.param\"]', '3');",
    '',
    "await page.selectOption('[data-osc=\"e.sweep\"]', 'up');"]) }];
  assert.deepEqual(undrivenOf(HTML_FIX, files), ['c.knob', 'e.pattern'],
    'each value of a bound data-osc is driven on its own');
  const removed = [{ f: files[0].f, lines: files[0].lines.filter((l) => !l.includes('#a-btn')) }];
  assert.deepEqual(undrivenOf(HTML_FIX, removed), ['#a-btn', 'c.knob', 'e.pattern'],
    'a deleted drive leaves its control undriven');
  const far = [{ f: files[0].f, lines: fixture("const s = '#a-btn';\n\nawait page.click(s);") }];
  assert.deepEqual(drivenBy(far, '#a-btn'), [], 'an action two lines away does not drive');
  const commented = [{ f: files[0].f, lines: fixture("// await page.click('#a-btn');") }];
  assert.deepEqual(drivenBy(commented, '#a-btn'), [], 'a comment does not drive');
});

test('mutation: a new undriven control and a stale entry are both refused', () => {
  assert.deepEqual(compare(['#a', '#new'], ['#a']), { unlisted: ['#new'], stale: [] });
  assert.deepEqual(compare(['#a'], ['#a', '#driven-now']), { unlisted: [],
    stale: ['#driven-now'] });
  assert.deepEqual(compare(['#a'], ['#a']), { unlisted: [], stale: [] });
});

test('mutation: a key added, or listed again after it was removed, is refused', () => {
  const history = [{ sha: 'lowered', undriven: ['#a'] },
    { sha: 'original', undriven: ['#a', '#b'] }];
  assert.deepEqual(grown(['#a'], history), []);
  assert.deepEqual(grown([], history), [], 'paid off');
  assert.deepEqual(grown(['#a', '#b'], history), [['#b', 'lowered']], 'listed again');
  assert.deepEqual(grown(['#a', '#c'], history), [['#c', 'lowered'], ['#c', 'original']],
    'a new key');
});

test('mutation: cutting the drive of an owner-named control is caught on the tree', () => {
  const files = browserFiles();
  for (const key of ['#osc-ftype-bandpass', '#osc-seq-tempo', '#osc-set-a4']) {
    assert.ok(drivenBy(files, key).length, `${key} is driven in the tree`);
    const names = namesOf(key);
    const cut = files.map(({ f, lines }) => ({ f,
      lines: lines.map((l) => (names.some((n) => l.includes(n)) ? '' : l)) }));
    assert.deepEqual(drivenBy(cut, key), [], `${key}: undriven once its lines are gone`);
    assert.ok(undrivenOf(HTML, cut).includes(key));
    assert.deepEqual(compare(undrivenOf(HTML, cut), readBaseline().undriven).unlisted, [key]);
  }
});
