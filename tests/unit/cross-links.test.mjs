// U010 cross-links and honest link labels (UX link audit 2026-10-29, links.md): the pure half.
// Every cross-link the page offers resolves to a route the router already has, each lab's Studio
// link names a shipped template and is written once in src/index.html with that address, the
// Studio's Back returns to the workspace it was opened from, and the labels say what the
// controls do (B1, B2, B6, B7, B8, B12). The browser half (round trips: navigation, state, focus,
// Back / Forward, pointer, keyboard and touch) is tests/browser/cross-links.cjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import * as crossLinks from '../../src/js/ui/cross-links.js';
import {
  LEARN_TOOLS, STUDIO_TEMPLATE_LINKS, filterLabToggle, learnReturnAction, learnToolOf,
  studioBackTarget, studioTemplateHref, studioTemplateText, workspacePhrase,
} from '../../src/js/ui/cross-links.js';
import { WORKSPACES } from '../../src/js/ui/app.js';
import { routeOfHash } from '../../src/js/ui/navigation.js';
import { decodeStudioLink } from '../../src/js/core/url-state-studio.js';
import { getTemplate } from '../../src/js/studio/templates/index.js';
import { LEARN_TOPICS } from '../../src/js/data/learn.js';

const PAGE = readFileSync(new URL('../../src/index.html', import.meta.url), 'utf8');
const attr = (s) => s.replace(/&/g, '&amp;');

/** The opening tag of the one element carrying data-osc="<name>" (fails when not exactly one). */
function tagOf(name) {
  const re = new RegExp(`<[a-z]+\\b[^>]*\\bdata-osc="${name.replace(/\./g, '\\.')}"[^>]*>`, 'g');
  const all = PAGE.match(re) || [];
  assert.equal(all.length, 1, `exactly one element with data-osc="${name}" (${all.length})`);
  return all[0];
}

test('each lab links to a shipped Studio template, by an address the router opens (P3)', () => {
  assert.ok(STUDIO_TEMPLATE_LINKS.length >= 5);
  for (const l of STUDIO_TEMPLATE_LINKS) {
    const t = getTemplate(l.template);
    assert.ok(t, `${l.id}: template ${l.template} is shipped`);
    assert.equal(l.title, t.title, `${l.id}: the link names the template as Studio does`);
    assert.ok(WORKSPACES.includes(l.from), `${l.id}: shown in a workspace of the navigation`);
    const href = studioTemplateHref(l.template);
    const link = decodeStudioLink(href);
    assert.ok(link && link.ok, `${l.id}: ${href} is a valid Studio link`);
    assert.equal(link.templateId, l.template);
    assert.equal(routeOfHash(href).workspace, 'studio', `${l.id}: ${href} opens Studio`);
  }
});

test('src/index.html writes each lab link once, with its address, text and workspace', () => {
  for (const l of STUDIO_TEMPLATE_LINKS) {
    const tag = tagOf(l.osc);
    assert.ok(tag.startsWith('<a '), `${l.osc} is a link`);
    assert.ok(tag.includes(`href="${attr(studioTemplateHref(l.template))}"`), `${l.osc}: href`);
    const at = PAGE.indexOf(tag) + tag.length;
    assert.equal(PAGE.slice(at, PAGE.indexOf('</a>', at)), studioTemplateText(l),
      `${l.osc}: its text names the template`);
    // A lab panel also shows on the Playground grid: the link is shown in its lab only.
    if (l.from !== 'measure') {
      assert.ok(tag.includes(' hidden') && tag.includes(`:hidden="workspace !== '${l.from}'"`),
        `${l.osc}: shown in ${l.from} only`);
    }
  }
});

