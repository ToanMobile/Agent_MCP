// Cong nghiem thu la thu duy nhat khong duoc phep lam mem => test ky nhat o day.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import { loadConfig } from '../src/config.js';
import {
  createTask, recordVerdict, recordRun, recordProof, markRework, gate, accept, contractPaths, loadTask,
} from '../src/tasks.js';
import { tmpProject, cleanup, writeFile, sampleTaskArgs, PNG_1PX } from './helpers.js';

function setupTask(cfgOver = {}) {
  const dir = tmpProject({ testCommand: 'echo ok', ...cfgOver });
  const cfg = loadConfig(dir);
  const task = createTask(cfg, sampleTaskArgs());
  return { dir, cfg, task };
}

/** Dua task ve trang thai "du bang chung" theo tung buoc. */
function makeEverythingGreen(cfg, task) {
  const p = contractPaths(cfg, task);
  writeFile(p.plan, '# Ke hoach\n- Buoc 1');
  recordVerdict(cfg, task, { kind: 'plan', verdict: 'pass' });
  writeFile(p.result, JSON.stringify({ phase: 'IMPLEMENT', summary: 'da lam', files_changed: ['a.kt'] }));
  recordVerdict(cfg, task, { kind: 'audit', verdict: 'pass' });
  recordVerdict(cfg, task, { kind: 'review', verdict: 'pass' });
  recordRun(cfg, task, { kind: 'test', command: 'echo ok', exitCode: 0, durationMs: 10 });
  const img = path.join(p.proofDir, 'shot.png');
  writeFile(img, PNG_1PX);
  recordProof(cfg, task, { label: 'man hinh xac nhan', provider: 'adb', file: img, bytes: PNG_1PX.length });
  return task;
}

test('task moi thi cong chan chan het, va liet ke du thu con thieu', () => {
  const { dir, cfg, task } = setupTask();
  const g = gate(cfg, task);
  assert.equal(g.ok, false);
  const joined = g.missing.join('\n');
  for (const phrase of ['plan.md', 'duyet plan', 'result.json', 'AUDIT', 'CODE REVIEW', 'test', 'anh nghiem thu']) {
    assert.ok(joined.includes(phrase), `thieu canh bao ve "${phrase}" trong:\n${joined}`);
  }
  assert.throws(() => accept(cfg, task), /CHUA DU BANG CHUNG/);
  cleanup(dir);
});

test('du het bang chung thi nghiem thu duoc', () => {
  const { dir, cfg, task } = setupTask();
  makeEverythingGreen(cfg, task);
  const g = gate(cfg, task);
  assert.equal(g.ok, true, `van con thieu: ${g.missing.join(' | ')}`);
  const accepted = accept(cfg, task);
  assert.equal(accepted.phase, 'ACCEPTED');
  assert.ok(accepted.acceptedAt);
  cleanup(dir);
});

test('test do (exit != 0) thi KHONG duoc nghiem thu', () => {
  const { dir, cfg, task } = setupTask();
  makeEverythingGreen(cfg, task);
  task.runs = task.runs.filter((r) => r.kind !== 'test');
  recordRun(cfg, task, { kind: 'test', command: './gradlew test', exitCode: 1, durationMs: 10 });
  const g = gate(cfg, task);
  assert.equal(g.ok, false);
  assert.ok(g.missing.some((m) => m.includes('exit 0')), g.missing.join(' | '));
  cleanup(dir);
});

test('test qua han thi khong tinh la xanh', () => {
  const { dir, cfg, task } = setupTask();
  makeEverythingGreen(cfg, task);
  task.runs = [];
  recordRun(cfg, task, { kind: 'test', command: './gradlew test', exitCode: 0, durationMs: 10, timedOut: true });
  assert.equal(gate(cfg, task).ok, false);
  cleanup(dir);
});

test('thieu anh nghiem thu thi khong nghiem thu duoc, du code xanh', () => {
  const { dir, cfg, task } = setupTask();
  makeEverythingGreen(cfg, task);
  task.proofs = [];
  const g = gate(cfg, task);
  assert.equal(g.ok, false);
  assert.ok(g.missing.some((m) => m.includes('anh nghiem thu')));
  cleanup(dir);
});

