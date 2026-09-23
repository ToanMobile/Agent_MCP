// 5 de xuat tu phien PM project Unity (T0001–T0014, 14/09/2026): trich dan bia, prompt phinh/stream ngat,
// anh trung byte, hop dong + pham vi bang may, lam mem guard / pha test.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { loadConfig } from '../src/config.js';
import { createTask, recordProof, recordDispatch, gate, contractPaths, loadTask, anhTrung, hashFile, taskFile } from '../src/tasks.js';
import { fileCamDung, fileRacGocRepo } from '../src/policy.js';
import { tachTrichDan, kiemTrichDan, kiemBaoCao } from '../src/cite-check.js';
import { phanTichDiff, soiLamMem, soiThayDoi } from '../src/lint-diff.js';
import { buildPlanCritiquePrompt, buildImplementMessage } from '../src/prompt.js';
import { TOOLS_BY_NAME } from '../src/tools.js';
import { tmpProject, cleanup, writeFile, sampleTaskArgs, PNG_1PX, tick } from './helpers.js';

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
  for (const [f, c] of Object.entries(files)) writeFile(path.join(dir, f), c);
  execFileSync('git', ['add', '-A'], { cwd: dir });
  execFileSync('git', ['commit', '-qm', 'init'], { cwd: dir });
  return dir;
}

// ---------------------------------------------------------------- U1 trich dan

test('U1 kiemTrichDan: verified (±3 dong) / line-off / not-found / exists / line-out / file-missing', () => {
  const dir = tmpProject({});
  writeFile(path.join(dir, 'Game.cs'), ['using X;', 'class Game {', '  int a;', '  int b;', '  int c;', '  int d;', '  int e;', '  int f;', '  void Save() {', '    progress.Write();', '  }', '}'].join('\n'));
  assert.equal(kiemTrichDan(dir, { file: 'Game.cs', line: 10, snippet: 'progress.Write()' }).status, 'verified');
  assert.equal(kiemTrichDan(dir, { file: 'Game.cs', line: 12, snippet: 'progress.Write()' }).status, 'verified', 'lech 2 dong van verified');
  const off = kiemTrichDan(dir, { file: 'Game.cs', line: 2, snippet: 'progress.Write()' });
  assert.equal(off.status, 'line-off');
  assert.equal(off.foundLine, 10);
  assert.equal(kiemTrichDan(dir, { file: 'Game.cs', line: 72, snippet: '// TODO' }).status, 'not-found', 'ca file khong co TODO');
  assert.equal(kiemTrichDan(dir, { file: 'Game.cs', line: 3 }).status, 'exists');
  assert.equal(kiemTrichDan(dir, { file: 'Game.cs', line: 99 }).status, 'line-out');
  assert.equal(kiemTrichDan(dir, { file: 'Khac.cs', line: 1, snippet: 'x' }).status, 'file-missing');
  assert.deepEqual(tachTrichDan('sai o src/A.kt:12 va (B.cs:7), xem `c/d.py:3`'), [{ file: 'src/A.kt', line: 12 }, { file: 'B.cs', line: 7 }, { file: 'c/d.py', line: 3 }]);
  cleanup(dir);
});

