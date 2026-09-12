// Chup / thu nhan ANH NGHIEM THU.
//
// "Xong task" trong repo nay khong phai loi noi: phai co anh chay that. Provider khai
// trong .antigravity-pm.json de moi project tu chon cach chup (adb tu xe/may ao, man hinh
// macOS, hay 1 lenh tuy y).
import fs from 'node:fs';
import path from 'node:path';
import { run, runShell, ensureDir, nowIso, slug, exists } from './util.js';

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
const JPG_MAGIC = Buffer.from([0xff, 0xd8, 0xff]);
/** Anh nho hon nguong nay thuong la man hinh den/trang — dang ngo. */
const SUSPICIOUS_BYTES = 8 * 1024;

export function describeProviders(cfg) {
  const provs = cfg.proof?.providers || {};
  return Object.entries(provs).map(([name, p]) => ({ name, type: p.type, detail: p.serial || p.command || p.args || null }));
}

function imageKind(file) {
  try {
    const fd = fs.openSync(file, 'r');
    const buf = Buffer.alloc(8);
    fs.readSync(fd, buf, 0, 8, 0);
    fs.closeSync(fd);
    if (buf.subarray(0, 4).equals(PNG_MAGIC)) return 'image/png';
    if (buf.subarray(0, 3).equals(JPG_MAGIC)) return 'image/jpeg';
    return null;
  } catch {
    return null;
  }
}

async function sipsWidth(file) {
  const r = await run('/usr/bin/sips', ['-g', 'pixelWidth', file], { timeoutMs: 20000 });
  const m = /pixelWidth:\s*(\d+)/.exec(r.stdout);
  return m ? Number(m[1]) : null;
}

async function downscale(file, maxWidth) {
  if (!exists('/usr/bin/sips') || !maxWidth) return sipsWidth(file);
  const w = await sipsWidth(file);
  if (w && w > maxWidth) {
    await run('/usr/bin/sips', ['-Z', String(maxWidth), file], { timeoutMs: 60000 });
    return sipsWidth(file);
  }
  return w;
}

/** Chay 1 provider, tra ve duong dan anh vua tao. */
async function capture(cfg, provider, outFile, extra = {}) {
  const type = provider.type;
  ensureDir(path.dirname(outFile));
  if (type === 'adb') {
    const adb = provider.adb || 'adb';
    const serial = extra.serial || provider.serial;
    const sel = serial ? `-s ${JSON.stringify(serial)} ` : '';
    const cmd = `${adb} ${sel}exec-out screencap -p > ${JSON.stringify(outFile)}`;
    const r = await runShell(cmd, { timeoutMs: provider.timeoutMs || 90000 });
    return { cmd, r };
  }
  if (type === 'macos') {
    const args = ['-x', '-t', 'png'];
    if (provider.region || extra.region) args.push('-R', String(extra.region || provider.region));
    if (provider.window || extra.window) args.push('-l', String(extra.window || provider.window));
    args.push(outFile);
    const r = await run('/usr/sbin/screencapture', args, { timeoutMs: provider.timeoutMs || 60000 });
    return { cmd: `screencapture ${args.join(' ')}`, r };
  }
  if (type === 'shell') {
    if (!provider.command) throw new Error(`provider shell thieu "command"`);
    const cmd = String(provider.command).replaceAll('{{out}}', outFile);
    const r = await runShell(cmd, { timeoutMs: provider.timeoutMs || 180000, cwd: cfg.projectRoot });
    return { cmd, r };
  }
  if (type === 'file') {
    const src = extra.sourceFile || provider.sourceFile;
    if (!src) throw new Error('provider file can "sourceFile"');
    const abs = path.isAbsolute(src) ? src : path.resolve(cfg.projectRoot, src);
    if (!exists(abs)) throw new Error(`Khong thay file anh: ${abs}`);
    fs.copyFileSync(abs, outFile);
    return { cmd: `cp ${abs}`, r: { code: 0, stdout: '', stderr: '', durationMs: 0 } };
  }
  throw new Error(`Khong biet provider type "${type}" (chi ho tro adb | macos | shell | file)`);
}

/**
 * Lay 1 anh nghiem thu.
 * @returns {Promise<{file:string,bytes:number,width:number|null,mime:string,base64:string,warnings:string[],command:string}>}
 */
export async function captureProof(cfg, { proofDir, label, providerName, sourceFile, serial, region, window: win }) {
  const warnings = [];
  let provider;
  let usedName = providerName || cfg.proof?.defaultProvider || null;

  if (sourceFile && !usedName) {
    usedName = 'file';
    provider = { type: 'file', sourceFile };
  } else {
    const provs = cfg.proof?.providers || {};
    if (!usedName) {
      const names = Object.keys(provs);
      if (names.length === 1) usedName = names[0];
    }
    if (!usedName) {
      throw new Error(
        `Chua biet chup bang cach nao. Khai "proof.providers" trong .antigravity-pm.json hoac truyen sourceFile. `
        + `Provider dang co: ${Object.keys(provs).join(', ') || '(khong co)'}`,
      );
    }
    provider = usedName === 'file' ? { type: 'file', sourceFile } : provs[usedName];
    if (!provider) throw new Error(`Khong thay provider "${usedName}" trong cau hinh (co: ${Object.keys(provs).join(', ') || 'khong co'})`);
  }

  const stamp = nowIso().replace(/[:.]/g, '-');
  const outFile = path.join(ensureDir(proofDir), `${stamp}__${slug(label || 'proof', 40)}.png`);
  const { cmd, r } = await capture(cfg, provider, outFile, { sourceFile, serial, region, window: win });

  if (r.timedOut) throw new Error(`Chup anh qua han: ${cmd}`);
  if (r.code !== 0) throw new Error(`Chup anh that bai (exit ${r.code}): ${cmd}\n${(r.stderr || r.stdout || '').slice(0, 800)}`);
  if (!exists(outFile)) throw new Error(`Lenh chup chay xong nhung khong sinh file: ${cmd}`);

  const mime0 = imageKind(outFile);
  if (!mime0) {
    const head = fs.readFileSync(outFile).subarray(0, 200).toString('utf8');
    throw new Error(`File tao ra khong phai anh PNG/JPEG: ${outFile}\nDau file: ${head.slice(0, 200)}`);
  }

  const width = await downscale(outFile, cfg.proof?.maxWidth || 1280);
  let bytes = fs.statSync(outFile).size;
  if (bytes < SUSPICIOUS_BYTES) {
    warnings.push(`Anh chi ${bytes} byte — rat co the man hinh dang tat/trang. Kiem tra lai truoc khi dung lam bang chung.`);
  }

  // Ep nho de nhet duoc vao 1 khoi anh MCP.
  let b64 = fs.readFileSync(outFile).toString('base64');
  for (const w of [900, 640]) {
    if (b64.length <= 1_200_000) break;
    await run('/usr/bin/sips', ['-Z', String(w), outFile], { timeoutMs: 60000 });
    b64 = fs.readFileSync(outFile).toString('base64');
    bytes = fs.statSync(outFile).size;
    warnings.push(`Anh qua to, da thu nho ve ${w}px de gui kem.`);
  }

  return {
    file: outFile,
    bytes,
    width,
    mime: imageKind(outFile) || 'image/png',
    base64: b64,
    warnings,
    command: cmd,
    provider: usedName,
  };
}
