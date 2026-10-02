# OSCILLA — Interactive Sound & Frequency Lab

See sound. Shape frequency.

A browser-based acoustic laboratory. Generate tones, sweeps, chirps, modulated, additive and
dual-oscillator signals with the Web Audio API; measure them as waveform, live spectrum and
spectrogram; compare the generator with your microphone; compose block sequences; shape them
with ADSR and biquad filters; explore phase, Lissajous and stereo; and export WAV, PNG or the
configuration. The About workspace tells how OSCILLA was built and with what discipline.

Run it: open [`dist/index.html`](dist/index.html) directly (`file://`, no build or server needed),
or visit the GitHub Pages deployment: https://korczis.github.io/oscilla/

## Safety

Audio signals can be uncomfortable or harmful at excessive output levels. Start low, especially with
headphones. Perceived loudness is not a reliable measure of acoustic output, particularly at very low
or very high frequencies. Digital signal generation does not guarantee that your playback hardware
reproduces the requested frequency accurately. Microphone readings are relative, not calibrated.

## Development

Source is modular (`src/`, plain ES modules and CSS); the runtime is one self-contained file.

```bash
npm ci
npm run build          # src/ -> dist/index.html (deterministic; commit the result)
npm test               # unit and V1 freeze suites
npm run release-gate   # everything CI gates on, see tests/README.md
npm run visual         # screenshot vs. the visual reference at 1536x1024
```

Pull requests run the same gate in CI; with auto-merge on, a passing PR lands on `main` and
GitHub Pages publishes `dist/index.html`. V1 (the hand-written single file) is tagged `v1.0.0`.

AI workers start at [`AGENTS.md`](AGENTS.md) (Claude Code: [`CLAUDE.md`](CLAUDE.md)), which lead
into the Majordomus layer under [`.ai/`](.ai/) — rules, plan (`majordomus plan status`) and
workflows.
