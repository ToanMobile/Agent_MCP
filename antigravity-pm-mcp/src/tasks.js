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
import { execFileSync } from 'node:child_process';
import { ensureDir, writeJsonAtomic, readJsonIfExists, nowIso, slug, exists } from './util.js';
import {
  checkTestChange, checkProofProvider, checkOracle, fileRacGocRepo, mustHaveOf, PROOF_KINDS, kiemKhuonResult, doiChieuKhaiTest,
  fileCamDungTheoTask,
} from './policy.js';
import { createHash } from 'node:crypto';
import { gateSnapshot } from './config.js';

export const PHASES = ['PLAN', 'IMPLEMENT', 'AUDIT', 'REVIEW', 'TEST', 'PROOF', 'ACCEPTED'];
export const VERDICT_KINDS = ['plan', 'audit', 'review'];
// Loai task: chi 'bugfix' bi doi oracle do -> xanh (khi mustHave.oracle bat).
export const TASK_TYPES = ['bugfix', 'feature', 'refactor', 'docs'];

export function phaseIndex(p) {
  return PHASES.indexOf(p);
}

// Khuon id do createTask sinh ra (T + 4 so + slug <= 48). Chan '../' truoc moi path.join.
export const TASK_ID_RE = /^T\d{4,}-[a-z0-9-]{1,48}$/;

function checkTaskId(id) {
  if (!TASK_ID_RE.test(String(id ?? ''))) throw new Error(`taskId khong hop le: "${id}" (dang T0001-ten-task)`);
  return id;
}

/** Thu muc file hop dong cua task TRONG repo (brief/plan/result.json/proof/logs) — agent doc/ghi o day. */
export function taskDir(cfg, id) {
  return path.join(cfg.tasksRoot, checkTaskId(id));
}

/** task.json cua PM — NGOAI repo (cfg.pmTasksRoot o HOME), agent khong duoc huong dan cham vao. */
export function taskFile(cfg, id) {
  return path.join(cfg.pmTasksRoot || cfg.tasksRoot, checkTaskId(id), 'task.json');
}

/** Vi tri cu (ban truoc): task.json nam chung thu muc voi result.json cua agent. Chi doc de chuyen nha. */
function legacyTaskFile(cfg, id) {
  return path.join(taskDir(cfg, id), 'task.json');
}

/** Ten thu muc task hop le trong mot goc (bo qua rac / thu muc la). */
function taskIdsIn(root) {
  if (!root || !exists(root)) return [];
  return fs.readdirSync(root).filter((n) => TASK_ID_RE.test(n));
}

/**
 * Chuyen nha task.json tu repo sang HOME DUNG MOT LAN cho moi project, ghi sentinel `migrated.json`.
 * Sau sentinel, ban trong repo KHONG BAO GIO duoc doc lai (agent tao/sua task.json trong repo = vo hieu).
 * Vi sao (re-audit 23/09): ban dau doc ban repo moi khi ban HOME thieu/hong => agent cay task.json gia
 * (verdict pass, phase ACCEPTED) roi xoa/lam hong ban HOME la duoc import lai.
 */
function migrateLegacyOnce(cfg) {
  if (!cfg.pmTasksRoot || cfg.pmTasksRoot === cfg.tasksRoot) return;
  const sentinel = path.join(cfg.pmStateRoot || path.dirname(cfg.pmTasksRoot), 'migrated.json');
  if (exists(sentinel)) return;
  const moved = [];
  for (const id of taskIdsIn(cfg.tasksRoot)) {
    const legacy = legacyTaskFile(cfg, id);
    if (!exists(legacy) || exists(taskFile(cfg, id))) continue;
    const cu = readJsonIfExists(legacy);
    if (!cu || cu.id !== id) continue;
    writeJsonAtomic(taskFile(cfg, id), cu);
    try { fs.renameSync(legacy, `${legacy}.migrated`); } catch { /* read-only repo: sentinel still stops re-reads */ }
    moved.push(id);
  }
  writeJsonAtomic(sentinel, { migratedAt: nowIso(), ids: moved });
}

function allTaskIds(cfg) {
  migrateLegacyOnce(cfg);
  return taskIdsIn(cfg.pmTasksRoot || cfg.tasksRoot);
}

