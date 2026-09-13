// Chay THAT ca luong o tang tool (tru cac buoc phai goi Antigravity) tren 1 repo git tam.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { TOOLS_BY_NAME } from '../src/tools.js';
import { loadConfig } from '../src/config.js';
import { loadTask, contractPaths } from '../src/tasks.js';
import { tmpProject, cleanup, writeFile, PNG_1PX } from './helpers.js';

const call = async (name, args) => {
  const out = await TOOLS_BY_NAME.get(name).handler(args);
  return typeof out === 'string' ? { text: out } : out;
};

function gitRepo(config) {
  const dir = tmpProject(config);
  execFileSync('git', ['init', '-q'], { cwd: dir });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: dir });
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: dir });
  writeFile(path.join(dir, 'src', 'Kinh.kt'), 'fun haKinh() {}\n');
  execFileSync('git', ['add', '-A'], { cwd: dir });
  execFileSync('git', ['commit', '-qm', 'init'], { cwd: dir });
  return dir;
}


/** PM viet ke hoach, agent phan bien, PM chot — ba buoc bat buoc truoc khi giao trien khai. */
async function planDaChot(dir, taskId, cfg, task, noiDung = '# Ke hoach cua PM\n1. Them ham xacNhan()\n2. Them test') {
  await call('pm_plan', { project: dir, taskId, content: noiDung });
  writeFile(path.join(contractPaths(cfg, task).dir, 'plan-review.json'),
    JSON.stringify({ phase: 'PLAN_REVIEW', verdict: 'ok', findings: [] }));
  await call('pm_verdict', { project: dir, taskId, kind: 'plan', verdict: 'pass', notes: 'da nghe phan bien' });
}

