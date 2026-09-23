#!/usr/bin/env bash
# Regression test: regex-based linters, enrich_context instinct lookup, council catalog,
# and the grep-based self-consistency scripts (M-12, M-18, M-22, M-23).
set -u

DEVKIT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
S="$DEVKIT_DIR/scripts"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
FAILS=0
ok()   { echo "✔ $1"; }
fail() { echo "✖ $1"; FAILS=$((FAILS + 1)); }

# ── M-23: lint_compose_stability.py ───────────────────────────────────────────
mkdir -p "$TMP/c/src/latest" "$TMP/c/src/test" "$TMP/c/app"
cat > "$TMP/c/src/latest/Screen.kt" <<'KT'
@Composable
fun UserList(
    modifier: Modifier = Modifier,
    users: List<User>,
) {
    val fmt = SimpleDateFormat("yyyy")
    Text("x")
}

@Composable
fun Ok(users: ImmutableList<User>) {
    val fmt = remember { SimpleDateFormat("yyyy") }
}
KT
cp "$TMP/c/src/latest/Screen.kt" "$TMP/c/src/test/ScreenCopy.kt"
cp "$TMP/c/src/latest/Screen.kt" "$TMP/c/app/ScreenTest.kt"
out="$(python3 "$S/lint_compose_stability.py" "$TMP/c" 2>&1)"; rc=$?
[ "$rc" -eq 1 ] && ok "M-23: compose lint exits 1 on violations" || fail "M-23: compose lint exit $rc"
echo "$out" | grep -q "UserList\`: Unstable collection parameter \`List" && ok "M-23: multi-line signature List<> param detected" || fail "M-23: multi-line signature missed"
echo "$out" | grep -q "Line 4 in @Composable \`UserList\`" && ok "M-23: correct line number for multi-line param" || fail "M-23: wrong line number"
echo "$out" | grep -q "Line 6 in @Composable \`UserList\`: Unremembered" && ok "M-23: unremembered formatter detected" || fail "M-23: unremembered formatter missed"
echo "$out" | grep -q "\`Ok\`" && fail "M-23: false positive on ImmutableList/remember" || ok "M-23: no false positive on safe composable"
echo "$out" | grep -q "src/latest/Screen.kt" && ok "M-23: 'latest' path not treated as test" || fail "M-23: src/latest skipped as test"
echo "$out" | grep -qE "src/test/|ScreenTest.kt" && fail "M-23: test dir/suffix not excluded" || ok "M-23: test/ dir and *Test.kt excluded"
python3 "$S/lint_compose_stability.py" "$TMP/does-not-exist" >/dev/null 2>&1; rc=$?
[ "$rc" -eq 2 ] && ok "M-23: missing path exits 2" || fail "M-23: missing path exit $rc (fail-open)"
python3 "$S/lint_compose_stability.py" >/dev/null 2>&1; rc=$?
[ "$rc" -eq 2 ] && ok "M-23: no args exits 2" || fail "M-23: no args exit $rc"
head -5 "$S/lint_compose_stability.py" | grep -q "REGEX-BASED" && ok "M-23: compose header says regex-based" || fail "M-23: compose header not honest"

# ── M-23: lint_unity_gc.py ───────────────────────────────────────────────────
mkdir -p "$TMP/u/Assets/Scripts/latest" "$TMP/u/Assets/Tests"
cat > "$TMP/u/Assets/Scripts/latest/Player.cs" <<'CS'
public class Player : MonoBehaviour {
    void Update()
    {
        var list = new List<int>();
    }
}
CS
cp "$TMP/u/Assets/Scripts/latest/Player.cs" "$TMP/u/Assets/Tests/PlayerCopy.cs"
out="$(python3 "$S/lint_unity_gc.py" "$TMP/u" 2>&1)"; rc=$?
[ "$rc" -eq 1 ] && echo "$out" | grep -q "latest/Player.cs" && ok "M-23: unity lint scans 'latest' path, exit 1" || fail "M-23: unity lint rc=$rc"
echo "$out" | grep -q "Tests/PlayerCopy.cs" && fail "M-23: unity Tests/ dir not excluded" || ok "M-23: unity Tests/ dir excluded"
python3 "$S/lint_unity_gc.py" "$TMP/nope" >/dev/null 2>&1; rc=$?
[ "$rc" -eq 2 ] && ok "M-23: unity missing path exits 2" || fail "M-23: unity missing path exit $rc"
head -5 "$S/lint_unity_gc.py" | grep -q "REGEX-BASED" && ok "M-23: unity header says regex-based" || fail "M-23: unity header not honest"

