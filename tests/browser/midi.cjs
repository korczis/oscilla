#!/usr/bin/env node
// OSCILLA MIDI support state (plan issue V501; ADR 0058 and its V500 note) on the built
// dist/index.html in chromium, firefox and webkit, from file:// and from the Pages-like
// sub-path http://127.0.0.1:<port>/oscilla/ (served locally on 127.0.0.1: it is not the Pages
// origin https://korczis.github.io, which this suite never loads). The one browser suite the
// M045 issues share.
//
//   node tests/browser/midi.cjs [--dist dist/index.html] [--browsers chromium,firefox,webkit]
//        [--origins file,http]   (or OSC_BROWSERS / OSC_ORIGINS through the harness)
//
// Every check belongs to one of two groups, named in its id and asserted first inside the page:
//   measured  a context with no MIDI init script: requestMIDIAccess is absent or [native code]
//             and the seam's marker is absent. Only these support a support claim; each names
//             the gate build (engine and version Playwright reports), the platform and the origin.
//   seam      a context with tests/browser/lib/midi-stub.cjs installed (the stub, or the spy that
//             only counts calls and calls through); the marker is present. These prove only that
//             the page handles a state ("handles (stubbed API)").
//
// Checks (asserted), per browser and origin:
//   midi-measured-load          the state at load is the one measured for the gate build and
//                               origin (darwin record of ADR 0058), with its exact copy
//   midi-measured-no-prompt     where the API exists, the permission query reads `prompt` both
//                               just after the load and again after the load's own read
//   midi-measured-connect       Connect MIDI where offered: Chromium settles to `denied`
//                               (NotAllowedError); Firefox over http shows `pending`, then
//                               `blocked` (SecurityError, 3-13 s); where the API is missing
//                               Connect MIDI is not offered. No error is reported by the page
//   midi-measured-grant         Chromium only: the `midi` grant reads `allowed` and Connect MIDI
//                               still ends `denied`; `midi` + `midi-sysex` reads `allowed` and
//                               resolves (`no-devices` on darwin); clearing the grant is `revoked`
//   midi-measured-stub-fidelity every member src/js/midi reads (midi-stub.cjs PAGE_READS) is held
//                               by the stub's objects as by MIDIAccess, MIDIInputMap and MIDIInput
//   midi-seam-no-request-at-load  the spy counts zero requestMIDIAccess calls after the load and
//                               at most one permission query, for `midi`; Connect MIDI then makes
//                               exactly one call, { sysex: false }
//   midi-seam-load              under the stub the page reads the query (WebKit's rejects: unknown)
//   (each midi-seam-* check below first asserts the seam group in its page, as the ones above do)
//   midi-seam-connect           by keyboard: pending, connected with the stub's self-naming device,
//                               a second input, one leaves (still connected), the last leaves
//                               (disconnected with its name), one plugs in (connected); the stub's
//                               midimessage carries a Uint8Array and a timeStamp
//   midi-seam-no-devices        a resolved access without inputs; a device plugged in connects
//   midi-seam-rejections        SecurityError blocked, NotAllowedError denied, NotSupportedError
//                               failed with the name; a newer request wins over an older one
//                               (polled until the older settlement has reached the page, and
//                               nothing listens to its access)
//
// A gate build or platform not in the record (the CI runners, ubuntu-latest) is held to the
// states the ADR allows for it and prints what it measured on a RECORD line. There a Chromium
// request still `pending` at its deadline is a recorded outcome, not a failure: the check
// asserts the pending copy, the RECORD line says "pending at the <n> ms deadline", and
// midi-measured-revoke is the declared skip (no access to withdraw). On darwin, the record,
// the same request still pending fails.
//
// Loaded as a module (tests/unit/midi), it opens no run and exports its pure judgements.
'use strict';

const path = require('node:path');
const { pathToFileURL } = require('node:url');
const suite = require('./lib/suite.cjs');
const { serveDist } = require('./lib/serve.cjs');
const { until, WaitTimeout } = require('./lib/wait.cjs');
const midiStub = require('./lib/midi-stub.cjs');

const argv = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};
const ROOT = path.resolve(__dirname, '..', '..');
const DIST = path.resolve(arg('dist', path.join(ROOT, 'dist', 'index.html')));
const RUN = require.main === module
  ? suite.open({ name: 'midi', browsers: arg('browsers'), origins: arg('origins'),
    defaultOrigins: ['file', 'http'] })
  : null;
