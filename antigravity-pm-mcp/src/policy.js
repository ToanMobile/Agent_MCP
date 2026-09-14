// LUAT BAT BUOC cua chu du an, ap cho MOI task — khong phu thuoc vao viec PM co nho
// ghi vao definitionOfDone hay khong.
//
// Hai luat (chu xe ra lenh 12/09/2026):
//   1. Thay doi phai KEM FILE TEST. Test cu van xanh khong chung minh duoc gi ve phan moi.
//   2. Anh nghiem thu phai chup tu THIET BI THAT (provider khai trong mustHave.proofFrom),
//      khong nhan anh man hinh may hay anh agent tu dua.
//
// Bo sung 14/09/2026 (bai hoc dieu phoi dem 13-14/09 tren Geely EX2):
//   3. Sua loi phai co ORACLE do -> xanh (mustHave.oracle, mac dinh tat).
//   4. Test "xanh" ma khong chay that => KHONG xanh (bang chung do src/evidence.js thu, gate dung isGreenRun).
//   5. File rac o goc repo (fix_*.py, *_patch.kt...) => canh bao.
//   6. Hai task song song dung cung module doc quyen (mustHave.exclusiveDirs) => chan.
//
// Cau hinh o <project>/.antigravity-pm.json -> "mustHave".
import path from 'node:path';

export const DEFAULT_MUST_HAVE = {
  testChange: true,
  testFilePatterns: [
    '**/src/test/**',
    '**/src/androidTest/**',
    '**/test/**',
    '**/tests/**',
    '**/__tests__/**',
    '**/*Test.*',
    '**/*Tests.*',
    '**/*_test.*',
    '**/*.test.*',
    '**/*.spec.*',
  ],
  proofFrom: [],
  // Sua loi phai co oracle do -> xanh trong result.json. Mac dinh TAT de khong vo task dang chay o project khac.
  oracle: false,
  // Thu muc doc quyen: hai task dang chay khong duoc cung dung vao (vi du "shared/").
  exclusiveDirs: [],
  // File rac agent hay de lai o GOC repo (khong co dau "/").
  strayFilePatterns: ['fix_*.py', 'update_*.py', 'modify_*.py', 'patch_*.py', 'patch_*.sh', 'patch_*.rb', 'fix_*.sh', 'update_*.sh',
    '*_patch.*', '*.bak', '*.orig', '*.rej', 'test_debug.sh',
    // Hop dong bao cao ghi NHAM ra goc repo (Unity T0014: result.json o root thay vi thu muc task).
    'result.json', 'plan-review.json', 'audit-agent.json', 'plan.md'],
  // 'block' = pm_accept tu choi khi con file rac (de xuat PM GeelyEx2 14/09/2026: rac moi vong, commit 302d38a1
  // `git add -A` cuon ca fix_*.py vao repo) | 'warn' = chi canh bao.
  strayFiles: 'block',
};

/** Loai bang chung anh theo loai task: device (mac dinh) | browser (web/SQL/HTML) | script (lenh/CLI). */
export const PROOF_KINDS = ['device', 'browser', 'script'];
// Provider duoc tinh cho task khong co thiet bi: van phai la LENH PM CHAY (browser headless / shell), KHONG phai
// anh agent tu dua (file) — giu dung bat bien "anh agent dua khong duoc tinh".
const PROVIDER_TYPE_KHONG_THIET_BI = ['browser', 'shell'];


