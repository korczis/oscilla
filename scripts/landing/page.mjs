// The markup of the generated landing at /oscilla/lab/ (plan P014, owner decision Q107): Czech
// pages on Flowbite Pro's marketing blocks (header navbar, breadcrumb, hero with app preview,
// card statistics, feature card list, tabs, project-portfolio grid with a modal, timeline,
// footer), adapted into OSCILLA's own markup; no Pro source file is copied. Every number and
// list comes from the facts (scripts/facts.mjs); every sentence from scripts/landing/copy.mjs or
// here. Plan P018: the front page (lab/index.html) stays light for a phone (hero, playable
// frame, workspaces, gallery, the chart overview as images, a teaser card per dashboard); each
// heavy dashboard is its own page lab/<dir>/index.html (SUBPAGES), with the same header, nav,
// footer, theme toggle, CSS and script, and every link written relative to its own page.
//
//   renderPages(model) -> [[path, html]] for the front page and every sub-page, each with the
//   markers STYLE and SCRIPT still in place (scripts/landing.mjs compiles Tailwind once over
//   all of them, then fills them).

import { createHash } from 'node:crypto';
import {
  esc, fmtDate, fmtDec, fmtInt, MB, chartTable, ratchetCell, ratchetFiles, ratchetSpark,
  ratchetValue,
} from './charts.mjs';
import { shownText } from './format.mjs';
import {
  ADR_STATUS_COPY, AREA_COPY, AUDIT_CLASS_COPY, CATEGORY_COPY, CLAIM_STATUS_COPY, COMMIT_TYPE_COPY,
  CHANGELOG_FULL_RELEASES, COMMIT_TYPES_OPEN, ENGINE_COPY, FRAME_TABS, GROUP_COPY,
  PLAN_STATUS_COPY, RATCHET_COPY, VERDICT_COPY, WORKSPACE_COPY,
} from './copy.mjs';

export const STYLE_MARKER = '<!-- lab:style -->';
export const SCRIPT_MARKER = '<!-- lab:script -->';
export const REPO_URL = 'https://github.com/korczis/oscilla';
/**
 * The length of the commit id in the page's blob, tree and commit links: GitHub resolves an
 * abbreviated id, and twelve hex digits stay unambiguous in this repository while sparing
 * 28 bytes on each of about 1 600 links.
 */
export const LINK_SHA = 12;

// The page's own policy: nothing but this origin, inline style, data: images, and only the
// inline scripts it carries, each by its SHA-256 (review r517b P3-2): THEME_SCRIPT and the
// bundled client. The page is rendered with SCRIPT_HASHES_MARKER in place of their hashes;
// scripts/landing.mjs computes them from the bytes it inlines (scriptHash) and fills it in.
export const SCRIPT_HASHES_MARKER = '__LAB_SCRIPT_HASHES__';
export const cspWith = (scriptSrc) => "default-src 'none'; img-src 'self' data:; "
  + `style-src 'unsafe-inline'; script-src ${scriptSrc}; frame-src 'self'; base-uri 'none'; `
  + "form-action 'none'";
/** The CSP source of one inline script: 'sha256-<base64 of the SHA-256 of its UTF-8 text>'. */
export function scriptHash(text) {
  return `'sha256-${createHash('sha256').update(text, 'utf8').digest('base64')}'`;
}
/** The head's theme script: the stored or preferred theme, before the first paint. */
export const THEME_SCRIPT = "(function(){var t=null;try{t=localStorage.getItem('oscilla-lab-theme')"
  + "}catch(e){}var d=t?t==='dark':window.matchMedia('(prefers-color-scheme: dark)').matches;"
  + "document.documentElement.classList.toggle('dark',d)})();";

const GITHUB_MARK = '<svg aria-hidden="true" focusable="false" class="h-5 w-5" '
  + 'viewBox="0 0 16 16" fill="currentColor"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 '
  + '5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-'
  + '.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.'
  + '28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 '
  + '.67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 '
  + '1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 '
  + '1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/></svg>';

const BTN_PRIMARY = 'inline-flex items-center justify-center rounded-lg bg-primary-700 px-5 '
  + 'py-3 text-center text-base font-medium text-white hover:bg-primary-800 focus:outline-none '
  + 'focus:ring-4 focus:ring-primary-300 dark:bg-primary-600 dark:hover:bg-primary-700 '
  + 'dark:focus:ring-primary-800';
const BTN_OUTLINE = 'inline-flex items-center justify-center rounded-lg border border-gray-300 '
  + 'px-5 py-3 text-center text-base font-medium text-gray-900 hover:bg-gray-100 '
  + 'focus:outline-none focus:ring-4 focus:ring-gray-100 dark:border-gray-700 dark:text-white '
  + 'dark:hover:bg-gray-700 dark:focus:ring-gray-800';
const LINK = 'font-medium text-primary-700 underline-offset-2 hover:underline '
  + 'focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 rounded '
  + 'dark:text-primary-400';
const CARD = 'rounded-lg border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-700 '
  + 'dark:bg-gray-800';
// The Pro badge, its colours as @apply components (scripts/landing.mjs LIST_CSS): the page
// shows hundreds of them, so each carries two short classes instead of fourteen.
const BADGE = 'lab-badge';
const BADGE_BLUE = 'lab-badge lab-badge-blue';
const BADGE_GRAY = 'lab-badge lab-badge-gray';
const H2 = 'mb-4 text-3xl font-extrabold tracking-tight text-gray-900 dark:text-white';
const LEAD = 'mb-8 max-w-3xl text-gray-500 dark:text-gray-400 sm:text-lg';
const SECTION = 'scroll-mt-20 bg-white dark:bg-gray-900';
const SECTION_ALT = 'scroll-mt-20 bg-gray-50 dark:bg-gray-800/40';
const WRAP = 'mx-auto max-w-screen-xl px-4 py-12 lg:px-6 lg:py-16';

/**
 * The dashboard sub-pages (plan P018), each lab/<dir>/index.html with one section whose id is
 * its dir; `nav` is its entry in the shared navbar, `title` its H1 and <title>, `en` the words
 * the README links it by (scripts/readme.mjs), `icon` its Lucide icon on the teaser card.
 */
export const SUBPAGES = Object.freeze([
  { dir: 'grafy', nav: 'Grafy', title: 'Grafy z repozitáře', en: 'charts', icon: 'chart-column',
    desc: 'Všechny grafy OSCILLA z repozitáře, interaktivně a s tabulkou hodnot.' },
  { dir: 'tvrzeni', nav: 'Tvrzení', title: 'Průzkumník tvrzení', en: 'claims explorer',
    icon: 'shield-check',
    desc: 'Každé tvrzení OSCILLA se zdrojem, kódem a testem, který ho dokazuje.' },
  { dir: 'zmeny', nav: 'Změny', title: 'Co přinesla která verze', en: 'per-release changes',
    icon: 'git-commit', desc: 'Commity, úkoly plánu a pull requesty každého vydání OSCILLA.' },
  { dir: 'roadmapa', nav: 'Roadmapa', title: 'Roadmapa', en: 'roadmap', icon: 'milestone',
    desc: 'Záměry a milníky plánu OSCILLA a kolik jejich úkolů je hotovo.' },
  { dir: 'dluh', nav: 'Dluh', title: 'Dluh, který jen klesá', en: 'ratchets',
    icon: 'trending-down', desc: 'Každý ratchet OSCILLA s hodnotou v každém vydání a teď.' },
  { dir: 'revize', nav: 'Revize', title: 'Revize a jejich nálezy', en: 'reviews and audits',
    icon: 'clipboard-check',
    desc: 'Záznamy revizí OSCILLA, jejich nálezy a co z nich podle auditu platí dnes.' },
  { dir: 'adr', nav: 'ADR', title: 'Rozhodnutí (ADR)', en: 'ADRs', icon: 'scroll-text',
    desc: 'Rozhodnutí o architektuře OSCILLA se stavem a datem.' },
]);
/** The front page's own sections in the navbar, before the sub-pages. */
const FRONT_NAV = [['hrat', 'Hrát'], ['plochy', 'Plochy'], ['galerie', 'Galerie']];
const BADGE_GREEN = 'lab-badge lab-badge-green';
const BADGE_INDIGO = 'lab-badge lab-badge-indigo';
const TYPE_BADGE = Object.freeze({ feat: 'lab-badge-blue', fix: 'lab-badge-indigo',
  perf: 'lab-badge-green' });
const PLAN_BADGE = Object.freeze({ DONE: BADGE_GREEN, ACTIVE: BADGE_BLUE, OPEN: BADGE_GRAY });
const ADR_BADGE = Object.freeze({ accepted: BADGE_GREEN, proposed: BADGE_GRAY });
const FOCUS = 'focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500';
const INPUT = 'block w-full rounded-lg border border-gray-300 bg-gray-50 p-2.5 text-sm '
  + 'text-gray-900 focus:border-primary-500 focus:outline-none focus:ring-2 '
  + 'focus:ring-primary-500 dark:border-gray-600 dark:bg-gray-700 dark:text-white '
  + 'dark:placeholder-gray-400 dark:focus:border-primary-500 dark:focus:ring-primary-500';
const TH = 'px-4 py-3';
const TABLE = 'w-full text-left text-sm text-gray-500 dark:text-gray-400';
const THEAD = 'bg-gray-50 text-xs uppercase text-gray-700 dark:bg-gray-700 dark:text-gray-400';
const pct = (done, total) => (total > 0 ? Math.round((1000 * done) / total) / 10 : 0);
const plural = (n, one, few, many) => `${fmtInt(n)} ${n === 1 ? one : n >= 2 && n <= 4 ? few
  : many}`;

const VIEW_CS = Object.freeze({ timeline: 'časová osa', bay: 'patch bay',
  engines: 'záložka Engines', panel: 'panel', xy: 'záložka XY' });
const VIEWPORT_CS = Object.freeze({ phone: 'na telefonu', desktop: 'na počítači',
  compact: 'v kompaktním rozvržení' });
const THEME_CS = Object.freeze({ dark: 'tmavý motiv', light: 'světlý motiv' });

/** The Czech caption and alt text of a committed visual reference. */
export function shotText(shot, workspaces) {
  const ws = workspaces.find((w) => w.label === shot.workspace);
  const name = ws ? WORKSPACE_COPY[ws.id]?.name ?? shot.workspace : shot.workspace;
  const parts = [name];
  if (shot.view) parts.push(VIEW_CS[shot.view] ?? shot.view);
  const caption = `${parts.join(', ')} ${VIEWPORT_CS[shot.viewport] ?? ''}`.trim()
    + (THEME_CS[shot.theme] ? `, ${THEME_CS[shot.theme]}` : '');
  return { caption, alt: `${caption}: referenční snímek vizuální brány sestavené aplikace` };
}

const icon = (icons, name, cls = 'h-5 w-5') => icons(name, cls);

const NAV_LINK = 'block rounded-lg px-3 py-2 hover:bg-gray-100 focus:outline-none '
  + 'focus-visible:ring-2 focus-visible:ring-primary-500 dark:hover:bg-gray-700 xl:p-2 '
  + 'xl:hover:bg-transparent xl:hover:text-primary-700 dark:xl:hover:text-white';
const NAV_IDLE = 'text-gray-700 dark:text-gray-300';
const NAV_CURRENT = 'bg-primary-700 text-white dark:bg-primary-600 xl:bg-transparent '
  + 'xl:text-primary-700 dark:xl:bg-transparent dark:xl:text-primary-400';

