// Learn topics: explanatory text and a demo configuration per topic. Extracted from V1
// (index.html@a7b7a23, section 5). Text and demo configurations are unchanged, with two V2 fixes
// over index.html@a7b7a23: the 'hearing' demo sets the octave steps explicitly (V1's cfg has no
// pp, so a user-edited Steps field changed what "Octave steps 125 Hz – 16 kHz" played), and the
// 'samplerate' body names the Filter Lab's own model rate (V2 added that lab: its chart models
// FILTER_PREVIEW_SAMPLE_RATE before audio starts, not the provisional rate of the readouts), its
// rates built from the constants. demo.viz keeps the V1 visualization ids (wave, spectrum,
// motion, harmonics, interference).

import {
  FILTER_PREVIEW_SAMPLE_RATE, OCTAVE_STEP_FREQUENCIES, PROVISIONAL_SAMPLE_RATE,
} from '../core/constants.js';
import { encodeStudioLink } from '../core/url-state-studio.js';
import { MAX_VOICES } from '../synth/voice-pool.js';

const kHz = (hz) => `${hz / 1000} kHz`;

/**
 * V3 topics (K058-K066): a demo with `href` opens that address through the one hash dispatcher
 * (ui/navigation.js) instead of configuring the Playground. They follow the V1 topics in
 * LEARN_TOPICS (tests/unit/freeze.test.mjs compares the V1 ones with the golden file).
 */
