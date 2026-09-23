#!/usr/bin/env bash
# backup_conflict.sh — Safe Isolation for Existing Project Collisions (X_old Protection)
# Preserves user's existing skills, rules, commands, hooks, and configs without overwriting.

# Output language helper L "<vi>" "<en>" (DEVKIT_LANG) — see scripts/i18n.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/i18n.sh"

# resolve_link_target <link> — absolute target of a symlink (relative targets are
# resolved against the link's own directory). Links may be relative since the
# devkit's self-install writes portable relative links.
resolve_link_target() {
  local link="$1" t dir
  t="$(readlink "$link" || true)"
  case "$t" in
    /*) printf '%s' "$t" ;;
    "") printf '' ;;
    *)
      dir="$(cd "$(dirname "$link")" 2>/dev/null && cd "$(dirname "$t")" 2>/dev/null && pwd -P)" || dir=""
      [ -n "$dir" ] && printf '%s/%s' "$dir" "$(basename "$t")" || printf '%s' "$t"
      ;;
  esac
}

# link_is_devkit_owned <link> <devkit_root>
link_is_devkit_owned() {
  local link="$1" root="$2" t root_p
  [ -L "$link" ] && [ -n "$root" ] || return 1
  t="$(resolve_link_target "$link")"
  root_p="$(cd "$root" 2>/dev/null && pwd -P)" || root_p="$root"
  [[ "$t" == "$root_p"/* || "$t" == "$root"/* || "$t" == "$root_p" || "$t" == "$root" ]]
}

has_user_content() {
  local dir="$1"
  local devkit_root="${2:-}"

  [ -d "$dir" ] || return 1
  [ -L "$dir" ] && return 1

  local count
  count="$(find "$dir" -mindepth 1 -maxdepth 1 2>/dev/null | wc -l | xargs)"
  [ "$count" -eq 0 ] && return 1

  if [ -n "$devkit_root" ]; then
    local non_devkit=0
    while IFS= read -r item; do
      [ -e "$item" ] || [ -L "$item" ] || continue
      if [ -L "$item" ]; then
        if ! link_is_devkit_owned "$item" "$devkit_root"; then
          non_devkit=1
          break
        fi
      elif ! is_unmodified_devkit_copy "$item"; then
        non_devkit=1
        break
      fi
    done < <(find "$dir" -mindepth 1 -maxdepth 1)
    [ "$non_devkit" -eq 1 ] && return 0
    return 1
  fi

  return 0
}

backup_conflict() {
  local target="$1"
  local devkit_root="${2:-}"

  [ -e "$target" ] || [ -L "$target" ] || return 0

  # If it is a symlink pointing into devkit_root, it is our own managed link -> safe to replace
  if link_is_devkit_owned "$target" "$devkit_root"; then
    return 0
  fi

  # Determine backup path (X_old)
  local parent_dir
  parent_dir="$(dirname "$target")"
  local base_name
  base_name="$(basename "$target")"

  local backup_name
  if [ -d "$target" ] && [ ! -L "$target" ]; then
    # Directory: skills -> skills_old, rules -> rules_old
    backup_name="${base_name}_old"
  else
    # File: CLAUDE.md -> CLAUDE_old.md, or .cursorrules -> .cursorrules_old
    if [[ "$base_name" == *.* ]] && [[ "$base_name" != .* ]]; then
      local name_no_ext="${base_name%.*}"
      local ext="${base_name##*.}"
      backup_name="${name_no_ext}_old.${ext}"
    else
      backup_name="${base_name}_old"
    fi
  fi

  # Item-by-item install dirs (.claude/commands, .claude/agents, .claude/hooks,
  # .agents/skills) are loaded by the agent as a whole: a `fix_old.md` left there would
  # become a junk `/fix_old` command. Such backups go to a sibling `<dir>_old/` instead.
  local backup_dir="$parent_dir"
  case "$parent_dir" in
    */.claude/commands|*/.claude/agents|*/.claude/hooks|*/.agents/skills)
      backup_dir="${parent_dir}_old"
      mkdir -p "$backup_dir" || return 1
      backup_name="$base_name"
      ;;
  esac

  local backup_path="$backup_dir/$backup_name"

  # If X_old already exists, don't overwrite it! Append a timestamp, then a counter —
  # two backups inside the same second must never clobber (or nest into) each other.
  if [ -e "$backup_path" ] || [ -L "$backup_path" ]; then
    local ts stem ext="" n=1 candidate
    ts="$(date +%Y%m%d_%H%M%S)"
    if [ -d "$target" ] && [ ! -L "$target" ]; then
      stem="${backup_path}_${ts}"
    elif [[ "$backup_name" == *.* ]] && [[ "$backup_name" != .* ]]; then
      stem="${backup_dir}/${backup_name%.*}_${ts}"
      ext=".${backup_name##*.}"
    else
      stem="${backup_path}_${ts}"
    fi
    candidate="${stem}${ext}"
    while [ -e "$candidate" ] || [ -L "$candidate" ]; do
      n=$((n + 1))
      candidate="${stem}_${n}${ext}"
    done
    backup_path="$candidate"
  fi

  # Move conflicting folder/file to backup path — abort loudly if the move fails,
  # otherwise the caller would go on to replace the user's data.
  if ! mv "$target" "$backup_path"; then
    echo "ERROR: [X_old Protection] could not move '$target' to '$backup_path' — nothing replaced." >&2
    return 1
  fi

  # Colored user-friendly notification
  local YELLOW='\033[1;33m'
  local CYAN='\033[0;36m'
  local GREEN='\033[0;32m'
  local RESET='\033[0m'

  echo -e "${YELLOW}  ⚠️ [X_old Protection] $(L "Phát hiện xung đột dự án cũ:" "conflict with an existing project item:")${RESET} ${CYAN}${base_name}${RESET}"
  local shown="$(basename "$backup_path")"
  [ "$backup_dir" != "$parent_dir" ] && shown="$(basename "$backup_dir")/$shown"
  echo -e "     ➔ ${GREEN}$(L "ĐÃ ĐỔI TÊN THÀNH:" "RENAMED TO:")${RESET} ${CYAN}${shown}${RESET} $(L "để bạn tự merge theo ý mình (Không ghi đè làm mất mã nguồn)!" "so you can merge it yourself (nothing was overwritten).")"

  # Record to a session backup ledger next to the conflicting item
  local ledger_dir="$backup_dir"
  [ -d "$ledger_dir" ] && echo "$(date '+%Y-%m-%d %H:%M:%S') | $target -> $backup_path" >> "$ledger_dir/.devkit_backups.log" 2>/dev/null || true

  return 0
}

