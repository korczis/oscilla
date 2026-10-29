// C003: the V2 pattern sequencer plays through the engine's Filter stage and is counted.
//
// Findings dead-controls-7, control-census-2 and engine-sync-5 (PACK 03): every pass was compiled
// straight into engine.master, so an enabled 200 Hz low-pass changed a looping 4 kHz sequence by
// +0.0007 dB while it took 52 dB off the instrument, and engine.activeNodeCount read 0 while the
// sequence sounded. These checks hold the contract the fix gives the editor's engine adapter
// (openStage -> AudioEngine.stageChain, main.js) on the fake Web Audio context; the browser check
// `seq-filter-reaches-sequence` (tests/browser/sequencer.cjs) measures the attenuation for real.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AudioEngine } from '../../src/js/audio/audio-engine.js';
import { createFilterStage } from '../../src/js/audio/filters.js';
import { createSequencerEditor } from '../../src/js/sequencer/editor.js';
import { renderSequenceOffline } from '../../src/js/sequencer/compiler.js';
import { createWorkbench } from '../../src/js/ui/workbench.js';
import { WAVEFORM_LABELS } from '../../src/js/core/constants.js';
import { StudioFakeContext, createFakeAudioEnv } from './sequencer-fake-audio.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const LOWPASS_200 = Object.freeze({ type: 'lowpass', frequency: 200, Q: Math.SQRT1_2, gain: 0,
  enabled: true });
/** The insert factory main.js hands the engine for the sequence (labs.filter.createInsert). */
const lowpass = (ctx, track) => createFilterStage(ctx, LOWPASS_200, { track });

/** One looping 4 kHz sine tone of 0.5 s, the finding's sequence. */
const TONE_4K = Object.freeze({ tempoBpm: 120, loop: true, waveform: 'sine',
  blocks: [{ id: 't1', type: 'tone', durationMs: 500, params: { freq: 4000 } }] });

function setup({ loop = true } = {}) {
  const fx = createFakeAudioEnv({ sampleRate: 48000 });
  const engine = new AudioEngine({ env: fx.env });
  assert.ok(engine.init(), 'engine.init');
  if (engine.limiterFeed) engine.limiterFeed.infrastructure = true;
  const opened = [];
  const ed = createSequencerEditor({
    model: { ...TONE_4K, loop },
    timers: { setTimeout: fx.env.setTimeout, clearTimeout: fx.env.clearTimeout },
    engine: {
      getContext: () => engine.ctx,
      getDestination: () => engine.master,
      resume: () => null,
      // What main.js passes through the sequencer panel: one engine-owned, counted chain.
      openStage: () => {
        const chain = engine.stageChain([lowpass]);
        opened.push(chain);
        return chain;
      },
    },
  });
  return { fx, engine, ed, opened };
}

