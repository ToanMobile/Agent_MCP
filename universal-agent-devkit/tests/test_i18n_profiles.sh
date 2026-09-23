#!/usr/bin/env bash
# Regression test: EN/VI output language (P2-4), web/backend profiles (P2-5) and
# profile-based skill filtering (P1-5). Installs only into temp projects.
set -u

DEVKIT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
INSTALL="$DEVKIT_DIR/bin/install.sh"
CFG="$DEVKIT_DIR/bin/agent-config.py"
HEALTH="$DEVKIT_DIR/bin/agent-health.py"
GATE="$DEVKIT_DIR/bin/post-fix-gate.py"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
export HOME="$TMP/home"; mkdir -p "$HOME"
unset DEVKIT_LANG CLAUDE_PROJECT_DIR TARGET_DIR
FAILS=0
ok()   { echo "✔ $1"; }
fail() { echo "✖ $1"; FAILS=$((FAILS + 1)); }

# Vietnamese letters with diacritics — English output must contain none.
VI='[àáảãạăằắẳẵặâầấẩẫậèéẻẽẹêềếểễệìíỉĩịòóỏõọôồốổỗộơờớởỡợùúủũụưừứửữựỳýỷỹỵđÀÁẢÃẠĂẰẮẲẴẶÂẦẤẨẪẬÈÉẺẼẸÊỀẾỂỄỆÌÍỈĨỊÒÓỎÕỌÔỒỐỔỖỘƠỜỚỞỠỢÙÚỦŨỤƯỪỨỬỮỰỲÝỶỸỴĐ]'
no_vi() { # <label> <file>
  if grep -qE "$VI" "$2"; then fail "$1 (Vietnamese left: $(grep -nE "$VI" "$2" | head -3 | tr '\n' ' '))"; else ok "$1"; fi
}

newproj() { # <name> <marker-file> [content]
  local d="$TMP/$1"; mkdir -p "$d"; git -C "$d" init -q
  [ -n "${2:-}" ] && printf '%s\n' "${3:-}" > "$d/$2"
  printf '%s' "$d"
}
install_q() { bash "$INSTALL" "$@" </dev/null >"$TMP/out" 2>&1; }

# ---------------------------------------------------------------- P2-4 i18n
P="$(newproj node package.json '{"name":"x","scripts":{"test":"echo ok"}}')"
install_q -t "$P" -y --lang=en; rc=$?
[ "$rc" = 0 ] && ok "install --lang=en exits 0" || { fail "install --lang=en: rc=$rc"; tail -5 "$TMP/out"; }
no_vi "install --lang=en: no Vietnamese in installer/adapter/profile output" "$TMP/out"
grep -q '"lang": "en"' "$P/.active-profile.json" && ok "--lang=en saved in .active-profile.json" || fail "lang not saved"

python3 "$CFG" --status -t "$P" >"$TMP/out" 2>&1
no_vi "agent-config reuses the saved language (no --lang, no DEVKIT_LANG)" "$TMP/out"
DEVKIT_LANG=en python3 "$CFG" -p universal -t "$TMP/cfg_en" >"$TMP/out" 2>&1
no_vi "DEVKIT_LANG=en agent-config output is English" "$TMP/out"
python3 "$CFG" -p universal -t "$TMP/cfg_vi" >"$TMP/out" 2>&1
grep -qE "$VI" "$TMP/out" && ok "default language stays Vietnamese" || fail "default language is no longer vi"
python3 "$CFG" -p universal -t "$TMP/cfg_vi" --lang en >"$TMP/out" 2>&1
no_vi "--lang beats the saved language" "$TMP/out"

python3 "$HEALTH" -t "$P" --lang en >"$TMP/out" 2>&1
no_vi "agent-health --lang en output is English" "$TMP/out"

