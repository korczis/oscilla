// The static server of the browser suites that load dist over http
// (http://127.0.0.1:<port>/oscilla/, the Pages sub-path).
//
// The operating system assigns the port: a suite that picked one at random collided with
// another process on this shared machine (2026-10-18, 9507 held by a majordomus server) and
// failed the release gate with "server did not start" although the page was fine. A server
// that exits before it answers, which is what a taken port does, is retried on another port.
// Readiness is a condition poll with a named wall-clock deadline (rule
// project.bounded-test-timing).
//
//   const { serveDist } = require('./lib/serve.cjs');
//   const server = await serveDist(DIST, { prefix: 'oscilla-studio-' });
//   ... page.goto(server.url) ...
//   server.close();
//
// tests/unit/browser-static-server.test.mjs requires every http suite to use it.
'use strict';

const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { until, WaitTimeout } = require('./wait.cjs');

// A port nothing listens on at this moment, assigned by the OS.
function freePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.unref();
    probe.on('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

// The longest one readiness request may take. A listener that accepts and never answers (a
// port another process holds) would otherwise keep the request, and the process, alive.
const POLL_REQUEST_MS = 1000;

// One attempt: start the server on `port` and wait until /oscilla/ serves this root's file,
// known by its length, so another process answering on the same port is not taken for ours.
// Resolves to the running process; rejects with `exited` set when the process ended first.
async function attempt(root, port, { ms, command, size }) {
  const url = `http://127.0.0.1:${port}/oscilla/`;
  const argv = command
    || ['python3', '-m', 'http.server', String(port), '--bind', '127.0.0.1', '--directory', root];
  const proc = spawn(argv[0], argv.slice(1), { stdio: 'ignore' });
  let exited = null;
  proc.on('exit', (code, signal) => { exited = { code, signal }; });
  proc.on('error', (error) => { exited = { error: error.message }; });
  try {
    await until(async () => {
      if (exited) return true;
      try {
        const r = await fetch(url, { signal: AbortSignal.timeout(Math.min(POLL_REQUEST_MS, ms)) });
        await r.arrayBuffer();
        return r.ok && Number(r.headers.get('content-length')) === size;
      } catch {
        return false;
      }
    }, { ms, what: `the static server serves ${url}` });
  } catch (error) {
    proc.kill();
    throw error;
  }
  if (exited) {
    const failure = new Error(`the static server on port ${port} exited before serving ${url} `
      + `(${JSON.stringify(exited)})`);
    failure.exited = exited;
    throw failure;
  }
  return { proc, url };
}

// Serve `dist` as /oscilla/index.html from a fresh temporary root. Options:
//   prefix    the temporary root's name prefix
//   ms        the wall-clock deadline of each attempt (default 15 s)
//   attempts  how many ports to try when a server exits early (default 3)
//   port      async () => port, for tests; 0 or absent asks the OS
//   command   the server's argv, for tests
async function serveDist(dist, {
  prefix = 'oscilla-serve-', ms = 15000, attempts = 3, port, command,
} = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  fs.mkdirSync(path.join(root, 'oscilla'));
  fs.copyFileSync(dist, path.join(root, 'oscilla', 'index.html'));
  const remove = () => fs.rmSync(root, { recursive: true, force: true });
  const { size } = fs.statSync(dist);
  let last;
  for (let i = 0; i < attempts; i += 1) {
    const chosen = (port && await port()) || await freePort();
    try {
      const { proc, url } = await attempt(root, chosen, { ms, command, size });
      const close = () => {
        if (proc.exitCode === null && proc.signalCode === null) proc.kill();
        remove();
      };
      return { proc, root, url, close };
    } catch (error) {
      last = error;
      if (error instanceof WaitTimeout || !error.exited) break;
    }
  }
  remove();
  throw last;
}

module.exports = { serveDist, freePort };
