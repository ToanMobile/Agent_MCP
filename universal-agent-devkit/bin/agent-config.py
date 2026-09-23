#!/usr/bin/env python3
"""
Agent Profile Configuration CLI Tool
Universal Agent DevKit — Dynamic Domain Profile Switcher
Provides 8 specialized configuration options:
  [1] 🚗 Automotive (AAOS / IVI / Flyme Auto / CAN Bus)
  [2] 📱 Android    (Mobile App: Jetpack Compose / Clean Architecture)
  [3] 🎮 Game       (Game 3D: Unity 6 / Blender 3D / Shaders & Mesh)
  [4] 🌐 Universal  (General: Full-Stack / Clean Architecture / TDD)
  [5] 🎙️ Voice      (Voice Assistant: Edge AI / STT / AEC / Audio)
  [6] 🍏 iOS        (Swift / SwiftUI / Swift Concurrency / XCTest)
  [7] 🕸️ Web        (Frontend / Full-Stack JS / TypeScript)
  [8] 🗄️ Backend    (API / Services / Python · Go · Rust · Node)
Output language: --lang > $DEVKIT_LANG > "lang" in .active-profile.json > vi.
100% Standard Library — Zero external dependencies.
"""

import argparse
import json
import os
import shutil
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))
from devkit_i18n import pick, resolve_lang, set_lang, tr  # noqa: E402

# Fix Unicode on Windows consoles if needed
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

GREEN = "\033[92m"
YELLOW = "\033[93m"
RED = "\033[91m"
CYAN = "\033[96m"
BOLD = "\033[1m"
DIM = "\033[2m"
RESET = "\033[0m"

PROFILES = {
    "1": "automotive",
    "automotive": "automotive",
    "car": "automotive",
    "xehoi": "automotive",
    
    "2": "android",
    "android": "android",
    "mobile": "android",
    
    "3": "game",
    "game": "game",
    "unity": "game",
    "blender": "game",

    "4": "universal",
    "universal": "universal",
    "general": "universal",
    "all": "universal",
    "default": "universal",

    "5": "voice-assistant",
    "voice": "voice-assistant",
    "voice-assistant": "voice-assistant",
    "audio": "voice-assistant",

    "6": "ios",
    "ios": "ios",
    "swift": "ios",
    "swiftui": "ios",
    "apple": "ios",

    "7": "web",
    "web": "web",
    "frontend": "web",
    "react": "web",
    "nextjs": "web",

    "8": "backend",
    "backend": "backend",
    "server": "backend",
    "api": "backend",
}

def log_ok(msg):
    print(f"  {GREEN}✔{RESET} {msg}")

def log_warn(msg):
    print(f"  {YELLOW}⚠{RESET} {msg}")

def log_err(msg):
    print(f"  {RED}✖{RESET} {msg}")

def get_base_dir() -> Path:
    return Path(__file__).resolve().parent.parent

def load_profile_meta(profile_id: str) -> dict:
    base_dir = get_base_dir()
    profile_json = base_dir / "profiles" / profile_id / "profile.json"
    if profile_json.exists():
        with open(profile_json, "r", encoding="utf-8") as f:
            return json.load(f)
    return {}

# Đường dẫn ma trận hồi quy trong dự án đích. Đường cũ (templates/) vẫn được
# post-fix-gate đọc làm fallback, nhưng profile mới chỉ ghi vào .agents/.
ACTIVE_MATRIX_REL = Path(".agents") / "regression_matrix.active.json"
LEGACY_MATRIX_REL = Path("templates") / "regression_matrix.active.json"


def is_within(path: Path, root: Path) -> bool:
    try:
        path.resolve().relative_to(root.resolve())
        return True
    except ValueError:
        return False


def git_root(start: Path):
    try:
        res = subprocess.run(["git", "-C", str(start), "rev-parse", "--show-toplevel"],
                             capture_output=True, text=True, timeout=5)
        if res.returncode == 0 and res.stdout.strip():
            return Path(res.stdout.strip())
    except (OSError, subprocess.SubprocessError):
        pass
    return None


