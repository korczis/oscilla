// Rule project.no-fake-science v3 (U114 b, oscilla-c3 under Q090, 2026-11-15): the calibration
// states stay English as data (level.js, the views' badges, saved reasons, exports), and the
// page shows each through calibration/display.js in Czech: NEKALIBROVÁNO, KALIBROVÁNO, the
// reason sentence starting "NEKALIBROVÁNO: …" and the preset's title. Nothing here is typed by
// hand where the source can give it: the reasons come from level.js, the binding words from
// its BINDING_KEYS, and the page's calibration sources are derived from the code that produces
// them, then every one of those bindings in src/index.html must read through the map. A
// mutation (one wrap dropped) proves the census bites.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  BINDING_WORDS_SHOWN, CALIBRATION_PHRASES, CALIBRATION_REASONS, CALIBRATION_WORDS,
  calibrationShown, differencesReasonShown,
} from '../../src/js/calibration/display.js';
import {
  BINDING_KEYS, BINDING_WORDS, LEVEL_FROM_MICROPHONE, LEVEL_FROM_TEST_CONTEXT,
  LEVEL_NOT_VALID_TEXT, LEVEL_OFFSET_APPLIED_TEXT, LEVEL_PENDING_INDICATOR, LEVEL_PENDING_TEXT,
  UNBOUND_REASON, createLevelCalibration, levelCalibrationApplies, levelLabel,
} from '../../src/js/calibration/level.js';
import { FREQUENCY_BADGES, QUANTITY_KINDS, UNAVAILABLE } from '../../src/js/measurement/views/common.js';
import { frequencyIndicator } from '../../src/js/measurement/views/calibration-indicator.js';
import {
  CHARACTERIZE_PLAYBACK_CHAIN, measureFlow,
} from '../../src/js/measurement/views/measure-flow.js';
import { createFrequencyProfile } from '../../src/js/calibration/profile.js';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const read = (rel) => readFileSync(`${ROOT}${rel}`, 'utf8');

/** A calibration state left in English on screen. */
const ENGLISH = /\b(?:UN)?CALIBRATED\b|PENDING INPUT CHECK|CHARACTERIZE PLAYBACK CHAIN/;
/** A Czech reason: it names the state first, so the state is never dropped or softened. */
const CZECH_REASON = /^(?:NEKALIBROVÁNO|ČEKÁ NA KONTROLU VSTUPU): \S/;

const INPUT = { deviceId: 'mic-a', sampleRate: 48000, echoCancellation: false,
  noiseSuppression: false, autoGainControl: false, channelCount: 1 };
const LEVEL = createLevelCalibration({ referenceHz: 1000, referenceDbSpl: 94, observedDbRelative: -20,
  createdAt: '2026-11-17T00:00:00Z', input: INPUT });

/** One input that differs from INPUT in `key` only. */
function differing(key) {
  const v = INPUT[key];
  return { ...INPUT, [key]: typeof v === 'boolean' ? !v : typeof v === 'number' ? v + 1 : 'b' };
}

/** Every reason level.js and the workspace can give, derived from their sources. */
function reasons() {
  const out = [LEVEL_FROM_TEST_CONTEXT, LEVEL_FROM_MICROPHONE, LEVEL_PENDING_TEXT];
  const unbound = { ...LEVEL, schemaVersion: 2 };
  delete unbound.input;
  const u = levelCalibrationApplies(unbound, INPUT);
  if (u.reason) out.push(u.reason);
  for (const k of BINDING_KEYS) out.push(levelCalibrationApplies(LEVEL, differing(k)));
  const all = { ...INPUT };
  for (const k of BINDING_KEYS) Object.assign(all, { [k]: differing(k)[k] });
  out.push(levelCalibrationApplies(LEVEL, all));
  return out;
}

test('level.js binds every input key, and every key has its Czech word', () => {
  assert.ok(BINDING_KEYS.length >= 6);
  assert.deepEqual(Object.keys(BINDING_WORDS_SHOWN).sort(), [...BINDING_KEYS].sort());
  assert.deepEqual(Object.keys(BINDING_WORDS).sort(), [...BINDING_KEYS].sort());
});

