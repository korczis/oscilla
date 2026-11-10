// The charts of the README and the /lab/ landing (plan P014, owner decision Q107): one renderer,
// static SVG strings from scripts/facts.mjs, deployed as lab/charts/<name>.svg. The README
// embeds those files by URL (CHART_BASE of facts.mjs) and the landing inlines the same bytes, so
// both show one drawing. Nothing here reads the clock or the network.
//
// Each chart carries its own ground (OSCILLA's dark panel surface, src/styles/tokens.css), so it
// reads the same on GitHub's light and dark themes and on both landing themes; a <title> and a
// <desc> name it for assistive technology, and every mark is a <g class="mark"> whose first
// child is its <title> (the landing's script turns those into a hover and focus readout; a
// browser shows the <title> natively; the text is written once, not again as an attribute).
// Marks follow the dataviz rules: one axis, thin marks with 4 px rounded data ends, a 2 px
// ground gap between fills, text in text tokens, never in a series colour.
// The titles are Czech (project.czech-prose: published pages), each with an English subtitle
// for the README.
//
//   renderCharts(facts) -> { releases, size, plan, claims, activity, modules, growth, burnup,
//                            'claims-trend', ratchets, reviews, cadence }    (SVG strings)
//   chartTable(name, facts) -> { caption, head: [..], rows: [[..]] }     (the table view)

import { CHARTS } from '../facts.mjs';
import { RATCHET_COPY } from './copy.mjs';

// OSCILLA tokens (src/styles/tokens.css, the dark reference): ground, outline, text, marks.
// The two categorical slots (blue, magenta) pass the dataviz validator on the ground (CVD 8.9,
// normal 31.0, contrast >= 3:1; magenta sits 0.011 over the lightness band), and every mark of
// either is direct-labelled.
export const CHART_TOKENS = Object.freeze({
  ground: '#06111d', border: '#14222f', grid: '#788eb4', text: '#f3f6f9', text2: '#c4d2df',
  muted: '#94a9bd', dim: '#66798d', blue: '#007afd', second: '#f04ac4', rest: '#2a3d52',
});
const T = CHART_TOKENS;
const FONT = 'system-ui, -apple-system, BlinkMacSystemFont, &quot;Segoe UI&quot;, Roboto, '
  + 'sans-serif';
const W = 720;
const H = 280;
const PLOT = Object.freeze({ x0: 64, x1: 690, y0: 92, y1: 226 });
const MONTHS = ['led', 'úno', 'bře', 'dub', 'kvě', 'čvn', 'čvc', 'srp', 'zář', 'říj', 'lis',
  'pro'];

const r1 = (n) => Math.round(n * 10) / 10;
export const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
  .replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** 12345 -> '12 345' (Czech grouping, a no-break space). */
export function fmtInt(n) {
  return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}
/** 2.94 -> '2,94' (Czech decimal comma). */
export function fmtDec(n, digits = 2) {
  const [i, f] = n.toFixed(digits).split('.');
  return f ? `${fmtInt(Number(i))},${f}` : fmtInt(Number(i));
}
/** '2026-10-06T01:19:57Z' -> '6. 10. 2026' (UTC). */
export function fmtDate(iso, year = true) {
  const d = new Date(iso);
  return `${d.getUTCDate()}. ${d.getUTCMonth() + 1}.${year ? ` ${d.getUTCFullYear()}` : ''}`;
}
export const MB = 1_000_000;

/** A round step for an axis of `max` with about `n` ticks. */
function niceStep(max, n = 4) {
  const raw = max / n;
  const p = 10 ** Math.floor(Math.log10(raw || 1));
  return [1, 2, 2.5, 5, 10].map((m) => m * p).find((s) => s >= raw) || p * 10;
}

function frame(name, title, subtitle, desc, body, h = H) {
  const id = `oscilla-chart-${name}`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${h}" width="${W}" `
    + `height="${h}" role="img" aria-labelledby="${id}-t ${id}-d" data-chart="${name}" `
    + `font-family="${FONT}">`
    + `<title id="${id}-t">${esc(title)}</title><desc id="${id}-d">${esc(desc)}</desc>`
    + `<rect x="0.5" y="0.5" width="${W - 1}" height="${h - 1}" rx="12" fill="${T.ground}" `
    + `stroke="${T.border}"/>`
    + `<text x="24" y="38" fill="${T.text}" font-size="18" font-weight="600">${esc(title)}</text>`
    + `<text x="24" y="60" fill="${T.muted}" font-size="12">${esc(subtitle)}</text>`
    + body + '</svg>\n';
}

function yAxis(max, step, fmt) {
  let out = '';
  for (let v = 0; v <= max + 1e-9; v += step) {
    const y = r1(PLOT.y1 - (v / max) * (PLOT.y1 - PLOT.y0));
    out += `<line x1="${PLOT.x0}" x2="${PLOT.x1}" y1="${y}" y2="${y}" stroke="${T.grid}" `
      + `stroke-opacity="${v === 0 ? 0.35 : 0.14}"/>`
      + `<text x="${PLOT.x0 - 8}" y="${r1(y + 4)}" fill="${T.dim}" font-size="11" `
      + `text-anchor="end">${esc(fmt(v))}</text>`;
  }
  return out;
}

function xLabel(x, text, anchor = 'middle') {
  return `<text x="${r1(x)}" y="${PLOT.y1 + 20}" fill="${T.dim}" font-size="11" `
    + `text-anchor="${anchor}">${esc(text)}</text>`;
}

function mark(tip, inner) {
  return `<g class="mark"><title>${esc(tip)}</title>${inner}</g>`;
}

// A bar from the baseline with 4 px rounded data end (top), as a path.
function barUp(x, w, y, base) {
  const r = Math.min(4, w / 2, base - y);
  if (base - y < 0.5) return `M${r1(x)},${r1(base)}h${r1(w)}`;
  return `M${r1(x)},${r1(base)}V${r1(y + r)}Q${r1(x)},${r1(y)} ${r1(x + r)},${r1(y)}`
    + `H${r1(x + w - r)}Q${r1(x + w)},${r1(y)} ${r1(x + w)},${r1(y + r)}V${r1(base)}Z`;
}
// A horizontal bar from x with 4 px rounded data end (right).
function barRight(x, y, w, h, round = true) {
  const r = round ? Math.min(4, h / 2, w) : 0;
  return `M${r1(x)},${r1(y)}H${r1(x + w - r)}Q${r1(x + w)},${r1(y)} ${r1(x + w)},${r1(y + r)}`
    + `V${r1(y + h - r)}Q${r1(x + w)},${r1(y + h)} ${r1(x + w - r)},${r1(y + h)}H${r1(x)}Z`;
}

function empty(name, title, subtitle) {
  return frame(name, title, subtitle, `${title}: žádná data.`,
    `<text x="${W / 2}" y="${H / 2 + 20}" fill="${T.muted}" font-size="14" `
    + 'text-anchor="middle">Zatím žádná data</text>');
}

