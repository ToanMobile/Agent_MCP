// Cau hinh hai tang: cau hinh chung ~/.antigravity-pm.json lam mac dinh cho MOI project,
// roi <project>/.antigravity-pm.json ghi de len. Repo MCP nay la CONG CU dung chung; moi
// project tu khai testCommand / auditCommands / cach chup anh nghiem thu cua rieng no.
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { readJsonIfExists } from './util.js';

export const CONFIG_NAME = '.antigravity-pm.json';

/** Duong dan cau hinh chung. ANTIGRAVITY_PM_GLOBAL_CONFIG de tro sang cho khac (test dung). */
export function globalConfigPath() {
  return process.env.ANTIGRAVITY_PM_GLOBAL_CONFIG || path.join(os.homedir(), CONFIG_NAME);
}

/** realpath nhung khong nem loi: duong dan chua ton tai thi tra ve chinh no. */
function realpathSafe(p) {
  try { return fs.realpathSync(p); } catch { return path.resolve(p); }
}

export const DEFAULT_CONFIG = {
  // Ten hien thi cua project (chi de bao cao cho dep).
  projectName: null,
  // Model Antigravity mac dinh: flash_lite | flash | pro
  defaultModel: 'pro',
  // Thu muc luu trang thai task, tinh tu goc project.
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

export function loadConfig(projectInput) {
  const root = resolveProjectRoot(projectInput);
  const file = path.join(root, CONFIG_NAME);
  const globalFile = globalConfigPath();
  const raw = readJsonIfExists(file);
  const rawGlobal = realpathSafe(globalFile) === realpathSafe(file) ? null : readJsonIfExists(globalFile);
  const warnings = [];
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

/** Cac file luat that su ton tai (de nhet vao prompt). */
export function existingRulesFiles(cfg) {
  return cfg.rulesFiles
    .map((r) => path.resolve(cfg.projectRoot, r))
    .filter((p) => fs.existsSync(p));
}
