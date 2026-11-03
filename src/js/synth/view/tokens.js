// The Synth panel's colours, read from OSCILLA's tokens (src/styles/tokens.css) through
// getComputedStyle, as the keyboard view reads its key colours. Nothing here is a colour
// literal (project.visual-identity-lock v3; tests/unit/synth-panel-tokens.test.mjs): a token
// the page lacks falls back to currentColor. The two themes differ only by the tokens.

/**
 * Token per role. A jack ring and every cable colour are graphical objects the player must see:
 * 3:1 or more on the bay card in both themes (WCAG 1.4.11), proved on the rendered page by
 * tests/browser/synth.cjs s-look. --osc-orange is not in the set: tokens.css keeps it for dark
 * text on orange fills, so on the white light-theme card it is 1.9:1; --osc-red-soft is the
 * red-orange hue that holds 3:1 in both themes.
 */
export const PANEL_TOKENS = Object.freeze({
  plateHi: '--osc-surface-3', plateLo: '--osc-surface-1',
  track: '--osc-border', accent: '--osc-cyan', dim: '--osc-text-dim', cap: '--osc-surface-1',
  capHi: '--osc-surface-4', edge: '--osc-bg', pointer: '--osc-text', label: '--osc-text-muted',
  text: '--osc-text', jack: '--osc-surface-0', jackRing: '--osc-text-dim',
  focus: '--osc-focus', normal: '--osc-text-dim', refuse: '--osc-red',
});
export const CABLE_TOKENS = Object.freeze(['--osc-cyan', '--osc-red-soft', '--osc-magenta',
  '--osc-green', '--osc-purple', '--osc-blue']);

export function panelTokens(el) {
  const cs = el && typeof getComputedStyle === 'function' ? getComputedStyle(el) : null;
  const v = (name) => (cs && cs.getPropertyValue(name).trim()) || 'currentColor';
  const out = {};
  for (const [k, name] of Object.entries(PANEL_TOKENS)) out[k] = v(name);
  out.cables = CABLE_TOKENS.map(v);
  return out;
}
