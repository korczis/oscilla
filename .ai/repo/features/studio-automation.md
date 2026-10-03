---
schema: feature/v1
id: studio-automation
kind: feature
title: 'Automate parameters over time, separately from modulation'
short_title: 'Automation'
headline: 'Draw how a parameter moves over the timeline, while modulation from other nodes adds on top.'
summary: 'Automation lanes of step, linear and exponential points on automatable parameters, edited in the parameter''s own scale and compiled to AudioParam schedules on the audio clock; modulation stays a control edge with its own depth.'
status: stable
weight: 430
featured: false
rules: [project.audio-engine-discipline, project.studio-model-is-canonical]
docs: [docs/v31/timeline.md, docs/v31/user-guide.md, docs/specs/oscilla-v3.1-studio.md]
adrs: [adr-0037, adr-0036]
claims: [studio-automation-model, studio-typed-connections, studio-transport-audio-clock]
use_cases: [studio-automate-a-parameter, studio-connect-modulation]
related: [studio-timeline, studio-signal-graph]
tags: [v31, studio, automation]
---

## What it does

Automation is the authored base value of a parameter over time; modulation is continuous
control from another node; the actual value is the base plus the modulations within the
parameter's bounds (ADR 0037, `docs/v31/timeline.md` "Automation"). Lanes accept only
parameters the registry marks automatable, one per parameter, keep points sorted and refuse
an exponential ramp that touches zero (`src/js/studio/validate.js`). **Automate** in the
Inspector creates or reveals a lane; the lane editor (`src/js/ui/studio/automation-editor.js`)
draws it in the parameter's own scale (logarithmic for frequency, dB for gain) and edits
points by double-click, drag, arrow keys or a typed value.

`src/js/studio/automation.js` compiles each lane to the exact AudioParam event list, clamped
to the parameter range and 0.95 × Nyquist of the running context, anchored at each loop pass
and held at its exact value on STOP; the transport schedules it on AudioContext time.

Proven by `npm test` (`tests/unit/v31-studio-timeline.test.mjs`,
`v31-studio-ui-timeline-automation.test.mjs`, `v31-studio-transport.test.mjs`) and
`npm run test:studio` (`tests/browser/v31-studio-transport.cjs` reads the automated cutoff in
the spectrum at the predicted frequency; `tests/browser/v31-studio-timeline.cjs` drives the
lane editor).

## What it does not do

Automation never simulates modulation and modulation never rewrites automation. An
exponential curve to or from zero is refused rather than approximated.
