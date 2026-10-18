// The source-size budget (intent engineering-integrity, criterion source-size-budget): every
// tracked file under src/js, and src/index.html, stays under a recorded byte cap, and a cap
// only falls.
//
// tests/unit/source-size-baseline.json records a cap for each file above 40 000 bytes; a file
// at or below 40 000 bytes has no entry and its effective cap is 40 000 bytes. A file's first
// cap is its headroom ceiling: its size plus 10 %, rounded up to the next 1 000 bytes. The tree
// fails when a file is above its cap, when a file above 40 000 bytes has no cap, when an entry
// names a missing file or a file of 40 000 bytes or less, or when a cap is above its file's
// headroom ceiling (so a shrink lowers the cap in the same change). The history check, on the
// model of tests/unit/browser-timing.test.mjs ('the recorded debt only shrinks'), compares each
// cap with its effective value in the most recent earlier commit that changed the baseline: a
// higher cap passes only with a raises entry, new in this change, that names the file, the new
// cap, the pull request and a reason of more than 30 characters; raises entries are added,
// never edited. The budget bounds how code is distributed between files, not its total, which
// the dist budget of scripts/build-config.mjs bounds.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const BASELINE_REL = 'tests/unit/source-size-baseline.json';
export const UNCAPPED = 40_000;
const REASON_MIN = 31;
const KEYS = ['caps', 'measured', 'note', 'raises'];

/** The size plus 10 %, rounded up to the next 1 000 bytes. */
export function headroomCeiling(size) {
  return Math.ceil((size * 11) / 10_000) * 1_000;
}

/** A file's cap: its entry, or 40 000 bytes when it has none. */
export function effectiveCap(caps, file) {
  return Object.hasOwn(caps, file) ? caps[file] : UNCAPPED;
}

/** Whether a raises entry is complete: file, cap, pull request number and a stated reason. */
export function validRaise(entry) {
  return Boolean(entry) && typeof entry === 'object'
    && typeof entry.file === 'string' && entry.file.length > 0
    && Number.isInteger(entry.cap) && entry.cap > UNCAPPED
    && Number.isInteger(entry.pr) && entry.pr > 0
    && typeof entry.reason === 'string' && entry.reason.trim().length >= REASON_MIN;
}

/**
 * What is wrong with `baseline` against `sizes` ({ file: bytes } of every tracked source):
 * a file above its cap, a file above 40 000 bytes with no cap, an entry for a missing file or
 * for one of 40 000 bytes or less, a cap above its headroom ceiling, a malformed raises entry.
 */
export function budgetProblems(sizes, baseline) {
  const problems = [];
  const caps = baseline.caps || {};
  for (const [file, size] of Object.entries(sizes)) {
    if (size > UNCAPPED && !Object.hasOwn(caps, file)) {
      problems.push(`${file}: ${size} bytes, above ${UNCAPPED}, has no cap: split it or add `
        + `a cap of at most ${headroomCeiling(size)} with a raises entry`);
    } else if (size > effectiveCap(caps, file)) {
      problems.push(`${file}: ${size} bytes is above its cap ${effectiveCap(caps, file)}: `
        + 'split it, or raise the cap with a raises entry');
    }
  }
  for (const [file, cap] of Object.entries(caps)) {
    if (!Number.isInteger(cap) || cap <= UNCAPPED) {
      problems.push(`${file}: the cap ${cap} is not a whole number of bytes above ${UNCAPPED}`);
    }
    if (!Object.hasOwn(sizes, file)) {
      problems.push(`${file}: has a cap but is not a tracked file under src/js or src/index.html`);
      continue;
    }
    const size = sizes[file];
    if (size <= UNCAPPED) {
      problems.push(`${file}: has a cap but is ${size} bytes, at or below ${UNCAPPED}: `
        + 'remove its entry');
    } else if (cap > headroomCeiling(size)) {
      problems.push(`${file}: the cap ${cap} is above its headroom ceiling `
        + `${headroomCeiling(size)} (${size} bytes plus 10 %, rounded up to the next 1 000): `
        + 'lower it');
    }
  }
  const raises = baseline.raises;
  if (!Array.isArray(raises)) problems.push('raises: the ledger is not a list');
  else {
    raises.forEach((entry, i) => {
      if (!validRaise(entry)) {
        problems.push(`raises[${i}]: needs file, cap above ${UNCAPPED}, pr (a pull request `
          + `number) and a reason of more than ${REASON_MIN - 1} characters`);
      }
    });
  }
  return problems;
}

const entryKey = (entry) => JSON.stringify(entry, ['file', 'cap', 'pr', 'reason']);

