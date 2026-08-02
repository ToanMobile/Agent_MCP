package main

import (
	"bytes"
	"fmt"
	"os"
	"path/filepath"
)

// appDataDir trả về thư mục dữ liệu riêng của app theo chuẩn hệ điều hành
// (vd: ~/Library/Application Support/GeelyEX2AppManage trên macOS,
// %AppData%\GeelyEX2AppManage trên Windows) — dùng để cất config + adb giải
// nén sẵn, không để lộ file/thư mục lạ cạnh file thực thi mà người dùng chạy.
func appDataDir() (string, error) {
	base, err := os.UserConfigDir()
	if err != nil {
		return "", err
	}
	dir := filepath.Join(base, "GeelyEX2AppManage")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return "", err
	}
	return dir, nil
}

// bundledDir trả về thư mục để giải nén adb kèm sẵn trong app.
func bundledDir() (string, error) {
	dir, err := appDataDir()
	if err != nil {
		return "", err
	}
	dir = filepath.Join(dir, "adb-bin")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return "", err
	}
	return dir, nil
}

// writeIfChanged chỉ ghi lại nội dung khi khác hoặc chưa tồn tại — tránh ghi đè
// giống hệt mỗi lần khởi động app — nhưng luôn đảm bảo đúng quyền thực thi dù
// nội dung không đổi (phòng trường hợp bị mất quyền exec do sao chép/AV).
// Ghi ra file tạm cùng thư mục rồi rename đè lên (atomic) để 2 tiến trình app
// khởi động cùng lúc không ghi đè lẫn nhau ra 1 file dở dang.
func writeIfChanged(path string, data []byte, perm os.FileMode) error {
	if existing, err := os.ReadFile(path); err == nil && bytes.Equal(existing, data) {
		return os.Chmod(path, perm)
	}
	tmp := path + fmt.Sprintf(".tmp-%d", os.Getpid())
	if err := os.WriteFile(tmp, data, perm); err != nil {
		return err
	}
	if err := os.Rename(tmp, path); err != nil {
		os.Remove(tmp)
		return err
	}
	return nil
}
