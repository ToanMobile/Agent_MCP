#!/bin/bash
# Build Geely EX2 App Manage cho macOS (chỉ Apple Silicon hiện tại) và Windows.
# Muốn thêm lại hỗ trợ Mac Intel: build thêm GOOS=darwin GOARCH=amd64, rồi dùng
# `lipo -create -output "dist/Geely_EX2(MacOS)" <bản arm64> <bản amd64>` để gộp
# lại thành 1 file universal như trước.
# Chạy: ./build.sh  -> tạo các file trong ./dist
set -e
cd "$(dirname "$0")"
mkdir -p dist

echo "==> Building macOS (Apple Silicon) ..."
GOOS=darwin GOARCH=arm64 go build -o "dist/Geely_EX2(MacOS)" .
chmod +x "dist/Geely_EX2(MacOS)"

echo "==> Building Windows ..."
GOOS=windows GOARCH=amd64 go build -o "dist/Geely_EX2(Windows).exe" .

echo "==> Xong. Các file nằm trong ./dist:"
ls -la dist
