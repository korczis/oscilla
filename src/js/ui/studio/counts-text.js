// The Studio's counts as Czech text (U114, Q104): one place for the nouns and their plural
// forms, read by the compact Studio's line and the Inspector's Studio header alike.

/** `n` with the Czech form of its noun: 1 one, 2-4 few, otherwise many (0 too). */
const cz = (n, one, few, many) => `${n} ${n === 1 ? one : n >= 2 && n <= 4 ? few : many}`;

/** "3 uzly · 2 spojení": the graph's nodes and connections. */
export const graphCountsText = (nodes, edges) =>
  `${cz(nodes, 'uzel', 'uzly', 'uzlů')} · ${edges} spojení`;

/** "1 klip", "2 klipy", "5 klipů". */
export const clipsText = (n) => cz(n, 'klip', 'klipy', 'klipů');

/** "1 automatizační stopa", "2 automatizační stopy", "5 automatizačních stop". */
export const lanesText = (n) => cz(n, 'automatizační stopa', 'automatizační stopy',
  'automatizačních stop');
