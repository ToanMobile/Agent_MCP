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
  "fix:fixbugs"
  "build:deploy"
  "plan:spec-driven-development"
  "scan:security-checklist"
  "tdd:tdd-workflow"
  "verify:verification-before-completion"
  "conflict:merge-conflict-resolver"
  "handoff:session-handoff"
  "graph:codebase-memory"
  "visual:qa-visual"
  "ocr:open-code-review"
  "recomp-audit:compose-recomp-audit"
  "gc-audit:unity-gc-audit"
  "adr:documentation-and-adrs"
  "android-qa:android-real-device-qa"
  "deprecate:deprecation-migration"
  "enrich:context-enricher"
  "grill:grill-plan"
  "logging:observability-instrumentation"
  "module-design:deep-module-design"
  "skill-author:writing-skills"
  "step:incremental-implementation"
  # QA ladder (1.1.0): plan-tests -> review-code -> check -> done (+ /audit-gate)
  "plan-tests:qa-review"
  "review-code:open-code-review"
  "check:qc"
  "done:verification-before-completion"
)

# Deprecated aliases (1.1.0), kept ONE release as stub commands that point to the new name,
# then removed in 1.2.0. /review collided with the agent's built-in /review; the others
# duplicated an existing alias of the same skill. Format: "old:new-command:skill".
DEPRECATED_ALIASES=(
  "review:plan-tests:qa-review"
  "qa:check:qc"
  "test:check:qc"
  "bugs:fix:fixbugs"
  "crashlytics:fix:fixbugs"
)
DEPRECATED_MARKER="<!-- devkit:deprecated-alias -->"

# Aliases of hand-written commands (commands/<target>.md, not a skill).
COMMAND_ALIASES=(
  "postfix-gate:audit-gate"
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

for mapping in "${COMMAND_ALIASES[@]}"; do
  alias_name="${mapping%%:*}"
  target_cmd="${mapping##*:}"
  alias_path="$COMMANDS_DIR/${alias_name}.md"
  [ -f "$COMMANDS_DIR/${target_cmd}.md" ] || continue
  if [ -e "$alias_path" ] && [ ! -L "$alias_path" ]; then
    echo "⚠ commands/${alias_name}.md is a hand-written command — alias /${alias_name} -> /${target_cmd} NOT created." >&2
    continue
  fi
  ln -sfn "${target_cmd}.md" "$alias_path"
done

for mapping in "${DEPRECATED_ALIASES[@]}"; do
  old_name="${mapping%%:*}"
  rest="${mapping#*:}"
  new_name="${rest%%:*}"
  target_skill="${rest##*:}"
  stub_path="$COMMANDS_DIR/${old_name}.md"
  [ -f "$SKILLS_DIR/$target_skill/SKILL.md" ] || continue
  if [ -e "$stub_path" ] && [ ! -L "$stub_path" ] && ! grep -qF "$DEPRECATED_MARKER" "$stub_path"; then
    echo "⚠ commands/${old_name}.md is a hand-written command — deprecated stub /${old_name} NOT written." >&2
    continue
  fi
  rm -f "$stub_path"
  cat > "$stub_path" <<EOF
---
description: "Deprecated alias: /${old_name} was renamed to /${new_name} (skill ${target_skill}); removed in DevKit 1.2.0."
---
${DEPRECATED_MARKER}
# /${old_name} → /${new_name}

\`/${old_name}\` is a deprecated DevKit alias. Use \`/${new_name}\` (skill \`${target_skill}\`) from now on.

Run the \`${target_skill}\` skill now: read \`skills/${target_skill}/SKILL.md\` (in an installed
project: \`.agents/skills/${target_skill}/SKILL.md\`) and follow it for: \$ARGUMENTS

Tell the user once, in one line, that \`/${old_name}\` is deprecated and \`/${new_name}\` replaces it.
EOF
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