DEVKIT_MANIFEST=".devkit-copy"

_devkit_manifest() { # <dir> — sorted "sha  path" list of every file except the manifest
  local sum=shasum
  command -v shasum >/dev/null 2>&1 || sum=sha1sum
  (cd "$1" && find . -type f ! -name "$DEVKIT_MANIFEST" -exec "$sum" {} + 2>/dev/null | LC_ALL=C sort -k2)
}

# is_unmodified_devkit_copy <dir> — a copy-mode install the user has not edited since.
is_unmodified_devkit_copy() {
  local dir="$1"
  [ -d "$dir" ] && [ ! -L "$dir" ] && [ -f "$dir/$DEVKIT_MANIFEST" ] || return 1
  [ "$(_devkit_manifest "$dir")" = "$(cat "$dir/$DEVKIT_MANIFEST")" ]
}

# Per-directory ledger of single FILES the devkit copied (copy mode): "sha  name" lines.
# Lets an upgrade tell "devkit file the user never touched" (replace silently) from
# "file the user edited" (preserve as *_old) — comparing against the NEW devkit source
# with cmp would flag every file the devkit itself changed.
DEVKIT_FILE_LEDGER=".devkit-files"

_devkit_sha() {
  if command -v shasum >/dev/null 2>&1; then shasum "$1" | cut -d' ' -f1; else sha1sum "$1" | cut -d' ' -f1; fi
}

