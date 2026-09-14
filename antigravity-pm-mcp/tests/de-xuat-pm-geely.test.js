// 5 de xuat tu phien PM GeelyEx2 (T0009–T0025, 13–14/09/2026) + 2 diem phu. Moi test khoa mot ca BI CHAN / bi bat.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { loadConfig } from '../src/config.js';
import {
  createTask, recordVerdict, recordRun, recordProof, recordDispatch, markRework, gate, accept, contractPaths, loadTask,
} from '../src/tasks.js';
import { kiemKhuonResult, doiChieuKhaiTest, kiemKhuonPlanReview } from '../src/policy.js';
import { timKhoiLap, dinhNghiaSqlTrung, soiThayDoi } from '../src/lint-diff.js';
import { buildPlanCritiquePrompt, buildImplementMessage } from '../src/prompt.js';
import { TOOLS_BY_NAME } from '../src/tools.js';
import { tmpProject, cleanup, writeFile, sampleTaskArgs, PNG_1PX } from './helpers.js';

const KHAI_DU = ['src/Kinh.kt', 'src/test/java/KinhTest.kt'];
const CTX_DU = { changedFiles: KHAI_DU };
const EV_OK = { source: 'stdout', weak: true, noop: false, ok: true, reason: 'test' };
const call = async (name, args) => {
  const out = await TOOLS_BY_NAME.get(name).handler(args);
  return typeof out === 'string' ? { text: out } : out;
};

function gitRepo(config, files = {}) {
  const dir = tmpProject(config);
  execFileSync('git', ['init', '-q'], { cwd: dir });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: dir });
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: dir });
  writeFile(path.join(dir, '.gitignore'), '.antigravity-pm/\n');
  writeFile(path.join(dir, 'src', 'Kinh.kt'), 'fun haKinh() {}\n');
  for (const [f, c] of Object.entries(files)) writeFile(path.join(dir, f), c);
  execFileSync('git', ['add', '-A'], { cwd: dir });
  execFileSync('git', ['commit', '-qm', 'init'], { cwd: dir });
  return dir;
}

function taskXanh(cfgOver = {}, taskOver = {}, resultOver = {}) {
  const dir = tmpProject({ testCommand: 'echo ok', ...cfgOver });
  const cfg = loadConfig(dir);
  const task = createTask(cfg, sampleTaskArgs(taskOver));
  const p = contractPaths(cfg, task);
  writeFile(p.plan, '# Ke hoach\n1. Buoc 1\n2. Test');
  recordVerdict(cfg, task, { kind: 'plan', verdict: 'pass' });
  recordDispatch(cfg, task, { kind: 'implement' });
  writeFile(p.result, JSON.stringify({ phase: 'IMPLEMENT', summary: 'da sua', files_changed: KHAI_DU, ...resultOver }));
  const later = new Date(Date.now() + 2000);
  fs.utimesSync(p.result, later, later);
  recordVerdict(cfg, task, { kind: 'audit', verdict: 'pass' });
  recordVerdict(cfg, task, { kind: 'review', verdict: 'pass' });
  recordRun(cfg, task, { kind: 'test', command: 'echo ok', exitCode: 0, durationMs: 5, evidence: EV_OK });
  const img = writeFile(path.join(p.proofDir, 'a.png'), PNG_1PX);
  recordProof(cfg, task, { label: 'anh', provider: 'adb', file: img, bytes: PNG_1PX.length });
  return { dir, cfg, task, p };
}

// ---------------------------------------------------------------- DX2 result.json

