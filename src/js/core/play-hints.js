// C030: what a prompt says to press in the instrument workspaces whose only Play is the status
// bar's. Pure: no DOM, no audio.
//
// Analyzer, Filter Lab, Compare and Presets give Space to the instrument (ui/shortcuts.js
// SPACE_OWNER) but lay out no HOLD TO PLAY or TRIGGER: the status bar's Play is theirs at every
// width. The V1 prompts that name HOLD TO PLAY and TRIGGER are frozen (tests/unit/freeze.test.mjs
// against golden V1 outputs) and stay as they are wherever those controls exist; in these four
// workspaces each prompt is replaced, by workspace, with a sentence of its own that names the
// control on screen by its accessible name: the status Play is announced as "Přehrát",
// "Přehrát nepřetržitě" or "Zastavit přehrávání" (ui/workbench.js statusPlayName, R2-C030-2).
// tests/unit/workspace-play-visible.test.mjs holds the list equal to the workspaces SPACE_OWNER
// gives the instrument without the Source & Pattern panel.

/** The instrument workspaces whose Play is the status bar's (C030). */
export const STATUS_PLAY_WORKSPACES = Object.freeze(['analyzer', 'filter', 'compare', 'presets']);

/** The sentences there, by the frozen prompt each one stands in for. */
export const STATUS_PLAY_HINTS = Object.freeze({
  // url-state.js: a link restored ("Nothing plays until you press HOLD TO PLAY or TRIGGER.")
  restored: 'Nic nehraje, dokud nestisknete Přehrát ve stavovém řádku.',
  // instrument.js: the browser kept audio suspended ("... Press HOLD TO PLAY again.")
  suspended: 'Prohlížeč zatím nepovolil spuštění zvuku. Stiskněte znovu Přehrát ve stavovém '
    + 'řádku.',
  // ui/p5-views.js: the idle scope's caption ("press Hold to Play for the live trace")
  idle: 'živý průběh: Přehrát ve stavovém řádku',
  // ui/workbench.js: the idle scope's description ("Hold to Play shows the live output
  // analyser trace.")
  scope: 'Živý průběh analyzátoru výstupu ukáže Přehrát ve stavovém řádku.',
});

/** The notices' titles over those sentences, so a notice is one language (R2-C030-3). */
export const STATUS_PLAY_TITLES = Object.freeze({
  restored: 'Nastavení obnoveno z odkazu',
  suspended: 'Zvuk je pozastaven',
});

/**
 * The sentence that stands in for the frozen prompt `kind` in `workspace`, or null where the
 * frozen V1 text is true (HOLD TO PLAY and TRIGGER are on screen) or the workspace is unknown.
 */
export function statusPlayHint(workspace, kind) {
  if (!STATUS_PLAY_WORKSPACES.includes(workspace)) return null;
  return STATUS_PLAY_HINTS[kind] || null;
}

/** The title of the notice whose body is statusPlayHint(workspace, kind), or null. */
export function statusPlayTitle(workspace, kind) {
  if (!STATUS_PLAY_WORKSPACES.includes(workspace)) return null;
  return STATUS_PLAY_TITLES[kind] || null;
}
