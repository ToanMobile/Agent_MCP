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
import { run } from './util.js';

/** SHA git hop le (hex 7-40). Moi thu khac ("HEAD; rm -rf", "--output=...") khong duoc dua vao git. */
export const SHA_RE = /^[0-9a-f]{7,40}$/;

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
  // baseCommit co nhung sai khuon (bi sua tay?) => CHUA XAC MINH, khong lui ve "chi cay lam viec".
  if (!base && task?.baseCommit) return undefined;
  if (!base) return hopNhatFileThayDoi(snap.wt, []);
  const d = await run('git', ['--no-pager', 'diff', '--name-only', `${base}..HEAD`], { cwd: cfg.projectRoot, timeoutMs: 60000 });
  const committed = d.code === 0 ? d.stdout.split('\n').map((l) => l.trim()).filter(Boolean) : [];
  return hopNhatFileThayDoi(snap.wt, committed);
}

/** Anh chup `git status`: wt = moi file thay doi, untracked = file chua track. ok=false khi khong doc duoc git. */
export async function gitSnapshot(cfg) {
  // --untracked-files=all: khong gop thu muc moi thanh "src/test/" — phai thay tung file de doi chieu voi files_changed.
  // -z: ten file khong bi quote/escape (tieng Viet, dau cach) va rename co 2 truong rieng.
  const r = await run('git', ['status', '--porcelain=v1', '-z', '--untracked-files=all'], { cwd: cfg.projectRoot, timeoutMs: 60000, maxBytes: 16_000_000 });
  if (r.code !== 0) return { ok: false, wt: undefined, untracked: [], raw: r.stdout || '' };
  // Output bi cat (giu duoi) => dong dau co the la nua duong dan: CHUA XAC MINH thay vi doan.
  if (r.truncated) return { ok: false, wt: undefined, untracked: [], raw: '', reason: 'git status qua lon (bi cat)' };
  // Thu muc trang thai cua chinh tool (task.json tu ghi moi lan record) khong phai thay doi cua agent.
  const stateDir = `${String(cfg.stateDir || '.antigravity-pm').replace(/^\.\//, '').replace(/\/+$/, '')}/`;
  const cuaAgent = (f) => f && !f.startsWith(stateDir);
  const fields = r.stdout.split('\0');
  const wt = [];
  const untracked = [];
  for (let i = 0; i < fields.length; i += 1) {
    const e = fields[i];
    if (e.length < 4) continue;
    const xy = e.slice(0, 2);
    const file = e.slice(3);
    if (xy.includes('R') || xy.includes('C')) i += 1; // truong ke tiep la ten CU — giu ten moi
    if (!cuaAgent(file)) continue;
    wt.push(file);
    if (xy === '??') untracked.push(file);
  }
  return { ok: true, wt, untracked, raw: r.stdout.replaceAll('\0', '\n') };
}

/** Commit goc cua task: task.baseCommit, hoac (task cu) commit cuoi cung truoc createdAt. */
export async function baseCommitOf(cfg, task) {
  if (!task) return null;
  if (task.baseCommit) return SHA_RE.test(String(task.baseCommit)) ? task.baseCommit : null;
  if (!task.createdAt || Number.isNaN(Date.parse(task.createdAt))) return null;
  const r = await run('git', ['rev-list', '-1', `--before=${task.createdAt}`, 'HEAD'], { cwd: cfg.projectRoot, timeoutMs: 60000 });
  const sha = r.code === 0 ? r.stdout.trim() : '';
  return SHA_RE.test(sha) ? sha : null;
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
  const add = await run('git', ['worktree', 'add', '--detach', dir, 'HEAD'], { cwd: cfg.projectRoot, timeoutMs: 120000 });
  if (add.code !== 0) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* da don */ }
    return { error: (add.stderr || add.stdout).trim().slice(0, 400) };
  }
  const snap = await gitSnapshot(cfg);
  let applied = 0;
  const d = await run('git', ['--no-pager', 'diff', 'HEAD', '--binary'], { cwd: cfg.projectRoot, timeoutMs: 120000, maxBytes: 50_000_000 });
  // Patch bi cat (giu duoi) thi khong con la patch hop le — dung lai thay vi dung cay sai.
  if (d.truncated) { await goWorktree(cfg, dir); return { error: 'git diff vuot 50 MB — khong dung duoc worktree dong bang (patch bi cat)' }; }
  if (d.stdout.trim()) {
    const patch = path.join(dir, '.agpm-wt.patch');
    fs.writeFileSync(patch, d.stdout);
    const ap = await run('git', ['apply', '--index', patch], { cwd: dir, timeoutMs: 120000 });
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
  await run('git', ['worktree', 'remove', '--force', dir], { cwd: cfg.projectRoot, timeoutMs: 60000 });
  await run('git', ['worktree', 'prune'], { cwd: cfg.projectRoot, timeoutMs: 60000 });
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
