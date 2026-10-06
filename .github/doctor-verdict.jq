# The verdict of the CI `knowledge` job on `majordomus doctor --json` output, read with
# `jq -e -s -f`: true (exit 0) only when doctor reported its layout as OK and no FAIL other
# than the two git-hook wiring entries of policy `enforcement` (doctor-on-commit,
# finish-on-push), which describe a developer checkout's hooks and cannot exist on a runner.
# An empty output is false: a doctor that printed nothing proved nothing.
# Tested by tests/unit/ci-knowledge-job.test.mjs.
def excused: .category == "wiring"
  and (.subject == "doctor-on-commit" or .subject == "finish-on-push");
any(.[]; .level == "OK" and .category == "layout")
  and ([.[] | select(.level == "FAIL") | select(excused | not)] | length == 0)