test('ca luong: tao task -> duyet plan -> audit/review -> test -> anh -> nghiem thu', async () => {
  const dir = gitRepo({ testCommand: 'echo "3 tests passed"', auditCommands: ['echo "docs gate ok"'] });

  const created = await call('pm_task_create', {
    project: dir,
    title: 'Thêm xác nhận khi hạ kính',
    brief: 'Lệnh hạ kính đang chạy thẳng, cần hỏi xác nhận.',
    definitionOfDone: ['Có test cho bước xác nhận', 'Không đổi hành vi lệnh khác'],
  });
  const taskId = /T\d{4}-[a-z0-9-]+/.exec(created.text)[0];
  let cfg = loadConfig(dir);
  let task = loadTask(cfg, taskId);
  const p = contractPaths(cfg, task);

  // Chua co gi -> tu choi nghiem thu, va noi ro thieu gi.
  const early = await call('pm_accept', { project: dir, taskId });
  assert.equal(early.isError, true);
  assert.ok(early.text.includes('TU CHOI NGHIEM THU'));
  assert.ok(early.text.includes('plan.md'));

  // PM tu viet ke hoach (Antigravity khong lap ke hoach nua), nghe phan bien roi chot.
  await planDaChot(dir, taskId, cfg, task);
  const st1 = await call('pm_status', { project: dir, taskId });
  assert.ok(st1.text.includes('plan.md: co'));
  assert.ok(st1.text.includes('CHUA DAT'));

  // Gia lap agent sua code + bao cao.
  writeFile(path.join(dir, 'src', 'Kinh.kt'), 'fun haKinh() {\n  xacNhan()\n}\n');
  writeFile(path.join(dir, 'src', 'test', 'KinhTest.kt'), '// test cho nhanh xac nhan\n');
  writeFile(path.join(dir, 'src', 'Ngoai.kt'), '// file nam ngoai khai bao\n');
  const later = new Date(Date.now() + 2000);
  writeFile(p.result, JSON.stringify({ phase: 'IMPLEMENT', summary: 'da them xac nhan', files_changed: ['src/Kinh.kt'], tests: { command: 'echo', exitCode: 0 } }));
  fs.utimesSync(p.result, later, later);

  // pm_diff phai to cao file sua ngoai khai bao.
  const diff = await call('pm_diff', { project: dir, taskId });
  assert.ok(diff.text.includes('src/Kinh.kt'));
  assert.ok(diff.text.includes('KHONG duoc khai'), `pm_diff phai canh bao file ngoai khai bao:\n${diff.text}`);
  assert.ok(diff.text.includes('Ngoai.kt'));

  await call('pm_verdict', { project: dir, taskId, kind: 'audit', verdict: 'pass' });
  await call('pm_verdict', { project: dir, taskId, kind: 'review', verdict: 'pass' });
  task = loadTask(cfg, taskId);
  assert.equal(task.phase, 'TEST');

  // Test + audit command that.
  const runTest = await call('pm_run', { project: dir, taskId, kind: 'test' });
  assert.ok(runTest.text.includes('exit=0'));
  assert.ok(runTest.text.includes('3 tests passed'), 'phai in duoi log that');
  const runAudit = await call('pm_run', { project: dir, taskId, kind: 'audit' });
  assert.ok(runAudit.text.includes('docs gate ok'));

  // Van thieu anh.
  const noProof = await call('pm_accept', { project: dir, taskId });
  assert.equal(noProof.isError, true);
  assert.ok(noProof.text.includes('anh nghiem thu'));

  // Nhan anh do "agent" chup.
  const shot = writeFile(path.join(dir, 'shot.png'), PNG_1PX);
  const proof = await call('pm_capture_proof', { project: dir, taskId, label: 'hop xac nhan hien tren xe', sourceFile: shot });
  assert.equal(proof.images.length, 1, 'phai tra ANH ve cho PM xem tan mat');
  assert.equal(proof.images[0].mime, 'image/png');
  task = loadTask(cfg, taskId);
  assert.equal(task.phase, 'PROOF');

  // Nghiem thu dat.
  const ok = await call('pm_accept', { project: dir, taskId, summary: 'Dat, da xem anh va log test.' });
  assert.ok(ok.text.includes('NGHIEM THU DAT'), ok.text);
  task = loadTask(cfg, taskId);
  assert.equal(task.phase, 'ACCEPTED');

  // Bao cao co du bang chung.
  const rep = await call('pm_report', { project: dir, taskId });
  const md = fs.readFileSync(p.report, 'utf8');
  assert.ok(md.includes('NGHIEM THU') || md.includes('DAT'));
  assert.ok(md.includes('hop xac nhan hien tren xe'));
  assert.ok(md.includes('echo "3 tests passed"') || md.includes('3 tests passed'));
  assert.ok(md.includes('![hop xac nhan hien tren xe]'), 'bao cao phai nhung anh');
  assert.ok(rep.text.includes(p.report));

  cleanup(dir);
});

test('test do that su chan nghiem thu o tang tool (khong nuot exit code)', async () => {
  const dir = gitRepo({ testCommand: 'echo "1 test failed" >&2; exit 1' });
  const created = await call('pm_task_create', {
    project: dir, title: 'Task se do', brief: 'x', definitionOfDone: ['y'],
  });
  const taskId = /T\d{4}-[a-z0-9-]+/.exec(created.text)[0];
  const cfg = loadConfig(dir);
  const task = loadTask(cfg, taskId);
  const p = contractPaths(cfg, task);
  writeFile(p.result, JSON.stringify({ phase: 'IMPLEMENT', summary: 'x' }));
  await planDaChot(dir, taskId, cfg, task, '#plan');
  await call('pm_verdict', { project: dir, taskId, kind: 'audit', verdict: 'pass' });
  await call('pm_verdict', { project: dir, taskId, kind: 'review', verdict: 'pass' });
  const r = await call('pm_run', { project: dir, taskId, kind: 'test' });
  assert.ok(r.text.includes('exit=1'), r.text);
  assert.ok(r.text.includes('1 test failed'), 'phai hien log do');
  writeFile(path.join(dir, 'src', 'test', 'ChoDu.kt'), '// test\n');
  const shot = writeFile(path.join(dir, 's.png'), PNG_1PX);
  await call('pm_capture_proof', { project: dir, taskId, label: 'anh', sourceFile: shot });
  const acc = await call('pm_accept', { project: dir, taskId });
  assert.equal(acc.isError, true);
  assert.ok(acc.text.includes('exit 0'), acc.text);
  cleanup(dir);
});