function header(m) {
  const entry = (href, label, current) => `<li><a href="${esc(href)}" class="${NAV_LINK} `
    + `${current ? NAV_CURRENT : NAV_IDLE}"${current ? ' aria-current="page"' : ''}>${label}</a>`
    + '</li>';
  const links = [...FRONT_NAV.map(([id, label]) => entry(m.to('', id), label, false)),
    ...SUBPAGES.map((p) => entry(m.to(p.dir), p.nav, p.dir === m.page))].join('');
  return `<header class="sticky top-0 z-30">
<nav class="border-b border-gray-200 bg-white px-4 py-2.5 dark:border-gray-700 dark:bg-gray-800 xl:px-6" aria-label="Hlavní">
<div class="mx-auto flex max-w-screen-xl flex-wrap items-center justify-between">
<a href="${esc(m.to(''))}" class="flex items-center gap-3 rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500">${m.mark('h-8 w-8')}<span class="self-center whitespace-nowrap text-xl font-semibold text-gray-900 dark:text-white">OSCILLA</span></a>
<div class="flex items-center gap-2 xl:order-2">
<button type="button" data-theme-toggle aria-pressed="false" aria-label="Přepnout motiv" class="rounded-lg p-2.5 text-sm text-gray-500 hover:bg-gray-100 focus:outline-none focus:ring-4 focus:ring-gray-200 dark:text-gray-400 dark:hover:bg-gray-700 dark:focus:ring-gray-700"><span class="dark:hidden">${icon(m.icons, 'moon')}</span><span class="hidden dark:inline">${icon(m.icons, 'sun')}</span></button>
<a href="${esc(m.appHref)}" class="hidden rounded-lg bg-primary-700 px-4 py-2 text-sm font-medium text-white hover:bg-primary-800 focus:outline-none focus:ring-4 focus:ring-primary-300 dark:bg-primary-600 dark:hover:bg-primary-700 dark:focus:ring-primary-800 sm:inline-flex">Otevřít laboratoř</a>
<button type="button" data-lab-menu-toggle aria-controls="lab-menu" aria-expanded="false" class="inline-flex items-center rounded-lg p-2 text-sm text-gray-500 hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-gray-200 dark:text-gray-400 dark:hover:bg-gray-700 dark:focus:ring-gray-600 xl:hidden"><span class="sr-only">Otevřít menu</span>${icon(m.icons, 'menu', 'h-6 w-6')}</button>
</div>
<div class="hidden w-full items-center justify-between xl:order-1 xl:flex xl:w-auto" id="lab-menu">
<ul class="mt-4 flex flex-col font-medium xl:mt-0 xl:flex-row xl:space-x-1">${links}</ul>
</div>
</div>
</nav>
</header>`;
}

function stat(value, label) {
  return `<div class="flex flex-col items-center justify-center rounded-lg border border-gray-200 bg-white p-4 text-center dark:border-gray-700 dark:bg-gray-800"><dt class="mb-1 text-2xl font-extrabold text-gray-900 dark:text-white md:text-3xl">${value}</dt><dd class="text-sm text-gray-500 dark:text-gray-400">${label}</dd></div>`;
}

function hero(m) {
  const f = m.facts;
  const guaranteed = f.claims.byStatus.guaranteed ?? 0;
  const latest = m.latestRelease;
  return `<section id="top" class="bg-white dark:bg-gray-900">
<div class="mx-auto max-w-screen-xl px-4 pb-8 pt-10 text-center lg:px-12 lg:pt-16">
<a href="${esc(m.commitUrl)}" class="mb-7 inline-flex max-w-full items-center justify-between gap-2 rounded-full bg-gray-100 px-1 py-1 pe-4 text-sm text-gray-700 hover:bg-gray-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 dark:bg-gray-800 dark:text-white dark:hover:bg-gray-700"><span class="rounded-full bg-primary-600 px-3 py-1 text-xs text-white">${latest ? `v${esc(latest.version)}` : 'zdroj'}</span><span class="truncate text-sm font-medium">${latest ? 'poslední vydání · ' : ''}stránka z commitu ${esc(m.shortSha)} · ${esc(m.commitDay)}</span></a>
<div class="mb-6 flex justify-center">${m.mark('h-20 w-20 md:h-24 md:w-24')}</div>
<h1 class="mb-4 text-4xl font-extrabold leading-none tracking-tight text-gray-900 dark:text-white md:text-5xl lg:text-6xl">OSCILLA</h1>
<p class="mx-auto mb-3 max-w-3xl text-lg font-semibold text-gray-900 dark:text-white md:text-xl">Laboratoř zvuku a frekvencí v prohlížeči</p>
<p class="mx-auto mb-8 max-w-3xl text-gray-500 dark:text-gray-400 md:text-lg">Akustická laboratoř bez instalace a s vědeckou poctivostí: generujte, měřte a opakujte zvukové experimenty a vězte, nakolik lze každému výsledku věřit.</p>
<div class="mb-10 flex flex-col gap-4 sm:flex-row sm:justify-center">
<a href="${esc(m.appHref)}" class="${BTN_PRIMARY}">Otevřít laboratoř ${icon(m.icons, 'arrow-right', 'ms-2 h-5 w-5')}</a>
<a href="#hrat" class="${BTN_OUTLINE}">${icon(m.icons, 'play', 'me-2 h-5 w-5')} Vyzkoušet přímo tady</a>
</div>
<dl class="mx-auto grid max-w-screen-xl grid-cols-2 gap-4 sm:grid-cols-4 xl:grid-cols-8">
${stat(fmtInt(f.workspaces.items.length), 'pracovních ploch')}
${stat(fmtInt(f.templates.items.length), 'šablon Studia')}
${stat(fmtInt(f.engines.items.length), 'enginů Synthu')}
${stat(fmtInt(guaranteed), 'zaručených tvrzení')}
${stat(fmtInt(f.releases.items.length), 'vydání')}
${stat(`${fmtDec(f.dist.gzip / MB, 2)}&nbsp;MB`, 'jeden soubor, gzip')}
${stat(fmtInt(f.git.commits), 'commitů')}
${stat(fmtInt(f.adrs.total), 'rozhodnutí (ADR)')}
</dl>
</div>
</section>`;
}

function frameSection(m) {
  const tabs = m.frameTabs;
  const tabList = tabs.map((t, i) => `<li role="presentation"><button type="button" role="tab" id="frame-tab-${t.id}" aria-controls="frame-${t.id}" aria-selected="${i === 0}" tabindex="${i === 0 ? 0 : -1}" data-frame-hash="${esc(t.hash)}" data-frame-name="${esc(t.name)}" class="inline-block rounded-t-lg border-b-2 border-transparent p-4 hover:border-gray-300 hover:text-gray-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 dark:hover:text-gray-300">${esc(t.name)}</button></li>`).join('');
  const panels = tabs.map((t) => `<div id="frame-${t.id}" role="tabpanel" aria-labelledby="frame-tab-${t.id}" class="hidden">
<p class="mb-3 text-sm text-gray-500 dark:text-gray-400">${esc(t.text)} <a class="${LINK}" href="${esc(m.appHref + t.hash)}">Otevřít na celé stránce</a></p>
<div data-frame-poster class="relative overflow-hidden rounded-lg border border-gray-200 bg-gray-950 dark:border-gray-700">
${t.shot ? `<img src="shots/${esc(t.shot.file)}" alt="${esc(t.shot.alt)}" width="${t.shot.width}" height="${t.shot.height}" class="block h-auto w-full opacity-70" loading="lazy" decoding="async">` : '<div class="aspect-video"></div>'}
<div class="absolute inset-0 flex items-center justify-center p-4"><button type="button" data-frame-start="frame-tab-${t.id}" class="${BTN_PRIMARY} shadow-lg">${icon(m.icons, 'play', 'me-2 h-5 w-5')} Spustit ${esc(t.name)} v tomto okně</button></div>
</div>
</div>`).join('\n');
  return `<section id="hrat" class="${SECTION_ALT}" data-lab-frame data-app-href="${esc(m.appHref)}">
<div class="${WRAP}">
<h2 class="${H2}">Hrajte přímo tady</h2>
<p class="${LEAD}">Okno níže je skutečná aplikace z <a class="${LINK}" href="${esc(m.appHref)}">hlavní stránky</a>, jeden a tentýž soubor. Dokud nestisknete tlačítko, nenačte se a nic nehraje. Mikrofon aplikace použije jen tehdy, když ho v ní sami zapnete a prohlížeč vám to dovolí.</p>
<div class="mb-4 border-b border-gray-200 text-center text-sm font-medium text-gray-500 dark:border-gray-700 dark:text-gray-400">
<ul class="-mb-px flex flex-wrap" role="tablist" aria-label="Pracovní plocha v okně">${tabList}</ul>
</div>
${panels}
<div data-frame-host hidden class="h-[78vh] min-h-[520px] overflow-hidden rounded-lg border border-gray-200 dark:border-gray-700 lg:h-[760px]"></div>
<div data-frame-stop-row hidden><div class="mt-3 flex justify-end"><button type="button" data-frame-stop class="inline-flex items-center rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-900 hover:bg-gray-100 focus:outline-none focus:ring-4 focus:ring-gray-100 dark:border-gray-600 dark:bg-gray-800 dark:text-white dark:hover:bg-gray-700 dark:focus:ring-gray-700">${icon(m.icons, 'square', 'me-2 h-4 w-4')} Zavřít okno a ukončit zvuk</button></div></div>
</div>
</section>`;
}

