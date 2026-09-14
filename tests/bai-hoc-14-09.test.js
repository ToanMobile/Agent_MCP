// Bai hoc dieu phoi Antigravity dem 13-14/09/2026 (Geely EX2) + ban giao OfficeReader 14/09.
// Moi test khoa MOT lo hong da do duoc; cac ca "BI CHAN" la phan quan trong nhat.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { loadConfig } from '../src/config.js';
import {
  createTask, recordVerdict, recordRun, recordProof, recordDispatch, gate, accept, contractPaths, loadTask, isGreenRun,
} from '../src/tasks.js';
import {
  checkOracle, fileRacGocRepo, cungFile, kiemChongLan, phamViTask, dangChay, checkTestChange, mustHaveOf,
} from '../src/policy.js';
import { detectNoop, detectSwallowedFailure, collectTestEvidence } from '../src/evidence.js';
import {
  buildImplementMessage, buildReworkMessage, buildNudgeMessage, planTemplate, kiemTraKeHoach,
} from '../src/prompt.js';
import { TOOLS_BY_NAME } from '../src/tools.js';
import { tmpProject, cleanup, writeFile, sampleTaskArgs, PNG_1PX } from './helpers.js';

const KHAI_DU = ['src/Kinh.kt', 'src/test/java/KinhTest.kt'];
const CTX_DU = { changedFiles: KHAI_DU };
const EV_OK = { source: 'stdout', weak: true, noop: false, ok: true, reason: 'test' };

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
  writeFile(path.join(dir, '.gitignore'), '.antigravity-pm/\n');
  execFileSync('git', ['add', '-A'], { cwd: dir });
  execFileSync('git', ['commit', '-qm', 'init'], { cwd: dir });
  return dir;
}

/** Task da du moi bang chung TRU thu dang test. */
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

// ---------------------------------------------------------------- #1 #2 #9: prompt

test('#1 cam git pha cay VO DIEU KIEN — ke ca commitPolicy=allow', () => {
  const dir = tmpProject({ commitPolicy: 'allow' });
  const cfg = loadConfig(dir);
  const task = createTask(cfg, sampleTaskArgs());
  writeFile(contractPaths(cfg, task).plan, '# Ke hoach\n1. x');
  for (const p of [buildImplementMessage(cfg, task), buildReworkMessage(cfg, task, { findings: ['x'] })]) {
    for (const cmd of ['git restore', 'git stash', 'git clean', 'git checkout <file>', 'git reset --hard']) {
      assert.ok(p.includes(cmd), `prompt phai cam "${cmd}" ngay ca khi allow commit`);
    }
    assert.match(p, /SUA TAY/i, 'phai chi cach hoan tac dung: sua tay');
    assert.ok(!p.includes('KHONG chay `git commit`'), 'allow thi khong cam commit');
  }
  const cfgF = loadConfig(tmpProject({ commitPolicy: 'forbid' }));
  const taskF = createTask(cfgF, sampleTaskArgs());
  writeFile(contractPaths(cfgF, taskF).plan, '# x\n1. y');
  assert.ok(buildImplementMessage(cfgF, taskF).includes('KHONG chay `git commit`'));
  cleanup(dir);
});

test('#2 loi bien dich o file KHONG thuoc task => blocked, khong sua, khong checkout', () => {
  const dir = tmpProject({});
  const cfg = loadConfig(dir);
  const task = createTask(cfg, sampleTaskArgs());
  writeFile(contractPaths(cfg, task).plan, '# x\n1. y');
  const p = buildImplementMessage(cfg, task);
  assert.match(p, /KHONG thuoc task nay/);
  assert.match(p, /KHONG git checkout\/restore/);
  cleanup(dir);
});

