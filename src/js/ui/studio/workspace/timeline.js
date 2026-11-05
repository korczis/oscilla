// STUDIO workspace (src/js/ui/studio/workspace.js), timeline: the timeline commands the
// Inspector and the toolbar reach (an automation lane shown).

/**
 * The timeline members of the component over `ctx` (`ops` holds the functions of the other
 * parts). -> { ops, part }
 */
export function createWorkspaceTimeline(ctx, svc, ops) {
  const part = {
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
        ops.announce(`${label} is automated; open the Timeline to see its lane`);
        return;
      }
      if (!shown) this.studioSetSubview('timeline');
      ops.announce(shown ? `${label} automation lane shown`
        : `${label} automation lane shown in the Timeline view`);
      // After Alpine has applied the subview (its effect runs before the next frame).
      requestAnimationFrame(() => {
        if (ctx.timeline) ctx.timeline.revealLane(laneId, { focus: !shown });
      });
    },
  };
  return { ops: {}, part };
}
