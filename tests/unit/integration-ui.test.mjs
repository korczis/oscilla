// Pure parts of the integration layer: config file schema, workbench helpers, scope ticks,
// the typing guard and the render-length rule of the WAV export.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  buildConfigExport, parseConfigImport, exportFileName, CONFIG_FILE_VERSION,
} from '../../src/js/ui/config-file.js';
import { groupedHz, v1ModeFor, workspaceForV1Mode } from '../../src/js/ui/workbench.js';
import { scopeTickStep } from '../../src/js/ui/p5-views.js';
import { isTypingTarget } from '../../src/js/ui/dialogs.js';
import { renderLengthFor, EXPORT_MAX_S } from '../../src/js/ui/exporters.js';
import { OSCILLA_VERSION } from '../../src/js/ui/version.js';
import { BUILD } from '../../src/js/core/build-info.js';
import { APP_VERSION } from '../../src/js/core/constants.js';
import { applyConfig, defaultInstrumentState } from '../../src/js/core/config.js';
import { serializeConfig } from '../../src/js/core/url-state.js';

const PKG_VERSION = JSON.parse(
  readFileSync(new URL('../../package.json', import.meta.url), 'utf8')).version;

const instrumentCfg = () => {
  const s = { ...defaultInstrumentState(), frequency: 15500, waveform: 'square', gainLevel: 0.05 };
  const cfg = serializeConfig(s);
  cfg.dual = { ...s.dual, a: { ...s.dual.a, freq: 300 } };
  cfg.sweep = s.sweep;
  return cfg;
};

test('versions: the product version comes from build-info, apart from the V1 APP_VERSION', () => {
  // Under node there is no metadata region and no esbuild define: the dev fallback applies.
  // tests/unit/version-authority.test.mjs proves the region/define path against package.json.
  assert.equal(OSCILLA_VERSION, BUILD.version);
  assert.equal(BUILD.origin, 'fallback');
  assert.notEqual(OSCILLA_VERSION, APP_VERSION);
  assert.equal(APP_VERSION, '1.0.0');
});

test('config export carries every spec key and no runtime objects', () => {
  const doc = buildConfigExport({
    oscillaVersion: OSCILLA_VERSION, sampleRate: 48000, mode: 'playground', workspace: 'filter',
    instrument: instrumentCfg(),
    envelope: { enabled: true, a: 0.01, d: 0.1, s: 0.6, r: 0.3 },
    filter: { enabled: true, type: 'highpass', frequency: 1000, Q: 0.7, gain: 0 },
    sequencer: { version: 1, tempoBpm: 120, blocks: [] },
    additive: { enabled: false, partials: [{ n: 1, gain: 1, phase: 0 }] },
    phaseStereo: { freqA: 440, freqB: 442, phaseDeg: 45, pan: 0, route: 'mono' },
    now: new Date(Date.UTC(2026, 9, 2)),
  });
  for (const k of ['version', 'oscillaVersion', 'sampleRateRequested', 'mode', 'source',
    'waveform', 'frequency', 'gain', 'envelope', 'filter', 'pattern', 'sequencer', 'dualOsc',
    'metadata']) assert.ok(k in doc, k);
  assert.equal(doc.version, CONFIG_FILE_VERSION);
  assert.equal(doc.frequency, 15500);
  assert.equal(doc.metadata.exportedAt, '2026-10-02T00:00:00.000Z');
  const text = JSON.stringify(doc);
  assert.deepEqual(JSON.parse(text), doc); // plain JSON
});

test('config import round-trips through the validated V1 path', () => {
  const doc = buildConfigExport({ oscillaVersion: PKG_VERSION, sampleRate: null, mode: 'playground',
    instrument: instrumentCfg(), now: new Date(0) });
  const parsed = parseConfigImport(JSON.stringify(doc));
  assert.equal(parsed.ok, true);
  const r = applyConfig(null, parsed.instrument, { sampleRate: 48000, origin: 'import' });
  assert.equal(r.issues, 0);
  assert.equal(r.state.frequency, 15500);
  assert.equal(r.state.waveform, 'square');
  assert.equal(r.state.gainLevel, 0.05);
  assert.equal(r.state.dual.a.freq, 300);
});

test('config import rejects bad structure and reports soft problems', () => {
  assert.equal(parseConfigImport('not json').ok, false);
  assert.equal(parseConfigImport('[]').ok, false);
  assert.equal(parseConfigImport({ version: 2 }).ok, false);
  assert.equal(parseConfigImport({ version: 1, kind: 'other' }).ok, false);
  assert.equal(parseConfigImport({ version: 1, waveform: 'noise' }).ok, false);
  assert.equal(parseConfigImport({ version: 1, frequency: -5 }).ok, false);
  assert.equal(parseConfigImport({ version: 1, filter: 3 }).ok, false);
  const soft = parseConfigImport({ version: 1, filter: { type: 'comb', frequency: 1, Q: 1 },
    envelope: { adsr: { a: 0.1, d: 0.1, s: 2, r: 0.1 } } });
  assert.equal(soft.ok, true);
  assert.equal(soft.filter, null);
  assert.equal(soft.envelope, null);
  assert.equal(soft.warnings.length, 2);
});

test('file names, readout grouping and V1 mode mapping', () => {
  assert.equal(exportFileName('graph', 'png', new Date(2026, 0, 2, 3, 4, 5)),
    'oscilla-graph-20260102-030405.png');
  assert.equal(groupedHz(15500), '15,500');
  assert.equal(groupedHz(440), '440');
  assert.equal(groupedHz(20), '20.00');
  assert.equal(groupedHz(261.63), '261.6');
  assert.equal(v1ModeFor('synthesis', 'dual'), 'dual');
  assert.equal(v1ModeFor('learn', 'single'), 'learn');
  assert.equal(v1ModeFor('filter', 'single'), 'playground');
  assert.equal(workspaceForV1Mode('dual'), 'synthesis');
  assert.equal(workspaceForV1Mode('sweep'), 'playground');
});

test('scope ticks give at most 8 divisions', () => {
  for (const w of [5, 10, 20, 50, 100]) assert.ok(w / scopeTickStep(w) <= 8, String(w));
  assert.equal(scopeTickStep(5), 1);
});

test('typing guard (V1 isTypingTarget)', () => {
  const el = (tagName, role = null, extra = {}) => ({ tagName, getAttribute: (n) => (n === 'role' ? role : null),
    ownerDocument: { body: null }, ...extra });
  assert.equal(isTypingTarget(null), false);
  assert.equal(isTypingTarget(el('INPUT')), true);
  assert.equal(isTypingTarget(el('BUTTON')), true);
  assert.equal(isTypingTarget(el('DIV', 'switch')), true);
  assert.equal(isTypingTarget(el('DIV')), false);
  assert.equal(isTypingTarget(el('DIV', null, { isContentEditable: true })), true);
});

test('WAV export length: finite plan, trigger, safety cap, export limit', () => {
  assert.ok(renderLengthFor({ kind: 'finite', dur: 2 }, {}).seconds > 2);
  const t = renderLengthFor({ kind: 'open' }, { durationS: 0.5, limitS: 2, continuous: false });
  assert.ok(t.seconds > 0.5 && t.seconds < 0.8);
  const capped = renderLengthFor({ kind: 'open' }, { durationS: 9, limitS: 2, continuous: false });
  assert.ok(capped.seconds < 2.3);
  assert.ok(renderLengthFor({ kind: 'finite', dur: EXPORT_MAX_S + 5 }, {}).error);
  assert.ok(renderLengthFor(null, {}).error);
});
