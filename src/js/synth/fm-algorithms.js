// The FM engine's algorithm table (plan K090): data only. An algorithm is a routing of 2 to 4
// sine operators as a directed acyclic graph: [modulator, target] edges, operators numbered
// from 1, and the carriers whose sum is the voice. A modulator drives a carrier's frequency
// linearly: Δf = I · f_mod Hz, where I is the modulator's index and f_mod its frequency, so the
// sidebands of a sine pair sit at f_c ± k · f_mod with levels |J_k(I)|. A modulator into a
// modulator adds I · sin θ_mod to its phase instead (the same peak deviation and line levels),
// which keeps a stack free of a 0 Hz line (studio/adapters/engines.js, review of #332).
//
// Operator feedback (an operator modulating itself, a one-sample recurrence) is not offered:
// it is a cycle in the audio graph, which project.no-silent-feedback v1 refuses, and a
// one-sample loop needs an AudioWorklet (Q022, K094). FM_FEEDBACK_BLOCKED says so on the face.

export const FM_OPERATORS = 4;
export const FM_FEEDBACK_BLOCKED = 'Operator feedback is not offered: it is a loop in the audio '
  + 'graph, which project.no-silent-feedback v1 refuses, and a one-sample loop needs an '
  + 'AudioWorklet (owner question Q022, plan K094).';

export const FM_ALGORITHMS = Object.freeze([
  { id: '2-op', label: '2 → 1', ops: 2, edges: [[2, 1]], carriers: [1] },
  { id: '3-stack', label: '3 → 2 → 1', ops: 3, edges: [[3, 2], [2, 1]], carriers: [1] },
  { id: '3-y', label: '2 + 3 → 1', ops: 3, edges: [[2, 1], [3, 1]], carriers: [1] },
  { id: '4-stack', label: '4 → 3 → 2 → 1', ops: 4, edges: [[4, 3], [3, 2], [2, 1]],
    carriers: [1] },
  { id: '4-pairs', label: '2 → 1, 4 → 3', ops: 4, edges: [[2, 1], [4, 3]], carriers: [1, 3] },
  { id: '4-three', label: '2 + 3 + 4 → 1', ops: 4, edges: [[2, 1], [3, 1], [4, 1]],
    carriers: [1] },
  { id: '4-parallel', label: '1 + 2 + 3 + 4', ops: 4, edges: [], carriers: [1, 2, 3, 4] },
].map((a) => Object.freeze({ ...a, edges: Object.freeze(a.edges.map((e) => Object.freeze(e))),
  carriers: Object.freeze(a.carriers) })));

export const fmAlgorithm = (id) => FM_ALGORITHMS.find((a) => a.id === id) || FM_ALGORITHMS[0];

/** The role of operator `k` (1-based) in algorithm `id`: 'carrier' | 'modulator' | 'unused'. */
export function operatorRole(id, k) {
  const a = fmAlgorithm(id);
  if (k > a.ops) return 'unused';
  return a.carriers.includes(k) ? 'carrier' : 'modulator';
}

/** Operators in an order where every modulator comes before the operator it drives. */
export function operatorOrder(id) {
  const a = fmAlgorithm(id);
  const out = [];
  const seen = new Set();
  const visit = (k, depth) => {
    if (seen.has(k) || depth > a.ops) return;
    for (const [m, t] of a.edges) if (t === k) visit(m, depth + 1);
    seen.add(k);
    out.push(k);
  };
  for (let k = 1; k <= a.ops; k++) visit(k, 0);
  return out;
}
