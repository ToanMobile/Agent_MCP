// Luat bat buoc cua chu du an: thay doi phai kem file test + anh phai chup tu thiet bi that.
// Test o day soi phan NHAN DIEN (glob) va phan CHAN (gate) — nang nhat la cac ca BI CHAN.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import { loadConfig } from '../src/config.js';
import { matchesAny, mustHaveOf, checkTestChange, checkProofProvider, mustHaveLines } from '../src/policy.js';
import {
  createTask, recordVerdict, recordRun, recordProof, recordDispatch, gate, accept, contractPaths,
} from '../src/tasks.js';
import { tmpProject, cleanup, writeFile, sampleTaskArgs, PNG_1PX } from './helpers.js';

const PATTERNS = mustHaveOf({}).testFilePatterns;

test('nhan dien file test: cac bo cuc quen thuoc deu bat duoc', () => {
  for (const f of [
    'CarConnect/app/src/test/java/com/x/VoiceServiceTest.kt',
    'CarConnect/app/src/androidTest/java/com/x/SmokeTest.kt',
    'tests/gate.test.js',
    'src/__tests__/kinh.spec.ts',
    'internal/voice/parser_test.go',
    'app/KinhTests.swift',
  ]) {
    assert.ok(matchesAny(f, PATTERNS), `phai nhan ra la file test: ${f}`);
  }
});

test('nhan dien file test: file nguon thuong KHONG bi nham la test', () => {
  for (const f of [
    'CarConnect/app/src/main/java/com/x/VoiceService.kt',
    'src/Kinh.kt',
    'docs/testing.md',
    'scripts/test.sh',
    'src/contest/Contestant.kt',
  ]) {
    assert.ok(!matchesAny(f, PATTERNS), `khong duoc coi la file test: ${f}`);
  }
});

test('khong do duoc git thi bao CHUA XAC MINH, tuyet doi khong coi la dat', () => {
  const r = checkTestChange({}, undefined);
  assert.equal(r.ok, false);
  assert.equal(r.unknown, true);
});

test('tat luat bang mustHave.testChange=false', () => {
  const r = checkTestChange({ mustHave: { testChange: false } }, ['src/Kinh.kt']);
  assert.equal(r.required, false);
  assert.equal(r.ok, true);
});

test('proofFrom rong = chap nhan moi provider; khai roi thi chi nhan dung provider do', () => {
  const proofs = [{ provider: 'file' }];
  assert.equal(checkProofProvider({}, proofs).ok, true);
  assert.equal(checkProofProvider({ mustHave: { proofFrom: ['xe'] } }, proofs).ok, false);
  assert.equal(checkProofProvider({ mustHave: { proofFrom: ['xe'] } }, [{ provider: 'xe' }]).ok, true);
});

test('luat duoc nhac thang cho agent trong prompt', () => {
  const lines = mustHaveLines({ mustHave: { proofFrom: ['xe'] } });
  assert.ok(lines.some((l) => l.includes('KEM FILE TEST')));
  assert.ok(lines.some((l) => l.includes('thiet bi that') && l.includes('xe')));
});

// ---------------------------------------------------------------- cong chan

function taskSanSangNghiemThu(cfgOver = {}) {
  const dir = tmpProject({ testCommand: 'echo ok', ...cfgOver });
  const cfg = loadConfig(dir);
  const task = createTask(cfg, sampleTaskArgs());
  const p = contractPaths(cfg, task);
  writeFile(p.plan, '# Ke hoach');
  recordVerdict(cfg, task, { kind: 'plan', verdict: 'pass' });
  recordDispatch(cfg, task, { kind: 'implement' });
  writeFile(p.result, JSON.stringify({ phase: 'IMPLEMENT', summary: 'da sua', files_changed: ['src/Kinh.kt', 'src/test/java/KinhTest.kt'] }));
  // Agent that mat vai giay moi bao cao; test chay trong 1ms nen phai gia lap moc thoi gian.
  const later = new Date(Date.now() + 2000);
  fs.utimesSync(p.result, later, later);
  recordVerdict(cfg, task, { kind: 'audit', verdict: 'pass' });
  recordVerdict(cfg, task, { kind: 'review', verdict: 'pass' });
  recordRun(cfg, task, { kind: 'test', command: 'echo ok', exitCode: 0, durationMs: 5, evidence: { ok: true, source: 'stdout', reason: 'test' } });
  return { dir, cfg, task, p };
}

