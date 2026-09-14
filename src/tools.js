// Bo tool MCP: Claude Code (Leader/PM) dieu phoi Antigravity (Engineer) theo dung quy trinh.
import fs from 'node:fs';
import path from 'node:path';
import { loadConfig, existingRulesFiles, CONFIG_NAME } from './config.js';
import {
  createTask, loadTask, listTasks, save, setPhase, recordVerdict, recordRun, recordProof,
  recordDispatch, markRework, accept, gate, freshness, contractPaths, addHistory, PHASES, TASK_TYPES, hopNhatFileThayDoi,
  discardProofs, anhTrung, hashFile } from './tasks.js';
import {
  newConversation, sendMessage, getConversationMetadata, conversationProgress, transcriptErrors, MODELS,
} from './agentapi.js';
import { discover, agentapiPath } from './discover.js';
import { requireProjectId, resolveProject } from './projects.js';
import {
  buildPlanCritiquePrompt, buildImplementMessage, buildReworkMessage, buildAuditPrompt,
  buildProofRequestMessage, buildNudgeMessage, planTemplate, kiemTraKeHoach, buildPlanReviewFixMessage,
} from './prompt.js';
import { captureProof, describeProviders } from './proof.js';
import { renderReport } from './report.js';
import * as policyNs from './policy.js';
import {
  mustHaveOf, fileRacGocRepo, cungFile, phamViTask, dangChay, kiemChongLan, PROOF_KINDS, kiemKhuonPlanReview,
} from './policy.js';
import { collectTestEvidence, evidenceLine } from './evidence.js';
import { replayOracle, oracleLine, chepVaoWorktree } from './oracle.js';
import { soiThayDoi } from './lint-diff.js';
import { kiemBaoCao, dongTomTat } from './cite-check.js';
import { createHash } from 'node:crypto';
import { runShell, writeFileAtomic, ensureDir, exists, tail, truncate, nowIso, readJsonIfExists } from './util.js';

// ---------------------------------------------------------------- kiem tra tham so

function fail(msg) {
  const e = new Error(msg);
  e.userFacing = true;
  throw e;
}

function validate(schema, args) {
  const out = {};
  const props = schema.properties || {};
  for (const req of schema.required || []) {
    if (args?.[req] === undefined || args?.[req] === null || args?.[req] === '') fail(`Thieu tham so bat buoc: "${req}"`);
  }
  for (const [k, v] of Object.entries(args || {})) {
    const p = props[k];
    if (!p) continue; // bo qua tham so la
    if (p.type === 'string' && typeof v !== 'string') fail(`"${k}" phai la chuoi`);
    if (p.type === 'number' && typeof v !== 'number') fail(`"${k}" phai la so`);
    if (p.type === 'boolean' && typeof v !== 'boolean') fail(`"${k}" phai la true/false`);
    if (p.type === 'array' && !Array.isArray(v)) fail(`"${k}" phai la danh sach`);
    if (p.enum && !p.enum.includes(v)) fail(`"${k}" phai thuoc: ${p.enum.join(' | ')}`);
    out[k] = v;
  }
  return out;
}

// Mo ta tool + schema duoc gui vao context CUA BEN DUNG MCP o MOI PHIEN => viet ngan nhat
// co the ma van du nghia. Chi tiet dai de trong docs/tools-reference.md.
const PROJECT_PROP = {
  project: { type: 'string', description: 'Goc project (mac dinh: cwd)' },
};
const TASK_PROP = { taskId: { type: 'string', description: 'Ma task (T0001-...)' } };

// ---------------------------------------------------------------- tro giup

function ctx(args) {
  const cfg = loadConfig(args?.project);
  return cfg;
}

function withTask(args) {
  const cfg = ctx(args);
  const task = loadTask(cfg, args.taskId);
  return { cfg, task };
}

/**
 * Danh sach file thay doi cua TASK: cay lam viec (da track + chua track) HOP voi moi file trong
 * cac commit ke tu commit goc cua task (task.baseCommit; task cu chua co thi lay commit cuoi
 * TRUOC luc tao task theo createdAt). Khong co task => chi cay lam viec nhu cu.
 * Tra ve undefined khi khong doc duoc git => cong chan se bao CHUA XAC MINH thay vi coi la dat.
 */
async function changedFilesOf(cfg, task) {
  const snap = await gitSnapshot(cfg);
  if (!snap.ok) return undefined;
  const base = await baseCommitOf(cfg, task);
  if (!base) return hopNhatFileThayDoi(snap.wt, []);
  const d = await runShell(`git --no-pager diff --name-only ${base}..HEAD`, { cwd: cfg.projectRoot, timeoutMs: 60000 });
  const committed = d.code === 0 ? d.stdout.split('\n').map((l) => l.trim()).filter(Boolean) : [];
  return hopNhatFileThayDoi(snap.wt, committed);
}

/** Anh chup `git status`: wt = moi file thay doi, untracked = file chua track. ok=false khi khong doc duoc git. */
async function gitSnapshot(cfg) {
  // --untracked-files=all: khong gop thu muc moi thanh "src/test/" — phai thay tung file de doi chieu voi files_changed.
  const r = await runShell('git status --porcelain=v1 --untracked-files=all', { cwd: cfg.projectRoot, timeoutMs: 60000 });
  if (r.code !== 0) return { ok: false, wt: undefined, untracked: [], raw: r.stdout || '' };
  // Thu muc trang thai cua chinh tool (task.json tu ghi moi lan record) khong phai thay doi cua agent.
  const stateDir = `${String(cfg.stateDir || '.antigravity-pm').replace(/^\.\//, '').replace(/\/+$/, '')}/`;
  const lines = r.stdout.split('\n').filter((l) => l.trim());
  const clean = (l) => l.slice(3).trim().replace(/^"|"$/g, '');
  const cuaAgent = (f) => f && !f.startsWith(stateDir);
  const wt = lines
    .map(clean)
    .filter(Boolean)
    .map((l) => (l.includes(' -> ') ? l.split(' -> ')[1] : l))
    .filter(cuaAgent);
  const untracked = lines.filter((l) => l.startsWith('??')).map(clean).filter(cuaAgent);
  return { ok: true, wt, untracked, raw: r.stdout };
}

/** Commit goc cua task: task.baseCommit, hoac (task cu) commit cuoi cung truoc createdAt. */
async function baseCommitOf(cfg, task) {
  if (!task) return null;
  if (task.baseCommit) return task.baseCommit;
  if (!task.createdAt) return null;
  const r = await runShell(`git rev-list -1 --before="${task.createdAt}" HEAD`, { cwd: cfg.projectRoot, timeoutMs: 60000 });
  return r.code === 0 ? (r.stdout.trim() || null) : null;
}

/** Cong chan kem bang chung do duoc tu git ngay luc goi. */
async function gateNow(cfg, task) {
  return gate(cfg, task, await gateCtx(cfg, task));
}

/** Bang chung do tu git + mtime cho gate(): file thay doi, file chua track, thoi diem sua file cuoi (null = khong do duoc). */
async function gateCtx(cfg, task) {
  const snap = await gitSnapshot(cfg);
  const changedFiles = await changedFilesOf(cfg, task);
  const soi = snap.ok ? soiThayDoi(cfg.projectRoot, snap.wt, await baseCommitOf(cfg, task)) : { warnings: [], blockers: [] };
  // Thu tu thoi gian chi do tren FILE CUA TASK (agent khai files_changed ∪ file test trong cay) — chu du an chot 14/09/2026:
  // cay GeelyEx2 co phien khac sua song song, do ca cay thi moi lan ho sua gi la phai chay lai test 3 phut.
  return {
    changedFiles,
    untrackedFiles: snap.untracked,
    lastChangeAt: snap.ok ? lastChangeAtOf(cfg, fileCuaTask(cfg, task, snap.wt)) : null,
    lintBlockers: soi.blockers,
    lintWarnings: soi.warnings,
  };
}

function hashOf(buf) {
  return createHash('sha256').update(buf).digest('hex');
}

/** Diff ke hoach v(n-1) -> v(n) + finding cua ban phan bien truoc (focus=delta). null neu chua co ban truoc. */
async function deltaKeHoach(cfg, task) {
  const p = contractPaths(cfg, task);
  const v = task.planVersion || 1;
  const prev = path.join(p.logsDir, `plan-v${v - 1}.md`);
  if (v < 2 || !fs.existsSync(prev)) return null;
  const d = await runShell(`git --no-pager diff --no-index --unified=3 -- ${JSON.stringify(prev)} ${JSON.stringify(p.plan)}`, { cwd: cfg.projectRoot, timeoutMs: 60000, maxBytes: 200000 });
  const prevReview = readJsonIfExists(path.join(p.logsDir, `plan-review-v${v - 1}.json`));
  const previousFindings = Array.isArray(prevReview?.findings)
    ? prevReview.findings.map((f) => `[${f.severity || '?'}] ${f.buoc ? `${f.buoc}: ` : ''}${f.problem || JSON.stringify(f)}`).slice(0, 40)
    : [];
  return { fromVersion: v - 1, toVersion: v, diff: truncate(d.stdout || '', 8000), previousFindings };
}

