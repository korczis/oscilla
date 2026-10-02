// OSCILLA V2 pattern sequencer: Alpine-facing editor controller.
//
// createSequencerEditor() returns a plain object of state and methods that Alpine can use as
// component data (Alpine.data('sequencer', () => createSequencerEditor({ engine }))). It never
// builds DOM: the visual shell owns the markup and calls these methods.
//
// Reactive fields (model, selectedId, playing, ...) are plain data and are always replaced, never
// mutated in place, because model operations are immutable. Methods use `this`, so call them as
// methods of the returned object (or of Alpine's proxy of it). Web Audio objects (the context,
// voices, timers) live in a closure and are never placed into reactive state.
//
// Engine adapter (injected): {
//   ctx | getContext(),            the running AudioContext (the engine creates it in the gesture)
//   destination | getDestination(), the node the sequence plays into (e.g. engine master input)
//   resume?(),                     resume a suspended context
//   onStart?({ t0, duration }),    playback started (status bar)
//   onEnded?({ stopped }),         playback fully ended (natural end or after a stop fade)
//   onRecord?(sequenceJson),       the record-style button: hand the sequence to the WAV export
// }
//
// Looping: each pass is compiled as its own voice that starts exactly at the previous pass's
// end time on the audio clock. A timer only decides *when* to compile the next pass (LOOKAHEAD_S
// ahead); it never times audio. Edits made during playback apply from the next pass.

import {
  BLOCK_TYPES,
  BLOCK_SCHEMA,
  PROVISIONAL_SAMPLE_RATE,
  MAX_BLOCKS,
  isNum,
  addBlock,
  deleteBlock,
  duplicateBlock,
  moveBlock,
  moveEarlier,
  moveLater,
  updateBlockWithIssues,
  selectBlock,
  neighbourAfterDelete,
  indexOfBlock,
  getBlock,
  setTempo,
  setLoop,
  setWaveform,
  setDurationUnit,
  totalDuration,
  blockStartTimes,
  serializeSequence,
  parseSequence,
  referenceSequence,
  createSequence,
  describeBlock,
} from './model.js';
import { compileSequence, START_OFFSET_S } from './compiler.js';
import { reorderTarget } from './timeline.js';

export const LOOKAHEAD_S = 1.0; // compile the next loop pass this far ahead of its start
const MAX_QUEUED_PASSES = 16; // guard for very short looped sequences

function isEditableTarget(el) {
  if (!el) return false;
  if (el.isContentEditable) return true;
  return ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName);
}

function defaultTimers() {
  if (typeof globalThis.setTimeout !== 'function') return null;
  return {
    setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
    clearTimeout: (id) => globalThis.clearTimeout(id),
  };
}

/**
 * options: { model (default: the reference sequence), engine (adapter, see above),
 *            sampleRate (fallback before a context exists), timers }
 */
