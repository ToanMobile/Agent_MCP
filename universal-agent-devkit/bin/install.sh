#!/usr/bin/env bash
# install.sh — Universal Multi-Agent & Multi-Model DevKit Installer
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEVKIT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd -P)"

TARGET_DIR="$PWD"
DOMAIN="auto"
AGENTS="ask"
PROFILE="ask"
MODE="symlink"
LANGUAGE=""   # output language; resolved below: --lang > $DEVKIT_LANG > project .active-profile.json > vi
ASSUME_YES=0

PROFILES_AVAILABLE="$(cd "$DEVKIT_ROOT/profiles" && for d in */; do [ -f "$d/profile.json" ] && printf '%s ' "${d%/}"; done)"
PROFILES_AVAILABLE="${PROFILES_AVAILABLE% }"

show_help() {
  cat << HELP_EOF
Universal Multi-Agent & Multi-Model DevKit Installer

Supports 4 core coding agents & LLMs:
  - Claude Code (Anthropic)
  - OpenAI Codex / ChatGPT Canvas
  - Google Antigravity & Gemini CLI
  - Cursor IDE

Usage:
  ./install.sh [OPTIONS]

Options:
  -t, --target <path>     Target project directory (default: current directory)
  -d, --domain <name>     Project domain: auto | android | ios | web | backend | general (default: auto)
  -p, --profile <name>    Domain profile: ${PROFILES_AVAILABLE// / | } | none
                          (default: ask; with -y: detected from the domain)
  -a, --agents <list>     Comma-separated agents or 'all'
                          Supported: claude, codex, gemini, cursor, all
  -m, --mode <mode>       Install mode: symlink | copy (default: symlink)
                          symlink = absolute links into this DevKit checkout (single machine);
                          copy    = real files (use this if the project is committed for a team/CI)
  -l, --lang <code>       Output language of the installer, profile and gate: en | vi
                          (default: \$DEVKIT_LANG, then the project's saved language, then vi)
  -s, --skip-existing     Keep project hooks/commands/agents/skills that share a DevKit name
  -y, --yes               Non-interactive: all agents, profile from the detected domain
  -h, --help              Show this help message

Examples:
  # Interactive setup (choose agents from list):
  ./install.sh

  # Quick zero-config setup for ALL agents:
  ./install.sh -y

  # Setup specifically for Cursor and Claude only:
  ./install.sh -t /path/to/my-project -a claude,cursor
HELP_EOF
}

die_usage() { # <message> — invalid CLI usage: explain and exit 2 without touching anything
  echo "install.sh: $1" >&2
  echo "Run './install.sh --help' for usage." >&2
  exit 2
}

need_value() { # <flag> <remaining-argc> — option given without its value
  [ "$2" -ge 2 ] || die_usage "option '$1' requires a value"
}

# normalize_profile <name> — canonical profile dir name, "none", or "" when unknown
normalize_profile() {
  local p
  p="$(printf '%s' "$1" | tr '[:upper:]' '[:lower:]' | xargs)"
  case "$p" in
    1|automotive|car|xehoi) p="automotive" ;;
    2|android|mobile) p="android" ;;
    3|game|unity|blender) p="game" ;;
    4|universal|general|default) p="universal" ;;
    5|voice|voice-assistant|audio) p="voice-assistant" ;;
    6|ios|swift|swiftui|apple) p="ios" ;;
    7|web|frontend|react|nextjs) p="web" ;;
    8|backend|server|api) p="backend" ;;
    none|ask|auto) printf '%s' "$p"; return 0 ;;
  esac
  if [ -f "$DEVKIT_ROOT/profiles/$p/profile.json" ]; then printf '%s' "$p"; else printf ''; fi
}

