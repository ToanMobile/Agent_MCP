#!/usr/bin/env python3
"""
Post-Fix Audit & Regression Verification Gate CLI Tool
Universal Agent DevKit — Automated Quality & TIA Regression Shield

Audits the working-tree changes after a bug fix:
  - Regex heuristics: secrets, lazy placeholders, perf, swallowed errors, raw logging
  - TIA: maps changed files to regression tests from regression_matrix.json and,
    with --run-tests, executes them and records the real exit code and duration
  - Reports only what was actually checked. RED/GREEN oracle receipts, immutable
    guards and OpenCodeReview are listed as "not verified here".

Only the 5 regex checks and the regression run (--run-tests) decide the verdict; the
other sections are reminders. Regression commands are read from the base ref, so the
audited change cannot rewrite them.

Exit codes: 0 PASS, 1 REJECT, 2 UNVERIFIED (tests not run, matrix untrusted, existing
test edited, unreadable file, no coverage, bad --diff), 3 nothing to audit.

100% Standard Library — Zero external dependencies.
"""

import argparse
import fnmatch
import hashlib
import json
import os
import re
import shutil
import signal
import subprocess
import tempfile
import sys
import time
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

# Key names whose assigned value is treated as a credential. A prefix is allowed
# (DB_PASSWORD, ghToken), a suffix is not (passwordHint, tokenType).
_SECRET_KEY = r"[\w.\-]*?(?:api[_\-]?key|apikey|access[_\-]?token|auth[_\-]?token|refresh[_\-]?token|token|client[_\-]?secret|secret|password|passwd|pwd|private[_\-]?key|keystore[_\-]?password|key[_\-]?password|signing[_\-]?key[_\-]?password|keystore[_\-]?base64)"

# (pattern, label, value-group or None). Values with a group are checked against
# PLACEHOLDER_VALUE so `password = ${DB_PASSWORD}` or `api_key = "changeme"` pass.
SECRET_PATTERNS = [
    (r"(?i)\b" + _SECRET_KEY + r"[\"']?\s*[:=]\s*[\"']([^\"'\s]{8,})[\"']", "Hardcoded API Key / Secret", 1),
    (r"-----BEGIN [A-Z ]*PRIVATE KEY( BLOCK)?-----", "Private Key Block", None),
    (r"\b(AKIA|ASIA)[0-9A-Z]{16}\b", "AWS Access Key ID", None),
    (r"\bgh[pousr]_[A-Za-z0-9]{36,}\b", "GitHub Token", None),
    (r"\bgithub_pat_[A-Za-z0-9_]{22,}\b", "GitHub Fine-grained Token", None),
    (r"\bxox[abprs]-[A-Za-z0-9-]{10,}", "Slack Token", None),
    (r"\bAIza[0-9A-Za-z_\-]{35}\b", "Google API Key", None),
    (r"\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}", "JSON Web Token", None),
]

# Unquoted `key = value` only in config-style files, where it is the normal syntax
# (in code an unquoted right-hand side is an expression, not a literal).
CONFIG_SECRET_PATTERN = (r"(?im)^\s*(?:export\s+)?" + _SECRET_KEY + r"\s*[:=]\s*([^\s\"'#]{8,})\s*$",
                         "Hardcoded Secret (config file)", 1)
CONFIG_EXTENSIONS = (".properties", ".env", ".yml", ".yaml", ".ini", ".cfg", ".conf", ".toml")

PLACEHOLDER_VALUE = re.compile(
    r"(?i)^(\$.*|<.*>|\{\{.*|%.*|x{4,}|\*{4,}|your[_\-].*|change[_\-]?me|placeholder|redacted|example.*|dummy.*|none|null|true|false)$")

FORBIDDEN_SECRET_FILES = [
    (r"\.(keystore|jks|p12|pfx|mobileprovision)$", "Chứng chỉ ký số trần (*.keystore, *.jks, *.p12, *.mobileprovision)"),
    (r"google-services\.json$", "Tệp cấu hình Firebase/Google Services production (google-services.json)"),
    (r"GoogleService-Info\.plist$", "Tệp cấu hình Firebase iOS nhạy cảm (GoogleService-Info.plist)"),
    (r"\.(pem|key)$", "Khóa mật mã riêng tư trần (*.pem, *.key)"),
    (r"(^|/)(\.env(\.[a-zA-Z0-9_-]+)?|[\w.-]+\.env)$", "Tệp cấu hình biến môi trường (.env, *.env)"),
]

# Only an exact template suffix exempts a file (`.env.example`); a directory named
# `sample/` or `templates/` does not.
SAFE_TEMPLATE_SUFFIXES = (".example", ".sample", ".template", ".dist")

LAZY_CODE_PATTERNS = [
    (r"(?i)//\s*\.\.\.\s*(existing|rest|remaining)", "Lazy placeholder (// ... existing code ...)"),
    (r"(?i)/\*\s*\.\.\.\s*(existing|rest|remaining)\s*\*/", "Lazy placeholder (/* ... existing code ... */)"),
    (r"(?i)#\s*\.\.\.\s*(existing|rest|remaining)", "Lazy placeholder (# ... existing code ...)"),
    (r"(?i)//\s*TODO:?\s*implement\s+rest", "Lazy TODO placeholder (// TODO: implement rest)")
]

UI_EXTENSIONS = {".kt", ".java", ".tsx", ".jsx", ".dart", ".vue", ".swift", ".xml"}
CODE_EXTENSIONS = UI_EXTENSIONS | {".py", ".ts", ".js", ".go", ".rs", ".cpp", ".c", ".h", ".cs", ".shader", ".hlsl"}

PERF_ANTIPATTERN_PATTERNS = [
    (r"(?i)\bThread\.sleep\(", "Chặn luồng đồng bộ (Thread.sleep) trên UI/Main Thread"),
    (r"(?i)\brunBlocking\s*\{", "Chặn luồng coroutine bằng runBlocking trên Main Thread"),
    (r"(?i)static\s+(var\s+|val\s+|[a-zA-Z0-9_<>]+)\s+(mContext|context|activity)\b", "Rò rỉ bộ nhớ (Static Activity/Context Leak)"),
    (r"(?i)for\s*\([^)]*in[^)]*list[^)]*\)\s*\{\s*for\s*\([^)]*in[^)]*list[^)]*\)", "Vòng lặp lồng O(N^2) trên mảng động (Cần dùng Map/Set lookup)"),
    (r"(?i)\.printStackTrace\(\)", "In stack trace trực tiếp ra console (Gây nghẽn I/O)")
]

