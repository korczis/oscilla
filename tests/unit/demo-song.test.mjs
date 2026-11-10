// The demo song, "Lantern in the Slag Yard" (plan issue K144): the song as data, the loader
// that opens it and the parts of the vertical-slice journey (tests/browser/demo-song.cjs) that
// need no browser. It fails on a tree without src/js/studio/templates/demo-song.js
// (project.fail-first).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEMO_SONG_TEMPLATE_ID, STUDIO_TEMPLATES, getTemplate, listTemplates, templateModel,
  validateTemplate,
} from '../../src/js/studio/templates/index.js';
import demoSong, {
  DEMO_SONG_OMITTED, DEMO_SONG_SECONDS, DEMO_SONG_TITLE,
} from '../../src/js/studio/templates/demo-song.js';
import * as S from '../../src/js/studio/templates/demo-song-score.js';
import { serializeStudio, studioHash, studioHashAt } from '../../src/js/studio/schema.js';
import { importStudio } from '../../src/js/studio/migrate.js';
import { createStudioStore } from '../../src/js/studio/actions.js';
import { planOfflineRender } from '../../src/js/studio/offline.js';
import { clipTarget } from '../../src/js/studio/clip-targets.js';
import { adsrEvents, releaseEvents, valueAtTime } from '../../src/js/audio/envelope.js';
import { decodeStudioLink, encodeStudioLink } from '../../src/js/core/url-state-studio.js';

const ids = () => {
  let n = 0;
  return (prefix) => `${prefix}-x${++n}`;
};
const byTrack = (m) => {
  const out = {};
  for (const c of m.timeline.clips) out[c.trackId] = (out[c.trackId] || 0) + 1;
  return out;
};

test('K144 the demo song is the last template and the six before it keep their hashes', () => {
  assert.equal(DEMO_SONG_TEMPLATE_ID, 'demo-song');
  assert.equal(STUDIO_TEMPLATES.at(-1).id, 'demo-song');
  assert.equal(getTemplate('demo-song'), STUDIO_TEMPLATES.at(-1));
  // The six templates before the song, with the hashes they were pinned with: none changes
  // (hash epoch 1, as they were pinned; K022's epoch 2 re-pins them without a content change).
  const six = STUDIO_TEMPLATES.slice(0, 6).map((t) => [t.id, studioHashAt(templateModel(t.id),
    1)]);
  assert.deepEqual(six, [
    ['basic-tone', 'fbfe0905d6948e9e92418623fb0d53505b89706136fe0cbe3521a92d3b7edf92'],
    ['subtractive-synth', '3982a31f8fe6f92f9206bca48ab19b7cfe091105fdb841143e7d1f1e892ec424'],
    ['sweep-sequence', 'a4e06d13f869a5976ff7058e7b42533a6735061268c6d7e7910c5119b635b5df'],
    ['stereo-beat', 'c32148891dbbad5f44ff5559a936daeaf183de8ac63bf2959945b02a2ff29c2b'],
    ['filter-automation', '5c107b61379ebc01c124e73c9888679120407c3a1ad695bb519e62954e4f66c7'],
    ['measurement-sweep', '6b7754b60524614f71cb4d32b3dd77e0f3da793ffb6da976f36b42242e3c9a84'],
  ]);
  const entry = listTemplates().at(-1);
  assert.equal(entry.title, 'Demo song: Lantern in the Slag Yard');
  assert.equal(entry.title, DEMO_SONG_TITLE);
  assert.match(entry.title, /^Demo song: /, 'the Templates dialog lists it as a "Demo song"');
  assert.equal(entry.category, 'synthesis');
});

// The song's pinned hashes by template version, each at hash epochs 1-3 (schema.js
// studioHashAt; epoch 3 is the current studioHash). Version 1 is kept as history: links carry
// only the template id and nothing reads a saved project's templateVersion or studioHash, so a
// project saved from version 1 keeps loading (proved below); no history field ships with the
// template (oscilla-43's decision on K144 v2, project.no-inert-surfaces).
const PINNED = Object.freeze({
  1: { 1: '6af3c386ab88fe2c98d1a11a65d2f537fafbb3cd49b4aed7ca0a234e733405b6',
    2: 'c44957c33f8a738ae8f4dceeecf2796f5804417a1494373068932bd32342b2c3',
    3: 'a93e800886ce42c6fee5da20290ed332caaf5aa15beead339b159fc98a9b51d9' },
  2: { 1: '65de98eba81a1fa81d60d51d52e6afefe26d32497f61d7c6591f8d87cd5ee15d',
    2: '31ea9e48470c9385712153a7cf4960309d8edd857321dd3ae23bbddc197fa43b',
    3: '019d30d01b1ffb11708bfe80caec15a180951ba501936b9aa5e7934e0cc0bc04' },
});
/** The model version 1 built: version 2 less the bass filter's Q lane, which it added. */
const v1Model = () => {
  const m = structuredClone(templateModel('demo-song'));
  m.timeline.automation = m.timeline.automation.filter((l) => l.id !== 'lane-bass-q');
  return m;
};

