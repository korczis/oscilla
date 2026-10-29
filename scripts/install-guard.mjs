#!/usr/bin/env node
// What `npm ci --ignore-scripts` would run or fetch of a pull request, refused before it runs.
//
//   node scripts/install-guard.mjs [--repo <dir>]     # exit 1 and one line per refusal
//
// The fail-first job installs the pull request's packages before its judge runs the PR's
// tests, and --ignore-scripts turns off lifecycle scripts only: npm still clones a git
// dependency and runs its `prepare` (review of #255, R17), and still spawns the helper
// programs a project .npmrc names, `git=./evil.sh` among them (R18). Either can rewrite the
// judge or write $GITHUB_ENV and $GITHUB_PATH for the steps after it. package.json, the
// lockfile and .npmrc are not guarded paths, so this program reads them as the pull request
// left them, from the copy of the base commit the job extracted before anything of the pull
// request ran, and refuses:
//   lockfile   no package-lock.json (or npm-shrinkwrap.json), a lockfileVersion below 2, an
//              entry whose `resolved` is not a tarball of https://registry.npmjs.org/ (git,
//              file, http, another host, none), one without a sha512 `integrity`, a link
//              (`link: true`, a directory of the checkout) or a bundled entry (`inBundle`)
//   manifest   a package.json with bundleDependencies / bundledDependencies (a bundled
//              dependency has no lockfile entry) or workspaces (packages of the checkout), a
//              dependency or an `overrides` value, nested ones included, that names git,
//              file, link, http(s), a github:/gitlab:/bitbucket:/gist: or owner/repo shorthand
//              or a path
//   npmrc      a .npmrc anywhere in the checkout with a key outside NPMRC_KEYS: helper
//              programs (git, script-shell, shell, node-options, onload-script, ...), other
//              registries (registry, @scope:registry, replace-registry-host), strict-ssl=false
//              and every key not listed; ignore-scripts other than true
// So nothing is resolved outside the registry, and what comes from it is checked against the
// lockfile's sha512: the guard trusts the registry and those hashes (esbuild's platform
// binary is such a package). Tested by tests/unit/install-guard.test.mjs and the replay of
// the judge jobs in tests/unit/base-rule.test.mjs.
//
// Exit 0: nothing refused. Exit 1: refused. Exit 2: usage.

