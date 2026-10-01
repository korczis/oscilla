---
id: majordomus.deployment-contract
version: 1
kind: rule
title: A deployment is described once, and every provider artifact is generated from it
description: A deployment of the executable is a canonical object of the layer against a closed contract; the container definition and the provider configuration are projections of it, never a second description.
statement: A deployment is one object of the layer, valid against the deployment contract, carrying no credential and no restatement of provider-specific facts among the generic ones; the container image definition, its ignore file and the provider configuration are generated from it and are never authoritative.
status: active
class: blocking
depends_on: [majordomus.ai-layout-integrity@1, majordomus.projection-integrity@1]
tags: [deployment, schema, projection]

x-majordomus:
  validator: deployments
  category: deployment
  enforced_by: [doctor, watch]
  exit_code: 10
  tests: [test/cases/84_deployment_contract.sh]
---

# Rationale

A `Dockerfile` and a provider configuration written by hand restate what the repository
already knows — the port the server binds, the routes it registers, the binary the
workspace names, the paths a build reads — and every one of those pairs drifts the first
time one half changes. The failure is silent and it is discovered in production: an image
that runs a binary under a name nobody builds any more, a health check pointed at a route
that was renamed, a machine sized for a memory figure a release outgrew.

The repository already refuses that shape everywhere else. A capability is declared once
and projected into the CLI, HTTP, MCP, OpenAPI, the documentation and the site, and
`generate --check` fails when a projection goes stale. A deployment is the same kind of
fact and arrives the same way, or it does not arrive.

The second reason is money and disclosure. A deployment states how much runs and for how
long, so the description has to be somewhere a reviewer reads rather than in a provider
dashboard nobody diffs. And it must never hold the credential that authorises it: the
contract has no field for one, and a token smuggled into a field that does exist is
refused here.

# Required behaviour

A deployment is a `*.yaml` object under the layer's deployments section, valid against
`share/schemas/majordomus/deployment/deployment.v1.schema.json` (`deployment/v1`). It states the application, the
package and binary shipped, the port and the interface the process listens on, the
liveness and readiness routes, the resources, the machine count, the region and the build
inputs — each exactly once. Facts that mean nothing outside one hosting provider live in
the `provider` block and are not repeated among the generic keys.

Keys are closed by `share/allow/deployment.txt`, generated from the schema: an unknown key
is an error, never carried. Two objects may not claim one identity. `min_running` may not
exceed `count`. A health route is a path, not a URL. The port is unprivileged, because the
deployed process does not run as root.

Every provider artifact — the container image definition, its ignore file, the provider
configuration — is written by `majordomus generate` from this object, carries a provenance
header naming its source and its regeneration command, and is compared by
`generate --check`. A contributor who edits a generated artifact is told which file to
change instead.

# Failure behaviour

A violation is a `FAIL` finding under the category `deployment`, naming the object, the
key, the value found and the correction; the command that found it exits 10, and under
`watch` it is drift and the command exits 11.

# Verification

`mj_validate_deployments` decides it, dispatched from `doctor, watch`. The behavioural
case `test/cases/84_deployment_contract.sh` proves it by mutation: an unknown key, an
unknown schema version, a missing required field, a privileged port, a `min_running`
above `count`, a health route that is not a path, a duplicate identity and a credential in
a field that exists — each refused by name; and a valid object reaching the index and the
object listing with nothing registered anywhere.