test('K144 the song validates without a warning, with its hash pinned', () => {
  const v = validateTemplate(demoSong);
  assert.deepEqual(v.errors, []);
  assert.deepEqual(v.warnings.map((w) => w.code), []);
  assert.equal(demoSong.version, 2);
  assert.equal(demoSong.studioHash, PINNED[2][3]);
  for (const e of [1, 2]) {
    assert.equal(studioHashAt(templateModel('demo-song'), e), PINNED[2][e], `hash epoch ${e}`);
  }
  assert.equal(studioHash(templateModel('demo-song')), demoSong.studioHash);
  const m = templateModel('demo-song');
  const back = importStudio(serializeStudio(m));
  assert.equal(back.ok, true, 'the untrusted import pipeline accepts it');
  assert.equal(serializeStudio(back.model), serializeStudio(m));
});

test('K144 the whole song: 44 bars at 96 BPM, 744 tempo-linked clips, 7 sections', () => {
  const m = templateModel('demo-song');
  assert.deepEqual([m.transport.timeMode, m.transport.tempo, m.transport.timeSignature],
    ['musical', 96, [4, 4]]);
  assert.equal(DEMO_SONG_SECONDS, 110);
  assert.equal(m.timeline.clips.length, 744);
  assert.deepEqual(byTrack(m), { 'track-bass': 266, 'track-lead': 76, 'track-kick': 135,
    'track-snare': 107, 'track-hat': 156, 'track-open-hat': 4 });
  assert.equal(S.partNotes('bass').length + S.partNotes('lead').length
    + S.partNotes('drums').length, 744, 'one clip per note of the score');
  const spb = 60 / 96;
  for (const c of m.timeline.clips) {
    assert.ok(c.musical, `${c.id} is tempo-linked`);
    assert.ok(Math.abs(c.start - c.musical.startBeats * spb) <= 1e-6, c.id);
    assert.ok(Math.abs(c.duration - c.musical.durationBeats * spb) <= 1e-6, c.id);
  }
  const end = Math.max(...m.timeline.clips.map((c) => c.start + c.duration));
  assert.equal(Math.round(end * 1000) / 1000, 110);
  assert.deepEqual(m.timeline.markers.map((x) => [x.label, x.time]), [['intro', 0],
    ['verse 1', 10], ['chorus 1', 30], ['verse 2', 50], ['build', 70], ['chorus 2', 80],
    ['outro', 100]]);
  // The first bar of the bass riff, as Studio clips: A1 A1 E2 A2 G2 E2 at the riff's steps.
  const bar1 = m.timeline.clips.filter((c) => c.trackId === 'track-bass'
    && c.musical.startBeats < 4).map((c) => [c.musical.startBeats, c.payload.params.freq]);
  assert.deepEqual(bar1, [[0, 55], [0.75, 55], [1, 82.406889], [1.5, 110], [2, 97.998859],
    [3, 82.406889]]);
});

test('K144 the parts are wired: synth voices, filter, LFO, drums, mixer and four views', () => {
  const m = templateModel('demo-song');
  const types = Object.fromEntries(m.graph.nodes.map((n) => [n.id, n.type]));
  for (const [id, type] of [['bass-osc', 'oscillator'], ['bass-filter', 'filter'],
    ['lead-filter', 'filter'], ['lead-lfo', 'lfo'], ['kick-osc', 'oscillator'],
    ['noise-1', 'noise'], ['snare-env', 'envelope'], ['hat-env', 'envelope'],
    ['open-hat-env', 'envelope'], ['main-mix', 'mixer'], ['master-1', 'master'],
    ['scope-1', 'scope'],
    ['spectrum-1', 'spectrum'], ['spectrogram-1', 'spectrogram'], ['meter-1', 'meter']]) {
    assert.equal(types[id], type, id);
  }
  assert.deepEqual([m.graph.nodes.length, m.graph.edges.length], [19, 20]);
  const lfo = m.graph.edges.find((e) => e.from.node === 'lead-lfo');
  assert.deepEqual([lfo.to.node, lfo.to.port], ['lead-filter', 'frequency']);
  assert.deepEqual(m.timeline.tracks.map((t) => [t.name, t.target]), [['Bass', 'bass-osc'],
    ['Lead', 'lead-osc'], ['Kick', 'kick-osc'], ['Snare', 'snare-env'], ['Hats', 'hat-env'],
    ['Open hat', 'open-hat-env']]);
  // Both hats are the same noise through the same high-pass, each into its own envelope.
  const into = (id) => m.graph.edges.filter((e) => e.to.node === id)
    .map((e) => `${e.from.node}>${e.to.port}`);
  assert.deepEqual([into('hat-env'), into('open-hat-env')], [['hat-filter>audio'],
    ['hat-filter>audio']]);
  assert.deepEqual(m.graph.edges.filter((e) => e.from.node === 'open-hat-env')
    .map((e) => `${e.to.node}.${e.to.port}`), ['drum-mix.in4']);
  const drums = m.graph.nodes.find((n) => n.id === 'drum-mix').params;
  assert.equal(drums.level4, drums.level3, 'the open hat plays at the closed hat\'s level');
  assert.deepEqual(m.timeline.automation.map((l) => `${l.target.node}.${l.target.param}`), [
    'bass-filter.frequency', 'lead-lfo.rate', 'bass-filter.Q', 'main-mix.level1',
    'main-mix.level2', 'main-mix.level3']);
});

