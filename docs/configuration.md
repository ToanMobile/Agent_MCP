# Cấu hình

Repo này là công cụ dùng chung. Mỗi project đích khai riêng một file `.antigravity-pm.json` ở gốc.

## Toàn bộ khoá

| Khoá | Mặc định | Ý nghĩa |
| --- | --- | --- |
| `projectName` | tên thư mục | Chỉ để báo cáo cho dễ đọc |
| `defaultModel` | `"pro"` | Model Antigravity: `flash_lite` \| `flash` \| `pro` |
| `stateDir` | `".antigravity-pm"` | Thư mục lưu hồ sơ task, tính từ gốc project |
| `rulesFiles` | `["AGENTS.md", "CLAUDE.md"]` | File luật **bắt buộc agent đọc**; file không tồn tại thì bị bỏ qua im lặng (không nhét vào prompt) |
| `testCommand` | `null` | Lệnh test thật. **Chưa khai thì `pm_run kind=test` báo lỗi** ⇒ cổng nghiệm thu không bao giờ đạt |
| `auditCommands` | `[]` | Các cổng chặn / lint / verify của project, chạy tuần tự bằng `pm_run kind=audit` |
| `commitPolicy` | `"forbid"` | `forbid` ⇒ prompt cấm agent `git commit` / `push` / `reset --hard`. Giá trị lạ tự về `forbid` |
| `runTimeoutMs` | `900000` | Hạn cho mỗi lệnh test/audit (15 phút) |
| `stallMinutes` | `12` | Im lâu hơn mức này thì `pm_status` cảnh báo "có thể đang treo" |
| `proof.require` | `1` | Số ảnh nghiệm thu tối thiểu **mỗi vòng làm** |
| `proof.defaultProvider` | `null` | Provider dùng khi `pm_capture_proof` không chỉ định. Nếu chỉ khai đúng 1 provider thì tự chọn cái đó |
| `proof.providers` | `{}` | Khai cách chụp, xem dưới |
| `proof.maxWidth` | `1280` | Thu nhỏ ảnh về chiều ngang này (dùng `sips`) |
| `antigravity.workspaceCheck` | `"strict"` | `strict` ⇒ `pm_dispatch` **thất bại** nếu hội thoại mở trong workspace khác; `warn` ⇒ chỉ cảnh báo |
| `antigravity.projectId` | `null` | Thử nghiệm, chưa chắc Antigravity tôn trọng |

Khoá lạ chỉ sinh cảnh báo trong `pm_doctor`, không làm server nổ.

## Cách chụp ảnh nghiệm thu

### `adb` — chụp từ thiết bị Android / đầu xe / máy ảo

```json
{ "type": "adb", "serial": "192.168.1.16:5555", "adb": "adb", "timeoutMs": 60000 }
```

Chạy `adb exec-out screencap -p`. `serial` bỏ trống ⇒ thiết bị duy nhất đang nối. Ghi đè tại chỗ gọi: `pm_capture_proof { serial: "emulator-5554" }`.

### `macos` — chụp màn hình máy

```json
{ "type": "macos", "region": "0,0,1440,900" }
```

`region` dạng `x,y,w,h` (bỏ trống = toàn màn hình), `window` = id cửa sổ. Lần đầu macOS sẽ hỏi quyền Screen Recording cho tiến trình chạy MCP.

### `shell` — lệnh tuỳ ý

```json
{ "type": "shell", "command": "npx playwright screenshot http://localhost:5173 {{out}}" }
```

`{{out}}` được thay bằng đường dẫn file đích. Lệnh chạy với `cwd` = gốc project. Exit code khác 0, hoặc file sinh ra không phải PNG/JPEG ⇒ **báo lỗi thẳng**, không nhận làm bằng chứng.

### `file` — nhận ảnh agent đã chụp

Không cần khai trong config:

```
pm_capture_proof { taskId, label: "...", sourceFile: "/duong/dan/anh.png" }
```

## Kiểm tra ảnh

| Kiểm | Xử lý |
| --- | --- |
| Magic byte không phải PNG/JPEG | Từ chối, in 200 byte đầu để biết lệnh đã in ra cái gì |
| Nhỏ hơn 8 KB | Nhận nhưng **cảnh báo** "rất có thể màn hình đang tắt/trắng" |
| Rộng hơn `proof.maxWidth` | Thu nhỏ bằng `sips` |
| Base64 vượt ~1,2 MB | Thu nhỏ tiếp về 900px rồi 640px để nhét được vào khối ảnh MCP |

## Biến môi trường

| Biến | Việc |
| --- | --- |
| `ANTIGRAVITY_PM_PROJECT` | Project mặc định khi tool không truyền `project` |
| `ANTIGRAVITY_PM_AGENTAPI` | Trỏ tới binary `agentapi` khác (khi Antigravity cài chỗ lạ) |
| `ANTIGRAVITY_PM_QUIET` | `1` ⇒ tắt log stderr |

Server tự dò địa chỉ language server của IDE đang chạy; nếu MCP được khởi động **từ trong terminal của Antigravity** thì nó dùng luôn biến môi trường mà IDE đã bơm vào.

## Gốc project được tìm thế nào

1. Đi lên từ đường dẫn truyền vào, tìm thư mục có `.antigravity-pm.json`
2. Không có thì tìm thư mục có `.git`
3. Không có nữa thì dùng chính đường dẫn đó

Nhờ vậy truyền `project` là một thư mục con sâu trong repo vẫn ra đúng gốc.
