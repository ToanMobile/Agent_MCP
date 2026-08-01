package main

import (
	"archive/zip"
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"sync"
	"time"
)

var knownABIs = map[string]bool{
	"arm64_v8a": true, "armeabi_v7a": true, "armeabi": true,
	"x86_64": true, "x86": true, "mips64": true, "mips": true,
}

// Manager giữ trạng thái thiết bị hiện tại + đường dẫn adb/aapt, tương đương
// các biến toàn cục trong apk_manager.sh (ADB, DEVICE, DEVICE_ABILIST...).
type Manager struct {
	mu sync.Mutex

	Cfg      *Config
	AdbPath  string
	AaptPath string

	Device   string
	ABI      string
	SDK      string
	WifiSSID string

	labelMu    sync.RWMutex
	labelCache map[string]string // package name -> tên app hiển thị, học được từ các APK đã quét
}

func NewManager(cfg *Config) *Manager {
	m := &Manager{Cfg: cfg, labelCache: map[string]string{}}
	adbPath := cfg.AdbPath
	if adbPath == "" || !fileExecutable(adbPath) {
		if found, _ := DetectAdb(); found != "" {
			adbPath = found
		}
	}
	m.AdbPath = adbPath
	if adbPath != "" {
		m.AaptPath = DetectAapt(adbPath)
	}
	return m
}

func (m *Manager) SetAdbPath(path string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.AdbPath = path
	if path != "" {
		m.AaptPath = DetectAapt(path)
	}
}

// ---- helpers gọi adb ----

func (m *Manager) run(ctx context.Context, args ...string) (string, error) {
	if m.AdbPath == "" {
		return "", errors.New("chưa cấu hình đường dẫn adb")
	}
	cmd := exec.CommandContext(ctx, m.AdbPath, args...)
	out, err := cmd.CombinedOutput()
	return string(out), err
}

func (m *Manager) runTimeout(secs int, args ...string) (string, error) {
	ctx, cancel := context.WithTimeout(context.Background(), time.Duration(secs)*time.Second)
	defer cancel()
	return m.run(ctx, args...)
}

// extractError lọc output adb: bỏ dòng tiến trình (\r, %, MB/s), giữ dòng lỗi.
func extractError(out string) string {
	raw := strings.ReplaceAll(out, "\r", "\n")
	lines := strings.Split(raw, "\n")
	progressRe := regexp.MustCompile(`(?i)Performing .*Install|^\[\s*\d+%\]|[0-9.]+\s*MB/s`)

	var cleaned []string
	for _, l := range lines {
		t := strings.TrimSpace(l)
		if t == "" || progressRe.MatchString(t) {
			continue
		}
		cleaned = append(cleaned, t)
	}

	keyRe := regexp.MustCompile(`(?i)Failure|Error|Exception|^adb:`)
	var key []string
	for _, l := range cleaned {
		if keyRe.MatchString(l) {
			key = append(key, l)
		}
	}
	if len(key) > 0 {
		return strings.Join(lastN(key, 3), "\n")
	}
	return strings.Join(lastN(cleaned, 3), "\n")
}

func lastN(s []string, n int) []string {
	if len(s) <= n {
		return s
	}
	return s[len(s)-n:]
}

var signaturesMismatchRe = regexp.MustCompile(`(?is)signatures.*do.*not.*match`)

func isConflictError(err string) bool {
	upper := strings.ToUpper(err)
	for _, key := range []string{"UPDATE_INCOMPATIBLE", "DUPLICATE_PACKAGE", "ALREADY_EXISTS", "VERSION_DOWNGRADE"} {
		if strings.Contains(upper, key) {
			return true
		}
	}
	return signaturesMismatchRe.MatchString(err)
}

var pkgFromErrorRe = regexp.MustCompile(`Existing package ([A-Za-z0-9_.]+)`)

func pkgFromError(err string) string {
	m := pkgFromErrorRe.FindStringSubmatch(err)
	if m == nil {
		return ""
	}
	return m[1]
}

func explainError(err, deviceABI string) string {
	upper := strings.ToUpper(err)
	switch {
	case strings.Contains(upper, "UPDATE_INCOMPATIBLE"), strings.Contains(upper, "DUPLICATE_PACKAGE"), signaturesMismatchRe.MatchString(err):
		return "App đã cài sẵn nhưng khác chữ ký (bản mod vs bản gốc)."
	case strings.Contains(upper, "NO_MATCHING_ABIS"):
		abi := deviceABI
		if abi == "" {
			abi = "?"
		}
		return fmt.Sprintf("APK không có thư viện native cho ABI của xe (%s). Cần bản APK đúng kiến trúc.", abi)
	case strings.Contains(upper, "INSUFFICIENT_STORAGE"):
		return "Hết dung lượng. Xoá bớt app hoặc dọn cache."
	case strings.Contains(upper, "OLDER_SDK"):
		return "App yêu cầu Android mới hơn phiên bản trên xe."
	case strings.Contains(upper, "VERSION_DOWNGRADE"):
		return "Bản đang cài mới hơn. Gỡ bản cũ rồi cài lại."
	case strings.Contains(upper, "INVALID_APK"), strings.Contains(upper, "PARSE"):
		return "File APK hỏng hoặc không hợp lệ."
	case strings.Contains(upper, "TEST_ONLY"):
		return "APK là bản test-only, cần cài kèm cờ -t."
	}
	return ""
}

