// The indefinite article of every sentence OSCILLA builds around a word it does not know in
// advance (K172): 'a' or 'an' by how the word is said, not by its first letter. Pure: a string
// in, a string out. src/js/studio/a11y.js re-exports both functions for the Studio; every other
// module that puts an article before an interpolated word imports them from here, and
// tests/unit/studio-article-by-sound.test.mjs fails on any module in src/js that decides the
// article itself.
//
//   indefiniteArticle(word) -> 'a' | 'an'     "an LFO", "an RTA", "a VCO", "a Filter",
//     "an Oscillator", "a Unison", "an 8-bit", "an 11 Hz", "an fm", "an S&H", "an uninstalled"
//   withArticle(word, { capital }) -> "an LFO" | "A Filter"

/** Letters whose spoken name begins with a vowel sound: "ef", "aitch", "el", "em", "ar", ... */
const VOWEL_SOUND_LETTERS = 'AEFHILMNORSX';

/**
 * Word starts said with a consonant sound although spelled with a vowel: "a unison", "a user",
 * "a European", "a one-shot". "uni" before "n" or "mp" is the prefix "un-" ("an uninstalled",
 * "an unimportant").
 */
const CONSONANT_SOUND_START = /^(?:eu|one\b|once\b|uni(?!n|mp)|u[cfklrst][aeiou]|ubiq)/i;

/** Word starts said with a vowel sound although spelled with a consonant ("an hour"). */
const VOWEL_SOUND_START = /^(?:hour|honest|honou?r|heir)/i;

/** Capitalised words said as words, not letter by letter ("a MIDI input", "a WAV file"). */
const SAID_AS_WORDS = new Set(['MIDI', 'WAV', 'JSON', 'RAM', 'ROM', 'OSCILLA']);

/** Lowercase words with no vowel letter that are said as words ("a hz" is "a hertz"). */
const VOWELLESS_WORDS = new Set(['hz', 'khz', 'mhz']);

/** Lowercase initialisms spelled with a vowel and read letter by letter ("an lfo"). */
const LOWERCASE_INITIALISMS = new Set(['lfo', 'rta', 'adsr', 'eq', 'ir', 'ui', 'am']);

/** What separates the first token from the rest: "AM/ring", "S&H", "8-bit", "XY Pad". */
const TOKEN_END = /[\s/,.;:()&+_-]/;

/** Quotes and brackets in front of the word are not said: '"sweep"' is said "sweep". */
const LEADING_MARKS = /^["'“‘«(\[]+/;

/**
 * The article of a number said as written: "an 8", "an 80", "an 8192", "an 11", "an 18 ms",
 * "an 11025 Hz", "an 18000" ("eighteen thousand"), but "a 110", "a 1100" ("one thousand one
 * hundred"), "a 180000", "a 48000", "a 0.5". `digits` is the integer part, separators removed.
 */
function numberArticle(digits) {
  if (digits[0] === '8') return 'an';
  const lead = digits.length % 3 || 3;
  return lead === 2 && (digits.startsWith('11') || digits.startsWith('18')) ? 'an' : 'a';
}

/**
 * 'a' or 'an' for `word`, by how it is said rather than its first letter (K172).
 * - A number goes by how it is read: "an 8-bit", "an 11 Hz", "a 48000 Hz", "a 3-sample".
 * - A first token of capitals and digits ("LFO", "RTA", "FM engine", "AM/ring", "XY Pad",
 *   "S&H", "MP3") is an initialism read letter by letter, so the article follows the first
 *   letter's name ("an LFO", "a VCO"); so is a lone capital ("an X"). An acronym said as a word
 *   (SAID_AS_WORDS: "a MIDI") is not.
 * - A lowercase first token with no vowel letter ("fm", "rms", "dc") is read letter by letter
 *   too, as are the lowercase forms in LOWERCASE_INITIALISMS ("an lfo"); "hz" is a word.
 * - Every other word goes by its spoken start: "an Oscillator", "a Filter", "a Unison", "an
 *   Umbrella", "a European", "an hour", "an uninstalled".
 */
export function indefiniteArticle(word) {
  const s = String(word ?? '').trim().replace(LEADING_MARKS, '');
  const num = /^\d[\d,]*/.exec(s);
  if (num) return numberArticle(num[0].replace(/,/g, ''));
  const head = s.split(TOKEN_END)[0];
  if (/^[A-Z][A-Z0-9]*$/.test(head) && !SAID_AS_WORDS.has(head)) {
    return VOWEL_SOUND_LETTERS.includes(head[0]) ? 'an' : 'a';
  }
  const lower = head.toLowerCase();
  if (head === lower && ((head.length > 1 && /^[a-z]+$/.test(head) && !/[aeiouy]/.test(head)
    && !VOWELLESS_WORDS.has(head)) || LOWERCASE_INITIALISMS.has(head))) {
    return VOWEL_SOUND_LETTERS.includes(head[0].toUpperCase()) ? 'an' : 'a';
  }
  if (VOWEL_SOUND_START.test(s)) return 'an';
  if (CONSONANT_SOUND_START.test(s)) return 'a';
  return /^[aeiou]/i.test(s) ? 'an' : 'a';
}

/** `word` with its indefinite article: "an LFO", "a Filter"; `capital` starts a sentence. */
export function withArticle(word, { capital = false } = {}) {
  const a = indefiniteArticle(word);
  return `${capital ? a[0].toUpperCase() + a.slice(1) : a} ${word}`;
}
