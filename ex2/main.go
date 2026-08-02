package main

import (
	"embed"
	"encoding/json"
	"fmt"
	"io/fs"
	"log"
	"net"
	"net/http"
	"os/exec"
	"runtime"
	"time"
)

//go:embed web
var webFS embed.FS

const primaryPort = 8848

// shutdownExistingInstance kiểm tra xem cổng chính (8848) có đang bị 1 bản
// Geely EX2 App Manage khác chiếm không (vd bản cũ chưa tắt hẳn từ lần chạy
// trước) — nếu đúng, yêu cầu bản đó tự tắt để bản mới luôn chạy đúng ở cổng
// quen thuộc thay vì bị đẩy sang cổng khác (8849, 8850...).
func shutdownExistingInstance(port int) {
	base := fmt.Sprintf("http://127.0.0.1:%d", port)
	client := &http.Client{Timeout: 500 * time.Millisecond}

	resp, err := client.Get(base + "/api/status")
	if err != nil {
		return // không có gì đang chạy ở cổng này
	}
	var status map[string]any
	decodeErr := json.NewDecoder(resp.Body).Decode(&status)
	resp.Body.Close()
	if decodeErr != nil {
		return
	}
	if _, ok := status["quickInstalls"]; !ok {
		return // không phải app này (có thứ khác đang dùng cổng 8848) — không đụng vào
	}

	fmt.Println("⚠️  Phát hiện bản Geely EX2 App Manage khác đang chạy — đang tắt bản cũ để chạy bản mới...")
	_, _ = client.Post(base+"/api/shutdown", "application/json", nil)

	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		time.Sleep(100 * time.Millisecond)
		conn, dialErr := net.DialTimeout("tcp", fmt.Sprintf("127.0.0.1:%d", port), 100*time.Millisecond)
		if dialErr != nil {
			return // cổng đã trống, bản cũ đã tắt xong
		}
		conn.Close()
	}
}

func openBrowser(url string) {
	var cmd *exec.Cmd
	switch runtime.GOOS {
	case "darwin":
		cmd = exec.Command("open", url)
	case "windows":
		cmd = exec.Command("rundll32", "url.dll,FileProtocolHandler", url)
	default:
		cmd = exec.Command("xdg-open", url)
	}
	_ = cmd.Start()
}

func listenAvailablePort() (net.Listener, int) {
	for _, p := range []int{8848, 8849, 8850, 8851, 8852} {
		ln, err := net.Listen("tcp", fmt.Sprintf("127.0.0.1:%d", p))
		if err == nil {
			return ln, p
		}
	}
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		log.Fatal(err)
	}
	return ln, ln.Addr().(*net.TCPAddr).Port
}

func main() {
	shutdownExistingInstance(primaryPort)

	CleanupOrphanedTempDirs()

	cfg := LoadConfig()
	mgr := NewManager(cfg)

	mux := http.NewServeMux()
	RegisterRoutes(mux, mgr)

	sub, err := fs.Sub(webFS, "web")
	if err != nil {
		log.Fatal(err)
	}
	mux.Handle("/", http.FileServer(http.FS(sub)))

	ln, port := listenAvailablePort()
	url := fmt.Sprintf("http://127.0.0.1:%d/", port)
	handler := blockCrossSiteRequests(mux, port)

	fmt.Println("==============================================")
	fmt.Println(" Geely EX2 App Manage đang chạy tại:", url)
	fmt.Println(" Nhấn Ctrl+C để dừng.")
	fmt.Println("==============================================")

	go func() {
		time.Sleep(300 * time.Millisecond)
		openBrowser(url)
	}()

	srv := &http.Server{Handler: handler}
	log.Fatal(srv.Serve(ln))
}

// blockCrossSiteRequests chặn request đến từ trang web khác. App nghe ở
// 127.0.0.1 nhưng điều đó KHÔNG đủ an toàn: bất kỳ website nào người dùng mở
// trong trình duyệt cũng có thể gửi POST tới 127.0.0.1 (kiểu tấn công CSRF) —
// vì các API ở đây chạy được lệnh adb tuỳ ý lên xe, gỡ app, cài file từ đường
// dẫn bất kỳ, nên phải khoá lại.
//
// Trình duyệt luôn gắn "Sec-Fetch-Site" (Chrome/Edge/Safari/Firefox hiện nay)
// và gắn "Origin" cho request POST cross-origin — chỉ cần từ chối khi 2 header
// này cho thấy request đến từ nơi khác. Request do chính giao diện app gửi
// (cùng origin) luôn qua được. Công cụ dòng lệnh (curl…) không gửi 2 header
// này nên vẫn dùng được bình thường để debug.
func blockCrossSiteRequests(next http.Handler, port int) http.Handler {
	allowed := map[string]bool{
		fmt.Sprintf("http://127.0.0.1:%d", port): true,
		fmt.Sprintf("http://localhost:%d", port): true,
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.Header.Get("Sec-Fetch-Site") {
		case "cross-site", "same-site":
			http.Error(w, "cross-site request bị chặn", http.StatusForbidden)
			return
		}
		if origin := r.Header.Get("Origin"); origin != "" && !allowed[origin] {
			http.Error(w, "origin không hợp lệ", http.StatusForbidden)
			return
		}
		next.ServeHTTP(w, r)
	})
}
