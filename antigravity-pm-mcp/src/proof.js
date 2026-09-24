// Chup / thu nhan ANH NGHIEM THU.
//
// "Xong task" trong repo nay khong phai loi noi: phai co anh chay that. Provider khai
// trong .antigravity-pm.json de moi project tu chon cach chup (adb tu xe/may ao, man hinh
// macOS, hay 1 lenh tuy y).
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { run, runShell, ensureDir, nowIso, slug, exists } from './util.js';
import {
  parseAdbDevices, planCaptureTarget, nextEmulatorPort, findEmulatorBinary, loadDenySerials,
} from './proof-target.js';

export { adbReadinessLines } from './proof-target.js';

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
const JPG_MAGIC = Buffer.from([0xff, 0xd8, 0xff]);
/** Anh nho hon nguong nay thuong la man hinh den/trang — dang ngo. */
const SUSPICIOUS_BYTES = 8 * 1024;

export function describeProviders(cfg) {
  const provs = cfg.proof?.providers || {};
  return Object.entries(provs).map(([name, p]) => ({ name, type: p.type, detail: p.serial || p.avd || p.url || p.command || p.args || null }));
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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function portOpen(host, port, timeoutMs = 800) {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port });
    const done = (ok) => { socket.destroy(); resolve(ok); };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => done(true));
    socket.once('timeout', () => done(false));
    socket.once('error', () => done(false));
  });
}

/** Mo dev server khi URL localhost chua nghe. Khong lam gi neu provider khong khai start. */
async function ensureUrlUp(cfg, provider, url) {
  if (!provider.start || !url) return [];
  let parsed;
  try { parsed = new URL(url); } catch { return []; }
  if (parsed.protocol === 'file:') return [];
  const port = Number(parsed.port) || (parsed.protocol === 'https:' ? 443 : 80);
  if (await portOpen(parsed.hostname, port)) return [];
  const r = await runShell(String(provider.start), { timeoutMs: provider.timeoutMs || 180000, cwd: cfg.projectRoot });
  if (r.code !== 0) {
    throw new Error(`Mo cong cu web that bai (exit ${r.code}): ${provider.start}\n${(r.stderr || r.stdout || '').slice(0, 400)}`);
  }
  return [`Da chay provider.start vi ${url} chua mo.`];
}

function spawnDetached(cmd, args) {
  const child = spawn(cmd, args, { detached: true, stdio: 'ignore', env: process.env });
  child.unref();
  return child.pid;
}

async function emulatorAvdName(adb, serial, runFn) {
  if (!String(serial).startsWith('emulator-')) return null;
  const r = await runFn(adb, ['-s', serial, 'emu', 'avd', 'name'], { timeoutMs: 5000 });
  const line = `${r.stdout || ''}\n${r.stderr || ''}`.split(/\r?\n/).map((s) => s.trim())
    .find((s) => s && s !== 'OK' && !s.startsWith('Android') && !s.startsWith('error'));
  return line || null;
}

async function waitForEmulator(adb, serial, runFn, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const listed = parseAdbDevices((await runFn(adb, ['devices'], { timeoutMs: 8000 })).stdout);
    const hit = listed.find((d) => d.serial === serial && d.state === 'device');
    if (hit) {
      const prop = await runFn(adb, ['-s', serial, 'shell', 'getprop', 'sys.boot_completed'], { timeoutMs: 8000 });
      if (String(prop.stdout || '').trim() === '1') return true;
    }
    await sleep(400);
  }
  return false;
}

/**
 * Kiem adb devices. Serial online thi dung. Offline thi connect ngan (ip:port),
 * roi mo AVD / chuyen web / chay launch. Khong tra serial khong online.
 */