test('U1 tang tool: audit-agent.json co trich dan BIA => pm_verdict audit pass BI CHAN; trich dan dung thi qua', async () => {
  const dir = tmpProject({});
  writeFile(path.join(dir, 'Game.cs'), 'class Game {\n  int hp = 3;\n}\n');
  const created = await call('pm_task_create', { project: dir, title: 'x', brief: 'y', definitionOfDone: ['z'] });
  const taskId = /T\d{4}-[a-z0-9-]+/.exec(created.text)[0];
  const cfg = loadConfig(dir);
  const p = contractPaths(cfg, loadTask(cfg, taskId));
  recordDispatch(cfg, loadTask(cfg, taskId), { kind: 'implement', conversationId: 'c-test' });
  tick();
  writeFile(path.join(p.dir, 'audit-agent.json'), JSON.stringify({ verdict: 'pass', findings: [
    { severity: 'minor', file: 'Game.cs:72', snippet: '// TODO', problem: 'con TODO' },
  ], dod_check: [] }));
  await assert.rejects(call('pm_verdict', { project: dir, taskId, kind: 'audit', verdict: 'pass' }), /trich dan BIA[\s\S]*Game\.cs:72 \[not-found\]/);
  const st = await call('pm_status', { project: dir, taskId });
  assert.ok(st.text.includes('NOT-FOUND') && st.text.includes('CO TRICH DAN BIA'), st.text);
  writeFile(path.join(p.dir, 'audit-agent.json'), JSON.stringify({ verdict: 'pass', findings: [
    { severity: 'minor', file: 'Game.cs:2', snippet: 'int hp = 3', problem: 'hard-code' },
  ] }));
  const ok = await call('pm_verdict', { project: dir, taskId, kind: 'audit', verdict: 'pass' });
  assert.ok(ok.text.includes('1 verified'), ok.text);
  // file-missing = co the la chinh finding => chi canh bao, khong chan.
  writeFile(path.join(p.dir, 'audit-agent.json'), JSON.stringify({ verdict: 'pass', findings: [
    { severity: 'major', file: 'src/New.kt:12', snippet: 'x', problem: 'plan nhac file khong ton tai' },
  ] }));
  const ok2 = await call('pm_verdict', { project: dir, taskId, kind: 'audit', verdict: 'pass' });
  assert.ok(ok2.text.includes('CANH BAO') && ok2.text.includes('src/New.kt'), ok2.text);
  // audit-agent.json cu hon lan rework => bo qua, khong chan hoi to.
  writeFile(path.join(p.dir, 'audit-agent.json'), JSON.stringify({ verdict: 'pass', findings: [
    { severity: 'minor', file: 'Game.cs:72', snippet: '// TODO', problem: 'bia' },
  ] }));
  const old = new Date(Date.now() - 60000);
  fs.utimesSync(path.join(p.dir, 'audit-agent.json'), old, old);
  const t = loadTask(cfg, taskId);
  t.lastReworkAt = new Date().toISOString();
  fs.writeFileSync(taskFile(cfg, t.id), JSON.stringify(t));
  const ok3 = await call('pm_verdict', { project: dir, taskId, kind: 'audit', verdict: 'pass' });
  assert.ok(ok3.text.includes('audit-agent.json cu hon'), ok3.text);
  // Prompt phan bien + audit doi snippet va bao truoc se kiem bang may.
  const task = loadTask(cfg, taskId);
  writeFile(contractPaths(cfg, task).plan, '# x\n1. y');
  assert.match(buildPlanCritiquePrompt(cfg, task), /"snippet"/);
  assert.match(buildPlanCritiquePrompt(cfg, task), /KIEM BANG MAY/);
  cleanup(dir);
});

// ---------------------------------------------------------------- U2 prompt phinh

test('U2 plan.md qua tran promptPlanMaxBytes thi cat + chi duong dan; mac dinh 12 KB; dispatch canh bao prompt > 20 KB', () => {
  const dir = tmpProject({ promptPlanMaxBytes: 500 });
  const cfg = loadConfig(dir);
  const task = createTask(cfg, sampleTaskArgs());
  writeFile(contractPaths(cfg, task).plan, `# Ke hoach\n${'1. buoc dai '.repeat(200)}`);
  const msg = buildImplementMessage(cfg, task);
  assert.match(msg, /cat o 500 — DOC BAN DAY DU tai/);
  assert.ok(msg.length < 9000, `prompt phai ngan (plan bi cat, con lai la luat + hop dong ~7 KB): ${msg.length}`);
  assert.equal(loadConfig(tmpProject({})).promptPlanMaxBytes, 12000);
  cleanup(dir);
});

test('U2 transcriptErrors: doc duoi transcript, chi lay type/created_at, buoc cuoi la ERROR_MESSAGE => bao', async () => {
  const { transcriptErrors } = await import('../src/agentapi.js');
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'agpm-home-'));
  const oldHome = process.env.HOME;
  process.env.HOME = home;
  try {
    const id = 'conv-test';
    const f = path.join(home, '.gemini/antigravity/brain', id, '.system_generated/logs/transcript.jsonl');
    writeFile(f, [
      '{"step_index":1,"source":"USER","type":"GENERIC","status":"DONE","created_at":"2026-09-13T16:00:00Z","content":"bi mat"}',
      '{"step_index":2,"source":"SYSTEM","type":"ERROR_MESSAGE","status":"DONE","created_at":"2026-09-13T16:55:47Z","content":"Error: The stream was interrupted."}',
    ].join('\n'));
    const r = transcriptErrors(id);
    assert.equal(r.found, true);
    assert.equal(r.errorCount, 1);
    assert.equal(r.lastStepIsError, true);
    assert.equal(r.lastErrorAt, '2026-09-13T16:55:47Z');
    assert.ok(!JSON.stringify(r).includes('bi mat') && !JSON.stringify(r).includes('interrupted'), 'khong duoc tra ve content');
    assert.equal(transcriptErrors('khong-co').found, false);
  } finally {
    process.env.HOME = oldHome;
    cleanup(home);
  }
});

