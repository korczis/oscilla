// Test seam of the Studio timeline (exposed as window.OSCILLA.studioTimeline by main.js): the
// browser suite mounts the timeline editor and the compact timeline on the built dist with a
// Studio context of its own, wired exactly as the timeline expects from the Studio shell —
// one store, a runtime and a transport on the app's ONE AudioEngine, the transport synced from
// the store's onChange (docs/v31/timeline.md "Transport integration"). The Playground voice is
// released when the Studio claims the output (docs/v31/compiler.md exclusivity decision).
// Nothing here runs unless a test calls it.

import { createIdGenerator, createStudioStore } from '../../studio/actions.js';
import { createStudioRuntime } from '../../studio/runtime.js';
import { REFERENCE_TEMPLATE_ID, templateModel } from '../../studio/templates/index.js';
import { createStudioTransport } from '../../studio/transport.js';
import { renderCompactTimeline } from './compact-timeline.js';
import { mountStudioTimeline } from './timeline-editor.js';

/**
 * A Studio context for the timeline: { store, transport, runtime, announce, getSelection,
 * setSelection, subscribe, announcements, dispose() }. `model` overrides the template.
 */
export function createTimelineTestContext({ engine, template = REFERENCE_TEMPLATE_ID,
  model = null, onClaimOutput = null } = {}) {
  const m = model || templateModel(template);
  const listeners = new Set();
  const announcements = [];
  let transport = null;
  const store = createStudioStore(m, {
    idGenerator: createIdGenerator(m),
    onChange: (ev) => {
      if (ev.type === 'model' && transport) transport.sync();
      for (const fn of listeners) fn(ev);
    },
  });
  const runtime = createStudioRuntime({ engine });
  transport = createStudioTransport({ runtime, engine, store,
    onClaimOutput: onClaimOutput || (() => { engine.stopAll(); }) });
  return {
    store,
    transport,
    runtime,
    announcements,
    announce: (text) => { if (text) announcements.push(String(text)); },
    getSelection: () => store.getSelection(),
    setSelection: (selection) => store.dispatch({ type: 'SELECTION_CHANGE', selection }),
    subscribe: (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    dispose: () => transport.dispose().then((c) => runtime.dispose().then(() => c)),
  };
}

/** The seam object: mount functions plus the context factory bound to the app's engine. */
export function studioTimelineSeam(engine) {
  return Object.freeze({
    mountStudioTimeline,
    renderCompactTimeline,
    createContext: (opts = {}) => createTimelineTestContext({ engine, ...opts }),
  });
}