export async function prepareAdbTarget(cfg, provider, extra = {}) {
  const runFn = extra.runFn || run;
  const adb = provider.adb || 'adb';
  const denied = loadDenySerials(cfg.projectRoot);
  const configured = extra.serial || provider.serial || null;
  const providers = cfg.proof?.providers || {};
  const readDevices = async () => parseAdbDevices((await runFn(adb, ['devices'], { timeoutMs: 8000 })).stdout);
  let devices = await readDevices();
  let plan = planCaptureTarget({ configured, devices, denied, provider, providers, connectTried: false });
  const warnings = [];

  if (plan.action === 'connect') {
    await runFn(adb, ['connect', plan.serial], { timeoutMs: provider.connectTimeoutMs || 5000 });
    devices = await readDevices();
    plan = planCaptureTarget({ configured, devices, denied, provider, providers, connectTried: true });
  }
  warnings.push(...(plan.warnings || []));

  if (plan.action === 'screencap') return { serial: plan.serial, warnings };

  if (plan.action === 'boot-avd') {
    for (const d of devices) {
      if (d.state !== 'device' || !String(d.serial).startsWith('emulator-') || denied.has(d.serial)) continue;
      const name = await emulatorAvdName(adb, d.serial, runFn);
      if (name === plan.avd) {
        warnings.push(`AVD ${plan.avd} da mo tai ${d.serial}, khong mo them.`);
        return { serial: d.serial, warnings };
      }
    }
    const bin = provider.emulator || findEmulatorBinary();
    if (!bin) throw new Error(`Serial offline va khong tim thay binary emulator de mo AVD ${plan.avd}.`);
    const port = nextEmulatorPort(devices, provider.emulatorPort || 5554);
    const args = ['-avd', plan.avd, '-port', String(port), '-no-boot-anim', ...(provider.emulatorArgs || [])];
    spawnDetached(bin, args);
    const serial = `emulator-${port}`;
    const budget = provider.bootTimeoutMs || 180000;
    const ok = await waitForEmulator(adb, serial, runFn, budget);
    if (!ok) throw new Error(`Mo AVD ${plan.avd} tai ${serial} nhung khong boot xong trong ${budget}ms.`);
    warnings.push(`Da mo AVD ${plan.avd} tai ${serial} vi ${configured || 'khong co serial'} khong online.`);
    return { serial, warnings };
  }

  if (plan.action === 'switch') return { switchTo: plan.providerName, warnings };

  if (plan.action === 'launch') {
    const r = await runFn(process.env.SHELL || '/bin/sh', ['-lc', plan.command], {
      timeoutMs: provider.timeoutMs || 180000, cwd: cfg.projectRoot,
    });
    if (r.code !== 0) throw new Error(`launch that bai (exit ${r.code}): ${plan.command}`);
    devices = await readDevices();
    const after = planCaptureTarget({
      configured: null, devices, denied, provider: { ...provider, avd: null, launch: null, whenOffline: null },
      providers, connectTried: true,
    });
    if (after.action !== 'screencap') throw new Error(after.message || 'launch chay xong nhung van khong co thiet bi');
    warnings.push(...(after.warnings || []), `Da chay launch vi serial khong online.`);
    return { serial: after.serial, warnings };
  }

  throw new Error(plan.message || `Khong chup duoc (ke hoach ${plan.action}).`);
}