// ------------------------------------------------------------------------------- releases
const datedReleases = (facts) => (facts.releases?.items || [])
  .filter((r) => r.published_at).slice()
  .sort((a, b) => (a.published_at < b.published_at ? -1 : a.published_at > b.published_at ? 1 : 0));

function dateTicks(t0, t1) {
  const ticks = [];
  const d = new Date(t0);
  let cur = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
  const half = t1 - t0 < 120 * 86400000;
  while (cur <= t1) {
    const c = new Date(cur);
    for (const day of half ? [1, 15] : [1]) {
      const t = Date.UTC(c.getUTCFullYear(), c.getUTCMonth(), day);
      if (t >= t0 && t <= t1) ticks.push(t);
    }
    cur = Date.UTC(c.getUTCFullYear(), c.getUTCMonth() + 1, 1);
  }
  return ticks;
}

function releasesChart(facts) {
  const title = 'Vydání v čase';
  const sub = 'Releases over time: every published version, cumulative';
  const rs = datedReleases(facts);
  if (!rs.length) return empty('releases', title, sub);
  const ts = rs.map((r) => Date.parse(r.published_at));
  const span = Math.max(ts[ts.length - 1] - ts[0], 86400000);
  const t0 = ts[0] - span * 0.03;
  const t1 = ts[ts.length - 1] + span * 0.03;
  const x = (t) => PLOT.x0 + ((t - t0) / (t1 - t0)) * (PLOT.x1 - PLOT.x0);
  const step = niceStep(rs.length);
  const max = Math.ceil(rs.length / step) * step;
  const y = (n) => PLOT.y1 - (n / max) * (PLOT.y1 - PLOT.y0);
  let body = yAxis(max, step, fmtInt);
  for (const t of dateTicks(t0, t1)) {
    const d = new Date(t);
    body += xLabel(x(t), d.getUTCDate() === 1 ? `${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`
      : fmtDate(new Date(t).toISOString(), false));
  }
  let line = `M${r1(x(ts[0]))},${r1(y(0))}`;
  rs.forEach((_, i) => { line += `V${r1(y(i + 1))}H${r1(x(ts[i + 1] ?? ts[i]))}`; });
  body += `<path d="${line}" fill="none" stroke="${T.blue}" stroke-width="2" `
    + 'stroke-linejoin="round"/>';
  rs.forEach((r, i) => {
    const cx = r1(x(ts[i]));
    const cy = r1(y(i + 1));
    body += mark(`v${r.version} · ${fmtDate(r.published_at)} · ${i + 1}. vydání`,
      `<circle cx="${cx}" cy="${cy}" r="9" fill="transparent"/>`
      + `<circle cx="${cx}" cy="${cy}" r="4" fill="${T.blue}" stroke="${T.ground}" `
      + 'stroke-width="2"/>');
  });
  const first = rs[0];
  const last = rs[rs.length - 1];
  body += `<text x="${r1(x(ts[0]) + 8)}" y="${r1(y(1) - 8)}" fill="${T.text2}" font-size="12">`
    + `v${esc(first.version)}</text>`
    + `<text x="${r1(x(ts[ts.length - 1]) - 8)}" y="${r1(y(rs.length) - 10)}" fill="${T.text}" `
    + `font-size="12" font-weight="600" text-anchor="end">v${esc(last.version)} · `
    + `${fmtInt(rs.length)} vydání</text>`;
  return frame('releases', title, sub, `${fmtInt(rs.length)} vydání od v${first.version} `
    + `(${fmtDate(first.published_at)}) po v${last.version} (${fmtDate(last.published_at)}).`,
  body);
}

// ------------------------------------------------------------------------------- size
function sizeChart(facts) {
  const title = 'Velikost jednoho souboru';
  const sub = 'Single-file size per release (MB, the published HTML artifact)';
  const rs = datedReleases(facts).filter((r) => Number.isFinite(r.size));
  if (!rs.length) return empty('size', title, sub);
  const maxMb = Math.max(...rs.map((r) => r.size / MB));
  const step = niceStep(maxMb);
  const max = Math.ceil(maxMb / step) * step;
  const slot = (PLOT.x1 - PLOT.x0) / rs.length;
  const w = Math.max(2, Math.min(28, slot - 2));
  const y = (mb) => PLOT.y1 - (mb / max) * (PLOT.y1 - PLOT.y0);
  let body = yAxis(max, step, (v) => fmtDec(v, step < 1 ? 1 : 0));
  const every = Math.max(1, Math.ceil(rs.length / 6));
  rs.forEach((r, i) => {
    const bx = PLOT.x0 + i * slot + (slot - w) / 2;
    const mb = r.size / MB;
    body += mark(`v${r.version} · ${fmtDec(mb)} MB (${fmtInt(r.size)} B)`,
      `<rect x="${r1(PLOT.x0 + i * slot)}" y="${PLOT.y0}" width="${r1(slot)}" `
      + `height="${PLOT.y1 - PLOT.y0}" fill="transparent"/>`
      + `<path d="${barUp(bx, w, y(mb), PLOT.y1)}" fill="${T.blue}"/>`);
    if (i % every === 0 && rs.length - 1 - i >= every) {
      body += xLabel(bx + w / 2, `v${r.version}`);
    }
  });
  const last = rs[rs.length - 1];
  const lx = PLOT.x0 + (rs.length - 1) * slot + slot / 2;
  body += xLabel(lx, `v${last.version}`, 'end')
    + `<text x="${r1(lx)}" y="${r1(y(last.size / MB) - 8)}" fill="${T.text}" font-size="12" `
    + `font-weight="600" text-anchor="end">${fmtDec(last.size / MB)} MB</text>`;
  return frame('size', title, sub, `Velikost publikovaného souboru aplikace u ${fmtInt(rs.length)} `
    + `vydání; poslední v${last.version} má ${fmtDec(last.size / MB)} MB.`, body);
}

// ------------------------------------------------------------------------------- stacked rows
function stackedRows(rows, legend) {
  // rows: [{ label, parts: [{ key, n, colour, name }] }]
  const x0 = 140;
  const x1 = PLOT.x1;
  const h = 34;
  let body = '';
  rows.forEach((row, ri) => {
    const total = row.parts.reduce((s, p) => s + p.n, 0) || 1;
    const top = PLOT.y0 + 6 + ri * 58;
    body += `<text x="24" y="${top + 22}" fill="${T.text2}" font-size="13">${esc(row.label)}`
      + '</text>';
    let cx = x0;
    const nonZero = row.parts.filter((p) => p.n > 0);
    nonZero.forEach((p, pi) => {
      const pw = ((x1 - x0) * p.n) / total;
      const gap = pi < nonZero.length - 1 ? 2 : 0;
      const last = pi === nonZero.length - 1;
      const pct = Math.round((100 * p.n) / total);
      const d = last ? barRight(cx, top, Math.max(pw - gap, 1), h)
        : `M${r1(cx)},${top}h${r1(Math.max(pw - gap, 1))}v${h}h${r1(-Math.max(pw - gap, 1))}Z`;
      body += mark(`${row.label}: ${p.name} ${fmtInt(p.n)} z ${fmtInt(total)} (${pct} %)`,
        `<path d="${d}" fill="${p.colour}"/>`);
      if (pw > 44) {
        body += `<text x="${r1(cx + 8)}" y="${top + 22}" fill="${p.ink || T.text}" `
          + `font-size="13" font-weight="600" pointer-events="none">${fmtInt(p.n)}</text>`;
      }
      cx += pw;
    });
  });
  let lx = 140;
  const ly = H - 26;
  for (const l of legend) {
    body += `<rect x="${lx}" y="${ly - 10}" width="12" height="12" rx="3" fill="${l.colour}"/>`
      + `<text x="${lx + 18}" y="${ly}" fill="${T.text2}" font-size="12">${esc(l.name)}</text>`;
    lx += 30 + l.name.length * 7;
  }
  return body;
}

