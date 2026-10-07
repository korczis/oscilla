// Static scan behind rule project.bounded-test-timing: the waits and windows in a browser
// suite that measure the host instead of OSCILLA. tests/unit/browser-timing.test.mjs runs it
// over tests/browser; it is a module so the same scan can be pointed at one text.
//
//   const { scan } = require('./timing-scan.cjs');
//   scan(sourceText, { file: 'tests/browser/dsp.cjs' })  ->  [{ file, line, kind, message }]
//
// A finding is silenced only by `// timing-allow: <reason>` on its line, or on a line directly
// above that holds nothing but that comment. The reason is required: at least three words.
'use strict';

const RULE = 'project.bounded-test-timing';

const KINDS = Object.freeze({
  'fixed-sleep': 'a fixed sleep stands in for a product condition; poll the condition with '
    + 'until() from lib/wait.cjs',
  'timer-sleep': 'a setTimeout sleep that is not the period of a wall-clock-bounded poll; poll '
    + 'the condition with until() from lib/wait.cjs',
  'counted-poll': 'a poll bounded by a count of sleeps, not by wall time; use until() or a '
    + 'Date.now() deadline',
  'unbounded-loop': 'a waiting loop whose own condition or exit guard reads no Date.now() or '
    + 'performance.now() deadline',
  'unbounded-wait': 'no explicit, non-zero `timeout` in the options argument',
  'raw-playwright': 'playwright required directly, so page.evaluate is unbounded; take it from '
    + 'lib/suite.cjs (run.playwright)',
  'fixed-frame-window': 'a window bounded by an integer literal of 64 or more; if it counts '
    + "audio frames derive it from the context's sampleRate (frames() or anchor() in "
    + 'lib/wait.cjs); if it counts text, bins or pixels mark it timing-allow and say which',
  'fixed-rate': 'a 44100/48000 literal outside an OfflineAudioContext or WAV render rate; '
    + "read the context's sampleRate",
  'empty-allow': 'timing-allow without a reason of at least three words',
});

