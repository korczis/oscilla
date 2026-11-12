#!/usr/bin/env node
// K075: the integration map, a declared table of every link between workspaces, instruments,
// labs and visualizations, and the static scan that holds the code to it.
//
//   node tests/browser/lib/integration-map.mjs            rewrite the derived rows of the table
//   node tests/browser/lib/integration-map.mjs --check    exit 1, one line per problem, when the
//                                                         table is stale or the scan refuses
//
// The table is tests/browser/integration-map.json. Its `rows` are DERIVED here, never written
// by hand, from the sources lane A's P07 census already reads (no second list):
//   related     the workspace registry's related entries (src/js/ui/shell.js), each at the
//               control that shows it on the page: a panel or content link where the page
//               writes one, About's list, Learn's tool links, the empty state's action, the
//               breadcrumb root, else the page header's Related strip (ui/cross-links.js
//               pageRelatedOf decides which);
//   panel       the panel and content links (ui/counterparts.js PANEL_LINKS, CONTENT_LINKS);
//   nav         the sidebar item of every workspace (WORKSPACE_IDS);
//   about       About's workspace list;
//   learn       Learn's tool links (ui/cross-links.js LEARN_TOOLS), the Learn demos that
//               are links (src/js/data/learn.js, a demo with an href) and the concept cards'
//               links (LEARN_CONCEPTS, learn.link);
//   empty       a page's empty-state action (the registry's `empty.action`);
//   home        the breadcrumb root of every page (page.home) and the brand (header.brand).
// Its `declared` rows are the producers no source describes (a button whose handler opens
// another workspace, a copy-link action, a notice's action): written by hand, each with `why`.
// Its `absent` entries are the link kinds of K075 with no producer on this base, each with the
// issue that adds one. Its `reloadDebt` lists rows whose target state a reload does not
// restore today, each with its owning issue; it only shrinks (a listed row that heals fails).
//
// A row: { id, kind, from, control, selector, role, to, href, template, studio, source }
//   kind      open-in | send-to | jump (modulation-route and probe: `absent`)
//   control   the data-osc of the control that carries the link (its producer)
//   selector  how the browser suite finds it (data-osc, plus the href where one control
//             template renders several links)
//   role      the control's role in the accessibility tree (link, button, menuitem)
//   to        the workspace it opens; href the address it carries, or null for a button
//   studio    what it does to the one Studio store: same (the revision does not move), voice
//             (entering the Synth instantiates its voice: at most one commit, #329), template
//             (a Studio template replaces the document), patch (a Synth link applies its patch
//             yp=: the revision does not go back and the Synth shows that patch), converted (a
//             pattern is converted)
//
// The scan (scanSources) refuses, each a K075 acceptance item:
//   - a producer without the marker: a control in src/index.html that carries a workspace
//     address or calls a navigation action without data-osc-link, and a JS-built control or
//     route literal (href: '#m=...') without its `data-osc-link:` comment;
//   - a hash-route write without the marker: location.hash =, history.pushState and
//     replaceState in src/js without a `// data-osc-link: <control or writer>` comment on its
//     line or one of the two lines above;
//   - a producer without a row: a marked control no row names;
//   - a row naming a missing control: a row whose control is not a marked producer, or whose
//     marker names another kind.
// tests/unit/integration-map.test.mjs runs it on the repository and on mutated copies.

import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(HERE, '..', '..', '..');
export const MAP_PATH = path.join(ROOT, 'tests', 'browser', 'integration-map.json');

export const KINDS = Object.freeze(['open-in', 'send-to', 'modulation-route', 'probe', 'jump']);
const STUDIO_EFFECTS = Object.freeze(['same', 'voice', 'patch', 'template', 'converted']);
const ROLES = Object.freeze(['link', 'button', 'menuitem']);

// ------------------------------------------------------------------------------ markup scan
/**
 * The opening tags of an HTML text: { tag, attrs: Map(name -> value), line }. Quote-aware, so
 * an Alpine expression holding `>` (an arrow function) does not end its tag.
 */
