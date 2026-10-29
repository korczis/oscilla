// project.pr-names-its-plan (R022): scripts/pr-metadata.mjs on fixture pull requests. One
// fixture per violation code fails with exactly that code and a clean one passes; the golden
// cases are the titles and branches of real pull requests; removing each `// rule:` block of
// the program makes its fixture pass, which the fixture detects; and
// .github/workflows/metadata.yml agrees with its model, .ai/repo/ci/pr-meta.yaml.
//   node --test tests/unit/pr-metadata.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseYaml } from '../../scripts/yaml-subset.mjs';
import {
  CODES, PLAN_WAIVER, RECORD_DIRS, ROLES, SCHEMA, TYPES, candidates, inspect, judge, planWaiver,
  recordsOf, roleOf, summary, workflowModelProblems,
} from '../../scripts/pr-metadata.mjs';
import { waiver } from '../../scripts/fail-first.mjs';
import { gitRepo } from './fixtures/git-repo.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const PROGRAM = path.join(ROOT, 'scripts', 'pr-metadata.mjs');
const read = (rel) => readFileSync(path.join(ROOT, rel), 'utf8');
const ENV = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' };
for (const k of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'NODE_TEST_CONTEXT']) delete ENV[k];

const ISSUES = '.ai/repo/project/issues';
const MILESTONES = '.ai/repo/project/milestones';
const issue = (id, milestone, extra = '') => `id: ${id}\nmilestone: ${milestone}\nserves:\n`
  + `  - "studio-completion#${id.toLowerCase()}"\ntitle: "Record ${id}"\npriority: p2\n${extra}`;
const BASE_RECORDS = {
  [`${ISSUES}/V603.yaml`]: issue('V603', 'M048'),
  [`${ISSUES}/U001.yaml`]: issue('U001', 'M054'),
  [`${ISSUES}/S080.yaml`]: issue('S080', 'M005'),
  [`${MILESTONES}/M048.yaml`]: 'id: M048\ntitle: "Studio completion"\npriority: p1\n',
};

/** main: the records; branch `pr`: one more commit with `files`. */
function fixture(t, files = {}) {
  const repo = gitRepo('oscilla-pr-metadata-');
  t.after(() => repo.dispose());
  repo.commit('base', { ...BASE_RECORDS, 'README.md': 'fixture\n' });
  repo.branch('pr');
  repo.commit('change', { 'README.md': 'fixture, changed\n', ...files });
  return repo;
}

/** The program on a fixture: { status, out, codes }. */
function run(t, repo, pr, ...mode) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'oscilla-pr-json-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'pr.json');
  writeFileSync(file, JSON.stringify({ number: 42, body: '', ...pr }));
  const r = spawnSync(process.execPath, [PROGRAM, '--repo', repo.dir, '--pr-json', file,
    '--base', 'main', '--head', 'HEAD', ...(mode.length ? mode : ['--check'])],
  { encoding: 'utf8', env: ENV });
  const out = `${r.stdout}${r.stderr}`;
  return { status: r.status, out, stdout: r.stdout,
    codes: [...out.matchAll(/^ {2}([a-z-]+): /gm)].map((m) => m[1]) };
}

// One input per code that fails with exactly that code, and the clean one.
const CLEAN = { title: 'feat(studio): V603 pinch zoom on the timeline',
  headRefName: 'feat/v603-timeline-pinch', body: 'Pinch zoom.\n\nRefs #12\n' };
const FAILS = {
  'title-grammar': { ...CLEAN, title: 'Pinch zoom on the timeline (V603)' },
  'plan-id-missing': { title: 'chore(docs): tidy the README', headRefName: 'chore/tidy',
    body: 'Tidy.\n' },
  'plan-id-unknown': { ...CLEAN, title: 'feat(studio): V699 pinch zoom on the timeline' },
  'waiver-form': { title: 'chore(docs): tidy the README', headRefName: 'chore/tidy',
    body: 'Tidy.\n\nplan: n/a <reason>\n' },
  'closing-keyword': { ...CLEAN, body: 'Pinch zoom.\n\nCloses #12\n' },
};

test('every code has its fixture, and the program declares exactly these codes', () => {
  assert.deepEqual(Object.keys(FAILS).sort(), [...CODES].sort());
});

