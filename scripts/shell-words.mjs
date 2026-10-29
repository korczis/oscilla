// The commands of a shell text as bash reads them, for the rules that judge workflow steps
// (scripts/ci-workflow-rules.mjs `judge-first`, scripts/pr-metadata.mjs FORCED_SUCCESS). A
// rule that matched the text could be passed by quoting inside a word (`e\xit 0`, `n''pm ci`),
// by a wrapper or a shell keyword before the program (`time npm ci`, `if npm ci; then`) or by
// naming the program through a variable or a substitution (`$NPM ci`, `$(echo npm) ci`)
// (review of #255, R7 and R19). Here each word is what bash makes of it after quote removal,
// marked `dynamic` when an expansion decides it, and each command's program is the word after
// its assignments, redirections, keywords and wrappers. Commands inside `$( )`, backticks and
// `<( )` are commands too, listed before the one that holds them; heredoc bodies are data.
//
// A subset: no aliases, no `case` patterns, no arithmetic beyond marking it dynamic. What it
// cannot read it marks dynamic, so a rule that refuses a dynamic program refuses that too.

const OPERATORS = ['&&', '||', ';;', '|&', ';', '&', '|', '(', ')', '\n'];
const REDIRECT = /^(?:\d+|&)?(?:>>|>&|>\||>|<<<|<<-|<<|<>|<&|<)/;

/** The index just past the `close` that ends the group opened before `from` in `src`. */
function closing(src, from, open = '(', close = ')') {
  let depth = 1;
  let q = null;
  for (let k = from; k < src.length; k++) {
    const c = src[k];
    if (q) {
      if (c === '\\' && q === '"') k++;
      else if (c === q) q = null;
      continue;
    }
    if (c === '\\') k++;
    else if (c === '\'' || c === '"' || c === '`') q = c;
    else if (c === open) depth++;
    else if (c === close && --depth === 0) return k + 1;
  }
  return src.length;
}

const ESCAPES = { n: '\n', t: '\t', r: '\r', a: '\x07', b: '\b', e: '\x1b', f: '\f', v: '\v' };

/** `$'...'` content from `k` (just past the opening quote): [text, index past the quote]. */
function ansiC(src, k) {
  let s = '';
  while (k < src.length && src[k] !== '\'') {
    if (src[k] !== '\\') {
      s += src[k++];
      continue;
    }
    const m = /^\\(x[0-9A-Fa-f]{1,2}|u[0-9A-Fa-f]{1,4}|[0-7]{1,3}|[\s\S])/.exec(src.slice(k));
    const e = m[1];
    if (/^[xu]./.test(e)) s += String.fromCharCode(parseInt(e.slice(1), 16));
    else if (/^[0-7]/.test(e)) s += String.fromCharCode(parseInt(e, 8));
    else s += ESCAPES[e] ?? e;
    k += m[0].length;
  }
  return [s, k + 1];
}

/**
 * Words and separators of `text`: [{ type: 'word', text, raw, dynamic, redirect, inner } |
 * { type: 'op', text }], `inner` the commands of the substitutions in the word.
 */
