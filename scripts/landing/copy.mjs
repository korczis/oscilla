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

/**
 * The milestone status Majordomus derives, grouped as scripts/facts.mjs plan() groups it (ACTIVE:
 * its phase now; OPEN: next and later) -> Czech name.
 */
export const PLAN_STATUS_COPY = Object.freeze({ DONE: 'hotovo', ACTIVE: 'rozpracováno',
  OPEN: 'otevřeno', CANCELLED: 'zrušeno', UNKNOWN: 'neznámý' });

/** ADR front-matter status -> Czech name; an unknown status is shown as it is. */
export const ADR_STATUS_COPY = Object.freeze({ accepted: 'přijato', proposed: 'navrženo',
  superseded: 'nahrazeno', deprecated: 'zastaralé', rejected: 'zamítnuto' });

/** Claim area (facts.claims.areaRule) -> Czech name where the area is not a module name. */
export const AREA_COPY = Object.freeze({ none: 'bez implementace', tooling: 'nástroje (scripts)',
  app: 'kompozice (src/js)', data: 'data (src/data)', ui: 'ui' });

/**
 * Ratchet baseline file -> { name, short, counts, test, rule }: its Czech name, a short label for
 * the table view, what its total counts (the derivation of scripts/facts.mjs baselineTotal, in
 * words), the test that enforces it and the project rule that requires it (null: only the test
 * binds it). checkCopy() refuses a baseline the facts find without a row, and
 * tests/unit/landing-lab.test.mjs proves each named test reads its file and each rule exists.
 */
export const RATCHET_COPY = Object.freeze({
  'tests/browser/collection-count-baseline.json': { name: 'Napevno zapsané počty v testech',
    short: 'počty', counts: 'kontroly prohlížečových sad, které porovnávají napevno zapsaný počet '
      + 'prvků (délka seznamu entries)',
    test: 'tests/unit/browser-collection-counts.test.mjs', rule: 'project.suite-harness' },
  'tests/browser/iphone-baseline.json': { name: 'Nedosažitelné prvky na telefonu',
    short: 'telefon', counts: 'ovládací prvky mimo okraj, zakryté nebo příliš malé, po '
      + 'prohlížečích, telefonech a plochách (součet debt)',
    test: 'tests/browser/iphone.cjs', rule: null },
  'tests/browser/timing-baseline.json': { name: 'Pevná čekání v prohlížečových testech',
    short: 'čekání', counts: 'nálezy skeneru časování (pevné uspání, počítané čekání) z doby před '
      + 'pravidlem, po souborech a druzích (součet debt)',
    test: 'tests/unit/browser-timing.test.mjs', rule: 'project.bounded-test-timing' },
  'tests/unit/control-drive-baseline.json': { name: 'Prvky, které žádný test neovládá',
    short: 'neovládané', counts: 'ovládací prvky src/index.html, na které nesahá žádná '
      + 'prohlížečová sada (délka seznamu undriven)',
    test: 'tests/unit/control-drive-baseline.test.mjs', rule: null },
  'tests/unit/czech-prose-baseline.json': { name: 'Anglický text v aplikaci',
    short: 'angličtina', counts: 'anglické věty, které aplikace ještě zobrazuje (pole total, '
      + 'jehož rovnost se součtem po souborech hlídá test)',
    test: 'tests/unit/czech-prose.test.mjs', rule: 'project.czech-prose' },
  'tests/unit/key-listener-baseline.json': { name: 'Klávesové posluchače mimo registr',
    short: 'klávesy', counts: 'posluchače keydown a keyup mimo src/js/ui/keys/ (součet counts '
      + 'po souborech)',
    test: 'tests/unit/keys-registry.test.mjs', rule: null },
  'tests/unit/patch-contract-baseline.json': { name: 'Chybějící pole kontraktu patchů',
    short: 'kontrakt', counts: 'chybějící pole kontraktu portů a parametrů uzlů Studia (součet '
      + 'counts po polích)',
    test: 'tests/unit/patch-contract.test.mjs', rule: null },
  'tests/unit/readout-provenance-baseline.json': { name: 'Údaje bez popsaného původu',
    short: 'údaje', counts: 'údaje src/index.html bez řádku v docs/v3/readout-truth.yaml (délka '
      + 'seznamu undescribed)',
    test: 'tests/unit/readout-provenance.test.mjs', rule: null },
  'tests/unit/source-size-baseline.json': { name: 'Stropy velikosti zdrojových souborů',
    short: 'stropy', counts: 'součet bajtových stropů souborů src/js a src/index.html nad '
      + '40 000 B (caps); strop smí stoupnout jen se záznamem v seznamu raises',
    test: 'tests/unit/source-size-budget.test.mjs', rule: null },
  'tests/unit/ui-flowbite-pro-baseline.json': { name: 'Dluh migrace na Flowbite Pro',
    short: 'Flowbite', counts: 'nemigrované plochy, třídy osc-*, starý slovník a selektory '
      + 'starých stylů (pole debt; srovnatelné jen v rámci jedné verze měření)',
    test: 'tests/unit/ui-flowbite-pro.test.mjs', rule: 'project.ui-uses-flowbite-pro' },
});

/** Review verdict -> Czech name (review-verdict/v1 `verdict`); an unknown one is shown as it is. */
export const VERDICT_COPY = Object.freeze({ merge: 'sloučit', changes: 'změny',
  'changes-requested': 'změny požadovány' });

/**
 * Review-audit class (review-audit/v1 `class`, scripts/facts.mjs reviewAudits) -> its Czech
 * name, in the order the page's filter and the chart list them; `unaudited` is a finding still
 * open in its verdict that no audit names. An unknown class is shown as it is.
 */
export const AUDIT_CLASS_COPY = Object.freeze({ open: 'Stále otevřené', fixed: 'Opraveno',
  superseded: 'Nahrazeno', unaudited: 'Neauditováno' });

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
 * @param {{ workspaces?: {id:string, group?:string}[], engines?: {id:string}[],
 *   ratchets?: {file:string}[] }} facts
 */
export function checkCopy(facts) {
  const missing = [];
  for (const r of facts.ratchets || []) {
    if (!RATCHET_COPY[r.file]) missing.push(`ratchet "${r.file}"`);
  }
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
