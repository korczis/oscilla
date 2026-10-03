// OSCILLA calibration — import of frequency-response calibration files (spec §20, §93, §142).
//
// Method: a strict, explainable parser. Accepted inputs:
//   • delimited text: two columns (frequency Hz, correction dB) separated by tabs/spaces,
//     semicolons or commas; optional header naming the columns (`frequency_hz, correction_db`,
//     `Freq(Hz)<TAB>SPL(dB)<TAB>Phase(deg)`, ...); `#`, `;` and `*` comment lines; blank lines;
//     quoted metadata lines such as `"Sens Factor =-1.23dB, SERNO: 1234"`;
//   • JSON: an OSCILLA export (profile.js `exportProfile`), `[{ hz, db }]` or `[[hz, db]]`.
// The delimiter is fixed per file by the first data row (tab > semicolon > comma > space).
// More than two columns are accepted only when a header names the frequency and correction
// columns; other named columns (e.g. phase) are ignored with a warning.
//
// Rejected, never repaired (spec §20 "never accept ambiguous malformed files silently"):
// text rows that are neither comments, metadata nor a recognized header; extra unlabeled
// columns; comma-separated rows whose field count betrays decimal commas; decimal commas mixed
// with decimal points; `1,000`-style tokens (thousands grouping or decimal?); NaN, Infinity
// and overflowing numbers; conflicting duplicates; out-of-range points; more than 2000 points;
// more than 1 MiB of input. Decimal commas are accepted only where they cannot be a separator
// (tab-, space- or semicolon-delimited files), with a warning. Unsorted rows are sorted with a
// warning; exact duplicates are merged with a warning (profile.js).
//
// A microphone sensitivity line ("Sens Factor") is a statement about absolute sensitivity, not
// a frequency correction and not an SPL calibration: it is recorded in the profile notes and a
// warning, and never applied (spec §17, §23).
//
// Sign convention (profile.js PROFILE_CONVENTIONS; M4 of the V3 review): what the values mean
// is decided from the file, never guessed:
//   • a header naming the column as the microphone's response — deviation, response, SPL,
//     magnitude, level, amplitude or a bare dB — states the DEVIATION (corrected = observed −
//     value), the convention of measurement-microphone files;
//   • a header naming it correction, corr, gain, EQ, cal, calibration or value is AMBIGUOUS (a
//     "correction" file may hold either the deviation or the inverse to add): the result then
//     needs an explicit choice (needsConvention: true, profile: null, previews of both) and the
//     caller parses again with opts.convention;
//   • no header (two bare columns, the miniDSP/UMIK-style file) or a JSON point array states the
//     deviation by the measurement-microphone convention, said so in `convention.text`;
//   • an OSCILLA JSON export carries `convention` (schema 2); a schema-1 export is migrated to
//     'deviation' (profile.js migrateProfileDocument), with a warning;
//   • an OSCILLA CSV export (export.js profileCsvText) states it on a `# convention: deviation`
//     or `# convention: correction` comment line, which settles an ambiguous header; a
//     directive that contradicts a header naming the microphone's response is an error.
// OSCILLA CSV directives (`#` comment lines, export.js): `# convention: <deviation|correction>`,
// `# name: <text>` (the file's own name wins over opts.name, as in a JSON export) and
// `# id: <sha256>` (a mismatch with the recomputed id is a warning). A directive repeated with
// a different value, or an unknown convention, is an error on its line.
// opts.convention ('deviation' | 'correction'), the user's explicit choice, overrides all of
// these.
//
// Result: { ok: true, profile, warnings: [{ line, text }], convention: { value, source:
//         'header'|'default'|'file'|'migrated'|'caller', header, needsChoice, text }, preview }
//         or, when a choice is needed, { ok: true, needsConvention: true, profile: null,
//         warnings, convention, previews: { deviation, correction } } (interpolate.js
//         previewConvention of each reading) or { ok: false, errors: [{ line, text }] }; `line`
//         is 1-based, or null for whole-file and JSON issues. Pure; never throws for bad input
//         text.

import {
  createFrequencyProfile, normalizePoints, CalibrationError, migrateProfileDocument,
  PROFILE_FORMAT, PROFILE_KIND, PROFILE_UNITS, PROFILE_CONVENTIONS, DEFAULT_CONVENTION,
} from './profile.js';
import { previewConvention } from './interpolate.js';

export const MAX_IMPORT_BYTES = 1024 * 1024;
const MAX_REPORTED_ERRORS = 50;

