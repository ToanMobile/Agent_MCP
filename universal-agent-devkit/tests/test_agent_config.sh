#!/usr/bin/env bash
# Regression test: bin/agent-config.py (agent-kit profile) must write into the project,
# never into the DevKit, and must never destroy user data when switching profiles.
set -u

DEVKIT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
CFG="$DEVKIT_DIR/bin/agent-config.py"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
export HOME="$TMP/home"; mkdir -p "$HOME"
FAILS=0
ok()   { echo "✔ $1"; }
fail() { echo "✖ $1"; FAILS=$((FAILS + 1)); }

devkit_state() { (cd "$DEVKIT_DIR" && ls -la .active-profile.json .agents/active-profile templates/regression_matrix.active.json 2>&1; cat .active-profile.json 2>/dev/null) | shasum; }
BEFORE="$(devkit_state)"

# P-1: default target = git root of $PWD, not the DevKit.
mkdir -p "$TMP/proj/sub" && git -C "$TMP/proj" init -q
(cd "$TMP/proj/sub" && python3 "$CFG" -p android >/dev/null 2>&1) || fail "P-1: apply in project exited non-zero"
[ -f "$TMP/proj/.active-profile.json" ] && ok "P-1: .active-profile.json written to git root of \$PWD" || fail "P-1: profile not written to project"
[ -f "$TMP/proj/.agents/regression_matrix.active.json" ] && ok "matrix written to .agents/regression_matrix.active.json" || fail "matrix not in .agents/"
[ ! -e "$TMP/proj/templates" ] && ok "no templates/ created in project root" || fail "templates/ created in project root"
[ "$(devkit_state)" = "$BEFORE" ] && ok "P-1: DevKit untouched" || fail "P-1: DevKit state changed"

# P-1: running inside the DevKit without -t is refused.
(cd "$DEVKIT_DIR" && python3 "$CFG" -p game >/dev/null 2>&1); rc=$?
[ "$rc" -ne 0 ] && ok "P-1: refuses to write into DevKit without -t (exit $rc)" || fail "P-1: wrote into DevKit without -t"
[ "$(devkit_state)" = "$BEFORE" ] && ok "P-1: DevKit still untouched after refusal" || fail "P-1: DevKit changed after refusal"

# P-4: relative link, real timestamp.
link="$(readlink "$TMP/proj/.agents/active-profile")"
case "$link" in /*) fail "P-4: active-profile link is absolute ($link)";; *) ok "P-4: active-profile link is relative ($link)";; esac
[ -f "$TMP/proj/.agents/active-profile/profile.json" ] && ok "P-4: relative link resolves" || fail "P-4: relative link broken"
grep -q '"updated_at": "2026-09-23T10:00:00Z"' "$TMP/proj/.active-profile.json" && fail "P-4: updated_at is hardcoded" || ok "P-4: updated_at is not the hardcoded constant"

# P-2: real user dir / user-written matrix are backed up as X_old, not destroyed.
mkdir -p "$TMP/p3/.agents/active-profile" && echo "my notes" > "$TMP/p3/.agents/active-profile/NOTES.md"
echo '{"rules":[{"component":"Mine"}]}' > "$TMP/p3/.agents/regression_matrix.active.json"
python3 "$CFG" -p game -t "$TMP/p3" >/dev/null 2>&1 || fail "P-2: apply exited non-zero"
[ -f "$TMP/p3/.agents/active-profile_old/NOTES.md" ] && ok "P-2: user dir preserved as active-profile_old" || fail "P-2: user NOTES.md lost"
grep -q '"Mine"' "$TMP/p3/.agents/regression_matrix.active_old.json" 2>/dev/null && ok "P-2: user matrix preserved as regression_matrix.active_old.json" || fail "P-2: user matrix overwritten without backup"
# Switching between DevKit profiles again must not create more backups.
n_before="$(ls "$TMP/p3/.agents" | grep -c _old)"
python3 "$CFG" -p android -t "$TMP/p3" >/dev/null 2>&1
n_after="$(ls "$TMP/p3/.agents" | grep -c _old)"
[ "$n_before" = "$n_after" ] && ok "P-2: switching DevKit profiles creates no extra *_old" || fail "P-2: spurious *_old on profile switch ($n_before -> $n_after)"

# P-3: positional, case-insensitive, aliases; invalid -> non-zero.
python3 "$CFG" Android -t "$TMP/p4" >/dev/null 2>&1 && grep -q '"profile": "android"' "$TMP/p4/.active-profile.json" \
  && ok "P-3: positional + case-insensitive (Android)" || fail "P-3: positional/case-insensitive rejected"
for alias in xehoi blender all swift; do
  python3 "$CFG" -p "$alias" -t "$TMP/p5" >/dev/null 2>&1 && ok "P-3: alias '$alias' accepted" || fail "P-3: alias '$alias' rejected"
done
python3 "$CFG" -p nosuch -t "$TMP/p6" >/dev/null 2>&1; rc=$?
[ "$rc" -ne 0 ] && [ ! -e "$TMP/p6/.active-profile.json" ] && ok "P-3: invalid profile exits $rc and writes nothing" || fail "P-3: invalid profile accepted"

# P-4: MCP check reads the project's .mcp.json.
mkdir -p "$TMP/p7" && echo '{"mcpServers":{"codebase-memory-mcp":{},"context7":{}}}' > "$TMP/p7/.mcp.json"
out="$(python3 "$CFG" -p universal -t "$TMP/p7" 2>&1)"
echo "$out" | grep -q "CHƯA khai báo" && fail "P-4: project .mcp.json ignored" || ok "P-4: MCPs from project .mcp.json recognised"

# L-1: every active_councils entry of every profile exists; no missing-council warning.
for p in android automotive game ios universal voice-assistant; do
  out="$(python3 "$CFG" -p "$p" -t "$TMP/c_$p" 2>&1)"
  echo "$out" | grep -q "không tồn tại" && fail "L-1: profile $p references a missing council" || ok "L-1: profile $p councils all exist"
done

echo
[ "$FAILS" -eq 0 ] && echo "agent-config: all checks passed" || echo "agent-config: $FAILS check(s) failed"
exit "$FAILS"
