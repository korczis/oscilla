// STUDIO workspace (src/js/ui/studio/workspace.js), file I/O: the library Studio saves to,
// Save, export and import of project, patch and sequence files, the Sequencer's pattern, and
// Render WAV.
//
// Render WAV (§105; plan V427): src/js/studio/offline.js renderStudioOffline on an
// OfflineAudioContext at the render format of the plan (a Recorder node's, else 48 kHz stereo,
// never the device rate, so the same Studio renders the same bytes everywhere), encoded by
// audio/wav.js and downloaded with the exporters' downloadBlob. Progress is shown and announced;
// Abort drops the render. Live-only nodes refuse with the plan's limitation.

import { timelineEnd } from '../../../studio/timeline.js';
import { planOfflineRender, renderStudioOffline } from '../../../studio/offline.js';
import { DEFAULT_RENDER } from '../../../audio/offline-renderer.js';
import {
  createStudioLibrary, exportProjectFile, exportSequenceFile, fileSlug, importStudioFile,
} from '../../../studio/library.js';
import { importSequence } from '../../../studio/sequence-import.js';
import { announceAction } from '../../../studio/a11y.js';
import { observeMemoryStore, openExperimentStoreOrMemory } from '../../../experiments/store.js';
import { pageIndexedDb } from '../../experiments.js';
import { KNOWN_ALGORITHM_IDS } from '../../../measurement/algorithms.js';
import { openModal, closeModal } from '../../dialogs.js';
import { downloadBlob, readFileText } from '../../exporters.js';
import { STUDIO_STORE_FALLBACK_TEXT, recordId } from '../patches-panel.js';
import { IDLE_TASK } from './measurement.js';

/** Largest Studio file read from disk (the import pipeline re-checks every limit). */
export const STUDIO_FILE_MAX_BYTES = 4 * 1024 * 1024;

/**
 * The Studio task view of a WAV render progress report (offline.js onProgress) — plain data:
 * { active, kind: 'render', label, pct, text, abortable }.
 */
export function renderTaskView(p) {
  const stage = p && p.stage === 'encode' ? 'encode' : 'render';
  const pct = Math.max(0, Math.min(100, Math.round(100 * (p && Number.isFinite(p.fraction)
    ? p.fraction : 0))));
  return { active: true, kind: 'render', label: stage === 'encode' ? 'Encoding WAV'
    : 'Rendering WAV', pct, text: `${pct} %`, abortable: true };
}

/** Why Render WAV is unavailable while a Studio task runs (its aria-describedby note). */
export function renderBlockedText(task) {
  return `Render WAV is unavailable while a Studio task runs${task && task.label
    ? ` (${task.label})` : ''}: let it finish or abort it first.`;
}

/** The WAV file name of a Studio render. */
export function renderFileName(model) {
  return `${fileSlug(model.metadata.title)}.wav`;
}

/** Render length offered when the Studio has no timeline (a graph without clips), s. */
export const RENDER_DEFAULT_S = 2;

/**
 * The Render WAV dialog's form for `model` (plain data): the duration offered (the timeline's
 * end, else RENDER_DEFAULT_S), the format the plan renders, its limitations, and whether the
 * plan refuses (a live input). opts: { registry, duration }.
 */
export function renderForm(model, { registry, duration = null } = {}) {
  const end = timelineEnd(model);
  // The default render covers the timeline, the graph's start time and the fade-out (offline.js
  // defaultRenderDuration), so the last clip is rendered whole.
  const auto = end > 0 ? planOfflineRender(model, { registry }).duration : null;
  const d = duration != null ? duration
    : end > 0 ? (auto ?? Number(end.toFixed(3))) : RENDER_DEFAULT_S;
  const plan = planOfflineRender(model, { duration: d, registry });
  const r = plan.render;
  return {
    duration: String(d),
    note: end > 0 ? `The timeline ends at ${Number(end.toFixed(3))} s; the render adds the `
      + 'graph\'s start time and its fade-out.'
      : `The Studio has no timeline: the graph is rendered for the duration given.`,
    format: `${r.sampleRate / 1000} kHz · ${r.channels === 1 ? 'mono' : 'stereo'} · 16-bit WAV`
      + ' · rendered offline, not from the device output',
    limitations: plan.limitations.slice(),
    refused: plan.refused,
    error: '',
  };
}