function planChart(facts) {
  const title = 'Plán: milníky a úkoly';
  const sub = 'Plan progress: milestones by derived status, and their issues done';
  const ms = facts.plan?.items || [];
  if (!ms.length) return empty('plan', title, sub);
  const by = (s) => ms.filter((m) => m.status === s).length;
  const done = ms.reduce((s, m) => s + m.done, 0);
  const total = ms.reduce((s, m) => s + m.total, 0);
  const DONE = { colour: T.blue, name: 'hotovo' };
  const ACTIVE = { colour: T.second, name: 'rozpracováno' };
  const OPEN = { colour: T.rest, name: 'otevřeno', ink: T.text2 };
  const body = stackedRows([
    { label: 'Milníky', parts: [{ ...DONE, n: by('DONE') }, { ...ACTIVE, n: by('ACTIVE') },
      { ...OPEN, n: ms.length - by('DONE') - by('ACTIVE') }] },
    { label: 'Úkoly', parts: [{ ...DONE, n: done }, { ...OPEN, name: 'zbývá', n: total - done }] },
  ], [DONE, ACTIVE, { ...OPEN, name: 'otevřeno / zbývá' }]);
  return frame('plan', title, sub, `${fmtInt(by('DONE'))} z ${fmtInt(ms.length)} milníků `
    + `hotovo, ${fmtInt(by('ACTIVE'))} rozpracováno; ${fmtInt(done)} z ${fmtInt(total)} úkolů `
    + 'hotovo.', body);
}

const CLAIM_NAMES = Object.freeze({ guaranteed: 'zaručeno', planned: 'plánováno' });

function claimsChart(facts) {
  const title = 'Tvrzení podle stavu';
  const sub = 'Claims by status (docs/CLAIMS.yaml): each names its source, code and test';
  const by = facts.claims?.byStatus || {};
  const keys = Object.keys(by);
  if (!keys.length) return empty('claims', title, sub);
  const order = ['guaranteed', 'planned', ...keys.filter((k) => !CLAIM_NAMES[k]).sort()]
    .filter((k) => k in by);
  const total = order.reduce((s, k) => s + by[k], 0);
  const max = Math.max(...order.map((k) => by[k]));
  const x0 = 140;
  const h = Math.min(34, (PLOT.y1 - PLOT.y0) / order.length - 12);
  let body = '';
  order.forEach((k, i) => {
    const top = PLOT.y0 + 6 + i * (h + 22);
    const w = Math.max(((PLOT.x1 - 60 - x0) * by[k]) / max, 2);
    const name = CLAIM_NAMES[k] || k;
    body += `<text x="24" y="${r1(top + h / 2 + 5)}" fill="${T.text2}" font-size="13">`
      + `${esc(name)}</text>`
      + mark(`${name}: ${fmtInt(by[k])} z ${fmtInt(total)} tvrzení`,
        `<path d="${barRight(x0, top, w, h)}" fill="${i === 0 ? T.blue : T.second}"/>`)
      + `<text x="${r1(x0 + w + 8)}" y="${r1(top + h / 2 + 5)}" fill="${T.text}" font-size="13" `
      + `font-weight="600">${fmtInt(by[k])}</text>`;
  });
  return frame('claims', title, sub, order.map((k) => `${CLAIM_NAMES[k] || k} ${by[k]}`)
    .join(', ') + ` z ${fmtInt(total)} tvrzení.`, body);
}

function activityChart(facts) {
  const title = 'Aktivita: commity za týden';
  const weeksN = facts.git?.weeks?.length || 0;
  const sub = `Commits per ISO week, the ${weeksN} weeks ending at the generated commit`;
  const weeks = facts.git?.weeks || [];
  if (!weeks.length) return empty('activity', title, sub);
  const maxC = Math.max(1, ...weeks.map((w) => w.commits));
  const step = niceStep(maxC);
  const max = Math.ceil(maxC / step) * step;
  const slot = (PLOT.x1 - PLOT.x0) / weeks.length;
  const w = Math.max(2, Math.min(18, slot - 2));
  const y = (c) => PLOT.y1 - (c / max) * (PLOT.y1 - PLOT.y0);
  let body = yAxis(max, step, fmtInt);
  weeks.forEach((wk, i) => {
    const bx = PLOT.x0 + i * slot + (slot - w) / 2;
    body += mark(`týden od ${fmtDate(`${wk.start}T00:00:00Z`)} (${wk.week}): `
      + `${fmtInt(wk.commits)} commitů`,
    `<rect x="${r1(PLOT.x0 + i * slot)}" y="${PLOT.y0}" width="${r1(slot)}" `
      + `height="${PLOT.y1 - PLOT.y0}" fill="transparent"/>`
      + `<path d="${barUp(bx, w, y(wk.commits), PLOT.y1)}" fill="${T.blue}"/>`);
    if (i % 4 === 0) body += xLabel(bx + w / 2, fmtDate(`${wk.start}T00:00:00Z`, false));
  });
  const total = weeks.reduce((s, wk) => s + wk.commits, 0);
  const peak = weeks.reduce((a, b) => (b.commits > a.commits ? b : a));
  const pi = weeks.indexOf(peak);
  body += `<text x="${r1(PLOT.x0 + pi * slot + slot / 2)}" y="${r1(y(peak.commits) - 8)}" `
    + `fill="${T.text}" font-size="12" font-weight="600" text-anchor="middle">`
    + `${fmtInt(peak.commits)}</text>`;
  return frame('activity', title, sub, `${fmtInt(total)} commitů za ${weeks.length} týdnů; `
    + `nejvíce ${fmtInt(peak.commits)} v týdnu od ${fmtDate(`${peak.start}T00:00:00Z`)}.`, body);
}

// ------------------------------------------------------------------------------- modules
export const KB = 1000;