/**
 * What `current` raises over `previous` (the baseline of the most recent earlier commit that
 * changed it, labelled `sha`) without declaring it: a cap above its earlier effective value
 * with no complete raises entry new in `current` that names the file and that cap, and every
 * earlier raises entry that is no longer in the ledger as it was.
 */
export function raiseProblems(current, previous, sha = 'the earlier commit') {
  const problems = [];
  const before = new Set((previous.raises || []).map(entryKey));
  const now = new Set((current.raises || []).map(entryKey));
  for (const key of before) {
    if (!now.has(key)) {
      problems.push(`raises: the entry ${key} of ${sha} was edited or removed; entries are `
        + 'added, never edited');
    }
  }
  const declared = (current.raises || [])
    .filter((entry) => validRaise(entry) && !before.has(entryKey(entry)));
  for (const [file, cap] of Object.entries(current.caps || {})) {
    const was = effectiveCap(previous.caps || {}, file);
    if (cap <= was) continue;
    if (declared.some((entry) => entry.file === file && entry.cap === cap)) continue;
    problems.push(`${file}: the cap ${cap} is above its value ${was} at ${sha} with no raises `
      + 'entry naming the file, the cap, the pull request and the reason');
  }
  return problems;
}

function walk(rel) {
  const dir = path.join(ROOT, rel);
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    const child = `${rel}/${d.name}`;
    if (d.isDirectory()) return walk(child);
    return d.isFile() ? [child] : [];
  });
}

/** { file: bytes } of every tracked file under src/js, and src/index.html. */
export function sourceSizes() {
  const listed = spawnSync('git', ['ls-files', '-z', '--', 'src/js', 'src/index.html'],
    { cwd: ROOT, encoding: 'utf8' });
  const files = listed.status === 0 && listed.stdout
    ? listed.stdout.split('\0').filter(Boolean)
    : [...walk('src/js'), 'src/index.html'];
  return Object.fromEntries(files
    .filter((f) => existsSync(path.join(ROOT, f)))
    .map((f) => [f, statSync(path.join(ROOT, f)).size]));
}

export function readBaseline() {
  return JSON.parse(readFileSync(path.join(ROOT, BASELINE_REL), 'utf8'));
}

const canonical = (baseline) => JSON.stringify(baseline);

/** The baseline of every commit that changed it, newest first; null without history (a tree
 *  with no commit, as the fail-first job's extracts are). */
function baselineHistory() {
  const git = (...args) => spawnSync('git', args, { cwd: ROOT, encoding: 'utf8' });
  if (git('rev-parse', '--verify', '-q', 'HEAD').status !== 0) return null;
  const log = git('log', '--format=%H', '--', BASELINE_REL);
  if (log.status !== 0) return null;
  return log.stdout.split('\n').filter(Boolean).flatMap((sha) => {
    const shown = git('show', `${sha}:${BASELINE_REL}`);
    // A commit that deleted the file names no version of it.
    return shown.status === 0 ? [{ sha: sha.slice(0, 12), baseline: JSON.parse(shown.stdout) }]
      : [];
  });
}

const clone = (value) => JSON.parse(JSON.stringify(value));

// ------------------------------------------------------------------------------ the tree
test('every tracked source is within its cap and every cap within its headroom ceiling', () => {
  const sizes = sourceSizes();
  assert.ok(Object.hasOwn(sizes, 'src/index.html'), 'src/index.html is measured');
  assert.ok(Object.keys(sizes).filter((f) => f.startsWith('src/js/')).length > 50,
    'the files under src/js are measured');
  const problems = budgetProblems(sizes, readBaseline());
  assert.deepEqual(problems, [], `the source-size budget:\n  ${problems.join('\n  ')}`);
});

test('the baseline has its fields, and its header states the budget', () => {
  const baseline = readBaseline();
  assert.deepEqual(Object.keys(baseline).sort(), KEYS);
  const { note } = baseline;
  assert.equal(typeof note, 'string');
  assert.match(note, /a cap only falls/i);
  assert.match(note, /plus 10 %, rounded up to the next 1 000 bytes/);
  assert.match(note, /raises ledger of the pull request that needs it/);
  assert.match(note, /40 000 bytes/);
  assert.match(baseline.measured.commit, /^[0-9a-f]{40}$/);
  for (const [file, size] of Object.entries(baseline.measured.sizes)) {
    assert.ok(Number.isInteger(size) && size > UNCAPPED, `${file}: measured above ${UNCAPPED}`);
  }
});

