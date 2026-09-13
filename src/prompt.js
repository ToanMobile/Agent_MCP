// Soan prompt giao viec cho Antigravity.
//
// Moi prompt deu mang theo HOP DONG BAO CAO: agent phai ghi plan.md / result.json vao
// dung thu muc task. Nho hop dong nay ma PM khong can giai ma protobuf trong CSDL
// hoi thoai cua Antigravity — chi can doc file.
import path from 'node:path';
import fs from 'node:fs';
import { existingRulesFiles } from './config.js';
import { contractPaths } from './tasks.js';
import { mustHaveLines } from './policy.js';

function rulesBlock(cfg) {
  const files = existingRulesFiles(cfg);
  if (files.length === 0) return '';
  return [
    '## Luat cua project — DOC TRUOC KHI LAM, KHONG DUOC BO QUA',
    ...files.map((f) => `- ${f}`),
    '',
  ].join('\n');
}

// Rule lay tu AGENTS.md cua project that: agent bao cao tron tru ma khong co gi chong lung
// la kieu hong dat nhat, vi PM khong co cach nao phat hien bang mat thuong.
function noFabricationBlock() {
  return [
    '## Cam bia — bao cao sai con te hon khong bao cao gi',
    '- Moi con so, version, URL, ten loi, duong dan file:dong ban viet ra phai lay tu LENH DA CHAY hoac FILE DA DOC trong may nay. Khong nho, khong doan.',
    '- "Da chay X" / "da sua Y" chi duoc viet khi lenh do that su da chay va ban thay ket qua that cua no. Chay xong exit 0 chi chung minh LENH da chay, chua chung minh KET QUA dung.',
    '- Cau phu dinh ("cho khac khong bi anh huong", "chi dung o day", "khong con noi nao goi ham nay") phai search truoc, roi noi dung pham vi da search.',
    '- Khong biet thi ghi thang: "toi khong co du lieu nay — can <lenh/thiet bi gi>". CAM lap lo bang "co le", "khoang", "hinh nhu", "chac la".',
    '',
  ].join('\n');
}

const PLAN_MAX = 24000;

/** Toan van plan.md do PM viet — agent chua tung thay no, phai nhet vao prompt. */
function planText(cfg, task) {
  const f = contractPaths(cfg, task).plan;
  if (!fs.existsSync(f)) return '';
  const t = fs.readFileSync(f, 'utf8');
  return t.length <= PLAN_MAX ? t : `${t.slice(0, PLAN_MAX)}\n… [plan dai, cat bot — doc ban day du tai ${f}]`;
}

function planBlock(cfg, task) {
  const t = planText(cfg, task);
  if (!t) return '';
  return [
    '## KE HOACH CUA PM — lam dung theo day, khong tu doi huong',
    `(ban day du: ${contractPaths(cfg, task).plan})`,
    '',
    t,
    '',
    '- Thay ke hoach sai fact so voi code that: GHI RA trong result.json -> "notes" kem file:dong roi bao PM, DUNG im lang lam theo va cung dung tu doi huong.',
    '',
  ].join('\n');
}

function dodBlock(task, cfg) {
  const must = cfg ? mustHaveLines(cfg) : [];
  return [
    '## Dinh nghia HOAN THANH (Definition of Done) — PM se nghiem thu dung theo day',
    ...task.definitionOfDone.map((d, i) => `${i + 1}. ${d}`),
    ...(must.length ? ['', '### Luat bat buoc cua du an (ap cho MOI task, khong co ngoai le)', ...must.map((l) => `- ${l}`)] : []),
    '',
  ].join('\n');
}

