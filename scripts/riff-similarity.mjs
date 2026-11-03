// The near-duplicate guard of the music library (plan issue K158): the owner's floor of 128
// entries counts distinct riffs only, never a transposed, shifted or one-note-edited copy.
//
// An entry becomes one token per note, read in onset order around the loop:
//   the pitch interval from the previous note, folded to -6..+6 semitones (an octave move is
//   no new melody), the onset delta in steps (the first note's delta wraps around the loop end),
//   and the note's length in steps.
// similarity(a, b) = 1 - d / max(|a|, |b|), where d is the smallest Levenshtein distance between
// a's tokens and any cyclic rotation of b's. So a transposition, an octave fold, a rotation or a
// time shift scores 1, re-pitching one note costs two tokens and re-timing a length one token.
// Two entries at or above THRESHOLD are one entry.
//
// THRESHOLD is calibrated on the shipped riffs (tests/unit/riff-similarity.test.mjs): on the 16
// riffs of 2026-11-03 the most similar distinct pair scored 0.453 (neon-causeway, pixel-cascade)
// and the least similar derivative 0.600 (click-loop with one note re-pitched, five notes).
export const THRESHOLD = 0.55;

const NAMES = { C: 0, 'C#': 1, D: 2, 'D#': 3, E: 4, F: 5, 'F#': 6, G: 7, 'G#': 8, A: 9,
  'A#': 10, B: 11 };
export const STEPS_PER_BAR = 16;

/** A note name ('A#3') as a MIDI number. */
export function midiOf(name) {
  const m = /^([A-G]#?)(-?\d)$/.exec(name);
  if (!m) throw new RangeError(`not a note name: ${name}`);
  return NAMES[m[1]] + 12 * (Number(m[2]) + 1);
}

const fold = (x) => ((((x + 6) % 12) + 12) % 12) - 6;

/** The entry's notes as tokens 'interval|delta|length', in onset order around the loop. */
export function noteTokens(entry) {
  const notes = [...entry.notes].sort((a, b) => a[0] - b[0]);
  const last = notes[notes.length - 1];
  const loop = (entry.bars || Math.ceil((last[0] + last[2]) / STEPS_PER_BAR)) * STEPS_PER_BAR;
  return notes.map((cur, i) => {
    const prev = notes[(i - 1 + notes.length) % notes.length];
    const delta = i === 0 ? cur[0] + loop - prev[0] : cur[0] - prev[0];
    return `${fold(midiOf(cur[1]) - midiOf(prev[1]))}|${delta}|${cur[2]}`;
  });
}

function levenshtein(a, b) {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i += 1) {
    const cur = [i];
    for (let j = 1; j <= b.length; j += 1) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length];
}

/** How alike two entries are, 0..1 (1: the same riff, whatever its key or start). */
export function similarity(x, y) {
  const a = noteTokens(x);
  const b = noteTokens(y);
  let best = Infinity;
  for (let k = 0; k < b.length; k += 1) {
    best = Math.min(best, levenshtein(a, [...b.slice(k), ...b.slice(0, k)]));
  }
  return 1 - best / Math.max(a.length, b.length);
}

/** Every pair of entries at or above the threshold, as problems. */
export function nearDuplicates(entries, threshold = THRESHOLD) {
  const out = [];
  for (let i = 0; i < entries.length; i += 1) {
    for (let j = i + 1; j < entries.length; j += 1) {
      const s = similarity(entries[i], entries[j]);
      if (s >= threshold) {
        out.push(`entry ${entries[j].id} is a near-duplicate of entry ${entries[i].id} `
          + `(similarity ${s.toFixed(3)} >= ${threshold})`);
      }
    }
  }
  return out;
}
