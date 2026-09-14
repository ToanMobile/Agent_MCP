// Bao cao nghiem thu: 1 file markdown lam bang chung, dan duoc cho chu du an.
import path from 'node:path';
import fs from 'node:fs';
import { contractPaths, gate, freshness, isGreenRun } from './tasks.js';
import { writeFileAtomic, nowIso } from './util.js';

export function renderReport(cfg, task, { summary = '' } = {}) {
  const paths = contractPaths(cfg, task);
  const g = gate(cfg, task);
  const fresh = freshness(cfg, task);
  const res = fresh.result || {};
  const round = task.round || 0;
  const runs = (task.runs || []).filter((r) => r.round === round);
  const proofs = (task.proofs || []).filter((p) => p.round === round);

  const L = [];
  L.push(`# Bao cao nghiem thu — ${task.id}`);
  L.push('');
  L.push(`**Task:** ${task.title}`);
  L.push(`**Project:** ${cfg.projectName} (${cfg.projectRoot})`);
  L.push(`**Trang thai:** ${task.phase}${task.acceptedAt ? ` — nghiem thu ${task.acceptedAt}` : ''}`);
  L.push(`**Vong lam:** ${round}${round ? ` (da tra viec ${round} lan)` : ''}`);
  L.push(`**Hoi thoai Antigravity:** ${task.conversationId || '(chua co)'}`);
  L.push(`**Xuat luc:** ${nowIso()}`);
  L.push('');
  if (summary) {
    L.push('## Ket luan cua PM');
    L.push(summary);
    L.push('');
  }
  L.push('## Yeu cau ban dau');
  L.push(task.brief);
  L.push('');
  L.push('## Dinh nghia HOAN THANH');
  for (const d of task.definitionOfDone) L.push(`- [${task.phase === 'ACCEPTED' ? 'x' : ' '}] ${d}`);
  L.push('');

  L.push('## Cong nghiem thu');
  L.push(g.ok ? '> **DAT** — du bang chung theo cong chan.' : '> **CHUA DAT** — con thieu:');
  if (!g.ok) for (const m of g.missing) L.push(`> - ${m}`);
  L.push('');
  L.push('| Hang muc | Ket qua |');
  L.push('| --- | --- |');
  L.push(`| Ke hoach (plan.md) | ${fresh.planExists ? 'co' : 'THIEU'} |`);
  L.push(`| PM duyet ke hoach | ${task.verdicts?.plan?.verdict || 'chua'} |`);
  L.push(`| Bao cao agent (result.json) | ${fresh.resultExists ? (fresh.resultFresh ? 'co, moi' : 'CO NHUNG CU') : 'THIEU'} |`);
  L.push(`| Audit | ${task.verdicts?.audit?.verdict || 'chua'} |`);
  L.push(`| Code review | ${task.verdicts?.review?.verdict || 'chua'} |`);
  L.push(`| Test | ${runs.filter((r) => r.kind === 'test' && isGreenRun(r)).length} lan xanh (co bang chung) / ${runs.filter((r) => r.kind === 'test').length} lan chay${runs.some((r) => r.kind === 'test' && r.stage) ? ` — CHI STAGE: ${runs.filter((r) => r.kind === 'test' && r.stage).map((r) => `${r.stage} (${r.skipReason})`).join('; ')}` : ''} |`);
  L.push(`| Anh nghiem thu | ${proofs.length} / can ${cfg.proof?.require ?? 1} |`);
  L.push('');

  if (res.summary) {
    L.push('## Agent bao cao');
    L.push(res.summary);
    if (Array.isArray(res.files_changed) && res.files_changed.length) {
      L.push('');
      L.push('**File da sua:**');
      for (const f of res.files_changed) L.push(`- \`${f}\``);
    }
    if (res.notes) { L.push(''); L.push(`**Ghi chu:** ${res.notes}`); }
    if (res.blocked) { L.push(''); L.push(`**BI VUONG:** ${typeof res.blocked === 'string' ? res.blocked : JSON.stringify(res.blocked)}`); }
    L.push('');
  }

  for (const kind of ['audit', 'review']) {
    const v = task.verdicts?.[kind];
    if (!v) continue;
    L.push(`## ${kind === 'audit' ? 'Audit' : 'Code review'} (${v.verdict})`);
    if (v.findings?.length) for (const f of v.findings) L.push(`- ${f}`);
    if (v.notes) L.push(`\n${v.notes}`);
    L.push('');
  }

  if (runs.length) {
    L.push('## Lenh da chay (vong hien tai)');
    L.push('| Loai | Lenh | Exit | Thoi gian |');
    L.push('| --- | --- | --- | --- |');
    for (const r of runs) {
      L.push(`| ${r.kind} | \`${String(r.command).replace(/\|/g, '\\|')}\` | ${r.exitCode}${r.timedOut ? ' (qua han)' : ''} | ${Math.round((r.durationMs || 0) / 1000)}s |`);
    }
    L.push('');
  }

  if (proofs.length) {
    L.push('## Anh nghiem thu');
    for (const p of proofs) {
      const rel = path.relative(paths.dir, p.file);
      L.push(`### ${p.label}`);
      L.push(`- Cach chup: \`${p.provider}\` · ${p.at} · ${Math.round((p.bytes || 0) / 1024)} KB${p.width ? ` · ${p.width}px` : ''}`);
      L.push('');
      L.push(`![${p.label}](${rel})`);
      L.push('');
    }
  }

  L.push('## Lich su');
  for (const h of task.history || []) {
    L.push(`- ${h.at} · **${h.actor}** · ${h.event}${h.detail ? ` — ${String(h.detail).split('\n')[0].slice(0, 200)}` : ''}`);
  }
  L.push('');

  const md = L.join('\n');
  writeFileAtomic(paths.report, md);
  return { file: paths.report, markdown: md, gate: g };
}

export function readReport(cfg, task) {
  const paths = contractPaths(cfg, task);
  try { return fs.readFileSync(paths.report, 'utf8'); } catch { return null; }
}
