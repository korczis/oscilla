---
id: project.rules-name-their-enforcement
version: 1
kind: rule
title: A rule, a bootstrap or a script header names only enforcement that exists
description: Every active project rule names a test or script file that exists and that CI executes, or is advisory and says why; every project rule named anywhere is in force; every script header that says a workflow or an npm script runs the file is true.
statement: Every active rule under .ai/repo/rules/project/ either carries an x-majordomus block (naming tests when the rule is blocking), or has an "# Enforcement" (in rules older than this one, "# Verification") section whose backticked paths exist, whose test and script files are run by a workflow step, an npm script or a test CI runs that imports them, and at least one of which is a test or script file the CI workflow executes, or is class advisory with a "# Why advisory" reason. The rules index in .ai/repo/rules/project/README.md lists exactly the rules in force, each with its version and class. Every project.<id> named in CLAUDE.md, AGENTS.md, GEMINI.md, README.md, tests/README.md, docs/, the .ai layer's rules, workflows, policy and provider templates, or a GitHub workflow is a rule in force. Every header of a JavaScript file directly under tests/browser/ or scripts/ that says CI, the Pages workflow, the release gate or a named npm script runs the file is true of that workflow or script.
status: active
class: blocking
depends_on: []
tags: [knowledge, process, ci]
---

# Rationale

Three times this repository said something was enforced while nothing enforced it, and each
time the sentence was believed for as long as nobody checked:

- `project.no-fake-science` version 1 said a grep enforced it. No test, script or workflow
  ran one (completion ledger, finding K2). Version 2 names tests.
- The generated bootstraps said the pre-commit hook refused a misplaced commit, and named
  `project.worktree-topology` and `docs/WORKTREES.md`. The hook ran no guard and neither file
  existed (finding K1).
- The header of `tests/browser/live-smoke.cjs` said the Pages workflow ran it. Nothing ran it
  until #146 added the step.

A rule that names a mechanism is trusted by the next worker in place of a review. The name
has to resolve to something that runs.

# Required behaviour

- A project rule is written with its enforcement in the same change: the `# Enforcement`
  section names the test, script or policy entry in backticks, and that file exists.
- A test or script file named there is run: by a step of `.github/workflows/ci.yml` or
  `.github/workflows/pages.yml` (through an npm script the step calls, or directly, as in
  `node scripts/<name>.mjs`), by an npm script, or as a module that a test CI runs imports.
- At least one named file is a test or script the CI workflow executes, so a pull request
  cannot land a violation. `npm test` or `npm run <name>` beside it says how the file is
  reached; alone it is every rule's mechanism and none of this one's. A helper module that
  a test imports is run, and is not the mechanism either: the rule names the test.
- A blocking rule's `x-majordomus` block names tests. `reviewed_because` without tests is a
  reviewer's word, and a rule that rests on it is advisory.
- The index in the `README.md` of this directory lists every rule in force with its
  version and class, and nothing else.
- A rule no mechanism can decide is `class: advisory` and says why under `# Why advisory`.
  It does not borrow the word "enforced". A blocking rule has no `# Why advisory` section.
- A rule id has the form `project.<words-joined-by-hyphens>`, so that a reference to it in
  prose is recognisable. A document names a rule only while the rule is in force; a rule that
  is planned is described in words, without its id, until the rule document lands.
- A script header says "CI runs it", "pages.yml runs it", "the gate runs it" or
  "Runs in `npm run <name>`" only while that is so. The step and the sentence change in one
  commit.

# Enforcement

`tests/unit/knowledge-integrity.test.mjs`, run by `npm test` in the CI `unit` job:

- "every active rule names enforcement that exists and runs, or says why it is advisory"
  reads every rule file here. A rule with an `x-majordomus` block is held to the older check
  beside it (its tests exist and CI runs them). What CI runs is read from the workflow with
  its comments removed, whole-line and trailing: the npm scripts its steps call, expanded,
  and the files its steps execute directly. A path a workflow only names (an artifact, a
  file handed to `jq -f`) is not run.
- "the rules index lists every project rule in force with its version and class" compares
  the index rows with the front matter of the rule files, in both directions.
- "every project rule a bootstrap, document, workflow or template names is in force"
  resolves each `project.<id>` in the bootstraps, the READMEs, every Markdown file under
  `docs/`, this directory, `.ai/repo/workflows/`, `.ai/repo/policy.yaml`,
  `.ai/repo/providers/` and `.github/workflows/`.
- "a script header that says CI, Pages or an npm script runs the file is right" reads every
  comment line before a file's first line of code ("runs it", "executes it", "run by",
  "executed by", "runs in") and checks each claim against the workflow, read the same way,
  and against `package.json`.
- Each has a mutation test beside it: a rule naming a test file that does not exist, an npm
  script alone, a script only a comment or an upload path names, a helper with no test, and
  a blocking rule resting on `reviewed_because`; an index with a row removed, a stale class
  or an extra row; a bootstrap naming a rule that does not exist; and the Pages workflow
  without its smoke step, or with the step left in a trailing comment.

# Failure behaviour

A failing test fails `npm test`, so CI refuses the pull request. The fix is the mechanism or
the sentence, never the scan: add the test the rule names, or remove the claim.

Not machine-checked: whether the named test actually decides the rule (a test that exists,
runs and asserts something else passes this scan, and the scan does not require the file to
carry the rule's id); claims of enforcement written in wording the header scan does not
read, or below a file's first line of code; and headers of shell scripts and of files in
subdirectories. Those stay with the reviewer.