function tokens(src) {
  const out = [];
  let w = null;
  const open = () => {
    if (!w) w = { type: 'word', text: '', raw: '', dynamic: false, redirect: false, inner: [] };
    return w;
  };
  const end = () => {
    if (w) out.push(w);
    w = null;
  };
  const sub = (from, to) => open().inner.push(...commandsOf(src.slice(from, to)));
  /** a `$` expansion at `k`: the word is dynamic; returns the index after it */
  const dollar = (k) => {
    const cur = open();
    if (src.startsWith('$((', k)) {
      const e = closing(src, k + 3);
      cur.raw += src.slice(k, e + 1);
      cur.dynamic = true;
      return e + 1;
    }
    if (src[k + 1] === '(') {
      const e = closing(src, k + 2);
      sub(k + 2, e - 1);
      cur.raw += src.slice(k, e);
      cur.dynamic = true;
      return e;
    }
    if (src[k + 1] === '{') {
      const e = closing(src, k + 2, '{', '}');
      cur.raw += src.slice(k, e);
      cur.dynamic = true;
      return e;
    }
    const m = /^\$(?:[A-Za-z_]\w*|\d|[@*#?$!-])/.exec(src.slice(k));
    if (m) {
      cur.raw += m[0];
      cur.dynamic = true;
      return k + m[0].length;
    }
    cur.text += '$';
    cur.raw += '$';
    return k + 1;
  };
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (!w && c === '#') {
      while (i < src.length && src[i] !== '\n') i++;
      continue;
    }
    if (c === ' ' || c === '\t' || c === '\r') {
      end();
      i++;
      continue;
    }
    const op = OPERATORS.find((o) => src.startsWith(o, i));
    if (op === '(' && w && /^[<>]$/.test(w.raw)) {
      // a process substitution <( ) or >( ): its commands run
      const e = closing(src, i + 1);
      sub(i + 1, e - 1);
      w.raw += src.slice(i, e);
      w.dynamic = true;
      w.redirect = false;
      i = e;
      continue;
    }
    if (op === '(' && w && /=$/.test(w.raw)) {
      // an array assignment a=( ... ): data
      const e = closing(src, i + 1);
      w.raw += src.slice(i, e);
      i = e;
      continue;
    }
    if (op) {
      end();
      out.push({ type: 'op', text: op });
      i += op.length;
      continue;
    }
    const redirect = !w || /^\d+$/.test(w.raw) ? REDIRECT.exec(src.slice(i)) : null;
    if (redirect && !(redirect[0] === '<' && src[i + 1] === '(')
      && !(redirect[0] === '>' && src[i + 1] === '(')) {
      const cur = open();
      cur.raw += redirect[0];
      cur.redirect = true;
      i += redirect[0].length;
      // a target written next to its operator (>file, 2>&1) belongs to it
      if (/&$/.test(redirect[0]) && /[\d-]/.test(src[i] ?? '')) {
        while (/[\d-]/.test(src[i] ?? '')) cur.raw += src[i++];
        cur.target = true;
      }
      end();
      continue;
    }
    if (c === '\\') {
      const cur = open();
      cur.raw += src.slice(i, i + 2);
      cur.text += src[i + 1] ?? '';
      i += 2;
      continue;
    }
    if (c === '\'') {
      const e = src.indexOf('\'', i + 1);
      const stop = e < 0 ? src.length : e;
      const cur = open();
      cur.raw += src.slice(i, stop + 1);
      cur.text += src.slice(i + 1, stop);
      i = stop + 1;
      continue;
    }
    if (c === '$' && src[i + 1] === '\'') {
      const [s, e] = ansiC(src, i + 2);
      const cur = open();
      cur.raw += src.slice(i, e);
      cur.text += s;
      i = e;
      continue;
    }
    if (c === '"') {
      const cur = open();
      cur.raw += '"';
      let k = i + 1;
      while (k < src.length && src[k] !== '"') {
        if (src[k] === '\\' && /["\\$`\n]/.test(src[k + 1] ?? '')) {
          cur.text += src[k + 1];
          cur.raw += src.slice(k, k + 2);
          k += 2;
        } else if (src[k] === '$') {
          k = dollar(k);
        } else if (src[k] === '`') {
          const e = src.indexOf('`', k + 1);
          const stop = e < 0 ? src.length : e;
          sub(k + 1, stop);
          cur.raw += src.slice(k, stop + 1);
          cur.dynamic = true;
          k = stop + 1;
        } else {
          cur.text += src[k];
          cur.raw += src[k];
          k++;
        }
      }
      cur.raw += '"';
      i = k + 1;
      continue;
    }
    if (c === '$') {
      i = dollar(i);
      continue;
    }
    if (c === '`') {
      const e = src.indexOf('`', i + 1);
      const stop = e < 0 ? src.length : e;
      sub(i + 1, stop);
      const cur = open();
      cur.raw += src.slice(i, stop + 1);
      cur.dynamic = true;
      i = stop + 1;
      continue;
    }
    const cur = open();
    cur.raw += c;
    cur.text += c;
    i++;
  }
  end();
  return out;
}

/**
 * `text` with line continuations joined and each heredoc's body (the lines after the line
 * that opens it, to its delimiter) blanked, so that its data is not read as commands.
 */
function withoutHeredocBodies(text) {
  const lines = String(text).replace(/\\\r?\n/g, '').split('\n');
  for (let k = 0; k < lines.length; k++) {
    const opener = /<<(-?)[ \t]*(?:'([^']*)'|"([^"]*)"|\\?([^\s;&|<>()]+))/g;
    const delims = [...lines[k].matchAll(opener)]
      .filter((m) => !lines[k].slice(0, m.index).endsWith('<'))
      .map((m) => ({ strip: m[1] === '-', word: m[2] ?? m[3] ?? m[4] }));
    for (const d of delims) {
      while (k + 1 < lines.length) {
        k++;
        const body = d.strip ? lines[k].replace(/^\t+/, '') : lines[k];
        lines[k] = '';
        if (body === d.word) break;
      }
    }
  }
  return lines.join('\n');
}

const KEYWORDS = new Set(['if', 'then', 'else', 'elif', 'fi', 'do', 'done', 'while', 'until',
  '!', '{', '}', 'coproc', '[[', ']]', 'esac']);
/** Wrappers (each runs the command after it): their options, and those that take a value. */
const WRAPPERS = {
  env: [new RegExp(String.raw`^-[iv0]+$|^--(?:ignore-environment|null|debug)$|^-[uCS]$`
    + String.raw`|^--(?:unset|chdir|split-string)(?:=.*)?$`), /^(?:-[uC]|--unset|--chdir)$/],
  sudo: [/^-\S*$/, /^-[ugChpUDRrtT]$/],
  doas: [/^-\S*$/, /^-[uC]$/],
  command: [/^-p$/, null],
  builtin: [null, null],
  exec: [/^-[cl]+$|^-a$/, /^-a$/],
  nice: [/^-n$|^-\d+$|^--adjustment(?:=.*)?$/, /^(?:-n|--adjustment)$/],
  nohup: [null, null],
  // the keyword `time` and /usr/bin/time: -p (and GNU time's options)
  time: [/^-\S*$/, /^-[fo]$/],
  setsid: [/^-\S*$/, null],
  stdbuf: [/^-[ioe]\S*$|^--(?:input|output|error)(?:=.*)?$/, /^-[ioe]$/],
  timeout: [/^-\S*$/, /^-[sk]$/],
  xargs: [/^-\S*$/, /^-[IdEsnPLa]$/],
  chronic: [null, null],
  unbuffer: [null, null],
  ionice: [/^-\S*$/, /^-[cnt]$/],
  taskset: [/^-\S*$/, null],
  flock: [/^-\S*$/, null],
  watch: [/^-\S*$/, /^-[ndg]$/],
};

const basename = (s) => s.slice(s.lastIndexOf('/') + 1);
const lineOf = (words) => words.map((x) => x.raw).join(' ');
const ASSIGNMENT = /^[A-Za-z_]\w*(?:\[[^\]]*\])?\+?=/;