RESILIENCE_ANTIPATTERN_PATTERNS = [
    (r"(?s)catch\s*\([^\)]*\)\s*\{\s*\}", "Khối catch rỗng nuốt lỗi âm thầm (Empty catch block)"),
    (r"(?m)^\s*except(\s+[a-zA-Z0-9_]+)?:\s*pass\s*$", "Khối except: pass nuốt lỗi âm thầm"),
]

LOGGING_ANTIPATTERN_PATTERNS = [
    (r"(?i)\bconsole\.log\(", "In log chuỗi trần ra console bằng console.log (Cần dùng Structured Logger)"),
    (r"(?i)\bSystem\.out\.print(ln)?\(", "In chuỗi thô ra console bằng System.out.println (Cần dùng Structured Logger)")
]

TEST_DIR_NAMES = {"test", "tests", "__tests__", "androidtest", "unittest", "integrationtest",
                  "testfixtures", "spec", "specs", "mocks", "__mocks__"}
TEST_FILE_RE = re.compile(r"((Test|Tests|Spec)\.(kt|kts|java|swift|scala|groovy|cs|m|mm)$"
                          r"|(_test|_spec)\.\w+$|\.(test|spec)\.\w+$|^test_[^/]*\.py$)")


def is_test_path(rel_file: str) -> bool:
    """A test source is decided by a directory component or a file-name suffix —
    never by the substring "test" (which would skip src/latest/, contest/, …)."""
    parts = rel_file.replace("\\", "/").split("/")
    if any(p.lower() in TEST_DIR_NAMES for p in parts[:-1]):
        return True
    return bool(TEST_FILE_RE.search(parts[-1]))


def has_dir(rel_file: str, *names) -> bool:
    parts = rel_file.replace("\\", "/").split("/")[:-1]
    return any(p in names for p in parts)


def log_ok(msg):
    print(f"  {GREEN}✔{RESET} {msg}")

def log_warn(msg):
    print(f"  {YELLOW}⚠{RESET} {msg}")

def log_err(msg):
    print(f"  {RED}✖{RESET} {msg}")

def get_devkit_dir() -> Path:
    return Path(__file__).resolve().parent.parent

def get_project_dir() -> Path:
    target_env = os.environ.get("CLAUDE_PROJECT_DIR") or os.environ.get("TARGET_DIR")
    if target_env and Path(target_env).exists():
        return Path(target_env).resolve()
    try:
        res = subprocess.run(["git", "rev-parse", "--show-toplevel"], capture_output=True, text=True)
        if res.returncode == 0 and res.stdout.strip():
            return Path(res.stdout.strip()).resolve()
    except Exception:
        pass
    return Path.cwd().resolve()

def get_base_dir() -> Path:
    return get_project_dir()

def find_matrix_path(matrix_path: str = None):
    proj_dir = get_project_dir()
    devkit_dir = get_devkit_dir()
    candidates = []
    if matrix_path:
        candidates.append(Path(matrix_path))
    # Only the audited project's own matrix counts. The devkit's sample matrix is used
    # only when auditing the devkit itself — never silently for an unrelated project.
    candidates.extend([
        proj_dir / "templates" / "regression_matrix.active.json",
        proj_dir / ".agents" / "active-profile" / "regression_matrix.json",
        proj_dir / "templates" / "regression_matrix.json",
    ])
    if proj_dir == devkit_dir:
        candidates.append(devkit_dir / "templates" / "regression_matrix.json")
    for c in candidates:
        if c.exists():
            return c
    return None


def load_active_matrix(matrix_path: str = None, base_ref: str = "HEAD"):
    """Returns (matrix, trust_problem). The regression commands are what turns a change
    into PASS, so they are read from the base ref — never from a working copy the
    audited change could have edited (`exit 1` -> `true`)."""
    path = find_matrix_path(matrix_path)
    if path is None:
        return {}, None
    try:
        rel = path.resolve().relative_to(get_repo_root()).as_posix()
    except ValueError:
        rel = None
    if rel is None:
        # Outside the audited repo (e.g. the devkit's profile matrix): the change under
        # audit cannot have edited it, read as-is.
        try:
            with open(path, "r", encoding="utf-8") as f:
                return json.load(f), None
        except (OSError, ValueError) as e:
            log_warn(f"Không đọc được regression matrix {path}: {e}")
            return {}, None
    res = subprocess.run(["git", "-C", str(get_repo_root()), "show", f"{base_ref}:{rel}"],
                         capture_output=True)
    if res.returncode != 0:
        return {}, f"regression matrix `{rel}` chưa có trong {base_ref} — lệnh test chưa được commit nên không tin được"
    try:
        matrix = json.loads(res.stdout.decode("utf-8", errors="replace"))
    except ValueError as e:
        return {}, f"regression matrix `{rel}` ở {base_ref} không parse được: {e}"
    try:
        current = path.read_bytes()
    except OSError:
        current = None
    if current != res.stdout:
        return matrix, f"regression matrix `{rel}` bị sửa so với {base_ref} trong thay đổi đang audit — gate chạy lệnh của bản {base_ref}, cần người review"
    return matrix, None


REPO_ROOT = None
PROJECT_PREFIX = None


def get_repo_root() -> Path:
    global REPO_ROOT
    if REPO_ROOT is None:
        res = subprocess.run(["git", "-C", str(get_project_dir()), "rev-parse", "--show-toplevel"],
                             capture_output=True, text=True)
        REPO_ROOT = Path(res.stdout.strip()).resolve() if res.returncode == 0 and res.stdout.strip() else get_project_dir()
    return REPO_ROOT


def get_project_prefix() -> str:
    """Project dir relative to the repo root ("" unless the project is a monorepo subdir)."""
    global PROJECT_PREFIX
    if PROJECT_PREFIX is None:
        res = subprocess.run(["git", "-C", str(get_project_dir()), "rev-parse", "--show-prefix"],
                             capture_output=True, text=True)
        PROJECT_PREFIX = res.stdout.strip() if res.returncode == 0 else ""
    return PROJECT_PREFIX


