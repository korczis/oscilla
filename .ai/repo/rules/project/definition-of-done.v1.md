---
id: project.definition-of-done
version: 1
kind: rule
title: A pull request that changes src/ meets the owner's definition of done
description: A pull request that changes a path under src/ carries the definition of done in its body (extends, cross-links, dynamics, docs and routes, tested, deployed, each with a path or a plan id that its head holds), a browser test and a document or a reasoned waiver of each, a tests/README.md row for every test it adds, a route test for a new URL key and an integration-map row for a new link producer; the base branch's copy of the program judges.
statement: A pull request that changes a path under src/ (between its merge base and its head) merges only when its body's own prose has a `Definition of done` section listing the six items extends, cross-links, dynamics, docs and routes, tested and deployed, each naming a repository path that its head holds or a plan id whose issue or milestone record its head holds; it adds or changes a tests/browser/*.cjs suite or its body says `dod-browser: n/a <reason>`; it changes a file under docs/, README.md or .ai/repo/features/ or its body says `dod-docs: n/a <reason>`; every tests/unit/*.test.mjs and tests/browser/*.cjs it adds has a row in tests/README.md; a src/js/core/url-state*.js that gains a key comes with a changed tests/unit/url-state*.test.mjs or tests/browser/navigation.cjs; and every new link producer (a data-osc-link attribute or dataset.oscLink assignment, an openIn or sendTo call of src/js) has its row in the integration map of K075 once the base branch holds that map. A waiver carries a real reason; a merge train (a head branch train/...) is judged by its member table; whether the change is deployed is held after the merge by project.deploy-often, not by the pull request; the program that judges is the base branch's copy.
status: active
class: blocking
depends_on: []
tags: [ci, process, review, docs, testing]
x-majordomus:
  tests: [tests/unit/definition-of-done.test.mjs]
---

# Rationale

The owner's definition of done of 2026-10-29 (relayed by the coordinator; plan E030 under
M083, intent `definition-of-done`): every update extends something, cross-links, adds charts,
dynamics or interactivity, updates markdown, docs, menus, pages and routes as needed, is fully
tested and functional, and is deployed. Until this rule it was a sentence that no pull request
was checked against, so a change to the product could land with no browser check, no
document and no word of what it extends or links to.

Most of it is judgement: whether a change really extends something, or whether its
interactivity is enough, is the reviewer's. What a pull request can show is checked here: that
the author answered the six items with something a reviewer can open (a path or a plan id),
and the parts that leave a trace in the diff (a browser test, a document, a test row, a
route test and a link row).

# Required behaviour

A pull request that changes no path under `src/` is not judged by this rule. One that does:

- carries, in its body's own prose (not in a code block, an HTML comment or a blockquote), a
  heading `Definition of done` whose section lists the six items `extends`, `cross-links`,
  `dynamics`, `docs and routes`, `tested` and `deployed`, as list items (`- tested: ...`) or
  table rows (`| tested | ... |`), each naming a repository path (`src/js/ui/app.js`,
  `docs/`, `README.md`) or a plan id (`E030`, `M083`) that the head holds: the path is a file
  or directory of the head commit (`git cat-file -e <head>:<path>`; for `dir/`, `git ls-tree`
  lists something), and the plan id has `.ai/repo/project/issues/<id>.yaml` or
  `.ai/repo/project/milestones/<id>.yaml` there. A word that only looks like one
  (`Node.js`, `A440`, a `nothing.md` the head does not hold) names nothing, and so does a
  placeholder in angle brackets, a glob and a path through `.` or `..`. Run without `--head`
  (locally, or in the tests), the program reads the working tree instead. The template is
  `.github/pull_request_template.md`.
- adds or changes a browser suite directly under `tests/browser/` (a helper under `lib/` is
  not one), or carries the line `dod-browser: n/a <reason>`;
- changes a file under `docs/`, `README.md` or `.ai/repo/features/`, or carries the line
  `dod-docs: n/a <reason>`;
