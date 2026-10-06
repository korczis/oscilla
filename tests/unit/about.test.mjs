// The About workspace: navigation order, exact link targets, the workspace title, and the
// provenance it states. Times on the page are commit timestamps; where git history is
// available they are checked against it, so the page cannot drift into a fabricated claim.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { WORKSPACES, workspaceTitle } from '../../src/js/ui/app.js';

const html = readFileSync(new URL('../../src/index.html', import.meta.url), 'utf8');
const aboutView = html.slice(html.indexOf('id="osc-view-about"'), html.indexOf('</main>'));
const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));

/** The evolution timeline: each station's state, release line (if any) and named commit. */
function timeline() {
  const list = aboutView.slice(aboutView.indexOf('osc-about-timeline'), aboutView.indexOf('</ol>'));
  return [...list.matchAll(/<li data-state="([a-z]+)"(?: data-osc-release="([0-9]+\.[0-9]+)")?>\s*<span class="osc-about-step[^"]*">[^<]*<time data-osc-commit="([0-9a-f]+)"/g)]
    .map(([, state, release, commit]) => ({ state, release: release || null, commit }));
}

// CI's unit job (.github/workflows/ci.yml) checks out full history and tags, so there the
// provenance checks below must run: missing history fails them instead of skipping them.
// Elsewhere (a shallow clone, an export without .git) they skip and say why.
function withoutHistory(t, why) {
  if (process.env.GITHUB_ACTIONS === 'true') {
    assert.fail(`${why}: the CI unit job must check out with fetch-depth: 0`);
  }
  t.skip(why);
}

function git(...args) {
  try {
    return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return null;
  }
}

test('About is the last workspace and the last primary navigation item', () => {
  assert.equal(WORKSPACES.at(-1), 'about');
  const nav = html.slice(html.indexOf('id="osc-nav"'), html.indexOf('</nav>'));
  const items = [...nav.matchAll(/data-osc="(nav\.[a-z]+)"/g)].map((m) => m[1]);
  assert.equal(items.at(-1), 'nav.about');
  assert.equal(new Set(items).size, items.length);
  assert.match(nav, /x-bind="navItem\('about'\)">About<\/a><\/li>\s*<\/ul>/);
});

test('the About view is a full-width view keyed on the workspace, not the V1 mode', () => {
  assert.match(aboutView, /:hidden="workspace !== 'about'"/);
  assert.match(aboutView, /aria-labelledby="osc-about-title"/);
  assert.equal((aboutView.match(/<h2\b/g) || []).length, 1, 'one primary heading');
  assert.ok(!html.includes('osc-dlg-about'), 'the modal About dialog is retired');
  assert.match(html, /data-osc="header\.about" @click="setWorkspace\('about'\)"/);
});

test('external and contact links point exactly where they say', () => {
  const href = (osc) => {
    const m = aboutView.match(new RegExp(`<a [^>]*data-osc="${osc}"[^>]*>`));
    assert.ok(m, `${osc} link exists`);
    return m[0];
  };
  assert.match(href('about.source'), /href="https:\/\/github\.com\/korczis\/oscilla"/);
  assert.match(href('about.majordomus'), /href="https:\/\/majordomus\.dev\/"/);
  assert.match(href('about.email'), /href="mailto:korczis@gmail\.com"/);
  for (const osc of ['about.source', 'about.majordomus']) {
    assert.match(href(osc), /target="_blank"/);
    assert.match(href(osc), /rel="noopener noreferrer"/);
  }
  assert.match(aboutView, />korczis@gmail\.com</);
  assert.match(aboutView, /Tomas Korcak/);
});

test('decorative visuals are hidden from assistive technology', () => {
  assert.match(aboutView, /<svg class="osc-about-trace"[^>]*aria-hidden="true"/);
});

test('the document title follows page-like workspaces only', () => {
  assert.equal(workspaceTitle('about', 'BASE'), 'OSCILLA · About');
  for (const ws of WORKSPACES.filter((w) => w !== 'about')) {
    assert.equal(workspaceTitle(ws, 'BASE'), 'BASE');
  }
});

test('the stated duration matches the stated timestamps', () => {
  const stamp = aboutView.slice(aboutView.indexOf('osc-about-stamp'));
  const [from, to] = [...stamp.matchAll(/<time datetime="([^"]+)">/g)].map((m) => Date.parse(m[1]));
  const minutes = Math.round((to - from) / 60000); // to the nearest minute
  const text = stamp.match(/(\d+) h (\d+) min/);
  assert.ok(text, 'duration is stated');
  assert.equal(Number(text[1]) * 60 + Number(text[2]), minutes);
});

test('timeline timestamps are the commit times of the commits they name', (t) => {
  const marks = [...aboutView.matchAll(/data-osc-commit="([0-9a-f]+)"\s+datetime="([^"]+)"/g)];
  assert.equal(marks.length, timeline().length);
  if (git('rev-parse', '--is-shallow-repository') !== 'false') {
    withoutHistory(t, 'no full git history here (shallow clone or no git)');
    return;
  }
  for (const [, sha, datetime] of marks) {
    const committed = git('show', '-s', '--format=%cI', sha);
    assert.ok(committed, `commit ${sha} exists`);
    assert.equal(Date.parse(committed), Date.parse(datetime), `time of ${sha}`);
  }
  const roots = git('rev-list', '--max-parents=0', 'HEAD').split('\n');
  assert.ok(roots.some((r) => r.startsWith(marks[0][1])), 'the first mark is the first tracked commit');
  assert.ok(git('rev-parse', 'v1.0.0^{commit}').startsWith(marks[1][1]), 'V1 is the v1.0.0 tag');
  assert.ok(git('log', '-1', '--format=%s', marks[3][1]).startsWith('feat(v3): OSCILLA V3 MEASURE'),
    'Measure is the V3 merge');
  const studio = git('log', '-1', '--format=%s', marks[4][1]);
  assert.ok(studio.startsWith('feat(v3.1): OSCILLA V3.1 STUDIO'), 'Studio is the V3.1 merge');
});

// Rule project.about-names-current-release: the About view names the release line this build
// belongs to as the current one, and every release line that was published. A minor or major
// release fails here (and so in npm test, verify and the release gate) until its line is added.
test('the About timeline marks the release line of package.json as current', () => {
  const stations = timeline();
  const line = pkg.version.split('-')[0].split('.').slice(0, 2).join('.');
  const current = stations.filter((s) => s.state === 'current');
  assert.equal(current.length, 1, 'exactly one station is current');
  assert.equal(current[0].release, line,
    `the current station is release line ${line} (package.json ${pkg.version}); add it to the About timeline`);
  assert.equal(stations.at(-1), current[0], 'the current station is the last one');
  for (const s of stations.slice(0, -1)) assert.equal(s.state, 'done', `station ${s.commit} is done`);
  const lines = stations.filter((s) => s.release).map((s) => s.release);
  assert.equal(new Set(lines).size, lines.length, 'each release line appears once');
  const order = lines.map((l) => l.split('.').map(Number));
  for (let i = 1; i < order.length; i++) {
    const [a, b] = [order[i - 1], order[i]];
    assert.ok(a[0] < b[0] || (a[0] === b[0] && a[1] < b[1]), `release lines ascend: ${lines}`);
  }
});

test('every published release line is on the About timeline, at or before its release', (t) => {
  const tags = git('tag', '--list', 'v*.*.0');
  if (!tags) {
    withoutHistory(t, 'no release tags here (a checkout without tags)');
    return;
  }
  const stations = timeline();
  const named = new Map(stations.filter((s) => s.release).map((s) => [s.release, s.commit]));
  for (const tag of tags.split('\n').filter((x) => /^v[0-9]+\.[0-9]+\.0$/.test(x))) {
    const line = tag.slice(1).split('.').slice(0, 2).join('.');
    assert.ok(named.has(line), `release line ${line} (${tag}) has a station on the About timeline`);
    const commit = named.get(line);
    assert.ok(git('merge-base', '--is-ancestor', commit, tag) !== null,
      `the ${line} station's commit ${commit} is in ${tag}`);
  }
});
