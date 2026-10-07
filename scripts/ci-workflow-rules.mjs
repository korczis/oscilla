#!/usr/bin/env node
// project.ci-bounded: every CI job and network step is bounded, pinned and retried.
//
//   node scripts/ci-workflow-rules.mjs [--root <dir>]     # exit 1 and one line per violation
//
// Parses every .github/workflows/*.yml (and reads .github/scripts/*.sh) and reports:
//   job-timeout      a job without a positive timeout-minutes
//   step-timeout     a step that installs, downloads or runs a browser suite without its own
//   install-wrapper  a browser or apt install outside .github/scripts/ci-install.sh
//   curl-flags       a curl without --retry and --connect-timeout (wget: --tries)
//   download-digest  a downloaded file not checked with `sha256sum -c` against a pinned digest
//   pipe-to-shell    a download piped into a shell
//   pinned           an action not pinned to a version tag or commit, an image without a tag
//   gate-needs       a `gate` job whose needs is not every other job of its workflow
//
// Why each exists is in .ai/repo/rules/project/ci-bounded.v1.md. The unit test
// tests/unit/ci-workflows.test.mjs runs this on the repository and on mutated copies.

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseYaml as parse } from './yaml-subset.mjs';

const INSTALL_WRAPPER = '.github/scripts/ci-install.sh';

/** Installs that only the wrapper may run: it bounds and retries them. */
const BARE_INSTALL = [
  [/\bplaywright\s+install(-deps)?\b/, 'playwright install'],
  [/\bapt(-get)?\s+(-\S+\s+)*(install|update|upgrade|dist-upgrade)\b/, 'apt'],
  [/\bdpkg\s+(-\S+\s+)*(-i|--install)\b/, 'dpkg -i'],
];

/** Steps that reach the network without being a browser suite or an install. */
const NETWORK_COMMAND = [
  [/\bcurl\b/, 'curl'],
  [/\bwget\b/, 'wget'],
  [/\bgh\s+(api|pr|release|run|workflow|issue)\b/, 'gh'],
  [/verify-deploy/, 'verify-deploy'],
];

const DIGEST_CHECK = /\bsha256sum\s+(-c|--check)\b|\bshasum\s+-a\s*256\s+(-c|--check)\b/;
const DIGEST = /\b[0-9a-f]{64}\b/;
const PINNED_ACTION = /@(v\d+(\.\d+){0,2}|[0-9a-f]{40})$/;