/** Every path from `from` along connections; true when one reaches `to` through a node of `kind`. */
function reachesThrough(from, to, kind) {
  const seen = new Set();
  const walk = (n, via) => {
    if (n === to) return via;
    const key = `${via}:${n.__id || (n.__id = Math.random())}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return (n.outputs || []).some((o) => walk(o, via || o.kind === kind));
  };
  return walk(from, false);
}

const carrierOf = (ctx, since) => ctx.created.slice(since).find((n) => n.kind === 'oscillator');

test('C003: with the Filter on, a sequencer pass reaches engine.master through the BiquadFilter', () => {
  const { fx, engine, ed } = setup();
  const before = fx.ctx.created.length;
  assert.equal(ed.play(), true);
  const carrier = carrierOf(fx.ctx, before);
  assert.ok(carrier, 'the pass built its carrier');
  assert.ok(reachesThrough(carrier, engine.master, 'biquad'),
    'the sequence reaches the master through the Filter stage (dead-controls-7)');
  const biquads = fx.ctx.created.slice(before).filter((n) => n.kind === 'biquad');
  assert.ok(biquads.some((b) => b.type === 'lowpass'
    && b.frequency.events.some((e) => e.value === 200)), 'the stage is the 200 Hz low-pass');
  ed.stop();
  fx.advance(1);
});

test('C003: the engine counts the sequencer while it sounds and holds nothing after stop', () => {
  const { fx, engine, ed, opened } = setup();
  assert.equal(engine.activeNodeCount, 0);
  ed.play();
  fx.advance(0.2);
  assert.ok(engine.activeNodeCount > 0, `nodes counted while it sounds: ${engine.activeNodeCount}`);
  assert.ok(engine.activeSourceCount > 0, 'its carrier counts as an engine source');
  ed.stop();
  fx.advance(0.5);
  assert.equal(ed.playing, false);
  assert.equal(engine.activeNodeCount, 0, 'stop leaves zero engine nodes (engine-sync-5)');
  assert.equal(engine.activeSourceCount, 0);
  assert.equal(opened.length, 1);
  assert.equal(opened[0].disposed, true, 'the chain is disposed once the last pass has ended');
});

test('C003: one chain per playback session: loop passes share the Filter, natural end frees it', () => {
  const { fx, engine, ed, opened } = setup();
  ed.play();
  const biquadsAtStart = fx.ctx.of('biquad').length;
  fx.advance(2.2); // four passes of 0.5 s
  assert.equal(opened.length, 1, 'no chain per pass (a new biquad would reset its state)');
  assert.equal(fx.ctx.of('biquad').length, biquadsAtStart, 'loop passes build no new filter');
  assert.ok(engine.activeNodeCount > 0);
  ed.setLoop(false);
  fx.advance(2);
  assert.equal(ed.playing, false, 'the last pass ended on its own');
  assert.equal(engine.activeNodeCount, 0, 'natural end leaves zero engine nodes');
  assert.equal(opened[0].disposed, true);
  // A restart opens a new session on the same engine, counted again.
  ed.play();
  fx.advance(0.1);
  assert.equal(opened.length, 2);
  assert.ok(engine.activeNodeCount > 0);
  ed.dispose();
  assert.equal(engine.activeNodeCount, 0, 'dispose frees the chain and every pass');
  assert.equal(opened[1].disposed, true);
});

test('C003: a restart while a pass fades keeps the session chain until every pass has ended', () => {
  const { fx, engine, ed, opened } = setup();
  ed.play();
  fx.advance(0.1);
  ed.play(); // the earlier pass fades into the same chain
  assert.equal(opened.length, 1);
  assert.equal(opened[0].disposed, false);
  fx.advance(0.2);
  assert.equal(opened[0].disposed, false, 'the playing pass still sounds through it');
  ed.stop();
  fx.advance(0.5);
  assert.equal(opened[0].disposed, true);
  assert.equal(engine.activeNodeCount, 0);
});

test('C003: a closed context frees an open stage chain from the engine census', () => {
  const { fx, engine, ed, opened } = setup();
  ed.play();
  fx.advance(0.1);
  assert.ok(engine.activeNodeCount > 0);
  fx.ctx.close();
  assert.equal(opened[0].disposed, true);
  assert.equal(engine.activeNodeCount, 0);
  ed.dispose();
});

test('C003: the offline sequence render (WAV export) plays through the same Filter chain', async () => {
  let rendered = null;
  class FakeOffline extends StudioFakeContext {
    constructor(a, b, c) {
      const o = typeof a === 'object' ? a : { numberOfChannels: a, length: b, sampleRate: c };
      super({ sampleRate: o.sampleRate });
      this.length = o.length;
      rendered = this; // eslint-disable-line consistent-this
    }

    startRendering() {
      // The graph as it renders (the render disposes it afterwards).
      const carrier = carrierOf(this, 0);
      this.renderedThroughFilter = !!carrier
        && reachesThrough(carrier, this.destination, 'biquad');
      return Promise.resolve({ length: this.length, sampleRate: this.sampleRate });
    }
  }
  await renderSequenceOffline({ ...TONE_4K, loop: false }, FakeOffline,
    { sampleRate: 48000, inserts: [lowpass] });
  assert.equal(rendered.renderedThroughFilter, true,
    'the exported WAV goes through the Filter stage as the live sequence does');
  const lp = rendered.of('biquad').find((b) => b.type === 'lowpass');
  assert.ok(lp && lp.frequency.events.some((e) => e.value === 200));
  const left = rendered.created.filter((n) => n.kind !== 'destination' && n.outputs.length);
  assert.deepEqual(left.map((n) => n.kind), [], 'the render disconnects its whole chain');
});

test('C003: the Envelope and Additive panels and README say what shapes the sequence', () => {
  const html = read('src/index.html');
  for (const [panel, key] of [['osc-panel-envelope', 'envelope.scope'],
    ['osc-panel-additive', 'additive.scope']]) {
    const start = html.indexOf(`id="${panel}"`);
    const end = html.indexOf('</section>', start);
    assert.ok(start > 0 && end > start, panel);
    const section = html.slice(start, end);
    const m = section.match(new RegExp(`<span[^>]*data-osc="${key.replace('.', '\\.')}"[^>]*>`
      + '([^<]*)</span>'));
    assert.ok(m, `${panel} carries its ${key} note`);
    assert.match(m[1], /instrument only/i, `${key} says the lab shapes the instrument only`);
    assert.match(m[0], /:hidden="[^"]*seqPlaying[^"]*"/, `${key} shows while the sequence plays`);
    assert.match(m[0], /:hidden="[^"]*workspace\s*!==\s*'sequencer'/,
      `${key} shows in the Sequencer workspace`);
  }
  const readme = read('README.md');
  assert.ok(!/sequences, shape them with filters, an\s+ADSR envelope and additive harmonics/
    .test(readme), 'README no longer says the ADSR and additive labs shape the sequences');
  const para = readme.slice(readme.indexOf('## What it does'), readme.indexOf('## Navigation'));
  const flat = para.replace(/\s+/g, ' ');
  assert.match(flat, /block sequences that play through the Filter Lab/,
    'README says the sequence plays through the Filter Lab');
  assert.match(flat, /ADSR envelope and additive harmonics shape the instrument/,
    'README says what the Envelope and Additive labs shape');
});

test('C003: the status bar names the sequence waveform, not Additive, while the sequencer plays', () => {
  const wb = createWorkbench({ labs: {} });
  const cmp = {};
  Object.defineProperties(cmp, Object.getOwnPropertyDescriptors(wb));
  Object.assign(cmp, { seqPlaying: true, playing: false, source: 'single', waveform: 'square',
    labFlags: { additive: true, envelope: true, filter: true } });
  assert.equal(cmp.statusWaveText, WAVEFORM_LABELS.square,
    'the sequence plays its own waveform: the additive lab is instrument-only');
  cmp.seqPlaying = false;
  assert.equal(cmp.statusWaveText, 'Additive', 'the instrument still reports the additive wave');
});
