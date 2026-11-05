// The graph editor's fit mode (plan K170, coherent-state#views-describe-what-sounds): the model's
// graph view is the view the editor shows, from the first frame.
//
// Design (K170 option b): the editor's own fit commits at once as a VIEW_SET, which is already
// presentation-only (actions.js: outside studioHash, no undo entry, no revision, never dirty).
// No model field is added, so the schema, the saved bytes and the hash of every document saved
// before this change stay as they were, and the model always holds numbers a reader can use.
// Whether the view is still a fit is the editor's view state, like a gesture's live view:
//
//   - a document opens in fit mode when its graph view is the default one (schema.js
//     DEFAULT_VIEW.graph: a view no editor ever committed, as a template's); a saved document
//     with any other view opens at that view and is not refitted;
//   - Frame All enters fit mode;
//   - while in fit mode, a change of the viewport's size (the window, the docked keys, which show
//     only while the Studio is armed, M086) fits again and commits the new numbers at once;
//   - any other view change (zoom, pan, pinch, wheel, the minimap, Frame Selection, focusing a
//     node) leaves fit mode, after which a resize never changes the zoom.
//
//   createViewFit({ store, size, bounds, options, apply }) -> fit
//     size() -> { w, h }      the viewport's size now (0 while hidden: the fit waits for a size)
//     bounds() -> rect|null   the bounds of every node card (graph-geometry.js boundsOf)
//     options() -> {}         fitView options (a coarse pointer's minimum zoom)
//     apply(view)             the editor shows `view` (its local view, no commit)
//   fit.open()    adopt the model's view: fit mode iff it is the default view; fits when it can
//   fit.frame()   Frame All: enter fit mode and fit
//   fit.resize()  the viewport changed size: fit again when still in fit mode
//   fit.leave()   a user's view change: leave fit mode
//   fit.fitted()  whether the view is in fit mode
//   Each of open/frame/resize returns the view it applied and committed, or null.

import { DEFAULT_VIEW } from '../../studio/schema.js';
import { fitView, normalizeView } from './graph-geometry.js';

/** True when `v` is the default graph view, which no editor has committed (open it fitted). */
export function isUnframedView(v) {
  const d = DEFAULT_VIEW.graph;
  return !!v && v.panX === d.panX && v.panY === d.panY && v.zoom === d.zoom;
}

export function createViewFit({ store, size, bounds, options = () => ({}), apply }) {
  let fitMode = false;

  function fit() {
    const sz = size();
    if (!(sz && sz.w > 0 && sz.h > 0)) return null;
    const view = normalizeView(fitView(bounds(), sz, options()));
    apply(view);
    const cur = store.getModel().view.graph;
    if (cur.panX !== view.panX || cur.panY !== view.panY || cur.zoom !== view.zoom) {
      store.dispatch({ type: 'VIEW_SET', view: { graph: { ...view } } });
    }
    return view;
  }

  return {
    open() {
      const v = store.getModel().view.graph;
      fitMode = isUnframedView(v);
      if (fitMode) return fit();
      apply(normalizeView(v));
      return null;
    },
    frame() {
      fitMode = true;
      return fit();
    },
    resize: () => (fitMode ? fit() : null),
    leave() {
      fitMode = false;
    },
    fitted: () => fitMode,
  };
}
