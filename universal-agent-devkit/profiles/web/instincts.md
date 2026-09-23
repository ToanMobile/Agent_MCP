# Instincts & Failure Memory — Web Profile

> **Quy định cho AI Agent:** đọc lướt các bẫy dưới đây trước khi sửa code web. Gặp bẫy mới thì thêm một mục theo mẫu ở cuối tệp.

---

### [INSTINCT-WEB-01] Secret lọt vào bundle qua biến môi trường public
- **Hiện tượng lỗi:** API key server-side được đặt vào `NEXT_PUBLIC_*` / `VITE_*` và bị build thẳng vào JavaScript gửi xuống trình duyệt.
- **Nguyên nhân gốc rễ:** Nhầm biến public của bundler với biến chỉ có ở server.
- **Quy tắc bắt buộc:** Secret chỉ đọc ở server (API route, server action, backend). Kiểm tra bundle: `grep -r "<tiền tố key>" .next/ dist/` phải rỗng.

---

### [INSTINCT-WEB-02] Race condition hiển thị dữ liệu cũ
- **Hiện tượng lỗi:** Gõ nhanh vào ô tìm kiếm, kết quả của request cũ về sau và ghi đè kết quả mới.
- **Nguyên nhân gốc rễ:** Không huỷ request trước khi input đổi.
- **Quy tắc bắt buộc:** Dùng `AbortController` hoặc so id request trước khi set state; debounce input 250–300ms.

---

### [INSTINCT-WEB-03] Hydration mismatch
- **Hiện tượng lỗi:** Cảnh báo hydration và giao diện nhấp nháy do server và client render khác nhau (`Date.now()`, `Math.random()`, `window` trong render).
- **Nguyên nhân gốc rễ:** Giá trị không xác định được dùng ngay trong lần render đầu.
- **Quy tắc bắt buộc:** Giá trị chỉ có ở client đặt trong `useEffect`/`onMounted`; id dùng `useId()`.

---

### [INSTINCT-WEB-04] Layout shift do ảnh và font
- **Hiện tượng lỗi:** CLS cao, nút bị nhảy khi người dùng sắp bấm.
- **Nguyên nhân gốc rễ:** Ảnh không có kích thước, font swap đổi metric.
- **Quy tắc bắt buộc:** Ảnh luôn có `width`/`height` hoặc `aspect-ratio`; dùng `font-display: optional` hoặc fallback có `size-adjust`.

---

### [INSTINCT-WEB-05] Kiểm tra quyền chỉ ở UI
- **Hiện tượng lỗi:** Ẩn nút "Xoá" với user thường nhưng API vẫn cho xoá khi gọi trực tiếp.
- **Nguyên nhân gốc rễ:** Coi UI là lớp bảo vệ.
- **Quy tắc bắt buộc:** Mọi mutation kiểm tra quyền ở server; test API với user không đủ quyền phải trả 403/404.

---

## Nhật ký bẫy bổ sung

<!--
### [INSTINCT-WEB-XX] <Tên bẫy>
- **Ngày phát hiện:** YYYY-MM-DD
- **Hiện tượng lỗi:** …
- **Nguyên nhân:** …
- **Quy tắc phòng ngừa:** …
- **Lệnh kiểm tra:** …
-->
