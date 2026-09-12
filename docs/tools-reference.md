# Tham chiếu tool

12 tool. Mô tả trong schema được viết ngắn nhất có thể để tiết kiệm context của bên dùng MCP — chi tiết nằm ở trang này.

Mọi tool nhận `project` (mặc định: thư mục đang làm việc, hoặc `ANTIGRAVITY_PM_PROJECT`).

## pm_doctor

| Tham số | Bắt buộc | Việc |
| --- | --- | --- |
| `project` | không | Gốc project |
| `ping` | không | `true` ⇒ mở một hội thoại thử vô hại (tốn quota Antigravity) |

In ra: cấu hình đang hiệu lực, `testCommand`, `auditCommands`, file luật sẽ nhét vào prompt, các provider ảnh, đường dẫn `agentapi`, kết nối language server, và danh sách 8 task gần nhất.

`ping=true` còn kiểm: `new-conversation` trả về id, workspace của hội thoại có khớp project không, `send-message` có gửi được vào hội thoại cũ không.

## pm_task_create

| Tham số | Bắt buộc | Việc |
| --- | --- | --- |
| `title` | **có** | Tiêu đề ngắn |
| `brief` | **có** | Hiện trạng, cần làm gì, **phạm vi được sửa**, **cái gì cấm sửa** |
| `definitionOfDone` | **có** | Danh sách điều kiện **kiểm chứng được** |
| `model` | không | `flash_lite` \| `flash` \| `pro` (mặc định theo `defaultModel`) |

Tạo `<project>/.antigravity-pm/tasks/T####-<slug>/` với `task.json` + `brief.md`. Chưa giao cho ai.

`definitionOfDone` rỗng ⇒ **bị chặn ngay**: không có định nghĩa hoàn thành thì không thể nghiệm thu.

## pm_status

| Tham số | Bắt buộc | Việc |
| --- | --- | --- |
| `taskId` | không | Bỏ trống ⇒ liệt kê mọi task |

Có `taskId` thì in: giai đoạn, vòng làm, id hội thoại, **thời điểm agent động tĩnh lần cuối** (và cảnh báo treo nếu im lâu hơn `stallMinutes`), `plan.md`/`result.json` có chưa và mới hay cũ, tóm tắt `result.json` (kèm `open_questions` và `blocked` nếu có), các kết luận, số lần chạy test, số ảnh, và danh sách bằng chứng còn thiếu.

## pm_dispatch

| Tham số | Bắt buộc | Việc |
| --- | --- | --- |
| `taskId` | **có** | |
| `kind` | **có** | `plan` \| `implement` \| `audit` \| `proof` \| `custom` |
| `notes` | không | Ghi chú PM kèm khi `kind=implement` |
| `message` | không | Nội dung (`custom`), cần chứng minh gì (`proof`), trọng tâm audit (`audit`) |
| `model` | không | Ghi đè model |
| `force` | không | Bỏ qua kiểm tra giai đoạn |

- `plan` — **mở hội thoại mới**. Prompt: yêu cầu + DoD + đường dẫn tuyệt đối file luật + **cấm sửa code** + hợp đồng ghi `plan.md`/`result.json`. Sau khi tạo, kiểm workspace: lệch ⇒ thất bại (khi `workspaceCheck: "strict"`) và đánh dấu task `blocked`.
- `implement` — đòi `verdict.plan = pass` và `plan.md` tồn tại (trừ khi `force`). Gửi tin nhắn duyệt plan + lệnh triển khai, chuyển giai đoạn sang `IMPLEMENT`.
- `audit` — mở **hội thoại thứ hai**, chỉ đọc, cấm sửa file, ghi `audit-agent.json`.
- `proof` — yêu cầu agent tự chụp ảnh vào `proof/`.
- `custom` — gửi nội dung tự do.

Prompt đã gửi luôn được lưu vào `logs/prompt-*.md`; tool chỉ trả về **đường dẫn**, không trả nội dung.

## pm_message

| Tham số | Bắt buộc | Việc |
| --- | --- | --- |
| `taskId` | **có** | |
| `content` | **có** | Nội dung |
| `toAudit` | không | Gửi vào hội thoại audit thay vì hội thoại chính |

## pm_verdict

