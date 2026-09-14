// Cay lam viec & worktree dong bang: chup `git status`, file thay doi cua task (cay ∪ commit tu commit goc),
// ctx cho gate() (mtime file cua task, file rac, lint), va worktree tam = HEAD + diff + file moi.
// Chi goi git + doc dia; khong goi agent.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { freshness, hopNhatFileThayDoi } from './tasks.js';
import { mustHaveOf, fileRacGocRepo, cungFile, matchesAny } from './policy.js';
import { chepVaoWorktree } from './oracle.js';
import { soiThayDoi } from './lint-diff.js';
import { runShell } from './util.js';

/**
 * Danh sach file thay doi cua TASK: cay lam viec (da track + chua track) HOP voi moi file trong
 * cac commit ke tu commit goc cua task (task.baseCommit; task cu chua co thi lay commit cuoi
 * TRUOC luc tao task theo createdAt). Khong co task => chi cay lam viec nhu cu.
 * Tra ve undefined khi khong doc duoc git => cong chan se bao CHUA XAC MINH thay vi coi la dat.
 */
export async function changedFilesOf(cfg, task) {
  const snap = await gitSnapshot(cfg);
  if (!snap.ok) return undefined;
  const base = await baseCommitOf(cfg, task);
  if (!base) return hopNhatFileThayDoi(snap.wt, []);
  const d = await runShell(`git --no-pager diff --name-only ${base}..HEAD`, { cwd: cfg.projectRoot, timeoutMs: 60000 });
  const committed = d.code === 0 ? d.stdout.split('\n').map((l) => l.trim()).filter(Boolean) : [];
  return hopNhatFileThayDoi(snap.wt, committed);
}

/** Anh chup `git status`: wt = moi file thay doi, untracked = file chua track. ok=false khi khong doc duoc git. */
export async function gitSnapshot(cfg) {
  // --untracked-files=all: khong gop thu muc moi thanh "src/test/" — phai thay tung file de doi chieu voi files_changed.
  const r = await runShell('git status --porcelain=v1 --untracked-files=all', { cwd: cfg.projectRoot, timeoutMs: 60000 });
  if (r.code !== 0) return { ok: false, wt: undefined, untracked: [], raw: r.stdout || '' };
  // Thu muc trang thai cua chinh tool (task.json tu ghi moi lan record) khong phai thay doi cua agent.
  const stateDir = `${String(cfg.stateDir || '.antigravity-pm').replace(/^\.\//, '').replace(/\/+$/, '')}/`;
  const lines = r.stdout.split('\n').filter((l) => l.trim());
  const clean = (l) => l.slice(3).trim().replace(/^"|"$/g, '');
  const cuaAgent = (f) => f && !f.startsWith(stateDir);
  const wt = lines
    .map(clean)
    .filter(Boolean)
    .map((l) => (l.includes(' -> ') ? l.split(' -> ')[1] : l))
    .filter(cuaAgent);
  const untracked = lines.filter((l) => l.startsWith('??')).map(clean).filter(cuaAgent);
  return { ok: true, wt, untracked, raw: r.stdout };
}

/** Commit goc cua task: task.baseCommit, hoac (task cu) commit cuoi cung truoc createdAt. */
export async function baseCommitOf(cfg, task) {
  if (!task) return null;
  if (task.baseCommit) return task.baseCommit;
  if (!task.createdAt) return null;
  const r = await runShell(`git rev-list -1 --before="${task.createdAt}" HEAD`, { cwd: cfg.projectRoot, timeoutMs: 60000 });
  return r.code === 0 ? (r.stdout.trim() || null) : null;
}

