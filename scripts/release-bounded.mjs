// The one bounded runner of the release scripts: every gh call, every git call that reaches
// origin and every HTTP request of release:publish, release:record, release:verify-deploy and
// release-cadence.mjs goes through here, with a named wall-clock bound per call and a small
// bounded retry on transient failures (rule project.ci-bounded, in spirit, for the scripts
// the workflows and the owner run).
//
// Why (the publish of 2026-10-31): one `gh run list --workflow pages.yml` sat for 2 h 20 min with
// no output, and later a gh call failed with "read tcp ...: can't assign requested address"
// (the Mac had run out of local ephemeral ports), which ended the wait for the dispatched
// Pages run although a second try would have read the list.
//
// A call that is out of attempts reports itself: `failure(cmd, args, r)` names the command
// line, why it failed (timed out after N s, or the last line of its stderr, or its exit code)
// and how many attempts were made.
import { spawnSync } from 'node:child_process';

/** One gh call, one git ls-remote/push/fetch: at most this long per attempt. */
export const NET_CALL_TIMEOUT_MS = 60_000;
/** A gh call that moves a release asset (gh release create/upload/download). */
export const NET_TRANSFER_TIMEOUT_MS = 180_000;
/** Any other command a release script runs (npm run build:check, node verify-deploy). */
export const LOCAL_CALL_TIMEOUT_MS = 20 * 60_000;
/** Attempts of a network call that fails transiently: the first and two retries. */
export const NET_ATTEMPTS = 3;
/** The pause before retry n is n times this: 5 s, then 10 s. */
export const NET_RETRY_DELAY_MS = 5_000;
/** One HTTP request (page or asset), body included. */
export const FETCH_TIMEOUT_MS = 30_000;
/** The exit status of a call that was stopped at its bound (as coreutils timeout). */
export const TIMED_OUT_STATUS = 124;

// Failures that a second try can clear: the local port table, a reset or refused connection,
// DNS, a timeout on the way, a server error. The first group is failing to CONNECT, so the
// request never left this machine and even a call that must not run twice is retried.
const CONNECT_FAILURE = new RegExp([
  "can't assign requested address", 'EADDRNOTAVAIL', 'connection refused', 'ECONNREFUSED',
  'could not resolve host', 'ENOTFOUND', 'EAI_AGAIN', 'no such host',
].join('|'), 'i');
const TRANSIENT_FAILURE = new RegExp([
  'ECONNRESET', 'connection reset', 'ETIMEDOUT', 'i/o timeout', 'TLS handshake timeout',
  'timed out', 'timeout awaiting', 'unexpected EOF', 'HTTP 5\\d\\d', 'Bad Gateway',
  'Service Unavailable', 'Gateway Time-?out', 'EPIPE',
].join('|'), 'i');

/** Pure: whether the call reaches the network (every gh call; git ls-remote, push, fetch). */
export function isNetworkCall(cmd, args = []) {
  if (cmd === 'gh') return true;
  return cmd === 'git' && ['ls-remote', 'push', 'fetch', 'pull'].includes(args[0]);
}

/**
 * Pure: whether running the call twice could act twice (dispatch two Pages runs, create two
 * issues). Such a call is retried only when it failed to connect at all.
 */
export function actsOnce(cmd, args = []) {
  if (cmd !== 'gh') return false;
  const [a, b] = args;
  return (a === 'workflow' && b === 'run') || (a === 'release' && b === 'create')
    || (a === 'issue' && ['create', 'comment', 'close'].includes(b));
}

/** Pure: the per-attempt bound of a call, unless the caller names its own. */
export function defaultTimeoutMs(cmd, args = []) {
  if (cmd === 'gh' && args[0] === 'release'
    && ['create', 'upload', 'download'].includes(args[1])) return NET_TRANSFER_TIMEOUT_MS;
  return isNetworkCall(cmd, args) ? NET_CALL_TIMEOUT_MS : LOCAL_CALL_TIMEOUT_MS;
}

/**
 * Pure: the transient class of a failed result: 'connect', 'transient' or null (a refusal
 * such as not found or not authenticated, which a retry would only repeat).
 */
export function transientKind(r) {
  if (!r || r.status === 0) return null;
  const text = `${r.stderr || ''}\n${r.reason || ''}`;
  if (CONNECT_FAILURE.test(text)) return 'connect';
  if (r.timedOut || TRANSIENT_FAILURE.test(text)) return 'transient';
  return null;
}
const lastLine = (s) => String(s || '').trim().split('\n').filter(Boolean).at(-1) || '';

/** Pure: why a result failed, in a few words. */
export function failureReason(r) {
  if (r.timedOut) return `timed out after ${r.timeoutMs / 1000} s`;
  if (r.missing) return 'command not found';
  return lastLine(r.stderr) || `exited ${r.status}`;
}

