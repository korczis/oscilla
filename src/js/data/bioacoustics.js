// OSCILLA V2 bioacoustics reference data.
// Every value below comes from a cited publication; nothing is estimated or invented.
// Pure data module: no DOM, no Web Audio, no side effects.

export const DISCLAIMER = 'Ranges are approximate and vary by source and individual.';

const LSU_URL = 'https://www.lsu.edu/vetmed/deafness/hearingrange.php';
const HEFFNER_2007_URL = 'https://pubmed.ncbi.nlm.nih.gov/17203911/';

const HEFFNER_2007 = {
  authors: 'Heffner HE, Heffner RS',
  year: 2007,
  title: 'Hearing ranges of laboratory animals',
  venue: 'Journal of the American Association for Laboratory Animal Science 46(1):20-22',
  doi_or_url: HEFFNER_2007_URL,
};

const LSU_COMPILATION = {
  authors: 'Louisiana State University School of Veterinary Medicine (compiling Fay 1988 and '
    + 'Warfield 1973)',
  year: null,
  title: 'How Well Do Dogs and Other Animals Hear?',
  venue: 'LSU Veterinary Medicine, Deafness in Dogs (hearing-range table)',
  doi_or_url: LSU_URL,
};

/**
 * Hearing ranges, one entry per species.
 * criterionDbSpl is the sound pressure level at which the limits were taken, or null when the
 * source reports audiogram extremes at other levels (see `basis`). Heffner's convention for
 * comparing species is 60 dB SPL; entries that deviate say so in `basis` and `notes`.
 * `alternatives` lists differing published values so the UI can show the spread.
 */
