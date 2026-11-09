// The markup of the generated landing at /oscilla/lab/ (plan P014, owner decision Q107): one
// Czech page on Flowbite Pro's marketing blocks (header navbar, hero with app preview, card
// statistics, feature card list, tabs, project-portfolio grid with a modal, timeline, footer),
// adapted into OSCILLA's own markup; no Pro source file is copied. Every number and list comes
// from the facts (scripts/facts.mjs); every sentence from scripts/landing/copy.mjs or here.
//
//   renderPage(model) -> the HTML document with the markers STYLE and SCRIPT still in place
//   (scripts/landing.mjs compiles Tailwind over this markup, then fills them).

import { esc, fmtDate, fmtDec, fmtInt, MB, chartTable } from './charts.mjs';
import {
  CATEGORY_COPY, CLAIM_STATUS_COPY, ENGINE_COPY, FRAME_TABS, GROUP_COPY, WORKSPACE_COPY,
} from './copy.mjs';

export const STYLE_MARKER = '<!-- lab:style -->';
export const SCRIPT_MARKER = '<!-- lab:script -->';
export const REPO_URL = 'https://github.com/korczis/oscilla';

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
const BADGE = 'me-2 inline-flex items-center rounded px-2.5 py-0.5 text-xs font-medium';
const BADGE_BLUE = `${BADGE} bg-primary-100 text-primary-800 dark:bg-primary-900 `
  + 'dark:text-primary-300';
const BADGE_GRAY = `${BADGE} bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300`;
const H2 = 'mb-4 text-3xl font-extrabold tracking-tight text-gray-900 dark:text-white';
const LEAD = 'mb-8 max-w-3xl text-gray-500 dark:text-gray-400 sm:text-lg';
const SECTION = 'scroll-mt-20 bg-white dark:bg-gray-900';
const SECTION_ALT = 'scroll-mt-20 bg-gray-50 dark:bg-gray-800/40';
const WRAP = 'mx-auto max-w-screen-xl px-4 py-12 lg:px-6 lg:py-16';

const NAV = [
  ['#hrat', 'Hrát'], ['#plochy', 'Pracovní plochy'], ['#galerie', 'Galerie'],
  ['#grafy', 'Grafy'], ['#dukazy', 'Důkazy'], ['#vydani', 'Vydání'],
];

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
    + 'focus-visible:ring-primary-500 dark:text-gray-300 dark:hover:bg-gray-700 lg:p-2 '
    + `lg:hover:bg-transparent lg:hover:text-primary-700 dark:lg:hover:text-white">${label}</a>`
    + '</li>').join('');
  return `<header class="sticky top-0 z-30">
<nav class="border-b border-gray-200 bg-white px-4 py-2.5 dark:border-gray-700 dark:bg-gray-800 lg:px-6" aria-label="Hlavní">
<div class="mx-auto flex max-w-screen-xl flex-wrap items-center justify-between">
<a href="#top" class="flex items-center gap-3 rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500">${m.mark('h-8 w-8')}<span class="self-center whitespace-nowrap text-xl font-semibold text-gray-900 dark:text-white">OSCILLA</span></a>
<div class="flex items-center gap-2 lg:order-2">
<button type="button" data-theme-toggle aria-pressed="false" aria-label="Přepnout motiv" class="rounded-lg p-2.5 text-sm text-gray-500 hover:bg-gray-100 focus:outline-none focus:ring-4 focus:ring-gray-200 dark:text-gray-400 dark:hover:bg-gray-700 dark:focus:ring-gray-700"><span class="dark:hidden">${icon(m.icons, 'moon')}</span><span class="hidden dark:inline">${icon(m.icons, 'sun')}</span></button>
<a href="${esc(m.appHref)}" class="hidden rounded-lg bg-primary-700 px-4 py-2 text-sm font-medium text-white hover:bg-primary-800 focus:outline-none focus:ring-4 focus:ring-primary-300 dark:bg-primary-600 dark:hover:bg-primary-700 dark:focus:ring-primary-800 sm:inline-flex">Otevřít laboratoř</a>
<button type="button" data-lab-menu-toggle aria-controls="lab-menu" aria-expanded="false" class="inline-flex items-center rounded-lg p-2 text-sm text-gray-500 hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-gray-200 dark:text-gray-400 dark:hover:bg-gray-700 dark:focus:ring-gray-600 lg:hidden"><span class="sr-only">Otevřít menu</span>${icon(m.icons, 'menu', 'h-6 w-6')}</button>
</div>
<div class="hidden w-full items-center justify-between lg:order-1 lg:flex lg:w-auto" id="lab-menu">
<ul class="mt-4 flex flex-col font-medium lg:mt-0 lg:flex-row lg:space-x-4">${links}</ul>
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
<dl class="mx-auto grid max-w-screen-lg grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
${stat(fmtInt(f.workspaces.items.length), 'pracovních ploch')}
${stat(fmtInt(f.templates.items.length), 'šablon Studia')}
${stat(fmtInt(f.engines.items.length), 'enginů Synthu')}
${stat(fmtInt(guaranteed), 'zaručených tvrzení')}
${stat(fmtInt(f.releases.items.length), 'vydání')}
${stat(`${fmtDec(f.dist.gzip / MB, 2)}&nbsp;MB`, 'jeden soubor, gzip')}
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

function chartsSection(m) {
  const cards = m.chartNames.map((name) => {
    const t = chartTable(name, m.facts);
    const rows = t.rows.map((r) => `<tr class="border-b border-gray-200 dark:border-gray-700">${r.map((c, i) => (i === 0 ? `<th scope="row" class="whitespace-nowrap px-3 py-2 font-medium text-gray-900 dark:text-white">${esc(c)}</th>` : `<td class="whitespace-nowrap px-3 py-2">${esc(c)}</td>`)).join('')}</tr>`).join('');
    return `<figure class="min-w-0 rounded-lg border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800">
