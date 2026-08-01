//go:build windows

package main

import (
	_ "embed"
	"path/filepath"
)

//go:embed bundled/windows/adb.exe
var bundledAdb []byte

//go:embed bundled/windows/AdbWinApi.dll
var bundledAdbWinApiDLL []byte

//go:embed bundled/windows/AdbWinUsbApi.dll
var bundledAdbWinUsbApiDLL []byte

//go:embed bundled/windows/libwinpthread-1.dll
var bundledLibwinpthreadDLL []byte

// extractBundledAdb ghi adb.exe + các DLL đi kèm ra đĩa (cùng thư mục, adb.exe
// trên Windows cần các DLL này nằm cạnh mới chạy được), trả về đường dẫn adb.exe.
func extractBundledAdb() (string, error) {
	dir, err := bundledDir()
	if err != nil {
		return "", err
	}
	dest := filepath.Join(dir, "adb.exe")
	if err := writeIfChanged(dest, bundledAdb, 0o755); err != nil {
		return "", err
	}
	if err := writeIfChanged(filepath.Join(dir, "AdbWinApi.dll"), bundledAdbWinApiDLL, 0o644); err != nil {
		return "", err
	}
	if err := writeIfChanged(filepath.Join(dir, "AdbWinUsbApi.dll"), bundledAdbWinUsbApiDLL, 0o644); err != nil {
		return "", err
	}
	if err := writeIfChanged(filepath.Join(dir, "libwinpthread-1.dll"), bundledLibwinpthreadDLL, 0o644); err != nil {
		return "", err
	}
	return dest, nil
}