const playwright = RUN ? RUN.playwright : null;

const LOAD_MS = 90000;       // the page has reported ready and stated a MIDI state
const SETTLE_MS = 30000;     // a request the stub or Chromium settles
const FIREFOX_MS = 60000;    // Firefox rejects after 3.0-12.9 s (32 runs, ADR 0058)
const STEP_MS = 15000;       // a state change the test drives through the stub
const DARWIN = process.platform === 'darwin';
// Off darwin (never measured) a Chromium request the platform leaves unanswered is recorded.
const PENDING_RECORDED = !DARWIN;

// The record of ADR 0058 (darwin arm64, Playwright 1.63.0): the state at load and after
// Connect MIDI without a grant. Off darwin, the states the table allows for that condition.
const MEASURED = {
  chromium: { load: { file: ['needs-permission'], http: ['needs-permission'] },
    connect: DARWIN ? ['denied'] : ['denied', 'failed'] },
  firefox: { load: { file: ['unsupported'], http: ['needs-permission'] },
    connect: ['blocked'] },
  webkit: { load: { file: ['unsupported'], http: ['unsupported'] }, connect: [] },
};
const GRANTED = DARWIN ? ['no-devices'] : ['no-devices', 'failed'];
const MIDI_ONLY = DARWIN ? ['denied'] : ['denied', 'failed'];
const SEAM_LOAD = { chromium: 'needs-permission', firefox: 'needs-permission', webkit: 'unknown' };

// ------------------------------------------------------------------------- pure judgements
/**
 * How a request's poll ended. `m` is view()'s result (`timedOut` set when `settled` was not
 * reached by the deadline). With `pendingRecorded`, a request still `pending` at the deadline
 * is an accepted, recorded outcome ({ ok: true, pending: true }); without it, a failure.
 */
function judgeSettled(m, settled, { pendingRecorded = false } = {}) {
  if (!m.timedOut && settled.includes(m.state)) return { ok: true, pending: false };
  if (pendingRecorded && m.timedOut && m.state === 'pending') return { ok: true, pending: true };
  return { ok: false, pending: false };
}

/**
 * midi-measured-no-prompt: null where the page has no API (it queried nothing); otherwise the
 * query must read `prompt` just after the load and again after it.
 */
function judgeNoPrompt(atLoad, after) {
  if (atLoad.api !== 'function') return null;
  return { ok: atLoad.query === 'prompt' && after.query === 'prompt',
    detail: `${atLoad.query} after the load, then ${after.query}` };
}

/** What a RECORD line says the origin was: never the Pages origin itself. */
function originLabel(origin, url) {
  if (origin === 'file') return `file:// (${url})`;
  return `${url} (the Pages-like sub-path served locally on 127.0.0.1, `
    + 'not the Pages origin https://korczis.github.io)';
}

let midiText;
let failures = 0;
let passes = 0;

function check(leg, id, name, ok, detail = '') {
  RUN.tally(leg);
  if (ok) passes += 1; else failures += 1;
  console.log(`  ${ok ? 'PASS' : 'FAIL'} [${leg}] ${id}: ${name}${detail ? ` — ${detail}` : ''}`);
  return ok;
}

// ------------------------------------------------------------------------------ page helpers
async function openPage(browser, url, { init, permissions } = {}) {
  const context = await browser.newContext(permissions ? { permissions } : {});
  if (init) await context.addInitScript(init.fn, init.arg);
  const page = await context.newPage();
  page.setDefaultTimeout(30000);
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
  await page.goto(url, { waitUntil: 'load' });
  await until(() => page.evaluate(() => {
    const el = document.querySelector('[data-osc="midi.status"]');
    return document.documentElement.dataset.ready === 'true' && !!el && !!el.dataset.midiState;
  }), { ms: LOAD_MS, what: `${url}: the page is ready and states a MIDI support state` });
  return { context, page, errors };
}

