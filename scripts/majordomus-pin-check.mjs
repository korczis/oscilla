#!/usr/bin/env node
// node scripts/majordomus-pin-check.mjs — the `majordomus` on PATH is the version CI pins.
//
// The git hooks and `npm run verify` run whatever `majordomus` the PATH resolves; the CI
// `knowledge` job runs the version pinned as MJ_VERSION in .github/workflows/ci.yml. When the
// two differ, the same .ai/ layer is judged by two tools: on 2026-10-03 a machine-wide install
// of 0.12.0 made the pre-commit doctor report 433 failures in a layer CI accepted, and blocked
// every session's commits until the layer was migrated (PR #64). This check makes the
// difference a refusal that names the procedure, before doctor runs (rule
// project.majordomus-layer-current). `npm run verify` runs it; tests/unit/majordomus-pin.test.mjs
// tests it on fixture versions.
//
//   node scripts/majordomus-pin-check.mjs                        compare PATH with ci.yml
//   node scripts/majordomus-pin-check.mjs --ci <file>            read the pin from another file
//   node scripts/majordomus-pin-check.mjs --local "majordomus X" use this as the tool's answer
//
// Exit 0 when they agree, 1 when they differ or either cannot be read.

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const VERSION = String.raw`\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?`;

/** The MJ_VERSION a workflow file pins, or null. */
export function pinnedVersion(workflowText) {
  const pin = new RegExp(String.raw`^\s*MJ_VERSION:\s*["']?(${VERSION})["']?\s*$`, 'm');
  const m = workflowText.match(pin);
  return m ? m[1] : null;
}

/** The version in the output of `majordomus version` ("majordomus 0.13.2"), or null. */
export function reportedVersion(output) {
  const m = String(output || '').trim()
    .match(new RegExp(String.raw`^majordomus (${VERSION})$`, 'm'));
  return m ? m[1] : null;
}

/** How a layer moves to another Majordomus version. Printed with every refusal. */
export const PROCEDURE = [
  'Migrating the .ai/ layer to another Majordomus version:',
  '  1. on a branch, run the NEW versioned binary directly',
  '     (~/.local/share/majordomus/versions/<new>/bin/majordomus) and migrate the layer until',
  '     `doctor` reports 0 failures under BOTH the pinned and the new version;',
  '  2. land that migration by pull request;',
  '  3. move MJ_VERSION and MJ_SHA256 in .github/workflows/ci.yml together, by pull request;',
  '  4. only then does the owner flip the machine-wide launcher (owner-only: it changes the',
  '     binary every session\'s git hooks run).',
  'Until step 4, run the pinned version: the launcher at ~/.local/bin/majordomus selects it.',
];

/** The lines to print when the versions disagree; an empty list when they agree. */
export function pinProblems({ pinned, local }) {
  if (!pinned) return ['no MJ_VERSION pin was found in the workflow file', ...PROCEDURE];
  if (!local) {
    return [`\`majordomus version\` gave no version (is majordomus on PATH?); CI pins ${pinned}`,
      ...PROCEDURE];
  }
  if (pinned === local) return [];
  return [
    `the majordomus on PATH is ${local}, and .github/workflows/ci.yml pins MJ_VERSION ${pinned}`,
    'the git hooks and `npm run verify` would judge the .ai/ layer with a different tool than CI',
    ...PROCEDURE,
  ];
}

export function main(argv = process.argv.slice(2)) {
  const opt = (name) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; };
  const ciFile = opt('--ci') || path.join(ROOT, '.github/workflows/ci.yml');
  const pinned = pinnedVersion(readFileSync(ciFile, 'utf8'));
  let answer = opt('--local');
  if (answer === undefined) {
    const r = spawnSync('majordomus', ['version'], { encoding: 'utf8' });
    answer = r.error ? '' : r.stdout;
  }
  const local = reportedVersion(answer);
  const problems = pinProblems({ pinned, local });
  if (problems.length === 0) {
    console.log(`majordomus ${local} on PATH is the version CI pins`);
    return 0;
  }
  console.error(problems.map((l) => `MAJORDOMUS PIN  ${l}`).join('\n'));
  return 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(main());
}