const NUM_RE = /^[-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][-+]?\d+)?$/;
const DEC_COMMA_RE = /^[-+]?\d+,\d+(?:[eE][-+]?\d+)?$/;
const GROUPING_RE = /^[-+]?[1-9]\d{0,2},\d{3}$/;
const NONFINITE_RE = /^[-+]?(?:nan|inf|infinity|∞)$/i;
const SENS_RE = /sens(?:itivity)?\s*factor\s*=\s*([-+]?(?:\d+(?:\.\d*)?|\.\d+))\s*db/i;
const COMMENT_RE = /^[#;*]/;
const QUOTED_LINE_RE = /^"[^"]*"$/;
const DATA_START_RE = /^"?[-+.\d]/;
/** An OSCILLA CSV directive line (export.js): `# name: …`, `# id: …`, `# convention: …`. */
const DIRECTIVE_RE = /^#\s*(name|id|convention)\s*:\s*(.*?)\s*$/i;

function utf8Length(str) {
  let n = 0;
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i);
    if (c < 0x80) n += 1;
    else if (c < 0x800) n += 2;
    else if (c >= 0xd800 && c <= 0xdbff) {
      n += 4;
      i++;
    } else n += 3;
  }
  return n;
}

const fail = (errors) => ({ ok: false, errors });

function clip(text, max = 60) {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

const notData = (text) => `not a number, comment or header: "${clip(text)}"`;

// --- header recognition --------------------------------------------------------------------

const CORRECTION_NAMES = new Set(['correction', 'corr', 'gain', 'magnitude', 'mag', 'response',
  'deviation', 'level', 'spl', 'amplitude', 'value', 'cal', 'calibration', 'eq']);
/** Column names that state the microphone's response (the deviation convention). */
const DEVIATION_NAMES = new Set(['deviation', 'response', 'spl', 'magnitude', 'mag', 'level',
  'amplitude', '']);

/** Base name of a correction column token: "Gain(dB)" → "gain", "SPL(dB)" → "spl", "dB" → "". */
function correctionBase(token) {
  const base = String(token).toLowerCase().replace(/[([][^)\]]*[)\]]/g, '')
    .replace(/[^a-z]/g, '');
  return base === 'db' ? '' : base.replace(/(?:dbspl|db)$/, '');
}

/** The convention a header token states, or null when it is ambiguous (see the header). */
export function conventionFromHeader(token) {
  return DEVIATION_NAMES.has(correctionBase(token)) ? 'deviation' : null;
}

function columnRole(token) {
  const lower = token.toLowerCase();
  const base = lower.replace(/[([][^)\]]*[)\]]/g, '').replace(/[^a-z]/g, '');
  if (base === '') return 'invalid';
  if (/^(?:f|freq|frequency|frequencies)(?:hz|khz)?$/.test(base) || base === 'hz') {
    return base.endsWith('khz') ? 'invalid' : 'frequency';
  }
  if (/^(?:phase|deg|degrees)(?:deg|degrees)?$/.test(base)) return 'phase';
  if (CORRECTION_NAMES.has(base.replace(/(?:dbspl|db)$/, '')) || base === 'db') {
    return 'correction';
  }
  return 'other';
}

function headerTokens(text, mode) {
  if (mode === 'comma') return text.split(',').map((t) => t.trim());
  if (mode === 'semicolon') return text.split(';').map((t) => t.trim());
  if (text.includes('\t')) return text.trim().split(/\t+/).map((t) => t.trim());
  // Space-separated: keep "(Hz)"/"[dB]" unit groups attached to the preceding name.
  const glued = text.trim().replace(/\s*([([])([^)\]]*)([)\]])/g,
    (_, o, inner, c) => `${o}${inner.replace(/\s+/g, '')}${c}`);
  return glued.split(/\s+/);
}

// Returns { columns: [role...], freqCol, corrCol, ignored: [names] } or null if not a header.
function parseHeader(text, mode) {
  const tokens = headerTokens(text, mode).map((t) => t.replace(/^"|"$/g, ''));
  if (tokens.length > 1 && tokens[tokens.length - 1] === '') tokens.pop(); // trailing delimiter
  if (tokens.length < 2) return null;
  if (tokens.some((t) => t === '' || NUM_RE.test(t))) return null;
  const columns = tokens.map(columnRole);
  if (columns.includes('invalid')) return null;
  const freq = columns.filter((r) => r === 'frequency').length;
  const corr = columns.filter((r) => r === 'correction').length;
  if (freq !== 1 || corr < 1) return null;
  if (corr > 1) return { ambiguous: true, tokens };
  return {
    columns,
    freqCol: columns.indexOf('frequency'),
    corrCol: columns.indexOf('correction'),
    ignored: tokens.filter((_, i) => columns[i] === 'phase' || columns[i] === 'other'),
    tokens,
    corrToken: tokens[columns.indexOf('correction')],
  };
}

