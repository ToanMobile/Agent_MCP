#!/usr/bin/env bash
# Regression test: installer CLI, copy mode, upgrades and X_old edge cases.
# Every case replays the exact command from the QA report (I-*, O-*, M-*, L-*).
# Runs against a throwaway COPY of the devkit, so it can also assert that installing
# never writes into the devkit checkout itself (O10).
set -u

SRC_DEVKIT="$(cd "$(dirname "$0")/.." && pwd -P)"
TMP="$(mktemp -d)"
TMP="$(cd "$TMP" && pwd -P)"
trap 'rm -rf "$TMP"' EXIT
FAILS=0
ok()   { echo "✔ $1"; }
fail() { echo "✖ $1"; FAILS=$((FAILS + 1)); }

DK="$TMP/dk"
mkdir -p "$DK"
(cd "$SRC_DEVKIT" && tar --exclude=./node_modules --exclude=./.git -cf - .) | (cd "$DK" && tar -xf -)
INSTALL="$DK/bin/install.sh"
KIT="$DK/bin/agent-kit"

# Run a command detached from any controlling terminal (like CI / agent runners):
# a new session has no /dev/tty even though the device node exists.
notty() { python3 -c 'import os,subprocess,sys; sys.exit(subprocess.call(sys.argv[1:], stdin=subprocess.DEVNULL, preexec_fn=os.setsid))' "$@"; }
count_old() { find "$1" -maxdepth 4 \( -name "*_old" -o -name "*_old.*" -o -name "*_old_*" \) | wc -l | xargs; }
newproj() { local p="$TMP/$1"; rm -rf "$p"; mkdir -p "$p"; printf '%s' "$p"; }

MARK="$TMP/mark"; touch "$MARK"; sleep 1

# ---------------------------------------------------------------- I-1 / I-2 / O2
P="$(newproj "proj a")"
notty bash "$KIT" init "$P" -y >"$TMP/out" 2>&1; rc=$?
[ "$rc" = 0 ] && [ -f "$P/.claude/settings.json" ] && ok "I-1 agent-kit init '<path with space>' -y installs (no tty)" || { fail "I-1 init <path> -y: rc=$rc"; tail -5 "$TMP/out"; }

P="$(newproj p_y)"
(cd "$P" && notty bash "$KIT" init -y >"$TMP/out" 2>&1); rc=$?
[ "$rc" = 0 ] && [ -f "$P/.claude/settings.json" ] && ok "I-1 agent-kit init -y (cwd) installs" || { fail "I-1 init -y: rc=$rc"; tail -5 "$TMP/out"; }

P="$(newproj p_lang)"
(cd "$P" && notty bash "$KIT" init --lang=vi >"$TMP/out" 2>&1); rc=$?
[ "$rc" = 0 ] && [ -f "$P/.claude/settings.json" ] && ok "I-1/I-2 agent-kit init --lang=vi without tty uses defaults" || { fail "I-1 init --lang=vi: rc=$rc"; tail -5 "$TMP/out"; }

# ---------------------------------------------------------------- I-4 / I-5 exit codes
P="$(newproj p_bad)"
bash "$INSTALL" -t "$P" -a claude -p nosuch >"$TMP/out" 2>&1; rc=$?
[ "$rc" != 0 ] && [ -z "$(ls -A "$P")" ] && ok "I-4 unknown profile -> exit $rc, nothing written" || fail "I-4 -p nosuch: rc=$rc, files: $(ls -A "$P" | xargs)"

bash "$INSTALL" -t "$P" --bogus >"$TMP/out" 2>&1; rc=$?
[ "$rc" = 2 ] && [ -z "$(ls -A "$P")" ] && ok "I-5 unknown option -> exit 2, nothing written" || fail "I-5 --bogus: rc=$rc"

bash "$INSTALL" -t "$P" -y -m weird >"$TMP/out" 2>&1; rc=$?
[ "$rc" = 2 ] && [ -z "$(ls -A "$P")" ] && ok "I-5 invalid --mode -> exit 2" || fail "I-5 -m weird: rc=$rc"

bash "$INSTALL" -t >"$TMP/out" 2>&1; rc=$?
[ "$rc" = 2 ] && ! grep -q "unbound variable" "$TMP/out" && ok "I-5 '-t' without value -> clean exit 2" || fail "I-5 -t without value: rc=$rc $(head -1 "$TMP/out")"

bash "$INSTALL" -h >"$TMP/out" 2>&1; rc=$?
[ "$rc" = 0 ] && grep -q "voice-assistant" "$TMP/out" && grep -q "ios" "$TMP/out" && ok "O9 --help exits 0 and lists every profile" || fail "O9 help: rc=$rc"

