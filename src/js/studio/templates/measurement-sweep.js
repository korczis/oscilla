// Template: Measurement Sweep (spec §195, §106, §258; ADR 0038). Sweep → Master Output; Sweep
// reference → Transfer Analyzer; Microphone → Calibration → Transfer Analyzer → Measurement
// Result. The measurement track sequences the V3 measurement phases; a second track holds the
// capture window. Used for the Studio + Measurement integration and provenance tests.
import { clip, edge, marker, node, studioDoc, track } from './data.js';

const m = (action) => ({ action });

export default {
  id: 'measurement-sweep',
  version: 1,
  title: 'Measurement Sweep',
  category: 'measurement',
  learn: {
    summary: 'A transfer measurement: a logarithmic sweep plays through the output while the '
      + 'microphone records, and the Transfer Analyzer compares the two.',
    points: [
      'The Transfer Analyzer takes the exact digital stimulus on REFERENCE and the recording '
        + 'on OBSERVED; the two ports cannot be swapped.',
      'The microphone is for analysis only and can never reach the Master Output.',
      'Without a calibration profile the result is a relative response of the whole chain '
        + '(speaker, room, microphone), not an absolute level.',
    ],
  },
  studioHash: '6b7754b60524614f71cb4d32b3dd77e0f3da793ffb6da976f36b42242e3c9a84',
  model: studioDoc({
    title: 'Measurement Sweep',
    nodes: [
      node('sweep-1', 'sweep', 40, 80, { start: 20, end: 20000, duration: 5, curve: 'log',
        level: 0.5 }),
      node('master-1', 'master', 400, 80, {}, 'Master'),
      node('mic-1', 'microphone', 40, 300, {}),
      node('cal-1', 'calibration', 240, 300, {}),
      node('transfer-1', 'transfer-analyzer', 440, 220, {}),
      node('result-1', 'measurement-result', 640, 220, {}),
    ],
    edges: [
      edge('edge-1', 'sweep-1', 'audio', 'master-1', 'audio'),
      edge('edge-2', 'sweep-1', 'reference', 'transfer-1', 'reference'),
      edge('edge-3', 'mic-1', 'capture', 'cal-1', 'observed'),
      edge('edge-4', 'cal-1', 'observed', 'transfer-1', 'observed'),
      edge('edge-5', 'transfer-1', 'result', 'result-1', 'result'),
    ],
    tracks: [
      track('track-1', 'measurement', 'Measurement'),
      track('track-2', 'measurement', 'Capture', 'mic-1'),
    ],
    clips: [
      clip('clip-1', 'track-1', 'measurement', 0, 1, m('noise-check'), 'mic-1'),
      clip('clip-2', 'track-1', 'measurement', 1, 0.5, m('pre-roll')),
      clip('clip-3', 'track-1', 'measurement', 1.5, 5, m('stimulus'), 'sweep-1'),
      clip('clip-4', 'track-1', 'measurement', 6.5, 1, m('tail')),
      clip('clip-5', 'track-1', 'measurement', 7.5, 0.5, m('analysis'), 'transfer-1'),
      clip('clip-6', 'track-2', 'measurement', 1, 6.5, m('capture')),
    ],
    markers: [
      marker('marker-1', 1, 'capture', 'Capture'),
      marker('marker-2', 1.5, 'sweep', 'Sweep'),
      marker('marker-3', 7.5, 'analysis', 'Analysis'),
    ],
  }),
};
