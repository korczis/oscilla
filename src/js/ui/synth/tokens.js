// The shared synth-theme layer's colours (plan F013; dev-53's layer design; the token API agreed
// on 2026-11-02): one deep-frozen set of five groups read from OSCILLA's --osc-* custom properties
// (src/styles/tokens.css) at run time, so the light and dark themes differ only by the tokens.
// Nothing here is a colour literal (project.visual-identity-lock v3): a token the page lacks
// reads currentColor. New tokens go through the layer's owner.
//
//   synthTokens(el)    -> the set, read through getComputedStyle(el)
//   tokensFrom(lookup) -> the same set from a function name -> value (tests, no DOM)

/**
 * The --osc-* property of every role. The roles follow the Synth panel's (src/js/synth/view/
 * tokens.js): a jack ring and every cable colour are graphical objects that must hold 3:1 on
 * the card in both themes, so the cable palette is the panel's six (no --osc-orange, which is
 * 1.9:1 on the light card). The cable sheen has its own role (dev-53, 2026-11-02), drawn at
 * the hw-sheen intensity, so a theme can retune it without touching the control tokens. No
 * role is an intensity: an opacity, a texture or a glow is a hw-* Tailwind key the drawing
 * reads as a class (project.visual-identity-lock v4), and the cable shadow is an opaque token
 * drawn at the hw-shadow intensity (class opacity-hw-shadow), never with an alpha of its own.
 * Every control role but the decorative cap, cap highlight, knurl and LED bezel ring marks the
 * control or its value, so it holds 3:1 on both plate surfaces (surface-3 and surface-1) in both
 * themes, and the label and value text 4.5:1 (WCAG 1.4.11 and 1.4.3; ui-synth-tokens.test.mjs
 * computes them from tokens.css): the unlit arc or slot (track) and the skirt edge are
 * --osc-text-dim, the pointer --osc-text, the applied value --osc-purple; the knurl stays the
 * faint --osc-border, and an LED bezel's ring is --osc-border-strong, the strongest neutral on
 * the plates (led.js). The two depth roles (oscilla-21's amendment (a)-(e), 11-04) are drawn only
 * at an intensity class, never opaque: control.shade (--osc-hw-shade) at hw-shadow (the knob's
 * cap shadow, the XY pad's recess and puck shadow) and control.highlight (--osc-hw-highlight) at
 * hw-sheen (the XY puck's face), each visible, |ΔL*| >= 3, on the face it is drawn over in both
 * themes (ui-synth-tokens.test.mjs).
 */
export const SYNTH_TOKEN_NAMES = deepFreeze({
  surface: { plateHi: '--osc-surface-3', plateLo: '--osc-surface-1', card: '--osc-surface-2',
    edge: '--osc-bg' },
  text: { label: '--osc-text-muted', value: '--osc-text', dim: '--osc-text-dim' },
  control: { cap: '--osc-surface-1', capHi: '--osc-surface-4', ring: '--osc-cyan',
    track: '--osc-text-dim', pointer: '--osc-text', focus: '--osc-focus',
    disabled: '--osc-text-dim', edge: '--osc-text-dim', knurl: '--osc-border',
    applied: '--osc-purple', bezel: '--osc-border-strong', shade: '--osc-hw-shade',
    highlight: '--osc-hw-highlight' },
  jack: { body: '--osc-surface-0', ring: '--osc-text-dim', normal: '--osc-text-dim',
    refuse: '--osc-red' },
  cable: { palette: ['--osc-cyan', '--osc-red-soft', '--osc-magenta', '--osc-green',
    '--osc-purple', '--osc-blue'], shadow: '--osc-bg', sheen: '--osc-text' },
});

/** The paint every role falls back to when its token has no value. */
export const TOKEN_FALLBACK = 'currentColor';

function deepFreeze(o) {
  for (const v of Object.values(o)) if (v && typeof v === 'object') deepFreeze(v);
  return Object.freeze(o);
}

const read = (lookup, name) => {
  const raw = lookup(name);
  const value = typeof raw === 'string' ? raw.trim() : '';
  return value || TOKEN_FALLBACK;
};

/** The token set from `lookup(name) -> value`; a missing, empty or non-string value reads
 *  currentColor. */
export function tokensFrom(lookup) {
  if (typeof lookup !== 'function') {
    throw new TypeError('tokensFrom needs a lookup function (name -> value).');
  }
  const out = {};
  for (const [group, roles] of Object.entries(SYNTH_TOKEN_NAMES)) {
    out[group] = {};
    for (const [role, name] of Object.entries(roles)) {
      out[group][role] = Array.isArray(name) ? name.map((n) => read(lookup, n))
        : read(lookup, name);
    }
  }
  return deepFreeze(out);
}

/** The token set as `el` computes it; without an element or a DOM every role is currentColor. */
export function synthTokens(el) {
  const cs = el && typeof getComputedStyle === 'function' ? getComputedStyle(el) : null;
  return tokensFrom((name) => (cs ? cs.getPropertyValue(name) : ''));
}
