// ORACLE DO -> XANH do PM TU REPLAY, khong tin loi khai cua agent.
//
// Cach lam (ban giao OfficeReader 14/09/2026):
//   1. `git worktree add --detach <tmp> <baseCommit>`  — code GOC truoc khi agent sua.
//   2. Chep CHI file test agent da doi (giao voi mustHave.testFilePatterns) + oracle.copyToWorktree
//      (vi du local.properties) vao worktree. Khong chep code sua => test moi chay tren code cu phai DO.
//   3. Chay lenh oracle trong worktree => RED. Hop le chi khi bang chung noi test DA CHAY va DO
//      (XML moi co failures+errors>0; khong co XML thi it nhat exit!=0 va khong noop — weak).
//      exit!=0 ma khong co test nao do = "do vi ly do khac" (compile/build) => KHONG hop le.
//   4. Chay LAI dung lenh tren cay that => GREEN theo cung dinh nghia xanh cua gate.
//   5. finally: `git worktree remove --force` + `git worktree prune`.
//
// File nay KHONG dung tasks.js (tranh vong import); tools.js ghi ket qua vao run record kind='oracle'.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runShell, run } from './util.js';
import { collectTestEvidence } from './evidence.js';
import { mustHaveOf, matchesAny, chuanHoaDuongDan } from './policy.js';

/**
 * Ky hieu chua ton tai o code goc ma test tham chieu (Kotlin/Java/C#/TS). Do 14/09/2026 tren GeelyEx2 T0023:
 * 4 test moi dung SttDecodeStep / VoiceLanePolicy — la test cho API MOI, khong the replay o baseCommit.
 * Oracle chi co nghia cho test HOI QUY tren API co san; PM can biet ngay de khong do loi cho moi truong.
 */
export function kyHieuChuaCo(output) {
  const s = String(output || '');
  const out = new Set();
  for (const m of s.matchAll(/Unresolved reference[:]? '([^']+)'/g)) out.add(m[1]);
  for (const m of s.matchAll(/cannot find symbol[\s\S]{0,80}?symbol:\s+\w+\s+(\w+)/g)) out.add(m[1]);
  for (const m of s.matchAll(/error CS\d+: The (?:name|type or namespace name) '([^']+)'/g)) out.add(m[1]);
  for (const m of s.matchAll(/Cannot find (?:name|module) '([^']+)'/g)) out.add(m[1]);
  return [...out].slice(0, 12);
}

/** RED hop le = test da chay va co it nhat mot test do. Tra ve { valid, reason, weak }. */
export function danhGiaRed(r, ev, output = '') {
  if (r.timedOut) return { valid: false, weak: false, reason: 'lenh oracle qua han trong worktree' };
  if (ev.noop) return { valid: false, weak: false, reason: `khong test nao chay trong worktree (${ev.noopRule})` };
  const thieu = kyHieuChuaCo(output);
  if (r.code !== 0 && thieu.length) {
    return {
      valid: false, weak: false, symbols: thieu,
      reason: `test tham chieu ky hieu CHUA CO o code goc (${thieu.join(', ')}) — day la test cho API moi, khong replay duoc; oracle chi co nghia voi test hoi quy tren API co san. Agent can mot test tai hien LOI HANH VI bang API cu, hoac PM ghi nhan gioi han nay`,
    };
  }
  if (ev.source === 'xml') {
    if (ev.files === 0) {
      return {
        valid: false, weak: false,
        reason: r.code === 0 ? 'exit 0 va khong co XML moi — test khong chay' : `exit ${r.code} nhung khong co XML ket qua moi — do vi ly do khac (compile/build/thieu file), khong phai test do`,
      };
    }
    if ((ev.failures || 0) + (ev.errors || 0) > 0) {
      return { valid: true, weak: false, reason: `${ev.failures} failures + ${ev.errors} errors tren code goc: ${(ev.failedNames || []).join(', ')}` };
    }
    return { valid: false, weak: false, reason: `test XANH tren code goc (${ev.tests} test, 0 do) — test khong co rang, khong tai hien duoc loi` };
  }
  // Khong co XML: chi biet exit code + stdout.
  if (r.code === 0) return { valid: false, weak: true, reason: 'exit 0 tren code goc — test khong co rang (khong co XML de kiem sau hon)' };
  if (ev.swallowed) return { valid: true, weak: true, reason: `stdout bao test do (${ev.swallowedRule}) tren code goc — weak, project chua khai testEvidence.resultsGlob` };
  return { valid: true, weak: true, reason: `exit ${r.code} tren code goc — weak: khong phan biet duoc "test do" voi "do vi ly do khac" (khai testEvidence.resultsGlob de chac)` };
}

/** File test agent da doi (theo danh sach file thay doi cua task) + file phu project khai. */
export function fileCanChep(cfg, changedFiles) {
  const must = mustHaveOf(cfg);
  const tests = (changedFiles || []).map(chuanHoaDuongDan).filter((f) => f && matchesAny(f, must.testFilePatterns));
  const extra = (Array.isArray(cfg?.oracle?.copyToWorktree) ? cfg.oracle.copyToWorktree : []).map(chuanHoaDuongDan).filter(Boolean);
  return { tests, extra: extra.filter((e) => !tests.includes(e)) };
}

/**
 * Chep file HOAC THU MUC (de quy) vao worktree. Thu muc: dung cho lib nhi phan bi gitignore
 * (do 14/09/2026 tren GeelyEx2: worktree thieu CarConnect/app/libs/sherpa-onnx-*.aar => Gradle do truoc khi toi test).
 */
