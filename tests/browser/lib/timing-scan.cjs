// Static scan behind rule project.bounded-test-timing: the waits and windows in a browser
// suite that measure the host instead of OSCILLA. tests/unit/browser-timing.test.mjs runs it
// over tests/browser; it is a module so the same scan can be pointed at one text.
//
//   const { scan } = require('./timing-scan.cjs');
//   scan(sourceText, { file: 'tests/browser/dsp.cjs' })  ->  [{ file, line, kind, message }]
//
// A finding is silenced only by `// timing-allow: <reason>` on its line, or on a line directly
// above that holds nothing but that comment. The reason is required.
'use strict';

const KINDS = Object.freeze({
  'fixed-sleep': 'a fixed sleep stands in for a product condition; poll the condition with '
    + 'until() from lib/wait.cjs',
  'timer-sleep': 'a setTimeout sleep outside a wall-clock-bounded poll; poll the condition '
    + 'with until() from lib/wait.cjs',
  'counted-poll': 'a poll bounded by a count of sleeps, not by wall time; use until() or a '
    + 'Date.now() deadline',
  'unbounded-loop': 'a waiting loop without a Date.now() or performance.now() deadline',
  'unbounded-wait': 'no explicit timeout option',
  'raw-playwright': 'playwright required directly, so page.evaluate is unbounded; take it from '
    + 'lib/suite.cjs (run.playwright)',
  'fixed-frame-window': 'a frame window built from an integer literal; derive it from the '
    + "context's sampleRate (frames() or anchor() in lib/wait.cjs)",
  'fixed-rate': 'a 44100/48000 literal outside an OfflineAudioContext or WAV render rate; '
    + "read the context's sampleRate",
  'empty-allow': 'timing-allow without a reason',
});

