# Quy trình 7 giai đoạn

Mục đích của quy trình: **Antigravity làm, Claude Code chịu trách nhiệm.** Không giai đoạn nào được bỏ qua bằng lời hứa — cổng chặn nằm trong code.

```
PLAN → IMPLEMENT → AUDIT → REVIEW → TEST → PROOF → ACCEPTED
                        ↖________ pm_rework (vòng +1) ________↙
```

## Giai đoạn 0 — Chuẩn bị (một lần)

```
pm_doctor { project: "/duong/dan/project" }
```

Kiểm: Antigravity đang chạy, `agentapi` gọi được, project đã khai `testCommand` + cách chụp ảnh chưa.

```
pm_doctor { project: "...", ping: true }
```

Mở một hội thoại thử vô hại (prompt chỉ yêu cầu trả lời `PONG`, cấm dùng tool, cấm sửa file) rồi gửi thêm một tin nhắn nữa. Mở Antigravity thấy `PONG` và `PONG2` ⇒ đường dây thông cả hai chiều.

> **Bắt buộc:** project phải từng được mở trong Antigravity (để có trong sổ đăng ký `~/.gemini/config/projects/`) — `new-conversation` bắt buộc có project id. `pm_doctor` in ra id đã tìm được, kèm chính sách tự chạy lệnh của project đó.

## Giai đoạn 1 — PLAN

```
pm_task_create {
  title: "Thêm xác nhận khi hạ kính",
  brief: "Hiện trạng ... Cần ... Được sửa ... CẤM sửa ...",
  definitionOfDone: ["Có unit test cho bước xác nhận", "Không đổi hành vi lệnh khác"]
}
pm_dispatch { taskId: "T0001-...", kind: "plan" }
```

`brief` càng nói rõ **phạm vi được sửa và cái gì cấm sửa** thì càng ít phải trả việc. `definitionOfDone` phải **kiểm chứng được** — "chạy ổn" không phải DoD, "test X xanh và ảnh cho thấy Y" mới là DoD.

Agent nhận prompt có: yêu cầu, DoD, đường dẫn tuyệt đối các file luật của project, lệnh **cấm sửa code** ở giai đoạn này, và hợp đồng ghi `plan.md` + `result.json`.

Theo dõi:

```
pm_status { taskId: "T0001-..." }
```

- `plan.md: co` ⇒ đọc `plan.md`, đánh giá thật (bằng `Read`, không tin `summary`)
- `im 15 phut` ⇒ có thể đang chờ bấm Accept trong Antigravity, mở IDE xem

## Giai đoạn 2 — IMPLEMENT

```
pm_verdict { taskId, kind: "plan", verdict: "pass", notes: "..." }
pm_dispatch { taskId, kind: "implement", notes: "Giữ nguyên API công khai" }
```

Plan sai thì `verdict: "fail"` + `pm_rework` kèm findings — đừng tự sửa plan hộ agent.

Agent sửa code, tự chạy test, ghi `result.json` với `files_changed`, `commands_run`, `tests`, `screenshots`.

## Giai đoạn 3 — AUDIT

Hai cách, nên dùng cả hai:

```
pm_diff { taskId }                                  # xem code THẬT
pm_dispatch { taskId, kind: "audit", message: "soi kỹ nhánh xe đang chạy" }
```

`pm_diff` đối chiếu `git status` thật với danh sách agent khai và tố giác:
- `CHU Y — thay doi KHONG duoc khai` ⇒ agent sửa file ngoài phạm vi (rủi ro hồi quy)
- `CHU Y — khai co sua nhung khong thay thay doi` ⇒ báo cáo không đúng sự thật

Hội thoại audit là **con mắt thứ hai**: chỉ đọc, cấm sửa file, ghi `audit-agent.json`. PM vẫn là người chốt.

```
pm_verdict { taskId, kind: "audit", verdict: "pass" | "fail", findings: [...] }
```

## Giai đoạn 4 — REVIEW

Đọc diff như review PR của người thật: logic sai, guard bị xoá/làm mềm, trường hợp biên, nuốt lỗi, tài liệu nói sai so với code.

```
pm_verdict { taskId, kind: "review", verdict: "pass", findings: [] }
```

## Giai đoạn 5 — TEST

```
pm_run { taskId, kind: "test" }    # lệnh trong testCommand
pm_run { taskId, kind: "audit" }   # các cổng chặn của project
```

PM **tự chạy**, không tin con số agent khai. Exit code thật + log đầy đủ vào `logs/`. Đỏ ⇒ `pm_rework`.

## Giai đoạn 6 — PROOF (ảnh nghiệm thu)

```
pm_capture_proof { taskId, label: "hộp xác nhận hiện trên xe", provider: "xe" }
```

hoặc nhận ảnh do agent tự chụp:

```
pm_dispatch { taskId, kind: "proof", message: "chụp màn hình lúc hộp xác nhận hiện ra" }
pm_capture_proof { taskId, label: "...", sourceFile: "/.../proof/xac-nhan.png" }
```

Ảnh **trả về tận mắt PM** qua khối ảnh MCP — nhìn rồi mới tin. Ảnh dưới 8 KB bị cảnh báo "rất có thể màn hình đang tắt". File không phải PNG/JPEG bị từ chối thẳng.

## Giai đoạn 7 — ACCEPTED

```
pm_accept { taskId, summary: "Đạt: đã xem ảnh và log test." }
```

Thiếu bất kỳ bằng chứng nào ⇒ **từ chối**, kèm danh sách cụ thể còn thiếu gì. Xuất báo cáo:

```
pm_report { taskId }
```

## Vòng trả việc

```
pm_rework { taskId, findings: ["VoiceService.kt:120 — quên đóng PTT khi đoạn rỗng", "thiếu test nhánh xe đang chạy"] }
```

Hậu quả (cố ý mạnh tay):

| | Sau `pm_rework` |
| --- | --- |
| `round` | +1 |
| Kết luận audit / review | **bị huỷ** |
| Test đã xanh | không còn tính (thuộc vòng cũ) |
| Ảnh nghiệm thu cũ | không còn tính |
| `result.json` cũ | bị coi là **cũ**, agent phải ghi lại |
| Kết luận plan | vẫn giữ (kế hoạch chưa bị bác) |

Vì bản code đã đổi thì bản xanh của bản code cũ **không chứng minh được gì**. Agent được quyền **phản biện** findings kèm dẫn chứng `file:dòng` — prompt nói rõ điều đó, để nó không im lặng sửa theo một findings sai.

## Việc PM không được làm

- Tự sửa code phần đã giao cho Antigravity (mất luôn tác dụng của review độc lập)
- Ghi `verdict: pass` mà chưa thực sự đọc diff
- Coi `result.json` là bằng chứng test xanh — đó là **lời khai**, `pm_run` mới là bằng chứng
- Nghiệm thu bằng ảnh dựng/vẽ lại thay vì ảnh chạy thật