test('every reason is shown in Czech, starting with its state, built from its differences', () => {
  const all = reasons();
  assert.equal(all.length, 4 + BINDING_KEYS.length + 1);
  for (const r of all) {
    const text = typeof r === 'string' ? r : r.reason;
    const shown = typeof r === 'string' ? calibrationShown(text)
      : calibrationShown(text, r.differences);
    assert.match(shown, CZECH_REASON, text);
    assert.doesNotMatch(shown, ENGLISH, shown);
    assert.doesNotMatch(shown, /\b(?:at calibration|now|not reported|input device)\b/, shown);
    if (typeof r !== 'string') {
      assert.ok(r.differences.length > 0);
      assert.equal(shown, differencesReasonShown(r.differences));
      // A stored reason has no differences beside it: read back from its text, the same.
      assert.equal(calibrationShown(text), shown, text);
    }
  }
  assert.equal(calibrationShown(UNBOUND_REASON), CALIBRATION_REASONS[UNBOUND_REASON]);
});

test('the reason is built from the structure, not from the English string', () => {
  const a = levelCalibrationApplies(LEVEL, differing('sampleRate'));
  const shown = calibrationShown(a.reason, a.differences);
  assert.match(shown, /vzorkovací frekvence při kalibraci 48000 Hz, nyní 48001 Hz/);
  // The structure wins over a string that says something else.
  const other = calibrationShown(a.reason, [{ field: 'channelCount', was: 1, now: 2 }]);
  assert.match(other, /počet kanálů při kalibraci 1, nyní 2/);
});

test('an unknown reason (a mutated template) still reads NEKALIBROVÁNO first', () => {
  for (const t of [
    'UNCALIBRATED: the level calibration was taken with a warp drive. Calibrate again for this input.',
    'UNCALIBRATED: the level calibration was taken with sample rate 48000 Hz at calibration, 44100 Hz now. Calibrate again.',
    'UNCALIBRATED: something new',
  ]) {
    const shown = calibrationShown(t);
    assert.match(shown, /^NEKALIBROVÁNO: /, shown);
    assert.doesNotMatch(shown, /\bUNCALIBRATED\b/, shown);
  }
});

test('every shown state, badge and title has no English calibration word', () => {
  const values = [
    ...Object.values(CALIBRATION_WORDS).map(() => null),
    UNAVAILABLE.UNCALIBRATED, QUANTITY_KINDS.CALIBRATED, LEVEL_PENDING_INDICATOR,
    LEVEL_OFFSET_APPLIED_TEXT, LEVEL_NOT_VALID_TEXT, ...Object.values(FREQUENCY_BADGES),
    CHARACTERIZE_PLAYBACK_CHAIN.label, levelLabel(null).indicator, levelLabel(LEVEL).indicator,
  ].filter(Boolean);
  const profile = createFrequencyProfile({ name: 'P', points: [[1000, 0], [4000, 1]] });
  for (const args of [{ inUse: false }, { profile, inUse: true, span: [100, 10000] },
    { profile, inUse: true, span: [1000, 4000] }, { profile, inUse: true, span: [10000, 16000] }]) {
    values.push(frequencyIndicator(args).text);
  }
  for (const s of measureFlow({}).steps) values.push(s.detail);
  for (const v of values) assert.doesNotMatch(calibrationShown(v), ENGLISH, `${v} -> ${calibrationShown(v)}`);
  assert.equal(calibrationShown(CHARACTERIZE_PLAYBACK_CHAIN.label), 'PROMĚŘIT ŘETĚZEC PŘEHRÁVÁNÍ');
  assert.equal(calibrationShown('UNCALIBRATED'), 'NEKALIBROVÁNO');
  assert.equal(calibrationShown('CALIBRATED'), 'KALIBROVÁNO');
  assert.equal(calibrationShown('Hraje'), 'Hraje');
  assert.equal(calibrationShown(''), '');
  assert.equal(calibrationShown(null), null);
});

