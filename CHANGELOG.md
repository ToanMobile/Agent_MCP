<!-- markdownlint-disable-file MD024 -->

# Changelog

Mọi thay đổi đáng kể của repo này được ghi ở đây.

Định dạng theo [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
phiên bản theo [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

- **Cổng "thay đổi phải kèm file test" đo theo COMMIT GỐC của task, không chỉ `git status`**
  (13/09/2026). `createTask` ghi `baseCommit = HEAD` lúc giao việc; file thay đổi = cây làm việc ∪
  `git diff --name-only baseCommit..HEAD`; task cũ chưa có `baseCommit` thì lấy commit cuối trước
  `createdAt`. `pm_diff` in thêm phần đã commit kể từ commit gốc. Lý do đo được: T0008 (Geely EX2)
  code + test đã vào commit cùng bản phát hành trước khi `pm_accept` ⇒ cây sạch ⇒ cổng báo
  "0 file thay đổi" dù test có thật. Test: `tests/base-commit.test.js`.
- **Đổi vai: PM lập kế hoạch, Antigravity phản biện rồi thực thi** (chủ dự án chốt 12/09/2026).
  Lý do: phạm vi công việc không nên để model yếu hơn quyết định — đo được trong một vòng thật, kế hoạch
  do agent viết trung thực nhưng chỉ phủ 3/7 cổng QA của project và đo bằng kết quả Gradle `UP-TO-DATE`.
  - Tool mới `pm_plan`: PM ghi `plan.md` (`content` hoặc `file`). Ghi lại kế hoạch ⇒ **huỷ** `plan-review.json`
    và kết luận plan cũ.
  - `pm_dispatch kind=plan` **bỏ**, thay bằng `kind=plan_review`: mở hội thoại riêng chỉ đọc, mang toàn văn
    kế hoạch, yêu cầu agent **bác bỏ** và cho phép nói "không tìm ra chỗ sai", ghi `plan-review.json`.
  - `pm_verdict kind=plan verdict=pass` **bị chặn** khi chưa có `plan-review.json` mới hơn `plan.md`:
    không ai tự duyệt kế hoạch của chính mình khi chưa nghe phản biện.
  - `pm_dispatch kind=implement` nay **tự mở hội thoại làm việc** nếu chưa có, và tin nhắn mang toàn văn
    kế hoạch của PM (agent chưa từng thấy nó).
  - Bỏ `buildPlanPrompt` và `buildPlanReworkMessage` — agent không còn viết hay viết lại kế hoạch.
  - Luật "liệt kê nơi đang dùng trước khi đổi API chung" chuyển từ prompt lập kế hoạch sang ràng buộc
    lúc thực thi. 10 test mới cho luồng này.

### Added

- **Sáu luật lấy từ `AGENTS.md` của project thật nay nằm thẳng trong hợp đồng prompt** (`src/prompt.js`),
  không phụ thuộc project có khai `rulesFiles` hay không: (1) cấm bịa — số/version/URL/tên lỗi/`file:dòng`
  phải lấy từ lệnh đã chạy, câu phủ định phải search trước, không biết thì nói thẳng; (2) sửa lỗi phải có
  **oracle đỏ → xanh** (thêm trường `oracle` vào `result.json`, đọc được cả báo cáo cũ không có trường này);
  (3) cấm sửa test cho xanh; (4) không chạy test nào ≠ xanh (`UP-TO-DATE`, `No tests found`) và phải ghi số
  pass/fail/skipped; (5) đổi signature/API dùng chung thì phải liệt kê nơi đang dùng **trước**, kể cả thư mục
  test; (6) sửa cùng một file đến lần thứ 3 mà không có bằng chứng mới thì dừng và báo PM. 6 test mới khoá
  từng luật. Cổng nghiệm thu **chưa** siết theo `oracle` — task đang chạy dở ở project khác không bị vỡ.

- **Hai luật bắt buộc của chủ dự án, cưỡng chế trong cổng nghiệm thu** (`mustHave`, [`src/policy.js`](src/policy.js)) —
  không còn phụ thuộc việc PM có gõ vào `definitionOfDone` hay không:
  1. `mustHave.testChange` (mặc định **bật**): thay đổi phải **kèm file test**. Danh sách file thay đổi được đo bằng
     `git status` ngay lúc `pm_accept`; không đọc được git ⇒ báo `CHUA XAC MINH` và **chặn**.
  2. `mustHave.proofFrom`: ảnh nghiệm thu phải chụp từ provider thiết bị thật. GeelyEx2 đặt `["xe", "mayao"]` ⇒
     ảnh màn hình máy hoặc ảnh agent tự đưa không được tính.
  Cả hai luật được nhắc thẳng cho agent trong prompt (`mustHaveLines`), và `pm_doctor` in ra luật đang hiệu lực.

### Added

- **Cấu hình chung `~/.antigravity-pm.json`** cho mọi project: mặc định → cấu hình chung → cấu hình project.
  Object gộp theo khoá (`proof.providers`), mảng thay thế hẳn (`rulesFiles`, `auditCommands`). `pm_doctor` in
  riêng hai dòng để biết giá trị đến từ đâu; `ANTIGRAVITY_PM_GLOBAL_CONFIG` trỏ sang file khác. File cấu hình
  chung **không** bị tính là gốc project, nên repo nằm dưới `$HOME` không bị kéo gốc về `$HOME`.
  `projectName` / `antigravity.projectId` ở tầng chung bị bỏ qua kèm cảnh báo (là khoá của riêng từng project),
  và file cấu hình hỏng JSON nay cảnh báo nêu tên file thay vì âm thầm bỏ qua. Mẫu:
  [`examples/antigravity-pm.global.json`](examples/antigravity-pm.global.json). 8 test mới.

### Added

- **Cấu hình 2 tầng** (do một phiên song song thêm vào cùng cây làm việc): `~/.antigravity-pm.json` làm mặc định
  chung cho mọi project, `<project>/.antigravity-pm.json` ghi đè. Object gộp theo khoá (ví dụ `proof.providers`),
  mảng thì thay thế hẳn để project bỏ được một mục mà cấu hình chung khai. Cảnh báo khoá lạ nói rõ nằm ở file nào.
  *Chưa có tài liệu trong `docs/configuration.md`.*

### Fixed

- **Đường bác kế hoạch dẫn agent đi code sớm**: `pm_verdict kind=plan verdict=fail` chỉ nhắc dùng `pm_rework`,
  mà `pm_rework` lại đặt giai đoạn thành `IMPLEMENT` và gửi tin nhắn đòi `result.json` phase `IMPLEMENT` —
  tức bảo Gemini bắt đầu viết code khi kế hoạch **chưa** được duyệt. Nay `pm_rework` bị **chặn** nếu kế hoạch
  chưa duyệt, và `verdict=fail` ở `kind=plan` tự gửi `buildPlanReworkMessage`: viết lại `plan.md`, **vẫn cấm sửa
  code**, báo cáo `phase: "PLAN"`, không tăng vòng.
- `pm_dispatch kind=audit` nay đặt giai đoạn `AUDIT` (trước đó task vẫn hiện `IMPLEMENT` suốt lúc đang audit).
- Gợi ý "Buoc tiep" còn gọi tên tool cũ `pm_task_status` sau khi gộp thành `pm_status`.

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
- **51 test** chạy offline, không cần Antigravity và không cần thiết bị.

### Security

- Khoá phiên loopback của IDE chỉ nằm trong RAM; cache chỉ lưu `pid` + cổng.
- Mọi chuỗi trả về model đi qua bộ che trước khi rời server.
- Chỉ nói chuyện với `127.0.0.1`; CSDL hội thoại chỉ được `stat`, không mở nội dung.
- `commitPolicy: "forbid"` mặc định: prompt cấm agent `git commit` / `push` / `reset --hard`.