def resolve_target(target_dir_str, for_write: bool):
    """Thư mục dự án đích: -t nếu có, ngược lại là git root của $PWD (hoặc $PWD).

    Trả về (Path, error_message). Khi ghi mà không có -t, từ chối nếu $PWD nằm
    trong chính DevKit — tránh ghi trạng thái của dự án vào repo DevKit (P-1).
    """
    if target_dir_str:
        return Path(target_dir_str).expanduser().resolve(), None
    cwd = Path.cwd().resolve()
    if not for_write and is_within(cwd, get_base_dir()):
        return get_base_dir(), None  # đọc trạng thái của chính DevKit khi đứng trong DevKit
    target = (git_root(cwd) or cwd).resolve()
    if for_write and (is_within(cwd, get_base_dir()) or is_within(target, get_base_dir())):
        return None, tr("Thư mục hiện tại nằm trong DevKit; không ghi profile vào DevKit. "
                        "Hãy cd vào dự án của bạn, hoặc truyền -t <dự án> (dùng -t <DevKit> nếu thật sự muốn).",
                        "The current directory is inside the DevKit; refusing to write a profile into the DevKit. "
                        "cd into your project, or pass -t <project> (use -t <DevKit> if you really mean it).")
    return target, None


def _x_old_path(target: Path) -> Path:
    """Tên backup theo chính sách X_old; không bao giờ trùng tên đã có."""
    parent, name = target.parent, target.name
    if target.is_dir() and not target.is_symlink():
        stem, ext = name, ""
    elif "." in name and not name.startswith("."):
        stem, ext = name.rsplit(".", 1)
        ext = "." + ext
    else:
        stem, ext = name, ""
    candidate = parent / f"{stem}_old{ext}"
    if not (candidate.exists() or candidate.is_symlink()):
        return candidate
    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    n = 0
    while True:
        suffix = f"_old_{ts}" + (f"_{n}" if n else "")
        candidate = parent / f"{stem}{suffix}{ext}"
        if not (candidate.exists() or candidate.is_symlink()):
            return candidate
        n += 1


def x_old_backup(target: Path) -> Path:
    """Đổi tên target thành X_old (không xoá dữ liệu người dùng — P-2)."""
    backup = _x_old_path(target)
    target.rename(backup)
    log_warn(tr(f"[X_old] `{target.name}` đã có dữ liệu riêng → đổi tên thành `{backup.name}`",
                f"[X_old] `{target.name}` holds your own data → renamed to `{backup.name}`"))
    try:
        with open(target.parent / ".devkit_backups.log", "a", encoding="utf-8") as f:
            f.write(f"{datetime.now():%Y-%m-%d %H:%M:%S} | {target} -> {backup}\n")
    except OSError:
        pass
    return backup


def link_points_into(link: Path, root: Path) -> bool:
    if not link.is_symlink():
        return False
    dest = Path(os.path.join(link.parent, os.readlink(link)))
    return is_within(dest, root)


def known_matrix_contents(devkit_dir: Path) -> set:
    out = set()
    for f in (devkit_dir / "profiles").glob("*/regression_matrix.json"):
        try:
            out.add(f.read_bytes())
        except OSError:
            pass
    return out


def find_council(devkit_dir: Path, profile_id: str, name: str):
    for cand in (devkit_dir / "agents" / "councils" / name,
                 devkit_dir / "profiles" / profile_id / "councils" / name):
        if cand.is_file():
            return cand
    return None


def configured_mcps(target_dir: Path) -> set:
    """MCP đang khai: .mcp.json / mcp_config.json của dự án + cấu hình Gemini toàn cục (P-4)."""
    names = set()
    for cfg_path in (target_dir / ".mcp.json",
                     target_dir / "mcp_config.json",
                     Path.home() / ".gemini" / "config" / "mcp_config.json"):
        if cfg_path.is_file():
            try:
                with open(cfg_path, "r", encoding="utf-8") as f:
                    names.update((json.load(f).get("mcpServers") or {}).keys())
            except (OSError, ValueError, AttributeError):
                log_warn(tr(f"Không đọc được `{cfg_path}` (JSON lỗi?)", f"Cannot read `{cfg_path}` (invalid JSON?)"))
    return names


def get_current_profile(target_dir_str: str = None) -> str:
    target_dir, _ = resolve_target(target_dir_str, for_write=False)
    active_file = target_dir / ".active-profile.json"
    if active_file.exists():
        try:
            with open(active_file, "r", encoding="utf-8") as f:
                data = json.load(f)
                return data.get("profile", "universal")
        except Exception:
            return "universal"
    return "universal"

