// Ke hoach & phan bien: hash plan.md, diff giua hai ban (focus=delta), tinh trang plan-review.json
// (treo / sai khuon — tu nhac agent 1 lan / hash lech). Goi sendMessage nen day la cho DUY NHAT trong
// duong doc (pm_status) co tac dung phu, va no phai khong bao gio no khi Antigravity dong.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { contractPaths, addHistory, updateTask } from './tasks.js';
import { kiemKhuonPlanReview } from './policy.js';
import { kiemBaoCao, dongTomTat } from './cite-check.js';
import { buildPlanReviewFixMessage } from './prompt.js';
import { sendMessage } from './agentapi.js';
import { requireProjectId } from './projects.js';
import { run, truncate, nowIso, readJsonIfExists } from './util.js';

/** Project id de gui kem moi loi goi; khong giai ra duoc thi bo trong (hoi thoai da ton tai). */
export function projectIdFor(cfg) {
  try { return requireProjectId(cfg).id; } catch { return undefined; }
}

export function hashOf(buf) {
  return createHash('sha256').update(buf).digest('hex');
}

/** Diff ke hoach v(n-1) -> v(n) + finding cua ban phan bien truoc (focus=delta). null neu chua co ban truoc. */
export async function deltaKeHoach(cfg, task) {
  const p = contractPaths(cfg, task);
  const v = task.planVersion || 1;
  const prev = path.join(p.logsDir, `plan-v${v - 1}.md`);
  if (v < 2 || !fs.existsSync(prev)) return null;
  // argv, khong qua shell: duong dan tu stateDir (config) co the chua $(...) — JSON.stringify KHONG chan duoc.
  const d = await run('git', ['--no-pager', 'diff', '--no-index', '--unified=3', '--', prev, p.plan], { cwd: cfg.projectRoot, timeoutMs: 60000, maxBytes: 200000 });
  const prevReview = readJsonIfExists(path.join(p.logsDir, `plan-review-v${v - 1}.json`));
  const previousFindings = Array.isArray(prevReview?.findings)
    ? prevReview.findings.map((f) => `[${f.severity || '?'}] ${f.buoc ? `${f.buoc}: ` : ''}${f.problem || JSON.stringify(f)}`).slice(0, 40)
    : [];
  const diff = d.truncated ? `[diff qua dai — chi con phan cuoi, thieu header]\n${d.stdout || ''}` : (d.stdout || '');
  return { fromVersion: v - 1, toVersion: v, diff: truncate(diff, 8000), previousFindings };
}

/** Dong trang thai phan bien ke hoach: treo / sai khuon (tu nhac 1 lan) / san sang. */
export async function tinhTrangPhanBien(cfg, task) {
  const L = [];
  const p = contractPaths(cfg, task);
  const critique = path.join(p.dir, 'plan-review.json');
  if (!task.planReviewDispatchedAt || task.verdicts?.plan?.verdict === 'pass') return L;
  if (!fs.existsSync(critique)) {
    const phut = Math.round((Date.now() - Date.parse(task.planReviewDispatchedAt)) / 60000);
    if (phut >= (cfg.stallMinutes || 12)) L.push(`plan-review.json: REVIEW TREO — giao phan bien ${phut} phut chua co file (T0024 tung im >30 phut). pm_status nudge=true de nhac, hoac dispatch lai.`);
    else L.push(`plan-review.json: chua co (giao ${phut} phut truoc)`);
    return L;
  }
  const review = readJsonIfExists(critique);
  const loi = kiemKhuonPlanReview(review);
  if (loi.length) {
    L.push(`plan-review.json: SAI KHUON (${loi.join('; ')})`);
    // Tu nhac agent ghi lai — DUNG MOT LAN cho moi plan_hash, khong spam moi lan pm_status.
    const key = task.planHashSent || 'x';
    if (task.planReviewNudge?.hash !== key && task.planReviewConversationId) {
      // pm_status la tool doc — Antigravity dong thi chi bao, khong duoc no.
      try {
        const msg = buildPlanReviewFixMessage(cfg, task, loi, task.planHashSent);
        await sendMessage({ conversationId: task.planReviewConversationId, projectId: projectIdFor(cfg), content: msg });
        updateTask(cfg, task, (t) => {
          t.planReviewNudge = { hash: key, at: nowIso() };
          addHistory(t, 'pm', 'plan_review_fix_nudge', loi.join('; '));
        });
        L.push('  -> da tu nhac agent ghi lai dung khuon (1 lan). Goi lai pm_status sau vai phut.');
      } catch (e) {
        L.push(`  -> khong nhac duoc agent (${String(e.message || e).split('\n')[0].slice(0, 120)}) — Antigravity dang dong? Nhac tay bang pm_message toAudit hoac dispatch lai.`);
      }
    }
    return L;
  }
  const khop = !task.planHashSent || review.plan_hash === task.planHashSent;
  L.push(`plan-review.json: co · verdict=${review.verdict} · ${review.findings.length} finding${khop ? '' : ` · PLAN_HASH KHONG KHOP (${String(review.plan_hash || '').slice(0, 12)} vs ${task.planHashSent.slice(0, 12)}) — phan bien ban cu`}`);
  const kq = kiemBaoCao(cfg.projectRoot, review);
  L.push(`  trich dan: ${dongTomTat(kq)}${kq.bia.length ? ` — BIA: ${kq.bia.slice(0, 5).map((b) => `${b.file}:${b.line}`).join(', ')}` : ''}`);
  return L;
}