test('each Learn tool names a topic and a workspace, and Learn renders the link (P5)', () => {
  const topics = new Set(LEARN_TOPICS.map((t) => t.id));
  for (const [topic, ws] of Object.entries(LEARN_TOOLS)) {
    assert.ok(topics.has(topic), `${topic} is a Learn topic`);
    assert.ok(WORKSPACES.includes(ws), `${topic}: ${ws} is a workspace`);
    const tool = learnToolOf(topic);
    assert.equal(routeOfHash(tool.href).workspace, ws, `${topic}: ${tool.href} opens ${ws}`);
    assert.match(tool.text, /^Open [A-Z]/);
  }
  assert.equal(learnToolOf('frequency'), null, 'a topic without a tool gets no link');
  assert.equal(learnToolOf('__proto__'), null);
  assert.match(PAGE, /<template x-if="learnToolOf\(t\.id\)">\s*<a :href="learnToolOf\(t\.id\)\.href" data-osc="learn\.tool"/);
});

// A1 connect (page audit 2026-11-02, Learn): every topic that teaches a tool links to it, and a
// topic without a link says why. The browser half (each link opens its tool, the notice leads
// back) is tests/browser/cross-links.cjs learn-tool.
test('A1: every Learn topic has a tool link or a stated reason for none, never both', () => {
  const noTool = crossLinks.LEARN_NO_TOOL;
  assert.ok(noTool && typeof noTool === 'object', 'cross-links.js exports LEARN_NO_TOOL');
  for (const t of LEARN_TOPICS) {
    const tool = Object.hasOwn(LEARN_TOOLS, t.id);
    const reason = Object.hasOwn(noTool, t.id);
    assert.ok(tool !== reason, `${t.id}: a tool (${tool}) or a reason for none (${reason})`);
    if (reason) {
      assert.ok(noTool[t.id].split(' ').length >= 4, `${t.id}: the reason says something`);
      assert.equal(learnToolOf(t.id), null, `${t.id}: no tool link`);
    }
  }
  for (const id of Object.keys(noTool)) {
    assert.ok(LEARN_TOPICS.some((t) => t.id === id), `${id} is a Learn topic`);
  }
  // The tools the page audit found missing: the Analyzer shows the spectrum Nyquist and
  // aliasing are about; the Synth's engines are AM, FM and modulation; Measure sweeps on the
  // log scale; Compare holds the hearing ranges that place ultrasound.
  for (const [topic, ws] of [['waveform', 'analyzer'], ['nyquist', 'analyzer'],
    ['aliasing', 'analyzer'], ['modulation', 'synth'], ['am', 'synth'], ['fm', 'synth'],
    ['logscale', 'measure'], ['ultrasound', 'compare']]) {
    assert.equal(LEARN_TOOLS[topic], ws, `${topic} links to ${ws}`);
    assert.equal(learnToolOf(topic).href, `#m=${ws}`);
  }
  // A topic whose demo already opens the Synth needs no second link to it.
  for (const t of LEARN_TOPICS.filter((x) => x.demo.href)) {
    assert.ok(Object.hasOwn(noTool, t.id), `${t.id}: its demo is the tool`);
  }
});

test('a Learn demo and a Learn tool link carry the way back to the lesson (one-way link 2)', () => {
  const topic = LEARN_TOPICS.find((t) => t.id === 'harmonic');
  const back = learnReturnAction(topic);
  assert.equal(routeOfHash(back.href).workspace, 'learn');
  assert.equal(back.text, 'Back to the lesson: Harmonics');
  assert.match(PAGE, /<template x-if="a\.action">\s*<a :href="a\.action\.href" data-osc="alert\.action"/);
  const src = readFileSync(new URL('../../src/js/ui/workbench.js', import.meta.url), 'utf8');
  assert.match(src, /this\.runDemo\(topic, \{ action: learnReturnAction\(topic\) \}\)/);
});

