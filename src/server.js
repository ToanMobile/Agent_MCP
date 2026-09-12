// MCP server: dau noi giua Claude Code (Leader/PM) va Antigravity (Engineer).
// Dung API tang thap + JSON Schema thuan => khong phu thuoc zod, khong vo khi doi version.
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { TOOLS, TOOLS_BY_NAME } from './tools.js';
import { logStderr, truncate } from './util.js';

export const SERVER_NAME = 'antigravity-pm';
export const SERVER_VERSION = '0.1.0';

// Khoi nay nam trong context cua ben dung MCP ca phien => ngan gon, chi giu cai khong the suy ra
// tu ten tool. Giai thich dai de trong docs/workflow.md.
const INSTRUCTIONS = `Ban la Leader/PM; Antigravity la ky su. Dung tu viet code phan da giao cho no.
Thu tu: pm_task_create -> dispatch plan -> doc plan.md -> verdict plan -> dispatch implement
-> pm_diff (+ dispatch audit) -> verdict audit -> verdict review -> pm_run test -> pm_capture_proof -> pm_accept.
Sai thi pm_rework kem findings (file:dong + sai gi). Antigravity phai dang mo dung project can lam.
result.json cua agent la LOI KHAI, khong phai bang chung; pm_run va anh moi la bang chung.`;

export function createServer() {
  const server = new Server(
    { name: SERVER_NAME, version: SERVER_VERSION },
    { capabilities: { tools: {} }, instructions: INSTRUCTIONS },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOLS.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const tool = TOOLS_BY_NAME.get(req.params.name);
    if (!tool) {
      return { content: [{ type: 'text', text: `Khong co tool "${req.params.name}"` }], isError: true };
    }
    try {
      const out = await tool.handler(req.params.arguments || {});
      const payload = typeof out === 'string' ? { text: out } : out;
      const content = [{ type: 'text', text: payload.text ?? '' }];
      for (const img of payload.images || []) {
        content.push({ type: 'image', data: img.base64, mimeType: img.mime || 'image/png' });
      }
      return { content, isError: Boolean(payload.isError) };
    } catch (e) {
      const hint = e?.hint ? `\nGoi y: ${e.hint}` : '';
      const detail = e?.detail ? `\nChi tiet: ${truncate(String(e.detail), 2000)}` : '';
      logStderr(`loi tool ${req.params.name}: ${e?.message}`);
      return {
        content: [{ type: 'text', text: `${e?.message || String(e)}${hint}${detail}` }],
        isError: true,
      };
    }
  });

  return server;
}

export async function main() {
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  logStderr(`${SERVER_NAME} v${SERVER_VERSION} da san sang (${TOOLS.length} tool)`);
}
