#!/usr/bin/env bash
# The pull request a CI run judges, as shell assignments for `eval` (ADR 0083):
#   PR           the pull request number (1 or more): the event's own on pull_request, or the N
#                the merge queue names its ref by on merge_group
#                (refs/heads/gh-readonly-queue/<base>/pr-N-<sha>)
#   BASE         the base branch, whose copy of a rule judges (.github/scripts/base-rule.sh)
#   DIFF_BASE    what the pull request's changes are measured against: origin/<base> on
#                pull_request (HEAD is its merge with the base), HEAD^1 on merge_group (HEAD is the
#                queue's merge of it onto main plus the pull requests ahead of it)
#   QUEUED_HEAD  on merge_group the full sha of HEAD^2, the queued pull request's head; empty on
#                pull_request
# Reads PR, GITHUB_BASE_REF, QUEUE_REF and QUEUE_BASE from the environment; prints only a number,
# branch names and a sha it has checked, so the eval runs nothing else. Exits 2, printing nothing,
# on a malformed value. Call it as `vars="$(.github/scripts/queued-pr.sh)"; eval "$vars"`: under
# `bash -e` the assignment fails the step on exit 2, while `eval "$(...)"` would carry on.
#
# HEAD^1..HEAD is one pull request's whole change only when the queue merges each pull request
# with a merge commit (merge method MERGE) and every entry's own run must pass (grouping
# ALLGREEN, ADR 0083). So on merge_group HEAD must have exactly two parents and HEAD^2 must be
# the head the queue ref names; `--check-head <QUEUED_HEAD> <pr.json>` then requires that head
# to be the pull request's headRefOid (exit 2 otherwise; a no-op when QUEUED_HEAD is empty).
set -euo pipefail

if [ "${1:-}" = '--check-head' ]; then
  [ "$#" -eq 3 ] || { echo "queued-pr: --check-head <QUEUED_HEAD> <pr.json>" >&2; exit 2; }
  queued="$2"
  [ -n "$queued" ] || exit 0
  oid="$(jq -r '.headRefOid // ""' "$3")" || { echo "queued-pr: cannot read $3" >&2; exit 2; }
  if [ "$oid" != "$queued" ]; then
    echo "queued-pr: the queue merged $queued, the pull request's head is ${oid:-unknown}" >&2
    exit 2
  fi
  exit 0
fi
[ "$#" -eq 0 ] || { echo "queued-pr: unknown argument $1" >&2; exit 2; }

name='^[A-Za-z0-9._/-]+$'
# Beside the allowlist $name, a branch name has no `..` and no leading `-` or `/`.
branch_shape() {
  [[ "$1" != *..* ]] && [[ "$1" != -* ]] && [[ "$1" != /* ]]
}
pr="${PR:-}"
base="${GITHUB_BASE_REF:-}"
diff=''
queued=''
if [ -z "$pr" ] && [ -n "${QUEUE_REF:-}" ]; then
  if [[ "$QUEUE_REF" =~ ^refs/heads/gh-readonly-queue/([A-Za-z0-9._/-]+)/pr-([0-9]+)-[0-9a-f]{7,40}$ ]]; then
    base="${BASH_REMATCH[1]}"
    pr="${BASH_REMATCH[2]}"
    sha="${QUEUE_REF##*-}"
    diff='HEAD^1'
  else
    echo "queued-pr: not a merge-queue ref: $QUEUE_REF" >&2
    exit 2
  fi
  # The event's base_ref is required, and the ref's base must be exactly it.
  if [[ "${QUEUE_BASE:-}" != refs/heads/?* ]]; then
    echo "queued-pr: merge_group without a base_ref (QUEUE_BASE=${QUEUE_BASE:-})" >&2
    exit 2
  fi
  queue_base="${QUEUE_BASE#refs/heads/}"
  if [ "$queue_base" != "$base" ]; then
    echo "queued-pr: queue ref base $base differs from the event's $queue_base" >&2
    exit 2
  fi
  # HEAD is the queue's merge commit of exactly that head: two parents, HEAD^2 the ref's sha.
  parents="$(git rev-list --parents -n 1 HEAD)" \
    || { echo "queued-pr: cannot read HEAD's parents" >&2; exit 2; }
  read -r -a words <<< "$parents"
  if [ "${#words[@]}" -ne 3 ]; then
    echo "queued-pr: HEAD has $((${#words[@]} - 1)) parent(s), not the queue's merge commit" \
      "(merge method MERGE, ADR 0083)" >&2
    exit 2
  fi
  queued="${words[2]}"
  if [[ "$queued" != "$sha"* ]]; then
    echo "queued-pr: HEAD^2 is $queued, not the queue ref's head $sha" >&2
    exit 2
  fi
fi
[[ -z "$pr" || "$pr" =~ ^[1-9][0-9]*$ ]] \
  || { echo "queued-pr: PR is not a number: $pr" >&2; exit 2; }
[[ -z "$base" || "$base" =~ $name ]] || { echo "queued-pr: bad base: $base" >&2; exit 2; }
[ -z "$base" ] || branch_shape "$base" || { echo "queued-pr: bad base: $base" >&2; exit 2; }
[ -n "$diff" ] || diff="origin/$base"
printf "PR=%s\nBASE=%s\nDIFF_BASE=%s\nQUEUED_HEAD=%s\n" "$pr" "$base" "$diff" "$queued"