// ---- kết nối thiết bị ----

type deviceInfo struct {
	Serial string
	State  string
}

func (m *Manager) listDevices() ([]deviceInfo, error) {
	out, err := m.runTimeout(15, "devices")
	if err != nil {
		return nil, err
	}
	var devices []deviceInfo
	for _, line := range strings.Split(out, "\n") {
		line = strings.TrimSpace(strings.TrimRight(line, "\r"))
		if line == "" || strings.HasPrefix(line, "List of devices") {
			continue
		}
		fields := strings.Fields(line)
		if len(fields) >= 2 {
			devices = append(devices, deviceInfo{Serial: fields[0], State: fields[1]})
		}
	}
	return devices, nil
}

// Connect tương đương connect_device() trong bash. Nếu có nhiều thiết bị và
// không thiết bị nào khớp IP, trả về ErrMultiDevice để frontend hiện picker.
var ErrMultiDevice = errors.New("multi-device")
var ErrNoDevice = errors.New("no-device")

func (m *Manager) Connect(log func(string)) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	target := m.Cfg.IP + ":" + m.Cfg.Port
	log(fmt.Sprintf("🔌 Đang kết nối tới %s ...", target))

	ctx, cancel := context.WithTimeout(context.Background(), 12*time.Second)
	out, err := m.run(ctx, "connect", target)
	cancel()

	if ctx.Err() == context.DeadlineExceeded {
		log("   ⚠️  Quá 12s không phản hồi — thiết bị có thể đang tắt hoặc khác mạng WiFi.")
	} else if err == nil {
		outTrim := strings.TrimSpace(out)
		if !strings.Contains(outTrim, "connected to") {
			log("   ⚠️  " + outTrim)
		}
	}
	time.Sleep(1 * time.Second)

	devicesRaw, lerr := m.listDevices()
	if lerr != nil {
		return lerr
	}
	var ready []string
	for _, d := range devicesRaw {
		if d.State == "device" {
			ready = append(ready, d.Serial)
		}
	}

	if len(ready) == 0 {
		log("❌ Không tìm thấy thiết bị nào ở trạng thái 'device'.")
		m.Device = ""
		return ErrNoDevice
	}

	var picked string
	for _, s := range ready {
		if strings.Contains(s, m.Cfg.IP) {
			picked = s
			break
		}
	}

	if picked == "" {
		if len(ready) == 1 {
			picked = ready[0]
			log("✅ Đã kết nối 1 thiết bị: " + picked)
		} else {
			log("⚠️  Phát hiện nhiều thiết bị, hãy chọn thiết bị ở danh sách bên dưới.")
			m.Device = ""
			return ErrMultiDevice
		}
	} else {
		log("✅ Đã kết nối thiết bị: " + picked)
	}

	return m.selectDeviceLocked(picked, log)
}

func (m *Manager) SelectDevice(serial string, log func(string)) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.selectDeviceLocked(serial, log)
}

func (m *Manager) selectDeviceLocked(serial string, log func(string)) error {
	m.Device = serial
	abilist, _ := m.runTimeout(10, "-s", serial, "shell", "getprop", "ro.product.cpu.abilist")
	abilist = strings.TrimSpace(strings.ReplaceAll(abilist, "\r", ""))
	if abilist == "" {
		abilist, _ = m.runTimeout(10, "-s", serial, "shell", "getprop", "ro.product.cpu.abi")
		abilist = strings.TrimSpace(strings.ReplaceAll(abilist, "\r", ""))
	}
	m.ABI = abilist
	sdk, _ := m.runTimeout(10, "-s", serial, "shell", "getprop", "ro.build.version.sdk")
	sdk = strings.TrimSpace(strings.ReplaceAll(sdk, "\r", ""))
	m.SDK = sdk
	m.WifiSSID = m.fetchWifiSSID(serial)

	sdkDisp := sdk
	if sdkDisp == "" {
		sdkDisp = "?"
	}
	abiDisp := abilist
	if abiDisp == "" {
		abiDisp = "?"
	}
	wifiDisp := m.WifiSSID
	if wifiDisp == "" {
		wifiDisp = "?"
	}
	log(fmt.Sprintf("   ℹ️  SDK: %s   ABI: %s   Wi-Fi: %s", sdkDisp, abiDisp, wifiDisp))
	return nil
}

