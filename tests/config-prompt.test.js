import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { loadConfig, DEFAULT_CONFIG, resolveProjectRoot } from '../src/config.js';
import { createTask, contractPaths } from '../src/tasks.js';
import {
  buildPlanPrompt, buildImplementMessage, buildReworkMessage, buildPlanReworkMessage, buildAuditPrompt,
} from '../src/prompt.js';
import { tmpProject, tmpGlobalConfig, cleanup, writeFile, sampleTaskArgs } from './helpers.js';

test('cau hinh project ghi de mac dinh, khoa la thi canh bao chu khong no', () => {
  const dir = tmpProject({ testCommand: './gradlew test', proof: { require: 3 }, khoaLa: 1 });
  const cfg = loadConfig(dir);
  assert.equal(cfg.testCommand, './gradlew test');
  assert.equal(cfg.proof.require, 3);
  assert.equal(cfg.proof.maxWidth, DEFAULT_CONFIG.proof.maxWidth, 'khoa khong khai phai giu mac dinh');
  assert.equal(cfg.commitPolicy, 'forbid');
  assert.ok(cfg.warnings.some((w) => w.includes('khoaLa')));
  cleanup(dir);
});

test('commitPolicy sai thi tu ve forbid (mac dinh an toan)', () => {
  const dir = tmpProject({ commitPolicy: 'muon-lam-gi-cung-duoc' });
  const cfg = loadConfig(dir);
  assert.equal(cfg.commitPolicy, 'forbid');
  assert.ok(cfg.warnings.some((w) => w.includes('commitPolicy')));
  cleanup(dir);
});

test('cau hinh chung o HOME lam mac dinh cho project chua khai', () => {
  const g = tmpGlobalConfig({ defaultModel: 'flash', commitPolicy: 'forbid', runTimeoutMs: 1234567 });
  const dir = tmpProject({});
  const cfg = loadConfig(dir);
  assert.equal(cfg.defaultModel, 'flash');
  assert.equal(cfg.runTimeoutMs, 1234567);
  assert.equal(cfg.globalConfigFile, g.file, 'phai noi ro dang dung cau hinh chung nao');
  cleanup(dir);
  g.restore();
});

test('cau hinh project ghi de cau hinh chung', () => {
  const g = tmpGlobalConfig({ testCommand: 'make test', proof: { require: 5 } });
  const dir = tmpProject({ testCommand: './gradlew test' });
  const cfg = loadConfig(dir);
  assert.equal(cfg.testCommand, './gradlew test', 'project phai thang cau hinh chung');
  assert.equal(cfg.proof.require, 5, 'khoa project khong khai thi lay tu cau hinh chung');
  cleanup(dir);
  g.restore();
});

test('gop cau hinh: object gop theo khoa, mang thi thay the han', () => {
  const g = tmpGlobalConfig({
    rulesFiles: ['CHUNG.md'],
    auditCommands: ['npm run lint'],
    proof: { providers: { man: { type: 'macos' } } },
  });
  const dir = tmpProject({
    rulesFiles: ['AGENTS.md'],
    proof: { providers: { may: { type: 'adb', serial: 'emulator-5554' } } },
  });
  const cfg = loadConfig(dir);
  assert.deepEqual(cfg.rulesFiles, ['AGENTS.md'], 'mang phai bi thay the, khong noi duoi');
  assert.deepEqual(cfg.auditCommands, ['npm run lint'], 'mang project khong khai thi giu cua cau hinh chung');
  assert.deepEqual(Object.keys(cfg.proof.providers).sort(), ['man', 'may'], 'providers phai gop theo khoa');
  cleanup(dir);
  g.restore();
});

test('khoa la trong cau hinh chung cung canh bao va noi ro no nam o file nao', () => {
  const g = tmpGlobalConfig({ khoaLaChung: 1 });
  const dir = tmpProject({});
  const cfg = loadConfig(dir);
  assert.ok(cfg.warnings.some((w) => w.includes('khoaLaChung') && w.includes(g.file)));
  cleanup(dir);
  g.restore();
});

test('goc project khong bi keo ve HOME chi vi HOME co file cau hinh chung', () => {
  const g = tmpGlobalConfig({ testCommand: 'make test' });
  const proj = path.join(g.dir, 'repo-con');
  fs.mkdirSync(path.join(proj, '.git'), { recursive: true });
  const deep = path.join(proj, 'src', 'main');
  fs.mkdirSync(deep, { recursive: true });
  assert.equal(fs.realpathSync(resolveProjectRoot(deep)), fs.realpathSync(proj));
  g.restore();
});

test('tim goc project tu thu muc con', () => {
  const dir = tmpProject({});
  const deep = path.join(dir, 'app', 'src', 'main');
  fs.mkdirSync(deep, { recursive: true });
  assert.equal(fs.realpathSync(resolveProjectRoot(deep)), fs.realpathSync(dir));
  cleanup(dir);
});