test('#9 task qua lon: lam buoc nho truoc, khong tu choi; mau ke hoach co "Thu tu buoc"; ke hoach khong danh so thi nhac', () => {
  const dir = tmpProject({});
  const cfg = loadConfig(dir);
  const task = createTask(cfg, sampleTaskArgs());
  writeFile(contractPaths(cfg, task).plan, '# x\n1. y');
  assert.match(buildImplementMessage(cfg, task), /KHONG tu choi ca task/);
  assert.match(buildNudgeMessage(cfg, task, 30), /buoc nho nhat/);
  assert.match(planTemplate(task), /Thu tu buoc \(NHO -> LON/);
  assert.ok(kiemTraKeHoach('# Ke hoach\nlam A roi lam B').some((w) => /danh so/.test(w)));
  assert.equal(kiemTraKeHoach('# Ke hoach\n1. lam A\n2. them test').length, 0);
  cleanup(dir);
});

// ---------------------------------------------------------------- #5: test xanh gia

test('#5 exit 0 KHONG co bang chung (run ghi boi ban cu) => BI CHAN, nhac chay lai pm_run', () => {
  const { dir, cfg, task } = taskXanh();
  task.runs = task.runs.map((r) => ({ ...r, evidence: undefined }));
  const g = gate(cfg, task, CTX_DU);
  assert.equal(g.ok, false);
  assert.ok(g.missing.some((m) => /khong co bang chung da chay/.test(m)), g.missing.join(' | '));
  assert.throws(() => accept(cfg, task, CTX_DU), /CHUA DU BANG CHUNG/);
  cleanup(dir);
});

test('#5 exit 0 nhung bang chung noi "chua chay" => BI CHAN; isGreenRun la dinh nghia duy nhat', () => {
  const { dir, cfg, task } = taskXanh();
  task.runs[0].evidence = { ...EV_OK, ok: false, reason: 'khong test nao chay (gradle-test-task-up-to-date)' };
  const g = gate(cfg, task, CTX_DU);
  assert.equal(g.ok, false);
  assert.ok(g.missing.some((m) => /CHUA TINH la xanh/.test(m) && /up-to-date/.test(m)), g.missing.join(' | '));
  assert.equal(isGreenRun({ exitCode: 0, timedOut: false, evidence: EV_OK }), true);
  assert.equal(isGreenRun({ exitCode: 0, timedOut: false }), false);
  assert.equal(isGreenRun({ exitCode: 0, timedOut: true, evidence: EV_OK }), false);
  assert.equal(isGreenRun({ exitCode: 1, timedOut: false, evidence: EV_OK }), false);
  assert.equal(isGreenRun({ exitCode: 0, timedOut: false, evidence: { ...EV_OK, ok: false } }), false);
  cleanup(dir);
});

test('#5 mau do tren log that: task TEST up-to-date bat, task compile up-to-date KHONG bat; BUILD FAILED/"1 failed" voi exit 0 = nuot exit', () => {
  assert.equal(detectNoop('> Task :app:compileDebugUnitTestKotlin UP-TO-DATE\n> Task :app:testDebugUnitTest\nBUILD SUCCESSFUL\n5 actionable tasks: 2 executed, 3 up-to-date').noop, false);
  assert.equal(detectNoop('> Task :app:compileDebugUnitTestKotlin UP-TO-DATE\n> Task :app:testDebugUnitTest UP-TO-DATE\n5 actionable tasks: 1 executed, 4 up-to-date').rule, 'gradle-test-task-up-to-date');
  assert.equal(detectNoop('> Task :app:testSystemDebugUnitTest UP-TO-DATE').noop, true);
  // T0023 r1 (14/09/2026): `| tail -15` nuot exit => exit=0 nhung test do.
  const t0023 = '30845 tests completed, 1 failed\n\nFAILURE: Build failed with an exception.\nBUILD FAILED in 2m 58s\nJUNIT tests=30845 failures=1 errors=0';
  assert.equal(detectSwallowedFailure(t0023).swallowed, true);
  assert.equal(detectSwallowedFailure('30845 tests completed, 0 failed\nBUILD SUCCESSFUL\nJUNIT tests=30845 failures=0 errors=0').swallowed, false);
  const ev = collectTestEvidence({ projectRoot: os.tmpdir() }, { startedMs: Date.now(), stdout: t0023, stderr: '' });
  assert.equal(ev.ok, false);
  assert.match(ev.reason, /nuot/);
  // Mau them cua project.
  const ev2 = collectTestEvidence({ projectRoot: os.tmpdir(), mustHave: { testSuspectPatterns: ['SKIPPED-ALL'] } },
    { startedMs: Date.now(), stdout: 'ok\nSKIPPED-ALL\n', stderr: '' });
  assert.equal(ev2.ok, false);
});

test('#5 tang tool: pm_run kind=test in "CHUA TINH" va gate chan khi lenh nuot exit code', async () => {
  const dir = gitRepo({ testCommand: 'echo "12 tests completed, 1 failed"; echo "BUILD FAILED in 3s"; true' });
  const created = await call('pm_task_create', { project: dir, title: 'x', brief: 'y', definitionOfDone: ['z'] });
  const taskId = /T\d{4}-[a-z0-9-]+/.exec(created.text)[0];
  const out = await call('pm_run', { project: dir, taskId, kind: 'test' });
  assert.ok(out.text.includes('exit=0'), out.text);
  assert.ok(out.text.includes('CHUA TINH'), `phai noi ro exit 0 khong duoc tinh:\n${out.text}`);
  assert.ok(out.text.includes('nuot exit code'), out.text);
  const task = loadTask(loadConfig(dir), taskId);
  assert.equal(task.runs[0].evidence.ok, false);
  assert.equal(task.runs[0].evidence.swallowedRule, 'gradle-build-failed');
  assert.ok(task.runs[0].startedAt);
  assert.ok(out.text.includes('CHUA DAT'));
  cleanup(dir);
});

// ---------------------------------------------------------------- #4: oracle

test('#4 mustHave.oracle: task bugfix khong co oracle => BI CHAN; co du before/after => qua; type=feature => mien', () => {
  const co = { mustHave: { oracle: true } };
  const t1 = taskXanh(co, { type: 'bugfix' });
  assert.equal(gate(t1.cfg, t1.task, CTX_DU).ok, false);
  assert.ok(gate(t1.cfg, t1.task, CTX_DU).missing.some((m) => /oracle/.test(m)));
  assert.throws(() => accept(t1.cfg, t1.task, CTX_DU), /CHUA DU BANG CHUNG/);
  cleanup(t1.dir);

  const t2 = taskXanh(co, { type: 'bugfix' }, { oracle: { command: './gradlew test --tests X', before: '', after: 'xanh' } });
  assert.ok(gate(t2.cfg, t2.task, CTX_DU).missing.some((m) => /before rong/.test(m)), 'before rong phai bi bat');
  cleanup(t2.dir);

  // Agent khai du before/after nhung PM CHUA replay => van BI CHAN (loi khai khong phai bang chung).
  const t3 = taskXanh(co, { type: 'bugfix' }, { oracle: { command: './gradlew test --tests X', before: '1 failed', after: '0 failed' } });
  let g3 = gate(t3.cfg, t3.task, CTX_DU);
  assert.equal(g3.ok, false);
  assert.ok(g3.missing.some((m) => /PM chua tu replay/.test(m)), g3.missing.join(' | '));
  // Replay khong dat (RED khong hop le) => van chan, noi ly do.
  recordRun(t3.cfg, t3.task, { kind: 'oracle', command: 'x', exitCode: 1, durationMs: 1, oracle: { ok: false, red: { valid: false, reason: 'test XANH tren code goc' } } });
  g3 = gate(t3.cfg, t3.task, CTX_DU);
  assert.ok(g3.missing.some((m) => /replay chua dat.*XANH tren code goc/.test(m)), g3.missing.join(' | '));
  // Replay dat => qua.
  recordRun(t3.cfg, t3.task, { kind: 'oracle', command: 'x', exitCode: 0, durationMs: 1, oracle: { ok: true } });
  g3 = gate(t3.cfg, t3.task, CTX_DU);
  assert.equal(g3.ok, true, g3.missing.join(' | '));
  cleanup(t3.dir);

  // type=feature nhung agent TU KHAI oracle.command => khai thi phai dung, van doi replay.
  const t5 = taskXanh(co, { type: 'feature' }, { oracle: { command: 'npm test', before: 'do', after: 'xanh' } });
  assert.equal(gate(t5.cfg, t5.task, CTX_DU).ok, false);
  cleanup(t5.dir);

  const t4 = taskXanh(co, { type: 'feature' });
  assert.equal(gate(t4.cfg, t4.task, CTX_DU).ok, true);
  cleanup(t4.dir);
});

test('#4 task CU (khong co truong type, tao truoc luat) duoc mien oracle — khong chan hoi to task dang chay', () => {
  const { dir, cfg, task } = taskXanh({ mustHave: { oracle: true } });
  delete task.type;
  assert.equal(gate(cfg, task, CTX_DU).ok, true);
  assert.equal(checkOracle(cfg, task, {}).exempt, 'task cu chua co truong type');
  // Mac dinh (khong bat) thi khong doi gi.
  const t2 = taskXanh({}, { type: 'bugfix' });
  assert.equal(gate(t2.cfg, t2.task, CTX_DU).ok, true);
  cleanup(dir); cleanup(t2.dir);
});

test('#4 pm_task_create type sai thi bi chan; mac dinh la bugfix', async () => {
  const dir = tmpProject({});
  await assert.rejects(call('pm_task_create', { project: dir, title: 'x', brief: 'y', definitionOfDone: ['z'], type: 'hotfix' }), /type/);
  const created = await call('pm_task_create', { project: dir, title: 'x', brief: 'y', definitionOfDone: ['z'] });
  assert.ok(created.text.includes('type=bugfix'));
  assert.ok(created.text.includes('plan-template.md'));
  cleanup(dir);
});

// ---------------------------------------------------------------- #6: file rac + khop duong dan

test('#6/DX1 file rac o goc repo: mac dinh BI CHAN (de xuat PM GeelyEx2), strayFiles=warn thi chi canh bao; chi xet goc', () => {
  const rac = fileRacGocRepo(['fix_telemetry.py', 'modify_html.py', 'update_html_ota.py', 'scripts/fix_x.py', 'a_patch.kt', 'notes.md', 'x.bak', 'patch_sql.sh', 'test_debug.sh'], null);
  assert.deepEqual(rac, ['fix_telemetry.py', 'modify_html.py', 'update_html_ota.py', 'a_patch.kt', 'x.bak', 'patch_sql.sh', 'test_debug.sh']);
  const { dir, cfg, task } = taskXanh();
  const g = gate(cfg, task, { ...CTX_DU, untrackedFiles: ['fix_telemetry.py'] });
  assert.equal(g.ok, false, 'mac dinh file rac phai CHAN');
  assert.ok(g.missing.some((m) => /fix_telemetry\.py/.test(m)), g.missing.join(' | '));
  assert.throws(() => accept(cfg, task, { ...CTX_DU, untrackedFiles: ['fix_telemetry.py'] }), /CHUA DU BANG CHUNG/);
  assert.deepEqual(g.evidence.strayFiles, ['fix_telemetry.py']);
  cleanup(dir);
  const w = taskXanh({ mustHave: { strayFiles: 'warn' } });
  const gw = gate(w.cfg, w.task, { ...CTX_DU, untrackedFiles: ['fix_telemetry.py'] });
  assert.equal(gw.ok, true, gw.missing.join(' | '));
  assert.ok(gw.warnings.some((x) => /fix_telemetry\.py/.test(x)));
  cleanup(w.dir);
});

test('DX3a pm_capture_proof: sourceFile THANG defaultProvider (T0024: tool tung chay adb vao xe du da truyen anh)', async () => {
  const { captureProof } = await import('../src/proof.js');
  const dir = tmpProject({ proof: { defaultProvider: 'xe', providers: { xe: { type: 'adb', serial: 'khong-ton-tai:5555' } } } });
  const cfg = loadConfig(dir);
  const src = writeFile(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'agpm-src-')), 'a.png'), PNG_1PX);
  const shot = await captureProof(cfg, { proofDir: path.join(dir, 'proof'), label: 'anh', sourceFile: src });
  assert.equal(shot.provider, 'file');
  // Truyen ro provider thi provider do van thang (khong doi hanh vi cu).
  await assert.rejects(captureProof(cfg, { proofDir: path.join(dir, 'proof'), label: 'anh', sourceFile: src, providerName: 'xe' }), /adb|that bai|exit/i);
  cleanup(dir);
});