test('anh bi xoa khoi dia thi khong con tinh la bang chung', () => {
  const { dir, cfg, task } = setupTask();
  makeEverythingGreen(cfg, task);
  fs.rmSync(task.proofs[0].file);
  assert.equal(gate(cfg, task).ok, false);
  cleanup(dir);
});

test('rework huy bang chung cua vong truoc: audit/review/test/anh deu khong con tinh', () => {
  const { dir, cfg, task } = setupTask();
  makeEverythingGreen(cfg, task);
  assert.equal(gate(cfg, task).ok, true);

  markRework(cfg, task, 'thieu xu ly truong hop kinh dang keo');
  assert.equal(task.round, 1);
  assert.equal(task.phase, 'IMPLEMENT');
  assert.equal(task.verdicts.audit, undefined);
  assert.equal(task.verdicts.review, undefined);
  // Plan van con hieu luc (ke hoach chua bi bac).
  assert.equal(task.verdicts.plan.verdict, 'pass');

  const g = gate(cfg, task);
  assert.equal(g.ok, false);
  const joined = g.missing.join('\n');
  assert.ok(joined.includes('vong 1'), joined);
  assert.ok(joined.includes('result.json cu hon lan rework') || joined.includes('result.json'), joined);
  cleanup(dir);
});

test('sau rework: result.json ghi lai + bang chung moi thi nghiem thu lai duoc', () => {
  const { dir, cfg, task } = setupTask();
  makeEverythingGreen(cfg, task);
  markRework(cfg, task, 'sua lai di');

  const p = contractPaths(cfg, task);
  writeFile(p.result, JSON.stringify({ phase: 'IMPLEMENT', summary: 'da sua theo phat hien' }));
  // Agent that mat vai giay/phut moi bao cao lai; test chay trong 1ms nen phai gia lap moc thoi gian.
  const later = new Date(Date.now() + 2000);
  fs.utimesSync(p.result, later, later);
  recordVerdict(cfg, task, { kind: 'audit', verdict: 'pass' });
  recordVerdict(cfg, task, { kind: 'review', verdict: 'pass' });
  recordRun(cfg, task, { kind: 'test', command: 'echo ok', exitCode: 0, durationMs: 5 });
  const img = writeFile(path.join(p.proofDir, 'shot2.png'), PNG_1PX);
  recordProof(cfg, task, { label: 'lan 2', provider: 'adb', file: img, bytes: PNG_1PX.length });

  const g = gate(cfg, task);
  assert.equal(g.ok, true, g.missing.join(' | '));
  cleanup(dir);
});

test('rework rong feedback thi bi chan', () => {
  const { dir, cfg, task } = setupTask();
  assert.throws(() => markRework(cfg, task, '   '), /feedback rong/);
  cleanup(dir);
});

test('project yeu cau 2 anh thi 1 anh la chua du', () => {
  const { dir, cfg, task } = setupTask({ proof: { require: 2 } });
  makeEverythingGreen(cfg, task);
  assert.equal(gate(cfg, task).ok, false);
  const p = contractPaths(cfg, task);
  const img = writeFile(path.join(p.proofDir, 'shot-b.png'), PNG_1PX);
  recordProof(cfg, task, { label: 'anh 2', provider: 'adb', file: img, bytes: PNG_1PX.length });
  assert.equal(gate(cfg, task).ok, true);
  cleanup(dir);
});

test('ho so task doc lai duoc tu dia (khong mat trang thai giua cac phien)', () => {
  const { dir, cfg, task } = setupTask();
  makeEverythingGreen(cfg, task);
  const again = loadTask(loadConfig(dir), task.id);
  assert.equal(again.id, task.id);
  assert.equal(again.verdicts.review.verdict, 'pass');
  assert.equal(gate(loadConfig(dir), again).ok, true);
  cleanup(dir);
});
