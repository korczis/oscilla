// H002: a saved continuous repeat that restores as once says so on every restore path.
//
// Continuous playback is a per-page-view permission (ADR 0004, 0005) and is never restored
// (url-state.js header, project.no-fake-science). A record saved with repeat 'continuous'
// therefore restores as 'once'. Before H002 that happened with 0 issues and no notice on the
// preset, History, config import and link paths (repro persist-2 of the G1 coherence contract);
// the link even said "Configuration restored from link". Each restore entry now names the drop
// in its result (`dropped`) and in a notice beside the existing "Binaural mode not restored".
//
//   node --test tests/unit/restore-notices.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';

import { applyConfig } from '../../src/js/core/config.js';
import { restoreFromHash, serializeHash } from '../../src/js/core/url-state.js';
import { createInstrument } from '../../src/js/core/instrument.js';
import * as configFile from '../../src/js/ui/config-file.js';

const SR = 48000;
const DROP_TITLE = 'Continuous repeat not restored';
const DROP_TEXT = /^Continuous repeat saved; it plays once\. /;

/** A saved sweep record (the instrument part of a preset, history entry, file or link). */
const sweepRecord = (repeat) => ({
  source: 'sweep', pattern: 'tone', waveform: 'sine', frequency: 440,
  sweep: { start: 100, end: 1000, durationMs: 2000, curve: 'log', direction: 'up', repeat,
    repeatCount: 3 },
});

/** An instrument at a known rate, with its alerts; never with the continuous permission. */
function instrument(hash = '') {
  const app = createInstrument({ engine: null, location: { hash, href: '', search: '' },
    timers: { setTimeout: () => 0, clearTimeout() {}, setInterval: () => 0, clearInterval() {} } });
  app.sampleRate = SR;
  return app;
}
const titles = (list) => list.map((n) => n.title);
const named = (list) => list.some((n) => n.title === DROP_TITLE && DROP_TEXT.test(n.message));
const droppedRepeat = (r) => (r.dropped || []).some((d) => d.key === 'sweep.repeat'
  && d.saved === 'continuous' && d.applied === 'once' && /continuous repeat/.test(d.label));

/** The link of a continuous sweep, as Copy config URL writes it. */
function continuousLink() {
  const saved = applyConfig(null, sweepRecord('continuous'),
    { sampleRate: SR, continuousAllowed: true }).state;
  assert.equal(saved.sweep.repeat, 'continuous', 'the source state holds a continuous repeat');
  return `#${serializeHash(saved, 'sweep')}`;
}

/** The config file a continuous sweep exports to (buildConfigExport, as exportConfigDoc). */
function continuousFile() {
  const doc = configFile.buildConfigExport({ oscillaVersion: 'test', sampleRate: SR,
    mode: 'sweep', workspace: 'sweep', instrument: sweepRecord('continuous'), now: new Date(0) });
  assert.equal(doc.pattern.sweep.repeat, 'continuous', 'the file holds a continuous repeat');
  return configFile.parseConfigImport(JSON.stringify(doc));
}

// -------------------------------------------------------------- the pure restore entries

for (const origin of ['preset', 'history', 'import']) {
  test(`${origin}: a continuous repeat restored as once is named as dropped, with its notice`,
    () => {
      const r = applyConfig(null, sweepRecord('continuous'), { sampleRate: SR, origin });
      assert.equal(r.state.sweep.repeat, 'once', 'the permission is not restored (ADR 0005)');
      assert.ok(droppedRepeat(r), `dropped names continuous repeat: ${JSON.stringify(r.dropped)}`);
      assert.ok(named(r.notices), `the notice says so: ${JSON.stringify(titles(r.notices))}`);
    });
}

test('link: the drop is in the result, its notice, and the restore summary', () => {
  const r = restoreFromHash(null, continuousLink(), { sampleRate: SR });
  assert.equal(r.handled, true);
  assert.equal(r.state.sweep.repeat, 'once');
  assert.ok(droppedRepeat(r), `dropped names continuous repeat: ${JSON.stringify(r.dropped)}`);
  assert.ok(named(r.notices), JSON.stringify(titles(r.notices)));
  // "Configuration restored" never stands alone over a drop.
  for (const n of r.notices.filter((x) => /Configuration restored/.test(x.title))) {
    assert.match(n.message, /continuous repeat/i, `the summary names the drop: ${n.message}`);
  }
});

