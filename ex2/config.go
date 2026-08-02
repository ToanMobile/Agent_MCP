package main

import (
	"encoding/json"
	"os"
	"path/filepath"
)

// Config lưu các thiết lập người dùng nhập trong UI, ghi vào thư mục dữ liệu
// riêng của app (xem appDataDir) để lần chạy sau tự nhớ IP. adb đã được nhúng
// sẵn trong app nên không cần lưu đường dẫn adb nữa.
type Config struct {
	IP         string `json:"ip"`
	Port       string `json:"port"`
	LastFolder string `json:"lastFolder"`

	QuickInstalls []QuickInstallItem `json:"quickInstalls"`

	FavoritePackages []string `json:"favoritePackages"`

	// DefaultsVersion là phiên bản của bộ link "Cài nhanh" mặc định mà file
	// config này đã đồng bộ tới. Xem defaultsVersion để biết vì sao cần.
	DefaultsVersion int `json:"defaultsVersion"`
}

// defaultsVersion tăng lên mỗi khi sửa link của các mục "Cài nhanh" dựng sẵn.
//
// Vì sao cần: config được lưu ra file, và LoadConfig đọc file đè lên giá trị
// mặc định. Nghĩa là ai đã chạy app một lần rồi thì sửa link trong mã nguồn
// KHÔNG có tác dụng gì với họ — họ giữ mãi link cũ đã chết. Link tải APK rất
// hay hỏng (hết hạn chữ ký, bị Cloudflare chặn, đổi host), nên phải có đường
// đẩy link mới xuống máy người dùng cũ.
const defaultsVersion = 4

// quickInstallGMSName là tên mục "Cài nhanh" chứa Google Play Services.
// Đã tạm ẩn khỏi tab "Cài nhanh" ở phiên bản 4 — xem quickInstallHiddenIn.
const quickInstallGMSName = "GMS (Google Play Services)"

// quickInstallIntroducedIn ghi mục dựng sẵn nào ra đời ở phiên bản defaults
// nào. Cần vì không thể phân biệt "mục mới thêm vào bản cập nhật" với "mục cũ
// người dùng đã cố ý xoá" chỉ bằng cách nhìn config đã lưu — cả hai đều là
// vắng mặt. Mục chỉ được thêm cho ai có DefaultsVersion cũ hơn số ghi ở đây.
var quickInstallIntroducedIn = map[string]int{
	quickInstallGMSName: 2,
}

// quickInstallHiddenIn ghi mục dựng sẵn nào bị TẠM ẨN kể từ phiên bản defaults
// nào.
//
// Vì sao ẩn: Google Maps và Google Play Services đã được kiểm chứng trên màn
// hình Geely EX2 thật (IHU629G, Android 9) là KHÔNG chạy được — Play Services
// đòi quyền WRITE_SECURE_SETTINGS, quyền này chỉ cấp cho app nằm trong
// /system/priv-app, nên cài kiểu thường thì văng liên tục và kéo Maps văng
// theo. Để trong danh sách chỉ khiến người dùng tải vài trăm MB rồi nhận một
// app không mở nổi.
//
// ẨN chứ không XOÁ: link và package vẫn nằm nguyên trong config, mai này tìm
// được cách chạy thì chỉ cần bỏ khỏi bảng này là hiện lại.
//
// Đối sánh theo TÊN, không theo link — vì mục dựng sẵn vốn đã bị đồng bộ link
// theo tên ở vòng cập nhật phía trên, nên một mục mang tên dựng sẵn thì luôn
// là app dựng sẵn đó. Ai muốn giữ bản Google Maps của riêng mình thì đặt tên
// khác (vd "Google Maps (của tôi)") — mục tự thêm không bao giờ bị đụng tới.
var quickInstallHiddenIn = map[string]int{
	"Google Maps":       4,
	quickInstallGMSName: 4,
}

// QuickInstallItem là 1 app được cấu hình để tải + cài chỉ với 1 bấm ở tab "Cài
// nhanh". Package học được sau lần cài thành công đầu tiên, dùng để biết app
// đã cài hay chưa (đổi nút Cài đặt <-> Gỡ cài đặt).
type QuickInstallItem struct {
	Name    string `json:"name"`
	URL     string `json:"url"`
	Package string `json:"package,omitempty"`

	// Hidden: mục vẫn nằm nguyên trong cấu hình nhưng KHÔNG hiện ở tab "Cài
	// nhanh". Dùng để tạm cất những app đã xác nhận không chạy được trên xe,
	// thay vì xoá hẳn — bật lại chỉ là đổi cờ này về false, không mất link.
	Hidden bool `json:"hidden,omitempty"`
}

// configPath trả về nơi lưu cấu hình.
//
// Biến môi trường GEELY_EX2_CONFIG cho phép trỏ sang file khác. Có mặt vì test
// tự động gọi thẳng vào HTTP handler, mà mọi thay đổi cấu hình đều được ghi
// xuống đĩa ngay — không có lối thoát này thì chạy test là ghi đè cấu hình
// thật của người dùng (đã từng xảy ra: mất package đã học của 1 mục cài nhanh).
func configPath() string {
	if p := os.Getenv("GEELY_EX2_CONFIG"); p != "" {
		return p
	}
	if dir, err := appDataDir(); err == nil {
		return filepath.Join(dir, "config.json")
	}
	return "apk_manager_config.json"
}