/** Shell text as logical lines: continuations joined, comments and blank lines dropped. */
export function logicalLines(text) {
  return String(text).replace(/\\\r?\n/g, ' ').split(/\r?\n/)
    .map((l) => l.replace(/(^|\s)#.*$/, '').trim())
    .filter(Boolean);
}

/**
 * The npm scripts that run a browser: those whose command, with `npm run <x>` expanded,
 * starts a file of tests/browser/ or a scripts/visual-* program.
 */
export function browserSuites(pkg) {
  const scripts = pkg.scripts || {};
  const direct = (cmd) => /\btests\/browser\/|\bscripts\/visual-/.test(cmd);
  const memo = new Map();
  const runs = (name, seen = new Set()) => {
    if (memo.has(name)) return memo.get(name);
    if (seen.has(name) || !(name in scripts)) return false;
    seen.add(name);
    const cmd = scripts[name];
    const called = [...cmd.matchAll(/\bnpm run ([\w:.-]+)/g)].map((m) => m[1]);
    const result = direct(cmd) || called.some((c) => runs(c, seen));
    memo.set(name, result);
    return result;
  };
  return new Set(Object.keys(scripts).filter((n) => runs(n)));
}

/** Why a step must carry its own timeout-minutes, or null. */
export function stepNeedsTimeout(run, suites) {
  if (run.includes('ci-install.sh')) return 'installs through ci-install.sh';
  for (const [re, label] of BARE_INSTALL) if (re.test(run)) return `runs ${label}`;
  for (const [re, label] of NETWORK_COMMAND) {
    if (re.test(run)) return `reaches the network (${label})`;
  }
  for (const m of run.matchAll(/\bnpm (?:run|run-script) ([\w:.-]+)/g)) {
    if (suites.has(m[1])) return `runs the browser suite ${m[1]}`;
  }
  if (/\bnode\s+tests\/browser\/|\bnode\s+scripts\/visual-/.test(run)) {
    return 'runs a browser suite';
  }
  return null;
}

function positive(n) {
  return typeof n === 'number' && Number.isFinite(n) && n > 0;
}

/** Violations of the curl / wget / digest rules in one shell text. */
function shellViolations(text, digestScope) {
  const out = [];
  const lines = logicalLines(text);
  for (const line of lines) {
    const isCurl = /\bcurl\b/.test(line);
    const isWget = /\bwget\b/.test(line);
    if (!isCurl && !isWget) continue;
    if (isCurl) {
      const missing = [];
      if (!/--retry\s+\d+/.test(line)) missing.push('--retry <n>');
      if (!/--connect-timeout\s+\d+/.test(line)) missing.push('--connect-timeout <s>');
      if (missing.length) {
        out.push(['curl-flags', `curl without ${missing.join(' and ')}: ${line}`]);
      }
    }
    if (isWget) {
      const missing = [];
      if (!/(--tries[= ]\d+|(^|\s)-t\s*\d+)/.test(line)) missing.push('--tries <n>');
      if (!/--connect-timeout[= ]\d+/.test(line)) missing.push('--connect-timeout <s>');
      if (missing.length) {
        out.push(['curl-flags', `wget without ${missing.join(' and ')}: ${line}`]);
      }
    }
    if (/\|\s*(sudo\s+)?(-\S+\s+)*(ba|z|da)?sh\b/.test(line)) {
      out.push(['pipe-to-shell', `a download piped into a shell: ${line}`]);
      continue;
    }
    const toFile = isWget
      || /(^|\s)-[A-Za-z]*[oO](\s|$)|--output\b|--remote-name\b/.test(line)
      || /\|\s*(sudo\s+)?(tar|unzip|gunzip|bsdtar)\b/.test(line);
    if (toFile) {
      if (!DIGEST_CHECK.test(text)) {
        out.push(['download-digest',
          `a download with no \`sha256sum -c\` in the same step: ${line}`]);
      } else if (!DIGEST.test(digestScope)) {
        out.push(['download-digest',
          `a download checked against no pinned 64-hex digest: ${line}`]);
      }
    }
  }
  return out;
}

/**
 * Every violation in one workflow.
 * @param {string} file the name reported
 * @param {string} text the workflow's YAML
 * @param {Set<string>} suites npm scripts that run a browser
 */
export function checkWorkflow(file, text, suites) {
  const out = [];
  const add = (rule, job, step, message) => out.push({ file, job, step, rule, message });
  let doc;
  try {
    doc = parse(text);
  } catch (e) {
    add('parse', null, null, `not valid YAML: ${e.message}`);
    return out;
  }
  const jobs = (doc && doc.jobs) || {};
  const names = Object.keys(jobs);
  if (!names.length) add('parse', null, null, 'no jobs');
  for (const name of names) {
    const job = jobs[name] || {};
    if (!positive(job['timeout-minutes'])) {
      add('job-timeout', name, null, 'the job declares no positive timeout-minutes');
    }
    if (typeof job.uses === 'string' && !job.uses.startsWith('./')
      && !PINNED_ACTION.test(job.uses)) {
      add('pinned', name, null, `reusable workflow not pinned to a version or commit: ${job.uses}`);
    }
    const image = typeof job.container === 'string' ? job.container : job.container?.image;
    const tagged = /@sha256:[0-9a-f]{64}$/.test(String(image))
      || (/:[^:/@]+$/.test(String(image)) && !/:latest$/.test(String(image)));
    if (image !== undefined && !tagged) {
      add('pinned', name, null, `container image without a version tag or digest: ${image}`);
    }
    const jobEnv = JSON.stringify([doc.env || {}, job.env || {}]);
    (job.steps || []).forEach((step, i) => {
      const label = step.name || step.id || step.uses || `step ${i + 1}`;
      if (typeof step.uses === 'string' && !step.uses.startsWith('./')
        && !PINNED_ACTION.test(step.uses)) {
        add('pinned', name, label, `action not pinned to a version tag or commit: ${step.uses}`);
      }
      if (typeof step.run !== 'string') return;
      const run = logicalLines(step.run).join('\n');
      for (const [re, what] of BARE_INSTALL) {
        if (re.test(run)) {
          add('install-wrapper', name, label,
            `${what} outside ${INSTALL_WRAPPER}, which bounds and retries it`);
        }
      }
      const why = stepNeedsTimeout(run, suites);
      if (why && !positive(step['timeout-minutes'])) {
        add('step-timeout', name, label, `the step ${why} and declares no timeout-minutes`);
      }
      const scope = `${jobEnv}\n${JSON.stringify(step.env || {})}\n${step.run}`;
      for (const [rule, message] of shellViolations(step.run, scope)) {
        add(rule, name, label, message);
      }
    });
  }
  if ('gate' in jobs) {
    const gate = jobs.gate || {};
    const needs = new Set([].concat(gate.needs || []));
    const missing = names.filter((n) => n !== 'gate' && !needs.has(n));
    if (missing.length) {
      add('gate-needs', 'gate', null, `gate.needs does not list: ${missing.join(', ')}`);
    }
    if (String(gate.if || '').replace(/\s/g, '') !== 'always()') {
      add('gate-needs', 'gate', null, 'gate must run with `if: always()` to report a failed job');
    }
  }
  return out;
}

/** Violations in a helper script under .github/scripts/. */
export function checkScript(file, text) {
  const out = [];
  const add = (rule, message) => out.push({ file, job: null, step: null, rule, message });
  const isWrapper = file.endsWith(INSTALL_WRAPPER) || file === path.basename(INSTALL_WRAPPER);
  const body = logicalLines(text).join('\n');
  if (isWrapper) {
    // The wrapper is what bounds an install, so it must keep doing so.
    if (!/\btimeout\s+--kill-after/.test(body)) {
      add('install-wrapper', 'no `timeout --kill-after` bound');
    }
    if (!/\battempt_twice\b/.test(body)) add('install-wrapper', 'no retry (attempt_twice)');
  } else {
    for (const [re, what] of BARE_INSTALL) {
      if (re.test(body)) add('install-wrapper', `${what} outside ${INSTALL_WRAPPER}`);
    }
  }
  for (const [rule, message] of shellViolations(text, text)) add(rule, message);
  return out;
}

/** Every violation under <root>/.github, with <root>/package.json naming the browser suites. */
export function checkRepository(root) {
  const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
  const suites = browserSuites(pkg);
  const out = [];
  const wfDir = path.join(root, '.github', 'workflows');
  const workflows = existsSync(wfDir)
    ? readdirSync(wfDir).filter((f) => /\.ya?ml$/.test(f)).sort() : [];
  if (!workflows.length) {
    out.push({ file: '.github/workflows', job: null, step: null, rule: 'parse',
      message: 'no workflow files' });
  }
  for (const f of workflows) {
    const rel = `.github/workflows/${f}`;
    out.push(...checkWorkflow(rel, readFileSync(path.join(wfDir, f), 'utf8'), suites));
  }
  const shDir = path.join(root, '.github', 'scripts');
  const scripts = existsSync(shDir)
    ? readdirSync(shDir).filter((f) => f.endsWith('.sh')).sort() : [];
  for (const f of scripts) {
    out.push(...checkScript(`.github/scripts/${f}`, readFileSync(path.join(shDir, f), 'utf8')));
  }
  const usesWrapper = workflows.some((f) => readFileSync(path.join(wfDir, f), 'utf8')
    .includes('ci-install.sh'));
  if (usesWrapper && !scripts.includes('ci-install.sh')) {
    out.push({ file: INSTALL_WRAPPER, job: null, step: null, rule: 'install-wrapper',
      message: 'missing' });
  }
  return out;
}

export function format(v) {
  const where = [v.file, v.job && `job ${v.job}`, v.step && `step "${v.step}"`].filter(Boolean);
  return `${v.rule}: ${where.join(', ')}: ${v.message}`;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const i = process.argv.indexOf('--root');
  const root = i > 0 ? path.resolve(process.argv[i + 1])
    : path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const found = checkRepository(root);
  for (const v of found) console.error(format(v));
  if (found.length) {
    console.error(`project.ci-bounded: ${found.length} violation(s)`);
    process.exit(1);
  }
  console.log('project.ci-bounded: every job and network step is bounded, pinned and retried');
}
