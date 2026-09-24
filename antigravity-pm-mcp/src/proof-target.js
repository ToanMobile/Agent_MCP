// Chon be mat chup anh TRUOC khi screencap.
// adb devices truoc. Serial khai bao chi dung khi state=device.
// Offline: mo AVD da khai, hoac provider web, hoac lenh launch.
// Khong screencap vao dia chi chet. Khong lay serial trong denylist.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { run, exists } from './util.js';

export function parseAdbDevices(text) {
  const out = [];
  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('List of devices') || line.startsWith('*')) continue;
    const parts = line.split(/\s+/);
    if (parts.length < 2) continue;
    const serial = parts[0];
    let state = parts[1];
    if (state === 'no' && parts[2] === 'permissions') state = 'no-permissions';
    if (!/^[\w.:-]+$/.test(serial)) continue;
    out.push({ serial, state });
  }
  return out;
}

export function parseDenySerials(text) {
  const set = new Set();
  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, '').trim();
    if (!line) continue;
    for (const s of line.split(/[\s,]+/)) {
      if (s) set.add(s);
    }
  }
  return set;
}

export function loadDenySerials(projectRoot) {
  const chunks = [];
  if (process.env.ADB_DENY_SERIALS) chunks.push(String(process.env.ADB_DENY_SERIALS).replace(/,/g, '\n'));
  const files = [path.join(os.homedir(), '.config', 'universal-agent-devkit', 'adb-denylist')];
  if (projectRoot) files.push(path.join(projectRoot, '.adb-denylist'));
  for (const f of files) {
    try { chunks.push(fs.readFileSync(f, 'utf8')); } catch { /* khong co file */ }
  }
  return parseDenySerials(chunks.join('\n'));
}

function isHostPort(serial) {
  return /^[^:\s]+:\d+$/.test(String(serial || ''));
}

/**
 * @returns {{action:string, serial?:string, avd?:string, providerName?:string, command?:string, warnings:string[], message?:string}}
 */
export function planCaptureTarget({ configured, devices, denied, provider, providers, connectTried }) {
  const deny = denied instanceof Set ? denied : new Set(denied || []);
  const list = devices || [];
  const warnings = [];
  const online = list.filter((d) => d.state === 'device' && !deny.has(d.serial));

  if (configured && deny.has(configured)) {
    return { action: 'fail', warnings, message: `Serial ${configured} nam trong denylist — khong chup.` };
  }

  if (configured) {
    const hit = list.find((d) => d.serial === configured);
    if (hit?.state === 'device') return { action: 'screencap', serial: configured, warnings };
    if (!connectTried && isHostPort(configured)) return { action: 'connect', serial: configured, warnings };
    warnings.push(`Serial ${configured} khong online (${hit ? hit.state : 'khong co trong adb devices'}).`);
  } else if (online.length === 1) {
    return { action: 'screencap', serial: online[0].serial, warnings };
  } else if (online.length > 1) {
    return {
      action: 'fail',
      warnings,
      message: `Nhieu thiet bi online (${online.map((d) => d.serial).join(', ')}), khai serial cu the.`,
    };
  }

  if (provider?.avd) return { action: 'boot-avd', avd: String(provider.avd), warnings };

  const fallbackName = provider?.whenOffline;
  if (fallbackName && providers?.[fallbackName]) {
    warnings.push(`Serial offline, chuyen sang provider ${fallbackName}.`);
    return { action: 'switch', providerName: fallbackName, warnings };
  }

  const web = Object.entries(providers || {}).find(([, p]) =>
    p && ['browser', 'qa-visual', 'playwright'].includes(p.type) && (p.url || p.start));
  if (web) {
    warnings.push(`Khong co thiet bi adb online, mo provider ${web[0]} (${web[1].type}).`);
    return { action: 'switch', providerName: web[0], warnings };
  }

  if (provider?.launch) return { action: 'launch', command: String(provider.launch), warnings };

  const listed = list.map((d) => `${d.serial}=${d.state}${deny.has(d.serial) ? ' denylist' : ''}`).join(', ') || '(khong co)';
  return {
    action: 'fail',
    warnings,
    message: `Khong co be mat de chup. Serial khai bao: ${configured || '(trong)'}. adb devices: ${listed}. `
      + 'Serial khong online thi khong screencap vao dia chi do, khong lay may denylist. '
      + 'Khai provider.avd (mo may ao), provider web/browser, hoac provider.launch.',
  };
}

export function nextEmulatorPort(devices, start = 5554) {
  let port = Number(start) || 5554;
  if (port % 2 !== 0) port += 1;
  for (let i = 0; i < 16; i += 1) {
    const taken = (devices || []).some((d) => d.serial === `emulator-${port}`);
    if (!taken) return port;
    port += 2;
  }
  return port;
}

export function findEmulatorBinary() {
  const roots = [
    process.env.ANDROID_HOME,
    process.env.ANDROID_SDK_ROOT,
    '/Volumes/Data/AndroidSDK',
    path.join(os.homedir(), 'Library', 'Android', 'sdk'),
  ];
  for (const root of roots) {
    if (!root) continue;
    const bin = path.join(root, 'emulator', 'emulator');
    if (exists(bin)) return bin;
  }
  return null;
}

export async function adbReadinessLines(cfg, runFn = run) {
  const provs = Object.entries(cfg.proof?.providers || {}).filter(([, p]) => p?.type === 'adb');
  if (!provs.length) return [];
  const adb = provs[0][1].adb || 'adb';
  const denied = loadDenySerials(cfg.projectRoot);
  const r = await runFn(adb, ['devices', '-l'], { timeoutMs: 8000 });
  if (r.spawnFailed) return [`adb: khong chay duoc (${String(r.stderr || '').trim()})`];
  const devices = parseAdbDevices(`${r.stdout || ''}\n${r.stderr || ''}`);
  const shown = devices.map((d) => `${d.serial}=${d.state}${denied.has(d.serial) ? ' (denylist, khong chup)' : ''}`).join(', ')
    || '(khong co thiet bi)';
  const lines = [`adb devices: ${shown}`];
  for (const [name, p] of provs) {
    const serial = p.serial || '(trong)';
    const hit = p.serial ? devices.find((d) => d.serial === p.serial) : null;
    if (p.serial && denied.has(p.serial)) {
      lines.push(`  provider ${name}: serial ${serial} nam trong denylist`);
    } else if (p.serial && hit?.state === 'device') {
      lines.push(`  provider ${name}: serial ${serial} dang online`);
    } else if (!p.serial && devices.filter((d) => d.state === 'device' && !denied.has(d.serial)).length === 1) {
      lines.push(`  provider ${name}: khong khai serial, se dung may online duy nhat`);
    } else {
      const next = p.avd ? `se mo AVD ${p.avd}` : (p.whenOffline ? `se chuyen ${p.whenOffline}` : 'chua khai avd/web/launch');
      lines.push(`  provider ${name}: serial ${serial} KHONG online — ${next}`);
    }
  }
  return lines;
}
