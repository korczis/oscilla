// project.pr-names-its-plan (R022): scripts/pr-metadata.mjs on fixture pull requests. One
// fixture per violation code fails with exactly that code and a clean one passes; the golden
// cases are the titles and branches of real pull requests, at heads that carry what theirs
// carried; the skills' own titles are judged as the skills write them; removing each
// `// rule:` block of the program makes its fixture pass, which the fixture detects; and
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
  CLOSING, CODES, PLAN_WAIVER, RECORD_DIRS, ROLES, SCHEMA, TYPES, VERDICT_STATES, candidates,
  FORCED_SUCCESS, inspect, judge, planWaiver, recordsOf, roleOf, summary, workflowModelProblems,
} from '../../scripts/pr-metadata.mjs';
import { waiver } from '../../scripts/fail-first.mjs';
import { SCHEMA as VERDICT_SCHEMA } from '../../scripts/review-verdict.mjs';
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

/** main: the records; branch `pr`: one more commit with `files`, its message `message`. */
function fixture(t, files = {}, message = 'change') {
  const repo = gitRepo('oscilla-pr-metadata-');
  t.after(() => repo.dispose());
  repo.commit('base', { ...BASE_RECORDS, 'README.md': 'fixture\n' });
  repo.branch('pr');
  repo.commit(message, { 'README.md': 'fixture, changed\n', ...files });
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
  'plan-id-unknown': { ...CLEAN, title: 'feat(studio): V699 pinch zoom on the timeline',
    headRefName: 'feat/timeline-pinch' },
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
  // (fEAT and feaT start with lower case: only the comparison with the parsed type sees them)
  for (const title of ['feature(studio): V603 pinch zoom', 'Feat(studio): V603 pinch zoom',
    'fEAT(studio): V603 pinch zoom', 'feaT(studio): V603 pinch zoom', 'FIX: V603 pinch zoom',
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
    '<!-- plan: n/a quoted -->\n', 'This says plan: n/a mid-sentence.\n',
    // what GitHub renders as code or a quote (review of #255, R5): an indented code block,
    // a tab-indented one, a blockquote's lazy continuation line, an inline code span
    'Output:\n\n    plan: n/a indented code\n', '\tplan: n/a tab-indented code\n',
    '> A quote\nplan: n/a its lazy continuation\n', '`plan: n/a in a code span`\n']) {
    assert.deepEqual(run(t, repo, { ...missing, body }).codes, ['plan-id-missing'], body);
  }
  // what GitHub renders as prose: after an inline `<!--`, after a one-line ```code```, a
  // list item after a quote, a list item's indented paragraph
  for (const body of ['Write `<!--` to hide.\nplan: n/a docs only\n',
    '```js x``` is inline.\nplan: n/a docs only\n', '> A quote\n- plan: n/a docs only\n',
    '- Tidy.\n\n    plan: n/a docs only\n']) {
    assert.deepEqual(run(t, repo, { ...missing, body }).codes, [], body);
  }
  for (const body of ['plan: n/a\n', 'plan: n/a ...\n', 'plan: n/a <why>\n']) {
    assert.deepEqual(run(t, repo, { ...missing, body }).codes, ['waiver-form'], body);
  }
  assert.ok(PLAN_WAIVER.test('plan: n/a x') && !PLAN_WAIVER.global);
  // the plan waiver is read exactly as fail-first reads its own
  for (const body of ['plan: n/a docs only\n', '* plan: n/a  spaced reason \n', 'plan: n/a\n',
    'plan: n/a <reason>\n', 'plan: n/a ...\n', '```\nplan: n/a quoted\n```\n',
    '> plan: n/a quoted\n', '<!-- plan: n/a quoted -->\n', 'a plan: n/a mid-sentence\n',
    'PLAN: N/A upper case\n', '    plan: n/a code\n', '> q\nplan: n/a lazy\n',
    '`<!--`\nplan: n/a prose\n', '',
    // review of #255, round 2: R5, R15, R16 hold for the plan waiver as for fail-first's
    'See `x\nplan: n/a in a span` here.\n', '- a\n\n    ```\n    plan: n/a fenced\n    ```\n',
    'plan: n/a `<reason>`\n', 'plan: n/a the `x` flag only\n',
    // round 3: R5 (escapes, code blocks), R15 (a 4-space fence by CommonMark), R21
    'a \\` b ` c\nplan: n/a in a span\n` d\n', '    ```\ntext\n```\nplan: n/a fenced\n```\n',
    'Text\n\n    ```\nplan: n/a prose\n', '## The ` key\nplan: n/a prose\nsee `x`\n',
    '<!-- a ` tick -->\nplan: n/a prose\nmore `x`\n',
    '```\na ` b\n```\nSee `x\nplan: n/a span\n` e\n']) {
    assert.deepEqual(planWaiver(body), waiver(body.replace(/plan:/gi, 'fail-first:')), body);
  }
});

