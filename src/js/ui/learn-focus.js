// E074 (oscilla-c3's pinned race on #558, 2026-11-15): a Learn demo moves focus to the
// transport one tick late, after its workspace is shown. Within that tick a keyboard user may
// already have followed the demo's notice back to Learn and pressed Back, and the router has
// focused the Playground heading; the late focus must not take it away. It applies only while
// nothing has moved since the demo ran.

/**
 * Whether the demo's deferred focus still applies: the workspace is the one the demo opened,
 * and focus is still where the demo left it (the demo button, nowhere, or inside the Learn
 * view the demo hid).
 * @param {{ workspaceThen: string, workspaceNow: string, before: Element|null,
 *   active: Element|null, body: Element|null, learnView: Element|null }} s
 */
export function demoFocusStillWanted({ workspaceThen, workspaceNow, before, active, body,
  learnView }) {
  if (workspaceNow !== workspaceThen) return false;
  if (!active || active === body || active === before) return true;
  return !!(learnView && learnView.contains(active));
}

/**
 * Focus the transport's Podržet a hrát on the app's next tick, only while
 * demoFocusStillWanted holds then for the state captured now.
 * @param {{ workspace: string, $nextTick: (fn: () => void) => void }} app
 * @param {(el: Element|null) => void} focus
 * @param {Document} [doc]
 */
export function deferDemoFocus(app, focus, doc = document) {
  const then = { workspaceThen: app.workspace, before: doc.activeElement };
  app.$nextTick(() => {
    if (!demoFocusStillWanted({ ...then, workspaceNow: app.workspace, active: doc.activeElement,
      body: doc.body, learnView: doc.getElementById('osc-view-learn') })) return;
    focus(doc.getElementById('osc-hold-play'));
  });
}
