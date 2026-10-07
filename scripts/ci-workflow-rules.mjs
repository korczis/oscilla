#!/usr/bin/env node
// project.ci-bounded: every CI job and network step is bounded, pinned and retried.
//
//   node scripts/ci-workflow-rules.mjs [--root <dir>]     # exit 1 and one line per violation
//
// Parses every .github/workflows/*.yml and every action.yml under .github/, reads every *.sh
// under .github/ and scripts/, and reports:
//   job-timeout      a job without a positive timeout-minutes
//   step-timeout     a step that installs, downloads or runs a browser suite without its own
//   install-wrapper  a browser or apt install outside .github/scripts/ci-install.sh
//   curl-flags       a curl without --retry and --connect-timeout (wget: --tries)
//   download-digest  a download not checked with `sha256sum -c` against a pinned digest
//   pipe-to-shell    a download that is executed: piped into an interpreter, substituted into
//                    a command ($(curl), <(curl), backticks) or in a step that uses eval
//   pinned           an action not pinned to a version tag or commit, an image without a tag
//   gate-needs       a `gate` job whose needs is not every other job of its workflow
//   non-fatal        continue-on-error on a job or a step, or `|| true` after an install or a
//                    browser suite: the job would report success whatever happened
//   triggers         ci.yml started by anything but pull_request (a manual run has no pull
//                    request, so fail-first and review-verdict would have nothing to check)
//
// Why each exists is in .ai/repo/rules/project/ci-bounded.v1.md. The unit test
// tests/unit/ci-workflows.test.mjs runs this on the repository and on mutated copies.

import { existsSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseYaml as parse } from './yaml-subset.mjs';

const INSTALL_WRAPPER = '.github/scripts/ci-install.sh';

/** A command word: at the start, or after whitespace, a separator, a quote or `$(`. */
const WORD = '(?:^|[\\s;&|(){}"\'`])';
const WORD_END = '(?=$|[\\s;&|(){}"\'`])';

/**
 * Installs that only the wrapper may run: it bounds and retries them. apt is matched as a
 * word whatever follows it, because `apt-get -o Acquire::Retries=3 install` and
 * `apt-get -t noble install` are the forms someone hardening a slow install writes.
 */
const BARE_INSTALL = [
  [/\bplaywright(@[\w.-]+)?\s+(-\S+\s+)*install(-deps)?\b/, 'playwright install'],
  [new RegExp(`${WORD}(apt|apt-get|aptitude)${WORD_END}`), 'apt'],
  [new RegExp(`${WORD}dpkg\\s+(\\S+\\s+)*?(-i|--install)${WORD_END}`), 'dpkg -i'],
];

/** `ci-install.sh apt <package>` names the wrapper's mode, not the program. */
const withoutWrapperCalls = (line) => line.replace(/ci-install\.sh\s+apt\b/g, 'ci-install.sh');

/** The bare installs of one shell text, by label. */
function bareInstalls(text) {
  const found = new Set();
  for (const line of logicalLines(text).map(withoutWrapperCalls)) {
    for (const [re, label] of BARE_INSTALL) if (re.test(line)) found.add(label);
  }
  return [...found];
}

/** Steps that reach the network without being a browser suite or an install. */
const NETWORK_COMMAND = [
  [/\bcurl\b/, 'curl'],
  [/\bwget\b/, 'wget'],
  [new RegExp(`${WORD}gh\\s+[a-z]`), 'gh'],
  [/verify-deploy/, 'verify-deploy'],
];

/** A browser suite started without an npm script: any use of these trees or programs. */
const BROWSER_PATH = new RegExp('\\btests/(browser|visual)\\b|\\bscripts/visual-'
  + '|\\bplaywright(@[\\w.-]+)?\\s+test\\b');

/** What a download may be piped into, or not: an interpreter runs it. */
const INTERPRETER = '(?:\\S*/)?(?:(?:ba|z|da|k|a|fi)?sh|python[\\d.]*|node|nodejs|deno|bun|perl'
  + '|ruby|php|pwsh|source|\\.)';
const PIPE_TO_INTERPRETER = new RegExp(
  `\\|&?\\s*(?:sudo\\s+)?(?:-\\S+\\s+)*(?:env\\s+)?(?:\\w+=\\S*\\s+)*${INTERPRETER}${WORD_END}`);