| Tham số | Bắt buộc | Việc |
| --- | --- | --- |
| `taskId` | **có** | |
| `kind` | **có** | `plan` \| `audit` \| `review` |
| `verdict` | **có** | `pass` \| `fail` |
| `findings` | không | Mỗi phát hiện: `file:dòng` + sai gì |
| `notes` | không | |

`pass` thì tự chuyển giai đoạn (`audit` → `REVIEW`, `review` → `TEST`). Kết luận được đóng dấu **vòng làm hiện tại** — `pm_rework` sẽ vô hiệu hoá nó.

## pm_run

| Tham số | Bắt buộc | Việc |
| --- | --- | --- |
| `taskId` | **có** | |
| `kind` | **có** | `test` (dùng `testCommand`) \| `audit` (dùng `auditCommands`, chạy tuần tự) |
| `command` | không | Ghi đè lệnh trong cấu hình |
| `timeoutMs` | không | Mặc định `runTimeoutMs` |

Ghi vào hồ sơ: lệnh, **exit code thật**, thời gian, có quá hạn không, đường dẫn log đầy đủ. Trả về: 6 dòng cuối khi xanh, 40 dòng khi đỏ. Chưa khai `testCommand` và không truyền `command` ⇒ **báo lỗi**, không im lặng cho qua.

## pm_diff

| Tham số | Bắt buộc | Việc |
| --- | --- | --- |
| `mode` | không | `stat` (mặc định) \| `patch` |
| `pathspec` | không | Giới hạn đường dẫn |
| `maxBytes` | không | Trần patch, mặc định 20.000 |
| `taskId` | không | Có thì đối chiếu với `files_changed` agent khai |

Đối chiếu lời khai:

- `CHU Y — thay doi KHONG duoc khai` ⇒ agent sửa file ngoài phạm vi (rủi ro hồi quy)
- `CHU Y — khai co sua nhung khong thay thay doi` ⇒ báo cáo không đúng sự thật

## pm_capture_proof

| Tham số | Bắt buộc | Việc |
| --- | --- | --- |
| `taskId` | **có** | |
| `label` | **có** | Ảnh này chứng minh điều gì |
| `provider` | không | Tên provider trong cấu hình |
| `sourceFile` | không | Nhận ảnh có sẵn (agent tự chụp) |
| `serial` | không | Ghi đè serial adb |
| `region` | không | Vùng macOS `x,y,w,h` |

Trả về **khối ảnh MCP** để PM xem tận mắt, cộng với cảnh báo nếu ảnh dưới 8 KB. Nếu đang ở giai đoạn `TEST` thì tự chuyển sang `PROOF`.

## pm_rework

| Tham số | Bắt buộc | Việc |
| --- | --- | --- |
| `taskId` | **có** | |
| `findings` | **có** | Rỗng ⇒ bị chặn |
| `notes` | không | |

Vòng +1, huỷ kết luận audit/review, gửi findings cho agent kèm lời mời **phản biện có dẫn chứng**. Bằng chứng của vòng trước hết hiệu lực.

## pm_accept

| Tham số | Bắt buộc | Việc |
| --- | --- | --- |
| `taskId` | **có** | |
| `summary` | không | Kết luận PM ghi vào báo cáo |

Cổng chặn — tất cả phải đủ, **cùng một vòng làm**:

1. `plan.md` tồn tại
2. `verdict.plan = pass`
3. `result.json` tồn tại và ghi **sau** lần rework gần nhất
4. `verdict.audit = pass` của vòng hiện tại
5. `verdict.review = pass` của vòng hiện tại
6. Có ít nhất một lần chạy `kind=test` với `exitCode = 0`, không quá hạn, thuộc vòng hiện tại
7. Đủ `proof.require` ảnh của vòng hiện tại, **và file còn tồn tại trên đĩa**

Thiếu ⇒ trả về `isError` kèm danh sách cụ thể, và vẫn xuất báo cáo hiện trạng.

## pm_report

| Tham số | Bắt buộc | Việc |
| --- | --- | --- |
| `taskId` | **có** | |
| `summary` | không | |
| `includeMarkdown` | không | `true` mới đổ cả báo cáo vào context |

Xuất `report.md`: bảng bằng chứng, báo cáo của agent, findings, bảng lệnh đã chạy kèm exit code, ảnh nhúng, và toàn bộ lịch sử.
