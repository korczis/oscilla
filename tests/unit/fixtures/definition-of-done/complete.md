Plan: E999 (M999, serves `fixture#done`)

## Change

- the lab gains a link to Studio.

## Definition of done

- extends: `src/js/ui/app.js` gains the Studio link (E999)
- cross-links: the lab and Studio link each other, `docs/GUIDE.md`
- dynamics: the link opens Studio live; `tests/browser/app.cjs`
- docs and routes: `docs/GUIDE.md`
- tested: `tests/browser/app.cjs`
- deployed: with the next release (`scripts/release-cadence.mjs`)

<!--
dod-browser: n/a <reason>
-->