<div data-chart-box class="relative"><div class="overflow-x-auto rounded-xl p-1 [&>svg]:block [&>svg]:h-auto [&>svg]:w-full [&>svg]:min-w-[600px] [&>svg]:rounded-xl [&>svg:focus]:outline-none [&>svg:focus-visible]:ring-4 [&>svg:focus-visible]:ring-primary-500">${m.charts[name].trim()}</div><p class="sr-only" aria-live="polite" data-chart-live></p></div>
<figcaption class="mt-3 flex flex-wrap items-center justify-between gap-2 text-sm text-gray-500 dark:text-gray-400"><span>Najetím, nebo po zaměření grafu šipkami, zobrazíte hodnoty. Na úzkém displeji graf posunete do strany.</span><a class="${LINK}" href="charts/${name}.svg">SVG soubor</a></figcaption>
<details class="mt-2 text-sm text-gray-500 dark:text-gray-400"><summary class="cursor-pointer rounded font-medium text-gray-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 dark:text-white">Tabulka hodnot</summary>
<div class="mt-2 max-h-72 overflow-auto"><table class="w-full text-left text-sm text-gray-500 dark:text-gray-400"><thead class="bg-gray-50 text-xs uppercase text-gray-700 dark:bg-gray-700 dark:text-gray-400"><tr>${t.head.map((h) => `<th scope="col" class="px-3 py-2">${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table></div>
</details>
</figure>`;
  }).join('\n');
  return `<section id="grafy" class="${SECTION_ALT}">
<div class="${WRAP}">
<h2 class="${H2}">Grafy z repozitáře</h2>
<p class="${LEAD}">Grafy se kreslí při každém nasazení z commitu, který se nasazuje: z release záznamů v <a class="${LINK}" href="${esc(m.tree(m.facts.releases.source))}">${esc(m.facts.releases.source)}</a>, z plánu, z <a class="${LINK}" href="${esc(m.blob(m.facts.claims.source))}">${esc(m.facts.claims.source)}</a> a z historie gitu. Tytéž soubory SVG ukazuje README.</p>
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
  const ids = f.claims.items.map((c) => `<li><span class="${c.status === 'guaranteed' ? BADGE_BLUE : BADGE_GRAY}">${esc(CLAIM_STATUS_COPY[c.status]?.name ?? c.status)}</span><code class="text-xs">${esc(c.id)}</code></li>`).join('');
  return `<section id="dukazy" class="${SECTION}">
<div class="${WRAP}">
<h2 class="${H2}">Jak víme, že to platí</h2>
<p class="${LEAD}">Co OSCILLA tvrdí, stojí v matici tvrzení <a class="${LINK}" href="${esc(m.blob(f.claims.source))}">${esc(f.claims.source)}</a>: každé tvrzení jednou větou, se souborem, který chování definuje, se souborem, který ho implementuje, a s testem, který ho dokazuje. Zaručené tvrzení hlídá test v release gate a CI bez něj nic nesloučí. Úrovně jsou relativní (jako dBFS), dokud je nekalibrujete vůči vnějšímu referenčnímu měřidlu, a aplikace to vždy uvádí.</p>
<div class="mb-6 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
${cards}
<div class="${CARD}"><p class="mb-1 text-4xl font-extrabold text-gray-900 dark:text-white">${fmtInt(f.tests.unit)}</p><h3 class="mb-2 text-lg font-semibold text-gray-900 dark:text-white">souborů unit testů</h3><p class="text-gray-500 dark:text-gray-400">a ${fmtInt(f.tests.browser)} souborů prohlížečových sad; co každý dokazuje, popisuje <a class="${LINK}" href="${esc(m.blob('tests/README.md'))}">tests/README.md</a>.</p></div>
<div class="${CARD}"><p class="mb-1 text-4xl font-extrabold text-gray-900 dark:text-white">${fmtInt(f.adrs.total)}</p><h3 class="mb-2 text-lg font-semibold text-gray-900 dark:text-white">rozhodnutí (ADR)</h3><p class="text-gray-500 dark:text-gray-400">Proč je aplikace taková, jaká je: <a class="${LINK}" href="${esc(m.tree(f.adrs.source))}">${esc(f.adrs.source)}</a>.</p></div>
</div>
<details class="${CARD}"><summary class="cursor-pointer rounded font-medium text-gray-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 dark:text-white">Všech ${fmtInt(f.claims.total)} tvrzení podle identifikátoru</summary><ul class="mt-4 grid gap-2 text-gray-700 dark:text-gray-300 sm:grid-cols-2 lg:grid-cols-3">${ids}</ul></details>
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
  return `<section id="vydani" class="${SECTION_ALT}">
<div class="${WRAP}">
<h2 class="${H2}">Vydání</h2>
<p class="${LEAD}">Posledních ${fmtInt(m.timeline.length)} z ${fmtInt(m.facts.releases.items.length)} vydání. Každé je jeden soubor HTML, který si můžete stáhnout a otevřít i bez připojení; velikost a otisk pocházejí z release záznamu. <a class="${LINK}" href="${REPO_URL}/releases">Všechna vydání na GitHubu</a>.</p>
<ol class="relative ms-3 border-s border-gray-200 dark:border-gray-700">
${rs}
</ol>
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
${releasesSection(m)}
</main>
${footer(m)}
${SCRIPT_MARKER}
</body>
</html>
`;
}
