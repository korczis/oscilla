---
id: fleet.ui-uses-flowbite-pro
version: 1
kind: rule
title: Every user interface is built on Flowbite Pro
description: Every UI this repository builds or generates uses the owner's licensed Flowbite Pro shell, blocks and components on Tailwind.
statement: Build every user interface in this repository (application screens where the stack allows, admin and web pages, generated pages, documentation sites) on the owner's licensed Flowbite Pro, starting from the matching Pro template or block, and review every UI change for Pro fidelity.
status: active
class: blocking
depends_on: []
tags: [ui, flowbite, design-system]
---

# Rationale

The owner holds a Flowbite Pro licence and requires it for every project. One design system
across products keeps them consistent and saves reinventing components the licence already pays
for. This rule reaches every repository the owner's fleet pack applies to, so it is written once
and never copied by hand.

# Required behaviour

- New or changed web UI starts from the matching Pro template or block (shell, page header,
  cards, tables, tabs, drawers, empty states, forms) and adapts its markup and class lists. The
  skill `fleet-flowbite-pro` is the procedure; the licensed sources stay on the owner's machine.
- Pro source files are never published verbatim: no licensed file, bundle or copied block
  reaches a public tree or a published artifact.
- Native mobile UI follows the same visual language (shell structure, spacing, colour roles,
  components) where the platform allows; it does not ship Flowbite's web code.
- An exemption is declared in the policy with the reason for it, and reported, never silent.

# Failure behaviour

A UI change that does not follow Flowbite Pro is a review finding of class `code-smell`
(category architecture) and is reworked before it lands. A licensed file in a public tree is
refused outright.

# Verification

A reviewer compares the change with the Pro template it starts from. `majordomus design licence`
judges never-publish from the licence evidence; the kit judge checks kit use once it ships.
