#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# hardware_safety_gate.sh — Physical Hardware & Embedded Device Brick Protection
#
# Intercepts dangerous shell commands that risk bricking physical test devices,
# automotive IVI head-units, or embedded Android/Linux boards.
#
# BLOCKS (exit 2) when detecting:
#   • adb [-s SERIAL|-d|-e|-t ID|-H|-P …] remount / disable-verity / root+remount
#   • adb shell mount … rw … /system|/vendor|/product  (any flag order)
#   • dd … of=/dev/…   (any raw block/char device)
#   • fastboot [-s SERIAL …] flash|flashall|erase|format|update|oem unlock|flashing unlock
#   • rm with recursive+force flags in any spelling (-rf, -fr, -r -f, --recursive
#     --force) on /system, /vendor, /boot, /product, /data or /
#
# FAIL-CLOSED: malformed JSON or missing python3 → exit 2 (the command is not
# allowed through unexamined). Empty stdin → exit 0 (no tool call to judge).
#
# Protocol: stdin JSON; exit 2 blocks (stderr -> Agent); exit 0 allows.
# Escape hatches: HARDWARE_SAFETY_GATE=0 (disable), HARDWARE_OVERRIDE=1 (one-off).
# ─────────────────────────────────────────────────────────────────────────────
set -u

REPO_ROOT="${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}"
LOG_DIR="${REPO_ROOT}/.claude/audit-gate"
if [ "${HARDWARE_SAFETY_GATE:-1}" = "0" ] || [ "${HARDWARE_OVERRIDE:-0}" = "1" ]; then
  if mkdir -p "${LOG_DIR}" 2>/dev/null; then
    [ -f "${LOG_DIR}/.gitignore" ] || printf '*\n' > "${LOG_DIR}/.gitignore" 2>/dev/null || true
    echo "[$(date +%Y-%m-%dT%H:%M:%S)] HARDWARE_SAFETY_GATE=${HARDWARE_SAFETY_GATE:-1} HARDWARE_OVERRIDE=${HARDWARE_OVERRIDE:-0} — gate bypassed" \
      >> "${LOG_DIR}/hardware_safety_gate.log" 2>/dev/null
  fi
  exit 0
fi

if ! command -v python3 >/dev/null 2>&1; then
  echo "🛑 [HARDWARE SAFETY GATE] cần python3 để phân tích lệnh — chặn để an toàn (HARDWARE_SAFETY_GATE=0 để tắt)." >&2
  exit 2
fi

python3 -c '
import sys, json, re

raw = sys.stdin.read()
if not raw.strip():
    sys.exit(0)

try:
    data = json.loads(raw)
    inp = data.get("tool_input") or data.get("input") or {}
    cmd = inp.get("command") or inp.get("CommandLine") or ""
except Exception:
    sys.stderr.write("🛑 [HARDWARE SAFETY GATE] không đọc được JSON đầu vào — chặn để an toàn.\n")
    sys.exit(2)
if not isinstance(cmd, str):
    sys.stderr.write("🛑 [HARDWARE SAFETY GATE] tool_input.command không phải chuỗi — chặn để an toàn.\n")
    sys.exit(2)

# Options adb/fastboot accept before the subcommand (with or without a value).
ADB_OPTS = r"(?:\s+(?:-[sHPtL]\s+\S+|-[adeU]|--\S+(?:\s+\S+)?))*"
FB_OPTS = r"(?:\s+(?:-[sSciopn]\s+\S+|-w|-u|--\S+(?:=\S+)?))*"
SYS_PARTS = r"/(?:system|vendor|boot|product|odm|data|persist|efs)?(?:/|\s|$|[;&|])"

PATTERNS = [
    (r"\badb" + ADB_OPTS + r"\s+(?:remount|disable-verity|enable-verity)\b",
     "adb remount/disable-verity (nguy cơ phá dm-verity gây brick thiết bị)"),
    (r"\bmount\b[^;&|\n]*\brw\b[^;&|\n]*/(?:system|vendor|product|odm)\b",
     "mount phân vùng hệ thống ở chế độ rw"),
    (r"\bmount\b[^;&|\n]*/(?:system|vendor|product|odm)\b[^;&|\n]*\brw\b",
     "mount phân vùng hệ thống ở chế độ rw"),
    (r"\bdd\b[^;&|\n]*\bof=/dev/", "dd ghi thẳng vào thiết bị khối /dev/…"),
    (r"\bfastboot" + FB_OPTS + r"\s+(?:flash|flashall|erase|format|update)\b",
     "fastboot flash/erase/format (can thiệp bootloader thiết bị thật)"),
    (r"\bfastboot" + FB_OPTS + r"\s+(?:oem|flashing)\s+(?:unlock|lock)\b",
     "fastboot oem/flashing unlock (xoá sạch thiết bị)"),
]

def rm_hits(text):
    """rm with both recursive and force flags on a system partition or /."""
    for seg in re.split(r"[;&|\n]+", text):
        toks = seg.split()
        for i, t in enumerate(toks):
            if t.rsplit("/", 1)[-1] != "rm":
                continue
            args = toks[i + 1:]
            flags = "".join(a[1:] for a in args if a.startswith("-") and not a.startswith("--"))
            longs = {a for a in args if a.startswith("--")}
            rec = "r" in flags or "R" in flags or "--recursive" in longs
            force = "f" in flags or "--force" in longs
            targets = [a for a in args if not a.startswith("-")]
            if rec and force and any(re.match(SYS_PARTS, a + " ") for a in targets):
                return True
    return False

label = None
for pat, lab in PATTERNS:
    if re.search(pat, cmd):
        label = lab
        break
if label is None and rm_hits(cmd):
    label = "rm -rf phân vùng hệ thống cốt lõi"

if label:
    sys.stderr.write("\n🛑 [HARDWARE SAFETY GATE REJECTED]\n")
    sys.stderr.write("Lệnh bị chặn vì có nguy cơ làm hỏng phần cứng vật lý (device bricking):\n")
    sys.stderr.write(f"  • Mẫu vi phạm: {label}\n")
    sys.stderr.write(f"  • Lệnh: {cmd}\n\n")
    sys.stderr.write("Nếu chắc chắn đang ở môi trường giả lập an toàn, đặt HARDWARE_OVERRIDE=1 để bỏ qua.\n")
    sys.exit(2)
sys.exit(0)
'
