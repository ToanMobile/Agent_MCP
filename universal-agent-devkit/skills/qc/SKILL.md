---
name: qc
description: "Chạy lint, unit test và QA gate cho dự án. Phát hiện build tool trước (Gradle, npm/pnpm/yarn, pytest, go, cargo, xcodebuild, dotnet); các mục ktlint/Metalava/Translation gate chỉ dành cho dự án Android/Gradle."
---

# Quality Control (QC) & Automated Testing

Skill tự động hóa quy trình kiểm thử chất lượng, kiểm tra cú pháp code (linting), unit tests, tính tương thích API (Metalava), độ phủ bản dịch đa ngôn ngữ và chạy production QA gates cho dự án Target Project / Codebase.

## 0. Phát hiện build tool (chạy trước, mọi dự án)

Các mục 1–5 bên dưới là lệnh **Android/Gradle**. Với dự án khác, xác định build tool từ file ở gốc
repo rồi chạy lệnh test/lint tương ứng — không chạy `./gradlew` trên dự án không có Gradle:

| File ở gốc repo | Test | Lint / static check |
|---|---|---|
| `gradlew`, `build.gradle(.kts)` | `./gradlew testDebugUnitTest` (mục 1–5) | `./gradlew ktlintCheck detekt` |
| `package.json` | `npm test` (hoặc `pnpm test` / `yarn test` theo lockfile) | `npm run lint` nếu script tồn tại |
| `pyproject.toml`, `setup.cfg`, `pytest.ini` | `pytest -q` | `ruff check .` nếu có cấu hình |
| `go.mod` | `go test ./...` | `go vet ./...` |
| `Cargo.toml` | `cargo test` | `cargo clippy -- -D warnings` |
| `*.xcodeproj`, `*.xcworkspace`, `Package.swift` | `xcodebuild test -scheme <scheme> -destination '<dest>'` hoặc `swift test` | `swiftlint` nếu có cấu hình |
| `*.sln`, `*.csproj` | `dotnet test` | `dotnet format --verify-no-changes` |

Nếu có nhiều build tool (monorepo) thì chạy theo module bị đổi. Không tìm thấy build tool → báo rõ
"không xác định được lệnh test", không claim PASS.

## 1. Quick Verification (Module-scoped, Android/Gradle)

Chạy kiểm tra nhanh cho module đang chỉnh sửa trước khi commit:

```bash
# 1. Kiểm tra định dạng code (ktlint)
./gradlew :<module>:ktlintCheck

# 2. Biên dịch source và test source set
./gradlew :<module>:compileDebugKotlin :<module>:compileDebugUnitTestKotlin

# 3. Chạy unit tests của module (Kotest FunSpec / JUnit)
./gradlew :<module>:testDebugUnitTest --tests "*<TestClass>*"

# 4. Kiểm tra tương thích API Metalava (với các thư viện public :libs:*)
./gradlew :libs:<library_module>:metalavaCheckCompatibilityRelease
```

## 2. Translation & Localization Verification

Đảm bảo mọi chuỗi giao diện mới có mặt đầy đủ ở toàn bộ các ngôn ngữ/locale được dự án hỗ trợ, không bị thiếu hoặc fallback sai:

```bash
# Kiểm tra thiếu bản dịch (Fail-closed build gate)
./gradlew :<localization_module>:checkMissingTranslations
```

## 3. Unit-Test Identity Contract Baseline (nếu dự án có `scripts/qa/`)

Xác thực tính liên tục của bộ test (không cho phép âm thầm xóa/bỏ qua test):

```bash
# Xác thực danh sách test của module khớp với baseline hợp đồng
python3 scripts/qa/ci/validate_unit_test_evidence.py validate \
  --module :<module> \
  --baseline scripts/qa/contracts/unit_test_identity_baseline.tsv \
  --results <module_path>/build/test-results/testDebugUnitTest
```

## 4. Project-wide Quality Checks

Chạy kiểm thử toàn bộ dự án:

```bash
# Chạy toàn bộ ktlint
./gradlew ktlintCheck

# Chạy toàn bộ unit test
./gradlew testDebugUnitTest

# Kiểm tra Detekt tĩnh
./gradlew detekt
```

## 5. Production Release QA Gate (nếu dự án có `scripts/qa/`)

Chạy production gate chính thức phục vụ release verification:

```bash
# Chạy orchestrator QA đầy đủ (mở dashboard + gate)
python3 scripts/qa/orchestrators/qa.py

# Hoặc xác minh các pre-release gates tự động
bash scripts/qa/ci/verify_prerelease_gates.sh
```

## 6. Quy chuẩn kết quả (Evidence Standards)

- **Proof of PASS (Gradle)**: Đọc trực tiếp từ file XML `<module>/build/test-results/**/TEST-*.xml`:
  `tests > 0` AND `failures = 0` AND `errors = 0`.
- **Proof of PASS (build tool khác)**: output thật của runner có số test > 0 và 0 fail
  (ví dụ `Tests: 12 passed`, `12 passed in 0.8s`, `ok  ./...`, `test result: ok. 12 passed`).
- **Cảnh báo**: Kết quả `UP-TO-DATE` hoặc `No tests found` (`total = 0`) **KHÔNG** được tính là PASS.
- Mọi lỗi fail phải được phân tích nguyên nhân gốc (Root Cause) trước khi sửa code.
