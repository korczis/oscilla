// The synthesis template pack of plan issue K014: filter-envelope synth, FM chime, ring-mod,
// drive lead, macro pad and step-modulator bass (src/js/studio/templates/). Each validates with
// a pinned studioHash, uses the node and edge its sound depends on, renders every clip and lane
// offline (planOfflineRender), opens from its Studio link, and names no commercial product and
// claims no analog modelling. The levels of the rendered audio are judged in the browser
// (tests/browser/v31-studio-workflows.cjs, check `template-pack`).
//   node --test tests/unit/studio-template-pack.test.mjs
//
// It fails on a tree without the pack (project.fail-first): TEMPLATE_PACK_IDS is not exported
// there and getTemplate(id) of every pack id is null.
//
// Tolerances: none. Templates and plans are plain data; every assertion is exact.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  STUDIO_TEMPLATES, TEMPLATE_PACK_IDS, getTemplate, templateModel, validateTemplate,
} from '../../src/js/studio/templates/index.js';
import { studioHash } from '../../src/js/studio/schema.js';
import { planOfflineRender } from '../../src/js/studio/offline.js';
import { NODE_REGISTRY } from '../../src/js/studio/registry.js';
import { decodeStudioLink, encodeStudioLink } from '../../src/js/core/url-state-studio.js';
import { SAFE_NYQUIST_FACTOR } from '../../src/js/core/constants.js';

/** The pack, id to title, in library order. */
const PACK = {
  'filter-envelope-synth': 'Filter Envelope Synth',
  'fm-chime': 'FM Chime',
  'ring-mod': 'Ring Mod',
  'drive-lead': 'Drive Lead',
  'macro-pad': 'Macro Pad',
  'step-bass': 'Step Bass',
};
/** Lowest audio-band rate: an LFO at or above it is an audio-rate modulator (K010). */
const AUDIO_BAND_HZ = 20;
/** The lowest common browser rate (CI runs 44.1 kHz): the LFO must not need the clamp there. */
const LOWEST_RATE = 44100;
/** Product and brand names no template may carry (D1), and the analog-modelling claim. */
const BANNED = [/\bmoog\b/i, /\bminimoog\b/i, /\bkorg\b/i, /\bms-?20\b/i, /\broland\b/i,
  /\btb-?303\b/i, /\b303\b/, /\bjuno\b/i, /\bjupiter\b/i, /\byamaha\b/i, /\bdx-?7\b/i,
  /\bprophet\b/i, /\barturia\b/i, /\boberheim\b/i, /\bbuchla\b/i, /\bnord\b/i,
  /\bsynclavier\b/i, /\bfairlight\b/i, /\banalog/i, /\bvintage\b/i];

const nodeOf = (m, id) => m.graph.nodes.find((n) => n.id === id);
const typeOf = (m, id) => nodeOf(m, id).type;
const edgesFrom = (m, type, port) => m.graph.edges.filter((e) => typeOf(m, e.from.node) === type
  && e.from.port === port);
const portType = (m, end, dir) => {
  const def = NODE_REGISTRY.get(typeOf(m, end.node));
  return (dir === 'out' ? def.outputs : def.inputs).find((p) => p.id === end.port).type;
};
const audioEdges = (m) => m.graph.edges.filter((e) => portType(m, e.from, 'out') === 'AUDIO'
  && portType(m, e.to, 'in') === 'AUDIO');
/** Node ids an AUDIO path reaches from `start` (start included). */
function audioReach(m, start) {
  const seen = new Set([start]);
  const todo = [start];
  while (todo.length) {
    const at = todo.pop();
    for (const e of audioEdges(m)) {
      if (e.from.node === at && !seen.has(e.to.node)) {
        seen.add(e.to.node);
        todo.push(e.to.node);
      }
    }
  }
  return seen;
}
const reachesMaster = (m, id) => [...audioReach(m, id)].some((n) => typeOf(m, n) === 'master');
const clipsOn = (m, id, kind) => m.timeline.clips.filter((c) => c.kind === kind
  && (c.target || m.timeline.tracks.find((t) => t.id === c.trackId).target) === id);
/** Every text a user reads from a template: title, Learn, notes, node and track names. */
function textsOf(t) {
  const m = templateModel(t.id);
  return [t.title, t.learn.summary, ...t.learn.points, m.metadata.title, m.metadata.notes,
    ...m.graph.nodes.map((n) => n.metadata.name), ...m.timeline.tracks.map((x) => x.name)];
}