test('DX2 result.json sai khuon (T0021 {"status":"PASS"}, tests_run, summary rong) => BI CHAN, mot dong gop', () => {
  assert.ok(kiemKhuonResult({ status: 'PASS', do_d_checklist: [] }).length >= 2);
  assert.deepEqual(kiemKhuonResult({ phase: 'IMPLEMENT', summary: 'x', files_changed: [] }), []);
  assert.deepEqual(kiemKhuonResult({ phase: 'implement', summary: 'x', files_changed: [], tests: { exitCode: 0 } }), [], 'phase chu thuong van hop le');
  assert.ok(kiemKhuonResult({ phase: 'IMPLEMENT', summary: 'x', files_changed: [], tests_run: null }).some((l) => /tests_run/.test(l)));
  const { dir, cfg, task } = taskXanh({}, {}, { summary: '   ', tests: { passed: 3 } });
  const g = gate(cfg, task, CTX_DU);
  assert.equal(g.ok, false);
  const dong = g.missing.filter((m) => /sai khuon/.test(m));
  assert.equal(dong.length, 1, g.missing.join(' | '));
  assert.match(dong[0], /summary rong/);
  assert.match(dong[0], /exitCode/);
  cleanup(dir);
});

test('DX2 KHAI SAI: agent khai failed=0 nhung XML PM do duoc failures>0 => BI CHAN (T0023 khai 63/69 pass)', () => {
  const evXml = { source: 'xml', ok: false, failures: 1, errors: 0, failedNames: ['a.BTest.x'], reason: '1 failures' };
  assert.match(doiChieuKhaiTest({ tests: { exitCode: 0, failed: 0 } }, evXml), /KHAI SAI/);
  assert.equal(doiChieuKhaiTest({ tests: { exitCode: 1, failed: 1 } }, evXml), null, 'khai dung thi khong bat');
  assert.equal(doiChieuKhaiTest({ tests: { failed: 0 } }, { source: 'stdout', ok: true }), null, 'khong co XML thi khong so');
  const { dir, cfg, task } = taskXanh({}, {}, { tests: { exitCode: 0, passed: 63, failed: 0 } });
  recordRun(cfg, task, { kind: 'test', command: 'x', exitCode: 1, durationMs: 1, evidence: evXml });
  const g = gate(cfg, task, CTX_DU);
  assert.ok(g.missing.some((m) => /KHAI SAI/.test(m) && /a\.BTest\.x/.test(m)), g.missing.join(' | '));
  cleanup(dir);
});

// ---------------------------------------------------------------- DX1 lint-diff

test('DX1b khoi >= 50 dong lap lai bi bat; noi dung ngan/rong khong bao nham', () => {
  const khoi = Array.from({ length: 60 }, (_, i) => `function f${i}() { return doSomething(${i}, "abc", true); }`).join('\n');
  assert.ok(timKhoiLap(`${khoi}\n// giua\n${khoi}`), 'nhan doi phai bat');
  assert.equal(timKhoiLap(khoi), null);
  assert.equal(timKhoiLap(Array(200).fill('}').join('\n')), null, 'toan dau ngoac khong tinh');
});

test('DX1c SQL: create table trung => CHAN; function trung chu ky => canh bao; overload khac tham so => khong', () => {
  const sql = `create table admin_sessions (id int);\nCREATE TABLE IF NOT EXISTS admin_sessions (id int);\n`
    + `create or replace function admin_session_ok(p text) returns bool as $$ $$;\ncreate function admin_session_ok(p text) returns bool as $$ $$;\n`
    + `create function f(a int) returns int as $$ $$;\ncreate function f(a text) returns int as $$ $$;\n`;
  const r = dinhNghiaSqlTrung(sql);
  assert.deepEqual(r.tables, ['admin_sessions']);
  assert.deepEqual(r.functions, ['admin_session_ok(p text)']);
});

test('DX1 tang gate: create table x2 trong .sql => BI CHAN; file tang >40 % => canh bao (khong chan)', () => {
  const dir = gitRepo({ testCommand: 'echo ok' }, { 'db/schema.sql': 'create table a (id int);\n', 'web/a.html': Array(100).fill('<p>x</p>').join('\n') });
  const base = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: dir, encoding: 'utf8' }).trim();
  writeFile(path.join(dir, 'db', 'schema.sql'), 'create table a (id int);\ncreate table a (id int);\n');
  writeFile(path.join(dir, 'web', 'a.html'), Array(160).fill('<p>x</p>').join('\n'));
  const soi = soiThayDoi(dir, ['db/schema.sql', 'web/a.html', 'src/Kinh.kt'], base);
  assert.equal(soi.blockers.length, 1, JSON.stringify(soi));
  assert.match(soi.blockers[0], /create table trung "a"/);
  assert.ok(soi.warnings.some((w) => /a\.html: 100 -> 160 dong/.test(w)), soi.warnings.join(' | '));
  const cfg = loadConfig(dir);
  const task = createTask(cfg, sampleTaskArgs());
  const g = gate(cfg, task, { ...CTX_DU, lintBlockers: soi.blockers, lintWarnings: soi.warnings });
  assert.ok(g.missing.some((m) => /Nhan doi noi dung/.test(m)));
  assert.ok(g.warnings.some((w) => /PM soi tan mat/.test(w)));
  cleanup(dir);
});

