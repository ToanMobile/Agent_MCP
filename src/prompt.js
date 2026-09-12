// Soan prompt giao viec cho Antigravity.
//
// Moi prompt deu mang theo HOP DONG BAO CAO: agent phai ghi plan.md / result.json vao
// dung thu muc task. Nho hop dong nay ma PM khong can giai ma protobuf trong CSDL
// hoi thoai cua Antigravity — chi can doc file.
import path from 'node:path';
import { existingRulesFiles } from './config.js';
import { contractPaths } from './tasks.js';

function rulesBlock(cfg) {
  const files = existingRulesFiles(cfg);
  if (files.length === 0) return '';
  return [
    '## Luat cua project — DOC TRUOC KHI LAM, KHONG DUOC BO QUA',
    ...files.map((f) => `- ${f}`),
    '',
  ].join('\n');
}

function dodBlock(task) {
  return [
    '## Dinh nghia HOAN THANH (Definition of Done) — PM se nghiem thu dung theo day',
    ...task.definitionOfDone.map((d, i) => `${i + 1}. ${d}`),
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
  "tests": { "command": "<lenh test>", "exitCode": 0, "note": "<so test pass/fail>" },
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
    '',
  ].join('\n');
}

/** Prompt mo hoi thoai: giai doan LAP KE HOACH, chua duoc sua code. */
export function buildPlanPrompt(cfg, task) {
  const paths = contractPaths(cfg, task);
  return [
    `# Task ${task.id}: ${task.title}`,
    '',
    'Ban la Senior Engineer trong doi. Toi la Leader/PM (chay tren Claude Code) va se AUDIT + CODE REVIEW + nghiem thu ket qua cua ban.',
    `Project: ${cfg.projectRoot}`,
    `Thu muc task (moi file bao cao ghi vao day): ${paths.dir}`,
    '',
    '## Yeu cau',
    task.brief,
    '',
    dodBlock(task),
    rulesBlock(cfg),
    '## GIAI DOAN 1 — CHI LAP KE HOACH, CHUA SUA CODE',
    `1. Doc cac file luat o tren + doc code lien quan trong ${cfg.projectRoot}.`,
    `2. Viet ke hoach vao: ${paths.plan}`,
    '   Ke hoach phai co: hien trang (dan chung file:dong that), cach sua theo tung buoc,',
    '   danh sach file se sua, rui ro/hoi quy, va cach CHUNG MINH la dung (test nao, anh nao).',
    '3. TUYET DOI KHONG sua bat ky file source nao trong giai doan nay.',
    `4. Ghi ${paths.result} theo hop dong ben duoi roi DUNG LAI cho PM duyet.`,
    '',
    guardrails(cfg),
    resultContract(paths, 'PLAN', cfg),
    'Bat dau lam ngay, khong hoi lai — neu co diem can chot thi ghi vao "open_questions".',
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
    '## Viec can lam',
    '- Trien khai dung theo plan.md da duyet.',
    testLine,
    `- Neu thay doi co the nhin thay (UI, man hinh, log chay that): luu anh chung minh vao ${paths.proofDir}/ va liet ke trong result.json -> "screenshots".`,
    `- Cap nhat ${paths.result} voi phase = "IMPLEMENT" theo dung schema da gui.`,
    '',
    dodBlock(task),
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
    guardrails(cfg),
  ].filter(Boolean).join('\n');
}

/**
 * Tin nhan bac KE HOACH. Khac han buildReworkMessage: o day agent van CHUA duoc sua code,
 * chi viet lai plan.md. Dung nham hai cai nay la day agent di code khi ke hoach chua duyet.
 */
export function buildPlanReworkMessage(cfg, task, { findings = [], notes = '' }) {
  const paths = contractPaths(cfg, task);
  return [
    `# ${task.id} — PM CHUA DUYET KE HOACH. Viet lai plan.md.`,
    '',
    '## PM khong dong y cho nao',
    ...(findings.length ? findings.map((f, i) => `${i + 1}. ${f}`) : ['(xem ghi chu)']),
    '',
    notes ? `## Ghi chu\n${notes}\n` : '',
    '## Yeu cau',
    `- Viet lai ${paths.plan} cho dung, KHONG mo rong pham vi.`,
    '- VAN DANG O GIAI DOAN LAP KE HOACH: **KHONG duoc sua bat ky file source nao**.',
    '- Neu ban cho rang mot y kien cua PM la sai: ghi phan bien kem dan chung file:dong vao plan.md, dung im lang lam theo.',
    `- Ghi lai ${paths.result} voi phase = "PLAN" roi DUNG LAI cho PM duyet.`,
    '',
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
    dodBlock(task),
    rulesBlock(cfg),
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
