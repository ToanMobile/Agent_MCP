# Backend Service Engineering Rules (API / Workers)

## 1. Solo-Dev & Git Security (BẮT BUỘC)
- CHỈ `git commit`, `git push` hoặc tạo PR khi người dùng YÊU CẦU TƯỜNG MINH.
- Secret chỉ nạp qua biến môi trường / secret manager; không commit `.env`, key, dump database.
- Không đưa dữ liệu production thật vào test fixture.

## 2. Paired Executable Oracle & TDD
1. **RED:** test tái hiện lỗi ở tầng thấp nhất có thể (unit → integration), xác nhận FAIL.
2. **GREEN:** sửa tối giản cho PASS; không xoá/nới assertion.
- Runner đúng theo dự án: `go test ./...`, `cargo test`, `python3 -m pytest`, `npm test`.

## 3. Hợp đồng API
- Không đổi/xoá field hay đổi kiểu trong API công khai mà không version hoá (`/v2`, field mới + deprecate).
- Lỗi trả về có cấu trúc (mã lỗi ổn định + message), không lộ stack trace ra client.
- Validate input tại biên (schema), từ chối sớm với 4xx rõ ràng.

## 4. Dữ liệu & Migration
- Migration chỉ tiến, có thể chạy lại an toàn; tách "thêm cột" và "xoá cột" thành 2 lần deploy.
- Mọi truy vấn dùng tham số hoá — cấm nối chuỗi SQL.
- Thao tác ghi quan trọng có transaction và idempotency key (retry không tạo bản ghi trùng).

## 5. Độ bền & Hiệu năng
- Mọi lời gọi mạng có timeout; retry có giới hạn + backoff + jitter; không retry thao tác không idempotent.
- Tránh N+1 query; thêm index khi thêm điều kiện lọc mới; phân trang mọi endpoint trả danh sách.
- Không nuốt lỗi (`except: pass`, `catch {}`) — log kèm ngữ cảnh rồi xử lý hoặc ném lại.

## 6. Quan sát & Log
- Log có cấu trúc (JSON) với request/trace id; mask PII, token, mật khẩu.
- Endpoint health/readiness riêng; metric cho latency, error rate, queue depth.

## 7. Bảo mật
- AuthN ở middleware, AuthZ kiểm tra theo **từng tài nguyên** (chống IDOR).
- Rate limit cho endpoint đăng nhập/gửi mã; không trả khác biệt thông báo giữa "sai user" và "sai mật khẩu".
