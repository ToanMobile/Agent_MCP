// Hoi quy cho 4 loi nghiem trong tu audit 23/09/2026:
//   1. chen lenh shell qua pathspec / baseCommit / createdAt khi goi git
//   2. task.json nam trong repo canh result.json cua agent => agent sua duoc ket luan
//   3. qua han khong giet chau (gradle/java) => pm_run treo; tran output giu dau thay vi duoi
//   4. ghi ca object task cu sau await => xoa mat pm_rework chen giua
// + taskId phai dung khuon truoc khi ghep duong dan.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { loadConfig } from '../src/config.js';
import {
  createTask, loadTask, listTasks, save, recordRun, recordVerdict, markRework, accept, contractPaths, taskFile,
  gate, recordDispatch, freshness,
} from '../src/tasks.js';
import { baseCommitOf, changedFilesOf, gitSnapshot } from '../src/worktree.js';
import { deltaKeHoach } from '../src/plan-review.js';
import { runShell } from '../src/util.js';
import { TOOLS_BY_NAME } from '../src/tools.js';
import { tmpProject, cleanup, writeFile, sampleTaskArgs } from './helpers.js';

function gitRepo() {
  const dir = tmpProject({ projectName: 'audit' });
  execFileSync('git', ['init', '-q'], { cwd: dir });
  writeFile(path.join(dir, '.gitignore'), '.antigravity-pm/\n');
  writeFile(path.join(dir, 'a.txt'), 'a\n');
  execFileSync('git', ['add', '-A'], { cwd: dir });
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'init'], { cwd: dir });
  return dir;
}

// ---------------------------------------------------------------- 1. chen lenh shell

test('A1 pm_diff: pathspec co ";" KHONG duoc chay nhu lenh shell', async () => {
  const dir = gitRepo();
  const marker = path.join(os.tmpdir(), `agpm-inject-${process.pid}-${Date.now()}`);
  try {
    await TOOLS_BY_NAME.get('pm_diff').handler({ project: dir, mode: 'patch', pathspec: `a.txt; touch ${marker}` });
    assert.equal(fs.existsSync(marker), false, 'pathspec da bi shell thuc thi');
  } finally {
    fs.rmSync(marker, { force: true });
    cleanup(dir);
  }
});

test('A1 baseCommit / createdAt sai khuon: khong vao shell, baseCommitOf=null, changedFiles CHUA XAC MINH', async () => {
  const dir = gitRepo();
  const marker = path.join(os.tmpdir(), `agpm-inject-b-${process.pid}-${Date.now()}`);
  try {
    const cfg = loadConfig(dir);
    const task = createTask(cfg, sampleTaskArgs());
    const doc = { ...task, baseCommit: `HEAD; touch ${marker}` };
    assert.equal(await baseCommitOf(cfg, doc), null);
    assert.equal(await changedFilesOf(cfg, doc), undefined, 'baseCommit sai khuon phai la CHUA XAC MINH, khong lui ve cay lam viec');
    const cu = { ...task, baseCommit: null, createdAt: `2020-01-01"; touch ${marker}; echo "` };
    assert.equal(await baseCommitOf(cfg, cu), null);
    assert.equal(fs.existsSync(marker), false, 'baseCommit/createdAt da bi shell thuc thi');
    // SHA that van dung duoc.
    assert.match(await baseCommitOf(cfg, task), /^[0-9a-f]{40}$/);
  } finally {
    fs.rmSync(marker, { force: true });
    cleanup(dir);
  }
});

// ---------------------------------------------------------------- 2. task.json ngoai repo

test('A2 task.json cua PM nam NGOAI repo; ban agent sua trong repo khong co tac dung', () => {
  const dir = tmpProject({});
  try {
    const cfg = loadConfig(dir);
    const task = createTask(cfg, sampleTaskArgs());
    const inRepo = path.join(contractPaths(cfg, task).dir, 'task.json');
    assert.equal(fs.existsSync(inRepo), false, 'task.json khong duoc nam trong repo (canh result.json cua agent)');
    assert.ok(fs.existsSync(taskFile(cfg, task.id)));
    assert.ok(!path.resolve(taskFile(cfg, task.id)).startsWith(fs.realpathSync(dir)), taskFile(cfg, task.id));
    // Agent "tu cap" verdict + test xanh vao thu muc no ghi duoc: khong anh huong.
    fs.writeFileSync(inRepo, JSON.stringify({ ...task, round: 0, verdicts: { plan: { verdict: 'pass' }, audit: { verdict: 'pass', round: 0 } } }));
    assert.deepEqual(loadTask(cfg, task.id).verdicts, {});
  } finally {
    cleanup(dir);
  }
});