function nextTaskNumber(cfg) {
  let max = 0;
  for (const name of allTaskIds(cfg)) {
    const m = /^T(\d+)-/.exec(name);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return max + 1;
}

export function createTask(cfg, { title, brief, definitionOfDone = [], model, tags = [], type = 'bugfix', proofKind = 'device' }) {
  if (!title || !String(title).trim()) throw new Error('title rong');
  if (!brief || !String(brief).trim()) throw new Error('brief rong — PM phai noi ro can lam gi');
  if (!Array.isArray(definitionOfDone) || definitionOfDone.length === 0) {
    throw new Error('definitionOfDone rong — khong co dinh nghia HOAN THANH thi khong the nghiem thu');
  }
  if (!TASK_TYPES.includes(type)) throw new Error(`type phai thuoc ${TASK_TYPES.join('|')}`);
  if (!PROOF_KINDS.includes(proofKind)) throw new Error(`proofKind phai thuoc ${PROOF_KINDS.join('|')}`);
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
    // Loai task (14/09/2026). Task cu khong co truong nay => luat oracle mien, giong baseCommit.
    type,
    // Loai bang chung anh: device (proofFrom) | browser | script (provider type browser/shell). Task cu = device.
    proofKind,
    // Pham vi file PM khai (pm_plan files=[...]) — dung de phat hien hai task song song chong lan.
    scopeFiles: [],
    // File/thu muc CAM dung (pm_plan forbidden=[...]) — cham vao la cong nghiem thu tu choi.
    forbiddenPaths: [],
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
    // Commit goc luc giao viec: thay doi cua task = cay lam viec + moi commit SAU moc nay.
    // Vi sao (13/09/2026): code + test cua T0008 da vao commit truoc khi accept => `git status`
    // sach => cong "phai kem file test" bao 0 file dù test co that. Do theo commit goc thi khong lot.
    baseCommit: headCommitOf(cfg.projectRoot),
    createdAt: nowIso(),
    // Ban chup cau hinh cong (testCommand, proof, mustHave, stateDir...) — agent sua .antigravity-pm.json sau nay khong co tac dung.
    gateConfig: gateSnapshot(cfg),
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

/**
 * Ghi task.json kem so phien ban `rev` (compare-and-swap): ban tren dia da bi tool khac ghi sau khi nguoi goi
 * nap => TU CHOI thay vi ghi de ca object cu (mat rework / ket luan chen giua). Sua theo phan thay doi: updateTask.
 */
export function save(cfg, task) {
  const file = taskFile(cfg, task.id);
  ensureDir(path.dirname(file));
  // Khoa file (O_EXCL) de doc-so-ghi nguyen tu ca giua HAI tien trinh MCP (hai phien Claude cung repo).
  return withFileLock(`${file}.lock`, () => writeChecked(file, task));
}

function writeChecked(file, task) {
  const disk = readJsonIfExists(file);
  if (disk && (disk.rev || 0) !== (task.rev || 0)) {
    throw new Error(`Task ${task.id} vua bi thao tac khac ghi (rev ${disk.rev || 0} != ${task.rev || 0}) — khong ghi de ban cu. Goi lai lenh.`);
  }
  task.rev = (task.rev || 0) + 1;
  task.updatedAt = nowIso();
  writeJsonAtomic(file, task);
  return task;
}

const SLEEP_CELL = new Int32Array(new SharedArrayBuffer(4));

/** Khoa dong bo bang file tao O_EXCL; khoa bo roi > 30s (tien trinh chet) thi coi la cu va lay lai. */
function withFileLock(lockFile, fn) {
  const deadline = Date.now() + 5000;
  let fd;
  for (;;) {
    try {
      fd = fs.openSync(lockFile, 'wx');
      break;
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      try {
        if (Date.now() - fs.statSync(lockFile).mtimeMs > 30000) { fs.rmSync(lockFile, { force: true }); continue; }
      } catch { continue; }
      if (Date.now() > deadline) throw new Error(`Khong lay duoc khoa ${lockFile} sau 5s — tien trinh khac dang ghi task`);
      Atomics.wait(SLEEP_CELL, 0, 0, 20);
    }
  }
  try {
    return fn();
  } finally {
    fs.closeSync(fd);
    fs.rmSync(lockFile, { force: true });
  }
}

/**
 * Doc task.json: vi tri moi (HOME); chua co thi doc vi tri cu trong repo MOT LAN roi chuyen sang HOME.
 * Da co ban o HOME thi ban trong repo bi bo qua (agent sua no cung khong anh huong).
 */
function readTask(cfg, id) {
  migrateLegacyOnce(cfg);
  const file = taskFile(cfg, id);
  if (!exists(file)) return null;
  let t;
  try {
    t = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    // Hong thi BAO, khong coi la "khong co task" (va tuyet doi khong lay ban khac thay the).
    throw new Error(`task.json cua ${id} bi hong (${file}): ${e.message} — khoi phuc tu ban sao luu hoac tao task moi`);
  }
  if (!t || t.id !== id) throw new Error(`task.json cua ${id} khong khop id (${file})`);
  return t;
}

export function loadTask(cfg, id) {
  const t = readTask(cfg, id);
  if (!t) throw new Error(`Khong thay task "${id}" trong ${cfg.pmTasksRoot || cfg.tasksRoot}`);
  return t;
}

export function listTasks(cfg) {
  return allTaskIds(cfg)
    .map((id) => { try { return readTask(cfg, id); } catch { return null; } })
    .filter(Boolean)
    .sort((a, b) => String(a.id).localeCompare(String(b.id)));
}

/**
 * Sua task AN TOAN khi co tool khac chay xen giua. Ban tren dia cung `rev` voi object nguoi goi => ap `fn` len
 * chinh object do (giu cac truong nguoi goi vua gan). Khac `rev` (co thao tac chen giua, vd pm_rework trong luc
 * pm_run doi test) => ap `fn` (chi phan thay doi) len ban MOI NHAT tren dia roi dong bo nguoc vao object nguoi goi.
 * Doc-sua-ghi la DONG BO (khong co await) nen trong mot tien trinh Node khong gi chen giua duoc — day chinh la
 * doan gang (critical section), khong can mutex async.
 * Vi sao (audit 23/09): pm_run nap task, doi test 3 phut, recordRun ghi de CA object cu => pm_rework chen giua
 * bi xoa (vong lui ve, finding mat, ket luan audit cu song lai). `fn` tra ve false = khong ghi.
 */
export function updateTask(cfg, task, fn) {
  const file = taskFile(cfg, task.id);
  ensureDir(path.dirname(file));
  let cur;
  const skipped = withFileLock(`${file}.lock`, () => {
    const disk = readTask(cfg, task.id);
    cur = disk && (disk.rev || 0) !== (task.rev || 0) ? disk : task;
    if (fn(cur) === false) return true;
    writeChecked(file, cur);
    return false;
  });
  if (skipped) return task;
  if (cur !== task) {
    for (const k of Object.keys(task)) if (!(k in cur)) delete task[k];
    Object.assign(task, cur);
  }
  return task;
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
    // mtime o TUONG LAI (agent `touch -t`) khong duoc tinh la moi.
    resultFresh: resultMs > 0 && Math.floor(resultMs) > cut && resultMs <= Date.now() + 2000,
    resultMtime: resultMs ? new Date(resultMs).toISOString() : null,
    cutAt: cut ? new Date(cut).toISOString() : null,
    result: readJsonIfExists(p.result),
    plan: planMs > 0 ? fs.readFileSync(p.plan, 'utf8') : null,
  };
}

export function recordVerdict(cfg, task, { kind, verdict, findings = [], notes = '', reviewer = 'pm' }) {
  if (!VERDICT_KINDS.includes(kind)) throw new Error(`kind phai thuoc ${VERDICT_KINDS.join('|')}`);
  if (!['pass', 'fail'].includes(verdict)) throw new Error('verdict phai la pass hoac fail');
  // Vong cua ket luan = vong PM DA XEM (ban nguoi goi dang cam), khong phai vong moi hon neu co rework chen giua.
  const round = task.round;
  return updateTask(cfg, task, (t) => {
    t.verdicts = t.verdicts || {};
    t.verdicts[kind] = {
      verdict,
      round,
      findings: findings.map((f) => String(f)).slice(0, 200),
      notes: String(notes || '').slice(0, 8000),
      reviewer,
      at: nowIso(),
    };
    // Review dat cua vong nay => danh sach finding chua dong coi nhu da xu ly.
    if (kind === 'review' && verdict === 'pass' && t.round === round) t.openFindings = [];
    addHistory(t, reviewer, `verdict_${kind}`, `${verdict}${findings.length ? ` (${findings.length} phat hien)` : ''}`);
  });
}

/**
 * Dinh nghia DUY NHAT cua "test xanh": exit 0 + khong qua han + bang chung noi test da chay that (evidence.ok).
 * Run khong co evidence (ghi boi ban cu, hoac kind != test) => KHONG xanh.
 */
export function isGreenRun(r) {
  return Boolean(r) && r.exitCode === 0 && !r.timedOut && r.evidence?.ok === true;
}

/** Lenh test chinh thuc (theo ban chup cau hinh): testCommand + cac stage. */
function lenhTestChinhThuc(cfg) {
  return new Set([cfg.testCommand, ...Object.values(cfg.testStages || {})].filter(Boolean));
}

/**
 * Lan chay xanh co DUOC TINH khong: lenh chinh thuc => co; lenh PM tu go (pm_run command=...) => chi khi co
 * bang chung manh (JUnit XML moi). Vi sao (re-audit 23/09): `command: 'true'` stdout rong => evidence.ok => xanh gia.
 */
function greenRunCounts(cfg, r) {
  return lenhTestChinhThuc(cfg).has(r.command) || r.evidence?.source === 'xml';
}

export function recordRun(cfg, task, rec) {
  // Vong cua lan chay = vong luc BAT DAU chay (rec.round, hoac ban task nguoi goi da nap truoc khi doi test).
  // Rework chen giua thi lan chay nay thuoc vong cu — khong duoc tinh xanh cho vong moi.
  const round = rec.round ?? task.round;
  return updateTask(cfg, task, (t) => {
  t.runs = t.runs || [];
  t.runs.push({
    kind: rec.kind,
    command: rec.command,
    exitCode: rec.exitCode,
    durationMs: rec.durationMs,
    timedOut: Boolean(rec.timedOut),
    // Bang chung test da CHAY THAT (src/evidence.js). Thieu (ghi boi ban cu) = KHONG xanh.
    evidence: rec.evidence || null,
    // kind='oracle': ket qua replay do -> xanh (src/oracle.js).
    oracle: rec.oracle || null,
    // kind='test' voi stage: chi chay mot phan (testStages), skipReason bat buoc — in canh bao o gate/report.
    stage: rec.stage || null,
    skipReason: rec.skipReason || null,
    startedAt: rec.startedAt || null,
    logFile: rec.logFile || null,
    round,
    at: nowIso(),
  });
  addHistory(t, 'pm', `run_${rec.kind}`, `exit=${rec.exitCode}${rec.evidence && !rec.evidence.ok ? ' CHUA-TINH' : ''} ${rec.command}`);
  });
}

/** Bo anh hong khoi ho so vong nay (theo label), xoa file. Tra ve so anh da bo. */
export function discardProofs(cfg, task, label) {
  const round = task.round || 0;
  let n = 0;
  updateTask(cfg, task, (t) => {
    const keep = [];
    for (const p of t.proofs || []) {
      if (p.round === round && p.label === label) {
        n += 1;
        try { fs.rmSync(p.file, { force: true }); } catch { /* file da mat */ }
      } else keep.push(p);
    }
    if (!n) return false;
    t.proofs = keep;
    addHistory(t, 'pm', 'proof_discarded', `${n} anh "${label}" vong ${round}`);
    return true;
  });
  return n;
}

/** Tach canh bao heuristic thanh {hien, daXem} theo task.ackWarnings (chi tinh ack cua VONG hien tai). */
export function locCanhBaoDaXem(task, warnings) {
  const ack = task?.ackWarnings || {};
  const round = task?.round || 0;
  const hien = [];
  const daXem = [];
  for (const w of warnings) {
    const o = typeof w === 'string' ? { key: null, text: w } : w;
    if (o.key && ack[o.key] && ack[o.key].round === round) daXem.push(o); else hien.push(o);
  }
  return { hien, daXem };
}

/** PM danh dau da xem mot canh bao (theo khoa, theo vong, bat buoc co ghi chu vi sao chap nhan). */
export function ackWarning(cfg, task, keys, note) {
  if (!String(note || '').trim()) throw new Error('note rong — ghi vi sao canh bao nay chap nhan duoc (de nguoi sau doc)');
  const ks = (Array.isArray(keys) ? keys : [keys]).map(String).map((k) => k.trim()).filter(Boolean);
  if (!ks.length) throw new Error('keys rong');
  const round = task.round || 0;
  return updateTask(cfg, task, (t) => {
    t.ackWarnings = t.ackWarnings || {};
    for (const k of ks) t.ackWarnings[k] = { round, at: nowIso(), note: String(note).slice(0, 1000) };
    addHistory(t, 'pm', 'ack_warning', `${ks.join(', ')} — ${note}`);
  });
}

/** SHA-256 cua file anh (null neu khong doc duoc) — de phat hien anh trung byte voi task/vong khac. */
export function hashFile(file) {
  try { return createHash('sha256').update(fs.readFileSync(file)).digest('hex'); } catch { return null; }
}

/** Anh cung hash o task/vong KHAC (Unity T0002 va T0005: hai proof cung dung 1.461.725 byte). */
export function anhTrung(cfg, task, sha256) {
  if (!sha256) return [];
  const out = [];
  for (const t of listTasks(cfg)) {
    for (const p of t.proofs || []) {
      if (p.sha256 === sha256 && !(t.id === task.id && p.round === task.round)) out.push(`${t.id} vong ${p.round} "${p.label}"`);
    }
  }
  return out;
}

export function recordProof(cfg, task, rec) {
  // Vong cua anh = vong luc bat dau chup (ban nguoi goi), khong phai vong moi hon neu rework chen giua.
  const round = rec.round ?? task.round;
  return updateTask(cfg, task, (t) => {
  t.proofs = t.proofs || [];
  t.proofs.push({
    label: rec.label,
    provider: rec.provider,
    file: rec.file,
    bytes: rec.bytes,
    sha256: rec.sha256 || hashFile(rec.file),
    width: rec.width || null,
    round,
    at: nowIso(),
  });
  addHistory(t, 'pm', 'proof_captured', `${rec.provider}: ${rec.label}`);
  });
}

/** Ghi nhan 1 lan giao viec / nhac viec cho agent. */
/** rec.set: cac truong gan cung luc (conversationId, state...) — ap tren ban moi nhat, khong ghi de ca object cu. */
export function recordDispatch(cfg, task, rec) {
  const round = task.round;
  return updateTask(cfg, task, (t) => {
    if (rec.set) Object.assign(t, rec.set);
    t.dispatches = t.dispatches || [];
    // Moc nay la mot phan cua cong nghiem thu: bang chung phai co SAU khi giao trien khai.
    if (rec.kind === 'implement' || rec.kind === 'rework') t.implementDispatchedAt = nowIso();
    t.dispatches.push({
      kind: rec.kind,
      conversationId: rec.conversationId || t.conversationId,
      model: rec.model || t.model,
      round,
      promptFile: rec.promptFile || null,
      at: nowIso(),
    });
    addHistory(t, 'pm', `dispatch_${rec.kind}`, rec.conversationId || '');
  });
}

export function setPhase(cfg, task, phase, actor = 'pm', detail = '') {
  if (!PHASES.includes(phase)) throw new Error(`phase khong hop le: ${phase}`);
  return updateTask(cfg, task, (t) => {
    const from = t.phase;
    t.phase = phase;
    addHistory(t, actor, 'phase', `${from} -> ${phase}${detail ? ` (${detail})` : ''}`);
  });
}

export function markRework(cfg, task, feedback, findings = []) {
  if (!feedback || !String(feedback).trim()) throw new Error('feedback rong — rework phai noi ro sai cho nao');
  return updateTask(cfg, task, (t) => {
    t.round = (t.round || 0) + 1;
    t.lastReworkAt = nowIso();
    // Finding chua dong: PM va agent cung nhin mot danh sach (T0025 r1: agent sua 1/9 roi bao xong).
    t.openFindings = Array.isArray(findings) && findings.length ? findings.map(String) : [String(feedback)];
    // Huy bang chung thuoc ban code da bi sua. Giu nguyen lich su de truy nguoc.
    delete t.verdicts?.audit;
    delete t.verdicts?.review;
    t.phase = 'IMPLEMENT';
    t.state = 'awaiting_agent';
    addHistory(t, 'pm', 'rework', String(feedback).slice(0, 4000));
  });
}

/**
 * CONG NGHIEM THU. Tra ve { ok, missing[], evidence }.
 * Bang chung phai thuoc vong hien tai (round) — ban xanh cua ban code cu khong tinh.
 *
 * ctx.changedFiles: danh sach file dang thay doi trong cay lam viec (do tools.js do bang git).
 * KHONG truyen = chua do duoc => luat "phai kem file test" bao CHUA XAC MINH, khong coi la dat.
 * ctx.untrackedFiles: file chua track (de canh bao file rac o goc repo — canh bao, khong chan).
 */
export function gate(cfg, task, ctx = {}) {
  const fresh = freshness(cfg, task);
  const round = task.round || 0;
  const missing = [];
  const warnings = [];

  if (cfg.gateConfigDrift) warnings.push('Cau hinh cong da doi sau khi tao task — gate dung ban chup luc tao task');
  if (!task.implementDispatchedAt) missing.push('Chua giao trien khai (pm_dispatch kind=implement) — khong co moc de xet ket qua cua agent');

  const planVerdict = task.verdicts?.plan;
  if (!fresh.planExists) missing.push('Thieu plan.md — PM chua viet ke hoach (pm_plan)');
  if (!planVerdict || planVerdict.verdict !== 'pass') missing.push('PM chua chot ke hoach — nghe phan bien roi pm_verdict kind=plan verdict=pass');

  if (!fresh.resultExists) {
    missing.push('Thieu result.json — agent chua bao cao ket qua theo hop dong');
  } else {
    const rphase = String(fresh.result?.phase || '').toUpperCase();
    if (rphase !== 'IMPLEMENT') {
      // Bao cao cua giai doan PLAN (hoac thieu phase) KHONG phai bang chung da trien khai.
      missing.push(`result.json van la bao cao "${rphase || 'khong ro phase'}" — agent chua trien khai`);
    } else {
      // Sai khuon (mot dong gop, khong xep chong): agent phai ghi lai dung hop dong.
      const khuon = kiemKhuonResult(fresh.result);
      if (khuon.length) missing.push(`result.json sai khuon: ${khuon.join('; ')} — agent ghi lai theo dung schema`);
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
  // DE XUAT 2: loi khai cua agent nguoc voi XML PM do duoc => KHAI SAI (bat ke lan chay do xanh hay do).
  const lastXml = [...testsThisRound].reverse().find((r) => r.evidence?.source === 'xml');
  const khaiSai = fresh.resultExists ? doiChieuKhaiTest(fresh.result, lastXml?.evidence) : null;
  if (khaiSai) missing.push(khaiSai);
  // exit 0 chua du: phai co bang chung test da chay that (isGreenRun). T0023 r1 (14/09/2026): exit 0 nhung 1 failed.
  const greenAll = testsThisRound.filter(isGreenRun);
  const greenRuns = greenAll.filter((r) => greenRunCounts(cfg, r));
  if (greenAll.length && !greenRuns.length) {
    missing.push(`Test xanh vong ${round} chi chay bang lenh tu chon (${[...new Set(greenAll.map((r) => r.command))].join(' | ')}) khong co JUnit XML — chay lenh test chinh thuc (testCommand) hoac khai testEvidence.resultsGlob`);
  }
  // DE XUAT 5b: test xanh nhung chi chay mot stage (bo cong ngoai co ly do) => qua duoc nhung KHONG im lang.
  for (const r of greenRuns.filter((x) => x.stage)) warnings.push(`Test xanh vong ${round} chi chay stage "${r.stage}" (ly do bo phan con lai: ${r.skipReason})`);
  if (greenRuns.length === 0) {
    const exit0 = testsThisRound.filter((r) => r.exitCode === 0 && !r.timedOut);
    if (exit0.length) {
      const last = exit0[exit0.length - 1];
      missing.push(last.evidence
        ? `Test vong ${round} exit 0 nhung CHUA TINH la xanh: ${last.evidence.reason} — chay lai cho test that su chay (Gradle: --rerun-tasks), khong nuot exit code`
        : `Test vong ${round} exit 0 nhung khong co bang chung da chay (ghi boi ban cu) — chay lai pm_run kind=test`);
    } else {
      missing.push(testsThisRound.length
        ? `Test vong ${round} chua co lan nao exit 0 (da chay ${testsThisRound.length} lan)`
        : `Chua chay test nao o vong ${round}`);
    }
  } else if ('lastChangeAt' in ctx) {
    // THU TU THOI GIAN: test xanh phai bat dau SAU khi agent bao cao (mtime result.json) va ket thuc SAU lan
    // sua file cuoi (so voi luc KET THUC vi chinh lenh test co the ghi file: ktlintFormat, Roborazzi record).
    // ctx.lastChangeAt = null nghia la khong do duoc => CHUA XAC MINH, chan. Khong co khoa = khong xet (goi truc tiep).
    const resultMs = fresh.resultMtime ? Date.parse(fresh.resultMtime) : 0;
    const lastChangeMs = typeof ctx.lastChangeAt === 'number' ? ctx.lastChangeAt : null;
    if (lastChangeMs === null) {
      missing.push('CHUA XAC MINH duoc thoi diem sua file cuoi (khong doc duoc git/mtime) — khong biet test xanh co chay tren code moi nhat khong');
    } else {
      const dungThuTu = greenRuns.some((r) => {
        const started = r.startedAt ? Date.parse(r.startedAt) : 0;
        const ended = r.at ? Date.parse(r.at) : 0;
        return started >= Math.floor(resultMs) && ended >= Math.floor(lastChangeMs);
      });
      if (!dungThuTu) {
        missing.push(`Test xanh vong ${round} chay TRUOC khi agent bao cao / sua file lan cuoi — chay lai pm_run kind=test tren code moi nhat`);
      }
    }
  }

  const proofsThisRound = (task.proofs || []).filter((p) => p.round === round && exists(p.file));
  const need = cfg.proof?.require ?? 1;
  if (proofsThisRound.length < need) {
    missing.push(`Thieu anh nghiem thu: can ${need}, dang co ${proofsThisRound.length} (vong ${round})`);
  }

  // LUAT BAT BUOC 1: thay doi phai kem file test — va file test do phai la cua AGENT (nam trong
  // files_changed no khai), khong phai cua phien khac dang dung chung cay lam viec.
  const claimed = fresh.resultExists && Array.isArray(fresh.result?.files_changed) ? fresh.result.files_changed : undefined;
  const testChange = checkTestChange(cfg, ctx.changedFiles, claimed);
  if (testChange.required && !testChange.ok) {
    if (testChange.unknown) missing.push('CHUA XAC MINH duoc co file test nao thay doi (khong doc duoc git cua project)');
    else if (testChange.noClaim) missing.push(`Agent khong khai files_changed trong result.json (${testChange.changedCount} file dang thay doi) — khong dem ho file test nao`);
    else if (testChange.unclaimedTestFiles?.length) missing.push(`File test thay doi nhung agent KHONG khai trong files_changed: ${testChange.unclaimedTestFiles.join(', ')} — cua phien khac hay agent khai thieu?`);
    else missing.push(`Thay doi KHONG kem file test nao (${testChange.changedCount} file thay doi) — test cu xanh khong chung minh duoc phan moi`);
  }

  // LUAT BAT BUOC 2: anh phai chup tu thiet bi that.
  const proofFrom = checkProofProvider(cfg, proofsThisRound, task);
  if (proofFrom.required && !proofFrom.ok) {
    missing.push(proofFrom.kind && proofFrom.kind !== 'device'
      ? `Task proofKind=${proofFrom.kind}: anh phai do PM chup bang lenh (${proofFrom.allowed.join(' hoac ')}), khong nhan anh agent dua; dang co: ${proofFrom.from.join(', ') || 'khong co anh nao'}`
      : `Anh nghiem thu phai chup tu thiet bi that (${proofFrom.allowed.join(' hoac ')}), `
      + `dang co: ${proofFrom.from.join(', ') || 'khong co anh nao'}`);
  }

  // LUAT BAT BUOC 3 (opt-in mustHave.oracle): task sua loi phai co oracle do -> xanh, PM tu replay trong vong nay.
  const oracleRuns = (task.runs || []).filter((r) => r.kind === 'oracle' && r.round === round);
  const oracle = checkOracle(cfg, task, fresh.result, oracleRuns);
  if (oracle.required && !oracle.ok) {
    missing.push(`Thieu oracle do -> xanh: ${oracle.reason}`);
  } else if (oracle.required && oracleRuns.some((r) => r.oracle?.ok) && oracleRuns.filter((r) => r.oracle?.ok).every((r) => r.oracle?.red?.weak)) {
    warnings.push('Oracle dat nhung RED chi la "weak" (exit != 0, khong co JUnit XML) — khong phan biet duoc test do voi loi build; khai testEvidence.resultsGlob de chac');
  }

  // DE XUAT 4 (Unity): cham file plan CAM dung => CHAN cung, khong ban.
  // 19/09: chi CHAN file quy duoc cho task nay (files_changed / scopeFiles); file cam cua phien khac => canh bao.
  const cam = fileCamDungTheoTask(task, ctx.changedFiles, claimed);
  if (cam.chan.length) missing.push(`Dung vao file plan CAM sua: ${cam.chan.join(', ')} — hoan tac phan do (sua tay), khong nghiem thu`);
  if (cam.canhBao.length) warnings.push(`File CAM dang thay doi trong cay nhung task KHONG khai (phien khac / auto-commit?): ${cam.canhBao.slice(0, 20).join(', ')}${cam.canhBao.length > 20 ? ` … (+${cam.canhBao.length - 20})` : ''} — PM doi chieu pm_diff`);

  // DE XUAT 1c: dinh nghia SQL trung (create table x2) => CHAN; tang dong / khoi lap => canh bao.
  for (const b of ctx.lintBlockers || []) missing.push(`Nhan doi noi dung: ${b}`);
  // Canh bao heuristic co KHOA: PM da xem (pm_ack, cung vong) thi an, chi dem. Chuoi tran (khong khoa) giu nguyen.
  const { hien, daXem } = locCanhBaoDaXem(task, ctx.lintWarnings || []);
  for (const w of hien) warnings.push(`PM soi tan mat — ${w.text} [${w.key}]`);
  if (daXem.length) warnings.push(`${daXem.length} canh bao da xem (pm_ack): ${daXem.map((w) => w.key).join(', ')}`);

  // File rac agent de lai o goc repo: mac dinh CHAN (mustHave.strayFiles='block'), 'warn' thi chi canh bao.
  const rac = fileRacGocRepo(ctx.untrackedFiles, cfg);
  if (rac.length) {
    const msg = `File rac o goc repo (agent va bang script roi bo lai?): ${rac.join(', ')} — xoa truoc khi nghiem thu`;
    if (mustHaveOf(cfg).strayFiles === 'block') missing.push(msg); else warnings.push(msg);
  }

  return {
    ok: missing.length === 0,
    missing,
    warnings,
    evidence: {
      round,
      plan: fresh.planExists,
      planVerdict: planVerdict?.verdict || null,
      result: fresh.resultExists ? (fresh.resultFresh ? 'fresh' : 'stale') : null,
      audit: audit?.verdict || null,
      review: review?.verdict || null,
      testRuns: testsThisRound.map((r) => ({ command: r.command, exitCode: r.exitCode, green: isGreenRun(r), evidence: r.evidence?.reason || null })),
      proofs: proofsThisRound.map((p) => ({ label: p.label, file: p.file, provider: p.provider })),
      testFilesChanged: testChange.testFiles,
      proofFromDevice: proofFrom.required ? proofFrom.ok : null,
      oracle: oracle.required ? oracle.ok : null,
      strayFiles: rac,
    },
  };
}

export function accept(cfg, task, ctx = {}) {
  // Xet cong tren ban MOI NHAT tren dia (rework chen giua luc do git thi phai tu choi, khong nghiem thu ban cu).
  return updateTask(cfg, task, (t) => {
    const g = gate(cfg, t, ctx);
    if (!g.ok) {
      const err = new Error(`CHUA DU BANG CHUNG de nghiem thu:\n- ${g.missing.join('\n- ')}`);
      err.gate = g;
      throw err;
    }
    t.phase = 'ACCEPTED';
    t.state = 'accepted';
    t.acceptedAt = nowIso();
    addHistory(t, 'pm', 'accepted', `vong ${t.round}`);
  });
}

/** SHA HEAD cua repo (null neu khong phai git repo) — dong bo, chi goi luc tao task. */
export function headCommitOf(projectRoot) {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: projectRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() || null;
  } catch {
    return null;
  }
}

/**
 * Hop nhat danh sach file thay doi: cay lam viec + da commit ke tu commit goc. Thuan, de test.
 * `wt` = undefined nghia la chua do duoc git => tra undefined (cong chan bao CHUA XAC MINH).
 */
export function hopNhatFileThayDoi(wt, committed) {
  if (!Array.isArray(wt)) return undefined;
  const out = [];
  const seen = new Set();
  for (const f of [...wt, ...(Array.isArray(committed) ? committed : [])]) {
    const k = String(f).trim();
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(k);
  }
  return out;
}
