// Tim "tay cam" RPC loopback cua chinh IDE Antigravity dang chay tren may nay.
//
// Antigravity tu bom 2 bien moi truong (dia chi language server + khoa phien CSRF cua
// loopback) vao moi terminal no mo ra. Khi MCP server nay chay NGOAI IDE thi phai lay
// lai dung cap do tu process table — chinh xac nhu terminal tich hop cua Antigravity lam.
//
// Quy tac bat buoc: khoa phien CHI nam trong bo nho, KHONG ghi ra file, KHONG tra ve cho model.
// Cache chi luu pid + cong.
import fs from 'node:fs';
import path from 'node:path';
import { run, homeStateDir, readJsonIfExists, writeJsonAtomic, logStderr } from './util.js';

export const ENV_ADDRESS = 'ANTIGRAVITY_LS_ADDRESS';
export const ENV_TOKEN = 'ANTIGRAVITY_CSRF_TOKEN';

const LS_PROC_MATCH = 'language_server';
const CACHE_FILE = () => path.join(homeStateDir(), 'ls.json');
const NIL_UUID = '00000000-0000-0000-0000-000000000000';

export class AntigravityUnavailable extends Error {
  constructor(message, hint) {
    super(message);
    this.name = 'AntigravityUnavailable';
    this.hint = hint || 'Mo app Antigravity va mo dung project can lam viec, roi thu lai.';
  }
}

/** Duong dan binary agentapi. */
export function agentapiPath() {
  const home = process.env.HOME || '';
  const candidates = [
    process.env.ANTIGRAVITY_PM_AGENTAPI,
    process.env.ANTIGRAVITY_AGENTAPI_EXE,
    path.join(home, '.gemini/antigravity/bin/agentapi'),
    path.join(home, '.gemini/antigravity-ide/bin/agentapi'),
  ].filter(Boolean);
  for (const c of candidates) {
    try { fs.accessSync(c, fs.constants.X_OK); return c; } catch { /* thu cai ke tiep */ }
  }
  return null;
}

/** Doc process table, lay pid + khoa phien cua language_server dang chay. */
async function findLsProcess() {
  const ps = await run('/bin/ps', ['ax', '-o', 'pid=,command='], { timeoutMs: 15000 });
  if (ps.code !== 0 && !ps.stdout) throw new AntigravityUnavailable('Khong doc duoc process table (ps that bai).');
  const lines = ps.stdout.split('\n').filter((l) => l.includes(LS_PROC_MATCH) && l.includes('--standalone'));
  for (const line of lines) {
    const pid = Number(line.trim().split(/\s+/)[0]);
    const m = /--csrf_token[= ]([0-9a-fA-F-]{8,})/.exec(line);
    if (pid && m) return { pid, secret: m[1] };
  }
  throw new AntigravityUnavailable(
    'Khong thay tien trinh Antigravity language_server nao dang chay.',
    'Mo app Antigravity (va mo project can lam) roi thu lai — MCP nay dieu khien IDE dang mo, khong tu bat IDE len.',
  );
}

/** Liet ke cong LISTEN cua pid do. */
async function listenPorts(pid) {
  const r = await run('/usr/sbin/lsof', ['-nP', '-iTCP', '-sTCP:LISTEN', '-a', '-p', String(pid)], { timeoutMs: 20000 });
  const ports = [];
  for (const line of r.stdout.split('\n').slice(1)) {
    const m = /:(\d+)\s+\(LISTEN\)/.exec(line);
    if (m) ports.push(Number(m[1]));
  }
  return [...new Set(ports)];
}

/** Goi thu 1 cong: true neu day dung la dau gRPC ma agentapi noi duoc. */
async function probePort(address, secret, agentapi) {
  const r = await run(agentapi, ['get-conversation-metadata', NIL_UUID], {
    timeoutMs: 25000,
    env: { [ENV_ADDRESS]: address, [ENV_TOKEN]: secret },
  });
  const blob = `${r.stdout}${r.stderr}`;
  if (/Unauthenticated|missing CSRF/i.test(blob)) return false;
  if (/connection error|connection reset|Unavailable/i.test(blob)) return false;
  // Noi duoc = hoac tra ve metadata, hoac bao khong tim thay conversation.
  return /"response"|NotFound|not found|InvalidArgument/i.test(blob);
}

/**
 * Tra ve { address, secret, pid, agentapi, source }.
 * force=true: bo cache, do lai tu dau (goi khi RPC bat dau loi).
 */
export async function discover({ force = false } = {}) {
  const agentapi = agentapiPath();
  if (!agentapi) {
    throw new AntigravityUnavailable(
      'Khong tim thay binary agentapi cua Antigravity.',
      'Mo Antigravity 1 lan de no sinh ~/.gemini/antigravity/bin/agentapi, hoac tro bien ANTIGRAVITY_PM_AGENTAPI vao dung file.',
    );
  }

  // Neu MCP nay duoc chay TU TRONG terminal cua Antigravity thi da co san env.
  if (process.env[ENV_ADDRESS] && process.env[ENV_TOKEN]) {
    return {
      address: process.env[ENV_ADDRESS],
      secret: process.env[ENV_TOKEN],
      pid: null,
      agentapi,
      source: 'env',
    };
  }

  const { pid, secret } = await findLsProcess();

  if (!force) {
    const cached = readJsonIfExists(CACHE_FILE());
    if (cached && cached.pid === pid && cached.address) {
      if (await probePort(cached.address, secret, agentapi)) {
        return { address: cached.address, secret, pid, agentapi, source: 'cache' };
      }
    }
  }

  const ports = await listenPorts(pid);
  if (ports.length === 0) {
    throw new AntigravityUnavailable(`language_server (pid ${pid}) khong mo cong LISTEN nao.`);
  }
  for (const p of ports) {
    const address = `127.0.0.1:${p}`;
    if (await probePort(address, secret, agentapi)) {
      writeJsonAtomic(CACHE_FILE(), { pid, address, at: new Date().toISOString() });
      logStderr(`da noi duoc language_server tai ${address} (pid ${pid})`);
      return { address, secret, pid, agentapi, source: 'probe' };
    }
  }
  throw new AntigravityUnavailable(
    `Thay language_server (pid ${pid}) nhung khong cong nao trong [${ports.join(', ')}] tra loi agentapi.`,
    'Antigravity co the dang khoi dong hoac vua doi phien ban. Thu lai sau vai giay, hoac khoi dong lai IDE.',
  );
}

export function forgetCache() {
  try { fs.rmSync(CACHE_FILE(), { force: true }); } catch { /* khong sao */ }
}
