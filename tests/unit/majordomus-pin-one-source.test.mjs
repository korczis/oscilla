// R049: the Majordomus pin has one source, MJ_VERSION and MJ_SHA256 of ci.yml's knowledge job.
// main-checks.yml's mirror is held equal to it, and so (P015) is every other job that installs
// the pinned majordomus (ci.yml's unit job, pages.yml's deploy job, for the /lab/ milestone
// status): each pin equal, each install step byte-equal to the knowledge job's, and the
// version is written nowhere else under
// .github/: no job name (a check name renamed on every bump, review 291), no comment. The bump
// e880703e edited eight files by hand (owner, 2026-11-06: "numbers are duplicated, not
// everything is derived").
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pinnedVersion } from '../../scripts/majordomus-pin-check.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (rel) => readFileSync(path.join(ROOT, rel), 'utf8');
const sha = (text) => (text.match(/^\s*MJ_SHA256:\s*([0-9a-f]{64})\s*$/m) || [])[1] || null;

/** Every line of `files` that names `version` other than an `MJ_VERSION:` line. */
export function pinCopies(version, files, text = read) {
  const out = [];
  for (const f of files) {
    text(f).split('\n').forEach((line, i) => {
      if (line.includes(version) && !/^\s*MJ_VERSION:/.test(line)) out.push(`${f}:${i + 1}`);
    });
  }
  return out;
}

const github = () => readdirSync(path.join(ROOT, '.github'), { recursive: true })
  .map((n) => path.join('.github', String(n)))
  .filter((rel) => /\.(ya?ml|sh|jq|mjs|js|md)$/.test(rel));

test('main-checks.yml pins the same Majordomus release and digest as ci.yml', () => {
  const ci = read('.github/workflows/ci.yml');
  const main = read('.github/workflows/main-checks.yml');
  assert.ok(pinnedVersion(ci), 'ci.yml pins MJ_VERSION');
  assert.equal(pinnedVersion(main), pinnedVersion(ci));
  assert.equal(sha(main), sha(ci));
  assert.ok(sha(ci), 'ci.yml pins MJ_SHA256');
});

test('the pinned version is written nowhere else under .github/', () => {
  const version = pinnedVersion(read('.github/workflows/ci.yml'));
  assert.deepEqual(pinCopies(version, github()), []);
});

test('mutation: a job name or comment carrying the version is named', () => {
  const t = { 'w.yml': 'jobs:\n  k:\n    name: doctor 9.9.9-a.1\n    env:\n'
    + '      MJ_VERSION: 9.9.9-a.1\n    # the 9.9.9-a.1 archive\n' };
  assert.deepEqual(pinCopies('9.9.9-a.1', ['w.yml'], (f) => t[f]), ['w.yml:3', 'w.yml:6']);
});

// Every job env that pins MJ_VERSION, as [file, job, version, digest].
function pins(file) {
  const text = read(file);
  const out = [];
  for (const block of text.split(/\n(?= {2}[a-z][\w-]*:\n)/).slice(1)) {
    const job = /^ {2}([a-z][\w-]*):/.exec(block)[1];
    if (/^ {6}MJ_VERSION:/m.test(block)) out.push([file, job, pinnedVersion(block), sha(block)]);
  }
  return out;
}

/** The text of the "Install Majordomus" step and the version check after it, per job. */
function installSteps(file) {
  const text = read(file);
  const marker = '      - name: Install Majordomus ${{ env.MJ_VERSION }} '
    + '(pinned version and digest)';
  const end = '        run: test "$(majordomus version)" = "majordomus ${MJ_VERSION}"\n';
  const out = [];
  let at = text.indexOf(marker);
  while (at >= 0) {
    const stop = text.indexOf(end, at);
    out.push(text.slice(at, stop + end.length));
    at = text.indexOf(marker, stop);
  }
  return out;
}

test('every job that installs majordomus pins ci.yml\'s release and digest, step for step', () => {
  const ci = read('.github/workflows/ci.yml');
  const want = [pinnedVersion(ci), sha(ci)];
  const all = ['.github/workflows/ci.yml', '.github/workflows/pages.yml',
    '.github/workflows/main-checks.yml'].flatMap(pins);
  assert.deepEqual(all.map((p) => `${p[0]}#${p[1]}`).sort(), [
    '.github/workflows/ci.yml#knowledge', '.github/workflows/ci.yml#unit',
    '.github/workflows/main-checks.yml#knowledge', '.github/workflows/main-checks.yml#unit',
    '.github/workflows/pages.yml#deploy'].sort());
  for (const [file, job, version, digest] of all) {
    assert.deepEqual([version, digest], want, `${file} ${job}`);
  }
  const [knowledge, ...copies] = [installSteps('.github/workflows/ci.yml').at(-1),
    ...installSteps('.github/workflows/ci.yml').slice(0, -1),
    ...installSteps('.github/workflows/pages.yml'),
    ...installSteps('.github/workflows/main-checks.yml')];
  assert.ok(knowledge && copies.length === 4, 'the unit, deploy and main-checks copies exist');
  for (const step of copies) assert.equal(step, knowledge, 'byte-equal to the knowledge job\'s');
});
