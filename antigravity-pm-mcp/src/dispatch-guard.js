// Cong truoc khi giao trien khai: task khac dang chay chong lan (mustHave.exclusiveDirs), cay chua commit
// khong co moc cuu ho, file rac. Bai hoc 12–13/09/2026: hai task cung dung shared/ de len nhau.
import { listTasks, freshness } from './tasks.js';
import { fileRacGocRepo, phamViTask, dangChay, kiemChongLan } from './policy.js';
import { gitSnapshot } from './worktree.js';

/**
 * Task khac dang chay tren cung cay ma + pham vi file cua chung (PM khai + agent khai).
 * Vi sao (13/09/2026): T0009 va T0011 giao song song cung dung shared/, T0009 git checkout file cua T0011.
 */
export function cacTaskDangChayKhac(cfg, task) {
  return listTasks(cfg)
    .filter((t) => t.id !== task.id && dangChay(t))
    .map((t) => ({ id: t.id, title: t.title, phase: t.phase, files: phamViTask(t, freshness(cfg, t).result) }));
}

/** Dong canh bao truoc khi giao trien khai: chong lan task khac + cay chua commit. Tra ve { lines, blocked }. */
export async function canhBaoTruocKhiGiao(cfg, task, force) {
  const lines = [];
  let blocked = null;
  const others = cacTaskDangChayKhac(cfg, task);
  const mine = phamViTask(task, freshness(cfg, task).result);
  if (others.length) {
    lines.push(`Task khac dang chay tren cung cay ma: ${others.map((o) => `${o.id} (${o.phase}${o.files.length ? `, ${o.files.length} file` : ', chua ro pham vi'})`).join('; ')}`);
    const { overlaps, exclusive } = kiemChongLan(cfg, { id: task.id, files: mine }, others);
    for (const o of overlaps) lines.push(`CHONG LAN voi ${o.taskId}: ${o.files.slice(0, 10).join(', ')} — hai agent sua cung file se de len nhau`);
    if (exclusive.length) {
      const msg = exclusive.map((e) => `${e.taskId} cung dung thu muc doc quyen "${e.dir}"`).join('; ');
      if (force) lines.push(`CANH BAO (force): ${msg}`);
      else blocked = `KHONG giao song song: ${msg}. Cho task kia xong (cay bien dich duoc) roi giao, hoac force=true neu chac chan.`;
    }
    if (!mine.length) lines.push('Task nay chua khai pham vi file (pm_plan files=[...]) nen khong do duoc chong lan chinh xac.');
  }
  const snap = await gitSnapshot(cfg);
  if (snap.ok && snap.wt.length && cfg.commitPolicy === 'forbid') {
    lines.push(`Cay ma dang co ${snap.wt.length} file chua commit va commitPolicy=forbid => KHONG co moc de quay ve neu agent lam mat. `
      + 'Nen tao nhanh WIP + commit moc cuu ho truoc khi giao (bai hoc 12/09/2026).');
  }
  const rac = snap.ok ? fileRacGocRepo(snap.untracked, cfg) : [];
  if (rac.length) lines.push(`File rac o goc repo: ${rac.join(', ')}`);
  return { lines, blocked };
}