/** Bang chung do tu git + mtime cho gate(): file thay doi, file chua track, thoi diem sua file cuoi (null = khong do duoc). */
export async function gateCtx(cfg, task) {
  const snap = await gitSnapshot(cfg);
  const changedFiles = await changedFilesOf(cfg, task);
  const soi = snap.ok ? soiThayDoi(cfg.projectRoot, snap.wt, await baseCommitOf(cfg, task)) : { warnings: [], blockers: [] };
  // Thu tu thoi gian chi do tren FILE CUA TASK (agent khai files_changed ∪ file test trong cay) — chu du an chot 14/09/2026:
  // cay GeelyEx2 co phien khac sua song song, do ca cay thi moi lan ho sua gi la phai chay lai test 3 phut.
  return {
    changedFiles,
    untrackedFiles: snap.untracked,
    lastChangeAt: snap.ok ? lastChangeAtOf(cfg, fileCuaTask(cfg, task, snap.wt)) : null,
    lintBlockers: soi.blockers,
    lintWarnings: soi.warnings,
  };
}

/** Worktree dong bang = HEAD + diff cay lam viec + file moi (tru thu muc trang thai va file rac). */
export async function dongBangCay(cfg) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agpm-run-'));
  const add = await runShell(`git worktree add --detach ${JSON.stringify(dir)} HEAD`, { cwd: cfg.projectRoot, timeoutMs: 120000 });
  if (add.code !== 0) return { error: (add.stderr || add.stdout).trim().slice(0, 400) };
  const snap = await gitSnapshot(cfg);
  let applied = 0;
  const d = await runShell('git --no-pager diff HEAD --binary', { cwd: cfg.projectRoot, timeoutMs: 120000, maxBytes: 50_000_000 });
  if (d.stdout.trim()) {
    const patch = path.join(dir, '.agpm-wt.patch');
    fs.writeFileSync(patch, d.stdout);
    const ap = await runShell(`git apply --index ${JSON.stringify(patch)}`, { cwd: dir, timeoutMs: 120000 });
    fs.rmSync(patch, { force: true });
    if (ap.code !== 0) { await goWorktree(cfg, dir); return { error: `git apply that bai: ${(ap.stderr || ap.stdout).trim().slice(0, 400)}` }; }
    applied = d.stdout.split('\n').filter((l) => l.startsWith('diff --git')).length;
  }
  let untracked = 0;
  const rac = new Set(fileRacGocRepo(snap.untracked, cfg));
  for (const f of snap.untracked) {
    if (rac.has(f)) continue;
    const src = path.resolve(cfg.projectRoot, f);
    if (!fs.existsSync(src) || !fs.statSync(src).isFile()) continue;
    const to = path.resolve(dir, f);
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(src, to);
    untracked += 1;
  }
  for (const f of cfg.oracle?.copyToWorktree || []) chepVaoWorktree(cfg.projectRoot, dir, f);
  return { dir, applied, untracked };
}

export async function goWorktree(cfg, dir) {
  await runShell(`git worktree remove --force ${JSON.stringify(dir)}`, { cwd: cfg.projectRoot, timeoutMs: 60000 });
  await runShell('git worktree prune', { cwd: cfg.projectRoot, timeoutMs: 60000 });
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* da don */ }
}

/** File trong cay lam viec thuoc ve task: agent khai trong files_changed, hoac la file test (luat "kem file test" dem chung). */
export function fileCuaTask(cfg, task, wt) {
  const claimed = freshness(cfg, task).result?.files_changed;
  const must = mustHaveOf(cfg);
  return (wt || []).filter((f) => (Array.isArray(claimed) && claimed.some((c) => cungFile(f, c))) || matchesAny(f, must.testFilePatterns));
}

/** mtime lon nhat cua cac file dang thay doi trong cay lam viec (ms). Khong file nao => 0 (cay sach, test luc nao cung sau). */
export function lastChangeAtOf(cfg, files) {
  let max = 0;
  for (const f of files || []) {
    try {
      const st = fs.statSync(path.resolve(cfg.projectRoot, f));
      if (st.mtimeMs > max) max = st.mtimeMs;
    } catch { /* file da xoa: khong co mtime, bo qua */ }
  }
  return max;
}