test('A2 task cu co task.json trong repo: chuyen sang HOME DUNG MOT LAN', () => {
  const dir = tmpProject({});
  try {
    // Ban cu (truoc khi nang cap): task.json nam trong repo, HOME chua co gi.
    const cfg0 = loadConfig(dir);
    const task = createTask(cfg0, sampleTaskArgs());
    const legacy = path.join(contractPaths(cfg0, task).dir, 'task.json');
    fs.writeFileSync(legacy, JSON.stringify({ ...task, title: 'ban cu' }));
    fs.rmSync(cfg0.pmStateRoot, { recursive: true, force: true });

    const cfg = loadConfig(dir);
    assert.equal(loadTask(cfg, task.id).title, 'ban cu');
    assert.ok(fs.existsSync(taskFile(cfg, task.id)), 'phai chuyen sang vi tri moi');
    assert.ok(!fs.existsSync(legacy) && fs.existsSync(`${legacy}.migrated`), 'ban trong repo phai duoc danh dau da chuyen');
    assert.equal(listTasks(cfg).length, 1);

    // Sau khi chuyen: agent cay lai task.json gia + xoa ban HOME => KHONG duoc import lai.
    fs.writeFileSync(legacy, JSON.stringify({ ...task, title: 'agent sua', phase: 'ACCEPTED' }));
    assert.equal(loadTask(cfg, task.id).title, 'ban cu');
    fs.rmSync(taskFile(cfg, task.id));
    assert.throws(() => loadTask(cfg, task.id), /Khong thay task/);
  } finally {
    cleanup(dir);
  }
});

test('A2b task gia cay trong repo sau khi nang cap khong hien trong danh sach', () => {
  const dir = tmpProject({});
  try {
    const cfg = loadConfig(dir);
    createTask(cfg, sampleTaskArgs());
    const fake = path.join(cfg.tasksRoot, 'T0042-fake');
    fs.mkdirSync(fake, { recursive: true });
    fs.writeFileSync(path.join(fake, 'task.json'), JSON.stringify({ id: 'T0042-fake', phase: 'ACCEPTED' }));
    assert.equal(listTasks(cfg).length, 1);
    assert.throws(() => loadTask(cfg, 'T0042-fake'), /Khong thay task/);
  } finally {
    cleanup(dir);
  }
});

test('A2c task.json o HOME bi hong thi BAO LOI, khong lay ban khac thay the', () => {
  const dir = tmpProject({});
  try {
    const cfg = loadConfig(dir);
    const task = createTask(cfg, sampleTaskArgs());
    fs.writeFileSync(taskFile(cfg, task.id), '{bad');
    assert.throws(() => loadTask(cfg, task.id), /bi hong/);
  } finally {
    cleanup(dir);
  }
});

test('A2d agent tao thu muc T9999-x trong repo khong lam hong so task tiep theo', () => {
  const dir = tmpProject({});
  try {
    const cfg = loadConfig(dir);
    createTask(cfg, sampleTaskArgs());
    fs.mkdirSync(path.join(cfg.tasksRoot, 'T9999-x'), { recursive: true });
    const t2 = createTask(cfg, { ...sampleTaskArgs(), title: 'task hai' });
    assert.match(t2.id, /^T0002-/);
  } finally {
    cleanup(dir);
  }
});

// ---------------------------------------------------------------- 3. qua han + tran output

test('A3 qua han giet ca chau: `sleep 6; echo x` voi timeoutMs 1000 tra ve < 3s', async () => {
  const t0 = Date.now();
  const r = await runShell('sleep 6; echo x', { timeoutMs: 1000 });
  const ms = Date.now() - t0;
  assert.equal(r.timedOut, true);
  assert.ok(ms < 3000, `mat ${ms}ms — chau (sleep) van giu pipe`);
  assert.ok(!r.stdout.includes('x'));
});

