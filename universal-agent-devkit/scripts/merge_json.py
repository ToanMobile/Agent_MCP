#!/usr/bin/env python3
"""
merge_json.py — Additively merge a DevKit JSON template into a user's JSON file.
Usage: python3 merge_json.py <source_json> <target_json>

Rules (user data always wins):
  - dicts merge recursively; a key the user already has keeps the user's value
  - lists union; hook groups ({"matcher", "hooks": [...]}) are deduplicated by
    each hook's `command`, so re-running the installer never duplicates a hook
  - an unparseable target (e.g. JSONC with comments) aborts with exit 1 and is
    never overwritten
  - when a merge changes an existing file whose `<stem>_old<ext>` backup is
    already taken by a different version, a timestamped `<stem>_old.<ts><ext>`
    backup is written first
"""
import json
import os
import re
import shutil
import sys
import tempfile
import time


def _matcher_set(group):
    m = group.get("matcher") or ""
    return None if m in ("", "*") else set(m.split("|"))  # None = matches every tool


def _overlap(a, b):
    return a is None or b is None or bool(a & b)


def _hook_key(hook):
    """Identity of a hook = the script PATH it runs, with quoting and the leading
    project-dir variable normalised away, so `"$DIR"/.claude/hooks/x.sh` and
    `bash "$DIR/.claude/hooks/x.sh"` (older template spelling) are the same hook and
    never installed twice — while a user's own `scripts/x.sh` that merely shares the
    file name is a different hook and is kept."""
    cmd = hook.get("command", "") if isinstance(hook, dict) else ""
    unquoted = cmd.replace('"', "").replace("'", "")
    m = re.search(r"(\S*[\w.-]+\.(?:sh|py|js|mjs))\b", unquoted)
    if not m:
        return cmd
    path = re.sub(r"^(?:\$\{[^}]*\}|\$\w+)", "", m.group(1))
    path = path.lstrip("/")
    while path.startswith("./"):
        path = path[2:]
    return path


def _merge_list(source, target):
    """Union of lists. Hook groups: a hook is skipped only when the same script is
    already wired under an OVERLAPPING matcher (Edit|Write vs Edit|Write|NotebookEdit);
    the same script under a disjoint matcher (Edit vs Write) is a different hook."""
    for item in source:
        if isinstance(item, dict) and isinstance(item.get("hooks"), list):
            src_m = _matcher_set(item)
            present = {_hook_key(h) for t in target
                       if isinstance(t, dict) and isinstance(t.get("hooks"), list)
                       and _overlap(_matcher_set(t), src_m)
                       for h in t["hooks"]}
            new_hooks = [h for h in item["hooks"] if _hook_key(h) not in present]
            if not new_hooks:
                continue
            same = next((t for t in target if isinstance(t, dict)
                         and isinstance(t.get("hooks"), list)
                         and (t.get("matcher") or "") == (item.get("matcher") or "")), None)
            if same is not None:
                same["hooks"].extend(new_hooks)
            else:
                target.append({**item, "hooks": new_hooks})
        elif isinstance(item, dict) and isinstance(item.get("command"), str):
            if not any(isinstance(t, dict) and t.get("command") == item["command"] for t in target):
                target.append(item)
        elif item not in target:
            target.append(item)


def deep_merge(source, target):
    for key, val in source.items():
        if key not in target:
            target[key] = val
        elif isinstance(val, dict) and isinstance(target[key], dict):
            deep_merge(val, target[key])
        elif isinstance(val, list) and isinstance(target[key], list):
            _merge_list(val, target[key])
        # else: the user already set this key — keep their value
    return target


def _load(path, role):
    try:
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
    except (OSError, ValueError, UnicodeDecodeError) as e:
        sys.stderr.write(f"merge_json: cannot parse {role} {path}: {e}\n"
                         f"merge_json: {role} left untouched — fix it (JSON has no comments) and re-run.\n")
        sys.exit(1)
    if not isinstance(data, dict):
        sys.stderr.write(f"merge_json: {role} {path} is not a JSON object — left untouched.\n")
        sys.exit(1)
    return data


def _backup_if_needed(target_file, original_text):
    stem, ext = os.path.splitext(target_file)
    first = f"{stem}_old{ext}"
    if os.path.exists(first):
        with open(first, "r", encoding="utf-8") as f:
            if f.read() == original_text:
                return
        backup = f"{stem}_old.{time.strftime('%Y%m%d-%H%M%S')}{ext}"
    else:
        backup = first
    fd = os.open(backup, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        f.write(original_text)
    shutil.copymode(target_file, backup)  # backup is exactly as private as the original


def main(argv):
    if len(argv) < 3:
        sys.stderr.write(__doc__)
        return 2
    source_file, target_file = argv[1], argv[2]
    # A symlinked target (dotfile managers) is merged into the real file; replacing
    # the link with a regular file would silently fork the user's config.
    target_file = os.path.realpath(target_file)
    if not os.path.exists(source_file):
        sys.stderr.write(f"merge_json: source {source_file} not found — nothing merged.\n")
        return 1
    source_data = _load(source_file, "source")

    original_text = None
    target_data = {}
    if os.path.exists(target_file):
        target_data = _load(target_file, "target")  # exits 1 on unreadable / non-UTF-8 / invalid
        with open(target_file, "r", encoding="utf-8") as f:
            original_text = f.read()

    merged = deep_merge(source_data, target_data)
    new_text = json.dumps(merged, indent=2, ensure_ascii=False) + "\n"
    if original_text is not None:
        if json.loads(original_text) == merged:
            return 0
        _backup_if_needed(target_file, original_text)

    target_dir = os.path.dirname(os.path.abspath(target_file))
    try:
        os.makedirs(target_dir, exist_ok=True)
        fd, tmp = tempfile.mkstemp(dir=target_dir, prefix=".merge_json.")
    except OSError as e:
        sys.stderr.write(f"merge_json: cannot write next to {target_file}: {e}\n")
        return 1
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        f.write(new_text)
    # mkstemp creates 0600 — keep the user's mode, or a normal 0644 for a new file
    if original_text is not None:
        shutil.copymode(target_file, tmp)
    else:
        os.chmod(tmp, 0o644)
    os.replace(tmp, target_file)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
