// BANG CHUNG TEST phia PM. Exit 0 KHONG phai bang chung test da chay:
//   - Gradle: "N actionable tasks: N up-to-date" / "N from cache" => khong task nao chay, van exit 0.
//     FROM-CACHE con khoi phuc build/test-results voi mtime MOI => XML tuoi ma test khong chay.
//   - "No tests found", "No tests ran", node --test "tests 0", pytest "collected 0 items".
// Vi sao (T0001, 12/09/2026): PM chay lai ktlint/detekt thay "149 actionable tasks: 149 up-to-date",
// exit 0 — khong phai xanh. Quy tac o day la quy tac cua `check 2` trong AGENTS.md cua OfficeReader:
// so dem phai doc tu TEST-*.xml MOI HON lan chay, tests>0, failures=0, errors=0, skipped phai neu ro.
//
// Thuan, khong goi agent, khong mang. Chi doc dia.
import fs from 'node:fs';
import path from 'node:path';

/** Rule nhan dien "chay ma khong test nao chay". Moi rule tra ve ten de ghi vao ho so. */
export const NOOP_RULES = [
  // Dong tong ket Gradle: noop khi KHONG co "N executed". Chi xet dong tong ket, KHONG quet
  // chu "UP-TO-DATE" roi rac — task compile up-to-date trong khi task test van chay la binh thuong.
  { name: 'gradle-khong-task-nao-executed', test: (s) => { const m = /(\d+) actionable tasks?:([^\n]*)/.exec(s); return Boolean(m) && !/\d+ executed/.test(m[2]); } },
  { name: 'no-tests-found', test: (s) => /No tests? found/i.test(s) },
  { name: 'no-tests-ran', test: (s) => /No tests? ran/i.test(s) },
  { name: 'node-test-0', test: (s) => /^\s*(?:ℹ\s*)?tests 0\s*$/m.test(s) },
  { name: 'pytest-collected-0', test: (s) => /collected 0 items/i.test(s) },
  { name: 'unittest-ran-0', test: (s) => /^Ran 0 tests/m.test(s) },
  // Task TEST cua Gradle up-to-date (compile van executed nen dong tong ket khong bat duoc). Neo vao task
  // co ten bat dau bang "test" — do tren 33 log that Geely EX2 (14/09/2026): compileDebugUnitTestKotlin
  // UP-TO-DATE xuat hien o lan xanh that, testDebugUnitTest UP-TO-DATE thi khong.
  { name: 'gradle-test-task-up-to-date', test: (s) => /> Task :(?:\S*:)?test\w* UP-TO-DATE/.test(s) },
];

/**
 * Loi bi NUOT exit code: lenh test co `| tail` / `|| true` nen exit 0 du test do.
 * Do tren log that (T0023 r1, 14/09/2026): exit=0 nhung "30845 tests completed, 1 failed" + "BUILD FAILED".
 */
export const SWALLOWED_RULES = [
  { name: 'gradle-build-failed', test: (s) => /\bBUILD FAILED\b|\bFAILURE: Build failed\b/.test(s) },
  { name: 'gradle-n-failed', test: (s) => /\b\d+ tests? completed, [1-9]\d* failed\b/.test(s) },
  { name: 'junit-failures-n', test: (s) => /\bfailures=[1-9]\d*\b/.test(s) },
];

export function detectSwallowedFailure(output) {
  const s = String(output || '');
  for (const r of SWALLOWED_RULES) if (r.test(s)) return { swallowed: true, rule: r.name };
  return { swallowed: false, rule: null };
}

/** Luat them do project khai (mustHave.testSuspectPatterns, chuoi regex). */
function extraSuspect(cfg, output) {
  const pats = Array.isArray(cfg?.mustHave?.testSuspectPatterns) ? cfg.mustHave.testSuspectPatterns : [];
  for (const x of pats) {
    let re; try { re = new RegExp(String(x)); } catch { continue; }
    if (re.test(String(output || ''))) return String(x);
  }
  return null;
}

export function detectNoop(output) {
  const s = String(output || '');
  for (const r of NOOP_RULES) if (r.test(s)) return { noop: true, rule: r.name };
  return { noop: false, rule: null };
}

const PRUNE_DIRS = new Set(['.git', 'node_modules', '.gradle', '.idea']);

/**
 * Khop glob theo tung doan duong dan. Tra ve 'full' (khop het), 'prefix' (thu muc nay con co the
 * chua file khop => di tiep), 'none' (bo nhanh). `**` an bat ky so doan, `*`/`?` trong mot doan.
 */
export function globSegmentsState(pat, segs, pi = 0, si = 0) {
  if (pi === pat.length) return si === segs.length ? 'full' : 'none';
  if (pat[pi] === '**') {
    for (let k = si; k <= segs.length; k += 1) {
      if (globSegmentsState(pat, segs, pi + 1, k) === 'full') return 'full';
    }
    return 'prefix';
  }
  if (si === segs.length) return 'prefix';
  if (!segRegExp(pat[pi]).test(segs[si])) return 'none';
  return globSegmentsState(pat, segs, pi + 1, si + 1);
}

const SEG_CACHE = new Map();
function segRegExp(seg) {
  let re = SEG_CACHE.get(seg);
  if (!re) {
    const src = String(seg).replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*').replace(/\?/g, '[^/]');
    re = new RegExp(`^${src}$`);
    SEG_CACHE.set(seg, re);
  }
  return re;
}