// ---------------------------------------------------------------- U3 anh trung byte

test('U3 anh trung byte voi task khac => canh bao (sha256 luu trong ho so)', async () => {
  const dir = tmpProject({});
  const cfg = loadConfig(dir);
  const t1 = createTask(cfg, sampleTaskArgs({ title: 'mot' }));
  const img1 = writeFile(path.join(contractPaths(cfg, t1).proofDir, 'a.png'), PNG_1PX);
  recordProof(cfg, t1, { label: 'man hinh', provider: 'adb', file: img1, bytes: PNG_1PX.length });
  assert.equal(t1.proofs[0].sha256, hashFile(img1));
  const t2 = createTask(cfg, sampleTaskArgs({ title: 'hai' }));
  assert.deepEqual(anhTrung(cfg, t2, hashFile(img1)), [`${t1.id} vong 0 "man hinh"`]);
  assert.deepEqual(anhTrung(cfg, t1, hashFile(img1)), [], 'cung task cung vong thi khong tinh');
  const src = writeFile(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'agpm-s-')), 'b.png'), PNG_1PX);
  const out = await call('pm_capture_proof', { project: dir, taskId: t2.id, label: 'anh 2', sourceFile: src });
  assert.ok(out.text.includes('TRUNG BYTE') && out.text.includes(t1.id), out.text);
  cleanup(dir);
});

// ---------------------------------------------------------------- U4 hop dong + pham vi

test('U4 forbiddenPaths: cham file plan CAM sua => BI CHAN; result.json o goc repo = rac + pm_status nhac', async () => {
  assert.deepEqual(fileCamDung({ forbiddenPaths: ['Assets/ItemState.cs', 'shared/'] }, ['Assets/ItemState.cs', 'shared/A.kt', 'app/B.kt']), ['Assets/ItemState.cs', 'shared/A.kt']);
  assert.deepEqual(fileCamDung({ forbiddenPaths: ['**/*.sql'] }, ['db/schema.sql', 'a.kt']), ['db/schema.sql']);
  assert.ok(fileRacGocRepo(['result.json', 'plan-review.json', 'src/result.json'], null).length === 2);
  const dir = tmpProject({});
  const created = await call('pm_task_create', { project: dir, title: 'x', brief: 'y', definitionOfDone: ['z'] });
  const taskId = /T\d{4}-[a-z0-9-]+/.exec(created.text)[0];
  const plan = await call('pm_plan', { project: dir, taskId, content: '# x\n1. y\n2. test', forbidden: ['Assets/ItemState.cs'] });
  assert.ok(plan.text.includes('CAM dung: Assets/ItemState.cs'), plan.text);
  const cfg = loadConfig(dir);
  const task = loadTask(cfg, taskId);
  const g = gate(cfg, task, { changedFiles: ['Assets/ItemState.cs', 'src/test/ATest.kt'] });
  assert.ok(g.missing.some((m) => /CAM sua: Assets\/ItemState\.cs/.test(m)), g.missing.join(' | '));
  writeFile(path.join(dir, 'result.json'), '{"phase":"IMPLEMENT"}');
  const st = await call('pm_status', { project: dir, taskId });
  assert.ok(st.text.includes('ghi NHAM cho'), st.text);
  cleanup(dir);
});

// ---------------------------------------------------------------- U5 lam mem guard / pha test

test('U5 soiLamMem: guard bi xoa, boc isPlaying, assert xoa trong test, hang so 9999 trong test runner', () => {
  const diff = [
    'diff --git a/Assets/Shelf.cs b/Assets/Shelf.cs',
    '@@ -10,2 +10,1 @@',
    '-        if (count < 0) throw new Exception("neg");',
    '-        Assert.IsTrue(ok);',
    '+        if (!Application.isPlaying) comp.SyncWithChildren();',
    'diff --git a/Assets/Tests/PlayModeSmokeTestRunner.cs b/Assets/Tests/PlayModeSmokeTestRunner.cs',
    '@@ -5,1 +5,1 @@',
    '-        Assert.AreEqual(3, mgr.Lives);',
    '+        mgr.AddExtraTime(9999f);',
    'diff --git a/Assets/Ok.cs b/Assets/Ok.cs',
    '@@ -1,1 +1,1 @@',
    '-        if (a) b();',
    '+        if (a) b();',
  ].join('\n');
  const files = phanTichDiff(diff);
  assert.equal(files.length, 3);
  const w = soiLamMem(files);
  assert.ok(w.some((x) => /Shelf\.cs: 2 dong guard bi xoa/.test(x)), w.join('\n'));
  assert.ok(w.some((x) => /Shelf\.cs: production code bi boc bang co test\/debug/.test(x)), w.join('\n'));
  assert.ok(w.some((x) => /PlayModeSmokeTestRunner\.cs: 1 dong assert\/expect bi xoa/.test(x)), w.join('\n'));
  assert.ok(w.some((x) => /PlayModeSmokeTestRunner\.cs: hang so "vo han"/.test(x)), w.join('\n'));
  assert.ok(!w.some((x) => /Ok\.cs/.test(x)), 'dong xoa roi them lai y het thi khong bao');
});

