// The riff library (B3): short ORIGINAL riffs, each written for OSCILLA on 2026-11-02 in the
// style of a genre and an era, never a transcription or a quotation of a recorded song. A
// style is named by its genre and era only (no artist, no song title): a style is a shared
// vocabulary of a period, a song is somebody's work. Pure data; expand.js turns a riff into
// Studio clips.
//
// Grid: 16 sixteenth steps per bar. A note is [step, pitch, lengthSteps, velocity], its step
// counted from the riff's first bar; a riff is monophonic (one note sounds at a time), so one
// oscillator voice plays it. Velocity is part of the writing; a Studio clip has no level yet,
// so expand.js does not play it (as the demo song).
//
// voice: what the riff was written for, as Oscillator and Filter parameters; Insert uses them
// when it builds a voice for a riff.

const r = (o) => Object.freeze({ ...o, origin: 'original',
  style: `Original, in the style of ${o.genre} (${o.era})`,
  notes: Object.freeze(o.notes.map((n) => Object.freeze(n))) });

export const RIFFS = Object.freeze([
  r({
    id: 'mirrorball-octaves', title: 'Mirrorball Octaves', genre: 'disco', era: 'late 1970s',
    role: 'bass', tempo: 118, key: 'A minor', bars: 2,
    voice: { waveform: 'sawtooth', cutoff: 900, Q: 2 },
    notes: [
      [0, 'A1', 2, 110], [2, 'A2', 2, 90], [4, 'A1', 2, 104], [6, 'A2', 2, 88],
      [8, 'C2', 2, 106], [10, 'C3', 2, 90], [12, 'D2', 2, 104], [14, 'D3', 2, 88],
      [16, 'F1', 2, 110], [18, 'F2', 2, 90], [20, 'F1', 2, 104], [22, 'F2', 2, 88],
      [24, 'G1', 2, 106], [26, 'G2', 2, 90], [28, 'E1', 2, 104], [30, 'E2', 2, 96],
    ],
  }),
  r({
    id: 'sidewalk-strut', title: 'Sidewalk Strut', genre: 'synth-funk pop', era: 'early 1980s',
    role: 'bass', tempo: 112, key: 'E minor', bars: 2,
    voice: { waveform: 'square', cutoff: 700, Q: 3 },
    notes: [
      [0, 'E1', 3, 112], [3, 'E2', 1, 84], [6, 'G1', 2, 100], [8, 'A1', 1, 96],
      [10, 'B1', 2, 104], [13, 'D2', 1, 80], [14, 'B1', 2, 92],
      [16, 'E1', 3, 112], [19, 'E2', 1, 84], [22, 'D2', 2, 100], [24, 'B1', 1, 96],
      [26, 'A1', 2, 104], [28, 'G1', 1, 86], [30, 'A1', 2, 94],
    ],
  }),
  r({
    id: 'velour-filter', title: 'Velour Filter', genre: 'French house', era: 'late 1990s',
    role: 'lead', tempo: 124, key: 'D minor', bars: 2,
    voice: { waveform: 'sawtooth', cutoff: 1400, Q: 6 },
    notes: [
      [0, 'D4', 1, 100], [2, 'F4', 1, 90], [3, 'A4', 2, 104], [6, 'G4', 1, 88],
      [8, 'F4', 1, 96], [10, 'D4', 1, 84], [11, 'C4', 2, 100], [14, 'D4', 2, 92],
      [16, 'A#3', 1, 100], [18, 'D4', 1, 90], [19, 'F4', 2, 104], [22, 'E4', 1, 88],
      [24, 'D4', 1, 96], [26, 'C4', 1, 84], [27, 'A3', 3, 100], [30, 'C4', 2, 90],
    ],
  }),
  r({
    id: 'silver-squelch', title: 'Silver Squelch', genre: 'acid house', era: 'late 1980s',
    role: 'bass', tempo: 126, key: 'A minor', bars: 1,
    voice: { waveform: 'sawtooth', cutoff: 600, Q: 14 },
    notes: [
      [0, 'A1', 1, 112], [1, 'A1', 1, 70], [2, 'A2', 1, 100], [3, 'A1', 1, 76],
      [4, 'C2', 1, 104], [5, 'A1', 1, 72], [6, 'E2', 1, 96], [7, 'G2', 1, 108],
      [8, 'A1', 1, 110], [9, 'A2', 1, 90], [10, 'A1', 1, 74], [11, 'D#2', 1, 100],
      [12, 'E2', 1, 106], [13, 'A1', 1, 72], [14, 'C3', 1, 102], [15, 'A1', 1, 80],
    ],
  }),
  r({
    id: 'neon-causeway', title: 'Neon Causeway', genre: 'synthwave', era: '2010s retro',
    role: 'arp', tempo: 100, key: 'A minor', bars: 4,
    voice: { waveform: 'square', cutoff: 2600, Q: 2 },
    notes: [
      ...[0, 1, 2, 3].flatMap((bar) => {
        const chord = [['A3', 'C4', 'E4', 'A4'], ['F3', 'A3', 'C4', 'F4'],
          ['C4', 'E4', 'G4', 'C5'], ['G3', 'B3', 'D4', 'G4']][bar];
        const order = [0, 1, 2, 3, 2, 1, 2, 3, 0, 1, 2, 3, 2, 3, 1, 2];
        return order.map((k, i) => [bar * 16 + i, chord[k], 1, i % 4 === 0 ? 104 : 84]);
      }),
    ],
  }),
  r({
    id: 'orbit-sequence', title: 'Orbit Sequence', genre: 'Berlin school', era: 'mid 1970s',
    role: 'arp', tempo: 108, key: 'E minor', bars: 2,
    voice: { waveform: 'sawtooth', cutoff: 1800, Q: 5 },
    notes: [
      [0, 'E2', 1, 104], [1, 'B2', 1, 84], [2, 'E3', 1, 92], [3, 'G3', 1, 84],
      [4, 'F#3', 1, 96], [5, 'E3', 1, 82], [6, 'B2', 1, 90], [7, 'D3', 1, 84],
      [8, 'E2', 1, 104], [9, 'B2', 1, 84], [10, 'E3', 1, 92], [11, 'A3', 1, 86],
      [12, 'G3', 1, 96], [13, 'F#3', 1, 82], [14, 'D3', 1, 90], [15, 'B2', 1, 84],
      [16, 'C2', 1, 104], [17, 'G2', 1, 84], [18, 'C3', 1, 92], [19, 'E3', 1, 84],
      [20, 'D3', 1, 96], [21, 'C3', 1, 82], [22, 'G2', 1, 90], [23, 'B2', 1, 84],
      [24, 'D2', 1, 104], [25, 'A2', 1, 84], [26, 'D3', 1, 92], [27, 'F#3', 1, 86],
      [28, 'E3', 1, 96], [29, 'D3', 1, 82], [30, 'A2', 1, 90], [31, 'F#2', 1, 84],
    ],
  }),
  r({
    id: 'riviera-night', title: 'Riviera Night', genre: 'Italo disco', era: 'mid 1980s',
    role: 'bass', tempo: 120, key: 'G minor', bars: 2,
    voice: { waveform: 'sawtooth', cutoff: 1100, Q: 3 },
    notes: [
      ...[0, 1].flatMap((bar) => {
        const roots = bar === 0 ? ['G1', 'G1', 'D#1', 'D#1'] : ['C2', 'C2', 'D2', 'D2'];
        return Array.from({ length: 8 }, (_, i) => {
          const low = roots[Math.floor(i / 2)];
          const high = low.replace(/\d$/, (o) => String(Number(o) + 1));
          return [bar * 16 + i * 2 + 1, i % 2 ? high : low, 1, i % 2 ? 92 : 106];
        });
      }),
    ],
  }),
  r({
    id: 'assembly-line', title: 'Assembly Line', genre: 'Detroit techno', era: 'early 1990s',
    role: 'lead', tempo: 128, key: 'F minor', bars: 2,
    voice: { waveform: 'square', cutoff: 1600, Q: 8 },
    notes: [
      [0, 'F4', 1, 108], [3, 'G#4', 1, 96], [6, 'F4', 1, 100], [8, 'C5', 2, 104],
      [11, 'A#4', 1, 92], [14, 'G#4', 1, 96],
      [16, 'F4', 1, 108], [19, 'G#4', 1, 96], [22, 'A#4', 1, 100], [24, 'D#5', 2, 104],
      [27, 'C5', 1, 92], [30, 'A#4', 2, 98],
    ],
  }),
  r({
    id: 'lowrider-sine', title: 'Lowrider Sine', genre: 'West Coast G-funk', era: 'early 1990s',
    role: 'lead', tempo: 92, key: 'C minor', bars: 2,
    voice: { waveform: 'sine', cutoff: 5000, Q: 1 },
    notes: [
      [0, 'G5', 4, 96], [4, 'D#5', 2, 88], [6, 'F5', 2, 90], [8, 'G5', 6, 100],
      [14, 'A#5', 2, 84],
      [16, 'C6', 4, 98], [20, 'A#5', 2, 88], [22, 'G5', 2, 90], [24, 'F5', 4, 94],
      [28, 'D#5', 4, 86],
    ],
  }),
  r({
    id: 'undertow', title: 'Undertow', genre: 'drum and bass', era: 'late 1990s',
    role: 'bass', tempo: 172, key: 'D minor', bars: 4,
    voice: { waveform: 'sawtooth', cutoff: 400, Q: 2 },
    notes: [
      [0, 'D1', 12, 112], [12, 'F1', 4, 100],
      [16, 'D1', 10, 110], [26, 'C1', 6, 98],
      [32, 'A#0', 12, 112], [44, 'C1', 4, 100],
      [48, 'D1', 8, 110], [56, 'F1', 4, 100], [60, 'E1', 4, 96],
    ],
  }),
  r({
    id: 'pixel-cascade', title: 'Pixel Cascade', genre: 'chiptune', era: '8-bit console',
    role: 'arp', tempo: 140, key: 'C major', bars: 2,
    voice: { waveform: 'square', cutoff: 8000, Q: 1 },
    notes: [
      ...[['C4', 'E4', 'G4'], ['A3', 'C4', 'E4'], ['F3', 'A3', 'C4'], ['G3', 'B3', 'D4']]
        .flatMap((tri, half) => Array.from({ length: 8 }, (_, i) =>
          [half * 8 + i, i === 7 ? tri[2].replace(/\d$/, (o) => String(Number(o) + 1))
            : tri[i % 3], 1, i === 0 ? 104 : 86])),
    ],
  }),
  r({
    id: 'uptown-walk', title: 'Uptown Walk', genre: 'Detroit soul', era: 'mid 1960s',
    role: 'bass', tempo: 104, key: 'C major', bars: 2,
    voice: { waveform: 'triangle', cutoff: 800, Q: 1 },
    notes: [
      [0, 'C2', 3, 106], [3, 'C2', 1, 80], [4, 'E2', 2, 96], [6, 'G2', 2, 94],
      [8, 'A2', 3, 100], [11, 'G2', 1, 82], [12, 'E2', 2, 92], [14, 'D#2', 2, 88],
      [16, 'F1', 3, 106], [19, 'F1', 1, 80], [20, 'A1', 2, 96], [22, 'C2', 2, 94],
      [24, 'G1', 3, 102], [27, 'G1', 1, 82], [28, 'B1', 2, 92], [30, 'D2', 2, 90],
    ],
  }),
  r({
    id: 'daybreak-gate', title: 'Daybreak Gate', genre: 'trance', era: 'late 1990s',
    role: 'lead', tempo: 138, key: 'A minor', bars: 4,
    voice: { waveform: 'sawtooth', cutoff: 3200, Q: 3 },
    notes: [
      ...['A4', 'F4', 'C5', 'G4'].flatMap((n, bar) => [0, 2, 3, 6, 8, 10, 11, 14]
        .map((s, i) => [bar * 16 + s, i === 3 || i === 7 ? n.replace(/\d$/, (o) =>
          String(Number(o) + 1)) : n, 1, i % 4 === 0 ? 108 : 88])),
    ],
  }),
  r({
    id: 'coldwave-pulse', title: 'Coldwave Pulse', genre: 'new wave', era: 'early 1980s',
    role: 'bass', tempo: 132, key: 'B minor', bars: 2,
    voice: { waveform: 'square', cutoff: 900, Q: 2 },
    notes: [
      ...['B1', 'B1', 'G1', 'A1'].flatMap((n, q) => Array.from({ length: 4 }, (_, i) =>
        [q * 8 + i * 2, i === 3 ? n.replace(/^([A-G]#?)/, (p) => ({ B: 'F#', G: 'D', A: 'E' })[p])
          .replace(/\d$/, (o) => String(Number(o) + 1)) : n, 2, i === 0 ? 106 : 90])),
    ],
  }),
  r({
    id: 'breakdance-bass', title: 'Breakdance Bass', genre: 'electro-funk', era: 'early 1980s',
    role: 'bass', tempo: 110, key: 'D minor', bars: 1,
    voice: { waveform: 'sawtooth', cutoff: 700, Q: 4 },
    notes: [
      [0, 'D2', 2, 112], [3, 'D2', 1, 84], [5, 'F2', 1, 96], [6, 'D2', 2, 104],
      [9, 'C2', 1, 90], [10, 'D2', 1, 100], [12, 'A1', 2, 104], [14, 'C2', 2, 94],
    ],
  }),
  r({
    id: 'click-loop', title: 'Click Loop', genre: 'minimal techno', era: 'early 2000s',
    role: 'lead', tempo: 126, key: 'G minor', bars: 1,
    voice: { waveform: 'sine', cutoff: 2400, Q: 6 },
    notes: [
      [2, 'G3', 1, 96], [5, 'A#3', 1, 84], [7, 'G3', 1, 90], [10, 'D4', 1, 100],
      [13, 'C4', 1, 86],
    ],
  }),
]);

export const ROLES = Object.freeze(['bass', 'lead', 'arp']);
export const BAR_STEPS = 16;
export const riffOf = (id) => RIFFS.find((x) => x.id === id) || null;