test('a cap only falls: none is above its value in the most recent earlier commit', (t) => {
  const history = baselineHistory();
  if (!history || !history.length) {
    if (history && process.env.GITHUB_ACTIONS === 'true') {
      assert.fail(`no commit holds ${BASELINE_REL}: the CI unit job checks out with `
        + 'fetch-depth: 0');
    }
    t.skip('no git history of the baseline here');
    return;
  }
  const current = readBaseline();
  const earlier = history.find((v) => canonical(v.baseline) !== canonical(current));
  if (!earlier) {
    t.diagnostic(`the baseline is the record ${history.at(-1).sha} made: its own earlier value`);
    return;
  }
  const problems = raiseProblems(current, earlier.baseline, earlier.sha);
  assert.deepEqual(problems, [], `a cap rose; it may only fall:\n  ${problems.join('\n  ')}`);
});

// ------------------------------------------------------------------------------ mutations
const tree = () => ({ sizes: sourceSizes(), baseline: readBaseline() });
const capped = (baseline) => Object.keys(baseline.caps).sort()[0];
const small = (sizes) => Object.keys(sizes).sort().find((f) => sizes[f] <= UNCAPPED);
const RAISE_REASON = 'the feature adds a measurement kind that has no other home yet';

test('the headroom ceiling is the size plus 10 %, rounded up to the next 1 000 bytes', () => {
  assert.equal(headroomCeiling(115_572), 128_000);
  assert.equal(headroomCeiling(45_265), 50_000);
  assert.equal(headroomCeiling(50_000), 55_000);
  assert.equal(headroomCeiling(40_001), 45_000);
});

test('mutation: a file grown past its cap fails', () => {
  const { sizes, baseline } = tree();
  const file = capped(baseline);
  sizes[file] = baseline.caps[file] + 1;
  const problems = budgetProblems(sizes, baseline);
  assert.equal(problems.length, 1, problems.join('\n'));
  assert.match(problems[0], new RegExp(`^${file}: \\d+ bytes is above its cap`));
});

test('mutation: a new file above 40 000 bytes without a cap fails', () => {
  const { sizes, baseline } = tree();
  sizes['src/js/new-module.js'] = UNCAPPED + 1;
  const problems = budgetProblems(sizes, baseline);
  assert.deepEqual(problems.length, 1, problems.join('\n'));
  assert.match(problems[0], /^src\/js\/new-module\.js: 40001 bytes, above 40000, has no cap/);
  sizes['src/js/new-module.js'] = UNCAPPED;
  assert.deepEqual(budgetProblems(sizes, baseline), [], 'exactly 40 000 bytes needs no cap');
});

test('mutation: an entry for a missing file fails', () => {
  const { sizes, baseline } = tree();
  const file = capped(baseline);
  delete sizes[file];
  const problems = budgetProblems(sizes, baseline);
  assert.equal(problems.length, 1, problems.join('\n'));
  assert.match(problems[0], new RegExp(`^${file}: has a cap but is not a tracked file`));
});

test('mutation: an entry for a file of 40 000 bytes or less fails (a split file loses it)', () => {
  const { sizes, baseline } = tree();
  const file = small(sizes);
  baseline.caps[file] = 45_000;
  let problems = budgetProblems(sizes, baseline);
  assert.equal(problems.length, 1, problems.join('\n'));
  assert.match(problems[0], new RegExp(`^${file}: has a cap but is \\d+ bytes, at or below`));
  const split = capped(baseline);
  sizes[split] = UNCAPPED;
  delete baseline.caps[file];
  problems = budgetProblems(sizes, baseline);
  assert.equal(problems.length, 1, problems.join('\n'));
  assert.match(problems[0], new RegExp(`^${split}: has a cap but is 40000 bytes, at or below`));
});

test('mutation: a cap above the headroom ceiling after a shrink fails until it is lowered', () => {
  const { sizes, baseline } = tree();
  const file = capped(baseline);
  sizes[file] = Math.floor(baseline.caps[file] / 1.5);
  if (sizes[file] <= UNCAPPED) sizes[file] = UNCAPPED + 1;
  const problems = budgetProblems(sizes, baseline);
  assert.equal(problems.length, 1, problems.join('\n'));
  assert.match(problems[0], new RegExp(`^${file}: the cap \\d+ is above its headroom ceiling`));
  baseline.caps[file] = headroomCeiling(sizes[file]);
  assert.deepEqual(budgetProblems(sizes, baseline), [], 'the lowered cap passes');
});

test('mutation: a cap raised above its earlier value without a raises entry fails', () => {
  const { sizes, baseline: earlier } = tree();
  const current = clone(earlier);
  const file = capped(earlier);
  current.caps[file] = earlier.caps[file] + 1_000;
  sizes[file] = earlier.caps[file] + 500;
  assert.deepEqual(budgetProblems(sizes, current), [], 'the tree alone does not see the raise');
  const problems = raiseProblems(current, earlier, 'abc123');
  assert.equal(problems.length, 1, problems.join('\n'));
  assert.match(problems[0],
    new RegExp(`^${file}: the cap ${current.caps[file]} is above its value `
      + `${earlier.caps[file]} at abc123 with no raises entry`));
  assert.deepEqual(raiseProblems(earlier, current), [], 'a cap that falls needs nothing');
});

