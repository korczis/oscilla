// The Studio ↔ Filter Lab bridge (plan U006, P08 of the owner's pack; the contract agreed with
// the Studio owner): a Studio filter node opens in Filter Lab with its type, cutoff and Q, and
// the way back returns to Studio with that node selected and focused. Composed into the ONE
// OSCILLA component by main.js (Object.defineProperties, never spread), like ui/navigation.js;
// its own state lives in the closure `st`, and Alpine holds only the context line `labFrom`.
//
//   openInLab(nodeId) -> { ok: true, hash } | { ok: false, reason }
//     The one entry point (the Inspector's "Open in Filter Lab"; later the Studio owner's
//     long-press and box menus). A filter node goes to `#m=filter&from=studio&node=<id>&rev=<the
//     store revision>` (core/url-state-lab.js) as a link: one history entry, applied by the hash
//     dispatcher (ui/navigation.js) like any link. Anything else is refused with a sentence.
//   resolveLabLink(link, { model, revision, madeHere, registry, labTypes }) -> resolution
//     pure: { ok: true, nodeId, name, values: { type, frequency, Q, gain }, bypassed, stale,
//     linkRevision, revision } | { ok: false, reason }. The values are the node's own through
//     studio/node-params.js (nodeParamsOf, labFilterOf: the one filter mapping, the one
//     playground-voice.js builds a Filter with).
//   canOpenInLab(model, nodeId) -> boolean   a filter node of `model`
//
// What the bridge holds to (the contract):
//   - Filter Lab reads the node and applies the values through its own API (labs/filter-lab.js
//     update, which ends in set()); nothing is written back to Studio, no store action runs.
//   - `rev` is a staleness hint only. The revision is in memory and per page (§178), so it is
//     compared only for a link this page made (openInLab); a mismatch shows the current values
//     and says so. After a reload, or a link made elsewhere, nothing is compared: the node loads
//     when the document open now has it.
//   - Refused, visibly and with nothing converted: no such node, a node that is not a Filter, a
//     filter type Filter Lab has no selector for. The lab keeps its own values. A value the lab
//     limits to its range is shown limited and said so.
//   - Back (the browser's, or the context line's link) returns to Studio with the node selected
//     (SELECTION_CHANGE: view state, not undoable, not dirty, no revision) and focused; the
//     graph's view is not moved (workspace.js studioFocusNode, never frameSelection).
//   - Nothing starts sound or the microphone: no engine call, no AudioContext.

import { decodeLabLink, encodeLabLink, LAB_LINK_MODE } from '../../core/url-state-lab.js';
import { formatFrequency } from '../../core/frequency.js';
import { routeOfHash } from '../navigation.js';
import {
  FILTER_LAB_FIELDS, FILTER_NODE_TYPE, labFilterOf, nodeParamsOf,
} from '../../studio/node-params.js';
import { NODE_REGISTRY } from '../../studio/registry.js';

/** The filter types Filter Lab has a selector for (its radios, src/index.html filter.type). */
export const FILTER_LAB_TYPES = Object.freeze(['lowpass', 'highpass', 'bandpass', 'notch',
  'peaking']);
export const LAB_BRIDGE_SETPOINT_NOTE = 'Its set values: automation and modulation in Studio '
  + 'do not apply here.';

/** The context line's way back: a context link, shown only with the line (not a panel link). */
const BACK_HREF = '#m=studio';
const FIELD_LABELS = Object.freeze({ frequency: 'Cutoff', Q: 'Q', gain: 'Gain' });
const fmt = (k, v) => (k === 'frequency' ? formatFrequency(v)
  : k === 'gain' ? `${Number(v.toFixed(1))} dB` : String(Number(v.toPrecision(3))));
const close = (a, b) => Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));

function nodeOf(model, nodeId) {
  return ((model && model.graph && model.graph.nodes) || []).find((n) => n.id === nodeId) || null;
}

const nameOf = (node) => (node.metadata && node.metadata.name) || node.id;