var wifiStatusConnectedRe = regexp.MustCompile(`(?i)Wifi is connected to "([^"]*)"`)
var wifiInfoSSIDRe = regexp.MustCompile(`SSID:\s*"([^"]*)"`)

// fetchWifiSSID lấy tên mạng Wi-Fi hiện tại thiết bị đang kết nối, để hiển thị
// trong panel cấu hình — người dùng biết xe đang bắt Wi-Fi nào.
func (m *Manager) fetchWifiSSID(serial string) string {
	out, _ := m.runTimeout(10, "-s", serial, "shell", "cmd", "wifi", "status")
	if mm := wifiStatusConnectedRe.FindStringSubmatch(out); mm != nil {
		return mm[1]
	}
	out2, _ := m.runTimeout(10, "-s", serial, "shell", "dumpsys", "wifi")
	if mm := wifiInfoSSIDRe.FindStringSubmatch(out2); mm != nil && mm[1] != "<unknown ssid>" {
		return mm[1]
	}
	return ""
}

func (m *Manager) EnsureDevice() error {
	if m.Device == "" {
		return errors.New("chưa có thiết bị, hãy kết nối lại")
	}
	out, err := m.runTimeout(10, "-s", m.Device, "get-state")
	if err != nil || strings.TrimSpace(strings.ReplaceAll(out, "\r", "")) != "device" {
		return fmt.Errorf("thiết bị %s không sẵn sàng (trạng thái: %s)", m.Device, strings.TrimSpace(out))
	}
	return nil
}

func (m *Manager) DeviceList() ([]deviceInfo, error) {
	return m.listDevices()
}

// ---- cài đặt ----

// runInstall tương đương run_install() trong bash: thử -r -g, rồi -r, rồi -r -d
// (hạ cấp) khi gặp VERSION_DOWNGRADE.
func (m *Manager) runInstall(cmdName string, args []string, log func(string)) (bool, string) {
	full := append([]string{"-s", m.Device, cmdName, "-r", "-g"}, args...)
	out, err := m.runTimeout(180, full...)
	if err == nil && !strings.Contains(out, "Failure") && !strings.Contains(out, "Error") && !strings.Contains(out, "Exception") {
		return true, ""
	}

	full2 := append([]string{"-s", m.Device, cmdName, "-r"}, args...)
	out2, err2 := m.runTimeout(180, full2...)
	if err2 == nil && !strings.Contains(out2, "Failure") && !strings.Contains(out2, "Error") && !strings.Contains(out2, "Exception") {
		log("   ⚠️  Đã cài được nhưng phải bỏ -g (không cấp sẵn quyền).")
		return true, ""
	}

	lastErr := extractError(out2)
	if lastErr == "" {
		lastErr = extractError(out)
	}

	if strings.Contains(strings.ToUpper(lastErr), "VERSION_DOWNGRADE") {
		full3 := append([]string{"-s", m.Device, cmdName, "-r", "-d"}, args...)
		out3, err3 := m.runTimeout(180, full3...)
		if err3 == nil && !strings.Contains(out3, "Failure") && !strings.Contains(out3, "Error") && !strings.Contains(out3, "Exception") {
			log("   ⚠️  Đã cài đè bản cũ hơn (-d), dữ liệu app được giữ lại.")
			return true, ""
		}
	}
	return false, lastErr
}

var pkgNameRe = regexp.MustCompile(`package: name='([^']*)'`)
var appLabelRe = regexp.MustCompile(`(?m)^application-label:'([^']*)'`)

// inspectApk đọc package name + tên app hiển thị (application-label) của 1 file .apk qua aapt.
func (m *Manager) inspectApk(apkPath string) (pkg, label string) {
	if m.AaptPath == "" {
		return "", ""
	}
	out, err := exec.Command(m.AaptPath, "dump", "badging", apkPath).CombinedOutput()
	if err != nil {
		return "", ""
	}
	text := string(out)
	if mm := pkgNameRe.FindStringSubmatch(text); mm != nil {
		pkg = mm[1]
	}
	if mm := appLabelRe.FindStringSubmatch(text); mm != nil {
		label = mm[1]
	}
	m.rememberLabel(pkg, label)
	return pkg, label
}

func (m *Manager) getPackageName(apkPath string) string {
	pkg, _ := m.inspectApk(apkPath)
	return pkg
}

func (m *Manager) rememberLabel(pkg, label string) {
	if pkg == "" || label == "" {
		return
	}
	m.labelMu.Lock()
	defer m.labelMu.Unlock()
	m.labelCache[pkg] = label
}

