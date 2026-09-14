// DE XUAT 1b/1c (PM GeelyEx2 14/09/2026): agent va file bang script (python/sed/patch) => nhan doi noi dung.
//   - T0024 r0: tools/admin-keys.html 4689 -> 6730 dong (doan JS xuat hien 2 lan); supabase/schema.sql
//     `create table admin_sessions` x2, `admin_session_ok()` x2; telemetry_overview 455 dong bi thay bang stub.
// Cach do (thuan, chi doc dia + git show):
//   1. File text co san o commit goc TANG > 40 % so dong => CANH BAO (co the la them thuc su => khong chan).
//   2. Trong mot file co khoi >= 50 dong lap lai y het => CANH BAO.
//   3. .sql: `create table <ten>` xuat hien 2 lan trong cung file => CHAN (dinh nghia bang trung chac chan la loi).
//      `create function` chi CANH BAO khi trung ca chu ky ten(args) — Postgres cho phep overload theo kieu tham so.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const BO_QUA = [/\.lock$/, /\.min\./, /\.svg$/, /\.png$|\.jpe?g$|\.gif$|\.webp$|\.pdf$|\.zip$|\.jar$|\.so$|\.bin$|\.dat$|\.wav$|\.onnx$/i];
const MAX_BYTES = 1_000_000;
export const NGUONG_TANG = 0.4;
export const KHOI_LAP = 50;

function laText(buf) {
  const n = Math.min(buf.length, 4000);
  for (let i = 0; i < n; i += 1) if (buf[i] === 0) return false;
  return true;
}

function soDongGoc(projectRoot, base, rel) {
  try {
    const out = execFileSync('git', ['show', `${base}:${rel}`], { cwd: projectRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: MAX_BYTES * 2 });
    return out.split('\n').length;
  } catch {
    return null; // file moi (khong co o goc) => khong so tang
  }
}

/** Khoi >= KHOI_LAP dong lap lai y het trong cung file: tra ve so dong bat dau cua lan 1 va lan 2, hoac null. */
export function timKhoiLap(text, kich = KHOI_LAP) {
  const lines = String(text).split('\n');
  if (lines.length < kich * 2) return null;
  const seen = new Map();
  for (let i = 0; i + kich <= lines.length; i += 1) {
    const key = lines.slice(i, i + kich).join('\n');
    // Bo khoi toan dong trong/ngan (dau ngoac, comment lap) de khong bao nham.
    if (key.replace(/[\s{}();,]/g, '').length < kich * 8) continue;
    const truoc = seen.get(key);
    if (truoc !== undefined && i >= truoc + kich) return { lan1: truoc + 1, lan2: i + 1, dong: kich };
    if (truoc === undefined) seen.set(key, i);
  }
  return null;
}

