// Every tracked YAML file of the project model (.ai/repo/project/: project.yaml, milestones,
// issues, intents, gaps, critiques) is YAML that a strict reader takes as written.
//
// `majordomus plan validate` accepted seven issue files that YAML 1.2 refuses: an unescaped
// double quote inside a double-quoted scalar (V314) and the escapes `\|` and `\.` inside
// double-quoted shell commands (V371, V382, V384, V385, V386, V433). Any other reader of the
// layer (a script, an agent, PyYAML) failed on them, so the "machine-readable" plan was
// readable by one tool only. The reader here is scripts/yaml-subset.mjs, the repository's own
// strict YAML reader (no parser dependency: package.json is a build input of dist/index.html).
// It throws on what it does not implement, so a file that passes means what YAML 1.2 means.
//
// Each record's identity is also its file name: `id` for milestones, issues and intents, and
// `intent` for gaps and critiques, which is how majordomus resolves them.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseYaml } from '../../scripts/yaml-subset.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const PLAN = '.ai/repo/project';

function trackedPlanYaml() {
  const out = execFileSync('git', ['ls-files', '-z', '--', PLAN], { cwd: ROOT, encoding: 'utf8' });
  return out.split('\0').filter((f) => /\.ya?ml$/.test(f)).sort();
}

const IDENTITY = { milestones: 'id', issues: 'id', intents: 'id', gaps: 'intent', critiques: 'intent' };

test('the project model has tracked YAML files to check', () => {
  const files = trackedPlanYaml();
  assert.ok(files.length > 100, `only ${files.length} YAML files under ${PLAN}`);
  for (const dir of Object.keys(IDENTITY)) {
    assert.ok(files.some((f) => f.startsWith(`${PLAN}/${dir}/`)), `no file under ${PLAN}/${dir}`);
  }
});

test('every tracked project-model YAML file parses strictly', () => {
  const failures = [];
  for (const file of trackedPlanYaml()) {
    try {
      const doc = parseYaml(readFileSync(join(ROOT, file), 'utf8'));
      assert.equal(typeof doc, 'object', `${file}: not a mapping`);
    } catch (err) {
      failures.push(`${file}: ${err.message}`);
    }
  }
  assert.deepEqual(failures, [], `files that are not strict YAML:\n${failures.join('\n')}`);
});

test("every milestone, issue, intent, gap and critique is named by its file's identity", () => {
  const wrong = [];
  for (const file of trackedPlanYaml()) {
    const dir = file.slice(PLAN.length + 1).split('/')[0];
    const key = IDENTITY[dir];
    if (!key) continue;
    let doc;
    try {
      doc = parseYaml(readFileSync(join(ROOT, file), 'utf8'));
    } catch {
      continue; // reported by the strict-parse test
    }
    const name = basename(file).replace(/\.ya?ml$/, '');
    if (!doc || doc[key] !== name) wrong.push(`${file}: ${key} is ${doc && doc[key]}`);
  }
  assert.deepEqual(wrong, []);
});

test('mutation: the reader refuses the two defects this test was written for', () => {
  // V314 as it was: an unescaped double quote ends the scalar early.
  assert.throws(() => parseYaml('objective: "a "Relative level, dBFS-like" b"\n'), /line 1/);
  // V371 and the others as they were: `\|` and `\.` are not YAML double-quoted escapes.
  assert.throws(() => parseYaml("cmd: \"grep -n 'a\\|b' f\"\n"), /unsupported escape/);
  assert.throws(() => parseYaml("cmd: \"grep -n 'nav\\.' f\"\n"), /unsupported escape/);
  // The repaired forms read as the text the authors meant.
  assert.equal(parseYaml("cmd: 'grep -n ''a\\|b'' f'\n").cmd, "grep -n 'a\\|b' f");
  assert.equal(parseYaml('objective: "a \\"Relative\\" b"\n').objective, 'a "Relative" b');
});