/** One simple command of `all` words: its program word (or null) and its arguments. */
function command(all) {
  const words = all.filter((x) => !x.redirect);
  const wrappers = [];
  const result = (program, args = []) => ({ words: all, program, args, wrappers,
    line: lineOf(all) });
  let k = 0;
  for (;;) {
    const w = words[k];
    if (!w) return result(null);
    // `function f { ...; }` and `coproc NAME { ...; }`: the name is no program, the body's
    // first command is one (a one-line function hid `exit 0`, review of #255, R7)
    if (!w.dynamic && (w.text === 'function'
      || (w.text === 'coproc' && words[k + 2] && words[k + 2].text === '{'))) {
      k += 2;
      continue;
    }
    if (ASSIGNMENT.test(w.raw) || (!w.dynamic && KEYWORDS.has(w.text))) {
      k++;
      continue;
    }
    if (!w.dynamic && ['for', 'select', 'case'].includes(w.text)) return result(null);
    const name = w.dynamic ? null : basename(w.text);
    if (!name || !Object.hasOwn(WRAPPERS, name)) return result(w, words.slice(k + 1));
    wrappers.push(name);
    const [opts, takes] = WRAPPERS[name];
    k++;
    // `command -v x` names a program, it does not run it
    if (name === 'command' && words[k] && /^-[vV]+$/.test(words[k].text)) return result(null);
    while (words[k] && !words[k].dynamic && opts && opts.test(words[k].text)
      && words[k].text !== '--') {
      const opt = words[k].text;
      // env -S splits a string into a command: no word names its program
      if (name === 'env' && /^-S$|^--split-string/.test(opt)) {
        return result({ text: '', raw: opt, dynamic: true });
      }
      k += takes && takes.test(opt) ? 2 : 1;
    }
    if (words[k] && words[k].text === '--') k++;
    if (name === 'timeout' && words[k] && !ASSIGNMENT.test(words[k].raw)) k++; // its duration
  }
}

/**
 * The commands of a shell text, in the order they run: [{ words, program, args, wrappers,
 * line }], `wrappers` the names of the wrappers before the program.
 * `program` is the word that names what runs: after the assignments, redirections, shell
 * keywords and wrappers (env, sudo, command, exec, time, nice, nohup, timeout, xargs, ...);
 * null for a command that only assigns, a lookup (`command -v x`) or a loop's head. Each word
 * is { text: after quote removal, raw: as written, dynamic: decided by an expansion }. A
 * command inside a substitution is listed before the command that holds it.
 */
export function commandsOf(text) {
  const result = [];
  const toks = tokens(withoutHeredocBodies(text));
  let words = [];
  const flush = () => {
    for (const w of words) result.push(...w.inner);
    if (words.length) result.push(command(words));
    words = [];
  };
  for (let k = 0; k < toks.length; k++) {
    const t = toks[k];
    if (t.type === 'op') {
      flush();
    } else if (t.redirect) {
      words.push(t);
      // the redirection's target is the next word, unless written into it (2>&1)
      if (!t.target && toks[k + 1] && toks[k + 1].type === 'word') {
        words.push({ ...toks[k + 1], redirect: true });
        k++;
      }
    } else {
      words.push(t);
    }
  }
  flush();
  return result;
}
