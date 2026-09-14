// Vo boc mong quanh `agentapi` cua Antigravity (CLI noi bo, KHONG duoc Google tai lieu hoa).
// Chi co 3 lenh: new-conversation / send-message / get-conversation-metadata.
// Moi thay doi giao dien cua no phai no O DAY va no THAT TO, khong am tham fallback.
import fs from 'node:fs';
import path from 'node:path';
import { run, redact, truncate } from './util.js';
import { discover, forgetCache, AntigravityUnavailable, ENV_ADDRESS, ENV_TOKEN } from './discover.js';
import { ENV_PROJECT_ID } from './projects.js';

export const MODELS = ['flash_lite', 'flash', 'pro'];

export class AgentApiError extends Error {
  constructor(message, detail) {
    super(message);
    this.name = 'AgentApiError';
    this.detail = detail;
  }
}

function connEnv(conn, extra = {}) {
  return { [ENV_ADDRESS]: conn.address, [ENV_TOKEN]: conn.secret, ...extra };
}

async function call(args, { timeoutMs = 180000, retryOnRpcError = true, projectId = null } = {}) {
  // new-conversation bat buoc co project id; thieu no server bao
  // "project_id is required when providing project_env_config".
  const extraEnv = projectId ? { [ENV_PROJECT_ID]: projectId } : {};
  let conn = await discover();
  let r = await run(conn.agentapi, args, { timeoutMs, env: connEnv(conn, extraEnv) });
  let parsed = parseJson(r.stdout);

  const rpcBroken = r.code !== 0 || /rpc error|Unauthenticated|connection (error|reset)/i.test(`${r.stdout}${r.stderr}`);
  if (rpcBroken && retryOnRpcError) {
    // IDE co the vua khoi dong lai => cong/khoa phien doi. Do lai 1 lan roi thoi.
    forgetCache();
    conn = await discover({ force: true });
    r = await run(conn.agentapi, args, { timeoutMs, env: connEnv(conn, extraEnv) });
    parsed = parseJson(r.stdout);
  }

  const clean = (s) => truncate(redact(s, [conn.secret]), 4000);
  if (r.timedOut) throw new AgentApiError(`agentapi ${args[0]} qua han ${timeoutMs}ms`, clean(r.stderr));
  if (parsed && parsed.error) throw new AgentApiError(`agentapi ${args[0]} bao loi: ${clean(String(parsed.error))}`, clean(r.stderr));
  if (r.code !== 0) throw new AgentApiError(`agentapi ${args[0]} ket thuc voi exit ${r.code}`, clean(`${r.stdout}\n${r.stderr}`));
  if (!parsed) throw new AgentApiError(`agentapi ${args[0]} tra ve thu khong phai JSON (CLI noi bo co the da doi)`, clean(r.stdout));
  return { parsed, raw: clean(r.stdout), address: conn.address };
}

