// Doi vai (chu du an chot 12/09/2026): PM (Claude Code) LAP ke hoach, Antigravity PHAN BIEN
// mot vong roi moi THUC THI. Truoc day plan do Antigravity viet — nay khong con nua.
//
// Vi sao con vong phan bien: PM khong ngoi trong repo bang agent, plan cua PM co the sai fact.
// Vi sao PM khong duoc tu duyet plan cua chinh minh khi chua nghe phan bien: nhu vay vong phan
// bien chi con la trang tri.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { TOOLS_BY_NAME } from '../src/tools.js';
import { loadConfig } from '../src/config.js';
import { loadTask, contractPaths, createTask, gate } from '../src/tasks.js';
import { buildImplementMessage, buildPlanCritiquePrompt } from '../src/prompt.js';
import { tmpProject, cleanup, writeFile, sampleTaskArgs } from './helpers.js';

const call = async (name, args) => {
  const out = await TOOLS_BY_NAME.get(name).handler(args);
  return typeof out === 'string' ? { text: out } : out;
};

async function newTask(dir) {
  const created = await call('pm_task_create', { project: dir, ...sampleTaskArgs() });
  return /T\d{4}-[a-z0-9-]+/.exec(created.text)[0];
}

/** Gia lam ban phan bien cua agent (that ra do Antigravity ghi). */
function writeCritique(cfg, task, body = { verdict: 'ok', findings: [] }) {
  const f = path.join(contractPaths(cfg, task).dir, 'plan-review.json');
  writeFile(f, JSON.stringify(body, null, 2));
  return f;
}

test('pm_plan: PM tu ghi plan.md, nhung CHUA duoc tinh la da chot', async () => {
  const dir = tmpProject({ testCommand: 'echo ok' });
  const taskId = await newTask(dir);
  await call('pm_plan', { project: dir, taskId, content: '# Ke hoach\nSua ham haKinh() de hoi xac nhan.' });

  const cfg = loadConfig(dir);
  const task = loadTask(cfg, taskId);
  assert.ok(fs.existsSync(contractPaths(cfg, task).plan), 'phai ghi ra plan.md');
  assert.match(fs.readFileSync(contractPaths(cfg, task).plan, 'utf8'), /haKinh/);
  assert.equal(task.planAuthor, 'pm', 'phai ghi nhan plan nay do PM viet');
  assert.notEqual(task.verdicts?.plan?.verdict, 'pass', 'viet plan xong chua phai la chot plan');
  cleanup(dir);
});

test('pm_plan: nhan ca duong dan file PM da soan san', async () => {
  const dir = tmpProject({});
  const taskId = await newTask(dir);
  const src = writeFile(path.join(dir, 'nhap', 'ke-hoach.md'), '# Ke hoach ngoai\nnoi dung that');
  await call('pm_plan', { project: dir, taskId, file: src });
  const cfg = loadConfig(dir);
  assert.match(fs.readFileSync(contractPaths(cfg, loadTask(cfg, taskId)).plan, 'utf8'), /noi dung that/);
  cleanup(dir);
});

test('pm_plan: khong co content lan file thi bi chan, khong de lai plan.md rong', async () => {
  const dir = tmpProject({});
  const taskId = await newTask(dir);
  await assert.rejects(() => call('pm_plan', { project: dir, taskId }), /content|file/i);
  const cfg = loadConfig(dir);
  assert.ok(!fs.existsSync(contractPaths(cfg, loadTask(cfg, taskId)).plan));
  cleanup(dir);
});

test('pm_dispatch kind=plan khong con nua — phai chi sang pm_plan', async () => {
  const dir = tmpProject({});
  const taskId = await newTask(dir);
  await assert.rejects(() => call('pm_dispatch', { project: dir, taskId, kind: 'plan' }), /pm_plan/);
  cleanup(dir);
});

test('chua nghe phan bien thi PM khong duoc chot plan cua chinh minh', async () => {
  const dir = tmpProject({});
  const taskId = await newTask(dir);
  await call('pm_plan', { project: dir, taskId, content: '# Ke hoach' });
  await assert.rejects(
    () => call('pm_verdict', { project: dir, taskId, kind: 'plan', verdict: 'pass' }),
    /plan_review|phan bien/i,
  );
  cleanup(dir);
});

