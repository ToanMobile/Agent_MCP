#!/usr/bin/env bash
# Regression test: bin/agent-health.py must report only what it measured in this run.
# (H-1: no hardcoded "100% PASS" test counts; L-2: only the active profile's MCPs are required.)
set -u

DEVKIT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
HEALTH="$DEVKIT_DIR/bin/agent-health.py"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
export HOME="$TMP/home"; mkdir -p "$HOME"
FAILS=0
ok()   { echo "✔ $1"; }
fail() { echo "✖ $1"; FAILS=$((FAILS + 1)); }
strip() { sed 's/\x1b\[[0-9;]*m//g'; }
score_of() { grep -Eo 'Điểm: [0-9]+/100' | grep -Eo '[0-9]+' | head -1; }

# H-1: no hardcoded test totals anywhere in bin/.
if grep -nE '134 \+ 160|294 Test Points|Test Points \(100% PASS\)|4 profile rules' "$DEVKIT_DIR/bin/agent-health.py" >/dev/null; then
  fail "H-1: hardcoded test/rules counts still in agent-health.py"
else
  ok "H-1: no hardcoded test/rules counts in agent-health.py"
fi

mkdir -p "$TMP/proj"
# H-1: default run does not claim tests passed.
out="$(python3 "$HEALTH" -t "$TMP/proj" 2>&1 | strip)"
echo "$out" | grep -q "tests: not run" && ok "H-1: default run prints 'tests: not run'" || fail "H-1: default run missing 'tests: not run'"
echo "$out" | grep -qi "100% PASS" && fail "H-1: default run still claims 100% PASS" || ok "H-1: default run makes no '100% PASS' claim"

# H-1: a failing suite lowers the score; a passing one does not.
s_pass="$(AGENT_HEALTH_TEST_CMD='echo "contract points: 3 ok, 0 deviating"; exit 0' python3 "$HEALTH" --run-tests -t "$TMP/proj" 2>&1 | strip | score_of)"
s_fail="$(AGENT_HEALTH_TEST_CMD='echo "contract points: 2 ok, 1 deviating"; exit 1' python3 "$HEALTH" --run-tests -t "$TMP/proj" 2>&1 | strip | score_of)"
if [ -n "$s_pass" ] && [ -n "$s_fail" ] && [ "$s_fail" -lt "$s_pass" ]; then
  ok "H-1: failing test suite lowers score ($s_pass -> $s_fail)"
else
  fail "H-1: failing test suite did not lower score (pass=$s_pass fail=$s_fail)"
fi
AGENT_HEALTH_TEST_CMD='exit 1' python3 "$HEALTH" --run-tests -t "$TMP/proj" 2>&1 | strip | grep -q "exit 1" \
  && ok "H-1: real exit code of the suite is reported" || fail "H-1: suite exit code not reported"

# L-2: only the active profile's essential_mcps are required (universal: codebase-memory-mcp, context7).
mkdir -p "$TMP/uni"
printf '{"profile":"universal"}' > "$TMP/uni/.active-profile.json"
printf '{"mcpServers":{"codebase-memory-mcp":{},"context7":{}}}' > "$TMP/uni/.mcp.json"
out="$(python3 "$HEALTH" -t "$TMP/uni" 2>&1 | strip)"
echo "$out" | grep -q "Đủ MCP của profile \`universal\`" && ok "L-2: universal profile satisfied without unity/blender" || fail "L-2: universal profile still demands other MCPs"
echo "$out" | grep -qiE "unity|blender" && fail "L-2: unity/blender demanded for universal profile" || ok "L-2: unity/blender not demanded for universal"
mkdir -p "$TMP/game"
printf '{"profile":"game"}' > "$TMP/game/.active-profile.json"
printf '{"mcpServers":{"codebase-memory-mcp":{}}}' > "$TMP/game/.mcp.json"
python3 "$HEALTH" -t "$TMP/game" 2>&1 | strip | grep -q "Thiếu MCP của profile \`game\`" \
  && ok "L-2: game profile reports its own missing MCPs" || fail "L-2: game profile missing MCPs not reported"

# Real counts: profiles and rules are counted from disk.
n_prof="$(ls -d "$DEVKIT_DIR"/profiles/*/ | wc -l | tr -d ' ')"
python3 "$HEALTH" -t "$TMP/proj" 2>&1 | strip | grep -q "Có $n_prof profile" && ok "profile count measured from disk ($n_prof)" || fail "profile count not measured"

echo
[ "$FAILS" -eq 0 ] && echo "agent-health: all checks passed" || echo "agent-health: $FAILS check(s) failed"
exit "$FAILS"
