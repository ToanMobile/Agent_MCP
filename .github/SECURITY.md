# Chính sách bảo mật

## Mô hình bảo mật

Server này chạy **cục bộ** và chỉ nói chuyện với `127.0.0.1`. Nó không mở cổng nào, không gọi ra mạng ngoài.

Để nói được với IDE Antigravity đang mở, server phải lấy địa chỉ language server + khoá phiên loopback mà IDE tự bơm vào các terminal của nó. Khi MCP chạy ngoài IDE, cặp này được khôi phục từ process table của **chính người dùng**.

Quy tắc bắt buộc (ghi trong [AGENTS.md](../AGENTS.md), có test bảo vệ):

- Khoá phiên **chỉ nằm trong RAM**: không ghi ra file, không log, không trả về cho model
- Cache chỉ lưu `pid` + số cổng (`~/.antigravity-pm/ls.json`)
- Mọi chuỗi trả ra đi qua bộ che `redact()` trước khi tới model
- CSDL hội thoại của người dùng chỉ được `stat` (đo động tĩnh), **không mở nội dung**
- Mặc định `commitPolicy: "forbid"` — prompt cấm agent `git commit` / `push` / `reset --hard`

## Điều cần biết trước khi dùng

`pm_run` và provider ảnh `shell` **chạy lệnh do cấu hình project khai**. `.antigravity-pm.json` vì thế là file tin cậy — đừng chạy server trên project mà bạn không tin nội dung cấu hình của nó, hệt như với `Makefile` hay `package.json` scripts.

Agent Antigravity được giao việc **có thể sửa file trong project đang mở**. Nên:

- Làm việc trên nhánh riêng
- Giữ `commitPolicy: "forbid"` để agent không tự commit/push
- Đọc `pm_diff` trước khi nghiệm thu

## Báo lỗi bảo mật

Mở issue riêng tư hoặc liên hệ trực tiếp người bảo trì. Đừng dán khoá phiên, token hay log chứa bí mật vào issue công khai.