export const LEARN_INSTRUMENT_TOPICS = Object.freeze([
  // Czech since Czech pass 8 (U116, Q104): V3 text, which no golden pins.
  { id: 'semi-modular-voice', title: 'Semimodulární hlas',
    body: 'Semimodulární hlas zní i bez kabelu: každý vstupní jack má normál na výchozí zdroj '
      + '(výšku tónu z klávesnice do obou oscilátorů, gate do obou obálek, oscilátory do mixéru, '
      + 'pak horní a dolní propust 12 dB/oct v sérii do VCA). Kabel zapojený do jacku jeho '
      + 'normál nahradí. Výška tónu je řídicí napětí v oktávách (1.00 oct na oktávu, '
      + 'v digitální doméně přesně); gate otevírá obálky. Rezonance filtru zvoní, ale filtr '
      + 'nepřejde do samooscilace, šířka pulzu je nastavená, ne modulovaná, a S&H krokuje '
      + 'náhodný zdroj z pevného semínka: nevzorkuje žádný vstup.',
    // data-osc-link: learn.demo
    demo: { label: 'Otevřít panel Synth', viz: 'spectrum', href: '#m=synth&yp=init' } },
  { id: 'synthesis-engines', title: 'Syntézní enginy',
    body: `Záložka Enginy v Synthu obsahuje polyfonní enginy, každý až s ${MAX_VOICES} hlasy. `
      + 'Aditivní engine sčítá harmonické (táhla). '
      + 'FM řídí frekvenci jednoho sinusového operátoru druhým: '
      + 'modulátor s indexem I vychyluje svůj cíl o I násobků své vlastní frekvence, takže '
      + 'postranní pásma leží na frekvenci nosné plus a minus násobky frekvence modulátoru. '
      + 'Kruhová modulace násobí dva signály, takže vzniknou jejich součtová a rozdílová '
      + 'frekvence; AM nosnou zachovává. Wavetable prolíná dvě sousední tabulky a jeho úroveň '
      + 'je spojitá; banka hard sync obsahuje pily synchronizované v pevných poměrech, ne '
      + 'plynulé rozmítání synchronizace. Perkuse skládá každý úder z tónů a filtrovaného šumu, '
      + 'které doznívají na -60 dB rel. Harmonické nad 0.95násobkem digitálního Nyquistova '
      + 'limitu se vynechají a jejich počet se uvede. Drnkaná struna a zpětná vazba FM operátoru '
      + 'potřebují ve zvukovém grafu smyčku, kterou project.no-silent-feedback zatím odmítá.',
    demo: { label: 'Otevřít FM zvon', viz: 'spectrum', // data-osc-link: learn.demo
      href: '#m=synth&yt=engines&ye=fm&yp=fm-bell' } },
]);
// V1: LEARN_TOPICS (index.html@a7b7a23)
export const LEARN_TOPICS = [
  { id: 'frequency', title: 'Frequency', body: 'Frequency is the number of cycles per second, measured in hertz (Hz). Doubling it raises the pitch by one octave.',
    demo: { label: 'Hear 220 → 440 → 880 Hz', viz: 'wave', cfg: { source: 'single', pattern: 'sequence', waveform: 'sine', pp: { sequence: { text: '220, 440, 880', toneMs: 500, gapMs: 80, repeats: 1 } } } } },
  { id: 'period', title: 'Period', body: 'The period is the duration of one cycle: T = 1 / f. Higher frequencies have shorter periods.',
    demo: { label: 'Show 440 Hz (2.27 ms)', viz: 'wave', cfg: { source: 'single', pattern: 'tone', waveform: 'sine', frequency: 440 } } },
  { id: 'wavelength', title: 'Wavelength', body: 'In air (≈ 343 m/s) the wavelength is λ = 343 / f. 100 Hz spans about 3.4 m; 10 kHz about 3.4 cm.',
    demo: { label: 'Try 100 Hz', viz: 'wave', cfg: { source: 'single', pattern: 'tone', waveform: 'sine', frequency: 100 } } },
  { id: 'amplitude', title: 'Amplitude', body: 'Amplitude is the size of the oscillation. Here it is a relative digital level — not a calibrated sound pressure level.',
    demo: { label: 'AM: watch the level move', viz: 'wave', cfg: { source: 'single', pattern: 'am', waveform: 'sine', frequency: 440, pp: { am: { modFreq: 2, depth: 90 } } } } },
  { id: 'waveform', title: 'Waveform', body: 'The waveform is the shape of one cycle. Sine is pure; triangle, saw and square add harmonics and sound brighter.',
    demo: { label: 'Saw at 220 Hz', viz: 'wave', cfg: { source: 'single', pattern: 'tone', waveform: 'sawtooth', frequency: 220 } } },
  { id: 'harmonic', title: 'Harmonics', body: 'Harmonics are integer multiples of the fundamental (2f, 3f, …). Square and triangle contain odd harmonics; saw contains all.',
    demo: { label: 'Square at 220 Hz', viz: 'harmonics', cfg: { source: 'single', pattern: 'tone', waveform: 'square', frequency: 220 } } },
  { id: 'nyquist', title: 'Nyquist limit', body: 'A digital system can represent frequencies only below half its sample rate. Nyquist is a digital limit, not a guarantee of speaker performance.',
    demo: { label: 'Square at 5 kHz', viz: 'harmonics', cfg: { source: 'single', pattern: 'tone', waveform: 'square', frequency: 5000 } } },
  { id: 'samplerate', title: 'Sample rate', body: `The sample rate is how many values per second the audio system produces. Once audio starts, OSCILLA uses the rate this device reports; until then the display assumes ${kHz(PROVISIONAL_SAMPLE_RATE)} provisionally and marks it as such; the Filtry page models its response at ${kHz(FILTER_PREVIEW_SAMPLE_RATE)} and labels it.`,
    demo: { label: 'Open the spectrum', viz: 'spectrum', cfg: { source: 'single', pattern: 'tone', waveform: 'sine', frequency: 1000 } } },
  { id: 'aliasing', title: 'Aliasing', body: 'Content above Nyquist folds back to wrong, lower frequencies. Web Audio oscillators are band-limited, so they omit harmonics above Nyquist instead.',
    demo: { label: 'Saw at 8 kHz: few harmonics fit', viz: 'harmonics', cfg: { source: 'single', pattern: 'tone', waveform: 'sawtooth', frequency: 8000 } } },
  { id: 'modulation', title: 'Modulation', body: 'Modulation means one signal changes a property of another — its level (AM) or its frequency (FM, wobble, siren).',
    demo: { label: 'Siren', viz: 'motion', cfg: { source: 'single', pattern: 'siren', waveform: 'sine', pp: { siren: { min: 500, max: 1000, rate: 0.5, shape: 'sine' } } } } },
  { id: 'am', title: 'AM', body: 'Amplitude modulation varies the level. Slow AM is heard as tremolo; fast AM creates sidebands at f ± fm.',
    demo: { label: 'AM 5 Hz tremolo', viz: 'wave', cfg: { source: 'single', pattern: 'am', waveform: 'sine', frequency: 660, pp: { am: { modFreq: 5, depth: 80 } } } } },
  { id: 'fm', title: 'FM', body: 'Frequency modulation varies the frequency. Slow FM is vibrato; audio-rate FM creates many sidebands spaced by the modulation frequency.',
    demo: { label: 'Audio-rate FM', viz: 'spectrum', cfg: { source: 'single', pattern: 'fm', waveform: 'sine', frequency: 1000, pp: { fm: { modFreq: 200, depthHz: 400 } } } } },
  { id: 'interference', title: 'Interference', body: 'When two waves add, they reinforce where they are in phase and cancel where they are out of phase.',
    demo: { label: '440 + 445 Hz', viz: 'interference', mode: 'dual', cfg: { source: 'dual', dual: { a: { freq: 440, wave: 'sine', gain: 100, detune: 0 }, b: { freq: 445, wave: 'sine', gain: 100, detune: 0 }, levelA: 80, levelB: 80, stereo: false, binaural: false } } } },
  { id: 'beating', title: 'Beating', body: 'Two close frequencies produce a level that rises and falls at their difference: 440 Hz and 442 Hz beat at about 2 Hz.',
    demo: { label: '440 + 442 Hz', viz: 'interference', mode: 'dual', cfg: { source: 'dual', dual: { a: { freq: 440, wave: 'sine', gain: 100, detune: 0 }, b: { freq: 442, wave: 'sine', gain: 100, detune: 0 }, levelA: 80, levelB: 80, stereo: false, binaural: false } } } },
  { id: 'logscale', title: 'Logarithmic perception', body: 'Pitch is perceived roughly by ratios: 100→200 Hz and 1→2 kHz are both one octave and sound like a similar step. That is why sweeps and maps here are logarithmic.',
    demo: { label: 'Log sweep 20 Hz → 20 kHz', viz: 'motion', cfg: { source: 'sweep', sweep: { start: 20, end: 20000, durationMs: 10000, curve: 'log', direction: 'up', repeat: 'once' } } } },
  { id: 'hearing', title: 'Human hearing range', body: 'Nominally 20 Hz – 20 kHz. The upper limit commonly falls with age and noise exposure; individual hearing varies widely.',
    demo: { label: 'Octave steps 125 Hz – 16 kHz', viz: 'motion', cfg: { source: 'single', pattern: 'octave', waveform: 'sine',
      // V2 fix: the steps (and their timing) are what the label promises
      pp: { octave: { text: OCTAVE_STEP_FREQUENCIES.join(', '), toneMs: 400, gapMs: 100 } } } } },
  { id: 'ultrasound', title: 'Ultrasound', body: 'Nominal ultrasound begins above about 20 kHz. 15.5 kHz is a high-frequency signal, not ultrasound. Generating >20 kHz digitally does not mean a speaker emits it.',
    demo: { label: 'High range sweep', viz: 'spectrum', cfg: { source: 'sweep', sweep: { start: 8000, end: 'max', durationMs: 4000, curve: 'log', direction: 'up', repeat: 'once' } } } },
  { id: 'speakers', title: 'Speaker limitations', body: 'Speakers, headphones, DACs and amplifiers can attenuate or distort very low and very high frequencies. Perceived loudness is not a measure of acoustic output.',
    demo: { label: '40 Hz sub-bass', viz: 'spectrum', cfg: { source: 'single', pattern: 'finite', waveform: 'sine', frequency: 40, duration: 2000 } } },
  ...LEARN_INSTRUMENT_TOPICS,
];


