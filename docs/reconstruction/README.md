# OSCILLA product reconstruction

**Goal.** Reconstruct the application as one coherent instrument rather than thirteen
workspaces sharing a navigation bar.

**Origin.** The owner ordered it on 2026-11-24 with the prompt pack "OSCILLA — Complete product
experience reconstruction".

**Base.** `main` at `c3b15610` (v3.42.1).

**Plan.** Intent `one-instrument`, milestone M124, issues U123 to U137, owner decision Q114 and
ADR 0089.

These are developer documents, so they are written in English (rule `project.czech-prose`).
The owner-facing summary is a Czech page published separately.

| Document | Deliverables |
|---|---|
| [01 Architecture inventory](01-architecture-inventory.md) | architecture inventory, current IA, duplication report, state ownership map |
| [02 Feature matrix](02-feature-matrix.md) | feature-to-UI traceability |
| [03 UX/HCI audit](03-ux-audit.md) | per-workspace audit, screenshots, user journeys |
| [04 Interaction audit](04-interaction-audit.md) | interaction audit, the interaction specification per control family |
| [05 Accessibility audit](05-accessibility-audit.md) | axe and keyboard audit, the accessibility model |
| [07 Target architecture](07-target-architecture.md) | competing architectures, target architecture, visual system, desktop and phone composition, migration strategy |
| [08 Owner decision Q114](08-owner-decision-q114.md) | the owner's answers, verbatim |
| [evidence/](evidence/) | layout metrics for 3 engines × 6 viewports × 13 workspaces |

## Method

**What was measured.**
- **Screenshots and layout metrics:** 252 screenshots (Chromium, Firefox and WebKit; six
  viewports from 1536x1024 to 320x740; thirteen workspaces plus a fresh first screen), each
  with layout metrics. Main scroll height, interactive and small targets, text under 12 px and
  horizontal overflow are kept in `evidence/metrics-*.json`.
- **Accessibility:** axe-core 4.14 on every workspace, plus a keyboard pass in three engines.
- **User journeys:** the ten journeys of the pack, walked in the browser.
- **Source:** four read-only passes for architecture, features, plan and interactions.

**How the architecture was checked.** An independent critic tried to falsify the draft against
the code and the binding records. Its amendments are folded into 07.

## Slice status

Measure with `majordomus plan status`; this table is not the record.

| Slice | Issue | Needs |
|---|---|---|
| Escape closing a menu keeps audio | U123 | — |
| Escape in an Inspector field keeps the transport | U124 | — |
| Synth tablist ARIA | U125 | — |
| Sonda, the observed probe | U126 | — |
| One play-target table | U127 | U123 |
| DOM geometry census | U128 | — |
| Registry owns membership | U129 | U128, F002 stamped |
| Command palette | U130 | U125 |
| Title bar + instrument strip | U131 | U127 |
| Places, rail, bottom bar, aliases | U132 | U129, U131 |
| Sound survives a place change | U133 | — |
| Letter keys in instrument places | U134 | — |
| Phone keys as a sheet | U135 | U131 |
| Accessibility model | U136 | U132 |
| Retire superseded paths | U137 | U132, U069-U074 |
