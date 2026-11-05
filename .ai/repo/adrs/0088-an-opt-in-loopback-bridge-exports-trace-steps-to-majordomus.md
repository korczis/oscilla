---
schema: adr/v1
id: adr-0088
kind: adr
title: "An opt-in loopback bridge exports trace steps to a local Majordomus; the default build stays offline"
status: proposed
date: 2026-11-05
tags:
  - deliverable
  - offline
  - privacy
  - majordomus
related:
  - file:.ai/repo/adrs/0012-self-contained-runtime.md
  - file:.ai/repo/adrs/0042-studio-operation-trace-one-correlation-id-bounded-not-evidence.md
  - file:.ai/repo/project/issues/Q100.yaml
  - file:.ai/repo/project/issues/R046.yaml
  - rule:project.single-file-deliverable
  - rule:project.no-fake-science
  - file:scripts/verify-dist.mjs
  - file:src/js/core/trace.js
provenance:
  origin: authored
---

# 88. An opt-in loopback bridge exports trace steps to a local Majordomus; the default build stays offline

## Context

ADR 0012 makes the runtime self-contained. Nothing is fetched, imported or loaded from a path,
and `scripts/verify-dist.mjs` refuses WebSocket, EventSource and localhost in the shipped file
(`:65`, `:67`).

On 2026-11-05 the owner asked why the generic bus does not connect "uber synth" to the monitors.
In the af session the same day, the owner answered two questions (Q100):

- **"UberSynth" means OSCILLA's Synth.** Its events are to reach Majordomus monitors.
- **"Ano, opt-in localhost".** OSCILLA may get an opt-in local transport.

The Majordomus discovery (seat 1d, read-only, 2026-11-05) verified three facts:

- OSCILLA publishes nothing today.
- The page's canonical event model is `src/js/core/trace.js` (ADR 0042, a bounded ring of steps).
- Output-owner changes, synth note on and off, measurement and both Arms emit outside it.

On the Majordomus side, I2944 makes the monitor's sources one declaration. Seat 44 proposed the
external-source descriptor this ADR names.

## Decision

1. **Off by default, on only by the user.**
   - The default build and every page load make zero network calls. ADR 0012 holds for them unchanged.
   - The bridge runs only after the user switches it on in the page and pastes a bridge address
     and token. Majordomus prints both when the user opts in on that side.
   - No automatic discovery: the page cannot read the lease file and must not probe ports.
2. **Loopback only.**
   - The only accepted host is `127.0.0.1`.
   - The page's Content-Security-Policy gains `connect-src http://127.0.0.1:*` and nothing else.
   - `verify-dist` allows the network API only inside the bridge module, which loads and runs only
     after the switch.
   - Any other host, or a network call outside that module, fails the build.
3. **One schema, one stream.**
   - The bridge POSTs batches of trace steps as `oscilla-trace-step/v1`. Each step carries trace.js's
     frozen fields unchanged.
   - The emitters outside trace.js become kinds of that one schema through OSCILLA's bus
     (C050-C059), never as separate streams.
   - An empty batch is the heartbeat. There is no WebSocket in v1.
4. **Identity, order and gaps.**
   - The source id is `oscilla`. The producer token is held in memory for the page session only:
     never in localStorage, never in the URL.
   - Each page load is a new epoch. The cursor is `<epoch>.<seq>`.
   - A seq jump, or a ring overwritten before export, is sent as a gap and never filled.
   - Revocation or a refused token shows in OSCILLA's status as the bridge being off, with the
     reason.
5. **Honest health.**
   - OSCILLA shows LIVE, STALE or OFF for the bridge from what it observed (last acknowledged batch
     and heartbeat age).
   - A browser that refuses https-to-loopback (Safari) shows the bridge as unavailable, with the
     reason.
   - Trace steps stay what ADR 0042 says they are: a bounded operational record, not measurement
     evidence (project.no-fake-science).

## Alternatives rejected

- **A remote endpoint or any non-loopback host:** it breaks the privacy promise in About, and Q100
  allows localhost only.
- **WebSocket or EventSource in v1:** a second transport and preflight to secure, for no consumer
  that needs push from the page.
- **Auto-discovery by port scanning:** it is unbounded network activity in a page that promises none.
- **Separate streams per emitter:** the owner's order is one bus and one event model.

## Consequences

- R046 implements this: the switch, the bridge module, the CSP line, verify-dist's scoped allowance,
  and tests. It depends on the bus slices that emit trace steps, and on Majordomus's external
  source (on top of I2944) with an ingress that answers the Private Network Access preflight for
  exactly `https://korczis.github.io` and `null`.
- The About page's privacy line gains one clause about the opt-in bridge only when R046 ships, and
  the claim's test covers it.

## What no check decides

Whether a person understands that switching the bridge on sends their session's trace steps to a
process on their own machine. The switch's text says so, and the reviewer of R046 judges it.