const readMidi = (page) => page.evaluate(() => {
  const el = document.querySelector('[data-osc="midi.status"]');
  const btn = document.querySelector('[data-osc="midi.connect"]');
  const row = document.querySelector('[data-osc="midi.actions"]');
  const app = window.OSCILLA && window.OSCILLA.engine;
  return { state: el.dataset.midiState || null, text: el.textContent.trim(),
    // Offered: the button and its whole actions row are shown (the row is what x-show hides).
    offered: !!btn && !!row && row.contains(btn) && row.style.display !== 'none'
      && btn.style.display !== 'none',
    lastError: app && app.lastError ? app.lastError.message : null,
    alerts: document.querySelectorAll('[data-osc="alerts"] .osc-toast').length };
});

// What the page itself can see of MIDI: which group this context is in, and the platform.
const probe = (page) => page.evaluate(async () => {
  const fn = navigator.requestMIDIAccess;
  let query;
  try {
    const s = await navigator.permissions.query({ name: 'midi' });
    query = s.state;
  } catch (e) {
    query = `rejects ${e && e.name}`;
  }
  return {
    secure: window.isSecureContext,
    api: typeof fn,
    native: typeof fn === 'function'
      && Function.prototype.toString.call(fn).includes('[native code]'),
    marker: window.__oscMidiSeam ? window.__oscMidiSeam.kind : null,
    midiAccess: typeof MIDIAccess,
    query,
  };
});

function inGroup(p, group) {
  if (group === 'measured') return !p.marker && (p.api === 'undefined' || p.native);
  return !!p.marker && !p.native;
}

async function assertGroup(leg, id, page, group) {
  const p = await probe(page);
  check(leg, id, `runs in the ${group} group`, inGroup(p, group), JSON.stringify(p));
  return p;
}

async function openSettings(page) {
  await page.locator('[data-osc="action.settings"]').click();
  await until(() => page.evaluate(() => document.getElementById('osc-dlg-settings').open),
    { ms: STEP_MS, what: 'the Settings dialog opens' });
}

// The MIDI view once `pred` holds, polled against a named deadline; on expiry the view as it
// is, with the timeout, so the check that judges it fails with what the page showed.
async function view(page, pred, what, ms = STEP_MS) {
  try {
    return await until(async () => {
      const m = await readMidi(page);
      return pred(m) ? m : null;
    }, { ms, what });
  } catch (error) {
    if (!(error instanceof WaitTimeout)) throw error;
    return { ...await readMidi(page), timedOut: error.message };
  }
}

const stateIs = (page, states, what, ms = STEP_MS) => view(page,
  (m) => states.includes(m.state), what, ms);

const seam = (page, fn, ...a) => page.evaluate(([f, args]) => window.__oscMidiSeam[f](...args),
  [fn, a]);

// ----------------------------------------------------------------------------- measured group
// A request's poll: settled where it ends in `settled`, else what judgeSettled makes of it.
async function settle(page, leg, settled, what, ms, pendingRecorded) {
  const m = await view(page, (v) => settled.includes(v.state), what, ms);
  return { m, g: judgeSettled(m, settled, { pendingRecorded }) };
}