export const HEARING_RANGES = [
  {
    id: 'human',
    label: 'Human',
    minHz: 31,
    maxHz: 17600,
    species: 'Homo sapiens',
    criterionDbSpl: 60,
    basis: '60 dB SPL audibility limits, behavioural audiogram (free field, young adults)',
    source: HEFFNER_2007,
    notes: 'The nominal 20 Hz-20 kHz range is a convention; Heffner & Heffner state it is '
      + 'only reached at high intensity, and only a young undamaged ear hears 20 kHz at any '
      + 'level. The upper limit declines with age and noise exposure. Ranges depend on the '
      + 'threshold criterion.',
    alternatives: [
      { minHz: 20, maxHz: 20000, basis: 'conventional nominal range', source: HEFFNER_2007 },
      {
        minHz: 64, maxHz: 23000, basis: 'LSU compilation of Fay 1988 / Warfield 1973',
        source: LSU_COMPILATION,
      },
    ],
  },
  {
    id: 'dog',
    label: 'Dog',
    minHz: 67,
    maxHz: 45000,
    species: 'Canis lupus familiaris',
    criterionDbSpl: 60,
    basis: '60 dB SPL audibility limits, behavioural audiogram (Heffner convention)',
    source: {
      authors: 'Heffner HE',
      year: 1983,
      title: 'Hearing in large and small dogs: absolute thresholds and size of the tympanic '
        + 'membrane',
      venue: 'Behavioral Neuroscience 97(2):310-318',
      doi_or_url: 'https://www.researchgate.net/publication/220008865',
    },
    notes: 'Upper limit varied only 41-47 kHz across breeds from the smallest to the largest '
      + '(Heffner 1983 abstract). The 60 dB SPL criterion follows Heffner 1998 (Applied Animal '
      + 'Behaviour Science 57:259-268, doi 10.1016/S0168-1591(98)00101-4); the 67 Hz-45 kHz '
      + 'figures were confirmed through the LSU table and secondary literature, not the '
      + 'full text of the 1983 paper (not retrievable).',
    alternatives: [
      { minHz: 67, maxHz: 45000, basis: 'LSU compilation of Fay 1988 / Warfield 1973',
        source: LSU_COMPILATION },
    ],
  },
  {
    id: 'cat',
    label: 'Cat',
    minHz: 48,
    maxHz: 85000,
    species: 'Felis catus',
    criterionDbSpl: 70,
    basis: '70 dB SPL audibility limits, behavioural audiogram of two cats (NOT 60 dB SPL)',
    source: {
      authors: 'Heffner RS, Heffner HE',
      year: 1985,
      title: 'Hearing range of the domestic cat',
      venue: 'Hearing Research 19(1):85-88',
      doi_or_url: 'https://doi.org/10.1016/0378-5955(85)90100-5',
    },
    notes: 'The primary paper uses a 70 dB SPL criterion, so this range is wider than a 60 dB '
      + 'SPL range would be. Narrower values around 45-55 Hz to 64-79 kHz appear in '
      + 'compilations that use stricter cut-offs. Very high limits depend on the criterion and '
      + 'on individual animals.',
    alternatives: [
      { minHz: 45, maxHz: 64000, basis: 'LSU compilation of Fay 1988 / Warfield 1973',
        source: LSU_COMPILATION },
    ],
  },
  {
    id: 'bat',
    label: 'Bat (big brown bat)',
    minHz: 850,
    maxHz: 120000,
    species: 'Eptesicus fuscus',
    criterionDbSpl: null,
    basis: 'Extremes of the average behavioural audiogram of three bats: 0.85 kHz at 106 dB SPL '
      + 'and 120 kHz at 83 dB SPL (not a 60 dB SPL range)',
    source: {
      authors: 'Koay G, Heffner HE, Heffner RS',
      year: 1997,
      title: 'Audiogram of the big brown bat (Eptesicus fuscus)',
      venue: 'Hearing Research 105(1-2):202-210',
      doi_or_url: 'https://doi.org/10.1016/s0378-5955(96)00208-0',
    },
    notes: 'Bats vary hugely by species; this is one species only. Best sensitivity was 7 dB '
      + 'SPL at 20 kHz, with a distinct drop in sensitivity at 45 kHz. Because the limits are '
      + 'measured at high levels, the range at 60 dB SPL is narrower than shown.',
    alternatives: [
      { minHz: 2000, maxHz: 110000, basis: 'LSU compilation, unspecified bat species',
        source: LSU_COMPILATION },
    ],
  },
  {
    id: 'elephant',
    label: 'Elephant',
    minHz: 17,
    maxHz: 10500,
    species: 'Elephas maximus (Indian elephant)',
    criterionDbSpl: 60,
    basis: '60 dB SPL audibility limits, behavioural audiogram of one young elephant',
    source: {
      authors: 'Heffner RS, Heffner HE',
      year: 1980,
      title: 'Hearing in the elephant (Elephas maximus)',
      venue: 'Science 208(4443):518-520',
      doi_or_url: 'https://doi.org/10.1126/science.7367876',
    },
    notes: 'Based on a single 7-year-old animal. Heffner & Heffner (2007) give the 60 dB SPL '
      + 'low-frequency limit as 17 Hz; the 10.5 kHz upper limit is quoted in Heffner & Heffner '
      + '(2016) in the 60 dB context. The follow-up J Comp Physiol Psychol 96:926-944 (1982, '
      + 'doi 10.1037/0735-7036.96.6.926) reports the same range. Low frequencies are audible '
      + 'at higher levels.',
    alternatives: [
      { minHz: 16, maxHz: 12000, basis: 'LSU compilation of Fay 1988 / Warfield 1973',
        source: LSU_COMPILATION },
    ],
  },
  {
    id: 'mouse',
    label: 'Mouse',
    minHz: 2300,
    maxHz: 85500,
    species: 'Mus musculus (domestic house mouse)',
    criterionDbSpl: 60,
    basis: '60 dB SPL audibility limits, behavioural audiogram',
    source: HEFFNER_2007,
    notes: 'Heffner & Heffner give the mouse a 60 dB SPL range of 2.3-85.5 kHz, the highest '
      + 'upper limit of the laboratory mammals they compare. Strain and individual differences '
      + 'exist; a wild-caught house mouse had a higher limit of about 92 kHz in Heffner & '
      + 'Masterton 1980 (J Acoust Soc Am 68:1584-1599).',
    alternatives: [
      { minHz: 1000, maxHz: 91000, basis: 'LSU compilation of Fay 1988 / Warfield 1973',
        source: LSU_COMPILATION },
    ],
  },
  {
    id: 'dolphin',
    label: 'Dolphin (bottlenose)',
    minHz: 100,
    maxHz: 150000,
    species: 'Tursiops truncatus',
    criterionDbSpl: null,
    basis: 'Underwater behavioural audiogram range as summarised by Au (2015) from Johnson '
      + '(1966); threshold criterion not stated in the summary (underwater dB re 1 uPa)',
    source: {
      authors: 'Au WWL',
      year: 2015,
      title: 'History of dolphin biosonar research',
      venue: 'Acoustics Today 11(4):10-17',
      doi_or_url:
        'https://acousticstoday.org/wp-content/uploads/2015/11/Dolphin-Biosonar-Research.pdf',
    },
    notes: 'Au states that Tursiops could hear 100 Hz to 150 kHz, the widest frequency range of '
      + 'any mammal. Levels are underwater (re 1 uPa), so a dB SPL in air criterion does not '
      + 'apply. Other compilations quote a lower limit near 75 Hz.',
    alternatives: [
      { minHz: 75, maxHz: 150000, basis: 'LSU compilation (porpoise), Fay 1988 / Warfield 1973',
        source: LSU_COMPILATION },
    ],
  },
];

/**
 * Typical vocalisation / echolocation frequency bands. Bands only: no audio is generated.
 */
