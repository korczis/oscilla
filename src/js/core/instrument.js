// The V1 Alpine component's instrument logic without its DOM: state, derived getters, transport,
// frequency/pattern/sweep/dual controls, presets, history, URL state, notifications and the
// visualization sync. Extracted from V1 oscillaApp (index.html@a7b7a23, section 8).
//
// createInstrument(deps) returns a plain object with the V1 field, getter and method names, so
// it can be the Alpine component itself (Alpine.data('oscillaApp', () => createInstrument(deps)))
// or be composed into one with Object.defineProperties(target,
// Object.getOwnPropertyDescriptors(instrument)) — never with object spread, which would evaluate
// the getters once.
//
// Members whose logic moved to pure modules delegate to them (config.js applyConfig/
// setFrequency/fitRange, url-state.js, storage.js, data/presets.js, safety.js). Every other
// member keeps its V1 body; module globals of V1 are bound from `deps` below under their V1
// names (engine, viz, localStore, sessionStore, location, setTimeout, …), so those bodies are
// textually unchanged.
//
// Not here (DOM-bound; the UI layer owns them): init() and its listeners, theme and menus,
// modal()/openModal/closeModal internals, trapFocus, trackHeaderHeight, initFrequencyMapWheel,
// modeKey, the overlay menu, initVisualizer. See status/extract.txt for the UI contract.
//
// deps: {
//   engine        AudioEngine instance (omitted: a silent stand-in, nothing sounds)
//   bridge        visualization bridge (createVisualizationBridge); optional
//   localStore, sessionStore   safeStorage instances (default: window storage)
//   location      { hash, href, search } (default: window.location)
//   timers        { setTimeout, clearTimeout, setInterval, clearInterval } (default: global)
//   env           window-like object for history/navigator/isSecureContext/innerWidth
//   keyGuard(e)   true when a Space keydown belongs to a focused control or an open modal
//                 (V1: isTypingTarget(...) || document.querySelector('[data-oscilla-modal]…'))
//   openModal(id), closeModal(id)   dialog hooks (V1 ids: saveModal, headphonesModal, copyModal)
// }

import {
  APP_MODES, APP_VERSION, MAX_PROGRAMMED_S, MIN_FREQUENCY,
  PROVISIONAL_SAMPLE_RATE, RANGE_MODES, SAFE_NYQUIST_FACTOR,
  SAFETY_LIMIT_OPTIONS, STORAGE_KEYS, VIZ_MODES, WAVEFORMS, WAVEFORM_LABELS,
} from './constants.js';
import { clamp, isNum, pick, round, sig } from './math.js';
import {
  formatFrequency, formatMs, formatPeriod, formatWavelength, frequencyToNormalized, mapRegions,
  mapTicks, normalizedToFrequency, parseFrequency, parseFrequencyList, rangeBounds, regionFor,
} from './frequency.js';
import { NOTE_BUTTONS, formatCents, nearestNote, noteToFrequency } from './music.js';
import { browserName, platformName } from './platform.js';
import {
  applyConfigTo, defaultInstrumentState, fitRangeOn, gainLabelFor, gainLevelForPct, gainPctFor,
  setFrequencyOn,
} from './config.js';
import * as storage from './storage.js';
import { newPresetId, presetRecord } from './storage.js';
import * as urlState from './url-state.js';
import {
  BINAURAL_DEFAULT_PAIR, binauralNeedsDefaultPair, canLatch, openDurationText, presetDisabled,
  presetDisabledReason, representability, stereoBinauralCondition, sweepRepeatChoice,
} from './safety.js';
import {
  ENV_PARAMS, PATTERN_BY_ID, PATTERN_GROUPS, PATTERNS, buildPlan, detunedFrequency,
  sweepHzPerSec, sweepOctPerSec, sweepSpanOct,
} from '../audio/patterns.js';
import { micErrorMessage, MIC_PRIVACY_NOTICE } from '../audio/microphone.js';
import {
  BUILTIN_PRESETS, PRESET_CATEGORIES, describeConfig, presetMaxFrequency,
} from '../data/presets.js';
import { LEARN_TOPICS } from '../data/learn.js';

let alertSeq = 0;

/** An engine stand-in when none is given: the instrument works, nothing sounds. */
function nullEngine() {
  return {
    ctx: null, sampleRate: null, state: 'not started', lastError: null, voice: null,
    activeNodeCount: 0, activeSourceCount: 0,
    isSupported: () => false, init: () => false, resume: () => Promise.resolve(false),
    play: () => null, release: () => false, stopAll() {}, setMasterGain() {},
    updateLive: () => false, instantaneousFrequency: () => null, on: () => () => {},
    startMic: () => Promise.reject(new Error('Audio could not start.')), stopMic() {},
    running: false, mic: null, revokeContinuous: () => 0,
  };
}

/** A bridge stand-in when no visualization is attached. */
const NULL_BRIDGE = {
  fps: 0, sketchState: 'not started', sync() {}, readPalette() {},
};

