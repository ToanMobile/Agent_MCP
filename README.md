# Agent_MCP

Monorepo gom các công cụ MCP / agent của ToanMobile. Mỗi thư mục là một dự án độc lập, giữ nguyên lịch sử git
(nhập bằng `git subtree`), có README, test và tài liệu riêng.

| Thư mục | Là gì | Ngôn ngữ |
| --- | --- | --- |
| [`play-store-mcp/`](play-store-mcp/) | MCP server làm việc với Google Play Console (APK, release, review…) | Python (uv) |
| [`antigravity-pm-mcp/`](antigravity-pm-mcp/) | Claude Code làm PM điều phối Google Antigravity: giao task, phản biện plan, audit/review, cổng nghiệm thu cưỡng chế | Node ESM |
| [`universal-agent-devkit/`](universal-agent-devkit/) | Bộ chuẩn hóa kỹ thuật & chất lượng Zero-Defect: 25 skills, 6 domain profiles (Android, iOS, Automotive, Game, Voice, Universal), bảo vệ xung đột X_old, 8-layer Post-Fix Gate cho 4 nền tảng AI Agent (Claude Code, OpenAI Codex, Antigravity, Cursor) | Shell + Python + Node |

## Lịch sử

- Repo GitHub này trước là `play-store-mcp` (đổi tên thành `Agent_MCP` ngày 14/09/2026); toàn bộ lịch sử cũ nằm dưới `play-store-mcp/`.
- `antigravity-pm-mcp` và `universal-agent-devkit` được nhập ngày 14/09/2026 bằng `git subtree add`, giữ nguyên commit gốc.

## Làm việc với từng dự án

```bash
cd Agent_MCP/antigravity-pm-mcp && npm install && npm test
cd Agent_MCP/play-store-mcp && uv sync && uv run pytest
cd Agent_MCP/universal-agent-devkit && make init
```

Workflow GitHub Actions của `play-store-mcp` nằm ở `play-store-mcp/.github/workflows/` — GitHub chỉ chạy workflow ở
`.github/workflows/` gốc repo, nên muốn CI chạy lại phải kéo lên gốc và sửa `working-directory`.
