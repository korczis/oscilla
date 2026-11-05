// The family census of the source tree (plan issue G021, milestone M123): which modules under
// src/js implement each control family of src/js/ui/catalog/families.js, by their marker comment
// and by the family's source signature, and what is wrong with that. Pure apart from reading
// files; tests/unit/ui-families.test.mjs imports it.
//
//   familyCensus(files, families) -> { implementers: [{ file, family, role, name?, reason?,
//                                      matched }], problems: [{ family, file, kind, text }] }
//     files: { 'src/js/...': text }   families: the FAMILIES table
//   readSources(root) -> { 'src/js/...': text }   every .js file under src/js
//   problemKey(p) -> 'family|file|kind'   the identity a baseline entry names
//
// A marker is a line comment among the first MARKER_LINES lines of a module:
//   // ui-family: <id> model | // ui-family: <id> skin <name> | // ui-family: <id> not: <reason>
// A signature is matched on the code with comments removed (string contents kept, so markup in
// a template counts). Problem kinds:
//   unmarked       the module matches the family's signature and carries no marker for it
//   second-model   a model marker on a module the table does not name as the family's model
//   model-missing  the table's model module does not exist or carries no model marker
//   skin-logic     a skin matches the family's value-logic signature (it re-implements the model)
//   bad-marker     a marker naming no family, or one malformed
//   foreign-attr   the module writes data-ui-family="<id>" (markup, setAttribute or dataset) but
//                  is neither the family's model nor one of its skins: only those mark a render

import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

import { lexJs } from './scan.mjs';

export const MARKER_LINES = 40;
const MARKER = /^\s*\/\/\s*ui-family:\s*(\S+)\s+(model|skin|not:)\s*(.*)$/;

