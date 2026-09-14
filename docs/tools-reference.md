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
| `type` | không | `bugfix` (mặc định) \| `feature` \| `refactor` \| `docs`. `bugfix` bị đòi oracle đỏ→xanh khi `mustHave.oracle` bật |
| `proofKind` | không | `device` (mặc định: ảnh phải từ `mustHave.proofFrom`) \| `browser` \| `script` — task web/SQL/CLI: ảnh phải từ provider **type `browser` hoặc `shell`** (lệnh PM chạy), **không bao giờ** nhận ảnh agent đưa (`file`) |
| `model` | không | `flash_lite` \| `flash` \| `pro` (mặc định theo `defaultModel`) |

Tạo `<project>/.antigravity-pm/tasks/T####-<slug>/` với `task.json` + `brief.md` + `logs/plan-template.md` (mẫu kế hoạch có mục "Thứ tự bước NHỎ → LỚN" — agent hay từ chối task lớn, chia bước thì làm được). Ghi `baseCommit = HEAD` lúc tạo. Chưa giao cho ai.

`definitionOfDone` rỗng ⇒ **bị chặn ngay**: không có định nghĩa hoàn thành thì không thể nghiệm thu.

## pm_plan

| Tham số | Bắt buộc | Việc |
| --- | --- | --- |
| `taskId` | **có** | Task cần ghi kế hoạch |
| `content` | một trong hai | Nội dung `plan.md` (markdown) |
| `file` | một trong hai | Hoặc đường dẫn file PM đã soạn sẵn |
| `files` | không | **Phạm vi file** task sẽ sửa — dùng để đo chồng lấn với task đang chạy song song; `pm_diff` cờ file mới ngoài danh sách |
| `forbidden` | không | File/thư mục **cấm đụng** (đường dẫn, tiền tố thư mục hoặc glob) — chạm vào là `pm_accept` từ chối cứng |
| `notes` | không | Ghi chú vào lịch sử task |

**Kế hoạch là của PM, không phải của Antigravity.** Tool ghi `plan.md` vào hồ sơ task, đánh dấu `planAuthor: "pm"`.

Ghi lại kế hoạch (gọi `pm_plan` lần nữa) sẽ **xoá `plan-review.json` và xoá kết luận plan cũ** — bản phản biện cũ nói về một kế hoạch khác nên không còn giá trị. Thiếu cả `content` lẫn `file`, hoặc nội dung rỗng ⇒ bị chặn, không để lại `plan.md` rỗng.

Sau khi ghi, tool **nhắc** (không chặn) nếu kế hoạch không có danh sách bước đánh số hay không nhắc test, và **báo trước** nếu `files` chồng với task khác đang chạy hoặc cùng đụng thư mục trong `mustHave.exclusiveDirs` (lúc đó `pm_dispatch kind=implement` sẽ bị chặn).

Bản cũ **không bị xoá**: `plan.md` → `logs/plan-v<n>.md`, `plan-review.json` → `logs/plan-review-v<n>.json`; `planVersion` tăng, `planHash` = sha256 nội dung.

## pm_status

| Tham số | Bắt buộc | Việc |
| --- | --- | --- |
| `taskId` | không | Bỏ trống ⇒ liệt kê mọi task |
| `nudge` | không | `true` ⇒ gửi tin **đánh thức** vào hội thoại làm việc (giai đoạn PLAN: vào hội thoại phản biện) (agent im 30–60 phút là chuyện thường; `send-message` đo được là đánh thức được). Không đổi `round`, không đổi mốc giao việc |

Có `taskId` thì in (thêm 14/09/2026): trạng thái phản biện (`REVIEW TREO` / `SAI KHUON` — tự nhắc agent 1 lần / `PLAN_HASH KHONG KHOP`), tóm tắt kiểm trích dẫn, `STREAM BI NGAT` khi bước cuối transcript là `ERROR_MESSAGE`, `result.json` ghi nhầm gốc repo, danh sách **finding chưa đóng**. Ngoài ra: giai đoạn, vòng làm, id hội thoại, **thời điểm agent động tĩnh lần cuối** (và cảnh báo treo nếu im lâu hơn `stallMinutes`), `plan.md`/`result.json` có chưa và mới hay cũ, tóm tắt `result.json` (kèm `open_questions` và `blocked` nếu có), các kết luận, số lần chạy test, số ảnh, và danh sách bằng chứng còn thiếu.

