// Integration layer of the OSCILLA component: the members the V2 markup binds to on top of the
// V1 instrument (core/instrument.js) and the visual shell (ui/app.js). Composed into ONE Alpine
// component by main.js (Object.defineProperties, never spread). Audio objects, labs and p5
// hosts live in `svc` (a closure), never in reactive state.
//
// svc: { engine, bridge, labs, exportConfigDoc(cmp),
//        applyImport(cmp, parsed) -> { issues, notes[], limited },
//        renderWav(cmp, kind), screenshot(cmp), relayout(), stopPlayback(cmp),
//        sequencerPlaying() }

import {
  MAX_OUTPUT_GAIN, MAX_PROGRAMMED_S, STORAGE_KEYS, WAVEFORM_LABELS,
} from '../core/constants.js';
import { clamp, round } from '../core/math.js';
import {
  formatFrequency, formatMs, frequencyToNormalized, normalizedToFrequency,
} from '../core/frequency.js';
import { midiToFrequency, nearestNote, formatCents } from '../core/music.js';
import { gainLevelDb } from '../core/config.js';
import { SWEEP_PARAMS } from '../audio/patterns.js';
import { LEARN_VIZ_TARGETS } from '../data/learn.js';
import { additiveHarmonicTable, harmonicTable } from '../visualization/harmonics.js';
import { totalDurationMs } from '../sequencer/model.js';
import { sequenceDigest } from '../sequencer/editor.js';
import { scopeWindow } from './p5-views.js';
import { OUTPUT_OWNER_NAMES, outputOwnerOf } from '../visualization/output-owner.js';
import { OSCILLA_VERSION } from './version.js';
import { formatHz } from '../charts/axes.js';
import { rovingKeydown } from './app.js';
import { parseConfigImport, exportFileName, importNotice } from './config-file.js';
import { downloadBlob, readFileText } from './exporters.js';
import { focusSafely, isFocusable } from './dialogs.js';
import { sessionStore } from '../core/storage.js';
import { learnReturnAction, learnToolOf } from './cross-links.js';

