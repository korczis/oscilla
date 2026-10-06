# How to make a useful measurement

A practical guide for OSCILLA's Measure workspace (specification §191). The algorithms
behind the results are documented in `docs/v3/algorithms.md`, and the way the layers fit
together in `docs/v3/architecture.md`.

In the workspace, the guided flow runs through seven steps: input, calibration, noise check,
stimulus, measure, review and save. **Check setup** runs the permission, input, sample-rate
and background-noise checks. **Start measurement** plays and captures the sweep. **Save
experiment** stores the result. **Expert settings** opens the sweep range and duration, the
number of runs, the aggregation and the timing. The preset CHARACTERIZE PLAYBACK CHAIN is a
good start: it runs a noise check, then a 20 Hz-20 kHz sweep, three times, at the LOW digital
level.

## What you are measuring

A sweep measurement plays a known digital signal and records what comes back. The result is the
**observed response of the whole playback and capture chain**: the browser's audio output, the
operating system, the DAC and amplifier, the loudspeaker, the room, the microphone position,
the microphone, its preamplifier and ADC, and the browser's input path.

Call it that. A measurement taken in a room is not "the speaker's response", and a measurement
through a laptop microphone is not "the room's response". OSCILLA cannot separate the parts of
the chain; you can only change one part at a time and compare.

## What OSCILLA cannot know

- The room: its size, reflections and background noise are in every result.
- The microphone position, distance and angle. Moving the microphone a few centimetres changes
  the high-frequency response and the reflection pattern.
- The analog behaviour of your hardware: amplifier gain, loudspeaker distortion, microphone
  sensitivity, analog limiting.
- Any processing the browser, the operating system or the device applies (see below).
- The acoustic delay. The time offset OSCILLA finds is where the sweep starts inside the
  recording, which includes unknown device and browser delays. It is not the time of flight and
  not a latency measurement. "1 m ≈ 2.9 ms" is an educational rule of thumb, not something the
  result can confirm.

Write what you know in the experiment notes: distance, room, microphone and loudspeaker model,
position, temperature. OSCILLA never senses these automatically.

## Before you start

1. **Quiet room.** Switch off fans, air conditioning and music; close the door and windows. Use
   the background-noise check: it records the room without the sweep and is used to estimate the
   signal-to-noise ratio per frequency. Its length sets how low the SNR can be assessed: below
   about 87 Hz / (noise-check seconds) the check holds too few independent observations, and
   that band is reported as "SNR not assessed" (1 s assesses from 87 Hz, 5 s from 17 Hz). A
   noise check that is digital silence gives no SNR at all ("SNR not measured").
2. **Fixed microphone.** Put the microphone on a stand or a stable surface, not in your hand.
   Note the distance and aim. Keep it in exactly the same place for every repeat and for any
   measurement you want to compare.
3. **Disable input processing.** OSCILLA asks the browser to turn off echo cancellation, noise
   suppression and automatic gain control. Browsers and devices may ignore the request. When
   the settings cannot be confirmed, the result says "Input processing may have been applied by
   browser/device", and the response may be altered in ways OSCILLA cannot correct; the quality
   assessment then stays at USABLE at best, and a browser that reports processing ON makes it
   POOR. A USB
   measurement microphone or an audio interface is usually more predictable than a built-in
   microphone.
4. **Check the sample rate and range.** The sweep cannot exceed 95 % of the Nyquist frequency
   (half the sample rate); a higher requested end is lowered and the change is shown.