## pm_dispatch

| Tham số | Bắt buộc | Việc |
| --- | --- | --- |
| `taskId` | **có** | |
| `kind` | **có** | `plan_review` \| `implement` \| `audit` \| `proof` \| `custom` |
| `notes` | không | Ghi chú PM kèm khi `kind=implement` |
| `message` | không | Nội dung (`custom`), cần chứng minh gì (`proof`), trọng tâm audit (`audit`) |
| `model` | không | Ghi đè model |
| `force` | không | Bỏ qua kiểm tra giai đoạn **và** cổng chồng lấn thư mục độc quyền |
| `focus` | không | `plan_review`: `delta` ⇒ prompt kèm diff plan v(n−1)→v(n) + danh sách finding của bản phản biện trước (agent không lặp điểm cũ); không có bản trước thì gửi bản đầy đủ |

`kind=plan_review` gửi kèm **`plan_hash`** (sha256 `plan.md`); agent phải ghi lại vào `plan-review.json`. Prompt > 20 KB ⇒ cảnh báo (agent dễ chết context).

`kind=implement` trước khi gửi: kiểm **task khác đang chạy** trên cùng cây (phạm vi = `files` PM khai ∪ `files_changed`/`files_to_change` agent khai). Chồng file ⇒ `CHU Y`; cùng đụng `mustHave.exclusiveDirs` ⇒ **chặn** trừ `force=true`. Cảnh báo thêm khi cây có file chưa commit và `commitPolicy=forbid` (không có mốc cứu hộ) và khi có file rác ở gốc repo.
| `force` | không | Bỏ qua kiểm tra giai đoạn |

- `plan_review` — **mở hội thoại phản biện riêng** (chỉ đọc) bằng project id lấy từ sổ đăng ký `~/.gemini/config/projects/` (hoặc `antigravity.projectId`). Đòi `plan.md` do PM viết đã tồn tại. Prompt: yêu cầu + **toàn văn kế hoạch của PM** + DoD + đường dẫn tuyệt đối file luật + **cấm sửa code** + hợp đồng ghi `plan-review.json`. Sau khi tạo, kiểm lại workspace thật: lệch ⇒ thất bại (khi `workspaceCheck: "strict"`) và đánh dấu task `blocked`. `kind: "plan"` cũ đã bỏ — gọi vào sẽ báo lỗi chỉ sang `pm_plan`.
- `implement` — đòi `plan.md` tồn tại **và** `verdict.plan = pass` (trừ khi `force`). Chưa có hội thoại làm việc thì bước này **mở hội thoại mới** (kèm kiểm workspace); đã có thì gửi tin nhắn. Tin nhắn mang toàn văn kế hoạch, chuyển giai đoạn sang `IMPLEMENT`.
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
| `kind` | **có** | `test` (dùng `testCommand`) \| `audit` (dùng `auditCommands`, chạy tuần tự) \| `oracle` (PM tự replay đỏ→xanh) |
| `command` | không | Ghi đè lệnh trong cấu hình (`oracle`: ghi đè `result.oracle.command`) |
| `timeoutMs` | không | Mặc định `runTimeoutMs` |
| `stage` | không | `test`: chạy một stage trong `testStages` thay vì `testCommand`; **bắt buộc** kèm `skipReason` (lý do bỏ phần còn lại) — gate qua nhưng cảnh báo, `report.md` ghi rõ |
| `worktree` | không | `true` ⇒ chạy trong worktree đóng băng (HEAD + diff + file mới, trừ rác, + `oracle.copyToWorktree`); tránh agent chạy build song song làm hỏng `build/test-results`. Opt-in: worktree mới không có build cache. Khoá build thật (vd `scripts/lib/build-lock.sh`) vẫn phải nằm trong `testCommand` |