/** Tim file khop it nhat mot pattern (tuong doi goc), cat nhanh thu muc khong the khop. */
export function findFiles(root, patterns) {
  const pats = (patterns || []).map((p) => String(p).replace(/^\.\//, '').split('/').filter(Boolean));
  if (!pats.length) return [];
  const out = [];
  const walk = (dir, segs) => {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const next = [...segs, e.name];
      if (e.isDirectory()) {
        if (PRUNE_DIRS.has(e.name)) continue;
        if (pats.some((p) => globSegmentsState(p, next) !== 'none')) walk(path.join(dir, e.name), next);
      } else if (e.isFile() && pats.some((p) => globSegmentsState(p, next) === 'full')) {
        out.push(path.join(dir, e.name));
      }
    }
  };
  walk(root, []);
  return out;
}

/** Dem tu <testsuite> (KHONG dem <testsuites> boc ngoai — instrumented XML se dem doi). */
export function parseJunitXml(text) {
  const s = String(text || '');
  const r = { tests: 0, failures: 0, errors: 0, skipped: 0, failedNames: [] };
  const attr = (tag, name) => { const m = new RegExp(`\\s${name}="(\\d+)"`).exec(tag); return m ? Number(m[1]) : 0; };
  for (const m of s.matchAll(/<testsuite\s[^>]*>/g)) {
    r.tests += attr(m[0], 'tests');
    r.failures += attr(m[0], 'failures');
    r.errors += attr(m[0], 'errors');
    r.skipped += attr(m[0], 'skipped');
  }
  for (const m of s.matchAll(/<testcase\s([^>]*?)(?:\/>|>([\s\S]*?)<\/testcase>)/g)) {
    const body = m[2] || '';
    if (!/<(failure|error)[\s>]/.test(body)) continue;
    const name = /\sname="([^"]*)"/.exec(` ${m[1]}`)?.[1] || '?';
    const cls = /\sclassname="([^"]*)"/.exec(` ${m[1]}`)?.[1];
    r.failedNames.push(cls ? `${cls}.${name}` : name);
  }
  return r;
}

/**
 * Thu bang chung cho MOT lan chay test. Tra ve object ghi thang vao run record (task.json):
 *   source 'xml' (project khai testEvidence.resultsGlob) | 'stdout' (chi co dong tong ket, weak)
 *   ok = test that su chay va khong do. KHONG xet exit code o day — gate ghep exit code + ok.
 */
export function collectTestEvidence(cfg, { startedMs, stdout = '', stderr = '' }) {
  const output = `${stdout}\n${stderr}`;
  const no = detectNoop(output);
  const sw = detectSwallowedFailure(output);
  const extra = extraSuspect(cfg, output);
  const globs = cfg?.testEvidence?.resultsGlob;
  if (!Array.isArray(globs) || globs.length === 0) {
    let reason = 'chi co exit code + stdout — project chua khai testEvidence.resultsGlob';
    if (no.noop) reason = `khong test nao chay (${no.rule})`;
    else if (sw.swallowed) reason = `test DO nhung exit code bi nuot (${sw.rule}) — sua lenh test, dung tin exit 0`;
    else if (extra) reason = `khop mau nghi ngo cua project: ${extra}`;
    return {
      source: 'stdout', weak: true, noop: no.noop, noopRule: no.rule, swallowed: sw.swallowed, swallowedRule: sw.rule,
      ok: !no.noop && !sw.swallowed && !extra,
      reason,
    };
  }
  const files = findFiles(cfg.projectRoot, globs);
  const sum = { tests: 0, failures: 0, errors: 0, skipped: 0, failedNames: [] };
  let freshCount = 0;
  let staleCount = 0;
  for (const f of files) {
    let st;
    try { st = fs.statSync(f); } catch { continue; }
    if (st.mtimeMs < startedMs) { staleCount += 1; continue; }
    freshCount += 1;
    const p = parseJunitXml(fs.readFileSync(f, 'utf8'));
    sum.tests += p.tests; sum.failures += p.failures; sum.errors += p.errors; sum.skipped += p.skipped;
    sum.failedNames.push(...p.failedNames);
  }
  sum.failedNames = sum.failedNames.slice(0, 20);
  let reason;
  let ok = false;
  if (no.noop) reason = `khong test nao chay (${no.rule}) — XML moi (neu co) la do cache khoi phuc`;
  else if (sw.swallowed && !(sum.failures || sum.errors)) reason = `stdout bao test DO (${sw.rule}) nhung XML khop resultsGlob khong thay — module do nam ngoai glob? exit code dang bi nuot`;
  else if (extra) reason = `khop mau nghi ngo cua project: ${extra}`;
  else if (freshCount === 0) reason = staleCount ? `${staleCount} XML deu CU HON luc bat dau chay — chua chay code moi` : 'khong thay XML ket qua nao khop resultsGlob';
  else if (sum.tests === 0) reason = 'XML moi nhung tests=0';
  else if (sum.failures || sum.errors) reason = `${sum.failures} failures + ${sum.errors} errors: ${sum.failedNames.join(', ')}`;
  else { ok = true; reason = `${sum.tests} test, ${sum.skipped} skipped, 0 failures, 0 errors tu ${freshCount} XML moi`; }
  return {
    source: 'xml', weak: false, noop: no.noop, noopRule: no.rule, swallowed: sw.swallowed, swallowedRule: sw.rule,
    files: freshCount, staleFiles: staleCount,
    tests: sum.tests, failures: sum.failures, errors: sum.errors, skipped: sum.skipped, failedNames: sum.failedNames,
    ok, reason,
  };
}

/** Mot dong de in cho PM / bao cao. */
export function evidenceLine(ev) {
  if (!ev) return 'khong co bang chung (ghi nhan boi phien ban cu — chay lai pm_run)';
  return `${ev.ok ? 'DA CHAY' : 'CHUA TINH'} [${ev.source}${ev.weak ? ', weak' : ''}] ${ev.reason}`;
}
