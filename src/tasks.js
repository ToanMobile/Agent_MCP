// May trang thai cua task + CONG NGHIEM THU.
//
// Vong doi bat buoc:
//   PLAN -> IMPLEMENT -> AUDIT -> REVIEW -> TEST -> PROOF -> ACCEPTED
// Bat ky luc nao PM co the danh REWORK => quay ve IMPLEMENT va HUY het bang chung cu
// (audit/review/test/anh) vi chung thuoc ban code da bi sua.
//
// Nguyen tac quan trong nhat cua file nay: pm_accept KHONG THE lot qua neu thieu bang
// chung. Cong chan nam trong code, khong nam trong loi hua cua ai ca.
import fs from 'node:fs';
import path from 'node:path';
import { ensureDir, writeJsonAtomic, readJsonIfExists, nowIso, slug, exists } from './util.js';
import { checkTestChange, checkProofProvider } from './policy.js';

export const PHASES = ['PLAN', 'IMPLEMENT', 'AUDIT', 'REVIEW', 'TEST', 'PROOF', 'ACCEPTED'];
export const VERDICT_KINDS = ['plan', 'audit', 'review'];

export function phaseIndex(p) {
  return PHASES.indexOf(p);
}

export function taskDir(cfg, id) {
  return path.join(cfg.tasksRoot, id);
}

export function taskFile(cfg, id) {
  return path.join(taskDir(cfg, id), 'task.json');
}