export function parseTags(html) {
  const out = [];
  const re = /<([a-zA-Z][a-zA-Z0-9-]*)(?=[\s>/])/g;
  let m;
  while ((m = re.exec(html))) {
    let i = m.index + m[0].length;
    let quote = null;
    const start = i;
    for (; i < html.length; i += 1) {
      const c = html[i];
      if (quote) { if (c === quote) quote = null; } else if (c === '"' || c === "'") quote = c;
      else if (c === '>') break;
    }
    const body = html.slice(start, i);
    const attrs = new Map();
    const ar = /([:@a-zA-Z_][\w:.@-]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;
    let a;
    while ((a = ar.exec(body))) {
      if (!a[1] || a[1] === '/') continue;
      attrs.set(a[1], a[2] ?? a[3] ?? a[4] ?? '');
    }
    out.push({ tag: m[1].toLowerCase(), attrs, line: html.slice(0, m.index).split('\n').length });
    re.lastIndex = i;
  }
  return out;
}

// Actions that open another workspace or produce a link to a state (the component's methods).
const NAV_CALL = new RegExp(`\\b(${['setWorkspace', 'studioExpand', 'studioBack',
  'studioOpenSequence', 'synthOpenStudio', 'experimentsShowInMeasure', 'experimentsRepeat',
  'experimentsDefRun', 'runLearnDemo', 'connectionsFollow', 'findingsOpenRef',
  'measureCopyRecipeLink', 'synthCopyLink', 'studioCopyLink', 'copyConfigUrl'].join('|')})\\s*\\(`);
// x-bind helpers that make a link to a workspace (ui/app.js, ui/navigation.js).
const NAV_BIND = /\b(counterpartLink|homeLink|crumbHome|navItem|emptyAction)\s*\(/;

/** The control key of a tag: its data-osc, or `<prefix>*` for a bound one (`'nav.' + id`). */
function controlOf(attrs) {
  if (attrs.has('data-osc')) return attrs.get('data-osc');
  const bound = attrs.get(':data-osc');
  if (bound) {
    const p = /^\s*'([^']+)'\s*\+/.exec(bound);
    return p ? `${p[1]}*` : null;
  }
  return null;
}

/** Why a tag produces a link, or null: its address, its action or its binding. */
export function producerReason(tag, attrs) {
  const href = attrs.get('href');
  if (tag === 'a' && href && href.startsWith('#m=')) return `href ${href}`;
  const bound = attrs.get(':href');
  if (tag === 'a' && bound && (bound.includes("'#m=") || /\.href\s*$/.test(bound))) {
    return `:href ${bound}`;
  }
  for (const [k, v] of attrs) {
    if (k.startsWith('@click') && NAV_CALL.test(v)) return `${k} ${v.match(NAV_CALL)[1]}()`;
  }
  const bind = attrs.get('x-bind');
  if (bind && NAV_BIND.test(bind)) return `x-bind ${bind.match(NAV_BIND)[1]}()`;
  return null;
}

/** The role a producer tag has in the accessibility tree. */
function roleOf(tag, attrs) {
  if (attrs.get('role')) return attrs.get('role');
  return tag === 'a' ? 'link' : tag === 'button' ? 'button' : null;
}

/**
 * The producers of the markup: [{ control, role, kind (its data-osc-link, or null), line,
 * reason, dynamicHref, opener }]. A menu item's opener (G013) is the button its menu names by
 * aria-labelledby: the nearest role="menu" before it, by that button's data-osc.
 */