/** Dinh nghia SQL trung trong mot file: { tables: [ten], functions: [ten(args)] }. */
export function dinhNghiaSqlTrung(text) {
  const dem = (re, norm) => {
    const c = new Map();
    for (const m of String(text).matchAll(re)) {
      const k = norm(m);
      c.set(k, (c.get(k) || 0) + 1);
    }
    return [...c.entries()].filter(([, n]) => n > 1).map(([k]) => k);
  };
  const tables = dem(/\bcreate\s+table\s+(?:if\s+not\s+exists\s+)?([\w."]+)/gi, (m) => m[1].replace(/"/g, '').toLowerCase());
  const functions = dem(/\bcreate\s+(?:or\s+replace\s+)?function\s+([\w."]+)\s*\(([^)]*)\)/gi,
    (m) => `${m[1].replace(/"/g, '').toLowerCase()}(${m[2].replace(/\s+/g, ' ').trim().toLowerCase()})`);
  return { tables, functions };
}

// DE XUAT 5 (project Unity T0014, 14/09/2026): agent boc production code `if (!Application.isPlaying)` de test xanh,
// them `mgr.AddExtraTime(9999f)` vao test runner. Heuristic: dong bi XOA co dang guard, dong THEM boc bang co test/debug,
// assert bi xoa trong file test => "PM phai soi tan mat" (canh bao, khong chan — heuristic).
const GUARD_XOA = /^\s*(?:if\s*\(|assert\w*\b|throw\b|require\(|check\(|Preconditions\.|error\(|guard\b|precondition\()/i;
const BOC_CO_TEST = /if\s*\(\s*!?\s*(?:\w+\.)*(?:isPlaying|isTest\w*|isUnitTest|IS_TEST|BuildConfig\.DEBUG|DEBUG|inTest\w*|underTest|isRobolectric)\b/;
const ASSERT_TEST = /\b(?:assert\w*|expect|verify|should\w*|Assert\.)\b/;
const DONG_IMPORT = /^\s*(?:import|using|#include|from\s+\S+\s+import|require\(|package)\b/;
const LA_TEST = /(?:^|\/)(?:test|tests|androidTest|__tests__)\/|Test\w*\.[a-z]+$|_test\.[a-z]+$|\.test\.[a-z]+$|\.spec\.[a-z]+$/;

/** Phan tich `git diff -U0` (tracked, so voi base hoac HEAD) thanh {file, removed:[{line,text}], added:[{line,text}]}. */
export function phanTichDiff(diffText) {
  const files = [];
  let cur = null;
  let oldLine = 0;
  let newLine = 0;
  for (const raw of String(diffText || '').split('\n')) {
    if (raw.startsWith('diff --git')) {
      const m = /b\/(.+)$/.exec(raw);
      cur = { file: m ? m[1] : raw, removed: [], added: [] };
      files.push(cur);
    } else if (cur && raw.startsWith('@@')) {
      const m = /@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(raw);
      oldLine = m ? Number(m[1]) : 0;
      newLine = m ? Number(m[2]) : 0;
    } else if (cur && raw.startsWith('-') && !raw.startsWith('---')) {
      cur.removed.push({ line: oldLine, text: raw.slice(1) });
      oldLine += 1;
    } else if (cur && raw.startsWith('+') && !raw.startsWith('+++')) {
      cur.added.push({ line: newLine, text: raw.slice(1) });
      newLine += 1;
    }
  }
  return files;
}

/** Canh bao lam mem guard / pha test tu diff da phan tich. */
export function soiLamMem(files) {
  const warnings = [];
  for (const f of files) {
    if (BO_QUA.some((re) => re.test(f.file))) continue;
    const laTest = LA_TEST.test(f.file);
    const addedNorm = new Set(f.added.map((a) => a.text.trim()));
    // Guard bi xoa ma khong duoc them lai (y het) o cho khac.
    const guardMat = f.removed.filter((r) => GUARD_XOA.test(r.text) && !DONG_IMPORT.test(r.text) && !addedNorm.has(r.text.trim()));
    if (!laTest && guardMat.length) {
      warnings.push(`${f.file}: ${guardMat.length} dong guard bi xoa/doi (${guardMat.slice(0, 3).map((g) => `dong ${g.line}: \`${g.text.trim().slice(0, 60)}\``).join('; ')}) — PM soi tan mat: co lam mem dieu kien bao ve khong?`);
    }
    const boc = f.added.filter((a) => BOC_CO_TEST.test(a.text));
    if (!laTest && boc.length) {
      warnings.push(`${f.file}: production code bi boc bang co test/debug (${boc.slice(0, 2).map((b) => `dong ${b.line}: \`${b.text.trim().slice(0, 60)}\``).join('; ')}) — dau hieu sua code cho test xanh`);
    }
    if (laTest) {
      const assertMat = f.removed.filter((r) => ASSERT_TEST.test(r.text) && !DONG_IMPORT.test(r.text) && !addedNorm.has(r.text.trim()));
      if (assertMat.length) {
        warnings.push(`${f.file}: ${assertMat.length} dong assert/expect bi xoa trong file test (${assertMat.slice(0, 2).map((g) => `dong ${g.line}`).join(', ')}) — test bi lam mem? PM soi tan mat`);
      }
      const boom = f.added.filter((a) => /\b(?:9999|Int\.MAX_VALUE|Integer\.MAX_VALUE|Long\.MAX_VALUE|float\.MaxValue|int\.MaxValue|Thread\.sleep\(\d{4,})/.test(a.text));
      if (boom.length) warnings.push(`${f.file}: hang so "vo han" them vao test (${boom.slice(0, 2).map((b) => `dong ${b.line}: \`${b.text.trim().slice(0, 60)}\``).join('; ')}) — PM soi`);
    }
  }
  return warnings;
}

function diffSoVoi(projectRoot, base) {
  try {
    return execFileSync('git', ['--no-pager', 'diff', '-U0', '--no-color', base || 'HEAD'], { cwd: projectRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 50_000_000 });
  } catch {
    return '';
  }
}

/**
 * Soi cac file dang thay doi. PHAM VI: tang dong / khoi lap / SQL trung xet tren `changedFiles` (cay lam viec, do
 * tools.js truyen); guard/assert xet tren `git diff -U0 <base>` = MOI thay doi ke tu commit goc, ke ca da commit —
 * vi agent hay commit roi moi bao cao (T0025: fix_update_config.py da nam trong commit 302d38a1). Tra ve { warnings: [], blockers: [] } — chuoi da soan san.
 * changedFiles: duong dan tuong doi; base: commit goc (null => khong so tang).
 */
export function soiThayDoi(projectRoot, changedFiles, base) {
  const warnings = [];
  const blockers = [];
  for (const rel of changedFiles || []) {
    if (BO_QUA.some((re) => re.test(rel))) continue;
    const abs = path.resolve(projectRoot, rel);
    let st;
    try { st = fs.statSync(abs); } catch { continue; } // da xoa
    if (!st.isFile() || st.size > MAX_BYTES || st.size === 0) continue;
    const buf = fs.readFileSync(abs);
    if (!laText(buf)) continue;
    const text = buf.toString('utf8');
    const dong = text.split('\n').length;

    if (base) {
      const goc = soDongGoc(projectRoot, base, rel);
      if (goc && goc >= 40 && dong > goc * (1 + NGUONG_TANG)) {
        warnings.push(`${rel}: ${goc} -> ${dong} dong (+${Math.round(((dong - goc) / goc) * 100)} %) — tang bat thuong, kiem xem co bi nhan doi noi dung khong`);
      }
    }
    const lap = timKhoiLap(text);
    if (lap) warnings.push(`${rel}: khoi ${lap.dong} dong lap lai y het (dong ${lap.lan1} va ${lap.lan2}) — dau hieu va bang script nhan doi`);

    if (/\.sql$/i.test(rel)) {
      const { tables, functions } = dinhNghiaSqlTrung(text);
      if (tables.length) blockers.push(`${rel}: create table trung ${tables.map((t) => `"${t}"`).join(', ')} — dinh nghia bang 2 lan trong cung file`);
      if (functions.length) warnings.push(`${rel}: create function trung chu ky ${functions.join(', ')} — kiem xem co phai nhan doi`);
    }
  }
  // Lam mem guard / pha test: so voi commit goc (hoac HEAD) — chi file tracked co diff.
  if (changedFiles?.length) warnings.push(...soiLamMem(phanTichDiff(diffSoVoi(projectRoot, base))));
  return { warnings, blockers };
}