test('the Studio Back returns where the Studio was opened from (P8, one-way link 1)', () => {
  assert.equal(studioBackTarget('sequencer'), 'sequencer');
  assert.equal(studioBackTarget('filter'), 'filter');
  assert.equal(studioBackTarget('playground'), 'playground');
  for (const none of [undefined, null, '', 'studio', 'bogus', '__proto__']) {
    assert.equal(studioBackTarget(none), 'playground', String(none));
  }
  assert.equal(workspacePhrase('sequencer'), 'the Sequencer');
  assert.equal(workspacePhrase('playground'), 'the Playground');
  assert.equal(workspacePhrase('filter'), 'Filter Lab');
  const tag = tagOf('studio.back');
  assert.ok(tag.includes(':aria-label="studioBackText()"') && tag.includes(':title="studioBackText()"'));
});

test('the Filter Lab ⤢ button says where it goes and goes there (B1)', () => {
  assert.deepEqual(filterLabToggle('playground'),
    { to: 'filter', label: 'Open the Filter Lab page', icon: '#i-expand' });
  assert.deepEqual(filterLabToggle('filter'),
    { to: 'playground', label: 'Back to the Playground', icon: '#i-left' });
  assert.match(PAGE, /<symbol id="i-left"/);
  const tag = tagOf('filter.fullscreen');
  assert.ok(tag.includes(':aria-label="filterLabToggle().label"'), 'the name follows the target');
  assert.ok(tag.includes('@click="setWorkspace(filterLabToggle().to)"'), 'the click goes there');
});

test('the header and Measure name what their links and buttons do (B2, B6, B7, B8)', () => {
  // The skip link's label names the workspace shown (H004 B7, ui/app.js syncSkipLink).
  assert.match(PAGE, /<a class="osc-skip" href="#osc-main">Skip to main content: Playground<\/a>/);
  // The logo keeps the product's name (positioning-consistency) and says where it goes (H004 B6).
  assert.match(PAGE, /<a href="#m=playground" x-bind="homeLink\(\)" data-osc="header\.brand" title="Open the Playground"\s+aria-label="OSCILLA · Interactive Sound &amp; Frequency Lab"/);
  assert.ok(tagOf('header.help').includes('aria-label="Keyboard shortcuts"'));
  const toExp = tagOf('measure.toExperiments');
  assert.ok(toExp.includes(`@click="setWorkspace('experiments', { focusHeading: true })"`),
    'focus lands on the Experiments heading');
  assert.match(PAGE, /data-osc="measure\.toExperiments"[^>]*>Open Experiments<\/button>/);
});

test('the empty states lead to the next step (B12, P1)', () => {
  for (const [name, href] of [['exp.toMeasure', '#m=measure'], ['def.toMeasure', '#m=measure'],
    ['fnd.toExperiments', '#osc-exp-list'], ['presets.toPlayground', '#m=playground']]) {
    const tag = tagOf(name);
    assert.ok(tag.startsWith(`<a href="${href}"`), `${name} links ${href}`);
    // a legacy empty row, or a Pro row (F003, Presets) that marks itself data-empty-row
    const at = PAGE.lastIndexOf('<li ', PAGE.indexOf(tag));
    assert.match(PAGE.slice(at, PAGE.indexOf(tag)), /class="osc-x-empty"|\bdata-empty-row\b/,
      `${name} is in an empty-state row`);
  }
  assert.match(PAGE, /<section class="osc-panel osc-x-list" id="osc-exp-list"/);
});

