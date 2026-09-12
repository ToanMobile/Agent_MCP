#!/usr/bin/env node
// Chay dang MCP server (stdio) cho Claude Code, hoac `--doctor` de tu kiem tra tu terminal.
import { main } from '../src/server.js';
import { TOOLS_BY_NAME } from '../src/tools.js';

const argv = process.argv.slice(2);

if (argv.includes('--help') || argv.includes('-h')) {
  process.stdout.write(`antigravity-pm-mcp — MCP server dieu phoi Antigravity

  (khong tham so)         chay dang MCP server qua stdio (Claude Code goi kieu nay)
  --doctor [project]      tu kiem tra duong day va in ra terminal
  --tools                 liet ke tool
  --help                  tro giup

Cai vao Claude Code:
  claude mcp add antigravity-pm --scope user -- node ${process.argv[1]}
`);
  process.exit(0);
}

if (argv.includes('--tools')) {
  for (const [name, t] of TOOLS_BY_NAME) {
    process.stdout.write(`${name}\n    ${t.description}\n`);
  }
  process.exit(0);
}

if (argv.includes('--doctor')) {
  const project = argv.find((a) => !a.startsWith('--'));
  const out = await TOOLS_BY_NAME.get('pm_doctor').handler({ project });
  process.stdout.write(`${typeof out === 'string' ? out : out.text}\n`);
  process.exit(0);
}

await main();
