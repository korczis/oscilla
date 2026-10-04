// STUDIO workspace: the DOM/Alpine adapter of OSCILLA Studio (spec §127-§141, §154-§158,
// §185, §194-§198; plan V409-V413, V421-V423 UI, V426 UI, V428-V429). Composed into the ONE
// OSCILLA component by main.js (Object.defineProperties, never spread), like measure.js.
//
// One canonical state (§9, rule project.studio-model-is-canonical): ONE store
// (src/js/studio/actions.js createStudioStore) behind a stable handle; the full graph editor,
// the Inspector, the library, the compact Playground widget, the timeline region and the patch
// dialogs are projections that read it and dispatch actions to it. Opening a project or a
// template swaps the document behind the handle (a new history, like opening a file); the
// handle's revision stays monotonic so the transport always re-applies.
//
// Audio (§41-§46, §180-§186; rule project.audio-engine-discipline): the transport
// (src/js/studio/transport.js) plays the store's model on the ONE AudioEngine through the Studio
// runtime (src/js/studio/runtime.js); every model change reaches the runtime through
// transport.sync() (transactional, crossfaded by the runtime). The playhead text observes
// AudioContext time through transport.playhead() in requestAnimationFrame: rAF only paints, it
// never schedules audio. STOP and Escape release everything (runtime.stop: 0 nodes afterwards).
// Exclusivity (decision "Studio output and the Playground voice are exclusive"): PLAY claims the
// output (stops the instrument and the sequencer; refused while a measurement owns it), and the
// instrument or the sequencer starting stops the Studio.
//
// Measurement clips (§106-§110; plan V424, V425): the transport's onMeasurement hook is
// src/js/studio/measurement-run.js. One pass of measurement clips is ONE measurement: its recipe
// is derived from the topology (provenance.js recipeFromStudio), the Studio releases the output
// at the first clip, and the MEASURE workspace's MeasurementEngine runs it (measure.js
// measureRunRecipe: the same state machine, io, calibration, abort paths and exclusivity); the
// experiment is saved with the Studio provenance block (withStudioProvenance). STOP, Escape,
// page hide and leaving the workspace abort it as they abort any measurement.
//
// Render WAV (§105; plan V427): src/js/studio/offline.js renderStudioOffline on an
// OfflineAudioContext at the render format of the plan (a Recorder node's, else 48 kHz stereo,
// never the device rate, so the same Studio renders the same bytes everywhere), encoded by
// audio/wav.js and downloaded with the exporters' downloadBlob. Progress is shown and announced;
// Abort drops the render. Live-only nodes refuse with the plan's limitation.
//
// Find node (§250-§251; plan V428): `/` or the Find button opens graph-picker.js createFindNode;
// a result is selected, framed and focused.
//
// Deep link (§199-§200; plan V422): `#m=studio[&st=<template id>][&sv=<subview>]`
// (core/url-state-studio.js). A link read at load (main.js, after the V1 `m` key) or on
// hashchange is validated like an import and refused whole with a readable message; it opens the
// workspace, the subview and a shipped template, never starts playback, and never replaces a
// document with unsaved changes (the Templates dialog and its "unsaved changes" note open
// instead, the usual explicit Open). Copy link writes the current view: the template id only
// while the document is that template unmodified, otherwise the workspace and subview alone.
//
// Browser fullscreen (§133-§135; plan V422): an optional FULLSCREEN command on the workspace
// element (#osc-view-studio), feature-detected (fullscreenSupport); the maximized workspace never
// depends on it. While fullscreen, Escape belongs to the browser (it exits fullscreen); leaving
// the Studio workspace exits it too.
//
// Alpine holds only small plain view state (`studio`); the store, runtime, transport and view
// controllers live in the closure `ctx`, never in reactive state.

import { NODE_REGISTRY } from '../../studio/registry.js';
import { createIdGenerator, createStudioStore } from '../../studio/actions.js';
import { compileStudio } from '../../studio/compiler.js';
import { createStudioRuntime } from '../../studio/runtime.js';
import { createStudioTransport } from '../../studio/transport.js';
import { createStudioMeasurementRun } from '../../studio/measurement-run.js';
import { withStudioProvenance } from '../../studio/provenance.js';
import { planOfflineRender, renderStudioOffline } from '../../studio/offline.js';
import { timelineEnd } from '../../studio/timeline.js';
import { DEFAULT_RENDER } from '../../audio/offline-renderer.js';
import { resolveEscape } from '../../studio/timeline-compiler.js';
import {
  REFERENCE_TEMPLATE_ID, getTemplate, listTemplates, templateModel,
} from '../../studio/templates/index.js';
import { decodeStudioLink, encodeStudioLink } from '../../core/url-state-studio.js';
import {
  createDirtyTracker, createStudioLibrary, exportProjectFile, fileSlug, importStudioFile,
} from '../../studio/library.js';
import { announceRedo, announceUndo, announceAction } from '../../studio/a11y.js';
import { openExperimentStoreOrMemory } from '../../experiments/store.js';
import { pageIndexedDb } from '../experiments.js';
import { KNOWN_ALGORITHM_IDS } from '../../measurement/algorithms.js';
import { openModal, closeModal } from '../dialogs.js';
import { downloadBlob, readFileText } from '../exporters.js';
import { createGraphEditor } from './graph-editor.js';
import { compiledEdgeStatus, compiledStatus, nodeWarnings } from './graph-view.js';
import { STUDIO_SHORTCUTS, isEditingTarget, resolveStudioKey } from './graph-keys.js';
import { createConnectDialog, createFindNode, createQuickAdd } from './graph-picker.js';
import { mountInspector } from './inspector.js';
import { mountLibrary } from './library-panel.js';
import { compactTime, mountCompact } from './compact.js';
import { STUDIO_STORE_FALLBACK_TEXT, mountPatches, recordId } from './patches-panel.js';
import { mountStudioTimeline } from './timeline-editor.js';

/** First keyboard-reachable control inside a pane. */
const TABBABLE = 'button:not([disabled]), input:not([disabled]), select:not([disabled]), '
  + '[tabindex="0"]';

/** The timeline or Inspector pane that holds focus, else null (studioKeepFocus). */
function focusedPane() {
  const a = document.activeElement;
  return a && a.closest ? a.closest('.osc-st-timeline, .osc-st-inspector') : null;
}

export const STUDIO_SUBVIEWS = Object.freeze(['graph', 'timeline', 'inspector']);
/** Largest Studio file read from disk (the import pipeline re-checks every limit). */
export const STUDIO_FILE_MAX_BYTES = 4 * 1024 * 1024;
/** Why browser fullscreen is not offered (the button stays, aria-disabled, with this reason). */
export const FULLSCREEN_UNSUPPORTED = 'This browser does not offer fullscreen for part of a page '
  + '(Safari on iPhone, for example). Studio already fills the window.';
