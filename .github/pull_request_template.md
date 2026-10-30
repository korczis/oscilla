Plan: <issue id> (<milestone id>, serves `<intent>#<criterion>`)

<!--
The title is a conventional commit: `type(scope): description`.

project.fail-first: a feat or fix pull request adds or changes a unit test that fails on the
merge base. When none can, put one line in the body's own prose (not in this comment):
  fail-first: n/a <reason>

project.review-verdict: a change to a guarded path (GUARDED in scripts/review-verdict.mjs)
needs .ai/repo/reviews/<pr>.yaml, written by a reviewer who did not build the change.

project.definition-of-done: a change under src/ fills the section below, every item with a
repository path or a plan id that the head holds (a placeholder in angle brackets, a glob or
a word that only looks like a file or an id counts as nothing). It also
adds or changes a tests/browser/*.cjs, and changes docs/, README.md or .ai/repo/features/;
where one of those does not apply, one line each in the body's own prose:
  dod-browser: n/a <reason>
  dod-docs: n/a <reason>
A test file the change adds has its row in tests/README.md, a new URL key of
src/js/core/url-state*.js comes with a changed url-state unit test or
tests/browser/navigation.cjs, and a new link producer has its integration-map row.
The CI job reads this body when it runs: after editing it, re-run the job.
-->

## Change

-

## Definition of done

- extends: <what this extends: path or plan id>
- cross-links: <the links it adds or follows: path or plan id>
- dynamics: <the chart, dynamics or interactivity it adds: path or plan id>
- docs and routes: <the docs, menus, pages and routes it updates: path or plan id>
- tested: <the unit and browser tests that prove it: path>
- deployed: <the release that ships it: plan id, or scripts/release-cadence.mjs>
