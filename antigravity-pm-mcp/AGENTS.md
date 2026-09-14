# AGENTS.md — Luật bất biến của antigravity-pm-mcp

> Repo này là **công cụ điều phối**: Claude Code (Leader/PM) giao việc cho Antigravity (Engineer),
> rồi audit / review / test / đòi ảnh nghiệm thu. Đọc file này trước khi sửa bất cứ thứ gì.

## 1. Sáu luật không được vi phạm

1. **Cổng nghiệm thu không được làm mềm.** `gate()` trong [`src/tasks.js`](src/tasks.js) là lý do repo này tồn tại.
   Cấm thêm cờ bỏ qua, cấm `force` trên `pm_accept`, cấm coi "agent bảo test xanh" là bằng chứng.
   Bằng chứng duy nhất được tính: `plan.md` + PM duyệt plan + `result.json` mới + audit đạt + review đạt +
   test **xanh theo `isGreenRun`** (exit 0 + `evidence.ok`, do **PM tự chạy**, chạy **sau** khi agent báo cáo) +
   đủ ảnh nghiệm thu tồn tại trên đĩa (+ oracle do PM replay khi `mustHave.oracle`). `exit 0` suông không phải xanh.
2. **Hai luật bắt buộc của chủ dự án không được tắt ngầm** ([`src/policy.js`](src/policy.js)):
   thay đổi phải **kèm file test**, và ảnh nghiệm thu phải chụp từ **provider thiết bị thật** khi project khai
   `mustHave.proofFrom`. Không đo được danh sách file thay đổi ⇒ báo `CHUA XAC MINH` và **chặn**, không cho qua.
3. **Bằng chứng thuộc về một vòng làm.** Sau `pm_rework`, mọi kết luận audit/review, lần chạy test và ảnh của
   vòng trước **mất hiệu lực** (so bằng `round`), và `result.json` phải được ghi **sau** mốc rework
   (so bằng `mtime`, nghiêng về phía "coi là cũ" cho an toàn).
4. **Khoá phiên loopback chỉ ở trong RAM.** Không ghi ra file, không log, không trả về cho model.
   Cache chỉ được lưu `pid` + cổng. Mọi chuỗi trả ra phải đi qua `redact()`.
5. **Không nuốt exit code, không nuốt lỗi.** `run()` luôn trả exit code thật; `agentapi.js` nổ to khi CLI nội bộ
   đổi giao diện thay vì âm thầm fallback. Không có chỗ nào được biến đỏ thành xanh.
6. **Không mở nội dung hội thoại của người dùng.** CSDL hội thoại Antigravity chỉ được `stat` để đo động tĩnh.
   Muốn biết agent làm gì thì đọc `result.json` (hợp đồng) và `git diff`, không giải mã protobuf.
   **Ngoại lệ duy nhất (chủ dự án yêu cầu 14/09/2026):** `transcriptErrors()` đọc 64 KB cuối của
   `~/.gemini/antigravity/brain/<id>/.system_generated/logs/transcript.jsonl` để đếm dòng `"type":"ERROR_MESSAGE"`
   và lấy `created_at` — **không** trả về `content`. Lý do: "stream interrupted" là tín hiệu thật của agent chết
   giữa chừng mà `stallMinutes` (chỉ đếm im lặng) không bắt được.

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
| `src/projects.js` | Giải đường dẫn project → project id của Antigravity. Chỗ duy nhất đọc `~/.gemini/config/projects/`. |
| `src/agentapi.js` | Chỗ duy nhất gọi CLI `agentapi`. Đổi giao diện CLI ⇒ chỉ sửa ở đây. |
| `src/tasks.js` | Máy trạng thái + `gate()`. Không I/O mạng, không gọi agent. |
| `src/prompt.js` | Soạn prompt. **Kế hoạch do PM viết** — agent chỉ phản biện (`buildPlanCritiquePrompt`) rồi thực thi. Mọi ràng buộc gửi cho agent nằm ở đây, không rải rác trong tools. Sáu luật bắt buộc (cấm bịa, oracle đỏ→xanh, cấm sửa test cho xanh, đếm test thật, liệt kê nơi dùng, churn guard) là phần cứng của hợp đồng — sửa phải kèm test trong `tests/prompt-rules.test.js`. |
| `src/policy.js` | Luật bắt buộc (`mustHave`): nhận diện file test (phải do agent khai), provider ảnh hợp lệ, oracle, file rác gốc repo, chồng lấn task song song, câu nhắc cho agent. |
| `src/evidence.js` | Bằng chứng test phía PM: XML JUnit mới hơn mốc chạy, Gradle không `executed`, lỗi bị nuốt exit code. Chỉ đọc đĩa. |
| `src/oracle.js` | PM tự replay oracle đỏ→xanh: worktree ở `baseCommit` + file test của agent → RED, cây thật → GREEN; `finally` gỡ worktree. |
| `src/lint-diff.js` | Soi thay đổi: nhân đôi nội dung (vá bằng script), `create table` trùng, guard bị xoá / code bọc cờ test / assert bị xoá trong test. Chỉ đọc đĩa + `git show`/`git diff`. |
| `src/worktree.js` | Cây làm việc: `git status` (untracked=all, bỏ thư mục trạng thái), file thay đổi của task, ctx cho `gate()`, worktree đóng băng (HEAD + diff + file mới). |
| `src/plan-review.js` | Hash `plan.md`, diff v(n−1)→v(n), tình trạng `plan-review.json` (treo / sai khuôn — tự nhắc 1 lần / hash lệch). Chỗ duy nhất trong đường đọc có tác dụng phụ, không được nổ khi Antigravity đóng. |
| `src/dispatch-guard.js` | Cổng trước khi giao triển khai: chồng lấn task song song, cây chưa commit, file rác. |
| `src/cite-check.js` | Tự kiểm trích dẫn `file:dòng` (+ `snippet`) trong báo cáo agent: `verified` / `line-off` / `not-found`… Chỉ đọc file. |
| `src/proof.js` | Chụp/nhận ảnh, kiểm magic byte, thu nhỏ. |
| `src/tools.js` | Ghép tool MCP. Không chứa logic nghiệm thu — chỉ gọi `tasks.js`. |
| `src/config.js` | Cấu hình hai tầng (chung ở `$HOME` → project). Khoá lạ ⇒ cảnh báo, không nổ. |