export const FULLSCREEN_BLOCKED = 'Fullscreen is turned off here (an embedding page or a browser '
  + 'setting). Studio already fills the window.';

/**
 * Whether `el` can go fullscreen in `doc` (standard or WebKit-prefixed API): { available,
 * reason } — reason is '' when available.
 */
export function fullscreenSupport(doc, el) {
  const req = el && (el.requestFullscreen || el.webkitRequestFullscreen);
  if (!doc || typeof req !== 'function') {
    return { available: false, reason: FULLSCREEN_UNSUPPORTED };
  }
  const enabled = doc.fullscreenEnabled !== undefined ? doc.fullscreenEnabled
    : doc.webkitFullscreenEnabled;
  if (enabled === false) return { available: false, reason: FULLSCREEN_BLOCKED };
  return { available: true, reason: '' };
}

/** The element shown fullscreen in `doc`, or null. */
export function fullscreenElementOf(doc) {
  return (doc && (doc.fullscreenElement || doc.webkitFullscreenElement)) || null;
}

/**
 * The view a Studio link writes (plain data): the template id only while the document is that
 * shipped template unmodified (`templateUnmodified`), else null; the subview always.
 * { templateId, templateTitle, subview, hash, note }.
 */
export function studioLinkView({ templateId = null, templateUnmodified = false,
  subview = 'graph', title = '' } = {}) {
  const t = templateId && templateUnmodified ? getTemplate(templateId) : null;
  const sv = STUDIO_SUBVIEWS.includes(subview) ? subview : 'graph';
  const hash = encodeStudioLink({ templateId: t ? t.id : null, subview: sv });
  const view = sv.charAt(0).toUpperCase() + sv.slice(1);
  const doc = title ? `“${title}”` : 'this document';
  const note = t ? `The link opens Studio with the template ${t.title} in the ${view} view. `
    + 'Nothing plays until Play.'
    : `The link opens the Studio workspace in the ${view} view only: ${doc} is not an `
      + 'unmodified template, so it is not in the link. Save it or export a project file to '
      + 'share it.';
  return { templateId: t ? t.id : null, templateTitle: t ? t.title : '', subview: sv, hash, note };
}

/** The idle Studio task view (render or measurement in progress). */
export const IDLE_TASK = Object.freeze({ active: false, kind: '', label: '', pct: null, text: '',
  abortable: false });

