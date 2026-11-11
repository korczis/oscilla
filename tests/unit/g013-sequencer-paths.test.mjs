// G013 (Q035 2, decided with oscilla-c3): the Sequencer's onward paths are one visible Pro button
// row under its head, "Další cesty", no longer small links squeezed into the head beside Tempo.
// The Drums tab's step sequencer and pads (seq.toDrums, T10) is the primary button, then the
// Step Bass template, this sequence in the Studio (seq.toStudio, reused), the Sweep Sequence
// template and the Synth; every text is Czech (project.czech-prose), each the label its
// catalogue declaration gives. Shown in the Sequencer only: the Playground grid keeps its layout.
// Fails on 04d33aaf: no row, the links sit in the head with three English texts.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import CROSS_LINK_COMPONENTS from '../../src/js/ui/catalog/decl/cross-links.js';

const PAGE = readFileSync(new URL('../../src/index.html', import.meta.url), 'utf8');

const ROW = [
  ['seq.toDrums', '#m=synth&amp;yt=drums', 'Krokový sekvencer a pady (Bicí)', 'PRO.btnPrimary'],
  ['seq.toStepBass', '#m=studio&amp;st=step-bass', 'Krokový modulátor ve Studiu',
    'PRO.btnSecondary'],
  ['seq.toStudio', '#m=studio', 'Otevřít tuto sekvenci ve Studiu', 'PRO.btnSecondary'],
  ['seq.toStudioTemplate', '#m=studio&amp;st=sweep-sequence', 'Šablona Sweep Sequence ve Studiu',
    'PRO.btnSecondary'],
  ['seq.toSynth', '#m=synth', 'Otevřít Synth', 'PRO.btnSecondary'],
];

/** The markup of the element whose start tag carries `attr`, up to its closing tag. */
function element(attr, tag) {
  const at = PAGE.indexOf(attr);
  assert.ok(at > 0, `src/index.html has ${attr}`);
  const start = PAGE.lastIndexOf(`<${tag}`, at);
  const end = PAGE.indexOf(`</${tag}>`, at);
  return PAGE.slice(start, end + tag.length + 3);
}

/** The links of `html` in order: [data-osc, href, text, start tag]. */
const links = (html) => [...html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/g)]
  .map(([, attrs, body]) => [(attrs.match(/data-osc="([^"]+)"/) || [])[1],
    (attrs.match(/href="([^"]+)"/) || [])[1], body.replace(/\s+/g, ' ').trim(), attrs]);

test('G013: one Pro button row "Další cesty" under the Sequencer head, in the Sequencer only',
  () => {
  const row = element('id="osc-seq-paths"', 'div');
  assert.match(row, /^<div[^>]*role="group"[^>]*aria-labelledby="osc-seq-paths-title"/);
  assert.match(row, /^<div[^>]*hidden :hidden="workspace !== 'sequencer'"/);
  assert.match(row, /id="osc-seq-paths-title"[^>]*>Další cesty</);
  const head = element('class="osc-panel-header osc-seq-head', 'div');
  const after = PAGE.indexOf(head) + head.length;
  assert.ok(PAGE.indexOf('id="osc-seq-paths"') > after
    && PAGE.indexOf('id="osc-seq-paths"') < PAGE.indexOf('class="osc-seq-timeline-wrap"'),
  'between the head and the timeline');
  const inHead = links(head).map(([osc]) => osc).filter((o) => o && o.startsWith('seq.to'));
  assert.deepEqual(inHead, [], 'no onward link left in the head');
});

test('G013: the row\'s order, addresses, Czech texts and Pro buttons; Bicí is the primary', () => {
  const got = links(element('id="osc-seq-paths"', 'div'));
  assert.deepEqual(got.map(([osc, href, text]) => [osc, href, text]),
    ROW.map(([osc, href, text]) => [osc, href, text]));
  got.forEach(([osc, , , attrs], i) => {
    assert.ok(attrs.includes(`:class="${ROW[i][3]}"`), `${osc} is a ${ROW[i][3]}`);
    assert.match(attrs, /\shidden\s+:hidden="workspace !== 'sequencer'"/, `${osc} hidden`);
  });
  const seq = got.find(([osc]) => osc === 'seq.toStudio')[3];
  assert.ok(seq.includes('@click="studioOpenSequence($event)"'), 'it still opens the pattern');
  const synth = got.find(([osc]) => osc === 'seq.toSynth')[3];
  assert.ok(synth.includes('x-bind="counterpartLink(\'synth\')"'), 'still the counterpart link');
});

test('G013: each catalogue label is the text the row shows', () => {
  const byId = new Map(CROSS_LINK_COMPONENTS.map((c) => [c.id, c]));
  for (const [osc, , text] of ROW) {
    assert.ok(byId.has(osc), `${osc} is declared`);
    assert.equal(byId.get(osc).label, text, `${osc}'s catalogue label`);
  }
});