def apply_profile(profile_id: str, target_dir_str: str = None, lang: str = None):
    devkit_dir = get_base_dir()
    target_dir, err = resolve_target(target_dir_str, for_write=True)
    if err:
        log_err(err)
        return 2
    profile_dir = devkit_dir / "profiles" / profile_id
    if not profile_dir.exists():
        log_err(tr(f"Profile `{profile_id}` không tồn tại trong thư mục profiles/",
                   f"Profile `{profile_id}` does not exist in profiles/"))
        return 1

    meta = load_profile_meta(profile_id)
    profile_name = pick(meta, "name") or profile_id.upper()

    print(f"\n{BOLD}{CYAN}══════════════════════════════════════════════════════════════════════{RESET}")
    print(f"{BOLD}{CYAN}   ⚙️  {tr('Kích hoạt Profile Dự án', 'Activating project profile')}: {profile_name}{RESET}")
    print(f"{BOLD}{CYAN}       {tr('Thư mục đích', 'Target directory')}: {target_dir}{RESET}")
    print(f"{BOLD}{CYAN}══════════════════════════════════════════════════════════════════════{RESET}\n")

    # 1. Ghi tệp trạng thái active
    active_file = target_dir / ".active-profile.json"
    status_data = {
        "profile": profile_id,
        "name": meta.get("name", profile_id.upper()),
        "lang": lang or resolve_lang(None, target_dir),
        "updated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "description": pick(meta, "description"),
        "essential_mcps": meta.get("essential_mcps", []),
        "active_councils": meta.get("active_councils", []),
        "rules_file": meta.get("rules_file", ""),
        "regression_matrix": meta.get("regression_matrix", "")
    }
    target_dir.mkdir(parents=True, exist_ok=True)
    with open(active_file, "w", encoding="utf-8") as f:
        json.dump(status_data, f, indent=2, ensure_ascii=False)
    log_ok(tr(f"Đã lưu trạng thái cấu hình vào `{active_file.name}`", f"Saved profile state to `{active_file.name}`"))

    # 2. Tạo liên kết .agents/active-profile (link tương đối — P-4)
    agents_dir = target_dir / ".agents"
    agents_dir.mkdir(parents=True, exist_ok=True)
    active_link = agents_dir / "active-profile"
    if active_link.is_symlink():
        if link_points_into(active_link, devkit_dir):
            active_link.unlink()
        else:
            x_old_backup(active_link)
    elif active_link.exists():
        # Thư mục/file thật của người dùng → X_old, không rmtree (P-2)
        x_old_backup(active_link)
    try:
        rel = os.path.relpath(profile_dir.resolve(), agents_dir.resolve())
        active_link.symlink_to(rel)
        log_ok(tr(f"Đã liên kết `.agents/active-profile` -> `{rel}`", f"Linked `.agents/active-profile` -> `{rel}`"))
    except Exception as e:
        log_warn(tr(f"Không thể tạo symlink `.agents/active-profile`: {e}", f"Cannot create symlink `.agents/active-profile`: {e}"))

    # 3. Kích hoạt Ma trận Kiểm thử Hồi quy tương ứng (.agents/regression_matrix.active.json)
    reg_src = profile_dir / "regression_matrix.json"
    reg_dest = target_dir / ACTIVE_MATRIX_REL
    if reg_src.exists():
        new_bytes = reg_src.read_bytes()
        if reg_dest.is_symlink():
            reg_dest.unlink()
        elif reg_dest.exists():
            cur = reg_dest.read_bytes()
            if cur != new_bytes and cur not in known_matrix_contents(devkit_dir):
                x_old_backup(reg_dest)  # ma trận do người dùng tự viết (P-2)
        reg_dest.parent.mkdir(parents=True, exist_ok=True)
        reg_dest.write_bytes(new_bytes)
        log_ok(tr(f"Đã kích hoạt ma trận kiểm thử: `{ACTIVE_MATRIX_REL}`", f"Activated regression matrix: `{ACTIVE_MATRIX_REL}`"))

    # 3b. Liên kết các hook chuyên dụng của profile nếu có (ví dụ: validate-assets.sh cho Game)
    profile_hooks = profile_dir / "hooks"
    has_asset_hook = False
    if profile_hooks.exists() and profile_hooks.is_dir():
        target_hooks_dir = target_dir / ".claude" / "hooks"
        target_hooks_dir.mkdir(parents=True, exist_ok=True)
        for h in profile_hooks.iterdir():
            if h.is_file():
                if h.name == "validate-assets.sh":
                    has_asset_hook = True
                dst = target_hooks_dir / h.name
                try:
                    if dst.is_symlink() and link_points_into(dst, devkit_dir):
                        dst.unlink()
                    elif dst.is_symlink() or dst.exists():
                        if dst.is_file() and not dst.is_symlink() and dst.read_bytes() == h.read_bytes():
                            dst.unlink()  # bản copy chưa sửa của chính DevKit
                        else:
                            x_old_backup(dst)
                    dst.symlink_to(os.path.relpath(h.resolve(), target_hooks_dir.resolve()))
                    log_ok(tr(f"Đã liên kết hook chuyên dụng của profile: `{dst.name}` -> `{h}`",
                              f"Linked profile hook: `{dst.name}` -> `{h}`"))
                except Exception:
                    shutil.copy2(h, dst)
                    log_ok(tr(f"Đã sao chép hook chuyên dụng của profile: `{dst.name}`", f"Copied profile hook: `{dst.name}`"))

    # 3c. Đăng ký tự động hook chuyên dụng vào .claude/settings.json (Khử bỏ tử huyệt Hook Ngủ Đông)
    claude_settings_file = target_dir / ".claude" / "settings.json"
    if claude_settings_file.exists():
        try:
            with open(claude_settings_file, "r", encoding="utf-8") as f:
                settings_data = json.load(f)
            
            hooks_cfg = settings_data.setdefault("hooks", {})
            post_tool_use = hooks_cfg.setdefault("PostToolUse", [])
            modified_settings = False
            asset_cmd = 'bash "${CLAUDE_PROJECT_DIR:-$PWD}/.claude/hooks/validate-assets.sh"'

            # Tìm nhóm matcher Edit|Write
            edit_group = None
            for group in post_tool_use:
                matcher = group.get("matcher", "")
                if "Edit" in matcher or "Write" in matcher:
                    edit_group = group
                    break
            
            if edit_group is None and has_asset_hook:
                edit_group = {"matcher": "Edit|Write", "hooks": []}
                post_tool_use.append(edit_group)
                modified_settings = True

            if has_asset_hook and edit_group is not None:
                hooks_list = edit_group.setdefault("hooks", [])
                if not any("validate-assets.sh" in h.get("command", "") for h in hooks_list):
                    hooks_list.append({
                        "type": "command",
                        "command": asset_cmd,
                        "timeout": 15
                    })
                    modified_settings = True
                    log_ok(tr("Đã đăng ký tự động `validate-assets.sh` vào PostToolUse của .claude/settings.json",
                              "Registered `validate-assets.sh` under PostToolUse in .claude/settings.json"))
            elif not has_asset_hook and edit_group is not None:
                # Gỡ bỏ hook của profile cũ khi chuyển sang profile khác
                orig_len = len(edit_group.get("hooks", []))
                edit_group["hooks"] = [h for h in edit_group.get("hooks", []) if "validate-assets.sh" not in h.get("command", "")]
                if len(edit_group["hooks"]) != orig_len:
                    modified_settings = True
                    log_ok(tr("Đã gỡ bỏ hook `validate-assets.sh` khỏi .claude/settings.json khi đổi profile",
                              "Removed `validate-assets.sh` from .claude/settings.json (profile changed)"))

            if modified_settings:
                with open(claude_settings_file, "w", encoding="utf-8") as f:
                    json.dump(settings_data, f, indent=2, ensure_ascii=False)
        except Exception as e:
            log_warn(tr(f"Không thể cập nhật .claude/settings.json: {e}", f"Cannot update .claude/settings.json: {e}"))

    # 4. Kiểm tra sự sẵn sàng của MCP Server chuyên dụng
    print(f"\n{BOLD}{tr('Kiểm tra MCP Servers yêu cầu cho profile', 'Checking MCP servers required by profile')} `{profile_id}`:{RESET}")
    active_mcps = configured_mcps(target_dir)
    for mcp in meta.get("essential_mcps", []):
        if mcp in active_mcps:
            log_ok(f"MCP Server `{mcp}`: {GREEN}{tr('đã khai báo', 'configured')}{RESET}")
        else:
            log_warn(f"MCP Server `{mcp}`: {YELLOW}{tr('CHƯA khai báo trong .mcp.json / mcp_config.json', 'NOT configured in .mcp.json / mcp_config.json')}{RESET}")

    # 5. Hội đồng áp dụng — chỉ in những council thật sự tồn tại
    councils = meta.get("active_councils", [])
    print(f"\n{BOLD}{tr('Các Hội đồng & Quy tắc chuyên trách được áp dụng:', 'Councils & rules applied:')}{RESET}")
    for c in councils:
        if find_council(devkit_dir, profile_id, c):
            print(f"  • {c}")
        else:
            log_warn(tr(f"Council `{c}` được khai trong profile.json nhưng không tồn tại",
                        f"Council `{c}` is declared in profile.json but does not exist"))

    print(f"\n{GREEN}{BOLD}✔ {tr('Hoàn tất cấu hình Profile', 'Profile configured')}: {profile_name}{RESET}")
    print(f"{DIM}{tr('Mọi yêu cầu tương tác và kiểm tra hồi quy sẽ tự động tuân thủ cấu hình này.', 'Agent sessions and regression checks now follow this profile.')}{RESET}\n")
    return 0