function modulesChart(facts) {
  const title = 'Kód podle modulů';
  const sub = 'Source size per src/js module at the generated commit (kB, git ls-tree)';
  const ms = facts.codeInventory?.modules || [];
  if (!ms.length) return empty('modules', title, sub);
  const x0 = 140;
  const x1 = PLOT.x1 - 80;
  const row = 22;
  const h = 16;
  const top0 = PLOT.y0 - 14;
  const height = top0 + ms.length * row + 24;
  const max = ms[0].bytes || 1;
  const total = ms.reduce((n, m) => n + m.bytes, 0);
  let body = '';
  ms.forEach((m, i) => {
    const top = top0 + i * row;
    const w = Math.max(((x1 - x0) * m.bytes) / max, 2);
    const kb = m.bytes / KB;
    const share = Math.round((1000 * m.bytes) / total) / 10;
    body += `<text x="24" y="${r1(top + h / 2 + 4)}" fill="${T.text2}" font-size="12">`
      + `${esc(m.module)}</text>`
      + mark(`${m.module}: ${fmtInt(kb)} kB v ${fmtInt(m.files)} souborech (${fmtDec(share, 1)} %)`,
        `<rect x="${x0}" y="${r1(top - (row - h) / 2)}" width="${r1(x1 - x0 + 60)}" `
        + `height="${row}" fill="transparent"/>`
        + `<path d="${barRight(x0, top, w, h)}" fill="${T.blue}"/>`)
      + `<text x="${r1(x0 + w + 8)}" y="${r1(top + h / 2 + 4)}" fill="${T.text}" `
      + `font-size="12" font-weight="600" pointer-events="none">${fmtInt(kb)} kB</text>`;
  });
  return frame('modules', title, sub, `${fmtInt(ms.length)} modulů src/js, celkem `
    + `${fmtInt(total / KB)} kB; největší ${ms[0].module} (${fmtInt(max / KB)} kB).`, body, height);
}

// ------------------------------------------------------------------------------- growth
function growthChart(facts) {
  const title = 'Testy podle vydání';
  const sub = 'Unit test files and browser suites in the tree of each release tag (git ls-tree)';
  const rs = facts.codeInventory?.perRelease || [];
  if (!rs.length) return empty('growth', title, sub);
  const series = [
    { key: 'unit', name: 'unit testy', colour: T.blue },
    { key: 'browser', name: 'prohlížečové sady', colour: T.second },
  ];
  const maxN = Math.max(1, ...rs.flatMap((r) => series.map((s) => r[s.key])));
  const step = niceStep(maxN);
  const max = Math.ceil(maxN / step) * step;
  const x1 = PLOT.x1 - 140;
  const x = (i) => PLOT.x0 + (rs.length < 2 ? (x1 - PLOT.x0) / 2
    : (i / (rs.length - 1)) * (x1 - PLOT.x0));
  const y = (n) => PLOT.y1 - (n / max) * (PLOT.y1 - PLOT.y0);
  let body = yAxis(max, step, fmtInt).replace(new RegExp(`x2="${PLOT.x1}"`, 'g'), `x2="${x1}"`);
  const every = Math.max(1, Math.ceil(rs.length / 6));
  rs.forEach((r, i) => {
    if (i % every === 0 && rs.length - 1 - i >= every / 2) body += xLabel(x(i), `v${r.version}`);
  });
  body += xLabel(x(rs.length - 1), `v${rs[rs.length - 1].version}`, 'middle');
  for (const s of series) {
    const d = rs.map((r, i) => `${i ? 'L' : 'M'}${r1(x(i))},${r1(y(r[s.key]))}`).join('');
    body += `<path d="${d}" fill="none" stroke="${s.colour}" stroke-width="2" `
      + 'stroke-linejoin="round" stroke-linecap="round"/>';
  }
  // one hover target per release: a column holding both values
  const slot = rs.length > 1 ? (x1 - PLOT.x0) / (rs.length - 1) : x1 - PLOT.x0;
  rs.forEach((r, i) => {
    const cx = r1(x(i));
    body += mark(`v${r.version}: ${fmtInt(r.unit)} unit testů, ${fmtInt(r.browser)} `
      + 'prohlížečových sad',
    `<rect x="${r1(x(i) - slot / 2)}" y="${PLOT.y0}" width="${r1(slot)}" `
      + `height="${PLOT.y1 - PLOT.y0}" fill="transparent"/>`
      + series.map((s) => `<circle cx="${cx}" cy="${r1(y(r[s.key]))}" r="4" fill="${s.colour}" `
        + `stroke="${T.ground}" stroke-width="2" class="dot"/>`).join(''));
  });
  const last = rs[rs.length - 1];
  const ends = series.map((s) => ({ s, y: y(last[s.key]) }));
  if (Math.abs(ends[0].y - ends[1].y) < 16) ends[1].y = ends[0].y + 16;
  for (const { s, y: ly } of ends) {
    body += `<text x="${r1(x(rs.length - 1) + 10)}" y="${r1(ly + 4)}" fill="${T.text}" `
      + `font-size="12" font-weight="600">${fmtInt(last[s.key])} ${esc(s.name)}</text>`;
  }
  const height = H + 14;
  let lx = PLOT.x0;
  const ly = height - 18;
  for (const s of series) {
    body += `<rect x="${lx}" y="${ly - 6}" width="16" height="3" rx="1.5" fill="${s.colour}"/>`
      + `<text x="${lx + 22}" y="${ly}" fill="${T.text2}" font-size="12">${esc(s.name)}</text>`;
    lx += 40 + s.name.length * 7;
  }
  return frame('growth', title, sub, `Od v${rs[0].version} po v${last.version}: unit testy `
    + `${fmtInt(rs[0].unit)} až ${fmtInt(last.unit)}, prohlížečové sady ${fmtInt(rs[0].browser)} `
    + `až ${fmtInt(last.browser)} souborů.`, body, height);
}

// ------------------------------------------------------------------------------- P016 trends
const dayIso = (day) => `${day}T00:00:00Z`;

/** A legend of line or swatch keys at the bottom of a chart of height `h`. */
function legendRow(items, h, x0 = PLOT.x0, line = false) {
  let lx = x0;
  const ly = h - 18;
  let out = '';
  for (const s of items) {
    out += (line
      ? `<rect x="${lx}" y="${ly - 6}" width="16" height="3" rx="1.5" fill="${s.colour}"/>`
      : `<rect x="${lx}" y="${ly - 10}" width="12" height="12" rx="3" fill="${s.colour}"/>`)
      + `<text x="${lx + (line ? 22 : 18)}" y="${ly}" fill="${T.text2}" font-size="12">`
      + `${esc(s.name)}</text>`;
    lx += (line ? 40 : 34) + s.name.length * 7;
  }
  return out;
}

// A segment of a stacked column from `base` up to `top`: the top one carries the 4 px rounded
// data end; the others stop 1 px short, and the next starts 1 px higher (a 2 px ground gap).
function stackSegment(x, w, top, base, colour, last) {
  return last ? `<path d="${barUp(x, w, top, base)}" fill="${colour}"/>`
    : `<path d="M${r1(x)},${r1(base)}V${r1(Math.min(base, top + 1))}H${r1(x + w)}V${r1(base)}Z" `
      + `fill="${colour}"/>`;
}

