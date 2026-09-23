#!/usr/bin/env bash
# Regression test: living regression checklist written by post-fix-gate.
# PASS/FAIL comes only from tests the gate actually ran; uncovered changes and
# recorded bugs are tracked; the gate never audits its own checklist files.
set -u

DEVKIT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
GATE="$DEVKIT_DIR/bin/post-fix-gate.py"
RC="$DEVKIT_DIR/bin/regression_checklist.py"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
FAILS=0
ok()   { echo "✔ $1"; }
fail() { echo "✖ $1"; FAILS=$((FAILS + 1)); }
jq_py() { python3 -c "import json,sys; d=json.load(open('$TMP/repo/.agents/regression_status.json')); print($1)"; }

mkdir -p "$TMP/repo/src" && cd "$TMP/repo" || exit 1
git init -q . && git config user.email t@t && git config user.name t
echo "fun ok() = 1" > src/Core.kt
cat > matrix.json <<'JSON'
{"project":"t","rules":[{"component":"Core","watch_files":["src/Core.kt"],
 "mandatory_regression_tests":[{"id":"REG-1","name":"core flow","command":"sh result.sh"}]}]}
JSON
echo 'exit 0' > result.sh
git add -A && git commit -qm init
gate() { CLAUDE_PROJECT_DIR="$TMP/repo" python3 "$GATE" --matrix "$TMP/repo/matrix.json" "$@" >"$TMP/out" 2>&1; }

# 1. A real passing run is recorded with task + commit.
echo "fun ok() = 2" > src/Core.kt
gate --run-tests --task T0001-login
[ "$(jq_py 'd["items"]["REG-1"]["last"]["status"]')" = PASS ] && ok "passing run recorded as PASS" || fail "PASS not recorded"
[ "$(jq_py 'd["items"]["REG-1"]["last"]["task"]')" = T0001-login ] && ok "task recorded" || fail "task not recorded"
grep -q '✅ PASS | REG-1' .agents/regression_checklist.md && ok "Markdown view shows ✅ PASS" || fail "view missing PASS row"

# 2. Dry-run never changes a result (no fabricated status).
echo 'exit 1' > result.sh
gate
[ "$(jq_py 'd["items"]["REG-1"]["last"]["status"]')" = PASS ] && ok "dry-run leaves the last real result untouched" || fail "dry-run changed the result"

# 3. A real failing run is recorded, history keeps both.
gate --run-tests --task T0002-regress
[ "$(jq_py 'd["items"]["REG-1"]["last"]["status"]')" = FAIL ] && ok "failing run recorded as FAIL" || fail "FAIL not recorded"
[ "$(jq_py 'len(d["items"]["REG-1"]["history"])')" = 2 ] && ok "history keeps both runs" || fail "history wrong"
grep -q '❌ FAIL | REG-1' .agents/regression_checklist.md && ok "view shows ❌ FAIL" || fail "view missing FAIL"

# 4. A changed source file no rule covers becomes UNCOVERED; linking resolves it.
echo 'exit 0' > result.sh
echo "fun other() = 1" > src/Other.kt
gate --run-tests
[ "$(jq_py '"UNCOVERED:src/Other.kt" in d["items"]')" = True ] && ok "uncovered source file tracked" || fail "UNCOVERED row missing"
grep -q 'UNCOVERED:src/Other.kt' "$TMP/out" && ok "gate tells the user how to link it" || fail "no UNCOVERED hint"
gate --run-tests; rc=$?
[ "$rc" = 2 ] && ok "a change with an uncovered source file is not a PASS (exit 2)" || fail "uncovered change passed (exit $rc)"
python3 "$RC" --project "$TMP/repo" link UNCOVERED:src/Other.kt REG-1 >/dev/null
[ "$(jq_py '"UNCOVERED:src/Other.kt" in d["items"]')" = False ] && [ "$(jq_py '"src/Other.kt" in d["items"]["REG-1"]["covers"]')" = True ] \
  && ok "link resolves UNCOVERED onto the test" || fail "link did not resolve"
echo "fun other() = 2" > src/Other.kt
echo 'exit 1' > result.sh
gate --run-tests; rc=$?
[ "$rc" = 1 ] && grep -q 'REG-1' "$TMP/out" && ok "a linked file's change now runs its test (REJECT on failure)" || fail "linked file did not trigger its test (exit $rc)"
echo 'exit 0' > result.sh

# 5. A lesson recorded on a PASSING gate becomes a bug row linked to the passed test.
rm -f src/Other.kt
gate --run-tests --allow-no-tests --record-lesson "Login crash on empty token" --cause "null token"
bug="$(jq_py '[k for k in d["items"] if k.startswith("BUG-")][0]')"
[ "$(jq_py "d['items']['$bug']['tests']")" = "['REG-1']" ] && ok "bug linked to the test that just passed" || fail "bug not linked"
grep -q "✅ PASS | $bug" .agents/regression_checklist.md && ok "bug row mirrors its test's real result" || fail "bug row status wrong"

# 6. No way to fake: linking to a non-test id is refused.
python3 "$RC" --project "$TMP/repo" link "$bug" NOT-A-TEST 2>/dev/null && fail "linked to a non-existent test" || ok "link to unknown test refused"

# 7. The gate never audits its own checklist output.
git add -A && git commit -qm "checkpoint"
gate --run-tests; rc=$?
[ "$rc" = 3 ] && ok "checklist files alone are not an auditable change (exit 3)" || fail "gate audited its own checklist (exit $rc)"

# 8. A corrupt status file is reported and never silently reset.
echo "{broken" > .agents/regression_status.json
echo "fun ok() = 5" > src/Core.kt
gate --run-tests
grep -q "Không đọc được regression checklist" "$TMP/out" && [ "$(cat .agents/regression_status.json)" = "{broken" ] \
  && ok "corrupt checklist left untouched with a warning" || fail "corrupt checklist overwritten"

if [ "$FAILS" -ne 0 ]; then echo "regression checklist: $FAILS FAILED"; exit 1; fi
echo "regression checklist: all checks passed"