export function createInstrument(deps = {}) {
  const engine = deps.engine || nullEngine();
  const viz = deps.bridge || NULL_BRIDGE;
  const localStore = deps.localStore || storage.localStore;
  const sessionStore = deps.sessionStore || storage.sessionStore;
  const host = deps.env || (typeof window !== 'undefined' ? window : globalThis);
  const location = deps.location || host.location || { hash: '', href: '', search: '' };
  const timers = deps.timers || globalThis;
  const setTimeout = (fn, ms) => timers.setTimeout(fn, ms);
  const clearTimeout = (id) => timers.clearTimeout(id);
  const setInterval = (fn, ms) => timers.setInterval(fn, ms);
  const clearInterval = (id) => timers.clearInterval(id);
  const keyGuard = deps.keyGuard || (() => false);
  const AudioEngine = { isSupported: () => engine.isSupported() };
  const env = (cmp) => ({ sampleRate: cmp.sampleRate, continuousAllowed: cmp.continuousAllowed });

  return {
    // ---- constants exposed to templates
    WAVEFORMS, WAVEFORM_LABELS, RANGE_MODES, PATTERNS, PATTERN_GROUPS, NOTE_BUTTONS, VIZ_MODES, APP_MODES,
    PRESET_CATEGORIES, LEARN_TOPICS, SAFETY_LIMIT_OPTIONS, APP_VERSION,
    WAVE_PATHS: {
      sine: 'M1 8 Q5 0 9 8 T17 8 T25 8 T31 4',
      triangle: 'M1 8 L5 2 L13 14 L21 2 L29 14 L31 11',
      sawtooth: 'M1 14 L9 2 L9 14 L17 2 L17 14 L25 2 L25 14 L31 7',
      square: 'M1 14 L1 2 L9 2 L9 14 L17 14 L17 2 L25 2 L25 14 L31 14',
    },

    // ---- instrument state (serializable)
    ...defaultInstrumentState(),

    // ---- UI state
    mode: 'playground',
    vizMode: 'wave',
    spectrumScale: 'log',
    overlays: { regions: true, notes: false, thirds: false },
    initialized: false,
    status: 'READY',
    audioState: 'not started',
    sampleRate: null,
    playing: false,
    releasing: false,
    holding: false,
    keyHolding: false,
    latched: false,
    continuousAllowed: false,   // never persisted, never restored from a link
    safetyLimit: 2,
    noteMode: false,
    explore: false,
    freqText: '440 Hz',
    freqError: '',
    paramErrors: {},
    planError: '',
    planWarnings: [],
    planFreqs: [440],
    loadedLabel: '',
    presetTab: 'reference',
    customPresets: [],
    history: [],
    saveName: '',
    saveError: '',
    pendingPreset: null,
    pendingHashConfig: null,
    pendingDelete: null,
    copyUrl: '',
    learnTopic: 'frequency',
    alerts: [],
    theme: 'system',
    isDark: false,
    planSummary: null,
    instFreq: null,
    micActive: false,
    micPending: false,
    vizFailed: false,
    debug: false,
    debugInfo: {},
    storage: { local: true, session: true },
    safetyCollapsed: false,
    safetyExpanded: false,
    themeMenuOpen: false,
    overlayMenuOpen: false,
    vizPaused: false,          // V1 Pause animation toggle (index.html@a7b7a23); the UI binds it
    waveLayout: 'side',        // set by the UI from bridge.onWaveLayout ('side' | 'compact')
    mapDragging: false,
    customMinText: '100 Hz',
    customMaxText: '10.00 kHz',
    rangeError: '',

    // ============================== derived values
    // V1: oscillaApp: get provisional, get effectiveSampleRate, get nyquist, get safeMax
    //   (index.html@a7b7a23)
    get provisional() { return this.sampleRate == null; },
    get effectiveSampleRate() { return this.sampleRate || PROVISIONAL_SAMPLE_RATE; },
    get nyquist() { return this.effectiveSampleRate / 2; },
    get safeMax() { return this.nyquist * SAFE_NYQUIST_FACTOR; },
    // V1: oscillaApp getters rangeMin, rangeMax -> frequency.js rangeBounds (index.html@a7b7a23)
    get rangeMin() { return rangeBounds(this, this.safeMax).min; },
    get rangeMax() { return rangeBounds(this, this.safeMax).max; },
    // V1: oscillaApp: get regionLabel, get readoutText, get readoutRegion, get mapRangeStyle, get
    //   note, get noteText, get freqDisplay, get periodText, get wavelengthText, get
    //   usesGlobalFrequency, get metricFrequency, get metricNoteText, get requestedText, get
    //   metricFrequencyIdle, get durationText (index.html@a7b7a23)
    get regionLabel() { return regionFor(this.frequency).label; },
    /** The big readout: the playground frequency, or the range a pattern sets in its own parameters. */
    get readoutText() {
      if (this.usesGlobalFrequency) return this.freqDisplay;
      const lo = this.freqMinInvolved;
      const hi = this.freqMaxInvolved;
      return lo === hi ? formatFrequency(lo) : `${formatFrequency(lo)} – ${formatFrequency(hi)}`;
    },
    get readoutRegion() {
      if (this.usesGlobalFrequency) return this.regionLabel;
      const a = regionFor(this.freqMinInvolved).label;
      const b = regionFor(this.freqMaxInvolved).label;
      return a === b ? a : `${a} → ${b}`;
    },
    get mapRangeStyle() {
      const n = (f) => clamp(frequencyToNormalized(clamp(f, this.rangeMin, this.rangeMax), this.rangeMin, this.rangeMax), 0, 1) * 100;
      const lo = n(this.freqMinInvolved);
      return `left:${lo}%;width:${Math.max(0.6, n(this.freqMaxInvolved) - lo)}%`;
    },
    get note() { return nearestNote(this.frequency, this.a4); },
    get noteText() { const n = this.note; return n ? `${n.name} · ${formatCents(n.cents)}` : '—'; },
    get freqDisplay() { return formatFrequency(this.frequency, this.noteMode); },
    get periodText() { return formatPeriod(this.metricFrequency); },
    get wavelengthText() { return formatWavelength(this.metricFrequency); },
    get usesGlobalFrequency() {
      return this.source === 'single' && this.currentPattern.params.some((p) => p.obj === 'global' && p.key === 'frequency');
    },
    /** The frequency the metrics describe: live while playing, else what the configuration starts with. */
    get metricFrequency() {
      if (this.playing && this.instFreq != null) return this.instFreq;
      if (this.source === 'dual') return this.dualFa;
      return this.usesGlobalFrequency || !this.planFreqs.length ? this.frequency : this.planFreqs[0];
    },
    get metricNoteText() {
      const n = nearestNote(this.metricFrequency, this.a4);
      return n ? `${n.name} · ${formatCents(n.cents)}` : '—';
    },
    /** What is requested, per source: one frequency, A / B, or the planned range. */
    get requestedText() {
      if (this.source === 'dual') return `A ${formatFrequency(this.dualFa)} / B ${formatFrequency(this.dualFb)}`;
      if (this.usesGlobalFrequency || this.planFreqs.length < 2) return formatFrequency(this.metricFrequencyIdle);
      return `${formatFrequency(this.freqMinInvolved)} – ${formatFrequency(this.freqMaxInvolved)}`;
    },
    get metricFrequencyIdle() {
      return this.usesGlobalFrequency || !this.planFreqs.length ? this.frequency : this.planFreqs[0];
    },
    get durationText() {
      // V1: oscillaApp getter durationText (index.html@a7b7a23)
      const p = this.planSummary;
      if (p && p.kind === 'continuous') return 'repeats until stopped';
      if (p && p.kind === 'finite' && this.source === 'single' && this.pattern === 'finite'
        && !this.continuousAllowed && p.dur > this.safetyLimit) {
        return `${this.safetyLimit} s (limited; programmed ${formatMs(p.dur * 1000)})`;
      }
      if (p && p.kind === 'finite') return `${formatMs(p.dur * 1000)} programmed`;
      return openDurationText(this.duration, this.safetyLimit, this.continuousAllowed);
    },
    // V1: oscillaApp getters gainPct, gainLabel -> config.js (index.html@a7b7a23)
    get gainPct() { return gainPctFor(this.gainLevel); },
    // The conservative default (0.08 ≈ 57 %) reads LOW, next to the safety advice to start low.
    get gainLabel() { return gainLabelFor(this.gainPct); },
    // V1: oscillaApp: get currentPattern, get isProgrammed, get mapMarkerPct (index.html@a7b7a23)
    get currentPattern() { return PATTERN_BY_ID[this.pattern] || PATTERNS[0]; },
    get isProgrammed() {
      return this.source === 'sweep' || (this.source === 'single' && this.currentPattern.kind === 'finite');
    },
    get mapMarkerPct() { return frequencyToNormalized(this.frequency, this.rangeMin, this.rangeMax) * 100; },
    // V1: oscillaApp getters mapRegions, mapTicks -> frequency.js (index.html@a7b7a23)
    get mapRegions() { return mapRegions(this.rangeMin, this.rangeMax); },
    get mapTicks() { return mapTicks(this.rangeMin, this.rangeMax); },
    // V1: oscillaApp: get freqMinInvolved, get freqMaxInvolved, get showLowWarning, get
    //   showHighWarning, get showUltrasonicNote, get showHarmonicWarning, get
    //   stereoBinauralCondition (index.html@a7b7a23)
    get freqMinInvolved() { return this.planFreqs.length ? Math.min(...this.planFreqs) : this.frequency; },
    get freqMaxInvolved() { return this.planFreqs.length ? Math.max(...this.planFreqs) : this.frequency; },
    get showLowWarning() { return this.freqMinInvolved < 40; },
    get showHighWarning() { return this.freqMaxInvolved > 12000; },
    get showUltrasonicNote() { return this.freqMaxInvolved > 20000; },
    get showHarmonicWarning() {
      const nonSine = this.source === 'dual'
        ? this.dual.a.wave !== 'sine' || this.dual.b.wave !== 'sine'
        : this.waveform !== 'sine';
      return nonSine && this.freqMaxInvolved >= 4000;
    },
    get stereoBinauralCondition() {
      return stereoBinauralCondition(this.source, this.dual, this.dualDelta);
    },
    // V1: oscillaApp getters dualFa, dualFb -> patterns.js detunedFrequency (index.html@a7b7a23)
    get dualFa() { return detunedFrequency(this.dual.a); },
    get dualFb() { return detunedFrequency(this.dual.b); },
    // V1: oscillaApp: get dualDelta, get beatText (index.html@a7b7a23)
    get dualDelta() { return Math.abs(this.dualFa - this.dualFb); },
    get beatText() {
      const d = this.dualDelta;
      if (d < 0.005) return 'No difference: no beating (the sum depends only on phase).';
      return `Δf ${sig(d, 3)} Hz → amplitude beats at about ${sig(d, 3)} Hz (one every ${formatPeriod(d)}).`;
    },
    // V1: oscillaApp getters sweepSpanOct, sweepHzPerSec, sweepOctPerSec -> patterns.js
    get sweepSpanOct() { return sweepSpanOct(this.sweep); },
    get sweepHzPerSec() { return sweepHzPerSec(this.sweep); },
    // V1: oscillaApp: get sweepReadout, get sweepBarStyle (index.html@a7b7a23)
    /** The sweep as it will sound: lower → upper, upper → lower, or ping-pong between them. */
    get sweepReadout() {
      const lo = formatFrequency(Math.min(this.sweep.start, this.sweep.end));
      const hi = formatFrequency(Math.max(this.sweep.start, this.sweep.end));
      if (this.sweep.direction === 'pingpong') return `${lo} ↔ ${hi}`;
      return this.sweep.direction === 'down' ? `${hi} → ${lo}` : `${lo} → ${hi}`;
    },
    get sweepBarStyle() {
      const n = (f) => frequencyToNormalized(f, 10, this.safeMax) * 100;
      const lo = n(Math.min(this.sweep.start, this.sweep.end));
      return `left:${lo}%;width:${n(Math.max(this.sweep.start, this.sweep.end)) - lo}%`;
    },
    get sweepOctPerSec() { return sweepOctPerSec(this.sweep); },
    // V1: oscillaApp: get transportText, get browserText, get platformText (index.html@a7b7a23)
    get transportText() {
      if (this.planError) return this.planError;
      // V1: oscillaApp getter transportText (index.html@a7b7a23)
      const p = this.planSummary;
      if (!p) return '';
      const lim = this.safetyLimit;
      let tail;
      if (p.kind === 'continuous') tail = 'repeats until stopped';
      else if (p.kind === 'finite' && this.source === 'single' && this.pattern === 'finite') {
        // The finite tone is the one programmed signal the hard limit also caps.
        tail = this.continuousAllowed || p.dur <= lim ? `programmed ${formatMs(p.dur * 1000)}`
          : `programmed ${formatMs(p.dur * 1000)} · limited to ${lim} s`;
      } else if (p.kind === 'finite') {
        tail = `programmed ${formatMs(p.dur * 1000)} (patterns are exempt from the hold limit, max ${MAX_PROGRAMMED_S} s)`;
      } else if (this.continuousAllowed) tail = 'hold or latch · no time limit';
      else tail = `hold up to ${lim} s · trigger ${formatMs(Math.min(this.duration, lim * 1000))}`;
      return `${p.label} · ${tail}`;
    },
    get browserText() { return browserName(); },
    get platformText() { return platformName(); },
    // V1: oscillaApp getter representability -> safety.js (index.html@a7b7a23)
    get representability() {
      const f = this.source === 'dual' ? Math.max(this.dualFa, this.dualFb) : this.freqMaxInvolved;
      return representability(f, this.nyquist, this.safeMax);
    },
    // V1: oscillaApp: get instFreqText, get hints, get currentTopic, get topicExample, get
    //   statusIcon (index.html@a7b7a23)
    get instFreqText() {
      if (!this.playing || this.instFreq == null) return '—';
      return formatFrequency(this.instFreq);
    },
    get hints() {
      // The frequency the hint talks about is the one that will actually sound.
      const f = this.source === 'dual' ? this.dualFa : this.metricFrequencyIdle;
      const waves = this.source === 'dual' ? [this.dual.a.wave, this.dual.b.wave] : [this.waveform];
      // Ordered by importance: device and digital-limit caveats first, so they are never cut.
      const out = [];
      if (this.freqMaxInvolved > this.nyquist * 0.6) out.push('Nyquist is a digital limit, not a guarantee of speaker performance.');
      if (this.freqMaxInvolved > 12000) out.push('Your browser may generate this signal mathematically, while your speaker may reproduce it poorly.');
      if (waves.some((w) => w !== 'sine')) out.push('Square and sawtooth waves contain harmonic frequencies; triangle has weak odd harmonics.');
      if (this.source === 'dual') out.push('Two close frequencies add up to a level that rises and falls at their difference.');
      if (this.source === 'sweep' || ['sweepUp', 'sweepDown', 'pingpong', 'chirp'].includes(this.pattern)) {
        out.push('A logarithmic sweep spends equal time in every octave; a linear one rushes through the low end.');
      }
      out.push(`At ${formatFrequency(f)}, one cycle lasts about ${formatPeriod(f)}.`);
      if (this.freqMinInvolved < 60) out.push(`Approximate wavelength at ${formatFrequency(this.freqMinInvolved)}: ${formatWavelength(this.freqMinInvolved)}.`);
      out.push('Frequency is the number of cycles per second.');
      return out.slice(0, 5);
    },
    get currentTopic() { return LEARN_TOPICS.find((t) => t.id === this.learnTopic) || LEARN_TOPICS[0]; },
    get topicExample() {
      const f = this.metricFrequencyIdle;
      switch (this.learnTopic) {
        case 'frequency': return `Now: ${formatFrequency(f)} = ${sig(f, 4)} cycles per second.`;
        case 'period': return `Now: ${formatFrequency(f)} → T = ${formatPeriod(f)}.`;
        case 'wavelength': return `Now: ${formatFrequency(f)} → λ ≈ ${formatWavelength(f)}.`;
        case 'amplitude': return `Now: logical gain ${this.gainLevel.toFixed(3)} (${this.gainLabel}), relative level only.`;
        case 'nyquist': case 'samplerate': return `This device: ${this.provisional ? 'not started yet (assuming ' : ''}${sig(this.effectiveSampleRate / 1000, 4)} kHz${this.provisional ? ')' : ''} → Nyquist ${formatFrequency(this.nyquist)}.`;
        case 'harmonic': case 'aliasing': {
          const n = Math.floor(this.nyquist / f);
          return `Now: ${formatFrequency(f)} → ${n} integer multiple(s) fit below Nyquist.`;
        }
        case 'beating': case 'interference': return `Dual osc now: ${formatFrequency(this.dualFa)} + ${formatFrequency(this.dualFb)}. ${this.beatText}`;
        case 'logscale': return `${formatFrequency(f)} → one octave up is ${formatFrequency(f * 2)}.`;
        default: return `Now: ${formatFrequency(f)} · ${this.regionLabel.toLowerCase()}.`;
      }
    },
    get statusIcon() {
      return { READY: '○', PLAYING: '▶', RELEASING: '◢', SUSPENDED: '‖', STOPPED: '■', ERROR: '!' }[this.status] || '○';
    },


    // ============================== audio + transport
    // V1: oscillaApp: ensureAudio, currentPlan, play, holdStart, holdEnd, holdLeave, holdKey,
    //   triggerKey, releaseHold, trigger, latchKey, toggleLatch, stop, stopNow, setContinuous,
    //   onEngine (index.html@a7b7a23); `document` is the deps.env document (resume retry)
    ensureAudio() {
      if (!AudioEngine.isSupported()) { this.status = 'ERROR'; return false; }
      // A context closed from outside is rebuilt by init(); treat that like a first start.
      const first = !engine.ctx || engine.state === 'closed';
      engine.setMasterGain(this.gainLevel); // a new context starts at the requested level
      if (!engine.init()) { this.status = 'ERROR'; return false; }
      this.sampleRate = engine.sampleRate;
      this.audioState = engine.state;
      if (first) {
        if (this.pendingHashConfig) {
          this.applyConfig(this.pendingHashConfig, 'hash');
          this.pendingHashConfig = null;
        }
        if (this.frequency > this.rangeMax) this.setFrequency(this.frequency);
      }
      if (engine.state !== 'running') {
        // On touch devices pointerdown is not a user activation, so a resume() made there can
        // stay pending; retry on the next activating event (pointerup, touchend, click, key).
        const document = host.document;
        if (!this._resumeArmed && document) {
          this._resumeArmed = true;
          const evs = ['pointerup', 'touchend', 'click', 'keyup'];
          const retry = () => {
            engine.resume().then((ok) => {
              this.audioState = engine.state;
              if (!ok) return;
              this._resumeArmed = false;
              for (const t of evs) document.removeEventListener(t, retry, true);
            });
          };
          for (const t of evs) document.addEventListener(t, retry, { capture: true, passive: true });
        }
        engine.resume().then((ok) => {
          this.audioState = engine.state;
          if (!ok && this.playing) {
            this.notify('warning', 'Audio is suspended', 'The browser has not allowed audio to start. Press HOLD TO PLAY again.');
          }
        });
      }
      return true;
    },

    currentPlan() {
      return buildPlan({
        source: this.source, pattern: this.pattern, waveform: this.waveform, frequency: this.frequency,
        duration: this.duration, pp: this.pp, sweep: this.sweep, dual: this.dual,
      }, { safeMax: this.safeMax, continuous: this.continuousAllowed });
    },

    play(mode) {
      if (!this.ensureAudio()) return false;
      const res = this.currentPlan();
      if (!res.ok) {
        this.status = 'ERROR';
        this.notify('error', 'Cannot play this configuration', res.error);
        return false;
      }
      const info = engine.play(res.plan, {
        mode, continuous: this.continuousAllowed, limitS: this.safetyLimit, durationS: this.duration / 1000,
        attackS: this.attack / 1000, releaseS: this.release / 1000,
      });
      if (!info) return false;
      this.addHistory(res.plan);
      return true;
    },

    holdStart(e) {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      e.preventDefault();
      try { e.currentTarget.setPointerCapture(e.pointerId); } catch (err) { /* not capturable */ }
      this.holding = true;
      this.latched = false;
      this.play('hold');
    },
    holdEnd() {
      // pointerup is a user activation on touch devices (pointerdown is not): resume here too.
      if (engine.ctx && engine.state === 'suspended') engine.resume();
      if (!this.holding) return;
      this.holding = false;
      engine.release();
    },
    /** Leaving the button releases only when the pointer is not captured (capture keeps touch holds alive). */
    holdLeave(e) {
      try { if (e.currentTarget.hasPointerCapture(e.pointerId)) return; } catch (err) { /* no capture API */ }
      this.holdEnd();
    },
    holdKey(e) {
      if (e.repeat) return;
      this.holding = true;
      this.keyHolding = true; // the window keyup releases it even if focus has moved on
      this.latched = false;
      this.play('hold');
    },
    /** Enter triggers once per press; key repeat must not restart the pattern. */
    triggerKey(e) { if (!e.repeat) this.trigger(); },
    releaseHold() {
      if (this.holding || this.keyHolding) {
        this.holding = false;
        this.keyHolding = false;
        engine.release();
      }
    },
    trigger() {
      this.latched = false;
      this.play('trigger');
    },
    /** Held Enter auto-repeats keydown; only the first press may toggle the latch. */
    latchKey(e) { if (e.repeat) e.preventDefault(); },
    toggleLatch() {
      if (!canLatch(this.continuousAllowed)) return;
      if (this.latched && this.playing) { this.stop(); return; }
      this.latched = this.play('latch');
    },
    stop() {
      this.holding = false;
      this.keyHolding = false;
      this.latched = false;
      engine.release();
    },
    stopNow() {
      this.holding = false;
      this.keyHolding = false;
      this.latched = false;
      engine.stopAll();
    },
    setContinuous(on) {
      this.continuousAllowed = !!on;
      if (on) return;
      // Withdrawn: every voice the permission lengthened (latched, unlimited hold, continuous
      // sweep, finite tone beyond the limit) fades out now — before the sweep repeat is reset,
      // so the live update cannot restart it as a one-shot.
      engine.revokeContinuous();
      this.latched = false;
      if (this.sweep.repeat === 'continuous') this.sweep.repeat = 'once';
    },

    onEngine(type, d) {
      switch (type) {
        case 'play':
          clearTimeout(this._readyTimer);
          this.playing = true;
          this.releasing = false;
          // Honest status: a voice scheduled on a suspended context is silent until it resumes.
          this.status = engine.running ? 'PLAYING' : 'SUSPENDED';
          clearInterval(this._metricTimer);
          this._metricTimer = setInterval(() => { this.instFreq = engine.instantaneousFrequency(); }, 100);
          break;
        case 'release':
          if (this.playing) { this.releasing = true; this.status = 'RELEASING'; }
          break;
        case 'ended':
          this.playing = false;
          this.releasing = false;
          this.latched = false;
          this.holding = false;
          this.status = 'STOPPED';
          clearInterval(this._metricTimer);
          this.instFreq = null;
          if (this.pattern === 'random') this.pp.random.seed = Math.floor(Math.random() * 2147483647);
          clearTimeout(this._readyTimer);
          this._readyTimer = setTimeout(() => { if (!this.playing && this.status === 'STOPPED') this.status = 'READY'; }, 1500);
          break;
        case 'context':
          this.audioState = d;
          if (engine.sampleRate) this.sampleRate = engine.sampleRate;
          if (this.playing && !this.releasing) this.status = d === 'running' ? 'PLAYING' : 'SUSPENDED';
          break;
        case 'mic':
          if (this.micActive && d.reason === 'ended') {
            this.notify('warning', 'Microphone stopped', 'The microphone was disconnected or its permission was revoked.');
          }
          this.micActive = false;
          break;
        case 'error':
          this.status = 'ERROR';
          this.notify('error', 'Audio error', d.message);
          break;
        default: break;
      }
    },

    // V1: oscillaApp.onKeyDown (index.html@a7b7a23); the DOM checks moved to deps.keyGuard
    onKeyDown(e) {
      if (e.key === 'Escape') {
        if (this.playing) this.stopNow();
        return;
      }
      if (e.code !== 'Space' && e.key !== ' ') return;
      // V1: isTypingTarget(target) / isTypingTarget(document.activeElement) / an open
      // [data-oscilla-modal][aria-modal="true"] — supplied by the UI as deps.keyGuard.
      if (keyGuard(e)) return;
      e.preventDefault();
      if (e.repeat) return;
      if (this.isProgrammed) {
        this.trigger();
      } else {
        this.keyHolding = true;
        this.holding = true;
        this.play('hold');
      }
    },
    // V1: oscillaApp: onKeyUp (index.html@a7b7a23)
    onKeyUp(e) {
      if ((e.code === 'Space' || e.key === ' ') && this.keyHolding) {
        this.keyHolding = false;
        this.holdEnd();
      }
    },


    // ============================== frequency control
    // V1: oscillaApp.setFrequency -> config.js setFrequencyOn (index.html@a7b7a23)
    setFrequency(value, opts = {}) { return setFrequencyOn(this, value, opts, env(this)); },
    // V1: oscillaApp: applyFreqText, stepOctave, stepSemitone, stepCents, stepHz, setNote, setA4,
    //   setWaveform (index.html@a7b7a23)
    applyFreqText() {
      const r = parseFrequency(this.freqText);
      if (!r.ok) { this.freqError = r.error; return; }
      // Enter and change both fire: re-applying the already clamped value must keep its message.
      if (r.value === this.frequency) return;
      this.setFrequency(r.value);
    },
    stepOctave(n) { this.setFrequency(this.frequency * Math.pow(2, n)); },
    stepSemitone(n) { this.setFrequency(this.frequency * Math.pow(2, n / 12)); },
    stepCents(c) { this.setFrequency(this.frequency * Math.pow(2, c / 1200)); },
    stepHz(n) { this.setFrequency(this.frequency + n); },
    setNote(name) {
      const f = noteToFrequency(name, this.a4);
      if (f) { this.fitRange(f, f); this.setFrequency(f); }
    },
    setA4(raw) {
      const n = Number(raw);
      this.a4 = isNum(n) ? clamp(Math.round(n), 432, 445) : 440;
    },
    setWaveform(w) { this.waveform = pick(w, WAVEFORMS, 'sine'); },
    // V1: oscillaApp.setGainPct -> config.js gainLevelForPct (index.html@a7b7a23)
    setGainPct(pct) { this.gainLevel = gainLevelForPct(pct); },

    // V1: oscillaApp: mapDown, mapMove, mapUp, mapSet, mapKey (index.html@a7b7a23)
    mapDown(e) {
      if (!this.usesGlobalFrequency) return; // the pattern sets its frequencies in its own parameters
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      this.mapDragging = true;
      try { e.currentTarget.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
      e.currentTarget.focus({ preventScroll: true });
      this.mapSet(e);
    },
    mapMove(e) { if (this.mapDragging) this.mapSet(e); },
    mapUp() { this.mapDragging = false; },
    mapSet(e) {
      const r = e.currentTarget.getBoundingClientRect();
      if (!r.width) return;
      const x = clamp((e.clientX - r.left) / r.width, 0, 1);
      this.setFrequency(normalizedToFrequency(x, this.rangeMin, this.rangeMax), { silent: true });
    },
    mapKey(e) {
      if (!this.usesGlobalFrequency) return;
      let semis = 0;
      switch (e.key) {
        case 'ArrowRight': case 'ArrowUp': semis = 1; break;
        case 'ArrowLeft': case 'ArrowDown': semis = -1; break;
        case 'PageUp': semis = 12; break;
        case 'PageDown': semis = -12; break;
        case 'Home': e.preventDefault(); this.setFrequency(this.rangeMin); return;
        case 'End': e.preventDefault(); this.setFrequency(this.rangeMax); return;
        default: return;
      }
      e.preventDefault();
      if (Math.abs(semis) === 1) semis *= e.altKey ? 0.01 : e.shiftKey ? 0.1 : 1;
      this.stepSemitone(semis);
    },

    // V1: oscillaApp: setRangeMode, setCustomBound (index.html@a7b7a23)
    setRangeMode(m) {
      this.rangeMode = pick(m, RANGE_MODES.map((r) => r.id), 'human');
      this.rangeError = '';
      this.setFrequency(this.frequency);
    },
    setCustomBound(which, raw) {
      const r = parseFrequency(raw);
      if (!r.ok) { this.rangeError = r.error; return; }
      let v = clamp(r.value, MIN_FREQUENCY, this.safeMax);
      if (which === 'min') {
        if (v * 2 > this.customMax) { this.rangeError = 'Minimum must be at least one octave below the maximum.'; v = this.customMax / 2; } else this.rangeError = '';
        this.customMin = round(v, 2);
      } else {
        if (v < this.customMin * 2) { this.rangeError = 'Maximum must be at least one octave above the minimum.'; v = this.customMin * 2; } else this.rangeError = '';
        if (r.value > this.safeMax) this.rangeError = `Limited to the digital limit ${formatFrequency(this.safeMax)}.`;
        this.customMax = round(v, 2);
      }
      this.customMinText = formatFrequency(this.customMin);
      this.customMaxText = formatFrequency(this.customMax);
      this.setFrequency(this.frequency);
    },
    // V1: oscillaApp.fitRange -> config.js fitRangeOn (index.html@a7b7a23)
    /** Choose the narrowest standard range that contains [lo, hi]. */
    fitRange(lo, hi) { fitRangeOn(this, lo, hi, env(this)); },

    // ============================== patterns
    // V1: oscillaApp: patternsIn, setPattern, paramId, paramTarget, paramValue, setParamError,
    //   setParam, get sequenceInfo (index.html@a7b7a23)
    patternsIn(group) { return PATTERNS.filter((p) => p.group === group); },
    setPattern(id) {
      if (!PATTERN_BY_ID[id]) return;
      this.pattern = id;
      this.source = 'single';
    },
    paramId(d) { return `pp-${this.pattern}-${d.obj}-${d.key}`; },
    paramTarget(d) {
      if (d.obj === 'global') return this;
      if (d.obj === 'sweep') return this.sweep;
      return this.pp[this.pattern];
    },
    paramValue(d) {
      const v = this.paramTarget(d)[d.key];
      return d.type === 'freq' ? formatFrequency(v) : v;
    },
    setParamError(id, msg) {
      const next = { ...this.paramErrors };
      if (msg) next[id] = msg; else delete next[id];
      this.paramErrors = next;
    },
    setParam(d, raw) {
      this.loadedLabel = ''; // an edited preset is no longer the preset
      const id = this.paramId(d);
      const o = this.paramTarget(d);
      if (d.type === 'freq') {
        const r = parseFrequency(raw);
        if (!r.ok) { this.setParamError(id, r.error); return; }
        let v = r.value;
        let msg = '';
        if (v > this.safeMax) { msg = `Above the digital limit; limited to ${formatFrequency(this.safeMax)}.`; v = this.safeMax; }
        if (d.obj === 'global' && d.key === 'frequency') { this.fitRange(v, v); this.setFrequency(v); } else o[d.key] = round(v, 3);
        this.setParamError(id, msg);
        return;
      }
      if (d.type === 'select') { o[d.key] = pick(raw, d.options.map((x) => x[0]), o[d.key]); return; }
      if (d.type === 'text') {
        o[d.key] = String(raw).slice(0, 2000);
        const parsed = parseFrequencyList(o[d.key]);
        if (parsed.invalid.length) this.setParamError(id, `Not frequencies: ${parsed.invalid.slice(0, 4).join(', ')}`);
        else if (!parsed.values.length) this.setParamError(id, 'Enter at least one frequency.');
        else this.setParamError(id, '');
        return;
      }
      const n = String(raw).trim() === '' ? NaN : Number(raw);
      if (!isNum(n)) { this.setParamError(id, 'Enter a number.'); return; }
      let v = d.type === 'int' ? Math.round(n) : n;
      let msg = '';
      if (v < d.min || v > d.max) {
        msg = `Allowed range ${d.min}–${d.max}${d.type === 'ms' ? ' ms' : ''}; value adjusted.`;
        v = clamp(v, d.min, d.max);
      }
      o[d.key] = v;
      this.setParamError(id, msg);
    },
    get sequenceInfo() {
      const parsed = parseFrequencyList(this.pp.sequence.text);
      return `${parsed.values.length} valid · ${parsed.values.filter((f) => f > this.safeMax).length} above the digital limit`;
    },


    // ============================== sweep mode
    // V1: oscillaApp: setSweepFreq, sweepSlider, setSweepSlider, setSweepDuration, setSweepRate,
    //   setSweepRepeat, applySweepPreset (index.html@a7b7a23)
    setSweepFreq(key, raw) {
      const r = parseFrequency(raw);
      if (!r.ok) { this.setParamError(`sweep-${key}`, r.error); return; }
      this.sweep[key] = round(clamp(r.value, MIN_FREQUENCY, this.safeMax), 3);
      this.setParamError(`sweep-${key}`, r.value > this.safeMax ? `Limited to the digital limit ${formatFrequency(this.safeMax)}.` : '');
    },
    sweepSlider(key) { return Math.round(frequencyToNormalized(this.sweep[key], 10, this.safeMax) * 1000); },
    setSweepSlider(key, v) { this.sweep[key] = round(normalizedToFrequency(Number(v) / 1000, 10, this.safeMax), 2); },
    setSweepDuration(raw) {
      const n = Number(raw);
      if (!isNum(n) || n <= 0) { this.setParamError('sweep-duration', 'Duration must be a positive number of seconds.'); return; }
      const ms = clamp(n * 1000, 20, MAX_PROGRAMMED_S * 1000);
      this.setParamError('sweep-duration', ms !== n * 1000 ? `Allowed 0.02–${MAX_PROGRAMMED_S} s; adjusted.` : '');
      this.sweep.durationMs = Math.round(ms);
    },
    setSweepRate(kind, raw) {
      const rate = Number(raw);
      if (!isNum(rate) || rate <= 0) { this.setParamError('sweep-rate', 'Rate must be positive.'); return; }
      const span = kind === 'oct' ? this.sweepSpanOct : Math.abs(this.sweep.end - this.sweep.start);
      if (!(span > 0)) { this.setParamError('sweep-rate', 'Start and end are equal.'); return; }
      this.setSweepDuration(span / rate);
    },
    setSweepRepeat(v) {
      const choice = sweepRepeatChoice(v, this.continuousAllowed, this.sweep.repeat);
      if (choice.locked) {
        this.notify('info', 'Continuous repeat is locked', 'Enable “Allow continuous playback” in Playback safety first.');
        return;
      }
      this.sweep.repeat = choice.repeat;
    },
    applySweepPreset(p) { this.applyPreset(p); },


    // ============================== dual mode
    // V1: oscillaApp: setDualFreq, dualSlider, setDualSlider, nudgeDual, setStereo
    //   (index.html@a7b7a23)
    setDualFreq(side, raw) {
      const r = parseFrequency(raw);
      if (!r.ok) { this.setParamError(`dual-${side}`, r.error); return; }
      this.dual[side].freq = round(clamp(r.value, MIN_FREQUENCY, this.safeMax), 3);
      this.setParamError(`dual-${side}`, r.value > this.safeMax ? `Limited to the digital limit ${formatFrequency(this.safeMax)}.` : '');
    },
    dualSlider(side) { return Math.round(frequencyToNormalized(this.dual[side].freq, 20, Math.min(20000, this.safeMax)) * 1000); },
    setDualSlider(side, v) { this.dual[side].freq = round(normalizedToFrequency(Number(v) / 1000, 20, Math.min(20000, this.safeMax)), 2); },
    nudgeDual(side, hz) { this.dual[side].freq = round(clamp(this.dual[side].freq + hz, MIN_FREQUENCY, this.safeMax), 3); },
    setStereo(on) {
      this.dual.stereo = !!on;
      if (!on) this.dual.binaural = false;
    },
    // V1: oscillaApp: paramUnit, setEnv, onBinauralToggle, requestBinaural, confirmHeadphones
    //   (index.html@a7b7a23)
    /** Spoken unit for a parameter label, unless the visible label already names it. */
    paramUnit(d) {
      if (/\((?:[^)]*\b(?:Hz|kHz|ms|s|dB|%))\)/.test(d.label)) return '';
      return d.type === 'ms' ? ' (milliseconds)' : (d.type === 'hz' || d.type === 'freq') ? ' (hertz)' : '';
    },
    setEnv(key, v) { this.setParam(ENV_PARAMS[key], v); },
    /** The toggle only reflects confirmed state: turning it on opens the headphones dialog first. */
    onBinauralToggle(e) {
      this.requestBinaural(e.target.checked);
      e.target.checked = this.dual.binaural;
    },
    requestBinaural(on) {
      if (!on) { this.dual.binaural = false; return; }
      this.pendingPreset = null;
      this.openModal('headphonesModal');
    },
    confirmHeadphones() {
      const p = this.pendingPreset;
      this.closeModal('headphonesModal');
      if (p) this.applyPreset(p, true);
      this.dual.binaural = true;
      this.dual.stereo = true;
      if (!p && binauralNeedsDefaultPair(this.dualDelta)) {
        this.dual.a.freq = BINAURAL_DEFAULT_PAIR.a;
        this.dual.b.freq = BINAURAL_DEFAULT_PAIR.b;
        this.notify('info', 'Binaural frequencies set', 'A and B were set to 440 / 446 Hz: the demo needs a difference of 0.5–30 Hz.');
      }
      this.pendingPreset = null;
      this.source = 'dual';
    },


    // ============================== presets
    // V1: oscillaApp: presetsFor (index.html@a7b7a23)
    presetsFor(cat) {
      if (cat === 'custom') {
        return this.customPresets.map((p) => ({ id: p.id, cat: 'custom', name: p.name, custom: true,
          desc: `Saved ${new Date(p.created).toLocaleString()}`, params: this.describeConfig(p.cfg), cfg: p.cfg }));
      }
      return BUILTIN_PRESETS.filter((p) => p.cat === cat);
    },
    // V1: oscillaApp.describeConfig, presetMaxFrequency -> data/presets.js; presetDisabled,
    //   presetDisabledReason -> safety.js (index.html@a7b7a23)
    describeConfig(cfg) { return describeConfig(cfg); },
    presetMaxFrequency(cfg) { return presetMaxFrequency(cfg); },
    presetDisabled(p) { return presetDisabled(p, this.safeMax); },
    presetDisabledReason(p) { return presetDisabledReason(p, this.safeMax, this.provisional); },
    // V1: oscillaApp: loadPreset, applyPreset (index.html@a7b7a23)
    loadPreset(p) {
      if (this.presetDisabled(p)) { this.notify('warning', 'Preset unavailable', this.presetDisabledReason(p)); return; }
      if (p.requiresHeadphones) {
        this.pendingPreset = p;
        this.openModal('headphonesModal');
        return;
      }
      this.applyPreset(p);
    },
    applyPreset(p, headphonesConfirmed = false) {
      const issues = this.applyConfig(p.cfg, 'preset');
      if (headphonesConfirmed && p.cfg.dual?.binaural) this.dual.binaural = true;
      this.loadedLabel = p.name;
      if (issues) this.notify('warning', 'Preset partly applied', `${issues} value(s) were invalid and kept at their previous setting.`);
      else this.notify('success', `Loaded “${p.name}”`, this.isProgrammed ? 'Press TRIGGER (or Space) to play it.' : 'Press and hold HOLD TO PLAY.');
    },


    // V1: oscillaApp.loadCustomPresets, migratePreset, persistPresets -> storage.js
    loadCustomPresets() {
      const r = storage.loadCustomPresets(localStore);
      for (const n of r.notices) this.notify(n.level, n.title, n.message);
      return r.presets;
    },
    migratePreset(p) { return storage.migratePreset(p); },
    persistPresets() {
      const r = storage.persistPresets(localStore, this.customPresets);
      for (const n of r.notices) this.notify(n.level, n.title, n.message);
      return r.ok;
    },
    // V1: oscillaApp: openSave, savePreset, requestDelete, cancelDelete, deletePreset,
    //   resetDefaults (index.html@a7b7a23)
    openSave() {
      this.saveName = this.loadedLabel ? `${this.loadedLabel} (copy)` : `${this.describeConfig(this.serializeConfig())}`.slice(0, 60);
      this.saveError = '';
      this.openModal('saveModal');
    },
    savePreset() {
      const name = String(this.saveName || '').trim().slice(0, 60);
      if (!name) { this.saveError = 'Enter a name.'; return; }
      const preset = presetRecord({ id: newPresetId(), name, created: Date.now() }, this.serializeConfig());
      this.customPresets = [preset, ...this.customPresets].slice(0, 200);
      this.persistPresets();
      this.closeModal('saveModal');
      this.presetTab = 'custom';
      this.notify('success', 'Preset saved', `“${name}” is in Presets → Custom.`);
    },
    /** Deleting is two taps: the first arms the button, the second deletes. */
    requestDelete(id) {
      if (this.pendingDelete === id) { this.pendingDelete = null; this.deletePreset(id); return; }
      this.pendingDelete = id;
    },
    cancelDelete(id) { if (this.pendingDelete === id) this.pendingDelete = null; },
    deletePreset(id) {
      this.customPresets = this.customPresets.filter((p) => p.id !== id);
      this.persistPresets();
    },
    resetDefaults() {
      this.stopNow();
      Object.assign(this, defaultInstrumentState());
      this.continuousAllowed = false;
      this.safetyLimit = 2;
      this.noteMode = false;
      this.loadedLabel = '';
      this.paramErrors = {};
      this.setFrequency(440);
      engine.setMasterGain(this.gainLevel);
      this.notify('success', 'Defaults restored', 'All instrument parameters are back to their defaults. Custom presets are kept.');
    },


    // ============================== history
    // V1: oscillaApp.loadHistory, addHistory -> storage.js (index.html@a7b7a23)
    loadHistory() { return storage.loadHistory(sessionStore); },
    addHistory(plan) {
      const entry = storage.historyEntry(plan, this, this.serializeConfig());
      this.history = storage.pushHistory(this.history, entry);
      if (!sessionStore.set(STORAGE_KEYS.history, JSON.stringify(this.history)) && !this._historyWarned) {
        this._historyWarned = true;
        this.notify('warning', 'History not saved', 'sessionStorage is unavailable; history lasts only for this page view.');
      }
    },
    // V1: oscillaApp: recallHistory, clearHistory, historyTime, historyFreqs (index.html@a7b7a23)
    recallHistory(h) {
      const issues = this.applyConfig(h.cfg, 'history');
      this.loadedLabel = h.label;
      this.notify(issues ? 'warning' : 'success', 'Recalled', issues ? 'Some values could not be restored.' : h.label);
    },
    clearHistory() {
      this.history = [];
      sessionStore.remove(STORAGE_KEYS.history);
    },
    historyTime(ts) { return new Date(ts).toLocaleTimeString(); },
    historyFreqs(h) { return h.freqs.slice(0, 4).map((f) => formatFrequency(f)).join(', ') + (h.freqs.length > 4 ? ' …' : ''); },


    // ============================== serialization (URL + presets)
    // V1: oscillaApp.serializeConfig, serializeHash, restoreFromHash -> url-state.js
    serializeConfig() { return urlState.serializeConfig(this); },
    serializeHash() { return urlState.serializeHash(this, this.mode); },
    restoreFromHash() {
      const r = urlState.restoreFromHashOn(this, location.hash, env(this));
      if (!r.handled) return;
      if (r.pendingHashConfig) this.pendingHashConfig = r.pendingHashConfig;
      if (r.mode) this.mode = r.mode;
      for (const n of r.notices) this.notify(n.level, n.title, n.message);
    },
    /**
     * The hash Copy config URL writes: V1 wrote the instrument hash alone; V2 (ui/navigation.js)
     * replaces this with one that keeps the other domains' keys and names the workspace.
     */
    configLinkHash() { return this.serializeHash(); },
    // V1: oscillaApp.copyConfigLink (index.html@a7b7a23); browser APIs via deps.env
    async copyConfigLink() {
      const url = `${location.href.split('#')[0]}#${this.configLinkHash()}`;
      try {
        host.history.replaceState(host.history.state ?? null, '', url);
      } catch (e) { /* file:// in some browsers */ }
      this.copyUrl = url;
      let copied = false;
      try {
        if (host.navigator && host.navigator.clipboard && host.isSecureContext !== false) {
          await host.navigator.clipboard.writeText(url);
          copied = true;
        }
      } catch (e) { copied = false; }
      if (copied) this.notify('success', 'Config link copied', 'The link restores these settings; it never starts playback.');
      else this.openModal('copyModal');
    },

    // V1: oscillaApp.applyConfig -> config.js applyConfigTo (index.html@a7b7a23)
    /**
     * The single validated path for presets, links, history and Learn demos.
     * Returns the number of rejected values; valid values are applied, invalid ones skipped.
     */
    applyConfig(cfg, origin) {
      const r = applyConfigTo(this, cfg, origin, env(this));
      for (const n of r.notices) this.notify(n.level, n.title, n.message);
      return r.issues;
    },

    // ============================== modes, learn, explore
    // V1: oscillaApp: setMode (index.html@a7b7a23)
    setMode(m) {
      if (!APP_MODES.some((x) => x.id === m)) return;
      if (m !== this.mode && m !== 'learn' && m !== 'presets') this.loadedLabel = '';
      this.mode = m;
      if (m === 'playground') this.source = 'single';
      if (m === 'sweep') { this.source = 'sweep'; if (this.vizMode === 'wave' || this.vizMode === 'interference') this.vizMode = 'motion'; }
      if (m === 'dual') { this.source = 'dual'; if (this.vizMode !== 'spectrum') this.vizMode = 'interference'; }
    },
    // V1: oscillaApp: runDemo (index.html@a7b7a23)
    runDemo(topic) {
      const d = topic.demo;
      // A demo that needs another mode's source sets it fully, so earlier settings cannot skew it.
      if (d.cfg && d.cfg.source === 'dual') this.source = 'dual';
      this.applyConfig(d.cfg, 'learn');
      if (d.viz) this.vizMode = d.viz;
      this.loadedLabel = d.label;
      this.notify('success', `Demo ready: ${d.label}`, this.isProgrammed ? 'Press TRIGGER (or Space) to hear it.' : 'Press and hold HOLD TO PLAY.');
    },


    // ============================== alerts, dialogs, microphone
    // V1: oscillaApp: notify, dismissAlert (index.html@a7b7a23)
    notify(level, title, message) {
      if (this.alerts.some((a) => a.title === title && a.message === message)) return;
      const id = ++alertSeq;
      this.alerts = [...this.alerts, { id, level, title, message }].slice(-4);
      if (level === 'success' || level === 'info') setTimeout(() => this.dismissAlert(id), 6000);
      if (level === 'error') engine.lastError = { message: `${title}: ${message}`, context: 'ui' };
    },
    dismissAlert(id) { this.alerts = this.alerts.filter((a) => a.id !== id); },
    // V1: oscillaApp.showSafety (index.html@a7b7a23); innerWidth via deps.env
    showSafety() {
      if (host.innerWidth < 640) this.safetyExpanded = true; else this.safetyCollapsed = false;
    },
    // V1: oscillaApp: collapseSafety (index.html@a7b7a23)
    collapseSafety() {
      this.safetyExpanded = false;
      this.safetyCollapsed = true;
      sessionStore.set(STORAGE_KEYS.safetySeen, '1');
    },
    /** Dialog hooks; the UI layer renders the dialogs (V1 used Flowbite Modal). */
    openModal(id) { if (deps.openModal) deps.openModal(id); },
    closeModal(id) { if (deps.closeModal) deps.closeModal(id); },
    // V1: oscillaApp.toggleMic (index.html@a7b7a23); texts from audio/microphone.js
    async toggleMic() {
      if (this.micPending) return; // a second tap before :disabled renders would open a second stream
      if (this.micActive || engine.mic) {
        engine.stopMic('user');
        this.micActive = false;
        return;
      }
      this.micPending = true;
      try {
        await engine.startMic();
        this.micActive = true;
        this.sampleRate = engine.sampleRate;
        this.vizMode = 'spectrum';
        this.notify('info', 'Microphone active', MIC_PRIVACY_NOTICE);
      } catch (e) {
        this.notify('error', 'Microphone unavailable', micErrorMessage(e));
      } finally {
        this.micPending = false;
      }
    },

    // ============================== visualization + debug
    // V1: oscillaApp.syncViz (index.html@a7b7a23), split as described above
    /**
     * The V1 syncViz effect, split (inventory K2): the plan state (planError, planWarnings,
     * planFreqs, planSummary) is set here, the bridge receives a plain snapshot of the UI state,
     * and the live audio update runs here. Readouts, warnings and live control still depend on
     * this running whenever the instrument state changes (Alpine.effect in the UI layer).
     */
    syncViz() {
      const res = this.currentPlan();
      this.planError = res.ok ? '' : res.error;
      this.planWarnings = res.ok ? res.warnings : [];
      this.planFreqs = res.ok ? res.plan.freqs : [this.frequency];
      this.planSummary = res.ok ? { label: res.plan.label, kind: res.plan.kind, dur: res.plan.dur } : null;
      viz.sync(this.vizInputs(res));
      if (this.playing && res.ok) engine.updateLive(res.plan);
    },
    /** Plain values the visualization bridge needs (what V1 syncViz copied into viz.state). */
    vizInputs(res = this.currentPlan()) {
      return {
        vizMode: this.vizMode, frequency: this.frequency, waveform: this.waveform,
        gain: this.gainLevel, rangeMin: this.rangeMin, rangeMax: this.rangeMax,
        nyquist: this.nyquist, safeMax: this.safeMax, provisional: this.provisional,
        spectrumScale: this.spectrumScale, overlays: this.overlays, a4: this.a4,
        source: this.source, playing: this.playing, status: this.status, dual: this.dual,
        dualFa: this.dualFa, dualFb: this.dualFb, noteText: this.noteText, attack: this.attack,
        release: this.release, plan: res.ok ? res.plan : null, usesGlobal: this.usesGlobalFrequency,
        micActive: this.micActive, paused: this.vizPaused,
      };
    },
    // V1: oscillaApp: get vizCaption, refreshDebug (index.html@a7b7a23)
    get vizCaption() {
      switch (this.vizMode) {
        // both wave layouts are side by side; they differ in where the real-signal readout sits
        case 'wave': return this.waveLayout === 'compact'
          ? 'Left: slowed visual model — visual representation, not real-time physical scale. Right: analyser output. Bottom: signal readout.'
          : 'Left: slowed visual model — visual representation, not real-time physical scale. Right: analyser output.';
        case 'spectrum': return 'Analyser spectrum of the digital output. Vertical axis: relative level in dB, uncalibrated — not SPL.';
        case 'motion': return 'Requested instantaneous frequency over time (logarithmic axis).';
        case 'path': return 'Active Web Audio processing graph. Speaker output is outside what the browser can observe.';
        case 'harmonics': return 'Theoretical oscillator spectrum. Actual speaker output is unknown.';
        case 'interference': return 'Two-oscillator interference from DUAL OSC settings. Carriers slowed; beat rate shown at real speed.';
        default: return '';
      }
    },
    refreshDebug() {
      const ctx = engine.ctx;
      this.debugInfo = {
        'AudioContext state': engine.state,
        sampleRate: ctx ? `${ctx.sampleRate} Hz` : '— (provisional)',
        currentTime: ctx ? ctx.currentTime.toFixed(3) : '—',
        Nyquist: formatFrequency(this.nyquist),
        'safe maximum': formatFrequency(this.safeMax),
        'active sources': engine.activeSourceCount,
        'active nodes': engine.activeNodeCount,
        playing: `${this.playing} (${this.status})`,
        'requested frequency': formatFrequency(this.frequency),
        'instantaneous frequency': this.instFreqText,
        pattern: this.source === 'single' ? this.pattern : this.source,
        'last error': engine.lastError ? engine.lastError.message : '—',
        'p5 FPS': viz.fps ? viz.fps.toFixed(0) : '—',
        visualizer: `${viz.sketchState} · ${this.vizMode}`,
      };
    },
  };
}