while [[ $# -gt 0 ]]; do
  case $1 in
    -t|--target)
      need_value "$1" $#; TARGET_DIR="$2"; shift 2 ;;
    --target=*)
      TARGET_DIR="${1#*=}"; shift ;;
    -d|--domain)
      need_value "$1" $#; DOMAIN="$2"; shift 2 ;;
    --domain=*)
      DOMAIN="${1#*=}"; shift ;;
    -p|--profile)
      need_value "$1" $#; PROFILE="$2"; shift 2 ;;
    --profile=*)
      PROFILE="${1#*=}"; shift ;;
    -a|--agents)
      need_value "$1" $#; AGENTS="$2"; shift 2 ;;
    --agents=*)
      AGENTS="${1#*=}"; shift ;;
    -m|--mode)
      need_value "$1" $#; MODE="$2"; shift 2 ;;
    --mode=*)
      MODE="${1#*=}"; shift ;;
    -l|--lang|--language)
      need_value "$1" $#; LANGUAGE="$2"; shift 2 ;;
    --lang=*|--language=*)
      LANGUAGE="${1#*=}"; shift ;;
    -s|--skip-existing)
      SKIP_EXISTING=1; shift ;;
    -y|--yes)
      ASSUME_YES=1; shift ;;
    -h|--help)
      show_help; exit 0 ;;
    *)
      die_usage "unknown option: $1" ;;
  esac
done

# Validate everything BEFORE the first write to the project.
case "$MODE" in symlink|copy) ;; *) die_usage "invalid --mode '$MODE' (expected: symlink | copy)" ;; esac
case "$LANGUAGE" in ""|en|vi) ;; *) die_usage "invalid --lang '$LANGUAGE' (expected: en | vi)" ;; esac
case "$DOMAIN" in auto|android|ios|web|backend|general) ;; *) die_usage "invalid --domain '$DOMAIN' (expected: auto | android | ios | web | backend | general)" ;; esac
if [ "$PROFILE" != "ask" ]; then
  norm="$(normalize_profile "$PROFILE")"
  [ -n "$norm" ] || die_usage "unknown profile '$PROFILE' (available: $PROFILES_AVAILABLE | none)"
  PROFILE="$norm"
fi
if [ "$ASSUME_YES" = 1 ]; then
  [ "$AGENTS" = "ask" ] && AGENTS="all"
  [ "$PROFILE" = "ask" ] && PROFILE="auto"
fi
[ -d "$TARGET_DIR" ] || die_usage "target directory does not exist: $TARGET_DIR"

TARGET_DIR="$(cd "$TARGET_DIR" && pwd -P)"

# Output language, shared with every adapter / agent-config / gate run from here.
source "$DEVKIT_ROOT/scripts/i18n.sh"
DEVKIT_LANG="$(devkit_resolve_lang "$LANGUAGE" "$TARGET_DIR")"
export DEVKIT_LANG
LANGUAGE="$DEVKIT_LANG"