test('prompt PLAN: cam sua code, bat ghi plan.md + result.json, cam git commit', () => {
  const dir = tmpProject({ testCommand: './gradlew test' });
  writeFile(path.join(dir, 'AGENTS.md'), '# luat');
  const cfg = loadConfig(dir);
  const task = createTask(cfg, sampleTaskArgs());
  const p = contractPaths(cfg, task);
  const prompt = buildPlanPrompt(cfg, task);

  assert.ok(prompt.includes(p.plan), 'phai noi duong dan tuyet doi cua plan.md');
  assert.ok(prompt.includes(p.result), 'phai noi duong dan result.json');
  assert.ok(prompt.includes('KHONG sua bat ky file source'), 'phai cam sua code o giai doan plan');
  assert.ok(prompt.includes('git commit'), 'phai cam commit');
  assert.ok(prompt.includes(path.join(dir, 'AGENTS.md')), 'phai nhet file luat cua project vao prompt');
  for (const d of task.definitionOfDone) assert.ok(prompt.includes(d), 'phai co dinh nghia hoan thanh');
  cleanup(dir);
});

test('prompt PLAN khong nhac file luat khong ton tai', () => {
  const dir = tmpProject({ rulesFiles: ['KHONG-CO.md'] });
  const cfg = loadConfig(dir);
  const task = createTask(cfg, sampleTaskArgs());
  assert.ok(!buildPlanPrompt(cfg, task).includes('KHONG-CO.md'));
  cleanup(dir);
});

test('tin nhan IMPLEMENT mang theo lenh test cua project va ghi chu cua PM', () => {
  const dir = tmpProject({ testCommand: './gradlew :app:test' });
  const cfg = loadConfig(dir);
  const task = createTask(cfg, sampleTaskArgs());
  const msg = buildImplementMessage(cfg, task, 'Giu nguyen API cong khai');
  assert.ok(msg.includes('./gradlew :app:test'));
  assert.ok(msg.includes('Giu nguyen API cong khai'));
  assert.ok(msg.includes('screenshots'));
  cleanup(dir);
});

test('tin nhan IMPLEMENT khi project chua khai lenh test thi khong bia ra lenh', () => {
  const dir = tmpProject({});
  const cfg = loadConfig(dir);
  const task = createTask(cfg, sampleTaskArgs());
  const msg = buildImplementMessage(cfg, task);
  assert.ok(!msg.includes('undefined'), 'khong duoc de lo "undefined" vao prompt');
  assert.ok(msg.includes('Chay test/kiem chung phu hop'), 'phai yeu cau tu chon cach kiem chung');
  assert.ok(!/`null`|\baccess null\b/.test(msg));
  cleanup(dir);
});

test('tin nhan REWORK liet ke du phat hien + lenh dang do, va cho phep phan bien', () => {
  const dir = tmpProject({});
  const cfg = loadConfig(dir);
  const task = createTask(cfg, sampleTaskArgs());
  const msg = buildReworkMessage(cfg, task, {
    findings: ['VoiceService.kt:120 — quen dong PTT khi doan rong', 'thieu test cho nhanh xe dang chay'],
    notes: 'Khong doi hanh vi lenh khac',
    failedRuns: [{ command: './gradlew test', exitCode: 1 }],
  });
  assert.ok(msg.includes('VoiceService.kt:120'));
  assert.ok(msg.includes('thieu test cho nhanh xe dang chay'));
  assert.ok(msg.includes('exit 1'));
  assert.ok(msg.includes('phan bien'), 'agent phai duoc quyen phan bien kem dan chung');
  cleanup(dir);
});

test('prompt AUDIT cam sua file va chi dinh file bao cao rieng', () => {
  const dir = tmpProject({});
  const cfg = loadConfig(dir);
  const task = createTask(cfg, sampleTaskArgs());
  const prompt = buildAuditPrompt(cfg, task, 'soi ky phan dong PTT');
  assert.ok(prompt.includes('audit-agent.json'));
  assert.ok(prompt.includes('KHONG duoc sua bat ky file nao'));
  assert.ok(prompt.includes('soi ky phan dong PTT'));
  cleanup(dir);
});

test('tin nhan BAC KE HOACH van cam sua code va doi bao cao phase PLAN', () => {
  const dir = tmpProject({});
  const cfg = loadConfig(dir);
  const task = createTask(cfg, sampleTaskArgs());
  const msg = buildPlanReworkMessage(cfg, task, {
    findings: ['Ke hoach chua noi ro se sua ham nao', 'Thieu cach chung minh bang test'],
  });
  assert.ok(msg.includes('Ke hoach chua noi ro se sua ham nao'));
  assert.ok(msg.includes('KHONG duoc sua bat ky file source nao'), 'bac ke hoach thi van cam sua code');
  assert.ok(msg.includes('phase = "PLAN"'));
  assert.ok(!msg.includes('phase = "IMPLEMENT"'), 'khong duoc day agent di code khi ke hoach chua duyet');
  assert.ok(msg.includes('phan bien'), 'agent duoc quyen phan bien');
  cleanup(dir);
});
