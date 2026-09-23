#!/usr/bin/env bash
# Regression test: scripts/merge_json.py must never lose or duplicate user settings.
set -u

DEVKIT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
MERGE="$DEVKIT_DIR/scripts/merge_json.py"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
FAILS=0
ok()   { echo "✔ $1"; }
fail() { echo "✖ $1"; FAILS=$((FAILS + 1)); }

cat > "$TMP/src.json" <<'JSON'
{"env": {"GOOGLE_APPLICATION_CREDENTIALS": "devkit-default.json", "NEW_VAR": "1"},
 "hooks": {"Stop": [{"matcher": "", "hooks": [
   {"type": "command", "command": "bash .claude/hooks/testsourceset_gate.sh", "timeout": 60}]}]}}
JSON

# 1. JSONC (comments) target is refused and left byte-identical.
printf '{\n  // my comment\n  "env": {}\n}\n' > "$TMP/jsonc.json"
cp "$TMP/jsonc.json" "$TMP/jsonc.orig"
if python3 "$MERGE" "$TMP/src.json" "$TMP/jsonc.json" 2>/dev/null; then
  fail "unparseable target should exit non-zero"
else
  cmp -s "$TMP/jsonc.json" "$TMP/jsonc.orig" && ok "unparseable target untouched" || fail "unparseable target was modified"
fi

# 2. User's scalar value wins; new keys are added.
cat > "$TMP/user.json" <<'JSON'
{"env": {"GOOGLE_APPLICATION_CREDENTIALS": "/real/key.json"},
 "hooks": {"Stop": [{"matcher": "", "hooks": [
   {"type": "command", "command": "bash .claude/hooks/testsourceset_gate.sh", "timeout": 600}]}]}}
JSON
python3 "$MERGE" "$TMP/src.json" "$TMP/user.json" || fail "merge exited non-zero"
python3 - "$TMP/user.json" <<'PY' && ok "user scalar kept, new key added, hook not duplicated" || fail "merge result wrong"
import json, sys
d = json.load(open(sys.argv[1]))
assert d["env"]["GOOGLE_APPLICATION_CREDENTIALS"] == "/real/key.json", d["env"]
assert d["env"]["NEW_VAR"] == "1"
stop = d["hooks"]["Stop"]
cmds = [h["command"] for g in stop for h in g["hooks"]]
assert cmds == ["bash .claude/hooks/testsourceset_gate.sh"], stop
assert stop[0]["hooks"][0]["timeout"] == 600
PY

# 3. Re-running is idempotent and makes no extra backup.
cp "$TMP/user.json" "$TMP/after1.json"
python3 "$MERGE" "$TMP/src.json" "$TMP/user.json"
cmp -s "$TMP/user.json" "$TMP/after1.json" && ok "second merge is a no-op" || fail "second merge changed the file"
ls "$TMP" | grep -qE '^user_old\.[0-9]{8}' && fail "no-op merge created a timestamped backup" || ok "no-op merge made no backup"

# 4. A changing merge whose _old slot holds a different version gets a timestamped backup.
echo '{"a": 1}' > "$TMP/cfg.json"
echo '{"a": 0}' > "$TMP/cfg_old.json"
echo '{"b": 2}' > "$TMP/src2.json"
python3 "$MERGE" "$TMP/src2.json" "$TMP/cfg.json"
ls "$TMP" | grep -qE '^cfg_old\.[0-9]{8}-[0-9]{6}\.json$' && ok "timestamped backup written" || fail "no timestamped backup"

# 5. File mode is preserved (mkstemp would otherwise leave 0600).
mode() { python3 -c 'import os,sys;print(oct(os.stat(sys.argv[1]).st_mode & 0o777))' "$1"; }
echo '{"a": 1}' > "$TMP/perm.json" && chmod 644 "$TMP/perm.json"
python3 "$MERGE" "$TMP/src2.json" "$TMP/perm.json"
[ "$(mode "$TMP/perm.json")" = "0o644" ] && ok "existing file mode kept" || fail "mode changed to $(mode "$TMP/perm.json")"
rm -f "$TMP/new.json"; python3 "$MERGE" "$TMP/src2.json" "$TMP/new.json"
[ "$(mode "$TMP/new.json")" = "0o644" ] && ok "new file is 0644" || fail "new file mode $(mode "$TMP/new.json")"

# 6. Same command under different matchers is kept once per matcher.
echo '{"hooks":{"PreToolUse":[{"matcher":"Edit","hooks":[{"type":"command","command":"X"}]},{"matcher":"Write","hooks":[{"type":"command","command":"X"}]}]}}' > "$TMP/src3.json"
rm -f "$TMP/m.json"; python3 "$MERGE" "$TMP/src3.json" "$TMP/m.json"
python3 -c 'import json,sys; g=json.load(open(sys.argv[1]))["hooks"]["PreToolUse"]; assert sorted(x["matcher"] for x in g)==["Edit","Write"], g' "$TMP/m.json" \
  && ok "Edit and Write groups both kept" || fail "hook group dropped for second matcher"