# Interactive Agent Selection Menu if not specified via CLI
if [ "$AGENTS" = "ask" ]; then
  echo "================================================================="
  echo "  🤖 Universal AI Agent DevKit — $(L "Bước 1/2: Chọn AI Coding Tools" "Step 1/2: choose AI coding tools")"
  echo "================================================================="
  echo "  [1] 🤖 Claude Code          (AGENTS.md, .claude/commands/, hooks, .mcp.json)"
  echo "  [2] 🧠 OpenAI Codex         (AGENTS.md SSOT)"
  echo "  [3] ✨ Google Gemini / AGY  (AGENTS.md, .agents/skills, mcp_config.json)"
  echo "  [4] ⚡ Cursor IDE           (AGENTS.md SSOT)"
  echo "  [A] 🌟 All Agents           ($(L "Cấu hình toàn bộ 4 nền tảng" "configure all 4 tools"))"
  echo "-----------------------------------------------------------------"
  user_choice="A"
  if [ -t 0 ]; then
    read -r -p "$(L "Chọn AI Tools (ví dụ: 1,2 hoặc A cho tất cả)" "Choose AI tools (e.g. 1,2 or A for all)") [Default: A]: " input_choice || input_choice=""
    user_choice="${input_choice:-A}"
  elif (exec 3</dev/tty) 2>/dev/null; then
    read -r -p "$(L "Chọn AI Tools (ví dụ: 1,2 hoặc A cho tất cả)" "Choose AI tools (e.g. 1,2 or A for all)") [Default: A]: " input_choice < /dev/tty || input_choice=""
    user_choice="${input_choice:-A}"
  fi

  if [[ "$user_choice" =~ ^[aA]$ ]] || [ "$user_choice" = "all" ]; then
    AGENTS="all"
  else
    selected_agents=()
    IFS=',' read -ra CHOICES <<< "$user_choice"
    for c in "${CHOICES[@]}"; do
      c_trim="$(echo "$c" | xargs)"
      case "$c_trim" in
        1|claude) selected_agents+=("claude") ;;
        2|codex|chatgpt|openai) selected_agents+=("codex") ;;
        3|gemini|antigravity) selected_agents+=("gemini") ;;
        4|cursor) selected_agents+=("cursor") ;;
      esac
    done
    if [ ${#selected_agents[@]} -eq 0 ]; then
      AGENTS="all"
    else
      AGENTS="$(IFS=','; echo "${selected_agents[*]}")"
    fi
  fi
fi

# Interactive Project Profile Selection Menu if not specified via CLI
if [ "$PROFILE" = "ask" ]; then
  echo
  echo "================================================================="
  echo "  🎯 Universal AI Agent DevKit — $(L "Bước 2/2: Chọn Profile Dự Án" "Step 2/2: choose the project profile")"
  echo "================================================================="
  echo "  [1] 🚗 $(L "Xe hơi" "Automotive") (Automotive: AAOS / IVI / Flyme Auto / CAN bus)"
  echo "  [2] 📱 Android (Mobile App / Jetpack Compose / Clean Arch)"
  echo "  [3] 🎮 Game (Unity 6 / Blender 3D / Shaders & Assets)"
  echo "  [4] 🌐 Universal / General ($(L "Mặc định đa nền tảng" "default, any stack"))"
  echo "  [5] 🎙️ $(L "Trợ lý Giọng nói" "Voice Assistant") (Voice Assistant: Edge AI / Audio / AEC / VAD)"
  echo "  [6] 🍏 iOS (Swift 6 / SwiftUI / Swift Concurrency / XCTest)"
  echo "  [7] 🕸️ Web (Frontend / Full-Stack JS / TypeScript)"
  echo "  [8] 🗄️ Backend (API / Services / Python · Go · Rust · Node)"
  echo "-----------------------------------------------------------------"
  user_profile="4"
  if [ -t 0 ]; then
    read -r -p "$(L "Chọn Profile dự án (1=Xe hơi, 2=Android, 3=Game, 4=Universal, 5=Voice, 6=iOS, 7=Web, 8=Backend)" "Choose the project profile (1=Automotive, 2=Android, 3=Game, 4=Universal, 5=Voice, 6=iOS, 7=Web, 8=Backend)") [Default: 4]: " input_prof || input_prof=""
    user_profile="${input_prof:-4}"
  elif (exec 3</dev/tty) 2>/dev/null; then
    read -r -p "$(L "Chọn Profile dự án (1=Xe hơi, 2=Android, 3=Game, 4=Universal, 5=Voice, 6=iOS, 7=Web, 8=Backend)" "Choose the project profile (1=Automotive, 2=Android, 3=Game, 4=Universal, 5=Voice, 6=iOS, 7=Web, 8=Backend)") [Default: 4]: " input_prof < /dev/tty || input_prof=""
    user_profile="${input_prof:-4}"
  fi

  PROFILE="$(normalize_profile "$user_profile")"
  case "$PROFILE" in ""|ask|auto) PROFILE="universal" ;; esac
fi

# Smart Auto-Detection of Project Domain
if [ "$DOMAIN" = "auto" ]; then
  if [ -f "$TARGET_DIR/build.gradle" ] || [ -f "$TARGET_DIR/build.gradle.kts" ] || [ -f "$TARGET_DIR/settings.gradle" ] || [ -f "$TARGET_DIR/settings.gradle.kts" ] || [ -f "$TARGET_DIR/AndroidManifest.xml" ]; then
    DOMAIN="android"
  elif [ -f "$TARGET_DIR/Package.swift" ] || compgen -G "$TARGET_DIR/*.xcodeproj" > /dev/null 2>&1 || compgen -G "$TARGET_DIR/*.xcworkspace" > /dev/null 2>&1; then
    DOMAIN="ios"
  elif [ -f "$TARGET_DIR/next.config.js" ] || [ -f "$TARGET_DIR/next.config.ts" ] || [ -f "$TARGET_DIR/vite.config.ts" ] || [ -f "$TARGET_DIR/package.json" ]; then
    DOMAIN="web"
  elif [ -f "$TARGET_DIR/pyproject.toml" ] || [ -f "$TARGET_DIR/requirements.txt" ] || [ -f "$TARGET_DIR/go.mod" ] || [ -f "$TARGET_DIR/Cargo.toml" ]; then
    DOMAIN="backend"
  else
    DOMAIN="general"
  fi
fi

# -y without -p: pick the profile matching the detected domain
if [ "$PROFILE" = "auto" ]; then
  case "$DOMAIN" in
    android) PROFILE="android" ;;
    ios) PROFILE="ios" ;;
    web) PROFILE="web" ;;
    backend) PROFILE="backend" ;;
    *) PROFILE="universal" ;;
  esac
