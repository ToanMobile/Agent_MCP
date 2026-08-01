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
}

// QuickInstallItem là 1 app được cấu hình để tải + cài chỉ với 1 bấm ở tab "Cài
// nhanh". Package học được sau lần cài thành công đầu tiên, dùng để biết app
// đã cài hay chưa (đổi nút Cài đặt <-> Gỡ cài đặt).
type QuickInstallItem struct {
	Name    string `json:"name"`
	URL     string `json:"url"`
	Package string `json:"package,omitempty"`
}

func configPath() string {
	if dir, err := appDataDir(); err == nil {
		return filepath.Join(dir, "config.json")
	}
	return "apk_manager_config.json"
}

// LoadConfig đọc config đã lưu, nếu chưa có thì trả về giá trị mặc định.
func LoadConfig() *Config {
	cfg := &Config{
		IP:   "192.168.1.17",
		Port: "5555",
		QuickInstalls: []QuickInstallItem{
			{Name: "CentralEXAuto (Geely)", URL: "https://github.com/swimapps/CentralEXAuto/blob/main/CentralEXAuto-geely-platform-signed.apk"},
			{Name: "Waze", URL: "https://github.com/swimapps/CentralEXAuto/blob/main/WAZE-ex2.apk"},
			{Name: "Waze Mod", URL: "https://wazemod.chisadin.id.vn/api/download/cmrqjhq0k000504l7hb18lu7j"},
			{Name: "SmartTube", URL: "https://github.com/yuliskov/SmartTube/releases/download/31.94s/SmartTube_stable_31.94_arm64-v8a.apk"},
			{Name: "VietMap Live", URL: "https://drive.usercontent.google.com/open?id=1OCVLwfP8pesWMaOYBmJTvsVTQXrciE0H&authuser=0"},
			{Name: "Google Maps", URL: "https://r-static-assets.androidapksfree.net/rdata/60657287275c17f17edab6e476951479/com.google.android.apps.maps_v26.24.10.928892089-1068624422_Android-9.0.apk"},
		},
	}
	data, err := os.ReadFile(configPath())
	if err == nil {
		_ = json.Unmarshal(data, cfg)
	}
	return cfg
}

func (c *Config) Save() error {
	data, err := json.MarshalIndent(c, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(configPath(), data, 0o644)
}