# forget_devkit_file <dst> — drop <dst> from its directory ledger
forget_devkit_file() {
  local dst="$1" ledger name tmp
  ledger="$(dirname "$dst")/$DEVKIT_FILE_LEDGER"
  name="$(basename "$dst")"
  [ -f "$ledger" ] || return 0
  tmp="$(mktemp "${ledger}.XXXXXX")" || return 0
  awk -v n="$name" '{ line=$0; sub(/^[^ ]+  /, "", line); if (line != n) print }' "$ledger" > "$tmp" && mv "$tmp" "$ledger"
  [ -s "$ledger" ] || rm -f "$ledger"
}

# record_devkit_file <dst> — remember the hash of a file the devkit just copied
record_devkit_file() {
  local dst="$1"
  forget_devkit_file "$dst"
  printf '%s  %s\n' "$(_devkit_sha "$dst")" "$(basename "$dst")" >> "$(dirname "$dst")/$DEVKIT_FILE_LEDGER"
}

# is_recorded_devkit_file <dst> — a devkit-copied file whose content is unchanged since
is_recorded_devkit_file() {
  local dst="$1" ledger name want
  [ -f "$dst" ] && [ ! -L "$dst" ] || return 1
  ledger="$(dirname "$dst")/$DEVKIT_FILE_LEDGER"
  name="$(basename "$dst")"
  [ -f "$ledger" ] || return 1
  want="$(awk -v n="$name" '{ line=$0; sub(/^[^ ]+  /, "", line); if (line == n) { split($0, a, " "); print a[1] } }' "$ledger" | tail -n 1)"
  [ -n "$want" ] && [ "$want" = "$(_devkit_sha "$dst")" ]
}

# is_foreign_project_dir <dir> — a real directory that belongs to the PROJECT itself
# (e.g. a CLI's own commands/ holding build.js): it has files that are neither devkit
# links nor a devkit copy (no .devkit-copy manifest). The installer must leave such a
# directory exactly where it is — renaming it to *_old would break the project's build.
is_foreign_project_dir() {
  local dir="$1"
  [ -d "$dir" ] && [ ! -L "$dir" ] || return 1
  [ -f "$dir/$DEVKIT_MANIFEST" ] && return 1
  has_user_content "$dir" "${DEVKIT_ROOT:-}"
}

# devkit_ln <src> <dst> — symlink; relative when dst lives inside the devkit itself
# (self-install), so the committed links work on every clone.
devkit_ln() {
  local src="$1" dst="$2" root_p dst_dir src_p
  root_p="$(cd "${DEVKIT_ROOT:-/nonexistent}" 2>/dev/null && pwd -P)" || root_p=""
  dst_dir="$(cd "$(dirname "$dst")" && pwd -P)"
  if [ -n "$root_p" ] && [[ "$dst_dir/" == "$root_p/"* ]]; then
    src_p="$(cd "$(dirname "$src")" && pwd -P)/$(basename "$src")"
    src="$(python3 -c 'import os,sys; print(os.path.relpath(sys.argv[1], sys.argv[2]))' "$src_p" "$dst_dir")"
  fi
  ln -sfn "$src" "$dst"
}