test('A3 vuot tran output: giu DUOI (loi nam cuoi log) va bao truncated', async () => {
  const r = await runShell('i=0; while [ $i -lt 3000 ]; do echo "dong $i"; i=$((i+1)); done; echo "BUILD FAILED"', { maxBytes: 200 });
  assert.equal(r.truncated, true);
  assert.ok(r.stdout.length <= 200, String(r.stdout.length));
  assert.ok(r.stdout.trimEnd().endsWith('BUILD FAILED'), r.stdout);
  const ok = await runShell('echo nho');
  assert.equal(ok.truncated, false);
});

// ---------------------------------------------------------------- 4. ghi de task cu

test('A4 pm_rework chen giua luc pm_run doi test: recordRun ban cu KHONG xoa rework', () => {
  const dir = tmpProject({});
  try {
    const cfg = loadConfig(dir);
    const created = createTask(cfg, sampleTaskArgs());
    recordVerdict(cfg, created, { kind: 'audit', verdict: 'pass' });
    const stale = loadTask(cfg, created.id); // pm_run nap task, roi await test 3 phut...
    markRework(cfg, loadTask(cfg, created.id), 'sai', ['a.kt:1 sai']); // ...pm_rework chen giua
    recordRun(cfg, stale, { kind: 'test', command: 'x', exitCode: 0, durationMs: 1, evidence: { ok: true } });
    const t = loadTask(cfg, created.id);
    assert.equal(t.round, 1, 'vong bi lui ve');
    assert.deepEqual(t.openFindings, ['a.kt:1 sai']);
    assert.equal(t.verdicts.audit, undefined, 'ket luan audit cu song lai');
    assert.equal(t.runs.length, 1);
    assert.equal(t.runs[0].round, 0, 'lan chay bat dau o vong 0 khong duoc tinh xanh cho vong 1');
    assert.equal(stale.round, 1, 'object nguoi goi phai dong bo ban moi nhat');
  } finally {
    cleanup(dir);
  }
});

test('A4 save ca object cu sau khi task da doi => tu choi; accept xet cong tren ban moi nhat', () => {
  const dir = tmpProject({});
  try {
    const cfg = loadConfig(dir);
    const created = createTask(cfg, sampleTaskArgs());
    const stale = loadTask(cfg, created.id);
    markRework(cfg, loadTask(cfg, created.id), 'sai');
    stale.state = 'x';
    assert.throws(() => save(cfg, stale), /vua bi thao tac khac ghi/);
    assert.equal(loadTask(cfg, created.id).round, 1);
    assert.throws(() => accept(cfg, stale, {}), /CHUA DU BANG CHUNG/);
    assert.equal(loadTask(cfg, created.id).phase, 'IMPLEMENT');
  } finally {
    cleanup(dir);
  }
});

// ---------------------------------------------------------------- taskId

test('A5 taskId sai khuon (../) bi chan truoc khi ghep duong dan', async () => {
  const dir = tmpProject({});
  try {
    const cfg = loadConfig(dir);
    for (const bad of ['../../etc/passwd', 'T0001-../../x', 'T0001-a/b', '', 'x']) {
      assert.throws(() => loadTask(cfg, bad), /taskId khong hop le/, bad);
    }
    await assert.rejects(() => TOOLS_BY_NAME.get('pm_status').handler({ project: dir, taskId: '../../x' }), /taskId khong hop le/);
    // Rac trong thu muc tasks khong lam listTasks no.
    fs.mkdirSync(path.join(cfg.tasksRoot, 'rac'), { recursive: true });
    assert.deepEqual(listTasks(cfg), []);
  } finally {
    cleanup(dir);
  }
});

// ---------------------------------------------------------------- re-audit 23/09: cong nghiem thu

test('R1 agent sua .antigravity-pm.json sau khi tao task: pm_run va gate van dung BAN CHUP luc tao', async () => {
  const dir = tmpProject({ testCommand: 'echo "1 test ok"', proof: { require: 2 } });
  try {
    const created = await TOOLS_BY_NAME.get('pm_task_create').handler({ project: dir, title: 'x', brief: 'y', definitionOfDone: ['z'] });
    const taskId = /T\d{4}-[a-z0-9-]+/.exec(created.text || created)[0];
    // Agent doi lenh test thanh `true`, bo yeu cau anh, doi stateDir de an thay doi.
    fs.writeFileSync(path.join(dir, '.antigravity-pm.json'), JSON.stringify({ testCommand: 'true', proof: { require: 0 }, stateDir: 'src' }));
    await TOOLS_BY_NAME.get('pm_run').handler({ project: dir, taskId, kind: 'test' });
    const cfg = loadConfig(dir);
    const task = loadTask(cfg, taskId);
    assert.equal(task.runs.at(-1).command, 'echo "1 test ok"', 'PM phai chay lenh test cua ban chup, khong phai lenh agent sua');
    const st = await TOOLS_BY_NAME.get('pm_status').handler({ project: dir, taskId });
    const text = st.text || st;
    assert.match(text, /can 2, dang co 0/, 'proof.require cua ban chup (2) van ap dung');
  } finally {
    cleanup(dir);
  }
});