def resolve_path(rel_file: str) -> Path:
    """Changed-file paths are relative to the project dir (see get_modified_files)."""
    p = Path(rel_file)
    return p if p.is_absolute() else get_project_dir() / p


DELETED_FILES = set()


def _to_project_rel(repo_rel: str):
    prefix = get_project_prefix()
    if prefix and not repo_rel.startswith(prefix):
        return None  # outside the audited project (monorepo sibling)
    return repo_rel[len(prefix):]


def get_modified_files(diff_ref: str = None) -> list:
    """Working-tree changes (+ `git diff <ref>` when given), parsed from -z output so
    quoted names, renames and files inside untracked directories are all resolved.
    Limited to the project dir and returned relative to it, so a monorepo subproject's
    paths match its own regression matrix."""
    proj = str(get_project_dir())
    files = set()
    res = subprocess.run(["git", "-C", proj, "status", "--porcelain=v1", "-z", "-uall", "--", "."],
                         capture_output=True)
    if res.returncode != 0:
        raise RuntimeError(f"git status thất bại trong {proj}: {res.stderr.decode(errors='replace').strip()}")
    entries = res.stdout.decode("utf-8", errors="surrogateescape").split("\0")
    i = 0
    while i < len(entries):
        entry = entries[i]
        i += 1
        if len(entry) < 4:
            continue
        xy, path = entry[:2], _to_project_rel(entry[3:])
        if "R" in xy or "C" in xy:
            i += 1  # the next NUL field is the rename/copy SOURCE; keep the destination
        if path is None:
            continue
        if "D" in xy:
            DELETED_FILES.add(path)
        files.add(path)
    if diff_ref:
        res_diff = subprocess.run(["git", "-C", proj, "diff", "--relative", "--name-status", "-z",
                                   diff_ref, "--", "."], capture_output=True)
        if res_diff.returncode != 0:
            raise RuntimeError(f"git diff {diff_ref} thất bại: {res_diff.stderr.decode(errors='replace').strip()}")
        parts = res_diff.stdout.decode("utf-8", errors="surrogateescape").split("\0")
        j = 0
        while j < len(parts):
            status = parts[j]
            j += 1
            if not status:
                continue
            if status[0] in "RC":
                j += 1  # skip source
            if j < len(parts) and parts[j]:
                if status[0] == "D":
                    DELETED_FILES.add(parts[j])
                files.add(parts[j])
            j += 1
    return sorted(files)


def is_devkit_artifact(rel_file: str) -> bool:
    """Links the devkit installer places (hooks, commands, skills, rules, AGENTS.md…) and
    hook state are not the user's change: they are not scanned and not "unreadable"."""
    clean = rel_file.replace("\\", "/")
    if clean.startswith(".claude/audit-gate/"):
        return True
    full = resolve_path(rel_file)
    if not full.is_symlink():
        return False
    if clean.startswith((".claude/", ".agents/")):
        return True
    try:
        full.resolve().relative_to(get_devkit_dir())
        return True
    except (OSError, ValueError):
        return False


def match_pattern(file_path: str, pattern: str) -> bool:
    clean_path = file_path.replace("\\", "/")
    clean_pat = pattern.replace("\\", "/")
    if fnmatch.fnmatch(clean_path, clean_pat):
        return True
    if clean_pat.startswith("**/") and fnmatch.fnmatch(clean_path, clean_pat[3:]):
        return True
    return False


def run_git_hygiene_audit(modified_files: list) -> tuple:
    secrets_found = []
    for rel_file in modified_files:
        clean_rel = rel_file.replace("\\", "/")
        name = clean_rel.rsplit("/", 1)[-1].lower()
        exempt_name = name.endswith(SAFE_TEMPLATE_SUFFIXES)
        # 1. Kiểm tra tên file nhạy cảm cấm commit (Keystore, JKS, Provisioning, Service Configs)
        if not exempt_name:
            for file_pat, label in FORBIDDEN_SECRET_FILES:
                if re.search(file_pat, clean_rel, re.IGNORECASE):
                    secrets_found.append((rel_file, f"File cấm: {label}"))

        # 2. Kiểm tra nội dung file tìm secret / password / key
        full_path = resolve_path(rel_file)
        if full_path.is_file() and not full_path.is_symlink():
            # Bỏ qua quét nội dung binary hoặc ảnh
            if rel_file.endswith((".pyc", ".png", ".jpg", ".jpeg", ".webp", ".so", ".dylib", ".a", ".jar", ".aar")):
                continue
            try:
                with open(full_path, "r", encoding="utf-8", errors="replace") as f:
                    content = f.read()
            except OSError:
                continue
            patterns = list(SECRET_PATTERNS)
            if name.endswith(CONFIG_EXTENSIONS) or re.search(FORBIDDEN_SECRET_FILES[-1][0], clean_rel):
                patterns.append(CONFIG_SECRET_PATTERN)
            for pat, label, group in patterns:
                for m in re.finditer(pat, content):
                    if group is not None and PLACEHOLDER_VALUE.match(m.group(group)):
                        continue
                    secrets_found.append((rel_file, label))
                    break
    return len(secrets_found) == 0, secrets_found

def run_anti_laziness_audit(modified_files: list) -> tuple:
    lazy_matches = []
    for rel_file in modified_files:
        if is_test_path(rel_file) or has_dir(rel_file, "scripts") or rel_file.endswith(("post-fix-gate.py", "gate.sh")):
            continue
        full_path = resolve_path(rel_file)
        if full_path.is_file() and any(rel_file.endswith(ext) for ext in CODE_EXTENSIONS):
            try:
                with open(full_path, "r", encoding="utf-8", errors="replace") as f:
                    content = f.read()
                for pat, label in LAZY_CODE_PATTERNS:
                    if re.search(pat, content):
                        lazy_matches.append((rel_file, label))
            except Exception:
                pass
    return len(lazy_matches) == 0, lazy_matches

