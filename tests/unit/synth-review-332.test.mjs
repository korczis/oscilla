// Review of #332 (K090-K092, K121-K123): defects a player meets on the Engines tab.
//   - A note that builds no source (every drawbar at 0, every FM operator above 0.95 × Nyquist)
//     must not hold a voice: the census and the 16-voice ceiling count only what sounds.
//   - An engine removed in Studio breaks the chain into the one Output; the panel and the
//     engines before it go silent. The bay says which module is gone and offers Restore module
//     (not "normal removed" and a Restore normal that has nothing to restore), and the tab the
//     player is on shows the removed module's plate.
//   - The labels the face shows are the data that plays: an FM algorithm's label is its edges
//     and carriers, a wavetable's table names are its partials, the sync ratios in the help are
//     SYNC_RATIOS, and the index falls to I × Index sustain.
import test from 'node:test';
import assert from 'node:assert/strict';
import PANEL from '../../src/js/synth/panels/semi-mono.js';
import { brokenByRemoval, jackState } from '../../src/js/synth/normals.js';
import { platesShown, plateHtml } from '../../src/js/synth/view/face.js';
import { FM_ALGORITHMS } from '../../src/js/synth/fm-algorithms.js';
import { SYNC_RATIOS, WAVETABLE_BANKS } from '../../src/js/synth/wavetables.js';
import { NODE_REGISTRY } from '../../src/js/studio/registry.js';
import { engineEnv } from './engine-fixture.mjs';
import { panelStore } from './synth-fixture.mjs';

const ZERO_BARS = Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`h${i + 1}`, 0]));

test('a note with no source holds no voice: all drawbars at 0', () => {
  const { h } = engineEnv('additive-voice', ZERO_BARS);
  h.noteOn(0.1, 60, 100);
  assert.equal(h.info.voices(0.2), 0, 'nothing sounds, so no voice is counted');
  h.noteOff(0.3, 60);
  assert.equal(h.info.voices(5), 0, 'and none is left after the release');
  for (let n = 0; n < 16; n++) h.noteOn(1, 40 + n, 100);
  assert.equal(h.info.voices(1.1), 0);
});

test('a note with no source holds no voice: every FM operator above 0.95 × Nyquist', () => {
  const { h } = engineEnv('fm-voice', { algorithm: '2-op', ratio1: 16, ratio2: 16 },
    { sampleRate: 44100 });
  const r = h.noteOn(0.1, 96, 100); // 2093 Hz × 16 = 33.5 kHz, both operators
  assert.equal(r.dropped, 2);
  assert.equal(h.info.voices(0.2), 0);
  h.noteOff(0.3, 96);
  assert.equal(h.info.voices(5), 0);
});

test('a removed engine: the bay names the module, not a removed normal', () => {
  const st = panelStore();
  assert.deepEqual(brokenByRemoval(st.getModel(), PANEL), []);
  const id = PANEL.resolve(st.getModel()).get('additive').id;
  assert.equal(st.dispatch({ type: 'NODE_REMOVE', nodeId: id }).ok, true);
  const m = st.getModel();
  assert.deepEqual(brokenByRemoval(m, PANEL), [{ module: 'additive', label: 'ADDITIVE',
    jacks: ['additive.thru', 'fm.thru'] }]);
  assert.equal(jackState(m, PANEL, 'fm.thru'), 'open');
});

test('the tab the player is on shows a removed module that breaks its normals', () => {
  const st = panelStore();
  const shown = (m, tab, engine = 'additive') => platesShown({ panel: PANEL, tab, engine,
    resolved: PANEL.resolve(m), model: m }).map((x) => x.id);
  const panelIds = PANEL.modulesOf('panel').map((x) => x.id);
  assert.deepEqual(shown(st.getModel(), 'panel'), panelIds);
  assert.deepEqual(shown(st.getModel(), 'engines', 'fm'), ['fm']);
  st.dispatch({ type: 'NODE_REMOVE', nodeId: PANEL.resolve(st.getModel()).get('perc').id });
  const m = st.getModel();
  assert.deepEqual(shown(m, 'panel'), ['perc', ...panelIds], 'the gone engine comes first');
  assert.deepEqual(shown(m, 'engines', 'fm'), ['perc', 'fm']);
  assert.deepEqual(shown(m, 'engines', 'perc'), ['perc'], 'never twice');
  const html = plateHtml({ panel: PANEL, module: PANEL.module('perc'), node: null, model: m,
    tokens: {} });
  assert.match(html, /data-restore-module="perc"/);
  assert.match(html, /perc\.thru/);
  assert.match(html, /out\.audio/);
});

