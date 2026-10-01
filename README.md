# OSCILLA — Interactive Sound & Frequency Lab

See sound. Shape frequency.

A browser-based acoustic laboratory: generate tones, sweeps, chirps, modulated and dual-oscillator
signals with the Web Audio API and watch them as waveform, spectrum, frequency motion, signal path,
harmonics and interference visualizations.

The whole application is one file, [`index.html`](index.html). Open it directly (`file://`) or visit
the GitHub Pages deployment: https://korczis.github.io/oscilla/

## Safety

Audio signals can be uncomfortable or harmful at excessive output levels. Start low, especially with
headphones. Perceived loudness is not a reliable measure of acoustic output, particularly at very low
or very high frequencies. Digital signal generation does not guarantee that your playback hardware
reproduces the requested frequency accurately.

## Development

No build step. See [`CLAUDE.md`](CLAUDE.md) for architecture and commands, and [`.ai/`](.ai/) for
the Majordomus-supervised plan (`majordomus plan status`).
