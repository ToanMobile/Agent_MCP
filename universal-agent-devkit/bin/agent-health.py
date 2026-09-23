#!/usr/bin/env python3
"""
Agent Health & Environment Diagnostic CLI Tool
Inspired by alirezarezvani/claude-skills & davila7/claude-code-templates.
100% Standard Library — Zero external dependencies.

Nguyên tắc: mọi dòng ✔ phải đến từ một phép đo thật trong lần chạy này.
Không in con số cố định. Test suite chỉ được tính điểm khi chạy với --run-tests;
mặc định in "tests: not run" và không cộng điểm cho nó.
"""

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path

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

BASE_DIR = Path(__file__).resolve().parent.parent

SELF_CONSISTENCY_SCRIPTS = [
    "audit_test_suite_50_agents.py",
    "audit_workflows_rules_skills_50_agents.py",
    "audit_zero_regression_10_agents.py",
]


class Score:
    def __init__(self):
        self.passed = 0
        self.total = 0

    def check(self, ok: bool, ok_msg: str, fail_msg: str, warn_only: bool = False):
        self.total += 1
        if ok:
            self.passed += 1
            print(f"  {GREEN}✔{RESET} {ok_msg}")
        elif warn_only:
            print(f"  {YELLOW}⚠{RESET} {fail_msg}")
        else:
            print(f"  {RED}✖{RESET} {fail_msg}")
        return ok


def info(msg):
    print(f"  {DIM}•{RESET} {msg}")


def warn(msg):
    print(f"  {YELLOW}⚠{RESET} {msg}")


def section(title):
    print(f"\n{BOLD}{title}{RESET}")


def git_root(start: Path):
    try:
        res = subprocess.run(["git", "-C", str(start), "rev-parse", "--show-toplevel"],
                             capture_output=True, text=True, timeout=5)
        if res.returncode == 0 and res.stdout.strip():
            return Path(res.stdout.strip())
    except (OSError, subprocess.SubprocessError):
        pass
    return None


def load_json(path: Path):
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f), None
    except (OSError, ValueError) as e:
        return None, str(e)


def configured_mcps(target: Path):
    names, sources = set(), []
    for cfg in (target / ".mcp.json", target / "mcp_config.json",
                Path.home() / ".gemini" / "config" / "mcp_config.json"):
        if cfg.is_file():
            data, err = load_json(cfg)
            if err or not isinstance(data, dict):
                warn(f"Không đọc được `{cfg}`: {err or 'không phải object'}")
                continue
            names.update((data.get("mcpServers") or {}).keys())
            sources.append(str(cfg))
    return names, sources


def run_test_suite(score: Score):
    """Chạy test thật qua `agent-kit test`; điểm phụ thuộc exit code thật."""
    # AGENT_HEALTH_TEST_CMD cho phép test của chính health thay suite bằng lệnh giả (tránh đệ quy).
    override = os.environ.get("AGENT_HEALTH_TEST_CMD")
    cmd = ["bash", "-c", override] if override else ["bash", str(BASE_DIR / "bin" / "agent-kit"), "test"]
    try:
        res = subprocess.run(cmd, capture_output=True, text=True, timeout=900, cwd=str(BASE_DIR))
    except subprocess.TimeoutExpired:
        score.check(False, "", "Test suite: quá thời gian 900s")
        return
    out = res.stdout + res.stderr
    facts = []
    m = re.search(r"contract points:\s*(\d+)\s*ok,\s*(\d+)\s*deviating", out)
    if m:
        facts.append(f"hook contract {m.group(1)} ok / {m.group(2)} deviating")
    p = re.findall(r"^# pass (\d+)", out, re.M)
    f = re.findall(r"^# fail (\d+)", out, re.M)
    if p:
        facts.append(f"workflow {sum(map(int, p))} pass / {sum(map(int, f)) if f else 0} fail")
    detail = "; ".join(facts) if facts else "không trích được số liệu"
    score.check(res.returncode == 0,
                f"Test suite (`agent-kit test`): exit 0 — {detail}",
                f"Test suite (`agent-kit test`): exit {res.returncode} — {detail}")
    if res.returncode != 0:
        tail = "\n".join(out.strip().splitlines()[-15:])
        print(f"{DIM}{tail}{RESET}")


