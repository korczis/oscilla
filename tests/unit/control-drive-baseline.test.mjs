// Control-drive ratchet (C020, finding control-census-5 of PACK 03): every control of
// src/index.html is operated by a browser test, or it is listed as debt in
// tests/unit/control-drive-baseline.json, and that list only shrinks.
//
// A control is a start tag of src/index.html that a user operates (input, select, button,
// textarea, or an element with an interactive role or tabindex="0") and that carries a static
// id (key `#<id>`) or, without one, a data-osc value (key `<value>`). A control is driven when
// a file under tests/browser (not its fixtures) names its key on a line where, or next to
// which, the test performs a user action: a click, fill, selectOption, press, check, tap,
// focus, hover, dragTo or type call, a keyboard or mouse action, a dispatched input event, or
// one of the user-action drivers of tests/browser/lib/control-drive.cjs (D.keys, D.typeKeys,
// D.slide, D.select, which press keys, type, move a slider by pointer, choose an option).
// Naming a control in an assertion or a page.evaluate is not driving it. A selector built at
// run time (a template string) is not seen: a drive names its control literally.
//
// The checks:
//   - the baseline is exactly the set of undriven controls: a control added with no driving
//     test fails, and a control that is driven now (or gone) and still listed fails too, so
//     every paid-off entry is removed in the change that pays it;
//   - the baseline only shrinks: no entry is missing from any earlier committed version;
//   - none of the 90 controls the owner named (filters, envelope, the sequencer with its Tempo
//     and Loop, additive, dual, phase and stereo, the source, device limits, Settings and the
//     analysis views) is in the baseline: each is driven by a browser test;
//   - a mutation for each: an added control, a removed drive, a drive two lines away, a grown
//     or re-listed baseline, a stale entry.
// Whether the driving test also asserts the control's effect at its subsystem and at a view is
// the reviewer's call; tests/README.md names where each owner-named family is asserted.
//   node --test tests/unit/control-drive-baseline.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (rel) => readFileSync(path.join(ROOT, rel), 'utf8');
const BASELINE_REL = 'tests/unit/control-drive-baseline.json';
const BROWSER_DIR = 'tests/browser';

/** The controls the owner named in PACK 03 (finding control-census-5), by family. */
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

// ------------------------------------------------------------------------------ the census
const TAG = /<(?:input|select|button|textarea)\b[^>]*>|<[a-z][a-z0-9-]*\b[^>]*?\b(?:role="(?:slider|switch|listbox|tab|radio|checkbox|spinbutton|menuitem|menuitemradio|menuitemcheckbox|option|combobox)"|tabindex="0")[^>]*>/g;
const attr = (tag, name) => {
  const m = new RegExp(`\\s${name}="([^"]*)"`).exec(tag);
  return m ? m[1] : '';
};

/** Every control key of an HTML text, sorted and unique: `#id`, else the data-osc value. */
export function controlKeys(html) {
  const text = html.replace(/<!--[\s\S]*?-->/g, (c) => c.replace(/[^\n]/g, ' '));
  const keys = new Set();
  for (const m of text.matchAll(TAG)) {
    const id = attr(m[0], 'id');
    const osc = attr(m[0], 'data-osc');
    if (id) keys.add(`#${id}`);
    else if (osc) keys.add(osc);
  }
  return [...keys].sort();
}

