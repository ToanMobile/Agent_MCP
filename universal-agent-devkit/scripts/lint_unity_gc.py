#!/usr/bin/env python3
"""
lint_unity_gc.py — Unity Zero-GC & Hot-Path Frame Loop Linter (REGEX-BASED)

Linter dựa trên regex + đếm ngoặc theo dòng, KHÔNG phải AST/Roslyn: có thể báo sót hoặc báo nhầm.
Exit code: 0 = không vi phạm, 1 = có vi phạm, 2 = lỗi sử dụng (thiếu tham số / đường dẫn không tồn tại).
Bỏ qua theo THƯ MỤC (Test/, Tests/, Editor/, Packages/, Plugins/) hoặc HẬU TỐ (*Test.cs, *Tests.cs),
không lọc theo chuỗi con "test" trong đường dẫn.

Phát hiện trên file C# (.cs):
1. Heap allocations (`new `) inside `Update()`, `FixedUpdate()`, `LateUpdate()`, `OnGUI()`.
   (Exempts value type structs like Vector2/3/4, Quaternion, Color, Rect, etc.)
2. Expensive hierarchy searches and GetComponent calls inside frame loops.
3. Allocating physics methods (RaycastAll, OverlapSphere) instead of NonAlloc variants.
4. LINQ invocations (.Where, .Select, .ToList) inside frame loops generating per-frame GC.
"""

import sys
import re
from pathlib import Path

# Safe struct/value types allocated on the stack, not the managed heap
SAFE_STRUCT_TYPES = {
    "Vector2", "Vector3", "Vector4", "Vector2Int", "Vector3Int",
    "Quaternion", "Color", "Color32", "Ray", "RaycastHit", "RaycastHit2D",
    "Matrix4x4", "Rect", "RectInt", "Bounds", "BoundsInt", "Plane", "Pose",
    "CancellationToken", "NativeArray"
}

FRAME_LOOP_METHODS = {"Update", "FixedUpdate", "LateUpdate", "OnGUI"}
SKIP_DIRS = {"test", "tests", "editor", "packages", "plugins"}
TEST_SUFFIXES = ("test.cs", "tests.cs")


def is_excluded(path: Path) -> bool:
    parts = [x.lower() for x in path.parts[:-1]]
    return any(x in SKIP_DIRS for x in parts) or path.name.lower().endswith(TEST_SUFFIXES)

# LINQ methods that generate per-frame iterator / delegate garbage
LINQ_METHODS = {"Where", "Select", "OrderBy", "OrderByDescending", "GroupBy", "ToList", "ToArray", "Any", "All", "First", "FirstOrDefault"}

