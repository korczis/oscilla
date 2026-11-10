// The deeper derivations of scripts/facts.mjs behind the /lab/ landing's dashboards (plan P015,
// on P014 and owner decision Q107). Each is pinned against a fixture git repository built here,
// with fixed commit dates, so the expected values are exact:
//   - parseCommitSubject reads Conventional Commits (type, scope, breaking) and calls a
//     non-conventional subject `merge` only when the commit has two or more parents;
//   - releaseChanges takes the v* tags reachable from HEAD in SemVer order (v1.0.10 after
//     v1.0.2, a tag on an unmerged branch left out), lists each commit of prev..tag once (a
//     merged branch's members and its merge commit both), groups them by type in the
//     changelog's order, infers plan ids only where an issue file exists, collects the PR
//     numbers, and puts lastTag..HEAD under `unreleased`;
//   - codeInventory sizes the src/js modules at HEAD and counts unit and browser test files and
//     the dist per tag from git ls-tree (no checkout);
//   - roadmap orders milestones by `order` then id and intents by their first milestone, with
//     done/total from the issue files, and lists the milestones no intent names;
//   - claimArea derives a claim's area from its implementation path; adrs reads id, title,
//     status and date from the front matter;
//   - collectFacts on this repository carries the new groups, plain JSON, deterministic.
// The retrospective trends of plan P016, each on its own fixture:
//   - planBurnup counts issues per UTC day of created_at and completed_at, a cancelled issue
//     neither done nor in scope (counted on its created day), every day of the span present;
//   - claimsPerRelease reads docs/CLAIMS.yaml at each tag through the claims parser and reports
//     a tag without the file as absent (null counts), never as zero;
//   - ratchets finds every tests/{unit,browser}/*-baseline.json at each tag and HEAD by git
//     ls-tree (a nested or non-baseline file is not one), reads each total from the file's own
//     structure (baselineTotal), and counts the rises within one series only;
//   - reviews reads verdicts and findings per pull request, dates each record by the commit that
//     added it and fills every ISO week of the span, an empty one with zeros;
//   - releaseCadence takes the hours between consecutive published_at and their median.
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BASELINE_FILE, CHARTS, COMMIT_TYPES, REPO_ROOT, adrs, baselineTotal, catFiles, claimArea,
  claimsPerRelease, codeInventory, collectFacts, median, parseCommitSubject, planBurnup, planIdsIn,
  prsIn, ratchets, releaseCadence, releaseChanges, releaseTags, reviews, roadmap, utcDay,
} from '../../scripts/facts.mjs';

// A repository whose every commit has its own fixed date, one minute after the previous one.
function fixture() {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'oscilla-facts-fixture-'));
  let tick = 0;
  let fixed = null;
  const date = () => fixed ?? `2026-01-01T00:${String(tick).padStart(2, '0')}:00Z`;
  const git = (...a) => execFileSync('git', a, { cwd: dir, encoding: 'utf8',
    env: { ...process.env, GIT_AUTHOR_DATE: date(), GIT_COMMITTER_DATE: date() } }).trim();
  const write = (rel, text) => {
    mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    writeFileSync(path.join(dir, rel), text);
  };
  // `when` (an ISO time) dates this one commit instead of the next minute of the tick
  const commit = (subject, when = null) => {
    tick += 1;
    fixed = when;
    git('add', '-A');
    git('commit', '--quiet', '--allow-empty', '-m', subject);
    fixed = null;
    return git('rev-parse', 'HEAD');
  };
  const merge = (branch, subject) => {
    tick += 1;
    git('merge', '--quiet', '--no-ff', '-m', subject, branch);
  };
  git('init', '--quiet', '--initial-branch=main');
  git('config', 'user.email', 'fixture@example.invalid');
  git('config', 'user.name', 'fixture');
  git('config', 'commit.gpgsign', 'false');
  git('config', 'tag.gpgsign', 'false');
  return { dir, git, write, commit, merge };
}