# ── M-22: enrich_context.py ──────────────────────────────────────────────────
mkdir -p "$TMP/p/.agents"
cat > "$TMP/p/.agents/instincts.md" <<'MD'
### [INSTINCT-AUTO] Zebrafrobnicator crash khi xoay màn hình
- **Hiện tượng lỗi:** zebrafrobnicator null
MD
out="$(cd "$TMP/p" && CLAUDE_PROJECT_DIR="$TMP/p" python3 "$S/enrich_context.py" "sửa zebrafrobnicator crash" 2>&1)"
echo "$out" | grep -q "INSTINCT-AUTO\] Zebrafrobnicator" && ok "M-22: INSTINCT-AUTO lesson from project is found" || fail "M-22: INSTINCT-AUTO lesson not found"
out="$(cd "$TMP/p" && CLAUDE_PROJECT_DIR="$TMP/p" python3 "$S/enrich_context.py" "qqqxxyyzz" 2>&1)"
python3 - "$out" <<'PY' && ok "M-22: no fabricated instincts when nothing matches" || fail "M-22: fabricated default instincts returned"
import json, sys
d = json.loads(sys.argv[1])
assert d["matched_instincts"] == [], d["matched_instincts"]
PY

# ── M-12 / P1-6: council catalog ─────────────────────────────────────────────
dupes="$(grep -h '^name:' "$DEVKIT_DIR"/agents/councils/*.md "$DEVKIT_DIR"/agents/*.md | sort | uniq -d)"
[ -z "$dupes" ] && ok "M-12: no duplicate agent/council names" || fail "M-12: duplicate names: $dupes"
n_links="$(find "$DEVKIT_DIR/agents" -type l | wc -l | tr -d ' ')"
[ "$n_links" -eq 0 ] && ok "M-12: no alias symlinks in agents/" || fail "M-12: $n_links alias symlinks remain"
grep -q '^name: exampleapp-' "$DEVKIT_DIR"/agents/*.md && fail "K-15: placeholder agent name remains" || ok "K-15: no placeholder agent name"

# ── G2: every profile ships real DESIGN.md and instincts.md ──────────────────
for d in "$DEVKIT_DIR"/profiles/*/; do
  p="$(basename "$d")"
  if [ -f "$d/DESIGN.md" ] && [ ! -L "$d/DESIGN.md" ] && [ -f "$d/instincts.md" ] && [ ! -L "$d/instincts.md" ]; then
    ok "G2: profile $p has real DESIGN.md + instincts.md"
  else
    fail "G2: profile $p missing real DESIGN.md/instincts.md"
  fi
done

# ── M-18: self-consistency scripts are honest and still runnable ─────────────
for f in "$S"/audit_*agents.py "$S"/adversarial_chaos_test_10_agents.py; do
  n="$(basename "$f")"
  grep -q "grep-based" "$f" && ok "M-18: $n labelled grep-based" || fail "M-18: $n not labelled grep-based"
  grep -qE "294|134 Workflows|160 Hooks|HOÀN HẢO 10/10|bất khả xâm phạm" "$f" && fail "M-18: $n still has hardcoded/overclaiming text" || ok "M-18: $n no hardcoded counts/overclaims"
  out="$(python3 "$f" 2>&1 | sed 's/\x1b\[[0-9;]*m//g')"
  echo "$out" | grep -qE "[0-9]+/[0-9]+ checks passed" && ok "M-18: $n prints 'N/M checks passed'" || fail "M-18: $n summary missing"
done

echo
[ "$FAILS" -eq 0 ] && echo "lint/scripts: all checks passed" || echo "lint/scripts: $FAILS check(s) failed"
exit "$FAILS"
