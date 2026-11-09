#!/usr/bin/env node
// The generated landing at /oscilla/lab/ (plan P014, owner decision Q107): one static Czech page
// on Flowbite Pro beside the app, built at deploy time from the deployed commit and never
// committed. The app at /oscilla/ stays the one self-contained dist/index.html and never loads
// this page (project.single-file-deliverable, its /lab/ exception).
//
//   node scripts/landing.mjs --out <dir> [--app-href ../] [--commit <sha>]
//     writes <dir>/index.html, <dir>/charts/<name>.svg for every name of CHARTS, and
//     <dir>/shots/*.png, copies of the committed visual references the page shows.
//
// Self-contained: Tailwind with the flowbite plugin compiled over the page's own markup and
// inlined, the one script (scripts/landing/client.js with three flowbite components) bundled
// and inlined, icons inlined, images only from shots/ beside the page; a Content-Security-Policy
// meta refuses every other origin. Deterministic for a commit: every fact comes from
// scripts/facts.mjs, and the only date is the commit's own; a rerun writes identical bytes,
// which scripts/verify-deploy.mjs relies on (it regenerates the page and compares the live one).
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';
import postcss from 'postcss';
import tailwindcss from 'tailwindcss';
import { CHARTS, REPO_ROOT, collectFacts } from './facts.mjs';
import { parseFlags } from './release-analyze.mjs';
import { guardRawText, inlineIcon } from './pack-single-file.mjs';
import { TARGETS } from './build-config.mjs';
import { ICON_SVG } from './social-assets.mjs';
import { fmtDate, renderCharts } from './landing/charts.mjs';
import { FRAME_TABS, checkCopy } from './landing/copy.mjs';
import {
  REPO_URL, SCRIPT_MARKER, STYLE_MARKER, renderPage, shotText,
} from './landing/page.mjs';

const require = createRequire(import.meta.url);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const CLIENT = path.join(HERE, 'landing', 'client.js');
export const TIMELINE_LENGTH = 8;
/** The flowbite components the client imports; Tailwind scans them for the classes they add. */
const FLOWBITE_COMPONENTS = ['collapse', 'modal', 'tabs'];
const NOTICE_PACKAGES = ['flowbite', 'lucide-static', 'tailwindcss'];

const LUCIDE_PAINT = 'fill="none" stroke="currentColor" stroke-width="2" '
  + 'stroke-linecap="round" stroke-linejoin="round"';

/** A Lucide icon (lucide-static, as the app inlines them) with its paint and `cls`. */
function icons(name, cls) {
  return inlineIcon(name).replace('class="lucide" width="24" height="24"',
    `class="${cls}" ${LUCIDE_PAINT}`);
}

/** The app's own workspace icon (the sprite of src/index.html), as an inline SVG. */
function workspaceIconOf(root) {
  const html = readFileSync(path.join(root, 'src/index.html'), 'utf8');
  return (id) => {
    const m = new RegExp(`<symbol id="i-ws-${id}" viewBox="0 0 24 24">([\\s\\S]*?)</symbol>`)
      .exec(html);
    if (!m) return icons('layout-grid', 'h-6 w-6');
    const marker = /^<!-- @icon:([a-z0-9-]+) -->$/.exec(m[1].trim());
    if (marker) return icons(marker[1], 'h-6 w-6');
    return `<svg aria-hidden="true" focusable="false" class="h-6 w-6" viewBox="0 0 24 24" `
      + `${LUCIDE_PAINT}>${m[1].trim()}</svg>`;
  };
}

/** The wave mark (scripts/social-assets.mjs ICON_SVG), each copy with its own gradient id. */
function markFactory() {
  let n = 0;
  return (cls) => {
    n += 1;
    return ICON_SVG.replace('<svg ', `<svg aria-hidden="true" focusable="false" class="${cls}" `)
      .replace('id="g"', `id="oscilla-mark-${n}"`).replace('url(#g)', `url(#oscilla-mark-${n})`);
  };
}