/** Dong trang thai phan bien ke hoach: treo / sai khuon (tu nhac 1 lan) / san sang. */
async function tinhTrangPhanBien(cfg, task) {
  const L = [];
  const p = contractPaths(cfg, task);
  const critique = path.join(p.dir, 'plan-review.json');
  if (!task.planReviewDispatchedAt || task.verdicts?.plan?.verdict === 'pass') return L;
  if (!fs.existsSync(critique)) {
    const phut = Math.round((Date.now() - Date.parse(task.planReviewDispatchedAt)) / 60000);
    if (phut >= (cfg.stallMinutes || 12)) L.push(`plan-review.json: REVIEW TREO — giao phan bien ${phut} phut chua co file (T0024 tung im >30 phut). pm_status nudge=true de nhac, hoac dispatch lai.`);
    else L.push(`plan-review.json: chua co (giao ${phut} phut truoc)`);
    return L;
  }
  const review = readJsonIfExists(critique);
  const loi = kiemKhuonPlanReview(review);
  if (loi.length) {
    L.push(`plan-review.json: SAI KHUON (${loi.join('; ')})`);
    // Tu nhac agent ghi lai — DUNG MOT LAN cho moi plan_hash, khong spam moi lan pm_status.
    const key = task.planHashSent || 'x';
    if (task.planReviewNudge?.hash !== key && task.planReviewConversationId) {
      // pm_status la tool doc — Antigravity dong thi chi bao, khong duoc no.
      try {
        const msg = buildPlanReviewFixMessage(cfg, task, loi, task.planHashSent);
        await sendMessage({ conversationId: task.planReviewConversationId, projectId: projectIdFor(cfg), content: msg });
        task.planReviewNudge = { hash: key, at: nowIso() };
        addHistory(task, 'pm', 'plan_review_fix_nudge', loi.join('; '));
        save(cfg, task);
        L.push('  -> da tu nhac agent ghi lai dung khuon (1 lan). Goi lai pm_status sau vai phut.');
      } catch (e) {
        L.push(`  -> khong nhac duoc agent (${String(e.message || e).split('\n')[0].slice(0, 120)}) — Antigravity dang dong? Nhac tay bang pm_message toAudit hoac dispatch lai.`);
      }
    }
    return L;
  }
  const khop = !task.planHashSent || review.plan_hash === task.planHashSent;
  L.push(`plan-review.json: co · verdict=${review.verdict} · ${review.findings.length} finding${khop ? '' : ` · PLAN_HASH KHONG KHOP (${String(review.plan_hash || '').slice(0, 12)} vs ${task.planHashSent.slice(0, 12)}) — phan bien ban cu`}`);
  const kq = kiemBaoCao(cfg.projectRoot, review);
  L.push(`  trich dan: ${dongTomTat(kq)}${kq.bia.length ? ` — BIA: ${kq.bia.slice(0, 5).map((b) => `${b.file}:${b.line}`).join(', ')}` : ''}`);
  return L;
}

/** Worktree dong bang = HEAD + diff cay lam viec + file moi (tru thu muc trang thai va file rac). */
async function dongBangCay(cfg) {
  const os = await import('node:os');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agpm-run-'));
  const add = await runShell(`git worktree add --detach ${JSON.stringify(dir)} HEAD`, { cwd: cfg.projectRoot, timeoutMs: 120000 });
  if (add.code !== 0) return { error: (add.stderr || add.stdout).trim().slice(0, 400) };
  const snap = await gitSnapshot(cfg);
  let applied = 0;
  const d = await runShell('git --no-pager diff HEAD --binary', { cwd: cfg.projectRoot, timeoutMs: 120000, maxBytes: 50_000_000 });
  if (d.stdout.trim()) {
    const patch = path.join(dir, '.agpm-wt.patch');
    fs.writeFileSync(patch, d.stdout);
    const ap = await runShell(`git apply --index ${JSON.stringify(patch)}`, { cwd: dir, timeoutMs: 120000 });
    fs.rmSync(patch, { force: true });
    if (ap.code !== 0) { await goWorktree(cfg, dir); return { error: `git apply that bai: ${(ap.stderr || ap.stdout).trim().slice(0, 400)}` }; }
    applied = d.stdout.split('\n').filter((l) => l.startsWith('diff --git')).length;
  }
  let untracked = 0;
  const rac = new Set(fileRacGocRepo(snap.untracked, cfg));
  for (const f of snap.untracked) {
    if (rac.has(f)) continue;
    const src = path.resolve(cfg.projectRoot, f);
    if (!fs.existsSync(src) || !fs.statSync(src).isFile()) continue;
    const to = path.resolve(dir, f);
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(src, to);
    untracked += 1;
  }
  for (const f of cfg.oracle?.copyToWorktree || []) chepVaoWorktree(cfg.projectRoot, dir, f);
  return { dir, applied, untracked };
}

async function goWorktree(cfg, dir) {
  await runShell(`git worktree remove --force ${JSON.stringify(dir)}`, { cwd: cfg.projectRoot, timeoutMs: 60000 });
  await runShell('git worktree prune', { cwd: cfg.projectRoot, timeoutMs: 60000 });
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* da don */ }
}

/** File trong cay lam viec thuoc ve task: agent khai trong files_changed, hoac la file test (luat "kem file test" dem chung). */
function fileCuaTask(cfg, task, wt) {
  const claimed = freshness(cfg, task).result?.files_changed;
  const must = mustHaveOf(cfg);
  const { matchesAny } = policyNs;
  return (wt || []).filter((f) => (Array.isArray(claimed) && claimed.some((c) => cungFile(f, c))) || matchesAny(f, must.testFilePatterns));
}

/** mtime lon nhat cua cac file dang thay doi trong cay lam viec (ms). Khong file nao => 0 (cay sach, test luc nao cung sau). */
function lastChangeAtOf(cfg, files) {
  let max = 0;
  for (const f of files || []) {
    try {
      const st = fs.statSync(path.resolve(cfg.projectRoot, f));
      if (st.mtimeMs > max) max = st.mtimeMs;
    } catch { /* file da xoa: khong co mtime, bo qua */ }
  }
  return max;
}

function gateLines(g) {
  const head = g.ok
    ? 'CONG NGHIEM THU: DAT (du bang chung).'
    : `CONG NGHIEM THU: CHUA DAT. Con thieu:\n- ${g.missing.join('\n- ')}`;
  const warn = (g.warnings || []).length ? `\nCANH BAO:\n- ${g.warnings.join('\n- ')}` : '';
  return head + warn;
}

/**
 * Task khac dang chay tren cung cay ma + pham vi file cua chung (PM khai + agent khai).
 * Vi sao (13/09/2026): T0009 va T0011 giao song song cung dung shared/, T0009 git checkout file cua T0011.
 */
function cacTaskDangChayKhac(cfg, task) {
  return listTasks(cfg)
    .filter((t) => t.id !== task.id && dangChay(t))
    .map((t) => ({ id: t.id, title: t.title, phase: t.phase, files: phamViTask(t, freshness(cfg, t).result) }));
}

/** Dong canh bao truoc khi giao trien khai: chong lan task khac + cay chua commit. Tra ve { lines, blocked }. */
async function canhBaoTruocKhiGiao(cfg, task, force) {
  const lines = [];
  let blocked = null;
  const others = cacTaskDangChayKhac(cfg, task);
  const mine = phamViTask(task, freshness(cfg, task).result);
  if (others.length) {
    lines.push(`Task khac dang chay tren cung cay ma: ${others.map((o) => `${o.id} (${o.phase}${o.files.length ? `, ${o.files.length} file` : ', chua ro pham vi'})`).join('; ')}`);
    const { overlaps, exclusive } = kiemChongLan(cfg, { id: task.id, files: mine }, others);
    for (const o of overlaps) lines.push(`CHONG LAN voi ${o.taskId}: ${o.files.slice(0, 10).join(', ')} — hai agent sua cung file se de len nhau`);
    if (exclusive.length) {
      const msg = exclusive.map((e) => `${e.taskId} cung dung thu muc doc quyen "${e.dir}"`).join('; ');
      if (force) lines.push(`CANH BAO (force): ${msg}`);
      else blocked = `KHONG giao song song: ${msg}. Cho task kia xong (cay bien dich duoc) roi giao, hoac force=true neu chac chan.`;
    }
    if (!mine.length) lines.push('Task nay chua khai pham vi file (pm_plan files=[...]) nen khong do duoc chong lan chinh xac.');
  }
  const snap = await gitSnapshot(cfg);
  if (snap.ok && snap.wt.length && cfg.commitPolicy === 'forbid') {
    lines.push(`Cay ma dang co ${snap.wt.length} file chua commit va commitPolicy=forbid => KHONG co moc de quay ve neu agent lam mat. `
      + 'Nen tao nhanh WIP + commit moc cuu ho truoc khi giao (bai hoc 12/09/2026).');
  }
  const rac = snap.ok ? fileRacGocRepo(snap.untracked, cfg) : [];
  if (rac.length) lines.push(`File rac o goc repo: ${rac.join(', ')}`);
  return { lines, blocked };
}

function taskLine(t) {
  const flag = t.phase === 'ACCEPTED' ? 'OK ' : '   ';
  return `${flag}${t.id} · ${t.phase}${t.round ? ` (vong ${t.round})` : ''} · ${t.title}`;
}

async function ensureWorkspaceMatches(cfg, conversationId) {
  const md = await getConversationMetadata(conversationId);
  const want = fs.realpathSync(cfg.projectRoot);
  const got = md.workspace ? (exists(md.workspace) ? fs.realpathSync(md.workspace) : md.workspace) : null;
  const ok = got === want;
  return { ok, md, want, got };
}

/** Project id de gui kem moi loi goi; khong giai ra duoc thi bo trong (hoi thoai da ton tai). */
function projectIdFor(cfg) {
  try { return requireProjectId(cfg).id; } catch { return undefined; }
}

function saveOutgoing(cfg, task, name, text) {
  const p = contractPaths(cfg, task);
  const file = path.join(ensureDir(p.logsDir), `${name}.md`);
  writeFileAtomic(file, text);
  return file;
}

/**
 * pm_run kind=oracle: PM tu tai hien loi tren code goc (worktree @ baseCommit + file test cua agent) roi
 * chay lai tren cay that. Ghi run record kind='oracle' — cong nghiem thu (mustHave.oracle) doc tu day.
 */
