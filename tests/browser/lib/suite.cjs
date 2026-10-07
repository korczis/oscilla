// The one harness every browser suite runs through (rule project.suite-harness).
//
//   const suite = require('./lib/suite.cjs');
//   const run = suite.open({ name: 'dsp', browsers: flagValue, origins: flagValue });
//   const playwright = run.playwright;      // engines by known name only, page.evaluate bounded
//   await run.ready();                      // load gate (outside CI) and the load at start
//   run.tally(leg);                         // one executed check of a leg ("chromium/file")
//   run.reportLeg({ leg, checks });         // or: a finished leg and how many checks it ran
//   run.skip(leg, id, reason);              // a declared skip; under CI it must be in the README
//
// What it refuses, each observed before it was a rule:
//   - an empty or unknown browser or origin list (exit 2), and any unknown engine name: a
//     suite that launches nothing printed ALL PASS, and one mapped every unknown name to
//     Chromium (#147);
//   - a selected browser that ran 0 checks (exit 1);
//   - an engine launched outside the selection, an engine launched before ready() resolved,
//     and a selected browser whose own engine was never launched (its checks ran on another);
//   - under CI, a skip that tests/README.md does not list with a reason;
//   - outside CI, a start while the machine is too loaded to measure the product: it waits,
//     bounded, for the 1-minute load average to fall below OSC_LOAD_MAX (default 2 x cores).
//
// tests/unit/browser-suite-contract.test.mjs holds every entry suite to this module.
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { bounded } = require('./wait.cjs');

const RULE = 'project.suite-harness';
const KNOWN_BROWSERS = Object.freeze(['chromium', 'firefox', 'webkit']);
const KNOWN_ORIGINS = Object.freeze(['file', 'http']);
const README = path.resolve(__dirname, '..', '..', 'README.md');
const EXIT_USAGE = 2;
const DEFAULT_EVALUATE_MS = 300000;
const DEFAULT_LOAD_WAIT_MS = 600000;
const LOAD_POLL_MS = 5000;
// Properties a runtime probes on any object (await, JSON, util.inspect, ESM interop).
const BENIGN_PROPS = new Set(['then', 'toJSON', 'inspect', 'default', '__esModule', 'constructor']);

// Both name the rule, so a failure in a CI log says where the contract is written.
class UsageError extends Error {
  constructor(message) {
    super(`${RULE}: ${message}`);
    this.name = 'UsageError';
    this.exitCode = EXIT_USAGE;
  }
}

class SuiteError extends Error {
  constructor(message) {
    super(`${RULE}: ${message}`);
    this.name = 'SuiteError';
  }
}

// A comma-separated selection against the names a suite can run. Empty, blank, repeated and
// unknown names are refused; nothing is ever mapped to a default.
function parse(raw, { known = KNOWN_BROWSERS, what = 'browser' } = {}) {
  const expected = `expected ${known.join(', ')}`;
  if (typeof raw !== 'string' || !raw.trim()) {
    throw new UsageError(`empty ${what} list; ${expected}`);
  }
  const names = raw.split(',').map((n) => n.trim());
  if (names.some((n) => !n)) {
    throw new UsageError(`empty ${what} name in ${JSON.stringify(raw)}; ${expected}`);
  }
  const unknown = names.filter((n) => !known.includes(n));
  if (unknown.length) {
    throw new UsageError(`unknown ${what}(s): ${unknown.join(', ')}; ${expected}`);
  }
  const repeated = names.filter((n, i) => names.indexOf(n) !== i);
  if (repeated.length) {
    throw new UsageError(`repeated ${what}(s): ${repeated.join(', ')}`);
  }
  return names;
}

// The selection in force: a command-line value wins, then the environment variable (a
// variable that is set and empty is an empty list, not "everything"), then the default.
function select({ flag, env = process.env, envName, known, what, fallback }) {
  if (flag !== undefined && flag !== null) return parse(String(flag), { known, what });
  if (envName && env[envName] !== undefined) return parse(env[envName], { known, what });
  return parse((fallback || known).join(','), { known, what });
}

function isCi(env = process.env) {
  const on = (v) => v !== undefined && v !== '' && v !== '0' && v !== 'false';
  return on(env.CI) || on(env.GITHUB_ACTIONS);
}