Ghi vào hồ sơ: lệnh, **exit code thật**, `startedAt`, thời gian, có quá hạn không, đường dẫn log đầy đủ (đầu log ghi `HEAD` + số file dirty). Trả về: 6 dòng cuối khi xanh, 40 dòng khi đỏ. Chưa khai `testCommand` và không truyền `command` ⇒ **báo lỗi**, không im lặng cho qua.

`kind=test` còn ghi **`evidence`** (`src/evidence.js`): đếm XML JUnit mới hơn lúc bắt đầu chạy nếu project khai `testEvidence.resultsGlob`, hoặc ít nhất kiểm stdout không nói "không chạy"/"đỏ bị nuốt exit". `exit 0` mà `evidence.ok=false` ⇒ in `CHUA TINH` + cách sửa (`--rerun-tasks`, bỏ `| tail`/`|| true`), và cổng nghiệm thu **không** tính lần chạy đó.

`kind=oracle`: `git worktree add --detach <tmp> <baseCommit>` → chép **chỉ file test** agent đã đổi (+ `oracle.copyToWorktree`) → chạy lệnh oracle trong worktree (**RED** hợp lệ chỉ khi test đã chạy và có failures/errors; `exit≠0` không XML = "đỏ vì lý do khác"; xanh trên code gốc = "không răng") → chạy lại trên cây thật (**GREEN** theo `isGreenRun`) → `finally` gỡ worktree. **Giới hạn đo thật (GeelyEx2 T0023, 14/09/2026):** test viết cho API **mới** (`SttDecodeStep`, `VoiceLanePolicy`) không biên dịch được ở `baseCommit` ⇒ RED không hợp lệ, tool liệt kê đúng ký hiệu thiếu. Oracle chỉ có nghĩa với test **hồi quy trên API có sẵn**; fix kèm API mới thì PM đặt `type: feature` (không bị đòi oracle) hoặc yêu cầu agent viết thêm test tái hiện lỗi hành vi bằng API cũ. Chi phí thực tế: 8–21 s khi Gradle có cache, cần `oracle.copyToWorktree` chép lib nhị phân bị gitignore (`CarConnect/app/libs`). Run record `kind='oracle'` mang `oracle: {command, baseCommit, testFilesCopied, red: {…, symbols[]}, green, ok, blocked}`; log RED/GREEN đầy đủ ở `logs/oracle-r<round>-*.log`. Không có `baseCommit` / lệnh / file test để chép ⇒ `BLOCKED` kèm lý do (không phải "agent sai").

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
- `CHU Y — file rac o goc repo` ⇒ agent để lại script tạm (`fix_*.py`, `*_patch.kt`…), kiểm rồi xoá trước khi commit
- `CHAN — <file>.sql: create table trung` ⇒ agent vá bằng script làm nhân đôi định nghĩa (gate từ chối)
- `NGHI VA BANG SCRIPT / LAM MEM — …` ⇒ file tăng > 40 % dòng, khối ≥ 50 dòng lặp, guard bị xoá, code bọc cờ test, assert bị xoá trong test, hằng "vô hạn" trong test — **PM soi tận mắt**
- `CHU Y — file MOI ngoai pham vi plan` / `CHAN — dung vao file plan CAM sua` ⇒ so với `files` / `forbidden` của `pm_plan`

So khớp bằng đường dẫn chuẩn hoá (bằng nhau hoặc đuôi `/x`), không dùng `includes` — `a.kt` không còn bị coi là `Data.kt`. `git status` chạy với `--untracked-files=all` nên thấy từng file mới, không gộp thư mục.

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

