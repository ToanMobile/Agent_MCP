# AGENTS.md — Luật bất biến của antigravity-pm-mcp

> Repo này là **công cụ điều phối**: Claude Code (Leader/PM) giao việc cho Antigravity (Engineer),
> rồi audit / review / test / đòi ảnh nghiệm thu. Đọc file này trước khi sửa bất cứ thứ gì.

## 1. Năm luật không được vi phạm

1. **Cổng nghiệm thu không được làm mềm.** `gate()` trong [`src/tasks.js`](src/tasks.js) là lý do repo này tồn tại.
   Cấm thêm cờ bỏ qua, cấm `force` trên `pm_accept`, cấm coi "agent bảo test xanh" là bằng chứng.
   Bằng chứng duy nhất được tính: `plan.md` + PM duyệt plan + `result.json` mới + audit đạt + review đạt +
   test `exit 0` do **PM tự chạy** + đủ ảnh nghiệm thu tồn tại trên đĩa.
2. **Bằng chứng thuộc về một vòng làm.** Sau `pm_rework`, mọi kết luận audit/review, lần chạy test và ảnh của
   vòng trước **mất hiệu lực** (so bằng `round`), và `result.json` phải được ghi **sau** mốc rework
   (so bằng `mtime`, nghiêng về phía "coi là cũ" cho an toàn).
3. **Khoá phiên loopback chỉ ở trong RAM.** Không ghi ra file, không log, không trả về cho model.
   Cache chỉ được lưu `pid` + cổng. Mọi chuỗi trả ra phải đi qua `redact()`.
4. **Không nuốt exit code, không nuốt lỗi.** `run()` luôn trả exit code thật; `agentapi.js` nổ to khi CLI nội bộ
   đổi giao diện thay vì âm thầm fallback. Không có chỗ nào được biến đỏ thành xanh.
5. **Không mở nội dung hội thoại của người dùng.** CSDL hội thoại Antigravity chỉ được `stat` để đo động tĩnh.
   Muốn biết agent làm gì thì đọc `result.json` (hợp đồng) và `git diff`, không giải mã protobuf.

## 2. Kiến trúc (một vòng dữ liệu)

```
Claude Code ──MCP stdio──▶ src/server.js ──▶ src/tools.js ─┬─▶ src/agentapi.js ──▶ agentapi (CLI) ──gRPC 127.0.0.1──▶ Antigravity IDE
                                                            ├─▶ src/tasks.js   (máy trạng thái + cổng nghiệm thu)
                                                            ├─▶ src/prompt.js  (hợp đồng báo cáo)
                                                            ├─▶ src/proof.js   (ảnh nghiệm thu)
                                                            └─▶ src/report.js  (báo cáo)
                                        trạng thái ⇒ <project>/.antigravity-pm/tasks/<id>/
```

| File | Trách nhiệm duy nhất |
| --- | --- |
| `src/discover.js` | Tìm địa chỉ + khoá phiên của language server đang chạy. Chỗ duy nhất chạm vào process table. |
| `src/agentapi.js` | Chỗ duy nhất gọi CLI `agentapi`. Đổi giao diện CLI ⇒ chỉ sửa ở đây. |
| `src/tasks.js` | Máy trạng thái + `gate()`. Không I/O mạng, không gọi agent. |
| `src/prompt.js` | Soạn prompt. Mọi ràng buộc gửi cho agent nằm ở đây, không rải rác trong tools. |
| `src/proof.js` | Chụp/nhận ảnh, kiểm magic byte, thu nhỏ. |
| `src/tools.js` | Ghép tool MCP. Không chứa logic nghiệm thu — chỉ gọi `tasks.js`. |
| `src/config.js` | Cấu hình theo project. Khoá lạ ⇒ cảnh báo, không nổ. |

## 3. Quy tắc khi sửa

- **Thêm tool mới**: khai trong `TOOLS` (`src/tools.js`) với JSON Schema thuần. **Không thêm zod** — server cố ý
  không phụ thuộc zod để không vỡ khi SDK đổi version.
- **Sửa `gate()`**: phải kèm test trong [`tests/gate.test.js`](tests/gate.test.js) chứng minh trường hợp mới **bị chặn**,
  không chỉ test trường hợp qua được.
- **Test không được cần Antigravity, không được cần mạng, không được cần thiết bị.** Cả 32 test hiện tại chạy offline.
  Đường đi có gọi `agentapi` thì kiểm chứng bằng `pm_doctor ping=true` trên máy thật, không mock giả rồi tự tin.
- **Tiếng Việt không dấu trong code/prompt** (chuỗi gửi cho agent và log), **tiếng Việt có dấu trong tài liệu**.
  Lý do: prompt đi qua nhiều tầng CLI/gRPC, tránh rủi ro mã hoá; tài liệu thì người đọc.
- **Không tự tiện đổi hợp đồng `result.json`.** Đổi là làm hỏng mọi task đang chạy dở ở các project khác.
  Muốn đổi thì thêm trường mới, đọc cả dạng cũ.

## 4. Kiểm tra trước khi giao

```bash
npm test          # 32 test, phải xanh hết
npm run lint      # cú pháp mọi file
npm run doctor -- <project>   # đường dây thật (cần Antigravity đang mở)
```

## 5. Ràng buộc bên ngoài (không sửa được từ repo này)

- `agentapi` chỉ có 3 lệnh: `new-conversation`, `send-message`, `get-conversation-metadata`. **Không có** lệnh
  liệt kê hội thoại, **không có** tham số chọn workspace, **không có** trạng thái "đang chạy / đã xong".
  Mọi thiết kế ở đây là hệ quả của ba giới hạn đó.
- Workspace của hội thoại = project mà Antigravity **đang mở**. `pm_dispatch` kiểm tra và báo đỏ nếu lệch.
- `send-message` có thể chỉ được agent đọc ở lượt kế tiếp ⇒ `pm_status` phải đo động tĩnh và cảnh báo treo,
  không được hứa "đã đánh thức agent".