func (m *Manager) lookupLabel(pkg string) string {
	m.labelMu.RLock()
	defer m.labelMu.RUnlock()
	return m.labelCache[pkg]
}

func (m *Manager) uninstallPkgRaw(pkg string) (bool, string) {
	out, _ := m.runTimeout(60, "-s", m.Device, "uninstall", pkg)
	out = strings.ReplaceAll(out, "\r", "")
	if strings.Contains(out, "Success") {
		return true, out
	}
	out2, _ := m.runTimeout(60, "-s", m.Device, "shell", "pm", "uninstall", "--user", "0", pkg)
	out2 = strings.ReplaceAll(out2, "\r", "")
	if strings.Contains(out2, "Success") {
		return true, out2
	}
	return false, out2
}

// UninstallPkg gỡ 1 package, dùng cho tab "Gỡ cài đặt" và nút gỡ theo từng file.
func (m *Manager) UninstallPkg(pkg string, log func(string)) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if err := m.EnsureDevice(); err != nil {
		log("❌ " + err.Error())
		return err
	}
	log("🗑️  Đang gỡ " + pkg + " ...")
	ok, out := m.uninstallPkgRaw(pkg)
	if ok {
		log("✅ Gỡ thành công!")
		return nil
	}
	log("❌ Gỡ thất bại.")
	log(strings.TrimSpace(out))
	upper := strings.ToUpper(out)
	if strings.Contains(upper, "DELETE_FAILED_INTERNAL_ERROR") || strings.Contains(strings.ToLower(out), "not installed") {
		log("   💡 Package chưa được cài, hoặc là app hệ thống.")
	}
	return fmt.Errorf("uninstall failed")
}

// retryAfterUninstall: nếu lỗi là xung đột & AutoUninstall bật thì tự gỡ rồi cài lại.
// Trả về (đã xử lý thành công, đã thử retry hay chưa).
func (m *Manager) retryAfterUninstall(pkgHint, lastErr, cmdName string, args []string, log func(string)) bool {
	if !isConflictError(lastErr) {
		return false
	}
	if !m.Cfg.AutoUninstall {
		log("   💡 Xung đột cài đặt. Bật \"Tự gỡ bản cũ khi xung đột\" trong Cài đặt, hoặc vào tab Gỡ cài đặt để gỡ thủ công rồi cài lại.")
		return false
	}

	pkg := pkgHint
	if pkg == "" {
		pkg = pkgFromError(lastErr)
	}
	if pkg == "" {
		log("   ❌ Không xác định được package name để gỡ (thiếu aapt hoặc lỗi không rõ package).")
		return false
	}

	log(fmt.Sprintf("   🗑️  Gỡ bản cũ %s ...", pkg))
	ok, out := m.uninstallPkgRaw(pkg)
	if !ok {
		log("   ❌ Gỡ thất bại: " + strings.TrimSpace(out))
		return false
	}
	log("   ✅ Đã gỡ. Đang cài lại ...")

	ok2, lastErr2 := m.runInstall(cmdName, args, log)
	if ok2 {
		log("   ✅ Cài lại thành công.")
		return true
	}
	log("   ❌ Cài lại thất bại.")
	if hint := explainError(lastErr2, m.ABI); hint != "" {
		log("   💡 " + hint)
	}
	log("   ↳ " + lastErr2)
	return false
}

// InstallAPK cài 1 file .apk thường.
func (m *Manager) InstallAPK(path string, log func(string)) (string, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if err := m.EnsureDevice(); err != nil {
		log("❌ " + err.Error())
		return "", err
	}

	name := filepath.Base(path)
	log("📦 " + name + " ...")
	ok, lastErr := m.runInstall("install", []string{path}, log)
	pkg := m.getPackageName(path)
	if ok {
		log("✅ Cài đặt thành công: " + name)
		return pkg, nil
	}

	log("❌ Cài đặt thất bại: " + name)
	if hint := explainError(lastErr, m.ABI); hint != "" {
		log("   💡 " + hint)
	}
	log("   ↳ " + lastErr)

	if m.retryAfterUninstall(pkg, lastErr, "install", []string{path}, log) {
		return pkg, nil
	}
	return "", errors.New("install failed")
}

func splitToken(apkPath string) string {
	name := strings.TrimSuffix(filepath.Base(apkPath), filepath.Ext(apkPath))
	idx := strings.LastIndex(name, "config.")
	if idx == -1 {
		return ""
	}
	return name[idx+len("config."):]
}

func isAbiToken(tok string) bool {
	return knownABIs[tok]
}