/** Pure: the failing call and its reason, for a refusal or an error message. */
export function failure(cmd, args, r) {
  const tries = r.attempts > 1 ? ` (${r.attempts} attempts)` : '';
  return `${cmd} ${args.join(' ')}: ${r.reason || failureReason(r)}${tries}`;
}

function blockingSleepMs(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/**
 * A runner `sh(cmd, args, opts)` -> { status, stdout, stderr, missing, timedOut, timeoutMs,
 * attempts, reason } in which every call is bounded and a network call that fails
 * transiently is tried again, at most NET_ATTEMPTS times in all.
 *   opts.inherit   stdout goes to the terminal; stderr is captured (to classify the failure)
 *                  and then echoed
 *   opts.binary    stdout as a Buffer, untrimmed
 *   opts.timeoutMs the bound of one attempt (default: defaultTimeoutMs)
 *   opts.attempts  at most this many attempts (default: NET_ATTEMPTS for a network call, 1
 *                  for any other)
 *   opts.retryTimedOut  false: an attempt stopped at its bound is not repeated (a watch whose
 *                  bound is the whole budget)
 * @param {{ cwd?: string, spawn?: Function, sleepMs?: (ms: number) => void,
 *   echo?: (text: string) => void, note?: (line: string) => void }} [o]  spawn: spawnSync's
 *   signature (tests inject one that hangs or fails); note: one line per retry
 */
export function boundedRunner({
  cwd = process.cwd(), spawn = spawnSync, sleepMs = blockingSleepMs,
  echo = (t) => process.stderr.write(t), note = (l) => process.stderr.write(`${l}\n`),
} = {}) {
  const once = (cmd, args, { inherit, binary, timeoutMs }) => {
    const r = spawn(cmd, args, {
      cwd, timeout: timeoutMs, killSignal: 'SIGKILL', maxBuffer: 1 << 28,
      encoding: binary ? 'buffer' : 'utf8',
      stdio: inherit ? ['ignore', 'inherit', 'pipe'] : ['ignore', 'pipe', 'pipe'],
    });
    const timedOut = Boolean(r.error && r.error.code === 'ETIMEDOUT');
    const missing = Boolean(r.error && r.error.code === 'ENOENT');
    const stderr = String(r.stderr || '').trim();
    if (inherit && stderr) echo(`${stderr}\n`);
    let status = r.status;
    if (timedOut) status = TIMED_OUT_STATUS;
    else if (r.error) status = 127;
    else if (status === null) status = 128;
    const res = {
      status, missing, timedOut, timeoutMs,
      stdout: binary ? r.stdout : String(r.stdout || '').trim(),
      stderr: stderr || (r.error && !timedOut ? r.error.message : ''),
    };
    return { ...res, reason: status === 0 ? null : failureReason(res) };
  };
  return (cmd, args, opts = {}) => {
    const timeoutMs = opts.timeoutMs ?? defaultTimeoutMs(cmd, args);
    const max = opts.attempts ?? (isNetworkCall(cmd, args) ? NET_ATTEMPTS : 1);
    let r;
    for (let n = 1; n <= max; n++) {
      r = { ...once(cmd, args, { ...opts, timeoutMs }), attempts: n };
      const kind = transientKind(r);
      if (!kind || n === max || (kind !== 'connect' && actsOnce(cmd, args))
        || (r.timedOut && opts.retryTimedOut === false)) break;
      const wait = n * NET_RETRY_DELAY_MS;
      note(`  RETRY ${failure(cmd, args, r)}; attempt ${n + 1}/${max} in ${wait / 1000} s`);
      sleepMs(wait);
    }
    return r;
  };
}

/**
 * fetch with a bound per attempt (body included) and the same small retry on a network
 * error, a timeout or an HTTP 5xx. Resolves to { status, contentType, body: Buffer }; a 4xx
 * is returned, not retried. Throws, naming the URL, the reason and the attempts.
 */
export async function boundedFetch(url, {
  timeoutMs = FETCH_TIMEOUT_MS, attempts = NET_ATTEMPTS, fetchImpl = fetch,
  sleep = (ms) => new Promise((r) => { setTimeout(r, ms); }), init = {},
} = {}) {
  let reason = '';
  for (let n = 1; n <= attempts; n++) {
    try {
      const res = await fetchImpl(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
      const body = Buffer.from(await res.arrayBuffer());
      const out = { status: res.status, contentType: res.headers.get('content-type'), body };
      if (res.status < 500) return out;
      reason = `HTTP ${res.status}`;
    } catch (e) {
      reason = e && e.name === 'TimeoutError' ? `timed out after ${timeoutMs / 1000} s`
        : String((e && e.cause && e.cause.code) || (e && e.message) || e);
    }
    if (n < attempts) await sleep(n * NET_RETRY_DELAY_MS);
  }
  const tries = attempts > 1 ? ` (${attempts} attempts)` : '';
  throw new Error(`GET ${url}: ${reason}${tries}`);
}