// defaultQuickInstalls là bộ mục "Cài nhanh" dựng sẵn của bản hiện tại. Sửa
// link ở đây thì phải tăng defaultsVersion, nếu không người đã chạy app rồi sẽ
// không nhận được thay đổi.
func defaultQuickInstalls() []QuickInstallItem {
	return []QuickInstallItem{
		{Name: "CentralEXAuto (Geely)", URL: "https://github.com/swimapps/CentralEXAuto/blob/main/CentralEXAuto-geely-platform-signed.apk"},
		{Name: "Waze", URL: "https://github.com/swimapps/CentralEXAuto/blob/main/WAZE-ex2.apk"},
		{Name: "Waze Mod", URL: "https://wazemod.chisadin.id.vn/api/download/cmrqjhq0k000504l7hb18lu7j"},
		{Name: "SmartTube", URL: "https://github.com/yuliskov/SmartTube/releases/download/31.94s/SmartTube_stable_31.94_arm64-v8a.apk"},
		{Name: "VietMap Live", URL: "https://drive.google.com/file/d/1LukLwOGJT1TVTewSiuIz0vpysYXoz5Sw/view?usp=sharing", Package: "vn.vietmap.live"},
		{Name: "Google Maps", URL: "https://drive.google.com/file/d/1Tqkp1EYo1B-xuMTiSHDVmbXiROUwmOBj/view?usp=sharing", Package: pkgGoogleMaps, Hidden: true},
		{Name: quickInstallGMSName, URL: "https://drive.google.com/file/d/1yx9I4PlqA_6VuFnoISX3VMgn2voTtUMs/view?usp=sharing", Package: pkgGoogleGMS, Hidden: true},
	}
}

// LoadConfig đọc config đã lưu, nếu chưa có thì trả về giá trị mặc định.
func LoadConfig() *Config {
	defaults := defaultQuickInstalls()
	cfg := &Config{
		IP:            "192.168.1.17",
		Port:          "5555",
		QuickInstalls: defaultQuickInstalls(),
	}

	data, err := os.ReadFile(configPath())
	if err == nil {
		_ = json.Unmarshal(data, cfg)
		if cfg.DefaultsVersion < defaultsVersion {
			refreshDefaultQuickInstalls(cfg, defaults)
			cfg.DefaultsVersion = defaultsVersion
			_ = cfg.Save()
		}
	} else {
		cfg.DefaultsVersion = defaultsVersion
	}
	return cfg
}

// refreshDefaultQuickInstalls cập nhật link của các mục "Cài nhanh" dựng sẵn
// trong config đã lưu sang link mới nhất.
//
// Chỉ đụng vào mục trùng TÊN với một mục dựng sẵn: app do người dùng tự thêm
// giữ nguyên tuyệt đối. Mục dựng sẵn đã bị người dùng xoá thì KHÔNG thêm lại —
// xoá là quyết định có chủ ý, không nên tự ý dựng dậy.
func refreshDefaultQuickInstalls(cfg *Config, defaults []QuickInstallItem) {
	byName := make(map[string]QuickInstallItem, len(defaults))
	for _, d := range defaults {
		byName[d.Name] = d
	}
	savedNames := make(map[string]bool, len(cfg.QuickInstalls))
	for i, saved := range cfg.QuickInstalls {
		savedNames[saved.Name] = true
		d, ok := byName[saved.Name]
		if !ok || d.URL == saved.URL {
			continue
		}
		cfg.QuickInstalls[i].URL = d.URL
		// Chỉ ghi đè package khi bản mặc định biết chắc. Đổi link chỉ là đổi
		// nơi tải cùng một app (mục được nhận diện theo TÊN), nên package đã
		// học được từ lần cài trước vẫn đúng — xoá nó đi sẽ làm nút mất trạng
		// thái "đã cài / chưa cài" cho tới lần cài kế tiếp.
		if d.Package != "" {
			cfg.QuickInstalls[i].Package = d.Package
		}
	}

	// Thêm mục dựng sẵn mới ra đời sau phiên bản mà config này đang ở. Giữ
	// nguyên thứ tự khai báo trong defaults để danh sách không xáo trộn.
	for _, d := range defaults {
		if savedNames[d.Name] {
			continue
		}
		if quickInstallIntroducedIn[d.Name] > cfg.DefaultsVersion {
			cfg.QuickInstalls = append(cfg.QuickInstalls, d)
		}
	}

	// Tạm ẩn những mục đã xác nhận không chạy được trên xe. Không xoá: link
	// vẫn còn đó, chỉ là không hiện ra để không ai tải nhầm.
	for i, q := range cfg.QuickInstalls {
		if v, hidden := quickInstallHiddenIn[q.Name]; hidden && v > cfg.DefaultsVersion {
			cfg.QuickInstalls[i].Hidden = true
		}
	}
}

func (c *Config) Save() error {
	data, err := json.MarshalIndent(c, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(configPath(), data, 0o644)
}