# ---------------------------------------------------------------- O8 -y picks the profile from the domain
P="$(newproj p_android)"; touch "$P/build.gradle.kts"
notty bash "$INSTALL" -t "$P" -y >"$TMP/out" 2>&1
grep -Eq "Profile: +android" "$TMP/out" && ok "O8 -y on a Gradle project selects the android profile" || fail "O8 -y profile: $(grep 'Profile:' "$TMP/out")"

# ---------------------------------------------------------------- I-6 copy mode for codex / cursor
for ag in codex cursor; do
  P="$(newproj "p_$ag")"
  bash "$INSTALL" -t "$P" -a "$ag" -p none -m copy >"$TMP/out" 2>&1
  [ -f "$P/AGENTS.md" ] && [ ! -L "$P/AGENTS.md" ] && ok "I-6 -a $ag -m copy writes a real AGENTS.md" || fail "I-6 $ag copy: AGENTS.md is a link or missing"
done

# ---------------------------------------------------------------- I-7 -a all -m copy on a fresh project
P="$(newproj p_all)"
for i in 1 2 3; do bash "$INSTALL" -t "$P" -a all -p none -m copy >"$TMP/out" 2>&1 || fail "I-7 run $i exited non-zero"; done
[ "$(count_old "$P")" = 0 ] && ok "I-7 -a all -m copy x3 on a fresh project: zero *_old" || { fail "I-7 created *_old:"; find "$P" -maxdepth 4 -name "*_old*"; }
grep -q "universal-agent-devkit:start" "$P/AGENTS.md" && fail "I-7 DevKit AGENTS.md copy got a block injected into itself" || ok "I-7 copied AGENTS.md not self-injected"

# ---------------------------------------------------------------- I-8 copy-mode upgrade
P="$(newproj p_upg)"
bash "$INSTALL" -t "$P" -a all -p none -m copy >"$TMP/out" 2>&1
echo "<!-- devkit v2 -->" >> "$DK/skills/fixbugs/SKILL.md"
echo "# devkit v2" >> "$DK/hooks/claim_check.sh"
echo "<!-- devkit v2 -->" >> "$DK/AGENTS.md"
bash "$INSTALL" -t "$P" -a all -p none -m copy >"$TMP/out" 2>&1
[ "$(count_old "$P")" = 0 ] && ok "I-8 upgrade of untouched copies creates no *_old" || { fail "I-8 upgrade created *_old:"; find "$P" -maxdepth 4 -name "*_old*"; }
grep -q "devkit v2" "$P/.claude/commands/fix.md" && grep -q "devkit v2" "$P/.claude/hooks/claim_check.sh" && grep -q "devkit v2" "$P/AGENTS.md" \
  && ok "I-8 upgrade delivered the new command, hook and AGENTS.md" || fail "I-8 upgrade did not update the copies"
echo "MY TEAM EDIT" >> "$P/.claude/commands/fix.md"
bash "$INSTALL" -t "$P" -a claude -p none -m copy >"$TMP/out" 2>&1
[ ! -e "$P/.claude/commands/fix_old.md" ] && grep -qs "MY TEAM EDIT" "$P/.claude/commands_old/fix.md" \
  && ok "I-8 edited command preserved in .claude/commands_old/ (no /fix_old slash command)" || { fail "I-8 edited command backup misplaced"; ls "$P/.claude/commands" | grep _old; }

# ---------------------------------------------------------------- O4 project's own commands/ dir
P="$(newproj p_cli)"; mkdir -p "$P/commands"; echo "module.exports = 1" > "$P/commands/build.js"
bash "$INSTALL" -t "$P" -a claude -p none >"$TMP/out" 2>&1; rc=$?
[ "$rc" = 0 ] && [ -f "$P/commands/build.js" ] && [ ! -L "$P/commands" ] && [ ! -e "$P/commands_old" ] \
  && ok "O4 project commands/build.js left in place, no commands_old" || fail "O4 commands/ was moved (rc=$rc)"
grep -q "belongs to your project" "$TMP/out" && ok "O4 installer warns it skipped commands/" || fail "O4 no warning printed"