def main(argv=None):
    parser = argparse.ArgumentParser(description="Universal Agent DevKit health diagnostic")
    parser.add_argument("--run-tests", action="store_true",
                        help="Chạy test suite thật (`agent-kit test`) và tính vào điểm")
    parser.add_argument("-t", "--target", help="Dự án cần kiểm tra (mặc định: git root của thư mục hiện tại)")
    args = parser.parse_args(argv)

    if args.target:
        target = Path(args.target).expanduser().resolve()
    else:
        cwd = Path.cwd().resolve()
        try:
            cwd.relative_to(BASE_DIR)
            target = BASE_DIR  # đứng trong DevKit → kiểm chính DevKit
        except ValueError:
            target = (git_root(cwd) or cwd).resolve()

    print(f"\n{BOLD}{CYAN}══════════════════════════════════════════════════════════════════════{RESET}")
    print(f"{BOLD}{CYAN}      🚀 Universal Agent DevKit — Health Diagnostic                   {RESET}")
    print(f"{BOLD}{CYAN}══════════════════════════════════════════════════════════════════════{RESET}")
    info(f"DevKit: {BASE_DIR}")
    info(f"Dự án:  {target}")

    score = Score()

    # 1. Runtime
    section("[1/6] Môi trường & Runtime")
    py_ver = ".".join(map(str, sys.version_info[:3]))
    score.check(sys.version_info >= (3, 9), f"Python v{py_ver}", f"Python v{py_ver} (yêu cầu >= 3.9)")
    score.check(shutil.which("git") is not None, "git có trong $PATH", "git không có trong $PATH")
    score.check(shutil.which("jq") is not None, "jq có trong $PATH (hooks dùng jq)",
                "jq không có trong $PATH (một số hook cần jq)", warn_only=True)
    if shutil.which("node"):
        info("node có trong $PATH (cần cho workflow tests)")
    else:
        warn("node không có trong $PATH — workflow tests sẽ không chạy được")
    ocr_bin = shutil.which("ocr")
    if ocr_bin:
        try:
            res = subprocess.run([ocr_bin, "--version"], capture_output=True, text=True, timeout=5)
            info(f"OpenCodeReview (`ocr`, tuỳ chọn): {(res.stdout.strip().splitlines() or ['?'])[0]}")
        except (OSError, subprocess.SubprocessError) as e:
            warn(f"Không đọc được phiên bản ocr: {e}")
    else:
        info("OpenCodeReview (`ocr`, tuỳ chọn): chưa cài — không tính điểm")

    # 2. Active profile
    section("[2/6] Profile đang kích hoạt")
    profiles = sorted(p.name for p in (BASE_DIR / "profiles").iterdir()
                      if (p / "profile.json").is_file()) if (BASE_DIR / "profiles").is_dir() else []
    info(f"Có {len(profiles)} profile trong DevKit: {', '.join(profiles)}")
    active_file = target / ".active-profile.json"
    active_id, profile_meta = None, {}
    if active_file.is_file():
        data, err = load_json(active_file)
        active_id = (data or {}).get("profile") if not err else None
        ok = active_id in profiles
        score.check(ok, f"Profile của dự án: {active_id}",
                    f"`.active-profile.json` không hợp lệ ({err or f'profile `{active_id}` không tồn tại'})")
        if ok:
            profile_meta, _ = load_json(BASE_DIR / "profiles" / active_id / "profile.json")
            profile_meta = profile_meta or {}
    else:
        info("Dự án chưa chọn profile (`agent-kit profile <tên>`) — không tính điểm")

    # 3. Tests
    section("[3/6] Test suite")
    if args.run_tests:
        run_test_suite(score)
    else:
        info("tests: not run (dùng `agent-kit health --run-tests` để chạy thật và tính điểm)")

    # 4. Self-consistency checks (grep-based) — kiểm DevKit tự nhất quán, không kiểm code dự án
    section("[4/6] Self-consistency checks của DevKit (grep-based)")
    for name in SELF_CONSISTENCY_SCRIPTS:
        script = BASE_DIR / "scripts" / name
        if not script.is_file():
            score.check(False, "", f"Thiếu script `{name}`")
            continue
        try:
            res = subprocess.run([sys.executable, str(script)], capture_output=True, text=True, timeout=60)
            m = re.search(r"(\d+)/(\d+) checks passed", res.stdout)
            detail = f"{m.group(1)}/{m.group(2)} checks" if m else f"exit {res.returncode}"
            score.check(res.returncode == 0, f"`{name}`: {detail}", f"`{name}`: {detail}")
        except (OSError, subprocess.SubprocessError) as e:
            score.check(False, "", f"`{name}` lỗi khi chạy: {e}")

    # 5. Catalog: rules, skills, councils
    section("[5/6] Rules, Skills & Councils")
    rules_dir = BASE_DIR / "rules"
    rule_files = sorted(rules_dir.glob("*.md")) if rules_dir.is_dir() else []
    broken_rules = [r.name for r in rule_files if r.is_symlink() and not r.exists()]
    rule_links = [r for r in rule_files if r.is_symlink()]
    score.check((rules_dir / "core-rules.md").is_file() and not broken_rules,
                f"`rules/`: {len(rule_files)} file ({len(rule_links)} symlink profile rules), 0 link hỏng",
                f"`rules/` thiếu core-rules.md hoặc có link hỏng: {broken_rules}")
    missing_profile_rules = [p for p in profiles if not (rules_dir / f"{p}-rules.md").exists()]
    score.check(not missing_profile_rules, f"Mọi profile ({len(profiles)}) đều có rules trong `rules/`",
                f"Profile thiếu rules trong `rules/`: {missing_profile_rules}")

    skills_dir = BASE_DIR / "skills"
    skills = [s for s in skills_dir.iterdir() if s.is_dir() and (s / "SKILL.md").is_file()] \
        if skills_dir.is_dir() else []
    score.check(bool(skills), f"{len(skills)} skill có SKILL.md trong `skills/`", "Không tìm thấy skill nào")
    agents_skills_dir = BASE_DIR / ".agents" / "skills"
    if agents_skills_dir.is_dir():
        entries = list(agents_skills_dir.iterdir())
        broken = [e.name for e in entries if e.is_symlink() and not e.exists()]
        absolute = [e.name for e in entries if e.is_symlink() and str(e.readlink()).startswith("/")]
        score.check(not broken and not absolute,
                    f"`.agents/skills/`: {len(entries)} mục, 0 link hỏng, 0 link tuyệt đối",
                    f"`.agents/skills/`: hỏng {broken}, tuyệt đối {absolute}")
    else:
        warn("`.agents/skills/` chưa được khởi tạo")

    councils_dir = BASE_DIR / "agents" / "councils"
    names = {}
    for f in sorted(councils_dir.glob("*.md")) if councils_dir.is_dir() else []:
        m = re.search(r"^name:\s*(\S+)", f.read_text(encoding="utf-8", errors="replace"), re.M)
        if m:
            names.setdefault(m.group(1), []).append(f.name)
    dupes = {k: v for k, v in names.items() if len(v) > 1}
    missing_councils = []
    for p in profiles:
        meta, _ = load_json(BASE_DIR / "profiles" / p / "profile.json")
        for c in (meta or {}).get("active_councils", []):
            if not ((councils_dir / c).is_file() or (BASE_DIR / "profiles" / p / "councils" / c).is_file()):
                missing_councils.append(f"{p}:{c}")
    score.check(not dupes and not missing_councils,
                f"{len(names)} council, không trùng `name`, mọi `active_councils` đều tồn tại",
                f"Council trùng name {dupes} / thiếu {missing_councils}")

    # 6. MCP & regression matrix — chỉ đòi MCP của profile đang active
    section("[6/6] MCP & Ma trận hồi quy")
    mcps, sources = configured_mcps(target)
    if sources:
        info(f"MCP khai báo ({len(mcps)}) từ: {', '.join(sources)}")
    required = profile_meta.get("essential_mcps", []) if active_id else []
    if required:
        missing = [m for m in required if m not in mcps]
        score.check(not missing, f"Đủ MCP của profile `{active_id}`: {', '.join(required)}",
                    f"Thiếu MCP của profile `{active_id}`: {', '.join(missing)}", warn_only=True)
    else:
        info("Không có profile active → không đòi MCP cụ thể")

    template = BASE_DIR / "templates" / "regression_matrix.json"
    _, err = load_json(template)
    score.check(err is None, "Template `templates/regression_matrix.json` parse được",
                f"Template ma trận lỗi: {err}")
    if active_id:
        candidates = [target / ".agents" / "regression_matrix.active.json",
                      target / "templates" / "regression_matrix.active.json"]
        active_matrix = next((c for c in candidates if c.is_file()), None)
        if active_matrix:
            _, err = load_json(active_matrix)
            score.check(err is None, f"Ma trận active parse được: {active_matrix.relative_to(target)}",
                        f"Ma trận active lỗi: {err}")
        else:
            score.check(False, "", "Profile đã chọn nhưng chưa có `.agents/regression_matrix.active.json`")

    # Score
    pct = int(score.passed * 100 / score.total) if score.total else 0
    print(f"\n{BOLD}{CYAN}──────────────────────────────────────────────────────────────────────{RESET}")
    if pct == 100:
        badge = f"{GREEN}{BOLD}PASS{RESET}"
    elif pct >= 90:
        badge = f"{GREEN}{BOLD}PASS (có mục chưa đạt){RESET}"
    elif pct >= 70:
        badge = f"{YELLOW}{BOLD}WARNING{RESET}"
    else:
        badge = f"{RED}{BOLD}FAIL{RESET}"
    print(f"  {BOLD}Kết quả:{RESET} {badge}  |  Điểm: {pct}/100  ({score.passed}/{score.total} hạng mục đã đo)")
    if not args.run_tests:
        print(f"  {DIM}tests: not run — điểm này KHÔNG bao gồm test suite.{RESET}")
    print(f"{BOLD}{CYAN}══════════════════════════════════════════════════════════════════════{RESET}\n")
    return 0 if pct >= 90 else 1


if __name__ == "__main__":
    sys.exit(main())
