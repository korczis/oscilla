// scripts/release-bounded.mjs, the one bounded runner of the release scripts: every call has a
// named per-attempt bound, a network call that fails transiently is tried again at most
// NET_ATTEMPTS times, and a call out of attempts names itself and why. The publish of
// 2026-10-31 had one `gh run list` sit for 2 h 20 min with no output and lost its wait for
// the dispatched Pages run to "can't assign requested address" (local port exhaustion).
// Every runner here is injected except one real child process that never exits, stopped at
// a bound of a few hundred milliseconds.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  FETCH_TIMEOUT_MS, LOCAL_CALL_TIMEOUT_MS, NET_ATTEMPTS, NET_CALL_TIMEOUT_MS, NET_RETRY_DELAY_MS,
  NET_TRANSFER_TIMEOUT_MS, TIMED_OUT_STATUS, actsOnce, boundedFetch, boundedRunner,
  defaultTimeoutMs, failure, isNetworkCall, transientKind,
} from '../../scripts/release-bounded.mjs';
import { defaultIo } from '../../scripts/release-record.mjs';

const PORTS = "read tcp 192.168.1.20:61234->140.82.121.6:443: read: can't assign requested "
  + 'address';
const HUNG = () => ({ status: null, signal: 'SIGKILL', stdout: '', stderr: '',
  error: Object.assign(new Error('spawnSync gh ETIMEDOUT'), { code: 'ETIMEDOUT' }) });

/** A runner over `answers` (one spawnSync result per attempt, the last one repeated). */
function scripted(answers) {
  const spawned = [];
  const slept = [];
  const notes = [];
  const spawn = (cmd, args, opts) => {
    spawned.push({ cmd, args, opts });
    const a = answers[Math.min(spawned.length - 1, answers.length - 1)];
    return typeof a === 'function' ? a() : a;
  };
  const sh = boundedRunner({ cwd: '/nonexistent', spawn, sleepMs: (ms) => slept.push(ms),
    note: (l) => notes.push(l), echo: () => {} });
  return { sh, spawned, slept, notes };
}

test('the bounds are named and finite, and a release call has the right one', () => {
  for (const ms of [NET_CALL_TIMEOUT_MS, NET_TRANSFER_TIMEOUT_MS, LOCAL_CALL_TIMEOUT_MS,
    FETCH_TIMEOUT_MS, NET_RETRY_DELAY_MS]) {
    assert.ok(Number.isFinite(ms) && ms > 0);
  }
  assert.ok(NET_ATTEMPTS >= 2 && NET_ATTEMPTS <= 5, 'a small bounded retry');
  assert.equal(defaultTimeoutMs('gh', ['run', 'list']), NET_CALL_TIMEOUT_MS);
  assert.equal(defaultTimeoutMs('git', ['ls-remote', 'origin']), NET_CALL_TIMEOUT_MS);
  assert.equal(defaultTimeoutMs('git', ['push', 'origin']), NET_CALL_TIMEOUT_MS);
  assert.equal(defaultTimeoutMs('gh', ['release', 'create', 'v1']), NET_TRANSFER_TIMEOUT_MS);
  assert.equal(defaultTimeoutMs('gh', ['release', 'download', 'v1']), NET_TRANSFER_TIMEOUT_MS);
  assert.equal(defaultTimeoutMs('npm', ['run', 'build:check']), LOCAL_CALL_TIMEOUT_MS);
  assert.ok(isNetworkCall('gh', ['auth', 'status']));
  assert.ok(!isNetworkCall('git', ['rev-parse', 'HEAD']));
  assert.ok(actsOnce('gh', ['workflow', 'run', 'pages.yml']));
  assert.ok(actsOnce('gh', ['release', 'create', 'v1']));
  assert.ok(!actsOnce('gh', ['run', 'list']));
});

