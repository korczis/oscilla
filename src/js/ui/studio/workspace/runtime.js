// STUDIO workspace (src/js/ui/studio/workspace.js), runtime and transport: the node and edge
// status, Allow microphone, the store's commit gate, the playhead and the transport commands.
// The runtime and the transport themselves are built in workspace.js (setupAudio).
//
// Audio (§41-§46, §180-§186; rule project.audio-engine-discipline): the transport plays the
// store's model on the ONE AudioEngine through the Studio runtime. While playing, the store's
// commit gate (admitEdit -> transport.admit) applies an edit to the running graph before it is
// committed; an edit the runtime refuses is refused, announced and shown (ADR 0035). The
// playhead text observes AudioContext time through transport.playhead() in rAF: rAF only paints,
// it never schedules audio. STOP and Escape release everything (runtime.stop: 0 nodes after).
// Exclusivity (decision "Studio output and the Playground voice are exclusive"): PLAY claims the
// output (stops the instrument and the sequencer; refused while a measurement owns it), and the
// instrument or the sequencer starting stops the Studio.

import { NODE_REGISTRY } from '../../../studio/registry.js';
import { compileStudio } from '../../../studio/compiler.js';
import { studioDiagnostic } from '../../../studio/validate.js';
import {
  MIC_PRIVACY_NOTICE, MIC_UNAVAILABLE_TEXT, hasMicrophoneApi, micErrorMessage,
  requestMicrophonePermission,
} from '../../../audio/microphone.js';
import { announceAction } from '../../../studio/a11y.js';
import { compiledEdgeStatus, compiledStatus, nodeWarnings, runtimeStatus } from '../graph-view.js';
import { compactTime } from '../compact.js';
import { OWNER } from '../../output-owner.js';

/**
 * The node and edge status the Studio shows (§170-§171): from the running runtime while it plays
 * (what Web Audio actually runs, graph-view.js runtimeStatus, judged by the divergence verdict
 * for the store `revision` when given), otherwise from a compile of the model under the
 * runtime's capabilities (runtime.options: an allowed microphone is ready, not off).
 * -> { nodes: Map id -> { status, code, reason }, edges: Map id -> { status, code, reason },
 *      error: Diagnostic | null }
 * compileStudio refuses an invalid model without throwing; if it throws all the same, the status
 * is not blank: every node is degraded and every edge inactive with code `compile-failed`, and
 * `error` is that diagnostic (owner compiler).
 */
export function studioStatus(model, { runtime = null, engine = null, revision = null,
  registry = NODE_REGISTRY } = {}) {
  if (runtime && runtime.state === 'running') {
    return { ...runtimeStatus(model, runtime, revision), error: null };
  }
  const options = runtime && runtime.options ? runtime.options : {};
  let plan;
  try {
    plan = compileStudio(model, { engine, registry, options });
  } catch (e) {
    const error = studioDiagnostic('compiler', 'compile-failed', 'The Studio could not be '
      + `compiled: ${(e && e.message) || e}`, null, 'error');
    const st = (status) => ({ status, code: error.code, reason: error.message });
    const graph = (model && model.graph) || {};
    const list = (x) => (Array.isArray(x) ? x : []);
    return { error,
      nodes: new Map(list(graph.nodes).map((n) => [n.id, st('degraded')])),
      edges: new Map(list(graph.edges).map((x) => [x.id, st('inactive')])) };
  }
  return { nodes: compiledStatus(plan), edges: compiledEdgeStatus(plan), error: null };
}

/**
 * The warning line after a status compile (pure): a compile failure shows its message; once
 * the status compiles again the line is cleared, unless it shows something else by then.
 * { warning (the line), shown (the compile failure it shows, '' for none) } -> the same.
 */
export function compileWarningLine({ warning = '', shown = '' } = {}, error = null) {
  if (error) return { warning: error.message, shown: error.message };
  return { warning: shown && warning === shown ? '' : warning, shown: '' };
}

/** How long Allow microphone waits for the browser to open a running Microphone's input. */
export const MIC_SETTLE_MS = 15000;

/**
 * The running Microphone handles once none is pending (a permission prompt answered, the input
 * opened or failed), the runtime stopped (STOP drops its handles without a 'handle' event; then
 * []), or at `timeoutMs`: [{ id, status, code, reason }] (runtime 'handle' and 'state' events).
 */
export function settleMicrophones(runtime, { timeoutMs = MIC_SETTLE_MS } = {}) {
  // Nothing runs once stopped (STOP announces 'state' before it drops its handles).
  const list = () => (runtime && runtime.state === 'running' ? [...runtime.nodes.values()] : [])
    .filter((h) => h.type === 'microphone')
    .map((h) => ({ id: h.id, status: h.status, code: h.code || null, reason: h.reason || null }));
  const waiting = () => !!runtime && runtime.state === 'running'
    && list().some((m) => m.status === 'pending');
  if (!waiting()) return Promise.resolve(list());
  return new Promise((resolve) => {
    let off = null;
    const done = () => {
      if (off) off();
      clearTimeout(timer);
      resolve(list());
    };
    const timer = setTimeout(done, timeoutMs);
    off = runtime.on((type) => {
      if ((type === 'handle' || type === 'state') && !waiting()) done();
    });
  });
}