test('C3-590-1: an embedded badge never garbles, in either order, and no state reads half-Czech', () => {
  const cases = {
    'UNCALIBRATED (frequency) · partial': 'NEKALIBROVÁNO (frekvence) · partial',
    'badge UNCALIBRATED (frequency); CALIBRATED (frequency)':
      'badge NEKALIBROVÁNO (frekvence); KALIBROVÁNO (frekvence)',
    'badge CALIBRATED (frequency); UNCALIBRATED (frequency)':
      'badge KALIBROVÁNO (frekvence); NEKALIBROVÁNO (frekvence)',
    'x none (UNCALIBRATED), CALIBRATED': 'x žádný (NEKALIBROVÁNO), KALIBROVÁNO',
  };
  for (const [t, want] of Object.entries(cases)) assert.equal(calibrationShown(t), want, t);
  const all = [...Object.keys(CALIBRATION_PHRASES), ...Object.keys(CALIBRATION_WORDS)];
  for (const a of all) {
    for (const b of all) {
      for (const t of [`${a} ${b}`, `${a}; ${b} · partial`, `(${a})`]) {
        const shown = calibrationShown(t);
        assert.doesNotMatch(shown.replace(/NEKALIBROVÁNO/g, ''), /[A-Z]KALIBROVÁNO/, `${t} -> ${shown}`);
        assert.doesNotMatch(shown, ENGLISH, `${t} -> ${shown}`);
      }
    }
  }
});

test('the data stays English: level.js, the views and the preset id are unchanged', () => {
  assert.equal(levelLabel(null).indicator, 'UNCALIBRATED');
  assert.equal(levelLabel(LEVEL).indicator, 'CALIBRATED');
  assert.equal(UNAVAILABLE.UNCALIBRATED, 'UNCALIBRATED');
  assert.equal(CHARACTERIZE_PLAYBACK_CHAIN.label, 'CHARACTERIZE PLAYBACK CHAIN');
});

test('the Czech forms make no claim the scan forbids (no SPL, certification, medical words)', () => {
  const czech = [...Object.values(CALIBRATION_PHRASES), ...Object.values(CALIBRATION_REASONS),
    ...Object.values(CALIBRATION_WORDS), ...Object.values(BINDING_WORDS_SHOWN)];
  for (const c of czech) {
    assert.doesNotMatch(c, /\bSPL\b|certifik|atest|třídy? \d|léč|terapeut|zdrav|ultrazvuk|neslyšiteln|bezpečn/i, c);
  }
});

// ---------------------------------------------------------------------------------------------
// The census: which page bindings can show a calibration state, derived from the code.