test('DX3b proofKind=browser: anh agent dua (file) KHONG duoc tinh, anh tu provider browser/shell moi duoc; task cu = device', () => {
  const co = { mustHave: { proofFrom: ['xe'] }, proof: { providers: { xe: { type: 'adb' }, web: { type: 'browser' }, cmd: { type: 'shell', command: 'x' } } } };
  const t = taskXanh(co, { proofKind: 'browser' });
  t.task.proofs = [];
  const p = contractPaths(t.cfg, t.task);
  const img = writeFile(path.join(p.proofDir, 'f.png'), PNG_1PX);
  recordProof(t.cfg, t.task, { label: 'agent dua', provider: 'file', file: img, bytes: 1 });
  let g = gate(t.cfg, t.task, CTX_DU);
  assert.equal(g.ok, false);
  assert.ok(g.missing.some((m) => /proofKind=browser/.test(m) && /khong nhan anh agent dua/.test(m)), g.missing.join(' | '));
  const img2 = writeFile(path.join(p.proofDir, 'w.png'), PNG_1PX);
  recordProof(t.cfg, t.task, { label: 'headless', provider: 'web', file: img2, bytes: 1 });
  g = gate(t.cfg, t.task, CTX_DU);
  assert.equal(g.ok, true, g.missing.join(' | '));
  cleanup(t.dir);
  // Task cu khong co proofKind: van doi proofFrom nhu cu.
  const t2 = taskXanh(co);
  delete t2.task.proofKind;
  t2.task.proofs = [];
  const img3 = writeFile(path.join(contractPaths(t2.cfg, t2.task).proofDir, 'w.png'), PNG_1PX);
  recordProof(t2.cfg, t2.task, { label: 'headless', provider: 'web', file: img3, bytes: 1 });
  assert.equal(gate(t2.cfg, t2.task, CTX_DU).ok, false, 'task device khong nhan anh browser khi proofFrom=[xe]');
  cleanup(t2.dir);
});

