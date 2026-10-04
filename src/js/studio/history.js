// Studio undo/redo history (spec §48-§52). Pure bookkeeping over immutable model snapshots; no
// DOM, no globals, no clock.
//
// Strategy (§49): IMMUTABLE SNAPSHOTS WITH STRUCTURAL SHARING, not command objects with inverses.
// Every action (actions.js) returns a new model that shares every unchanged sub-object with the
// previous one, and an entry stores the two model references { before, after }. Undo restores
// `before` exactly — no inverse code exists that could drift from its forward action, which is
// what makes the §208 round trip exact by construction. Memory per entry is the changed path
// only: a node move allocates a new nodes array (one pointer per node), one node, one position
// and the enclosing graph/model objects; everything else is shared. At the §145 target (100
// nodes, 200 edges) that is about 1-2 KB per entry, so STUDIO_HISTORY_LIMIT entries stay well
// under a megabyte; a command log would be smaller per entry but needs a hand-written inverse
// for each of ~25 actions and their cascades (node delete → edges, clips, lanes).
//
// Gestures (§50): beginGesture(label, model) ... endGesture(model) folds every change made in
// between into ONE entry from the model at begin to the model at end (a 400-event drag is one
// "Move Filter 1"). Gestures nest by depth; only the outermost end commits. A new edit after
// undo clears redo (§51), including the first change inside a gesture; cancelGesture puts the
// cleared redo entries back, since the cancelled gesture leaves no edit behind.
//
//   createHistory({ limit }) -> history
//   history.record({ label, before, after, actionType })   (absorbed while a gesture is open)
//   history.beginGesture(label, model), history.endGesture(model) -> entry | null
//   history.cancelGesture() -> model at gesture begin | null
//   history.gestureStart() -> model at the open gesture's begin | null (nothing changes)
//   history.undo() -> entry | null (caller restores entry.before); history.redo() -> entry | null
//   history.canUndo(), canRedo(), undoLabel(), redoLabel(), depth() -> { undo, redo },
//   history.inGesture(), history.clear()

/**
 * Maximum undo entries kept (oldest dropped first). A Majordomus decision candidate: 200 covers a
 * long editing session at well under 1 MB with structural sharing (see above).
 */
export const STUDIO_HISTORY_LIMIT = 200;

export function createHistory({ limit = STUDIO_HISTORY_LIMIT } = {}) {
  if (!Number.isInteger(limit) || limit < 1) throw new RangeError('createHistory: limit >= 1');
  const undoStack = [];
  const redoStack = [];
  let gesture = null;

  const push = (entry) => {
    undoStack.push(Object.freeze(entry));
    if (undoStack.length > limit) undoStack.shift();
  };

  return {
    record(entry) {
      if (gesture) {
        if (!gesture.changed) gesture.clearedRedo = redoStack.splice(0);
        gesture.changed = true;
        if (!gesture.label) gesture.label = entry.label;
        if (!gesture.actionType) gesture.actionType = entry.actionType;
        return null;
      }
      redoStack.length = 0;
      push({ label: entry.label, before: entry.before, after: entry.after,
        actionType: entry.actionType || null });
      return undoStack[undoStack.length - 1];
    },
    beginGesture(label, model) {
      if (gesture) {
        gesture.depth++;
        return;
      }
      gesture = { label: label || null, before: model, depth: 1, changed: false,
        actionType: null, clearedRedo: [] };
    },
    endGesture(model) {
      if (!gesture) return null;
      if (--gesture.depth > 0) return null;
      const g = gesture;
      gesture = null;
      if (!g.changed || model === g.before) {
        redoStack.push(...g.clearedRedo); // no net edit: nothing to invalidate redo
        return null;
      }
      push({ label: g.label || 'Edit', before: g.before, after: model,
        actionType: g.actionType });
      return undoStack[undoStack.length - 1];
    },
    cancelGesture() {
      if (!gesture) return null;
      const g = gesture;
      gesture = null;
      redoStack.push(...g.clearedRedo);
      return g.before;
    },
    gestureStart: () => (gesture ? gesture.before : null),
    inGesture: () => !!gesture,
    undo() {
      const e = undoStack.pop();
      if (!e) return null;
      redoStack.push(e);
      return e;
    },
    redo() {
      const e = redoStack.pop();
      if (!e) return null;
      undoStack.push(e);
      return e;
    },
    canUndo: () => undoStack.length > 0,
    canRedo: () => redoStack.length > 0,
    undoLabel: () => (undoStack.length ? undoStack[undoStack.length - 1].label : null),
    redoLabel: () => (redoStack.length ? redoStack[redoStack.length - 1].label : null),
    depth: () => ({ undo: undoStack.length, redo: redoStack.length }),
    clear() {
      undoStack.length = 0;
      redoStack.length = 0;
      gesture = null;
    },
  };
}