import { existsSync, lstatSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const REGISTRY = 'https://registry.npmjs.org/';
const INTEGRITY = /^sha512-[A-Za-z0-9+/]{86}==$/;
const OTHER_SOURCE = new RegExp('^(?:git\\+|git:|github:|gitlab:|bitbucket:|gist:|file:|link:'
  + '|https?:|ssh:|workspace:|portal:|patch:)', 'i');
const DEPENDENCY_FIELDS = ['dependencies', 'devDependencies', 'optionalDependencies',
  'peerDependencies'];
/**
 * The keys a project .npmrc may set: none of them makes npm run a program, fetch from
 * another host or skip a check. Compared after lower-casing and `_` to `-`.
 */
export const NPMRC_KEYS = new Set(['audit', 'audit-level', 'color', 'engine-strict', 'fund',
  'ignore-scripts', 'legacy-peer-deps', 'loglevel', 'package-lock', 'prefer-offline',
  'progress', 'save', 'save-exact', 'save-prefix', 'strict-peer-deps', 'update-notifier']);

/**
 * Why a dependency spec (or an overrides value) is not a registry version, or null. Registry
 * forms: a version, a range, a tag, `npm:<name>@<range>`, an overrides reference `$<name>`.
 */
export function nonRegistrySpec(spec) {
  const s = String(spec).trim();
  if (/^npm:/i.test(s)) {
    const rest = s.slice(4).replace(/^@?[^@]+@?/, '');
    return rest ? nonRegistrySpec(rest) : null;
  }
  if (/^\$[\w@/.-]+$/.test(s)) return null;
  if (OTHER_SOURCE.test(s)) return `names ${s.split(':')[0]}:, not the registry`;
  if (s.includes('://')) return 'is a URL, not the registry';
  if (/^(?:\.{1,2}(?:\/|$)|\/|~\/)/.test(s) || /^[A-Za-z]:[\\/]/.test(s)) {
    return 'is a path of the checkout';
  }
  if (/^[^@\s/<>=~^|][^\s/]*\/[^\s/]+$/.test(s)) return 'is an owner/repo shorthand (GitHub)';
  return null;
}

/** The refusals of a lockfile's text (`name` the file's). */
export function lockfileProblems(text, name = 'package-lock.json') {
  let lock;
  try {
    lock = JSON.parse(text);
  } catch (e) {
    return [`${name}: not JSON (${e.message})`];
  }
  if (!lock || typeof lock !== 'object') return [`${name}: not a lockfile`];
  if (!(Number(lock.lockfileVersion) >= 2) || !lock.packages || typeof lock.packages !== 'object') {
    return [`${name}: lockfileVersion ${lock.lockfileVersion} has no packages map (2 or 3 needed)`];
  }
  const out = [];
  for (const [key, entry] of Object.entries(lock.packages)) {
    if (key === '') continue;
    const at = `${name}: ${key}`;
    if (!entry || typeof entry !== 'object') {
      out.push(`${at} is no entry`);
      continue;
    }
    if (entry.link) {
      out.push(`${at} links ${entry.resolved ?? 'a directory'} of the checkout (link: true)`);
      continue;
    }
    if (entry.inBundle) out.push(`${at} is bundled (inBundle): no tarball of its own is checked`);
    const resolved = typeof entry.resolved === 'string' ? entry.resolved : '';
    if (!resolved.startsWith(REGISTRY) || !/\.tgz$/.test(new URL(resolved, REGISTRY).pathname)) {
      out.push(`${at} resolves to ${resolved || '(nothing)'}, not a tarball of ${REGISTRY}`);
    } else if (new URL(resolved).host !== 'registry.npmjs.org') {
      out.push(`${at} resolves to ${resolved}, not ${REGISTRY}`);
    }
    const integrity = String(entry.integrity ?? '').trim().split(/\s+/).filter(Boolean);
    if (!integrity.length || !integrity.every((h) => INTEGRITY.test(h))) {
      out.push(`${at} has ${integrity.length ? `integrity ${entry.integrity}` : 'no integrity'},`
        + ' not a sha512 the download is checked against');
    }
  }
  return out;
}

/** The refusals of a package.json's text (`name` the file's). */
export function manifestProblems(text, name = 'package.json') {
  let pkg;
  try {
    pkg = JSON.parse(text);
  } catch (e) {
    return [`${name}: not JSON (${e.message})`];
  }
  if (!pkg || typeof pkg !== 'object') return [`${name}: not a manifest`];
  const out = [];
  for (const k of ['bundleDependencies', 'bundledDependencies']) {
    if (k in pkg) out.push(`${name}: ${k} (a bundled dependency has no lockfile entry)`);
  }
  if ('workspaces' in pkg) out.push(`${name}: workspaces (packages installed from the checkout)`);
  for (const field of DEPENDENCY_FIELDS) {
    for (const [dep, spec] of Object.entries(pkg[field] || {})) {
      const why = nonRegistrySpec(spec);
      if (why) out.push(`${name}: ${field}.${dep} = ${JSON.stringify(spec)} ${why}`);
    }
  }
  const walk = (value, at) => {
    if (typeof value === 'string') {
      const why = nonRegistrySpec(value);
      if (why) out.push(`${name}: ${at} = ${JSON.stringify(value)} ${why}`);
    } else if (value && typeof value === 'object') {
      for (const [k, v] of Object.entries(value)) {
        // a key may carry a spec too (`"foo@github:x/y": "1"`)
        const keySpec = /^@?[^@]+@(.+)$/.exec(k);
        if (keySpec && nonRegistrySpec(keySpec[1])) {
          out.push(`${name}: ${at} key ${JSON.stringify(k)} ${nonRegistrySpec(keySpec[1])}`);
        }
        walk(v, `${at}.${k}`);
      }
    } else if (value !== undefined && value !== null) {
      out.push(`${name}: ${at} = ${JSON.stringify(value)} is not a version`);
    }
  };
  if ('overrides' in pkg) walk(pkg.overrides, 'overrides');
  return out;
}

/** The refusals of an .npmrc's text (`name` the file's). */
export function npmrcProblems(text, name = '.npmrc') {
  const out = [];
  String(text).split(/\r?\n/).forEach((raw, i) => {
    const line = raw.trim();
    if (!line || /^[;#]/.test(line)) return;
    const at = `${name}:${i + 1}`;
    if (/^\[.*\]$/.test(line)) {
      out.push(`${at}: a section ${line} (npm reads its keys too)`);
      return;
    }
    const eq = line.indexOf('=');
    const unquote = (s) => s.trim().replace(/^(["'])(.*)\1$/, '$2').trim();
    const key = unquote(eq < 0 ? line : line.slice(0, eq)).replace(/\[\]$/, '');
    const value = eq < 0 ? 'true' : unquote(line.slice(eq + 1));
    const norm = key.toLowerCase().replace(/_/g, '-');
    if (!NPMRC_KEYS.has(norm)) {
      const what = /(^|:)registry$/.test(norm) || norm === 'replace-registry-host'
        ? 'names another registry' : norm === 'strict-ssl' ? 'turns a TLS check off or on'
          : /^(git|script-shell|shell|node-options|onload-script|editor|browser|viewer)$/.test(norm)
            ? 'names a program npm runs' : 'is not one the guard knows to be harmless';
      out.push(`${at}: ${key} ${what} (allowed: ${[...NPMRC_KEYS].join(', ')})`);
    } else if (norm === 'ignore-scripts' && value.toLowerCase() !== 'true') {
      out.push(`${at}: ignore-scripts=${value} would run lifecycle scripts`);
    }
  });
  return out;
}

/** Every .npmrc of the checkout, outside .git and node_modules, relative to `repo`. */
function npmrcFiles(repo) {
  const found = [];
  const walk = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.name === '.git' || e.name === 'node_modules') continue;
      const p = path.join(dir, e.name);
      if (e.name === '.npmrc') found.push(p);
      else if (e.isDirectory() && !lstatSync(p).isSymbolicLink()) walk(p);
    }
  };
  walk(repo);
  return found.map((p) => path.relative(repo, p)).sort();
}

/** Every refusal for the checkout at `repo`. */
export function guard(repo) {
  const out = [];
  const read = (rel) => readFileSync(path.join(repo, rel), 'utf8');
  const locks = ['npm-shrinkwrap.json', 'package-lock.json']
    .filter((f) => existsSync(path.join(repo, f)));
  if (!locks.length) out.push('no package-lock.json: npm ci would have nothing to check');
  for (const f of locks) out.push(...lockfileProblems(read(f), f));
  if (existsSync(path.join(repo, 'package.json'))) {
    out.push(...manifestProblems(read('package.json')));
  } else {
    out.push('no package.json');
  }
  for (const f of npmrcFiles(repo)) {
    const stat = lstatSync(path.join(repo, f));
    if (stat.isSymbolicLink()) out.push(`${f}: a symbolic link (npm reads where it points)`);
    else out.push(...npmrcProblems(read(f), f));
  }
  return out;
}

const isMain = process.argv[1] && existsSync(process.argv[1])
  && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
if (isMain) {
  const argv = process.argv.slice(2);
  let repo = process.cwd();
  while (argv.length) {
    const a = argv.shift();
    if (a === '--repo' && argv.length) repo = path.resolve(argv.shift());
    else {
      console.error(`install-guard: unknown argument ${a}`);
      console.error('usage: node scripts/install-guard.mjs [--repo <dir>]');
      process.exit(2);
    }
  }
  const problems = guard(repo);
  for (const p of problems) console.log(`::error::install-guard: ${p}`);
  if (problems.length) {
    console.log(`install-guard: REFUSED, ${problems.length} problem(s): npm ci would run or`
      + ' fetch something of the pull request outside the registry');
    process.exit(1);
  }
  console.log('install-guard: the install fetches only registry tarballs checked by sha512,'
    + ' and no .npmrc names a program');
}
