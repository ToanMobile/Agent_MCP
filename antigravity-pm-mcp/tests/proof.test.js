import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { loadConfig } from '../src/config.js';
import { captureProof } from '../src/proof.js';
import { tmpProject, cleanup, writeFile, PNG_1PX } from './helpers.js';

test('nhan anh co san (anh do agent tu chup) vao ho so', async () => {
  const dir = tmpProject({});
  const cfg = loadConfig(dir);
  const src = writeFile(path.join(dir, 'agent-shot.png'), PNG_1PX);
  const out = await captureProof(cfg, { proofDir: path.join(dir, 'proof'), label: 'man hinh xac nhan', sourceFile: src });
  assert.ok(fs.existsSync(out.file));
  assert.equal(out.mime, 'image/png');
  assert.ok(out.base64.length > 10);
  assert.ok(out.warnings.some((w) => w.includes('byte')), 'anh 1x1 phai bi canh bao la dang ngo');
  cleanup(dir);
});

test('provider shell: chay lenh tu khai de sinh anh', async () => {
  const dir = tmpProject({});
  const b64File = writeFile(path.join(dir, 'b64.txt'), PNG_1PX.toString('base64'));
  writeFile(path.join(dir, '.antigravity-pm.json'), JSON.stringify({
    proof: { providers: { fake: { type: 'shell', command: `base64 --decode < ${b64File} > {{out}}` } } },
  }));
  const cfg = loadConfig(dir);
  const out = await captureProof(cfg, { proofDir: path.join(dir, 'proof'), label: 'tu lenh', providerName: 'fake' });
  assert.equal(out.provider, 'fake');
  assert.equal(out.mime, 'image/png');
  cleanup(dir);
});

test('lenh chay xong nhung ra thu khong phai anh => no to, khong lua PM', async () => {
  const dir = tmpProject({ proof: { providers: { bad: { type: 'shell', command: 'echo "day khong phai anh" > {{out}}' } } } });
  const cfg = loadConfig(dir);
  await assert.rejects(
    () => captureProof(cfg, { proofDir: path.join(dir, 'proof'), label: 'x', providerName: 'bad' }),
    /khong phai anh/,
  );
  cleanup(dir);
});

test('lenh chup that bai (exit != 0) => bao loi kem exit code', async () => {
  const dir = tmpProject({ proof: { providers: { bad: { type: 'shell', command: 'exit 7' } } } });
  const cfg = loadConfig(dir);
  await assert.rejects(
    () => captureProof(cfg, { proofDir: path.join(dir, 'proof'), label: 'x', providerName: 'bad' }),
    /exit 7/,
  );
  cleanup(dir);
});

test('provider khong ton tai => noi ro con nhung provider nao', async () => {
  const dir = tmpProject({ proof: { providers: { xe: { type: 'adb', serial: '1.2.3.4:5555' } } } });
  const cfg = loadConfig(dir);
  await assert.rejects(
    () => captureProof(cfg, { proofDir: path.join(dir, 'proof'), label: 'x', providerName: 'khong-co' }),
    /xe/,
  );
  cleanup(dir);
});

test('chua khai provider nao va khong co sourceFile => huong dan cach khai', async () => {
  const dir = tmpProject({});
  const cfg = loadConfig(dir);
  await assert.rejects(
    () => captureProof(cfg, { proofDir: path.join(dir, 'proof'), label: 'x' }),
    /proof.providers/,
  );
  cleanup(dir);
});

test('adb: serial offline thi mo AVD, khong screencap vao IP chet', async () => {
  const dir = tmpProject({});
  const state = path.join(dir, 'state');
  fs.mkdirSync(state);
  writeFile(path.join(state, 'shot.png'), PNG_1PX);
  const adb = writeFile(path.join(dir, 'fake-adb.sh'), `#!/bin/sh
echo "$@" >> "${dir}/calls"
if [ "$1" = "devices" ]; then
  echo "List of devices attached"
  if [ -f "${state}/booted" ]; then echo "emulator-5554 device"; fi
  exit 0
fi
if [ "$1" = "connect" ]; then exit 0; fi
if [ "$1" = "-s" ] && [ "$3" = "shell" ]; then echo 1; exit 0; fi
if [ "$1" = "-s" ] && [ "$3" = "exec-out" ]; then cat "${state}/shot.png"; exit 0; fi
echo "lenh la: $*" >&2
exit 1
`);
  const emu = writeFile(path.join(dir, 'fake-emu.sh'), `#!/bin/sh
echo "$@" >> "${dir}/emu-args"
touch "${state}/booted"
exit 0
`);
  fs.chmodSync(adb, 0o755);
  fs.chmodSync(emu, 0o755);
  writeFile(path.join(dir, '.antigravity-pm.json'), JSON.stringify({
    proof: {
      providers: {
        device: {
          type: 'adb', serial: '192.168.1.20:5555', avd: 'PhoneConnect', adb, emulator: emu,
          connectTimeoutMs: 1000, bootTimeoutMs: 5000,
        },
      },
    },
  }));
  const cfg = loadConfig(dir);
  const out = await captureProof(cfg, { proofDir: path.join(dir, 'proof'), label: 'may ao', providerName: 'device' });
  assert.equal(out.mime, 'image/png');
  assert.match(out.command, /emulator-5554/);
  assert.equal(out.command.includes('192.168.1.20:5555'), false);
  assert.ok(out.warnings.some((w) => w.includes('PhoneConnect')));
  assert.match(fs.readFileSync(path.join(dir, 'emu-args'), 'utf8'), /PhoneConnect/);
  cleanup(dir);
});

test('adb: may khac online va nam denylist thi khong screencap may do', async () => {
  const dir = tmpProject({});
  const adb = writeFile(path.join(dir, 'fake-adb.sh'), `#!/bin/sh
echo "$@" >> "${dir}/calls"
if [ "$1" = "devices" ]; then
  echo "List of devices attached"
  echo "RFCWA1KQT1Y device"
  exit 0
fi
if [ "$1" = "connect" ]; then exit 0; fi
if [ "$1" = "-s" ]; then echo leaked >&2; exit 1; fi
exit 1
`);
  fs.chmodSync(adb, 0o755);
  writeFile(path.join(dir, '.adb-denylist'), 'RFCWA1KQT1Y\n');
  writeFile(path.join(dir, '.antigravity-pm.json'), JSON.stringify({
    proof: { providers: { device: { type: 'adb', serial: '192.168.1.20:5555', adb, connectTimeoutMs: 1000 } } },
  }));
  const cfg = loadConfig(dir);
  await assert.rejects(
    () => captureProof(cfg, { proofDir: path.join(dir, 'proof'), label: 'x', providerName: 'device' }),
    /Khong co be mat/,
  );
  const calls = fs.readFileSync(path.join(dir, 'calls'), 'utf8');
  assert.equal(calls.includes('screencap'), false);
  assert.equal(calls.includes('-s RFCWA1KQT1Y'), false);
  cleanup(dir);
});

test('provider qa-visual: can url hop le', async () => {
  const dir = tmpProject({ proof: { providers: { web: { type: 'qa-visual' } } } });
  const cfg = loadConfig(dir);
  await assert.rejects(
    () => captureProof(cfg, { proofDir: path.join(dir, 'proof'), label: 'webshot', providerName: 'web' }),
    /provider qa-visual can "url"/,
  );
  cleanup(dir);
});