async function runOracle(cfg, task, args) {
  const fresh = freshness(cfg, task);
  const command = args.command || fresh.result?.oracle?.command || null;
  const changedFiles = await changedFilesOf(cfg, task);
  const base = await baseCommitOf(cfg, task);
  const startedMs = Date.now();
  const o = await replayOracle(cfg, {
    baseCommit: base, command, changedFiles, timeoutMs: args.timeoutMs || cfg.runTimeoutMs,
  });
  const p = contractPaths(cfg, task);
  const stamp = Date.now();
  const logFile = path.join(ensureDir(p.logsDir), `oracle-r${task.round}-${stamp}.log`);
  writeFileAtomic(logFile, [
    `oracle: ${command || '(khong co lenh)'}`, `baseCommit: ${base || '(khong co)'}`, `blocked: ${o.blocked || '-'}`,
    `testFilesCopied: ${o.testFilesCopied?.join(', ') || '-'}`, `extraCopied: ${o.extraCopied?.join(', ') || '-'}`,
    '', '=== RED (worktree @ baseCommit) ===', o.redLog || '(chua chay)', '', '=== GREEN (cay that) ===', o.greenLog || '(chua chay)', '',
  ].join('\n'));
  const { redLog, greenLog, ...rec } = o;
  recordRun(cfg, task, {
    kind: 'oracle', command: command || '(khong co)', exitCode: o.ok ? 0 : 1, durationMs: Date.now() - startedMs,
    timedOut: Boolean(o.red?.timedOut || o.green?.timedOut), logFile, startedAt: new Date(startedMs).toISOString(), oracle: rec,
  });
  const L = [`$ (oracle) ${command || '(khong co lenh)'}`, oracleLine(o)];
  if (o.testFilesCopied?.length) L.push(`File test chep sang code goc: ${o.testFilesCopied.join(', ')}${o.extraCopied?.length ? ` (+ ${o.extraCopied.join(', ')})` : ''}`);
  L.push(`Log: ${logFile}`);
  if (o.blocked) L.push('Khong chay duoc oracle => ghi BLOCKED cho task, khong phai "agent sai". Xem ly do tren.');
  L.push('');
  L.push(gateLines(await gateNow(cfg, task)));
  return L.join('\n');
}

// ---------------------------------------------------------------- dinh nghia tool

