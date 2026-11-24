# 05. Accessibility and keyboard audit (measured in browsers)

Deliverable 4 (accessibility half), measured on `main` at `c3b15610` (v3.42.1), 2026-11-24.

## Method

- **Tools:** Playwright 1.63 and axe-core 4.14, with the tags `wcag2a`, `wcag2aa`, `wcag21aa`
  and `best-practice`.
- **Loading:** every workspace was opened fresh via `#m=<ws>`, with the safety notice collapsed.
- **What ran where:**
  - Chromium at 1536x1024 and at 390x844 (hasTouch, isMobile): axe, the accessibility
    structure, a 60-stop Tab pass, key tests, and the workspace switch.
  - Firefox and WebKit at 1536x1024: the Tab, Space, Escape, arrow and typing passes.
  - Forced colours and light-theme contrast were also checked in Chromium.
- **Tab to the primary control:** this counts the Tab presses needed to reach the workspace's
  main control, which is one of:
  - the frequency slider;
  - the measure start button;
  - new definition;
  - the Průběh tab;
  - cutoff;
  - the mic toggle;
  - the envelope enable switch;
  - sequence play;
  - the first preset load;
  - the first Learn demo;
  - the Studio graph viewport;
  - the first Synth knob;
  - About's first link.

## Results per workspace

In the Tab column the order is Chromium / Firefox / WebKit / phone.

| Workspace | axe crit/serious (desktop; phone) | Tabs to primary | Space with focus on body | Notes |
|---|---|---|---|---|
| playground | 0/0; 0/0 | 30/30/30/11 | Hold to Play | Only workspace whose h1 is visible (12.5 px, paragraph style); 12 of 77 names English |
| measure | 0/1; 0/0 | 28/28/28/10 | nothing | contrast of the "NEZMĚŘENO" note |
| experiments | 0/0; 0/0 | 27/27/27/10 | nothing | 6 of 10 names English |
| analyzer | 0/0; 0/0 | 26/26/26/9 | Hold to Play | — |
| filter | 0/0; 0/0 | 31/31/31/14 | Hold to Play | duplicate name "Q"; "Filter enabled" in English |
| compare | 0/0; 0/0 | 26/26/26/9 | Hold to Play | duplicate PubMed link |
| synthesis | 0/0; 0/0 | 45/45/45/23 | Hold to Play | Dual A/B controls share names; 17 of 80 English |
| sequencer | 0/0; 0/0 | 39/39/39/17 | **plays the instrument tone, not the sequence** | 12 of 52 English |
| presets | 0/0; 0/0 | 31/31/31/14 | Hold to Play | — |
| learn | 0/0; 0/0 | 27/27/27/10 | nothing | "Ukázat na aktuálním nastavení" ×20 |
| studio | 0/0; 0/0 | **85/86/85/28** | toggles the transport | 81 of 124 names English; heading-order |
| synth | **7/8; 6/4** | 50/50/50/44 | nothing (ADR 0050) | broken tablist, XY ARIA, dock contrast, 4 announcements on entry |
| about | 0/0; 0/0 | 26/26/26/9 | nothing | — |

### What holds in every workspace

- **Structure:** exactly one `<main>` and one h1, and no unnamed control.
- **Focus:** no focus trap in any engine, and visible focus on every desktop stop.
- **Dialogs:** they focus correctly and Escape restores focus.
- **Overflow menu and phone drawer:** they follow the menu pattern.
- **Keyboard on values:** arrow keys move sliders, knobs and the timeline loop handle, and
  `aria-valuetext` updates as they do.
- **Tabs:** the roving tabs of Analysis, Measure, Presets and Mic work.
- **Typing:** text fields are guarded, so typing in them plays no note (13 of 13 workspaces,
  3 engines).

## The fifteen problems, ranked by user impact

1. **A workspace switch is not announced, and focus handling differs by viewport.**
   - On desktop, focus stays on the nav link and nothing names the new workspace.
   - On a phone, focus moves to the workspace h2.
2. **No h1 names the workspace.** The h1 is always the tagline, and it is hidden everywhere
   except on the Playground. The Playground has no heading named "Playground".
3. **25 to 28 Tab stops come before any content** (8 header controls, 15 sidebar items, 3–4
   links). The Studio graph is at Tab 85.