test('closing keywords in every spelling GitHub honours; Refs and prose do not', (t) => {
  const repo = fixture(t);
  for (const body of ['Closes #12', 'closed #12', 'Fixes korczis/oscilla#3', 'fix #4',
    'Resolves: #5', 'resolved #6', 'This fixes #7 for good',
    'Closes https://github.com/korczis/oscilla/issues/12',
    // the body is the merge commit's message (C1), where a code fence is plain text
    '```\nCloses #12\n```\n']) {
    assert.deepEqual(run(t, repo, { ...CLEAN, body }).codes, ['closing-keyword'], body);
  }
  for (const body of ['Refs #12', 'the fix of #12', 'closes nothing', 'resolve the #12 case',
    'Fixed in V603', 'hotfix #12', 'prefix #12', 'unresolved #12', 'enclosed #12',
    'Refs https://github.com/korczis/oscilla/issues/12',
    'Closes https://github.com/korczis/oscilla/pull/12']) {
    assert.deepEqual(run(t, repo, { ...CLEAN, body }).codes, [], body);
  }
  // the title is the merge commit's subject (C1): a keyword there reaches main too
  for (const title of ['fix(audio): V603 closes #12',
    'fix(audio): V603, fixes korczis/oscilla#12']) {
    const r = run(t, repo, { ...CLEAN, title });
    assert.deepEqual(r.codes, ['closing-keyword'], title);
    assert.match(r.out, /the title carries the closing keyword/, title);
  }
  assert.ok(!CLOSING.global && CLOSING.ignoreCase);
});

test('closing keywords in a commit message between the merge base and the head', (t) => {
  const repo = fixture(t, {}, 'fix(studio): V603 pinch zoom\n\nFixes #9 on the timeline.\n');
  const r = run(t, repo, CLEAN);
  assert.equal(r.status, 1, r.out);
  assert.deepEqual(r.codes, ['closing-keyword']);
  assert.match(r.out, /the message of commit [0-9a-f]{12} carries the closing keyword "Fixes #9"/);
  // several commits (R9): the keyword in the middle one, and in every one, is found
  const many = fixture(t, {}, 'feat(studio): V603 first step\n');
  many.commit('fix(studio): V603 second step\n\nResolves #10.\n', { 'b.txt': 'b\n' });
  many.commit('test(studio): V603 third step\n', { 'c.txt': 'c\n' });
  const middle = run(t, many, CLEAN);
  assert.deepEqual(middle.codes, ['closing-keyword'], middle.out);
  assert.equal([...middle.out.matchAll(/the message of commit/g)].length, 1, middle.out);
  assert.match(middle.out, /carries the closing keyword "Resolves #10"/);
  many.commit('docs(studio): V603 fourth\n\ncloses #11\n', { 'd.txt': 'd\n' });
  assert.equal([...run(t, many, CLEAN).out.matchAll(/the message of commit/g)].length, 2);
  // a record separator or a NUL-free control byte in a message hides nothing after it (R4)
  for (const byte of ['\x1e', '\x1f', '\x1c']) {
    const rs = fixture(t, {}, `fix(studio): V603 pinch zoom\n\nsee${byte} the log\n\nFixes #9\n`);
    rs.commit('chore(studio): V603 after\n', { 'e.txt': 'e\n' });
    const x = run(t, rs, CLEAN);
    assert.deepEqual(x.codes, ['closing-keyword'], JSON.stringify(byte));
    assert.match(x.out, /carries the closing keyword "Fixes #9"/);
  }
  // the base's own history is not the pull request's: only merge base..head is read
  const clean = fixture(t);
  clean.git('checkout', '-q', 'main');
  clean.commit('fix(x): closes #3 on main already', { 'main.txt': 'main\n' });
  clean.git('checkout', '-q', 'pr');
  assert.deepEqual(run(t, clean, CLEAN).codes, []);
});