# devkit_place <src> <dst> <symlink|copy> — idempotent install of one devkit item.
# Replaces our own links, unmodified copies, identical files, empty dirs and dirs
# holding only devkit links; anything else the user owns is moved to *_old first.
# Never writes *through* an existing symlink (cp into a link would modify the devkit).
devkit_place() {
  local src="$1" dst="$2" mode="$3" parent_p root_p target_p
  # Guard: a symlinked project dir (e.g. .claude/commands -> DEVKIT/commands) or a
  # symlinked alias of the devkit would make every rm/ln below act on the devkit
  # itself. Compare PHYSICAL paths and refuse instead of destroying the source.
  mkdir -p "$(dirname "$dst")"
  parent_p="$(cd "$(dirname "$dst")" && pwd -P)"
  root_p="$(cd "${DEVKIT_ROOT:-/nonexistent}" 2>/dev/null && pwd -P)" || root_p=""
  target_p="$(cd "${TARGET_DIR:-.}" 2>/dev/null && pwd -P)" || target_p=""
  if [ -n "$root_p" ] && [[ "$parent_p/" == "$root_p/"* ]] && [ "$target_p" != "$root_p" ]; then
    echo "ERROR: '$dst' resolves into the DevKit itself ($parent_p)." >&2
    echo "       Replace that symlinked directory in the project with a real directory and re-run." >&2
    return 1
  fi
  if [ -e "$dst" ] && [ "$(cd "$(dirname "$src")" && pwd -P)/$(basename "$src")" = "$parent_p/$(basename "$dst")" ]; then
    return 0 # dst IS src — nothing to place
  fi
  if [ -L "$dst" ]; then
    if link_is_devkit_owned "$dst" "${DEVKIT_ROOT:-}"; then rm -f "$dst"; else backup_conflict "$dst" "${DEVKIT_ROOT:-}"; fi
  elif [ -d "$dst" ]; then
    if is_unmodified_devkit_copy "$dst" || ! has_user_content "$dst" "${DEVKIT_ROOT:-}"; then
      rm -rf "$dst"
    else
      backup_conflict "$dst" "${DEVKIT_ROOT:-}"
    fi
  elif [ -e "$dst" ]; then
    if cmp -s "$src" "$dst" || is_recorded_devkit_file "$dst"; then
      rm -f "$dst"
    else
      backup_conflict "$dst" "${DEVKIT_ROOT:-}" || return 1
    fi
  fi
  mkdir -p "$(dirname "$dst")"
  if [ "$mode" = "symlink" ]; then
    devkit_ln "$src" "$dst"
    forget_devkit_file "$dst"
  else
    cp -RL "$src" "$dst"
    if [ -d "$dst" ]; then _devkit_manifest "$dst" > "$dst/$DEVKIT_MANIFEST"; else record_devkit_file "$dst"; fi
  fi
}

# devkit_install_agents_md <target_dir> <symlink|copy> — shared by every adapter.
#   absent / devkit link / unmodified devkit copy -> (re)placed per mode
#   the project's OWN AGENTS.md                    -> kept, backed up once as AGENTS_old.md,
#                                                     DevKit block injected between markers
#   a foreign symlink (dotfile manager)            -> left alone
devkit_install_agents_md() {
  local target="$1" mode="$2" dst src marker="universal-agent-devkit"
  dst="$target/AGENTS.md"
  src="$DEVKIT_ROOT/AGENTS.md"
  [ "$target" = "$DEVKIT_ROOT" ] && return 0
  if [ -L "$dst" ] && ! link_is_devkit_owned "$dst" "$DEVKIT_ROOT"; then
    echo "  - AGENTS.md is a symlink you manage — left untouched"
    return 0
  fi
  if [ -f "$dst" ] && [ ! -L "$dst" ] && ! cmp -s "$src" "$dst" && ! is_recorded_devkit_file "$dst"; then
    if [ ! -e "$target/AGENTS_old.md" ] && ! grep -q "$marker" "$dst" 2>/dev/null; then
      cp "$dst" "$target/AGENTS_old.md"
      echo "  - Preserved original AGENTS.md as AGENTS_old.md"
    fi
    python3 "$DEVKIT_ROOT/scripts/merge_markdown.py" "$DEVKIT_ROOT/templates/agents_injection_block.md" "$dst" "$marker"
    echo "  - Injected DevKit standards into existing AGENTS.md (Preserved custom architecture)"
    return 0
  fi
  devkit_place "$src" "$dst" "$mode" || return 1
  if [ "$mode" = "symlink" ]; then
    echo "  - AGENTS.md linked to DevKit SSOT"
  else
    echo "  - AGENTS.md copied from DevKit SSOT"
  fi
}

# ---- Profile skill filter (P1-5) -------------------------------------------------
# DEVKIT_SKILLS_ALLOWED: space-separated skill names the active profile installs
# (set by install.sh from scripts/profile_skills.py). Unset/empty = every skill.

