# The patch contract coverage matrix

Derived by `node scripts/patch-contract.mjs --write` from the Studio node registry
(`src/js/studio/registry.js`; plan K164, the owner's program B). Do not edit by hand:
`--check` fails when it is stale, and `tests/unit/patch-contract.test.mjs` holds the missing
counts to `tests/unit/patch-contract-baseline.json`, which only fall.

36 node types, 95 ports, 156 parameters. A field is declared,
defaulted (derived by the declaration: a parameter port, or a field the port or parameter
lists as defaulted) or missing; a field that does not apply is not counted.

| Kind | Field | Declared | Defaulted | Missing |
|---|---|---:|---:|---:|
| port | `id` | 71 | 24 | 0 |
| port | `owner` | 71 | 24 | 0 |
| port | `direction` | 71 | 24 | 0 |
| port | `type` | 71 | 24 | 0 |
| port | `role` | 71 | 24 | 0 |
| port | `cardinality` | 71 | 24 | 0 |
| port | `required` | 71 | 24 | 0 |
| port | `channels` | 0 | 1 | 94 |
| port | `rate` | 0 | 1 | 94 |
| port | `unconnected` | 0 | 1 | 56 |
| port | `monitor` | 0 | 1 | 94 |
| port | `compact` | 0 | 1 | 94 |
| port | `version` | 0 | 1 | 94 |
| parameter | `type` | 156 | 0 | 0 |
| parameter | `unit` | 156 | 0 | 0 |
| parameter | `default` | 155 | 0 | 1 |
| parameter | `range` | 146 | 0 | 0 |
| parameter | `mapping` | 110 | 0 | 0 |
| parameter | `automatable` | 156 | 0 | 0 |
| parameter | `modulatable` | 156 | 0 | 0 |
| parameter | `live` | 11 | 0 | 145 |

## Compatibility and cardinality

From `canConnect` (`src/js/studio/ports.js`) over every pair of port types and the
roles each allows.
One output feeds many inputs. 24 input ports take more than one cable, 33 take one.

| From | To | Connects | Refusal |
|---|---|---|---|
| AUDIO SIGNAL | AUDIO SIGNAL | yes |  |
| AUDIO SIGNAL | AUDIO TAP | yes |  |
| AUDIO SIGNAL | CONTROL SIGNAL | no | Audio output cannot connect to a control input. Modulate parameters from an LFO, Envelope, Random or Step Modulator. |
| AUDIO SIGNAL | CONTROL PARAMETER | no | Audio output cannot connect to a control input. Modulate parameters from an LFO, Envelope, Random or Step Modulator. |
| AUDIO SIGNAL | TRIGGER SIGNAL | no | Audio output cannot connect to a trigger input. |
| AUDIO SIGNAL | ANALYSIS OBSERVED | no | Audio output cannot connect to an analysis input. Route it through a Capture node first. |
| AUDIO SIGNAL | ANALYSIS REFERENCE | no | Audio output cannot connect to an analysis input. Route it through a Capture node first. |
| AUDIO SIGNAL | ANALYSIS RESULT | no | Audio output cannot connect to an analysis input. Route it through a Capture node first. |
| AUDIO TAP | AUDIO SIGNAL | yes |  |
| AUDIO TAP | AUDIO TAP | yes |  |
| AUDIO TAP | CONTROL SIGNAL | no | Audio output cannot connect to a control input. Modulate parameters from an LFO, Envelope, Random or Step Modulator. |
| AUDIO TAP | CONTROL PARAMETER | no | Audio output cannot connect to a control input. Modulate parameters from an LFO, Envelope, Random or Step Modulator. |
| AUDIO TAP | TRIGGER SIGNAL | no | Audio output cannot connect to a trigger input. |
| AUDIO TAP | ANALYSIS OBSERVED | no | Audio output cannot connect to an analysis input. Route it through a Capture node first. |
| AUDIO TAP | ANALYSIS REFERENCE | no | Audio output cannot connect to an analysis input. Route it through a Capture node first. |
| AUDIO TAP | ANALYSIS RESULT | no | Audio output cannot connect to an analysis input. Route it through a Capture node first. |
| CONTROL SIGNAL | AUDIO SIGNAL | no | Control output cannot connect to an audio input. Connect it to a parameter (diamond) input. |
| CONTROL SIGNAL | AUDIO TAP | no | Control output cannot connect to an audio input. Connect it to a parameter (diamond) input. |
| CONTROL SIGNAL | CONTROL SIGNAL | yes |  |
| CONTROL SIGNAL | CONTROL PARAMETER | yes |  |
| CONTROL SIGNAL | TRIGGER SIGNAL | no | Control output cannot connect to a trigger input. |
| CONTROL SIGNAL | ANALYSIS OBSERVED | no | Control output cannot connect to an analysis input. |
| CONTROL SIGNAL | ANALYSIS REFERENCE | no | Control output cannot connect to an analysis input. |
| CONTROL SIGNAL | ANALYSIS RESULT | no | Control output cannot connect to an analysis input. |
| CONTROL PARAMETER | AUDIO SIGNAL | no | Control output cannot connect to an audio input. Connect it to a parameter (diamond) input. |
| CONTROL PARAMETER | AUDIO TAP | no | Control output cannot connect to an audio input. Connect it to a parameter (diamond) input. |
| CONTROL PARAMETER | CONTROL SIGNAL | yes |  |
| CONTROL PARAMETER | CONTROL PARAMETER | yes |  |
| CONTROL PARAMETER | TRIGGER SIGNAL | no | Control output cannot connect to a trigger input. |
| CONTROL PARAMETER | ANALYSIS OBSERVED | no | Control output cannot connect to an analysis input. |
| CONTROL PARAMETER | ANALYSIS REFERENCE | no | Control output cannot connect to an analysis input. |
| CONTROL PARAMETER | ANALYSIS RESULT | no | Control output cannot connect to an analysis input. |
| TRIGGER SIGNAL | AUDIO SIGNAL | no | Trigger output cannot connect to an audio input. |
| TRIGGER SIGNAL | AUDIO TAP | no | Trigger output cannot connect to an audio input. |
| TRIGGER SIGNAL | CONTROL SIGNAL | no | Trigger output cannot connect to a control input. Use it to gate an Envelope or clock a modulator. |
| TRIGGER SIGNAL | CONTROL PARAMETER | no | Trigger output cannot connect to a control input. Use it to gate an Envelope or clock a modulator. |
| TRIGGER SIGNAL | TRIGGER SIGNAL | yes |  |
| TRIGGER SIGNAL | ANALYSIS OBSERVED | no | Trigger output cannot connect to an analysis input. |
| TRIGGER SIGNAL | ANALYSIS REFERENCE | no | Trigger output cannot connect to an analysis input. |
| TRIGGER SIGNAL | ANALYSIS RESULT | no | Trigger output cannot connect to an analysis input. |
| ANALYSIS OBSERVED | AUDIO SIGNAL | no | Analysis output cannot connect to an audio input: analysis data is not a sound signal. |
| ANALYSIS OBSERVED | AUDIO TAP | no | Analysis output cannot connect to an audio input: analysis data is not a sound signal. |
| ANALYSIS OBSERVED | CONTROL SIGNAL | no | Analysis output cannot connect to a control input. |
| ANALYSIS OBSERVED | CONTROL PARAMETER | no | Analysis output cannot connect to a control input. |
| ANALYSIS OBSERVED | TRIGGER SIGNAL | no | Analysis output cannot connect to a trigger input. |
| ANALYSIS OBSERVED | ANALYSIS OBSERVED | yes |  |
| ANALYSIS OBSERVED | ANALYSIS REFERENCE | no | An observed capture cannot connect to a reference input. The reference must be the digital stimulus itself. |
| ANALYSIS OBSERVED | ANALYSIS RESULT | no | A observed output cannot connect to a result input. |
| ANALYSIS REFERENCE | AUDIO SIGNAL | no | Analysis output cannot connect to an audio input: analysis data is not a sound signal. |
| ANALYSIS REFERENCE | AUDIO TAP | no | Analysis output cannot connect to an audio input: analysis data is not a sound signal. |
| ANALYSIS REFERENCE | CONTROL SIGNAL | no | Analysis output cannot connect to a control input. |
| ANALYSIS REFERENCE | CONTROL PARAMETER | no | Analysis output cannot connect to a control input. |
| ANALYSIS REFERENCE | TRIGGER SIGNAL | no | Analysis output cannot connect to a trigger input. |
| ANALYSIS REFERENCE | ANALYSIS OBSERVED | no | A reference signal cannot connect to an observed input. The Transfer Analyzer takes the digital stimulus on REFERENCE and the capture on OBSERVED. |
| ANALYSIS REFERENCE | ANALYSIS REFERENCE | yes |  |
| ANALYSIS REFERENCE | ANALYSIS RESULT | no | A reference output cannot connect to a result input. |
| ANALYSIS RESULT | AUDIO SIGNAL | no | Analysis output cannot connect to an audio input: analysis data is not a sound signal. |
| ANALYSIS RESULT | AUDIO TAP | no | Analysis output cannot connect to an audio input: analysis data is not a sound signal. |
| ANALYSIS RESULT | CONTROL SIGNAL | no | Analysis output cannot connect to a control input. |
| ANALYSIS RESULT | CONTROL PARAMETER | no | Analysis output cannot connect to a control input. |
| ANALYSIS RESULT | TRIGGER SIGNAL | no | Analysis output cannot connect to a trigger input. |
| ANALYSIS RESULT | ANALYSIS OBSERVED | no | A result output cannot connect to a observed input. |
| ANALYSIS RESULT | ANALYSIS REFERENCE | no | A result output cannot connect to a reference input. |
| ANALYSIS RESULT | ANALYSIS RESULT | yes |  |

## Node types with missing fields

| Node type | Ports | Parameters | Missing fields |
|---|---:|---:|---:|
| `mixer` | 9 | 4 | 57 |
| `filter` | 5 | 6 | 34 |
| `fm-voice` | 2 | 20 | 31 |
| `additive-voice` | 2 | 19 | 30 |
| `vco` | 4 | 6 | 29 |
| `oscillator` | 4 | 6 | 27 |
| `envelope` | 4 | 4 | 26 |
| `xy-pad` | 4 | 5 | 25 |
| `wavetable-voice` | 3 | 7 | 24 |
| `stereo-split` | 3 | 5 | 22 |
| `am-voice` | 2 | 10 | 21 |
| `random` | 3 | 4 | 20 |
| `step-modulator` | 3 | 5 | 20 |
| `drive` | 3 | 3 | 19 |
| `ring` | 3 | 2 | 19 |
| `transfer-analyzer` | 3 | 2 | 19 |
| `gain` | 3 | 2 | 18 |
| `keys` | 3 | 3 | 18 |
| `pan` | 3 | 2 | 18 |
| `sequence` | 3 | 2 | 18 |
| `perc-voice` | 2 | 5 | 16 |
| `sweep` | 2 | 5 | 15 |
| `calibration` | 2 | 2 | 14 |
| `noise` | 2 | 3 | 14 |
| `rta` | 2 | 3 | 14 |
| `capture` | 2 | 2 | 13 |
| `lfo` | 3 | 4 | 13 |
| `macro` | 2 | 1 | 12 |
| `spectrogram` | 1 | 5 | 11 |
| `microphone` | 2 | 0 | 10 |
| `spectrum` | 1 | 3 | 9 |
| `recorder` | 1 | 2 | 8 |
| `master` | 1 | 1 | 7 |
| `measurement-result` | 1 | 1 | 7 |
| `meter` | 1 | 1 | 7 |
| `scope` | 1 | 1 | 7 |
