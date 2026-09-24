<!-- markdownlint-disable-file MD024 -->

# Changelog

Mọi thay đổi đáng kể của repo này được ghi ở đây.

Định dạng theo [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
phiên bản theo [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

- Prompt phản biện kế hoạch và prompt audit luôn liệt kê `.agents/context/essentials.md`, `profile-rules.md`, `rules-index.md` của DevKit (khi file tồn tại), kể cả khi project tự khai `rulesFiles`. `AGENTS.md` chỉ `@`-import các file này; Antigravity đọc `AGENTS.md` như văn bản thường nên có thể bỏ qua import.

### Fixed

- **Ảnh nghiệm thu không còn screencap vào serial adb đã chết.** `pm_capture_proof` đọc `adb devices` trước. Serial `ip:cổng` chỉ được `adb connect` ngắn; không online thì mở `provider.avd`, chuyển provider web, hoặc chạy `provider.launch`. Máy trong denylist không bị lấy làm máy thay thế.

### Security

- **`task.json` ra khỏi repo** (23/09/2026): lưu ở `~/.antigravity-pm/projects/<tên>-<hash gốc>/tasks/<id>/task.json`
  (`cfg.pmTasksRoot`). Trước đây nằm cạnh `result.json` của agent trong `.antigravity-pm/` (bị `pm_diff` ẩn) nên
  agent sửa được verdicts / `runs[].evidence.ok` / round / baseCommit. Task cũ: chuyển **đúng một lần** cho mỗi project
  (sentinel `migrated.json`, bản trong repo đổi tên `task.json.migrated`); sau đó bản trong repo không bao giờ được đọc lại.
  `task.json` hỏng ⇒ báo lỗi (không coi là "không có task"). Ghi có khoá file `O_EXCL` + `rev` (an toàn giữa hai tiến trình).
- **Bản chụp cấu hình cổng theo task** (re-audit 23/09): lúc `pm_task_create` chụp `testCommand`, `testStages`,
  `auditCommands`, `proof`, `mustHave`, `oracle`, `stateDir`… vào `task.json`. Mọi tool thao tác trên task (kể cả lệnh
  PM tự chạy) dùng bản chụp — agent sửa `.antigravity-pm.json` (vd `testCommand: "true"`, `proof.require: 0`,
  `stateDir: "src"` để ẩn thay đổi) không còn tác dụng; `pm_status` cảnh báo khi cấu hình đã lệch.
- **Cổng nghiệm thu chặt hơn**: bắt buộc có lượt `pm_dispatch kind=implement`; `pm_verdict audit/review` bị từ chối trước
  lượt đó; lần chạy xanh bằng lệnh tự chọn (`pm_run command=...`) chỉ được tính khi có JUnit XML; `result.json` có mtime
  ở tương lai không được tính là mới; oracle RED "weak" (không XML) được cảnh báo.
- **Lệnh oracle không lấy từ `result.json` của agent**: `pm_run kind=oracle` bắt PM truyền `command` (lệnh agent đề xuất
  chỉ hiện ra để PM đọc).
- **Hết chèn chuỗi vào shell** ở `plan-review.js` (diff kế hoạch), `proof.js` (adb serial/đường dẫn, url Playwright),
  `worktree.js` (worktree add/remove, git apply): tất cả qua argv/biến môi trường. `JSON.stringify` không chặn được `$(...)`.
- **Tiến trình con không mồ côi**: SIGTERM/SIGINT/SIGHUP giết cả nhóm tiến trình con đang chạy trước khi server thoát.
- **`pm_rework` gửi trước, ghi sau**: gửi lỗi thì vòng không tăng — gọi lại an toàn.
- `taskId` chấp nhận `T` + ≥4 chữ số (agent tạo thư mục `T9999-x` trong repo không làm hỏng việc đánh số).
- **Không còn chèn chuỗi vào shell khi gọi git**: `pm_diff` (pathspec), `changedFilesOf`/`baseCommitOf`
  (baseCommit, createdAt) gọi `git` qua argv; baseCommit phải khớp `/^[0-9a-f]{7,40}$/`, sai khuôn ⇒ CHƯA XÁC MINH.
- **taskId phải khớp khuôn `T####-slug`** trước mọi `path.join` (chặn `../`).

### Added

- **Chín bài học điều phối đêm 13–14/09/2026 (Geely EX2) + bàn giao OfficeReader, vào thẳng công cụ** (14/09/2026):
  1. **Cấm git phá cây làm việc VÔ ĐIỀU KIỆN** (`src/prompt.js` `guardrails`): `git checkout <file>`, `checkout .`,
     `restore`, `stash`, `clean`, `reset --hard`, `reset <file>` — không còn nằm trong `if commitPolicy==='forbid'`.
     Đo được: 12/09 một agent `git restore .` xoá bản vá đã nghiệm thu của 3 task; 13/09 T0009 `git checkout`
     file của T0011 đang sửa dở. Hoàn tác = sửa tay đúng đoạn của mình.
  2. **Lỗi biên dịch ở file KHÔNG thuộc task ⇒ `blocked`, dừng, không sửa, không checkout** — luật viết 13/09
     giờ mới vào hợp đồng prompt.
  3. **Không giao song song hai task chồng lấn** (`pm_dispatch kind=implement`, `pm_plan`): phạm vi task = `files`
     PM khai trong `pm_plan` ∪ `files_changed`/`files_to_change` agent khai. Chồng file ⇒ cảnh báo; cùng đụng thư mục
     trong `mustHave.exclusiveDirs` (Geely EX2: `shared/`) ⇒ **chặn** trừ `force=true`. `pm_plan` báo trước khi
     thư mục độc quyền đang có task khác sửa.
  4. **Oracle đỏ→xanh do PM TỰ REPLAY** (`mustHave.oracle`, mặc định tắt; `pm_run kind=oracle`, `src/oracle.js`):
     `git worktree add --detach` ở `baseCommit`, chép **chỉ file test** agent đã đổi (+ `oracle.copyToWorktree`,
     vd `local.properties`), chạy `result.oracle.command` trong worktree → RED chỉ hợp lệ khi XML mới có
     failures+errors>0 (exit≠0 mà không có XML = "đỏ vì lý do khác" → không hợp lệ; test xanh trên code gốc =
     "không răng"); chạy lại trên cây thật → GREEN theo `isGreenRun`. `finally` gỡ worktree + `prune`. Cổng đòi
     khi task `type=bugfix` HOẶC agent tự khai `oracle.command`; lời khai `before/after` của agent **không** phải
     bằng chứng. Task cũ (không có trường `type`) được miễn — không chặn hồi tố task đang chạy.
     `pm_task_create` nhận `type` (`bugfix` mặc định | `feature` | `refactor` | `docs`). Dry-run thật trên GeelyEx2 T0023
    (14/09/2026): worktree thiếu lib gitignore ⇒ `copyToWorktree` nay chép được **thư mục**; test cho API mới không biên
    dịch ở code gốc ⇒ RED liệt kê ký hiệu thiếu (`red.symbols`) và nói rõ "oracle chỉ có nghĩa với test hồi quy trên API có sẵn".
  5. **`exit 0` không phải xanh — một predicate `isGreenRun` duy nhất** (`src/tasks.js`, `src/report.js`):
     `pm_run kind=test` thu **bằng chứng** (`src/evidence.js`, từ phiên OfficeReader): XML JUnit **mới hơn mốc bắt
     đầu chạy** khi project khai `testEvidence.resultsGlob`, hoặc ít nhất stdout không nói "không chạy". Bắt: Gradle
     dòng tổng kết không có `executed` (up-to-date / from-cache), **task test** `UP-TO-DATE` (neo vào task tên bắt
     đầu bằng `test`, đo trên 33 log thật: `compileDebugUnitTestKotlin UP-TO-DATE` ở lần xanh thật không bị bắt),
     `No tests found/ran`, node `tests 0`, pytest `collected 0 items`; và **lỗi bị nuốt exit code**: `BUILD FAILED`,
     `N tests completed, M failed`, `failures=N` — đo được T0023 r1 (14/09): `| tail -15` nuốt exit ⇒ `exit=0` nhưng
     `30845 tests completed, 1 failed`. Run không có `evidence` (ghi bởi bản cũ) = không xanh, nhắn chạy lại `pm_run`.
     Thêm `mustHave.testSuspectPatterns` cho mẫu riêng của project.
  6. **File rác ở gốc repo** (`fix_*.py`, `update_*.py`, `modify_*.py`, `patch_*.py`, `*_patch.*`, `*.bak`,
     `*.orig`, `*.rej`; `mustHave.strayFilePatterns`): `pm_diff`, `pm_accept`, `pm_status` **cảnh báo** (không chặn)
     — `gate()` trả thêm `warnings[]`. Đối chiếu file khai ↔ thật trong `pm_diff` đổi sang so đường dẫn chuẩn hoá
     (bằng nhau hoặc đuôi `/x`) — `includes` hai chiều từng coi `a.kt` là `Data.kt`.
  7. **Mốc cứu hộ**: `pm_dispatch kind=implement` cảnh báo khi cây có file chưa commit và `commitPolicy=forbid`
     ("không có mốc để quay về nếu agent làm mất — tạo nhánh WIP + commit mốc trước").
  8. **`pm_status nudge=true`** gửi tin đánh thức hội thoại im lâu (send-message đo 12/09 đánh thức được) — không
     đổi `round`, không đổi mốc `implementDispatchedAt`. `pm_status` gợi ý nudge khi im quá `stallMinutes`.
  9. **Task "quá phức tạp"**: prompt bắt làm bước nhỏ nhất trước thay vì từ chối cả task; `pm_task_create` sinh
     `logs/plan-template.md` có mục "Thứ tự bước NHỎ → LỚN"; `pm_plan` nhắc khi kế hoạch không có danh sách bước đánh số
     hoặc không nhắc test; `pm_rework` nhận ra agent vừa từ chối vì "quá phức tạp" và nhắc PM chia bước (bài học T0012/T0022).
  Thêm hai luật từ bàn giao OfficeReader: **file test phải là của agent** — chỉ file test nằm trong `files_changed`
  agent khai mới thoả luật "kèm file test"; khai rỗng mà cây có thay đổi ⇒ chặn (nhiều phiên dùng chung cây, không
  đếm hộ). **Thứ tự thời gian**: test xanh phải bắt đầu **sau** `mtime(result.json)` và kết thúc **sau** lần sửa cuối của
  **file thuộc task** (`files_changed` agent khai ∪ file test; không đo cả cây — phiên khác sửa song song không bắt chạy lại);
  không đo được ⇒ `CHUA XAC MINH`, chặn.
  `git status` dùng `--untracked-files=all` (thư mục mới từng bị gộp thành `src/test/` nên không khớp file khai).
  Test trong `tests/bai-hoc-14-09.test.js` + `tests/evidence.test.js`; mỗi cổng mới đã thử đột biến để chắc test đỏ đúng chỗ.

- **Ba việc chốt chất lượng 14/09/2026 (chiều):**
  - **Tách `tools.js`** (1.255 → ~1.060 dòng): `src/worktree.js` (git snapshot, file thay đổi của task, ctx cho gate, worktree
    đóng băng), `src/plan-review.js` (hash plan, delta, tình trạng phản biện — chỗ duy nhất trong đường đọc có tác dụng phụ),
    `src/dispatch-guard.js` (cổng trước khi giao). `tools.js` chỉ còn định nghĩa tool.
  - **`pm_run worktree=true` chạy thật trên GeelyEx2**: đóng băng 3 s (5 file vá + 368 file mới), Gradle 1 lớp test 12 s,
    evidence XML đúng, dọn sạch. Lộ lỗi gốc ở `util.run()`: ghép stdout bằng `chunk.toString()` từng khúc làm **ký tự UTF-8
    nhiều byte bị cắt ở ranh giới chunk** ⇒ patch `git diff` 1,4 MB có tiếng Việt hỏng, `git apply` từ chối. Nay gom Buffer,
    giải mã một lần (ảnh hưởng mọi log tiếng Việt qua `runShell`). Test 1,5 MB tiếng Việt khoá lại.
  - **`pm_ack`** — cảnh báo heuristic (guard bị xoá, assert bị xoá, khối lặp, tăng dòng, bọc cờ test, hằng vô hạn, SQL function
    trùng) nay mang **khoá ổn định `[loại:file]`** in kèm; PM xem xong gọi `pm_ack keys=[...] note="vì sao"` (note bắt buộc)
    ⇒ ẩn ở `pm_status`/`pm_diff`/`pm_accept` **trong vòng hiện tại**, chỉ đếm; sang vòng mới (code đổi) hiện lại. Ghi `history`.

- **5 đề xuất từ phiên PM Geely EX2 (T0009–T0025) + 5 đề xuất từ phiên PM project Unity (T0001–T0014)** (14/09/2026,
  `tests/de-xuat-pm-geely.test.js`, `tests/de-xuat-pm-unity.test.js`, mỗi cổng đã thử đột biến):
  - **Agent vá bằng script** (`src/lint-diff.js`): file có sẵn ở commit gốc tăng > 40 % dòng hoặc khối ≥ 50 dòng lặp y hệt ⇒
    cảnh báo; `.sql` có `create table <tên>` 2 lần ⇒ **chặn** (`create function` chỉ cảnh báo khi trùng cả chữ ký — Postgres
    cho overload). File rác gốc repo nay **chặn** mặc định (`mustHave.strayFiles: "block" | "warn"`), thêm mẫu `patch_*.sh/.rb`,
    `fix_*.sh`, `test_debug.sh`, và hợp đồng ghi nhầm root (`result.json`, `plan-review.json`, `audit-agent.json`, `plan.md`).
    Prompt: "KHÔNG vá file bằng script". Đo được: T0024 `admin-keys.html` 4689→6730 dòng, `schema.sql` `create table admin_sessions` ×2.
  - **Validator `result.json`** (`kiemKhuonResult`): `phase` ∈ PLAN|IMPLEMENT (không phân biệt hoa/thường), `summary` ≠ rỗng,
    `files_changed` là mảng, `tests.exitCode` là số nếu có, dùng `tests_run` ⇒ sai tên trường — một dòng gộp. **KHAI SAI**:
    agent khai `tests.failed=0` mà XML PM đo có failures/errors ⇒ chặn (không so `passed` — agent chạy suite lọc).
  - **`pm_capture_proof`**: `sourceFile` **thắng** `defaultProvider` (T0024 tool chạy `adb screencap` vào xe dù đã truyền ảnh;
    Unity T0008 chụp toàn màn hình cá nhân). `proofKind` ở `pm_task_create` (`device` | `browser` | `script`): task web/SQL
    nhận ảnh từ provider **type `browser`/`shell`** (lệnh PM chạy) — **không bao giờ `file`**; provider mới `browser`
    (Chrome headless `--screenshot`, `url`). `discardLabel` bỏ ảnh hỏng khỏi hồ sơ vòng này. Mỗi ảnh lưu `sha256`; **ảnh trùng
    byte** với task/vòng khác ⇒ cảnh báo (Unity T0002/T0005 cùng 1.461.725 byte).
  - **`plan_review` ổn định**: `plan_hash` (sha256 `plan.md`) đi trong prompt và phải nằm trong `plan-review.json`; khác ⇒
    `pm_verdict plan pass` chặn (T0024 r7 phản biện bản cũ). Validator `verdict ∈ ok|co_van_de`, `findings` mảng — sai ⇒
    chặn và `pm_status` **tự nhắc agent ghi lại 1 lần** cho mỗi `plan_hash`. `pm_plan` **lưu** `logs/plan-v<n>.md` +
    `plan-review-v<n>.json` thay vì xoá; `pm_dispatch plan_review focus=delta` gửi diff v(n−1)→v(n) + finding đã xử lý.
    `pm_status`: "REVIEW TREO" khi quá `stallMinutes` chưa có file; `nudge=true` ở giai đoạn PLAN nhắc hội thoại phản biện.
  - **`pm_run` cách ly**: `worktree=true` (opt-in) chạy test trong worktree đóng băng = HEAD + diff + file mới (trừ rác) +
    `oracle.copyToWorktree` — worktree mới **không có build cache** nên build lạnh; khoá build thật (GeelyEx2
    `scripts/lib/build-lock.sh`) vẫn phải nằm trong `testCommand`. `stage=<tên>` + `skipReason` **bắt buộc** chạy một stage trong
    `testStages` (bỏ cổng ngoài có lý do, vẫn có evidence) — gate qua nhưng **cảnh báo** và `report.md` ghi rõ. Log ghi
    `HEAD` + số file dirty + `startedAt`. `pm_diff` so lời khai với cây làm việc ∪ commit kể từ commit gốc (file đã commit
    từng bị báo nhầm "khai mà không sửa").
  - **Tự kiểm trích dẫn `file:dòng`** (`src/cite-check.js`): mọi `findings[].file`, `facts_checked[].evidence`,
    `dod_check[].evidence`, `notes` của `plan-review.json` / `audit-agent.json` / `result.json` được mở đúng dòng, so
    `snippet` (trường mới, additive) trong cửa sổ ±3 ⇒ nhãn `verified` / `line-off` / `not-found` / `exists` / `line-out` /
    `file-missing`. `pm_verdict plan|audit pass` **chặn** khi có `not-found` (file có, dòng code không có = bịa chắc chắn;
    Unity T0001: 20/27 trích dẫn); `file-missing` chỉ cảnh báo vì có thể chính là finding ("file không tồn tại").
    `audit-agent.json` cũ hơn lần rework/giao triển khai thì bỏ qua, không chặn hồi tố. Prompt đòi `snippet` và báo trước
    "sẽ kiểm bằng máy". **Lưu ý:** `pm_status` nay có một tác dụng phụ — tự nhắc agent ghi lại `plan-review.json` sai khuôn,
    một lần cho mỗi `plan_hash`; Antigravity đóng thì chỉ in dòng "không nhắc được".
  - **Prompt phình**: `promptPlanMaxBytes` (mặc định 12 KB, trước 24 KB) — phần dư agent đọc theo đường dẫn; dispatch cảnh
    báo prompt > 20 KB. `pm_status` đọc **đuôi** `transcript.jsonl` của Antigravity (chỉ `type` + `created_at`, không lấy
    `content` — ngoại lệ ghi ở AGENTS.md luật 6): bước cuối là `ERROR_MESSAGE` ⇒ "STREAM BỊ NGẮT" (Unity T0007: 3/6 vòng treo
    mà `stallMinutes` không thấy); mtime transcript cũng tính là động tĩnh.
  - **Phạm vi bằng máy**: `pm_plan forbidden=[...]` ⇒ chạm file cấm là **chặn cứng**; `pm_diff` cờ file mới ngoài `files`
    của plan; `pm_status` phát hiện `result.json` ghi nhầm ra gốc repo.
  - **Làm mềm guard / phá test** (heuristic, chỉ cảnh báo "PM soi tận mắt"): dòng guard (`if (`, `assert`, `throw`,
    `require(`…) bị xoá mà không thêm lại; production code bọc `if (!Application.isPlaying)` / `BuildConfig.DEBUG`; file test
    bị xoá `assert/expect`; hằng "vô hạn" (`9999`, `MAX_VALUE`) thêm vào test. Bỏ qua dòng `import`. Đo trên GeelyEx2 T0025
    (679 file): 379 ms, 9 cảnh báo đều có nghĩa.
  - Phụ: `pm_message` nhận cả `message` lẫn `content`; `pm_rework` lưu **finding chưa đóng**, `pm_status` in, review pass thì đóng.

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

- **Cấu hình chung `~/.antigravity-pm.json`** cho mọi project: mặc định → cấu hình chung → cấu hình project.
  Object gộp theo khoá (`proof.providers`), mảng thay thế hẳn (`rulesFiles`, `auditCommands`). `pm_doctor` in
  riêng hai dòng để biết giá trị đến từ đâu; `ANTIGRAVITY_PM_GLOBAL_CONFIG` trỏ sang file khác. File cấu hình
  chung **không** bị tính là gốc project, nên repo nằm dưới `$HOME` không bị kéo gốc về `$HOME`.
  `projectName` / `antigravity.projectId` ở tầng chung bị bỏ qua kèm cảnh báo (là khoá của riêng từng project),
  và file cấu hình hỏng JSON nay cảnh báo nêu tên file thay vì âm thầm bỏ qua. Mẫu:
  [`examples/antigravity-pm.global.json`](examples/antigravity-pm.global.json). 8 test mới.

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

- Bỏ cách nói dè dặt về `send-message`. Đo trên máy thật 12/09/2026: nó **đánh thức được** hội thoại đã im
  11 phút (động tĩnh trở lại sau ~1,6 giây), nên không cần bước "nhắc" nào trong quy trình.

### Fixed

- **Quá hạn giết cả nhóm tiến trình** (`run`): con chạy `detached`, hết giờ `kill(-pid, SIGKILL)` + đóng pipe,
  trả kết quả ngay khi con thoát — cháu (gradle/java) giữ pipe không còn làm treo `pm_run`. Vượt trần output thì
  giữ **đuôi** (lỗi nằm cuối log) và trả `truncated: true`.
- **Ghi task không còn đè thao tác chen giữa**: `task.json` có `rev` (compare-and-swap); `record*`/`setPhase`/
  `markRework`/`accept` đọc lại bản mới nhất và chỉ áp phần thay đổi (`updateTask`). Vd `pm_run` chờ test 3 phút
  trong lúc `pm_rework` tăng vòng: lần chạy ghi vào vòng cũ, vòng/finding/huỷ verdict của rework giữ nguyên.

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