# devkit_skill_allowed <skill-name>
devkit_skill_allowed() {
  [ -n "${DEVKIT_SKILLS_ALLOWED:-}" ] || return 0
  case " $DEVKIT_SKILLS_ALLOWED " in *" $1 "*) return 0 ;; esac
  return 1
}

# devkit_command_skill <devkit command file> — the skill a command resolves to
# (commands/*.md are link chains ending at skills/<name>/SKILL.md); "" when none.
devkit_command_skill() {
  local f="$1" n=0 t
  while [ -L "$f" ] && [ "$n" -lt 10 ]; do
    t="$(resolve_link_target "$f")"
    [ -n "$t" ] || break
    f="$t"; n=$((n + 1))
  done
  case "$f" in
    */skills/*/SKILL.md) f="${f%/SKILL.md}"; printf '%s' "${f##*/}" ;;
    *) printf '' ;;
  esac
}

# devkit_command_allowed <devkit command file>
devkit_command_allowed() {
  local skill
  skill="$(devkit_command_skill "$1")"
  [ -z "$skill" ] || devkit_skill_allowed "$skill"
}

# devkit_remove_filtered <dst> — remove a DevKit item the profile no longer installs.
# Only our own links / unmodified copies go; anything the user edited stays.
devkit_remove_filtered() {
  local dst="$1"
  if [ -L "$dst" ]; then
    link_is_devkit_owned "$dst" "${DEVKIT_ROOT:-}" && rm -f "$dst"
  elif [ -d "$dst" ]; then
    is_unmodified_devkit_copy "$dst" && rm -rf "$dst"
  elif [ -f "$dst" ]; then
    if is_recorded_devkit_file "$dst"; then rm -f "$dst"; forget_devkit_file "$dst"; fi
  fi
  return 0
}

backup_dir_if_user_content() {
  local dir="$1"
  local devkit_root="${2:-}"
  if has_user_content "$dir" "$devkit_root"; then
    backup_conflict "$dir" "$devkit_root"
  fi
}

backup_file_if_user_content() {
  local file="$1"
  local marker="${2:-universal-agent-devkit}"
  [ -f "$file" ] || return 0
  [ -L "$file" ] && return 0
  if ! grep -q "$marker" "$file" 2>/dev/null; then
    backup_conflict "$file" ""
  fi
}

list_old_backups() {
  local root_dir="${1:-$PWD}"
  echo "================================================================="
  echo "  🔍 $(L "Danh Sách Các Mục Đã Được Bảo Vệ (*_old) Trong Dự Án:" "Protected items (*_old) in this project:")"
  echo "  $(L "Thư mục kiểm tra:" "Checked directory:") $root_dir"
  echo "================================================================="
  local found=0
  while IFS= read -r item; do
    [ -n "$item" ] || continue
    found=1
    local rel_path="${item#$root_dir/}"
    if [ -d "$item" ]; then
      echo "  📁 [$(L "Thư mục cũ" "old dir")] $rel_path"
    else
      echo "  📄 [$(L "Tập tin cũ" "old file")]  $rel_path"
    fi
  done < <(find "$root_dir" -maxdepth 3 \( -name "*_old" -o -name "*_old.*" -o -name "*_old_*" \) 2>/dev/null | grep -v "/\.git/")

  if [ "$found" -eq 0 ]; then
    echo "  ✔ $(L "Không có mục *_old nào (Dự án sạch hoặc chưa phát sinh xung đột)." "No *_old items (clean project, no conflicts so far).")"
  else
    echo "-----------------------------------------------------------------"
    echo "  👉 $(L "Lời khuyên: Bạn có thể xem lại mã nguồn trong các mục *_old" "Tip: review the *_old items")"
    echo "     $(L "và chủ động copy/merge các kỹ năng, quy tắc riêng vào thư mục mới." "and copy/merge your own skills and rules into the new directories.")"
    echo "================================================================="
  fi
}