export function createSequencerEditor(options = {}) {
  const engine = options.engine || null;
  const timers = options.timers === undefined ? defaultTimers() : options.timers;
  const priv = {
    voices: new Set(),
    passes: [], // [{ voice, t0, end }] in start order
    lastEnd: null,
    loopTimer: null,
    self: null,
  };
  const resolve = (key, getter) => {
    if (!engine) return null;
    if (typeof engine[getter] === 'function') return engine[getter]();
    return engine[key] || null;
  };
  const getCtx = () => resolve('ctx', 'getContext');
  const getDest = () => resolve('destination', 'getDestination');
  const clearLoopTimer = () => {
    if (priv.loopTimer !== null && timers) timers.clearTimeout(priv.loopTimer);
    priv.loopTimer = null;
  };
  const currentPass = (now) => {
    let found = null;
    for (const p of priv.passes) if (p.t0 <= now) found = p;
    return found || priv.passes[0] || null;
  };

  const initial = options.model
    ? parseSequence(options.model, { sampleRate: options.sampleRate }).model
    : referenceSequence({ sampleRate: options.sampleRate });

  return {
    // ---------------------------------------------------------------- reactive state
    model: initial,
    selectedId: initial.blocks.length ? initial.blocks[0].id : null,
    playing: false,
    error: '',
    warnings: [],
    dragFromIndex: -1,
    dragInsertIndex: -1,
    recordAvailable: !!(engine && typeof engine.onRecord === 'function'),
    blockTypes: BLOCK_TYPES,
    schema: BLOCK_SCHEMA,

    // ---------------------------------------------------------------- derived
    get selectedBlock() {
      return getBlock(this.model, this.selectedId);
    },
    get selectedIndex() {
      return indexOfBlock(this.model, this.selectedId);
    },
    get totalDurationS() {
      return totalDuration(this.model);
    },
    get blockStarts() {
      return blockStartTimes(this.model);
    },
    get canAdd() {
      return this.model.blocks.length < MAX_BLOCKS;
    },
    sampleRate() {
      const ctx = getCtx();
      if (ctx && isNum(ctx.sampleRate)) return ctx.sampleRate;
      return isNum(options.sampleRate) ? options.sampleRate : PROVISIONAL_SAMPLE_RATE;
    },
    describe(block) {
      return describeBlock(block);
    },
    paramsOf(type) {
      return (BLOCK_SCHEMA[type] || { params: [] }).params;
    },

    // ---------------------------------------------------------------- selection
    selectBlock(id) {
      this.selectedId = selectBlock(this.model, id);
      return this.selectedId;
    },
    selectRelative(delta) {
      const n = this.model.blocks.length;
      if (!n) {
        this.selectedId = null;
        return null;
      }
      const i = this.selectedIndex;
      let next;
      if (!Number.isFinite(delta)) next = delta < 0 ? 0 : n - 1;
      else if (i < 0) next = delta > 0 ? 0 : n - 1;
      else next = Math.min(n - 1, Math.max(0, i + delta));
      this.selectedId = this.model.blocks[next].id;
      return this.selectedId;
    },

    // ---------------------------------------------------------------- editing
    _apply(model, issues = []) {
      this.model = model;
      this.warnings = issues;
      if (this.selectedId !== null && indexOfBlock(model, this.selectedId) < 0)
        this.selectedId = null;
    },
    /** Add a block after the selection (or at the end) and select it. Returns the id or null. */
    addBlock(type) {
      if (!BLOCK_SCHEMA[type]) {
        this.error = `Unknown block type “${String(type)}”.`;
        return null;
      }
      if (!this.canAdd) {
        this.error = `The sequence is full (${MAX_BLOCKS} blocks).`;
        return null;
      }
      const i = this.selectedIndex;
      const index = i >= 0 ? i + 1 : this.model.blocks.length;
      const model = addBlock(this.model, type, { index, sampleRate: this.sampleRate() });
      this.error = '';
      this._apply(model);
      this.selectedId = model.blocks[index].id;
      return this.selectedId;
    },
    deleteSelected() {
      const id = this.selectedId;
      if (id === null) return false;
      const next = neighbourAfterDelete(this.model, id);
      this._apply(deleteBlock(this.model, id));
      this.selectedId = next;
      return true;
    },
    duplicateSelected() {
      const i = this.selectedIndex;
      if (i < 0) return null;
      if (!this.canAdd) {
        this.error = `The sequence is full (${MAX_BLOCKS} blocks).`;
        return null;
      }
      const model = duplicateBlock(this.model, this.selectedId);
      this._apply(model);
      this.selectedId = model.blocks[i + 1].id;
      return this.selectedId;
    },
    /** dir < 0 moves earlier, dir > 0 later. Returns true when the order changed. */
    moveSelected(dir) {
      const id = this.selectedId;
      if (id === null) return false;
      const before = this.model;
      const model = dir < 0 || dir === 'earlier' ? moveEarlier(before, id) : moveLater(before, id);
      if (model === before) return false;
      this._apply(model);
      return true;
    },
    moveBlockTo(from, to) {
      const before = this.model;
      const model = moveBlock(before, from, to);
      if (model === before) return false;
      this._apply(model);
      return true;
    },
    /** Patch the selected block: { type?, durationMs?, beats?, params? }. */
    updateSelected(patch) {
      const id = this.selectedId;
      if (id === null) return false;
      const res = updateBlockWithIssues(this.model, id, patch, { sampleRate: this.sampleRate() });
      this._apply(res.model, res.issues);
      return true;
    },
    /** One field of the selected block: 'durationMs', 'beats', 'type' or a param key. */
    updateParam(key, value) {
      if (key === 'durationMs' || key === 'beats' || key === 'type')
        return this.updateSelected({ [key]: value });
      return this.updateSelected({ params: { [key]: value } });
    },
    setDurationUnit(unit) {
      if (this.selectedId === null) return false;
      this._apply(setDurationUnit(this.model, this.selectedId, unit));
      return true;
    },
    setTempo(bpm) {
      this._apply(setTempo(this.model, bpm));
    },
    setLoop(on) {
      this._apply(setLoop(this.model, on));
      if (this.playing && this.model.loop) this._pump();
    },
    setWaveform(w) {
      this._apply(setWaveform(this.model, w));
    },
    clear() {
      this._apply(createSequence({ tempoBpm: this.model.tempoBpm }));
      this.selectedId = null;
    },

    // ---------------------------------------------------------------- drag and drop
    dragStart(index) {
      this.dragFromIndex = index >= 0 && index < this.model.blocks.length ? index : -1;
      this.dragInsertIndex = -1;
      if (this.dragFromIndex >= 0) this.selectedId = this.model.blocks[index].id;
    },
    /** insertIndex: 0..blocks.length (timeline.dropIndexAt). */
    dragOver(insertIndex) {
      if (this.dragFromIndex < 0) return;
      this.dragInsertIndex = Math.max(0, Math.min(this.model.blocks.length, insertIndex));
    },
    drop(insertIndex) {
      const ins = isNum(insertIndex) ? insertIndex : this.dragInsertIndex;
      const to = reorderTarget(this.dragFromIndex, ins, this.model.blocks.length);
      const moved = to >= 0 ? this.moveBlockTo(this.dragFromIndex, to) : false;
      this.dragEnd();
      return moved;
    },
    dragEnd() {
      this.dragFromIndex = -1;
      this.dragInsertIndex = -1;
    },

    // ---------------------------------------------------------------- keyboard
    /**
     * Timeline keyboard model: Arrow keys / Home / End select, Alt+Arrow moves the selected
     * block, Delete or Backspace removes it, Ctrl/Cmd+D duplicates, Escape cancels a drag.
     * Returns true (and calls preventDefault) when the key was handled.
     */
    onKeydown(e) {
      if (!e || isEditableTarget(e.target)) return false;
      const k = e.key;
      let handled = true;
      if (e.altKey && (k === 'ArrowLeft' || k === 'ArrowUp')) this.moveSelected(-1);
      else if (e.altKey && (k === 'ArrowRight' || k === 'ArrowDown')) this.moveSelected(1);
      else if ((e.ctrlKey || e.metaKey) && (k === 'd' || k === 'D')) this.duplicateSelected();
      else if (e.altKey || e.ctrlKey || e.metaKey) handled = false;
      else if (k === 'ArrowLeft' || k === 'ArrowUp') this.selectRelative(-1);
      else if (k === 'ArrowRight' || k === 'ArrowDown') this.selectRelative(1);
      else if (k === 'Home') this.selectRelative(-Infinity);
      else if (k === 'End') this.selectRelative(Infinity);
      else if (k === 'Delete' || k === 'Backspace') this.deleteSelected();
      else if (k === 'Escape' && this.dragFromIndex >= 0) this.dragEnd();
      else handled = false;
      if (handled && typeof e.preventDefault === 'function') e.preventDefault();
      return handled;
    },

    // ---------------------------------------------------------------- transport
    _schedulePass(ctx, t0) {
      const self = priv.self;
      const voice = compileSequence(self.model, ctx, getDest(), t0, {
        timers,
        onEnded: (info) => self._voiceEnded(voice, info),
      });
      if (voice.ended) return null; // empty sequence
      priv.voices.add(voice);
      priv.passes.push({ voice, t0: voice.t0, end: voice.endTime });
      priv.lastEnd = voice.endTime;
      if (voice.warnings.length) self.warnings = voice.warnings;
      return voice;
    },
    _voiceEnded(voice, info) {
      priv.voices.delete(voice);
      priv.passes = priv.passes.filter((p) => p.voice !== voice);
      if (priv.voices.size === 0 && priv.loopTimer === null) {
        const self = priv.self || this;
        self.playing = false;
        if (engine && typeof engine.onEnded === 'function') {
          try {
            engine.onEnded({ stopped: !!(info && info.stopped) });
          } catch (e) {
            /* theirs */
          }
        }
      }
    },
    _pump() {
      clearLoopTimer();
      const self = priv.self || this;
      const ctx = getCtx();
      if (!ctx || !self.playing || !self.model.loop || !timers) return;
      let queued = 0;
      for (const v of priv.voices) if (!v.stopping && v.t0 > ctx.currentTime) queued++;
      while (
        priv.lastEnd !== null &&
        priv.lastEnd - ctx.currentTime < LOOKAHEAD_S &&
        queued < MAX_QUEUED_PASSES
      ) {
        const v = self._schedulePass(ctx, Math.max(priv.lastEnd, ctx.currentTime + START_OFFSET_S));
        if (!v) {
          self.stop();
          return;
        }
        queued++;
      }
      const wait = Math.max(50, (priv.lastEnd - LOOKAHEAD_S - ctx.currentTime) * 1000);
      priv.loopTimer = timers.setTimeout(() => {
        priv.loopTimer = null;
        self._pump();
      }, wait);
    },
    /** Start (or restart) playback from the first block. Returns true when audio was scheduled. */
    play() {
      priv.self = this;
      const ctx = getCtx();
      const dest = getDest();
      if (!ctx || !dest) {
        this.error = 'Audio is not available yet.';
        return false;
      }
      if (!this.model.blocks.length) {
        this.error = 'Add a block first.';
        return false;
      }
      this._stopVoices();
      if (typeof engine.resume === 'function') {
        try {
          engine.resume();
        } catch (e) {
          /* the engine reports its own errors */
        }
      }
      this.error = '';
      this.playing = true;
      const voice = this._schedulePass(ctx, ctx.currentTime + START_OFFSET_S);
      if (!voice) {
        this.playing = false;
        return false;
      }
      if (typeof engine.onStart === 'function') {
        try {
          engine.onStart({ t0: voice.t0, duration: voice.duration });
        } catch (e) {
          /* theirs */
        }
      }
      if (this.model.loop) this._pump();
      return true;
    },
    _stopVoices() {
      clearLoopTimer();
      for (const v of [...priv.voices]) v.stop();
    },
    /** Stop with a short click-free fade; every node is released after the fade. */
    stop() {
      priv.self = priv.self || this;
      const wasPlaying = this.playing;
      this._stopVoices();
      this.playing = false;
      return wasPlaying;
    },
    restart() {
      return this.play();
    },
    togglePlay() {
      return this.playing ? (this.stop(), false) : this.play();
    },
    /** Record-style button: hands the sequence to the export (WAV via OfflineAudioContext). */
    record() {
      if (!this.recordAvailable) return false;
      try {
        engine.onRecord(serializeSequence(this.model));
      } catch (e) {
        this.error = String(e && e.message);
        return false;
      }
      return true;
    },

    // ---------------------------------------------------------------- readouts (audio clock)
    /** Seconds into the current pass, or null when stopped. */
    playheadTime() {
      const ctx = getCtx();
      if (!ctx || !this.playing || !priv.passes.length) return null;
      const now = ctx.currentTime;
      const p = currentPass(now);
      if (!p) return null;
      return Math.max(0, Math.min(p.end - p.t0, now - p.t0));
    },
    /** { t0, duration } of the pass under the audio clock, for timeline.playheadPosition. */
    currentPassTiming() {
      const ctx = getCtx();
      if (!ctx || !priv.passes.length) return null;
      const p = currentPass(ctx.currentTime);
      return p ? { t0: p.t0, duration: p.end - p.t0 } : null;
    },
    activeBlockIndex() {
      const ctx = getCtx();
      if (!ctx || !this.playing) return -1;
      const p = currentPass(ctx.currentTime);
      return p ? p.voice.blockIndexAt(ctx.currentTime) : -1;
    },
    /** Requested frequency now (null in silences and gaps, or when stopped). */
    currentFrequency() {
      const ctx = getCtx();
      if (!ctx || !this.playing) return null;
      const p = currentPass(ctx.currentTime);
      return p ? p.voice.freqAt(ctx.currentTime) : null;
    },
    stats() {
      let activeSourceCount = 0;
      let activeNodeCount = 0;
      for (const v of priv.voices) {
        activeSourceCount += v.activeSourceCount;
        activeNodeCount += v.activeNodeCount;
      }
      return { voices: priv.voices.size, activeSourceCount, activeNodeCount };
    },

    // ---------------------------------------------------------------- persistence
    serialize() {
      return serializeSequence(this.model);
    },
    /** Load JSON (object or string). Returns the list of issues found while validating. */
    load(json) {
      const { model, issues } = parseSequence(json, { sampleRate: this.sampleRate() });
      this._apply(model, issues);
      this.selectedId = model.blocks.length ? model.blocks[0].id : null;
      return issues;
    },
    dispose() {
      clearLoopTimer();
      for (const v of [...priv.voices]) v.dispose();
      priv.voices.clear();
      priv.passes = [];
      this.playing = false;
    },
  };
}