test('DX1 prompt implement cam va bang script', () => {
  const dir = tmpProject({});
  const cfg = loadConfig(dir);
  const task = createTask(cfg, sampleTaskArgs());
  writeFile(contractPaths(cfg, task).plan, '# x\n1. y');
  assert.match(buildImplementMessage(cfg, task), /KHONG va file bang script/);
  cleanup(dir);
});

// ---------------------------------------------------------------- DX4 plan_review

test('DX4b plan-review.json sai khuon (hasErrors / ACCEPT_WITH_REVISIONS / thieu findings) => pm_verdict plan pass BI CHAN', async () => {
  assert.ok(kiemKhuonPlanReview({ hasErrors: false, notes: [] }).length >= 2);
  assert.ok(kiemKhuonPlanReview({ verdict: 'ACCEPT_WITH_REVISIONS', findings: [{ id: 1, category: 'x' }] }).length >= 2);
  assert.deepEqual(kiemKhuonPlanReview({ verdict: 'ok', findings: [] }), []);
  assert.deepEqual(kiemKhuonPlanReview({ verdict: 'co_van_de', findings: [{ severity: 'major', problem: 'sai' }] }), []);
  const dir = tmpProject({});
  const created = await call('pm_task_create', { project: dir, title: 'x', brief: 'y', definitionOfDone: ['z'] });
  const taskId = /T\d{4}-[a-z0-9-]+/.exec(created.text)[0];
  await call('pm_plan', { project: dir, taskId, content: '# x\n1. y\n2. test' });
  const cfg = loadConfig(dir);
  const p = contractPaths(cfg, loadTask(cfg, taskId));
  writeFile(path.join(p.dir, 'plan-review.json'), JSON.stringify({ hasErrors: false, notes: [] }));
  await assert.rejects(call('pm_verdict', { project: dir, taskId, kind: 'plan', verdict: 'pass' }), /sai khuon/);
  writeFile(path.join(p.dir, 'plan-review.json'), JSON.stringify({ verdict: 'ok', findings: [] }));
  const ok = await call('pm_verdict', { project: dir, taskId, kind: 'plan', verdict: 'pass' });
  assert.ok(ok.text.includes('plan = pass'));
  cleanup(dir);
});

test('DX4a plan_hash: prompt phan bien mang ma ke hoach; review ghi hash khac (phan bien ban cu) => BI CHAN', async () => {
  const dir = tmpProject({});
  const cfg = loadConfig(dir);
  const task = createTask(cfg, sampleTaskArgs());
  writeFile(contractPaths(cfg, task).plan, '# v1\n1. a');
  const prompt = buildPlanCritiquePrompt(cfg, task, { planHash: 'abc123' });
  assert.match(prompt, /plan_hash\): abc123/);
  assert.match(prompt, /"plan_hash": "abc123"/);
  // Tang tool: gia lap da gui hash H1, agent phan bien voi hash cu H0.
  const created = await call('pm_task_create', { project: dir, title: 'x', brief: 'y', definitionOfDone: ['z'] });
  const taskId = /T\d{4}-[a-z0-9-]+/.exec(created.text)[0];
  await call('pm_plan', { project: dir, taskId, content: '# v2\n1. a\n2. test' });
  const t = loadTask(cfg, taskId);
  t.planHashSent = t.planHash;
  fs.writeFileSync(path.join(contractPaths(cfg, t).dir, 'task.json'), JSON.stringify(t));
  const rv = path.join(contractPaths(cfg, t).dir, 'plan-review.json');
  writeFile(rv, JSON.stringify({ verdict: 'ok', findings: [], plan_hash: 'ban-cu' }));
  await assert.rejects(call('pm_verdict', { project: dir, taskId, kind: 'plan', verdict: 'pass' }), /plan_hash khong khop/);
  writeFile(rv, JSON.stringify({ verdict: 'ok', findings: [], plan_hash: t.planHash }));
  const ok = await call('pm_verdict', { project: dir, taskId, kind: 'plan', verdict: 'pass' });
  assert.ok(ok.text.includes('plan = pass'), ok.text);
  cleanup(dir);
});

