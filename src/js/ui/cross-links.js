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
import { CONTENT_LINKS, livePanelLinks } from './counterparts.js';
import { WORKSPACE_IDS, relatedOf, relatedRef, workspaceOf } from './shell.js';
import { getTemplate } from '../studio/templates/index.js';

/** The template id a related entry's address names (`studio&st=<id>`), or null. */
export function templateOfRef(ref) {
  const m = /^studio&st=([a-z][a-z0-9-]*)$/.exec(ref);
  return m ? m[1] : null;
}

/**
 * The Studio template each lab offers: { id, from, template, title, osc }, generated from the
 * registry's related entries that name a template (ui/counterparts.js PANEL_LINKS says where
 * each is written). `from` is the one workspace that shows the link (its panel is also on the
 * Playground grid, where the link is hidden so the Playground keeps its layout), `osc` the
 * link's data-osc name, `title` the template's own (Studio names it so), `id` the panel's.
 */
export const STUDIO_TEMPLATE_LINKS = Object.freeze(livePanelLinks()
  .filter((l) => templateOfRef(l.to) && getTemplate(templateOfRef(l.to)))
  .map((l) => Object.freeze({ id: l.osc.split('.')[0], from: l.from[0],
    template: templateOfRef(l.to), title: getTemplate(templateOfRef(l.to)).title,
    osc: l.osc, ...(l.text ? { text: l.text } : {}) })));

/**
 * The text of a related entry's link in the page header: "Filter Automation in Studio" for a
 * Studio template, else the target workspace's label.
 */
export function relatedText(r) {
  const t = templateOfRef(`${r.id}${r.hash || ''}`);
  const tpl = t ? getTemplate(t) : null;
  return tpl ? `${tpl.title} in Studio` : (WORKSPACE_LABELS[r.id] || r.id);
}

/** The address of a Studio template link. */
export function studioTemplateHref(template) {
  return `#m=studio&st=${template}`;
}

/** The visible text (and accessible name) of a lab's Studio link: its own, else the default. */
export function studioTemplateText(link) {
  return link.text || `Open ${link.title} in Studio`;
}

/**
 * The workspace where each Learn topic's subject is the real tool, not a demo (P5; A1 connect:
 * every topic that teaches a tool links to it). A topic is either here or in LEARN_NO_TOOL with
 * the reason it has none beyond its demo (tests/unit/cross-links.test.mjs holds the two tables
 * to LEARN_TOPICS).
 */
export const LEARN_TOOLS = Object.freeze({
  waveform: 'analyzer',
  harmonic: 'analyzer',
  nyquist: 'analyzer',
  samplerate: 'filter',
  aliasing: 'analyzer',
  modulation: 'synth',
  am: 'synth',
  fm: 'synth',
  interference: 'synthesis',
  beating: 'synthesis',
  logscale: 'measure',
  hearing: 'compare',
  ultrasound: 'compare',
  speakers: 'measure',
});

/** The Learn topics without a tool link, each with the reason. */
export const LEARN_NO_TOOL = Object.freeze({
  frequency: 'a quantity the demo plays; every tool shows it',
  period: 'a quantity the demo shows; every tool shows it',
  wavelength: 'a property of sound in air, which no tool here computes',
  amplitude: 'a relative digital level the demo shows, not a calibrated one',
  'semi-modular-voice': 'its demo opens the Synth itself',
  'synthesis-engines': 'its demo opens the Synth\'s Engines tab itself',
});

/**
 * The routes (relatedRef form: `<id><hash>`) a workspace's own content already links to: its
 * panel and content links (ui/counterparts.js PANEL_LINKS, CONTENT_LINKS), About's workspace
 * list, Learn's tool links, the page's empty-state action, and the Playground, which the page
 * header's breadcrumb root links to on every page. The page header's Related strip leaves these
 * out (pageRelatedOf), so each target appears once per screen.
 */
export function contentRoutesOf(ws) {
  const out = new Set(['playground']);
  for (const l of [...livePanelLinks(), ...CONTENT_LINKS]) if (l.from.includes(ws)) out.add(l.to);
  if (ws === 'about') WORKSPACE_IDS.filter((id) => id !== 'about').forEach((id) => out.add(id));
  if (ws === 'learn') Object.values(LEARN_TOOLS).forEach((id) => out.add(id));
  const w = workspaceOf(ws);
  if (w && w.empty && w.empty.action) out.add(w.empty.action.to);
  return out;
}

/** The related entries the page header shows: the registry's, less the content's routes. */
export function pageRelatedOf(ws) {
  const shown = contentRoutesOf(ws);
  return relatedOf(ws).filter((r) => !shown.has(relatedRef(r)));
}

/** { workspace, href, text } of a Learn topic's tool link, or null. */
export function learnToolOf(topicId) {
  const workspace = Object.hasOwn(LEARN_TOOLS, topicId) ? LEARN_TOOLS[topicId] : null;
  if (!workspace) return null;
  // data-osc-link: learn.tool
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
  // data-osc-link: alert.action
  return { href: '#m=learn', text: `Back to the lesson: ${topic.title}` };
}

/** The Alpine members the markup binds to (composed by main.js). */
export function createCrossLinksUi() {
  return {
    learnToolOf(topicId) { return learnToolOf(topicId); },
    filterLabToggle() { return filterLabToggle(this.workspace); },
  };
}
