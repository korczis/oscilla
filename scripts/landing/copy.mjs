// The Czech copy of the generated landing at /oscilla/lab/ (owner decision Q107, plan P014;
// rule project.czech-prose). The facts (scripts/facts.mjs) carry the registry rows in the app's
// own words; the page shows them in Czech, so every id the registries name needs a row here.
// checkCopy() refuses a registry id without one: a new workspace or engine cannot ship onto the
// landing in English, the generator fails first (tests/unit/landing-lab.test.mjs proves it).
//
// Every sentence says only what the app does (project.no-fake-science): each is a translation
// of the registry row's own summary (src/js/ui/shell.js WORKSPACE_REGISTRY, src/js/synth/panels/
// engines.js ENGINE_MODULES), never a promise beyond it.

/** Workspace id -> { name, text }: the card's heading and its one sentence. */
export const WORKSPACE_COPY = Object.freeze({
  playground: { name: 'Playground',
    text: 'Nástroj na jedné obrazovce: generátor, analýza signálu, analyzátor mikrofonu, řízené '
      + 'měření, sekvencer vzorů a kompaktní Studio.' },
  measure: { name: 'Měření',
    text: 'Řízené měření řetězce reproduktor, místnost a mikrofon: frekvenční charakteristika, '
      + 'impulsní odezva a RTA, u každého běhu s hodnocením kvality.' },
  experiments: { name: 'Experimenty',
    text: 'Uložená měření jako experimenty: jejich definice, porovnání se základním během a '
      + 'zjištění, která se na ně odvolávají.' },
  analyzer: { name: 'Analyzátor',
    text: 'Spektrogram výstupu a analyzátor mikrofonu: živé pohledy, ne kalibrované měření.' },
  filter: { name: 'Filter Lab',
    text: 'Bikvadratický filtr a odezva, kterou pro něj spočítá prohlížeč, nastavená typem, '
      + 'mezní frekvencí a Q.' },
  compare: { name: 'Porovnání',
    text: 'Analyzátor mikrofonu vedle rozsahů slyšení z bioakustiky a pohledů na fázi a stereo.' },
  synthesis: { name: 'Syntéza',
    text: 'Aditivní harmonické, obálka ADSR, pohledy na fázi a stereo a duální oscilátor, vedle '
      + 'generátoru a jeho analýzy.' },
  sequencer: { name: 'Sekvencer',
    text: 'Blokové sekvence tónů, sweepů, pulzů a modulace, vedle kompaktního Studia.' },
  presets: { name: 'Presety',
    text: 'Vestavěná i uložená nastavení nástroje a historie toho, co se hrálo.' },
  learn: { name: 'Učení',
    text: 'Karty pojmů od frekvence po signálovou cestu, většina s ukázkou k přehrání.' },
  studio: { name: 'Studio',
    text: 'Signálový graf propojený kabely, s časovou osou, transportem a automatizací, '
      + 'spuštěný na Web Audio.' },
  synth: { name: 'Synth',
    text: 'Semimodulární monofonní hlas na modelu Studia s patch bayí a klávesami, záložka '
      + 'Engines s aditivními, FM, AM a ring, wavetable, hard sync a perkusními hlasy a záložka '
      + 'XY.' },
  about: { name: 'O aplikaci',
    text: 'Co OSCILLA je, jak vznikla a co přijde dál.' },
});

/** Synth engine id -> one Czech sentence (ENGINE_MODULES). */
export const ENGINE_COPY = Object.freeze({
  additive: 'Aditivní syntéza: zvuk složený ze sinusových harmonických.',
  fm: 'Frekvenční modulace: jeden oscilátor mění frekvenci druhého.',
  am: 'Amplitudová a kruhová modulace dvou oscilátorů.',
  wavetable: 'Wavetable: plynulý přechod mezi tvary vln z banky.',
  sync: 'Hard sync: oscilátor, kterého restartuje jiný oscilátor.',
  perc: 'Perkuse: krátké bicí hlasy.',
});

/** Sidebar group id -> Czech name (GROUP_REGISTRY); a workspace without a group has none. */
export const GROUP_COPY = Object.freeze({ analyze: 'Analýza', synthesis: 'Syntéza' });

/** Studio template category -> Czech name (TEMPLATE_CATEGORIES). */
export const CATEGORY_COPY = Object.freeze({ synthesis: 'syntéza', measurement: 'měření' });

