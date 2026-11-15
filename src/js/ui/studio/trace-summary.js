// The Studio Inspector's Trace texts (ADR 0042; the live visual audit of 2026-11-11, finding 6,
// and oscilla-c3's amendment): the section is a closed disclosure whose summary names how many
// operations it holds, and an operation's summary joins only the fields it has, so an absent
// outcome is left out instead of reading "null".
//
//   opSummary(op) -> 'op-1 · Change Oscillator 1 Detune · committed, revision 4'
//   traceCount(view) -> 'Operace (3)'

export function opSummary(op) {
  return [op && op.op, op && op.title, op && op.outcome]
    .filter((v) => v !== null && v !== undefined && v !== '').join(' · ');
}

export function traceCount(view) {
  return `Operace (${(view && view.total) || 0})`;
}