test('DX3c pm_capture_proof discardLabel bo anh hong khoi ho so vong nay va xoa file', async () => {
  const { discardProofs } = await import('../src/tasks.js');
  const { dir, cfg, task, p } = taskXanh();
  const bad = writeFile(path.join(p.proofDir, 'bad.png'), PNG_1PX);
  recordProof(cfg, task, { label: 'chrome chan file://', provider: 'adb', file: bad, bytes: 1 });
  assert.equal(task.proofs.length, 2);
  assert.equal(discardProofs(cfg, task, 'chrome chan file://'), 1);
  assert.equal(task.proofs.length, 1);
  assert.equal(fs.existsSync(bad), false);
  assert.ok(task.history.some((h) => h.event === 'proof_discarded'));
  // Tang tool: chi discard, khong label => khong chup, in cong.
  const out = await call('pm_capture_proof', { project: dir, taskId: task.id, discardLabel: 'anh' });
  assert.ok(out.text.includes('Da bo 1 anh'), out.text);
  cleanup(dir);
});

test('DX-phu pm_message nhan ca "message" lan "content"; rong thi bao ro', async () => {
  const dir = tmpProject({});
  const created = await call('pm_task_create', { project: dir, title: 'x', brief: 'y', definitionOfDone: ['z'] });
  const taskId = /T\d{4}-[a-z0-9-]+/.exec(created.text)[0];
  await assert.rejects(call('pm_message', { project: dir, taskId }), /content.*message/);
  // Co noi dung nhung task chua co hoi thoai => loi o buoc hoi thoai (da qua buoc doc noi dung).
  await assert.rejects(call('pm_message', { project: dir, taskId, message: 'hi' }), /chua co hoi thoai/);
  cleanup(dir);
});