def run_performance_audit(modified_files: list) -> tuple:
    perf_findings = []
    base_dir = get_base_dir()
    devkit_dir = get_devkit_dir()

    # Load AST linters dynamically if available
    check_kotlin_stability = None
    check_unity_gc = None
    try:
        sys.path.insert(0, str(devkit_dir / "scripts"))
        from lint_compose_stability import check_kotlin_file as check_kotlin_stability
        from lint_unity_gc import check_csharp_file as check_unity_gc
    except Exception:
        pass

    for rel_file in modified_files:
        # Exclude tests and build scripts from performance antipattern checks
        if (is_test_path(rel_file) or has_dir(rel_file, "scripts", "bin")
                or rel_file.endswith(("build.gradle", "build.gradle.kts", "pom.xml"))):
            continue
        full_path = resolve_path(rel_file)
        if full_path.is_file() and any(rel_file.endswith(ext) for ext in CODE_EXTENSIONS):
            try:
                with open(full_path, "r", encoding="utf-8", errors="replace") as f:
                    content = f.read()
                for pat, label in PERF_ANTIPATTERN_PATTERNS:
                    if re.search(pat, content):
                        perf_findings.append((rel_file, label))
            except Exception:
                pass

            # AST Compose Stability Check for Kotlin
            if rel_file.endswith(".kt") and check_kotlin_stability:
                try:
                    for v in check_kotlin_stability(full_path):
                        perf_findings.append((rel_file, f"Jetpack Compose: {v}"))
                except Exception:
                    pass

            # AST Unity Zero-GC Check for C#
            if rel_file.endswith(".cs") and check_unity_gc:
                try:
                    for v in check_unity_gc(full_path):
                        perf_findings.append((rel_file, f"Unity Hot-Loop GC: {v}"))
                except Exception:
                    pass

    return len(perf_findings) == 0, perf_findings

def run_resilience_audit(modified_files: list) -> tuple:
    findings = []
    for rel_file in modified_files:
        if is_test_path(rel_file) or has_dir(rel_file, "scripts", "bin"):
            continue
        full_path = resolve_path(rel_file)
        if full_path.is_file() and any(rel_file.endswith(ext) for ext in CODE_EXTENSIONS):
            try:
                with open(full_path, "r", encoding="utf-8", errors="replace") as f:
                    content = f.read()
                for pat, label in RESILIENCE_ANTIPATTERN_PATTERNS:
                    if re.search(pat, content):
                        findings.append((rel_file, label))
            except Exception:
                pass
    return len(findings) == 0, findings

def run_logging_audit(modified_files: list) -> tuple:
    findings = []
    for rel_file in modified_files:
        if is_test_path(rel_file) or has_dir(rel_file, "scripts"):
            continue
        full_path = resolve_path(rel_file)
        if full_path.is_file() and any(rel_file.endswith(ext) for ext in CODE_EXTENSIONS):
            try:
                with open(full_path, "r", encoding="utf-8", errors="replace") as f:
                    content = f.read()
                for pat, label in LOGGING_ANTIPATTERN_PATTERNS:
                    if re.search(pat, content):
                        findings.append((rel_file, label))
            except Exception:
                pass
    return len(findings) == 0, findings

def check_design_and_accessibility(modified_files: list) -> tuple:
    base_dir = get_base_dir()
    ui_files = [f for f in modified_files if any(f.endswith(ext) for ext in UI_EXTENSIONS)]
    if not ui_files:
        return True, "Không có file giao diện UI nào thay đổi"
    
    design_files = [
        base_dir / "DESIGN.md",
        base_dir / "templates" / "DESIGN.md",
        base_dir / ".agents" / "active-profile" / "DESIGN.md"
    ]
    design_found = any(d.exists() for d in design_files)
    if not design_found:
        return False, "Thiếu file DESIGN.md trong dự án hoặc active profile"
    return True, f"Có DESIGN.md cho {len(ui_files)} UI files — Touch Target >= 48dp / 8pt Grid cần rà thủ công (gate không đo layout)"

def check_instincts_memory() -> tuple:
    base_dir = get_base_dir()
    candidates = [
        base_dir / ".agents" / "instincts.md",
        base_dir / "templates" / "instincts.template.md"
    ]
    for c in candidates:
        if c.exists():
            return True, f"Sẵn sàng ({c.name})"
    return False, "Chưa thiết lập instincts.md"

def brain_sessions_for_project(project_dir: Path) -> list:
    """Antigravity session dirs whose plan/walkthrough mentions this project's path.
    Sessions of other projects are never counted (their images are not evidence here)."""
    root = Path(os.environ.get("POSTFIX_GATE_BRAIN_DIR") or (Path.home() / ".gemini" / "antigravity" / "brain"))
    if not root.is_dir():
        return []
    needle = re.compile(re.escape(str(project_dir)) + r"(?=[/\s)\"'`]|$)")
    sessions = []
    for b_dir in root.iterdir():
        if not b_dir.is_dir():
            continue
        for md in b_dir.glob("*.md"):
            try:
                if md.stat().st_size <= 1_000_000 and needle.search(md.read_text(encoding="utf-8", errors="replace")):
                    sessions.append(b_dir)
                    break
            except OSError:
                continue
    return sessions


