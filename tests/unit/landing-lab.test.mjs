// The generated landing at /oscilla/lab/ (plan P014, owner decision Q107; claim lab-landing).
// scripts/landing.mjs builds it from the facts of the checkout (scripts/facts.mjs); the Pages
// workflow publishes it beside the app and scripts/verify-deploy.mjs proves the live copy equals
// a regeneration. Here:
//   - two generations are byte-identical (verify-deploy relies on it);
//   - the page is Czech (lang="cs") and loads nothing from another origin: every src/href of a
//     script, link, img, iframe, source, video, audio, embed or object is relative or data:, and
//     every absolute <a> link goes to the repository on GitHub or to the Pages site;
//   - every workspace of the registry has a card linking ../#m=<id>;
//   - no <iframe> exists in the HTML: the frame is created only on a press;
//   - every chart of CHARTS exists with <title> and <desc>, inlined in the page byte for byte;
//   - a registry id without Czech copy fails the generator (a fake workspace, a fake engine);
//   - checkLabFile of verify-deploy names a file that differs from its regeneration;
//   - the P015 dashboards: the sections Co přinesla která verze, Roadmapa, Průzkumník tvrzení
//     and Rozhodnutí (ADR) exist with their nav entries; the changelog has a card per release
//     tag, the unreleased changes and the newest CHANGELOG_FULL_RELEASES (8) list their commits
//     and older ones link GitHub's compare view instead (its page, zmeny/, stays under its
//     ceiling of PAGE_CEILING since P018), each plan-id chip links an issue file that exists and
//     each PR link its number; the claims explorer holds a row for every claim with its
//     status and area and links its source, implementation and test, and its filter controls
//     stay hidden without the script;
//     the roadmap lists every milestone; the ADR table every ADR; the hero counts commits and
//     ADRs;
//   - the P016 trends: the sections Dluh, který jen klesá and Revize a jejich nálezy exist with
//     their nav entries; a card per ratchet baseline the facts find, each linking its file, the
//     test that enforces it (a test that reads that file) and its rule (a file that exists);
//     a review row per record, newest first, each linking its pull request, with every open
//     P0 or P1 named; every chart card names the source of its fact group; a ratchet without
//     Czech copy fails the generator; the absent ledger of a release reads as absent;
//   - the P017 review audit (facts injected, so the repository's own audits do not decide it):
//     with an audit the reviews section shows its header (file, date, base commit, auditors,
//     scope), a row per open P0-P2 finding with its Czech class, the evidence in English, the
//     fixed commit and the plan issue linked, the class filter (hidden without the script) and
//     the P3 block naming the unclassified remainder, and the reviews chart gains the audit
//     panel; with no audit it says "zatím žádný audit", keeps P016's counts and chart;
//   - expectedLab regenerates a commit behind HEAD from that commit's own tree (a fixture repo
//     whose two commits carry different generators), and a commit without the generator
//     deployed no landing (null), so the release task's closing check works after main moves;
//   - plan P018, the sub-pages: the front page keeps the hero, the playable frame, the
//     workspace cards, the gallery, the chart overview (each chart an <img> of charts/<name>.svg
//     linking its interactive card on grafy/) and a teaser card per sub-page with its derived
//     numbers, and none of the dashboards; each dashboard is lab/<dir>/index.html for every dir
//     of SUBPAGES, a full page with the same <style>, the same <script>, the header, the nav
//     (its own entry aria-current="page", and only that one), the breadcrumb, the H1 and the
//     footer; the front page is at most 300 000 B and each sub-page within its own ceiling
//     (measured reasons at PAGE_CEILING); a link walk resolves every relative href and src of
//     every page (and the lightbox's data-full) to a generated file, and a #fragment to an id in
//     that file, and every link out of lab/ to exactly the app root (../ from the front page,
//     ../../ from a sub-page), whatever its fragment.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { CHARTS, REPO_ROOT, collectFacts } from '../../scripts/facts.mjs';
import { esc, fmtInt } from '../../scripts/landing/charts.mjs';
import { CHANGELOG_FULL_RELEASES, RATCHET_COPY } from '../../scripts/landing/copy.mjs';
import { generateLanding, ruleFileOf } from '../../scripts/landing.mjs';
import * as LANDING_PAGE from '../../scripts/landing/page.mjs';
import { chartTable } from '../../scripts/landing/charts.mjs';
import { readFileSync } from 'node:fs';
import { checkLabFile, expectedLab } from '../../scripts/verify-deploy.mjs';
import { beginMarker, endMarker } from '../../scripts/readme.mjs';
import { WORKSPACE_REGISTRY } from '../../src/js/ui/shell.js';
import { ENGINE_MODULES } from '../../src/js/synth/panels/engines.js';

const { CHART_GROUP, CSP, LINK_SHA } = LANDING_PAGE;
// Plan P018's sub-pages; read off the module so that, at a merge base without them, the tests
// fail by assertion rather than by a missing export.
const SUBPAGES = LANDING_PAGE.SUBPAGES ?? [];