// The source signatures: what implementing a family looks like in code. Each is narrow enough
// that a consumer (a module importing the model, or setting a value the model computed) does
// not match it: a definition, a value mapping or rendered markup of the family's role.
export const SIGNATURES = Object.freeze({
  // a value-to-angle mapping of a rotary control
  knob: [/\bSWEEP_DEG\s*=/, /\bfunction\s+controlSvg\b/, /\bexport\s+const\s+controlSvg\b/],
  // a value-to-position mapping of a track (the fill of a range)
  slider: [/\(\s*\(\s*v\s*-\s*min\s*\)\s*\/\s*\(\s*max\s*-\s*min\s*\)\s*\)\s*\*\s*100/],
  // a renderer emitting role switch or a radio group of options
  // (a CSS attribute selector such as [role="switch"] reads the role, it does not render it)
  switch: [/(?<!\[)role\s*[:=]\s*\\?["']switch\\?["']/, /(?<!\[)role=\\?"switch\\?"/,
    /(?<!\[)role\s*[:=]\s*\\?["']radiogroup\\?["']/, /(?<!\[)role=\\?"radiogroup\\?"/,
    /['"]role['"]\s*,\s*['"](switch|radiogroup)['"]/],
  // the key layout of an octave
  keyboard: [/\bfunction\s+isBlack\s*\(/],
  // a cable path between two points
  'patch-bay': [/\bfunction\s+cablePath\s*\(/, /\bconst\s+cablePath\s*=/],
  // a renderer or the registry of the navbar and the sidebar navigation
  'app-shell': [/\bexport\s+function\s+navTree\b/, /\bexport\s+const\s+WORKSPACE_REGISTRY\b/],
  // an ADSR curve law: the events or points of attack, decay, sustain and release
  // (a law reads attack and decay; an amplitude envelope of a signal, analysis/analytic.js,
  // reads neither, and h.release(t) or typeof h.release drives an envelope, it computes none)
  envelope: [/\bfunction\s+adsrEvents\s*\(/, /\bfunction\s+envelopePoints\s*\(/,
    /\bfunction\s+\w*[Ee]nvelope\w*\s*\([^)]*\)\s*\{[^}]*\.attack\b[^}]*\.decay\b/],
  // a filter's magnitude response: the live stage, or a biquad formula computing it
  'filter-response': [/\bfunction\s+createFilterStage\s*\(/,
    /\bfunction\s+biquad(Db|Magnitude|Response)\s*\(/],
});

// The value logic a skin must not hold (it is the model's): the first signatures of the families
// that have a value (a skin may render the role, but not map the value).
const VALUE_LOGIC = Object.freeze({
  knob: [SIGNATURES.knob[0]],
  slider: SIGNATURES.slider,
  keyboard: SIGNATURES.keyboard,
  envelope: SIGNATURES.envelope,
  'filter-response': SIGNATURES['filter-response'],
});

/** The markers of a module's first lines: [{ family, role, rest }] or a bad marker. */
function markersOf(text) {
  const out = [];
  const lines = text.split('\n').slice(0, MARKER_LINES);
  for (const line of lines) {
    if (!/^\s*\/\/\s*ui-family:/.test(line)) continue;
    const m = MARKER.exec(line);
    out.push(m ? { family: m[1], role: m[2] === 'not:' ? 'not' : m[2], rest: m[3].trim() }
      : { bad: line.trim() });
  }
  return out;
}

const matches = (code, res) => res.some((re) => re.test(code));

/** The family ids a module writes as data-ui-family, in markup, setAttribute or dataset. */
const WRITES = [/data-ui-family=\\?["']([\w-]+)/g,
  /setAttribute\(\s*['"]data-ui-family['"]\s*,\s*['"]([\w-]+)/g,
  /\.uiFamily\s*=\s*['"]([\w-]+)/g, /['"]data-ui-family['"]\s*:\s*['"]([\w-]+)/g];
function writtenFamilies(code) {
  const out = new Set();
  for (const re of WRITES) for (const m of code.matchAll(re)) out.add(m[1]);
  return [...out];
}

export function familyCensus(files, families) {
  const implementers = [];
  const problems = [];
  const add = (family, file, kind, text) => problems.push({ family, file, kind, text });
  const ids = Object.keys(families);
  for (const [file, text] of Object.entries(files).sort(([a], [b]) => a.localeCompare(b))) {
    const { code } = lexJs(text);
    const marks = markersOf(text);
    for (const m of marks) {
      if (m.bad || !ids.includes(m.family)) {
        add(m.family || '?', file, 'bad-marker', `a ui-family marker that names no family: ${
          m.bad || m.family}`);
      } else if (m.role === 'skin' && !m.rest) {
        add(m.family, file, 'bad-marker', 'a skin marker without its name');
      } else if (m.role === 'not' && m.rest.split(/\s+/).length < 4) {
        add(m.family, file, 'bad-marker', 'a not: marker needs a reason of four words or more');
      }
    }
    for (const id of writtenFamilies(code)) {
      if (!marks.some((m) => m.family === id && (m.role === 'model' || m.role === 'skin'))) {
        add(id, file, 'foreign-attr', `writes data-ui-family="${id}" without being the ${id} `
          + 'model or one of its skins');
      }
    }
    for (const id of ids) {
      const matched = matches(code, SIGNATURES[id] || []);
      const mine = marks.filter((m) => m.family === id && !m.bad);
      for (const m of mine) {
        implementers.push({ file, family: id, role: m.role,
          ...(m.role === 'skin' ? { name: m.rest } : {}),
          ...(m.role === 'not' ? { reason: m.rest } : {}), matched });
        if (m.role === 'model' && families[id].model !== file) {
          add(id, file, 'second-model', `a second ${id} model (the family's model is ${
            families[id].model || 'still to be chosen'})`);
        }
        if (m.role === 'skin' && matches(code, VALUE_LOGIC[id] || [])) {
          add(id, file, 'skin-logic', `a ${id} skin that holds the model's value logic`);
        }
      }
      if (matched && !mine.length) {
        implementers.push({ file, family: id, role: 'unmarked', matched });
        add(id, file, 'unmarked', `implements ${id} (its source signature) without a ui-family `
          + 'marker');
      }
    }
  }
  for (const [id, f] of Object.entries(families)) {
    if (!f.model) continue;
    const text = files[f.model];
    if (text === undefined || !markersOf(text).some((m) => m.family === id && m.role === 'model')) {
      add(id, f.model, 'model-missing', `the ${id} model ${f.model} is missing or carries no `
        + `"// ui-family: ${id} model" marker`);
    }
  }
  return { implementers, problems };
}

export const problemKey = (p) => `${p.family}|${p.file}|${p.kind}`;

export function readSources(root) {
  const out = {};
  const walk = (dir) => {
    for (const name of readdirSync(path.join(root, dir)).sort()) {
      const rel = `${dir}/${name}`;
      if (statSync(path.join(root, rel)).isDirectory()) walk(rel);
      else if (name.endsWith('.js')) out[rel] = readFileSync(path.join(root, rel), 'utf8');
    }
  };
  walk('src/js');
  return out;
}