test('#6 cungFile: "a.kt" KHONG khop "Data.kt"; khop theo duoi "/x"', () => {
  assert.equal(cungFile('a.kt', 'Data.kt'), false);
  assert.equal(cungFile('src/a.kt', 'a.kt'), true);
  assert.equal(cungFile('./src/a.kt', 'src/a.kt'), true);
  assert.equal(cungFile('src/a.kt', 'b/src/a.kt'), true);
  assert.equal(cungFile('xsrc/a.kt', 'src/a.kt'), false);
});

test('#6 tang tool: pm_diff to file rac o goc va khong bao nham "khai ma khong sua" do includes', async () => {
  const dir = gitRepo({});
  const created = await call('pm_task_create', { project: dir, title: 'x', brief: 'y', definitionOfDone: ['z'] });
  const taskId = /T\d{4}-[a-z0-9-]+/.exec(created.text)[0];
  const cfg = loadConfig(dir);
  const p = contractPaths(cfg, loadTask(cfg, taskId));
  writeFile(path.join(dir, 'fix_telemetry.py'), '# tam\n');
  writeFile(path.join(dir, 'src', 'Data.kt'), '// doi\n');
  writeFile(p.result, JSON.stringify({ phase: 'IMPLEMENT', files_changed: ['a.kt'] }));
  const out = await call('pm_diff', { project: dir, taskId });
  assert.ok(out.text.includes('file rac o goc repo') && out.text.includes('fix_telemetry.py'), out.text);
  assert.ok(/khai co sua nhung khong thay thay doi: a\.kt/.test(out.text), `a.kt khong duoc coi la Data.kt:\n${out.text}`);
  cleanup(dir);
});

// ---------------------------------------------------------------- #3 #7: giao song song

test('#3 kiemChongLan: chong file => canh bao; cung thu muc doc quyen => exclusive', () => {
  const cfg = { mustHave: { exclusiveDirs: ['shared/'] } };
  const r = kiemChongLan(cfg, { id: 'T2', files: ['shared/RelayProtocol.kt', 'app/A.kt'] }, [
    { id: 'T1', files: ['shared/CarProtocol.kt'] },
    { id: 'T3', files: ['app/A.kt'] },
  ]);
  assert.deepEqual(r.overlaps, [{ taskId: 'T3', files: ['app/A.kt'] }]);
  assert.deepEqual(r.exclusive, [{ taskId: 'T1', dir: 'shared' }]);
  assert.deepEqual(kiemChongLan({}, { id: 'T2', files: ['shared/x'] }, [{ id: 'T1', files: ['shared/y'] }]).exclusive, []);
  assert.deepEqual(phamViTask({ scopeFiles: ['a'] }, { files_changed: ['./b'], files_to_change: ['a'] }), ['a', 'b']);
  assert.equal(dangChay({ phase: 'IMPLEMENT' }), true);
  assert.equal(dangChay({ phase: 'ACCEPTED' }), false);
  assert.equal(dangChay({ phase: 'PLAN' }), false);
});

