#!/usr/bin/env python3
"""
merge_markdown.py — Non-destructive boundary block injector for markdown files.
Preserves existing user content outside the marker boundaries.

Usage: merge_markdown.py <block_file> <target_file> [marker_id] [--comment-style=html|hash]
  html (default): <!-- id:start --> ... <!-- id:end -->
  hash          : # id:start ... # id:end   (for .gitignore and other #-comment files)
"""

import os
import re
import sys
import tempfile

DEVKIT_ROOT = os.path.realpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))


def _markers(marker_id: str, style: str):
    if style == "hash":
        return f"# {marker_id}:start", f"# {marker_id}:end"
    return f"<!-- {marker_id}:start -->", f"<!-- {marker_id}:end -->"


def _write_atomic(path: str, text: str) -> None:
    """Write via a temp file + rename, so an interrupted run never truncates the file."""
    directory = os.path.dirname(os.path.abspath(path)) or "."
    fd, tmp = tempfile.mkstemp(dir=directory, prefix=".merge_markdown.")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            f.write(text)
        if os.path.exists(path):
            os.chmod(tmp, os.stat(path).st_mode & 0o7777)
        else:
            os.chmod(tmp, 0o644)
        os.replace(tmp, path)
    except BaseException:
        if os.path.exists(tmp):
            os.unlink(tmp)
        raise


def merge_markdown(block_file: str, target_file: str, marker_id: str = "universal-agent-devkit",
                   style: str = "html") -> int:
    start_marker, end_marker = _markers(marker_id, style)

    with open(block_file, "r", encoding="utf-8") as f:
        block_content = f.read().strip()

    wrapped_block = f"{start_marker}\n{block_content}\n{end_marker}"

    # A project file that is a symlink INTO the devkit (e.g. CLAUDE.md -> DEVKIT/CLAUDE.md)
    # must not be written through: that would edit the devkit for every other project.
    if os.path.islink(target_file):
        real = os.path.realpath(target_file)
        if real == DEVKIT_ROOT or real.startswith(DEVKIT_ROOT + os.sep):
            sys.stderr.write(f"  - Skipped {target_file}: it is a symlink into the DevKit ({real}).\n")
            return 0
        target_file = real  # dotfile manager link: edit the real file, keep the link

    if not os.path.exists(target_file):
        _write_atomic(target_file, wrapped_block + "\n")
        print(f"  - Created {target_file} with {marker_id} block.")
        return 0

    with open(target_file, "r", encoding="utf-8") as f:
        original = f.read()

    pattern = re.compile(
        re.escape(start_marker) + r".*?" + re.escape(end_marker),
        re.DOTALL
    )

    if pattern.search(original):
        # Update existing block in place. A callable replacement: the block is literal
        # text, so backslashes in it (\d, \1 ...) must not be read as regex escapes.
        new_content = pattern.sub(lambda _m: wrapped_block, original, count=1)
        action = "Updated existing"
    else:
        # Append block to the end of the file
        new_content = original.rstrip() + "\n\n" + wrapped_block + "\n"
        action = "Injected"

    if new_content != original:
        _write_atomic(target_file, new_content)
    print(f"  - {action} {marker_id} block in {target_file} (Preserved custom content).")
    return 0


if __name__ == "__main__":
    args = [a for a in sys.argv[1:] if not a.startswith("--comment-style=")]
    styles = [a.split("=", 1)[1] for a in sys.argv[1:] if a.startswith("--comment-style=")]
    style = styles[-1] if styles else "html"
    if len(args) < 2 or style not in ("html", "hash"):
        print(__doc__.strip())
        sys.exit(2)
    b_file = args[0]
    t_file = args[1]
    m_id = args[2] if len(args) > 2 else "universal-agent-devkit"
    sys.exit(merge_markdown(b_file, t_file, m_id, style))
