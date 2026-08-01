package main

import (
	"errors"
	"fmt"
	"io"
	"mime"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"
)

var githubBlobRe = regexp.MustCompile(`^/([^/]+)/([^/]+)/blob/([^/]+)/(.+)$`)
var driveFileIDRe = regexp.MustCompile(`/file/d/([a-zA-Z0-9_-]+)`)

func isGoogleDriveHost(host string) bool {
	switch host {
	case "drive.google.com", "www.drive.google.com", "drive.usercontent.google.com":
		return true
	}
	return false
}

func extractDriveFileID(u *url.URL) string {
	if id := u.Query().Get("id"); id != "" {
		return id
	}
	if m := driveFileIDRe.FindStringSubmatch(u.Path); m != nil {
		return m[1]
	}
	return ""
}

// toDirectDownloadURL chuyển link "xem file" (GitHub blob, Google Drive share/view)
// thành link tải file gốc — các link xem trực tiếp trả về trang HTML preview
// chứ không phải file thật.
func toDirectDownloadURL(rawURL string) (string, error) {
	u, err := url.Parse(rawURL)
	if err != nil {
		return "", err
	}
	if u.Scheme != "http" && u.Scheme != "https" {
		return "", errors.New("chỉ hỗ trợ URL http/https")
	}

	if u.Host == "github.com" || u.Host == "www.github.com" {
		if m := githubBlobRe.FindStringSubmatch(u.Path); m != nil {
			owner, repo, branch, path := m[1], m[2], m[3], m[4]
			return fmt.Sprintf("https://raw.githubusercontent.com/%s/%s/%s/%s", owner, repo, branch, path), nil
		}
	}

	if isGoogleDriveHost(u.Host) {
		id := extractDriveFileID(u)
		if id == "" {
			return "", errors.New("không xác định được ID file từ URL Google Drive")
		}
		// confirm=t bỏ qua trang cảnh báo "không quét được virus" của Drive với file lớn.
		return fmt.Sprintf("https://drive.usercontent.google.com/download?id=%s&export=download&confirm=t", id), nil
	}

	return rawURL, nil
}

const maxDownloadSize = 500 * 1024 * 1024 // 500MB

// filenameFromResponse ưu tiên lấy tên file thật từ header Content-Disposition
// (bắt buộc với Google Drive vì URL tải không có tên file trên path), nếu
// không có thì lấy từ path của URL SAU KHI đã theo redirect (resp.Request.URL) —
// nhiều link tải (vd: API "/api/download/<id>") redirect sang URL thật mới có
// đuôi .apk, dùng URL gốc trước redirect sẽ luôn thấy thiếu phần mở rộng.
func filenameFromResponse(resp *http.Response, fallbackURL string) string {
	if cd := resp.Header.Get("Content-Disposition"); cd != "" {
		if _, params, err := mime.ParseMediaType(cd); err == nil {
			// filepath.Base chặn traversal (vd: "../../foo.apk") lỡ có trong header
			// của 1 server không đáng tin cậy mà người dùng tự thêm URL vào.
			if fn := filepath.Base(params["filename"]); fn != "" && fn != "." && fn != string(filepath.Separator) {
				return fn
			}
		}
	}
	finalURL := fallbackURL
	if resp.Request != nil && resp.Request.URL != nil {
		finalURL = resp.Request.URL.String()
	}
	name := filepath.Base(finalURL)
	if idx := strings.IndexByte(name, '?'); idx >= 0 {
		name = name[:idx]
	}
	return filepath.Base(name)
}

// DownloadInstallable tải 1 file .apk/.xapk/.apks/.apkm từ URL về thư mục tạm,
// trả về đường dẫn local. Caller chịu trách nhiệm xoá thư mục cha sau khi dùng xong.
func DownloadInstallable(rawURL string, log func(string)) (string, error) {
	direct, err := toDirectDownloadURL(rawURL)
	if err != nil {
		return "", err
	}
	if direct != rawURL {
		log("   🔗 Link rút gọn/chia sẻ → link tải trực tiếp: " + direct)
	}

	client := &http.Client{Timeout: 5 * time.Minute}
	req, err := http.NewRequest(http.MethodGet, direct, nil)
	if err != nil {
		return "", err
	}
	req.Header.Set("User-Agent", "GeelyEX2AppManage/1.0")

	resp, err := client.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("tải thất bại: HTTP %d", resp.StatusCode)
	}

	name := filenameFromResponse(resp, direct)
	ext := strings.ToLower(filepath.Ext(name))
	if !installableExts[ext] {
		return "", fmt.Errorf("URL không trỏ tới file .apk/.xapk/.apks/.apkm (tên file: %s)", name)
	}

	tempDir, err := os.MkdirTemp("", "apkmanager-download-*")
	if err != nil {
		return "", err
	}
	dest := filepath.Join(tempDir, name)
	out, err := os.Create(dest)
	if err != nil {
		os.RemoveAll(tempDir)
		return "", err
	}

	limited := io.LimitReader(resp.Body, maxDownloadSize+1)
	written, copyErr := io.Copy(out, limited)
	out.Close()
	if copyErr != nil {
		os.RemoveAll(tempDir)
		return "", copyErr
	}
	if written > maxDownloadSize {
		os.RemoveAll(tempDir)
		return "", errors.New("file quá lớn (>500MB)")
	}

	if !looksLikeZip(dest) {
		os.RemoveAll(tempDir)
		return "", errors.New("file tải về không phải APK hợp lệ (URL có thể sai hoặc bị chặn, kiểm tra lại link)")
	}

	log(fmt.Sprintf("   ✅ Đã tải xong (%.1f MB): %s", float64(written)/1024/1024, name))
	return dest, nil
}

// looksLikeZip kiểm tra magic bytes "PK" — apk/xapk/apks/apkm đều là file zip.
func looksLikeZip(path string) bool {
	f, err := os.Open(path)
	if err != nil {
		return false
	}
	defer f.Close()
	header := make([]byte, 2)
	n, _ := f.Read(header)
	return n == 2 && header[0] == 'P' && header[1] == 'K'
}
