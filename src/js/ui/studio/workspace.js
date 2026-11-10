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
// Modules (E003): this file composes the workspace from its parts under
// src/js/ui/studio/workspace/ and stays the module its importers import (it re-exports their
// exports). It keeps the store handle, the closure state `ctx`, the audio setup (the ONE
// runtime and transport), the mount of the projections and the lifecycle (studioInit).
// document.js holds the announcements, the document and the session (open, detach, undo and
// redo, templates, what a reload would lose); runtime.js the status, the commit gate, Allow
// microphone and the transport; measurement.js the measurement bridge and the task strip;
// files.js the library, Save, export, import and Render WAV; graph.js the workspace keys and
// the graph commands; timeline.js the timeline commands; navigation.js the subviews, Back, the
// deep link and fullscreen; voice.js the Playground voice opened from the Signal Path (V605).
// Every part shares `ctx` and `svc` and reaches the functions of the others through `ops`,
// filled here before any of them runs.
//
// Operation trace (ADR 0042): ONE core/trace.js trace per workspace, its port handed to the
// store handle, the runtime and the transport here; the Inspector reads its steps (svc.trace)
// and ?debug=1 its counts (studioTraceText). In memory only, never saved.
//
// Alpine holds only small plain view state (`studio`); the store, runtime, transport and view
// controllers live in the closure `ctx`, never in reactive state.

import { NODE_REGISTRY } from '../../studio/registry.js';
import { createIdGenerator, createStudioStore } from '../../studio/actions.js';
import { createStudioRuntime, studioDivergence } from '../../studio/runtime.js';
import { createStudioTransport } from '../../studio/transport.js';
import { createStudioMeasurementRun } from '../../studio/measurement-run.js';
import { NO_TRACE, createTrace } from '../../core/trace.js';
import {
  REFERENCE_TEMPLATE_ID, listTemplates, templateModel,
} from '../../studio/templates/index.js';
import { createSynthUi } from '../../synth/ui.js';
import { createDirtyTracker, hashMigrationText } from '../../studio/library.js';
import { openModal, closeModal } from '../dialogs.js';
import { createGraphEditor } from './graph-editor.js';
import { createConnectDialog, createFindNode, createQuickAdd } from './graph-picker.js';
import { mountInspector } from './inspector.js';
import { mountLibrary } from './library-panel.js';
import { mountCompact } from './compact.js';
import { mountPatches, recordId } from './patches-panel.js';
import { mountPatchBrowser } from '../patch-browser.js';
import { registerSynthSources } from '../../synth/library.js';
import { registerRiffSource } from '../../studio/riffs/source.js';
import { mountStudioTimeline } from './timeline-editor.js';
import { studioBackTarget } from '../cross-links.js';
import { createWorkspaceDocument, dialogRegions } from './workspace/document.js';
import { createWorkspaceRuntime } from './workspace/runtime.js';
import { IDLE_TASK, createWorkspaceMeasurement } from './workspace/measurement.js';
import { createWorkspaceFiles } from './workspace/files.js';
import { createWorkspaceGraph } from './workspace/graph.js';
import { createWorkspaceTimeline } from './workspace/timeline.js';
import { createWorkspaceVoice } from './workspace/voice.js';
import {
  FULLSCREEN_UNSUPPORTED, createWorkspaceNavigation, fullscreenElementOf, fullscreenSupport,
} from './workspace/navigation.js';

export {
  STUDIO_SUBVIEWS, FULLSCREEN_UNSUPPORTED, FULLSCREEN_BLOCKED, fullscreenSupport,
  fullscreenElementOf, studioLinkView,
} from './workspace/navigation.js';
export { IDLE_TASK, studioExperimentName } from './workspace/measurement.js';
export {
  STUDIO_FILE_MAX_BYTES, RENDER_DEFAULT_S, renderTaskView, renderBlockedText, renderFileName,
  renderForm, parseRenderDuration,
} from './workspace/files.js';
export {
  studioStatus, compileWarningLine, MIC_SETTLE_MS, settleMicrophones, microphoneOutcome,
} from './workspace/runtime.js';
import { OWNER } from '../output-owner.js';

