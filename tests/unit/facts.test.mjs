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
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CHARTS, COMMIT_TYPES, REPO_ROOT, adrs, claimArea, codeInventory, collectFacts, parseCommitSubject,
  planIdsIn, prsIn, releaseChanges, releaseTags, roadmap,
} from '../../scripts/facts.mjs';

// A repository whose every commit has its own fixed date, one minute after the previous one.
function fixture() {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'oscilla-facts-fixture-'));
  let tick = 0;
  const date = () => `2026-01-01T00:${String(tick).padStart(2, '0')}:00Z`;
  const git = (...a) => execFileSync('git', a, { cwd: dir, encoding: 'utf8',
    env: { ...process.env, GIT_AUTHOR_DATE: date(), GIT_COMMITTER_DATE: date() } }).trim();
  const write = (rel, text) => {
    mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    writeFileSync(path.join(dir, rel), text);
  };
  const commit = (subject) => {
    tick += 1;
    git('add', '-A');
    git('commit', '--quiet', '--allow-empty', '-m', subject);
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

test('collectFacts carries the new groups for this repository, as plain JSON, twice the same',
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
