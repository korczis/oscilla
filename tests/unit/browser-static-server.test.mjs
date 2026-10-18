// The browser suites that load dist over http serve it through one helper,
// tests/browser/lib/serve.cjs, on a port the operating system assigns. Each suite used to pick
// a random port in a fixed range and never check it: on 2026-10-18 v31-studio-workflows drew
// 9507, which another session's majordomus server already held, and the release gate failed
// with "server did not start" although the page was fine. Its own readiness loop was also a
// fixed 80 x 100 ms sleep (rule project.bounded-test-timing).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const BROWSER = path.join(ROOT, 'tests/browser');
const require = createRequire(import.meta.url);

const suites = () => fs.readdirSync(BROWSER).filter((f) => f.endsWith('.cjs'))
  .map((f) => ({ file: `tests/browser/${f}`, text: fs.readFileSync(path.join(BROWSER, f), 'utf8') }));

test('no browser suite picks a server port at random or starts its own static server', () => {
  const problems = [];
  for (const { file, text } of suites()) {
    if (/port\s*=\s*\d+\s*\+\s*Math\.floor\(\s*Math\.random\(\)/.test(text)) {
      problems.push(`${file}: picks a random port; use serveDist from ./lib/serve.cjs`);
    }
    if (/['"]http\.server['"]/.test(text)) {
      problems.push(`${file}: spawns http.server itself; use serveDist from ./lib/serve.cjs`);
    }
    if (/function\s+waitForServer\b/.test(text)) {
      problems.push(`${file}: defines its own waitForServer; serveDist waits for the server`);
    }
  }
  assert.deepEqual(problems, []);
});

test('every suite that serves over http requires the shared helper', () => {
  const served = suites().filter(({ text }) => /serveDist\(/.test(text));
  assert.ok(served.length > 0, 'at least one suite serves dist over http');
  for (const { file, text } of served) {
    assert.match(text, /require\(['"]\.\/lib\/serve\.cjs['"]\)/, `${file} requires ./lib/serve.cjs`);
  }
});

function fixtureDist() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oscilla-serve-test-'));
  const file = path.join(dir, 'index.html');
  fs.writeFileSync(file, '<!doctype html><title>fixture</title><p>served</p>');
  return { dir, file };
}

function occupy() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

test('serveDist serves the file at /oscilla/ on a port the OS assigned, and close removes it',
  async () => {
    const { serveDist } = require('../browser/lib/serve.cjs');
    const fixture = fixtureDist();
    const server = await serveDist(fixture.file, { prefix: 'oscilla-serve-test-root-' });
    try {
      assert.match(server.url, /^http:\/\/127\.0\.0\.1:\d+\/oscilla\/$/);
      const body = await (await fetch(server.url)).text();
      assert.match(body, /<p>served<\/p>/);
    } finally {
      server.close();
      fs.rmSync(fixture.dir, { recursive: true, force: true });
    }
    assert.equal(fs.existsSync(server.root), false, 'close removes the served root');
  });

test('a port already taken is not fatal: serveDist moves on to another one', async () => {
  const { serveDist } = require('../browser/lib/serve.cjs');
  const taken = await occupy();
  const takenPort = taken.address().port;
  const fixture = fixtureDist();
  const offered = [takenPort];
  const server = await serveDist(fixture.file, {
    // The first port offered is held by another listener, as 9507 was by majordomus.
    port: async () => (offered.length ? offered.shift() : 0),
  });
  try {
    assert.notEqual(new URL(server.url).port, String(takenPort));
    assert.equal((await fetch(server.url)).ok, true);
  } finally {
    server.close();
    taken.close();
    fs.rmSync(fixture.dir, { recursive: true, force: true });
  }
});

test('a server that never answers ends in a named timeout, not a hang', async () => {
  const { serveDist } = require('../browser/lib/serve.cjs');
  const fixture = fixtureDist();
  await assert.rejects(
    serveDist(fixture.file, { ms: 300, attempts: 1, command: ['sleep', '5'] }),
    /static server.*within 300 ms/,
  );
  fs.rmSync(fixture.dir, { recursive: true, force: true });
});