function typeLabel(registry, value) {
  const p = registry.param(FILTER_NODE_TYPE, 'type');
  const o = p && p.options ? p.options.find((x) => x[0] === value) : null;
  return o ? o[1] : String(value);
}

/** True for a filter node of `model`: the one kind of node Filter Lab can open. */
export function canOpenInLab(model, nodeId) {
  const n = nodeOf(model, nodeId);
  return !!n && n.type === FILTER_NODE_TYPE;
}

/** The node a lab link names, resolved against the document open now (see the header). */
export function resolveLabLink(link, { model, revision, madeHere = false,
  registry = NODE_REGISTRY, labTypes = FILTER_LAB_TYPES } = {}) {
  const np = nodeOf(model, link.nodeId) ? nodeParamsOf(model, link.nodeId, registry) : null;
  if (!np) {
    return { ok: false, reason: `Studio has no node "${link.nodeId}" in the document open now, `
      + 'so Filter Lab keeps its own values.' };
  }
  const node = nodeOf(model, link.nodeId);
  const name = nameOf(node);
  if (np.type !== FILTER_NODE_TYPE) {
    const def = registry.get(np.type);
    const what = def ? def.displayName : np.type;
    return { ok: false, reason: `Studio node ${name} is ${/^[AEIOU]/i.test(what) ? 'an' : 'a'} `
      + `${what}, not a Filter, so Filter Lab keeps its own values.` };
  }
  const values = labFilterOf(np.params);
  if (!labTypes.includes(values.type)) {
    return { ok: false, reason: `Filter Lab has no ${typeLabel(registry, values.type)} type, so `
      + `Studio node ${name} is not shown here; Filter Lab keeps its own values.` };
  }
  const stale = !!madeHere && Number.isInteger(link.revision) && link.revision !== revision;
  return { ok: true, nodeId: link.nodeId, name, values, bypassed: np.params.enabled === false,
    stale, linkRevision: link.revision, revision };
}

/** The sentence a stale link shows (a link this page made, at another revision). */
export function staleNotice(linkRevision, revision) {
  return `The node may have changed since this link was made (Studio revision ${linkRevision}, `
    + `now ${revision}); showing its current values.`;
}

/** What Filter Lab could not show as the node has it: requested vs applied, per field. */
export function limitedNotices(want, got) {
  return FILTER_LAB_FIELDS.filter((k) => k !== 'type' && Number.isFinite(want[k])
    && Number.isFinite(got[k]) && !close(want[k], got[k]))
    .map((k) => `${FIELD_LABELS[k]} ${fmt(k, want[k])} is outside Filter Lab's range; shown as `
      + `${fmt(k, got[k])}.`);
}

// The one bound instance: openInLab is callable from any Studio surface without plumbing.
let bound = null;

/** Open Studio node `nodeId` in Filter Lab (see the header). */
export function openInLab(nodeId) {
  if (!bound) return { ok: false, reason: 'Filter Lab is not ready yet.' };
  return bound(nodeId);
}

/**
 * The component part. svc: { lab() -> the mounted Filter Lab (labs/filter-lab.js) or null,
 * registry, win }. Needs the Studio part's studioDocument() and studioFocusNode(id).
 */
