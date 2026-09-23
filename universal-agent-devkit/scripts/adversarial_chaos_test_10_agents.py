#!/usr/bin/env python3
"""
Adversarial scenario checks for Universal Agent DevKit (self-consistency, mostly grep-based)

ĐỌC TRƯỚC KHI TIN KẾT QUẢ:
  - [exec] = kịch bản THẬT SỰ đưa payload qua hàm của bin/post-fix-gate.py (02, 03, 06, 07).
  - [grep] = chỉ kiểm tài liệu/test DevKit còn nhắc tới cơ chế phòng thủ (01, 04, 05, 08, 09, 10);
    KHÔNG chạy payload nào, KHÔNG chứng minh cơ chế hoạt động.
  Kết quả không phải red-team thật và không chứng minh hệ thống không thể bị qua mặt.

Simulates 10 realistic developer mistakes, AI hallucinations, and cheating attacks:
  [Attack 01] TheAssertionCheater       : Giả lập sửa assertion test để gian lận pass mà không sửa bug
  [Attack 02] TheLazyPlaceholderSmuggler: Giả lập tuồn code lười biếng '// ... existing code ...'
  [Attack 03] TheSecretLeaker           : Giả lập vô tình commit API Key / Private Token vào code
  [Attack 04] TheGhostFixer             : Giả lập tuyên bố fix xong mà không có bằng chứng RED ban đầu
  [Attack 05] TheLegacyGuardDestroyer   : Giả lập vô tình xóa / nới lỏng rào chắn bất biến lịch sử
  [Attack 06] TheSilentCollateralDamager: Giả lập sửa file lõi làm gãy các module tiêu thụ xung quanh
  [Attack 07] TheMemoryLeaker           : Giả lập fix lỗi nhưng để lại rò rỉ bộ nhớ (Memory Leak)
  [Attack 08] TheSpamClicker            : Giả lập tạo nút bấm không có Debounce / Disable trạng thái
  [Attack 09] TheTinyTouchTarget        : Giả lập tạo nút bấm nhỏ dưới chuẩn tiếp cận (< 48dp)
  [Attack 10] TheContextAmnesiac        : Giả lập phiên làm việc dài (>50% context) gây ngáo suy luận

100% Standard Library — Zero external dependencies.
"""

import json
import os
import re
import subprocess
import sys
import tempfile
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

def get_base_dir() -> Path:
    return Path(__file__).resolve().parent.parent

# Import functions from post-fix-gate for dynamic attack testing
sys.path.insert(0, str(get_base_dir() / "bin"))
try:
    import importlib.util
    pfg_path = get_base_dir() / "bin" / "post-fix-gate.py"
    spec = importlib.util.spec_from_file_location("postfix_gate", str(pfg_path))
    pfg = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(pfg)
except Exception as e:
    pfg = None

def simulate_attack_01_assertion_cheater() -> tuple:
    """[grep] Tài liệu/test có mô tả chống sửa assertion (không chạy payload)."""
    # Defense check: Test integrity rules + Oracle Source Integrity in workflows
    workflow_test = get_base_dir() / "workflows" / "multi-lens-audit.test.mjs"
    skill_file = get_base_dir() / "skills" / "fixbugs" / "SKILL.md"
    
    with open(workflow_test, "r", encoding="utf-8") as f:
        wf_content = f.read()
    with open(skill_file, "r", encoding="utf-8") as f:
        skill_content = f.read()

    caught_in_wf = "oracle source artifact must retain canonical" in wf_content
    caught_in_skill = "Two-Way Test Suite Integrity" in skill_content or "nới lỏng các assertion" in skill_content
    blocked = caught_in_wf and caught_in_skill
    return blocked, "Bị chặn bởi OracleSourceIntegrity (Băm SHA-256 mã nguồn oracle) & Two-Way Test Integrity"

def simulate_attack_02_lazy_placeholder() -> tuple:
    """Giả lập tuồn code lười biếng '// ... existing code ...' vào file sửa"""
    lazy_payload = """
    fun updateUserProfile(user: User) {
        validate(user)
        // ... existing code ...
        saveToDb(user)
    }
    """
    with tempfile.NamedTemporaryFile("w", suffix=".kt", delete=False) as f:
        f.write(lazy_payload)
        temp_file = f.name
    try:
        ok, findings = pfg.run_anti_laziness_audit([temp_file])
        blocked = not ok and len(findings) > 0
        if not blocked:
            return False, "post-fix-gate KHÔNG phát hiện placeholder trong payload"
        return blocked, f"Phát hiện regex: '{findings[0][1]}' — Gate REJECT"
    finally:
        os.unlink(temp_file)