## 3. Quy tắc khi sửa

- **Thêm tool mới**: khai trong `TOOLS` (`src/tools.js`) với JSON Schema thuần. **Không thêm zod** — server cố ý
  không phụ thuộc zod để không vỡ khi SDK đổi version.
- **Sửa `gate()`**: phải kèm test trong [`tests/gate.test.js`](tests/gate.test.js) (hoặc `tests/bai-hoc-14-09.test.js`)
  chứng minh trường hợp mới **bị chặn**, không chỉ test trường hợp qua được — rồi **gỡ tạm điều kiện đó** (sao chép
  file ra ngoài, không dùng git để hoàn tác) chạy lại để chắc test đỏ đúng chỗ.
- **Cấm agent phá cây làm việc là luật vô điều kiện** trong `guardrails()` (`git checkout/restore/stash/clean/reset`),
  không được đưa vào trong `if commitPolicy`. Lý do: 12–13/09/2026 hai lần agent xoá việc chưa commit của task khác.
- **Test không được cần Antigravity, không được cần mạng, không được cần thiết bị.** Toàn bộ test chạy offline (`npm test` in số hiện tại).
  Đường đi có gọi `agentapi` thì kiểm chứng bằng `pm_doctor ping=true` trên máy thật, không mock giả rồi tự tin.
- **Tiếng Việt không dấu trong code/prompt** (chuỗi gửi cho agent và log), **tiếng Việt có dấu trong tài liệu**.
  Lý do: prompt đi qua nhiều tầng CLI/gRPC, tránh rủi ro mã hoá; tài liệu thì người đọc.
- **Không tự tiện đổi hợp đồng `result.json`.** Đổi là làm hỏng mọi task đang chạy dở ở các project khác.
  Muốn đổi thì thêm trường mới, đọc cả dạng cũ.

## 4. Kiểm tra trước khi giao

```bash
npm test          # phai xanh het (offline)
npm run lint      # cú pháp mọi file
npm run doctor -- <project>   # đường dây thật (cần Antigravity đang mở)
```

## 5. Ràng buộc bên ngoài (không sửa được từ repo này)

- `agentapi` chỉ có 3 lệnh: `new-conversation`, `send-message`, `get-conversation-metadata`. **Không có** lệnh
  liệt kê hội thoại và **không có** trạng thái "đang chạy / đã xong". Mọi thiết kế ở đây là hệ quả của hai giới hạn đó.
- `new-conversation` **bắt buộc** có project id (`ANTIGRAVITY_PROJECT_ID`), nếu không server trả
  `project_id is required when providing project_env_config`. Id lấy từ sổ đăng ký
  `~/.gemini/config/projects/<uuid>.json` (`src/projects.js`) — đo được trên máy thật 12/09/2026.
  `pm_dispatch` vẫn kiểm lại workspace của hội thoại sau khi tạo, coi như lưới an toàn.
- `send-message` **đánh thức được hội thoại đang im** — đo trên máy thật 12/09/2026: hội thoại im 11 phút,
  động tĩnh trở lại sau ~1,6 giây. Vẫn giữ đo động tĩnh trong `pm_status` vì agent có thể dừng chờ bấm Accept
  khi project không đặt `EAGER`/`TURBO`.