export function createLabBridgeUi(svc = {}) {
  const registry = svc.registry || NODE_REGISTRY;
  const win = () => svc.win || window;
  const st = {
    made: new Set(),   // `${nodeId}@${revision}` of the links openInLab made in this page
    pending: null,     // a resolution waiting for Filter Lab to mount (a deep link's load)
    ret: null,         // the node the way back returns to
    returning: false,  // a Back from Filter Lab to Studio is under way
  };

  return {
    /**
     * The context line over Filter Lab: { kind: 'from' | 'refused', text, notice, back }
     * (back: the address of its Back to Studio link).
     */
    labFrom: null,

    labBridgeInit() {
      bound = (nodeId) => this.labOpenFromStudio(nodeId);
      // Capture runs before the dispatcher's own popstate listener, while the workspace is
      // still Filter Lab: a traversal from it to a Studio entry is the browser's Back.
      win().addEventListener('popstate', () => {
        if (this.workspace !== LAB_LINK_MODE || !st.ret) return;
        const r = routeOfHash(win().location.hash);
        if (r && r.workspace === 'studio') st.returning = true;
      }, { capture: true });
      this.$watch('workspace', (ws, was) => {
        const back = st.returning;
        st.returning = false;
        if (!back || ws !== 'studio' || was !== LAB_LINK_MODE || !st.ret) return;
        const id = st.ret;
        // After setWorkspace's own focus (its $nextTick), and once the graph is laid out.
        this.$nextTick(() => requestAnimationFrame(() => this.studioFocusNode(id)));
      });
    },

    /** openInLab, on this component (see the header). */
    labOpenFromStudio(nodeId) {
      const { model, revision } = this.studioDocument();
      if (!canOpenInLab(model, nodeId)) {
        const n = nodeOf(model, nodeId);
        const reason = n ? `Studio node ${nameOf(n)} is not a Filter; only a Filter opens in `
          + 'Filter Lab.' : `Studio has no node "${nodeId}".`;
        this.notify('warning', 'Not opened in Filter Lab', reason);
        return { ok: false, reason };
      }
      const hash = encodeLabLink({ nodeId, revision });
      st.made.add(`${nodeId}@${revision}`);
      win().location.hash = hash;
      return { ok: true, hash };
    },

    /**
     * The hash domain 'lab' (ui/navigation.js): true (applied, or waiting for Filter Lab to
     * mount), false (refused, said in the context line and a notice) or null (no lab key).
     */
    labApplyLinkHash(hash, origin) {
      const d = decodeLabLink(hash);
      if (d === null) return null;
      if (!d.ok) return this.labRefuse(d.reason);
      const { model, revision } = this.studioDocument();
      const madeHere = origin === 'link' && st.made.has(`${d.link.nodeId}@${d.link.revision}`);
      const r = resolveLabLink(d.link, { model, revision, madeHere, registry });
      if (!r.ok) return this.labRefuse(r.reason);
      st.pending = r;
      st.ret = r.nodeId;
      this.labFlush();
      return true;
    },

    labRefuse(reason) {
      st.pending = null;
      st.ret = null;
      this.labFrom = { kind: 'refused', text: reason, notice: '', back: BACK_HREF };
      this.notify('warning', 'Studio node not opened', reason);
      return false;
    },

    /** Apply a waiting resolution once Filter Lab is mounted (main.js, after mountLabs). */
    labFlush() {
      const r = st.pending;
      const lab = svc.lab ? svc.lab() : null;
      if (!r || !lab) return false;
      st.pending = null;
      lab.update({ ...r.values });
      const notes = [...(r.stale ? [staleNotice(r.linkRevision, r.revision)] : []),
        ...limitedNotices(r.values, lab.config)];
      const bypass = r.bypassed ? ' The node is bypassed in Studio.' : '';
      this.labFrom = { kind: 'from',
        text: `From Studio node ${r.name}. ${LAB_BRIDGE_SETPOINT_NOTE}${bypass}`,
        notice: notes.join(' '), back: BACK_HREF };
      return true;
    },

    /** The context line's "Back to Studio": a plain click returns with the node focused. */
    labBackToStudio(e) {
      if (e && (e.defaultPrevented || e.button > 0 || e.metaKey || e.ctrlKey || e.shiftKey
        || e.altKey)) return;
      if (e) e.preventDefault();
      st.returning = !!st.ret && this.workspace === LAB_LINK_MODE;
      this.setWorkspace('studio', { focusHeading: !st.ret });
    },

    /** Test seam (window.OSCILLA.app.labBridgeTestSeam()). */
    labBridgeTestSeam() {
      return { get returnTo() { return st.ret; }, get pending() { return !!st.pending; },
        get made() { return [...st.made]; } };
    },
  };
}