test('an ID: a record letter and a record file, at the base or the head', (t) => {
  // F001 exists only on the pull request's head: it counts, and so does its letter.
  const repo = fixture(t, { [`${ISSUES}/F001.yaml`]: issue('F001', 'M055') });
  const r = run(t, repo, { title: 'feat(build): F001 Tailwind compiled into the single file',
    headRefName: 'feat/f001-tailwind-build', body: '' });
  assert.equal(r.status, 0, r.out);
  assert.match(r.out, /plan records: F001/);
  // S080 exists only at the base (the pull request deletes it), and V700 only on main after
  // the branch: both count, their facts read at the base (review of #255, R11).
  const gone = fixture(t);
  gone.git('rm', '-q', `${ISSUES}/S080.yaml`);
  gone.git('commit', '-q', '-m', 'chore(plan): S080 retired');
  gone.git('checkout', '-q', 'main');
  gone.commit('plan', { [`${ISSUES}/V700.yaml`]: issue('V700', 'M048') });
  gone.git('checkout', '-q', 'pr');
  const facts = JSON.parse(run(t, gone, { title: 'chore(plan): S080 and V700 retired',
    headRefName: 'chore/retire', body: '' }, '--facts').stdout);
  assert.deepEqual(facts.violations, []);
  assert.deepEqual(facts.ids.map((f) => [f.id, f.title, f.milestone, f.onBase]),
    [['S080', 'Record S080', 'M005', true], ['V700', 'Record V700', 'M048', true]]);
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
  // A version in a branch is no segment, so a major of 100 is never V100.
  assert.deepEqual(candidates({ branch: 'release/v100.0.0' }), []);
  assert.deepEqual(candidates({ branch: 'chore/release-v100.2.3-rc.1' }), []);
  // Only the record directories count, and only file names of an ID's shape are IDs.
  const odd = recordsOf([`${ISSUES}/README.yaml`, 'docs/V999.yaml', `${MILESTONES}/M12.yaml`]);
  assert.deepEqual([...odd.ids.keys()], []);
  assert.deepEqual([...odd.prefixes].sort(), ['M']);
  assert.deepEqual(RECORD_DIRS, [ISSUES, MILESTONES]);
});

test('an unknown candidate: refused only as the title\'s one link, else a warning', () => {
  const records = recordsOf(Object.keys(BASE_RECORDS));
  const codes = (pr) => judge(pr, records).violations.map((v) => v.code);
  // the title's only candidate names nothing: exactly plan-id-unknown, and a waiver keeps it
  assert.deepEqual(codes({ title: 'chore(docs): V699 tidy', branch: 'chore/tidy' }),
    ['plan-id-unknown']);
  assert.deepEqual(codes({ title: 'chore(docs): V699 tidy', branch: 'chore/tidy',
    body: 'plan: n/a docs only\n' }), ['plan-id-unknown']);
  // a record is named beside it: R128 (a loudness standard), V272 (a review section) warn
  for (const title of ['feat(measure): V603 EBU R128 loudness',
    'fix(studio): V603 V272 A7 detune']) {
    const j = judge({ title, branch: 'feat/x' }, records);
    assert.deepEqual(j.violations, [], title);
    assert.equal(j.warnings.length, title.includes('R128') ? 0 : 1, title);
  }
  const r128 = recordsOf([...Object.keys(BASE_RECORDS), `${ISSUES}/R022.yaml`]);
  const loud = judge({ title: 'feat(measure): V603 EBU R128 loudness', branch: 'x' }, r128);
  assert.deepEqual(loud.violations, []);
  assert.match(loud.warnings.join('\n'), /^R128 \(from the title\) has the letter/);
  // from the branch, which an open pull request cannot rename: a warning, and a waiver or a
  // record in the title clears the pull request (#197, docs/v272-final-review)
  const branch = 'docs/v272-final-review';
  const bare = judge({ title: 'docs(review): the final review', branch }, records);
  assert.deepEqual(bare.violations.map((v) => v.code), ['plan-id-missing']);
  assert.match(bare.violations[0].message, /V272: no such record/);
  assert.deepEqual(codes({ title: 'docs(review): the final review', branch,
    body: 'plan: n/a a review of spec section 272\n' }), []);
  const named = judge({ title: 'docs(review): V603 the final review', branch }, records);
  assert.deepEqual(named.violations, []);
  assert.deepEqual(named.unknown, ['V272']);
  assert.match(named.warnings[0], /^V272 \(from the branch\)/);
});