/**
 * V2 extension: where each V1 demo.viz id is shown in the V2 layout (analysis tab ids of the
 * visual shell; 'motion' is the frequency-over-time chart, 'phase' the Phase & Stereo panel).
 * A suggestion for the integration; LEARN_TOPICS itself is unchanged.
 */
export const LEARN_VIZ_TARGETS = Object.freeze({
  wave: 'waveform',
  spectrum: 'spectrum',
  motion: 'motion',
  path: 'signalPath',
  harmonics: 'harmonics',
  interference: 'phase',
});

/**
 * V617: concept cards, shown after the V1 topics (LEARN_TOPICS stays the V1 list). A concept
 * card has no demo; its link is an OSCILLA address (the Studio link of core/url-state-studio.js),
 * so following it adds one history entry and Back returns to Learn.
 */
export const LEARN_CONCEPTS = [
  // Czech since Czech pass 8 (U116, Q104): V617 text, which no golden pins.
  { id: 'signal-path', title: 'Signálová cesta',
    body: 'Signálová cesta je trasa, kterou zvuk prochází od svého zdroje přes zpracování až na '
      + 'výstup. Ve Studiu je každý box uzel a každý kabel nese jeden signál; slyšet je jen to, '
      + 'co dorazí do Master Output.',
    link: { label: 'Otevřít šablonu First Patch ve Studiu',
      href: `#${encodeStudioLink({ templateId: 'first-patch' })}` } },
];

/** What the Learn view lists: the topics, then the concept cards. */
export const LEARN_CARDS = [...LEARN_TOPICS, ...LEARN_CONCEPTS];