var obbNameRe = regexp.MustCompile(`(?i)^(main|patch)\.[0-9]+\.(.+)\.obb$`)
var manifestPkgRe = regexp.MustCompile(`"package_name"\s*:\s*"([^"]+)"`)

// extractZipSafe giải nén các file .apk/.obb/manifest.json trong archive vào destDir,
// chống zip-slip bằng cách xác nhận đường dẫn đích luôn nằm trong destDir.
func extractZipSafe(zipPath, destDir string) (apks []string, obbs []string, manifest string, err error) {
	r, err := zip.OpenReader(zipPath)
	if err != nil {
		return nil, nil, "", err
	}
	defer r.Close()

	cleanDest := filepath.Clean(destDir)
	for _, f := range r.File {
		lower := strings.ToLower(f.Name)
		isApk := strings.HasSuffix(lower, ".apk")
		isObb := strings.HasSuffix(lower, ".obb")
		isManifest := strings.EqualFold(filepath.Base(f.Name), "manifest.json")
		if !isApk && !isObb && !isManifest {
			continue
		}

		target := filepath.Join(destDir, filepath.Clean("/"+f.Name))
		if !strings.HasPrefix(target, cleanDest+string(os.PathSeparator)) && target != cleanDest {
			continue // zip-slip guard
		}

		if err := os.MkdirAll(filepath.Dir(target), 0o755); err != nil {
			continue
		}
		rc, err := f.Open()
		if err != nil {
			continue
		}
		out, err := os.Create(target)
		if err != nil {
			rc.Close()
			continue
		}
		_, copyErr := io.Copy(out, rc)
		rc.Close()
		out.Close()
		if copyErr != nil {
			continue
		}

		switch {
		case isApk:
			apks = append(apks, target)
		case isObb:
			obbs = append(obbs, target)
		case isManifest:
			data, _ := os.ReadFile(target)
			manifest = string(data)
		}
	}
	sort.Strings(apks)
	return apks, obbs, manifest, nil
}

// InstallXAPK cài file .xapk/.apks/.apkm (split APKs + OBB), tương đương install_xapk() trong bash.
func (m *Manager) InstallXAPK(path string, log func(string)) (string, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if err := m.EnsureDevice(); err != nil {
		log("❌ " + err.Error())
		return "", err
	}

	name := filepath.Base(path)
	log("📦 XAPK: " + name)

	tempDir, err := os.MkdirTemp("", "apkmanager-xapk-*")
	if err != nil {
		return "", err
	}
	defer os.RemoveAll(tempDir)

	log("   📂 Đang giải nén ...")
	allApks, obbFiles, manifest, err := extractZipSafe(path, tempDir)
	if err != nil {
		log("   ❌ Giải nén thất bại: " + err.Error())
		return "", err
	}
	if len(allApks) == 0 {
		log("   ❌ Không tìm thấy file APK nào trong gói.")
		return "", errors.New("no apk in package")
	}
	log("   ✅ Đã giải nén")

	abilist := m.ABI
	if abilist == "" {
		abilist = "arm64-v8a,armeabi-v7a"
		log("   ⚠️  Không đọc được ABI của xe, mặc định: " + abilist)
	}

	availableABIs := map[string]bool{}
	for _, f := range allApks {
		tok := splitToken(f)
		if tok != "" && isAbiToken(tok) {
			availableABIs[tok] = true
		}
	}

	chosenABI := ""
	if len(availableABIs) > 0 {
		for _, abi := range strings.Split(abilist, ",") {
			tok := strings.ReplaceAll(strings.TrimSpace(abi), "-", "_")
			if availableABIs[tok] {
				chosenABI = tok
				break
			}
		}
		if chosenABI == "" {
			var have []string
			for a := range availableABIs {
				have = append(have, a)
			}
			log(fmt.Sprintf("   ❌ Gói không có ABI nào khớp với xe (%s). ABI có trong gói: %s", abilist, strings.Join(have, ", ")))
			return "", errors.New("no matching abi")
		}
	}

	var baseApks, splitApks []string
	skipped := 0
	for _, f := range allApks {
		tok := splitToken(f)
		switch {
		case tok == "":
			baseApks = append(baseApks, f)
		case isAbiToken(tok):
			if tok == chosenABI {
				splitApks = append(splitApks, f)
			} else {
				skipped++
			}
		default:
			splitApks = append(splitApks, f)
		}
	}

	if len(baseApks) == 0 {
		log("   ❌ Không tìm thấy base APK trong gói.")
		return "", errors.New("no base apk")
	}

	if chosenABI != "" {
		log(fmt.Sprintf("   🎯 ABI chọn: %s (bỏ qua %d ABI splits không khớp)", chosenABI, skipped))
	}

	installList := append(append([]string{}, baseApks...), splitApks...)

	pkg := ""
	if manifest != "" {
		if mm := manifestPkgRe.FindStringSubmatch(manifest); mm != nil {
			pkg = mm[1]
		}
	}
	if pkg == "" {
		pkg = m.getPackageName(baseApks[0])
	}

	log(fmt.Sprintf("   🚀 Đang cài đặt (%d APKs) ...", len(installList)))
	ok, lastErr := m.runInstall("install-multiple", installList, log)
	if !ok {
		log("   ❌ Cài đặt thất bại.")
		if hint := explainError(lastErr, m.ABI); hint != "" {
			log("   💡 " + hint)
		}
		log("   ↳ " + lastErr)
		if !m.retryAfterUninstall(pkg, lastErr, "install-multiple", installList, log) {
			return "", errors.New("install-multiple failed")
		}
	} else {
		log("   ✅ Cài đặt thành công.")
	}

	for _, obb := range obbFiles {
		base := filepath.Base(obb)
		obbPkg := pkg
		if obbPkg == "" {
			if mm := obbNameRe.FindStringSubmatch(base); mm != nil {
				obbPkg = mm[2]
			}
		}
		if obbPkg == "" {
			log("   ⚠️  Bỏ qua OBB " + base + " (không xác định được package).")
			continue
		}
		log(fmt.Sprintf("   📁 OBB %s -> %s ...", base, obbPkg))
		remoteDir := "/sdcard/Android/obb/" + obbPkg
		_, _ = m.runTimeout(30, "-s", m.Device, "shell", "mkdir", "-p", remoteDir)
		out, err := m.runTimeout(120, "-s", m.Device, "push", obb, remoteDir+"/"+base)
		if err != nil {
			log("   ❌ Push OBB thất bại: " + strings.TrimSpace(out))
			return "", err
		}
		log("   ✅ OBB đã đẩy lên thiết bị.")
	}

	return pkg, nil
}

