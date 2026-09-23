# DESIGN.md — Backend API & Service Design Conventions for AI Agents

> **Chỉ thị cho AI Agent:** backend không có UI; "design system" ở đây là quy ước API, lỗi, dữ liệu và vận hành. Đọc và tuân thủ trước khi thêm/sửa endpoint, bảng dữ liệu hay job nền.

## 1. API Resource & Naming
- REST: danh từ số nhiều (`/v1/orders/{id}`), `kebab-case` cho path, `camelCase` hoặc `snake_case` cho JSON — **một** kiểu cho toàn dự án.
- Version ở path (`/v1`); thay đổi phá vỡ tương thích → version mới.
- Phân trang bằng cursor (`?cursor=&limit=`, `limit` tối đa 100), trả `nextCursor`.

## 2. Error Envelope

```json
{ "error": { "code": "ORDER_NOT_FOUND", "message": "Order not found", "requestId": "…" } }
```

| Tình huống | HTTP |
|---|---|
| Input sai / thiếu | 400 (kèm danh sách field lỗi) |
| Chưa xác thực / không có quyền | 401 / 403 |
| Không tồn tại (kể cả khi không có quyền xem, để tránh dò ID) | 404 |
| Xung đột phiên bản / trùng idempotency key khác payload | 409 |
| Vượt rate limit | 429 + `Retry-After` |
| Lỗi server | 500 — không lộ stack trace |

## 3. Idempotency & Concurrency
- `POST` tạo tài nguyên/giao dịch nhận header `Idempotency-Key`; lưu kết quả để trả lại khi retry.
- Cập nhật đồng thời dùng optimistic locking (`version`/`ETag` + `If-Match`).

## 4. Data & Migrations
- Thời gian lưu UTC (ISO 8601), tiền tệ lưu số nguyên đơn vị nhỏ nhất + mã tiền tệ.
- Migration: expand → migrate → contract, mỗi bước deploy riêng; không khoá bảng lớn trong giờ cao điểm.

## 5. Timeouts, Retries, Limits
- Timeout mặc định cho outbound call: 2–5s; tổng request budget < timeout của gateway.
- Retry: tối đa 3 lần, exponential backoff + jitter, chỉ cho thao tác idempotent.
- Payload tối đa và rate limit được khai báo rõ theo endpoint.

## 6. Observability
- Log JSON một dòng: `timestamp, level, message, requestId, traceId, userId(hash)`; không log token/mật khẩu/PII thô.
- Metric RED (Rate, Errors, Duration) cho mọi endpoint; alert theo SLO, không theo từng lỗi lẻ.