test('pm_run kind=test khi project chua khai testCommand thi bao do, khong im lang cho qua', async () => {
  const dir = gitRepo({});
  const created = await call('pm_task_create', { project: dir, title: 'T', brief: 'b', definitionOfDone: ['d'] });
  const taskId = /T\d{4}-[a-z0-9-]+/.exec(created.text)[0];
  await assert.rejects(() => call('pm_run', { project: dir, taskId, kind: 'test' }), /testCommand/);
  cleanup(dir);
});

test('pm_task_create thieu definitionOfDone thi bi chan ngay', async () => {
  const dir = gitRepo({});
  await assert.rejects(
    () => call('pm_task_create', { project: dir, title: 'T', brief: 'b', definitionOfDone: [] }),
    /definitionOfDone/,
  );
  cleanup(dir);
});

test('pm_dispatch kind=implement khi PM chua viet plan.md thi bi chan', async () => {
  const dir = gitRepo({});
  const created = await call('pm_task_create', { project: dir, title: 'T', brief: 'b', definitionOfDone: ['d'] });
  const taskId = /T\d{4}-[a-z0-9-]+/.exec(created.text)[0];
  await assert.rejects(
    () => call('pm_dispatch', { project: dir, taskId, kind: 'implement' }),
    /Chua co plan\.md/,
  );
  cleanup(dir);
});

test('pm_dispatch kind=implement khi co plan.md nhung CHUA chot thi van bi chan', async () => {
  const dir = gitRepo({});
  const created = await call('pm_task_create', { project: dir, title: 'T', brief: 'b', definitionOfDone: ['d'] });
  const taskId = /T\d{4}-[a-z0-9-]+/.exec(created.text)[0];
  await call('pm_plan', { project: dir, taskId, content: '# Ke hoach chua nghe phan bien' });
  await assert.rejects(
    () => call('pm_dispatch', { project: dir, taskId, kind: 'implement' }),
    /chua duoc chot/i,
  );
  cleanup(dir);
});

test('pm_rework khong co findings thi bi chan', async () => {
  const dir = gitRepo({});
  const created = await call('pm_task_create', { project: dir, title: 'T', brief: 'b', definitionOfDone: ['d'] });
  const taskId = /T\d{4}-[a-z0-9-]+/.exec(created.text)[0];
  await assert.rejects(() => call('pm_rework', { project: dir, taskId, findings: [] }), /findings/);
  cleanup(dir);
});

test('pm_rework khi ke hoach chua chot thi bi chan (khong day agent di code som)', async () => {
  const dir = gitRepo({});
  const created = await call('pm_task_create', { project: dir, title: 'T', brief: 'b', definitionOfDone: ['d'] });
  const taskId = /T\d{4}-[a-z0-9-]+/.exec(created.text)[0];
  await assert.rejects(
    () => call('pm_rework', { project: dir, taskId, findings: ['ke hoach so sai'] }),
    /Ke hoach chua duoc chot/,
  );
  // Va task van nam o giai doan PLAN, khong bi nhay sang IMPLEMENT.
  const task = loadTask(loadConfig(dir), taskId);
  assert.equal(task.phase, 'PLAN');
  assert.equal(task.round, 0);
  cleanup(dir);
});

test('PM tu bac ke hoach cua minh: khong tang vong, khong doi giai doan, khong day agent di code', async () => {
  const dir = gitRepo({});
  const created = await call('pm_task_create', { project: dir, title: 'T', brief: 'b', definitionOfDone: ['d'] });
  const taskId = /T\d{4}-[a-z0-9-]+/.exec(created.text)[0];
  const out = await call('pm_verdict', {
    project: dir, taskId, kind: 'plan', verdict: 'fail', findings: ['thieu buoc kiem chung'],
  });
  assert.ok(out.text.includes('pm_plan'), out.text);
  const task = loadTask(loadConfig(dir), taskId);
  assert.equal(task.phase, 'PLAN');
  assert.equal(task.round, 0);
  assert.equal(task.verdicts.plan.verdict, 'fail');
  cleanup(dir);
});
