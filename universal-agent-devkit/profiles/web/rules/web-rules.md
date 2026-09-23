# Web Application Engineering Rules (Frontend / Full-Stack JS)

## 1. Solo-Dev & Git Security (BẮT BUỘC)
- CHỈ `git commit`, `git push` hoặc tạo PR khi người dùng YÊU CẦU TƯỜNG MINH.
- Không commit `.env*` (trừ `.env.example` chỉ chứa placeholder), token, cookie, service account.
- Biến môi trường lộ ra trình duyệt (`NEXT_PUBLIC_*`, `VITE_*`) là **công khai** — tuyệt đối không đặt secret vào đó.

## 2. Paired Executable Oracle & TDD
1. **RED:** viết test tái hiện lỗi (Vitest/Jest/Playwright), chạy và xác nhận FAIL.
2. **GREEN:** sửa tối giản cho test PASS; không xoá/nới assertion, không `.skip`/`.only` còn sót.
- Lệnh test lấy từ `package.json` (`npm test` / `pnpm test` / `yarn test`) — không tự bịa script.

## 3. TypeScript & Hợp đồng dữ liệu
- `strict: true`; cấm `any` mới và `@ts-ignore` không kèm lý do.
- Dữ liệu từ network/URL/localStorage là **không tin cậy**: validate bằng schema (zod/valibot/io-ts) tại biên.

## 4. Bảo mật trình duyệt
- Không `dangerouslySetInnerHTML` / `v-html` / `innerHTML` với dữ liệu người dùng khi chưa sanitize.
- Mutation phải có bảo vệ CSRF (SameSite cookie + token) và kiểm tra quyền ở server, không chỉ ẩn nút ở UI.
- Token phiên để trong cookie `HttpOnly; Secure`, không để trong `localStorage`.

## 5. Hiệu năng & Core Web Vitals
- Ngân sách: LCP ≤ 2.5s, INP ≤ 200ms, CLS ≤ 0.1 trên máy tầm trung.
- Ảnh có kích thước cố định + lazy-load; code-split theo route; không import cả thư viện cho một hàm.
- Tránh re-render thừa: memo hoá có đo đạc, key ổn định cho list.

## 6. Chống Spam & Bất đồng bộ
- Nút gọi API phải disable + hiển thị loading ngay khi bấm; submit form idempotent.
- Huỷ request cũ khi input đổi (AbortController) để tránh race hiển thị dữ liệu cũ.

## 7. Accessibility (WCAG 2.2 AA)
- Vùng bấm ≥ 44×44px, tương phản ≥ 4.5:1, focus ring nhìn thấy, điều hướng bàn phím đầy đủ.
- Dùng phần tử HTML ngữ nghĩa trước ARIA; mọi ảnh có `alt`, mọi input có `<label>`.