5. **Choose the input.** OSCILLA uses the browser's default input until you choose another one.
   The Live input panel lists the inputs once the browser has granted the microphone (run the
   setup check first; browsers hide the list before that) and keeps the list current when a
   device is plugged in or out. The chosen input is used for the setup check, the measurement,
   the live RTA and the level reference, and a saved experiment records it as a hashed
   identifier (never the browser's raw device id). If the chosen input disappears it stays
   selected, marked "not available", with a message; the setup check then refuses it until you
   choose another input or the default. OSCILLA never switches microphones for you.

## Output level

- The output level is a choice of LOW, MEDIUM or HIGH, each a digital peak before the master
  volume. Start at **LOW**. Raise the level only when the result's signal-to-noise reasons
  say the signal is too close to the background noise. The setup check reports the input
  level and the background noise, and the quality bar shows NOISE and SIGNAL during the run.
  Moderate is enough: doubling the sweep duration raises the signal-to-noise ratio by about
  3 dB without making anything louder.
- **Never raise the gain to beat the noise.** Loud sweeps drive loudspeakers and amplifiers into
  distortion and the microphone input into clipping, and both corrupt the result. If the noise
  is too high, make the room quieter, move the microphone closer, or use a longer sweep.
- Clipping in the recording makes the run invalid. Lower the output level or the input gain and
  measure again.
- The output level is a digital level (a fraction of full scale). It is never sound pressure.

## Safety

- Protect your hearing and your equipment. Do not wear headphones during a loudspeaker sweep,
  and keep the volume moderate.
- **Low frequencies** (the lowest octaves, roughly below 40-50 Hz) can push small loudspeakers
  beyond their excursion limits at moderate settings; you may not hear the bass but the driver
  may be overloaded. On small speakers, start the sweep higher (for example at 50 Hz).
- **High frequencies** (above about 12-15 kHz) may be faint or inaudible, especially to adults,
  but they still carry energy into tweeters and ears. Do not raise the level because a high tone
  seems quiet.
- OSCILLA's output ceiling protects against digital overload, not against an amplifier turned
  up too far.

## Repeat measurements

Measure the same setup several times (for example five repeats). OSCILLA aggregates the runs and
reports how well they agree, for example as a per-frequency spread and a single repeatability
figure in dB. Large disagreement means something changed between runs: noise, movement, or the
device. Leave a short pause between repeats; captures never overlap.

To compare two setups (another speaker position, another loudspeaker), change one thing only,
keep the microphone, level and sweep the same, and save each as its own experiment. The
comparison warns when experiments differ in calibration, sample rate, stimulus or algorithm
version; take those warnings seriously. For equivalent experiments it also overlays their
impulse responses, each drawn from its own direct peak (0 ms) on its original scale; there is
no A − B of impulse responses.

## Sharing a recipe

**Copy recipe link** (Measurement setup) puts the current recipe — sweep range and duration,
digital output level, number of runs and aggregation, noise check, timing and phase — into the
page address (`#mr=…`) and on the clipboard. The link carries no result, no calibration, no input
device, name or notes. Opening it fills the setup and opens Measure; it never starts a setup
check or a measurement. A link that has been altered or does not fit (an unknown field, a value
out of range, a start frequency above the end) is refused as a whole and the setup is left as
it was. The recipe can sit next to a Playground link in the same address; each restores its own
part. An address that also names a workspace (`m=…`) opens that workspace and still fills the
setup.

A completed measurement that is not saved shows "unsaved result" in the Experiment panel; while
it is there, or while a level calibration is set, a reload, a closed tab or leaving the page
makes the browser ask first.

## Where experiments are kept

Saved experiments live in this browser's IndexedDB, for this page address only, and nowhere
else. Where IndexedDB cannot be opened, OSCILLA keeps them in memory for the page view and says
so; export each one as `.oscilla.json` to keep it. A save that fails (for example because the
browser's storage for the page is full) says why and keeps the result on screen, so you can
free space (export, then delete experiments) and save it again. The Playground never uses this
storage and works the same when it is unavailable.

Observed by the automated tests (`tests/browser/v3-ui.cjs`, check `persistence`, Playwright
1.63 browsers, a fresh browser profile per run):

| Browser (engine) | `file://` | `http(s)://` (GitHub Pages) |
| --- | --- | --- |
| Chromium 153 | IndexedDB opens; an experiment survives a page reload | same |
| Firefox 155 | IndexedDB opens; an experiment survives a page reload | same |
| WebKit 26.6 | IndexedDB opens; an experiment survives a page reload | same |

These are the engines' behaviour in a fresh test profile. They do not show what a given browser
does with its own settings: private windows, "clear data on exit", Safari's removal of site data
after a period without visits, and enterprise policies can make IndexedDB unavailable or empty
it. The tests also check that a storage-full error fails the save with its reason and keeps the
result, and that a database that cannot be opened at all leaves the Playground and Measure
working, with saves kept in memory.

## Calibration, if you have it

- A **frequency-response calibration profile** for your microphone (a file of frequency and
  correction values, typically supplied with a measurement microphone) corrects the microphone's
  own deviation from flat. It applies only between its first and last frequency; outside that
  range the result is shown uncorrected and marked as uncalibrated. The raw result is always
  kept. In the calibration step, import the file as CSV, TXT (frequency and correction
  columns) or JSON. A malformed file is refused with the line numbers at fault, and the step
  shows the profile's name, its number of points and the range it covers. The Frequency
  indicator then reads CALIBRATED, and the profile can be switched off or removed.
- An **absolute level calibration** needs an external reference, typically a 94 dB SPL
  calibrator at 1 kHz on the microphone. The level calibration dialog asks for the reference
  frequency, the reference sound pressure (dB re 20 µPa), the relative reading observed for
  that reference with the same microphone and settings, and a note on the conditions. The
  form suggests 1 kHz and 94 dB, but the observed reading starts empty and there is no
  default calibration. An incomplete or out-of-range entry is refused. A valid entry turns the
  Level indicator to CALIBRATED. It is valid only for the same microphone, input gain, browser
  settings and position it was taken with.
- The two are separate. A frequency profile alone does not give dB SPL.
- Calibrations are kept for the page view only. A saved experiment records which frequency
  profile it used (name and identity) and the level calibration, so reload the profile file
  before a new session. While a level calibration is set, a reload or a closed tab asks first
  (ADR 0045).
- **Export CSV** and **Export JSON** save the loaded frequency profile. Both files are the same
  for the same profile (name, identity, sign convention and points; the JSON also keeps the
  source and notes) and import back unchanged, without asking for the sign convention again.

## Relative level versus SPL

Without a valid level calibration every level is a **relative level** ("dB relative,
dBFS-like"), referred to the digital full scale of the recording, not to sound pressure. Only
with a valid level calibration does OSCILLA show "dB SPL", with a CALIBRATED indicator. A
relative level of −30 dB says nothing about how loud the room was.

Smoothed and normalized curves are views derived from the raw result and are labelled as such.
Exported CSV files contain the raw data unless you choose a labelled derived view.

## Reading the result

- Trust the **valid range** shown with the response: it is where the stimulus had energy and,
  when a noise check was made, where the signal was at least 10 dB above the noise.
- Frequencies are printed no finer than the analysis resolution allows; extra digits would be
  false precision.
- Phase is shown only when the alignment supports it; otherwise it is absent rather than
  guessed.
- Every result comes with a quality status (GOOD, USABLE, POOR or INVALID) and the reasons
  behind it, each with its value and unit: signal-to-noise, clipping, dropouts and
  discontinuities, frequency coverage, repeatability between runs, and calibration. A check
  that was not made reads NOT MEASURED, and that caps the status. Read the reasons, not only
  the status. Stretches outside the reliable range are drawn dashed and faded, and
  uncalibrated spans are hatched.
- An INVALID run cannot be saved as a measurement of anything. Fix the cause the reasons
  name, such as clipping, an empty capture or a dropout during the sweep, and measure again.
- The quality bar during the run (INPUT, NOISE, CLIPPING, SIGNAL, CAPTURE) is a warning while
  you measure. The quality status after the analysis is what counts.

## Live RTA

The RTA tab can analyse the microphone live ("Start live RTA"): FFT, octave or one-third-octave
bands, averaged INSTANT, FAST (125 ms) or SLOW (1 s), with peak hold and freeze. It is feedback
for setting up, not a measurement: nothing of it is stored. Band levels are the power in each
band (a tone of full-scale amplitude reads −3 dB relative in its band); in FFT mode a tone's
strongest bin reads a few dB lower, because the tone's power spreads over neighbouring bins.
Hatched bands are too narrow for the analysis resolution to resolve (raise the FFT size in
expert mode). The microphone is released when you stop it, leave the tab or the workspace,
press Escape or start a setup check or measurement; the two never share the input.

## Limits of automated testing

OSCILLA's automated tests check the digital pipeline, the analysis mathematics on synthetic
systems with known answers, the browser APIs and the interface. They cannot prove how your
hardware, your room or your browser behaves. A physical measurement is the only test of a
physical setup, and its result is still a measurement estimate of the whole chain.

## What OSCILLA does not claim

- No medical use: OSCILLA does not test hearing, diagnose tinnitus or provide audiometry.
  Anything about human hearing in OSCILLA is educational.
- No certification: OSCILLA is not an IEC 61672 sound level meter and does not meet IEC 61260-1
  filter classes or any ANSI standard. Its octave and one-third-octave bands use the standard
  band edges, but band levels are experimental, educational measurement estimates.
