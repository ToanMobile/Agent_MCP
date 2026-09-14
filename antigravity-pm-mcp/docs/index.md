# Antigravity PM MCP

MCP server để **Claude Code đứng vai Leader/PM giao việc cho Google Antigravity** rồi tự audit, code review, chạy test và **đòi ảnh nghiệm thu** trước khi cho task đi qua.

Antigravity viết code. Claude Code kiểm tra và chịu trách nhiệm nghiệm thu. Cổng chặn nằm trong code, không nằm trong lời hứa của ai.

## Tính năng

- 🧭 Quy trình 7 giai đoạn cưỡng chế: `PLAN → IMPLEMENT → AUDIT → REVIEW → TEST → PROOF → ACCEPTED`
- 🚧 Cổng nghiệm thu trong code: thiếu bằng chứng ⇒ `pm_accept` từ chối thẳng
- 📸 Ảnh nghiệm thu bắt buộc, trả về tận mắt PM
- 🔁 `pm_rework` huỷ sạch bằng chứng của bản code đã bị sửa
- 🕵️ Đối chiếu `git status` thật với danh sách file agent khai
- 🧪 Không nuốt exit code
- 👀 Hội thoại audit độc lập, chỉ đọc
- 🪙 Tiết kiệm context: ~1,8k token mỗi phiên, kết quả trả con trỏ thay vì nội dung
- 🎯 Giao đúng repo: giải project id từ sổ đăng ký của Antigravity
- 🧩 Dùng chung nhiều project

## Yêu cầu

- Google Antigravity đã cài, **đang mở đúng project** cần làm
- Node.js 20+
- Claude Code hoặc client MCP khác
- macOS / Linux

## Bắt đầu nhanh

```bash
git clone https://github.com/ToanMobile/Agent_MCP.git   # monorepo Agent_MCP, cong cu nay o thu muc antigravity-pm-mcp/
cd Agent_MCP/antigravity-pm-mcp && npm install
claude mcp add antigravity-pm --scope user -- node "$PWD/bin/antigravity-pm-mcp.js"
```

Rồi đọc [Bắt đầu](getting-started.md).

## Nó hoạt động thế nào

Antigravity ship kèm một CLI nội bộ `agentapi` nói chuyện với language server của IDE qua gRPC loopback. Server này dò địa chỉ đó từ tiến trình IDE đang chạy, mở hội thoại mới, gửi tin nhắn, và đọc kết quả qua **hợp đồng báo cáo** (`result.json`) mà prompt bắt agent phải ghi.

```
Claude Code ──MCP──▶ antigravity-pm ──agentapi──▶ Antigravity IDE ──▶ Gemini
     ▲                     │
     └── ảnh + exit code ──┘  (bằng chứng, không phải lời khai)
```