async function measured(browser, b, origin, url, site) {
  const leg = `${b}/${origin}`;
  const build = `gate build ${b} ${browser.version()}, ${process.platform} ${process.arch}, `
    + `${origin}`;
  const where = originLabel(origin, url);
  const expected = MEASURED[b];
  const lenient = b === 'chromium' && PENDING_RECORDED;
  const pendingAt = (ms) => `pending at the ${ms} ms deadline`;

  // midi-measured-load, midi-measured-no-prompt
  {
    const id = 'midi-measured-load';
    const { context, page, errors } = await openPage(browser, url);
    try {
      const p = await assertGroup(leg, id, page, 'measured');
      const m = await view(page, (v) => v.offered === (p.api === 'function'),
        `${leg}: Connect MIDI is offered exactly where the API is`);
      console.log(`  RECORD [${leg}] ${JSON.stringify({ build, origin: where, ...p,
        state: m.state })}`);
      check(leg, id, `${build}: the state at load is ${expected.load[origin].join(' or ')}`,
        expected.load[origin].includes(m.state) && p.secure === true, m.state);
      check(leg, id, `${build}: the copy is the ADR's`, m.text === midiText(m.state, { site }),
        m.text);
      const np = judgeNoPrompt(p, await probe(page));
      if (np) {
        check(leg, 'midi-measured-no-prompt', `${build}: where the API exists the query reads `
          + 'prompt after the load, and still does', np.ok, np.detail);
      }
      check(leg, id, `${build}: Connect MIDI is offered exactly where the API is`,
        m.offered === (p.api === 'function'), JSON.stringify(m));
      check(leg, id, 'no console or page error at load', errors.length === 0, errors.join(' | '));
    } finally {
      await context.close();
    }
  }

  // midi-measured-connect
  {
    const id = 'midi-measured-connect';
    const { context, page, errors } = await openPage(browser, url);
    try {
      await assertGroup(leg, id, page, 'measured');
      await openSettings(page);
      const before = await readMidi(page);
      if (!before.offered) {
        check(leg, id, `${build}: Connect MIDI is not offered (${before.state})`,
          ['unsupported', 'insecure'].includes(before.state)
            && await page.locator('[data-osc="midi.connect"]').isHidden()
            && await page.locator('[data-osc="midi.actions"]').isHidden(), before.state);
      } else {
        const t0 = Date.now();
        await page.locator('[data-osc="midi.connect"]').click();
        if (b === 'firefox') {
          const p = await stateIs(page, ['pending', ...expected.connect],
            `${leg}: Firefox states pending after Connect MIDI`);
          check(leg, id, `${build}: pending while the browser has not answered`,
            p.state === 'pending' && p.text === midiText('pending', { site }),
            `${p.state} after ${Date.now() - t0} ms`);
        }
        const ms = b === 'firefox' ? FIREFOX_MS : SETTLE_MS;
        const { m, g } = await settle(page, leg, expected.connect,
          `${leg}: the request settles to ${expected.connect.join(' or ')}`, ms, lenient);
        const after = await probe(page);
        console.log(`  RECORD [${leg}] ${JSON.stringify({ build, origin: where,
          connect: g.pending ? pendingAt(ms) : m.state, ms: Date.now() - t0,
          query: after.query })}`);
        if (g.pending) {
          check(leg, id, `${build}: Connect MIDI is still ${pendingAt(ms)} (recorded off darwin), `
            + 'with the ADR\'s copy', m.text === midiText('pending', { site }), m.text);
        } else {
          const copyOk = m.state === 'failed'
            ? /^MIDI could not start on this computer \(the browser reported \w+\)\.$/.test(m.text)
            : m.text === midiText(m.state, { site });
          check(leg, id, `${build}: Connect MIDI ends ${m.state}, with the ADR's copy`,
            g.ok && copyOk, `${m.text} (${Date.now() - t0} ms)`);
        }
        check(leg, id, `${build}: the query no longer chooses the state (reads ${after.query})`,
          after.query === 'prompt', after.query);
      }
      const end = await readMidi(page);
      check(leg, id, 'the page reports no error and raises no notification for MIDI',
        !end.lastError && end.alerts === 0 && errors.length === 0,
        JSON.stringify({ lastError: end.lastError, alerts: end.alerts, errors }));
    } finally {
      await context.close();
    }
  }

  // midi-measured-grant
  if (b !== 'chromium') {
    RUN.skip(leg, 'midi-measured-grant', `${b}: Playwright's midi permission grants change the `
      + 'outcome in Chromium only (Firefox refuses the names; WebKit has no Web MIDI)');
  } else {
    const id = 'midi-measured-grant';
    {
      const { context, page } = await openPage(browser, url, { permissions: ['midi'] });
      try {
        await assertGroup(leg, id, page, 'measured');
        const m = await readMidi(page);
        check(leg, id, `${build}: the midi grant reads allowed at load`,
          m.state === 'allowed' && m.text === midiText('allowed', { site }), m.text);
        await openSettings(page);
        await page.locator('[data-osc="midi.connect"]').click();
        const { m: r, g } = await settle(page, leg, MIDI_ONLY, `${leg}: midi alone settles`,
          SETTLE_MS, lenient);
        console.log(`  RECORD [${leg}] ${JSON.stringify({ build, origin: where,
          midiOnly: g.pending ? pendingAt(SETTLE_MS) : r.state })}`);
        check(leg, id, `${build}: midi alone still ends `
          + `${g.pending ? pendingAt(SETTLE_MS) : r.state}`, g.ok
          && (!g.pending || r.text === midiText('pending', { site })), r.text);
      } finally {
        await context.close();
      }
    }
    const { context, page } = await openPage(browser, url,
      { permissions: ['midi', 'midi-sysex'] });
    try {
      await assertGroup(leg, id, page, 'measured');
      const m = await readMidi(page);
      check(leg, id, `${build}: midi + midi-sysex reads allowed at load`, m.state === 'allowed',
        m.text);
      await openSettings(page);
      await page.locator('[data-osc="midi.connect"]').click();
      const { m: r, g } = await settle(page, leg, GRANTED, `${leg}: the granted request settles`,
        SETTLE_MS, lenient);
      const outcome = g.pending ? pendingAt(SETTLE_MS) : r.state;
      console.log(`  RECORD [${leg}] ${JSON.stringify({ build, origin: where, granted: outcome,
        text: r.text })}`);
      if (g.pending) {
        check(leg, id, `${build}: the granted request is still ${outcome} (recorded off darwin), `
          + 'with the ADR\'s copy', r.text === midiText('pending', { site }), r.text);
      } else {
        check(leg, id, `${build}: the granted request ends ${r.state}`, g.ok
          && (r.state !== 'no-devices' || r.text === midiText('no-devices', { site })), r.text);
      }
      if (g.ok && r.state === 'no-devices') {
        await context.clearPermissions();
        const v = await stateIs(page, ['revoked'], `${leg}: a cleared grant is revoked`);
        check(leg, id, `${build}: clearing the grant reads revoked`,
          v.text === midiText('revoked', { site }), v.text);
      } else {
        RUN.skip(leg, 'midi-measured-revoke', `${build}: the granted request `
          + `${g.pending ? `was still ${outcome}` : `ended ${r.state}`}, so there is no access `
          + 'to withdraw');
      }
    } finally {
      await context.close();
    }
  }

  // midi-measured-stub-fidelity
  {
    const id = 'midi-measured-stub-fidelity';
    const { context, page } = await openPage(browser, url);
    try {
      const p = await probe(page);
      if (p.midiAccess !== 'function') {
        RUN.skip(leg, 'midi-measured-stub-fidelity',
          `${build}: no MIDIAccess interface to compare the stub with`);
      } else {
        check(leg, id, 'runs in the measured group', inGroup(p, 'measured'), JSON.stringify(p));
        const rows = await page.evaluate(midiStub.install,
          { dry: true, reads: midiStub.PAGE_READS });
        const off = rows.filter((r) => r.stub === 'missing' || r.stub !== r.real);
        check(leg, id, `${build}: the stub holds every member the page reads as the real `
          + 'interface does', rows.length > 0 && off.length === 0,
        JSON.stringify(off.length ? off : rows.map((r) => `${r.member}:${r.real}`)));
        const q = await probe(page);
        check(leg, id, 'the comparison installed nothing', inGroup(q, 'measured'),
          JSON.stringify(q));
      }
    } finally {
      await context.close();
    }
  }
}