// --- delimited text --------------------------------------------------------------------------

function detectMode(line) {
  if (line.includes('\t')) return 'whitespace';
  if (line.includes(';')) return 'semicolon';
  if (line.includes(',')) return 'comma';
  return 'whitespace';
}

function splitFields(text, mode) {
  let fields;
  if (mode === 'whitespace') fields = text.trim().split(/\s+/);
  else fields = text.split(mode === 'comma' ? ',' : ';').map((t) => t.trim());
  // A single trailing delimiter (common in spreadsheet exports) is tolerated.
  if (fields.length > 1 && fields[fields.length - 1] === '') fields.pop();
  return fields.map((f) => (f.length >= 2 && f.startsWith('"') && f.endsWith('"')
    ? f.slice(1, -1).trim() : f));
}

// { value, style: 'point'|'comma'|'plain' } or { error }.
function parseNumber(token, mode) {
  if (NONFINITE_RE.test(token)) return { error: `non-finite value "${token}"` };
  if (NUM_RE.test(token)) {
    const value = Number(token);
    if (!Number.isFinite(value)) return { error: `number "${clip(token, 30)}" overflows` };
    return { value, style: /[.]/.test(token) ? 'point' : 'plain' };
  }
  if (mode !== 'comma' && DEC_COMMA_RE.test(token)) {
    if (GROUPING_RE.test(token)) {
      return { error: `"${token}" is ambiguous (thousands grouping or decimal comma)` };
    }
    const value = Number(token.replace(',', '.'));
    if (!Number.isFinite(value)) return { error: `number "${clip(token, 30)}" overflows` };
    return { value, style: 'comma' };
  }
  return null;
}

function looksLikeDecimalComma(fields) {
  for (let i = 1; i < fields.length; i++) {
    if (/^\d+$/.test(fields[i]) && /^[-+]?\d+$/.test(fields[i - 1])) return true;
  }
  return false;
}