test('a hanging gh call is stopped at its bound, retried, and reported with the reason', () => {
  const r = scripted([HUNG]);
  const args = ['run', 'list', '--workflow', 'pages.yml', '--limit', '20'];
  const out = r.sh('gh', args);
  assert.equal(out.status, TIMED_OUT_STATUS);
  assert.equal(out.timedOut, true);
  assert.equal(out.attempts, NET_ATTEMPTS);
  assert.equal(r.spawned.length, NET_ATTEMPTS);
  for (const { opts } of r.spawned) {
    assert.equal(opts.timeout, NET_CALL_TIMEOUT_MS);
    assert.equal(opts.killSignal, 'SIGKILL');
  }
  assert.deepEqual(r.slept, [NET_RETRY_DELAY_MS, 2 * NET_RETRY_DELAY_MS]);
  assert.equal(failure('gh', args, out), 'gh run list --workflow pages.yml --limit 20: timed out '
    + `after ${NET_CALL_TIMEOUT_MS / 1000} s (${NET_ATTEMPTS} attempts)`);
  assert.equal(r.notes.length, NET_ATTEMPTS - 1);
  assert.match(r.notes[0], /RETRY gh run list .*: timed out after 60 s; attempt 2\/3 in 5 s/);
});

test("can't assign requested address, ECONNRESET and HTTP 5xx are retried until one succeeds",
  () => {
    for (const stderr of [PORTS, 'read: connection reset by peer', 'HTTP 502: Bad Gateway',
      'Post "https://api.github.com/graphql": net/http: TLS handshake timeout']) {
      const r = scripted([{ status: 1, stdout: '', stderr }, { status: 0, stdout: '[]\n',
        stderr: '' }]);
      const out = r.sh('gh', ['run', 'list']);
      assert.equal(out.status, 0, stderr);
      assert.equal(out.stdout, '[]');
      assert.equal(out.attempts, 2);
      assert.equal(out.reason, null);
      assert.deepEqual(r.slept, [NET_RETRY_DELAY_MS]);
    }
    assert.equal(transientKind({ status: 1, stderr: PORTS }), 'connect');
    assert.equal(transientKind({ status: 1, stderr: 'HTTP 503' }), 'transient');
  });

test('a refusal is not retried: not found, not authenticated, a local command', () => {
  for (const stderr of ['HTTP 404: Not Found', 'You are not logged into any GitHub hosts']) {
    const r = scripted([{ status: 1, stdout: '', stderr }]);
    const out = r.sh('gh', ['release', 'view', 'v1']);
    assert.equal(out.attempts, 1);
    assert.equal(out.reason, stderr);
    assert.deepEqual(r.slept, []);
  }
  const local = scripted([HUNG]);
  const out = local.sh('npm', ['run', 'build:check']);
  assert.equal(out.attempts, 1, 'a local command is bounded but not retried');
  assert.equal(local.spawned[0].opts.timeout, LOCAL_CALL_TIMEOUT_MS);
});

test('a call that acts once is retried only when it never connected', () => {
  const timedOut = scripted([HUNG, { status: 0, stdout: '' }]);
  assert.equal(timedOut.sh('gh', ['workflow', 'run', 'pages.yml', '--ref', 'main']).attempts, 1,
    'a dispatch that timed out may have reached GitHub: not dispatched again');
  const reset = scripted([{ status: 1, stderr: 'HTTP 502' }, { status: 0, stdout: '' }]);
  assert.equal(reset.sh('gh', ['release', 'create', 'v1']).attempts, 1);
  const ports = scripted([{ status: 1, stderr: PORTS }, { status: 0, stdout: '' }]);
  const out = ports.sh('gh', ['workflow', 'run', 'pages.yml', '--ref', 'main']);
  assert.equal(out.status, 0);
  assert.equal(out.attempts, 2, 'a call that never left this machine is safe to repeat');
});

test('a watch whose bound is its whole budget is not started again', () => {
  const r = scripted([HUNG]);
  const out = r.sh('gh', ['run', 'watch', '7003', '--exit-status'],
    { inherit: true, timeoutMs: 30 * 60_000, retryTimedOut: false });
  assert.equal(out.attempts, 1);
  assert.equal(r.spawned[0].opts.timeout, 30 * 60_000);
  assert.deepEqual(r.spawned[0].opts.stdio, ['ignore', 'inherit', 'pipe'],
    'stdout reaches the terminal, stderr is read to classify the failure');
});

