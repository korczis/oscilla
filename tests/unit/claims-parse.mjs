// Reader for docs/CLAIMS.yaml, shared by the unit tests that check the claims ledger. Not a
// test file (no .test.mjs suffix), so `node --test` does not run it; it sits next to
// sequencer-fake-audio.mjs for the same reason.
//
// The ledger is line-oriented by convention: under `claims:` each record starts with
// `  - id: <kebab-id>` and every field is one `    key: value` line. This reader relies on
// exactly that and nothing more of YAML.

/** A YAML scalar without its surrounding quotes. */
export const unquote = (v) => {
  const t = v.trim();
  if (t.startsWith("'") && t.endsWith("'")) return t.slice(1, -1).replace(/''/g, "'");
  if (t.startsWith('"') && t.endsWith('"')) return t.slice(1, -1);
  return t;
};

/** The text of docs/CLAIMS.yaml as [{ id, claim, source, implementation, test, status, ... }]. */
export function parseClaims(text) {
  const out = [];
  let cur = null;
  for (const line of text.slice(text.indexOf('\nclaims:\n')).split('\n')) {
    const start = line.match(/^ {2}- id:\s*(\S+)/);
    if (start) { cur = { id: start[1] }; out.push(cur); continue; }
    const kv = cur && line.match(/^ {4}([a-z_]+):\s*(.*)$/);
    if (kv) cur[kv[1]] = unquote(kv[2]);
  }
  return out;
}

/** An algorithm id as prose writes it: oscilla.<family>[.<variant>].v<integer>. */
const ALGORITHM_ID = /\boscilla\.[a-z0-9-]+(?:\.[a-z0-9-]+)*\.v[1-9][0-9]*\b/g;

/**
 * staleAlgorithmIds(records, { isCurrent, isKnown }) → string[]
 * One problem per algorithm id in a claim record's prose that the code does not back: an id
 * this build does not implement, or a superseded id on a line that does not say it is
 * retained. A field is one line of the ledger, so "the same line" is the same field.
 */
export function staleAlgorithmIds(records, { isCurrent, isKnown }) {
  const problems = [];
  for (const rec of records) {
    for (const [key, value] of Object.entries(rec)) {
      if (typeof value !== 'string') continue;
      for (const [id] of value.matchAll(ALGORITHM_ID)) {
        if (!isKnown(id)) problems.push(`${rec.id}.${key}: ${id} is not an id this build knows`);
        else if (!isCurrent(id) && !/\bretained\b/.test(value))
          problems.push(`${rec.id}.${key}: ${id} is superseded and the line does not say `
            + 'it is retained');
      }
    }
  }
  return problems;
}
