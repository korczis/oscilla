// The Synth patch bay (plan K063; design §3, §5): the generic patch bay of ui/patch/patch-bay.js
// over the panel's modules, in panel order. This file adapts the panel to the bay's source
// shape and keeps the names ui.js and the tests use.
//
//   panelSource(panel) -> { groups, nameOf }   every module with its jacks (panel.jacksOf)
//   bayLayout(panel, width), baySvg({ panel, ... }), jackLabel(panel, jack, state, verdict)

import { patchLayout, patchSvg, portLabel } from '../../ui/patch/patch-bay.js';

export {
  BAY_TEXT, JACK_HIT, JACK_PITCH, LABEL_MAX, ROW_PITCH, cablePath, sagOf, shortLabel,
} from '../../ui/patch/patch-bay.js';

const sources = new WeakMap();
export function panelSource(panel) {
  if (!sources.has(panel)) {
    sources.set(panel, { get groups() {
      return panel.modules.map((m) => ({ id: m.id, label: m.label, jacks: panel.jacksOf(m.id) }));
    }, nameOf: (id) => panel.module(id).label });
  }
  return sources.get(panel);
}

export const bayLayout = (panel, width) => patchLayout(panelSource(panel), width);
export const baySvg = ({ panel, ...rest }) => patchSvg({ source: panelSource(panel), ...rest });
export const jackLabel = (panel, j, st, verdict = null) => portLabel(panelSource(panel), j, st,
  verdict);
