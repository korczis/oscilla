// K172: spoken and shown Studio text picks 'a' or 'an' by how the word is said, not by its first
// letter. One helper (src/js/studio/a11y.js indefiniteArticle / withArticle) decides it for every
// node label or kind the Studio speaks or shows; this file fails on the merge base, where the
// helper does not exist and the Studio says "a LFO", "a RTA" and "A event clip".

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { indefiniteArticle, withArticle } from '../../src/js/studio/a11y.js';
import { CLIP_TARGET_TEXT } from '../../src/js/studio/clip-targets.js';
import { NODE_REGISTRY } from '../../src/js/studio/registry.js';
import { clipTrackReason } from '../../src/js/studio/timeline.js';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));

test('K172 initialisms follow their first letter name; MIDI is said as a word', () => {
  for (const [word, want] of [
    ['LFO', 'an LFO'], ['RTA', 'an RTA'], ['FM engine', 'an FM engine'],
    ['AM/ring engine', 'an AM/ring engine'], ['XY Pad', 'an XY Pad'], ['MIDI', 'a MIDI'],
    ['HP', 'an HP'], ['SPL meter', 'an SPL meter'], ['NR', 'an NR'], ['X', 'an X'],
    ['VCO', 'a VCO'], ['DC offset', 'a DC offset'], ['FFT', 'an FFT'], ['IR', 'an IR'],
    ['UI', 'a UI'], ['ADSR', 'an ADSR'], ['CV', 'a CV'], ['EQ', 'an EQ'], ['B', 'a B'],
    ['WAV export', 'a WAV export'], ['OSCILLA patch', 'an OSCILLA patch'],
  ]) assert.equal(withArticle(word), want, word);
});

test('K172 ordinary words take the article of their spoken start', () => {
  for (const [word, want] of [
    ['Filter', 'a Filter'], ['Oscillator', 'an Oscillator'], ['Unison', 'a Unison'],
    ['Envelope', 'an Envelope'], ['All-pass', 'an All-pass'], ['Low-pass', 'a Low-pass'],
    ['Mixer', 'a Mixer'], ['Microphone', 'a Microphone'], ['Noise', 'a Noise'],
    ['Ring', 'a Ring'], ['Sequence', 'a Sequence'], ['event', 'an event'],
    ['measurement', 'a measurement'], ['Additive engine', 'an Additive engine'],
    ['Umbrella', 'an Umbrella'], ['upper', 'an upper'], ['user', 'a user'],
    ['utility', 'a utility'], ['European', 'a European'], ['one-shot', 'a one-shot'],
    ['onset', 'an onset'], ['hour', 'an hour'], ['Harmonic', 'a Harmonic'],
    ['Oscillator 1 frequency', 'an Oscillator 1 frequency'], ['LFO 1 rate', 'an LFO 1 rate'],
  ]) assert.equal(withArticle(word), want, word);
});

test('K172 capital starts a sentence; indefiniteArticle returns the article alone', () => {
  assert.equal(withArticle('event', { capital: true }), 'An event');
  assert.equal(withArticle('pattern', { capital: true }), 'A pattern');
  assert.equal(indefiniteArticle('LFO'), 'an');
  assert.equal(indefiniteArticle('Unison'), 'a');
  assert.equal(indefiniteArticle(''), 'a');
});

test('K172 every node display name in the registry gets the spoken article', () => {
  const AN = new Set(['Additive engine', 'AM/ring engine', 'Envelope', 'FM engine', 'LFO',
    'Oscillator', 'RTA', 'XY Pad']);
  const defs = NODE_REGISTRY.list();
  assert.ok(defs.length > 20);
  for (const { displayName: name } of defs) {
    assert.equal(indefiniteArticle(name), AN.has(name) ? 'an' : 'a', name);
  }
});

test('K172 the Studio says "an LFO node" and "an RTA node", not "a LFO"', () => {
  assert.match(CLIP_TARGET_TEXT.notesTarget('LFO'), /; an LFO node does not play notes\.$/);
  assert.match(CLIP_TARGET_TEXT.notesTarget('RTA'), /; an RTA node does not play notes\.$/);
  assert.match(CLIP_TARGET_TEXT.notesTarget('Filter'), /; a Filter node does not play notes\.$/);
  assert.match(CLIP_TARGET_TEXT.notesTarget('Oscillator'), /; an Oscillator node /);
});

test('K172 a clip on the wrong track: "An event clip cannot go on a measurement track."', () => {
  assert.equal(clipTrackReason({}, { kind: 'measurement' }, { kind: 'event' }),
    'An event clip cannot go on a measurement track.');
  assert.equal(clipTrackReason({}, { kind: 'event' }, { kind: 'measurement' }),
    'A measurement clip cannot go on an event track.');
});

test('K172 no module but a11y.js picks the article itself', () => {
  const files = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (p.endsWith('.js')) files.push(p);
    }
  };
  walk(join(ROOT, 'src/js'));
  const own = join(ROOT, 'src/js/studio/a11y.js');
  const decision = /['"]an['"]\s*:\s*['"]a['"]|['"]a['"]\s*:\s*['"]an['"]/;
  const offenders = files.filter((f) => f !== own && decision.test(readFileSync(f, 'utf8')))
    .map((f) => relative(ROOT, f));
  assert.deepEqual(offenders, []);
  assert.match(readFileSync(own, 'utf8'), /export function indefiniteArticle\(/);
});
