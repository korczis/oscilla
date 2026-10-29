// The lab settings a saved configuration carries beside the V1 instrument cfg: the Envelope
// (ADSR), Filter, Additive and Phase & Stereo labs. One snapshot shape (ui/config-file.js
// buildLabSections), one validation path (parseLabSections) and one apply path (applyLabSections,
// the lab branch of the config import), shared by the config file, custom presets, History
// entries and the `lab=` link key (C018). Pure: `labs` is the object of mounted labs main.js
// holds ({ envelope, filter, additive, phase }, any of them absent); no DOM, no audio nodes.
//
// The sequence is not a lab setting here: it is the Sequencer workspace's document and travels
// in the config file only.

import { buildLabSections, parseLabSections } from './config-file.js';

/** Display names of the sections, in the order a message lists them. */
export const LAB_SECTION_NAMES = Object.freeze({
  filter: 'Filter', envelope: 'Envelope', additive: 'Additive', phaseStereo: 'Phase & Stereo',
});

/** What a lab record holds, for the messages that say so. */
export const LABS_INCLUDED_TEXT = 'the instrument and the Filter, Envelope, Additive and '
  + 'Phase & Stereo settings';
/** Where the sequence goes instead (it is never in a preset, a History entry or a link). */
export const SEQUENCE_NOT_INCLUDED_TEXT = 'the sequence is not included (it travels in the '
  + 'config file)';

/** The lab sections of the mounted labs; null when no lab is mounted (nothing to keep). */
export function snapshotLabs(labs) {
  if (!labs) return null;
  const { envelope, filter, additive, phase } = labs;
  if (!envelope && !filter && !additive && !phase) return null;
  return buildLabSections({
    envelope: envelope ? { enabled: envelope.enabled, ...envelope.adsr } : null,
    filter: filter ? filter.config : null,
    additive: additive ? { enabled: additive.enabled, partials: additive.partials } : null,
    // A/B frequencies and the route are the dual oscillator's, already in the instrument cfg.
    phaseStereo: phase ? { phaseDeg: phase.config.phaseDeg, pan: phase.config.pan } : null,
  });
}

/**
 * Apply validated lab sections (parseLabSections or parseConfigImport output) to the mounted
 * labs. dual: the instrument's dual oscillator ({ a: { freq }, b: { freq }, stereo }), which
 * owns the Phase & Stereo frequencies and route. Returns the names of the sections applied
 * (keys of LAB_SECTION_NAMES). The labs keep their own limits.
 */
export function applyLabSections(labs, parsed, dual) {
  const applied = [];
  if (!labs || !parsed) return applied;
  if (parsed.envelope && labs.envelope) {
    labs.envelope.update({ adsr: parsed.envelope.adsr, enabled: parsed.envelope.enabled });
    applied.push('envelope');
  }
  if (parsed.filter && labs.filter) {
    labs.filter.update(parsed.filter);
    applied.push('filter');
  }
  if (parsed.additive && labs.additive) {
    labs.additive.update({ partials: parsed.additive.partials, enabled: parsed.additive.enabled });
    applied.push('additive');
  }
  if (parsed.phaseStereo && labs.phase) {
    const { phaseDeg, pan } = parsed.phaseStereo;
    const owner = dual ? { freqA: dual.a.freq, freqB: dual.b.freq,
      route: dual.stereo ? 'stereo' : 'mono' } : {};
    labs.phase.update({ phaseDeg, pan, ...owner });
    applied.push('phaseStereo');
  }
  return applied;
}

/**
 * Validate and apply a stored lab record (a preset's or History entry's `labs`, a `lab=` link).
 * Returns { applied, issues, warnings }: issues counts the sections refused as malformed.
 */
export function applyLabRecord(labs, record, dual) {
  const warnings = [];
  const parsed = parseLabSections(record, warnings);
  return { applied: applyLabSections(labs, parsed, dual), issues: warnings.length, warnings };
}

/** "Filter, Envelope, Additive and Phase & Stereo" for section keys; '' for none. */
export function labSectionsText(keys) {
  const names = Object.keys(LAB_SECTION_NAMES).filter((k) => (keys || []).includes(k))
    .map((k) => LAB_SECTION_NAMES[k]);
  if (names.length <= 1) return names.join('');
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}
