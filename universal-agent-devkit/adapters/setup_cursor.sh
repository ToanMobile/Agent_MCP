#!/usr/bin/env bash
# setup_cursor.sh — Configure Cursor IDE (Non-Destructive Smart Merge)
set -euo pipefail

TARGET_DIR="${1:-$PWD}"
TARGET_DIR="$(cd "$TARGET_DIR" 2>/dev/null && pwd -P || echo "$TARGET_DIR")"
DEVKIT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
MODE="${2:-symlink}" # symlink or copy
LANGUAGE="${3:-en}"
DOMAIN="${4:-general}"

case "$MODE" in symlink|copy) ;; *) echo "$(basename "$0"): invalid mode '$MODE' (symlink | copy)" >&2; exit 2 ;; esac

source "$DEVKIT_ROOT/scripts/backup_conflict.sh"

echo "Configuring Cursor IDE for: $TARGET_DIR (mode: $MODE, domain: $DOMAIN, lang: $LANGUAGE)"

# 1. Non-Destructive Smart Merge for .cursorrules and AGENTS.md
if [ "$TARGET_DIR" != "$DEVKIT_ROOT" ] && [ -f "$TARGET_DIR/.cursorrules" ] && [ ! -f "$TARGET_DIR/.cursorrules_old" ] \
   && ! grep -q "universal-agent-devkit" "$TARGET_DIR/.cursorrules" 2>/dev/null; then
  cp "$TARGET_DIR/.cursorrules" "$TARGET_DIR/.cursorrules_old"
  echo "  - Preserved original .cursorrules as .cursorrules_old"
fi

if [ -f "$TARGET_DIR/.cursorrules" ]; then
  CURSOR_INJECT="$DEVKIT_ROOT/templates/claude_injection_block.md"
  python3 "$DEVKIT_ROOT/scripts/merge_markdown.py" "$CURSOR_INJECT" "$TARGET_DIR/.cursorrules" "universal-agent-devkit"
fi

# AGENTS.md: shared logic (devkit link/copy vs the project's own file) — see backup_conflict.sh
devkit_install_agents_md "$TARGET_DIR" "$MODE"

echo "✓ Cursor IDE (AGENTS.md SSOT) ready."
