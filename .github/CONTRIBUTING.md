# Góp code

## Trước khi sửa

Đọc [AGENTS.md](../AGENTS.md) — 5 luật bất biến. Quan trọng nhất: **cổng nghiệm thu không được làm mềm**.

## Vòng làm việc

```bash
npm install
npm test            # 40 test, phải xanh trước khi sửa và sau khi sửa
npm run lint
npm run doctor -- <project>    # cần Antigravity đang mở
```

## Yêu cầu với test

- Test **không được** cần Antigravity, không cần mạng, không cần thiết bị
- Sửa `gate()` ⇒ phải có test chứng minh trường hợp mới **bị chặn**
- Thêm provider ảnh ⇒ phải có test cho cả đường thất bại (exit khác 0, file không phải ảnh)

## Quy ước

- Mã: Node ESM, không TypeScript, **không thêm zod** (server cố ý không phụ thuộc zod)
- Chuỗi trong code và prompt gửi agent: **tiếng Việt không dấu**; tài liệu: **tiếng Việt có dấu**
- Thêm tool ⇒ mô tả trong schema viết **một dòng** (context của bên dùng MCP là tài nguyên có hạn), chi tiết để trong `docs/tools-reference.md`
- Đổi hành vi ⇒ ghi vào `CHANGELOG.md` mục `[Unreleased]`
