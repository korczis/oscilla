# The verdict of the CI `knowledge` job on `majordomus doctor --json` output, read with
# `jq -e -s -f`: true (exit 0) only when doctor reported its layout as OK, no FAIL other
# than the git-hook wiring entries of policy `enforcement` (doctor-on-commit, finish-on-push,
# worktree-guard, diff-check-on-commit), which describe a developer checkout's hooks and
# cannot exist on a runner, and no line at any level saying the policy lacks a key the
# pinned Majordomus requires. Doctor reports a missing required key as a WARN ("policy
# declares no <key>") and on stderr ("policy is missing required key <key>"); a layer that
# is behind its tool is a failure here (project.majordomus-layer-current).
# An empty output is false: a doctor that printed nothing proved nothing.
# Tested by tests/unit/ci-knowledge-job.test.mjs.
def excused: .category == "wiring"
  and (.subject == "doctor-on-commit" or .subject == "finish-on-push"
    or .subject == "worktree-guard" or .subject == "diff-check-on-commit");
def missing_key: ((.message // "") | test("policy (declares no|is missing required key) "));
any(.[]; .level == "OK" and .category == "layout")
  and ([.[] | select(.level == "FAIL") | select(excused | not)] | length == 0)
  and ([.[] | select(missing_key)] | length == 0)
