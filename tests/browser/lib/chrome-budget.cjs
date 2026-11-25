// The chrome budget of plan issue U131 (PR-0 of docs/reconstruction/09-u131-u135-design.md):
// how much of the viewport's height a place's own content gets, per engine x viewport x place x
// keys state, and the shrink-only ratchet that judges a run against the committed debt
// (tests/browser/chrome-budget-baseline.json).
//
//   const cb = require('./lib/chrome-budget.cjs');
//   const read = await page.evaluate(cb.visibleInPage, { selector: 'main' });
//   const budget = cb.budgetOf(vp, read.state);
//   const debt = cb.debtOf(budget, read);
//   const verdict = cb.judge(baseline, { 'chromium/1536x1024/synth/open': 12 });
//
// The measure (docs/reconstruction/07-target-architecture.md §5, the U131 acceptance):
//   desktop  content share = the height of <main>'s client box on the first screen that no
//            fixed chrome covers (main.clientHeight, less the band of the fixed keys
//            dock where <main> pads under it instead of making room: the Studio) / innerHeight;
//            at least 75 % at 1536 px wide and more with the keys collapsed, 70 % from 1024 px,
//            65 % from 768 px, and 55 % at every desktop width with them open;
//   phone    the visible height of the place's primary surface on the first screen (clipped to
//            <main>'s client box and the viewport, less what fixed chrome covers)
//            / innerHeight, at least 50 %, in the state the place opens in.
// A cell's debt is the px below its budget: max(0, ceil(pct x innerHeight / 100) - px). It is a
// debt that only falls: a cell whose debt rises, or a new cell over its budget, fails the run; a
// fall passes and is printed for an --update that lowers the baseline. A rise is written only by
// an --update that states its reason, which goes into the baseline's raises ledger.
//
// Everything here but visibleInPage is pure; tests/unit/chrome-budget.test.mjs holds it.
'use strict';

const { VIEWPORTS, viewportKey } = require('./geometry-census.cjs');

/** The px a debt may differ by on a host other than the recording one (its fonts): a phone
 *  title that wraps to a second line moves the header by 8 px. */
const TOLERANCE_PX = 16;

/** The keys' states a cell is measured in: the dock folded to its handle, or the keys shown. */
const STATES = Object.freeze(['collapsed', 'open']);

/** The desktop budgets with the keys collapsed: the share of innerHeight, by the least width. */
const DESKTOP_COLLAPSED = Object.freeze([
  Object.freeze({ minWidth: 1536, pct: 75 }),
  Object.freeze({ minWidth: 1024, pct: 70 }),
  Object.freeze({ minWidth: 768, pct: 65 }),
]);
/** The desktop budget with the keys open, at every desktop width. */
const DESKTOP_OPEN_PCT = 55;
/** The phone budget: the primary surface's visible share of the first screen. */
const PHONE_PCT = 50;

/**
 * The budget of a cell: { pct, measure } where measure is 'content' (<main>, desktop) or
 * 'primary' (the place's primary surface, phone); null for a viewport no budget covers.
 */
function budgetOf(vp, state) {
  if (!STATES.includes(state)) throw new TypeError(`chrome budget: unknown state ${state}`);
  if (vp.phone) return { pct: PHONE_PCT, measure: 'primary' };
  if (state === 'open') {
    return vp.width >= DESKTOP_COLLAPSED[DESKTOP_COLLAPSED.length - 1].minWidth
      ? { pct: DESKTOP_OPEN_PCT, measure: 'content' } : null;
  }
  const band = DESKTOP_COLLAPSED.find((b) => vp.width >= b.minWidth);
  return band ? { pct: band.pct, measure: 'content' } : null;
}

/** The px a measured height lies below its budget, 0 when it meets it. */
function debtOf({ pct }, { px, innerHeight }) {
  if (![pct, px, innerHeight].every(Number.isFinite) || innerHeight <= 0) {
    throw new TypeError(`chrome budget: no debt of ${JSON.stringify({ pct, px, innerHeight })}`);
  }
  return Math.max(0, Math.ceil((pct * innerHeight) / 100) - Math.round(px));
}

const cellKey = (engine, vp, place, state) => `${engine}/${typeof vp === 'string' ? vp
  : viewportKey(vp)}/${place}/${state}`;

/** The parts of a cell key; throws on a string that is not one. */
function parseKey(key) {
  const m = /^([a-z]+)\/(\d+x\d+)\/([a-z0-9-]+)\/([a-z]+)$/.exec(String(key));
  if (!m || !STATES.includes(m[4])) {
    throw new TypeError(`chrome budget: ${JSON.stringify(key)} is not a cell key`);
  }
  return { engine: m[1], viewport: m[2], place: m[3], state: m[4] };
}

const debtTable = (baseline) => (baseline && baseline.debt) || {};

