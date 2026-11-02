// The "Loaded" notice of a preset (A1 connect, page audit 2026-11-02): pure, no DOM, no audio.
// core/instrument.js applyPreset gives it; tests/unit/cross-links.test.mjs judges it.

/**
 * What a preset's "Loaded" notice says, and the link it carries ({ message, action }). Where
 * HOLD TO PLAY and TRIGGER are on screen (the Playground, Synthesis) the V1 text stands. The
 * Presets page shows neither, so its notice says what plays the preset there (Space, which the
 * instrument owns in Presets: ui/shortcuts.js SPACE_OWNER) and links to the workspace whose
 * transport plays it: Synthesis for a dual-oscillator preset, the Playground for the others.
 * Load keeps the user in Presets, so presets can be tried one after another.
 */
export function presetLoadedNotice(mode, programmed, source) {
  if (mode !== 'presets') {
    return { message: programmed ? 'Press TRIGGER (or Space) to play it.'
      : 'Press and hold HOLD TO PLAY.', action: null };
  }
  const where = source === 'dual'
    ? { href: '#m=synthesis', text: 'Open Synthesis', name: 'Synthesis' }
    : { href: '#m=playground', text: 'Open the Playground', name: 'the Playground' };
  return {
    message: programmed ? `Press Space to play it here, or TRIGGER in ${where.name}.`
      : `Hold Space to play it here, or HOLD TO PLAY in ${where.name}.`,
    action: { href: where.href, text: where.text },
  };
}
