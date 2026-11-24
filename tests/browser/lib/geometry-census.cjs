// The DOM geometry census of plan issue U128: what a workspace shows of its panels, views and
// in-panel links, per workspace x viewport x engine, and the diff that judges a run against the
// committed baseline (tests/browser/geometry-census-baseline.json).
//
//   const gc = require('./lib/geometry-census.cjs');
//   const cell = await page.evaluate(gc.censusInPage,
//     { workspaces, linkSelector: gc.LINK_SELECTOR });
//   const diffs = gc.diffCensus(baseline.hosts.darwin, current, { tolerancePx: 8, rects: true });
//
// Live canvases never pixel-diff to zero, so the oracle of the membership refactor (U129, which
// moves panel membership into the shell registry and deletes the CSS visibility selectors) is
// the DOM: each element's computed display and visibility, whether it is rendered
// (getClientRects().length > 0) and its rect, compared within TOLERANCE_PX.
//
// An element's census entry is one string, so a baseline diff reads one line per element:
//   "<display> <visibility> <x>,<y>,<w>,<h>"   rendered, its border box in viewport pixels
//   "<display> <visibility> -"                 not rendered (no client rects)
// A cell is { "<element key>": "<entry>" }; a census is engine -> viewport -> workspace -> cell.
//
// Everything here but censusInPage is pure; tests/unit/geometry-census.test.mjs holds the diff.
'use strict';

/** The largest move or resize in px, per edge and per side, that is not a difference. */
const TOLERANCE_PX = 8;

/** The viewports of the census; a phone has touch (and isMobile where the engine has it). */
const VIEWPORTS = Object.freeze([
  { width: 1536, height: 1024, phone: false },
  { width: 1280, height: 800, phone: false },
  { width: 1024, height: 768, phone: false },
  { width: 768, height: 1024, phone: false },
  { width: 390, height: 844, phone: true },
  { width: 320, height: 740, phone: true },
].map(Object.freeze));

/**
 * The in-panel links and buttons that navigate: what the page declares a link
 * (data-osc-link: jump, open-in, send-to), the Studio and Synth hand-offs by their data-osc
 * suffix, the "Otevřít v…" menu buttons (data-osc "<panel>.openMenu") and the Related strip
 * and menu (data-osc "page.related*").
 */
const LINK_SELECTOR = [
  '[data-osc-link]',
  '[data-osc$=".toStudio"]',
  '[data-osc$=".toSynth"]',
  '[data-osc$=".openInStudio"]',
  '[data-osc$=".openMenu"]',
  '[data-osc^="page.related"]',
].join(', ');

const viewportKey = (v) => `${v.width}x${v.height}`;

/** "<display> <visibility> <rect|->" from its parts; `rect` is [x, y, w, h] or null. */
function encode({ display, visibility, rect }) {
  return `${display} ${visibility} ${rect ? rect.map((n) => Math.round(n)).join(',') : '-'}`;
}

/** The parts of an entry string; throws on a string that is not one. */
function decode(entry) {
  const m = /^(\S+) (\S+) (-|-?\d+,-?\d+,-?\d+,-?\d+)$/.exec(String(entry));
  if (!m) throw new TypeError(`geometry census: ${JSON.stringify(entry)} is not an entry`);
  const rect = m[3] === '-' ? null : m[3].split(',').map(Number);
  return { display: m[1], visibility: m[2], rendered: rect !== null, rect };
}

const RECT_PARTS = ['x', 'y', 'w', 'h'];

/**
 * What differs between two entries of one element: [] when equal within `tolerancePx`.
 * With `rects: false` only the membership is compared (display, visibility, rendered).
 */
function diffEntry(was, now, { tolerancePx = TOLERANCE_PX, rects = true } = {}) {
  const a = decode(was);
  const b = decode(now);
  const out = [];
  if (a.display !== b.display) out.push({ field: 'display', from: a.display, to: b.display });
  if (a.visibility !== b.visibility) {
    out.push({ field: 'visibility', from: a.visibility, to: b.visibility });
  }
  if (a.rendered !== b.rendered) {
    out.push({ field: 'rendered', from: a.rendered, to: b.rendered });
  } else if (rects && a.rect && b.rect) {
    RECT_PARTS.forEach((part, i) => {
      if (Math.abs(a.rect[i] - b.rect[i]) > tolerancePx) {
        out.push({ field: part, from: a.rect[i], to: b.rect[i] });
      }
    });
  }
  return out;
}

