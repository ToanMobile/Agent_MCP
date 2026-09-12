# Ví dụ cấu hình

Chép một file vào **gốc project đích** rồi đổi tên thành `.antigravity-pm.json`:

```bash
cp examples/antigravity-pm.geely-android.json /duong/dan/project/.antigravity-pm.json
```

Những thứ project nào cũng giống nhau thì để một lần ở tầng chung, project chỉ khai phần riêng:

```bash
cp examples/antigravity-pm.global.json ~/.antigravity-pm.json
```

| File | Dùng cho |
| --- | --- |
| `antigravity-pm.geely-android.json` | Monorepo Android nhiều app, nghiệm thu bằng ảnh chụp từ đầu xe / máy ảo qua `adb` |
| `antigravity-pm.web.json` | App web, nghiệm thu bằng ảnh Playwright, đòi 2 ảnh mỗi task |
| `antigravity-pm.minimal.json` | Ít nhất có thể: một lệnh test + chụp màn hình macOS |
| `antigravity-pm.global.json` | **Tầng chung** — chép vào `~/.antigravity-pm.json`, làm mặc định cho mọi project |

Nhớ thêm vào `.gitignore` của project đích nếu không muốn commit hồ sơ task:

```gitignore
.antigravity-pm/
```

Mọi khoá cấu hình: [docs/configuration.md](../docs/configuration.md).