function guardrails(cfg) {
  const lines = [
    '## Rang buoc bat buoc',
    '- CHI sua nhung file thuoc pham vi task nay. Cam "tien tay" don dep / refactor module khac.',
    '- Khong xoa, khong lam mem cac dieu kien bao ve (guard) dang co san — neu thay can doi, GHI RA de PM quyet, dung tu y sua.',
    '- Khong them thu vien moi neu chua co trong plan da duoc PM duyet.',
  ];
  if (cfg.commitPolicy === 'forbid') {
    lines.push('- TUYET DOI KHONG chay `git commit`, `git push`, `git reset --hard`, `git checkout -- .` hay bat ky lenh lam mat thay doi dang co trong cay lam viec. PM se tu commit.');
  }
  lines.push('- Truoc khi doi signature cua ham/lop, thanh vien cua lop cha / interface, API cong khai hay object dung chung: '
    + 'liet ke HET noi dang dung no (grep ca thu muc test — src/test, tests/ hay bi bo sot) va ghi vao result.json -> "notes". '
    + 'Khong liet ke duoc thi dung sua, bao PM.');
  lines.push('- Test dang do SAU KHI ban sua: mac dinh coi la BAN vua lam hong. CAM sua test / assertion / mock cho no xanh tro lai. '
    + 'Chi duoc doi test khi chung minh duoc ky vong cu la sai (dan spec, bug report, hoac yeu cau cua PM) — va phai ghi ly do vao result.json.');
  lines.push('- Sua di sua lai CUNG MOT FILE den lan thu 3 ma khong co bang chung moi xen giua: DUNG LAI. Do la dau hieu dang doan chu chua nam co che gay loi. '
    + 'Ghi vao result.json -> "blocked" roi de PM quyet.');
  lines.push('- Neu bi vuong (thieu quyen, thieu thiet bi, lenh treo): ghi ro vao result.json o truong `blocked` roi dung lai, DUNG doan buoc tiep.');
  lines.push('');
  return lines.join('\n');
}

function resultContract(paths, phase, cfg) {
  const schema = phase === 'PLAN'
    ? `{
  "phase": "PLAN",
  "summary": "<1-3 cau: se lam gi, theo huong nao>",
  "files_to_change": ["<duong dan tuong doi>", "..."],
  "risks": ["<rui ro / cho de hong>"],
  "tests_planned": ["<test nao se chung minh dung>"],
  "open_questions": ["<cau hoi can PM chot, de [] neu khong co>"],
  "blocked": null
}`
    : `{
  "phase": "IMPLEMENT",
  "summary": "<da lam gi>",
  "files_changed": ["<duong dan tuong doi>", "..."],
  "commands_run": ["<lenh da chay>"],
  "tests": { "command": "<lenh test>", "exitCode": 0, "passed": 0, "failed": 0, "skipped": 0, "note": "<doc tu ket qua that>" },
  "oracle": {
    "command": "<lenh/test tai hien duoc loi — null neu task nay khong phai sua loi>",
    "before": "<chay TRUOC khi sua: no do the nao>",
    "after": "<chay LAI sau khi sua: no xanh the nao>"
  },
  "screenshots": ["<duong dan anh trong ${path.basename(paths.proofDir)}/ neu co>"],
  "notes": "<luu y cho PM khi review>",
  "blocked": null
}`;
  return [
    '## HOP DONG BAO CAO — viec cuoi cung bat buoc phai lam',
    `Ghi file JSON tai: ${paths.result}`,
    '```json',
    schema,
    '```',
    `- Ghi dung duong dan tuyet doi tren, ghi de neu da ton tai.`,
    `- Ghi XONG file nay roi moi dung. PM doc file nay de biet task da xong hay chua.`,
    ...(phase === 'IMPLEMENT' ? [
      '- KHONG chay test nao thi KHONG PHAI xanh: "0 test", "UP-TO-DATE", "No tests found", "No tests ran" deu la CHUA CHAY.',
      '- Ghi so pass / fail / skipped DOC DUOC TU KET QUA THAT. Test bi skip phai noi ra, khong duoc gom vao "tat ca xanh".',
    ] : []),
    '',
  ].join('\n');
}

/**
 * Prompt mo hoi thoai PHAN BIEN KE HOACH: agent doc plan cua PM va tim cho sai.
 * Chua duoc sua bat ky file nao o giai doan nay.
 */
