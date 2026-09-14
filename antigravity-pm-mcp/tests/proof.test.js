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
