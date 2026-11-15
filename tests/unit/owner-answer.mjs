// K180: the owner's recorded answers that code must equal, read from the plan record itself so a
// test never retypes an owner decision. Used by tests/unit/synth-voice-pool.test.mjs and the
// e-poly, e-headroom and o-headroom checks of tests/browser/synth-engines.cjs.
//
//   engineVoices() -> { voices, gain, result }
//     Q021 (owner, 2026-11-03): "Up to 8 voices, 1/8 gain": an engine node holds `voices` voices
//     at `gain` (1/voices) of digital full scale each at the highest Level and velocity.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const Q021 = path.join(ROOT, '.ai', 'repo', 'project', 'issues', 'Q021.yaml');

export function engineVoices(text = fs.readFileSync(Q021, 'utf8')) {
  const block = text.split(/\n(?=\s*- covers: )/).find((b) => /covers: owner_decision/.test(b));
  if (!block) throw new Error('Q021 records no owner_decision evidence');
  const m = /result: "(.*)"/.exec(block);
  if (!m) throw new Error('Q021\'s owner_decision evidence has no result');
  const voices = /Up to (\d+) voices, 1\/(\d+) gain/.exec(m[1]);
  if (!voices) throw new Error(`Q021's answer names no voice count and gain: ${m[1]}`);
  const n = Number(voices[1]);
  const d = Number(voices[2]);
  if (n !== d) throw new Error(`Q021's answer: ${n} voices at 1/${d} gain do not sum to one`);
  return { voices: n, gain: 1 / d, result: m[1] };
}