# restore_old_backups <project_dir> [--apply]
# Puts *_old backups recorded in .devkit_backups.log ledgers back in place. Dry-run by
# default. A backup is restored only when its original location is now empty, a symlink
# into the DevKit, a devkit-copied file the user never edited (.devkit-files) or an
# unmodified devkit copy directory (.devkit-copy). Anything else at that location holds
# content that is not the DevKit's, so it is reported and left alone — merge by hand.
# When one location was backed up several times, the OLDEST backup (the user's original)
# is the one restored; later ones are listed and kept.
restore_old_backups() {
  local root_dir="${1:-$PWD}" apply=0 root_p
  [ "${2:-}" = "--apply" ] && apply=1
  root_p="$(cd "$root_dir" 2>/dev/null && pwd -P)" || { echo "restore-old: no such directory: $root_dir" >&2; return 2; }
  local seen_file restored=0 would=0 skipped=0 ledger line target backup rest
  seen_file="$(mktemp "${TMPDIR:-/tmp}/devkit-restore.XXXXXX")" || return 1
  echo "restore-old: ${root_p} ($([ "$apply" -eq 1 ] && echo apply || echo 'dry-run — add --apply to restore'))"
  while IFS= read -r ledger; do
    [ -n "$ledger" ] || continue
    while IFS= read -r line || [ -n "$line" ]; do
      rest="${line#* | }"
      [ "$rest" != "$line" ] || continue
      target="${rest%% -> *}"
      backup="${rest#* -> }"
      [ "$target" != "$rest" ] && [ -n "$backup" ] || continue
      case "$target" in "$root_p"/*) ;; *) continue ;; esac
      case "$backup" in "$root_p"/*) ;; *) continue ;; esac
      if grep -qxF -- "$target" "$seen_file"; then
        [ -e "$backup" ] || [ -L "$backup" ] && echo "  kept     ${backup#$root_p/} (a later backup of ${target#$root_p/})"
        continue
      fi
      [ -e "$backup" ] || [ -L "$backup" ] || continue
      printf '%s\n' "$target" >> "$seen_file"
      local free=0
      if [ ! -e "$target" ] && [ ! -L "$target" ]; then
        free=1
      elif link_is_devkit_owned "$target" "${DEVKIT_ROOT:-}"; then
        free=1
      elif is_recorded_devkit_file "$target" || is_unmodified_devkit_copy "$target"; then
        free=1
      fi
      if [ "$free" -ne 1 ]; then
        echo "  SKIP     ${target#$root_p/} — holds content that is not the DevKit's; merge ${backup#$root_p/} by hand"
        skipped=$((skipped + 1))
        continue
      fi
      if [ "$apply" -ne 1 ]; then
        echo "  would    ${backup#$root_p/} -> ${target#$root_p/}"
        would=$((would + 1))
        continue
      fi
      if [ -L "$target" ] || [ -f "$target" ]; then
        rm -f "$target" && forget_devkit_file "$target"
      elif [ -d "$target" ]; then
        rm -rf "$target"
      fi
      if mv "$backup" "$target"; then
        echo "  restored ${backup#$root_p/} -> ${target#$root_p/}"
        restored=$((restored + 1))
      else
        echo "ERROR: could not move '$backup' back to '$target'" >&2
        rm -f "$seen_file"
        return 1
      fi
    done < "$ledger"
  done < <(find "$root_p" -maxdepth 4 -name .devkit_backups.log -not -path '*/.git/*' 2>/dev/null | LC_ALL=C sort)
  rm -f "$seen_file"
  if [ "$apply" -eq 1 ]; then
    echo "restore-old: ${restored} restored, ${skipped} skipped"
  else
    echo "restore-old: ${would} would be restored, ${skipped} skipped"
  fi
  [ "$skipped" -eq 0 ]
}

if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
  cmd="${1:-}"
  case "$cmd" in
    list|list-old)
      list_old_backups "${2:-$PWD}"
      ;;
    restore|restore-old)
      restore_old_backups "${2:-$PWD}" "${3:-}"
      ;;
    *)
      if [ $# -ge 1 ]; then
        backup_conflict "$1" "${2:-}"
      else
        echo "Usage: $0 <target_path> [devkit_root] | $0 list [project_dir] | $0 restore [project_dir] [--apply]"
        exit 1
      fi
      ;;
  esac
fi