- has a row in `tests/README.md` (as `project.rules-name-their-enforcement` reads it) for
  every unit test or browser suite it adds;
- when a `src/js/core/url-state*.js` module gains a key, changes a url-state unit test or
  `tests/browser/navigation.cjs`. A key is a static string (quoted, or a template literal with
  no substitution) that is the first argument of `set`, `get`, `getAll`, `has`, `delete` or
  `append`, written as itself or as a constant bound to it; the value of a constant whose name
  ends in `KEY` (`RECIPE_HASH_KEY = 'mr'` of `url-state-measure.js`); a property name or
  string value of a `KEYS` or `*KEYS` object; or a name given to `new URLSearchParams` as an
  object or a list of pairs. A renamed key is a new one;
- gives every new link producer its row in the integration map (`integration-map.json` under
  `tests/browser/`, K075): a `data-osc-link` attribute under `src/`, or an `openIn` or `sendTo`
  call under `src/js/`, or a `dataset.oscLink` assignment. A producer is new when the head has
  more of it than the merge base, counted without comments (`//` and `/* */` in a script,
  `<!-- -->` in HTML), so a commented call is none. A literal target must equal a string of
  the map (`studio` is not `studio-graph`); a computed one needs the map changed by the pull
  request. Computed are a call whose target is not a literal, a `dataset.oscLink`
  assignment, and an attribute that is bare (`setAttribute('data-osc-link', t)` reads so),
  empty, or holds `${` or `{{`. Until the base branch holds the map, the clause prints
  `integration map not on the base` with the producers it did not judge, and passes.

A waiver line is read as `project.fail-first` reads its own: a line of the body's own prose,
with a reason that is not empty, not only punctuation and not the placeholder. Whether the
reason holds is the reviewer's.

`deployed` is answered in the section and not judged by the pull request: a pull request
cannot deploy itself. The release cadence holds it after the merge (`project.deploy-often`,
`scripts/release-cadence.mjs`).

A merge train (a head branch `train/...`, `TRAIN_BRANCH` of `scripts/fail-first.mjs`, with a
title that is not `feat` or `fix`) lands members that were each judged as their own pull
request; it passes when its body's `| member | what |` table lists at least one member, each
as `#<n>`. Only the branch makes a train here: `project.fail-first` also reads a title that
starts with `train` or `merge train`, but for this rule a `Trains: ...` chore, refactor or docs
pull request on another branch that changes `src/` is judged as any other, or a title alone
would escape every clause.

# Enforcement

`scripts/definition-of-done.mjs` diffs the head against its merge base and reads the body from
the pull request JSON (`--pr-json`, the `gh pr view` output with `title`, `body` and
`headRefName`). It shares `scripts/fail-first.mjs`'s reading of a body (its prose, its train
branch pattern and member table) rather than carrying a second parser. Every clause that fails
prints a line that starts `project.definition-of-done: <clause>:`, and the program exits 1.

The `definition-of-done` job of `.github/workflows/ci.yml` runs it on every pull request,
through `.github/scripts/base-rule.sh`, so the base branch's copy judges and a pull request
cannot weaken its own judge; it reads the pull request as it is when the job runs, retried as
`project.ci-bounded` asks, and `gate` needs the job. `tests/unit/ci-workflows.test.mjs` holds
the caller as it holds those of `project.fail-first` and `project.review-verdict`: the last
command of the job's last step is exactly the wrapper call, unconditional, and the step fails
without a pull request; `tests/unit/ci-gates-model.test.mjs` holds its gate in
`.ai/repo/ci/gates.yaml`.