test('K144 the open hat rings on, and the closed hat keeps its 12 ms ring', () => {
  // Each hat's envelope through the schedule the Studio envelope node plays (adapters/nodes.js:
  // applyAdsr at the gate, releaseAt after the clip's duration), read every 0.1 ms: how long it
  // rings above -30 dB of its peak. The open hat has its own envelope node, so its sustain
  // cannot lengthen the 156 closed hats (#323 review: a shared sustain 0.25 made every closed
  // hat ring 35 ms, +7.3 dB of envelope energy).
  const m = templateModel('demo-song');
  const envOf = (id) => {
    const p = m.graph.nodes.find((n) => n.id === id).params;
    return { a: p.attack, d: p.decay, s: p.sustain, r: p.release };
  };
  const gatesOf = (trackId) => [...new Set(m.timeline.clips.filter((c) => c.trackId === trackId)
    .map((c) => c.duration))];
  const rings = (adsr, gate) => {
    const { events, endTime } = releaseEvents(adsrEvents(0, adsr), gate, adsr.r);
    let n = 0;
    for (let i = 0; i * 1e-4 <= endTime; i++) {
      if (valueAtTime(events, i * 1e-4) > 10 ** -1.5) n += 1;
    }
    return n * 1e-4;
  };
  const closedEnv = envOf('hat-env');
  const openEnv = envOf('open-hat-env');
  assert.deepEqual([gatesOf('track-hat'), gatesOf('track-open-hat')], [[0.03], [0.15625]]);
  const closed = rings(closedEnv, 0.03);
  const open = rings(openEnv, 0.15625);
  assert.ok(Math.abs(closed - 0.0122) <= 2e-4,
    `the closed hat rings ${closed.toFixed(4)} s above -30 dB, not 0.0122 s`);
  assert.ok(open - closed > 0.1, `the open hat rings ${open.toFixed(4)} s above -30 dB, the `
    + `closed one ${closed.toFixed(4)} s`);
  assert.deepEqual(closedEnv, { a: 0.001, d: 0.03, s: 0, r: 0.02 },
    'the closed hat\'s envelope is the one it was written with');
});

test('K144 the offline render plays every clip and lane, 110 s, with no limitation', () => {
  const m = templateModel('demo-song');
  const plan = planOfflineRender(m);
  assert.equal(plan.ok, true, JSON.stringify(plan.errors));
  assert.deepEqual(plan.limitations, []);
  assert.deepEqual(plan.warnings, []);
  assert.ok(plan.duration > 110 && plan.duration < 111, String(plan.duration));
  assert.equal(plan.clips.length, 744);
  assert.deepEqual(plan.clips.filter((c) => !c.rendered).map((c) => c.id), []);
  assert.deepEqual(plan.automation.filter((a) => !a.rendered).map((a) => a.id), []);
  assert.deepEqual(plan.nodes.filter((n) => n.role === 'refused').map((n) => n.id), []);
});

test('K144 v2: the bass filter\'s Q lane is the score\'s, and a low-pass Q lane plays (G10)',
  () => {
    const m = templateModel('demo-song');
    const q = m.timeline.automation.find((l) => l.id === 'lane-bass-q');
    assert.deepEqual([q.target.node, q.target.param], ['bass-filter', 'Q']);
    const spb = 60 / S.TEMPO_BPM;
    assert.deepEqual(q.points.map((p) => [p.time, p.value, p.curve]), S.AUTOMATION.bassQ
      .map(([beat, value, curve]) => [Math.round(beat * spb * 1e6) / 1e6, value, curve]));
    const filter = m.graph.nodes.find((n) => n.id === 'bass-filter');
    assert.equal(filter.params.type, 'lowpass');
    assert.equal(clipTarget(filter, { kind: 'automation', param: 'Q' }).plays, true,
      'the clip-target policy plays it (K232)');
    const plan = planOfflineRender(m);
    assert.deepEqual(plan.automation.filter((a) => a.id === 'lane-bass-q')
      .map((a) => a.rendered), [true], 'the offline render plays it');
  });

