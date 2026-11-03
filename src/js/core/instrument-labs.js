// The lab settings a V1 instrument record carries beside its cfg (C018): a custom preset and a
// History entry may hold `labs` (ui/config-file.js buildLabSections). V1 has no labs, so its
// hooks store and apply nothing and every V1 record and message is unchanged; V2
// (ui/workbench.js) replaces them with the ones that snapshot and restore the mounted labs.
// Kept apart from core/instrument.js so the instrument stays within its source-size cap.

/** The V1 hooks, spread into the instrument (plain methods, no getters). */
export const V1_LAB_HOOKS = Object.freeze({
  /** What the copied link restores (the toast and the copy dialog say it). V2: workbench.js */
  configLinkNote() { return 'The link restores these settings; it never starts playback.'; },
  /** The lab sections to store beside cfg (ui/config-file.js buildLabSections), or null. */
  labSnapshot() { return null; },
  /** Validate and apply stored lab sections: { applied: [section], issues }. */
  applyLabSnapshot() { return { applied: [], issues: 0 }; },
  /** "Filter, … settings restored too." for the sections applied ('' for none). */
  labsRestoredNote() { return ''; },
  /** What a saved preset holds beyond the instrument (the Save toast). */
  labsSavedNote() { return ''; },
});

/**
 * Restore the lab settings of a stored record (a preset, a History entry) through the
 * component's hooks, after its cfg. source: 'preset' | 'history'; issues: the cfg's invalid
 * values. Returns { issues, also }: those plus the lab sections refused, and the sentence naming
 * the sections restored ('' when the record holds none).
 */
export function restoreRecordLabs(cmp, record, source, issues = 0) {
  if (!record || !record.labs) return { issues, also: '' };
  const r = cmp.applyLabSnapshot(record.labs, source);
  return { issues: issues + r.issues, also: cmp.labsRestoredNote(r.applied) };
}
