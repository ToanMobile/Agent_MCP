#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# adb-fps-measure.sh — Android Device Real-Time FPS & Jank Measurement Suite
#
# Connects to online physical device or emulator via ADB to measure
# rendering performance, frame drops (jank), and SurfaceFlinger latency.
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

PACKAGE="${1:-}"
DURATION_SEC="${2:-5}"

if [ -z "${PACKAGE}" ]; then
  echo "Usage: adb-fps-measure.sh <package_name> [duration_sec]"
  exit 1
fi

# 1. Device Enumeration Gate
DEVICES="$(adb devices | grep -v "List" | grep "device" || true)"
if [ -z "${DEVICES}" ]; then
  echo "⚠️ [DEVICE QA GATE] Không phát hiện thiết bị Android online! (adb devices rỗng)"
  echo "Ghi cờ: FPS_MEASUREMENT_UNTESTED"
  exit 0
fi

echo "📊 [ADB FPS MEASURE] Đang đo đạc hiệu năng FPS cho ${PACKAGE} trong ${DURATION_SEC} giây (Tự động kích hoạt Touch Injection ép vẽ frame)..."
adb shell dumpsys gfxinfo "${PACKAGE}" reset > /dev/null 2>&1 || true

AUTO_SWIPE="${AUTO_SWIPE:-1}"
SWIPE_PID=""
if [ "${AUTO_SWIPE}" = "1" ]; then
  # Tự động bơm thao tác cuộn (Touch Injection) để ép Choreographer / SurfaceFlinger render liên tục
  (
    END_TIME=$((SECONDS + DURATION_SEC))
    while [ $SECONDS -lt $END_TIME ]; do
      adb shell input swipe 500 1400 500 600 300 2>/dev/null || true
      sleep 0.4
      adb shell input swipe 500 600 500 1400 300 2>/dev/null || true
      sleep 0.4
    done
  ) &
  SWIPE_PID=$!
fi

sleep "${DURATION_SEC}"

if [ -n "${SWIPE_PID}" ]; then
  kill "${SWIPE_PID}" 2>/dev/null || true
  wait "${SWIPE_PID}" 2>/dev/null || true
fi

STATS="$(adb shell dumpsys gfxinfo "${PACKAGE}" 2>/dev/null || true)"
TOTAL_FRAMES="$(echo "${STATS}" | grep "Total frames rendered" | awk '{print $NF}' || echo "0")"
JANKY_FRAMES="$(echo "${STATS}" | grep "Janky frames" | head -1 | awk '{print $3}' || echo "0")"

echo "✔ Kết quả đo đạc FPS thực tế:"
echo "  • Tổng số frame đã render: ${TOTAL_FRAMES:-0}"
echo "  • Số frame bị giật (Jank):  ${JANKY_FRAMES:-0}"
if [ "${TOTAL_FRAMES:-0}" -gt 0 ]; then
  JANK_PERCENT=$(awk "BEGIN {print (${JANKY_FRAMES:-0}/${TOTAL_FRAMES})*100}")
  echo "  • Tỷ lệ giật khung hình:    ${JANK_PERCENT}%"
fi
