#!/usr/bin/env bash
# sync_commands.sh — Populate commands/ from skills/ with canonical links and aliases
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
SKILLS_DIR="$ROOT_DIR/skills"
COMMANDS_DIR="$ROOT_DIR/commands"

mkdir -p "$COMMANDS_DIR"

# 1. Link each canonical skill
for skill_dir in "$SKILLS_DIR"/*; do
  [ -d "$skill_dir" ] || continue
  skill_name="$(basename "$skill_dir")"
  if [ -f "$skill_dir/SKILL.md" ]; then
    if [ -e "$COMMANDS_DIR/${skill_name}.md" ] && [ ! -L "$COMMANDS_DIR/${skill_name}.md" ]; then
      echo "⚠ commands/${skill_name}.md is a hand-written command — left untouched." >&2
      continue
    fi
    ln -sfn "../skills/${skill_name}/SKILL.md" "$COMMANDS_DIR/${skill_name}.md"
  fi
done

# 2. Setup Aliases
ALIASES=(
  "test:qc"
  "qa:qc"
  "bugs:fixbugs"
  "fix:fixbugs"
  "build:deploy"
  "plan:spec-driven-development"
  "scan:security-checklist"
  "tdd:tdd-workflow"
  "verify:verification-before-completion"
  "conflict:merge-conflict-resolver"
  "handoff:session-handoff"
  "crashlytics:fixbugs"
  "graph:codebase-memory"
  "review:qa-review"
  "visual:qa-visual"
  "ocr:open-code-review"
  "recomp-audit:compose-recomp-audit"
  "gc-audit:unity-gc-audit"
)

# Clean broken symlinks in commands/
find "$COMMANDS_DIR" -type l ! -exec test -e {} \; -delete

for mapping in "${ALIASES[@]}"; do
  alias_name="${mapping%%:*}"
  target_skill="${mapping##*:}"
  alias_path="$COMMANDS_DIR/${alias_name}.md"
  if [ -f "$SKILLS_DIR/$target_skill/SKILL.md" ]; then
    # Only (re)point our own links. A hand-written command with the alias name is
    # never deleted — and never written through (the links resolve into SKILL.md).
    if [ -e "$alias_path" ] && [ ! -L "$alias_path" ]; then
      echo "⚠ commands/${alias_name}.md is a hand-written command — alias /${alias_name} -> ${target_skill} NOT created." >&2
      continue
    fi
    ln -sfn "../skills/${target_skill}/SKILL.md" "$alias_path"
  fi
done

# If .claude/commands exists, synchronize commands there as well
CLAUDE_COMMANDS="$ROOT_DIR/.claude/commands"
if [ -d "$CLAUDE_COMMANDS" ]; then
  for cmd_file in "$COMMANDS_DIR"/*; do
    [ -e "$cmd_file" ] || continue
    cmd_name="$(basename "$cmd_file")"
    if [ -e "$CLAUDE_COMMANDS/$cmd_name" ] && [ ! -L "$CLAUDE_COMMANDS/$cmd_name" ]; then
      echo "⚠ .claude/commands/$cmd_name is a hand-written command — left untouched." >&2
      continue
    fi
    ln -sfn "../../commands/$cmd_name" "$CLAUDE_COMMANDS/$cmd_name"
  done
  find "$CLAUDE_COMMANDS" -type l ! -exec test -e {} \; -delete 2>/dev/null || true
fi

echo "Commands synchronized successfully in $COMMANDS_DIR ($(ls -1 "$COMMANDS_DIR" | wc -l | xargs) commands created)."
