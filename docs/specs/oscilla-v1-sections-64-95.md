# OSCILLA V1, specification sections 64-95 (the numbered multi-page variant, 2026-10-01)

Recorded verbatim; nothing condensed. This text is a record of what was written, not a
requirement the repository has adopted: whether milestone M005 takes it is an owner decision
(issue `S000` records the evidence, issue `Q001` asks the question).

## Provenance

- **Where it comes from.** The owner's ChatGPT project "Oscilla", conversation
  `6abec18d-3e14-83eb-826c-cec2de466d22` ("Development of Oscilla"), the assistant message of
  2026-10-01T20:46:12.363Z. It answers the owner's message of 20:45:56Z: a GitHub Pages
  repository, purely static, working from `file://` without a server, that "need not and should
  not be a single page", combining everything from that session into one final prompt. The
  transcripts are the owner's private material and are kept outside the repository; the
  knowledge record `chatgpt-oscilla-project` describes them.
- **Which specification this is.** The conversation holds two V1 prompts.
  - (b) The unnumbered single-file prompt of 20:42:59Z. Its 63 section headings are the
    repository's S001-S063, in the same order. Its 63rd heading is "PROGRESSIVE DISCLOSURE",
    and ChatGPT's own message ends there, after the words "The initial UI": the point that
    `S063` records as the truncation. Prompt (b) never had a section 64.
  - (c) This numbered multi-page specification of 20:46:12Z, sections 0 to 95. The Execution
    Protocol of 20:52:28Z ("The specification that follows contains 95 numbered sections") and
    the Majordomus Step 0 of 20:54:21Z refer to it. The plan's 95 TODO items were therefore
    planned against (c) while sections 1-63 were taken from (b).
  - So the tail was not lost in a paste. Sections 64-95 of (c) are the counterparts of the
    missing items, with (c)'s numbering, which differs from (b)'s (for example, (b)'s §2 is
    "Tech stack", (c)'s §2 is "Deployment model"). Sections 0-63 of (c) cover the ground of (b)
    in another order and are not reproduced here.
- **What conflicts with later decisions.** The premises of (c) are partly superseded:
  - a multi-page site (pages in §67, §68, §70, §75, §78, §84 and the checklist), where OSCILLA
    is one page with workspaces (`project.single-file-deliverable`, ADR 0011);
  - "no build required" (§68, §92), where OSCILLA builds `dist/index.html` from `src/` with
    esbuild and a packer (ADR 0011, ADR 0012);
  - classic scripts in a `window.Oscilla` namespace (the end of §63, §64), where the source is
    ES modules bundled into the one file (ADR 0011);
  - Flowbite (§72), which the repository removed together with Tailwind
    (`docs/v2-baseline-inventory.txt`, ADR 0012);
  - "do not overengineer" (§91), which later decisions (an IndexedDB store, ADR 0022; the
    Studio model, compiler and runtime, ADRs 0030 and 0035) went past deliberately.
  Much of the rest has shipped under other ids: privacy (README "Privacy"), metadata and Open
  Graph tags (V243, V244), `.nojekyll` (`.github/workflows/pages.yml`), the three-engine browser
  suites. There is no 404 page (§70).
- **Transcription.** Lines 6735-7655 of the exported conversation: from the rule above "64.
  ALPINE ARCHITECTURE" to the last line of the prompt, "Implement OSCILLA to that standard."
  The message's closing code fence and ChatGPT's commentary after it are omitted. Typography
  (box-drawing rules, curly quotes, arrows) is as written.

## Sections 64-95

```text
──────────────────────────────────────────────────────────────────────────────
64. ALPINE ARCHITECTURE
──────────────────────────────────────────────────────────────────────────────

Use Alpine.js for UI state and declarative interaction.

Keep large algorithms OUT of HTML attributes.

Example conceptually:

Alpine.data('playground', () => ({
    playing: false,
    frequency: 440,
    waveform: 'sine',
    pattern: 'tone',
    gain: 0.08,

    init(),
    play(),
    stop(),
    trigger(),
    setFrequency(),
    applyPreset(),
    ...
}));

x-on expressions should remain short.

──────────────────────────────────────────────────────────────────────────────
65. STATIC DATA
──────────────────────────────────────────────────────────────────────────────

Because runtime fetch() must not be required:

store:

preset definitions
frequency regions
learning metadata
reference tables

inside regular JavaScript files.

Example:

Oscilla.PresetData = {...}

Do NOT fetch local JSON.

──────────────────────────────────────────────────────────────────────────────
66. PRIVACY
──────────────────────────────────────────────────────────────────────────────

No analytics.

No tracking.

No cookies required.

No accounts.

No server.

No telemetry.

localStorage/sessionStorage only for user-controlled local functionality.

Document this on About page.

──────────────────────────────────────────────────────────────────────────────
67. SEO / METADATA
──────────────────────────────────────────────────────────────────────────────

Because this is GitHub Pages, add sensible static metadata.

Each page:

<title>
description
canonical-friendly structure where practical
OpenGraph basics
theme-color
viewport

Do not introduce a dependency on runtime SEO injection.

Use meaningful page titles:

Oscilla — Interactive Sound & Frequency Lab

Oscilla Playground

Oscilla Sweep

Oscilla Dual Oscillator

Oscilla Presets

Oscilla Learn

──────────────────────────────────────────────────────────────────────────────
68. README
──────────────────────────────────────────────────────────────────────────────

Write a useful README.md.

Include:

What OSCILLA is

Features

Pages

Technical architecture

How to run:

Option A:
open index.html directly

Option B:
GitHub Pages

No build required

Browser requirements

Web Audio limitations

Safety notes

Privacy

Repository structure

Development conventions

How GitHub Pages deployment works

Known limitations

──────────────────────────────────────────────────────────────────────────────
69. GITHUB PAGES
──────────────────────────────────────────────────────────────────────────────

Prepare repository for direct GitHub Pages deployment.

Include:

.nojekyll

Avoid Jekyll assumptions.

Prefer GitHub Pages deployment from repository root or /docs only if there
is a strong reason.

Do not require GitHub Actions unless necessary.

The simplest deployment path should be:

Settings
→ Pages
→ Deploy from branch
→ main / root

──────────────────────────────────────────────────────────────────────────────
70. 404 PAGE
──────────────────────────────────────────────────────────────────────────────

Add a lightweight 404.html consistent with OSCILLA branding.

Use relative navigation back to index.html.

Do not create SPA routing hacks.

──────────────────────────────────────────────────────────────────────────────
71. BROWSER SUPPORT
──────────────────────────────────────────────────────────────────────────────

Prioritize:

Chrome desktop
Chrome Android
Safari desktop
Safari iOS
Firefox desktop
Edge

Pay special attention to:

iOS Safari AudioContext resume behavior
pointer events
touch handling
Web Audio user-gesture requirements

Do not autoplay.

Initialize/resume audio only after explicit user interaction.

──────────────────────────────────────────────────────────────────────────────
72. FLOWBITE BEST PRACTICES
──────────────────────────────────────────────────────────────────────────────

When using Flowbite:

- follow documented component structures
- prefer semantic markup
- use accessible trigger relationships
- avoid redundant nesting
- use Flowbite where it saves real implementation effort
- use custom controls where instrument UX requires it

Do not let Flowbite determine the entire visual design.

──────────────────────────────────────────────────────────────────────────────
73. TECHNICAL TERMINOLOGY
──────────────────────────────────────────────────────────────────────────────

Prefer:

requested frequency
digital signal
nominal ultrasonic region
relative level
sample rate
Nyquist frequency
approximate wavelength
device output unknown
theoretical harmonics

Avoid:

dog-only sound
inaudible sound
actual SPL
safe tone
guaranteed ultrasound
speaker calibration

──────────────────────────────────────────────────────────────────────────────
74. QUALITY BAR
──────────────────────────────────────────────────────────────────────────────

This should NOT look like an AI-generated demo.

Avoid common AI frontend symptoms:

- repeated generic cards
- unnecessary gradients
- excessive explanatory text
- duplicate controls
- giant rounded rectangles everywhere
- random icon usage
- inconsistent spacing
- weak mobile layouts
- fake metrics
- controls with no actual effect
- decorative graphs disconnected from application state

Every visible control should do something real.

Every graph should represent real state.

Every metric should have a defined derivation.

──────────────────────────────────────────────────────────────────────────────
75. IMPLEMENTATION STRATEGY
──────────────────────────────────────────────────────────────────────────────

Do NOT start by dumping code.

First inspect the repository.

If empty:

design the architecture.

If existing:

understand what exists before changing it.

Then internally plan:

1. shared architecture
2. static navigation
3. AudioEngine
4. frequency/math helpers
5. reusable visualization infrastructure
6. Playground
7. Sweep
8. Dual Osc
9. Presets
10. Learn
11. About
12. responsive polish
13. accessibility
14. static/file:// compatibility
15. tests/audit

Then implement.

Do not spend the response explaining your plan instead of working.

──────────────────────────────────────────────────────────────────────────────
76. STATIC COMPATIBILITY AUDIT
──────────────────────────────────────────────────────────────────────────────

After implementation, explicitly audit for accidental server dependencies.

Search the project for:

fetch(
XMLHttpRequest
import(
type="module"
/assets/
href="/
src="/
localhost
127.0.0.1

Review every occurrence.

Any use must be justified.

No core behavior may require HTTP.

──────────────────────────────────────────────────────────────────────────────
77. LINK AUDIT
──────────────────────────────────────────────────────────────────────────────

Verify every navigation link.

From:

index.html
playground.html
sweep.html
dual-osc.html
presets.html
learn.html
about.html
404.html

All links must remain valid:

- on GitHub Pages repo subpath
- when opened locally

──────────────────────────────────────────────────────────────────────────────
78. MANUAL FILE:// TEST
──────────────────────────────────────────────────────────────────────────────

The definitive local test is:

open index.html directly in a browser using file://.

Then verify:

home works
navigation works
CSS loads
JS loads
Alpine starts
p5 starts
Playground loads
sound initializes after user gesture
presets work
localStorage works
sessionStorage works
hash state works
Sweep works
Dual Osc works
Learn works
About works

No local web server may be used for this test.

──────────────────────────────────────────────────────────────────────────────
79. AUDIO TEST MATRIX
──────────────────────────────────────────────────────────────────────────────

Test at least:

20 Hz
40 Hz
100 Hz
440 Hz
1 kHz
4 kHz
8 kHz
15.5 kHz
18 kHz
20 kHz

and:

a value near Nyquist

Verify:

validation
formatting
visualization
wavelength
period
note calculation
frequency region

──────────────────────────────────────────────────────────────────────────────
80. PATTERN TEST MATRIX
──────────────────────────────────────────────────────────────────────────────

Test every pattern:

tone
pulse
burst
sweep
ping-pong
chirp
siren
alternating
wobble
AM
FM
random
octave
custom sequence

Test:

trigger
stop
retrigger
rapid interruption
page navigation

No stuck audio.

──────────────────────────────────────────────────────────────────────────────
81. DUAL OSC TESTS
──────────────────────────────────────────────────────────────────────────────

Test:

440 + 440

440 + 441

440 + 442

440 + 450

mono
stereo split
changing oscillator during playback
stopping one/both
rapid restart

Check node cleanup.

──────────────────────────────────────────────────────────────────────────────
82. VISUALIZATION TESTS
──────────────────────────────────────────────────────────────────────────────

Verify:

Wave
Spectrum
Frequency Motion
Signal Path
Harmonics
Interference

Check:

resize
mobile
Retina/high-DPI
dark theme
light theme
hidden tab behavior

──────────────────────────────────────────────────────────────────────────────
83. ACCESSIBILITY AUDIT
──────────────────────────────────────────────────────────────────────────────

Check:

keyboard navigation
visible focus
labels
aria-live
menu behavior
modal focus
button semantics
screen-reader state
graph alternatives

Graphical controls must have equivalent accessible input controls.

──────────────────────────────────────────────────────────────────────────────
84. RESPONSIVE AUDIT
──────────────────────────────────────────────────────────────────────────────

Inspect at:

320
375
390
430
768
1024
1280
1440 px

Fix:

overflow
tiny labels
unreachable controls
canvas clipping
bad button wrapping
unusable sliders

Do not merely claim responsiveness.

Actually inspect the CSS and DOM structure critically.

──────────────────────────────────────────────────────────────────────────────
85. CONSOLE AUDIT
──────────────────────────────────────────────────────────────────────────────

Final site should produce no avoidable:

errors
warnings
unhandled promise rejections

during normal usage.

──────────────────────────────────────────────────────────────────────────────
86. CODE QUALITY
──────────────────────────────────────────────────────────────────────────────

Use:

clear names
small reusable helpers
comments where needed
single responsibility
shared utilities

Avoid:

god objects
anonymous 1000-line event handlers
copy-pasted DSP code
duplicated frequency math
duplicated storage logic
page-specific variants of identical functionality

──────────────────────────────────────────────────────────────────────────────
87. DESIGN DETAILS TO GET RIGHT
──────────────────────────────────────────────────────────────────────────────

Frequency should visually dominate.

Examples:

15.50
kHz

or:

440.00 Hz
A4

Waveform choices should be visually understandable.

Pattern-specific controls should only appear when relevant.

Use progressive disclosure.

Advanced technical data should not overwhelm novices.

Experts should still be able to reach detailed controls quickly.

──────────────────────────────────────────────────────────────────────────────
88. PRODUCT PHILOSOPHY
──────────────────────────────────────────────────────────────────────────────

OSCILLA should allow a user to discover:

“What happens if I move this?”

and immediately:

hear it
see it
understand it

That feedback loop is the heart of the product.

If a feature does not strengthen that loop, reconsider whether it belongs.

──────────────────────────────────────────────────────────────────────────────
89. OPTIONAL HIGH-VALUE EXTENSIONS
──────────────────────────────────────────────────────────────────────────────

Only after the core is strong, consider:

- keyboard-controlled frequency stepping
- MIDI input if available
- Web MIDI as optional progressive enhancement
- downloadable WAV generation
- offline vendored dependencies
- microphone analyser
- phase control in Dual Osc
- oscilloscope trigger settings
- spectrogram
- stereo vectorscope
- Lissajous figure
- user-defined envelopes
- harmonic-series generator
- additive synthesis experiment
- Shepard tone educational demo
- missing fundamental demo
- equal-loudness educational explanation
- phase cancellation demo

These are extensions.

Do not sacrifice core correctness or usability for feature count.

──────────────────────────────────────────────────────────────────────────────
90. ESPECIALLY VALUABLE FUTURE EXPERIMENTS
──────────────────────────────────────────────────────────────────────────────

Architect cleanly enough that these can be added later:

SPECTROGRAM

frequency × time heatmap.

LISSAJOUS / PHASE

two-channel phase visualization.

ADDITIVE SYNTHESIS

fundamental + selected harmonics.

MISSING FUNDAMENTAL

demonstrate perceived pitch without fundamental.

PHASE CANCELLATION

same signal
0°
90°
180°

SHEPARD TONE

educational auditory illusion.

FILTER LAB

low-pass
high-pass
band-pass
notch
Q

ENVELOPE LAB

ADSR

Do not implement all unless core work is already polished.

──────────────────────────────────────────────────────────────────────────────
91. DO NOT OVERENGINEER
──────────────────────────────────────────────────────────────────────────────

This is still a static educational web application.

Do not invent:

- custom framework
- dependency injection container
- client database
- state-management framework
- virtual DOM abstraction
- internal component compiler
- fake microservice architecture
- backend architecture

The sophistication belongs in:

audio
interaction
visualization
education
usability

not architecture theater.

──────────────────────────────────────────────────────────────────────────────
92. FINAL IMPLEMENTATION CHECKLIST
──────────────────────────────────────────────────────────────────────────────

Before declaring completion, verify:

[ ] pure static site

[ ] works on GitHub Pages

[ ] works under GitHub Pages repository subpath

[ ] works from file://

[ ] no local server required

[ ] no build required by user

[ ] no backend

[ ] no runtime fetch required for project files

[ ] all pages navigate correctly

[ ] audio requires user gesture

[ ] AudioContext resumes correctly

[ ] Nyquist protection works

[ ] log frequency mapping works

[ ] all waveform modes work

[ ] all primary patterns work

[ ] STOP reliably stops everything

[ ] no oscillator leaks

[ ] dual oscillator works

[ ] presets work

[ ] custom presets persist

[ ] session history works

[ ] URL hash configuration works

[ ] no autoplay restoration

[ ] continuous playback permission never persists

[ ] p5 visualizations work

[ ] mobile works

[ ] dark/light mode works

[ ] keyboard interaction works

[ ] accessibility is reasonable

[ ] high-DPI canvas works

[ ] no obvious console errors

[ ] README is accurate

[ ] .nojekyll exists

[ ] 404.html exists

[ ] relative links are correct

[ ] terminology is scientifically defensible

[ ] no medical claims

[ ] no fake ultrasonic claims

[ ] no fake SPL measurements

──────────────────────────────────────────────────────────────────────────────
93. FINAL REVIEW PHASE
──────────────────────────────────────────────────────────────────────────────

Once implementation is complete:

DO NOT immediately stop.

Perform a second-pass review as a skeptical principal engineer.

Look specifically for:

- incorrect audio math
- broken Web Audio scheduling
- accidental linear frequency mappings
- oscillator leaks
- bad gain behavior
- misleading technical claims
- invalid Nyquist handling
- file:// incompatibilities
- absolute URLs
- broken GitHub Pages subpath assumptions
- duplicated code
- weak mobile UX
- generic AI-generated visual design
- nonfunctional controls
- visualizations that do not correspond to state
- accessibility regressions
- inconsistent navigation
- stale labels after state changes

Fix what you find.

Then perform another concise final sanity pass.

──────────────────────────────────────────────────────────────────────────────
94. COMPLETION RESPONSE
──────────────────────────────────────────────────────────────────────────────

Do the work in the repository.

Do not merely describe how you would build it.

At completion, report concisely:

1. what was implemented
2. repository/page structure
3. audio architecture
4. visualization architecture
5. file:// compatibility decisions
6. GitHub Pages compatibility decisions
7. important safety/technical limitations
8. optional extensions deliberately left for later
9. any known remaining issues

Do not fill the final response with generic praise.

The repository itself is the deliverable.

──────────────────────────────────────────────────────────────────────────────
95. FINAL PRODUCT TEST
──────────────────────────────────────────────────────────────────────────────

The final mental model should be:

A user downloads the repository.

They double-click:

index.html

OSCILLA opens.

They click:

440 Hz

They hear a tone.

They drag frequency upward.

They see:

frequency
note
period
wavelength
spectrum
waveform behavior

They select:

SAWTOOTH

They see harmonic structure.

They open:

Sweep

and run:

20 Hz → 20 kHz

They open:

Dual Osc

and compare:

440 Hz + 442 Hz

They visually observe and hear beating.

They open:

Learn

and understand why it happened.

Then the exact same repository is pushed to GitHub Pages and behaves the
same way.

THAT is the required result.

Implement OSCILLA to that standard.
```