export const CALL_EXAMPLES = [
  {
    id: 'bigBrownBatFm1',
    label: 'Big brown bat echolocation, FM1 sweep',
    minHz: 25000,
    maxHz: 55000,
    species: 'Eptesicus fuscus',
    kind: 'echolocation',
    basis: 'Frequency-modulated down-sweep of the first harmonic of the emitted sound',
    source: {
      authors: 'Stamper SA, Bates ME, Benedicto D, Simmons JA',
      year: 2009,
      title: 'Role of broadcast harmonics in echo delay perception by big brown bats',
      venue: 'Journal of Comparative Physiology A 195(1):79-89',
      doi_or_url: 'https://doi.org/10.1007/s00359-008-0384-5',
    },
    notes: 'Approximately 55 to 25 kHz, sweeping downward. Field recordings show a final '
      + 'sweep frequency of 22-35 kHz depending on habitat and phase (Surlykke & Moss 2000, '
      + 'J Acoust Soc Am 108:2419-2429, doi 10.1121/1.1315295).',
  },
  {
    id: 'bigBrownBatFm2',
    label: 'Big brown bat echolocation, FM2 sweep',
    minHz: 50000,
    maxHz: 105000,
    species: 'Eptesicus fuscus',
    kind: 'echolocation',
    basis: 'Frequency-modulated down-sweep of the second harmonic of the emitted sound',
    source: {
      authors: 'Stamper SA, Bates ME, Benedicto D, Simmons JA',
      year: 2009,
      title: 'Role of broadcast harmonics in echo delay perception by big brown bats',
      venue: 'Journal of Comparative Physiology A 195(1):79-89',
      doi_or_url: 'https://doi.org/10.1007/s00359-008-0384-5',
    },
    notes: 'Approximately 105 to 50 kHz. The two harmonics overlap near 55 kHz.',
  },
  {
    id: 'africanElephantRumble',
    label: 'African elephant rumble, fundamental',
    minHz: 14,
    maxHz: 35,
    species: 'Loxodonta africana',
    kind: 'vocalisation',
    basis: 'Fundamental frequency of very low frequency calls',
    source: {
      authors: 'Poole JH, Payne K, Langbauer WR Jr, Moss CJ',
      year: 1988,
      title: 'The social contexts of some very low frequency calls of African elephants',
      venue: 'Behavioral Ecology and Sociobiology 22:385-392',
      doi_or_url: 'https://doi.org/10.1007/BF00294975',
    },
    notes: 'Fundamentals of 14-35 Hz with levels up to about 103 dB SPL at 5 m. Rumbles also '
      + 'contain higher harmonics.',
  },
  {
    id: 'spinnerSpottedDolphinWhistle',
    label: 'Spinner and spotted dolphin whistle, fundamental',
    minHz: 7100,
    maxHz: 17400,
    species: 'Stenella longirostris, Stenella frontalis',
    kind: 'vocalisation',
    basis: 'Mean minimum (7.1-10.1 kHz) to mean maximum (14.5-17.4 kHz) of the whistle '
      + 'fundamental contour, free-ranging animals',
    source: {
      authors: 'Lammers MO, Au WWL, Herzing DL',
      year: 2003,
      title: 'The broadband social acoustic signaling behavior of spinner and spotted dolphins',
      venue: 'Journal of the Acoustical Society of America 114(3):1629-1639',
      doi_or_url: 'https://doi.org/10.1121/1.1596173',
    },
    notes: 'Means of 167 spinner and 220 spotted dolphin whistles, not extremes. Individual '
      + 'whistles span more; fundamentals are usually below 20 kHz and harmonics can reach '
      + '100 kHz. Other species, including bottlenose dolphins, differ.',
  },
  {
    id: 'dolphinClick',
    label: 'Dolphin echolocation clicks, peak energy',
    minHz: 60000,
    maxHz: 120000,
    species: 'Delphinidae (bottlenose dolphin, Tursiops truncatus, measured up to 120 kHz)',
    kind: 'echolocation',
    basis: 'Peak frequency of short broadband clicks',
    source: {
      authors: 'Lammers MO, Au WWL, Herzing DL (citing Au 1993, The Sonar of Dolphins)',
      year: 2003,
      title: 'The broadband social acoustic signaling behavior of spinner and spotted dolphins',
      venue: 'Journal of the Acoustical Society of America 114(3):1629-1639',
      doi_or_url: 'https://doi.org/10.1121/1.1596173',
    },
    notes: 'Clicks are broadband with peak energy between 60 and 120 kHz; Au (2015, Acoustics '
      + 'Today 11(4)) reports bottlenose dolphin click peak frequencies as high as 120 kHz '
      + 'in open water. Energy outside the peak extends further.',
  },
];

/**
 * Geometry of a frequency range on a logarithmic axis.
 * Returns { start, end, width } as fractions of the axis length (0 at axisMin, 1 at axisMax),
 * clamped to [0, 1], or null when the input is not a valid positive range that overlaps the axis.
 */
export function rangeToLogFraction(minHz, maxHz, axisMin = 10, axisMax = 100000) {
  const ok = [minHz, maxHz, axisMin, axisMax].every((v) => Number.isFinite(v) && v > 0);
  if (!ok || minHz >= maxHz || axisMin >= axisMax) {
    return null;
  }
  if (maxHz <= axisMin || minHz >= axisMax) {
    return null;
  }
  const span = Math.log(axisMax / axisMin);
  const clamp = (x) => Math.min(1, Math.max(0, x));
  const start = clamp(Math.log(minHz / axisMin) / span);
  const end = clamp(Math.log(maxHz / axisMin) / span);
  return { start, end, width: end - start };
}