fi

echo
echo "================================================================="
echo "  🚀 Universal Multi-Agent & Multi-Model DevKit Installer"
echo "  Target Project:  $TARGET_DIR"
echo "  Domain Detected: $DOMAIN"
echo "  Selected Agents: $AGENTS"
echo "  Language Mode:   $LANGUAGE"
echo "  Link Mode:       $MODE"
echo "  Profile:         $PROFILE"
echo "================================================================="
echo

# 1. The devkit's own commands/ is committed as-is. Installing into a project must
#    never rewrite files inside the devkit checkout (run `agent-kit sync` when
#    developing the devkit itself).

# 2. Source X_old Conflict Protection Helper
source "$DEVKIT_ROOT/scripts/backup_conflict.sh"

# 3. Setup Project Rules, Skills & Commands with X_old Protection
if [ "$TARGET_DIR" != "$DEVKIT_ROOT" ]; then
  echo "  🛡️  [X_old Protection] $(L "Kiểm tra xung đột tài nguyên dự án..." "checking for conflicts with project files...")"
  placed=()
  for item in rules skills commands; do
    if is_foreign_project_dir "$TARGET_DIR/$item"; then
      # The project's own directory (e.g. a CLI's commands/build.js): never rename it.
      echo "  ⚠️  $item/ belongs to your project — left untouched, DevKit $item/ NOT installed there." >&2
      echo "      (agents still get DevKit skills/commands via .claude/ and .agents/skills/)" >&2
      continue
    fi
    devkit_place "$DEVKIT_ROOT/$item" "$TARGET_DIR/$item" "$MODE"
    placed+=("$item/")
  done
  if [ ${#placed[@]} -gt 0 ]; then
    echo "  - Initialized ${placed[*]}"
  fi
  if [ "$MODE" = "symlink" ] && [ -e "$TARGET_DIR/.git" ]; then
    echo "  ⚠️  Symlink mode writes ABSOLUTE links into $DEVKIT_ROOT." >&2
    echo "      Teammates and CI will get broken links if you commit them —" >&2
    echo "      re-run with '-m copy' for a committed team setup, or keep the links untracked." >&2
  fi
fi

# 3b. Skills allowed by the profile (P1-5): adapters place only these into
#     .agents/skills and .claude/commands. Empty = every skill (no profile / self-install).
DEVKIT_SKILLS_ALLOWED=""
if [ "$TARGET_DIR" != "$DEVKIT_ROOT" ]; then
  if ! DEVKIT_SKILLS_ALLOWED="$(python3 "$DEVKIT_ROOT/scripts/profile_skills.py" "${PROFILE:-none}" | tr '\n' ' ')"; then
    echo "✖ profiles/$PROFILE/profile.json lists an unknown skill — fix it before installing." >&2
    exit 1
  fi
  if [ "$PROFILE" != "none" ]; then
    skipped=""
    for d in "$DEVKIT_ROOT/skills"/*/; do
      d="$(basename "$d")"
      [[ " $DEVKIT_SKILLS_ALLOWED " == *" $d "* ]] || skipped="$skipped$d "
    done
    [ -n "$skipped" ] && echo "  - $(L "Profile '$PROFILE' bỏ qua skill không liên quan" "Profile '$PROFILE' skips unrelated skills"): ${skipped% }"
  fi
fi
export DEVKIT_SKILLS_ALLOWED

# 4. Configure selected agents
IFS=',' read -ra AGENT_LIST <<< "$AGENTS"
export SKIP_EXISTING="${SKIP_EXISTING:-0}"

configure_agent() {
  local ag="$1"
  case "$ag" in
    claude)
      echo "  🤖 [Claude Code]"
      bash "$DEVKIT_ROOT/adapters/setup_claude.sh" "$TARGET_DIR" "$MODE" "$LANGUAGE"
      ;;
    codex|chatgpt|openai)
      echo "  🧠 [OpenAI Codex / ChatGPT]"
      bash "$DEVKIT_ROOT/adapters/setup_codex.sh" "$TARGET_DIR" "$MODE" "$LANGUAGE" "$DOMAIN"
      ;;
    gemini|antigravity)
      echo "  ✨ [Google Antigravity / Gemini]"
      bash "$DEVKIT_ROOT/adapters/setup_gemini.sh" "$TARGET_DIR" "$MODE" "$LANGUAGE"
      ;;
    cursor)
      echo "  ⚡ [Cursor IDE]"
      bash "$DEVKIT_ROOT/adapters/setup_cursor.sh" "$TARGET_DIR" "$MODE" "$LANGUAGE" "$DOMAIN"
      ;;
    all)
      configure_agent "claude"
      configure_agent "codex"
      configure_agent "gemini"
      configure_agent "cursor"
      ;;
    *)
      echo "  ⚠️ Unknown agent: $ag (skipping)"
      ;;
  esac
}

for agent_item in "${AGENT_LIST[@]}"; do
  agent_clean="$(echo "$agent_item" | tr '[:upper:]' '[:lower:]' | xargs)"
  configure_agent "$agent_clean"
done

echo
echo "================================================================="
echo "  ✨ Setup Complete for Selected Agents: [$AGENTS]!"
echo "  No unnecessary agent rules or files were created."
echo "================================================================="

# 5. Setup DESIGN.md & Instincts Memory if not existing in target project
if [ "$TARGET_DIR" != "$DEVKIT_ROOT" ]; then
  # An existing DESIGN.md / instincts.md is the project's own and is never overwritten,
  # so there is nothing to back up — only missing files are created from templates.
  if [ -e "$TARGET_DIR/DESIGN.md" ]; then
    echo "  - Kept existing DESIGN.md (not modified)"
  else
    cp "$DEVKIT_ROOT/templates/DESIGN.md" "$TARGET_DIR/DESIGN.md"
    echo "  - Initialized DESIGN.md (Design system & a11y baseline)"
  fi

  mkdir -p "$TARGET_DIR/.agents"
  if [ -e "$TARGET_DIR/.agents/instincts.md" ]; then
    echo "  - Kept existing .agents/instincts.md (not modified)"
  else
    cp "$DEVKIT_ROOT/templates/instincts.template.md" "$TARGET_DIR/.agents/instincts.md"
    echo "  - Initialized .agents/instincts.md (Failure memory & repository traps)"
  fi

  # Keep local install state and *_old backups out of the project's commits.
  if [ -e "$TARGET_DIR/.git" ] || [ -f "$TARGET_DIR/.gitignore" ]; then
    GI_BLOCK="$(mktemp "${TMPDIR:-/tmp}/devkit-gitignore.XXXXXX")"
    cat > "$GI_BLOCK" <<'GI_EOF'
# Local DevKit install state & *_old conflict backups (review/merge them, don't commit)
.claude/audit-gate/
.devkit_backups.log
.devkit-files
*_old
*_old.*
*_old_*
GI_EOF
    python3 "$DEVKIT_ROOT/scripts/merge_markdown.py" "$GI_BLOCK" "$TARGET_DIR/.gitignore" "universal-agent-devkit" --comment-style=hash >/dev/null
    rm -f "$GI_BLOCK"
    echo "  - .gitignore: DevKit state and *_old backups excluded"
  fi
fi

# 6. Activate the domain profile, if one was chosen
if [ -n "$PROFILE" ] && [ "$PROFILE" != "none" ]; then
  if ! python3 "$DEVKIT_ROOT/bin/agent-config.py" --profile "$PROFILE" --target "$TARGET_DIR" --lang "$DEVKIT_LANG"; then
    echo "✖ Activating profile '$PROFILE' failed — the project was set up without a profile." >&2
    exit 1
  fi
fi

# 7. Report *_old backups, if any
if [ "$TARGET_DIR" != "$DEVKIT_ROOT" ]; then
  list_old_backups "$TARGET_DIR"
fi