# 7. A symlinked target is merged into the real file, the link is kept.
mkdir -p "$TMP/real" && echo '{"a": 1}' > "$TMP/real/cfg.json" && ln -s "$TMP/real/cfg.json" "$TMP/link.json"
python3 "$MERGE" "$TMP/src2.json" "$TMP/link.json"
[ -L "$TMP/link.json" ] && grep -q '"b"' "$TMP/real/cfg.json" && ok "symlinked target merged through the link" || fail "symlink replaced or real file not merged"

# 8. Backup is as private as the original (0600 stays 0600).
echo '{"secret": 1}' > "$TMP/priv.json" && chmod 600 "$TMP/priv.json"
python3 "$MERGE" "$TMP/src2.json" "$TMP/priv.json"
[ "$(mode "$TMP/priv_old.json")" = "0o600" ] && ok "backup keeps 0600" || fail "backup mode $(mode "$TMP/priv_old.json")"

# 9. Non-UTF-8 target: clean error, file untouched.
printf '\xff\xfe{' > "$TMP/bin.json"; cp "$TMP/bin.json" "$TMP/bin.orig"
python3 "$MERGE" "$TMP/src2.json" "$TMP/bin.json" 2>"$TMP/err" ; rc=$?
[ "$rc" = 1 ] && ! grep -q Traceback "$TMP/err" && cmp -s "$TMP/bin.json" "$TMP/bin.orig" && ok "non-UTF-8 target refused cleanly" || fail "non-UTF-8 target: rc=$rc"

# 10. Re-install over an older template spelling / wider matcher does not duplicate.
echo '{"hooks":{"PreToolUse":[{"matcher":"Bash","hooks":[{"type":"command","command":"\"${CLAUDE_PROJECT_DIR:-$PWD}\"/.claude/hooks/block-dangerous-git.sh"}]}],"PostToolUse":[{"matcher":"Edit|Write","hooks":[{"type":"command","command":"bash .claude/hooks/churn_guard.sh"}]}]}}' > "$TMP/oldinst.json"
echo '{"hooks":{"PreToolUse":[{"matcher":"Bash","hooks":[{"type":"command","command":"bash \"${CLAUDE_PROJECT_DIR:-$PWD}/.claude/hooks/block-dangerous-git.sh\""}]}],"PostToolUse":[{"matcher":"Edit|Write|NotebookEdit","hooks":[{"type":"command","command":"bash \"${CLAUDE_PROJECT_DIR:-$PWD}/.claude/hooks/churn_guard.sh\""}]}]}}' > "$TMP/newtpl.json"
python3 "$MERGE" "$TMP/newtpl.json" "$TMP/oldinst.json"
python3 -c 'import json,sys; h=json.load(open(sys.argv[1]))["hooks"]; n=lambda e: sum(len(g["hooks"]) for g in h[e]); assert n("PreToolUse")==1 and n("PostToolUse")==1, h' "$TMP/oldinst.json" \
  && ok "old spelling / overlapping matcher not duplicated" || fail "hooks duplicated on re-install"

# 11. (M-21) A user hook that only shares the FILE NAME with a DevKit hook (different
#     path) is a different hook: the DevKit one must still be installed.
echo '{"hooks":{"Stop":[{"matcher":"","hooks":[{"type":"command","command":"bash /home/me/scripts/claim_check.sh"}]}]}}' > "$TMP/samename.json"
echo '{"hooks":{"Stop":[{"matcher":"","hooks":[{"type":"command","command":"bash \"${CLAUDE_PROJECT_DIR:-$PWD}/.claude/hooks/claim_check.sh\""}]}]}}' > "$TMP/dk_samename.json"
python3 "$MERGE" "$TMP/dk_samename.json" "$TMP/samename.json"
python3 -c 'import json,sys; c=[h["command"] for g in json.load(open(sys.argv[1]))["hooks"]["Stop"] for h in g["hooks"]]; assert len(c)==2 and any("/home/me/" in x for x in c) and any(".claude/hooks/claim_check.sh" in x for x in c), c' "$TMP/samename.json" \
  && ok "same file name, different path: both hooks kept" || fail "DevKit hook dropped because a user hook shares its file name"

if [ "$FAILS" -ne 0 ]; then echo "merge_json: $FAILS FAILED"; exit 1; fi
echo "merge_json: all checks passed"