export function buildPlanCritiquePrompt(cfg, task) {
  const paths = contractPaths(cfg, task);
  return [
    `# Phan bien KE HOACH cua PM — task ${task.id}: ${task.title}`,
    '',
    'Ban la Senior Engineer trong doi. Ke hoach duoi day do PM (Leader) viet. PM KHONG ngoi trong repo nay',
    'bang ban, nen ke hoach co the sai fact. Viec cua ban bay gio la TIM CHO SAI, khong phai gat dau.',
    `Project: ${cfg.projectRoot}`,
    `Ho so task: ${paths.dir}`,
    '',
    '## Yeu cau goc',
    task.brief,
    '',
    planBlock(cfg, task),
    dodBlock(task, cfg),
    rulesBlock(cfg),
    '## Viec can lam',
    '1. Doc THAT SU code lien quan trong project, doi chieu voi tung buoc trong ke hoach.',
    '2. Nhiem vu cua ban la BAC BO: file/ham ke hoach nhac den co ton tai khong, signature co dung khong,',
    '   buoc nao khong lam duoc, buoc nao thieu, cho nao se lam vo phan dang chay dung, test de xuat co bat duoc loi khong.',
    '3. Khong tim ra cho sai nao thi noi thang la khong tim ra — dung bia loi cho co, va cung dung khen.',
    '4. TUYET DOI KHONG sua bat ky file source nao o giai doan nay.',
    '',
    noFabricationBlock(),
    '## HOP DONG BAO CAO',
    `Ghi ${path.join(paths.dir, 'plan-review.json')}:`,
    '```json',
    `{
  "phase": "PLAN_REVIEW",
  "verdict": "ok" | "co_van_de",
  "findings": [
    { "severity": "blocker|major|minor", "buoc": "<buoc nao trong ke hoach>", "file": "<file:dong>", "problem": "<ke hoach sai cho nao>", "why": "<hong the nao neu lam theo>", "fix": "<nen sua ke hoach ra sao>" }
  ],
  "facts_checked": [ { "claim": "<dieu ke hoach khang dinh>", "ket qua": "dung|sai|khong kiem duoc", "evidence": "<file:dong hoac lenh da chay>" } ],
  "notes": ""
}`,
    '```',
    '- Ghi xong file thi DUNG LAI. PM se doc roi quyet dinh sua ke hoach hay giao trien khai.',
  ].filter(Boolean).join('\n');
}

/** Tin nhan duyet plan + lenh trien khai. */
export function buildImplementMessage(cfg, task, pmNotes = '') {
  const paths = contractPaths(cfg, task);
  const testLine = cfg.testCommand
    ? `- Chay test cua project va ghi exit code that vao result.json: \`${cfg.testCommand}\``
    : '- Chay test/kiem chung phu hop voi thay doi cua ban va ghi exit code that vao result.json.';
  return [
    `# ${task.id} — PM DA DUYET KE HOACH. Sang GIAI DOAN 2: TRIEN KHAI.`,
    pmNotes ? `\n## Ghi chu cua PM (bat buoc tuan thu)\n${pmNotes}\n` : '',
    planBlock(cfg, task),
    '## Viec can lam',
    '- Trien khai dung theo ke hoach cua PM o tren.',
    testLine,
    `- Neu thay doi co the nhin thay (UI, man hinh, log chay that): luu anh chung minh vao ${paths.proofDir}/ va liet ke trong result.json -> "screenshots".`,
    `- Cap nhat ${paths.result} voi phase = "IMPLEMENT" theo dung schema da gui.`,
    '',
    '## Sua loi thi BAT BUOC co oracle DO -> XANH',
    '- TRUOC khi sua dong code dau tien: chay mot test/lenh that su tai hien duoc loi va THAY NO DO. Ghi lai lenh + ket qua vao result.json -> "oracle.before".',
    '- SAU khi sua: chay LAI DUNG lenh do, cung kich ban, cung cach chay, thay no XANH. Ghi vao "oracle.after".',
    '- Doc log cu, doc bao cao loi, doc source roi suy luan "chac la do cho nay": KHONG tinh la oracle. Phai la lenh chay that, co the do lai duoc.',
    '- Khong chay duoc oracle truoc khi sua (thieu thiet bi, khong tai hien duoc) thi ghi vao result.json -> "blocked" roi dung, DUNG sua mo.',
    '- Task khong phai sua loi (them tinh nang, refactor, tai lieu) thi de "oracle": null va noi ro ban chung minh dung bang cach nao.',
    '',
    dodBlock(task, cfg),
    noFabricationBlock(),
    guardrails(cfg),
    resultContract(paths, 'IMPLEMENT', cfg),
    'Lam xong thi dung lai. PM se audit + code review + chay test doc lap truoc khi nghiem thu.',
  ].filter(Boolean).join('\n');
}