function workspaceCards(m) {
  const cards = m.facts.workspaces.items.map((w) => {
    const c = WORKSPACE_COPY[w.id];
    const group = w.group ? `<span class="${BADGE_GRAY}">${esc(GROUP_COPY[w.group])}</span>` : '';
    return `<article class="${CARD} flex flex-col">
<div class="mb-4 flex items-center justify-between"><div class="flex h-10 w-10 items-center justify-center rounded-lg bg-primary-100 text-primary-700 dark:bg-primary-900 dark:text-primary-300">${m.workspaceIcon(w.id)}</div>${group}</div>
<h3 class="mb-2 text-xl font-bold text-gray-900 dark:text-white">${esc(c.name)}</h3>
<p class="mb-4 flex-1 text-gray-500 dark:text-gray-400">${esc(c.text)}</p>
<a href="${esc(`${m.appHref}#m=${w.id}`)}" class="${LINK} inline-flex items-center" data-workspace="${esc(w.id)}">Otevřít ${esc(c.name)} ${icon(m.icons, 'arrow-right', 'ms-1 h-4 w-4')}</a>
</article>`;
  }).join('\n');
  return `<section id="plochy" class="${SECTION}">
<div class="${WRAP}">
<h2 class="${H2}">Pracovní plochy</h2>
<p class="${LEAD}">Každá karta vede rovnou do aplikace. Seznam se generuje z jediného registru pracovních ploch v <a class="${LINK}" href="${esc(m.blob(m.facts.workspaces.source))}">${esc(m.facts.workspaces.source)}</a>, takže nová plocha se tu objeví s dalším nasazením.</p>
<div class="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
${cards}
</div>
</div>
</section>`;
}

function libraries(m) {
  const f = m.facts;
  const li = 'flex items-start justify-between gap-3 border-b border-gray-200 py-3 last:border-0 '
    + 'dark:border-gray-700';
  const templates = f.templates.items.map((t) => `<li class="${li}"><div class="min-w-0"><a class="${LINK}" href="${esc(`${m.appHref}#m=studio&st=${t.id}`)}">${esc(t.label)}</a></div><span class="${BADGE_BLUE} shrink-0">${esc(CATEGORY_COPY[t.category] ?? t.category)}</span></li>`).join('');
  const engines = f.engines.items.map((e) => `<li class="${li}"><div class="min-w-0"><a class="${LINK}" href="${esc(`${m.appHref}#m=synth&yt=engines&ye=${e.id}`)}">${esc(e.label)}</a><p class="text-sm text-gray-500 dark:text-gray-400">${esc(ENGINE_COPY[e.id])}</p></div></li>`).join('');
  const blocked = (f.engines.blocked || []).map((e) => `<li class="${li}"><span class="text-gray-400 dark:text-gray-500">${esc(e.label)}</span><span class="${BADGE_GRAY} shrink-0">zatím nenabízeno</span></li>`).join('');
  return `<section id="sablony" class="${SECTION_ALT}">
<div class="${WRAP}">
<h2 class="${H2}">Šablony Studia a enginy Synthu</h2>
<p class="${LEAD}">Odkaz otevře šablonu jako dokument Studia, nebo engine na záložce Engines Synthu. Zdroj: <a class="${LINK}" href="${esc(m.blob(f.templates.source))}">${esc(f.templates.source)}</a> a <a class="${LINK}" href="${esc(m.blob(f.engines.source))}">${esc(f.engines.source)}</a>.</p>
<div class="grid gap-6 lg:grid-cols-2">
<div class="${CARD}"><h3 class="mb-2 text-xl font-bold text-gray-900 dark:text-white">Šablony Studia (${fmtInt(f.templates.items.length)})</h3><ul>${templates}</ul></div>
<div class="${CARD}"><h3 class="mb-2 text-xl font-bold text-gray-900 dark:text-white">Enginy Synthu (${fmtInt(f.engines.items.length)})</h3><ul>${engines}${blocked}</ul>${blocked ? '<p class="mt-3 text-sm text-gray-500 dark:text-gray-400">Šedé enginy aplikace ukazuje vypnuté a u každého uvádí, proč ho zatím nenabízí.</p>' : ''}</div>
</div>
</div>
</section>`;
}

function gallery(m) {
  const items = m.shots.map((s) => `<li><button type="button" data-shot data-full="shots/${esc(s.file)}" data-alt="${esc(s.alt)}" data-caption="${esc(s.caption)}" data-width="${s.width}" data-height="${s.height}" class="group block w-full overflow-hidden rounded-lg border border-gray-200 bg-white text-left focus:outline-none focus:ring-4 focus:ring-primary-300 dark:border-gray-700 dark:bg-gray-800 dark:focus:ring-primary-800"><img src="shots/${esc(s.file)}" alt="${esc(s.alt)}" width="${s.width}" height="${s.height}" loading="lazy" decoding="async" class="block aspect-[4/3] w-full bg-gray-950 object-cover object-top"><span class="block p-3 text-sm text-gray-700 dark:text-gray-300">${esc(s.caption)}</span></button></li>`).join('\n');
  return `<section id="galerie" class="${SECTION}">
<div class="${WRAP}">
<h2 class="${H2}">Galerie</h2>
<p class="${LEAD}">Žádné makety: každý snímek je referenční obrázek, se kterým vizuální brána v CI porovnává sestavenou aplikaci (<a class="${LINK}" href="${esc(m.tree('tests/visual'))}">tests/visual</a>). Snímek otevřete kliknutím nebo klávesou Enter, šipkami listujete, Esc zavře.</p>
<ul class="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
${items}
</ul>
</div>
<div id="lab-lightbox" tabindex="-1" aria-hidden="true" role="dialog" aria-modal="true" aria-label="Snímek z galerie" class="fixed left-0 right-0 top-0 z-50 hidden h-full max-h-full w-full items-center justify-center overflow-y-auto overflow-x-hidden p-2 sm:p-4">
<div class="relative max-h-full w-full max-w-6xl">
<div class="relative rounded-lg bg-white shadow dark:bg-gray-800">
<div class="flex items-center justify-between gap-2 border-b border-gray-200 p-3 dark:border-gray-700">
<p class="min-w-0 truncate text-sm font-medium text-gray-900 dark:text-white" data-lightbox-caption></p>
<div class="flex shrink-0 items-center gap-1">
<span class="me-2 text-sm text-gray-500 dark:text-gray-400" data-lightbox-count></span>
<button type="button" data-lightbox-prev aria-label="Předchozí snímek" class="rounded-lg p-2 text-gray-500 hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-primary-500 dark:text-gray-400 dark:hover:bg-gray-700">${icon(m.icons, 'chevron-left')}</button>
<button type="button" data-lightbox-next aria-label="Další snímek" class="rounded-lg p-2 text-gray-500 hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-primary-500 dark:text-gray-400 dark:hover:bg-gray-700">${icon(m.icons, 'chevron-right')}</button>
<button type="button" data-lightbox-close aria-label="Zavřít" class="rounded-lg p-2 text-gray-500 hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-primary-500 dark:text-gray-400 dark:hover:bg-gray-700">${icon(m.icons, 'x')}</button>
</div>
</div>
<div class="bg-gray-950 p-2"><img data-lightbox-img alt="" class="mx-auto block max-h-[80vh] h-auto w-auto max-w-full"></div>
</div>
</div>
</div>
</section>`;
}

/** The fact group each chart draws from (scripts/facts.mjs), whose `source` the card names. */
export const CHART_GROUP = Object.freeze({ releases: 'releases', size: 'releases', plan: 'plan',
  claims: 'claims', activity: 'git', modules: 'codeInventory', growth: 'codeInventory',
  burnup: 'planBurnup', 'claims-trend': 'claimsPerRelease', ratchets: 'ratchets',
  reviews: 'reviews', cadence: 'releaseCadence' });

function chartsSection(m) {
  const cards = m.chartNames.map((name) => {
    const t = chartTable(name, m.facts);
    const group = m.facts[CHART_GROUP[name]];
    const source = group ? `${group.source}${group.field ? ` (${group.field})` : ''}${group.dateSource ? `; ${group.dateSource}` : ''}` : '';
    const rows = t.rows.map((r) => `<tr>${r.map((c, i) => (i === 0 ? `<th scope="row">${esc(c)}</th>` : `<td>${esc(c)}</td>`)).join('')}</tr>`).join('');
    return `<figure id="graf-${name}" class="min-w-0 scroll-mt-20 rounded-lg border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800">
<div data-chart-box class="relative"><div class="overflow-x-auto rounded-xl p-1 [&>svg]:block [&>svg]:h-auto [&>svg]:w-full [&>svg]:min-w-[540px] [&>svg]:rounded-xl [&>svg:focus]:outline-none [&>svg:focus-visible]:ring-4 [&>svg:focus-visible]:ring-primary-500">${m.charts[name].trim()}</div><p class="sr-only" aria-live="polite" data-chart-live></p></div>
<figcaption class="mt-3 flex flex-wrap items-center justify-between gap-2 text-sm text-gray-500 dark:text-gray-400"><span>Najetím, nebo po zaměření grafu šipkami, zobrazíte hodnoty. Na úzkém displeji graf posunete do strany.</span><a class="${LINK}" href="${m.up}charts/${name}.svg">SVG soubor</a></figcaption>
${source ? `<p class="lab-src">Zdroj: <code>${esc(source)}</code></p>` : ''}
<details class="mt-2 text-sm text-gray-500 dark:text-gray-400"><summary class="cursor-pointer rounded font-medium text-gray-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 dark:text-white">Tabulka hodnot</summary>
<div class="mt-2 max-h-72 overflow-auto"><table class="lab-ctable w-full text-left text-sm text-gray-500 dark:text-gray-400"><thead class="bg-gray-50 text-xs uppercase text-gray-700 dark:bg-gray-700 dark:text-gray-400"><tr>${t.head.map((h) => `<th scope="col" class="px-3 py-2">${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table></div>
</details>
</figure>`;
  }).join('\n');
  return `<section id="grafy" class="${SECTION_ALT}">
<div class="${WRAP}">
${pageHeading(m, 'grafy')}
<p class="${LEAD}">Grafy se kreslí při každém nasazení z commitu, který se nasazuje: z release záznamů v <a class="${LINK}" href="${esc(m.tree(m.facts.releases.source))}">${esc(m.facts.releases.source)}</a>, z plánu, z <a class="${LINK}" href="${esc(m.blob(m.facts.claims.source))}">${esc(m.facts.claims.source)}</a>, ze záznamů revizí, z historie gitu a ze stromů značek vydání. Nic se neodhaduje, neinterpoluje ani nedopočítává: každé číslo je spočítané ze souboru nebo příkazu gitu, který karta grafu uvádí, a co v souboru chybí, graf ukazuje jako chybějící, ne jako nulu. Tytéž soubory SVG ukazuje README.</p>
<div class="relative grid gap-6 lg:grid-cols-2">
${cards}
</div>
<div id="lab-chart-tip" role="presentation" hidden class="pointer-events-none absolute z-10 max-w-xs rounded-lg bg-gray-900 px-3 py-2 text-sm font-medium text-white shadow-sm dark:bg-gray-700"></div>
</div>
</section>`;
}

function proof(m) {
  const f = m.facts;
  const statuses = Object.keys(f.claims.byStatus);
  const cards = statuses.map((s) => {
    const c = CLAIM_STATUS_COPY[s] ?? { name: s, text: '' };
    return `<div class="${CARD}"><p class="mb-1 text-4xl font-extrabold text-gray-900 dark:text-white">${fmtInt(f.claims.byStatus[s])}</p><h3 class="mb-2 text-lg font-semibold text-gray-900 dark:text-white">${esc(c.name)}</h3><p class="text-gray-500 dark:text-gray-400">${esc(c.text)}</p></div>`;
  }).join('');
  return `<section id="dukazy" class="${SECTION}">
<div class="${WRAP}">
<h2 class="${H2}">Jak víme, že to platí</h2>
<p class="${LEAD}">Co OSCILLA tvrdí, stojí v matici tvrzení <a class="${LINK}" href="${esc(m.blob(f.claims.source))}">${esc(f.claims.source)}</a>: každé tvrzení jednou větou, se souborem, který chování definuje, se souborem, který ho implementuje, a s testem, který ho dokazuje. Zaručené tvrzení hlídá test v release gate a CI bez něj nic nesloučí. Úrovně jsou relativní (jako dBFS), dokud je nekalibrujete vůči vnějšímu referenčnímu měřidlu, a aplikace to vždy uvádí.</p>
<div class="mb-6 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
${cards}
<div class="${CARD}"><p class="mb-1 text-4xl font-extrabold text-gray-900 dark:text-white">${fmtInt(f.tests.unit)}</p><h3 class="mb-2 text-lg font-semibold text-gray-900 dark:text-white">souborů unit testů</h3><p class="text-gray-500 dark:text-gray-400">a ${fmtInt(f.tests.browser)} souborů prohlížečových sad; co každý dokazuje, popisuje <a class="${LINK}" href="${esc(m.blob('tests/README.md'))}">tests/README.md</a>.</p></div>
<div class="${CARD}"><p class="mb-1 text-4xl font-extrabold text-gray-900 dark:text-white">${fmtInt(f.adrs.total)}</p><h3 class="mb-2 text-lg font-semibold text-gray-900 dark:text-white">rozhodnutí (ADR)</h3><p class="text-gray-500 dark:text-gray-400">Proč je aplikace taková, jaká je: <a class="${LINK}" href="${esc(m.tree(f.adrs.source))}">${esc(f.adrs.source)}</a>.</p></div>
</div>
<p class="${CARD} text-gray-500 dark:text-gray-400">Všech ${fmtInt(f.claims.total)} tvrzení se stavem, oblastí, zdrojem, kódem a testem prohledáte v <a class="${LINK}" href="${esc(m.to('tvrzeni'))}">průzkumníku tvrzení</a>.</p>
</div>
</section>`;
}

function releasesSection(m) {
  const rs = m.timeline.map((r) => `<li class="mb-8 ms-6">
<span class="absolute -start-3 flex h-6 w-6 items-center justify-center rounded-full bg-primary-100 ring-8 ring-white dark:bg-primary-900 dark:ring-gray-900">${icon(m.icons, 'tag', 'h-3 w-3 text-primary-800 dark:text-primary-300')}</span>
<h3 class="mb-1 flex items-center text-lg font-semibold text-gray-900 dark:text-white"><a class="${LINK}" href="${esc(`${REPO_URL}/releases/tag/${r.tag}`)}">v${esc(r.version)}</a></h3>
<time class="mb-2 block text-sm font-normal leading-none text-gray-400 dark:text-gray-500" datetime="${esc(r.published_at)}">${esc(fmtDate(r.published_at))}</time>
<p class="text-gray-500 dark:text-gray-400">Jeden soubor HTML, ${Number.isFinite(r.size) ? `${fmtDec(r.size / MB)}&nbsp;MB` : 'velikost neuvedena'}${r.sha256 ? `, SHA-256 <code class="break-all text-xs">${esc(r.sha256.slice(0, 16))}…</code>` : ''}</p>
</li>`).join('\n');
  return `<section id="vydani" class="${SECTION}">
<div class="${WRAP}">
<h2 class="${H2}">Vydání</h2>
<p class="${LEAD}">Posledních ${fmtInt(m.timeline.length)} z ${fmtInt(m.facts.releases.items.length)} vydání. Každé je jeden soubor HTML, který si můžete stáhnout a otevřít i bez připojení; velikost a otisk pocházejí z release záznamu. <a class="${LINK}" href="${REPO_URL}/releases">Všechna vydání na GitHubu</a>.</p>
<ol class="relative ms-3 border-s border-gray-200 dark:border-gray-700">
${rs}
</ol>
</div>
</section>`;
}

/** A Flowbite progress bar (role progressbar) of `done` out of `total`. */
function progress(done, total, label, size = 'h-2.5') {
  return `<div class="lab-bar ${size}" role="progressbar" aria-label="${esc(label)}" aria-valuemin="0" aria-valuemax="${total}" aria-valuenow="${done}"><div style="width:${pct(done, total)}%"></div></div>`;
}

function claimsExplorer(m) {
  const f = m.facts;
  const c = f.claims;
  const pathLink = (label, p) => `<li><span>${label}</span> ${p && p !== '-' ? `<a href="${esc(m.blob(p))}">${esc(p)}</a>` : '–'}</li>`;
  const areaName = (a) => AREA_COPY[a] ?? a;
  const rows = c.items.map((x) => `<tr data-claim="${esc(x.id)}" data-status="${esc(x.status)}" data-area="${esc(x.area)}">
<th scope="row" class="font-normal"><code class="text-sm font-semibold text-gray-900 dark:text-white">${esc(x.id)}</code><p lang="en" class="mt-1 max-w-prose text-gray-600 dark:text-gray-300">${esc(x.claim)}</p></th>
<td><span class="${x.status === 'guaranteed' ? BADGE_BLUE : BADGE_GRAY}">${esc(CLAIM_STATUS_COPY[x.status]?.name ?? x.status)}</span></td>
<td><span class="${BADGE_GRAY}">${esc(areaName(x.area))}</span></td>
<td><ul class="lab-paths space-y-1 text-xs">${pathLink('zdroj', x.source)}${pathLink('kód', x.implementation)}${pathLink('test', x.test)}</ul></td>
</tr>`).join('\n');
  const option = (v, label, n) => `<option value="${esc(v)}">${esc(label)} (${fmtInt(n)})</option>`;
  const statusOpts = Object.entries(c.byStatus).map(([k, n]) => option(k, CLAIM_STATUS_COPY[k]?.name ?? k, n)).join('');
  const areaOpts = Object.entries(c.byArea).map(([k, n]) => option(k, areaName(k), n)).join('');
  return `<section id="tvrzeni" class="${SECTION_ALT}" data-claims>
<div class="${WRAP}">
${pageHeading(m, 'tvrzeni')}
<p class="${LEAD}">Všech ${fmtInt(c.total)} tvrzení z <a class="${LINK}" href="${esc(m.blob(c.source))}">${esc(c.source)}</a>, každé se souborem, který chování definuje, s kódem, který ho implementuje, a s testem, který ho dokazuje; odkazy vedou na GitHub do commitu, ze kterého je stránka. Oblast se odvozuje z cesty implementace (pravidlo pod tabulkou). Věty tvrzení jsou anglicky, jak stojí v matici.</p>
<div data-claims-controls hidden class="mb-4 grid gap-3 md:grid-cols-[1fr_12rem_14rem] md:items-end">
<div><label for="claims-q" class="mb-2 block text-sm font-medium text-gray-900 dark:text-white">Hledat</label><div class="relative"><div class="pointer-events-none absolute inset-y-0 start-0 flex items-center ps-3 text-gray-500 dark:text-gray-400">${icon(m.icons, 'search', 'h-4 w-4')}</div><input type="search" id="claims-q" autocomplete="off" placeholder="id, věta nebo cesta k souboru" class="${INPUT} ps-10"></div></div>
<div><label for="claims-status" class="mb-2 block text-sm font-medium text-gray-900 dark:text-white">Stav</label><select id="claims-status" class="${INPUT}"><option value="">Všechny stavy</option>${statusOpts}</select></div>
<div><label for="claims-area" class="mb-2 block text-sm font-medium text-gray-900 dark:text-white">Oblast</label><select id="claims-area" class="${INPUT}"><option value="">Všechny oblasti</option>${areaOpts}</select></div>
<p class="text-sm text-gray-500 dark:text-gray-400 md:col-span-3" aria-live="polite" data-claims-count>${shownText(c.total, c.total, 'tvrzení')}.</p>
</div>
<div class="overflow-hidden rounded-lg border border-gray-200 shadow-sm dark:border-gray-700">
<table class="${TABLE} lab-links block md:table"><caption class="sr-only">Tvrzení z ${esc(c.source)}: identifikátor a věta, stav, oblast, zdroj, kód a test</caption>
<thead class="${THEAD} hidden md:table-header-group"><tr><th scope="col" class="${TH}">Tvrzení</th><th scope="col" class="${TH}">Stav</th><th scope="col" class="${TH}">Oblast</th><th scope="col" class="${TH}">Zdroj, kód, test</th></tr></thead>
<tbody class="lab-rows lab-claims block md:table-row-group">
${rows}
<tr data-claims-empty hidden class="bg-white dark:bg-gray-800"><td colspan="4" class="px-4 py-6 text-center">Filtru neodpovídá žádné tvrzení.</td></tr>
</tbody></table>
</div>
<p class="mt-3 text-xs text-gray-500 dark:text-gray-400">Odvození oblasti: <code>${esc(c.areaRule)}</code>.</p>
</div>
</section>`;
}

function commitList(m, commits) {
  const items = commits.map((c) => `<li><a href="${REPO_URL}/commit/${c.sha.slice(0, LINK_SHA)}">${c.sha.slice(0, 7)}</a> ${esc(c.subject)}</li>`).join('');
  return `<ul lang="en" class="lab-links lab-commits mt-2 space-y-1.5 break-words text-sm text-gray-600 dark:text-gray-300">${items}</ul>`;
}

function changeBody(m, r, range, full) {
  const ids = r.planIds.map((id) => `<li><a href="${esc(m.blob(`${m.facts.releaseChanges.issueSource}/${id}.yaml`))}">${esc(id)}</a></li>`).join('');
  const prs = r.prs.map((n) => `<li><a href="${REPO_URL}/pull/${n}">#${n}</a></li>`).join('');
  const history = r.from ? `${REPO_URL}/compare/${esc(r.from)}...${esc(range.to)}`
    : `${REPO_URL}/commits/${esc(range.to)}`;
  const groups = !full ? `<p class="lab-meta border-t border-gray-200 pt-3 dark:border-gray-700" data-commits-elsewhere>Jednotlivé commity: viz <a class="${LINK}" href="${history}">${r.from ? 'porovnání' : 'historii'} na GitHubu</a>.</p>` : r.groups.map((g) => `<details class="lab-group"${COMMIT_TYPES_OPEN.includes(g.type) ? ' open' : ''}><summary>${esc(COMMIT_TYPE_COPY[g.type] ?? g.type)} <code>${esc(g.type)}</code><span>${fmtInt(g.commits.length)}</span></summary>${commitList(m, g.commits)}</details>`).join('');
  const compare = r.from ? ` · <a class="${LINK}" href="${REPO_URL}/compare/${esc(r.from)}...${esc(range.to)}">porovnat na GitHubu</a>` : '';
  return `<div>
<p class="lab-meta">${plural(r.commits, 'commit', 'commity', 'commitů')} v rozsahu <code class="text-xs">${esc(range.text)}</code>${compare}.</p>
${ids ? `<div class="mb-3"><h4>Úkoly plánu v předmětech commitů (${fmtInt(r.planIds.length)})</h4><ul class="lab-chips flex flex-wrap gap-1.5">${ids}</ul></div>` : ''}
${prs ? `<div class="mb-3"><h4>Pull requesty (${fmtInt(r.prs.length)})</h4><ul class="lab-links flex flex-wrap gap-x-3 gap-y-1 text-sm">${prs}</ul></div>` : ''}
${groups}
</div>`;
}

function typeBadges(r) {
  // Inside .lab-types a plain span is the gray badge; feat, fix and perf carry their colour.
  return Object.entries(r.byType).map(([t, n]) => `<span${TYPE_BADGE[t] ? ` class="${TYPE_BADGE[t]}"` : ''}>${esc(t)} ${fmtInt(n)}</span>`).join('');
}

function changesSection(m) {
  const rc = m.facts.releaseChanges;
  const card = (head, r, range, open, full) => `<details class="lab-rel rounded-lg border border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-800" data-release="${esc(range.to)}"${open ? ' open' : ''}>
<summary>${head}<span class="lab-types flex flex-wrap gap-y-1">${typeBadges(r)}</span></summary>
${changeBody(m, r, range, full)}
</details>`;
  const cards = [];
  if (rc.unreleased) {
    cards.push(card(`<span class="text-lg font-semibold text-gray-900 dark:text-white">Zatím nevydáno</span><span class="text-sm text-gray-500 dark:text-gray-400">od ${esc(rc.unreleased.from)} po commit ${esc(m.shortSha)}</span>`,
      rc.unreleased, { to: m.sha, text: `${rc.unreleased.from}..${m.shortSha}` }, false, true));
  }
  const items = rc.items.slice().reverse();
  items.forEach((r, i) => {
    const when = r.published_at ? `<time class="lab-when" datetime="${esc(r.published_at)}">${esc(fmtDate(r.published_at))}</time>` : '<span class="lab-when">bez release záznamu</span>';
    cards.push(card(`<a class="lab-ver ${LINK}" href="${REPO_URL}/releases/tag/${esc(r.tag)}">v${esc(r.version)}</a>${when}`,
      r, { to: r.tag, text: r.from ? `${r.from}..${r.tag}` : `${r.tag} (od prvního commitu)` }, i === 0,
      i < CHANGELOG_FULL_RELEASES));
  });
  return `<section id="zmeny" class="${SECTION_ALT}">
<div class="${WRAP}">
${pageHeading(m, 'zmeny')}
<p class="${LEAD}">Ke každé značce vydání commity od předchozí značky, každý jednou (i ty, které přišly sloučením větve), roztříděné podle typu Conventional Commits. Úkoly plánu se odvozují z předmětů commitů a odkazují na svůj soubor v ${esc(rc.issueSource)}; čísla pull requestů také. Jednotlivé commity vypisujeme u zatím nevydaných změn a u ${fmtInt(CHANGELOG_FULL_RELEASES)} nejnovějších vydání; u starších zůstávají počty podle typu, úkoly, pull requesty a odkaz na porovnání na GitHubu, kde jsou commity vypsané. Předměty commitů jsou anglicky, jak je píše historie.</p>
<div class="space-y-3">
${cards.join('\n')}
</div>
<p class="mt-3 text-xs text-gray-500 dark:text-gray-400 break-words">Zdroj: <code>${esc(rc.source)}</code>.</p>
</div>
</section>`;
}

/**
 * The meta every page carries naming the source of the milestone status: `majordomus <version>`
 * or `<file> <release>`; scripts/verify-deploy.mjs names a mismatch of it before any byte diff.
 */
export const STATUS_SOURCE_META = 'oscilla-lab-status-source';
export function statusSourceId(src) {
  return src?.tool ? `${src.tool.name} ${src.tool.version}` : `${src?.source ?? '-'} ${src?.release ?? '-'}`;
}

/** Where the milestone status came from (facts.plan.statusSource), in Czech. */
export function statusSourceText(src) {
  if (src?.tool) return `stav podle Majordomus ${esc(src.tool.version)}, příkaz <code class="text-sm">${esc(src.source)}</code>`;
  return `stav k vydání ${esc(src?.release ?? '?')} ze souboru <code class="text-sm">${esc(src?.source ?? '')}</code>, který při každém vydání zapisuje <code class="text-sm">majordomus plan roadmap --json</code>`;
}

function roadmapSection(m) {
  const rm = m.facts.roadmap;
  const ms = m.facts.plan.items;
  const by = (s) => ms.filter((x) => x.status === s).length;
  const milestone = (x) => `<li data-status="${esc(x.status)}"><div class="lab-ms-row"><span><a href="${esc(m.blob(`${rm.dirs.milestones}/${x.id}.yaml`))}">${esc(x.id)}</a> <span lang="en">${esc(x.title)}</span></span><span><span class="${PLAN_BADGE[x.status] ?? BADGE_GRAY}">${esc(PLAN_STATUS_COPY[x.status] ?? x.status)}</span><span>${fmtInt(x.done)}/${fmtInt(x.total)}</span></span></div>${progress(x.done, x.total, `${x.id}: ${x.done} z ${x.total} úkolů hotovo`, 'h-1.5')}</li>`;
  const card = (id, title, href, done, total, list) => `<article data-intent="${esc(id)}" class="${CARD} flex flex-col">
<div class="mb-1 flex items-baseline justify-between gap-3"><h3 class="min-w-0 text-lg font-bold text-gray-900 dark:text-white">${href ? `<a class="${LINK} font-mono" href="${esc(href)}">${esc(id)}</a>` : esc(id)}</h3><span class="shrink-0 text-sm tabular-nums text-gray-500 dark:text-gray-400">${fmtInt(done)} / ${fmtInt(total)} úkolů</span></div>
${title ? `<p lang="en" class="mb-3 text-sm text-gray-500 dark:text-gray-400">${esc(title)}</p>` : ''}
${progress(done, total, `${id}: ${done} z ${total} úkolů hotovo`)}
<ul class="lab-links lab-ms mt-3 divide-y divide-gray-200 dark:divide-gray-700">${list.map(milestone).join('')}</ul>
<p data-intent-empty hidden class="mt-3 text-sm text-gray-500 dark:text-gray-400">Filtru neodpovídá žádný milník tohoto záměru.</p>
</article>`;
  const cards = rm.items.map((i) => card(i.id, i.title, m.blob(`${rm.dirs.intents}/${i.id}.yaml`), i.done, i.total, i.milestones));
  if (rm.unassigned.length) {
    cards.push(card('Milníky mimo záměry', '', null, rm.unassigned.reduce((n, x) => n + x.done, 0),
      rm.unassigned.reduce((n, x) => n + x.total, 0), rm.unassigned));
  }
  const btn = (v, label, n, first) => `<button type="button" data-roadmap-filter="${v}" aria-pressed="${first}" class="rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-900 sm:rounded-none sm:first:rounded-s-lg sm:last:rounded-e-lg hover:bg-gray-100 hover:text-primary-700 focus:z-10 focus:outline-none focus:ring-2 focus:ring-primary-500 aria-pressed:bg-primary-700 aria-pressed:text-white dark:border-gray-700 dark:bg-gray-800 dark:text-white dark:hover:bg-gray-700 dark:aria-pressed:bg-primary-600">${label} <span class="tabular-nums opacity-80">${fmtInt(n)}</span></button>`;
  return `<section id="roadmapa" class="${SECTION}" data-roadmap>
<div class="${WRAP}">
${pageHeading(m, 'roadmapa')}
<p class="${LEAD}">Záměry plánu a jejich milníky, u každého kolik úkolů je hotovo. Stav milníku nepočítáme: je to stav, který odvozuje Majordomus (${statusSourceText(m.facts.plan.statusSource)}); rozpracováno je jeho fáze „now“ (ACTIVE a VERIFY), otevřeno fáze „next“ a „later“ (PLANNED a BLOCKED). Počet hotových úkolů je ze souborů úkolů. Pořadí: milníky podle pole <code class="text-sm">order</code>, pak podle id; záměry podle svého prvního milníku. Názvy jsou anglicky, jak stojí v plánu. Zdroj: <a class="${LINK}" href="${esc(m.tree(rm.dirs.intents))}">${esc(rm.dirs.intents)}</a>, <a class="${LINK}" href="${esc(m.tree(rm.dirs.milestones))}">${esc(rm.dirs.milestones)}</a> a <a class="${LINK}" href="${esc(m.tree(rm.dirs.issues))}">úkoly</a>.</p>
<div data-roadmap-controls hidden class="mb-6 grid grid-cols-2 gap-2 sm:inline-flex sm:gap-0 sm:rounded-lg sm:shadow-sm" role="group" aria-label="Filtr milníků podle stavu">${btn('', 'Vše', ms.length, true)}${btn('DONE', 'Hotovo', by('DONE'), false)}${btn('ACTIVE', 'Rozpracováno', by('ACTIVE'), false)}${btn('OPEN', 'Otevřeno', by('OPEN'), false)}</div>
<div class="grid items-start gap-6 lg:grid-cols-2">
${cards.join('\n')}
</div>
</div>
</section>`;
}

function adrSection(m) {
  const a = m.facts.adrs;
  const rows = a.items.slice().reverse().map((x) => {
    const badge = `<span class="${ADR_BADGE[x.status] ?? BADGE_GRAY}">${esc(ADR_STATUS_COPY[x.status] ?? x.status)}</span>`;
    const date = x.date ? `<time datetime="${esc(x.date)}">${esc(fmtDate(`${x.date}T00:00:00Z`))}</time>` : '–';
    return `<tr><td class="font-mono text-gray-900 dark:text-white">${String(x.number).padStart(4, '0')}</td><th scope="row" class="font-normal"><a lang="en" href="${esc(m.blob(x.path))}">${esc(x.title)}</a><div class="mt-2 flex items-center text-xs tabular-nums md:hidden">${badge}${date}</div></th><td class="hidden md:table-cell">${badge}</td><td class="hidden whitespace-nowrap tabular-nums md:table-cell">${date}</td></tr>`;
  }).join('\n');
  const counts = Object.entries(a.byStatus).map(([k, n]) => `${fmtInt(n)} ${esc(ADR_STATUS_COPY[k] ?? k)}`).join(', ');
  const dir = a.items[0]?.path.replace(/\/[^/]+$/, '') ?? '.ai/repo/adrs';
  return `<section id="adr" class="${SECTION_ALT}">
<div class="${WRAP}">
${pageHeading(m, 'adr')}
<p class="${LEAD}">${plural(a.total, 'rozhodnutí', 'rozhodnutí', 'rozhodnutí')} o architektuře (${counts}), nejnovější nahoře. Číslo, název, stav a datum pocházejí z hlavičky každého souboru v <a class="${LINK}" href="${esc(m.tree(dir))}">${esc(dir)}</a>; které přijal vlastník a proč ostatní zůstávají navržená, říká <a class="${LINK}" href="${esc(m.blob(`${dir}/README.md`))}">README</a>. Názvy jsou anglicky, jak stojí v souborech.</p>
<div class="max-h-[40rem] overflow-auto rounded-lg border border-gray-200 shadow-sm dark:border-gray-700">
<table class="${TABLE}"><caption class="sr-only">Rozhodnutí o architektuře: číslo, název, stav a datum</caption>
<thead class="${THEAD} sticky top-0"><tr><th scope="col" class="${TH}">Č.</th><th scope="col" class="${TH}">Rozhodnutí</th><th scope="col" class="${TH} hidden md:table-cell">Stav</th><th scope="col" class="${TH} hidden md:table-cell">Datum</th></tr></thead>
<tbody class="lab-rows lab-adr lab-links">
${rows}
</tbody></table>
</div>
</div>
</section>`;
}

const signedPct = (from, to) => {
  if (!from) return null;
  const p = Math.round((1000 * (to - from)) / from) / 10;
  return `${p > 0 ? '+' : p < 0 ? '−' : ''}${fmtDec(Math.abs(p), 1)} %`;
};

function ratchetCard(m, it) {
  const c = RATCHET_COPY[it.file];
  const first = it.perRelease.find((p) => p.present);
  const now = it.head.present ? it.head : [...it.perRelease].reverse().find((p) => p.present);
  // A sum over a file set that changes between tags (the byte caps of source-size) is shown
  // with its file count, and no percentage: a file that drops under the threshold or goes
  // takes its cap out of the sum though nothing got smaller (review r517b P3-7).
  const files = (p) => ratchetFiles(p);
  const fileSet = first && now && files(first) !== null && files(now) !== null;
  const change = !fileSet && first && now && first.series === now.series
    ? signedPct(first.value, now.value) : null;
  const inFiles = (p) => (files(p) === null ? '' : ` v ${plural(files(p), 'souboru', 'souborech',
    'souborech')}`);
  const perTag = fileSet ? `<details class="mb-3 text-sm text-gray-500 dark:text-gray-400" data-ratchet-tags><summary class="cursor-pointer rounded font-medium text-gray-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 dark:text-white">Součet a počet souborů u každého vydání</summary><ul class="mt-2 max-h-48 space-y-0.5 overflow-auto tabular-nums">${[...(it.head.present ? [{ ...it.head, version: null }] : []), ...it.perRelease.filter((p) => p.present).reverse()].map((p) => `<li>${p.version ? `v${esc(p.version)}` : 'nyní'}: ${esc(ratchetCell(it, p))}</li>`).join('')}</ul></details>` : '';
  const nFiles = (p) => plural(files(p), 'soubor', 'soubory', 'souborů');
  const setNote = fileSet ? ` Součet se počítá přes sadu souborů, která se mezi vydáními mění `
    + `(ve v${esc(first.version)} ${nFiles(first)}, nyní ${nFiles(now)}): soubor, který klesne `
    + 'pod práh nebo zmizí, ubere ze součtu svůj strop, aniž by se cokoli zmenšilo, takže pokles '
    + 'součtu sám o sobě pokrok neznamená.' : '';
  const badge = it.rises === 0 ? `<span class="${BADGE_GREEN} shrink-0">jen klesá</span>`
    : `<span class="${BADGE_GRAY} shrink-0">${plural(it.rises, 'nárůst', 'nárůsty', 'nárůstů')}</span>`;
  const raises = it.head.extra?.raises ? ` Zvýšení stropu zapsaná v seznamu raises: ${fmtInt(it.head.extra.raises)}.` : '';
  const series = now?.series ? ` Hodnoty jsou z měření „${esc(now.series)}“; jiné měření se s nimi nesrovnává.` : '';
  const derived = it.derived ? '' : ' Význam souboru se ze struktury odvodit nedá: číslo je jen počet jeho položek nejvyšší úrovně.';
  const rule = c.rule ? m.rule(c.rule) : null;
  return `<article class="${CARD} flex flex-col" data-ratchet="${esc(it.file)}">
<div class="mb-2 flex items-start justify-between gap-3"><h3 class="min-w-0 text-lg font-bold text-gray-900 dark:text-white">${esc(c.name)}</h3>${badge}</div>
<p class="mb-3 text-sm text-gray-500 dark:text-gray-400">${esc(c.counts)}.${raises}${series}${derived}${setNote}</p>
<div class="mb-1 flex flex-wrap items-baseline gap-x-3"><span class="text-3xl font-extrabold text-gray-900 dark:text-white">${esc(ratchetValue(it, now?.value))}</span>${fileSet ? `<span class="text-sm text-gray-500 dark:text-gray-400">${inFiles(now)}</span>` : ''}<span class="text-sm text-gray-500 dark:text-gray-400">${first ? `ve v${esc(first.version)}: ${esc(ratchetValue(it, first.value))}${inFiles(first)}${change ? ` · ${change}` : ''}` : ''}</span></div>
<div class="mb-3 text-gray-400 dark:text-gray-500">${ratchetSpark(it)}</div>
${perTag}
<ul class="lab-links lab-paths mt-auto space-y-1 text-xs"><li><span>soubor</span> <a href="${esc(m.blob(it.file))}">${esc(it.file)}</a></li><li><span>test</span> <a href="${esc(m.blob(c.test))}">${esc(c.test)}</a></li>${rule ? `<li><span>pravidlo</span> <a href="${esc(m.blob(rule))}">${esc(c.rule)}</a></li>` : '<li><span>pravidlo</span> žádné vlastní, váže ho test</li>'}</ul>
</article>`;
}

function ratchetsSection(m) {
  const r = m.facts.ratchets;
  const falling = r.items.filter((it) => it.rises === 0).length;
  return `<section id="dluh" class="${SECTION_ALT}">
<div class="${WRAP}">
${pageHeading(m, 'dluh')}
<p class="${LEAD}">Ratchet je soubor, který zapisuje zbývající dluh, a test, který selže, když dluh stoupne. Tady je každý takový soubor, který repozitář drží (tests/unit/*-baseline.json a tests/browser/*-baseline.json, nalezené ve stromu, ne vypsané ručně), s hodnotou v každé značce vydání a teď. Co soubor počítá, se čte z jeho vlastní struktury tak, jak ho čte jeho test (pravidlo pod kartami). ${fmtInt(falling)} z ${fmtInt(r.items.length)} od svého vzniku nikdy nestouplo; stropy velikosti souborů stoupat smějí, ale jen se záznamem v seznamu raises, a karta ty nárůsty počítá. Graf všech najdete také mezi <a class="${LINK}" href="${esc(m.to('grafy', 'graf-ratchets'))}">grafy</a>.</p>
<div class="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
${r.items.map((it) => ratchetCard(m, it)).join('\n')}
</div>
<p class="mt-4 break-words text-xs text-gray-500 dark:text-gray-400">Odvození: <code>${esc(r.rule)}</code>. Zdroj: <code>${esc(r.source)}</code>.</p>
</div>
</section>`;
}

const AUDIT_BADGE = Object.freeze({ open: 'lab-badge lab-badge-pink', fixed: BADGE_BLUE,
  superseded: BADGE_GRAY, unaudited: 'lab-badge lab-badge-yellow' });
/** The stacked bar's segment colours, the hues of the reviews chart's audit panel. */
const AUDIT_BAR = Object.freeze({ open: 'bg-pink-500', fixed: 'bg-primary-600',
  superseded: 'bg-gray-400 dark:bg-gray-500', unaudited: 'bg-yellow-300' });

/**
 * One open P0-P2 finding of a verdict, with what the latest audit says of it. Its cells are
 * styled once by .lab-au (scripts/landing.mjs LIST_CSS), so a row carries no class lists.
 */
function auditRow(m, x) {
  const cls = AUDIT_CLASS_COPY[x.class] ?? x.class;
  const evidence = x.evidence ? `<td lang="en">${esc(x.evidence)}</td>`
    : `<td>Žádný audit tento nález nejmenuje. Ve verdiktu: <span lang="en">${esc(x.title)}</span></td>`;
  const links = [];
  if (x.class === 'fixed') {
    links.push(x.commit ? `<p><span>commit</span> <a href="${REPO_URL}/commit/${esc(x.commit.slice(0, LINK_SHA))}">${esc(x.commit.slice(0, 7))}</a></p>`
      : '<p><span>commit</span> důkaz neuvádí commit z main</p>');
  }
  if (x.issue) {
    links.push(x.issueFile ? `<p><span>úkol</span> <a href="${esc(m.blob(x.issueFile))}">${esc(x.issue)}</a></p>`
      : `<p><span>úkol</span> ${esc(x.issue)} (soubor v tomto commitu není)</p>`);
  }
  return `<tr data-class="${esc(x.class)}"><th scope="row"><a href="${REPO_URL}/pull/${x.pr}">#${x.pr}</a> <code>${esc(x.id ?? '–')}</code> <span>${esc(x.severity)}</span></th><td><span class="${AUDIT_BADGE[x.class] ?? BADGE_GRAY}">${esc(cls)}</span></td>${evidence}<td>${links.join('') || '–'}</td></tr>`;
}

/** The review audits: the latest audit's header, its classes of the open P0-P2, the P3s. */
function auditBlock(m) {
  const r = m.facts.reviews;
  const a = m.facts.reviewAudits;
  const rawOpen = ['P0', 'P1', 'P2'].reduce((n, k) => n + (r.totals.openBySeverity[k] ?? 0), 0);
  if (!a || !a.audits.length) {
    return `<div class="${CARD} mb-6" data-audit-none>
<h3 class="mb-2 text-xl font-bold text-gray-900 dark:text-white">Audit nálezů</h3>
<p class="text-gray-500 dark:text-gray-400">V <a class="${LINK}" href="${esc(m.tree('.ai/repo/reviews'))}">.ai/repo/reviews</a> zatím žádný audit (audit-*.yaml) není. Čísla výše jsou stavy, jak je zapsaly záznamy revizí: otevřených nálezů P0 až P2 je v nich ${fmtInt(rawOpen)}, a co z nich platí dnes, řekne až audit, který je ověří proti main.</p>
</div>`;
  }
  // the latest audit that completes no other; its extensions (extends:) are shown beside it
  const roots = a.audits.filter((x) => !x.completes);
  const latest = roots[roots.length - 1] ?? a.audits[a.audits.length - 1];
  const exts = a.audits.filter((x) => x.completes === latest.file);
  const fileLink = (x) => `<a href="${esc(m.blob(x.file))}">${esc(x.file.replace(/^.*\//, ''))}</a>`;
  const shaLink = (sha) => `<a href="${REPO_URL}/commit/${esc(sha)}"><code>${esc(sha.slice(0, 8))}</code></a>`;
  const extRows = exts.map((x) => `<div class="sm:col-span-2" data-audit-extension><dt class="text-gray-500 dark:text-gray-400">Doplňující audit (extends)</dt><dd class="font-medium text-gray-900 dark:text-white">${fileLink(x)}${x.judgedOn ? ` · ověřeno proti ${shaLink(x.judgedOn)}` : ''}${x.auditors.length ? ` · ${x.auditors.map((n) => `<code class="text-xs">${esc(n)}</code>`).join(', ')}` : ''}${x.scope ? ` · <span lang="en">${esc(x.scope)}</span>` : ''}</dd></div>`).join('\n');
  const day = latest.date ? `<time datetime="${esc(latest.date)}">${esc(fmtDate(`${latest.date}T00:00:00Z`))}</time>` : 'bez data';
  const base = latest.base ? `<a href="${REPO_URL}/commit/${esc(latest.base)}"><code>${esc(latest.base.slice(0, 8))}</code></a>` : 'neuvedena';
  const older = a.audits.filter((x) => x !== latest && !exts.includes(x)).reverse().map(fileLink).join(', ');
  const total = a.split.total;
  const bar = a.classes.filter((k) => a.split[k] > 0).map((k) => `<div class="${AUDIT_BAR[k] ?? 'bg-gray-600'} h-full" style="width:${pct(a.split[k], total)}%" title="${esc(`${AUDIT_CLASS_COPY[k] ?? k}: ${a.split[k]}`)}"></div>`).join('');
  const legend = a.classes.map((k) => `<li class="flex items-center gap-2"><span class="h-3 w-3 shrink-0 rounded ${AUDIT_BAR[k] ?? 'bg-gray-600'}" aria-hidden="true"></span>${esc(AUDIT_CLASS_COPY[k] ?? k)} <span class="font-semibold tabular-nums text-gray-900 dark:text-white">${fmtInt(a.split[k] ?? 0)}</span></li>`).join('');
  const btn = (v, label, n, first) => `<button type="button" data-audit-filter="${v}" aria-pressed="${first}">${esc(label)} <span>${fmtInt(n)}</span></button>`;
  const chips = [btn('', 'Vše', total, true), ...a.classes.map((k) => btn(k, AUDIT_CLASS_COPY[k] ?? k, a.split[k] ?? 0, false))].join('');
  const rows = a.perFinding.map((x) => auditRow(m, x)).join('\n');
  const orphans = a.orphans.length ? `<p class="mt-3 text-sm text-gray-500 dark:text-gray-400" data-audit-orphans>Nálezy, které audit jmenuje a žádný záznam revize nemá (${fmtInt(a.orphans.length)}): ${a.orphans.map((o) => `<code class="text-xs">${esc(o.source)}</code>`).join(', ')}.</p>` : '';
  const p = a.p3;
  const p3Classes = p && p.byClass ? `${['open', 'fixed', 'superseded'].filter((k) => k in p.byClass).map((k) => `${esc((AUDIT_CLASS_COPY[k] ?? k).toLowerCase())} ${fmtInt(p.byClass[k])}`).join(', ')}; <strong class="font-semibold text-gray-900 dark:text-white">neklasifikováno ${'unclassified' in p.byClass ? fmtInt(p.byClass.unclassified) : '–'}</strong>` : 'třídy neuvádí';
  const p3By = p && p.extensions.length ? `Audit spolu s doplněním ${p.extensions.map((f) => `<code class="text-xs">${esc(f.replace(/^.*\//, ''))}</code>`).join(', ')} je klasifikoval proti main (řádků P3 v auditech: ${fmtInt(p.classified)}): ${p3Classes}.` : `Ze vzorku ${p ? fmtInt(p.sample) : 0} ověřených proti main: ${p3Classes}, tedy bez třídy, dokud je další audit neověří.`;
  const p3 = p ? `<div class="mt-6" data-audit-p3><h4 class="mb-2 text-lg font-semibold text-gray-900 dark:text-white">Nálezy P3</h4><p class="text-gray-500 dark:text-gray-400">${p.total === null ? 'Celkový počet P3 audit neuvádí' : `Nálezů P3 je ${fmtInt(p.total)}`}, z nich ${p.open === null ? '–' : fmtInt(p.open)} otevřených ve verdiktech. ${p3By} Odkazy z commitů na nálezy audit zapisuje jen jako signály, ne jako třídy${p.signals ? `: ${Object.entries(p.signals).map(([k, v]) => `<code class="text-xs">${esc(k)}</code> ${esc(typeof v === 'number' ? fmtInt(v) : v)}`).join(', ')}` : ''}.</p></div>` : '';
  return `<div class="${CARD} mb-6" data-audit>
<h3 class="mb-2 text-xl font-bold text-gray-900 dark:text-white">Audit nálezů</h3>
<p class="mb-4 text-gray-500 dark:text-gray-400">Záznamy revizí jsou historické: stav nálezu v nich zůstává, jak ho recenzent zapsal k hlavě pull requestu, a nikdo je dodatečně nepřepisuje. Co platí dnes, říká audit, který každý otevřený nález P0 až P2 ověřil proti main: opraveno (commit, který ho opravil), nahrazeno (proč už neplatí), nebo stále otevřené (úkol plánu, který ho teď sleduje). Třídu nálezu dává vždy audit, generátor stránky nic nepřeřazuje; platí poslední audit, který nález jmenuje.</p>
<dl class="lab-links mb-4 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
<div><dt class="text-gray-500 dark:text-gray-400">Poslední audit</dt><dd class="font-medium text-gray-900 dark:text-white"><a href="${esc(m.blob(latest.file))}">${esc(latest.file.replace(/^.*\//, ''))}</a> · ${day}</dd></div>
<div><dt class="text-gray-500 dark:text-gray-400">Báze (commit main, proti kterému se ověřovalo)</dt><dd class="font-medium text-gray-900 dark:text-white">${base}</dd></div>
<div><dt class="text-gray-500 dark:text-gray-400">Auditoři</dt><dd class="font-medium text-gray-900 dark:text-white">${latest.auditors.length ? latest.auditors.map((x) => `<code class="text-xs">${esc(x)}</code>`).join(', ') : 'neuvedeni'}</dd></div>
<div><dt class="text-gray-500 dark:text-gray-400">Rozsah</dt><dd lang="en" class="font-medium text-gray-900 dark:text-white">${esc(latest.scope ?? '–')}</dd></div>
${extRows}
${older ? `<div class="sm:col-span-2"><dt class="text-gray-500 dark:text-gray-400">Starší audity</dt><dd>${older}</dd></div>` : ''}
</dl>
<p class="mb-2 text-sm text-gray-500 dark:text-gray-400">Z ${plural(rawOpen, 'nálezu', 'nálezů', 'nálezů')} P0 až P2, které záznamy revizí dnes vedou jako otevřené:</p>
<div class="mb-2 flex h-4 w-full gap-0.5 overflow-hidden rounded-full bg-gray-200 dark:bg-gray-700" role="img" aria-label="${esc(a.classes.map((k) => `${AUDIT_CLASS_COPY[k] ?? k} ${a.split[k] ?? 0}`).join(', '))}">${bar}</div>
<ul class="mb-6 flex flex-wrap gap-x-6 gap-y-1 text-sm text-gray-600 dark:text-gray-300">${legend}</ul>
<div data-audit-controls hidden class="lab-filter mb-4 grid grid-cols-2 gap-2 sm:inline-flex sm:gap-0 sm:rounded-lg sm:shadow-sm" role="group" aria-label="Filtr nálezů podle třídy auditu">${chips}</div>
<p class="sr-only" aria-live="polite" data-audit-count></p>
<div class="max-h-[40rem] overflow-auto rounded-lg border border-gray-200 dark:border-gray-700">
<table class="${TABLE} lab-links block md:table"><caption class="sr-only">Otevřené nálezy P0 až P2 ze záznamů revizí: pull request, nález a závažnost, třída podle auditu, důkaz, commit nebo úkol</caption>
<thead class="${THEAD} sticky top-0 hidden md:table-header-group"><tr><th scope="col" class="${TH}">Nález</th><th scope="col" class="${TH}">Třída</th><th scope="col" class="${TH}">Důkaz auditu</th><th scope="col" class="${TH}">Commit, úkol</th></tr></thead>
<tbody class="lab-rows lab-claims lab-au block md:table-row-group">
${rows}
<tr data-audit-empty hidden class="bg-white dark:bg-gray-800"><td colspan="4" class="px-4 py-6 text-center">V této třídě žádný nález není.</td></tr>
</tbody></table>
</div>
<p class="mt-3 text-xs text-gray-500 dark:text-gray-400">U čísla pull requestu stojí identifikátor nálezu ze záznamu revize <code>.ai/repo/reviews/&lt;číslo&gt;.yaml</code> a závažnost, jak ji určil recenzent. Důkazy jsou anglicky, jak je audit zapsal. U opraveného nálezu se odkazuje první commit, který důkaz jmenuje, je v tomto repozitáři a je předkem báze auditu (pravidlo níže); úkol plánu, když jeho soubor v tomto commitu existuje.</p>
${orphans}
${p3}
<p class="lab-src">Zdroj: <code>${esc(a.source)}</code>; pravidlo: <code>${esc(a.rule)}</code>; commit: <code>${esc(a.commitRule)}</code>.</p>
</div>`;
}

function reviewsSection(m) {
  const r = m.facts.reviews;
  const t = r.totals;
  const sev = r.severities;
  const blocking = sev.filter((k) => k === 'P0' || k === 'P1');
  const openBlocking = blocking.reduce((n, k) => n + (t.openBySeverity[k] ?? 0), 0);
  const day = (iso) => (iso ? `<time datetime="${esc(iso)}">${esc(fmtDate(iso))}</time>` : '–');
  const rows = r.items.slice().reverse().map((x) => {
    const ob = blocking.filter((k) => x.openBySeverity[k] > 0).map((k) => `<span class="${BADGE_GRAY}">${fmtInt(x.openBySeverity[k])} ${k} otevřený</span>`).join('');
    // a verdict other than merge is a badge; the merges, nearly every row, are plain text
    const verdict = x.verdict === 'merge' ? esc(VERDICT_COPY.merge) : `<span class="${BADGE_GRAY}">${esc(VERDICT_COPY[x.verdict] ?? x.verdict)}</span>`;
    return `<tr><th scope="row"><a href="${REPO_URL}/pull/${x.pr}">#${x.pr}</a>${x.members ? ` <span>+${fmtInt(x.members)}</span>` : ''}</th><td>${verdict}${ob}</td>${sev.map((k) => `<td>${fmtInt(x.bySeverity[k])}</td>`).join('')}<td>${fmtInt(x.byStatus.open ?? 0)}</td><td>${fmtInt(x.byStatus.closed ?? 0)}</td><td>${day(x.addedAt)}</td></tr>`;
  }).join('\n');
  const verdicts = Object.entries(t.byVerdict).map(([k, n]) => `${fmtInt(n)} ${esc(VERDICT_COPY[k] ?? k)}`).join(', ');
  return `<section id="revize" class="${SECTION}">
<div class="${WRAP}">
${pageHeading(m, 'revize')}
<p class="${LEAD}">Pull request, který mění střežené cesty, potřebuje záznam revize, který napsal někdo jiný než autor změny (pravidlo <a class="${LINK}" href="${esc(m.blob(m.rule('project.review-verdict')))}">project.review-verdict</a>). Každý záznam v <a class="${LINK}" href="${esc(m.tree('.ai/repo/reviews'))}">.ai/repo/reviews</a> uvádí verdikt a všechny nálezy se závažností P0 až P3 a stavem; otevřený nález P0 nebo P1 sloučení blokuje. Datum je okamžik, kdy byl záznam poprvé commitnut. Verdikty: ${verdicts}.</p>
<dl class="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
${stat(fmtInt(t.reviews), 'záznamů revizí')}
${stat(fmtInt(t.findings), 'nálezů')}
${stat(fmtInt(t.byStatus.open ?? 0), 'nálezů stále otevřených')}
${stat(fmtInt(openBlocking), 'otevřených P0 a P1')}
</dl>
${auditBlock(m)}
<div class="max-h-[40rem] overflow-auto rounded-lg border border-gray-200 shadow-sm dark:border-gray-700">
<table class="${TABLE} lab-rv"><caption class="sr-only">Revize: pull request, verdikt, nálezy podle závažnosti, otevřené a uzavřené, datum záznamu</caption>
<thead class="${THEAD} sticky top-0"><tr><th scope="col">PR</th><th scope="col">Verdikt</th>${sev.map((k) => `<th scope="col">${k}</th>`).join('')}<th scope="col">Otevřeno</th><th scope="col">Uzavřeno</th><th scope="col">Zapsáno</th></tr></thead>
<tbody class="lab-rows lab-links">
${rows}
</tbody></table>
</div>
<p class="mt-3 text-xs text-gray-500 dark:text-gray-400">„+N“ u čísla pull requestu: záznam vlaku, který posuzuje i N dalších pull requestů. Zdroj: <code>${esc(r.source)}</code>; datum: <code>${esc(r.dateSource)}</code>.</p>
</div>
</section>`;
}

function footer(m) {
  return `<footer class="bg-white dark:bg-gray-900">
<div class="mx-auto max-w-screen-xl p-4 py-8 md:p-8">
<div class="sm:flex sm:items-center sm:justify-between">
<a href="${esc(m.to(''))}" class="mb-4 flex items-center gap-3 rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 sm:mb-0">${m.mark('h-8 w-8')}<span class="text-xl font-semibold text-gray-900 dark:text-white">OSCILLA</span></a>
<ul class="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm font-medium text-gray-500 dark:text-gray-400">
<li><a href="${esc(m.appHref)}" class="hover:underline">Aplikace</a></li>
<li><a href="${REPO_URL}" class="inline-flex items-center gap-1 hover:underline">${GITHUB_MARK} GitHub</a></li>
<li><a href="${esc(m.blob('LICENSE'))}" class="hover:underline">Licence MIT</a></li>
</ul>
</div>
<hr class="my-6 border-gray-200 dark:border-gray-700 sm:mx-auto lg:my-8">
<p class="text-sm text-gray-500 dark:text-gray-400">OSCILLA, licence MIT. Stránka vygenerována z commitu <a class="${LINK}" href="${esc(m.commitUrl)}"><code>${esc(m.shortSha)}</code></a> (${esc(m.commitDay)}) skriptem <a class="${LINK}" href="${esc(m.blob('scripts/landing.mjs'))}">scripts/landing.mjs</a>; nenačítá nic z jiného webu a nesleduje návštěvy.</p>
</div>
</footer>`;
}

/**
 * The heading of a dashboard section: on its own sub-page the breadcrumb (Pro breadcrumb block)
 * and the page's H1, elsewhere an H2.
 */
function pageHeading(m, dir) {
  const p = SUBPAGES.find((x) => x.dir === dir);
  if (m.page !== dir) return `<h2 class="${H2}">${esc(p.title)}</h2>`;
  return `<nav class="mb-4 flex" aria-label="Drobečková navigace">
<ol class="inline-flex flex-wrap items-center gap-1 text-sm font-medium md:gap-2">
<li class="inline-flex items-center"><a href="${esc(m.to(''))}" class="inline-flex items-center rounded text-gray-700 hover:text-primary-700 ${FOCUS} dark:text-gray-400 dark:hover:text-white">${icon(m.icons, 'house', 'me-2 h-4 w-4')}Laboratoř</a></li>
<li aria-current="page" class="inline-flex items-center text-gray-500 dark:text-gray-400">${icon(m.icons, 'chevron-right', 'me-1 h-4 w-4 md:me-2')}${esc(p.nav)}</li>
</ol>
</nav>
<h1 class="${H2}">${esc(p.title)}</h1>`;
}

/** The chart's own name and description, as its SVG writes them (already escaped). */
function chartLabel(svg) {
  const t = /<title id="[^"]+">([^<]*)<\/title><desc id="[^"]+">([^<]*)<\/desc>/.exec(svg);
  const size = /^<svg [^>]*?width="(\d+)" height="(\d+)"/.exec(svg);
  return { title: t?.[1] ?? '', desc: t?.[2] ?? '', width: size?.[1], height: size?.[2] };
}

/**
 * The front page's chart overview (P018): each chart as an image of its own file under charts/
 * (the bytes the README embeds), loaded lazily, linking its interactive version with the table
 * of values and the source on the grafy/ page.
 */
function chartsOverview(m) {
  const cards = m.chartNames.map((name) => {
    const c = chartLabel(m.charts[name]);
    return `<li><a href="${esc(m.to('grafy', `graf-${name}`))}" class="group flex h-full flex-col overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm hover:border-primary-300 focus:outline-none focus:ring-4 focus:ring-primary-300 dark:border-gray-700 dark:bg-gray-800 dark:hover:border-primary-700 dark:focus:ring-primary-800"><img src="charts/${name}.svg" alt="${c.title}. ${c.desc}" width="${c.width}" height="${c.height}" loading="lazy" decoding="async" class="block h-auto w-full"><span class="mt-auto flex items-center justify-between gap-2 p-3 text-sm font-medium text-primary-700 group-hover:underline dark:text-primary-400">Hodnoty, zdroj a interaktivní graf ${icon(m.icons, 'arrow-right', 'h-4 w-4 shrink-0')}</span></a></li>`;
  }).join('\n');
  return `<section id="grafy" class="${SECTION_ALT}">
<div class="${WRAP}">
<h2 class="${H2}">Grafy z repozitáře</h2>
<p class="${LEAD}">${fmtInt(m.chartNames.length)} grafů, nakreslených při každém nasazení z commitu, který se nasazuje: z release záznamů, z plánu, z matice tvrzení, ze záznamů revizí, z historie gitu a ze stromů značek vydání. Nic se neodhaduje ani nedopočítává. Hodnoty po najetí nebo šipkami, tabulku hodnot a zdroj každého grafu ukazuje stránka <a class="${LINK}" href="${esc(m.to('grafy'))}">Grafy</a>; tytéž soubory SVG ukazuje README.</p>
<ul class="grid gap-6 md:grid-cols-2">
${cards}
</ul>
</div>
</section>`;
}

/** One or two headline numbers of each dashboard sub-page, derived from the facts. */
function teaserStats(m, dir) {
  const f = m.facts;
  const ratio = (a, b) => `${fmtInt(a)}&nbsp;/&nbsp;${fmtInt(b)}`;
  switch (dir) {
    case 'grafy':
      return [[fmtInt(m.chartNames.length), 'grafů s tabulkou hodnot'],
        [fmtInt(f.releases.items.length), 'vydání na časové ose']];
    case 'tvrzeni':
      return [[fmtInt(f.claims.total), 'tvrzení'],
        [fmtInt(f.claims.byStatus.guaranteed ?? 0), 'zaručených testem']];
    case 'zmeny': {
      const rc = f.releaseChanges;
      return [[fmtInt(rc.items.length), 'značek vydání'],
        ...(rc.unreleased ? [[fmtInt(rc.unreleased.commits), 'commitů zatím nevydáno']] : [])];
    }
    case 'roadmapa': {
      const ms = f.plan.items;
      return [[ratio(ms.filter((x) => x.status === 'DONE').length, ms.length), 'milníků hotovo'],
        [ratio(ms.reduce((n, x) => n + x.done, 0), ms.reduce((n, x) => n + x.total, 0)),
          'úkolů hotovo']];
    }
    case 'dluh': {
      const r = f.ratchets.items;
      return [[ratio(r.filter((x) => x.rises === 0).length, r.length), 'ratchetů jen klesá']];
    }
    case 'revize': {
      const t = f.reviews.totals;
      return [[fmtInt(t.reviews), 'záznamů revizí'],
        [fmtInt((t.openBySeverity.P0 ?? 0) + (t.openBySeverity.P1 ?? 0)), 'otevřených P0 a P1']];
    }
    case 'adr':
      return [[fmtInt(f.adrs.total), 'rozhodnutí'],
        [fmtInt(f.adrs.byStatus.accepted ?? 0), 'přijatých vlastníkem']];
    default:
      return [];
  }
}

/**
 * A teaser card per dashboard sub-page (Pro feature cards with statistics): on the front page
 * every one, on a sub-page the others.
 */
function dashboards(m) {
  const pages = SUBPAGES.filter((p) => p.dir !== m.page);
  const cards = pages.map((p) => {
    const stats = teaserStats(m, p.dir).map(([v, label]) => `<div><dt class="text-2xl font-extrabold tabular-nums text-gray-900 dark:text-white">${v}</dt><dd class="text-sm text-gray-500 dark:text-gray-400">${label}</dd></div>`).join('');
    return `<article class="${CARD} flex flex-col" data-teaser="${p.dir}">
<div class="mb-4 flex h-10 w-10 items-center justify-center rounded-lg bg-primary-100 text-primary-700 dark:bg-primary-900 dark:text-primary-300">${icon(m.icons, p.icon, 'h-6 w-6')}</div>
<h3 class="mb-2 text-xl font-bold text-gray-900 dark:text-white">${esc(p.title)}</h3>
<dl class="mb-3 grid grid-cols-2 gap-3">${stats}</dl>
<p class="mb-4 flex-1 text-gray-500 dark:text-gray-400">${esc(p.desc)}</p>
<a href="${esc(m.to(p.dir))}" class="${LINK} inline-flex items-center">Otevřít ${esc(p.nav)} ${icon(m.icons, 'arrow-right', 'ms-1 h-4 w-4')}</a>
</article>`;
  }).join('\n');
  const front = m.page === '';
  return `<section id="prehledy" class="${front ? SECTION : SECTION_ALT}">
<div class="${WRAP}">
<h2 class="${H2}">${front ? 'Přehledy z repozitáře' : 'Další přehledy'}</h2>
${front ? `<p class="${LEAD}">Každý přehled má vlastní stránku, aby se tahle načítala rychle i na telefonu. Čísla na kartách jsou spočítaná ze stejného commitu jako stránky, na které vedou.</p>` : ''}
<div class="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
${cards}
</div>
</div>
</section>`;
}

/** The section each sub-page shows. */
const SUBPAGE_SECTION = Object.freeze({ grafy: chartsSection, tvrzeni: claimsExplorer,
  zmeny: changesSection, roadmapa: roadmapSection, dluh: ratchetsSection,
  revize: reviewsSection, adr: adrSection });

const ABSOLUTE = /^(?:[a-z][a-z0-9+.-]*:|\/|#)/i;

/**
 * The view model of one page: `page` is '' for the front page or a sub-page's dir; `up` the
 * prefix from it to lab/; `appHref` the app relative to it; `to(target, fragment)` the link from
 * it to the front page ('') or a sub-page, or to a fragment of its own page.
 */
export function pageModel(m, page) {
  const up = page ? '../' : '';
  const to = (target, frag) => {
    if (target === page) return `#${frag ?? (page || 'top')}`;
    return `${up}${target ? `${target}/` : ''}${frag ? `#${frag}` : ''}`;
  };
  return { ...m, page, up, to, mark: m.newMark(),
    appHref: ABSOLUTE.test(m.appHref) ? m.appHref : `${up}${m.appHref}` };
}

const FRONT = Object.freeze({ title: 'OSCILLA · Laboratoř zvuku a frekvencí',
  desc: 'OSCILLA: akustická laboratoř v prohlížeči bez instalace. Generujte, měřte a opakujte '
    + 'zvukové experimenty a vězte, nakolik lze každému výsledku věřit.' });

function documentOf(m, main, meta) {
  return `<!doctype html>
<html lang="cs" class="motion-safe:scroll-smooth">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="${cspWith(SCRIPT_HASHES_MARKER)}">
<meta name="description" content="${esc(meta.desc)}">
<meta name="color-scheme" content="light dark">
<meta name="${STATUS_SOURCE_META}" content="${esc(statusSourceId(m.facts.plan.statusSource))}">
<title>${esc(meta.title)}</title>
<link rel="icon" href="${m.favicon}">
<script>${THEME_SCRIPT}</script>
${STYLE_MARKER}
</head>
<body class="bg-white font-sans text-gray-900 antialiased dark:bg-gray-900 dark:text-white">
<a href="#hlavni" class="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-primary-700 focus:px-4 focus:py-2 focus:text-white">Přeskočit na obsah</a>
${header(m)}
<main id="hlavni">
${main}
</main>
${footer(m)}
${SCRIPT_MARKER}
</body>
</html>
`;
}

/**
 * Every page: [['index.html', html], ['<dir>/index.html', html], ...] in SUBPAGES order; `m` is
 * the view model scripts/landing.mjs builds (with `newMark`, a factory of the wave mark).
 */
export function renderPages(m) {
  const front = pageModel(m, '');
  const pages = [['index.html', documentOf(front, [hero(front), frameSection(front),
    workspaceCards(front), libraries(front), gallery(front), chartsOverview(front),
    dashboards(front), proof(front), releasesSection(front)].join('\n'), FRONT)]];
  for (const p of SUBPAGES) {
    const pm = pageModel(m, p.dir);
    pages.push([`${p.dir}/index.html`, documentOf(pm,
      `${SUBPAGE_SECTION[p.dir](pm)}\n${dashboards(pm)}`,
      { title: `${p.title} · OSCILLA`, desc: p.desc })]);
  }
  return pages;
}