/** '2 + 3 → 1', '4 → 3 → 2 → 1', '2 → 1, 4 → 3', '1 + 2 + 3 + 4' -> edges and carriers. */
function parseLabel(label) {
  const edges = [];
  const carriers = [];
  for (const chain of label.split(',').map((s) => s.trim())) {
    const stages = chain.split('→').map((s) => s.split('+').map((x) => Number(x.trim())));
    for (let i = 0; i + 1 < stages.length; i++) {
      for (const m of stages[i]) for (const t of stages[i + 1]) edges.push([m, t]);
    }
    carriers.push(...stages[stages.length - 1]);
  }
  const key = (e) => e.join('>');
  return { edges: edges.map(key).sort(), carriers: carriers.sort() };
}

test('an FM algorithm label is its routing: edges and carriers', () => {
  for (const a of FM_ALGORITHMS) {
    const p = parseLabel(a.label);
    assert.deepEqual(p.edges, a.edges.map((e) => e.join('>')).sort(), `${a.id} edges`);
    assert.deepEqual(p.carriers, [...a.carriers].sort(), `${a.id} carriers`);
  }
});

test('the index falls from I · f_mod to I · f_mod × Index sustain', () => {
  const { ctx, h } = engineEnv('fm-voice', { algorithm: '2-op', ratio2: 2, index2: 3,
    modSustain: 0.25 });
  h.noteOn(0.1, 69, 100);
  const carrier = ctx.oscillators[0];
  const idx = ctx.of('gain').find((g) => g.outputs.includes(carrier.frequency));
  assert.equal(idx.gain.calls[0][1], 3 * 880);
  assert.equal(idx.gain.calls[1][0], 'setTargetAtTime');
  assert.equal(idx.gain.calls[1][1], 3 * 880 * 0.25);
});

const strongest = (ps) => ps.reduce((b, x) => (x.gain > b.gain ? x : b)).n;

test('wavetable table names are their partials', () => {
  const formant = WAVETABLE_BANKS.formant;
  formant.partials().forEach((ps, i) => {
    assert.equal(strongest(ps), Number(/Res (\d+)/.exec(formant.tables[i])[1]),
      `formant table ${formant.tables[i]}`);
  });
  const pulse = WAVETABLE_BANKS.pulse;
  pulse.partials().forEach((ps, i) => {
    const w = Number(/([\d.]+) %/.exec(pulse.tables[i])[1]) / 100;
    const k = Math.round(1 / w); // a width of 1/k nulls every k-th harmonic
    assert.ok(Math.abs(ps[k - 1].gain) < 1e-9, `${pulse.tables[i]}: harmonic ${k} nulled`);
    assert.ok(Math.abs(ps[0].gain) > 0.01, `${pulse.tables[i]}: a fundamental`);
  });
  assert.deepEqual(WAVETABLE_BANKS.sync.tables, SYNC_RATIOS.map((r) => `Sync × ${r}`));
});

test('the sync ratios the help names are SYNC_RATIOS, each table on its own grid', () => {
  const help = NODE_REGISTRY.get('wavetable-voice').help.what;
  const said = /synced at ([\d., and]+) times/.exec(help)[1].split(/, | and /).map(Number);
  assert.deepEqual(said, [...SYNC_RATIOS]);
  WAVETABLE_BANKS.sync.partials().forEach((ps, i) => {
    const r = SYNC_RATIOS[i];
    const top = strongest(ps);
    assert.ok(Math.abs(top - r) <= 1, `sync × ${r}: strongest line ${top} near ${r}`);
    if (Number.isInteger(r)) {
      for (const x of ps) if (x.n % r) assert.ok(x.gain < 1e-6, `sync × ${r}: n ${x.n} off`);
    } else {
      assert.ok(ps[0].gain > 0.01, `sync × ${r}: the note's own fundamental sounds`);
    }
  });
});
