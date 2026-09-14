# Cấu hình

Repo này là công cụ dùng chung. Cấu hình đọc theo **hai tầng**:

| Tầng | File | Dùng khi |
| --- | --- | --- |
| Chung (mọi project) | `~/.antigravity-pm.json` | Những thứ giống nhau ở mọi project: `commitPolicy`, `defaultModel`, cách chụp màn hình máy, `runTimeoutMs`… |
| Riêng từng project | `<project>/.antigravity-pm.json` | Những thứ chỉ project đó có: `testCommand`, `auditCommands`, `rulesFiles`, thiết bị chụp ảnh… |

Thứ tự đè lên nhau: **mặc định → cấu hình chung → cấu hình project** (project luôn thắng).

- **Object gộp theo khoá.** `proof.providers` khai `man` ở tầng chung và `may` ở tầng project ⇒ dùng được cả hai.
- **Mảng bị thay thế hẳn, không nối đuôi.** `rulesFiles`, `auditCommands` khai lại ở project ⇒ danh sách chung bị bỏ
  hoàn toàn. Cố ý như vậy: nối đuôi thì project không có cách nào **bỏ** một mục mà tầng chung đã khai.
- Đường dẫn tương đối trong cấu hình chung (`rulesFiles`, `stateDir`) tính theo gốc **của từng project**, không phải
  theo `$HOME`.
- Không có tầng chung thì mọi thứ chạy y như cũ. `pm_doctor` in ra cả hai dòng để biết giá trị đến từ đâu.
- **`projectName` và `antigravity.projectId` bị bỏ qua ở tầng chung** (kèm cảnh báo trong `pm_doctor`): hai khoá đó
  là của riêng từng project, để ở tầng chung thì mọi project bị đặt cùng tên / trỏ về cùng một workspace.
- File cấu hình **hỏng JSON** ⇒ cảnh báo nêu tên file rồi bỏ qua cả file đó, không âm thầm nuốt lỗi.

> `~/.antigravity-pm.json` **không** bị tính là gốc project: một repo nằm dưới `$HOME` mà chưa khai cấu hình riêng
> vẫn lấy gốc theo `.git` của chính nó.

## Toàn bộ khoá

| Khoá | Mặc định | Ý nghĩa |
| --- | --- | --- |
| `projectName` | tên thư mục | Chỉ để báo cáo cho dễ đọc |
| `defaultModel` | `"pro"` | Model Antigravity: `flash_lite` \| `flash` \| `pro` |
| `stateDir` | `".antigravity-pm"` | Thư mục lưu hồ sơ task, tính từ gốc project |
| `rulesFiles` | `["AGENTS.md", "CLAUDE.md"]` | File luật **bắt buộc agent đọc**; file không tồn tại thì bị bỏ qua im lặng (không nhét vào prompt) |
| `testCommand` | `null` | Lệnh test thật. **Chưa khai thì `pm_run kind=test` báo lỗi** ⇒ cổng nghiệm thu không bao giờ đạt |
| `auditCommands` | `[]` | Các cổng chặn / lint / verify của project, chạy tuần tự bằng `pm_run kind=audit` |
| `commitPolicy` | `"forbid"` | `forbid` ⇒ prompt cấm agent `git commit` / `push` / `reset --hard`. Giá trị lạ tự về `forbid` |
| `runTimeoutMs` | `900000` | Hạn cho mỗi lệnh test/audit (15 phút) |
| `stallMinutes` | `12` | Im lâu hơn mức này thì `pm_status` cảnh báo "có thể đang treo" |
| `proof.require` | `1` | Số ảnh nghiệm thu tối thiểu **mỗi vòng làm** |
| `proof.defaultProvider` | `null` | Provider dùng khi `pm_capture_proof` không chỉ định. Nếu chỉ khai đúng 1 provider thì tự chọn cái đó |
| `proof.providers` | `{}` | Khai cách chụp, xem dưới |
| `proof.maxWidth` | `1280` | Thu nhỏ ảnh về chiều ngang này (dùng `sips`) |
| `testEvidence.resultsGlob` | `[]` | Glob XML JUnit để `pm_run kind=test` **đếm test thật** (chỉ XML có mtime ≥ lúc bắt đầu chạy). Android/Gradle: `["**/build/test-results/**/TEST-*.xml"]`. Rỗng = chỉ có stdout (bằng chứng `weak`) |
| `oracle.copyToWorktree` | `[]` | File **hoặc thư mục** (đệ quy, bỏ `build/`, `.gradle/`) chép vào worktree khi `pm_run kind=oracle` / `worktree=true`: `local.properties`, keystore, **lib nhị phân bị gitignore** (GeelyEx2: `CarConnect/app/libs` 47 MB — thiếu là Gradle đỏ trước khi tới test, đo 14/09/2026) |
| `testStages` | `{}` | Lệnh test theo stage, vd `{"unit": "./scripts/test-all.sh --unit"}` — dùng với `pm_run kind=test stage=unit skipReason="..."` khi cổng ngoài đỏ vì lý do ngoài code |
| `promptPlanMaxBytes` | `12000` | Trần số ký tự `plan.md` nhúng vào prompt; phần dư agent đọc theo đường dẫn. Plan 38 KB từng làm agent chết context |
| `proof.providers.<tên>.type = "browser"` | — | Chrome/Chromium headless: `binary` (tự dò nếu bỏ trống), `windowSize` (`1280,800`), `url` mặc định, `args`. Dùng cho task `proofKind: browser` |
| `antigravity.workspaceCheck` | `"strict"` | `strict` ⇒ `pm_dispatch` **thất bại** nếu hội thoại mở trong workspace khác; `warn` ⇒ chỉ cảnh báo |
| `antigravity.projectId` | `null` | Thử nghiệm, chưa chắc Antigravity tôn trọng |

