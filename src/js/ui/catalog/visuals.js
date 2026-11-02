// The visual part of the UI catalogue, for the page (plan G001, rule
// project.visual-components-framed): the declarations of decl/visual.js as a catalogue the one
// frame (frame.js) reads through visuals(). registry.js holds the same declarations among all
// the others; importing this module instead keeps the rest of the catalogue out of the bundle.

import VISUAL_DECLARATIONS from './decl/visual.js';

export { VISUAL_DECLARATIONS };

export const VISUAL_CATALOG = Object.freeze({
  visuals: () => VISUAL_DECLARATIONS,
});
