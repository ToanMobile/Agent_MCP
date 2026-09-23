// Cau hinh hai tang: cau hinh chung ~/.antigravity-pm.json lam mac dinh cho MOI project,
// roi <project>/.antigravity-pm.json ghi de len. Repo MCP nay la CONG CU dung chung; moi
// project tu khai testCommand / auditCommands / cach chup anh nghiem thu cua rieng no.
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { homeStateDir, slug } from './util.js';

export const CONFIG_NAME = '.antigravity-pm.json';

/** Duong dan cau hinh chung. ANTIGRAVITY_PM_GLOBAL_CONFIG de tro sang cho khac (test dung). */
export function globalConfigPath() {
  return process.env.ANTIGRAVITY_PM_GLOBAL_CONFIG || path.join(os.homedir(), CONFIG_NAME);
}

/** realpath nhung khong nem loi: duong dan chua ton tai thi tra ve chinh no. */
function realpathSafe(p) {
  try { return fs.realpathSync.native(p); } catch { return path.resolve(p); }
}

export const DEFAULT_CONFIG = {
  // Ten hien thi cua project (chi de bao cao cho dep).
  projectName: null,
  // Model Antigravity mac dinh: flash_lite | flash | pro
  defaultModel: 'pro',
  // Thu muc file hop dong cua task (brief/plan/result.json/proof/logs), tinh tu goc project — agent doc/ghi o day.
  // task.json (ket luan, lan chay test, vong, anh) KHONG nam o day: xem pmStateRoot (HOME), agent khong sua duoc.
  stateDir: '.antigravity-pm',
  // Cac file luat BUOC agent phai doc truoc khi lam (duong dan tuong doi goc project).
  rulesFiles: ['AGENTS.md', 'CLAUDE.md'],
  // Lenh test that. null = chua khai (pm_run kind=test se bao do, khong im lang cho qua).
  testCommand: null,
  // Cac lenh audit/cong chan (script verify, lint, docs gate...).
  auditCommands: [],
  // forbid = cam agent git commit/push (mac dinh). allow = cho phep.
  commitPolicy: 'forbid',
  // Han cho moi lenh chay (test/audit).
  runTimeoutMs: 900000,
  // Coi la "treo" neu khong co tien trien trong bao lau.
  stallMinutes: 12,
  proof: {
    // So anh nghiem thu toi thieu de duoc nghiem thu.
    require: 1,
    // Provider mac dinh khi pm_capture_proof khong chi dinh.
    defaultProvider: null,
    // Khai bao provider: xem src/proof.js
    providers: {},
    // Chieu ngang toi da cua anh luu lai (downscale cho nhe).
    maxWidth: 1280,
  },
  // LUAT BAT BUOC ap cho moi task, xem src/policy.js.
  mustHave: {
    // Thay doi phai kem file test (them moi hoac sua test hien co).
    testChange: true,
    // Glob nhan dien file test; rong = dung mac dinh trong policy.js.
    testFilePatterns: [],
    // Anh nghiem thu phai chup bang mot trong cac provider nay (thiet bi that).
    // Rong = chap nhan moi provider.
    proofFrom: [],
    // Task sua loi (type=bugfix) phai co oracle do -> xanh trong result.json. Task cu (chua co type) duoc mien.
    oracle: false,
    // Thu muc doc quyen: KHONG giao song song hai task cung dung vao (vi du ["shared/"]).
    exclusiveDirs: [],
    // Regex them de nhan dien test "xanh gia" (bo mac dinh: src/evidence.js NOOP_RULES + SWALLOWED_RULES).
    testSuspectPatterns: [],
    // File rac o goc repo => canh bao (rong = bo mac dinh trong policy.js).
    strayFilePatterns: [],
  },
  // Tran so ky tu plan.md nhung vao prompt (phan con lai agent doc theo duong dan). Unity T0007: plan 38 KB lam agent chet context.
  promptPlanMaxBytes: 12000,
  // Cac stage test rieng (pm_run kind=test stage=<ten> skipReason=...), vi du { "unit": "./scripts/test-all.sh --unit" }.
  // Dung khi cong ngoai (kho public, thiet bi) dang do vi ly do ngoai code — van co evidence, khong chay tay ngoai tool.
  testStages: {},
  // Bang chung test phia PM (src/evidence.js): glob XML JUnit; rong = chi co stdout (weak).
  // Android/Gradle: ["**/build/test-results/**/TEST-*.xml"].
  testEvidence: {
    resultsGlob: [],
  },
  // Oracle do -> xanh do PM tu replay (pm_run kind=oracle, src/oracle.js).
  oracle: {
    // File HOAC THU MUC phu can chep vao worktree de build duoc: local.properties, lib nhi phan bi gitignore
    // (vi du "CarConnect/app/libs"), keystore. Thu muc chep de quy (bo build/, .gradle/, .DS_Store).
    copyToWorktree: [],
  },
  antigravity: {
    // strict = dispatch that bai neu workspace cua conversation khong phai goc project nay.
    workspaceCheck: 'strict',
    // Ghi de project id. BINH THUONG khong can khai: tu giai tu so dang ky
    // ~/.gemini/config/projects (xem src/projects.js). new-conversation BAT BUOC co id nay.
    projectId: null,
  },
};

