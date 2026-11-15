// README.md's derived regions stay what the repository says (plan P014, owner decision Q107;
// claim readme-derived). scripts/facts.mjs is the one derivation of the facts and
// scripts/readme.mjs renders the regions from it; `npm run readme:check` runs in verify. Here:
//   - the committed README equals its regeneration, region by region;
//   - a hand edit inside a region, and a workspace added to the registry without regenerating,
//     are both reported stale by name (facts injected: renderRegions is pure);
//   - every image the README shows from the tree exists, and every gated reference the facts
//     list is an image the gallery shows;
//   - every fact group names the source it was read from, and that source exists;
//   - the README carries no copy of package.json's version (version:check, release rules).
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CHART_BASE, CHARTS, collectFacts } from '../../scripts/facts.mjs';
import {
  CHART_ALT, REGIONS, beginMarker, endMarker, renderRegions, staleRegions,
} from '../../scripts/readme.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (rel) => readFileSync(path.join(ROOT, rel), 'utf8');
const README = read('README.md');
const FACTS = await collectFacts({ git: false });
const clone = (x) => JSON.parse(JSON.stringify(x));

test('every derived region of README.md is current', () => {
  assert.deepEqual(staleRegions(README, FACTS), []);
  assert.equal(renderRegions(README, FACTS), README);
  for (const name of Object.keys(REGIONS)) {
    assert.equal(README.split(beginMarker(name)).length, 2, `${name}: one begin marker`);
    assert.equal(README.split(endMarker(name)).length, 2, `${name}: one end marker`);
  }
});

test('mutation: a hand edit inside a region is reported stale by name', () => {
  const edited = README.replace(/(derived:templates:begin[^\n]*\n)/,
    '$1A sentence typed by hand.\n');
  assert.notEqual(edited, README);
  assert.deepEqual(staleRegions(edited, FACTS).map((s) => s.name), ['templates']);
  assert.equal(renderRegions(edited, FACTS), README, 'regenerating removes the edit');
});

test('mutation: a workspace added to the registry makes the workspaces region stale', () => {
  const facts = clone(FACTS);
  facts.workspaces.items.push({ id: 'oscilloscope', label: 'Oscilloscope', group: null,
    groupLabel: null, summary: 'A new workspace nobody regenerated the README for.',
    deepLink: 'https://korczis.github.io/oscilla/#m=oscilloscope',
    related: [{ id: 'playground', why: 'Back to the instrument', hash: '',
      deepLink: 'https://korczis.github.io/oscilla/#m=playground' }] });
  assert.deepEqual(staleRegions(README, facts).map((s) => s.name), ['workspaces']);
  const next = renderRegions(README, facts);
  assert.ok(next.includes('| **Oscilloscope** |'), 'the table gains the row');
  assert.match(next, /ws_oscilloscope --> ws_playground/, 'the inferred map gains the edge');
  // Q107: README stays English while the registry's summaries and reasons are the app's Czech
  // prose (Q104), so neither reaches the README (P014).
  assert.ok(!next.includes('A new workspace nobody regenerated'), 'no summary in the README');
  assert.ok(!next.includes('Back to the instrument'), 'no reason in the README');
});

test('mutation: a missing marker is named, and rendering refuses it', () => {
  const cut = README.replace(endMarker('engines'), '');
  assert.deepEqual(staleRegions(cut, FACTS), [{ name: 'engines', problem: 'missing markers' }]);
  assert.throws(() => renderRegions(cut, FACTS), /engines has no begin\/end markers/);
});

test('every image README shows from the tree exists, and the gallery shows each reference', () => {
  const local = [
    ...[...README.matchAll(/!\[[^\]]*\]\(([^)\s]+)\)/g)].map((m) => m[1]),
    ...[...README.matchAll(/<img\s[^>]*src="([^"]+)"/g)].map((m) => m[1]),
  ].filter((src) => !/^https?:/.test(src));
  assert.ok(local.length > FACTS.screenshots.items.length / 2, `images found: ${local.length}`);
  for (const src of local) assert.ok(existsSync(path.join(ROOT, src)), `${src} exists`);
  const shown = new Set(local);
  const linked = new Set([...README.matchAll(/\]\((tests\/visual\/[^)\s]+)\)/g)].map((m) => m[1]));
  for (const s of FACTS.screenshots.items) {
    assert.ok(shown.has(s.path) || linked.has(s.path), `${s.path} is shown or linked`);
    assert.ok(s.alt.length > 20 && s.width > 0 && s.height > 0, `${s.path}: alt and size`);
  }
});

test('every fact group names the source it was read from, and the source exists', () => {
  const facts = clone(FACTS);
  const groups = Object.entries(facts).filter(([, v]) => v && typeof v === 'object');
  assert.ok(groups.length >= 10, `fact groups: ${groups.map(([k]) => k)}`);
  for (const [name, group] of groups) {
    assert.equal(typeof group.source, 'string', `${name}: source`);
    for (const part of group.source.split(' + ')) {
      const rel = part.replace(/\/\*.*$/, '').replace(/\/reference\.png$/, '');
      assert.ok(existsSync(path.join(ROOT, rel)), `${name}: ${part} exists`);
    }
  }
  assert.deepEqual(JSON.parse(JSON.stringify(FACTS)), FACTS, 'facts are plain JSON');
  assert.ok(FACTS.workspaces.items.length > 0 && FACTS.templates.items.length > 0
    && FACTS.engines.items.length > 0 && FACTS.releases.items.length > 0);
});

test('every chart of CHARTS is embedded in the live region with its own alt text', () => {
  const live = README.slice(README.indexOf(beginMarker('live')), README.indexOf(endMarker('live')));
  for (const name of CHARTS) {
    assert.ok(CHART_ALT[name], `${name}: alt text in scripts/readme.mjs CHART_ALT`);
    assert.ok(live.includes(`${CHART_BASE}${name}.svg" width="100%" alt="${CHART_ALT[name]}"`),
      `${name}: embedded`);
  }
});

test('the README carries no copy of the package version', () => {
  const { version } = JSON.parse(read('package.json'));
  assert.ok(!README.includes(version), `README.md names ${version}`);
  for (const name of Object.keys(REGIONS)) {
    const body = README.slice(README.indexOf(beginMarker(name)), README.indexOf(endMarker(name)));
    assert.doesNotMatch(body, /\bv?\d+\.\d+\.\d+\b/, `${name}: no version literal`);
  }
});