test('the exemptions: a release, a release record and a train name no record', () => {
  const records = recordsOf(Object.keys(BASE_RECORDS));
  const ok = (pr) => judge(pr, records).violations.map((v) => v.code);
  assert.deepEqual(ok({ title: 'chore(release): v40.1.0', branch: 'release/v40.1.0' }), []);
  assert.deepEqual(ok({ title: 'chore(release): v40.1.0', branch: 'chore/release-v40.1.0' }), []);
  assert.deepEqual(ok({ title: 'chore(release): v40.1.0', branch: 'release/v40.1.0',
    version: '40.1.0' }), []);
  assert.deepEqual(ok({ title: 'chore(release): record v40.1.0',
    branch: 'chore/release-record-v40.1.0' }), []);
  assert.deepEqual(ok({ title: 'train(2026-10-28): #243, #244 in one CI run',
    branch: 'train/2026-10-28' }), []);
  // the release's title, branch and package.json name the same version
  assert.deepEqual(ok({ title: 'chore(release): v40.1.1', branch: 'release/v40.1.0' }),
    ['plan-id-missing']);
  assert.deepEqual(ok({ title: 'chore(release): v40.1.0', branch: 'chore/v40.1.0' }),
    ['plan-id-missing']);
  assert.deepEqual(ok({ title: 'chore(release): v40.1.0', branch: 'release/v40.1.0',
    version: '40.0.9' }), ['plan-id-missing']);
  // a release record: its branch and its title, the same version
  for (const [title, branch] of [['feat(audio): rewrite the engine', 'chore/release-record-v9.9.9'],
    ['chore(release): record v9.9.8', 'chore/release-record-v9.9.9'],
    ['chore(release): record v9.9.9', 'chore/release-record-x'],
    ['chore(release): record v9.9', 'chore/release-record-v9.9']]) {
    assert.deepEqual(ok({ title, branch }), ['plan-id-missing'], `${title} on ${branch}`);
  }
  // a train: a train/ branch and a train(...) title naming its members
  assert.deepEqual(ok({ title: 'train(2026-10-28): the members', branch: 'train/x' }),
    ['plan-id-missing']);
  assert.deepEqual(ok({ title: 'train(x): #1 rewrite the audio engine', branch: 'feat/anything' }),
    ['plan-id-missing']);
  assert.deepEqual(ok({ title: 'chore(train): #250, #252', branch: 'train/2026-10-29' }),
    ['plan-id-missing']);
  assert.equal(roleOf({ title: 'chore(release): v40.0.0-rc.1', branch: 'release/v40.0.0-rc.1',
    version: '40.0.0-rc.1' }), 'release');
  assert.deepEqual(ROLES, ['release', 'release-record', 'train']);
});

/** The `gh pr create --title "..."` of a skill, after `after`, and the branch it is pushed on. */
function skillPr(rel, after) {
  const text = read(rel).slice(read(rel).indexOf(after));
  return { title: /gh pr create --base main --title "([^"]+)"/.exec(text)[1],
    branch: /git push -u origin (\S+)/.exec(text)[1] };
}

test('the skills\' own titles and branches pass as the skills write them', () => {
  const records = recordsOf(Object.keys(BASE_RECORDS));
  const fill = (s) => s.replace(/<yyyy-mm-dd>/g, '2026-10-29').replace('#<a>, #<b>, ...',
    '#250, #252').replace(/X\.Y\.Z/g, '40.1.0');
  for (const [rel, after, role] of [
    ['.ai/repo/skills/merge-train/SKILL.md', '6. Push and open', 'train'],
    ['.ai/repo/skills/release/SKILL.md', '5. Land it', 'release'],
    ['.ai/repo/skills/release/SKILL.md', '7. Record it', 'release-record'],
  ]) {
    const pr = skillPr(rel, after);
    const filled = { title: fill(pr.title), branch: fill(pr.branch), version: '40.1.0' };
    const j = judge(filled, records);
    assert.deepEqual(j.violations, [], `${rel}: ${JSON.stringify(filled)}`);
    assert.equal(j.role, role, `${rel}: ${JSON.stringify(filled)}`);
  }
});

test('title-grammar holds GitHub\'s button titles and tags to the merge subject', () => {
  const records = recordsOf(Object.keys(BASE_RECORDS));
  // fail-first reads `[WIP] feat:` as a feat to decide whether it applies; here the title is
  // the subject of the merge commit on main (C1), so a tag or GitHub's Revert title is refused
  for (const title of ['[WIP] feat(studio): V603 pinch zoom',
    'Revert "feat(studio): V603 pinch zoom on the timeline"']) {
    assert.deepEqual(judge({ title, branch: 'x' }, records).violations.map((v) => v.code),
      ['title-grammar'], title);
  }
});

// The titles and branches of real pull requests (read with `gh pr view` on 2026-10-29; #228 for
// the release #237 and #229 for its record #243, whose version is the current one and so may
// not be written here), each judged at a head carrying the records its own head carried; none
// of their bodies carries a closing keyword or a `plan: n/a` line.
const F_RECORDS = { [`${ISSUES}/F001.yaml`]: issue('F001', 'M055'),
  [`${ISSUES}/F012.yaml`]: issue('F012', 'M055'),
  [`${MILESTONES}/M055.yaml`]: 'id: M055\ntitle: "The whole UI on Flowbite Pro"\npriority: p1\n' };