4. **The Synth tab widget is broken.** Tabs sit inside `<li>` under `role=tablist` (axe
   `aria-required-parent` ×4, `aria-required-children`, `listitem` ×4). There is no roving
   tabindex and arrows do nothing.
5. **Letter keys play notes in every workspace**, Measure, Experiments, Learn and About
   included. These are single-letter shortcuts with no modifier (WCAG 2.1.4), and they can be
   turned off only per workspace. The owner chose "armed everywhere" (Q105), so this is an
   owner decision to revisit (Q114, `06-plan.md`), not a bug to fix silently.
6. **Forced colours are not supported.** `src/` has no `forced-colors` rule. These states are
   lost:
   - selected segment and tab;
   - the current nav item;
   - slider tracks.

   Canvases and SVGs keep their dark author fills.
7. **Accessible names are English on a `lang="cs"` page, with no `lang="en"` marking.**
   - Studio: 81/124.
   - Synthesis: 17/80.
   - Playground: 12/77.
   - Sequencer: 12/52.
   - Experiments: 6/10.
8. **Contrast fails in two places.**
   - The selected Synth dock buttons: white on `#3b82f6` is 3.67:1.
   - The Measure "NEZMĚŘENO" note: 4.42:1 dark, 4.05:1 light.
9. **The docked keys are not a landmark, and they are a canvas with `role=img`.** They can be
   played only with letter keys. When collapsed, their handle sits in the Tab order before the
   workspace content.
10. **The XY pads put `role=application` and `aria-pressed` together** (axe criticals ×2).
11. **Accessible names repeat within one region:**
    - Learn ×20;
    - the Dual A/B controls;
    - Filter "Q" ×2;
    - the bio PubMed link ×2.
12. **Space has three meanings and nothing on screen says which one applies.** In the
    Sequencer, Space plays the tone, not the sequence.
13. **Landmark gaps.**
    - The page summary sits outside every landmark.
    - The breadcrumb and Related navigations are top level.
    - The main navigation is nested in a complementary region.
    - `<main>` has no name.
14. **Four announcements fire on entering the Synth.**
15. **The heading hierarchy is inconsistent** (Studio library, Playground compact Studio,
    Synth dock heading first).

## Requirements on the redesigned shell (the accessibility model)

1. **Headings.** One h1 per place that names it. Below it, h2 for panels and h3 for
   sub-panels. A test checks the h1 text against the registry label.
2. **Switching places.** Focus moves to the place h1 on every viewport. One polite live region
   announces "<place> otevřeno", and nothing else announces during the switch.
3. **Landmarks.**
   - banner (brand, search, actions);
   - navigation "Místa", not inside a complementary region;
   - main, named by the h1;
   - a named region for the instrument context, outside main;
   - contentinfo.

   No content sits outside a landmark.
4. **Skip links** to main, to the place's primary control and to the instrument context. The
   primary control is declared in the registry, and a test caps the Tab count to reach it.
5. **One tabs component** (roving tabindex, arrows, Home/End, correct DOM) for every tablist.
6. **One slider/knob primitive** with valuetext and the key contract of `04-interaction-audit.md`.
   Its focus ring is on the focused element and survives forced colours.
7. **One Space/Escape table** (`SPACE_OWNER`), shown on screen and in the help dialog and
   tested in three engines. In the Sequencer, Space plays the sequence.
8. **Letter-key note input** follows the owner's answer to Q114. The armed state is always
   visible, and a global off switch exists (WCAG 2.1.4).
9. **Forced colours.** Selection is shown by more than colour. Tracks, canvases and SVGs map to
   system colours. The gate takes forced-colour screenshots.
10. **Czech names.** Visible text and accessible names are Czech, or carry `lang="en"`. A ratchet
    counts the English names per place.
11. **Unique names within a region.**
12. **Contrast of at least 4.5:1 for every state token in both themes.** Canvas text is held to
    the same tokens.
13. **The on-screen keyboard can be focused and played** from the keyboard. XY pads use a valid
    role.
14. **Live regions.** One polite and one assertive region per scope, and no announcements on
    load.
15. **Gate.** axe runs on every place at 1536 and 390 in both themes, plus a Tab, Space, Escape
    and arrow pass in Chromium, Firefox and WebKit.