MENU = [
    ("1", "🚗 Automotive", "🚗 Xe hơi (Automotive)",
     "Android Automotive OS, IVI, Flyme Auto, CAN bus, steering-wheel keys, split-screen.",
     "Android Automotive OS, IVI, Flyme Auto, CAN Bus, vô lăng, split-screen."),
    ("2", "📱 Android (Mobile App)", "📱 Android (Mobile App)",
     "Solo-dev workflow, anti-spam debounce, Jetpack Compose, mobile safety, ANR/OOM.",
     "Solo-Dev workflow, anti-spam debounce, Jetpack Compose, an toàn mobile, ANR/OOM."),
    ("3", "🎮 Game (Unity 6 & Blender)", "🎮 Game (Unity 6 & Blender)",
     "Unity 6, Blender 3D, GC memory leaks, DrawCall batching, mesh topology.",
     "Unity 6, Blender 3D, GC memory leak, DrawCall batching, mesh topology."),
    ("4", "🌐 Universal (General / Clean Arch)", "🌐 Universal (General / Clean Arch)",
     "Full-stack, Clean Architecture, TDD paired oracle, zero secret leakage.",
     "Full-Stack, Clean Architecture, TDD Paired Oracle, Zero Secret Leakage."),
    ("5", "🎙️ Voice Assistant", "🎙️ Trợ lý Giọng nói (Voice Assistant)",
     "Edge AI, speech-to-text, audio processing, AEC/VAD, streaming latency < 300ms.",
     "Edge AI, Speech-to-Text, Audio Processing, AEC/VAD, độ trễ streaming < 300ms."),
    ("6", "🍏 iOS (Swift / SwiftUI / Swift Concurrency / XCTest)", "🍏 iOS (Swift / SwiftUI / Swift Concurrency / XCTest)",
     "Swift 6, SwiftUI 120 FPS, @MainActor, no [weak self] retain cycles, leaks CLI.",
     "Swift 6, SwiftUI 120 FPS, @MainActor, triệt tiêu [weak self] retain cycle, leaks CLI."),
    ("7", "🕸️ Web (Frontend / Full-Stack JS)", "🕸️ Web (Frontend / Full-Stack JS)",
     "React/Next.js/Vue/Svelte, strict TypeScript, Core Web Vitals, WCAG AA, XSS/CSRF.",
     "React/Next.js/Vue/Svelte, TypeScript strict, Core Web Vitals, WCAG AA, XSS/CSRF."),
    ("8", "🗄️ Backend (API / Services)", "🗄️ Backend (API / Services)",
     "API contracts, idempotency, safe migrations, timeouts/retries, structured logs.",
     "Hợp đồng API, idempotency, migration an toàn, timeout/retry, log có cấu trúc."),
]