export function scanMarkup(html) {
  const out = [];
  const tags = parseTags(html);
  const oscById = new Map(tags.filter((t) => t.attrs.get('id') && t.attrs.get('data-osc'))
    .map((t) => [t.attrs.get('id'), t.attrs.get('data-osc')]));
  let menu = null;
  for (const { tag, attrs, line } of tags) {
    if (attrs.get('role') === 'menu') menu = oscById.get(attrs.get('aria-labelledby')) || null;
    const reason = producerReason(tag, attrs);
    if (!reason && !attrs.has('data-osc-link')) continue;
    const role = roleOf(tag, attrs);
    out.push({ control: controlOf(attrs), role,
      kind: attrs.has('data-osc-link') ? attrs.get('data-osc-link') : null, line, reason,
      dynamicHref: attrs.has(':href'), file: 'src/index.html',
      ...(role === 'menuitem' && menu ? { opener: `[data-osc="${menu}"]` } : {}) });
  }
  return out;
}

// ------------------------------------------------------------------------------ JS scan
const MARK = /data-osc-link:\s*([^\s*]+)/;
/** The code of a line, without a // comment (a // inside a string is rare enough here). */
const code = (line) => line.replace(/^\s*\*.*$/, '').replace(/(^|[^:'"`])\/\/.*$/, '$1');

/** The marker on a line or on one of the two lines above it, or null. */
function markerAt(lines, i) {
  for (let k = i; k >= Math.max(0, i - 2); k -= 1) {
    const m = MARK.exec(lines[k]);
    if (m) return m[1].trim();
  }
  return null;
}

const HASH_WRITE = [
  /\b(?:location|loc\(\))\.hash\s*=(?!=)/,
  /\b(?:pushState|replaceState)\b/,
];

/**
 * The hash-route writes and the JS-built producers of src/js files ([{ file, text }]):
 * { writes: [{ file, line, marker }], producers: [{ file, line, marker, what }] }.
 */
export function scanJs(files) {
  const writes = [];
  const producers = [];
  for (const { file, text } of files) {
    const lines = text.split('\n');
    lines.forEach((raw, i) => {
      const c = code(raw);
      if (HASH_WRITE.some((re) => re.test(c))) {
        writes.push({ file, line: i + 1, marker: markerAt(lines, i) });
      }
      if (/\bhref\s*:\s*['`]#m=/.test(c)) {
        producers.push({ file, line: i + 1, marker: markerAt(lines, i), what: 'route literal' });
      }
      // A control built in JS as markup that carries its marker beside its data-osc (K222: the
      // Drums tab's Open in Studio, synth/view/drums-tab.js): the marker is the declaration.
      const tagged = /data-osc="([^"]+)"[^<>]*data-osc-link="([^"]+)"/.exec(raw)
        || /data-osc-link="([^"]+)"[^<>]*data-osc="([^"]+)"/.exec(raw);
      if (tagged) {
        const [ctl, kind] = /^data-osc="/.test(tagged[0]) ? [tagged[1], tagged[2]]
          : [tagged[2], tagged[1]];
        producers.push({ file, line: i + 1, marker: ctl, kind, control: ctl,
          what: 'JS-built markup' });
      }
      // A control built in JS ('data-osc': ...) whose onClick opens another workspace.
      if (/'data-osc'\s*:/.test(c)) {
        const next = lines.slice(i + 1, i + 4).findIndex((l) => /'data-osc'\s*:/.test(l));
        const span = lines.slice(i, next < 0 ? i + 4 : i + 1 + next).map(code).join(' ');
        if (/onClick\s*:[^}]*\b(expand|follow|setWorkspace)\s*\(/.test(span)) {
          const k = /'data-osc-link'\s*:\s*'([^']+)'/.exec(span);
          const ctl = /'data-osc'\s*:\s*'([^']+)'/.exec(c);
          producers.push({ file, line: i + 1, marker: k ? (ctl && ctl[1]) : null,
            kind: k ? k[1] : null, control: ctl && ctl[1], what: 'JS-built control' });
        }
      }
    });
  }
  return { writes, producers };
}

