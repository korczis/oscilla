# How to make a useful measurement

A practical guide for OSCILLA's MEASURE workspace (specification §191). The controls are
described by what they do, not by their final names, because the MEASURE interface is still
being built. The algorithms behind the results are documented in `docs/v3/algorithms.md`.

Status: the analysis, calibration and experiment layers exist; the capture, preflight,
background-noise check, quality assessment and the MEASURE screen are still being written.
Where this guide describes them, it describes the specified behaviour.

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
   signal-to-noise ratio per frequency.
2. **Fixed microphone.** Put the microphone on a stand or a stable surface, not in your hand.
   Note the distance and aim. Keep it in exactly the same place for every repeat and for any
   measurement you want to compare.
3. **Disable input processing.** OSCILLA asks the browser to turn off echo cancellation, noise
   suppression and automatic gain control. Browsers and devices may ignore the request. When
   the settings cannot be confirmed, the result says "Input processing may have been applied by
   browser/device", and the response may be altered in ways OSCILLA cannot correct. A USB
   measurement microphone or an audio interface is usually more predictable than a built-in
   microphone.
4. **Check the sample rate and range.** The sweep cannot exceed 95 % of the Nyquist frequency
   (half the sample rate); a higher requested end is lowered and the change is shown.

## Output level

- Start **low** and raise the level only until the signal is clearly above the background noise
  in the level meter. Moderate is enough: doubling the sweep duration raises the
  signal-to-noise ratio by about 3 dB without making anything louder.
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
version; take those warnings seriously.

## Calibration, if you have it

- A **frequency-response calibration profile** for your microphone (a file of frequency and
  correction values, typically supplied with a measurement microphone) corrects the microphone's
  own deviation from flat. It applies only between its first and last frequency; outside that
  range the result is shown uncorrected and marked as uncalibrated. The raw result is always
  kept.
- An **absolute level calibration** needs an external reference, typically a 94 dB SPL
  calibrator at 1 kHz on the microphone. It is valid only for the same microphone, input gain,
  browser settings and position it was taken with.
- The two are separate. A frequency profile alone does not give dB SPL.

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
- A measurement quality assessment (GOOD, USABLE, POOR, INVALID, always with its reasons) will
  accompany each result once the quality module lands; until then judge the result from the
  valid range, the noise check and the agreement between repeats.

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
