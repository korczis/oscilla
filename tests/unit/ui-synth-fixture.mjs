// The shared synth-theme layer's test fixture (src/js/ui/synth/; not a test file itself): a
// token set shaped as synthTokens(el) returns it, whose every value is a var() reference, so a
// test can tell a token that reached the markup from a literal that did not come from one; and
// the markup scans the layer's rules ask for (project.visual-identity-lock v3: no colour
// literal; v4: no literal opacity, alpha or shadow; the cable seam with dev-53: every shape
// sets its own stroke).

const v = (name) => `var(--osc-${name})`;

export const TOKENS = Object.freeze({
  surface: Object.freeze({ plateHi: v('surface-3'), plateLo: v('surface-1'),
    card: v('surface-2'), edge: v('bg') }),
  text: Object.freeze({ label: v('text-muted'), value: v('text'), dim: v('text-dim') }),
  control: Object.freeze({ cap: v('surface-1'), capHi: v('surface-4'), ring: v('cyan'),
    track: v('border'), pointer: v('text'), focus: v('focus'), disabled: v('text-dim') }),
  jack: Object.freeze({ body: v('surface-0'), ring: v('text-dim'), normal: v('text-dim'),
    refuse: v('red') }),
  cable: Object.freeze({ palette: Object.freeze([v('cyan'), v('red-soft'), v('magenta'),
    v('green'), v('purple'), v('blue')]), shadow: v('bg'), sheen: v('text') }),
});

/** Every leaf of a token set, palette entries included. */
export function tokenValues(t = TOKENS) {
  return Object.values(t).flatMap((g) => Object.values(g).flatMap((x) => (Array.isArray(x)
    ? x : [x])));
}

// CSS Color 4 named colours. currentColor is the fallback the layer may use; it is not here.
export const NAMED = ['aliceblue', 'antiquewhite', 'aqua', 'aquamarine', 'azure', 'beige',
  'bisque', 'black', 'blanchedalmond', 'blue', 'blueviolet', 'brown', 'burlywood', 'cadetblue',
  'chartreuse', 'chocolate', 'coral', 'cornflowerblue', 'cornsilk', 'crimson', 'cyan',
  'darkblue', 'darkcyan', 'darkgoldenrod', 'darkgray', 'darkgreen', 'darkgrey', 'darkkhaki',
  'darkmagenta', 'darkolivegreen', 'darkorange', 'darkorchid', 'darkred', 'darksalmon',
  'darkseagreen', 'darkslateblue', 'darkslategray', 'darkslategrey', 'darkturquoise',
  'darkviolet', 'deeppink', 'deepskyblue', 'dimgray', 'dimgrey', 'dodgerblue', 'firebrick',
  'floralwhite', 'forestgreen', 'fuchsia', 'gainsboro', 'ghostwhite', 'gold', 'goldenrod',
  'gray', 'green', 'greenyellow', 'grey', 'honeydew', 'hotpink', 'indianred', 'indigo', 'ivory',
  'khaki', 'lavender', 'lavenderblush', 'lawngreen', 'lemonchiffon', 'lightblue', 'lightcoral',
  'lightcyan', 'lightgoldenrodyellow', 'lightgray', 'lightgreen', 'lightgrey', 'lightpink',
  'lightsalmon', 'lightseagreen', 'lightskyblue', 'lightslategray', 'lightslategrey',
  'lightsteelblue', 'lightyellow', 'lime', 'limegreen', 'linen', 'magenta', 'maroon',
  'mediumaquamarine', 'mediumblue', 'mediumorchid', 'mediumpurple', 'mediumseagreen',
  'mediumslateblue', 'mediumspringgreen', 'mediumturquoise', 'mediumvioletred', 'midnightblue',
  'mintcream', 'mistyrose', 'moccasin', 'navajowhite', 'navy', 'oldlace', 'olive', 'olivedrab',
  'orange', 'orangered', 'orchid', 'palegoldenrod', 'palegreen', 'paleturquoise',
  'palevioletred', 'papayawhip', 'peachpuff', 'peru', 'pink', 'plum', 'powderblue', 'purple',
  'rebeccapurple', 'red', 'rosybrown', 'royalblue', 'saddlebrown', 'salmon', 'sandybrown',
  'seagreen', 'seashell', 'sienna', 'silver', 'skyblue', 'slateblue', 'slategray', 'slategrey',
  'snow', 'springgreen', 'steelblue', 'tan', 'teal', 'thistle', 'tomato', 'transparent',
  'turquoise', 'violet', 'wheat', 'white', 'whitesmoke', 'yellow', 'yellowgreen'];
const NAMED_SET = new Set(NAMED);

const HEX = /#[0-9a-f]{3,8}\b/i;
const FUNCTION = /\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(/i;

/** The colour literals in a markup string: hex, colour functions, named colours as a value. */
export function colourLiterals(markup) {
  const found = [];
  const hex = HEX.exec(markup);
  if (hex) found.push(hex[0]);
  const fn = FUNCTION.exec(markup);
  if (fn) found.push(fn[0]);
  for (const [, value] of markup.matchAll(/="([^"]*)"/g)) {
    for (const word of value.toLowerCase().split(/[\s,;:()]+/)) {
      if (NAMED_SET.has(word)) found.push(word);
    }
  }
  return found;
}

const SHAPES = /<(path|circle|rect|line|ellipse|polygon|polyline)\b[^>]*>/g;

/** The shape elements of a markup string that carry no stroke attribute of their own. */
export function shapesWithoutStroke(markup) {
  return [...markup.matchAll(SHAPES)].map((m) => m[0]).filter((s) => !/\sstroke="/.test(s));
}

/** Every value of a paint attribute (fill, stroke, stop-color) in a markup string. */
export function paints(markup) {
  return [...markup.matchAll(/\s(?:fill|stroke|stop-color)="([^"]*)"/g)].map((m) => m[1]);
}

// project.visual-identity-lock v4: the layer reads its intensity from the hw-* Tailwind keys
// (opacity-hw-sheen, ...), so no number of its own may set an opacity, an alpha or a shadow.
const INTENSITY = [
  [/\b(?:stroke-|fill-|flood-|stop-)?opacity\s*(?:=\s*["'`]?|:)\s*[-+]?\.?\d/i,
    'a literal opacity'],
  [/\b(?:rgba?|hsla?)\(/i, 'a colour function (alpha)'],
  [/#[0-9a-f]{3,8}\b(?![-\w])/i, 'a hex colour'],
  [/\bopacity-\[|\/\[0?\.\d|\b(?:bg|text|border|fill|stroke|ring|shadow)-[\w-]+\/\d{1,3}\b/,
    'a Tailwind alpha literal'],
  [/\b(?:box|text)-shadow\s*:|drop-shadow\(|\b(?:drop-)?shadow-\[|<feDropShadow\b/i,
    'a shadow literal'],
];

/** The intensity literals in a markup or source string: what, and the text that matched. */
export function intensityLiterals(text) {
  const found = [];
  for (const [rx, what] of INTENSITY) {
    const m = rx.exec(text);
    if (m) found.push(`${what}: ${m[0]}`);
  }
  return found;
}
