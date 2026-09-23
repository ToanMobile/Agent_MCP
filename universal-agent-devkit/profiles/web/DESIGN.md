# DESIGN.md — Web Design System & UI Guidelines for AI Agents

> **Chỉ thị cho AI Agent:** trước khi sinh/sửa UI (React/Vue/Svelte/HTML/CSS/Tailwind), đọc và dùng đúng token trong tệp này. Không hardcode mã màu, cỡ chữ hay khoảng cách lạ — dùng CSS custom properties hoặc theme của dự án.

## 1. Color Tokens (CSS custom properties)

| Token | Light | Dark | Dùng cho |
|---|---|---|---|
| `--color-primary` | `#2563EB` | `#60A5FA` | CTA, link, trạng thái active |
| `--color-on-primary` | `#FFFFFF` | `#0B1220` | Chữ/icon trên nền primary |
| `--color-bg` | `#FFFFFF` | `#0B0F17` | Nền trang |
| `--color-surface` | `#F8FAFC` | `#111827` | Card, popover, modal |
| `--color-text` | `#0F172A` | `#E5E7EB` | Nội dung chính |
| `--color-text-muted` | `#475569` | `#9CA3AF` | Chữ phụ (vẫn ≥ 4.5:1 trên nền) |
| `--color-border` | `#E2E8F0` | `#1F2937` | Viền input, divider |
| `--color-success` / `--color-warning` / `--color-danger` | `#059669` / `#B45309` / `#DC2626` | `#34D399` / `#FBBF24` / `#F87171` | Trạng thái |

- Hỗ trợ `prefers-color-scheme` và `prefers-reduced-motion`.

## 2. Typography (rem, base 16px)

| Level | Size | Line height | Weight |
|---|---|---|---|
| Display | 2rem | 1.25 | 700 |
| H1 / H2 / H3 | 1.5 / 1.25 / 1.125rem | 1.3 | 600 |
| Body | 1rem | 1.5 | 400 |
| Small / Caption | 0.875 / 0.75rem | 1.4 | 400–500 |

- Chữ body không nhỏ hơn 16px trên mobile (tránh iOS zoom khi focus input).

## 3. Spacing & Layout
- Thang 4px: 4 / 8 / 12 / 16 / 24 / 32 / 48 / 64.
- Breakpoints: `sm 640`, `md 768`, `lg 1024`, `xl 1280`; thiết kế mobile-first.
- Nội dung đọc dài: tối đa ~70 ký tự mỗi dòng.

## 4. Accessibility (WCAG 2.2 AA)
- Vùng bấm ≥ 44×44px, khoảng cách giữa 2 target ≥ 8px.
- Tương phản chữ ≥ 4.5:1 (chữ lớn ≥ 3:1); focus ring rõ (`:focus-visible`, 2px, tương phản ≥ 3:1).
- Mỗi component tương tác có đủ trạng thái: default, hover, active, focus-visible, disabled (`aria-disabled` + không nhận click).
- Form: `<label>` gắn với input, thông báo lỗi liên kết bằng `aria-describedby`, không chỉ dùng màu để báo lỗi.

## 5. Motion & Media
- Transition 150–250ms, ease-out; tắt animation không cần thiết khi `prefers-reduced-motion: reduce`.
- Ảnh có `width`/`height` (chống CLS), định dạng AVIF/WebP, `loading="lazy"` dưới fold.
- Icon SVG inline hoặc sprite, `aria-hidden="true"` nếu chỉ trang trí.