test('mutation: a file passing 40 000 bytes for the first time without a raises entry fails',
  () => {
    const { sizes, baseline: earlier } = tree();
    const current = clone(earlier);
    const file = small(sizes);
    sizes[file] = UNCAPPED + 1_000;
    current.caps[file] = headroomCeiling(sizes[file]);
    assert.deepEqual(budgetProblems(sizes, current), []);
    const problems = raiseProblems(current, earlier, 'abc123');
    assert.equal(problems.length, 1, problems.join('\n'));
    assert.match(problems[0], new RegExp(`^${file}: the cap \\d+ is above its value 40000 at`));
  });

test('a cap raised with a raises entry naming the file, the cap, the PR and a reason passes',
  () => {
    const { sizes, baseline: earlier } = tree();
    const current = clone(earlier);
    const file = capped(earlier);
    const cap = earlier.caps[file] + 1_000;
    current.caps[file] = cap;
    sizes[file] = earlier.caps[file] + 500;
    current.raises.push({ file, cap, pr: 4242, reason: RAISE_REASON });
    assert.deepEqual(budgetProblems(sizes, current), []);
    assert.deepEqual(raiseProblems(current, earlier, 'abc123'), []);

    const first = small(sizes);
    sizes[first] = UNCAPPED + 1_000;
    current.caps[first] = headroomCeiling(sizes[first]);
    current.raises.push({ file: first, cap: current.caps[first], pr: 4242, reason: RAISE_REASON });
    assert.deepEqual(budgetProblems(sizes, current), []);
    assert.deepEqual(raiseProblems(current, earlier, 'abc123'), [], 'a first cap, declared');
  });

test('mutation: a raises entry that does not declare the raise is refused', () => {
  const { baseline: earlier } = tree();
  const file = capped(earlier);
  const cap = earlier.caps[file] + 1_000;
  const raisedWith = (entry) => {
    const current = clone(earlier);
    current.caps[file] = cap;
    current.raises.push(entry);
    return raiseProblems(current, earlier, 'abc123');
  };
  const entry = { file, cap, pr: 4242, reason: RAISE_REASON };
  assert.deepEqual(raisedWith(entry), []);
  for (const [why, bad] of [
    ['a reason of 30 characters', { ...entry, reason: 'x'.repeat(30) }],
    ['another cap', { ...entry, cap: cap - 500 }],
    ['another file', { ...entry, file: 'src/js/main.js' }],
    ['no pull request', { file, cap, reason: RAISE_REASON }],
    ['a pull request that is not a number', { ...entry, pr: '#4242' }],
  ]) {
    assert.equal(raisedWith(bad).length, 1, why);
  }
  // An entry already in the earlier ledger declared an earlier raise, not this one.
  const declaredBefore = clone(earlier);
  declaredBefore.raises.push(entry);
  const again = clone(declaredBefore);
  again.caps[file] = cap;
  assert.equal(raiseProblems(again, declaredBefore, 'abc123').length, 1);
});

test('mutation: a raises entry edited or removed after it was recorded fails', () => {
  const { baseline } = tree();
  const file = capped(baseline);
  const earlier = clone(baseline);
  earlier.raises.push({ file, cap: earlier.caps[file], pr: 4242, reason: RAISE_REASON });
  const edited = clone(earlier);
  edited.raises.at(-1).reason = `${RAISE_REASON}, and another reason`;
  let problems = raiseProblems(edited, earlier, 'abc123');
  assert.equal(problems.length, 1, problems.join('\n'));
  assert.match(problems[0], /^raises: the entry .* of abc123 was edited or removed/);
  const removed = clone(earlier);
  removed.raises.pop();
  problems = raiseProblems(removed, earlier, 'abc123');
  assert.equal(problems.length, 1, problems.join('\n'));
  const appended = clone(earlier);
  appended.raises.unshift({ file, cap: earlier.caps[file], pr: 4343, reason: RAISE_REASON });
  assert.deepEqual(raiseProblems(appended, earlier, 'abc123'), [], 'an entry is only added');
});

test('mutation: a malformed raises entry in the ledger fails the tree', () => {
  const { sizes, baseline } = tree();
  baseline.raises.push({ file: capped(baseline), cap: 50_000, pr: 4242, reason: 'too short' });
  const problems = budgetProblems(sizes, baseline);
  assert.equal(problems.length, 1, problems.join('\n'));
  assert.match(problems[0], /^raises\[\d+\]: needs file, cap above 40000, pr/);
});