test('#3 tang tool: dispatch implement BI CHAN khi task khac dang chay cung dung shared/; force=true moi qua (den buoc goi agent)', async () => {
  const dir = gitRepo({ mustHave: { exclusiveDirs: ['shared/'] } });
  const mk = async (title) => /T\d{4}-[a-z0-9-]+/.exec((await call('pm_task_create', { project: dir, title, brief: 'y', definitionOfDone: ['z'] })).text)[0];
  const t1 = await mk('mot');
  const t2 = await mk('hai');
  const cfg = loadConfig(dir);
  // T1 dang IMPLEMENT, agent khai dang sua shared/.
  const task1 = loadTask(cfg, t1);
  task1.phase = 'IMPLEMENT';
  fs.writeFileSync(path.join(contractPaths(cfg, task1).dir, 'task.json'), JSON.stringify(task1));
  writeFile(contractPaths(cfg, task1).result, JSON.stringify({ phase: 'IMPLEMENT', files_changed: ['shared/CarProtocol.kt'] }));
  // T2: plan chot, pham vi cung shared/.
  const plan = await call('pm_plan', { project: dir, taskId: t2, content: '# x\n1. sua shared\n2. test', files: ['shared/RelayProtocol.kt'] });
  assert.ok(plan.text.includes('THU MUC DOC QUYEN "shared"'), plan.text);
  writeFile(path.join(contractPaths(cfg, loadTask(cfg, t2)).dir, 'plan-review.json'), JSON.stringify({ verdict: 'ok', findings: [] }));
  await call('pm_verdict', { project: dir, taskId: t2, kind: 'plan', verdict: 'pass' });
  await assert.rejects(call('pm_dispatch', { project: dir, taskId: t2, kind: 'implement' }), /KHONG giao song song[\s\S]*shared/);
  // force: qua duoc cong chong lan, that bai o buoc goi agentapi (khong co Antigravity trong test) — khong phai loi cua cong.
  await assert.rejects(call('pm_dispatch', { project: dir, taskId: t2, kind: 'implement', force: true }), (e) => !/KHONG giao song song/.test(e.message));
  cleanup(dir);
});

// ---------------------------------------------------------------- #8: nudge

test('#8 pm_status nudge khi task chua co hoi thoai thi noi ro, khong no; tin nhac khong doi round', async () => {
  const dir = tmpProject({});
  const created = await call('pm_task_create', { project: dir, title: 'x', brief: 'y', definitionOfDone: ['z'] });
  const taskId = /T\d{4}-[a-z0-9-]+/.exec(created.text)[0];
  const out = await call('pm_status', { project: dir, taskId, nudge: true });
  assert.ok(out.text.includes('Khong nhac duoc'), out.text);
  const cfg = loadConfig(dir);
  const task = loadTask(cfg, taskId);
  const msg = buildNudgeMessage(cfg, task, 45);
  assert.match(msg, /im 45 phut/);
  assert.match(msg, /result\.json/);
  assert.match(msg, /KHONG git checkout\/restore/);
  cleanup(dir);
});

// ---------------------------------------------------------------- ban giao OfficeReader: file test phai la cua agent + thu tu thoi gian

test('BG4 file test thay doi nhung agent KHONG khai trong files_changed => BI CHAN (cua phien khac?)', () => {
  const { dir, cfg, task } = taskXanh({}, {}, { files_changed: ['src/Kinh.kt'] });
  const g = gate(cfg, task, CTX_DU);
  assert.equal(g.ok, false);
  assert.ok(g.missing.some((m) => /KHONG khai trong files_changed/.test(m)), g.missing.join(' | '));
  cleanup(dir);
});

test('BG4 agent khai files_changed RONG ma cay co thay doi => BI CHAN, khong dem ho', () => {
  const { dir, cfg, task } = taskXanh({}, {}, { files_changed: [] });
  const g = gate(cfg, task, CTX_DU);
  assert.equal(g.ok, false);
  assert.ok(g.missing.some((m) => /khong khai files_changed/.test(m)), g.missing.join(' | '));
  const r = checkTestChange({ mustHave: {} }, ['src/test/ATest.kt'], []);
  assert.equal(r.noClaim, true);
  cleanup(dir);
});

