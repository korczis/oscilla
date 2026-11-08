---
schema: skill/v1
id: fleet-flowbite-pro
version: 1
title: Build UI on Flowbite Pro
description: Build or change any user interface on the owner's licensed Flowbite Pro shell, blocks and components, and verify it before claiming compliance.
status: active
tags: [ui, flowbite, design-system]
inputs:
  - the UI change to make, and the repository's UI stack
  - the owner-level Flowbite Pro reference on the owner's machine (licensed; never copied into a repository)
outputs:
  - UI built from the matching Pro template or block
  - the verifier's findings for the repository, each fixed or exempted with a reason
---
# Purpose

Every user interface in the owner's repositories is built on the owner's licensed Flowbite Pro
on Tailwind (rule `fleet.ui-uses-flowbite-pro`). This skill is how: pick the Pro template or
block first, adapt it, and prove the result. It is not a style guide of its own and it carries
no Pro source: the licensed reference stays on the owner's machine and is read there.

# When to use

Before writing the first line of UI markup or CSS in any repository: application screens, admin
panels, dashboards, generated pages, documentation sites, single-file pages.

# Procedure

1. Read the owner-level reference, `.claude/skills/flowbite-pro/reference.md` under the owner's
   home directory. It condenses the licensed shell and components and names where the sources
   are. Without it (a machine that is not the owner's), stop and report that the reference is
   absent; never reconstruct Pro markup from memory or from a public tree.
2. Pick the matching Pro template or block (shell, page header, stat cards, tables, tabs,
   drawers, empty states, forms, auth pages) before designing anything, then adapt its markup
   and class lists. Do not invent a component the Pro set already has.
3. Shell: the Pro navbar and sidebar drawer, a page header with breadcrumb and actions, cards on
   the Pro surfaces, one primary accent. Theme: extend the primary colour and fonts as the Pro
   Tailwind configuration does; dark mode follows the repository's theme mechanism.
4. Interactive components (drawer, dropdown, modal, tabs, tooltip) use Flowbite's script, or the
   framework binding the Pro template uses; never a hand-written re-implementation.
5. Licence: adapt markup into the owner's products only. No licensed file, bundle or copied
   block goes into a public tree or a published artifact; `majordomus design licence` judges it.
6. Verify: from the owner's home directory run
   `node .claude/skills/flowbite-pro/verify.mjs <repository> --json` and fix each finding, or
   declare an exemption with its reason in the repository's policy. Run it after any UI work and
   before claiming the repository complies.

# Output

The changed UI, built from a named Pro template or block; the verifier's result for the
repository (clean, or each finding with its fix or its declared exemption); and, when the
reference was absent, a report saying so instead of a UI.
