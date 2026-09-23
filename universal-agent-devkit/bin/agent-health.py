#!/usr/bin/env python3
"""
Agent Health & Environment Diagnostic CLI Tool
Inspired by alirezarezvani/claude-skills & davila7/claude-code-templates.
100% Standard Library — Zero external dependencies.

Nguyên tắc: mọi dòng ✔ phải đến từ một phép đo thật trong lần chạy này.
Không in con số cố định. Test suite chỉ được tính điểm khi chạy với --run-tests;
mặc định in "tests: not run" và không cộng điểm cho nó.
Output language: --lang > $DEVKIT_LANG > "lang" in .active-profile.json > vi.
"""

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))
from devkit_i18n import resolve_lang, set_lang, tr  # noqa: E402

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
                warn(tr(f"Không đọc được `{cfg}`: {err or 'không phải object'}", f"Cannot read `{cfg}`: {err or 'not an object'}"))
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
        score.check(False, "", tr("Test suite: quá thời gian 900s", "Test suite: timed out after 900s"))
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
    detail = "; ".join(facts) if facts else tr("không trích được số liệu", "no counts found in the output")
    score.check(res.returncode == 0,
                f"Test suite (`agent-kit test`): exit 0 — {detail}",
                f"Test suite (`agent-kit test`): exit {res.returncode} — {detail}")
    if res.returncode != 0:
        tail = "\n".join(out.strip().splitlines()[-15:])
        print(f"{DIM}{tail}{RESET}")


