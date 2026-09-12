// Tien ich dung chung: chay lenh (khong bao gio nuot exit code), ghi file nguyen khoi, log stderr.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

/** Chay 1 lenh, tra ve exit code that. KHONG BAO GIO nuot loi. */
export function run(cmd, args = [], opts = {}) {
  return new Promise((resolve) => {
    const started = Date.now();
    const child = spawn(cmd, args, {
      cwd: opts.cwd,
      env: { ...process.env, ...(opts.env || {}) },
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: Boolean(opts.shell),
    });
    let out = '';
    let err = '';
    let timedOut = false;
    const limit = opts.maxBytes ?? 4_000_000;
    child.stdout.on('data', (d) => { if (out.length < limit) out += d.toString(); });
    child.stderr.on('data', (d) => { if (err.length < limit) err += d.toString(); });
    const timer = opts.timeoutMs
      ? setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, opts.timeoutMs)
      : null;
    child.on('error', (e) => {
      if (timer) clearTimeout(timer);
      resolve({ code: -1, stdout: out, stderr: `${err}\nspawn error: ${e.message}`, durationMs: Date.now() - started, timedOut, spawnFailed: true });
    });
    child.on('close', (code, signal) => {
      if (timer) clearTimeout(timer);
      resolve({
        code: code === null ? -1 : code,
        signal: signal || null,
        stdout: out,
        stderr: err,
        durationMs: Date.now() - started,
        timedOut,
        spawnFailed: false,
      });
    });
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

export function homeStateDir() {
  return ensureDir(path.join(os.homedir(), '.antigravity-pm'));
}

export function logStderr(...args) {
  if (process.env.ANTIGRAVITY_PM_QUIET === '1') return;
  process.stderr.write(`[antigravity-pm] ${args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ')}\n`);
}
