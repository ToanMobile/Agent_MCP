# Antigravity PM MCP Server

[![Node 20+](https://img.shields.io/badge/node-20%2B-green.svg)](https://nodejs.org)
[![MCP](https://img.shields.io/badge/MCP-1.30-blue.svg)](https://modelcontextprotocol.io)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Tests](https://img.shields.io/badge/tests-40%20passing-brightgreen.svg)](#-phát-triển)

MCP server để **Claude Code đứng vai Leader/PM giao việc cho Google Antigravity** rồi tự audit, code review, chạy test và **đòi ảnh nghiệm thu** trước khi cho task đi qua. Antigravity viết code, Claude Code kiểm tra và chịu trách nhiệm nghiệm thu.

Dùng chung cho nhiều project: repo này là **công cụ**, còn trạng thái task nằm trong từng project (`.antigravity-pm/`), cấu hình riêng từng project (`.antigravity-pm.json`).

## ✨ Tính năng

- 🧭 **Quy trình 7 giai đoạn cưỡng chế** — `PLAN → IMPLEMENT → AUDIT → REVIEW → TEST → PROOF → ACCEPTED`
- 🚧 **Cổng nghiệm thu nằm trong code** — thiếu kế hoạch đã duyệt, báo cáo mới, kết luận audit, kết luận review, test `exit 0`, hay ảnh nghiệm thu ⇒ `pm_accept` **từ chối thẳng**
- 📸 **Ảnh nghiệm thu bắt buộc** — chụp từ xe/máy ảo qua `adb`, từ màn hình macOS, từ lệnh tuỳ ý, hoặc nhận ảnh do agent tự chụp; ảnh **trả về tận mắt PM** qua khối ảnh MCP
- 🔁 **Vòng trả việc có hiệu lực thật** — `pm_rework` tăng vòng và **huỷ sạch bằng chứng cũ**: bản xanh của bản code đã bị sửa không còn giá trị
- 🕵️ **Không tin lời khai** — `pm_diff` đối chiếu `git status` thật với danh sách file agent khai, tố giác file sửa ngoài phạm vi
- 🧪 **Không nuốt exit code** — `pm_run` ghi exit code thật + log vào hồ sơ task, test đỏ là đỏ
- 👀 **Con mắt thứ hai** — `pm_dispatch kind=audit` mở một hội thoại Antigravity audit độc lập, chỉ đọc, không được sửa file
- 📄 **Báo cáo nghiệm thu** — xuất `report.md` có nhúng ảnh, bảng bằng chứng và toàn bộ lịch sử
- 🔒 **Khoá phiên chỉ ở trong RAM** — không ghi ra file, không lọt vào log hay câu trả lời
- 🎯 **Giao đúng repo** — giải project id từ sổ đăng ký của Antigravity, rồi vẫn kiểm lại workspace thật của hội thoại như lưới an toàn
- 🧩 **Đa project** — mỗi project khai `testCommand`, `auditCommands`, cách chụp ảnh, file luật của riêng nó

## 🚀 Bắt đầu nhanh

### Yêu cầu

1. **Google Antigravity** đã cài, và project cần làm **đã từng được mở trong đó một lần** (macOS/Linux)
2. **Node.js 20+**
3. **Claude Code** (hoặc client MCP khác)

> ⚠️ Project phải **đã từng được mở trong Antigravity một lần** để nó tự đăng ký vào `~/.gemini/config/projects/`. Server lấy project id từ sổ đăng ký đó để mở hội thoại đúng chỗ (`new-conversation` bắt buộc có project id). Chưa đăng ký ⇒ `pm_dispatch` báo đỏ kèm danh sách project đang có.

### Cài đặt

```bash
git clone https://github.com/ToanMobile/antigravity-pm-mcp.git
cd antigravity-pm-mcp
npm install

# tự kiểm tra đường dây
npm run doctor -- /đường/dẫn/project
```

### Nối vào Claude Code

```bash
claude mcp add antigravity-pm --scope user -- node /đường/dẫn/antigravity-pm-mcp/bin/antigravity-pm-mcp.js
```

Hoặc khai tay trong `~/.claude.json` / `.mcp.json`:

```json
{
  "mcpServers": {
    "antigravity-pm": {
      "command": "node",
      "args": ["/đường/dẫn/antigravity-pm-mcp/bin/antigravity-pm-mcp.js"]
    }
  }
}
```

### Cấu hình project

Đặt `.antigravity-pm.json` ở gốc project cần giao việc:

```json
{
  "projectName": "Geely EX2",
  "defaultModel": "pro",
  "testCommand": "./scripts/test.sh",
  "auditCommands": ["./scripts/verify-docs.sh", "./scripts/verify-voice-intent.sh"],
  "rulesFiles": ["AGENTS.md", "CLAUDE.md", ".claude/VOICE-RULES.md"],
  "commitPolicy": "forbid",
  "proof": {
    "require": 1,
    "defaultProvider": "xe",
    "providers": {
      "xe": { "type": "adb", "serial": "192.168.1.16:5555" },
      "mayao": { "type": "adb", "serial": "emulator-5554" },
      "man": { "type": "macos" }
    }
  }
}
```

Xem thêm trong [`examples/`](examples/) và [docs/configuration.md](docs/configuration.md).

## 🔄 Quy trình làm việc

```
PM (Claude Code)                          Engineer (Antigravity)
────────────────                          ──────────────────────
pm_task_create   ── định nghĩa DoD
pm_dispatch plan ─────────────────────▶   đọc luật, viết plan.md
                                          (CẤM sửa code)
đọc plan.md
pm_verdict plan=pass
pm_dispatch implement ────────────────▶   sửa code, tự chạy test,
                                          ghi result.json (+ ảnh)
pm_diff            ── xem code THẬT
pm_dispatch audit ────────────────────▶   audit độc lập (chỉ đọc)
pm_verdict audit / review
pm_run kind=test   ── exit code thật
pm_capture_proof   ── ảnh chạy thật
pm_accept          ── cổng chặn: đủ bằng chứng mới qua
   │
   └── thiếu / sai ⇒ pm_rework ─────▶   sửa lại (vòng +1, bằng chứng cũ bị huỷ)
```

Chi tiết từng bước và lý do: [docs/workflow.md](docs/workflow.md).

## 🛠️ Bộ tool

### Điều phối

| Tool | Việc |
| --- | --- |
| `pm_doctor` | Kiểm tra Antigravity đang chạy, `agentapi` gọi được, project đã cấu hình chưa. `ping=true` mở 1 hội thoại thử vô hại để chứng minh đường dây thông 2 chiều |
| `pm_task_create` | Mở task mới, **bắt buộc** có `definitionOfDone` kiểm chứng được |
| `pm_status` | Không `taskId`: liệt kê task. Có `taskId`: agent báo cáo chưa, hội thoại còn động tĩnh hay đã treo, còn thiếu bằng chứng gì |
| `pm_dispatch` | Giao việc: `plan` · `implement` · `audit` · `proof` · `custom` |
| `pm_message` | Gửi tin nhắn tự do vào hội thoại của task |

### Kiểm tra & nghiệm thu

| Tool | Việc |
| --- | --- |
| `pm_diff` | `git status` + `git diff` thật, đối chiếu với danh sách file agent khai |
| `pm_verdict` | Ghi kết luận `plan` / `audit` / `review` (`pass`/`fail` + findings) |
| `pm_run` | PM tự chạy `test` / `audit`, ghi **exit code thật** + log vào hồ sơ |
| `pm_capture_proof` | Lấy ảnh nghiệm thu vào hồ sơ **và trả ảnh về cho PM xem** |
| `pm_rework` | Trả việc: vòng +1, huỷ kết luận audit/review, gửi findings cho agent |
| `pm_accept` | Nghiệm thu — bị từ chối nếu thiếu bất kỳ bằng chứng nào |
| `pm_report` | Xuất báo cáo nghiệm thu markdown có nhúng ảnh |

Bảng tham chiếu đầy đủ tham số: [docs/tools-reference.md](docs/tools-reference.md).

## 🪙 Ngân sách token (thiết kế có chủ đích)

Bên dùng MCP (Claude Code) trả giá token ở 3 chỗ. Cả 3 đều được siết:

| Chỗ tốn | Chi phí | Cách siết |
| --- | --- | --- |
| Mô tả tool + schema | **~1.700 token**, trả **mọi phiên** | 12 tool (gộp `list`+`status`), mô tả 1 dòng, bỏ tham số ít dùng. Chi tiết dài nằm trong `docs/`, không nằm trong schema |
| Khối `instructions` | **~136 token**, mọi phiên | Chỉ giữ thứ không suy ra được từ tên tool (thứ tự gọi + "`result.json` là lời khai, không phải bằng chứng") |
| Kết quả trả về | theo lần gọi | **Trả con trỏ, không trả nội dung** |

Nguyên tắc "trả con trỏ, không trả nội dung":

- `pm_run`: log đầy đủ ghi ra file, trả về **6 dòng cuối khi xanh** / 40 dòng khi đỏ (đỏ mới cần chẩn đoán)
- `pm_diff`: mặc định `mode="stat"` (chỉ thống kê + đối chiếu lời khai); muốn đọc patch phải xin `mode="patch"` kèm `pathspec`, trần 20 KB
- `pm_report`: trả **đường dẫn** file; chỉ `includeMarkdown=true` mới đổ cả báo cáo vào context
- Prompt gửi cho agent (dài nhất hệ thống) **không bao giờ** quay lại context của PM — lưu vào `logs/`, chỉ trả đường dẫn
- Ảnh nghiệm thu thu nhỏ về 1.280px (~1,5k token/ảnh) — đủ đọc chữ trên màn hình xe, không hơn

Một task đi hết 7 giai đoạn (không có vòng trả việc) tốn khoảng **4–6k token** phía PM, phần lớn là 1 ảnh nghiệm thu + đoạn diff thật sự cần đọc.

## 📁 Hồ sơ task

Mỗi task là một thư mục trong project đích — đọc được, dán được, commit được nếu muốn:

```
<project>/.antigravity-pm/tasks/T0001-them-cong-chan-kinh/
├── task.json          # trạng thái, kết luận, lần chạy, ảnh, lịch sử
├── brief.md           # yêu cầu PM giao + định nghĩa hoàn thành
├── plan.md            # agent viết (giai đoạn PLAN)
├── result.json        # agent báo cáo theo hợp đồng
├── audit-agent.json   # auditor độc lập báo cáo (nếu có)
├── report.md          # báo cáo nghiệm thu
├── logs/              # prompt đã gửi + log test/audit đầy đủ
└── proof/             # ảnh nghiệm thu
```

## 🔒 Bảo mật

- Khoá phiên loopback của IDE **chỉ nằm trong RAM**; cache chỉ lưu `pid` + cổng (`~/.antigravity-pm/ls.json`)
- Mọi chuỗi trả về đều đi qua bộ che (`redact`) trước khi tới model
- Chỉ nói chuyện với `127.0.0.1` — không có đường ra mạng ngoài
- Mặc định `commitPolicy: "forbid"`: prompt cấm agent `git commit` / `push` / `reset --hard`
- Server **chỉ đọc** CSDL hội thoại bằng `stat` (không mở nội dung hội thoại của bạn)

Chi tiết: [.github/SECURITY.md](.github/SECURITY.md).

> **Không có Docker image** — và đó là cố ý: server phải chạy **cùng máy** với IDE Antigravity để nói chuyện với language server qua loopback. Trong container thì không thấy tiến trình IDE.

## 🧪 Phát triển

```bash
npm test                  # 40 test, không cần Antigravity, không cần mạng
npm run test:coverage
npm run lint              # kiểm tra cú pháp mọi file
npm run doctor -- <proj>  # tự kiểm tra đường dây thật
node bin/antigravity-pm-mcp.js --tools
```

Luật bất biến của repo này (đọc trước khi sửa): [AGENTS.md](AGENTS.md).

## 📚 Tài liệu

- [Bắt đầu](docs/getting-started.md)
- [Quy trình 7 giai đoạn](docs/workflow.md)
- [Cấu hình](docs/configuration.md)
- [Tham chiếu tool](docs/tools-reference.md)
- [Xử lý sự cố](docs/troubleshooting.md)
- [Changelog](CHANGELOG.md)

## ⚠️ Giới hạn đã biết

- `agentapi` là CLI **nội bộ** của Antigravity (bản 2.12.x), Google không tài liệu hoá — bản mới có thể đổi giao diện. Khi đổi, `src/agentapi.js` là chỗ duy nhất cần sửa và nó sẽ **nổ to** chứ không âm thầm bỏ qua.
- Project phải **đã từng được mở trong Antigravity** để có mặt trong sổ đăng ký `~/.gemini/config/projects/`; sau đó không cần IDE mở sẵn project đó nữa vì hội thoại được mở theo project id. Muốn bỏ qua sổ đăng ký thì khai thẳng `antigravity.projectId`.
- Tin nhắn gửi bằng `send-message` có thể chỉ được agent đọc ở **lượt kế tiếp**; nếu 5–10 phút không thấy động tĩnh, mở Antigravity xem có đang chờ bấm Accept không (`pm_status` sẽ cảnh báo "có thể đang treo").
- macOS/Linux. Chưa thử trên Windows.

## 📄 Giấy phép

MIT — xem [LICENSE](LICENSE).