Khoá lạ chỉ sinh cảnh báo trong `pm_doctor`, không làm server nổ.

## Luật bắt buộc (`mustHave`)

Hai điều kiện này **nằm trong cổng nghiệm thu**, áp cho mọi task, không phụ thuộc PM có ghi vào `definitionOfDone` hay không. Agent cũng được nhắc thẳng trong prompt.

| Khoá | Mặc định | Ý nghĩa |
| --- | --- | --- |
| `mustHave.testChange` | `true` | Thay đổi **phải kèm file test** (thêm mới hoặc sửa test hiện có). Test cũ vẫn xanh **không** chứng minh được gì về phần mới ⇒ `pm_accept` từ chối |
| `mustHave.testFilePatterns` | glob mặc định | Cách nhận diện file test. Mặc định phủ `**/src/test/**`, `**/src/androidTest/**`, `**/test/**`, `**/tests/**`, `**/__tests__/**`, `**/*Test.*`, `**/*_test.*`, `**/*.test.*`, `**/*.spec.*` |
| `mustHave.proofFrom` | `[]` | Ảnh nghiệm thu **phải** chụp bằng một trong các provider này. Rỗng = nhận mọi provider |
| `mustHave.oracle` | `false` | Task `type=bugfix` (hoặc agent tự khai `oracle.command`) phải có oracle đỏ→xanh **do PM tự replay** (`pm_run kind=oracle`). Task tạo trước khi có trường `type` được miễn |
| `mustHave.exclusiveDirs` | `[]` | Thư mục độc quyền: `pm_dispatch kind=implement` **chặn** khi task khác đang chạy cũng đụng vào (vd `["shared/"]`), trừ `force=true` |
| `mustHave.testSuspectPatterns` | `[]` | Regex thêm để coi một lần test là "chưa chạy thật" dù `exit 0` (bộ mặc định: `src/evidence.js`) |
| `mustHave.strayFilePatterns` | `fix_*.py`, `update_*.py`, `modify_*.py`, `patch_*.{py,sh,rb}`, `fix_*.sh`, `update_*.sh`, `*_patch.*`, `*.bak`, `*.orig`, `*.rej`, `test_debug.sh`, `result.json`, `plan-review.json`, `audit-agent.json`, `plan.md` | File rác agent hay để lại ở **gốc** repo (kể cả hợp đồng ghi nhầm chỗ) |
| `mustHave.strayFiles` | `"block"` | `block` ⇒ `pm_accept` từ chối khi còn file rác; `warn` ⇒ chỉ cảnh báo |

```json
{
  "mustHave": {
    "testChange": true,
    "proofFrom": ["xe", "mayao"],
    "oracle": true,
    "exclusiveDirs": ["shared/"]
  },
  "testEvidence": { "resultsGlob": ["**/build/test-results/**/TEST-*.xml"] }
}
```

Với cấu hình trên (GeelyEx2 đang dùng): ảnh chụp bằng `man` (màn hình máy) hay ảnh agent tự đưa (`sourceFile` ⇒ provider `file`) **không được tính** — phải là ảnh chụp từ đầu xe hoặc máy ảo.

Danh sách file thay đổi được đo bằng `git status --untracked-files=all` **ngay lúc gọi** `pm_accept` ∪ các commit kể từ `baseCommit` của task. Không đọc được git (project không phải repo) ⇒ cổng chặn báo `CHUA XAC MINH duoc co file test nao thay doi` và **không** cho qua — nghiêng về phía chặn, không phía tin.

**File test phải là của agent** (14/09/2026): chỉ file test nằm trong `files_changed` agent khai mới được tính — cây làm việc dùng chung nhiều phiên, file test của phiên khác không chứng minh gì cho task này. Agent khai `files_changed` rỗng mà cây có thay đổi ⇒ chặn, không đếm hộ.

