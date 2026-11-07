// R032: the About stations are data (src/data/about-stations.json); the build renders them and
// derives every number on them, and release:prepare stamps the pending station. Nothing about a
// release is typed twice: the step, the time shown, the (Vx.y) label and the done/current state
// are derived, release/commit/datetime are stamped from package.json and HEAD.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  MARKER, STATIONS_REL, deriveStations, expandStations, formatStations, lineLabel, lineOf,
  headStamp, main, readStations, renderStations, stampStations, stationsGitProblems,
  stationsShapeProblems,
} from '../../scripts/about-stations.mjs';
import {
  CI_PREPARE_COMMANDS, GATE_COMMANDS, RESTORE_PATHS,
} from '../../scripts/release-prepare.mjs';

const ROOT = new URL('../../', import.meta.url);
const html = readFileSync(new URL('src/index.html', ROOT), 'utf8');
const pkg = JSON.parse(readFileSync(new URL('package.json', ROOT), 'utf8'));
const doc = readStations();

const fixture = () => ({
  schema: 'oscilla-about-stations/v1',
  stations: [
    { title: 'Plan', summary: 'First commit', commit: '1111111',
      datetime: '2026-10-01T22:58:26+02:00' },
    { release: '1.0', title: 'V1', summary: 'Tagged v1.0.0', commit: '2222222',
      datetime: '2026-10-02T03:19:42+02:00' },
    { release: '9.8', title: 'Eight', summary: 'The eighth line', commit: '3333333',
      datetime: '2026-11-05T13:25:18+01:00' },
  ],
});
const HEAD = { commit: 'abcdef0', datetime: '2026-11-06T21:31:23+01:00' };

test('the committed stations hold their shape and the build has one place to render them', () => {
  assert.deepEqual(stationsShapeProblems(doc), []);
  assert.equal(html.split(MARKER).length, 2, `src/index.html carries ${MARKER} once`);
  assert.doesNotMatch(html, /data-osc-commit=/, 'no station is typed into src/index.html');
  const rendered = expandStations(html);
  assert.equal((rendered.match(/<li data-state=/g) || []).length,
    doc.stations.filter((s) => s.commit).length);
});

test('the current station is package.json\'s release line, derived, never stored', () => {
  const st = deriveStations(doc, pkg.version);
  assert.equal(st.at(-1).release, lineOf(pkg.version));
  assert.deepEqual(st.map((s) => s.state), [...st.slice(0, -1).map(() => 'done'), 'current']);
  for (const s of doc.stations) assert.equal('state' in s, false, 'a station stores no state');
});

test('the step, time, label and word are derived from position, datetime and release', () => {
  const st = deriveStations(fixture(), '9.8.3');
  assert.deepEqual(st.map((s) => [s.step, s.time, s.text, s.state, s.word]), [
    ['01', '22:58', 'First commit', 'done', 'Recorded'],
    ['02', '03:19', 'Tagged v1.0.0', 'done', 'Released'],
    ['03', '13:25', 'The eighth line (V9.8)', 'current', 'Current'],
  ]);
  assert.equal(lineLabel('3.0'), 'V3');
  assert.equal(lineLabel('3.12'), 'V3.12');
  const li = renderStations(fixture(), '9.8.0').split('\n');
  assert.equal(li[0].trim(), '<li data-state="done">');
  assert.equal(li[1].trim(), '<span>01 · <time data-osc-commit="1111111" '
    + 'datetime="2026-10-01T22:58:26+02:00">22:58</time></span>');
});

test('a build for a release line with no station fails and says what to add', () => {
  assert.throws(() => deriveStations(fixture(), '9.9.0'), /no station for release line 9\.9/);
});

test('stamp: the pending station takes the release line of package.json and HEAD', () => {
  const d = fixture();
  d.stations.push({ title: 'Nine', summary: 'The ninth line' });
  assert.deepEqual(stationsShapeProblems(d), [], 'a pending last station is valid');
  assert.equal(renderStations(d, '9.8.0').split('<li ').length - 1, 3, 'pending is not shown');
  const { doc: next, stamped } = stampStations(d, '9.9.0', HEAD);
  assert.equal(stamped, true);
  assert.deepEqual(next.stations.at(-1), { release: '9.9', title: 'Nine',
    summary: 'The ninth line', commit: 'abcdef0', datetime: '2026-11-06T21:31:23+01:00' });
  assert.equal(deriveStations(next, '9.9.0').at(-1).state, 'current');
  assert.equal(deriveStations(next, '9.9.0').at(-2).state, 'done');
});

test('stamp: a patch release changes nothing; a new line without a pending station refuses', () => {
  const { doc: same, stamped } = stampStations(fixture(), '9.8.4', HEAD);
  assert.equal(stamped, false);
  assert.deepEqual(same, fixture());
  assert.throws(() => stampStations(fixture(), '9.9.0', HEAD),
    /release line 9\.9 has no station: add \{ "title", "summary" \}.*docs\(about\)/);
  const utc = fixture();
  utc.stations.push({ title: 'Nine', summary: 'The ninth line' });
  const z = stampStations(utc, '9.9.0', { commit: 'abcdef0', datetime: '2026-11-07T05:58:12Z' });
  assert.equal(z.doc.stations.at(-1).datetime, '2026-11-07T05:58:12Z', 'a UTC host writes Z');
  assert.equal(deriveStations(z.doc, '9.9.0').at(-1).time, '05:58');
  const rc = fixture();
  rc.stations.push({ title: 'Ten', summary: 'The tenth line' });
  assert.equal(stampStations(rc, '10.0.0-rc.1', HEAD).doc.stations.at(-1).release, '10.0');
});