// --------------------------------------------------------------------------------- seam group
async function seamChecks(browser, b, origin, url, site) {
  const leg = `${b}/${origin}`;
  const loadState = MEASURED[b].load[origin];

  // midi-seam-no-request-at-load (the spy calls through: the platform's own state)
  {
    const id = 'midi-seam-no-request-at-load';
    const { context, page } = await openPage(browser, url, { init: { fn: midiStub.spy } });
    try {
      const counts = await seam(page, 'counts'); // before probe(), whose own query is counted
      const p = await probe(page);
      check(leg, id, 'runs in the seam group (spy)', p.marker === 'spy'
        && (p.api === 'undefined' || !p.native), JSON.stringify(p));
      const m = await readMidi(page);
      const queriesExpected = p.api === 'function' ? 1 : 0;
      check(leg, id, 'loading the page calls requestMIDIAccess zero times',
        counts.requests.length === 0, JSON.stringify(counts));
      check(leg, id, `loading queries the midi permission ${queriesExpected} time(s) and nothing `
        + 'else', counts.queries.filter((n) => n === 'midi').length === queriesExpected
          && counts.queries.every((n) => n === 'midi'), JSON.stringify(counts.queries));
      check(leg, id, `handles (spied API): the state is the platform's (${m.state})`,
        loadState.includes(m.state), m.state);
      if (m.offered) {
        await openSettings(page);
        await page.locator('[data-osc="midi.connect"]').click();
        const after = await until(async () => {
          const c = await seam(page, 'counts');
          return c.requests.length ? c : null;
        }, { ms: STEP_MS, what: `${leg}: Connect MIDI calls requestMIDIAccess` });
        check(leg, id, 'Connect MIDI, the explicit action, calls it once with { sysex: false }',
          JSON.stringify(after.requests) === JSON.stringify([{ sysex: false }]),
          JSON.stringify(after.requests));
      }
    } finally {
      await context.close();
    }
  }

  const { context, page, errors } = await openPage(browser, url,
    { init: { fn: midiStub.install, arg: {} } });
  try {
    // midi-seam-load
    {
      const id = 'midi-seam-load';
      await assertGroup(leg, id, page, 'seam');
      const m = await view(page, (v) => v.state === SEAM_LOAD[b] && v.offered,
        `${leg}: the stubbed page states ${SEAM_LOAD[b]} and offers Connect MIDI`);
      check(leg, id, `handles (stubbed API): the query chooses ${SEAM_LOAD[b]} at load`,
        m.state === SEAM_LOAD[b] && m.text === midiText(SEAM_LOAD[b], { site }) && m.offered,
        m.text);
      check(leg, id, 'loading makes no request', (await seam(page, 'calls')).length === 0);
    }

    // midi-seam-connect (by keyboard)
    {
      const id = 'midi-seam-connect';
      await assertGroup(leg, id, page, 'seam');
      const NAME = midiStub.STUB_NAME;
      const SECOND = `${NAME} 2`;
      const THIRD = `${NAME} 3`;
      await openSettings(page);
      await page.locator('[data-osc="midi.connect"]').focus();
      await page.keyboard.press('Enter');
      const p = await stateIs(page, ['pending'], `${leg}: Enter on Connect MIDI states pending`);
      check(leg, id, 'handles (stubbed API): Enter on Connect MIDI asks once, { sysex: false }, '
        + 'and states pending', p.text === midiText('pending', { site })
          && JSON.stringify(await seam(page, 'calls')) === JSON.stringify([{ sysex: false }]),
      JSON.stringify(await seam(page, 'calls')));
      await seam(page, 'resolve', 0, [NAME]);
      const c = await stateIs(page, ['connected'], `${leg}: the stub device connects`);
      check(leg, id, 'handles (stubbed API): connected names the self-naming stub device',
        c.text === `MIDI is on: ${NAME}.`, c.text);
      await seam(page, 'plug', SECOND);
      const two = await view(page, (m) => m.text === `MIDI is on: ${NAME}, ${SECOND}.`,
        `${leg}: a second input is listed`);
      check(leg, id, 'handles (stubbed API): a second input joins the names', !two.timedOut,
        two.text);
      await seam(page, 'unplug', NAME);
      const one = await view(page, (m) => m.text === `MIDI is on: ${SECOND}.`,
        `${leg}: one of two inputs leaves`);
      check(leg, id, 'handles (stubbed API): one of two leaves, still connected',
        !one.timedOut && one.state === 'connected', one.text);
      await seam(page, 'unplug', SECOND);
      const d = await stateIs(page, ['disconnected'], `${leg}: the last input leaves`);
      check(leg, id, 'handles (stubbed API): the last leaves, disconnected with its name',
        d.text === midiText('disconnected', { name: SECOND }), d.text);
      await seam(page, 'plug', THIRD);
      const back = await stateIs(page, ['connected'], `${leg}: a device plugged in connects`);
      check(leg, id, 'handles (stubbed API): a device plugged in after it connects',
        back.text === `MIDI is on: ${THIRD}.`, back.text);
      const msg = await page.evaluate((name) => {
        let got = null;
        const port = window.__oscMidiSeam.port(name);
        port.addEventListener('midimessage', (e) => {
          got = { data: [...e.data], u8: e.data instanceof Uint8Array, ts: typeof e.timeStamp };
        });
        window.__oscMidiSeam.message(name, [0x90, 60, 100]);
        return got;
      }, THIRD);
      check(leg, id, 'the stub input dispatches midimessage with a Uint8Array and a timeStamp',
        !!msg && msg.u8 && msg.ts === 'number' && msg.data.join() === '144,60,100',
        JSON.stringify(msg));
    }

    // midi-seam-no-devices
    {
      const id = 'midi-seam-no-devices';
      await assertGroup(leg, id, page, 'seam');
      await page.locator('[data-osc="midi.connect"]').click();
      await stateIs(page, ['pending'], `${leg}: Connect MIDI again starts a new request`);
      await seam(page, 'resolve', 1, []);
      const n = await stateIs(page, ['no-devices'], `${leg}: an access without inputs`);
      check(leg, id, 'handles (stubbed API): an access without inputs reads no-devices',
        n.text === midiText('no-devices', { site }), n.text);
      await seam(page, 'plug', midiStub.STUB_NAME);
      const c = await stateIs(page, ['connected'], `${leg}: a device after no-devices`);
      check(leg, id, 'handles (stubbed API): a device plugged in connects',
        c.text === `MIDI is on: ${midiStub.STUB_NAME}.`, c.text);
    }

    // midi-seam-rejections
    {
      const id = 'midi-seam-rejections';
      await assertGroup(leg, id, page, 'seam');
      let i = 2;
      for (const [name, state] of [['SecurityError', 'blocked'], ['NotAllowedError', 'denied'],
        ['NotSupportedError', 'failed']]) {
        await page.locator('[data-osc="midi.connect"]').click();
        await stateIs(page, ['pending'], `${leg}: request ${i} is pending`);
        await seam(page, 'reject', i, name);
        const r = await stateIs(page, [state], `${leg}: ${name} reads ${state}`);
        check(leg, id, `handles (stubbed API): ${name} reads ${state}`,
          r.text === midiText(state, { site, error: name }), r.text);
        i += 1;
      }
      await page.locator('[data-osc="midi.connect"]').click();
      await page.locator('[data-osc="midi.connect"]').click();
      await until(async () => (await seam(page, 'calls')).length === i + 2,
        { ms: STEP_MS, what: `${leg}: two more requests are made` });
      await seam(page, 'reject', i + 1, 'NotAllowedError');
      await stateIs(page, ['denied'], `${leg}: the newer request is denied`);
      await seam(page, 'resolve', i, [midiStub.STUB_NAME]);
      // The condition: the older request's settlement has reached the page (every reaction the
      // page attached to it has run), polled against a named deadline; only then is it judged.
      await until(() => seam(page, 'delivered', i),
        { ms: STEP_MS, what: `${leg}: the older request's resolution reaches the page` });
      const last = await readMidi(page);
      const stale = await seam(page, 'listening', i);
      check(leg, id, 'handles (stubbed API): an older request that resolves later is ignored',
        last.state === 'denied' && stale === 0,
        `${last.state}; ${stale} statechange listener(s) on the older access`);
      check(leg, id, 'the page reports no error and raises no notification for MIDI',
        !last.lastError && last.alerts === 0 && errors.length === 0,
        JSON.stringify({ lastError: last.lastError, alerts: last.alerts, errors }));
    }
  } finally {
    await context.close();
  }
}