test('the clean pull request passes; each fixture fails with exactly its code', (t) => {
  const repo = fixture(t);
  const clean = run(t, repo, CLEAN);
  assert.equal(clean.status, 0, clean.out);
  assert.match(clean.out, /plan records: V603 \(\.ai\/repo\/project\/issues\/V603\.yaml\)/);
  assert.match(clean.out, /pr-metadata: no violation/);
  for (const [code, pr] of Object.entries(FAILS)) {
    const r = run(t, repo, pr);
    assert.equal(r.status, 1, `${code}: ${r.out}`);
    assert.deepEqual(r.codes, [code], `${code}: ${r.out}`);
  }
});

test('title-grammar: an undeclared type, a capitalised type, a missing description', (t) => {
  const repo = fixture(t);
  for (const title of ['feature(studio): V603 pinch zoom', 'Feat(studio): V603 pinch zoom',
    'feat(studio):V603', 'Merge train 2026-10-18: #187-#191 V603']) {
    assert.deepEqual(run(t, repo, { ...CLEAN, title }).codes, ['title-grammar'], title);
  }
  for (const title of ['fix(release)!: V603 a breaking fix', 'revert: V603 the pinch zoom',
    'train(2026-10-28): #243, #244; V603 done']) {
    assert.deepEqual(run(t, repo, { ...CLEAN, title }).codes, [], title);
  }
  // the types are release-analyze's, which gives each a level of its own, and train
  assert.deepEqual([...TYPES].sort(), ['build', 'chore', 'ci', 'docs', 'feat', 'fix', 'perf',
    'refactor', 'revert', 'style', 'test', 'train']);
});

test('the waiver: a reason passes; quoted, placeholder or empty, it is not one', (t) => {
  const repo = fixture(t);
  const missing = FAILS['plan-id-missing'];
  const waived = run(t, repo, { ...missing, body: 'Tidy.\n\nplan: n/a docs-only tidy\n' });
  assert.equal(waived.status, 0, waived.out);
  assert.match(waived.out, /waived: plan: n\/a docs-only tidy/);
  assert.deepEqual(run(t, repo, { ...missing, body: '- plan: n/a a list item\n' }).codes, []);
  for (const body of ['```\nplan: n/a quoted\n```\n', '> plan: n/a quoted\n',
    '<!-- plan: n/a quoted -->\n', 'This says plan: n/a mid-sentence.\n']) {
    assert.deepEqual(run(t, repo, { ...missing, body }).codes, ['plan-id-missing'], body);
  }
  for (const body of ['plan: n/a\n', 'plan: n/a ...\n', 'plan: n/a <why>\n']) {
    assert.deepEqual(run(t, repo, { ...missing, body }).codes, ['waiver-form'], body);
  }
  assert.ok(PLAN_WAIVER.test('plan: n/a x') && !PLAN_WAIVER.global);
  // the plan waiver is read exactly as fail-first reads its own
  for (const body of ['plan: n/a docs only\n', '* plan: n/a  spaced reason \n', 'plan: n/a\n',
    'plan: n/a <reason>\n', 'plan: n/a ...\n', '```\nplan: n/a quoted\n```\n',
    '> plan: n/a quoted\n', '<!-- plan: n/a quoted -->\n', 'a plan: n/a mid-sentence\n',
    'PLAN: N/A upper case\n', '']) {
    assert.deepEqual(planWaiver(body), waiver(body.replace(/plan:/gi, 'fail-first:')), body);
  }
});

test('closing keywords in every spelling GitHub honours; Refs and prose do not', (t) => {
  const repo = fixture(t);
  for (const body of ['Closes #12', 'closed #12', 'Fixes korczis/oscilla#3', 'fix #4',
    'Resolves: #5', 'resolved #6', 'This fixes #7 for good']) {
    assert.deepEqual(run(t, repo, { ...CLEAN, body }).codes, ['closing-keyword'], body);
  }
  for (const body of ['Refs #12', 'the fix of #12', 'closes nothing', 'resolve the #12 case',
    'Fixed in V603']) {
    assert.deepEqual(run(t, repo, { ...CLEAN, body }).codes, [], body);
  }
});

