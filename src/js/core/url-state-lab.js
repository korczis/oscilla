// The lab link (plan U006, P08 of the owner's pack): a Studio filter node opened in Filter Lab,
// `#m=filter&from=studio&node=<node id>&rev=<Studio revision>`. Its own keys, like the other
// hash domains (ui/navigation.js): no other codec reads `from`, `node` or `rev`, and they leave
// the address with Filter Lab, as the Studio keys leave with Studio.
//   from  where the link was made: 'studio' (the one source there is)
//   node  the Studio node id
//   rev   the Studio store revision the link was made at: a staleness hint only. The revision
//         is in memory and per page (studio/actions.js, §178), so it never makes a link valid
//         or invalid; ui/studio/lab-bridge.js compares it only for a link this page made.
// Strict, like the Studio and Synth links: a repeated key, another source, another workspace or
// a node id that cannot be one refuses the whole link with a sentence. A `rev` that is not a
// revision is no hint (null), never a refusal.
//
//   decodeLabLink(hash) -> { ok: true, link: { from, nodeId, revision } } | { ok: false, reason }
//                          | null (no lab key)
//   encodeLabLink({ nodeId, revision }) -> 'm=filter&from=studio&node=...&rev=...'
//   withoutLabParams(hash) -> hash

import { ID_PATTERN } from '../experiments/schema.js';

export const LAB_LINK_MODE = 'filter';
export const LAB_LINK_SOURCE = 'studio';
export const LAB_LINK_KEYS = Object.freeze({ from: 'from', node: 'node', rev: 'rev' });

const strip = (h) => String(h || '').replace(/^#/, '');
const shown = (v) => `"${v.length > 32 ? `${v.slice(0, 32)}…` : v}"`;

export function encodeLabLink({ nodeId, revision = null }) {
  const q = new URLSearchParams();
  q.set('m', LAB_LINK_MODE);
  q.set(LAB_LINK_KEYS.from, LAB_LINK_SOURCE);
  q.set(LAB_LINK_KEYS.node, nodeId);
  if (Number.isInteger(revision) && revision >= 0) q.set(LAB_LINK_KEYS.rev, String(revision));
  return q.toString();
}

export function withoutLabParams(hash) {
  const q = new URLSearchParams(strip(hash));
  for (const k of Object.values(LAB_LINK_KEYS)) q.delete(k);
  return q.toString();
}

/** null when the hash has no lab key; else the checked link or the refusal. */
export function decodeLabLink(hash) {
  let q;
  try { q = new URLSearchParams(strip(hash)); } catch (e) { return null; }
  const K = LAB_LINK_KEYS;
  if (!Object.values(K).some((k) => q.has(k))) return null;
  const no = (reason) => ({ ok: false, reason: `Studio node link refused: ${reason}` });
  for (const k of Object.values(K)) if (q.getAll(k).length > 1) return no(`${k} appears twice.`);
  const modes = [...new Set(q.getAll('m'))];
  if (modes.length !== 1 || modes[0] !== LAB_LINK_MODE) {
    return no('a Studio node opens in Filter Lab only (m=filter).');
  }
  const from = q.get(K.from);
  if (from !== LAB_LINK_SOURCE) {
    return no(from === null ? 'the link does not say where it was made (from=studio).'
      : `there is no source ${shown(from)}; only a Studio node opens here.`);
  }
  const nodeId = q.get(K.node);
  if (!nodeId) return no('the link names no node.');
  if (!ID_PATTERN.test(nodeId)) return no(`${shown(nodeId)} is not a node id.`);
  const raw = q.get(K.rev);
  const revision = raw !== null && /^(0|[1-9][0-9]{0,14})$/.test(raw) ? Number(raw) : null;
  return { ok: true, link: { from, nodeId, revision } };
}
