#!/usr/bin/env bash
# Regression test: the installer must never modify the DevKit itself when the
# project reaches it through a symlink. Runs against a throwaway COPY of the devkit.
#   1. project/.claude/commands is a symlink into DEVKIT/commands
#   2. the target is a symlinked alias of the devkit (or /tmp vs /private/tmp)
set -u

SRC_DEVKIT="$(cd "$(dirname "$0")/.." && pwd -P)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
FAILS=0
ok()   { echo "✔ $1"; }
fail() { echo "✖ $1"; FAILS=$((FAILS + 1)); }

DK="$TMP/dk"
mkdir -p "$DK"
(cd "$SRC_DEVKIT" && tar --exclude=./node_modules --exclude=./.git -cf - .) | (cd "$DK" && tar -xf -)
snapshot() { (cd "$DK" && find rules skills commands -maxdepth 1 | LC_ALL=C sort; find commands -type f | wc -l | xargs) ; }
before="$(snapshot)"

# 1. Symlinked project subdir pointing into the devkit.
mkdir -p "$TMP/p1/.claude"
ln -s "$DK/commands" "$TMP/p1/.claude/commands"
bash "$DK/bin/install.sh" -t "$TMP/p1" -y -p universal -m symlink >/dev/null 2>&1
[ $? -ne 0 ] && ok "install refuses a project dir symlinked into the devkit" || fail "install succeeded through a symlink into the devkit"
[ "$(snapshot)" = "$before" ] && ok "devkit commands/skills/rules untouched (case 1)" || fail "devkit modified through symlinked project dir"
loops="$(find "$DK/commands" -type l ! -exec test -e {} \; -print | wc -l | xargs)"
[ "$loops" = 0 ] && ok "no self-referencing links in devkit commands/" || fail "$loops broken/self links in devkit commands/"

# 2. Target is a symlinked alias of the devkit.
ln -s "$DK" "$TMP/alias"
bash "$DK/bin/install.sh" -t "$TMP/alias" -y -p universal -m symlink >/dev/null 2>&1
[ "$(snapshot)" = "$before" ] && ok "installing into an alias of the devkit leaves it intact" || fail "alias install modified the devkit"
ls -d "$DK"/*_old* >/dev/null 2>&1 && fail "alias install created *_old inside the devkit" || ok "no *_old created inside the devkit"

if [ "$FAILS" -ne 0 ]; then echo "install safety: $FAILS FAILED"; exit 1; fi
echo "install safety: all checks passed"
