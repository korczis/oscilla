// What the page shows for the frozen V1 sentences (U114, oscilla-c3 under Q090, 2026-11-15).
//
// The V1 outputs pinned by tests/freeze/golden-a7b7a23.json stay byte-exact as data: the
// prompts that name HOLD TO PLAY and TRIGGER and the pattern warning that quotes "Allow
// continuous playback". Those controls are now "Podržet a hrát", "Spustit" and "Povolit
// nepřetržité přehrávání", so the page never shows the frozen sentence: it shows the Czech one
// keyed by the exact frozen string, which names the control as it is on screen. One name per
// control. tests/unit/frozen-display.test.mjs derives the frozen sentences from the golden and
// holds that each one the page can show has its Czech form here.

/** The Czech sentence shown for each frozen V1 sentence, keyed by its exact text. */
export const FROZEN_DISPLAY = Object.freeze({
  'Nothing plays until you press HOLD TO PLAY or TRIGGER.':
    'Nic nehraje, dokud nestisknete Podržet a hrát nebo Spustit.',
  'Press and hold HOLD TO PLAY.': 'Stiskněte a držte Podržet a hrát.',
  'Press TRIGGER (or Space) to hear it.': 'Stiskněte Spustit (nebo mezerník) a uslyšíte to.',
  'Trigger duration': 'Délka spuštěné noty',
  'Continuous repeat needs “Allow continuous playback”; playing once.':
    'Nepřetržité opakování potřebuje „Povolit nepřetržité přehrávání“; zazní jednou.',
});

/**
 * `text` as the page shows it: every frozen V1 sentence in it replaced by its Czech form. A
 * notice may join a frozen sentence to others ("<dropped>. Nothing plays until ..."), so each
 * sentence is replaced where it stands; text with none is returned as it is.
 */
export function shownText(text) {
  if (typeof text !== 'string' || !text) return text;
  let out = text;
  for (const [frozen, shown] of Object.entries(FROZEN_DISPLAY)) {
    if (out.includes(frozen)) out = out.split(frozen).join(shown);
  }
  return out;
}