/** Chay 1 provider, tra ve duong dan anh vua tao. */
async function capture(cfg, provider, outFile, extra = {}) {
  const type = provider.type;
  ensureDir(path.dirname(outFile));
  if (type === 'adb') {
    const ready = await prepareAdbTarget(cfg, provider, extra);
    if (ready.switchTo) {
      if ((extra._depth || 0) > 2) throw new Error('Chuyen provider qua nhieu lan');
      const next = (cfg.proof?.providers || {})[ready.switchTo];
      if (!next) throw new Error(`Khong thay provider ${ready.switchTo}`);
      const inner = await capture(cfg, next, outFile, { ...extra, serial: undefined, _depth: (extra._depth || 0) + 1 });
      return { ...inner, warnings: [...(ready.warnings || []), ...(inner.warnings || [])], provider: ready.switchTo };
    }
    const adb = provider.adb || 'adb';
    const serial = ready.serial;
    const args = [...(serial ? ['-s', String(serial)] : []), 'exec-out', 'screencap', '-p'];
    // Ghi PNG nhi phan qua redirect cua sh, nhung moi gia tri la THAM SO VI TRI ("$0" "$@", "$AGPM_OUT") —
    // khong noi chuoi vao lenh => serial/duong dan co $(...) khong chay duoc.
    const r = await run('/bin/sh', ['-c', 'exec "$0" "$@" > "$AGPM_OUT"', adb, ...args],
      { timeoutMs: provider.timeoutMs || 90000, env: { AGPM_OUT: outFile } });
    return { cmd: `${adb} ${args.join(' ')} > ${outFile}`, r, warnings: ready.warnings || [] };
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
  if (type === 'browser') {
    // Trinh duyet headless cho task web/SQL (khong co thiet bi de chup). URL/file do PM truyen (extra.url) hoac provider.url.
    const url = extra.url || provider.url;
    if (!url) throw new Error('provider browser can "url" (http(s)://... hoac file:///...)');
    const upWarnings = await ensureUrlUp(cfg, provider, url);
    const bin = provider.binary || timChrome();
    if (!bin) throw new Error('Khong tim thay Chrome/Chromium — khai provider.binary');
    const size = provider.windowSize || '1280,800';
    const args = ['--headless=new', '--disable-gpu', '--hide-scrollbars', `--window-size=${size}`, `--screenshot=${outFile}`, ...(provider.args || []), url];
    const r = await run(bin, args, { timeoutMs: provider.timeoutMs || 60000, cwd: cfg.projectRoot });
    return { cmd: `${bin} ${args.join(' ')}`, r, warnings: upWarnings };
  }
  if (type === 'qa-visual' || type === 'playwright') {
    // Chup bang Playwright / qa-visual voi doi on dinh trang, form login, audit layout
    const url = extra.url || provider.url;
    if (!url) throw new Error('provider qa-visual can "url" (http(s)://... hoac file:///...)');
    const upWarnings = await ensureUrlUp(cfg, provider, url);
    const width = provider.width || 1280;
    const height = provider.height || 800;

    const qaVisualScript = [
      path.join(cfg.projectRoot, '.claude', 'skills', 'qa-visual', 'scripts', 'capture-screens.mjs'),
      path.join(cfg.projectRoot, 'universal-agent-devkit', 'skills', 'qa-visual', 'scripts', 'capture-screens.mjs'),
      path.join(os.homedir(), '.claude', 'skills', 'qa-visual', 'scripts', 'capture-screens.mjs'),
      path.join(os.homedir(), '.gemini', 'config', 'skills', 'qa-visual', 'scripts', 'capture-screens.mjs'),
    ].find((p) => exists(p));

    let cmd, r;
    if (qaVisualScript && exists(path.join(cfg.projectRoot, 'qa.config.json'))) {
      cmd = `node ${qaVisualScript} --url ${url}`;
      r = await run(process.execPath, [qaVisualScript, '--url', String(url)], { timeoutMs: provider.timeoutMs || 90000, cwd: cfg.projectRoot });
    } else {
      const script = `import { chromium } from 'playwright';
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: ${width}, height: ${height} } });
const page = await context.newPage();
await page.goto(process.env.AGPM_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
await page.waitForTimeout(500);
await page.screenshot({ path: process.env.AGPM_OUT, fullPage: ${provider.fullPage ? 'true' : 'false'} });
await browser.close();`;
      cmd = `playwright screenshot ${url}`;
      r = await run(process.execPath, ['--input-type=module', '-e', script],
        { timeoutMs: provider.timeoutMs || 90000, cwd: cfg.projectRoot, env: { AGPM_URL: String(url), AGPM_OUT: outFile } });
    }
    return { cmd, r, warnings: upWarnings };
  }
  if (type === 'file') {
    const src = extra.sourceFile || provider.sourceFile;
    if (!src) throw new Error('provider file can "sourceFile"');
    const abs = path.isAbsolute(src) ? src : path.resolve(cfg.projectRoot, src);
    if (!exists(abs)) throw new Error(`Khong thay file anh: ${abs}`);
    fs.copyFileSync(abs, outFile);
    return { cmd: `cp ${abs}`, r: { code: 0, stdout: '', stderr: '', durationMs: 0 } };
  }
  throw new Error(`Khong biet provider type "${type}" (chi ho tro adb | macos | shell | browser | qa-visual | playwright | file)`);
}

const CHROME_PATHS = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser',
];

/** Duong dan Chrome/Chromium dau tien ton tai; null neu khong co. */
export function timChrome() {
  return CHROME_PATHS.find((p) => exists(p)) || null;
}

/**
 * Lay 1 anh nghiem thu.
 * @returns {Promise<{file:string,bytes:number,width:number|null,mime:string,base64:string,warnings:string[],command:string}>}
 */
export async function captureProof(cfg, { proofDir, label, providerName, sourceFile, serial, region, window: win, url }) {
  const warnings = [];
  let provider;
  // sourceFile co mat => provider "file" thang defaultProvider (T0024, 14/09/2026: truyen sourceFile ma tool van
  // chay `adb screencap` vao xe roi lo "device not found"). Chi provider TRUYEN RO moi de len duoc.
  let usedName = providerName || (sourceFile ? 'file' : (cfg.proof?.defaultProvider || null));

  if (sourceFile && usedName === 'file') {
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
  const shot = await capture(cfg, provider, outFile, { sourceFile, serial, region, window: win, url });
  const { cmd, r } = shot;
  if (shot.provider) usedName = shot.provider;
  warnings.push(...(shot.warnings || []));

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