const MARKER = /timing-allow:[ \t]*(.*)/;
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
    out.push({ start: m.index, end: close, kind: 'do' });
  }
  for (const m of code.matchAll(/\b(while|for)\s*(?:await\s*)?\(/g)) {
    if (m[1] === 'while' && doTails.has(m.index)) continue;
    const paren = m.index + m[0].length - 1;
    const close = closing(code, paren);
    if (close < 0) continue;
    const end = bodyEnd(code, close + 1);
    out.push({ start: m.index, end, kind: m[1], header: code.slice(paren + 1, close) });
  }
  for (const loop of out) loop.text = code.slice(loop.start, loop.end + 1);
  return out;
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
    + String.raw`stderr|argv|args|names|keys|errors|problems|failures|entries|rows|list)$`,
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

function scan(source, { file = '<text>', playwrightAllowed = false } = {}) {
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
    if (allowed && allowed.reason.length >= 8) return;
    findings.push({ file, line, kind,
      message: `${KINDS[kind]}${detail ? ` (${detail})` : ''}` });
  };

  for (const [ln, text] of comments) {
    const m = MARKER.exec(text);
    if (m && m[1].replace(/\*\/\s*$/, '').trim().length < 8) {
      findings.push({ file, line: ln, kind: 'empty-allow', message: KINDS['empty-allow'] });
    }
  }

  const allLoops = loops(code);
  const bounded = allLoops.filter((l) => WALL_CLOCK.test(l.text));
  const inBounded = (index) => bounded.some((l) => index > l.start && index <= l.end);

  // 1. fixed sleeps
  for (const m of code.matchAll(/\bwaitForTimeout\s*\(/g)) {
    if (!inBounded(m.index)) add(m.index, 'fixed-sleep', 'waitForTimeout');
  }

  // 2. setTimeout sleeps: awaited directly, or through a helper defined in the file
  const SLEEP_BODY = String.raw`new\s+Promise\s*\(\s*(?:\(\s*)?(?<done>\w+)\s*(?:\)\s*)?=>\s*`
    + String.raw`(?:\{\s*)?(?:window\s*\.\s*)?setTimeout\s*\(\s*\k<done>\b`;
  const helpers = new Set();
  const helperDef = new RegExp(String.raw`(?:(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s*)?`
    + String.raw`(?:\([^)]*\)|\w+)\s*=>\s*|function\s+(\w+)\s*\([^)]*\)\s*\{\s*return\s+)`
    + SLEEP_BODY, 'g');
  for (const m of code.matchAll(helperDef)) helpers.add(m[1] || m[2]);
  const sleepers = [];
  for (const m of code.matchAll(new RegExp(String.raw`\bawait\s+${SLEEP_BODY}`, 'g'))) {
    sleepers.push({ index: m.index, what: 'await new Promise(setTimeout)' });
  }
  for (const name of helpers) {
    const call = new RegExp(String.raw`\bawait\s+(?:\w+\s*\.\s*)?${name}\s*\(`, 'g');
    for (const m of code.matchAll(call)) sleepers.push({ index: m.index, what: `${name}()` });
  }
  for (const m of code.matchAll(/\bawait\s+(?:\w+\s*\.\s*)?(?:sleep|delay|pause)\s*\(/g)) {
    sleepers.push({ index: m.index, what: 'sleep()' });
  }
  const sleepIndexes = [];
  for (const s of sleepers) {
    sleepIndexes.push(s.index);
    if (inBounded(s.index)) continue;
    const counted = allLoops.some((l) => s.index > l.start && s.index <= l.end);
    add(s.index, counted ? 'counted-poll' : 'timer-sleep', s.what);
  }
  for (const m of code.matchAll(/\bwaitForTimeout\s*\(/g)) sleepIndexes.push(m.index);

  // 3. waiting loops with no wall-clock deadline
  for (const loop of allLoops) {
    if (WALL_CLOCK.test(loop.text)) continue;
    const forever = loop.kind === 'for' && /^\s*;\s*;\s*$/.test(loop.header || '');
    if (loop.kind === 'for' && !forever) continue;
    const waits = /\bawait\b/.test(loop.text) || /\bcurrentTime\b/.test(loop.text)
      || sleepIndexes.some((i) => i > loop.start && i <= loop.end);
    if (waits) add(loop.start, 'unbounded-loop', `${loop.kind} loop`);
  }

  // 4. Playwright waits without an explicit timeout
  for (const m of code.matchAll(/\.\s*(waitForFunction|waitForSelector|waitForEvent)\s*\(/g)) {
    const open = m.index + m[0].length - 1;
    const close = closing(code, open);
    const args = close < 0 ? '' : code.slice(open + 1, close);
    if (!/\btimeout\b/.test(args)) add(m.index, 'unbounded-wait', m[1]);
  }

  // 5. playwright outside the harness
  if (!playwrightAllowed) {
    const raw = /\brequire\s*\(\s*(['"])\s*\1\s*\)|\bfrom\s*(['"])\s*\2/g;
    for (const m of code.matchAll(raw)) {
      const name = source.slice(m.index, m.index + m[0].length);
      if (/['"]playwright(?:-core)?(?:\/[^'"]*)?['"]/.test(name)) add(m.index, 'raw-playwright');
    }
  }

  // 6. frame windows from integer literals
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
    if (/sampleRate|\brate\b|frames\s*\(|\.length\b/i.test(bounds)) continue;
    if (!bigIntegers(bounds, 64).length) continue;
    const body = code.slice(loop.start + loop.header.length, loop.end + 1);
    const indexed = new RegExp(String.raw`\[\s*${v[1]}\s*(?:[-+*]\s*[\w.]+\s*)?\]`);
    if (!indexed.test(body)) continue;
    add(loop.start, 'fixed-frame-window', `for (${loop.header.replace(/\s+/g, ' ').trim()})`);
  }

  // 7. an assumed sample rate
  const RATE = /(?<![\w.$])(?:44100|48000|44_100|48_000|44\.1e3|48e3)(?![\w$])/g;
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

function scanTree(root = ROOT) {
  const findings = [];
  for (const file of sources(root)) {
    findings.push(...scan(fs.readFileSync(path.join(root, file), 'utf8'),
      { file, playwrightAllowed: file === 'tests/browser/lib/suite.cjs' }));
  }
  return findings;
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

module.exports = { scan, mask, format, KINDS, sources, scanTree, tally, compare, readBaseline,
  report, BASELINE };

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
  for (const line of report(result)) console.log(line);
  for (const s of result.stale) {
    console.log(`stale debt: ${s.file} [${s.kind}] ${s.found} found, ${s.recorded} recorded`);
  }
  process.exit(result.excess.length ? 1 : 0);
}