/** Two end labels at y values kept at least 16 px apart. */
function endLabels(x, ends) {
  const ys = ends.map((e) => e.y);
  if (ys.length === 2 && Math.abs(ys[0] - ys[1]) < 16) {
    if (ys[0] <= ys[1]) ys[1] = ys[0] + 16; else ys[0] = ys[1] + 16;
  }
  return ends.map((e, i) => `<text x="${r1(x)}" y="${r1(ys[i] + 4)}" fill="${T.text}" `
    + `font-size="12" font-weight="600">${esc(e.text)}</text>`).join('');
}

function burnupChart(facts) {
  const title = 'Plán: úkoly přibývají a odcházejí hotové';
  const sub = 'Plan burn-up per UTC day: issues in the plan (created_at, cancelled excluded) and '
    + 'done (completed_at)';
  const b = facts.planBurnup;
  const days = b?.days || [];
  if (!days.length) return empty('burnup', title, sub);
  const height = H + 14;
  const x1 = PLOT.x1 - 130;
  const t0 = Date.parse(dayIso(days[0].day));
  const t1 = Date.parse(dayIso(days[days.length - 1].day));
  const span = Math.max(t1 - t0, 86400000);
  const x = (day) => PLOT.x0 + ((Date.parse(dayIso(day)) - t0) / span) * (x1 - PLOT.x0);
  const maxN = Math.max(1, ...days.map((d) => d.scopeTotal), ...days.map((d) => d.doneTotal));
  const step = niceStep(maxN);
  const max = Math.ceil(maxN / step) * step;
  const y = (n) => PLOT.y1 - (n / max) * (PLOT.y1 - PLOT.y0);
  let body = yAxis(max, step, fmtInt).replace(new RegExp(`x2="${PLOT.x1}"`, 'g'), `x2="${x1}"`);
  for (const t of dateTicks(t0, t1)) {
    const iso = new Date(t).toISOString();
    body += xLabel(PLOT.x0 + ((t - t0) / span) * (x1 - PLOT.x0), fmtDate(iso, false));
  }
  const series = [
    { key: 'scopeTotal', name: 'v plánu (bez zrušených)', colour: T.second },
    { key: 'doneTotal', name: 'hotovo', colour: T.blue },
  ];
  for (const s of series) {
    const d = days.map((r, i) => `${i ? 'L' : 'M'}${r1(x(r.day))},${r1(y(r[s.key]))}`).join('');
    body += `<path d="${d}" fill="none" stroke="${s.colour}" stroke-width="2" `
      + 'stroke-linejoin="round" stroke-linecap="round"/>';
  }
  const slot = days.length > 1 ? (x1 - PLOT.x0) / (days.length - 1) : x1 - PLOT.x0;
  for (const r of days) {
    const cx = r1(x(r.day));
    const cancelled = r.cancelled ? ` (z nich ${fmtInt(r.cancelled)} zrušeno)` : '';
    body += mark(`${fmtDate(dayIso(r.day))}: +${fmtInt(r.created)} založeno${cancelled}, `
      + `+${fmtInt(r.done)} hotovo; v plánu ${fmtInt(r.scopeTotal)}, hotovo ${fmtInt(r.doneTotal)}`,
    `<rect x="${r1(cx - slot / 2)}" y="${PLOT.y0}" width="${r1(slot)}" `
      + `height="${PLOT.y1 - PLOT.y0}" fill="transparent"/>`);
  }
  const last = days[days.length - 1];
  for (const s of series) {
    body += `<circle cx="${r1(x(last.day))}" cy="${r1(y(last[s.key]))}" r="4" fill="${s.colour}" `
      + `stroke="${T.ground}" stroke-width="2"/>`;
  }
  body += endLabels(x(last.day) + 10, series.map((s) => ({ y: y(last[s.key]),
    text: `${fmtInt(last[s.key])} ${s.name === 'hotovo' ? 'hotovo' : 'v plánu'}` })));
  body += legendRow(series, height, PLOT.x0, true);
  return frame('burnup', title, sub, `Od ${fmtDate(dayIso(days[0].day))} do `
    + `${fmtDate(dayIso(last.day))}: ${fmtInt(b.totals.created)} založených úkolů, z nich `
    + `${fmtInt(b.totals.cancelled)} zrušených, ${fmtInt(b.totals.done)} hotových.`, body, height);
}

const CLAIM_SERIES = Object.freeze([
  { key: 'guaranteed', name: 'zaručeno', colour: T.blue },
  { key: 'planned', name: 'plánováno', colour: T.second },
]);

function claimsTrendChart(facts) {
  const title = 'Tvrzení v každém vydání';
  const sub = 'Claims by status at every release tag (git show <tag>:docs/CLAIMS.yaml)';
  const items = facts.claimsPerRelease?.items || [];
  if (!items.some((x) => x.present)) return empty('claims-trend', title, sub);
  const height = H + 14;
  const x1 = PLOT.x1 - 120;
  const keys = [...CLAIM_SERIES, ...(facts.claimsPerRelease.statuses || [])
    .filter((k) => !CLAIM_SERIES.some((s) => s.key === k))
    .map((k) => ({ key: k, name: k, colour: T.rest }))];
  const maxN = Math.max(1, ...items.map((x) => x.total ?? 0));
  const step = niceStep(maxN);
  const max = Math.ceil(maxN / step) * step;
  const slot = (x1 - PLOT.x0) / items.length;
  const w = Math.max(2, Math.min(18, slot - 2));
  const y = (n) => PLOT.y1 - (n / max) * (PLOT.y1 - PLOT.y0);
  let body = yAxis(max, step, fmtInt).replace(new RegExp(`x2="${PLOT.x1}"`, 'g'), `x2="${x1}"`);
  const every = Math.max(1, Math.ceil(items.length / 6));
  items.forEach((r, i) => {
    const bx = PLOT.x0 + i * slot + (slot - w) / 2;
    const hit = `<rect x="${r1(PLOT.x0 + i * slot)}" y="${PLOT.y0}" width="${r1(slot)}" `
      + `height="${PLOT.y1 - PLOT.y0}" fill="transparent"/>`;
    if (!r.present) {
      body += mark(`v${r.version}: docs/CLAIMS.yaml ve stromu vydání není`, `${hit}<path d="M${
        r1(bx)},${PLOT.y1 - 1}h${r1(w)}" stroke="${T.dim}" stroke-width="2"/>`);
    } else {
      const parts = keys.filter((k) => (r.byStatus[k.key] ?? 0) > 0);
      let base = PLOT.y1;
      let segs = '';
      parts.forEach((k, pi) => {
        const top = base - (r.byStatus[k.key] / max) * (PLOT.y1 - PLOT.y0);
        segs += stackSegment(bx, w, top, base, k.colour, pi === parts.length - 1);
        base = top - 1;
      });
      body += mark(`v${r.version}: ${keys.map((k) => `${k.name} ${fmtInt(r.byStatus[k.key] ?? 0)}`)
        .join(', ')} z ${fmtInt(r.total)} tvrzení`, hit + segs);
    }
    if (i % every === 0 && items.length - 1 - i >= every / 2) {
      body += xLabel(bx + w / 2, `v${r.version}`);
    }
  });
  const li = items.length - 1;
  const last = items[li];
  body += xLabel(PLOT.x0 + li * slot + slot / 2, `v${last.version}`);
  if (last.present) {
    const gx = PLOT.x0 + li * slot + slot / 2 + 10;
    let below = 0;
    const ends = keys.filter((k) => (last.byStatus[k.key] ?? 0) > 0).map((k) => {
      const n = last.byStatus[k.key];
      const mid = below + n / 2;
      below += n;
      return { y: y(mid), text: `${fmtInt(n)} ${k.name}` };
    }).reverse();
    body += endLabels(gx, ends);
  }
  const absent = items.filter((x) => !x.present).length;
  const shown = keys.filter((k) => items.some((x) => x.present && (x.byStatus[k.key] ?? 0) > 0));
  body += legendRow(shown, height);
  return frame('claims-trend', title, sub, `${fmtInt(items.length)} vydání; `
    + `${absent ? `${fmtInt(absent)} bez souboru docs/CLAIMS.yaml; ` : ''}v v${last.version} `
    + `${last.present ? `${fmtInt(last.total)} tvrzení` : 'soubor chybí'}.`, body, height);
}