const GROUP = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
const GROUP2 = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const GROUP1 = new Intl.NumberFormat('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

/** "15,500" style number for the big readout (precision grows below 100 Hz). */
export function groupedHz(f) {
  if (!Number.isFinite(f)) return '—';
  if (f < 100) return GROUP2.format(f);
  if (f < 1000 && Math.abs(f - Math.round(f)) >= 0.05) return GROUP1.format(f);
  return GROUP.format(f);
}

/** Workspace <-> V1 mode id: one mapping, in ui/navigation.js (ADR 0045). */
export { v1ModeFor, workspaceForV1Mode } from './navigation.js';

export const SWEEP_FORM = SWEEP_PARAMS;

/**
 * Bump app.seqRev after every change of the sequence (C004). The editor's model stays outside
 * Alpine; the readouts that derive from it (statusDurationText) read the counter instead.
 * Returns the unsubscribe function.
 */
export function followSequenceEdits(app, editor) {
  return editor.onChange(() => { app.seqRev += 1; });
}

/** T001: the state shown while the output ceiling flattens the signal (ADR 0002). */
export const CEILING_TEXT = 'OUTPUT AT CEILING (clipped)';
const CEILING_DB_TEXT = `${gainLevelDb(MAX_OUTPUT_GAIN).toFixed(1)} dBFS`;

export function createWorkbench(svc) {
  return {
    OSCILLA_VERSION,
    SWEEP_FORM,
    rovingKeydown,
    timeWindowMs: 5,
    announceText: '',
    seqPlaying: false,
    // The sequence's digest now and at its last load, import or export (C019): main.js updates
    // seqDigest from the editor's onChange, markSequenceSaved() sets both.
    seqDigest: '',
    seqSavedDigest: '',
    exportBusy: false,
    importErrors: [],
    lastPattern: null,
    fullscreen: '',
    learnOpen: 'frequency',
    // T001: set by main.js when the bridge reports that the output ceiling starts or stops
    // flattening the signal (the engine's pre-ceiling tap); never per frame.
    outputAtCeiling: false,
    ceilingText: CEILING_TEXT,
    // Bumped by main.js when a lab changes (getters below that read lab state depend on it).
    labRev: 0,
    // Bumped on every change of the sequence (followSequenceEdits; its model is not reactive).
    seqRev: 0,

    // ------------------------------------------------------------------ readouts
    get freqMain() { return groupedHz(this.frequency); },
    get freqAlt() {
      if (this.noteMode) {
        const n = nearestNote(this.frequency, this.a4);
        return n ? `${n.name} ${formatCents(n.cents)}` : '—';
      }
      if (!this.usesGlobalFrequency && this.source !== 'dual') return `pattern ${this.readoutText}`;
      return formatFrequency(this.frequency);
    },
    get freqSliderValue() {
      return Math.round(clamp(frequencyToNormalized(clamp(this.frequency, this.rangeMin,
        this.rangeMax), this.rangeMin, this.rangeMax), 0, 1) * 1000);
    },
    get freqSliderFill() { return `${(this.freqSliderValue / 10).toFixed(1)}%`; },
    // Slider end labels: compact ("20 Hz", "20 kHz", "22.8 kHz"), like the chart axes.
    get rangeMinText() { return formatHz(this.rangeMin); },
    get rangeMaxText() { return formatHz(this.rangeMax); },
    get gainDb() { return gainLevelDb(this.gainLevel); },
    get gainDbText() {
      const db = this.gainDb;
      return Number.isFinite(db) ? `${db.toFixed(1)} dB` : '-∞ dB';
    },
    get gainFill() { return `${this.gainPct}%`; },
    // The instrument's own Play (ADR 0050): the status Play button triggers, latches or stops the
    // instrument and the Pattern Sequencer, never the Studio, so it reflects only them.
    get isSounding() { return this.playing || this.seqPlaying; },
    /**
     * Who owns the one output now ('instrument' | 'sequencer' | 'studio' | null), for the views
     * that describe it (C013). The Studio is read through its transport (studioOwnsOutput);
     * studio.playing, the workspace's mirror of the transport's state events, only makes the
     * getter reactive.
     */
    get outputOwner() {
      const st = this.studio;
      const studio = !!(st && st.playing) && (typeof this.studioOwnsOutput !== 'function'
        || this.studioOwnsOutput());
      return outputOwnerOf({ instrument: this.playing, sequencer: this.seqPlaying, studio });
    },
    /** The ceiling acts on what sounds now (idle shows nothing, whatever the tap read last). */
    get ceilingActing() { return this.outputAtCeiling && this.isSounding; },
    /** The gain readout is the master setpoint, not the level the output carries. */
    get gainTitle() {
      return `Gain setpoint ${this.gainDbText} (logical gain ${this.gainLevel.toFixed(3)} re `
        + `digital full scale), not the output level: it leaves out the envelope and filter `
        + `before it and the limiter and ${CEILING_DB_TEXT} output ceiling after it; `
        + 'relative, not SPL.'
        + (this.ceilingActing ? ` Now: ${CEILING_TEXT}, the ceiling flattens the output.` : '');
    },
    /** Whether the Studio transport plays (cmp.studio, the workspace's plain view state). */
    get studioPlaying() { return !!(this.studio && this.studio.playing); },
    /** Anything audible from this page: the status state and its dot (C012). */
    get anySounding() { return this.isSounding || this.studioPlaying; },
    /**
     * The Studio's Master Output level while it holds the engine's master level, else null.
     * cmp.studio.masterLevel mirrors the runtime's 'master' events (a number, never an engine
     * object); a later write by anyone else (engine.masterWrites moved: the Playground's gain,
     * resetDefaults) supersedes it.
     */
    get studioMasterLevel() {
      const s = this.studio;
      if (!s || !s.playing || !Number.isFinite(s.masterLevel)) return null;
      void this.gainLevel; // re-read when the Playground gain is written
      const e = svc.engine;
      if (e && Number.isInteger(e.masterWrites) && Number.isInteger(s.masterWrites)
        && e.masterWrites !== s.masterWrites) return null;
      return s.masterLevel;
    },
    get holdLabel() {
      if (this.status === 'SUSPENDED') return 'Waiting for audio';
      if (this.playing && this.releasing) return 'Releasing';
      if (this.playing) return this.latched ? 'Playing (latched)' : 'Playing';
      return 'Hold to Play';
    },
    get statusLabel() {
      if (this.status === 'ERROR') return 'ERROR';
      if (this.status === 'SUSPENDED') return 'SUSPENDED';
      if (this.playing) return this.releasing ? 'RELEASING' : 'PLAYING';
      if (this.seqPlaying || this.studioPlaying) return 'PLAYING';
      return this.status === 'READY' ? 'READY' : 'STOPPED';
    },
    get statusFreqText() {
      if (this.seqPlaying && !this.playing) return 'sequence';
      if (this.studioPlaying && !this.playing) return 'studio';
      if (this.source === 'dual') return `${groupedHz(this.dualFa)} / ${groupedHz(this.dualFb)} Hz`;
      const f = this.playing && this.instFreq != null ? this.instFreq : this.metricFrequencyIdle;
      return `${groupedHz(f)} Hz`;
    },
    get statusWaveText() {
      if (this.seqPlaying && !this.playing) {
        // C003: the sequence plays its own waveform; the Additive lab shapes the instrument only.
        const seq = svc.labs && svc.labs.sequencer;
        const w = seq && seq.editor && seq.editor.model ? seq.editor.model.waveform : this.waveform;
        return WAVEFORM_LABELS[w] || 'Sine';
      }
      if (this.source === 'dual') {
        return `${WAVEFORM_LABELS[this.dual.a.wave]} + ${WAVEFORM_LABELS[this.dual.b.wave]}`;
      }
      return this.additiveOn ? 'Additive' : (WAVEFORM_LABELS[this.waveform] || 'Sine');
    },
    get statusPatternText() {
      if (this.seqPlaying && !this.playing) return 'Sequencer';
      if (this.studioPlaying && !this.playing) return 'Studio';
      if (this.source === 'dual') return this.dual.stereo ? 'Dual (stereo)' : 'Dual (mono)';
      if (this.source === 'sweep') return `Sweep (${this.sweep.curve})`;
      const p = this.currentPattern;
      const pp = this.pp[this.pattern];
      if (pp && pp.curve) return `${p.label} (${pp.curve})`;
      return p.label;
    },
    get statusDurationText() {
      if (this.seqPlaying && !this.playing) {
        // The sequence plays, not the instrument plan: its own length (loops repeat it).
        void this.seqRev;
        const seq = svc.labs && svc.labs.sequencer;
        const model = seq && seq.editor && seq.editor.model;
        if (model) {
          const loop = model.loop ? ' (loop)' : '';
          // Edits during playback apply from the next pass: while the sounding pass is longer
          // or shorter than the edited sequence, both lengths (sequencer-panel passStatus).
          const pass = typeof seq.passStatus === 'function' ? seq.passStatus() : null;
          const now = pass ? formatMs(pass.soundingS * 1000) : '';
          const next = formatMs(totalDurationMs(model));
          if (pass && now !== next) return `${now} now, next ${next}${loop}`;
          return `${next}${loop}`;
        }
      }
      const p = this.planSummary;
      if (p && p.kind === 'continuous') return 'until stopped';
      if (p && p.kind === 'finite' && this.source === 'single' && this.pattern === 'finite'
        && !this.continuousAllowed && p.dur > this.safetyLimit) {
        return `${this.safetyLimit} s (limited)`;
      }
      if (p && p.kind === 'finite' && Number.isFinite(p.dur)) return formatMs(p.dur * 1000);
      if (this.continuousAllowed) return 'no limit';
      return `≤ ${this.safetyLimit} s`;
    },
    get statusGainText() {
      // The level actually in effect: the Studio's Master Output while it holds the master stage
      // (C012), otherwise the Playground gain. Never written into gainLevel: the gainLevel $watch
      // would echo it into the engine and end the Studio's hold on it.
      const m = this.studioMasterLevel;
      if (m === null) return `Gain ${this.gainDbText}`;
      const db = gainLevelDb(m);
      return `Master ${Number.isFinite(db) ? `${db.toFixed(1)} dB` : '-∞ dB'}`;
    },
    get vizSummaryHarm() {
      const wave = this.source === 'dual' ? this.dual.a.wave : this.waveform;
      const f = this.source === 'dual' ? this.dualFa : this.metricFrequencyIdle;
      void this.labRev;
      const add = svc.labs && svc.labs.additive;
      if (this.additiveOn && this.source !== 'dual' && add) {
        return additiveHarmonicTable(add.coefficients(), f, this.nyquist).summary || 'unavailable';
      }
      return harmonicTable(wave, f, this.nyquist).summary || 'unavailable';
    },
    /** The scope window actually shown while playing (the analyser buffer may not fill it). */
    get scopeShownMs() {
      const an = svc.engine && svc.engine.analyser;
      const f = this.source === 'dual' ? this.dualFa : this.metricFrequency;
      const w = scopeWindow({ requestedMs: this.timeWindowMs, bufferLength: an ? an.fftSize : 0,
        sampleRate: this.effectiveSampleRate, freqHz: f });
      return w.ms;
    },
    /**
     * Accessible description of the primary analysis canvas (there is no visible caption: the
     * V1 vizCaption describes V1's slowed wave model, which V2 does not draw). It says what the
     * view actually renders, including the min/max band the scope switches to when a tone has
     * fewer than 4 samples per cycle (V1 rule).
     */
    get analysisCanvasLabel() {
      const tab = this.tabs.analysis;
      if (tab === 'harmonics') {
        if (this.additiveOn && this.source !== 'dual') {
          return `Additive synthesis spectrum, the PeriodicWave coefficients that play, not `
            + `measured: ${this.vizSummaryHarm}. Actual speaker output is unknown.`;
        }
        return `Theoretical oscillator spectrum, computed from the waveform, not measured: ${
          this.vizSummaryHarm}. Actual speaker output is unknown.`;
      }
      if (tab === 'signalPath') {
        return 'Active Web Audio processing graph. Speaker output is outside what the browser '
          + 'can observe.';
      }
      const w = `${this.timeWindowMs} ms window`;
      const f = this.source === 'dual' ? this.dualFa : this.metricFrequency;
      const sr = this.effectiveSampleRate;
      const owner = this.outputOwner;
      if (owner && owner !== 'instrument') {
        // Another source sounds through the same output analyser: its trace, at full scale.
        const an = svc.engine && svc.engine.analyser;
        const sw = scopeWindow({ requestedMs: this.timeWindowMs,
          bufferLength: an ? an.fftSize : 0, sampleRate: sr, freqHz: 0 });
        const lw = sw.limited
          ? `${Math.round(sw.ms)} ms window (the analyser buffer limit; ${this.timeWindowMs} ms `
            + 'requested)'
          : w;
        return `Live output analyser waveform (${OUTPUT_OWNER_NAMES[owner]}) over a ${lw}, `
          + 'relative to full scale.';
      }
      if (owner !== 'instrument') {
        const wave = this.source === 'dual' ? this.dual.a.wave : this.waveform;
        return `Waveform, not playing: computed ${wave} at ${formatFrequency(f)} over a ${w}. `
          + 'Hold to Play shows the live output analyser trace.';
      }
      const sparse = f > 0 && sr > 0 && sr / f < 4;
      const shown = this.scopeShownMs;
      const lw = shown < this.timeWindowMs - 0.05
        ? `${Math.round(shown)} ms window (the analyser buffer limit; ${this.timeWindowMs} ms `
          + 'requested)'
        : w;
      return `Live output analyser waveform over a ${lw}, scaled to the set gain${sparse
        ? `; drawn as a min/max band because ${formatFrequency(f)} has fewer than 4 samples `
          + `per cycle at ${sr} Hz` : ''}.`;
    },
    get patternSelectValue() { return this.source === 'sweep' ? '__sweep' : this.pattern; },
    get additiveOn() { return !!this.labFlags.additive; },
    labFlags: { additive: false, envelope: false, filter: false },

    // ------------------------------------------------------------------ source panel
    onFreqSlider(raw) {
      let f = normalizedToFrequency(clamp(Number(raw) / 1000, 0, 1), this.rangeMin, this.rangeMax);
      if (this.noteMode) {
        const n = nearestNote(f, this.a4);
        if (n) f = midiToFrequency(n.midi, this.a4);
      }
      this.setFrequency(round(f, 2), { silent: true });
    },
    stepFine(kind) {
      switch (kind) {
        case '-1oct': this.stepOctave(-1); break;
        case '+1oct': this.stepOctave(1); break;
        case '-1st': this.stepSemitone(-1); break;
        case '+1st': this.stepSemitone(1); break;
        case '-10hz': this.stepHz(-10); break;
        case '+10hz': this.stepHz(10); break;
        default: break;
      }
    },
    onPatternSelect(value) {
      if (value === '__sweep') { this.source = 'sweep'; return; }
      this.setPattern(value);
      if (value !== 'tone') this.lastPattern = value;
    },
    /** Shell segmented control Oscillator | Pattern. */
    onSourceKind(kind) {
      if (kind === 'oscillator') {
        if (this.source === 'single' && this.pattern !== 'tone') this.lastPattern = this.pattern;
        this.setPattern('tone');
      } else if (this.source === 'single' && this.pattern === 'tone' && this.lastPattern) {
        this.setPattern(this.lastPattern);
      }
    },
    sweepValue(d) {
      const v = this.sweep[d.key];
      if (d.type === 'freq') return formatFrequency(v);
      if (d.key === 'durationMs') return String(v / 1000);
      return v;
    },
    setSweepField(d, raw) {
      this.loadedLabel = '';
      if (d.type === 'freq') this.setSweepFreq(d.key, raw);
      else if (d.key === 'durationMs') this.setSweepDuration(raw);
      else if (d.type === 'select') this.sweep[d.key] = raw;
    },
    sweepLabel(d) { return d.key === 'durationMs' ? 'Duration (s)' : d.label; },
    /** paramErrors key of a sweep field (setSweepFreq, setSweepDuration); null for a select. */
    sweepErrorKey(d) {
      if (d.type === 'freq') return `sweep-${d.key}`;
      return d.key === 'durationMs' ? 'sweep-duration' : null;
    },
    // One field template renders the pattern parameters and the sweep form (T003), so every
    // field, sweep or pattern, shows its own error beside it.
    get ppSweep() { return this.source === 'sweep'; },
    get ppFields() { return this.ppSweep ? SWEEP_FORM : this.currentPattern.params; },
    ppId(d) { return this.ppSweep ? `sw-${d.key}` : this.paramId(d); },
    ppLabel(d) { return this.ppSweep ? this.sweepLabel(d) : d.label; },
    ppAriaLabel(d) { return this.ppSweep ? null : d.label + this.paramUnit(d); },
    ppValue(d) { return this.ppSweep ? this.sweepValue(d) : this.paramValue(d); },
    ppSet(d, raw) {
      if (this.ppSweep) this.setSweepField(d, raw);
      else this.setParam(d, raw);
    },
    ppErrorKey(d) { return this.ppSweep ? this.sweepErrorKey(d) : this.paramId(d); },
    ppError(d) {
      const key = this.ppErrorKey(d);
      return (key && this.paramErrors[key]) || '';
    },
    ppErrorId(d) { return `${this.ppId(d)}-error`; },

    // ------------------------------------------------------------------ transport extras
    /**
     * Status-bar play key: stop when sounding, else latch (continuous allowed) or trigger.
     * Sounding is what the key shows (isSounding) or the sequencer's live state (C001: the
     * `seqPlaying` copy lags by one poll); a stop goes through stopPlayback and starts nothing.
     */
    statusPlay() {
      if (this.isSounding || svc.sequencerPlaying()) {
        svc.stopPlayback(this);
        return;
      }
      if (this.continuousAllowed && !this.isProgrammed) this.toggleLatch();
      else this.trigger();
    },
    onContinuousToggle() {
      // C011: setContinuous tells the sequencer (main.js onContinuousChange): its loop follows
      // the permission and its Loop control restates the cap.
      this.setContinuous(!this.continuousAllowed);
      this.notify('info', this.continuousAllowed ? 'Continuous playback allowed'
        : 'Hard limit active', this.continuousAllowed
        ? 'Hold, latch and a looped sequencer sequence play until stopped. Keep the level low.'
        : `Hold, trigger and the finite tone stop after ${this.safetyLimit} s; a looped `
          + `sequencer sequence stops at ${MAX_PROGRAMMED_S} s.`);
    },
    // setSafetyLimit is the instrument's (core/instrument.js): it reaches the sounding voice.

    // ------------------------------------------------------------------ dual oscillator
    setDualSource(on) {
      if (on) this.source = 'dual';
      else if (this.source === 'dual') this.source = 'single';
    },
    onDualRoute(route) { this.setStereo(route === 'stereo'); },
    toggleBinaural() { this.requestBinaural(!this.dual.binaural); },
    dualPresets() { return this.presetsFor('dual'); },
    cancelHeadphones() {
      this.pendingPreset = null;
      this.closeModal('headphonesModal');
    },

    // ------------------------------------------------------------------ focus-safe removals
    /** Dismiss a notification and move focus to its neighbour (never to <body>). */
    // ------------------------------------------------------------------ safety notice
    /**
     * Dismiss the first-run safety notice (instrument.collapseSafety stores the collapsed state
     * under STORAGE_KEYS.safetySeen). Focus moves to the reopen control (Device & Limits), or to
     * the overflow menu button where that panel is not shown; never to <body>.
     */
    dismissSafety() {
      this.collapseSafety();
      this.$nextTick(() => {
        // One reopen control per layout (Device & Limits header; Source header on phones):
        // hand focus to whichever is visible.
        const reopen = [...document.querySelectorAll('[data-osc="safety.reopen"]')]
          .find((el) => isFocusable(el));
        focusSafely(reopen || document.getElementById('osc-overflow'));
      });
    },
    /** Show the safety notice again and focus its dismiss button. */
    reopenSafety() {
      this.safetyCollapsed = false;
      this.safetyExpanded = false;
      sessionStore.set(STORAGE_KEYS.safetySeen, '0');
      // x-show may reveal the notice a frame later in some browsers: wait until the dismiss
      // button can take focus (a few frames at most), then fall back safely.
      const dismiss = document.querySelector('[data-osc="safety.dismiss"]');
      let tries = 0;
      const go = () => {
        if (!isFocusable(dismiss) && tries++ < 6) { requestAnimationFrame(go); return; }
        focusSafely(dismiss);
        if (dismiss && dismiss.scrollIntoView) dismiss.scrollIntoView({ block: 'nearest' });
      };
      this.$nextTick(go);
    },
    dismissAlertFocus(id, e) {
      const item = e && e.currentTarget && e.currentTarget.closest('.osc-toast');
      const hadFocus = item && item.contains(document.activeElement);
      const list = item ? [...item.parentElement.querySelectorAll('.osc-toast')] : [];
      const i = list.indexOf(item);
      const next = list[i + 1] || list[i - 1] || null;
      this.dismissAlert(id);
      if (!hadFocus) return;
      this.$nextTick(() => {
        const btn = next && next.isConnected ? next.querySelector('button') : null;
        focusSafely(btn);
      });
    },
    /** Two-tap delete of a custom preset; after the delete, focus a neighbour. */
    deletePresetFocus(p, e) {
      const item = e && e.currentTarget && e.currentTarget.closest('[data-osc="presets.item"]');
      const list = item ? [...item.parentElement.querySelectorAll('[data-osc="presets.item"]')] : [];
      const i = list.indexOf(item);
      const confirming = this.pendingDelete === p.id;
      this.requestDelete(p.id);
      if (!confirming) return;
      this.$nextTick(() => {
        const rest = list.filter((el) => el !== item && el.isConnected);
        const near = rest[Math.min(i, rest.length - 1)];
        focusSafely(near ? near.querySelector('[data-osc="presets.load"]')
          : document.querySelector('[data-osc="presets.save"]'));
      });
    },

    // ------------------------------------------------------------------ dialogs and menus
    openDialog(id) { this.openModal(id); },
    closeDialog(id) { this.closeModal(id); },

    // ------------------------------------------------------------------ export / import
    /** The sequence differs from the one last loaded, imported or exported (C019). */
    get seqUnsaved() { return this.seqDigest !== this.seqSavedDigest; },
    /**
     * Unsaved work (ADR 0045): an edited sequence is kept only by Export configuration; the
     * default sequence and a lab or instrument setting are not work.
     */
    sequencerWhatWouldBeLost() {
      return this.seqUnsaved ? [{ domain: 'sequencer', label: 'Unsaved sequence' }] : [];
    },
    /** The sequence as it is now is saved: at boot, after an import and after an export. */
    markSequenceSaved() {
      const seq = svc.labs && svc.labs.sequencer;
      if (!seq) return;
      const digest = sequenceDigest(seq.editor.model);
      this.seqDigest = digest;
      this.seqSavedDigest = digest;
    },
    async copyConfigUrl() { await this.copyConfigLink(); },
    async exportConfig() {
      try {
        const doc = svc.exportConfigDoc(this);
        const text = `${JSON.stringify(doc, null, 2)}\n`;
        downloadBlob(new Blob([text], { type: 'application/json' }),
          exportFileName('config', 'json'));
        this.markSequenceSaved(); // the file holds the sequence (C019)
        this.notify('success', 'Config exported', 'The JSON file restores these settings.');
        return doc;
      } catch (e) {
        this.notify('error', 'Export failed', e.message || String(e));
        return null;
      }
    },
    importConfigClick() {
      const input = document.getElementById('osc-import-file');
      if (input) { input.value = ''; input.click(); }
    },
    async importConfigFile(e) {
      const file = e && e.target && e.target.files && e.target.files[0];
      if (!file) return false;
      try {
        return this.importConfigText(await readFileText(file));
      } catch (err) {
        this.notify('error', 'Import failed', err.message || String(err));
        return false;
      }
    },
    /** Validate and apply a config document (text or object). Returns true when applied. */
    importConfigText(text) {
      const parsed = parseConfigImport(text);
      this.importErrors = parsed.errors;
      if (!parsed.ok) {
        this.notify('error', 'Config not imported', parsed.errors.slice(0, 3).join(' '));
        return false;
      }
      const { issues, notes = [], limited } = svc.applyImport(this, parsed);
      const notice = importNotice({ invalid: parsed.warnings.length + issues, limited });
      // A value the file holds that was not applied is said, never reported as restored (C004).
      if (notes.length) {
        const said = notice.level === 'success' ? notes : [notice.message, ...notes];
        this.notify('warning', 'Config imported', said.join(' '));
      } else {
        this.notify(notice.level, 'Config imported', notice.message);
      }
      return true;
    },
    async exportAudio(kind) {
      if (this.exportBusy) return false;
      const what = kind || (this.workspace === 'sequencer' ? 'sequence' : 'pattern');
      this.exportBusy = true;
      try {
        const r = await svc.renderWav(this, what);
        downloadBlob(new Blob([r.wav], { type: 'audio/wav' }), exportFileName(what, 'wav'));
        this.notify('success', 'Audio exported', `${r.buffer.duration.toFixed(2)} s · `
          + `${r.buffer.sampleRate} Hz · 16-bit WAV · peak ${r.stats.peakDbfs.toFixed(1)} dBFS`);
        return r;
      } catch (e) {
        this.notify('error', 'Audio export failed', e.message || String(e));
        return null;
      } finally {
        this.exportBusy = false;
      }
    },
    async screenshot() {
      try {
        const r = await svc.screenshot(this);
        downloadBlob(r.blob, exportFileName('graph', 'png'));
        this.notify('success', 'Screenshot saved', `${r.width}×${r.height} px PNG of the `
          + 'visible charts.');
        return r;
      } catch (e) {
        this.notify('error', 'Screenshot failed', e.message || String(e));
        return null;
      }
    },

    // ------------------------------------------------------------------ fullscreen
    toggleFullscreen(panelId) {
      const el = document.getElementById(panelId);
      if (!el) return;
      const fsEl = document.fullscreenElement || document.webkitFullscreenElement;
      if (fsEl === el) {
        (document.exitFullscreen || document.webkitExitFullscreen).call(document);
        return;
      }
      if (this.fullscreen === panelId) {
        el.classList.remove('is-fullscreen');
        this.fullscreen = '';
        if (svc.relayout) requestAnimationFrame(() => svc.relayout());
        return;
      }
      const req = el.requestFullscreen || el.webkitRequestFullscreen;
      const fallback = () => {
        document.querySelectorAll('.osc-panel.is-fullscreen').forEach((p) => p.classList
          .remove('is-fullscreen'));
        el.classList.add('is-fullscreen');
        this.fullscreen = panelId;
        if (svc.relayout) requestAnimationFrame(() => svc.relayout());
      };
      if (!req) { fallback(); return; }
      try {
        const p = req.call(el);
        if (p && typeof p.catch === 'function') p.catch(fallback);
      } catch (e) {
        fallback();
      }
    },

    // ------------------------------------------------------------------ learn / presets
    runLearnDemo(topic) {
      if (topic.demo.href) { window.location.hash = topic.demo.href; return; } // V3 topics
      const fromKeyboard = document.activeElement && document.activeElement.closest('#osc-view-learn');
      // The notice carries the way back to the lesson (links.md, one-way link 2).
      this.runDemo(topic, { action: learnReturnAction(topic) });
      const tab = LEARN_VIZ_TARGETS[topic.demo.viz];
      this.setWorkspace(this.source === 'dual' ? 'synthesis' : 'playground');
      if (tab === 'phase') this.setTab('phase', 'phase');
      else if (tab && tab !== 'motion') this.setTab('analysis', tab);
      if (this.source === 'single') {
        this.sourceKind = this.pattern === 'tone' ? 'oscillator' : 'pattern';
      }
      // The Learn view is now hidden: focus the transport, where the demo is played.
      if (fromKeyboard) this.$nextTick(() => focusSafely(document.getElementById('osc-hold-play')));
    },
    /**
     * A Learn topic's tool link was followed (its href opens the workspace through the router):
     * the topic becomes the current lesson and the notice offers the way back to it.
     */
    learnToolFollowed(topic, e) {
      if (e && (e.button > 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey)) return;
      const tool = learnToolOf(topic.id);
      if (!tool) return;
      this.learnTopic = topic.id;
      this.notify('info', `Opened ${tool.text.replace(/^Open /, '')} from the lesson`,
        `${topic.title}: the lesson stays where you left it.`,
        { action: learnReturnAction(topic) });
    },
    /** Follow a notice's link: the notice goes, the router opens the address. */
    alertActionFollowed(id) {
      // After the click: the link is still in the document when the browser follows it.
      setTimeout(() => { this.alerts = this.alerts.filter((a) => a.id !== id); }, 0);
    },
    loadPresetFromView(p) {
      this.loadPreset(p);
      if (!this.pendingPreset) {
        this.sourceKind = this.source === 'single' && this.pattern === 'tone'
          ? 'oscillator' : 'pattern';
      }
    },
    presetParams(p) { return Array.isArray(p.params) ? p.params.join(' · ') : (p.params || ''); },
  };
}
