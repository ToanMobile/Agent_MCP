# Instincts & Failure Memory — Backend Profile

> **Quy định cho AI Agent:** đọc lướt các bẫy dưới đây trước khi sửa code backend. Gặp bẫy mới thì thêm một mục theo mẫu ở cuối tệp.

---

### [INSTINCT-BE-01] Retry tạo giao dịch trùng
- **Hiện tượng lỗi:** Client timeout rồi gửi lại, server tạo 2 đơn hàng / trừ tiền 2 lần.
- **Nguyên nhân gốc rễ:** Endpoint tạo tài nguyên không idempotent.
- **Quy tắc bắt buộc:** Nhận `Idempotency-Key`, lưu (key, hash payload, kết quả) trong transaction; trùng key cùng payload → trả kết quả cũ.

---

### [INSTINCT-BE-02] N+1 query sau khi thêm field vào response
- **Hiện tượng lỗi:** Latency tăng tuyến tính theo số bản ghi sau một thay đổi nhỏ ở serializer.
- **Nguyên nhân gốc rễ:** Truy cập quan hệ lazy trong vòng lặp.
- **Quy tắc bắt buộc:** Eager-load / batch (`JOIN`, `IN (...)`, dataloader); test đếm số query cho endpoint danh sách.

---

### [INSTINCT-BE-03] Migration khoá bảng lớn
- **Hiện tượng lỗi:** Deploy treo vài phút, request timeout hàng loạt.
- **Nguyên nhân gốc rễ:** `ALTER TABLE` thêm cột có default / tạo index không `CONCURRENTLY` trên bảng lớn.
- **Quy tắc bắt buộc:** Expand → backfill theo lô → contract; index tạo online; thử migration trên bản sao dữ liệu kích thước thật.

---

### [INSTINCT-BE-04] Lỗi bị nuốt, job "thành công" giả
- **Hiện tượng lỗi:** Worker báo xong nhưng dữ liệu không được ghi; không có log.
- **Nguyên nhân gốc rễ:** `except Exception: pass` / `catch {}` / bỏ qua `err` trong Go.
- **Quy tắc bắt buộc:** Lỗi phải được log kèm ngữ cảnh và trả về/đẩy vào dead-letter; linter bật `errcheck` / rule cấm except trống.

---

### [INSTINCT-BE-05] IDOR — truy cập tài nguyên của người khác bằng cách đổi ID
- **Hiện tượng lỗi:** `GET /v1/invoices/123` trả hoá đơn của user khác.
- **Nguyên nhân gốc rễ:** Chỉ kiểm tra đã đăng nhập, không kiểm tra quyền sở hữu tài nguyên.
- **Quy tắc bắt buộc:** Truy vấn luôn kèm điều kiện chủ sở hữu/tenant; test với 2 user khác nhau phải trả 404.

---

## Nhật ký bẫy bổ sung

<!--
### [INSTINCT-BE-XX] <Tên bẫy>
- **Ngày phát hiện:** YYYY-MM-DD
- **Hiện tượng lỗi:** …
- **Nguyên nhân:** …
- **Quy tắc phòng ngừa:** …
- **Lệnh kiểm tra:** …
-->