Thêm (14/09/2026): `sourceFile` **thắng** `defaultProvider` (chỉ `provider` truyền rõ mới đè được); `url` cho provider `browser`; `discardLabel` bỏ ảnh cùng label khỏi hồ sơ vòng này và xoá file (gọi không kèm `label` = chỉ bỏ). Mỗi ảnh lưu `sha256`; trùng byte với ảnh của task/vòng khác ⇒ `CANH BAO: anh TRUNG BYTE` (render deterministic hợp lệ hay chụp nhầm cái cũ — PM phải biết).

## pm_rework

| Tham số | Bắt buộc | Việc |
| --- | --- | --- |
| `taskId` | **có** | |
| `findings` | **có** | Rỗng ⇒ bị chặn |
| `notes` | không | |

Vòng +1, huỷ kết luận audit/review, gửi findings cho agent kèm lời mời **phản biện có dẫn chứng**. Bằng chứng của vòng trước hết hiệu lực. Nếu `result.json` vòng trước ghi `blocked` kiểu "quá phức tạp", tool nhắc PM: findings nên là **thứ tự bước nhỏ → lớn**, giao từng bước (bài học T0012/T0022 trên Geely EX2).

## pm_accept

| Tham số | Bắt buộc | Việc |
| --- | --- | --- |
| `taskId` | **có** | |
| `summary` | không | Kết luận PM ghi vào báo cáo |

Trước khi ghi kết luận `pass` cho `plan` hoặc `audit`, tool **tự kiểm mọi trích dẫn `file:dòng`** trong `plan-review.json` / `audit-agent.json` (mở file đúng dòng, so `snippet` ±3 dòng): nhãn `verified` / `line-off` / `not-found` / `exists` / `line-out` / `file-missing`. Có `not-found` hoặc `file-missing` ⇒ **chặn** — trích dẫn code không tồn tại là báo cáo bịa. `plan` pass còn đòi `plan-review.json` đúng khuôn (`verdict` ∈ `ok|co_van_de`, `findings` mảng) và `plan_hash` khớp bản đã gửi.

Cổng chặn — tất cả phải đủ, **cùng một vòng làm**:

1. `plan.md` tồn tại
2. `verdict.plan = pass`
3. `result.json` tồn tại và ghi **sau** lần rework gần nhất
4. `verdict.audit = pass` của vòng hiện tại
5. `verdict.review = pass` của vòng hiện tại
6. Có ít nhất một lần chạy `kind=test` **xanh theo `isGreenRun`** (`exitCode = 0`, không quá hạn, **`evidence.ok`**), thuộc vòng hiện tại, **bắt đầu sau** `mtime(result.json)` và **kết thúc sau** lần sửa file cuối
7. Đủ `proof.require` ảnh của vòng hiện tại, **và file còn tồn tại trên đĩa**
8. Thay đổi kèm file test **do agent khai** trong `files_changed` (`mustHave.testChange`); ảnh từ provider thiết bị thật (`mustHave.proofFrom`)
9. `mustHave.oracle` bật + task `bugfix` (hoặc agent khai `oracle.command`): agent khai `command/before/after` **và** PM đã `pm_run kind=oracle` đạt trong vòng này
10. `result.json` đúng khuôn; không **KHAI SAI** (khai `tests.failed=0` mà XML PM đo có failures)
11. Không file rác ở gốc repo (`mustHave.strayFiles: block`); không `create table` trùng trong `.sql`; không chạm `forbidden` của plan

Thiếu ⇒ trả về `isError` kèm danh sách cụ thể, và vẫn xuất báo cáo hiện trạng. Ngoài `missing`, `gate()` còn trả `warnings` (file rác ở gốc repo) — in ra nhưng không chặn.

## pm_report

| Tham số | Bắt buộc | Việc |
| --- | --- | --- |
| `taskId` | **có** | |
| `summary` | không | |
| `includeMarkdown` | không | `true` mới đổ cả báo cáo vào context |

Xuất `report.md`: bảng bằng chứng, báo cáo của agent, findings, bảng lệnh đã chạy kèm exit code, ảnh nhúng, và toàn bộ lịch sử.
