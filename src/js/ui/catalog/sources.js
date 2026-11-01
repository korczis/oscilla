// The table of state owners of the UI catalogue (plan issue G001, ADR 0081 decision 2): every
// canonical state path a declaration may name, the family that owns it, how that family
// persists and who writes it. A table, not a state layer: it never reads, writes or subscribes
// to a value at run time, and it imports only constants (never a lab or a view module), so a
// lab that later imports the catalogue forms no cycle.
//
//   has(path) -> boolean                 true only for a listed path; no pattern, no catch-all
//   describe(path) -> { family, persistence, writer } | null
//   paths() -> [path]                    every listed path, in table order
//   FAMILIES                             [{ family, keys, persistence, writer }]
//
// Keys come from the owner's own constants where one exists (INSTRUMENT_STATE_KEYS, the lab
// defaults of labs/lab-defaults.js, the node registry); otherwise they are the enumerated list
// read in the owner module, named beside it.

import { INSTRUMENT_STATE_KEYS } from '../../core/config.js';
import { ADSR_DEFAULTS, FILTER_DEFAULTS, HARMONIC_COUNT, PHASE_DEFAULTS }
  from '../../labs/lab-defaults.js';
import { NODE_REGISTRY } from '../../studio/registry.js';

const harmonics = Array.from({ length: HARMONIC_COUNT }, (_, i) => `harmonic.${i + 1}`);
const nodeParams = NODE_REGISTRY.list()
  .flatMap((def) => def.params.map((p) => `${def.type}.${p.key}`));

/** A family whose paths are `<family>.<key>` (an EXACT entry is one path, with no keys). */
const family = (name, keys, persistence, writer) => Object.freeze({ family: name,
  keys: Object.freeze([...keys]), persistence, writer });

export const FAMILIES = Object.freeze([
  family('instrument', INSTRUMENT_STATE_KEYS,
    'The URL hash, the custom presets (local storage, oscilla.presets), the session history '
      + '(session storage, oscilla.history) and the config file.',
    'core/instrument.js setters and applyConfigTo of core/config.js'),
  family('lab.filter', Object.keys(FILTER_DEFAULTS),
    'The config file only (exportConfigDoc of main.js); the page keeps it for its lifetime.',
    'labs/filter-lab.js set()'),
  family('lab.envelope', [...Object.keys(ADSR_DEFAULTS), 'enabled'],
    'The config file only (exportConfigDoc of main.js); the page keeps it for its lifetime.',
    'labs/envelope.js set() and its power switch'),
  // labs/additive.js: the switch, the partial table, the preset select, the selected harmonic
  // and each harmonic of the table (HARMONIC_COUNT).
  family('lab.additive', ['enabled', 'partials', 'preset', 'selected', ...harmonics],
    'The switch and the partial table go to the config file only; the preset and the '
      + 'selection last for the page.',
    'labs/additive.js'),
  family('lab.phase', Object.keys(PHASE_DEFAULTS),
    'The config file; the A/B frequencies and the route also follow the instrument dual state.',
    'labs/phase-stereo.js'),
  // sequencer/model.js: the serialisable sequence model (its version is not editable).
  family('sequencer', ['tempoBpm', 'loop', 'waveform', 'seed', 'blocks'],
    'The config file only; an edit applies from the next pass.',
    'sequencer/editor.js through the pure operations of sequencer/model.js'),
  family('studio.param', nodeParams,
    'Inside the StudioModel: the IndexedDB library, project and sequence files.',
    'store.dispatch of studio/actions.js (createStudioStore)'),
  // ui/measure.js: the run's state machine, its recipe and result, and the calibration.
  family('measure', ['run', 'recipe', 'result', 'profile', 'levelCal'],
    'A result is saved as an experiment in IndexedDB and its recipe in the URL key mr; the '
      + 'calibration lives for the page and is frozen into each experiment.',
    'ui/measure.js and measurement/engine.js'),
  // ui/app.js (workspace, theme, navOpen), ui/workbench.js (labFlags, seqPlaying),
  // labs/mic-analyzer.js (micCompare), ui/studio/timeline-editor.js (timelineSnap).
  family('ui', ['workspace', 'theme', 'navOpen', 'labFlags', 'seqPlaying', 'micCompare',
    'timelineSnap'],
  'The theme in local storage (oscilla.theme) and the workspace in the URL key m; every other key '
    + 'lasts for the page only.',
  'ui/app.js, ui/navigation.js, ui/workbench.js and the view that owns the key'),
]);

/** The Studio paths that are one path each, not a family of keys. */
export const EXACT = Object.freeze([
  family('studio.model', [],
    'The IndexedDB library, project and sequence files; the URL carries the template id.',
    'store.dispatch of studio/actions.js (createStudioStore)'),
  family('studio.transport', [],
    'Never: the transport runs from PLAY to STOP.',
    'studio/transport.js'),
  family('studio.selection', [],
    'Never: the selection is store-only and never serialized.',
    'store.dispatch SELECTION_CHANGE of studio/actions.js'),
  family('studio.view', [],
    'Inside the StudioModel view, neither undoable, dirtying nor hashed.',
    'store.dispatch of studio/actions.js'),
]);

const TABLE = new Map();
for (const f of FAMILIES) for (const k of f.keys) TABLE.set(`${f.family}.${k}`, f);
for (const f of EXACT) TABLE.set(f.family, f);

/** True only for a path the table lists. */
export const has = (path) => typeof path === 'string' && TABLE.has(path);

/** The owner of a listed path, or null. */
export function describe(path) {
  const f = has(path) ? TABLE.get(path) : null;
  return f ? { family: f.family, persistence: f.persistence, writer: f.writer } : null;
}

/** Every listed path. */
export const paths = () => [...TABLE.keys()];
