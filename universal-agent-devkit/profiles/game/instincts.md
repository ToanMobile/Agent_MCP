# Instincts & Failure Memory — Repository Lessons Learned

> **Quy định Vận hành cho AI Agent:**
> Tệp này ghi nhận lại các "bẫy mã nguồn" (traps), sai lầm trong quá khứ hoặc lỗi hồi quy từng xảy ra trên codebase này.
> Trước khi sửa code hoặc đề xuất giải pháp, AI Agent BẮT BUỘC phải đọc lướt qua các bẫy dưới đây để **tuyệt đối không đi vào vết xe đổ**.
> Khi gặp một lỗi mới hoặc bài học kinh nghiệm sâu sắc, AI Agent phải tự giác cập nhật thêm một mục vào tệp này.

---

## 1. Bẫy Thường Gặp & Bài Học Kinh Nghiệm (Active Instincts)

### [INSTINCT-001] Tránh Mất Mát Mã Nguồn Do Placeholder Lười Biếng
- **Hiện tượng lỗi:** Khi chỉnh sửa file dài, agent tự động phát sinh `// ... existing code ...` hoặc `# keep existing logic`, làm bay màu các hàm xung quanh khi lưu file.
- **Nguyên nhân gốc rễ:** Model cố gắng tối ưu token đầu ra nên bỏ qua đoạn giữa.
- **Quy tắc bắt buộc:** Luôn thay thế trọn vẹn khối mã liền mạch, kiểm tra độ dài file và git diff trước khi xác nhận hoàn tất.
- **Kiểm tra tự động:** `grep -En "// \.\.\.|\/\* \.\.\.|\# \.\.\." <modified_files>` phải trả về 0 kết quả.

---

### [INSTINCT-002] Chống Đúp Request & Spam Thao Tác (Button Double-Click)
- **Hiện tượng lỗi:** Người dùng click nhanh hoặc mạng lag làm gọi API/workflow 2 lần liên tiếp, dẫn tới trùng lặp dữ liệu hoặc lỗi race condition.
- **Nguyên nhân gốc rễ:** Thiếu debounce / disable trạng thái nút bấm ngay tại millisecond đầu tiên.
- **Quy tắc bắt buộc:** Mọi nút bấm kích hoạt xử lý bất đồng bộ hoặc gọi API đều phải có biến `isLoading` / `isSubmitting` để disable nút và hiển thị indicator ngay lập tức.

---

### [INSTINCT-003] Không Tái Phát Minh Bánh Xe (Don't Reinvent The Wheel)
- **Hiện tượng lỗi:** Tạo mới `DateUtils`, `StringHelper` hay `HttpWrapper` trong khi dự án đã có sẵn module tương tự ở thư mục chung.
- **Nguyên nhân gốc rễ:** Không tìm kiếm codebase trước khi bắt tay vào code.
- **Quy tắc bắt buộc:** Luôn chạy `grep_search` hoặc graph search các từ khóa liên quan trong project để tái sử dụng tiện ích nội bộ có sẵn.

---

### [INSTINCT-004] Bảo Vệ Bí Mật Môi Trường & Dữ Liệu Nhạy Cảm
- **Hiện tượng lỗi:** Hardcode API key, password, private key hoặc token test vào mã nguồn hoặc file test.
- **Nguyên nhân gốc rễ:** Tiện tay khi debug hoặc viết test nhanh.
- **Quy tắc bắt buộc:** Luôn đọc qua biến môi trường (`process.env`, `System.getenv`) hoặc file cấu hình nằm trong `.gitignore`. Che / mask dữ liệu nhạy cảm trước khi chụp ảnh báo cáo.

---

### [INSTINCT-005] Vùng Chạm Giao Diện Dưới Chuẩn Tiếp Cận (< 48dp)
- **Hiện tượng lỗi:** Nút bấm quá nhỏ hoặc quá sát nhau khiến người dùng khó tương tác trên màn hình cảm ứng hoặc web di động.
- **Nguyên nhân gốc rễ:** Chỉ căn chỉnh theo mắt nhìn trên màn hình desktop độ phân giải cao.
- **Quy tắc bắt buộc:** Mọi phần tử click/tap phải đảm bảo kích thước tối thiểu $\ge 48\times 48\text{dp}$ ($\ge 44\times 44\text{px}$ trên Web). Khoảng cách tối thiểu giữa 2 nút liền kề $\ge 8\text{dp}$.

---

