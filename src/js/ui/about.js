// About's "What comes next" (U002, docs/ui-audit.md A15): the open milestones of the plan,
// bundled at build time from src/data/roadmap.json, which scripts/roadmap.mjs writes and
// release:prepare refreshes. Nothing is loaded at run time: the page stays one file, also
// from file://, and a commit that changes only the plan changes neither the roadmap nor dist.
import ROADMAP_DATA from '../../data/roadmap.json' with { type: 'json' };

// The milestones are grouped by phase, now and next shown and later folded behind its count:
// a list of every open milestone on one screen shows none of them (Majordomus curated knowledge
// a-generator-that-can-list-everything-shows-everything).
const milestone = (m) => Object.freeze({
  id: String(m.id), title: String(m.title), done: Number(m.done), required: Number(m.required),
  phase: String(m.phase),
});

/** The phases in the order About shows them, with their headings. */
export const PHASES = Object.freeze(['now', 'next', 'later'].map((id) => Object.freeze({
  id, title: `${id[0].toUpperCase()}${id.slice(1)}`,
})));

const milestones = Object.freeze((ROADMAP_DATA.milestones || []).map(milestone));

/**
 * The roadmap the page shows, frozen: { release, milestones: [{ id, title, done, required,
 * phase }], phases: [{ id, title, milestones }], phase: { now, next, later } }, each phase's
 * milestones in the plan order; release is the version the roadmap was written at (U086).
 */
const phases = Object.freeze(PHASES.map((p) => Object.freeze({
  ...p, milestones: Object.freeze(milestones.filter((m) => m.phase === p.id)),
})));

export const ROADMAP = Object.freeze({
  release: String(ROADMAP_DATA.release ?? ''),
  milestones,
  phases,
  /** Each phase by its id, for the page's three lists: ROADMAP.phase.later.milestones. */
  phase: Object.freeze(Object.fromEntries(phases.map((p) => [p.id, p]))),
});

/** The About part of the Alpine component: the roadmap and whether Later is unfolded. */
export function aboutPart() {
  return { ROADMAP, aboutLaterOpen: false };
}