const SUBSTITUTED = /(\$\(|<\(|`)\s*(sudo\s+)?(curl|wget)\b/;
const EVAL = new RegExp(`${WORD}eval${WORD_END}`);
const DISCARDED = new RegExp('(^|\\s)(-[A-Za-z]*[oO]\\s*|--output(-document)?[= ]\\s*|>\\s*)'
  + '/dev/null\\b|\\s--spider\\b');
const NON_FATAL = /\|\|\s*(true|:)(?=$|[\s;|&)])/;

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
  for (const label of bareInstalls(run)) return `runs ${label}`;
  for (const [re, label] of NETWORK_COMMAND) {
    if (re.test(run)) return `reaches the network (${label})`;
  }
  for (const m of run.matchAll(/\bnpm (?:run|run-script) ([\w:.-]+)/g)) {
    if (suites.has(m[1])) return `runs the browser suite ${m[1]}`;
  }
  if (BROWSER_PATH.test(run)) return 'runs a browser suite';
  return null;
}

/** Whether one logical line installs or runs a browser suite (what `|| true` must not follow). */
function fatalLine(line, suites) {
  return stepNeedsTimeout(line, suites) !== null && !/^\s*(echo|printf)\b/.test(line);
}

/** `continue-on-error` set to anything but false. */
function continues(node) {
  const v = node && node['continue-on-error'];
  return v !== undefined && v !== null && v !== false && v !== 'false';
}

function positive(n) {
  return typeof n === 'number' && Number.isFinite(n) && n > 0;
}

/** Violations of the curl / wget / digest rules in one shell text. */
function shellViolations(text, digestScope) {
  const out = [];
  const lines = logicalLines(text);
  const hasEval = lines.some((l) => EVAL.test(l));
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
    if (PIPE_TO_INTERPRETER.test(line)) {
      out.push(['pipe-to-shell', `a download piped into an interpreter: ${line}`]);
      continue;
    }
    if (SUBSTITUTED.test(line)) {
      out.push(['pipe-to-shell', 'a download substituted into a command, where nothing can'
        + ` check it: ${line}`]);
      continue;
    }
    if (hasEval) {
      out.push(['pipe-to-shell', `a download in a step that uses eval: ${line}`]);
      continue;
    }
    // Everything else keeps what it fetched (a file, a redirect, a pipe, the log), unless it
    // says it does not.
    if (DISCARDED.test(line) && !/\|/.test(line.replace(/\|\|/g, ''))) continue;
    if (!DIGEST_CHECK.test(text)) {
      out.push(['download-digest',
        `a download with no \`sha256sum -c\` in the same step: ${line}`]);
    } else if (!DIGEST.test(digestScope)) {
      out.push(['download-digest',
        `a download checked against no pinned 64-hex digest: ${line}`]);
    }
  }
  return out;
}

/** The violations of one step (of a job or of a composite action), as [rule, message]. */
function stepViolations(step, suites, envScope) {
  const out = [];
  if (typeof step.uses === 'string' && !step.uses.startsWith('./')
    && !PINNED_ACTION.test(step.uses)) {
    out.push(['pinned', `action not pinned to a version tag or commit: ${step.uses}`]);
  }
  if (continues(step)) {
    out.push(['non-fatal', 'continue-on-error: the job succeeds when this step fails']);
  }
  if (typeof step.run !== 'string') return out;
  for (const what of bareInstalls(step.run)) {
    out.push(['install-wrapper',
      `${what} outside ${INSTALL_WRAPPER}, which bounds and retries it`]);
  }
  for (const line of logicalLines(step.run)) {
    if (NON_FATAL.test(line) && fatalLine(line, suites)) {
      out.push(['non-fatal',
        `\`|| true\` after an install, a download or a browser suite: ${line}`]);
    }
  }
  const scope = `${envScope}\n${JSON.stringify(step.env || {})}\n${step.run}`;
  out.push(...shellViolations(step.run, scope));
  return out;
}

const stepLabel = (step, i) => step.name || step.id || step.uses || `step ${i + 1}`;

/** The directory of a local action a step uses (`./.github/actions/x`), or null. */
function localAction(uses) {
  if (typeof uses !== 'string' || !uses.startsWith('./')) return null;
  return path.posix.normalize(uses.replace(/@.*$/, '')).replace(/\/$/, '');
}

/**
 * Every violation in one workflow.
 * @param {string} file the name reported
 * @param {string} text the workflow's YAML
 * @param {Set<string>} suites npm scripts that run a browser
 * @param {Map<string, string>} [actions] local action directory -> why a step using it must
 *   carry timeout-minutes (from actionNeedsTimeout)
 */
