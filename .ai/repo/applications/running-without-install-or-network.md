---
id: running-without-install-or-network
kind: application
title: 'Running the lab on a machine with no install and no network'
summary: 'Opening OSCILLA as one downloaded file from disk, offline, or from the GitHub Pages sub-path, with Measure and Studio working as they do on the web.'
weight: 60
status: active
fits_when:
  - 'Nothing may be installed and no network is available, as on a lecture-room or lab computer, and a browser can open a local file'
  - 'The same page has to work from file:// and from https://korczis.github.io/oscilla/'
  - 'The browser is a current Chromium, Firefox or Safari (WebKit), the engines the release gate runs the built page in'
  - 'No analytics, account or server is acceptable: the page fetches nothing at runtime'
does_not_fit_when:
  - 'Saved work must persist in a browser that offers no storage from file://: the Studio library then uses memory and says so'
  - 'The browser is one the release gate does not run: only Chromium, Firefox and WebKit are tested'
  - 'An update must arrive by itself: the page has no service worker and fetches nothing, so a downloaded file stays the release it was downloaded as'
use_cases: [open-from-file, open-measure-from-file, studio-open-from-file, open-under-the-oscilla-sub-path]
---

# Context

Someone downloads `dist/index.html` and opens it from disk on a machine with no development
tools and no network, then switches to Measure or Studio. Or the page is served by GitHub Pages
under `/oscilla/`, a sub-path rather than a domain root. Either way it has to work exactly as it
does on the web: one file with every style and script inlined, no runtime fetch, worklets and
the analysis Worker from `data:` URLs, no root-relative path.

The rule it leans on is `project.single-file-deliverable` (`.ai/repo/rules/project/`).