export const TOOLS = [
  {
    name: 'pm_doctor',
    description: 'Kiem tra Antigravity + cau hinh project. ping=true: mo hoi thoai thu de kiem chung duong day.',
    inputSchema: {
      type: 'object',
      properties: {
        ...PROJECT_PROP,
        ping: { type: 'boolean', description: 'Mo hoi thoai thu (ton quota)' },
      },
    },
    async handler(args) {
      const cfg = ctx(args);
      const L = [];
      L.push(`Project: ${cfg.projectRoot}`);
      L.push(`Cau hinh chung: ${cfg.globalConfigFile || '(chua co ~/.antigravity-pm.json)'}`);
      L.push(`Cau hinh project: ${cfg.configFile
        || `(chua co ${CONFIG_NAME} — dang dung ${cfg.globalConfigFile ? 'cau hinh chung' : 'mac dinh'})`}`);
      for (const w of cfg.warnings) L.push(`  ! ${w}`);
      L.push(`Thu muc trang thai: ${cfg.stateRoot}`);
      L.push(`Model mac dinh: ${cfg.defaultModel}`);
      L.push(`Lenh test: ${cfg.testCommand || '(CHUA KHAI — pm_run kind=test se bao loi, cong nghiem thu se khong bao gio dat)'}`);
      L.push(`Lenh audit: ${cfg.auditCommands.length ? cfg.auditCommands.join(' ; ') : '(chua khai)'}`);
      L.push(`File luat se nhet vao prompt: ${existingRulesFiles(cfg).join(', ') || '(khong thay file nao)'}`);
      const provs = describeProviders(cfg);
      L.push(`Cach chup anh nghiem thu: ${provs.length ? provs.map((p) => `${p.name}(${p.type})`).join(', ') : '(chua khai — van co the dung sourceFile de nhan anh do agent tu chup)'}`);
      L.push(`So anh toi thieu de nghiem thu: ${cfg.proof.require}`);
      const must = mustHaveOf(cfg);
      L.push(`LUAT BAT BUOC — thay doi phai kem file test: ${must.testChange ? 'CO' : 'tat'}`
        + ` · anh phai chup tu: ${must.proofFrom.length ? must.proofFrom.join(' hoac ') : '(bat ky provider nao)'}`);
      L.push(`  · file rac goc repo: ${must.strayFiles} · stage test: ${Object.keys(cfg.testStages || {}).join(', ') || '(khong)'} · tran plan trong prompt: ${cfg.promptPlanMaxBytes} ky tu`);
      L.push(`  · oracle do->xanh PM tu replay: ${must.oracle ? 'CO (task bugfix)' : 'tat'}`
        + ` · thu muc doc quyen (khong giao song song): ${must.exclusiveDirs.length ? must.exclusiveDirs.join(', ') : '(khong)'}`);
      const globs = cfg.testEvidence?.resultsGlob || [];
      L.push(`  · bang chung test: ${globs.length ? `XML JUnit ${globs.join(', ')}` : 'CHI stdout (weak) — khai testEvidence.resultsGlob de dem tu XML'}`
        + ` · file chep vao worktree oracle: ${(cfg.oracle?.copyToWorktree || []).join(', ') || '(khong)'}`);
      L.push('');
      L.push(`agentapi: ${agentapiPath() || 'KHONG TIM THAY'}`);
      const proj = resolveProject(cfg.projectRoot);
      if (proj) {
        L.push(`Project trong Antigravity: ${proj.name} · id ${proj.id}${proj.match === 'parent' ? ' (khop qua thu muc cha)' : ''}`);
        const eager = /EAGER|TURBO/i.test(`${proj.autoExecution} ${proj.artifactReview}`);
        L.push(`  Tu chay lenh: ${proj.autoExecution || '?'} · duyet artifact: ${proj.artifactReview || '?'}`
          + (eager ? ' => agent tu chay, khong ket o man hinh cho bam Accept' : ' => agent CO THE dung cho ban bam Accept trong IDE'));
      } else if (cfg.antigravity.projectId) {
        L.push(`Project id: ${cfg.antigravity.projectId} (khai trong cau hinh)`);
      } else {
        L.push('Project trong Antigravity: CHUA DANG KY — pm_dispatch se that bai. Mo project nay trong Antigravity 1 lan.');
      }
      try {
        const conn = await discover();
        L.push(`Antigravity language server: noi duoc tai ${conn.address} (nguon: ${conn.source})`);
      } catch (e) {
        L.push(`Antigravity language server: KHONG NOI DUOC — ${e.message}`);
        if (e.hint) L.push(`  Goi y: ${e.hint}`);
      }
      const tasks = listTasks(cfg);
      L.push('');
      L.push(`Task hien co: ${tasks.length}`);
      for (const t of tasks.slice(-8)) L.push(`  ${taskLine(t)}`);
      L.push('');
      L.push('Workspace duoc chon bang PROJECT ID (lay tu so dang ky ~/.gemini/config/projects), khong phai bang project ma IDE dang mo.');
      L.push('Project phai tung duoc mo trong Antigravity 1 lan de duoc dang ky. pm_dispatch van kiem lai workspace sau khi tao, coi nhu luoi an toan.');

      if (args?.ping) {
        L.push('');
        L.push('--- ping: mo 1 hoi thoai thu ---');
        try {
          const pid = requireProjectId(cfg);
          L.push(`Dung project id: ${pid.id} (${pid.name})`);
          const { conversationId } = await newConversation({
            projectId: pid.id,
            model: 'flash_lite',
            title: '[PM] ping duong day',
            prompt: 'Day la phep thu duong day tu Claude Code. Tra loi dung 1 tu: PONG. '
              + 'KHONG goi bat ky tool nao, KHONG doc file, KHONG sua file, KHONG chay lenh.',
          });
          L.push(`Tao hoi thoai: OK — ${conversationId}`);
          const md = await getConversationMetadata(conversationId);
          L.push(`Workspace cua hoi thoai: ${md.workspace || '(khong ro)'}${md.branch ? ` · nhanh ${md.branch}` : ''}`);
          L.push(`Khop voi project dang hoi: ${md.workspace && exists(md.workspace) && fs.realpathSync(md.workspace) === fs.realpathSync(cfg.projectRoot) ? 'CO' : 'KHONG — hay mo dung project trong Antigravity'}`);
          await sendMessage({ conversationId, projectId: pid.id, content: 'Phep thu tin nhan tiep theo. Tra loi dung 1 tu: PONG2. Khong dung tool.' });
          L.push('Gui tin nhan tiep vao hoi thoai cu: OK');
          const prog = conversationProgress(conversationId);
          L.push(`Dong tinh ghi nhan duoc: ${prog.found ? prog.lastActivityAt : 'chua thay (agent co the chua chay)'}`);
          L.push('Ban co the mo Antigravity de xem 2 cau tra loi PONG/PONG2 — do la bang chung duong day thong ca 2 chieu.');
        } catch (e) {
          L.push(`PING THAT BAI: ${e.message}`);
          if (e.hint) L.push(`  Goi y: ${e.hint}`);
          if (e.detail) L.push(`  Chi tiet: ${truncate(String(e.detail), 1200)}`);
        }
      }
      return L.join('\n');
    },
  },

  {
    name: 'pm_task_create',
    description: 'Mo task moi. definitionOfDone bat buoc va phai kiem chung duoc.',
    inputSchema: {
      type: 'object',
      properties: {
        ...PROJECT_PROP,
        title: { type: 'string' },
        brief: { type: 'string', description: 'Hien trang, can lam gi, pham vi duoc sua, cai gi CAM sua' },
        definitionOfDone: { type: 'array', items: { type: 'string' }, description: 'Dieu kien dat, kiem chung duoc' },
        type: { type: 'string', enum: TASK_TYPES, description: 'Mac dinh bugfix (doi oracle do->xanh khi mustHave.oracle bat)' },
        proofKind: { type: 'string', enum: PROOF_KINDS, description: 'device (mac dinh, anh thiet bi) | browser | script (anh do PM chup bang lenh)' },
        model: { type: 'string', enum: MODELS },
      },
      required: ['title', 'brief', 'definitionOfDone'],
    },
    async handler(args) {
      const cfg = ctx(args);
      const a = validate(this.inputSchema, args);
      const task = createTask(cfg, a);
      const p = contractPaths(cfg, task);
      const tpl = path.join(ensureDir(p.logsDir), 'plan-template.md');
      writeFileAtomic(tpl, planTemplate(task));
      return [
        `Da mo task ${task.id}: ${task.title} (type=${task.type} · proofKind=${task.proofKind})`,
        `Ho so: ${p.dir}`,
        `Trang thai: ${task.phase} / ${task.state}`,
        '',
        'Buoc tiep: PM tu viet ke hoach roi ghi bang pm_plan (kem files=[...] pham vi de do chong lan). Antigravity chi phan bien va thuc thi.',
        `Mau ke hoach (co muc "Thu tu buoc NHO -> LON" — agent hay tu choi task lon): ${tpl}`,
      ].join('\n');
    },
  },

  {
    name: 'pm_plan',
    description: 'PM ghi ke hoach cua chinh minh vao plan.md. Antigravity KHONG lap ke hoach. '
      + 'Ghi lai plan thi ban phan bien cu va ket luan plan cu bi huy.',
    inputSchema: {
      type: 'object',
      properties: {
        ...PROJECT_PROP,
        ...TASK_PROP,
        content: { type: 'string', description: 'Noi dung plan.md (markdown)' },
        file: { type: 'string', description: 'Hoac duong dan file PM da soan san' },
        files: { type: 'array', items: { type: 'string' }, description: 'Pham vi file task se sua (do chong lan voi task song song)' },
        forbidden: { type: 'array', items: { type: 'string' }, description: 'File/thu muc CAM dung — cham vao la cong nghiem thu tu choi' },
        notes: { type: 'string', description: 'Ghi chu cho lich su task' },
      },
      required: ['taskId'],
    },
    async handler(args) {
      const { cfg, task } = withTask(args);
      validate(this.inputSchema, args);
      if (!args.content && !args.file) fail('pm_plan can "content" (noi dung plan) hoac "file" (duong dan file da soan).');
      if (args.content && args.file) fail('pm_plan chi nhan MOT trong hai: "content" hoac "file".');
      let body = args.content;
      if (args.file) {
        const src = path.resolve(cfg.projectRoot, args.file);
        if (!fs.existsSync(src)) fail(`Khong thay file ke hoach: ${src}`);
        body = fs.readFileSync(src, 'utf8');
      }
      if (!String(body).trim()) fail('Ke hoach rong — khong ghi.');

      const p = contractPaths(cfg, task);
      const critique = path.join(p.dir, 'plan-review.json');
      const lai = fs.existsSync(p.plan);
      // Luu ban cu (plan + phan bien) de focus=delta co cai ma so; khong xoa lich su (T0024: 9 vong, phan bien cu bien mat).
      if (lai) {
        const v = task.planVersion || 1;
        fs.copyFileSync(p.plan, path.join(ensureDir(p.logsDir), `plan-v${v}.md`));
        if (fs.existsSync(critique)) fs.renameSync(critique, path.join(p.logsDir, `plan-review-v${v}.json`));
      }
      task.planVersion = (task.planVersion || (lai ? 1 : 0)) + 1;
      writeFileAtomic(p.plan, String(body).endsWith('\n') ? String(body) : `${body}\n`);
      task.planHash = hashOf(fs.readFileSync(p.plan));
      // Plan doi => moi thu gan voi plan cu het hieu luc.
      if (fs.existsSync(critique)) fs.rmSync(critique);
      if (task.verdicts?.plan) delete task.verdicts.plan;
      task.planAuthor = 'pm';
      task.planWrittenAt = nowIso();
      task.state = 'plan_written';
      if (Array.isArray(args.files)) task.scopeFiles = args.files.map(String).map((f) => f.trim()).filter(Boolean);
      if (Array.isArray(args.forbidden)) task.forbiddenPaths = args.forbidden.map(String).map((f) => f.trim()).filter(Boolean);
      addHistory(task, 'pm', lai ? 'plan_rewritten' : 'plan_written', args.notes || '');
      save(cfg, task);
      const nhac = kiemTraKeHoach(body);
      const chongLan = kiemChongLan(cfg, { id: task.id, files: task.scopeFiles || [] }, cacTaskDangChayKhac(cfg, task));

      return [
        `${lai ? 'Da ghi de' : 'Da ghi'} ke hoach cua PM: ${p.plan} (v${task.planVersion} · plan_hash ${task.planHash.slice(0, 12)})`,
        lai ? 'Ban phan bien cu va ket luan plan cu da bi huy (ke hoach da doi).' : '',
        task.scopeFiles?.length ? `Pham vi file: ${task.scopeFiles.length} file.` : 'Chua khai pham vi file (files=[...]) — khong do duoc chong lan voi task song song.',
        task.forbiddenPaths?.length ? `CAM dung: ${task.forbiddenPaths.join(', ')} (cong nghiem thu se tu choi neu cham).` : '',
        ...nhac.map((w) => `LUU Y: ${w}`),
        ...chongLan.overlaps.map((o) => `CHONG LAN voi ${o.taskId} dang chay: ${o.files.join(', ')}`),
        ...chongLan.exclusive.map((e) => `THU MUC DOC QUYEN "${e.dir}" dang co ${e.taskId} sua — pm_dispatch implement se bi chan cho toi khi task kia xong.`),
        'Buoc tiep: pm_dispatch kind=plan_review de Antigravity phan bien ke hoach (chi doc, cam sua code).',
        'Nghe phan bien xong moi duoc pm_verdict kind=plan verdict=pass.',
      ].filter(Boolean).join('\n');
    },
  },

  {
    name: 'pm_status',
    description: 'Khong taskId: liet ke task. Co taskId: tien do, bang chung con thieu, hoi thoai con dong tinh khong. nudge=true: nhan danh thuc agent im lau.',
    inputSchema: {
      type: 'object',
      properties: { ...PROJECT_PROP, ...TASK_PROP, nudge: { type: 'boolean', description: 'Gui tin nhac vao hoi thoai lam viec' } },
    },
    async handler(args) {
      if (!args?.taskId) {
        const cfg = ctx(args);
        const tasks = listTasks(cfg);
        if (tasks.length === 0) return `Chua co task nao trong ${cfg.tasksRoot}`;
        return [`${tasks.length} task · ${cfg.projectName}:`, ...tasks.map(taskLine)].join('\n');
      }
      const { cfg, task } = withTask(args);
      const p = contractPaths(cfg, task);
      const fresh = freshness(cfg, task);
      const g = await gateNow(cfg, task);
      const L = [];
      L.push(`${task.id} — ${task.title}`);
      L.push(`Giai doan: ${task.phase} · trang thai: ${task.state} · vong: ${task.round}`);
      L.push(`Hoi thoai: ${task.conversationId || '(chua giao)'}${task.auditConversationId ? ` · audit: ${task.auditConversationId}` : ''}`);
      if (task.conversationId) {
        const prog = conversationProgress(task.conversationId);
        let idle = null;
        if (prog.found) {
          idle = prog.idleMinutes;
          const stalled = prog.idleMinutes >= (cfg.stallMinutes || 12);
          L.push(`Dong tinh cuoi cua agent: ${prog.lastActivityAt} (im ${prog.idleMinutes} phut)${stalled ? ' — CO THE DANG TREO hoac dang doi ban bam Accept trong Antigravity' : ''}`);
          const te = transcriptErrors(task.conversationId);
          if (te.found && te.lastStepIsError) L.push(`STREAM BI NGAT: buoc cuoi trong transcript la ERROR_MESSAGE (${te.lastErrorAt}) — agent da chet giua chung, nudge/dispatch lai; ${te.errorCount} loi trong doan cuoi.`);
          else if (te.found && te.errorCount) L.push(`  (transcript co ${te.errorCount} ERROR_MESSAGE gan day, lan cuoi ${te.lastErrorAt} — agent da tu tiep tuc)`);
          if (stalled && !args.nudge) L.push('  -> send-message danh thuc duoc (do 12/09/2026): goi lai pm_status nudge=true de nhac.');
        } else {
          L.push('Chua thay CSDL hoi thoai — agent co the chua bat dau.');
        }
        if (args.nudge === true) {
          // Bai hoc dem 13-14/09/2026: agent im 30-60 phut, chi tinh khi PM nhan. Nhac KHONG doi round, khong doi moc implementDispatchedAt.
          const msg = buildNudgeMessage(cfg, task, idle ?? '?');
          const promptFile = saveOutgoing(cfg, task, `prompt-nudge-${Date.now()}`, msg);
          await sendMessage({ conversationId: task.conversationId, projectId: projectIdFor(cfg), content: msg });
          recordDispatch(cfg, task, { kind: 'nudge', promptFile });
          L.push(`Da nhac agent (nudge): ${promptFile}`);
        }
      } else if (args.nudge === true && task.planReviewConversationId && task.phase === 'PLAN') {
        // Chua co hoi thoai lam viec nhung dang cho phan bien => nhac hoi thoai phan bien.
        const msg = `# ${task.id} — PM kiem tra: chua thay plan-review.json. Neu da phan bien xong: ghi file dung khuon roi dung. Neu dang doc: tiep tuc.`;
        await sendMessage({ conversationId: task.planReviewConversationId, projectId: projectIdFor(cfg), content: msg });
        recordDispatch(cfg, task, { kind: 'nudge', conversationId: task.planReviewConversationId });
        L.push('Da nhac hoi thoai phan bien ke hoach (nudge).');
      } else if (args.nudge === true) {
        L.push('Khong nhac duoc: task chua co hoi thoai lam viec.');
      }
      L.push('');
      L.push(`plan.md: ${fresh.planExists ? 'co' : 'chua co'}${task.planVersion ? ` (v${task.planVersion})` : ''}`);
      L.push(...await tinhTrangPhanBien(cfg, task));
      L.push(`result.json: ${fresh.resultExists ? (fresh.resultFresh ? `co (ghi luc ${fresh.resultMtime})` : `CU (truoc lan rework ${task.lastReworkAt})`) : 'chua co'}`);
      if (!fresh.resultFresh && exists(path.join(cfg.projectRoot, 'result.json'))) {
        L.push(`  CHU Y: co result.json o GOC REPO (${path.join(cfg.projectRoot, 'result.json')}) — agent ghi NHAM cho (Unity T0014). Bao agent ghi lai vao ${p.result}; file o goc la rac.`);
      }
      if (fresh.result) {
        const r = fresh.result;
        L.push(`  phase=${r.phase || '?'} · summary: ${truncate(r.summary || '', 600)}`);
        if (r.files_changed?.length) L.push(`  file da sua (${r.files_changed.length}): ${r.files_changed.slice(0, 25).join(', ')}`);
        if (r.files_to_change?.length) L.push(`  file se sua (${r.files_to_change.length}): ${r.files_to_change.slice(0, 25).join(', ')}`);
        if (r.tests) L.push(`  agent tu chay test: ${JSON.stringify(r.tests)}`);
        if (r.screenshots?.length) L.push(`  anh agent tu chup: ${r.screenshots.join(', ')}`);
        if (r.open_questions?.length) L.push(`  CAU HOI CAN PM CHOT: ${r.open_questions.join(' | ')}`);
        if (r.blocked) L.push(`  BI VUONG: ${typeof r.blocked === 'string' ? r.blocked : JSON.stringify(r.blocked)}`);
      }
      const agentAudit = path.join(p.dir, 'audit-agent.json');
      if (exists(agentAudit)) {
        const kq = kiemBaoCao(cfg.projectRoot, readJsonIfExists(agentAudit));
        L.push(`audit-agent.json: co (auditor doc lap da bao cao) · trich dan: ${dongTomTat(kq)}${kq.bia.some((b) => b.status === 'not-found') ? ' — CO TRICH DAN BIA (not-found), pm_verdict audit pass se bi chan' : ''}`);
      }
      if (fresh.result) {
        const kq = kiemBaoCao(cfg.projectRoot, fresh.result);
        if (kq.items.length) L.push(`  trich dan trong result.json: ${dongTomTat(kq)}`);
      }
      L.push('');
      L.push(`Ket luan: plan=${task.verdicts?.plan?.verdict || '-'} audit=${task.verdicts?.audit?.verdict || '-'} review=${task.verdicts?.review?.verdict || '-'}`);
      if (task.openFindings?.length) {
        L.push(`FINDING CHUA DONG (vong ${task.round}, ${task.openFindings.length}):`);
        for (const [i, f] of task.openFindings.slice(0, 30).entries()) L.push(`  ${i + 1}. ${truncate(f, 300)}`);
      }
      const runs = (task.runs || []).filter((r) => r.round === task.round);
      L.push(`Lenh da chay vong nay: ${runs.length ? runs.map((r) => `${r.kind}:exit${r.exitCode}`).join(', ') : 'chua co'}`);
      L.push(`Anh nghiem thu vong nay: ${(task.proofs || []).filter((x) => x.round === task.round).length}/${cfg.proof.require}`);
      L.push('');
      L.push(gateLines(g));
      return L.join('\n');
    },
  },

  {
    name: 'pm_dispatch',
    description: 'Giao viec: plan (mo hoi thoai, lap ke hoach, cam sua code) | implement (duyet plan, cho lam) | audit (hoi thoai audit doc lap, chi doc) | proof (doi anh) | custom.',
    inputSchema: {
      type: 'object',
      properties: {
        ...PROJECT_PROP,
        ...TASK_PROP,
        kind: { type: 'string', enum: ['plan_review', 'implement', 'audit', 'proof', 'custom'] },
        notes: { type: 'string', description: 'Ghi chu PM (implement)' },
        focus: { type: 'string', enum: ['full', 'delta'], description: 'plan_review: delta = chi phan bien phan doi so voi ban truoc' },
        message: { type: 'string', description: 'custom: noi dung · proof: can chung minh gi · audit: trong tam' },
        model: { type: 'string', enum: MODELS },
        force: { type: 'boolean', description: 'Bo qua kiem tra giai doan' },
      },
      required: ['taskId', 'kind'],
    },
    async handler(args) {
      if (args?.kind === 'plan') {
        fail('Antigravity khong con lap ke hoach nua. PM tu viet ke hoach roi ghi bang pm_plan, '
          + 'sau do pm_dispatch kind=plan_review de Antigravity phan bien.');
      }
      const { cfg, task } = withTask(args);
      validate(this.inputSchema, args);
      const kind = args.kind;
      const L = [];

      if (kind === 'plan_review') {
        if (!freshness(cfg, task).planExists) {
          fail('Chua co plan.md. PM phai viet ke hoach truoc bang pm_plan, roi moi giao phan bien.');
        }
        const pth = contractPaths(cfg, task);
        const planHash = hashOf(fs.readFileSync(pth.plan));
        task.planHash = planHash;
        task.planHashSent = planHash;
        task.planReviewDispatchedAt = nowIso();
        let delta = null;
        if (args.focus === 'delta') {
          delta = await deltaKeHoach(cfg, task);
          if (!delta) L.push('focus=delta: khong co ban ke hoach truoc de so — gui ban day du.');
        }
        const prompt = buildPlanCritiquePrompt(cfg, task, { planHash, delta });
        const promptFile = saveOutgoing(cfg, task, `prompt-plan-review-r${task.round}-v${task.planVersion || 1}`, prompt);
        if (prompt.length > 20000) L.push(`CANH BAO: prompt ${Math.round(prompt.length / 1024)} KB — agent de chet context (Unity T0007: 3/6 vong treo). Rut plan hoac dung focus=delta.`);
        const pid = requireProjectId(cfg);
        const { conversationId } = await newConversation({
          prompt, projectId: pid.id, model: args.model || task.model, title: `[PM] ${task.id} · PHAN BIEN KE HOACH · ${task.title}`,
        });
        task.planReviewConversationId = conversationId;
        task.state = 'awaiting_agent';
        recordDispatch(cfg, task, { kind: 'plan_review', conversationId, model: args.model || task.model, promptFile });
        L.push(`Da giao PHAN BIEN KE HOACH cho Antigravity. conversationId=${conversationId}`);
        const check = await ensureWorkspaceMatches(cfg, conversationId);
        if (!check.ok) {
          const msg = `Hoi thoai duoc mo trong workspace "${check.got || '(khong ro)'}" chu KHONG phai "${check.want}".`;
          if (cfg.antigravity.workspaceCheck === 'strict') {
            task.state = 'blocked';
            addHistory(task, 'system', 'workspace_mismatch', msg);
            save(cfg, task);
            fail(`${msg}\nAntigravity mo hoi thoai trong project dang mo tren IDE. Hay mo "${check.want}" trong Antigravity roi chay lai pm_dispatch kind=plan_review.\n(Hoi thoai vua tao: ${conversationId} — nen bo/dong trong IDE.)`);
          }
          L.push(`CANH BAO: ${msg}`);
        } else {
          L.push(`Workspace khop: ${check.got}${check.md.branch ? ` (nhanh ${check.md.branch})` : ''}`);
        }
        L.push(`Prompt da luu: ${promptFile}`);
        L.push(`Ket qua se nam o: ${path.join(contractPaths(cfg, task).dir, 'plan-review.json')}`);
        L.push('Buoc tiep: doi vai phut roi pm_status. Doc plan-review.json roi hoac sua ke hoach (pm_plan) hoac chot (pm_verdict kind=plan verdict=pass).');
        return L.join('\n');
      }

      if (!task.conversationId && !['audit', 'implement'].includes(kind)) {
        fail('Task chua co hoi thoai lam viec. Chay pm_dispatch kind=implement truoc (buoc do se mo hoi thoai).');
      }

      if (kind === 'implement') {
        const fresh = freshness(cfg, task);
        if (!fresh.planExists && !args.force) fail('Chua co plan.md. PM viet ke hoach truoc bang pm_plan.');
        if (task.verdicts?.plan?.verdict !== 'pass' && !args.force) {
          fail('Ke hoach chua duoc chot. Nghe phan bien (pm_dispatch kind=plan_review) roi pm_verdict kind=plan verdict=pass (hoac force=true).');
        }
        // Chan chong lan TRUOC khi mo hoi thoai (13/09/2026: hai task cung dung shared/ de len nhau).
        const guard = await canhBaoTruocKhiGiao(cfg, task, args.force === true);
        if (guard.blocked) fail(`${guard.blocked}\n${guard.lines.join('\n')}`);
        const msg = buildImplementMessage(cfg, task, args.notes || '');
        const promptFile = saveOutgoing(cfg, task, `prompt-implement-r${task.round}`, msg);
        if (msg.length > 20000) guard.lines.push(`prompt ${Math.round(msg.length / 1024)} KB — agent de chet context; rut plan (promptPlanMaxBytes) hoac tach task.`);
        const moiMo = !task.conversationId;
        if (moiMo) {
          // Ke hoach do PM viet nen khong con hoi thoai lap ke hoach de nhan tin — mo hoi thoai lam viec o day.
          const pidI = requireProjectId(cfg);
          const { conversationId } = await newConversation({
            prompt: msg, projectId: pidI.id, model: args.model || task.model, title: `[PM] ${task.id} · TRIEN KHAI · ${task.title}`,
          });
          task.conversationId = conversationId;
          const checkI = await ensureWorkspaceMatches(cfg, conversationId);
          if (!checkI.ok && cfg.antigravity.workspaceCheck === 'strict') {
            task.state = 'blocked';
            addHistory(task, 'system', 'workspace_mismatch', `${checkI.got || '(khong ro)'} != ${checkI.want}`);
            save(cfg, task);
            fail(`Hoi thoai mo trong workspace "${checkI.got || '(khong ro)'}" chu khong phai "${checkI.want}". `
              + `Mo dung project trong Antigravity roi chay lai.\n(Hoi thoai vua tao: ${conversationId} — nen bo/dong trong IDE.)`);
          }
        } else {
          await sendMessage({ conversationId: task.conversationId, projectId: projectIdFor(cfg), content: msg });
        }
        setPhase(cfg, task, 'IMPLEMENT', 'pm', 'plan da chot');
        task.state = 'awaiting_agent';
        recordDispatch(cfg, task, { kind: 'implement', conversationId: task.conversationId, promptFile });
        return [
          `Da giao TRIEN KHAI (${task.id})${moiMo ? ` — mo hoi thoai moi ${task.conversationId}` : ''}.`,
          ...guard.lines.map((l) => `CHU Y: ${l}`),
          `Noi dung da gui: ${promptFile}`,
          'Do tren may that 12/09/2026: send-message danh thuc duoc hoi thoai da im 11 phut (dong tinh sau ~1,6 giay).',
          'Neu 5-10 phut khong thay dong tinh thi moi la bat thuong — xem pm_status.',
        ].join('\n');
      }

      if (kind === 'audit') {
        const prompt = buildAuditPrompt(cfg, task, args.message || '');
        const promptFile = saveOutgoing(cfg, task, `prompt-audit-r${task.round}`, prompt);
        const pidA = requireProjectId(cfg);
        const { conversationId } = await newConversation({
          prompt, projectId: pidA.id, model: args.model || task.model, title: `[PM] ${task.id} · AUDIT doc lap`,
        });
        task.auditConversationId = conversationId;
        if (task.phase === 'IMPLEMENT') setPhase(cfg, task, 'AUDIT', 'pm', 'da giao audit doc lap');
        recordDispatch(cfg, task, { kind: 'audit', conversationId, promptFile });
        return [
          `Da mo hoi thoai AUDIT doc lap: ${conversationId}`,
          `Ket qua se nam o: ${path.join(contractPaths(cfg, task).dir, 'audit-agent.json')}`,
          'PM van la nguoi chot: doc audit-agent.json + tu kiem tra, roi pm_verdict kind=audit.',
        ].join('\n');
      }

      if (kind === 'proof') {
        if (!args.message) fail('kind=proof can "message": can chung minh dieu gi bang hinh.');
        const msg = buildProofRequestMessage(cfg, task, args.message);
        const promptFile = saveOutgoing(cfg, task, `prompt-proof-r${task.round}`, msg);
        await sendMessage({ conversationId: task.conversationId, projectId: projectIdFor(cfg), content: msg });
        recordDispatch(cfg, task, { kind: 'proof', promptFile });
        return `Da yeu cau agent chup anh nghiem thu. Khi co anh, dung pm_capture_proof voi sourceFile=<duong dan anh> de PM xac nhan va dua vao ho so.`;
      }

      // custom
      if (!args.message) fail('kind=custom can "message".');
      await sendMessage({ conversationId: task.conversationId, projectId: projectIdFor(cfg), content: args.message });
      const promptFile = saveOutgoing(cfg, task, `prompt-custom-${Date.now()}`, args.message);
      recordDispatch(cfg, task, { kind: 'custom', promptFile });
      return 'Da gui tin nhan cho agent.';
    },
  },

  {
    name: 'pm_message',
    description: 'Gui tin nhan (tham so `content`) vao hoi thoai cua task.',
    inputSchema: {
      type: 'object',
      properties: {
        ...PROJECT_PROP, ...TASK_PROP,
        content: { type: 'string', description: 'Noi dung tin nhan' },
        message: { type: 'string', description: 'Ten khac cua content' },
        toAudit: { type: 'boolean', description: 'Gui vao hoi thoai audit' },
      },
      required: ['taskId'],
    },
    async handler(args) {
      const { cfg, task } = withTask(args);
      // T0021 (14/09/2026): mo ta noi "message", schema doi "content" => 2 lan loi "noi dung rong". Nhan ca hai.
      const content = String(args.content ?? args.message ?? '').trim();
      if (!content) fail('Thieu noi dung tin nhan: truyen "content" (hoac "message").');
      const cid = args.toAudit ? task.auditConversationId : task.conversationId;
      if (!cid) fail(args.toAudit ? 'Task chua co hoi thoai audit.' : 'Task chua co hoi thoai.');
      await sendMessage({ conversationId: cid, projectId: projectIdFor(cfg), content });
      addHistory(task, 'pm', 'message', content);
      save(cfg, task);
      return `Da gui tin nhan vao hoi thoai ${cid}.`;
    },
  },

  {
    name: 'pm_verdict',
    description: 'Ghi ket luan plan | audit | review. fail thi kem findings roi pm_rework.',
    inputSchema: {
      type: 'object',
      properties: {
        ...PROJECT_PROP,
        ...TASK_PROP,
        kind: { type: 'string', enum: ['plan', 'audit', 'review'] },
        verdict: { type: 'string', enum: ['pass', 'fail'] },
        findings: { type: 'array', items: { type: 'string' }, description: 'Moi phat hien: file:dong + sai gi' },
        notes: { type: 'string' },
      },
      required: ['taskId', 'kind', 'verdict'],
    },
    async handler(args) {
      const { cfg, task } = withTask(args);
      validate(this.inputSchema, args);
      if (args.kind === 'plan' && args.verdict === 'pass') {
        const pp = contractPaths(cfg, task);
        if (!fs.existsSync(pp.plan)) fail('Chua co plan.md — PM viet ke hoach bang pm_plan truoc.');
        const critique = path.join(pp.dir, 'plan-review.json');
        if (!fs.existsSync(critique)) {
          fail('Chua nghe phan bien nen chua duoc chot ke hoach cua chinh minh. '
            + 'Chay pm_dispatch kind=plan_review, doc plan-review.json, roi chot lai.');
        }
        if (fs.statSync(critique).mtimeMs < fs.statSync(pp.plan).mtimeMs) {
          fail('Ban phan bien cu hon plan.md — no phan bien mot ke hoach khac. Chay lai pm_dispatch kind=plan_review.');
        }
        const review = readJsonIfExists(critique);
        const loi = kiemKhuonPlanReview(review);
        if (loi.length) fail(`plan-review.json sai khuon (${loi.join('; ')}) — chua the coi la da nghe phan bien. pm_status se nhac agent ghi lai.`);
        // T0024 r7: agent phan bien ban plan CU (neu blocker plan v6 da xu ly). Hash phai khop ban da gui.
        if (task.planHashSent) {
          const nay = hashOf(fs.readFileSync(pp.plan));
          if (review.plan_hash !== task.planHashSent || nay !== task.planHashSent) {
            fail(`plan_hash khong khop: review ghi "${review.plan_hash || '(thieu)'}", ban da gui ${task.planHashSent.slice(0, 12)}, plan.md hien tai ${nay.slice(0, 12)} — phan bien khong phai cua ban ke hoach nay. Chay lai pm_dispatch kind=plan_review.`);
          }
        }
      }
      const L = [];
      if (args.verdict === 'pass' && ['plan', 'audit'].includes(args.kind)) {
        // Tu kiem trich dan file:dong cua bao cao agent (Unity T0001: 20/27 trich dan la code khong ton tai).
        const pd = contractPaths(cfg, task).dir;
        const repFile = path.join(pd, args.kind === 'plan' ? 'plan-review.json' : 'audit-agent.json');
        const rep = readJsonIfExists(repFile);
        // audit-agent.json khong theo vong: ban cu hon lan rework/giao trien khai thi bo qua, khong chan hoi to.
        const cut = Math.max(task.lastReworkAt ? Date.parse(task.lastReworkAt) : 0, task.implementDispatchedAt ? Date.parse(task.implementDispatchedAt) : 0);
        let cu = false;
        try { cu = args.kind === 'audit' && rep && Math.floor(fs.statSync(repFile).mtimeMs) <= cut; } catch { cu = false; }
        if (rep && cu) L.push('audit-agent.json cu hon lan rework/giao trien khai gan nhat — bo qua, khong kiem trich dan.');
        if (rep && !cu) {
          const kq = kiemBaoCao(cfg.projectRoot, rep);
          L.push(`Trich dan trong ${path.basename(repFile)}: ${dongTomTat(kq)}`);
          // Chi `not-found` (file co, snippet khong co) la bang chung bia chac chan. `file-missing` co the la CHINH finding
          // ("plan nhac src/New.kt:12 nhung file khong ton tai") => chi canh bao.
          const bia = kq.bia.filter((b) => b.status === 'not-found');
          const thieuFile = kq.bia.filter((b) => b.status === 'file-missing');
          if (thieuFile.length) L.push(`CANH BAO: ${thieuFile.length} trich dan toi file khong ton tai (${thieuFile.slice(0, 5).map((b) => b.file).join(', ')}) — la finding hop le hay bia? PM xem.`);
          if (bia.length) {
            fail(`Bao cao ${args.kind} co ${bia.length} trich dan BIA (file co nhung khong co dong code do): ${bia.slice(0, 8).map((b) => `${b.file}:${b.line} [not-found]`).join(', ')}. `
              + `Khong the coi la da doc/da kiem. Cach go: agent ghi lai ${path.basename(repFile)} voi trich dan that (dispatch lai), hoac PM da tu kiem thi doi file sang logs/ roi ghi ket luan kem notes.`);
          }
        }
      }
      recordVerdict(cfg, task, {
        kind: args.kind, verdict: args.verdict, findings: args.findings || [], notes: args.notes || '',
      });
      L.push(`Da ghi ket luan ${args.kind} = ${args.verdict} cho ${task.id} (vong ${task.round}).`);
      if (args.verdict === 'pass') {
        const next = { plan: 'IMPLEMENT', audit: 'REVIEW', review: 'TEST' }[args.kind];
        if (args.kind === 'plan') L.push('Buoc tiep: pm_dispatch kind=implement (buoc nay se mo hoi thoai lam viec neu chua co).');
        else {
          setPhase(cfg, task, next, 'pm', `${args.kind} dat`);
          L.push(`Giai doan -> ${next}.`);
          if (next === 'TEST') L.push('Buoc tiep: pm_run kind=test.');
          if (next === 'REVIEW') L.push('Buoc tiep: doc pm_diff roi pm_verdict kind=review.');
        }
      } else if (args.kind === 'plan') {
        // Ke hoach la cua PM: PM tu sua, khong day viec nay sang agent.
        L.push('Ke hoach nay do chinh PM viet — tu sua roi ghi lai bang pm_plan (ghi lai se huy ban phan bien cu).');
        L.push('Buoc tiep: pm_plan -> pm_dispatch kind=plan_review -> pm_verdict kind=plan verdict=pass.');
      } else {
        L.push('Buoc tiep: pm_rework de tra viec cho agent (kem findings).');
      }
      L.push(gateLines(await gateNow(cfg, task)));
      return L.join('\n');
    },
  },

  {
    name: 'pm_run',
    description: 'PM tu chay test/audit (ghi exit code + bang chung that) hoac oracle (replay do->xanh tren code goc trong git worktree). Log ra file, chi tra ve duoi log.',
    inputSchema: {
      type: 'object',
      properties: {
        ...PROJECT_PROP,
        ...TASK_PROP,
        kind: { type: 'string', enum: ['test', 'audit', 'oracle'] },
        command: { type: 'string', description: 'Ghi de lenh trong cau hinh (oracle: ghi de result.oracle.command)' },
        stage: { type: 'string', description: 'test: chay mot stage trong testStages (bat buoc kem skipReason)' },
        worktree: { type: 'boolean', description: 'Chay trong worktree dong bang (HEAD + thay doi hien tai), tranh agent chay build song song' },
        skipReason: { type: 'string', description: 'Ly do bo phan test con lai (ghi vao ho so)' },
        timeoutMs: { type: 'number' },
      },
      required: ['taskId', 'kind'],
    },
    async handler(args) {
      const { cfg, task } = withTask(args);
      validate(this.inputSchema, args);
      if (args.kind === 'oracle') return runOracle(cfg, task, args);
      if (args.stage && args.kind !== 'test') fail('"stage" chi dung voi kind=test.');
      if (args.stage && !String(args.skipReason || '').trim()) fail('Chay mot stage thi BAT BUOC ghi "skipReason" (bo phan con lai vi sao) — de ho so khong im lang.');
      if (args.stage && !cfg.testStages?.[args.stage]) fail(`Khong co stage "${args.stage}" trong testStages (co: ${Object.keys(cfg.testStages || {}).join(', ') || 'khong co'}).`);
      const commands = args.command
        ? [args.command]
        : (args.kind === 'test'
          ? (args.stage ? [cfg.testStages[args.stage]] : (cfg.testCommand ? [cfg.testCommand] : []))
          : cfg.auditCommands);
      if (commands.length === 0) {
        fail(args.kind === 'test'
          ? `Chua khai "testCommand" trong ${CONFIG_NAME} va khong truyen command. Khong the ghi nhan test.`
          : `Chua khai "auditCommands" trong ${CONFIG_NAME} va khong truyen command.`);
      }
      const p = contractPaths(cfg, task);
      const L = [];
      // DE XUAT 5a: cay dong bang. T0021 (14/09/2026) NoSuchFileException vi agent T0022 chay gradle song song
      // trong cung thu muc. Opt-in — worktree moi khong co build cache (build lanh); khoa build that su
      // (scripts/lib/build-lock.sh cua project) van phai nam trong chinh testCommand.
      let cwdRun = cfg.projectRoot;
      let wt = null;
      if (args.worktree === true) {
        wt = await dongBangCay(cfg);
        if (wt.error) fail(`Khong dung duoc worktree dong bang: ${wt.error}`);
        cwdRun = wt.dir;
        L.push(`Chay trong worktree dong bang: ${wt.dir} (HEAD + ${wt.applied} file thay doi, ${wt.untracked} file moi)`);
      }
      // Test chay tren cay nao? (de xuat 5c): HEAD + so file dirty, ghi vao dau log.
      const headR = await runShell('git rev-parse --short HEAD 2>/dev/null; git status --porcelain=v1 --untracked-files=all 2>/dev/null | wc -l', { cwd: cfg.projectRoot, timeoutMs: 60000 });
      const [headSha = '?', dirtyN = '?'] = headR.stdout.trim().split('\n').map((x) => x.trim());
      try {
      for (const cmd of commands) {
        const startedMs = Date.now();
        const r = await runShell(cmd, {
          cwd: cwdRun,
          timeoutMs: args.timeoutMs || cfg.runTimeoutMs,
        });
        const logFile = path.join(ensureDir(p.logsDir), `${args.kind}-r${task.round}-${Date.now()}.log`);
        writeFileAtomic(logFile, `$ ${cmd}\n(cwd ${cfg.projectRoot} · HEAD ${headSha} · ${dirtyN} file dirty · startedAt ${new Date(startedMs).toISOString()})\nexit=${r.code} timedOut=${r.timedOut}\n\n--- stdout ---\n${r.stdout}\n--- stderr ---\n${r.stderr}\n`);
        // exit 0 chua phai xanh: T0023 r1 (14/09/2026) `| tail` nuot exit => exit=0 nhung "1 failed" + BUILD FAILED.
        // Bang chung (src/evidence.js): XML JUnit moi hon luc bat dau chay, hoac it nhat stdout khong noi "khong chay".
        const evidence = args.kind === 'test'
          ? collectTestEvidence(wt ? { ...cfg, projectRoot: cwdRun } : cfg, { startedMs, stdout: r.stdout, stderr: r.stderr })
          : null;
        recordRun(cfg, task, {
          kind: args.kind, command: cmd, exitCode: r.code, durationMs: r.durationMs, timedOut: r.timedOut, logFile,
          evidence, startedAt: new Date(startedMs).toISOString(),
          stage: args.stage || null, skipReason: args.stage ? String(args.skipReason).trim() : null,
        });
        if (args.stage) L.push(`CHI CHAY STAGE "${args.stage}" — bo phan con lai vi: ${args.skipReason}`);
        L.push(`$ ${cmd}`);
        L.push(`exit=${r.code}${r.timedOut ? ' (QUA HAN)' : ''} · ${Math.round(r.durationMs / 1000)}s · log day du: ${logFile}`);
        if (evidence) {
          L.push(`Bang chung test: ${evidenceLine(evidence)}`);
          if (r.code === 0 && !evidence.ok) {
            L.push('  -> exit 0 KHONG duoc tinh la xanh. Gradle up-to-date/from-cache: chay lai voi --rerun-tasks. '
              + 'Test do ma exit 0: lenh dang nuot exit code (| tail, || true) — sua lenh, dung tin.');
          }
        }
        // Xanh thi chi can vai dong cuoi; do thi moi can nhieu de chan doan.
        // (Log day du luon nam trong file — Read khi thuc su can, dung do het vao context.)
        const lines = r.code === 0 && !r.timedOut ? 6 : 40;
        L.push(tail(`${r.stdout}\n${r.stderr}`.trim(), lines));
        L.push('');
      }
      } finally {
        if (wt) await goWorktree(cfg, wt.dir);
      }
      L.push(gateLines(await gateNow(cfg, task)));
      return L.join('\n');
    },
  },

  {
    name: 'pm_diff',
    description: 'Agent sua gi that (git). mode=stat (mac dinh, gon) hoac patch (doc ky, ton context). Doi chieu voi file agent khai.',
    inputSchema: {
      type: 'object',
      properties: {
        ...PROJECT_PROP,
        ...TASK_PROP,
        mode: { type: 'string', enum: ['stat', 'patch'], description: 'stat = chi thong ke' },
        pathspec: { type: 'string', description: 'Gioi han duong dan' },
        maxBytes: { type: 'number', description: 'Tran patch, mac dinh 20000' },
      },
    },
    async handler(args) {
      const cfg = ctx(args);
      const patch = args?.mode === 'patch';
      const max = args?.maxBytes || 20000;
      const ps = args?.pathspec ? ` -- ${args.pathspec}` : '';
      const snap = await gitSnapshot(cfg);
      const stat = await runShell(`git --no-pager diff --stat${ps}`, { cwd: cfg.projectRoot, timeoutMs: 120000 });
      const L = [];
      L.push(`Project: ${cfg.projectRoot}`);
      L.push('--- git status ---');
      L.push(truncate(snap.raw || '(sach)', 4000));
      const rac = fileRacGocRepo(snap.untracked, cfg);
      if (rac.length) L.push(`CHU Y — file rac o goc repo (agent de lai script tam?): ${rac.join(', ')}`);
      if (snap.ok) {
        const tk = args?.taskId ? loadTask(cfg, args.taskId) : null;
        const soi = soiThayDoi(cfg.projectRoot, snap.wt, tk ? await baseCommitOf(cfg, tk) : null);
        for (const b of soi.blockers) L.push(`CHAN — ${b}`);
        for (const w of soi.warnings) L.push(`NGHI VA BANG SCRIPT / LAM MEM — ${w}`);
        if (tk?.scopeFiles?.length) {
          const ngoai = snap.untracked.filter((f) => !tk.scopeFiles.some((s) => cungFile(f, s) || f.startsWith(`${s.replace(/\/+$/, '')}/`)));
          if (ngoai.length) L.push(`CHU Y — file MOI ngoai pham vi plan (${ngoai.length}): ${ngoai.slice(0, 20).join(', ')}`);
        }
        if (tk?.forbiddenPaths?.length) {
          const { fileCamDung } = await import('./policy.js');
          const cam = fileCamDung(tk, snap.wt);
          if (cam.length) L.push(`CHAN — dung vao file plan CAM sua: ${cam.join(', ')}`);
        }
      }
      L.push('--- git diff --stat ---');
      L.push(truncate(stat.stdout || '(khong co thay doi)', 6000));
      if (patch) {
        const diff = await runShell(`git --no-pager diff${ps}`, { cwd: cfg.projectRoot, timeoutMs: 180000, maxBytes: max + 1000 });
        L.push('--- git diff ---');
        L.push(truncate(diff.stdout || '(khong co thay doi)', max));
      } else {
        L.push('(chua doc patch — goi lai voi mode="patch" va pathspec cua file can review)');
      }
      if (args?.taskId) {
        const tk0 = loadTask(cfg, args.taskId);
        const base0 = tk0 ? await baseCommitOf(cfg, tk0) : null;
        if (base0) {
          const cm = await runShell(`git --no-pager diff --stat ${base0}..HEAD${ps}`, { cwd: cfg.projectRoot, timeoutMs: 120000 });
          L.push(`--- da commit ke tu commit goc cua task (${base0.slice(0, 8)}..HEAD) ---`);
          L.push(truncate(cm.stdout || '(chua co commit nao sau commit goc)', 6000));
        }
      }
      if (args?.taskId) {
        const task = loadTask(cfg, args.taskId);
        const fresh = freshness(cfg, task);
        if (fresh.result?.files_changed?.length) {
          L.push('');
          L.push('--- Doi chieu voi khai bao cua agent ---');
          const claimed = fresh.result.files_changed.map((f) => String(f).replace(/^\.\//, ''));
          // Cay lam viec HOP commit ke tu commit goc — T0025 (14/09/2026): file da commit bi bao nham "khai ma khong sua".
          const real = (await changedFilesOf(cfg, task)) || snap.wt || [];
          // So bang duong dan chuan hoa (bang nhau hoac duoi "/x"), KHONG includes hai chieu: "a.kt" tung khop nham "Data.kt".
          const notClaimed = real.filter((f) => !claimed.some((c) => cungFile(f, c)));
          const notTouched = claimed.filter((c) => !real.some((f) => cungFile(f, c)));
          L.push(`Agent khai sua ${claimed.length} file. Thay doi cua task (cay lam viec + da commit tu commit goc): ${real.length} file.`);
          if (notClaimed.length) L.push(`CHU Y — thay doi KHONG duoc khai: ${notClaimed.slice(0, 30).join(', ')}`);
          if (notTouched.length) L.push(`CHU Y — khai co sua nhung khong thay thay doi: ${notTouched.slice(0, 30).join(', ')}`);
        }
      }
      return L.join('\n');
    },
  },

  {
    name: 'pm_capture_proof',
    description: 'Lay anh nghiem thu vao ho so va tra anh ve cho PM xem. Tu chup (provider) hoac nhan anh co san (sourceFile).',
    inputSchema: {
      type: 'object',
      properties: {
        ...PROJECT_PROP,
        ...TASK_PROP,
        label: { type: 'string', description: 'Anh chung minh dieu gi' },
        provider: { type: 'string', description: 'Provider trong cau hinh' },
        sourceFile: { type: 'string', description: 'Duong dan anh co san (uu tien hon defaultProvider)' },
        serial: { type: 'string', description: 'Ghi de serial adb' },
        region: { type: 'string', description: 'Vung macOS x,y,w,h' },
        url: { type: 'string', description: 'provider browser: URL/file:// can chup' },
        discardLabel: { type: 'string', description: 'Bo anh hong cung label khoi ho so vong nay truoc khi chup (hoac chi bo, khong chup)' },
      },
      required: ['taskId'],
    },
    async handler(args) {
      const { cfg, task } = withTask(args);
      validate(this.inputSchema, args);
      const p = contractPaths(cfg, task);
      let bo = 0;
      if (args.discardLabel) bo = discardProofs(cfg, task, args.discardLabel);
      if (!args.label) {
        if (!args.discardLabel) fail('Thieu "label" (anh chung minh dieu gi) — hoac chi "discardLabel" de bo anh hong.');
        return [`Da bo ${bo} anh "${args.discardLabel}" khoi ho so vong ${task.round}.`, '', gateLines(await gateNow(cfg, task))].join('\n');
      }
      const shot = await captureProof(cfg, {
        proofDir: p.proofDir,
        label: args.label,
        providerName: args.provider,
        sourceFile: args.sourceFile,
        serial: args.serial,
        region: args.region,
        url: args.url,
      });
      const sha256 = hashFile(shot.file);
      const trung = anhTrung(cfg, task, sha256);
      recordProof(cfg, task, { label: args.label, provider: shot.provider, file: shot.file, bytes: shot.bytes, width: shot.width, sha256 });
      if (task.phase === 'TEST') setPhase(cfg, task, 'PROOF', 'pm', 'da co anh nghiem thu');
      const text = [
        bo ? `Da bo ${bo} anh "${args.discardLabel}" khoi ho so vong ${task.round}.` : '',
        `Da luu anh nghiem thu: ${shot.file}`,
        trung.length ? `CANH BAO: anh TRUNG BYTE (sha256 ${sha256.slice(0, 12)}) voi ${trung.join('; ')} — render deterministic hop le hay chup nham cai cu? PM phai biet.` : '',
        `Cach chup: ${shot.provider} · ${Math.round(shot.bytes / 1024)} KB${shot.width ? ` · ${shot.width}px` : ''}`,
        ...shot.warnings.map((w) => `CANH BAO: ${w}`),
        '',
        gateLines(await gateNow(cfg, task)),
      ].join('\n');
      return { text, images: [{ mime: shot.mime, base64: shot.base64 }] };
    },
  },

  {
    name: 'pm_rework',
    description: 'Tra viec: vong +1, huy ket luan audit/review cu, gui findings cho agent.',
    inputSchema: {
      type: 'object',
      properties: {
        ...PROJECT_PROP,
        ...TASK_PROP,
        findings: { type: 'array', items: { type: 'string' } },
        notes: { type: 'string' },
      },
      required: ['taskId', 'findings'],
    },
    async handler(args) {
      const { cfg, task } = withTask(args);
      validate(this.inputSchema, args);
      const findings = (args.findings || []).map(String).filter(Boolean);
      if (findings.length === 0) fail('findings rong — tra viec phai noi ro sai cho nao.');
      // pm_rework la tra viec CODE. Ke hoach chua duyet ma goi no la day agent di code som.
      if (task.phase === 'PLAN' || task.verdicts?.plan?.verdict !== 'pass') {
        fail('Ke hoach chua duoc chot nen chua co gi de tra viec. Sua ke hoach bang pm_plan, '
          + 'cho phan bien (pm_dispatch kind=plan_review), roi chot bang pm_verdict kind=plan verdict=pass.');
      }
      const failedRuns = (task.runs || []).filter((r) => r.round === task.round && r.exitCode !== 0);
      const blockedCu = freshness(cfg, task).result?.blocked;
      const tuChoiViLon = blockedCu && /phuc tap|phức tạp|qua lon|quá lớn|complex|too (?:big|large|many)|out of scope/i.test(
        typeof blockedCu === 'string' ? blockedCu : JSON.stringify(blockedCu));
      markRework(cfg, task, `${findings.length} phat hien: ${findings[0]}`, findings);
      const msg = buildReworkMessage(cfg, task, { findings, notes: args.notes || '', failedRuns });
      const promptFile = saveOutgoing(cfg, task, `prompt-rework-r${task.round}`, msg);
      if (task.conversationId) {
        await sendMessage({ conversationId: task.conversationId, projectId: projectIdFor(cfg), content: msg });
        recordDispatch(cfg, task, { kind: 'rework', promptFile });
      }
      return [
        `Da tra viec ${task.id} (nay la vong ${task.round}).`,
        'Da huy ket luan audit + review cua vong truoc; test/anh cu khong con tinh nua.',
        `Noi dung da gui: ${promptFile}`,
        tuChoiViLon ? 'LUU Y: agent vua tu choi vi "qua phuc tap" — bai hoc T0012/T0022: findings nen la thu tu buoc NHO -> LON, moi buoc mot viec; giao tung buoc thi no lam duoc.' : '',
        task.conversationId ? '' : 'CHU Y: task chua co hoi thoai nen chi ghi nhan noi bo, chua gui duoc cho agent.',
      ].filter(Boolean).join('\n');
    },
  },

  {
    name: 'pm_accept',
    description: 'Nghiem thu. Chi dat khi du: plan duyet + result.json moi + audit + review + test exit 0 + du anh. Thieu la tu choi.',
    inputSchema: {
      type: 'object',
      properties: { ...PROJECT_PROP, ...TASK_PROP, summary: { type: 'string', description: 'Ket luan PM ghi vao bao cao' } },
      required: ['taskId'],
    },
    async handler(args) {
      const { cfg, task } = withTask(args);
      const gctx = await gateCtx(cfg, task);
      const g = gate(cfg, task, gctx);
      if (!g.ok) {
        const rep = renderReport(cfg, task, { summary: args.summary || '', gateCtx: gctx });
        return {
          text: [
            `TU CHOI NGHIEM THU ${task.id} — chua du bang chung:`,
            ...g.missing.map((m) => `- ${m}`),
            '',
            `Bao cao hien trang (van xuat de xem): ${rep.file}`,
          ].join('\n'),
          isError: true,
        };
      }
      accept(cfg, task, gctx);
      const rep = renderReport(cfg, task, { summary: args.summary || '', gateCtx: gctx });
      const proofs = (task.proofs || []).filter((p) => p.round === task.round);
      return [
        `NGHIEM THU DAT: ${task.id} — ${task.title}`,
        `Vong lam: ${task.round} · nghiem thu luc ${task.acceptedAt}`,
        `Bao cao: ${rep.file}`,
        `Anh nghiem thu (${proofs.length}):`,
        ...proofs.map((p) => `- ${p.label}: ${p.file}`),
      ].join('\n');
    },
  },

  {
    name: 'pm_report',
    description: 'Xuat bao cao nghiem thu ra file md (nhung anh). Tra ve duong dan; includeMarkdown=true moi do noi dung vao context.',
    inputSchema: {
      type: 'object',
      properties: { ...PROJECT_PROP, ...TASK_PROP, summary: { type: 'string' }, includeMarkdown: { type: 'boolean' } },
      required: ['taskId'],
    },
    async handler(args) {
      const { cfg, task } = withTask(args);
      const rep = renderReport(cfg, task, { summary: args.summary || '', gateCtx: await gateCtx(cfg, task) });
      const head = [`Bao cao: ${rep.file}`, gateLines(rep.gate)];
      // Mac dinh KHONG do ca bao cao vao context — day duong dan, can thi Read.
      return args?.includeMarkdown === true ? `${head.join('\n')}\n\n${rep.markdown}` : head.join('\n');
    },
  },
];

export const TOOLS_BY_NAME = new Map(TOOLS.map((t) => [t.name, t]));
