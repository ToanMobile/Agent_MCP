// Tien ich dung chung: chay lenh (khong bao gio nuot exit code), ghi file nguyen khoi, log stderr.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

// Nhom tien trinh con dang song (detached => khong tu chet theo server): server thoat thi don luon.
const LIVE = new Set();
function killLive() {
  for (const pid of LIVE) { try { process.kill(-pid, 'SIGKILL'); } catch { /* da chet */ } }
  LIVE.clear();
}
process.once('exit', killLive);
// 'exit' KHONG chay khi server bi SIGTERM/SIGINT/SIGHUP (Claude dong phien, kill nhom) — ma con da tach nhom
// rieng nen cung khong chet theo. Bat tin hieu: don nhom con roi chet dung bang tin hieu do (giu ma thoat).
for (const sig of ['SIGTERM', 'SIGINT', 'SIGHUP']) {
  process.once(sig, () => {
    killLive();
    process.kill(process.pid, sig);
  });
}

/** Chay 1 lenh, tra ve exit code that. KHONG BAO GIO nuot loi. */
export function run(cmd, args = [], opts = {}) {
  return new Promise((resolve) => {
    const started = Date.now();
    // detached: con la truong nhom tien trinh rieng => qua han thi giet CA NHOM (shell + gradle/java chau chat),
    // khong chi rieng shell. Truoc day SIGKILL chi trung shell, chau giu pipe => promise doi 'close' mai mai.
    const group = process.platform !== 'win32';
    const child = spawn(cmd, args, {
      cwd: opts.cwd,
      env: { ...process.env, ...(opts.env || {}) },
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: Boolean(opts.shell),
      detached: group,
    });
    if (group && child.pid) LIVE.add(child.pid);
    // Gom BUFFER roi giai ma MOT LAN o cuoi: `chunk.toString()` tung khuc cat ky tu UTF-8 nhieu byte
    // (tieng Viet) o ranh gioi chunk thanh U+FFFD — do 14/09/2026: patch `git diff` 1,4 MB co tieng Viet
    // bi hong => `git apply` tu choi trong worktree dong bang.
    // Vuot tran thi giu DUOI (N byte cuoi): loi test/"BUILD FAILED" nam o cuoi log, khong phai o dau.
    const limit = opts.maxBytes ?? 4_000_000;
    const ring = () => ({ chunks: [], len: 0, cut: false });
    const bufs = { out: ring(), err: ring() };
    const push = (b, d) => {
      b.chunks.push(d);
      b.len += d.length;
      while (b.len > limit && b.chunks.length) {
        const over = b.len - limit;
        const head = b.chunks[0];
        if (head.length <= over) { b.chunks.shift(); b.len -= head.length; } else { b.chunks[0] = head.subarray(over); b.len -= over; }
        b.cut = true;
      }
    };
    child.stdout.on('data', (d) => push(bufs.out, d));
    child.stderr.on('data', (d) => push(bufs.err, d));
    const text = (b) => {
      let buf = Buffer.concat(b.chunks);
      // Cat dau co the roi giua ky tu UTF-8 nhieu byte: bo cac byte tiep noi (10xxxxxx) o dau.
      if (b.cut) { let i = 0; while (i < buf.length && i < 4 && (buf[i] & 0xc0) === 0x80) i += 1; buf = buf.subarray(i); }
      return buf.toString('utf8');
    };
    const out = () => text(bufs.out);
    const err = () => text(bufs.err);
    let timedOut = false;
    let done = false;
    const finish = (r) => {
      if (done) return;
      done = true;
      LIVE.delete(child.pid);
      if (timer) clearTimeout(timer);
      resolve({ ...r, truncated: bufs.out.cut || bufs.err.cut });
    };
    const killAll = () => {
      try {
        if (group && child.pid) process.kill(-child.pid, 'SIGKILL'); else child.kill('SIGKILL');
      } catch {
        try { child.kill('SIGKILL'); } catch { /* da chet */ }
      }
      // Chau (neu thoat khoi nhom) van co the giu pipe: dong phia ta de khong treo.
      child.stdout.destroy();
      child.stderr.destroy();
    };
    const timer = opts.timeoutMs
      ? setTimeout(() => { timedOut = true; killAll(); }, opts.timeoutMs)
      : null;
    const result = (code, signal) => ({
      code: code === null ? -1 : code,
      signal: signal || null,
      stdout: out(),
      stderr: err(),
      durationMs: Date.now() - started,
      timedOut,
      spawnFailed: false,
    });
    child.on('error', (e) => {
      finish({ code: -1, stdout: out(), stderr: `${err()}\nspawn error: ${e.message}`, durationMs: Date.now() - started, timedOut, spawnFailed: true });
    });
    // Qua han: tra ve ngay khi con thoat ('exit'), khong doi 'close' (chau co the con giu pipe).
    child.on('exit', (code, signal) => { if (timedOut) finish(result(code, signal)); });
    child.on('close', (code, signal) => finish(result(code, signal)));
  });
}

/** Chay qua shell (cho testCommand kieu "./gradlew test"). */
export function runShell(command, opts = {}) {
  return run(process.env.SHELL || '/bin/sh', ['-lc', command], opts);
}

export function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
  return p;
}

/** Ghi nguyen khoi: ghi file tam roi rename, tranh file JSON dut giua. */
export function writeFileAtomic(file, data) {
  ensureDir(path.dirname(file));
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp, data);
  fs.renameSync(tmp, file);
  return file;
}

export function writeJsonAtomic(file, obj) {
  return writeFileAtomic(file, `${JSON.stringify(obj, null, 2)}\n`);
}

export function readJsonIfExists(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

export function exists(p) {
  try { fs.accessSync(p); return true; } catch { return false; }
}

export function nowIso() {
  return new Date().toISOString();
}

/** Bo dau tieng Viet + ky tu la de lam id thu muc an toan. */
export function slug(s, max = 48) {
  const map = { a: 'àáảãạăằắẳẵặâầấẩẫậ', e: 'èéẻẽẹêềếểễệ', i: 'ìíỉĩị', o: 'òóỏõọôồốổỗộơờớởỡợ', u: 'ùúủũụưừứửữự', y: 'ỳýỷỹỵ', d: 'đ' };
  let t = String(s || '').toLowerCase();
  for (const [plain, accents] of Object.entries(map)) {
    for (const ch of accents) t = t.split(ch).join(plain);
  }
  return t.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, max) || 'task';
}

export function tail(text, lines = 60) {
  const arr = String(text || '').split('\n');
  return arr.slice(-lines).join('\n');
}

export function truncate(text, max = 8000) {
  const s = String(text ?? '');
  if (s.length <= max) return s;
  return `${s.slice(0, max)}\n… [cat bot ${s.length - max} ky tu]`;
}

/** Che token trong moi chuoi truoc khi log / tra ve cho model. */
export function redact(text, secrets = []) {
  let s = String(text ?? '');
  for (const sec of secrets) {
    if (sec && sec.length >= 8) s = s.split(sec).join('***REDACTED***');
  }
  return s.replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b(?=[^\n]*(csrf|token))/gi, '***REDACTED***');
}

/** Thu muc trang thai o HOME (~/.antigravity-pm). ANTIGRAVITY_PM_STATE_HOME de tro sang cho khac (test dung). */
export function homeStateDir() {
  return ensureDir(process.env.ANTIGRAVITY_PM_STATE_HOME || path.join(os.homedir(), '.antigravity-pm'));
}

export function logStderr(...args) {
  if (process.env.ANTIGRAVITY_PM_QUIET === '1') return;
  process.stderr.write(`[antigravity-pm] ${args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ')}\n`);
}