const MAX_RATCHET_COLS = 2;

/** A ratchet's value as text: bytes in kB, counts as they are. */
export function ratchetValue(item, value) {
  if (value === null || value === undefined) return '–';
  return item.unit === 'bytes' ? `${fmtInt(value / KB)} kB` : fmtInt(value);
}

/** The runs of equal (value, series) of a ratchet over its points: [{ from, to, value }]. */
export function ratchetRuns(points) {
  const runs = [];
  points.forEach((p, i) => {
    if (!p.present) return;
    const prev = runs[runs.length - 1];
    if (prev && prev.to === i - 1 && prev.value === p.value && prev.series === p.series) {
      prev.to = i;
    } else runs.push({ from: i, to: i, value: p.value, series: p.series });
  });
  return runs;
}

/**
 * A ratchet's small multiple for its card on the landing: the step line of its totals at every
 * release tag and HEAD on its own axis from zero, decorative (the card prints the numbers).
 */
export function ratchetSpark(item, w = 240, h = 44) {
  const pts = [...item.perRelease, item.head];
  const max = Math.max(1, ...pts.filter((p) => p.present).map((p) => p.value));
  const x = (i) => 2 + (pts.length < 2 ? 0 : (i / (pts.length - 1)) * (w - 4));
  const y = (v) => h - 3 - (v / max) * (h - 8);
  let d = '';
  const runs = ratchetRuns(pts);
  runs.forEach((run, ri) => {
    const prev = runs[ri - 1];
    const joined = prev && prev.to === run.from - 1 && prev.series === run.series;
    d += `${joined ? `H${r1(x(run.from))}V` : `M${r1(x(run.from))},`}${r1(y(run.value))}`
      + `H${r1(x(run.to))}`;
  });
  const last = runs[runs.length - 1];
  return `<svg aria-hidden="true" focusable="false" viewBox="0 0 ${w} ${h}" class="h-11 w-full" `
    + 'preserveAspectRatio="none"><path d="M2,' + `${h - 2}H${w - 2}" stroke="currentColor" `
    + 'stroke-opacity="0.25" vector-effect="non-scaling-stroke"/>'
    + `<path d="${d}" fill="none" stroke="#007afd" stroke-width="2" stroke-linejoin="round" `
    + 'stroke-linecap="round" vector-effect="non-scaling-stroke"/>'
    // the newest value as a dot: a zero-length round-capped stroke stays round when stretched
    + (last ? `<path d="M${r1(x(last.to))},${r1(y(last.value))}h0" stroke="#007afd" `
      + 'stroke-width="7" stroke-linecap="round" vector-effect="non-scaling-stroke"/>' : '')
    + '</svg>';
}

function ratchetsChart(facts, copy) {
  const title = 'Ratchety: dluh podle vydání';
  const sub = 'Every *-baseline.json at each release tag and HEAD; each panel on its own axis '
    + 'from zero';
  const items = facts.ratchets?.items || [];
  if (!items.length) return empty('ratchets', title, sub);
  const cols = MAX_RATCHET_COLS;
  const rows = Math.ceil(items.length / cols);
  const gx = 24;
  const cw = (W - 2 * gx - (cols - 1) * 24) / cols;
  const ch = 78;
  const top0 = 84;
  const height = top0 + rows * ch + 30;
  const labels = items[0].perRelease.map((p) => `v${p.version}`).concat('nyní');
  let body = '';
  items.forEach((it, idx) => {
    const c = copy[it.file] || { name: it.file };
    const cx0 = gx + (idx % cols) * (cw + 24);
    const cy0 = top0 + Math.floor(idx / cols) * ch;
    const pts = [...it.perRelease, it.head];
    const vals = pts.filter((p) => p.present).map((p) => p.value);
    const max = Math.max(1, ...vals);
    const px0 = cx0;
    const px1 = cx0 + cw - 70;
    const py0 = cy0 + 24;
    const py1 = cy0 + ch - 14;
    const x = (i) => px0 + (pts.length < 2 ? 0 : (i / (pts.length - 1)) * (px1 - px0));
    const y = (v) => py1 - (v / max) * (py1 - py0);
    body += `<text x="${r1(cx0)}" y="${r1(cy0 + 12)}" fill="${T.text2}" font-size="12">`
      + `${esc(c.name)}</text>`
      + `<line x1="${r1(px0)}" x2="${r1(px1)}" y1="${r1(py1)}" y2="${r1(py1)}" stroke="${T.grid}" `
      + 'stroke-opacity="0.35"/>';
    const runs = ratchetRuns(pts);
    let d = '';
    runs.forEach((run, ri) => {
      // a step after: the previous value holds up to this run's first tag
      const prev = runs[ri - 1];
      const joined = prev && prev.to === run.from - 1 && prev.series === run.series;
      d += `${joined ? `H${r1(x(run.from))}V` : `M${r1(x(run.from))},`}${r1(y(run.value))}`
        + `H${r1(x(run.to))}`;
    });
    body += `<path d="${d}" fill="none" stroke="${T.blue}" stroke-width="2" `
      + 'stroke-linejoin="round" stroke-linecap="round"/>';
    const slot = pts.length > 1 ? (px1 - px0) / (pts.length - 1) : px1 - px0;
    for (const run of runs) {
      const span = run.from === run.to ? labels[run.from]
        : `${labels[run.from]} až ${labels[run.to]}`;
      const series = run.series ? ` (${run.series})` : '';
      body += mark(`${c.name}: ${ratchetValue(it, run.value)}${series} · ${span}`,
        `<rect x="${r1(x(run.from) - slot / 2)}" y="${r1(py0 - 4)}" width="${
        r1(Math.max(slot, x(run.to) - x(run.from) + slot))}" height="${r1(py1 - py0 + 8)}" `
        + 'fill="transparent"/>');
    }
    const first = runs[0];
    if (first) {
      body += `<circle cx="${r1(x(first.from))}" cy="${r1(y(first.value))}" r="3" fill="${T.blue}" `
        + `stroke="${T.ground}" stroke-width="2"/>`;
    }
    const lastRun = runs[runs.length - 1];
    if (lastRun) {
      body += `<circle cx="${r1(x(lastRun.to))}" cy="${r1(y(lastRun.value))}" r="3" `
        + `fill="${T.blue}" stroke="${T.ground}" stroke-width="2"/>`
        + `<text x="${r1(px1 + 8)}" y="${r1(Math.min(py1, y(lastRun.value)) + 4)}" `
        + `fill="${T.text}" font-size="12" font-weight="600">`
        + `${esc(ratchetValue(it, lastRun.value))}</text>`;
    }
    if (first) {
      // where the file begins: left of the line's start, or under it when the start is near
      const fx = x(first.from);
      const left = fx - px0 > 80;
      body += `<text x="${r1(left ? fx - 8 : fx)}" y="${r1(left ? y(first.value) + 4 : py1 + 11)}" `
        + `fill="${T.dim}" font-size="11"${left ? ' text-anchor="end"' : ''}>od `
        + `${esc(labels[first.from])}</text>`;
    }
  });
  const firstTag = items[0].perRelease[0];
  body += `<text x="${gx}" y="${height - 14}" fill="${T.dim}" font-size="11">Osa x: vydání `
    + `v${esc(firstTag?.version ?? '')} až nyní, stejná pro všechny panely.</text>`;
  return frame('ratchets', title, sub, items.map((it) => `${(copy[it.file] || {}).name || it.file} `
    + `${ratchetValue(it, it.head.value)}`).join('; ') + '.', body, height);
}

