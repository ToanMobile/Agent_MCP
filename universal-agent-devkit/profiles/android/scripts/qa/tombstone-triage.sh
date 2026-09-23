#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# tombstone-triage.sh — Android Native Crash & Tombstone Diagnostic Suite
#
# Inspects `/data/tombstones/` and logcat for Native C/C++ crashes (SIGSEGV,
# SIGABRT, SIGBUS), pulls the latest tombstone trace, and symbolizes stack frames
# using `ndk-stack` when debug symbols or unstripped shared libraries are provided.
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

PACKAGE="${1:-}"
SYMBOLS_DIR="${2:-}"

DEVICES="$(adb devices 2>/dev/null | grep -v "List" | grep "device" || true)"
if [ -z "${DEVICES}" ]; then
  echo "⚠️ [TOMBSTONE TRIAGE] Không phát hiện thiết bị Android online qua 'adb devices'!"
  exit 0
fi

echo "🔍 [TOMBSTONE TRIAGE] Đang quét các tệp tombstone trên thiết bị..."
LATEST_TOMBSTONE="$(adb shell "ls -t /data/tombstones/tombstone_* 2>/dev/null | head -1" | tr -d '\r\n' || true)"

if [ -z "${LATEST_TOMBSTONE}" ]; then
  # Fallback: check logcat crash buffer for native crash signals
  NATIVE_CRASH="$(adb logcat -d -b crash | grep -E "SIGSEGV|SIGABRT|SIGBUS|backtrace:" || true)"
  if [ -n "${NATIVE_CRASH}" ]; then
    echo "❌ [NATIVE CRASH DETECTED IN LOGCAT]:"
    echo "${NATIVE_CRASH}" | head -30
    exit 1
  else
    echo "✔ SẠCH: Không phát hiện sự cố sập Native C/C++ (Tombstones rỗng, Logcat sạch)."
    exit 0
  fi
fi

echo "🚨 [NATIVE CRASH DETECTED] Phát hiện tombstone mới nhất: ${LATEST_TOMBSTONE}"
TEMP_DUMP="$(mktemp -t tombstone_XXXXXX.txt)"
trap 'rm -f "${TEMP_DUMP}"' EXIT

adb shell "cat ${LATEST_TOMBSTONE}" > "${TEMP_DUMP}" 2>/dev/null || true

# Trích xuất thông tin tín hiệu sập app (Crash Signal & Fault Address)
SIGNAL="$(grep -E "signal [0-9]+ \([A-Z]+\)" "${TEMP_DUMP}" | head -1 || true)"
PROCESS="$(grep -E "pid: [0-9]+, tid: [0-9]+, name:" "${TEMP_DUMP}" | head -1 || true)"
BACKTRACE="$(grep -A 20 "backtrace:" "${TEMP_DUMP}" | head -25 || true)"

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  THÔNG TIN SỰ CỐ NATIVE CRASH (TOMBSTONE TRIAGE)"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  • Tiến trình gặp sự cố: ${PROCESS:-Chưa xác định}"
echo "  • Tín hiệu lỗi (Signal): ${SIGNAL:-Chưa xác định}"
echo ""

# Symbolize bằng ndk-stack nếu có sẵn
NDK_STACK=""
if command -v ndk-stack >/dev/null 2>&1; then
  NDK_STACK="ndk-stack"
elif [ -n "${ANDROID_NDK_HOME:-}" ] && [ -x "${ANDROID_NDK_HOME}/ndk-stack" ]; then
  NDK_STACK="${ANDROID_NDK_HOME}/ndk-stack"
fi

if [ -n "${NDK_STACK}" ] && [ -n "${SYMBOLS_DIR}" ] && [ -d "${SYMBOLS_DIR}" ]; then
  echo "🛠️ [SYMBOLIZING] Đang giải mã địa chỉ nhị phân qua ndk-stack với thư mục: ${SYMBOLS_DIR}"
  "${NDK_STACK}" -sym "${SYMBOLS_DIR}" -dump "${TEMP_DUMP}" | head -35
else
  echo "📋 [RAW BACKTRACE] (Cung cấp thư mục debug symbols để phân tích dòng code chi tiết):"
  echo "${BACKTRACE}"
fi
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

exit 1