function nextTaskNumber(cfg) {
  if (!exists(cfg.tasksRoot)) return 1;
  let max = 0;
  for (const name of fs.readdirSync(cfg.tasksRoot)) {
    const m = /^T(\d{4})-/.exec(name);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return max + 1;
}

export function createTask(cfg, { title, brief, definitionOfDone = [], model, tags = [] }) {
  if (!title || !String(title).trim()) throw new Error('title rong');
  if (!brief || !String(brief).trim()) throw new Error('brief rong — PM phai noi ro can lam gi');
  if (!Array.isArray(definitionOfDone) || definitionOfDone.length === 0) {
    throw new Error('definitionOfDone rong — khong co dinh nghia HOAN THANH thi khong the nghiem thu');
  }
  const id = `T${String(nextTaskNumber(cfg)).padStart(4, '0')}-${slug(title)}`;
  const dir = ensureDir(taskDir(cfg, id));
  ensureDir(path.join(dir, 'proof'));
  ensureDir(path.join(dir, 'logs'));
  const task = {
    id,
    title: String(title).trim(),
    brief: String(brief).trim(),
    definitionOfDone: definitionOfDone.map((s) => String(s).trim()).filter(Boolean),
    tags,
    project: cfg.projectRoot,
    projectName: cfg.projectName,
    model: model || cfg.defaultModel,
    phase: 'PLAN',
    state: 'awaiting_dispatch',
    conversationId: null,
    round: 0,
    lastReworkAt: null,
    verdicts: {},
    runs: [],
    proofs: [],
    dispatches: [],
    history: [],
    createdAt: nowIso(),
    updatedAt: nowIso(),
    acceptedAt: null,
  };
  fs.writeFileSync(path.join(dir, 'brief.md'), renderBrief(task), 'utf8');
  addHistory(task, 'pm', 'task_created', title);
  save(cfg, task);
  return task;
}

function renderBrief(task) {
  return [
    `# ${task.id} — ${task.title}`,
    '',
    '## Yeu cau (PM giao)',
    task.brief,
    '',
    '## Dinh nghia HOAN THANH (Definition of Done)',
    ...task.definitionOfDone.map((d, i) => `${i + 1}. ${d}`),
    '',
  ].join('\n');
}

export function save(cfg, task) {
  task.updatedAt = nowIso();
  writeJsonAtomic(taskFile(cfg, task.id), task);
  return task;
}

export function loadTask(cfg, id) {
  const t = readJsonIfExists(taskFile(cfg, id));
  if (!t) throw new Error(`Khong thay task "${id}" trong ${cfg.tasksRoot}`);
  return t;
}

export function listTasks(cfg) {
  if (!exists(cfg.tasksRoot)) return [];
  return fs.readdirSync(cfg.tasksRoot)
    .map((id) => readJsonIfExists(taskFile(cfg, id)))
    .filter(Boolean)
    .sort((a, b) => String(a.id).localeCompare(String(b.id)));
}

export function addHistory(task, actor, event, detail = '') {
  task.history = task.history || [];
  task.history.push({ at: nowIso(), actor, event, detail: String(detail).slice(0, 2000) });
  return task;
}

/** Duong dan cac file agent phai ghi theo hop dong. */
export function contractPaths(cfg, task) {
  const dir = taskDir(cfg, task.id);
  return {
    dir,
    plan: path.join(dir, 'plan.md'),
    result: path.join(dir, 'result.json'),
    proofDir: path.join(dir, 'proof'),
    logsDir: path.join(dir, 'logs'),
    report: path.join(dir, 'report.md'),
    brief: path.join(dir, 'brief.md'),
  };
}

function mtimeMs(file) {
  try { return fs.statSync(file).mtimeMs; } catch { return 0; }
}

/**
 * Bang chung cua agent con "tuoi" khong?
 * Moc chan: MUON NHAT trong hai moc — lan giao trien khai va lan rework gan nhat.
 * Vi sao can moc giao trien khai: result.json cua giai doan PLAN khong duoc phep
 * dung lam bang chung da trien khai (neu khong, agent khong lam gi van nghiem thu duoc).
 */
export function freshness(cfg, task) {
  const p = contractPaths(cfg, task);
  const cut = Math.max(
    task.lastReworkAt ? Date.parse(task.lastReworkAt) : 0,
    task.implementDispatchedAt ? Date.parse(task.implementDispatchedAt) : 0,
  );
  const planMs = mtimeMs(p.plan);
  const resultMs = mtimeMs(p.result);
  return {
    planExists: planMs > 0,
    planFresh: planMs > 0,
    resultExists: resultMs > 0,
    // Phai ghi SAU lan rework. So sanh bang Math.floor vi mtime co phan le mili-giay,
    // con moc rework chi luu tron mili-giay => nghieng ve phia "coi la cu" cho an toan.
    resultFresh: resultMs > 0 && Math.floor(resultMs) > cut,
    resultMtime: resultMs ? new Date(resultMs).toISOString() : null,
    cutAt: cut ? new Date(cut).toISOString() : null,
    result: readJsonIfExists(p.result),
    plan: planMs > 0 ? fs.readFileSync(p.plan, 'utf8') : null,
  };
}

export function recordVerdict(cfg, task, { kind, verdict, findings = [], notes = '', reviewer = 'pm' }) {
  if (!VERDICT_KINDS.includes(kind)) throw new Error(`kind phai thuoc ${VERDICT_KINDS.join('|')}`);
  if (!['pass', 'fail'].includes(verdict)) throw new Error('verdict phai la pass hoac fail');
  task.verdicts = task.verdicts || {};
  task.verdicts[kind] = {
    verdict,
    round: kind === 'plan' ? task.round : task.round,
    findings: findings.map((f) => String(f)).slice(0, 200),
    notes: String(notes || '').slice(0, 8000),
    reviewer,
    at: nowIso(),
  };
  addHistory(task, reviewer, `verdict_${kind}`, `${verdict}${findings.length ? ` (${findings.length} phat hien)` : ''}`);
  return save(cfg, task);
}

export function recordRun(cfg, task, rec) {
  task.runs = task.runs || [];
  task.runs.push({
    kind: rec.kind,
    command: rec.command,
    exitCode: rec.exitCode,
    durationMs: rec.durationMs,
    timedOut: Boolean(rec.timedOut),
    logFile: rec.logFile || null,
    round: task.round,
    at: nowIso(),
  });
  addHistory(task, 'pm', `run_${rec.kind}`, `exit=${rec.exitCode} ${rec.command}`);
  return save(cfg, task);
}

export function recordProof(cfg, task, rec) {
  task.proofs = task.proofs || [];
  task.proofs.push({
    label: rec.label,
    provider: rec.provider,
    file: rec.file,
    bytes: rec.bytes,
    width: rec.width || null,
    round: task.round,
    at: nowIso(),
  });
  addHistory(task, 'pm', 'proof_captured', `${rec.provider}: ${rec.label}`);
  return save(cfg, task);
}

/** Ghi nhan 1 lan giao viec / nhac viec cho agent. */
export function recordDispatch(cfg, task, rec) {
  task.dispatches = task.dispatches || [];
  // Moc nay la mot phan cua cong nghiem thu: bang chung phai co SAU khi giao trien khai.
  if (rec.kind === 'implement' || rec.kind === 'rework') task.implementDispatchedAt = nowIso();
  task.dispatches.push({
    kind: rec.kind,
    conversationId: rec.conversationId || task.conversationId,
    model: rec.model || task.model,
    round: task.round,
    promptFile: rec.promptFile || null,
    at: nowIso(),
  });
  addHistory(task, 'pm', `dispatch_${rec.kind}`, rec.conversationId || '');
  return save(cfg, task);
}

export function setPhase(cfg, task, phase, actor = 'pm', detail = '') {
  if (!PHASES.includes(phase)) throw new Error(`phase khong hop le: ${phase}`);
  const from = task.phase;
  task.phase = phase;
  addHistory(task, actor, 'phase', `${from} -> ${phase}${detail ? ` (${detail})` : ''}`);
  return save(cfg, task);
}

export function markRework(cfg, task, feedback) {
  if (!feedback || !String(feedback).trim()) throw new Error('feedback rong — rework phai noi ro sai cho nao');
  task.round = (task.round || 0) + 1;
  task.lastReworkAt = nowIso();
  // Huy bang chung thuoc ban code da bi sua. Giu nguyen lich su de truy nguoc.
  delete task.verdicts?.audit;
  delete task.verdicts?.review;
  task.phase = 'IMPLEMENT';
  task.state = 'awaiting_agent';
  addHistory(task, 'pm', 'rework', String(feedback).slice(0, 4000));
  return save(cfg, task);
}

/**
 * CONG NGHIEM THU. Tra ve { ok, missing[], evidence }.
 * Bang chung phai thuoc vong hien tai (round) — ban xanh cua ban code cu khong tinh.
 *
 * ctx.changedFiles: danh sach file dang thay doi trong cay lam viec (do tools.js do bang git).
 * KHONG truyen = chua do duoc => luat "phai kem file test" bao CHUA XAC MINH, khong coi la dat.
 */
export function gate(cfg, task, ctx = {}) {
  const fresh = freshness(cfg, task);
  const round = task.round || 0;
  const missing = [];

  const planVerdict = task.verdicts?.plan;
  if (!fresh.planExists) missing.push('Thieu plan.md do agent viet (chua qua buoc PLAN)');
  if (!planVerdict || planVerdict.verdict !== 'pass') missing.push('PM chua duyet plan (pm_verdict kind=plan verdict=pass)');

  if (!fresh.resultExists) {
    missing.push('Thieu result.json — agent chua bao cao ket qua theo hop dong');
  } else {
    const rphase = String(fresh.result?.phase || '').toUpperCase();
    if (rphase !== 'IMPLEMENT') {
      // Bao cao cua giai doan PLAN (hoac thieu phase) KHONG phai bang chung da trien khai.
      missing.push(`result.json van la bao cao "${rphase || 'khong ro phase'}" — agent chua trien khai`);
    }
    if (!fresh.resultFresh) {
      missing.push(task.lastReworkAt
        ? 'result.json cu hon lan rework gan nhat — agent chua lam lai'
        : 'result.json duoc ghi TRUOC luc giao trien khai — agent chua lam gi sau khi duyet plan');
    }
  }

  const audit = task.verdicts?.audit;
  if (!audit || audit.verdict !== 'pass' || audit.round !== round) {
    missing.push(`Thieu ket luan AUDIT dat cho vong ${round}`);
  }
  const review = task.verdicts?.review;
  if (!review || review.verdict !== 'pass' || review.round !== round) {
    missing.push(`Thieu ket luan CODE REVIEW dat cho vong ${round}`);
  }

  const testsThisRound = (task.runs || []).filter((r) => r.kind === 'test' && r.round === round);
  const greenTest = testsThisRound.find((r) => r.exitCode === 0 && !r.timedOut);
  if (!greenTest) {
    missing.push(testsThisRound.length
      ? `Test vong ${round} chua co lan nao exit 0 (da chay ${testsThisRound.length} lan)`
      : `Chua chay test nao o vong ${round}`);
  }

  const proofsThisRound = (task.proofs || []).filter((p) => p.round === round && exists(p.file));
  const need = cfg.proof?.require ?? 1;
  if (proofsThisRound.length < need) {
    missing.push(`Thieu anh nghiem thu: can ${need}, dang co ${proofsThisRound.length} (vong ${round})`);
  }

  // LUAT BAT BUOC 1: thay doi phai kem file test.
  const testChange = checkTestChange(cfg, ctx.changedFiles);
  if (testChange.required && !testChange.ok) {
    missing.push(testChange.unknown
      ? 'CHUA XAC MINH duoc co file test nao thay doi (khong doc duoc git cua project)'
      : `Thay doi KHONG kem file test nao (${testChange.changedCount} file thay doi) — test cu xanh khong chung minh duoc phan moi`);
  }

  // LUAT BAT BUOC 2: anh phai chup tu thiet bi that.
  const proofFrom = checkProofProvider(cfg, proofsThisRound);
  if (proofFrom.required && !proofFrom.ok) {
    missing.push(`Anh nghiem thu phai chup tu thiet bi that (${proofFrom.allowed.join(' hoac ')}), `
      + `dang co: ${proofFrom.from.join(', ') || 'khong co anh nao'}`);
  }

  return {
    ok: missing.length === 0,
    missing,
    evidence: {
      round,
      plan: fresh.planExists,
      planVerdict: planVerdict?.verdict || null,
      result: fresh.resultExists ? (fresh.resultFresh ? 'fresh' : 'stale') : null,
      audit: audit?.verdict || null,
      review: review?.verdict || null,
      testRuns: testsThisRound.map((r) => ({ command: r.command, exitCode: r.exitCode })),
      proofs: proofsThisRound.map((p) => ({ label: p.label, file: p.file, provider: p.provider })),
      testFilesChanged: testChange.testFiles,
      proofFromDevice: proofFrom.required ? proofFrom.ok : null,
    },
  };
}

export function accept(cfg, task, ctx = {}) {
  const g = gate(cfg, task, ctx);
  if (!g.ok) {
    const err = new Error(`CHUA DU BANG CHUNG de nghiem thu:\n- ${g.missing.join('\n- ')}`);
    err.gate = g;
    throw err;
  }
  task.phase = 'ACCEPTED';
  task.state = 'accepted';
  task.acceptedAt = nowIso();
  addHistory(task, 'pm', 'accepted', `vong ${task.round}`);
  return save(cfg, task);
}