// The repository's own history: fail-first runs the tests in a tree extracted by git archive
// with no commit (scripts/fail-first.mjs). There the facts are collected from a temporary git
// directory holding the tree as one commit with a fixed date (GIT_DIR and GIT_WORK_TREE for the
// call only, so the fixture repositories below keep their own); the cases that need the real
// release tags are skipped.
const HAS_HISTORY = (() => {
  try {
    execFileSync('git', ['rev-parse', '--verify', '-q', 'HEAD'],
      { cwd: REPO_ROOT, stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();
const NO_HISTORY = !HAS_HISTORY && 'this checkout has no commit history (a git archive tree)';

async function withHistory(fn) {
  if (HAS_HISTORY) return fn();
  const gitDir = mkdtempSync(path.join(os.tmpdir(), 'oscilla-lab-history-'));
  const keys = ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_AUTHOR_DATE', 'GIT_COMMITTER_DATE'];
  const saved = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  Object.assign(process.env, { GIT_DIR: gitDir, GIT_WORK_TREE: REPO_ROOT,
    GIT_AUTHOR_DATE: '2026-11-10T00:00:00Z', GIT_COMMITTER_DATE: '2026-11-10T00:00:00Z' });
  try {
    const git = (...a) => execFileSync('git', a, { cwd: REPO_ROOT, stdio: 'ignore' });
    git('init', '--quiet');
    git('add', '-A');
    git('-c', 'user.email=fixture@example.invalid', '-c', 'user.name=fixture', 'commit',
      '--quiet', '--no-verify', '-m', 'archive tree');
    return await fn();
  } finally {
    for (const k of keys) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
    rmSync(gitDir, { recursive: true, force: true });
  }
}

const FACTS = await withHistory(() => collectFacts({ git: true }));
const FILES = await generateLanding({ facts: FACTS });
const HTML = FILES.get('index.html').toString('utf8');
const stripScripts = (html) => html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,
  '<script></script>');
const MARKUP = stripScripts(HTML);
/** Every generated page: its path under lab/ -> its HTML. */
const PAGES = new Map([...FILES].filter(([name]) => name.endsWith('.html'))
  .map(([name, body]) => [name, body.toString('utf8')]));
const pageOf = (dir) => `${dir}/index.html`;
const clone = (x) => JSON.parse(JSON.stringify(x));
const ALLOWED_LINK = new RegExp('^https://(github\\.com/korczis/oscilla(/|$)'
  + '|korczis\\.github\\.io/oscilla/)');

// Plan P018: the ceiling of each page, in bytes (what Pages stores; gzip shrinks each about
// sevenfold). Every page carries about 82 000 B shared: the inlined Tailwind (44 272 B), the
// client bundle (21 319 B), the licence notice (6 617 B), the header, nav and footer. Measured
// on 2026-11-10 at feat/lab-subpages (49 release tags, 95 claims, 98 milestones, 72 ADRs,
// 96 review records, 10 ratchets; no audit-*.yaml in the tree):
//   index.html          187 342 B (28 836 gzip): the hero, the frame, the workspaces, the
//                       templates, the gallery, the chart overview as images (none inlined),
//                       the teasers, the proof cards and the last 8 releases; it does not grow
//                       with releases, claims or reviews, so the plan's 300 000 is its ceiling.
//   zmeny/index.html    376 934 B: one card per release tag (the newest 8 and the unreleased
//                       changes list their commits, the rest a compare link): 480 000.
//   grafy/index.html    279 709 B: the 12 charts inline with their value tables, which grow by
//                       a row per release in five of them: 360 000.
//   tvrzeni/index.html  218 344 B: about 1 300 B a claim: 280 000.
//   roadmapa/index.html 190 787 B: about 950 B a milestone: 250 000.
//   adr/index.html      151 040 B: about 770 B an ADR: 200 000.
//   revize/index.html   123 423 B; P017 measured about 50 000 B more with audit-2026-11-10.yaml
//                       (63 open P0-P2 rows) in the tree, and a record adds about 330 B: 240 000.
//   dluh/index.html     116 954 B: about 2 100 B a ratchet, a sparkline point per release:
//                       160 000.
const PAGE_CEILING = Object.freeze({
  'index.html': 300_000, 'zmeny/index.html': 480_000, 'grafy/index.html': 360_000,
  'tvrzeni/index.html': 280_000, 'roadmapa/index.html': 250_000, 'adr/index.html': 200_000,
  'revize/index.html': 240_000, 'dluh/index.html': 160_000,
});

test('two generations from the same checkout are byte-identical', async () => {
  const again = await withHistory(() => generateLanding());
  assert.deepEqual([...again.keys()], [...FILES.keys()]);
  for (const [name, body] of FILES) assert.ok(again.get(name).equals(body), name);
  assert.ok(FILES.has('index.html'));
  for (const p of SUBPAGES) assert.ok(FILES.has(pageOf(p.dir)), pageOf(p.dir));
  assert.ok([...FILES.keys()].some((k) => k.startsWith('shots/') && k.endsWith('.png')));
});

test('every page is Czech and loads nothing from another origin', () => {
  assert.match(CSP, /default-src 'none'/);
  const LOAD = new RegExp('<(script|link|img|iframe|source|video|audio|embed|object)\\b'
    + '[^>]*?\\s(?:src|href|data|srcset)="([^"]*)"', 'gi');
  for (const [name, html] of PAGES) {
    const markup = stripScripts(html);
    assert.match(html, /<html lang="cs"/, name);
    assert.ok(html.includes(`<meta http-equiv="Content-Security-Policy" content="${CSP}">`), name);
    const loads = [...markup.matchAll(LOAD)];
    assert.ok(loads.length > 0, `${name} has an icon`);
    for (const [, tag, url] of loads) {
      assert.ok(!/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(url) || url.startsWith('data:'),
        `${name}: <${tag}> loads ${url}`);
    }
    for (const [, url] of markup.matchAll(/<a\b[^>]*?\shref="([^"]*)"/gi)) {
      if (/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(url)) assert.match(url, ALLOWED_LINK, url);
    }
    const css = (/<style>([\s\S]*?)<\/style>/.exec(html) || [])[1];
    assert.ok(css && css.length > 1000, `${name}: Tailwind is inlined`);
    assert.doesNotMatch(css, /@import|url\(\s*["']?(?:https?:)?\/\//i);
  }
  assert.ok([...MARKUP.matchAll(/<img\b/g)].length > 5, 'the front page has images');
});

test('P018: the front page and every sub-page stay within their ceilings', () => {
  assert.deepEqual([...PAGES.keys()].sort(), Object.keys(PAGE_CEILING).sort(),
    'a ceiling for every page, and a page for every ceiling');
  for (const [name, ceiling] of Object.entries(PAGE_CEILING)) {
    const size = FILES.get(name).length;
    assert.ok(size <= ceiling, `${name} is ${size} B (ceiling ${ceiling})`);
  }
  assert.equal(PAGE_CEILING['index.html'], 300_000);
});

const BLOCKS = (html) => ({
  notice: html.slice(0, html.indexOf('<html lang="cs"')),
  style: /<style>[\s\S]*?<\/style>/.exec(html)?.[0],
  scripts: [...html.matchAll(/<script>[\s\S]*?<\/script>/g)].map((m) => m[0]),
});

test('P018: each sub-page is a full page with the shared style, script, nav and footer', () => {
  const front = BLOCKS(HTML);
  assert.equal(front.scripts.length, 2, 'the theme pre-script and the client bundle');
  assert.doesNotMatch(MARKUP, /<a [^>]*aria-current="page"/, 'the front page marks no entry');
  for (const p of SUBPAGES) {
    const name = pageOf(p.dir);
    const html = PAGES.get(name);
    const markup = stripScripts(html);
    assert.deepEqual(BLOCKS(html), front, `${name}: the same notice, style and scripts`);
    assert.ok(html.includes(`<title>${esc(p.title)} · OSCILLA</title>`), `${name} title`);
    const current = [...markup.matchAll(/<a href="([^"]*)" [^>]*aria-current="page">/g)];
    assert.deepEqual(current.map((m) => m[1]), [`#${p.dir}`], `${name}: one current entry`);
    for (const q of SUBPAGES.filter((x) => x !== p)) {
      assert.ok(markup.includes(`<li><a href="../${q.dir}/" class=`), `${name} nav ${q.dir}`);
    }
    for (const id of ['hrat', 'plochy', 'galerie']) {
      assert.ok(markup.includes(`<li><a href="../#${id}" class=`), `${name} nav ../#${id}`);
    }
    assert.match(markup, /<nav class="mb-4 flex" aria-label="Drobečková navigace">/, name);
    assert.ok(markup.includes(`>${esc(p.title)}</h1>`), `${name} H1`);
    assert.equal(markup.split('<h1 ').length - 1, 1, `${name}: one H1`);
    assert.match(markup, /<button type="button" data-theme-toggle /, `${name} theme toggle`);
    assert.match(markup, /data-lab-menu-toggle aria-controls="lab-menu"/, `${name} phone menu`);
    assert.ok(markup.includes('<footer '), `${name} footer`);
    assert.ok(markup.includes('class="hidden rounded-lg bg-primary-700') && markup.includes(
      '<a href="../../" class="hidden rounded-lg'), `${name}: the app at ../../`);
    assert.ok(markup.includes(`<section id="${p.dir}"`), `${name} section`);
    const teasers = [...markup.matchAll(/data-teaser="([a-z]+)"/g)].map((m) => m[1]);
    assert.deepEqual(teasers, SUBPAGES.filter((x) => x !== p).map((x) => x.dir),
      `${name}: the other dashboards`);
    assert.doesNotMatch(markup, /data-lab-frame|data-shot /, `${name}: no frame, no gallery`);
  }
});

test('P018: the front page keeps the light sections and a teaser per dashboard', () => {
  for (const id of ['top', 'hrat', 'plochy', 'sablony', 'galerie', 'grafy', 'prehledy',
    'dukazy', 'vydani']) {
    assert.ok(MARKUP.includes(`<section id="${id}"`), `#${id}`);
  }
  assert.match(MARKUP, /data-lab-frame data-app-href="\.\.\/"/, 'the playable frame');
  for (const p of SUBPAGES.filter((x) => x.dir !== 'grafy')) {
    assert.ok(!MARKUP.includes(`<section id="${p.dir}"`), `${p.dir} is not on the front page`);
  }
  const main = MARKUP.slice(MARKUP.indexOf('<main '), MARKUP.indexOf('</main>'));
  assert.doesNotMatch(main, /data-chart-box|data-claims|data-roadmap|data-audit/,
    'no dashboard markup on the front page');
  const teaser = (dir) => {
    const at = MARKUP.indexOf(`data-teaser="${dir}"`);
    assert.ok(at >= 0, `teaser ${dir}`);
    return MARKUP.slice(at, MARKUP.indexOf('</article>', at));
  };
  for (const p of SUBPAGES) assert.ok(teaser(p.dir).includes(`<a href="${p.dir}/" class=`), p.dir);
  const num = (n) => `>${fmtInt(n)}</dt>`;
  assert.ok(teaser('tvrzeni').includes(num(FACTS.claims.total)), 'claims');
  assert.ok(teaser('tvrzeni').includes(num(FACTS.claims.byStatus.guaranteed)), 'guaranteed');
  assert.ok(teaser('zmeny').includes(num(FACTS.releaseChanges.items.length)), 'release tags');
  assert.ok(teaser('adr').includes(num(FACTS.adrs.total)), 'ADRs');
  assert.ok(teaser('revize').includes(num(FACTS.reviews.totals.reviews)), 'reviews');
  assert.ok(teaser('grafy').includes(num(CHARTS.length)), 'charts');
  const ms = FACTS.plan.items;
  assert.ok(teaser('roadmapa').includes(`>${fmtInt(ms.filter((x) => x.status === 'DONE')
    .length)}&nbsp;/&nbsp;${fmtInt(ms.length)}</dt>`), 'milestones done');
  const r = FACTS.ratchets.items;
  assert.ok(teaser('dluh').includes(`>${fmtInt(r.filter((x) => x.rises === 0).length)}`
    + `&nbsp;/&nbsp;${fmtInt(r.length)}</dt>`), 'ratchets falling');
});

// The link walk: every page's relative href and src (and the lightbox's data-full, the frame's
// data-app-href) resolved as Pages would serve it under /oscilla/lab/.
const SITE = 'https://pages.invalid/oscilla/';
const LAB = `${SITE}lab/`;
const unescape = (s) => s.replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&amp;/g, '&');
function walkLinks(pages, files) {
  const ids = new Map([...pages].map(([n, h]) => [n,
    new Set([...stripScripts(h).matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]))]));
  const problems = [];
  const seen = { lab: 0, app: new Map() };
  const REF = /<(?:a|img|link)\b[^>]*?\s(?:href|src)="([^"]*)"|\sdata-(?:full|app-href)="([^"]*)"/g;
  for (const [name, html] of pages) {
    for (const m of stripScripts(html).matchAll(REF)) {
      const raw = unescape(m[1] ?? m[2]);
      if (/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(raw)) continue;
      const u = new URL(raw, LAB + name);
      const at = `${name}: ${raw}`;
      if (!u.href.startsWith(LAB)) {
        if (u.origin + u.pathname !== SITE) problems.push(`${at} leaves lab/ but not for the app`);
        else seen.app.set(name, raw);
        continue;
      }
      let rel = decodeURIComponent(u.pathname.slice(new URL(LAB).pathname.length));
      if (rel === '' || rel.endsWith('/')) rel += 'index.html';
      seen.lab += 1;
      if (!files.has(rel)) {
        problems.push(`${at} -> ${rel} is no generated file`);
      } else if (u.hash && !ids.get(rel)?.has(decodeURIComponent(u.hash.slice(1)))) {
        problems.push(`${at} -> ${rel} has no id ${u.hash}`);
      }
    }
  }
  return { problems, seen };
}

test('P018: every relative link of every page resolves to a generated file and id', () => {
  const { problems, seen } = walkLinks(PAGES, FILES);
  assert.deepEqual(problems, []);
  assert.ok(seen.lab > 200, `links walked: ${seen.lab}`);
  assert.deepEqual([...seen.app.keys()].sort(), [...PAGES.keys()].sort(),
    'every page links the app');
  assert.match(seen.app.get('index.html'), /^\.\.\//);
  for (const p of SUBPAGES) assert.match(seen.app.get(pageOf(p.dir)), /^\.\.\/\.\.\//, p.dir);
  // mutation: a moved anchor, a missing page and a link one level too high are each named
  const broken = new Map(PAGES);
  broken.set('index.html', HTML.replace('href="zmeny/"', 'href="zmeny/#no-such-id"')
    .replace('href="adr/"', 'href="adrs/"').replace('href="../"', 'href="../../"'));
  const found = walkLinks(broken, FILES).problems.join('\n');
  assert.match(found, /zmeny\/#no-such-id -> zmeny\/index\.html has no id #no-such-id/);
  assert.match(found, /adrs\/ -> adrs\/index\.html is no generated file/);
  assert.match(found, /index\.html: \.\.\/\.\.\/ leaves lab\/ but not for the app/);
});

test('P018: the README links every sub-page where its live region names the dashboards', () => {
  const readme = readFileSync(path.join(REPO_ROOT, 'README.md'), 'utf8');
  const live = readme.slice(readme.indexOf(beginMarker('live')), readme.indexOf(endMarker('live')));
  assert.ok(live.length > 100, 'the live region');
  assert.ok(SUBPAGES.length >= 7, `sub-pages: ${SUBPAGES.length}`);
  for (const p of SUBPAGES) {
    assert.ok(live.includes(`[${p.en}`) && live.includes(
      `](https://korczis.github.io/oscilla/lab/${p.dir}/)`), `README links lab/${p.dir}/`);
  }
});

test('every workspace of the registry has a card linking into the app', () => {
  for (const w of WORKSPACE_REGISTRY) {
    assert.ok(MARKUP.includes(`href="../#m=${w.id}" class=`)
      && MARKUP.includes(`data-workspace="${w.id}"`), `card for ${w.id}`);
  }
  for (const e of ENGINE_MODULES) {
    assert.ok(MARKUP.includes(`href="../#m=synth&amp;yt=engines&amp;ye=${e.id}"`), e.id);
  }
});

test('no iframe exists before a press; the start buttons and the frame host do', () => {
  for (const [name, html] of PAGES) assert.doesNotMatch(html, /<iframe/i, name);
  assert.match(MARKUP, /data-frame-start="frame-tab-playground"/);
  assert.match(MARKUP, /<div data-frame-host hidden/);
});

test('every chart of CHARTS exists with a title and a description and is inlined', () => {
  assert.ok(CHARTS.length >= 5);
  const grafy = PAGES.get(pageOf('grafy'));
  for (const name of CHARTS) {
    const svg = FILES.get(`charts/${name}.svg`)?.toString('utf8');
    assert.ok(svg, `charts/${name}.svg`);
    assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
    assert.match(svg, new RegExp(`<title id="oscilla-chart-${name}-t">[^<]+</title>`));
    assert.match(svg, new RegExp(`<desc id="oscilla-chart-${name}-d">[^<]+</desc>`));
    assert.ok(grafy.includes(svg.trim()), `${name} inlined byte for byte on grafy/`);
    assert.ok(grafy.includes(`<figure id="graf-${name}" `), `grafy/#graf-${name}`);
    // the front page shows the same file as an image, linking its interactive card
    const title = /<title id="[^"]+">([^<]+)<\/title>/.exec(svg)[1];
    assert.match(MARKUP, new RegExp(`<a href="grafy/#graf-${name}" [^>]*><img `
      + `src="charts/${name}\\.svg" alt="${title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\. `
      + '[^"]+" width="\\d+" height="\\d+" loading="lazy"'), `front-page image of ${name}`);
    assert.ok(!HTML.includes(svg.trim()), `${name} is not inlined on the front page`);
  }
});

// A dashboard's section is on its own sub-page; any other section on the front page.
const section = (id) => {
  const page = SUBPAGES.some((p) => p.dir === id) ? pageOf(id) : 'index.html';
  const markup = stripScripts(PAGES.get(page));
  const at = markup.indexOf(`<section id="${id}"`);
  assert.ok(at >= 0, `section #${id} in ${page}`);
  return markup.slice(at, markup.indexOf('</section>', at));
};
/** The page's nav entry for `dir`: in-page on its own page, aria-current, else relative. */
const navEntry = (dir) => new RegExp(`<a href="#${dir}" class="[^"]*" aria-current="page">`);
const REF = FACTS.git.head.slice(0, LINK_SHA);
const BLOB = new RegExp(`^https://github\\.com/korczis/oscilla/blob/${REF}/(.+)$`);

test('the P015 dashboards exist, each with its nav entry and its source named', () => {
  for (const [id, heading] of [['zmeny', 'Co přinesla která verze'], ['roadmapa', 'Roadmapa'],
    ['tvrzeni', 'Průzkumník tvrzení'], ['adr', 'Rozhodnutí (ADR)']]) {
    assert.ok(section(id).includes(`>${heading}</h1>`), heading);
    assert.match(PAGES.get(pageOf(id)), navEntry(id), `nav ${id}/`);
    assert.match(MARKUP, new RegExp(`<a href="${id}/" class=`), `front-page nav ${id}/`);
  }
  assert.ok(section('zmeny').includes(esc(FACTS.releaseChanges.source)), 'changelog source');
  assert.ok(section('tvrzeni').includes(esc(FACTS.claims.areaRule)), 'area rule');
  const top = section('top');
  assert.match(top, /commitů<\/dd>/);
  assert.match(top, /rozhodnutí \(ADR\)<\/dd>/);
});

test('the changelog has a card per release tag, with plan-id chips and PR links that resolve',
  { skip: NO_HISTORY }, () => {
    const z = section('zmeny');
    const cards = [...z.matchAll(/<details class="lab-rel [^"]*" data-release="([^"]+)"/g)]
      .map((m) => m[1]);
    const tags = FACTS.releaseChanges.items.map((r) => r.tag).reverse();
    assert.ok(tags.length > 10, `release tags: ${tags.length}`);
    assert.deepEqual(cards.filter((c) => c.startsWith('v')), tags, 'newest first, every tag');
    let chips = 0;
    for (const [, url] of z.matchAll(/<a href="([^"]+\/\.ai\/repo\/project\/issues\/[^"]+)"/g)) {
      const rel = BLOB.exec(url)?.[1];
      assert.ok(rel && existsSync(path.join(REPO_ROOT, rel)), `${url} names an existing issue`);
      chips += 1;
    }
    assert.ok(chips > 0, 'plan-id chips exist');
    const prs = FACTS.releaseChanges.items.flatMap((r) => r.prs);
    for (const n of prs.slice(-20)) assert.ok(z.includes(`/pull/${n}">#${n}</a>`), `PR #${n}`);
    // CHANGELOG_FULL_RELEASES: the unreleased changes and the newest releases list each commit
    // once; an older release links its compare view instead and lists none.
    assert.equal(CHANGELOG_FULL_RELEASES, 8);
    const items = FACTS.releaseChanges.items.slice().reverse();
    const full = items.slice(0, CHANGELOG_FULL_RELEASES);
    const commits = full.reduce((n, r) => n + r.commits, 0)
      + (FACTS.releaseChanges.unreleased?.commits ?? 0);
    assert.equal(z.split('/commit/').length - 1, commits, 'every listed commit once');
    assert.ok(z.includes(`u ${CHANGELOG_FULL_RELEASES} nejnovějších vydání`), 'rule stated');
    const card = (tag) => {
      const at = z.indexOf(`data-release="${tag}"`);
      return z.slice(at, z.indexOf('</details>\n', at));
    };
    for (const r of full) assert.doesNotMatch(card(r.tag), /data-commits-elsewhere/, r.tag);
    for (const r of items.slice(CHANGELOG_FULL_RELEASES)) {
      const c = card(r.tag);
      assert.doesNotMatch(c, /\/commit\//, `${r.tag} lists no commit`);
      assert.match(c, /data-commits-elsewhere>Jednotlivé commity: viz <a /, r.tag);
      const link = r.from ? `/compare/${r.from}...${r.tag}"` : `/commits/${r.tag}"`;
      assert.ok(c.includes(link), `${r.tag} links ${link}`);
      for (const id of r.planIds) assert.ok(c.includes(`/issues/${id}.yaml"`), `${r.tag} ${id}`);
      for (const n of r.prs) assert.ok(c.includes(`/pull/${n}"`), `${r.tag} #${n}`);
    }
    // The changelog's page has its own ceiling since P018 (PAGE_CEILING below).
  });

test('the claims explorer has a row per claim, linking its source, code and test', () => {
  const t = section('tvrzeni');
  assert.match(t, /<div data-claims-controls hidden /, 'filters hidden until the script runs');
  assert.match(t, /<input type="search" id="claims-q"/);
  for (const c of FACTS.claims.items) {
    const at = t.indexOf(`<tr data-claim="${c.id}" data-status="${c.status}" `
      + `data-area="${c.area}"`);
    assert.ok(at >= 0, `row ${c.id}`);
    const row = t.slice(at, t.indexOf('</tr>', at));
    for (const p of [c.source, c.implementation, c.test].filter((x) => x && x !== '-')) {
      assert.ok(row.includes(`/blob/${REF}/${p}"`), `${c.id} links ${p}`);
    }
  }
  for (const area of Object.keys(FACTS.claims.byArea)) {
    assert.ok(t.includes(`<option value="${area}">`), `area filter ${area}`);
  }
});

test('the roadmap lists every milestone under its intents, and the ADR table every ADR', () => {
  const r = section('roadmapa');
  for (const i of FACTS.roadmap.items) assert.ok(r.includes(`data-intent="${i.id}"`), i.id);
  for (const ms of FACTS.plan.items) {
    assert.ok(r.includes(`/blob/${REF}/.ai/repo/project/milestones/${ms.id}.yaml"`),
      ms.id);
  }
  assert.match(r, /<div data-roadmap-controls hidden /);
  const a = section('adr');
  for (const x of FACTS.adrs.items) {
    assert.ok(a.includes(`/blob/${REF}/${x.path}"`), x.path);
  }
});

test('the P016 sections exist with their nav entries, each naming its source', () => {
  for (const [id, heading] of [['dluh', 'Dluh, který jen klesá'],
    ['revize', 'Revize a jejich nálezy']]) {
    assert.ok(section(id).includes(`>${heading}</h1>`), heading);
    assert.match(PAGES.get(pageOf(id)), navEntry(id), `nav ${id}/`);
    assert.match(MARKUP, new RegExp(`<a href="${id}/" class=`), `front-page nav ${id}/`);
  }
  assert.ok(section('dluh').includes(esc(FACTS.ratchets.source)), 'ratchets source');
  assert.ok(section('dluh').includes(esc(FACTS.ratchets.rule)), 'ratchets derivation');
  assert.ok(section('revize').includes(esc(FACTS.reviews.dateSource)), 'review dates source');
  const g = section('grafy');
  assert.match(g, /Nic se neodhaduje, neinterpoluje ani nedopočítává/);
  for (const name of CHARTS) {
    const group = FACTS[CHART_GROUP[name]];
    assert.ok(group?.source, `${name}: fact group ${CHART_GROUP[name]}`);
    const at = g.indexOf(`data-chart="${name}"`);
    const card = g.slice(at, g.indexOf('</figure>', at));
    assert.ok(card.includes(`<p class="lab-src">Zdroj: <code>${esc(group.source)}`), name);
  }
});

test('a card per ratchet baseline, linking its file, its enforcing test and its rule', () => {
  const d = section('dluh');
  const rule = ruleFileOf(REPO_ROOT);
  assert.ok(FACTS.ratchets.items.length >= 8, `ratchets: ${FACTS.ratchets.items.length}`);
  for (const it of FACTS.ratchets.items) {
    const at = d.indexOf(`data-ratchet="${it.file}"`);
    assert.ok(at >= 0, `card ${it.file}`);
    const card = d.slice(at, d.indexOf('</article>', at));
    const c = RATCHET_COPY[it.file];
    assert.ok(card.includes(`>${esc(c.name)}</h3>`), it.file);
    assert.ok(card.includes(`/blob/${REF}/${it.file}"`), `${it.file} links itself`);
    assert.ok(card.includes(`/blob/${REF}/${c.test}"`), `${it.file} links ${c.test}`);
    assert.ok(readFileSync(path.join(REPO_ROOT, c.test), 'utf8')
      .includes(path.basename(it.file)), `${c.test} reads ${it.file}`);
    if (c.rule) {
      const file = rule(c.rule);
      assert.ok(existsSync(path.join(REPO_ROOT, file)), file);
      assert.ok(card.includes(`/blob/${REF}/${file}"`), `${it.file} links ${file}`);
    }
    assert.ok(card.includes(it.rises === 0 ? '>jen klesá</span>' : 'nárůst'), `${it.file} rises`);
  }
  assert.throws(() => rule('project.no-such-rule'), /has no file/);
});

test('the review table has a row per record, newest first, naming every open P0 and P1', () => {
  const r = section('revize');
  const row = new RegExp('<tr><th scope="row"><a href="https://github\\.com/korczis/oscilla/'
    + 'pull/(\\d+)">', 'g');
  const prs = [...r.matchAll(row)].map((m) => Number(m[1]));
  assert.deepEqual(prs, FACTS.reviews.items.map((x) => x.pr).reverse());
  const open = FACTS.reviews.items.reduce((n, x) => n + x.openBySeverity.P0
    + x.openBySeverity.P1, 0);
  const named = [...r.matchAll(/>(\d+) P[01] otevřený</g)].reduce((n, m) => n + Number(m[1]), 0);
  assert.equal(named, open, 'every open P0 and P1 is named in its row');
  assert.ok(r.includes(`>${FACTS.reviews.totals.reviews}</dt>`), 'the record count');
});

test('a release whose tree has no claims ledger reads as absent in the trend, not as zero', () => {
  const facts = clone(FACTS);
  facts.claimsPerRelease.items[0] = { ...facts.claimsPerRelease.items[0], present: false,
    total: null, byStatus: null };
  const t = chartTable('claims-trend', facts);
  assert.equal(t.rows[t.rows.length - 1][t.head.length - 1], 'soubor chybí');
  assert.ok(t.rows[t.rows.length - 1].slice(1, -1).every((c) => c === 'chybí'));
});

test('mutation: a ratchet baseline without Czech copy fails the generator', async () => {
  const f = clone(FACTS);
  f.ratchets.items.push({ ...f.ratchets.items[0], file: 'tests/unit/new-debt-baseline.json' });
  await assert.rejects(generateLanding({ facts: f }),
    /no Czech copy for ratchet "tests\/unit\/new-debt-baseline\.json"/);
});

test('mutation: a registry id without Czech copy fails the generator', async () => {
  const ws = clone(FACTS);
  ws.workspaces.items.push({ ...ws.workspaces.items[0], id: 'fake-workspace' });
  await assert.rejects(generateLanding({ facts: ws }),
    /no Czech copy for workspace "fake-workspace"/);
  const en = clone(FACTS);
  en.engines.items.push({ id: 'fake-engine', label: 'FAKE' });
  await assert.rejects(generateLanding({ facts: en }), /no Czech copy for engine "fake-engine"/);
});

test('mutation: verify-deploy names a lab file that differs from its regeneration', () => {
  const expected = FILES.get('charts/plan.svg');
  const ok = { name: 'charts/plan.svg', status: 200, contentType: 'image/svg+xml',
    body: expected, expected };
  assert.deepEqual(checkLabFile(ok), []);
  assert.match(checkLabFile({ ...ok, body: Buffer.concat([expected, Buffer.from('x')]) })[0],
    /^lab: charts\/plan\.svg .* differs from its regeneration/);
  assert.match(checkLabFile({ ...ok, status: 404 })[0], /HTTP 404/);
  assert.match(checkLabFile({ ...ok, contentType: 'text/plain' })[0], /content-type/);
});

test('expectedLab regenerates a commit behind HEAD from its own tree, never from HEAD', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'oscilla-lab-fixture-'));
  const git = (...a) => execFileSync('git', a, { cwd: dir, encoding: 'utf8' }).trim();
  const stub = (tag) => 'export async function generateLanding({ commit }) {\n'
    + `  return new Map([['index.html', Buffer.from('${tag} ' + commit)]]);\n}\n`;
  try {
    git('init', '--quiet');
    git('config', 'user.email', 'fixture@example.invalid');
    git('config', 'user.name', 'fixture');
    writeFileSync(path.join(dir, 'README.md'), 'before the landing\n');
    git('add', '-A');
    git('commit', '--quiet', '-m', 'before');
    const before = git('rev-parse', 'HEAD');
    mkdirSync(path.join(dir, 'scripts'));
    writeFileSync(path.join(dir, 'scripts', 'landing.mjs'), stub('old'));
    git('add', '-A');
    git('commit', '--quiet', '-m', 'old generator');
    const old = git('rev-parse', 'HEAD');
    writeFileSync(path.join(dir, 'scripts', 'landing.mjs'), stub('new'));
    git('add', '-A');
    git('commit', '--quiet', '-m', 'new generator');
    const head = git('rev-parse', 'HEAD');

    // A foreign worktree whose directory is momentarily missing: its record must survive.
    const foreign = path.join(dir, '..', `${path.basename(dir)}-foreign`);
    git('worktree', 'add', '--detach', '--quiet', foreign, before);
    rmSync(foreign, { recursive: true, force: true });
    const records = () => git('worktree', 'list', '--porcelain').split('\n')
      .filter((l) => l.startsWith('worktree ')).length;
    assert.equal(records(), 2);

    const atHead = await expectedLab({ root: dir, commit: head });
    assert.equal(atHead.get('index.html').toString(), `new ${head}`);
    const behind = await expectedLab({ root: dir, commit: old });
    assert.equal(behind.get('index.html').toString(), `old ${old}`);
    assert.equal(await expectedLab({ root: dir, commit: before }), null);
    assert.equal(records(), 2, 'the temporary worktree is removed and the foreign one kept');
    assert.match(git('worktree', 'list', '--porcelain'), /-foreign/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// A review audit injected into the repository's facts: one finding of each class.
function auditFacts() {
  const f = clone(FACTS);
  const issue = '.ai/repo/project/issues/P016.yaml';
  const row = (pr, id, severity, cls, extra) => ({ source: `${pr}.yaml#${id}`, pr, id, severity,
    title: `title ${id}`, class: cls, audit: '.ai/repo/reviews/audit-2026-11-10.yaml',
    auditDate: '2026-11-10', evidence: null, issue: null, issueFile: null, commit: null,
    ...extra });
  f.reviewAudits = {
    source: '.ai/repo/reviews/audit-*.yaml (review-audit/v1) + .ai/repo/reviews/<pr>.yaml',
    rule: 'fixture rule', commitRule: 'fixture commit rule', severities: ['P0', 'P1', 'P2'],
    classes: ['open', 'fixed', 'superseded', 'unaudited'],
    audits: [{ file: '.ai/repo/reviews/audit-2026-11-10.yaml', schema: 'review-audit/v1',
      date: '2026-11-10', base: 'b8bfd3b613b9e4aac63267343c14bd1ee91f2a02', baseKnown: true,
      auditors: ['oscilla-c3', 'rev-seat-2'], scope: 'open findings of severity P0-P2',
      summary: { p0_p2: 4 } }],
    perFinding: [
      row(164, 'R1-P2-4b', 'P2', 'open', { evidence: 'still open <here>', issue: 'P016',
        issueFile: issue }),
      row(303, 'R-1', 'P1', 'fixed', { evidence: '9898b9e2 fix(audio): clamp',
        commit: '9898b9e2ab12cd34ef56ab78cd90ef12ab34cd56' }),
      row(304, 'R-2', 'P2', 'fixed', { evidence: 'fixed in prose' }),
      row(425, 'R1', 'P1', 'superseded', { evidence: '#425 closed unmerged' }),
      row(512, 'R2-511-9', 'P2', 'unaudited', { audit: null, auditDate: null }),
    ],
    unaudited: ['512.yaml#R2-511-9'], orphans: [{ source: '99.yaml#X', pr: 99, id: 'X',
      class: 'fixed', audit: '.ai/repo/reviews/audit-2026-11-10.yaml' }],
    split: { open: 1, fixed: 2, superseded: 1, unaudited: 1, total: 5 },
    bySeverity: {}, p3: { audit: '.ai/repo/reviews/audit-2026-11-10.yaml', total: 435,
      open: 318, byClass: { fixed: 9, superseded: 5, open: 17, unclassified: 287 },
      signals: { named_nowhere: 141 }, sample: 31 },
  };
  return f;
}

const sectionOf = (html, id) => {
  const markup = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '<script></script>');
  const at = markup.indexOf(`<section id="${id}"`);
  return markup.slice(at, markup.indexOf('</section>', at));
};

test('the reviews section shows the latest audit and its classes of every open P0-P2', async () => {
  const f = auditFacts();
  const files = await generateLanding({ facts: f });
  const r = sectionOf(files.get('revize/index.html').toString('utf8'), 'revize');
  const audit = r.slice(r.indexOf('data-audit>'));
  assert.ok(audit.length > 0 && r.includes('data-audit>'), 'the audit block');
  assert.ok(audit.includes('>audit-2026-11-10.yaml</a>'), 'the audit file');
  assert.match(audit, /<time datetime="2026-11-10">10\.\s11\.\s2026<\/time>/, 'its date');
  assert.ok(audit.includes('href="https://github.com/korczis/oscilla/commit/'
    + 'b8bfd3b613b9e4aac63267343c14bd1ee91f2a02"'), 'its base links the commit');
  assert.ok(audit.includes('<code class="text-xs">oscilla-c3</code>, '
    + '<code class="text-xs">rev-seat-2</code>'), 'its auditors');
  assert.ok(audit.includes('<dd lang="en" class="font-medium text-gray-900 dark:text-white">'
    + 'open findings of severity P0-P2</dd>'), 'its scope');
  const rows = [...audit.matchAll(/<tr data-class="([a-z]+)">([\s\S]*?)<\/tr>/g)];
  assert.deepEqual(rows.map((m) => m[1]),
    ['open', 'fixed', 'fixed', 'superseded', 'unaudited']);
  const [open, fixed, prose, superseded, unaudited] = rows.map((m) => m[2]);
  for (const [cells, pr, label] of [[open, 164, 'Stále otevřené'], [fixed, 303, 'Opraveno'],
    [superseded, 425, 'Nahrazeno'], [unaudited, 512, 'Neauditováno']]) {
    assert.ok(cells.includes(`<a href="https://github.com/korczis/oscilla/pull/${pr}">#${pr}</a>`),
      `${pr} links its pull request`);
    assert.ok(cells.includes(`>${label}</span>`), `${pr}: ${label}`);
  }
  assert.ok(open.includes('<td lang="en">still open &lt;here&gt;</td>'), 'evidence as written');
  assert.match(open, new RegExp(`<a href="https://github\\.com/korczis/oscilla/blob/${REF}/`
    + '\\.ai/repo/project/issues/P016\\.yaml">P016</a>'), 'an open finding links its issue');
  assert.ok(fixed.includes('<a href="https://github.com/korczis/oscilla/commit/9898b9e2ab12">'
    + '9898b9e</a>'), 'a fixed finding links its commit');
  assert.ok(prose.includes('důkaz neuvádí commit z main'), 'a fixed finding without one says so');
  assert.ok(audit.includes('commit: <code>fixture commit rule</code>'), 'the commit rule');
  assert.ok(unaudited.includes('Žádný audit tento nález nejmenuje. Ve verdiktu: '
    + '<span lang="en">title R2-511-9</span>'), 'an unaudited finding shows its verdict title');
  assert.match(audit, /<div data-audit-controls hidden class="lab-filter/);
  for (const [v, label, n] of [['', 'Vše', 5], ['open', 'Stále otevřené', 1],
    ['fixed', 'Opraveno', 2], ['superseded', 'Nahrazeno', 1], ['unaudited', 'Neauditováno', 1]]) {
    assert.ok(audit.includes(`data-audit-filter="${v}" aria-pressed="${v === ''}">${label} `
      + `<span>${n}</span></button>`), `chip ${label}`);
  }
  assert.match(audit, /neklasifikováno 287<\/strong>/, 'the P3 remainder is named');
  assert.ok(audit.includes('<code class="text-xs">99.yaml#X</code>'), 'the orphan is named');
  assert.match(audit, /Záznamy revizí jsou historické: stav nálezu v nich zůstává/);
  assert.ok(r.includes(`>${f.reviews.totals.reviews}</dt>`), 'P016\'s counts stay');
  const svg = files.get('charts/reviews.svg').toString('utf8');
  assert.match(svg, /Otevřené P0–P2 podle auditu z 10\.\s11\.\s2026/);
  assert.match(svg, /Stále otevřené 1<\/text>/);
  assert.match(svg, /Opraveno 2<\/text>/);
  assert.ok(files.get('revize/index.html').length <= PAGE_CEILING['revize/index.html'],
    'inside the page ceiling');
});

test('with no audit the section says so and keeps P016\'s counts and chart', async () => {
  const f = auditFacts();
  f.reviewAudits = { ...f.reviewAudits, audits: [], p3: null, orphans: [] };
  const files = await generateLanding({ facts: f });
  const r = sectionOf(files.get('revize/index.html').toString('utf8'), 'revize');
  assert.match(r, /data-audit-none>/);
  assert.match(r, /zatím žádný audit/);
  assert.doesNotMatch(r, /data-audit>|<tr data-class=/);
  assert.ok(r.includes(`>${f.reviews.totals.reviews}</dt>`), 'the record count');
  const svg = files.get('charts/reviews.svg').toString('utf8');
  assert.doesNotMatch(svg, /podle auditu/);
  const p016 = clone(FACTS);
  delete p016.reviewAudits;
  const { renderCharts } = await import('../../scripts/landing/charts.mjs');
  assert.equal(svg, renderCharts(p016).reviews, 'the chart is P016\'s, byte for byte');
});