test('BG2 test xanh chay TRUOC khi agent bao cao / sua file cuoi => BI CHAN; khong do duoc mtime => CHUA XAC MINH', () => {
  const { dir, cfg, task } = taskXanh();
  // Run bat dau truoc result.json (result mtime = +2s trong taskXanh).
  task.runs[0].startedAt = new Date(Date.now() - 10000).toISOString();
  let g = gate(cfg, task, { ...CTX_DU, lastChangeAt: 0 });
  assert.equal(g.ok, false);
  assert.ok(g.missing.some((m) => /chay TRUOC khi agent bao cao/.test(m)), g.missing.join(' | '));
  // Run dung thu tu nhung file sua SAU khi test ket thuc.
  task.runs[0].startedAt = new Date(Date.now() + 3000).toISOString();
  task.runs[0].at = new Date(Date.now() + 3001).toISOString();
  g = gate(cfg, task, { ...CTX_DU, lastChangeAt: Date.now() + 9000 });
  assert.equal(g.ok, false);
  g = gate(cfg, task, { ...CTX_DU, lastChangeAt: Date.now() });
  assert.equal(g.ok, true, g.missing.join(' | '));
  g = gate(cfg, task, { ...CTX_DU, lastChangeAt: null });
  assert.ok(g.missing.some((m) => /CHUA XAC MINH duoc thoi diem/.test(m)));
  // Goi truc tiep khong co khoa lastChangeAt (unit test) => khong xet.
  assert.equal(gate(cfg, task, CTX_DU).ok, true);
  cleanup(dir);
});

test('cau hinh: cac khoa mustHave moi doc dung va co mac dinh an toan', () => {
  const m = mustHaveOf({ mustHave: { oracle: true, exclusiveDirs: ['./shared/', 'core'], testSuspectPatterns: ['x('] } });
  assert.equal(m.oracle, true);
  assert.deepEqual(m.exclusiveDirs, ['shared', 'core']);
  assert.equal(mustHaveOf({}).oracle, false);
  assert.deepEqual(mustHaveOf({}).exclusiveDirs, []);
  const cfg = loadConfig(tmpProject({}));
  assert.deepEqual(cfg.testEvidence.resultsGlob, []);
  assert.equal(cfg.mustHave.oracle, false);
});

// ---------------------------------------------------------------- BG3: PM tu replay oracle trong git worktree

import { replayOracle, danhGiaRed } from '../src/oracle.js';

/**
 * Repo gia: run-test.sh
 *   - thieu tests/a.test.sh  => exit 2, KHONG ghi XML (do vi ly do khac)
 *   - co test, thieu fix.txt => exit 1 + XML failures=1 (RED hop le)
 *   - co test, co fix.txt    => exit 0 + XML failures=0 (GREEN)
 */
function repoOracle() {
  const dir = gitRepo({ testEvidence: { resultsGlob: ['**/build/test-results/**/TEST-*.xml'] }, mustHave: { oracle: true } });
  writeFile(path.join(dir, 'run-test.sh'), `#!/bin/sh
mkdir -p build/test-results
[ -f tests/a.test.sh ] || { echo "no test file"; exit 2; }
if [ -f fix.txt ]; then
  printf '<testsuite name="a" tests="1" failures="0" errors="0"><testcase name="t" classname="a"/></testsuite>' > build/test-results/TEST-a.xml
  echo "1 test ok"; exit 0
else
  printf '<testsuite name="a" tests="1" failures="1" errors="0"><testcase name="t" classname="a"><failure message="x">y</failure></testcase></testsuite>' > build/test-results/TEST-a.xml
  echo "1 test failed"; exit 1
fi
`);
  execFileSync('git', ['add', '-A'], { cwd: dir });
  execFileSync('git', ['commit', '-qm', 'them runner'], { cwd: dir });
  return dir;
}

function worktreeCount(dir) {
  return execFileSync('git', ['worktree', 'list'], { cwd: dir, encoding: 'utf8' }).trim().split('\n').length;
}

test('BG3 replay: RED hop le tren code goc + GREEN tren cay that => ORACLE DAT; worktree duoc don', async () => {
  const dir = repoOracle();
  const cfg = loadConfig(dir);
  const base = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: dir, encoding: 'utf8' }).trim();
  // "Agent" sua: them fix.txt + file test.
  writeFile(path.join(dir, 'fix.txt'), 'fixed');
  writeFile(path.join(dir, 'tests', 'a.test.sh'), '# test');
  const o = await replayOracle(cfg, { baseCommit: base, command: 'sh run-test.sh', changedFiles: ['fix.txt', 'tests/a.test.sh'], timeoutMs: 30000 });
  assert.equal(o.blocked, null, o.blocked);
  assert.deepEqual(o.testFilesCopied, ['tests/a.test.sh']);
  assert.equal(o.red.valid, true, o.red.reason);
  assert.equal(o.red.evidence.failures, 1);
  assert.equal(o.green.ok, true, o.green.reason);
  assert.equal(o.ok, true);
  assert.equal(worktreeCount(dir), 1, 'worktree tam phai duoc go');
  cleanup(dir);
});