function isPlainObject(v) {
  return v && typeof v === 'object' && !Array.isArray(v);
}

function deepMerge(base, over) {
  const out = { ...base };
  for (const [k, v] of Object.entries(over || {})) {
    out[k] = isPlainObject(v) && isPlainObject(base?.[k]) ? deepMerge(base[k], v) : v;
  }
  return out;
}

/** Tim goc project: di len tim .antigravity-pm.json, roi .git; khong thay thi lay chinh duong dan. */
export function resolveProjectRoot(input) {
  const start = path.resolve(input || process.env.ANTIGRAVITY_PM_PROJECT || process.cwd());
  // Cau hinh chung nam o HOME cung ten file, khong duoc tinh la goc project — neu khong,
  // moi project nam duoi HOME ma chua khai gi se bi keo goc ve thang HOME.
  const globalFile = realpathSafe(globalConfigPath());
  let dir = start;
  for (let i = 0; i < 12; i += 1) {
    const here = path.join(dir, CONFIG_NAME);
    if (fs.existsSync(here) && realpathSafe(here) !== globalFile) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  dir = start;
  for (let i = 0; i < 12; i += 1) {
    if (fs.existsSync(path.join(dir, '.git'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return start;
}

const KNOWN_KEYS = new Set(Object.keys(DEFAULT_CONFIG));

// Khoa chi co nghia cho DUNG mot project: de o cau hinh chung thi moi project deu bi dat
// cung ten / cung workspace id, nen bo qua kem canh bao thay vi am tham nhan.
const GLOBAL_IGNORED = [
  ['projectName', (o) => 'projectName' in o, (o) => { delete o.projectName; }],
  ['antigravity.projectId', (o) => isPlainObject(o.antigravity) && 'projectId' in o.antigravity,
    (o) => { o.antigravity = { ...o.antigravity }; delete o.antigravity.projectId; }],
];

/** Doc file cau hinh. File hong thi CANH BAO roi bo qua ca file, khong im lang nuot loi. */
function readConfigFile(file, warnings) {
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    warnings.push(`Cau hinh doc khong duoc (JSON hong) nen bo qua ca file: ${file} — ${e.message}`);
    return null;
  }
}

export function loadConfig(projectInput) {
  const root = resolveProjectRoot(projectInput);
  const file = path.join(root, CONFIG_NAME);
  const globalFile = globalConfigPath();
  const warnings = [];
  const raw = readConfigFile(file, warnings);
  // Project nam dung cho file cau hinh chung: chi tinh la cau hinh project, khong dem hai lan.
  let rawGlobal = realpathSafe(globalFile) === realpathSafe(file) ? null : readConfigFile(globalFile, warnings);
  if (rawGlobal) {
    for (const [name, has, drop] of GLOBAL_IGNORED) {
      if (!has(rawGlobal)) continue;
      warnings.push(`Bo qua "${name}" trong cau hinh chung ${globalFile}: khoa nay la cua rieng tung project`);
      rawGlobal = { ...rawGlobal };
      drop(rawGlobal);
    }
  }
  for (const [src, obj] of [[globalFile, rawGlobal], [file, raw]]) {
    for (const k of Object.keys(obj || {})) {
      if (!KNOWN_KEYS.has(k)) warnings.push(`Khoa la trong ${src}: "${k}" (bi bo qua)`);
    }
  }
  // Thu tu de len nhau: mac dinh <- cau hinh chung <- cau hinh project.
  // Object (vi du proof.providers) gop theo khoa; mang (rulesFiles, auditCommands) bi THAY THE han,
  // de project van bo duoc mot muc ma cau hinh chung khai.
  const cfg = deepMerge(deepMerge(DEFAULT_CONFIG, rawGlobal || {}), raw || {});
  cfg.projectRoot = root;
  cfg.configFile = raw ? file : null;
  cfg.globalConfigFile = rawGlobal ? globalFile : null;
  cfg.projectName = cfg.projectName || path.basename(root);
  cfg.stateRoot = path.resolve(root, cfg.stateDir);
  cfg.tasksRoot = path.join(cfg.stateRoot, 'tasks');
  // Trang thai CUA PM (task.json) nam ngoai repo: ~/.antigravity-pm/projects/<ten>-<hash goc project>/tasks/<id>/task.json.
  // Vi sao: agent ghi result.json ngay canh task.json va gitSnapshot an thu muc trang thai khoi pm_diff =>
  // agent sua duoc verdicts / runs[].evidence.ok / round / baseCommit ma khong ai thay.
  cfg.pmStateRoot = path.join(homeStateDir(), 'projects', projectStateKey(root));
  cfg.pmTasksRoot = path.join(cfg.pmStateRoot, 'tasks');
  cfg.warnings = warnings;

  if (!['forbid', 'allow'].includes(cfg.commitPolicy)) {
    warnings.push(`commitPolicy khong hop le: ${cfg.commitPolicy} -> dung "forbid"`);
    cfg.commitPolicy = 'forbid';
  }
  if (!Array.isArray(cfg.rulesFiles)) cfg.rulesFiles = [];
  if (!Array.isArray(cfg.auditCommands)) cfg.auditCommands = [];
  if (typeof cfg.proof?.require !== 'number' || cfg.proof.require < 0) cfg.proof.require = 1;
  return cfg;
}

// Cac khoa quyet dinh cong nghiem thu va lenh PM TU CHAY. `.antigravity-pm.json` nam trong repo => agent sua duoc
// (doi testCommand thanh `true`, proof.require=0, stateDir="src" de an thay doi khoi pm_diff, provider shell chay
// lenh tuy y). Vi the chup lai luc TAO TASK vao task.json (HOME) va task do chi dung ban chup (re-audit 23/09).
export const GATE_KEYS = ['stateDir', 'testCommand', 'testStages', 'auditCommands', 'runTimeoutMs', 'proof', 'mustHave', 'oracle', 'testEvidence'];

function pickGate(cfg) {
  const out = {};
  for (const k of GATE_KEYS) if (cfg[k] !== undefined) out[k] = JSON.parse(JSON.stringify(cfg[k]));
  return out;
}

export function gateConfigHash(cfg) {
  return createHash('sha256').update(JSON.stringify(pickGate(cfg))).digest('hex').slice(0, 16);
}

/** Ban chup cau hinh cong luc tao task (luu trong task.json). */
export function gateSnapshot(cfg) {
  return pickGate(cfg);
}

/** Cau hinh hieu luc cho mot task: ban chup cua task de len cau hinh dang doc (task cu chua co ban chup: giu nguyen). */
export function withGateSnapshot(cfg, task) {
  const snap = task?.gateConfig;
  if (!snap) return cfg;
  const out = { ...cfg, ...JSON.parse(JSON.stringify(snap)) };
  out.stateRoot = path.resolve(cfg.projectRoot, out.stateDir);
  out.tasksRoot = path.join(out.stateRoot, 'tasks');
  out.gateConfigDrift = gateConfigHash(cfg) !== gateConfigHash(out);
  if (out.gateConfigDrift) {
    out.warnings = [...(cfg.warnings || []), `Cau hinh cong trong ${cfg.configFile || '.antigravity-pm.json'} da DOI sau khi tao ${task.id} — task nay van dung ban chup luc tao (doi cau hinh that su => tao task moi)`];
  }
  return out;
}

/** Khoa thu muc trang thai PM cua mot project: ten de doc + sha256 cua realpath goc (hai repo cung ten khong dung nhau). */
export function projectStateKey(root) {
  const real = realpathSafe(root);
  return `${slug(path.basename(real), 32)}-${createHash('sha256').update(real).digest('hex').slice(0, 16)}`;
}

/** Cac file luat that su ton tai (de nhet vao prompt). */
export function existingRulesFiles(cfg) {
  return cfg.rulesFiles
    .map((r) => path.resolve(cfg.projectRoot, r))
    .filter((p) => fs.existsSync(p));
}
