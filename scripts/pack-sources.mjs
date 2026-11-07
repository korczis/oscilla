#!/usr/bin/env node
// node scripts/pack-sources.mjs [--out <dir>] [--help] — the source pack for an LLM project
// (the owner's ChatGPT project "Oscilla"; there is no npm script: package.json is a build input).
//
//   --out <dir>  where to write the pack; default ~/Downloads/oscilla-sources-v<version>-<sha>.
//                The directory is replaced, so it must be empty, missing, or an earlier pack
//                (one holding a 00-INDEX.md)
//   --help / -h  prints this usage and exits 0; an unknown flag or a flag missing its value
//                exits 2 before git is asked anything
//
// The pack is made from the files git tracks at HEAD, never from the working tree's edits:
//   00-INDEX.md       what each file holds, the last 80 commits, every tracked file and its size
//   01..11-*.md       the tracked text files concatenated by area (BUNDLES, first match wins;
//                     tests/unit split in two halves so no bundle grows past what a chat model
//                     ingests); 12-other.md only when a tracked file matches no area
//   oscilla-v<version>-<sha>-src.zip   `git archive` of HEAD without dist/ and the lockfile
// Left out of the Markdown (still in the zip): dist/, package-lock.json, tests/freeze/ golden
// data, and binary files (any file holding a NUL byte).
//
// planBundles() and renderBundle() are pure; tests/unit/pack-sources.test.mjs proves that every
// tracked file lands in exactly one bundle or one stated exclusion.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Paths never concatenated into Markdown; each is still in the zip unless ZIP_EXCLUDE says not. */
export const MARKDOWN_EXCLUDE = ['dist/', 'package-lock.json', 'tests/freeze/'];
/** Paths left out of the zip: generated or reproducible from the rest. */
export const ZIP_EXCLUDE = ['dist', 'package-lock.json'];
/** A bundle above this many bytes is reported: chat models stop ingesting near 2M tokens. */
export const BUNDLE_WARN_BYTES = 4_000_000;

const AI_CORE = ['README.md', 'policy.yaml', 'scope.yaml', 'rules/', 'adrs/', 'workflows/',
  'profiles/', 'prompts/', 'skills/', 'ci/', 'mesh/', 'deployments/', 'providers/']
  .map((p) => `.ai/repo/${p}`);

/** Ordered areas; a file goes to the first whose prefixes match it. */
export const BUNDLES = [
  { name: '01-overview', what: 'README, CLAUDE/AGENTS/GEMINI bootstraps, package.json, docs/, CI',
    prefixes: ['README.md', 'CLAUDE.md', 'AGENTS.md', 'GEMINI.md', 'package.json',
      'tailwind.config.cjs', '.gitignore', '.gitattributes', 'LICENSE', 'docs/', '.github/',
      'site/', 'licenses/', '.claude/'] },
  { name: '02-src-js-core-audio-synth', what: 'src/js: core, audio, synth, sequencer, MIDI, '
      + 'analysis, visualization, charts, labs, data',
    prefixes: ['core', 'audio', 'synth', 'sequencer', 'midi', 'analysis', 'visualization',
      'charts', 'labs', 'data'].map((d) => `src/js/${d}/`) },
  { name: '03-src-js-measure-experiments', what: 'src/js: measurement, calibration, experiments',
    prefixes: ['measurement', 'calibration', 'experiments'].map((d) => `src/js/${d}/`) },
  { name: '04-src-js-studio', what: 'src/js/studio', prefixes: ['src/js/studio/'] },
  { name: '05-src-js-ui-main', what: 'src/js/ui, main.js and any other src/js',
    prefixes: ['src/js/'] },
  { name: '06-src-html-css-data', what: 'src/index.html, src/styles, src/data',
    prefixes: ['src/'] },
  { name: '07-scripts', what: 'build, packer, stamp, release and deploy-verification scripts',
    prefixes: ['scripts/'] },
  { name: '08-tests-unit', what: 'tests/unit', prefixes: ['tests/unit/'],
    halves: true },
  { name: '08-tests-browser-visual', what: 'tests/README, browser suites, visual, test/',
    prefixes: ['tests/', 'test/'] },
  { name: '09-ai-rules-adrs', what: 'binding rules, ADRs, workflows, policy (.ai layer)',
    prefixes: ['.ai/README.md', '.ai/manifest.yaml', ...AI_CORE] },
  { name: '10-ai-plan', what: 'milestones, issues, intents, critiques, gaps',
    prefixes: ['.ai/repo/project/'] },
  { name: '11-ai-product-knowledge', what: 'use cases, features, why, knowledge, releases, '
      + 'reviews, sessions', prefixes: ['.ai/'] },
];
const OTHER = { name: '12-other', what: 'tracked files no area above names' };

