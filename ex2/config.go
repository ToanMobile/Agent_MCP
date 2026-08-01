package main

import (
	"encoding/json"
	"os"
	"path/filepath"
)

// Config lưu các thiết lập người dùng nhập trong UI, ghi lại cạnh file thực thi
// để lần chạy sau tự nhớ IP / đường dẫn adb.
type Config struct {
	IP            string `json:"ip"`
	Port          string `json:"port"`
	AdbPath       string `json:"adbPath"`
	AutoUninstall bool   `json:"autoUninstall"`
	LastFolder    string `json:"lastFolder"`

	QuickInstalls []QuickInstallItem `json:"quickInstalls"`

	FavoritePackages []string `json:"favoritePackages"`
}

// QuickInstallItem là 1 app được cấu hình để tải + cài chỉ với 1 bấm ở tab "Cài nhanh".
type QuickInstallItem struct {
	Name string `json:"name"`
	URL  string `json:"url"`
}

func configPath() string {
	if exe, err := os.Executable(); err == nil {
		if resolved, err2 := filepath.EvalSymlinks(exe); err2 == nil {
			exe = resolved
		}
		return filepath.Join(filepath.Dir(exe), "apk_manager_config.json")
	}
	return "apk_manager_config.json"
}

// LoadConfig đọc config đã lưu, nếu chưa có thì trả về giá trị mặc định.
func LoadConfig() *Config {
	cfg := &Config{
		IP:            "192.168.1.17",
		Port:          "5555",
		AutoUninstall: false,
		QuickInstalls: []QuickInstallItem{
			{Name: "CentralEXAuto (Geely)", URL: "https://github.com/swimapps/CentralEXAuto/blob/main/CentralEXAuto-geely-platform-signed.apk"},
			{Name: "Waze", URL: "https://github.com/swimapps/CentralEXAuto/blob/main/WAZE-ex2.apk"},
			{Name: "Waze Mod", URL: "https://wazemod.chisadin.id.vn/api/download/cmrqjhq0k000504l7hb18lu7j"},
			{Name: "SmartTube", URL: "https://github.com/yuliskov/SmartTube/releases/download/31.94s/SmartTube_stable_31.94_arm64-v8a.apk"},
			{Name: "VietMap Live", URL: "https://drive.usercontent.google.com/open?id=1OCVLwfP8pesWMaOYBmJTvsVTQXrciE0H&authuser=0"},
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