def show_interactive_menu(target_dir_str: str = None, lang: str = None):
    print(f"\n{BOLD}{CYAN}══════════════════════════════════════════════════════════════════════{RESET}")
    print(f"{BOLD}{CYAN}       🎯 Universal Agent DevKit — Profile Configuration              {RESET}")
    print(f"{BOLD}{CYAN}══════════════════════════════════════════════════════════════════════{RESET}\n")

    current = get_current_profile(target_dir_str)
    print(f"  {DIM}{tr('Profile đang kích hoạt hiện tại:', 'Currently active profile:')}{RESET} {BOLD}{CYAN}{current.upper()}{RESET}\n")
    print(f"  {tr('Vui lòng chọn 1 trong các Option cấu hình chuyên biệt:', 'Choose one of the profiles:')}\n")
    for key, title_en, title_vi, desc_en, desc_vi in MENU:
        print(f"    {BOLD}[{key}] {tr(title_vi, title_en)}{RESET}")
        print(f"        {DIM}{tr(desc_vi, desc_en)}{RESET}\n")
    print(f"    {DIM}[q] {tr('Thoát mà không thay đổi', 'Quit without changes')}{RESET}\n")

    keys = ", ".join(k for k, *_ in MENU)
    try:
        choice = input(f"{BOLD}{tr('Nhập lựa chọn của bạn', 'Your choice')} ({keys}): {RESET}").strip().lower()
    except (EOFError, KeyboardInterrupt):
        print("\n" + tr("Đã hủy.", "Cancelled."))
        return 0

    if choice in ("q", "quit", "exit"):
        print(tr("Đã thoát.", "Exited."))
        return 0

    if choice in PROFILES:
        return apply_profile(PROFILES[choice], target_dir_str, lang)
    log_err(tr(f"Lựa chọn không hợp lệ: `{choice}`. Vui lòng nhập {keys}.",
               f"Invalid choice: `{choice}`. Enter one of {keys}."))
    return 1