const keysOf = (o) => Object.keys(o || {});

/**
 * Every difference of `current` against `baseline` (both engine -> viewport -> workspace ->
 * cell). Only what the run measured is judged: an engine or viewport the run did not select is
 * not compared, but within a measured engine and viewport a workspace or an element present on
 * one side only is a difference. Each difference names its path
 * "<engine>/<viewport>/<workspace>[/<element>]" and its kind.
 */
function diffCensus(baseline, current, { tolerancePx = TOLERANCE_PX, rects = true } = {}) {
  const diffs = [];
  for (const engine of keysOf(current)) {
    for (const vp of keysOf(current[engine])) {
      const base = ((baseline || {})[engine] || {})[vp];
      const cur = current[engine][vp];
      if (!base) {
        diffs.push({ path: `${engine}/${vp}`, kind: 'no-baseline' });
        continue;
      }
      const spaces = [...new Set([...keysOf(base), ...keysOf(cur)])];
      for (const ws of spaces) {
        const at = `${engine}/${vp}/${ws}`;
        if (!(ws in cur)) { diffs.push({ path: at, kind: 'workspace-removed' }); continue; }
        if (!(ws in base)) { diffs.push({ path: at, kind: 'workspace-added' }); continue; }
        const elements = [...new Set([...keysOf(base[ws]), ...keysOf(cur[ws])])];
        for (const el of elements) {
          const path = `${engine}/${vp}/${ws}/${el}`;
          if (!(el in cur[ws])) {
            diffs.push({ path, kind: 'removed', from: base[ws][el] });
          } else if (!(el in base[ws])) {
            diffs.push({ path, kind: 'added', to: cur[ws][el] });
          } else {
            const fields = diffEntry(base[ws][el], cur[ws][el], { tolerancePx, rects });
            if (fields.length) {
              diffs.push({ path, kind: 'changed', from: base[ws][el], to: cur[ws][el], fields });
            }
          }
        }
      }
    }
  }
  return diffs;
}

/** One readable line per difference. */
function formatDiff(diffs, { tolerancePx = TOLERANCE_PX } = {}) {
  return diffs.map((d) => {
    switch (d.kind) {
      case 'no-baseline': return `${d.path}: no baseline for this engine and viewport`;
      case 'workspace-removed': return `${d.path}: workspace in the baseline, not measured`;
      case 'workspace-added': return `${d.path}: workspace measured, not in the baseline`;
      case 'removed': return `${d.path}: removed (was "${d.from}")`;
      case 'added': return `${d.path}: added ("${d.to}")`;
      default: return `${d.path}: ${d.fields.map((f) => `${f.field} ${f.from} -> ${f.to}`)
        .join(', ')} (was "${d.from}", now "${d.to}", tolerance ${tolerancePx} px)`;
    }
  });
}

/**
 * Judge a run on `host` (process.platform): against the host's own record, membership and
 * rects; on a host with no record, membership only against `fallbackHost`'s (rects depend on
 * the host's fonts). Returns { diffs, against, rects }; `against` is null when no host has a
 * record (every cell is then a 'no-baseline' difference).
 */
function judge(baseline, current, host, { tolerancePx } = {}) {
  const hosts = (baseline && baseline.hosts) || {};
  const tol = tolerancePx ?? (baseline && baseline.tolerancePx) ?? TOLERANCE_PX;
  if (hosts[host]) {
    return { against: host, rects: true, tolerancePx: tol,
      diffs: diffCensus(hosts[host], current, { tolerancePx: tol, rects: true }) };
  }
  const fallback = Object.keys(hosts).sort()[0] || null;
  return { against: fallback, rects: false, tolerancePx: tol,
    diffs: diffCensus(fallback ? hosts[fallback] : {}, current,
      { tolerancePx: tol, rects: false }) };
}

/**
 * The baseline after an --update on `host`: the measured engines and viewports replace that
 * host's record, everything else is kept. Returns { next, diffs } where diffs is what the
 * update changed (against the host's old record, membership and rects).
 */
