#!/usr/bin/env bash
# setup_claude.sh — Configure Claude Code integration in target project (Non-Destructive Smart Merge)
set -euo pipefail

TARGET_DIR="${1:-$PWD}"
TARGET_DIR="$(cd "$TARGET_DIR" 2>/dev/null && pwd -P || echo "$TARGET_DIR")"
DEVKIT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
MODE="${2:-symlink}" # symlink or copy
LANGUAGE="${3:-en}"
SKIP_EXISTING="${SKIP_EXISTING:-0}"

source "$DEVKIT_ROOT/scripts/backup_conflict.sh"

echo "Configuring Claude Code for: $TARGET_DIR (mode: $MODE, lang: $LANGUAGE, skip_existing: $SKIP_EXISTING)"

mkdir -p "$TARGET_DIR/.claude/hooks" "$TARGET_DIR/.claude/commands" "$TARGET_DIR/.claude/agents"

# 1. Non-Destructive Smart Merge for CLAUDE.md and AGENTS.md
if [ "$TARGET_DIR" != "$DEVKIT_ROOT" ] && [ -f "$TARGET_DIR/CLAUDE.md" ] && [ ! -L "$TARGET_DIR/CLAUDE.md" ]; then
  if ! grep -q "universal-agent-devkit" "$TARGET_DIR/CLAUDE.md" 2>/dev/null && [ ! -f "$TARGET_DIR/CLAUDE_old.md" ]; then
    cp "$TARGET_DIR/CLAUDE.md" "$TARGET_DIR/CLAUDE_old.md"
    echo "  - Preserved original CLAUDE.md as CLAUDE_old.md"
  fi
fi

CLAUDE_INJECT="$DEVKIT_ROOT/templates/claude_injection_block.md"
python3 "$DEVKIT_ROOT/scripts/merge_markdown.py" "$CLAUDE_INJECT" "$TARGET_DIR/CLAUDE.md" "universal-agent-devkit"

# AGENTS.md: shared logic (devkit link/copy vs the project's own file) — see backup_conflict.sh
devkit_install_agents_md "$TARGET_DIR" "$MODE"

# 2. Additive Merge for .mcp.json
# merge_json.py backs up the file itself (as .mcp_old.json) only when the merge changes it.
python3 "$DEVKIT_ROOT/scripts/merge_json.py" "$DEVKIT_ROOT/mcp/.mcp.json" "$TARGET_DIR/.mcp.json"
echo "  - Merged MCP servers into .mcp.json (preserved existing custom MCPs)"

# 3. Additive Merge for .claude/settings.json
# Settings template = static base (permissions, env) from templates/claude_settings.json
# + hooks generated from hooks/hooks.json, the single source of truth also used by the
# plugin. Built in a temp file: installing must never rewrite files inside the devkit.
DEFAULT_SETTINGS="$(mktemp "${TMPDIR:-/tmp}/devkit-settings.XXXXXX")"
trap 'rm -f "$DEFAULT_SETTINGS"' EXIT
python3 - "$DEVKIT_ROOT/templates/claude_settings.json" "$DEVKIT_ROOT/hooks/hooks.json" > "$DEFAULT_SETTINGS" <<'PY'
import json, sys
base = json.load(open(sys.argv[1], encoding="utf-8"))
plugin = json.load(open(sys.argv[2], encoding="utf-8"))
hooks = json.dumps(plugin.get("hooks", plugin))
hooks = hooks.replace("${CLAUDE_PLUGIN_ROOT}/hooks/", "${CLAUDE_PROJECT_DIR:-$PWD}/.claude/hooks/")
base["hooks"] = json.loads(hooks)
print(json.dumps(base, indent=2, ensure_ascii=False))
PY

# merge_json.py backs up settings.json itself (as settings_old.json) only when the merge changes it.

python3 "$DEVKIT_ROOT/scripts/merge_json.py" "$DEFAULT_SETTINGS" "$TARGET_DIR/.claude/settings.json"
echo "  - Merged safety gates into .claude/settings.json (preserved custom settings)"

# 4. Smart Item-by-Item Link for Hooks (Preserving custom user hooks)
for hook in "$DEVKIT_ROOT/hooks"/*; do
  [ -e "$hook" ] || continue
  hook_name="$(basename "$hook")"
  target_hook="$TARGET_DIR/.claude/hooks/$hook_name"
  if [ "$SKIP_EXISTING" = "1" ] && [ -e "$target_hook" ] && [ ! -L "$target_hook" ]; then
    echo "  - Preserved custom hook: $hook_name (--skip-existing active)"
    continue
  fi
  devkit_place "$hook" "$target_hook" "$MODE"
done

# 5. Smart Item-by-Item Link for Commands (Preserving custom user commands)
for cmd in "$DEVKIT_ROOT/commands"/*; do
  [ -e "$cmd" ] || continue
  cmd_name="$(basename "$cmd")"
  target_cmd="$TARGET_DIR/.claude/commands/$cmd_name"
  if ! devkit_command_allowed "$cmd"; then
    devkit_remove_filtered "$target_cmd"  # skill not part of the active profile
    continue
  fi
  if [ "$SKIP_EXISTING" = "1" ] && [ -e "$target_cmd" ] && [ ! -L "$target_cmd" ]; then
    echo "  - Preserved custom command: $cmd_name (--skip-existing active)"
    continue
  fi
  devkit_place "$cmd" "$target_cmd" "$MODE"
done

# 6. Smart Item-by-Item Link for Agents (Preserving custom user subagents)
for agent in "$DEVKIT_ROOT/agents"/*; do
  [ -e "$agent" ] || continue
  agent_name="$(basename "$agent")"
  target_agent="$TARGET_DIR/.claude/agents/$agent_name"
  if [ "$SKIP_EXISTING" = "1" ] && [ -e "$target_agent" ] && [ ! -L "$target_agent" ]; then
    echo "  - Preserved custom agent: $agent_name (--skip-existing active)"
    continue
  fi
  devkit_place "$agent" "$target_agent" "$MODE"
done

# Clean broken symlinks if any
find "$TARGET_DIR/.claude/hooks" "$TARGET_DIR/.claude/commands" "$TARGET_DIR/.claude/agents" -type l ! -exec test -e {} \; -delete 2>/dev/null || true

echo "✓ Claude Code integration complete (Non-destructive smart merge; custom files preserved)."