test('K144 v2: a project saved from version 1 still loads and plays the same notes', () => {
  const v1 = v1Model();
  for (const e of [1, 2, 3]) {
    assert.equal(studioHashAt(v1, e), PINNED[1][e], `the version 1 model at hash epoch ${e}`);
  }
  const back = importStudio(serializeStudio(v1));
  assert.equal(back.ok, true, 'the untrusted import pipeline accepts the version 1 file');
  assert.deepEqual(back.warnings || [], []);
  const p1 = planOfflineRender(back.model);
  const p2 = planOfflineRender(templateModel('demo-song'));
  assert.equal(p1.ok, true, JSON.stringify(p1.errors));
  assert.deepEqual(p1.limitations, []);
  assert.equal(p1.clips.length, 744);
  assert.deepEqual(p1.clips, p2.clips, 'the same clips, every note where version 2 has it');
  assert.deepEqual(p1.clips.filter((c) => !c.rendered).map((c) => c.id), []);
  assert.deepEqual(p1.automation.map((a) => a.id), p2.automation.map((a) => a.id)
    .filter((id) => id !== 'lane-bass-q'), 'its lanes are version 2\'s but the Q lane');
  assert.ok(p1.automation.every((a) => a.rendered));
});

test('K144 what the Studio cannot play is left out and said, never shipped inert', () => {
  const m = templateModel('demo-song');
  assert.ok(!m.graph.nodes.some((n) => n.type === 'drive'), 'no Drive node on this tree');
  assert.equal(DEMO_SONG_OMITTED.length, 2);
  assert.match(DEMO_SONG_OMITTED.join(' '), /velocity.*Drive node/s);
  assert.ok(!/Q lane/.test(DEMO_SONG_OMITTED.join(' ')), 'the Q lane plays since version 2');
  assert.ok(S.AUTOMATION.drive.length > 0, 'the score keeps it for when the Studio can play it');
  const learn = [demoSong.learn.summary, ...demoSong.learn.points].join(' ');
  assert.match(learn, /original/);
  assert.match(learn, /sine sweep/);
  assert.match(learn, /filtered noise/);
  assert.match(learn, /Velocity is not represented/);
});

test('K144 a tempo change moves every clip, and undo restores the song', () => {
  const store = createStudioStore(templateModel('demo-song'), { idGenerator: ids() });
  const before = serializeStudio(store.getModel());
  const r = store.dispatch({ type: 'TRANSPORT_SET', tempo: 120 });
  assert.equal(r.ok, true, r.reason);
  const spb = 60 / 120;
  for (const c of store.getModel().timeline.clips) {
    assert.ok(Math.abs(c.start - c.musical.startBeats * spb) <= 1e-6, c.id);
  }
  const end = Math.max(...store.getModel().timeline.clips.map((c) => c.start + c.duration));
  assert.equal(Math.round(end * 1000) / 1000, 88);
  store.undo();
  assert.equal(serializeStudio(store.getModel()), before);
});

test('K144 the link #m=studio&st=demo-song opens it', () => {
  const hash = encodeStudioLink({ templateId: 'demo-song' });
  assert.equal(hash, 'm=studio&st=demo-song');
  assert.equal(decodeStudioLink(hash).templateId, 'demo-song');
});

// The interval shape of the one riff the owner named as the style (E-E-G-E-D-C-B): repeat, up a
// minor third, down a minor third, down a tone, down a tone, down a semitone. The song shares
// at most two consecutive intervals with it in either line, so it neither quotes nor closely
// paraphrases it. Only that riff is compared, not a database of melodies.
const STYLE_RIFF_INTERVALS = [0, 3, -3, -2, -2, -1];
function longestSharedRun(intervals, reference) {
  let best = 0;
  for (let i = 0; i < intervals.length; i++) {
    for (let j = 0; j < reference.length; j++) {
      let k = 0;
      while (i + k < intervals.length && j + k < reference.length
        && intervals[i + k] === reference[j + k]) k++;
      best = Math.max(best, k);
    }
  }
  return best;
}

test('K144 the bass and lead share at most two consecutive intervals with the style riff', () => {
  for (const part of ['bass', 'lead']) {
    const notes = S.partNotes(part).map((n) => n[1]);
    const intervals = notes.slice(1).map((n, i) => n - notes[i]);
    assert.ok(longestSharedRun(intervals, STYLE_RIFF_INTERVALS) <= 2, part);
  }
  assert.equal(longestSharedRun([5, 0, 3, -3, -2, 7], STYLE_RIFF_INTERVALS), 4,
    'the measure finds a shared run');
});
