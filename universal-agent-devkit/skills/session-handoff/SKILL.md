---
name: session-handoff
description: Dùng khi User gọi /session-handoff để chuyển công việc đang dở sang session/người khác hoặc sắp hết context. Bỏ qua fact cần lưu lâu dài; dùng `.agents/instincts.md` cho nội dung persistent.
disable-model-invocation: true
---

# Session Handoff

Handoff là pointer-doc ephemeral, không sao chép artifact và không thay thế project memory.

## Quy trình

1. Ghi `.agents/handoff.md` (file ephemeral, thêm `.agents/handoff.md` vào `.gitignore` nếu chưa có).
   Nếu file cũ còn việc dở chưa bàn giao, giữ nó dưới `.agents/handoffs/handoff-<YYYY-MM-DD>-<topic>.md`
   (ngày hiện tại thật, topic ngắn an toàn cho filename) thay vì ghi đè.
2. Trỏ tới spec/plan, memory, diff/commit và path đã verify. Chỉ viết mới trạng thái đang dở, quyết định
   chưa được ghi, blocker, residual và next step.
3. Nếu có `$ARGUMENTS`, ưu tiên trọng tâm đó nhưng không bỏ blocker/risk ảnh hưởng việc tiếp quản.
4. Redact API key, token, password, credential, PII, document content và path lộ danh tính.
5. Thêm “Suggested skills” và lệnh verify nhỏ nhất để session sau kiểm tra repo state trước khi làm tiếp.

## Template

```markdown
# Handoff: <topic>
> Session sau tập trung: <focus>

## Trạng thái
- Đã xong: <pointer/evidence>
- Đang dở: <where> → next <step>
- Blocker/residual: <fact>

## Pointers
- Spec/plan: <path>
- Memory/gotcha: <path>
- Code/diff: <path or commit verified>

## Suggested skills
- `<skill>` — <reason>

## Verify để bắt đầu
- `<command>` → <expected fact, không bịa PASS>
```

Không commit/push, copy secret, ghi claim test xanh chưa chạy hoặc biến handoff thành tài liệu kiến thức
dài. Fact reusable phải vào `.agents/instincts.md` (rồi `agent-kit index-memory` để cập nhật index).

Liên kết: `AGENTS.md` · `rules/core-rules.md` §1 (bảo mật) · `.agents/instincts.md`.