G="$(newproj gate)"
mkdir -p "$G/src" && echo 'fun a() = 1' > "$G/src/A.kt" && git -C "$G" add -A && git -C "$G" -c user.email=t@t -c user.name=t commit -qm base
printf 'fun a() {\n  try { x() } catch (e: Exception) {}\n  Thread.sleep(5)\n}\n' > "$G/src/A.kt"
(cd "$G" && DEVKIT_LANG=en python3 "$GATE" --allow-no-tests >"$TMP/out" 2>&1)
no_vi "DEVKIT_LANG=en post-fix-gate output (with findings) is English" "$TMP/out"
grep -q "REJECT" "$TMP/out" && ok "English gate still REJECTs the findings" || fail "English gate verdict changed"

# ---------------------------------------------------------------- P2-5 web/backend profiles
for p in web backend; do
  d="$DEVKIT_DIR/profiles/$p"
  if [ -f "$d/profile.json" ] && [ -f "$d/DESIGN.md" ] && [ -f "$d/instincts.md" ] && [ -f "$d/regression_matrix.json" ] \
     && [ -f "$DEVKIT_DIR/$(python3 -c "import json;print(json.load(open('$d/profile.json'))['rules_file'])")" ] \
     && [ -e "$DEVKIT_DIR/rules/$p-rules.md" ]; then
    ok "profile $p ships profile.json, rules, DESIGN.md, instincts.md, matrix"
  else
    fail "profile $p is missing standard artefacts"
  fi
done
install_q -t "$(newproj node2 package.json '{}')" -y; grep -Eq "Profile: +web" "$TMP/out" && ok "-y on a package.json project selects web" || fail "-y package.json: $(grep 'Profile:' "$TMP/out")"
install_q -t "$(newproj go go.mod 'module x')" -y; grep -Eq "Profile: +backend" "$TMP/out" && ok "-y on a go.mod project selects backend" || fail "-y go.mod: $(grep 'Profile:' "$TMP/out")"
install_q -t "$(newproj py pyproject.toml '[project]')" -y; grep -Eq "Profile: +backend" "$TMP/out" && ok "-y on a pyproject project selects backend" || fail "-y pyproject: $(grep 'Profile:' "$TMP/out")"
for alias in web frontend 7 backend api 8; do
  python3 "$CFG" -p "$alias" -t "$TMP/alias_$alias" >/dev/null 2>&1 && ok "agent-config accepts '$alias'" || fail "agent-config rejects '$alias'"
done

# Matrix runner detection fails closed when no runner is present.
B="$(newproj be_empty)"
cmd="$(python3 -c "import json;print(json.load(open('$DEVKIT_DIR/profiles/backend/regression_matrix.json'))['rules'][0]['mandatory_regression_tests'][0]['command'])")"
(cd "$B" && bash -c "$cmd" >/dev/null 2>&1); rc=$?
[ "$rc" -ne 0 ] && ok "backend matrix: no runner detected -> FAIL (exit $rc), never a silent PASS" || fail "backend matrix passes without a runner"
W="$(newproj web_empty)"
cmd="$(python3 -c "import json;print(json.load(open('$DEVKIT_DIR/profiles/web/regression_matrix.json'))['rules'][0]['mandatory_regression_tests'][0]['command'])")"
(cd "$W" && bash -c "$cmd" >/dev/null 2>&1); rc=$?
[ "$rc" -ne 0 ] && ok "web matrix: no package.json -> FAIL (exit $rc)" || fail "web matrix passes without package.json"

