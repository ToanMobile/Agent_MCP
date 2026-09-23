#!/usr/bin/env bash
# setup_gemini.sh — Configure Antigravity & Google Gemini integration (Non-Destructive Smart Merge)
set -euo pipefail

TARGET_DIR="${1:-$PWD}"
TARGET_DIR="$(cd "$TARGET_DIR" 2>/dev/null && pwd -P || echo "$TARGET_DIR")"
DEVKIT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
MODE="${2:-symlink}" # symlink or copy
LANGUAGE="${3:-en}"
SKIP_EXISTING="${SKIP_EXISTING:-0}"

source "$DEVKIT_ROOT/scripts/backup_conflict.sh"

echo "Configuring Antigravity / Google Gemini for: $TARGET_DIR (mode: $MODE, lang: $LANGUAGE, skip_existing: $SKIP_EXISTING)"

mkdir -p "$TARGET_DIR/.agents/skills"

# 1. Non-Destructive Smart Merge for AGENTS.md, GEMINI.md, and Agent.md
if [ "$TARGET_DIR" != "$DEVKIT_ROOT" ]; then
  if [ -f "$TARGET_DIR/GEMINI.md" ] && [ ! -f "$TARGET_DIR/GEMINI_old.md" ] && ! grep -q "universal-agent-devkit" "$TARGET_DIR/GEMINI.md" 2>/dev/null; then
    cp "$TARGET_DIR/GEMINI.md" "$TARGET_DIR/GEMINI_old.md"
  fi
  if [ -f "$TARGET_DIR/Agent.md" ] && [ ! -f "$TARGET_DIR/Agent_old.md" ] && ! grep -q "universal-agent-devkit" "$TARGET_DIR/Agent.md" 2>/dev/null; then
    cp "$TARGET_DIR/Agent.md" "$TARGET_DIR/Agent_old.md"
  fi
fi

if [ -f "$TARGET_DIR/GEMINI.md" ] || [ -f "$TARGET_DIR/Agent.md" ]; then
  GEMINI_TARGET="${TARGET_DIR}/GEMINI.md"
  [ -f "$TARGET_DIR/Agent.md" ] && GEMINI_TARGET="${TARGET_DIR}/Agent.md"
  GEMINI_INJECT="$DEVKIT_ROOT/templates/claude_injection_block.md"
  python3 "$DEVKIT_ROOT/scripts/merge_markdown.py" "$GEMINI_INJECT" "$GEMINI_TARGET" "universal-agent-devkit"
fi

# AGENTS.md: shared logic (devkit link/copy vs the project's own file) — see backup_conflict.sh
devkit_install_agents_md "$TARGET_DIR" "$MODE"

# 2. Additive Merge for mcp_config.json
# merge_json.py backs up mcp_config.json itself (as mcp_config_old.json) only when the merge changes it.
python3 "$DEVKIT_ROOT/scripts/merge_json.py" "$DEVKIT_ROOT/mcp/mcp_config.json" "$TARGET_DIR/mcp_config.json"
echo "  - Merged MCP servers into mcp_config.json (preserved existing custom MCPs)"

# 3. Smart Item-by-Item Link for Skills (Preserving custom user skills)
for skill in "$DEVKIT_ROOT/skills"/*; do
  [ -e "$skill" ] || continue
  skill_name="$(basename "$skill")"
  target_skill_path="$TARGET_DIR/.agents/skills/$skill_name"
  if [ "$SKIP_EXISTING" = "1" ] && [ -e "$target_skill_path" ] && [ ! -L "$target_skill_path" ]; then
    echo "  - Preserved custom skill: $skill_name (--skip-existing active)"
    continue
  fi
  devkit_place "$skill" "$target_skill_path" "$MODE"
done

# Clean broken symlinks if any
find "$TARGET_DIR/.agents/skills" -type l ! -exec test -e {} \; -delete 2>/dev/null || true

echo "✓ Antigravity & Google Gemini (.agents/skills, AGENTS.md, mcp_config.json) ready."