def main(argv=None):
    parser = argparse.ArgumentParser(description="Universal Agent DevKit health diagnostic")
    parser.add_argument("--run-tests", action="store_true",
                        help="Run the real test suite (`agent-kit test`) and include it in the score")
    parser.add_argument("-t", "--target", help="Project to check (default: git root of the current directory)")
    parser.add_argument("-l", "--lang", choices=["en", "vi"],
                        help="Output language (default: $DEVKIT_LANG, then the project's saved language, then vi)")
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
    set_lang(resolve_lang(args.lang, target))

    print(f"\n{BOLD}{CYAN}══════════════════════════════════════════════════════════════════════{RESET}")
    print(f"{BOLD}{CYAN}      🚀 Universal Agent DevKit — Health Diagnostic                   {RESET}")
    print(f"{BOLD}{CYAN}══════════════════════════════════════════════════════════════════════{RESET}")
    info(f"DevKit: {BASE_DIR}")
    info(f"{tr('Dự án: ', 'Project:')} {target}")

    score = Score()

    # 1. Runtime
    section(tr("[1/6] Môi trường & Runtime", "[1/6] Environment & runtime"))
    py_ver = ".".join(map(str, sys.version_info[:3]))
    score.check(sys.version_info >= (3, 9), f"Python v{py_ver}", tr(f"Python v{py_ver} (yêu cầu >= 3.9)", f"Python v{py_ver} (requires >= 3.9)"))
    score.check(shutil.which("git") is not None, tr("git có trong $PATH", "git is on $PATH"), tr("git không có trong $PATH", "git is not on $PATH"))
    score.check(shutil.which("jq") is not None, tr("jq có trong $PATH (hooks dùng jq)", "jq is on $PATH (used by hooks)"),
                tr("jq không có trong $PATH (một số hook cần jq)", "jq is not on $PATH (some hooks need it)"), warn_only=True)
    if shutil.which("node"):
        info(tr("node có trong $PATH (cần cho workflow tests)", "node is on $PATH (needed by the workflow tests)"))
    else:
        warn(tr("node không có trong $PATH — workflow tests sẽ không chạy được", "node is not on $PATH — the workflow tests cannot run"))
    ocr_bin = shutil.which("ocr")
    if ocr_bin:
        try:
            res = subprocess.run([ocr_bin, "--version"], capture_output=True, text=True, timeout=5)
            info(f"OpenCodeReview (`ocr`, {tr('tuỳ chọn', 'optional')}): {(res.stdout.strip().splitlines() or ['?'])[0]}")
        except (OSError, subprocess.SubprocessError) as e:
            warn(tr(f"Không đọc được phiên bản ocr: {e}", f"Cannot read the ocr version: {e}"))
    else:
        info(tr("OpenCodeReview (`ocr`, tuỳ chọn): chưa cài — không tính điểm", "OpenCodeReview (`ocr`, optional): not installed — not scored"))

    # 2. Active profile
    section(tr("[2/6] Profile đang kích hoạt", "[2/6] Active profile"))
    profiles = sorted(p.name for p in (BASE_DIR / "profiles").iterdir()
                      if (p / "profile.json").is_file()) if (BASE_DIR / "profiles").is_dir() else []
    info(tr(f"Có {len(profiles)} profile trong DevKit: {', '.join(profiles)}", f"{len(profiles)} profiles in the DevKit: {', '.join(profiles)}"))
    active_file = target / ".active-profile.json"
    active_id, profile_meta = None, {}
    if active_file.is_file():
        data, err = load_json(active_file)
        active_id = (data or {}).get("profile") if not err else None
        ok = active_id in profiles
        score.check(ok, tr(f"Profile của dự án: {active_id}", f"Project profile: {active_id}"),
                    tr(f"`.active-profile.json` không hợp lệ ({err or f'profile `{active_id}` không tồn tại'})",
                       f"`.active-profile.json` is invalid ({err or f'profile `{active_id}` does not exist'})"))
        if ok:
            profile_meta, _ = load_json(BASE_DIR / "profiles" / active_id / "profile.json")
            profile_meta = profile_meta or {}
    else:
        info(tr("Dự án chưa chọn profile (`agent-kit profile <tên>`) — không tính điểm",
                "No profile selected for this project (`agent-kit profile <name>`) — not scored"))

    # 3. Tests
    section("[3/6] Test suite")
    if args.run_tests:
        run_test_suite(score)
    else:
        info(tr("tests: not run (dùng `agent-kit health --run-tests` để chạy thật và tính điểm)",
                "tests: not run (use `agent-kit health --run-tests` to run and score them)"))

    # 4. Self-consistency checks (grep-based) — kiểm DevKit tự nhất quán, không kiểm code dự án
    section(tr("[4/6] Self-consistency checks của DevKit (grep-based)", "[4/6] DevKit self-consistency checks (grep-based)"))
    for name in SELF_CONSISTENCY_SCRIPTS:
        script = BASE_DIR / "scripts" / name
        if not script.is_file():
            score.check(False, "", tr(f"Thiếu script `{name}`", f"Missing script `{name}`"))
            continue
        try:
            res = subprocess.run([sys.executable, str(script)], capture_output=True, text=True, timeout=60)
            m = re.search(r"(\d+)/(\d+) checks passed", res.stdout)
            detail = f"{m.group(1)}/{m.group(2)} checks" if m else f"exit {res.returncode}"
            score.check(res.returncode == 0, f"`{name}`: {detail}", f"`{name}`: {detail}")
        except (OSError, subprocess.SubprocessError) as e:
            score.check(False, "", tr(f"`{name}` lỗi khi chạy: {e}", f"`{name}` failed to run: {e}"))

    # 5. Catalog: rules, skills, councils
    section("[5/6] Rules, Skills & Councils")
    rules_dir = BASE_DIR / "rules"
    rule_files = sorted(rules_dir.glob("*.md")) if rules_dir.is_dir() else []
    broken_rules = [r.name for r in rule_files if r.is_symlink() and not r.exists()]
    rule_links = [r for r in rule_files if r.is_symlink()]
    score.check((rules_dir / "core-rules.md").is_file() and not broken_rules,
                tr(f"`rules/`: {len(rule_files)} file ({len(rule_links)} symlink profile rules), 0 link hỏng",
                   f"`rules/`: {len(rule_files)} files ({len(rule_links)} profile-rule symlinks), 0 broken links"),
                tr(f"`rules/` thiếu core-rules.md hoặc có link hỏng: {broken_rules}",
                   f"`rules/` lacks core-rules.md or has broken links: {broken_rules}"))
    missing_profile_rules = [p for p in profiles if not (rules_dir / f"{p}-rules.md").exists()]
    score.check(not missing_profile_rules,
                tr(f"Mọi profile ({len(profiles)}) đều có rules trong `rules/`", f"Every profile ({len(profiles)}) has rules in `rules/`"),
                tr(f"Profile thiếu rules trong `rules/`: {missing_profile_rules}", f"Profiles without rules in `rules/`: {missing_profile_rules}"))

    skills_dir = BASE_DIR / "skills"
    skills = [s for s in skills_dir.iterdir() if s.is_dir() and (s / "SKILL.md").is_file()] \
        if skills_dir.is_dir() else []
    score.check(bool(skills), tr(f"{len(skills)} skill có SKILL.md trong `skills/`", f"{len(skills)} skills with SKILL.md in `skills/`"),
                tr("Không tìm thấy skill nào", "No skills found"))
    agents_skills_dir = BASE_DIR / ".agents" / "skills"
    if agents_skills_dir.is_dir():
        entries = list(agents_skills_dir.iterdir())
        broken = [e.name for e in entries if e.is_symlink() and not e.exists()]
        absolute = [e.name for e in entries if e.is_symlink() and str(e.readlink()).startswith("/")]
        score.check(not broken and not absolute,
                    tr(f"`.agents/skills/`: {len(entries)} mục, 0 link hỏng, 0 link tuyệt đối",
                       f"`.agents/skills/`: {len(entries)} entries, 0 broken, 0 absolute links"),
                    tr(f"`.agents/skills/`: hỏng {broken}, tuyệt đối {absolute}", f"`.agents/skills/`: broken {broken}, absolute {absolute}"))
    else:
        warn(tr("`.agents/skills/` chưa được khởi tạo", "`.agents/skills/` is not initialised"))

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
                tr(f"{len(names)} council, không trùng `name`, mọi `active_councils` đều tồn tại",
                   f"{len(names)} councils, no duplicate `name`, every `active_councils` entry exists"),
                tr(f"Council trùng name {dupes} / thiếu {missing_councils}", f"Councils with duplicate name {dupes} / missing {missing_councils}"))

    # 6. MCP & regression matrix — chỉ đòi MCP của profile đang active
    section(tr("[6/6] MCP & Ma trận hồi quy", "[6/6] MCP & regression matrix"))
    mcps, sources = configured_mcps(target)
    if sources:
        info(tr(f"MCP khai báo ({len(mcps)}) từ: {', '.join(sources)}", f"Configured MCPs ({len(mcps)}) from: {', '.join(sources)}"))
    required = profile_meta.get("essential_mcps", []) if active_id else []
    if required:
        missing = [m for m in required if m not in mcps]
        score.check(not missing, tr(f"Đủ MCP của profile `{active_id}`: {', '.join(required)}", f"All MCPs of profile `{active_id}` configured: {', '.join(required)}"),
                    tr(f"Thiếu MCP của profile `{active_id}`: {', '.join(missing)}", f"Missing MCPs of profile `{active_id}`: {', '.join(missing)}"), warn_only=True)
    else:
        info(tr("Không có profile active → không đòi MCP cụ thể", "No active profile → no specific MCP required"))

    template = BASE_DIR / "templates" / "regression_matrix.json"
    _, err = load_json(template)
    score.check(err is None, tr("Template `templates/regression_matrix.json` parse được", "Template `templates/regression_matrix.json` parses"),
                tr(f"Template ma trận lỗi: {err}", f"Matrix template is invalid: {err}"))
    if active_id:
        candidates = [target / ".agents" / "regression_matrix.active.json",
                      target / "templates" / "regression_matrix.active.json"]
        active_matrix = next((c for c in candidates if c.is_file()), None)
        if active_matrix:
            _, err = load_json(active_matrix)
            score.check(err is None, tr(f"Ma trận active parse được: {active_matrix.relative_to(target)}", f"Active matrix parses: {active_matrix.relative_to(target)}"),
                        tr(f"Ma trận active lỗi: {err}", f"Active matrix is invalid: {err}"))
        else:
            score.check(False, "", tr("Profile đã chọn nhưng chưa có `.agents/regression_matrix.active.json`",
                                      "A profile is selected but `.agents/regression_matrix.active.json` is missing"))

    # Score
    pct = int(score.passed * 100 / score.total) if score.total else 0
    print(f"\n{BOLD}{CYAN}──────────────────────────────────────────────────────────────────────{RESET}")
    if pct == 100:
        badge = f"{GREEN}{BOLD}PASS{RESET}"
    elif pct >= 90:
        badge = f"{GREEN}{BOLD}PASS ({tr('có mục chưa đạt', 'some checks failed')}){RESET}"
    elif pct >= 70:
        badge = f"{YELLOW}{BOLD}WARNING{RESET}"
    else:
        badge = f"{RED}{BOLD}FAIL{RESET}"
    print(f"  {BOLD}{tr('Kết quả:', 'Result:')}{RESET} {badge}  |  {tr('Điểm', 'Score')}: {pct}/100  "
          f"({score.passed}/{score.total} {tr('hạng mục đã đo', 'checks measured')})")
    if not args.run_tests:
        print(f"  {DIM}{tr('tests: not run — điểm này KHÔNG bao gồm test suite.', 'tests: not run — this score does NOT include the test suite.')}{RESET}")
    print(f"{BOLD}{CYAN}══════════════════════════════════════════════════════════════════════{RESET}\n")
    return 0 if pct >= 90 else 1


if __name__ == "__main__":
    sys.exit(main())