export function checkWorkflow(file, text, suites, actions = new Map()) {
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
    const reusable = typeof job.uses === 'string';
    // GitHub refuses timeout-minutes on a job that calls a reusable workflow: the limits are
    // the called workflow's jobs', and a local one is checked as a workflow file itself.
    if (!reusable && !positive(job['timeout-minutes'])) {
      add('job-timeout', name, null, 'the job declares no positive timeout-minutes');
    }
    if (reusable && !job.uses.startsWith('./') && !PINNED_ACTION.test(job.uses)) {
      add('pinned', name, null, `reusable workflow not pinned to a version or commit: ${job.uses}`);
    }
    if (continues(job)) {
      add('non-fatal', name, null, 'continue-on-error: the job reports success when it fails');
    }
    const image = typeof job.container === 'string' ? job.container : job.container?.image;
    const tagged = /@sha256:[0-9a-f]{64}$/.test(String(image))
      || (/:[^:/@]+$/.test(String(image)) && !/:latest$/.test(String(image)));
    if (image !== undefined && !tagged) {
      add('pinned', name, null, `container image without a version tag or digest: ${image}`);
    }
    const jobEnv = JSON.stringify([doc.env || {}, job.env || {}]);
    (job.steps || []).forEach((step, i) => {
      const label = stepLabel(step, i);
      for (const [rule, message] of stepViolations(step, suites, jobEnv)) {
        add(rule, name, label, message);
      }
      const why = typeof step.run === 'string'
        ? stepNeedsTimeout(logicalLines(step.run).join('\n'), suites)
        : actions.get(localAction(step.uses));
      if (why && !positive(step['timeout-minutes'])) {
        add('step-timeout', name, label, `the step ${why} and declares no timeout-minutes`);
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
    // The gate is the required check, and two of its jobs judge the pull request itself. A run
    // without a pull request (a manual dispatch on the PR's branch) would give them nothing to
    // judge and still put a green `gate` on the same commit.
    const { on } = doc;
    const triggers = typeof on === 'string' ? [on]
      : Array.isArray(on) ? on.map(String) : Object.keys(on || {});
    if (triggers.length !== 1 || triggers[0] !== 'pull_request') {
      add('triggers', null, null, 'a workflow with a gate job is started by pull_request only,'
        + ` not by: ${triggers.join(', ') || '(nothing)'}`);
    }
  }
  return out;
}

/** The steps of a composite action's YAML ([] for any other kind of action). */
function actionSteps(text) {
  const doc = parse(text);
  return (doc && doc.runs && Array.isArray(doc.runs.steps)) ? doc.runs.steps : [];
}

/** Why a step that uses this composite action must carry timeout-minutes, or null. */
export function actionNeedsTimeout(text, suites) {
  let steps;
  try {
    steps = actionSteps(text);
  } catch {
    return null;
  }
  for (const step of steps) {
    if (typeof step.run !== 'string') continue;
    const why = stepNeedsTimeout(logicalLines(step.run).join('\n'), suites);
    if (why) return `uses an action that ${why}`;
  }
  return null;
}

/** Violations in a composite action: its steps obey the step rules of a workflow. */
export function checkAction(file, text, suites) {
  const out = [];
  let steps;
  try {
    steps = actionSteps(text);
  } catch (e) {
    return [{ file, job: null, step: null, rule: 'parse',
      message: `not valid YAML: ${e.message}` }];
  }
  steps.forEach((step, i) => {
    for (const [rule, message] of stepViolations(step, suites, '')) {
      out.push({ file, job: null, step: stepLabel(step, i), rule, message });
    }
  });
  return out;
}

/** Violations in a shell script (under .github/ or scripts/). */
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
    for (const what of bareInstalls(text)) {
      add('install-wrapper', `${what} outside ${INSTALL_WRAPPER}`);
    }
  }
  for (const [rule, message] of shellViolations(text, text)) add(rule, message);
  return out;
}

/** Files under <root>/<dir> (recursive, sorted, as root-relative posix paths) that match. */
function filesUnder(root, dir, match) {
  const abs = path.join(root, dir);
  if (!existsSync(abs)) return [];
  return readdirSync(abs, { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile())
    .map((e) => path.relative(root, path.join(e.parentPath ?? e.path, e.name))
      .split(path.sep).join('/'))
    .filter((f) => match.test(f))
    .sort();
}

/**
 * Every violation under <root>: the workflows and composite actions of .github, and every
 * shell script under .github/ and scripts/; <root>/package.json names the browser suites.
 */
export function checkRepository(root) {
  const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
  const suites = browserSuites(pkg);
  const read = (rel) => readFileSync(path.join(root, rel), 'utf8');
  const out = [];
  const actions = new Map();
  for (const rel of filesUnder(root, '.github', /(^|\/)action\.ya?ml$/)) {
    const text = read(rel);
    out.push(...checkAction(rel, text, suites));
    const why = actionNeedsTimeout(text, suites);
    if (why) actions.set(path.posix.dirname(rel), why);
  }
  const workflows = filesUnder(root, '.github/workflows', /\.ya?ml$/);
  if (!workflows.length) {
    out.push({ file: '.github/workflows', job: null, step: null, rule: 'parse',
      message: 'no workflow files' });
  }
  for (const rel of workflows) out.push(...checkWorkflow(rel, read(rel), suites, actions));
  const scripts = [...filesUnder(root, '.github', /\.sh$/),
    ...filesUnder(root, 'scripts', /\.sh$/)];
  for (const rel of scripts) out.push(...checkScript(rel, read(rel)));
  const usesWrapper = workflows.some((rel) => read(rel).includes('ci-install.sh'));
  if (usesWrapper && !scripts.includes(INSTALL_WRAPPER)) {
    out.push({ file: INSTALL_WRAPPER, job: null, step: null, rule: 'install-wrapper',
      message: 'missing' });
  }
  return out;
}

export function format(v) {
  const where = [v.file, v.job && `job ${v.job}`, v.step && `step "${v.step}"`].filter(Boolean);
  return `${v.rule}: ${where.join(', ')}: ${v.message}`;
}

// (real paths: started through a symlink, the program must still know it is the one run,
// or it would do nothing and exit 0)
const isMain = process.argv[1] && existsSync(process.argv[1])
  && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
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