test('DX4c pm_plan luu ban cu (plan-v1.md + plan-review-v1.json) thay vi xoa; planVersion tang', async () => {
  const dir = tmpProject({});
  const created = await call('pm_task_create', { project: dir, title: 'x', brief: 'y', definitionOfDone: ['z'] });
  const taskId = /T\d{4}-[a-z0-9-]+/.exec(created.text)[0];
  const cfg = loadConfig(dir);
  await call('pm_plan', { project: dir, taskId, content: '# v1\n1. a\n2. test' });
  const p = contractPaths(cfg, loadTask(cfg, taskId));
  writeFile(path.join(p.dir, 'plan-review.json'), JSON.stringify({ verdict: 'co_van_de', findings: [{ severity: 'major', problem: 'thieu admin_by' }] }));
  const out = await call('pm_plan', { project: dir, taskId, content: '# v2\n1. a\n2. them admin_by\n3. test' });
  assert.ok(out.text.includes('v2'), out.text);
  assert.ok(fs.existsSync(path.join(p.logsDir, 'plan-v1.md')));
  assert.ok(fs.existsSync(path.join(p.logsDir, 'plan-review-v1.json')));
  assert.equal(fs.existsSync(path.join(p.dir, 'plan-review.json')), false, 'phan bien cu khong con la phan bien hien hanh');
  assert.equal(loadTask(cfg, taskId).planVersion, 2);
  cleanup(dir);
});

test('DX4d pm_status: giao phan bien qua stallMinutes chua co file => "REVIEW TREO"', async () => {
  const dir = tmpProject({ stallMinutes: 1 });
  const created = await call('pm_task_create', { project: dir, title: 'x', brief: 'y', definitionOfDone: ['z'] });
  const taskId = /T\d{4}-[a-z0-9-]+/.exec(created.text)[0];
  await call('pm_plan', { project: dir, taskId, content: '# v1\n1. a\n2. test' });
  const cfg = loadConfig(dir);
  const t = loadTask(cfg, taskId);
  t.planReviewDispatchedAt = new Date(Date.now() - 5 * 60000).toISOString();
  fs.writeFileSync(path.join(contractPaths(cfg, t).dir, 'task.json'), JSON.stringify(t));
  const st = await call('pm_status', { project: dir, taskId });
  assert.ok(st.text.includes('REVIEW TREO'), st.text);
  // Sai khuon + co hoi thoai phan bien: pm_status van tra ve (khong no) du Antigravity dong hay mo —
  // may dong: "khong nhac duoc"; may dang mo Antigravity: "da tu nhac". Test khong duoc phu thuoc moi truong.
  writeFile(path.join(contractPaths(cfg, t).dir, 'plan-review.json'), JSON.stringify({ hasErrors: false, notes: [] }));
  t.planReviewConversationId = 'conv-khong-ton-tai';
  fs.writeFileSync(path.join(contractPaths(cfg, t).dir, 'task.json'), JSON.stringify(t));
  const st2 = await call('pm_status', { project: dir, taskId });
  assert.ok(st2.text.includes('SAI KHUON'), st2.text);
  assert.ok(/khong nhac duoc|da tu nhac/.test(st2.text), st2.text);
  // Lan 2 cung plan_hash: khong nhac lai (chong spam).
  const st3 = await call('pm_status', { project: dir, taskId });
  if (st2.text.includes('da tu nhac')) assert.ok(!st3.text.includes('da tu nhac'), 'khong duoc nhac lan 2 cho cung plan_hash');
  cleanup(dir);
});

