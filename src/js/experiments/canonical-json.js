// Canonical JSON (spec §100): one byte-exact serialization of a plain value, so a hash over it
// does not depend on key order or formatting. Pure; no DOM, no globals.
//
//   canonicalJson(value) -> string
//
// Rules: object keys sorted by UTF-16 code unit order (Array.prototype.sort default), no
// whitespace, numbers in ECMAScript shortest round-trip form (JSON.stringify), -0 written as 0,
// properties whose value is undefined omitted (as JSON.stringify does), typed arrays written as
// plain number arrays. NaN, Infinity, functions, symbols, BigInt, undefined array elements and
// cycles are errors (TypeError), never silently coerced to null.

const MAX_DEPTH = 64;

/** The canonical JSON text of `value`. Throws TypeError for values JSON cannot represent. */
export function canonicalJson(value) {
  return write(value, '$', 0, new Set());
}

function write(v, path, depth, seen) {
  if (depth > MAX_DEPTH) throw new TypeError(`canonicalJson: nesting deeper than ${MAX_DEPTH}`);
  if (v === null) return 'null';
  switch (typeof v) {
    case 'boolean': return v ? 'true' : 'false';
    case 'string': return JSON.stringify(v);
    case 'number':
      if (!Number.isFinite(v)) throw new TypeError(`canonicalJson: non-finite number at ${path}`);
      return Object.is(v, -0) ? '0' : JSON.stringify(v);
    case 'object': break;
    default: throw new TypeError(`canonicalJson: ${typeof v} at ${path} is not JSON`);
  }
  if (seen.has(v)) throw new TypeError(`canonicalJson: cycle at ${path}`);
  seen.add(v);
  let out;
  if (ArrayBuffer.isView(v) && !(v instanceof DataView)) {
    const parts = [];
    for (let i = 0; i < v.length; i++) {
      parts.push(write(Number(v[i]), `${path}[${i}]`, depth, seen));
    }
    out = `[${parts.join(',')}]`;
  } else if (Array.isArray(v)) {
    const parts = [];
    for (let i = 0; i < v.length; i++) {
      if (v[i] === undefined) throw new TypeError(`canonicalJson: undefined at ${path}[${i}]`);
      parts.push(write(v[i], `${path}[${i}]`, depth + 1, seen));
    }
    out = `[${parts.join(',')}]`;
  } else {
    const parts = [];
    for (const k of Object.keys(v).sort()) {
      if (v[k] === undefined) continue;
      parts.push(`${JSON.stringify(k)}:${write(v[k], `${path}.${k}`, depth + 1, seen)}`);
    }
    out = `{${parts.join(',')}}`;
  }
  seen.delete(v);
  return out;
}