// ---------------------------------------------------------------------------- declared skips
// tests/README.md lists every skip CI may take, one table row per skip:
//   | `<suite>:<id>` | reason |
function declaredSkips(readmeText) {
  const section = readmeText.split(/^## Declared skips\s*$/m)[1];
  if (section === undefined) return new Map();
  const body = section.split(/^## /m)[0];
  const out = new Map();
  for (const line of body.split('\n')) {
    const m = /^\|\s*`([^`]+)`\s*\|\s*(.*?)\s*\|\s*$/.exec(line);
    if (m && m[2]) out.set(m[1], m[2]);
  }
  return out;
}

// ------------------------------------------------------------------------------- load gate
// Timing checks measure OSCILLA only on a machine that is not starved: the v3.2.0 gate failed
// three times at load 23-48 and passed at about 4. CI runners are single-tenant, so the gate
// is a no-op there. Everything it reads is injectable so the unit test needs no real load.
async function loadGate({
  env = process.env,
  loadavg = os.loadavg,
  cores = os.cpus().length,
  now = Date.now,
  sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); }),
  log = console.log,
  label = 'suite',
} = {}) {
  const read = () => Number(loadavg()[0]);
  const fmt = (x) => x.toFixed(2);
  const first = read();
  if (isCi(env)) {
    log(`[${label}] load ${fmt(first)} at start (CI: no load gate)`);
    return { waitedMs: 0, load: first, max: null, ci: true };
  }
  const given = Number(env.OSC_LOAD_MAX);
  const max = Number.isFinite(given) && given > 0 ? given : 2 * cores;
  const givenWait = Number(env.OSC_LOAD_WAIT_MS);
  const boundMs = Number.isFinite(givenWait) && givenWait > 0 ? givenWait : DEFAULT_LOAD_WAIT_MS;
  const start = now();
  let load = first;
  if (load >= max) {
    log(`[${label}] load ${fmt(load)} is not below OSC_LOAD_MAX ${max}; `
      + `waiting up to ${Math.round(boundMs / 1000)} s`);
  }
  // timing-allow: bounded by `boundMs` on the injected clock, which is Date.now by default
  while (load >= max) {
    const left = boundMs - (now() - start);
    if (left <= 0) {
      throw new SuiteError(`[${label}] load gate: the 1-minute load average ${fmt(load)} stayed `
        + `at or above OSC_LOAD_MAX ${max} for ${Math.round(boundMs / 1000)} s; nothing ran. `
        + 'Run when the machine is quieter, or set OSC_LOAD_MAX / OSC_LOAD_WAIT_MS.');
    }
    // timing-allow: the load poll's period, inside the loop bounded above
    await sleep(Math.min(LOAD_POLL_MS, left));
    load = read();
  }
  const waitedMs = now() - start;
  log(`[${label}] load ${fmt(load)} at start (max ${max}, ${cores} cores`
    + `${waitedMs ? `, waited ${Math.round(waitedMs / 1000)} s` : ''})`);
  return { waitedMs, load, max, ci: false };
}

// -------------------------------------------------------------------- bounded page.evaluate
// page.evaluate has no timeout of its own: a page function that never returns holds the suite
// until the CI job is killed (#153). Every page of a browser launched through the harness
// answers within OSC_EVALUATE_MS of wall time or rejects with the function it was running.
// The same holds for the page's evaluateHandle, $eval and $$eval. A frame, a worker, a
// locator and an element handle keep Playwright's own unbounded evaluate.
const PAGE_EVALUATES = Object.freeze({ evaluate: 0, evaluateHandle: 0, $eval: 1, $$eval: 1 });

function describeFn(fn) {
  const text = String(fn).replace(/\s+/g, ' ').trim();
  return text.length > 120 ? `${text.slice(0, 117)}...` : text;
}

function boundPage(page, ms) {
  if (!page || page.oscillaBounded) return page;
  for (const [method, fnAt] of Object.entries(PAGE_EVALUATES)) {
    if (typeof page[method] !== 'function') continue;
    const original = page[method].bind(page);
    page[method] = (...a) => bounded(original(...a),
      { ms, what: `page.${method}(${describeFn(a[fnAt])})` });
  }
  page.oscillaBounded = true;
  return page;
}

function boundContext(context, ms) {
  if (!context || context.oscillaBounded) return context;
  const newPage = context.newPage.bind(context);
  context.newPage = async (...a) => boundPage(await newPage(...a), ms);
  context.on('page', (page) => boundPage(page, ms));
  for (const page of context.pages()) boundPage(page, ms);
  context.oscillaBounded = true;
  return context;
}

function boundBrowser(browser, ms) {
  if (!browser || browser.oscillaBounded) return browser;
  const newContext = browser.newContext.bind(browser);
  const newPage = browser.newPage.bind(browser);
  browser.newContext = async (...a) => boundContext(await newContext(...a), ms);
  browser.newPage = async (...a) => {
    const page = await newPage(...a);
    boundContext(page.context(), ms);
    return boundPage(page, ms);
  };
  for (const context of browser.contexts()) boundContext(context, ms);
  browser.oscillaBounded = true;
  return browser;
}

function evaluateMs(env = process.env) {
  const given = Number(env.OSC_EVALUATE_MS);
  return Number.isFinite(given) && given > 0 ? given : DEFAULT_EVALUATE_MS;
}

// The playwright module with three changes: an engine is reachable by a known name only (an
// unknown one throws instead of being undefined or a default), every browser it launches or
// connects to hands out pages whose evaluate is bounded, and `onLaunch(name, how)` is told of
// every start before it happens, so the run knows which engines its checks ran on.
function boundPlaywright(playwright, { ms = evaluateMs(), onLaunch = () => {} } = {}) {
  const engines = new Map();
  const engine = (name) => {
    if (!engines.has(name)) {
      const type = playwright[name];
      engines.set(name, new Proxy(type, {
        get(target, prop) {
          const value = target[prop];
          if (prop === 'launch' || prop === 'connect' || prop === 'connectOverCDP') {
            return async (...a) => {
              onLaunch(name, prop);
              return boundBrowser(await value.apply(target, a), ms);
            };
          }
          if (prop === 'launchPersistentContext') {
            return async (...a) => {
              onLaunch(name, prop);
              return boundContext(await value.apply(target, a), ms);
            };
          }
          if (prop === 'launchServer') {
            return async (...a) => {
              onLaunch(name, prop);
              return value.apply(target, a);
            };
          }
          return typeof value === 'function' ? value.bind(target) : value;
        },
      }));
    }
    return engines.get(name);
  };
  return new Proxy(playwright, {
    get(target, prop) {
      if (typeof prop !== 'string') return target[prop];
      if (KNOWN_BROWSERS.includes(prop)) return engine(prop);
      if (!(prop in target) && !BENIGN_PROPS.has(prop)) {
        throw new UsageError(`unknown browser engine ${JSON.stringify(prop)}; `
          + `expected ${KNOWN_BROWSERS.join(', ')}`);
      }
      return target[prop];
    },
  });
}

// --------------------------------------------------------------------------------- the run
function legBrowser(leg, browsers) {
  const text = String(leg);
  return browsers.find((b) => text === b || (text.startsWith(b) && /[^a-z]/.test(text[b.length])));
}

function createRun({
  name,
  browsers,
  origins = null,
  env = process.env,
  readme = README,
  log = console.log,
  // eslint-disable-next-line global-require
  playwright = () => require('playwright'),
} = {}) {
  if (typeof name !== 'string' || !name) throw new TypeError('suite: name is required');
  const counts = new Map(browsers.map((b) => [b, 0]));
  const launched = new Set();
  const skips = [];
  const state = { failed: [], ready: false };
  const fail = (message) => {
    const error = new SuiteError(message);
    state.failed.push(error.message);
    return error;
  };

  // Told of every engine start before it happens. A check is only as good as the engine it
  // ran on: #147 ran every leg but Firefox's on Chromium, under the selected browser's label.
  const onLaunch = (engine, how) => {
    if (!browsers.includes(engine)) {
      throw fail(`[${name}] ${how} of the ${engine} engine, which is not in the selection `
        + `(${browsers.join(', ')}); a leg runs on the engine it is named after`);
    }
    if (!state.ready) {
      throw fail(`[${name}] ${how} of the ${engine} engine before RUN.ready() resolved; the `
        + 'load gate comes before any browser');
    }
    launched.add(engine);
  };

  const count = (leg, n) => {
    const browser = legBrowser(leg, browsers);
    if (!browser) {
      throw new SuiteError(`[${name}] leg ${JSON.stringify(String(leg))} names none of the `
        + `selected browsers (${browsers.join(', ')}); a check must belong to a leg`);
    }
    counts.set(browser, counts.get(browser) + n);
  };

  const run = {
    name,
    browsers,
    origins,
    get playwright() {
      // Loaded on first use: parsing a selection (and refusing a bad one) needs no browser.
      if (!run.boundPlaywright) run.boundPlaywright = boundPlaywright(playwright(), { onLaunch });
      return run.boundPlaywright;
    },
    // One executed check of `leg`; the leg starts with its browser ("chromium", "webkit/http",
    // "firefox 143.0").
    tally(leg, n = 1) {
      count(leg, n);
    },
    // A finished leg and the number of checks it ran. 0 is a failure: the suite launched
    // nothing or filtered everything away, and "0 failures" would read as a pass.
    reportLeg({ leg, checks } = {}) {
      if (!(Number.isInteger(checks) && checks > 0)) {
        throw fail(`[${name}] leg ${leg} ran ${checks === undefined ? 'no' : checks} `
          + 'checks; a leg that checks nothing cannot pass');
      }
      count(leg, checks);
    },
    // A check this leg did not run, with the reason. Under CI the skip must be listed in the
    // "Declared skips" table of tests/README.md, so no check stops running there unnoticed.
    skip(leg, id, reason) {
      if (typeof id !== 'string' || !id || typeof reason !== 'string' || !reason.trim()) {
        throw new TypeError('suite.skip: an id and a reason are required');
      }
      const key = `${name}:${id}`;
      if (isCi(env)) {
        const listed = declaredSkips(fs.readFileSync(readme, 'utf8'));
        if (!listed.has(key)) {
          throw fail(`[${name}] skip \`${key}\` on ${leg} (${reason}) is not listed with a `
            + 'reason under "Declared skips" in tests/README.md; CI does not skip silently');
        }
      }
      skips.push({ leg: String(leg), id, reason });
      log(`SKIP [${leg}] ${key}: ${reason}`);
    },
    async ready(overrides = {}) {
      const gate = await loadGate({ env, label: name, log, ...overrides });
      state.ready = true;
      return gate;
    },
    counts: () => Object.fromEntries(counts),
    launched: () => [...launched],
    skips: () => skips.slice(),
    // What the process may exit with: `code` unless it would pass a run that proved nothing.
    verdict(code) {
      const problems = state.failed.slice();
      for (const [browser, n] of counts) {
        if (n === 0) {
          problems.push(`${RULE}: [${name}] ${browser} ran 0 checks; a leg that checks nothing `
            + 'cannot pass');
        } else if (!launched.has(browser)) {
          problems.push(`${RULE}: [${name}] ${browser} counted ${n} check(s) but its engine was `
            + 'never launched through RUN.playwright; they ran on another engine or on none');
        }
      }
      return { code: code === 0 && problems.length ? 1 : code, problems };
    },
  };
  return run;
}

