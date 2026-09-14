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
  fileCamDung,
} from './policy.js';
import { createHash } from 'node:crypto';

export const PHASES = ['PLAN', 'IMPLEMENT', 'AUDIT', 'REVIEW', 'TEST', 'PROOF', 'ACCEPTED'];
export const VERDICT_KINDS = ['plan', 'audit', 'review'];
// Loai task: chi 'bugfix' bi doi oracle do -> xanh (khi mustHave.oracle bat).
export const TASK_TYPES = ['bugfix', 'feature', 'refactor', 'docs'];

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
    round: task.round,
    findings: findings.map((f) => String(f)).slice(0, 200),
    notes: String(notes || '').slice(0, 8000),
    reviewer,
    at: nowIso(),
  };
  // Review dat cua vong nay => danh sach finding chua dong coi nhu da xu ly.
  if (kind === 'review' && verdict === 'pass') task.openFindings = [];
  addHistory(task, reviewer, `verdict_${kind}`, `${verdict}${findings.length ? ` (${findings.length} phat hien)` : ''}`);
  return save(cfg, task);
}

/**
 * Dinh nghia DUY NHAT cua "test xanh": exit 0 + khong qua han + bang chung noi test da chay that (evidence.ok).
 * Run khong co evidence (ghi boi ban cu, hoac kind != test) => KHONG xanh.
 */
export function isGreenRun(r) {
  return Boolean(r) && r.exitCode === 0 && !r.timedOut && r.evidence?.ok === true;
}

export function recordRun(cfg, task, rec) {
  task.runs = task.runs || [];
  task.runs.push({
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
    round: task.round,
    at: nowIso(),
  });
  addHistory(task, 'pm', `run_${rec.kind}`, `exit=${rec.exitCode}${rec.evidence && !rec.evidence.ok ? ' CHUA-TINH' : ''} ${rec.command}`);
  return save(cfg, task);
}

/** Bo anh hong khoi ho so vong nay (theo label), xoa file. Tra ve so anh da bo. */
export function discardProofs(cfg, task, label) {
  const round = task.round || 0;
  const keep = [];
  let n = 0;
  for (const p of task.proofs || []) {
    if (p.round === round && p.label === label) {
      n += 1;
      try { fs.rmSync(p.file, { force: true }); } catch { /* file da mat */ }
    } else keep.push(p);
  }
  task.proofs = keep;
  if (n) { addHistory(task, 'pm', 'proof_discarded', `${n} anh "${label}" vong ${round}`); save(cfg, task); }
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
  task.ackWarnings = task.ackWarnings || {};
  const ks = (Array.isArray(keys) ? keys : [keys]).map(String).map((k) => k.trim()).filter(Boolean);
  if (!ks.length) throw new Error('keys rong');
  for (const k of ks) task.ackWarnings[k] = { round: task.round || 0, at: nowIso(), note: String(note).slice(0, 1000) };
  addHistory(task, 'pm', 'ack_warning', `${ks.join(', ')} — ${note}`);
  return save(cfg, task);
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
  task.proofs = task.proofs || [];
  task.proofs.push({
    label: rec.label,
    provider: rec.provider,
    file: rec.file,
    bytes: rec.bytes,
    sha256: rec.sha256 || hashFile(rec.file),
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

export function markRework(cfg, task, feedback, findings = []) {
  if (!feedback || !String(feedback).trim()) throw new Error('feedback rong — rework phai noi ro sai cho nao');
  task.round = (task.round || 0) + 1;
  task.lastReworkAt = nowIso();
  // Finding chua dong: PM va agent cung nhin mot danh sach (T0025 r1: agent sua 1/9 roi bao xong).
  task.openFindings = Array.isArray(findings) && findings.length ? findings.map(String) : [String(feedback)];
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
 * ctx.untrackedFiles: file chua track (de canh bao file rac o goc repo — canh bao, khong chan).
 */
export function gate(cfg, task, ctx = {}) {
  const fresh = freshness(cfg, task);
  const round = task.round || 0;
  const missing = [];
  const warnings = [];

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
  const greenRuns = testsThisRound.filter(isGreenRun);
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
  }

  // DE XUAT 4 (Unity): cham file plan CAM dung => CHAN cung, khong ban.
  const cam = fileCamDung(task, ctx.changedFiles);
  if (cam.length) missing.push(`Dung vao file plan CAM sua: ${cam.join(', ')} — hoan tac phan do (sua tay), khong nghiem thu`);

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
