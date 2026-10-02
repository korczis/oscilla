// Integration layer of the OSCILLA component: the members the V2 markup binds to on top of the
// V1 instrument (core/instrument.js) and the visual shell (ui/app.js). Composed into ONE Alpine
// component by main.js (Object.defineProperties, never spread). Audio objects, labs and p5
// hosts live in `svc` (a closure), never in reactive state.
//
// svc: { engine, bridge, labs, exportConfigDoc(cmp), applyImport(cmp, parsed),
//        renderWav(cmp, kind), screenshot(cmp), relayout() }

import { WAVEFORM_LABELS } from '../core/constants.js';
import { clamp, round } from '../core/math.js';
import {
  formatFrequency, formatMs, frequencyToNormalized, normalizedToFrequency,
} from '../core/frequency.js';
import { midiToFrequency, nearestNote, formatCents } from '../core/music.js';
import { gainLevelDb } from '../core/config.js';
import { SWEEP_PARAMS } from '../audio/patterns.js';
import { LEARN_VIZ_TARGETS } from '../data/learn.js';
import { harmonicTable } from '../visualization/harmonics.js';
import { OSCILLA_VERSION } from './version.js';
import { rovingKeydown } from './app.js';
import { parseConfigImport, exportFileName } from './config-file.js';
import { downloadBlob, readFileText } from './exporters.js';
import { focusSafely } from './dialogs.js';

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

/** Workspace -> the V1 mode id the URL `m` key stores. */
export function v1ModeFor(workspace, source) {
  if (workspace === 'presets' || workspace === 'learn') return workspace;
  if (source === 'dual') return 'dual';
  if (source === 'sweep') return 'sweep';
  return 'playground';
}

/** V1 mode id (URL `m`) -> workspace. */
export function workspaceForV1Mode(mode) {
  return { dual: 'synthesis', presets: 'presets', learn: 'learn' }[mode] || 'playground';
}

export const SWEEP_FORM = SWEEP_PARAMS;

export function createWorkbench(svc) {
  return {
    OSCILLA_VERSION,
    SWEEP_FORM,
    rovingKeydown,
    timeWindowMs: 5,
    announceText: '',
    seqPlaying: false,
    exportBusy: false,
    importErrors: [],
    lastPattern: null,
    fullscreen: '',
    learnOpen: 'frequency',

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
    get rangeMinText() { return formatFrequency(this.rangeMin); },
    get rangeMaxText() { return formatFrequency(this.rangeMax); },
    get gainDb() { return gainLevelDb(this.gainLevel); },
    get gainDbText() {
      const db = this.gainDb;
      return Number.isFinite(db) ? `${db.toFixed(1)} dB` : '-∞ dB';
    },
    get gainFill() { return `${this.gainPct}%`; },
    get isSounding() { return this.playing || this.seqPlaying; },
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
      if (this.seqPlaying) return 'PLAYING';
      return this.status === 'READY' ? 'READY' : 'STOPPED';
    },
    get statusFreqText() {
      if (this.seqPlaying && !this.playing) return 'sequence';
      if (this.source === 'dual') return `${groupedHz(this.dualFa)} / ${groupedHz(this.dualFb)} Hz`;
      const f = this.playing && this.instFreq != null ? this.instFreq : this.metricFrequencyIdle;
      return `${groupedHz(f)} Hz`;
    },
    get statusWaveText() {
      if (this.source === 'dual') {
        return `${WAVEFORM_LABELS[this.dual.a.wave]} + ${WAVEFORM_LABELS[this.dual.b.wave]}`;
      }
      return this.additiveOn ? 'Additive' : (WAVEFORM_LABELS[this.waveform] || 'Sine');
    },
    get statusPatternText() {
      if (this.seqPlaying && !this.playing) return 'Sequencer';
      if (this.source === 'dual') return this.dual.stereo ? 'Dual (stereo)' : 'Dual (mono)';
      if (this.source === 'sweep') return `Sweep (${this.sweep.curve})`;
      const p = this.currentPattern;
      const pp = this.pp[this.pattern];
      if (pp && pp.curve) return `${p.label} (${pp.curve})`;
      return p.label;
    },
    get statusDurationText() {
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
    get statusGainText() { return `Gain ${this.gainDbText}`; },
    get vizSummaryHarm() {
      const wave = this.source === 'dual' ? this.dual.a.wave : this.waveform;
      const f = this.source === 'dual' ? this.dualFa : this.metricFrequencyIdle;
      return harmonicTable(wave, f, this.nyquist).summary || 'unavailable';
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

    // ------------------------------------------------------------------ transport extras
    /** Status-bar play key: stop when sounding, else latch (continuous allowed) or trigger. */
    statusPlay() {
      if (this.seqPlaying && svc.labs.sequencer) svc.labs.sequencer.editor.stop();
      if (this.playing) { this.stopNow(); return; }
      if (this.continuousAllowed && !this.isProgrammed) this.toggleLatch();
      else this.trigger();
    },
    onContinuousToggle() {
      this.setContinuous(!this.continuousAllowed);
      this.notify('info', this.continuousAllowed ? 'Continuous playback allowed'
        : 'Hard limit active', this.continuousAllowed
        ? 'Hold and latch play until stopped. Keep the level low.'
        : `Hold, trigger and the finite tone stop after ${this.safetyLimit} s.`);
    },
    setSafetyLimit(raw) {
      const v = Number(raw);
      if (this.SAFETY_LIMIT_OPTIONS.includes(v)) this.safetyLimit = v;
    },

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
    async copyConfigUrl() { await this.copyConfigLink(); },
    async exportConfig() {
      try {
        const doc = svc.exportConfigDoc(this);
        const text = `${JSON.stringify(doc, null, 2)}\n`;
        downloadBlob(new Blob([text], { type: 'application/json' }),
          exportFileName('config', 'json'));
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
      const issues = svc.applyImport(this, parsed);
      const warn = parsed.warnings.length + issues;
      this.notify(warn ? 'warning' : 'success', 'Config imported', warn
        ? `${warn} value(s) were invalid and kept at their previous setting.`
        : 'All settings were restored.');
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
      const fromKeyboard = document.activeElement && document.activeElement.closest('#osc-view-learn');
      this.runDemo(topic);
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
