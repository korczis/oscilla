// The status bar's Play, a part of the workbench (ui/workbench.js composes it): what it shows,
// what it is named and what a click on it starts, read from the one per-place play-target table
// (core/play-target.js PLAY_TARGET, U127, C032). It stops whatever sounds, in every place: the
// sound survives a place change and the bar shows it and stops it (U133, Q114). Where the place
// has no play target and nothing sounds (Experiments, Learn, About) it is hidden.
//
//   statusPlayPart(svc) -> the members; svc: { stopAll?, stopPlayback, sequencerPlaying, labs }
import { OWNER } from '../core/output-bus.js';
import { MEASURE_TARGET, PLAY_ACTIONS, playTarget, statusPlayEveryWidth }
  from '../core/play-target.js';

/**
 * The status bar's layout class where its Play is shown at every width (C030): the 1536 px grid
 * gains the Play's column. One literal, so Tailwind's content scan of src/js finds it whole.
 */
const WIDE_GRID =
  '[@media(min-width:1536px)]:![grid-template-columns:auto_minmax(58px,134fr)_auto_auto_minmax(16px,213fr)_auto]';

export function statusPlayPart(svc) {
  return {
    // What the status Play stops: whatever sounds sounds on in every place (U133, Q114), so the
    // bar shows it and stops it: the tone, the sequence, held notes and the Studio transport
    // (U127: it used to leave the Studio out).
    get isSounding() {
      return this.playing || this.seqPlaying || this.notesSounding || this.studioPlaying;
    },
    /**
     * The status Play's row of the one play-target table (core/play-target.js PLAY_TARGET,
     * U127): what it starts in the place on screen.
     */
    get statusPlayTarget() { return playTarget(this.workspace).target; },
    /** The status Play is a Stop: something sounds, or the Synth is armed (its Arm is a play). */
    get statusPlayStops() { return this.isSounding || !!(this.synth && this.synth.armed); },
    /**
     * Whether the status bar's Play shows at desktop width too (C030): where the place's play
     * target has no Play of its own on screen (PLAY_TARGET ownPlay; the instrument workspaces
     * that lay out no Hold or Trigger, core/play-hints.js STATUS_PLAY_WORKSPACES).
     */
    get statusPlayShown() { return statusPlayEveryWidth(this.workspace); },
    /** Hidden where nothing plays (Experiments, Learn, About), unless something still sounds. */
    get statusPlayHidden() { return !this.statusPlayTarget && !this.statusPlayStops; },
    /**
     * The status Play's accessible name and title, in Czech (R2-C030-2): the word the prompts of
     * core/play-hints.js name it by ("Přehrát") begins each name a screen reader announces where
     * it plays the instrument; elsewhere it names its target (PLAY_ACTIONS), in Měření the
     * primary action it runs.
     */
    get statusPlayName() {
      if (this.statusPlayStops) return 'Zastavit přehrávání';
      const target = this.statusPlayTarget;
      if (target === OWNER.instrument) {
        return this.continuousAllowed && !this.isProgrammed ? 'Přehrát nepřetržitě' : 'Přehrát';
      }
      if (target === MEASURE_TARGET) {
        const a = this.meas && this.meas.flow && this.meas.flow.primaryAction;
        return (a && a.label) || 'Přehrát';
      }
      return (target && PLAY_ACTIONS[target].name) || 'Přehrát';
    },
    /** The status bar's own class: its 1536 px grid where the Play is shown there (C030). */
    get statusBarClass() { return this.statusPlayShown ? WIDE_GRID : ''; },

    /**
     * Status-bar play key: stop when anything sounds, else start the place's play target
     * (core/play-target.js PLAY_TARGET, U127): the instrument, the sequence, the Studio
     * transport, the Synth's Arm or Měření's primary action; nothing where the place has none.
     * Sounding is what the key shows (statusPlayStops) or the sequencer's live state (C001: the
     * `seqPlaying` copy lags by one poll); a stop goes through stopPlayback and starts nothing.
     */
    statusPlay() {
      if (this.statusPlayStops || svc.sequencerPlaying()) {
        // The status-bar stop is the playback bus's stopAll (C050), else the older stopPlayback.
        if (typeof svc.stopAll === 'function') svc.stopAll('status-stop');
        else svc.stopPlayback(this);
        return;
      }
      const target = this.statusPlayTarget;
      if (!target) return;
      const run = PLAY_ACTIONS[target].run;
      if (typeof this[run] === 'function') this[run]();
    },
    /** The instrument's status Play: latch (continuous allowed) or trigger. */
    statusPlayInstrument() {
      if (this.continuousAllowed && !this.isProgrammed) this.toggleLatch();
      else this.trigger();
    },
    /**
     * Play or stop the sequence (U127): the Sequencer's Space and its status Play, as the
     * Sequencer's Play and Stop do (the editor's togglePlay, then the panel shows it).
     */
    sequenceTogglePlay() {
      const seq = svc.labs && svc.labs.sequencer;
      if (!seq || !seq.editor) return false;
      const r = seq.editor.togglePlay();
      if (typeof seq.render === 'function') seq.render();
      return r;
    },
  };
}