test('mutation: the shape check names each hand-typed or misplaced derived field', () => {
  const at = (edit) => {
    const d = fixture();
    edit(d.stations);
    return stationsShapeProblems(d);
  };
  assert.deepEqual(at((s) => { s[2].release = '9.8.0'; }),
    ['station 3: release 9.8.0 is not MAJOR.MINOR (the file never holds X.Y.Z)']);
  assert.deepEqual(at((s) => { s[2].summary += ' (V9.8)'; }),
    ['station 3: the summary ends with its release label, which the build derives']);
  assert.deepEqual(at((s) => { s[2].state = 'current'; }), ['station 3: unknown field state']);
  assert.deepEqual(at((s) => { s[2].release = '0.9'; }),
    ['station 3: release 0.9 does not follow 1.0']);
  assert.deepEqual(at((s) => { s.splice(1, 0, { title: 'P', summary: 'pending' }); }),
    ['station 2: a pending station is not last']);
  assert.deepEqual(at((s) => { s[2].commit = '33333'; }),
    ['station 3: commit 33333 is not a 7-character id']);
  assert.deepEqual(at((s) => { delete s[2].release; }),
    ['station 3: only the first station may have no release']);
});

test('the git check names a datetime that is not its commit\'s', () => {
  const times = { 1111111: '2026-10-01T22:58:26+02:00', 2222222: '2026-10-02T04:00:00+02:00',
    3333333: '2026-11-05T13:25:18+01:00' };
  const run = (...args) => times[args.at(-1).slice(0, 7)];
  assert.deepEqual(stationsGitProblems(fixture(), null, run),
    ['station 2: datetime 2026-10-02T03:19:42+02:00, commit 2222222 says '
      + '2026-10-02T04:00:00+02:00']);
});

test('release:prepare stamps after its bump and before its build, and restores the file', () => {
  for (const plan of [CI_PREPARE_COMMANDS, GATE_COMMANDS]) {
    const at = plan.findIndex(([c, a]) => c === 'node' && a.join(' ')
      === 'scripts/about-stations.mjs --stamp');
    const build = plan.findIndex(([c, a]) => c === 'npm' && a.join(' ') === 'run build');
    assert.ok(at >= 0 && at < build, 'the stamp runs before the build');
  }
  assert.ok(RESTORE_PATHS.includes(STATIONS_REL));
});

test('--stamp on a scratch repository stamps HEAD and is idempotent', (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), 'osc-stations-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const git = (...a) => execFileSync('git', a, { cwd: dir, encoding: 'utf8' }).trim();
  git('init', '-q');
  git('config', 'user.email', 't@example.invalid');
  git('config', 'user.name', 'T');
  mkdirSync(path.join(dir, 'src', 'data'), { recursive: true });
  const d = fixture();
  d.stations.push({ title: 'Nine', summary: 'The ninth line' });
  writeFileSync(path.join(dir, STATIONS_REL), formatStations(d));
  writeFileSync(path.join(dir, 'package.json'), '{"version":"9.9.0"}\n');
  git('add', '-A');
  git('commit', '-q', '-m', 'docs(about): the 9.9 station');
  const log = console.log;
  console.log = () => {};
  try {
    assert.equal(main(['--stamp'], dir), 0);
    const once = readFileSync(path.join(dir, STATIONS_REL), 'utf8');
    assert.equal(main(['--stamp'], dir), 0);
    assert.equal(readFileSync(path.join(dir, STATIONS_REL), 'utf8'), once, 'idempotent');
  } finally {
    console.log = log;
  }
  const last = readStations(dir).stations.at(-1);
  assert.equal(last.release, '9.9');
  assert.equal(last.commit, git('rev-parse', '--short=7', 'HEAD'));
  assert.equal(Date.parse(last.datetime), Date.parse(git('show', '-s', '--format=%cI', 'HEAD')));
  assert.match(last.datetime, /\+0[12]:00$/, 'stamped in Europe/Prague, whatever the host zone');
});

test('the stamp writes the station zone on a UTC host too (#460 review F3)', (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), 'osc-stations-tz-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const env = { ...process.env, TZ: 'UTC', GIT_COMMITTER_DATE: '2026-07-01T12:00:00Z',
    GIT_AUTHOR_DATE: '2026-07-01T12:00:00Z' };
  const git = (...a) => execFileSync('git', a, { cwd: dir, encoding: 'utf8', env }).trim();
  git('init', '-q');
  git('config', 'user.email', 't@example.invalid');
  git('config', 'user.name', 'T');
  writeFileSync(path.join(dir, 'x'), 'x\n');
  git('add', '-A');
  git('commit', '-q', '-m', 'x');
  assert.equal(git('show', '-s', '--format=%cI', 'HEAD'), '2026-07-01T12:00:00Z', 'a UTC host');
  assert.equal(headStamp(dir).datetime, '2026-07-01T14:00:00+02:00', 'summer time in Prague');
  assert.equal(headStamp(dir, 'UTC').datetime, '2026-07-01T12:00:00Z', 'git writes Z for UTC');
});
