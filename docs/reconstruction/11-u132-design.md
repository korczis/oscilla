# 11. U132 implementation design: places, rail, phone bottom bar, route aliases

This is the architect's design for U132. It was drafted read-only against `main` at
`67ba3253`. The reconstruction coordinator (oscilla-60) approved it on 2026-11-25, and the
rulings are recorded in plan issue Q116.

## Constraints found in the code

- **No landing and no Generator workspace exist yet.** P012 is not started and K138 is not
  done. U132 therefore has seven places; the landing joins as the first place once P012 lands.
- **No Q090 fold is done** (U069 to U074 are open). **U132 retires no page.**
- **Every page needs a `nav.<id>` anchor.** The deep-link inventory asserts
  `aria-current === nav.<ws>` for every row (`tests/browser/ui-flowbite-pro.cjs:345`), and
  `link-integrity` requires the current entry inside `#osc-nav`. So every non-place page keeps
  one `nav.<id>` anchor inside `#osc-nav`, and no `nav.` id may appear twice.
- **The h1 id must differ per place.** `link-integrity` keys focused headings by id and refuses
  duplicates, so a single fixed id breaks it. This amends design 09's PR-D: the id is
  `:id="'osc-title-' + workspace"`, and `<main :aria-labelledby>` uses the same.
- **ADR 0045 needs a dated note.** It says a navigation click leaves focus on the control, and
  U132 moves focus to the h1.
- **`src/index.html` has little headroom.** The new markup is paid for by deleting the group
  branch of the nav template.

## Places in the registry

`WORKSPACE_REGISTRY` stays the one list. Each row keeps its id and gains data:

- `place: true`
- `bar: true`
- `fold: { issue, into }` on a non-place row

`PLACE_IDS`, `BAR_IDS` and `MORE_IDS` are derived from these fields.

| Row | Role | Label |
|---|---|---|
| playground | place, bar | **Generátor** (Czech label, `lang` dropped; the id stays) |
| studio, synth | place, bar | unchanged |
| measure | place, bar | Měření |
| analyzer | place | **Analýza** |
| experiments, learn | place | unchanged |
| filter (U071), compare (U072), synthesis (U069), sequencer (U074), presets (U070) | non-place, in Více, until their fold lands | unchanged |
| about | non-place, in Více and in the header menu | O aplikaci |

- **Rail order:** Generátor, Studio, Synth, Měření, Analýza, Experimenty, Výuka. This keeps the
  owner's Q019 answer (Synth right after Studio).
- **Reaching a non-place page:** through its own `#m=` id, Více, the title-bar search or the
  palette, and Related.
- **What a fold PR must do** before its page disappears (the no-loss condition, Q090):
  1. Everything the page offers is live and sounding in its new home in three engines.
  2. The page's alias row points there.
  3. The registry row and its Více entry go in the same PR.
- **A guard against a stranded row:** a unit test fails while a non-place row's fold issue is
  DONE and the row still exists.

## Route aliases

One frozen table, `ROUTE_ALIASES` in `ui/navigation.js`, replaces `V1_MODE_IDS`,
`workspaceForV1Mode` and `namesPage`. `routeOfHash` stays the one dispatcher, and its
precedence is unchanged.

| Key | Leads to |
|---|---|
| every registry id | the workspace itself |
| `generator` | the playground, keeping the address as typed |
| V1 mode ids `playground`, `sweep`, `dual`, `presets`, `learn` | today's targets; the codec is frozen (ADR 0014) |
| the `st`, `sv`, `exp`, `def`, `finding` and `mr` keys | handled as today |

The focus column holds a route suffix in the target's own codec. It is empty in U132. A fold
row expands it through `expandAlias()` and then canonicalises the address with
`replaceState`.

**The inventory's `#m=` rows are frozen as a literal list**, so that a fold cannot silently drop
one of them.

## Desktop rail

- **Container.** The sidebar becomes `<nav aria-label="Místa">`, no longer inside a
  complementary landmark. It holds one item per place and a last item, Více, which opens a Pro
  dropdown listing the non-place rows and Hledat.
- **Widths stay as today.** 256 px open and 64 px as icons, so the census at 1024 px and up does
  not move.
- **From 768 to 1023 px** the rail is icons-only with peek, and the drawer is gone at that width.
- **The groups go.** That removes `GROUP_REGISTRY`, the group branch of `navTree`,
  `groupCrumbOf`, and the nav-group state and keys. The stale `oscilla.v2.navGroups` value is
  removed once on load.

## Phone bottom bar (below 768 px)

- **Layout.** The same element becomes a five-column bottom bar in flow: Generátor, Studio,
  Synth, Měření and Více. Targets are at least 64 × 56 px; labels are 12 px.
- **Více** opens a Pro bottom drawer listing Analýza, Experimenty, Výuka, the non-place rows,
  O aplikaci and Hledat. The hamburger and the old drawer go.
- **Order from the top:** title bar, main, keys sheet, instrument strip, bottom bar. The bar
  carries the safe-area inset.
- **Height budget.** The bars take 168 px, which leaves `main` 80 % at 390x844 and 77 % at
  320x740. With the Synth keys sheet open, the primary surface keeps 50 % only if the sheet is
  at most about 254 px at 390x844 and 202 px at 320x740.
- **Sequencing.** The bottom bar lands after U131 PR-E, the absolute chrome-budget thresholds.

## Accessibility

- **Landmark:** a `nav "Místa"`, with `aria-current="page"` on the current place. While the
  current page sits inside Více, the Více button reads "Více (zde: <stránka>)".
- **Focus:** every switch moves focus to the place's h1 (the per-place id above). A page load
  moves no focus.
- **Announcement:** one polite live region says "Místo: <label>". U136 may tune the wording if
  it reads twice together with the focused h1.
- **Keys:** the rail is roving and vertical, the bar roving and horizontal. Escape closes Více.

## Migration: six fail-first PRs

| PR | Content | Census | Visual |
|---|---|---|---|
| 1 routes | `ROUTE_ALIASES`, `expandAlias`, `#m=generator`, inventory `m=` rows frozen | none | none |
| 2 registry data | `place`, `bar` and `fold` fields; derived id lists; rows reordered | none | none |
| 3 rail | groups out, Více, relabels, icon rail at 768 px; one shared test navigation helper | **768x1024: every rendered cell moves x +64 and w −64**; About list links and links whose text is a renamed label change width; no display or rendering change; 1024 px and up unchanged | every desktop reference, the diff confined to the rail column |
| 4 bottom bar | bar and Více sheet; drawer and hamburger out; safe area | **390 and 320: main is 56 px shorter**; viewport-filling views lose h or y by 56 | every phone reference, the diff confined to the bottom 56 px |
| 5 focus | h1 focus on every switch, `places.live`, the ADR 0045 note | none | none |
| 6 records | amended `ui-flowbite-pro#pro-shell` and `#pro-accessible` criteria (dated, ADR 0089), README navigation paragraph, tests/README | — | — |

`deep-links`, `default` and every `link-integrity` check stay exactly as written. The shell
checks are rewritten as the new shell's own proof:

- `ui-flowbite-pro.cjs`: shell-desktop, shell-phone, shell-search, shell-a11y;
- `app.cjs`: nav-groups-keyboard;
- the control-census rows;
- the unit tests: v3-ui, ui-flowbite-pro-shell, page-frame, shell-lang and ui-catalog.
