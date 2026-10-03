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
// Alpine holds only small plain view state (`studio`); the store, runtime, transport and view
// controllers live in the closure `ctx`, never in reactive state.

import { NODE_REGISTRY } from '../../studio/registry.js';
import { createIdGenerator, createStudioStore } from '../../studio/actions.js';
import { compileStudio } from '../../studio/compiler.js';
import { createStudioRuntime } from '../../studio/runtime.js';
import { createStudioTransport } from '../../studio/transport.js';
import { resolveEscape } from '../../studio/timeline-compiler.js';
import {
  REFERENCE_TEMPLATE_ID, listTemplates, templateModel,
} from '../../studio/templates/index.js';
import {
  createDirtyTracker, createStudioLibrary, exportProjectFile, importStudioFile,
} from '../../studio/library.js';
import { announceRedo, announceUndo, announceAction } from '../../studio/a11y.js';
import { openExperimentStoreOrMemory } from '../../experiments/store.js';
import { KNOWN_ALGORITHM_IDS } from '../../measurement/algorithms.js';
import { openModal, closeModal } from '../dialogs.js';
import { downloadBlob, readFileText } from '../exporters.js';
import { createGraphEditor } from './graph-editor.js';
import { compiledStatus, nodeWarnings } from './graph-view.js';
import { STUDIO_SHORTCUTS, isEditingTarget, resolveStudioKey } from './graph-keys.js';
import { createConnectDialog, createQuickAdd } from './graph-picker.js';
import { mountInspector } from './inspector.js';
import { mountLibrary } from './library-panel.js';
import { compactTime, mountCompact } from './compact.js';
import { STUDIO_STORE_FALLBACK_TEXT, mountPatches, recordId } from './patches-panel.js';
import { mountStudioTimeline } from './timeline-editor.js';

export const STUDIO_SUBVIEWS = Object.freeze(['graph', 'timeline', 'inspector']);
/** Largest Studio file read from disk (the import pipeline re-checks every limit). */
export const STUDIO_FILE_MAX_BYTES = 4 * 1024 * 1024;

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
    patches: null,
    timeline: null,
    status: new Map(),
    warnings: new Map(),
    dirty: null,
    projectId: null,
    lib: null,
    libOpening: null,
    raf: 0,
    limitSig: '',
    templateId: REFERENCE_TEMPLATE_ID,
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

  function setupAudio() {
    if (ctx.transport || !svc.engine) return;
    ctx.runtime = createStudioRuntime({ engine: svc.engine, registry });
    ctx.transport = createStudioTransport({ runtime: ctx.runtime, engine: svc.engine,
      store: ctx.handle, registry,
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
    if (ctx.editor) requestAnimationFrame(() => ctx.editor.frameAll());
    refreshState();
  }

  function library() {
    if (ctx.lib) return Promise.resolve(ctx.lib);
    if (!ctx.libOpening) {
      ctx.libOpening = openExperimentStoreOrMemory({
        indexedDB: typeof indexedDB !== 'undefined' ? indexedDB : null,
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
      warnings: () => ctx.warnings,
      onQuickAdd: (o) => ctx.quickAdd.open(o),
      onConnectDialog: (id) => ctx.connect.open(id),
      onActivateNode: () => {
        if (cmp.studio.subview !== 'inspector' && window.matchMedia('(max-width: 767.98px)')
          .matches) cmp.studioSetSubview('inspector');
        requestAnimationFrame(() => ctx.inspector && ctx.inspector.focusFirst());
      },
    });
    const pickSvc = { store: ctx.handle, registry, editor: ctx.editor, announce, ...dialogSvc };
    ctx.quickAdd = createQuickAdd(document.getElementById('osc-dlg-studio-add'), pickSvc);
    ctx.connect = createConnectDialog(document.getElementById('osc-dlg-studio-connect'), pickSvc);
    const inspHost = document.querySelector('[data-osc="studio.inspector"]');
    ctx.inspector = mountInspector(inspHost, {
      store: ctx.handle,
      registry,
      announce,
      status: () => ctx.status,
      warnings: () => ctx.warnings,
      onConnect: (id) => ctx.connect.open(id),
      onSavePatch: (ids) => ctx.patches.openSavePatch(ids),
      onDelete: () => ctx.editor.deleteSelection(),
      onDuplicate: () => ctx.editor.duplicateSelection(),
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
    },

    studioInit() {
      ctx.cmp = this;
      ctx.handle = createStoreHandle(templateModel(REFERENCE_TEMPLATE_ID), { registry });
      ctx.dirty = createDirtyTracker(ctx.handle.getModel());
      ctx.handle.subscribe(onStoreChange);
      setupAudio();
      // Registered before main.js's own window keydown listener: Studio keys run first and
      // stop the instrument's Space / Escape handling when they belong to Studio (§125).
      window.addEventListener('keydown', onKeyDown);
      window.addEventListener('keyup', onKeyUp);
      this.$watch('playing', (on) => { if (on && ctx.transport && ctx.transport.playing) stopStudio(); });
      this.$watch('seqPlaying', (on) => { if (on && ctx.transport && ctx.transport.playing) stopStudio(); });
      this.$watch('workspace', (ws) => {
        if (ws === 'studio' && ctx.editor) requestAnimationFrame(() => ctx.editor.onShow());
      });
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
      ensureAudio();
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

    studioReturn() {
      if (ctx.transport) ctx.transport.returnToStart();
      tick();
      announce('Returned to start');
    },

    studioUndo() {
      if (ctx.editor) ctx.editor.endNudge();
      const r = ctx.handle.undo();
      announce(announceUndo(r));
    },

    studioRedo() {
      const r = ctx.handle.redo();
      announce(announceRedo(r));
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
    },

    studioOpenTemplates() {
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
