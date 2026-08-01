package main

import (
	"embed"
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

	fmt.Println("==============================================")
	fmt.Println(" Geely EX2 App Manage đang chạy tại:", url)
	fmt.Println(" Nhấn Ctrl+C để dừng.")
	fmt.Println("==============================================")

	go func() {
		time.Sleep(300 * time.Millisecond)
		openBrowser(url)
	}()

	srv := &http.Server{Handler: mux}
	log.Fatal(srv.Serve(ln))
}
