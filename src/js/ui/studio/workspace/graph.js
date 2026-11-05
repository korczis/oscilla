// STUDIO workspace (src/js/ui/studio/workspace.js), graph: the workspace keys (Escape, the
// transport and history keys, the graph editor's commands) and the graph commands of the
// toolbar.
//
// Find node (§250-§251; plan V428): `/` or the Find button opens graph-picker.js createFindNode;
// a result is selected, framed and focused.

import { resolveEscape } from '../../../studio/timeline-compiler.js';
import { isEditingTarget, resolveStudioKey } from '../graph-keys.js';

/**
 * The graph functions over `ctx` (`ops` holds those of the other parts), and their members of
 * the component. -> { ops, part }
 */
export function createWorkspaceGraph(ctx, svc, ops) {
  // ---------------------------------------------------------------- keyboard
  const studioDialogOpen = () => !!document.querySelector('dialog[open][data-osc-studio-dialog]');
  const otherDialogOpen = () => !!document.querySelector(
    'dialog[open][data-oscilla-modal]:not([data-osc-studio-dialog])');

  function onKeyDown(e) {
    const cmp = ctx.cmp;
    if (!cmp || !ctx.mounted || e.defaultPrevented) return;
    const t = e.target instanceof Element ? e.target : null;
    const view = ops.viewEl();
    const compact = ops.compactEl();
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
        ops.stopStudio({ fast: true });
        ops.announce('Studio stopped');
      }
      return;
    }
    if (!(active || inCompact) || studioDialogOpen() || otherDialogOpen()) return;
    if (isEditingTarget(t)) return;
    const cmd = resolveStudioKey(e);
    if (!cmd) return;
    const inGraph = !!(t && ops.graphHost() && ops.graphHost().contains(t));
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
      case 'delete-bridge': consume(); ed.deleteBridge(); break;
      case 'tidy': consume(); ed.tidy(); break;
      case 'mute': consume(); ed.toggleMute(); break;
      case 'copy': consume(); ed.copySelection(); break;
      case 'cut': consume(); ed.cutSelection(); break;
      case 'paste': consume(); ed.paste(); break;
      case 'duplicate': consume(); ed.duplicateSelection(); break;
      case 'select-all': consume(); ed.selectAll(); break;
      case 'select-toggle': consume(); ed.toggleFocusedNode(); break;
      case 'quick-add': consume(); cmp.studioAddNode(); break;
      case 'connect': {
        consume();
        const sel = ctx.handle.getSelection().nodes;
        if (sel.length) ctx.connect.open(sel[sel.length - 1]);
        else ops.announce('Select a node to connect.');
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

  const part = {
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
      ops.announce(`Found ${n.metadata.name}: selected and framed`);
      return true;
    },

    studioAddNode() {
      if (ctx.quickAdd) ctx.quickAdd.open({ at: ctx.editor ? ctx.editor.centerPoint() : null });
    },

    studioFrameAll() {
      if (ctx.editor) ctx.editor.frameAll();
    },
  };
  return { ops: { onKeyDown, onKeyUp }, part };
}