test('R2 lan chay xanh bang lenh tu chon (command=true) khong co XML thi KHONG duoc tinh', () => {
  const dir = tmpProject({ testCommand: 'echo ok' });
  try {
    const cfg = loadConfig(dir);
    const task = createTask(cfg, sampleTaskArgs());
    recordRun(cfg, task, { kind: 'test', command: 'true', exitCode: 0, durationMs: 1, evidence: { source: 'stdout', ok: true, weak: true } });
    const joined = gate(cfg, task, {}).missing.join('\n');
    assert.match(joined, /lenh tu chon \(true\)/, joined);
  } finally {
    cleanup(dir);
  }
});

test('R3 chua giao trien khai thi gate chan va pm_verdict audit/review bi tu choi', async () => {
  const dir = tmpProject({ testCommand: 'echo ok' });
  try {
    const cfg = loadConfig(dir);
    const task = createTask(cfg, sampleTaskArgs());
    assert.match(gate(cfg, task, {}).missing.join('\n'), /Chua giao trien khai/);
    await assert.rejects(TOOLS_BY_NAME.get('pm_verdict').handler({ project: dir, taskId: task.id, kind: 'audit', verdict: 'pass' }), /Chua giao trien khai/);
    await assert.rejects(TOOLS_BY_NAME.get('pm_verdict').handler({ project: dir, taskId: task.id, kind: 'review', verdict: 'pass' }), /Chua giao trien khai/);
  } finally {
    cleanup(dir);
  }
});

test('R4 result.json co mtime o TUONG LAI khong duoc tinh la moi', () => {
  const dir = tmpProject({});
  try {
    const cfg = loadConfig(dir);
    const task = createTask(cfg, sampleTaskArgs());
    recordDispatch(cfg, task, { kind: 'implement', conversationId: 'c' });
    const p = contractPaths(cfg, task);
    writeFile(p.result, JSON.stringify({ phase: 'IMPLEMENT' }));
    const future = new Date(Date.now() + 3600_000);
    fs.utimesSync(p.result, future, future);
    assert.equal(freshness(cfg, task).resultFresh, false);
  } finally {
    cleanup(dir);
  }
});

test('R5 deltaKeHoach: duong dan co $(...) (stateDir tu config) khong bi shell thuc thi', async () => {
  const marker = path.join(os.tmpdir(), `agpm-inject-plan-${process.pid}-${Date.now()}`);
  const dir = tmpProject({ stateDir: `.agpm-$(touch ${marker})` });
  try {
    const cfg = loadConfig(dir);
    const task = createTask(cfg, sampleTaskArgs());
    const p = contractPaths(cfg, task);
    writeFile(path.join(p.logsDir, 'plan-v1.md'), '# v1\n');
    writeFile(p.plan, '# v2\n');
    await deltaKeHoach(cfg, { ...task, planVersion: 2 });
    assert.equal(fs.existsSync(marker), false, 'stateDir da bi shell thuc thi');
  } finally {
    fs.rmSync(marker, { force: true });
    cleanup(dir);
  }
});

test('R6 gitSnapshot: ten file tieng Viet / co dau cach / rename doc dung (git status -z)', async () => {
  const dir = gitRepo();
  try {
    writeFile(path.join(dir, 'thư mục', 'tệp mới.kt'), 'x\n');
    execFileSync('git', ['mv', 'a.txt', 'b c.txt'], { cwd: dir });
    const snap = await gitSnapshot(loadConfig(dir));
    assert.ok(snap.wt.includes('thư mục/tệp mới.kt'), JSON.stringify(snap.wt));
    assert.ok(snap.wt.includes('b c.txt') && !snap.wt.includes('a.txt'), JSON.stringify(snap.wt));
    assert.ok(snap.untracked.includes('thư mục/tệp mới.kt'));
  } finally {
    cleanup(dir);
  }
});