/**
 * Judge measured debts ({ "<cell key>": px }) against the baseline. Only the engines the run
 * measured are judged. On the host the baseline was recorded on (baseline.host; `host`
 * defaults to it) a debt is compared exactly; on another host, whose fonts may wrap a title or a
 * status line differently, a cell rises or is new over budget only beyond baseline.tolerancePx
 * (TOLERANCE_PX by default), and falls only by more than it. Returns, each sorted by key:
 *   rises  a recorded cell whose debt is higher now: { key, from, to }
 *   news   a cell the baseline does not record that is over its budget: { key, from: 0, to }
 *   falls  a recorded cell whose debt is lower now: { key, from, to }
 *   gone   a recorded cell of a measured engine that the run did not measure: { key, from }
 *   added  a cell the baseline does not record that meets its budget: { key, from: 0, to: 0 }
 *   moved  on another host only: a cell measured in the other keys state than the one the
 *          baseline records for its engine, viewport and place, { key, was, from, to } (was the
 *          recorded key). Where the keys start docked depends on the room the place keeps
 *          (midi/routes.js roomFolds), which the host's fonts move; the recorded cell is then
 *          neither gone nor the measured one new, and neither is judged.
 * plus { host, against, tolerancePx } (tolerancePx 0 on the recording host). A run fails on
 * rises and news only.
 */
function judge(baseline, measured, { host } = {}) {
  const base = debtTable(baseline);
  const against = (baseline && baseline.host) || null;
  const here = host || against;
  const tol = !against || here === against ? 0
    : (baseline.tolerancePx ?? TOLERANCE_PX);
  const engines = new Set(Object.keys(measured).map((k) => parseKey(k).engine));
  const out = { rises: [], news: [], falls: [], gone: [], added: [], moved: [], host: here,
    against, tolerancePx: tol };
  const placeOf = (k) => k.slice(0, k.lastIndexOf('/'));
  const siblingOf = (key) => (tol ? Object.keys(base).find((k) => k !== key
    && placeOf(k) === placeOf(key) && !(k in measured)) : undefined);
  const movedFrom = new Set();
  for (const key of Object.keys(measured).sort()) {
    parseKey(key);
    const to = measured[key];
    if (!Number.isInteger(to) || to < 0) {
      throw new TypeError(`chrome budget: ${key} has no debt in px (${JSON.stringify(to)})`);
    }
    const was = key in base ? undefined : siblingOf(key);
    if (was) {
      out.moved.push({ key, was, from: base[was], to });
      movedFrom.add(was);
    } else if (!(key in base)) {
      out[to > tol ? 'news' : 'added'].push({ key, from: 0, to });
    } else if (to > base[key] + tol) out.rises.push({ key, from: base[key], to });
    else if (to < base[key] - tol) out.falls.push({ key, from: base[key], to });
  }
  for (const key of Object.keys(base).sort()) {
    if (engines.has(parseKey(key).engine) && !(key in measured) && !movedFrom.has(key)) {
      out.gone.push({ key, from: base[key] });
    }
  }
  return out;
}

const failed = (verdict) => verdict.rises.length + verdict.news.length > 0;

/** The least reason a raise may state. */
const REASON_MIN = 30;

/**
 * The baseline after an --update with measured debts: falls are written, gone cells removed,
 * cells added that meet their budget recorded at 0. A rise or a new cell over its budget is
 * written only with a `reason` of more than REASON_MIN characters, and each such write appends
 * { from, to, reason } to raises[key]; without one it is kept at its recorded value and returned
 * in `refused`. The first record (a baseline with no host) writes every measured cell: it is
 * the debt the ratchet starts from. Only the recording host updates (`host`, by default
 * process.platform; a first record takes it): another host's fonts would move the record.
 * Returns { next, verdict, refused, raised }; the input is not changed.
 */
function update(baseline, measured, { reason = '', note, host = process.platform } = {}) {
  const first = !(baseline && baseline.host);
  const against = first ? host : baseline.host;
  if (against !== host) {
    throw new Error(`chrome budget: the baseline is recorded on ${against}; --update on ${host} `
      + 'would write another host\'s fonts into it');
  }
  const verdict = judge(baseline, measured, { host });
  const debt = { ...debtTable(baseline) };
  const raises = JSON.parse(JSON.stringify((baseline && baseline.raises) || {}));
  const stated = typeof reason === 'string' && reason.trim().length > REASON_MIN;
  for (const { key, to } of [...verdict.falls, ...verdict.added]) debt[key] = to;
  for (const { key } of verdict.gone) delete debt[key];
  const up = [...verdict.rises, ...verdict.news];
  if (first) for (const { key, to } of up) debt[key] = to;
  const refused = stated || first ? [] : up;
  const raised = stated && !first ? up : [];
  for (const { key, from, to } of raised) {
    debt[key] = to;
    raises[key] = [...(raises[key] || []), { from, to, reason: reason.trim() }];
  }
  const next = { note: note || (baseline && baseline.note) || '', host: against,
    tolerancePx: (baseline && baseline.tolerancePx) ?? TOLERANCE_PX, debt: sortKeys(debt),
    raises: sortKeys(raises) };
  return { next, verdict, refused, raised };
}

const sortKeys = (o) => Object.fromEntries(Object.keys(o).sort().map((k) => [k, o[k]]));

