// Anh xa duong dan project -> project id cua Antigravity.
//
// `new-conversation` BAT BUOC co project id (neu khong: "project_id is required when
// providing project_env_config"). Antigravity luu so dang ky project o
// ~/.gemini/config/projects/<uuid>.json, moi file co folderUri cua project do.
//
// Nho so dang ky nay ma ta chi dinh duoc DUNG project can giao viec, thay vi phu thuoc
// vao viec IDE dang mo cai nao.
import fs from 'node:fs';
import path from 'node:path';
import { readJsonIfExists, exists } from './util.js';

export const ENV_PROJECT_ID = 'ANTIGRAVITY_PROJECT_ID';

function registryDir() {
  return process.env.ANTIGRAVITY_PM_PROJECTS_DIR
    || path.join(process.env.HOME || '', '.gemini/config/projects');
}

/** Lay moi chuoi folderUri trong cay JSON (hinh dang resource co the doi giua cac ban). */
function collectFolderUris(node, out = [], depth = 0) {
  if (!node || typeof node !== 'object' || depth > 8) return out;
  for (const [k, v] of Object.entries(node)) {
    if (typeof v === 'string' && /^file:\/\//.test(v) && /uri$/i.test(k)) out.push(v);
    else collectFolderUris(v, out, depth + 1);
  }
  return out;
}

function uriToPath(uri) {
  try { return decodeURI(String(uri)).replace(/^file:\/\//, '').replace(/\/+$/, ''); } catch { return null; }
}

function realOrSelf(p) {
  try { return fs.realpathSync(p); } catch { return p; }
}

/** Doc toan bo so dang ky project cua Antigravity. */
export function listProjects() {
  const dir = registryDir();
  if (!exists(dir)) return [];
  const out = [];
  for (const name of fs.readdirSync(dir)) {
    if (!name.endsWith('.json')) continue;
    const data = readJsonIfExists(path.join(dir, name));
    if (!data) continue;
    const id = data.id || path.basename(name, '.json');
    const folders = collectFolderUris(data).map(uriToPath).filter(Boolean);
    out.push({
      id,
      name: data.name || id,
      folders,
      // Huu ich cho PM: EAGER/TURBO = agent tu chay lenh; nguoc lai se dung cho bam Accept.
      autoExecution: data.settings?.autoExecutionPolicy || null,
      artifactReview: data.settings?.artifactReviewMode || null,
      updatedAt: data.updatedAt || null,
      file: path.join(dir, name),
    });
  }
  return out;
}

/**
 * Tim project id cho 1 duong dan. Uu tien khop chinh xac, sau do khop thu muc cha
 * (project co the dang ky o goc monorepo trong khi ta lam viec o thu muc con).
 */
export function resolveProject(projectRoot) {
  const want = realOrSelf(path.resolve(projectRoot));
  const all = listProjects();
  const exact = all.find((p) => p.folders.some((f) => realOrSelf(f) === want));
  if (exact) return { ...exact, match: 'exact' };
  const parent = all.find((p) => p.folders.some((f) => {
    const r = realOrSelf(f);
    return want.startsWith(`${r}${path.sep}`);
  }));
  if (parent) return { ...parent, match: 'parent' };
  return null;
}

export class ProjectNotRegistered extends Error {
  constructor(projectRoot, known) {
    super(
      `Antigravity chua dang ky project "${projectRoot}" nen khong the mo hoi thoai `
      + '(new-conversation bat buoc co project id).',
    );
    this.name = 'ProjectNotRegistered';
    this.hint = 'Mo project nay trong app Antigravity 1 lan (de no tu dang ky), roi thu lai. '
      + `Project dang co: ${known.map((p) => p.name).join(', ') || '(khong co)'}. `
      + 'Hoac khai thang antigravity.projectId trong .antigravity-pm.json.';
  }
}

/** Project id dung cho 1 cfg: uu tien cau hinh, sau do so dang ky. */
export function requireProjectId(cfg) {
  if (cfg.antigravity?.projectId) return { id: cfg.antigravity.projectId, name: '(khai trong cau hinh)', match: 'config' };
  const found = resolveProject(cfg.projectRoot);
  if (!found) throw new ProjectNotRegistered(cfg.projectRoot, listProjects());
  return found;
}