/**
 * What Allow microphone achieved (pure): { ok, text, failed: [{ id, reason }] }. While stopped
 * (or with no running Microphone) the input opens at PLAY; while playing, from the running Microphones (settleMicrophones): all
 * open, or the reason of each that is not.
 */
export function microphoneOutcome(mics, { playing = false } = {}) {
  // No running Microphone (a STOP during the wait drops them): nothing is open yet.
  if (!playing || !(mics && mics.length)) {
    return { ok: true, failed: [], text: 'Microphone allowed. The Microphone node opens the '
      + 'input when the Studio plays.' };
  }
  const failed = (mics || []).filter((m) => m.status !== 'ready')
    .map((m) => ({ id: m.id, reason: m.status === 'pending'
      ? 'The browser has not opened the microphone yet.'
      : m.reason || 'The input did not open.' }));
  return failed.length ? { ok: false, failed, text: failed[0].reason }
    : { ok: true, failed, text: 'Microphone open: the Microphone node analyses the input now.' };
}

/**
 * The runtime and transport functions over `ctx` (`ops` holds those of the other parts), and
 * their members of the component. -> { ops, part }
 */
export function createWorkspaceRuntime(ctx, svc, ops) {
  const { registry } = ctx;

  function recompile(model) {
    const st = studioStatus(model, { runtime: ctx.runtime, engine: svc.engine, registry,
      revision: ctx.handle.getRevision() });
    ctx.status = st.nodes;
    ctx.edgeStatus = st.edges;
    ctx.warnings = nodeWarnings(model, registry);
    if (!ctx.cmp) return;
    const line = compileWarningLine({ warning: ctx.cmp.studio.warning,
      shown: ctx.compileWarning }, st.error);
    if (ctx.cmp.studio.warning !== line.warning) ctx.cmp.studio.warning = line.warning;
    ctx.compileWarning = line.shown;
  }

  /** Status, graph and Inspector again (a runtime handle settled, a capability changed). */
  function refreshStatus() {
    if (!ctx.handle || !ctx.mounted) return;
    recompile(ctx.handle.getModel());
    if (ctx.editor) ctx.editor.render();
    if (ctx.inspector) ctx.inspector.render();
  }

  /**
   * Allow microphone (the Inspector, on Microphone node `id`): the browser is asked through
   * audio/microphone.js (the request openMicrophone makes; the probe's tracks stop at once),
   * then the runtime lets Microphone nodes open the input (setOptions: while playing they open,
   * or reopen after a failure, now; else at PLAY). The announcement is what happened: while
   * playing it waits for the inputs to open (settleMicrophones). A refusal keeps the input off,
   * and its reason is shown on that node in the Inspector (an alert there, not announced twice).
   * One request at a time. -> Promise<boolean> allowed and open (or to open at PLAY).
   */
  async function allowMicrophone(id = null) {
    if (ctx.micBusy) return false;
    ctx.micBusy = true;
    if (ctx.inspector) ctx.inspector.render();
    const env = svc.engine && svc.engine._env;
    const nav = (env && env.navigator) || (typeof navigator !== 'undefined' ? navigator : null);
    let error = '';
    let outcome = null;
    try {
      if (!hasMicrophoneApi(nav)) error = MIC_UNAVAILABLE_TEXT;
      else {
        ops.announce('Asking the browser for microphone permission.');
        try {
          await requestMicrophonePermission(nav.mediaDevices);
        } catch (e) {
          error = micErrorMessage(e);
        }
      }
      if (!error && !ctx.runtime) error = 'The Studio audio is not available here.';
      if (!error) {
        const r = ctx.runtime.setOptions({ inputPermission: true });
        if (r && r.ok === false) {
          error = `The microphone was allowed, but the Studio could not apply it: ${
            (r.errors && r.errors[0] && r.errors[0].message) || 'unknown error'}`;
        }
      }
      if (!error) {
        // Whether it plays is read after the wait: a STOP meanwhile means the input opens at the
        // next PLAY, not that it is open now (PR #119 S1).
        const mics = ctx.runtime.state === 'running' ? await settleMicrophones(ctx.runtime) : [];
        outcome = microphoneOutcome(mics, { playing: ctx.runtime.state === 'running' });
      }
    } finally {
      ctx.micBusy = false;
    }
    if (error) {
      if (id) ctx.micErrors.set(id, error);
    } else {
      ctx.micErrors.clear();
      for (const f of outcome.failed) ctx.micErrors.set(f.id, f.reason);
    }
    refreshStatus();
    if (error || !outcome.ok) return false; // the Inspector's alert says why
    ops.announce(`${outcome.text} ${MIC_PRIVACY_NOTICE}`);
    return true;
  }

  function statusSignature() {
    const sig = (m) => [...m].map(([id, v]) => `${id}=${v.status}:${v.reason || ''}`).join('|');
    return `${sig(ctx.status)}#${sig(ctx.edgeStatus)}`;
  }

  /** The store's commit gate: while playing, the running graph must take the edit first. */
  function admitEdit(next, info) {
    const r = ctx.transport ? ctx.transport.admit(next, info) : null;
    if (r && r.ok === false) {
      ops.announce(r.reason, { assertive: true });
      if (ctx.cmp) ctx.cmp.studio.warning = r.reason;
    }
    return r;
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
      // Armed (K104): the runtime runs for the keys while the timeline is stopped; PLAY reads
      // the timeline, the armed indicator the keys.
      const armed = !!ctx.transport.armed;
      cmp.studio.playing = playing && !armed;
      cmp.studio.armed = armed;
      if (ctx.editor) ctx.editor.setRunning(playing);
      if (ctx.compact) ctx.compact.setTransport({ playing: playing && !armed });
      if (playing && !ctx.raf) ctx.raf = requestAnimationFrame(tick);
      if (ctx.handle && ctx.mounted) {
        // Status follows the runtime while it plays and the compile while stopped.
        const before = statusSignature();
        recompile(ctx.handle.getModel());
        if (statusSignature() !== before && ctx.editor) ctx.editor.render();
        if (ctx.inspector) ctx.inspector.render(); // its Runtime section and state
      }
      if (!playing) {
        tick();
        // The playback bus (C037): the Studio no longer holds the output.
        if (typeof svc.release === 'function') svc.release(OWNER.studio);
        if (detail && detail.reason === 'end') ops.announce('Studio playback ended');
      }
    } else if (type === 'warning') {
      cmp.studio.warning = (detail && detail.message) || '';
      // Possibly inside the store's commit gate: show the diagnostic once the dispatch is done.
      queueMicrotask(() => { if (ctx.inspector) ctx.inspector.render(); });
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

  /** keepArmed: the user's STOP, which leaves a run that began armed armed (K104). */
  function stopStudio({ fast = false, keepArmed = false } = {}) {
    if (!ctx.transport) return Promise.resolve(null);
    const p = ctx.transport.stop({ fast, keepArmed });
    onTransport('state', { reason: 'stop' });
    return p;
  }

  const part = {
    studioOwnsOutput() {
      return !!(ctx.transport && ctx.transport.playing);
    },

    studioPlay() {
      ops.setupAudio();
      if (!ctx.transport) return false;
      if (typeof this.measureOwnsOutput === 'function' && this.measureOwnsOutput()) {
        ops.announce('Studio did not start: the measurement owns the output. Stop it first (Esc).',
          { assertive: true });
        return false;
      }
      ensureAudio();
      if (ctx.measureRun && !ctx.measureRun.busy) ctx.measureRun.reset();
      this.studio.measureNote = '';
      const r = ctx.transport.start();
      if (!r.ok) {
        ops.announce(`Studio did not start: ${r.reason}`, { assertive: true });
        if (ctx.inspector) ctx.inspector.render(); // the Runtime section says it failed
        return false;
      }
      onTransport('state', { reason: 'play' });
      ops.announce('Studio playing');
      return true;
    },

    /** keepArmed: the Stop button and the toggle (K104); another owner's stop passes none. */
    studioStop({ keepArmed = false } = {}) {
      const run = ctx.measureRun;
      if (run && run.view.state === 'running' && typeof this.measureAbort === 'function') {
        this.measureAbort('user');
      }
      const p = stopStudio({ keepArmed: keepArmed === true });
      ops.announce(ctx.transport && ctx.transport.armed
        ? 'Studio zastaveno, klávesy dál hrají (zapnuté).' : 'Studio stopped');
      return p;
    },

    studioTogglePlay() {
      const t = ctx.transport;
      return t && t.playing && !t.armed ? this.studioStop({ keepArmed: true }) : this.studioPlay();
    },

    studioToggleLoop() {
      const model = ctx.handle.getModel();
      const loop = model.timeline.loop;
      const r = ctx.transport ? ctx.transport.setLoop({ enabled: !loop.enabled })
        : ctx.handle.dispatch({ type: 'LOOP_SET', enabled: !loop.enabled });
      if (r.ok) ops.announce(`Loop ${loop.enabled ? 'off' : 'on'}`);
      else ops.announce(announceAction(r), { assertive: true });
    },

    studioReturn() {
      if (ctx.transport) ctx.transport.returnToStart();
      tick();
      ops.announce('Returned to start');
    },
  };
  return { ops: { recompile, refreshStatus, allowMicrophone, admitEdit, onTransport, stopStudio },
    part };
}
