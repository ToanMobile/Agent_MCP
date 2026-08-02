#!/bin/bash
# Build Geely EX2 App Manage cho macOS (chỉ Apple Silicon hiện tại) và Windows.
# Muốn thêm lại hỗ trợ Mac Intel: build thêm GOOS=darwin GOARCH=amd64, rồi dùng
# `lipo -create -output <file> <bản arm64> <bản amd64>` để gộp lại thành 1 file
# universal như trước.
# Chạy: ./build.sh  -> tạo các file trong ./dist
set -e
cd "$(dirname "$0")"
rm -rf dist
mkdir -p dist

APP_NAME="Geely EX2"
APP_DIR="dist/${APP_NAME}.app"

echo "==> Building macOS (Apple Silicon) ..."
GOOS=darwin GOARCH=arm64 go build -o "dist/Geely_EX2(MacOS)" .
chmod +x "dist/Geely_EX2(MacOS)"

# ---------------------------------------------------------------------------
# Đóng gói bản macOS thành .app rồi bỏ vào .dmg.
#
# Vì sao phải làm vậy: file thực thi trần (không đuôi) chỉ chạy được khi còn
# "execute bit". Gửi qua Zalo/Messenger/Google Drive/USB định dạng FAT32-exFAT
# thì bit đó bị mất, macOS lập tức coi file là "public.data" (tài liệu vô danh)
# chứ không còn là "public.unix-executable" — bấm đúp không ứng dụng nào nhận,
# người nhận chọn Open With → Terminal thì Terminal chỉ mở 1 cửa sổ dòng lệnh
# trắng chứ không chạy gì.
#
# .dmg là 1 image hệ thống tập tin: quyền thực thi nằm BÊN TRONG image nên
# không kênh truyền nào bóc mất được. Còn .app cho phép bấm đúp mở như mọi ứng
# dụng Mac bình thường.
# ---------------------------------------------------------------------------
echo "==> Đóng gói ${APP_NAME}.app ..."
mkdir -p "${APP_DIR}/Contents/MacOS"
cp "dist/Geely_EX2(MacOS)" "${APP_DIR}/Contents/MacOS/geely-ex2-core"
chmod +x "${APP_DIR}/Contents/MacOS/geely-ex2-core"

# Trình khởi động: mở lõi trong Terminal để người dùng thấy log và địa chỉ
# localhost (phòng khi trình duyệt không tự bật), đồng thời bấm Ctrl+C tắt được.
cat > "${APP_DIR}/Contents/MacOS/${APP_NAME}" <<'LAUNCHER'
#!/bin/sh
DIR="$(cd "$(dirname "$0")" && pwd)"
exec open -a Terminal "$DIR/geely-ex2-core"
LAUNCHER
chmod +x "${APP_DIR}/Contents/MacOS/${APP_NAME}"

cat > "${APP_DIR}/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>CFBundleName</key><string>${APP_NAME}</string>
	<key>CFBundleDisplayName</key><string>${APP_NAME}</string>
	<key>CFBundleExecutable</key><string>${APP_NAME}</string>
	<key>CFBundleIdentifier</key><string>vn.geely.ex2.appmanage</string>
	<key>CFBundlePackageType</key><string>APPL</string>
	<key>CFBundleShortVersionString</key><string>1.0</string>
	<key>CFBundleVersion</key><string>1.0</string>
	<key>LSMinimumSystemVersion</key><string>11.0</string>
	<key>LSUIElement</key><true/>
	<key>NSHighResolutionCapable</key><true/>
</dict>
</plist>
PLIST

# Ký ad-hoc toàn bộ bundle. Không qua được Gatekeeper (muốn vậy phải có tài
# khoản Apple Developer trả phí), nhưng tránh lỗi "app bị hỏng" do chữ ký lệch
# sau khi bundle bị sửa/copy.
codesign --force --deep --sign - "${APP_DIR}" >/dev/null 2>&1 || \
  echo "    (bỏ qua bước ký ad-hoc — không bắt buộc)"

cp macos-readme.txt "dist/ĐỌC TRƯỚC KHI CHẠY.txt"

echo "==> Tạo Geely_EX2(MacOS).dmg ..."
rm -rf dist/dmgroot && mkdir -p dist/dmgroot
cp -R "${APP_DIR}" dist/dmgroot/
cp "dist/ĐỌC TRƯỚC KHI CHẠY.txt" dist/dmgroot/
ln -s /Applications dist/dmgroot/Applications
hdiutil create -quiet -srcfolder dist/dmgroot -volname "${APP_NAME}" \
  -format UDZO -ov "dist/Geely_EX2(MacOS).dmg"
rm -rf dist/dmgroot

echo "==> Building Windows ..."
GOOS=windows GOARCH=amd64 go build -o "dist/Geely_EX2(Windows).exe" .

# Xoá file thực thi trần khỏi dist: bản thân nó chạy được trên máy này, nhưng
# hễ gửi cho người khác là mất quyền thực thi và không mở nổi. Để nó nằm cạnh
# .dmg chỉ khiến người dùng gửi nhầm đúng cái file hỏng. Bản macOS phát hành
# duy nhất là .dmg (đã chứa sẵn binary này bên trong .app).
rm -f "dist/Geely_EX2(MacOS)"

# Finder tự rải .DS_Store vào mọi thư mục nó đụng tới. Không có hại, nhưng
# nằm trong thư mục phát hành thì sẽ bị gửi kèm cho người dùng.
find dist -name '.DS_Store' -delete

echo "==> Xong. Các file nằm trong ./dist:"
ls -la dist