# ---------------------------------------------------------------- P1-5 skill filter
ANDROID_ONLY="android-real-device-qa compose-recomp-audit deploy unity-gc-audit"
ANDROID_CMDS="android-qa.md android-real-device-qa.md build.md deploy.md gc-audit.md recomp-audit.md compose-recomp-audit.md unity-gc-audit.md"
for mode in symlink copy; do
  U="$(newproj "u_$mode" package.json '{}')"
  install_q -t "$U" -a claude,gemini -p universal -m "$mode"
  bad=""; for s in $ANDROID_ONLY; do [ -e "$U/.agents/skills/$s" ] && bad="$bad $s"; done
  [ -z "$bad" ] && ok "universal ($mode): no Android/Unity skills in .agents/skills" || fail "universal ($mode): installed$bad"
  bad=""; for c in $ANDROID_CMDS; do [ -e "$U/.claude/commands/$c" ] && bad="$bad $c"; done
  [ -z "$bad" ] && ok "universal ($mode): no Android/Unity commands in .claude/commands" || fail "universal ($mode): commands$bad"
  [ -e "$U/.agents/skills/qc" ] && [ -e "$U/.claude/commands/fix.md" ] && ok "universal ($mode): general skills/commands still installed" || fail "universal ($mode): general skills missing"
done

A="$(newproj android build.gradle '')"
install_q -t "$A" -a claude,gemini -p android
miss=""; for s in $ANDROID_ONLY; do [ -e "$A/.agents/skills/$s" ] || miss="$miss $s"; done
[ -z "$miss" ] && ok "android: every skill installed (incl. Android/Unity)" || fail "android: missing$miss"
[ -e "$A/.claude/commands/deploy.md" ] && ok "android: /deploy command installed" || fail "android: /deploy missing"

# Switching the project to a profile that excludes skills removes only DevKit items.
echo "my own deploy notes" > "$TMP/mine.md"
rm -f "$A/.claude/commands/build.md" && cp "$TMP/mine.md" "$A/.claude/commands/build.md"
install_q -t "$A" -a claude,gemini -p web
[ ! -e "$A/.agents/skills/deploy" ] && [ ! -e "$A/.claude/commands/deploy.md" ] && ok "android -> web: DevKit Android links removed" || fail "android -> web: Android links left behind"
grep -qx "my own deploy notes" "$A/.claude/commands/build.md" 2>/dev/null && ok "android -> web: user's own build.md kept" || fail "android -> web: user's build.md removed"

# Every profile lists only existing skills.
for d in "$DEVKIT_DIR"/profiles/*/; do
  p="$(basename "$d")"
  python3 "$DEVKIT_DIR/scripts/profile_skills.py" "$p" >/dev/null 2>"$TMP/err" && ok "profile $p: skill filter names only existing skills" || fail "profile $p: $(cat "$TMP/err")"
done

# ---------------------------------------------------------------- gate reads .agents/regression_matrix.active.json
M="$(newproj matrix)"
echo 'x' > "$M/README.md" && git -C "$M" add -A && git -C "$M" -c user.email=t@t -c user.name=t commit -qm base
python3 "$CFG" -p backend -t "$M" >/dev/null 2>&1
echo 'package main' > "$M/main.go"
(cd "$M" && python3 "$GATE" --json >"$TMP/out" 2>&1)
grep -q "REG-BE-01" "$TMP/out" && ok "gate uses .agents/regression_matrix.active.json written by agent-config" || fail "gate ignores the .agents/ matrix"
grep -q '"matrix_problem": null' "$TMP/out" && ok "unmodified DevKit profile matrix (uncommitted) is trusted" || fail "DevKit profile matrix flagged untrusted: $(grep -o '"matrix_problem": [^,]*' "$TMP/out")"
python3 - "$M/.agents/regression_matrix.active.json" <<'PY'
import json, sys
d = json.load(open(sys.argv[1]))
d["rules"][0]["mandatory_regression_tests"][0]["command"] = "true"
json.dump(d, open(sys.argv[1], "w"))
PY
(cd "$M" && python3 "$GATE" --run-tests >"$TMP/out" 2>&1); rc=$?
[ "$rc" = 2 ] && ok "edited, uncommitted matrix -> UNVERIFIED (exit 2), never PASS" || fail "edited uncommitted matrix: exit $rc"

echo
[ "$FAILS" -eq 0 ] && echo "i18n/profiles: all checks passed" || echo "i18n/profiles: $FAILS check(s) failed"
exit "$FAILS"
