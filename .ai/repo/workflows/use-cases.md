# Use cases

A use case is an executable object of this repository, not documentation about it:
one file under `.ai/repo/use-cases/`, the commands, rules, claims, responsibilities and
applications it names, and a scenario the tool runs against itself. The contract is
`.ai/repo/use-cases/README.md` and the use-case/v1 schema of the installed tool; this is what
a worker does with it.

## When you change a capability

1. `majordomus usecase impact` names the use cases, scenarios and cases your change
   reaches. Run the scenarios it lists; update a use case whose behaviour genuinely
   changed rather than writing a near-duplicate.
2. A new guaranteed claim (give it `responsibility: product`) is a coverage gap the moment
   it exists; `majordomus usecase coverage` shows it. `majordomus usecase scaffold` drafts
   only for commands, so write the use case by hand next to an existing one (the
   `oscilla-tree` setup and a `knowledge edges` step naming the claim): the narrative
   (`# Situation`, `# What proves it`, `# Outcome`), the scenario, `status: active`.
3. `majordomus usecase validate`, then `majordomus usecase run <id>`. A step that does
   not behave as the scenario says is a failure with the step named, never a page.
4. `majordomus finish` refuses completion while a required capability has no active use
   case running it (policy `use_cases.coverage`, finish key `use_cases_covered`). Here the
   targets are the guaranteed product claims of `docs/CLAIMS.yaml` (each carries
   `responsibility: product`), and the policy makes their gaps advisory, so `doctor` and
   `finish` report a gap and do not refuse it.

An OSCILLA use case's scenario cannot play audio: a use-case/v1 step can only invoke the
tool. It proves traceability (the claim's implementation and test are tracked and wired in
the knowledge graph); the behaviour is proven by the claim's own test, which CI runs.

## What never goes into a use case

A command's description or syntax, a rule's text, a claim's wording, captured output, a
status somebody wrote by hand. All of it is derived from the objects the use case names
and from the evidence of its run; the schema refuses a key it does not declare.

## Reading one

`majordomus usecase list`, `majordomus usecase show <id>`; over MCP,
`majordomus://use-case/<id>`.
