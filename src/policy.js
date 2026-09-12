// LUAT BAT BUOC cua chu du an, ap cho MOI task — khong phu thuoc vao viec PM co nho
// ghi vao definitionOfDone hay khong.
//
// Hai luat (chu xe ra lenh 12/09/2026):
//   1. Thay doi phai KEM FILE TEST. Test cu van xanh khong chung minh duoc gi ve phan moi.
//   2. Anh nghiem thu phai chup tu THIET BI THAT (provider khai trong mustHave.proofFrom),
//      khong nhan anh man hinh may hay anh agent tu dua.
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
};

export function mustHaveOf(cfg) {
  const m = cfg?.mustHave || {};
  return {
    testChange: m.testChange !== false,
    testFilePatterns: Array.isArray(m.testFilePatterns) && m.testFilePatterns.length
      ? m.testFilePatterns
      : DEFAULT_MUST_HAVE.testFilePatterns,
    proofFrom: Array.isArray(m.proofFrom) ? m.proofFrom : [],
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
export function checkTestChange(cfg, changedFiles) {
  const must = mustHaveOf(cfg);
  if (!must.testChange) return { required: false, ok: true, testFiles: [] };
  if (!Array.isArray(changedFiles)) {
    return { required: true, ok: false, unknown: true, testFiles: [] };
  }
  const testFiles = changedFiles.filter((f) => matchesAny(f, must.testFilePatterns));
  return { required: true, ok: testFiles.length > 0, testFiles, changedCount: changedFiles.length };
}

/** Anh nghiem thu cua vong nay co cai nao chup tu provider bat buoc khong? */
export function checkProofProvider(cfg, proofsThisRound) {
  const must = mustHaveOf(cfg);
  if (must.proofFrom.length === 0) return { required: false, ok: true, from: [] };
  const from = proofsThisRound.map((p) => p.provider);
  return {
    required: true,
    ok: proofsThisRound.some((p) => must.proofFrom.includes(p.provider)),
    allowed: must.proofFrom,
    from,
  };
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
  return lines;
}