// InstallPath quyết định gọi InstallAPK hay InstallXAPK dựa theo phần mở rộng,
// trả về package name của app vừa cài (dùng để mở app lên sau khi cài xong).
func (m *Manager) InstallPath(path string, log func(string)) (string, error) {
	ext := strings.ToLower(strings.TrimPrefix(filepath.Ext(path), "."))
	switch ext {
	case "apk":
		return m.InstallAPK(path, log)
	case "xapk", "apks", "apkm":
		return m.InstallXAPK(path, log)
	default:
		err := fmt.Errorf("không hỗ trợ định dạng: %s", path)
		log("❌ " + err.Error())
		return "", err
	}
}

// LaunchApp mở app lên trên thiết bị qua "monkey -p <pkg> ... 1" — cách chuẩn để
// mở app theo package name mà không cần biết tên activity khởi động.
func (m *Manager) LaunchApp(pkg string, log func(string)) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if pkg == "" {
		return errors.New("không xác định được package để mở")
	}
	if err := m.EnsureDevice(); err != nil {
		log("❌ " + err.Error())
		return err
	}
	log("🚀 Đang mở app " + pkg + " ...")
	out, err := m.runTimeout(15, "-s", m.Device, "shell", "monkey", "-p", pkg, "-c", "android.intent.category.LAUNCHER", "1")
	out = strings.TrimSpace(out)
	if err != nil || strings.Contains(out, "No activities found") || strings.Contains(out, "Error") {
		log("   ⚠️  Không tự mở được app (có thể app không có màn hình chính): " + out)
		return errors.New("launch failed")
	}
	log("   ✅ Đã mở app.")
	return nil
}

// ListPackages liệt kê package đã cài trên thiết bị.
// InstalledPackage là 1 package đã cài trên thiết bị, kèm tên hiển thị nếu đã
// từng học được (qua quét folder chứa APK của package đó) — pm list packages
// của Android không có sẵn tên hiển thị, chỉ có package id.
type InstalledPackage struct {
	Name    string `json:"name"`
	Label   string `json:"label"`
	Enabled bool   `json:"enabled"`
}

func parsePackageList(out string) []string {
	var pkgs []string
	for _, line := range strings.Split(strings.ReplaceAll(out, "\r", ""), "\n") {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		pkgs = append(pkgs, strings.TrimPrefix(line, "package:"))
	}
	return pkgs
}

func (m *Manager) ListPackages() ([]InstalledPackage, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if err := m.EnsureDevice(); err != nil {
		return nil, err
	}
	out, err := m.runTimeout(30, "-s", m.Device, "shell", "pm", "list", "packages")
	if err != nil {
		return nil, err
	}
	pkgs := parsePackageList(out)
	sort.Strings(pkgs)

	disabledOut, _ := m.runTimeout(30, "-s", m.Device, "shell", "pm", "list", "packages", "-d")
	disabled := map[string]bool{}
	for _, p := range parsePackageList(disabledOut) {
		disabled[p] = true
	}

	result := make([]InstalledPackage, 0, len(pkgs))
	for _, p := range pkgs {
		result = append(result, InstalledPackage{Name: p, Label: m.lookupLabel(p), Enabled: !disabled[p]})
	}
	return result, nil
}