/** The parts of the workspace (./workspace/*.js), in the order their functions join `ops`. */
const PARTS = [createWorkspaceDocument, createWorkspaceRuntime, createWorkspaceMeasurement,
  createWorkspaceFiles, createWorkspaceGraph, createWorkspaceTimeline, createWorkspaceNavigation,
  createWorkspaceVoice];

/**
 * A stable handle over the current store (§9): the same object for every projection, the
 * document behind it replaceable (open project / template / import). Revisions are monotonic
 * across documents. subscribe(fn) -> off: fn(event) after every store change and replacement.
 * hold(fn) -> fn's result: the events of the changes fn makes reach the listeners once, when it
 * returns: the last model change (else the last event), so a command of many actions (L, M:
 * graph-commands.js) syncs, compiles and renders once (docs/v31/performance.md editMs).
 * `gate(next, info)`: the store's commit gate (actions.js), with info.revision in the handle's
 * monotonic numbering (the workspace passes transport.admit). `trace`: the operation trace port
 * (core/trace.js), its store steps carrying the handle's revision.
 */
export function createStoreHandle(initialModel, {
  registry = NODE_REGISTRY, gate = null, trace = NO_TRACE,
} = {}) {
  const listeners = new Set();
  let offset = 0;
  let store = null;
  let held = 0;
  let pending = null;
  const emit = (ev) => {
    if (held) {
      if (!pending || ev.type === 'model' || pending.type !== 'model') pending = ev;
      return;
    }
    for (const fn of [...listeners]) {
      try { fn(ev); } catch (e) { console.error('OSCILLA Studio listener failed:', e); }
    }
  };
  // The id generator is seeded from the store's own (normalized, validated) model on first use,
  // never from the raw argument: a partial model is a schema error, not a TypeError (V431 X10).
  const make = (m) => {
    let ids = null;
    const st = createStudioStore(m, { registry,
      idGenerator: (p) => (ids ||= createIdGenerator(st.getModel()))(p),
      onChange: (ev) => emit({ ...ev, revision: ev.revision + offset }),
      gate: typeof gate === 'function'
        ? (next, info) => gate(next, { ...info, revision: info.revision + offset }) : null,
      trace: { run: trace.run, record: (o, k, f) => trace.record(o, k, f.revision == null ? f
        : { ...f, revision: f.revision + offset }) } });
    return st;
  };
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
    hold(fn) {
      held++;
      try {
        return fn();
      } finally {
        if (--held === 0 && pending) {
          const ev = pending;
          pending = null;
          emit(ev);
        }
      }
    },
    /** Open another document (validated by createStudioStore); a new history. */
    replace(model, reason = 'replace') {
      const next = make(model);
      offset = handle.getRevision() + 1;
      store = next;
      trace.run(() => {
        trace.record('store', 'replace', { revision: handle.getRevision(),
          outcome: 'committed', detail: { reason } });
        emit({ type: 'model', reason, model: store.getModel(), selection: store.getSelection(),
          revision: handle.getRevision() });
      });
      return store.getModel();
    },
    /** The current store itself (tests: assert there is exactly one). */
    current: () => store,
  };
  return Object.freeze(handle);
}

/**
 * Studio PLAY's output claim (the transport's onClaimOutput): refused with the sentence of the
 * row of OUTPUT_REFUSALS that holds the output (svc.outputRefusalOf, ui/output-owner.js: a
 * measurement or a microphone level-reference capture, C024), the one table every claim reads;
 * otherwise every other owner stops (svc.stopPlayback) and the Studio takes the output. With
 * the playback bus (svc.claim, C037) it is the bus's one claim as the Studio.
 */
