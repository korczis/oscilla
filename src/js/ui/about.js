// About's "What comes next" (U002, docs/ui-audit.md A15): the open milestones of the plan,
// bundled at build time from src/data/roadmap.json, which scripts/roadmap.mjs writes and
// release:prepare refreshes. Nothing is loaded at run time: the page stays one file, also
// from file://, and a commit that changes only the plan changes neither the roadmap nor dist.
import ROADMAP_DATA from '../../data/roadmap.json' with { type: 'json' };

const milestone = (m) => Object.freeze({
  id: String(m.id), title: String(m.title), done: Number(m.done), required: Number(m.required),
});

/** The roadmap the page shows: { milestones: [{ id, title, done, required }] }, frozen. */
export const ROADMAP = Object.freeze({
  milestones: Object.freeze((ROADMAP_DATA.milestones || []).map(milestone)),
});

/** The About part of the Alpine component. */
export function aboutPart() {
  return { ROADMAP };
}