// ---------------------------------------------------------------- DX5 pm_run

test('DX5b stage: thieu skipReason => chan; co skipReason => ghi vao run va gate canh bao "chi chay stage"', async () => {
  const dir = gitRepo({ testCommand: 'echo full', testStages: { unit: 'echo "unit ok"' } });
  const created = await call('pm_task_create', { project: dir, title: 'x', brief: 'y', definitionOfDone: ['z'] });
  const taskId = /T\d{4}-[a-z0-9-]+/.exec(created.text)[0];
  await assert.rejects(call('pm_run', { project: dir, taskId, kind: 'test', stage: 'unit' }), /skipReason/);
  await assert.rejects(call('pm_run', { project: dir, taskId, kind: 'test', stage: 'khong-co', skipReason: 'x' }), /Khong co stage/);
  const out = await call('pm_run', { project: dir, taskId, kind: 'test', stage: 'unit', skipReason: 'cong 0a do vi kho public thieu res_audio' });
  assert.ok(out.text.includes('CHI CHAY STAGE "unit"'), out.text);
  assert.ok(out.text.includes('unit ok'));
  const cfg = loadConfig(dir);
  const task = loadTask(cfg, taskId);
  assert.equal(task.runs[0].stage, 'unit');
  assert.match(task.runs[0].skipReason, /res_audio/);
  const g = gate(cfg, task, CTX_DU);
  assert.ok(g.warnings.some((w) => /chi chay stage "unit"/.test(w)), g.warnings.join(' | '));
  const log = fs.readFileSync(task.runs[0].logFile, 'utf8');
  assert.match(log, /HEAD [0-9a-f]{7}/, 'log phai ghi HEAD');
  assert.match(log, /file dirty/);
  cleanup(dir);
});

test('DX5a pm_run worktree=true: test chay trong cay dong bang co thay doi hien tai, worktree duoc don', async () => {
  const dir = gitRepo({ testCommand: 'cat src/Kinh.kt; ls moi.txt; pwd' });
  const created = await call('pm_task_create', { project: dir, title: 'x', brief: 'y', definitionOfDone: ['z'] });
  const taskId = /T\d{4}-[a-z0-9-]+/.exec(created.text)[0];
  writeFile(path.join(dir, 'src', 'Kinh.kt'), 'fun haKinh() { xacNhan() }\n');
  writeFile(path.join(dir, 'moi.txt'), 'file moi\n');
  writeFile(path.join(dir, 'fix_x.py'), '# rac\n');
  const out = await call('pm_run', { project: dir, taskId, kind: 'test', worktree: true });
  assert.ok(out.text.includes('worktree dong bang'), out.text);
  assert.ok(out.text.includes('xacNhan()'), 'thay doi chua commit phai co trong worktree');
  assert.ok(out.text.includes('moi.txt'));
  assert.ok(!out.text.includes(`${dir}\n`), 'pwd phai la worktree, khong phai cay that');
  const wts = execFileSync('git', ['worktree', 'list'], { cwd: dir, encoding: 'utf8' }).trim().split('\n');
  assert.equal(wts.length, 1, 'worktree tam phai duoc go');
  cleanup(dir);
});

// ---------------------------------------------------------------- phu

test('DX-phu finding chua dong: pm_rework luu danh sach, pm_status in, review pass thi dong', async () => {
  const { dir, cfg, task } = taskXanh();
  markRework(cfg, task, '2 phat hien', ['A sai o a.kt:1', 'B thieu test']);
  assert.deepEqual(task.openFindings, ['A sai o a.kt:1', 'B thieu test']);
  const st = await call('pm_status', { project: dir, taskId: task.id });
  assert.ok(st.text.includes('FINDING CHUA DONG') && st.text.includes('B thieu test'), st.text);
  recordVerdict(cfg, task, { kind: 'review', verdict: 'pass' });
  assert.deepEqual(task.openFindings, []);
  cleanup(dir);
});
