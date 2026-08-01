#!/bin/bash
# Build Geely EX2 App Manage cho macOS (Intel + Apple Silicon) và Windows.
# Chạy: ./build.sh  -> tạo các file trong ./dist
set -e
cd "$(dirname "$0")"
mkdir -p dist

echo "==> Building macOS (Apple Silicon) ..."
GOOS=darwin GOARCH=arm64 go build -o dist/apk_manager_macos_silicon .

echo "==> Building macOS (Intel) ..."
GOOS=darwin GOARCH=amd64 go build -o dist/apk_manager_macos_intel .

echo "==> Building Windows ..."
GOOS=windows GOARCH=amd64 go build -o dist/apk_manager_windows.exe .

cat > dist/run_mac.command <<'EOF'
#!/bin/bash
cd "$(dirname "$0")"
if [ "$(uname -m)" = "arm64" ]; then
  ./apk_manager_macos_silicon
else
  ./apk_manager_macos_intel
fi
EOF
chmod +x dist/run_mac.command dist/apk_manager_macos_silicon dist/apk_manager_macos_intel

echo "==> Xong. Các file nằm trong ./dist:"
ls -la dist