test('BG3 replay: test XANH tren code goc (khong rang) => RED khong hop le, KHONG chay GREEN, oracle khong dat', async () => {
  const dir = repoOracle();
  const cfg = loadConfig(dir);
  // fix.txt da co tu commit goc => test luc nao cung xanh.
  writeFile(path.join(dir, 'fix.txt'), 'da co tu truoc');
  execFileSync('git', ['add', '-A'], { cwd: dir });
  execFileSync('git', ['commit', '-qm', 'fix da co'], { cwd: dir });
  const base = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: dir, encoding: 'utf8' }).trim();
  writeFile(path.join(dir, 'tests', 'a.test.sh'), '# test');
  const o = await replayOracle(cfg, { baseCommit: base, command: 'sh run-test.sh', changedFiles: ['tests/a.test.sh'], timeoutMs: 30000 });
  assert.equal(o.red.valid, false);
  assert.match(o.red.reason, /khong co rang/);
  assert.equal(o.green, null);
  assert.equal(o.ok, false);
  assert.equal(worktreeCount(dir), 1);
  cleanup(dir);
});

test('BG3 replay: do vi ly do khac (khong XML) => RED khong hop le; thieu baseCommit / lenh / file test => BLOCKED', async () => {
  const dir = repoOracle();
  const cfg = loadConfig(dir);
  const base = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: dir, encoding: 'utf8' }).trim();
  // Agent doi mot file KHONG phai test => khong co gi de chep => BLOCKED.
  const b1 = await replayOracle(cfg, { baseCommit: base, command: 'sh run-test.sh', changedFiles: ['fix.txt'], timeoutMs: 30000 });
  assert.match(b1.blocked, /khong co file test nao/);
  assert.equal(worktreeCount(dir), 1);
  // Khong co baseCommit / khong co lenh.
  assert.match((await replayOracle(cfg, { baseCommit: null, command: 'x', changedFiles: [] })).blocked, /baseCommit/);
  assert.match((await replayOracle(cfg, { baseCommit: base, command: '', changedFiles: [] })).blocked, /khong co lenh oracle/);
  // Do vi ly do khac: file test co ten khac, runner thieu tests/a.test.sh => exit 2, khong XML.
  writeFile(path.join(dir, 'tests', 'khac.test.sh'), '# test khac');
  const o = await replayOracle(cfg, { baseCommit: base, command: 'sh run-test.sh', changedFiles: ['tests/khac.test.sh'], timeoutMs: 30000 });
  assert.equal(o.red.valid, false);
  assert.match(o.red.reason, /do vi ly do khac/);
  assert.equal(o.ok, false);
  // danhGiaRed khong XML: exit != 0 la weak.
  const w = danhGiaRed({ code: 1, timedOut: false }, { source: 'stdout', noop: false, swallowed: false });
  assert.equal(w.valid, true);
  assert.equal(w.weak, true);
  cleanup(dir);
});

test('BG3 tang tool: pm_run kind=oracle ghi run record + log, cong nghiem thu doc duoc', async () => {
  const dir = repoOracle();
  const created = await call('pm_task_create', { project: dir, title: 'sua loi', brief: 'y', definitionOfDone: ['z'], type: 'bugfix' });
  const taskId = /T\d{4}-[a-z0-9-]+/.exec(created.text)[0];
  const cfg = loadConfig(dir);
  const p = contractPaths(cfg, loadTask(cfg, taskId));
  writeFile(path.join(dir, 'fix.txt'), 'fixed');
  writeFile(path.join(dir, 'tests', 'a.test.sh'), '# test');
  writeFile(p.result, JSON.stringify({ phase: 'IMPLEMENT', files_changed: ['fix.txt', 'tests/a.test.sh'], oracle: { command: 'sh run-test.sh', before: '1 failed', after: 'ok' } }));
  const out = await call('pm_run', { project: dir, taskId, kind: 'oracle' });
  assert.ok(out.text.includes('ORACLE DAT'), out.text);
  assert.ok(out.text.includes('tests/a.test.sh'));
  const task = loadTask(cfg, taskId);
  const run = task.runs.find((r) => r.kind === 'oracle');
  assert.equal(run.oracle.ok, true);
  assert.equal(run.exitCode, 0);
  assert.ok(fs.existsSync(run.logFile));
  assert.ok(fs.readFileSync(run.logFile, 'utf8').includes('=== RED'));
  assert.ok(!out.text.includes('Thieu oracle'), `cong khong con doi oracle:\n${out.text}`);
  assert.equal(worktreeCount(dir), 1);
  cleanup(dir);
});