const MARKER = /timing-allow:[ \t]*(.*)/;
// A reason says what the wait is: at least three words. Whether it is a good reason is a
// reviewer's call; the unit test prints every marker so a new one is seen.
const reasoned = (reason) => reason.split(/\s+/).filter((w) => /[A-Za-z]{2,}/.test(w)).length >= 3;
const WALL_CLOCK = /\bDate\s*\.\s*now\s*\(|\bperformance\s*\.\s*now\s*\(/;
const REGEX_AFTER = new Set(['(', ',', '=', ':', '[', '!', '&', '|', '?', '{', '}', ';', '+',
  '-', '*', '%', '<', '>', '~', '^', '']);
const REGEX_AFTER_WORD = /(?:^|[^\w$.])(?:return|typeof|case|do|else|in|of|void|yield|await)$/;

// The source with comment text and string contents blanked (lengths and line breaks kept), so
// patterns match code only; the comments are returned per line for the allow marker.
function mask(source) {
  const out = source.split('');
  const comments = new Map();
  const n = source.length;
  let line = 1;
  const blank = (i) => { if (out[i] !== '\n') out[i] = ' '; };
  const note = (ln, text) => comments.set(ln, `${comments.get(ln) || ''}${text}`);
  // Each entry of the stack is the brace depth at which a template's `${` was opened.
  const templates = [];
  let depth = 0;
  let i = 0;
  const lastCode = () => {
    let j = i - 1;
    while (j >= 0 && /\s/.test(out[j])) j -= 1;
    return j;
  };
  const readTemplate = () => {
    // at the character after the opening backtick or after the `}` that closed `${ }`
    while (i < n) {
      const c = source[i];
      if (c === '\\') { blank(i); blank(i + 1); i += 2; continue; }
      if (c === '`') { i += 1; return; }
      if (c === '$' && source[i + 1] === '{') {
        templates.push(depth);
        depth += 1;
        i += 2;
        return;
      }
      if (c === '\n') line += 1;
      blank(i);
      i += 1;
    }
  };
  while (i < n) {
    const c = source[i];
    const d = source[i + 1];
    if (c === '\n') { line += 1; i += 1; continue; }
    if (c === '/' && d === '/') {
      const start = i;
      while (i < n && source[i] !== '\n') { blank(i); i += 1; }
      note(line, source.slice(start, i));
      continue;
    }
    if (c === '/' && d === '*') {
      const start = i;
      let ln = line;
      let segment = start;
      while (i < n && !(source[i] === '*' && source[i + 1] === '/')) {
        if (source[i] === '\n') {
          note(ln, source.slice(segment, i));
          ln += 1;
          segment = i + 1;
        }
        blank(i);
        i += 1;
      }
      blank(i); blank(i + 1);
      i = Math.min(n, i + 2);
      note(ln, source.slice(segment, i));
      line = ln;
      continue;
    }
    if (c === '\'' || c === '"') {
      i += 1;
      while (i < n && source[i] !== c && source[i] !== '\n') {
        if (source[i] === '\\') { blank(i); i += 1; }
        blank(i);
        i += 1;
      }
      i += 1;
      continue;
    }
    if (c === '`') { i += 1; readTemplate(); continue; }
    if (c === '{') { depth += 1; i += 1; continue; }
    if (c === '}') {
      depth -= 1;
      i += 1;
      if (templates.length && templates[templates.length - 1] === depth) {
        templates.pop();
        readTemplate();
      }
      continue;
    }
    if (c === '/') {
      const j = lastCode();
      const prev = j < 0 ? '' : out[j];
      const before = out.slice(Math.max(0, j - 12), j + 1).join('');
      if (REGEX_AFTER.has(prev) || REGEX_AFTER_WORD.test(before)) {
        i += 1;
        let inClass = false;
        while (i < n && source[i] !== '\n') {
          const r = source[i];
          if (r === '\\') { blank(i); blank(i + 1); i += 2; continue; }
          if (r === '[') inClass = true;
          else if (r === ']') inClass = false;
          else if (r === '/' && !inClass) break;
          blank(i);
          i += 1;
        }
        i += 1;
        continue;
      }
    }
    i += 1;
  }
  return { code: out.join(''), comments };
}

// Index of the bracket that closes the one at `open` (code is masked, so brackets in strings
// and comments are gone), or -1.
function closing(code, open) {
  const pairs = { '(': ')', '[': ']', '{': '}' };
  const want = pairs[code[open]];
  let depth = 0;
  for (let i = open; i < code.length; i += 1) {
    const c = code[i];
    if (c === code[open]) depth += 1;
    else if (c === want) {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function skipSpace(code, i) {
  let j = i;
  while (j < code.length && /\s/.test(code[j])) j += 1;
  return j;
}

// The end of the statement or block that starts at `i` (after a loop header).
function bodyEnd(code, i) {
  const start = skipSpace(code, i);
  if (code[start] === '{') return closing(code, start);
  let j = start;
  while (j < code.length) {
    const c = code[j];
    if (c === '(' || c === '[' || c === '{') {
      const end = closing(code, j);
      if (end < 0) return code.length - 1;
      j = end + 1;
      continue;
    }
    if (c === ';' || c === '}') return j;
    j += 1;
  }
  return code.length - 1;
}

// Every loop as { start, end, kind, text }: the header and the body it repeats.
function loops(code) {
  const out = [];
  const doTails = new Set();
  for (const m of code.matchAll(/\bdo\s*\{/g)) {
    const brace = m.index + m[0].length - 1;
    const end = closing(code, brace);
    if (end < 0) continue;
    const tail = skipSpace(code, end + 1);
    if (!code.startsWith('while', tail)) continue;
    const paren = skipSpace(code, tail + 5);
    const close = code[paren] === '(' ? closing(code, paren) : -1;
    if (close < 0) continue;
    doTails.add(tail);
    out.push({ start: m.index, end: close, kind: 'do', header: code.slice(paren + 1, close),
      bodyStart: brace, bodyEnd: end });
  }
  for (const m of code.matchAll(/\b(while|for)\s*(?:await\s*)?\(/g)) {
    if (m[1] === 'while' && doTails.has(m.index)) continue;
    const paren = m.index + m[0].length - 1;
    const close = closing(code, paren);
    if (close < 0) continue;
    const end = bodyEnd(code, close + 1);
    out.push({ start: m.index, end, kind: m[1], header: code.slice(paren + 1, close),
      bodyStart: close + 1, bodyEnd: end });
  }
  for (const loop of out) loop.text = code.slice(loop.start, loop.end + 1);
  return out;
}

// Index of the bracket that opens the one closed at `close`, or -1.
function opening(code, close) {
  const pairs = { ')': '(', ']': '[', '}': '{' };
  const want = pairs[code[close]];
  let depth = 0;
  for (let i = close; i >= 0; i -= 1) {
    const c = code[i];
    if (c === code[close]) depth += 1;
    else if (c === want) {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

const NOT_A_NAME = new Set(['if', 'for', 'while', 'switch', 'catch', 'function', 'return',
  'await', 'typeof', 'new', 'do', 'else', 'with', 'super', 'constructor']);

// The name a function expression that starts at `index` is bound to (`const nap = `, `nap: `,
// `H.nap = `), or null.
function boundName(code, index) {
  const m = /([\w$]+)\s*[:=]\s*(?:async\s*)?$/.exec(code.slice(Math.max(0, index - 120), index));
  return m && !NOT_A_NAME.has(m[1]) ? m[1] : null;
}

// Every function as { start, end, name, nameIndex, body }: declarations, expressions, arrows
// and methods. `nameIndex` is where a declaration or a method writes its own name, `body` the
// index its body starts at.
function functions(code) {
  const out = [];
  const block = (from) => {
    const brace = skipSpace(code, from);
    return code[brace] === '{' ? closing(code, brace) : -1;
  };
  for (const m of code.matchAll(/\bfunction\b\s*\*?\s*([\w$]+)?\s*\(/g)) {
    const close = closing(code, m.index + m[0].length - 1);
    const end = close < 0 ? -1 : block(close + 1);
    if (end < 0) continue;
    out.push({ start: m.index, end, name: m[1] || boundName(code, m.index),
      nameIndex: m[1] ? m.index + m[0].lastIndexOf(m[1]) : -1, body: close + 1 });
  }
  for (const m of code.matchAll(/=>/g)) {
    let k = m.index - 1;
    while (k >= 0 && /\s/.test(code[k])) k -= 1;
    let start;
    if (code[k] === ')') start = opening(code, k);
    else {
      start = k;
      while (start > 0 && /[\w$]/.test(code[start - 1])) start -= 1;
    }
    if (start < 0) continue;
    const body = skipSpace(code, m.index + 2);
    let end;
    if (code[body] === '{') end = closing(code, body);
    else {
      end = body;
      while (end < code.length) {
        const c = code[end];
        if (c === '(' || c === '[' || c === '{') {
          const e = closing(code, end);
          if (e < 0) break;
          end = e + 1;
          continue;
        }
        if (c === ',' || c === ';' || c === ')' || c === ']' || c === '}') break;
        end += 1;
      }
      end -= 1;
    }
    if (end < 0) continue;
    out.push({ start, end, name: boundName(code, start), nameIndex: -1, body: m.index + 2 });
  }
  for (const m of code.matchAll(/(?<=^|[{,;}])\s*(?:(?:async|static)\s+)*([\w$]+)\s*\(/gm)) {
    if (NOT_A_NAME.has(m[1])) continue;
    const close = closing(code, m.index + m[0].length - 1);
    const end = close < 0 ? -1 : block(close + 1);
    if (end < 0) continue;
    const nameIndex = m.index + m[0].lastIndexOf(m[1]);
    out.push({ start: nameIndex, end, name: m[1], nameIndex, body: close + 1 });
  }
  return out;
}

// The arguments of a call, split at its top-level commas.
function splitArgs(text) {
  const out = [];
  let from = 0;
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (c === '(' || c === '[' || c === '{') {
      const end = closing(text, i);
      if (end < 0) break;
      i = end + 1;
      continue;
    }
    if (c === ',') { out.push(text.slice(from, i)); from = i + 1; }
    i += 1;
  }
  const last = text.slice(from);
  if (last.trim() || out.length) out.push(last);
  return out.map((a) => a.trim());
}

// A Promise executor that does nothing but arm setTimeout with its own resolve: a sleep,
// whoever awaits it and wherever it runs (the suite, or a page through page.evaluate).
const SLEEP_EXECUTOR = new RegExp(String.raw`^(?:async)?(?:function[\w$]*)?\(?([\w$]+)`
  + String.raw`(?:,[\w$]+)*\)?(?:=>)?\{?(?:return|void)?(?:(?:window|globalThis|self)\.)?`
  + String.raw`setTimeout\((?:\1|(?:async)?\(\)=>\{?(?:return)?\1\([^()]*\);?\}?|`
  + String.raw`function\(\)\{(?:return)?\1\([^()]*\);?\})(?:,[^;]*)?\);?\}?$`);
const GENERIC_SLEEPS = ['sleep', 'delay', 'pause', 'nap', 'snooze'];
const escapeRe = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// The sleeps of one text: every place that waits a fixed time on a timer, after following
// each one out to the calls of the helper that wraps it. Returns { sites, helpers }.
function sleepSites(code, source, external = []) {
  const fns = functions(code);
  const defs = new Set(fns.map((f) => f.nameIndex).filter((i) => i >= 0));
  // A sleep helper is a named function that does nothing but the sleep: no loop, and no call
  // besides the sleep and whatever wraps it (`page.evaluate(...)` around an in-page sleep).
  // Its calls are the sleeps, not its definition. A function that also does something else
  // keeps its sleep where it is written.
  const owner = (index) => {
    let from = index;
    let to = closing(code, code.indexOf('(', index));
    const chain = fns.filter((f) => index >= f.body && index <= f.end)
      .sort((x, y) => (x.end - x.start) - (y.end - y.start));
    for (const f of chain) {
      if (to < 0 || to > f.end) return null;
      // the outermost call in the body of `f` that holds the sleep, else the sleep itself
      let i = f.body;
      while (i < from) {
        const c = code[i];
        if (c === '(' || c === '[' || c === '{') {
          const end = closing(code, i);
          if (end >= 0 && end < from) { i = end + 1; continue; }
          if (c === '(' && /[\w$\])]/.test(code.slice(0, i).trimEnd().slice(-1))) {
            from = i;
            to = end;
            break;
          }
        }
        i += 1;
      }
      const rest = `${code.slice(f.body, from)} ${code.slice(to + 1, f.end + 1)}`;
      if (/[\w$\])]\s*\(/.test(rest) || /\b(?:for|while|do)\b/.test(rest)) return null;
      if (f.name) return f;
      from = f.start;
      to = f.end;
    }
    return null;
  };
  const callsOf = (name, { awaited = false } = {}) => {
    const re = new RegExp(String.raw`${awaited ? String.raw`\bawait\s+` : String.raw`(?<![\w$.])`}`
      + String.raw`(?:[\w$]+\s*\.\s*)*${escapeRe(name)}\s*\(`, 'g');
    const out = [];
    for (const m of code.matchAll(re)) {
      const at = m.index + m[0].lastIndexOf(name);
      if (!/[\w$]/.test(code[at - 1] || ' ') && !defs.has(at)) out.push(m.index);
    }
    return out;
  };

  const queue = [];
  for (const m of code.matchAll(/\bnew\s+Promise\s*\(/g)) {
    const open = m.index + m[0].length - 1;
    const close = closing(code, open);
    if (close < 0) continue;
    if (SLEEP_EXECUTOR.test(code.slice(open + 1, close).replace(/\s+/g, ''))) {
      queue.push({ index: m.index, what: 'new Promise(setTimeout)' });
    }
  }
  // setTimeout of timers/promises returns the sleep itself.
  for (const m of code.matchAll(/\bawait\s+(?:[\w$]+\s*\.\s*)*setTimeout\s*\(/g)) {
    queue.push({ index: m.index, what: 'await setTimeout()' });
  }
  for (const m of code.matchAll(/\brequire\s*\(\s*(['"])\s*\1\s*\)|\bfrom\s*(['"])\s*\2/g)) {
    const end = m.index + m[0].length;
    if (!/['"](?:node:)?timers\/promises['"]/.test(source.slice(m.index, end))) continue;
    if (/^\s*\.\s*(?:setTimeout|scheduler\s*\.\s*wait)\s*\(/.test(code.slice(end))) {
      queue.push({ index: m.index, what: 'timers/promises setTimeout()' });
    }
    const head = code.slice(code.lastIndexOf('\n', m.index) + 1, m.index);
    const names = [];
    const whole = /(?:const|let|var|import)\s+(?:\*\s*as\s+)?([\w$]+)\s*(?:=\s*(?:await\s+)?|\s)$/
      .exec(head);
    // `const nap = require('timers/promises').setTimeout` binds the sleep, not the module
    if (whole && /^\s*\.\s*setTimeout\b(?!\s*\()/.test(code.slice(end))) names.push(whole[1]);
    else if (whole) names.push(`${whole[1]}.setTimeout`, `${whole[1]}.scheduler.wait`);
    const picked = /\{([^}]*)\}\s*(?:=\s*(?:await\s+)?)?$/.exec(head);
    if (picked) {
      for (const entry of picked[1].split(',')) {
        const alias = /^\s*setTimeout\s*(?:(?::|\bas\b)\s*([\w$]+))?\s*$/.exec(entry);
        if (alias) names.push(alias[1] || 'setTimeout');
      }
    }
    for (const name of names) {
      const re = new RegExp(String.raw`(?<![\w$.])${escapeRe(name).replace(/\\\./g,
        String.raw`\s*\.\s*`)}\s*\(`, 'g');
      for (const call of code.matchAll(re)) {
        queue.push({ index: call.index, what: 'timers/promises setTimeout()' });
      }
    }
  }
  const local = new Set(fns.map((f) => f.name).filter(Boolean));
  for (const name of GENERIC_SLEEPS) {
    for (const index of callsOf(name, { awaited: true })) queue.push({ index, what: `${name}()` });
  }
  // A helper another file of the tree defines, unless this file gives the name its own meaning.
  for (const name of external) {
    if (local.has(name) || GENERIC_SLEEPS.includes(name)) continue;
    for (const index of callsOf(name)) queue.push({ index, what: `${name}()` });
  }

  const helpers = new Set();
  const expanded = new Set();
  const sites = [];
  while (queue.length) {
    const site = queue.shift();
    const fn = owner(site.index);
    if (fn) {
      helpers.add(fn.name);
      const calls = callsOf(fn.name).filter((i) => !(i >= fn.start && i <= fn.end));
      if (calls.length) {
        if (!expanded.has(fn.name)) {
          expanded.add(fn.name);
          for (const index of calls) queue.push({ index, what: `${fn.name}()` });
        }
        continue;
      }
    }
    sites.push(site);
  }
  return { sites, helpers: [...helpers] };
}

const INT = /(?<![\w.$])(\d[\d_]*)(?![\w.$]|\.\d)/g;
function bigIntegers(text, min) {
  const out = [];
  for (const m of text.matchAll(INT)) {
    const value = Number(m[1].replace(/_/g, ''));
    if (value >= min) out.push(value);
  }
  return out;
}

// A receiver that is text, not samples: .slice() on it truncates a message.
const TEXT_RECEIVER = new RegExp([
  String.raw`JSON\s*\.\s*stringify\s*\([^]*\)$`,
  String.raw`String\s*\([^]*\)$`,
  String.raw`\.(?:join|toString|toISOString|toFixed|trim|replace|text|innerText|textContent)`
    + String.raw`\s*\([^]*\)$`,
  String.raw`(?:^|[.\s(,!])(?:message|stack|textContent|innerText|innerHTML|outerHTML|href|`
    + String.raw`hash|sha|commit|text|html|title|label|detail|name|id|url|line|lines|msg|stdout|`
    + String.raw`stderr|argv|args|names|keys|errors|problems|failures|entries|rows|list|code|`
    + String.raw`source)$`,
  String.raw`['"\x60]$`,
].join('|'));

// The expression a method is called on, read backwards from the dot before the method name.
function receiver(code, dot) {
  let j = dot - 1;
  while (j >= 0) {
    const c = code[j];
    if (c === ')' || c === ']') {
      let depth = 0;
      const open = c === ')' ? '(' : '[';
      for (; j >= 0; j -= 1) {
        if (code[j] === c) depth += 1;
        else if (code[j] === open) {
          depth -= 1;
          if (depth === 0) break;
        }
      }
      j -= 1;
      continue;
    }
    if (/[\w$.'"\x60]/.test(c) || (c === '?' && code[j + 1] === '.')) { j -= 1; continue; }
    break;
  }
  return code.slice(j + 1, dot).trim();
}

// The statement around `index`: back to the previous `;` or line that ends a statement, and
// forward to the next `;`. Used to decide whether a rate literal is a render rate.
function statement(code, index) {
  let start = index;
  while (start > 0 && code[start - 1] !== ';') {
    if (code[start - 1] === '\n' && /^\s*$/.test(code.slice(code.lastIndexOf('\n', start - 2) + 1,
      start - 1))) break;
    start -= 1;
    if (index - start > 600) break;
  }
  let end = index;
  while (end < code.length && code[end] !== ';' && end - index < 400) end += 1;
  return code.slice(start, end);
}

const RENDER_RATE = /OfflineAudioContext|renderOffline|offline|\bwav\b|WAV|[wW]av[A-Z(]|encodeWav/;

// Playwright waits and the position of their options argument.
const WAITS = Object.freeze({ waitForFunction: 2, waitForSelector: 1, waitForEvent: 1,
  waitForLoadState: 1, waitForURL: 1, waitForResponse: 1, waitForRequest: 1, waitFor: 0 });

// Whether the options argument of a wait states a timeout that is not the literal 0 (which
// in Playwright disables the timeout).
function statesTimeout(option) {
  if (!option || option[0] !== '{') return false;
  for (const entry of splitArgs(option.slice(1, -1))) {
    const m = /^timeout\s*(?::\s*([^]+))?$/.exec(entry);
    if (m) return !(m[1] !== undefined && /^[+-]?0+(?:\.0*)?(?:e\d+)?$/i.test(m[1].trim()));
  }
  return false;
}

function scan(source, { file = '<text>', playwrightAllowed = false, helpers = [] } = {}) {
  const { code, comments } = mask(source);
  const lineStarts = [0];
  for (let i = 0; i < code.length; i += 1) if (code[i] === '\n') lineStarts.push(i + 1);
  const lineOf = (index) => {
    let lo = 0;
    let hi = lineStarts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (lineStarts[mid] <= index) lo = mid;
      else hi = mid - 1;
    }
    return lo + 1;
  };
  const codeLine = (ln) => code.slice(lineStarts[ln - 1],
    ln < lineStarts.length ? lineStarts[ln] - 1 : code.length);
  const findings = [];
  const seen = new Set();

  // The marker on the line, or on a comment-only line directly above it.
  const allowance = (ln) => {
    for (const candidate of [ln, ln - 1]) {
      const text = comments.get(candidate);
      const m = text && MARKER.exec(text);
      if (!m) continue;
      if (candidate !== ln && codeLine(candidate).trim()) continue;
      return { line: candidate, reason: m[1].replace(/\*\/\s*$/, '').trim() };
    }
    return null;
  };
  const add = (index, kind, detail = '') => {
    const line = lineOf(index);
    const key = `${line}:${kind}`;
    if (seen.has(key)) return;
    seen.add(key);
    const allowed = allowance(line);
    if (allowed && reasoned(allowed.reason)) return;
    findings.push({ file, line, kind,
      message: `${KINDS[kind]}${detail ? ` (${detail})` : ''}` });
  };

  for (const [ln, text] of comments) {
    const m = MARKER.exec(text);
    if (m && !reasoned(m[1].replace(/\*\/\s*$/, '').trim())) {
      findings.push({ file, line: ln, kind: 'empty-allow', message: KINDS['empty-allow'] });
    }
  }

  const allLoops = loops(code);
  const allFunctions = functions(code);
  // A loop is bounded by wall time when its own condition reads the clock, or when a guard
  // directly in its body (not in a nested loop or function) leaves it on a clock reading. A
  // loop over a collection or a count is never bounded, whatever its body measures.
  const ownBody = (loop) => {
    const nested = [...allLoops, ...allFunctions].filter((x) => x !== loop
      && x.start > loop.bodyStart && x.end <= loop.end);
    return (index) => index > loop.bodyStart && index <= loop.bodyEnd
      && !nested.some((x) => index >= x.start && index <= x.end);
  };
  const isBounded = (loop) => {
    if (loop.bounded !== undefined) return loop.bounded;
    const parts = (loop.header || '').split(';');
    const forever = loop.kind === 'for' && /^\s*;\s*;\s*$/.test(loop.header || '');
    const iterates = loop.kind === 'for' && parts.length !== 3;
    let bounded = false;
    if (!iterates) {
      const condition = loop.kind === 'for' ? parts[1] : loop.header;
      bounded = WALL_CLOCK.test(condition || '');
      if (!bounded && (loop.kind !== 'for' || forever)) {
        const own = ownBody(loop);
        const clocks = [];
        const assigned = /([\w$]+)\s*=(?!=)([^;]*)/g;
        for (const m of code.slice(loop.bodyStart, loop.bodyEnd + 1).matchAll(assigned)) {
          if (own(loop.bodyStart + m.index) && WALL_CLOCK.test(m[2])) clocks.push(m[1]);
        }
        const named = (n) => new RegExp(String.raw`(?<![\w$.])${escapeRe(n)}(?![\w$])`);
        const reads = (text) => WALL_CLOCK.test(text) || clocks.some((n) => named(n).test(text));
        for (const m of code.slice(loop.bodyStart, loop.bodyEnd + 1).matchAll(/\bif\s*\(/g)) {
          const at = loop.bodyStart + m.index;
          if (!own(at)) continue;
          const open = at + m[0].length - 1;
          const close = closing(code, open);
          if (close < 0 || !reads(code.slice(open + 1, close))) continue;
          const then = code.slice(close + 1, bodyEnd(code, close + 1) + 1);
          if (/\b(?:break|throw|return)\b/.test(then)) { bounded = true; break; }
        }
      }
    }
    loop.bounded = bounded;
    loop.iterates = iterates;
    return bounded;
  };
  const innermost = (index) => allLoops.filter((l) => index > l.start && index <= l.end)
    .sort((x, y) => (x.end - x.start) - (y.end - y.start))[0];
  // The period of a poll: a sleep whose innermost loop is bounded by wall time.
  const isPeriod = (index) => {
    const loop = innermost(index);
    return Boolean(loop && isBounded(loop));
  };
  const races = [];
  for (const m of code.matchAll(/\bPromise\s*\.\s*(?:race|any)\s*\(/g)) {
    const open = m.index + m[0].length - 1;
    races.push([open, closing(code, open)]);
  }
  const inRace = (index) => races.some(([open, close]) => index > open && index < close);

  // 1. fixed sleeps
  const sleepIndexes = [];
  for (const m of code.matchAll(/\bwaitForTimeout\s*\(/g)) {
    sleepIndexes.push(m.index);
    if (!isPeriod(m.index)) add(m.index, 'fixed-sleep', 'waitForTimeout');
  }

  // 2. setTimeout sleeps: a promise that only arms a timer, wherever it runs and whether or
  // not it is awaited on the spot, followed out to the calls of the helper that wraps it
  for (const site of sleepSites(code, source, helpers).sites) {
    sleepIndexes.push(site.index);
    if (inRace(site.index) || isPeriod(site.index)) continue;
    const loop = innermost(site.index);
    add(site.index, loop && !loop.iterates ? 'counted-poll' : 'timer-sleep', site.what);
  }

  // 3. waiting loops with no wall-clock deadline of their own
  for (const loop of allLoops) {
    if (isBounded(loop) || loop.iterates) continue;
    const forever = loop.kind === 'for' && /^\s*;\s*;\s*$/.test(loop.header || '');
    if (loop.kind === 'for' && !forever) continue;
    const waits = /\bawait\b/.test(loop.text) || /\bcurrentTime\b/.test(loop.text)
      || sleepIndexes.some((i) => i > loop.start && i <= loop.end);
    if (waits) add(loop.start, 'unbounded-loop', `${loop.kind} loop`);
  }

  // 4. Playwright waits whose options argument states no timeout, or the literal 0
  const waitCall = new RegExp(String.raw`\.\s*(${Object.keys(WAITS).join('|')})\s*\(`, 'g');
  for (const m of code.matchAll(waitCall)) {
    const open = m.index + m[0].length - 1;
    const close = closing(code, open);
    const args = close < 0 ? [] : splitArgs(code.slice(open + 1, close));
    if (!statesTimeout(args[WAITS[m[1]]])) add(m.index, 'unbounded-wait', m[1]);
  }

  // 5. playwright outside the harness
  if (!playwrightAllowed) {
    const raw = /\brequire\s*\(\s*(['"])\s*\1\s*\)|\bfrom\s*(['"])\s*\2/g;
    for (const m of code.matchAll(raw)) {
      const name = source.slice(m.index, m.index + m[0].length);
      if (/['"]playwright(?:-core)?(?:\/[^'"]*)?['"]/.test(name)) add(m.index, 'raw-playwright');
    }
  }

  // 6. windows bounded by integer literals
  for (const m of code.matchAll(/\.\s*(slice|subarray)\s*\(/g)) {
    const open = m.index + m[0].length - 1;
    const close = closing(code, open);
    if (close < 0) continue;
    const args = code.slice(open + 1, close);
    if (/sampleRate|\brate\b|frames\s*\(/i.test(args)) continue;
    const big = bigIntegers(args, 64);
    if (!big.length) continue;
    if (m[1] === 'slice' && TEXT_RECEIVER.test(receiver(code, m.index))) continue;
    add(m.index, 'fixed-frame-window', `${m[1]}(${args.replace(/\s+/g, ' ').trim()})`);
  }
  for (const loop of allLoops) {
    if (loop.kind !== 'for' || !loop.header) continue;
    const parts = loop.header.split(';');
    if (parts.length !== 3) continue;
    const v = /(?:let|var)\s+(\w+)\s*=/.exec(parts[0]);
    if (!v) continue;
    const bounds = `${parts[0]};${parts[1]}`;
    if (/sampleRate|\brate\b|frames\s*\(/i.test(bounds)) continue;
    if (!bigIntegers(bounds, 64).length) continue;
    const body = code.slice(loop.bodyStart, loop.end + 1);
    // indexed by the counter, alone or in an expression: d[i], d[off + i], d[2 * i + 1]
    const indexed = new RegExp(String.raw`\[[^\[\]]*(?<![\w$.])${v[1]}(?![\w$])[^\[\]]*\]`);
    if (!indexed.test(body)) continue;
    add(loop.start, 'fixed-frame-window', `for (${loop.header.replace(/\s+/g, ' ').trim()})`);
  }

  // 7. an assumed sample rate
  const RATE = /(?<![\w.$])(?:44100|48000|44_100|48_000|44\.1e3|48e3|4\.41e4|4\.8e4)(?![\w$])/g;
  for (const m of code.matchAll(RATE)) {
    const around = statement(code, m.index);
    const before = code.slice(Math.max(0, m.index - 40), m.index);
    if (RENDER_RATE.test(around)) continue;
    // the value of a sampleRate / sr property: a rate handed to a renderer, not an assumed one
    if (/\b(?:sampleRate|sr)\s*:\s*$/.test(before)) continue;
    add(m.index, 'fixed-rate', m[0]);
  }

  return findings.sort((a, b) => a.line - b.line || a.kind.localeCompare(b.kind));
}

// Every timing-allow marker of one text, with its reason, for a reviewer to read.
function markers(source, { file = '<text>' } = {}) {
  const out = [];
  for (const [line, text] of mask(source).comments) {
    const m = MARKER.exec(text);
    if (m) out.push({ file, line, reason: m[1].replace(/\*\/\s*$/, '').trim() });
  }
  return out.sort((a, b) => a.line - b.line);
}

// The sleep helpers one text defines (see sleepSites).
function helperNames(source) {
  return sleepSites(mask(source).code, source).helpers;
}

function format(finding) {
  return `${finding.file}:${finding.line}: [${finding.kind}] ${finding.message}`;
}

// ------------------------------------------------------------------- the tree and its debt
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..', '..');
const BASELINE = path.join(__dirname, '..', 'timing-baseline.json');

// Every source under tests/browser: the entry suites, lib/ and the fixtures pages run.
function sources(root = ROOT) {
  const out = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.(?:cjs|mjs|js)$/.test(entry.name)) out.push(full);
    }
  };
  walk(path.join(root, 'tests', 'browser'));
  return out.map((full) => path.relative(root, full).split(path.sep).join('/')).sort();
}

// Two passes: a sleep helper defined in one file of the tree is a sleep where another calls it.
function scanTree(root = ROOT) {
  const texts = sources(root).map((file) => [file, fs.readFileSync(path.join(root, file), 'utf8')]);
  const helpers = [...new Set(texts.flatMap(([, text]) => helperNames(text)))];
  const findings = [];
  for (const [file, text] of texts) {
    findings.push(...scan(text,
      { file, helpers, playwrightAllowed: file === 'tests/browser/lib/suite.cjs' }));
  }
  return findings;
}

function treeMarkers(root = ROOT) {
  return sources(root).flatMap((file) => markers(fs.readFileSync(path.join(root, file), 'utf8'),
    { file }));
}

function tally(findings) {
  const out = {};
  for (const f of findings) {
    out[f.file] = out[f.file] || {};
    out[f.file][f.kind] = (out[f.file][f.kind] || 0) + 1;
  }
  return out;
}

// The recorded debt is a count per file and kind of findings that predate the rule. A count
// above its record is a new violation: every finding of that kind in the file is returned,
// since the scan cannot tell which one is new. A count below its record is `stale`: the debt
// was paid and the record should follow it down (--write-baseline).
function compare(findings, debt) {
  const counts = tally(findings);
  const excess = [];
  const stale = [];
  for (const [file, kinds] of Object.entries(counts)) {
    for (const [kind, n] of Object.entries(kinds)) {
      const recorded = (debt[file] && debt[file][kind]) || 0;
      if (n > recorded) {
        excess.push({ file, kind, found: n, recorded,
          findings: findings.filter((f) => f.file === file && f.kind === kind) });
      }
    }
  }
  for (const [file, kinds] of Object.entries(debt)) {
    for (const [kind, recorded] of Object.entries(kinds)) {
      const n = (counts[file] && counts[file][kind]) || 0;
      if (n < recorded) stale.push({ file, kind, found: n, recorded });
    }
  }
  return { excess, stale, counts };
}

function readBaseline(file = BASELINE) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function report({ excess }) {
  const lines = [];
  for (const e of excess) {
    if (e.recorded) {
      lines.push(`${e.file}: ${e.found} [${e.kind}] finding(s), ${e.recorded} recorded as debt; `
        + 'one of these is new:');
    }
    for (const f of e.findings) lines.push(`${e.recorded ? '  ' : ''}${format(f)}`);
  }
  return lines;
}

module.exports = { RULE, scan, mask, format, KINDS, sources, scanTree, tally, compare,
  readBaseline, report, markers, treeMarkers, helperNames, BASELINE };

//   node tests/browser/lib/timing-scan.cjs                    findings beyond the recorded debt
//   node tests/browser/lib/timing-scan.cjs --write-baseline   lower the record to today's counts
if (require.main === module) {
  const findings = scanTree();
  const baseline = readBaseline();
  const result = compare(findings, baseline.debt);
  if (process.argv.includes('--write-baseline')) {
    // Only ever downwards: a count that grew is a violation to fix or to mark, not to record.
    const debt = {};
    for (const [file, kinds] of Object.entries(result.counts)) {
      for (const [kind, n] of Object.entries(kinds)) {
        const recorded = (baseline.debt[file] && baseline.debt[file][kind]) || 0;
        const keep = Math.min(n, recorded);
        if (keep > 0) (debt[file] = debt[file] || {})[kind] = keep;
      }
    }
    fs.writeFileSync(BASELINE, `${JSON.stringify({ ...baseline, debt }, null, 2)}\n`);
    console.log(`wrote ${path.relative(ROOT, BASELINE)}`);
  }
  if (result.excess.length) console.log(`${RULE}: findings beyond the recorded debt`);
  for (const line of report(result)) console.log(line);
  for (const s of result.stale) {
    console.log(`stale debt: ${s.file} [${s.kind}] ${s.found} found, ${s.recorded} recorded`);
  }
  process.exit(result.excess.length ? 1 : 0);
}