/** Every .js file under src/js, as [{ file (repository-relative), text }]. */
export function readJs(root = ROOT) {
  const out = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir).sort()) {
      const p = path.join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (name.endsWith('.js')) {
        out.push({ file: path.relative(root, p).split(path.sep).join('/'),
          text: readFileSync(p, 'utf8') });
      }
    }
  };
  walk(path.join(root, 'src', 'js'));
  return out;
}

// ------------------------------------------------------------------------------ derivation
/** The modules the rows are derived from, imported from src (pure modules). */
export async function loadModel(root = ROOT) {
  const src = (...p) => pathToFileURL(path.join(root, 'src', 'js', ...p)).href;
  const shell = await import(src('ui', 'shell.js'));
  const counterparts = await import(src('ui', 'counterparts.js'));
  const cross = await import(src('ui', 'cross-links.js'));
  const nav = await import(src('ui', 'navigation.js'));
  const learn = await import(src('data', 'learn.js'));
  return { shell, counterparts, cross, nav, learn };
}

const ref = (href) => href.replace(/^#m=/, '');
const templateOf = (href) => {
  const m = /[#&]st=([a-z0-9-]+)/.exec(href || '');
  return m ? m[1] : null;
};

/** A row's id: source workspace, control and target address (or workspace). */
export function rowId(r) {
  return `${r.from} > ${r.control} > ${r.href ? ref(r.href) : r.to}`;
}

/** What a link does to the Studio store (see the header). */
export function studioEffect(r) {
  if (templateOf(r.href)) return 'template';
  if (r.to === 'synth' && /[#&]yp=/.test(r.href || '')) return 'patch';
  if (r.to === 'synth' && r.from !== 'synth') return 'voice';
  return 'same';
}

/**
 * The derived rows, from the model and the markup's producers (for each control's role and
 * whether one control template renders several hrefs).
 */
export function deriveRows(model, producers) {
  const { shell, counterparts, cross, nav, learn } = model;
  const byControl = new Map();
  for (const p of producers) {
    if (p.control && !byControl.has(p.control)) byControl.set(p.control, p);
  }
  const lookup = (control) => byControl.get(control)
    || byControl.get(`${control.replace(/[^.]+$/, '')}*`) || null;
  const rows = new Map();
  const add = (r) => {
    const route = r.href ? nav.routeOfHash(r.href) : null;
    const to = r.to || (route && route.workspace);
    const p = lookup(r.control);
    const byHref = p && p.dynamicHref && r.href ? `[href="${r.href}"]` : '';
    const sel = `[data-osc="${r.control}"]${byHref}`;
    const row = { kind: r.kind || (templateOf(r.href) ? 'open-in' : 'jump'), from: r.from,
      control: r.control, selector: sel, role: p ? p.role : null, to,
      href: r.href || null, template: templateOf(r.href), source: r.source };
    if (r.text) row.text = r.text;
    if (p && p.opener) row.opener = p.opener;
    row.studio = studioEffect(row);
    row.id = rowId(row);
    if (!rows.has(row.id)) rows.set(row.id, row);
  };
  const live = counterparts.livePanelLinks();
  const contentLinks = [...live.map((l) => ({ ...l, source: 'panel' })),
    ...counterparts.CONTENT_LINKS.map((l) => ({ ...l, source: 'panel' }))];
  // Panel and content links, where each is written.
  for (const l of contentLinks) {
    for (const f of l.from) add({ from: f, control: l.osc, href: `#m=${l.to}`, source: l.source });
  }
  // The registry's related entries, at the control that shows each on its page.
  for (const w of shell.WORKSPACE_REGISTRY) {
    const strip = new Set(cross.pageRelatedOf(w.id).map(shell.relatedRef));
    for (const r of w.related || []) {
      const to = shell.relatedRef(r);
      const href = shell.relatedHref(r);
      let control;
      if (strip.has(to)) control = 'page.relatedLink';
      else if (contentLinks.some((l) => l.to === to && l.from.includes(w.id))) continue;
      else if (w.id === 'about') control = `about.open.${to}`;
      else if (w.id === 'learn' && Object.values(cross.LEARN_TOOLS).includes(to)) {
        control = 'learn.tool';
      }
      else if (w.empty && w.empty.action && w.empty.action.to === to) control = 'page.emptyAction';
      else if (to === 'playground') control = 'page.home';
      else throw new Error(`integration map: ${w.id} relates to ${to}, shown by no known control`);
      add({ from: w.id, control, href, source: 'related' });
    }
  }
  // The sidebar: every workspace from the Playground (the Playground from About).
  for (const id of shell.WORKSPACE_IDS) {
    add({ from: id === 'playground' ? 'about' : 'playground', control: `nav.${id}`,
      href: `#m=${id}`, source: 'nav' });
  }
  // About's workspace list.
  for (const id of shell.WORKSPACE_IDS.filter((x) => x !== 'about')) {
    add({ from: 'about', control: `about.open.${id}`, href: `#m=${id}`, source: 'about' });
  }
  // Learn: the tool links, and the demos that are links.
  for (const to of [...new Set(Object.values(cross.LEARN_TOOLS))]) {
    add({ from: 'learn', control: 'learn.tool', href: `#m=${to}`, source: 'learn' });
  }
  for (const t of learn.LEARN_TOPICS.filter((x) => x.demo && x.demo.href)) {
    add({ from: 'learn', control: 'learn.demo', href: t.demo.href, text: `Demo: ${t.demo.label}`,
      source: 'learn' });
  }
  // The concept cards' own links (V617, LEARN_CONCEPTS), an OSCILLA address each.
  for (const t of learn.LEARN_CARDS.filter((x) => x.link && x.link.href)) {
    add({ from: 'learn', control: 'learn.link', href: t.link.href, text: t.link.label,
      source: 'learn' });
  }
  // Empty states.
  for (const w of shell.WORKSPACE_REGISTRY.filter((x) => x.empty && x.empty.action)) {
    add({ from: w.id, control: 'page.emptyAction', href: `#m=${w.empty.action.to}`,
      source: 'empty' });
  }
  // The breadcrumb root on every other page, and the brand.
  for (const id of shell.WORKSPACE_IDS.filter((x) => x !== 'playground')) {
    add({ from: id, control: 'page.home', href: '#m=playground', source: 'home' });
  }
  add({ from: 'measure', control: 'header.brand', href: '#m=playground', source: 'home' });
  return [...rows.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

// ------------------------------------------------------------------------------ the check
/** Every row, derived and declared. */
export const allRows = (map) => [...(map.rows || []), ...(map.declared || [])];

/** A control key matches a producer key (`nav.measure` matches `nav.*`). */
const matches = (control, key) => key === control
  || (key && key.endsWith('*') && control.startsWith(key.slice(0, -1)));

/**
 * The problems of a table against the sources: { html, js: [{ file, text }] }. [] when the
 * table holds every producer and every write, and every row its control.
 */
export function checkMap(map, { html, js }) {
  const problems = [];
  const rows = allRows(map);
  const markup = scanMarkup(html);
  const { writes, producers: jsProducers } = scanJs(js);
  const writers = new Set((map.writers || []).map((w) => w.id));
  const controls = new Set(rows.map((r) => r.control));
  const ids = new Set();
  for (const r of rows) {
    if (ids.has(r.id)) problems.push(`row ${r.id}: listed twice`);
    ids.add(r.id);
    if (!KINDS.includes(r.kind)) problems.push(`row ${r.id}: unknown kind ${r.kind}`);
    if ((map.absent || []).some((a) => a.kind === r.kind)) {
      problems.push(`row ${r.id}: kind ${r.kind} is listed absent; remove it from absent`);
    }
    if (!STUDIO_EFFECTS.includes(r.studio)) problems.push(`row ${r.id}: studio ${r.studio}`);
    if (!ROLES.includes(r.role)) problems.push(`row ${r.id}: role ${r.role}`);
    if (!r.to) problems.push(`row ${r.id}: no target workspace`);
    if ((map.declared || []).includes(r) && !(r.why && r.why.length > 20)) {
      problems.push(`declared row ${r.id}: no why (say why it cannot be derived)`);
    }
    if (r.walk && !(r.walk.deferred && r.walk.covered)) {
      problems.push(`row ${r.id}: walk needs deferred (why) and covered (the suite that walks it)`);
    }
  }
  // A producer without the marker.
  for (const p of markup) {
    if (p.reason && !p.kind) {
      problems.push(`src/index.html:${p.line}: producer ${p.control || '(no data-osc)'} `
        + `(${p.reason}) has no data-osc-link`);
    }
  }
  for (const p of jsProducers) {
    if (!p.marker) {
      problems.push(`${p.file}:${p.line}: ${p.what} has no data-osc-link marker`);
    } else if (!rows.some((r) => matches(r.control, p.marker) || r.control === p.marker)) {
      problems.push(`${p.file}:${p.line}: ${p.what} names ${p.marker}, which no row carries`);
    }
  }
  // A hash-route write without the marker.
  for (const w of writes) {
    if (!w.marker) {
      problems.push(`${w.file}:${w.line}: hash-route write without a data-osc-link marker`);
    } else if (!writers.has(w.marker) && !controls.has(w.marker)) {
      problems.push(`${w.file}:${w.line}: marker ${w.marker} is neither a writer nor a row's `
        + 'control');
    }
  }
  for (const id of writers) {
    if (!writes.some((w) => w.marker === id)) problems.push(`writer ${id}: no write carries it`);
  }
  // A producer without a row; a row naming a missing control.
  const marked = [...markup.filter((p) => p.kind),
    ...jsProducers.filter((p) => p.kind).map((p) => ({ ...p, line: `${p.file}:${p.line}` }))];
  for (const p of marked) {
    if (!p.control) problems.push(`src/index.html:${p.line}: data-osc-link without a data-osc`);
    else if (!rows.some((r) => matches(r.control, p.control))) {
      problems.push(`producer ${p.control} (line ${p.line}) has no row`);
    }
  }
  for (const r of rows) {
    const p = marked.filter((x) => x.control && matches(r.control, x.control));
    if (!p.length) problems.push(`row ${r.id}: control ${r.control} is no marked producer`);
    else if (!p.some((x) => x.kind.split(/\s+/).includes(r.kind))) {
      problems.push(`row ${r.id}: control ${r.control} is marked `
        + `${p.map((x) => x.kind).join(', ')}, the row is ${r.kind}`);
    }
  }
  return problems;
}

/** The table with its derived rows rebuilt from the sources; the hand-written parts kept. */
export function rebuild(map, model, html) {
  const declared = new Set((map.declared || []).map((r) => r.id));
  return { ...map,
    rows: deriveRows(model, scanMarkup(html)).filter((r) => !declared.has(r.id)) };
}

export const serialize = (map) => `${JSON.stringify(map, null, 2)}\n`;

async function main(argv) {
  const check = argv.includes('--check');
  const html = readFileSync(path.join(ROOT, 'src', 'index.html'), 'utf8');
  const text = readFileSync(MAP_PATH, 'utf8');
  const map = JSON.parse(text);
  const next = rebuild(map, await loadModel(), html);
  if (!check) {
    writeFileSync(MAP_PATH, serialize(next));
    console.log(`integration map: ${next.rows.length} derived and ${(next.declared || []).length} `
      + `declared rows -> ${path.relative(ROOT, MAP_PATH)}`);
  }
  const problems = checkMap(next, { html, js: readJs() });
  if (check && serialize(next) !== text) {
    problems.unshift('tests/browser/integration-map.json is stale: run node '
      + 'tests/browser/lib/integration-map.mjs');
  }
  for (const p of problems) console.error(`integration map: ${p}`);
  return problems.length ? 1 : 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then((code) => process.exit(code));
}