def check_csharp_file(file_path: Path) -> list:
    findings = []
    try:
        with open(file_path, "r", encoding="utf-8", errors="replace") as f:
            lines = f.readlines()
    except Exception as e:
        return [f"Cannot read file: {e}"]

    in_frame_loop = False
    current_loop_name = ""
    bracket_depth = 0
    loop_start_line = 0

    for idx, line in enumerate(lines, 1):
        stripped = line.strip()
        if stripped.startswith("//") or stripped.startswith("/*") or stripped.startswith("*"):
            continue

        # Detect start of frame loop methods: void Update(), private void FixedUpdate(), etc.
        m_loop = re.search(r"\b(void|IEnumerator)\s+(Update|FixedUpdate|LateUpdate|OnGUI)\s*\(", line)
        if m_loop:
            in_frame_loop = True
            current_loop_name = m_loop.group(2)
            loop_start_line = idx
            bracket_depth = 0

        if in_frame_loop:
            # 1. Check for `new ` heap allocations
            # Pattern: new Type(...) or new Type[...]
            new_matches = re.finditer(r"\bnew\s+([A-Za-z0-9_<>\[\],\s]+?)\s*(\(|\[)", stripped)
            for m in new_matches:
                type_name = m.group(1).strip()
                # Extract base type name if generic or array
                base_type = re.split(r"[<\[]", type_name)[0].strip()
                if base_type not in SAFE_STRUCT_TYPES:
                    findings.append(
                        f"Line {idx} in `{current_loop_name}()`: Heap allocation `new {type_name}` inside hot frame loop. "
                        f"Cache instance in Awake/Start or use an Object Pool to prevent GC frame spikes."
                    )

            # 2. Check for expensive GameObject/Component searches
            if re.search(r"\b(GameObject\.)?Find(WithTag)?\s*\(", stripped):
                findings.append(
                    f"Line {idx} in `{current_loop_name}()`: Costly hierarchy search `GameObject.Find...()` inside hot loop. "
                    f"Cache references in Awake/Start."
                )

            if re.search(r"\b(FindObjectOfType|FindObjectsOfType|FindAnyObjectByType|FindFirstObjectByType)\s*[<(]", stripped):
                findings.append(
                    f"Line {idx} in `{current_loop_name}()`: Costly global scene search `FindObject(s)OfType` inside hot loop. "
                    f"Cache references in Awake/Start or inject via dependency injection."
                )

            if re.search(r"\bGetComponent(s)?(InChildren|InParent)?\s*[<(]", stripped):
                findings.append(
                    f"Line {idx} in `{current_loop_name}()`: `GetComponent` called every frame. "
                    f"Cache component reference in Awake() or Start()."
                )

            # 3. Check for LINQ in hot loop
            for linq in LINQ_METHODS:
                if re.search(rf"\.{linq}\s*\(", stripped):
                    findings.append(
                        f"Line {idx} in `{current_loop_name}()`: LINQ invocation `.{linq}()` creates per-frame delegate/iterator garbage. "
                        f"Use for/foreach with pre-allocated buffer."
                    )
                    break

            # 4. Check for allocating Physics queries
            if re.search(r"\bPhysics(2D)?\.RaycastAll\s*\(", stripped):
                findings.append(
                    f"Line {idx} in `{current_loop_name}()`: `Physics.RaycastAll` allocates new array every call. "
                    f"Use `Physics.RaycastNonAlloc` with pre-allocated RaycastHit buffer."
                )
            if re.search(r"\bPhysics(2D)?\.Overlap(Sphere|Box|Capsule|Circle)All?\s*\(", stripped):
                findings.append(
                    f"Line {idx} in `{current_loop_name}()`: `Physics.Overlap...` allocates new Collider array. "
                    f"Use `Physics.Overlap...NonAlloc` with pre-allocated Collider buffer."
                )

            # Track bracket depth to know when we exit the frame loop method
            bracket_depth += line.count("{") - line.count("}")
            if bracket_depth <= 0 and idx > loop_start_line and "{" in "".join(lines[loop_start_line-1:idx]):
                in_frame_loop = False
                current_loop_name = ""

    return findings

def main():
    if len(sys.argv) < 2:
        print("Usage: lint_unity_gc.py <file_or_dir> [...]", file=sys.stderr)
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
        files = [p] if p.is_file() else sorted(p.rglob("*.cs"))
        for cs_file in files:
            if p.is_dir() and is_excluded(cs_file.relative_to(p)):
                continue
            scanned += 1
            violations = check_csharp_file(cs_file)
            if violations:
                print(f"❌ [UNITY GC VIOLATION] {cs_file}:")
                for v in violations:
                    print(f"   • {v}")
                total_violations += len(violations)

    if total_violations == 0:
        print(f"✔ [UNITY GC PASS] {scanned} file .cs đã quét (regex-based), không phát hiện vi phạm.")
        sys.exit(0)
    else:
        print(f"\n🚨 Phát hiện {total_violations} vi phạm Unity GC / Frame Loop ({scanned} file, regex-based).")
        sys.exit(1)

if __name__ == "__main__":
    main()
