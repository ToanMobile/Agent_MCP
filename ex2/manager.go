package main

import (
	"archive/zip"
	"bufio"
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
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

// NewManager giải nén adb kèm sẵn trong app ra đĩa và dùng luôn — người dùng
// không cần cài hay trỏ đường dẫn adb thủ công nữa.
func NewManager(cfg *Config) *Manager {
	m := &Manager{Cfg: cfg, labelCache: map[string]string{}}
	if adbPath, err := extractBundledAdb(); err == nil {
		m.AdbPath = adbPath
	}
	m.AaptPath = DetectAapt()
	return m
}

// ---- helpers gọi adb ----

// ErrTimeout: lệnh adb bị huỷ vì chạy quá lâu. Tách riêng để báo cho người
// dùng biết rõ "quá thời gian chờ" thay vì báo lỗi rỗng khó hiểu — khi tiến
// trình bị giết giữa chừng, adb thường chưa kịp in gì nên output rỗng.
var ErrTimeout = errors.New("quá thời gian chờ")

func (m *Manager) run(ctx context.Context, args ...string) (string, error) {
	if m.AdbPath == "" {
		return "", errors.New("chưa cấu hình đường dẫn adb")
	}
	cmd := exec.CommandContext(ctx, m.AdbPath, args...)
	out, err := cmd.CombinedOutput()
	if ctx.Err() == context.DeadlineExceeded {
		return string(out), ErrTimeout
	}
	return string(out), err
}

func (m *Manager) runTimeout(secs int, args ...string) (string, error) {
	ctx, cancel := context.WithTimeout(context.Background(), time.Duration(secs)*time.Second)
	defer cancel()
	return m.run(ctx, args...)
}

// splitLinesAndCR tách theo cả \n lẫn \r — adb in tiến trình % bằng cách ghi
// đè dòng qua \r (như 1 progress bar trên terminal), ScanLines mặc định của
// bufio chỉ tách theo \n nên sẽ bỏ lỡ các mốc % cập nhật qua \r.
func splitLinesAndCR(data []byte, atEOF bool) (advance int, token []byte, err error) {
	if atEOF && len(data) == 0 {
		return 0, nil, nil
	}
	if i := bytes.IndexAny(data, "\r\n"); i >= 0 {
		return i + 1, data[0:i], nil
	}
	if atEOF {
		return len(data), data, nil
	}
	return 0, nil, nil
}

var installProgressRe = regexp.MustCompile(`\[\s*(\d+)%\]`)

// runWithProgress chạy 1 lệnh adb, đọc output real-time để bắt tiến trình %
// (nếu adb có in ra) hoặc phát nhịp theo giây nếu không có %, đồng thời trả về
// toàn bộ output y như runTimeout() để logic thành/bại phía trên dùng tiếp.
func (m *Manager) runWithProgress(secs int, label string, log func(string), args ...string) (string, error) {
	ctx, cancel := context.WithTimeout(context.Background(), time.Duration(secs)*time.Second)
	defer cancel()

	cmd := exec.CommandContext(ctx, m.AdbPath, args...)
	pr, pw := io.Pipe()
	cmd.Stdout = pw
	cmd.Stderr = pw

	if err := cmd.Start(); err != nil {
		pw.Close()
		return "", err
	}

	var buf bytes.Buffer
	var mu sync.Mutex
	sawPct := false
	start := time.Now()

	scanDone := make(chan struct{})
	go func() {
		defer close(scanDone)
		scanner := bufio.NewScanner(pr)
		scanner.Buffer(make([]byte, 0, 64*1024), 1024*1024)
		scanner.Split(splitLinesAndCR)
		lastPct := -1
		for scanner.Scan() {
			line := scanner.Text()
			mu.Lock()
			buf.WriteString(line)
			buf.WriteByte('\n')
			mu.Unlock()
			if mm := installProgressRe.FindStringSubmatch(line); mm != nil {
				if pct, perr := strconv.Atoi(mm[1]); perr == nil && pct != lastPct {
					lastPct = pct
					mu.Lock()
					sawPct = true
					mu.Unlock()
					log(fmt.Sprintf("PROGRESS_PCT:%d|%s|", pct, label))
				}
			}
		}
		if serr := scanner.Err(); serr != nil {
			mu.Lock()
			buf.WriteString("[cảnh báo: đọc output bị cắt ngang: " + serr.Error() + "]\n")
			mu.Unlock()
		}
	}()

	tickStop := make(chan struct{})
	go func() {
		ticker := time.NewTicker(2 * time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-ticker.C:
				mu.Lock()
				got := sawPct
				mu.Unlock()
				if !got {
					log(fmt.Sprintf("PROGRESS_TICK:%s|%ds trôi qua", label, int(time.Since(start).Seconds())))
				}
			case <-tickStop:
				return
			}
		}
	}()

	waitErr := cmd.Wait()
	pw.Close()
	<-scanDone
	close(tickStop)

	mu.Lock()
	result := buf.String()
	mu.Unlock()
	if ctx.Err() == context.DeadlineExceeded {
		return result, ErrTimeout
	}
	return result, waitErr
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
		return "Đã có app này sẵn trong thiết bị (chữ ký khác — thường do bản cài sẵn từ nhà sản xuất hoặc bản mod). Cần gỡ bản cũ ra trước khi cài bản mới, không cài đè trực tiếp được."
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

// StatusSnapshot đọc toàn bộ trạng thái hiển thị DƯỚI KHOÁ. Bắt buộc phải qua
// đây thay vì đọc thẳng m.Device/m.ABI/... từ HTTP handler: các trường này bị
// ghi bởi những request khác (kết nối/chọn thiết bị) chạy song song, đọc không
// khoá là lỗi tranh chấp dữ liệu thật — Go có thể trả về chuỗi rách (con trỏ
// của giá trị này ghép với độ dài của giá trị kia) gây đọc lung tung bộ nhớ.
func (m *Manager) StatusSnapshot() map[string]any {
	m.mu.Lock()
	defer m.mu.Unlock()
	return map[string]any{
		"device":           m.Device,
		"abi":              m.ABI,
		"sdk":              m.SDK,
		"wifiSSID":         m.WifiSSID,
		"connected":        m.Device != "",
		"adbPath":          m.AdbPath,
		"aaptPath":         m.AaptPath,
		"adbFound":         m.AdbPath != "" && fileExecutable(m.AdbPath),
		"ip":               m.Cfg.IP,
		"port":             m.Cfg.Port,
		"lastFolder":       m.Cfg.LastFolder,
		"quickInstalls":    m.Cfg.QuickInstalls,
		"favoritePackages": m.Cfg.FavoritePackages,
	}
}

// FirstQuickInstallURL trả về URL của mục "Cài nhanh" đầu tiên, đọc dưới khoá.
// Danh sách này bị sửa bởi request khác (thêm/xoá mục, học package sau khi cài
// xong) nên đọc thẳng m.Cfg.QuickInstalls từ handler là tranh chấp dữ liệu.
func (m *Manager) FirstQuickInstallURL() string {
	m.mu.Lock()
	defer m.mu.Unlock()
	if len(m.Cfg.QuickInstalls) == 0 {
		return ""
	}
	return m.Cfg.QuickInstalls[0].URL
}

// UpdateConfig sửa cấu hình dưới khoá rồi lưu xuống đĩa — dùng cho mọi thay
// đổi cấu hình đến từ HTTP handler, vì cùng lúc đó StatusSnapshot có thể đang
// đọc chính những trường này.
func (m *Manager) UpdateConfig(mutate func(*Config)) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	mutate(m.Cfg)
	return m.Cfg.Save()
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

// installTimeoutSecs: lưới an toàn cuối cùng cho các luồng KHÔNG đo được tiến
// độ (cài XAPK/split-APK bằng install-multiple, đẩy file OBB). Luồng cài APK
// đơn không dùng mốc này — nó đã có cơ chế theo dõi "file bên xe còn lớn lên
// không" chính xác hơn nhiều (xem pushFileWithProgress).
//
// Đặt rất rộng là có chủ ý: cắt sớm chính là lỗi đã từng khiến file vài trăm
// MB không cài được qua Wi-Fi yếu — mạng chậm mà vẫn đang chạy thì không phải
// là hỏng. Mốc này chỉ để tránh treo vĩnh viễn khi mất kết nối hẳn.
const installTimeoutSecs = 7200 // 2 tiếng

func timeoutMessage() string {
	return fmt.Sprintf("Quá thời gian chờ (%d tiếng) — nhiều khả năng mất kết nối Wi-Fi tới xe giữa chừng. "+
		"Kiểm tra xe còn trong vùng phủ sóng rồi thử lại.", installTimeoutSecs/3600)
}

// runInstall tương đương run_install() trong bash: thử -r -g, rồi -r, rồi -r -d
// (hạ cấp) khi gặp VERSION_DOWNGRADE.
func (m *Manager) runInstall(cmdName string, args []string, log func(string)) (bool, string) {
	full := append([]string{"-s", m.Device, cmdName, "-r", "-g"}, args...)
	out, err := m.runWithProgress(installTimeoutSecs, "install", log, full...)
	if err == nil && !strings.Contains(out, "Failure") && !strings.Contains(out, "Error") && !strings.Contains(out, "Exception") {
		return true, ""
	}
	if errors.Is(err, ErrTimeout) {
		return false, timeoutMessage()
	}

	full2 := append([]string{"-s", m.Device, cmdName, "-r"}, args...)
	out2, err2 := m.runWithProgress(installTimeoutSecs, "install", log, full2...)
	if err2 == nil && !strings.Contains(out2, "Failure") && !strings.Contains(out2, "Error") && !strings.Contains(out2, "Exception") {
		log("   ⚠️  Đã cài được nhưng phải bỏ -g (không cấp sẵn quyền).")
		return true, ""
	}
	if errors.Is(err2, ErrTimeout) {
		return false, timeoutMessage()
	}

	lastErr := extractError(out2)
	if lastErr == "" {
		lastErr = extractError(out)
	}

	if strings.Contains(strings.ToUpper(lastErr), "VERSION_DOWNGRADE") {
		full3 := append([]string{"-s", m.Device, cmdName, "-r", "-d"}, args...)
		out3, err3 := m.runWithProgress(installTimeoutSecs, "install", log, full3...)
		if err3 == nil && !strings.Contains(out3, "Failure") && !strings.Contains(out3, "Error") && !strings.Contains(out3, "Exception") {
			log("   ⚠️  Đã cài đè bản cũ hơn (-d), dữ liệu app được giữ lại.")
			return true, ""
		}
	}
	if lastErr == "" {
		// adb bị giết/thoát bất thường mà chưa in gì — đừng để trống, người dùng
		// nhìn dòng lỗi rỗng sẽ không biết chuyện gì đã xảy ra.
		lastErr = "adb kết thúc bất thường, không có thông báo lỗi cụ thể (nhiều khả năng mất kết nối Wi-Fi tới xe giữa chừng)"
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

// reportConflict phát hiện lỗi có phải do xung đột chữ ký/phiên bản không —
// nếu đúng, log gợi ý + gửi tín hiệu CONFLICT_PKG để frontend hiện popup hỏi
// người dùng có muốn gỡ bản cũ rồi cài lại hay không. Không tự gỡ ngầm; việc
// gỡ + cài lại luôn cần xác nhận, thực hiện ở request kế tiếp từ frontend.
func (m *Manager) reportConflict(pkgHint, lastErr string, log func(string)) {
	if !isConflictError(lastErr) {
		return
	}
	pkg := pkgHint
	if pkg == "" {
		pkg = pkgFromError(lastErr)
	}
	if pkg == "" {
		log("   💡 Có vẻ đã cài sẵn app này với chữ ký khác, nhưng không xác định được package name để gỡ tự động — vào tab Danh sách package tự tìm & gỡ.")
		return
	}
	log("CONFLICT_PKG:" + pkg)
}

// InstallAPK cài 1 file .apk thường: đẩy file lên thiết bị bằng "adb push"
// rồi chạy "pm install" ngay trên máy đó, thay vì gọi thẳng "adb install".
// Tách 2 bước như vậy để phần truyền file (chậm nhất, hay lỗi nhất khi qua
// Wi-Fi) có nhịp báo tiến trình riêng và thông báo lỗi rõ ràng hơn.
func (m *Manager) InstallAPK(path string, log func(string)) (string, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if err := m.EnsureDevice(); err != nil {
		log("❌ " + err.Error())
		return "", err
	}

	name := filepath.Base(path)
	log("📦 " + name + " ...")

	remotePath := "/data/local/tmp/" + sanitizeRemoteName(name)
	// Đăng ký dọn dẹp TRƯỚC khi đẩy: nếu đẩy dở dang rồi thất bại (rớt Wi-Fi,
	// treo giữa chừng), phần file đã ghi vẫn phải được xoá. Đặt sau lệnh đẩy thì
	// mọi lần thất bại đều bỏ lại file rác vài trăm MB trong bộ nhớ xe, tích tụ
	// dần sẽ gây lỗi hết dung lượng ở những lần cài sau. Xoá 1 file không tồn
	// tại là vô hại nên đăng ký sớm hoàn toàn an toàn.
	defer func() { _, _ = m.runTimeout(15, "-s", m.Device, "shell", "rm", "-f", remotePath) }()
	if err := m.pushFileWithProgress(path, remotePath, log); err != nil {
		log("❌ Đẩy file lên thiết bị thất bại: " + err.Error())
		return "", err
	}

	pkg := m.getPackageName(path)
	// Không có aapt thì chưa biết package trước khi cài — chụp lại danh sách
	// package hiện có để sau khi cài xong, so sánh tìm ra package mới xuất hiện.
	var beforeSet map[string]bool
	if pkg == "" {
		beforeSet = m.rawPackageSet()
	}
	ok, lastErr := m.runInstallOnDevice(remotePath, log)
	if ok {
		if pkg == "" && beforeSet != nil {
			pkg = diffSingleNewPackage(beforeSet, m.rawPackageSet())
		}
		log("✅ Cài đặt thành công: " + name)
		return pkg, nil
	}

	log("❌ Cài đặt thất bại: " + name)
	if hint := explainError(lastErr, m.ABI); hint != "" {
		log("   💡 " + hint)
	}
	log("   ↳ " + lastErr)
	m.reportConflict(pkg, lastErr, log)
	return "", errors.New("install failed")
}

// runInstallOnDevice chạy "pm install" trên chính thiết bị nhắm vào file đã
// đẩy sẵn (remotePath) — tương đương runInstall() nhưng không cần truyền lại
// file qua adb lần nữa (đã có sẵn trên máy), thử -r -g, rồi -r, rồi -r -d.
// pmInstallTimeoutSecs: "pm install" chạy trên chính máy xe với file đã có sẵn
// (không truyền qua mạng nữa), nhưng máy xe cấu hình yếu nên app vài trăm MB
// vẫn có thể mất nhiều phút để giải nén + tối ưu. Để rộng tay cho chắc.
const pmInstallTimeoutSecs = 900 // 15 phút

// pushStallLimit: chỉ coi là treo khi kích thước file bên xe không nhích thêm
// byte nào suốt khoảng thời gian này. Mạng chậm mà vẫn tiến đều thì không bao
// giờ chạm ngưỡng, dù tổng thời gian có kéo dài bao lâu.
const pushStallLimit = 3 * time.Minute

// blindPushLimit: chỉ dùng khi KHÔNG đọc được kích thước file bên xe lần nào
// (máy không hỗ trợ lệnh stat) — lúc đó hoàn toàn không có tín hiệu để biết
// còn chạy hay đã treo, nên đành dựa vào tổng thời gian. Đặt rất rộng để mạng
// chậm vẫn kịp truyền xong file vài trăm MB.
const blindPushLimit = 2 * time.Hour

func (m *Manager) runInstallOnDevice(remotePath string, log func(string)) (bool, string) {
	out, err := m.runTimeout(pmInstallTimeoutSecs, "-s", m.Device, "shell", "pm", "install", "-r", "-g", remotePath)
	if err == nil && !strings.Contains(out, "Failure") && !strings.Contains(out, "Error") && !strings.Contains(out, "Exception") {
		return true, ""
	}
	if errors.Is(err, ErrTimeout) {
		return false, timeoutMessage()
	}

	out2, err2 := m.runTimeout(pmInstallTimeoutSecs, "-s", m.Device, "shell", "pm", "install", "-r", remotePath)
	if err2 == nil && !strings.Contains(out2, "Failure") && !strings.Contains(out2, "Error") && !strings.Contains(out2, "Exception") {
		log("   ⚠️  Đã cài được nhưng phải bỏ -g (không cấp sẵn quyền).")
		return true, ""
	}
	if errors.Is(err2, ErrTimeout) {
		return false, timeoutMessage()
	}

	lastErr := extractError(out2)
	if lastErr == "" {
		lastErr = extractError(out)
	}

	if strings.Contains(strings.ToUpper(lastErr), "VERSION_DOWNGRADE") {
		out3, err3 := m.runTimeout(pmInstallTimeoutSecs, "-s", m.Device, "shell", "pm", "install", "-r", "-d", remotePath)
		if err3 == nil && !strings.Contains(out3, "Failure") && !strings.Contains(out3, "Error") && !strings.Contains(out3, "Exception") {
			log("   ⚠️  Đã cài đè bản cũ hơn (-d), dữ liệu app được giữ lại.")
			return true, ""
		}
	}
	if lastErr == "" {
		lastErr = "pm install kết thúc bất thường, không có thông báo lỗi cụ thể (nhiều khả năng mất kết nối tới xe giữa chừng)"
	}
	return false, lastErr
}

var remoteNameSanitizeRe = regexp.MustCompile(`[^A-Za-z0-9._-]`)

// sanitizeRemoteName làm sạch tên file trước khi dùng làm đường dẫn trên thiết
// bị, tránh ký tự đặc biệt gây lỗi shell.
func sanitizeRemoteName(name string) string {
	cleaned := remoteNameSanitizeRe.ReplaceAllString(name, "_")
	if cleaned == "" {
		return "apkmanager_upload.apk"
	}
	return cleaned
}

// pushFileWithProgress đẩy 1 file local lên thiết bị bằng "adb push" — dùng
// đúng giao thức truyền file nhị phân chính thức của adb (sync protocol),
// đáng tin cậy hơn nhiều so với cách cũ (tự bơm byte qua "adb shell cat >
// path" dùng kênh shell tương tác) — đặc biệt quan trọng với file lớn
// (200-300+ MB) truyền qua Wi-Fi thật tới xe, nơi kênh shell không được thiết
// kế và không được kiểm chứng cho việc truyền khối lượng dữ liệu lớn, trong
// khi "adb push" là cơ chế mà chính Google dùng và kiểm thử cho đúng việc này.
// Chỉ dựa vào exit code để kết luận thành/bại: mọi kiểu lỗi của "adb push"
// (thiếu file nguồn, thư mục đích chỉ đọc, thiết bị rớt kết nối) đều trả exit
// khác 0. KHÔNG dò chữ "error"/"failed" trong output, vì dòng báo THÀNH CÔNG
// của adb có in kèm đường dẫn file nguồn — file tên kiểu "no_error_build.apk"
// hoặc nằm trong thư mục "error-fix/" sẽ bị kết luận nhầm là thất bại.
//
// Tiến độ + phát hiện treo: adb không in % khi output bị pipe, nên app tự hỏi
// kích thước file bên phía xe mỗi 2 giây. Vừa cho % thật, vừa cho biết việc
// truyền CÓ ĐANG NHÚC NHÍCH hay không.
//
// KHÔNG đặt trần theo tổng thời gian: chừng nào file bên xe còn lớn lên thì cứ
// để chạy tiếp, dù mất 20 phút hay 2 tiếng (mạng yếu vẫn là mạng đang chạy —
// cắt ngang lúc đó chính là lỗi đã từng khiến file lớn không cài được). Chỉ
// huỷ trong 2 trường hợp thật sự bất thường: (1) file đứng im quá lâu, (2)
// không đọc được kích thước lần nào suốt thời gian dài — tức không có bất kỳ
// tín hiệu nào để biết còn sống hay đã treo.
func (m *Manager) pushFileWithProgress(localPath, remotePath string, log func(string)) error {
	info, err := os.Stat(localPath)
	if err != nil {
		return err
	}
	total := info.Size()

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	// Context riêng cho các lệnh đọc kích thước, để lúc kết thúc có thể cắt
	// ngay lệnh stat đang chạy dở thay vì phải chờ nó hết giờ.
	statCtx, statCancel := context.WithCancel(context.Background())
	defer statCancel()

	cmd := exec.CommandContext(ctx, m.AdbPath, "-s", m.Device, "push", localPath, remotePath)
	var outBuf bytes.Buffer
	cmd.Stdout = &outBuf
	cmd.Stderr = &outBuf
	if err := cmd.Start(); err != nil {
		return err
	}

	var stalled atomic.Bool
	var blindTimeout atomic.Bool
	watchStop := make(chan struct{})
	watchDone := make(chan struct{})
	go func() {
		defer close(watchDone)
		ticker := time.NewTicker(2 * time.Second)
		defer ticker.Stop()

		start := time.Now()
		var lastSize int64 = -1
		lastPct := -1
		sawAnySize := false
		lastGrow := time.Now()

		for {
			select {
			case <-watchStop:
				return
			case <-ticker.C:
				size := m.remoteFileSizeCtx(statCtx, remotePath)
				if size < 0 {
					// Chưa đọc được kích thước (file chưa kịp tạo, hoặc máy xe
					// không hỗ trợ lệnh stat). Nếu suốt thời gian dài vẫn không có
					// tín hiệu nào thì mới coi là bất thường — lúc đó hoàn toàn mù,
					// không còn cách nào biết đang chạy hay đã treo.
					if !sawAnySize && time.Since(start) > blindPushLimit {
						blindTimeout.Store(true)
						cancel()
						return
					}
					continue
				}
				sawAnySize = true
				if size > lastSize {
					lastSize = size
					lastGrow = time.Now()
					if total > 0 {
						if pct := int(size * 100 / total); pct != lastPct {
							lastPct = pct
							log(fmt.Sprintf("PROGRESS_PCT:%d|install|%.1f/%.1f MB", pct,
								float64(size)/1024/1024, float64(total)/1024/1024))
						}
					}
					continue
				}
				if time.Since(lastGrow) > pushStallLimit {
					stalled.Store(true)
					cancel()
					return
				}
			}
		}
	}()

	waitErr := cmd.Wait()
	close(watchStop)
	statCancel() // cắt luôn lệnh stat đang chạy dở để goroutine thoát ngay
	<-watchDone

	if stalled.Load() {
		return fmt.Errorf("việc truyền file đứng im quá %d phút — nhiều khả năng mất kết nối Wi-Fi tới xe. "+
			"Kiểm tra xe còn trong vùng phủ sóng rồi thử lại", int(pushStallLimit.Minutes()))
	}
	if blindTimeout.Load() {
		return fmt.Errorf("quá %d phút mà không đọc được tiến độ nào từ xe — nhiều khả năng mất kết nối. "+
			"Kiểm tra lại kết nối rồi thử lại", int(blindPushLimit.Minutes()))
	}
	if waitErr != nil {
		msg := extractError(outBuf.String())
		if msg == "" {
			msg = strings.TrimSpace(outBuf.String())
		}
		if msg == "" {
			msg = waitErr.Error()
		}
		return errors.New(msg)
	}
	return nil
}

// remoteFileSizeCtx đọc kích thước hiện tại của 1 file trên thiết bị (byte).
// Trả -1 nếu chưa đọc được (file chưa tồn tại, máy không hỗ trợ stat, hoặc
// lệnh bị huỷ). Nhận context để nơi gọi cắt được lệnh đang chạy dở.
func (m *Manager) remoteFileSizeCtx(parent context.Context, remotePath string) int64 {
	ctx, cancel := context.WithTimeout(parent, 10*time.Second)
	defer cancel()
	out, err := m.run(ctx, "-s", m.Device, "shell", "stat", "-c", "%s", remotePath)
	if err != nil {
		return -1
	}
	size, convErr := strconv.ParseInt(strings.TrimSpace(strings.ReplaceAll(out, "\r", "")), 10, 64)
	if convErr != nil {
		return -1
	}
	return size
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
		m.reportConflict(pkg, lastErr, log)
		return "", errors.New("install-multiple failed")
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
		out, err := m.runWithProgress(installTimeoutSecs, "push_obb", log, "-s", m.Device, "push", obb, remoteDir+"/"+base)
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
		pkg, err := m.InstallAPK(path, log)
		if err == nil {
			m.afterInstall(pkg, log)
		}
		return pkg, err
	case "xapk", "apks", "apkm":
		pkg, err := m.InstallXAPK(path, log)
		if err == nil {
			m.afterInstall(pkg, log)
		}
		return pkg, err
	default:
		err := fmt.Errorf("không hỗ trợ định dạng: %s", path)
		log("❌ " + err.Error())
		return "", err
	}
}

const (
	pkgGoogleMaps = "com.google.android.apps.maps"
	pkgGoogleGMS  = "com.google.android.gms"
)

// actionIgnoreBatteryOpt là màn hình hệ thống "xin bỏ qua tối ưu pin". Điện
// thoại Android nào cũng có, nhưng ROM màn hình xe (Flyme Auto trên Geely EX2)
// bị cắt mất — app nào gọi tới nó mà không bắt lỗi là văng ngay khi mở.
const actionIgnoreBatteryOpt = "android.settings.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS"

// pkgsNeedingDozeWhitelist: các app đã được kiểm chứng là gọi thẳng màn hình
// trên trong onCreate và văng ngay trên màn hình xe.
//
// Cách chữa: đưa app vào danh sách "bỏ qua tối ưu pin" TRƯỚC. App kiểm tra thấy
// mình đã được bỏ qua rồi nên không mở màn hình kia nữa → không văng.
//
// Phải làm lại sau MỖI lần cài: Android xoá package khỏi danh sách này khi gỡ
// cài đặt, nên cài lại là bản vá biến mất và app văng trở lại.
var pkgsNeedingDozeWhitelist = map[string]bool{
	"vn.vietmap.live": true,
}

// deviceLacksBatteryOptScreenLocked kiểm tra thiết bị có thiếu màn hình "bỏ qua
// tối ưu pin" không. Phải gọi khi đang giữ m.mu.
//
// Có cổng kiểm tra này để trên thiết bị bình thường (điện thoại, máy tính bảng
// có đủ màn hình đó) app KHÔNG tự ý đổi thiết lập tối ưu pin của người dùng —
// ở đó không có gì để chữa cả.
func (m *Manager) deviceLacksBatteryOptScreenLocked() bool {
	out, err := m.runTimeout(20, "-s", m.Device, "shell", "cmd", "package",
		"query-activities", "-a", actionIgnoreBatteryOpt)
	if err != nil {
		return false // không hỏi được thì đừng đụng vào thiết lập của thiết bị
	}
	return strings.Contains(out, "No activities found")
}

// applyDozeWhitelistIfNeeded chạy ngay sau khi cài xong, tự áp lại bản vá cho
// những app đã biết là sẽ văng vì thiếu màn hình tối ưu pin.
func (m *Manager) applyDozeWhitelistIfNeeded(pkg string, log func(string)) {
	if !pkgsNeedingDozeWhitelist[pkg] {
		return
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	if !m.deviceLacksBatteryOptScreenLocked() {
		return
	}

	log("   🔧 Thiết bị thiếu màn hình \"bỏ qua tối ưu pin\" — app này sẽ văng khi mở nếu không xử lý.")
	if _, err := m.runTimeout(20, "-s", m.Device, "shell", "dumpsys", "deviceidle", "whitelist", "+"+pkg); err != nil {
		log("   ⚠️  Không áp được bản vá tự động: " + err.Error())
		return
	}

	// Đọc lại để chắc chắn đã vào danh sách — báo "đã xử lý" mà thực ra không
	// vào thì người dùng sẽ ngồi đoán vì sao app vẫn văng.
	out, err := m.runTimeout(20, "-s", m.Device, "shell", "dumpsys", "deviceidle", "whitelist")
	if err != nil || !strings.Contains(out, pkg) {
		log("   ⚠️  Đã chạy lệnh vá nhưng kiểm tra lại không thấy có tác dụng.")
		return
	}
	log("   ✅ Đã đưa " + pkg + " vào danh sách bỏ qua tối ưu pin — app sẽ mở được bình thường.")
	log("      (Cần làm lại sau mỗi lần cài lại; app tự làm nên không phải nhớ. Gỡ bỏ: dumpsys deviceidle whitelist -" + pkg + ")")
}

// deviceHasPackageLocked kiểm tra 1 package đã có trên thiết bị chưa. Phải gọi
// khi đang giữ m.mu (đọc m.Device).
//
// Dùng "pm list packages <pkg>" rồi so khớp CHÍNH XÁC từng dòng: đối số của
// pm chỉ là bộ lọc chuỗi con, nên hỏi "com.google.android.gms" cũng trả về
// "com.google.android.gms.location.history" — so khớp lỏng sẽ kết luận nhầm là
// đã có GMS.
func (m *Manager) deviceHasPackageLocked(pkg string) bool {
	out, err := m.runTimeout(20, "-s", m.Device, "shell", "pm", "list", "packages", pkg)
	if err != nil {
		return false
	}
	for _, line := range strings.Split(strings.ReplaceAll(out, "\r", ""), "\n") {
		if strings.TrimSpace(strings.TrimPrefix(strings.TrimSpace(line), "package:")) == pkg {
			return true
		}
	}
	return false
}

// afterInstall gom các việc phải làm ngay sau khi cài xong: vá lỗi đã biết
// trước, rồi mới cảnh báo những app không có đường cứu.
func (m *Manager) afterInstall(pkg string, log func(string)) {
	m.applyDozeWhitelistIfNeeded(pkg, log)
	m.warnAfterInstall(pkg, log)
}

// warnAfterInstall cảnh báo ngay sau khi cài xong những app đã được kiểm
// chứng là KHÔNG chạy nổi trên màn hình Geely EX2, để người dùng khỏi ngồi đoán
// vì sao bấm vào app chỉ thấy nó văng ra.
//
// Bằng chứng thu được trên xe thật (IHU629G, Android 9, tháng 8/2026): Google
// Maps cần Google Play Services; mà Play Services cài kiểu app thường thì
// tiến trình com.google.android.gms.persistent văng liên tục vì thiếu quyền
// WRITE_SECURE_SETTINGS — quyền chỉ cấp cho app nằm trong /system/priv-app,
// không cấp được bằng "pm grant". Vì vậy Maps không có đường chạy trên xe này.
func (m *Manager) warnAfterInstall(installedPkg string, log func(string)) {
	switch installedPkg {
	case pkgGoogleMaps:
		log("   ⚠️  Google Maps ĐÃ ĐƯỢC KIỂM CHỨNG là không chạy được trên màn hình Geely EX2:")
		log("      nó cần Google Play Services, mà Play Services trên xe này văng liên tục vì")
		log("      thiếu quyền hệ thống (WRITE_SECURE_SETTINGS) — không cấp được cho app cài thường.")
		log("      👉 Dùng VietMap Live thay thế, đã chạy tốt trên xe.")
	case pkgGoogleGMS:
		log("   ⚠️  Google Play Services cài kiểu app thường sẽ văng liên tục trên màn hình Geely EX2")
		log("      (thiếu quyền hệ thống WRITE_SECURE_SETTINGS). Nên ẩn hoặc gỡ để đỡ hao pin/CPU.")
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

// rawPackageSet lấy danh sách package hiện có dạng set — KHÔNG tự khoá mutex,
// chỉ gọi từ nơi đã giữ sẵn m.mu (vd trong InstallAPK) để tránh deadlock.
func (m *Manager) rawPackageSet() map[string]bool {
	out, err := m.runTimeout(20, "-s", m.Device, "shell", "pm", "list", "packages")
	if err != nil {
		return nil
	}
	set := map[string]bool{}
	for _, p := range parsePackageList(out) {
		set[p] = true
	}
	return set
}

// diffSingleNewPackage trả về package duy nhất xuất hiện thêm trong "after" so
// với "before" — dùng để suy ra package vừa cài khi không có aapt để đọc trực
// tiếp từ file. Nếu có 0 hoặc nhiều hơn 1 package mới (không rõ ràng) thì trả "".
func diffSingleNewPackage(before, after map[string]bool) string {
	found := ""
	count := 0
	for p := range after {
		if !before[p] {
			found = p
			count++
		}
	}
	if count == 1 {
		return found
	}
	return ""
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
