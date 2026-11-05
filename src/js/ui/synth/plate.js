// The synth-theme layer's module plate (plan F013, W1): the back of a Synth module card drawn
// as an old-school modular's front plate, decent and real (project.visual-identity-lock v4,
// Q071). Three things, all from tokens:
//   - the plate: a vertical gradient between two OSCILLA surface tokens;
//   - a brushed finish: fine horizontal hairlines in an SVG pattern, drawn at the hw-texture
//     intensity (class opacity-hw-texture, never a literal opacity);
//   - two screws in the lower corners: a cap and its cross slot, sized in CSS pixels so a stretched
//     plate never draws them oval. They are decoration: aria-hidden, no pointer.
// The plate takes no pointer and holds no text; its card stays a Flowbite Pro card.
//
//   plateSvg({ id, tokens }) -> markup: the plate's background, first child of its card
//   screwSvg({ side, tokens }) -> markup: one screw, absolutely placed ('left' | 'right')
//   tokens: { plateHi, plateLo, edge, dim } (synth/view/tokens.js panelTokens): the cap is the
//   dim token, so it stands off both plate surfaces, and its slot the edge token

const HIDDEN = 'aria-hidden="true" focusable="false"';

export function plateSvg({ id, tokens }) {
  const t = tokens;
  return `<svg class="pointer-events-none absolute inset-0 h-full w-full" `
    + `preserveAspectRatio="none" ${HIDDEN} data-plate="${id}"><defs>`
    + `<linearGradient id="pg-${id}" x1="0" y1="0" x2="0" y2="1">`
    + `<stop offset="0" stop-color="${t.plateHi}"/><stop offset="1" stop-color="${t.plateLo}"/>`
    + `</linearGradient><pattern id="pb-${id}" width="6" height="3" `
    + 'patternUnits="userSpaceOnUse">'
    + `<path d="M0 0.5H6M0 2H4" stroke="${t.edge}" stroke-width="0.6" fill="none"/></pattern>`
    + `</defs><rect width="100%" height="100%" fill="url(#pg-${id})" stroke="none"/>`
    + `<rect width="100%" height="100%" fill="url(#pb-${id})" stroke="none" `
    + 'class="opacity-hw-texture" data-finish="brushed"/></svg>'
    + screwSvg({ side: 'left', tokens }) + screwSvg({ side: 'right', tokens });
}

export function screwSvg({ side, tokens }) {
  const t = tokens;
  const at = side === 'right' ? 'right-0.5' : 'left-0.5';
  // A cross head, so it reads as a screw and never as a resize grip (p2's W1b review, V5).
  const slot = side === 'right' ? 'M5 2.4V7.6M2.4 5H7.6' : 'M3.2 3.2L6.8 6.8M6.8 3.2L3.2 6.8';
  return `<svg class="pointer-events-none absolute bottom-0.5 ${at} h-2.5 w-2.5" `
    + `viewBox="0 0 10 10" ${HIDDEN} data-screw="${side}">`
    + `<circle cx="5" cy="5" r="4.2" fill="${t.dim}" stroke="${t.edge}" stroke-width="0.8"/>`
    + `<path d="${slot}" stroke="${t.edge}" stroke-width="1.2" stroke-linecap="round" `
    + 'fill="none"/></svg>';
}