test('K014 the six pack templates sit after First Patch and before the Demo song', () => {
  assert.deepEqual([...TEMPLATE_PACK_IDS], Object.keys(PACK));
  for (const [id, title] of Object.entries(PACK)) {
    const t = getTemplate(id);
    assert.ok(t, `${id} is a template`);
    assert.equal(t.title, title);
    assert.equal(t.category, 'synthesis');
  }
  const ids = STUDIO_TEMPLATES.map((t) => t.id);
  const at = ids.indexOf('first-patch');
  assert.deepEqual(ids.slice(at + 1, at + 1 + TEMPLATE_PACK_IDS.length), Object.keys(PACK));
  assert.equal(ids.at(-1), 'demo-song');
});

for (const id of Object.keys(PACK)) {
  test(`K014 ${id}: validates, keeps its pinned hash, renders every clip and lane, opens by link`,
    () => {
      const t = getTemplate(id);
      assert.ok(t, `${id} is a template`);
      const v = validateTemplate(t);
      assert.deepEqual(v.errors, []);
      assert.deepEqual(v.warnings.map((w) => w.code), []);
      const m = templateModel(id);
      assert.equal(studioHash(m), t.studioHash);
      // Every sounding node reaches the Master Output.
      for (const n of m.graph.nodes) {
        if (NODE_REGISTRY.get(n.type).sounding) assert.ok(reachesMaster(m, n.id), n.id);
      }
      const plan = planOfflineRender(m);
      assert.equal(plan.ok, true, JSON.stringify(plan.errors));
      assert.deepEqual([plan.limitations, plan.warnings], [[], []]);
      assert.ok(plan.duration > 0);
      assert.equal(plan.clips.length, m.timeline.clips.length);
      assert.ok(plan.clips.length > 0, 'the timeline plays something');
      assert.deepEqual(plan.clips.filter((c) => !c.rendered), []);
      assert.equal(plan.automation.length, m.timeline.automation.length);
      assert.deepEqual(plan.automation.filter((a) => !a.rendered), []);
      assert.ok(plan.nodes.every((n) => n.role === 'rendered'), 'every node sounds or shapes');
      assert.equal(decodeStudioLink(encodeStudioLink({ templateId: id })).templateId, id);
      assert.equal(decodeStudioLink(`#m=studio&st=${id}`).templateId, id);
    });

  test(`K014 ${id}: names no commercial product and claims no analog modelling (D1)`, () => {
    for (const text of textsOf(getTemplate(id))) {
      for (const re of BANNED) assert.doesNotMatch(String(text || ''), re, `${id}: "${text}"`);
    }
  });
}

test('K014 filter-envelope-synth: the Envelope CONTROL output moves the filter cutoff (log)', () => {
  const m = templateModel('filter-envelope-synth');
  const mod = edgesFrom(m, 'envelope', 'control').filter((e) => typeOf(m, e.to.node) === 'filter'
    && e.to.port === 'frequency');
  assert.equal(mod.length, 1);
  assert.equal(mod[0].props.mapping, 'log');
  assert.ok(mod[0].props.depth > 0);
  const env = mod[0].from.node;
  assert.ok(audioReach(m, env).has(mod[0].to.node), 'the Envelope also feeds the filter audio');
  const osc = m.graph.nodes.find((n) => n.type === 'oscillator');
  assert.equal(osc.params.waveform, 'sawtooth');
  assert.ok(clipsOn(m, env, 'event').length > 0, 'gated by event clips');
  assert.equal(clipsOn(m, osc.id, 'pattern').length, clipsOn(m, env, 'event').length,
    'one gate per note');
});