// setPackageEnabled bật/tắt (disable-user) 1 app trên thiết bị — khác uninstall:
// KHÔNG xoá dữ liệu, có thể bật lại bất kỳ lúc nào, hữu ích cho app hệ thống
// không gỡ được.
func (m *Manager) setPackageEnabled(pkg string, enabled bool, log func(string)) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if err := m.EnsureDevice(); err != nil {
		log("❌ " + err.Error())
		return err
	}

	var out string
	var err error
	if enabled {
		log("👁️  Đang hiện lại " + pkg + " ...")
		out, err = m.runTimeout(20, "-s", m.Device, "shell", "pm", "enable", pkg)
	} else {
		log("🙈 Đang ẩn " + pkg + " (disable trên thiết bị) ...")
		out, err = m.runTimeout(20, "-s", m.Device, "shell", "pm", "disable-user", "--user", "0", pkg)
	}
	out = strings.TrimSpace(strings.ReplaceAll(out, "\r", ""))
	if err != nil || strings.Contains(strings.ToLower(out), "failure") || strings.Contains(strings.ToLower(out), "error") {
		log("   ❌ Thất bại: " + out)
		return fmt.Errorf("set enabled failed: %s", out)
	}
	log("   ✅ " + out)
	return nil
}

func (m *Manager) DisablePackage(pkg string, log func(string)) error {
	return m.setPackageEnabled(pkg, false, log)
}

func (m *Manager) EnablePackage(pkg string, log func(string)) error {
	return m.setPackageEnabled(pkg, true, log)
}

// RunShellCommand chạy 1 lệnh bất kỳ qua "adb shell" trên thiết bị đang kết nối
// (vd: am start -n com.geekit.wifi/.WifiLaunchActivity), in kết quả ra log.
func (m *Manager) RunShellCommand(cmd string, log func(string)) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if err := m.EnsureDevice(); err != nil {
		log("❌ " + err.Error())
		return err
	}
	cmd = strings.TrimSpace(cmd)
	if cmd == "" {
		log("❌ Chưa nhập lệnh.")
		return errors.New("empty command")
	}
	args := append([]string{"-s", m.Device, "shell"}, strings.Fields(cmd)...)
	log("$ adb shell " + cmd)
	out, err := m.runTimeout(30, args...)
	out = strings.TrimRight(out, "\r\n")
	if out != "" {
		log(out)
	}
	if err != nil {
		log("❌ Lệnh kết thúc với lỗi: " + err.Error())
		return err
	}
	log("✅ Đã chạy xong.")
	return nil
}

// EnableDevFreeform bật 4 tùy chỉnh hệ thống rồi khởi động lại thiết bị.
func (m *Manager) EnableDevFreeform(log func(string)) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if err := m.EnsureDevice(); err != nil {
		log("❌ " + err.Error())
		return err
	}

	log("🖥️  Đang bật 4 tùy chỉnh hệ thống ...")
	settings := []string{
		"development_settings_enabled",
		"enable_freeform_support",
		"force_resizable_activities",
		"enable_non_resizable_multi_window",
	}
	failed := false
	for _, s := range settings {
		_, err := m.runTimeout(15, "-s", m.Device, "shell", "settings", "put", "global", s, "1")
		actual, _ := m.runTimeout(15, "-s", m.Device, "shell", "settings", "get", "global", s)
		actual = strings.TrimSpace(strings.ReplaceAll(actual, "\r", ""))
		if err == nil && actual == "1" {
			log("   ⚙️  " + s + " ✅")
		} else {
			log(fmt.Sprintf("   ⚙️  %s ❌ (giá trị đọc lại: %s)", s, orPlaceholder(actual)))
			failed = true
		}
	}

	if failed {
		log("❌ Không bật được đầy đủ các tùy chỉnh; không khởi động lại thiết bị.")
		return errors.New("settings failed")
	}

	log("🔄 Đang khởi động lại thiết bị để áp dụng ...")
	if _, err := m.runTimeout(15, "-s", m.Device, "reboot"); err != nil {
		log("❌ Không thể khởi động lại thiết bị.")
		return err
	}
	log("✅ Đã bật 4 tùy chỉnh. Hãy kết nối lại sau khi thiết bị khởi động xong.")
	m.Device = ""
	m.ABI = ""
	m.SDK = ""
	return nil
}