/** A user action on a line: what a test does to a control, not what it reads from one. */
export const DRIVE = /\.(?:click|dblclick|fill|selectOption|press|pressSequentially|check|uncheck|tap|focus|hover|setInputFiles|dragTo|type)\(|\bkeyboard\.|\bmouse\.|new (?:Input|Mouse|Pointer|Keyboard)Event\b|\bD\.(?:keys|typeKeys|slide|select)\(/;

/** The spellings of a key that a test line uses to name it. */
function spellings(key) {
  if (key.startsWith('#')) {
    const raw = key.slice(1);
    return [`#${raw}`, `'${raw}'`, `"${raw}"`, `\`${raw}\``];
  }
  return [`"${key}"`, `'${key}'`, `=${key}]`, `\\"${key}\\"`];
}

/** Is `key` driven in one of `files` ([{ lines }]): named on a line within one of an action. */
export function isDriven(key, files) {
  const pats = spellings(key);
  for (const { lines } of files) {
    for (let i = 0; i < lines.length; i++) {
      if (!pats.some((p) => lines[i].includes(p))) continue;
      const near = [lines[i - 1] || '', lines[i], lines[i + 1] || ''];
      if (near.some((l) => DRIVE.test(l))) return true;
    }
  }
  return false;
}

/** The browser test sources ([{ rel, lines }]), fixtures and dependencies excluded. */
function browserFiles() {
  const out = [];
  const walk = (rel) => {
    for (const e of readdirSync(path.join(ROOT, rel), { withFileTypes: true })) {
      const r = `${rel}/${e.name}`;
      if (e.isDirectory()) {
        if (e.name !== 'node_modules' && e.name !== 'fixtures') walk(r);
      } else if (/\.(?:cjs|mjs|js)$/.test(e.name)) {
        out.push({ rel: r, lines: read(r).split('\n') });
      }
    }
  };
  walk(BROWSER_DIR);
  return out;
}

/** The undriven control keys of an HTML text against a set of test files, sorted. */
export function undriven(html, files) {
  return controlKeys(html).filter((k) => !isDriven(k, files));
}

/** Baseline problems: [kind, key]. 'new' is undriven and unlisted, 'stale' listed and not. */
export function compare(baseline, now) {
  const listed = new Set(baseline);
  const actual = new Set(now);
  return [...now.filter((k) => !listed.has(k)).map((k) => ['new', k]),
    ...baseline.filter((k) => !actual.has(k)).map((k) => ['stale', k])];
}

/** Entries of `baseline` absent from an earlier version: [key, sha]. */
export function grown(baseline, history) {
  const out = [];
  for (const { sha, undriven: then } of history) {
    const was = new Set(then);
    for (const k of baseline) if (!was.has(k)) out.push([k, sha]);
  }
  return out;
}

function readBaseline() {
  return JSON.parse(read(BASELINE_REL));
}

/** The baseline of every commit that changed it, newest first; null without history. */
function baselineHistory() {
  const git = (...args) => spawnSync('git', args, { cwd: ROOT, encoding: 'utf8' });
  if (git('rev-parse', '--verify', '-q', 'HEAD').status !== 0) return null;
  const log = git('log', '--format=%H', '--', BASELINE_REL);
  if (log.status !== 0) return null;
  return log.stdout.split('\n').filter(Boolean).map((sha) => ({ sha: sha.slice(0, 12),
    undriven: JSON.parse(git('show', `${sha}:${BASELINE_REL}`).stdout).undriven }));
}

// ------------------------------------------------------------------------------ the tree
const HTML = read('src/index.html');
const FILES = browserFiles();
const NOW = undriven(HTML, FILES);

test('the baseline is a sorted list of unique control keys', () => {
  const b = readBaseline();
  assert.equal(typeof b.note, 'string');
  assert.ok(Array.isArray(b.undriven));
  assert.deepEqual(b.undriven, [...new Set(b.undriven)].sort(), 'sorted and unique');
});

test('the baseline holds exactly the controls no browser test drives', () => {
  const problems = compare(readBaseline().undriven, NOW);
  assert.deepEqual(problems, [], 'control-drive ratchet:\n  ' + problems.map(([kind, k]) => (
    kind === 'new'
      ? `${k}: no tests/browser file drives it; drive it (pointer or keyboard) and assert its effect`
      : `${k}: driven now or gone; remove it from ${BASELINE_REL} (the list only shrinks)`))
    .join('\n  '));
});

test('the baseline only shrinks: no entry is missing from an earlier commit of it', (t) => {
  const history = baselineHistory();
  if (!history || !history.length) {
    if (history && process.env.GITHUB_ACTIONS === 'true') {
      assert.fail(`no commit holds ${BASELINE_REL}: the CI unit job checks out with `
        + 'fetch-depth: 0');
    }
    t.skip('no git history of the baseline here');
    return;
  }
  const g = grown(readBaseline().undriven, history);
  assert.deepEqual(g, [], 'control-drive ratchet: the baseline grew; it may only shrink:\n  '
    + g.map(([k, sha]) => `${k} was not listed at ${sha}`).join('\n  '));
});

test('every control the owner named is a control of the page and is driven by a browser test',
  () => {
    const keys = new Set(controlKeys(HTML));
    const all = Object.values(OWNER_NAMED).flat();
    assert.equal(all.length, 90);
    assert.deepEqual(all.filter((k) => !keys.has(k)), [], 'owner-named keys exist');
    const left = Object.entries(OWNER_NAMED)
      .flatMap(([family, ks]) => ks.filter((k) => !isDriven(k, FILES)).map((k) => `${family} ${k}`));
    assert.deepEqual(left, [], 'owner-named controls driven by no browser test');
    const listed = new Set(readBaseline().undriven);
    assert.deepEqual(all.filter((k) => listed.has(k)), [], 'owner-named controls in the baseline');
  });

// ------------------------------------------------------------------------------ mutations
const file = (...lines) => ({ rel: 'tests/browser/m.cjs', lines });

test('mutation: a control added to the page with no driving test is refused', () => {
  const html = `${HTML}\n<button type="button" id="osc-mutant-knob">Mutant</button>\n`
    + '<input type="range" data-osc="mutant.slider">\n';
  const now = undriven(html, FILES);
  assert.deepEqual(compare(readBaseline().undriven, now),
    [['new', '#osc-mutant-knob'], ['new', 'mutant.slider']]);
  // the same control with a test that clicks it is not debt
  const driven = [...FILES, file("await page.click('#osc-mutant-knob');",
    "await page.locator('[data-osc=\"mutant.slider\"]').focus();")];
  assert.deepEqual(compare(readBaseline().undriven, undriven(html, driven)), []);
});

test('mutation: removing the only drive of a control makes it debt, a stale entry is refused',
  () => {
    const html = '<button id="osc-m1"></button><select data-osc="m.two"></select>';
    const drives = [file("await page.click('#osc-m1');", 'const x = 1;', '',
      "await page.selectOption('[data-osc=\"m.two\"]', 'a');")];
    assert.deepEqual(undriven(html, drives), []);
    const removed = [file("const v = await page.evaluate(() => q('#osc-m1').value);", '', '',
      "await page.selectOption('[data-osc=\"m.two\"]', 'a');")];
    assert.deepEqual(undriven(html, removed), ['#osc-m1']);
    assert.deepEqual(compare([], undriven(html, removed)), [['new', '#osc-m1']]);
    assert.deepEqual(compare(['#osc-m1', 'm.two'], undriven(html, drives)),
      [['stale', '#osc-m1'], ['stale', 'm.two']]);
  });

test('mutation: an action one line away drives, two lines away does not', () => {
  const html = '<input id="osc-m3" type="text">';
  assert.deepEqual(undriven(html, [file("const sel = '#osc-m3';", 'await page.fill(sel, "1");')]),
    []);
  assert.deepEqual(undriven(html, [file("const sel = '#osc-m3';", '', 'await page.fill(s, "1");')]),
    ['#osc-m3']);
  assert.deepEqual(undriven(html, [file("expect(await read('#osc-m3')).toBe(1);")]), ['#osc-m3']);
  assert.deepEqual(undriven(html, [file("act: D.keys('#osc-m3', 'End'),")]), []);
  assert.deepEqual(undriven(html, [file("act: D.keys(`#osc-${'m3'}`, 'End'),")]), ['#osc-m3'],
    'a selector built at run time is not a literal drive');
});

test('mutation: the census reads ids before data-osc, roles and tabindex, not comments', () => {
  const html = '<button id="osc-a" data-osc="a.osc"></button><div role="slider" data-osc="s.x">'
    + '</div><span tabindex="0" id="osc-t"></span><div tabindex="-1" id="osc-no"></div>'
    + '<!-- <button id="osc-commented"></button> --><select :id="\'x\'" data-osc="dyn.sel">'
    + '</select><div id="osc-plain"></div>';
  assert.deepEqual(controlKeys(html), ['#osc-a', '#osc-t', 'dyn.sel', 's.x']);
});

test('mutation: a grown baseline, or an entry listed again after removal, is refused', () => {
  const history = [{ sha: 'b2', undriven: ['#a'] }, { sha: 'b1', undriven: ['#a', '#b'] }];
  assert.deepEqual(grown(['#a'], history), []);
  assert.deepEqual(grown([], history), [], 'paid off');
  assert.deepEqual(grown(['#a', '#c'], history), [['#c', 'b2'], ['#c', 'b1']], 'added');
  assert.deepEqual(grown(['#a', '#b'], history), [['#b', 'b2']], 'listed again after removal');
});
