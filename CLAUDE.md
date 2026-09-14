# CLAUDE.md — antigravity-pm-mcp

> **TẤT CẢ LUẬT BẤT BIẾN NẰM TẠI [`AGENTS.md`](AGENTS.md)** (nguồn duy nhất). Đọc trước khi sửa bất cứ thứ gì.

## Nhắc nhanh 3 điều dễ làm sai

1. 🚧 **Cổng nghiệm thu (`gate()` trong `src/tasks.js`) không được làm mềm.** Không thêm cờ bỏ qua, không thêm `force` cho `pm_accept`. Sửa `gate()` phải kèm test chứng minh trường hợp mới **bị chặn**.
2. 🔒 **Khoá phiên loopback chỉ ở trong RAM.** Không ghi file, không log, không trả về cho model. Cache chỉ `pid` + cổng.
3. 🪙 **Mô tả tool viết một dòng.** Schema nằm trong context của bên dùng MCP suốt cả phiên; chi tiết dài để trong `docs/tools-reference.md`. Kết quả tool trả **con trỏ (đường dẫn file)**, không trả nội dung dài.

## Lệnh hay dùng

```bash
npm test                      # offline, phai xanh het
npm run lint
npm run doctor -- <project>   # cần Antigravity đang mở
node bin/antigravity-pm-mcp.js --tools
```