// Open the suite's run for this process: parse the selection (exit 2 on a refusal) and hold
// the exit code to the verdict.
function open({ name, browsers, origins, defaultBrowsers, knownOrigins, defaultOrigins,
  env = process.env, playwright } = {}) {
  let run;
  try {
    const selected = select({ flag: browsers, env, envName: 'OSC_BROWSERS',
      known: KNOWN_BROWSERS, what: 'browser', fallback: defaultBrowsers });
    const selectedOrigins = knownOrigins || defaultOrigins || origins !== undefined
      ? select({ flag: origins, env, envName: 'OSC_ORIGINS',
        known: knownOrigins || KNOWN_ORIGINS, what: 'origin', fallback: defaultOrigins })
      : null;
    run = createRun({ name, browsers: selected, origins: selectedOrigins, env,
      ...(playwright ? { playwright: () => playwright } : {}) });
  } catch (error) {
    if (!(error instanceof UsageError)) throw error;
    console.error(`[${name}] ${error.message}`);
    process.exit(error.exitCode);
  }
  process.on('exit', (code) => {
    const load = Number(os.loadavg()[0]).toFixed(2);
    console.log(`[${name}] load ${load} at end`);
    if (code !== 0) return;
    const verdict = run.verdict(code);
    for (const problem of verdict.problems) console.error(`FAIL ${problem}`);
    if (verdict.code !== 0) process.exitCode = verdict.code;
  });
  return run;
}

module.exports = {
  RULE,
  KNOWN_BROWSERS,
  KNOWN_ORIGINS,
  DEFAULT_EVALUATE_MS,
  UsageError,
  SuiteError,
  parse,
  select,
  isCi,
  declaredSkips,
  loadGate,
  boundPlaywright,
  boundPage,
  createRun,
  open,
};
