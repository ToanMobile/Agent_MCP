#!/usr/bin/env bash
# Regression test: re-running the installer and switching symlink <-> copy mode
# must be idempotent — no nested rules/rules, no writes into the devkit through a
# symlink, no dangling copied links, and no new *_old backups for devkit-owned files.
set -u

DEVKIT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PROJ="$(mktemp -d -t devkit-idem-XXXXXX)"
trap 'rm -rf "$PROJ"' EXIT
FAILS=0
ok()   { echo "✔ $1"; }
fail() { echo "✖ $1"; FAILS=$((FAILS + 1)); }

install() { bash "$DEVKIT_ROOT/bin/install.sh" -t "$PROJ" -y -p universal -m "$1" >/dev/null 2>&1 || fail "install -m $1 exited non-zero"; }
count_old() { find "$PROJ" -maxdepth 4 \( -name "*_old" -o -name "*_old.*" -o -name "*_old_*" \) | wc -l | xargs; }
devkit_snapshot() { ls -A "$DEVKIT_ROOT/rules" "$DEVKIT_ROOT/skills" "$DEVKIT_ROOT/commands"; }

before="$(devkit_snapshot)"

install symlink
install symlink
[ "$(count_old)" = 0 ] && ok "symlink re-install creates no *_old" || fail "symlink re-install created *_old: $(count_old)"

install copy
[ -d "$PROJ/rules" ] && [ ! -L "$PROJ/rules" ] && ok "switch to copy replaces the rules link with a real dir" || fail "rules is not a real dir after copy install"
[ -e "$DEVKIT_ROOT/rules/rules" ] && fail "copy install wrote rules/rules INTO the devkit" || ok "devkit rules/ untouched by copy install"
dangling="$(find "$PROJ/rules" "$PROJ/skills" "$PROJ/commands" -type l ! -exec test -e {} \; -print | wc -l | xargs)"
[ "$dangling" = 0 ] && ok "copied tree has no dangling links" || fail "copied tree has $dangling dangling links"

install copy
install copy
[ "$(count_old)" = 0 ] && ok "copy re-installs create no *_old" || { fail "copy re-install created *_old:"; find "$PROJ" -maxdepth 4 -name "*_old*"; }

install symlink
[ -L "$PROJ/rules" ] && [ ! -e "$PROJ/rules/rules" ] && ok "switch back to symlink leaves no nested rules/rules" || fail "rules not a clean link after switching back"

# A user edit to a copied file must be preserved as *_old, not silently overwritten.
install copy
echo "TEAM EDIT" >> "$PROJ/rules/core-rules.md"
install copy
if grep -rqs "TEAM EDIT" "$PROJ"/rules_old*; then ok "user-edited copy preserved as rules_old*"; else fail "user edit lost"; fi

# An empty real rules/ dir must be replaced, not have the link nested inside it.
rm -rf "$PROJ/rules" "$PROJ"/rules_old* && mkdir "$PROJ/rules"
install symlink
[ -L "$PROJ/rules" ] && ok "empty rules/ dir replaced by link" || fail "empty rules/ dir got a nested link"

[ "$(devkit_snapshot)" = "$before" ] && ok "devkit rules/skills/commands listing unchanged" || fail "devkit tree changed during install runs"

if [ "$FAILS" -ne 0 ]; then echo "install idempotency: $FAILS FAILED"; exit 1; fi
echo "install idempotency: all checks passed"
