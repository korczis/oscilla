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
  assert.equal(marks.length, 3);
  if (git('rev-parse', '--is-shallow-repository') !== 'false') {
    t.skip('no full git history here (shallow clone or no git)');
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
});