const matches = (file, prefix) => (prefix.endsWith('/')
  ? file.startsWith(prefix) : file === prefix);

/**
 * Assign tracked files to bundles.
 * @param {string[]} files  tracked paths
 * @param {(file: string) => boolean} isBinary
 * @returns {{ bundles: { name: string, what: string, files: string[] }[],
 *   excluded: { file: string, reason: string }[] }}  bundles in order, empty ones dropped
 */
export function planBundles(files, isBinary = () => false) {
  const sorted = [...files].sort();
  const out = new Map();
  const excluded = [];
  const put = (name, what, file) => {
    if (!out.has(name)) out.set(name, { name, what, files: [] });
    out.get(name).files.push(file);
  };
  for (const file of sorted) {
    const skip = MARKDOWN_EXCLUDE.find((p) => matches(file, p));
    if (skip) { excluded.push({ file, reason: `excluded (${skip})` }); continue; }
    if (isBinary(file)) { excluded.push({ file, reason: 'binary' }); continue; }
    const area = BUNDLES.find((b) => b.prefixes.some((p) => matches(file, p)));
    if (!area) { put(OTHER.name, OTHER.what, file); continue; }
    put(area.name, area.what, file);
  }
  const order = [...BUNDLES.map((b) => b.name), OTHER.name];
  const bundles = [];
  for (const name of order) {
    const b = out.get(name);
    if (!b) continue;
    if (BUNDLES.find((a) => a.name === name)?.halves) {
      bundles.push({ name: `${name}-a`, what: `${b.what}, half a`,
        files: b.files.filter((_, i) => i % 2 === 0) });
      bundles.push({ name: `${name}-b`, what: `${b.what}, half b`,
        files: b.files.filter((_, i) => i % 2 === 1) });
    } else bundles.push(b);
  }
  return { bundles: bundles.filter((b) => b.files.length), excluded };
}

/** A fence longer than any run of tildes that opens a line of the content. */
export function fenceFor(content) {
  const longest = Math.max(0, ...[...content.matchAll(/^(~{3,})/gm)].map((m) => m[1].length));
  return '~'.repeat(Math.max(4, longest + 1));
}

/**
 * One bundle as Markdown.
 * @param {{ name: string, files: string[] }} bundle
 * @param {(file: string) => string} read
 * @param {{ version: string, sha: string }} meta
 */
export function renderBundle(bundle, read, meta) {
  const parts = [`# OSCILLA v${meta.version} (${meta.sha}): ${bundle.name}\n\n`,
    'Files in this bundle:\n', ...bundle.files.map((f) => `- ${f}\n`), '\n'];
  for (const file of bundle.files) {
    const content = read(file);
    const fence = fenceFor(content);
    const ext = path.extname(file).slice(1);
    const body = content.endsWith('\n') ? content : `${content}\n`;
    parts.push(`## \`${file}\`\n\n${fence}${ext}\n${body}${fence}\n\n`);
  }
  return parts.join('');
}

/**
 * The index.
 * @param {{ version: string, sha: string, fullSha: string, date: string, repo: string,
 *   packedAt: string, zip: string, log: string, sizes: [string, number][],
 *   bundles: { name: string, what: string, files: string[] }[] }} m
 */
export function renderIndex(m) {
  const count = (n) => `${n} file${n === 1 ? '' : 's'}`;
  const zipOnly = MARKDOWN_EXCLUDE.filter((p) => !ZIP_EXCLUDE.includes(p.replace(/\/$/, '')));
  return [
    `# OSCILLA v${m.version} (${m.sha}): 00 INDEX\n\n`,
    `Source pack of ${m.repo} at commit ${m.fullSha} (${m.date}), packed ${m.packedAt}.\n`,
    'This pack supersedes every older OSCILLA source file in this project. It can lag main:\n',
    'when a claim depends on the current state, name this commit.\n\n',
    '## Files in this pack\n\n',
    '- 00-INDEX.md: this file; the last 80 commits; every tracked file with its size\n',
    ...m.bundles.map((b) => `- ${b.name}.md: ${b.what} (${count(b.files.length)})\n`),
    `- ${m.zip}: the whole tracked tree without ${ZIP_EXCLUDE.join(' and ')}, including what `
      + `the Markdown leaves out (${zipOnly.join(', ')}, binary files)\n\n`,
    '## Last 80 commits\n\n~~~~text\n', m.log.endsWith('\n') ? m.log : `${m.log}\n`, '~~~~\n\n',
    '## Tracked files (bytes, path)\n\n~~~~text\n',
    ...m.sizes.map(([f, n]) => `${String(n).padStart(9)} ${f}\n`), '~~~~\n',
  ].join('');
}