export function mustHaveOf(cfg) {
  const m = cfg?.mustHave || {};
  return {
    testChange: m.testChange !== false,
    testFilePatterns: Array.isArray(m.testFilePatterns) && m.testFilePatterns.length
      ? m.testFilePatterns
      : DEFAULT_MUST_HAVE.testFilePatterns,
    proofFrom: Array.isArray(m.proofFrom) ? m.proofFrom : [],
    oracle: m.oracle === true,
    exclusiveDirs: (Array.isArray(m.exclusiveDirs) ? m.exclusiveDirs : [])
      .map((d) => String(d).replace(/^\.\//, '').replace(/\/+$/, ''))
      .filter(Boolean),
    strayFilePatterns: Array.isArray(m.strayFilePatterns) && m.strayFilePatterns.length
      ? m.strayFilePatterns
      : DEFAULT_MUST_HAVE.strayFilePatterns,
    strayFiles: m.strayFiles === 'warn' ? 'warn' : 'block',
  };
}

/** Glob don gian: `**` xuyen thu muc, `*` trong 1 doan, `?` 1 ky tu. */
export function globToRegExp(pattern) {
  let out = '';
  const p = String(pattern);
  for (let i = 0; i < p.length; i += 1) {
    const c = p[i];
    if (c === '*') {
      if (p[i + 1] === '*') {
        // `**/` nuot luon dau gach de `**/x` khop ca `x` o goc.
        if (p[i + 2] === '/') { out += '(?:.*/)?'; i += 2; } else { out += '.*'; i += 1; }
      } else {
        out += '[^/]*';
      }
    } else if (c === '?') out += '[^/]';
    else out += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${out}$`);
}

export function matchesAny(file, patterns) {
  const f = String(file).replace(/^\.\//, '').split(path.sep).join('/');
  return patterns.some((pat) => globToRegExp(pat).test(f));
}

/**
 * Thay doi co kem file test khong?
 * changedFiles = undefined nghia la CHUA DO DUOC (khong phai "khong co") — goi y phai noi ro,
 * tuyet doi khong duoc coi nhu dat.
 */
export function checkTestChange(cfg, changedFiles, claimed) {
  const must = mustHaveOf(cfg);
  if (!must.testChange) return { required: false, ok: true, testFiles: [] };
  if (!Array.isArray(changedFiles)) {
    return { required: true, ok: false, unknown: true, testFiles: [] };
  }
  const testFiles = changedFiles.filter((f) => matchesAny(f, must.testFilePatterns));
  // claimed = files_changed agent khai. Chi file test AGENT KHAI moi duoc tinh — cay lam viec dung chung
  // nhieu phien, file test cua phien khac khong chung minh gi cho task nay. undefined = chua co result.json
  // (giu cach cu de khong doi hop dong).
  if (!Array.isArray(claimed)) {
    return { required: true, ok: testFiles.length > 0, testFiles, changedCount: changedFiles.length };
  }
  if (claimed.length === 0 && changedFiles.length > 0) {
    return { required: true, ok: false, noClaim: true, testFiles, changedCount: changedFiles.length };
  }
  const claimedTestFiles = testFiles.filter((f) => claimed.some((c) => cungFile(f, c)));
  const unclaimedTestFiles = testFiles.filter((f) => !claimed.some((c) => cungFile(f, c)));
  return {
    required: true,
    ok: claimedTestFiles.length > 0,
    testFiles: claimedTestFiles,
    unclaimedTestFiles,
    changedCount: changedFiles.length,
  };
}

/**
 * Anh nghiem thu cua vong nay co cai nao chup tu provider bat buoc khong?
 * task.proofKind = 'browser' | 'script' (khai luc pm_task_create, in ra o moi noi): thay vi proofFrom, doi
 * provider TYPE thuoc browser|shell — mot lenh PM chay, khong phai file agent dua. Task cu / 'device' giu proofFrom.
 */
export function checkProofProvider(cfg, proofsThisRound, task) {
  const must = mustHaveOf(cfg);
  const kind = task?.proofKind && PROOF_KINDS.includes(task.proofKind) ? task.proofKind : 'device';
  const from = proofsThisRound.map((p) => p.provider);
  if (kind !== 'device') {
    const provs = cfg?.proof?.providers || {};
    const typeOf = (name) => (name === 'file' ? 'file' : provs[name]?.type || name);
    return {
      required: true, kind,
      ok: proofsThisRound.some((p) => PROVIDER_TYPE_KHONG_THIET_BI.includes(typeOf(p.provider))),
      allowed: PROVIDER_TYPE_KHONG_THIET_BI.map((t) => `provider type ${t}`),
      from,
    };
  }
  if (must.proofFrom.length === 0) return { required: false, ok: true, from: [] };
  return {
    required: true, kind,
    ok: proofsThisRound.some((p) => must.proofFrom.includes(p.provider)),
    allowed: must.proofFrom,
    from,
  };
}

/**
 * LUAT 3: sua loi phai co oracle do -> xanh.
 * - mustHave.oracle tat => khong doi.
 * - task cu (khong co truong `type`, tao truoc khi co luat) => mien, giong cach baseCommit xu ly task cu.
 * - doi khi task.type == 'bugfix' HOAC agent tu khai oracle.command (khai thi phai dung).
 * - Hai tang: (a) agent khai command + before + after khac rong; (b) PM TU REPLAY (pm_run kind=oracle)
 *   trong vong nay dat (replayRuns = task.runs kind='oracle' cua vong). Loi khai khong phai bang chung.
 */
export function checkOracle(cfg, task, result, replayRuns) {
  const must = mustHaveOf(cfg);
  if (!must.oracle) return { required: false, ok: true };
  if (!task || task.type === undefined) return { required: false, ok: true, exempt: 'task cu chua co truong type' };
  const o = result?.oracle;
  const co = (v) => typeof v === 'string' && v.trim().length > 0;
  const agentKhai = o && typeof o === 'object' && co(o.command);
  if (task.type !== 'bugfix' && !agentKhai) return { required: false, ok: true, exempt: `task type=${task.type}` };
  if (!o || typeof o !== 'object') return { required: true, ok: false, reason: 'result.json khong co "oracle" (task sua loi)' };
  if (!co(o.command)) return { required: true, ok: false, reason: 'oracle.command rong — khong biet lenh nao tai hien loi' };
  if (!co(o.before)) return { required: true, ok: false, reason: 'oracle.before rong — chua thay no DO truoc khi sua' };
  if (!co(o.after)) return { required: true, ok: false, reason: 'oracle.after rong — chua thay no XANH sau khi sua' };
  const replays = Array.isArray(replayRuns) ? replayRuns : [];
  const dat = replays.find((r) => r.oracle?.ok === true);
  if (!dat) {
    const last = replays[replays.length - 1];
    return {
      required: true, ok: false, replay: false,
      reason: last
        ? `PM replay chua dat: ${last.oracle?.blocked || `${last.oracle?.red?.reason || '?'} | ${last.oracle?.green?.reason || 'GREEN chua chay'}`}`
        : 'PM chua tu replay (pm_run kind=oracle) — loi khai before/after cua agent khong phai bang chung',
    };
  }
  return { required: true, ok: true, replay: true };
}

/**
 * DE XUAT 2 (PM GeelyEx2 14/09/2026): result.json sai khuon — T0021 `{"status":"PASS"}`, T0022 summary "Stopped early"
 * nhung notes "Hoan thanh", T0023/T0024 `tests_run: null` roi khai 63/69 pass khi suite that do.
 * Tra ve danh sach loi khuon (rong = hop le). Chi kiem truong DA CO trong hop dong, khong them truong bat buoc moi.
 */
export function kiemKhuonResult(result) {
  const loi = [];
  if (!result || typeof result !== 'object') return ['result.json khong phai object JSON'];
  const phase = String(result.phase || '').toUpperCase();
  if (!['PLAN', 'IMPLEMENT'].includes(phase)) loi.push(`phase="${result.phase ?? ''}" (phai la PLAN | IMPLEMENT)`);
  if (typeof result.summary !== 'string' || !result.summary.trim()) loi.push('summary rong');
  if (phase === 'IMPLEMENT') {
    if (!Array.isArray(result.files_changed)) loi.push('files_changed khong phai mang');
    if ('tests_run' in result && !('tests' in result)) loi.push('dung "tests_run" thay vi "tests" (sai ten truong)');
    if (result.tests !== undefined && result.tests !== null) {
      if (typeof result.tests !== 'object') loi.push('tests khong phai object');
      else if (typeof result.tests.exitCode !== 'number') loi.push('tests.exitCode khong phai so');
    }
  }
  return loi;
}

/**
 * DE XUAT 2: doi chieu loi khai test cua agent voi XML PM do duoc. Chi so failures (agent chay suite loc, PM chay
 * suite day du => KHONG so passed). Agent khai failed=0 ma XML that co failures/errors => KHAI SAI.
 */
export function doiChieuKhaiTest(result, evidence) {
  const t = result?.tests;
  if (!t || typeof t !== 'object' || !evidence || evidence.source !== 'xml') return null;
  const that = (evidence.failures || 0) + (evidence.errors || 0);
  const khai = Number(t.failed ?? 0);
  if (khai === 0 && that > 0) {
    return `KHAI SAI: agent khai tests.failed=0 nhung XML PM do duoc ${evidence.failures} failures + ${evidence.errors} errors (${(evidence.failedNames || []).slice(0, 5).join(', ')})`;
  }
  return null;
}

/** DE XUAT 4b: plan-review.json dung khuon? Tra ve danh sach loi (rong = hop le). */
export function kiemKhuonPlanReview(review) {
  const loi = [];
  if (!review || typeof review !== 'object') return ['khong phai object JSON'];
  if (!['ok', 'co_van_de'].includes(review.verdict)) loi.push(`verdict="${review.verdict ?? ''}" (phai la ok | co_van_de)`);
  if (!Array.isArray(review.findings)) loi.push('findings khong phai mang');
  else for (const [i, f] of review.findings.entries()) {
    if (!f || typeof f !== 'object' || !String(f.problem || '').trim()) { loi.push(`findings[${i}] thieu "problem"`); break; }
  }
  return loi;
}

/** DE XUAT 4 (Unity T0014: sua ItemState.cs la file plan CAM dung): file thay doi cham vao forbiddenPaths cua task. */
export function fileCamDung(task, changedFiles) {
  const cam = (Array.isArray(task?.forbiddenPaths) ? task.forbiddenPaths : []).map(chuanHoaDuongDan).filter(Boolean);
  if (!cam.length || !Array.isArray(changedFiles)) return [];
  return changedFiles.map(chuanHoaDuongDan).filter((f) => cam.some((c) => f === c || f.startsWith(`${c}/`) || matchesAny(f, [c])));
}

/** LUAT 5: file rac agent de lai o GOC repo (chi xet muc chua track, khong co "/"). */
export function fileRacGocRepo(untrackedFiles, cfg) {
  const pats = cfg ? mustHaveOf(cfg).strayFilePatterns : DEFAULT_MUST_HAVE.strayFilePatterns;
  return (Array.isArray(untrackedFiles) ? untrackedFiles : [])
    .map((f) => String(f).replace(/^\.\//, ''))
    .filter((f) => f && !f.includes('/') && matchesAny(f, pats));
}

/** Chuan hoa duong dan de so: bo "./", doi "\\" thanh "/", bo "/" cuoi. */
export function chuanHoaDuongDan(f) {
  return String(f || '').trim().replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '');
}

/** Hai duong dan chi cung mot file khi bang nhau hoac mot ben la duoi "/x" cua ben kia (KHONG dung includes hai chieu). */
export function cungFile(a, b) {
  const x = chuanHoaDuongDan(a);
  const y = chuanHoaDuongDan(b);
  if (!x || !y) return false;
  return x === y || x.endsWith(`/${y}`) || y.endsWith(`/${x}`);
}

/** Pham vi file cua mot task: PM khai (scopeFiles) hop voi agent khai trong result.json. */
export function phamViTask(task, result) {
  const out = new Set();
  for (const f of [
    ...(Array.isArray(task?.scopeFiles) ? task.scopeFiles : []),
    ...(Array.isArray(result?.files_changed) ? result.files_changed : []),
    ...(Array.isArray(result?.files_to_change) ? result.files_to_change : []),
  ]) {
    const k = chuanHoaDuongDan(f);
    if (k) out.add(k);
  }
  return [...out];
}

const PHASE_DANG_CHAY = new Set(['IMPLEMENT', 'AUDIT', 'REVIEW', 'TEST', 'PROOF']);

/** Task dang co agent lam viec tren cay ma (chua nghiem thu, da qua giai doan ke hoach). */
export function dangChay(task) {
  return Boolean(task) && PHASE_DANG_CHAY.has(task.phase);
}

function thuocThuMuc(file, dir) {
  const f = chuanHoaDuongDan(file);
  return f === dir || f.startsWith(`${dir}/`);
}

/**
 * LUAT 6: hai task song song chong lan nhau khong?
 * candidate = { id, files }, others = [{ id, files }] (chi nhung task dang chay).
 * Tra ve { overlaps: [{ taskId, files }], exclusive: [{ taskId, dir }] } —
 * overlaps chi CANH BAO; exclusive (cung dung mot thu muc doc quyen) thi CHAN tru khi force.
 */
export function kiemChongLan(cfg, candidate, others) {
  const dirs = mustHaveOf(cfg).exclusiveDirs;
  const mine = (candidate?.files || []).map(chuanHoaDuongDan).filter(Boolean);
  const overlaps = [];
  const exclusive = [];
  for (const o of others || []) {
    if (!o || o.id === candidate?.id) continue;
    const theirs = (o.files || []).map(chuanHoaDuongDan).filter(Boolean);
    const common = mine.filter((f) => theirs.some((g) => cungFile(f, g)));
    if (common.length) overlaps.push({ taskId: o.id, files: common });
    for (const d of dirs) {
      if (mine.some((f) => thuocThuMuc(f, d)) && theirs.some((f) => thuocThuMuc(f, d))) {
        exclusive.push({ taskId: o.id, dir: d });
      }
    }
  }
  return { overlaps, exclusive };
}

/** Cau nhac cho agent, nhet vao prompt de no biet truoc luat. */
export function mustHaveLines(cfg) {
  const must = mustHaveOf(cfg);
  const lines = [];
  if (must.testChange) {
    lines.push('BAT BUOC: thay doi phai KEM FILE TEST (them moi hoac sua test hien co) cho dung phan ban sua. '
      + 'Test cu van xanh KHONG duoc tinh — PM se tu choi nghiem thu neu khong thay file test nao thay doi.');
  }
  if (must.proofFrom.length) {
    lines.push(`BAT BUOC: phai co anh chup tu thiet bi that (${must.proofFrom.join(' hoac ')}) chung minh thay doi chay duoc. `
      + 'Anh man hinh may tinh hay anh dung lai KHONG duoc tinh.');
  }
  if (must.oracle) {
    lines.push('BAT BUOC (task sua loi): result.json -> "oracle" phai co command + before (DO) + after (XANH) khac rong. '
      + 'Thieu la PM tu choi nghiem thu.');
  }
  return lines;
}
