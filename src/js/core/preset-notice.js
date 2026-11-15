// The "Loaded" notice of a preset (A1 connect, page audit 2026-11-02): pure, no DOM, no audio.
// core/instrument.js applyPreset gives it; tests/unit/cross-links.test.mjs judges it.

/**
 * What a preset's "Loaded" notice says, and the link it carries ({ message, action }). Where
 * HOLD TO PLAY and TRIGGER are on screen (the Playground, Synthesis) the V1 text stands. The
 * Presets page shows neither, so its notice links to the workspace whose transport plays the
 * preset (Synthesis for a dual-oscillator preset, the Playground for the others) and says what
 * plays it: with a keyboard, Space, which the instrument owns in Presets (ui/shortcuts.js
 * SPACE_OWNER); under a coarse pointer (a phone or tablet, `coarse`), where there is no Space,
 * the link, so the sound starts from a tap on that workspace's own control. Load keeps the user
 * in Presets, so presets can be tried one after another.
 */
export function presetLoadedNotice(mode, programmed, source, coarse = false) {
  if (mode !== 'presets') {
    return { message: programmed ? 'Press TRIGGER (or Space) to play it.'
      : 'Press and hold HOLD TO PLAY.', action: null };
  }
  // Czech (U106, Q104): the workspace is named as the navigation names it (Syntéza,
  // Playground), declined inside the sentence and so without lang (c3 under Q090).
  const where = source === 'dual' // data-osc-link: alert.action (both)
    ? { href: '#m=synthesis', text: 'Otevřít Syntézu', name: 'Syntézu', in: 'v Syntéze' }
    : { href: '#m=playground', text: 'Otevřít Playground', name: 'Playground',
      in: 'v Playgroundu' };
  const control = programmed ? 'TRIGGER' : 'HOLD TO PLAY';
  let message = `Otevřete ${where.name} a zahrajte ho tlačítkem ${control}.`;
  if (!coarse) {
    message = programmed
      ? `Stiskněte mezerník a zazní tady, nebo stiskněte ${control} ${where.in}.`
      : `Podržte mezerník a zazní tady, nebo podržte ${control} ${where.in}.`;
  }
  return { message, action: { href: where.href, text: where.text } };
}
