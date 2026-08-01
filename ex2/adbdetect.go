package main

import (
	"os"
	"os/exec"
	"runtime"
)

func fileExecutable(path string) bool {
	info, err := os.Stat(path)
	if err != nil || info.IsDir() {
		return false
	}
	return true
}

// DetectAapt tìm aapt trong PATH — dùng để đọc tên app / package name từ file
// APK khi quét folder. Không bắt buộc phải có; thiếu aapt chỉ làm giảm khả
// năng nhận diện tên app hiển thị, không ảnh hưởng cài/gỡ.
func DetectAapt() string {
	if p, err := exec.LookPath(aaptBinaryName()); err == nil {
		return p
	}
	return ""
}

func aaptBinaryName() string {
	if runtime.GOOS == "windows" {
		return "aapt.exe"
	}
	return "aapt"
}