export function claimStudioOutput(cmp, svc, announce) {
  // The playback bus's claim (C037, svc.claim from main.js): the same table, refusal and stops.
  if (typeof svc.claim === 'function') {
    const r = svc.claim(OWNER.studio, 'play', { notify: false });
    if (!r.ok) announce(r.text, { assertive: true });
    return r.ok;
  }
  const refusal = cmp && typeof svc.outputRefusalOf === 'function'
    ? svc.outputRefusalOf(cmp) : null;
  if (refusal) {
    announce(refusal.text, { assertive: true });
    return false;
  }
  if (cmp && svc.stopPlayback) svc.stopPlayback(cmp);
  return true;
}

/**
 * The Alpine part of the STUDIO workspace. svc: { engine, stopPlayback(cmp),
 * outputRefusalOf(cmp) → the refusal row holding the output or null (Studio PLAY, the riffs) }.
 */
export function createStudioUi(svc = {}) {
  const registry = svc.registry || NODE_REGISTRY;
  const ctx = {
    registry, // the node registry, read by every part
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
    micErrors: new Map(), // Microphone node id → why its input is not open (Inspector)
    micBusy: false, // a permission request or an input opening is in flight
    compileWarning: '', // the warning a failed status compile set (cleared on recovery)
    trace: null,
    tracePending: false,
  };
  // The Inspector's Trace refreshes once an operation has ended (coalesced per task).
  const traceIdle = () => {
    if (ctx.tracePending) return;
    ctx.tracePending = true;
    queueMicrotask(() => {
      ctx.tracePending = false;
      if (ctx.inspector) ctx.inspector.renderTrace();
    });
  };
  // The page's one trace (main.js, C050: the playback bus records in it too), else its own.
  if (svc.trace) {
    ctx.trace = svc.trace;
    if (typeof svc.onTraceIdle === 'function') svc.onTraceIdle(traceIdle);
  } else {
    ctx.trace = createTrace({ now: Date.now, onIdle: traceIdle });
  }

  const viewEl = () => document.getElementById('osc-view-studio');
  const compactEl = () => document.querySelector('[data-osc="studio.compact"]');
  const graphHost = () => document.querySelector('[data-osc="studio.graph"]');

  // Every part's functions join `ops` before any of them runs (studioInit, mount, a command).
  const ops = { viewEl, compactEl, graphHost, setupAudio };
  const parts = PARTS.map((create) => create(ctx, svc, ops));
  for (const p of parts) Object.assign(ops, p.ops);
  const {
    announce, recompile, refreshStatus, allowMicrophone, admitEdit, refreshState, limitSignature,
    onStoreChange, onTransport, stopStudio, measureTaskView, setTask, onMeasureRun,
    runMeasurement, openDocument, detachDeleted, library, downloadFile, exitFullscreen,
    onKeyDown, onKeyUp,
  } = ops;

  function setupAudio() {
    if (ctx.transport || !svc.engine) return;
    const engine = svc.engine;
    ctx.runtime = createStudioRuntime({ engine, registry, trace: ctx.trace });
    // A pending handle settled (a Microphone opened, failed or ended): show its status, and
    // keep why an input is not open on that node (the stopped status shows it too).
    ctx.runtime.on((type, d) => {
      if (type === 'master') {
        // The level the Studio wrote into the engine's master stage, or null once it gave it
        // up: plain numbers for the status bar (C012), never the engine or one of its nodes.
        if (ctx.cmp) {
          ctx.cmp.studio.masterLevel = d.level;
          ctx.cmp.studio.masterWrites = d.writes;
        }
        return;
      }
      if (type !== 'handle') return;
      const h = ctx.runtime.nodes.get(d.id);
      if (h && h.type === 'microphone') {
        if (d.code === 'mic-error' || d.code === 'mic-ended') ctx.micErrors.set(d.id, h.reason);
        else if (h.status === 'ready') ctx.micErrors.delete(d.id);
      }
      queueMicrotask(refreshStatus);
    });
    ctx.measureRun = createStudioMeasurementRun({
      getModel: () => ctx.handle.getModel(),
      sampleRate: () => (engine.ctx ? engine.ctx.sampleRate : engine.sampleRate),
      now: () => (engine.ctx ? engine.ctx.currentTime : 0),
      run: runMeasurement,
      stopStudio: () => stopStudio({ fast: true }),
      onChange: onMeasureRun,
      profileId: () => (ctx.cmp && typeof ctx.cmp.measureAppliedProfileId === 'function'
        ? ctx.cmp.measureAppliedProfileId() : null),
      // The level MEASURE plays at once the Studio gives the output back (main.js sets the engine
      // from cmp.gainLevel); a Master Output showing another level is refused (V272 A5).
      outputLevel: () => (ctx.cmp && Number.isFinite(ctx.cmp.gainLevel) ? ctx.cmp.gainLevel : null),
    });
    ctx.transport = createStudioTransport({ runtime: ctx.runtime, engine: svc.engine,
      store: ctx.handle, registry, trace: ctx.trace,
      testContext: () => !!(ctx.cmp && ctx.cmp.meas && ctx.cmp.meas.loopback), // ADR 0052
      onMeasurement: (ev) => { if (ctx.measureRun) ctx.measureRun.hook(ev); },
      onClaimOutput: () => claimStudioOutput(ctx.cmp, svc, announce) });
    ctx.transport.on(onTransport);
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
      // Runtime truth (ADR 0039) as the domain states it: verdict and both debugInfo records.
      truth: () => ({ verdict: studioDivergence({ model: ctx.handle.getModel(),
        revision: ctx.handle.getRevision() }, ctx.runtime),
      runtime: ctx.runtime && ctx.runtime.debugInfo(),
      transport: ctx.transport && ctx.transport.debugInfo() }),
      trace: () => ctx.trace.steps(true), // settled operations only
      onConnect: (id, port) => ctx.connect.open(id, port),
      onReveal: (id) => cmp.studioReveal(id),
      onSavePatch: (ids) => ctx.patches.openSavePatch(ids),
      onDelete: () => ctx.editor.deleteSelection(),
      onDuplicate: () => ctx.editor.duplicateSelection(),
      onShowLane: (laneId, label) => cmp.studioShowLane(laneId, label),
      onAllowMicrophone: (id) => allowMicrophone(id),
      micError: (id) => ctx.micErrors.get(id) || '',
      micBusy: () => ctx.micBusy,
      userPatches: () => library().then((l) => l.patches()),
      openLibrary: () => cmp.patchLibraryOpen(),
      playhead: () => (ctx.transport ? ctx.transport.playhead() : null),
      liveTransport: () => ctx.transport || null, // K223: the step grid's Record switch
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
        announce(r.hashMigration ? `Opened ${r.summary.name}. ${hashMigrationText(r.hashMigration)}`
          : `Opened ${r.summary.name}`);
      },
      recordDeleted: (id) => detachDeleted(id),
      connections: (id) => (ctx.cmp && typeof ctx.cmp.connectionsOfStudioProject === 'function'
        ? ctx.cmp.connectionsOfStudioProject(id) : Promise.resolve(null)),
      follow: (c, before) => (ctx.cmp && typeof ctx.cmp.connectionsGo === 'function'
        ? ctx.cmp.connectionsGo(c, before) : Promise.resolve(false)),
      dirty: () => !!(ctx.cmp && ctx.cmp.studio && ctx.cmp.studio.dirty),
      downloadFile,
      ...dialogSvc,
    });
    // K102: the one patch library, shared by the Synth and the Studio, in the patches dialog.
    const libBody = document.querySelector('#osc-dlg-studio-library > div');
    const browserHost = libBody ? libBody.insertBefore(document.createElement('div'),
      libBody.lastElementChild) : null;
    registerSynthSources();
    registerRiffSource(svc, cmp);
    ctx.browser = browserHost ? mountPatchBrowser(browserHost, { store: ctx.handle, announce,
      userPatches: () => library().then((l) => l.patches()),
      savePatch: (p) => library().then(async (l) => l.savePatch(p, { now: new Date(),
        id: recordId('patch', p.name, (await l.list()).map((r) => r.id)) })),
      show: () => ctx.patches.openLibrary(),
      target: () => (cmp.workspace === 'studio' ? ctx.handle.getSelection().nodes[0] : null) })
      : null;
    // Each Studio dialog holds its live regions before anything is said in it (V272 C4).
    for (const d of document.querySelectorAll('dialog[data-osc-studio-dialog]')) dialogRegions(d);
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

  // The Synth workspace (K058-K066) shares this part's ONE store and transport.
  // sampleRate: the running context's (null before one), which sizes the XY pad's Y value.
  const synth = createSynthUi({
    get: () => ({ handle: ctx.handle, transport: ctx.transport, dirty: ctx.dirty,
      sampleRate: svc.engine ? svc.engine.sampleRate : null }),
    setupAudio: () => setupAudio(), announce, registry });

  // ---------------------------------------------------------------- the Alpine part
  return {
    ...synth,
    studio: {
      ready: false,
      title: '',
      dirty: false,
      persistent: true,
      memoryHeld: 0, // Studio projects and patches held by the memory fallback store
      storeNote: '',
      playing: false,
      armed: false, // the keys play the running graph while the timeline is stopped (K104)
      // The Studio's Master Output level while it holds the engine's master stage (runtime
      // 'master' events) and engine.masterWrites after that write; null otherwise (C012).
      masterLevel: null,
      masterWrites: null,
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
      backTo: 'playground', // the workspace the Studio was opened from (Back returns there)
    },

    studioInit() {
      ctx.cmp = this;
      ctx.handle = createStoreHandle(templateModel(REFERENCE_TEMPLATE_ID), { registry,
        gate: admitEdit, trace: ctx.trace });
      ctx.dirty = createDirtyTracker(ctx.handle.getModel());
      ctx.templateBaseline = createDirtyTracker(ctx.handle.getModel());
      ctx.handle.subscribe(onStoreChange);
      setupAudio();
      this.synthInit();
      // Registered before main.js's own window keydown listener: Studio keys run first and
      // stop the instrument's Space / Escape handling when they belong to Studio (§125).
      window.addEventListener('keydown', onKeyDown);
      window.addEventListener('keyup', onKeyUp);
      this.$watch('playing', (on) => { if (on && ctx.transport && ctx.transport.playing) stopStudio(); });
      // A sequence that takes the output stops the Studio: a subscription to the playback bus's
      // state (C051; its claim already stops the Studio through its yields), else the old watch.
      const seqTook = (on) => { if (on && ctx.transport && ctx.transport.playing) stopStudio(); };
      if (typeof svc.onPlayback === 'function') {
        svc.onPlayback((st) => seqTook(st.owner === OWNER.sequencer));
      } else this.$watch('seqPlaying', seqTook);
      // A Studio measurement shows MEASURE's own state and progress in the Studio task strip.
      const follow = () => {
        if (ctx.measureRun && ctx.measureRun.busy) setTask(measureTaskView());
      };
      this.$watch('meas.state', follow);
      this.$watch('meas.progressPct', follow);
      this.$watch('workspace', (ws, was) => {
        // Back returns where the Studio was opened from (links.md P8): Expand in the Sequencer,
        // a lab's template link, the navigation, Back / Forward.
        if (ws === 'studio' && was !== 'studio') this.studio.backTo = studioBackTarget(was);
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
      // Deep links reach studioApplyLinkHash through the hash dispatcher (main.js).
      // A page hide stops the Studio through the playback bus's stopAll (main.js, C050).
      this.$nextTick(() => {
        mount(this);
        library().catch(() => {});
      });
    },

    // The members of the parts: methods only, so the spread keeps each as it is.
    ...Object.assign({}, ...parts.map((p) => p.part)),

    /** ?debug=1: the operation trace's counts (ADR 0042). */
    studioTraceText() {
      const t = ctx.trace.stats();
      return `${t.size}/${t.cap} steps · ${t.ops} operations · ${t.dropped} dropped`;
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
        get trace() { return ctx.trace; },
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