// P4: the Sequencer's own pattern opens in Studio through the sequence import pipeline (K004).
test('the Sequencer offers its own pattern to Studio through importSequence (P4)', async () => {
  const { referenceSequence, serializeSequence } = await import('../../src/js/sequencer/model.js');
  const { importSequence } = await import('../../src/js/studio/sequence-import.js');
  const seq = serializeSequence(referenceSequence({ sampleRate: 48000 }));
  const r = importSequence(seq, { sampleRate: 48000, title: 'Sequencer pattern' });
  assert.ok(r.ok, JSON.stringify(r.errors));
  assert.equal(r.model.metadata.title, 'Sequencer pattern');
  assert.equal(r.model.timeline.clips.length, seq.blocks.length, 'one clip per block');
  const tag = tagOf('seq.toStudio');
  assert.ok(tag.startsWith('<a href="#m=studio"'), 'a link whose address opens Studio');
  assert.ok(tag.includes('@click="studioOpenSequence($event)"'), 'a plain click opens the pattern');
  assert.ok(tag.includes(` hidden :hidden="workspace !== 'sequencer'"`),
    'shown in the Sequencer only (the Playground grid keeps its layout)');
  const at = PAGE.indexOf(tag) + tag.length;
  assert.equal(PAGE.slice(at, PAGE.indexOf('</a>', at)).replace(/\s+/g, ' '),
    'Open this pattern in Studio');
  const ws = readFileSync(new URL('../../src/js/ui/studio/workspace.js', import.meta.url), 'utf8');
  const body = ws.slice(ws.indexOf('    studioOpenSequence(e) {'));
  const fn = body.slice(0, body.indexOf('\n    },\n'));
  assert.ok(fn.indexOf('ctx.dirty.isDirty') >= 0
    && fn.indexOf('ctx.dirty.isDirty') < fn.indexOf('openDocument('),
  'unsaved Studio changes are checked before the document is replaced');
  const main = readFileSync(new URL('../../src/js/main.js', import.meta.url), 'utf8');
  assert.match(main, /currentSequence: \(\) => \(labs\.sequencer \? serializeSequence\(labs\.sequencer\.editor\.model\) : null\)/);
});

// The notices are in flow: one that never closed would push the page down until dismissed. A
// notice with a link (the way back to a lesson) closes on its own too, later than a plain one,
// and waits while the pointer is over the notices or focus is in them.
test('a notice with a link closes on its own, later, and never under the pointer or focus',
  async (t) => {
    const { ACTION_NOTICE_MS, NOTICE_MS, createInstrument } = await import(
      '../../src/js/core/instrument.js');
    assert.ok(ACTION_NOTICE_MS > NOTICE_MS);
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const app = createInstrument({ engine: null });
    const topic = LEARN_TOPICS.find((x) => x.id === 'harmonic');
    app.notify('success', 'Demo ready: x', 'Press', { action: learnReturnAction(topic) });
    app.notify('info', 'Plain', 'no link');
    t.mock.timers.tick(NOTICE_MS);
    assert.deepEqual(app.alerts.map((a) => a.title), ['Demo ready: x'],
      'the plain notice closed, the one with a link stays longer');
    t.mock.timers.tick(ACTION_NOTICE_MS - NOTICE_MS);
    assert.equal(app.alerts.length, 0, 'the notice with a link closed on its own');

    // The pointer over the notices (or focus in them) holds a notice with a link open.
    let hovered = true;
    const region = { matches: () => hovered, contains: () => false };
    globalThis.document = { querySelector: () => region, activeElement: null };
    try {
      app.notify('info', 'Opened Analyzer from the lesson', 'Harmonics',
        { action: learnReturnAction(topic) });
      t.mock.timers.tick(ACTION_NOTICE_MS + 3 * NOTICE_MS);
      assert.equal(app.alerts.length, 1, 'held open while the pointer is on it');
      hovered = false;
      t.mock.timers.tick(NOTICE_MS);
      assert.equal(app.alerts.length, 0, 'closes once the pointer has left');
    } finally {
      delete globalThis.document;
    }
  });

