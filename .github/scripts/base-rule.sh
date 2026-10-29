#!/usr/bin/env bash
# Run a pull-request rule with the BASE branch's copy of its program, so a pull request
# cannot change the program that judges it (rules project.fail-first, project.review-verdict,
# project.pr-names-its-plan).
#
#   .github/scripts/base-rule.sh <base-ref> scripts/<rule>.mjs [arguments of the program...]
#
# <base-ref> is a remote-tracking ref by its full name (refs/remotes/origin/<base>, what
# actions/checkout fetches) or a full 40-hex commit name, and nothing else: git looks a short
# name such as origin/main up in refs/tags/ before refs/remotes/, and the checkout fetches tags,
# so a pushed tag named origin/main would shadow the base branch and let the pull request's own
# program judge it (review of #255, R2). A full name whose short name a tag, a branch or
# another ref also answers is refused as ambiguous, and so is a commit name a ref also has; the
# callers pass the same full name to the program (--base, --base-branch). Refusals exit 2.
# The program is taken from <base-ref> together with the rest of that commit's scripts/ (its
# imports), extracted outside the checkout, and run on this checkout with --repo. Which commit
# judged is printed. Only when <base-ref> has no such program (the pull request that introduces
# the rule) does the checkout's own copy run, and that is printed as a warning.
set -euo pipefail

base="${1:?usage: $0 <base-ref> scripts/<rule>.mjs [arguments...]}"
program="${2:?usage: $0 <base-ref> scripts/<rule>.mjs [arguments...]}"
shift 2
case "$program" in
  scripts/fail-first.mjs | scripts/review-verdict.mjs | scripts/pr-metadata.mjs) ;;
  *) echo "base-rule: $program is not a pull-request rule" >&2; exit 2 ;;
esac

repo="$(git rev-parse --show-toplevel)"
refuse() { echo "base-rule: $base $1" >&2; exit 2; }
exists() { git -C "$repo" show-ref --verify --quiet "$1"; }
if [[ "$base" =~ ^[0-9a-f]{40}$ ]]; then
  for shadow in "refs/$base" "refs/tags/$base" "refs/heads/$base" "refs/remotes/$base"; do
    if exists "$shadow"; then refuse "is ambiguous: $shadow has the same name"; fi
  done
  oid="$base"
elif [[ "$base" == refs/remotes/?* ]]; then
  # (show-ref --verify: exactly this ref, never one git would guess for the name)
  oid="$(git -C "$repo" show-ref --verify --hash "$base" 2> /dev/null)" \
    || refuse "does not exist (git show-ref --verify)"
  short="${base#refs/remotes/}"
  for shadow in "refs/$short" "refs/tags/$short" "refs/heads/$short"; do
    if exists "$shadow"; then refuse "is ambiguous: $shadow shadows its short name $short"; fi
  done
else
  refuse "is not a remote-tracking ref (refs/remotes/...) or a full 40-hex commit name"
fi
sha="$(git -C "$repo" rev-parse --verify --quiet "$oid^{commit}")" || refuse "names no commit"
if ! git -C "$repo" cat-file -e "$sha:$program" 2> /dev/null; then
  echo "::warning::base-rule: $base (${sha:0:12}) has no $program; this checkout's copy judges"
  status=0
  node "$repo/$program" --repo "$repo" "$@" || status=$?
  exit "$status"
fi

# (the physical path: a program asked through a symlinked temporary directory would not
# recognise itself as the one being run)
dir="$(cd "$(mktemp -d)" && pwd -P)"
trap 'rm -rf "$dir"' EXIT
git -C "$repo" archive "$sha" -- scripts | tar -x -C "$dir"
echo "base-rule: $program of $base (${sha:0:12}) judges this pull request"
status=0
node "$dir/$program" --repo "$repo" "$@" || status=$?
exit "$status"
