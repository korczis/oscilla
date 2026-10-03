// STUDIO deep link in the URL hash (spec §199 "URL state can open Studio and optionally a
// patch/project ID; no huge state in URLs", §200; plan V422). Pure.
//
// Format: three short hash parameters, the workspace in the V1 mode key `m` (the instrument
// codec, url-state.js, accepts only its V1 mode ids there and ignores `studio`):
//   m=studio            open the STUDIO workspace (required whenever st or sv is present)
//   st=<template id>    optionally open that SHIPPED template (studio/templates/index.js)
//   sv=<subview>        optionally show that subview: graph | timeline | inspector (the one
//                       dominant view below 768 px; wider layouts show all three)
// e.g. `#m=studio&st=filter-automation&sv=timeline`. A link never carries a graph, a project or
// a result: a document that is not an unmodified template is shared as an exported file (§200).
// It coexists with the instrument state (`v=1&m=<V1 mode>&…`) and the MEASURE recipe (`mr`):
// each codec reads only its own keys, and withoutStudioParams() lets another workspace's link
// drop these.
//
// Reading a link is an import of untrusted text, like the recipe link (url-state-measure.js):
// decodeStudioLink() refuses the whole link — never repairs or partly applies it — when a key
// is repeated, a value is empty, too long, not an id, or not a shipped template / known
// subview, or when st / sv come without m=studio. Applying it never starts playback
// (src/js/ui/studio/workspace.js studioApplyLinkHash).
//
//   encodeStudioLink({ templateId, subview }) -> string    (hash without '#')
//   decodeStudioLink(hash, { templateIds }) -> null        (no Studio link in the hash)
//                                            | { ok: true, templateId, subview }
//                                            | { ok: false, errors }
//   withoutStudioParams(hash) -> string                      (hash without '#', Studio keys out)

import { STUDIO_TEMPLATES, TEMPLATE_ID_PATTERN } from '../studio/templates/index.js';

export const STUDIO_LINK_MODE = 'studio';
export const STUDIO_LINK_KEYS = Object.freeze({ mode: 'm', template: 'st', subview: 'sv' });
/** The subviews a link may name (the same ids as workspace.js STUDIO_SUBVIEWS). */
export const STUDIO_LINK_SUBVIEWS = Object.freeze(['graph', 'timeline', 'inspector']);
/** Longest accepted value of any Studio key (characters); a template id has at most 48. */
export const STUDIO_LINK_MAX_CHARS = 64;

const shipped = () => STUDIO_TEMPLATES.map((t) => t.id);
const shown = (v) => JSON.stringify(String(v).slice(0, 32) + (String(v).length > 32 ? '…' : ''));

function params(hash) {
  try {
    return new URLSearchParams(String(hash || '').replace(/^#/, ''));
  } catch (e) {
    return new URLSearchParams();
  }
}

/** The hash (without '#') of a Studio view; the template only when one is given. */
export function encodeStudioLink({ templateId = null, subview = null } = {}) {
  const q = new URLSearchParams();
  q.set(STUDIO_LINK_KEYS.mode, STUDIO_LINK_MODE);
  if (templateId) q.set(STUDIO_LINK_KEYS.template, String(templateId));
  if (subview) q.set(STUDIO_LINK_KEYS.subview, String(subview));
  return q.toString();
}

/**
 * Decode and validate the Studio part of a location hash (with or without '#'). null when the
 * hash names no Studio link (no m=studio, st or sv); other keys are ignored. Never throws.
 * opts.templateIds: the template ids a link may open (default: every shipped template).
 */
export function decodeStudioLink(hash, { templateIds = shipped() } = {}) {
  const q = params(hash);
  const K = STUDIO_LINK_KEYS;
  const modes = q.getAll(K.mode);
  const hasTemplate = q.has(K.template);
  const hasSubview = q.has(K.subview);
  const studioMode = modes.includes(STUDIO_LINK_MODE);
  if (!studioMode && !hasTemplate && !hasSubview) return null;
  const errors = [];
  for (const k of [K.mode, K.template, K.subview]) {
    if (q.getAll(k).length > 1) errors.push(`"${k}" appears more than once`);
  }
  if (!studioMode) {
    errors.push(`a Studio template (${K.template}) or view (${K.subview}) needs `
      + `${K.mode}=${STUDIO_LINK_MODE}`);
  }
  let templateId = null;
  if (hasTemplate) {
    const v = q.get(K.template);
    if (v === '') errors.push('the template id is empty');
    else if (v.length > STUDIO_LINK_MAX_CHARS || !TEMPLATE_ID_PATTERN.test(v)) {
      errors.push(`${shown(v)} is not a template id`);
    } else if (!templateIds.includes(v)) {
      errors.push(`unknown Studio template ${shown(v)} (shipped: ${templateIds.join(', ')})`);
    } else templateId = v;
  }
  let subview = null;
  if (hasSubview) {
    const v = q.get(K.subview);
    if (!STUDIO_LINK_SUBVIEWS.includes(v)) {
      errors.push(`unknown Studio view ${shown(v)} (${STUDIO_LINK_SUBVIEWS.join(', ')})`);
    } else subview = v;
  }
  return errors.length ? { ok: false, errors } : { ok: true, templateId, subview };
}

/** The hash (without '#') without the Studio keys (`m` only when it is `studio`). */
export function withoutStudioParams(hash) {
  const q = params(hash);
  q.delete(STUDIO_LINK_KEYS.template);
  q.delete(STUDIO_LINK_KEYS.subview);
  if (q.getAll(STUDIO_LINK_KEYS.mode).includes(STUDIO_LINK_MODE)) q.delete(STUDIO_LINK_KEYS.mode);
  return q.toString();
}
