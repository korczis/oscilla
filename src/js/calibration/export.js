// OSCILLA calibration — export of a frequency-response profile (spec §21-§22; plan V315).
//
// Two files, both deterministic for a given profile (same profile → same bytes, same name; no
// clock, no randomness) and both read back by parse.js parseCalibrationText:
//   JSON  profile.js exportProfile() (format 'oscilla.calibration', schema 2): name, id,
//         convention, source, units, points, notes, importedAt. A re-import keeps the name, the
//         convention, the points and so the id; importedAt is the time of the new import.
//   CSV   OSCILLA directive comments, then a header naming the columns, then one `hz,db` row per
//         point (ECMAScript Number::toString, the shortest form that round-trips):
//             # OSCILLA frequency calibration profile (oscilla.calibration, schema 2)
//             # name: <name>
//             # id: <sha256>
//             # convention: deviation | correction
//             # <what the convention means>
//             frequency_hz,deviation_db        (or frequency_hz,correction_db)
//             20,1.5
//         parse.js reads the `name`, `id` and `convention` directives: the stated convention is
//         what makes a `correction_db` column unambiguous on re-import, the name wins over the
//         file name, and an id that does not match the points is a warning (the id is always
//         recomputed). Source and notes are not in the CSV (the JSON carries them): a notes line
//         such as a quoted sensitivity statement would be read again as a file statement.
// File names: '<name stem>-<first 8 hex digits of the id>.calibration.<csv|json>'.

import {
  createFrequencyProfile, exportProfile, PROFILE_CONVENTIONS, PROFILE_FORMAT,
  PROFILE_SCHEMA_VERSION,
} from './profile.js';

/** The CSV column header per convention (parse.js reads 'deviation' as the deviation). */
export const PROFILE_CSV_HEADERS = Object.freeze({
  deviation: 'frequency_hz,deviation_db',
  correction: 'frequency_hz,correction_db',
});

export const PROFILE_EXPORT_FORMATS = Object.freeze(['csv', 'json']);

const oneLine = (s) => String(s).replace(/[\s\x00-\x1f\x7f]+/g, ' ').trim();

/** The JSON export text of a profile (two-space indented, trailing newline). */
export function profileJsonText(profile) {
  return `${JSON.stringify(exportProfile(profile), null, 2)}\n`;
}

/** The CSV export text of a profile (see the header). */
export function profileCsvText(profile) {
  const p = createFrequencyProfile(profile); // normalizes and validates; throws CalibrationError
  const lines = [
    `# OSCILLA frequency calibration profile (${PROFILE_FORMAT}, schema ${PROFILE_SCHEMA_VERSION})`,
    `# name: ${oneLine(p.name)}`,
    `# id: ${p.id}`,
    `# convention: ${p.convention}`,
    `# ${PROFILE_CONVENTIONS[p.convention].label}`,
    PROFILE_CSV_HEADERS[p.convention],
    ...p.points.map(([hz, db]) => `${hz},${db}`),
  ];
  return `${lines.join('\n')}\n`;
}

/** A file-name stem from a profile name: lower-case letters, digits and dashes. */
export function profileFileStem(name) {
  const s = String(name || '').normalize('NFKD').replace(/[^\w\s-]+/g, '').trim()
    .replace(/[\s_]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 60)
    .toLowerCase();
  return s || 'profile';
}

/** The export file name of a profile in `format` ('csv' | 'json'). */
export function profileFileName(profile, format) {
  if (!PROFILE_EXPORT_FORMATS.includes(format)) {
    throw new RangeError(`unknown profile export format '${format}' (csv or json)`);
  }
  const p = createFrequencyProfile(profile);
  return `${profileFileStem(p.name)}-${p.id.slice(0, 8)}.calibration.${format}`;
}

/** { text, fileName, type } of a profile export (the MIME type for the download). */
export function exportProfileFile(profile, format) {
  const fileName = profileFileName(profile, format);
  return format === 'json'
    ? { text: profileJsonText(profile), fileName, type: 'application/json' }
    : { text: profileCsvText(profile), fileName, type: 'text/csv' };
}