# ---------------------------------------------------------------- L-6 / K-13 / O5 git projects
P="$(newproj p_git)"; mkdir "$P/.git"
bash "$INSTALL" -t "$P" -a claude -p none >"$TMP/out" 2>&1
bash "$INSTALL" -t "$P" -a claude -p none >/dev/null 2>&1
grep -qx '\*_old' "$P/.gitignore" && grep -qx '.claude/audit-gate/' "$P/.gitignore" && ok "L-6/K-13 .gitignore excludes *_old and .claude/audit-gate/" || fail "L-6 .gitignore missing entries"
[ "$(grep -c 'universal-agent-devkit:start' "$P/.gitignore")" = 1 ] && ok "L-6 .gitignore block written once on re-install" || fail "L-6 .gitignore block duplicated"
grep -q "ABSOLUTE links" "$TMP/out" && ok "O5 symlink mode in a git project warns about absolute links" || fail "O5 no absolute-link warning"

# ---------------------------------------------------------------- L-7 existing DESIGN.md
P="$(newproj p_design)"; echo "OUR DESIGN" > "$P/DESIGN.md"
bash "$INSTALL" -t "$P" -a claude -p none >"$TMP/out" 2>&1
[ ! -e "$P/DESIGN_old.md" ] && grep -qx "OUR DESIGN" "$P/DESIGN.md" && ok "L-7 existing DESIGN.md kept, no misleading DESIGN_old.md" || fail "L-7 DESIGN handling"

# ---------------------------------------------------------------- O10 installing never writes into the devkit
changed="$(find "$DK" ! -type d -newer "$MARK" ! -path '*/__pycache__/*' \
  ! -path "$DK/skills/fixbugs/SKILL.md" ! -path "$DK/hooks/claim_check.sh" ! -path "$DK/AGENTS.md" | head -5)"
[ -z "$changed" ] && ok "O10 no file inside the devkit was written by any install above" || { fail "O10 installer wrote into the devkit:"; echo "$changed"; }

# ---------------------------------------------------------------- M-19 two backups in the same second
# shellcheck disable=SC1090
( source "$DK/scripts/backup_conflict.sh"
  B="$TMP/bk"; mkdir -p "$B"; echo v0 > "$B/CLAUDE_old.md"
  echo v1 > "$B/CLAUDE.md"; backup_conflict "$B/CLAUDE.md" "" >/dev/null
  echo v2 > "$B/CLAUDE.md"; backup_conflict "$B/CLAUDE.md" "" >/dev/null
  for v in v0 v1 v2; do grep -lqx "$v" "$B"/CLAUDE_old* || exit 1; done
  mkdir -p "$B/skills_old" "$B/skills"; echo a > "$B/skills/a"; backup_conflict "$B/skills" "" >/dev/null
  mkdir -p "$B/skills"; echo b > "$B/skills/b"; backup_conflict "$B/skills" "" >/dev/null
  [ -z "$(find "$B" -path '*skills_old*/skills' -type d)" ] || exit 2
  [ "$(ls -d "$B"/skills_old* | wc -l | xargs)" = 3 ] || exit 3
) && ok "M-19 same-second backups keep every version, no nested dir" || fail "M-19 backup collision lost data (code $?)"

# ---------------------------------------------------------------- M-20 merge_markdown with backslashes
printf 'match \\d+ and \\1 literally\n' > "$TMP/blk.md"
echo "# Mine" > "$TMP/t.md"
python3 "$DK/scripts/merge_markdown.py" "$TMP/blk.md" "$TMP/t.md" >/dev/null 2>&1 \
  && python3 "$DK/scripts/merge_markdown.py" "$TMP/blk.md" "$TMP/t.md" >/dev/null 2>&1 \
  && grep -qF 'match \d+ and \1 literally' "$TMP/t.md" && [ "$(grep -c 'universal-agent-devkit:start' "$TMP/t.md")" = 1 ] \
  && ok "M-20 block with \\d / \\1 merges and re-merges without crashing" || fail "M-20 merge_markdown backslash block"

# ---------------------------------------------------------------- M-24 sync never deletes a hand-written command
rm -f "$DK/commands/test.md"; echo "HANDWRITTEN" > "$DK/commands/test.md"
cp "$DK/skills/qc/SKILL.md" "$TMP/qc.before"
bash "$DK/scripts/sync_commands.sh" >/dev/null 2>&1
[ ! -L "$DK/commands/test.md" ] && grep -qx HANDWRITTEN "$DK/commands/test.md" && cmp -s "$DK/skills/qc/SKILL.md" "$TMP/qc.before" \
  && ok "M-24 sync keeps a hand-written command and never writes through into SKILL.md" || fail "M-24 hand-written command replaced"

if [ "$FAILS" -ne 0 ]; then echo "install cli: $FAILS FAILED"; exit 1; fi
echo "install cli: all checks passed"