def check_anti_false_green(is_hardware_project: bool = False) -> tuple:
    """
    Anti-False-Green Engine:
    1. Device Enumeration: Check 'adb devices -l' if hardware project.
       Returns device_state: None (not checked), "online", "none", or "unverified".
    2. Visual Evidence Deduplication: SHA-256 on proof images of THIS project only,
       rejecting 0-byte or duplicates.
    """
    findings = []
    base_dir = get_base_dir()
    device_state = None

    if is_hardware_project:
        try:
            res = subprocess.run(["adb", "devices", "-l"], capture_output=True, text=True, timeout=3)
            lines = [l.strip() for l in res.stdout.strip().splitlines() if l.strip()]
            devices = [l for l in lines[1:] if " device" in l and "offline" not in l]
            device_state = "online" if res.returncode == 0 and devices else "none"
            if device_state == "none":
                findings.append("Thiết bị ngoại vi: Không phát hiện máy thật online qua 'adb devices -l' -> Ghi cờ UNTESTED")
        except (OSError, subprocess.SubprocessError) as e:
            device_state = "unverified"
            findings.append(f"Thiết bị ngoại vi: KHÔNG xác minh được — không chạy được 'adb devices -l' ({type(e).__name__})")

    image_hashes = {}
    proof_dirs = [
        base_dir / ".claude" / "audit-gate",
        base_dir / "reports"
    ]
    brain_sessions = brain_sessions_for_project(base_dir)
    proof_dirs.extend(brain_sessions)
    total_images = 0
    duplicate_images = []
    zero_byte_images = []

    for pdir in proof_dirs:
        if pdir.exists():
            for img_file in list(pdir.glob("*.jpg")) + list(pdir.glob("*.png")):
                total_images += 1
                sz = img_file.stat().st_size
                if sz == 0:
                    zero_byte_images.append(img_file.name)
                    continue
                try:
                    with open(img_file, "rb") as f:
                        h = hashlib.sha256(f.read()).hexdigest()
                    if h in image_hashes and image_hashes[h] != img_file.name:
                        duplicate_images.append((img_file.name, image_hashes[h]))
                    else:
                        image_hashes[h] = img_file.name
                except OSError:
                    pass

    if zero_byte_images:
        findings.append(f"Phát hiện {len(zero_byte_images)} ảnh chụp minh chứng 0-byte (Corrupt/Blank)")
    if duplicate_images:
        findings.append(f"Phát hiện {len(duplicate_images)} ảnh chụp trùng mã băm SHA-256 (Màn hình đơ / Duplicate proof)")

    return len(findings) == 0, findings, total_images, device_state, len(brain_sessions)


def md_escape(text) -> str:
    """One line, Markdown control characters escaped — user text must not add headings,
    list items or links to instincts.md / the report."""
    text = " ".join(str(text or "").split())
    return re.sub(r"([\\`*_\[\]#<>|!])", r"\\\1", text)


def record_lesson(base_dir: Path, lesson: str, cause: str, prevention: str):
    instincts_file = base_dir / ".agents" / "instincts.md"
    today = time.strftime("%Y-%m-%d")
    new_entry = f"\n### [INSTINCT-AUTO] {md_escape(lesson)}\n"
    new_entry += f"- **Ngày phát hiện:** {today}\n"
    new_entry += f"- **Hiện tượng lỗi:** {md_escape(lesson)}\n"
    new_entry += f"- **Nguyên nhân:** {md_escape(cause) if cause else 'Chưa ghi'}\n"
    new_entry += f"- **Quy tắc phòng ngừa & Cách fix:** {md_escape(prevention) if prevention else 'Chưa ghi'}\n"
    new_entry += "- **Lệnh kiểm tra:** postfix-gate --run-tests\n"
    try:
        instincts_file.parent.mkdir(parents=True, exist_ok=True)
        with open(instincts_file, "a", encoding="utf-8") as f:
            f.write(new_entry)
        print(f"{GREEN}✔ Đã ghi bài học kinh nghiệm vào {instincts_file}{RESET}")
    except OSError as e:
        print(f"{YELLOW}⚠ Không thể ghi vào {instincts_file}: {e}{RESET}")