test('K014 fm-chime: an audio-rate LFO modulates the carrier frequency at a non-integer ratio', () => {
  const m = templateModel('fm-chime');
  const mod = edgesFrom(m, 'lfo', 'control').filter((e) => typeOf(m, e.to.node) === 'oscillator'
    && e.to.port === 'frequency');
  assert.equal(mod.length, 1);
  const lfo = nodeOf(m, mod[0].from.node);
  const carrier = nodeOf(m, mod[0].to.node);
  assert.ok(lfo.params.rate >= AUDIO_BAND_HZ, `LFO at ${lfo.params.rate} Hz`);
  assert.ok(lfo.params.rate <= SAFE_NYQUIST_FACTOR * LOWEST_RATE / 2, 'below the K010 clamp');
  const ratio = lfo.params.rate / carrier.params.frequency;
  assert.ok(!Number.isInteger(ratio) && !Number.isInteger(1 / ratio), `ratio ${ratio}`);
  // A linear edge is frequency modulation in Hz: index = depth / modulator rate.
  assert.equal(mod[0].props.mapping, 'linear');
  assert.ok(mod[0].props.depth / lfo.params.rate > 0.5, 'audible sidebands');
  // The carrier is not pattern-played (that would hold it silent and bypass the modulation).
  assert.deepEqual(clipsOn(m, carrier.id, 'pattern'), []);
  const env = m.graph.nodes.find((n) => n.type === 'envelope');
  assert.ok(audioReach(m, carrier.id).has(env.id));
  assert.equal(env.params.sustain, 0, 'each strike decays');
  assert.ok(env.params.decay >= 1);
  assert.ok(clipsOn(m, env.id, 'event').length > 0);
});

test('K014 ring-mod: a bipolar audio-rate LFO edge drives a Gain from 0', () => {
  const m = templateModel('ring-mod');
  const mod = edgesFrom(m, 'lfo', 'control').filter((e) => typeOf(m, e.to.node) === 'gain'
    && e.to.port === 'gain');
  assert.equal(mod.length, 1);
  assert.equal(mod[0].props.polarity, 'bipolar');
  assert.equal(mod[0].props.mapping, 'linear');
  const lfo = nodeOf(m, mod[0].from.node);
  const gain = nodeOf(m, mod[0].to.node);
  assert.ok(lfo.params.rate >= AUDIO_BAND_HZ, `LFO at ${lfo.params.rate} Hz`);
  // Gain 0 ± depth: the factor runs through zero to the negative side (multiplication).
  assert.equal(gain.params.gain, 0);
  assert.ok(mod[0].props.depth > 0);
  const osc = m.graph.nodes.find((n) => n.type === 'oscillator');
  assert.ok(audioReach(m, osc.id).has(gain.id) && reachesMaster(m, gain.id));
});

test('K014 drive-lead: the Drive sits on the audio path from the Oscillator to the Master', () => {
  const m = templateModel('drive-lead');
  const drive = m.graph.nodes.find((n) => n.type === 'drive');
  assert.ok(drive);
  const osc = m.graph.nodes.find((n) => n.type === 'oscillator');
  assert.ok(audioReach(m, osc.id).has(drive.id) && reachesMaster(m, drive.id));
  assert.ok(drive.params.drive > 0 && drive.params.trim <= 1);
  assert.ok(clipsOn(m, osc.id, 'pattern').length > 0, 'a lead line');
});

test('K014 macro-pad: one Macro drives two parameters and an automation lane moves it', () => {
  const m = templateModel('macro-pad');
  const macro = m.graph.nodes.find((n) => n.type === 'macro');
  assert.ok(macro);
  const out = m.graph.edges.filter((e) => e.from.node === macro.id);
  assert.ok(out.length >= 2);
  assert.ok(out.every((e) => portType(m, e.from, 'out') === 'CONTROL'
    && portType(m, e.to, 'in') === 'CONTROL'));
  assert.equal(new Set(out.map((e) => `${e.to.node}.${e.to.port}`)).size, out.length,
    'distinct parameters');
  const lanes = m.timeline.automation.filter((l) => l.target.node === macro.id
    && l.target.param === 'value');
  assert.equal(lanes.length, 1);
  const values = lanes[0].points.map((p) => p.value);
  assert.ok(Math.min(...values) === 0 && Math.max(...values) === 1, 'the lane spans 0..1');
});

test('K014 step-bass: the Step Modulator moves a frequency on a log edge', () => {
  const m = templateModel('step-bass');
  const mod = edgesFrom(m, 'step-modulator', 'control').filter((e) => e.to.port === 'frequency'
    && ['filter', 'oscillator'].includes(typeOf(m, e.to.node)));
  assert.equal(mod.length, 1);
  assert.equal(mod[0].props.mapping, 'log');
  assert.ok(mod[0].props.depth > 0);
  const osc = m.graph.nodes.find((n) => n.type === 'oscillator');
  assert.ok(clipsOn(m, osc.id, 'pattern').length > 0, 'a bass line');
});