test('co ban phan bien roi thi chot duoc, va cong nghiem thu het doi buoc duyet plan', async () => {
  const dir = tmpProject({});
  const taskId = await newTask(dir);
  await call('pm_plan', { project: dir, taskId, content: '# Ke hoach' });
  let cfg = loadConfig(dir);
  writeCritique(cfg, loadTask(cfg, taskId), { verdict: 'co_van_de', findings: [{ severity: 'minor', problem: 'x' }] });
  await call('pm_verdict', { project: dir, taskId, kind: 'plan', verdict: 'pass', notes: 'da doc phan bien, chap nhan' });

  cfg = loadConfig(dir);
  const g = gate(cfg, loadTask(cfg, taskId), { changedFiles: [] });
  assert.ok(!g.missing.some((m) => /duyet plan/i.test(m)), 'khong con doi buoc duyet plan');
  cleanup(dir);
});

test('PM sua lai plan thi phan bien cu va ket luan cu het hieu luc', async () => {
  const dir = tmpProject({});
  const taskId = await newTask(dir);
  await call('pm_plan', { project: dir, taskId, content: '# Ke hoach v1' });
  let cfg = loadConfig(dir);
  writeCritique(cfg, loadTask(cfg, taskId));
  await call('pm_verdict', { project: dir, taskId, kind: 'plan', verdict: 'pass' });

  await call('pm_plan', { project: dir, taskId, content: '# Ke hoach v2 — doi huong han' });
  cfg = loadConfig(dir);
  const task = loadTask(cfg, taskId);
  assert.notEqual(task.verdicts?.plan?.verdict, 'pass', 'plan doi thi ket luan cu phai bi xoa');
  assert.ok(!fs.existsSync(path.join(contractPaths(cfg, task).dir, 'plan-review.json')),
    'phan bien cho plan cu khong duoc tinh cho plan moi');
  cleanup(dir);
});

test('pm_dispatch kind=implement khi PM chua viet plan.md thi bi chan', async () => {
  const dir = tmpProject({});
  const taskId = await newTask(dir);
  await assert.rejects(() => call('pm_dispatch', { project: dir, taskId, kind: 'implement' }), /plan/i);
  cleanup(dir);
});

test('tin nhan trien khai mang TOAN VAN plan cua PM (agent chua tung thay plan)', () => {
  const dir = tmpProject({ testCommand: 'echo ok' });
  const cfg = loadConfig(dir);
  const task = createTask(cfg, sampleTaskArgs());
  writeFile(contractPaths(cfg, task).plan, '# Ke hoach cua PM\n- Buoc 1: doi nguong tu 5 sang 3\n- Buoc 2: them test');
  const msg = buildImplementMessage(cfg, task);
  assert.match(msg, /doi nguong tu 5 sang 3/, 'phai nhet noi dung plan vao tin nhan');
  assert.match(msg, /Buoc 2: them test/);
  assert.match(msg, /KE HOACH CUA PM/i, 'phai noi ro day la ke hoach cua PM, khong phai cua agent');
  cleanup(dir);
});

test('prompt phan bien: chi doc, doi BAC BO, ghi plan-review.json', () => {
  const dir = tmpProject({});
  const cfg = loadConfig(dir);
  const task = createTask(cfg, sampleTaskArgs());
  writeFile(contractPaths(cfg, task).plan, '# Ke hoach cua PM\n- Buoc 1: doi nguong');
  const p = buildPlanCritiquePrompt(cfg, task);
  assert.match(p, /plan-review\.json/, 'phai noi ro ghi ket qua vao dau');
  assert.match(p, /KHONG duoc sua|khong sua bat ky file/i, 'giai doan nay cam sua code');
  assert.match(p, /BAC BO|phan bien/i, 'phai yeu cau bac bo chu khong phai gat dau');
  assert.match(p, /doi nguong/, 'phai nhet toan van plan vao prompt');
  assert.match(p, /Cam bia/i, 'van phai mang khoi cam bia');
  cleanup(dir);
});