function update(baseline, current, host, { tolerancePx = TOLERANCE_PX, comment = [] } = {}) {
  const old = (baseline && baseline.hosts && baseline.hosts[host]) || {};
  const diffs = diffCensus(old, current, { tolerancePx, rects: true });
  const record = JSON.parse(JSON.stringify(old));
  for (const engine of keysOf(current)) {
    record[engine] = record[engine] || {};
    for (const vp of keysOf(current[engine])) record[engine][vp] = current[engine][vp];
  }
  const hosts = { ...((baseline && baseline.hosts) || {}), [host]: sortKeys(record) };
  const next = { $comment: comment.length ? comment : (baseline && baseline.$comment) || [],
    tolerancePx, hosts: sortKeys(hosts) };
  return { next, diffs };
}

/** Hosts and engines sorted by name; viewports, workspaces and elements keep their order. */
const sortKeys = (o) => Object.fromEntries(Object.keys(o).sort().map((k) => [k, o[k]]));

/** Number of elements and of rendered elements per engine, for the report. */
function counts(current) {
  const out = {};
  for (const engine of keysOf(current)) {
    let cells = 0; let elements = 0; let rendered = 0;
    for (const vp of keysOf(current[engine])) {
      for (const ws of keysOf(current[engine][vp])) {
        cells += 1;
        for (const entry of Object.values(current[engine][vp][ws])) {
          elements += 1;
          if (decode(entry).rendered) rendered += 1;
        }
      }
    }
    out[engine] = { cells, elements, rendered };
  }
  return out;
}

// ------------------------------------------------------------------------------ page side
/**
 * The census of the open page, in document order: every element carrying data-osc-panel,
 * every <section> whose id ends in "-<workspace id>", every element of `linkSelector` inside
 * one of those that is rendered (the shell's navigation and header are not in it; a link of a
 * hidden panel is left out, the panel's own entry says it is hidden), and the page header's
 * Related strip and menu (data-osc "page.related*") always.
 * Keys: "panel:<data-osc-panel>", "section:#<id>", "link:<data-osc>" with "#<id>" when the
 * element has an id, else ">" + data-to or "@" + href when it has one, and "~<n>" for the
 * n-th repeat of a key. Runs in the page; self-contained.
 */
function censusInPage({ workspaces, linkSelector }) {
  const ends = new RegExp(`-(${workspaces.join('|')})$`);
  const found = new Map();
  const put = (el, kind) => { if (!found.has(el)) found.set(el, kind); };
  for (const el of document.querySelectorAll('[data-osc-panel]')) put(el, 'panel');
  for (const el of document.querySelectorAll('section[id]')) {
    if (ends.test(el.id)) put(el, 'section');
  }
  const shownContainers = [...found.keys()].filter((c) => c.getClientRects().length > 0);
  for (const el of document.querySelectorAll(linkSelector)) {
    const related = (el.getAttribute('data-osc') || '').startsWith('page.related');
    if (related || shownContainers.some((c) => c !== el && c.contains(el))) put(el, 'link');
  }
  const els = [...found.keys()].sort((a, b) => (
    a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1));
  const seen = new Map();
  const cell = {};
  for (const el of els) {
    const kind = found.get(el);
    let key;
    if (kind === 'panel') key = `panel:${el.dataset.oscPanel}`;
    else if (kind === 'section') key = `section:#${el.id}`;
    else {
      const osc = el.getAttribute('data-osc') || el.tagName.toLowerCase();
      const to = el.getAttribute('data-to');
      const href = el.getAttribute('href');
      key = `link:${osc}${el.id ? `#${el.id}` : to ? `>${to}` : href ? `@${href}` : ''}`;
    }
    const n = (seen.get(key) || 0) + 1;
    seen.set(key, n);
    if (n > 1) key = `${key}~${n}`;
    const cs = getComputedStyle(el);
    const rendered = el.getClientRects().length > 0;
    const r = rendered ? el.getBoundingClientRect() : null;
    const rect = r ? [r.x, r.y, r.width, r.height].map((v) => Math.round(v)) : null;
    cell[key] = `${cs.display} ${cs.visibility} ${rect ? rect.join(',') : '-'}`;
  }
  return cell;
}

module.exports = {
  TOLERANCE_PX, VIEWPORTS, LINK_SELECTOR, viewportKey, encode, decode, diffEntry, diffCensus,
  formatDiff, judge, update, counts, censusInPage,
};