`tests/unit/definition-of-done.test.mjs` runs the program on fixture pull requests (bodies in
`tests/unit/fixtures/definition-of-done/`): a `src/` change without the section, with an item
missing or naming no path or plan id, with the template unfilled, without a browser test or
its waiver, without a document or its waiver, with an added test missing its row, with a new
URL key and no route test (in each shape above, a renamed `RECIPE_HASH_KEY` among them), and
with a new link producer and no map row (the map on the base) is each refused with its
`project.definition-of-done:` line; so is an item that names only `works like Node.js`,
`the A440 tone`, `nothing.md` or a path or id the head does not hold (and a file only the
working tree holds once `--head` is given), a computed `data-osc-link` (a template, a
`setAttribute` with a variable, an empty target, `dataset.oscLink`) until the map changes, a
literal target that is only a substring of a map string, and a train title on a branch that
is not `train/...`. A change outside `src/`, a waiver with a real reason, the items as a
table, real paths and plan ids, a commented call or key, the map not yet on the base and a
train judged by its members pass; a waiver without a reason, with the placeholder or outside
the prose fails.
It also runs the wrapper: the pull request that introduces the program is judged by its own
copy with a warning, and one that replaces the program with one that always accepts is
refused by the base's.

What it cannot see:

- Whether the six answers are true: that the path named under `extends` is extended, or the
  plan id under `cross-links` is the link. That is the reviewer's.
- A browser test that does not exercise the change, or a document that does not describe it.
  The diff shows that one exists, not what it proves.
- A URL key or a link producer written in a shape the scan does not read: a key computed at
  run time (a template with a substitution, a concatenation, a function's result), one reached
  through a constant of another module or an object that is not named `KEYS` (a `K.lab`-style
  property of a key constant object), a key set in a loop over a list of pairs
  (`for (const [k, v] of [['a', 1]]) q.set(k, v)`), a key or target given as the argument of
  a nested call (`q.set(name('a'), 1)`, `openIn(route(x))`: the call scan reads only a call
  without inner parentheses, so the producer is not seen at all), `dataset['oscLink']`, and a
  producer under another name. K075's own scan of hash-route writes covers producers once it
  lands.
- A comment the heuristic misreads: the scan strips `//` and `/* */` outside quotes, line by
  line for `'` and `"`, and does not parse regular expressions, so a quote inside a regular
  expression literal can hide a comment that follows on its line (it then counts), and a
  `<script>` block inside HTML keeps its script comments.
- A section or a waiver in an indented code block (four spaces): the body is read through
  `proseOf` of `scripts/fail-first.mjs`, which removes fenced code blocks, HTML comments and
  blockquotes but not indented code, so an indented `dod-browser: n/a <reason>` counts as
  prose. That reading belongs to `project.fail-first`'s program and is shared on purpose.
- That an item's path or plan id is the right one: the head must hold it, not prove it.
- That a train's members exist, landed, and cover its own `src/` commits: a `train/` branch
  whose table lists any `#<n>` is judged by its members, and the program does not read them.
  The merge-train skill (members only, one rebuild) and the train's non-builder review verdict
  hold that; a train that carries a commit of its own under `src/` is a defect of the train.
- A deleted document: it is not a document change, so the docs clause needs another changed
  document or the waiver.
- The deployment, as above.
- The pull request that introduces the program: the base has no copy, so
  `.github/scripts/base-rule.sh` prints a warning and runs the pull request's own. That pull
  request changes nothing under `src/`, so its own copy has nothing to judge.
- A pull request that rewrites the job or the wrapper, for the reason `project.review-verdict`
  gives: GitHub runs the workflow the pull request carries. Such a change is under `.github/`,
  which needs a review verdict.

The program, its test and its fixtures are guarded paths of `project.review-verdict`
(`GUARDED` in `scripts/review-verdict.mjs`): the base branch's copy judges each pull request,
so a later pull request that weakens only the program would otherwise land a weaker judge
for every pull request after it with no review.

# Failure behaviour

The `definition-of-done` job fails and prints each failing clause; `gate` fails and the pull
request does not merge. The fix is the missing part (the section, the test, the document, the
row) or, where the part does not apply, the waiver line with its reason; after editing the
body, re-run the job.
