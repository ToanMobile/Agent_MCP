<!-- markdownlint-disable-file MD024 -->

# Changelog

Mọi thay đổi đáng kể của repo này được ghi ở đây.

Định dạng theo [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
phiên bản theo [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed

- **Lỗ hổng cổng nghiệm thu**: `result.json` của giai đoạn PLAN từng được tính là bằng chứng đã triển khai.
  Chuỗi lọt: agent ghi `result.json {phase:"PLAN"}` → PM duyệt plan → giao triển khai → **agent không làm gì**
  → test chạy trên code cũ vẫn xanh → chụp ảnh → `pm_accept` **đạt**. Nay `gate()` đòi `result.phase === "IMPLEMENT"`
  và mốc chặn là muộn nhất giữa *lần giao triển khai* và *lần rework*, nên báo cáo cũ không lọt. 3 test mới
  khoá đúng chuỗi này.
- Mọi đường gửi tin nhắn (`pm_message`, `pm_rework`, `dispatch proof/custom`) nay đều kèm project id như
  `dispatch implement`, không còn nửa nọ nửa kia.

### Changed

- Bỏ cách nói dè dặt về `send-message`. Đo trên máy thật 12/09/2026: nó **đánh thức được** hội thoại đã im
  11 phút (động tĩnh trở lại sau ~1,6 giây), nên không cần bước "nhắc" nào trong quy trình.

## [0.1.0] — 2026-09-12

Bản đầu tiên. Claude Code đứng vai Leader/PM giao việc cho Google Antigravity.

### Added

- **Cầu nối Antigravity**: gọi CLI nội bộ `agentapi` (`new-conversation`, `send-message`,
  `get-conversation-metadata`) qua gRPC loopback của IDE đang chạy. Tự dò địa chỉ language server
  từ process table, tự dò lại một lần khi IDE khởi động lại và cổng đổi.
- **Giải project id**: `new-conversation` bắt buộc có project id (thiếu thì server trả
  `project_id is required when providing project_env_config`). `src/projects.js` đọc sổ đăng ký
  `~/.gemini/config/projects/<uuid>.json` để ánh xạ đường dẫn project → id, khớp cả khi project
  đăng ký ở gốc monorepo còn ta làm việc trong thư mục con. `pm_doctor` in kèm chính sách tự chạy
  lệnh của project (biết trước agent sẽ tự chạy hay dừng chờ bấm Accept).
- **Máy trạng thái 7 giai đoạn** `PLAN → IMPLEMENT → AUDIT → REVIEW → TEST → PROOF → ACCEPTED`,
  hồ sơ task lưu ngay trong project đích (`.antigravity-pm/tasks/<id>/`).
- **Cổng nghiệm thu cưỡng chế** trong `gate()`: thiếu kế hoạch đã duyệt, `result.json` mới,
  kết luận audit, kết luận review, test `exit 0`, hoặc đủ ảnh nghiệm thu ⇒ `pm_accept` từ chối
  kèm danh sách cụ thể còn thiếu gì.
- **Vòng trả việc huỷ bằng chứng cũ**: `pm_rework` tăng `round`, xoá kết luận audit/review,
  và bằng chứng của vòng trước không còn được tính.
- **13 tool**: `pm_doctor` (có `ping` mở hội thoại thử vô hại), `pm_task_create`, `pm_task_list`,
  `pm_task_status`, `pm_dispatch` (plan/implement/audit/proof/custom), `pm_message`, `pm_verdict`,
  `pm_run`, `pm_diff`, `pm_capture_proof`, `pm_rework`, `pm_accept`, `pm_report`.
- **Ảnh nghiệm thu** với 4 provider (`adb`, `macos`, `shell`, `file`): kiểm magic byte, thu nhỏ bằng
  `sips`, cảnh báo ảnh dưới 8 KB (màn hình tắt), và trả ảnh về tận mắt PM qua khối ảnh MCP.
- **Đối chiếu lời khai**: `pm_diff` so `git status` thật với `files_changed` agent khai, tố giác
  file sửa ngoài phạm vi và file khai mà không sửa.
- **Hợp đồng báo cáo** trong prompt: agent phải ghi `plan.md` / `result.json` / `audit-agent.json`,
  nhờ đó PM không cần giải mã protobuf trong CSDL hội thoại của Antigravity.
- **Cấu hình theo project** `.antigravity-pm.json`: `testCommand`, `auditCommands`, `rulesFiles`,
  `commitPolicy`, `proof.providers`, `stallMinutes`; khoá lạ chỉ cảnh báo, không nổ.
- **43 test** chạy offline, không cần Antigravity và không cần thiết bị.

### Security

- Khoá phiên loopback của IDE chỉ nằm trong RAM; cache chỉ lưu `pid` + cổng.
- Mọi chuỗi trả về model đi qua bộ che trước khi rời server.
- Chỉ nói chuyện với `127.0.0.1`; CSDL hội thoại chỉ được `stat`, không mở nội dung.
- `commitPolicy: "forbid"` mặc định: prompt cấm agent `git commit` / `push` / `reset --hard`.