/** The name of an experiment a Studio measurement saves (the MEASURE name when one is typed). */
export function studioExperimentName(experiment, model) {
  const typed = experiment && experiment.name && !/^TEST CONTEXT/.test(experiment.name)
    && experiment.name !== 'Playback / capture chain' ? experiment.name : '';
  return typed || `${model.metadata.title} (Studio)`;
}

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
  const d = duration != null ? duration : (end > 0 ? Number(end.toFixed(3)) : RENDER_DEFAULT_S);
  const plan = planOfflineRender(model, { duration: d, registry });
  const r = plan.render;
  return {
    duration: String(d),
    note: end > 0 ? `The timeline ends at ${Number(end.toFixed(3))} s.`
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
 * A stable handle over the current store (§9): the same object for every projection, the
 * document behind it replaceable (open project / template / import). Revisions are monotonic
 * across documents. subscribe(fn) -> off: fn(event) after every store change and replacement.
 */
export function createStoreHandle(initialModel, { registry = NODE_REGISTRY } = {}) {
  const listeners = new Set();
  let offset = 0;
  let store = null;
  const emit = (ev) => {
    for (const fn of [...listeners]) {
      try { fn(ev); } catch (e) { console.error('OSCILLA Studio listener failed:', e); }
    }
  };
  const make = (m) => createStudioStore(m, { registry, idGenerator: createIdGenerator(m),
    onChange: (ev) => emit({ ...ev, revision: ev.revision + offset }) });
  store = make(initialModel);
  const adjust = (r) => (r && typeof r.revision === 'number'
    ? { ...r, revision: r.revision + offset } : r);
  const handle = {
    dispatch: (a) => adjust(store.dispatch(a)),
    undo: () => adjust(store.undo()),
    redo: () => adjust(store.redo()),
    beginGesture: (label) => store.beginGesture(label),
    endGesture: () => store.endGesture(),
    cancelGesture: () => store.cancelGesture(),
    canUndo: () => store.canUndo(),
    canRedo: () => store.canRedo(),
    undoLabel: () => store.undoLabel(),
    redoLabel: () => store.redoLabel(),
    getModel: () => store.getModel(),
    getSelection: () => store.getSelection(),
    getRevision: () => store.getRevision() + offset,
    getState: () => ({ ...store.getState(), revision: store.getRevision() + offset }),
    debugInfo: () => ({ ...store.debugInfo(), revision: store.getRevision() + offset }),
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    /** Open another document (validated by createStudioStore); a new history. */
    replace(model, reason = 'replace') {
      const next = make(model);
      offset = handle.getRevision() + 1;
      store = next;
      emit({ type: 'model', reason, model: store.getModel(), selection: store.getSelection(),
        revision: handle.getRevision() });
      return store.getModel();
    },
    /** The current store itself (tests: assert there is exactly one). */
    current: () => store,
  };
  return Object.freeze(handle);
}

/** The Alpine part of the STUDIO workspace. svc: { engine, stopPlayback(cmp) }. */
export function createStudioUi(svc = {}) {
  const registry = svc.registry || NODE_REGISTRY;
  const ctx = {
    cmp: null,
    handle: null,
    runtime: null,
    transport: null,
    editor: null,
    inspector: null,
    library: null,
    compact: null,
    quickAdd: null,
    connect: null,
    find: null,
    measureRun: null,
    render: null, // { controller } while a WAV render runs
    patches: null,
    timeline: null,
    status: new Map(),
    edgeStatus: new Map(),
    warnings: new Map(),
    dirty: null,
    projectId: null,
    lib: null,
    libOpening: null,
    raf: 0,
    limitSig: '',
    templateId: REFERENCE_TEMPLATE_ID,
    templateBaseline: null, // dirty tracker against the opened template (Copy link, V422)
    liveToggle: false,
    alertToggle: false,
    mounted: false,
  };

  const viewEl = () => document.getElementById('osc-view-studio');
  const compactEl = () => document.querySelector('[data-osc="studio.compact"]');
  const graphHost = () => document.querySelector('[data-osc="studio.graph"]');

  function announce(text, { assertive = false } = {}) {
    if (!text || !ctx.cmp) return;
    const s = ctx.cmp.studio;
    // Repeating the same sentence must be announced again: alternate an invisible suffix.
    if (assertive) {
      ctx.alertToggle = !ctx.alertToggle;
      s.alert = `${text}${ctx.alertToggle ? '​' : ''}`;
    } else {
      ctx.liveToggle = !ctx.liveToggle;
      s.live = `${text}${ctx.liveToggle ? '​' : ''}`;
    }
  }

  function recompile(model) {
    let plan = null;
    try {
      plan = compileStudio(model, { engine: svc.engine, registry });
    } catch (e) {
      plan = null;
    }
    ctx.status = compiledStatus(plan);
    ctx.edgeStatus = compiledEdgeStatus(plan);
    ctx.warnings = nodeWarnings(model, registry);
  }

  function refreshState() {
    const cmp = ctx.cmp;
    const h = ctx.handle;
    if (!cmp || !h) return;
    const model = h.getModel();
    const s = cmp.studio;
    const set = (k, v) => { if (s[k] !== v) s[k] = v; };
    set('title', model.metadata.title);
    set('dirty', ctx.dirty ? ctx.dirty.isDirty(model) : false);
    set('canUndo', h.canUndo());
    set('canRedo', h.canRedo());
    set('undoLabel', h.undoLabel() || '');
    set('redoLabel', h.redoLabel() || '');
    set('loop', !!model.timeline.loop.enabled);
    set('counts', `${model.graph.nodes.length} nodes · ${model.graph.edges.length} connections`);
  }

  function limitSignature(model) {
    return model.graph.nodes.filter((n) => {
      const d = registry.get(n.type);
      return d && d.maxInstances != null;
    }).map((n) => n.type).sort().join(',');
  }

  function onStoreChange(ev) {
    if (!ctx.mounted) return;
    if (ev.type === 'view') return; // the editor applied its own view already
    const model = ctx.handle.getModel();
    if (ev.type === 'model') {
      recompile(model);
      if (ctx.transport) ctx.transport.sync();
      const sig = limitSignature(model);
      if (sig !== ctx.limitSig && ctx.library) {
        ctx.limitSig = sig;
        ctx.library.render();
      }
    }
    if (ctx.editor) ctx.editor.render();
    if (ctx.inspector) ctx.inspector.render();
    if (ctx.compact) ctx.compact.render();
    refreshState();
  }

  // ---------------------------------------------------------------- transport
  function tick() {
    ctx.raf = 0;
    const t = ctx.transport;
    if (!t) return;
    const p = t.playhead();
    const text = compactTime(p.position);
    const el = document.querySelector('[data-osc="studio.time"]');
    if (el && el.textContent !== text) el.textContent = text;
    if (ctx.compact) ctx.compact.setPlayhead(p.position);
    if (t.playing) ctx.raf = requestAnimationFrame(tick);
  }

  function onTransport(type, detail) {
    const cmp = ctx.cmp;
    if (!cmp) return;
    if (type === 'state' || type === 'ended') {
      const playing = !!ctx.transport.playing;
      cmp.studio.playing = playing;
      if (ctx.editor) ctx.editor.setRunning(playing);
      if (ctx.compact) ctx.compact.setTransport({ playing });
      if (playing && !ctx.raf) ctx.raf = requestAnimationFrame(tick);
      if (!playing) {
        tick();
        if (detail && detail.reason === 'end') announce('Studio playback ended');
      }
    } else if (type === 'warning') {
      cmp.studio.warning = String(detail || '');
    }
  }

  function ensureAudio() {
    const cmp = ctx.cmp;
    if (cmp && typeof cmp.ensureAudio === 'function') cmp.ensureAudio();
    else if (svc.engine) svc.engine.init();
    if (svc.engine && typeof svc.engine.resume === 'function') {
      try {
        const p = svc.engine.resume();
        if (p && typeof p.catch === 'function') p.catch(() => {});
      } catch (e) { /* resumed on the next gesture */ }
    }
  }

  function setTask(view) {
    const cmp = ctx.cmp;
    if (!cmp) return;
    const cur = cmp.studio.task;
    if (Object.keys(view).every((k) => cur[k] === view[k])) return;
    cmp.studio.task = { ...view };
  }

  /** The task strip while a Studio measurement runs: MEASURE's own state and progress. */
  function measureTaskView() {
    const cmp = ctx.cmp;
    const run = ctx.measureRun ? ctx.measureRun.view : null;
    if (!cmp || !run || (run.state !== 'pending' && run.state !== 'running')) return IDLE_TASK;
    const m = cmp.meas || {};
    const pct = run.state === 'running' && Number.isFinite(m.progressPct) ? m.progressPct : null;
    const state = run.state === 'pending' ? 'armed' : String(m.state || 'starting')
      .toLowerCase().replace(/_/g, ' ');
    return { active: true, kind: 'measure', label: 'Measuring from Studio', pct,
      text: pct === null ? state : `${state} · ${pct} %`, abortable: true };
  }

  function onMeasureRun(view) {
    if (view.state === 'pending' || view.state === 'running') setTask(measureTaskView());
    else if (ctx.cmp && ctx.cmp.studio.task.kind === 'measure') setTask(IDLE_TASK);
    if (view.text) {
      const bad = view.state === 'failed';
      announce(view.text, { assertive: bad });
      if (ctx.cmp && (view.state === 'done' || bad)) ctx.cmp.studio.measureNote = view.text;
    }
  }

  function runMeasurement(recipe, model) {
    const cmp = ctx.cmp;
    if (!cmp || typeof cmp.measureRunRecipe !== 'function') {
      return Promise.resolve({ ok: false, state: 'IDLE',
        reason: 'The measurement workspace is not available.' });
    }
    return cmp.measureRunRecipe(recipe, { decorate: (e) => withStudioProvenance({ ...e,
      name: studioExperimentName(e, model) }, model) });
  }

  function setupAudio() {
    if (ctx.transport || !svc.engine) return;
    const engine = svc.engine;
    ctx.runtime = createStudioRuntime({ engine, registry });
    ctx.measureRun = createStudioMeasurementRun({
      getModel: () => ctx.handle.getModel(),
      sampleRate: () => (engine.ctx ? engine.ctx.sampleRate : engine.sampleRate),
      now: () => (engine.ctx ? engine.ctx.currentTime : 0),
      run: runMeasurement,
      stopStudio: () => stopStudio({ fast: true }),
      onChange: onMeasureRun,
      profileId: () => (ctx.cmp && typeof ctx.cmp.measureAppliedProfileId === 'function'
        ? ctx.cmp.measureAppliedProfileId() : null),
    });
    ctx.transport = createStudioTransport({ runtime: ctx.runtime, engine: svc.engine,
      store: ctx.handle, registry,
      onMeasurement: (ev) => { if (ctx.measureRun) ctx.measureRun.hook(ev); },
      onClaimOutput: () => {
        const cmp = ctx.cmp;
        if (cmp && typeof cmp.measureOwnsOutput === 'function' && cmp.measureOwnsOutput()) {
          announce('The output belongs to the measurement: stop it first.', { assertive: true });
          return false;
        }
        if (cmp && svc.stopPlayback) svc.stopPlayback(cmp);
        return true;
      } });
    ctx.transport.on(onTransport);
  }

  function stopStudio({ fast = false } = {}) {
    if (!ctx.transport) return Promise.resolve(null);
    const p = ctx.transport.stop({ fast });
    onTransport('state', { reason: 'stop' });
    return p;
  }

  // ---------------------------------------------------------------- documents
  function openDocument(model, { reason, projectId = null, templateId = null } = {}) {
    if (ctx.transport && ctx.transport.playing) stopStudio({ fast: true });
    ctx.handle.replace(model, reason);
    if (ctx.cmp) ctx.cmp.studio.warning = '';
    ctx.dirty = createDirtyTracker(ctx.handle.getModel());
    ctx.projectId = projectId;
    ctx.templateId = templateId;
    ctx.templateBaseline = templateId ? createDirtyTracker(ctx.handle.getModel()) : null;
    if (ctx.editor) requestAnimationFrame(() => ctx.editor.frameAll());
    refreshState();
  }

  function library() {
    if (ctx.lib) return Promise.resolve(ctx.lib);
    if (!ctx.libOpening) {
      ctx.libOpening = openExperimentStoreOrMemory({
        indexedDB: pageIndexedDb(), // guarded: reading it throws in some private modes
        storage: typeof navigator !== 'undefined' ? navigator.storage : null,
        knownAlgorithms: KNOWN_ALGORITHM_IDS,
      }).then((r) => {
        ctx.lib = createStudioLibrary(r.store);
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

  /** Leave browser fullscreen when the Studio workspace is what is fullscreen. */
  async function exitFullscreen() {
    const el = fullscreenElementOf(document);
    if (!el || el !== viewEl()) return;
    const exit = document.exitFullscreen || document.webkitExitFullscreen;
    try {
      if (exit) await exit.call(document);
    } catch (e) { /* already left */ }
  }

  // ---------------------------------------------------------------- keyboard
  const studioDialogOpen = () => !!document.querySelector('dialog[open][data-osc-studio-dialog]');
  const otherDialogOpen = () => !!document.querySelector(
    'dialog[open][data-oscilla-modal]:not([data-osc-studio-dialog])');

  function onKeyDown(e) {
    const cmp = ctx.cmp;
    if (!cmp || !ctx.mounted || e.defaultPrevented) return;
    const t = e.target instanceof Element ? e.target : null;
    const view = viewEl();
    const compact = compactEl();
    const inView = !!(t && view && view.contains(t));
    const inCompact = !!(t && compact && compact.contains(t));
    const onBody = !t || t === document.body || t === document.documentElement
      || (t.id === 'osc-main');
    const active = cmp.workspace === 'studio' && (inView || onBody);
    if (e.key === 'Escape') {
      if (otherDialogOpen()) return;
      const action = resolveEscape({
        gesture: !!(ctx.editor && ctx.editor.hasGesture()),
        popup: studioDialogOpen(),
        selectionMode: !!(ctx.editor && ctx.editor.inSelectionMode()),
        audioActive: !!(ctx.transport && (ctx.transport.playing
          || (ctx.runtime && ctx.runtime.state === 'running'))),
      });
      if (action === 'close-popup') {
        e.stopImmediatePropagation(); // the dialog closes itself; nothing else stops
      } else if (action === 'cancel-gesture' || action === 'cancel-selection-mode') {
        ctx.editor.cancelTransient();
        e.preventDefault();
        e.stopImmediatePropagation();
      } else if (action === 'stop-audio') {
        stopStudio({ fast: true });
        announce('Studio stopped');
      }
      return;
    }
    if (!(active || inCompact) || studioDialogOpen() || otherDialogOpen()) return;
    if (isEditingTarget(t)) return;
    const cmd = resolveStudioKey(e);
    if (!cmd) return;
    const inGraph = !!(t && graphHost() && graphHost().contains(t));
    const timelineHost = view ? view.querySelector('[data-osc="studio.timeline"]') : null;
    const inTimeline = !!(t && timelineHost && timelineHost.contains(t));
    const control = t && t.closest ? t.closest('button, a, select, summary, input, [role="switch"],'
      + ' [role="tab"], [role="radio"], [role="menuitem"], [role="checkbox"]') : null;
    const consume = () => {
      e.preventDefault();
      e.stopImmediatePropagation();
    };
    switch (cmd.id) {
      case 'play-toggle':
        if (control) return; // Space activates the focused control (V1 rule)
        consume();
        if (e.repeat) return;
        cmp.studioTogglePlay();
        return;
      case 'undo':
        consume();
        cmp.studioUndo();
        return;
      case 'redo':
        consume();
        cmp.studioRedo();
        return;
      case 'find':
        consume();
        cmp.studioFind();
        return;
      default:
        break;
    }
    if (inTimeline || !(inGraph || (active && onBody))) return;
    const ed = ctx.editor;
    switch (cmd.id) {
      case 'delete': consume(); ed.deleteSelection(); break;
      case 'copy': consume(); ed.copySelection(); break;
      case 'cut': consume(); ed.cutSelection(); break;
      case 'paste': consume(); ed.paste(); break;
      case 'duplicate': consume(); ed.duplicateSelection(); break;
      case 'select-all': consume(); ed.selectAll(); break;
      case 'quick-add': consume(); cmp.studioAddNode(); break;
      case 'connect': {
        consume();
        const sel = ctx.handle.getSelection().nodes;
        if (sel.length) ctx.connect.open(sel[sel.length - 1]);
        else announce('Select a node to connect.');
        break;
      }
      case 'frame-selection': consume(); ed.frameSelection(); break;
      case 'frame-all': consume(); ed.frameAll(); break;
      case 'zoom-in': consume(); ed.zoomBy(1.2); break;
      case 'zoom-out': consume(); ed.zoomBy(1 / 1.2); break;
      case 'nudge':
        if (control && !(t.closest && t.closest('.osc-sg-node'))) return;
        consume();
        ed.nudge(cmd.key, cmd.large);
        break;
      default:
        break;
    }
  }

  function onKeyUp(e) {
    if (e.key && e.key.startsWith('Arrow') && ctx.editor) ctx.editor.endNudge();
  }

  // ---------------------------------------------------------------- mount
  function mount(cmp) {
    const host = graphHost();
    if (!host || ctx.mounted) return;
    ctx.mounted = true;
    const dialogSvc = { openModal: (id) => openModal(id), closeModal: (id) => closeModal(id) };
    ctx.editor = createGraphEditor(host, {
      store: ctx.handle,
      registry,
      announce,
      status: () => ctx.status,
      edgeStatus: () => ctx.edgeStatus,
      warnings: () => ctx.warnings,
      onQuickAdd: (o) => ctx.quickAdd.open(o),
      onConnectDialog: (id) => ctx.connect.open(id),
      onActivateNode: () => {
        if (cmp.studio.subview !== 'inspector' && window.matchMedia('(max-width: 767.98px)')
          .matches) cmp.studioSetSubview('inspector');
        requestAnimationFrame(() => ctx.inspector && ctx.inspector.focusFirst());
      },
    });
    const pickSvc = { store: ctx.handle, registry, editor: ctx.editor, announce, ...dialogSvc,
      // The connect dialog closes onto its node; while the graph is hidden (a phone, Connect…
      // from the Inspector) focus goes to the Inspector's Connect… instead (V431 U7).
      focusFallback: () => !!ctx.inspector && (ctx.inspector.focusKey('studio.inspector.connect')
        || ctx.inspector.focusHeading()) };
    ctx.quickAdd = createQuickAdd(document.getElementById('osc-dlg-studio-add'), pickSvc);
    ctx.connect = createConnectDialog(document.getElementById('osc-dlg-studio-connect'), pickSvc);
    ctx.find = createFindNode(document.getElementById('osc-dlg-studio-find'), { ...pickSvc,
      reveal: (id) => cmp.studioReveal(id) });
    const inspHost = document.querySelector('[data-osc="studio.inspector"]');
    ctx.inspector = mountInspector(inspHost, {
      store: ctx.handle,
      registry,
      announce,
      status: () => ctx.status,
      edgeStatus: () => ctx.edgeStatus,
      warnings: () => ctx.warnings,
      onConnect: (id) => ctx.connect.open(id),
      onSavePatch: (ids) => ctx.patches.openSavePatch(ids),
      onDelete: () => ctx.editor.deleteSelection(),
      onDuplicate: () => ctx.editor.duplicateSelection(),
      onShowLane: (laneId, label) => cmp.studioShowLane(laneId, label),
    });
    const libHost = document.querySelector('[data-osc="studio.library"]');
    ctx.library = mountLibrary(libHost, {
      store: ctx.handle,
      registry,
      addAtCenter: (type) => ctx.editor.addNodeAt(type),
      addAtPoint: (type, x, y) => ctx.editor.addNodeAtClient(type, x, y),
      isOverGraph: (x, y) => ctx.editor.isOverViewport(x, y),
    });
    ctx.limitSig = limitSignature(ctx.handle.getModel());
    const cHost = compactEl();
    if (cHost) {
      ctx.compact = mountCompact(cHost, {
        store: ctx.handle,
        registry,
        announce,
        play: () => cmp.studioPlay(),
        stop: () => cmp.studioStop(),
        toggleLoop: () => cmp.studioToggleLoop(),
        expand: (id) => cmp.studioExpand(id),
      });
    }
    ctx.patches = mountPatches({
      library: document.getElementById('osc-dlg-studio-library'),
      savePatch: document.getElementById('osc-dlg-studio-patch'),
    }, {
      store: ctx.handle,
      library,
      persistent: () => !!(ctx.lib && ctx.lib.persistent),
      announce,
      openProject: (r) => {
        openDocument(r.model, { reason: 'open', projectId: r.summary.id });
        if (ctx.dirty) ctx.dirty.markSaved(ctx.handle.getModel(), { id: r.summary.id,
          savedAt: r.summary.savedAt });
        refreshState();
        announce(`Opened ${r.summary.name}`);
      },
      downloadFile,
      ...dialogSvc,
    });
    const tlHost = document.querySelector('[data-osc="studio.timeline"]');
    if (tlHost && typeof mountStudioTimeline === 'function') {
      try {
        ctx.timeline = mountStudioTimeline(tlHost, {
          store: ctx.handle,
          transport: ctx.transport,
          runtime: ctx.runtime,
          announce,
          getSelection: () => ctx.handle.getSelection(),
          setSelection: (sel) => ctx.handle.dispatch({ type: 'SELECTION_CHANGE', selection: sel }),
          transportKeys: false, // the workspace header is the one transport on screen
        });
      } catch (e) {
        console.error('OSCILLA Studio timeline failed to mount:', e);
      }
    }
    recompile(ctx.handle.getModel());
    ctx.editor.render();
    ctx.inspector.render();
    refreshState();
    cmp.studio.ready = true;
  }

  // ---------------------------------------------------------------- the Alpine part
  return {
    studio: {
      ready: false,
      title: '',
      dirty: false,
      persistent: true,
      storeNote: '',
      playing: false,
      loop: false,
      canUndo: false,
      canRedo: false,
      undoLabel: '',
      redoLabel: '',
      subview: 'graph',
      live: '',
      alert: '',
      warning: '',
      counts: '',
      templates: listTemplates(),
      shortcuts: STUDIO_SHORTCUTS,
      task: { ...IDLE_TASK },
      measureNote: '',
      renderForm: { duration: '', note: '', format: '', limitations: [], refused: false,
        error: '' },
      fullscreen: false,
      fullscreenAvailable: false,
      fullscreenReason: FULLSCREEN_UNSUPPORTED,
      link: '', // the last link Copy link wrote (the dialog shows it when there is no clipboard)
      linkNote: '',
      linkPending: '', // a linked template waiting for an explicit Open (unsaved changes)
    },

    studioInit() {
      ctx.cmp = this;
      ctx.handle = createStoreHandle(templateModel(REFERENCE_TEMPLATE_ID), { registry });
      ctx.dirty = createDirtyTracker(ctx.handle.getModel());
      ctx.templateBaseline = createDirtyTracker(ctx.handle.getModel());
      ctx.handle.subscribe(onStoreChange);
      setupAudio();
      // Registered before main.js's own window keydown listener: Studio keys run first and
      // stop the instrument's Space / Escape handling when they belong to Studio (§125).
      window.addEventListener('keydown', onKeyDown);
      window.addEventListener('keyup', onKeyUp);
      this.$watch('playing', (on) => { if (on && ctx.transport && ctx.transport.playing) stopStudio(); });
      this.$watch('seqPlaying', (on) => { if (on && ctx.transport && ctx.transport.playing) stopStudio(); });
      // A Studio measurement shows MEASURE's own state and progress in the Studio task strip.
      const follow = () => {
        if (ctx.measureRun && ctx.measureRun.busy) setTask(measureTaskView());
      };
      this.$watch('meas.state', follow);
      this.$watch('meas.progressPct', follow);
      this.$watch('workspace', (ws) => {
        if (ws === 'studio' && ctx.editor) requestAnimationFrame(() => ctx.editor.onShow());
        // The hidden workspace must not stay fullscreen (a blank screen). The browser's
        // fullscreenchange may still be on its way, so ask the document, not the flag.
        if (ws !== 'studio') exitFullscreen();
      });
      // Browser fullscreen (§134): offered when the API exists; the state follows the browser
      // (Escape, the browser's own controls), and the graph re-measures its viewport.
      const fs = fullscreenSupport(document, viewEl());
      this.studio.fullscreenAvailable = fs.available;
      this.studio.fullscreenReason = fs.reason;
      const onFullscreen = () => {
        const view = viewEl();
        const on = !!view && fullscreenElementOf(document) === view;
        if (on === this.studio.fullscreen) return;
        this.studio.fullscreen = on;
        announce(on ? 'Studio fullscreen. Esc exits fullscreen.' : 'Studio fullscreen ended');
        requestAnimationFrame(() => {
          if (ctx.editor && this.workspace === 'studio') ctx.editor.onShow();
          // Focus stays where it was; if the browser dropped it, it returns to the button.
          const a = document.activeElement;
          if (this.workspace === 'studio' && (!a || a === document.body)) {
            const btn = document.querySelector('[data-osc="studio.fullscreen"]');
            if (btn) btn.focus({ preventScroll: true });
          }
        });
      };
      document.addEventListener('fullscreenchange', onFullscreen);
      document.addEventListener('webkitfullscreenchange', onFullscreen);
      // Deep links after load (the load itself is applied by main.js after the V1 `m` key).
      window.addEventListener('hashchange', () => this.studioApplyLinkHash(window.location.hash,
        { origin: 'hashchange' }));
      const hide = () => { if (ctx.transport && ctx.transport.playing) stopStudio({ fast: true }); };
      document.addEventListener('visibilitychange', () => { if (document.hidden) hide(); });
      window.addEventListener('pagehide', hide);
      this.$nextTick(() => {
        mount(this);
        library().catch(() => {});
      });
    },

    studioOwnsOutput() {
      return !!(ctx.transport && ctx.transport.playing);
    },

    studioPlay() {
      setupAudio();
      if (!ctx.transport) return false;
      if (typeof this.measureOwnsOutput === 'function' && this.measureOwnsOutput()) {
        announce('Studio did not start: the measurement owns the output. Stop it first (Esc).',
          { assertive: true });
        return false;
      }
      ensureAudio();
      if (ctx.measureRun && !ctx.measureRun.busy) ctx.measureRun.reset();
      this.studio.measureNote = '';
      const r = ctx.transport.start();
      if (!r.ok) {
        announce(`Studio did not start: ${r.reason}`, { assertive: true });
        return false;
      }
      onTransport('state', { reason: 'play' });
      announce('Studio playing');
      return true;
    },

    studioStop() {
      const run = ctx.measureRun;
      if (run && run.view.state === 'running' && typeof this.measureAbort === 'function') {
        this.measureAbort('user');
      }
      const p = stopStudio();
      announce('Studio stopped');
      return p;
    },

    studioTogglePlay() {
      return ctx.transport && ctx.transport.playing ? this.studioStop() : this.studioPlay();
    },

    studioToggleLoop() {
      const model = ctx.handle.getModel();
      const loop = model.timeline.loop;
      const r = ctx.transport ? ctx.transport.setLoop({ enabled: !loop.enabled })
        : ctx.handle.dispatch({ type: 'LOOP_SET', enabled: !loop.enabled });
      if (r.ok) announce(`Loop ${loop.enabled ? 'off' : 'on'}`);
      else announce(announceAction(r), { assertive: true });
    },

    /** Abort the running Studio task: a WAV render, or a measurement started from Studio. */
    studioAbortTask() {
      if (ctx.render) {
        ctx.render.controller.abort();
        return true;
      }
      const run = ctx.measureRun;
      if (run && run.view.state === 'pending') {
        run.abort('user');
        stopStudio({ fast: true });
        return true;
      }
      if (run && run.view.state === 'running' && typeof this.measureAbort === 'function') {
        return this.measureAbort('user');
      }
      return false;
    },

    /**
     * Render WAV (plan V427): the Studio offline through offline.js, encoded and downloaded.
     * Resolves { ok, name, bytes, sampleRate, channels, duration, stats, limitations,
     * warnings, wav } or { ok: false, aborted?, reason }.
     */
    /** Render WAV… (toolbar): the dialog with the duration, the format and the limitations. */
    studioOpenRender() {
      if (ctx.render) return false;
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
        announce(d.error, { assertive: true });
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
        announce(msg, { assertive: true });
        return { ok: false, reason: msg, plan };
      }
      const controller = new AbortController();
      ctx.render = { controller };
      setTask(renderTaskView({ stage: 'render', fraction: 0 }));
      announce('Rendering WAV');
      let lastPct = 0;
      try {
        const r = await renderStudioOffline(model, { registry, wav: true, duration,
          signal: controller.signal,
          onProgress: (p) => {
            const v = renderTaskView(p);
            setTask(v);
            if (v.pct >= lastPct + 50 && v.pct < 100) {
              lastPct = v.pct;
              announce(`Rendering WAV, ${v.pct} %`);
            }
          } });
        if (r.aborted) {
          announce('WAV render aborted');
          return { ok: false, aborted: true, reason: r.errors[0] };
        }
        if (!r.ok) {
          const msg = `Not rendered: ${r.limitations[0] || r.errors[0]}`;
          this.studio.warning = msg;
          announce(msg, { assertive: true });
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
        announce(`Rendered ${name}: ${b.duration.toFixed(2)} s, ${b.sampleRate} Hz, `
          + `${b.numberOfChannels === 1 ? 'mono' : 'stereo'}, 16-bit WAV, ${peak}`);
        return { ok: true, name, bytes: r.wav.byteLength, sampleRate: b.sampleRate,
          channels: b.numberOfChannels, duration: b.duration, stats: r.stats,
          limitations: plan.limitations.slice(), warnings: r.warnings.slice(), wav: r.wav };
      } catch (e) {
        const msg = `Not rendered: ${(e && e.message) || e}`;
        announce(msg, { assertive: true });
        return { ok: false, reason: msg };
      } finally {
        ctx.render = null;
        setTask(IDLE_TASK);
      }
    },

    /** Find node (§251): the search dialog over the current graph. */
    studioFind() {
      if (ctx.find) ctx.find.open();
    },

    /** Select, frame and focus a node (a search result), on the graph subview. */
    studioReveal(nodeId) {
      const model = ctx.handle.getModel();
      const n = model.graph.nodes.find((x) => x.id === nodeId);
      if (!n) return false;
      if (this.studio.subview !== 'graph') this.studioSetSubview('graph');
      ctx.handle.dispatch({ type: 'SELECTION_CHANGE', selection: { nodes: [nodeId] } });
      requestAnimationFrame(() => {
        if (!ctx.editor) return;
        ctx.editor.onShow();
        ctx.editor.frameSelection();
        ctx.editor.focusNode(nodeId);
      });
      announce(`Found ${n.metadata.name}: selected and framed`);
      return true;
    },

    studioReturn() {
      if (ctx.transport) ctx.transport.returnToStart();
      tick();
      announce('Returned to start');
    },

    studioUndo() {
      if (ctx.editor) ctx.editor.endNudge();
      const pane = focusedPane();
      const r = ctx.handle.undo();
      announce(announceUndo(r));
      this.studioKeepFocus(pane);
    },

    studioRedo() {
      const pane = focusedPane();
      const r = ctx.handle.redo();
      announce(announceRedo(r));
      this.studioKeepFocus(pane);
    },

    /**
     * Never leave focus on <body> (§142; V431 U3, U4): undo / redo may remove the focused node,
     * clip or point, and the toolbar Undo / Redo button disables itself under focus. After the
     * render, a lost focus goes to the first control of the timeline or Inspector pane that
     * held it (when shown), else the graph canvas when shown, else the active subview tab.
     */
    studioKeepFocus(pane = null) {
      requestAnimationFrame(() => {
        const a = document.activeElement;
        if (this.workspace !== 'studio' || (a && a !== document.body && a.isConnected
          && !a.disabled)) return;
        const first = pane && pane.isConnected && pane.getClientRects().length
          ? pane.querySelector(TABBABLE) : null;
        if (first) {
          first.focus({ preventScroll: true });
          return;
        }
        const vp = document.querySelector('[data-osc="studio.graph.viewport"]');
        if (ctx.editor && vp && vp.getClientRects().length) {
          ctx.editor.focusViewport();
          return;
        }
        const tab = document.querySelector(`[data-osc="studio.subview"][data-value="${
          this.studio.subview}"]`);
        if (tab && tab.getClientRects().length) tab.focus({ preventScroll: true });
      });
    },

    /**
     * "Automated · show lane" (§102; V431 U8): the lane is revealed in the timeline. When the
     * timeline is not on screen (a phone shows one subview) the Timeline subview opens, the
     * lane's add-point button takes focus and the announcement says where it went; otherwise
     * the lane scrolls into view and focus stays in the Inspector.
     */
    studioShowLane(laneId, label) {
      const pane = document.querySelector('.osc-st-timeline');
      const shown = !!pane && pane.getClientRects().length > 0;
      if (!ctx.timeline) {
        announce(`${label} is automated; open the Timeline to see its lane`);
        return;
      }
      if (!shown) this.studioSetSubview('timeline');
      announce(shown ? `${label} automation lane shown`
        : `${label} automation lane shown in the Timeline view`);
      // After Alpine has applied the subview (its effect runs before the next frame).
      requestAnimationFrame(() => {
        if (ctx.timeline) ctx.timeline.revealLane(laneId, { focus: !shown });
      });
    },

    studioAddNode() {
      if (ctx.quickAdd) ctx.quickAdd.open({ at: ctx.editor ? ctx.editor.centerPoint() : null });
    },

    studioFrameAll() {
      if (ctx.editor) ctx.editor.frameAll();
    },

    studioSetSubview(v) {
      if (!STUDIO_SUBVIEWS.includes(v)) return;
      this.studio.subview = v;
      if (v === 'graph' && ctx.editor) requestAnimationFrame(() => ctx.editor.onShow());
    },

    studioSubview(v) {
      return {
        ':class'() { return { 'is-active': this.studio.subview === v }; },
        ':aria-selected'() { return String(this.studio.subview === v); },
        ':tabindex'() { return this.studio.subview === v ? 0 : -1; },
        '@click'() { this.studioSetSubview(v); },
        '@keydown'(e) {
          const keys = ['ArrowLeft', 'ArrowRight', 'Home', 'End'];
          if (!keys.includes(e.key)) return;
          e.preventDefault();
          const i = STUDIO_SUBVIEWS.indexOf(this.studio.subview);
          let n = i;
          if (e.key === 'Home') n = 0;
          else if (e.key === 'End') n = STUDIO_SUBVIEWS.length - 1;
          else n = (i + (e.key === 'ArrowRight' ? 1 : -1) + STUDIO_SUBVIEWS.length)
            % STUDIO_SUBVIEWS.length;
          this.studioSetSubview(STUDIO_SUBVIEWS[n]);
          this.$nextTick(() => {
            const el = document.querySelector(`[data-osc="studio.subview"][data-value="${
              STUDIO_SUBVIEWS[n]}"]`);
            if (el) el.focus();
          });
        },
      };
    },

    /** EXPAND STUDIO (§130): the full workspace on the identical state. */
    studioExpand(nodeId = null) {
      this.setWorkspace('studio');
      if (nodeId) {
        ctx.handle.dispatch({ type: 'SELECTION_CHANGE', selection: { nodes: [nodeId] } });
      }
      requestAnimationFrame(() => {
        if (!ctx.editor) return;
        ctx.editor.onShow();
        if (nodeId) {
          ctx.editor.frameSelection();
          ctx.editor.focusNode(nodeId);
        } else ctx.editor.focusViewport();
      });
    },

    studioBack() {
      this.setWorkspace('playground');
      // The button that had focus is now hidden: focus the compact Studio's Expand (the way
      // back), else the Playground tab, never <body> (WCAG 2.4.3; V431 U6).
      requestAnimationFrame(() => {
        const a = document.activeElement;
        if (a && a !== document.body && a.getClientRects().length) return;
        const to = [document.querySelector('[data-osc="studio.compact.expand"]'),
          document.querySelector('.osc-nav .osc-tab.is-active')]
          .find((el) => el && el.getClientRects().length);
        if (to) to.focus({ preventScroll: true });
      });
    },

    studioOpenTemplates() {
      this.studio.linkPending = '';
      openModal('osc-dlg-studio-templates');
    },

    studioLoadTemplate(id) {
      let model;
      try {
        model = templateModel(id);
      } catch (e) {
        announce(e.message, { assertive: true });
        return false;
      }
      closeModal('osc-dlg-studio-templates');
      this.studio.linkPending = '';
      openDocument(model, { reason: 'template', templateId: id });
      announce(`Opened template ${model.metadata.title}`);
      return true;
    },

    studioOpenLibrary() {
      if (ctx.patches) ctx.patches.openLibrary();
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
        refreshState();
        announce(`Saved ${summary.name}${lib.persistent ? '' : ' (this page view only)'}`);
        return summary;
      } catch (e) {
        announce(`Not saved: ${(e && e.message) || e}`, { assertive: true });
        return null;
      }
    },

    studioExport() {
      try {
        const model = ctx.handle.getModel();
        const f = exportProjectFile(model);
        downloadFile(f);
        ctx.dirty.markSaved(model, { target: 'file' });
        refreshState();
        announce(`Exported ${f.name}`);
        return f;
      } catch (e) {
        announce(`Not exported: ${(e && e.message) || e}`, { assertive: true });
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
        announce(`Not imported: ${(e && e.message) || e}`, { assertive: true });
        return null;
      }
    },

    /** Import a project (replaces the document) or a patch (inserted, undoable). */
    studioImportText(text) {
      const r = importStudioFile(text);
      if (!r.ok) {
        const e = r.errors && r.errors[0];
        const msg = `Not imported: ${e ? `${e.path ? `${e.path}: ` : ''}${e.message}`
          : 'invalid file'}`;
        announce(msg, { assertive: true });
        this.studio.warning = msg; // stays visible until the next document opens
        return { ok: false, reason: msg };
      }
      if (r.kind === 'patch') {
        const res = ctx.handle.dispatch({ type: 'PATCH_INSERT', patch: r.patch });
        announce(announceAction(res), { assertive: !res.ok });
        return res;
      }
      openDocument(r.model, { reason: 'import' });
      announce(`Imported ${r.model.metadata.title}`);
      return { ok: true, kind: 'project' };
    },

    // ------------------------------------------------------------ deep link (V422, §199)
    /** The view a Studio link carries now (studioLinkView). */
    studioLinkView() {
      const model = ctx.handle.getModel();
      return studioLinkView({ templateId: ctx.templateId,
        templateUnmodified: !!(ctx.templateBaseline && !ctx.templateBaseline.isDirty(model)),
        subview: this.studio.subview, title: model.metadata.title });
    },

    /** This page's URL with the Studio view as its whole hash. */
    studioLinkUrl() {
      const loc = typeof window !== 'undefined' ? window.location : null;
      return loc ? `${loc.href.split('#')[0]}#${this.studioLinkView().hash}` : null;
    },

    /** Copy link: the address bar and the clipboard (a dialog when there is no clipboard). */
    async studioCopyLink() {
      const view = this.studioLinkView();
      const url = this.studioLinkUrl();
      if (!url) return null;
      try { window.history.replaceState(null, '', url); } catch (e) { /* file:// in some */ }
      this.studio.link = url;
      this.studio.linkNote = view.note;
      let copied = false;
      try {
        if (navigator.clipboard && window.isSecureContext !== false) {
          await navigator.clipboard.writeText(url);
          copied = true;
        }
      } catch (e) {
        copied = false;
      }
      if (copied) {
        announce(`Link copied. ${view.note}`);
        this.notify('success', 'Studio link copied', view.note);
      } else openModal('osc-dlg-studio-link');
      return { url, copied, ...view };
    },

    /**
     * Apply a Studio link from a location hash (§199): validated like an import, refused whole
     * with a message when invalid, never starts playback, never replaces unsaved changes.
     * Returns true (applied, perhaps waiting for an explicit Open), false (refused) or null (no
     * Studio link in the hash). origin: 'load' | 'hashchange' | 'link'.
     */
    studioApplyLinkHash(hash, { origin = 'link' } = {}) {
      const r = decodeStudioLink(hash);
      if (r === null) return null;
      if (!r.ok) {
        const why = r.errors.slice(0, 3).join('; ');
        this.notify('warning', 'Studio link not applied', `${why}. Nothing was changed.`);
        announce(`Studio link not applied: ${why}`, { assertive: true });
        return false;
      }
      if (origin === 'load') this.workspace = 'studio';
      else if (this.workspace !== 'studio') this.setWorkspace('studio');
      if (r.subview) this.studioSetSubview(r.subview);
      const view = r.subview ? `${r.subview.charAt(0).toUpperCase()}${r.subview.slice(1)} view`
        : 'Studio';
      if (!r.templateId) {
        this.notify('info', 'Studio opened from the link', `${view}. Nothing plays until you press `
          + 'Play.');
        return true;
      }
      const model = ctx.handle.getModel();
      const t = getTemplate(r.templateId);
      const already = ctx.templateId === r.templateId && ctx.templateBaseline
        && !ctx.templateBaseline.isDirty(model);
      if (already) {
        this.notify('info', 'Studio opened from the link', `${t.title} is already open (${view}). `
          + 'Nothing plays until you press Play.');
        return true;
      }
      if (ctx.dirty && ctx.dirty.isDirty(model)) {
        // No silent overwrite: the Templates dialog says what would be lost; Open is explicit.
        this.studio.linkPending = t.title;
        openModal('osc-dlg-studio-templates');
        this.notify('warning', 'Studio link waits for you', `The link opens the template `
          + `${t.title}, but this Studio has unsaved changes. Choose Open on ${t.title} to replace `
          + 'it, or save or export first.');
        announce(`The link opens ${t.title}; this Studio has unsaved changes, so it was not `
          + 'replaced.', { assertive: true });
        return true;
      }
      openDocument(templateModel(r.templateId), { reason: 'link', templateId: r.templateId });
      this.notify('info', 'Studio opened from the link', `Template ${t.title}, ${view}. Nothing `
        + 'plays until you press Play.');
      announce(`Opened template ${t.title} from the link`);
      return true;
    },

    // ------------------------------------------------------------ fullscreen (V422, §134)
    /** Browser fullscreen on the workspace element, or out of it. Resolves the new state. */
    async studioToggleFullscreen() {
      const view = viewEl();
      const fs = fullscreenSupport(document, view);
      if (!fs.available) {
        announce(fs.reason, { assertive: true });
        this.notify('info', 'Fullscreen not available', fs.reason);
        return false;
      }
      if (fullscreenElementOf(document) === view) {
        await exitFullscreen();
        return false;
      }
      try {
        const req = view.requestFullscreen || view.webkitRequestFullscreen;
        await req.call(view);
        return true;
      } catch (e) {
        const msg = `Fullscreen was refused by the browser${e && e.message ? `: ${e.message}`
          : ''}. Studio stays in the window.`;
        announce(msg, { assertive: true });
        this.notify('info', 'Fullscreen not available', msg);
        return false;
      }
    },

    /** Test seam (window.OSCILLA.studio): the live objects, never copies. */
    studioTestSeam() {
      return {
        get store() { return ctx.handle; },
        get model() { return ctx.handle.getModel(); },
        get selection() { return ctx.handle.getSelection(); },
        get runtime() { return ctx.runtime; },
        get transport() { return ctx.transport; },
        get editor() { return ctx.editor; },
        get dirty() { return ctx.dirty ? ctx.dirty.isDirty(ctx.handle.getModel()) : false; },
        get projectId() { return ctx.projectId; },
        get templateId() { return ctx.templateId; },
        get measurementRun() { return ctx.measureRun ? ctx.measureRun.view : null; },
        get rendering() { return !!ctx.render; },
        library,
        counts() {
          const e = svc.engine;
          const rt = ctx.runtime ? ctx.runtime.debugInfo() : null;
          return { engineNodes: e ? e.activeNodeCount : 0,
            engineSources: e ? e.activeSourceCount : 0,
            runtimeNodes: rt ? rt.runtimeNodeCount : 0,
            runtimeSources: rt ? rt.runtimeSourceCount : 0,
            runtimeState: rt ? rt.state : 'idle',
            playing: !!(ctx.transport && ctx.transport.playing) };
        },
      };
    },
  };
}