const GOLDEN = [
  [254, 'chore(plan): V603 and U001 done at their main commits', 'chore/plan-done-v603-u001',
    { ids: ['V603', 'U001'] }],
  // #251 adds M055, F001 and F012 on its own head
  [251, 'chore(plan): intent ui-flowbite-pro, M055 and F001-F012 (the whole UI on Flowbite Pro)',
    'chore/plan-ui-flowbite-pro', { ids: ['M055', 'F001', 'F012'], head: F_RECORDS }],
  // #253's head carries no F001 (#251 is not its ancestor), and main has no F record yet
  [253, 'feat(build): F001 Tailwind and flowbite compiled into the single file',
    'feat/f001-tailwind-build', { codes: ['plan-id-missing'],
      message: /F001: no record file begins with that letter/ }],
  [248, 'train(2026-10-28): #243, #244, #240, #241 in one CI run; S080 done', 'train/2026-10-28',
    { role: 'train', ids: ['S080'] }],
  // the merge-train skill's old title, before it was made conventional
  [194, 'Merge train 2026-10-18: #187-#191', 'train/2026-10-18',
    { codes: ['title-grammar', 'plan-id-missing'] }],
  [247, 'feat(studio): V603 pinch zoom on the timeline', 'feat/v603-timeline-pinch',
    { ids: ['V603'], branch: 'V603' }],
  [246, 'test(plan): the two heads of #238 are squash-merged evidence commits',
    'fix/plan-evidence-238-off-history', { codes: ['plan-id-missing'] }],
  [228, 'chore(release): v3.12.1', 'release/v3.12.1',
    { role: 'release', head: { 'package.json': '{ "version": "3.12.1" }\n' } }],
  [229, 'chore(release): record v3.12.1', 'chore/release-record-v3.12.1',
    { role: 'release-record' }],
  [252, 'chore(process): trains judged by members, one merge-train procedure, disk preflight,'
    + ' evidence on main, bounded budget re-measure, symbol-anchored decisions'
    + ' (evolve 2026-10-28)', 'chore/evolve-process-20261028', { codes: ['plan-id-missing'] }],
];

test('golden: real pull requests are judged as the spec says', (t) => {
  for (const [n, title, headRefName, want] of GOLDEN) {
    const repo = fixture(t, want.head || {});
    const facts = inspect({ repo: repo.dir, base: 'main', head: 'HEAD',
      pr: { number: n, title, headRefName, body: '' } });
    const label = `#${n} ${title}`;
    assert.deepEqual(facts.violations.map((v) => v.code), want.codes || [], label);
    assert.deepEqual(facts.ids.map((f) => f.id), want.ids || [], label);
    assert.equal(facts.role, want.role || null, label);
    if (want.message) assert.match(facts.violations[0].message, want.message, label);
    if (want.branch) {
      assert.ok(candidates({ branch: headRefName }).some((c) => c.id === want.branch), label);
    }
  }
  // a release whose head's package.json names another version is not exempt
  const other = fixture(t, { 'package.json': '{ "version": "3.12.0" }\n' });
  const facts = inspect({ repo: other.dir, base: 'main', head: 'HEAD',
    pr: { number: 228, title: 'chore(release): v3.12.1', headRefName: 'release/v3.12.1' } });
  assert.deepEqual(facts.violations.map((v) => v.code), ['plan-id-missing']);
});

const verdictFile = (pr, content, findings = '[]') => `schema: ${VERDICT_SCHEMA}\npr: ${pr}\n`
  + `reviewer: "a reviewing session"\nverdict: merge\ncontent: ${content}\nfindings: ${findings}\n`;

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
    milestone: 'M048', serves: ['studio-completion#v603'], priority: 'p2', onBase: true }]);
  assert.equal(facts.milestone, 'M048');
  assert.equal(facts.level, 'major');
  assert.equal(facts.breaking, true);
  assert.deepEqual(facts.guarded, ['.github/workflows/x.yml']);
  assert.equal(facts.verdict, 'needed');
  assert.equal(facts.failFirst, 'applies');
  assert.equal(facts.evidence, true);
  assert.equal(facts.land, 'merge');
  assert.equal(facts.role, null);
  assert.deepEqual(facts.warnings, []);
  assert.match(facts.content, /^[0-9a-f]{64}$/);
  assert.deepEqual(VERDICT_STATES, ['n/a', 'needed', 'refused', 'recorded']);

  // a verdict review-verdict would accept is recorded; fail-first waived
  repo.commit('verdict', { '.ai/repo/reviews/42.yaml': verdictFile(42, facts.content) });
  const facts2 = (pr) => JSON.parse(run(t, repo, pr, '--facts').stdout);
  const after = facts2({ ...CLEAN, body: 'fail-first: n/a docs\n' });
  assert.equal(after.verdict, 'recorded');
  assert.equal(after.failFirst, 'waived docs');
  assert.equal(after.level, 'minor');
  // one review-verdict refuses is refused: only verdict and content, an open P1, stale content
  for (const text of [`verdict: merge\ncontent: ${facts.content}\n`,
    verdictFile(42, facts.content, '\n  - { id: R1, severity: P1, status: open, title: "x" }'),
    verdictFile(43, facts.content)]) {
    repo.commit('verdict', { '.ai/repo/reviews/42.yaml': text });
    assert.equal(facts2(CLEAN).verdict, 'refused', text);
  }
  repo.commit('verdict', { '.ai/repo/reviews/42.yaml': verdictFile(42, facts.content) });
  repo.commit('after the review', { '.github/workflows/x.yml': 'name: x, changed\n' });
  assert.equal(facts2(CLEAN).verdict, 'refused', 'the change moved after the review');

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