def simulate_attack_03_secret_leak() -> tuple:
    """Giả lập vô tình hardcode API key nhạy cảm vào code"""
    secret_payload = "val api" + "Key = \"Zx9Qw7Er5Ty3Ui1Op8As6Df4Gh2Jk0Lm\"\nval client = HttpClient(apiKey)"
    with tempfile.NamedTemporaryFile("w", suffix=".kt", delete=False) as f:
        f.write(secret_payload)
        temp_file = f.name
    try:
        ok, findings = pfg.run_git_hygiene_audit([temp_file])
        blocked = not ok and len(findings) > 0
        if not blocked:
            return False, "post-fix-gate KHÔNG phát hiện API key trong payload"
        return blocked, f"Phát hiện mẫu: '{findings[0][1]}' — Git Hygiene Gate REJECT"
    finally:
        os.unlink(temp_file)

def simulate_attack_04_ghost_fix() -> tuple:
    """Giả lập tuyên bố fix xong mà không có bài test RED ban đầu"""
    wf_test = get_base_dir() / "workflows" / "multi-lens-audit.test.mjs"
    with open(wf_test, "r", encoding="utf-8") as f:
        content = f.read()
    has_preimage_check = "missing RED proof blocks audit completion" in content
    has_waiver_ban = "RED waiver is rejected" in content
    blocked = has_preimage_check and has_waiver_ban
    return blocked, "Bị chặn bởi Preimage Oracle Gate: Thiếu bằng chứng RED gốc, cấm mọi waiver"

def simulate_attack_05_legacy_guard_destroyer() -> tuple:
    """Giả lập xóa rào chắn bất biến lịch sử (Immutable Guards)"""
    matrix_file = get_base_dir() / "templates" / "regression_matrix.json"
    pfg_file = get_base_dir() / "bin" / "post-fix-gate.py"
    with open(matrix_file, "r", encoding="utf-8") as f:
        matrix = json.load(f)
    with open(pfg_file, "r", encoding="utf-8") as f:
        pfg_content = f.read()

    has_immutable_guards = any("immutable_guards" in r for r in matrix.get("rules", []))
    has_guard_audit = "immutable_guards_protected" in pfg_content or "GUARD PROTECTED" in pfg_content
    blocked = has_immutable_guards and has_guard_audit
    return blocked, "Bị chặn bởi TIA Layer 4: Rào chắn bất biến lịch sử được khóa cứng và kiểm toán độc lập"

def simulate_attack_06_silent_collateral_damage() -> tuple:
    """Giả lập sửa file dùng chung SharedDispatcher làm hỏng module khác mà không biết"""
    matched = pfg.match_pattern("src/common/SharedDispatcher.kt", "**/SharedDispatcher.*")
    blocked = matched is True
    return blocked, "Bị chặn bởi TIA Watch-Files: Bắt khớp '**/SharedDispatcher.*' và ép chạy toàn bộ test liên đới"

def simulate_attack_07_memory_leaker() -> tuple:
    """Giả lập fix lỗi nhưng để sót callback / coroutine leak"""
    attack_code = "companion object { static val context: Context? = null }"
    blocked = any(re.search(pat, attack_code) for pat, _ in pfg.PERF_ANTIPATTERN_PATTERNS)
    return blocked, "Bị chặn bởi Layer 5: mẫu regex Static Context Leak bắt được đoạn code rò rỉ bộ nhớ"

def simulate_attack_08_spam_clicker() -> tuple:
    """Giả lập tạo nút bấm không có debounce / loading state"""
    rules_file = get_base_dir() / "rules" / "core-rules.md"
    design_file = get_base_dir() / "templates" / "DESIGN.md"
    with open(rules_file, "r", encoding="utf-8") as f:
        rf = f.read()
    with open(design_file, "r", encoding="utf-8") as f:
        df = f.read()
    has_debounce_rule = "Debounce / Disable ngay tức thì" in rf
    has_disabled_spec = "Disabled" in df and "0.38" in df
    blocked = has_debounce_rule and has_disabled_spec
    return blocked, "Bị chặn bởi Core-Rules Mục 3 & DESIGN.md Mục 4: Bắt buộc Debounce + Loading State + 4 tương tác"

def simulate_attack_09_tiny_touch_target() -> tuple:
    """Giả lập tạo nút bấm nhỏ 24dp dưới chuẩn 48dp"""
    design_file = get_base_dir() / "templates" / "DESIGN.md"
    pfg_file = get_base_dir() / "bin" / "post-fix-gate.py"
    with open(design_file, "r", encoding="utf-8") as f:
        df = f.read()
    with open(pfg_file, "r", encoding="utf-8") as f:
        pf = f.read()
    has_target_spec = "Touch Target" in df and "48" in df
    has_gate_check = "check_design_and_accessibility" in pf and "48dp" in pf
    blocked = has_target_spec and has_gate_check
    return blocked, "Bị chặn bởi Layer 2 DESIGN.md Gate: Ép buộc Touch Target >= 48dp (Mobile) / >= 44px (Web)"

def simulate_attack_10_context_amnesiac() -> tuple:
    """Giả lập phiên làm việc dài ngáo suy luận do context đầy >50%"""
    rules_file = get_base_dir() / "rules" / "core-rules.md"
    with open(rules_file, "r", encoding="utf-8") as f:
        rf = f.read()
    has_context_hygiene = "Anti-Dumb Zone Context Hygiene" in rf and ">50%" in rf
    blocked = has_context_hygiene
    return blocked, "Bị chặn bởi Core-Rules Mục 7: Ép buộc tóm tắt tiến độ & /compact trước khi thực hiện refactor"