### [INSTINCT-G01] Bẫy Lệch Chuẩn API Unity 6 (Unity 6.6 API Drift)
- **Hiện tượng lỗi:** Sinh code dùng API cũ bị deprecated trong Unity 6 (như `FindObjectsOfType<T>()`, `Renderer.material` gây clone material rò rỉ, CommandBuffer thô thay vì RenderGraph).
- **Nguyên nhân gốc rễ:** Dữ liệu huấn luyện của LLM bị cutoff trước Unity 6.6.
- **Quy tắc bắt buộc:** 
  1. Dùng `Object.FindObjectsByType<T>(FindObjectsSortMode.None)` thay vì `FindObjectsOfType<T>()`.
  2. Dùng `Renderer.sharedMaterial` hoặc MaterialPropertyBlock khi đổi thuộc tính visual trong runtime, tránh gọi `.material` gây sinh clone instance làm rò rỉ VRAM.
  3. Tuân thủ chuẩn RenderGraph API khi viết custom render passes trên Universal Render Pipeline (URP).

---

### [INSTINCT-G02] Bẫy `Time.timeScale = 0` Khiến Menu Pause Bị Treo Đơ
- **Hiện tượng lỗi:** Mở Pause Menu hoặc Game Over Dialog bằng `Time.timeScale = 0;`, nhưng các hiệu ứng tween UI (DOTween / LeanTween) hoặc Coroutine mở popup bị đứng hình bất động, người dùng không thể bấm resume.
- **Nguyên nhân gốc rễ:** Tween và Coroutine mặc định chạy theo game time bị đóng băng khi `timeScale = 0`.
- **Quy tắc bắt buộc:** 
  1. Mọi tween UI chạy trong popup/pause menu bắt buộc phải set `.SetUpdate(true)` (Unscaled Time).
  2. Mọi Coroutine chạy trong UI pause bắt buộc dùng `yield return new WaitForSecondsRealtime(...)` thay vì `WaitForSeconds(...)`.

---

### [INSTINCT-G03] Bẫy Animator Controller Rỗng & State Không Có Clip
- **Hiện tượng lỗi:** Gọi `animator.Play("Attack")` hoặc `animator.SetTrigger(...)` nhưng Animator Controller bị gán rỗng (null runtimeAnimatorController) hoặc State không gắn Animation Clip, sinh NullReferenceException hoặc đơ frame nhân vật.
- **Nguyên nhân gốc rễ:** Prefab cấu hình dang dở hoặc thay đổi runtime mà không null-check controller.
- **Quy tắc bắt buộc:** Kiểm tra `animator != null && animator.runtimeAnimatorController != null && animator.isActiveAndEnabled` trước khi kích hoạt trigger/state.

---

### [INSTINCT-G04] Bẫy Canvas Rebuild & Tụt FPS Do Trộn Dynamic Với Static UI
- **Hiện tượng lỗi:** Game bị tụt FPS từ 60/120 xuống 30–40 FPS trên mobile mỗi khi Text hiển thị điểm số, máu (HP), hoặc đồng hồ đếm ngược cập nhật giá trị.
- **Nguyên nhân gốc rễ:** Đặt Text động chung một Canvas với Background tĩnh hoặc hàng trăm Icon tĩnh. Khi Text thay đổi, Unity đánh dấu cả Canvas là dirty và rebuild toàn bộ Vertex Buffer của Canvas đó.
- **Quy tắc bắt buộc:** Bắt buộc phân tách UI thành các Sub-Canvas độc lập: Canvas tĩnh (Background, khung viền không đổi) và Canvas động (Text điểm số, thanh máu, coin count).

---

### [INSTINCT-G05] Bẫy Cấp Phát Bộ Nhớ Heap Trong Frame Loop (Physics NonAlloc)
- **Hiện tượng lỗi:** Game chơi sau 2–3 phút bị giật khựng (Spike lag 50–100ms) lặp đi lặp lại do Garbage Collector thu gom rác thế hệ Gen 0.
- **Nguyên nhân gốc rễ:** Dùng `Physics.RaycastAll`, `Physics.OverlapSphere`, hoặc `GetComponent<T>()` bên trong `Update()`, `FixedUpdate()`, mỗi frame cấp phát một mảng `Collider[]` hoặc đối tượng mới trên Heap.
- **Quy tắc bắt buộc:** 
  1. Bắt buộc dùng `Physics.RaycastNonAlloc` và `Physics.OverlapSphereNonAlloc` với mảng đệm tĩnh/thành viên (preallocated buffer).
  2. Cache toàn bộ Component references trong `Awake()` / `Start()`.
  3. Tuyệt đối cấm dùng từ khóa `new ` (List, Dictionary, Object) trong `Update()`.

---

## 2. Nhật Ký Bẫy Mã Nguồn Bổ Sung (Dành cho Dev / Agent thêm mới)

<!--
Mẫu ghi nhận:
### [INSTINCT-XXX] <Tên bẫy / Tình huống>
- **Ngày phát hiện:** YYYY-MM-DD
- **Hiện tượng lỗi:** <Mô tả lỗi hoặc hồi quy>
- **Nguyên nhân:** <Tại sao lại xảy ra>
- **Quy tắc phòng ngừa:** <Cách làm đúng từ nay về sau>
- **Lệnh kiểm tra:** <Câu lệnh kiểm tra tự động nếu có>
-->
