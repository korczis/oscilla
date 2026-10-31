// Cross-links between workspaces (U010; UX link audit 2026-10-29, links.md B1, P3, P5, P8 and
// the one-way links). Every link here is an address the router already resolves
// (ui/navigation.js): a workspace (`#m=<id>`) or a Studio template (`#m=studio&st=<id>`, which
// core/url-state-studio.js validates and ui/studio/workspace.js applies without replacing
// unsaved work). No new route, no new state: the tables only say which address a workspace
// offers, and src/index.html writes each href literally so a link works before any script.
//
// A lab's Studio link opens the shipped template that does the lab's job as a Studio document.
// It names the template, never "this filter" or "this sound": the labs run the V1 engine and the
// template is a separate document, so nothing suggests shared state
// (project.studio-model-is-canonical, project.no-fake-science).

import { WORKSPACE_LABELS } from './shortcuts.js';

/**
 * The Studio template each lab offers: { id, from, template, title, osc }. `from` is the one
 * workspace that shows the link (its panel is also on the Playground grid, where the link is
 * hidden so the Playground keeps its layout), `osc` the link's data-osc name.
 */
export const STUDIO_TEMPLATE_LINKS = Object.freeze([
  Object.freeze({ id: 'filter', from: 'filter', template: 'filter-automation',
    title: 'Filter Automation', osc: 'filter.toStudio' }),
  Object.freeze({ id: 'synthesis', from: 'synthesis', template: 'subtractive-synth',
    title: 'Subtractive Synth', osc: 'envelope.toStudio' }),
  Object.freeze({ id: 'dual', from: 'synthesis', template: 'stereo-beat',
    title: 'Stereo Beat', osc: 'dual.toStudio' }),
  Object.freeze({ id: 'sequencer', from: 'sequencer', template: 'sweep-sequence',
    title: 'Sweep Sequence', osc: 'seq.toStudioTemplate' }),
  Object.freeze({ id: 'measure', from: 'measure', template: 'measurement-sweep',
    title: 'Measurement Sweep', osc: 'measure.toStudio' }),
]);

/** The address of a Studio template link. */
export function studioTemplateHref(template) {
  return `#m=studio&st=${template}`;
}

/** The visible text (and accessible name) of a lab's Studio link. */
export function studioTemplateText(link) {
  return `Open ${link.title} in Studio`;
}

/**
 * The workspace where each Learn topic's subject is the real tool, not a demo (P5). A topic
 * without an entry has none beyond its demo.
 */
export const LEARN_TOOLS = Object.freeze({
  harmonic: 'analyzer',
  samplerate: 'filter',
  fm: 'analyzer',
  interference: 'synthesis',
  beating: 'synthesis',
  hearing: 'compare',
  speakers: 'measure',
});

/** { workspace, href, text } of a Learn topic's tool link, or null. */
export function learnToolOf(topicId) {
  const workspace = Object.hasOwn(LEARN_TOOLS, topicId) ? LEARN_TOOLS[topicId] : null;
  if (!workspace) return null;
  return { workspace, href: `#m=${workspace}`, text: `Open ${WORKSPACE_LABELS[workspace]}` };
}

/** "the Playground", "the Sequencer", "Filter Lab": a workspace as a sentence names it. */
export function workspacePhrase(workspace) {
  const label = WORKSPACE_LABELS[workspace] || WORKSPACE_LABELS.playground;
  return workspace === 'playground' || workspace === 'sequencer' ? `the ${label}` : label;
}

/**
 * Where the Studio's Back button returns (P8): the workspace the Studio was opened from, the
 * Playground when it was opened at load or from nowhere known.
 */
export function studioBackTarget(from) {
  return from && from !== 'studio' && Object.hasOwn(WORKSPACE_LABELS, from) ? from : 'playground';
}

/**
 * The Filter Lab panel's ⤢ button (B1): on the Playground grid it opens the Filter Lab
 * workspace; in that workspace it returns to the Playground, and says so.
 */
export function filterLabToggle(workspace) {
  return workspace === 'filter'
    ? { to: 'playground', label: 'Back to the Playground', icon: '#i-left' }
    : { to: 'filter', label: 'Open the Filter Lab page', icon: '#i-expand' };
}

/** The action a Learn demo's notice carries: back to the lesson it came from. */
export function learnReturnAction(topic) {
  return { href: '#m=learn', text: `Back to the lesson: ${topic.title}` };
}

/** The Alpine members the markup binds to (composed by main.js). */
export function createCrossLinksUi() {
  return {
    learnToolOf(topicId) { return learnToolOf(topicId); },
    filterLabToggle() { return filterLabToggle(this.workspace); },
  };
}
