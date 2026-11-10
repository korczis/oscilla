// The markup of the generated landing at /oscilla/lab/ (plan P014, owner decision Q107): one
// Czech page on Flowbite Pro's marketing blocks (header navbar, hero with app preview, card
// statistics, feature card list, tabs, project-portfolio grid with a modal, timeline, footer),
// adapted into OSCILLA's own markup; no Pro source file is copied. Every number and list comes
// from the facts (scripts/facts.mjs); every sentence from scripts/landing/copy.mjs or here.
//
//   renderPage(model) -> the HTML document with the markers STYLE and SCRIPT still in place
//   (scripts/landing.mjs compiles Tailwind over this markup, then fills them).

import {
  esc, fmtDate, fmtDec, fmtInt, MB, chartTable, ratchetSpark, ratchetValue,
} from './charts.mjs';
import {
  ADR_STATUS_COPY, AREA_COPY, CATEGORY_COPY, CLAIM_STATUS_COPY, COMMIT_TYPE_COPY,
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

// The page's own policy: nothing but this origin, inline style and script, and data: images.
export const CSP = "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; "
  + "script-src 'unsafe-inline'; frame-src 'self'; base-uri 'none'; form-action 'none'";

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

const NAV = [
  ['#hrat', 'Hrát'], ['#plochy', 'Plochy'], ['#galerie', 'Galerie'],
  ['#grafy', 'Grafy'], ['#dukazy', 'Důkazy'], ['#tvrzeni', 'Tvrzení'], ['#vydani', 'Vydání'],
  ['#zmeny', 'Změny'], ['#roadmapa', 'Roadmapa'], ['#dluh', 'Dluh'], ['#revize', 'Revize'],
  ['#adr', 'ADR'],
];
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

function header(m) {
  const links = NAV.map(([href, label]) => `<li><a href="${href}" class="block rounded-lg px-3 `
    + 'py-2 text-gray-700 hover:bg-gray-100 focus:outline-none focus-visible:ring-2 '
    + 'focus-visible:ring-primary-500 dark:text-gray-300 dark:hover:bg-gray-700 xl:p-2 '
    + `xl:hover:bg-transparent xl:hover:text-primary-700 dark:xl:hover:text-white">${label}</a>`
    + '</li>').join('');
  return `<header class="sticky top-0 z-30">
<nav class="border-b border-gray-200 bg-white px-4 py-2.5 dark:border-gray-700 dark:bg-gray-800 xl:px-6" aria-label="Hlavní">
<div class="mx-auto flex max-w-screen-xl flex-wrap items-center justify-between">
<a href="#top" class="flex items-center gap-3 rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500">${m.mark('h-8 w-8')}<span class="self-center whitespace-nowrap text-xl font-semibold text-gray-900 dark:text-white">OSCILLA</span></a>
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
${t.shot ? `<img src="shots/${esc(t.shot.file)}" alt="${esc(t.shot.alt)}" width="${t.shot.width}" height="${t.shot.height}" class="block h-auto w-full opacity-70" loading="${t === tabs[0] ? 'eager' : 'lazy'}" decoding="async">` : '<div class="aspect-video"></div>'}
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
    return `<figure class="min-w-0 rounded-lg border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800">
<div data-chart-box class="relative"><div class="overflow-x-auto rounded-xl p-1 [&>svg]:block [&>svg]:h-auto [&>svg]:w-full [&>svg]:min-w-[540px] [&>svg]:rounded-xl [&>svg:focus]:outline-none [&>svg:focus-visible]:ring-4 [&>svg:focus-visible]:ring-primary-500">${m.charts[name].trim()}</div><p class="sr-only" aria-live="polite" data-chart-live></p></div>
<figcaption class="mt-3 flex flex-wrap items-center justify-between gap-2 text-sm text-gray-500 dark:text-gray-400"><span>Najetím, nebo po zaměření grafu šipkami, zobrazíte hodnoty. Na úzkém displeji graf posunete do strany.</span><a class="${LINK}" href="charts/${name}.svg">SVG soubor</a></figcaption>
${source ? `<p class="lab-src">Zdroj: <code>${esc(source)}</code></p>` : ''}
<details class="mt-2 text-sm text-gray-500 dark:text-gray-400"><summary class="cursor-pointer rounded font-medium text-gray-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 dark:text-white">Tabulka hodnot</summary>
<div class="mt-2 max-h-72 overflow-auto"><table class="lab-ctable w-full text-left text-sm text-gray-500 dark:text-gray-400"><thead class="bg-gray-50 text-xs uppercase text-gray-700 dark:bg-gray-700 dark:text-gray-400"><tr>${t.head.map((h) => `<th scope="col" class="px-3 py-2">${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table></div>
</details>
</figure>`;
  }).join('\n');
  return `<section id="grafy" class="${SECTION_ALT}">
<div class="${WRAP}">
<h2 class="${H2}">Grafy z repozitáře</h2>
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
<p class="${CARD} text-gray-500 dark:text-gray-400">Všech ${fmtInt(f.claims.total)} tvrzení se stavem, oblastí, zdrojem, kódem a testem prohledáte v <a class="${LINK}" href="#tvrzeni">průzkumníku tvrzení</a>.</p>
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
<h2 class="${H2}">Průzkumník tvrzení</h2>
<p class="${LEAD}">Všech ${fmtInt(c.total)} tvrzení z <a class="${LINK}" href="${esc(m.blob(c.source))}">${esc(c.source)}</a>, každé se souborem, který chování definuje, s kódem, který ho implementuje, a s testem, který ho dokazuje; odkazy vedou na GitHub do commitu, ze kterého je stránka. Oblast se odvozuje z cesty implementace (pravidlo pod tabulkou). Věty tvrzení jsou anglicky, jak stojí v matici.</p>
<div data-claims-controls hidden class="mb-4 grid gap-3 md:grid-cols-[1fr_12rem_14rem] md:items-end">
<div><label for="claims-q" class="mb-2 block text-sm font-medium text-gray-900 dark:text-white">Hledat</label><div class="relative"><div class="pointer-events-none absolute inset-y-0 start-0 flex items-center ps-3 text-gray-500 dark:text-gray-400">${icon(m.icons, 'search', 'h-4 w-4')}</div><input type="search" id="claims-q" autocomplete="off" placeholder="id, věta nebo cesta k souboru" class="${INPUT} ps-10"></div></div>
<div><label for="claims-status" class="mb-2 block text-sm font-medium text-gray-900 dark:text-white">Stav</label><select id="claims-status" class="${INPUT}"><option value="">Všechny stavy</option>${statusOpts}</select></div>
<div><label for="claims-area" class="mb-2 block text-sm font-medium text-gray-900 dark:text-white">Oblast</label><select id="claims-area" class="${INPUT}"><option value="">Všechny oblasti</option>${areaOpts}</select></div>
<p class="text-sm text-gray-500 dark:text-gray-400 md:col-span-3" aria-live="polite" data-claims-count>Zobrazeno ${fmtInt(c.total)} z ${fmtInt(c.total)} tvrzení.</p>
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
<h2 class="${H2}">Co přinesla která verze</h2>
<p class="${LEAD}">Ke každé značce vydání commity od předchozí značky, každý jednou (i ty, které přišly sloučením větve), roztříděné podle typu Conventional Commits. Úkoly plánu se odvozují z předmětů commitů a odkazují na svůj soubor v ${esc(rc.issueSource)}; čísla pull requestů také. Jednotlivé commity vypisujeme u zatím nevydaných změn a u ${fmtInt(CHANGELOG_FULL_RELEASES)} nejnovějších vydání; u starších zůstávají počty podle typu, úkoly, pull requesty a odkaz na porovnání na GitHubu, kde jsou commity vypsané. Předměty commitů jsou anglicky, jak je píše historie.</p>
<div class="space-y-3">
${cards.join('\n')}
</div>
<p class="mt-3 text-xs text-gray-500 dark:text-gray-400 break-words">Zdroj: <code>${esc(rc.source)}</code>.</p>
</div>
</section>`;
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
<h2 class="${H2}">Roadmapa</h2>
<p class="${LEAD}">Záměry plánu a jejich milníky, u každého kolik úkolů je hotovo. Stav milníku se odvozuje ze souborů úkolů stejně jako u grafu plánu (hotovo: všechny požadované úkoly mají completed_at; rozpracováno: některé; otevřeno: žádný). Pořadí: milníky podle pole <code class="text-sm">order</code>, pak podle id; záměry podle svého prvního milníku. Názvy jsou anglicky, jak stojí v plánu. Zdroj: <a class="${LINK}" href="${esc(m.tree(rm.dirs.intents))}">${esc(rm.dirs.intents)}</a>, <a class="${LINK}" href="${esc(m.tree(rm.dirs.milestones))}">${esc(rm.dirs.milestones)}</a> a <a class="${LINK}" href="${esc(m.tree(rm.dirs.issues))}">úkoly</a>.</p>
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
<h2 class="${H2}">Rozhodnutí (ADR)</h2>
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
  const change = first && now && first.series === now.series ? signedPct(first.value, now.value)
    : null;
  const badge = it.rises === 0 ? `<span class="${BADGE_GREEN} shrink-0">jen klesá</span>`
    : `<span class="${BADGE_GRAY} shrink-0">${plural(it.rises, 'nárůst', 'nárůsty', 'nárůstů')}</span>`;
  const raises = it.head.extra?.raises ? ` Zvýšení stropu zapsaná v seznamu raises: ${fmtInt(it.head.extra.raises)}.` : '';
  const series = now?.series ? ` Hodnoty jsou z měření „${esc(now.series)}“; jiné měření se s nimi nesrovnává.` : '';
  const derived = it.derived ? '' : ' Význam souboru se ze struktury odvodit nedá: číslo je jen počet jeho položek nejvyšší úrovně.';
  const rule = c.rule ? m.rule(c.rule) : null;
  return `<article class="${CARD} flex flex-col" data-ratchet="${esc(it.file)}">
<div class="mb-2 flex items-start justify-between gap-3"><h3 class="min-w-0 text-lg font-bold text-gray-900 dark:text-white">${esc(c.name)}</h3>${badge}</div>
<p class="mb-3 text-sm text-gray-500 dark:text-gray-400">${esc(c.counts)}.${raises}${series}${derived}</p>
<div class="mb-1 flex flex-wrap items-baseline gap-x-3"><span class="text-3xl font-extrabold text-gray-900 dark:text-white">${esc(ratchetValue(it, now?.value))}</span><span class="text-sm text-gray-500 dark:text-gray-400">${first ? `ve v${esc(first.version)}: ${esc(ratchetValue(it, first.value))}${change ? ` · ${change}` : ''}` : ''}</span></div>
<div class="mb-3 text-gray-400 dark:text-gray-500">${ratchetSpark(it)}</div>
<ul class="lab-links lab-paths mt-auto space-y-1 text-xs"><li><span>soubor</span> <a href="${esc(m.blob(it.file))}">${esc(it.file)}</a></li><li><span>test</span> <a href="${esc(m.blob(c.test))}">${esc(c.test)}</a></li>${rule ? `<li><span>pravidlo</span> <a href="${esc(m.blob(rule))}">${esc(c.rule)}</a></li>` : '<li><span>pravidlo</span> žádné vlastní, váže ho test</li>'}</ul>
</article>`;
}

function ratchetsSection(m) {
  const r = m.facts.ratchets;
  const falling = r.items.filter((it) => it.rises === 0).length;
  return `<section id="dluh" class="${SECTION_ALT}">
<div class="${WRAP}">
<h2 class="${H2}">Dluh, který jen klesá</h2>
<p class="${LEAD}">Ratchet je soubor, který zapisuje zbývající dluh, a test, který selže, když dluh stoupne. Tady je každý takový soubor, který repozitář drží (tests/unit/*-baseline.json a tests/browser/*-baseline.json, nalezené ve stromu, ne vypsané ručně), s hodnotou v každé značce vydání a teď. Co soubor počítá, se čte z jeho vlastní struktury tak, jak ho čte jeho test (pravidlo pod kartami). ${fmtInt(falling)} z ${fmtInt(r.items.length)} od svého vzniku nikdy nestouplo; stropy velikosti souborů stoupat smějí, ale jen se záznamem v seznamu raises, a karta ty nárůsty počítá. Graf všech najdete také mezi <a class="${LINK}" href="#grafy">grafy</a>.</p>
<div class="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
${r.items.map((it) => ratchetCard(m, it)).join('\n')}
</div>
<p class="mt-4 break-words text-xs text-gray-500 dark:text-gray-400">Odvození: <code>${esc(r.rule)}</code>. Zdroj: <code>${esc(r.source)}</code>.</p>
</div>
</section>`;
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
<h2 class="${H2}">Revize a jejich nálezy</h2>
<p class="${LEAD}">Pull request, který mění střežené cesty, potřebuje záznam revize, který napsal někdo jiný než autor změny (pravidlo <a class="${LINK}" href="${esc(m.blob(m.rule('project.review-verdict')))}">project.review-verdict</a>). Každý záznam v <a class="${LINK}" href="${esc(m.tree('.ai/repo/reviews'))}">.ai/repo/reviews</a> uvádí verdikt a všechny nálezy se závažností P0 až P3 a stavem; otevřený nález P0 nebo P1 sloučení blokuje. Datum je okamžik, kdy byl záznam poprvé commitnut. Verdikty: ${verdicts}.</p>
<dl class="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
${stat(fmtInt(t.reviews), 'záznamů revizí')}
${stat(fmtInt(t.findings), 'nálezů')}
${stat(fmtInt(t.byStatus.open ?? 0), 'nálezů stále otevřených')}
${stat(fmtInt(openBlocking), 'otevřených P0 a P1')}
</dl>
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
<a href="#top" class="mb-4 flex items-center gap-3 rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 sm:mb-0">${m.mark('h-8 w-8')}<span class="text-xl font-semibold text-gray-900 dark:text-white">OSCILLA</span></a>
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

/** The page; `m` is the view model scripts/landing.mjs builds. */
export function renderPage(m) {
  return `<!doctype html>
<html lang="cs" class="motion-safe:scroll-smooth">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="${CSP}">
<meta name="description" content="OSCILLA: akustická laboratoř v prohlížeči bez instalace. Generujte, měřte a opakujte zvukové experimenty a vězte, nakolik lze každému výsledku věřit.">
<meta name="color-scheme" content="light dark">
<title>OSCILLA · Laboratoř zvuku a frekvencí</title>
<link rel="icon" href="${m.favicon}">
<script>(function(){var t=null;try{t=localStorage.getItem('oscilla-lab-theme')}catch(e){}var d=t?t==='dark':window.matchMedia('(prefers-color-scheme: dark)').matches;document.documentElement.classList.toggle('dark',d)})();</script>
${STYLE_MARKER}
</head>
<body class="bg-white font-sans text-gray-900 antialiased dark:bg-gray-900 dark:text-white">
<a href="#hlavni" class="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-primary-700 focus:px-4 focus:py-2 focus:text-white">Přeskočit na obsah</a>
${header(m)}
<main id="hlavni">
${hero(m)}
${frameSection(m)}
${workspaceCards(m)}
${libraries(m)}
${gallery(m)}
${chartsSection(m)}
${proof(m)}
${claimsExplorer(m)}
${releasesSection(m)}
${changesSection(m)}
${roadmapSection(m)}
${ratchetsSection(m)}
${reviewsSection(m)}
${adrSection(m)}
</main>
${footer(m)}
${SCRIPT_MARKER}
</body>
</html>
`;
}