test('parseCommitSubject: Conventional Commits, and a merge only by its parents', () => {
  assert.deepEqual(parseCommitSubject('feat(studio): a Clock node (K023) (#509)'),
    { type: 'feat', scope: 'studio', breaking: false, conventional: true,
      text: 'a Clock node (K023) (#509)' });
  assert.deepEqual(parseCommitSubject('fix!: drop the old key'),
    { type: 'fix', scope: null, breaking: true, conventional: true, text: 'drop the old key' });
  assert.equal(parseCommitSubject("Merge branch 'main' into x", 2).type, 'merge');
  assert.equal(parseCommitSubject("Merge branch 'main' into x", 1).type, 'other');
  assert.equal(parseCommitSubject('WIP no type').conventional, false);
  const known = new Set(['K023', 'W008']);
  assert.deepEqual(planIdsIn('feat(W008): K023 and K999, again K023', known), ['K023', 'W008']);
  assert.deepEqual(prsIn('train (#509), merges #12 and #509'), [12, 509]);
  assert.equal(COMMIT_TYPES[0], 'feat');
  assert.equal(COMMIT_TYPES[COMMIT_TYPES.length - 1], 'other');
});

test('releaseChanges: tags in SemVer order, each commit once, grouped, ids and PRs inferred',
  () => {
    const { dir, git, write, commit, merge } = fixture();
    try {
      write('.ai/repo/project/issues/K001.yaml', 'id: K001\n');
      write('.ai/repo/project/issues/P002.yaml', 'id: P002\n');
      commit('feat(core): the first thing (K001)');
      git('tag', 'v1.0.0');
      commit('fix(K001): repair it (#12)');
      git('tag', 'v1.0.2');
      git('checkout', '--quiet', '-b', 'feature');
      commit('test(ui): cover P002 and Z999 (#13)');
      git('checkout', '--quiet', 'main');
      write('src/js/core/a.js', '0123456789');
      commit('chore: bump');
      merge('feature', "Merge branch 'feature'");
      git('tag', 'v1.0.10');
      git('checkout', '--quiet', '-b', 'side');
      commit('feat: never merged');
      git('tag', 'v9.0.0');
      git('checkout', '--quiet', 'main');
      commit('docs: a note after the release');

      assert.deepEqual(releaseTags(dir), ['v1.0.0', 'v1.0.2', 'v1.0.10']);
      const rc = releaseChanges(dir, { releases: [{ tag: 'v1.0.2', version: '1.0.2',
        published_at: '2026-01-02T00:00:00Z' }] });
      assert.deepEqual(rc.items.map((r) => [r.version, r.from, r.commits, r.recorded]), [
        ['1.0.0', null, 1, false], ['1.0.2', 'v1.0.0', 1, true], ['1.0.10', 'v1.0.2', 3, false],
      ]);
      assert.equal(rc.items[1].published_at, '2026-01-02T00:00:00Z');
      assert.deepEqual(rc.items[0].planIds, ['K001']);
      assert.deepEqual(rc.items[1].planIds, ['K001'], 'the scope names the plan id');
      assert.deepEqual(rc.items[1].prs, [12]);
      const last = rc.items[2];
      assert.deepEqual(Object.keys(last.byType), ['test', 'chore', 'merge'], 'changelog order');
      assert.deepEqual(last.byType, { test: 1, chore: 1, merge: 1 });
      assert.deepEqual(last.planIds, ['P002'], 'Z999 has no issue file');
      assert.deepEqual(last.prs, [13]);
      assert.deepEqual(last.groups.map((g) => g.type), ['test', 'chore', 'merge']);
      assert.equal(last.groups[2].commits[0].subject, "Merge branch 'feature'");
      assert.equal(last.groups[2].commits[0].conventional, false);
      const all = rc.items.flatMap((r) => r.groups.flatMap((g) => g.commits.map((c) => c.sha)));
      assert.equal(new Set(all).size, all.length, 'no commit is listed twice');
      assert.ok(all.every((sha) => /^[0-9a-f]{40}$/.test(sha)));
      assert.equal(rc.unreleased.from, 'v1.0.10');
      assert.deepEqual(rc.unreleased.byType, { docs: 1 });
      assert.deepEqual(rc.types, ['feat', 'fix', 'docs', 'test', 'chore', 'merge']);
      assert.match(rc.unreleased.groups[0].commits[0].date, /^\d{4}-\d{2}-\d{2}T.*Z$/);

      const inv = codeInventory(dir);
      assert.deepEqual(inv.modules, [{ module: 'core', files: 1, bytes: 10 }]);
      assert.deepEqual(inv.perRelease.map((r) => [r.tag, r.srcFiles, r.srcBytes]),
        [['v1.0.0', 0, 0], ['v1.0.2', 0, 0], ['v1.0.10', 1, 10]]);
      assert.equal(inv.perRelease[0].distBytes, null);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

test('codeInventory counts unit and browser test files and the dist per tag', () => {
  const { dir, git, write, commit } = fixture();
  try {
    write('tests/unit/a.test.mjs', 'x');
    write('tests/unit/helper.mjs', 'x');
    write('tests/browser/s.cjs', 'x');
    write('tests/browser/lib/wait.cjs', 'x');
    write('dist/index.html', '<!doctype html>');
    write('src/js/main.js', 'abc');
    write('src/js/ui/b.js', 'abcdef');
    commit('feat: start');
    git('tag', 'v0.1.0');
    write('tests/unit/b.test.mjs', 'x');
    commit('test: one more');
    git('tag', 'v0.2.0');
    const inv = codeInventory(dir);
    assert.deepEqual(inv.modules, [{ module: 'ui', files: 1, bytes: 6 },
      { module: '(root)', files: 1, bytes: 3 }]);
    assert.deepEqual(inv.perRelease.map((r) => [r.version, r.unit, r.browser, r.distBytes]),
      [['0.1.0', 1, 1, 15], ['0.2.0', 2, 1, 15]]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('roadmap: milestones by order then id, intents by their first milestone, done/total', () => {
  const { dir, write } = fixture();
  try {
    const ms = (id, order) => write(`.ai/repo/project/milestones/${id}.yaml`,
      `id: ${id}\ntitle: "Milestone ${id}"\n${order === null ? '' : `order: ${order}\n`}`);
    ms('M001', 2);
    ms('M002', 1);
    ms('M003', null);
    ms('M004', 5);
    const issue = (id, m, extra = '') => write(`.ai/repo/project/issues/${id}.yaml`,
      `id: ${id}\nmilestone: ${m}\n${extra}`);
    issue('K001', 'M001', "completed_at: '2026-01-01'\n");
    issue('K002', 'M001');
    issue('K003', 'M002', "completed_at: '2026-01-01'\n");
    issue('K004', 'M002', 'cancelled: true\n');
    issue('K005', 'M003');
    write('.ai/repo/project/intents/b-late.yaml', 'id: b-late\ntitle: "Late"\nmilestones:\n'
      + '  - "M003"\n');
    write('.ai/repo/project/intents/a-first.yaml', 'id: a-first\ntitle: "First"\n'
      + 'milestones:\n  - "M001"\n  - "M002"\n  - "M999"\n');
    const rm = roadmap(dir);
    assert.deepEqual(rm.items.map((i) => i.id), ['a-first', 'b-late']);
    const first = rm.items[0];
    assert.deepEqual(first.milestones.map((m) => [m.id, m.status, m.done, m.total]),
      [['M002', 'DONE', 1, 1], ['M001', 'ACTIVE', 1, 2]], 'order 1 before order 2; M999 absent');
    assert.deepEqual([first.done, first.total], [2, 3]);
    assert.deepEqual(rm.items[1].milestones.map((m) => [m.id, m.status, m.order]),
      [['M003', 'OPEN', null]]);
    assert.deepEqual(rm.unassigned.map((m) => m.id), ['M004']);
    assert.ok(rm.source.includes('.ai/repo/project/intents'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('claimArea derives the area from the implementation path; adrs reads the front matter',
  () => {
    assert.equal(claimArea('src/js/studio/compiler.js'), 'studio');
    assert.equal(claimArea('src/js/main.js'), 'app');
    assert.equal(claimArea('src/data/about-stations.json'), 'data');
    assert.equal(claimArea('src/index.html'), 'ui');
    assert.equal(claimArea('scripts/landing.mjs'), 'tooling');
    assert.equal(claimArea('-'), 'none');
    assert.equal(claimArea(undefined), 'none');
    const { dir, write } = fixture();
    try {
      write('.ai/repo/adrs/0002-two.md', '---\nschema: adr/v1\nid: adr-0002\n'
        + 'title: "Two: quoted"\nstatus: accepted\ndate: 2026-10-02\n---\n# Two\n');
      write('.ai/repo/adrs/0001-one.md', '---\nid: adr-0001\ntitle: One plain\n'
        + 'status: proposed\n---\n');
      write('.ai/repo/adrs/README.md', '# not an ADR\n');
      const a = adrs(dir);
      assert.equal(a.total, 2);
      assert.deepEqual(a.byStatus, { accepted: 1, proposed: 1 });
      assert.deepEqual(a.items, [
        { id: 'adr-0001', number: 1, title: 'One plain', status: 'proposed', date: null,
          path: '.ai/repo/adrs/0001-one.md' },
        { id: 'adr-0002', number: 2, title: 'Two: quoted', status: 'accepted',
          date: '2026-10-02', path: '.ai/repo/adrs/0002-two.md' },
      ]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

// The repository's own history: fail-first runs the tests in a tree extracted by git archive
// with no commit (scripts/fail-first.mjs), where only the fixture repositories above have one.
const HAS_HISTORY = (() => {
  try {
    execFileSync('git', ['rev-parse', '--verify', '-q', 'HEAD'], { cwd: REPO_ROOT, stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();

test('collectFacts carries the new groups for this repository, as plain JSON, twice the same',
  { skip: !HAS_HISTORY && 'this checkout has no commit history (a git archive tree)' },
  async () => {
    const [a, b] = [await collectFacts({ git: true }), await collectFacts({ git: true })];
    assert.deepEqual(a, b);
    assert.deepEqual(JSON.parse(JSON.stringify(a)), a);
    for (const name of ['modules', 'growth']) assert.ok(CHARTS.includes(name), name);
    for (const c of a.claims.items) {
      assert.equal(c.area, claimArea(c.implementation), c.id);
      for (const k of ['source', 'implementation', 'test']) assert.equal(typeof c[k], 'string');
    }
    assert.equal(a.adrs.items.length, a.adrs.total);
    assert.ok(a.adrs.items.every((x) => x.title && x.status !== 'unknown'));
    assert.ok(a.roadmap.items.length > 0);
    const milestones = new Set(a.plan.items.map((m) => m.id));
    const listed = new Set([...a.roadmap.items.flatMap((i) => i.milestones.map((m) => m.id)),
      ...a.roadmap.unassigned.map((m) => m.id)]);
    assert.deepEqual([...listed].sort(), [...milestones].sort(), 'every milestone appears');
    const tags = a.releaseChanges.items.map((r) => r.tag);
    assert.deepEqual(tags, releaseTags(REPO_ROOT));
    assert.deepEqual(a.codeInventory.perRelease.map((r) => r.tag), tags);
    assert.ok(a.codeInventory.modules.length > 5);
  });

test('planBurnup: per UTC day created, cancelled and done, cumulative, every day present', () => {
  const { dir, write } = fixture();
  try {
    const issue = (id, extra) => write(`.ai/repo/project/issues/${id}.yaml`,
      `id: ${id}\nmilestone: M001\n${extra}`);
    issue('K001', "created_at: '2026-01-01'\ncompleted_at: 2026-01-03T23:59:59Z\n");
    issue('K002', "created_at: '2026-01-01'\ncancelled: true\n"
      + 'completed_at: 2026-01-02T00:00:00Z\n');
    issue('K003', "created_at: '2026-01-02'\ncompleted_at: '2026-01-05T00:30:00+02:00'\n");
    issue('K004', "created_at: '2026-01-04'\n");
    issue('K005', 'created_at: soon\n');
    const b = planBurnup(dir);
    assert.equal(b.source, '.ai/repo/project/issues');
    assert.equal(b.issues, 5);
    assert.deepEqual(b.undated, { created: 1, completed: 0 });
    assert.deepEqual(b.days.map((d) => [d.day, d.created, d.cancelled, d.done, d.scopeTotal,
      d.doneTotal]), [
      ['2026-01-01', 2, 1, 0, 1, 0],
      ['2026-01-02', 1, 0, 0, 2, 0], // K002's completed_at does not count: it is cancelled
      ['2026-01-03', 0, 0, 1, 2, 1],
      ['2026-01-04', 1, 0, 1, 3, 2], // 2026-01-05T00:30+02:00 is 2026-01-04 in UTC
    ]);
    assert.deepEqual(b.totals, { created: 4, cancelled: 1, scope: 3, done: 2 });
    assert.equal(utcDay('2026-01-05T00:30:00+02:00'), '2026-01-04');
    assert.equal(utcDay('later'), null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('claimsPerRelease: the ledger of each tag by status, a tag without it absent, not zero',
  () => {
    const { dir, git, write, commit } = fixture();
    const ledger = (...rows) => `schema: claims/v1\nclaims:\n${rows.map(([id, status]) =>
      `  - id: ${id}\n    claim: "${id} holds: yes"\n    status: ${status}\n`).join('')}`;
    try {
      write('README.md', 'x\n');
      commit('feat: start');
      git('tag', 'v0.1.0');
      write('docs/CLAIMS.yaml', ledger(['a', 'guaranteed'], ['b', 'guaranteed'], ['c', 'planned']));
      commit('docs: claims');
      git('tag', 'v0.2.0');
      write('docs/CLAIMS.yaml', ledger(['a', 'guaranteed'], ['b', 'guaranteed'],
        ['c', 'guaranteed'], ['d', 'retired']));
      commit('docs: c holds');
      git('tag', 'v0.10.0');
      const c = claimsPerRelease(dir);
      assert.deepEqual(c.items.map((x) => [x.tag, x.present, x.total, x.byStatus]), [
        ['v0.1.0', false, null, null],
        ['v0.2.0', true, 3, { guaranteed: 2, planned: 1 }],
        ['v0.10.0', true, 4, { guaranteed: 3, retired: 1 }],
      ]);
      assert.deepEqual(c.statuses, ['guaranteed', 'planned', 'retired']);
      assert.match(c.source, /git show <tag>:docs\/CLAIMS\.yaml/);
      const read = catFiles(dir, ['v0.1.0:docs/CLAIMS.yaml', 'v0.2.0:README.md']);
      assert.deepEqual([...read.entries()], [['v0.1.0:docs/CLAIMS.yaml', null],
        ['v0.2.0:README.md', 'x\n']]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

test('baselineTotal reads what each baseline structure counts', () => {
  assert.deepEqual(baselineTotal({ note: 'n', total: 7, counts: { a: 3, b: 4 } }),
    { how: 'total', field: 'total', unit: 'count', value: 7, series: null, derived: true,
      extra: null });
  const fb = baselineTotal({ measure: 4, debt: 3607, classes: { x: 1 } });
  assert.deepEqual([fb.how, fb.value, fb.series], ['debt', 3607, 'measure 4']);
  const caps = baselineTotal({ caps: { a: 50000, b: 41000 }, raises: [{}, {}], measured: {} });
  assert.deepEqual([caps.how, caps.field, caps.unit, caps.value, caps.extra],
    ['sum', 'caps', 'bytes', 91000, { files: 2, raises: 2 }]);
  assert.deepEqual(Object.values(baselineTotal({ note: 'n', undriven: ['#a', '#b'] }))
    .slice(0, 4), ['length', 'undriven', 'count', 2]);
  assert.equal(baselineTotal({ entries: [] }).value, 0);
  assert.equal(baselineTotal({ counts: { a: 3, b: 2 } }).value, 5);
  const nested = baselineTotal({ debt: { 'x.cjs': { sleep: 2, poll: 1 }, 'y.cjs': { sleep: 4 } },
    reasons: { r: 'why' } });
  assert.deepEqual([nested.how, nested.field, nested.value], ['sum', 'debt', 7]);
  const raw = baselineTotal({ note: 'n', rule: 'r', a: 1, b: 'x', c: [1], d: [2] });
  assert.deepEqual([raw.how, raw.value, raw.derived], ['raw', 4, false]);
});

test('ratchets: every baseline at each tag and HEAD, its total, rises within a series', () => {
  const { dir, git, write, commit } = fixture();
  const json = (rel, v) => write(rel, `${JSON.stringify(v)}\n`);
  try {
    json('tests/unit/keys-baseline.json', { note: 'n', counts: { a: 3, b: 2 } });
    json('tests/unit/flow-baseline.json', { measure: 1, debt: 900 });
    json('tests/unit/sub/nested-baseline.json', { counts: { a: 1 } });
    json('tests/unit/other.json', { counts: { a: 1 } });
    commit('test: baselines');
    git('tag', 'v1.0.0');
    json('tests/unit/keys-baseline.json', { note: 'n', counts: { a: 1, b: 2 } });
    json('tests/unit/flow-baseline.json', { measure: 2, debt: 4000 });
    json('tests/browser/timing-baseline.json', { debt: { 'x.cjs': { sleep: 4 } } });
    commit('test: lower keys, a new measure, timing');
    git('tag', 'v1.1.0');
    json('tests/unit/flow-baseline.json', { measure: 2, debt: 4100 });
    json('tests/browser/timing-baseline.json', { debt: { 'x.cjs': { sleep: 3 } } });
    commit('test: flow rises within measure 2');
    const r = ratchets(dir);
    assert.deepEqual(r.items.map((x) => x.file), ['tests/browser/timing-baseline.json',
      'tests/unit/flow-baseline.json', 'tests/unit/keys-baseline.json']);
    const [timing, flow, keys] = r.items;
    assert.deepEqual(keys.perRelease.map((p) => [p.tag, p.value]), [['v1.0.0', 5], ['v1.1.0', 3]]);
    assert.deepEqual([keys.head.value, keys.rises, keys.how, keys.field], [3, 0, 'sum', 'counts']);
    assert.deepEqual(timing.perRelease.map((p) => [p.present, p.value]), [[false, null],
      [true, 4]]);
    assert.deepEqual([timing.firstTag, timing.head.value, timing.rises], ['v1.1.0', 3, 0]);
    // 900 (measure 1) -> 4000 (measure 2) is a new measure, not a rise; 4000 -> 4100 is one
    assert.deepEqual(flow.perRelease.map((p) => [p.value, p.series]),
      [[900, 'measure 1'], [4000, 'measure 2']]);
    assert.deepEqual([flow.head.value, flow.head.series, flow.rises], [4100, 'measure 2', 1]);
    assert.ok(BASELINE_FILE.test('tests/browser/iphone-baseline.json'));
    assert.ok(!BASELINE_FILE.test('tests/unit/sub/nested-baseline.json'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('reviews: verdicts and findings per PR, dated by their first commit, every week filled',
  () => {
    const { dir, write, commit } = fixture();
    try {
      write('.ai/repo/reviews/README.md', '# not a verdict\n');
      write('.ai/repo/reviews/12.yaml', 'schema: review-verdict/v1\npr: 12\nverdict: merge\n'
        + 'reviewer: r\ncontent: x\nfindings:\n'
        + '  - { id: R1, severity: P1, status: closed, title: "a" }\n'
        + '  - { id: R2, severity: P3, status: open, title: "b" }\n');
      commit('review: #12', '2026-01-05T10:00:00Z'); // Monday of 2026-W02
      write('.ai/repo/reviews/30.yaml', 'schema: review-verdict/v1\npr: 30\nverdict: changes\n'
        + 'reviewer: r\ncontent: x\nmembers:\n  - { pr: 31, verdict: merge, reason: "r" }\n'
        + 'findings:\n  - { id: R1, severity: P0, status: open, title: "c" }\n'
        + '  - { id: R2, severity: P2, status: open, title: "d" }\n'
        + '  - { id: R3, severity: P3, status: closed, title: "e" }\n');
      commit('review: #30', '2026-01-21T23:00:00Z'); // 2026-W04
      write('.ai/repo/reviews/12.yaml', 'schema: review-verdict/v1\npr: 12\nverdict: merge\n'
        + 'reviewer: r\ncontent: y\nfindings: []\n'.replace('findings: []\n', 'findings:\n'
        + '  - { id: R1, severity: P1, status: closed, title: "a" }\n'
        + '  - { id: R2, severity: P3, status: closed, title: "b" }\n'));
      commit('review: #12 again', '2026-01-28T00:00:00Z');
      const r = reviews(dir);
      assert.deepEqual(r.severities, ['P0', 'P1', 'P2', 'P3']);
      assert.deepEqual(r.items.map((x) => [x.pr, x.verdict, x.members, x.findings, x.addedAt,
        x.week]), [
        [12, 'merge', 0, 2, '2026-01-05T10:00:00.000Z', '2026-W02'],
        [30, 'changes', 1, 3, '2026-01-21T23:00:00.000Z', '2026-W04'],
      ]);
      assert.deepEqual(r.items[1].bySeverity, { P0: 1, P1: 0, P2: 1, P3: 1 });
      assert.deepEqual(r.items[1].byStatus, { open: 2, closed: 1 });
      assert.deepEqual(r.items[1].openBySeverity, { P0: 1, P1: 0, P2: 1, P3: 0 });
      assert.deepEqual(r.items[0].byStatus, { open: 0, closed: 2 }, 'the file as it is now');
      assert.deepEqual(r.weeks.map((w) => [w.week, w.start, w.reviews, w.findings]), [
        ['2026-W02', '2026-01-05', 1, 2], ['2026-W03', '2026-01-12', 0, 0],
        ['2026-W04', '2026-01-19', 1, 3]]);
      assert.deepEqual(r.weeks[1].bySeverity, { P0: 0, P1: 0, P2: 0, P3: 0 });
      assert.deepEqual(r.totals, { reviews: 2, findings: 5,
        bySeverity: { P0: 1, P1: 1, P2: 1, P3: 2 }, byStatus: { open: 2, closed: 3 },
        openBySeverity: { P0: 1, P1: 0, P2: 1, P3: 0 }, byVerdict: { changes: 1, merge: 1 },
        undated: 0 });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

test('releaseCadence: hours between consecutive published releases and their median', () => {
  const c = releaseCadence({ source: '.ai/repo/releases', items: [
    { version: '1.0.0', published_at: '2026-01-01T00:00:00Z' },
    { version: '1.2.0', published_at: '2026-01-01T10:00:00Z' },
    { version: '1.1.0', published_at: '2026-01-01T02:30:00Z' },
    { version: '1.3.0', published_at: null },
    { version: '2.0.0', published_at: '2026-01-03T10:00:00Z' },
  ] });
  assert.deepEqual(c.items.map((x) => [x.from, x.version, x.hours]),
    [['1.0.0', '1.1.0', 2.5], ['1.1.0', '1.2.0', 7.5], ['1.2.0', '2.0.0', 48]]);
  assert.deepEqual([c.median, c.releases, c.undated, c.field], [7.5, 4, 1, 'published_at']);
  assert.equal(median([1, 4, 2, 10]), 3);
  assert.equal(median([]), null);
});

test('collectFacts carries the P016 trends for this repository', async () => {
  const f = await collectFacts({ git: true });
  for (const name of ['burnup', 'claims-trend', 'ratchets', 'reviews', 'cadence']) {
    assert.ok(CHARTS.includes(name), name);
  }
  const tags = releaseTags(REPO_ROOT);
  assert.deepEqual(f.claimsPerRelease.items.map((x) => x.tag), tags);
  const head = f.claimsPerRelease.items.filter((x) => x.present);
  assert.ok(head.length > 10);
  for (const it of f.ratchets.items) {
    assert.match(it.file, BASELINE_FILE);
    assert.deepEqual(it.perRelease.map((p) => p.tag), tags);
    assert.ok(it.derived, `${it.file}: its total is derived from its structure`);
  }
  const files = new Set(f.ratchets.items.map((x) => x.file));
  assert.ok(files.has('tests/browser/timing-baseline.json'));
  assert.ok(files.has('tests/unit/czech-prose-baseline.json'));
  assert.equal(f.reviews.totals.undated, 0, 'every review record is committed');
  assert.equal(f.reviews.totals.findings, f.reviews.items.reduce((n, x) => n + x.findings, 0));
  assert.equal(f.reviews.weeks.reduce((n, w) => n + w.findings, 0), f.reviews.totals.findings,
    'every finding sits in one week');
  const last = f.planBurnup.days[f.planBurnup.days.length - 1];
  assert.equal(last.doneTotal, f.plan.items.reduce((n, m) => n + m.done, 0),
    'the burn-up ends at the plan\'s done count');
  assert.equal(f.releaseCadence.items.length, f.releaseCadence.releases - 1);
});