export function chepVaoWorktree(root, dest, rel) {
  const src = path.resolve(root, rel);
  let st;
  try { st = fs.statSync(src); } catch { return false; }
  const to = path.resolve(dest, rel);
  fs.mkdirSync(path.dirname(to), { recursive: true });
  if (st.isDirectory()) fs.cpSync(src, to, { recursive: true, force: true, filter: (p) => !/(^|\/)(\.DS_Store|build|\.gradle)$/.test(p) });
  else fs.copyFileSync(src, to);
  return true;
}
const chepFile = chepVaoWorktree;

/**
 * Replay oracle. Tra ve object ghi thang vao run record:
 *   { command, baseCommit, testFilesCopied, extraCopied, red: {exitCode, timedOut, valid, weak, reason, evidence},
 *     green: {exitCode, timedOut, ok, reason, evidence}, ok, blocked, redLog, greenLog }
 * blocked != null nghia la KHONG chay duoc (thieu baseCommit, worktree loi) — khong phai "oracle sai".
 */
export async function replayOracle(cfg, { baseCommit, command, changedFiles, timeoutMs }) {
  if (!baseCommit) return { command, baseCommit: null, ok: false, blocked: 'task khong co baseCommit (tao boi ban cu / khong phai git repo) — khong dung duoc code goc de tai hien' };
  if (!command || !String(command).trim()) return { command: null, baseCommit, ok: false, blocked: 'khong co lenh oracle: agent chua khai result.oracle.command va PM khong truyen command' };
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'agpm-oracle-'));
  const out = { command, baseCommit, testFilesCopied: [], extraCopied: [], red: null, green: null, ok: false, blocked: null, redLog: '', greenLog: '' };
  try {
    const add = await run('git', ['worktree', 'add', '--detach', tmp, baseCommit], { cwd: cfg.projectRoot, timeoutMs: 120000 });
    if (add.code !== 0) {
      out.blocked = `git worktree add that bai (exit ${add.code}): ${(add.stderr || add.stdout).trim().slice(0, 400)}`;
      return out;
    }
    const { tests, extra } = fileCanChep(cfg, changedFiles);
    for (const f of tests) if (chepFile(cfg.projectRoot, tmp, f)) out.testFilesCopied.push(f);
    for (const f of extra) if (chepFile(cfg.projectRoot, tmp, f)) out.extraCopied.push(f);
    if (out.testFilesCopied.length === 0) {
      out.blocked = 'khong co file test nao cua agent de chep sang code goc (task chua doi file test nao) — oracle khong the do';
      return out;
    }
    // RED trong worktree.
    const cfgWt = { ...cfg, projectRoot: tmp };
    const s1 = Date.now();
    const r1 = await runShell(command, { cwd: tmp, timeoutMs });
    const ev1 = collectTestEvidence(cfgWt, { startedMs: s1, stdout: r1.stdout, stderr: r1.stderr });
    const red = danhGiaRed(r1, ev1, `${r1.stdout}\n${r1.stderr}`);
    out.red = { exitCode: r1.code, timedOut: r1.timedOut, valid: red.valid, weak: red.weak, reason: red.reason, symbols: red.symbols || [], evidence: ev1 };
    out.redLog = `$ ${command}\n(cwd ${tmp} @ ${baseCommit})\nexit=${r1.code} timedOut=${r1.timedOut}\n\n--- stdout ---\n${r1.stdout}\n--- stderr ---\n${r1.stderr}\n`;
    if (!red.valid) return out;
    // GREEN tren cay that.
    const s2 = Date.now();
    const r2 = await runShell(command, { cwd: cfg.projectRoot, timeoutMs });
    const ev2 = collectTestEvidence(cfg, { startedMs: s2, stdout: r2.stdout, stderr: r2.stderr });
    const ok = r2.code === 0 && !r2.timedOut && ev2.ok === true;
    out.green = { exitCode: r2.code, timedOut: r2.timedOut, ok, reason: ok ? ev2.reason : (r2.code !== 0 ? `exit ${r2.code} tren cay that — van do sau khi sua` : ev2.reason), evidence: ev2 };
    out.greenLog = `$ ${command}\n(cwd ${cfg.projectRoot})\nexit=${r2.code} timedOut=${r2.timedOut}\n\n--- stdout ---\n${r2.stdout}\n--- stderr ---\n${r2.stderr}\n`;
    out.ok = ok;
    return out;
  } finally {
    await run('git', ['worktree', 'remove', '--force', tmp], { cwd: cfg.projectRoot, timeoutMs: 60000 });
    await run('git', ['worktree', 'prune'], { cwd: cfg.projectRoot, timeoutMs: 60000 });
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* da bi worktree remove don */ }
  }
}

/** Mot dong cho PM. */
export function oracleLine(o) {
  if (!o) return 'chua replay';
  if (o.blocked) return `BLOCKED: ${o.blocked}`;
  const red = o.red ? `RED ${o.red.valid ? 'hop le' : 'KHONG hop le'}${o.red.weak ? ' (weak)' : ''}: ${o.red.reason}` : 'RED: chua chay';
  const green = o.green ? `GREEN ${o.green.ok ? 'dat' : 'KHONG dat'}: ${o.green.reason}` : 'GREEN: chua chay (RED khong hop le)';
  return `${o.ok ? 'ORACLE DAT' : 'ORACLE CHUA DAT'} — ${red} | ${green}`;
}