/** Tin nhan tra viec: liet ke phat hien, buoc sua lai. */
export function buildReworkMessage(cfg, task, { findings = [], notes = '', failedRuns = [] }) {
  const paths = contractPaths(cfg, task);
  return [
    `# ${task.id} — PM TRA VIEC (vong ${task.round}). Sua lai roi bao cao.`,
    '',
    '## Phat hien cua PM (phai xu ly HET, tung diem)',
    ...(findings.length ? findings.map((f, i) => `${i + 1}. ${f}`) : ['(khong co diem nao — xem ghi chu)']),
    '',
    failedRuns.length ? `## Lenh dang do\n${failedRuns.map((r) => `- \`${r.command}\` -> exit ${r.exitCode}`).join('\n')}\n` : '',
    notes ? `## Ghi chu\n${notes}\n` : '',
    '## Yeu cau',
    '- Sua dung nhung diem tren, KHONG mo rong pham vi.',
    '- Neu ban cho rang mot phat hien la SAI: ghi phan bien vao result.json -> "notes" kem dan chung file:dong, dung im lang bo qua.',
    `- Ghi lai ${paths.result} (phase = "IMPLEMENT") sau khi sua xong.`,
    '',
    noFabricationBlock(),
    guardrails(cfg),
  ].filter(Boolean).join('\n');
}

/** Prompt cho 1 hoi thoai AUDIT doc lap (con mat thu hai, chi doc, khong sua). */
export function buildAuditPrompt(cfg, task, scope = '') {
  const paths = contractPaths(cfg, task);
  return [
    `# AUDIT doc lap cho task ${task.id}: ${task.title}`,
    '',
    'Ban la Auditor doc lap. Ban KHONG phai nguoi viet code nay va KHONG duoc sua bat ky file nao.',
    `Project: ${cfg.projectRoot}`,
    `Ho so task: ${paths.dir} (doc brief.md, plan.md, result.json)`,
    '',
    '## Viec can lam',
    '1. Doc plan.md + result.json, roi doc THAT SU cac file da thay doi (dung `git diff` va doc code).',
    '2. Truy tim: sai logic, hoi quy (guard bi xoa/lam mem), truong hop bien chua xu ly, ro ri tai nguyen,',
    '   loi nuot exit code / nuot exception, tai lieu noi sai so voi code.',
    '3. Doi chieu voi Definition of Done ben duoi — cai nao CHUA dat thi noi ro.',
    scope ? `4. PM yeu cau soi ky them: ${scope}` : '',
    '',
    dodBlock(task, cfg),
    rulesBlock(cfg),
    noFabricationBlock(),
    '## HOP DONG BAO CAO',
    `Ghi ${path.join(paths.dir, 'audit-agent.json')}:`,
    '```json',
    `{
  "phase": "AUDIT",
  "verdict": "pass" | "fail",
  "findings": [
    { "severity": "blocker|major|minor", "file": "<file:dong>", "problem": "<sai gi>", "why": "<hong the nao>", "fix": "<sua sao>" }
  ],
  "dod_check": [ { "item": "<muc DoD>", "met": true, "evidence": "<bang chung>" } ],
  "notes": ""
}`,
    '```',
    '- KHONG sua code. Chi doc va bao cao. Ghi xong file thi dung.',
  ].filter(Boolean).join('\n');
}

/** Tin nhan yeu cau agent tu chup anh nghiem thu. */
export function buildProofRequestMessage(cfg, task, what) {
  const paths = contractPaths(cfg, task);
  return [
    `# ${task.id} — PM can ANH NGHIEM THU`,
    '',
    `Can chung minh bang hinh: ${what}`,
    `- Luu anh PNG vao: ${paths.proofDir}/`,
    '- Ten file dat theo noi dung, khong dat "screenshot1.png".',
    `- Bo sung duong dan vao ${paths.result} -> "screenshots" roi dung lai.`,
    '- Anh phai la anh CHAY THAT (thiet bi/may ao/ung dung that), khong dung anh dung, khong ve lai.',
  ].join('\n');
}