// -------------------------------------------------------------- the instrument's entries

test('preset: loading a saved continuous sweep shows the drop beside "Loaded"', () => {
  const app = instrument();
  app.applyPreset({ id: 'u1', name: 'Continuous sweep', cfg: sweepRecord('continuous') });
  assert.equal(app.sweep.repeat, 'once');
  assert.equal(app.continuousAllowed, false, 'a preset never grants the permission');
  assert.ok(named(app.alerts), JSON.stringify(titles(app.alerts)));
  assert.ok(app.alerts.some((a) => a.title === 'Loaded “Continuous sweep”'));
});

test('History: recalling a continuous sweep shows the drop beside "Recalled"', () => {
  const app = instrument();
  app.recallHistory({ label: 'Sweep 100 Hz → 1 kHz', cfg: sweepRecord('continuous') });
  assert.equal(app.sweep.repeat, 'once');
  assert.equal(app.continuousAllowed, false, 'History never grants the permission');
  assert.ok(named(app.alerts), JSON.stringify(titles(app.alerts)));
});

test('config import: the file restores once, says so, and is never "All settings restored"',
  () => {
    const parsed = continuousFile();
    assert.equal(parsed.ok, true, JSON.stringify(parsed.errors));
    const app = instrument();
    app.applyConfig(parsed.instrument, 'import');
    assert.equal(app.sweep.repeat, 'once');
    assert.equal(app.continuousAllowed, false, 'an import never grants the permission');
    assert.ok(named(app.alerts), JSON.stringify(titles(app.alerts)));
    // The summary main.js applyImport + workbench.importConfigText show after the import.
    assert.equal(typeof configFile.importSummary, 'function', 'config-file.js importSummary');
    const r = instrument().restoreConfig(parsed.instrument, 'import');
    assert.ok(droppedRepeat(r), JSON.stringify(r.dropped));
    const n = configFile.importSummary({ invalid: 0, dropped: r.dropped });
    assert.doesNotMatch(n.message, /All settings were restored/);
    assert.match(n.message, /Not restored: continuous repeat/);
    assert.notEqual(n.level, 'success');
    const both = configFile.importSummary({ invalid: 2, dropped: r.dropped });
    assert.equal(both.level, 'warning');
    assert.match(both.message, /^2 value\(s\) were invalid.*Not restored: continuous repeat\.$/);
  });

test('link: opening a continuous sweep link shows the drop and a summary that names it', () => {
  const app = instrument(continuousLink());
  app.restoreFromHash();
  assert.equal(app.sweep.repeat, 'once');
  assert.equal(app.continuousAllowed, false, 'a link never grants the permission');
  assert.ok(named(app.alerts), JSON.stringify(titles(app.alerts)));
  const summary = app.alerts.find((a) => a.title === 'Configuration restored from link');
  assert.ok(summary, JSON.stringify(titles(app.alerts)));
  assert.match(summary.message, /^Not restored: continuous repeat\. Nothing plays until/);
});

// -------------------------------------------------------------- negative cases

test('a record saved as once restores with no drop and no notice on every path', () => {
  for (const origin of ['preset', 'history', 'import']) {
    const r = applyConfig(null, sweepRecord('once'), { sampleRate: SR, origin });
    assert.equal(r.state.sweep.repeat, 'once');
    assert.deepEqual(r.dropped, [], origin);
    assert.deepEqual(r.notices, [], origin);
  }
  const once = applyConfig(null, sweepRecord('once'), { sampleRate: SR }).state;
  const h = restoreFromHash(null, `#${serializeHash(once, 'sweep')}`, { sampleRate: SR });
  assert.deepEqual(h.dropped, []);
  assert.deepEqual(h.notices.map((n) => [n.title, n.message]), [['Configuration restored from link',
    'Nothing plays until you press HOLD TO PLAY or TRIGGER.']], 'the link summary is unchanged');
  const app = instrument();
  app.applyPreset({ id: 'u2', name: 'Once', cfg: sweepRecord('once') });
  assert.deepEqual(titles(app.alerts), ['Loaded “Once”']);
});

test('with the permission given in this page view, continuous is kept and nothing is dropped',
  () => {
    const r = applyConfig(null, sweepRecord('continuous'),
      { sampleRate: SR, continuousAllowed: true, origin: 'history' });
    assert.equal(r.state.sweep.repeat, 'continuous');
    assert.deepEqual(r.dropped, []);
    assert.deepEqual(r.notices, []);
  });