test('chi sua code ma khong dong vao test nao => BI CHAN', () => {
  const { dir, cfg, task, p } = taskSanSangNghiemThu();
  const img = writeFile(path.join(p.proofDir, 'a.png'), PNG_1PX);
  recordProof(cfg, task, { label: 'anh', provider: 'xe', file: img, bytes: PNG_1PX.length });

  const g = gate(cfg, task, { changedFiles: ['src/Kinh.kt', 'docs/ghi-chu.md'] });
  assert.equal(g.ok, false);
  assert.ok(g.missing.some((m) => m.includes('KHONG kem file test')), g.missing.join(' | '));
  assert.throws(() => accept(cfg, task, { changedFiles: ['src/Kinh.kt'] }), /CHUA DU BANG CHUNG/);
  cleanup(dir);
});

test('co sua file test kem theo => qua duoc luat nay', () => {
  const { dir, cfg, task, p } = taskSanSangNghiemThu();
  const img = writeFile(path.join(p.proofDir, 'a.png'), PNG_1PX);
  recordProof(cfg, task, { label: 'anh', provider: 'xe', file: img, bytes: PNG_1PX.length });

  const g = gate(cfg, task, { changedFiles: ['src/Kinh.kt', 'src/test/java/KinhTest.kt'] });
  assert.equal(g.ok, true, g.missing.join(' | '));
  assert.deepEqual(g.evidence.testFilesChanged, ['src/test/java/KinhTest.kt']);
  cleanup(dir);
});

test('anh chup bang man hinh may trong khi du an doi anh tu xe => BI CHAN', () => {
  const { dir, cfg, task, p } = taskSanSangNghiemThu({ mustHave: { proofFrom: ['xe', 'mayao'] } });
  const img = writeFile(path.join(p.proofDir, 'a.png'), PNG_1PX);
  recordProof(cfg, task, { label: 'anh man hinh may', provider: 'man', file: img, bytes: PNG_1PX.length });

  const g = gate(cfg, task, { changedFiles: ['src/Kinh.kt', 'src/test/java/KinhTest.kt'] });
  assert.equal(g.ok, false);
  assert.ok(g.missing.some((m) => m.includes('thiet bi that') && m.includes('xe')), g.missing.join(' | '));
  cleanup(dir);
});

test('anh agent tu dua (provider file) cung KHONG duoc tinh khi du an doi anh tu xe', () => {
  const { dir, cfg, task, p } = taskSanSangNghiemThu({ mustHave: { proofFrom: ['xe'] } });
  const img = writeFile(path.join(p.proofDir, 'a.png'), PNG_1PX);
  recordProof(cfg, task, { label: 'anh agent dua', provider: 'file', file: img, bytes: PNG_1PX.length });
  assert.equal(gate(cfg, task, { changedFiles: ['src/Kinh.kt', 'src/test/java/KinhTest.kt'] }).ok, false);

  const img2 = writeFile(path.join(p.proofDir, 'b.png'), PNG_1PX);
  recordProof(cfg, task, { label: 'anh tu xe', provider: 'xe', file: img2, bytes: PNG_1PX.length });
  assert.equal(gate(cfg, task, { changedFiles: ['src/Kinh.kt', 'src/test/java/KinhTest.kt'] }).ok, true);
  cleanup(dir);
});

test('khong doc duoc git => cong chan noi CHUA XAC MINH chu khong cho qua', () => {
  const { dir, cfg, task, p } = taskSanSangNghiemThu();
  const img = writeFile(path.join(p.proofDir, 'a.png'), PNG_1PX);
  recordProof(cfg, task, { label: 'anh', provider: 'xe', file: img, bytes: PNG_1PX.length });

  const g = gate(cfg, task, {});
  assert.equal(g.ok, false);
  assert.ok(g.missing.some((m) => m.includes('CHUA XAC MINH')), g.missing.join(' | '));
  cleanup(dir);
});