/** Claim status -> { name, text } (docs/CLAIMS.yaml statuses). */
export const CLAIM_STATUS_COPY = Object.freeze({
  guaranteed: { name: 'Zaručeno',
    text: 'Implementováno a dokázáno testem v release gate; CI zastaví merge, když test selže.' },
  planned: { name: 'Plánováno',
    text: 'Specifikováno, ale zatím neimplementováno; uvedeno, aby bylo vidět, co chybí.' },
});

/** Plan milestone status -> Czech name; an unknown status is shown as it is. */
export const MILESTONE_STATUS_COPY = Object.freeze({
  done: 'hotovo', active: 'rozpracováno', in_progress: 'rozpracováno', 'in-progress':
    'rozpracováno', open: 'otevřeno', planned: 'plánováno', blocked: 'blokováno',
  todo: 'otevřeno', cancelled: 'zrušeno', proposed: 'navrženo',
});

/** Conventional Commit type -> Czech heading of its group in the per-release changelog. */
export const COMMIT_TYPE_COPY = Object.freeze({
  feat: 'Nové funkce', fix: 'Opravy', perf: 'Výkon', refactor: 'Přestavba kódu',
  revert: 'Vrácené změny', docs: 'Dokumentace', test: 'Testy', build: 'Sestavení', ci: 'CI',
  style: 'Styl kódu', chore: 'Údržba a plán', review: 'Revize', merge: 'Sloučení větví',
  proposal: 'Návrhy', other: 'Ostatní (mimo Conventional Commits)',
});
/** The groups a release's changelog shows unfolded; the rest start folded. */
export const COMMIT_TYPES_OPEN = Object.freeze(['feat', 'fix', 'perf', 'revert']);
/**
 * How many of the newest releases list their commits one by one (besides "Zatím nevydáno");
 * an older release keeps its type counts, plan-id chips, PR links and the compare link, which
 * lists its commits on GitHub. Keeps the page near 700 kB instead of every commit ever made.
 */
export const CHANGELOG_FULL_RELEASES = 8;

/** The derived milestone status (scripts/facts.mjs plan()) -> Czech name. */
export const PLAN_STATUS_COPY = Object.freeze({ DONE: 'hotovo', ACTIVE: 'rozpracováno',
  OPEN: 'otevřeno' });

/** ADR front-matter status -> Czech name; an unknown status is shown as it is. */
export const ADR_STATUS_COPY = Object.freeze({ accepted: 'přijato', proposed: 'navrženo',
  superseded: 'nahrazeno', deprecated: 'zastaralé', rejected: 'zamítnuto' });

/** Claim area (facts.claims.areaRule) -> Czech name where the area is not a module name. */
export const AREA_COPY = Object.freeze({ none: 'bez implementace', tooling: 'nástroje (scripts)',
  app: 'kompozice (src/js)', data: 'data (src/data)', ui: 'ui' });

/** The frame's tabs: the deep links the playable frame switches between. */
export const FRAME_TABS = Object.freeze([
  { id: 'playground', name: 'Playground', hash: '#m=playground',
    text: 'Generátor, analýza signálu a sekvencer na jedné obrazovce.', shot: /reference\.png$/ },
  { id: 'synth', name: 'Synth', hash: '#m=synth',
    text: 'Semimodulární hlas s patch bayí a klávesami.', shot: /synth\/.*desktop-panel-dark/ },
  { id: 'studio', name: 'Studio', hash: '#m=studio&st=subtractive-synth',
    text: 'Šablona Studia: subtraktivní syntezátor jako signálový graf.',
    shot: /studio\/.*desktop\.png$/ },
  { id: 'measure', name: 'Měření', hash: '#m=measure',
    text: 'Řízené měření reproduktoru, místnosti a mikrofonu.', shot: /measure\/.*desktop/ },
]);

/**
 * The registry ids the facts name that have no Czech copy here; throws when any is missing.
 * @param {{ workspaces?: {id:string, group?:string}[], engines?: {id:string}[] }} facts
 */
export function checkCopy(facts) {
  const missing = [];
  for (const w of facts.workspaces || []) {
    if (!WORKSPACE_COPY[w.id]) missing.push(`workspace "${w.id}"`);
    if (w.group && !GROUP_COPY[w.group]) missing.push(`group "${w.group}"`);
  }
  for (const e of facts.engines || []) {
    if (!ENGINE_COPY[e.id]) missing.push(`engine "${e.id}"`);
  }
  if (missing.length) {
    throw new Error(`landing: no Czech copy for ${missing.join(', ')}; add it to `
      + 'scripts/landing/copy.mjs (project.czech-prose)');
  }
}