export const USAGE = 'usage: node scripts/pack-sources.mjs [--out <dir>] [--help]';

/** @returns {{ help: boolean, out: string|null }} @throws {Error & {exitCode: 2}} */
export function parseArgs(argv) {
  const o = { help: false, out: null };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--help' || a === '-h') o.help = true;
    else if (a === '--out') {
      const v = argv[i + 1];
      if (!v || v.startsWith('-')) {
        throw Object.assign(new Error('--out needs a directory'), { exitCode: 2 });
      }
      o.out = v; i += 1;
    } else throw Object.assign(new Error(`unknown flag: ${a}`), { exitCode: 2 });
  }
  return o;
}

function git(args, opts = {}) {
  return execFileSync('git', args, { cwd: ROOT, maxBuffer: 256 * 1024 * 1024, ...opts });
}

/**
 * Every tracked file at HEAD in two git calls: `ls-tree -l` for paths, object ids and sizes,
 * `cat-file --batch` for the contents (symlinks and submodules are skipped).
 * @returns {Map<string, { size: number, data: Buffer }>}
 */
export function readHeadTree() {
  const entries = git(['ls-tree', '-r', '-l', '-z', 'HEAD']).toString().split('\0')
    .filter(Boolean).map((line) => {
      const [info, file] = line.split('\t');
      const [mode, type, oid, size] = info.split(/\s+/);
      return { mode, type, oid, size: Number(size), file };
    }).filter((e) => e.type === 'blob' && e.mode !== '120000');
  const raw = git(['cat-file', '--batch'], { input: entries.map((e) => `${e.oid}\n`).join('') });
  const tree = new Map();
  let at = 0;
  for (const e of entries) {
    const eol = raw.indexOf(10, at);
    const size = Number(raw.subarray(at, eol).toString().split(' ')[2]);
    tree.set(e.file, { size, data: raw.subarray(eol + 1, eol + 1 + size) });
    at = eol + 1 + size + 1;
  }
  return tree;
}

export function main(argv = process.argv.slice(2)) {
  let args;
  try {
    args = parseArgs(argv);
  } catch (e) {
    console.error(`${e.message}\n${USAGE}`);
    return e.exitCode;
  }
  if (args.help) { console.log(USAGE); return 0; }

  const version = JSON.parse(git(['show', 'HEAD:package.json']).toString()).version;
  const fullSha = git(['rev-parse', 'HEAD']).toString().trim();
  const sha = fullSha.slice(0, 8);
  const out = path.resolve(args.out ?? path.join(os.homedir(), 'Downloads',
    `oscilla-sources-v${version}-${sha}`));
  if (fs.existsSync(out) && fs.readdirSync(out).length
      && !fs.existsSync(path.join(out, '00-INDEX.md'))) {
    console.error(`refusing to replace ${out}: not empty and not an earlier pack`);
    return 1;
  }
  fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(out, { recursive: true });

  const tree = readHeadTree();
  const files = [...tree.keys()];
  const buf = (f) => tree.get(f).data;
  const { bundles } = planBundles(files, (f) => buf(f).includes(0));
  const meta = { version, sha };

  const zip = `oscilla-v${version}-${sha}-src.zip`;
  git(['archive', '--format=zip', '-o', path.join(out, zip), 'HEAD', '--', '.',
    ...ZIP_EXCLUDE.map((p) => `:(exclude)${p}`)]);

  const report = [];
  for (const b of bundles) {
    const text = renderBundle(b, (f) => buf(f).toString('utf8'), meta);
    fs.writeFileSync(path.join(out, `${b.name}.md`), text);
    const bytes = Buffer.byteLength(text);
    report.push(`${String(bytes).padStart(9)} ${b.name}.md${bytes > BUNDLE_WARN_BYTES
      ? `  WARNING: above ${BUNDLE_WARN_BYTES} bytes; split this area in BUNDLES` : ''}`);
  }
  const remote = git(['remote', 'get-url', 'origin']).toString().trim()
    .replace(/^.*github\.com[:/]/, 'https://github.com/').replace(/\.git$/, '');
  const sizes = files.map((f) => [f, tree.get(f).size]);
  fs.writeFileSync(path.join(out, '00-INDEX.md'), renderIndex({
    version, sha, fullSha, repo: remote, zip, bundles, sizes,
    date: git(['log', '-1', '--format=%cI']).toString().trim(),
    packedAt: new Date().toISOString().replace(/\.\d+Z$/, 'Z'),
    log: git(['log', '-80', '--format=%h %cs %s']).toString(),
  }));

  console.log(`${out}\n${report.join('\n')}\n${String(fs.statSync(path.join(out, zip)).size)
    .padStart(9)} ${zip}`);
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main();
}