// ----------------------------------------------------------------------------------- the run
async function main() {
  ({ midiText } = await import(pathToFileURL(path.join(ROOT, 'src', 'js', 'midi',
    'support.js')).href));
  await RUN.ready();
  const server = RUN.origins.includes('http') ? await serveDist(DIST, { prefix: 'oscilla-midi-' })
    : null;
  try {
    for (const b of RUN.browsers) {
      const browser = await playwright[b].launch();
      console.log(`\n${b} (${browser.version()})`);
      try {
        for (const origin of RUN.origins) {
          const url = origin === 'http' ? server.url : pathToFileURL(DIST).href;
          const site = origin === 'http' ? new URL(server.url).host : 'this page';
          console.log(`  origin [${b}/${origin}] ${originLabel(origin, url)}`);
          try {
            await measured(browser, b, origin, url, site);
            await seamChecks(browser, b, origin, url, site);
          } catch (err) {
            check(`${b}/${origin}`, 'midi-run', 'run completed', false, err && err.stack);
          }
        }
      } finally {
        await browser.close();
      }
    }
  } finally {
    if (server) server.close();
  }
  console.log(`\n${failures ? `${failures} FAILURE(S)` : 'ALL PASS'} (${passes} checks passed)`);
  process.exit(failures ? 1 : 0);
}

if (require.main === module) main().catch((e) => { console.error(e); process.exit(1); });

module.exports = { judgeSettled, judgeNoPrompt, originLabel, MEASURED, GRANTED, MIDI_ONLY };
