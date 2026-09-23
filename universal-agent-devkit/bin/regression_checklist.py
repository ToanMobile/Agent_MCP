#!/usr/bin/env python3
"""
regression_checklist.py — Living regression checklist (features + bugs → tests → last result).

One place to see, across tasks, which features and fixed bugs are covered by which
regression test and whether that test last PASSED or FAILED, when, in which task
and on which commit.

  .agents/regression_status.json   source of truth (machine-written)
  .agents/regression_checklist.md  human view, regenerated from the JSON

Rules that keep it honest (same lesson as post-fix-gate: never a fabricated PASS):
  - A PASS/FAIL result is written ONLY by post-fix-gate after it actually ran the
    test command (--run-tests). There is no CLI to mark an item passed by hand.
  - A changed source file that no matrix rule covers becomes an UNCOVERED item —
    nobody invents a test for it; a human/agent must map it to a real test id.
  - A recorded bug starts as "needs test" until it is linked to a test id; from then
    on it shows that test's real last result.

CLI:
  regression_checklist.py show                     print the checklist
  regression_checklist.py link <ITEM> <TEST-ID>    link a bug / uncovered item to a matrix test
  regression_checklist.py render                   regenerate the Markdown view

100% standard library.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import tempfile
import time
from pathlib import Path

STATUS_FILE = Path(".agents") / "regression_status.json"
VIEW_FILE = Path(".agents") / "regression_checklist.md"
HISTORY_LIMIT = 10
RESULT_STATES = {"PASS", "FAIL", "TIMEOUT"}

ICON = {
    "PASS": "✅ PASS",
    "FAIL": "❌ FAIL",
    "TIMEOUT": "❌ TIMEOUT",
    "NOT_RUN": "⏳ chưa chạy",
    "NEEDS_TEST": "⚠️ cần test",
    "UNCOVERED": "⚠️ chưa có test",
}


def _now() -> str:
    return time.strftime("%Y-%m-%d %H:%M:%S")


def load(project_dir: Path) -> dict:
    path = Path(project_dir) / STATUS_FILE
    if not path.exists():
        return {"version": 1, "items": {}}
    with open(path, encoding="utf-8") as f:
        data = json.load(f)  # a corrupt file is an error, never silently reset to empty
    if not isinstance(data, dict) or not isinstance(data.get("items"), dict):
        raise ValueError(f"{path} không đúng định dạng checklist")
    return data


def save(project_dir: Path, data: dict) -> Path:
    path = Path(project_dir) / STATUS_FILE
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=str(path.parent), prefix=".regression_status.")
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
        f.write("\n")
    os.chmod(tmp, 0o644)
    os.replace(tmp, path)
    render(project_dir, data)
    return path


def _slug(text: str, max_len: int = 40) -> str:
    s = re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")
    return (s[:max_len].rstrip("-")) or "bug"


def sync_from_matrix(data: dict, matrix: dict) -> None:
    """Every mandatory regression test of the matrix is a checklist row (feature coverage)."""
    for rule in matrix.get("rules", []) or []:
        comp = rule.get("component", "UnknownComponent")
        for test in rule.get("mandatory_regression_tests", []) or []:
            tid = test.get("id")
            if not tid:
                continue
            item = data["items"].setdefault(tid, {"id": tid, "kind": "test", "last": None, "history": []})
            item.update({"title": test.get("name") or tid, "component": comp,
                         "command": test.get("command"), "watch_files": rule.get("watch_files", [])})


def record_results(data: dict, tests: list, *, task: str | None, commit: str | None) -> None:
    """Store results of tests the gate ACTUALLY ran. NOT_RUN only flags the row as impacted."""
    for t in tests:
        tid = t.get("id")
        if not tid or tid not in data["items"]:
            continue
        item = data["items"][tid]
        if t.get("status") not in RESULT_STATES:
            item["impacted_at"] = _now()
            continue
        result = {"status": t["status"], "at": _now(), "task": task, "commit": commit,
                  "duration": t.get("duration"), "exit_code": t.get("exit_code")}
        item["last"] = result
        item["history"] = ([result] + item.get("history", []))[:HISTORY_LIMIT]
        item.pop("impacted_at", None)


def add_uncovered(data: dict, files: list, *, task: str | None) -> list:
    """Changed source files no matrix rule covers → UNCOVERED rows (deduplicated by path)."""
    added = []
    for f in files:
        key = f"UNCOVERED:{f}"
        if key in data["items"]:
            data["items"][key]["seen_at"] = _now()
            continue
        data["items"][key] = {"id": key, "kind": "uncovered", "title": f, "component": "-",
                              "file": f, "created_at": _now(), "task": task, "last": None, "history": []}
        added.append(key)
    return added


def add_bug(data: dict, title: str, *, cause: str | None, task: str | None, test_ids: list) -> str:
    """A fixed bug. Linked to the regression test(s) the gate just ran green for it, if any."""
    bid = f"BUG-{time.strftime('%Y%m%d')}-{_slug(title)}"
    n = 2
    while bid in data["items"]:
        bid = f"BUG-{time.strftime('%Y%m%d')}-{_slug(title)}-{n}"
        n += 1
    data["items"][bid] = {"id": bid, "kind": "bug", "title": title, "cause": cause, "component": "-",
                          "created_at": _now(), "task": task, "tests": list(test_ids),
                          "last": None, "history": []}
    return bid


def link(data: dict, item_id: str, test_id: str) -> None:
    if item_id not in data["items"]:
        raise KeyError(f"Không có mục {item_id!r} trong checklist")
    if test_id not in data["items"] or data["items"][test_id].get("kind") != "test":
        raise KeyError(f"{test_id!r} không phải test id trong regression matrix (chạy gate một lần để đồng bộ)")
    item = data["items"][item_id]
    if item["kind"] == "uncovered":
        # Covered now: the row is resolved; keep it traceable as a note on the test.
        data["items"][test_id].setdefault("covers", []).append(item["file"])
        del data["items"][item_id]
        return
    if item["kind"] != "bug":
        raise ValueError("Chỉ link được mục bug hoặc UNCOVERED vào test")
    item.setdefault("tests", [])
    if test_id not in item["tests"]:
        item["tests"].append(test_id)


def effective_status(data: dict, item: dict) -> str:
    kind = item.get("kind")
    if kind == "uncovered":
        return "UNCOVERED"
    if kind == "bug":
        tests = [data["items"].get(t) for t in item.get("tests", [])]
        tests = [t for t in tests if t]
        if not tests:
            return "NEEDS_TEST"
        states = [effective_status(data, t) for t in tests]
        for bad in ("FAIL", "TIMEOUT", "NOT_RUN"):
            if bad in states:
                return bad
        return "PASS"
    return (item.get("last") or {}).get("status") or "NOT_RUN"


def summary(data: dict) -> dict:
    counts: dict = {}
    for item in data["items"].values():
        st = effective_status(data, item)
        counts[st] = counts.get(st, 0) + 1
    return counts


def _cell(text) -> str:
    return str(text if text not in (None, "") else "-").replace("|", "\\|").replace("\n", " ")


def render(project_dir: Path, data: dict) -> Path:
    order = {"FAIL": 0, "TIMEOUT": 0, "UNCOVERED": 1, "NEEDS_TEST": 1, "NOT_RUN": 2, "PASS": 3}
    rows = sorted(data["items"].values(), key=lambda i: (order.get(effective_status(data, i), 9), i["id"]))
    c = summary(data)
    lines = [
        "# 🧪 Regression Checklist",
        "",
        "> Tự sinh bởi `post-fix-gate --run-tests` — **không sửa tay** (sửa sẽ bị ghi đè).",
        "> PASS/FAIL chỉ đến từ lần gate chạy test thật. Link bug / file chưa có test vào test id:",
        "> `python3 bin/regression_checklist.py link <ID> <TEST-ID>`",
        "",
        f"**Cập nhật:** {_now()} · ✅ {c.get('PASS', 0)} · ❌ {c.get('FAIL', 0) + c.get('TIMEOUT', 0)}"
        f" · ⚠️ {c.get('UNCOVERED', 0) + c.get('NEEDS_TEST', 0)} · ⏳ {c.get('NOT_RUN', 0)}",
        "",
        "| Trạng thái | ID | Tính năng / Bug | Component | Lần chạy gần nhất | Task | Commit | Test |",
        "|---|---|---|---|---|---|---|---|",
    ]
    for item in rows:
        st = effective_status(data, item)
        last = item.get("last") or {}
        if item.get("kind") == "bug":
            tests = ", ".join(item.get("tests", [])) or "chưa link"
            last_ts = max((((data["items"].get(t) or {}).get("last") or {}).get("at", "") for t in item.get("tests", [])), default="")
        else:
            tests = item.get("command") or ("chưa có — cần gắn test" if item.get("kind") == "uncovered" else "-")
            last_ts = last.get("at", "")
        lines.append("| " + " | ".join(_cell(x) for x in (
            ICON.get(st, st), item["id"], item.get("title"), item.get("component"),
            last_ts, last.get("task") or item.get("task"), last.get("commit"), tests)) + " |")
    lines.append("")
    path = Path(project_dir) / VIEW_FILE
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("\n".join(lines), encoding="utf-8")
    return path


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description="Living regression checklist")
    parser.add_argument("--project", default=os.environ.get("CLAUDE_PROJECT_DIR") or os.getcwd())
    sub = parser.add_subparsers(dest="cmd", required=True)
    sub.add_parser("show")
    sub.add_parser("render")
    p_link = sub.add_parser("link")
    p_link.add_argument("item_id")
    p_link.add_argument("test_id")
    args = parser.parse_args(argv)
    project = Path(args.project)
    try:
        data = load(project)
        if args.cmd == "link":
            link(data, args.item_id, args.test_id)
            save(project, data)
            print(f"✔ Đã link {args.item_id} → {args.test_id}")
        elif args.cmd == "render":
            print(render(project, data))
        else:
            print((project / VIEW_FILE).read_text(encoding="utf-8") if (project / VIEW_FILE).exists()
                  else "Chưa có checklist — chạy post-fix-gate --run-tests một lần.")
    except (KeyError, ValueError, OSError) as e:
        print(f"✖ {e}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