/** The ordinal ramp of review severities on the chart ground (validated, --ordinal, dark). */
export const SEVERITY_RAMP = Object.freeze({ P0: '#b8d4f0', P1: '#4da3ff', P2: '#007afd',
  P3: '#00468c' });

function reviewsChart(facts) {
  const title = 'Revize: nálezy podle závažnosti';
  const sub = 'Review findings per ISO week of the review record\'s first commit, by severity';
  const r = facts.reviews;
  const weeks = r?.weeks || [];
  if (!weeks.length) return empty('reviews', title, sub);
  const height = H + 14;
  const sev = r.severities.map((k) => ({ key: k, name: k === 'P0' || k === 'P1' ? `${k} blokuje`
    : k, colour: SEVERITY_RAMP[k] ?? T.rest }));
  const maxN = Math.max(1, ...weeks.map((w) => w.findings));
  const step = niceStep(maxN);
  const max = Math.ceil(maxN / step) * step;
  const slot = (PLOT.x1 - PLOT.x0) / weeks.length;
  const w = Math.max(4, Math.min(48, slot - 8));
  const y = (n) => PLOT.y1 - (n / max) * (PLOT.y1 - PLOT.y0);
  let body = yAxis(max, step, fmtInt);
  weeks.forEach((wk, i) => {
    const bx = PLOT.x0 + i * slot + (slot - w) / 2;
    const parts = sev.filter((s) => wk.bySeverity[s.key] > 0);
    let base = PLOT.y1;
    let segs = '';
    parts.forEach((s, pi) => {
      const top = base - (wk.bySeverity[s.key] / max) * (PLOT.y1 - PLOT.y0);
      segs += stackSegment(bx, w, top, base, s.colour, pi === parts.length - 1);
      base = top - 1;
    });
    const counts = sev.map((s) => `${s.key} ${fmtInt(wk.bySeverity[s.key])}`).join(', ');
    body += mark(`týden od ${fmtDate(dayIso(wk.start))} (${wk.week}): `
      + `${fmtInt(wk.findings)} nálezů v ${fmtInt(wk.reviews)} revizích; ${counts}`,
      `<rect x="${r1(PLOT.x0 + i * slot)}" y="${PLOT.y0}" width="${r1(slot)}" `
      + `height="${PLOT.y1 - PLOT.y0}" fill="transparent"/>${segs}`);
    body += xLabel(bx + w / 2, fmtDate(dayIso(wk.start), false));
    if (wk.findings) {
      body += `<text x="${r1(bx + w / 2)}" y="${r1(y(wk.findings) - 6)}" fill="${T.text}" `
        + `font-size="12" font-weight="600" text-anchor="middle" pointer-events="none">`
        + `${fmtInt(wk.findings)}</text>`;
    }
  });
  body += legendRow(sev, height);
  return frame('reviews', title, sub, `${fmtInt(r.totals.findings)} nálezů v `
    + `${fmtInt(r.totals.reviews)} revizích za ${fmtInt(weeks.length)} týdnů: ${sev.map((s) =>
      `${s.key} ${fmtInt(r.totals.bySeverity[s.key])}`).join(', ')}.`, body, height);
}

/** Hours as Czech text: '4,9 h', or days beside them from 48 h on. */
export function fmtHours(h) {
  const base = `${fmtDec(h, h < 10 ? 1 : 0)} h`;
  return h >= 48 ? `${base} (${fmtDec(h / 24, 1)} dne)` : base;
}

function cadenceChart(facts) {
  const title = 'Kadence vydání';
  const sub = 'Hours between consecutive published releases (release records); logarithmic axis';
  const c = facts.releaseCadence;
  const items = (c?.items || []).filter((x) => x.hours > 0);
  if (!items.length) return empty('cadence', title, sub);
  const lo = 10 ** Math.floor(Math.log10(Math.min(...items.map((x) => x.hours))));
  const hi = 10 ** Math.ceil(Math.log10(Math.max(...items.map((x) => x.hours))));
  const ly = (h) => PLOT.y1 - ((Math.log10(h) - Math.log10(lo)) / (Math.log10(hi)
    - Math.log10(lo))) * (PLOT.y1 - PLOT.y0);
  const x1 = PLOT.x1 - 64;
  let body = '';
  for (let v = lo; v <= hi * 1.0001; v *= 10) {
    const yy = r1(ly(v));
    body += `<line x1="${PLOT.x0}" x2="${x1}" y1="${yy}" y2="${yy}" stroke="${T.grid}" `
      + `stroke-opacity="${v === lo ? 0.35 : 0.14}"/><text x="${PLOT.x0 - 8}" y="${r1(yy + 4)}" `
      + `fill="${T.dim}" font-size="11" text-anchor="end">${esc(`${fmtDec(v, v < 1 ? 1 : 0)} h`)}`
      + '</text>';
  }
  const slot = (x1 - PLOT.x0) / items.length;
  const every = Math.max(1, Math.ceil(items.length / 6));
  if (c.median) {
    const my = r1(ly(c.median));
    body += `<line x1="${PLOT.x0}" x2="${x1}" y1="${my}" y2="${my}" stroke="${T.text2}" `
      + `stroke-opacity="0.7"/><text x="${x1 + 8}" y="${r1(my - 3)}" fill="${T.text}" `
      + 'font-size="12" font-weight="600">medián</text>'
      + `<text x="${x1 + 8}" y="${r1(my + 12)}" fill="${T.text}" font-size="12" `
      + `font-weight="600">${esc(fmtHours(c.median))}</text>`;
  }
  items.forEach((r, i) => {
    const cx = r1(PLOT.x0 + i * slot + slot / 2);
    const cy = r1(ly(r.hours));
    body += mark(`v${r.version} po v${r.from}: ${fmtHours(r.hours)}`,
      `<rect x="${r1(PLOT.x0 + i * slot)}" y="${PLOT.y0}" width="${r1(slot)}" `
      + `height="${PLOT.y1 - PLOT.y0}" fill="transparent"/>`
      + `<circle cx="${cx}" cy="${cy}" r="4" fill="${T.blue}" stroke="${T.ground}" `
      + 'stroke-width="2"/>');
    if (i % every === 0 && items.length - 1 - i >= every / 2) body += xLabel(cx, `v${r.version}`);
  });
  const li = items.length - 1;
  body += xLabel(PLOT.x0 + li * slot + slot / 2, `v${items[li].version}`);
  const longest = items.reduce((a, b) => (b.hours > a.hours ? b : a));
  const lx = PLOT.x0 + items.indexOf(longest) * slot + slot / 2;
  body += `<text x="${r1(lx - 8)}" y="${r1(ly(longest.hours) + 4)}" fill="${T.text2}" `
    + `font-size="12" text-anchor="end">${esc(fmtHours(longest.hours))}</text>`;
  return frame('cadence', title, sub, `${fmtInt(items.length)} intervalů mezi `
    + `${fmtInt(c.releases)} vydáními; medián ${fmtHours(c.median)}, nejdelší `
    + `${fmtHours(longest.hours)} (před v${longest.version}).`, body);
}