function parseDelimited(text, opts) {
  const lines = text.split(/\r\n|\r|\n/);
  const errors = [];
  const warnings = [];
  const notes = [];
  const push = (list, line, msg) => {
    if (list === errors && errors.length >= MAX_REPORTED_ERRORS) return;
    list.push({ line, text: msg });
  };

  // Pass 1: classify lines.
  const content = []; // { line, text } — candidate header and data rows
  const directives = {}; // name|id|convention → { value, line } (OSCILLA CSV export)
  // The comment nearest before the first content row may carry column names (`* Freq dB`).
  let lastComment = null;
  for (let i = 0; i < lines.length; i++) {
    const lineNo = i + 1;
    const t = lines[i].trim();
    if (t === '') continue;
    const dir = DIRECTIVE_RE.exec(t);
    if (dir) {
      const key = dir[1].toLowerCase();
      const value = key === 'convention' ? dir[2].toLowerCase() : dir[2];
      if (key === 'convention' && !Object.hasOwn(PROFILE_CONVENTIONS, value)) {
        push(errors, lineNo, `convention must be "deviation" or "correction", got "${
          clip(dir[2])}"`);
      } else if (directives[key] && directives[key].value !== value) {
        push(errors, lineNo, `${key} stated twice with different values (line `
          + `${directives[key].line} and line ${lineNo})`);
      } else if (!directives[key] && value !== '') directives[key] = { value, line: lineNo };
      continue;
    }
    const sens = SENS_RE.exec(t);
    const isComment = COMMENT_RE.test(t);
    const isMeta = !isComment && (QUOTED_LINE_RE.test(t) || (sens && !DATA_START_RE.test(t)));
    if (sens && (isComment || isMeta)) {
      const quoted = clip(t.replace(/^[#;*"\s]+|["\s]+$/g, ''), 120);
      notes.push(`File sensitivity line (not applied): ${quoted}`);
      push(warnings, lineNo, `sensitivity statement "Sens Factor = ${sens[1]} dB" recorded in `
        + 'notes; it is not a frequency correction and is never applied as SPL');
    }
    if (isComment || isMeta) {
      if (content.length === 0 && isComment) {
        lastComment = { line: lineNo, text: t.replace(/^[#;*]+\s*/, '') };
      }
      continue;
    }
    content.push({ line: lineNo, text: t });
  }

  const firstData = content.findIndex((c) => DATA_START_RE.test(c.text));
  if (firstData < 0) {
    if (content.length === 0) return fail([{ line: null, text: 'no calibration data found' }]);
    for (const c of content) push(errors, c.line, notData(c.text));
    push(errors, null, 'no numeric data rows found');
    return fail(errors);
  }
  const mode = detectMode(content[firstData].text);

  // Header: at most one text row before the first data row; it must name the columns.
  let header = null;
  for (let k = 0; k < firstData; k++) {
    const c = content[k];
    const h = parseHeader(c.text, mode);
    if (h && h.ambiguous) {
      push(errors, c.line, `header names several correction columns (${h.tokens.join(', ')}); `
        + 'keep only one');
    } else if (h && !header && k === firstData - 1) {
      header = { ...h, line: c.line };
    } else {
      push(errors, c.line, notData(c.text));
    }
  }
  if (!header && firstData === 0 && lastComment) {
    const h = parseHeader(lastComment.text, mode);
    const width = splitFields(content[0].text, mode).length;
    if (h && !h.ambiguous && h.columns.length === width && width > 2) {
      header = { ...h, line: lastComment.line };
      push(warnings, lastComment.line,
        `column names taken from comment line: ${h.tokens.join(', ')}`);
    }
  }
  const expected = header ? header.columns.length : 2;
  const freqCol = header ? header.freqCol : 0;
  const corrCol = header ? header.corrCol : 1;
  if (header && header.ignored.length) {
    push(warnings, header.line, `ignored column(s): ${header.ignored.join(', ')}`);
  }

  // Pass 2: data rows.
  const points = [];
  const pointLines = [];
  let firstComma = null;
  let firstPoint = null;
  for (let k = firstData; k < content.length; k++) {
    const { line, text: rowText } = content[k];
    const fields = splitFields(rowText, mode);
    if (!DATA_START_RE.test(rowText)) {
      push(errors, line, notData(rowText));
      continue;
    }
    if (fields.length !== expected) {
      if (mode === 'comma' && fields.length > expected && looksLikeDecimalComma(fields)) {
        push(errors, line, `${fields.length} comma-separated fields where ${expected} were `
          + 'expected: decimal commas cannot be told apart from comma separators; use decimal '
          + 'points or a tab/semicolon separator');
      } else if (!header && fields.length > 2) {
        push(errors, line, `${fields.length} columns but no header naming the frequency and `
          + 'correction columns');
      } else {
        push(errors, line,
          `expected ${expected} columns, found ${fields.length}: "${clip(rowText)}"`);
      }
      continue;
    }
    let rowOk = true;
    const values = [];
    for (const f of fields) {
      const r = parseNumber(f, mode);
      if (!r) {
        push(errors, line, notData(rowText));
        rowOk = false;
        break;
      }
      if (r.error) {
        push(errors, line, r.error);
        rowOk = false;
        break;
      }
      if (r.style === 'comma' && firstComma === null) firstComma = line;
      if (r.style === 'point' && firstPoint === null) firstPoint = line;
      values.push(r.value);
    }
    if (!rowOk) continue;
    points.push([values[freqCol], values[corrCol]]);
    pointLines.push(line);
  }
  if (firstComma !== null && firstPoint !== null) {
    push(errors, Math.max(firstComma, firstPoint), 'decimal commas and decimal points are mixed '
      + `(first comma on line ${firstComma}, first point on line ${firstPoint}); ambiguous`);
  } else if (firstComma !== null) {
    push(warnings, firstComma, 'decimal commas read as decimal separators');
  }
  if (errors.length >= MAX_REPORTED_ERRORS) {
    errors.push({ line: null, text: `more than ${MAX_REPORTED_ERRORS} errors; stopped reporting` });
  }
  if (errors.length) return fail(errors);

  let convention;
  const dc = directives.convention;
  if (dc) {
    const stated = header ? conventionFromHeader(header.corrToken) : null;
    if (stated && stated !== dc.value) {
      return fail([{ line: dc.line, text: `the convention line says "${dc.value}" but the `
        + `header "${header.corrToken}" names the microphone's response (deviation)` }]);
    }
    convention = { value: dc.value, source: 'file', header: header ? header.corrToken : null,
      needsChoice: false, text: `stated by the file (line ${dc.line}): `
        + `${PROFILE_CONVENTIONS[dc.value].label}` };
  } else if (header) {
    const stated = conventionFromHeader(header.corrToken);
    convention = stated
      ? { value: stated, source: 'header', header: header.corrToken, needsChoice: false,
        text: `the header "${header.corrToken}" names the microphone's response: `
          + `${PROFILE_CONVENTIONS.deviation.label}` }
      : { value: null, source: 'header', header: header.corrToken, needsChoice: true,
        text: `the header "${header.corrToken}" does not say whether the values are the `
          + "microphone's deviation or a correction to add: choose one" };
  } else {
    convention = { value: DEFAULT_CONVENTION, source: 'default', header: null,
      needsChoice: false, text: 'no column header: read as the microphone\'s response, the '
        + `convention of measurement-microphone files (${PROFILE_CONVENTIONS.deviation.label})` };
  }
  const result = finish(points, (i) => pointLines[i], warnings, {
    name: directives.name ? directives.name.value : opts.name, source: opts.source,
    notes: [opts.notes, ...notes].filter((n) => typeof n === 'string' && n.trim()).join('\n'),
    importedAt: opts.importedAt,
  }, withCaller(convention, opts));
  const di = directives.id;
  if (di && result.ok && result.profile && di.value !== result.profile.id) {
    result.warnings.push({ line: di.line,
      text: 'the id stated in the file does not match its points; the id was recomputed' });
  }
  return result;
}

// --- JSON ------------------------------------------------------------------------------------

function jsonPoints(list, errors) {
  const points = [];
  list.forEach((e, i) => {
    let hz;
    let db;
    if (Array.isArray(e) && e.length === 2) [hz, db] = e;
    else if (e && typeof e === 'object' && !Array.isArray(e)) {
      hz = e.hz ?? e.frequency_hz;
      db = e.db ?? e.correction_db;
    }
    if (typeof hz !== 'number' || typeof db !== 'number') {
      if (errors.length < MAX_REPORTED_ERRORS) {
        errors.push({ line: null, text: `entry ${i}: expected [hz, db] or { hz, db } numbers` });
      }
      return;
    }
    points.push([hz, db]);
  });
  return points;
}

function parseJson(text, opts) {
  let data;
  try {
    data = JSON.parse(text);
  } catch (e) {
    return fail([{ line: null, text: `invalid JSON: ${e.message}` }]);
  }
  const errors = [];
  const warnings = [];
  let meta = {};
  let list;
  if (Array.isArray(data)) {
    list = data;
  } else if (data && typeof data === 'object') {
    if (data.format !== undefined && data.format !== PROFILE_FORMAT) {
      errors.push({ line: null, text: `unknown format "${String(data.format)}"` });
    }
    if (data.kind !== undefined && data.kind !== PROFILE_KIND) {
      errors.push({ line: null, text: `kind "${String(data.kind)}" is not a frequency profile` });
    }
    const m = migrateProfileDocument(data);
    if (!m.ok) errors.push({ line: null, text: m.text });
    else if (data.format === PROFILE_FORMAT || data.schemaVersion !== undefined) {
      if (!Object.hasOwn(PROFILE_CONVENTIONS, m.doc.convention)) {
        errors.push({ line: null, text: 'convention must be "deviation" or "correction", got '
          + `${JSON.stringify(m.doc.convention) ?? 'nothing'}` });
      } else if (m.migrated) {
        warnings.push({ line: null, text: `schema ${m.from} profile migrated to schema `
          + `${m.doc.schemaVersion}: convention "deviation" (the only meaning schema ${m.from} `
          + 'had)' });
      }
      meta = m.doc;
    }
    if (data.units !== undefined && (!data.units || data.units.frequency !== PROFILE_UNITS.frequency
      || data.units.correction !== PROFILE_UNITS.correction)) {
      errors.push({ line: null, text: 'units must be { frequency: "Hz", correction: "dB" }' });
    }
    if (!Array.isArray(data.points)) {
      errors.push({ line: null, text: 'JSON object has no "points" array' });
    }
    if (errors.length) return fail(errors);
    list = data.points;
    if (meta.format === undefined && meta.schemaVersion === undefined) meta = data;
  } else {
    return fail([{ line: null, text: 'JSON must be an object with "points" or an array' }]);
  }
  const points = jsonPoints(list, errors);
  if (errors.length) return fail(errors);
  const str = (v) => (typeof v === 'string' ? v : undefined);
  const stated = typeof meta.convention === 'string' ? meta.convention : null;
  const convention = stated
    ? { value: stated, source: meta.schemaVersion !== data.schemaVersion ? 'migrated' : 'file',
      header: null, needsChoice: false,
      text: `stated by the file: ${PROFILE_CONVENTIONS[stated].label}` }
    : { value: DEFAULT_CONVENTION, source: 'default', header: null, needsChoice: false,
      text: 'a JSON point list without a convention: read as the microphone\'s response, the '
        + `convention of measurement-microphone files (${PROFILE_CONVENTIONS.deviation.label})` };
  const result = finish(points, () => null, warnings, {
    name: str(meta.name) ?? opts.name,
    source: opts.source ?? meta.source,
    notes: opts.notes ?? meta.notes,
    importedAt: opts.importedAt ?? meta.importedAt,
  }, withCaller(convention, opts));
  if (result.ok && result.profile && typeof meta.id === 'string'
    && meta.id !== result.profile.id) {
    result.warnings.push({ line: null,
      text: 'the id stored in the file does not match its points; the id was recomputed' });
  }
  return result;
}

// --- shared ----------------------------------------------------------------------------------

// Rephrase a profile.js message ("point 3: ...") in terms of the source: a line or an entry.
function locate(text, lineOf) {
  const where = (i) => (lineOf(i) === null ? `entry ${i}` : `line ${lineOf(i)}`);
  return text
    .replace(/^point (\d+): /, (_, i) => (lineOf(Number(i)) === null ? `entry ${i}: ` : ''))
    .replace(/of point (\d+)/, (_, i) => `of ${where(Number(i))}`);
}

// The caller's explicit convention (opts.convention) overrides what the file says.
function withCaller(convention, opts) {
  const c = opts.convention;
  if (c === undefined || c === null) return convention;
  return { value: c, source: 'caller', header: convention.header, needsChoice: false,
    text: `chosen explicitly: ${Object.hasOwn(PROFILE_CONVENTIONS, c)
      ? PROFILE_CONVENTIONS[c].label : String(c)}`, fileText: convention.text };
}

function finish(points, lineOf, warnings, fields, convention) {
  if (convention.value !== null && !Object.hasOwn(PROFILE_CONVENTIONS, convention.value)) {
    return fail([{ line: null, text: 'convention must be "deviation" or "correction", got '
      + `${JSON.stringify(convention.value)}` }]);
  }
  const norm = normalizePoints(points);
  const at = (index) => (index === null ? null : lineOf(index));
  if (norm.errors.length) {
    return fail(norm.errors.slice(0, MAX_REPORTED_ERRORS)
      .map((e) => ({ line: at(e.index), text: locate(e.text, lineOf) })));
  }
  for (const w of norm.warnings) warnings.push({ line: at(w.index), text: locate(w.text, lineOf) });
  try {
    if (convention.needsChoice) {
      const previews = {};
      for (const c of Object.keys(PROFILE_CONVENTIONS)) {
        previews[c] = previewConvention(createFrequencyProfile({ ...fields, points: norm.points,
          convention: c }));
      }
      return { ok: true, needsConvention: true, profile: null, warnings, convention, previews };
    }
    const profile = createFrequencyProfile({ ...fields, points: norm.points,
      convention: convention.value });
    return { ok: true, profile, warnings, convention, preview: previewConvention(profile) };
  } catch (e) {
    if (e instanceof CalibrationError) return fail([{ line: null, text: e.message }]);
    throw e;
  }
}

// Parse calibration text (CSV/TSV/whitespace or JSON). Options: { name, source, notes,
// importedAt, convention } — metadata the user or caller supplies (convention: the explicit
// sign choice, see the header); nothing is inferred from file content
// except a sensitivity line, which is quoted into notes verbatim. For an OSCILLA JSON export the
// file's own name wins over `name` (usually just the file name, the weaker label) and the
// options' source, notes and importedAt win over the file's.
export function parseCalibrationText(text, opts = {}) {
  if (typeof text !== 'string') return fail([{ line: null, text: 'input must be text' }]);
  if (text.length > MAX_IMPORT_BYTES || utf8Length(text) > MAX_IMPORT_BYTES) {
    return fail([{ line: null, text: `input larger than ${MAX_IMPORT_BYTES} bytes (1 MiB)` }]);
  }
  const body = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const options = opts || {};
  const head = body.trimStart()[0];
  if (head === '{' || head === '[') return parseJson(body, options);
  return parseDelimited(body, options);
}