test('an ID: a record letter and a record file, at the base or the head', (t) => {
  // F001 exists only on the pull request's head: it counts, and so does its letter.
  const repo = fixture(t, { [`${ISSUES}/F001.yaml`]: issue('F001', 'M055') });
  const r = run(t, repo, { title: 'feat(build): F001 Tailwind compiled into the single file',
    headRefName: 'feat/f001-tailwind-build', body: '' });
  assert.equal(r.status, 0, r.out);
  assert.match(r.out, /plan records: F001/);
  // A letter no record file begins with is no candidate: H264, the v of a version, a word.
  const records = recordsOf(Object.keys(BASE_RECORDS));
  assert.deepEqual([...records.prefixes].sort(), ['M', 'S', 'U', 'V']);
  const none = judge({ title: 'fix(dsp): H264 and A440 at v40.1.0', branch: 'release/v40.1.0' },
    records);
  assert.deepEqual(none.violations.map((v) => v.code), ['plan-id-missing']);
  assert.match(none.violations[0].message, /H264, A440: no record file begins with that letter/);
  // A milestone is an ID too; a branch segment in any case; a title ID is case-sensitive.
  assert.deepEqual(judge({ title: 'chore(plan): M048 verified', branch: 'x' }, records).ids,
    ['M048']);
  assert.deepEqual(candidates({ title: 'chore: v603 u001', branch: 'feat/V603_x.u001-y' }),
    [{ id: 'V603', from: 'branch' }, { id: 'U001', from: 'branch' }]);
  // Only the record directories count, and only file names of an ID's shape are IDs.
  const odd = recordsOf([`${ISSUES}/README.yaml`, 'docs/V999.yaml', `${MILESTONES}/M12.yaml`]);
  assert.deepEqual([...odd.ids.keys()], []);
  assert.deepEqual([...odd.prefixes].sort(), ['M']);
  assert.deepEqual(RECORD_DIRS, [ISSUES, MILESTONES]);
});

test('the exemptions: a release, a release record and a train name no record', () => {
  const records = recordsOf(Object.keys(BASE_RECORDS));
  const ok = (pr) => judge(pr, records).violations.map((v) => v.code);
  assert.deepEqual(ok({ title: 'chore(release): v40.1.0', branch: 'release/v40.1.0' }), []);
  assert.deepEqual(ok({ title: 'chore(release): record v40.1.0',
    branch: 'chore/release-record-v40.1.0' }), []);
  assert.deepEqual(ok({ title: 'train(2026-10-28): #243, #244 in one CI run', branch: 'x' }), []);
  // the release's title and branch name the same version; a train names its members
  assert.deepEqual(ok({ title: 'chore(release): v40.1.1', branch: 'release/v40.1.0' }),
    ['plan-id-missing']);
  assert.deepEqual(ok({ title: 'chore(release): v40.1.0', branch: 'chore/v40.1.0' }),
    ['plan-id-missing']);
  assert.deepEqual(ok({ title: 'train(2026-10-28): the members', branch: 'train/x' }),
    ['plan-id-missing']);
  assert.equal(roleOf({ title: 'chore(release): v40.0.0-rc.1', branch: 'release/v40.0.0-rc.1' }),
    'release');
  assert.deepEqual(ROLES, ['release', 'release-record', 'train']);
});

// The titles and branches of real pull requests (read with `gh pr view` on 2026-10-29; #228 for
// the release #237, whose version is the current one and so may not be written here); none
// of their bodies carries a closing keyword or a `plan: n/a` line.
const GOLDEN = [
  [254, 'chore(plan): V603 and U001 done at their main commits', 'chore/plan-done-v603-u001',
    { ids: ['V603', 'U001'] }],
  [253, 'feat(build): F001 Tailwind and flowbite compiled into the single file',
    'feat/f001-tailwind-build', { ids: ['F001'] }],
  [248, 'train(2026-10-28): #243, #244, #240, #241 in one CI run; S080 done', 'train/2026-10-28',
    { role: 'train', ids: ['S080'] }],
  [247, 'feat(studio): V603 pinch zoom on the timeline', 'feat/v603-timeline-pinch',
    { ids: ['V603'], branch: 'V603' }],
  [246, 'test(plan): the two heads of #238 are squash-merged evidence commits',
    'fix/plan-evidence-238-off-history', { codes: ['plan-id-missing'] }],
  [228, 'chore(release): v3.12.1', 'release/v3.12.1', { role: 'release' }],
  [252, 'chore(process): trains judged by members, one merge-train procedure, disk preflight,'
    + ' evidence on main, bounded budget re-measure, symbol-anchored decisions'
    + ' (evolve 2026-10-28)', 'chore/evolve-process-20261028', { codes: ['plan-id-missing'] }],
];

