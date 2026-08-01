package main

import (
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"sort"
)

// adbCandidates trả về danh sách đường dẫn adb khả dĩ theo từng hệ điều hành,
// đã tồn tại trên đĩa (chưa chắc chạy được, chỉ kiểm tra sự hiện diện).
func adbCandidates() []string {
	var out []string
	if p, err := exec.LookPath(adbBinaryName()); err == nil {
		out = append(out, p)
	}
	home, _ := os.UserHomeDir()

	switch runtime.GOOS {
	case "windows":
		local := os.Getenv("LOCALAPPDATA")
		if local != "" {
			out = append(out, filepath.Join(local, "Android", "Sdk", "platform-tools", "adb.exe"))
		}
		for _, envVar := range []string{"ProgramFiles", "ProgramFiles(x86)"} {
			pf := os.Getenv(envVar)
			if pf != "" {
				out = append(out, filepath.Join(pf, "Android", "android-sdk", "platform-tools", "adb.exe"))
			}
		}
		if home != "" {
			out = append(out, filepath.Join(home, "AppData", "Local", "Android", "Sdk", "platform-tools", "adb.exe"))
		}
	default: // darwin, linux
		if home != "" {
			out = append(out, filepath.Join(home, "Library", "Android", "sdk", "platform-tools", "adb"))
			out = append(out, filepath.Join(home, "Android", "Sdk", "platform-tools", "adb"))
		}
		out = append(out, "/usr/local/share/android-sdk/platform-tools/adb")
	}

	seen := map[string]bool{}
	var uniq []string
	for _, c := range out {
		if c == "" || seen[c] {
			continue
		}
		seen[c] = true
		uniq = append(uniq, c)
	}
	return uniq
}

func adbBinaryName() string {
	if runtime.GOOS == "windows" {
		return "adb.exe"
	}
	return "adb"
}

func fileExecutable(path string) bool {
	info, err := os.Stat(path)
	if err != nil || info.IsDir() {
		return false
	}
	return true
}

// DetectAdb thử từng candidate, trả về path đầu tiên tồn tại (rỗng nếu không thấy).
func DetectAdb() (string, []string) {
	candidates := adbCandidates()
	for _, c := range candidates {
		if fileExecutable(c) {
			return c, candidates
		}
	}
	return "", candidates
}

// DetectAapt tìm aapt cạnh adb (trong build-tools/<version>/aapt) hoặc trong PATH.
func DetectAapt(adbPath string) string {
	if adbPath != "" {
		dir := filepath.Dir(adbPath)
		pattern := filepath.Join(dir, "..", "build-tools", "*", aaptBinaryName())
		matches, _ := filepath.Glob(pattern)
		if len(matches) > 0 {
			sort.Strings(matches)
			return matches[len(matches)-1]
		}
	}
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