def main():
    parser = argparse.ArgumentParser(description="Post-Fix Audit & TIA Regression Verification Gate")
    parser.add_argument("--diff", help="Git diff reference (e.g. HEAD~1, origin/main)")
    parser.add_argument("--matrix", help="Path to regression_matrix.json")
    parser.add_argument("--run-tests", action="store_true", help="Chạy thật các lệnh test hồi quy trong matrix (bắt buộc để có PASS)")
    parser.add_argument("--dry-run", action="store_true", help="Chỉ liệt kê test liên đới, không chạy (mặc định khi thiếu --run-tests; không bao giờ ra PASS)")
    parser.add_argument("--timeout", type=int, default=900, help="Timeout (giây) cho mỗi lệnh test hồi quy")
    parser.add_argument("--json", action="store_true", help="In thêm kết quả dạng JSON (dòng cuối stdout)")
    parser.add_argument("--allow-no-tests", action="store_true",
                        help="Cho phép PASS khi không có matrix / không test hồi quy nào khớp thay đổi")
    parser.add_argument("--record-lesson", help="Tên bài học kinh nghiệm / bẫy mã nguồn mới cần ghi nhận")
    parser.add_argument("--cause", help="Nguyên nhân gốc rễ của lỗi vừa sửa")
    parser.add_argument("--prevention", help="Quy tắc phòng ngừa / Cách sửa để tránh tái diễn")
    args = parser.parse_args()

    base_dir = get_base_dir()

    # A ref that starts with "-" would be parsed by git as an option (`--output=<file>`).
    if args.diff is not None and (not args.diff or args.diff.startswith("-")):
        log_err(f"--diff không hợp lệ: {args.diff!r} (phải là một git ref, không được bắt đầu bằng '-')")
        return 2
    base_ref = args.diff if args.diff and ".." not in args.diff else "HEAD"

    try:
        all_changed = get_modified_files(args.diff)
    except RuntimeError as e:
        log_err(str(e))
        return 2
    devkit_artifacts = [f for f in all_changed if is_devkit_artifact(f)]
    modified_files = [f for f in all_changed if f not in devkit_artifacts]
    matrix, matrix_problem = load_active_matrix(args.matrix, base_ref)
    # Editing an existing test in the same change can weaken the very assertion the
    # regression run relies on. New test files are fine (that is the RED test).
    prefix = get_project_prefix()
    tests_touched = [f for f in modified_files if is_test_path(f) and subprocess.run(
        ["git", "-C", str(get_repo_root()), "cat-file", "-e", f"{base_ref}:{prefix}{f}"],
        capture_output=True).returncode == 0]
    run_tests = args.run_tests and not args.dry_run

    print(f"\n{BOLD}{CYAN}══════════════════════════════════════════════════════════════════════════════════════{RESET}")
    print(f"{BOLD}{CYAN}      🛡️  POST-FIX AUDIT & TIA REGRESSION VERIFICATION GATE                          {RESET}")
    print(f"  {DIM}Chặn thật: 5 kiểm tra tĩnh (bí mật, placeholder, hiệu năng, nuốt lỗi, log) + test hồi quy với --run-tests.{RESET}")
    print(f"  {DIM}Chỉ nhắc (không chặn): DESIGN.md, RED/GREEN, ảnh minh chứng, thiết bị, Immutable Guards, OpenCodeReview.{RESET}\n")
    print(f"{BOLD}{CYAN}══════════════════════════════════════════════════════════════════════════════════════{RESET}\n")

    # Không có thay đổi thì không có gì để nghiệm thu — tuyệt đối không bịa file mẫu để ra PASS.
    if not modified_files:
        if devkit_artifacts:
            log_warn(f"Chỉ có {len(devkit_artifacts)} link/state do devkit cài — không phải thay đổi của người dùng.")
        log_warn("Working tree sạch và không có --diff khớp: KHÔNG có thay đổi nào để kiểm toán.")
        log_warn("Gate không kết luận PASS khi không có gì để kiểm. Dùng --diff <ref> để kiểm một commit.")
        return 3

    # A listed path that can't be read is NOT clean — it is unverified.
    # A symlink's content is its target, not a project change: it is not unreadable.
    unreadable = [f for f in modified_files
                  if f not in DELETED_FILES and not resolve_path(f).is_symlink()
                  and not resolve_path(f).is_file()]

    # Layer 1: Git Diff, Hygiene & Anti-Laziness Audit
    print(f"{BOLD}[1/8] (CHẶN) Quét bí mật & placeholder lười biếng:{RESET}")
    hygiene_ok, secrets = run_git_hygiene_audit(modified_files)
    anti_laziness_ok, lazy_findings = run_anti_laziness_audit(modified_files)
    instincts_ok, instincts_msg = check_instincts_memory()

    print(f"  • Phạm vi thay đổi: {BOLD}{len(modified_files)} files{RESET}"
          + (f" {DIM}(bỏ qua {len(devkit_artifacts)} link/state do devkit cài){RESET}" if devkit_artifacts else ""))
    for mf in modified_files[:5]:
        print(f"    - {DIM}{mf}{RESET}")
    if len(modified_files) > 5:
        print(f"    - {DIM}... và {len(modified_files) - 5} files khác{RESET}")

    if hygiene_ok:
        log_ok(f"Quét bí mật theo {len(SECRET_PATTERNS) + 1} mẫu regex + {len(FORBIDDEN_SECRET_FILES)} mẫu tên file: 0 phát hiện")
    else:
        for f, lbl in secrets:
            log_err(f"{f}: {lbl}")

    if anti_laziness_ok:
        log_ok("Chống lười biếng (Anti-Laziness): 0 placeholder theo mẫu regex")
    else:
        for f, lbl in lazy_findings:
            log_err(f"{f}: {lbl}")

    if instincts_ok:
        log_ok(f"Bộ nhớ bài học kinh nghiệm (Instincts Memory): {instincts_msg}")
    else:
        log_warn(f"Bộ nhớ bài học kinh nghiệm: {instincts_msg}")

    # Layer 2: UI/UX Design System & Accessibility Gate
    print(f"\n{BOLD}[2/8] (NHẮC) DESIGN.md & a11y — gate chỉ kiểm file tồn tại, không đo layout:{RESET}")
    ui_ok, ui_msg = check_design_and_accessibility(modified_files)
    if ui_ok:
        log_ok(ui_msg)
    else:
        log_warn(ui_msg)

    # Layer 3: Paired Executable Oracle & Anti-False-Green Engine
    print(f"\n{BOLD}[3/8] (NHẮC) RED/GREEN, ảnh minh chứng & thiết bị:{RESET}")
    log_warn("Bằng chứng RED/GREEN: gate này KHÔNG xác minh — dùng workflow engine (workflows/) để kiểm receipt RED -> GREEN")

    is_hw = any("automotive" in str(f).lower() or "android" in str(f).lower() for f in modified_files)
    afg_ok, afg_findings, img_count, device_state, brain_count = check_anti_false_green(is_hardware_project=is_hw)
    if afg_ok:
        log_ok(f"Mã băm ảnh minh chứng (SHA-256 Deduplication): {img_count} ảnh, 0 ảnh 0-byte / trùng lặp")
    else:
        for err in afg_findings:
            log_warn(err)
    if not brain_count:
        log_warn("Ảnh phiên Antigravity: KHÔNG xác minh — không có phiên nào ghi đường dẫn dự án này")
    if device_state == "online":
        log_ok("Device Enumeration: có thiết bị online qua 'adb devices -l'")

    # Layer 4: TIA Regression Impact Analysis & Marked Checklist
    print(f"\n{BOLD}[4/8] (CHẶN với --run-tests) Test hồi quy TIA (Test Impact Analysis):{RESET}")
    rules = matrix.get("rules", [])
    impacted_components = []
    regression_tests = []
    immutable_guards_protected = []

    for rule in rules:
        comp_name = rule.get("component", "UnknownComponent")
        watch_files = rule.get("watch_files", [])
        matched = any(match_pattern(f, pat) for f in modified_files for pat in watch_files)
        if not matched:
            continue
        impacted_components.append(comp_name)
        for test in rule.get("mandatory_regression_tests", []):
            regression_tests.append({
                "component": comp_name,
                "id": test.get("id"),
                "name": test.get("name"),
                "command": test.get("command"),
                "status": "NOT_RUN",
                "duration": "-",
            })
        for guard in rule.get("immutable_guards", []):
            immutable_guards_protected.append((comp_name, guard))

    print(f"  • Dự án kích hoạt: {CYAN}{matrix.get('project', 'Universal Application')}{RESET}")
    if matrix_problem:
        log_warn(matrix_problem)
    if not rules:
        log_warn("Không tìm thấy regression matrix (hoặc matrix rỗng) — không đánh giá được TIA")
    if impacted_components:
        print(f"  • Component liên đới: {BOLD}{', '.join(dict.fromkeys(impacted_components))}{RESET}\n")
    else:
        print(f"  • Component liên đới: {DIM}không có (không file nào khớp watch_files){RESET}\n")

    project_dir = get_project_dir()
    for t in regression_tests:
        if run_tests and t["command"]:
            started = time.perf_counter()
            # Own session/process group so a timeout kills the whole tree (gradle daemons,
            # test workers), not just the shell. Commands come from the matrix at the base
            # ref (load_active_matrix), so the audited change cannot rewrite them.
            proc = subprocess.Popen(t["command"], shell=True, cwd=str(project_dir),
                                    stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                                    text=True, errors="replace", start_new_session=True)
            try:
                out, _ = proc.communicate(timeout=args.timeout)
                t["status"] = "PASS" if proc.returncode == 0 else "FAIL"
                t["exit_code"] = proc.returncode
                t["output_tail"] = (out or "")[-2000:]
            except subprocess.TimeoutExpired:
                try:
                    os.killpg(proc.pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
                proc.communicate()
                t["status"] = "TIMEOUT"
            t["duration"] = f"{time.perf_counter() - started:.2f}s"
        elif run_tests:
            t["status"] = "FAIL"
            t["output_tail"] = "Matrix không khai báo command cho test này"

    checklist_markdown = []
    for t in regression_tests:
        st = t["status"]
        if st == "PASS":
            status_icon = f"{GREEN}[x] PASS{RESET}"
        elif st == "NOT_RUN":
            status_icon = f"{YELLOW}[ ] NOT RUN{RESET}"
        else:
            status_icon = f"{RED}[ ] {st}{RESET}"
        print(f"    {status_icon} | {BOLD}{t['id']:<15}{RESET} : {t['name']}")
        extra = f", exit={t['exit_code']}" if "exit_code" in t else ""
        print(f"           {DIM}Lệnh chạy: {t['command']} ({t['duration']}{extra}){RESET}")
        if st in ("FAIL", "TIMEOUT") and t.get("output_tail"):
            for line in t["output_tail"].strip().splitlines()[-5:]:
                print(f"           {DIM}| {line}{RESET}")
        mark = "x" if st == "PASS" else " "
        checklist_markdown.append(f"- [{mark}] **{t['id']}** ({t['component']}): {t['name']} -> `{st}` ({t['duration']})")
    if regression_tests and not run_tests:
        log_warn("Chưa chạy test hồi quy (dry-run). Thêm --run-tests để chạy thật — dry-run KHÔNG bao giờ là PASS.")

    if immutable_guards_protected:
        print(f"\n  • Rào chắn Bất biến Lịch sử (Immutable Guards — cần rà thủ công, gate không tự kiểm):")
        for comp, g in immutable_guards_protected:
            print(f"    - {YELLOW}🔒 [GUARD PROTECTED — REVIEW]{RESET} {comp} :: {g}")
            checklist_markdown.append(f"- [ ] **Rào chắn bất biến**: `🔒 {g}` ({comp}) — cần xác nhận thủ công")

    # Layer 5: Performance, Memory & Resource Optimization Audit Gate
    print(f"\n{BOLD}[5/8] (CHẶN) Anti-pattern hiệu năng (regex):{RESET}")
    perf_ok, perf_findings = run_performance_audit(modified_files)
    if perf_ok:
        log_ok(f"Anti-pattern hiệu năng theo {len(PERF_ANTIPATTERN_PATTERNS)} mẫu regex: 0 phát hiện")
    else:
        for f, lbl in perf_findings:
            log_err(f"{f}: {lbl}")

    # Layer 6: Error Resilience & Anti-Swallowing Gate
    print(f"\n{BOLD}[6/8] (CHẶN) Nuốt lỗi (regex):{RESET}")
    resilience_ok, resilience_findings = run_resilience_audit(modified_files)
    if resilience_ok:
        log_ok(f"Chống nuốt lỗi theo {len(RESILIENCE_ANTIPATTERN_PATTERNS)} mẫu regex: 0 phát hiện")
    else:
        for f, lbl in resilience_findings:
            log_err(f"{f}: {lbl}")

    # Layer 7: Structured Logging & PII Masking Gate
    print(f"\n{BOLD}[7/8] (CHẶN) Log thô (regex):{RESET}")
    logging_ok, logging_findings = run_logging_audit(modified_files)
    if logging_ok:
        log_ok(f"Log thô / PII theo {len(LOGGING_ANTIPATTERN_PATTERNS)} mẫu regex: 0 phát hiện")
    else:
        for f, lbl in logging_findings:
            log_err(f"{f}: {lbl}")

    # Layer 8: OpenCodeReview (Alibaba OCR) Audit Gate
    print(f"\n{BOLD}[8/8] (NHẮC) OpenCodeReview:{RESET}")
    ocr_available = shutil.which("ocr") is not None
    if ocr_available:
        log_warn("OpenCodeReview CLI (`ocr`) có sẵn nhưng gate KHÔNG tự chạy — chạy review thủ công và đính kết quả")
    else:
        log_warn("OpenCodeReview CLI (`ocr`) chưa cài — lớp này bỏ qua")

    # Final Summary Verdict
    static_ok = hygiene_ok and anti_laziness_ok and perf_ok and resilience_ok and logging_ok
    tests_passed = sum(1 for t in regression_tests if t["status"] == "PASS")
    tests_ok = tests_passed == len(regression_tests)
    unverified = bool(regression_tests) and not run_tests
    no_coverage = (not rules or not regression_tests) and not args.allow_no_tests

    print(f"\n{BOLD}{CYAN}──────────────────────────────────────────────────────────────────────────────────────{RESET}")
    if not static_ok or (run_tests and not tests_ok):
        verdict_text, verdict_color, exit_code = "REJECT — CẦN KHẮC PHỤC CÁC ĐIỂM CHƯA ĐẠT", RED, 1
    elif matrix_problem:
        verdict_text, verdict_color, exit_code = "CHƯA XÁC MINH — regression matrix không tin được (xem mục 4)", YELLOW, 2
    elif tests_touched:
        verdict_text, verdict_color, exit_code = f"CHƯA XÁC MINH — {len(tests_touched)} file test đã có bị sửa/xoá trong thay đổi, cần người review", YELLOW, 2
    elif unverified:
        verdict_text, verdict_color, exit_code = "CHƯA XÁC MINH — test hồi quy chưa chạy (dry-run)", YELLOW, 2
    elif unreadable:
        verdict_text, verdict_color, exit_code = f"CHƯA XÁC MINH — {len(unreadable)} file không đọc được để quét", YELLOW, 2
    elif no_coverage:
        verdict_text, verdict_color, exit_code = "CHƯA XÁC MINH — không có test hồi quy nào khớp thay đổi (--allow-no-tests để chấp nhận)", YELLOW, 2
    else:
        verdict_text, verdict_color, exit_code = "PASS — ĐỦ ĐIỀU KIỆN NGHIỆM THU & BÀN GIAO", GREEN, 0

    print(f"  {BOLD}KẾT LUẬN CỔNG POST-FIX AUDIT:{RESET} {verdict_color}{BOLD}{verdict_text}{RESET}")
    print(f"  • Test hồi quy đạt: {tests_passed}/{len(regression_tests)}" + (" (chưa chạy)" if unverified else ""))
    print(f"  • Lớp tĩnh (bí mật, lười biếng, hiệu năng, nuốt lỗi, log): {'đạt' if static_ok else 'CÓ PHÁT HIỆN'}")
    for f in unreadable[:5]:
        print(f"  • {YELLOW}Không đọc được để quét:{RESET} {f}")
    for f in tests_touched[:5]:
        print(f"  • {YELLOW}Test đã có bị sửa/xoá:{RESET} {f}")
    print(f"  • Chỉ nhắc, gate không xác minh: DESIGN.md/a11y, RED/GREEN oracle, ảnh minh chứng, thiết bị, Immutable Guards, OpenCodeReview.")
    print(f"{BOLD}{CYAN}══════════════════════════════════════════════════════════════════════════════════════{RESET}\n")

    def box(ok):
        return "x" if ok else " "

    # Write Markdown summary artifact for user inspection — chỉ ghi những gì đã thực sự kiểm.
    # Written inside .git/ so the report never becomes a change in the audited tree.
    git_dir = subprocess.run(["git", "-C", str(project_dir), "rev-parse", "--absolute-git-dir"],
                             capture_output=True, text=True).stdout.strip()
    report_file = (Path(git_dir) if git_dir else Path(tempfile.gettempdir())) / "postfix-gate" / "last_report.md"
    try:
        report_file.parent.mkdir(parents=True, exist_ok=True)
        with open(report_file, "w", encoding="utf-8") as f:
            f.write("# 📋 Báo Cáo Kiểm Toán Post-Fix Gate\n\n")
            f.write(f"**Thời gian:** {time.strftime('%Y-%m-%d %H:%M:%S')}\n")
            f.write(f"**Dự án:** {matrix.get('project', 'Universal Platform')}\n")
            f.write(f"**Phán quyết:** {verdict_text}\n\n")
            f.write("---\n\n")
            f.write("### 1. 🎯 Thay đổi được kiểm toán\n")
            if args.record_lesson:
                f.write(f"- **Tên lỗi & Triệu chứng:** {md_escape(args.record_lesson)}\n")
            if args.cause:
                f.write(f"- **Nguyên nhân gốc rễ:** {md_escape(args.cause)}\n")
            if args.prevention:
                f.write(f"- **Cách khắc phục & Phòng ngừa:** {md_escape(args.prevention)}\n")
            f.write(f"- **Phạm vi thay đổi:** {len(modified_files)} tệp\n")
            for mf in modified_files:
                f.write(f"  - `{mf}`\n")
            f.write("\n---\n\n")
            f.write("### 2. 🛡️ Checklist hồi quy (TIA)\n")
            f.write("\n".join(checklist_markdown) if checklist_markdown else "- Không có component nào khớp watch_files")
            f.write("\n\n---\n\n")
            f.write("### 3. 🔒 Quét tĩnh (regex heuristic)\n")
            f.write(f"- [{box(hygiene_ok)}] Rò rỉ bí mật: {len(secrets)} phát hiện\n")
            f.write(f"- [{box(anti_laziness_ok)}] Placeholder lười biếng: {len(lazy_findings)} phát hiện\n")
            f.write(f"- [{box(perf_ok)}] Anti-pattern hiệu năng: {len(perf_findings)} phát hiện\n")
            f.write(f"- [{box(resilience_ok)}] Nuốt lỗi: {len(resilience_findings)} phát hiện\n")
            f.write(f"- [{box(logging_ok)}] Log thô / PII: {len(logging_findings)} phát hiện\n")
            f.write(f"- [{box(ui_ok)}] DESIGN.md: {ui_msg}\n")
            f.write(f"- [{box(afg_ok)}] Ảnh minh chứng: {img_count} ảnh" + (f" — {'; '.join(afg_findings)}" if afg_findings else "") + "\n")
            f.write("\n### 4. ⚠️ Chưa được gate này xác minh\n")
            if matrix_problem:
                f.write(f"- [ ] Regression matrix: {md_escape(matrix_problem)}\n")
            for tf in tests_touched:
                f.write(f"- [ ] Test đã có bị sửa/xoá: `{tf}`\n")
            f.write("- [ ] Bằng chứng RED -> GREEN (Paired Oracle)\n")
            f.write("- [ ] Immutable Guards còn nguyên\n")
            f.write("- [ ] OpenCodeReview (`ocr`)\n")
    except OSError as e:
        log_warn(f"Không ghi được báo cáo {report_file}: {e}")
    else:
        print(f"  Báo cáo: {report_file}")

    if args.json:
        print(json.dumps({
            "verdict": verdict_text, "exit_code": exit_code, "files": modified_files,
            "unreadable": unreadable, "regression_tests": regression_tests,
            "matrix_problem": matrix_problem, "tests_touched": tests_touched,
            "devkit_artifacts_skipped": len(devkit_artifacts), "device": device_state,
            "static": {"secrets": len(secrets), "lazy": len(lazy_findings), "perf": len(perf_findings),
                       "resilience": len(resilience_findings), "logging": len(logging_findings)},
            "report": str(report_file),
        }, ensure_ascii=False))

    # A lesson is recorded only for a change that actually passed the gate.
    if args.record_lesson:
        if exit_code == 0:
            record_lesson(base_dir, args.record_lesson, args.cause, args.prevention)
        else:
            log_warn("Không ghi bài học vào instincts.md vì gate chưa PASS.")

    return exit_code


if __name__ == "__main__":
    sys.exit(main())
