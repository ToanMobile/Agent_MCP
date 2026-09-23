#!/usr/bin/env python3
"""
lint_compose_stability.py — Jetpack Compose Recomposition & Stability Linter (REGEX-BASED)

Đây là linter dựa trên regex + đếm ngoặc, KHÔNG phải AST parser: có thể báo sót hoặc báo nhầm
với code Kotlin phức tạp (chuỗi chứa ngoặc, generic lồng sâu...). Phát hiện:
1. Unstable collections (List<T>, Set<T>, Map<K,V>, ArrayList, HashMap) làm tham số @Composable
   (hỗ trợ chữ ký hàm trải nhiều dòng).
2. SimpleDateFormat / DecimalFormat / Regex tạo trong thân @Composable mà không `remember`.

Exit code: 0 = không vi phạm, 1 = có vi phạm, 2 = lỗi sử dụng (thiếu tham số / đường dẫn không tồn tại).
Bỏ qua file test theo THƯ MỤC (test/, tests/, androidTest/, testFixtures/) hoặc HẬU TỐ (*Test.kt,
*Tests.kt, *Spec.kt) và thư mục build/, generated/ — không lọc theo chuỗi con "test" trong đường dẫn.
"""

import sys
import re
from pathlib import Path

# Primitive / Immutable safe types
SAFE_COLLECTIONS = {"ImmutableList", "ImmutableSet", "ImmutableMap", "PersistentList", "PersistentSet", "PersistentMap"}
UNSTABLE_PARAM_RE = re.compile(r":\s*(List|Set|Map|ArrayList|HashMap|MutableList|MutableSet|MutableMap)\s*<")
FORMATTER_RE = re.compile(r"=\s*(SimpleDateFormat|DecimalFormat|Regex)\(")
SKIP_DIRS = {"test", "tests", "androidtest", "testfixtures", "build", "generated"}
TEST_SUFFIXES = ("test.kt", "tests.kt", "spec.kt")


def is_excluded(path: Path) -> bool:
    parts = [x.lower() for x in path.parts[:-1]]
    return any(x in SKIP_DIRS for x in parts) or path.name.lower().endswith(TEST_SUFFIXES)


def _is_comment(stripped: str) -> bool:
    return stripped.startswith("//") or stripped.startswith("/*") or stripped.startswith("*")


def _collect_signature(lines, i):
    """Gom chữ ký từ dòng `fun` tới khi ngoặc tròn cân bằng. Trả (sig, last_idx)."""
    sig, depth, opened = "", 0, False
    j = i
    while j < len(lines):
        seg = lines[j]
        sig += seg
        for ch in seg:
            if ch == "(":
                depth += 1
                opened = True
            elif ch == ")":
                depth -= 1
        if opened and depth <= 0:
            return sig, j
        j += 1
    return sig, len(lines) - 1


def check_kotlin_file(file_path: Path) -> list:
    findings = []
    try:
        with open(file_path, "r", encoding="utf-8", errors="replace") as f:
            lines = f.readlines()
    except OSError as e:
        return [f"Cannot read file: {e}"]

    pending = False
    i = 0
    n = len(lines)
    while i < n:
        stripped = lines[i].strip()
        if _is_comment(stripped):
            i += 1
            continue
        if "@Composable" in stripped:
            pending = True
        if pending and re.search(r"\bfun\b", stripped):
            pending = False
            sig, sig_end = _collect_signature(lines, i)
            m = re.search(r"fun\s+(?:<[^>]*>\s*)?(?:[A-Za-z0-9_.]+\.)?([A-Za-z0-9_]+)\s*\((.*)\)", sig, re.DOTALL)
            name = m.group(1) if m else "?"
            params = m.group(2) if m else ""
            for um in UNSTABLE_PARAM_RE.finditer(params):
                offset = (m.start(2) if m else 0) + um.start()
                line_no = i + 1 + sig[:offset].count("\n")
                findings.append(
                    f"Line {line_no} in @Composable `{name}`: Unstable collection parameter `{um.group(1)}<...>` "
                    f"causes unnecessary recompositions. Use ImmutableList/PersistentList or wrap model in @Immutable."
                )
            # Thân hàm: từ '{' đầu tiên sau chữ ký tới khi ngoặc nhọn cân bằng.
            # Hàm dạng expression body (`= ...`) không có thân khối → bỏ qua.
            tail = sig[sig.rfind(")") + 1:] if ")" in sig else ""
            j, depth, opened = sig_end, 0, False
            if "{" in tail and "=" not in tail.split("{", 1)[0]:
                depth, opened = tail.count("{") - tail.count("}"), True
            elif "=" not in tail:
                k = sig_end + 1
                while k < n and (not lines[k].strip() or lines[k].strip().startswith(":")) and "{" not in lines[k]:
                    k += 1
                if k < n and lines[k].strip().startswith("{"):
                    j, depth, opened = k, lines[k].count("{") - lines[k].count("}"), True
            if opened:
                body_idx = j
                while True:
                    body_line = lines[body_idx]
                    bs = body_line.strip()
                    if not _is_comment(bs) and FORMATTER_RE.search(bs) and "remember" not in bs:
                        findings.append(
                            f"Line {body_idx + 1} in @Composable `{name}`: Unremembered heavy formatter/regex allocation "
                            f"inside composable. Wrap with `remember {{ ... }}`."
                        )
                    if body_idx > j:
                        depth += body_line.count("{") - body_line.count("}")
                    if depth <= 0 or body_idx + 1 >= n:
                        break
                    body_idx += 1
                i = body_idx + 1
                continue
            i = sig_end + 1
            continue
        i += 1
    return findings


def main():
    if len(sys.argv) < 2:
        print("Usage: lint_compose_stability.py <file_or_dir> [...]", file=sys.stderr)
        sys.exit(2)

    missing = [t for t in sys.argv[1:] if not Path(t).exists()]
    if missing:
        for t in missing:
            print(f"✖ Đường dẫn không tồn tại: {t}", file=sys.stderr)
        sys.exit(2)

    total_violations = 0
    scanned = 0
    for target in sys.argv[1:]:
        p = Path(target)
        files = [p] if p.is_file() else sorted(p.rglob("*.kt"))
        for kt_file in files:
            if p.is_dir() and is_excluded(kt_file.relative_to(p)):
                continue
            scanned += 1
            violations = check_kotlin_file(kt_file)
            if violations:
                print(f"❌ [COMPOSE LINT VIOLATION] {kt_file}:")
                for v in violations:
                    print(f"   • {v}")
                total_violations += len(violations)

    if total_violations == 0:
        print(f"✔ [COMPOSE LINT PASS] {scanned} file .kt đã quét (regex-based), không phát hiện vi phạm.")
        sys.exit(0)
    else:
        print(f"\n🚨 Phát hiện {total_violations} vi phạm Jetpack Compose Recomposition / Stability ({scanned} file, regex-based).")
        sys.exit(1)

if __name__ == "__main__":
    main()