func orPlaceholder(s string) string {
	if s == "" {
		return "?"
	}
	return s
}

// ---- quét folder ----

type FileEntry struct {
	Name      string `json:"name"`
	Path      string `json:"path"`
	Ext       string `json:"ext"`
	SizeKB    int64  `json:"sizeKB"`
	Package   string `json:"package"`
	Label     string `json:"label"`
	Installed bool   `json:"installed"`
}

// ScanResult là kết quả quét folder, kèm cờ cho biết có kiểm tra được app nào
// đang cài trên thiết bị hay không (cần thiết bị đang kết nối).
type ScanResult struct {
	Files         []FileEntry `json:"files"`
	DeviceChecked bool        `json:"deviceChecked"`
}

var installableExts = map[string]bool{".apk": true, ".xapk": true, ".apks": true, ".apkm": true}

// ScanFolder liệt kê toàn bộ apk/xapk/apks/apkm trong 1 folder, cố gắng đọc
// package name (dùng cho nút "Gỡ cài đặt" trực tiếp trên từng dòng) và đối
// chiếu với danh sách package đã cài trên thiết bị — chỉ app ĐÃ CÀI mới được
// phép gỡ, không phải cứ đọc được package name từ file là có nút gỡ.
func (m *Manager) ScanFolder(dir string) (ScanResult, error) {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return ScanResult{}, err
	}

	installedSet := map[string]bool{}
	deviceChecked := false
	if installed, err := m.ListPackages(); err == nil {
		deviceChecked = true
		for _, p := range installed {
			installedSet[p.Name] = true
		}
	}

	var result []FileEntry
	for _, e := range entries {
		if e.IsDir() {
			continue
		}
		ext := strings.ToLower(filepath.Ext(e.Name()))
		if !installableExts[ext] {
			continue
		}
		info, err := e.Info()
		if err != nil {
			continue
		}
		full := filepath.Join(dir, e.Name())
		fe := FileEntry{
			Name:   e.Name(),
			Path:   full,
			Ext:    ext,
			SizeKB: info.Size() / 1024,
		}
		if ext == ".apk" {
			fe.Package, fe.Label = m.inspectApk(full)
		} else {
			fe.Package, fe.Label = m.resolvePackageFromArchive(full)
		}
		fe.Installed = fe.Package != "" && installedSet[fe.Package]
		result = append(result, fe)
	}
	sort.Slice(result, func(i, j int) bool { return result[i].Name < result[j].Name })
	return ScanResult{Files: result, DeviceChecked: deviceChecked}, nil
}

var manifestNameRe = regexp.MustCompile(`"name"\s*:\s*"([^"]+)"`)

// resolvePackageFromArchive đọc package_name + tên app từ manifest.json trong
// xapk/apks/apkm, nếu thiếu thì thử extract base apk ra file tạm rồi chạy aapt.
func (m *Manager) resolvePackageFromArchive(path string) (pkg string, label string) {
	r, err := zip.OpenReader(path)
	if err != nil {
		return "", ""
	}
	defer r.Close()

	for _, f := range r.File {
		if strings.EqualFold(filepath.Base(f.Name), "manifest.json") {
			rc, err := f.Open()
			if err != nil {
				continue
			}
			data, _ := io.ReadAll(io.LimitReader(rc, 1<<20))
			rc.Close()
			if mm := manifestPkgRe.FindSubmatch(data); mm != nil {
				pkg = string(mm[1])
			}
			if mm := manifestNameRe.FindSubmatch(data); mm != nil {
				label = string(mm[1])
			}
			break
		}
	}
	m.rememberLabel(pkg, label)
	if pkg != "" && label != "" {
		return pkg, label
	}

	if m.AaptPath == "" {
		return pkg, label
	}
	for _, f := range r.File {
		if !strings.HasSuffix(strings.ToLower(f.Name), ".apk") {
			continue
		}
		base := filepath.Base(f.Name)
		nameNoExt := strings.TrimSuffix(base, filepath.Ext(base))
		if strings.Contains(nameNoExt, "config.") {
			continue // bỏ qua split, chỉ cần base apk
		}
		rc, err := f.Open()
		if err != nil {
			continue
		}
		tmp, err := os.CreateTemp("", "apkmanager-basecheck-*.apk")
		if err != nil {
			rc.Close()
			continue
		}
		_, copyErr := io.Copy(tmp, rc)
		rc.Close()
		tmp.Close()
		if copyErr == nil {
			p2, l2 := m.inspectApk(tmp.Name())
			os.Remove(tmp.Name())
			if pkg == "" {
				pkg = p2
			}
			if label == "" {
				label = l2
			}
		} else {
			os.Remove(tmp.Name())
		}
		break
	}
	return pkg, label
}