test('--facts: no evidence, a record only the head has, a warning, and the merge base', (t) => {
  const repo = fixture(t, { [`${ISSUES}/F001.yaml`]: issue('F001', 'M055'),
    [`${ISSUES}/V603.yaml`]: issue('V603', 'M048', 'notes: "changed, no evidence"\n') });
  // main moves on after the branch: its guarded change and its evidence are not the PR's
  repo.git('checkout', '-q', 'main');
  repo.commit('main moves on', { '.github/workflows/y.yml': 'name: y\n',
    [`${ISSUES}/U001.yaml`]: issue('U001', 'M054', 'evidence:\n  - covers: verified\n') });
  repo.git('checkout', '-q', 'pr');
  const facts = JSON.parse(run(t, repo, { ...CLEAN, title: 'feat(build): F001 V603 V777 x' },
    '--facts').stdout);
  assert.equal(facts.evidence, false);
  assert.deepEqual(facts.guarded, []);
  assert.equal(facts.verdict, 'n/a');
  assert.notEqual(facts.mergeBase, facts.base);
  assert.deepEqual(facts.ids.map((f) => [f.id, f.onBase]), [['F001', false], ['V603', true]]);
  assert.deepEqual(facts.unknown, ['V777']);
  assert.equal(facts.warnings.length, 1);
  const md = summary(facts, 'korczis/oscilla');
  assert.ok(md.includes(`[F001](https://github.com/korczis/oscilla/blob/${facts.head}/`), md);
  assert.match(md, /Warning: V777 \(from the title\)/);
  const check = run(t, repo, { ...CLEAN, title: 'feat(build): F001 V603 V777 x' });
  assert.equal(check.status, 0, check.out);
  assert.match(check.out, /^pr-metadata: warning: V777/m);
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
const IMPORTS = ['fail-first.mjs', 'git-ref.mjs', 'release-analyze.mjs', 'shell-words.mjs',
  'release-metadata.mjs', 'review-verdict.mjs', 'yaml-subset.mjs'];
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
  assert.equal(MODEL.schema, 'oscilla.pr-meta/v1', 'not Majordomus\' own pr-meta.yaml shape');
  assert.deepEqual(MODEL.judge.concurrency, {
    group: 'metadata-${{ github.event.pull_request.number }}', 'cancel-in-progress': true });
  assert.equal(MODEL.judge.workflow, '.github/workflows/metadata.yml');
  assert.deepEqual(MODEL.judge.permissions, { contents: 'read', 'pull-requests': 'read' });
  assert.equal(MODEL.judge.bound, 6);
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
  const tail = '--base "refs/remotes/origin/$GITHUB_BASE_REF" --check --summary'
    + ' "$GITHUB_STEP_SUMMARY"\n';
  const wrapper = '            /bin/bash "${{ runner.temp }}/judge/.github/scripts/'
    + 'base-rule.sh" \\\n            "refs/remotes/origin/$GITHUB_BASE_REF" scripts/pr-metadata.mjs';
  const shell = '        shell: /usr/bin/env -u BASH_ENV -u ENV /bin/bash --noprofile --norc'
    + ' -eo pipefail {0}\n';
  const step = `        timeout-minutes: 2\n${shell}`;
  const node = '      - uses: actions/setup-node@v7\n        timeout-minutes: 1\n        with:\n'
    + '          node-version: 22\n';
  const checkout = '      - uses: actions/checkout@v7\n        timeout-minutes: 2\n        with:\n'
    + '          fetch-depth: 0\n';
  const runs = '          PR: ${{ github.event.pull_request.number }}\n        run: |\n';
  const guard = '          if [ -z "$PR" ]; then echo'
    + ' "::error::pr-metadata: no pull request to judge"; exit 1; fi\n';
  // [name, text, the problem it causes]: `alone` cases cause exactly that one problem, so each
  // check of workflowModelProblems() has a case that fails when the check is deleted (R8)
  for (const [name, text, want, alone = true] of [
    ['pull-requests: write', mutate(WORKFLOW, '  pull-requests: read\n',
      '  pull-requests: write\n'), /^permissions are/],
    ['issues: write added', mutate(WORKFLOW, '  pull-requests: read\n',
      '  pull-requests: read\n  issues: write\n'), /^permissions are/],
    ['without edited', mutate(WORKFLOW, '[opened, edited, synchronize,',
      '[opened, synchronize,'), /^pull_request types are/],
    ['pull_request_target', mutate(WORKFLOW, '\non:\n  pull_request:\n',
      '\non:\n  pull_request_target:\n'), /^triggers are/, false],
    ['workflow_dispatch', mutate(WORKFLOW, '\npermissions:\n',
      '  workflow_dispatch:\n\npermissions:\n'), /^triggers are/],
    ['another bound', mutate(WORKFLOW, '    timeout-minutes: 6\n',
      '    timeout-minutes: 30\n'), /^timeout-minutes is 30/],
    ['renamed job', mutate(WORKFLOW, '    name: metadata\n', '    name: meta\n'),
      /^the job's name/],
    ['a second job', mutate(WORKFLOW, '\njobs:\n', '\njobs:\n  other:\n    name: other\n'
      + '    runs-on: ubuntu-latest\n    timeout-minutes: 1\n    steps:\n      - run: echo\n'),
    /^jobs are \["other","metadata"\]/],
    ['job permissions', mutate(WORKFLOW, '    runs-on: ubuntu-latest\n',
      '    runs-on: ubuntu-latest\n    permissions:\n      pull-requests: write\n'),
    /^the job widens or narrows/],
    ['conditional job', mutate(WORKFLOW, '    timeout-minutes: 6\n',
      '    timeout-minutes: 6\n    if: github.actor != \'x\'\n'), /^the job is conditional/],
    ['non-fatal job', mutate(WORKFLOW, '    timeout-minutes: 6\n',
      '    timeout-minutes: 6\n    continue-on-error: true\n'),
    /^the job is conditional or non-fatal/],
    ['conditional step', mutate(WORKFLOW, step, `        timeout-minutes: 2\n        if: false\n`
      + shell), /^a step is conditional/],
    ['non-fatal step', mutate(WORKFLOW, step, '        timeout-minutes: 2\n'
      + `        continue-on-error: true\n${shell}`),
    /^a step is conditional or non-fatal/],
    ['PR from elsewhere', mutate(WORKFLOW,
      '          PR: ${{ github.event.pull_request.number }}\n',
      '          PR: ${{ inputs.pr }}\n'),
    /^PR is not the event's/],
    ['|| true', mutate(WORKFLOW, tail, `${tail.trimEnd()} || true\n`), /forced/, false],
    ['own copy', mutate(WORKFLOW, wrapper, '            node scripts/pr-metadata.mjs'),
      /^the last command is not the call/],
    // how the judge is reached (review of #255, R12): the base commit's copy, under env -i,
    // by a shell that reads no BASH_ENV, after a setup-node that read no file of the checkout
    ['the checkout\'s base-rule.sh', mutate(WORKFLOW, wrapper, wrapper.replace(
      '/bin/bash "${{ runner.temp }}/judge/.github/scripts/base-rule.sh"',
      '.github/scripts/base-rule.sh')), /^the last command is not the call/],
    ['no env -i', mutate(WORKFLOW, '          /usr/bin/env -i'
      + ' PATH="${{ steps.judge.outputs.path }}" \\\n            HOME="${{ runner.temp }}/judge-home" GITHUB_REPOSITORY',
    '          PATH="${{ steps.judge.outputs.path }}" \\\n'
      + '            HOME="${{ runner.temp }}/judge-home" GITHUB_REPOSITORY'),
    /^the last command is not the call/],
    ['NODE_OPTIONS for the judge', mutate(WORKFLOW, ' GITHUB_REPOSITORY="$GITHUB_REPOSITORY" \\',
      ' GITHUB_REPOSITORY="$GITHUB_REPOSITORY" NODE_OPTIONS=--x \\'),
    /^the last command is not the call/],
    ['the step\'s own bash', mutate(WORKFLOW, shell, ''), /^the judge's shell is/],
    ['checkout before setup-node', mutate(WORKFLOW, `${node}      # Full history: the base`
      + ' branch\'s records and program, and the merge base of the diff.\n' + checkout,
    `${checkout}${node}`), /^the first steps are \["actions\/checkout","actions\/setup-node"/],
    ['setup-node reads the checkout\'s cache', mutate(WORKFLOW, node,
      `${node}          cache: npm\n`), /^setup-node reads a file of the checkout/],
    ['no judge step', mutate(WORKFLOW, '        id: judge\n', ''), /^the first steps are/],
    ['the short base a tag can shadow (#255, R2)', mutate(WORKFLOW, tail,
      tail.replace('refs/remotes/origin/$GITHUB_BASE_REF', 'origin/$GITHUB_BASE_REF')),
    /^the last command is not the call/],
    ['no --check', mutate(WORKFLOW, tail, tail.replace(' --check', '')),
      /^the last command is not the call/],
    ['a command after it', mutate(WORKFLOW, tail, `${tail}          echo done\n`),
      /^the last command is not the call/],
    ['no PR guard', mutate(WORKFLOW, guard, ''), /^it does not fail when there is no pull/],
    // an early or forced success on a line before the call (R7): each alone
    ['set +e', mutate(WORKFLOW, runs, `${runs}          set +e\n`), /^an early or forced/],
    ['set +o errexit', mutate(WORKFLOW, runs, `${runs}          set +o errexit\n`),
      /^an early or forced/],
    ['exit 0', mutate(WORKFLOW, guard, `${guard}          [ -n "$SKIP" ] && exit 0\n`),
      /^an early or forced/],
    ['a bare exit', mutate(WORKFLOW, guard, `${guard}          [ -n "$SKIP" ] && exit\n`),
      /^an early or forced/],
    ['exit with a status of its own', mutate(WORKFLOW, guard,
      `${guard}          [ -n "$SKIP" ] && exit "$s"\n`), /^an early or forced/],
    ['|| :', mutate(WORKFLOW, 'sleep 10\n', 'sleep 10 || :\n'), /^an early or forced/],
    // review of #255, round 2 (R7): bash exits with the status modulo 256, and exec replaces
    // the step's shell, so whatever it starts ends the step
    ['exit 256', mutate(WORKFLOW, guard, `${guard}          [ -n "$SKIP" ] && exit 256\n`),
      /^an early or forced/],
    ['exec true', mutate(WORKFLOW, guard, `${guard}          [ -n "$SKIP" ] && exec true\n`),
      /^an early or forced/],
    // review of #255, round 3 (R7): read as bash reads it, quoting inside a word hides nothing,
    // and eval, source and . can make any word mean anything
    ...[String.raw`e\xit 0`, "ex''it 0", String.raw`ex\ec true`, 'eval "$SKIP"',
      'source "$RUNNER_TEMP/x.sh"', '. ./x.sh', "$'\\x65xit' 0", 'ex"i"t 0']
      .map((line) => [line, mutate(WORKFLOW, guard,
        `${guard}          [ -n "$SKIP" ] && ${line}\n`), /^an early or forced/]),
    // the concurrency of the model, each part alone (R8: the rework had dropped these)
    ['one concurrency group', mutate(WORKFLOW,
      '  group: metadata-${{ github.event.pull_request.number }}\n', '  group: metadata\n'),
    /^concurrency is/],
    ['no cancel-in-progress', mutate(WORKFLOW, '  cancel-in-progress: true\n',
      '  cancel-in-progress: false\n'), /^concurrency is/],
    ['no concurrency', mutate(WORKFLOW, '\nconcurrency:\n'
      + '  group: metadata-${{ github.event.pull_request.number }}\n'
      + '  cancel-in-progress: true\n', '\n'), /^concurrency is/],
  ]) {
    const problems = workflowModelProblems(text, MODEL_TEXT);
    assert.notDeepEqual(problems, [], name);
    assert.ok(problems.some((p) => want.test(p)), `${name}: ${problems.join('; ')}`);
    if (alone) assert.equal(problems.length, 1, `${name}: ${problems.join('; ')}`);
  }
  assert.deepEqual(workflowModelProblems(WORKFLOW, 'schema: x\n'),
    ['the model has no judge: block']);
  // a failing exit and a retry loop are not forced successes
  for (const line of ['exit 1', '{ echo x; exit 1; }', 'gh api --exit-status x', 'a || echo b',
    'exit 255', 'exit 257', '[ "$n" -lt 3 ] || { echo x; exit 1; }', 'gh --exec-path x']) {
    assert.equal(FORCED_SUCCESS.test(line), false, line);
  }
  for (const line of ['exit', 'exit 0', 'exit 00', 'exit 256', 'exit 512', 'exit 4294967296',
    'exit "$s"', 'exec true', 'exec "$@"', 'x && exec node y', 'trap \'exit 0\' EXIT',
    'set +e', 'a || true', 'a || :', String.raw`e\xit 0`, "ex''it 0", String.raw`ex\ec true`,
    'eval x', 'source x', '. x', 'bash -c "exit 0"', '"$X" y', '$(echo exit) 0']) {
    assert.equal(FORCED_SUCCESS.test(line), true, line);
  }
  // the order of the permission keys means nothing to GitHub, so it means nothing here
  const swapped = mutate(WORKFLOW, '  contents: read\n  pull-requests: read\n',
    '  pull-requests: read\n  contents: read\n');
  assert.deepEqual(workflowModelProblems(swapped, MODEL_TEXT), []);
});
