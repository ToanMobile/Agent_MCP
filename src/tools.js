// Bo tool MCP: Claude Code (Leader/PM) dieu phoi Antigravity (Engineer) theo dung quy trinh.
import fs from 'node:fs';
import path from 'node:path';
import { loadConfig, existingRulesFiles, CONFIG_NAME } from './config.js';
import {
  createTask, loadTask, listTasks, save, setPhase, recordVerdict, recordRun, recordProof,
  recordDispatch, markRework, accept, gate, freshness, contractPaths, addHistory, PHASES,
} from './tasks.js';
import {
  newConversation, sendMessage, getConversationMetadata, conversationProgress, MODELS,
} from './agentapi.js';
import { discover, agentapiPath } from './discover.js';
import {
  buildPlanPrompt, buildImplementMessage, buildReworkMessage, buildAuditPrompt, buildProofRequestMessage,
} from './prompt.js';
import { captureProof, describeProviders } from './proof.js';
import { renderReport } from './report.js';
import { runShell, writeFileAtomic, ensureDir, exists, tail, truncate, nowIso } from './util.js';

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

function gateLines(g) {
  return g.ok
    ? 'CONG NGHIEM THU: DAT (du bang chung).'
    : `CONG NGHIEM THU: CHUA DAT. Con thieu:\n- ${g.missing.join('\n- ')}`;
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

function saveOutgoing(cfg, task, name, text) {
  const p = contractPaths(cfg, task);
  const file = path.join(ensureDir(p.logsDir), `${name}.md`);
  writeFileAtomic(file, text);
  return file;
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
      L.push(`Cau hinh: ${cfg.configFile || `(chua co ${CONFIG_NAME} — dang dung mac dinh)`}`);
      for (const w of cfg.warnings) L.push(`  ! ${w}`);
      L.push(`Thu muc trang thai: ${cfg.stateRoot}`);
      L.push(`Model mac dinh: ${cfg.defaultModel}`);
      L.push(`Lenh test: ${cfg.testCommand || '(CHUA KHAI — pm_run kind=test se bao loi, cong nghiem thu se khong bao gio dat)'}`);
      L.push(`Lenh audit: ${cfg.auditCommands.length ? cfg.auditCommands.join(' ; ') : '(chua khai)'}`);
      L.push(`File luat se nhet vao prompt: ${existingRulesFiles(cfg).join(', ') || '(khong thay file nao)'}`);
      const provs = describeProviders(cfg);
      L.push(`Cach chup anh nghiem thu: ${provs.length ? provs.map((p) => `${p.name}(${p.type})`).join(', ') : '(chua khai — van co the dung sourceFile de nhan anh do agent tu chup)'}`);
      L.push(`So anh toi thieu de nghiem thu: ${cfg.proof.require}`);
      L.push('');
      L.push(`agentapi: ${agentapiPath() || 'KHONG TIM THAY'}`);
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
      L.push('LUU Y QUAN TRONG: `new-conversation` khong co tham so chon workspace — no mo hoi thoai TRONG PROJECT MA ANTIGRAVITY DANG MO.');
      L.push('Vi vay: mo dung project trong Antigravity truoc khi pm_dispatch (pm_dispatch se tu kiem tra va bao do neu lech).');

      if (args?.ping) {
        L.push('');
        L.push('--- ping: mo 1 hoi thoai thu ---');
        try {
          const { conversationId } = await newConversation({
            model: 'flash_lite',
            title: '[PM] ping duong day',
            prompt: 'Day la phep thu duong day tu Claude Code. Tra loi dung 1 tu: PONG. '
              + 'KHONG goi bat ky tool nao, KHONG doc file, KHONG sua file, KHONG chay lenh.',
          });
          L.push(`Tao hoi thoai: OK — ${conversationId}`);
          const md = await getConversationMetadata(conversationId);
          L.push(`Workspace cua hoi thoai: ${md.workspace || '(khong ro)'}${md.branch ? ` · nhanh ${md.branch}` : ''}`);
          L.push(`Khop voi project dang hoi: ${md.workspace && exists(md.workspace) && fs.realpathSync(md.workspace) === fs.realpathSync(cfg.projectRoot) ? 'CO' : 'KHONG — hay mo dung project trong Antigravity'}`);
          await sendMessage({ conversationId, content: 'Phep thu tin nhan tiep theo. Tra loi dung 1 tu: PONG2. Khong dung tool.' });
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
        model: { type: 'string', enum: MODELS },
      },
      required: ['title', 'brief', 'definitionOfDone'],
    },
    async handler(args) {
      const cfg = ctx(args);
      const a = validate(this.inputSchema, args);
      const task = createTask(cfg, a);
      const p = contractPaths(cfg, task);
      return [
        `Da mo task ${task.id}: ${task.title}`,
        `Ho so: ${p.dir}`,
        `Trang thai: ${task.phase} / ${task.state}`,
        '',
        'Buoc tiep: pm_dispatch kind=plan de Antigravity lap ke hoach (chua duoc sua code).',
      ].join('\n');
    },
  },

  {
    name: 'pm_status',
    description: 'Khong taskId: liet ke task. Co taskId: tien do, bang chung con thieu, hoi thoai con dong tinh khong.',
    inputSchema: { type: 'object', properties: { ...PROJECT_PROP, ...TASK_PROP } },
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
      const g = gate(cfg, task);
      const L = [];
      L.push(`${task.id} — ${task.title}`);
      L.push(`Giai doan: ${task.phase} · trang thai: ${task.state} · vong: ${task.round}`);
      L.push(`Hoi thoai: ${task.conversationId || '(chua giao)'}${task.auditConversationId ? ` · audit: ${task.auditConversationId}` : ''}`);
      if (task.conversationId) {
        const prog = conversationProgress(task.conversationId);
        if (prog.found) {
          const stalled = prog.idleMinutes >= (cfg.stallMinutes || 12);
          L.push(`Dong tinh cuoi cua agent: ${prog.lastActivityAt} (im ${prog.idleMinutes} phut)${stalled ? ' — CO THE DANG TREO hoac dang doi ban bam Accept trong Antigravity' : ''}`);
        } else {
          L.push('Chua thay CSDL hoi thoai — agent co the chua bat dau.');
        }
      }
      L.push('');
      L.push(`plan.md: ${fresh.planExists ? 'co' : 'chua co'}`);
      L.push(`result.json: ${fresh.resultExists ? (fresh.resultFresh ? `co (ghi luc ${fresh.resultMtime})` : `CU (truoc lan rework ${task.lastReworkAt})`) : 'chua co'}`);
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
      if (exists(agentAudit)) L.push(`audit-agent.json: co (auditor doc lap da bao cao)`);
      L.push('');
      L.push(`Ket luan: plan=${task.verdicts?.plan?.verdict || '-'} audit=${task.verdicts?.audit?.verdict || '-'} review=${task.verdicts?.review?.verdict || '-'}`);
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
        kind: { type: 'string', enum: ['plan', 'implement', 'audit', 'proof', 'custom'] },
        notes: { type: 'string', description: 'Ghi chu PM (implement)' },
        message: { type: 'string', description: 'custom: noi dung · proof: can chung minh gi · audit: trong tam' },
        model: { type: 'string', enum: MODELS },
        force: { type: 'boolean', description: 'Bo qua kiem tra giai doan' },
      },
      required: ['taskId', 'kind'],
    },
    async handler(args) {
      const { cfg, task } = withTask(args);
      validate(this.inputSchema, args);
      const kind = args.kind;
      const L = [];

      if (kind === 'plan') {
        if (task.conversationId && !args.force) {
          fail(`Task nay da co hoi thoai ${task.conversationId}. Dung pm_dispatch kind=implement/custom, hoac force=true de mo hoi thoai moi.`);
        }
        const prompt = buildPlanPrompt(cfg, task);
        const promptFile = saveOutgoing(cfg, task, `prompt-plan-r${task.round}`, prompt);
        const { conversationId } = await newConversation({
          prompt, model: args.model || task.model, title: `[PM] ${task.id} · PLAN · ${task.title}`,
        });
        task.conversationId = conversationId;
        task.state = 'awaiting_agent';
        recordDispatch(cfg, task, { kind: 'plan', conversationId, model: args.model || task.model, promptFile });
        L.push(`Da giao PLAN cho Antigravity. conversationId=${conversationId}`);
        const check = await ensureWorkspaceMatches(cfg, conversationId);
        if (!check.ok) {
          const msg = `Hoi thoai duoc mo trong workspace "${check.got || '(khong ro)'}" chu KHONG phai "${check.want}".`;
          if (cfg.antigravity.workspaceCheck === 'strict') {
            task.state = 'blocked';
            addHistory(task, 'system', 'workspace_mismatch', msg);
            save(cfg, task);
            fail(`${msg}\nAntigravity mo hoi thoai trong project dang mo tren IDE. Hay mo "${check.want}" trong Antigravity roi chay lai pm_dispatch kind=plan force=true.\n(Hoi thoai vua tao: ${conversationId} — nen bo/dong trong IDE.)`);
          }
          L.push(`CANH BAO: ${msg}`);
        } else {
          L.push(`Workspace khop: ${check.got}${check.md.branch ? ` (nhanh ${check.md.branch})` : ''}`);
        }
        L.push(`Prompt da luu: ${promptFile}`);
        L.push('Buoc tiep: doi vai phut roi pm_task_status. Khi co plan.md thi PM DOC PLAN, sau do pm_verdict kind=plan.');
        return L.join('\n');
      }

      if (!task.conversationId && kind !== 'audit') fail('Task chua co hoi thoai. Chay pm_dispatch kind=plan truoc.');

      if (kind === 'implement') {
        if (task.verdicts?.plan?.verdict !== 'pass' && !args.force) {
          fail('Chua duyet plan. PM phai doc plan.md roi pm_verdict kind=plan verdict=pass (hoac force=true).');
        }
        const fresh = freshness(cfg, task);
        if (!fresh.planExists && !args.force) fail('Chua thay plan.md — agent chua lap ke hoach xong.');
        const msg = buildImplementMessage(cfg, task, args.notes || '');
        const promptFile = saveOutgoing(cfg, task, `prompt-implement-r${task.round}`, msg);
        await sendMessage({ conversationId: task.conversationId, content: msg });
        setPhase(cfg, task, 'IMPLEMENT', 'pm', 'plan da duyet');
        task.state = 'awaiting_agent';
        recordDispatch(cfg, task, { kind: 'implement', promptFile });
        return [
          `Da duyet plan va yeu cau trien khai (${task.id}).`,
          `Noi dung da gui: ${promptFile}`,
          'LUU Y: tin nhan co the chi duoc agent doc o luot ke tiep. Neu 5-10 phut khong thay dong tinh, mo Antigravity xem co dang doi bam Accept khong.',
        ].join('\n');
      }

      if (kind === 'audit') {
        const prompt = buildAuditPrompt(cfg, task, args.message || '');
        const promptFile = saveOutgoing(cfg, task, `prompt-audit-r${task.round}`, prompt);
        const { conversationId } = await newConversation({
          prompt, model: args.model || task.model, title: `[PM] ${task.id} · AUDIT doc lap`,
        });
        task.auditConversationId = conversationId;
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
        await sendMessage({ conversationId: task.conversationId, content: msg });
        recordDispatch(cfg, task, { kind: 'proof', promptFile });
        return `Da yeu cau agent chup anh nghiem thu. Khi co anh, dung pm_capture_proof voi sourceFile=<duong dan anh> de PM xac nhan va dua vao ho so.`;
      }

      // custom
      if (!args.message) fail('kind=custom can "message".');
      await sendMessage({ conversationId: task.conversationId, content: args.message });
      const promptFile = saveOutgoing(cfg, task, `prompt-custom-${Date.now()}`, args.message);
      recordDispatch(cfg, task, { kind: 'custom', promptFile });
      return 'Da gui tin nhan cho agent.';
    },
  },

  {
    name: 'pm_message',
    description: 'Gui tin nhan vao hoi thoai cua task.',
    inputSchema: {
      type: 'object',
      properties: { ...PROJECT_PROP, ...TASK_PROP, content: { type: 'string' }, toAudit: { type: 'boolean', description: 'Gui vao hoi thoai audit' } },
      required: ['taskId', 'content'],
    },
    async handler(args) {
      const { cfg, task } = withTask(args);
      const cid = args.toAudit ? task.auditConversationId : task.conversationId;
      if (!cid) fail(args.toAudit ? 'Task chua co hoi thoai audit.' : 'Task chua co hoi thoai.');
      await sendMessage({ conversationId: cid, content: args.content });
      addHistory(task, 'pm', 'message', args.content);
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
      recordVerdict(cfg, task, {
        kind: args.kind, verdict: args.verdict, findings: args.findings || [], notes: args.notes || '',
      });
      const L = [`Da ghi ket luan ${args.kind} = ${args.verdict} cho ${task.id} (vong ${task.round}).`];
      if (args.verdict === 'pass') {
        const next = { plan: 'IMPLEMENT', audit: 'REVIEW', review: 'TEST' }[args.kind];
        if (args.kind === 'plan') L.push('Buoc tiep: pm_dispatch kind=implement.');
        else {
          setPhase(cfg, task, next, 'pm', `${args.kind} dat`);
          L.push(`Giai doan -> ${next}.`);
          if (next === 'TEST') L.push('Buoc tiep: pm_run kind=test.');
          if (next === 'REVIEW') L.push('Buoc tiep: doc pm_diff roi pm_verdict kind=review.');
        }
      } else {
        L.push('Buoc tiep: pm_rework de tra viec cho agent (kem findings).');
      }
      L.push(gateLines(gate(cfg, task)));
      return L.join('\n');
    },
  },

  {
    name: 'pm_run',
    description: 'PM tu chay test/audit, ghi exit code that vao ho so. Log day du ra file, chi tra ve duoi log.',
    inputSchema: {
      type: 'object',
      properties: {
        ...PROJECT_PROP,
        ...TASK_PROP,
        kind: { type: 'string', enum: ['test', 'audit'] },
        command: { type: 'string', description: 'Ghi de lenh trong cau hinh' },
        timeoutMs: { type: 'number' },
      },
      required: ['taskId', 'kind'],
    },
    async handler(args) {
      const { cfg, task } = withTask(args);
      validate(this.inputSchema, args);
      const commands = args.command
        ? [args.command]
        : (args.kind === 'test'
          ? (cfg.testCommand ? [cfg.testCommand] : [])
          : cfg.auditCommands);
      if (commands.length === 0) {
        fail(args.kind === 'test'
          ? `Chua khai "testCommand" trong ${CONFIG_NAME} va khong truyen command. Khong the ghi nhan test.`
          : `Chua khai "auditCommands" trong ${CONFIG_NAME} va khong truyen command.`);
      }
      const p = contractPaths(cfg, task);
      const L = [];
      for (const cmd of commands) {
        const r = await runShell(cmd, {
          cwd: cfg.projectRoot,
          timeoutMs: args.timeoutMs || cfg.runTimeoutMs,
        });
        const logFile = path.join(ensureDir(p.logsDir), `${args.kind}-r${task.round}-${Date.now()}.log`);
        writeFileAtomic(logFile, `$ ${cmd}\n(cwd ${cfg.projectRoot})\nexit=${r.code} timedOut=${r.timedOut}\n\n--- stdout ---\n${r.stdout}\n--- stderr ---\n${r.stderr}\n`);
        recordRun(cfg, task, {
          kind: args.kind, command: cmd, exitCode: r.code, durationMs: r.durationMs, timedOut: r.timedOut, logFile,
        });
        L.push(`$ ${cmd}`);
        L.push(`exit=${r.code}${r.timedOut ? ' (QUA HAN)' : ''} · ${Math.round(r.durationMs / 1000)}s · log day du: ${logFile}`);
        // Xanh thi chi can vai dong cuoi; do thi moi can nhieu de chan doan.
        // (Log day du luon nam trong file — Read khi thuc su can, dung do het vao context.)
        const lines = r.code === 0 && !r.timedOut ? 6 : 40;
        L.push(tail(`${r.stdout}\n${r.stderr}`.trim(), lines));
        L.push('');
      }
      L.push(gateLines(gate(cfg, task)));
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
      const st = await runShell('git status --porcelain=v1', { cwd: cfg.projectRoot, timeoutMs: 60000 });
      const stat = await runShell(`git --no-pager diff --stat${ps}`, { cwd: cfg.projectRoot, timeoutMs: 120000 });
      const L = [];
      L.push(`Project: ${cfg.projectRoot}`);
      L.push('--- git status ---');
      L.push(truncate(st.stdout || '(sach)', 4000));
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
        const task = loadTask(cfg, args.taskId);
        const fresh = freshness(cfg, task);
        if (fresh.result?.files_changed?.length) {
          L.push('');
          L.push('--- Doi chieu voi khai bao cua agent ---');
          const claimed = fresh.result.files_changed.map((f) => f.replace(/^\.\//, ''));
          const real = (st.stdout || '').split('\n').map((l) => l.slice(3).trim()).filter(Boolean);
          const notClaimed = real.filter((f) => !claimed.some((c) => f.includes(c) || c.includes(f)));
          const notTouched = claimed.filter((c) => !real.some((f) => f.includes(c) || c.includes(f)));
          L.push(`Agent khai sua ${claimed.length} file. Cay lam viec dang co ${real.length} file thay doi.`);
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
        sourceFile: { type: 'string', description: 'Duong dan anh co san' },
        serial: { type: 'string', description: 'Ghi de serial adb' },
        region: { type: 'string', description: 'Vung macOS x,y,w,h' },
      },
      required: ['taskId', 'label'],
    },
    async handler(args) {
      const { cfg, task } = withTask(args);
      validate(this.inputSchema, args);
      const p = contractPaths(cfg, task);
      const shot = await captureProof(cfg, {
        proofDir: p.proofDir,
        label: args.label,
        providerName: args.provider,
        sourceFile: args.sourceFile,
        serial: args.serial,
        region: args.region,
      });
      recordProof(cfg, task, { label: args.label, provider: shot.provider, file: shot.file, bytes: shot.bytes, width: shot.width });
      if (task.phase === 'TEST') setPhase(cfg, task, 'PROOF', 'pm', 'da co anh nghiem thu');
      const text = [
        `Da luu anh nghiem thu: ${shot.file}`,
        `Cach chup: ${shot.provider} · ${Math.round(shot.bytes / 1024)} KB${shot.width ? ` · ${shot.width}px` : ''}`,
        ...shot.warnings.map((w) => `CANH BAO: ${w}`),
        '',
        gateLines(gate(cfg, task)),
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
      const failedRuns = (task.runs || []).filter((r) => r.round === task.round && r.exitCode !== 0);
      markRework(cfg, task, `${findings.length} phat hien: ${findings[0]}`);
      const msg = buildReworkMessage(cfg, task, { findings, notes: args.notes || '', failedRuns });
      const promptFile = saveOutgoing(cfg, task, `prompt-rework-r${task.round}`, msg);
      if (task.conversationId) {
        await sendMessage({ conversationId: task.conversationId, content: msg });
        recordDispatch(cfg, task, { kind: 'rework', promptFile });
      }
      return [
        `Da tra viec ${task.id} (nay la vong ${task.round}).`,
        'Da huy ket luan audit + review cua vong truoc; test/anh cu khong con tinh nua.',
        `Noi dung da gui: ${promptFile}`,
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
      const g = gate(cfg, task);
      if (!g.ok) {
        const rep = renderReport(cfg, task, { summary: args.summary || '' });
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
      accept(cfg, task);
      const rep = renderReport(cfg, task, { summary: args.summary || '' });
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
      const rep = renderReport(cfg, task, { summary: args.summary || '' });
      const head = [`Bao cao: ${rep.file}`, gateLines(rep.gate)];
      // Mac dinh KHONG do ca bao cao vao context — day duong dan, can thi Read.
      return args?.includeMarkdown === true ? `${head.join('\n')}\n\n${rep.markdown}` : head.join('\n');
    },
  },
];

export const TOOLS_BY_NAME = new Map(TOOLS.map((t) => [t.name, t]));