test('golden: real pull requests are judged as the spec says', (t) => {
  // #253's record F001 is on its head (#251 adds it), not on the base.
  const repo = fixture(t, { [`${ISSUES}/F001.yaml`]: issue('F001', 'M055') });
  for (const [n, title, headRefName, want] of GOLDEN) {
    const facts = inspect({ repo: repo.dir, base: 'main', head: 'HEAD',
      pr: { number: n, title, headRefName, body: '' } });
    const label = `#${n} ${title}`;
    assert.deepEqual(facts.violations.map((v) => v.code), want.codes || [], label);
    assert.deepEqual(facts.ids.map((f) => f.id), want.ids || [], label);
    assert.equal(facts.role, want.role || null, label);
    if (want.branch) {
      assert.ok(candidates({ branch: headRefName }).some((c) => c.id === want.branch), label);
    }
  }
});

test('--facts: the pr-facts/v1 seam, and --summary its table', (t) => {
  const repo = fixture(t, {
    // a guarded path without a verdict, and plan evidence
    '.github/workflows/x.yml': 'name: x\n',
    [`${ISSUES}/V603.yaml`]: issue('V603', 'M048', 'evidence:\n  - covers: verified\n'
      + '    result: "done"\n'),
  });
  const r = run(t, repo, { ...CLEAN, title: 'feat(studio)!: V603 pinch zoom' }, '--facts');
  assert.equal(r.status, 0, r.out);
  const facts = JSON.parse(r.stdout);
  assert.equal(facts.schema, SCHEMA);
  assert.deepEqual(facts.ids, [{ id: 'V603', path: `${ISSUES}/V603.yaml`, title: 'Record V603',
    milestone: 'M048', serves: ['studio-completion#v603'], priority: 'p2' }]);
  assert.equal(facts.milestone, 'M048');
  assert.equal(facts.level, 'major');
  assert.equal(facts.breaking, true);
  assert.deepEqual(facts.guarded, ['.github/workflows/x.yml']);
  assert.equal(facts.verdict, 'needed');
  assert.equal(facts.failFirst, 'applies');
  assert.equal(facts.evidence, true);
  assert.equal(facts.land, 'merge');
  assert.equal(facts.role, null);
  assert.match(facts.content, /^[0-9a-f]{64}$/);

  // the verdict for that content is recorded; fail-first waived; no evidence changed
  repo.commit('verdict', {
    '.ai/repo/reviews/42.yaml': `verdict: merge\ncontent: ${facts.content}\n`,
  });
  const after = JSON.parse(run(t, repo, { ...CLEAN, body: 'fail-first: n/a docs\n' }, '--facts')
    .stdout);
  assert.equal(after.verdict, 'recorded');
  assert.equal(after.failFirst, 'waived docs');
  assert.equal(after.level, 'minor');

  const md = summary(facts, 'korczis/oscilla');
  assert.ok(md.includes('| Plan records | [V603](https://github.com/korczis/oscilla/blob/main/'
    + '.ai/repo/project/issues/V603.yaml) Record V603 |'), md);
  assert.match(md, /\| Milestone \| M048 \|/);
  assert.match(md, /\| Level \| major \(breaking\) \|/);
  assert.match(md, /No violation\./);
  assert.doesNotMatch(summary(facts, ''), /https:/);

  // --check with --summary writes the table and fails on a violation
  const dir = mkdtempSync(path.join(os.tmpdir(), 'oscilla-summary-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'summary.md');
  writeFileSync(file, '# before\n');
  const failed = run(t, repo, FAILS['closing-keyword'], '--check', '--summary', file);
  assert.equal(failed.status, 1, failed.out);
  const written = readFileSync(file, 'utf8');
  assert.match(written, /^# before\n### Pull request metadata/);
  assert.match(written, /- `closing-keyword`: /);
});

test('usage: no mode, no pull request, an unknown flag, no title exit 2', (t) => {
  const repo = fixture(t);
  const dir = mkdtempSync(path.join(os.tmpdir(), 'oscilla-pr-usage-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const pr = path.join(dir, 'pr.json');
  writeFileSync(pr, JSON.stringify({ body: 'no title' }));
  const status = (...args) => spawnSync(process.execPath, [PROGRAM, '--repo', repo.dir, ...args],
    { encoding: 'utf8', env: ENV }).status;
  assert.equal(status(), 2);
  assert.equal(status('--check'), 2);
  assert.equal(status('--pr-json', pr), 2);
  assert.equal(status('--pr-json', pr, '--check'), 2);
  assert.equal(status('--pr-json', pr, '--bogus'), 2);
  assert.equal(status('--pr-json', path.join(dir, 'missing.json'), '--check'), 2);
  writeFileSync(pr, JSON.stringify({ title: 'chore: x' }));
  assert.equal(status('--pr-json', pr, '--check', '--base', 'no-such-ref'), 1);
});

// ---------------------------------------------------------------- the mutation table

const SOURCE = read('scripts/pr-metadata.mjs');
const IMPORTS = ['fail-first.mjs', 'release-analyze.mjs', 'release-metadata.mjs',
  'review-verdict.mjs', 'yaml-subset.mjs'];
const block = (code) => new RegExp(`^[ \\t]*// rule: ${code}\\n[\\s\\S]*?`
  + `^[ \\t]*// end rule: ${code}\\n`, 'm');

/** The program with the block of `code` removed, imported from a scratch copy of scripts/. */
async function mutant(t, code) {
  const dir = mkdtempSync(path.join(os.tmpdir(), `oscilla-pr-mutant-${code}-`));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  for (const f of IMPORTS) copyFileSync(path.join(ROOT, 'scripts', f), path.join(dir, f));
  const text = SOURCE.replace(block(code), '');
  assert.notEqual(text, SOURCE, `the program has a // rule: ${code} block`);
  writeFileSync(path.join(dir, 'pr-metadata.mjs'), text);
  return import(pathToFileURL(path.join(dir, 'pr-metadata.mjs')).href);
}

test('mutation: every rule is one marked block, and each code names one', () => {
  const marked = [...SOURCE.matchAll(/^[ \t]*\/\/ rule: ([a-z-]+)$/gm)].map((m) => m[1]);
  const ended = [...SOURCE.matchAll(/^[ \t]*\/\/ end rule: ([a-z-]+)$/gm)].map((m) => m[1]);
  assert.deepEqual(marked, CODES);
  assert.deepEqual(ended, CODES);
  for (const code of CODES) {
    const flags = [...SOURCE.matchAll(new RegExp(`flag\\('${code}'`, 'g'))].length;
    assert.equal(flags, 1, `${code} is flagged once`);
    assert.match(SOURCE.match(block(code))[0], new RegExp(`flag\\('${code}'`),
      `${code} is flagged inside its block`);
  }
});

test('mutation: removing a rule\'s block lets its fixture through, which the fixture detects',
  async (t) => {
    const records = recordsOf([...Object.keys(BASE_RECORDS)]);
    const input = (pr) => ({ title: pr.title, branch: pr.headRefName, body: pr.body });
    const codes = (j) => j.violations.map((v) => v.code);
    for (const [code, pr] of Object.entries(FAILS)) {
      assert.deepEqual(codes(judge(input(pr), records)), [code], `${code}: the original`);
      const m = await mutant(t, code);
      assert.deepEqual(codes(m.judge(input(pr), records)), [], `${code}: the mutant passes it`);
      assert.deepEqual(codes(m.judge(input(CLEAN), records)), [], `${code}: and the clean one`);
    }
  });

// ---------------------------------------------------------------- the workflow and its model

const WORKFLOW = read('.github/workflows/metadata.yml');
const MODEL_TEXT = read('.ai/repo/ci/pr-meta.yaml');
const MODEL = parseYaml(MODEL_TEXT);

/** Replace exactly one occurrence, so a mutation that no longer applies fails loudly. */
function mutate(text, from, to) {
  const parts = text.split(from);
  assert.equal(parts.length, 2, `the mutation target is in the file once: ${from}`);
  return parts.join(to);
}

test('metadata.yml is the model\'s judge, and the model is the program\'s', () => {
  assert.deepEqual(workflowModelProblems(WORKFLOW, MODEL_TEXT), []);
  assert.equal(MODEL.version, 1);
  assert.equal(MODEL.judge.workflow, '.github/workflows/metadata.yml');
  assert.deepEqual(MODEL.judge.permissions, { contents: 'read', 'pull-requests': 'read' });
  assert.equal(MODEL.judge.bound, 5);
  assert.equal(MODEL.judge.required, false);
  assert.ok(MODEL.judge.triggers.pull_request.types.includes('edited'));
  assert.deepEqual(MODEL.ids.directories, RECORD_DIRS);
  assert.deepEqual(MODEL.exempt.map((e) => e.role), ROLES);
  assert.equal(MODEL.waiver, 'plan: n/a <reason>');
  assert.deepEqual(MODEL.codes, CODES);
  assert.match(MODEL.facts, /^node scripts\/pr-metadata\.mjs --facts --pr-json \{file\}/);
  assert.equal(MODEL.actor, undefined, 'no writer yet (Majordomus forge, draft B1)');
  // owner decision C1 (2026-10-29), applied on GitHub: merge commits only
  assert.deepEqual(MODEL.repository, { allow_merge_commit: true, allow_squash_merge: false,
    allow_rebase_merge: false, merge_commit_title: 'PR_TITLE', merge_commit_message: 'PR_BODY' });
  // every step bounded below the job's bound; nothing installed
  const job = parseYaml(WORKFLOW).jobs.metadata;
  for (const s of job.steps) assert.ok(Number(s['timeout-minutes']) > 0, JSON.stringify(s));
  assert.ok(job.steps.reduce((n, s) => n + Number(s['timeout-minutes']), 0) <= MODEL.judge.bound);
  assert.doesNotMatch(WORKFLOW, /npm (ci|install)/);
});

test('mutation: a workflow that writes, misses an event or can no longer refuse', () => {
  const tail = '            --check --summary "$GITHUB_STEP_SUMMARY"\n';
  for (const [name, text, want] of [
    ['pull-requests: write', mutate(WORKFLOW, '  pull-requests: read\n',
      '  pull-requests: write\n'), /permissions are/],
    ['issues: write added', mutate(WORKFLOW, '  pull-requests: read\n',
      '  pull-requests: read\n  issues: write\n'), /permissions are/],
    ['without edited', mutate(WORKFLOW, '[opened, edited, synchronize,',
      '[opened, synchronize,'), /pull_request types are/],
    ['pull_request_target', mutate(WORKFLOW, '\non:\n  pull_request:\n',
      '\non:\n  pull_request_target:\n'), /triggers are/],
    ['workflow_dispatch', mutate(WORKFLOW, '\npermissions:\n',
      '  workflow_dispatch:\n\npermissions:\n'), /triggers are/],
    ['another bound', mutate(WORKFLOW, '    timeout-minutes: 5\n',
      '    timeout-minutes: 30\n'), /timeout-minutes is 30/],
    ['renamed job', mutate(WORKFLOW, '    name: metadata\n', '    name: meta\n'),
      /the job's name/],
    ['job permissions', mutate(WORKFLOW, '    runs-on: ubuntu-latest\n',
      '    runs-on: ubuntu-latest\n    permissions:\n      pull-requests: write\n'),
    /widens or narrows/],
    ['|| true', mutate(WORKFLOW, tail, `${tail.trimEnd()} || true\n`), /the call|forced/],
    ['own copy', mutate(WORKFLOW, '          .github/scripts/base-rule.sh "origin/$GITHUB_BASE_REF"'
      + ' scripts/pr-metadata.mjs', '          node scripts/pr-metadata.mjs'), /not the call/],
    ['no --check', mutate(WORKFLOW, tail, '            --summary "$GITHUB_STEP_SUMMARY"\n'),
      /not the call/],
    ['a command after it', mutate(WORKFLOW, tail, `${tail}          echo done\n`),
      /not the call/],
    ['no PR guard', mutate(WORKFLOW, '          if [ -z "$PR" ]; then echo '
      + '"::error::pr-metadata: no pull request to judge"; exit 1; fi\n', ''), /no pull request/],
    ['conditional step', mutate(WORKFLOW, '        timeout-minutes: 2\n        env:\n',
      '        timeout-minutes: 2\n        if: false\n        env:\n'), /conditional/],
    ['continue-on-error', mutate(WORKFLOW, '    timeout-minutes: 5\n',
      '    timeout-minutes: 5\n    continue-on-error: true\n'), /non-fatal/],
  ]) {
    const problems = workflowModelProblems(text, MODEL_TEXT);
    assert.notDeepEqual(problems, [], name);
    assert.match(problems.join('\n'), want, name);
  }
});