EXEC_SCENARIOS = {2, 3, 6, 7}

ATTACK_SIMULATIONS = [
    (1, "TheAssertionCheater", "Giả lập sửa assertion test cũ thành assertTrue(true) để lách luật", simulate_attack_01_assertion_cheater),
    (2, "TheLazyPlaceholderSmuggler", "Giả lập tuồn comment lười biếng '// ... existing code ...' vào mã nguồn", simulate_attack_02_lazy_placeholder),
    (3, "TheSecretLeaker", "Giả lập vô tình commit API Key / Private Token vào tệp code", simulate_attack_03_secret_leak),
    (4, "TheGhostFixer", "Giả lập tuyên bố fix xong mà không hề có bài test RED ban đầu chứng minh", simulate_attack_04_ghost_fix),
    (5, "TheLegacyGuardDestroyer", "Giả lập vô tình xóa / nới lỏng các rào chắn if(...) sửa lỗi lịch sử", simulate_attack_05_legacy_guard_destroyer),
    (6, "TheSilentCollateralDamager", "Giả lập sửa module dùng chung gây lỗi hồi quy âm thầm ở module khác", simulate_attack_06_silent_collateral_damage),
    (7, "TheMemoryLeaker", "Giả lập fix logic nhưng để lại rò rỉ bộ nhớ (Memory/Callback Leak)", simulate_attack_07_memory_leaker),
    (8, "TheSpamClicker", "Giả lập tạo nút bấm không có cơ chế Debounce / Disable chống spam click", simulate_attack_08_spam_clicker),
    (9, "TheTinyTouchTarget", "Giả lập tạo nút bấm nhỏ 24dp vi phạm chuẩn tiếp cận (< 48dp)", simulate_attack_09_tiny_touch_target),
    (10, "TheContextAmnesiac", "Giả lập phiên làm việc dài (>50% context) gây suy thoái suy luận", simulate_attack_10_context_amnesiac),
]

def main():
    print(f"\n{BOLD}{CYAN}══════════════════════════════════════════════════════════════════════════════════════{RESET}")
    print(f"{BOLD}{CYAN}   🔎 Adversarial scenario checks: 4 [exec] qua post-fix-gate + 6 [grep] tài liệu     {RESET}")
    print(f"{BOLD}{CYAN}   [grep] chỉ kiểm tài liệu còn mô tả cơ chế; không chứng minh cơ chế hoạt động     {RESET}")
    print(f"{BOLD}{CYAN}══════════════════════════════════════════════════════════════════════════════════════{RESET}\n")

    intercepted_count = 0
    total_attacks = len(ATTACK_SIMULATIONS)

    for attack_id, attack_name, scenario, attack_func in ATTACK_SIMULATIONS:
        kind = "exec" if attack_id in EXEC_SCENARIOS else "grep"
        print(f"┌── [Scenario {attack_id:02d}/10] [{kind}] {BOLD}{attack_name}{RESET}")
        print(f"│   • Kịch bản giả lập: {DIM}{scenario}{RESET}")
        try:
            intercepted, defense_mechanism = attack_func()
        except Exception as e:
            intercepted = False
            defense_mechanism = f"Lỗi thực thi mô phỏng: {e}"

        if intercepted:
            intercepted_count += 1
            verdict_badge = f"{GREEN}[PASS]{RESET}"
            print(f"│   • {GREEN}Cơ chế phòng thủ kích hoạt:{RESET} {defense_mechanism}")
        else:
            verdict_badge = f"{RED}[FAIL]{RESET}"
            print(f"│   • {RED}Lỗ hổng:{RESET} {defense_mechanism}")

        print(f"└── Phán quyết: {verdict_badge}\n")

    print(f"{BOLD}{CYAN}══════════════════════════════════════════════════════════════════════════════════════{RESET}")
    print(f"{BOLD}KẾT QUẢ ADVERSARIAL SCENARIO CHECKS:{RESET}")
    print(f"  {intercepted_count}/{total_attacks} checks passed ({len(EXEC_SCENARIOS)} exec, {total_attacks - len(EXEC_SCENARIOS)} grep)")
    print(f"  • Không đạt: {RED if intercepted_count < total_attacks else GREEN}{total_attacks - intercepted_count}{RESET}")
    print(f"{BOLD}{CYAN}══════════════════════════════════════════════════════════════════════════════════════{RESET}\n")

    if intercepted_count == total_attacks:
        print(f"{GREEN}{BOLD}✔ Mọi kịch bản đạt.{RESET} {DIM}(Chỉ các kịch bản [exec] chạy payload thật; [grep] chỉ kiểm tài liệu.){RESET}\n")
        return 0
    else:
        print(f"{RED}{BOLD}✖ Có kịch bản không đạt — xem chi tiết ở trên.{RESET}\n")
        return 1

if __name__ == "__main__":
    sys.exit(main())