test('U5 tang gate: guard bi xoa trong repo that => warnings (PM soi tan mat), khong chan', () => {
  const dir = gitRepo({}, { 'src/Shelf.kt': 'fun f(n: Int) {\n    if (n < 0) throw IllegalArgumentException()\n    go()\n}\n' });
  const base = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: dir, encoding: 'utf8' }).trim();
  writeFile(path.join(dir, 'src', 'Shelf.kt'), 'fun f(n: Int) {\n    go()\n}\n');
  const soi = soiThayDoi(dir, ['src/Shelf.kt'], base);
  assert.equal(soi.blockers.length, 0);
  assert.ok(soi.warnings.some((w) => /Shelf\.kt: 1 dong guard bi xoa/.test(w)), soi.warnings.join(' | '));
  const cfg = loadConfig(dir);
  const task = createTask(cfg, sampleTaskArgs());
  const g = gate(cfg, task, { changedFiles: ['src/Shelf.kt'], lintWarnings: soi.warnings });
  assert.ok(g.warnings.some((w) => /guard bi xoa/.test(w)));
  cleanup(dir);
});

test('ACK: canh bao heuristic co khoa; pm_ack (note bat buoc) an no o vong hien tai, vong sau hien lai', async () => {
  const { locCanhBaoDaXem, markRework } = await import('../src/tasks.js');
  const dir = gitRepo({ testCommand: 'echo ok' }, { 'src/Shelf.kt': 'fun f(n: Int) {\n    if (n < 0) throw IllegalArgumentException()\n    go()\n}\n' });
  const base = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: dir, encoding: 'utf8' }).trim();
  writeFile(path.join(dir, 'src', 'Shelf.kt'), 'fun f(n: Int) {\n    go()\n}\n');
  const soi = soiThayDoi(dir, ['src/Shelf.kt'], base);
  assert.equal(soi.warnings[0].key, 'guard-xoa:src/Shelf.kt');
  const created = await call('pm_task_create', { project: dir, title: 'x', brief: 'y', definitionOfDone: ['z'] });
  const taskId = /T\d{4}-[a-z0-9-]+/.exec(created.text)[0];
  const cfg = loadConfig(dir);
  // pm_diff hien canh bao kem khoa.
  let d = await call('pm_diff', { project: dir, taskId });
  assert.ok(d.text.includes('[guard-xoa:src/Shelf.kt]'), d.text);
  // note rong => chan.
  await assert.rejects(call('pm_ack', { project: dir, taskId, keys: ['guard-xoa:src/Shelf.kt'], note: '  ' }), /note rong/);
  const a = await call('pm_ack', { project: dir, taskId, keys: ['guard-xoa:src/Shelf.kt'], note: 'guard chuyen sang lop tren, da doc' });
  assert.ok(a.text.includes('Da danh dau 1'), a.text);
  d = await call('pm_diff', { project: dir, taskId });
  assert.ok(!d.text.includes('NGHI VA BANG SCRIPT') && d.text.includes('1 canh bao da xem'), d.text);
  let task = loadTask(cfg, taskId);
  let g = gate(cfg, task, { changedFiles: ['src/Shelf.kt'], lintWarnings: soi.warnings });
  assert.ok(!g.warnings.some((w) => /guard bi xoa/.test(w)) && g.warnings.some((w) => /1 canh bao da xem/.test(w)), g.warnings.join(' | '));
  assert.equal(locCanhBaoDaXem(task, soi.warnings).daXem.length, 1);
  // Vong moi => code da doi, canh bao hien lai.
  markRework(cfg, task, 'x', ['x']);
  g = gate(cfg, task, { changedFiles: ['src/Shelf.kt'], lintWarnings: soi.warnings });
  assert.ok(g.warnings.some((w) => /guard bi xoa/.test(w)), g.warnings.join(' | '));
  assert.ok(task.history.some((h) => h.event === 'ack_warning'));
  cleanup(dir);
});