def normalize_profile(value):
    return PROFILES.get(value.strip().lower()) if value else None


def main():
    parser = argparse.ArgumentParser(
        description="Universal Agent DevKit Profile Configurator",
        epilog="agent-kit profile android | agent-kit profile -p game -t ~/proj | agent-kit profile --status")
    parser.add_argument("profile_pos", nargs="?", metavar="PROFILE",
                        help="Profile name, alias or number (case-insensitive)")
    parser.add_argument("-p", "--profile",
                        help="Profile name or number (1=automotive, 2=android, 3=game, 4=universal, 5=voice-assistant, "
                             "6=ios, 7=web, 8=backend; aliases: "
                             + ", ".join(sorted(k for k in PROFILES if not k.isdigit())) + ")")
    parser.add_argument("-t", "--target", help="Target project directory (default: git root of the current directory)")
    parser.add_argument("-s", "--status", action="store_true", help="Show the active profile")
    parser.add_argument("-l", "--lang", choices=["en", "vi"],
                        help="Output language (default: $DEVKIT_LANG, then the project's saved language, then vi)")
    args = parser.parse_args()

    target_for_lang, _ = resolve_target(args.target, for_write=False)
    set_lang(resolve_lang(args.lang, target_for_lang))

    if args.status:
        current = get_current_profile(args.target)
        meta = load_profile_meta(current)
        print(f"\n{BOLD}{tr('Profile hiện tại:', 'Current profile:')}{RESET} {GREEN}{pick(meta, 'name') or current}{RESET}")
        print(f"{DIM}{pick(meta, 'description')}{RESET}\n")
        return 0

    if args.profile and args.profile_pos and normalize_profile(args.profile) != normalize_profile(args.profile_pos):
        log_err(tr(f"Hai profile mâu thuẫn: `{args.profile}` và `{args.profile_pos}`",
                   f"Conflicting profiles: `{args.profile}` and `{args.profile_pos}`"))
        return 2
    requested = args.profile or args.profile_pos
    if requested:
        target = normalize_profile(requested)
        if target:
            return apply_profile(target, args.target, args.lang)
        valid = sorted(set(PROFILES.values()))
        log_err(tr(f"Profile không hợp lệ: `{requested}`. Hợp lệ: {', '.join(valid)} (hoặc alias/mã số 1-8)",
                   f"Invalid profile: `{requested}`. Valid: {', '.join(valid)} (or an alias / number 1-8)"))
        return 2

    return show_interactive_menu(args.target, args.lang)


if __name__ == "__main__":
    sys.exit(main())
