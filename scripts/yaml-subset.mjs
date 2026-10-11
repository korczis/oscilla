// A strict reader for the YAML this repository's tooling has to read without a dependency:
// GitHub workflow files and review verdicts (package.json is a build input of dist/index.html,
// so a parser dependency would restamp the artifact for a CI check).
//
// Supported: block mappings and sequences (also `- key: value` items and a sequence at its
// key's indentation), one-line flow sequences and mappings, literal and folded block scalars
// with the `-` and `+` chomping indicators, single- and double-quoted scalars, plain scalars
// (integers, decimals, true, false, null, strings), comments, one leading `---`.
//
// Everything else THROWS rather than being guessed at: anchors, aliases, tags, merge keys,
// multi-line plain or flow values, block-scalar indentation indicators, tabs in indentation,
// duplicate keys, several documents. A caller that gets a value got what YAML 1.2 means by
// the text; tests/unit/yaml-subset.test.mjs pins that on the constructs above.

class YamlError extends Error {
  constructor(message, line) {
    super(`line ${line}: ${message}`);
    this.name = 'YamlError';
    this.line = line;
  }
}

const BLOCK_HEADER = /^([|>])([+-]?)(?:\s+#.*)?$/;

function plain(text, line) {
  if (['', '~', 'null', 'Null', 'NULL'].includes(text)) return null;
  if (text === 'true' || text === 'True' || text === 'TRUE') return true;
  if (text === 'false' || text === 'False' || text === 'FALSE') return false;
  // the YAML 1.2 core schema's numbers
  if (/^[-+]?\d+$/.test(text)) return Number(text);
  if (/^0x[0-9a-fA-F]+$/.test(text)) return Number(text);
  if (/^0o[0-7]+$/.test(text)) return parseInt(text.slice(2), 8);
  if (/^[-+]?(\.\d+|\d+(\.\d*)?)([eE][-+]?\d+)?$/.test(text)) return Number(text);
  if (/^[-+]?\.(inf|Inf|INF)$/.test(text)) return text[0] === '-' ? -Infinity : Infinity;
  if (/^\.(nan|NaN|NAN)$/.test(text)) return NaN;
  if (/^[&*!%@`|>]/.test(text) || text.startsWith('<<')) {
    throw new YamlError(`unsupported YAML (anchor, alias, tag or indicator): ${text}`, line);
  }
  return text;
}

/** A quoted scalar starting at s[pos]; returns [value, position after the closing quote]. */
function quoted(s, pos, line) {
  const q = s[pos];
  let i = pos + 1;
  if (q === "'") {
    let out = '';
    for (; i < s.length; i += 1) {
      if (s[i] === "'") {
        if (s[i + 1] === "'") { out += "'"; i += 1; } else return [out, i + 1];
      } else out += s[i];
    }
    throw new YamlError('unterminated single-quoted scalar', line);
  }
  for (; i < s.length; i += 1) {
    if (s[i] === '\\') i += 1;
    else if (s[i] === '"') {
      try {
        return [JSON.parse(s.slice(pos, i + 1)), i + 1];
      } catch {
        throw new YamlError(`unsupported escape in ${s.slice(pos, i + 1)}`, line);
      }
    }
  }
  throw new YamlError('unterminated double-quoted scalar', line);
}

/** A flow value ([..], {..}, quoted or plain) at s[pos]; returns [value, next position]. */
function flow(s, pos, line, stops) {
  let i = pos;
  while (s[i] === ' ') i += 1;
  if (s[i] === '[') {
    const out = [];
    i += 1;
    for (;;) {
      while (s[i] === ' ') i += 1;
      if (i >= s.length) throw new YamlError('a flow sequence must close on its line', line);
      if (s[i] === ']') return [out, i + 1];
      const [v, next] = flow(s, i, line, ',]');
      out.push(v);
      i = next;
      while (s[i] === ' ') i += 1;
      if (s[i] === ',') i += 1;
      else if (s[i] !== ']') throw new YamlError('expected , or ] in a flow sequence', line);
    }
  }
  if (s[i] === '{') {
    const out = {};
    i += 1;
    for (;;) {
      while (s[i] === ' ') i += 1;
      if (i >= s.length) throw new YamlError('a flow mapping must close on its line', line);
      if (s[i] === '}') return [out, i + 1];
      let key;
      if (s[i] === '"' || s[i] === "'") [key, i] = quoted(s, i, line);
      else {
        const start = i;
        while (i < s.length && !(s[i] === ':' && (s[i + 1] === ' ' || i + 1 === s.length))
          && s[i] !== ',' && s[i] !== '}') i += 1;
        key = s.slice(start, i).trim();
      }
      while (s[i] === ' ') i += 1;
      if (s[i] !== ':') throw new YamlError('expected `key: value` in a flow mapping', line);
      const [v, next] = flow(s, i + 1, line, ',}');
      if (Object.hasOwn(out, key)) throw new YamlError(`duplicate key ${key}`, line);
      out[String(key)] = v;
      i = next;
      while (s[i] === ' ') i += 1;
      if (s[i] === ',') i += 1;
      else if (s[i] !== '}') throw new YamlError('expected , or } in a flow mapping', line);
    }
  }
  if (s[i] === '"' || s[i] === "'") return quoted(s, i, line);
  const start = i;
  while (i < s.length && !stops.includes(s[i])) i += 1;
  return [plain(s.slice(start, i).trim(), line), i];
}

/** The value written after `key:` or `- ` on one line. */
function inline(text, line) {
  const s = text.trim();
  if (s[0] === '[' || s[0] === '{' || s[0] === '"' || s[0] === "'") {
    const [v, next] = s[0] === '[' || s[0] === '{' ? flow(s, 0, line, '') : quoted(s, 0, line);
    const rest = s.slice(next).trim();
    if (rest && !rest.startsWith('#')) {
      throw new YamlError(`unexpected text after a value: ${rest}`, line);
    }
    if (rest && s[next] !== ' ') throw new YamlError('a comment needs a space before #', line);
    return v;
  }
  const hash = s.search(/\s#/);
  const value = (hash < 0 ? s : s.slice(0, hash)).trim();
  if (/:(\s|$)/.test(value)) {
    throw new YamlError(`a plain value cannot contain ": " (quote it): ${value}`, line);
  }
  return plain(value, line);
}

/**
 * Where a mapping key ends in `text`: the index of its `:`; -1 when the text is no entry.
 */
function keyEnd(text, line) {
  if (text[0] === '"' || text[0] === "'") {
    const [, next] = quoted(text, 0, line);
    return text[next] === ':' && (text[next + 1] === ' ' || next + 1 === text.length) ? next : -1;
  }
  if (text[0] === '[' || text[0] === '{') return -1;
  const m = /:(\s|$)/.exec(text);
  if (!m) return -1;
  const hash = text.search(/\s#/);
  return hash >= 0 && hash < m.index ? -1 : m.index;
}

export function parseYaml(source) {
  const lines = String(source).replace(/\r\n?/g, '\n').split('\n');
  let i = 0;

  const indentOf = (raw, n) => {
    const m = /^[ \t]*/.exec(raw)[0];
    if (m.includes('\t')) throw new YamlError('a tab in indentation', n);
    return m.length;
  };
  /** The next line that is not blank or a comment, without consuming it. */
  const peek = () => {
    for (; i < lines.length; i += 1) {
      const raw = lines[i];
      const t = raw.trim();
      if (t === '' || t.startsWith('#')) continue;
      const indent = indentOf(raw, i + 1);
      return { indent, text: raw.trimEnd().slice(indent), n: i + 1 };
    }
    return null;
  };
  const isItem = (text) => text === '-' || text.startsWith('- ');

  function blockScalar(parentIndent, header) {
    const [, style, chomp] = BLOCK_HEADER.exec(header);
    const body = [];
    let blockIndent = null;
    for (; i < lines.length; i += 1) {
      const raw = lines[i];
      if (raw.trim() === '') {
        // a whitespace-only line keeps what it has beyond the block's indentation (literal)
        const keep = style === '|' && blockIndent !== null && raw.length > blockIndent;
        body.push(keep ? raw.slice(blockIndent) : '');
        continue;
      }
      const ind = indentOf(raw, i + 1);
      if (ind <= parentIndent) break;
      if (blockIndent === null) blockIndent = ind;
      if (ind < blockIndent) {
        throw new YamlError('a block scalar line indented less than its first', i + 1);
      }
      body.push(raw.slice(blockIndent));
    }
    let trailing = 0;
    while (body.length && body[body.length - 1] === '') { body.pop(); trailing += 1; }
    if (blockIndent === null) return chomp === '+' ? '\n'.repeat(trailing) : '';
    let text;
    if (style === '|') text = body.join('\n');
    else {
      text = body[0];
      let blanks = 0;
      for (let k = 1; k < body.length; k += 1) {
        const cur = body[k];
        if (cur === '') { blanks += 1; continue; }
        const prev = body[k - 1 - blanks];
        const indented = /^\s/.test(cur) || /^\s/.test(prev);
        if (blanks) text += '\n'.repeat(blanks + (indented ? 1 : 0)) + cur;
        else text += (indented ? '\n' : ' ') + cur;
        blanks = 0;
      }
    }
    if (chomp === '-') return text;
    if (chomp === '+') {
      // the split's last element is the empty text after the file's final newline, not a line
      const kept = Math.max(0, trailing - (i < lines.length ? 0 : 1));
      return `${text}\n${'\n'.repeat(kept)}`;
    }
    return `${text}\n`;
  }

  /** The value of an entry whose own text after `key:` / `- ` is `rest`. */
  function valueOf(rest, indent, n, allowSameIndentSeq) {
    if (rest === '' || rest.startsWith('#')) {
      const next = peek();
      if (next && next.indent > indent) return block(next.indent);
      if (allowSameIndentSeq && next && next.indent === indent && isItem(next.text)) {
        return sequence(indent);
      }
      return null;
    }
    if (BLOCK_HEADER.test(rest)) return blockScalar(indent, rest);
    if (/^[|>]/.test(rest)) throw new YamlError(`unsupported block scalar header ${rest}`, n);
    if (isItem(rest)) throw new YamlError('a sequence written inside a sequence item', n);
    const v = inline(rest, n);
    const next = peek();
    if (next && next.indent > indent) {
      throw new YamlError('a value continued on the next line; use a block scalar', next.n);
    }
    return v;
  }

  function mapping(indent) {
    const out = {};
    for (;;) {
      const l = peek();
      if (!l || l.indent < indent) return out;
      if (l.indent > indent) throw new YamlError('unexpected indentation', l.n);
      if (isItem(l.text)) {
        throw new YamlError('a sequence item where a mapping key was expected', l.n);
      }
      if (l.indent === 0 && /^(---|\.\.\.)(\s|$)/.test(l.text)) {
        throw new YamlError('several documents in one file', l.n);
      }
      const end = keyEnd(l.text, l.n);
      if (end < 0) throw new YamlError(`expected \`key: value\`: ${l.text}`, l.n);
      const rawKey = l.text.slice(0, end).trim();
      const key = rawKey[0] === '"' || rawKey[0] === "'" ? quoted(rawKey, 0, l.n)[0] : rawKey;
      if (/^[&*!?]/.test(rawKey) || rawKey === '<<') {
        throw new YamlError(`unsupported key ${rawKey}`, l.n);
      }
      if (Object.hasOwn(out, key)) throw new YamlError(`duplicate key ${key}`, l.n);
      i += 1;
      out[key] = valueOf(l.text.slice(end + 1).trim(), indent, l.n, true);
    }
  }

  function sequence(indent) {
    const out = [];
    for (;;) {
      const l = peek();
      if (!l || l.indent < indent || (l.indent === indent && !isItem(l.text))) return out;
      if (l.indent > indent) throw new YamlError('unexpected indentation', l.n);
      const rest = l.text.slice(1).trimStart();
      const itemIndent = indent + (l.text.length - rest.length);
      if (rest !== '' && !rest.startsWith('#') && !BLOCK_HEADER.test(rest)
        && keyEnd(rest, l.n) >= 0) {
        // `- key: value`: the item is a mapping whose first key sits after the dash
        lines[i] = ' '.repeat(itemIndent) + rest;
        out.push(mapping(itemIndent));
      } else {
        i += 1;
        out.push(valueOf(rest, indent, l.n, false));
      }
    }
  }

  function block(indent) {
    const l = peek();
    return isItem(l.text) ? sequence(indent) : mapping(indent);
  }

  let first = peek();
  if (first && first.text === '---' && first.indent === 0) {
    i += 1;
    first = peek();
  }
  if (!first) return null;
  if (/^(---|\.\.\.)(\s|$)/.test(first.text)) {
    throw new YamlError('unexpected document marker', first.n);
  }
  const value = block(first.indent);
  const rest = peek();
  if (rest) {
    throw new YamlError(/^(---|\.\.\.)(\s|$)/.test(rest.text)
      ? 'several documents in one file' : `unexpected content: ${rest.text}`, rest.n);
  }
  return value;
}