/** The render duration typed in the dialog: { ok, value } or { ok: false, error }. */
export function parseRenderDuration(text) {
  const v = Number(String(text ?? '').trim().replace(',', '.').replace(/\s*s$/i, ''));
  if (!(Number.isFinite(v) && v > 0)) return { ok: false, error: 'Give a duration in seconds.' };
  if (v > DEFAULT_RENDER.maxDuration) {
    return { ok: false, error: `A render is limited to ${DEFAULT_RENDER.maxDuration} s.` };
  }
  return { ok: true, value: v };
}

/**
 * The file I/O functions over `ctx` (`ops` holds those of the other parts), and their members
 * of the component. -> { ops, part }
 */
export function createWorkspaceFiles(ctx, svc, ops) {
  const { registry } = ctx;

  /** The running context's rate, or null before audio (a V2 sequence file is read at it). */
  const studioSampleRate = () => (svc.engine ? svc.engine.sampleRate : null);

  function library() {
    if (ctx.lib) return Promise.resolve(ctx.lib);
    if (!ctx.libOpening) {
      ctx.libOpening = openExperimentStoreOrMemory({
        indexedDB: pageIndexedDb(), // guarded: reading it throws in some private modes
        storage: typeof navigator !== 'undefined' ? navigator.storage : null,
        knownAlgorithms: KNOWN_ALGORITHM_IDS,
      }).then((r) => {
        // The memory fallback says what it holds: a reload discards it (ui/unsaved.js).
        ctx.lib = createStudioLibrary(observeMemoryStore(r.store, (held) => {
          if (ctx.cmp) ctx.cmp.studio.memoryHeld = held.studio;
        }));
        if (ctx.cmp) {
          ctx.cmp.studio.persistent = ctx.lib.persistent;
          ctx.cmp.studio.storeNote = ctx.lib.persistent ? '' : STUDIO_STORE_FALLBACK_TEXT;
        }
        return ctx.lib;
      });
    }
    return ctx.libOpening;
  }

  function downloadFile(f) {
    downloadBlob(new Blob([f.text], { type: f.type }), f.name);
  }

  const part = {
    /**
     * Render WAV (plan V427): the Studio offline through offline.js, encoded and downloaded.
     * Resolves { ok, name, bytes, sampleRate, channels, duration, stats, limitations,
     * warnings, wav } or { ok: false, aborted?, reason }.
     */
    /** Render WAV… (toolbar): the dialog with the duration, the format and the limitations. */
    /** Why Render WAV is unavailable now ('' when it is available). */
    studioRenderBlocked() {
      return this.studio.task.active ? renderBlockedText(this.studio.task) : '';
    },

    studioOpenRender() {
      if (ctx.render) return false;
      if (this.studio.task.active) {
        // aria-disabled, not disabled: the reason stays reachable (focus, the note it names).
        ops.announce(renderBlockedText(this.studio.task), { assertive: true });
        return false;
      }
      this.studio.renderForm = renderForm(ctx.handle.getModel(), { registry });
      openModal('osc-dlg-studio-render');
      requestAnimationFrame(() => {
        const el = document.getElementById('osc-st-render-dur');
        if (el) el.select();
      });
      return true;
    },

    /** The dialog's Render: validate the duration, close, render. */
    studioRenderSubmit() {
      const f = this.studio.renderForm;
      const d = parseRenderDuration(f.duration);
      if (!d.ok) {
        f.error = d.error;
        ops.announce(d.error, { assertive: true });
        return null;
      }
      closeModal('osc-dlg-studio-render');
      return this.studioRenderWav({ duration: d.value });
    },

    async studioRenderWav({ duration = null } = {}) {
      if (ctx.render) return { ok: false, reason: 'A render is already in progress.' };
      const model = ctx.handle.getModel();
      const plan = planOfflineRender(model, { registry, duration });
      if (!plan.ok) {
        const why = plan.limitations[0] || (plan.errors[0] && plan.errors[0].message)
          || 'the Studio cannot be rendered';
        const msg = `Not rendered: ${why}`;
        this.studio.warning = msg;
        ops.announce(msg, { assertive: true });
        return { ok: false, reason: msg, plan };
      }
      const controller = new AbortController();
      ctx.render = { controller };
      ops.setTask(renderTaskView({ stage: 'render', fraction: 0 }));
      ops.announce('Rendering WAV');
      let lastPct = 0;
      try {
        const r = await renderStudioOffline(model, { registry, wav: true, duration,
          signal: controller.signal,
          onProgress: (p) => {
            const v = renderTaskView(p);
            ops.setTask(v);
            if (v.pct >= lastPct + 50 && v.pct < 100) {
              lastPct = v.pct;
              ops.announce(`Rendering WAV, ${v.pct} %`);
            }
          } });
        if (r.aborted) {
          ops.announce('WAV render aborted');
          return { ok: false, aborted: true, reason: r.errors[0] };
        }
        if (!r.ok) {
          const msg = `Not rendered: ${r.limitations[0] || r.errors[0]}`;
          this.studio.warning = msg;
          ops.announce(msg, { assertive: true });
          return { ok: false, reason: msg };
        }
        const name = renderFileName(model);
        downloadBlob(new Blob([r.wav], { type: 'audio/wav' }), name);
        const b = r.buffer;
        const peak = Number.isFinite(r.stats.peakDbfs)
          ? `peak ${r.stats.peakDbfs.toFixed(1)} dBFS` : 'silent';
        const notes = [...plan.limitations, ...r.warnings];
        this.studio.warning = notes.length ? `Rendered with limits: ${notes[0]}${notes.length > 1
          ? ` (+${notes.length - 1} more)` : ''}` : '';
        ops.announce(`Rendered ${name}: ${b.duration.toFixed(2)} s, ${b.sampleRate} Hz, `
          + `${b.numberOfChannels === 1 ? 'mono' : 'stereo'}, 16-bit WAV, ${peak}`);
        return { ok: true, name, bytes: r.wav.byteLength, sampleRate: b.sampleRate,
          channels: b.numberOfChannels, duration: b.duration, stats: r.stats,
          limitations: plan.limitations.slice(), warnings: r.warnings.slice(), wav: r.wav };
      } catch (e) {
        const msg = `Not rendered: ${(e && e.message) || e}`;
        ops.announce(msg, { assertive: true });
        return { ok: false, reason: msg };
      } finally {
        ctx.render = null;
        ops.setTask(IDLE_TASK);
      }
    },

    /** The patch library (K102), from the Synth, the Studio or the Inspector's Presets. */
    patchLibraryOpen(opts = {}) {
      if (ctx.browser) ctx.browser.open({ from: this.workspace, ...opts });
    },
    studioOpenLibrary() {
      if (ctx.patches) ctx.patches.openLibrary();
    },
    /** The library Studio saves to (ui/connections.js reads the stored projects through it). */
    studioLibrary() {
      return library();
    },
    /**
     * Show stored project `id` in the Projects and patches dialog, focused, with its connected
     * records open (ADR 0048). Nothing is loaded: Open there stays explicit.
     */
    async studioShowProject(id) {
      if (!ctx.patches) return false;
      return ctx.patches.openLibrary({ focusId: id });
    },

    async studioSave() {
      try {
        const lib = await library();
        const model = ctx.handle.getModel();
        const existing = (await lib.list({ kind: 'oscilla-studio' })).map((r) => r.id);
        const id = recordId('project', model.metadata.title, existing, ctx.projectId);
        const summary = await lib.saveProject(model, { id, now: new Date() });
        ctx.projectId = id;
        ctx.dirty.markSaved(model, { id, savedAt: summary.savedAt });
        ops.refreshState();
        ops.announce(`Saved ${summary.name}${lib.persistent ? '' : ' (this page view only)'}`);
        return summary;
      } catch (e) {
        ops.announce(`Not saved: ${(e && e.message) || e}`, { assertive: true });
        return null;
      }
    },

    studioExport() {
      try {
        const model = ctx.handle.getModel();
        const f = exportProjectFile(model);
        downloadFile(f);
        ctx.dirty.markSaved(model, { target: 'file' });
        ops.refreshState();
        ops.announce(`Exported ${f.name}`);
        return f;
      } catch (e) {
        ops.announce(`Not exported: ${(e && e.message) || e}`, { assertive: true });
        return null;
      }
    },

    studioImportClick() {
      const input = document.getElementById('osc-studio-import-file');
      if (input) input.click();
    },

    async studioImportFile(event) {
      const input = event && event.target;
      const file = input && input.files && input.files[0];
      if (input) input.value = '';
      if (!file) return null;
      try {
        const text = await readFileText(file, { maxBytes: STUDIO_FILE_MAX_BYTES,
          what: 'The Studio file' });
        return this.studioImportText(text);
      } catch (e) {
        ops.announce(`Not imported: ${(e && e.message) || e}`, { assertive: true });
        return null;
      }
    },

    /**
     * The V2 sequence file of one event track (default: the first with pattern clips), at the
     * Studio's rate. No control calls it yet (K004 part: the entry point is the owner's choice).
     */
    studioExportTrackSequence(trackId = null) {
      try {
        const f = exportSequenceFile(ctx.handle.getModel(), { trackId: trackId || undefined,
          sampleRate: studioSampleRate() });
        downloadFile(f);
        ops.announce(`Exported ${f.name}${f.issues.length ? `: ${f.issues.join(' ')}` : ''}`,
          { assertive: f.issues.length > 0 });
        return f;
      } catch (e) {
        ops.announce(`Not exported: ${(e && e.message) || e}`, { assertive: true });
        return null;
      }
    },

    /**
     * The Sequencer's own pattern as a Studio document (U010; links.md P4). The V2 sequence the
     * Sequencer holds now (svc.currentSequence, sequencer/model.js serializeSequence) goes
     * through importSequence, the pipeline of a sequence file (K004), and opens as a new
     * document; Studio then edits its copy, the Sequencer keeps its own. Unsaved Studio changes
     * are never replaced: nothing opens and the notice says so. A modified click is left to the
     * browser (the link's address opens Studio). -> { ok, clips? , reason? }
     */
    studioOpenSequence(e) {
      if (e && (e.button > 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey)) return null;
      if (e && typeof e.preventDefault === 'function') e.preventDefault();
      const seq = typeof svc.currentSequence === 'function' ? svc.currentSequence() : null;
      if (!seq) {
        this.notify('warning', 'Pattern not opened', 'The Sequencer is not available here.');
        return { ok: false, reason: 'no-sequencer' };
      }
      const r = importSequence(seq, { sampleRate: studioSampleRate(),
        title: 'Sequencer pattern' });
      if (!r.ok) {
        const why = (r.errors && r.errors[0] && r.errors[0].message) || 'invalid pattern';
        this.notify('warning', 'Pattern not opened', `${why}. Nothing was changed.`);
        return { ok: false, reason: why };
      }
      if (ctx.dirty && ctx.dirty.isDirty(ctx.handle.getModel())) {
        this.notify('warning', 'Pattern not opened', 'This Studio has unsaved changes, so the '
          + 'pattern did not replace them. Save or export them in Studio, then open the pattern '
          // data-osc-link: alert.action
          + 'again.', { action: { href: '#m=studio', text: 'Open Studio' } });
        ops.announce('The pattern was not opened: this Studio has unsaved changes.',
          { assertive: true });
        return { ok: false, reason: 'unsaved' };
      }
      ops.openDocument(r.model, { reason: 'import' });
      this.setWorkspace('studio', { focusHeading: true });
      const n = r.model.timeline.clips.length;
      const issues = r.issues && r.issues.length ? ` ${r.issues.join(' ')}` : '';
      this.notify('info', 'Pattern opened in Studio', `${n} pattern clip${n === 1 ? '' : 's'} `
        + `on one track, a copy of the Sequencer's pattern.${issues} Nothing plays until you `
        + 'press Play.');
      ops.announce(`Opened the Sequencer pattern in Studio: ${n} pattern clip${
        n === 1 ? '' : 's'}`);
      return { ok: true, clips: n };
    },

    /**
     * Import a project or a V2 sequence or configuration file (replaces the document), or a
     * patch (inserted, undoable). A refused file leaves the document as it was.
     */
    studioImportText(text) {
      const r = importStudioFile(text, { sampleRate: studioSampleRate() });
      if (!r.ok) {
        const e = r.errors && r.errors[0];
        const msg = `Not imported: ${e ? `${e.path ? `${e.path}: ` : ''}${e.message}`
          : 'invalid file'}`;
        ops.announce(msg, { assertive: true });
        this.studio.warning = msg; // stays visible until the next document opens
        return { ok: false, reason: msg };
      }
      if (r.kind === 'patch') {
        const res = ctx.handle.dispatch({ type: 'PATCH_INSERT', patch: r.patch });
        ops.announce(announceAction(res), { assertive: !res.ok });
        return res;
      }
      ops.openDocument(r.model, { reason: 'import' });
      if (r.kind === 'sequence') {
        const n = r.model.timeline.clips.length;
        ops.announce(`Imported the ${r.source === 'config' ? 'configuration file\'s ' : ''}V2 `
          + `sequence: ${n} pattern clip${n === 1 ? '' : 's'} on one track`);
        return { ok: true, kind: 'sequence', clips: n };
      }
      ops.announce(`Imported ${r.model.metadata.title}`);
      return { ok: true, kind: 'project' };
    },
  };
  return { ops: { library, downloadFile }, part };
}