test('a real child that never exits is stopped at its bound', () => {
  const sh = boundedRunner({ cwd: process.cwd(), note: () => {}, echo: () => {} });
  const started = Date.now();
  const out = sh(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { timeoutMs: 300 });
  const took = Date.now() - started;
  assert.equal(out.status, TIMED_OUT_STATUS);
  assert.equal(out.timedOut, true);
  assert.equal(out.reason, 'timed out after 0.3 s');
  assert.ok(took < 30_000, `stopped after ${took} ms`);
});

test('release:record reads GitHub through the same bounded runner', () => {
  const spawned = [];
  const slept = [];
  let n = 0;
  const io = defaultIo('/nonexistent', {
    spawn: (cmd, args, opts) => {
      spawned.push(opts.timeout);
      n += 1;
      return n === 1 ? { status: 1, stdout: '', stderr: PORTS }
        : { status: 0, stdout: 'v1\n', stderr: '' };
    },
    sleepMs: (ms) => slept.push(ms), note: () => {}, echo: () => {},
  });
  const out = io.run('gh', ['api', 'repos/korczis/oscilla/commits/refs/tags/v1']);
  assert.equal(out.status, 0);
  assert.equal(out.stdout, 'v1');
  assert.deepEqual(spawned, [NET_CALL_TIMEOUT_MS, NET_CALL_TIMEOUT_MS]);
  assert.deepEqual(slept, [NET_RETRY_DELAY_MS]);
});

// --------------------------------------------------------------------------- boundedFetch
const response = (status, text = '') => ({
  status, headers: { get: () => 'text/html' }, arrayBuffer: async () => Buffer.from(text),
});

test('boundedFetch: a request that never answers is aborted at its bound and retried', async () => {
  const slept = [];
  let calls = 0;
  // A socket would hold the event loop open while it waits; this fake holds it with a timer
  // (AbortSignal.timeout does not), cleared when the bound aborts the request.
  const hang = (url, init) => new Promise((resolve, reject) => {
    calls += 1;
    const socket = setTimeout(() => {}, 60_000);
    init.signal.addEventListener('abort', () => {
      clearTimeout(socket);
      reject(init.signal.reason);
    });
  });
  await assert.rejects(boundedFetch('https://example.invalid/', { timeoutMs: 50, attempts: 2,
    fetchImpl: hang, sleep: async (ms) => { slept.push(ms); } }),
  /^Error: GET https:\/\/example\.invalid\/: timed out after 0\.05 s \(2 attempts\)$/);
  assert.equal(calls, 2);
  assert.deepEqual(slept, [NET_RETRY_DELAY_MS]);
});

test('boundedFetch: a 5xx or a refused connection is retried, a 4xx is returned', async () => {
  const seq = [() => { throw Object.assign(new TypeError('fetch failed'),
    { cause: { code: 'EADDRNOTAVAIL' } }); }, () => response(503), () => response(200, 'ok')];
  let i = 0;
  const res = await boundedFetch('https://example.invalid/', {
    fetchImpl: async () => seq[i++](), sleep: async () => {} });
  assert.equal(res.status, 200);
  assert.equal(res.body.toString(), 'ok');
  assert.equal(i, 3);
  let n = 0;
  const missing = await boundedFetch('https://example.invalid/x', {
    fetchImpl: async () => { n += 1; return response(404); }, sleep: async () => {} });
  assert.equal(missing.status, 404);
  assert.equal(n, 1);
  await assert.rejects(boundedFetch('https://example.invalid/', { attempts: 2,
    fetchImpl: async () => response(502), sleep: async () => {} }),
  /GET https:\/\/example\.invalid\/: HTTP 502 \(2 attempts\)/);
});
