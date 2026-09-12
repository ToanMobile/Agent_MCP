// Sau rule lay tu AGENTS.md cua project that (OfficeReader) dua vao hop dong prompt.
// Moi test khoa MOT rule: prompt mat cau do thi test do.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../src/config.js';
import { createTask } from '../src/tasks.js';
import {
  buildPlanPrompt,
  buildImplementMessage,
  buildReworkMessage,
  buildPlanReworkMessage,
  buildAuditPrompt,
} from '../src/prompt.js';
import { tmpProject, cleanup, sampleTaskArgs } from './helpers.js';

function setup(config = {}) {
  const dir = tmpProject(config);
  const cfg = loadConfig(dir);
  const task = createTask(cfg, sampleTaskArgs());
  return { dir, cfg, task };
}

test('rule 1 — moi prompt deu mang khoi CAM BIA', () => {
  const { dir, cfg, task } = setup({ testCommand: 'make test' });
  const prompts = [
    buildPlanPrompt(cfg, task),
    buildImplementMessage(cfg, task),
    buildReworkMessage(cfg, task, { findings: ['x'] }),
    buildPlanReworkMessage(cfg, task, { findings: ['x'] }),
    buildAuditPrompt(cfg, task),
  ];
  for (const p of prompts) {
    assert.match(p, /Cam bia/i, 'thieu tieu de khoi cam bia');
    assert.match(p, /toi khong co du lieu nay/i, 'phai day agent cach noi khi khong biet');
    assert.match(p, /phu dinh/i, 'phai bat search truoc khi noi cau phu dinh');
  }
  cleanup(dir);
});

test('rule 2 — sua loi phai co oracle DO truoc khi sua, XANH sau khi sua', () => {
  const { dir, cfg, task } = setup({ testCommand: 'make test' });
  const msg = buildImplementMessage(cfg, task);
  assert.match(msg, /THAY NO DO|thay no do/i, 'phai doi quan sat trang thai do TRUOC khi sua');
  assert.match(msg, /sau khi sua/i);
  assert.match(msg, /"oracle"/, 'result.json phai co truong oracle de ghi lai cap do -> xanh');
  assert.match(msg, /doc log cu|suy luan/i, 'phai noi ro suy luan tu source khong tinh la oracle');
  cleanup(dir);
});

test('rule 3 — cam sua test cho xanh (co ca o luc tra viec)', () => {
  const { dir, cfg, task } = setup({});
  for (const msg of [buildImplementMessage(cfg, task), buildReworkMessage(cfg, task, { findings: ['x'] })]) {
    assert.match(msg, /CAM sua test/i, 'phai cam be test cho xanh');
    assert.match(msg, /ky vong cu la sai/i, 'phai neu duong thoat hop le duy nhat');
  }
  cleanup(dir);
});

test('rule 4 — khong chay test nao thi khong phai xanh, phai ghi so pass/fail/skip', () => {
  const { dir, cfg, task } = setup({ testCommand: 'make test' });
  const msg = buildImplementMessage(cfg, task);
  assert.match(msg, /UP-TO-DATE/, 'phai goi ten cac dau hieu "chua chay"');
  assert.match(msg, /No tests found/i);
  assert.match(msg, /"skipped"/, 'schema phai doi so test bi bo qua');
  assert.match(msg, /"passed"/);
  assert.match(msg, /"failed"/);
  cleanup(dir);
});

test('rule 5 — doi signature/API dung chung thi phai liet ke noi dang dung TRUOC', () => {
  const { dir, cfg, task } = setup({});
  const prompt = buildPlanPrompt(cfg, task);
  assert.match(prompt, /signature/i);
  assert.match(prompt, /liet ke/i);
  assert.match(prompt, /thu muc test|src\/test/i, 'phai nhac tim ca trong test, cho hay bi bo sot');
  cleanup(dir);
});

test('rule 6 — sua cung mot file den lan thu 3 khong co bang chung moi thi phai dung', () => {
  const { dir, cfg, task } = setup({});
  const msg = buildImplementMessage(cfg, task);
  assert.match(msg, /lan thu 3/i);
  assert.match(msg, /blocked/, 'phai bao dung lai va bao PM qua truong blocked');
  cleanup(dir);
});
