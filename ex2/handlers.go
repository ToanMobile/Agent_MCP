package main

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

func writeJSON(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	_ = json.NewEncoder(w).Encode(v)
}

func writeErr(w http.ResponseWriter, code int, msg string) {
	w.WriteHeader(code)
	writeJSON(w, map[string]string{"error": msg})
}

// streamOp chạy 1 tác vụ dài, ghi log ra response theo dạng text/plain, flush
// từng dòng để frontend đọc real-time qua fetch + ReadableStream.
func streamOp(w http.ResponseWriter, op func(log func(string))) {
	w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	flusher, _ := w.(http.Flusher)
	logf := func(s string) {
		w.Write([]byte(s + "\n"))
		if flusher != nil {
			flusher.Flush()
		}
	}
	op(logf)
}

// statusPayload luôn đọc qua StatusSnapshot() để lấy dữ liệu dưới khoá.
func statusPayload(mgr *Manager) map[string]any {
	return mgr.StatusSnapshot()
}

func RegisterRoutes(mux *http.ServeMux, mgr *Manager) {
	mux.HandleFunc("/api/status", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, statusPayload(mgr))
	})

	// /api/shutdown: cho phép 1 bản Geely EX2 App Manage mới khởi động yêu cầu
	// bản cũ (đang chiếm cổng 8848 từ lần chạy trước) tự thoát, để bản mới luôn
	// chạy đúng ở cổng quen thuộc thay vì bị đẩy sang cổng khác.
	mux.HandleFunc("/api/shutdown", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			writeErr(w, 405, "method not allowed")
			return
		}
		w.WriteHeader(http.StatusOK)
		go func() {
			time.Sleep(150 * time.Millisecond)
			os.Exit(0)
		}()
	})

	mux.HandleFunc("/api/config", func(w http.ResponseWriter, r *http.Request) {
		switch r.Method {
		case http.MethodGet:
			writeJSON(w, statusPayload(mgr))
		case http.MethodPost:
			var body struct {
				IP               string              `json:"ip"`
				Port             string              `json:"port"`
				QuickInstalls    *[]QuickInstallItem `json:"quickInstalls"`
				FavoritePackages *[]string           `json:"favoritePackages"`
			}
			if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
				writeErr(w, 400, "body không hợp lệ")
				return
			}
			if err := mgr.UpdateConfig(func(c *Config) {
				if strings.TrimSpace(body.IP) != "" {
					c.IP = strings.TrimSpace(body.IP)
				}
				if strings.TrimSpace(body.Port) != "" {
					c.Port = strings.TrimSpace(body.Port)
				}
				if body.QuickInstalls != nil {
					c.QuickInstalls = *body.QuickInstalls
				}
				if body.FavoritePackages != nil {
					c.FavoritePackages = *body.FavoritePackages
				}
			}); err != nil {
				writeErr(w, 500, err.Error())
				return
			}
			writeJSON(w, statusPayload(mgr))
		default:
			writeErr(w, 405, "method not allowed")
		}
	})

	mux.HandleFunc("/api/adb/test", func(w http.ResponseWriter, r *http.Request) {
		if mgr.AdbPath == "" || !fileExecutable(mgr.AdbPath) {
			writeJSON(w, map[string]any{"ok": false, "message": "Không giải nén được adb kèm sẵn trong app."})
			return
		}
		out, err := mgr.runTimeout(10, "version")
		if err != nil {
			writeJSON(w, map[string]any{"ok": false, "message": err.Error()})
			return
		}
		writeJSON(w, map[string]any{"ok": true, "message": strings.TrimSpace(out)})
	})

	mux.HandleFunc("/api/connect", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			writeErr(w, 405, "method not allowed")
			return
		}
		streamOp(w, func(log func(string)) {
			err := mgr.Connect(log)
			switch {
			case errors.Is(err, ErrMultiDevice):
				log("MULTI_DEVICE")
			case err != nil:
				log("DONE_ERROR")
			default:
				log("DONE_OK")
			}
		})
	})

	mux.HandleFunc("/api/devices", func(w http.ResponseWriter, r *http.Request) {
		devices, err := mgr.DeviceList()
		if err != nil {
			writeErr(w, 500, err.Error())
			return
		}
		var serials []string
		for _, d := range devices {
			if d.State == "device" {
				serials = append(serials, d.Serial)
			}
		}
		writeJSON(w, map[string]any{"devices": serials})
	})

	mux.HandleFunc("/api/select-device", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			writeErr(w, 405, "method not allowed")
			return
		}
		var body struct {
			Serial string `json:"serial"`
		}
		_ = json.NewDecoder(r.Body).Decode(&body)
		if strings.TrimSpace(body.Serial) == "" {
			writeErr(w, 400, "thiếu serial")
			return
		}
		streamOp(w, func(log func(string)) {
			if err := mgr.SelectDevice(body.Serial, log); err != nil {
				log("DONE_ERROR")
				return
			}
			log("DONE_OK")
		})
	})

	mux.HandleFunc("/api/scan-folder", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			writeErr(w, 405, "method not allowed")
			return
		}
		var body struct {
			Path string `json:"path"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			writeErr(w, 400, "body không hợp lệ")
			return
		}
		path := strings.Trim(strings.TrimSpace(body.Path), `"'`)
		info, err := os.Stat(path)
		if err != nil || !info.IsDir() {
			writeErr(w, 400, "Không tìm thấy folder: "+path)
			return
		}
		scan, err := mgr.ScanFolder(path)
		if err != nil {
			writeErr(w, 500, err.Error())
			return
		}
		_ = mgr.UpdateConfig(func(c *Config) { c.LastFolder = path })
		writeJSON(w, scan)
	})

	mux.HandleFunc("/api/install-path", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			writeErr(w, 405, "method not allowed")
			return
		}
		var body struct {
			Path string `json:"path"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			writeErr(w, 400, "body không hợp lệ")
			return
		}
		path := strings.Trim(strings.TrimSpace(body.Path), `"'`)
		streamOp(w, func(log func(string)) {
			if _, err := os.Stat(path); err != nil {
				log("❌ Không tìm thấy file: " + path)
				log("RESULT_ERROR")
				return
			}
			if _, err := mgr.InstallPath(path, log); err != nil {
				log("RESULT_ERROR")
				return
			}
			log("RESULT_OK")
		})
	})

	mux.HandleFunc("/api/install/upload", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			writeErr(w, 405, "method not allowed")
			return
		}
		if err := r.ParseMultipartForm(1 << 30); err != nil {
			writeErr(w, 400, "upload lỗi: "+err.Error())
			return
		}
		files := r.MultipartForm.File["files"]
		streamOp(w, func(log func(string)) {
			if len(files) == 0 {
				log("❌ Không có file nào được tải lên.")
				return
			}
			tempDir, err := os.MkdirTemp("", "apkmanager-upload-*")
			if err != nil {
				log("❌ Không tạo được thư mục tạm: " + err.Error())
				return
			}
			defer os.RemoveAll(tempDir)

			success, fail := 0, 0
			for _, fh := range files {
				src, err := fh.Open()
				if err != nil {
					log("❌ Không đọc được: " + fh.Filename)
					fail++
					continue
				}
				dstPath := filepath.Join(tempDir, filepath.Base(fh.Filename))
				dst, err := os.Create(dstPath)
				if err != nil {
					src.Close()
					log("❌ Không lưu được: " + fh.Filename)
					fail++
					continue
				}
				_, copyErr := io.Copy(dst, src)
				src.Close()
				dst.Close()
				if copyErr != nil {
					log("❌ Lỗi khi lưu: " + fh.Filename)
					fail++
					continue
				}

				if _, err := mgr.InstallPath(dstPath, log); err != nil {
					fail++
				} else {
					success++
				}
			}
			log("")
			log("✅ Thành công: " + strconv.Itoa(success) + "   ❌ Thất bại: " + strconv.Itoa(fail))
		})
	})

	mux.HandleFunc("/api/uninstall", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			writeErr(w, 405, "method not allowed")
			return
		}
		var body struct {
			Package string `json:"package"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			writeErr(w, 400, "body không hợp lệ")
			return
		}
		pkg := strings.TrimSpace(body.Package)
		streamOp(w, func(log func(string)) {
			if pkg == "" {
				log("❌ Bạn chưa nhập package name.")
				log("RESULT_ERROR")
				return
			}
			if err := mgr.UninstallPkg(pkg, log); err != nil {
				log("RESULT_ERROR")
				return
			}
			log("RESULT_OK")
		})
	})

	mux.HandleFunc("/api/packages", func(w http.ResponseWriter, r *http.Request) {
		pkgs, err := mgr.ListPackages()
		if err != nil {
			writeErr(w, 500, err.Error())
			return
		}
		writeJSON(w, map[string]any{"packages": pkgs})
	})

	mux.HandleFunc("/api/packages/disable", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			writeErr(w, 405, "method not allowed")
			return
		}
		var body struct {
			Packages []string `json:"packages"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			writeErr(w, 400, "body không hợp lệ")
			return
		}
		streamOp(w, func(log func(string)) {
			for _, p := range body.Packages {
				_ = mgr.DisablePackage(p, log)
			}
		})
	})

	mux.HandleFunc("/api/packages/enable", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			writeErr(w, 405, "method not allowed")
			return
		}
		var body struct {
			Packages []string `json:"packages"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			writeErr(w, 400, "body không hợp lệ")
			return
		}
		streamOp(w, func(log func(string)) {
			for _, p := range body.Packages {
				_ = mgr.EnablePackage(p, log)
			}
		})
	})

	mux.HandleFunc("/api/dev-settings", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			writeErr(w, 405, "method not allowed")
			return
		}
		streamOp(w, func(log func(string)) {
			_ = mgr.EnableDevFreeform(log)
		})
	})

	mux.HandleFunc("/api/adb/shell", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			writeErr(w, 405, "method not allowed")
			return
		}
		var body struct {
			Command string `json:"command"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			writeErr(w, 400, "body không hợp lệ")
			return
		}
		streamOp(w, func(log func(string)) {
			_ = mgr.RunShellCommand(body.Command, log)
		})
	})

	mux.HandleFunc("/api/quick-install", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			writeErr(w, 405, "method not allowed")
			return
		}
		var body struct {
			URL string `json:"url"`
		}
		_ = json.NewDecoder(r.Body).Decode(&body)
		targetURL := strings.TrimSpace(body.URL)
		if targetURL == "" && len(mgr.Cfg.QuickInstalls) > 0 {
			targetURL = mgr.Cfg.QuickInstalls[0].URL
		}
		streamOp(w, func(log func(string)) {
			if targetURL == "" {
				log("❌ Chưa cấu hình URL để tải.")
				log("RESULT_ERROR")
				return
			}
			log("⬇️  Đang tải: " + targetURL)
			path, err := DownloadInstallable(targetURL, log)
			if err != nil {
				log("❌ " + err.Error())
				log("RESULT_ERROR")
				return
			}
			defer os.RemoveAll(filepath.Dir(path))
			pkg, err := mgr.InstallPath(path, log)
			if err != nil {
				log("RESULT_ERROR")
				return
			}
			if pkg != "" {
				_ = mgr.UpdateConfig(func(c *Config) {
					for i := range c.QuickInstalls {
						if c.QuickInstalls[i].URL == targetURL {
							c.QuickInstalls[i].Package = pkg
						}
					}
				})
			}
			_ = mgr.LaunchApp(pkg, log)
			log("RESULT_OK")
		})
	})
}