const strip = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
/** Code that produces a calibration state or reason. */
const PRODUCES = /['`](?:UN)?CALIBRATED\b|\bUNAVAILABLE\.UNCALIBRATED\b|\bQUANTITY_KINDS\.CALIBRATED\b|\bFREQUENCY_BADGES\b|\bUNCAL\b|\bCAL\b|\bLEVEL_(?:PENDING_TEXT|PENDING_INDICATOR|OFFSET_APPLIED_TEXT|NOT_VALID_TEXT|FROM_\w+)\b|\.reason\b|\bfrequencyIndicator\(/;

/** The workspace getters that give a calibration state: those that produce one, transitively. */
export function calibrationGetters(src) {
  const body = {};
  const re = /\n {4}get (\w+)\(\) \{([\s\S]*?)\n {4}\},/g;
  for (let m = re.exec(src); m; m = re.exec(src)) body[m[1]] = strip(m[2]);
  const out = new Set(Object.keys(body).filter((g) => PRODUCES.test(body[g])));
  for (let grew = true; grew;) {
    grew = false;
    for (const [g, b] of Object.entries(body)) {
      if (out.has(g)) continue;
      if ([...out].some((o) => new RegExp(`this\\.${o}\\b`).test(b))) { out.add(g); grew = true; }
    }
  }
  return out;
}

/** The meas.cal fields the adapter fills with a reason. */
export function reasonFields(sources) {
  const out = new Set();
  for (const src of sources) {
    for (const m of strip(src).matchAll(/m\.cal\.(\w+) = ([^;]+);/g)) {
      if (/\.reason\b|LEVEL_PENDING_TEXT|LEVEL_FROM_/.test(m[2])) out.add(m[1]);
    }
  }
  return out;
}

/**
 * The badge lists: the arrays a view module fills with a calibration state (`const x = [...]`
 * or `x.push/splice/unshift(...)` whose own arguments produce one). The indicators and reasons
 * reach the page through the getters and meas.cal fields above. The labels and sentences that
 * quote a state (series labels, step details, quality rows, compared values) are proven where
 * they are shown, by the rendered-page walk of check calibration-czech in tests/browser/v3-ui.cjs:
 * a data flow over generic keys (`label`, `text`) would demand every label of the page.
 */
export function badgeLists(sources) {
  const out = new Set();
  for (const src of sources) {
    for (const stmt of strip(src).split(/;\s*\n/)) {
      if (!PRODUCES.test(stmt)) continue;
      for (const m of stmt.matchAll(/\b([a-z]\w*)\.(?:push|splice|unshift)\(([\s\S]*)/g)) {
        if (PRODUCES.test(m[2])) out.add(m[1]);
      }
      for (const m of stmt.matchAll(/\b(?:const|let) ([a-z]\w*) = \[([\s\S]*)/g)) {
        if (PRODUCES.test(m[2])) out.add(m[1]);
      }
    }
  }
  return out;
}

/** Every shown binding of the page, each with the x-for aliases in scope at its place. */
export function bindings(html) {
  const page = html.replace(/<!--[\s\S]*?-->/g, (c) => ' '.repeat(c.length));
  const loops = [...page.matchAll(/x-for="\(?(\w+)(?:, \w+)?\)? in ([^"]+)"/g)]
    .map((m) => ({ at: m.index, alias: m[1], coll: m[2] }));
  const list = [];
  for (const m of page.matchAll(/\s(x-text|x-html|:title|:aria-label)="([^"]*)"/g)) {
    const aliases = new Map();
    for (const l of loops) if (l.at < m.index) aliases.set(l.alias, l.coll);
    list.push({ attr: m[1], expr: m[2], aliases });
  }
  return list;
}

/** The bindings that read a calibration source, with whether they read it through the map. */
export function census(html, { getters, fields, props }) {
  const viewPath = (e) => /\b(?:meas|exps)\.\w/.test(e);
  const reads = (expr, aliases) => {
    if ([...getters].some((g) => new RegExp(`(?<![.\\w])${g}\\b`).test(expr))) return true;
    if ([...fields].some((f) => new RegExp(`\\bmeas\\.cal\\.${f}\\b`).test(expr))) return true;
    if (/'[^']*\b(?:UN)?CALIBRATED\b[^']*'/.test(expr)) return true;
    if (/\bCHARACTERIZE_PLAYBACK_CHAIN\.label\b/.test(expr)) return true;
    // An item of such a list, through the x-for alias over it (the item or a field of it).
    for (const [a, coll] of aliases) {
      if (!viewPath(coll) || ![...props].some((p) => new RegExp(`\\.${p}\\b`).test(coll))) continue;
      // A letter of any alphabet bounds a name: the b of a badge loop is not the b of "během".
      if (new RegExp(`(?<![.\\w\\p{L}])${a}(?![.\\w\\p{L}(])`, 'u').test(expr)) return true;
    }
    return false;
  };
  // Wrapped: every source it reads is inside a calibrationShown(...) call.
  const outside = (e) => e.replace(/calibrationShown\((?:[^()]|\([^()]*\))*\)/g, '');
  return bindings(html).filter((b) => reads(b.expr, b.aliases)).map((b) => ({ attr: b.attr,
    expr: b.expr, wrapped: !reads(outside(b.expr), b.aliases) }));
}

const SESSION = read('src/js/ui/measure/session.js');
const ADAPTER = readdirSync(`${ROOT}src/js/ui/measure`).filter((f) => f.endsWith('.js'))
  .map((f) => read(`src/js/ui/measure/${f}`));
const VIEWS = readdirSync(`${ROOT}src/js/measurement/views`).filter((f) => f.endsWith('.js')
  && f !== 'common.js').map((f) => read(`src/js/measurement/views/${f}`));
const SOURCES = { getters: calibrationGetters(SESSION), fields: reasonFields(ADAPTER),
  props: badgeLists(VIEWS) };
const HTML = read('src/index.html');

test('the census derives the calibration sources (it reads something)', () => {
  for (const g of ['measureCalIndicator', 'measureFreqIndicator', 'measureLevelsText']) {
    assert.ok(SOURCES.getters.has(g), `getter ${g} not derived: ${[...SOURCES.getters]}`);
  }
  for (const f of ['levelVoid', 'levelPending']) assert.ok(SOURCES.fields.has(f), f);
  assert.ok(SOURCES.props.has('badges'), [...SOURCES.props].join(' '));
  assert.ok(census(HTML, SOURCES).length >= 10, census(HTML, SOURCES).length);
});

test('every page binding of a calibration source reads it through calibrationShown', () => {
  const bare = census(HTML, SOURCES).filter((b) => !b.wrapped).map((b) => `${b.attr}="${b.expr}"`);
  assert.deepEqual(bare, [], 'wrap it in calibrationShown(...) (rule project.no-fake-science v3)');
});

test('mutation: dropping any one wrap fails the census', () => {
  const wrapped = census(HTML, SOURCES).filter((b) => b.wrapped);
  assert.ok(wrapped.length >= 10);
  for (const b of wrapped) {
    const unwrapped = b.expr.replace(/calibrationShown\(([^()]*(?:\([^()]*\)[^()]*)*?)(?:, [^()]+)?\)/, '$1');
    assert.notEqual(unwrapped, b.expr, b.expr);
    const mutated = HTML.replace(`${b.attr}="${b.expr}"`, `${b.attr}="${unwrapped}"`);
    const bare = census(mutated, SOURCES).filter((x) => !x.wrapped);
    assert.ok(bare.length >= 1, `dropping the wrap of ${b.expr} went unnoticed`);
  }
});

test('the page text shows no bare English calibration state', () => {
  const text = HTML.replace(/<!--[\s\S]*?-->/g, '').replace(/<script[\s\S]*?<\/script>/g, '')
    .replace(/<[^>]*>/g, ' ');
  assert.doesNotMatch(text, ENGLISH);
  // The canvas label is drawn, not bound: it reads the map too.
  const charts = strip(read('src/js/charts/measure-charts.js'));
  assert.doesNotMatch(charts, /label\([^)]*?,\s*'(?:UN)?CALIBRATED'/);
  assert.match(charts, /label\(ctx, theme, calibrationShown\('CALIBRATED'\)/);
});

test('tests/browser reads shown calibration text in Czech, never with an English regex', () => {
  // A DOM text check written against the English state would pass vacuously once the page is
  // Czech ("!/UNCALIBRATED/" holds for every Czech text), so none may stay (oscilla-c3).
  const dir = `${ROOT}tests/browser`;
  const bad = [];
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.cjs'))) {
    const src = strip(readFileSync(`${dir}/${f}`, 'utf8'));
    src.split('\n').forEach((line, i) => {
      if (/textContent|innerText|getAttribute\('title'\)|indicatorText|FREQ_HEAD|\.text\b/.test(line)
        && /\/[^/\n]*\b(?:UN)?CALIBRATED\b[^/\n]*\/\.test/.test(line)) bad.push(`${f}:${i + 1}`);
    });
  }
  assert.deepEqual(bad, []);
});