**Thứ tự thời gian** (14/09/2026): lần test xanh phải **bắt đầu sau** `mtime(result.json)` và **kết thúc sau** lần sửa cuối của **file thuộc task** (file agent khai trong `files_changed` ∪ file test đang thay đổi — không đo cả cây, vì phiên khác sửa repo song song sẽ bắt chạy lại test vô ích; chủ dự án chốt 14/09/2026). Test chạy trước khi agent báo cáo ⇒ chặn, nhắn chạy lại `pm_run kind=test`.

**`exit 0` không phải xanh** (14/09/2026): mỗi lần `pm_run kind=test` ghi kèm `evidence` (`src/evidence.js`). Chỉ `isGreenRun` = `exit 0` + không quá hạn + `evidence.ok` mới được tính. Bắt: Gradle không task nào `executed` (up-to-date / from-cache), task **test** `UP-TO-DATE`, `No tests found`, và lỗi bị **nuốt exit code** (`BUILD FAILED`, `N tests completed, M failed`, `failures=N` mà vẫn exit 0 — đo được T0023 r1 trên Geely EX2). Run không có `evidence` (ghi bởi bản cũ) = không xanh.

`pm_doctor` in ra luật đang hiệu lực:

```
LUAT BAT BUOC — thay doi phai kem file test: CO · anh phai chup tu: xe hoac mayao
  · oracle do->xanh PM tu replay: CO (task bugfix) · thu muc doc quyen (khong giao song song): shared
  · bang chung test: XML JUnit **/build/test-results/**/TEST-*.xml · file chep vao worktree oracle: (khong)
```

## Cách chụp ảnh nghiệm thu

### `adb` — chụp từ thiết bị Android / đầu xe / máy ảo

```json
{ "type": "adb", "serial": "192.168.1.16:5555", "adb": "adb", "timeoutMs": 60000 }
```

Chạy `adb exec-out screencap -p`. `serial` bỏ trống ⇒ thiết bị duy nhất đang nối. Ghi đè tại chỗ gọi: `pm_capture_proof { serial: "emulator-5554" }`.

### `macos` — chụp màn hình máy

```json
{ "type": "macos", "region": "0,0,1440,900" }
```

`region` dạng `x,y,w,h` (bỏ trống = toàn màn hình), `window` = id cửa sổ. Lần đầu macOS sẽ hỏi quyền Screen Recording cho tiến trình chạy MCP.

### `shell` — lệnh tuỳ ý

```json
{ "type": "shell", "command": "npx playwright screenshot http://localhost:5173 {{out}}" }
```

`{{out}}` được thay bằng đường dẫn file đích. Lệnh chạy với `cwd` = gốc project. Exit code khác 0, hoặc file sinh ra không phải PNG/JPEG ⇒ **báo lỗi thẳng**, không nhận làm bằng chứng.

### `file` — nhận ảnh agent đã chụp

Không cần khai trong config:

```
pm_capture_proof { taskId, label: "...", sourceFile: "/duong/dan/anh.png" }
```

## Kiểm tra ảnh

| Kiểm | Xử lý |
| --- | --- |
| Magic byte không phải PNG/JPEG | Từ chối, in 200 byte đầu để biết lệnh đã in ra cái gì |
| Nhỏ hơn 8 KB | Nhận nhưng **cảnh báo** "rất có thể màn hình đang tắt/trắng" |
| Rộng hơn `proof.maxWidth` | Thu nhỏ bằng `sips` |
| Base64 vượt ~1,2 MB | Thu nhỏ tiếp về 900px rồi 640px để nhét được vào khối ảnh MCP |

## Biến môi trường

| Biến | Việc |
| --- | --- |
| `ANTIGRAVITY_PM_PROJECT` | Project mặc định khi tool không truyền `project` |
| `ANTIGRAVITY_PM_AGENTAPI` | Trỏ tới binary `agentapi` khác (khi Antigravity cài chỗ lạ) |
| `ANTIGRAVITY_PM_QUIET` | `1` ⇒ tắt log stderr |
| `ANTIGRAVITY_PM_GLOBAL_CONFIG` | Trỏ cấu hình chung sang file khác thay cho `~/.antigravity-pm.json` |

Server tự dò địa chỉ language server của IDE đang chạy; nếu MCP được khởi động **từ trong terminal của Antigravity** thì nó dùng luôn biến môi trường mà IDE đã bơm vào.

## Gốc project được tìm thế nào

1. Đi lên từ đường dẫn truyền vào, tìm thư mục có `.antigravity-pm.json` (bỏ qua chính file cấu hình chung)
2. Không có thì tìm thư mục có `.git`
3. Không có nữa thì dùng chính đường dẫn đó

Nhờ vậy truyền `project` là một thư mục con sâu trong repo vẫn ra đúng gốc.