/**
 * What the history of the baseline raises without declaring it. `versions` is every committed
 * version, oldest first, the working tree's last ({ sha, json }). Each version is judged against
 * the one before it (the first is the record the ratchet starts from): a cell whose debt is
 * higher than before (a cell not recorded before counts as 0) needs a raises entry for that
 * cell new in this version that names the new debt; raises entries are appended, never edited
 * or removed. Returns one line per problem.
 */
function undeclaredRises(versions) {
  const problems = [];
  for (let i = 1; i < versions.length; i += 1) {
    const { sha: was, json: before } = versions[i - 1];
    const { sha, json: now } = versions[i];
    const b = debtTable(before);
    const r0 = (before && before.raises) || {};
    const r1 = (now && now.raises) || {};
    for (const key of Object.keys(r0)) {
      const kept = (r1[key] || []).slice(0, r0[key].length);
      if (JSON.stringify(kept) !== JSON.stringify(r0[key])) {
        problems.push(`${key}: a raises entry of ${was} was edited or removed at ${sha}; `
          + 'entries are appended, never edited');
      }
    }
    for (const [key, to] of Object.entries(debtTable(now))) {
      const from = b[key] ?? 0;
      if (to <= from) continue;
      const fresh = (r1[key] || []).slice((r0[key] || []).length);
      const ok = fresh.some((e) => e && e.to === to && typeof e.reason === 'string'
        && e.reason.trim().length > REASON_MIN);
      if (!ok) {
        problems.push(`${key}: the debt rose ${from} -> ${to} px at ${sha} (from ${was}) with no `
          + `raises entry { from, to: ${to}, reason } of more than ${REASON_MIN} characters`);
      }
    }
  }
  return problems;
}

/** One readable line per entry of a verdict list. */
const formatCells = (list, verb) => list.map(({ key, from, to, was }) => {
  if (was) return `${key}: ${verb} (recorded as ${was}, ${from} px; now ${to} px), not judged`;
  return to === undefined ? `${key}: ${verb} (was ${from} px over budget)`
    : `${key}: ${verb} ${from} -> ${to} px over budget`;
});

// ------------------------------------------------------------------------------ page side
/**
 * The first screen's visible height of the first element of `selector` (or <main> when it
 * matches nothing shown), with the keys' state. Visible: the element's border box clipped to
 * <main>'s client box and to the viewport, less the union of the bands that rendered fixed
 * elements other than it and its ancestors cover over its width, wherever they sit in the DOM
 * (the keys dock is a fixed child of <main>; where <main> pads under it, the Studio, it
 * covers <main>'s own box). The
 * state is the handle's (data-osc="keyboard.handle", aria-expanded) where it shows, else
 * 'open' where the keys (#osc-keyboard) are drawn, else 'collapsed'. Runs in the page;
 * self-contained.
 * -> { px, innerHeight, state, foldable, target, mainClient }
 */
function visibleInPage({ selector }) {
  const main = document.querySelector('main');
  const shown = (el) => !!el && el.getClientRects().length > 0
    && getComputedStyle(el).visibility !== 'hidden';
  const found = [...document.querySelectorAll(selector)].find(shown);
  const el = found || main;
  const ih = window.innerHeight;
  const mr = main.getBoundingClientRect();
  const mTop = mr.top + main.clientTop;
  const r = el.getBoundingClientRect();
  const top = Math.max(r.top, mTop, 0);
  const bottom = Math.min(r.bottom, mTop + main.clientHeight, ih);
  const left = Math.max(r.left, mr.left);
  const right = Math.min(r.right, mr.right);
  const bands = [];
  if (bottom > top && right > left) {
    for (const f of document.querySelectorAll('body *')) {
      if (f.contains(el)) continue; // el itself and its ancestors
      if (getComputedStyle(f).position !== 'fixed' || !shown(f)) continue;
      const fr = f.getBoundingClientRect();
      if (fr.right <= left || fr.left >= right || fr.width < 1 || fr.height < 1) continue;
      const a = Math.max(fr.top, top);
      const b = Math.min(fr.bottom, bottom);
      if (b > a) bands.push([a, b]);
    }
  }
  bands.sort((x, y) => x[0] - y[0]);
  let covered = 0;
  let end = -Infinity;
  for (const [a, b] of bands) {
    if (a > end) { covered += b - a; end = b; } else if (b > end) { covered += b - end; end = b; }
  }
  const handle = document.querySelector('[data-osc="keyboard.handle"]');
  const keys = document.getElementById('osc-keyboard');
  const foldable = shown(handle);
  const state = foldable ? (handle.getAttribute('aria-expanded') === 'true' ? 'open' : 'collapsed')
    : (shown(keys) ? 'open' : 'collapsed');
  return { px: Math.round(Math.max(0, bottom - top - covered)), innerHeight: ih, state, foldable,
    target: found ? selector : 'main', mainClient: main.clientHeight };
}

module.exports = {
  TOLERANCE_PX, VIEWPORTS, STATES, DESKTOP_COLLAPSED, DESKTOP_OPEN_PCT, PHONE_PCT, REASON_MIN,
  viewportKey, budgetOf, debtOf, cellKey, parseKey, judge, failed, update, undeclaredRises,
  formatCells, visibleInPage,
};