const RENDERERS = Object.freeze({
  releases: releasesChart, size: sizeChart, plan: planChart, claims: claimsChart,
  activity: activityChart, modules: modulesChart, growth: growthChart, burnup: burnupChart,
  'claims-trend': claimsTrendChart, ratchets: (f) => ratchetsChart(f, RATCHET_COPY),
  reviews: reviewsChart, cadence: cadenceChart,
});

/** Every chart of CHARTS, rendered: { <name>: svg }. Throws on a name without a renderer. */
export function renderCharts(facts) {
  const out = {};
  for (const name of CHARTS) {
    if (!RENDERERS[name]) throw new Error(`charts: no renderer for chart "${name}"`);
    out[name] = RENDERERS[name](facts);
  }
  return out;
}

/** The table view of a chart: the values it draws, as rows. */
export function chartTable(name, facts) {
  if (name === 'releases' || name === 'size') {
    const rs = datedReleases(facts);
    return { head: ['Verze', 'Vydáno', 'Velikost'], rows: rs.slice().reverse().map((r) => [
      `v${r.version}`, fmtDate(r.published_at),
      Number.isFinite(r.size) ? `${fmtDec(r.size / MB)} MB` : '–']) };
  }
  if (name === 'plan') {
    return { head: ['Milník', 'Stav', 'Hotovo'], rows: (facts.plan?.items || []).map((m) => [
      m.id, m.status, `${fmtInt(m.done)} / ${fmtInt(m.total)}`]) };
  }
  if (name === 'claims') {
    return { head: ['Stav', 'Počet'], rows: Object.entries(facts.claims?.byStatus || {})
      .map(([k, n]) => [CLAIM_NAMES[k] || k, fmtInt(n)]) };
  }
  if (name === 'activity') {
    return { head: ['Týden', 'Od', 'Commity'], rows: (facts.git?.weeks || []).slice().reverse()
      .map((w) => [w.week, fmtDate(`${w.start}T00:00:00Z`), fmtInt(w.commits)]) };
  }
  if (name === 'modules') {
    return { head: ['Modul', 'Souborů', 'Velikost'], rows: (facts.codeInventory?.modules || [])
      .map((m) => [m.module, fmtInt(m.files), `${fmtInt(m.bytes / KB)} kB`]) };
  }
  if (name === 'growth') {
    return { head: ['Vydání', 'Unit testy', 'Prohlížečové sady', 'Soubory src/js', 'dist'],
      rows: (facts.codeInventory?.perRelease || []).slice().reverse().map((r) => [
        `v${r.version}`, fmtInt(r.unit), fmtInt(r.browser), fmtInt(r.srcFiles),
        Number.isFinite(r.distBytes) ? `${fmtDec(r.distBytes / MB)} MB` : '–']) };
  }
  if (name === 'burnup') {
    return { head: ['Den', 'Založeno', 'Z toho zrušeno', 'Hotovo', 'V plánu celkem',
      'Hotovo celkem'], rows: (facts.planBurnup?.days || []).slice().reverse().map((d) => [
      fmtDate(dayIso(d.day)), fmtInt(d.created), fmtInt(d.cancelled), fmtInt(d.done),
      fmtInt(d.scopeTotal), fmtInt(d.doneTotal)]) };
  }
  if (name === 'claims-trend') {
    const st = facts.claimsPerRelease?.statuses || [];
    return { head: ['Vydání', ...st.map((k) => CLAIM_NAMES[k] || k), 'Celkem'],
      rows: (facts.claimsPerRelease?.items || []).slice().reverse().map((r) => [`v${r.version}`,
        ...st.map((k) => (r.present ? fmtInt(r.byStatus[k] ?? 0) : 'chybí')),
        r.present ? fmtInt(r.total) : 'soubor chybí']) };
  }
  if (name === 'ratchets') {
    const items = facts.ratchets?.items || [];
    const cell = (it, p) => (p.present ? `${ratchetValue(it, p.value)}${p.series ? ` (${
      p.series})` : ''}` : '–');
    const rows = [['nyní', ...items.map((it) => cell(it, it.head))]];
    const n = items[0]?.perRelease.length ?? 0;
    for (let i = n - 1; i >= 0; i -= 1) {
      rows.push([`v${items[0].perRelease[i].version}`, ...items.map((it) =>
        cell(it, it.perRelease[i]))]);
    }
    return { head: ['Vydání', ...items.map((it) => RATCHET_COPY[it.file]?.short ?? it.file)],
      rows };
  }
  if (name === 'reviews') {
    const sev = facts.reviews?.severities || [];
    return { head: ['Týden', 'Od', 'Revize', ...sev, 'Nálezy'], rows: (facts.reviews?.weeks
      || []).slice().reverse().map((w) => [w.week, fmtDate(dayIso(w.start)), fmtInt(w.reviews),
      ...sev.map((k) => fmtInt(w.bySeverity[k])), fmtInt(w.findings)]) };
  }
  if (name === 'cadence') {
    return { head: ['Vydání', 'Po vydání', 'Publikováno', 'Odstup'],
      rows: (facts.releaseCadence?.items || []).slice().reverse().map((r) => [`v${r.version}`,
        `v${r.from}`, fmtDate(r.published_at), fmtHours(r.hours)]) };
  }
  throw new Error(`charts: no table for chart "${name}"`);
}
