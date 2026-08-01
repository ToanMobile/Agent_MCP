//go:build darwin

package main

import (
	_ "embed"
	"path/filepath"
)

//go:embed bundled/darwin/adb
var bundledAdb []byte

// extractBundledAdb ghi adb kèm sẵn trong app ra đĩa, trả về đường dẫn đã dùng được ngay.
func extractBundledAdb() (string, error) {
	dir, err := bundledDir()
	if err != nil {
		return "", err
	}
	dest := filepath.Join(dir, "adb")
	if err := writeIfChanged(dest, bundledAdb, 0o755); err != nil {
		return "", err
	}
	return dest, nil
}