function parseJson(s) {
  const t = String(s || '').trim();
  if (!t) return null;
  try { return JSON.parse(t); } catch { /* thu cach khac */ }
  const i = t.indexOf('{');
  const j = t.lastIndexOf('}');
  if (i >= 0 && j > i) {
    try { return JSON.parse(t.slice(i, j + 1)); } catch { return null; }
  }
  return null;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Lan tim bat ky khoa ket thuc bang conversationId / conversation_id trong cay JSON. */
export function findConversationId(obj, depth = 0) {
  if (!obj || typeof obj !== 'object' || depth > 8) return null;
  for (const [k, v] of Object.entries(obj)) {
    if (typeof v === 'string' && UUID_RE.test(v) && /conversation_?id$/i.test(k)) return v;
  }
  for (const v of Object.values(obj)) {
    const found = findConversationId(v, depth + 1);
    if (found) return found;
  }
  // Cuoi cung: bat ky UUID nao xuat hien trong cay (CLI noi bo co the doi ten khoa).
  if (depth === 0) return findAnyUuid(obj);
  return null;
}

function findAnyUuid(obj, depth = 0) {
  if (!obj || typeof obj !== 'object' || depth > 8) return null;
  for (const v of Object.values(obj)) {
    if (typeof v === 'string' && UUID_RE.test(v)) return v;
    const found = findAnyUuid(v, depth + 1);
    if (found) return found;
  }
  return null;
}

export async function newConversation({ prompt, model = 'pro', title, profile, projectId, timeoutMs = 180000 }) {
  if (!prompt || !String(prompt).trim()) throw new AgentApiError('prompt rong');
  if (model && !MODELS.includes(model)) throw new AgentApiError(`model khong hop le: ${model} (chi nhan ${MODELS.join(', ')})`);
  const args = ['new-conversation'];
  if (model) args.push(`--model=${model}`);
  if (title) args.push(`--title=${title}`);
  if (profile) args.push(`--profile=${profile}`);
  args.push(String(prompt));
  const { parsed, raw } = await call(args, { timeoutMs, projectId });
  const conversationId = findConversationId(parsed);
  if (!conversationId) throw new AgentApiError('Tao conversation xong nhung khong doc ra conversationId', raw);
  return { conversationId, raw, parsed };
}

export async function sendMessage({ conversationId, content, title, projectId, timeoutMs = 120000 }) {
  if (!conversationId) throw new AgentApiError('thieu conversationId');
  if (!content || !String(content).trim()) throw new AgentApiError('noi dung tin nhan rong');
  const args = ['send-message'];
  if (title) args.push(`--title=${title}`);
  args.push(String(conversationId), String(content));
  const { parsed, raw } = await call(args, { timeoutMs, projectId });
  return { ok: true, raw, parsed };
}

export async function getConversationMetadata(conversationId) {
  const { parsed, raw } = await call(['get-conversation-metadata', String(conversationId)], { timeoutMs: 60000 });
  const md = parsed?.response?.conversationMetadata?.metadata || null;
  const ws = md?.workspaces?.[0] || null;
  return {
    found: Boolean(md),
    workspace: ws?.workspaceFolderAbsoluteUri
      ? decodeURI(ws.workspaceFolderAbsoluteUri).replace(/^file:\/\//, '')
      : null,
    branch: ws?.branchName || null,
    repo: ws?.repository?.computedName || null,
    createdAt: md?.createdAt || null,
    projectId: md?.projectId || null,
    raw,
  };
}

/**
 * Do tien trien cua 1 hoi thoai bang cach STAT file CSDL cua no.
 * CO Y KHONG mo file: noi dung buoc lam la protobuf rieng cua Antigravity, va ta khong
 * doc hoi thoai cua nguoi dung. Chi can biet "co dong tinh gan day khong".
 */
export function conversationProgress(conversationId) {
  const home = process.env.HOME || '';
  const dirs = [
    path.join(home, '.gemini/antigravity/conversations'),
    path.join(home, '.gemini/antigravity-ide/conversations'),
  ];
  let newest = 0;
  let file = null;
  for (const d of dirs) {
    for (const suffix of ['.db', '.db-wal']) {
      const p = path.join(d, `${conversationId}${suffix}`);
      try {
        const st = fs.statSync(p);
        if (st.mtimeMs > newest) { newest = st.mtimeMs; file = p; }
      } catch { /* khong co thi thoi */ }
    }
  }
  // Transcript cua brain la tin hieu that hon CSDL (de xuat Unity 14/09/2026): stat mtime.
  const tr = transcriptPath(conversationId);
  try {
    const st = fs.statSync(tr);
    if (st.mtimeMs > newest) { newest = st.mtimeMs; file = tr; }
  } catch { /* khong co */ }
  if (!newest) return { found: false, lastActivityAt: null, idleMinutes: null, file: null };
  return {
    found: true,
    lastActivityAt: new Date(newest).toISOString(),
    idleMinutes: Math.round((Date.now() - newest) / 60000),
    file,
  };
}

function transcriptPath(conversationId) {
  return path.join(process.env.HOME || '', '.gemini/antigravity/brain', conversationId, '.system_generated/logs/transcript.jsonl');
}

/**
 * Loi stream trong transcript: dem dong `"type":"ERROR_MESSAGE"` o DUOI file (64 KB cuoi) va xem buoc cuoi co phai loi khong.
 * NGOAI LE co chu dich cua luat "khong mo noi dung hoi thoai": chi lay hai truong type + created_at, KHONG tra ve content.
 * Vi sao (Unity T0007, 14/09/2026): 3/6 vong phan bien treo vi "The stream was interrupted" — stallMinutes chi dem im lang, khong thay.
 */
export function transcriptErrors(conversationId) {
  const tr = transcriptPath(conversationId);
  let fd;
  try {
    const st = fs.statSync(tr);
    const len = Math.min(st.size, 65536);
    const buf = Buffer.alloc(len);
    fd = fs.openSync(tr, 'r');
    fs.readSync(fd, buf, 0, len, st.size - len);
    const lines = buf.toString('utf8').split('\n').filter((l) => l.trim());
    const errs = lines.filter((l) => l.includes('"type":"ERROR_MESSAGE"'));
    const last = lines[lines.length - 1] || '';
    const at = (l) => /"created_at":"([^"]+)"/.exec(l)?.[1] || null;
    return {
      found: true,
      errorCount: errs.length,
      lastErrorAt: errs.length ? at(errs[errs.length - 1]) : null,
      lastStepIsError: last.includes('"type":"ERROR_MESSAGE"'),
    };
  } catch {
    return { found: false, errorCount: 0, lastErrorAt: null, lastStepIsError: false };
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

export { AntigravityUnavailable };