// A1 connect (page audit 2026-11-02, Presets): Load never says "Press TRIGGER" on the Presets
// page, which shows no TRIGGER. It stays in Presets (presets are tried one after another; Space
// plays them there, ui/shortcuts.js SPACE_OWNER), says so, and links to the workspace whose
// transport plays the preset: Synthesis for a dual-oscillator preset, else the Playground.
test('A1: a preset loaded in Presets says what plays it there and links to its transport',
  async () => {
    const { presetLoadedNotice } = await import('../../src/js/core/preset-notice.js');
    const { createInstrument } = await import('../../src/js/core/instrument.js');
    for (const [programmed, source, href, words] of [
      [true, 'single', '#m=playground', /^Press Space to play it here, or TRIGGER in the Pl/],
      [false, 'single', '#m=playground', /^Hold Space .*HOLD TO PLAY in the Playground/],
      [false, 'sweep', '#m=playground', /^Hold Space .*HOLD TO PLAY in the Playground/],
      [true, 'dual', '#m=synthesis', /^Press Space .*TRIGGER in Synthesis/],
    ]) {
      const n = presetLoadedNotice('presets', programmed, source);
      assert.match(n.message, words);
      assert.equal(n.action.href, href);
      assert.equal(routeOfHash(n.action.href).workspace, href.slice(3));
      assert.match(n.action.text, /^Open (the Playground|Synthesis)$/);
    }
    // Under a coarse pointer (a phone: no Space key) the notice offers the tap: the link to
    // the workspace whose own control starts the sound, worded to match; no Space.
    for (const [programmed, source, href, words] of [
      [true, 'single', '#m=playground', 'Open the Playground to play it with TRIGGER.'],
      [false, 'single', '#m=playground', 'Open the Playground to play it with HOLD TO PLAY.'],
      [true, 'dual', '#m=synthesis', 'Open Synthesis to play it with TRIGGER.'],
    ]) {
      const n = presetLoadedNotice('presets', programmed, source, true);
      assert.equal(n.message, words);
      assert.doesNotMatch(n.message, /Space/);
      assert.equal(n.action.href, href);
      assert.equal(presetLoadedNotice('presets', programmed, source, false).action.href, href);
    }
    assert.deepEqual(presetLoadedNotice('playground', true, 'single', true),
      presetLoadedNotice('playground', true, 'single', false), 'the V1 text stands on a phone');
    // Where the transport is on screen, the V1 text stands and nothing is linked.
    for (const mode of ['playground', 'dual', 'sweep']) {
      assert.deepEqual(presetLoadedNotice(mode, true, 'single'),
        { message: 'Press TRIGGER (or Space) to play it.', action: null });
      assert.deepEqual(presetLoadedNotice(mode, false, 'single'),
        { message: 'Press and hold HOLD TO PLAY.', action: null });
    }
    // Through the instrument: Load in Presets carries the link; nowhere does it say TRIGGER
    // without the workspace that has it.
    const { BUILTIN_PRESETS } = await import('../../src/js/data/presets.js');
    const app = createInstrument({ engine: null });
    app.sampleRate = 48000;
    app.mode = 'presets';
    for (const p of BUILTIN_PRESETS.filter((x) => !x.requiresHeadphones)) {
      app.alerts = [];
      app.applyPreset(p);
      const loaded = app.alerts.find((x) => x.title.startsWith('Loaded'));
      if (!loaded) continue; // partly applied: a warning, no "Loaded"
      assert.doesNotMatch(loaded.message, /^Press TRIGGER/, `${p.id}: ${loaded.message}`);
      assert.match(loaded.message, /Space/, p.id);
      assert.ok(loaded.action && /^#m=(playground|synthesis)$/.test(loaded.action.href), p.id);
    }
    // The instrument asks the host for a coarse pointer: on a phone the notice names no Space.
    const phone = createInstrument({ engine: null,
      env: { matchMedia: (q) => ({ matches: q === '(pointer: coarse)' }), innerWidth: 390 } });
    phone.sampleRate = 48000;
    phone.mode = 'presets';
    phone.applyPreset(BUILTIN_PRESETS.find((x) => x.id === 'ref-440'));
    const said = phone.alerts.find((x) => x.title.startsWith('Loaded'));
    assert.ok(said, 'Load on a phone announces the preset');
    assert.match(said.message, /^Open the Playground to play it with /);
    assert.equal(said.action.href, '#m=playground');
  });