const shotFile = (p) => p.replace(/^tests\/visual\//, '').replace(/\//g, '-');

/** The gallery: the committed references in the dark (or only) theme, desktop and phone. */
export function galleryShots(facts) {
  return facts.screenshots.items
    .filter((s) => s.theme !== 'light' && (s.viewport === 'desktop' || s.viewport === 'phone'))
    .map((s) => ({ ...s, file: shotFile(s.path), ...shotText(s, facts.workspaces.items) }));
}

function licenceText(pkg) {
  const dir = path.dirname(require.resolve(`${pkg}/package.json`));
  for (const name of ['LICENSE', 'LICENSE.md', 'LICENSE.txt', 'license']) {
    try {
      return readFileSync(path.join(dir, name), 'utf8').replace(/\r\n/g, '\n').trim();
    } catch { /* next name */ }
  }
  throw new Error(`landing: no licence text for ${pkg}`);
}

function notice(pkgs) {
  const own = readFileSync(path.join(REPO_ROOT, 'LICENSE'), 'utf8').replace(/\r\n/g, '\n').trim();
  const parts = [...new Set(pkgs)].sort().map((pkg) => {
    const meta = require(`${pkg}/package.json`);
    return `== ${pkg}@${meta.version} - ${meta.license}\n\n${licenceText(pkg)}`;
  });
  const text = `OSCILLA lab page - MIT\n\n${own}\n\n=====\n\nThird-party software in this page.\n\n`
    + parts.join('\n\n-----\n\n');
  return `<!--\n${text.replace(/--/g, '- -')}\n-->`;
}

async function bundleClient() {
  const result = await esbuild.build({
    entryPoints: [CLIENT], bundle: true, write: false, metafile: true, minify: true,
    format: 'iife', platform: 'browser', target: TARGETS, legalComments: 'none',
    charset: 'utf8', logLevel: 'warning', absWorkingDir: REPO_ROOT,
  });
  const pkgs = Object.keys(result.metafile.inputs)
    .map((i) => (i.match(/node_modules\/((?:@[^/]+\/)?[^/]+)\//) || [])[1]).filter(Boolean);
  return { code: result.outputFiles[0].text.trim(), pkgs };
}

async function compileCss(html, js) {
  const flowbiteDir = path.dirname(require.resolve('flowbite/package.json'));
  const config = {
    content: [
      { raw: html, extension: 'html' },
      { raw: js, extension: 'js' },
      ...FLOWBITE_COMPONENTS.map((c) => path.join(flowbiteDir, 'lib/esm/components', c,
        'index.js')),
    ],
    darkMode: 'class',
    theme: {
      extend: {
        colors: { primary: require('tailwindcss/colors').blue },
        fontFamily: {
          sans: ['Inter', 'system-ui', '-apple-system', 'BlinkMacSystemFont', '"Segoe UI"',
            'Roboto', 'sans-serif'],
        },
      },
    },
    plugins: [require('flowbite/plugin')({ forms: false })],
  };
  const input = '@tailwind base;\n@tailwind components;\n@tailwind utilities;\n';
  const result = await postcss([tailwindcss(config)]).process(input, { from: undefined });
  const out = await esbuild.transform(result.css, {
    loader: 'css', minify: true, target: TARGETS, legalComments: 'none', charset: 'utf8',
    logLevel: 'warning',
  });
  return out.code.trim();
}

/**
 * The landing's files for the checkout at `root`: { 'index.html': Buffer, 'charts/<n>.svg':
 * Buffer, 'shots/<f>.png': Buffer }, in a fixed order.
 * @param {{ root?: string, appHref?: string, facts?: object, commit?: string }} [o]
 */
export async function generateLanding({ root = REPO_ROOT, appHref = '../', facts, commit } = {}) {
  const f = facts ?? await collectFacts({ root, git: true });
  if (!f.git) throw new Error('landing: the facts carry no git group (collectFacts git: true)');
  if (commit && commit !== f.git.head) {
    throw new Error(`landing: --commit ${commit} is not the checkout's HEAD ${f.git.head}`);
  }
  checkCopy({ workspaces: f.workspaces.items, engines: f.engines.items });
  const sha = f.git.head;
  const charts = renderCharts(f);
  const all = f.screenshots.items.map((s) => ({ ...s, file: shotFile(s.path),
    ...shotText(s, f.workspaces.items) }));
  const frameTabs = FRAME_TABS.map((t) => ({ ...t, shot: all.find((s) => t.shot.test(s.path))
    ?? null }));
  const shots = galleryShots(f);
  const timeline = f.releases.items.filter((r) => r.published_at).slice()
    .sort((a, b) => (a.published_at < b.published_at ? 1 : -1)).slice(0, TIMELINE_LENGTH);
  const model = {
    facts: f, appHref, charts, chartNames: CHARTS, shots, frameTabs, timeline,
    latestRelease: f.releases.items[f.releases.items.length - 1] ?? null,
    shortSha: sha.slice(0, 7), commitDay: fmtDate(f.git.headDate),
    commitUrl: `${REPO_URL}/commit/${sha}`,
    blob: (p) => `${REPO_URL}/blob/${sha}/${p}`,
    tree: (p) => `${REPO_URL}/tree/${sha}/${p}`,
    icons, mark: markFactory(), workspaceIcon: workspaceIconOf(root),
    favicon: `data:image/svg+xml,${encodeURIComponent(ICON_SVG)}`,
  };
  const page = renderPage(model);
  const client = await bundleClient();
  const css = await compileCss(page, readFileSync(CLIENT, 'utf8'));
  const html = page
    .replace(STYLE_MARKER, () => `<style>${guardRawText(css, 'style', 'landing css')}</style>`)
    .replace(SCRIPT_MARKER, () => `<script>${guardRawText(client.code, 'script', 'landing js')}`
      + '</script>')
    .replace('<html lang="cs"', () => `${notice([...NOTICE_PACKAGES, ...client.pkgs])}\n`
      + '<html lang="cs"');
  const files = new Map([['index.html', Buffer.from(html, 'utf8')]]);
  for (const name of CHARTS) files.set(`charts/${name}.svg`, Buffer.from(charts[name], 'utf8'));
  const copied = new Map();
  for (const s of [...frameTabs.map((t) => t.shot).filter(Boolean), ...shots]) {
    copied.set(s.file, s.path);
  }
  for (const [file, rel] of [...copied].sort(([a], [b]) => (a < b ? -1 : 1))) {
    files.set(`shots/${file}`, readFileSync(path.join(root, rel)));
  }
  return files;
}

/** Write the files of generateLanding under `out`. */
export function writeLanding(out, files) {
  for (const [rel, body] of files) {
    const file = path.join(out, rel);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, body);
  }
}

export const USAGE = 'usage: node scripts/landing.mjs --out <dir> [--app-href ../] '
  + '[--commit <sha>] [--help]';
const FLAGS = { '--out': 'value', '--app-href': 'value', '--commit': 'value' };

export async function main({ argv = process.argv.slice(2), root = REPO_ROOT, log = console.log,
  err = console.error } = {}) {
  let f;
  try {
    f = parseFlags(argv, FLAGS, USAGE);
  } catch (e) {
    err(`landing: ${e.message}`);
    return e.exitCode ?? 2;
  }
  if (f.help) {
    log(USAGE);
    return 0;
  }
  if (!f['--out']) {
    err(`landing: --out is required\n${USAGE}`);
    return 2;
  }
  try {
    const files = await generateLanding({ root, appHref: f['--app-href'] ?? '../',
      commit: f['--commit'] });
    writeLanding(path.resolve(f['--out']), files);
    const bytes = [...files.values()].reduce((s, b) => s + b.length, 0);
    log(`landing: wrote ${files.size} files (${bytes} B) to ${f['--out']}`);
    return 0;
  } catch (e) {
    err(`landing: ${e.message}`);
    return 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then((code) => { process.exitCode = code; });
}