test('no restore path grants continuous permission (ADR 0005)', () => {
  const app = instrument(`${continuousLink()}&continuousAllowed=true&c=1`);
  app.restoreFromHash();
  app.applyPreset({ id: 'u3', name: 'P', cfg: { ...sweepRecord('continuous'),
    continuousAllowed: true } });
  app.recallHistory({ label: 'H', cfg: { ...sweepRecord('continuous'), continuousAllowed: true } });
  app.applyConfig({ ...sweepRecord('continuous'), continuousAllowed: true }, 'import');
  assert.equal(app.continuousAllowed, false);
  assert.equal(app.sweep.repeat, 'once');
});

test('the binaural notice is unchanged, and binaural is reported as dropped', () => {
  const r = applyConfig(null, { dual: { binaural: true, stereo: true } }, { origin: 'hash' });
  assert.equal(r.state.dual.binaural, false);
  assert.deepEqual(r.notices.map((n) => [n.level, n.title, n.message]), [['info',
    'Binaural mode not restored', 'Confirm headphone use in DUAL OSC to enable the binaural demo.']]);
  assert.deepEqual(r.dropped.map((d) => d.key), ['dual.binaural']);
  // A preset asks for the headphone confirmation before it applies: no notice, no drop.
  const p = applyConfig(null, { dual: { binaural: true } }, { origin: 'preset' });
  assert.deepEqual(p.notices, []);
  assert.deepEqual(p.dropped, []);
});

test('limited names the values lowered to a limit, the link gain among them', () => {
  const r = applyConfig(null, { source: 'sweep', sweep: { start: 100, end: 30000 } },
    { sampleRate: SR });
  assert.deepEqual(r.limited.map((l) => l.key), ['sweep.end']);
  assert.ok(r.limited[0].applied < 30000);
  const h = restoreFromHash(null, '#v=1&f=440&g=0.25', { sampleRate: SR });
  assert.deepEqual(h.limited, [{ key: 'gain', saved: 0.25, applied: 0.08 }]);
  assert.deepEqual(h.dropped, []);
});

// The notice says only what is true (project.no-fake-science): allowing continuous playback
// does not bring a dropped repeat back (setContinuous changes the permission, never the repeat,
// and no control chooses the repeat), so the notice never says the sweep "plays once until
// continuous playback is allowed again". Restoring the same record again with the permission
// given keeps continuous; a link carries no permission, and its notice promises no re-load.
test('the drop notice promises only what restores continuous repeat', () => {
  const restore = {
    preset: (app, cfg) => app.applyPreset({ id: 'u4', name: 'Continuous sweep', cfg }),
    history: (app, cfg) => app.recallHistory({ label: 'Sweep', cfg }),
    import: (app, cfg) => app.applyConfig(cfg, 'import'),
  };
  for (const [origin, again] of Object.entries(restore)) {
    const app = instrument();
    again(app, sweepRecord('continuous'));
    const n = app.alerts.find((a) => a.title === DROP_TITLE);
    assert.ok(n, `${origin}: ${JSON.stringify(titles(app.alerts))}`);
    assert.doesNotMatch(n.message, /until continuous playback is allowed/, origin);
    assert.match(n.message, /allow continuous playback in Playback safety, then load it again/,
      origin);
    app.setContinuous(true);
    assert.equal(app.sweep.repeat, 'once', `${origin}: allowing alone does not bring it back`);
    app.alerts = [];
    again(app, sweepRecord('continuous'));
    assert.equal(app.sweep.repeat, 'continuous', `${origin}: loading it again with permission`);
    assert.ok(!app.alerts.some((a) => a.title === DROP_TITLE), `${origin}: nothing dropped`);
  }
  const app = instrument(continuousLink());
  app.restoreFromHash();
  const n = app.alerts.find((a) => a.title === DROP_TITLE);
  assert.ok(n, JSON.stringify(titles(app.alerts)));
  assert.doesNotMatch(n.message, /until continuous playback is allowed|load it again/);
  assert.match(n.message, /A link never carries the permission to play continuously\.$/);
  app.setContinuous(true);
  assert.equal(app.sweep.repeat, 'once', 'allowing alone does not bring the link repeat back');
});
